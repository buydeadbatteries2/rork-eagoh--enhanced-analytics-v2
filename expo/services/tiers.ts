/**
 * Shared tier types and constants.
 *
 * Extracted to break the require cycle between profile.ts and edge.ts.
 */

/** Subscription tiers available in the EAGOH platform. */
export type SubscriptionTier = "free" | "pro" | "oracle_elite" | "syndicate";

/** Admin override tier — mirrors SubscriptionTier but also allows null (no override). */
export type AdminOverrideTier = SubscriptionTier | null;

/** Unified access model: every paid tier maps to "pro"; free stays "free". */
export type UnifiedAccessTier = "free" | "pro";

/**
 * Whether a resolved tier has paid Pro access.
 *
 * EAGOH is transitioning to a single Pro feature model. Legacy Oracle Elite
 * and Syndicate identifiers remain temporarily supported, so their
 * subscribers keep full Pro access while those tiers are phased out.
 */
export function hasProAccess(tier: SubscriptionTier): boolean {
  return tier !== "free";
}

/**
 * Map any legacy tier to the unified access model.
 *
 * `free` → "free"; every paid legacy tier (pro, oracle_elite, syndicate) → "pro".
 */
export function getUnifiedAccessTier(tier: SubscriptionTier): UnifiedAccessTier {
  return tier === "free" ? "free" : "pro";
}

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

/**
 * Neuron efficiency multiplier per tier.
 *
 * EAGOH is transitioning to a single Pro feature model. Legacy Oracle Elite
 * and Syndicate identifiers remain temporarily supported so existing
 * subscribers keep resolving correctly, but all paid tiers now share the
 * same 1.0x Neuron economy.
 */
export const TIER_MULTIPLIER: Record<SubscriptionTier, number> = {
  free: 0,
  pro: 1.0,
  oracle_elite: 1.0,
  syndicate: 1.0,
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

// ── Tier resolution helpers ─────────────────────────────────────────────────

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
    "1.0x Neuron efficiency",
    "Priority analyst processing",
    "Advanced Marketplace tools",
    "Faction Network leadership",
  ],
  syndicate: [
    "3,700 monthly Neurons",
    "Up to 5 EAGOHs",
    "1.0x Neuron efficiency",
    "Maximum analyst processing",
    "Full Marketplace suite",
    "Faction Network command",
    "Sponsored Banner discounts",
  ],
};
