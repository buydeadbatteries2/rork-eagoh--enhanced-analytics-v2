import { supabase } from "@/lib/supabase";
import { normalizeDomainId } from "./domains";
import type { UserProfile, SubscriptionTier } from "@/services/profile";

// ── Image Resolution ───────────────────────────────────────────────────

/**
 * Resolves the best displayable EAGOH image URL from banner-joined eagoh data.
 *
 * EAGOH images are stored as `image_url` / `image_thumb_url` on the eagohs row.
 * These are typically remote HTTPS URLs (Rork toolkit CDN) or data URIs.
 * Local device URIs (file://, content://, blob:) are NOT usable by other users.
 *
 * This mirrors `resolveMarketplaceEagohImage` in marketplace.ts so that
 * sponsored banner cards and Exchange listing cards use the exact same
 * image resolution logic.
 */
export function resolveBannerEagohImage(
  eagoh: { image_url?: string | null; image_thumb_url?: string | null } | null | undefined,
): string | null {
  if (!eagoh) return null;

  const raw = eagoh.image_thumb_url ?? eagoh.image_url;
  if (!raw || typeof raw !== "string") return null;

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
      console.warn("[sponsoredBanners] ignoring local-only EAGOH image URI", raw.slice(0, 60));
    }
    return null;
  }

  // Unknown scheme — return as-is but log a warning
  if (__DEV__) {
    console.warn("[sponsoredBanners] unknown EAGOH image URI scheme", raw.slice(0, 60));
  }
  return raw;
}

// ── Types ──────────────────────────────────────────────────────────────

export type BannerLocation = "home" | "marketplace";

export type SponsoredBanner = {
  id: string;
  purchaser_id: string;
  eagoh_id: string;
  location: BannerLocation;
  start_date: string;
  end_date: string;
  booking_dates: string[] | null;
  listing_id: string | null;
  colored_border: boolean;
  hot_badge: boolean;
  edge_cost: number;
  active: boolean;
  created_at: string;
};

export type BannerPurchase = {
  id: string;
  user_id: string;
  banner_id: string | null;
  eagoh_id: string;
  location: BannerLocation;
  start_date: string;
  days: number;
  booking_dates: string[] | null;
  listing_id: string | null;
  colored_border: boolean;
  hot_badge: boolean;
  edge_cost: number;
  created_at: string;
};

export type BannerAnalytics = {
  id: string;
  banner_id: string;
  user_id: string;
  date: string;
  impressions: number;
  tap_count: number;
  tap_hold_count: number;
  updated_at: string;
};

export type EnrichedBanner = SponsoredBanner & {
  eagoh_name: string;
  eagoh_domain: string;
  eagoh_image_url: string | null;
  vendor_username: string | null;
  quality_score: number;
  sync_score: number;
  vendor_rank: string;
  listing_id: string | null;
};

export type BannerPurchaseInput = {
  userId: string;
  eagohId: string;
  location: BannerLocation;
  startDate: string;
  days: number;
  selectedDates: string[];
  listingId: string | null;
  coloredBorder: boolean;
  hotBadge: boolean;
  effectiveTier?: SubscriptionTier;
};

// ── Cost constants ─────────────────────────────────────────────────────

export const BANNER_COSTS: Record<BannerLocation, number> = {
  home: 250,
  marketplace: 150,
};

export const PREMIUM_COSTS = {
  coloredBorder: 10,
  hotBadge: 15,
} as const;

export const MAX_BANNER_DAYS = 5;

/**
 * Compute the total Edge cost for a banner purchase including premium effects.
 * Uses the number of days (or selected dates count) as the multiplier.
 */
export function computeBannerCost(
  location: BannerLocation,
  days: number,
  coloredBorder: boolean,
  hotBadge: boolean,
): number {
  const base = BANNER_COSTS[location] * days;
  const borderCost = coloredBorder ? PREMIUM_COSTS.coloredBorder * days : 0;
  const hotCost = hotBadge ? PREMIUM_COSTS.hotBadge * days : 0;
  return base + borderCost + hotCost;
}

/**
 * Compute the total Edge cost for a multi-date banner purchase.
 * Each selected date represents one promotion day.
 */
