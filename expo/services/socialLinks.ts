/**
 * Social Links service — platform configuration, URL validation, and CRUD.
 *
 * Table: public.profile_social_links
 *   - id, user_id, platform, profile_url, display_order, is_visible, created_at, updated_at
 *   - unique(user_id, platform)
 *
 * This is NOT social-share verification. A saved social link means the user
 * entered a profile URL and visitors can open it. It does not mean EAGOH
 * verified ownership of that account.
 */
import { supabase } from "@/lib/supabase";

// ── Platform Keys ──────────────────────────────────────────────────────

export type SocialLinkPlatform =
  | "x"
  | "instagram"
  | "facebook"
  | "threads"
  | "tiktok"
  | "youtube"
  | "linkedin"
  | "twitch"
  | "reddit"
  | "snapchat"
  | "pinterest"
  | "discord"
  | "website";

// ── Platform Configuration ─────────────────────────────────────────────

export type PlatformConfig = {
  key: SocialLinkPlatform;
  displayName: string;
  /** Lucide icon name key — maps to the icon rendered by SocialPlatformIcon */
  iconKey: string;
  /** Brand color for the icon badge */
  brandColor: string;
  /** Short monogram text used when no lucide icon is available */
  monogram: string;
  /** Approved domains for URL validation (lowercase, no www prefix needed — both checked) */
  approvedDomains: string[];
  /** Placeholder text for the URL input */
  placeholder: string;
  /** Whether any valid HTTPS domain is allowed (for "website") */
  allowAnyDomain: boolean;
};

export const PLATFORM_CONFIGS: Record<SocialLinkPlatform, PlatformConfig> = {
  x: {
    key: "x",
    displayName: "X",
    iconKey: "twitter",
    brandColor: "#FFFFFF",
    monogram: "X",
    approvedDomains: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
    placeholder: "https://x.com/yourhandle",
    allowAnyDomain: false,
  },
  instagram: {
    key: "instagram",
    displayName: "Instagram",
    iconKey: "instagram",
    brandColor: "#E4405F",
    monogram: "IG",
    approvedDomains: ["instagram.com", "www.instagram.com"],
    placeholder: "https://instagram.com/yourhandle",
    allowAnyDomain: false,
  },
  facebook: {
    key: "facebook",
    displayName: "Facebook",
    iconKey: "facebook",
    brandColor: "#1877F2",
    monogram: "FB",
    approvedDomains: ["facebook.com", "www.facebook.com", "fb.com", "www.fb.com"],
    placeholder: "https://facebook.com/yourprofile",
    allowAnyDomain: false,
  },
  threads: {
    key: "threads",
    displayName: "Threads",
    iconKey: "threads",
    brandColor: "#FFFFFF",
    monogram: "Th",
    approvedDomains: ["threads.net", "www.threads.net"],
    placeholder: "https://threads.net/@yourhandle",
    allowAnyDomain: false,
  },
  tiktok: {
    key: "tiktok",
    displayName: "TikTok",
    iconKey: "tiktok",
    brandColor: "#FF0050",
    monogram: "TT",
    approvedDomains: ["tiktok.com", "www.tiktok.com"],
    placeholder: "https://tiktok.com/@yourhandle",
    allowAnyDomain: false,
  },
  youtube: {
    key: "youtube",
    displayName: "YouTube",
    iconKey: "youtube",
    brandColor: "#FF0000",
    monogram: "YT",
    approvedDomains: ["youtube.com", "www.youtube.com", "youtu.be"],
    placeholder: "https://youtube.com/@yourchannel",
    allowAnyDomain: false,
  },
  linkedin: {
    key: "linkedin",
    displayName: "LinkedIn",
    iconKey: "linkedin",
    brandColor: "#0A66C2",
    monogram: "in",
    approvedDomains: ["linkedin.com", "www.linkedin.com"],
    placeholder: "https://linkedin.com/in/yourprofile",
    allowAnyDomain: false,
  },
  twitch: {
    key: "twitch",
    displayName: "Twitch",
    iconKey: "twitch",
    brandColor: "#9146FF",
    monogram: "Tw",
    approvedDomains: ["twitch.tv", "www.twitch.tv"],
    placeholder: "https://twitch.tv/yourchannel",
    allowAnyDomain: false,
  },
  reddit: {
    key: "reddit",
    displayName: "Reddit",
    iconKey: "reddit",
    brandColor: "#FF4500",
    monogram: "Re",
    approvedDomains: ["reddit.com", "www.reddit.com"],
    placeholder: "https://reddit.com/user/yourusername",
    allowAnyDomain: false,
  },
  snapchat: {
    key: "snapchat",
    displayName: "Snapchat",
    iconKey: "snapchat",
    brandColor: "#FFFC00",
    monogram: "Sn",
    approvedDomains: ["snapchat.com", "www.snapchat.com"],
    placeholder: "https://snapchat.com/add/yourusername",
    allowAnyDomain: false,
  },
  pinterest: {
    key: "pinterest",
    displayName: "Pinterest",
    iconKey: "pinterest",
    brandColor: "#E60023",
    monogram: "Pi",
    approvedDomains: ["pinterest.com", "www.pinterest.com"],
    placeholder: "https://pinterest.com/yourusername",
    allowAnyDomain: false,
  },
  discord: {
    key: "discord",
    displayName: "Discord",
    iconKey: "discord",
    brandColor: "#5865F2",
    monogram: "Dc",
    approvedDomains: ["discord.com", "www.discord.com", "discord.gg"],
    placeholder: "https://discord.com/users/yourid",
    allowAnyDomain: false,
  },
  website: {
    key: "website",
    displayName: "Personal Website",
    iconKey: "globe",
    brandColor: "#6CE6FF",
    monogram: "W",
    approvedDomains: [],
    placeholder: "https://yourwebsite.com",
    allowAnyDomain: true,
  },
};

