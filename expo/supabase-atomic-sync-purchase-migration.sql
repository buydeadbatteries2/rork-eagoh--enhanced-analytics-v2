-- =============================================================================
-- Atomic Exchange Sync Purchase RPC Migration
--
-- Makes the Exchange sync purchase transaction fully atomic:
--   buyer deduction + vendor credit + purchase insert happen in ONE transaction.
-- If any step fails, the entire transaction rolls back — zero neurons charged,
-- zero vendor credits, zero purchase rows.
--
-- The client NEVER directly deducts neurons, credits the vendor, or inserts
-- a purchase row. Everything goes through this RPC via the secure worker.
--
-- Adds:
--   1. idempotency_key column on marketplace_sync_purchases
--   2. Partial unique index on idempotency_key (active purchases only)
--   3. purchase_marketplace_sync_atomic() — single-transaction RPC
-- =============================================================================

-- ── 1. Add idempotency_key column ──
alter table public.marketplace_sync_purchases
  add column if not exists idempotency_key text;

-- ── 2. Partial unique index (only active purchases) ──
-- Prevents duplicate active purchases from retries/double-taps.
-- Expired/inactive purchases don't block new purchases with the same key.
create unique index if not exists msp_idempotency_key_idx
  on public.marketplace_sync_purchases(idempotency_key)
  where idempotency_key is not null and active = true;

-- =============================================================================
-- Atomic Sync Purchase RPC
-- =============================================================================
-- Does everything in one PostgreSQL transaction:
--   1. Idempotency check (return existing if key matches active purchase)
--   2. Validate sync_level (25%/50%/75%/100%)
--   3. Validate days (1-5)
--   4. Validate and lock listing (FOR UPDATE)
--   5. Validate buyer != vendor
--   6. Calculate price SERVER-SIDE from listing's price columns
--   7. Lock buyer profile row (FOR UPDATE)
--   8. Verify sufficient neurons
--   9. Deduct buyer neurons (subscription first, purchased second)
--  10. Log buyer deduction in edge_transactions
--  11. Lock vendor profile row (FOR UPDATE) and credit neurons
--  12. Log vendor credit in edge_transactions
--  13. Insert marketplace_sync_purchases record
--  14. Update marketplace_vendor_stats (incremental)
--
-- If ANY step fails, the entire transaction rolls back.
-- No state can exist where buyer was charged but vendor was not credited,
-- vendor was credited but no purchase record exists, or a purchase exists
-- without successful payment.
-- =============================================================================

