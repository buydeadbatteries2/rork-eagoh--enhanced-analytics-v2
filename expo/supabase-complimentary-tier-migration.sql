-- ──────────────────────────────────────────────────────────────────────────
-- COMPLIMENTARY TIER ACCESS — Migration (v3 — security hardened)
-- Adds admin-controlled complimentary Pro/Oracle Elite access to profiles.
-- Managed directly from Supabase Dashboard (public.profiles).
-- Does NOT change existing subscription_tier values or RevenueCat logic.
--
-- SECURITY FIXES in v3:
--   1. Removed update_own_edge_balances — generic arbitrary-value setter (CRITICAL)
--   2. Removed update_own_verification_status — client self-verification (CRITICAL)
--   3. Added spend_own_edge — operation-specific deduction RPC (server calculates balances)
--   4. Added grant_purchased_edge — operation-specific purchase credit RPC
--   5. Added apply_free_tier_allocation — server-validated free-tier monthly grant
--   6. update_own_safe_profile returns explicit safe fields only (no returning *)
--   7. Preserved: grant_complimentary_allocation paid-tier priority comparison
--   8. Preserved: table-level UPDATE revoke from authenticated/anon
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

-- ── 4. Atomic complimentary allocation RPC (UNCHANGED from v2) ─────────────
-- SECURITY DEFINER: runs as function owner (service_role).
--
-- Compares the paid subscription_tier priority with the complimentary tier
-- priority. It only grants the complimentary allocation when the complimentary
-- tier is STRICTLY HIGHER than the paid tier.
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

grant execute on function public.grant_complimentary_allocation(uuid, text)
  to service_role;
revoke execute on function public.grant_complimentary_allocation(uuid, text)
  from public, anon, authenticated;

-- ── 5. Safe profile-update RPC (FIXED — explicit safe return fields) ───────
-- SECURITY DEFINER RPC for normal profile editing.
-- Only accepts user-editable fields. Never touches admin, complimentary,
-- subscription_tier, edge balance, or verification fields.
--
-- FIX in v3: Returns only explicit safe fields via jsonb_build_object.
--            No `returning *` or `to_jsonb(full_profile_row)`.

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
  v_safe      record;
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
  where id = p_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Profile not found');
  end if;

  -- Re-select ONLY safe fields (never returning * or internal columns)
  select
    username, display_name, bio, avatar_url, banner_url,
    public_display_title, selected_labs, selected_eagohs,
    preferences, public_profile_enabled, show_social_accounts,
    show_credentials, show_public_eagohs, show_faction,
    updated_at
  into v_safe
  from profiles
  where id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'profile', jsonb_build_object(
      'username', v_safe.username,
      'display_name', v_safe.display_name,
      'bio', v_safe.bio,
      'avatar_url', v_safe.avatar_url,
      'banner_url', v_safe.banner_url,
      'public_display_title', v_safe.public_display_title,
      'selected_labs', v_safe.selected_labs,
      'selected_eagohs', v_safe.selected_eagohs,
      'preferences', v_safe.preferences,
      'public_profile_enabled', v_safe.public_profile_enabled,
      'show_social_accounts', v_safe.show_social_accounts,
      'show_credentials', v_safe.show_credentials,
      'show_public_eagohs', v_safe.show_public_eagohs,
      'show_faction', v_safe.show_faction,
      'updated_at', v_safe.updated_at
    )
  );
end;
$$;

grant execute on function public.update_own_safe_profile(uuid, jsonb)
  to authenticated;
revoke execute on function public.update_own_safe_profile(uuid, jsonb)
  from anon;

-- ── 6. spend_own_edge — operation-specific deduction RPC (NEW) ─────────────
-- SECURITY DEFINER RPC for neuron spending.
--
-- The client sends the requested amount and reason. The server:
--   1. Locks the profile row FOR UPDATE
--   2. Verifies auth.uid() = p_user_id
--   3. Validates amount > 0 and sufficient balance
--   4. Deducts subscription bucket first, purchased bucket second
--   5. Inserts an edge_transactions audit row
--   6. Returns the new balances
--
-- The client NEVER sends final balance values. The server computes them.

