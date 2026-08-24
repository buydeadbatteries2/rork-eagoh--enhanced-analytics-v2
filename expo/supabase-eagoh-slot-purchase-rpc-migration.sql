-- ────────────────────────────────────────────────────────────────────────────
-- EAGOH Slot Purchase RPC Migration (Phase 4B)
--
-- Adds public.purchase_eagoh_slot_atomic(p_user_id, p_idempotency_key):
-- a SECURITY DEFINER RPC that purchases exactly ONE additional EAGOH slot
-- for a server-hardcoded price of 750 Neurons in a single transaction.
--
-- Atomic operation order (all-or-nothing):
--   1. Validate p_user_id
--   2. Validate p_idempotency_key (non-empty, ≤ 200 chars)
--   3. Lock the user's profiles row (FOR UPDATE) — serializes concurrent
--      purchases for the same user
--   4. AFTER the profile lock: idempotency lookup on eagoh_slot_transactions
--   5. Duplicate → return the stored successful result, never re-charge
--   6. Resolve paid access from trusted DB records only (never client input)
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
  v_dev_test_tier     text;
  v_effective_tier    text;
  v_current_priority  int;
  v_dev_priority      int;
  v_purchased_slots   int;
  v_grandfathered_slots int;
  v_from_sub          int;
  v_from_purchased    int;
  v_next_sub          int;
  v_next_purchased    int;
  v_total_additional  int;
  v_total_capacity    int;
  v_existing_delta    int;
  v_existing_cost     int;
begin
  -- ── 1. Validate p_user_id ──
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'Invalid request.');
  end if;

  -- ── 2. Validate the idempotency key ──
  if p_idempotency_key is null
     or length(btrim(p_idempotency_key)) < 1
     or length(p_idempotency_key) > 200 then
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
  -- Only kind = 'purchase' rows match: grandfather grants use a different
  -- reserved key namespace and kind, so they can never satisfy a client key.
  select slot_delta, neuron_cost
    into v_existing_delta, v_existing_cost
  from public.eagoh_slot_transactions
  where user_id = p_user_id
    and idempotency_key = p_idempotency_key
    and kind = 'purchase'
  limit 1;

  if found then
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
  -- Never trust a client-supplied tier.
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

  -- Dev test subscriptions (Expo Go / Rork testing). In production this table
  -- is empty — safe to always check. Highest tier wins, matching the
  -- purchase_banner_atomic resolution pattern.
  select test_tier
    into v_dev_test_tier
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
    p_user_id, 'purchase', 1, c_slot_cost, p_idempotency_key,
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
