import { supabase } from "@/lib/supabase";
import { spendEdge } from "@/services/edge";
import type { UserProfile } from "@/services/profile";

// ── Types ──────────────────────────────────────────────────────────────

export type BannerLocation = "home" | "marketplace";

export type SponsoredBanner = {
  id: string;
  purchaser_id: string;
  eagoh_id: string;
  location: BannerLocation;
  start_date: string;
  end_date: string;
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
};

export type BannerPurchaseInput = {
  userId: string;
  eagohId: string;
  location: BannerLocation;
  startDate: string;
  days: number;
  coloredBorder: boolean;
  hotBadge: boolean;
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
 * Purchase a sponsored banner placement. Deducts Edge from the user's wallet
 * using subscription-first logic. Inserts a `sponsored_banners` row and a
 * `banner_purchases` history row in a transaction.
 */
export async function purchaseBanner(
  input: BannerPurchaseInput,
  profile: UserProfile,
): Promise<{ ok: true; banner: SponsoredBanner; purchase: BannerPurchase }
  | { ok: false; error: string }> {
  const { userId, eagohId, location, startDate, days, coloredBorder, hotBadge } = input;

  // Validate
  if (days < 1 || days > MAX_BANNER_DAYS) {
    return { ok: false, error: `Duration must be 1-${MAX_BANNER_DAYS} days.` };
  }

  // Parse start date. Banner goes live at 6:00 AM ET on the selected date.
  // For storage: start_date is the selected date, end_date is start_date + days - 1.
  const start = new Date(startDate + "T06:00:00-05:00"); // 6 AM Eastern
  if (isNaN(start.getTime())) {
    return { ok: false, error: "Invalid start date." };
  }

  // start_date in DB is just the date part
  const startDateStr = startDate; // already YYYY-MM-DD
  const endDate = new Date(start);
  endDate.setDate(endDate.getDate() + days - 1);
  const endDateStr = endDate.toISOString().slice(0, 10);

  // Compute cost
  const edgeCost = computeBannerCost(location, days, coloredBorder, hotBadge);

  // Deduct Edge first (subscription first, purchased second)
  let updatedProfile: UserProfile;
  try {
    updatedProfile = await spendEdge(
      userId,
      profile,
      edgeCost,
      "sponsored_banner",
      `${location} banner ${days} day(s) ${startDateStr}`,
    );
  } catch (err: unknown) {
    const message = (err as Error).message ?? "Neuron deduction failed";
    if (message.toLowerCase().includes("insufficient")) {
      return { ok: false, error: `Insufficient Neurons. ${edgeCost} Neurons required.` };
    }
    return { ok: false, error: message };
  }

  // Insert banner
  const { data: banner, error: bannerErr } = await supabase
    .from("sponsored_banners")
    .insert({
      purchaser_id: userId,
      eagoh_id: eagohId,
      location,
      start_date: startDateStr,
      end_date: endDateStr,
      colored_border: coloredBorder,
      hot_badge: hotBadge,
      edge_cost: edgeCost,
      active: true,
    })
    .select()
    .single();

  if (bannerErr) {
    console.warn("[sponsoredBanners] insert banner error", bannerErr.message);
    // Edge was already deducted — this is an inconsistent state but rare.
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
      days,
      colored_border: coloredBorder,
      hot_badge: hotBadge,
      edge_cost: edgeCost,
    })
    .select()
    .single();

  if (purchaseErr) {
    console.warn("[sponsoredBanners] insert purchase error", purchaseErr.message);
    // Banner exists but purchase history is missing — non-critical.
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
      days,
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
    });
  }

  return enriched;
}