create or replace function public.spend_own_edge(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile       record;
  v_cost          integer;
  v_total         integer;
  v_sub           integer;
  v_purchased     integer;
  v_from_sub      integer;
  v_from_purch    integer;
  v_next_sub      integer;
  v_next_purch    integer;
begin
  -- 1. Verify caller is the profile owner
  if auth.uid() is null or auth.uid() <> p_user_id then
    return jsonb_build_object('ok', false, 'error', 'Not authorized');
  end if;

  -- 2. Validate amount
  v_cost := coalesce(p_amount, 0);
  if v_cost <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Amount must be positive');
  end if;

  -- 3. Validate reason is non-empty
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'error', 'Reason is required');
  end if;

  -- 4. Lock the profile row and read balances
  select edge_subscription, edge_purchased
    into v_profile
  from profiles
  where id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Profile not found');
  end if;

  v_sub := coalesce(v_profile.edge_subscription, 0);
  v_purchased := coalesce(v_profile.edge_purchased, 0);
  v_total := v_sub + v_purchased;

  -- 5. Check sufficient balance
  if v_cost > v_total then
    return jsonb_build_object('ok', false, 'error', 'Insufficient Neuron balance');
  end if;

  -- 6. Deduct: subscription first, purchased second
  v_from_sub := least(v_sub, v_cost);
  v_from_purch := v_cost - v_from_sub;
  v_next_sub := v_sub - v_from_sub;
  v_next_purch := v_purchased - v_from_purch;

  -- 7. Update balances
  update profiles set
    edge_subscription = v_next_sub,
    edge_purchased = v_next_purch,
    updated_at = now()
  where id = p_user_id;

  -- 8. Insert audit transaction row
  insert into edge_transactions
    (user_id, kind, reason, amount, bucket,
     from_subscription, from_purchased,
     balance_subscription_after, balance_purchased_after,
     note)
  values
    (p_user_id, 'deduction', p_reason, v_cost,
     case when v_from_sub > 0 and v_from_purch > 0 then 'mixed'
          when v_from_purch > 0 then 'purchased'
          else 'subscription' end,
     v_from_sub, v_from_purch,
     v_next_sub, v_next_purch,
     p_note);

  -- 9. Return new balances (NOT the full profile)
  return jsonb_build_object(
    'ok', true,
    'new_subscription', v_next_sub,
    'new_purchased', v_next_purch,
    'from_subscription', v_from_sub,
    'from_purchased', v_from_purch
  );
end;
$$;

grant execute on function public.spend_own_edge(uuid, integer, text, text)
  to authenticated;
revoke execute on function public.spend_own_edge(uuid, integer, text, text)
  from anon;

-- ── 7. grant_purchased_edge — neuron purchase credit RPC (NEW) ─────────────
-- SECURITY DEFINER RPC for crediting purchased neurons after a verified
-- RevenueCat/App Store purchase.
--
-- The client sends the amount (from the known pack size) and a note.
-- The server:
--   1. Locks the profile row FOR UPDATE
--   2. Verifies auth.uid() = p_user_id
--   3. Validates amount > 0
--   4. Adds to edge_purchased (NEVER touches edge_subscription)
--   5. Inserts an edge_transactions audit row
--   6. Returns the new balances