export function computeBannerCostForDates(
  location: BannerLocation,
  selectedDates: string[],
  coloredBorder: boolean,
  hotBadge: boolean,
): number {
  const dayCount = selectedDates.length;
  return computeBannerCost(location, dayCount, coloredBorder, hotBadge);
}

// ── Active banners ─────────────────────────────────────────────────────

/**
 * Quotes a value inside a raw PostgREST `.or()` expression so domain IDs
 * containing metacharacters are interpreted literally. Mirrors
 * quotePostgrestValue() in marketplace.ts.
 */
function quotePostgrestValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Fetch currently active banners for a location. Banners are active when
 * `active = true` AND the current date falls between start_date and end_date.
 *
 * Phase D2 domain scoping:
 *   - For location "marketplace", `selectedDomain` is REQUIRED and the query
 *     is scoped to that domain (domain = selected, or domain IS NULL with
 *     sport = selected — the legacy `domain ?? sport` fallback) BEFORE
 *     `.limit(10)`. No domain → no marketplace banners, never all-domain data.
 *   - Dormant vendor EAGOHs are excluded server-side; legacy NULL status
 *     rows remain eligible (explicit IS NULL arm — `.neq` alone drops NULLs
 *     under SQL three-valued logic).
 *   - Home banners retain their current behavior unless a domain is
 *     explicitly supplied.
 *
 * Phase D2.1: `selectedDomain` is normalized (normalizeDomainId) before the
 * PostgREST domain filter is constructed, so legacy raw values behave the
 * same as canonical ids. All other behavior above is preserved.
 */
export async function getActiveBanners(
  location: BannerLocation,
  selectedDomain?: string,
): Promise<EnrichedBanner[]> {
  const today = new Date().toISOString().slice(0, 10);
  // Phase D2.1: normalize before building the filter (and before the
  // mandatory-domain check) so comparisons use the canonical form.
  const domain = selectedDomain ? normalizeDomainId(selectedDomain.trim()) : "";

  // Marketplace sponsors are domain-scoped — no selection means no banners.
  if (location === "marketplace" && !domain) return [];

  let query = supabase
    .from("sponsored_banners")
    .select(`
      *,
      eagoh: eagohs!inner (
        id, name, domain, sport, status, image_url, image_thumb_url
      )
    `)
    .eq("location", location)
    .eq("active", true)
    .lte("start_date", today)
    .gte("end_date", today);

  if (domain) {
    const quotedDomain = quotePostgrestValue(domain);
    query = query.or(
      `domain.eq.${quotedDomain},and(domain.is.null,sport.eq.${quotedDomain})`,
      { referencedTable: "eagoh" },
    );
  }

  // Dormant vendor EAGOHs are never sponsored (legacy NULL status stays eligible).
  query = query.or("status.is.null,status.neq.dormant", { referencedTable: "eagoh" });

  const { data: banners, error } = await query
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.warn("[sponsoredBanners] getActiveBanners error", error.message);
    return [];
  }

  return enrichBanners(banners ?? []);
}

/** Fetch all active banners for a given user (for dashboard). */
export async function getMyActiveBanners(userId: string): Promise<EnrichedBanner[]> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: banners, error } = await supabase
    .from("sponsored_banners")
    .select(`
      *,
      eagoh: eagohs!inner (
        id, name, sport, image_url, image_thumb_url
      )
    `)
    .eq("purchaser_id", userId)
    .eq("active", true)
    .gte("end_date", today)
    .order("start_date", { ascending: false });

  if (error) {
    console.warn("[sponsoredBanners] getMyActiveBanners error", error.message);
    return [];
  }

  return enrichBanners(banners ?? []);
}

// ── Purchase flow ──────────────────────────────────────────────────────

/**
 * Validate that a listing ID belongs to the user and is active.
 * Returns the listing row or an error message.
 */
