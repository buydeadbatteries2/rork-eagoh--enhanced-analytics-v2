import { palette } from "@/constants/colors";
import { useAppTheme } from "@/providers/ThemeProvider";
import { getTeamById } from "@/data/teams";
import { HORIZONTAL_LIST_PERFORMANCE_PROPS, LIST_PERFORMANCE_PROPS, OptimizedEagohImage } from "@/app/_components/PerformancePrimitives";
import { LinearGradient } from "expo-linear-gradient";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Award,
  BarChart3,
  ChevronDown,
  Filter,
  Medal,
  Search,
  SlidersHorizontal,
  Star,
  TrendingUp,
  Trophy,
  Users,
  X,
  Zap,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  CATEGORY_LABELS,
  getLeaderboard,
  getLeaderboardDomains,
  LEADERBOARD_CATEGORIES,
  TIMEFRAMES,
  TIMEFRAME_LABELS,
  type LeaderboardCategory,
  type LeaderboardEntry,
  type LeaderboardFilters,
  type Timeframe,
} from "@/services/leaderboards";
import {
  rankColor as repRankColor,
  RANK_TIERS,
  type RankTier,
} from "@/services/reputation";

// ── Helpers ────────────────────────────────────────────────────────────

function domainLabel(d: string): string {
  return d.charAt(0).toUpperCase() + d.slice(1).replace(/_/g, " ");
}

function rankEmoji(rank: string): string {
  if (rank === "Syndicate Prime") return "★";
  if (rank === "Oracle") return "◆";
  if (rank === "Diamond") return "◇";
  if (rank === "Platinum") return "●";
  if (rank === "Gold") return "⬡";
  return "";
}

