import { supabase } from "@/lib/supabase";
import { spendEdge } from "@/services/edge";
import type { UserProfile, SubscriptionTier } from "@/services/profile";

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
 * Fetch currently active banners for a location. Banners are active when
 * `active = true` AND the current date falls between start_date and end_date.
 */
export async function getActiveBanners(location: BannerLocation): Promise<EnrichedBanner[]> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: banners, error } = await supabase
    .from("sponsored_banners")
    .select(`
      *,
      eagoh: eagohs!inner (
        id, name, sport, image_url
      )
    `)
    .eq("location", location)
    .eq("active", true)
    .lte("start_date", today)
    .gte("end_date", today)
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
        id, name, sport, image_url
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
 * Purchase a sponsored banner placement with multi-date selection.
 *
 * Each date in `selectedDates` represents one promotion day starting at
 * 6:00 AM America/New_York. Dates need not be consecutive.
 *
 * Deducts Edge from the user's wallet using subscription-first logic.
 * Inserts a `sponsored_banners` row and a `banner_purchases` history row.
 *
 * The effective tier is passed through to spendEdge so that dev test tiers
 * (Expo Go) and admin overrides are respected — not just the raw DB
 * subscription_tier column.
 */
export async function purchaseBanner(
  input: BannerPurchaseInput,
  profile: UserProfile,
): Promise<{ ok: true; banner: SponsoredBanner; purchase: BannerPurchase }
  | { ok: false; error: string }> {
  const {
    userId,
    eagohId,
    location,
    selectedDates,
    listingId,
    coloredBorder,
    hotBadge,
    effectiveTier,
  } = input;

  // ── Validate selected dates ──
  if (!selectedDates || selectedDates.length === 0) {
    return { ok: false, error: "Select at least one promotion date." };
  }
  if (selectedDates.length > MAX_BANNER_DAYS) {
    return { ok: false, error: `You can select up to ${MAX_BANNER_DAYS} promotion dates.` };
  }

  // Check for duplicates
  const uniqueDates = [...new Set(selectedDates)];
  if (uniqueDates.length !== selectedDates.length) {
    return { ok: false, error: "Duplicate dates detected. Please remove duplicates." };
  }

  // Sort dates chronologically
  const sortedDates = uniqueDates.sort();
  const startDateStr = sortedDates[0];
  const endDateStr = sortedDates[sortedDates.length - 1];
  const dayCount = sortedDates.length;

  // Validate each date format (YYYY-MM-DD)
  for (const d of sortedDates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return { ok: false, error: `Invalid date format: ${d}` };
    }
    const parsed = new Date(d + "T06:00:00-05:00");
    if (isNaN(parsed.getTime())) {
      return { ok: false, error: `Invalid date: ${d}` };
    }
  }

  // ── Validate listing ownership if listingId is provided ──
  if (listingId) {
    const listingResult = await validateListingOwnership(supabase, listingId, userId);
    if (!listingResult.ok) {
      return { ok: false, error: listingResult.error };
    }
  }

  // Compute cost from date count (not a separate duration value)
  const edgeCost = computeBannerCost(location, dayCount, coloredBorder, hotBadge);

  // Deduct Edge first (subscription first, purchased second)
  // Pass effectiveTier so spendEdge uses the same normalized tier as the UI
  try {
    await spendEdge(
      userId,
      profile,
      edgeCost,
      "sponsored_banner",
      `${location} banner ${dayCount} date(s) ${sortedDates.join(",")}`,
      effectiveTier,
    );
  } catch (err: unknown) {
    const message = (err as Error).message ?? "Neuron deduction failed";
    if (message.toLowerCase().includes("insufficient")) {
      return { ok: false, error: `Insufficient Neurons. ${edgeCost} Neurons required.` };
    }
    if (message.toLowerCase().includes("upgrade")) {
      return { ok: false, error: "Upgrade to Pro or higher to promote your EAGOH with sponsored banners." };
    }
    return { ok: false, error: message };
  }

  // Insert banner with booking_dates array and listing_id
  const { data: banner, error: bannerErr } = await supabase
    .from("sponsored_banners")
    .insert({
      purchaser_id: userId,
      eagoh_id: eagohId,
      location,
      start_date: startDateStr,
      end_date: endDateStr,
      booking_dates: sortedDates,
      listing_id: listingId ?? null,
      colored_border: coloredBorder,
      hot_badge: hotBadge,
      edge_cost: edgeCost,
      active: true,
    })
    .select()
    .single();

  if (bannerErr) {
    console.warn("[sponsoredBanners] insert banner error", bannerErr.message);
    return { ok: false, error: "Failed to create banner. Neurons were deducted — contact support." };
  }

  // Insert purchase history
  const { data: purchase, error: purchaseErr } = await supabase
    .from("banner_purchases")
    .insert({
      user_id: userId,
      banner_id: banner.id,
      eagoh_id: eagohId,
      location,
      start_date: startDateStr,
      days: dayCount,
      booking_dates: sortedDates,
      listing_id: listingId ?? null,
      colored_border: coloredBorder,
      hot_badge: hotBadge,
      edge_cost: edgeCost,
    })
    .select()
    .single();

  if (purchaseErr) {
    console.warn("[sponsoredBanners] insert purchase error", purchaseErr.message);
  }

  return {
    ok: true,
    banner: banner as SponsoredBanner,
    purchase: (purchase ?? {
      id: "",
      user_id: userId,
      banner_id: banner.id,
      eagoh_id: eagohId,
      location,
      start_date: startDateStr,
      days: dayCount,
      booking_dates: sortedDates,
      listing_id: listingId ?? null,
      colored_border: coloredBorder,
      hot_badge: hotBadge,
      edge_cost: edgeCost,
      created_at: new Date().toISOString(),
    }) as BannerPurchase,
  };
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

async function enrichBanners(banners: any[]): Promise<EnrichedBanner[]> {
  const enriched: EnrichedBanner[] = [];

  for (const b of banners) {
    const eagoh = b.eagoh ?? {};
    // Get vendor stats for rank/score
    let vendorRank = "UNRANKED";
    let syncScore = 0;
    let qualityScore = 0;
    let vendorUsername: string | null = null;

    // Try vendor stats
    const { data: stats } = await supabase
      .from("marketplace_vendor_stats")
      .select("rank, sync_success_score, avg_quality_score")
      .eq("vendor_id", b.purchaser_id)
      .maybeSingle();

    if (stats) {
      vendorRank = stats.rank ?? "UNRANKED";
      syncScore = stats.sync_success_score ?? 0;
      qualityScore = stats.avg_quality_score ?? 0;
    }

    // Try username
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", b.purchaser_id)
      .maybeSingle();

    vendorUsername = profile?.username ?? null;

    enriched.push({
      ...b,
      eagoh_name: eagoh.name ?? "Unnamed",
      eagoh_domain: eagoh.sport ?? "unknown",
      eagoh_image_url: eagoh.image_url ?? null,
      vendor_username: vendorUsername,
      quality_score: qualityScore,
      sync_score: syncScore,
      vendor_rank: vendorRank,
      listing_id: b.listing_id ?? null,
    });
  }

  return enriched;
}
