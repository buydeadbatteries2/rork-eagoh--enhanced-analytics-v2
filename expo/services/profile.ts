import { supabase } from "@/lib/supabase";
import {
  TIER_PRIORITY,
  isComplimentaryActive,
} from "@/services/tiers";

/**
 * Profile service – persists user profile data in the `profiles` Supabase table.
 *
 * SECURITY: All profile updates go through SECURITY DEFINER RPCs that
 * whitelist user-editable fields. Direct table UPDATE is revoked from
 * authenticated/anon (see supabase-complimentary-tier-migration.sql).
 *
 *   - update_own_safe_profile: username, bio, avatar, preferences, etc.
 *   - spend_own_edge: neuron deduction (server-computed balances)
 *   - grant_purchased_edge: neuron purchase credit (server-computed balances)
 *   - apply_free_tier_allocation: free-tier monthly grant (server-validated)
 *
 * Admin-only fields (complimentary_tier, subscription_tier, admin_tier_override,
 * is_admin, edge balances, verification status) are NEVER accepted by any
 * client RPC. The generic update_own_edge_balances and
 * update_own_verification_status RPCs have been removed.
 */

export type SubscriptionTier = "free" | "pro" | "oracle_elite" | "syndicate";

/** Admin override tier — mirrors SubscriptionTier but also allows null (no override). */
export type AdminTierOverride = null | "free" | "pro" | "oracle_elite" | "syndicate";

export type ProfilePreferences = {
  notifications?: boolean;
  hapticsEnabled?: boolean;
  reducedMotion?: boolean;
  [key: string]: unknown;
};

export type UserProfile = {
  id: string;
  username: string | null;
  subscription_tier: SubscriptionTier;
  admin_tier_override: AdminTierOverride;
  admin_tier_expires_at: string | null;
  admin_tier_note: string | null;
  is_admin: boolean;
  edge_subscription: number;
  edge_purchased: number;
  selected_labs: string[];
  selected_eagohs: string[];
  preferences: ProfilePreferences;
  avatar_url: string | null;
  banner_url: string | null;
  public_display_title: string | null;
  is_social_verified: boolean;
  social_verified_platform: string | null;
  last_rollover_at: string | null;
  last_allocation: number;
  complimentary_tier: "pro" | "oracle_elite" | null;
  complimentary_tier_expires_at: string | null;
  complimentary_tier_granted_at: string | null;
  complimentary_tier_note: string | null;
  created_at?: string;
  updated_at?: string;
};

/**
 * User-editable profile fields. These are the ONLY fields the client can
 * modify, and they go through the update_own_safe_profile SECURITY DEFINER RPC.
 * Admin, complimentary, subscription_tier, edge balance, and verification
 * fields are excluded — they are managed by dedicated RPCs or backend only.
 */
export type ProfileUpdate = {
  username?: string | null;
  display_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  banner_url?: string | null;
  public_display_title?: string | null;
  selected_labs?: string[];
  selected_eagohs?: string[];
  preferences?: ProfilePreferences;
  public_profile_enabled?: boolean;
  show_social_accounts?: boolean;
  show_credentials?: boolean;
  show_public_eagohs?: boolean;
  show_faction?: boolean;
};

/**
 * Partial profile returned by the update_own_safe_profile RPC.
 * Contains only safe, owner-facing fields — never internal/admin/balance columns.
 * Callers merge this with the existing cached profile.
 */
export type SafeProfileUpdateResult = {
  username: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  public_display_title: string | null;
  selected_labs: string[];
  selected_eagohs: string[];
  preferences: ProfilePreferences;
  public_profile_enabled: boolean;
  show_social_accounts: boolean;
  show_credentials: boolean;
  show_public_eagohs: boolean;
  show_faction: boolean;
  updated_at: string;
};

const DEFAULT_PROFILE = (id: string, username?: string | null): UserProfile => ({
  id,
  username: username ?? null,
  subscription_tier: "free",
  admin_tier_override: null,
  admin_tier_expires_at: null,
  admin_tier_note: null,
  is_admin: false,
  edge_subscription: 0,
  edge_purchased: 0,
  selected_labs: [],
  selected_eagohs: [],
  preferences: {},
  avatar_url: null,
  banner_url: null,
  public_display_title: null,
  is_social_verified: false,
  social_verified_platform: null,
  last_rollover_at: null,
  last_allocation: 0,
  complimentary_tier: null,
  complimentary_tier_expires_at: null,
  complimentary_tier_granted_at: null,
  complimentary_tier_note: null,
});

export async function fetchProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return (data as UserProfile | null) ?? null;
}

