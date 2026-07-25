/**
 * PublicProfileModal — reusable modal that loads and displays a user's
 * public-safe profile information. Used from Profile (self-preview),
 * Exchange listing cards (vendor avatar), and Purchase Sync (vendor name).
 *
 * Never shows: email, subscription tier, Neuron balances, payment info,
 * private credentials, private EAGOHs, or authentication details.
 */
import { palette } from "@/constants/colors";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Dimensions,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  ArrowLeft,
  Award,
  BadgeCheck,
  BookOpen,
  BrainCircuit,
  Clock,
  Coins,
  Crown,
  Globe,
  Shield,
  TrendingUp,
  User,
  X,
  Zap,
} from "lucide-react-native";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  getPublicProfile,
  getPublicSocialAccounts,
  getPublicEagohs,
  getPublicListings,
  type PublicProfileLoadResult,
  type PublicProfileData,
  type PublicSocialAccount,
  type PublicEagohSummary,
  type PublicListingSummary,
} from "@/services/publicProfile";
import { INTELLIGENCE_DOMAINS } from "@/services/domains";
import { PLATFORM_DISPLAY, PLATFORM_BASE_URL, type SocialPlatform } from "@/services/socialVerification";
import { rankColor as repRankColor } from "@/services/reputation";
import { Linking } from "react-native";

// ── Props ──────────────────────────────────────────────────────────────

export type PublicProfileModalProps = {
  visible: boolean;
  userId: string | null;
  /** Authenticated user's ID, used to determine if profile belongs to self. Pass from caller to avoid consuming context inside React Native Modal. */
  currentUserId?: string | null;
  onClose: () => void;
};

// ── Vendor stats import (circumvents dependency) ───────────────────────

async function getPublicVendorStats(userId: string): Promise<{
  totalSales: number;
  rank: string;
  syncSuccessScore: number;
} | null> {
  try {
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase
      .from("marketplace_vendor_stats")
      .select("total_sales, rank, sync_success_score")
      .eq("vendor_id", userId)
      .maybeSingle();
    if (!data) return null;
    const row = data as { total_sales: number; rank: string; sync_success_score: number };
    return {
      totalSales: row.total_sales ?? 0,
      rank: row.rank ?? "UNRANKED",
      syncSuccessScore: row.sync_success_score ?? 0,
    };
  } catch {
    return null;
  }
}

// ── Styles ─────────────────────────────────────────────────────────────

const { height: WINDOW_HEIGHT } = Dimensions.get("window");
const SHEET_HEIGHT = WINDOW_HEIGHT * 0.8;

