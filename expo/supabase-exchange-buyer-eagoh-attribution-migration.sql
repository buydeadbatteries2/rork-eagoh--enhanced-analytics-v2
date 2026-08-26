-- =============================================================================
-- Exchange Buyer-EAGOH Attribution Migration (Phase D2.2A)
--
-- Permanently associates Exchange purchases and retained intelligence with
-- the SELECTED BUYER EAGOH:
--
--   1. marketplace_sync_purchases.buyer_eagoh_id  (nullable, FK → eagohs,
--      ON DELETE SET NULL) — historical rows stay NULL (ownership cannot be
--      determined safely, so nothing is guessed or backfilled).
--   2. retained_exchange_intelligence.buyer_eagoh_id (nullable, FK → eagohs,
--      ON DELETE SET NULL) — new retained rows inherit the purchase's buyer
--      EAGOH; legacy rows are preserved untouched.
--   3. purchase_marketplace_sync_atomic is REPLACED with a six-parameter
--      overload that independently enforces buyer-EAGOH ownership,
--      eligibility, dormancy, and canonical same-domain rules IN THE
--      DATABASE — the worker precheck is convenience, not the gate.
--   4. create_retained_exchange_intelligence applies the 25% retention cap
--      per (buyer_eagoh_id + vendor_eagoh_id) instead of account-wide, and
--      duplicate checks use buyer-EAGOH attribution.
--
-- NO behavior changes to: 2% retention formula, purchased percentages,
-- 25% maximum, source selection order, expiration, refund/reversal,
-- retention snapshots, server-owned pricing, subscription-first deduction,
-- vendor crediting, ledger entries, idempotency, or rollback guarantees.
--
-- Reruns are safe: every statement is idempotent.
-- =============================================================================

begin;

-- =============================================================================
-- 1. Purchase attribution column
-- =============================================================================

alter table public.marketplace_sync_purchases
  add column if not exists buyer_eagoh_id uuid;

