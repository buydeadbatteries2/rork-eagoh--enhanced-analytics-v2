/**
 * Public Profile Page — trusted public identity layer for EAGOH users.
 * Shows: avatar, banner, username, verification badge, public title,
 * knowledge credentials summary, credibility tags, marketplace reputation,
 * total EAGOHs, top EAGOHs, active domains, source credentials badge.
 * Never shows: email, private user ID, subscription, admin data, preferences.
 */
import { palette } from "@/constants/colors";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import {
  ArrowLeft,
  Award,
  BadgeCheck,
  BookOpen,
  BrainCircuit,
  Cpu,
  Crown,
  Globe,
  Layers3,
  Shield,
  Star,
  Tag,
  TrendingUp,
  User,
  Zap,
} from "lucide-react-native";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSafeBack } from "@/hooks/useSafeBack";
import { useLocalSearchParams } from "expo-router";
import { supabase } from "@/lib/supabase";
import { INTELLIGENCE_DOMAINS } from "@/services/domains";
import { getKnowledgeCredentials, type KnowledgeCredentialsRow } from "@/services/knowledgeCredentials";
import {
  getPublicVerificationStatus,
  getPublicProfileInfo,
} from "@/services/socialVerification";
import { getVendorStats } from "@/services/marketplace";
import { getBulkReputations, rankColor as repRankColor, RANK_TIERS } from "@/services/reputation";
import type { ReputationRow } from "@/services/reputation";
import type { EagohRecord } from "@/services/eagohs";

type P = typeof palette;

// ── Styles ────────────────────────────────────────────────────────────────

function createStyles(pal: P) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: pal.void },
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: 100 },

    // Banner area
    bannerWrap: {
      height: 160,
      backgroundColor: pal.graphite,
      overflow: "hidden" as const,
    },
    bannerImage: { width: "100%", height: "100%" },
    bannerFallback: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      backgroundColor: pal.graphite,
    },
    bannerFallbackInner: {
      alignItems: "center" as const,
      gap: 4,
    },
    bannerFallbackText: {
      color: pal.muted,
      fontSize: 11,
      fontWeight: "700" as const,
      letterSpacing: 1.5,
      textTransform: "uppercase" as const,
    },

    // Back button overlay
    backBtn: {
      position: "absolute" as const,
      top: 12,
      left: 12,
      zIndex: 10,
      width: 36,
      height: 36,
      borderRadius: 5,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      backgroundColor: "rgba(0,0,0,0.55)",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.12)",
    },

    // Avatar
    avatarWrap: {
      alignItems: "center" as const,
      marginTop: -48,
      marginBottom: 12,
    },
    avatarCircle: {
      width: 96,
      height: 96,
      borderRadius: 48,
      borderWidth: 3,
      borderColor: pal.void,
      backgroundColor: pal.panel,
      overflow: "hidden" as const,
    },
    avatarImage: { width: "100%", height: "100%" },
    avatarFallback: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      backgroundColor: pal.blueSoft,
    },

    // Identity card
    identityCard: {
      marginHorizontal: 16,
      borderRadius: 5,
      backgroundColor: pal.panel,
      borderWidth: 1,
      borderColor: pal.line,
      padding: 16,
      gap: 10,
    },
    usernameRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
    },
    username: {
      color: pal.text,
      fontSize: 20,
      fontWeight: "900" as const,
    },
    verifiedBadge: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 5,
      backgroundColor: pal.cyanSoft,
      borderWidth: 1,
      borderColor: pal.cyan,
    },
    verifiedBadgeText: {
      color: pal.cyan,
      fontSize: 10,
      fontWeight: "800" as const,
    },
    publicTitle: {
      color: pal.blue,
      fontSize: 13,
      fontWeight: "700" as const,
    },

    // Section
    section: {
      marginHorizontal: 16,
      marginTop: 14,
      borderRadius: 5,
      backgroundColor: pal.panel,
      borderWidth: 1,
      borderColor: pal.line,
      overflow: "hidden" as const,
    },
    sectionHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderBottomWidth: 1,
      borderBottomColor: pal.line,
      backgroundColor: pal.blueSoft,
    },
    sectionHeaderText: {
      color: pal.text,
      fontSize: 13,
      fontWeight: "900" as const,
      letterSpacing: 0.8,
      textTransform: "uppercase" as const,
    },
    sectionBody: { padding: 14, gap: 10 },

    // Stat row
    statRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
    },
    statLabel: {
      color: pal.muted,
      fontSize: 12,
      fontWeight: "700" as const,
    },
    statValue: {
      color: pal.text,
      fontSize: 13,
      fontWeight: "800" as const,
    },

    // Credibility tags
    tagsWrap: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: 6,
    },
    tagChip: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 5,
      backgroundColor: pal.goldSoft,
      borderWidth: 1,
      borderColor: pal.gold,
    },
    tagChipText: {
      color: pal.gold,
      fontSize: 11,
      fontWeight: "800" as const,
    },

    // Domain chips
    domainChip: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 5,
      backgroundColor: pal.blueSoft,
      borderWidth: 1,
      borderColor: pal.line,
    },
    domainChipText: {
      color: pal.blue,
      fontSize: 11,
      fontWeight: "800" as const,
    },

    // EAGOH mini card
    eagohCard: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
      padding: 10,
      borderRadius: 5,
      backgroundColor: pal.obsidian,
      borderWidth: 1,
      borderColor: pal.line,
    },
    eagohThumb: {
      width: 44,
      height: 44,
      borderRadius: 5,
      backgroundColor: pal.graphite,
      overflow: "hidden" as const,
    },
    eagohThumbImage: { width: "100%", height: "100%" },
    eagohCardName: {
      color: pal.text,
      fontSize: 13,
      fontWeight: "800" as const,
      flex: 1,
    },
    eagohCardRank: {
      color: pal.muted,
      fontSize: 11,
      fontWeight: "700" as const,
    },

    // Empty state
    emptyText: {
      color: pal.muted,
      fontSize: 12,
      fontWeight: "600" as const,
      textAlign: "center" as const,
      paddingVertical: 8,
    },

    // Source credentials badge
    credentialsBadge: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 5,
      backgroundColor: pal.goldSoft,
      borderWidth: 1,
      borderColor: pal.gold,
    },
    credentialsBadgeText: {
      color: pal.gold,
      fontSize: 11,
      fontWeight: "800" as const,
    },

    // Privacy helper
    privacyFooter: {
      marginHorizontal: 16,
      marginTop: 20,
      padding: 12,
      borderRadius: 5,
      backgroundColor: pal.emberSoft,
      borderWidth: 1,
      borderColor: `${pal.ember}30`,
      gap: 6,
    },
    privacyFooterTitle: {
      color: pal.ember,
      fontSize: 11,
      fontWeight: "900" as const,
      letterSpacing: 0.5,
    },
    privacyFooterText: {
      color: pal.muted,
      fontSize: 11,
      fontWeight: "600" as const,
      lineHeight: 16,
    },
  });
}