async function validateListingOwnership(
  supabaseClient: typeof supabase,
  listingId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: listing, error } = await supabaseClient
    .from("marketplace_listings")
    .select("id, vendor_id, active")
    .eq("id", listingId)
    .maybeSingle();

  if (error || !listing) {
    return { ok: false, error: "Enter a valid EAGOH Exchange listing link." };
  }
  const row = listing as { id: string; vendor_id: string; active: boolean };
  if (row.vendor_id !== userId) {
    return { ok: false, error: "This listing does not belong to your account." };
  }
  if (!row.active) {
    return { ok: false, error: "This Exchange listing is not currently active." };
  }
  return { ok: true };
}

/** Parse a listing URL and extract the listing ID. */
export function parseListingUrl(url: string): string | null {
  const trimmed = url.trim();
  // Accept https://eagoh.app/listing/<uuid>
  const match = trimmed.match(/^https:\/\/eagoh\.app\/listing\/([a-f0-9-]{36})$/i);
  if (match) return match[1];
  // Also accept raw UUID
  if (/^[a-f0-9-]{36}$/i.test(trimmed)) return trimmed;
  return null;
}

/**
 * Purchase a sponsored banner placement via the secure worker endpoint.
 *
 * The worker calls the `purchase_banner_atomic` PostgreSQL RPC which does
 * EVERYTHING in one transaction: validation, neuron deduction, banner insert,
 * purchase history, and edge transaction logging. If any step fails, the
 * entire transaction rolls back — zero neurons deducted, zero banners created.
 *
 * The client NEVER directly deducts neurons or inserts banner rows.
 * The server computes the final price — the client never decides it.
 *
 * Idempotency: a deterministic key prevents duplicate purchases from repeated
 * taps or network retries. A duplicate key returns the original successful result.
 */

const FUNCTIONS_BASE_URL = process.env.EXPO_PUBLIC_RORK_FUNCTIONS_URL ?? "";

export type BannerPurchaseResult = {
  ok: true;
  bannerId: string;
  edgeCost: number;
  dayCount: number;
  selectedDates: string[];
  duplicate: boolean;
  newBalance?: { subscription: number; purchased: number; total: number };
} | { ok: false; error: string };

export async function purchaseBanner(
  input: BannerPurchaseInput,
  _profile: UserProfile,
): Promise<BannerPurchaseResult> {
  const {
    userId,
    eagohId,
    location,
    selectedDates,
    listingId,
    coloredBorder,
    hotBadge,
  } = input;

  // ── Client-side pre-validation (fast feedback before network round-trip) ──
  if (!selectedDates || selectedDates.length === 0) {
    return { ok: false, error: "Select at least one promotion date." };
  }
  if (selectedDates.length > MAX_BANNER_DAYS) {
    return { ok: false, error: `You can select up to ${MAX_BANNER_DAYS} promotion dates.` };
  }

  const uniqueDates = [...new Set(selectedDates)];
  if (uniqueDates.length !== selectedDates.length) {
    return { ok: false, error: "Duplicate dates detected. Please remove duplicates." };
  }

  const sortedDates = uniqueDates.sort();

  for (const d of sortedDates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return { ok: false, error: `Invalid date format: ${d}` };
    }
  }

  if (!listingId) {
    return { ok: false, error: "Enter a valid EAGOH Exchange listing link." };
  }

  // ── Client-side listing pre-validation (fast feedback) ──
  if (userId) {
    const listingResult = await validateListingOwnership(supabase, listingId, userId);
    if (!listingResult.ok) {
      return { ok: false, error: listingResult.error };
    }
  }

  if (!FUNCTIONS_BASE_URL) {
    return { ok: false, error: "Backend not configured. Cannot process purchase." };
  }

  // ── Get JWT for worker auth ──
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token ?? null;
  if (!token) {
    return { ok: false, error: "Authentication required." };
  }

  // ── Generate deterministic idempotency key ──
  // Same purchase params = same key → duplicate taps return original result
  const idempotencyKey = `banner:${userId}:${eagohId}:${location}:${sortedDates.join(",")}:${coloredBorder ? 1 : 0}:${hotBadge ? 1 : 0}`;

  // ── Call the worker endpoint ──
  try {
    const res = await fetch(`${FUNCTIONS_BASE_URL}/banner/purchase`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        eagohId,
        location,
        selectedDates: sortedDates,
        listingId,
        coloredBorder,
        hotBadge,
        idempotencyKey,
      }),
    });

    const data = (await res.json()) as BannerPurchaseResult;
    return data;
  } catch (err) {
    console.warn("[sponsoredBanners] purchaseBanner request failed", (err as Error).message);
    return { ok: false, error: "Banner purchase failed. No neurons were charged." };
  }
}