export async function ensureProfile(userId: string, username?: string | null): Promise<UserProfile> {
  const existing = await fetchProfile(userId);
  if (existing) return existing;

  // New free-tier user: grant the initial 25 subscription Neurons.
  const { FREE_INITIAL_ALLOCATION } = await import("@/services/edge");
  const base = { ...DEFAULT_PROFILE(userId, username), edge_subscription: FREE_INITIAL_ALLOCATION };
  const { data, error } = await supabase.from("profiles").insert(base).select("*").single();
  if (error) throw error;

  const newProfile = data as UserProfile;

  // Log the initial allocation transaction.
  try {
    const { supabase: sb } = await import("@/lib/supabase");
    await sb.from("edge_transactions").insert({
      user_id: userId,
      kind: "addition",
      reason: "subscription_allocation",
      amount: FREE_INITIAL_ALLOCATION,
      bucket: "subscription",
      from_subscription: 0,
      from_purchased: 0,
      balance_subscription_after: FREE_INITIAL_ALLOCATION,
      balance_purchased_after: 0,
      note: `Free tier initial allocation (${FREE_INITIAL_ALLOCATION} Neurons)`,
    });
  } catch {
    // Non-critical — the allocation log is best-effort.
  }

  // Provision the default dormant EAGOH shell in the background.
  // Failure here should not block profile creation.
  try {
    const { createDefaultEagohShell } = await import("@/services/eagohs");
    const { DEFAULT_EAGOH_IMAGE } = await import("@/constants/defaultEagoh");
    void createDefaultEagohShell(userId, DEFAULT_EAGOH_IMAGE);
  } catch {
    // Best-effort; the app will try again on next profile fetch if needed.
  }

  return newProfile;
}

/**
 * Update user-editable profile fields via the update_own_safe_profile RPC.
 * Only whitelisted fields are accepted; admin/complimentary/edge/subscription
 * fields are rejected by the RPC. Returns only safe fields — callers merge
 * this with the existing cached profile.
 */
export async function updateProfile(userId: string, patch: ProfileUpdate): Promise<SafeProfileUpdateResult> {
  const { data, error } = await supabase.rpc("update_own_safe_profile", {
    p_user_id: userId,
    p_updates: patch,
  });
  if (error) throw error;
  const result = data as { ok: boolean; profile?: SafeProfileUpdateResult; error?: string };
  if (!result.ok || !result.profile) {
    throw new Error(result.error ?? "Profile update failed");
  }
  return result.profile;
}

/**
 * @deprecated subscription_tier is NEVER set by the client. Tier changes go
 * through the backend /subscription/sync endpoint which verifies RevenueCat
 * entitlements. This function throws to prevent accidental client-side writes.
 */
export async function setSubscriptionTier(_userId: string, _tier: SubscriptionTier): Promise<never> {
  throw new Error(
    "subscription_tier can only be set by the backend /subscription/sync endpoint. " +
    "The client must never write subscription_tier directly.",
  );
}

export async function setSelectedLabs(userId: string, labs: string[]): Promise<SafeProfileUpdateResult> {
  return updateProfile(userId, { selected_labs: labs });
}

export async function setSelectedEagohs(userId: string, eagohs: string[]): Promise<SafeProfileUpdateResult> {
  return updateProfile(userId, { selected_eagohs: eagohs });
}

export async function setPreferences(userId: string, preferences: ProfilePreferences): Promise<SafeProfileUpdateResult> {
  return updateProfile(userId, { preferences });
}

// ── Admin Tier Override ────────────────────────────────────────────────────

/**
 * Compute the user's effective subscription tier, respecting:
 *   1. Active admin tier override (legacy system)
 *   2. Active complimentary tier (admin-controlled, managed in Supabase Dashboard)
 *   3. The paid subscription_tier from RevenueCat/backend sync
 *
 * The result is the highest-priority valid tier. Never downgrades a paying
 * user because their complimentary tier is lower.
 *
 * Tier priority: free=0, pro=1, oracle_elite=2, syndicate=3
 *
 * Falls back to "free" when the profile is null/undefined.
 */
export function getEffectiveSubscriptionTier(
  profile: Pick<
    UserProfile,
    "subscription_tier" | "admin_tier_override" | "admin_tier_expires_at" |
    "complimentary_tier" | "complimentary_tier_expires_at"
  > | null | undefined,
): SubscriptionTier {
  if (!profile) return "free";

  // Start with the paid subscription tier
  const paidTier: SubscriptionTier = profile.subscription_tier ?? "free";

  // Check admin override (legacy system)
  const override = profile.admin_tier_override;
  let adminTier: SubscriptionTier = paidTier;
  if (override) {
    const adminExpires = profile.admin_tier_expires_at;
    let adminActive = true;
    if (adminExpires) {
      const now = new Date();
      const expiry = new Date(adminExpires);
      if (expiry <= now) adminActive = false;
    }
    if (adminActive && (TIER_PRIORITY[override as SubscriptionTier] ?? 0) > TIER_PRIORITY[adminTier]) {
      adminTier = override as SubscriptionTier;
    }
  }

  // Check complimentary tier
  const compTier = profile.complimentary_tier;
  let compResolvedTier: SubscriptionTier = adminTier; // start from admin-adjusted paid tier
  if (compTier && (compTier === "pro" || compTier === "oracle_elite")) {
    const compActive = isComplimentaryActive(compTier, profile.complimentary_tier_expires_at);
    if (compActive && TIER_PRIORITY[compTier] > TIER_PRIORITY[compResolvedTier]) {
      compResolvedTier = compTier;
    }
  }

  return compResolvedTier;
}

/** Returns true when the profile has an active admin tier override or complimentary tier. */
export function hasActiveAdminOverride(
  profile: Pick<
    UserProfile,
    "subscription_tier" | "admin_tier_override" | "admin_tier_expires_at" |
    "complimentary_tier" | "complimentary_tier_expires_at"
  > | null | undefined,
): boolean {
  if (!profile) return false;
  return getEffectiveSubscriptionTier(profile) !== (profile.subscription_tier ?? "free");
}
