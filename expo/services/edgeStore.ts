/**
 * Edge Store service — Neuron pack definitions and purchase logic.
 *
 * Product IDs and pack definitions are shared between the UI and the
 * RevenueCat integration layer.
 *
 * Mock/fake purchases are only allowed when BOTH:
 *  1. __DEV__ === true
 *  2. EXPO_PUBLIC_ENABLE_MOCK_NEURON_PURCHASES === "true"
 *
 * In TestFlight and production, only real RevenueCat purchases credit Neurons.
 *
 * Rules:
 *  - Purchased Neurons never expire and always roll over 100%.
 *  - Subscription Neurons are always spent first, purchased second.
 *  - The service layer enforces the spend priority; mutations log transactions.
 */

import { addPurchasedEdge } from "@/services/edge";
import { supabase } from "@/lib/supabase";
import type { UserProfile } from "@/services/profile";

/** Whether mock/fake Neuron purchases are allowed in the current environment. */
export const isMockPurchaseAllowed = (): boolean => {
  return __DEV__ && process.env.EXPO_PUBLIC_ENABLE_MOCK_NEURON_PURCHASES === "true";
};

/** RevenueCat product identifiers for Neuron packs. */
export const EDGE_PRODUCT_IDS = [
  "store_edge_250",
  "store_edge_750",
  "store_edge_2000",
  "store_edge_6000",
  "store_edge_15000",
] as const;
export type EdgeProductId = (typeof EDGE_PRODUCT_IDS)[number];

/** A Neuron pack definition shown in the store UI. */
export type EdgePack = {
  /** RevenueCat product ID. */
  productId: EdgeProductId;
  /** Neurons awarded on purchase. */
  edgeAmount: number;
  /** USD price displayed in the UI. */
  priceUsd: number;
  /** Display label (e.g. "250 Neurons"). */
  label: string;
  /** Optional badge shown on the pack card (e.g. "Best Value"). */
  badge: string | null;
  /** Lexicographic sort key so cheaper packs appear first. */
  sortKey: number;
};

/** All Neuron packs — single source of truth. */
export const EDGE_PACKS: EdgePack[] = [
  {
    productId: "store_edge_250",
    edgeAmount: 250,
    priceUsd: 4.99,
    label: "250 Neurons",
    badge: null,
    sortKey: 1,
  },
  {
    productId: "store_edge_750",
    edgeAmount: 750,
    priceUsd: 9.99,
    label: "750 Neurons",
    badge: null,
    sortKey: 2,
  },
  {
    productId: "store_edge_2000",
    edgeAmount: 2000,
    priceUsd: 19.99,
    label: "2,000 Neurons",
    badge: null,
    sortKey: 3,
  },
  {
    productId: "store_edge_6000",
    edgeAmount: 6000,
    priceUsd: 49.99,
    label: "6,000 Neurons",
    badge: "Best Value",
    sortKey: 4,
  },
  {
    productId: "store_edge_15000",
    edgeAmount: 15000,
    priceUsd: 99.99,
    label: "15,000 Neurons",
    badge: "Power User",
    sortKey: 5,
  },
];

/**
 * Execute a mock purchase for the given pack.
 *
 * ONLY call when isMockPurchaseAllowed() returns true.
 * This directly adds Neurons to `edge_purchased` with a descriptive
 * transaction note for testing purposes.
 */
export async function mockPurchasePack(
  userId: string,
  profile: UserProfile,
  pack: EdgePack,
): Promise<UserProfile> {
  const note = `Mock Neuron purchase: ${pack.label} (${pack.productId})`;
  return addPurchasedEdge(userId, profile, pack.edgeAmount, note);
}

// ── Idempotent Neuron purchase tracking (prevents double-crediting) ──────

/**
 * Record a RevenueCat consumable purchase so it is never credited twice.
 *
 * Uses a UNIQUE constraint on `revenuecat_transaction_id` to guarantee
 * idempotency. If the row already exists (code 23505), the purchase was
 * already processed and we return false.
 *
 * @returns true if this is a new purchase (should credit), false if duplicate.
 */
export async function recordNeuronPurchaseOnce(
  userId: string,
  productId: string,
  rcTransactionId: string,
  neuronsAmount: number,
): Promise<boolean> {
  const { error } = await supabase
    .from("neuron_purchases")
    .insert({
      user_id: userId,
      product_id: productId,
      revenuecat_transaction_id: rcTransactionId,
      neurons_granted: neuronsAmount,
    });

  if (error) {
    // Unique constraint violation → already credited (idempotent skip)
    if (error.code === "23505") {
      if (__DEV__) {
        console.log("[edgeStore] Neuron purchase already recorded — idempotent skip:", rcTransactionId);
      }
      return false;
    }
    // Other errors → let the caller decide
    console.warn("[edgeStore] Failed to record neuron purchase:", error.message);
    throw error;
  }

  return true;
}

// ── Subscription allocation tracking ──────────────────────────────────────

export type SubscriptionAllocation = {
  id: string;
  user_id: string;
  product_id: string;
  entitlement_period_start: string;
  entitlement_period_end: string | null;
  neurons_granted: number;
  revenuecat_transaction_id: string | null;
  created_at: string;
};

/**
 * Check if a subscription allocation already exists for a given
 * RevenueCat transaction ID or billing-period identifier.
 * Idempotency prevents duplicate Neuron grants across restarts/refreshes.
 */
export async function hasAllocationBeenGranted(
  userId: string,
  stableKey: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("subscription_allocations")
    .select("id")
    .eq("user_id", userId)
    .or(`revenuecat_transaction_id.eq.${stableKey},stable_key.eq.${stableKey}`)
    .limit(1);

  if (error) {
    console.warn("[edgeStore] hasAllocationBeenGranted error:", error.message);
    return false;
  }

  return (data?.length ?? 0) > 0;
}

/**
 * Record a subscription Neuron allocation so it is never granted twice.
 *
 * @param userId - The authenticated user's UUID
 * @param productId - RevenueCat product identifier (pro_subscription, oracle_elite_subscription, syndicate_subscription)
 * @param periodStart - ISO date of the entitlement period start
 * @param periodEnd - ISO date of the entitlement period end (null if ongoing)
 * @param neuronsGranted - Number of Neurons granted (600, 1400, or 3700)
 * @param transactionId - RevenueCat transaction ID or stable event key for idempotency
 */
export async function recordSubscriptionAllocation(
  userId: string,
  productId: string,
  periodStart: string,
  periodEnd: string | null,
  neuronsGranted: number,
  transactionId: string | null,
): Promise<void> {
  // Generate a stable key from the product + period start for idempotency
  const stableKey = transactionId ?? `${productId}_${periodStart}`;

  const { error } = await supabase
    .from("subscription_allocations")
    .insert({
      user_id: userId,
      product_id: productId,
      entitlement_period_start: periodStart,
      entitlement_period_end: periodEnd,
      neurons_granted: neuronsGranted,
      revenuecat_transaction_id: transactionId,
      stable_key: stableKey,
    });

  if (error) {
    // Unique constraint violation → already granted (expected, not an error)
    if (error.code === "23505") {
      if (__DEV__) {
        console.log("[edgeStore] Allocation already recorded — idempotent skip:", stableKey);
      }
      return;
    }
    console.warn("[edgeStore] Failed to record allocation:", error.message);
  }
}