// ── Booking history types ──────────────────────────────────────────────

export type BannerBookingStatus = "scheduled" | "active" | "completed" | "cancelled" | "failed";

export type BannerBooking = {
  id: string;
  eagoh_id: string;
  eagoh_name: string;
  eagoh_image_url: string | null;
  location: BannerLocation;
  start_date: string;
  end_date: string;
  booking_dates: string[] | null;
  listing_id: string | null;
  colored_border: boolean;
  hot_badge: boolean;
  edge_cost: number;
  active: boolean;
  created_at: string;
  idempotency_key: string | null;
  status: BannerBookingStatus;
};

/**
 * Compute booking status from banner row fields.
 * - Scheduled: all booking dates are in the future (after today ET)
 * - Active: at least one booking date is today or past AND at least one is future
 * - Completed: all booking dates are in the past, banner still active
 * - Cancelled: active = false
 * - Failed: no banner row exists for a purchase record (orphaned deduction)
 */
export function computeBookingStatus(banner: {
  booking_dates: string[] | null;
  start_date: string;
  end_date: string;
  active: boolean;
}): BannerBookingStatus {
  if (!banner.active) return "cancelled";

  const todayET = (() => {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = fmt.formatToParts(now);
    const y = parts.find((p) => p.type === "year")?.value ?? "2026";
    const m = parts.find((p) => p.type === "month")?.value ?? "01";
    const d = parts.find((p) => p.type === "day")?.value ?? "01";
    return `${y}-${m}-${d}`;
  })();

  const dates = banner.booking_dates ?? [banner.start_date, banner.end_date];
  const allPast = dates.every((d) => d < todayET);
  const allFuture = dates.every((d) => d > todayET);
  const hasTodayOrPast = dates.some((d) => d <= todayET);
  const hasFuture = dates.some((d) => d > todayET);

  if (allFuture) return "scheduled";
  if (hasTodayOrPast && hasFuture) return "active";
  if (allPast) return "completed";
  return "active";
}

/**
 * Fetch the authenticated user's banner bookings with EAGOH name and image.
 * Returns enriched banner rows with computed status.
 * Only returns bookings belonging to the authenticated user (RLS enforced).
 */
export async function getMyBannerBookings(userId: string): Promise<BannerBooking[]> {
  const { data: banners, error } = await supabase
    .from("sponsored_banners")
    .select(`
      id,
      eagoh_id,
      location,
      start_date,
      end_date,
      booking_dates,
      listing_id,
      colored_border,
      hot_badge,
      edge_cost,
      active,
      created_at,
      idempotency_key,
      eagoh:eagohs!inner (
        id,
        name,
        image_url,
        image_thumb_url
      )
    `)
    .eq("purchaser_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.warn("[sponsoredBanners] getMyBannerBookings error", error.message);
    return [];
  }

  const rows = banners ?? [];
  return rows.map((b: any) => {
    const eagoh = b.eagoh ?? {};
    const baseBanner = {
      booking_dates: b.booking_dates as string[] | null,
      start_date: b.start_date as string,
      end_date: b.end_date as string,
      active: b.active as boolean,
    };
    return {
      id: b.id as string,
      eagoh_id: b.eagoh_id as string,
      eagoh_name: (eagoh.name as string) ?? "Unnamed",
      eagoh_image_url: resolveBannerEagohImage({ image_url: eagoh.image_url as string | null, image_thumb_url: eagoh.image_thumb_url as string | null }),
      location: b.location as BannerLocation,
      start_date: b.start_date as string,
      end_date: b.end_date as string,
      booking_dates: (b.booking_dates as string[] | null) ?? null,
      listing_id: (b.listing_id as string | null) ?? null,
      colored_border: b.colored_border as boolean,
      hot_badge: b.hot_badge as boolean,
      edge_cost: b.edge_cost as number,
      active: b.active as boolean,
      created_at: b.created_at as string,
      idempotency_key: (b.idempotency_key as string | null) ?? null,
      status: computeBookingStatus(baseBanner),
    };
  });
}

