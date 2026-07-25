/**
 * EAGOH Identity Protection & Reforge Cost Utilities.
 *
 * - Rename cooldown & tier checks
 * - Section-by-section reforge cost calculation with bundle discounts
 */

import type { SubscriptionTier } from "@/services/profile";

// ── Constants ──────────────────────────────────────────────────────

/** Edge cost to rename an EAGOH. */
export const RENAME_EDGE_COST = 75;

/** Days a user must wait between renames. */
export const RENAME_COOLDOWN_DAYS = 30;

/** Tiers allowed to rename. Free users cannot rename. */
export const RENAME_ALLOWED_TIERS: readonly SubscriptionTier[] = [
  "pro",
  "oracle_elite",
  "syndicate",
];

/** Base cost per changed section (before bundle discounts). */
export const REFORGE_SECTION_COST = 15;

/**
 * Bundle discount pricing: maps number of changed sections → total Edge cost.
 * 1-3 sections use linear pricing (N × 15). 4+ sections use bundle discounts.
 */
export const REFORGE_BUNDLE_COSTS: Readonly<Record<number, number>> = {
  4: 50,
  5: 60,
  6: 70,
};

// ── Reforge cost calculation ───────────────────────────────────────

/** The six reforge sections that are compared. */
export const REFORGE_SECTIONS = [
  "headwear",
  "body",
  "footwear",
  "accessories",
  "styleNotes",
  "pose",
] as const;

export type ReforgeSection = (typeof REFORGE_SECTIONS)[number];

/** Appearance old state (from DB) + style notes + pose. */
export type RefogeComparisonState = {
  appearance: Record<string, string>;
  styleNotes: string;
  pose: string;
};

/**
 * Compare two states and return which sections changed + the final Edge cost.
 *
 * Pricing:
 *  - 0 changes → 0 Edge ("No modifications detected.")
 *  - 1-3 changes → N × 15 Edge
 *  - 4-6 changes → bundle discount:
 *     4 → 50  5 → 60  6 → 70
 */
export function calculateReforgeCost(
  oldState: RefogeComparisonState,
  newState: RefogeComparisonState,
): { changedSections: ReforgeSection[]; edgeCost: number } {
  const changed: ReforgeSection[] = [];

  const oldApp = oldState.appearance;
  const newApp = newState.appearance;

  if ((oldApp.headwear ?? "") !== (newApp.headwear ?? "")) changed.push("headwear");
  if ((oldApp.body ?? "") !== (newApp.body ?? "")) changed.push("body");
  if ((oldApp.footwear ?? "") !== (newApp.footwear ?? "")) changed.push("footwear");
  if ((oldApp.accessories ?? "") !== (newApp.accessories ?? "")) changed.push("accessories");
  if ((oldState.styleNotes ?? "") !== (newState.styleNotes ?? "")) changed.push("styleNotes");
  if ((oldState.pose ?? "") !== (newState.pose ?? "")) changed.push("pose");

  const count = changed.length;
  const edgeCost = REFORGE_BUNDLE_COSTS[count] ?? count * REFORGE_SECTION_COST;

  return { changedSections: changed, edgeCost };
}

// ── Rename utilities ───────────────────────────────────────────────

/**
 * Returns true if the user's tier permits renaming.
 */
export function canRenameEAGOH(tier: SubscriptionTier): boolean {
  return (RENAME_ALLOWED_TIERS as readonly string[]).includes(tier);
}

/**
 * Returns the remaining cooldown (in days) until the EAGOH can be renamed again.
 * Returns 0 if no cooldown is active (ready to rename or never renamed).
 */
export function getRenameCooldownRemaining(lastNameChange: string | null | undefined): number {
  if (!lastNameChange) return 0;

  const last = new Date(lastNameChange).getTime();
  const now = Date.now();
  const msPerDay = 1000 * 60 * 60 * 24;
  const elapsed = (now - last) / msPerDay;
  const remaining = RENAME_COOLDOWN_DAYS - elapsed;

  return Math.max(0, Math.ceil(remaining));
}
