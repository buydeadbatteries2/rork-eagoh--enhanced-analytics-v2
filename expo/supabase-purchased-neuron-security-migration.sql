-- ──────────────────────────────────────────────────────────────────────────
-- PURCHASED NEURON SECURITY — Migration
--
-- PROBLEM: grant_purchased_edge was callable by authenticated users and
-- accepted a client-supplied neuron amount. A modified client could call
-- it with any amount and grant unlimited purchased neurons.
--
-- FIX:
--   1. REVOKE execute on grant_purchased_edge from authenticated/anon.
--      Now service_role only (called by the secure Worker).
--   2. NEW RPC redeem_neuron_purchase(uuid, text, text):
--        - service_role only (no authenticated access)
--        - Takes user_id, product_id, transaction_id
--        - Server hardcodes the neuron amount from a product-id lookup table
--        - Client NEVER sends the neuron amount
--        - Idempotent via unique constraint on revenuecat_transaction_id
--          in the neuron_purchases table
--        - Credits edge_purchased, inserts audit row, records the purchase
--   3. grant_purchased_edge remains as a service_role-only helper (the new
--      RPC supersedes it for the purchase flow, but existing worker code
--      that may still reference it will not break).
-- ──────────────────────────────────────────────────────────────────────────

-- ── 1. Revoke authenticated access to grant_purchased_edge ──────────────────

revoke execute on function public.grant_purchased_edge(uuid, integer, text)
  from authenticated, anon;

-- ── 2. New RPC: redeem_neuron_purchase ──────────────────────────────────────
-- SECURITY DEFINER: runs as function owner (service_role).
--
-- Called ONLY by the secure Worker (/neurons/redeem endpoint) using the
-- service_role key. The client NEVER calls this directly.
--
-- Parameters:
--   p_user_id        — the authenticated user's UUID
--   p_product_id     — the RevenueCat / App Store product identifier
--   p_transaction_id — the RevenueCat transaction identifier
--
-- The server determines the neuron amount from a hardcoded product-id → amount
-- mapping. The client cannot influence the amount.
--
-- Idempotency: the neuron_purchases table has a UNIQUE constraint on
-- revenuecat_transaction_id. If the transaction was already redeemed,
-- the RPC returns { ok: true, already_redeemed: true } without crediting.

create or replace function public.redeem_neuron_purchase(
  p_user_id uuid,
  p_product_id text,
  p_transaction_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount        integer;
  v_profile       record;
  v_sub           integer;
  v_purchased     integer;
  v_next_purch    integer;
  v_existing_id   uuid;
begin
  -- 1. Validate inputs
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'User ID is required');
  end if;
  if p_product_id is null or btrim(p_product_id) = '' then
    return jsonb_build_object('ok', false, 'error', 'Product ID is required');
  end if;
  if p_transaction_id is null or btrim(p_transaction_id) = '' then
    return jsonb_build_object('ok', false, 'error', 'Transaction ID is required');
  end if;

  -- 2. Server-side product-id → neuron amount lookup (client cannot set amount)
  v_amount := case p_product_id
    when 'store_edge_250'   then 250
    when 'store_edge_750'   then 750
    when 'store_edge_2000'  then 2000
    when 'store_edge_6000'  then 6000
    when 'store_edge_15000' then 15000
    else null
  end;

  if v_amount is null then
    return jsonb_build_object('ok', false, 'error', 'Unknown product: ' || p_product_id);
  end if;

  -- 3. Idempotency: check if this transaction was already redeemed
  select id into v_existing_id
    from neuron_purchases
    where revenuecat_transaction_id = p_transaction_id
    limit 1;

  if v_existing_id is not null then
    -- Already redeemed — return success without re-crediting
    return jsonb_build_object(
      'ok', true,
      'already_redeemed', true,
      'neurons_granted', 0
    );
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
  v_next_purch := v_purchased + v_amount;

  -- 5. Credit purchased balance (subscription balance NEVER touched)
  update profiles set
    edge_purchased = v_next_purch,
    updated_at = now()
  where id = p_user_id;

  -- 6. Record the purchase for idempotency (unique constraint on tx_id)
  insert into neuron_purchases
    (user_id, product_id, revenuecat_transaction_id, neurons_granted)
  values
    (p_user_id, p_product_id, p_transaction_id, v_amount);

  -- 7. Insert audit transaction row
  insert into edge_transactions
    (user_id, kind, reason, amount, bucket,
     from_subscription, from_purchased,
     balance_subscription_after, balance_purchased_after,
     note)
  values
    (p_user_id, 'purchase', 'purchase', v_amount, 'purchased',
     0, 0,
     v_sub, v_next_purch,
     'Neuron purchase — product:' || p_product_id ||
     ' amount:' || v_amount ||
     ' tx:' || p_transaction_id);

  -- 8. Return new balances
  return jsonb_build_object(
    'ok', true,
    'already_redeemed', false,
    'neurons_granted', v_amount,
    'new_subscription', v_sub,
    'new_purchased', v_next_purch
  );
end;
$$;

grant execute on function public.redeem_neuron_purchase(uuid, text, text)
  to service_role;
revoke execute on function public.redeem_neuron_purchase(uuid, text, text)
  from public, anon, authenticated;
