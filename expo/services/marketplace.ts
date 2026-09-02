import { supabase } from "@/lib/supabase";
import type { SubscriptionTier } from "@/services/profile";
import { hasProAccess } from "@/services/tiers";
import type { EagohRecord } from "@/services/eagohs";
import { getTeamById } from "@/data/teams";
import { getBulkEagohHasCredentials } from "@/services/eagohCredentials";
import { getBulkVerificationStatus } from "@/services/socialVerification";

const FUNCTIONS_BASE_URL = process.env.EXPO_PUBLIC_RORK_FUNCTIONS_URL ?? "";

/**
 * Trigger retained exchange intelligence creation via the secure worker.
 * Called after a successful purchase. Best-effort — never fails the purchase
 * if retention fails. The worker re-verifies everything server-side.
 */
async function triggerRetention(purchaseId: string): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const jwt = data.session?.access_token;
    if (!jwt || !FUNCTIONS_BASE_URL) return;

    await fetch(`${FUNCTIONS_BASE_URL}/exchange/retention/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ purchaseId }),
    });
  } catch (err) {
    console.warn("[marketplace] retention trigger failed (non-fatal)", err instanceof Error ? err.message : "unknown");
  }
}

/**
 * Deactivate retained exchange intelligence for refunds/reversals/disputes only.
 * NEVER call this for normal sync expiration — retained intelligence is
 * permanent after a valid completed purchase. The worker endpoint is
 * ADMIN-ONLY: a buyer cannot deactivate their own retained entries because
 * active=false is not proof of a refund (normal expiration also sets it).
 * Valid reasons: refund, payment_reversal, chargeback, dispute,
 * invalid_purchase, admin_revocation. Non-admin callers receive 403.
 */
async function triggerDeactivation(purchaseId: string, reason: string): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const jwt = data.session?.access_token;
    if (!jwt || !FUNCTIONS_BASE_URL) return;

    await fetch(`${FUNCTIONS_BASE_URL}/exchange/retention/deactivate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ purchaseId, reason }),
    });
  } catch (err) {
    console.warn("[marketplace] deactivation trigger failed (non-fatal)", err instanceof Error ? err.message : "unknown");
  }
}

/**
 * Trigger a vendor sale notification after a successful Exchange purchase.
 * Best-effort — never fails the purchase. The worker verifies the purchase
 * exists and the caller is the buyer before creating the notification.
 */
