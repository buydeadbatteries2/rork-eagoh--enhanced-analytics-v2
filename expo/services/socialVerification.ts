import { supabase } from "@/lib/supabase";

/**
 * Social Verification service – manages connected social media accounts
 * and user verification status for the public identity layer.
 *
 * Table: public.user_social_accounts
 *   - user_id (uuid, FK → auth.users)
 *   - platform (text — "instagram", "facebook", "x", "youtube", "tiktok", "linkedin")
 *   - handle, profile_url, is_connected, is_platform_verified, verified_checked_at
 *
 * SECURITY: The client may connect/disconnect social accounts and read
 * verification status, but it MUST NOT write `is_social_verified`,
 * `social_verified_platform`, `verified_share_count`, or badge/reward fields
 * on the `profiles` table. Those are only written by:
 *   - the secure screenshot verification Worker
 *   - the atomic verified-share reward RPC (service-role)
 *   - an approved service-role administrative process
 *
 * v1: mock/manual connect — real OAuth can be wired later.
 */

// ── Supported Platforms ────────────────────────────────────────────────

export const SOCIAL_PLATFORMS = [
  "instagram",
  "facebook",
  "x",
  "youtube",
  "tiktok",
  "linkedin",
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const PLATFORM_DISPLAY: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  youtube: "YouTube",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};

export const PLATFORM_BASE_URL: Record<SocialPlatform, string> = {
  instagram: "https://instagram.com/",
  facebook: "https://facebook.com/",
  x: "https://x.com/",
  youtube: "https://youtube.com/@",
  tiktok: "https://tiktok.com/@",
  linkedin: "https://linkedin.com/in/",
};

// ── Social Verification State (shared resolver) ───────────────────────

/**
 * Normalized social verification state derived from profile data.
 * Used by every screen that displays the verified badge so logic is consistent.
 */
export type SocialVerificationState = {
  isVerified: boolean;
  verifiedShareCount: number;
  badgeName: string | null;
  badgeLevel: string | null;
};

/**
 * Badge thresholds for social share verification progression.
 * The verified check appears at >= 1 verified share; badge levels at thresholds.
 */
export const SOCIAL_BADGE_THRESHOLDS: { name: string; threshold: number }[] = [
  { name: "Neural Scout", threshold: 5 },
  { name: "Synapse Builder", threshold: 25 },
  { name: "Cortex Architect", threshold: 100 },
  { name: "Neural Vanguard", threshold: 500 },
  { name: "Oracle Ascendant", threshold: 1000 },
];

/**
 * Compute the social badge name from a verified share count.
 * Returns null when below the first threshold (5).
 */
export function getSocialBadgeName(verifiedShareCount: number): string | null {
  for (let i = SOCIAL_BADGE_THRESHOLDS.length - 1; i >= 0; i--) {
    if (verifiedShareCount >= SOCIAL_BADGE_THRESHOLDS[i].threshold) {
      return SOCIAL_BADGE_THRESHOLDS[i].name;
    }
  }
  return null;
}

/**
 * Derive a normalized SocialVerificationState from raw profile fields.
 * A user is verified when verified_share_count >= 1 OR is_social_verified is true.
 * This is the ONE shared resolver — every screen should use this.
 */
export function getSocialVerificationState(profile: {
  verified_share_count?: number | null;
  is_social_verified?: boolean | null;
}): SocialVerificationState {
  const count = typeof profile.verified_share_count === "number"
    ? profile.verified_share_count
    : 0;
  const isVerified = count >= 1 || profile.is_social_verified === true;
  const badgeName = getSocialBadgeName(count);
  return {
    isVerified,
    verifiedShareCount: count,
    badgeName,
    badgeLevel: badgeName, // same as badgeName; kept for API compatibility
  };
}

// ── Types ──────────────────────────────────────────────────────────────

export type SocialAccountRow = {
  id: string;
  user_id: string;
  platform: SocialPlatform;
  handle: string | null;
  profile_url: string | null;
  is_connected: boolean;
  is_platform_verified: boolean;
  verified_checked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type UserVerificationStatus = {
  isVerified: boolean;
  verifiedPlatform: string | null;
  connectedAccounts: SocialAccountRow[];
};

// ── CRUD ───────────────────────────────────────────────────────────────

/** Get all social accounts for the current user. */
export async function getConnectedSocialAccounts(
  userId: string,
): Promise<SocialAccountRow[]> {
  const { data, error } = await supabase
    .from("user_social_accounts")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[socialVerification] getConnectedSocialAccounts error", error.message);
    return [];
  }
  return (data ?? []) as SocialAccountRow[];
}

/**
 * Connect a social account (v1: mock/manual — stores handle and marks connected).
 * Real OAuth verification can replace this later.
 */
