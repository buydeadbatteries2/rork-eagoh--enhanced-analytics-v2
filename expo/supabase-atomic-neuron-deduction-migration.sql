-- ────────────────────────────────────────────────────────────────────────────
-- Atomic Neuron Deduction RPC Migration (Security Phase S2A)
--
-- Adds public.deduct_neurons_atomic(p_user_id, p_amount, p_reason,
-- p_idempotency_key, p_note): a SECURITY DEFINER RPC that atomically deducts
-- Neurons from a user's combined balance (subscription Neurons first,
-- purchased Neurons second) in a single transaction.
--
-- FOUNDATION ONLY: no screen, service, provider, or Worker route calls this
-- RPC yet. Future trusted Worker handlers will validate feature access and
-- the server-authoritative cost themselves before invoking it.
--
-- Atomic operation order (all-or-nothing):
--   1. Validate inputs:
--      - p_user_id must be non-null
--      - p_amount must be a positive integer (defensive max 10,000)
--      - p_idempotency_key must be a non-null UUID
--      - p_reason must be in the deduction-only whitelist below
--   2. Lock the user's profiles row (FOR UPDATE) — serializes all concurrent
--      same-user operations through this lock
--   3. AFTER the profile lock: idempotency lookup on edge_transactions
--   4. Duplicate → return {ok: true, duplicate: true} with current balances,
--      no deduction
--   5. Verify combined balance ≥ p_amount
--   6. Deduct subscription Neurons first
--   7. Deduct purchased Neurons second
--   8. Update the profile balances
--   9. Insert exactly one deduction ledger row
--  10. Return the updated balances
--
-- REASON WHITELIST (deduction-only):
--   quick_check, quick_analysis, standard_analysis, oracle_dive,
--   premium_event, observation, customization, rename_eagoh,
--   faction_slot_expansion
--
-- These reasons are REJECTED (they have dedicated secure flows and must
-- never travel through this generic RPC): manual, purchase,
-- subscription_allocation, rollover, eagoh_slot_purchase, sponsored_banner —
-- plus any arbitrary string.
--
-- AMOUNT BOUNDARY: this RPC accepts p_amount ONLY because it is
-- service_role-exclusive. Future Worker handlers must calculate or validate
-- the amount server-side and must NEVER forward an arbitrary client amount.
--
-- PERMISSIONS: execute is revoked from public/anon/authenticated and granted
-- ONLY to service_role. The mobile client must NEVER call this RPC directly —
-- the single permitted path is App → authenticated Worker route →
-- service-role RPC.
--
-- NOTE: This file is created only — it has NOT been executed against the live
-- Supabase project, and no code references the RPC yet.
-- ────────────────────────────────────────────────────────────────────────────

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Ledger idempotency column (nullable — existing rows are never touched)
-- ════════════════════════════════════════════════════════════════════════════

alter table public.edge_transactions
  add column if not exists idempotency_key uuid;

-- Per-user unique partial index. Drop-then-create keeps the migration safely
-- re-runnable if a previous run left a differently-shaped index behind.
-- Existing transaction rows (idempotency_key IS NULL) are excluded by the
-- partial predicate and are never modified or deleted.
drop index if exists public.idx_edge_transactions_idempotency;

