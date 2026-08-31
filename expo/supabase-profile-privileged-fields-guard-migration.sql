-- =============================================================================
-- EAGOH migration — profiles privileged-fields guard
-- Phase: Protect subscription/admin fields from authenticated self-update.
--
-- Run once in the Supabase SQL editor (postgres role). Idempotent — safe to
-- re-run. Never edit an already-applied migration; supersede with a new file.
--
-- Protected fields:
--   subscription_tier, admin_tier_override, admin_tier_expires_at,
--   admin_tier_note, is_admin
--
-- What this does:
--   1. Revokes table-level UPDATE from anon/authenticated on public.profiles
--      (Supabase default privileges grant ALL, including UPDATE) and re-grants
--      UPDATE column-by-column on every column EXCEPT the protected five.
--      A REST PATCH touching any protected column then fails at the privilege
--      layer — including multi-column patches (statements are all-or-nothing,
--      so the normal fields in the same request stay unchanged too).
--   2. Installs a BEFORE UPDATE trigger comparing OLD/NEW with
--      IS DISTINCT FROM. Any protected-field change is rejected unless the
--      current database role is service_role, postgres, or supabase_admin.
--      This is the primary enforcement and holds even if column grants are
--      later loosened.
--   3. Installs a BEFORE INSERT guard coercing the protected fields to safe
--      defaults for non-privileged roles (closes the profiles_self_insert
--      hole where a fresh row could be created with is_admin = true).
--
-- Role check security: the trigger inspects `current_user` — the database role
-- established by PostgREST via SET ROLE after JWT verification. It cannot be
-- spoofed by JWT claims, request bodies, stored is_admin values, or any
-- client-supplied field.
--
-- Preserved behavior:
--   - Authenticated users keep editing their own normal profile fields
--     (username, display_name, avatar_url, banner_url, preferences,
--     selected_labs/selected_eagohs, public flags, bio, social flags, etc.).
--   - The Worker's service-role subscription sync keeps writing
--     subscription_tier + balance fields; service-role balance operations keep
--     updating edge_subscription / edge_purchased.
--   - SECURITY DEFINER RPCs (purchase/deduction/share rewards) run as their
--     owner (postgres) and pass the trigger unchanged.
--   - handle_new_user auto-creation (SECURITY DEFINER) is unaffected.
--   - All existing rows, RLS policies, balances, and admin override flows
--     remain exactly as they were.
--
-- NOTE for future migrations: because UPDATE is now column-level, a NEW
-- client-editable profiles column added later must be added to the UPDATE
-- grant (re-run the grants block or grant the column explicitly). This is
-- intentionally fail-closed.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Column-level UPDATE privileges (defense in depth, layer 1)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name   = 'profiles'
    and c.column_name not in (
      'subscription_tier',
      'admin_tier_override',
      'admin_tier_expires_at',
      'admin_tier_note',
      'is_admin'
    );

  if v_cols is null then
    raise exception 'public.profiles not found or has no grantable columns — aborting, nothing changed.';
  end if;

  -- Revoke table-level UPDATE first (default privileges grant ALL).
  -- service_role is intentionally untouched.
  execute 'revoke update on table public.profiles from anon, authenticated, public';

  -- Re-grant UPDATE on every non-protected column to authenticated.
  -- anon has no legitimate profiles update path and gets none.
  execute format('grant update (%s) on table public.profiles to authenticated', v_cols);

  raise notice 'profiles UPDATE grants rebuilt: authenticated keeps % column(s), protected columns excluded.', array_length(string_to_array(v_cols, ','), 1);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. BEFORE UPDATE trigger — primary enforcement (defense in depth, layer 2)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enforce_profiles_privileged_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- current_user is the post-SET-ROLE database role. Server-established,
  -- not client-controllable. SECURITY DEFINER RPCs run as their owner
  -- (postgres) and therefore pass.
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if new.subscription_tier       is distinct from old.subscription_tier
  or new.admin_tier_override     is distinct from old.admin_tier_override
  or new.admin_tier_expires_at   is distinct from old.admin_tier_expires_at
  or new.admin_tier_note         is distinct from old.admin_tier_note
  or new.is_admin                is distinct from old.is_admin then
    raise exception
      'profiles: privileged fields (subscription_tier, admin_tier_*, is_admin) are admin-managed and cannot be changed by role %',
      current_user
      using errcode = '42501';  -- insufficient_privilege
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_privileged_fields_guard on public.profiles;
create trigger profiles_privileged_fields_guard
  before update on public.profiles
  for each row
  execute function public.enforce_profiles_privileged_fields();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. BEFORE INSERT guard — no fresh privileged rows from client roles
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.guard_profiles_privileged_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  -- Coerce to safe defaults; identical to what ensureProfile inserts, so the
  -- client onboarding path behaves exactly as before.
  new.subscription_tier     := 'free';
  new.admin_tier_override   := null;
  new.admin_tier_expires_at := null;
  new.admin_tier_note       := null;
  new.is_admin              := false;

  return new;