-- FK → eagohs(id) ON DELETE SET NULL: deleting a buyer EAGOH keeps the
-- historical purchase record (buyer_eagoh_id becomes NULL) instead of
-- destroying payment/ledger history.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'msp_buyer_eagoh_fk'
      and conrelid = 'public.marketplace_sync_purchases'::regclass
  ) then
    alter table public.marketplace_sync_purchases
      add constraint msp_buyer_eagoh_fk
      foreign key (buyer_eagoh_id)
      references public.eagohs(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists msp_buyer_eagoh_created_idx
  on public.marketplace_sync_purchases(buyer_eagoh_id, created_at desc);

-- Historical purchases are intentionally left NULL: the original buyer EAGOH
-- cannot be determined safely after the fact, and no ownership is guessed or
-- backfilled.

-- =============================================================================
-- 2. Retained-intelligence attribution column
-- =============================================================================

alter table public.retained_exchange_intelligence
  add column if not exists buyer_eagoh_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rei_buyer_eagoh_fk'
      and conrelid = 'public.retained_exchange_intelligence'::regclass
  ) then
    alter table public.retained_exchange_intelligence
      add constraint rei_buyer_eagoh_fk
      foreign key (buyer_eagoh_id)
      references public.eagohs(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists rei_buyer_eagoh_active_created_idx
  on public.retained_exchange_intelligence(buyer_eagoh_id, active, created_at desc);

-- =============================================================================
-- 3. Canonical domain normalization (SQL parity with normalizeDomainId())
-- =============================================================================
-- Mirrors expo/services/domains.ts normalizeDomainId() and the worker's
-- normalizeExchangeDomain(): case folding, separator/singular/label aliases
-- ("sport" ≡ "sports", "health_fitness" ≡ "health-fitness",
-- "Film & Television" ≡ "film-tv"), with the lowercased trimmed input as the
-- fallback for unknown values. Pure and IMMUTABLE — no table access.

create or replace function public.normalize_exchange_domain(p_raw text)
returns text
language sql
immutable
returns null on null input
as $$
  select
    case
      -- Explicit alias map (lowercased, trimmed) — parity with NORMALIZE_MAP
      when lower(btrim(p_raw)) in ('sport') then 'sports'
      when lower(btrim(p_raw)) in (
        'film_tv', 'film & television', 'film and television',
        'film-television', 'filmtv', 'filmtelevision', 'film_television'
      ) then 'film-tv'
      when lower(btrim(p_raw)) in (
        'health_fitness', 'health & fitness', 'health and fitness',
        'healthfitness', 'health-fit', 'health_fit'
      ) then 'health-fitness'
      -- Collapsed form (non-alphanumerics stripped): covers canonical ids
      -- ("SPORTS" → "sports"), separators ("health-fitness" → …), and labels
      -- ("Film & Television" → "filmandtelevision"). Canonical ids without
      -- separators already equal themselves in the fallback branch.
      else case regexp_replace(lower(btrim(p_raw)), '[^a-z0-9]', '', 'g')
        when 'sport' then 'sports'
        when 'filmtv' then 'film-tv'
        when 'filmandtelevision' then 'film-tv'
        when 'filmtelevision' then 'film-tv'
        when 'healthfitness' then 'health-fitness'
        when 'healthandfitness' then 'health-fitness'
        when 'healthfit' then 'health-fitness'
        -- Fallback: lowercased trimmed input, exactly like normalizeDomainId()
        else lower(btrim(p_raw))
      end
    end;
$$;

-- Null/empty-safe comparison: a missing domain NEVER matches anything, so an
-- all-domain fallback is impossible. Parity with isSameExchangeDomain().
create or replace function public.same_exchange_domain(p_a text, p_b text)
returns boolean
language sql
immutable
as $$
  select coalesce(nullif(btrim(p_a), ''), '') <> ''
     and coalesce(nullif(btrim(p_b), ''), '') <> ''
     and public.normalize_exchange_domain(btrim(p_a))
       = public.normalize_exchange_domain(btrim(p_b));
$$;

-- Lock both helpers down: no client-callable surface, service_role only.
revoke all on function public.normalize_exchange_domain(text) from public;
revoke all on function public.normalize_exchange_domain(text) from anon;
revoke all on function public.normalize_exchange_domain(text) from authenticated;
grant execute on function public.normalize_exchange_domain(text) to service_role;

revoke all on function public.same_exchange_domain(text, text) from public;
revoke all on function public.same_exchange_domain(text, text) from anon;
revoke all on function public.same_exchange_domain(text, text) from authenticated;
grant execute on function public.same_exchange_domain(text, text) to service_role;

-- =============================================================================
-- 4. Atomic purchase RPC — six-parameter buyer-EAGOH-attributed overload
-- =============================================================================
-- REPLACES the five-parameter purchase_marketplace_sync_atomic. PostgreSQL
-- treats the new signature as a separate overload, so the old insecure
-- version is explicitly dropped INSIDE this transaction: it must not remain
-- callable anywhere.
--
-- Everything below runs in ONE transaction (listing lock → server-owned
-- price → buyer EAGOH validation → vendor EAGOH validation → domain check →
-- buyer profile lock → deduction → vendor credit → ledger entries → purchase
-- insert → vendor-stat update). Any failure rolls back everything: zero
-- neurons charged, zero vendor credits, zero purchase rows.
-- =============================================================================

drop function if exists public.purchase_marketplace_sync_atomic(
  uuid, uuid, text, integer, text
);

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
     and coalesce(v_buyer_eagoh.is_user_forged, false) = false then
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

-- ── Permissions ──
-- SECURITY DEFINER with p_buyer_id as a parameter: a client-callable path
-- would let any authenticated user drain another user's balance. The ONLY
-- allowed path is: App → authenticated /exchange/purchase worker →
-- service-role Supabase client → this RPC.
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

-- =============================================================================
-- 5. Retained intelligence: per-buyer-EAGOH cap + attribution uniqueness
-- =============================================================================
-- Replaces the misleading account-wide uniqueness rule. Legacy NULL-
-- attribution rows are preserved untouched (never deleted or rewritten) and
-- are simply outside the new partial index's scope.
-- =============================================================================

-- 5a. Replace the account-wide active-uniqueness index with per-buyer-EAGOH
--     uniqueness for attributed rows. The `active = true` predicate is kept
--     so refund/reversal semantics are unchanged: deactivation frees the
--     source entry for re-retention by a later successful purchase.
drop index if exists retained_exchange_buyer_eagoh_entry_uniq;

create unique index if not exists retained_exchange_buyer_eagoh_attrib_uniq
  on public.retained_exchange_intelligence(buyer_eagoh_id, vendor_eagoh_id, source_entry_id)
  where buyer_eagoh_id is not null
    and active = true;

-- 5b. Rewrite create_retained_exchange_intelligence with buyer-EAGOH
--     attribution. UNCHANGED: 2% retention formula, purchased percentage
--     handling, 25% cumulative maximum, deterministic source selection
--     order, expiration checks, idempotency, result shape, and snapshot
--     contents. CHANGED: the 25% cap and duplicate checks now key on the
--     purchase's buyer_eagoh_id (legacy NULL-attribution purchases keep the
--     old account-wide behavior for continuity).

