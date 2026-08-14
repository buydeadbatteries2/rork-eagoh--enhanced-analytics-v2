import { supabase } from "@/lib/supabase";
import { resolveMarketplaceEagohImage } from "@/services/marketplace";
import type { SyncLevel } from "@/services/marketplace";

// ── Types ──────────────────────────────────────────────────────────────

/** A vendor purchase order derived from marketplace_sync_purchases. */
export type VendorOrder = {
  id: string;
  eagoh_id: string;
  eagoh_name: string;
  eagoh_image_url: string | null;
  buyer_display_name: string | null;
  buyer_avatar_url: string | null;
  sync_level: SyncLevel;
  days: number;
  edge_cost: number;
  vendor_earnings: number;
  created_at: string;
  expires_at: string;
  active: boolean;
  purchase_status: string;
  status: OrderStatus;
};

export type OrderStatus = "Active" | "Completed" | "Refunded" | "Reversed";

/** Summary totals for the vendor dashboard. */
export type VendorEarningsSummary = {
  salesThisMonth: number;
  earnedThisMonth: number;
  lifetimeSales: number;
  lifetimeEarnings: number;
};

// ── Helpers ────────────────────────────────────────────────────────────

/** Map the DB purchase_status to a user-facing order status. */
function mapOrderStatus(purchaseStatus: string | null, active: boolean): OrderStatus {
  if (!purchaseStatus || purchaseStatus === "completed") {
    return active ? "Active" : "Completed";
  }
  if (purchaseStatus === "expired") {
    return "Completed";
  }
  // refunded, payment_reversed, charged_back, disputed, invalidated, admin_revoked
  if (purchaseStatus === "refunded") return "Refunded";
  return "Reversed";
}

// ── Service Functions ──────────────────────────────────────────────────

/**
 * Fetch vendor purchase orders (sales) with EAGOH name + image.
 * Uses the existing marketplace_sync_purchases table.
 * RLS allows vendors to SELECT their own purchases (msp_self_select).
 */
export async function getVendorOrders(vendorId: string, limit: number = 50): Promise<VendorOrder[]> {
  const { data, error } = await supabase
    .from("marketplace_sync_purchases")
    .select(`
      id, eagoh_id, buyer_display_name, buyer_avatar_url,
      sync_level, days, edge_cost, created_at, expires_at,
      active, purchase_status
    `)
    .eq("vendor_id", vendorId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  const rows = (data ?? []) as Array<{
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
  }>;

  if (rows.length === 0) return [];

  // Bulk-fetch EAGOH names + images to avoid N+1
  const eagohIds = [...new Set(rows.map((r) => r.eagoh_id))];
  const { data: eagohs } = await supabase
    .from("eagohs")
    .select("id, name, image_url, image_thumb_url")
    .in("id", eagohIds);

  const eagohMap = new Map<string, { name: string; image_url: string | null; image_thumb_url: string | null }>();
  for (const e of (eagohs ?? []) as Array<{ id: string; name: string; image_url: string | null; image_thumb_url: string | null }>) {
    eagohMap.set(e.id, e);
  }

  return rows.map((row) => {
    const eagoh = eagohMap.get(row.eagoh_id);
    return {
      id: row.id,
      eagoh_id: row.eagoh_id,
      eagoh_name: eagoh?.name ?? "Unknown EAGOH",
      eagoh_image_url: resolveMarketplaceEagohImage(eagoh ?? null),
      buyer_display_name: row.buyer_display_name ?? null,
      buyer_avatar_url: row.buyer_avatar_url ?? null,
      sync_level: row.sync_level,
      days: row.days,
      edge_cost: row.edge_cost,
      vendor_earnings: row.edge_cost,
      created_at: row.created_at,
      expires_at: row.expires_at,
      active: row.active,
      purchase_status: row.purchase_status ?? "completed",
      status: mapOrderStatus(row.purchase_status, row.active),
    };
  });
}

/**
 * Fetch vendor earnings summary.
 * Uses the existing marketplace_vendor_stats table + marketplace_sync_purchases.
 */
export async function getVendorEarningsSummary(vendorId: string): Promise<VendorEarningsSummary> {
  // Fetch vendor stats for lifetime totals
  const { data: stats } = await supabase
    .from("marketplace_vendor_stats")
    .select("total_sales, total_edge_earned, edge_earned_this_month")
    .eq("vendor_id", vendorId)
    .maybeSingle();

  const statsRow = stats as { total_sales: number; total_edge_earned: number; edge_earned_this_month: number } | null;

  // Calculate sales this month from purchases
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const { data: monthData } = await supabase
    .from("marketplace_sync_purchases")
    .select("edge_cost, purchase_status")
    .eq("vendor_id", vendorId)
    .gte("created_at", monthStart);

  const monthRows = (monthData ?? []) as Array<{ edge_cost: number; purchase_status: string | null }>;
  const reversedStatuses = ["refunded", "payment_reversed", "charged_back", "disputed", "invalidated", "admin_revoked"];
  const validMonthRows = monthRows.filter((r) => !r.purchase_status || !reversedStatuses.includes(r.purchase_status));
  const salesThisMonth = validMonthRows.length;
  const earnedThisMonth = validMonthRows.reduce((sum, r) => sum + (r.edge_cost ?? 0), 0);

  return {
    salesThisMonth,
    earnedThisMonth,
    lifetimeSales: statsRow?.total_sales ?? 0,
    lifetimeEarnings: statsRow?.total_edge_earned ?? 0,
  };
}
