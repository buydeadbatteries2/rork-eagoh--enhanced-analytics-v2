-- ──────────────────────────────────────────────────────────────────────────
-- COMPLIMENTARY TIER ACCESS — Migration (v2 — corrected)
-- Adds admin-controlled complimentary Pro/Oracle Elite access to profiles.
-- Managed directly from Supabase Dashboard (public.profiles).
-- Does NOT change existing subscription_tier values or RevenueCat logic.
--
-- CRITICAL FIXES in v2:
--   1. RPC never reduces a higher paid-tier balance (priority comparison)
--   2. Safe SECURITY DEFINER RPCs replace direct table UPDATE
--   3. Table-level UPDATE revoked from authenticated/anon
--   4. Column-level REVOKE removed (was insufficient with table-level grant)
-- ──────────────────────────────────────────────────────────────────────────

-- ── 1. Add complimentary tier columns to profiles ──────────────────────────

alter table public.profiles
  add column if not exists complimentary_tier text
    check (complimentary_tier is null or complimentary_tier in ('pro', 'oracle_elite')),
  add column if not exists complimentary_tier_expires_at timestamptz,
  add column if not exists complimentary_tier_granted_at timestamptz,
  add column if not exists complimentary_tier_note text;

-- ── 2. Index for querying active complimentary users ───────────────────────

create index if not exists profiles_complimentary_tier_idx
  on public.profiles(complimentary_tier)
  where complimentary_tier is not null;

-- ── 3. Complimentary allocation ledger table ───────────────────────────────
-- Tracks each monthly complimentary neuron grant for idempotency and audit.
-- The idempotency key format is: complimentary_alloc:<user_id>:<tier>:<YYYY-MM>

create table if not exists public.complimentary_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  complimentary_tier text not null check (complimentary_tier in ('pro', 'oracle_elite')),
  allocation_amount integer not null,
  allocation_month text not null,  -- format: YYYY-MM (UTC)
  idempotency_key text not null unique,  -- complimentary_alloc:<user_id>:<tier>:<YYYY-MM>
  created_at timestamptz not null default now()
);

create index if not exists ca_user_id_idx on public.complimentary_allocations(user_id);
create index if not exists ca_idempotency_key_idx on public.complimentary_allocations(idempotency_key);

alter table public.complimentary_allocations enable row level security;
-- No policies for authenticated/anon — service_role bypasses RLS.
-- Users cannot see or modify their own allocation ledger.

-- ── 4. Atomic complimentary allocation RPC (FIXED) ─────────────────────────
-- SECURITY DEFINER: runs as function owner (service_role).
--
-- CRITICAL FIX: This RPC now compares the paid subscription_tier priority
-- with the complimentary tier priority. It only grants the complimentary
-- allocation when the complimentary tier is STRICTLY HIGHER than the paid tier.
--
-- If the paid tier is equal or higher, the RPC returns a skipped result and
-- does NOT modify edge_subscription or insert a ledger row.
--
-- Paid tier is normalized: any value not in ('free','pro','oracle_elite',
-- 'syndicate') is treated as 'free'.
--
-- Tier priority: free=0, pro=1, oracle_elite=2, syndicate=3
--
-- Idempotent: uses the complimentary_allocations ledger table.
-- No rollover for complimentary access — allocation REPLACES subscription balance.
-- Does NOT touch purchased neurons, subscription_tier, or RevenueCat fields.

