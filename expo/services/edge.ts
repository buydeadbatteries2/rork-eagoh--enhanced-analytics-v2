import { supabase } from "@/lib/supabase";
import { getQuickCheckCost } from "@/services/analyst";
import { getEffectiveSubscriptionTier, updateProfile, type UserProfile } from "@/services/profile";
import type { SubscriptionTier } from "@/services/tiers";

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

/** Monthly subscription Neuron allocations per tier. */
export const TIER_MONTHLY_ALLOCATION: Record<SubscriptionTier, number> = {
  free: 25,
  pro: 600,
  oracle_elite: 1400,
  syndicate: 3700,
};

/** Free tier receives 25 Neurons on their first month, then 10 per month thereafter. */
export const FREE_INITIAL_ALLOCATION = 25;
export const FREE_RECURRING_ALLOCATION = 10;

/** Maximum number of user-forged EAGOHs per tier. Default shells are excluded. */
export const TIER_MAX_EAGOHS: Record<SubscriptionTier, number> = {
  free: 0,
  pro: 2,
  oracle_elite: 3,
  syndicate: 5,
};

/** Edge efficiency multiplier per tier. */
export const TIER_MULTIPLIER: Record<SubscriptionTier, number> = {
  free: 0,
  pro: 1.0,
  oracle_elite: 1.2,
  syndicate: 1.5,
};

/** Rollover cap and retention requirement (10% each). Free tier never rolls over. */
export const ROLLOVER_CAP_PCT = 0.1;
export const ROLLOVER_RETENTION_PCT = 0.1;

/**
 * Returns the free tier allocation for this period.
 * First month: 25. Subsequent months: 10.
 */
export function getFreeTierAllocation(lastAllocation: number | undefined | null): number {
  return lastAllocation && lastAllocation > 0 ? FREE_RECURRING_ALLOCATION : FREE_INITIAL_ALLOCATION;
}

export function getBalances(
  profile: Pick<UserProfile, "edge_subscription" | "edge_purchased">,
): EdgeBalances {
  const subscription = Math.max(0, profile.edge_subscription ?? 0);
  const purchased = Math.max(0, profile.edge_purchased ?? 0);
  return { subscription, purchased, total: subscription + purchased };
}

async function logTransaction(entry: Omit<EdgeTransaction, "id" | "created_at">): Promise<void> {
  const { error } = await supabase.from("edge_transactions").insert(entry);
  if (error) {
    console.warn("[edge] failed to log transaction", error.message);
  }
}

/**
 * Spend Edge — subscription bucket first, then purchased. Throws when balance
 * is insufficient. Writes a `deduction` transaction.
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

  // Use the provided effective tier (which may include a dev test override),
  // otherwise fall back to computing from the raw DB profile.
  const tier = effectiveTier ?? getEffectiveSubscriptionTier(profile);
  if (tier === "free" && reason !== "quick_check") {
    throw new Error("Upgrade to Pro or higher to use this feature.");
  }

  const { total, subscription, purchased } = getBalances(profile);
  if (cost > total) throw new Error("Insufficient Neuron balance");

  const fromSub = Math.min(subscription, cost);
  const fromPurchased = cost - fromSub;
  const nextSub = subscription - fromSub;
  const nextPurchased = purchased - fromPurchased;

  const next = await updateProfile(userId, {
    edge_subscription: nextSub,
    edge_purchased: nextPurchased,
  });

  await logTransaction({
    user_id: userId,
    kind: "deduction",
    reason,
    amount: cost,
    bucket: fromSub > 0 && fromPurchased > 0 ? "mixed" : fromPurchased > 0 ? "purchased" : "subscription",
    from_subscription: fromSub,
    from_purchased: fromPurchased,
    balance_subscription_after: nextSub,
    balance_purchased_after: nextPurchased,
    note: note ?? null,
  });

  return next;
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

/** Add purchased Edge (mock purchase). Logs a `purchase` transaction. */
export async function addPurchasedEdge(
  userId: string,
  profile: UserProfile,
  amount: number,
  note?: string,
): Promise<UserProfile> {
  const add = Math.max(0, Math.floor(amount));
  if (add === 0) return profile;
  const nextPurchased = (profile.edge_purchased ?? 0) + add;
  const next = await updateProfile(userId, { edge_purchased: nextPurchased });
  await logTransaction({
    user_id: userId,
    kind: "purchase",
    reason: "purchase",
    amount: add,
    bucket: "purchased",
    from_subscription: 0,
    from_purchased: 0,
    balance_subscription_after: profile.edge_subscription ?? 0,
    balance_purchased_after: nextPurchased,
    note: note ?? "Mock Edge purchase",
  });
  return next;
}