/** Ordered list of platform keys for UI rendering */
export const PLATFORM_ORDER: SocialLinkPlatform[] = [
  "x",
  "instagram",
  "facebook",
  "threads",
  "tiktok",
  "youtube",
  "linkedin",
  "twitch",
  "reddit",
  "snapchat",
  "pinterest",
  "discord",
  "website",
];

// ── Types ──────────────────────────────────────────────────────────────

export type SocialLinkRow = {
  id: string;
  user_id: string;
  platform: SocialLinkPlatform;
  profile_url: string;
  display_order: number;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
};

// ── URL Validation ─────────────────────────────────────────────────────

export type ValidationResult = {
  ok: boolean;
  error?: string;
};

/**
 * Validate a social profile URL for a given platform.
 *
 * Requirements:
 *   - Must start with https://
 *   - Reject javascript:, data:, file: URLs
 *   - Reject malformed URLs
 *   - Reject links that don't match the selected platform's approved domains
 *   - Normalize domain casing (hostname is case-insensitive)
 *   - Preserve valid profile paths and handles
 *   - For "website" platform, any valid HTTPS domain is allowed
 */
export function validateSocialUrl(
  platform: SocialLinkPlatform,
  rawUrl: string,
): ValidationResult {
  const url = rawUrl.trim();
  if (!url) {
    return { ok: false, error: "Enter a valid social profile link." };
  }

  // Reject dangerous protocols early
  const lower = url.toLowerCase();
  if (lower.startsWith("javascript:")) {
    return { ok: false, error: "Enter a valid social profile link." };
  }
  if (lower.startsWith("data:")) {
    return { ok: false, error: "Enter a valid social profile link." };
  }
  if (lower.startsWith("file:")) {
    return { ok: false, error: "Enter a valid social profile link." };
  }

  // Must start with https://
  if (!lower.startsWith("https://")) {
    return { ok: false, error: "This link must begin with https://" };
  }

  // Parse URL to extract hostname
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Enter a valid social profile link." };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    return { ok: false, error: "Enter a valid social profile link." };
  }

  const config = PLATFORM_CONFIGS[platform];
  if (!config) {
    return { ok: false, error: "Enter a valid social profile link." };
  }

  // For "website" platform, any valid HTTPS domain is allowed
  if (config.allowAnyDomain) {
    return { ok: true };
  }

  // Check if hostname matches any approved domain for this platform
  const domainMatches = config.approvedDomains.some(
    (domain) => hostname === domain.toLowerCase(),
  );

  if (!domainMatches) {
    return {
      ok: false,
      error: `This does not appear to be a valid ${config.displayName} link.`,
    };
  }

  return { ok: true };
}