create or replace function public.grant_complimentary_allocation(
  p_user_id uuid,
  p_complimentary_tier text
)
returns table(
  success boolean,
  error_code text,
  error_message text,
  allocation_amount integer,
  new_subscription_balance integer,
  already_granted boolean,
  skipped_for_higher_paid_tier boolean,
  effective_tier text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile        record;
  v_paid_tier      text;
  v_paid_priority  integer;
  v_comp_priority  integer;
  v_expires_at     timestamptz;
  v_amount         integer;
  v_month_key      text;
  v_idem_key       text;
  v_existing       uuid;
  v_current_sub    integer;
begin
  -- 1. Validate complimentary tier
  if p_complimentary_tier not in ('pro', 'oracle_elite') then
    return query select false, 'INVALID_TIER',
      'Complimentary tier must be pro or oracle_elite.',
      0, 0, false, false, null;
    return;
  end if;

  -- 2. Lock the profile row and read all needed fields
  select complimentary_tier, complimentary_tier_expires_at,
         subscription_tier, edge_subscription, edge_purchased
    into v_profile
  from profiles
  where id = p_user_id
  for update;

  if not found then
    return query select false, 'PROFILE_NOT_FOUND', 'Profile not found.',
      0, 0, false, false, null;
    return;
  end if;

  v_current_sub := coalesce(v_profile.edge_subscription, 0);

  -- 3. Normalize the paid subscription_tier
  --    Unknown or malformed values are treated as 'free'
  v_paid_tier := coalesce(v_profile.subscription_tier, 'free');
  if v_paid_tier not in ('free', 'pro', 'oracle_elite', 'syndicate') then
    v_paid_tier := 'free';
  end if;

  -- 4. Compute tier priorities
  v_paid_priority := case v_paid_tier
    when 'free' then 0
    when 'pro' then 1
    when 'oracle_elite' then 2
    when 'syndicate' then 3
    else 0
  end;

  v_comp_priority := case p_complimentary_tier
    when 'pro' then 1
    when 'oracle_elite' then 2
    else 0
  end;

  -- 5. If paid tier is equal or higher, SKIP — do not reduce the balance
  --    Return a skipped result without modifying anything.
  --    No ledger row is inserted.
  if v_paid_priority >= v_comp_priority then
    return query select true, null, null,
      0, v_current_sub, false, true, v_paid_tier;
    return;
  end if;

  -- 6. Verify the profile actually has this complimentary tier active
  if v_profile.complimentary_tier is null or v_profile.complimentary_tier <> p_complimentary_tier then
    return query select false, 'TIER_MISMATCH',
      'Profile does not have this complimentary tier.',
      0, v_current_sub, false, false, v_paid_tier;
    return;
  end if;

  -- 7. Check expiration — expired complimentary access is inactive
  v_expires_at := v_profile.complimentary_tier_expires_at;
  if v_expires_at is not null and v_expires_at <= now() then
    return query select false, 'COMPLIMENTARY_EXPIRED',
      'Complimentary access has expired.',
      0, v_current_sub, false, false, v_paid_tier;
    return;
  end if;

  -- 8. Determine allocation amount
  v_amount := case p_complimentary_tier
    when 'pro' then 600
    when 'oracle_elite' then 1400
    else 0
  end;

  if v_amount = 0 then
    return query select false, 'INVALID_AMOUNT', 'Could not determine allocation.',
      0, v_current_sub, false, false, v_paid_tier;
    return;
  end if;

  -- 9. Build idempotency key for this month
  v_month_key := to_char(now() at time zone 'UTC', 'YYYY-MM');
  v_idem_key := 'complimentary_alloc:' || p_user_id::text || ':' || p_complimentary_tier || ':' || v_month_key;

  -- 10. Check if already granted this month (idempotency)
  select id into v_existing
    from complimentary_allocations
    where idempotency_key = v_idem_key
    limit 1;

  if v_existing is not null then
    -- Already granted this month — return success without re-granting
    return query select true, null, null,
      v_amount, v_current_sub, true, false, p_complimentary_tier;
    return;
  end if;

  -- 11. Grant: set subscription balance to the allocation amount (no rollover)
  --     Do NOT touch purchased neurons or subscription_tier.
  update profiles
    set edge_subscription = v_amount,
        last_rollover_at = now(),
        last_allocation = v_amount,
        updated_at = now()
    where id = p_user_id;

  -- 12. Insert ledger row for idempotency and audit
  insert into complimentary_allocations
    (user_id, complimentary_tier, allocation_amount, allocation_month, idempotency_key)
  values
    (p_user_id, p_complimentary_tier, v_amount, v_month_key, v_idem_key);

  -- 13. Log to edge_transactions for full audit trail
  insert into edge_transactions
    (user_id, kind, reason, amount, bucket,
     from_subscription, from_purchased,
     balance_subscription_after, balance_purchased_after,
     note)
  values
    (p_user_id, 'addition', 'subscription_allocation', v_amount, 'subscription',
     0, 0,
     v_amount, coalesce(v_profile.edge_purchased, 0),
     'complimentary_subscription_allocation — tier:' || p_complimentary_tier ||
     ' amount:' || v_amount || ' — idempotency:' || v_idem_key);

  return query select true, null, null,
    v_amount, v_amount, false, false, p_complimentary_tier;
end;
$$;

-- Grant execute to service role only (Cloudflare Worker)
grant execute on function public.grant_complimentary_allocation(uuid, text)
  to service_role;
revoke execute on function public.grant_complimentary_allocation(uuid, text)
  from public, anon, authenticated;

-- ── 5. Safe profile-update RPC ─────────────────────────────────────────────
-- SECURITY DEFINER RPC for normal profile editing.
-- Only accepts user-editable fields. Never touches admin, complimentary,
-- subscription_tier, or edge balance fields.
--
-- The client calls this instead of direct table UPDATE.

create or replace function public.update_own_safe_profile(
  p_user_id uuid,
  p_updates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row       record;
  v_key       text;
  v_bad_keys  text[] := '{}';
  v_allowed   text[] := array[
    'username', 'display_name', 'bio', 'avatar_url', 'banner_url',
    'public_display_title', 'selected_labs', 'selected_eagohs',
    'preferences', 'public_profile_enabled', 'show_social_accounts',
    'show_credentials', 'show_public_eagohs', 'show_faction'
  ];
begin
  -- Verify caller is the profile owner
  if auth.uid() is null or auth.uid() <> p_user_id then
    return jsonb_build_object('ok', false, 'error', 'Not authorized');
  end if;

  -- Validate all keys are in the allowed list
  foreach v_key in array array(select jsonb_object_keys(p_updates))
  loop
    if not (v_key = any(v_allowed)) then
      v_bad_keys := array_append(v_bad_keys, v_key);
    end if;
  end loop;

  if array_length(v_bad_keys, 1) is not null and array_length(v_bad_keys, 1) > 0 then
    return jsonb_build_object('ok', false, 'error', 'Disallowed fields: ' || array_to_string(v_bad_keys, ', '));
  end if;

  -- Update only fields present in p_updates; others stay unchanged
  update profiles set
    username = case when p_updates ? 'username' then (p_updates->>'username') else username end,
    display_name = case when p_updates ? 'display_name' then (p_updates->>'display_name') else display_name end,
    bio = case when p_updates ? 'bio' then (p_updates->>'bio') else bio end,
    avatar_url = case when p_updates ? 'avatar_url' then (p_updates->>'avatar_url') else avatar_url end,
    banner_url = case when p_updates ? 'banner_url' then (p_updates->>'banner_url') else banner_url end,
    public_display_title = case when p_updates ? 'public_display_title' then (p_updates->>'public_display_title') else public_display_title end,
    selected_labs = case when p_updates ? 'selected_labs' then (p_updates->'selected_labs') else selected_labs end,
    selected_eagohs = case when p_updates ? 'selected_eagohs' then (p_updates->'selected_eagohs') else selected_eagohs end,
    preferences = case when p_updates ? 'preferences' then (p_updates->'preferences') else preferences end,
    public_profile_enabled = case when p_updates ? 'public_profile_enabled' then (p_updates->>'public_profile_enabled')::boolean else public_profile_enabled end,
    show_social_accounts = case when p_updates ? 'show_social_accounts' then (p_updates->>'show_social_accounts')::boolean else show_social_accounts end,
    show_credentials = case when p_updates ? 'show_credentials' then (p_updates->>'show_credentials')::boolean else show_credentials end,
    show_public_eagohs = case when p_updates ? 'show_public_eagohs' then (p_updates->>'show_public_eagohs')::boolean else show_public_eagohs end,
    show_faction = case when p_updates ? 'show_faction' then (p_updates->>'show_faction')::boolean else show_faction end,
    updated_at = now()
  where id = p_user_id
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Profile not found');
  end if;

  return jsonb_build_object('ok', true, 'profile', to_jsonb(v_row));
end;
$$;

grant execute on function public.update_own_safe_profile(uuid, jsonb)
  to authenticated;
revoke execute on function public.update_own_safe_profile(uuid, jsonb)
  from anon;

-- ── 6. Edge balance update RPC ─────────────────────────────────────────────
-- SECURITY DEFINER RPC for client-side edge spend/add/rollover operations.
-- Only accepts edge_subscription, edge_purchased, last_rollover_at, last_allocation.
-- Never touches subscription_tier, complimentary fields, or admin fields.

create or replace function public.update_own_edge_balances(
  p_user_id uuid,
  p_updates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row       record;
  v_key       text;
  v_bad_keys  text[] := '{}';
  v_allowed   text[] := array['edge_subscription', 'edge_purchased', 'last_rollover_at', 'last_allocation'];
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    return jsonb_build_object('ok', false, 'error', 'Not authorized');
  end if;

  foreach v_key in array array(select jsonb_object_keys(p_updates))
  loop
    if not (v_key = any(v_allowed)) then
      v_bad_keys := array_append(v_bad_keys, v_key);
    end if;
  end loop;

  if array_length(v_bad_keys, 1) is not null and array_length(v_bad_keys, 1) > 0 then
    return jsonb_build_object('ok', false, 'error', 'Disallowed fields: ' || array_to_string(v_bad_keys, ', '));
  end if;

  update profiles set
    edge_subscription = case when p_updates ? 'edge_subscription' then (p_updates->>'edge_subscription')::int else edge_subscription end,
    edge_purchased = case when p_updates ? 'edge_purchased' then (p_updates->>'edge_purchased')::int else edge_purchased end,
    last_rollover_at = case when p_updates ? 'last_rollover_at' then (p_updates->>'last_rollover_at')::timestamptz else last_rollover_at end,
    last_allocation = case when p_updates ? 'last_allocation' then (p_updates->>'last_allocation')::int else last_allocation end,
    updated_at = now()
  where id = p_user_id
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Profile not found');
  end if;

  return jsonb_build_object('ok', true, 'profile', to_jsonb(v_row));
end;
$$;

grant execute on function public.update_own_edge_balances(uuid, jsonb)
  to authenticated;
revoke execute on function public.update_own_edge_balances(uuid, jsonb)
  from anon;

-- ── 7. Verification status update RPC ──────────────────────────────────────
-- SECURITY DEFINER RPC for social verification status updates.
-- Only accepts is_social_verified and social_verified_platform.

create or replace function public.update_own_verification_status(
  p_user_id uuid,
  p_is_social_verified boolean,
  p_social_verified_platform text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    return false;
  end if;

  update profiles set
    is_social_verified = p_is_social_verified,
    social_verified_platform = p_social_verified_platform,
    updated_at = now()
  where id = p_user_id;

  return found;
end;
$$;

grant execute on function public.update_own_verification_status(uuid, boolean, text)
  to authenticated;
revoke execute on function public.update_own_verification_status(uuid, boolean, text)
  from anon;

-- ── 8. Revoke table-level UPDATE on profiles ───────────────────────────────
--
-- DIAGNOSTIC: Does authenticated have table-level UPDATE on public.profiles?
--
-- In standard Supabase setup, the postgres role grants table-level privileges
-- to authenticated and anon via default privileges. The profiles_self_update
-- RLS policy (using auth.uid() = id) confirms this — the policy is only
-- meaningful if the role has UPDATE privilege on the table.
--
-- Column-level REVOKE is NOT sufficient when a table-level UPDATE grant exists.
-- PostgreSQL table-level grants override column-level REVOKEs — a user with
-- table-level UPDATE can update ANY column regardless of column-level REVOKEs.
--
-- FIX: Revoke table-level UPDATE entirely. All client updates now go through
-- the SECURITY DEFINER RPCs above, which:
--   - verify auth.uid() = p_user_id (owner check)
--   - only accept whitelisted fields
--   - never touch admin, complimentary, or subscription_tier fields
--
-- The service_role and postgres superuser bypass RLS and are unaffected.
-- Supabase Dashboard admins operate as the postgres superuser.

revoke update on public.profiles from authenticated, anon;

-- The profiles_self_update RLS policy is now moot (no UPDATE privilege to check
-- against), but we leave it in place — it is harmless and provides defense in
-- depth if table-level UPDATE is ever re-granted in the future.

-- Note:
--   - SELECT and INSERT privileges on profiles are NOT revoked.
--   - The profiles_self_select and profiles_self_insert RLS policies still work.
--   - ensureProfile() (INSERT) continues to work normally.
--   - The handle_new_user() trigger is SECURITY DEFINER and unaffected.
