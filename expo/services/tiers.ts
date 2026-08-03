/**
 * Shared tier types and constants.
 *
 * Extracted to break the require cycle between profile.ts and edge.ts.
 */

/** Subscription tiers available in the EAGOH platform. */
export type SubscriptionTier = "free" | "pro" | "oracle_elite" | "syndicate";

/** Admin override tier — mirrors SubscriptionTier but also allows null (no override). */
export type AdminOverrideTier = SubscriptionTier | null;

/** Monthly subscription Neuron allocations per tier. Free tier receives 25 every month. */
export const TIER_MONTHLY_ALLOCATION: Record<SubscriptionTier, number> = {
  free: 25,
  pro: 600,
  oracle_elite: 1400,
  syndicate: 3700,
};

/** Free tier specific: 25 Neurons every month. No rollover. */
export const FREE_INITIAL_ALLOCATION = 25;
export const FREE_RECURRING_ALLOCATION = 25;

/** Maximum number of user-forged EAGOHs per tier. Default shells are excluded. */
export const TIER_MAX_EAGOHS: Record<SubscriptionTier, number> = {
  free: 0,
  pro: 2,
  oracle_elite: 3,
  syndicate: 5,
};

/** Neuron efficiency multiplier per tier. */
export const TIER_MULTIPLIER: Record<SubscriptionTier, number> = {
  free: 0,
  pro: 1.0,
  oracle_elite: 1.2,
  syndicate: 1.5,
};

// ── RevenueCat identifiers ──────────────────────────────────────────────────

/**
 * Apple App Store product identifiers for each subscription tier.
 *
 * These are the actual StoreKit product IDs configured in App Store Connect
 * and referenced by RevenueCat packages:
 *   pro_subscription, oracle_elite_subscription, syndicate_subscription
 *
 * Test Store aliases (pro_sub, oracle_elite_sub, syndicate_sub, and the
 * test_-prefixed variants) are never used here — see
 * TEST_STORE_SUBSCRIPTION_ALIASES for the fallback mappings.
 */
export const SUBSCRIPTION_PRODUCT_IDS: Record<Exclude<SubscriptionTier, "free">, string> = {
  pro: "pro_subscription",
  oracle_elite: "oracle_elite_subscription",
  syndicate: "syndicate_subscription",
};

/**
 * RevenueCat package identifiers for each subscription tier.
 *
 * These are the `package.identifier` values configured in the RevenueCat
 * dashboard. Package lookup MUST use these identifiers — never entitlement IDs
 * or raw StoreKit product IDs.
 */
export const SUBSCRIPTION_PACKAGE_IDS: Record<Exclude<SubscriptionTier, "free">, string> = {
  pro: "custom_pro_sub",
  oracle_elite: "custom_oracle_elite_sub",
  syndicate: "custom_syndicate_sub",
};

/**
 * RevenueCat entitlement identifiers for each subscription tier.
 *
 * After a purchase, `customerInfo.entitlements.active` is inspected using
 * these keys to determine the active tier.
 */
export const SUBSCRIPTION_ENTITLEMENT_IDS: Record<Exclude<SubscriptionTier, "free">, string> = {
  pro: "pro_subscription",
  oracle_elite: "oracle_elite_subscription",
  syndicate: "syndicate_subscription",
};

/**
 * RevenueCat Test Store product aliases — maps Test Store product IDs to their
 * corresponding production Apple App Store product identifiers.
 *
 * Both the short Test Store IDs (pro_sub, oracle_elite_sub, syndicate_sub) and
 * the prefixed variants (test_pro_sub, test_oracle_elite_sub,
 * test_syndicate_sub) are supported. These are never used as primary
 * production IDs — only as fallbacks for Test Store environments.
 */
export const TEST_STORE_SUBSCRIPTION_ALIASES: Record<string, string> = {
  pro_sub: "pro_subscription",
  oracle_elite_sub: "oracle_elite_subscription",
  syndicate_sub: "syndicate_subscription",

  test_pro_sub: "pro_subscription",
  test_oracle_elite_sub: "oracle_elite_subscription",
  test_syndicate_sub: "syndicate_subscription",
};