create or replace function public.grant_purchased_edge(
  p_user_id uuid,
  p_amount integer,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile     record;
  v_add         integer;
  v_purchased   integer;
  v_sub         integer;
  v_next_purch  integer;
begin
  -- 1. Verify caller is the profile owner
  if auth.uid() is null or auth.uid() <> p_user_id then
    return jsonb_build_object('ok', false, 'error', 'Not authorized');
  end if;

  -- 2. Validate amount
  v_add := coalesce(p_amount, 0);
  if v_add <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Amount must be positive');
  end if;

  -- 3. Lock the profile row and read balances
  select edge_subscription, edge_purchased
    into v_profile
  from profiles
  where id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Profile not found');
  end if;

  v_sub := coalesce(v_profile.edge_subscription, 0);
  v_purchased := coalesce(v_profile.edge_purchased, 0);
  v_next_purch := v_purchased + v_add;

  -- 4. Update purchased balance (subscription balance is NEVER touched)
  update profiles set
    edge_purchased = v_next_purch,
    updated_at = now()
  where id = p_user_id;

  -- 5. Insert audit transaction row
  insert into edge_transactions
    (user_id, kind, reason, amount, bucket,
     from_subscription, from_purchased,
     balance_subscription_after, balance_purchased_after,
     note)
  values
    (p_user_id, 'purchase', 'purchase', v_add, 'purchased',
     0, 0,
     v_sub, v_next_purch,
     coalesce(p_note, 'Neuron purchase'));

  -- 6. Return new balances
  return jsonb_build_object(
    'ok', true,
    'new_subscription', v_sub,
    'new_purchased', v_next_purch
  );
end;
$$;

grant execute on function public.grant_purchased_edge(uuid, integer, text)
  to authenticated;
revoke execute on function public.grant_purchased_edge(uuid, integer, text)
  from anon;

-- ── 8. apply_free_tier_allocation — server-validated monthly grant (NEW) ───
-- SECURITY DEFINER RPC for the free-tier monthly 25-Neuron allocation.
--
-- The server:
--   1. Locks the profile row FOR UPDATE
--   2. Verifies auth.uid() = p_user_id
--   3. Verifies the effective tier is actually free (server-side check)
--      — checks subscription_tier, admin_tier_override, complimentary_tier
--   4. Checks monthly idempotency (last_rollover_at month vs current month)
--   5. Sets edge_subscription = 25 (no rollover for free tier)
--   6. Updates last_rollover_at and last_allocation
--   7. Inserts an edge_transactions audit row
--   8. Returns the new balances
--
-- A modified client CANNOT:
--   - Call this when they have a paid subscription (server checks)
--   - Choose the allocation amount (server hardcodes 25)
--   - Bypass the monthly idempotency check (server checks)
--   - Touch purchased neurons (RPC never modifies edge_purchased)

create or replace function public.apply_free_tier_allocation(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile          record;
  v_paid_tier        text;
  v_paid_priority    integer;
  v_admin_tier       text;
  v_admin_expires    timestamptz;
  v_admin_priority   integer;
  v_comp_tier        text;
  v_comp_expires     timestamptz;
  v_comp_priority    integer;
  v_effective_max    integer;
  v_amount           integer;
  v_last_rollover    timestamptz;
  v_last_month       text;
  v_current_month    text;
  v_purchased        integer;
begin
  -- 1. Verify caller is the profile owner
  if auth.uid() is null or auth.uid() <> p_user_id then
    return jsonb_build_object('ok', false, 'error', 'Not authorized');
  end if;

  -- 2. Lock the profile row and read all tier-relevant fields
  select subscription_tier, admin_tier_override, admin_tier_expires_at,
         complimentary_tier, complimentary_tier_expires_at,
         edge_subscription, edge_purchased,
         last_rollover_at, last_allocation
    into v_profile
  from profiles
  where id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Profile not found');
  end if;

  v_purchased := coalesce(v_profile.edge_purchased, 0);

  -- 3. Compute effective tier priority (server-side, never trusts client)
  v_paid_tier := coalesce(v_profile.subscription_tier, 'free');
  if v_paid_tier not in ('free', 'pro', 'oracle_elite', 'syndicate') then
    v_paid_tier := 'free';
  end if;
  v_paid_priority := case v_paid_tier
    when 'free' then 0 when 'pro' then 1
    when 'oracle_elite' then 2 when 'syndicate' then 3 else 0 end;

  -- Check admin override
  v_admin_tier := v_profile.admin_tier_override;
  v_admin_priority := 0;
  if v_admin_tier is not null and v_admin_tier in ('free','pro','oracle_elite','syndicate') then
    v_admin_expires := v_profile.admin_tier_expires_at;
    if v_admin_expires is null or v_admin_expires > now() then
      v_admin_priority := case v_admin_tier
        when 'free' then 0 when 'pro' then 1
        when 'oracle_elite' then 2 when 'syndicate' then 3 else 0 end;
    end if;
  end if;

  -- Check complimentary tier
  v_comp_tier := v_profile.complimentary_tier;
  v_comp_priority := 0;
  if v_comp_tier is not null and v_comp_tier in ('pro','oracle_elite') then
    v_comp_expires := v_profile.complimentary_tier_expires_at;
    if v_comp_expires is null or v_comp_expires > now() then
      v_comp_priority := case v_comp_tier
        when 'pro' then 1 when 'oracle_elite' then 2 else 0 end;
    end if;
  end if;

  -- Effective priority = max of all sources
  v_effective_max := greatest(v_paid_priority, v_admin_priority, v_comp_priority);

  -- 4. Refuse if the user is NOT free tier
  if v_effective_max > 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Paid tier allocations are handled by the backend'
    );
  end if;

  -- 5. Monthly idempotency check
  v_last_rollover := v_profile.last_rollover_at;
  if v_last_rollover is not null then
    v_last_month := to_char(v_last_rollover at time zone 'UTC', 'YYYY-MM');
    v_current_month := to_char(now() at time zone 'UTC', 'YYYY-MM');
    if v_last_month = v_current_month then
      -- Already allocated this month — return current balances
      return jsonb_build_object(
        'ok', true,
        'already_allocated', true,
        'new_subscription', coalesce(v_profile.edge_subscription, 0),
        'new_purchased', v_purchased,
        'last_rollover_at', v_last_rollover::text,
        'last_allocation', coalesce(v_profile.last_allocation, 0)
      );
    end if;
  end if;

  -- 6. Grant free-tier allocation (hardcoded 25, no rollover)
  v_amount := 25;

  update profiles set
    edge_subscription = v_amount,
    last_rollover_at = now(),
    last_allocation = v_amount,
    updated_at = now()
  where id = p_user_id;

  -- 7. Insert audit transaction row
  insert into edge_transactions
    (user_id, kind, reason, amount, bucket,
     from_subscription, from_purchased,
     balance_subscription_after, balance_purchased_after,
     note)
  values
    (p_user_id, 'addition', 'subscription_allocation', v_amount, 'subscription',
     0, 0,
     v_amount, v_purchased,
     'Free tier monthly allocation (' || v_amount || ' Neurons, no rollover)');

  -- 8. Return new balances
  return jsonb_build_object(
    'ok', true,
    'already_allocated', false,
    'new_subscription', v_amount,
    'new_purchased', v_purchased,
    'last_rollover_at', now()::text,
    'last_allocation', v_amount
  );
end;
$$;

grant execute on function public.apply_free_tier_allocation(uuid)
  to authenticated;
revoke execute on function public.apply_free_tier_allocation(uuid)
  from anon;

-- ── 9. Drop unsafe RPCs from v2 ────────────────────────────────────────────
--
-- update_own_edge_balances was a generic arbitrary-value setter that allowed
-- any authenticated user to set edge_subscription and edge_purchased to any
-- value. Removed in v3 — replaced by operation-specific RPCs above.
--
-- update_own_verification_status allowed any authenticated user to set
-- is_social_verified = true and choose any platform. Removed in v3 —
-- verification status is only written by the secure Worker or service-role
-- processes.

drop function if exists public.update_own_edge_balances(uuid, jsonb);
drop function if exists public.update_own_verification_status(uuid, boolean, text);

-- ── 10. Revoke table-level UPDATE on profiles ──────────────────────────────
--
-- After dropping the generic RPCs, authenticated users have NO path to
-- directly UPDATE the profiles table. All mutations go through:
--   - update_own_safe_profile (cosmetic fields only)
--   - spend_own_edge (deduction, server-computed balances)
--   - grant_purchased_edge (purchase credit, server-computed balances)
--   - apply_free_tier_allocation (free monthly grant, server-validated)
--
-- Admin/complimentary/subscription_tier/verification fields are NEVER
-- writable by authenticated users through any RPC.
--
-- Service-role Worker and Supabase Dashboard admins bypass RLS.

revoke update on public.profiles from authenticated, anon;

-- The profiles_self_update RLS policy is now moot (no UPDATE privilege to check
-- against), but we leave it in place — it is harmless and provides defense in
-- depth if table-level UPDATE is ever re-granted in the future.

-- Note:
--   - SELECT and INSERT privileges on profiles are NOT revoked.
--   - The profiles_self_select and profiles_self_insert RLS policies still work.
--   - ensureProfile() (INSERT) continues to work normally.
--   - The handle_new_user() trigger is SECURITY DEFINER and unaffected.
