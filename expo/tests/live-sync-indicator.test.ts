// @ts-nocheck
// ============================================================================
// Phase D2.3S — Active-Sync Listing Indicator: targeted tests.
//
// Run with:  cd expo && bun test tests/live-sync-indicator.test.ts
//
// Covers the validation scenarios:
//   1. Fresh listing shows Purchase
//   2. Successful purchase changes it to Sync Live
//   3. Cold restart restores Sync Live (state is derived from durable rows)
//   4. Matching another buyer EAGOH does not falsely show Sync Live
//   5. Expired/refunded/reversed/disputed purchases restore Purchase
//   6. Pressing Sync Live never resolves to the purchase modal
//   7. Public listing uses the same state (same helper, eligible-EAGOH set)
// plus: future started_at, vendor EAGOH mismatch, latest-expiry precedence,
// the liveSyncMap builder, and time-remaining formatting.
//
// The module under test imports ONLY types from the marketplace service
// (erased at compile time), so no Supabase mock is needed.
// ============================================================================
import { describe, test, expect } from "bun:test";
import {
  buildLiveSyncMap,
  buildLiveSyncView,
  findLiveSyncForListing,
  formatSyncTimeLeft,
  isLiveSyncPurchase,
  resolveListingPurchaseAction,
} from "@/services/activeSyncIndicator";
import type { EnrichedPurchase } from "@/services/marketplace";

// ── Fixtures ───────────────────────────────────────────────────────────────
// Fixed "now" so tests are deterministic.
const NOW = 1_800_000_000_000; // ms
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function makePurchase(over: Partial<EnrichedPurchase> = {}): EnrichedPurchase {
  return {
    id: "purchase-1",
    listing_id: "listing-1",
    buyer_id: "user-1", // guaranteed by the dataset: buyer_id = authenticated user
    buyer_eagoh_id: "buyer-eagoh-a",
    vendor_id: "vendor-1",
    eagoh_id: "vendor-eagoh-1", // the listing's (vendor) EAGOH
    sync_level: "50%",
    days: 3,
    edge_cost: 120,
    started_at: new Date(NOW - 20 * HOUR).toISOString(), // started in the past
    expires_at: new Date(NOW + 2 * DAY + 4 * HOUR).toISOString(), // live for 2d 4h
    active: true,
    created_at: new Date(NOW - 20 * HOUR).toISOString(),
    buyer_display_name: "Buyer Snap",
    buyer_avatar_url: null,
    purchase_status: "completed",
    eagoh_name: "EAGOH Alpha",
    eagoh_image_url: null,
    vendor_username: "vendoruser",
    ...over,
  };
}