/** Reverse map: tier → Test Store product ID. */
export const TIER_TO_TEST_STORE_PRODUCT_ID: Record<Exclude<SubscriptionTier, "free">, string> = {
  pro: "pro_sub",
  oracle_elite: "oracle_elite_sub",
  syndicate: "syndicate_sub",
};

// ── Tier priority / complimentary resolution ───────────────────────────────

/** Numeric priority for tier comparison. Higher = better. */
export const TIER_PRIORITY: Record<SubscriptionTier, number> = {
  free: 0,
  pro: 1,
  oracle_elite: 2,
  syndicate: 3,
};

/** Allowed complimentary tier values (null = no complimentary access). */
export type ComplimentaryTier = "pro" | "oracle_elite" | null;

/** Source of the effective tier — used for UI display and diagnostics. */
export type AccessSource = "revenuecat" | "complimentary" | "development" | "free";

/** Result from the shared effective tier resolver. */
export type EffectiveTierResult = {
  effectiveTier: SubscriptionTier;
  accessSource: AccessSource;
  complimentaryActive: boolean;
  complimentaryExpiresAt: string | null;
};

/**
 * Check whether a complimentary tier is currently active (not expired).
 *
 * A complimentary tier is active when:
 *   - complimentary_tier is 'pro' or 'oracle_elite'
 *   - complimentary_tier_expires_at is null (never expires)
 *   - OR complimentary_tier_expires_at is in the future
 */
export function isComplimentaryActive(
  complimentaryTier: ComplimentaryTier,
  expiresAt: string | null | undefined,
): boolean {
  if (complimentaryTier !== "pro" && complimentaryTier !== "oracle_elite") return false;
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() > Date.now();
}

/**
 * Shared effective subscription tier resolver.
 *
 * Combines the paid RevenueCat tier, the DB subscription_tier, the complimentary
 * tier, and the Expo Go development override into a single normalized result.
 *
 * Rules:
 * 1. In __DEV__, if a test tier override is active, use it (accessSource = 'development').
 * 2. Determine the paid tier from the RevenueCat/DB subscription_tier.
 * 3. Determine if complimentary access is active.
 * 4. Use whichever valid tier is higher (by TIER_PRIORITY).
 * 5. Never downgrade a paying user because their complimentary tier is lower.
 *
 * This function does NOT import from profile.ts to avoid circular deps.
 */
export function resolveEffectiveSubscriptionTier(params: {
  paidTier: SubscriptionTier;
  complimentaryTier: ComplimentaryTier;
  complimentaryExpiresAt: string | null | undefined;
  devTestTier?: SubscriptionTier | null;
}): EffectiveTierResult {
  const { paidTier, complimentaryTier, complimentaryExpiresAt, devTestTier } = params;

  if (devTestTier) {
    return {
      effectiveTier: devTestTier,
      accessSource: "development",
      complimentaryActive: isComplimentaryActive(complimentaryTier, complimentaryExpiresAt),
      complimentaryExpiresAt: complimentaryExpiresAt ?? null,
    };
  }

  const paid = paidTier ?? "free";
  const compActive = isComplimentaryActive(complimentaryTier, complimentaryExpiresAt);
  const compTier: SubscriptionTier | null =
    compActive && (complimentaryTier === "pro" || complimentaryTier === "oracle_elite")
      ? complimentaryTier
      : null;

  if (compTier && TIER_PRIORITY[compTier] > TIER_PRIORITY[paid]) {
    return {
      effectiveTier: compTier,
      accessSource: "complimentary",
      complimentaryActive: true,
      complimentaryExpiresAt: complimentaryExpiresAt ?? null,
    };
  }

  if (paid !== "free") {
    return {
      effectiveTier: paid,
      accessSource: "revenuecat",
      complimentaryActive: compActive,
      complimentaryExpiresAt: complimentaryExpiresAt ?? null,
    };
  }

  return {
    effectiveTier: "free",
    accessSource: "free",
    complimentaryActive: compActive,
    complimentaryExpiresAt: complimentaryExpiresAt ?? null,
  };
}

