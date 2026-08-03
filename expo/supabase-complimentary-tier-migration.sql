-- ──────────────────────────────────────────────────────────────────────────
-- COMPLIMENTARY TIER ACCESS — Migration
-- Adds admin-controlled complimentary Pro/Oracle Elite access to profiles.
-- Managed directly from Supabase Dashboard (public.profiles).
-- Does NOT change existing subscription_tier values or RevenueCat logic.
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

-- Index for fast idempotency lookups
create index if not exists ca_user_id_idx on public.complimentary_allocations(user_id);
create index if not exists ca_idempotency_key_idx on public.complimentary_allocations(idempotency_key);

-- RLS: only service_role can read/write (worker manages allocations)
alter table public.complimentary_allocations enable row level security;

-- No policies for authenticated/anon — service_role bypasses RLS.
-- Users cannot see or modify their own allocation ledger.

-- ── 4. Atomic complimentary allocation RPC ─────────────────────────────────
-- SECURITY DEFINER: runs as function owner (service_role).
-- Called by the Cloudflare Worker when a user with active complimentary access
-- needs their monthly neuron allocation.
--
-- Idempotent: uses the complimentary_allocations ledger table.
-- The idempotency key prevents duplicate grants across:
--   - app opens
--   - profile refreshes
--   - Expo reloads
--   - CustomerInfo callbacks
--   - tab changes
--   - login events
--
-- No rollover for complimentary access (per spec).
-- The allocation REPLACES the subscription balance, not adds to it.

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
  already_granted boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile     record;
  v_tier        text;
  v_expires_at  timestamptz;
  v_amount      integer;
  v_month_key   text;
  v_idem_key    text;
  v_existing    uuid;
  v_current_sub integer;
begin
  -- 1. Validate complimentary tier
  if p_complimentary_tier not in ('pro', 'oracle_elite') then
    return query select false, 'INVALID_TIER',
      'Complimentary tier must be pro or oracle_elite.',
      0, 0, false;
    return;
  end if;

  -- 2. Lock the profile row and verify complimentary access is active
  select complimentary_tier, complimentary_tier_expires_at,
         edge_subscription, edge_purchased
    into v_profile
  from profiles
  where id = p_user_id
  for update;

  if not found then
    return query select false, 'PROFILE_NOT_FOUND', 'Profile not found.',
      0, 0, false;
    return;
  end if;

  v_tier := v_profile.complimentary_tier;
  v_expires_at := v_profile.complimentary_tier_expires_at;
  v_current_sub := coalesce(v_profile.edge_subscription, 0);

  -- 3. Verify the profile actually has this complimentary tier active
  if v_tier is null or v_tier <> p_complimentary_tier then
    return query select false, 'TIER_MISMATCH',
      'Profile does not have this complimentary tier.',
      0, v_current_sub, false;
    return;
  end if;

  -- 4. Check expiration — expired complimentary access is inactive
  if v_expires_at is not null and v_expires_at <= now() then
    return query select false, 'COMPLIMENTARY_EXPIRED',
      'Complimentary access has expired.',
      0, v_current_sub, false;
    return;
  end if;

  -- 5. Determine allocation amount
  v_amount := case p_complimentary_tier
    when 'pro' then 600
    when 'oracle_elite' then 1400
    else 0
  end;

  if v_amount = 0 then
    return query select false, 'INVALID_AMOUNT', 'Could not determine allocation.',
      0, v_current_sub, false;
    return;
  end if;

  -- 6. Build idempotency key for this month
  v_month_key := to_char(now() at time zone 'UTC', 'YYYY-MM');
  v_idem_key := 'complimentary_alloc:' || p_user_id::text || ':' || p_complimentary_tier || ':' || v_month_key;

  -- 7. Check if already granted this month (idempotency)
  select id into v_existing
    from complimentary_allocations
    where idempotency_key = v_idem_key
    limit 1;

  if v_existing is not null then
    -- Already granted this month — return success without re-granting
    return query select true, null, null, v_amount, v_current_sub, true;
    return;
  end if;

  -- 8. Grant: set subscription balance to the allocation amount (no rollover)
  --    Do NOT touch purchased neurons.
  --    The allocation REPLACES the subscription balance for complimentary users.
  update profiles
    set edge_subscription = v_amount,
        last_rollover_at = now(),
        last_allocation = v_amount,
        updated_at = now()
    where id = p_user_id;

  -- 9. Insert ledger row for idempotency and audit
  insert into complimentary_allocations
    (user_id, complimentary_tier, allocation_amount, allocation_month, idempotency_key)
  values
    (p_user_id, p_complimentary_tier, v_amount, v_month_key, v_idem_key);

  -- 10. Log to edge_transactions for full audit trail
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

  return query select true, null, null, v_amount, v_amount, false;
end;
$$;

-- Grant execute to service role only (Cloudflare Worker)
grant execute on function public.grant_complimentary_allocation(uuid, text)
  to service_role;
revoke execute on function public.grant_complimentary_allocation(uuid, text)
  from public, anon;

-- ── 5. Protect admin-only columns from client UPDATE ───────────────────────
-- The existing profiles_self_update policy allows users to update their own
-- profile row. This is needed for username, bio, avatar, etc.
-- However, it also allows modifying admin-only fields like admin_tier_override
-- and now complimentary_tier fields.
--
-- Solution: REVOKE column-level UPDATE privileges on admin-only fields.
-- The service_role bypasses RLS and is unaffected.
-- Authenticated users retain UPDATE on all other columns.

-- First ensure the table owner is postgres (standard Supabase setup)
-- Then revoke UPDATE on specific columns from authenticated and anon roles

revoke update (complimentary_tier) on public.profiles from authenticated, anon;
revoke update (complimentary_tier_expires_at) on public.profiles from authenticated, anon;
revoke update (complimentary_tier_granted_at) on public.profiles from authenticated, anon;
revoke update (complimentary_tier_note) on public.profiles from authenticated, anon;

-- Also protect existing admin fields (defense in depth)
revoke update (admin_tier_override) on public.profiles from authenticated, anon;
revoke update (admin_tier_expires_at) on public.profiles from authenticated, anon;
revoke update (admin_tier_note) on public.profiles from authenticated, anon;
revoke update (is_admin) on public.profiles from authenticated, anon;
revoke update (subscription_tier) on public.profiles from authenticated, anon;

-- Note: The service_role bypasses RLS and is not affected by column-level
-- revokes. The worker uses service_role for all mutations on these fields.
-- Supabase dashboard admins operate as the postgres superuser, also unaffected.