create unique index idx_edge_transactions_idempotency
  on public.edge_transactions(user_id, idempotency_key)
  where idempotency_key is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Atomic deduction RPC
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.deduct_neurons_atomic(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_idempotency_key uuid,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub_balance   int;
  v_purch_balance int;
  v_from_sub      int;
  v_from_purch    int;
  v_is_duplicate  boolean;
begin
  -- ── 1. Validate inputs (fail fast, zero mutations) ──
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_user');
  end if;

  -- Positive integer with a defensive per-deduction maximum of 10,000.
  if p_amount is null or p_amount <= 0 or p_amount > 10000 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  if p_idempotency_key is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_idempotency_key');
  end if;

  -- Deduction-only reason whitelist. Credit/purchase-side reasons (manual,
  -- purchase, subscription_allocation, rollover, eagoh_slot_purchase,
  -- sponsored_banner) and arbitrary strings are rejected — marketplace sync
  -- purchases, banners, Forge, arena, and EAGOH-slot purchases use their own
  -- dedicated secure flows.
  if p_reason is null or p_reason not in (
    'quick_check',
    'quick_analysis',
    'standard_analysis',
    'oracle_dive',
    'premium_event',
    'observation',
    'customization',
    'rename_eagoh',
    'faction_slot_expansion'
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_reason');
  end if;

  -- ── 2. Lock the profile row — concurrent same-user operations serialize ──
  -- Balances are normalized to non-negative integers: legacy NULL behaves
  -- as zero, and corrupt negative values cannot increase available spending.
  -- Read-time normalization only — no separate write backfills or "heals"
  -- the profile; only a normal successful deduction updates it.
  select greatest(coalesce(edge_subscription, 0), 0),
         greatest(coalesce(edge_purchased, 0), 0)
    into v_sub_balance, v_purch_balance
    from public.profiles
    where id = p_user_id
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'profile_not_found');
  end if;

  -- ── 3. Idempotency check AFTER the profile lock ──
  select exists(
    select 1
      from public.edge_transactions
      where user_id = p_user_id
        and idempotency_key = p_idempotency_key
  ) into v_is_duplicate;

  -- ── 4. Duplicate → no deduction, current balances returned ──
  if v_is_duplicate then
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'subscription_balance', v_sub_balance,
      'purchased_balance', v_purch_balance,
      'combined_balance', v_sub_balance + v_purch_balance
    );
  end if;

  -- ── 5. Combined balance check — structured error, zero mutations ──
  if v_sub_balance + v_purch_balance < p_amount then
    return jsonb_build_object(
      'ok', false,
      'error', 'insufficient_balance',
      'subscription_balance', v_sub_balance,
      'purchased_balance', v_purch_balance,
      'combined_balance', v_sub_balance + v_purch_balance
    );
  end if;

  -- ── 6/7. Subscription Neurons first, purchased Neurons second ──
  v_from_sub   := least(v_sub_balance, p_amount);
  v_from_purch := p_amount - v_from_sub;

  -- ── 8. Update the profile balances ──
  update public.profiles
    set edge_subscription = v_sub_balance - v_from_sub,
        edge_purchased    = v_purch_balance - v_from_purch,
        updated_at        = now()
    where id = p_user_id;

  -- ── 9. Insert exactly one deduction ledger row ──
  insert into public.edge_transactions (
    user_id,
    kind,
    reason,
    amount,
    bucket,
    from_subscription,
    from_purchased,
    balance_subscription_after,
    balance_purchased_after,
    note,
    idempotency_key
  ) values (
    p_user_id,
    'deduction',
    p_reason,
    p_amount,
    case
      when v_from_sub > 0 and v_from_purch > 0 then 'mixed'
      when v_from_sub > 0 then 'subscription'
      else 'purchased'
    end,
    v_from_sub,
    v_from_purch,
    v_sub_balance - v_from_sub,
    v_purch_balance - v_from_purch,
    nullif(left(btrim(coalesce(p_note, '')), 300), ''),
    p_idempotency_key
  );

  -- ── 10. Return the updated balances ──
  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'deducted', p_amount,
    'from_subscription', v_from_sub,
    'from_purchased', v_from_purch,
    'subscription_balance', v_sub_balance - v_from_sub,
    'purchased_balance', v_purch_balance - v_from_purch,
    'combined_balance', (v_sub_balance - v_from_sub) + (v_purch_balance - v_from_purch)
  );

exception
  when others then
    -- Any unexpected SQL failure rolls back EVERY partial change (the
    -- exception block runs inside a subtransaction): no profile deduction,
    -- no ledger insertion. Return only a safe generic message — never raw
    -- SQL errors, SQLSTATE codes, constraint names, or database details.
    return jsonb_build_object(
      'ok', false,
      'error', 'Deduction failed. No Neurons were charged.'
    );
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Permissions — service_role only
-- ════════════════════════════════════════════════════════════════════════════

revoke execute on function public.deduct_neurons_atomic(uuid, integer, text, uuid, text) from public;
revoke execute on function public.deduct_neurons_atomic(uuid, integer, text, uuid, text) from anon;
revoke execute on function public.deduct_neurons_atomic(uuid, integer, text, uuid, text) from authenticated;
grant execute on function public.deduct_neurons_atomic(uuid, integer, text, uuid, text) to service_role;

commit;