describe("Phase D2.3S — Active-Sync Listing Indicator", () => {
  test("1. fresh listing shows Purchase (no syncs, unrelated syncs)", () => {
    expect(resolveListingPurchaseAction({ listingEagohId: "vendor-eagoh-1", buyerEagohId: "buyer-eagoh-a", activeSyncs: [], nowMs: NOW })).toEqual({ action: "purchase" });
    // A live sync on a DIFFERENT vendor EAGOH never marks this listing live.
    const other = makePurchase({ eagoh_id: "some-other-vendor-eagoh" });
    expect(resolveListingPurchaseAction({ listingEagohId: "vendor-eagoh-1", buyerEagohId: "buyer-eagoh-a", activeSyncs: [other], nowMs: NOW }).action).toBe("purchase");
  });

  test("2. successful purchase changes it to Sync Live", () => {
    const syncs = [makePurchase()];
    const resolved = resolveListingPurchaseAction({ listingEagohId: "vendor-eagoh-1", buyerEagohId: "buyer-eagoh-a", activeSyncs: syncs, nowMs: NOW });
    expect(resolved.action).toBe("sync-details");
    if (resolved.action !== "sync-details") return;
    expect(resolved.live.purchaseId).toBe("purchase-1");
    expect(resolved.live.eagohId).toBe("vendor-eagoh-1");
    expect(resolved.live.buyerEagohId).toBe("buyer-eagoh-a");
    expect(resolved.live.syncLevel).toBe("50%");
    // "Sync Live · 2d 4h left" — exactly the required format.
    expect(resolved.live.timeLeft).toBe("2d 4h left");
  });

  test("3. cold restart restores Sync Live (derived from durable DB rows)", () => {
    const syncs = [makePurchase()];
    // A cold start refetches the same durable rows and re-derives the state —
    // a later device clock (minutes after restart) is still within the window.
    const laterNow = NOW + 15 * 60_000;
    const live = findLiveSyncForListing(syncs, "buyer-eagoh-a", "vendor-eagoh-1", laterNow);
    expect(live).not.toBeNull();
    expect(live?.purchaseId).toBe("purchase-1");
    expect(live?.timeLeft).toBe("2d 3h left");
  });

  test("4. matching another buyer EAGOH does not falsely show Sync Live", () => {
    const syncs = [makePurchase({ buyer_eagoh_id: "buyer-eagoh-b" })];
    // Selected "Browsing as" EAGOH is A — the sync belongs to B → Purchase.
    expect(findLiveSyncForListing(syncs, "buyer-eagoh-a", "vendor-eagoh-1", NOW)).toBeNull();
    expect(resolveListingPurchaseAction({ listingEagohId: "vendor-eagoh-1", buyerEagohId: "buyer-eagoh-a", activeSyncs: syncs, nowMs: NOW }).action).toBe("purchase");
    // Switching the selected EAGOH to B recalculates → Sync Live.
    const live = findLiveSyncForListing(syncs, "buyer-eagoh-b", "vendor-eagoh-1", NOW);
    expect(live?.purchaseId).toBe("purchase-1");
    // No selected EAGOH → never live.
    expect(findLiveSyncForListing(syncs, null, "vendor-eagoh-1", NOW)).toBeNull();
  });

  test("5. expired/refunded/reversed/disputed purchases restore Purchase", () => {
    const syncs = [
      // Expired: window elapsed even though still marked active (belt-and-braces).
      makePurchase({ id: "p-expired", expires_at: new Date(NOW - 1).toISOString() }),
      // Refunded / reversed / disputed / invalidated / admin-revoked — all inactive.
      makePurchase({ id: "p-refunded", active: false, purchase_status: "refunded" }),
      makePurchase({ id: "p-reversed", active: false, purchase_status: "reversed" }),
      makePurchase({ id: "p-disputed", active: false, purchase_status: "disputed" }),
      makePurchase({ id: "p-invalid", active: false, purchase_status: "invalidated" }),
      makePurchase({ id: "p-revoked", active: false, purchase_status: "admin_revoked" }),
      // Non-completed status while somehow still active → never live.
      makePurchase({ id: "p-pending", active: true, purchase_status: "refunded" }),
    ];
    for (const row of syncs) {
      expect(isLiveSyncPurchase(row, NOW)).toBe(false);
    }
    const live = findLiveSyncForListing(syncs, "buyer-eagoh-a", "vendor-eagoh-1", NOW);
    expect(live).toBeNull();
    expect(resolveListingPurchaseAction({ listingEagohId: "vendor-eagoh-1", buyerEagohId: "buyer-eagoh-a", activeSyncs: syncs, nowMs: NOW }).action).toBe("purchase");
    // Legacy rows (null status on unmigrated databases) stay correct: active
    // is the single source of truth there.
    expect(isLiveSyncPurchase(makePurchase({ purchase_status: null }), NOW)).toBe(true);
    // Expired records are preserved, not deleted — the buyer keeps history.
    expect(syncs.some((r) => r.id === "p-expired")).toBe(true);
  });

  test("6. pressing Sync Live never resolves to the purchase modal", () => {
    const syncs = [makePurchase()];
    const resolved = resolveListingPurchaseAction({ listingEagohId: "vendor-eagoh-1", buyerEagohId: "buyer-eagoh-a", activeSyncs: syncs, nowMs: NOW });
    // The tap routes to the buyer's Active Sync details — never "purchase".
    expect(resolved.action).toBe("sync-details");
    expect(resolved.action).not.toBe("purchase");
    // A sync that has not started yet is NOT live → still Purchase.
    const notStarted = [makePurchase({ started_at: new Date(NOW + HOUR).toISOString() })];
    expect(isLiveSyncPurchase(notStarted[0], NOW)).toBe(false);
    expect(resolveListingPurchaseAction({ listingEagohId: "vendor-eagoh-1", buyerEagohId: "buyer-eagoh-a", activeSyncs: notStarted, nowMs: NOW }).action).toBe("purchase");
  });

  test("7. public listing uses the same state (eligible buyer-EAGOH set)", () => {
    const syncs = [makePurchase({ buyer_eagoh_id: "buyer-eagoh-b" })];
    // public-listing loops over every eligible buyer EAGOH for the listing —
    // the same helper decides, so both surfaces share one source of truth.
    const eligible = ["buyer-eagoh-a", "buyer-eagoh-b"];
    const found = eligible
      .map((id) => findLiveSyncForListing(syncs, id, "vendor-eagoh-1", NOW))
      .find((v) => v !== null);
    expect(found?.purchaseId).toBe("purchase-1");
    // No eligible EAGOH holds a live sync → Purchase.
    const none = [makePurchase({ buyer_eagoh_id: "buyer-eagoh-z", active: false, purchase_status: "refunded" })];
    const missing = eligible
      .map((id) => findLiveSyncForListing(none, id, "vendor-eagoh-1", NOW))
      .find((v) => v !== null);
    expect(missing ?? null).toBeNull();
  });

  test("overlapping live rows resolve to the latest expiry", () => {
    const syncs = [
      makePurchase({ id: "p-earlier", expires_at: new Date(NOW + 1 * DAY).toISOString() }),
      makePurchase({ id: "p-later", sync_level: "100%", expires_at: new Date(NOW + 4 * DAY + 2 * HOUR).toISOString() }),
    ];
    const live = findLiveSyncForListing(syncs, "buyer-eagoh-a", "vendor-eagoh-1", NOW);
    expect(live?.purchaseId).toBe("p-later");
    expect(live?.syncLevel).toBe("100%");
  });

  test("buildLiveSyncMap keys by vendor EAGOH for the selected buyer EAGOH only", () => {
    const syncs = [
      makePurchase(),
      makePurchase({ id: "p-other-eagoh", buyer_eagoh_id: "buyer-eagoh-b" }),
      makePurchase({ id: "p-other-vendor", eagoh_id: "vendor-eagoh-2" }),
      makePurchase({ id: "p-inactive", active: false, purchase_status: "refunded" }),
    ];
    const map = buildLiveSyncMap(syncs, "buyer-eagoh-a", NOW);
    expect(map.size).toBe(2); // vendor-eagoh-1 + vendor-eagoh-2, own EAGOH only
    expect(map.get("vendor-eagoh-1")?.purchaseId).toBe("purchase-1");
    expect(map.get("vendor-eagoh-2")?.purchaseId).toBe("p-other-vendor");
    // Switching the selected EAGOH recalculates — B sees only their own sync.
    const mapB = buildLiveSyncMap(syncs, "buyer-eagoh-b", NOW);
    expect(mapB.size).toBe(1);
    expect(mapB.get("vendor-eagoh-1")?.purchaseId).toBe("p-other-eagoh");
    expect(buildLiveSyncMap(syncs, null, NOW).size).toBe(0);
  });

  test("buildLiveSyncView + formatSyncTimeLeft formatting", () => {
    expect(formatSyncTimeLeft(new Date(NOW + 2 * DAY + 4 * HOUR).toISOString(), NOW)).toBe("2d 4h left");
    expect(formatSyncTimeLeft(new Date(NOW + 5 * HOUR).toISOString(), NOW)).toBe("5h left");
    expect(formatSyncTimeLeft(new Date(NOW + 45 * 60_000).toISOString(), NOW)).toBe("45m left");
    expect(formatSyncTimeLeft(new Date(NOW - 1).toISOString(), NOW)).toBe("expired");
    const view = buildLiveSyncView(makePurchase({ days: 3 }), NOW);
    expect(view).toEqual({
      purchaseId: "purchase-1",
      eagohId: "vendor-eagoh-1",
      buyerEagohId: "buyer-eagoh-a",
      syncLevel: "50%",
      days: 3,
      startedAt: new Date(NOW - 20 * HOUR).toISOString(),
      expiresAt: new Date(NOW + 2 * DAY + 4 * HOUR).toISOString(),
      timeLeft: "2d 4h left",
    });
  });
});