async function triggerVendorSaleNotification(purchaseId: string): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const jwt = data.session?.access_token;
    if (!jwt || !FUNCTIONS_BASE_URL) return;

    await fetch(`${FUNCTIONS_BASE_URL}/exchange/sale-notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ purchaseId }),
    });
  } catch (err) {
    console.warn("[marketplace] vendor sale notification trigger failed (non-fatal)", err instanceof Error ? err.message : "unknown");
  }
}

/**
 * Quote and escape a value for use inside a PostgREST `.or()` filter expression.
 *
 * Raw `.or()` strings are passed as-is to the PostgREST API — the Supabase
 * client does not automatically escape or quote individual values within
 * the expression. An unquoted value containing commas, parentheses, dots,
 * or other PostgREST metacharacters can silently alter the filter semantics
 * or cause a parse error. This wraps the value in double quotes (the
 * PostgREST string-literal delimiter) after escaping backslashes and
 * embedded double quotes so the value is interpreted literally.
 */
function quotePostgrestValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Looks up a domain specialization value from an EAGOH's dna array. */
function getDomainDnaValue(dna: string[] | undefined | null, columnName: string): string | null {
  if (!dna || dna.length === 0) return null;
  const prefix = `dom:${columnName}:`;
  for (const entry of dna) {
    if (typeof entry === "string" && entry.startsWith(prefix)) {
      return entry.slice(prefix.length);
    }
  }
  return null;
}

/** Collects all domain DNA values as a space-separated string for search. */
function collectDomainDnaValues(dna: string[] | undefined | null): string {
  if (!dna || dna.length === 0) return "";
  const values: string[] = [];
  for (const entry of dna) {
    if (typeof entry === "string" && entry.startsWith("dom:")) {
      const rest = entry.slice(4); // after "dom:"
      const colonIdx = rest.indexOf(":");
      if (colonIdx > 0) {
        values.push(rest.slice(colonIdx + 1));
      }
    }
  }
  return values.join(" ");
}

/**
 * Marketplace v2 service.
 *
 * Tables (run `expo/supabase-schema.sql`):
 *   - public.marketplace_listings       → vendor EAGOHs for sale
 *   - public.marketplace_sync_purchases → buyer sync records
 *   - public.marketplace_vendor_stats   → aggregated vendor metrics
 *
 * Rules:
 *   - Free users can browse only.
 *   - Pro, Oracle Elite, and Syndicate can buy and sell.
 *   - No platform fee — credits transfer buyer → vendor.
 *   - Sync expires automatically after selected days.
 *
 * CRITICAL RLS POLICY REQUIRED (run in Supabase SQL Editor):
 *   The `eagohs_marketplace_select` policy must exist on public.eagohs
 *   so that the eagoh join returns data for listings owned by other users.
 *   Without it, eagoh images only display for the signed-in user's own
 *   EAGOHs. See expo/supabase-schema.sql lines 169-175.
 */

// ── Image Resolution ──────────────────────────────────────────────────

/**
 * Resolves the best displayable EAGOH image URL from marketplace-joined data.
 *
 * EAGOH images are stored as `image_url` / `image_thumb_url` on the eagohs row.
 * These are typically remote HTTPS URLs (Rork toolkit CDN) or data URIs.
 * Local device URIs (file://, content://, blob:) are NOT usable by other users.
 */
export function resolveMarketplaceEagohImage(
  eagoh: { image_url?: string | null; image_thumb_url?: string | null } | null | undefined,
): string | null {
  if (!eagoh) return null;

  const raw = eagoh.image_thumb_url ?? eagoh.image_url;
  if (!raw) return null;

  // Accept remote HTTPS URLs and data URIs (base64 images)
  if (raw.startsWith("https://") || raw.startsWith("data:")) {
    return raw;
  }

  // Reject local device URIs — these only work on the device that created them
  if (
    raw.startsWith("file://") ||
    raw.startsWith("content://") ||
    raw.startsWith("blob:")
  ) {
    if (__DEV__) {
      console.warn("[marketplace] ignoring local-only EAGOH image URI", raw.slice(0, 60));
    }
    return null;
  }

  // Unknown scheme — return as-is but log a warning
  if (__DEV__) {
    console.warn("[marketplace] unknown EAGOH image URI scheme", raw.slice(0, 60));
  }
  return raw;
}

// ── Types ──────────────────────────────────────────────────────────────

export type SyncLevel = "25%" | "50%" | "75%" | "100%";

export type MarketplaceListingRow = {
  id: string;
  vendor_id: string;
  eagoh_id: string;
  active: boolean;
  price_25_per_day: number;
  price_50_per_day: number;
  price_75_per_day: number;
  price_100_per_day: number;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type SyncPurchaseRow = {
  id: string;
  listing_id: string;
  buyer_id: string;
  /** Buyer EAGOH the sync is attributed to (Phase D2.3Q attribution; null
   *  only for legacy rows created before the column existed). */
  buyer_eagoh_id: string | null;
  vendor_id: string;
  eagoh_id: string;
  sync_level: SyncLevel;
  days: number;
  edge_cost: number;
  started_at: string;
  expires_at: string;
  active: boolean;
  created_at: string;
  buyer_display_name: string | null;
  buyer_avatar_url: string | null;
  purchase_status: string | null;
};

export type VendorStatsRow = {
  vendor_id: string;
  total_listings: number;
  active_listings: number;
  total_sales: number;
  total_edge_earned: number;
  edge_earned_this_month: number;
  edge_earned_last_month: number;
  month_key: string;
  sync_success_score: number;
  avg_quality_score: number;
  rank: string;
  created_at: string;
  updated_at: string;
};

/** A listing enriched with its EAGOH record and fanatic teams. */
export type EnrichedListing = MarketplaceListingRow & {
  eagoh: EagohRecord | null;
  fanatic_teams: string[];
  vendor_username: string | null;
  vendor_avatar_url: string | null;
  vendor_rank: string;
  sync_success_score: number;
  avg_quality_score: number;
  edge_earned_this_month: number;
  has_credentials: boolean;
  is_vendor_verified: boolean;
  vendor_verified_platform: string | null;
  vendor_verified_share_count: number;
};

export type EnrichedPurchase = SyncPurchaseRow & {
  eagoh_name: string;
  eagoh_image_url: string | null;
  vendor_username: string | null;
};

export type ListingFilters = {
  domain?: string;
  sport?: string;
  team?: string;
  /** Filter to Generalist EAGOHs (team_focus_mode = "none"). */
  generalist?: boolean;
  dna?: string;
  /** Music domain filters (canonical IDs). */
  musicGenre?: string;
  musicRole?: string;
  /** Film & TV domain filters (canonical IDs). */
  filmTvCategory?: string;
  filmTvGenre?: string;
  filmTvRole?: string;
  /** Fashion domain filters (canonical IDs). */
  fashionStyleCategory?: string;
  fashionRole?: string;
  /** Education domain filters (canonical IDs). */
  educationSubject?: string;
  educationRole?: string;
  /** Gaming domain filters (canonical IDs). */
  gamingGenre?: string;
  gamingRole?: string;
  /** Business domain filters (canonical IDs). */
  businessIndustry?: string;
  businessRole?: string;
  /** Finance domain filters (canonical IDs). */
  financeFocus?: string;
  financeRole?: string;
  /** Technology domain filters (canonical IDs). */
  technologyArea?: string;
  technologyRole?: string;
  /** Health & Fitness domain filters (canonical IDs). */
  healthFitnessArea?: string;
  healthFitnessRole?: string;
  syncLevel?: SyncLevel;
  maxPrice?: number;
  minPrice?: number;
  rank?: string;
  search?: string;
};

// ── Price helpers ──────────────────────────────────────────────────────

export function getPriceForLevel(listing: MarketplaceListingRow, level: SyncLevel): number {
  switch (level) {
    case "25%": return listing.price_25_per_day;
    case "50%": return listing.price_50_per_day;
    case "75%": return listing.price_75_per_day;
    case "100%": return listing.price_100_per_day;
  }
}

export function computeTotalCost(listing: MarketplaceListingRow, level: SyncLevel, days: number): number {
  return getPriceForLevel(listing, level) * days;
}

// ── Tier gating ─────────────────────────────────────────────────────────

/** Any tier with paid Pro access may transact on the Exchange. */
export function canTransact(tier: SubscriptionTier): boolean {
  return hasProAccess(tier);
}

// ── Current month key ──────────────────────────────────────────────────

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ── Vendor Stats ───────────────────────────────────────────────────────

/** Title + message pair for a user-facing marketplace error alert. */
export type MarketplaceErrorInfo = { title: string; message: string };

const CONNECTION_PROBLEM_MESSAGE =
  "EAGOH could not confirm the update because Supabase did not respond. Reopen the listing to verify the price, then try again if needed.";

/** Detects Cloudflare/Supabase gateway failures (522) and raw HTML error pages. */
function isGatewayOrHtmlResponse(raw: string): boolean {
  const lowered = raw.toLowerCase();
  return (
    lowered.includes("<!doctype html") ||
    lowered.includes("<html") ||
    lowered.includes("<head") ||
    lowered.includes("supabase.co | 522") ||
    lowered.includes("cloudflare") ||
    (lowered.includes("522") && lowered.includes("connection"))
  );
}

/**
 * Safely extracts a human-readable message from any common error shape:
 * JavaScript Error instances, raw strings, Supabase/PostgREST plain objects
 * with a string `message`, and objects nesting the message under
 * `error.message`. Returns "" when nothing recognizable is found.
 */
export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;

  if (err && typeof err === "object") {
    const record = err as Record<string, unknown>;

    if (typeof record.message === "string") {
      return record.message;
    }

    if (record.error && typeof record.error === "object") {
      const nested = record.error as Record<string, unknown>;
      if (typeof nested.message === "string") {
        return nested.message;
      }
    }
  }

  return "";
}

/**
 * Formats a marketplace error for display in an Alert.
 *
 * Supabase gateway timeouts (Cloudflare 522) return an HTML error page in
 * the response body, sometimes wrapped in a plain error object rather than
 * an Error instance. Surfacing that raw HTML in an Alert is unreadable and
 * leaks infrastructure details, so gateway/HTML responses are converted
 * into a friendly "Connection problem" message. Other errors are collapsed
 * to a single line and capped to a reasonable length.
 */
export function formatMarketplaceError(err: unknown): MarketplaceErrorInfo {
  const raw = extractErrorMessage(err);
  if (isGatewayOrHtmlResponse(raw)) {
    return { title: "Connection problem", message: CONNECTION_PROBLEM_MESSAGE };
  }
  const trimmed = raw.replace(/\s+/g, " ").trim();
  const concise =
    trimmed.length > 0
      ? trimmed.length > 140
        ? `${trimmed.slice(0, 140)}…`
        : trimmed
      : "Something went wrong. Please try again.";
  return { title: "Error", message: concise };
}

export async function getVendorStats(vendorId: string): Promise<VendorStatsRow | null> {
  const { data, error } = await supabase
    .from("marketplace_vendor_stats")
    .select("*")
    .eq("vendor_id", vendorId)
    .maybeSingle();
  if (error) throw error;
  return (data as VendorStatsRow | null) ?? null;
}

async function ensureVendorStats(vendorId: string): Promise<VendorStatsRow> {
  const existing = await getVendorStats(vendorId);
  if (existing) return existing;
  const row: Omit<VendorStatsRow, "created_at" | "updated_at"> = {
    vendor_id: vendorId,
    total_listings: 0,
    active_listings: 0,
    total_sales: 0,
    total_edge_earned: 0,
    edge_earned_this_month: 0,
    edge_earned_last_month: 0,
    month_key: currentMonthKey(),
    sync_success_score: 0,
    avg_quality_score: 0,
    rank: "UNRANKED",
  };
  const { data, error } = await supabase
    .from("marketplace_vendor_stats")
    .insert(row)
    .select("*");
  if (error) throw error;
  const stats = (data as VendorStatsRow[])?.[0];
  if (!stats) {
    console.warn(
      "[marketplace] vendor stats insert returned no row (RLS may block SELECT on insert). Using upsert fallback.",
    );
    // Try upsert — the row has vendor_id (PK) so upsert can insert if missing
    const { data: upserted, error: ue } = await supabase
      .from("marketplace_vendor_stats")
      .upsert(row, { onConflict: "vendor_id" })
      .select("*");
    if (ue) throw ue;
    const upsertedRow = (upserted as VendorStatsRow[])?.[0];
    if (!upsertedRow) {
      console.warn(
        "[marketplace] upsert also returned no row — returning local stats without persistence.",
      );
      return { ...row, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as VendorStatsRow;
    }
    return upsertedRow;
  }
  return stats;
}

/** Recalculate vendor stats from live data. */
export async function recalculateVendorStats(vendorId: string): Promise<VendorStatsRow> {
  const stats = await ensureVendorStats(vendorId);
  const monthKey = currentMonthKey();

  // Active listings
  const { count: activeCount, error: le } = await supabase
    .from("marketplace_listings")
    .select("id", { count: "exact", head: true })
    .eq("vendor_id", vendorId)
    .eq("active", true);
  if (le) console.warn("[marketplace] active count error", le.message);

  // Total listings
  const { count: totalListings, error: tle } = await supabase
    .from("marketplace_listings")
    .select("id", { count: "exact", head: true })
    .eq("vendor_id", vendorId);
  if (tle) console.warn("[marketplace] total listings error", tle.message);

  // Total sales
  const { count: totalSales, error: se } = await supabase
    .from("marketplace_sync_purchases")
    .select("id", { count: "exact", head: true })
    .eq("vendor_id", vendorId);
  if (se) console.warn("[marketplace] sales count error", se.message);

  // Total Edge earned
  const { data: edgeSums, error: eae } = await supabase
    .from("marketplace_sync_purchases")
    .select("edge_cost")
    .eq("vendor_id", vendorId);
  if (eae) console.warn("[marketplace] edge sum error", eae.message);
  const totalEarned = (edgeSums ?? []).reduce((sum, row) => sum + (row.edge_cost ?? 0), 0);

  // This month
  const monthStart = `${monthKey}-01T00:00:00Z`;
  const { data: monthSales, error: mse } = await supabase
    .from("marketplace_sync_purchases")
    .select("edge_cost")
    .eq("vendor_id", vendorId)
    .gte("created_at", monthStart);
  if (mse) console.warn("[marketplace] month sales error", mse.message);
  const earnedThisMonth = (monthSales ?? []).reduce((sum, row) => sum + (row.edge_cost ?? 0), 0);

  // Avg quality score from vendor's EAGOHs' OI entries
  const { data: eagohIds } = await supabase
    .from("eagohs")
    .select("id")
    .eq("user_id", vendorId);
  let avgQuality = 0;
  if (eagohIds && eagohIds.length > 0) {
    const ids = (eagohIds as { id: string }[]).map((r) => r.id);
    const { data: oiData } = await supabase
      .from("open_intelligence")
      .select("quality_score")
      .in("eagoh_id", ids);
    if (oiData && oiData.length > 0) {
      avgQuality = Math.round(
        (oiData as { quality_score: number }[]).reduce((s, r) => s + r.quality_score, 0) / oiData.length,
      );
    }
  }

  // Sync success score — based on completed (active=false) purchases
  const { data: completed } = await supabase
    .from("marketplace_sync_purchases")
    .select("id")
    .eq("vendor_id", vendorId)
    .eq("active", false);
  const { data: active } = await supabase
    .from("marketplace_sync_purchases")
    .select("id")
    .eq("vendor_id", vendorId)
    .eq("active", true);
  const totalPurchases = (completed?.length ?? 0) + (active?.length ?? 0);
  const syncSuccess = totalPurchases > 0
    ? Math.round(((completed?.length ?? 0) / totalPurchases) * 100)
    : 0;

  // Rank
  let rank = "UNRANKED";
  if (totalEarned >= 10000) rank = "S-TIER";
  else if (totalEarned >= 5000) rank = "ELITE";
  else if (totalEarned >= 1500) rank = "PRO";
  else if (totalEarned >= 200) rank = "RISING";

  const patch = {
    total_listings: totalListings ?? 0,
    active_listings: activeCount ?? 0,
    total_sales: totalSales ?? 0,
    total_edge_earned: totalEarned,
    edge_earned_this_month: earnedThisMonth,
    edge_earned_last_month: stats.edge_earned_this_month,
    month_key: monthKey,
    sync_success_score: syncSuccess,
    avg_quality_score: avgQuality,
    rank,
    updated_at: new Date().toISOString(),
  };

  const { data: updated, error: ue } = await supabase
    .from("marketplace_vendor_stats")
    .update(patch)
    .eq("vendor_id", vendorId)
    .select("*");
  if (ue) throw ue;
  const result = (updated as VendorStatsRow[])?.[0];
  if (!result) {
    // RLS may lack an UPDATE policy — fall back to upsert then local compute
    console.warn(
      "[marketplace] vendor stats update returned no row (missing UPDATE RLS policy?). Trying upsert.",
    );
    const { data: upserted, error: ue2 } = await supabase
      .from("marketplace_vendor_stats")
      .upsert({ ...patch, vendor_id: vendorId } as VendorStatsRow, { onConflict: "vendor_id" })
      .select("*");
    if (!ue2 && upserted?.[0]) return upserted[0] as VendorStatsRow;
    console.warn(
      "[marketplace] upsert fallback also failed — returning computed stats without persistence.",
    );
    return {
      ...stats,
      ...patch,
      created_at: stats.created_at ?? new Date().toISOString(),
    } as VendorStatsRow;
  }
  return result;
}

// ── Listings CRUD ──────────────────────────────────────────────────────

/**
 * Bulk-enrich marketplace listing rows with fanatic teams, vendor profiles,
 * vendor stats, credentials, and verification status.
 *
 * Runs exactly 5 Supabase requests in parallel regardless of how many listings
 * are passed in — no per-listing queries:
 *   1. eagoh_fanatic_teams  (filtered by eagoh_id IN (...))
 *   2. profiles              (filtered by id IN (...))
 *   3. marketplace_vendor_stats (filtered by vendor_id IN (...))
 *   4. getBulkEagohHasCredentials (already bulk)
 *   5. getBulkVerificationStatus  (already bulk)
 *
 * Results are converted into Maps keyed by eagoh_id / vendor_id and then
 * joined locally — eliminating the previous N+1 query pattern.
 */
async function bulkEnrichListings(
  rows: (MarketplaceListingRow & { eagoh: EagohRecord | null })[],
): Promise<EnrichedListing[]> {
  const vendorIds = [...new Set(rows.map((r) => r.vendor_id))];
  const eagohIds = [...new Set(rows.map((r) => r.eagoh_id))];

  const [teamsRows, profileRows, statsRows, credentialsSet, verificationMap] =
    await Promise.all([
      // 1. Fanatic teams — bulk query by eagoh_id
      supabase
        .from("eagoh_fanatic_teams")
        .select("eagoh_id, team_id")
        .in("eagoh_id", eagohIds)
        .then(({ data, error }) => {
          if (error) console.warn("[marketplace] bulk fanatic teams error", error.message);
          return (data ?? []) as { eagoh_id: string; team_id: string }[];
        }),
      // 2. Vendor profiles — bulk query by vendor id
      supabase
        .from("profiles")
        .select("id, username, avatar_url")
        .in("id", vendorIds)
        .then(({ data, error }) => {
          if (error) console.warn("[marketplace] bulk profiles error", error.message);
          return (data ?? []) as { id: string; username: string | null; avatar_url: string | null }[];
        }),
      // 3. Vendor stats — bulk query by vendor_id
      supabase
        .from("marketplace_vendor_stats")
        .select(
          "vendor_id, rank, sync_success_score, avg_quality_score, edge_earned_this_month",
        )
        .in("vendor_id", vendorIds)
        .then(({ data, error }) => {
          if (error) console.warn("[marketplace] bulk vendor stats error", error.message);
          return (data ?? []) as {
            vendor_id: string;
            rank: string;
            sync_success_score: number;
            avg_quality_score: number;
            edge_earned_this_month: number;
          }[];
        }),
      // 4. Credentials — already bulk
      getBulkEagohHasCredentials(eagohIds),
      // 5. Verification — already bulk
      getBulkVerificationStatus(vendorIds),
    ]);

  // Build Maps for O(1) local lookup
  const teamsByEagoh = new Map<string, string[]>();
  for (const t of teamsRows) {
    const arr = teamsByEagoh.get(t.eagoh_id);
    if (arr) arr.push(t.team_id);
    else teamsByEagoh.set(t.eagoh_id, [t.team_id]);
  }

  const profileByVendor = new Map<
    string,
    { username: string | null; avatar_url: string | null }
  >();
  for (const p of profileRows) {
    profileByVendor.set(p.id, { username: p.username, avatar_url: p.avatar_url });
  }

  const statsByVendor = new Map<
    string,
    {
      rank: string;
      sync_success_score: number;
      avg_quality_score: number;
      edge_earned_this_month: number;
    }
  >();
  for (const s of statsRows) {
    statsByVendor.set(s.vendor_id, s);
  }

  return rows.map((row) => {
    const profile = profileByVendor.get(row.vendor_id);
    const stats = statsByVendor.get(row.vendor_id);
    const verif = verificationMap.get(row.vendor_id);
    return {
      ...row,
      fanatic_teams: teamsByEagoh.get(row.eagoh_id) ?? [],
      vendor_username: profile?.username ?? null,
      vendor_avatar_url: profile?.avatar_url ?? null,
      vendor_rank: stats?.rank ?? "UNRANKED",
      sync_success_score: stats?.sync_success_score ?? 0,
      avg_quality_score: stats?.avg_quality_score ?? 0,
      edge_earned_this_month: stats?.edge_earned_this_month ?? 0,
      has_credentials: credentialsSet.has(row.eagoh_id),
      is_vendor_verified: verif?.isVerified ?? false,
      vendor_verified_platform: verif?.verifiedPlatform ?? null,
      vendor_verified_share_count: verif?.verifiedShareCount ?? 0,
    } as EnrichedListing;
  });
}

export async function listActiveListings(
  filters: ListingFilters = {},
  limit: number = 50,
  offset: number = 0,
): Promise<EnrichedListing[]> {
  // ── Rank filter: look up vendor IDs with the selected rank ──
  // This must happen before the listing query because we need the vendor IDs
  // to filter the listing query. If no vendors match, return empty immediately.
  let rankVendorIds: string[] | null = null;
  if (filters.rank) {
    const { data: rankVendors, error: rankErr } = await supabase
      .from("marketplace_vendor_stats")
      .select("vendor_id")
      .eq("rank", filters.rank);
    if (rankErr) {
      console.warn("[marketplace] rank vendor lookup error", rankErr.message);
      return [];
    }
    rankVendorIds = (rankVendors ?? []).map((r: { vendor_id: string }) => r.vendor_id);
    if (rankVendorIds.length === 0) return [];
  }

  // ── Build the listing query with safe server-side filters ──
  // Use !inner to force an INNER JOIN on eagohs — listings with a missing
  // or RLS-inaccessible EAGOH are already removed locally, so this is safe.
  let query = supabase
    .from("marketplace_listings")
    .select("*, eagoh:eagoh_id!inner(*)")
    .eq("active", true);

  // 1. Sport — exact match on related EAGOH sport
  if (filters.sport) {
    query = query.eq("eagoh.sport", filters.sport);
  }

  // 2. Domain — preserve nullish-fallback: match domain = selected,
  //    OR domain IS NULL and sport = selected (fallback to sport).
  //    Do not match a listing whose non-null domain differs merely
  //    because its sport matches.
  //
  //    The value must be quoted via quotePostgrestValue() because `.or()`
  //    uses raw PostgREST filter syntax — unquoted values containing
  //    metacharacters (commas, parentheses) could break the expression.
  if (filters.domain) {
    const quotedDomain = quotePostgrestValue(filters.domain);
    query = query.or(
      `domain.eq.${quotedDomain},and(domain.is.null,sport.eq.${quotedDomain})`,
      { referencedTable: "eagoh" },
    );
  }

  // 2b. Dormant vendor EAGOHs are never listed. Legacy NULL status rows
  //     remain eligible (PostgREST .neq alone would drop NULL rows under
  //     SQL three-valued logic, so the IS NULL arm is explicit).
  query = query.or("status.is.null,status.neq.dormant", { referencedTable: "eagoh" });

  // 3. Generalist — team_focus_mode = "none" or null (missing is treated as "none")
  if (filters.generalist) {
    query = query.or(
      "team_focus_mode.eq.none,team_focus_mode.is.null",
      { referencedTable: "eagoh" },
    );
  }

  // 4 & 5. DNA filters — collect all canonical DNA entries and apply
  //    a single array-contains filter before the limit
  const dnaEntries: string[] = [];
  if (filters.dna) dnaEntries.push(filters.dna);
  if (filters.musicGenre) dnaEntries.push(`dom:music_genre:${filters.musicGenre}`);
  if (filters.musicRole) dnaEntries.push(`dom:music_role:${filters.musicRole}`);
  if (filters.filmTvCategory) dnaEntries.push(`dom:film_tv_category:${filters.filmTvCategory}`);
  if (filters.filmTvGenre) dnaEntries.push(`dom:film_tv_genre:${filters.filmTvGenre}`);
  if (filters.filmTvRole) dnaEntries.push(`dom:film_tv_role:${filters.filmTvRole}`);
  if (filters.fashionStyleCategory) dnaEntries.push(`dom:fashion_style_category:${filters.fashionStyleCategory}`);
  if (filters.fashionRole) dnaEntries.push(`dom:fashion_role:${filters.fashionRole}`);
  if (filters.educationSubject) dnaEntries.push(`dom:education_subject:${filters.educationSubject}`);
  if (filters.educationRole) dnaEntries.push(`dom:education_role:${filters.educationRole}`);
  if (filters.gamingGenre) dnaEntries.push(`dom:gaming_genre:${filters.gamingGenre}`);
  if (filters.gamingRole) dnaEntries.push(`dom:gaming_role:${filters.gamingRole}`);
  if (filters.businessIndustry) dnaEntries.push(`dom:business_industry:${filters.businessIndustry}`);
  if (filters.businessRole) dnaEntries.push(`dom:business_role:${filters.businessRole}`);
  if (filters.financeFocus) dnaEntries.push(`dom:finance_focus:${filters.financeFocus}`);
  if (filters.financeRole) dnaEntries.push(`dom:finance_role:${filters.financeRole}`);
  if (filters.technologyArea) dnaEntries.push(`dom:technology_area:${filters.technologyArea}`);
  if (filters.technologyRole) dnaEntries.push(`dom:technology_role:${filters.technologyRole}`);
  if (filters.healthFitnessArea) dnaEntries.push(`dom:health_fitness_area:${filters.healthFitnessArea}`);
  if (filters.healthFitnessRole) dnaEntries.push(`dom:health_fitness_role:${filters.healthFitnessRole}`);
  if (dnaEntries.length > 0) {
    query = query.contains("eagoh.dna", dnaEntries);
  }

  // 6. Sync level — filter on the appropriate price column > 0
  if (filters.syncLevel) {
    switch (filters.syncLevel) {
      case "25%": query = query.gt("price_25_per_day", 0); break;
      case "50%": query = query.gt("price_50_per_day", 0); break;
      case "75%": query = query.gt("price_75_per_day", 0); break;
      case "100%": query = query.gt("price_100_per_day", 0); break;
    }
  }

  // 7. Rank — filter by vendor IDs with the selected rank (already looked up above)
  if (rankVendorIds) {
    query = query.in("vendor_id", rankVendorIds);
  }

  // Apply ordering and pagination after all filters
  query = query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, error } = await query;
  if (error) throw error;

  const rawRows: (MarketplaceListingRow & { eagoh: EagohRecord | null })[] = (data ?? []) as any;
  if (rawRows.length === 0) return [];

  // Filter out listings whose EAGOH has been deleted, is inaccessible due to
  // RLS, or is dormant. With !inner the first two are already handled by the
  // database — every check here is defense-in-depth alongside the server-side
  // domain + status filters applied before .range().
  const rows = rawRows.filter(
    (r) => r.eagoh && r.eagoh.id && r.eagoh.status !== "dormant",
  );
  if (rows.length === 0) return [];

  const enriched = await bulkEnrichListings(rows);
  let result = enriched;

  // ── Residual client-side filters ──
  // These filters depend on enrichment data or cross-table matching that
  // cannot be safely represented by the installed Supabase query builder
  // without dedicated database search infrastructure (full-text search,
  // computed columns, or materialized views). They are intentionally kept
  // client-side in this no-schema phase.
  //
  // Note: Free-text search only searches within the fetched result window
  // (newest `limit` active listings). Full server-side cross-table search
  // requires dedicated database search infrastructure and is intentionally
  // outside this no-schema phase.
  //
  // Already-pushed filters are kept below as defense-in-depth.

  if (filters.domain) {
    result = result.filter((l) => (l.eagoh?.domain ?? l.eagoh?.sport) === filters.domain);
  }
  if (filters.sport) {
    result = result.filter((l) => l.eagoh?.sport === filters.sport);
  }
  if (filters.generalist) {
    result = result.filter((l) => (l.eagoh?.team_focus_mode ?? "none") === "none");
  }
  if (filters.musicGenre) {
    result = result.filter((l) => getDomainDnaValue(l.eagoh?.dna, "music_genre") === filters.musicGenre);
  }
  if (filters.musicRole) {
    result = result.filter((l) => getDomainDnaValue(l.eagoh?.dna, "music_role") === filters.musicRole);
  }
  if (filters.filmTvCategory) {
    result = result.filter((l) => getDomainDnaValue(l.eagoh?.dna, "film_tv_category") === filters.filmTvCategory);
  }
  if (filters.filmTvGenre) {
    result = result.filter((l) => getDomainDnaValue(l.eagoh?.dna, "film_tv_genre") === filters.filmTvGenre);
  }
  if (filters.filmTvRole) {
    result = result.filter((l) => getDomainDnaValue(l.eagoh?.dna, "film_tv_role") === filters.filmTvRole);
  }
  if (filters.fashionStyleCategory) {
    result = result.filter((l) => getDomainDnaValue(l.eagoh?.dna, "fashion_style_category") === filters.fashionStyleCategory);
  }
  if (filters.fashionRole) {
    result = result.filter((l) => getDomainDnaValue(l.eagoh?.dna, "fashion_role") === filters.fashionRole);
  }
  if (filters.educationSubject) {
    result = result.filter((l) => getDomainDnaValue(l.eagoh?.dna, "education_subject") === filters.educationSubject);
  }
  if (filters.educationRole) {
    result = result.filter((l) => getDomainDnaValue(l.eagoh?.dna, "education_role") === filters.educationRole);
  }
  if (filters.gamingGenre) {
    result = result.filter((l) => getDomainDnaValue(l.eagoh?.dna, "gaming_genre") === filters.gamingGenre);
  }
  if (filters.gamingRole) {
    result = result.filter((l) => getDomainDnaValue(l.eagoh?.dna, "gaming_role") === filters.gamingRole);
  }
  if (filters.businessIndustry) {
    result = result.filter((l) => getDomainDnaValue(l.eagoh?.dna, "business_industry") === filters.businessIndustry);
  }
  if (filters.businessRole) {
    result = result.filter((l) => getDomainDnaValue(l.eagoh?.dna, "business_role") === filters.businessRole);
  }
  if (filters.financeFocus) {
    result = result.filter((l) => getDomainDnaValue(l.eagoh?.dna, "finance_focus") === filters.financeFocus);
  }
  if (filters.financeRole) {
    result = result.filter((l) => getDomainDnaValue(l.eagoh?.dna, "finance_role") === filters.financeRole);
  }
  if (filters.technologyArea) {
    result = result.filter((l) => getDomainDnaValue(l.eagoh?.dna, "technology_area") === filters.technologyArea);
  }
  if (filters.technologyRole) {
    result = result.filter((l) => getDomainDnaValue(l.eagoh?.dna, "technology_role") === filters.technologyRole);
  }
  if (filters.healthFitnessArea) {
    result = result.filter((l) => getDomainDnaValue(l.eagoh?.dna, "health_fitness_area") === filters.healthFitnessArea);
  }
  if (filters.healthFitnessRole) {
    result = result.filter((l) => getDomainDnaValue(l.eagoh?.dna, "health_fitness_role") === filters.healthFitnessRole);
  }
  if (filters.team) {
    const teamQuery = filters.team!.toLowerCase();
    result = result.filter((l) => {
      // Check new canonical fields first
      const proId = l.eagoh?.pro_team_focus_id;
      const colId = l.eagoh?.college_team_focus_id;
      const proName = l.eagoh?.pro_team_focus_name ?? "";
      const colName = l.eagoh?.college_team_focus_name ?? "";
      if (proId && (proId.toLowerCase().includes(teamQuery) || proName.toLowerCase().includes(teamQuery))) return true;
      if (colId && (colId.toLowerCase().includes(teamQuery) || colName.toLowerCase().includes(teamQuery))) return true;
      // Fallback: legacy fanatic_teams array
      return l.fanatic_teams.some((t) => {
        const display = getTeamById(t)?.display_name ?? "";
        return t.toLowerCase().includes(teamQuery) || display.toLowerCase().includes(teamQuery);
      });
    });
  }
  if (filters.dna) {
    result = result.filter((l) => (l.eagoh?.dna ?? []).includes(filters.dna!));
  }
  if (filters.rank) {
    result = result.filter((l) => l.vendor_rank === filters.rank);
  }
  if (filters.search) {
    const q = filters.search.toLowerCase();
    result = result.filter((l) => {
      const haystack = [
        l.eagoh?.name,
        l.eagoh?.sport,
        l.eagoh?.domain,
        l.vendor_username,
        l.description,
        l.eagoh?.pro_team_focus_name,
        l.eagoh?.college_team_focus_name,
        collectDomainDnaValues(l.eagoh?.dna),
        ...l.fanatic_teams,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }
  if (filters.syncLevel) {
    result = result.filter((l) => getPriceForLevel(l, filters.syncLevel!) > 0);
  }
  if (filters.minPrice != null) {
    result = result.filter((l) => {
      const prices = [l.price_25_per_day, l.price_50_per_day, l.price_75_per_day, l.price_100_per_day]
        .filter((p) => p > 0);
      return prices.length > 0 && Math.min(...prices) >= filters.minPrice!;
    });
  }
  if (filters.maxPrice != null) {
    result = result.filter((l) => {
      const prices = [l.price_25_per_day, l.price_50_per_day, l.price_75_per_day, l.price_100_per_day]
        .filter((p) => p > 0);
      return prices.length === 0 || prices.some((p) => p <= filters.maxPrice!);
    });
  }

  return result.slice(0, limit);
}

export async function getMyListings(vendorId: string): Promise<EnrichedListing[]> {
  const { data, error } = await supabase
    .from("marketplace_listings")
    .select("*, eagoh:eagoh_id(*)")
    .eq("vendor_id", vendorId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  const rawRows: (MarketplaceListingRow & { eagoh: EagohRecord | null })[] = (data ?? []) as any;
  if (rawRows.length === 0) return [];

  // Filter out listings whose EAGOH has been deleted or is inaccessible.
  const rows = rawRows.filter((r) => r.eagoh && r.eagoh.id);
  if (rows.length === 0) return [];

  return bulkEnrichListings(rows);
}

export type CreateListingInput = {
  vendorId: string;
  eagohId: string;
  price25PerDay: number;
  price50PerDay: number;
  price75PerDay: number;
  price100PerDay: number;
  description?: string;
};

export async function createListing(input: CreateListingInput): Promise<MarketplaceListingRow> {
  // ── Idempotency: if an active listing already exists for this
  // vendor + EAGOH, return it instead of creating a duplicate.
  // This handles retries, double-taps, and race conditions that slip
  // past the client-side re-entry guard.
  const { data: existing } = await supabase
    .from("marketplace_listings")
    .select("*")
    .eq("vendor_id", input.vendorId)
    .eq("eagoh_id", input.eagohId)
    .eq("active", true)
    .maybeSingle();

  if (existing) {
    // Return the existing listing — do NOT create a second one
    return existing as MarketplaceListingRow;
  }

  const row: Omit<MarketplaceListingRow, "id" | "created_at" | "updated_at"> = {
    vendor_id: input.vendorId,
    eagoh_id: input.eagohId,
    active: true,
    price_25_per_day: Math.max(0, Math.floor(input.price25PerDay)),
    price_50_per_day: Math.max(0, Math.floor(input.price50PerDay)),
    price_75_per_day: Math.max(0, Math.floor(input.price75PerDay)),
    price_100_per_day: Math.max(0, Math.floor(input.price100PerDay)),
    description: input.description?.trim() || null,
  };

  const { data, error } = await supabase
    .from("marketplace_listings")
    .insert(row)
    .select("*");
  if (error) throw error;
  const listing = (data as MarketplaceListingRow[])?.[0];
  if (!listing) throw new Error("Failed to create listing — no row returned.");

  // Recalc vendor stats
  await recalculateVendorStats(input.vendorId);

  return listing;
}

export async function toggleListingActive(listingId: string, active: boolean): Promise<void> {
  const { error } = await supabase
    .from("marketplace_listings")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", listingId);
  if (error) throw error;
}

export async function updateListing(
  listingId: string,
  updates: {
    price25PerDay?: number;
    price50PerDay?: number;
    price75PerDay?: number;
    price100PerDay?: number;
    description?: string;
  },
): Promise<MarketplaceListingRow> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.price25PerDay != null) patch.price_25_per_day = Math.max(0, Math.floor(updates.price25PerDay));
  if (updates.price50PerDay != null) patch.price_50_per_day = Math.max(0, Math.floor(updates.price50PerDay));
  if (updates.price75PerDay != null) patch.price_75_per_day = Math.max(0, Math.floor(updates.price75PerDay));
  if (updates.price100PerDay != null) patch.price_100_per_day = Math.max(0, Math.floor(updates.price100PerDay));
  if (updates.description !== undefined) patch.description = updates.description?.trim() || null;

  const { data, error } = await supabase
    .from("marketplace_listings")
    .update(patch)
    .eq("id", listingId)
    .select("*");
  if (error) throw error;
  const listing = (data as MarketplaceListingRow[])?.[0];
  if (!listing) throw new Error("Failed to update listing — no row returned.");

  // NOTE: vendor stats are intentionally NOT recalculated here.
  // Price and description edits affect no vendor-stat field (listings,
  // active listings, sales, earnings, sync score, quality score, rank),
  // so the recalc chain (≈11 sequential queries) is skipped entirely.
  // Stats are only refreshed where they actually change: listing creation
  // recalcs client-side, and purchases update them server-side inside the
  // atomic purchase RPC. Activation/deactivation performs no stats recalc.

  return listing;
}

export async function deleteListing(listingId: string): Promise<void> {
  const { error } = await supabase.from("marketplace_listings").delete().eq("id", listingId);
  if (error) throw error;
}

// ── Purchases ──────────────────────────────────────────────────────────

export type PurchaseResult =
  | { ok: true; purchase: SyncPurchaseRow }
  | { ok: false; error: string };

/**
 * Purchase a sync from a listing.
 *
 * This function makes ONE request to the secure worker endpoint
 * /exchange/purchase, which calls the purchase_marketplace_sync_atomic
 * PostgreSQL RPC. The RPC performs ALL financial operations inside a
 * single database transaction:
 *   - validate listing (active, not self-purchase)
 *   - calculate price server-side
 *   - lock buyer balance row (FOR UPDATE)
 *   - deduct buyer neurons (subscription first, purchased second)
 *   - credit vendor neurons
 *   - insert marketplace_sync_purchases record
 *   - insert edge_transactions ledger rows (buyer deduction + vendor credit)
 *   - update marketplace_vendor_stats
 *
 * If ANY step fails, the ENTIRE transaction rolls back — zero neurons
 * charged, zero vendor credits, zero purchase rows.
 *
 * The client NEVER directly deducts neurons, credits the vendor, or inserts
 * a purchase row. Idempotency: the WORKER derives a deterministic key from
 * trusted/validated values (authenticated user + validated buyer EAGOH +
 * listing + level + days) — the client never supplies one.
 *
 * Phase D2: the request identifies only the listing, the buyer EAGOH, the
 * sync level, and the days. No client-selected domain, price, buyer user ID,
 * tier, balance, or idempotency key is ever sent. The Worker verifies the
 * buyer EAGOH and vendor listing server-side and enforces same-domain
 * purchases before invoking the RPC.
 *
 * After the atomic transaction succeeds, best-effort post-purchase
 * operations (retention trigger, vendor sale notification) fire
 * non-fatally — their failure does NOT affect the completed transaction.
 */
export async function purchaseSync(
  listingId: string,
  buyerEagohId: string,
  syncLevel: SyncLevel,
  days: number,
): Promise<PurchaseResult> {
  if (days < 1 || days > 5) {
    return { ok: false, error: "Duration must be between 1 and 5 days." };
  }

  if (!buyerEagohId) {
    return { ok: false, error: "Select an active forged EAGOH to make this purchase." };
  }

  // ── Get JWT for worker authentication ──
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt || !FUNCTIONS_BASE_URL) {
    return { ok: false, error: "Authentication required." };
  }

  try {
    const res = await fetch(`${FUNCTIONS_BASE_URL}/exchange/purchase`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ listingId, buyerEagohId, syncLevel, days }),
    });

    const result = await res.json() as {
      ok: boolean;
      error?: string;
      duplicate?: boolean;
      purchase?: SyncPurchaseRow;
      newBalance?: { subscription: number; purchased: number; total: number };
    };

    if (!result.ok) {
      return { ok: false, error: result.error ?? "Purchase failed. No neurons were charged." };
    }

    const completedPurchase = result.purchase as SyncPurchaseRow;

    // ── Best-effort post-purchase operations (non-fatal) ──
    // These happen AFTER the atomic transaction has committed.
    // Their failure does NOT affect the completed financial transaction.

    // 1. Trigger retained exchange intelligence (also handled by DB trigger)
    void triggerRetention(completedPurchase.id);

    // 2. Trigger vendor sale notification
    void triggerVendorSaleNotification(completedPurchase.id);

    return { ok: true, purchase: completedPurchase };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Network error";
    return { ok: false, error: `Purchase failed. No neurons were charged. (${errMsg})` };
  }
}

/**
 * Check and expire any active syncs that have passed their expiration date.
 * Called periodically or on screen load.
 *
 * PHASE RETAINED-OI-2: Expiration now records the trusted purchase_status =
 * 'expired' via the security-definer RPC `mark_purchase_expired`. This writes
 * an audit row and sets active = false. It does NOT deactivate Retained
 * Exchange Intelligence — retained entries are permanent after a valid
 * completed purchase and may only be deactivated by a recorded reversal
 * (refund, payment_reversal, chargeback, dispute, invalid_purchase,
 * admin_revocation). `mark_purchase_expired` refuses to overwrite a recorded
 * reversal status, so a refunded purchase stays refunded.
 */
export async function expireSyncs(buyerId: string): Promise<number> {
  const now = new Date().toISOString();
  const { data: expired, error } = await supabase
    .from("marketplace_sync_purchases")
    .select("id")
    .eq("buyer_id", buyerId)
    .eq("active", true)
    .lt("expires_at", now);

  if (error) {
    console.warn("[marketplace] expire query failed", error.message);
    return 0;
  }
  if (!expired || expired.length === 0) return 0;

  const ids = (expired as { id: string }[]).map((r) => r.id);

  // Record the trusted 'expired' status via the security-definer RPC. Best-effort
  // per purchase: a failure on one does not stop the others. The RPC is granted
  // to authenticated and is idempotent (re-calling on an already-expired
  // purchase returns skipped=true). It never deactivates retained intelligence.
  const results = await Promise.allSettled(
    ids.map((id) => supabase.rpc("mark_purchase_expired", { p_purchase_id: id })),
  );
  let expiredCount = 0;
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      const rpcErr = result.value.error;
      if (rpcErr) {
        console.warn("[marketplace] mark_purchase_expired failed", ids[index].slice(0, 8), rpcErr.message);
      } else {
        expiredCount += 1;
      }
    } else {
      console.warn("[marketplace] mark_purchase_expired rejected", ids[index].slice(0, 8), result.reason instanceof Error ? result.reason.message : "unknown");
    }
  });

  // NOTE: Normal sync expiration does NOT deactivate Retained Exchange
  // Intelligence. The buyer's retained 2% is permanent after a valid
  // completed purchase. Expiration only ends the temporary 1–5 day
  // Exchange access (preventing further temporary Exchange retrieval).
  // Retained entries may only be deactivated for refund, payment reversal,
  // chargeback/dispute, invalid purchase cancellation, or admin revocation.

  return expiredCount;
}

/**
 * Bulk-enrich sync purchase rows with EAGOH name/image and vendor username.
 *
 * Runs exactly 2 Supabase requests regardless of purchase count:
 *   1. eagohs    (filtered by id IN (...))
 *   2. profiles  (filtered by id IN (...))
 *
 * Results are converted into Maps keyed by eagoh_id / vendor_id and joined
 * locally — eliminating the previous N+1 per-purchase query pattern.
 * If one enrichment query fails, fallback values are used and the purchases
 * are still returned with whatever enrichment data was successfully loaded.
 */
async function bulkEnrichPurchases(rows: SyncPurchaseRow[]): Promise<EnrichedPurchase[]> {
  if (rows.length === 0) return [];

  const uniqueEagohIds = [...new Set(rows.map((r) => r.eagoh_id))];
  const uniqueVendorIds = [...new Set(rows.map((r) => r.vendor_id))];

  // Run both enrichment queries concurrently
  const [eagohRows, profileRows] = await Promise.all([
    // 1. EAGOHs — bulk query by id
    supabase
      .from("eagohs")
      .select("id, name, image_url, image_thumb_url")
      .in("id", uniqueEagohIds)
      .then(({ data, error }) => {
        if (error) console.warn("[marketplace] bulk eagohs error (non-fatal)", error.message);
        return (data ?? []) as { id: string; name: string | null; image_url: string | null; image_thumb_url: string | null }[];
      }),
    // 2. Profiles — bulk query by vendor id
    supabase
      .from("profiles")
      .select("id, username")
      .in("id", uniqueVendorIds)
      .then(({ data, error }) => {
        if (error) console.warn("[marketplace] bulk profiles error (non-fatal)", error.message);
        return (data ?? []) as { id: string; username: string | null }[];
      }),
  ]);

  // Build Maps for O(1) local lookup
  const eagohById = new Map<
    string,
    { name: string | null; image_url: string | null; image_thumb_url: string | null }
  >();
  for (const e of eagohRows) {
    eagohById.set(e.id, {
      name: e.name,
      image_url: e.image_url,
      image_thumb_url: e.image_thumb_url,
    });
  }

  const usernameByVendor = new Map<string, string | null>();
  for (const p of profileRows) {
    usernameByVendor.set(p.id, p.username);
  }

  // Enrich every purchase locally from the maps — no DB queries inside the loop
  return rows.map((row) => {
    const eagoh = eagohById.get(row.eagoh_id);
    return {
      ...row,
      eagoh_name: eagoh?.name ?? "Unknown EAGOH",
      eagoh_image_url: eagoh?.image_thumb_url ?? eagoh?.image_url ?? null,
      vendor_username: usernameByVendor.get(row.vendor_id) ?? null,
    };
  });
}

/**
 * Get active syncs for a buyer (currently active purchases).
 *
 * Phase D2.3Q: account-wide by design — filtered only by buyer_id,
 * active = true, and (when the trusted status column exists on this
 * database) purchase_status = 'completed'. Never scoped by the selected
 * buyer EAGOH, domain, filters, listing visibility, or tab. Expired and
 * reversed purchases (active = false) are excluded here but remain
 * permanently in getMyPurchases history — expiration never deletes.
 */
export async function getActiveSyncs(buyerId: string): Promise<EnrichedPurchase[]> {
  await expireSyncs(buyerId); // Clean up expired first

  const fetchActive = async (withStatusFilter: boolean) => {
    let q = supabase
      .from("marketplace_sync_purchases")
      .select("*")
      .eq("buyer_id", buyerId)
      .eq("active", true)
      .order("expires_at", { ascending: true });
    if (withStatusFilter) {
      q = q.eq("purchase_status", "completed");
    }
    return await q;
  };

  let res = await fetchActive(true);
  if (res.error?.code === "PGRST204") {
    // The trusted purchase_status column is not present on this database
    // yet — retry without the status filter. active = true already excludes
    // expired rows, so results stay correct on unmigrated databases.
    res = await fetchActive(false);
  }

  if (res.error) throw res.error;
  const rows = (res.data ?? []) as SyncPurchaseRow[];

  return bulkEnrichPurchases(rows);
}

/** Get all purchases (including expired) for a buyer. */
export async function getMyPurchases(buyerId: string, limit: number = 30): Promise<EnrichedPurchase[]> {
  const { data, error } = await supabase
    .from("marketplace_sync_purchases")
    .select("*")
    .eq("buyer_id", buyerId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  const rows = (data ?? []) as SyncPurchaseRow[];

  return bulkEnrichPurchases(rows);
}

/** Get a single listing by ID (enriched). */
export async function getListingById(listingId: string): Promise<EnrichedListing | null> {
  const { data, error } = await supabase
    .from("marketplace_listings")
    .select("*, eagoh:eagoh_id(*)")
    .eq("id", listingId)
    .single();
  if (error || !data) return null;

  const row = data as MarketplaceListingRow & { eagoh: EagohRecord | null };

  const { data: teams } = await supabase
    .from("eagoh_fanatic_teams")
    .select("team_id")
    .eq("eagoh_id", row.eagoh_id);

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, avatar_url")
    .eq("id", row.vendor_id)
    .maybeSingle();

  const stats = await getVendorStats(row.vendor_id);
  const credentialsSet = await getBulkEagohHasCredentials([row.eagoh_id]);
  const verificationMap = await getBulkVerificationStatus([row.vendor_id]);
  const verif = verificationMap.get(row.vendor_id);

  return {
    ...row,
    fanatic_teams: (teams ?? []).map((t: any) => t.team_id),
    vendor_username: (profile as { username: string | null; avatar_url: string | null } | null)?.username ?? null,
    vendor_avatar_url: (profile as { username: string | null; avatar_url: string | null } | null)?.avatar_url ?? null,
    vendor_rank: stats?.rank ?? "UNRANKED",
    sync_success_score: stats?.sync_success_score ?? 0,
    avg_quality_score: stats?.avg_quality_score ?? 0,
    edge_earned_this_month: stats?.edge_earned_this_month ?? 0,
    has_credentials: credentialsSet.has(row.vendor_id),
    is_vendor_verified: verif?.isVerified ?? false,
    vendor_verified_platform: verif?.verifiedPlatform ?? null,
    vendor_verified_share_count: verif?.verifiedShareCount ?? 0,
  };
}

/**
 * Get distinct domains and sports available in active listings (for filter
 * chips).
 *
 * Phase D1: metadata is scoped to the selected buyer-EAGOH domain. The query
 * inner-joins active listings to their vendor EAGOH and filters to the
 * selected domain BEFORE returning sport metadata, using the same legacy
 * null-domain fallback (domain ?? sport) as the listing query. Dormant
 * EAGOHs are excluded server-side; legacy NULL status rows stay eligible.
 * Rank metadata is vendor-level and unaffected by the domain scope.
 *
 * Returns empty metadata when no domain is selected — never all-domain data.
 */
export async function getActiveFilters(
  selectedDomain: string,
): Promise<{ domains: string[]; sports: string[]; ranks: string[] }> {
  if (!selectedDomain) return { domains: [], sports: [], ranks: [] };

  const quotedDomain = quotePostgrestValue(selectedDomain);
  const { data, error } = await supabase
    .from("marketplace_listings")
    .select("eagoh:eagoh_id!inner(domain, sport)")
    .eq("active", true)
    .or(
      `and(or(domain.eq.${quotedDomain},and(domain.is.null,sport.eq.${quotedDomain})),or(status.is.null,status.neq.dormant))`,
      { referencedTable: "eagoh" },
    );
  if (error) return { domains: [], sports: [], ranks: [] };

  const domains = new Set<string>();
  const sports = new Set<string>();
  for (const row of (data ?? []) as any[]) {
    const e = row.eagoh;
    if (e?.domain) domains.add(e.domain);
    if (e?.sport) sports.add(e.sport);
  }

  // Distinct ranks
  const { data: rankRows } = await supabase
    .from("marketplace_vendor_stats")
    .select("rank")
    .not("rank", "eq", "UNRANKED");
  const ranks = new Set<string>((rankRows ?? []).map((r: any) => r.rank));

  return {
    domains: [...domains].sort(),
    sports: [...sports].sort(),
    ranks: [...ranks].sort(),
  };
}
