-- =============================================================================
-- Banner Atomic Purchase RPC Migration
--
-- This migration supersedes supabase-banner-multi-date-migration.sql.
-- It is fully idempotent — safe to run even if the prior migration was already run.
--
-- Adds:
--   1. booking_dates date[]  — exact list of booked promotion dates (nonconsecutive)
--   2. listing_id uuid       — links a banner to a specific Exchange listing
--   3. idempotency_key text   — prevents duplicate purchases from retries
--   4. purchase_banner_atomic() — single-transaction RPC: validates + deducts + inserts
--   5. refund_orphaned_banner_deductions() — refunds failed purchases
--
-- ALL operations (validation, neuron deduction, banner insert, purchase history,
-- edge transaction log) happen inside one PostgreSQL transaction. If any step
-- fails, the entire transaction rolls back — zero neurons deducted, zero banners
-- created. The client never directly deducts neurons or inserts banner rows.
-- =============================================================================

-- ── Ensure columns exist on sponsored_banners ──
alter table public.sponsored_banners
  add column if not exists booking_dates date[];

alter table public.sponsored_banners
  add column if not exists listing_id uuid;

alter table public.sponsored_banners
  add column if not exists idempotency_key text;

-- Foreign key for listing_id
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'sb_listing_id_fkey'
      and table_name = 'sponsored_banners'
      and table_schema = 'public'
  ) then
    alter table public.sponsored_banners
      add constraint sb_listing_id_fkey
      foreign key (listing_id) references public.marketplace_listings(id) on delete set null;
  end if;
end $$;

-- Unique index on idempotency_key — prevents duplicate banner creation
create unique index if not exists sb_idempotency_key_idx
  on public.sponsored_banners(idempotency_key)
  where idempotency_key is not null;

-- Index for listing_id lookups
create index if not exists sb_listing_id_idx on public.sponsored_banners(listing_id) where listing_id is not null;

-- GIN index for booking_dates array containment queries
create index if not exists sb_booking_dates_gin_idx
  on public.sponsored_banners using gin (booking_dates) where active = true;

-- ── Ensure columns exist on banner_purchases ──
alter table public.banner_purchases
  add column if not exists booking_dates date[];

alter table public.banner_purchases
  add column if not exists listing_id uuid;

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'bp_listing_id_fkey'
      and table_name = 'banner_purchases'
      and table_schema = 'public'
  ) then
    alter table public.banner_purchases
      add constraint bp_listing_id_fkey
      foreign key (listing_id) references public.marketplace_listings(id) on delete set null;
  end if;
end $$;

-- ── Backfill booking_dates for existing banners ──
update public.sponsored_banners
  set booking_dates = (
    select array_agg(d::date)
    from generate_series(
      start_date,
      end_date,
      interval '1 day'
    ) as d
  )
  where booking_dates is null
    and start_date is not null
    and end_date is not null;

update public.banner_purchases
  set booking_dates = (
    select array_agg(d::date)
    from generate_series(
      start_date,
      (start_date::date + (days - 1))::date,
      interval '1 day'
    ) as d
  )
  where booking_dates is null
    and start_date is not null
    and days is not null;

-- =============================================================================
-- Atomic Banner Purchase RPC
-- =============================================================================
-- Does everything in one transaction:
--   1. Idempotency check (return original result if duplicate key)
--   2. Validate location, dates (1-5, no past/today in ET, no duplicates)
--   3. Server-side cost calculation
--   4. Lock profile row (FOR UPDATE)
--   5. Resolve effective tier (admin override + dev_test_subscriptions)
--   6. Verify paid-tier eligibility
--   7. Verify EAGOH ownership
--   8. Verify listing ownership, active status, and EAGOH match
--   9. Check sufficient neuron balance
--  10. Insert banner row
--  11. Insert purchase history
--  12. Deduct neurons (subscription first, purchased second)
--  13. Insert edge_transaction ledger row
--
-- If ANY step fails, the entire transaction rolls back.
-- The client never directly deducts neurons or inserts banner rows.
-- =============================================================================

