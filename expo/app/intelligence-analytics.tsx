/**
 * Intelligence Analytics — Phase 8A
 *
 * Owner-scoped analytics for the authenticated user's Open Intelligence.
 * Shows entry summary, contributor reputation, entry performance, weekly
 * trends, Faction contribution insights, and Exchange contribution insights.
 *
 * Security:
 *   - All analytics are fetched through the secure worker (GET /intelligence/analytics)
 *   - The worker verifies auth and scopes all queries to the authenticated user
 *   - Reviewer identities, buyer identities, and internal anti-gaming/moderation
 *     data are never exposed
 */

import { palette } from "@/constants/colors";
import { useAppTheme } from "@/providers/ThemeProvider";
import { useProfile } from "@/providers/ProfileProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useSafeBack } from "@/hooks/useSafeBack";
import {
  fetchIntelligenceAnalytics,
  trustLabel,
  trustLabelColor,
  validationStatusColor,
  VALIDATION_STATUS_LABELS,
  type IntelligenceAnalytics,
  type EntryPerformance,
  type WeeklyTrendPoint,
  type FactionContribution,
} from "@/services/openIntelligence";
import { listUserFactions, type FactionRow } from "@/services/factions";
import {
  Activity,
  BarChart3,
  ChevronLeft,
  Clock,
  Eye,
  Flag,
  Share2,
  Shield,
  Star,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react-native";
import React, { memo, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery } from "@tanstack/react-query";

// ── Stat Tile ─────────────────────────────────────────────────────────────

const StatTile = memo(function StatTile({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}): JSX.Element {
  return (
    <View style={anStyles.statTile}>
      <Text style={[anStyles.statValue, { color: color ?? palette.text }]}>{value}</Text>
      <Text style={anStyles.statLabel}>{label}</Text>
    </View>
  );
});

// ── Section Header ────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  title,
  accent,
}: {
  icon: JSX.Element;
  title: string;
  accent: string;
}): JSX.Element {
  return (
    <View style={anStyles.sectionHeader}>
      <View style={[anStyles.sectionIconWrap, { borderColor: `${accent}33`, backgroundColor: `${accent}12` }]}>
        {icon}
      </View>
      <Text style={[anStyles.sectionTitle, { color: accent }]}>{title}</Text>
    </View>
  );
}

// ── Trend Bar (simple mobile-friendly bar chart) ──────────────────────────

function TrendChart({
  data,
  metric,
  color,
}: {
  data: WeeklyTrendPoint[];
  metric: "entriesCreated" | "analystUses" | "avgQuality" | "feedbackCount";
  color: string;
}): JSX.Element {
  const maxVal = useMemo(() => {
    const max = Math.max(...data.map((d) => d[metric] as number), 1);
    return max;
  }, [data, metric]);

  return (
    <View style={anStyles.chartWrap}>
      {data.length === 0 ? (
        <Text style={anStyles.chartEmpty}>No trend data yet.</Text>
      ) : (
        data.map((point, idx) => {
          const val = point[metric] as number;
          const heightPct = Math.max(4, (val / maxVal) * 100);
          const weekLabel = new Date(point.weekStart).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          });
          return (
            <View key={`trend-${idx}`} style={anStyles.barCol}>
              <View style={anStyles.barTrack}>
                <View
                  style={[
                    anStyles.barFill,
                    {
                      height: `${heightPct}%`,
                      backgroundColor: val > 0 ? color : `${palette.muted}33`,
                    },
                  ]}
                />
              </View>
              <Text style={anStyles.barValue}>{val}</Text>
              <Text style={anStyles.barLabel} numberOfLines={1}>{weekLabel}</Text>
            </View>
          );
        })
      )}
    </View>
  );
}

// ── Entry Performance Card ────────────────────────────────────────────────

