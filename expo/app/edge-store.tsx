/**
 * Edge Store — Premium cybernetic screen for purchasing Neurons.
 *
 * Displays current balances (subscription, purchased, total), Neuron
 * packs from RevenueCat offerings, and a real purchase flow with
 * confirmation modal. Uses RevenueCat for purchase verification and
 * Supabase for edge wallet crediting.
 */

import { palette } from "@/constants/colors";
import { useAppTheme } from "@/providers/ThemeProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useAuth } from "@/providers/AuthProvider";
import { useEdge } from "@/providers/EdgeProvider";
import { useProfile } from "@/providers/ProfileProvider";
import { useRevenueCat } from "@/providers/RevenueCatProvider";
import { NEURON_PRODUCT_AMOUNTS } from "@/services/revenuecat";
import { EDGE_PACKS, type EdgePack, isMockPurchaseAllowed, recordNeuronPurchaseOnce } from "@/services/edgeStore";
import { canPurchaseNeuronPacks } from "@/services/permissions";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeBack } from "@/hooks/useSafeBack";
import { useRouter } from "expo-router";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Coins,
  LockKeyhole,
  Infinity,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  WalletCards,
  WifiOff,
  Zap,
} from "lucide-react-native";
import type { PurchasesPackage } from "react-native-purchases";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// ── Constants ──────────────────────────────────────────────────────────────

const PACK_COLORS: Record<string, { accent: string; soft: string; border: string; glow: string }> = {
  store_edge_250: {
    accent: palette.cyan,
    soft: "rgba(108,230,255,0.12)",
    border: "rgba(108,230,255,0.30)",
    glow: "rgba(108,230,255,0.16)",
  },
  store_edge_750: {
    accent: palette.cyan,
    soft: "rgba(108,230,255,0.12)",
    border: "rgba(108,230,255,0.30)",
    glow: "rgba(108,230,255,0.16)",
  },
  store_edge_2000: {
    accent: palette.blue,
    soft: "rgba(61,165,255,0.14)",
    border: "rgba(61,165,255,0.36)",
    glow: "rgba(61,165,255,0.20)",
  },
  store_edge_6000: {
    accent: palette.gold,
    soft: "rgba(255,181,71,0.12)",
    border: "rgba(255,181,71,0.40)",
    glow: "rgba(255,181,71,0.20)",
  },
  store_edge_15000: {
    accent: palette.violet,
    soft: "rgba(138,92,255,0.12)",
    border: "rgba(138,92,255,0.40)",
    glow: "rgba(138,92,255,0.22)",
  },
};