create or replace function public.purchase_banner_atomic(
  p_user_id uuid,
  p_eagoh_id uuid,
  p_location text,
  p_booking_dates date[],
  p_listing_id uuid,
  p_colored_border boolean default false,
  p_hot_badge boolean default false,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer
as $$
declare
  v_today_et date;
  v_day_count int;
  v_sorted_dates date[];
  v_d date;
  v_base_cost int;
  v_border_cost int;
  v_hot_cost int;
  v_edge_cost int;
  v_profile record;
  v_real_tier text;
  v_dev_test_tier text;
  v_effective_tier text;
  v_eagoh record;
  v_listing record;
  v_banner_id uuid;
  v_from_sub int;
  v_from_purchased int;
  v_next_sub int;
  v_next_purchased int;
  v_current_priority int;
  v_dev_priority int;
  v_existing_banner record;
begin
  -- ── Idempotency check: return original result if key already exists ──
  if p_idempotency_key is not null then
    select id, edge_cost into v_existing_banner
    from public.sponsored_banners
    where idempotency_key = p_idempotency_key
      and purchaser_id = p_user_id
    limit 1;
    if found then
      return jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'banner_id', v_existing_banner.id,
        'edge_cost', v_existing_banner.edge_cost
      );
    end if;
  end if;

  -- ── Validate location ──
  if p_location not in ('home', 'marketplace') then
    return jsonb_build_object('ok', false, 'error', 'Invalid banner location.');
  end if;

  -- ── Validate dates ──
  if p_booking_dates is null or array_length(p_booking_dates, 1) is null then
    return jsonb_build_object('ok', false, 'error', 'Select at least one promotion date.');
  end if;

  v_day_count := array_length(p_booking_dates, 1);
  if v_day_count > 5 then
    return jsonb_build_object('ok', false, 'error', 'You can select up to 5 promotion dates.');
  end if;

  -- Sort and deduplicate dates
  v_sorted_dates := array(
    select distinct d from unnest(p_booking_dates) as d order by d
  );
  if array_length(v_sorted_dates, 1) <> v_day_count then
    return jsonb_build_object('ok', false, 'error', 'Duplicate dates detected.');
  end if;

  -- Get today's date in America/New_York
  v_today_et := (now() AT TIME ZONE 'America/New_York')::date;

  -- Check no date is today or in the past (ET)
  foreach v_d in array v_sorted_dates loop
    if v_d <= v_today_et then
      return jsonb_build_object('ok', false, 'error', 'Past dates are not selectable.');
    end if;
  end loop;

  -- ── Server-side cost calculation ──
  v_base_cost := case when p_location = 'home' then 250 else 150 end * v_day_count;
  v_border_cost := case when p_colored_border then 10 * v_day_count else 0 end;
  v_hot_cost := case when p_hot_badge then 15 * v_day_count else 0 end;
  v_edge_cost := v_base_cost + v_border_cost + v_hot_cost;

  -- ── Lock profile row and check balance ──
  select subscription_tier, edge_subscription, edge_purchased,
         admin_tier_override, admin_tier_expires_at
  into v_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Profile not found.');
  end if;

  -- ── Resolve effective tier ──
  v_real_tier := coalesce(v_profile.subscription_tier, 'free');
  v_effective_tier := v_real_tier;

  -- Check admin override
  if v_profile.admin_tier_override is not null then
    if v_profile.admin_tier_expires_at is null
       or v_profile.admin_tier_expires_at > now() then
      v_effective_tier := v_profile.admin_tier_override;
    end if;
  end if;

  -- Check dev test subscriptions (Expo Go / Rork testing)
  -- In production this table is empty — safe to always check.
  select test_tier into v_dev_test_tier
  from public.dev_test_subscriptions
  where user_id = p_user_id
    and (expires_at is null or expires_at > now())
  limit 1;

  if v_dev_test_tier is not null then
    v_current_priority := case v_effective_tier
      when 'free' then 0
      when 'pro' then 1
      when 'oracle_elite' then 2
      when 'syndicate' then 3
      else 0
    end;
    v_dev_priority := case v_dev_test_tier
      when 'free' then 0
      when 'pro' then 1
      when 'oracle_elite' then 2
      when 'syndicate' then 3
      else 0
    end;
    if v_dev_priority > v_current_priority then
      v_effective_tier := v_dev_test_tier;
    end if;
  end if;

  if v_effective_tier = 'free' then
    return jsonb_build_object('ok', false, 'error',
      'Upgrade to Pro or higher to promote your EAGOH with sponsored banners.');
  end if;

  -- ── Verify EAGOH ownership ──
  select id into v_eagoh from public.eagohs where id = p_eagoh_id and user_id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'This EAGOH does not belong to your account.');
  end if;

  -- ── Validate listing ──
  if p_listing_id is null then
    return jsonb_build_object('ok', false, 'error', 'Enter a valid EAGOH Exchange listing link.');
  end if;

  select id, vendor_id, active, eagoh_id into v_listing
  from public.marketplace_listings
  where id = p_listing_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Enter a valid EAGOH Exchange listing link.');
  end if;
  if v_listing.vendor_id <> p_user_id then
    return jsonb_build_object('ok', false, 'error', 'This listing does not belong to your account.');
  end if;
  if not v_listing.active then
    return jsonb_build_object('ok', false, 'error', 'This Exchange listing is not currently active.');
  end if;
  -- Verify listing matches the selected EAGOH
  if v_listing.eagoh_id <> p_eagoh_id then
    return jsonb_build_object('ok', false, 'error', 'This listing does not match the selected EAGOH.');
  end if;

  -- ── Check sufficient balance ──
  if coalesce(v_profile.edge_subscription, 0) + coalesce(v_profile.edge_purchased, 0) < v_edge_cost then
    return jsonb_build_object('ok', false, 'error',
      'Insufficient Neurons. ' || v_edge_cost || ' Neurons required.');
  end if;

  -- ── Compute deduction split (subscription first, purchased second) ──
  v_from_sub := least(coalesce(v_profile.edge_subscription, 0), v_edge_cost);
  v_from_purchased := v_edge_cost - v_from_sub;
  v_next_sub := coalesce(v_profile.edge_subscription, 0) - v_from_sub;
  v_next_purchased := coalesce(v_profile.edge_purchased, 0) - v_from_purchased;

  -- ── Insert banner row ──
  insert into public.sponsored_banners (
    purchaser_id, eagoh_id, location,
    start_date, end_date,
    booking_dates, listing_id,
    colored_border, hot_badge, edge_cost, active,
    idempotency_key
  ) values (
    p_user_id, p_eagoh_id, p_location,
    v_sorted_dates[1], v_sorted_dates[array_length(v_sorted_dates, 1)],
    v_sorted_dates, p_listing_id,
    p_colored_border, p_hot_badge, v_edge_cost, true,
    p_idempotency_key
  )
  returning id into v_banner_id;

  -- ── Insert purchase history ──
  insert into public.banner_purchases (
    user_id, banner_id, eagoh_id, location,
    start_date, days,
    booking_dates, listing_id,
    colored_border, hot_badge, edge_cost
  ) values (
    p_user_id, v_banner_id, p_eagoh_id, p_location,
    v_sorted_dates[1], v_day_count,
    v_sorted_dates, p_listing_id,
    p_colored_border, p_hot_badge, v_edge_cost
  );

  -- ── Deduct neurons ──
  update public.profiles
    set edge_subscription = v_next_sub,
        edge_purchased = v_next_purchased,
        updated_at = now()
    where id = p_user_id;

  -- ── Log the edge transaction ──
  insert into public.edge_transactions (
    user_id, kind, reason, amount, bucket,
    from_subscription, from_purchased,
    balance_subscription_after, balance_purchased_after, note
  ) values (
    p_user_id, 'deduction', 'sponsored_banner', v_edge_cost,
    case when v_from_sub > 0 and v_from_purchased > 0 then 'mixed'
         when v_from_purchased > 0 then 'purchased'
         else 'subscription' end,
    v_from_sub, v_from_purchased,
    v_next_sub, v_next_purchased,
    p_location || ' banner ' || v_day_count || ' date(s) ' || array_to_string(v_sorted_dates, ',')
  );

  return jsonb_build_object(
    'ok', true,
    'banner_id', v_banner_id,
    'edge_cost', v_edge_cost,
    'day_count', v_day_count,
    'new_balance', jsonb_build_object(
      'subscription', v_next_sub,
      'purchased', v_next_purchased,
      'total', v_next_sub + v_next_purchased
    )
  );