// ── Tier resolution helpers (legacy, kept for backward compat) ────────────────

/**
 * Map a RevenueCat **package identifier** (`pkg.identifier`) to a subscription tier.
 *
 * This is the primary lookup method. Package identifiers are:
 *   custom_pro_sub → pro
 *   custom_oracle_elite_sub → oracle_elite
 *   custom_syndicate_sub → syndicate
 *
 * Also handles Test Store package identifiers as a fallback by resolving the
 * alias to a production product ID first.
 */
export function subscriptionTierFromPackageId(packageId: string): SubscriptionTier | null {
  // Check production package identifiers
  for (const [tier, id] of Object.entries(SUBSCRIPTION_PACKAGE_IDS)) {
    if (id === packageId) return tier as SubscriptionTier;
  }
  // Check Test Store aliases (resolve to production product ID, then to tier)
  const aliasProductId = TEST_STORE_SUBSCRIPTION_ALIASES[packageId];
  if (aliasProductId) {
    for (const [tier, id] of Object.entries(SUBSCRIPTION_PRODUCT_IDS)) {
      if (id === aliasProductId) return tier as SubscriptionTier;
    }
  }
  return null;
}

/**
 * Map a RevenueCat **entitlement identifier** to a subscription tier.
 *
 * Entitlement identifiers are:
 *   pro_subscription → pro
 *   oracle_elite_subscription → oracle_elite
 *   syndicate_subscription → syndicate
 */
export function subscriptionTierFromEntitlementId(entitlementId: string): SubscriptionTier | null {
  for (const [tier, id] of Object.entries(SUBSCRIPTION_ENTITLEMENT_IDS)) {
    if (id === entitlementId) return tier as SubscriptionTier;
  }
  return null;
}

/**
 * Map a StoreKit **product identifier** (`pkg.product.identifier`) to a subscription tier.
 *
 * Handles both production Apple product IDs (pro_subscription,
 * oracle_elite_subscription, syndicate_subscription) and Test Store aliases
 * (pro_sub, oracle_elite_sub, syndicate_sub, test_pro_sub,
 * test_oracle_elite_sub, test_syndicate_sub). Used as a fallback when package
 * identifier lookup is not available.
 */
export function subscriptionTierFromProductId(productId: string): SubscriptionTier | null {
  // Check production Apple product IDs
  for (const [tier, id] of Object.entries(SUBSCRIPTION_PRODUCT_IDS)) {
    if (id === productId) return tier as SubscriptionTier;
  }
  // Check Test Store aliases (resolve to production product ID, then to tier)
  const aliasProductId = TEST_STORE_SUBSCRIPTION_ALIASES[productId];
  if (aliasProductId) {
    for (const [tier, id] of Object.entries(SUBSCRIPTION_PRODUCT_IDS)) {
      if (id === aliasProductId) return tier as SubscriptionTier;
    }
  }
  return null;
}

/** Display labels for each tier. */
export const TIER_LABELS: Record<SubscriptionTier, string> = {
  free: "Free",
  pro: "Pro",
  oracle_elite: "Oracle Elite",
  syndicate: "Syndicate",
};

/** Feature benefit descriptions per tier. */
export const TIER_BENEFITS: Record<Exclude<SubscriptionTier, "free">, string[]> = {
  pro: [
    "600 monthly Neurons",
    "Up to 2 EAGOHs",
    "1.0x Neuron efficiency",
    "Full Intelligence Domain access",
    "Marketplace access",
    "Faction Network access",
  ],
  oracle_elite: [
    "1,400 monthly Neurons",
    "Up to 3 EAGOHs",
    "1.2x Neuron efficiency",
    "Priority analyst processing",
    "Advanced Marketplace tools",
    "Faction Network leadership",
  ],
  syndicate: [
    "3,700 monthly Neurons",
    "Up to 5 EAGOHs",
    "1.5x Neuron efficiency",
    "Maximum analyst processing",
    "Full Marketplace suite",
    "Faction Network command",
    "Sponsored Banner discounts",
  ],
};