// ── Swipe dismiss thresholds ─────────────────────────────────────────
const DISMISS_THRESHOLD = 100;
const DISMISS_VELOCITY_THRESHOLD = 0.5;

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    elevation: 9999,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(3,6,11,0.88)",
    zIndex: 1,
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_HEIGHT,
    maxHeight: SHEET_HEIGHT,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden" as const,
    backgroundColor: palette.void,
    borderWidth: 1,
    borderColor: "rgba(54,245,255,0.14)",
    borderBottomWidth: 0,
    zIndex: 2,
    elevation: 2,
  },
  handleArea: {
    alignItems: "center" as const,
    paddingTop: 10,
    paddingBottom: 6,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(54,245,255,0.35)",
  },
  header: {
    height: 60,
    minHeight: 60,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
    backgroundColor: "rgba(10,20,38,0.98)",
    zIndex: 100,
    elevation: 100,
    position: "relative" as const,
  },
  headerTitle: {
    color: palette.text,
    fontSize: 15,
    fontWeight: "900" as const,
    letterSpacing: 0.8,
  },
  closeBtn: {
    position: "absolute" as const,
    right: 12,
    top: 8,
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: palette.line,
    zIndex: 200,
    elevation: 200,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 60 },

  // Banner
  banner: {
    height: 140,
    backgroundColor: palette.graphite,
    overflow: "hidden" as const,
  },
  bannerImage: { width: "100%", height: "100%" },
  bannerFallback: {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: palette.graphite,
    gap: 4,
  },
  bannerFallbackText: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 1.5,
    textTransform: "uppercase" as const,
  },

  // Avatar
  avatarWrap: {
    alignItems: "center" as const,
    marginTop: -44,
    marginBottom: 10,
  },
  avatarCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 3,
    borderColor: palette.void,
    backgroundColor: palette.panel,
    overflow: "hidden" as const,
  },
  avatarImage: { width: "100%", height: "100%" },
  avatarFallback: {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: palette.blueSoft,
  },

  // Identity
  identityCard: {
    marginHorizontal: 16,
    borderRadius: 5,
    backgroundColor: palette.panel,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 14,
    gap: 6,
  },
  usernameRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  username: {
    color: palette.text,
    fontSize: 18,
    fontWeight: "900" as const,
  },
  displayName: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: "700" as const,
  },
  verifiedBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: palette.cyanSoft,
    borderWidth: 1,
    borderColor: palette.cyan,
  },
  verifiedBadgeText: {
    color: palette.cyan,
    fontSize: 9,
    fontWeight: "800" as const,
  },
  publicTitle: {
    color: palette.cyan,
    fontSize: 12,
    fontWeight: "700" as const,
  },
  bio: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: "600" as const,
    lineHeight: 18,
    marginTop: 4,
  },

  // Self label
  selfLabel: {
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 5,
    backgroundColor: palette.cyanSoft,
    borderWidth: 1,
    borderColor: palette.cyan,
    alignSelf: "flex-start" as const,
  },
  selfLabelText: {
    color: palette.cyan,
    fontSize: 10,
    fontWeight: "800" as const,
    letterSpacing: 0.5,
  },

  // Privacy notice
  privacyBanner: {
    marginHorizontal: 16,
    marginTop: 8,
    padding: 10,
    borderRadius: 5,
    backgroundColor: palette.emberSoft,
    borderWidth: 1,
    borderColor: `${palette.ember}33`,
  },
  privacyBannerText: {
    color: palette.ember,
    fontSize: 10,
    fontWeight: "700" as const,
    textAlign: "center" as const,
  },

  // Section
  section: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 5,
    backgroundColor: palette.panel,
    borderWidth: 1,
    borderColor: palette.line,
    overflow: "hidden" as const,
  },
  sectionHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
    backgroundColor: palette.blueSoft,
  },
  sectionHeaderText: {
    color: palette.text,
    fontSize: 12,
    fontWeight: "900" as const,
    letterSpacing: 0.7,
    textTransform: "uppercase" as const,
  },
  sectionBody: { padding: 12, gap: 8 },

  // Stat row
  statRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
  statLabel: {
    color: palette.muted,
    fontSize: 11,
    fontWeight: "700" as const,
  },
  statValue: {
    color: palette.text,
    fontSize: 12,
    fontWeight: "800" as const,
  },

  // Domain chips
  domainChipWrap: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 6,
  },
  domainChip: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 5,
    backgroundColor: palette.blueSoft,
    borderWidth: 1,
    borderColor: palette.line,
  },
  domainChipText: {
    color: palette.blue,
    fontSize: 10,
    fontWeight: "800" as const,
  },

  // Social links
  socialRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingVertical: 4,
  },
  socialName: {
    color: palette.text,
    fontSize: 11,
    fontWeight: "700" as const,
    textTransform: "capitalize" as const,
  },
  socialHandle: {
    color: palette.cyan,
    fontSize: 10,
    fontWeight: "600" as const,
    flex: 1,
  },

  // EAGOH card
  eagohCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    padding: 9,
    borderRadius: 5,
    backgroundColor: palette.obsidian,
    borderWidth: 1,
    borderColor: palette.line,
  },
  eagohThumb: {
    width: 38,
    height: 38,
    borderRadius: 5,
    backgroundColor: palette.graphite,
    overflow: "hidden" as const,
  },
  eagohThumbImage: { width: "100%", height: "100%" },
  eagohName: {
    color: palette.text,
    fontSize: 12,
    fontWeight: "800" as const,
    flex: 1,
  },
  eagohRank: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: "700" as const,
  },

  // Listing card
  listingCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    padding: 8,
    borderRadius: 5,
    backgroundColor: palette.obsidian,
    borderWidth: 1,
    borderColor: palette.line,
  },
  listingName: {
    color: palette.text,
    fontSize: 11,
    fontWeight: "700" as const,
    flex: 1,
  },
  listingPrice: {
    color: palette.gold,
    fontSize: 11,
    fontWeight: "800" as const,
  },

  // Empty
  emptyText: {
    color: palette.muted,
    fontSize: 11,
    fontWeight: "600" as const,
    textAlign: "center" as const,
    paddingVertical: 6,
  },

  // Loading / Error
  centerWrap: {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 12,
    padding: 20,
  },
  errorText: {
    color: palette.ember,
    fontSize: 13,
    fontWeight: "700" as const,
    textAlign: "center" as const,
  },
  retryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.cyan,
    backgroundColor: palette.cyanSoft,
  },
  retryBtnText: {
    color: palette.cyan,
    fontSize: 11,
    fontWeight: "800" as const,
  },
});

