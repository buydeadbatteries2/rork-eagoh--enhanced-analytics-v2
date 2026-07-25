/**
 * RevenueCat service — lazy Purchases configuration and helpers.
 *
 * No Purchases.configure() runs at module import — RevenueCatProvider calls
 * configureRevenueCat() in a useEffect guarded by runtime detection.
 * This avoids crashing Expo Go (which lacks native StoreKit).
 *
 * Key selection rules:
 *  - iOS native builds (not Expo Go) → EXPO_PUBLIC_REVENUECAT_IOS_API_KEY
 *  - Android native builds (not Expo Go) → EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY
 *  - Test store only when EXPO_PUBLIC_REVENUECAT_USE_TEST_STORE === "true"
 *  - Expo Go, Rork preview, or Web → skip configuration (graceful preview mode)
 */

import { Platform } from "react-native";
import Constants from "expo-constants";
import Purchases, {
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesPackage,
} from "react-native-purchases";
import type { SubscriptionTier } from "@/services/tiers";
import {
  subscriptionTierFromPackageId,
  subscriptionTierFromEntitlementId,
  subscriptionTierFromProductId,
} from "@/services/tiers";

// ── Runtime detection ───────────────────────────────────────────────────────

/** The overarching runtime category for RevenueCat behaviour. */
export type RevenueCatRuntimeMode =
  | "ios-store"
  | "android-store"
  | "test-store"
  | "expo-go-disabled"
  | "web-disabled"
  | "unconfigured";

export type RevenueCatKeyMode = "ios" | "android" | "test-store" | "unavailable";

/** True when running inside Expo Go (or Rork's Expo Go-based preview). */
export function isExpoGoRuntime(): boolean {
  try {
    // executionEnvironment is "storeClient" inside Expo Go
    const env = (Constants as { executionEnvironment?: string }).executionEnvironment;
    return env === "storeClient";
  } catch {
    return false;
  }
}

/** True when running on a native build that has the App Store / Play Store environment. */
export function isNativeStoreRuntime(): boolean {
  if (Platform.OS === "web") return false;
  return !isExpoGoRuntime();
}

/** True when the RevenueCat Test Store is explicitly enabled via env flag. */
export function isRevenueCatTestStoreEnabled(): boolean {
  return process.env.EXPO_PUBLIC_REVENUECAT_USE_TEST_STORE === "true";
}

// ── Configuration state (set by configureRevenueCat) ────────────────────────

let _apiKey = "";
let _keyMode: RevenueCatKeyMode = "unavailable";
let _runtimeMode: RevenueCatRuntimeMode = "unconfigured";
let _configured = false;
let _configurationError: string | null = null;

/** Pick the correct RevenueCat API key and runtime mode based on the current environment. */
function resolveRevenueCatConfig(): {
  apiKey: string;
  keyMode: RevenueCatKeyMode;
  runtimeMode: RevenueCatRuntimeMode;
} {
  // Web — never use native RevenueCat
  if (Platform.OS === "web") {
    if (isRevenueCatTestStoreEnabled()) {
      const testKey = process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY ?? "";
      if (testKey) {
        if (__DEV__) console.log("[RevenueCat] key mode: test-store (web, test store enabled)");
        return { apiKey: testKey, keyMode: "test-store", runtimeMode: "test-store" };
      }
    }
    if (__DEV__) console.log("[RevenueCat] web — RevenueCat disabled");
    return { apiKey: "", keyMode: "unavailable", runtimeMode: "web-disabled" };
  }

  const expoGo = isExpoGoRuntime();

  // Test Store explicitly enabled — allowed in any environment including Expo Go
  if (isRevenueCatTestStoreEnabled()) {
    const testKey = process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY ?? "";
    if (testKey) {
      if (__DEV__) {
        console.log("[RevenueCat] key mode: test-store (env flag)");
      }
      return { apiKey: testKey, keyMode: "test-store", runtimeMode: "test-store" };
    }
    if (__DEV__) {
      console.warn("[RevenueCat] Test Store flag set but no test API key — disabled");
    }
    return { apiKey: "", keyMode: "unavailable", runtimeMode: "unconfigured" };
  }

  // Expo Go / Rork preview — cannot use native StoreKit
  if (expoGo) {
    if (__DEV__) {
      console.warn("[RevenueCat] Expo Go detected — native purchases unavailable, preview mode only");
    }
    return { apiKey: "", keyMode: "unavailable", runtimeMode: "expo-go-disabled" };
  }

  // iOS native build (custom dev build or TestFlight)
  if (Platform.OS === "ios") {
    const iosKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? "";
    if (iosKey) {
      if (__DEV__) console.log("[RevenueCat] key mode: ios (native build)");
      return { apiKey: iosKey, keyMode: "ios", runtimeMode: "ios-store" };
    }
    if (__DEV__) console.warn("[RevenueCat] iOS native build but no iOS API key — unconfigured");
    return { apiKey: "", keyMode: "unavailable", runtimeMode: "unconfigured" };
  }

  // Android native build
  if (Platform.OS === "android") {
    const androidKey = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ?? "";
    if (androidKey) {
      if (__DEV__) console.log("[RevenueCat] key mode: android (native build)");
      return { apiKey: androidKey, keyMode: "android", runtimeMode: "android-store" };
    }
    if (__DEV__) console.warn("[RevenueCat] Android native build but no Android API key — unconfigured");
    return { apiKey: "", keyMode: "unavailable", runtimeMode: "unconfigured" };
  }

  // Unknown platform
  if (__DEV__) console.warn("[RevenueCat] Unknown platform — RevenueCat disabled");
  return { apiKey: "", keyMode: "unavailable", runtimeMode: "unconfigured" };
}

