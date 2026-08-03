import { supabase } from "@/lib/supabase";
import { getQuickCheckCost } from "@/services/analyst";
import { getEffectiveSubscriptionTier, type UserProfile } from "@/services/profile";
import {
  TIER_MAX_EAGOHS as TIER_MAX_EAGOHS_SHARED,
  TIER_MONTHLY_ALLOCATION as TIER_MONTHLY_ALLOCATION_SHARED,
  TIER_MULTIPLIER as TIER_MULTIPLIER_SHARED,
  type SubscriptionTier,
} from "@/services/tiers";

/**
 * Edge wallet service.
 *
 * Two buckets per user:
 *  - `subscription` Edge: refilled monthly from the user's tier allocation.
 *    Rolls over up to 10% of the prior allocation, ONLY if the user still
 *    retains at least 10% of that allocation at the rollover moment.
 *  - `purchased` Edge: permanent. Never expires, always rolls over.
 *
 * Spend priority is always subscription first, purchased second. Every
 * mutation writes an entry to `edge_transactions` for full history.
 *
 * NOTE: All "purchases" are mock — no real payments are processed.
 */

export type EdgeBalances = { subscription: number; purchased: number; total: number };

export type EdgeReason =
  | "quick_check"
  | "quick_analysis"
  | "standard_analysis"
  | "oracle_dive"
  | "premium_event"
  | "arena"
  | "observation"
  | "marketplace"
  | "customization"
  | "forge_initial"
  | "forge_full_reforge"
  | "forge_partial_reforge"
  | "rename_eagoh"
  | "subscription_allocation"
  | "rollover"
  | "purchase"
  | "faction_slot_expansion"
  | "sponsored_banner"
  | "manual";

export type EdgeTransactionKind = "deduction" | "addition" | "rollover" | "purchase";

export type EdgeTransaction = {
  id: string;
  user_id: string;
  kind: EdgeTransactionKind;
  reason: EdgeReason;
  amount: number;
  bucket: "subscription" | "purchased" | "mixed";
  from_subscription: number;
  from_purchased: number;
  balance_subscription_after: number;
  balance_purchased_after: number;
  note: string | null;
  created_at: string;
};

/** Default Edge cost for each deductible action. Tweak freely. */
export const EDGE_COSTS: Record<
  | "observation"
  | "marketplace"
  | "customization"
  | "forge_initial"
  | "forge_full_reforge"
  | "forge_partial_reforge"
  | "rename_eagoh",
  number
> = {
  observation: 10,
  marketplace: 25,
  customization: 15,
  forge_initial: 250,
  forge_full_reforge: 500,
  forge_partial_reforge: 100,
  rename_eagoh: 75,
};

/** Helper for the Forge confirmation flow. */
export function getForgeCost(mode: "initial" | "full_reforge" | "partial_reforge"): number {
  if (mode === "initial") return EDGE_COSTS.forge_initial;
  if (mode === "full_reforge") return EDGE_COSTS.forge_full_reforge;
  return EDGE_COSTS.forge_partial_reforge;
}

/** Monthly subscription Neuron allocations per tier — re-exported from tiers.ts (single source of truth). */
export const TIER_MONTHLY_ALLOCATION = TIER_MONTHLY_ALLOCATION_SHARED;

/** Free tier receives 25 Neurons every month. No rollover. */
export const FREE_INITIAL_ALLOCATION = 25;
export const FREE_RECURRING_ALLOCATION = 25;

/** Maximum number of user-forged EAGOHs per tier — re-exported from tiers.ts (single source of truth). */
export const TIER_MAX_EAGOHS = TIER_MAX_EAGOHS_SHARED;

/** Edge efficiency multiplier per tier — re-exported from tiers.ts (single source of truth). */
export const TIER_MULTIPLIER = TIER_MULTIPLIER_SHARED;

/** Rollover cap and retention requirement (10% each). Free tier never rolls over. */
export const ROLLOVER_CAP_PCT = 0.1;
export const ROLLOVER_RETENTION_PCT = 0.1;

/**
 * Returns the free tier allocation for this period.
 * Every month: 25 Neurons.
 */
export function getFreeTierAllocation(lastAllocation: number | undefined | null): number {
  // Free tier always receives 25 Neurons per month.
  void lastAllocation;
  return FREE_INITIAL_ALLOCATION;
}

export function getBalances(
  profile: Pick<UserProfile, "edge_subscription" | "edge_purchased">,
): EdgeBalances {
  const subscription = Math.max(0, profile.edge_subscription ?? 0);
  const purchased = Math.max(0, profile.edge_purchased ?? 0);
  return { subscription, purchased, total: subscription + purchased };
}

/**
 * Spend Edge — subscription bucket first, then purchased. Throws when balance
 * is insufficient. The server computes the new balances and inserts the audit
 * transaction row via the `spend_own_edge` SECURITY DEFINER RPC.
 *
 * The client NEVER sends final balance values — it sends only the amount and
 * reason. The server locks the profile row, validates sufficient balance,
 * deducts subscription-first/purchased-second, and returns the new balances.
 */
