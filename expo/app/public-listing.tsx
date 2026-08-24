/**
 * Public Marketplace Listing — external-facing listing preview.
 *
 * Shows safe listing info (EAGOH name, image, vendor, domain, price, metrics)
 * WITHOUT revealing private Open Intelligence content.
 *
 * Buyers must sign in to purchase or sync.
 * Expired/inactive listings show a safe unavailable message.
 */

import { palette } from "@/constants/colors";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import {
  ArrowLeft,
  ArrowRightLeft,
  Coins,
  Crown,
  PackageOpen,
  Shield,
  Signal,
  Sparkles,
  Star,
  TrendingUp,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useHaptics } from "@/hooks/useHaptics";
import type { EagohRecord } from "@/services/eagohs";
import { resolveMarketplaceEagohImage } from "@/services/marketplace";
import { INTELLIGENCE_DOMAINS } from "@/services/domains";
import { getBulkReputations, rankColor as repRankColor, type RankTier } from "@/services/reputation";
import type { ReputationRow } from "@/services/reputation";
import SocialVerifiedBadge from "@/app/_components/SocialVerifiedBadge";
import { getSocialVerificationState } from "@/services/socialVerification";
import PurchaseSyncModal from "@/app/_components/PurchaseSyncModal";
import { getListingById, purchaseSync, type EnrichedListing, type SyncLevel } from "@/services/marketplace";
import { useAuth } from "@/providers/AuthProvider";
import { useEagohs } from "@/providers/EagohProvider";
import { useQueryClient } from "@tanstack/react-query";
import PublicProfileModal from "@/components/PublicProfileModal";

// ── Types ────────────────────────────────────────────────────────────────

type PublicListingData = {
  id: string;
  vendor_id: string;
  eagoh_id: string;
  active: boolean;
  price_25_per_day: number;
  price_50_per_day: number;
  price_75_per_day: number;
  price_100_per_day: number;
  description: string | null;
  created_at: string;
  vendor_username: string | null;
  vendor_avatar_url: string | null;
  vendor_is_verified: boolean;
  vendor_verified_platform: string | null;
  vendor_verified_share_count: number;
  eagoh_name: string;
  eagoh_domain: string | null;
  eagoh_dna: string[] | null;
  eagoh_image_url: string | null;
  eagoh_image_thumb_url: string | null;
  sync_success_score: number;
  avg_quality_score: number;
  rank: string;
  total_sales: number;
};

// ── Main Screen ──────────────────────────────────────────────────────────