// ── Purchase history ───────────────────────────────────────────────────

/** Fetch purchase history for a given user. */
export async function getMyBannerPurchases(userId: string): Promise<BannerPurchase[]> {
  const { data, error } = await supabase
    .from("banner_purchases")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    console.warn("[sponsoredBanners] getMyBannerPurchases error", error.message);
    return [];
  }
  return (data ?? []) as BannerPurchase[];
}

// ── Analytics ──────────────────────────────────────────────────────────

/**
 * Record an impression for a banner. Uses upsert on (banner_id, user_id, date)
 * to increment the impression count atomically.
 */
export async function recordBannerImpression(
  bannerId: string,
  userId: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  const { error } = await supabase.rpc("upsert_banner_analytics", {
    p_banner_id: bannerId,
    p_user_id: userId,
    p_date: today,
    p_impressions: 1,
    p_taps: 0,
    p_tap_holds: 0,
  });

  if (error) {
    // Fallback: upsert manually
    const { data: existing } = await supabase
      .from("banner_analytics")
      .select("id, impressions, tap_count, tap_hold_count")
      .eq("banner_id", bannerId)
      .eq("user_id", userId)
      .eq("date", today)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("banner_analytics")
        .update({
          impressions: (existing.impressions ?? 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await supabase
        .from("banner_analytics")
        .insert({
          banner_id: bannerId,
          user_id: userId,
          date: today,
          impressions: 1,
          tap_count: 0,
          tap_hold_count: 0,
        });
    }
  }
}

/**
 * Record a tap on a banner. Same upsert pattern.
 */
export async function recordBannerTap(
  bannerId: string,
  userId: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: existing } = await supabase
    .from("banner_analytics")
    .select("id, tap_count")
    .eq("banner_id", bannerId)
    .eq("user_id", userId)
    .eq("date", today)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("banner_analytics")
      .update({
        tap_count: (existing.tap_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    await supabase
      .from("banner_analytics")
      .insert({
        banner_id: bannerId,
        user_id: userId,
        date: today,
        impressions: 0,
        tap_count: 1,
        tap_hold_count: 0,
      });
  }
}

/**
 * Record a tap-and-hold on a banner.
 */
export async function recordBannerTapHold(
  bannerId: string,
  userId: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: existing } = await supabase
    .from("banner_analytics")
    .select("id, tap_hold_count")
    .eq("banner_id", bannerId)
    .eq("user_id", userId)
    .eq("date", today)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("banner_analytics")
      .update({
        tap_hold_count: (existing.tap_hold_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    await supabase
      .from("banner_analytics")
      .insert({
        banner_id: bannerId,
        user_id: userId,
        date: today,
        impressions: 0,
        tap_count: 0,
        tap_hold_count: 1,
      });
  }
}

/**
 * Get aggregated analytics for a specific banner.
 */
export async function getBannerAnalytics(bannerId: string): Promise<{
  totalImpressions: number;
  totalTaps: number;
  totalTapHolds: number;
  dailyBreakdown: Array<{ date: string; impressions: number; taps: number; tapHolds: number }>;
}> {
  const { data, error } = await supabase
    .from("banner_analytics")
    .select("*")
    .eq("banner_id", bannerId)
    .order("date", { ascending: false });

  if (error) {
    console.warn("[sponsoredBanners] getBannerAnalytics error", error.message);
    return { totalImpressions: 0, totalTaps: 0, totalTapHolds: 0, dailyBreakdown: [] };
  }

  const rows = data ?? [];
  return {
    totalImpressions: rows.reduce((sum, r) => sum + (r.impressions ?? 0), 0),
    totalTaps: rows.reduce((sum, r) => sum + (r.tap_count ?? 0), 0),
    totalTapHolds: rows.reduce((sum, r) => sum + (r.tap_hold_count ?? 0), 0),
    dailyBreakdown: rows.map((r) => ({
      date: r.date,
      impressions: r.impressions ?? 0,
      taps: r.tap_count ?? 0,
      tapHolds: r.tap_hold_count ?? 0,
    })),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Bulk-enrich banner rows with vendor stats and profiles.
 *
 * Runs exactly 2 Supabase requests regardless of banner count:
 *   1. marketplace_vendor_stats  (filtered by vendor_id IN (...))
 *   2. profiles                  (filtered by id IN (...))
 *
 * Results are converted into Maps keyed by vendor/user ID and joined
 * locally — eliminating the previous N+1 per-banner query pattern.
 * A failed stats or profile query does not prevent banners from rendering;
 * fallback values are used instead.
 */
async function enrichBanners(banners: any[]): Promise<EnrichedBanner[]> {
  // Filter out invalid rows missing id or eagoh_id
  const validBanners = banners.filter((b) => {
    if (!b || !b.id || !b.eagoh_id) {
      console.warn("[sponsoredBanners] skipping invalid banner row (missing id or eagoh_id)");
      return false;
    }
    return true;
  });

  if (validBanners.length === 0) return [];

  // Collect unique valid purchaser_id values for bulk queries
  const uniqueVendorIds = [...new Set(
    validBanners
      .map((b) => b.purchaser_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  )];

  // Run both enrichment queries concurrently
  const [statsRows, profileRows] = await Promise.all([
    // 1. Vendor stats — bulk query by purchaser_id
    uniqueVendorIds.length > 0
      ? supabase
          .from("marketplace_vendor_stats")
          .select("vendor_id, rank, sync_success_score, avg_quality_score")
          .in("vendor_id", uniqueVendorIds)
          .then(({ data, error }) => {
            if (error) console.warn("[sponsoredBanners] bulk vendor stats error (non-fatal)", error.message);
            return (data ?? []) as { vendor_id: string; rank: string; sync_success_score: number; avg_quality_score: number }[];
          })
      : Promise.resolve([] as { vendor_id: string; rank: string; sync_success_score: number; avg_quality_score: number }[]),
    // 2. Profiles — bulk query by user id
    uniqueVendorIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, username")
          .in("id", uniqueVendorIds)
          .then(({ data, error }) => {
            if (error) console.warn("[sponsoredBanners] bulk profiles error (non-fatal)", error.message);
            return (data ?? []) as { id: string; username: string | null }[];
          })
      : Promise.resolve([] as { id: string; username: string | null }[]),
  ]);

  // Build Maps for O(1) local lookup
  const statsByVendor = new Map<
    string,
    { rank: string; sync_success_score: number; avg_quality_score: number }
  >();
  for (const s of statsRows) {
    statsByVendor.set(s.vendor_id, {
      rank: s.rank,
      sync_success_score: s.sync_success_score,
      avg_quality_score: s.avg_quality_score,
    });
  }

  const usernameByVendor = new Map<string, string | null>();
  for (const p of profileRows) {
    usernameByVendor.set(p.id, p.username);
  }

  // Enrich every banner locally from the maps — no DB queries inside the loop
  return validBanners.map((b) => {
    const eagoh = b.eagoh ?? {};
    const stats = statsByVendor.get(b.purchaser_id);
    return {
      ...b,
      eagoh_name: (typeof eagoh.name === "string" ? eagoh.name : "Unnamed") || "Unnamed",
      // Phase D2: enrich from domain ?? sport (not sport alone) — legacy
      // rows with a null domain fall back to their sport.
      eagoh_domain:
        typeof eagoh.domain === "string" && eagoh.domain
          ? eagoh.domain
          : typeof eagoh.sport === "string" ? eagoh.sport : "unknown",
      eagoh_image_url: resolveBannerEagohImage({
        image_url: typeof eagoh.image_url === "string" ? eagoh.image_url : null,
        image_thumb_url: typeof eagoh.image_thumb_url === "string" ? eagoh.image_thumb_url : null,
      }),
      vendor_username: usernameByVendor.get(b.purchaser_id) ?? null,
      quality_score: stats?.avg_quality_score ?? 0,
      sync_score: stats?.sync_success_score ?? 0,
      vendor_rank: stats?.rank ?? "UNRANKED",
      listing_id: b.listing_id ?? null,
    } as EnrichedBanner;
  });
}
