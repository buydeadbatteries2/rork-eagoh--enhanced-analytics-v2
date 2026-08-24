-- ────────────────────────────────────────────────────────────────────────────
-- EAGOH Slot Purchase RPC Migration (Phase 4B)
--
-- Adds public.purchase_eagoh_slot_atomic(p_user_id, p_idempotency_key):
-- a SECURITY DEFINER RPC that purchases exactly ONE additional EAGOH slot
-- for a server-hardcoded price of 750 Neurons in a single transaction.
--
-- Atomic operation order (all-or-nothing):
--   1. Validate p_user_id
--   2. Validate p_idempotency_key — must be a canonical hyphenated UUID
--      (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx), normalized to lowercase;
--      arbitrary strings and reserved keys (e.g. legacy-eagoh-capacity-v1:…)
--      are rejected before the purchase starts
--   3. Lock the user's profiles row (FOR UPDATE) — serializes concurrent
--      purchases for the same user
--   4. AFTER the profile lock: idempotency lookup on eagoh_slot_transactions
--   5. Duplicate → return the stored successful result, never re-charge
--   6. Resolve paid access from trusted database records only (never client
--      input): profiles.subscription_tier or an active admin_tier_override.
--      dev_test_subscriptions is INTENTIONALLY EXCLUDED — development rows
--      must never authorize permanent account entitlements.
--   7. Ensure an eagoh_slot_entitlements row exists (INSERT … ON CONFLICT)
--   8. Lock the entitlement row (FOR UPDATE)
--   9. Verify purchased_slots + grandfathered_slots < 3
--  10. Verify combined Neuron balance ≥ 750
--  11. Deduct subscription Neurons first, purchased Neurons second
--  12. Increment purchased_slots by exactly 1
--  13. Insert one eagoh_slot_transactions audit row (kind 'purchase')
--  14. Insert one edge_transactions deduction row (reason 'eagoh_slot_purchase')
--  15. Return the entitlement, total capacity, and updated balances
--
-- The price (750), the slot quantity (exactly 1), and the tier are NEVER
-- accepted from the client. If ANY step fails, everything rolls back:
-- no Neurons deducted, no slot granted, no partial audit record.
--
-- PERMISSIONS: execute is revoked from public/anon/authenticated and granted
-- ONLY to service_role. The mobile client must NEVER call this RPC directly —
-- the single permitted path is App → authenticated Worker route →
-- service-role RPC.
--
-- NOTE: This file is created only — it has NOT been executed against the live
-- Supabase project.
-- ────────────────────────────────────────────────────────────────────────────

begin;

-- ── Replace the Phase 4A global idempotency index with a per-user unique
--    index. Phase 4A enforced key uniqueness across ALL users; purchases are
--    idempotent per user, so two different users must be able to use the
--    same key for their own independent purchases. Existing transaction
--    rows are never changed or deleted — only the index is replaced.
drop index if exists public.idx_eagoh_slot_transactions_idempotency;

create unique index idx_eagoh_slot_transactions_idempotency
 on public.eagoh_slot_transactions(user_id, idempotency_key)
 where idempotency_key is not null;

