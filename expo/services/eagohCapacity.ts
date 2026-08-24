/**
 * EAGOH slot capacity foundation (Phase 4A).
 *
 * Centralizes the permanent EAGOH-slot entitlement model:
 *   - Pro access includes 2 EAGOHs.
 *   - An account can hold at most 5 EAGOHs.
 *   - Up to 3 additional slots may come from grandfathered legacy capacity or
 *     future Neuron purchases (750 per slot — the purchase flow arrives in a
 *     later phase and must run server-side only).
 *
 * Tables (see supabase-eagoh-slot-entitlements-migration.sql):
 *   - public.eagoh_slot_entitlements — one row per user, owner read-only via RLS
 *   - public.eagoh_slot_transactions — immutable audit log, owner read-only via RLS
 *
 * This module is READ-ONLY by design: no client-side insert or update
 * operations live here. Slot grants and purchases are performed exclusively
 * by secure server-side code.
 */
import { supabase } from "@/lib/supabase";
import { hasProAccess, type SubscriptionTier } from "@/services/tiers";

// ── Capacity constants ───────────────────────────────────────────────────

/** EAGOHs included with Pro access. */
export const PRO_INCLUDED_EAGOHS = 2;

/** Hard per-account ceiling on simultaneous EAGOHs. */
export const MAX_EAGOHS_PER_ACCOUNT = 5;

/** Neuron price of one additional EAGOH slot (purchase flow lands in a later phase). */
export const EAGOH_SLOT_COST = 750;

/** Maximum additional slots beyond the Pro-included EAGOHs (5 − 2). */
export const MAX_ADDITIONAL_EAGOH_SLOTS =
  MAX_EAGOHS_PER_ACCOUNT - PRO_INCLUDED_EAGOHS;

// ── Entitlement shape ────────────────────────────────────────────────────

/** A user's additional EAGOH-slot entitlement state. */
export type EagohSlotEntitlement = {
  userId: string;
  purchasedSlots: number;
  grandfatheredSlots: number;
  totalAdditionalSlots: number;
};

// ── Pure helpers ─────────────────────────────────────────────────────────

/**
 * Clamp purchased slots into the valid 0–MAX_ADDITIONAL_EAGOH_SLOTS range.
 * Non-finite values resolve to 0.
 */
export function clampPurchasedSlots(purchased: number): number {
  if (!Number.isFinite(purchased)) return 0;
  return Math.min(
    Math.max(Math.trunc(purchased), 0),
    MAX_ADDITIONAL_EAGOH_SLOTS,
  );
}

/**
 * Clamp grandfathered slots into the valid 0–MAX_ADDITIONAL_EAGOH_SLOTS range.
 * Non-finite values resolve to 0.
 */
export function clampGrandfatheredSlots(grandfathered: number): number {
  if (!Number.isFinite(grandfathered)) return 0;
  return Math.min(
    Math.max(Math.trunc(grandfathered), 0),
    MAX_ADDITIONAL_EAGOH_SLOTS,
  );
}

/**
 * Resolve clamped slot counts from raw values.
 *
 * Purchased slots take priority (they were paid for); grandfathered slots are
 * capped by whatever room remains under the combined additional-slot ceiling,
 * so the returned total never exceeds MAX_ADDITIONAL_EAGOH_SLOTS.
 */
function resolveSlotCounts(
  purchasedRaw: number,
  grandfatheredRaw: number,
): {
  purchasedSlots: number;
  grandfatheredSlots: number;
  totalAdditionalSlots: number;
} {
  const purchasedSlots = clampPurchasedSlots(purchasedRaw);
  const grandfatheredSlots = Math.min(
    clampGrandfatheredSlots(grandfatheredRaw),
    Math.max(MAX_ADDITIONAL_EAGOH_SLOTS - purchasedSlots, 0),
  );
  return {
    purchasedSlots,
    grandfatheredSlots,
    totalAdditionalSlots: purchasedSlots + grandfatheredSlots,
  };
}

/**
 * Total additional slots (purchased + grandfathered), never exceeding
 * MAX_ADDITIONAL_EAGOH_SLOTS.
 */
export function getTotalAdditionalSlots(
  entitlement?: EagohSlotEntitlement | null,
): number {
  return resolveSlotCounts(
    entitlement?.purchasedSlots ?? 0,
    entitlement?.grandfatheredSlots ?? 0,
  ).totalAdditionalSlots;
}

/**
 * Active EAGOH capacity for a resolved subscription tier.
 *
 * Free → 0. Any tier with Pro access (pro, oracle_elite, syndicate) →
 * PRO_INCLUDED_EAGOHS + additional slots, capped at MAX_EAGOHS_PER_ACCOUNT.
 */
export function getEagohCapacity(
  tier: SubscriptionTier,
  entitlement?: EagohSlotEntitlement | null,
): number {
  if (!hasProAccess(tier)) return 0;
  return Math.min(
    PRO_INCLUDED_EAGOHS + getTotalAdditionalSlots(entitlement),
    MAX_EAGOHS_PER_ACCOUNT,
  );
}

/**
 * How many additional slots the user can still purchase. The combined
 * additional capacity (purchased + grandfathered) is capped at
 * MAX_ADDITIONAL_EAGOH_SLOTS, so grandfathered capacity reduces what remains
 * purchasable.
 */
export function getRemainingPurchasableSlots(
  entitlement?: EagohSlotEntitlement | null,
): number {
  return Math.max(
    MAX_ADDITIONAL_EAGOH_SLOTS - getTotalAdditionalSlots(entitlement),
    0,
  );
}

// ── Read-only service ────────────────────────────────────────────────────

/**
 * Read the current user's EAGOH slot entitlement.
 *
 * Returns a zero-slot entitlement when no row exists yet. Read-only: slot
 * grants and purchases happen server-side only — never through this module.
 */
export async function getEagohSlotEntitlement(
  userId: string,
): Promise<EagohSlotEntitlement> {
  const { data, error } = await supabase
    .from("eagoh_slot_entitlements")
    .select("user_id, purchased_slots, grandfathered_slots")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn(
      `[EagohCapacity] Failed to load slot entitlement: ${String(
        error.message ?? "unknown error",
      ).slice(0, 300)}`,
    );
    throw new Error(
      "Could not load your EAGOH slot entitlement. Please try again.",
    );
  }

  if (!data) {
    return {
      userId,
      purchasedSlots: 0,
      grandfatheredSlots: 0,
      totalAdditionalSlots: 0,
    };
  }

  const counts = resolveSlotCounts(
    data.purchased_slots ?? 0,
    data.grandfathered_slots ?? 0,
  );
  return {
    userId: data.user_id ?? userId,
    purchasedSlots: counts.purchasedSlots,
    grandfatheredSlots: counts.grandfatheredSlots,
    totalAdditionalSlots: counts.totalAdditionalSlots,
  };
}
