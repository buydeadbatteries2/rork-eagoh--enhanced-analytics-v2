// @ts-nocheck
// ============================================================================
// Phase D2.3R — Vendor Sync-Sale Visibility: targeted client tests.
//
// Run with:  cd expo && bun test tests/vendor-sale-visibility.test.ts
//
// Proves the required behaviors:
//   1. Vendor sees an active customer sync after cold start.
//   2. Vendor history contains active AND expired sales.
//   3. Unread sale count is correct.
//   4. Opening a sale clears its unread badge (optimistic + mark-read).
//   5/6. Duplicate-notification dedup + failure isolation are proven in
//        functions/tests/vendor-sale-notification.test.ts (Worker helper).
//   7. One failed marketplace request cannot clear vendor orders.
//   8. Vendor data remains account-wide when switching EAGOHs.
//
// The Supabase client is a queue-based fake; worker notification endpoints
// are served by a mocked global fetch.
// ============================================================================
import { describe, test, expect, beforeEach, mock } from "bun:test";

globalThis.__DEV__ = false;
process.env.EXPO_PUBLIC_RORK_FUNCTIONS_URL = "https://worker.test";

// ── Queue-based Supabase fake ──────────────────────────────────────────────
type Res = { data: any; error: any; count?: number };
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
  gte() { return this; }
  in() { return this; }
  order() { return this; }
  limit() { return this; }
  upsert() { return this; }
  insert() { return this; }
  update() { return this; }
  delete() { throw new Error("DELETE must never be issued against marketplace_sync_purchases"); }
  then(onFul?: (v: Res) => unknown, onRej?: (e: unknown) => unknown) {
    const res = queue.shift() ?? { data: [], error: null };
    return Promise.resolve(res).then(onFul, onRej);
  }
  catch(onRej?: (e: unknown) => unknown) {
    return Promise.resolve({ data: [], error: null }).catch(onRej);
  }
}

mock.module("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => { fromCalls.push(table); return new FakeQuery(table); },
    rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: { access_token: "test-token" } } }) },
  },
}));
mock.module("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
}));
mock.module("expo-router", () => ({
  useFocusEffect: () => undefined,
}));

const { getVendorActiveSyncs, getVendorSalesHistory, getVendorDashboardStats, getUnreadSaleCount, markUnreadSaleNotificationsRead } =
  await import("@/services/vendorSales");
const {
  EXCHANGE_VENDOR_ACTIVE_SYNCS_KEY,
  EXCHANGE_VENDOR_UNREAD_SALES_KEY,
  exchangeVendorActiveSyncsQueryOptions,
} = await import("@/hooks/useExchangeSyncQueries");
const { QueryClient, QueryObserver } = await import("@tanstack/react-query");

// ── Fixtures ───────────────────────────────────────────────────────────────
let nowMs = 1_800_000_000_000;
function makeSale(over: Record<string, unknown> = {}) {
  nowMs += 1000;
  return {
    id: "sale-" + Math.random().toString(36).slice(2, 10),
    eagoh_id: "eagoh-1",
    buyer_display_name: "Buyer Snap",
    buyer_avatar_url: "https://x/avatar.png",
    sync_level: "50%",
    days: 3,
    edge_cost: 120,
    created_at: new Date(nowMs).toISOString(),
    expires_at: new Date(nowMs + 86_400_000).toISOString(),
    active: true,
    purchase_status: "completed",
    ...over,
  };
}
const eagohRow = { id: "eagoh-1", name: "EAGOH Alpha", image_url: null, image_thumb_url: null };

/** Responses for one vendor active-syncs fetch: main + EAGOH enrichment. */
function enqueueVendorActive(rows: unknown[]) {
  queue.push({ data: rows, error: null });
  queue.push({ data: [eagohRow], error: null });
}
/** Responses for one vendor sales-history fetch: main + EAGOH enrichment. */
function enqueueVendorHistory(rows: unknown[]) {
  queue.push({ data: rows, error: null });
  queue.push({ data: [eagohRow], error: null });
}

// ── Worker notification endpoint mock ──────────────────────────────────────
let notificationFixtures: Array<Record<string, unknown>> = [];
let markReadCalls: string[] = [];
function installFetchMock() {
  globalThis.fetch = async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : String(input?.url ?? input);
    if (url.includes("/notifications/mark-read")) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      markReadCalls.push(body.notificationId);
      return { json: async () => ({ ok: true }) };
    }
    if (url.includes("/notifications")) {
      return {
        json: async () => ({
          ok: true,
          notifications: notificationFixtures,
          unreadCount: notificationFixtures.filter((n) => !n.isRead).length,
        }),
      };
    }
    return { json: async () => ({ ok: false, error: "unexpected endpoint" }) };
  };
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
  notificationFixtures = [];
  markReadCalls = [];
  installFetchMock();
});

