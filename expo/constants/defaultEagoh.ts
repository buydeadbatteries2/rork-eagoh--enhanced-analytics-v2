/**
 * Centralized default EAGOH shell image.
 *
 * This is the encased-brain image shown for every newly registered user
 * before they forge a custom EAGOH, and for free users who cannot forge.
 *
 * Source: Rork asset "ChatGPT Image Jun 28, 2026, 07_56_00 AM"
 * hosted at the stable project assets URL below.
 */
export const DEFAULT_EAGOH_IMAGE =
  "https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/x0u51a75lkvm28afuhja2.png";

/** Display name for the default shell. */
export const DEFAULT_EAGOH_NAME = "EAGOH";

/** Neutral domain label used by the default shell for Quick Check. */
export const DEFAULT_EAGOH_DOMAIN = "general";
export const DEFAULT_EAGOH_DOMAIN_LABEL = "General Intelligence";

/**
 * Virtual fallback EAGOH used for Quick Check when the user has no forged EAGOH.
 * This is never persisted — it lives only in memory so Quick Check works
 * without requiring a Supabase EAGOH row.
 */
export const QUICK_CHECK_FALLBACK_EAGOH = {
  id: "quick-check-default",
  name: DEFAULT_EAGOH_NAME,
  domain: DEFAULT_EAGOH_DOMAIN,
  image_url: DEFAULT_EAGOH_IMAGE,
  image_thumb_url: DEFAULT_EAGOH_IMAGE,
  is_default_shell: true,
  is_virtual: true,
} as const;
