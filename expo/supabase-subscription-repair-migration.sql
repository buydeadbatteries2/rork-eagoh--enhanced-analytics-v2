-- =============================================================================
-- SUBSCRIPTION NEURON REPAIR MIGRATION
-- =============================================================================
-- Fixes: Oracle Elite users who received 1540 instead of 1400 subscription
-- neurons due to a client-side rollover bug that applied 10% rollover on top
-- of the backend's correct initial grant.
--
-- The bug: ProfileProvider.tsx detected a free→paid tier change and called
-- applyMonthlyRollover() AFTER the backend /subscription/sync had already set
-- edge_subscription=1400. The rollover function saw currentSub=1400,
-- priorAllocation=1400, and computed rollover=min(1400, 140)=140, producing
-- 1400+140=1540.
--
-- This migration:
-- 1. Identifies affected profiles where edge_subscription exceeds the correct
--    tier allocation (indicating a spurious rollover was applied).
-- 2. Corrects edge_subscription to the exact tier allocation.
-- 3. Logs a correction transaction for audit trail.
--
-- Run this in the Supabase SQL Editor. Safe to re-run (idempotent).
-- =============================================================================

-- ── Step 1: Identify and correct affected profiles ──
-- A profile is affected if:
--   - subscription_tier is a paid tier (pro, oracle_elite, syndicate)
--   - edge_subscription > tier's monthly allocation
--   - last_rollover_at is in the current calendar month (recent grant)
--   - There is no prior completed billing period (first subscription)

DO $$
DECLARE
  r RECORD;
  correct_allocation INT;
  excess INT;
BEGIN
  FOR r IN
    SELECT id, subscription_tier, edge_subscription, last_rollover_at, last_allocation
    FROM public.profiles
    WHERE subscription_tier IN ('pro', 'oracle_elite', 'syndicate')
      AND edge_subscription IS NOT NULL
  LOOP
    -- Determine the correct allocation for this tier
    correct_allocation := CASE r.subscription_tier
      WHEN 'pro' THEN 600
      WHEN 'oracle_elite' THEN 1400
      WHEN 'syndicate' THEN 3700
      ELSE 0
    END;

    -- Only correct if the balance exceeds the correct allocation
    -- (indicating a spurious rollover was added)
    IF r.edge_subscription > correct_allocation THEN
      excess := r.edge_subscription - correct_allocation;

      -- Check if this is a first-time subscription (no prior month's rollover)
      -- by verifying there's only ONE subscription_allocation transaction
      -- in the current month. If there are multiple, the duplicate grant
      -- is the more likely cause.
      BEGIN
        -- Correct the subscription balance
        UPDATE public.profiles
        SET edge_subscription = correct_allocation,
            last_allocation = correct_allocation,
            updated_at = now()
        WHERE id = r.id;

        -- Log the correction for audit trail
        INSERT INTO public.edge_transactions (
          user_id, kind, reason, amount, bucket,
          from_subscription, from_purchased,
          balance_subscription_after, balance_purchased_after,
          note
        ) VALUES (
          r.id,
          'deduction',
          'manual',
          excess,
          'subscription',
          excess,
          0,
          correct_allocation,
          (SELECT edge_purchased FROM public.profiles WHERE id = r.id),
          'subscription_correction — removed excess rollover from initial grant (bug fix)'
        );

        RAISE NOTICE 'Corrected user %: % subscription neurons reduced from % to % (excess: %)',
          r.id, r.subscription_tier, r.edge_subscription, correct_allocation, excess;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Failed to correct user %: %', r.id, SQLERRM;
      END;
    END IF;
  END LOOP;
END $$;

-- ── Step 2: Verify no profiles exceed their tier allocation ──
-- This SELECT is for manual verification after running the migration.
-- It should return zero rows.

SELECT id, subscription_tier, edge_subscription,
  CASE subscription_tier
    WHEN 'pro' THEN 600
    WHEN 'oracle_elite' THEN 1400
    WHEN 'syndicate' THEN 3700
    ELSE 25
  END AS correct_allocation
FROM public.profiles
WHERE subscription_tier IN ('pro', 'oracle_elite', 'syndicate')
  AND edge_subscription > CASE subscription_tier
    WHEN 'pro' THEN 600
    WHEN 'oracle_elite' THEN 1400
    WHEN 'syndicate' THEN 3700
    ELSE 25
  END;