function PerformanceRow({
  perf,
  index,
}: {
  perf: EntryPerformance;
  index: number;
}): JSX.Element {
  const statusColor = validationStatusColor(perf.validationStatus);
  const statusLabel = VALIDATION_STATUS_LABELS[perf.validationStatus] ?? "Pending Review";
  const lastUsed = perf.lastUsedAt
    ? new Date(perf.lastUsedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "—";

  return (
    <View style={[anStyles.perfRow, { borderColor: `${statusColor}22` }]}>
      <View style={[anStyles.perfIndex, { backgroundColor: `${statusColor}12`, borderColor: `${statusColor}33` }]}>
        <Text style={[anStyles.perfIndexText, { color: statusColor }]}>{index + 1}</Text>
      </View>
      <View style={anStyles.perfContent}>
        <View style={anStyles.perfTopRow}>
          <View style={[anStyles.perfBadge, { borderColor: `${statusColor}44`, backgroundColor: `${statusColor}12` }]}>
            <Shield color={statusColor} size={8} />
            <Text style={[anStyles.perfBadgeText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
          {perf.outdatedFlag ? (
            <View style={[anStyles.perfBadge, { borderColor: `${palette.gold}33` }]}>
              <Clock color={palette.gold} size={8} />
              <Text style={[anStyles.perfBadgeText, { color: palette.gold }]}>Outdated</Text>
            </View>
          ) : null}
        </View>
        <View style={anStyles.perfMetrics}>
          <Text style={anStyles.perfMetric}>Q: <Text style={{ color: palette.cyan }}>{perf.qualityScore}</Text></Text>
          <Text style={anStyles.perfMetric}>I: <Text style={{ color: palette.violet }}>{perf.influenceScore}</Text></Text>
          <Text style={anStyles.perfMetric}>Uses: <Text style={{ color: palette.text }}>{perf.analystUseCount}</Text></Text>
          <Text style={anStyles.perfMetric}>Helpful: <Text style={{ color: palette.success }}>{perf.helpfulCount}</Text></Text>
          <Text style={anStyles.perfMetric}>Support: <Text style={{ color: palette.cyan }}>{perf.supportCount}</Text></Text>
          <Text style={anStyles.perfMetric}>Disputes: <Text style={{ color: perf.disputeCount > 0 ? palette.ember : palette.muted }}>{perf.disputeCount}</Text></Text>
        </View>
        <View style={anStyles.perfFooter}>
          <Clock color={palette.muted} size={9} />
          <Text style={anStyles.perfLastUsed}>Last used: {lastUsed}</Text>
        </View>
      </View>
    </View>
  );
}

// ── Faction Contribution Card ─────────────────────────────────────────────

function FactionContributionCard({
  contribution,
  faction,
}: {
  contribution: FactionContribution;
  faction: FactionRow | undefined;
}): JSX.Element {
  const name = faction?.name ?? "Unknown Faction";
  return (
    <View style={anStyles.factionCard}>
      <View style={anStyles.factionHeader}>
        <Flag color={palette.violet} size={14} />
        <Text style={anStyles.factionName} numberOfLines={1}>{name}</Text>
      </View>
      <View style={anStyles.factionMetrics}>
        <StatTile label="Shared" value={contribution.entriesShared} color={palette.violet} />
        <StatTile label="Used" value={contribution.entriesUsedByAnalysts} color={palette.cyan} />
        <StatTile label="Avg Quality" value={Math.round(contribution.avgQuality)} color={palette.text} />
        <StatTile label="Supported" value={contribution.supportedEntries} color={palette.success} />
        <StatTile label="Disputed" value={contribution.disputedEntries} color={contribution.disputedEntries > 0 ? palette.ember : palette.muted} />
      </View>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────

export default function IntelligenceAnalyticsScreen(): JSX.Element {
  const goBack = useSafeBack();
  const { palette: pal } = useAppTheme();
  const { profile } = useProfile();

  // Fetch analytics through the secure worker (verified auth, owner-scoped)
  const analyticsQuery = useQuery<IntelligenceAnalytics>({
    queryKey: ["intelligence-analytics", profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const result = await fetchIntelligenceAnalytics();
      if (result.ok) return result.analytics;
      throw new Error(result.error);
    },
    staleTime: 60_000, // cache briefly
  });

  // Fetch user's factions to resolve faction names in contribution insights
  const factionsQuery = useQuery<FactionRow[]>({
    queryKey: ["factions", "user", profile?.id],
    enabled: !!profile?.id,
    queryFn: () => listUserFactions(profile!.id),
  });

  const factionMap = useMemo(() => {
    const map = new Map<string, FactionRow>();
    for (const f of factionsQuery.data ?? []) {
      map.set(f.id, f);
    }
    return map;
  }, [factionsQuery.data]);

  const data = analyticsQuery.data;
  const summary = data?.summary ?? null;
  const reputation = data?.reputation ?? null;
  const entryPerformance = data?.entryPerformance ?? [];
  const weeklyTrend = data?.weeklyTrend ?? [];
  const factionContributions = data?.factionContributions ?? [];
  const exchangeContributions = data?.exchangeContributions ?? null;

  const hasNoEntries = summary === null || summary.totalEntries === 0;

  return (
    <SafeAreaView style={[anStyles.safe, { backgroundColor: pal.void }]} edges={["top"]}>
      {/* Header */}
      <View style={anStyles.header}>
        <Pressable onPress={goBack} style={anStyles.backBtn}>
          <ChevronLeft color={palette.text} size={22} />
        </Pressable>
        <View style={anStyles.headerCenter}>
          <Text style={anStyles.kicker}>ANALYTICS</Text>
          <Text style={anStyles.title}>Intelligence Insights</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={anStyles.scroll}
        contentContainerStyle={anStyles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {analyticsQuery.isLoading ? (
          <ActivityIndicator color={palette.cyan} size="large" style={{ paddingVertical: 40 }} />
        ) : analyticsQuery.error ? (
          <View style={anStyles.emptyState}>
            <Activity color={palette.ember} size={32} />
            <Text style={anStyles.emptyTitle}>No Analytics Available Yet</Text>
            <Text style={anStyles.emptyDesc}>
              {(analyticsQuery.error as Error).message ?? "Failed to load analytics. Try again later."}
            </Text>
          </View>
        ) : hasNoEntries ? (
          <View style={anStyles.emptyState}>
            <BarChart3 color={palette.muted} size={32} />
            <Text style={anStyles.emptyTitle}>No Analytics Available Yet</Text>
            <Text style={anStyles.emptyDesc}>
              Add Open Intelligence to begin building your analytics.
            </Text>
          </View>
        ) : (
          <>
            {/* ── 1. My Intelligence Summary ─────────────────────────── */}
            {summary ? (
              <View style={anStyles.sectionCard}>
                <SectionHeader
                  icon={<BarChart3 color={palette.cyan} size={14} />}
                  title="My Intelligence Summary"
                  accent={palette.cyan}
                />
                <View style={anStyles.statGrid}>
                  <StatTile label="Total Entries" value={summary.totalEntries} />
                  <StatTile label="Active" value={summary.activeEntries} color={palette.success} />
                  <StatTile label="Pending Review" value={summary.pendingReview} color={palette.muted} />
                  <StatTile label="Community Supported" value={summary.communitySupported} color={palette.cyan} />
                  <StatTile label="Externally Supported" value={summary.externallySupported} color={palette.success} />
                  <StatTile label="Disputed" value={summary.disputed} color={palette.ember} />
                  <StatTile label="Withdrawn" value={summary.withdrawn} color={palette.muted} />
                  <StatTile label="Rejected" value={summary.rejected} color={palette.ember} />
                  <StatTile label="Outdated" value={summary.outdated} color={palette.gold} />
                  <StatTile label="Avg Quality" value={Math.round(summary.avgQuality)} color={palette.cyan} />
                  <StatTile label="Avg Influence" value={Math.round(summary.avgInfluence)} color={palette.violet} />
                  <StatTile label="Shared (Faction)" value={summary.sharedWithFaction} color={palette.violet} />
                  <StatTile label="Shared (Exchange)" value={summary.sharedOnExchange} color={palette.gold} />
                </View>
              </View>
            ) : null}

            {/* ── 2. Contributor Reputation ───────────────────────────── */}
            {reputation ? (
              <View style={anStyles.sectionCard}>
                <SectionHeader
                  icon={<Shield color={palette.success} size={14} />}
                  title="Contributor Reputation"
                  accent={palette.success}
                />
                <View style={anStyles.reputationTopRow}>
                  <View style={[anStyles.reputationScoreWrap, { borderColor: `${trustLabelColor(reputation.overallScore)}44` }]}>
                    <Text style={[anStyles.reputationScore, { color: trustLabelColor(reputation.overallScore) }]}>
                      {Math.round(reputation.overallScore)}
                    </Text>
                    <Text style={[anStyles.reputationLabel, { color: trustLabelColor(reputation.overallScore) }]}>
                      {trustLabel(reputation.overallScore)}
                    </Text>
                  </View>
                  <View style={anStyles.reputationComponents}>
                    <View style={anStyles.repCompRow}>
                      <Text style={anStyles.repCompLabel}>Quality</Text>
                      <Text style={anStyles.repCompValue}>{Math.round(reputation.qualityComponent)}</Text>
                    </View>
                    <View style={anStyles.repCompRow}>
                      <Text style={anStyles.repCompLabel}>Usefulness</Text>
                      <Text style={anStyles.repCompValue}>{Math.round(reputation.usefulnessComponent)}</Text>
                    </View>
                    <View style={anStyles.repCompRow}>
                      <Text style={anStyles.repCompLabel}>Validation</Text>
                      <Text style={anStyles.repCompValue}>{Math.round(reputation.validationComponent)}</Text>
                    </View>
                    <View style={anStyles.repCompRow}>
                      <Text style={anStyles.repCompLabel}>Reliability</Text>
                      <Text style={anStyles.repCompValue}>{Math.round(reputation.reliabilityComponent)}</Text>
                    </View>
                  </View>
                </View>
                {reputation.calculatedAt ? (
                  <View style={anStyles.calcDateRow}>
                    <Clock color={palette.muted} size={10} />
                    <Text style={anStyles.calcDateText}>
                      Calculated: {new Date(reputation.calculatedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* ── 3. Entry Performance ────────────────────────────────── */}
            <View style={anStyles.sectionCard}>
              <SectionHeader
                icon={<Eye color={palette.cyan} size={14} />}
                title="Entry Performance"
                accent={palette.cyan}
              />
              {entryPerformance.length === 0 ? (
                <Text style={anStyles.sectionEmpty}>No entry performance data yet.</Text>
              ) : (
                <View style={anStyles.perfList}>
                  {entryPerformance.slice(0, 20).map((perf, idx) => (
                    <PerformanceRow key={perf.entryId} perf={perf} index={idx} />
                  ))}
                </View>
              )}
            </View>

            {/* ── 4. Trend Display ────────────────────────────────────── */}
            <View style={anStyles.sectionCard}>
              <SectionHeader
                icon={<TrendingUp color={palette.gold} size={14} />}
                title="Trends (Weekly)"
                accent={palette.gold}
              />
              {weeklyTrend.length === 0 ? (
                <Text style={anStyles.sectionEmpty}>No trend data yet.</Text>
              ) : (
                <View style={anStyles.trendContainer}>
                  <Text style={anStyles.trendSubtitle}>Entries Created Over Time</Text>
                  <TrendChart data={weeklyTrend} metric="entriesCreated" color={palette.cyan} />

                  <Text style={[anStyles.trendSubtitle, { marginTop: 14 }]}>Average Quality Over Time</Text>
                  <TrendChart data={weeklyTrend} metric="avgQuality" color={palette.success} />

                  <Text style={[anStyles.trendSubtitle, { marginTop: 14 }]}>Analyst Usage Over Time</Text>
                  <TrendChart data={weeklyTrend} metric="analystUses" color={palette.violet} />

                  <Text style={[anStyles.trendSubtitle, { marginTop: 14 }]}>Feedback Over Time</Text>
                  <TrendChart data={weeklyTrend} metric="feedbackCount" color={palette.gold} />
                </View>
              )}
            </View>

            {/* ── 5. Faction Contribution Insights ────────────────────── */}
            <View style={anStyles.sectionCard}>
              <SectionHeader
                icon={<Users color={palette.violet} size={14} />}
                title="Faction Contribution Insights"
                accent={palette.violet}
              />
              {factionContributions.length === 0 ? (
                <Text style={anStyles.sectionEmpty}>No Faction contribution data yet.</Text>
              ) : (
                <View style={anStyles.factionList}>
                  {factionContributions.map((fc) => (
                    <FactionContributionCard
                      key={fc.factionId}
                      contribution={fc}
                      faction={factionMap.get(fc.factionId)}
                    />
                  ))}
                </View>
              )}
            </View>

            {/* ── 6. Exchange Contribution Insights ───────────────────── */}
            <View style={anStyles.sectionCard}>
              <SectionHeader
                icon={<Share2 color={palette.gold} size={14} />}
                title="Exchange Contribution Insights"
                accent={palette.gold}
              />
              {exchangeContributions ? (
                <View style={anStyles.statGrid}>
                  <StatTile label="Eligible Entries" value={exchangeContributions.eligibleExchangeEntries} color={palette.gold} />
                  <StatTile label="Synced Entries Used" value={exchangeContributions.synchronizedEntriesUsed} color={palette.cyan} />
                  <StatTile label="Avg Shared Quality" value={Math.round(exchangeContributions.avgSharedQuality)} color={palette.text} />
                  <StatTile label="Supported Rate" value={`${Math.round(exchangeContributions.supportedEntryRate * 100)}%`} color={palette.success} />
                  <StatTile label="Dispute Rate" value={`${Math.round(exchangeContributions.disputeRate * 100)}%`} color={exchangeContributions.disputeRate > 0 ? palette.ember : palette.muted} />
                  <StatTile label="Active Purchases" value={exchangeContributions.activePurchases} color={palette.cyan} />
                  <StatTile label="Expired Purchases" value={exchangeContributions.expiredPurchases} color={palette.muted} />
                </View>
              ) : (
                <Text style={anStyles.sectionEmpty}>No Exchange activity yet.</Text>
              )}
            </View>

            {/* ── Security note ───────────────────────────────────────── */}
            <View style={anStyles.securityNote}>
              <Shield color={palette.muted} size={11} />
              <Text style={anStyles.securityText}>
                Analytics show only your own data. Reviewer identities, buyer
                identities, and internal moderation data remain private.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const anStyles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 8, paddingTop: 6, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: palette.line,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, alignItems: "center" },
  kicker: { color: palette.cyan, fontSize: 9, fontWeight: "900", letterSpacing: 2 },
  title: { color: palette.text, fontSize: 18, fontWeight: "900", marginTop: 1 },

  scroll: { flex: 1 },
  scrollContent: { padding: 14, gap: 12, paddingBottom: 40 },

  // Section card
  sectionCard: {
    borderRadius: 6, borderWidth: 1, borderColor: palette.line,
    backgroundColor: "rgba(10,20,38,0.45)", padding: 12, gap: 10,
  },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionIconWrap: {
    width: 28, height: 28, borderRadius: 5,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1,
  },
  sectionTitle: { fontSize: 12, fontWeight: "900", letterSpacing: 1 },

  // Stat grid
  statGrid: {
    flexDirection: "row", flexWrap: "wrap", gap: 6,
  },
  statTile: {
    width: "31.5%", paddingVertical: 8, paddingHorizontal: 6, borderRadius: 4,
    borderWidth: 1, borderColor: palette.line,
    backgroundColor: "rgba(255,255,255,0.02)",
    alignItems: "center", gap: 2,
  },
  statValue: { fontSize: 18, fontWeight: "900" },
  statLabel: {
    fontSize: 8, fontWeight: "700", color: palette.muted,
    textTransform: "uppercase", letterSpacing: 0.4, textAlign: "center",
  },

  // Reputation
  reputationTopRow: { flexDirection: "row", gap: 12, alignItems: "center" },
  reputationScoreWrap: {
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 2, alignItems: "center", justifyContent: "center", gap: 2,
  },
  reputationScore: { fontSize: 28, fontWeight: "900" },
  reputationLabel: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  reputationComponents: { flex: 1, gap: 4 },
  repCompRow: {
    flexDirection: "row", justifyContent: "space-between",
    paddingVertical: 3, paddingHorizontal: 8, borderRadius: 4,
    borderWidth: 1, borderColor: palette.line,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  repCompLabel: { fontSize: 11, fontWeight: "700", color: palette.muted },
  repCompValue: { fontSize: 11, fontWeight: "900", color: palette.text },
  calcDateRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  calcDateText: { fontSize: 9, fontWeight: "700", color: palette.muted },

  // Entry performance
  perfList: { gap: 6 },
  perfRow: {
    flexDirection: "row", gap: 8, borderRadius: 5, borderWidth: 1,
    borderColor: palette.line, backgroundColor: "rgba(255,255,255,0.02)",
    padding: 8,
  },
  perfIndex: {
    width: 24, height: 24, borderRadius: 4, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  perfIndexText: { fontSize: 10, fontWeight: "900" },
  perfContent: { flex: 1, gap: 4 },
  perfTopRow: { flexDirection: "row", gap: 5, flexWrap: "wrap" },
  perfBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, borderWidth: 1,
  },
  perfBadgeText: { fontSize: 8, fontWeight: "800", letterSpacing: 0.3 },
  perfMetrics: {
    flexDirection: "row", flexWrap: "wrap", gap: 6,
  },
  perfMetric: { fontSize: 10, fontWeight: "700", color: palette.muted },
  perfFooter: { flexDirection: "row", alignItems: "center", gap: 3 },
  perfLastUsed: { fontSize: 9, fontWeight: "700", color: palette.muted },

  // Trend chart
  trendContainer: { gap: 4 },
  trendSubtitle: {
    fontSize: 10, fontWeight: "800", color: palette.muted,
    textTransform: "uppercase", letterSpacing: 0.5,
  },
  chartWrap: {
    flexDirection: "row", gap: 4, alignItems: "flex-end",
    paddingVertical: 8, paddingHorizontal: 4,
    borderRadius: 5, borderWidth: 1, borderColor: palette.line,
    backgroundColor: "rgba(255,255,255,0.02)",
    minHeight: 100,
  },
  chartEmpty: { color: palette.muted, fontSize: 11, fontWeight: "700", paddingVertical: 20, textAlign: "center" },
  barCol: { flex: 1, alignItems: "center", gap: 3 },
  barTrack: {
    width: "100%", height: 60, justifyContent: "flex-end",
    backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 3, overflow: "hidden",
  },
  barFill: {
    width: "100%", borderRadius: 2,
  },
  barValue: { fontSize: 8, fontWeight: "800", color: palette.text },
  barLabel: { fontSize: 7, fontWeight: "700", color: palette.muted },

  // Faction contributions
  factionList: { gap: 8 },
  factionCard: {
    borderRadius: 5, borderWidth: 1, borderColor: `${palette.violet}22`,
    backgroundColor: `${palette.violet}06`, padding: 10, gap: 8,
  },
  factionHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  factionName: { fontSize: 12, fontWeight: "900", color: palette.text, flex: 1 },
  factionMetrics: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  // factionMetrics uses statTile widths — override for 5 cols
  // StatTile is 31.5% wide; for 5 items it wraps naturally

  // Security note
  securityNote: {
    flexDirection: "row", gap: 8, padding: 10, borderRadius: 5,
    borderWidth: 1, borderColor: palette.line,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  securityText: {
    flex: 1, fontSize: 10, fontWeight: "700", color: palette.muted, lineHeight: 15,
  },

  // Empty / error states
  emptyState: { alignItems: "center", paddingVertical: 50, gap: 10 },
  emptyTitle: { color: palette.text, fontSize: 16, fontWeight: "900" },
  emptyDesc: { color: palette.muted, fontSize: 12, fontWeight: "700", textAlign: "center", lineHeight: 18 },
  sectionEmpty: {
    color: palette.muted, fontSize: 11, fontWeight: "700",
    paddingVertical: 12, textAlign: "center",
  },

  pressed: { transform: [{ scale: 0.985 }], opacity: 0.88 },
});
