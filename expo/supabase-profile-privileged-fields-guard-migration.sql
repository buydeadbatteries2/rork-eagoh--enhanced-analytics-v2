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
--   1. Revokes table-level UPDATE from PUBLIC, anon, and authenticated on
--      public.profiles
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
-- Role check security: both trigger functions explicitly declare SECURITY
-- INVOKER (never SECURITY DEFINER). Under SECURITY INVOKER, `current_user` is
-- the post-SET-ROLE database role established server-side by PostgREST after
-- JWT verification — it cannot be spoofed by JWT claims, request bodies,
-- stored is_admin values, or any client-supplied field. (Under SECURITY
-- DEFINER the functions would execute as their owner, so current_user would
-- always be the owner and the check would be silently voided — hence the
-- explicit declaration.) Allowed roles: service_role, postgres,
-- supabase_admin. Every other role — known or future — is rejected
-- (fail-closed).
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

-- Single transaction: every mutation below commits atomically — any failure
-- before COMMIT rolls back the entire migration.
begin;

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

  -- Revoke table-level UPDATE from PUBLIC, anon, and authenticated
  -- (Supabase default privileges grant ALL). service_role privileges are
  -- intentionally untouched — the Worker depends on them.
  execute 'revoke update on table public.profiles from anon, authenticated, public';

  -- Re-grant UPDATE on every non-protected column — to authenticated ONLY.
  -- anon and PUBLIC deliberately receive no UPDATE grant: no verified runtime
  -- flow performs anonymous profile updates, and profile onboarding uses
  -- INSERT (profiles_self_insert, unaffected by this change).
  execute format('grant update (%s) on table public.profiles to authenticated', v_cols);

  raise notice 'profiles UPDATE grants rebuilt: authenticated keeps % column(s), protected columns excluded.', array_length(string_to_array(v_cols, ','), 1);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. BEFORE UPDATE trigger — primary enforcement (defense in depth, layer 2)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enforce_profiles_privileged_fields()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- SECURITY INVOKER (declared explicitly above): current_user is the
  -- post-SET-ROLE database role — server-established, not
  -- client-controllable. SECURITY DEFINER RPCs run as their owner
  -- (postgres) and therefore pass. Every other role — known or future —
  -- falls through to the rejection below (fail-closed).
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
security invoker
set search_path = public
as $$
begin
  -- Privileged inserts pass through with NEW untouched: the Worker's
  -- service-role writes, SQL-editor/postgres administration, and
  -- handle_new_user() (SECURITY DEFINER owned by postgres, so current_user
  -- inside it is postgres) keep exactly the values they provide — never
  -- overwritten by this guard.
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  -- Every other role (authenticated, anon, or any other role) is coerced to
  -- safe defaults regardless of what NEW carried — identical to what
  -- ensureProfile inserts, so client onboarding behaves exactly as before.
  -- Forced values:
  --   subscription_tier     = 'free'
  --   admin_tier_override   = null
  --   admin_tier_expires_at = null
  --   admin_tier_note       = null
  --   is_admin              = false
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
-- 4. OPERATIVE PREFLIGHT — live catalog queries (read-only; safe to run in the
--    same batch as the migration). These display the actual database state,
--    not repository inference. Expected results are annotated inline.
-- ─────────────────────────────────────────────────────────────────────────────

-- 4.1 Table-level UPDATE grants on public.profiles:
--     expect ONLY service_role (postgres/supabase_admin hold superuser rights
--     and do not appear as explicit grantees; anon/authenticated must be
--     absent entirely).
select grantee, privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and table_name   = 'profiles'
  and privilege_type = 'UPDATE'
order by grantee;

-- 4.2 Column-level UPDATE grants:
--     expect authenticated rows for every non-protected column only — no row
--     for anon or PUBLIC, and none of the five protected columns for any
--     client-facing grantee.
select grantee, column_name
from information_schema.column_privileges
where table_schema = 'public'
  and table_name   = 'profiles'
  and privilege_type = 'UPDATE'
order by grantee, column_name;

-- 4.3 Boolean privilege assertions (authoritative check):
select
  has_table_privilege('anon',          'public.profiles', 'UPDATE') as anon_table_update,                            -- expect false
  has_table_privilege('authenticated', 'public.profiles', 'UPDATE') as authenticated_table_update,                   -- expect false
  has_table_privilege('service_role',  'public.profiles', 'UPDATE') as service_role_table_update,                    -- expect true
  has_column_privilege('authenticated', 'public.profiles', 'username', 'UPDATE')            as auth_upd_username,                  -- expect true
  has_column_privilege('authenticated', 'public.profiles', 'subscription_tier', 'UPDATE')   as auth_upd_subscription_tier,         -- expect false
  has_column_privilege('authenticated', 'public.profiles', 'admin_tier_override', 'UPDATE') as auth_upd_admin_tier_override,       -- expect false
  has_column_privilege('authenticated', 'public.profiles', 'admin_tier_expires_at', 'UPDATE') as auth_upd_admin_tier_expires_at,   -- expect false
  has_column_privilege('authenticated', 'public.profiles', 'admin_tier_note', 'UPDATE')     as auth_upd_admin_tier_note,           -- expect false
  has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'UPDATE')            as auth_upd_is_admin;                  -- expect false;

-- 4.4 RLS policies on public.profiles (expect the five existing policies,
--     unchanged by this migration):
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename  = 'profiles'
order by policyname;

-- 4.5 Trigger security mode (expect SECURITY INVOKER for both guard
--     triggers; internal triggers are excluded):
select
  t.tgname  as trigger_name,
  p.proname as function_name,
  case when p.prosec
       then 'SECURITY DEFINER (UNSAFE — must not appear)'
       else 'SECURITY INVOKER' end as security_mode
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'public.profiles'::regclass
  and not t.tgisinternal
order by t.tgname;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Manual behavior verification (run manually after applying; do NOT ship as
--    part of a batch — each check prints PASS/FAIL via notice and the final
--    raise rolls every change back, leaving data untouched).
--
--    Impersonation accuracy: `set local role authenticated` plus a
--    transaction-local `request.jwt.claims` setting reproduces exactly what
--    PostgREST does for an authenticated client (RLS via auth.uid() with
--    role=authenticated); `set local role service_role` reproduces the
--    Worker's service-role connection. Every subtransaction resets the role
--    on BOTH success and failure paths so later impersonations always start
--    from postgres, and the trailing intentional exception aborts the
--    transaction so NO statement persists (the begin;/rollback; wrapper is a
--    second safety net).
--
--    Replace <TEST_USER_UUID> with the FULL UUID of a real test account.
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
--     reset role;  -- restore postgres so later SET ROLE targets are reachable
--   exception when others then
--     raise notice 'FAIL 1/5: authenticated username self-update failed: %', sqlerrm;
--     reset role;
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
--     reset role;  -- subtransaction rollback already restored it; explicit for clarity
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
--     reset role;  -- subtransaction rollback already restored it; explicit for clarity
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
--     reset role;  -- subtransaction rollback already restored it; explicit for clarity
--   end;
--
--   -- 5. service_role subscription update succeeds
--   begin
--     set local role service_role;
--     update public.profiles set subscription_tier = 'pro' where id = v_uid;
--     raise notice 'PASS 5/5: service_role subscription_tier update succeeded';
--     reset role;  -- restore postgres before the value-comparison check
--   exception when others then
--     raise notice 'FAIL 5/5: service_role subscription_tier update failed: %', sqlerrm;
--     reset role;
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
