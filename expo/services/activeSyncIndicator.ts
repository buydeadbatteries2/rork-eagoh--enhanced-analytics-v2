/**
 * Phase D2.3S — Active-Sync Listing Indicator.
 *
 * Pure, testable logic that decides whether an Exchange listing is
 * "Sync Live" for the authenticated buyer: every marketplace listing is
 * compared against the buyer's active sync records
 * (public.marketplace_sync_purchases, loaded by the account-wide
 * ["exchange-active-syncs", userId] React Query dataset).
 *
 * A live match requires ALL of:
 *   - buyer_id = authenticated user (guaranteed: the dataset is loaded with
 *     buyer_id = userId and RLS enforces it — never re-filtered here)
 *   - buyer_eagoh_id = the currently selected "Browsing as" EAGOH
 *   - eagoh_id (vendor EAGOH) = the listing's EAGOH
 *   - active = true
 *   - purchase_status = "completed" (null tolerated only for legacy rows on
 *     unmigrated databases, where active is the single source of truth;
 *     refunded/reversed/disputed/invalidated/admin-revoked purchases all set
 *     active = false and/or a non-completed status, so they are never live)
 *   - started_at <= current time
 *   - expires_at > current time
 *
 * Expiry only changes the indicator — expired records are preserved in
 * Purchase History and never deleted.
 */

import type { EnrichedPurchase } from "@/services/marketplace";

/** The live-sync state a listing button renders ("Sync Live · 2d 4h left"). */
export type LiveSyncView = {
  purchaseId: string;
  /** Vendor EAGOH — the EAGOH the listing sells access to. */
  eagohId: string;
  /** Buyer EAGOH the sync is attributed to (the "Browsing as" EAGOH). */
  buyerEagohId: string;
  syncLevel: string;
  days: number;
  startedAt: string;
  expiresAt: string;
  /** Human-readable remaining time, e.g. "2d 4h left". */
  timeLeft: string;
};

export type ListingPurchaseAction =
  | { action: "purchase" }
  | { action: "sync-details"; live: LiveSyncView };

/** The fields of a sync-purchase row the liveness check reads. */
type LiveSyncRow = Pick<
  EnrichedPurchase,
  "active" | "purchase_status" | "started_at" | "expires_at"
>;

/** Whether a sync-purchase row is live right now. */
export function isLiveSyncPurchase(
  row: LiveSyncRow,
  nowMs: number = Date.now(),
): boolean {
  if (row.active !== true) return false;
  // Legacy rows created before the trusted status column existed carry a null
  // purchase_status; active = true is authoritative there. Any non-completed
  // status (refunded, reversed, disputed, invalidated, admin-revoked,
  // expired) is never live.
  if (row.purchase_status != null && row.purchase_status !== "completed") return false;
  const started = new Date(row.started_at).getTime();
  const expires = new Date(row.expires_at).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(expires)) return false;
  return started <= nowMs && expires > nowMs;
}

/** Human-readable remaining time until the sync expires. */
export function formatSyncTimeLeft(expiresAt: string, nowMs: number = Date.now()): string {
  const diff = new Date(expiresAt).getTime() - nowMs;
  if (diff <= 0) return "expired";
  const totalMinutes = Math.floor(diff / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m left`;
  const hours = Math.floor(totalMinutes / 60);
  if (hours < 24) return `${hours}h left`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h left`;
}

/** Builds the renderable live-sync view for one purchase row. */
export function buildLiveSyncView(
  purchase: EnrichedPurchase,
  nowMs: number = Date.now(),
): LiveSyncView {
  return {
    purchaseId: purchase.id,
    eagohId: purchase.eagoh_id,
    buyerEagohId: purchase.buyer_eagoh_id ?? "",
    syncLevel: purchase.sync_level,
    days: purchase.days,
    startedAt: purchase.started_at,
    expiresAt: purchase.expires_at,
    timeLeft: formatSyncTimeLeft(purchase.expires_at, nowMs),
  };
}

/**
 * Finds the live sync matching one listing for ONE buyer EAGOH
 * (buyer_eagoh_id + vendor eagoh_id + live window). When multiple live rows
 * exist for the same pair, the one with the latest expiry wins.
 * Returns null when the buyer EAGOH is not selected or no row is live.
 */
export function findLiveSyncForListing(
  activeSyncs: EnrichedPurchase[],
  buyerEagohId: string | null | undefined,
  listingEagohId: string,
  nowMs: number = Date.now(),
): LiveSyncView | null {
  if (!buyerEagohId) return null;
  let best: LiveSyncView | null = null;
  let bestExpiry = Number.NEGATIVE_INFINITY;
  for (const row of activeSyncs) {
    if (row.buyer_eagoh_id !== buyerEagohId) continue;
    if (row.eagoh_id !== listingEagohId) continue;
    if (!isLiveSyncPurchase(row, nowMs)) continue;
    const expiry = new Date(row.expires_at).getTime();
    if (expiry > bestExpiry) {
      bestExpiry = expiry;
      best = buildLiveSyncView(row, nowMs);
    }
  }
  return best;
}

/**
 * Builds a map of vendor EAGOH id → live sync view for ONE buyer EAGOH.
 * Recomputed whenever the selected "Browsing as" EAGOH, the active-syncs
 * dataset, or the clock tick changes — so switching EAGOHs recalculates the
 * live status (sync attribution belongs to the selected buyer EAGOH).
 */
export function buildLiveSyncMap(
  activeSyncs: EnrichedPurchase[],
  buyerEagohId: string | null | undefined,
  nowMs: number = Date.now(),
): Map<string, LiveSyncView> {
  const map = new Map<string, LiveSyncView>();
  if (!buyerEagohId) return map;
  for (const row of activeSyncs) {
    if (row.buyer_eagoh_id !== buyerEagohId) continue;
    if (!isLiveSyncPurchase(row, nowMs)) continue;
    const existing = map.get(row.eagoh_id);
    if (!existing || new Date(row.expires_at).getTime() > new Date(existing.expiresAt).getTime()) {
      map.set(row.eagoh_id, buildLiveSyncView(row, nowMs));
    }
  }
  return map;
}

/**
 * Resolves what a listing's purchase button should do when pressed:
 *   - "purchase"      → open the purchase flow as before
 *   - "sync-details"  → the sync is live: open the buyer's Active Sync
 *                       details instead — the purchase modal is never opened
 *                       and the purchase RPC is never called a second time
 */
export function resolveListingPurchaseAction(params: {
  listingEagohId: string;
  buyerEagohId: string | null | undefined;
  activeSyncs: EnrichedPurchase[];
  nowMs?: number;
}): ListingPurchaseAction {
  const live = findLiveSyncForListing(
    params.activeSyncs,
    params.buyerEagohId,
    params.listingEagohId,
    params.nowMs,
  );
  return live ? { action: "sync-details", live } : { action: "purchase" };
}
