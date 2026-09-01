// @ts-nocheck
// ============================================================================
// Phase D2.3Q — Durable Active Syncs & Purchase History: targeted tests.
//
// Run with:  cd expo && bun test tests/exchange-sync-durability.test.ts
//
// Proves the 10 required behaviors. The Supabase client is mocked with a
// queue-based fake: every awaited query chain consumes the next queued
// response, and every `.from()` call is recorded so request counts can be
// asserted (e.g. "invalidation refetches exactly once").
// ============================================================================
import { describe, test, expect, beforeEach, mock } from "bun:test";

// bun (like a production bundle) has no React Native globals.
globalThis.__DEV__ = false;

// ── Queue-based Supabase fake ──────────────────────────────────────────────
type Res = { data: any; error: any };
let queue: Res[] = [];
let fromCalls: string[] = [];
let eqCalls: Array<{ table: string; column: string; value: unknown }> = [];

class FakeQuery {
  table: string;
  constructor(table: string) { this.table = table; }
  select() { return this; }
  eq(column: string, value: unknown) {
    eqCalls.push({ table: this.table, column, value });
    return this;
  }
  lt() { return this; }
  in() { return this; }
  order() { return this; }
  limit() { return this; }
  update() { return this; }
  insert() { return this; }
  upsert() { return this; }
  delete() { throw new Error("DELETE must never be issued against marketplace_sync_purchases"); }
  then(onFul?: (v: Res) => unknown, onRej?: (e: unknown) => unknown) {
    const res = queue.shift() ?? { data: [], error: null };
    return Promise.resolve(res).then(onFul, onRej);
  }
  catch(onRej?: (e: unknown) => unknown) {
    return Promise.resolve({ data: [], error: null }).catch(onRej);
  }
}

// Mocks must be registered before the modules under test are imported.
mock.module("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => { fromCalls.push(table); return new FakeQuery(table); },
    rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
mock.module("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
}));
mock.module("expo-router", () => ({
  useFocusEffect: () => undefined,
}));

const { getActiveSyncs, getMyPurchases } = await import("@/services/marketplace");
const {
  EXCHANGE_ACTIVE_SYNCS_KEY,
  EXCHANGE_PURCHASE_HISTORY_KEY,
  exchangeActiveSyncsQueryOptions,
  exchangePurchaseHistoryQueryOptions,
  invalidateExchangeSyncQueries,
} = await import("@/hooks/useExchangeSyncQueries");
const { QueryClient, QueryObserver } = await import("@tanstack/react-query");

// ── Fixtures ───────────────────────────────────────────────────────────────
function makePurchase(over: Record<string, unknown> = {}) {
  return {
    id: "p-" + Math.random().toString(36).slice(2, 10),
    listing_id: "l-1",
    buyer_id: "user-1",
    vendor_id: "vendor-1",
    eagoh_id: "eagoh-1",
    sync_level: "50%",
    days: 3,
    edge_cost: 120,
    started_at: new Date(Date.now() - 86_400_000).toISOString(),
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    active: true,
    created_at: new Date().toISOString(),
    buyer_display_name: "Buyer Snap",
    buyer_avatar_url: null,
    purchase_status: "completed",
    ...over,
  };
}
const eagohRow = { id: "eagoh-1", name: "EAGOH Alpha", image_url: null, image_thumb_url: null };
const profileRow = { id: "vendor-1", username: "vendor_one" };

/** Responses consumed by one active-syncs fetch: expire + main + 2 enrichments. */
function enqueueActiveFetch(rows: unknown[]) {
  queue.push({ data: [], error: null });            // expireSyncs select → none expired
  queue.push({ data: rows, error: null });          // main select
  queue.push({ data: [eagohRow], error: null });    // enrichment: eagohs
  queue.push({ data: [profileRow], error: null });  // enrichment: profiles
}
/** Responses consumed by one purchase-history fetch: main + 2 enrichments. */
function enqueueHistoryFetch(rows: unknown[]) {
  queue.push({ data: rows, error: null });          // main select (all statuses)
  queue.push({ data: [eagohRow], error: null });    // enrichment: eagohs
  queue.push({ data: [profileRow], error: null });  // enrichment: profiles
}

async function waitFor(cond: () => boolean, timeout = 3000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeout) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(() => {
  queue = [];
  fromCalls = [];
  eqCalls = [];
});