create or replace function public.purchase_eagoh_slot_atomic(
  p_user_id uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Server-side constants — mirrored from expo/services/eagohCapacity.ts.
  -- Never accepted from the client.
  c_slot_cost             constant int := 750;
  c_max_additional_slots  constant int := 3;
  c_pro_included_eagohs   constant int := 2;

  v_subscription_tier text;
  v_edge_sub          int;
  v_edge_purchased    int;
  v_admin_override    text;
  v_admin_expires     timestamptz;
  v_real_tier         text;
  v_effective_tier    text;
  v_idempotency_key   text;
  v_is_duplicate      boolean;
  v_purchased_slots   int;
  v_grandfathered_slots int;
  v_from_sub          int;
  v_from_purchased    int;
  v_next_sub          int;
  v_next_purchased    int;
  v_total_additional  int;
  v_total_capacity    int;
begin
  -- ── 1. Validate p_user_id ──
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'Invalid request.');
  end if;

  -- ── 2. Validate the idempotency key: canonical hyphenated UUID only ──
  -- Accept any hexadecimal UUID variant (v1–v7, not just v4). Normalize to
  -- lowercase so the same key in different cases is one identity. Anything
  -- else — arbitrary strings, empty keys, reserved keys such as
  -- legacy-eagoh-capacity-v1:<user_id> — is rejected before the purchase
  -- starts. The normalized value is used for duplicate lookup AND audit
  -- insertion, so lookups and stored rows always agree.
  v_idempotency_key := lower(btrim(coalesce(p_idempotency_key, '')));
  if v_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok', false, 'error', 'Invalid idempotency key.');
  end if;

  -- ── 3. Lock the profile row ──
  -- FOR UPDATE serializes simultaneous purchases for the same user BEFORE
  -- the idempotency lookup, closing the both-see-nothing race.
  select subscription_tier, edge_subscription, edge_purchased,
         admin_tier_override, admin_tier_expires_at
    into v_subscription_tier, v_edge_sub, v_edge_purchased,
         v_admin_override, v_admin_expires
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Profile not found.');
  end if;

  -- ── 4. Idempotency check (AFTER the profile lock) ──
  -- Scoped to user_id + normalized key + kind = 'purchase'. Grandfather
  -- grants use a different key namespace and kind, so they can never
  -- satisfy a client purchase key. Minimal exists() lookup.
  select exists(
    select 1
    from public.eagoh_slot_transactions
    where user_id = p_user_id
      and idempotency_key = v_idempotency_key
      and kind = 'purchase'
  ) into v_is_duplicate;

  if v_is_duplicate then
    -- ── 5. Duplicate: return the stored/current successful result ──
    -- Never charge again, never grant a second slot for the same key.
    v_purchased_slots := 0;
    v_grandfathered_slots := 0;
    select purchased_slots, grandfathered_slots
      into v_purchased_slots, v_grandfathered_slots
    from public.eagoh_slot_entitlements
    where user_id = p_user_id;

    v_total_additional := coalesce(v_purchased_slots, 0) + coalesce(v_grandfathered_slots, 0);
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'entitlement', jsonb_build_object(
        'purchased_slots', coalesce(v_purchased_slots, 0),
        'grandfathered_slots', coalesce(v_grandfathered_slots, 0),
        'total_additional_slots', v_total_additional,
        'total_capacity', c_pro_included_eagohs + v_total_additional
      ),
      'new_balance', jsonb_build_object(
        'subscription', coalesce(v_edge_sub, 0),
        'purchased', coalesce(v_edge_purchased, 0),
        'total', coalesce(v_edge_sub, 0) + coalesce(v_edge_purchased, 0)
      )
    );
  end if;

  -- ── 6. Resolve paid access from trusted database records ──
  -- Never trust a client-supplied tier. Only two sources are recognized:
  --   (a) profiles.subscription_tier
  --   (b) an active profiles.admin_tier_override
  -- dev_test_subscriptions is INTENTIONALLY EXCLUDED here: development test
  -- rows are temporary test scaffolding and must NEVER authorize a permanent
  -- account entitlement such as a purchased EAGOH slot. There is no flag,
  -- parameter, or override that can re-enable them for this RPC.
  v_real_tier := coalesce(v_subscription_tier, 'free');
  v_effective_tier := v_real_tier;

  -- Admin override — semantics match getEffectiveSubscriptionTier():
  --   no override → normal subscription tier
  --   null expiry → permanent override
  --   future expiry → active override
  --   past expiry → ignore override
  if v_admin_override is not null then
    if v_admin_expires is null or v_admin_expires > now() then
      v_effective_tier := v_admin_override;
    end if;
  end if;

  if v_effective_tier not in ('pro', 'oracle_elite', 'syndicate') then
    return jsonb_build_object('ok', false, 'error',
      'PRO_REQUIRED — Upgrade to Pro to purchase additional EAGOH slots.');
  end if;

  -- ── 7. Ensure the entitlement row exists (accounts created after the
  --        Phase 4A snapshot have no row yet) ──
  insert into public.eagoh_slot_entitlements (user_id, purchased_slots, grandfathered_slots)
  values (p_user_id, 0, 0)
  on conflict (user_id) do nothing;

  -- ── 8. Lock the entitlement row ──
  select purchased_slots, grandfathered_slots
    into v_purchased_slots, v_grandfathered_slots
  from public.eagoh_slot_entitlements
  where user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Entitlement unavailable.');
  end if;

  -- ── 9. Capacity check: combined additional slots must stay under 3 ──
  if coalesce(v_purchased_slots, 0) + coalesce(v_grandfathered_slots, 0)
     >= c_max_additional_slots then
    return jsonb_build_object('ok', false, 'error',
      'MAX_SLOTS_REACHED — You already own the maximum of 3 additional EAGOH slots.');
  end if;

  -- ── 10. Balance check ──
  if coalesce(v_edge_sub, 0) + coalesce(v_edge_purchased, 0) < c_slot_cost then
    return jsonb_build_object('ok', false, 'error',
      'Insufficient Neurons. ' || c_slot_cost || ' Neurons required.');
  end if;

  -- ── 11. Compute the deduction split (subscription first, purchased second) ──
  v_from_sub := least(coalesce(v_edge_sub, 0), c_slot_cost);
  v_from_purchased := c_slot_cost - v_from_sub;
  v_next_sub := coalesce(v_edge_sub, 0) - v_from_sub;
  v_next_purchased := coalesce(v_edge_purchased, 0) - v_from_purchased;

  -- Deduct the Neurons from the wallet.
  update public.profiles
    set edge_subscription = v_next_sub,
        edge_purchased = v_next_purchased,
        updated_at = now()
    where id = p_user_id;

  -- ── 12. Increment purchased_slots by exactly 1 ──
  update public.eagoh_slot_entitlements
    set purchased_slots = purchased_slots + 1,
        updated_at = now()
    where user_id = p_user_id;

  v_total_additional := coalesce(v_purchased_slots, 0) + coalesce(v_grandfathered_slots, 0) + 1;
  v_total_capacity := c_pro_included_eagohs + v_total_additional;

  -- ── 13. Insert the slot-purchase audit row ──
  insert into public.eagoh_slot_transactions (
    user_id, kind, slot_delta, neuron_cost, idempotency_key, metadata
  ) values (
    p_user_id, 'purchase', 1, c_slot_cost, v_idempotency_key,
    jsonb_build_object(
      'reason', 'eagoh_slot_purchase',
      'from_subscription', v_from_sub,
      'from_purchased', v_from_purchased,
      'balance_subscription_after', v_next_sub,
      'balance_purchased_after', v_next_purchased,
      'total_additional_slots', v_total_additional,
      'total_capacity', v_total_capacity
    )
  );

  -- ── 14. Insert the edge_transactions deduction row ──
  insert into public.edge_transactions (
    user_id, kind, reason, amount, bucket,
    from_subscription, from_purchased,
    balance_subscription_after, balance_purchased_after, note
  ) values (
    p_user_id, 'deduction', 'eagoh_slot_purchase', c_slot_cost,
    case when v_from_sub > 0 and v_from_purchased > 0 then 'mixed'
         when v_from_purchased > 0 then 'purchased'
         else 'subscription' end,
    v_from_sub, v_from_purchased,
    v_next_sub, v_next_purchased,
    'Permanent EAGOH slot purchase'
  );

  -- ── 15. Return the updated entitlement, capacity, and balances ──
  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'entitlement', jsonb_build_object(
      'purchased_slots', coalesce(v_purchased_slots, 0) + 1,
      'grandfathered_slots', coalesce(v_grandfathered_slots, 0),
      'total_additional_slots', v_total_additional,
      'total_capacity', v_total_capacity
    ),
    'new_balance', jsonb_build_object(
      'subscription', v_next_sub,
      'purchased', v_next_purchased,
      'total', v_next_sub + v_next_purchased
    )
  );

-- ── Any uncaught error rolls back the entire transaction (PL/pgSQL block
-- savepoint): no neurons deducted, no slot granted, no partial audit rows. ──
exception
  when others then
    return jsonb_build_object(
      'ok', false,
      'error', 'EAGOH slot purchase failed. No neurons were charged.',
      'detail', SQLERRM,
      'sqlstate', SQLSTATE
    );
end;
$$;

-- ── Lock down RPC permissions ──────────────────────────────────────────────
-- The function accepts p_user_id, so the mobile client must NEVER call it
-- directly. Execute is revoked from every client role and granted ONLY to
-- service_role. The single permitted path is:
--   App → authenticated Worker route → service-role RPC
revoke all on function public.purchase_eagoh_slot_atomic(uuid, text) from public;
revoke all on function public.purchase_eagoh_slot_atomic(uuid, text) from anon;
revoke all on function public.purchase_eagoh_slot_atomic(uuid, text) from authenticated;

grant execute on function public.purchase_eagoh_slot_atomic(uuid, text) to service_role;

commit;