const BADGE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  "Best Value": {
    bg: "rgba(255,181,71,0.16)",
    text: palette.gold,
    border: "rgba(255,181,71,0.40)",
  },
  "Power User": {
    bg: "rgba(138,92,255,0.16)",
    text: palette.violet,
    border: "rgba(138,92,255,0.40)",
  },
};

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

  // Status banner
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 5,
    backgroundColor: "rgba(54,245,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(54,245,255,0.18)",
  },
  statusBannerText: {
    color: palette.cyan,
    fontSize: 12,
    fontWeight: "800" as const,
    flex: 1,
  },

  // Balance card
  balanceCard: {
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    overflow: "hidden" as const,
  },
  balanceGradient: { ...StyleSheet.absoluteFillObject },
  balanceBody: { padding: 18, gap: 14 },
  balanceHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  balanceTitle: { color: palette.text, fontSize: 14, fontWeight: "900" as const, flex: 1 },
  balanceGrid: { flexDirection: "row", gap: 10 },
  balanceCell: {
    flex: 1,
    borderRadius: 5,
    padding: 12,
    borderWidth: 1,
    alignItems: "center",
    gap: 6,
  },
  balanceCellLabel: { fontSize: 10, fontWeight: "800" as const, letterSpacing: 1.2, textTransform: "uppercase" as const },
  balanceCellValue: { fontSize: 22, fontWeight: "900" as const },
  balanceTotal: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  balanceTotalLabel: { color: palette.muted, fontSize: 12, fontWeight: "700" as const },
  balanceTotalValue: { color: palette.text, fontSize: 20, fontWeight: "900" as const, flex: 1, textAlign: "right" as const },

  // Info note
  infoNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 5,
    backgroundColor: "rgba(108,230,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(108,230,255,0.14)",
  },
  infoNoteText: { color: palette.muted, fontSize: 12, fontWeight: "600" as const, flex: 1, lineHeight: 18 },

  // Pack grid
  packGrid: { gap: 12 },

  // Pack card
  packCard: {
    borderRadius: 5,
    borderWidth: 1,
    backgroundColor: "rgba(10,18,32,0.80)",
    overflow: "hidden" as const,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  packGradient: { ...StyleSheet.absoluteFillObject },
  packIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  packInfo: { flex: 1 },
  packLabel: { fontSize: 17, fontWeight: "900" as const },
  packPrice: { fontSize: 14, fontWeight: "700" as const, marginTop: 3 },
  packBadge: {
    position: "absolute" as const,
    top: 0,
    right: 0,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderBottomLeftRadius: 5,
    borderLeftWidth: 1,
    borderBottomWidth: 1,
  },
  packBadgeText: { fontSize: 10, fontWeight: "900" as const, letterSpacing: 0.8 },
  packArrow: { opacity: 0.5 },

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

  // Confirmation modal
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2,4,10,0.82)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  confirmCard: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.obsidian,
    padding: 22,
    gap: 16,
    overflow: "hidden" as const,
  },
  confirmHeader: {
    color: palette.cyan,
    fontSize: 11,
    fontWeight: "900" as const,
    letterSpacing: 1.8,
    textAlign: "center" as const,
    textTransform: "uppercase" as const,
  },
  confirmPackLabel: { color: palette.text, fontSize: 22, fontWeight: "900" as const, textAlign: "center" as const },
  confirmDetailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: palette.line,
  },
  confirmDetailLabel: { color: palette.muted, fontSize: 13, fontWeight: "600" as const },
  confirmDetailValue: { color: palette.text, fontSize: 13, fontWeight: "800" as const },
  confirmActions: { flexDirection: "row", gap: 10 },
  confirmCancel: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmCancelText: { color: palette.muted, fontSize: 14, fontWeight: "800" as const },
  confirmBuy: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  confirmBuyText: { color: palette.void, fontSize: 14, fontWeight: "900" as const },
  disabledBtn: { opacity: 0.5 },

  // Empty state
  emptyState: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 16,
    borderRadius: 5,
    backgroundColor: "rgba(10,20,40,0.50)",
    borderWidth: 1,
    borderColor: palette.line,
  },
  emptyStateText: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: "600" as const,
    flex: 1,
    lineHeight: 19,
  },
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Map a RevenueCat package to our local EdgePack using product.identifier (NOT package identifier). */
function findEdgePack(rcPkg: PurchasesPackage): EdgePack | undefined {
  return EDGE_PACKS.find((p) => p.productId === rcPkg.product.identifier);
}

/** Format a RevenueCat price string (e.g. "$4.99") for display. */
function formatPrice(pkg: PurchasesPackage): string {
  return pkg.product.priceString ?? `$${pkg.product.price.toFixed(2)}`;
}

// ── Sub-components ─────────────────────────────────────────────────────────

/** Small balance display cell. */
function BalanceCell({
  label,
  value,
  accent,
  bgColor,
  borderColor,
}: {
  label: string;
  value: string;
  accent: string;
  bgColor: string;
  borderColor: string;
}): JSX.Element {
  return (
    <View style={[styles.balanceCell, { backgroundColor: bgColor, borderColor }]}>
      <Text style={[styles.balanceCellLabel, { color: accent }]}>{label}</Text>
      <Text style={[styles.balanceCellValue, { color: accent }]}>{value}</Text>
    </View>
  );
}

