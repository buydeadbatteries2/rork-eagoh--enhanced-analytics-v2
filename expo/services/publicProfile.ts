import { supabase } from "@/lib/supabase";

/**
 * Public Profile service — fetches only public-safe profile information
 * for any user. Never exposes email, subscription tier, Neuron balances,
 * payment info, or private credentials.
 *
 * RLS policies:
 * - profiles_self_select: owner always reads own row
 * - profiles_public_profile_select: any authenticated user can read
 *   profiles where public_profile_enabled = true
 * - profiles_marketplace_select: any authenticated user can read profiles
 *   for users with active marketplace listings (legacy)
 *
 * Only PUBLIC_PROFILE_COLUMNS are selected. Self-preview bypasses the
 * public_profile_enabled check because the owner policy applies.
 */

// ── Types ──────────────────────────────────────────────────────────────

/** Typed result from getPublicProfile — distinguishes every failure mode */
export type PublicProfileLoadResult =
  | { status: "success"; profile: PublicProfileData }
  | { status: "not_found" }
  | { status: "hidden" }
  | { status: "forbidden"; message?: string }
  | { status: "error"; message: string; code?: string };

export type PublicProfileData = {
  userId: string;
  username: string | null;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  publicDisplayTitle: string | null;
  isSocialVerified: boolean;
  socialVerifiedPlatform: string | null;
  // Visibility settings
  publicProfileEnabled: boolean;
  showSocialAccounts: boolean;
  showCredentials: boolean;
  showPublicEagohs: boolean;
  showFaction: boolean;
  // Derived
  joinedAt: string | null;
};

export type PublicSocialAccount = {
  platform: string;
  handle: string | null;
  profileUrl: string | null;
  isConnected: boolean;
  isPlatformVerified: boolean;
};

export type PublicEagohSummary = {
  id: string;
  name: string;
  domain: string | null;
  imageThumbUrl: string | null;
  imageUrl: string | null;
  rank: string;
  reputationScore: number;
};

export type PublicVendorStats = {
  totalSales: number;
  totalEdgeEarned: number;
  rank: string;
  syncSuccessScore: number;
  avgQualityScore: number;
};

export type PublicListingSummary = {
  id: string;
  eagohId: string;
  eagohName: string;
  active: boolean;
  minPrice: number;
};

// ── Columns intentionally excluded (never select) ──────────────────────
//
// subscription_tier, edge_subscription, edge_purchased, admin_tier_override,
// admin_tier_expires_at, admin_tier_note, selected_labs, selected_eagohs,
// preferences, last_rollover_at, last_allocation

const PUBLIC_PROFILE_COLUMNS = [
  "id",
  "username",
  "display_name",
  "bio",
  "avatar_url",
  "banner_url",
  "public_display_title",
  "is_social_verified",
  "social_verified_platform",
  "public_profile_enabled",
  "show_social_accounts",
  "show_credentials",
  "show_public_eagohs",
  "show_faction",
  "created_at",
] as const;

// ── Queries ────────────────────────────────────────────────────────────

/**
 * Fetch a user's public profile data. Returns a typed result that
 * distinguishes every failure mode so the UI can show the right message.
 *
 * @param userId  The profile's auth.users UUID
 * @param isSelf  True when the caller IS the profile owner —
 *                self-preview always succeeds via the owner RLS policy
 *                and ignores public_profile_enabled.
 */
export async function getPublicProfile(
  userId: string,
  isSelf: boolean = false,
): Promise<PublicProfileLoadResult> {
  const { data, error } = await supabase
    .from("profiles")
    .select(PUBLIC_PROFILE_COLUMNS.join(","))
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    // Distinguish Supabase error types for accurate UI messages
    const code = (error as { code?: string }).code;
    const msg = (error as { message?: string }).message ?? String(error);
    const details = (error as { details?: string }).details;
    const hint = (error as { hint?: string }).hint;

    console.warn("[publicProfile] fetch error", {
      userId,
      isSelf,
      code,
      message: msg,
      details,
      hint,
    });

    // 42703 = undefined_column (schema mismatch — missing column in DB)
    if (code === "42703") {
      return {
        status: "error",
        message: __DEV__
          ? "Public profile database fields are missing. Run the public profile migration."
          : "Public profile could not be loaded.",
        code,
      };
    }

    // 42501 = insufficient_privilege (RLS denied)
    if (code === "42501") {
      return { status: "forbidden", message: msg };
    }

    // Generic DB / network error
    return { status: "error", message: msg, code };
  }

  // No row exists — the profiles row was never created (handle_new_user trigger
  // may not have fired, or the user deleted their account)
  if (!data) {
    return { status: "not_found" };
  }

  const p = data as unknown as Record<string, unknown>;
  const publicEnabled = (p.public_profile_enabled as boolean) !== false;

  // Self can always view their own profile, even when hidden
  if (!isSelf && !publicEnabled) {
    return { status: "hidden" };
  }

  return {
    status: "success",
    profile: {
      userId: p.id as string,
      username: (p.username as string) ?? null,
      displayName: (p.display_name as string) ?? null,
      bio: (p.bio as string) ?? null,
      avatarUrl: (p.avatar_url as string) ?? null,
      bannerUrl: (p.banner_url as string) ?? null,
      publicDisplayTitle: (p.public_display_title as string) ?? null,
      isSocialVerified: (p.is_social_verified as boolean) === true,
      socialVerifiedPlatform: (p.social_verified_platform as string) ?? null,
      publicProfileEnabled: publicEnabled,
      showSocialAccounts: (p.show_social_accounts as boolean) !== false,
      showCredentials: (p.show_credentials as boolean) !== false,
      showPublicEagohs: (p.show_public_eagohs as boolean) !== false,
      showFaction: (p.show_faction as boolean) === true,
      joinedAt: (p.created_at as string) ?? null,
    },
  };
}