/** Add subscription Edge (manual top-up / bonus). Logs an `addition`. */
export async function addSubscriptionEdge(
  userId: string,
  profile: UserProfile,
  amount: number,
  reason: EdgeReason = "manual",
  note?: string,
): Promise<UserProfile> {
  const add = Math.max(0, Math.floor(amount));
  if (add === 0) return profile;
  const nextSub = (profile.edge_subscription ?? 0) + add;
  const next = await updateProfile(userId, { edge_subscription: nextSub });
  await logTransaction({
    user_id: userId,
    kind: "addition",
    reason,
    amount: add,
    bucket: "subscription",
    from_subscription: 0,
    from_purchased: 0,
    balance_subscription_after: nextSub,
    balance_purchased_after: profile.edge_purchased ?? 0,
    note: note ?? null,
  });
  return next;
}

/**
 * Monthly subscription rollover.
 *
 * Rule: rollover keeps up to {@link ROLLOVER_CAP_PCT} (10%) of the prior month's
 * allocation, but ONLY if the user retained at least {@link ROLLOVER_RETENTION_PCT}
 * (10%) of that allocation at the moment of rollover. Otherwise the leftover
 * subscription Edge is forfeited. Purchased Edge is never touched.
 *
 * Then the new month's allocation is added on top.
 */
export async function applyMonthlyRollover(
  userId: string,
  profile: UserProfile,
  tier: SubscriptionTier,
): Promise<UserProfile> {
  const now = new Date().toISOString();

  // ── Free tier: no rollover, capped allocation ──────────────────────
  if (tier === "free") {
    const lastAlloc = profile.last_allocation;
    const allocation = getFreeTierAllocation(lastAlloc);

    // Set subscription balance directly to the allocation (cap, no rollover).
    // Purchased neurons are never touched.
    const next = await updateProfile(userId, {
      edge_subscription: allocation,
      last_rollover_at: now,
      last_allocation: allocation,
    });

    await logTransaction({
      user_id: userId,
      kind: "addition",
      reason: "subscription_allocation",
      amount: allocation,
      bucket: "subscription",
      from_subscription: 0,
      from_purchased: 0,
      balance_subscription_after: allocation,
      balance_purchased_after: profile.edge_purchased ?? 0,
      note: `Free tier monthly allocation (${allocation} Neurons, no rollover)`,
    });

    return next;
  }

  // ── Paid tiers: standard rollover + allocation ─────────────────────
  const allocation = TIER_MONTHLY_ALLOCATION[tier] ?? 0;
  const priorAllocation = Math.max(0, profile.last_allocation ?? allocation);
  const currentSub = Math.max(0, profile.edge_subscription ?? 0);

  const retentionThreshold = Math.floor(priorAllocation * ROLLOVER_RETENTION_PCT);
  const cap = Math.floor(priorAllocation * ROLLOVER_CAP_PCT);
  const rollover = currentSub >= retentionThreshold ? Math.min(currentSub, cap) : 0;

  const nextSub = rollover + allocation;

  const next = await updateProfile(userId, {
    edge_subscription: nextSub,
    last_rollover_at: now,
    last_allocation: allocation,
  });

  await logTransaction({
    user_id: userId,
    kind: "rollover",
    reason: "rollover",
    amount: rollover,
    bucket: "subscription",
    from_subscription: 0,
    from_purchased: 0,
    balance_subscription_after: rollover,
    balance_purchased_after: profile.edge_purchased ?? 0,
    note: `Rollover ${rollover} of ${priorAllocation} (retention ${retentionThreshold})`,
  });

  if (allocation > 0) {
    await logTransaction({
      user_id: userId,
      kind: "addition",
      reason: "subscription_allocation",
      amount: allocation,
      bucket: "subscription",
      from_subscription: 0,
      from_purchased: 0,
      balance_subscription_after: nextSub,
      balance_purchased_after: profile.edge_purchased ?? 0,
      note: `${tier} monthly allocation`,
    });
  }

  return next;
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
