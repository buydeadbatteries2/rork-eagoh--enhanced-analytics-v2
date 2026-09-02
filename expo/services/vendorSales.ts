import { supabase } from "@/lib/supabase";
import { resolveMarketplaceEagohImage } from "@/services/marketplace";
import type { SyncLevel } from "@/services/marketplace";
import { fetchNotifications, markNotificationRead } from "@/services/openIntelligence";

/**
 * Phase D2.3R — vendor-facing sale visibility service.
 *
 * All functions are ACCOUNT-WIDE: they query by `vendor_id = authenticated
 * user ID` only and are never filtered by the selected EAGOH, marketplace
 * filters, domain, or the current tab. A vendor's sales history is never
 * erased by an unrelated marketplace request failure.
 */

// ── Types ──────────────────────────────────────────────────────────────

/** A sync sale made by the vendor, with EAGOH snapshot enrichment. */
export type VendorSale = {
  id: string;
  eagoh_id: string;
  eagoh_name: string;
  eagoh_image_url: string | null;
  buyer_display_name: string | null;
  buyer_avatar_url: string | null;
  sync_level: SyncLevel;
  days: number;
  edge_cost: number;
  created_at: string;
  expires_at: string;
  active: boolean;
  purchase_status: string;
};

/** Headline stats for the Vendor Dashboard card. */
export type VendorDashboardStats = {
  activeCustomerSyncs: number;
  totalSales: number;
  earnedThisMonth: number;
};

// ── Helpers ────────────────────────────────────────────────────────────

const SALE_ROW_COLUMNS =
  "id, eagoh_id, buyer_display_name, buyer_avatar_url, sync_level, days, edge_cost, created_at, expires_at, active, purchase_status";

/** Fallback when EAGOH enrichment fails — the sale is never hidden. */
const UNKNOWN_EAGOH = "Unknown EAGOH";

type RawSaleRow = {
  id: string;
  eagoh_id: string;
  buyer_display_name: string | null;
  buyer_avatar_url: string | null;
  sync_level: SyncLevel;
  days: number;
  edge_cost: number;
  created_at: string;
  expires_at: string;
  active: boolean;
  purchase_status: string | null;
};

/** Enrich sale rows with the purchased (vendor) EAGOH name + image, best-effort. */
async function enrichVendorSales(rows: RawSaleRow[]): Promise<VendorSale[]> {
  const eagohIds = [...new Set(rows.map((r) => r.eagoh_id).filter(Boolean))];
  const eagohMap = new Map<string, { name: string; image_url: string | null; image_thumb_url: string | null }>();

  if (eagohIds.length > 0) {
    const { data: eagohs, error } = await supabase
      .from("eagohs")
      .select("id, name, image_url, image_thumb_url")
      .in("id", eagohIds);
    if (error) {
      console.warn("[vendorSales] EAGOH enrichment failed:", error.message);
    } else {
      for (const e of (eagohs ?? []) as Array<{ id: string; name: string; image_url: string | null; image_thumb_url: string | null }>) {
        eagohMap.set(e.id, e);
      }
    }
  }

  return rows.map((row) => {
    const eagoh = eagohMap.get(row.eagoh_id);
    return {
      id: row.id,
      eagoh_id: row.eagoh_id,
      eagoh_name: eagoh?.name ?? UNKNOWN_EAGOH,
      eagoh_image_url: eagoh ? resolveMarketplaceEagohImage(eagoh) : null,
      buyer_display_name: row.buyer_display_name ?? null,
      buyer_avatar_url: row.buyer_avatar_url ?? null,
      sync_level: row.sync_level,
      days: row.days,
      edge_cost: row.edge_cost,
      created_at: row.created_at,
      expires_at: row.expires_at,
      active: row.active,
      purchase_status: row.purchase_status ?? "completed",
    };
  });
}