create or replace function public.purchase_marketplace_sync_atomic(
  p_buyer_id uuid,
  p_listing_id uuid,
  p_sync_level text,
  p_days int,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing record;
  v_buyer record;
  v_vendor record;
  v_price_per_day int;
  v_total_cost int;
  v_from_sub int;
  v_from_purchased int;
  v_next_sub int;
  v_next_purchased int;
  v_vendor_new_sub int;
  v_vendor_new_purch int;
  v_started_at timestamptz := now();
  v_expires_at timestamptz;
  v_purchase_id uuid;
  v_buyer_display_name text;
  v_buyer_avatar_url text;
  v_existing_purchase record;
begin
  -- ── 1. Idempotency check ──
  if p_idempotency_key is not null then
    select id, listing_id, buyer_id, vendor_id, eagoh_id, sync_level, days,
           edge_cost, started_at, expires_at, active, created_at,
           buyer_display_name, buyer_avatar_url, purchase_status
    into v_existing_purchase
    from public.marketplace_sync_purchases
    where idempotency_key = p_idempotency_key
      and buyer_id = p_buyer_id
      and active = true
    limit 1;
    if found then
      return jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'purchase', to_jsonb(v_existing_purchase)
      );
    end if;
  end if;

  -- ── 2. Validate sync_level ──
  if p_sync_level not in ('25%', '50%', '75%', '100%') then
    return jsonb_build_object('ok', false, 'error', 'Invalid sync level.');
  end if;

  -- ── 3. Validate days ──
  if p_days < 1 or p_days > 5 then
    return jsonb_build_object('ok', false, 'error', 'Duration must be between 1 and 5 days.');
  end if;

  -- ── 4. Validate and lock listing ──
  select id, vendor_id, eagoh_id, active,
         price_25_per_day, price_50_per_day, price_75_per_day, price_100_per_day
  into v_listing
  from public.marketplace_listings
  where id = p_listing_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Listing not found.');
  end if;

  if not v_listing.active then
    return jsonb_build_object('ok', false, 'error', 'This listing is no longer active.');
  end if;

  -- ── 5. Validate buyer != vendor ──
  if v_listing.vendor_id = p_buyer_id then
    return jsonb_build_object('ok', false, 'error',
      'SELF_PURCHASE_NOT_ALLOWED: You cannot purchase your own EAGOH listing.');
  end if;

  -- ── 6. Calculate price server-side ──
  v_price_per_day := case p_sync_level
    when '25%' then v_listing.price_25_per_day
    when '50%' then v_listing.price_50_per_day
    when '75%' then v_listing.price_75_per_day
    when '100%' then v_listing.price_100_per_day
  end;
  v_total_cost := v_price_per_day * p_days;
  if v_total_cost <= 0 then
    return jsonb_build_object('ok', false, 'error', 'This sync level has no price set.');
  end if;

  -- ── 7. Lock buyer profile row ──
  select edge_subscription, edge_purchased, username, avatar_url
  into v_buyer
  from public.profiles
  where id = p_buyer_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Buyer profile not found.');
  end if;

  -- ── 8. Verify sufficient neurons ──
  if coalesce(v_buyer.edge_subscription, 0) + coalesce(v_buyer.edge_purchased, 0) < v_total_cost then
    return jsonb_build_object('ok', false, 'error',
      'Insufficient Neurons. Need ' || v_total_cost || ' Neurons (have ' ||
      (coalesce(v_buyer.edge_subscription, 0) + coalesce(v_buyer.edge_purchased, 0)) || ').');
  end if;

  -- ── 9. Deduct buyer neurons (subscription first, purchased second) ──
  v_from_sub := least(coalesce(v_buyer.edge_subscription, 0), v_total_cost);
  v_from_purchased := v_total_cost - v_from_sub;
  v_next_sub := coalesce(v_buyer.edge_subscription, 0) - v_from_sub;
  v_next_purchased := coalesce(v_buyer.edge_purchased, 0) - v_from_purchased;

  update public.profiles
    set edge_subscription = v_next_sub,
        edge_purchased = v_next_purchased,
        updated_at = now()
    where id = p_buyer_id;

  -- ── 10. Log buyer deduction ──
  insert into public.edge_transactions (
    user_id, kind, reason, amount, bucket,
    from_subscription, from_purchased,
    balance_subscription_after, balance_purchased_after, note
  ) values (
    p_buyer_id, 'deduction', 'marketplace', v_total_cost,
    case when v_from_sub > 0 and v_from_purchased > 0 then 'mixed'
         when v_from_purchased > 0 then 'purchased'
         else 'subscription' end,
    v_from_sub, v_from_purchased,
    v_next_sub, v_next_purchased,
    'Sync purchase: ' || p_sync_level || ' for ' || p_days || ' day(s)'
  );

  -- ── 11. Lock vendor profile and credit ──
  select edge_subscription, edge_purchased
  into v_vendor
  from public.profiles
  where id = v_listing.vendor_id
  for update;

  if not found then
    -- Vendor profile missing — raise to roll back the entire transaction.
    -- The buyer must NOT be charged if the vendor cannot be credited.
    raise exception 'Vendor profile not found for vendor_id %', v_listing.vendor_id;
  end if;

  v_vendor_new_sub := coalesce(v_vendor.edge_subscription, 0) + v_total_cost;
  v_vendor_new_purch := coalesce(v_vendor.edge_purchased, 0);

  update public.profiles
    set edge_subscription = v_vendor_new_sub,
        updated_at = now()
    where id = v_listing.vendor_id;

  -- ── 12. Log vendor credit ──
  insert into public.edge_transactions (
    user_id, kind, reason, amount, bucket,
    from_subscription, from_purchased,
    balance_subscription_after, balance_purchased_after, note
  ) values (
    v_listing.vendor_id, 'addition', 'marketplace', v_total_cost,
    'subscription',
    0, 0,
    v_vendor_new_sub, v_vendor_new_purch,
    'Sync purchase from buyer (' || p_sync_level || ' for ' || p_days || ' day(s))'
  );

  -- ── 13. Insert purchase record ──
  v_expires_at := v_started_at + make_interval(days => p_days);
  v_buyer_display_name := v_buyer.username;
  v_buyer_avatar_url := v_buyer.avatar_url;

  insert into public.marketplace_sync_purchases (
    listing_id, buyer_id, vendor_id, eagoh_id,
    sync_level, days, edge_cost,
    started_at, expires_at, active,
    buyer_display_name, buyer_avatar_url,
    purchase_status, idempotency_key
  ) values (
    p_listing_id, p_buyer_id, v_listing.vendor_id, v_listing.eagoh_id,
    p_sync_level, p_days, v_total_cost,
    v_started_at, v_expires_at, true,
    v_buyer_display_name, v_buyer_avatar_url,
    'completed', p_idempotency_key
  )
  returning id into v_purchase_id;

  -- ── 14. Update vendor stats (incremental) ──
  insert into public.marketplace_vendor_stats (
    vendor_id, total_listings, active_listings,
    total_sales, total_edge_earned,
    edge_earned_this_month, edge_earned_last_month,
    month_key, sync_success_score, avg_quality_score, rank
  ) values (
    v_listing.vendor_id, 0, 0,
    1, v_total_cost,
    v_total_cost, 0,
    to_char(now(), 'YYYY-MM'), 0, 0, 'UNRANKED'
  )
  on conflict (vendor_id) do update
    set total_sales = marketplace_vendor_stats.total_sales + 1,
        total_edge_earned = marketplace_vendor_stats.total_edge_earned + v_total_cost,
        edge_earned_this_month = case
          when marketplace_vendor_stats.month_key = to_char(now(), 'YYYY-MM')
          then marketplace_vendor_stats.edge_earned_this_month + v_total_cost
          else v_total_cost
        end,
        month_key = to_char(now(), 'YYYY-MM'),
        updated_at = now();

  -- ── Return the completed purchase ──
  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'purchase', jsonb_build_object(
      'id', v_purchase_id,
      'listing_id', p_listing_id,
      'buyer_id', p_buyer_id,
      'vendor_id', v_listing.vendor_id,
      'eagoh_id', v_listing.eagoh_id,
      'sync_level', p_sync_level,
      'days', p_days,
      'edge_cost', v_total_cost,
      'started_at', v_started_at,
      'expires_at', v_expires_at,
      'active', true,
      'created_at', v_started_at,
      'buyer_display_name', v_buyer_display_name,
      'buyer_avatar_url', v_buyer_avatar_url,
      'purchase_status', 'completed'
    ),
    'new_balance', jsonb_build_object(
      'subscription', v_next_sub,
      'purchased', v_next_purchased,
      'total', v_next_sub + v_next_purchased
    )
  );