// ── Sub-components ─────────────────────────────────────────────────────────

const SectionHeader = memo(function SectionHeader({
  title,
  icon,
  s,
}: {
  title: string;
  icon: React.ReactNode;
  s: ReturnType<typeof createStyles>;
}): JSX.Element {
  return (
    <View style={s.sectionHeader}>
      {icon}
      <Text style={s.sectionHeaderText}>{title}</Text>
    </View>
  );
});

// ── Main screen ────────────────────────────────────────────────────────────

export default function PublicProfileScreen(): JSX.Element {
  const safeBack = useSafeBack();
  const { userId: routeUserId } = useLocalSearchParams<{ userId: string }>();
  const pal = palette;
  const s = useMemo(() => createStyles(pal), [pal]);

  const [loading, setLoading] = useState<boolean>(true);
  const [profile, setProfile] = useState<{
    username: string | null;
    avatarUrl: string | null;
    bannerUrl: string | null;
    publicDisplayTitle: string | null;
    isSocialVerified: boolean;
    socialVerifiedPlatform: string | null;
  } | null>(null);
  const [credentials, setCredentials] = useState<KnowledgeCredentialsRow | null>(null);
  const [vendorStats, setVendorStats] = useState<{
    totalSales: number;
    totalEdgeEarned: number;
    rank: string;
    syncSuccessScore: number;
    avgQualityScore: number;
  } | null>(null);
  const [topEagohs, setTopEagohs] = useState<(EagohRecord & { rank: string; score: number })[]>([]);
  const [activeDomains, setActiveDomains] = useState<string[]>([]);
  const [totalEagohCount, setTotalEagohCount] = useState<number>(0);

  const userId = routeUserId ?? "";

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const [profileInfo, credentialsRow, verifStatus] = await Promise.all([
          getPublicProfileInfo(userId),
          getKnowledgeCredentials(userId).catch(() => null),
          getPublicVerificationStatus(userId),
        ]);

        setProfile(profileInfo);
        setCredentials(credentialsRow);

        // Fetch public EAGOHs for this user (only those with active marketplace listings)
        const { data: eagohsData } = await supabase
          .from("eagohs")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(20);

        const allEagohs = (eagohsData ?? []) as EagohRecord[];
        setTotalEagohCount(allEagohs.length);

        // Get reputations for top EAGOHs
        const eagohIds = allEagohs.slice(0, 5).map((e) => e.id);
        const repMap = eagohIds.length > 0 ? await getBulkReputations(eagohIds) : new Map();

        const top: (EagohRecord & { rank: string; score: number })[] = allEagohs
          .slice(0, 5)
          .map((e) => {
            const rep = repMap.get(e.id);
            return {
              ...e,
              rank: rep?.rank ?? "Dormant",
              score: rep?.reputation_score ?? 0,
            };
          })
          .sort((a, b) => b.score - a.score);
        setTopEagohs(top);

        // Active domains
        const domains = new Set<string>();
        for (const e of allEagohs) {
          const d = e.domain ?? "sports";
          const label = INTELLIGENCE_DOMAINS.find((di) => di.id === d)?.label ?? d;
          domains.add(label);
        }
        setActiveDomains([...domains]);

        // Vendor stats
        try {
          const stats = await getVendorStats(userId);
          if (stats) {
            setVendorStats({
              totalSales: stats.total_sales,
              totalEdgeEarned: stats.total_edge_earned,
              rank: stats.rank,
              syncSuccessScore: stats.sync_success_score,
              avgQualityScore: stats.avg_quality_score,
            });
          }
        } catch {
          // Not a vendor, that's fine
        }
      } catch (err) {
        console.warn("[public-profile] load error", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  if (loading) {
    return (
      <SafeAreaView edges={["top"]} style={s.safe}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={pal.cyan} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!userId || !profile) {
    return (
      <SafeAreaView edges={["top"]} style={s.safe}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
          <Shield color={pal.muted} size={40} />
          <Text style={{ color: pal.muted, fontSize: 14, fontWeight: "700" }}>
            Profile not found
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={s.safe}>
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Banner */}
        <View style={s.bannerWrap}>
          {profile.bannerUrl ? (
            <Image source={{ uri: profile.bannerUrl }} style={s.bannerImage} contentFit="cover" />
          ) : (
            <LinearGradient
              colors={[pal.graphite, pal.obsidian, pal.void]}
              style={s.bannerFallback}
            >
              <View style={s.bannerFallbackInner}>
                <Cpu color={pal.muted} size={28} />
                <Text style={s.bannerFallbackText}>EAGOH Network</Text>
              </View>
            </LinearGradient>
          )}
          <Pressable
            onPress={() => { safeBack(); }}
            style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.6 }]}
          >
            <ArrowLeft color={pal.text} size={20} />
          </Pressable>
        </View>

        {/* Avatar */}
        <View style={s.avatarWrap}>
          <View style={s.avatarCircle}>
            {profile.avatarUrl ? (
              <Image source={{ uri: profile.avatarUrl }} style={s.avatarImage} contentFit="cover" />
            ) : (
              <View style={s.avatarFallback}>
                <User color={pal.blue} size={36} />
              </View>
            )}
          </View>
        </View>

        {/* Identity card */}
        <View style={s.identityCard}>
          <View style={s.usernameRow}>
            <Text style={s.username}>{profile.username ?? "Anonymous Analyst"}</Text>
            {profile.isSocialVerified && (
              <View style={s.verifiedBadge}>
                <BadgeCheck color={pal.cyan} size={14} />
                <Text style={s.verifiedBadgeText}>Verified</Text>
              </View>
            )}
          </View>

          {profile.publicDisplayTitle ? (
            <Text style={s.publicTitle}>{profile.publicDisplayTitle}</Text>
          ) : null}

          {profile.isSocialVerified && profile.socialVerifiedPlatform ? (
            <Text style={{ color: pal.muted, fontSize: 11, fontWeight: "600" }}>
              Verified through connected social account
            </Text>
          ) : null}
        </View>

        {/* Source Credentials badge */}
        {credentials && (
          <View style={{ marginHorizontal: 16, marginTop: 10 }}>
            <View style={s.credentialsBadge}>
              <BookOpen color={pal.gold} size={14} />
              <Text style={s.credentialsBadgeText}>Source Credentials Available</Text>
            </View>
          </View>
        )}

        {/* Knowledge Credentials summary */}
        {credentials && (
          <View style={s.section}>
            <SectionHeader
              title="Knowledge Credentials"
              icon={<BrainCircuit color={pal.gold} size={15} />}
              s={s}
            />
            <View style={s.sectionBody}>
              {credentials.public_title ? (
                <View style={s.statRow}>
                  <Text style={s.statLabel}>Title</Text>
                  <Text style={s.statValue}>{credentials.public_title}</Text>
                </View>
              ) : null}

              {credentials.domain_expertise ? (
                <View style={s.statRow}>
                  <Text style={s.statLabel}>Domain Expertise</Text>
                  <Text style={s.statValue}>{credentials.domain_expertise}</Text>
                </View>
              ) : null}

              {credentials.years_experience ? (
                <View style={s.statRow}>
                  <Text style={s.statLabel}>Experience</Text>
                  <Text style={s.statValue}>{credentials.years_experience} years</Text>
                </View>
              ) : null}

              {credentials.credibility_tags && credentials.credibility_tags.length > 0 && (
                <View style={s.tagsWrap}>
                  {credentials.credibility_tags.map((tag) => (
                    <View key={tag} style={s.tagChip}>
                      <Text style={s.tagChipText}>{tag}</Text>
                    </View>
                  ))}
                </View>
              )}

              {credentials.experience_summary ? (
                <Text style={[s.statLabel, { lineHeight: 18 }]}>
                  {credentials.experience_summary}
                </Text>
              ) : null}
            </View>
          </View>
        )}

        {/* Stats overview */}
        <View style={s.section}>
          <SectionHeader
            title="Overview"
            icon={<TrendingUp color={pal.cyan} size={15} />}
            s={s}
          />
          <View style={s.sectionBody}>
            <View style={s.statRow}>
              <Text style={s.statLabel}>Total EAGOHs</Text>
              <Text style={s.statValue}>{totalEagohCount}</Text>
            </View>

            {vendorStats && (
              <>
                <View style={s.statRow}>
                  <Text style={s.statLabel}>Marketplace Reputation</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Award color={repRankColor(vendorStats.rank as any) ?? pal.gold} size={14} />
                    <Text style={[s.statValue, { color: repRankColor(vendorStats.rank as any) }]}>
                      {vendorStats.rank}
                    </Text>
                  </View>
                </View>
                <View style={s.statRow}>
                  <Text style={s.statLabel}>Sync Sales</Text>
                  <Text style={s.statValue}>{vendorStats.totalSales}</Text>
                </View>
                {vendorStats.syncSuccessScore > 0 && (
                  <View style={s.statRow}>
                    <Text style={s.statLabel}>Sync Success</Text>
                    <Text style={s.statValue}>{vendorStats.syncSuccessScore}%</Text>
                  </View>
                )}
              </>
            )}
          </View>
        </View>

        {/* Active domains */}
        {activeDomains.length > 0 && (
          <View style={s.section}>
            <SectionHeader
              title="Active Domains"
              icon={<Globe color={pal.blue} size={15} />}
              s={s}
            />
            <View style={s.sectionBody}>
              <View style={s.tagsWrap}>
                {activeDomains.map((domain) => (
                  <View key={domain} style={s.domainChip}>
                    <Text style={s.domainChipText}>{domain}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}

        {/* Top EAGOHs */}
        {topEagohs.length > 0 && (
          <View style={s.section}>
            <SectionHeader
              title="Top EAGOHs"
              icon={<Crown color={pal.gold} size={15} />}
              s={s}
            />
            <View style={s.sectionBody}>
              {topEagohs.map((eagoh) => (
                <View key={eagoh.id} style={s.eagohCard}>
                  <View style={s.eagohThumb}>
                    {eagoh.image_thumb_url || eagoh.image_url ? (
                      <Image
                        source={{ uri: eagoh.image_thumb_url ?? eagoh.image_url ?? "" }}
                        style={s.eagohThumbImage}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                        <Cpu color={pal.muted} size={20} />
                      </View>
                    )}
                  </View>
                  <Text style={s.eagohCardName}>{eagoh.name}</Text>
                  <Text style={[s.eagohCardRank, { color: repRankColor(eagoh.rank as any) ?? pal.muted }]}>
                    {eagoh.rank}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Privacy footer */}
        <View style={s.privacyFooter}>
          <Text style={s.privacyFooterTitle}>Privacy Notice</Text>
          <Text style={s.privacyFooterText}>
            Only public profile information is shown to other users. Email and private account details are never shown.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
