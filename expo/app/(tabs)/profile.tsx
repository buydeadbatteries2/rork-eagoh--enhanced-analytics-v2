/**
 * Profile screen — hero banner shows all forged EAGOHs with dynamic sizing.
 * Mock data removed; all displayed data comes from real EAGOH records,
 * reputation, and leaderboards.
 */

import { palette } from "@/constants/colors";
import { DEFAULT_EAGOH_IMAGE, DEFAULT_EAGOH_NAME } from "@/constants/defaultEagoh";
import { useAppTheme } from "@/providers/ThemeProvider";
import { LIST_PERFORMANCE_PROPS } from "@/app/_components/PerformancePrimitives";
import { Image } from "expo-image";
import { useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useHaptics } from "@/hooks/useHaptics";
import { useRouter } from "expo-router";
import { Award, Bell, BrainCircuit, Coins, Cpu, Crown, Eye, Flame, FlaskConical, Layers3, LogOut, Swords, Sparkles, Shield, Ticket, Trophy, TrendingUp, Zap } from "lucide-react-native";
import { INTELLIGENCE_DOMAINS } from "@/services/domains";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import PublicProfileModal from "@/components/PublicProfileModal";
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/providers/AuthProvider";
import { useQueryClient } from "@tanstack/react-query";
import { signOutUser } from "@/services/auth";
import { useProfile } from "@/providers/ProfileProvider";
import { useEagohs } from "@/providers/EagohProvider";
import type { EagohRecord } from "@/services/eagohs";
import type { SubscriptionTier } from "@/services/profile";
import {
  getEagohReputationDisplay,
  rankColor as repRankColor,
  RANK_TIERS,
  type EagohReputationDisplay,
} from "@/services/reputation";
import { getUserRankings, type LeaderboardEntry } from "@/services/leaderboards";

type LabTone = "cyan" | "gold" | "violet" | "ember" | "success";
type ProfileSection = { id: string; kind: "hero" | "stats" | "identity" | "settings" };
type Stat = { label: string; value: string; detail: string; tone: LabTone };

const sections: ProfileSection[] = [
  { id: "hero", kind: "hero" },
  { id: "stats", kind: "stats" },
  { id: "identity", kind: "identity" },
  { id: "settings", kind: "settings" },
];

const labGridLines = [0, 1, 2, 3, 4, 5, 6];

function toneColor(tone: LabTone): string {
  if (tone === "gold") return palette.gold;
  if (tone === "violet") return palette.violet;
  if (tone === "ember") return palette.ember;
  if (tone === "success") return palette.success;
  return palette.cyan;
}

