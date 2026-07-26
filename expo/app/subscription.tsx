/**
 * Subscription / Paywall screen.
 *
 * Displays live RevenueCat subscription packages for Pro, Oracle Elite, and
 * Syndicate tiers. Each card shows tier name, localized App Store price,
 * billing period, monthly Neuron allocation, EAGOH limit, feature benefits
 * and a Subscribe button.
 *
 * States: Loading, Loaded, Configuration Error, No matching products,
 * Purchase in progress, Purchase cancelled, Purchase successful.
 * Includes Retry and Restore Purchases buttons.
 */

import { palette } from "@/constants/colors";
import { useHaptics } from "@/hooks/useHaptics";
import { useAuth } from "@/providers/AuthProvider";
import { useProfile } from "@/providers/ProfileProvider";
import { useRevenueCat } from "@/providers/RevenueCatProvider";
import {
  TIER_LABELS,
  TIER_MONTHLY_ALLOCATION,
  TIER_MAX_EAGOHS,
  TIER_BENEFITS,
  SUBSCRIPTION_ENTITLEMENT_IDS,
  subscriptionTierFromPackageId,
  type SubscriptionTier,
} from "@/services/tiers";
import { getOfferings as getRcOfferings } from "@/services/revenuecat";

import { LinearGradient } from "expo-linear-gradient";
import { useSafeBack } from "@/hooks/useSafeBack";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ArrowLeft,
  BadgeCheck,
  BrainCircuit,
  Coins,
  Crown,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  Zap,
} from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import type { PurchasesPackage } from "react-native-purchases";

// ── Tier-specific accent colours ───────────────────────────────────────────

const TIER_ACCENTS: Record<Exclude<SubscriptionTier, "free">, { accent: string; soft: string; border: string; glow: string; gradient: readonly [string, string, string] }> = {
  pro: {
    accent: palette.cyan,
    soft: "rgba(54,245,255,0.10)",
    border: "rgba(54,245,255,0.30)",
    glow: "rgba(54,245,255,0.14)",
    gradient: ["rgba(54,245,255,0.14)", "rgba(10,18,30,0.80)", "rgba(3,6,11,0.96)"] as const,
  },
  oracle_elite: {
    accent: palette.gold,
    soft: "rgba(255,184,77,0.10)",
    border: "rgba(255,184,77,0.35)",
    glow: "rgba(255,184,77,0.16)",
    gradient: ["rgba(255,184,77,0.14)", "rgba(10,18,30,0.80)", "rgba(3,6,11,0.96)"] as const,
  },
  syndicate: {
    accent: palette.violet,
    soft: "rgba(138,92,255,0.10)",
    border: "rgba(138,92,255,0.35)",
    glow: "rgba(138,92,255,0.16)",
    gradient: ["rgba(138,92,255,0.14)", "rgba(10,18,30,0.80)", "rgba(3,6,11,0.96)"] as const,
  },
};

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.void },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
    backgroundColor: palette.obsidian,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.panel,
    borderWidth: 1,
    borderColor: palette.line,
  },
  headerTitle: { color: palette.text, fontSize: 18, fontWeight: "900" as const, flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: 18, paddingBottom: 60, gap: 18 },

  // Hero
  heroCard: {
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    overflow: "hidden" as const,
  },
  heroGradient: { ...StyleSheet.absoluteFillObject },
  heroBody: { padding: 22, alignItems: "center" as const, gap: 10 },
  heroIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,184,77,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,184,77,0.30)",
  },
  heroTitle: { color: palette.text, fontSize: 22, fontWeight: "900" as const, letterSpacing: -0.5 },
  heroSubtitle: { color: palette.muted, fontSize: 13, fontWeight: "600" as const, textAlign: "center" as const, lineHeight: 19 },

  // Tier cards
  tierCard: {
    borderRadius: 5,
    borderWidth: 1,
    overflow: "hidden" as const,
  },
  tierGradient: { ...StyleSheet.absoluteFillObject },
  tierBody: { padding: 18, gap: 14 },
  tierHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  tierNameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  tierName: { fontSize: 18, fontWeight: "900" as const },
  tierPrice: { fontSize: 15, fontWeight: "700" as const },
  tierPeriod: { fontSize: 11, fontWeight: "600" as const, marginTop: 1 },
  tierDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.06)" },
  tierAllocations: { flexDirection: "row", gap: 12 },
  tierAllocationChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 10,
    borderRadius: 5,
    borderWidth: 1,
  },
  tierAllocationLabel: { fontSize: 10, fontWeight: "800" as const, letterSpacing: 0.5 },
  tierAllocationValue: { fontSize: 12, fontWeight: "900" as const, marginTop: 2 },
  tierBenefits: { gap: 6 },
  tierBenefitRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  tierBenefitText: { color: palette.muted, fontSize: 12, fontWeight: "600" as const, flex: 1 },

  // Subscribe button
  subscribeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 5,
    borderWidth: 1,
  },
  subscribeBtnText: { fontSize: 14, fontWeight: "900" as const },

  // Current tier badge
  currentBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  currentBadgeText: { fontSize: 10, fontWeight: "900" as const, letterSpacing: 0.5 },

  // Restore button
  restoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(10,18,32,0.60)",
  },
  restoreBtnText: { color: palette.muted, fontSize: 13, fontWeight: "700" as const },

  // Auto-renewal disclosure
  disclosureCard: {
    padding: 14,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(10,18,32,0.50)",
    gap: 8,
  },
  disclosureTitle: { color: palette.muted, fontSize: 11, fontWeight: "900" as const, letterSpacing: 0.5, textTransform: "uppercase" as const },
  disclosureBody: { color: palette.muted, fontSize: 11, fontWeight: "500" as const, lineHeight: 17 },
  disclosureLink: { color: palette.cyan, fontSize: 11, fontWeight: "700" as const },

  // Status states
  statusCenter: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, padding: 40, gap: 14 },
  statusTitle: { color: palette.text, fontSize: 17, fontWeight: "900" as const, textAlign: "center" as const },
  statusSubtitle: { color: palette.muted, fontSize: 13, fontWeight: "600" as const, textAlign: "center" as const, lineHeight: 19 },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.cyan,
    backgroundColor: "rgba(54,245,255,0.10)",
  },
  retryBtnText: { color: palette.cyan, fontSize: 13, fontWeight: "800" as const },

  // Success banner
  successBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 5,
    backgroundColor: "rgba(0,200,130,0.12)",
    borderWidth: 1,
    borderColor: "rgba(0,200,130,0.30)",
  },
  successText: { color: palette.success, fontSize: 13, fontWeight: "800" as const, flex: 1 },
});

