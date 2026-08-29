-- =============================================================================
-- Exchange Legacy Buyer-EAGOH Eligibility Fix (Phase D2.3M)
--
-- Pinpointed in D2.3L: the live six-parameter purchase_marketplace_sync_atomic()
-- rejected LEGACY EAGOHs whose forge flags are NULL/NULL because the §7
-- not-user-forged check used:
--
--     coalesce(v_buyer_eagoh.is_user_forged, false) = false
--
-- which fabricated `false` for a NULL (legacy) forge flag. The approved rule
-- rejects only an EXPLICIT is_user_forged = false, preserving legacy NULL/NULL
-- rows (parity with the Worker's `row.is_user_forged === false` and the
-- client's `e.is_user_forged === false` in public-listing.tsx). This caused
-- every purchase attempt with a legacy EAGOH (e.g. "Bolt 4 Sports") to fail
-- with error=buyer_eagoh_not_eligible, reason=not_user_forged — before any
-- deduction (no balance impact at any point).
--
-- This migration recreates ONLY the existing six-parameter function via
-- CREATE OR REPLACE FUNCTION — identical signature, no drop, no new overload —
-- with the complete D2.2A body copied verbatim except the single corrected
-- expression in §7. All other behavior is byte-identical: SECURITY DEFINER,
-- SET search_path = '', schema qualification, idempotency, locks, server-owned
-- pricing, ownership checks, explicit default-shell / not-forged / dormant
-- rejections, domain normalization + equality, subscription-first deduction,
-- vendor credit, ledger entries, purchase insertion + buyer-EAGOH attribution,
-- vendor statistics, exception rollback, and result shapes.
--
-- Reruns are safe: CREATE OR REPLACE is idempotent, as are the permission
-- statements. SQL three-valued logic makes `NULL = false` → NULL → the IF
-- does not fire, so legacy NULL/NULL EAGOHs pass while NULL/false stays
-- rejected with reason='not_user_forged'.
-- =============================================================================

begin;

-- =============================================================================
-- Recreate the six-parameter atomic purchase RPC (identical signature)
-- =============================================================================

create or replace function public.purchase_marketplace_sync_atomic(
  p_buyer_id uuid,
  p_buyer_eagoh_id uuid,
  p_listing_id uuid,
  p_sync_level text,
  p_days integer,
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
  v_buyer_eagoh record;
  v_vendor_eagoh record;
  v_buyer_domain text;
  v_vendor_domain text;
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
    select id, listing_id, buyer_id, buyer_eagoh_id, vendor_id, eagoh_id,
           sync_level, days, edge_cost, started_at, expires_at, active,
           created_at, buyer_display_name, buyer_avatar_url, purchase_status
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

  -- ── 7. Buyer EAGOH: load + lock + validate (BEFORE any balance deduction) ──
  --       The database independently enforces ownership, eligibility,
  --       dormancy, and domain rules. The worker precheck is not the gate.
  if p_buyer_eagoh_id is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'buyer_eagoh_required',
      'message', 'A selected buyer EAGOH is required for every Exchange purchase.'
    );
  end if;

  select id, user_id, domain, sport, status, is_default_shell, is_user_forged
  into v_buyer_eagoh
  from public.eagohs
  where id = p_buyer_eagoh_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'buyer_eagoh_not_found',
      'buyer_eagoh_id', p_buyer_eagoh_id
    );
  end if;

  if v_buyer_eagoh.user_id is distinct from p_buyer_id then
    return jsonb_build_object(
      'ok', false,
      'error', 'buyer_eagoh_not_owned',
      'buyer_eagoh_id', p_buyer_eagoh_id,
      'message', 'The selected EAGOH does not belong to the purchasing account.'
    );
  end if;

  if v_buyer_eagoh.is_default_shell = true then
    return jsonb_build_object(
      'ok', false,
      'error', 'buyer_eagoh_not_eligible',
      'reason', 'default_shell',
      'buyer_eagoh_id', p_buyer_eagoh_id,
      'message', 'Default shell EAGOHs cannot purchase Exchange syncs.'
    );
  end if;

  if v_buyer_eagoh.is_default_shell is null
     and v_buyer_eagoh.is_user_forged = false then
    return jsonb_build_object(
      'ok', false,
      'error', 'buyer_eagoh_not_eligible',
      'reason', 'not_user_forged',
      'buyer_eagoh_id', p_buyer_eagoh_id,
      'message', 'Only user-forged EAGOHs can purchase Exchange syncs.'
    );
  end if;

  if v_buyer_eagoh.status = 'dormant' then
    return jsonb_build_object(
      'ok', false,
      'error', 'buyer_eagoh_not_eligible',
      'reason', 'dormant',
      'buyer_eagoh_id', p_buyer_eagoh_id,
      'message', 'Dormant EAGOHs cannot purchase Exchange syncs.'
    );
  end if;

  -- Usable domain: domain ?? sport (legacy fallback). Empty never qualifies.
  v_buyer_domain := nullif(
    btrim(coalesce(nullif(btrim(v_buyer_eagoh.domain), ''), v_buyer_eagoh.sport, '')),
    ''
  );

  if v_buyer_domain is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'buyer_eagoh_no_domain',
      'buyer_eagoh_id', p_buyer_eagoh_id,
      'message', 'The selected EAGOH has no intelligence domain.'
    );
  end if;

  -- ── 8. Vendor EAGOH: load + lock + validate ──
  select id, user_id, name, domain, sport, status
  into v_vendor_eagoh
  from public.eagohs
  where id = v_listing.eagoh_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'vendor_eagoh_not_found',
      'vendor_eagoh_id', v_listing.eagoh_id
    );
  end if;

  -- Ownership: the listing vendor must own the listed EAGOH. NULL-safe
  -- comparison (IS DISTINCT FROM) so NULL/missing ownership also fails.
  -- Checked before dormancy, domain, any balance deduction, vendor credit,
  -- ledger insertion, or purchase insertion. Raw user IDs are never
  -- returned in this error.
  if v_vendor_eagoh.user_id is distinct from v_listing.vendor_id then
    return jsonb_build_object(
      'ok', false,
      'error', 'vendor_eagoh_owner_mismatch',
      'message', 'The listing vendor does not own the listed EAGOH.'
    );
  end if;

  if v_vendor_eagoh.status = 'dormant' then
    return jsonb_build_object(
      'ok', false,
      'error', 'vendor_eagoh_dormant',
      'vendor_eagoh_id', v_listing.eagoh_id,
      'message', 'This listing belongs to a dormant EAGOH.'
    );
  end if;

  v_vendor_domain := nullif(
    btrim(coalesce(nullif(btrim(v_vendor_eagoh.domain), ''), v_vendor_eagoh.sport, '')),
    ''
  );

  if v_vendor_domain is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'vendor_eagoh_no_domain',
      'vendor_eagoh_id', v_listing.eagoh_id
    );
  end if;

  -- ── 9. Canonical domain comparison — BEFORE any charge ──
  --       "sport" ≡ "sports", "health_fitness" ≡ "health-fitness",
  --       case-insensitive; genuinely different domains never match.
  if public.normalize_exchange_domain(v_buyer_domain)
     is distinct from public.normalize_exchange_domain(v_vendor_domain) then
    return jsonb_build_object(
      'ok', false,
      'error', 'domain_mismatch',
      'buyer_eagoh_id', p_buyer_eagoh_id,
      'buyer_domain', v_buyer_domain,
      'vendor_eagoh_id', v_listing.eagoh_id,
      'vendor_domain', v_vendor_domain,
      'message', 'The selected EAGOH belongs to a different intelligence domain than this listing.'
    );
  end if;

  -- ── 10. Lock buyer profile row ──
  select edge_subscription, edge_purchased, username, avatar_url
  into v_buyer
  from public.profiles
  where id = p_buyer_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Buyer profile not found.');
  end if;

  -- ── 11. Verify sufficient neurons ──
  if coalesce(v_buyer.edge_subscription, 0) + coalesce(v_buyer.edge_purchased, 0) < v_total_cost then
    return jsonb_build_object('ok', false, 'error',
      'Insufficient Neurons. Need ' || v_total_cost || ' Neurons (have ' ||
      (coalesce(v_buyer.edge_subscription, 0) + coalesce(v_buyer.edge_purchased, 0)) || ').');
  end if;

  -- ── 12. Deduct buyer neurons (subscription first, purchased second) ──
  v_from_sub := least(coalesce(v_buyer.edge_subscription, 0), v_total_cost);
  v_from_purchased := v_total_cost - v_from_sub;
  v_next_sub := coalesce(v_buyer.edge_subscription, 0) - v_from_sub;
  v_next_purchased := coalesce(v_buyer.edge_purchased, 0) - v_from_purchased;

  update public.profiles
    set edge_subscription = v_next_sub,
        edge_purchased = v_next_purchased,
        updated_at = now()
    where id = p_buyer_id;

  -- ── 13. Log buyer deduction ──
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

  -- ── 14. Lock vendor profile and credit ──
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

  -- ── 15. Log vendor credit ──
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

  -- ── 16. Insert purchase record (attributed to the buyer EAGOH) ──
  v_expires_at := v_started_at + make_interval(days => p_days);
  v_buyer_display_name := v_buyer.username;
  v_buyer_avatar_url := v_buyer.avatar_url;

  insert into public.marketplace_sync_purchases (
    listing_id, buyer_id, buyer_eagoh_id, vendor_id, eagoh_id,
    sync_level, days, edge_cost,
    started_at, expires_at, active,
    buyer_display_name, buyer_avatar_url,
    purchase_status, idempotency_key
  ) values (
    p_listing_id, p_buyer_id, p_buyer_eagoh_id, v_listing.vendor_id, v_listing.eagoh_id,
    p_sync_level, p_days, v_total_cost,
    v_started_at, v_expires_at, true,
    v_buyer_display_name, v_buyer_avatar_url,
    'completed', p_idempotency_key
  )
  returning id into v_purchase_id;

  -- ── 17. Update vendor stats (incremental) ──
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
      'buyer_eagoh_id', p_buyer_eagoh_id,
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

-- =============================================================================
-- Permissions — reapplied explicitly after replacement (service-role only).
-- SECURITY DEFINER with p_buyer_id as a parameter: a client-callable path
-- would let any authenticated user drain another user's balance. The ONLY
-- allowed path is: App → authenticated /exchange/purchase worker →
-- service-role Supabase client → this RPC.
-- =============================================================================

revoke all on function public.purchase_marketplace_sync_atomic(
  uuid, uuid, uuid, text, integer, text
) from public;

revoke all on function public.purchase_marketplace_sync_atomic(
  uuid, uuid, uuid, text, integer, text
) from anon;

revoke all on function public.purchase_marketplace_sync_atomic(
  uuid, uuid, uuid, text, integer, text
) from authenticated;

grant execute on function public.purchase_marketplace_sync_atomic(
  uuid, uuid, uuid, text, integer, text
) to service_role;

commit;