function rankColor(rank: string): string {
  if (RANK_TIERS.includes(rank as RankTier)) return repRankColor(rank as RankTier);
  return palette.muted;
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }): JSX.Element {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

// ── Rank Medal ─────────────────────────────────────────────────────────

function RankMedal({ rank }: { rank: number }): JSX.Element {
  const medalColor = rank === 1 ? "#FFD700" : rank === 2 ? "#C0C0C0" : rank === 3 ? "#CD7F32" : palette.muted;
  const Icon = rank <= 3 ? Medal : undefined;
  return (
    <View style={[styles.rankMedal, rank <= 3 && { borderColor: `${medalColor}44`, backgroundColor: `${medalColor}18` }]}>
      {Icon ? (
        <Icon color={medalColor} size={18} />
      ) : (
        <Text style={[styles.rankNumberText, rank <= 10 && { color: palette.text }]}>{rank}</Text>
      )}
    </View>
  );
}

// ── Leaderboard Card ───────────────────────────────────────────────────

const LeaderboardCard = React.memo(function LeaderboardCard({ item }: { item: LeaderboardEntry }): JSX.Element {
  const rkColor = rankColor(item.rank_tier);
  return (
    <View style={styles.card}>
      <View style={[styles.cardGlow, { backgroundColor: rkColor }]} />

      <View style={styles.cardLeft}>
        <RankMedal rank={item.rank} />
        <View style={styles.cardImageWrap}>
          {item.image_thumb_url ? (
            <OptimizedEagohImage
              tone={item.rank_tier === "Syndicate Prime" || item.rank_tier === "Oracle" ? "gold" : item.rank_tier === "Diamond" ? "cyan" : "violet"}
              label={item.eagoh_name}
              size="compact"
            />
          ) : (
            <View style={styles.cardImagePlaceholder}>
              <Star color={rkColor} size={22} />
            </View>
          )}
        </View>
      </View>

      <View style={styles.cardCenter}>
        <View style={styles.cardNameRow}>
          <Text style={styles.cardName} numberOfLines={1}>{item.eagoh_name}</Text>
          <View style={[styles.rankBadge, { borderColor: `${rkColor}44`, backgroundColor: `${rkColor}18` }]}>
            <Text style={[styles.rankBadgeText, { color: rkColor }]}>{rankEmoji(item.rank_tier)} {item.rank_tier}</Text>
          </View>
        </View>
        <Text style={styles.cardOwner}>by {item.owner_username || "Anonymous"}</Text>
        <Text style={styles.cardDomain}>{domainLabel(item.domain)}</Text>
        {item.primary_dna.length > 0 && (
          <View style={styles.dnaRow}>
            {item.primary_dna.slice(0, 2).map((d) => (
              <View key={d} style={styles.dnaTag}>
                <Text style={styles.dnaTagText}>{d}</Text>
              </View>
            ))}
          </View>
        )}
        {(item.fanatic_teams.length > 0 || (item as any).pro_team_focus_name || (item as any).college_team_focus_name) && (
          <Text style={styles.teamText} numberOfLines={1}>
            {[
              (item as any).pro_team_focus_name,
              (item as any).college_team_focus_name,
              ...item.fanatic_teams.map((id: string) => getTeamById(id)?.display_name ?? id),
            ].filter(Boolean).join(" · ")}
          </Text>
        )}
      </View>

      <View style={styles.cardRight}>
        <View style={styles.scoreCol}>
          <Text style={[styles.scoreValue, { color: rkColor }]}>{item.reputation_score}</Text>
          <Text style={styles.scoreLabel}>Rep</Text>
        </View>
        <View style={styles.subMetrics}>
          {item.marketplace_trust > 0 && (
            <View style={styles.subMetric}>
              <Users color={palette.violet} size={10} />
              <Text style={styles.subMetricText}>{item.marketplace_trust}</Text>
            </View>
          )}
          {item.faction_influence > 0 && (
            <View style={styles.subMetric}>
              <Zap color={palette.gold} size={10} />
              <Text style={styles.subMetricText}>{item.faction_influence}</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
});

// ── Main Screen ────────────────────────────────────────────────────────

export default function LeaderboardsScreen(): JSX.Element {
  const { palette: pal } = useAppTheme();
  const h = useHaptics();
  const [category, setCategory] = useState<LeaderboardCategory>("overall");
  const [filters, setFilters] = useState<LeaderboardFilters>({});
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [domains, setDomains] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const limit = 25;

  const loadData = useCallback(async (reset: boolean = false) => {
    setLoading(true);
    const p = reset ? 0 : page;
    try {
      const result = await getLeaderboard(category, filters, limit, p * limit);
      setEntries(reset ? result.entries : [...entries, ...result.entries]);
      setTotal(result.total);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [category, filters, page]);

  useEffect(() => {
    setPage(0);
    setEntries([]);
    loadData(true);
  }, [category, filters]);

  useEffect(() => {
    if (page > 0) loadData(false);
  }, [page]);

  useEffect(() => {
    getLeaderboardDomains().then(setDomains).catch(() => undefined);
  }, []);

  const loadMore = useCallback(() => {
    if (!loading && entries.length < total) {
      setPage((p) => p + 1);
    }
  }, [loading, entries.length, total]);

  const handleCategoryChange = useCallback((cat: LeaderboardCategory) => {
    h.selection();
    setCategory(cat);
    setFilters({});
    setShowFilters(false);
  }, [h]);

  const handleFilterChange = useCallback((update: Partial<LeaderboardFilters>) => {
    setFilters((prev) => ({ ...prev, ...update }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({});
    h.selection();
  }, [h]);

  const hasActiveFilters = Object.values(filters).some((v) => v);

  const renderHeader = useCallback(() => (
    <View>
      {/* Hero */}
      <View style={styles.hero}>
        <LinearGradient colors={["rgba(255,215,0,0.14)", "rgba(54,245,255,0.08)", "rgba(10,18,30,0.92)"]} style={StyleSheet.absoluteFill} />
        <View style={styles.heroOrbit} />
        <View style={styles.heroContent}>
          <View style={styles.heroIcon}>
            <Trophy color={palette.gold} size={28} />
          </View>
          <View>
            <Text style={styles.kicker}>LEADERBOARDS</Text>
            <Text style={styles.title}>EAGOH Rankings</Text>
            <Text style={styles.subtitle}>Top-ranked intelligence entities across all domains, factions, and the marketplace.</Text>
          </View>
        </View>
      </View>

      {/* Category Tabs */}
      <View style={styles.categorySection}>
        <SectionHeader eyebrow="CATEGORIES" title="View Rankings By" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRail} {...HORIZONTAL_LIST_PERFORMANCE_PROPS}>
          {LEADERBOARD_CATEGORIES.map((cat) => (
            <Pressable
              key={cat}
              onPress={() => handleCategoryChange(cat)}
              style={[styles.categoryChip, category === cat && styles.categoryChipActive]}
            >
              <Text style={[styles.categoryChipText, category === cat && styles.categoryChipTextActive]}>
                {CATEGORY_LABELS[cat]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Filters Bar */}
      <View style={styles.filtersBar}>
        <View style={styles.searchBox}>
          <Search color={palette.muted} size={16} />
          <TextInput
            value={filters.search ?? ""}
            onChangeText={(v) => handleFilterChange({ search: v || undefined })}
            placeholder="Search EAGOH name..."
            placeholderTextColor={palette.muted}
            style={styles.searchInput}
          />
          {filters.search ? (
            <Pressable onPress={() => handleFilterChange({ search: undefined })} hitSlop={8}>
              <X color={palette.muted} size={14} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => {
            h.selection();
            setShowFilters(!showFilters);
          }}
          style={[styles.filterToggle, showFilters && styles.filterToggleActive]}
        >
          <SlidersHorizontal color={showFilters ? palette.void : palette.cyan} size={16} />
          <Text style={[styles.filterToggleText, showFilters && styles.filterToggleTextActive]}>Filters</Text>
        </Pressable>
        {hasActiveFilters && (
          <Pressable onPress={clearFilters} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>Clear</Text>
          </Pressable>
        )}
      </View>

      {/* Expanded Filter Panel */}
      {showFilters && (
        <View style={styles.filterPanel}>
          {/* Domain */}
          {domains.length > 0 && (
            <View>
              <Text style={styles.filterLabel}>Domain</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRail}>
                <Pressable
                  onPress={() => handleFilterChange({ domain: undefined })}
                  style={[styles.chip, !filters.domain && styles.chipActive]}
                >
                  <Text style={[styles.chipText, !filters.domain && styles.chipTextActive]}>All</Text>
                </Pressable>
                {domains.map((d) => (
                  <Pressable
                    key={d}
                    onPress={() => handleFilterChange({ domain: d })}
                    style={[styles.chip, filters.domain === d && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, filters.domain === d && styles.chipTextActive]}>{domainLabel(d)}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Rank Tier */}
          <View>
            <Text style={styles.filterLabel}>Rank Tier</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRail}>
              <Pressable
                onPress={() => handleFilterChange({ rankTier: undefined })}
                style={[styles.chip, !filters.rankTier && styles.chipActive]}
              >
                <Text style={[styles.chipText, !filters.rankTier && styles.chipTextActive]}>All</Text>
              </Pressable>
              {RANK_TIERS.filter((r) => r !== "Dormant").map((r) => (
                <Pressable
                  key={r}
                  onPress={() => handleFilterChange({ rankTier: r })}
                  style={[styles.chip, filters.rankTier === r && styles.chipActive]}
                >
                  <Text style={[styles.chipText, filters.rankTier === r && styles.chipTextActive]}>{r}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {/* Timeframe */}
          <View>
            <Text style={styles.filterLabel}>Timeframe</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRail}>
              {TIMEFRAMES.map((tf) => (
                <Pressable
                  key={tf}
                  onPress={() => handleFilterChange({ timeframe: (filters.timeframe === tf ? undefined : tf) })}
                  style={[styles.chip, filters.timeframe === tf && styles.chipActive]}
                >
                  <Text style={[styles.chipText, filters.timeframe === tf && styles.chipTextActive]}>{TIMEFRAME_LABELS[tf]}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      )}

      {/* Result count */}
      <View style={styles.countRow}>
        <Text style={styles.countText}>
          {total} EAGOH{total !== 1 ? "s" : ""} ranked
        </Text>
        {category !== "overall" && (
          <Text style={styles.countCategory}>{CATEGORY_LABELS[category]}</Text>
        )}
      </View>
    </View>
  ), [category, showFilters, filters, domains, hasActiveFilters, handleCategoryChange, handleFilterChange, clearFilters]);

  const renderItem = useCallback(
    ({ item }: { item: LeaderboardEntry }) => <LeaderboardCard item={item} />,
    [],
  );

  if (loading && entries.length === 0) {
    return (
      <LinearGradient colors={[pal.void, pal.obsidian, pal.graphite]} style={styles.root}>
        <SafeAreaView edges={["top"]} style={styles.safe}>
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={palette.gold} size="large" />
            <Text style={styles.loadingText}>Loading Rankings...</Text>
          </View>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={[pal.void, pal.obsidian, pal.graphite]} style={styles.root}>
      <SafeAreaView edges={["top"]} style={styles.safe}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
        <FlatList
          data={entries}
          renderItem={renderItem}
          keyExtractor={(item) => item.eagoh_id}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <BarChart3 color={palette.muted} size={40} />
              <Text style={styles.emptyTitle}>No Rankings Found</Text>
              <Text style={styles.emptyBody}>
                {hasActiveFilters ? "Try adjusting your filters." : "No EAGOHs have been ranked yet. Forge an EAGOH and start building reputation!"}
              </Text>
            </View>
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          {...LIST_PERFORMANCE_PROPS}
        />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 120, gap: 10 },

  // Hero
  hero: {
    borderRadius: 5,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,215,0,0.20)",
    padding: 20,
    backgroundColor: palette.panelStrong,
  },
  heroOrbit: {
    position: "absolute",
    right: -60,
    top: -60,
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 1,
    borderColor: "rgba(255,215,0,0.16)",
  },
  heroContent: { flexDirection: "row", alignItems: "center", gap: 14 },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "rgba(255,215,0,0.30)",
    backgroundColor: "rgba(255,215,0,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  kicker: { color: palette.gold, fontSize: 11, fontWeight: "900", letterSpacing: 2.2 },
  title: { color: palette.text, fontSize: 28, fontWeight: "900", letterSpacing: -0.6 },
  subtitle: { color: palette.muted, fontSize: 13, lineHeight: 19, marginTop: 4, fontWeight: "700" },

  // Section
  sectionHeader: { marginBottom: 6 },
  eyebrow: { color: palette.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 1.8 },
  sectionTitle: { color: palette.text, fontSize: 18, fontWeight: "900", marginTop: 2 },

  // Category chips
  categorySection: { marginTop: 8 },
  categoryRail: { gap: 8, paddingRight: 8 },
  categoryChip: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  categoryChipActive: { backgroundColor: palette.gold, borderColor: palette.gold },
  categoryChipText: { color: palette.muted, fontSize: 12, fontWeight: "900" },
  categoryChipTextActive: { color: palette.void },

  // Filters bar
  filtersBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 40,
    borderRadius: 5,
    paddingHorizontal: 10,
    backgroundColor: "rgba(3,6,11,0.62)",
    borderWidth: 1,
    borderColor: palette.line,
  },
  searchInput: { color: palette.text, flex: 1, fontSize: 13, fontWeight: "800" },
  filterToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: palette.cyanSoft,
    borderWidth: 1,
    borderColor: palette.cyan,
  },
  filterToggleActive: { backgroundColor: palette.cyan, borderColor: palette.cyan },
  filterToggleText: { color: palette.cyan, fontSize: 11, fontWeight: "900" },
  filterToggleTextActive: { color: palette.void },
  clearBtn: {
    borderRadius: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: palette.emberSoft,
  },
  clearBtnText: { color: palette.ember, fontSize: 11, fontWeight: "900" },

  // Filter panel
  filterPanel: {
    borderRadius: 5,
    padding: 12,
    backgroundColor: "rgba(14,24,37,0.76)",
    borderWidth: 1,
    borderColor: palette.line,
    gap: 12,
  },
  filterLabel: { color: palette.muted, fontSize: 10, fontWeight: "900", letterSpacing: 1, marginBottom: 4 },
  chipRail: { gap: 7, paddingRight: 8 },
  chip: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  chipActive: { backgroundColor: palette.cyan, borderColor: palette.cyan },
  chipText: { color: palette.muted, fontSize: 11, fontWeight: "900" },
  chipTextActive: { color: palette.void },

  // Count row
  countRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  countText: { color: palette.muted, fontSize: 12, fontWeight: "800" },
  countCategory: { color: palette.gold, fontSize: 12, fontWeight: "900" },

  // Card
  card: {
    flexDirection: "row",
    borderRadius: 5,
    padding: 12,
    backgroundColor: "rgba(14,24,37,0.84)",
    borderWidth: 1,
    borderColor: palette.line,
    overflow: "hidden",
    gap: 10,
  },
  cardGlow: { position: "absolute", width: 80, height: 80, borderRadius: 40, opacity: 0.08, right: -20, top: -20 },
  cardLeft: { alignItems: "center", gap: 8 },
  rankMedal: {
    width: 36,
    height: 36,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(3,6,11,0.55)",
  },
  rankNumberText: { color: palette.muted, fontSize: 14, fontWeight: "900" },
  cardImageWrap: {
    width: 56,
    height: 68,
    borderRadius: 5,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.line,
  },
  cardImagePlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(3,6,11,0.5)",
  },
  cardCenter: { flex: 1, gap: 2, justifyContent: "center" },
  cardNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardName: { color: palette.text, fontSize: 15, fontWeight: "900", flex: 1 },
  rankBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  rankBadgeText: { fontSize: 9, fontWeight: "900" },
  cardOwner: { color: palette.muted, fontSize: 11, fontWeight: "700" },
  cardDomain: { color: palette.cyan, fontSize: 11, fontWeight: "800" },
  dnaRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 },
  dnaTag: {
    backgroundColor: "rgba(138,92,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(138,92,255,0.22)",
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  dnaTagText: { color: palette.violet, fontSize: 9, fontWeight: "900" },
  teamText: { color: palette.gold, fontSize: 10, fontWeight: "800", marginTop: 2 },
  cardRight: { alignItems: "flex-end", justifyContent: "center", gap: 6, minWidth: 56 },
  scoreCol: { alignItems: "center" },
  scoreValue: { fontSize: 22, fontWeight: "900" },
  scoreLabel: { color: palette.muted, fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  subMetrics: { gap: 3 },
  subMetric: { flexDirection: "row", alignItems: "center", gap: 3 },
  subMetricText: { color: palette.text, fontSize: 10, fontWeight: "800" },

  // Loading
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  loadingText: { color: palette.muted, fontSize: 14, fontWeight: "800" },

  // Empty
  emptyWrap: { alignItems: "center", paddingVertical: 50, gap: 10 },
  emptyTitle: { color: palette.text, fontSize: 18, fontWeight: "900" },
  emptyBody: { color: palette.muted, fontSize: 13, fontWeight: "700", textAlign: "center", lineHeight: 19, paddingHorizontal: 30 },
});