const RepMetric = memo(function RepMetric({ label, value, max, tone }: { label: string; value: number; max: number; tone: LabTone }): JSX.Element {
  const accent = toneColor(tone);
  const pct = Math.min(1, value / (max || 1));
  return (
    <View style={styles.repMetricCard}>
      <View style={styles.repMetricHeader}>
        <Text style={styles.repMetricLabel}>{label}</Text>
        <Text style={[styles.repMetricValue, { color: accent }]}>{value}</Text>
      </View>
      <View style={styles.repProgressTrack}>
        <View style={[styles.repProgressFill, { width: `${pct * 100}%`, backgroundColor: accent }]} />
      </View>
    </View>
  );
});

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }): JSX.Element {
  return (
    <View style={styles.sectionTitleWrap}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

/** Gallery of all forged EAGOHs — sizes adjust dynamically based on count. Free users see the default shell. */
const EagohGallery = memo(function EagohGallery({ eagohs, isFree }: { eagohs: EagohRecord[]; isFree: boolean }): JSX.Element {
  const count = eagohs.length;

  if (count === 0) {
    return (
      <View style={[styles.chamber, styles.chamberEmpty]}>
        <LinearGradient colors={["rgba(54,245,255,0.06)", "rgba(10,18,30,0.72)", "rgba(3,6,11,0.96)"]} style={StyleSheet.absoluteFill} />
        {isFree ? (
          <>
            <Image source={{ uri: DEFAULT_EAGOH_IMAGE }} style={styles.defaultShellImage} contentFit="contain" />
            <Text style={styles.emptyTitle}>{DEFAULT_EAGOH_NAME}</Text>
            <Text style={styles.emptyHint}>Default Intelligence Shell</Text>
            <View style={styles.dormantBadge}>
              <View style={styles.dormantBadgeDot} />
              <Text style={styles.dormantBadgeText}>DORMANT</Text>
            </View>
          </>
        ) : (
          <>
            <FlaskConical color={palette.muted} size={36} />
            <Text style={styles.emptyTitle}>No EAGOHs Forged</Text>
            <Text style={styles.emptyHint}>Head to the Forge to create your first intelligence unit.</Text>
          </>
        )}
      </View>
    );
  }

  const isCompact = count >= 4;
  const imageH = isCompact ? 140 : count === 1 ? 380 : count === 2 ? 260 : 200;
  const chamberH = isCompact ? Math.max(340, count * 160) : count === 1 ? 500 : count === 2 ? 370 : count * 190;

  return (
    <View style={[styles.chamber, { height: chamberH }]}>
      <LinearGradient colors={["rgba(54,245,255,0.10)", "rgba(10,18,30,0.84)", "rgba(3,6,11,0.96)"]} style={StyleSheet.absoluteFill} />
      <View style={[styles.backHalo, { borderColor: "rgba(54,245,255,0.28)" }]} />
      <View style={styles.labGrid}>{labGridLines.map((index) => <View key={index} style={[styles.gridLine, { backgroundColor: "rgba(54,245,255,0.10)", left: `${index * 16}%` }]} />)}</View>
      <ScrollView horizontal={count >= 5} showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.galleryContent, count >= 5 && { paddingHorizontal: 8, gap: 10 }]}>
        <View style={[styles.galleryGrid, { flexDirection: count >= 4 ? "row" : "column", flexWrap: "wrap", gap: 10, justifyContent: "center" }]}>
          {eagohs.map((eagoh) => {
            const domainObj = INTELLIGENCE_DOMAINS.find((d) => d.id === eagoh.domain);
            const accent = domainObj ? toneColor(domainObj.tone) : palette.cyan;
            const renderUri = eagoh.image_url ?? eagoh.image_thumb_url ?? null;
            const cardW = count === 1 ? "100%" : count === 2 ? "100%" : count >= 4 ? "47%" : "100%";
            return (
              <View key={eagoh.id} style={{ width: cardW as any, minHeight: isCompact ? 146 : imageH + 72, borderRadius: 5, borderWidth: 1, borderColor: `${accent}33`, backgroundColor: "rgba(3,6,11,0.38)", overflow: "hidden", marginBottom: count >= 4 ? 6 : 0 }}>
                <View style={{ height: imageH, borderBottomWidth: 1, borderBottomColor: `${accent}22` }}>
                  {renderUri ? (
                    <View style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
                      <Image source={{ uri: renderUri }} style={StyleSheet.absoluteFill} contentFit="contain" cachePolicy="memory-disk" transition={160} recyclingKey={eagoh.id} />
                      <LinearGradient colors={["transparent", "rgba(3,6,11,0.55)"]} style={StyleSheet.absoluteFill} />
                    </View>
                  ) : (
                    <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
                      <LinearGradient colors={[`${accent}14`, "rgba(3,6,11,0.3)"]} style={StyleSheet.absoluteFill} />
                      <View style={[styles.galleryEmptyIcon, { borderColor: `${accent}44` }]}>
                        <Cpu color={accent} size={count >= 4 ? 18 : 24} />
                      </View>
                    </View>
                  )}
                </View>
                <View style={{ padding: isCompact ? 8 : 10, flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <View style={[styles.galleryDomainDot, { backgroundColor: accent }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.galleryEagohName, isCompact && { fontSize: 11 }]} numberOfLines={1}>{eagoh.name}</Text>
                    <Text style={styles.galleryEagohDomain}>{domainObj?.label ?? eagoh.domain ?? "Unknown"}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
      <View style={styles.galleryFooter}>
        <Text style={styles.galleryCount}>{count} EAGOH{count !== 1 ? "s" : ""} Forged</Text>
      </View>
    </View>
  );
});

const StatCard = memo(function StatCard({ item }: { item: Stat }): JSX.Element {
  const accent = toneColor(item.tone);
  return (
    <View style={styles.statCard}>
      <View style={[styles.statDot, { backgroundColor: accent }]} />
      <Text style={styles.statValue}>{item.value}</Text>
      <Text style={styles.statLabel}>{item.label}</Text>
      <Text style={styles.statDetail}>{item.detail}</Text>
    </View>
  );
});

export default function ProfileScreen(): JSX.Element {
  const h = useHaptics();
  const { user } = useAuth();
  const { eagohs } = useEagohs();
  const { profile, effectiveSubscriptionTier, isAdminOverrideActive } = useProfile();
  const { palette: pal } = useAppTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Public profile self-preview state
  const [showPublicProfile, setShowPublicProfile] = useState(false);
  const [signingOut, setSigningOut] = useState<boolean>(false);

  const handleSignOut = useCallback((): void => {
    // Prevent duplicate sign-out taps
    if (signingOut) return;
    setSigningOut(true);
    h.selection();
    signOutUser()
      .then(() => {
        // Clear all user-specific React Query caches (EAGOHs, profile, edge, etc.)
        queryClient.clear();
        // onAuthStateChange fires SIGNED_OUT → root layout replaces (tabs) with (auth)
        router.replace("/(auth)/login" as never);
      })
      .catch((e: unknown) => {
        setSigningOut(false);
        const msg = e instanceof Error ? e.message : "Sign out failed";
        Alert.alert("Sign Out Failed", "Unable to sign out. Please try again.");
        console.warn("[auth] signOut failed", e);
      });
  }, [signingOut, h, router, queryClient]);
  const displayAlias = (user?.user_metadata as { username?: string } | undefined)?.username ?? user?.email ?? "EAGOH operator";

  // ── Reputation for primary EAGOH ────────────────────────────────────
  const [reputation, setReputation] = useState<EagohReputationDisplay | null>(null);
  const [userRankings, setUserRankings] = useState<{ eagohEntries: LeaderboardEntry[]; bestCategory: string; rankChanges: any[] } | null>(null);
  const primaryEagoh = (eagohs ?? [])[0];
  useEffect(() => {
    if (!primaryEagoh?.id || !user?.id) return;
    getEagohReputationDisplay(primaryEagoh.id, user.id)
      .then(setReputation)
      .catch(() => undefined);
  }, [primaryEagoh?.id, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    getUserRankings(user.id)
      .then(setUserRankings)
      .catch(() => undefined);
  }, [user?.id]);

  // ── Aggregate real DNA & team data from all EAGOHs ──────────────────
  const aggregatedDna = useMemo<string[]>(() => {
    const set = new Set<string>();
    eagohs.forEach((e) => e.dna?.forEach((d) => set.add(d)));
    return Array.from(set);
  }, [eagohs]);

  const aggregatedTeams = useMemo<string[]>(() => {
    const set = new Set<string>();
    eagohs.forEach((e) => {
      if (e.pro_team_focus_name) set.add(e.pro_team_focus_name);
      if (e.college_team_focus_name) set.add(e.college_team_focus_name);
    });
    return Array.from(set);
  }, [eagohs]);

  const aggregatedDomains = useMemo(() => {
    const map = new Map<string, { info: typeof INTELLIGENCE_DOMAINS[number]; count: number }>();
    eagohs.forEach((e) => {
      const d = e.domain ?? "unknown";
      const existing = map.get(d);
      if (existing) {
        existing.count++;
      } else {
        const info = INTELLIGENCE_DOMAINS.find((di) => di.id === d);
        map.set(d, { info: info!, count: 1 });
      }
    });
    return Array.from(map.entries());
  }, [eagohs]);

  const reputationStats: Stat[] = useMemo<Stat[]>(() => {
    if (!reputation) {
      return [
        { label: "Rank", value: "—", detail: "No EAGOH active", tone: "cyan" },
        { label: "Reputation", value: "—", detail: "Forge an EAGOH first", tone: "gold" },
        { label: "Quality", value: "—", detail: "intelligence score", tone: "violet" },
        { label: "Trust", value: "—", detail: "marketplace", tone: "success" },
      ];
    }
    return [
      { label: "Rank", value: reputation.rank, detail: `${reputation.reputationScore}/100`, tone: "gold" },
      { label: "Reputation", value: `${reputation.reputationScore}`, detail: "total score", tone: "gold" },
      { label: "Quality", value: `${reputation.intelligenceQuality}`, detail: `${reputation.totalObservations} obs`, tone: "cyan" },
      { label: "Trust", value: `${reputation.marketplaceTrust}`, detail: `${reputation.marketplaceSales} sales`, tone: "success" },
    ];
  }, [reputation]);

  const currentTier = effectiveSubscriptionTier;

  const handleSettingsPress = useCallback((): void => {
    h.selection();
    router.push("/settings" as never);
  }, [router, h]);

  const renderSection = useCallback(({ item }: { item: ProfileSection }): JSX.Element => {
    if (item.kind === "hero") {
      return (
        <View>
          <View style={styles.topline}><View><Text style={styles.kicker}>PROFILE CHAMBER</Text><Text style={styles.title} numberOfLines={1}>{displayAlias}</Text></View><View style={[styles.rankPill, reputation ? { borderColor: `${repRankColor(reputation.rank)}66`, backgroundColor: `${repRankColor(reputation.rank)}22` } : undefined]}><Crown color={reputation ? repRankColor(reputation.rank) : palette.gold} size={16} /><Text style={[styles.rankText, reputation ? { color: repRankColor(reputation.rank) } : undefined]}>{reputation?.rank ?? "No Rank"}</Text></View></View>
          {isAdminOverrideActive ? (
            <View style={styles.adminOverrideBanner}>
              <Zap color={palette.gold} size={14} />
              <Text style={styles.adminOverrideText}>Promotional Access Active</Text>
            </View>
          ) : null}
          <EagohGallery eagohs={eagohs} isFree={currentTier === "free"} />
          <Pressable onPress={handleSignOut} disabled={signingOut} style={({ pressed }) => [styles.signOutButton, pressed && { opacity: 0.85 }, signingOut && { opacity: 0.5 }]}>
            {signingOut ? <ActivityIndicator color={palette.ember} /> : <LogOut color={palette.ember} size={16} />}
            <Text style={styles.signOutText}>{signingOut ? "Signing out…" : "Sign out"}</Text>
          </Pressable>
        </View>
      );
    }
    if (item.kind === "stats") {
      return (
        <View>
          <View style={styles.statGrid}>{reputationStats.map((stat) => <StatCard key={stat.label} item={stat} />)}</View>
          {/* Domain breakdown */}
          {aggregatedDomains.length > 0 && (
            <View style={styles.domainPanel}>
              <SectionTitle eyebrow="DOMAIN SPECIALIZATION" title="My Intelligence Domains" />
              <View style={styles.domainGrid}>
                {aggregatedDomains.map(([domainId, { info, count }]) => {
                  const color = info?.color ?? palette.muted;
                  return (
                    <View key={domainId} style={[styles.domainChip, { borderColor: `${color}44`, backgroundColor: `${color}16` }]}>
                      <View style={[styles.domainDot, { backgroundColor: color }]} />
                      <Text style={[styles.domainChipLabel, { color }]}>{info?.label ?? domainId}</Text>
                      <Text style={styles.domainChipCount}>{count} EAGOH{count > 1 ? "s" : ""}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}
          {/* Expanded reputation breakdown */}
          {reputation && (
            <View style={styles.reputationPanel}>
              <SectionTitle eyebrow="REPUTATION BREAKDOWN" title="EAGOH Rank & Trust" />
              <View style={styles.repGrid}>
                <RepMetric label="Intelligence Quality" value={reputation.intelligenceQuality} max={25} tone="cyan" />
                <RepMetric label="Marketplace Trust" value={reputation.marketplaceTrust} max={20} tone="violet" />
                <RepMetric label="Faction Influence" value={reputation.factionInfluence} max={20} tone="gold" />
                <RepMetric label="Sync Success" value={reputation.syncSuccess} max={100} tone="success" />
                <RepMetric label="Activity Level" value={reputation.activityLevel} max={10} tone="cyan" />
                <RepMetric label="Fanatic Strength" value={reputation.fanaticTeamStrength} max={10} tone="ember" />
              </View>
              {/* Rank progression bar */}
              <View style={styles.rankProgression}>
                <Text style={styles.repDetailLabel}>Rank Progression</Text>
                <View style={styles.rankBarTrack}>
                  {RANK_TIERS.map((tier) => {
                    const threshold = { Dormant: 0, Activated: 1, Bronze: 15, Silver: 30, Gold: 45, Platinum: 60, Diamond: 75, Oracle: 88, "Syndicate Prime": 96 }[tier];
                    const achieved = reputation.reputationScore >= threshold;
                    return (
                      <View key={tier} style={[styles.rankBarStep, achieved && { backgroundColor: repRankColor(tier) }]}>
                        <View style={[styles.rankBarStepDot, achieved && { backgroundColor: repRankColor(tier), borderColor: repRankColor(tier) }]} />
                      </View>
                    );
                  })}
                </View>
              </View>
              {/* My Rankings */}
              {userRankings && userRankings.eagohEntries.length > 0 && (
                <View style={styles.rankingsSection}>
                  <Text style={styles.repDetailLabel}>My Leaderboard Rankings</Text>
                  <View style={styles.rankingsList}>
                    {userRankings.eagohEntries.slice(0, 3).map((entry) => (
                      <View key={entry.eagoh_id} style={styles.rankingMiniCard}>
                        <View style={styles.rankingMiniLeft}>
                          <Text style={styles.rankingMiniRank}>#{entry.rank}</Text>
                          <Text style={styles.rankingMiniName} numberOfLines={1}>{entry.eagoh_name}</Text>
                          <View style={[styles.rankingMiniBadge, { borderColor: `${repRankColor(entry.rank_tier)}44`, backgroundColor: `${repRankColor(entry.rank_tier)}18` }]}>
                            <Text style={[styles.rankingMiniBadgeText, { color: repRankColor(entry.rank_tier) }]}>{entry.rank_tier}</Text>
                          </View>
                        </View>
                        <Text style={[styles.rankingMiniScore, { color: repRankColor(entry.rank_tier) }]}>{entry.reputation_score}</Text>
                      </View>
                    ))}
                  </View>
                  {userRankings.bestCategory && (
                    <View style={styles.bestCategoryRow}>
                      <Trophy color={palette.gold} size={13} />
                      <Text style={styles.bestCategoryText}>Strongest: {userRankings.bestCategory.replace(/_/g, " ")}</Text>
                    </View>
                  )}
                  {userRankings.rankChanges.length > 0 && (
                    <View style={styles.rankChangesSection}>
                      <Text style={styles.repDetailLabel}>Recent Rank Changes</Text>
                      {userRankings.rankChanges.slice(0, 3).map((change: any, i: number) => (
                        <View key={i} style={styles.rankChangeRow}>
                          <TrendingUp color={change.new_rank && change.previous_rank && change.new_rank !== change.previous_rank ? palette.success : palette.muted} size={14} />
                          <Text style={styles.rankChangeText}>
                            {change.previous_rank ?? "None"} → {change.new_rank}
                          </Text>
                          <Text style={styles.rankChangeDate}>{new Date(change.created_at).toLocaleDateString()}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}
              {/* Badges */}
              {reputation.badges.length > 0 && (
                <View style={styles.badgesSection}>
                  <Text style={styles.repDetailLabel}>Earned Badges</Text>
                  <View style={styles.badgesGrid}>
                    {reputation.badges.map((badge) => (
                      <View key={badge.id} style={styles.badgeCard}>
                        <Award color={palette.gold} size={18} />
                        <View style={styles.badgeInfo}>
                          <Text style={styles.badgeName}>{badge.badge_name}</Text>
                          <Text style={styles.badgeDesc} numberOfLines={2}>{badge.badge_description}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}
        </View>
      );
    }
    if (item.kind === "identity") {
      return (
        <View style={styles.panel}>
          <SectionTitle eyebrow="IDENTITY MATRIX" title="DNA, teams, and faction alignment" />
          {aggregatedDna.length > 0 ? (
            <View style={styles.chipWrap}>
              {aggregatedDna.map((label) => {
                // Filter out domain-encoding DNA entries
                if (label.startsWith("dom:")) return null;
                return (
                  <View key={label} style={styles.chip}>
                    <Sparkles color={palette.cyan} size={13} />
                    <Text style={styles.chipText}>{label}</Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.emptyHint}>No DNA archetypes assigned yet.</Text>
          )}
          <View style={styles.divider} />
          <Text style={styles.miniLabel}>Fanatic Teams</Text>
          {aggregatedTeams.length > 0 ? (
            <View style={styles.chipWrap}>
              {aggregatedTeams.map((label) => (
                <View key={label} style={[styles.chip, styles.teamChip]}>
                  <Shield color={palette.gold} size={13} />
                  <Text style={styles.chipText}>{label}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyHint}>No team affiliations set.</Text>
          )}
          <View style={styles.alignment}>
            <Swords color={palette.ember} size={18} />
            <View>
              <Text style={styles.alignmentTitle}>Faction Alignment</Text>
              <Text style={styles.alignmentBody}>EAGOH Intelligence Network</Text>
            </View>
          </View>
        </View>
      );
    }
    if (item.kind === "settings") {
      const handleEdgeStore = (): void => {
        h.selection();
        router.push("/edge-store" as never);
      };
      const handleFactions = (): void => {
        h.selection();
        router.push("/factions" as never);
      };
      return (
        <View style={{ gap: 10 }}>
          <Pressable onPress={handleFactions} style={({ pressed }) => [styles.settingsCard, pressed && { opacity: 0.8 }]}>
            <View style={[styles.featureIconWrap, { borderColor: "rgba(138,92,255,0.35)" }]}>
              <Shield color={palette.violet} size={20} />
            </View>
            <View style={styles.featureInfo}>
              <Text style={styles.featureTitle}>Faction Network</Text>
              <Text style={styles.featureDesc}>Build private intelligence networks with other EAGOH users.</Text>
            </View>
            <Cpu color={palette.muted} size={16} />
          </Pressable>
          <Pressable onPress={handleEdgeStore} style={({ pressed }) => [styles.settingsCard, pressed && { opacity: 0.8 }]}>
            <View style={[styles.featureIconWrap, { borderColor: "rgba(255,181,71,0.35)" }]}>
              <Coins color={palette.gold} size={20} />
            </View>
            <View style={styles.featureInfo}>
              <Text style={styles.featureTitle}>Neuron Store</Text>
              <Text style={styles.featureDesc}>Purchase additional Neurons</Text>
            </View>
            <Cpu color={palette.muted} size={16} />
          </Pressable>
          <Pressable onPress={() => { h.selection(); router.push("/subscription" as never); }} style={({ pressed }) => [styles.settingsCard, pressed && { opacity: 0.8 }]}>
            <View style={[styles.featureIconWrap, { borderColor: "rgba(255,184,77,0.35)" }]}>
              <Crown color={palette.gold} size={20} />
            </View>
            <View style={styles.featureInfo}>
              <Text style={styles.featureTitle}>Subscription</Text>
              <Text style={styles.featureDesc}>Manage your plan and subscription tier</Text>
            </View>
            <Cpu color={palette.muted} size={16} />
          </Pressable>
          <Pressable onPress={() => { h.selection(); setShowPublicProfile(true); }} style={({ pressed }) => [styles.settingsCard, pressed && { opacity: 0.8 }]}>
            <View style={[styles.featureIconWrap, { borderColor: "rgba(54,245,255,0.35)" }]}>
              <Eye color={palette.cyan} size={20} />
            </View>
            <View style={styles.featureInfo}>
              <Text style={styles.featureTitle}>View My Public Profile</Text>
              <Text style={styles.featureDesc}>Preview how other EAGOH users see your profile.</Text>
            </View>
            <Cpu color={palette.muted} size={16} />
          </Pressable>
          <Pressable onPress={() => { h.selection(); router.push("/notifications" as never); }} style={({ pressed }) => [styles.settingsCard, pressed && { opacity: 0.8 }]}>
            <View style={[styles.featureIconWrap, { borderColor: "rgba(54,245,255,0.35)" }]}>
              <Bell color={palette.cyan} size={20} />
            </View>
            <View style={styles.featureInfo}>
              <Text style={styles.featureTitle}>Intelligence Notifications</Text>
              <Text style={styles.featureDesc}>View updates about your Open Intelligence entries.</Text>
            </View>
            <Cpu color={palette.muted} size={16} />
          </Pressable>
          <Pressable onPress={handleSettingsPress} style={({ pressed }) => [styles.settingsCard, pressed && { opacity: 0.8 }]}>
            <View style={[styles.featureIconWrap, { borderColor: "rgba(120,180,255,0.35)" }]}>
              <Crown color={palette.text} size={20} />
            </View>
            <View style={styles.featureInfo}>
              <Text style={styles.featureTitle}>Settings</Text>
              <Text style={styles.featureDesc}>Account, appearance, legal, and subscription management</Text>
            </View>
            <Cpu color={palette.muted} size={16} />
          </Pressable>
        </View>
      );
    }
    return <></>;
  }, [handleSignOut, reputationStats, reputation, currentTier, handleSettingsPress, isAdminOverrideActive, eagohs, displayAlias, aggregatedDna, aggregatedTeams, aggregatedDomains, userRankings, signingOut]);

  return (
    <View style={[styles.root, { backgroundColor: pal.void }]}>
      <SafeAreaView edges={["top"]} style={styles.safe}>
        <FlatList data={sections} keyExtractor={(item) => item.id} renderItem={renderSection} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} {...LIST_PERFORMANCE_PROPS} />
      </SafeAreaView>
      <PublicProfileModal
        visible={showPublicProfile}
        userId={user?.id ?? null}
        currentUserId={user?.id ?? null}
        onClose={() => setShowPublicProfile(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { padding: 18, paddingBottom: 120, gap: 16 },
  topline: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 },
  kicker: { color: palette.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 2.2 },
  title: { color: palette.text, fontSize: 34, fontWeight: "900", letterSpacing: -1, marginTop: 4 },
  rankPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 5, borderWidth: 1, borderColor: "rgba(255,184,77,0.38)", backgroundColor: palette.goldSoft },
  rankText: { color: palette.gold, fontWeight: "900", fontSize: 12 },
  adminOverrideBanner: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 5, backgroundColor: "rgba(255,184,77,0.12)", borderWidth: 1, borderColor: "rgba(255,184,77,0.35)", alignSelf: "flex-start" },
  adminOverrideText: { color: palette.gold, fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },
  // Chamber (EAGOH Gallery)
  chamber: { overflow: "hidden", borderRadius: 5, borderWidth: 1, borderColor: "rgba(54,245,255,0.24)", marginTop: 18, backgroundColor: palette.obsidian },
  chamberEmpty: { height: 260, alignItems: "center", justifyContent: "center", gap: 10 },
  emptyTitle: { color: palette.muted, fontSize: 16, fontWeight: "900", letterSpacing: 0.5 },
  emptyHint: { color: palette.muted, fontSize: 12, fontWeight: "600", textAlign: "center", paddingHorizontal: 20 },
  defaultShellImage: { width: 120, height: 120, borderRadius: 5 },
  dormantBadge: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 5, borderWidth: 1, borderColor: palette.line, backgroundColor: "rgba(255,255,255,0.04)" },
  dormantBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.muted },
  dormantBadgeText: { color: palette.muted, fontSize: 10, fontWeight: "900" as const, letterSpacing: 1.5 },
  backHalo: { position: "absolute", top: 54, alignSelf: "center", width: 260, height: 260, borderRadius: 130, borderWidth: 1, opacity: 0.8 },
  labGrid: { ...StyleSheet.absoluteFillObject, opacity: 0.8 },
  gridLine: { position: "absolute", top: 0, bottom: 0, width: 1 },
  // Gallery
  galleryContent: { alignItems: "center", justifyContent: "center", flexGrow: 1 },
  galleryGrid: { alignItems: "center", justifyContent: "center", width: "100%", padding: 10 },
  galleryEmptyIcon: { width: 48, height: 48, borderRadius: 5, borderWidth: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.03)" },
  galleryDomainDot: { width: 8, height: 8, borderRadius: 4 },
  galleryEagohName: { color: palette.text, fontSize: 13, fontWeight: "900" },
  galleryEagohDomain: { color: palette.muted, fontSize: 10, fontWeight: "700", marginTop: 1 },
  galleryFooter: { position: "absolute", left: 14, right: 14, bottom: 10, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 5, backgroundColor: "rgba(3,6,11,0.72)", borderWidth: 1, borderColor: "rgba(54,245,255,0.14)" },
  galleryCount: { color: palette.cyan, fontSize: 10, fontWeight: "900", letterSpacing: 1, textAlign: "center" },
  // Stats
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statCard: { width: "48%", minHeight: 118, borderRadius: 5, padding: 14, backgroundColor: "rgba(16,27,42,0.76)", borderWidth: 1, borderColor: palette.line },
  statDot: { width: 9, height: 9, borderRadius: 9, marginBottom: 14 },
  statValue: { color: palette.text, fontSize: 25, fontWeight: "900" },
  statLabel: { color: palette.muted, marginTop: 3, fontWeight: "800" },
  statDetail: { color: palette.muted, fontSize: 11, marginTop: 8 },
  panel: { borderRadius: 5, padding: 16, backgroundColor: "rgba(10,18,30,0.78)", borderWidth: 1, borderColor: palette.line, gap: 12 },
  sectionTitleWrap: { marginBottom: 4 },
  eyebrow: { color: palette.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 1.8 },
  sectionTitle: { color: palette.text, fontSize: 22, fontWeight: "900", marginTop: 3 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 5, backgroundColor: palette.cyanSoft, borderWidth: 1, borderColor: "rgba(54,245,255,0.26)" },
  teamChip: { backgroundColor: palette.goldSoft, borderColor: "rgba(255,184,77,0.25)" },
  chipText: { color: palette.text, fontSize: 12, fontWeight: "800" },
  divider: { height: 1, backgroundColor: palette.line, marginVertical: 2 },
  miniLabel: { color: palette.muted, fontWeight: "900", fontSize: 12, textTransform: "uppercase" },
  alignment: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 5, backgroundColor: "rgba(255,107,53,0.10)", borderWidth: 1, borderColor: "rgba(255,107,53,0.22)" },
  alignmentTitle: { color: palette.text, fontWeight: "900" },
  alignmentBody: { color: palette.muted, marginTop: 3, flexShrink: 1 },
  // Settings
  settingsCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 5, padding: 16, backgroundColor: "rgba(14,24,37,0.64)", borderWidth: 1, borderColor: "rgba(120,180,255,0.24)", marginBottom: 8 },
  featureCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 5, padding: 13, backgroundColor: "rgba(14,24,37,0.64)", borderWidth: 1, borderColor: palette.line, marginBottom: 8 },
  featureIconWrap: { width: 42, height: 42, borderRadius: 5, borderWidth: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.035)" },
  featureInfo: { flex: 1 },
  featureTitle: { color: palette.text, fontSize: 13, fontWeight: "900" },
  featureDesc: { color: palette.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  signOutButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, marginTop: 14, borderRadius: 5, borderWidth: 1, borderColor: "rgba(255,107,53,0.32)", backgroundColor: "rgba(255,107,53,0.08)" },
  signOutText: { color: palette.ember, fontWeight: "900", fontSize: 13, letterSpacing: 1.2 },
  // Domain breakdown
  domainPanel: { borderRadius: 5, padding: 14, marginTop: 14, backgroundColor: "rgba(10,18,30,0.82)", borderWidth: 1, borderColor: "rgba(54,245,255,0.18)", gap: 10 },
  domainGrid: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
  domainChip: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 5, borderWidth: 1 },
  domainDot: { width: 8, height: 8, borderRadius: 4 },
  domainChipLabel: { fontSize: 11, fontWeight: "900" as const },
  domainChipCount: { color: palette.muted, fontSize: 10, fontWeight: "800" as const, marginLeft: 2 },
  // Reputation
  reputationPanel: { borderRadius: 5, padding: 14, marginTop: 14, backgroundColor: "rgba(10,18,30,0.82)", borderWidth: 1, borderColor: "rgba(255,184,77,0.20)", gap: 10 },
  repGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  repMetricCard: { width: "48%", padding: 10, borderRadius: 5, backgroundColor: "rgba(16,27,42,0.64)", borderWidth: 1, borderColor: palette.line },
  repMetricHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 7 },
  repMetricLabel: { color: palette.muted, fontSize: 11, fontWeight: "900" as const, flex: 1 },
  repMetricValue: { fontSize: 16, fontWeight: "900" as const },
  repProgressTrack: { height: 5, borderRadius: 5, backgroundColor: "rgba(141,162,181,0.14)", overflow: "hidden" as const },
  repProgressFill: { height: "100%", borderRadius: 5 },
  repDetailLabel: { color: palette.text, fontSize: 13, fontWeight: "900" as const, marginBottom: 8 },
  rankProgression: { marginTop: 4 },
  rankBarTrack: { flexDirection: "row" as const, gap: 3, alignItems: "flex-end" as const, height: 28 },
  rankBarStep: { flex: 1, height: 8, borderRadius: 5, backgroundColor: "rgba(141,162,181,0.16)" },
  rankBarStepDot: { width: 12, height: 12, borderRadius: 6, alignSelf: "center" as const, marginTop: 12, borderWidth: 1, borderColor: "rgba(141,162,181,0.3)", backgroundColor: "rgba(3,6,11,0.8)" },
  badgesSection: { marginTop: 4 },
  badgesGrid: { gap: 8 },
  badgeCard: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 10, padding: 10, borderRadius: 5, backgroundColor: palette.goldSoft, borderWidth: 1, borderColor: "rgba(255,184,77,0.18)" },
  badgeInfo: { flex: 1 },
  badgeName: { color: palette.gold, fontSize: 13, fontWeight: "900" as const },
  badgeDesc: { color: palette.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  // Rankings
  rankingsSection: { marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: palette.line },
  rankingsList: { gap: 6 },
  rankingMiniCard: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const, padding: 10, borderRadius: 5, backgroundColor: "rgba(16,27,42,0.54)", borderWidth: 1, borderColor: palette.line },
  rankingMiniLeft: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, flex: 1 },
  rankingMiniRank: { color: palette.gold, fontSize: 14, fontWeight: "900" as const, minWidth: 28 },
  rankingMiniName: { color: palette.text, fontSize: 13, fontWeight: "900" as const, flex: 1 },
  rankingMiniBadge: { borderWidth: 1, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  rankingMiniBadgeText: { fontSize: 9, fontWeight: "900" as const },
  rankingMiniScore: { fontSize: 18, fontWeight: "900" as const, minWidth: 36, textAlign: "right" as const },
  bestCategoryRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, marginTop: 6 },
  bestCategoryText: { color: palette.gold, fontSize: 11, fontWeight: "800" as const, textTransform: "capitalize" as const },
  rankChangesSection: { marginTop: 10 },
  rankChangeRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, paddingVertical: 6 },
  rankChangeText: { color: palette.text, fontSize: 12, fontWeight: "700" as const, flex: 1 },
  rankChangeDate: { color: palette.muted, fontSize: 10 },

});