-- ── Any uncaught error: transaction rolls back automatically ──
-- No neurons deducted, no banner rows created.
exception
  when others then
    return jsonb_build_object(
      'ok', false,
      'error', 'Banner purchase failed. No neurons were charged.',
      'detail', SQLERRM,
      'sqlstate', SQLSTATE
    );
end;
$$;

-- Grant execute to authenticated users (service_role bypasses all checks)
grant execute on function public.purchase_banner_atomic(
  uuid, uuid, text, date[], uuid, boolean, boolean, text
) to authenticated, anon;

-- =============================================================================
-- Orphaned Banner Deduction Refund Function
-- =============================================================================
-- Finds all sponsored_banner deductions in edge_transactions for a user where
-- no corresponding banner row was created (within 60 seconds of the deduction).
-- Refunds each orphaned deduction exactly once with an auditable ledger entry.
--
-- This is safe to run multiple times — it skips deductions that already have
-- a matching refund entry.
-- =============================================================================

create or replace function public.refund_orphaned_banner_deductions(
  p_user_id uuid
) returns jsonb
language plpgsql security definer
as $$
declare
  v_refund_count int := 0;
  v_refund_total int := 0;
  v_tx record;
  v_current_sub int;
  v_current_purch int;
begin
  for v_tx in
    select et.id as tx_id, et.amount, et.created_at, et.note
    from public.edge_transactions et
    where et.user_id = p_user_id
      and et.reason = 'sponsored_banner'
      and et.kind = 'deduction'
      and not exists (
        -- No banner was created within 60 seconds of this deduction
        select 1 from public.sponsored_banners sb
        where sb.purchaser_id = p_user_id
          and sb.edge_cost = et.amount
          and sb.created_at between et.created_at - interval '60 seconds'
                                 and et.created_at + interval '60 seconds'
      )
      and not exists (
        -- No refund has already been issued for this deduction
        select 1 from public.edge_transactions refund
        where refund.user_id = p_user_id
          and refund.reason = 'sponsored_banner'
          and refund.kind = 'addition'
          and refund.note like '%BANNER REFUND%'
          and refund.amount = et.amount
          and refund.created_at > et.created_at
      )
    order by et.created_at
  loop
    -- Lock profile row
    select edge_subscription, edge_purchased into v_current_sub, v_current_purch
    from public.profiles where id = p_user_id for update;

    -- Refund to subscription bucket
    update public.profiles
      set edge_subscription = coalesce(edge_subscription, 0) + v_tx.amount,
          updated_at = now()
      where id = p_user_id;

    -- Log the refund with full audit trail
    insert into public.edge_transactions (
      user_id, kind, reason, amount, bucket,
      from_subscription, from_purchased,
      balance_subscription_after, balance_purchased_after, note
    ) values (
      p_user_id, 'addition', 'sponsored_banner', v_tx.amount, 'subscription',
      0, 0,
      coalesce(v_current_sub, 0) + v_tx.amount, coalesce(v_current_purch, 0),
      'BANNER REFUND — orphaned deduction (tx:' || v_tx.tx_id || ', original_note:' || coalesce(v_tx.note, '') || ')'
    );

    v_refund_count := v_refund_count + 1;
    v_refund_total := v_refund_total + v_tx.amount;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'refunds', v_refund_count,
    'total_refunded', v_refund_total
  );
end;
$$;

grant execute on function public.refund_orphaned_banner_deductions(
  uuid
) to authenticated, anon;