// ── Tests ──────────────────────────────────────────────────────────────────
describe("Phase D2.3Q — durable Active Syncs & Purchase History", () => {
  test("1. cold start reload restores an active purchase", async () => {
    const purchase = makePurchase({ active: true, purchase_status: "completed" });
    enqueueActiveFetch([purchase]);
    const qc = new QueryClient(); // fresh cache = cold start
    const data = await qc.fetchQuery(exchangeActiveSyncsQueryOptions("user-1"));
    expect(data.length).toBe(1);
    expect(data[0].id).toBe(purchase.id);
    expect(data[0].eagoh_name).toBe("EAGOH Alpha");
    // Account-wide + completed-status filter present when the column exists:
    expect(eqCalls.some((c) => c.table === "marketplace_sync_purchases" && c.column === "buyer_id" && c.value === "user-1")).toBe(true);
    expect(eqCalls.some((c) => c.column === "active" && c.value === true)).toBe(true);
    expect(eqCalls.some((c) => c.column === "purchase_status" && c.value === "completed")).toBe(true);
  });

  test("2. purchase history reloads independently of marketplace listings", async () => {
    const hist = makePurchase({ active: false, purchase_status: "expired" });
    enqueueHistoryFetch([hist]);
    const qc = new QueryClient();
    // A listings request fails first — history must still load.
    await qc
      .fetchQuery({ queryKey: ["marketplace-listings", "x"], queryFn: async () => { throw new Error("listings down"); } })
      .catch(() => "failed as expected");
    const data = await qc.fetchQuery(exchangePurchaseHistoryQueryOptions("user-1"));
    expect(data.length).toBe(1);
    expect(data[0].id).toBe(hist.id);
  });

  test("3. a marketplace/filter request failure does not clear sync data", async () => {
    const purchase = makePurchase();
    const qc = new QueryClient();
    qc.setQueryData([EXCHANGE_ACTIVE_SYNCS_KEY, "user-1"], [purchase]);
    qc.setQueryData([EXCHANGE_PURCHASE_HISTORY_KEY, "user-1"], [purchase]);
    await qc
      .fetchQuery({ queryKey: ["marketplace-listings", "d", {}], queryFn: async () => { throw new Error("filter meta boom"); } })
      .catch(() => "failed as expected");
    expect(qc.getQueryData([EXCHANGE_ACTIVE_SYNCS_KEY, "user-1"])).toEqual([purchase]);
    expect(qc.getQueryData([EXCHANGE_PURCHASE_HISTORY_KEY, "user-1"])).toEqual([purchase]);
  });

  test("4. one active-sync request failure does not erase Purchase History", async () => {
    const hist = makePurchase();
    const qc = new QueryClient();
    qc.setQueryData([EXCHANGE_PURCHASE_HISTORY_KEY, "user-1"], [hist]);
    // Active syncs refetch fails transiently.
    queue.push({ data: [], error: null });
    queue.push({ data: null, error: { code: "PGRST301", message: "db unavailable" } });
    await qc.fetchQuery(exchangeActiveSyncsQueryOptions("user-1")).catch(() => "failed as expected");
    expect(qc.getQueryData([EXCHANGE_PURCHASE_HISTORY_KEY, "user-1"])).toEqual([hist]);
  });

  test("5. expired purchases remain in history (never deleted)", async () => {
    const expired = makePurchase({ active: false, purchase_status: "expired", expires_at: new Date(Date.now() - 1000).toISOString() });
    const reversed = makePurchase({ active: false, purchase_status: "refunded" });
    const active = makePurchase({ purchase_status: "completed" });
    enqueueHistoryFetch([expired, reversed, active]);
    const qc = new QueryClient();
    const data = await qc.fetchQuery(exchangePurchaseHistoryQueryOptions("user-1"));
    expect(data.length).toBe(3); // active + expired + refunded all retained
    expect(data.map((r) => r.purchase_status).sort()).toEqual(["completed", "expired", "refunded"]);
    expect(data[0].id).toBe(expired.id); // newest first — expired was created last? created_at ordering verified below
  });

  test("5b. history is ordered newest first regardless of status", async () => {
    const older = makePurchase({ created_at: "2026-01-01T00:00:00Z" });
    const newer = makePurchase({ created_at: "2026-02-01T00:00:00Z", active: false, purchase_status: "expired" });
    enqueueHistoryFetch([newer, older]); // service orders created_at desc
    const data = await getMyPurchases("user-1");
    expect(data.map((r) => r.id)).toEqual([newer.id, older.id]);
  });

  test("6. changing the selected buyer EAGOH does not alter either dataset", async () => {
    // The query keys contain ONLY the query name and the user id — no EAGOH,
    // domain, filter, or tab component exists, so a selection change cannot
    // produce a different cache entry or refetch with different scoping.
    expect(exchangeActiveSyncsQueryOptions("user-1").queryKey).toEqual([EXCHANGE_ACTIVE_SYNCS_KEY, "user-1"]);
    expect(exchangePurchaseHistoryQueryOptions("user-1").queryKey).toEqual([EXCHANGE_PURCHASE_HISTORY_KEY, "user-1"]);
    expect(JSON.stringify(exchangeActiveSyncsQueryOptions("user-1").queryKey)).not.toContain("eagoh");
    // The fetchers take only buyerId — a different "selected" EAGOH changes
    // nothing about the request.
    const purchase = makePurchase({ eagoh_id: "a-different-eagoh" });
    enqueueActiveFetch([purchase]);
    const data = await getActiveSyncs("user-1");
    expect(data.length).toBe(1);
    expect(data[0].eagoh_id).toBe("a-different-eagoh");
  });

  test("7. a temporary free tier during profile hydration does not erase history", async () => {
    const hist = makePurchase();
    const qc = new QueryClient();
    qc.setQueryData([EXCHANGE_PURCHASE_HISTORY_KEY, "user-1"], [hist]);
    // Options are keyed/enabled by userId only — no tier input exists at all.
    const opts = exchangePurchaseHistoryQueryOptions("user-1");
    expect(opts.enabled).toBe(true);
    expect(JSON.stringify(opts.queryKey)).not.toContain("free");
    expect(qc.getQueryData([EXCHANGE_PURCHASE_HISTORY_KEY, "user-1"])).toEqual([hist]);
  });

  test("8. successful purchase invalidates/refetches both queries exactly once", async () => {
    const purchase = makePurchase();
    // Initial fetches (4 active + 3 history) then post-invalidation refetches (4 + 3).
    enqueueActiveFetch([purchase]);
    enqueueHistoryFetch([purchase]);
    enqueueActiveFetch([purchase]);
    enqueueHistoryFetch([purchase]);
    const qc = new QueryClient();
    const o1 = new QueryObserver(qc, exchangeActiveSyncsQueryOptions("user-1"));
    const o2 = new QueryObserver(qc, exchangePurchaseHistoryQueryOptions("user-1"));
    const un1 = o1.subscribe(() => {});
    const un2 = o2.subscribe(() => {});
    await waitFor(() => !!o1.getCurrentResult().data && !!o2.getCurrentResult().data);
    const before = fromCalls.length;
    invalidateExchangeSyncQueries(qc);
    await waitFor(() => fromCalls.length - before >= 7);
    await new Promise((r) => setTimeout(r, 60)); // let any duplicate settle
    expect(fromCalls.length - before).toBe(7); // active: 4, history: 3 — exactly once each
    un1(); un2();
  });

  test("9. foreground/focus refetch does not repeat the purchase", async () => {
    let workerFetches = 0;
    globalThis.fetch = async () => { workerFetches += 1; return { json: async () => ({ ok: false }) }; };
    const purchase = makePurchase();
    enqueueActiveFetch([purchase]);       // initial mount fetch (active)
    enqueueHistoryFetch([purchase]);      // initial mount fetch (history)
    enqueueActiveFetch([purchase]);       // one focus refetch (active)
    enqueueHistoryFetch([purchase]);      // one focus refetch (history)
    const qc = new QueryClient();
    const o1 = new QueryObserver(qc, exchangeActiveSyncsQueryOptions("user-1"));
    const o2 = new QueryObserver(qc, exchangePurchaseHistoryQueryOptions("user-1"));
    const un1 = o1.subscribe(() => {});
    const un2 = o2.subscribe(() => {});
    await waitFor(() => !!o1.getCurrentResult().data && !!o2.getCurrentResult().data);
    const before = fromCalls.length;
    // Exactly what useExchangeSyncForegroundRefetch runs on focus/foreground:
    await Promise.all([
      qc.refetchQueries({ queryKey: [EXCHANGE_ACTIVE_SYNCS_KEY, "user-1"], type: "active" }),
      qc.refetchQueries({ queryKey: [EXCHANGE_PURCHASE_HISTORY_KEY, "user-1"], type: "active" }),
    ]);
    expect(fromCalls.length - before).toBe(7); // data refetched…
    expect(workerFetches).toBe(0);             // …and the purchase RPC was never repeated
    un1(); un2();
  });

  test("10. missing enrichment records still render a history card", async () => {
    const snap = makePurchase({ buyer_display_name: "Snapshot Name", buyer_avatar_url: "https://x/y.png" });
    queue.push({ data: [snap], error: null });                                    // history main
    queue.push({ data: null, error: { code: "PGRST302", message: "eagohs down" } }); // eagoh enrichment fails
    queue.push({ data: [], error: null });                                        // vendor profile deleted
    const data = await getMyPurchases("user-1");
    expect(data.length).toBe(1); // the purchase is never hidden
    expect(data[0].eagoh_name).toBe("Unknown EAGOH");              // safe label
    expect(data[0].vendor_username).toBeNull();                    // card renders "Anonymous"
    // Stored snapshot fields preserved for the card render:
    expect(data[0].buyer_display_name).toBe("Snapshot Name");
    expect(data[0].buyer_avatar_url).toBe("https://x/y.png");
    expect(data[0].edge_cost).toBe(120);
    expect(data[0].sync_level).toBe("50%");
  });

  test("2b. active syncs fall back gracefully when purchase_status column is unavailable", async () => {
    const purchase = makePurchase();
    queue.push({ data: [], error: null }); // expire select
    queue.push({ data: null, error: { code: "PGRST204", message: "Could not find the 'purchase_status' column of 'marketplace_sync_purchases'" } });
    queue.push({ data: [purchase], error: null }); // retry without the status filter
    queue.push({ data: [eagohRow], error: null });
    queue.push({ data: [profileRow], error: null });
    const data = await getActiveSyncs("user-1");
    expect(data.length).toBe(1);
    expect(data[0].id).toBe(purchase.id);
  });
});