/**
 * Configure the RevenueCat Purchases SDK.
 *
 * MUST be called once, lazily (e.g. from a useEffect), NOT at module import time.
 * Returns the resolved runtime mode and configuration status.
 */
export function configureRevenueCat(): {
  runtimeMode: RevenueCatRuntimeMode;
  keyMode: RevenueCatKeyMode;
  configured: boolean;
  error: string | null;
} {
  // Only configure once
  if (_configured || _configurationError) {
    return {
      runtimeMode: _runtimeMode,
      keyMode: _keyMode,
      configured: _configured,
      error: _configurationError,
    };
  }

  const config = resolveRevenueCatConfig();
  _runtimeMode = config.runtimeMode;
  _keyMode = config.keyMode;
  _apiKey = config.apiKey;

  if (!config.apiKey) {
    _configured = false;
    if (__DEV__) {
      console.log("[RevenueCat] Not configured — runtime mode:", config.runtimeMode);
    }
    return { runtimeMode: config.runtimeMode, keyMode: config.keyMode, configured: false, error: null };
  }

  try {
    Purchases.configure({ apiKey: config.apiKey });
    _configured = true;
    if (__DEV__) {
      console.log("[RevenueCat] Purchases.configure() succeeded — key mode:", config.keyMode, "| runtime:", config.runtimeMode);
    }
    return { runtimeMode: config.runtimeMode, keyMode: config.keyMode, configured: true, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    _configured = false;
    _configurationError = msg;
    // Use console.warn for expected unsupported-runtime conditions
    if (config.runtimeMode === "expo-go-disabled" || config.runtimeMode === "web-disabled") {
      console.warn("[RevenueCat] Configuration skipped — unsupported runtime:", config.runtimeMode);
    } else {
      console.warn("[RevenueCat] Configuration failed:", msg);
    }
    return { runtimeMode: config.runtimeMode, keyMode: config.keyMode, configured: false, error: msg };
  }
}

/** Whether RevenueCat has been configured with a valid API key. */
export function isRevenueCatConfigured(): boolean {
  return _configured;
}

/** The active key mode for diagnostics. */
export function getRevenueCatKeyMode(): RevenueCatKeyMode {
  return _keyMode;
}

/** The resolved runtime mode for diagnostics. */
export function getRevenueCatRuntimeMode(): RevenueCatRuntimeMode {
  return _runtimeMode;
}

/** The configuration error message, if any. */
export function getRevenueCatConfigError(): string | null {
  return _configurationError;
}

// ── Tier derivation from CustomerInfo ──────────────────────────────────────

/**
 * Derive the paid subscription tier from RevenueCat CustomerInfo.
 *
 * Checks entitlements first (the authoritative source), then falls back to
 * active subscription product IDs. Priority: syndicate → oracle_elite → pro → free.
 *
 * Entitlement IDs:
 *   pro_subscription → pro
 *   oracle_elite_subscription → oracle_elite
 *   syndicate_subscription → syndicate
 */
export function getRevenueCatSubscriptionTier(
  customerInfo: CustomerInfo | null,
): SubscriptionTier {
  if (!customerInfo) return "free";

  // ── 1. Check entitlements (authoritative) ──────────────────────────────
  const activeEntitlements = customerInfo.entitlements?.active;
  if (activeEntitlements) {
    const entResolved = new Set<SubscriptionTier>();
    for (const entId of Object.keys(activeEntitlements)) {
      const tier = subscriptionTierFromEntitlementId(entId);
      if (tier && tier !== "free") entResolved.add(tier);
    }
    if (entResolved.has("syndicate")) return "syndicate";
    if (entResolved.has("oracle_elite")) return "oracle_elite";
    if (entResolved.has("pro")) return "pro";
  }

  // ── 2. Fall back to active subscription product IDs ────────────────────
  const activeSubs = customerInfo.activeSubscriptions;
  if (!activeSubs || activeSubs.length === 0) return "free";

  const resolved = new Set<SubscriptionTier>();
  for (const subId of activeSubs) {
    const tier = subscriptionTierFromProductId(subId);
    if (tier && tier !== "free") resolved.add(tier);
  }

  // Priority order — highest tier wins
  if (resolved.has("syndicate")) return "syndicate";
  if (resolved.has("oracle_elite")) return "oracle_elite";
  if (resolved.has("pro")) return "pro";

  return "free";
}

// ── Package / product mapping ───────────────────────────────────────────────

/** Re-export the tier-from-package-id helper for convenience. */
export { subscriptionTierFromPackageId } from "@/services/tiers";

/** Check if a product identifier is a known subscription product. */
export function isSubscriptionProduct(productId: string): boolean {
  return subscriptionTierFromProductId(productId) !== null;
}

/**
 * Search ALL available offerings for subscription packages.
 *
 * Uses `pkg.identifier` (the RevenueCat package identifier) as the primary
 * lookup key, matching against SUBSCRIPTION_PACKAGE_IDS:
 *   custom_pro_sub → pro
 *   custom_oracle_elite_sub → oracle_elite
 *   custom_syndicate_sub → syndicate
 *
 * Falls back to `pkg.product.identifier` (the StoreKit product ID) for
 * environments where the package identifier is not set.
 *
 * Deduplicates by package identifier.
 */
export function getSubscriptionPackagesFromAllOfferings(
  currentOffering: PurchasesOffering | null,
  allOfferings: PurchasesOffering[],
): PurchasesPackage[] {
  const seen = new Set<string>();
  const result: PurchasesPackage[] = [];

  const offerings: PurchasesOffering[] = [];
  if (currentOffering) offerings.push(currentOffering);
  for (const off of allOfferings) {
    if (off !== currentOffering) offerings.push(off);
  }

  for (const offering of offerings) {
    for (const pkg of offering.availablePackages) {
      // Primary: match by package identifier (custom_pro_sub, etc.)
      let tier = subscriptionTierFromPackageId(pkg.identifier);
      // Fallback: match by StoreKit product identifier
      if (!tier) {
        tier = subscriptionTierFromProductId(pkg.product.identifier);
      }
      if (tier !== null && !seen.has(pkg.identifier)) {
        seen.add(pkg.identifier);
        result.push(pkg);
        console.log(
          `[RevenueCat] Subscription pack found: packageId=${pkg.identifier} productId=${pkg.product.identifier} tier=${tier} price=${pkg.product.priceString ?? `$${pkg.product.price}`}`,
        );
      }
    }
  }

  console.log(`[RevenueCat] Total subscription packs across all offerings: ${result.length}`);

  return result;
}

/** Check if a product identifier is a known consumable Neuron product. */
export function isNeuronProduct(productId: string): boolean {
  return productId in NEURON_PRODUCT_AMOUNTS;
}

/**
 * Map of known Neuron product identifiers to their Neuron amounts.
 * Used both for filtering and for determining the credit amount after purchase.
 */
export const NEURON_PRODUCT_AMOUNTS: Record<string, number> = {
  store_edge_250: 250,
  store_edge_750: 750,
  store_edge_2000: 2000,
  store_edge_6000: 6000,
  store_edge_15000: 15000,
};

// ── Async helpers ──────────────────────────────────────────────────────────

/** Fetch the current offerings from RevenueCat. Returns null if not configured. */
export async function getOfferings(): Promise<{
  offering: PurchasesOffering | null;
  allOfferings: PurchasesOffering[];
}> {
  if (!_configured) return { offering: null, allOfferings: [] };

  const offerings = await Purchases.getOfferings();

  const current = offerings.current;
  const all: PurchasesOffering[] = [];

  if (offerings.all) {
    for (const [id, off] of Object.entries(offerings.all)) {
      if (off) {
        all.push(off);
        console.log(`[RevenueCat] Offering "${id}": ${off.identifier} (${off.availablePackages.length} packages)`);
      }
    }
  }

  // Prefer current; fall back to "default"
  let offering: PurchasesOffering | null = current ?? null;
  if (!offering && offerings.all?.["default"]) {
    offering = offerings.all["default"];
    console.log("[RevenueCat] No current offering — falling back to 'default'");
  }

  if (offering) {
    console.log(`[RevenueCat] Current offering: "${offering.identifier}" (${offering.availablePackages.length} packages)`);
    for (const pkg of offering.availablePackages) {
      console.log(
        `[RevenueCat] Package: ${pkg.identifier} productId=${pkg.product.identifier} price=${pkg.product.priceString ?? `$${pkg.product.price}`} period=${pkg.product.subscriptionPeriod ?? "n/a"}`,
      );
    }
  } else {
    console.warn("[RevenueCat] No offerings available");
  }

  return { offering, allOfferings: all };
}

/**
 * Search ALL available offerings for Neuron (consumable) packages.
 *
 * Uses NEURON_PRODUCT_AMOUNTS to identify matching products by their
 * `product.identifier` (NOT `package.identifier`), which is the App Store
 * product ID. Deduplicates by product identifier.
 *
 * This is the single source of truth for the Neuron Store — even if the
 * current offering only contains subscriptions, this function finds Neuron
 * packs in any offering.
 */
export function getNeuronPackagesFromAllOfferings(
  currentOffering: PurchasesOffering | null,
  allOfferings: PurchasesOffering[],
): PurchasesPackage[] {
  const seen = new Set<string>();
  const result: PurchasesPackage[] = [];

  // Collect all unique offerings (current first, then rest)
  const offerings: PurchasesOffering[] = [];
  if (currentOffering) offerings.push(currentOffering);
  for (const off of allOfferings) {
    if (off !== currentOffering) offerings.push(off);
  }

  for (const offering of offerings) {
    for (const pkg of offering.availablePackages) {
      const pid = pkg.product.identifier;
      if (NEURON_PRODUCT_AMOUNTS[pid] !== undefined && !seen.has(pid)) {
        seen.add(pid);
        result.push(pkg);
        if (__DEV__) {
          console.log(`[RevenueCat] Neuron pack found: ${pkg.identifier} → product: ${pid} (${NEURON_PRODUCT_AMOUNTS[pid]} Neurons) ${pkg.product.priceString ?? `$${pkg.product.price}`}`);
        }
      }
    }
  }

  if (__DEV__) {
    console.log(`[RevenueCat] Total Neuron packs across all offerings: ${result.length}`);
  }

  return result;
}

/** Purchase a package. Returns the transaction result including transactionIdentifier for idempotency. */
export async function purchasePackage(
  pkg: PurchasesPackage,
): Promise<{
  customerInfo: CustomerInfo;
  transactionIdentifier: string;
  productIdentifier: string;
}> {
  const result = await Purchases.purchasePackage(pkg);
  return {
    customerInfo: result.customerInfo,
    transactionIdentifier: result.transaction.transactionIdentifier,
    productIdentifier: result.productIdentifier,
  };
}

/** Restore previous purchases. Returns the latest CustomerInfo. */
export async function restorePurchases(): Promise<CustomerInfo> {
  return Purchases.restorePurchases();
}

/** Fetch the latest customer info (entitlements, active subscriptions, etc.). */
export async function getCustomerInfo(): Promise<CustomerInfo> {
  return Purchases.getCustomerInfo();
}

/** Log the current user into RevenueCat for cross-device purchase sync. */
export async function logInRevenueCat(userId: string): Promise<CustomerInfo> {
  if (!_configured) {
    if (__DEV__) {
      console.log("[RevenueCat] logIn skipped — RC not configured");
    }
    return Purchases.getCustomerInfo();
  }
  if (__DEV__) {
    console.log("[RevenueCat] logIn:", userId);
  }
  const { customerInfo } = await Purchases.logIn(userId);
  return customerInfo;
}

/** Log out the current RevenueCat user. */
export async function logOutRevenueCat(): Promise<CustomerInfo> {
  if (!_configured) {
    return Purchases.getCustomerInfo();
  }
  if (__DEV__) {
    console.log("[RevenueCat] logOut");
  }
  const customerInfo = await Purchases.logOut();
  return customerInfo;
}

/**
 * Register a listener for customer info updates.
 * Returns a handle so callers can clean up via Purchases.removeCustomerInfoUpdateListener.
 */
export function addCustomerInfoListener(
  callback: (customerInfo: CustomerInfo) => void,
): { remove: () => void } {
  Purchases.addCustomerInfoUpdateListener(callback);
  return {
    remove: () => {
      Purchases.removeCustomerInfoUpdateListener(callback);
    },
  };
}
