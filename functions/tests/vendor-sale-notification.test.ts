// ============================================================================
// Phase D2.3R — Vendor sale notification (Worker) targeted tests.
//
// Run with:  cd functions && bun test tests/vendor-sale-notification.test.ts
//
// Proves, against the shared createExchangeSaleNotificationForPurchase
// helper used by BOTH the confirmed post-purchase path and the preserved
// /exchange/sale-notify repair endpoint:
//   • duplicate attempts create exactly one notification (dedup + unique 23505)
//   • notification failure can never throw / affect a completed purchase
//   • reversed purchases and missing purchases never notify
//   • the notification carries "New Sync Sale" + buyer/EAGOH/sync/duration/EC
// ============================================================================

import { describe, test, expect } from "bun:test";

const {
  createExchangeSaleNotificationForPurchase,
} = await import("../index.ts");

// ── Fake service-role client ──────────────────────────────────────────────

type MaybeResult = { data: unknown; error: unknown };

type TableConfig = {
  maybe?: MaybeResult;
  single?: MaybeResult;
  maybeThrows?: boolean;
};

function makeFakeDb(configs: Record<string, TableConfig>) {
  const insertPayloads: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const maybeSingleCalls: Array<{ table: string; column: string; value: unknown }> = [];

  function build(table: string, conf: TableConfig) {
    const q = {
      select() { return q; },
      eq(column: string, value: unknown) {
        maybeSingleCalls.push({ table, column, value });
        return q;
      },
      async maybeSingle(): Promise<MaybeResult> {
        if (conf.maybeThrows) throw new Error("simulated database outage");
        return conf.maybe ?? { data: null, error: null };
      },
      insert(payload: Record<string, unknown>) {
        insertPayloads.push({ table, payload });
        return q;
      },
      async single(): Promise<MaybeResult> {
        return conf.single ?? { data: null, error: null };
      },
    };
    return q;
  }

  return {
    insertPayloads,
    maybeSingleCalls,
    from(table: string) {
      return build(table, configs[table] ?? {});
    },
  };
}

type FakeDb = ReturnType<typeof makeFakeDb> & Record<string, unknown>;

const PURCHASE_ROW = {
  id: "purchase-1",
  vendor_id: "vendor-1",
  eagoh_id: "eagoh-1",
  sync_level: "50%",
  days: 3,
  edge_cost: 120,
  buyer_display_name: "Buyer Snap",
  purchase_status: "completed",
};

function successConfig(over: Record<string, TableConfig> = {}): Record<string, TableConfig> {
  return {
    marketplace_sync_purchases: { maybe: { data: PURCHASE_ROW, error: null } },
    eagohs: { maybe: { data: { name: "EAGOH Alpha" }, error: null } },
    intelligence_notifications: {
      maybe: { data: null, error: null },               // no existing notification
      single: { data: { id: "notif-1" }, error: null }, // insert succeeds
    },
    ...over,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("D2.3R — vendor sale notification (Worker)", () => {
  test("creates one notification with title, buyer, EAGOH, sync %, duration, and EC", async () => {
    const db = makeFakeDb(successConfig()) as unknown as FakeDb;
    const outcome = await createExchangeSaleNotificationForPurchase(db as never, "purchase-1");

    expect(outcome).toEqual({ ok: true, created: true, notificationId: "notif-1" });
    expect(db.insertPayloads.length).toBe(1);
    const payload = db.insertPayloads[0].payload;
    expect(payload.notification_type).toBe("exchange_sale");
    expect(payload.user_id).toBe("vendor-1");
    expect(payload.purchase_id).toBe("purchase-1");
    expect(payload.title).toBe("New Sync Sale");
    expect(String(payload.message)).toContain("Buyer Snap");
    expect(String(payload.message)).toContain("EAGOH Alpha");
    expect(String(payload.message)).toContain("50%");
    expect(String(payload.message)).toContain("3 day(s)");
    expect(String(payload.message)).toContain("120 EC");
  });

  test("duplicate attempt: existing notification → skip, no insert (one row total)", async () => {
    const db = makeFakeDb(
      successConfig({
        intelligence_notifications: { maybe: { data: { id: "existing" }, error: null } },
      }),
    ) as unknown as FakeDb;
    const outcome = await createExchangeSaleNotificationForPurchase(db as never, "purchase-1");
    expect(outcome).toEqual({ ok: true, created: false, reason: "already_notified" });
    expect(db.insertPayloads.length).toBe(0);
  });

  test("duplicate attempt: unique-index conflict (23505) → successful dedup, not an error", async () => {
    const db = makeFakeDb(
      successConfig({
        intelligence_notifications: {
          maybe: { data: null, error: null },
          single: { data: null, error: { code: "23505", message: "duplicate key value" } },
        },
      }),
    ) as unknown as FakeDb;
    const outcome = await createExchangeSaleNotificationForPurchase(db as never, "purchase-1");
    expect(outcome).toEqual({ ok: true, created: false, reason: "duplicate_confirmed" });
  });

  test("notification failure returns ok:false and NEVER throws — purchase unaffected", async () => {
    const db = makeFakeDb(
      successConfig({
        intelligence_notifications: {
          maybe: { data: null, error: null },
          single: { data: null, error: { code: "53000", message: "insufficient resources" } },
        },
      }),
    ) as unknown as FakeDb;
    const outcome = await createExchangeSaleNotificationForPurchase(db as never, "purchase-1");
    expect(outcome).toEqual({ ok: false, reason: "insert_failed" });
  });

  test("a thrown database outage is swallowed — never throws, purchase unaffected", async () => {
    const db = makeFakeDb(
      successConfig({
        marketplace_sync_purchases: { maybeThrows: true },
      }),
    ) as unknown as FakeDb;
    const outcome = await createExchangeSaleNotificationForPurchase(db as never, "purchase-1");
    expect(outcome.ok).toBe(false);
    expect((outcome as { reason?: string }).reason).toBe("unexpected");
  });

  test("reversed purchase (refunded) never notifies", async () => {
    const db = makeFakeDb(
      successConfig({
        marketplace_sync_purchases: {
          maybe: { data: { ...PURCHASE_ROW, purchase_status: "refunded" }, error: null },
        },
      }),
    ) as unknown as FakeDb;
    const outcome = await createExchangeSaleNotificationForPurchase(db as never, "purchase-1");
    expect(outcome).toEqual({ ok: true, created: false, reason: "purchase_reversed" });
    expect(db.insertPayloads.length).toBe(0);
  });

  test("missing purchase is reported as purchase_not_found", async () => {
    const db = makeFakeDb(
      successConfig({
        marketplace_sync_purchases: { maybe: { data: null, error: null } },
      }),
    ) as unknown as FakeDb;
    const outcome = await createExchangeSaleNotificationForPurchase(db as never, "purchase-1");
    expect(outcome).toEqual({ ok: true, created: false, reason: "purchase_not_found" });
  });

  test("buyer fallback name is used when the display-name snapshot is missing", async () => {
    const db = makeFakeDb(
      successConfig({
        marketplace_sync_purchases: {
          maybe: { data: { ...PURCHASE_ROW, buyer_display_name: null }, error: null },
        },
      }),
    ) as unknown as FakeDb;
    await createExchangeSaleNotificationForPurchase(db as never, "purchase-1");
    expect(String(db.insertPayloads[0].payload.message)).toContain("A user purchased");
  });
});