// ── Sub-components ─────────────────────────────────────────────────────

const SectionHeader = memo(function SectionHeader({
  title,
  icon,
}: {
  title: string;
  icon: React.ReactNode;
}): JSX.Element {
  return (
    <View style={styles.sectionHeader}>
      {icon}
      <Text style={styles.sectionHeaderText}>{title}</Text>
    </View>
  );
});

// ── Main Component ─────────────────────────────────────────────────────

export default function PublicProfileModal({
  visible,
  userId,
  currentUserId,
  onClose,
}: PublicProfileModalProps): JSX.Element | null {
  const isSelf = !!(currentUserId && userId && currentUserId === userId);

  // Clear state when userId changes or modal opens
  const [profile, setProfile] = useState<PublicProfileData | null>(null);
  const [socialAccounts, setSocialAccounts] = useState<PublicSocialAccount[]>([]);
  const [eagohs, setEagohs] = useState<PublicEagohSummary[]>([]);
  const [listings, setListings] = useState<PublicListingSummary[]>([]);
  const [vendorStats, setVendorStats] = useState<{
    totalSales: number;
    rank: string;
    syncSuccessScore: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shared profile loader — used by both useEffect and Retry
  const loadProfile = useCallback(async (uid: string) => {
    setLoading(true);
    setError(null);

    // Clear previous profile data immediately to avoid flash
    setProfile(null);
    setSocialAccounts([]);
    setEagohs([]);
    setListings([]);
    setVendorStats(null);

    try {
      // Base profile query — REQUIRED; its result drives the UI state
      const profileResult: PublicProfileLoadResult = await getPublicProfile(uid, isSelf);

      // Launch optional queries in parallel (best-effort — failures don't block the profile)
      const [socials, eagohData, listingData, vendorData] = await Promise.all([
        getPublicSocialAccounts(uid).catch(() => [] as PublicSocialAccount[]),
        getPublicEagohs(uid).catch(() => [] as PublicEagohSummary[]),
        getPublicListings(uid).catch(() => [] as PublicListingSummary[]),
        getPublicVendorStats(uid).catch(() => null),
      ]);

      // Always set optional data — it may be empty but won't block
      setSocialAccounts(socials);
      setEagohs(eagohData);
      setListings(listingData);
      setVendorStats(vendorData);

      switch (profileResult.status) {
        case "success":
          setProfile(profileResult.profile);
          break;
        case "not_found":
          setError("This public profile has not been created.");
          break;
        case "hidden":
          setError("This user's public profile is private.");
          break;
        case "forbidden":
          setError("This profile cannot be viewed.");
          break;
        case "error":
          setError(profileResult.message);
          break;
      }
    } catch {
      setError("Public profile could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [isSelf]);

  // Guard against stale state updates after close or userId change
  useEffect(() => {
    if (!visible || !userId) {
      if (!visible) {
        setProfile(null);
        setSocialAccounts([]);
        setEagohs([]);
        setListings([]);
        setVendorStats(null);
        setError(null);
      }
      return;
    }

    let cancelled = false;

    (async () => {
      // Use the shared loader
      setLoading(true);
      setError(null);
      setProfile(null);
      setSocialAccounts([]);
      setEagohs([]);
      setListings([]);
      setVendorStats(null);

      try {
        const profileResult: PublicProfileLoadResult = await getPublicProfile(userId, isSelf);
        if (cancelled) return;

        const [socials, eagohData, listingData, vendorData] = await Promise.all([
          getPublicSocialAccounts(userId).catch(() => [] as PublicSocialAccount[]),
          getPublicEagohs(userId).catch(() => [] as PublicEagohSummary[]),
          getPublicListings(userId).catch(() => [] as PublicListingSummary[]),
          getPublicVendorStats(userId).catch(() => null),
        ]);
        if (cancelled) return;

        setSocialAccounts(socials);
        setEagohs(eagohData);
        setListings(listingData);
        setVendorStats(vendorData);

        switch (profileResult.status) {
          case "success":
            setProfile(profileResult.profile);
            break;
          case "not_found":
            setError("This public profile has not been created.");
            break;
          case "hidden":
            setError("This user's public profile is private.");
            break;
          case "forbidden":
            setError("This profile cannot be viewed.");
            break;
          case "error":
            setError(profileResult.message);
            break;
        }
      } catch {
        if (!cancelled) setError("Public profile could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [visible, userId, isSelf]);

  // Retry calls the shared loader
  const handleRetry = useCallback(() => {
    if (!userId) return;
    loadProfile(userId);
  }, [userId, loadProfile]);

  const handleSocialPress = useCallback((url: string) => {
    Linking.openURL(url).catch(() => undefined);
  }, []);

  // Derive active domains from EAGOHs
  const activeDomains = useMemo(() => {
    const set = new Set<string>();
    for (const e of eagohs) {
      const domainId = e.domain ?? "unknown";
      const info = INTELLIGENCE_DOMAINS.find((d) => d.id === domainId);
      if (info) set.add(info.label);
    }
    return [...set];
  }, [eagohs]);

  // Vendor rank color
  const vendorRankColor = vendorStats?.rank
    ? repRankColor(vendorStats.rank as Parameters<typeof repRankColor>[0])
    : palette.muted;

  // ── Safe area insets ──────────────────────────────────────────────
  const insets = useSafeAreaInsets();

  // ── Swipe-down dismissal ──────────────────────────────────────────
  const translateY = useRef(new Animated.Value(0)).current;
  const isDismissing = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gestureState) => {
        // Only capture downward vertical gestures that are clearly vertical
        return gestureState.dy > 8 && Math.abs(gestureState.dx) < Math.abs(gestureState.dy) * 0.5;
      },
      onPanResponderGrant: () => {
        isDismissing.current = false;
      },
      onPanResponderMove: (_evt, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_evt, gestureState) => {
        if (gestureState.dy > DISMISS_THRESHOLD || gestureState.vy > DISMISS_VELOCITY_THRESHOLD) {
          isDismissing.current = true;
          Animated.timing(translateY, {
            toValue: WINDOW_HEIGHT,
            duration: 220,
            useNativeDriver: true,
          }).start(() => {
            translateY.setValue(0);
            isDismissing.current = false;
            onClose();
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 4,
            speed: 14,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 4,
          speed: 14,
        }).start();
      },
    }),
  ).current;

  // Reset translateY when modal opens/closes
  useEffect(() => {
    if (visible) {
      translateY.setValue(0);
    }
  }, [visible, translateY]);

  // ── Android back button ────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  // ── Close handler (for X button and backdrop) ──────────────────────
  const handleCloseWithAnimation = useCallback(() => {
    if (isDismissing.current) return;
    isDismissing.current = true;
    Animated.timing(translateY, {
      toValue: WINDOW_HEIGHT,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      translateY.setValue(0);
      isDismissing.current = false;
      onClose();
    });
  }, [translateY, onClose]);

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      {/* Backdrop — zIndex 1, absolutely positioned. Receives taps outside the sheet. */}
      <Pressable
        style={styles.backdrop}
        onPress={handleCloseWithAnimation}
      />

      {/* Sheet — zIndex 2 (above backdrop). Absolutely positioned at bottom. */}
      <Animated.View
        style={[
          styles.sheet,
          { transform: [{ translateY }] },
        ]}
      >
        {/* Drag handle + dismiss area */}
        <View {...panResponder.panHandlers}>
          <View style={styles.handleArea}>
            <View style={styles.handle} />
          </View>
        </View>

        {/* Fixed header — z-elevated above content, never overlapped by ScrollView */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {error ? "Profile Unavailable" : "Public Profile"}
          </Text>
          <Pressable
            onPress={handleCloseWithAnimation}
            style={({ pressed }) => [
              styles.closeBtn,
              pressed && { opacity: 0.7, backgroundColor: "rgba(54,245,255,0.1)" },
            ]}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Close public profile"
          >
            <X color={palette.muted} size={22} />
          </Pressable>
        </View>

        {/* Content */}
        {loading ? (
          <View style={styles.centerWrap}>
            <ActivityIndicator color={palette.cyan} size="large" />
          </View>
        ) : error ? (
          <View style={styles.centerWrap}>
            <Shield color={palette.ember} size={36} />
            <Text style={styles.errorText}>{error}</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable onPress={handleRetry} style={styles.retryBtn}>
                <Text style={styles.retryBtnText}>Retry</Text>
              </Pressable>
              <Pressable onPress={handleCloseWithAnimation} style={[styles.retryBtn, { borderColor: palette.line, backgroundColor: "transparent" }]}>
                <Text style={[styles.retryBtnText, { color: palette.muted }]}>Close</Text>
              </Pressable>
            </View>
          </View>
        ) : profile ? (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
              {/* Banner */}
              <View style={styles.banner}>
                {profile.bannerUrl ? (
                  <Image source={{ uri: profile.bannerUrl }} style={styles.bannerImage} contentFit="cover" />
                ) : (
                  <LinearGradient
                    colors={[palette.graphite, palette.obsidian, palette.void]}
                    style={styles.bannerFallback}
                  >
                    <Shield color={palette.muted} size={28} />
                    <Text style={styles.bannerFallbackText}>EAGOH Network</Text>
                  </LinearGradient>
                )}
              </View>

              {/* Avatar */}
              <View style={styles.avatarWrap}>
                <View style={styles.avatarCircle}>
                  {profile.avatarUrl ? (
                    <Image source={{ uri: profile.avatarUrl }} style={styles.avatarImage} contentFit="cover" />
                  ) : (
                    <View style={styles.avatarFallback}>
                      <User color={palette.blue} size={32} />
                    </View>
                  )}
                </View>
              </View>

              {/* Self label */}
              {isSelf && (
                <View style={styles.selfLabel}>
                  <Text style={styles.selfLabelText}>This is your public profile</Text>
                </View>
              )}

              {/* Privacy hidden notice (for self-view only) */}
              {isSelf && profile.publicProfileEnabled === false && (
                <View style={styles.privacyBanner}>
                  <Text style={styles.privacyBannerText}>
                    Your public profile is currently hidden from other users.
                  </Text>
                </View>
              )}

              {/* Identity */}
              <View style={styles.identityCard}>
                <View style={styles.usernameRow}>
                  <Text style={styles.username}>
                    {profile.displayName || profile.username || "Anonymous Analyst"}
                  </Text>
                  {profile.isSocialVerified && (
                    <View style={styles.verifiedBadge}>
                      <BadgeCheck color={palette.cyan} size={12} />
                      <Text style={styles.verifiedBadgeText}>Verified</Text>
                    </View>
                  )}
                </View>

                {profile.username && profile.displayName && (
                  <Text style={styles.displayName}>@{profile.username}</Text>
                )}

                {profile.publicDisplayTitle ? (
                  <Text style={styles.publicTitle}>{profile.publicDisplayTitle}</Text>
                ) : null}

                {profile.bio ? (
                  <Text style={styles.bio}>{profile.bio}</Text>
                ) : (
                  <Text style={styles.emptyText}>This user has not added a public bio.</Text>
                )}
              </View>

              {/* Stats overview */}
              <View style={styles.section}>
                <SectionHeader
                  title="Overview"
                  icon={<TrendingUp color={palette.cyan} size={14} />}
                />
                <View style={styles.sectionBody}>
                  <View style={styles.statRow}>
                    <Text style={styles.statLabel}>EAGOHs</Text>
                    <Text style={styles.statValue}>{eagohs.length}</Text>
                  </View>

                  {vendorStats && (
                    <>
                      <View style={styles.statRow}>
                        <Text style={styles.statLabel}>Vendor Rank</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <Award color={vendorRankColor} size={13} />
                          <Text style={[styles.statValue, { color: vendorRankColor }]}>
                            {vendorStats.rank}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.statRow}>
                        <Text style={styles.statLabel}>Sync Sales</Text>
                        <Text style={styles.statValue}>{vendorStats.totalSales}</Text>
                      </View>
                      {vendorStats.syncSuccessScore > 0 && (
                        <View style={styles.statRow}>
                          <Text style={styles.statLabel}>Sync Success</Text>
                          <Text style={styles.statValue}>{vendorStats.syncSuccessScore}%</Text>
                        </View>
                      )}
                    </>
                  )}

                  {profile.joinedAt && (
                    <View style={styles.statRow}>
                      <Text style={styles.statLabel}>Joined</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Clock color={palette.muted} size={12} />
                        <Text style={styles.statValue}>
                          {new Date(profile.joinedAt).toLocaleDateString()}
                        </Text>
                      </View>
                    </View>
                  )}
                </View>
              </View>

              {/* Active Domains */}
              {activeDomains.length > 0 && (
                <View style={styles.section}>
                  <SectionHeader
                    title="Active Domains"
                    icon={<Globe color={palette.blue} size={14} />}
                  />
                  <View style={styles.sectionBody}>
                    <View style={styles.domainChipWrap}>
                      {activeDomains.map((domain) => (
                        <View key={domain} style={styles.domainChip}>
                          <Text style={styles.domainChipText}>{domain}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </View>
              )}

              {/* Social Accounts */}
              {socialAccounts.length > 0 && (
                <View style={styles.section}>
                  <SectionHeader
                    title="Connected Accounts"
                    icon={<BadgeCheck color={palette.cyan} size={14} />}
                  />
                  <View style={styles.sectionBody}>
                    {socialAccounts.map((account) => (
                      <Pressable
                        key={account.platform}
                        onPress={() => {
                          if (account.profileUrl) handleSocialPress(account.profileUrl);
                        }}
                        style={styles.socialRow}
                      >
                        <Text style={styles.socialName}>
                          {PLATFORM_DISPLAY[account.platform as SocialPlatform] ?? account.platform}
                        </Text>
                        <Text style={styles.socialHandle}>{account.handle ?? ""}</Text>
                        {account.isPlatformVerified && (
                          <BadgeCheck color={palette.cyan} size={12} />
                        )}
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}

              {/* Public EAGOHs */}
              <View style={styles.section}>
                <SectionHeader
                  title="Public EAGOHs"
                  icon={<Crown color={palette.gold} size={14} />}
                />
                <View style={styles.sectionBody}>
                  {eagohs.length > 0 ? (
                    eagohs.map((eagoh) => (
                      <View key={eagoh.id} style={styles.eagohCard}>
                        <View style={styles.eagohThumb}>
                          {eagoh.imageThumbUrl ? (
                            <Image
                              source={{ uri: eagoh.imageThumbUrl }}
                              style={styles.eagohThumbImage}
                              contentFit="cover"
                            />
                          ) : (
                            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                              <Zap color={palette.muted} size={16} />
                            </View>
                          )}
                        </View>
                        <Text style={styles.eagohName} numberOfLines={1}>
                          {eagoh.name}
                        </Text>
                        <Text
                          style={[
                            styles.eagohRank,
                            {
                              color:
                                repRankColor(eagoh.rank as Parameters<typeof repRankColor>[0]) ??
                                palette.muted,
                            },
                          ]}
                        >
                          {eagoh.rank}
                        </Text>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.emptyText}>No public EAGOHs available.</Text>
                  )}
                </View>
              </View>

              {/* Exchange Listings */}
              <View style={styles.section}>
                <SectionHeader
                  title="Exchange Listings"
                  icon={<Coins color={palette.gold} size={14} />}
                />
                <View style={styles.sectionBody}>
                  {listings.length > 0 ? (
                    listings.map((listing) => (
                      <View key={listing.id} style={styles.listingCard}>
                        <Text style={styles.listingName} numberOfLines={1}>
                          {listing.eagohName}
                        </Text>
                        {listing.minPrice > 0 && (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                            <Coins color={palette.gold} size={10} />
                            <Text style={styles.listingPrice}>From {listing.minPrice} EC/day</Text>
                          </View>
                        )}
                      </View>
                    ))
                  ) : (
                    <Text style={styles.emptyText}>No active Exchange listings.</Text>
                  )}
                </View>
              </View>

              {/* Credentials indicator */}
              <View style={[styles.section, { marginBottom: 30 }]}>
                <SectionHeader
                  title="Knowledge Credentials"
                  icon={<BrainCircuit color={palette.gold} size={14} />}
                />
                <View style={styles.sectionBody}>
                  <Text style={styles.emptyText}>No public credentials added.</Text>
                </View>
              </View>
            </ScrollView>
          ) : null}
      </Animated.View>
    </View>
  );
}