// ── CRUD ───────────────────────────────────────────────────────────────

/**
 * Get all social links for the authenticated user (including hidden ones).
 * Ordered by display_order, then platform.
 */
export async function getMySocialLinks(): Promise<SocialLinkRow[]> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) return [];

  const { data: userData } = await supabase.auth.getUser(accessToken);
  const userId = userData?.user?.id;
  if (!userId) return [];

  const { data, error } = await supabase
    .from("profile_social_links")
    .select("*")
    .eq("user_id", userId)
    .order("display_order", { ascending: true })
    .order("platform", { ascending: true });

  if (error) {
    console.warn("[socialLinks] getMySocialLinks error", error.message);
    return [];
  }
  return (data ?? []) as SocialLinkRow[];
}

/**
 * Get a user's visible social links for public display.
 * Anyone can read rows where is_visible = true (enforced by RLS).
 * Ordered by display_order, then platform.
 */
export async function getPublicSocialLinks(
  userId: string,
): Promise<SocialLinkRow[]> {
  const { data, error } = await supabase
    .from("profile_social_links")
    .select("*")
    .eq("user_id", userId)
    .eq("is_visible", true)
    .order("display_order", { ascending: true })
    .order("platform", { ascending: true });

  if (error) {
    console.warn("[socialLinks] getPublicSocialLinks error", error.message);
    return [];
  }
  return (data ?? []) as SocialLinkRow[];
}

export type SaveSocialLinkResult = {
  ok: boolean;
  error?: string;
  row?: SocialLinkRow;
};

/**
 * Save (upsert) a social link for the authenticated user.
 * Validates the URL against the platform's approved domains before saving.
 * The user_id is taken from the authenticated session, not from client input.
 */
export async function saveSocialLink(
  platform: SocialLinkPlatform,
  profileUrl: string,
): Promise<SaveSocialLinkResult> {
  const validation = validateSocialUrl(platform, profileUrl);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) {
    return { ok: false, error: "Social link could not be saved." };
  }

  const { data: userData } = await supabase.auth.getUser(accessToken);
  const userId = userData?.user?.id;
  if (!userId) {
    return { ok: false, error: "Social link could not be saved." };
  }

  const trimmedUrl = profileUrl.trim();

  // Upsert — unique(user_id, platform) handles duplicates
  const { data, error } = await supabase
    .from("profile_social_links")
    .upsert(
      {
        user_id: userId,
        platform,
        profile_url: trimmedUrl,
        is_visible: true,
      },
      { onConflict: "user_id,platform" },
    )
    .select("*")
    .single();

  if (error) {
    console.warn("[socialLinks] saveSocialLink error", error.message);
    return { ok: false, error: "Social link could not be saved." };
  }

  return { ok: true, row: data as SocialLinkRow };
}

/**
 * Delete a social link for the authenticated user.
 * RLS ensures only the owner can delete.
 */
export async function deleteSocialLink(
  linkId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("profile_social_links")
    .delete()
    .eq("id", linkId);

  if (error) {
    console.warn("[socialLinks] deleteSocialLink error", error.message);
    return { ok: false, error: "Social link could not be removed." };
  }

  return { ok: true };
}

/**
 * Toggle visibility of a social link for the authenticated user.
 * RLS ensures only the owner can update.
 */
export async function toggleSocialLinkVisibility(
  linkId: string,
  isVisible: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("profile_social_links")
    .update({ is_visible: isVisible })
    .eq("id", linkId);

  if (error) {
    console.warn("[socialLinks] toggleSocialLinkVisibility error", error.message);
    return { ok: false, error: "Social link could not be updated." };
  }

  return { ok: true };
}

// ── Query Keys ─────────────────────────────────────────────────────────

/** React Query key for the authenticated user's social links (Settings) */
export const SOCIAL_LINKS_QUERY_KEY = ["social-links"] as const;

/** React Query key for a user's public social links (public profile / modal) */
export function publicSocialLinksKey(userId: string): readonly unknown[] {
  return ["public-social-links", userId] as const;
}