export async function connectSocialAccountMock(
  userId: string,
  platform: SocialPlatform,
  handle: string,
): Promise<SocialAccountRow> {
  const profileUrl = `${PLATFORM_BASE_URL[platform]}${handle}`;
  const now = new Date().toISOString();

  const row = {
    user_id: userId,
    platform,
    handle: handle.trim() || null,
    profile_url: profileUrl,
    is_connected: true,
    is_platform_verified: false,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from("user_social_accounts")
    .upsert(row, { onConflict: "user_id,platform" })
    .select("*")
    .single();
  if (error) throw error;
  return data as SocialAccountRow;
}

/** Disconnect a social account (sets is_connected = false, clears verification). */
export async function disconnectSocialAccount(
  userId: string,
  platform: SocialPlatform,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("user_social_accounts")
    .update({
      is_connected: false,
      is_platform_verified: false,
      verified_checked_at: null,
      updated_at: now,
    })
    .eq("user_id", userId)
    .eq("platform", platform);
  if (error) throw error;

  // Recompute overall verification status after disconnecting
  await refreshSocialVerificationStatus(userId);
}

/**
 * Refresh the user's overall social verification status.
 *
 * Reads the connected social accounts and derives the verification status.
 * This function is READ-ONLY — it does NOT write `is_social_verified` or
 * `social_verified_platform` to the profiles table. Those fields are only
 * written by the secure Worker (screenshot verification) or service-role
 * processes.
 *
 * The returned status is derived from the connected accounts'
 * `is_platform_verified` flags. The authoritative profile-level verification
 * fields may lag behind this computed value until the Worker updates them.
 */
export async function refreshSocialVerificationStatus(
  userId: string,
): Promise<UserVerificationStatus> {
  const accounts = await getConnectedSocialAccounts(userId);

  const verifiedAccount = accounts.find(
    (a) => a.is_connected && a.is_platform_verified,
  );

  return {
    isVerified: !!verifiedAccount,
    verifiedPlatform: verifiedAccount?.platform ?? null,
    connectedAccounts: accounts.filter((a) => a.is_connected),
  };
}

/** Get the current user's overall verification status. */
export async function getUserVerificationStatus(
  userId: string,
): Promise<UserVerificationStatus> {
  const accounts = await getConnectedSocialAccounts(userId);
  const verifiedAccount = accounts.find(
    (a) => a.is_connected && a.is_platform_verified,
  );

  return {
    isVerified: !!verifiedAccount,
    verifiedPlatform: verifiedAccount?.platform ?? null,
    connectedAccounts: accounts.filter((a) => a.is_connected),
  };
}

/**
 * Get a public-facing verification status for a given user (used on public profiles
 * and marketplace cards). Does not require the caller to be the profile owner.
 */
export async function getPublicVerificationStatus(
  userId: string,
): Promise<{ isVerified: boolean; verifiedPlatform: string | null }> {
  const { data, error } = await supabase
    .from("profiles")
    .select("is_social_verified, social_verified_platform")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return { isVerified: false, verifiedPlatform: null };

  const profile = data as { is_social_verified: boolean | null; social_verified_platform: string | null };
  return {
    isVerified: profile.is_social_verified === true,
    verifiedPlatform: profile.social_verified_platform ?? null,
  };
}

/**
 * Bulk check verification status for multiple user IDs.
 * Returns a Map of userId → { isVerified, verifiedPlatform, verifiedShareCount }.
 * Includes verified_share_count so callers can derive badge level without N+1 queries.
 */
export async function getBulkVerificationStatus(
  userIds: string[],
): Promise<Map<string, { isVerified: boolean; verifiedPlatform: string | null; verifiedShareCount: number }>> {
  if (userIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, is_social_verified, social_verified_platform, verified_share_count")
    .in("id", userIds);
  if (error) {
    console.warn("[socialVerification] getBulkVerificationStatus error", error.message);
    return new Map();
  }
  const map = new Map<string, { isVerified: boolean; verifiedPlatform: string | null; verifiedShareCount: number }>();
  for (const row of (data ?? []) as Array<{
    id: string;
    is_social_verified: boolean | null;
    social_verified_platform: string | null;
    verified_share_count: number | null;
  }>) {
    const count = typeof row.verified_share_count === "number" ? row.verified_share_count : 0;
    map.set(row.id, {
      isVerified: count >= 1 || row.is_social_verified === true,
      verifiedPlatform: row.social_verified_platform ?? null,
      verifiedShareCount: count,
    });
  }
  return map;
}

/**
 * Get a user's profile avatar URL (public-read, no auth needed).
 */
export async function getPublicAvatarUrl(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("avatar_url")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { avatar_url: string | null }).avatar_url ?? null;
}

/**
 * Get a user's profile banner URL (public-read, no auth needed).
 */
export async function getPublicBannerUrl(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("banner_url")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { banner_url: string | null }).banner_url ?? null;
}

/**
 * Get public profile info for a given user (for public profile page).
 * Includes verified_share_count for badge level derivation.
 */
export async function getPublicProfileInfo(userId: string): Promise<{
  username: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  publicDisplayTitle: string | null;
  isSocialVerified: boolean;
  socialVerifiedPlatform: string | null;
  verifiedShareCount: number;
} | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("username, avatar_url, banner_url, public_display_title, is_social_verified, social_verified_platform, verified_share_count")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;

  const p = data as {
    username: string | null;
    avatar_url: string | null;
    banner_url: string | null;
    public_display_title: string | null;
    is_social_verified: boolean | null;
    social_verified_platform: string | null;
    verified_share_count: number | null;
  };

  const count = typeof p.verified_share_count === "number" ? p.verified_share_count : 0;
  return {
    username: p.username,
    avatarUrl: p.avatar_url,
    bannerUrl: p.banner_url,
    publicDisplayTitle: p.public_display_title,
    isSocialVerified: count >= 1 || p.is_social_verified === true,
    socialVerifiedPlatform: p.social_verified_platform ?? null,
    verifiedShareCount: count,
  };
}