create or replace function public.create_retained_exchange_intelligence(
  p_purchase_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase record;
  v_listing record;
  v_vendor_eagoh record;
  v_vendor_profile record;
  v_pct integer;
  v_existing_for_purchase integer;
  v_total_eligible integer;
  v_purchased_cohort_count integer;
  v_max_retained integer;
  v_existing_retained integer;
  v_requested_retain integer;
  v_newly_retain integer;
  v_capacity integer;
  v_actual_inserted integer;
  v_inserted_rows integer;
  v_cap_reached boolean;
  v_entry record;
  v_validation_rank jsonb := '{"externally_supported":3,"community_supported":2,"pending_review":1,"disputed":0,"rejected":-1,"withdrawn":-1}'::jsonb;
  v_confidence_rank jsonb := '{"verified_observation":3,"strong_confidence":2,"moderate_confidence":1,"weak_suspicion":0}'::jsonb;
begin
  -- 1. Lock and verify the purchase (now carries buyer_eagoh_id)
  select id, listing_id, buyer_id, buyer_eagoh_id, vendor_id, eagoh_id,
         sync_level, active, started_at, expires_at
    into v_purchase
    from public.marketplace_sync_purchases
    where id = p_purchase_id
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'purchase_not_found');
  end if;

  -- 2. Confirm it is successful and active
  if v_purchase.active = false then
    return jsonb_build_object('ok', false, 'error', 'purchase_inactive');
  end if;

  if v_purchase.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'purchase_expired');
  end if;

  -- 3. Parse purchased percentage (25, 50, 75, 100)
  v_pct := case
    when v_purchase.sync_level = '25%' then 25
    when v_purchase.sync_level = '50%' then 50
    when v_purchase.sync_level = '75%' then 75
    when v_purchase.sync_level = '100%' then 100
    else null
  end;

  if v_pct is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_sync_level');
  end if;

  -- 4. Verify listing relationships
  select id, vendor_id, eagoh_id, active
    into v_listing
    from public.marketplace_listings
    where id = v_purchase.listing_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'listing_not_found');
  end if;

  if v_listing.vendor_id != v_purchase.vendor_id then
    return jsonb_build_object('ok', false, 'error', 'vendor_mismatch');
  end if;

  if v_listing.eagoh_id != v_purchase.eagoh_id then
    return jsonb_build_object('ok', false, 'error', 'eagoh_mismatch');
  end if;

  -- 5. Verify vendor EAGOH exists and belongs to vendor
  select id, user_id, name
    into v_vendor_eagoh
    from public.eagohs
    where id = v_purchase.eagoh_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'eagoh_not_found');
  end if;

  if v_vendor_eagoh.user_id != v_purchase.vendor_id then
    return jsonb_build_object('ok', false, 'error', 'eagoh_owner_mismatch');
  end if;

  -- 6. Get vendor display name
  select username into v_vendor_profile
    from public.profiles
    where id = v_purchase.vendor_id;

  -- 7. Count the TOTAL eligible vendor EAGOH entries (before percentage)
  --    This is the denominator for both the purchased cohort and the 25% cap.
  select count(*) into v_total_eligible
    from public.open_intelligence
    where user_id = v_purchase.vendor_id
      and eagoh_id = v_purchase.eagoh_id
      and exchange_share_enabled = true
      and validation_status in ('pending_review', 'community_supported', 'externally_supported', 'disputed', 'validated');

  -- 8. Calculate the purchased cohort count (percentage applied to total eligible)
  v_purchased_cohort_count := ceil(v_total_eligible * v_pct / 100.0);

  -- 9. Calculate the 25% cumulative retention cap (denominator unchanged)
  v_max_retained := ceil(v_total_eligible * 0.25);
  if v_max_retained < 1 and v_total_eligible > 0 then
    v_max_retained := 1;
  end if;

  -- 10. Count the BUYER EAGOH's existing ACTIVE retained entries for this
  --     vendor EAGOH (across all purchases). The 25% cap is now per
  --     (buyer_eagoh_id + vendor_eagoh_id), not account-wide. Legacy
  --     NULL-attribution purchases keep the old account-wide count.
  if v_purchase.buyer_eagoh_id is not null then
    select count(*) into v_existing_retained
      from public.retained_exchange_intelligence
      where buyer_eagoh_id = v_purchase.buyer_eagoh_id
        and vendor_eagoh_id = v_purchase.eagoh_id
        and active = true;
  else
    select count(*) into v_existing_retained
      from public.retained_exchange_intelligence
      where buyer_id = v_purchase.buyer_id
        and vendor_eagoh_id = v_purchase.eagoh_id
        and active = true;
  end if;

  -- 11. Check for existing retained rows for THIS purchase (idempotency)
  select count(*) into v_existing_for_purchase
    from public.retained_exchange_intelligence
    where purchase_id = p_purchase_id and active = true;

  if v_existing_for_purchase > 0 then
    -- Already processed — return the ACTUAL purchased cohort size, not the retained count.
    return jsonb_build_object(
      'ok', true,
      'already_processed', true,
      'purchase_id', p_purchase_id,
      'buyer_eagoh_id', v_purchase.buyer_eagoh_id,
      'purchased_cohort_count', v_purchased_cohort_count,
      'retained_count', v_existing_for_purchase,
      'total_vendor_eligible_entries', v_total_eligible,
      'maximum_retained_entries', v_max_retained,
      'existing_retained_count', v_existing_retained,
      'requested_retained_count', v_existing_for_purchase,
      'newly_retained_count', 0,
      'remaining_retention_capacity', greatest(v_max_retained - v_existing_retained, 0),
      'cap_reached', v_existing_retained >= v_max_retained
    );
  end if;

  if v_purchased_cohort_count = 0 then
    return jsonb_build_object(
      'ok', true,
      'already_processed', false,
      'purchase_id', p_purchase_id,
      'buyer_eagoh_id', v_purchase.buyer_eagoh_id,
      'purchased_cohort_count', 0,
      'retained_count', 0,
      'total_vendor_eligible_entries', v_total_eligible,
      'maximum_retained_entries', v_max_retained,
      'existing_retained_count', v_existing_retained,
      'requested_retained_count', 0,
      'newly_retained_count', 0,
      'remaining_retention_capacity', greatest(v_max_retained - v_existing_retained, 0),
      'cap_reached', v_existing_retained >= v_max_retained
    );
  end if;

  -- 12. Calculate the normal 2% retention amount (from the purchased cohort)
  v_requested_retain := ceil(v_purchased_cohort_count * 0.02);
  if v_requested_retain < 1 then
    v_requested_retain := 1;
  end if;

  -- 13. Apply the 25% cumulative retention cap (now per buyer EAGOH)
  v_capacity := v_max_retained - v_existing_retained;
  if v_capacity <= 0 then
    -- Cap already reached: purchase proceeds normally but zero new retained entries
    v_newly_retain := 0;
    v_cap_reached := true;
  else
    v_newly_retain := least(v_requested_retain, v_capacity);
    v_cap_reached := (v_existing_retained + v_newly_retain) >= v_max_retained;
  end if;

  -- 14. Select and insert retained entries FROM THE PURCHASED COHORT ONLY.
  --     Duplicate exclusion now keys on the BUYER EAGOH: a different EAGOH on
  --     the same account may retain the same source entry (the account-wide
  --     block is gone for attributed rows). Legacy NULL-attribution rows are
  --     matched account-wide as before so old duplicates are still excluded.
  v_actual_inserted := 0;

  if v_newly_retain > 0 then
    for v_entry in
      select sub.* from (
        select oi.id,
               oi.content,
               oi.entry_type,
               oi.tag,
               oi.selected_category,
               oi.quality_score,
               oi.influence_score,
               oi.confidence_level,
               oi.validation_status,
               oi.created_at,
               (v_validation_rank ->> oi.validation_status)::int as val_rank,
               (v_confidence_rank ->> oi.confidence_level)::int as conf_rank
          from public.open_intelligence oi
          where oi.user_id = v_purchase.vendor_id
            and oi.eagoh_id = v_purchase.eagoh_id
            and oi.exchange_share_enabled = true
            and oi.validation_status in ('pending_review', 'community_supported', 'externally_supported', 'disputed', 'validated')
          order by
            oi.quality_score desc,
            (v_validation_rank ->> oi.validation_status)::int desc,
            oi.influence_score desc,
            (v_confidence_rank ->> oi.confidence_level)::int desc,
            oi.created_at desc,
            oi.id asc
          limit v_purchased_cohort_count
      ) sub
      where not exists (
        select 1 from public.retained_exchange_intelligence rei
        where rei.vendor_eagoh_id = v_purchase.eagoh_id
          and rei.source_entry_id = sub.id
          and rei.active = true
          and (
            (v_purchase.buyer_eagoh_id is not null
              and rei.buyer_eagoh_id = v_purchase.buyer_eagoh_id)
            or
            (v_purchase.buyer_eagoh_id is null
              and rei.buyer_eagoh_id is null
              and rei.buyer_id = v_purchase.buyer_id)
          )
      )
      order by
        sub.quality_score desc,
        sub.val_rank desc,
        sub.influence_score desc,
        sub.conf_rank desc,
        sub.created_at desc,
        sub.id asc
      limit v_newly_retain
    loop
      -- Every new retained row is attributed to the purchase's buyer EAGOH.
      insert into public.retained_exchange_intelligence (
        buyer_id, buyer_eagoh_id, vendor_id, vendor_eagoh_id,
        source_entry_id, purchase_id, listing_id,
        purchased_percentage, retention_percentage, retained_content_snapshot,
        source_entry_type, source_tag, source_category, source_quality_score,
        source_confidence_level, source_validation_status, source_created_at,
        vendor_display_name, vendor_eagoh_name, active
      ) values (
        v_purchase.buyer_id, v_purchase.buyer_eagoh_id, v_purchase.vendor_id,
        v_purchase.eagoh_id, v_entry.id,
        p_purchase_id, v_purchase.listing_id,
        v_pct, 2, v_entry.content,
        v_entry.entry_type, v_entry.tag, v_entry.selected_category,
        v_entry.quality_score, v_entry.confidence_level, v_entry.validation_status,
        v_entry.created_at,
        v_vendor_profile.username, v_vendor_eagoh.name, true
      )
      on conflict do nothing;

      -- Use GET DIAGNOSTICS to count only rows actually inserted (not skipped by ON CONFLICT)
      get diagnostics v_inserted_rows = row_count;
      v_actual_inserted := v_actual_inserted + v_inserted_rows;
    end loop;
  end if;

  -- 15. Return result with full cap information
  return jsonb_build_object(
    'ok', true,
    'already_processed', false,
    'purchase_id', p_purchase_id,
    'buyer_eagoh_id', v_purchase.buyer_eagoh_id,
    'purchased_cohort_count', v_purchased_cohort_count,
    'retained_count', v_actual_inserted,
    'total_vendor_eligible_entries', v_total_eligible,
    'maximum_retained_entries', v_max_retained,
    'existing_retained_count', v_existing_retained,
    'requested_retained_count', v_requested_retain,
    'newly_retained_count', v_actual_inserted,
    'remaining_retention_capacity', greatest(v_max_retained - v_existing_retained - v_actual_inserted, 0),
    'cap_reached', v_cap_reached
  );
end;
$$;

-- Re-assert service_role-only execution (grants persist across REPLACE, but
-- making them explicit keeps reruns and fresh environments correct).
revoke execute on function public.create_retained_exchange_intelligence(uuid) from public;
revoke execute on function public.create_retained_exchange_intelligence(uuid) from anon;
revoke execute on function public.create_retained_exchange_intelligence(uuid) from authenticated;
grant execute on function public.create_retained_exchange_intelligence(uuid) to service_role;

commit;