/** Single Neuron pack card powered by RevenueCat. */
function PackCard({
  pack,
  rcPackage,
  onPress,
  disabled,
}: {
  pack: EdgePack;
  rcPackage: PurchasesPackage;
  onPress: () => void;
  disabled: boolean;
}): JSX.Element {
  const c = PACK_COLORS[pack.productId] ?? PACK_COLORS.edge_250;
  const badge = pack.badge ? BADGE_STYLES[pack.badge] : null;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.packCard,
        { borderColor: c.border },
        pressed && { opacity: 0.85 },
        disabled && styles.disabledBtn,
      ]}
    >
      <LinearGradient colors={["rgba(10,18,32,0.60)", c.soft, "rgba(10,18,32,0.94)"]} style={styles.packGradient} />
      {/* Icon */}
      <View style={[styles.packIconWrap, { backgroundColor: c.soft, borderColor: c.border }]}>
        <WalletCards color={c.accent} size={24} />
      </View>
      {/* Info */}
      <View style={styles.packInfo}>
        <Text style={[styles.packLabel, { color: palette.text }]}>{pack.label}</Text>
        <Text style={[styles.packPrice, { color: c.accent }]}>{formatPrice(rcPackage)}</Text>
      </View>
      {/* Badge */}
      {badge && (
        <View style={[styles.packBadge, { backgroundColor: badge.bg, borderLeftColor: badge.border, borderBottomColor: badge.border }]}>
          <Text style={[styles.packBadgeText, { color: badge.text }]}>{pack.badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

// ── Main Screen ─────────────────────────────────────────────────────────────

export default function EdgeStoreScreen(): JSX.Element {
  const { palette: pal } = useAppTheme();
  const h = useHaptics();
  const router = useRouter();
  const { user } = useAuth();
  const { profile, effectiveSubscriptionTier } = useProfile();
  const { balances, purchase: creditEdge, isMutating } = useEdge();
  const {
    configured: rcConfigured,
    allNeuronPackages: rcNeuronPackages,
    purchase: rcPurchase,
    restore: rcRestore,
    isPurchasing,
    isRestoring,
    diagnostics,
    runtimeMode,
    canRealPurchase,
  } = useRevenueCat();

  const [confirmPack, setConfirmPack] = useState<EdgePack | null>(null);
  const [confirmRcPkg, setConfirmRcPkg] = useState<PurchasesPackage | null>(null);
  const [purchasing, setPurchasing] = useState(false);

  // ── Dev diagnostics ────────────────────────────────────────────────────
  useEffect(() => {
    if (!__DEV__) return;
    console.log("[NeuronStore] ── Diagnostics ──");
    console.log("[NeuronStore] Platform:", Platform.OS);
    console.log("[NeuronStore] RC configured:", rcConfigured);
    if (diagnostics) {
      console.log("[NeuronStore] RC key mode:", diagnostics.keyMode);
      console.log("[NeuronStore] Offerings count:", diagnostics.allOfferingIds?.length ?? 0);
      console.log("[NeuronStore] Matching Neuron packs:", diagnostics.neuronPackCount);
      console.log("[NeuronStore] Mock purchases enabled:", diagnostics.mockPurchasesEnabled);
    }
    console.log("[NeuronStore] RC neuron packages from all offerings:", rcNeuronPackages.length);
    if (rcNeuronPackages.length > 0) {
      for (const p of rcNeuronPackages) {
        const amount = NEURON_PRODUCT_AMOUNTS[p.product.identifier];
        console.log(`[NeuronStore]   pkg: ${p.identifier} → product: ${p.product.identifier} (${p.product.productCategory ?? "?"}) ${p.product.priceString ?? `$${p.product.price}`} → ${amount != null ? amount + " Neurons" : "?"}`);
      }
    }
  }, [rcConfigured, rcNeuronPackages, diagnostics]);

  // Map RevenueCat neuron packages (from ALL offerings) to local EdgePack metadata.
  // Falls back to local EDGE_PACKS only when RC is not configured or has zero matching packs.
  const { displayPacks, usingFallbackPacks } = useMemo(() => {
    console.log("[NeuronStore] RC configured:", rcConfigured);
    console.log("[NeuronStore] RC neuron packages (all offerings):", rcNeuronPackages.length);

    // Attempt to match RC packages against local EDGE_PACKS using product.identifier
    const mapped: { edgePack: EdgePack; rcPackage: PurchasesPackage }[] = [];
    for (const rcPkg of rcNeuronPackages) {
      const ep = findEdgePack(rcPkg);
      if (ep) {
        console.log("[NeuronStore] Matched RC product", rcPkg.product.identifier, "(package:", rcPkg.identifier, ") →", ep.productId, "|", formatPrice(rcPkg));
        mapped.push({ edgePack: ep, rcPackage: rcPkg });
      } else {
        console.log("[NeuronStore] No local EDGE_PACK match for RC product:", rcPkg.product.identifier);
      }
    }

    if (mapped.length > 0) {
      console.log("[NeuronStore] usingFallbackPacks: false —", mapped.length, "live RC packs");
      mapped.sort((a, b) => a.edgePack.sortKey - b.edgePack.sortKey);
      return { displayPacks: mapped, usingFallbackPacks: false };
    }

    // Fallback: show local packs when RC has no matching consumable Neuron packs
    console.log("[NeuronStore] No usable RC Neuron packs — using fallback EDGE_PACKS");
    console.log("[NeuronStore] usingFallbackPacks: true");
    console.log("[NeuronStore] Fallback pack count:", EDGE_PACKS.length);
    const fallback = EDGE_PACKS.map((ep) => ({ edgePack: ep, rcPackage: null as PurchasesPackage | null }))
      .sort((a, b) => a.edgePack.sortKey - b.edgePack.sortKey);
    return { displayPacks: fallback, usingFallbackPacks: true };
  }, [rcNeuronPackages, rcConfigured]);

  const safeBack = useSafeBack();

  const handleBack = useCallback((): void => {
    h.selection();
    safeBack();
  }, [safeBack, h]);

  const handleSelectPack = useCallback(
    (edgePack: EdgePack, rcPkg: PurchasesPackage | null): void => {
      h.medium();
      setConfirmPack(edgePack);
      setConfirmRcPkg(rcPkg);
    },
    [h],
  );

  const handleConfirmPurchase = useCallback(async (): Promise<void> => {
    if (!confirmPack || !user?.id || !profile) return;
    h.heavy();
    setPurchasing(true);

    const neuronAmount = confirmPack.edgeAmount;
    const productId = confirmPack.productId;

    console.log("[NeuronStore] Purchase attempt — product:", productId, "|", neuronAmount, "Neurons | RC configured:", rcConfigured, "| has RC package:", !!confirmRcPkg);

    try {
      if (rcConfigured && confirmRcPkg) {
        // ── Real RevenueCat purchase ──────────────────────────────────
        console.log("[NeuronStore] Calling RevenueCat purchasePackage for:", confirmRcPkg.product.identifier);
        const purchaseResult = await rcPurchase(confirmRcPkg);
        console.log("[NeuronStore] RevenueCat purchase confirmed — tx:", purchaseResult.transactionIdentifier);

        // Idempotency check — prevent double-crediting across restarts/refreshes
        const isNew = await recordNeuronPurchaseOnce(
          user.id,
          productId,
          purchaseResult.transactionIdentifier,
          neuronAmount,
        );

        if (isNew) {
          console.log("[NeuronStore] New purchase — crediting", neuronAmount, "Neurons");
          await creditEdge(neuronAmount, `RevenueCat purchase: ${confirmPack.label} (${productId})`);
        } else {
          console.log("[NeuronStore] Duplicate purchase detected — skipping credit");
        }

        setConfirmPack(null);
        setConfirmRcPkg(null);
        Alert.alert("Purchase Successful", `${neuronAmount.toLocaleString()} Neurons added to your wallet.`);
      } else if (rcConfigured && !confirmRcPkg) {
        // RC is configured but the selected pack wasn't matched to an RC package.
        // This happens when the store shows local packs but RC has no matching products.
        console.warn("[NeuronStore] RC configured but no RC package for:", productId);
        Alert.alert(
          "Purchase Unavailable",
          "Neuron packs were not returned by the App Store. Please try again.",
        );
        setConfirmPack(null);
        setConfirmRcPkg(null);
      } else if (isMockPurchaseAllowed()) {
        // Mock purchase: RevenueCat not available in dev — use direct Supabase credit.
        // The creditEdge mutation calls addPurchasedEdge which updates profiles.edge_purchased
        // in Supabase. If the DB update fails, the mutation throws and we catch it below —
        // the UI balance is NOT updated unless the DB write succeeds.
        console.log("[NeuronStore] Using mock purchase for:", productId, "|", neuronAmount, "Neurons");
        try {
          const updatedProfile = await creditEdge(neuronAmount, `Mock Neuron purchase: ${confirmPack.label} (${productId})`);
          // Verify the Supabase profile was actually updated — the mutation returns the updated row.
          if (!updatedProfile || typeof updatedProfile.edge_purchased !== "number") {
            throw new Error("Supabase profile update returned no data.");
          }
          console.log("[NeuronStore] Mock purchase succeeded — edge_purchased is now:", updatedProfile.edge_purchased);
          setConfirmPack(null);
          setConfirmRcPkg(null);
          Alert.alert("Test Purchase", `${neuronAmount.toLocaleString()} Neurons added to your wallet (mock).`);
        } catch (mockErr) {
          // DB update failed — do NOT update the displayed balance.
          console.error("[NeuronStore] Mock purchase DB update failed:", mockErr instanceof Error ? mockErr.message : String(mockErr));
          setConfirmPack(null);
          setConfirmRcPkg(null);
          Alert.alert("Purchase Failed", "Test Neurons could not be added.");
        }
      } else {
        // RC not configured and mock not allowed — determine the actual reason
        const isNative = Platform.OS === "ios" || Platform.OS === "android";
        if (!isNative) {
          Alert.alert(
            "Purchase Unavailable",
            "Purchases require an iOS or Android development build.",
          );
        } else {
          Alert.alert(
            "Store Unavailable",
            "Purchases are temporarily unavailable because the store connection is not configured.",
          );
        }
        setConfirmPack(null);
        setConfirmRcPkg(null);
      }
    } catch (err: unknown) {
      // Check if the user cancelled the purchase
      if (
        typeof err === "object" &&
        err !== null &&
        "userCancelled" in err &&
        (err as { userCancelled?: boolean }).userCancelled
      ) {
        console.log("[NeuronStore] Purchase cancelled by user");
        // User cancelled — just close the modal quietly, no error
        setConfirmPack(null);
        setConfirmRcPkg(null);
      } else {
        const msg = err instanceof Error ? err.message : "Purchase failed";
        console.error("[NeuronStore] Purchase error:", msg);
        Alert.alert("Purchase Failed", msg);
      }
    } finally {
      setPurchasing(false);
    }
  }, [confirmPack, confirmRcPkg, user?.id, profile, rcConfigured, rcPurchase, creditEdge, h]);

  const handleCancelConfirm = useCallback((): void => {
    h.selection();
    setConfirmPack(null);
    setConfirmRcPkg(null);
  }, [h]);

  const handleRestore = useCallback(async (): Promise<void> => {
    h.medium();
    try {
      const customerInfo = await rcRestore();
      const activeCount = customerInfo?.entitlements.active
        ? Object.keys(customerInfo.entitlements.active).length
        : 0;
      if (activeCount > 0) {
        Alert.alert("Purchases Restored", `${activeCount} active entitlement(s) found and restored.`);
      } else {
        Alert.alert("No Purchases Found", "No previous purchases were found to restore.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Restore failed";
      Alert.alert("Restore Failed", msg);
    }
  }, [rcRestore, h]);

  // Total Edge
  const totalEdge = balances.total.toLocaleString();
  const subEdge = balances.subscription.toLocaleString();
  const purchasedEdge = balances.purchased.toLocaleString();

  // Disable when a mutation is in flight
  const disabled = isMutating || purchasing || isPurchasing;

  // Free users cannot purchase Neuron packs
  const canBuyPacks = canPurchaseNeuronPacks(effectiveSubscriptionTier);

  return (
    <SafeAreaView edges={["top"]} style={[styles.safe, { backgroundColor: pal.void }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={handleBack} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}>
          <ArrowLeft color={palette.text} size={18} />
        </Pressable>
        <Text style={styles.headerTitle}>Neuron Store</Text>
        <Sparkles color={palette.gold} size={18} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* RevenueCat / Test Mode status banner */}
        <View style={styles.statusBanner}>
          {runtimeMode === "expo-go-disabled" || runtimeMode === "web-disabled" ? (
            <>
              <WifiOff color={palette.muted} size={16} />
              <Text style={[styles.statusBannerText, { color: palette.muted }]}>
                Store purchases require a development build or TestFlight.
              </Text>
            </>
          ) : usingFallbackPacks ? (
            <>
              <AlertTriangle color={palette.gold} size={16} />
              <Text style={[styles.statusBannerText, { color: palette.gold }]}>
                Test Purchase Mode — RevenueCat packs not loaded.
              </Text>
            </>
          ) : (
            <>
              <ShieldCheck color={palette.cyan} size={16} />
              <Text style={styles.statusBannerText}>
                Purchases secured by RevenueCat
              </Text>
            </>
          )}
        </View>

        {/* Balance card */}
        <View style={styles.balanceCard}>
          <LinearGradient colors={["rgba(54,245,255,0.08)", "rgba(138,92,255,0.04)", "rgba(10,20,40,0.60)"]} style={styles.balanceGradient} />
          <View style={styles.balanceBody}>
            <View style={styles.balanceHeader}>
              <WalletCards color={palette.gold} size={18} />
              <Text style={styles.balanceTitle}>Your Neuron Wallet</Text>
            </View>
            <View style={styles.balanceGrid}>
              <BalanceCell
                label="Subscription"
                value={subEdge}
                accent={palette.cyan}
                bgColor="rgba(108,230,255,0.08)"
                borderColor="rgba(108,230,255,0.18)"
              />
              <BalanceCell
                label="Purchased"
                value={purchasedEdge}
                accent={palette.gold}
                bgColor="rgba(255,181,71,0.08)"
                borderColor="rgba(255,181,71,0.18)"
              />
            </View>
            <View style={[styles.balanceTotal, { borderTopColor: palette.line }]}>
              <Zap color={palette.text} size={14} />
              <Text style={styles.balanceTotalLabel}>Total Neurons</Text>
              <Text style={styles.balanceTotalValue}>{totalEdge}</Text>
            </View>
          </View>
        </View>

        {/* Info note */}
        <View style={styles.infoNote}>
          <Infinity color={palette.success} size={14} />
          <Text style={styles.infoNoteText}>
            Purchased Neurons do not expire. Subscription Neurons are always spent first, purchased Neurons second.
          </Text>
        </View>

        {canBuyPacks ? (
          <>
            {/* Pack header */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Coins color={palette.gold} size={18} />
              <Text style={{ color: palette.text, fontSize: 16, fontWeight: "900" as const }}>Neuron Packs</Text>
            </View>

            {/* Pack cards — empty state only as absolute last resort */}
            {displayPacks.length > 0 ? (
              <View style={styles.packGrid}>
                {displayPacks.map(({ edgePack, rcPackage }) => (
                  <PackCard
                    key={edgePack.productId}
                    pack={edgePack}
                    rcPackage={rcPackage ?? {
                      identifier: edgePack.productId,
                      offeringIdentifier: "default",
                      packageType: "CUSTOM" as const,
                      product: {
                        identifier: edgePack.productId,
                        price: edgePack.priceUsd,
                        priceString: `$${edgePack.priceUsd.toFixed(2)}`,
                        currencyCode: "USD",
                        title: edgePack.label,
                        description: `${edgePack.edgeAmount} Neurons`,
                        productCategory: "NON_SUBSCRIPTION" as const,
                      } as PurchasesPackage["product"],
                    } as unknown as PurchasesPackage}
                    onPress={() => handleSelectPack(edgePack, rcPackage)}
                    disabled={disabled || !canRealPurchase}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.emptyState}>
                <AlertTriangle color={palette.muted} size={20} />
                <Text style={styles.emptyStateText}>Neuron packs could not be loaded. Please try again.</Text>
              </View>
            )}
          </>
        ) : (
          /* Free user locked state */
          <View style={{
            padding: 24,
            borderRadius: 5,
            borderWidth: 1,
            borderColor: "rgba(108,230,255,0.18)",
            backgroundColor: "rgba(108,230,255,0.04)",
            alignItems: "center",
            gap: 14,
          }}>
            <LockKeyhole color={palette.cyan} size={32} />
            <Text style={{
              color: palette.text,
              fontSize: 15,
              fontWeight: "800" as const,
              textAlign: "center" as const,
              lineHeight: 22,
            }}>
              Neuron packs are available for subscribers only.
            </Text>
            <Text style={{
              color: palette.muted,
              fontSize: 13,
              fontWeight: "600" as const,
              textAlign: "center" as const,
              lineHeight: 19,
            }}>
              Upgrade to unlock extra neurons.
            </Text>
            <Pressable
              onPress={() => {
                h.medium();
                router.push("/subscription");
              }}
              style={({ pressed }) => ({
                paddingHorizontal: 32,
                paddingVertical: 12,
                borderRadius: 5,
                backgroundColor: palette.gold,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text style={{
                color: palette.void,
                fontSize: 14,
                fontWeight: "900" as const,
              }}>Upgrade</Text>
            </Pressable>
          </View>
        )}

        {/* DEV TEST ONLY: Mock Neuron purchase buttons */}
        {/* Only visible in __DEV__ AND when RC is not configured (Expo Go / preview) */}
        {__DEV__ && !rcConfigured && canBuyPacks ? (
          <View style={{ gap: 10, marginTop: 8 }}>
            <View style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 5,
              borderWidth: 1,
              borderColor: "rgba(255,107,53,0.30)",
              backgroundColor: "rgba(255,107,53,0.06)",
            }}>
              <AlertTriangle color={palette.ember} size={12} />
              <Text style={{
                color: palette.ember,
                fontSize: 10,
                fontWeight: "900" as const,
                letterSpacing: 1,
              }}>DEV TEST ONLY — NOT REAL PURCHASES</Text>
            </View>
            {EDGE_PACKS.map((pack) => (
              <Pressable
                key={pack.productId}
                onPress={async () => {
                  if (!user?.id || !profile) return;
                  h.heavy();
                  setPurchasing(true);
                  try {
                    await creditEdge(pack.edgeAmount, `DEV TEST: ${pack.label} (${pack.productId})`);
                    Alert.alert("Dev Test Complete", `${pack.edgeAmount.toLocaleString()} Neurons credited (mock).`);
                  } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : "Unknown error";
                    Alert.alert("Error", msg);
                  } finally {
                    setPurchasing(false);
                  }
                }}
                disabled={purchasing || isMutating}
                style={({ pressed }) => [{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingVertical: 12,
                  paddingHorizontal: 16,
                  borderRadius: 5,
                  borderWidth: 1,
                  borderColor: "rgba(255,107,53,0.20)",
                  backgroundColor: "rgba(255,107,53,0.04)",
                  opacity: (purchasing || isMutating) ? 0.5 : 1,
                }, pressed && { opacity: 0.8 }]}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Zap color={palette.ember} size={16} />
                  <Text style={{ color: palette.text, fontSize: 14, fontWeight: "800" as const }}>
                    Test {pack.label}
                  </Text>
                </View>
                <Text style={{ color: palette.ember, fontSize: 11, fontWeight: "900" as const, letterSpacing: 0.5 }}>
                  +{pack.edgeAmount.toLocaleString()}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

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
            {isRestoring ? "Restoring..." : "Restore Purchases"}
          </Text>
        </Pressable>
      </ScrollView>

      {/* Confirmation modal */}
      {confirmPack && canRealPurchase && (
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={handleCancelConfirm} />
          <View style={styles.confirmCard}>
            <Text style={styles.confirmHeader}>Confirm Purchase</Text>
            <Text style={styles.confirmPackLabel}>{confirmPack.label}</Text>
            <View style={styles.confirmDetailRow}>
              <Text style={styles.confirmDetailLabel}>Neuron Amount</Text>
              <Text style={[styles.confirmDetailValue, { color: palette.gold }]}>{confirmPack.edgeAmount.toLocaleString()} Neurons</Text>
            </View>
            <View style={styles.confirmDetailRow}>
              <Text style={styles.confirmDetailLabel}>Price</Text>
              <Text style={styles.confirmDetailValue}>
                {confirmRcPkg ? formatPrice(confirmRcPkg) : `$${confirmPack.priceUsd.toFixed(2)} USD`}
              </Text>
            </View>
            <View style={styles.confirmDetailRow}>
              <Text style={styles.confirmDetailLabel}>Expiration</Text>
              <Text style={[styles.confirmDetailValue, { color: palette.success }]}>Never expires</Text>
            </View>
            <View style={styles.confirmActions}>
              <Pressable
                onPress={handleCancelConfirm}
                disabled={purchasing}
                style={({ pressed }) => [styles.confirmCancel, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleConfirmPurchase}
                disabled={purchasing || (rcConfigured && isPurchasing)}
                style={({ pressed }) => [
                  styles.confirmBuy,
                  { backgroundColor: palette.gold },
                  pressed && { opacity: 0.8 },
                  (purchasing || isPurchasing) && styles.disabledBtn,
                ]}
              >
                {(purchasing || isPurchasing) ? (
                  <ActivityIndicator color={palette.void} size="small" />
                ) : (
                  <>
                    <BadgeCheck color={palette.void} size={16} />
                    <Text style={styles.confirmBuyText}>Confirm</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