/**
 * Get public social accounts for a user. Only returns accounts that are
 * connected and marked as publicly visible.
 */
export async function getPublicSocialAccounts(
  userId: string,
): Promise<PublicSocialAccount[]> {
  const { data, error } = await supabase
    .from("user_social_accounts")
    .select("platform, handle, profile_url, is_connected, is_platform_verified")
    .eq("user_id", userId)
    .eq("is_connected", true);

  if (error) {
    console.warn("[publicProfile] social fetch error", error.message);
    return [];
  }

  return ((data ?? []) as Array<{
    platform: string;
    handle: string | null;
    profile_url: string | null;
    is_connected: boolean;
    is_platform_verified: boolean;
  }>).map((row) => ({
    platform: row.platform,
    handle: row.handle,
    profileUrl: row.profile_url,
    isConnected: row.is_connected,
    isPlatformVerified: row.is_platform_verified,
  }));
}

/**
 * Get public EAGOHs for a user. Only returns EAGOHs that are explicitly
 * listed on the marketplace (active listings) — a reasonable proxy for
 * "public" EAGOHs. Also fetches reputation data for ranking.
 */
export async function getPublicEagohs(
  userId: string,
  limit: number = 10,
): Promise<PublicEagohSummary[]> {
  // Fetch user's EAGOHs
  const { data: eagohs, error } = await supabase
    .from("eagohs")
    .select("id, name, domain, image_url, image_thumb_url")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !eagohs || eagohs.length === 0) return [];

  const eagohIds = (eagohs as Array<{
    id: string;
    name: string;
    domain: string | null;
    image_url: string | null;
    image_thumb_url: string | null;
  }>).map((e) => e.id);

  // Fetch reputation for these EAGOHs
  const { data: reps } = await supabase
    .from("eagoh_reputation")
    .select("eagoh_id, reputation_score, rank")
    .in("eagoh_id", eagohIds);

  const repMap = new Map<string, { score: number; rank: string }>();
  for (const r of (reps ?? []) as Array<{
    eagoh_id: string;
    reputation_score: number;
    rank: string;
  }>) {
    repMap.set(r.eagoh_id, { score: r.reputation_score ?? 0, rank: r.rank ?? "Dormant" });
  }

  return (eagohs as Array<{
    id: string;
    name: string;
    domain: string | null;
    image_url: string | null;
    image_thumb_url: string | null;
  }>).map((e) => {
    const rep = repMap.get(e.id);
    return {
      id: e.id,
      name: e.name,
      domain: e.domain,
      imageThumbUrl: e.image_thumb_url ?? e.image_url ?? null,
      imageUrl: e.image_url ?? null,
      rank: rep?.rank ?? "Dormant",
      reputationScore: rep?.score ?? 0,
    };
  });
}

/**
 * Get a user's active Exchange (marketplace) listings.
 */
export async function getPublicListings(
  userId: string,
  limit: number = 10,
): Promise<PublicListingSummary[]> {
  const { data, error } = await supabase
    .from("marketplace_listings")
    .select("id, eagoh_id, active, price_25_per_day, price_50_per_day, price_75_per_day, price_100_per_day")
    .eq("vendor_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data || data.length === 0) return [];

  const eagohIds = [...new Set((data as Array<{ eagoh_id: string }>).map((r) => r.eagoh_id))];

  const { data: eagohData } = await supabase
    .from("eagohs")
    .select("id, name")
    .in("id", eagohIds);

  const nameMap = new Map<string, string>();
  for (const e of (eagohData ?? []) as Array<{ id: string; name: string }>) {
    nameMap.set(e.id, e.name);
  }

  return (data as Array<{
    id: string;
    eagoh_id: string;
    active: boolean;
    price_25_per_day: number;
    price_50_per_day: number;
    price_75_per_day: number;
    price_100_per_day: number;
  }>).map((row) => {
    const prices = [
      row.price_25_per_day,
      row.price_50_per_day,
      row.price_75_per_day,
      row.price_100_per_day,
    ].filter((p) => p > 0);
    const minPrice = prices.length > 0 ? Math.min(...prices) : 0;

    return {
      id: row.id,
      eagohId: row.eagoh_id,
      eagohName: nameMap.get(row.eagoh_id) ?? "Unknown",
      active: row.active,
      minPrice,
    };
  });
}