async function fetchVendorSales(vendorId: string, activeOnly: boolean, limit = 100): Promise<VendorSale[]> {
  const fetchRows = async (withStatusFilter: boolean) => {
    let q = supabase
      .from("marketplace_sync_purchases")
      .select(SALE_ROW_COLUMNS)
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (activeOnly) {
      q = q.eq("active", true);
      if (withStatusFilter) q = q.eq("purchase_status", "completed");
    }
    return await q;
  };

  let res = await fetchRows(true);
  if (res.error?.code === "PGRST204") {
    // The trusted purchase_status column is not present on this database
    // yet — retry without the status filter (active = true already excludes
    // expired rows on unmigrated schemas).
    res = await fetchRows(false);
  }

  if (res.error) throw res.error;
  return enrichVendorSales((res.data ?? []) as RawSaleRow[]);
}

// ── Queries ────────────────────────────────────────────────────────────

/**
 * The vendor's ACTIVE customer syncs: purchases of this vendor's EAGOHs
 * that are currently live (active = true, completed status), newest first.
 */
export async function getVendorActiveSyncs(vendorId: string): Promise<VendorSale[]> {
  return fetchVendorSales(vendorId, true);
}

/**
 * The vendor's full sales history: active, completed/expired, and
 * refunded/reversed purchases, newest first. Expired sales are never
 * removed — expiration only flips `purchase_status`/`active`.
 */
export async function getVendorSalesHistory(vendorId: string): Promise<VendorSale[]> {
  return fetchVendorSales(vendorId, false);
}

/**
 * Vendor Dashboard headline stats: active customer syncs count, total sync
 * sales count, and Neurons (EC) earned this month. Each count is a separate
 * non-fatal query — one failing count degrades to 0 instead of hiding the
 * dashboard.
 */
export async function getVendorDashboardStats(vendorId: string): Promise<VendorDashboardStats> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const reversedStatuses = new Set(["refunded", "payment_reversed", "charged_back", "disputed", "invalidated", "admin_revoked"]);

  const [activeRes, totalRes, monthRes] = await Promise.all([
    supabase
      .from("marketplace_sync_purchases")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", vendorId)
      .eq("active", true),
    supabase
      .from("marketplace_sync_purchases")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", vendorId),
    supabase
      .from("marketplace_sync_purchases")
      .select("edge_cost, purchase_status")
      .eq("vendor_id", vendorId)
      .gte("created_at", monthStart),
  ]);

  const monthRows = (monthRes.data ?? []) as Array<{ edge_cost: number; purchase_status: string | null }>;
  const validMonthRows = monthRes.error ? [] : monthRows.filter((r) => !r.purchase_status || !reversedStatuses.has(r.purchase_status));

  return {
    activeCustomerSyncs: activeRes.error ? 0 : activeRes.count ?? 0,
    totalSales: totalRes.error ? 0 : totalRes.count ?? 0,
    earnedThisMonth: validMonthRows.reduce((sum, r) => sum + (r.edge_cost ?? 0), 0),
  };
}

/**
 * Count the vendor's UNREAD exchange_sale notifications. Reads go through
 * the secure worker endpoint (RLS-safe) — never direct table reads.
 */
export async function getUnreadSaleCount(): Promise<number> {
  const result = await fetchNotifications();
  if (!result.ok) return 0;
  return result.notifications.filter((n) => n.notificationType === "exchange_sale" && !n.isRead).length;
}

/**
 * List unread exchange_sale notifications (id + linked purchase id) via the
 * secure worker endpoint. Used by Sales & Orders to mark sales as read.
 */
export async function getUnreadSaleNotifications(): Promise<Array<{ id: string; purchaseId: string | null }>> {
  const result = await fetchNotifications();
  if (!result.ok) return [];
  return result.notifications
    .filter((n) => n.notificationType === "exchange_sale" && !n.isRead)
    .map((n) => ({ id: n.id, purchaseId: n.purchaseId }));
}

/**
 * Mark ALL of the vendor's unread exchange_sale notifications as read
 * (per-notification worker call). Returns the number successfully marked.
 * Failures are non-fatal — the badge can be repaired on the next visit.
 */
export async function markUnreadSaleNotificationsRead(): Promise<number> {
  const unread = await getUnreadSaleNotifications();
  let marked = 0;
  for (const n of unread) {
    const result = await markNotificationRead(n.id);
    if (result.ok) marked += 1;
  }
  return marked;
}