export async function spendEdge(
  userId: string,
  profile: UserProfile,
  amount: number,
  reason: EdgeReason,
  note?: string,
  effectiveTier?: SubscriptionTier,
): Promise<UserProfile> {
  const cost = Math.max(0, Math.floor(amount));
  if (cost === 0) return profile;

  // Client-side UX guard — the server RPC also validates balance.
  const tier = effectiveTier ?? getEffectiveSubscriptionTier(profile);
  if (tier === "free" && reason !== "quick_check") {
    throw new Error("Upgrade to Pro or higher to use this feature.");
  }

  const { total } = getBalances(profile);
  if (cost > total) throw new Error("Insufficient Neuron balance");

  // Server-side deduction: locks row, validates balance, deducts, audits.
  const { data, error } = await supabase.rpc("spend_own_edge", {
    p_user_id: userId,
    p_amount: cost,
    p_reason: reason,
    p_note: note ?? null,
  });
  if (error) throw error;
  const result = data as { ok: boolean; new_subscription: number; new_purchased: number; error?: string };
  if (!result.ok) throw new Error(result.error ?? "Edge deduction failed");

  // Merge server-computed balances into the profile.
  return {
    ...profile,
    edge_subscription: result.new_subscription,
    edge_purchased: result.new_purchased,
  };
}

/** Convenience deduction helpers for the standard action surfaces. */
export const deductForQuickCheck = (
  userId: string,
  profile: UserProfile,
  prompt: string,
  note?: string,
  effectiveTier?: SubscriptionTier,
) => spendEdge(userId, profile, getQuickCheckCost(prompt), "quick_check", note, effectiveTier);

export const deductForObservation = (
  userId: string,
  profile: UserProfile,
  note?: string,
  effectiveTier?: SubscriptionTier,
) => spendEdge(userId, profile, EDGE_COSTS.observation, "observation", note, effectiveTier);

export const deductForMarketplace = (
  userId: string,
  profile: UserProfile,
  amount?: number,
  note?: string,
  effectiveTier?: SubscriptionTier,
) => spendEdge(userId, profile, amount ?? EDGE_COSTS.marketplace, "marketplace", note, effectiveTier);

export const deductForCustomization = (
  userId: string,
  profile: UserProfile,
  amount?: number,
  note?: string,
  effectiveTier?: SubscriptionTier,
) => spendEdge(userId, profile, amount ?? EDGE_COSTS.customization, "customization", note, effectiveTier);

/**
 * Add purchased Edge after a verified RevenueCat/App Store purchase.
 * The server credits `edge_purchased` via the `grant_purchased_edge` SECURITY
 * DEFINER RPC. The client NEVER touches `edge_subscription` or sends final
 * balance values. The server locks the row, adds the amount, and audits.
 */
export async function addPurchasedEdge(
  userId: string,
  profile: UserProfile,
  amount: number,
  note?: string,
): Promise<UserProfile> {
  const add = Math.max(0, Math.floor(amount));
  if (add === 0) return profile;

  const { data, error } = await supabase.rpc("grant_purchased_edge", {
    p_user_id: userId,
    p_amount: add,
    p_note: note ?? null,
  });
  if (error) throw error;
  const result = data as { ok: boolean; new_subscription: number; new_purchased: number; error?: string };
  if (!result.ok) throw new Error(result.error ?? "Edge purchase credit failed");

  return {
    ...profile,
    edge_subscription: result.new_subscription,
    edge_purchased: result.new_purchased,
  };
}

/**
 * @deprecated Subscription neurons are ONLY granted by:
 *   - the backend /subscription/sync endpoint (RevenueCat-verified)
 *   - the backend /complimentary/allocate endpoint (admin-controlled)
 *   - the apply_free_tier_allocation RPC (free-tier monthly grant)
 * The client must NEVER add subscription neurons directly.
 */
export async function addSubscriptionEdge(
  _userId: string,
  _profile: UserProfile,
  _amount: number,
  _reason?: EdgeReason,
  _note?: string,
): Promise<never> {
  throw new Error(
    "Subscription neurons can only be granted by the backend /subscription/sync or /complimentary/allocate endpoints. " +
    "The client must never add subscription neurons directly.",
  );
}

/**
 * Monthly allocation for the FREE tier only.
 *
 * Calls the `apply_free_tier_allocation` SECURITY DEFINER RPC which:
 *   - locks the profile row FOR UPDATE
 *   - verifies the effective tier is actually free (server-side check)
 *   - checks monthly idempotency (last_rollover_at month vs current month)
 *   - sets edge_subscription = 25 (no rollover for free tier)
 *   - inserts an edge_transactions audit row
 *   - returns the new balances
 *
 * Paid-tier allocations are handled exclusively by the backend
 * /subscription/sync endpoint. The client must NEVER call this for paid tiers.
 */
export async function applyMonthlyRollover(
  userId: string,
  profile: UserProfile,
  tier: SubscriptionTier,
): Promise<UserProfile> {
  if (tier !== "free") {
    throw new Error(
      "Paid tier allocations are handled by the backend /subscription/sync endpoint. " +
      "The client must never grant paid-tier subscription neurons.",
    );
  }

  const { data, error } = await supabase.rpc("apply_free_tier_allocation", {
    p_user_id: userId,
  });
  if (error) throw error;
  const result = data as {
    ok: boolean;
    already_allocated: boolean;
    new_subscription: number;
    new_purchased: number;
    last_rollover_at: string;
    last_allocation: number;
    error?: string;
  };
  if (!result.ok) throw new Error(result.error ?? "Free tier allocation failed");

  return {
    ...profile,
    edge_subscription: result.new_subscription,
    edge_purchased: result.new_purchased,
    last_rollover_at: result.last_rollover_at,
    last_allocation: result.last_allocation,
  };
}

/** Fetch the latest transaction history (newest first). */
export async function listTransactions(userId: string, limit: number = 50): Promise<EdgeTransaction[]> {
  const { data, error } = await supabase
    .from("edge_transactions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as EdgeTransaction[];
}