-- ── Any uncaught error: transaction rolls back automatically ──
-- No neurons deducted, no vendor credits, no purchase rows.
exception
  when others then
    return jsonb_build_object(
      'ok', false,
      'error', 'Purchase failed. No neurons were charged.',
      'detail', SQLERRM,
      'sqlstate', SQLSTATE
    );
end;
$$;

-- ── Permissions ──
-- This function is SECURITY DEFINER and accepts p_buyer_id as a parameter.
-- The client must NEVER be able to call this RPC directly — otherwise any
-- authenticated user could pass an arbitrary buyer_id and deduct neurons
-- from another user's balance.
--
-- The ONLY allowed path is:
--   App → authenticated /exchange/purchase Worker → service-role Supabase
--   client → purchase_marketplace_sync_atomic
--
-- PostgreSQL grants EXECUTE on functions to PUBLIC by default. We must
-- explicitly revoke that default privilege from PUBLIC, anon, and
-- authenticated, then grant ONLY to service_role.

revoke all on function public.purchase_marketplace_sync_atomic(
  uuid, uuid, text, int, text
) from public;

revoke all on function public.purchase_marketplace_sync_atomic(
  uuid, uuid, text, int, text
) from anon;

revoke all on function public.purchase_marketplace_sync_atomic(
  uuid, uuid, text, int, text
) from authenticated;

grant execute on function public.purchase_marketplace_sync_atomic(
  uuid, uuid, text, int, text
) to service_role;