end;
$$;

drop trigger if exists profiles_privileged_insert_guard on public.profiles;
create trigger profiles_privileged_insert_guard
  before insert on public.profiles
  for each row
  execute function public.guard_profiles_privileged_insert();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Verification (run manually after applying; do NOT ship as part of a
--    batch — each check prints PASS/FAIL via notice and the final raise
--    rolls every change back, leaving data untouched).
--
--    Replace <TEST_USER_UUID> with the FULL UUID of a real test account.
--    The whole block is one transaction ending in an intentional failure so
--    nothing persists. "rol" warnings/notices print PASS/FAIL lines.
-- ─────────────────────────────────────────────────────────────────────────────
-- 4a. Column privilege state (read-only, no transaction needed):
--
-- select
--   has_column_privilege('authenticated', 'public.profiles', 'username', 'UPDATE')            as auth_upd_username,          -- expect true
--   has_column_privilege('authenticated', 'public.profiles', 'subscription_tier', 'UPDATE')   as auth_upd_subscription_tier, -- expect false
--   has_column_privilege('authenticated', 'public.profiles', 'admin_tier_override', 'UPDATE') as auth_upd_admin_override,    -- expect false
--   has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'UPDATE')            as auth_upd_is_admin;          -- expect false
--
-- 4b. Behavior checks (transactional, self-rolling-back):
--
-- begin;
--
-- do $$
-- declare
--   v_uid  uuid := '<TEST_USER_UUID>';
--   v_sub  text;
--   v_ovr  text;
--   v_note text;
--   v_adm  boolean;
-- begin
--   select subscription_tier, admin_tier_override, admin_tier_note, is_admin
--     into v_sub, v_ovr, v_note, v_adm
--   from public.profiles where id = v_uid;
--   if not found then
--     raise exception 'Test user % has no profile row', v_uid;
--   end if;
--
--   -- 1. authenticated self-update of a normal field succeeds
--   begin
--     set local role authenticated;
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
--     update public.profiles set username = coalesce(nullif(username, ''), 'audit_ok')
--     where id = v_uid;
--     raise notice 'PASS 1/5: authenticated username self-update succeeded';
--   exception when others then
--     raise notice 'FAIL 1/5: authenticated username self-update failed: %', sqlerrm;
--   end;
--
--   -- 2. authenticated admin_tier_override change fails
--   begin
--     set local role authenticated;
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
--     update public.profiles set admin_tier_override = 'syndicate' where id = v_uid;
--     raise notice 'FAIL 2/5: admin_tier_override change SUCCEEDED (must fail)';
--     reset role;
--   exception when others then
--     raise notice 'PASS 2/5: admin_tier_override change rejected [%] %', sqlstate, sqlerrm;
--   end;
--
--   -- 3. authenticated subscription_tier change fails
--   begin
--     set local role authenticated;
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
--     update public.profiles set subscription_tier = 'syndicate' where id = v_uid;
--     raise notice 'FAIL 3/5: subscription_tier change SUCCEEDED (must fail)';
--     reset role;
--   exception when others then
--     raise notice 'PASS 3/5: subscription_tier change rejected [%] %', sqlstate, sqlerrm;
--   end;
--
--   -- 4. authenticated is_admin change fails
--   begin
--     set local role authenticated;
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
--     update public.profiles set is_admin = true where id = v_uid;
--     raise notice 'FAIL 4/5: is_admin change SUCCEEDED (must fail)';
--     reset role;
--   exception when others then
--     raise notice 'PASS 4/5: is_admin change rejected [%] %', sqlstate, sqlerrm;
--   end;
--
--   -- 5. service_role subscription update succeeds
--   begin
--     set local role service_role;
--     update public.profiles set subscription_tier = 'pro' where id = v_uid;
--     raise notice 'PASS 5/5: service_role subscription_tier update succeeded';
--   exception when others then
--     raise notice 'FAIL 5/5: service_role subscription_tier update failed: %', sqlerrm;
--   end;
--
--   -- 6. protected values are unchanged after the rejected attempts
--   if v_sub  is distinct from (select subscription_tier   from public.profiles where id = v_uid)
--   or v_ovr  is distinct from (select admin_tier_override from public.profiles where id = v_uid)
--   or v_note is distinct from (select admin_tier_note     from public.profiles where id = v_uid)
--   or v_adm  is distinct from (select is_admin            from public.profiles where id = v_uid) then
--     raise notice 'FAIL 6/6: a protected value changed despite rejection';
--   else
--     raise notice 'PASS 6/6: protected values unchanged after rejected attempts';
--   end if;
--
--   -- Intentional failure: rolls back the username + service_role test writes.
--   raise exception 'AUDIT COMPLETE — rolling back verification writes (expected).';
-- end;
-- $$;
--
-- rollback;