// ── Sub-component: Preview Tier Card (Expo Go / preview) ──────────────────

function PreviewTierCard({ tier, onTestSubscribe, isSubscribing }: { tier: Exclude<SubscriptionTier, "free">; onTestSubscribe?: (tier: Exclude<SubscriptionTier, "free">) => void; isSubscribing?: boolean }): JSX.Element {
  const c = TIER_ACCENTS[tier];
  const label = TIER_LABELS[tier];
  const allocation = TIER_MONTHLY_ALLOCATION[tier];
  const maxEagohs = TIER_MAX_EAGOHS[tier];
  const benefits = TIER_BENEFITS[tier];

  return (
    <View style={[styles.tierCard, { borderColor: c.border }]}>
      <LinearGradient colors={c.gradient} style={styles.tierGradient} />
      <View style={styles.tierBody}>
        <View style={styles.tierHeader}>
          <View style={styles.tierNameRow}>
            <Crown color={c.accent} size={20} />
            <Text style={[styles.tierName, { color: c.accent }]}>{label}</Text>
          </View>
          <Text style={[styles.tierPrice, { color: palette.muted }]}>Preview</Text>
        </View>
        <View style={styles.tierDivider} />
        <View style={styles.tierAllocations}>
          <View style={[styles.tierAllocationChip, { backgroundColor: c.soft, borderColor: c.border }]}>
            <Zap color={c.accent} size={13} />
            <View>
              <Text style={[styles.tierAllocationLabel, { color: palette.muted }]}>NEURONS/MO</Text>
              <Text style={[styles.tierAllocationValue, { color: c.accent }]}>{allocation.toLocaleString()}</Text>
            </View>
          </View>
          <View style={[styles.tierAllocationChip, { backgroundColor: c.soft, borderColor: c.border }]}>
            <BrainCircuit color={c.accent} size={13} />
            <View>
              <Text style={[styles.tierAllocationLabel, { color: palette.muted }]}>MAX EAGOHS</Text>
              <Text style={[styles.tierAllocationValue, { color: c.accent }]}>{maxEagohs}</Text>
            </View>
          </View>
        </View>
        <View style={styles.tierBenefits}>
          {benefits.map((benefit) => (
            <View key={benefit} style={styles.tierBenefitRow}>
              <Star color={c.accent} size={12} />
              <Text style={styles.tierBenefitText}>{benefit}</Text>
            </View>
          ))}
        </View>
        {onTestSubscribe ? (
          <Pressable
            onPress={() => onTestSubscribe(tier)}
            disabled={isSubscribing}
            style={({ pressed }) => [
              styles.subscribeBtn,
              { backgroundColor: c.accent, borderColor: c.accent },
              pressed && { opacity: 0.8 },
              isSubscribing && { opacity: 0.5 },
            ]}
          >
            {isSubscribing ? (
              <ActivityIndicator color={palette.void} size="small" />
            ) : (
              <>
                <Sparkles color={palette.void} size={16} />
                <Text style={[styles.subscribeBtnText, { color: palette.void }]}>
                  Test {label}
                </Text>
              </>
            )}
          </Pressable>
        ) : (
          <Pressable
            disabled
            style={[styles.subscribeBtn, { backgroundColor: "rgba(255,255,255,0.03)", borderColor: palette.line }]}
          >
            <Text style={[styles.subscribeBtnText, { color: palette.muted }]}>Available in TestFlight</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ── Sub-component: Tier Card ───────────────────────────────────────────────

function TierCard({
  tier,
  rcPackage,
  isCurrent,
  onSubscribe,
  isPurchasing,
}: {
  tier: Exclude<SubscriptionTier, "free">;
  rcPackage: PurchasesPackage | null;
  isCurrent: boolean;
  onSubscribe: (pkg: PurchasesPackage | null, t: Exclude<SubscriptionTier, "free">) => void;
  isPurchasing: boolean;
}): JSX.Element {
  const c = TIER_ACCENTS[tier];
  const label = TIER_LABELS[tier];
  const allocation = TIER_MONTHLY_ALLOCATION[tier];
  const maxEagohs = TIER_MAX_EAGOHS[tier];
  const benefits = TIER_BENEFITS[tier];

  const priceStr: string | null = rcPackage?.product.priceString ?? null;
  const periodStr: string = rcPackage?.product.subscriptionPeriod
    ? `per ${rcPackage.product.subscriptionPeriod}`
    : "";

  return (
    <View style={[styles.tierCard, { borderColor: isCurrent ? c.accent : c.border }]}>
      <LinearGradient colors={c.gradient} style={styles.tierGradient} />
      <View style={styles.tierBody}>
        {/* Header: name + price */}
        <View style={styles.tierHeader}>
          <View style={styles.tierNameRow}>
            <Crown color={c.accent} size={20} />
            <Text style={[styles.tierName, { color: c.accent }]}>{label}</Text>
          </View>
          <View style={{ alignItems: "flex-end" as const }}>
            <Text style={[styles.tierPrice, { color: palette.text }]}>
              {priceStr ?? "—"}
            </Text>
            {periodStr ? (
              <Text style={[styles.tierPeriod, { color: palette.muted }]}>{periodStr}</Text>
            ) : null}
          </View>
        </View>

        {isCurrent ? (
          <View style={[styles.currentBadge, { backgroundColor: c.soft, borderColor: c.border, borderWidth: 1, alignSelf: "flex-start" as const }]}>
            <BadgeCheck color={c.accent} size={12} />
            <Text style={[styles.currentBadgeText, { color: c.accent }]}>Current Plan</Text>
          </View>
        ) : null}

        <View style={styles.tierDivider} />

        {/* Allocations */}
        <View style={styles.tierAllocations}>
          <View style={[styles.tierAllocationChip, { backgroundColor: c.soft, borderColor: c.border }]}>
            <Zap color={c.accent} size={13} />
            <View>
              <Text style={[styles.tierAllocationLabel, { color: palette.muted }]}>NEURONS/MO</Text>
              <Text style={[styles.tierAllocationValue, { color: c.accent }]}>{allocation.toLocaleString()}</Text>
            </View>
          </View>
          <View style={[styles.tierAllocationChip, { backgroundColor: c.soft, borderColor: c.border }]}>
            <BrainCircuit color={c.accent} size={13} />
            <View>
              <Text style={[styles.tierAllocationLabel, { color: palette.muted }]}>MAX EAGOHS</Text>
              <Text style={[styles.tierAllocationValue, { color: c.accent }]}>{maxEagohs}</Text>
            </View>
          </View>
        </View>

        {/* Benefits */}
        <View style={styles.tierBenefits}>
          {benefits.map((benefit) => (
            <View key={benefit} style={styles.tierBenefitRow}>
              <Star color={c.accent} size={12} />
              <Text style={styles.tierBenefitText}>{benefit}</Text>
            </View>
          ))}
        </View>

        {/* Subscribe button — always rendered */}
        {isCurrent ? (
          <Pressable
            disabled
            style={[styles.subscribeBtn, { backgroundColor: c.soft, borderColor: c.border }]}
          >
            <ShieldCheck color={c.accent} size={16} />
            <Text style={[styles.subscribeBtnText, { color: c.accent }]}>Current Plan</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => onSubscribe(rcPackage, tier)}
            disabled={isPurchasing}
            style={({ pressed }) => [
              styles.subscribeBtn,
              { backgroundColor: c.accent, borderColor: c.accent },
              pressed && { opacity: 0.8 },
              isPurchasing && { opacity: 0.5 },
            ]}
          >
            {isPurchasing ? (
              <ActivityIndicator color={palette.void} size="small" />
            ) : (
              <>
                <Sparkles color={palette.void} size={16} />
                <Text style={[styles.subscribeBtnText, { color: palette.void }]}>
                  {priceStr ? `Subscribe to ${label}` : `Subscribe`}
                </Text>
              </>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────

export default function SubscriptionScreen(): JSX.Element {
  const router = useRouter();
  const h = useHaptics();
  const { user } = useAuth();
  const {
    effectiveSubscriptionTier,
    profile,
    setTestSubscription,
    clearTestSubscription,
    testTier,
    isTierLoading,
  } = useProfile();
  const {
    configured: rcConfigured,
    subscriptionPackages: rcSubPkgs,
    isLoading: rcLoading,
    isOfferingsLoading,
    isCustomerInfoLoading,
    purchase: rcPurchase,
    restore: rcRestore,
    isPurchasing,
    isRestoring,
    revenueCatTier,
    refreshAll,
    runtimeMode,
    canRealPurchase,
  } = useRevenueCat();

  const [purchasingTier, setPurchasingTier] = useState<SubscriptionTier | null>(null);
  const [purchaseSuccess, setPurchaseSuccess] = useState(false);
  const [purchaseStatusMsg, setPurchaseStatusMsg] = useState<string | null>(null);

  const currentTier: SubscriptionTier = useMemo(
    () => effectiveSubscriptionTier,
    [effectiveSubscriptionTier],
  );

  // Map RC packages to tiers using package identifier (custom_pro_sub, etc.)
  const tierPackages = useMemo(() => {
    const map: Record<string, PurchasesPackage | null> = {
      pro: null,
      oracle_elite: null,
      syndicate: null,
    };
    for (const pkg of rcSubPkgs) {
      // Primary: match by package identifier (custom_pro_sub, etc.)
      const tier = subscriptionTierFromPackageId(pkg.identifier);
      if (tier && tier in map) {
        map[tier] = pkg;
      }
    }

    // Safe diagnostic logging — package IDs, store product IDs, prices only
    console.log(
      `[Subscription] Package mapping: pro=${map.pro ? "found" : "missing"} oracle_elite=${map.oracle_elite ? "found" : "missing"} syndicate=${map.syndicate ? "found" : "missing"}`,
    );
    if (map.pro) {
      console.log(
        `[Subscription] Pro: packageId=${map.pro.identifier} productId=${map.pro.product.identifier} price=${map.pro.product.priceString ?? "n/a"}`,
      );
    }
    if (map.oracle_elite) {
      console.log(
        `[Subscription] Oracle Elite: packageId=${map.oracle_elite.identifier} productId=${map.oracle_elite.product.identifier} price=${map.oracle_elite.product.priceString ?? "n/a"}`,
      );
    }
    if (map.syndicate) {
      console.log(
        `[Subscription] Syndicate: packageId=${map.syndicate.identifier} productId=${map.syndicate.product.identifier} price=${map.syndicate.product.priceString ?? "n/a"}`,
      );
    }

    return map;
  }, [rcSubPkgs]);

  const safeBack = useSafeBack();

  const handleBack = useCallback((): void => {
    h.selection();
    safeBack();
  }, [safeBack, h]);

  /** True while offerings or customer info are still being fetched from RevenueCat. */
  const stillLoading: boolean = isOfferingsLoading || isCustomerInfoLoading;

  const handleTestSubscribe = useCallback(
    async (tier: Exclude<SubscriptionTier, "free">): Promise<void> => {
      if (!user?.id) {
        Alert.alert("Sign In Required", "Please sign in before testing a subscription.");
        return;
      }
      h.heavy();
      setPurchasingTier(tier);
      setPurchaseSuccess(false);

      try {
        // Set the test tier — persisted to AsyncStorage, immediately reflected
        // in effectiveSubscriptionTier across all screens via ProfileProvider.
        await setTestSubscription(tier);

        setPurchaseSuccess(true);
        const tierLabel = TIER_LABELS[tier];
        Alert.alert(
          "Dev Tier Activated",
          `${tierLabel} tier is now active. All paid features are unlocked.\n\nThis test subscription is stored on this device only and will persist across app restarts.\n\nTo test real purchases, install via TestFlight.`,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        Alert.alert("Error", "Failed to set test subscription: " + msg);
      } finally {
        setPurchasingTier(null);
      }
    },
    [user?.id, h, setTestSubscription],
  );

  const handleResetTestSubscription = useCallback(async (): Promise<void> => {
    if (!user?.id) return;
    h.medium();
    try {
      await clearTestSubscription();
      setPurchaseSuccess(false);
      Alert.alert(
        "Test Subscription Reset",
        "Your subscription tier has been reset to Free. All paid features are now locked.",
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      Alert.alert("Error", "Failed to reset test subscription: " + msg);
    }
  }, [user?.id, h, clearTestSubscription]);

  const handleSubscribe = useCallback(
    async (pkg: PurchasesPackage | null, tier: Exclude<SubscriptionTier, "free">): Promise<void> => {
      if (!user?.id) {
        Alert.alert("Sign In Required", "Please sign in before purchasing a subscription.");
        return;
      }
      h.heavy();

      setPurchasingTier(tier);
      setPurchaseSuccess(false);

      try {
        if (rcConfigured) {
          // ── Resolve the package if not provided ──────────────────
          let resolvedPkg = pkg;
          if (!resolvedPkg) {
            // Package not pre-loaded — fetch offerings now and search for it
            console.log(`[Subscription] Package not cached for ${tier} — searching offerings dynamically`);
            try {
              const { allOfferings: freshOfferings } = await getRcOfferings();
              for (const off of freshOfferings) {
                for (const freshPkg of off.availablePackages) {
                  const freshTier = subscriptionTierFromPackageId(freshPkg.identifier);
                  if (freshTier === tier) {
                    resolvedPkg = freshPkg;
                    break;
                  }
                }
                if (resolvedPkg) break;
              }
            } catch (lookupErr) {
              console.warn("[Subscription] Dynamic offering lookup failed:", lookupErr);
            }

            if (!resolvedPkg) {
              Alert.alert(
                "Subscription Unavailable",
                `The ${TIER_LABELS[tier]} subscription is currently unavailable. Please try again later.`,
              );
              return;
            }
          }

          // ── Verify the package resolves to an Apple Store product, not Test Store ──
          const productId = resolvedPkg.product.identifier;
          const isTestStoreProduct = productId === "pro_sub" || productId === "oracle_elite_sub" || productId === "syndicate_sub"
            || productId === "test_pro_sub" || productId === "test_oracle_elite_sub" || productId === "test_syndicate_sub";
          if (isTestStoreProduct) {
            console.warn(`[Subscription] CONFIGURATION BLOCKER: Test Store product ${productId} returned in native build — refusing to purchase.`);
            Alert.alert(
              "Configuration Error",
              "A Test Store product was returned instead of an App Store product. This is a RevenueCat configuration issue — please contact support.",
            );
            return;
          }
          console.log(`[Subscription] Purchasing: packageId=${resolvedPkg.identifier} productId=${productId}`);

          // ── Purchase the resolved package ────────────────────────
          setPurchaseStatusMsg("Completing your App Store purchase...");
          const purchaseResult = await rcPurchase(resolvedPkg);
          const activeEntitlements = purchaseResult.customerInfo.entitlements?.active;
          const entitlementKeys = activeEntitlements ? Object.keys(activeEntitlements) : [];
          console.log(`[Subscription] Purchase success — active entitlements: ${entitlementKeys.join(", ") || "none"}`);

          // ── Verify the expected entitlement is active BEFORE reporting success ──
          const expectedEntitlementId = SUBSCRIPTION_ENTITLEMENT_IDS[tier];
          const hasExpectedEntitlement = entitlementKeys.includes(expectedEntitlementId);

          if (!hasExpectedEntitlement) {
            // RevenueCat did not confirm the entitlement — do NOT change Supabase,
            // do NOT grant neurons, show verification error
            console.warn(`[Subscription] Entitlement verification failed: expected ${expectedEntitlementId}, got [${entitlementKeys.join(", ")}], productId=${productId}`);
            Alert.alert(
              "Purchase Verification Failed",
              "We could not verify this subscription purchase. You were not charged by EAGOH.\n\nUse Restore Purchases if Apple completed the transaction.",
            );
            return;
          }

          // ── Entitlement confirmed — wait for backend sync ──
          setPurchaseStatusMsg("Activating your subscription and adding neurons...");
          // The RevenueCatProvider's purchaseMutation.onSuccess already fires the
          // backend sync. Give it a moment to complete, then refresh local state.
          await new Promise((resolve) => setTimeout(resolve, 1500));
          await refreshAll();

          setPurchaseSuccess(true);
          setPurchaseStatusMsg("Subscription activated. Your neurons are ready.");

          const tierLabel = TIER_LABELS[tier];
          Alert.alert(
            "Subscription Activated",
            `Welcome to ${tierLabel}! Your benefits are now active.`,
          );
        } else if (__DEV__) {
          // ── Dev test subscription (Expo Go / Rork preview) ──────────
          // RevenueCat is not available — use the test tier override.
          // This only works in __DEV__ and never in production.
          await handleTestSubscribe(tier);
        } else {
          Alert.alert(
            "Purchases Unavailable",
            "Subscriptions require the App Store. Please install via TestFlight to purchase.",
          );
        }
      } catch (err: unknown) {
        const errObj = err as { userCancelled?: boolean; message?: string };
        if (errObj?.userCancelled) {
          // User cancelled — not an error
          if (__DEV__) {
            console.log("[Subscription] User cancelled purchase");
          }
        } else {
          const msg = errObj?.message ?? "Purchase failed";
          console.warn("[Subscription] Purchase error:", msg);
          Alert.alert("Purchase Failed", msg);
        }
      } finally {
        setPurchasingTier(null);
        setPurchaseStatusMsg(null);
      }
    },
    [user?.id, rcPurchase, rcConfigured, h, handleTestSubscribe, refreshAll],
  );

  const handleRestore = useCallback(async (): Promise<void> => {
    h.medium();
    try {
      const customerInfo = await rcRestore();
      const activeEntitlements = customerInfo?.entitlements?.active;
      const entitlementKeys = activeEntitlements ? Object.keys(activeEntitlements) : [];
      if (entitlementKeys.length > 0) {
        // Backend sync is triggered by restoreMutation.onSuccess in the provider.
        // Wait for it, then refresh.
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await refreshAll();
        const tier = revenueCatTier;
        const tierLabel = TIER_LABELS[tier];
        Alert.alert(
          "Purchases Restored",
          `${tierLabel} subscription restored successfully.`,
        );
      } else {
        Alert.alert("No Purchases Found", "No previous subscriptions were found to restore.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Restore failed";
      Alert.alert("Restore Failed", msg);
    }
  }, [rcRestore, revenueCatTier, h, refreshAll]);

  const handleRetry = useCallback((): void => {
    refreshAll();
  }, [refreshAll]);

  // ── Loading state ──────────────────────────────────────────────────────

  if (rcLoading && !rcConfigured) {
    return (
      <SafeAreaView edges={["top"]} style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={handleBack} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}>
            <ArrowLeft color={palette.text} size={18} />
          </Pressable>
          <Text style={styles.headerTitle}>Subscription</Text>
        </View>
        <View style={styles.statusCenter}>
          <Loader2 color={palette.cyan} size={36} />
          <Text style={styles.statusTitle}>Connecting to App Store…</Text>
          <Text style={styles.statusSubtitle}>Checking subscription availability</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Not configured — show preview cards in Expo Go / preview; error otherwise ─

  if (!rcConfigured) {
    const isPreview = runtimeMode === "expo-go-disabled" || runtimeMode === "web-disabled";
    return (
      <SafeAreaView edges={["top"]} style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={handleBack} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}>
            <ArrowLeft color={palette.text} size={18} />
          </Pressable>
          <Text style={styles.headerTitle}>Subscription</Text>
        </View>
        {isPreview ? (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {/* Hero card */}
            <View style={styles.heroCard}>
              <LinearGradient colors={["rgba(255,184,77,0.10)", "rgba(10,18,30,0.84)", "rgba(3,6,11,0.96)"]} style={styles.heroGradient} />
              <View style={styles.heroBody}>
                <View style={styles.heroIconWrap}>
                  <Crown color={palette.gold} size={28} />
                </View>
                <Text style={styles.heroTitle}>Choose Your Plan</Text>
                <Text style={styles.heroSubtitle}>
                  Store purchases require a development build or TestFlight. Previewing subscription tiers below.
                </Text>
              </View>
            </View>

            {/* Loading state while test tier is being read from AsyncStorage */}
            {isTierLoading ? (
              <View style={styles.statusCenter}>
                <ActivityIndicator color={palette.cyan} size="large" />
                <Text style={styles.statusSubtitle}>Checking subscription…</Text>
              </View>
            ) : null}

            {/* Active test tier banner */}
            {!isTierLoading && testTier && testTier !== "free" ? (
              <View style={styles.successBanner}>
                <BadgeCheck color={palette.success} size={18} />
                <Text style={styles.successText}>
                  Test tier active: {TIER_LABELS[testTier]}. All paid features are unlocked.
                </Text>
              </View>
            ) : null}

            {/* Preview tier cards */}
            {!isTierLoading ? (
              <>
                <PreviewTierCard
                  tier="pro"
                  onTestSubscribe={__DEV__ ? handleTestSubscribe : undefined}
                  isSubscribing={isPurchasing && purchasingTier === "pro"}
                />
                <PreviewTierCard
                  tier="oracle_elite"
                  onTestSubscribe={__DEV__ ? handleTestSubscribe : undefined}
                  isSubscribing={isPurchasing && purchasingTier === "oracle_elite"}
                />
                <PreviewTierCard
                  tier="syndicate"
                  onTestSubscribe={__DEV__ ? handleTestSubscribe : undefined}
                  isSubscribing={isPurchasing && purchasingTier === "syndicate"}
                />

                {/* Dev-only: Reset Test Subscription */}
                {__DEV__ && testTier && testTier !== "free" ? (
                  <Pressable
                    onPress={handleResetTestSubscription}
                    style={({ pressed }) => [styles.restoreBtn, pressed && { opacity: 0.7 }]}
                  >
                    <RefreshCw color={palette.muted} size={16} />
                    <Text style={styles.restoreBtnText}>Reset Test Subscription</Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}
          </ScrollView>
        ) : (
          <View style={styles.statusCenter}>
            <Coins color={palette.muted} size={40} />
            <Text style={styles.statusTitle}>App Store Unavailable</Text>
            <Text style={styles.statusSubtitle}>
              Subscriptions require the iOS App Store. This feature is not available in the current build environment.
            </Text>
            <Pressable onPress={handleRetry} style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}>
              <RefreshCw color={palette.cyan} size={16} />
              <Text style={styles.retryBtnText}>Retry</Text>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    );
  }

  // ── RevenueCat configured — always show tier cards ────────────────────

  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={handleBack} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}>
          <ArrowLeft color={palette.text} size={18} />
        </Pressable>
        <Text style={styles.headerTitle}>Subscription</Text>
        <Crown color={palette.gold} size={18} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Hero card */}
        <View style={styles.heroCard}>
          <LinearGradient colors={["rgba(255,184,77,0.10)", "rgba(10,18,30,0.84)", "rgba(3,6,11,0.96)"]} style={styles.heroGradient} />
          <View style={styles.heroBody}>
            <View style={styles.heroIconWrap}>
              <Crown color={palette.gold} size={28} />
            </View>
            <Text style={styles.heroTitle}>Choose Your Plan</Text>
            <Text style={styles.heroSubtitle}>
              Unlock the full power of EAGOH intelligence. All plans include a monthly Neuron allocation, EAGOH slots, and exclusive features.
            </Text>
          </View>
        </View>

        {/* Success banner */}
        {purchaseSuccess ? (
          <View style={styles.successBanner}>
            <BadgeCheck color={palette.success} size={18} />
            <Text style={styles.successText}>
              {purchaseStatusMsg ?? "Subscription activated successfully! Your benefits are now live."}
            </Text>
          </View>
        ) : null}

        {/* In-progress status banner */}
        {!purchaseSuccess && purchaseStatusMsg && purchasingTier ? (
          <View style={styles.successBanner}>
            <ActivityIndicator color={palette.cyan} size="small" />
            <Text style={[styles.successText, { color: palette.cyan }]}>
              {purchaseStatusMsg}
            </Text>
          </View>
        ) : null}

        {/* Loading indicator while RC data loads */}
        {stillLoading ? (
          <View style={styles.statusCenter}>
            <ActivityIndicator color={palette.cyan} size="large" />
            <Text style={styles.statusSubtitle}>Loading subscription products…</Text>
          </View>
        ) : null}

        {/* No subscription products found or no current offering */}
        {!stillLoading && rcSubPkgs.length === 0 ? (
          <View style={styles.statusCenter}>
            <Coins color={palette.muted} size={36} />
            <Text style={styles.statusTitle}>Subscriptions Temporarily Unavailable</Text>
            <Text style={styles.statusSubtitle}>
              Subscription products could not be loaded right now. Please check your connection and try again.
            </Text>
            <Pressable onPress={handleRetry} style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}>
              <RefreshCw color={palette.cyan} size={16} />
              <Text style={styles.retryBtnText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Tier cards — always render, even if packages haven't loaded yet */}
        <TierCard
          tier="pro"
          rcPackage={tierPackages.pro}
          isCurrent={currentTier === "pro" && !purchaseSuccess}
          onSubscribe={handleSubscribe}
          isPurchasing={isPurchasing && purchasingTier === "pro"}
        />
        <TierCard
          tier="oracle_elite"
          rcPackage={tierPackages.oracle_elite}
          isCurrent={currentTier === "oracle_elite" && !purchaseSuccess}
          onSubscribe={handleSubscribe}
          isPurchasing={isPurchasing && purchasingTier === "oracle_elite"}
        />
        <TierCard
          tier="syndicate"
          rcPackage={tierPackages.syndicate}
          isCurrent={currentTier === "syndicate" && !purchaseSuccess}
          onSubscribe={handleSubscribe}
          isPurchasing={isPurchasing && purchasingTier === "syndicate"}
        />

        {/* Restore purchases */}
        <Pressable
          onPress={handleRestore}
          disabled={isRestoring}
          style={({ pressed }) => [styles.restoreBtn, pressed && { opacity: 0.7 }]}
        >
          {isRestoring ? (
            <ActivityIndicator color={palette.muted} size="small" />
          ) : (
            <RefreshCw color={palette.muted} size={16} />
          )}
          <Text style={styles.restoreBtnText}>
            {isRestoring ? "Restoring…" : "Restore Purchases"}
          </Text>
        </Pressable>

        {/* Auto-renewal disclosure — required by App Store Guideline 3.1.2 */}
        <View style={styles.disclosureCard}>
          <Text style={styles.disclosureTitle}>Subscription Terms</Text>
          <Text style={styles.disclosureBody}>
            Payment is charged to your Apple ID account at confirmation of purchase. Subscriptions automatically renew unless auto-renew is turned off at least 24 hours before the end of the current billing period.
          </Text>
          <Text style={styles.disclosureBody}>
            Your account is charged for renewal within 24 hours prior to the end of the current period. You can manage and cancel your subscriptions anytime in your Apple ID Settings under Subscriptions.
          </Text>
          <Pressable onPress={() => router.push("/legal/terms" as never)}>
            <Text style={styles.disclosureLink}>View Terms of Service ›</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/legal/privacy" as never)}>
            <Text style={styles.disclosureLink}>View Privacy Policy ›</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