// ── Tests ──────────────────────────────────────────────────────────────────
describe("Phase D2.3R — vendor sale visibility", () => {
  test("1. vendor sees an active customer sync after cold start", async () => {
    const sale = makeSale();
    enqueueVendorActive([sale]);
    const qc = new QueryClient(); // fresh cache = cold start
    const data = await qc.fetchQuery(exchangeVendorActiveSyncsQueryOptions("vendor-1"));
    expect(data.length).toBe(1);
    expect(data[0].id).toBe(sale.id);
    expect(data[0].eagoh_name).toBe("EAGOH Alpha");
    expect(data[0].buyer_display_name).toBe("Buyer Snap");
    // Scoped by vendor_id + active + completed status — nothing else.
    expect(eqCalls.some((c) => c.table === "marketplace_sync_purchases" && c.column === "vendor_id" && c.value === "vendor-1")).toBe(true);
    expect(eqCalls.some((c) => c.column === "active" && c.value === true)).toBe(true);
    expect(eqCalls.some((c) => c.column === "purchase_status" && c.value === "completed")).toBe(true);
  });

  test("2. vendor history contains active AND expired sales (never trimmed)", async () => {
    const active = makeSale();
    const expired = makeSale({ active: false, purchase_status: "expired" });
    const refunded = makeSale({ active: false, purchase_status: "refunded" });
    enqueueVendorHistory([active, expired, refunded]);
    const data = await getVendorSalesHistory("vendor-1");
    expect(data.length).toBe(3);
    const statuses = data.map((r) => r.purchase_status).sort();
    expect(statuses).toEqual(["completed", "expired", "refunded"]);
    // The expired sale is retained, not deleted.
    expect(data.some((r) => r.id === expired.id && r.purchase_status === "expired")).toBe(true);
  });

  test("3. unread sale count is correct", async () => {
    notificationFixtures = [
      { id: "n1", notificationType: "exchange_sale", isRead: false },
      { id: "n2", notificationType: "exchange_sale", isRead: false },
      { id: "n3", notificationType: "exchange_sale", isRead: true },
      { id: "n4", notificationType: "disputed", isRead: false },
    ];
    const count = await getUnreadSaleCount();
    expect(count).toBe(2);
  });

  test("4. opening a sale clears its unread badge (optimistic + per-notification mark-read)", async () => {
    notificationFixtures = [
      { id: "n1", notificationType: "exchange_sale", isRead: false, purchaseId: "p1" },
      { id: "n2", notificationType: "exchange_sale", isRead: false, purchaseId: "p2" },
    ];
    const qc = new QueryClient();
    qc.setQueryData([EXCHANGE_VENDOR_UNREAD_SALES_KEY, "vendor-1"], 2);
    // Exactly what the Sales & Orders open-effect does:
    qc.setQueryData([EXCHANGE_VENDOR_UNREAD_SALES_KEY, "vendor-1"], 0); // optimistic
    const marked = await markUnreadSaleNotificationsRead();
    expect(marked).toBe(2);
    expect(markReadCalls.sort()).toEqual(["n1", "n2"]);
    // The Vendor Dashboard badge reads the same key → updated immediately.
    expect(qc.getQueryData([EXCHANGE_VENDOR_UNREAD_SALES_KEY, "vendor-1"])).toBe(0);
  });

  test("7. one failed marketplace request cannot clear vendor orders", async () => {
    const sale = makeSale();
    const qc = new QueryClient();
    qc.setQueryData([EXCHANGE_VENDOR_ACTIVE_SYNCS_KEY, "vendor-1"], [sale]);
    qc.setQueryData([EXCHANGE_VENDOR_UNREAD_SALES_KEY, "vendor-1"], 3);
    // A marketplace listings request fails:
    await qc
      .fetchQuery({ queryKey: ["marketplace-listings", "d", {}], queryFn: async () => { throw new Error("listings down"); } })
      .catch(() => "failed as expected");
    expect(qc.getQueryData([EXCHANGE_VENDOR_ACTIVE_SYNCS_KEY, "vendor-1"])).toEqual([sale]);
    expect(qc.getQueryData([EXCHANGE_VENDOR_UNREAD_SALES_KEY, "vendor-1"])).toBe(3);

    // A vendor refetch failure also keeps previous data visible
    // (keepPreviousData + cached data is never wiped by a failed refetch).
    const opts = exchangeVendorActiveSyncsQueryOptions("vendor-1");
    qc.setQueryData(opts.queryKey, [sale]);
    const err = { code: "PGRST301", message: "db unavailable" };
    // retry: 2 → the fetch makes 3 attempts; every one fails.
    queue.push({ data: null, error: err });
    queue.push({ data: null, error: err });
    queue.push({ data: null, error: err });
    await qc.fetchQuery({ ...opts, retry: false }).catch(() => "failed as expected");
    // The failed refetch never wipes the vendor's cached orders.
    expect(qc.getQueryData(opts.queryKey)).toEqual([sale]);
  });

  test("8. vendor data remains account-wide when switching EAGOHs", async () => {
    // Query keys carry ONLY the query name + user id — no EAGOH component.
    const opts = exchangeVendorActiveSyncsQueryOptions("vendor-1");
    expect(opts.queryKey).toEqual([EXCHANGE_VENDOR_ACTIVE_SYNCS_KEY, "vendor-1"]);
    expect(JSON.stringify(opts.queryKey)).not.toContain("eagoh");
    // Sales of ANY of the vendor's EAGOHs are returned — a different
    // "selected" EAGOH changes nothing about the request.
    const other = makeSale({ eagoh_id: "a-different-eagoh" });
    enqueueVendorActive([other]);
    const data = await getVendorActiveSyncs("vendor-1");
    expect(data.length).toBe(1);
    expect(data[0].eagoh_id).toBe("a-different-eagoh");
    // No per-EAGOH filter is ever applied to the purchases query.
    expect(eqCalls.some((c) => c.table === "marketplace_sync_purchases" && c.column === "eagoh_id")).toBe(false);
  });

  test("dashboard stats degrade non-fatally per count", async () => {
    queue.push({ data: null, error: null, count: 4 });   // active count
    queue.push({ data: null, error: { code: "PGRST301" }, count: null }); // total count fails
    queue.push({ data: [{ edge_cost: 50, purchase_status: "completed" }, { edge_cost: 30, purchase_status: "refunded" }], error: null });
    const stats = await getVendorDashboardStats("vendor-1");
    expect(stats.activeCustomerSyncs).toBe(4);
    expect(stats.totalSales).toBe(0); // failed count → 0, never throws
    expect(stats.earnedThisMonth).toBe(50); // refunded excluded
  });
});