export default function PublicListingScreen(): JSX.Element {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const { eagohs } = useEagohs();
  const h = useHaptics();
  const queryClient = useQueryClient();

  const [loading, setLoading] = useState<boolean>(true);
  const [listing, setListing] = useState<PublicListingData | null>(null);
  const [reputation, setReputation] = useState<ReputationRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [purchaseListing, setPurchaseListing] = useState<EnrichedListing | null>(null);
  const [purchasing, setPurchasing] = useState<boolean>(false);
  const [showSourceInfo, setShowSourceInfo] = useState<boolean>(false);
  const [publicProfileVendorId, setPublicProfileVendorId] = useState<string | null>(null);

  // ── Phase D2: purchases require an eligible buyer EAGOH in the listing's
  // domain. Same forged-EAGOH null semantics as the Exchange selector; the
  // Worker re-verifies authoritatively. ──
  const purchaseDomain =
    purchaseListing?.eagoh?.domain ?? purchaseListing?.eagoh?.sport ?? "";
  const eligiblePurchaseEagoh = useMemo<EagohRecord | null>(() => {
    if (!purchaseDomain) return null;
    const eligible = (eagohs ?? []).filter(
      (e) =>
        e.is_default_shell !== true &&
        !(e.is_default_shell === null && e.is_user_forged === false) &&
        e.status !== "dormant" &&
        (e.domain ?? e.sport) === purchaseDomain,
    );
    return eligible[0] ?? null;
  }, [eagohs, purchaseDomain]);

  useEffect(() => {
    if (!listingId) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        // Fetch listing with vendor profile + EAGOH + vendor stats
        const { data, error: dbError } = await supabase
          .from("marketplace_listings")
          .select(`
            id, vendor_id, eagoh_id, active,
            price_25_per_day, price_50_per_day, price_75_per_day, price_100_per_day,
            description, created_at
          `)
          .eq("id", listingId)
          .maybeSingle();

        if (dbError || !data) {
          setError("This listing is no longer available.");
          setLoading(false);
          return;
        }

        const row = data as {
          id: string; vendor_id: string; eagoh_id: string; active: boolean;
          price_25_per_day: number; price_50_per_day: number; price_75_per_day: number; price_100_per_day: number;
          description: string | null; created_at: string;
        };

        // Fetch EAGOH + vendor profile + stats in parallel
        const [eagohRes, vendorRes, statsRes] = await Promise.all([
          supabase
            .from("eagohs")
            .select("name, domain, dna, image_url, image_thumb_url")
            .eq("id", row.eagoh_id)
            .maybeSingle(),
          supabase
            .from("profiles")
            .select("username, avatar_url, is_social_verified, social_verified_platform, verified_share_count")
            .eq("id", row.vendor_id)
            .maybeSingle(),
          supabase
            .from("marketplace_vendor_stats")
            .select("sync_success_score, avg_quality_score, rank, total_sales")
            .eq("vendor_id", row.vendor_id)
            .maybeSingle(),
        ]);

        const eagoh = (eagohRes.data ?? null) as {
          name: string; domain: string | null; dna: string[] | null;
          image_url: string | null; image_thumb_url: string | null;
        } | null;

        const vendor = (vendorRes.data ?? null) as {
          username: string | null; avatar_url: string | null;
          is_social_verified: boolean; social_verified_platform: string | null;
          verified_share_count: number | null;
        } | null;

        const stats = (statsRes.data ?? null) as {
          sync_success_score: number; avg_quality_score: number;
          rank: string; total_sales: number;
        } | null;

        setListing({
          ...row,
          vendor_username: vendor?.username ?? null,
          vendor_avatar_url: vendor?.avatar_url ?? null,
          vendor_is_verified: getSocialVerificationState({
            verified_share_count: vendor?.verified_share_count ?? null,
            is_social_verified: vendor?.is_social_verified ?? false,
          }).isVerified,
          vendor_verified_share_count: vendor?.verified_share_count ?? 0,
          vendor_verified_platform: vendor?.social_verified_platform ?? null,
          eagoh_name: eagoh?.name ?? "Unnamed EAGOH",
          eagoh_domain: eagoh?.domain ?? null,
          eagoh_dna: eagoh?.dna ?? null,
          eagoh_image_url: eagoh?.image_url ?? null,
          eagoh_image_thumb_url: eagoh?.image_thumb_url ?? null,
          sync_success_score: stats?.sync_success_score ?? 0,
          avg_quality_score: stats?.avg_quality_score ?? 0,
          rank: stats?.rank ?? "UNRANKED",
          total_sales: stats?.total_sales ?? 0,
        });

        // Fetch reputation
        const repMap = await getBulkReputations([row.eagoh_id]);
        setReputation(repMap.get(row.eagoh_id) ?? null);
      } catch {
        setError("This listing could not be loaded.");
      } finally {
        setLoading(false);
      }
    })();
  }, [listingId]);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }, [router]);

  const isOwner = !!(user?.id && listing?.vendor_id === user.id);
  const listingActive = listing?.active ?? false;

  const handlePurchase = useCallback(async (): Promise<void> => {
    if (!isAuthenticated) {
      router.replace("/(auth)/login");
      return;
    }
    if (!listingId) return;
    try {
      const enriched = await getListingById(listingId);
      if (!enriched || !enriched.active) {
        Alert.alert("Listing Unavailable", "This Exchange listing is no longer available.");
        return;
      }
      // Fast feedback: block the modal when the user has no eligible EAGOH in
      // the listing's domain (only when the EAGOH list has loaded — the
      // confirm guard remains authoritative as defense-in-depth).
      if (eagohs) {
        const listingDomain = enriched.eagoh?.domain ?? enriched.eagoh?.sport ?? "";
        const hasEligible =
          listingDomain.length > 0 &&
          eagohs.some(
            (e) =>
              e.is_default_shell !== true &&
              !(e.is_default_shell === null && e.is_user_forged === false) &&
              e.status !== "dormant" &&
              (e.domain ?? e.sport) === listingDomain,
          );
        if (!hasEligible) {
          Alert.alert(
            "Domain Requirement",
            "You need an active forged EAGOH in this listing's domain to purchase.",
          );
          return;
        }
      }
      setPurchaseListing(enriched);
    } catch {
      Alert.alert("Error", "Could not load listing details.");
    }
  }, [isAuthenticated, listingId, router, eagohs]);

  const handlePurchaseConfirm = useCallback(async (level: SyncLevel, days: number): Promise<void> => {
    if (!user?.id || !purchaseListing) return;
    // ── Phase D2: an eligible same-domain buyer EAGOH is required. The
    // Worker re-verifies ownership, eligibility, and domain authoritatively. ──
    if (!eligiblePurchaseEagoh || !purchaseDomain) {
      Alert.alert(
        "Domain Requirement",
        "You need an active forged EAGOH in this listing's domain to purchase.",
      );
      setPurchaseListing(null);
      return;
    }
    if (purchaseListing.vendor_id === user.id) {
      Alert.alert("Purchase Not Allowed", "You cannot purchase your own EAGOH listing.");
      setPurchaseListing(null);
      return;
    }
    setPurchasing(true);
    try {
      const result = await purchaseSync(purchaseListing.id, eligiblePurchaseEagoh.id, level, days);
      if (!result.ok) {
        Alert.alert("Purchase Failed", result.error);
      } else {
        h.success();
        Alert.alert("Sync Purchased", `You now have ${level} sync access for ${days} day(s).`);
        setPurchaseListing(null);
        queryClient.invalidateQueries({ queryKey: ["profile"] });
      }
    } catch (err: unknown) {
      Alert.alert("Error", (err as Error).message ?? "Purchase failed.");
    } finally {
      setPurchasing(false);
    }
  }, [user?.id, purchaseListing, eligiblePurchaseEagoh, purchaseDomain, h, queryClient]);

  // ── Loading state ──────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView edges={["top"]} style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={handleBack} style={styles.backBtn}>
            <ArrowLeft color={palette.text} size={18} />
          </Pressable>
        </View>
        <View style={styles.centerState}>
          <ActivityIndicator color={palette.cyan} size="large" />
          <Text style={styles.centerText}>Loading listing…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Error / unavailable state ──────────────────────────────────────

  if (error || !listing) {
    return (
      <SafeAreaView edges={["top"]} style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={handleBack} style={styles.backBtn}>
            <ArrowLeft color={palette.text} size={18} />
          </Pressable>
        </View>
        <View style={styles.centerState}>
          <PackageOpen color={palette.muted} size={40} />
          <Text style={styles.centerTitle}>Unavailable</Text>
          <Text style={styles.centerText}>
            {error ?? "This listing is no longer available."}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Listing preview ────────────────────────────────────────────────

  const eagohRank: RankTier = (reputation?.rank as RankTier) ?? "Dormant";
  const rkColor = repRankColor(eagohRank);
  const repScore = reputation?.reputation_score ?? 0;
  const imageUrl = resolveMarketplaceEagohImage({
    image_url: listing.eagoh_image_url,
    image_thumb_url: listing.eagoh_image_thumb_url,
  });
  const domainLabel = listing.eagoh_domain
    ? INTELLIGENCE_DOMAINS.find((d) => d.id === listing.eagoh_domain)?.label ?? listing.eagoh_domain
    : "Unknown";
  const minPrice = [listing.price_25_per_day, listing.price_50_per_day, listing.price_75_per_day, listing.price_100_per_day]
    .filter((p) => p > 0)
    .sort((a, b) => a - b)[0];
  const isActive = listing.active;

  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={handleBack} style={styles.backBtn}>
          <ArrowLeft color={palette.text} size={18} />
        </Pressable>
        <Text style={styles.headerTitle}>EAGOH Listing</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* EAGOH image */}
        <View style={styles.imageSection}>
          <LinearGradient
            colors={["#03060B", `${rkColor}14`, "#050D18"]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.imageWrap}>
            {imageUrl ? (
              <Image
                source={{ uri: imageUrl }}
                style={styles.eagohImage}
                contentFit="contain"
                cachePolicy="memory-disk"
              />
            ) : (
              <View style={styles.imagePlaceholder}>
                <Crown color={rkColor} size={36} />
                <Text style={styles.imagePlaceholderText}>{listing.eagoh_name.slice(0, 2).toUpperCase()}</Text>
              </View>
            )}
          </View>
          {/* Domain badge */}
          <View style={styles.domainBadge}>
            <Text style={styles.domainBadgeText}>{domainLabel}</Text>
          </View>
          {/* Status badge */}
          {!isActive && (
            <View style={styles.inactiveBadge}>
              <Text style={styles.inactiveBadgeText}>INACTIVE</Text>
            </View>
          )}
        </View>

        {/* EAGOH name + rank */}
        <View style={styles.nameSection}>
          <Text style={styles.eagohName}>{listing.eagoh_name}</Text>
          {repScore > 0 && (
            <View style={[styles.rankPill, { borderColor: `${rkColor}44`, backgroundColor: `${rkColor}14` }]}>
              <Crown color={rkColor} size={12} />
              <Text style={[styles.rankPillText, { color: rkColor }]}>{eagohRank} · {repScore}</Text>
            </View>
          )}
        </View>

        {/* DNA tags */}
        {listing.eagoh_dna && listing.eagoh_dna.length > 0 && (
          <View style={styles.dnaRow}>
            {listing.eagoh_dna.slice(0, 4).map((d) => (
              <View key={d} style={styles.dnaTag}>
                <Text style={styles.dnaTagText}>{d}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Description */}
        {listing.description ? (
          <View style={styles.descCard}>
            <Text style={styles.descText}>{listing.description}</Text>
          </View>
        ) : null}

        {/* Vendor info */}
        <View style={styles.vendorCard}>
          <View style={styles.vendorAvatar}>
            {listing.vendor_avatar_url ? (
              <Image source={{ uri: listing.vendor_avatar_url }} style={styles.avatarImg} contentFit="cover" />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitials}>
                  {(listing.vendor_username ?? "E").slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.vendorInfo}>
            <View style={styles.vendorNameRow}>
              <Text style={styles.vendorName}>{listing.vendor_username ?? "Anonymous"}</Text>
              {listing.vendor_is_verified && (
                <SocialVerifiedBadge
                  isVerified={listing.vendor_is_verified}
                  variant="iconOnly"
                  iconSize={14}
                />
              )}
            </View>
            <Text style={styles.vendorRank}>{listing.rank} · {listing.total_sales} sales</Text>
          </View>
        </View>

        {/* Metrics */}
        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Signal color={palette.success} size={14} />
            <Text style={styles.metricValue}>{listing.sync_success_score}</Text>
            <Text style={styles.metricLabel}>Sync Score</Text>
          </View>
          <View style={styles.metricCard}>
            <Sparkles color={palette.cyan} size={14} />
            <Text style={styles.metricValue}>{Math.round(listing.avg_quality_score)}</Text>
            <Text style={styles.metricLabel}>Quality</Text>
          </View>
          <View style={styles.metricCard}>
            <TrendingUp color={palette.gold} size={14} />
            <Text style={styles.metricValue}>{listing.total_sales}</Text>
            <Text style={styles.metricLabel}>Sales</Text>
          </View>
        </View>

        {/* Pricing */}
        <View style={styles.pricingCard}>
          <Text style={styles.pricingTitle}>Sync Options</Text>
          <View style={styles.priceGrid}>
            {(["25%", "50%", "75%", "100%"] as const).map((level) => {
              const price = level === "25%" ? listing.price_25_per_day
                : level === "50%" ? listing.price_50_per_day
                : level === "75%" ? listing.price_75_per_day
                : listing.price_100_per_day;
              if (price <= 0) return null;
              return (
                <View key={level} style={styles.priceCell}>
                  <Text style={styles.priceLevel}>{level}</Text>
                  <Text style={styles.priceValue}>{price} EC/day</Text>
                </View>
              );
            })}
          </View>
          {minPrice ? (
            <Text style={styles.minPrice}>From {minPrice} Neurons/day</Text>
          ) : (
            <Text style={styles.minPrice}>Free</Text>
          )}
        </View>

        {/* Privacy notice */}
        <View style={styles.privacyCard}>
          <Shield color={palette.muted} size={14} />
          <Text style={styles.privacyText}>
            Open Intelligence content is locked. Sign in to purchase sync access and unlock this EAGOH's full intelligence.
          </Text>
        </View>

        {/* CTA button */}
        {!isAuthenticated ? (
          <Pressable
            onPress={() => router.replace("/(auth)/login")}
            style={({ pressed }) => [styles.ctaBtn, pressed && { opacity: 0.85 }]}
          >
            <LinearGradient
              colors={[palette.cyan, `${palette.cyan}cc`]}
              style={StyleSheet.absoluteFill}
            />
            <Text style={styles.ctaText}>Sign in to Access</Text>
          </Pressable>
        ) : isOwner ? (
          <View style={[styles.ctaBtn, styles.ctaBtnDisabled]}>
            <Text style={[styles.ctaText, { color: palette.muted }]}>Your Listing</Text>
          </View>
        ) : !listingActive ? (
          <View style={[styles.ctaBtn, styles.ctaBtnDisabled]}>
            <Text style={[styles.ctaText, { color: palette.muted, fontSize: 13 }]}>This Exchange listing is no longer available.</Text>
          </View>
        ) : (
          <Pressable
            onPress={handlePurchase}
            style={({ pressed }) => [styles.ctaBtn, pressed && { opacity: 0.85 }]}
          >
            <LinearGradient
              colors={[palette.cyan, `${palette.cyan}cc`]}
              style={StyleSheet.absoluteFill}
            />
            <ArrowRightLeft color={palette.void} size={17} />
            <Text style={styles.ctaText}>Purchase</Text>
          </Pressable>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      <PurchaseSyncModal
        visible={!!purchaseListing}
        listing={purchaseListing}
        buyerInfo={
          purchaseListing && eligiblePurchaseEagoh
            ? { name: eligiblePurchaseEagoh.name, domain: purchaseDomain }
            : null
        }
        onClose={() => { setPurchaseListing(null); setShowSourceInfo(false); }}
        onConfirm={handlePurchaseConfirm}
        showSourceInfo={showSourceInfo}
        onToggleSourceInfo={() => setShowSourceInfo((v) => !v)}
        purchasing={purchasing}
        reputation={reputation ?? undefined}
        onViewVendorProfile={(vendorId) => {
          setPurchaseListing(null);
          setShowSourceInfo(false);
          setPublicProfileVendorId(vendorId);
        }}
      />
      <PublicProfileModal
        visible={!!publicProfileVendorId}
        userId={publicProfileVendorId}
        currentUserId={user?.id ?? null}
        onClose={() => setPublicProfileVendorId(null)}
      />
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.void },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
    gap: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { color: palette.text, fontSize: 16, fontWeight: "900" as const },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 14 },

  // Image section
  imageSection: {
    height: 240,
    borderRadius: 10,
    overflow: "hidden" as const,
    borderWidth: 1,
    borderColor: palette.line,
    position: "relative" as const,
  },
  imageWrap: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const },
  eagohImage: { width: "80%", height: "80%" },
  imagePlaceholder: { alignItems: "center" as const, gap: 8 },
  imagePlaceholderText: { color: palette.muted, fontSize: 13, fontWeight: "800" as const },
  domainBadge: {
    position: "absolute" as const,
    top: 10,
    left: 10,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  domainBadgeText: { color: palette.cyan, fontSize: 10, fontWeight: "800" as const },
  inactiveBadge: {
    position: "absolute" as const,
    top: 10,
    right: 10,
    backgroundColor: palette.ember,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  inactiveBadgeText: { color: palette.void, fontSize: 10, fontWeight: "900" as const },

  // Name section
  nameSection: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: 10,
  },
  eagohName: { color: palette.text, fontSize: 22, fontWeight: "900" as const, flex: 1 },
  rankPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  rankPillText: { fontSize: 11, fontWeight: "900" as const },

  // DNA tags
  dnaRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
  dnaTag: {
    backgroundColor: "rgba(108,230,255,0.08)",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(108,230,255,0.15)",
  },
  dnaTagText: { color: palette.cyan, fontSize: 10, fontWeight: "700" as const },

  // Description
  descCard: {
    backgroundColor: "rgba(255,255,255,0.03)" as const,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 14,
  },
  descText: { color: palette.text, fontSize: 14, fontWeight: "500" as const, lineHeight: 20 },

  // Vendor
  vendorCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.03)" as const,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 14,
  },
  vendorAvatar: { width: 44, height: 44, borderRadius: 22, overflow: "hidden" as const },
  avatarImg: { width: "100%", height: "100%" },
  avatarFallback: {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: "rgba(108,230,255,0.12)",
  },
  avatarInitials: { color: palette.cyan, fontSize: 18, fontWeight: "900" as const },
  vendorInfo: { flex: 1, gap: 2 },
  vendorNameRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  vendorName: { color: palette.text, fontSize: 15, fontWeight: "800" as const },
  vendorRank: { color: palette.muted, fontSize: 11, fontWeight: "600" as const },

  // Metrics
  metricsRow: { flexDirection: "row" as const, gap: 8 },
  metricCard: {
    flex: 1,
    alignItems: "center" as const,
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.03)" as const,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    paddingVertical: 14,
  },
  metricValue: { color: palette.text, fontSize: 18, fontWeight: "900" as const },
  metricLabel: { color: palette.muted, fontSize: 10, fontWeight: "700" as const },

  // Pricing
  pricingCard: {
    backgroundColor: "rgba(255,204,68,0.04)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,204,68,0.15)",
    padding: 16,
    gap: 10,
  },
  pricingTitle: { color: palette.gold, fontSize: 13, fontWeight: "900" as const },
  priceGrid: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
  priceCell: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  priceLevel: { color: palette.muted, fontSize: 10, fontWeight: "800" as const },
  priceValue: { color: palette.text, fontSize: 14, fontWeight: "900" as const },
  minPrice: { color: palette.gold, fontSize: 13, fontWeight: "800" as const },

  // Privacy
  privacyCard: {
    flexDirection: "row" as const,
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.02)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 12,
  },
  privacyText: { color: palette.muted, fontSize: 12, fontWeight: "500" as const, lineHeight: 17, flex: 1 },

  // CTA
  ctaBtn: {
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center" as const,
    overflow: "hidden" as const,
    marginTop: 4,
  },
  ctaText: { color: palette.void, fontSize: 16, fontWeight: "900" as const },
  ctaBtnDisabled: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: palette.line,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
  },

  // Center states
  centerState: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, padding: 40, gap: 14 },
  centerTitle: { color: palette.text, fontSize: 18, fontWeight: "900" as const, textAlign: "center" as const },
  centerText: { color: palette.muted, fontSize: 13, fontWeight: "600" as const, textAlign: "center" as const, lineHeight: 19 },
});
