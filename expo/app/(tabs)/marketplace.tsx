import { palette } from "@/constants/colors";
import { useAppTheme } from "@/providers/ThemeProvider";
import { getTeamById } from "@/data/teams";
import { HORIZONTAL_LIST_PERFORMANCE_PROPS, LIST_PERFORMANCE_PROPS, OptimizedEagohImage, type RenderTone } from "@/app/_components/PerformancePrimitives";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useHaptics } from "@/hooks/useHaptics";
import {
  ArrowRightLeft,
  Award,
  BadgeCheck,
  BookOpen,
  Clock,
  ChevronDown,
  Coins,
  Crown,
  Dna,
  Filter,
  Info,
  Link2,
  PackageOpen,
  Pencil,
  PlusCircle,
  Power,
  ScrollText,
  Search,
  Share2,
  Shield,
  Signal,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tag,
  UserCheck,
  AlertTriangle,
  Megaphone,
  TrendingUp,
  X,
} from "lucide-react-native";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import PublicProfileModal from "@/components/PublicProfileModal";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Dimensions,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/providers/AuthProvider";
import { useEdge } from "@/providers/EdgeProvider";
import { useEagohs } from "@/providers/EagohProvider";
import { useProfile } from "@/providers/ProfileProvider";
import {
  canTransact,
  computeTotalCost,
  createListing,
  getActiveFilters,
  getActiveSyncs,
  getMyListings,
  getMyPurchases,
  getVendorStats,
  listActiveListings,
  purchaseSync,
  recalculateVendorStats,
  resolveMarketplaceEagohImage,
  toggleListingActive,
  updateListing,
  type EnrichedListing,
  type EnrichedPurchase,
  type ListingFilters,
  type SyncLevel,
} from "@/services/marketplace";
import type { EagohRecord } from "@/services/eagohs";
import {
  getActiveBanners,
  recordBannerImpression,
  recordBannerTap,
  recordBannerTapHold,
  type EnrichedBanner,
} from "@/services/sponsoredBanners";
import {
  getPublicEagohCredentials,
  type EagohCredentialsRow,
} from "@/services/eagohCredentials";
import { getBulkReputations, rankColor as repRankColor, RANK_TIERS, type RankTier } from "@/services/reputation";
import type { ReputationRow } from "@/services/reputation";
import { supabase } from "@/lib/supabase";
import { getLeaderboard } from "@/services/leaderboards";
import { shareListing, copyListingLink } from "@/services/sharing";
import {
  fetchVendorQualityMetrics,
  fetchBulkPublicReputations,
  trustLabel,
  trustLabelColor,
  applyEntryFilters,
  DEFAULT_FILTERS,
  SORT_LABELS,
  VALIDATION_STATUS_FILTER_OPTIONS,
  type VendorQualityMetrics,
  type PublicReputation,
  type OpenIntelligenceRow,
  type MyIntelligenceFilters,
  type SortOption,
} from "@/services/openIntelligence";
import {
  IntelligenceEntryCard,
  FeedbackModal,
  DisputeModal,
  type FeedbackAccessInfo,
} from "@/app/_components/IntelligenceTrust";

// ── Constants ──────────────────────────────────────────────────────────

const SYNC_LEVELS: SyncLevel[] = ["25%", "50%", "75%", "100%"];
const DAYS = [1, 2, 3, 4, 5];
const RANKS = ["Any Rank", "Syndicate Prime", "Oracle", "Diamond", "Platinum", "Gold", "Silver", "Bronze", "Activated"];

const RANK_FILTER_OPTIONS = ["Any Rank", "Syndicate Prime", "Oracle", "Diamond", "Platinum", "Gold", "Silver", "Bronze", "Activated"];

const SYNC_DESCRIPTIONS: Record<SyncLevel, string> = {
  "25%": "Basic surface-level intelligence signals",
  "50%": "Moderate depth analysis patterns",
  "75%": "Advanced analytical framework access",
  "100%": "Full intelligence model synchronization",
};

// ── Helpers ────────────────────────────────────────────────────────────

function domainLabel(d: string): string {
  return d.charAt(0).toUpperCase() + d.slice(1).replace(/_/g, " ");
}

// ── Domain DNA cleaning helpers ─────────────────────────────────────────
// Raw DNA entries like "dom:music_genre:hip_hop" must never be shown to users.
// These helpers extract, clean, and format domain knowledge values into
// human-readable labels (e.g. "Genre: Hip Hop").

/** Maps domain DNA column names to short human-readable labels. */
const DOMAIN_FIELD_LABELS: Record<string, string> = {
  music_genre: "Genre",
  music_role: "Role",
  film_tv_category: "Category",
  film_tv_genre: "Genre",
  film_tv_role: "Role",
  fashion_style_category: "Style",
  fashion_role: "Role",
  education_subject: "Subject",
  education_role: "Role",
  gaming_genre: "Genre",
  gaming_role: "Role",
  business_industry: "Industry",
  business_role: "Role",
  finance_focus: "Focus",
  finance_role: "Role",
  technology_area: "Area",
  technology_role: "Role",
  health_fitness_area: "Area",
  health_fitness_role: "Role",
};

/** Converts a snake_case or lowercase string to Title Case. */
function toTitleCase(str: string): string {
  return str
    .replace(/_/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Cleans a raw domain DNA entry (e.g. "dom:music_genre:hip_hop") into a
 * human-readable value (e.g. "Hip Hop"). Returns null for non-dom entries.
 */
function cleanDomainValue(entry: string): string | null {
  if (!entry.startsWith("dom:")) return null;
  const rest = entry.slice(4);
  const colonIdx = rest.indexOf(":");
  if (colonIdx <= 0) return null;
  return toTitleCase(rest.slice(colonIdx + 1));
}

/** Extracts the field key from a domain DNA entry for labeling. */
function domainFieldKey(entry: string): string | null {
  if (!entry.startsWith("dom:")) return null;
  const rest = entry.slice(4);
  const colonIdx = rest.indexOf(":");
  if (colonIdx <= 0) return null;
  return rest.slice(0, colonIdx);
}

type CleanedKnowledgeAttr = { label: string; value: string };

/**
 * Parses an EAGOH's DNA array and returns cleaned knowledge attributes.
 * Separates domain DNA entries (dom:...) from archetype DNA tags.
 * Returns up to `maxDisplay` attributes plus a count of remaining ones.
 */
function parseKnowledgeAttributes(
  dna: string[] | undefined | null,
  maxDisplay: number = 2,
): { attrs: CleanedKnowledgeAttr[]; archetypeTags: string[]; remainingCount: number } {
  if (!dna || dna.length === 0) {
    return { attrs: [], archetypeTags: [], remainingCount: 0 };
  }
  const attrs: CleanedKnowledgeAttr[] = [];
  const archetypeTags: string[] = [];
  for (const entry of dna) {
    if (entry.startsWith("dom:")) {
      const key = domainFieldKey(entry);
      const value = cleanDomainValue(entry);
      if (key && value) {
        const label = DOMAIN_FIELD_LABELS[key] ?? toTitleCase(key.replace(/_role$/, "").replace(/_genre$/, "").replace(/_category$/, ""));
        attrs.push({ label, value });
      }
    } else {
      archetypeTags.push(entry);
    }
  }
  const remainingCount = Math.max(0, attrs.length - maxDisplay);
  return { attrs: attrs.slice(0, maxDisplay), archetypeTags, remainingCount };
}

function timeLeft(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h left`;
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return `${days}d ${remainHours}h left`;
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
  switch (rank) {
    case "S-TIER": return palette.gold;
    case "ELITE": return palette.cyan;
    case "PRO": return palette.violet;
    case "RISING": return palette.success;
    default: return palette.muted;
  }
}

// ── Sub-components ─────────────────────────────────────────────────────

function Hero(): JSX.Element {
  return (
    <View style={styles.hero}>
      <LinearGradient
        colors={["rgba(54,245,255,0.18)", "rgba(138,92,255,0.12)", "rgba(255,184,77,0.07)"]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.radarDisc} />
      <Text style={styles.kicker}>EAGOH MARKETPLACE</Text>
      <Text style={styles.title}>Intelligence Exchange</Text>
      <Text style={styles.subtitle}>
        Browse premium EAGOH analyst entities. Paid subscribers can buy sync access
        and list their own EAGOHs for sale. Syncs expire automatically.
      </Text>
      <View style={styles.heroStats}>
        <View style={styles.heroStat}>
          <Shield color={palette.cyan} size={14} />
          <Text style={styles.heroStatText}>Secure Sync</Text>
        </View>
        <View style={styles.heroStat}>
          <Clock color={palette.gold} size={14} />
          <Text style={styles.heroStatText}>1-5 Day Access</Text>
        </View>
        <View style={styles.heroStat}>
          <ArrowRightLeft color={palette.violet} size={14} />
          <Text style={styles.heroStatText}>No Platform Fee</Text>
        </View>
      </View>
    </View>
  );
}

// ── Vendor Stats Card ──────────────────────────────────────────────────

const VendorStatsCard = memo(function VendorStatsCard(): JSX.Element | null {
  const { user } = useAuth();
  const { profile, effectiveSubscriptionTier: tier } = useProfile();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user?.id || !profile || !canTransact(tier)) return;
    setLoading(true);
    getVendorStats(user.id)
      .then((s) => { setStats(s); setLoading(false); })
      .catch(() => setLoading(false));
  }, [user?.id, profile]);

  if (!profile || !canTransact(tier) || loading) return null;
  if (!stats || stats.total_listings === 0) return null;

  return (
    <View style={styles.vendorStatsCard}>
      <LinearGradient colors={["rgba(138,92,255,0.18)", "rgba(10,20,38,0.90)"]} style={StyleSheet.absoluteFill} />
      <View style={styles.vendorStatsHeader}>
        <Crown color={palette.violet} size={18} />
        <Text style={styles.vendorStatsTitle}>Vendor Dashboard</Text>
        <Text style={[styles.rankBadge, { color: rankColor(stats.rank), borderColor: `${rankColor(stats.rank)}55` }]}>{stats.rank}</Text>
      </View>
      <View style={styles.vendorStatsGrid}>
        <View style={styles.vendorStatItem}>
          <Text style={styles.vendorStatValue}>{stats.active_listings}</Text>
          <Text style={styles.vendorStatLabel}>Active</Text>
        </View>
        <View style={styles.vendorStatItem}>
          <Text style={styles.vendorStatValue}>{stats.total_sales}</Text>
          <Text style={styles.vendorStatLabel}>Sales</Text>
        </View>
        <View style={styles.vendorStatItem}>
          <Text style={[styles.vendorStatValue, { color: palette.gold }]}>{stats.edge_earned_this_month}</Text>
          <Text style={styles.vendorStatLabel}>EC This Month</Text>
        </View>
        <View style={styles.vendorStatItem}>
          <Text style={[styles.vendorStatValue, { color: palette.cyan }]}>{stats.sync_success_score}</Text>
          <Text style={styles.vendorStatLabel}>Sync Score</Text>
        </View>
      </View>
    </View>
  );
});

// ── Filters ────────────────────────────────────────────────────────────

function FilterPanel({
  filters,
  setFilters,
  domains,
  sports,
  ranks,
}: {
  filters: ListingFilters;
  setFilters: (f: ListingFilters) => void;
  domains: string[];
  sports: string[];
  ranks: string[];
}): JSX.Element {
  const renderChips = (items: string[], selected: string | undefined, onSelect: (v: string) => void, allLabel: string = "All"): JSX.Element => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRail}>
      <Pressable onPress={() => onSelect("")} style={[styles.chip, !selected && styles.activeChip]}>
        <Text style={[styles.chipText, !selected && styles.activeChipText]}>{allLabel}</Text>
      </Pressable>
      {items.map((item) => (
        <Pressable key={item} onPress={() => onSelect(item)} style={[styles.chip, selected === item && styles.activeChip]}>
          <Text style={[styles.chipText, selected === item && styles.activeChipText]}>{item}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );

  return (
    <View style={styles.filterPanel}>
      <View style={styles.searchBox}>
        <Search color={palette.muted} size={18} />
        <TextInput
          value={filters.search ?? ""}
          onChangeText={(v) => setFilters({ ...filters, search: v || undefined })}
          placeholder="Search EAGOH, vendor, team..."
          placeholderTextColor={palette.muted}
          style={styles.searchInput}
        />
      </View>
      <View style={styles.filterHeader}>
        <SlidersHorizontal color={palette.gold} size={16} />
        <Text style={styles.filterTitle}>Filters</Text>
        {Object.values(filters).some((v) => v) && (
          <Pressable onPress={() => setFilters({})} style={styles.clearFilterBtn}>
            <Text style={styles.clearFilterText}>Clear</Text>
          </Pressable>
        )}
      </View>
      {domains.length > 0 && (
        <View>
          <Text style={styles.filterLabel}>Domain</Text>
          {renderChips(domains, filters.domain, (v) => setFilters({ ...filters, domain: v || undefined }))}
        </View>
      )}
      {sports.length > 0 && (
        <View>
          <Text style={styles.filterLabel}>Sport</Text>
          {renderChips(sports, filters.sport, (v) => setFilters({ ...filters, sport: v || undefined }))}
        </View>
      )}
      <View>
        <Text style={styles.filterLabel}>Sync Level</Text>
        {renderChips(SYNC_LEVELS, filters.syncLevel, (v) => setFilters({ ...filters, syncLevel: (v || undefined) as SyncLevel | undefined }))}
      </View>
      <View>
        <Text style={styles.filterLabel}>Vendor Rank</Text>
        {renderChips(RANKS, filters.rank, (v) => setFilters({ ...filters, rank: v || undefined }))}
      </View>
    </View>
  );
}

// ── Listing Card ───────────────────────────────────────────────────────

const ListingCard = memo(function ListingCard({
  item,
  isPaid,
  onPurchase,
  reputation,
  onViewVendorProfile,
  vendorMetrics,
  vendorRep,
}: {
  item: EnrichedListing;
  isPaid: boolean;
  onPurchase: (listing: EnrichedListing) => void;
  reputation: ReputationRow | undefined;
  onViewVendorProfile: (vendorId: string) => void;
  vendorMetrics?: VendorQualityMetrics | null;
  vendorRep?: PublicReputation | null;
}): JSX.Element {
  const eagoh = item.eagoh;
  const domain = eagoh?.domain ?? eagoh?.sport ?? "Unknown";
  const minPrice = [item.price_25_per_day, item.price_50_per_day, item.price_75_per_day, item.price_100_per_day]
    .filter((p) => p > 0)
    .sort((a, b) => a - b)[0];

  const eagohRank: RankTier = (reputation?.rank as RankTier) ?? "Dormant";
  const repScore = reputation?.reputation_score ?? 0;
  const rkColor = rankColor(eagohRank);
  const imageUrl = resolveMarketplaceEagohImage(eagoh);

  // Phase 6A: Trust indicators
  const vendorTrustScore = vendorRep?.overall_score ?? 50;
  const vendorTrustLabel = trustLabel(vendorTrustScore);
  const vendorTrustColor = trustLabelColor(vendorTrustScore);
  const avgQuality = vendorMetrics?.avg_entry_quality ?? item.avg_quality_score ?? 0;
  const supportedCount = vendorMetrics?.eligible_exchange_entries ?? 0;
  const disputeRate = vendorMetrics?.dispute_rate ?? 0;

  // Dev diagnostics — logs image resolution data for marketplace troubleshooting
  if (__DEV__ && imageUrl === null && eagoh != null) {
    console.log("[Exchange Listing Image] MISSING", {
      listingId: item.id,
      sellerId: item.vendor_id,
      eagohId: item.eagoh_id,
      rawImageUrl: (eagoh as Record<string, unknown>).image_url,
      rawImageThumbUrl: (eagoh as Record<string, unknown>).image_thumb_url,
      resolvedImageUri: imageUrl,
    });
  }

  // Fixed card width for horizontal carousel — taller rectangular shape
  const cardWidth = 320;
  const imageWidth = cardWidth * 0.40; // 40% for EAGOH image
  const cardHeight = 260;

  const tone: RenderTone = eagohRank === "Syndicate Prime" || eagohRank === "Oracle" ? "gold" : eagohRank === "Diamond" ? "cyan" : "violet";

  // Parse DNA into archetype tags + cleaned knowledge attributes (max 2 on card)
  const knowledgeAttrs = parseKnowledgeAttributes(eagoh?.dna, 2);

  return (
    <View style={[styles.listingCard, { width: cardWidth, minHeight: cardHeight }]}>
      <View style={[styles.cardGlow, { backgroundColor: rkColor }]} />

      {/* ── Left: EAGOH Image (48%) ── */}
      <View style={[styles.imageSection, { width: imageWidth }]}>
        <LinearGradient
          colors={["#03060B", `${rkColor}14`, "#050D18"]}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            styles.radialSpotlight,
            {
              width: imageWidth * 0.85,
              height: imageWidth * 0.85,
              backgroundColor: `${rkColor}10`,
            },
          ]}
        />

        <View style={styles.imageWrapper}>
          <OptimizedEagohImage
            tone={tone}
            label={eagoh?.name ?? "EAGOH"}
            imageUrl={imageUrl}
            contentFit="contain"
            size="card"
            showLabel={false}
          />
        </View>

        {/* Domain badge — top left overlay */}
        <View style={styles.listingImageDomainBadge}>
          <Text style={styles.listingImageDomainBadgeText}>{domainLabel(domain)}</Text>
        </View>
        {/* Rank pill — bottom left overlay */}
        <View style={[styles.rankPillSmall, { backgroundColor: `${rkColor}1F`, borderColor: `${rkColor}44` }]}>
          <Text style={[styles.rankPillSmallText, { color: rkColor }]}>{rankEmoji(eagohRank)} {eagohRank}</Text>
        </View>
      </View>

      {/* ── Right: Info (60%) ── */}
      <View style={styles.infoSection}>
        {/* Name + rank */}
        <View style={styles.nameRow}>
          <Text style={styles.listingName} numberOfLines={2} ellipsizeMode="tail">{eagoh?.name ?? "Unnamed"}</Text>
          {repScore > 0 && (
            <View style={[styles.repScoreBadge, { borderColor: rkColor }]}>
              <Star color={rkColor} size={10} />
              <Text style={[styles.repScoreText, { color: rkColor }]}>{repScore}</Text>
            </View>
          )}
        </View>

        {/* DNA archetype tags (non-dom entries only) */}
        {knowledgeAttrs.archetypeTags.length > 0 && (
          <View style={styles.listingDna}>
            {knowledgeAttrs.archetypeTags.slice(0, 3).map((d) => (
              <View key={d} style={styles.dnaTag}>
                <Text style={styles.dnaTagText}>{d}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Cleaned knowledge attributes — max 2, human-readable */}
        {knowledgeAttrs.attrs.length > 0 && (
          <View style={styles.knowledgeRow}>
            {knowledgeAttrs.attrs.map((attr) => (
              <View key={attr.label + attr.value} style={styles.knowledgeItem}>
                <Text style={styles.knowledgeLabel}>{attr.label}</Text>
                <Text style={styles.knowledgeValue} numberOfLines={1} ellipsizeMode="tail">{attr.value}</Text>
              </View>
            ))}
            {knowledgeAttrs.remainingCount > 0 && (
              <Text style={styles.knowledgeMore}>+{knowledgeAttrs.remainingCount} more</Text>
            )}
          </View>
        )}

        {/* Team info */}
        {(item.eagoh?.pro_team_focus_name || item.eagoh?.college_team_focus_name || item.fanatic_teams.length > 0) && (
          <Text style={styles.teamText} numberOfLines={1}>
            {[
              item.eagoh?.pro_team_focus_name,
              item.eagoh?.college_team_focus_name,
              ...item.fanatic_teams.map((id: string) => getTeamById(id)?.display_name ?? id),
            ].filter(Boolean).join(" · ")}
          </Text>
        )}

        {/* Metrics */}
        <View style={styles.metricGrid}>
          <View style={styles.metricRow}>
            <Signal color={palette.success} size={11} />
            <Text style={styles.metric}>Sync: {item.sync_success_score}</Text>
          </View>
          <View style={styles.metricRow}>
            <Sparkles color={palette.cyan} size={11} />
            <Text style={styles.metric}>Quality: {Math.round(avgQuality)}</Text>
          </View>
          <View style={styles.metricRow}>
            <Coins color={palette.gold} size={11} />
            <Text style={styles.metric}>Earned: {item.edge_earned_this_month} EC/mo</Text>
          </View>
        </View>

        {/* Phase 6A: Trust indicators */}
        <View style={styles.trustRow}>
          <View style={[styles.trustPill, { borderColor: `${vendorTrustColor}33`, backgroundColor: `${vendorTrustColor}0A` }]}>
            <Star color={vendorTrustColor} size={9} />
            <Text style={[styles.trustPillText, { color: vendorTrustColor }]}>{vendorTrustLabel}</Text>
          </View>
          {supportedCount > 0 ? (
            <View style={[styles.trustPill, { borderColor: `${palette.cyan}22`, backgroundColor: `${palette.cyan}08` }]}>
              <Sparkles color={palette.cyan} size={9} />
              <Text style={[styles.trustPillText, { color: palette.cyan }]}>{supportedCount} shared</Text>
            </View>
          ) : null}
          {disputeRate > 0.1 ? (
            <View style={[styles.trustPill, { borderColor: `${palette.ember}22`, backgroundColor: `${palette.ember}08` }]}>
              <AlertTriangle color={palette.ember} size={9} />
              <Text style={[styles.trustPillText, { color: palette.ember }]}>{Math.round(disputeRate * 100)}% disputed</Text>
            </View>
          ) : null}
        </View>

        {/* Spacer pushes vendor/price/button to bottom */}
        <View style={{ flex: 1 }} />

        {/* Vendor strip */}
        <View style={styles.vendorStrip}>
          <Pressable
            onPress={() => onViewVendorProfile(item.vendor_id)}
            accessibilityLabel={`Open vendor profile for ${item.vendor_username ?? "Anonymous"}`}
            accessibilityRole="button"
            style={({ pressed }) => [
              { width: 22, height: 22, borderRadius: 11, backgroundColor: palette.graphite, overflow: "hidden" as const, borderWidth: 1, borderColor: palette.line },
              pressed && { opacity: 0.7, borderColor: palette.cyan },
            ]}
          >
            {item.vendor_avatar_url ? (
              <Image source={{ uri: item.vendor_avatar_url }} style={{ width: "100%", height: "100%" }} />
            ) : (
              <View style={{ flex: 1, alignItems: "center" as const, justifyContent: "center" as const }}>
                <UserCheck color={palette.muted} size={10} />
              </View>
            )}
          </Pressable>
          <Text style={styles.vendorText}>{item.vendor_username ?? "Anonymous"}</Text>
          {item.is_vendor_verified && (
            <BadgeCheck color={palette.cyan} size={12} />
          )}
          {reputation && (
            <>
              <View style={styles.vendorDivider} />
              <Shield color={rkColor} size={11} />
              <Text style={[styles.vendorRepText, { color: rkColor }]}>Trust: {reputation.marketplace_trust}</Text>
            </>
          )}
        </View>

        {/* Source Credentials label */}
        {item.has_credentials && (
          <View style={styles.credentialsLabel}>
            <BookOpen color={palette.cyan} size={10} />
            <Text style={styles.credentialsLabelText}>Source Credentials Available</Text>
          </View>
        )}

        {/* Price + Buy button — stacked vertically */}
        <View style={styles.priceButtonCol}>
          <Text style={styles.pricePreview}>
            From {minPrice ?? "—"} EC/day
          </Text>
          <Pressable
            onPress={() => isPaid && onPurchase(item)}
            style={({ pressed }) => [
              styles.buyButton,
              !isPaid && styles.buyButtonDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Tag color={isPaid ? palette.void : palette.muted} size={13} />
            <Text style={[styles.buyButtonText, !isPaid && styles.buyButtonTextDisabled]}>
              {isPaid ? "Purchase" : "Browse"}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
});

// ── Purchase Modal ─────────────────────────────────────────────────────

function PurchaseModal({
  visible,
  listing,
  onClose,
  onConfirm,
  showSourceInfo,
  onToggleSourceInfo,
  purchasing,
  reputation,
  onViewVendorProfile,
}: {
  visible: boolean;
  listing: EnrichedListing | null;
  onClose: () => void;
  onConfirm: (level: SyncLevel, days: number) => void;
  showSourceInfo: boolean;
  onToggleSourceInfo: () => void;
  purchasing: boolean;
  reputation: ReputationRow | undefined;
  onViewVendorProfile: (vendorId: string) => void;
}): JSX.Element {
  const [selectedLevel, setSelectedLevel] = useState<SyncLevel>("25%");
  const [selectedDays, setSelectedDays] = useState<number>(1);

  // ── Source Info local state ──────────────────────────────────────
  const [credentials, setCredentials] = useState<EagohCredentialsRow | null>(null);
  const [loadingCredentials, setLoadingCredentials] = useState(false);

  useEffect(() => {
    setSelectedLevel("25%");
    setSelectedDays(1);
  }, [listing?.id]);

  useEffect(() => {
    if (showSourceInfo && listing) {
      console.log("[PurchaseModal] Loading credentials for eagoh:", listing.eagoh_id);
      setCredentials(null);
      setLoadingCredentials(true);
      getPublicEagohCredentials(listing.eagoh_id)
        .then((row) => { setCredentials(row); setLoadingCredentials(false); })
        .catch(() => setLoadingCredentials(false));
    }
  }, [showSourceInfo, listing?.eagoh_id]);

  useEffect(() => {
    console.log("[PurchaseModal] visible:", visible, "listing:", listing?.id, "showSourceInfo:", showSourceInfo, "purchasing:", purchasing);
  }, [visible, listing?.id, showSourceInfo, purchasing]);

  if (!listing) return <></>;

  const eagoh = listing.eagoh;
  const totalCost = computeTotalCost(listing, selectedLevel, selectedDays);
  const imageUrl = resolveMarketplaceEagohImage(eagoh);

  // Source Info computed values
  const eagohRank: RankTier = (reputation?.rank as RankTier) ?? "Dormant";
  const rkColor = rankColor(eagohRank);
  const repScore = reputation?.reputation_score ?? 0;
  const detailKnowledgeAttrs = parseKnowledgeAttributes(eagoh?.dna, 99);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay} pointerEvents="box-none">
        {/* Backdrop — taps outside the sheet close the modal */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />

        {/* ── Main Purchase Sheet ── */}
        <View style={styles.modalSheet}>
          <LinearGradient colors={["#0A1628", "#050D18"]} style={StyleSheet.absoluteFill} pointerEvents="none" />
          {/* Fixed header */}
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Purchase Sync</Text>
            <Pressable onPress={onClose} style={styles.modalClose}>
              <X color={palette.muted} size={20} />
            </Pressable>
          </View>

          {/* EAGOH preview */}
          <View style={styles.modalEagohPreview}>
            <View style={styles.modalEagohImage}>
              <OptimizedEagohImage tone="cyan" label={eagoh?.name ?? "EAGOH"} size="banner" imageUrl={imageUrl} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.modalEagohNameRow}>
                <Text style={styles.modalEagohName}>{eagoh?.name}</Text>
                <Pressable
                  onPress={onToggleSourceInfo}
                  style={({ pressed }) => [
                    styles.infoIconBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Info color={palette.muted} size={16} />
                </Pressable>
              </View>
              <Text style={styles.modalEagohDomain}>{domainLabel(eagoh?.domain ?? eagoh?.sport ?? "")}</Text>
              <Pressable
                onPress={() => onViewVendorProfile(listing.vendor_id)}
                accessibilityLabel={`Open vendor profile for ${listing.vendor_username ?? "Anonymous"}`}
                accessibilityRole="link"
                style={({ pressed }) => [pressed && { opacity: 0.7 }]}
              >
                <Text style={[styles.modalVendor, { textDecorationLine: "underline" as const }]}>
                  by {listing.vendor_username ?? "Anonymous"}
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Sync level */}
          <Text style={styles.modalSectionLabel}>Sync Level</Text>
          <Text style={styles.modalSectionDesc}>{SYNC_DESCRIPTIONS[selectedLevel]}</Text>
          <View style={styles.syncLevelGrid}>
            {SYNC_LEVELS.map((level) => {
              const price = (level === "25%" ? listing.price_25_per_day : level === "50%" ? listing.price_50_per_day : level === "75%" ? listing.price_75_per_day : listing.price_100_per_day);
              const disabled = price <= 0;
              return (
                <Pressable
                  key={level}
                  onPress={() => !disabled && setSelectedLevel(level)}
                  style={[
                    styles.syncLevelChip,
                    selectedLevel === level && styles.syncLevelChipActive,
                    disabled && styles.syncLevelChipDisabled,
                  ]}
                >
                  <Text style={[styles.syncLevelText, selectedLevel === level && styles.syncLevelTextActive, disabled && styles.syncLevelTextDisabled]}>
                    {level}
                  </Text>
                  <Text style={[styles.syncLevelPrice, selectedLevel === level && styles.syncLevelPriceActive]}>
                    {disabled ? "—" : `${price} EC`}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Duration */}
          <Text style={styles.modalSectionLabel}>Duration (Days)</Text>
          <View style={styles.daysRow}>
            {DAYS.map((day) => (
              <Pressable
                key={day}
                onPress={() => setSelectedDays(day)}
                style={[styles.dayChip, selectedDays === day && styles.dayChipActive]}
              >
                <Text style={[styles.dayChipText, selectedDays === day && styles.dayChipTextActive]}>{day}</Text>
              </Pressable>
            ))}
          </View>

          {/* Total */}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Cost</Text>
            <View style={styles.totalValueRow}>
              <Coins color={palette.gold} size={18} />
              <Text style={styles.totalValue}>{totalCost} EC</Text>
            </View>
          </View>
          <Text style={styles.totalBreakdown}>
            {selectedLevel} sync × {selectedDays} day{selectedDays > 1 ? "s" : ""}
          </Text>

          {/* Retention short notice */}
          <View style={styles.retentionNoticeRow}>
            <Info color={palette.muted} size={11} />
            <Text style={styles.retentionNoticeText}>
              Retained Intelligence is limited to 25% per vendor EAGOH.
            </Text>
          </View>

          {/* Confirm */}
          <Pressable
            onPress={() => onConfirm(selectedLevel, selectedDays)}
            disabled={purchasing || totalCost <= 0}
            style={({ pressed }) => [
              styles.confirmButton,
              (purchasing || totalCost <= 0) && styles.confirmButtonDisabled,
              pressed && styles.pressed,
            ]}
          >
            {purchasing ? (
              <ActivityIndicator color={palette.void} size="small" />
            ) : (
              <>
                <ArrowRightLeft color={palette.void} size={17} />
                <Text style={styles.confirmButtonText}>Confirm Purchase</Text>
              </>
            )}
          </Pressable>
        </View>

        {/* ── Source Info Overlay (renders on top of Purchase Sheet) ── */}
        {showSourceInfo && (
          <View style={styles.sourceInfoOverlayAbsolute}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={onToggleSourceInfo}
            />
            <View style={styles.infoContainerAbsolute}>
              <LinearGradient colors={["#0A1628", "#050D18"]} style={StyleSheet.absoluteFill} pointerEvents="none" />

              {/* Fixed header */}
              <View style={styles.infoHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <BookOpen color={palette.cyan} size={18} />
                  <Text style={styles.infoHeaderTitle}>Source Info</Text>
                </View>
                <Pressable onPress={onToggleSourceInfo} style={styles.modalClose}>
                  <X color={palette.muted} size={20} />
                </Pressable>
              </View>

              {/* Scrollable body */}
              <ScrollView
                style={styles.infoBody}
                contentContainerStyle={styles.infoBodyContent}
                showsVerticalScrollIndicator
                keyboardShouldPersistTaps="handled"
              >
                {/* EAGOH name + image preview */}
                <View style={styles.infoEagohPreview}>
                  <View style={styles.modalEagohImage}>
                    <OptimizedEagohImage tone="cyan" label={eagoh?.name ?? "EAGOH"} size="banner" imageUrl={imageUrl} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalEagohName}>{eagoh?.name}</Text>
                    <Text style={styles.modalEagohDomain}>{domainLabel(eagoh?.domain ?? eagoh?.sport ?? "")}</Text>
                    <Text style={styles.modalVendor}>by {listing.vendor_username ?? "Anonymous"}</Text>
                    {listing.is_vendor_verified && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                        <BadgeCheck color={palette.cyan} size={12} />
                        <Text style={{ color: palette.cyan, fontSize: 10, fontWeight: "800" }}>Verified</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Divider */}
                <View style={styles.infoDivider} />

                {/* Reputation */}
                <View style={styles.detailRow}>
                  <View style={styles.detailIconWrap}>
                    <Award color={palette.gold} size={14} />
                  </View>
                  <Text style={styles.detailLabel}>Reputation</Text>
                  <Text style={[styles.detailValue, { color: rkColor }]}>
                    {rankEmoji(eagohRank)} {eagohRank} {repScore > 0 ? `· ${repScore}` : ""}
                  </Text>
                </View>

                {/* Sync Success */}
                <View style={styles.detailRow}>
                  <View style={styles.detailIconWrap}>
                    <Signal color={palette.success} size={14} />
                  </View>
                  <Text style={styles.detailLabel}>Sync Success</Text>
                  <Text style={styles.detailValue}>{listing.sync_success_score}</Text>
                </View>

                {/* Quality Score */}
                <View style={styles.detailRow}>
                  <View style={styles.detailIconWrap}>
                    <Sparkles color={palette.cyan} size={14} />
                  </View>
                  <Text style={styles.detailLabel}>Quality Score</Text>
                  <Text style={styles.detailValue}>{listing.avg_quality_score}</Text>
                </View>

                {/* Edge Earned */}
                <View style={styles.detailRow}>
                  <View style={styles.detailIconWrap}>
                    <Coins color={palette.gold} size={14} />
                  </View>
                  <Text style={styles.detailLabel}>Neurons Earned</Text>
                  <Text style={styles.detailValue}>{listing.edge_earned_this_month} EC/mo</Text>
                </View>

                {/* Vendor Rank */}
                <View style={styles.detailRow}>
                  <View style={styles.detailIconWrap}>
                    <Crown color={palette.violet} size={14} />
                  </View>
                  <Text style={styles.detailLabel}>Vendor Rank</Text>
                  <Text style={styles.detailValue}>{listing.vendor_rank}</Text>
                </View>

                {/* Market Trust */}
                {reputation && (
                  <View style={styles.detailRow}>
                    <View style={styles.detailIconWrap}>
                      <Shield color={rkColor} size={14} />
                    </View>
                    <Text style={styles.detailLabel}>Market Trust</Text>
                    <Text style={[styles.detailValue, { color: rkColor }]}>{reputation.marketplace_trust}</Text>
                  </View>
                )}

                {/* DNA Tags — cleaned, human-readable */}
                {(detailKnowledgeAttrs.archetypeTags.length > 0 || detailKnowledgeAttrs.attrs.length > 0) && (
                  <View style={styles.detailRowCol}>
                    <View style={styles.detailIconWrap}>
                      <Dna color={palette.violet} size={14} />
                    </View>
                    <Text style={styles.detailLabel}>DNA</Text>
                    <View style={styles.detailDnaWrap}>
                      {detailKnowledgeAttrs.archetypeTags.map((d) => (
                        <View key={d} style={styles.detailDnaTag}>
                          <Text style={styles.detailDnaTagText}>{d}</Text>
                        </View>
                      ))}
                      {detailKnowledgeAttrs.attrs.map((attr) => (
                        <View key={attr.label + attr.value} style={styles.detailDnaTag}>
                          <Text style={styles.detailDnaTagText}>{attr.value}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Team Info */}
                {(eagoh?.pro_team_focus_name || eagoh?.college_team_focus_name || listing.fanatic_teams.length > 0) && (
                  <View style={styles.detailRow}>
                    <View style={styles.detailIconWrap}>
                      <Star color={palette.gold} size={14} />
                    </View>
                    <Text style={styles.detailLabel}>Teams</Text>
                    <Text style={styles.detailValue} numberOfLines={3}>
                      {[
                        eagoh?.pro_team_focus_name,
                        eagoh?.college_team_focus_name,
                        ...listing.fanatic_teams.map((id: string) => getTeamById(id)?.display_name ?? id),
                      ].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                )}

                {/* Divider before credentials */}
                {(credentials || listing.has_credentials || loadingCredentials) && (
                  <View style={styles.infoDivider} />
                )}

                {/* Retained Intelligence Disclaimer */}
                <View style={styles.infoDivider} />
                <View style={styles.retentionDisclaimerSection}>
                  <View style={styles.retentionDisclaimerHeader}>
                    <Sparkles color={palette.cyan} size={13} />
                    <Text style={styles.retentionDisclaimerTitle}>Retained Exchange Intelligence</Text>
                  </View>
                  <Text style={styles.retentionDisclaimerBody}>
                    Each completed purchase may permanently add a limited selection of the purchased EAGOH's Open Intelligence to your private Retained Exchange Intelligence library. The retained amount is approximately 2% of the intelligence included with each purchase. You may retain no more than 25% of any individual vendor EAGOH's eligible Open Intelligence. Once that limit is reached, future purchases will still provide the purchased temporary access but will not add more retained entries.
                  </Text>
                  <Text style={styles.retentionDisclaimerFootnote}>
                    Retained entries are read-only, vendor-attributed, private, and cannot be resold, shared with Factions, or listed on the Exchange.
                  </Text>
                </View>

                {/* Source Credentials */}
                {(credentials || listing.has_credentials || loadingCredentials) && (
                  <View style={styles.sourceCredentialsSection}>
                    <View style={styles.sourceCredentialsHeader}>
                      <BookOpen color={palette.cyan} size={13} />
                      <Text style={styles.sourceCredentialsTitle}>Source Credentials</Text>
                    </View>
                    <LinearGradient colors={["rgba(0,20,40,0.55)", "rgba(5,15,30,0.70)"]} style={StyleSheet.absoluteFill} />
                    {loadingCredentials ? (
                      <View style={{ padding: 16, alignItems: "center" }}>
                        <ActivityIndicator color={palette.cyan} size="small" />
                      </View>
                    ) : credentials ? (
                      <View style={styles.sourceCredentialsBody}>
                        {/* Vendor username */}
                        <View style={styles.sourceCredRow}>
                          <View style={styles.detailIconWrap}>
                            <UserCheck color={palette.muted} size={12} />
                          </View>
                          <Text style={styles.detailLabel}>Vendor</Text>
                          <Text style={styles.detailValue}>{listing.vendor_username ?? "Anonymous"}</Text>
                        </View>
                        {/* Public display title */}
                        {credentials.public_title ? (
                          <View style={styles.sourceCredRow}>
                            <View style={styles.detailIconWrap}>
                              <Award color={palette.cyan} size={12} />
                            </View>
                            <Text style={styles.detailLabel}>Title</Text>
                            <Text style={styles.detailValue}>{credentials.public_title}</Text>
                          </View>
                        ) : null}
                        {/* Domain expertise */}
                        {credentials.domain_expertise ? (
                          <View style={styles.sourceCredRow}>
                            <View style={styles.detailIconWrap}>
                              <ScrollText color={palette.cyan} size={12} />
                            </View>
                            <Text style={styles.detailLabel}>Expertise</Text>
                            <Text style={styles.detailValue}>{credentials.domain_expertise}</Text>
                          </View>
                        ) : null}
                        {/* Experience summary */}
                        {credentials.experience_summary ? (
                          <View style={styles.sourceCredRowCol}>
                            <View style={styles.detailIconWrap}>
                              <BookOpen color={palette.cyan} size={12} />
                            </View>
                            <Text style={styles.detailLabel}>Experience</Text>
                            <Text style={styles.sourceCredBodyText} numberOfLines={10}>
                              {credentials.experience_summary}
                            </Text>
                          </View>
                        ) : null}
                        {/* Accolades */}
                        {credentials.accolades ? (
                          <View style={styles.sourceCredRowCol}>
                            <View style={styles.detailIconWrap}>
                              <Star color={palette.gold} size={12} />
                            </View>
                            <Text style={styles.detailLabel}>Achievements</Text>
                            <Text style={styles.sourceCredBodyText} numberOfLines={6}>
                              {credentials.accolades}
                            </Text>
                          </View>
                        ) : null}
                        {/* Years experience */}
                        {credentials.years_experience ? (
                          <View style={styles.sourceCredRow}>
                            <View style={styles.detailIconWrap}>
                              <Clock color={palette.muted} size={12} />
                            </View>
                            <Text style={styles.detailLabel}>Years</Text>
                            <Text style={styles.detailValue}>{credentials.years_experience} years</Text>
                          </View>
                        ) : null}
                        {/* Credibility tags */}
                        {credentials.credibility_tags && credentials.credibility_tags.length > 0 ? (
                          <View style={styles.sourceCredRowCol}>
                            <View style={styles.detailIconWrap}>
                              <Tag color={palette.cyan} size={12} />
                            </View>
                            <Text style={styles.detailLabel}>Tags</Text>
                            <View style={styles.detailDnaWrap}>
                              {credentials.credibility_tags.map((tag: string) => (
                                <View key={tag} style={styles.detailDnaTag}>
                                  <Text style={styles.detailDnaTagText}>{tag}</Text>
                                </View>
                              ))}
                            </View>
                          </View>
                        ) : null}
                      </View>
                    ) : listing.has_credentials ? (
                      <View style={styles.sourceCredentialsBody}>
                        <Text style={styles.sourceCredPlaceholder}>
                          No source credentials have been added for this EAGOH yet.
                        </Text>
                      </View>
                    ) : null}
                  </View>
                )}
              </ScrollView>

              {/* Fixed footer */}
              <View style={styles.infoFooter}>
                <Pressable
                  onPress={onToggleSourceInfo}
                  style={({ pressed }) => [
                    styles.confirmButton,
                    { marginTop: 0 },
                    pressed && styles.pressed,
                  ]}
                >
                  <X color={palette.void} size={17} />
                  <Text style={styles.confirmButtonText}>Close</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ── Create Listing Modal ───────────────────────────────────────────────

const SCREEN_HEIGHT = Dimensions.get("window").height;

function CreateListingModal({
  visible,
  onClose,
  onCreated,
  creating,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
  creating: boolean;
}): JSX.Element {
  const h = useHaptics();
  const { user } = useAuth();
  const { eagohs } = useEagohs();
  const [selectedEagohId, setSelectedEagohId] = useState<string>("");
  const [price25, setPrice25] = useState<string>("");
  const [price50, setPrice50] = useState<string>("");
  const [price75, setPrice75] = useState<string>("");
  const [price100, setPrice100] = useState<string>("");
  const [description, setDescription] = useState("");

  const reset = () => {
    setSelectedEagohId("");
    setPrice25("");
    setPrice50("");
    setPrice75("");
    setPrice100("");
    setDescription("");
  };

  const handleCreate = async () => {
    Keyboard.dismiss();
    if (!user?.id || !selectedEagohId) return;
    try {
      await createListing({
        vendorId: user.id,
        eagohId: selectedEagohId,
        price25PerDay: parseInt(price25, 10) || 0,
        price50PerDay: parseInt(price50, 10) || 0,
        price75PerDay: parseInt(price75, 10) || 0,
        price100PerDay: parseInt(price100, 10) || 0,
        description: description.trim() || undefined,
      });
      h.success();
      reset();
      onCreated();
      onClose();
    } catch (err: unknown) {
      Alert.alert("Error", (err as Error).message ?? "Failed to create listing.");
    }
  };

  const myEagohs = (eagohs ?? []).filter((e: EagohRecord) => e.user_id === user?.id);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      Keyboard.dismiss();
      reset();
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!visible) return <></>;

  return (
    <View style={styles.modalOverlayAbs}>
      <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss}>
        <Pressable style={[styles.modalSheet, styles.modalSheetCreate]} onPress={() => {}}>
          <LinearGradient colors={["#0A1628", "#050D18"]} style={StyleSheet.absoluteFill} />
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Create Listing</Text>
            <Pressable onPress={() => { Keyboard.dismiss(); reset(); onClose(); }} style={styles.modalClose}>
              <X color={palette.muted} size={20} />
            </Pressable>
          </View>

          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ flex: 1 }}
          >
            <ScrollView
              contentContainerStyle={styles.createModalScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
            >
              <Text style={styles.modalSectionLabel}>Select EAGOH</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRail}>
                {myEagohs.map((e: EagohRecord) => (
                  <Pressable
                    key={e.id}
                    onPress={() => setSelectedEagohId(e.id)}
                    style={[styles.chip, selectedEagohId === e.id && styles.activeChip]}
                  >
                    <Text style={[styles.chipText, selectedEagohId === e.id && styles.activeChipText]}>{e.name}</Text>
                  </Pressable>
                ))}
                {myEagohs.length === 0 && (
                  <Text style={styles.emptyHint}>No EAGOHs available. Forge one first.</Text>
                )}
              </ScrollView>

              <Text style={styles.modalSectionLabel}>Price Per Day (EC)</Text>
              <View style={styles.priceGrid}>
                <View style={styles.priceInputWrap}>
                  <Text style={styles.priceInputLabel}>25% Sync</Text>
                  <TextInput value={price25} onChangeText={setPrice25} keyboardType="numeric" placeholder="0" placeholderTextColor={palette.muted} style={styles.priceInput} returnKeyType="done" />
                </View>
                <View style={styles.priceInputWrap}>
                  <Text style={styles.priceInputLabel}>50% Sync</Text>
                  <TextInput value={price50} onChangeText={setPrice50} keyboardType="numeric" placeholder="0" placeholderTextColor={palette.muted} style={styles.priceInput} returnKeyType="done" />
                </View>
                <View style={styles.priceInputWrap}>
                  <Text style={styles.priceInputLabel}>75% Sync</Text>
                  <TextInput value={price75} onChangeText={setPrice75} keyboardType="numeric" placeholder="0" placeholderTextColor={palette.muted} style={styles.priceInput} returnKeyType="done" />
                </View>
                <View style={styles.priceInputWrap}>
                  <Text style={styles.priceInputLabel}>100% Sync</Text>
                  <TextInput value={price100} onChangeText={setPrice100} keyboardType="numeric" placeholder="0" placeholderTextColor={palette.muted} style={styles.priceInput} returnKeyType="done" />
                </View>
              </View>

              <Text style={styles.modalSectionLabel}>Description (optional)</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Brief description of what buyers get..."
                placeholderTextColor={palette.muted}
                multiline
                numberOfLines={3}
                style={styles.descriptionInput}
                returnKeyType="done"
                blurOnSubmit
              />

              <Pressable
                onPress={handleCreate}
                disabled={creating || !selectedEagohId}
                style={({ pressed }) => [
                  styles.confirmButton,
                  (creating || !selectedEagohId) && styles.confirmButtonDisabled,
                  pressed && styles.pressed,
                  { marginTop: 16 },
                ]}
              >
                {creating ? (
                  <ActivityIndicator color={palette.void} size="small" />
                ) : (
                  <>
                    <PlusCircle color={palette.void} size={17} />
                    <Text style={styles.confirmButtonText}>Publish Listing</Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          </KeyboardAvoidingView>
        </Pressable>
      </Pressable>
    </View>
  );
}

// ── Edit Listing Modal ─────────────────────────────────────────────────

function EditListingModal({
  visible,
  listing,
  onClose,
  onUpdated,
  updating,
}: {
  visible: boolean;
  listing: EnrichedListing | null;
  onClose: () => void;
  onUpdated: () => void;
  updating: boolean;
}): JSX.Element {
  const h = useHaptics();
  const [price25, setPrice25] = useState("");
  const [price50, setPrice50] = useState("");
  const [price75, setPrice75] = useState("");
  const [price100, setPrice100] = useState("");

  useEffect(() => {
    if (listing) {
      setPrice25(listing.price_25_per_day > 0 ? String(listing.price_25_per_day) : "");
      setPrice50(listing.price_50_per_day > 0 ? String(listing.price_50_per_day) : "");
      setPrice75(listing.price_75_per_day > 0 ? String(listing.price_75_per_day) : "");
      setPrice100(listing.price_100_per_day > 0 ? String(listing.price_100_per_day) : "");
    }
  }, [listing?.id]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      Keyboard.dismiss();
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const handleUpdate = useCallback(async () => {
    Keyboard.dismiss();
    if (!listing?.id) return;
    try {
      await updateListing(listing.id, {
        price25PerDay: parseInt(price25, 10) || 0,
        price50PerDay: parseInt(price50, 10) || 0,
        price75PerDay: parseInt(price75, 10) || 0,
        price100PerDay: parseInt(price100, 10) || 0,
      });
      h.success();
      onUpdated();
      onClose();
    } catch (err: unknown) {
      Alert.alert("Error", (err as Error).message ?? "Failed to update listing.");
    }
  }, [listing?.id, price25, price50, price75, price100, h, onUpdated, onClose]);

  // All early returns must come AFTER all hooks
  if (!listing) return <></>;

  const eagoh = listing.eagoh;

  if (!visible) return <></>;

  return (
    <View style={styles.modalOverlayAbs}>
      <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss}>
        <Pressable style={[styles.modalSheet, styles.modalSheetCreate]} onPress={() => {}}>
          <LinearGradient colors={["#0A1628", "#050D18"]} style={StyleSheet.absoluteFill} />
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Edit Pricing</Text>
            <Pressable onPress={() => { Keyboard.dismiss(); onClose(); }} style={styles.modalClose}>
              <X color={palette.muted} size={20} />
            </Pressable>
          </View>

          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ flex: 1 }}
          >
            <ScrollView
              contentContainerStyle={styles.createModalScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
            >
              {/* EAGOH preview */}
              <View style={styles.editEagohPreview}>
                <View style={styles.editEagohImage}>
                  <OptimizedEagohImage tone="cyan" label={eagoh?.name ?? "EAGOH"} size="banner" imageUrl={resolveMarketplaceEagohImage(eagoh)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalEagohName}>{eagoh?.name ?? "Unnamed"}</Text>
                  <Text style={styles.modalEagohDomain}>{domainLabel(eagoh?.domain ?? eagoh?.sport ?? "")}</Text>
                  <View style={[styles.activeDot, listing.active ? styles.activeDotOn : styles.activeDotOff, { marginTop: 4 }]} />
                  <Text style={[styles.editStatusText, { color: listing.active ? palette.success : palette.ember }]}>
                    {listing.active ? "Active" : "Inactive"}
                  </Text>
                </View>
              </View>

              <Text style={styles.modalSectionLabel}>Price Per Day (EC)</Text>
              <View style={styles.priceGrid}>
                <View style={styles.priceInputWrap}>
                  <Text style={styles.priceInputLabel}>25% Sync</Text>
                  <TextInput value={price25} onChangeText={setPrice25} keyboardType="numeric" placeholder="0" placeholderTextColor={palette.muted} style={styles.priceInput} returnKeyType="done" />
                </View>
                <View style={styles.priceInputWrap}>
                  <Text style={styles.priceInputLabel}>50% Sync</Text>
                  <TextInput value={price50} onChangeText={setPrice50} keyboardType="numeric" placeholder="0" placeholderTextColor={palette.muted} style={styles.priceInput} returnKeyType="done" />
                </View>
                <View style={styles.priceInputWrap}>
                  <Text style={styles.priceInputLabel}>75% Sync</Text>
                  <TextInput value={price75} onChangeText={setPrice75} keyboardType="numeric" placeholder="0" placeholderTextColor={palette.muted} style={styles.priceInput} returnKeyType="done" />
                </View>
                <View style={styles.priceInputWrap}>
                  <Text style={styles.priceInputLabel}>100% Sync</Text>
                  <TextInput value={price100} onChangeText={setPrice100} keyboardType="numeric" placeholder="0" placeholderTextColor={palette.muted} style={styles.priceInput} returnKeyType="done" />
                </View>
              </View>

              <Pressable
                onPress={handleUpdate}
                disabled={updating}
                style={({ pressed }) => [
                  styles.confirmButton,
                  updating && styles.confirmButtonDisabled,
                  pressed && styles.pressed,
                  { marginTop: 20 },
                ]}
              >
                {updating ? (
                  <ActivityIndicator color={palette.void} size="small" />
                ) : (
                  <>
                    <Pencil color={palette.void} size={17} />
                    <Text style={styles.confirmButtonText}>Save Changes</Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          </KeyboardAvoidingView>
        </Pressable>
      </Pressable>
    </View>
  );
}

// ── Active Syncs ───────────────────────────────────────────────────────

// ── Netflix-style Domain Carousel ──────────────────────────────────────

const CarouselListingCard = memo(function CarouselListingCard({
  item,
  isPaid,
  onPurchase,
}: {
  item: EnrichedListing;
  isPaid: boolean;
  onPurchase: (listing: EnrichedListing) => void;
}): JSX.Element {
  const eagoh = item.eagoh;
  const minPrice = [item.price_25_per_day, item.price_50_per_day, item.price_75_per_day, item.price_100_per_day]
    .filter((p) => p > 0)
    .sort((a, b) => a - b)[0];

  return (
    <Pressable
      onPress={() => isPaid && onPurchase(item)}
      style={({ pressed }) => [
        styles.carouselCard,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.carouselCardImage}>
        <OptimizedEagohImage tone="cyan" label={eagoh?.name ?? "Unnamed"} size="compact" imageUrl={resolveMarketplaceEagohImage(eagoh)} />
      </View>
      <View style={styles.carouselCardInfo}>
        <Text style={styles.carouselCardName} numberOfLines={1}>{eagoh?.name ?? "Unnamed"}</Text>
        <Text style={styles.carouselCardVendor} numberOfLines={1}>{item.vendor_username ?? "Anonymous"}</Text>
        {minPrice ? (
          <View style={styles.carouselCardPrice}>
            <Coins color={palette.gold} size={10} />
            <Text style={styles.carouselCardPriceText}>{minPrice} EC/day</Text>
          </View>
        ) : (
          <Text style={styles.carouselCardPriceFree}>Free</Text>
        )}
      </View>
    </Pressable>
  );
});

const DomainCarouselSection = memo(function DomainCarouselSection({
  domain,
  listings,
  isPaid,
  onPurchase,
}: {
  domain: string;
  listings: EnrichedListing[];
  isPaid: boolean;
  onPurchase: (listing: EnrichedListing) => void;
}): JSX.Element {
  return (
    <View style={styles.carouselSection}>
      <View style={styles.carouselSectionHeader}>
        <Text style={styles.carouselSectionTitle}>{domainLabel(domain)}</Text>
        <Text style={styles.carouselSectionCount}>{listings.length}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.carouselRail}
        {...HORIZONTAL_LIST_PERFORMANCE_PROPS}
      >
        {listings.map((item) => (
          <CarouselListingCard
            key={item.id}
            item={item}
            isPaid={isPaid}
            onPurchase={onPurchase}
          />
        ))}
      </ScrollView>
    </View>
  );
});

const ActiveSyncCard = memo(function ActiveSyncCard({
  item,
  userId,
}: {
  item: EnrichedPurchase;
  userId?: string | null;
}): JSX.Element {
  const h = useHaptics();
  const [expanded, setExpanded] = useState(false);
  const [vendorEntries, setVendorEntries] = useState<OpenIntelligenceRow[]>([]);
  const [contributorRepMap, setContributorRepMap] = useState<Map<string, PublicReputation>>(new Map());
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [feedbackModalEntryId, setFeedbackModalEntryId] = useState<string | null>(null);
  const [disputeModalEntryId, setDisputeModalEntryId] = useState<string | null>(null);

  // Phase 7A: Exchange search & filter
  const [exchangeSearch, setExchangeSearch] = useState("");
  const [exchangeFilterOpen, setExchangeFilterOpen] = useState(false);
  const [exchangeSort, setExchangeSort] = useState<SortOption>("newest");
  const [exchangeValidationFilter, setExchangeValidationFilter] = useState("all");
  const [exchangeCategoryFilter, setExchangeCategoryFilter] = useState("all");

  const remaining = timeLeft(item.expires_at);
  const isExpiring = remaining.includes("h") && parseInt(remaining) < 4;
  const hasStarted = new Date(item.started_at).getTime() <= Date.now();
  const hasExpired = new Date(item.expires_at).getTime() <= Date.now();
  const isOwner = userId === item.buyer_id;
  const canAccessExchange = isOwner && item.active && hasStarted && !hasExpired;

  // Fetch vendor's exchange-shareable OI entries when expanded
  useEffect(() => {
    if (!expanded || !canAccessExchange) return;
    setLoadingEntries(true);
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("open_intelligence")
          .select("*")
          .eq("user_id", item.vendor_id)
          .eq("eagoh_id", item.eagoh_id)
          .eq("exchange_share_enabled", true)
          .in("validation_status", [
            "pending_review",
            "validated",
            "community_supported",
            "externally_supported",
            "disputed",
          ])
          .order("created_at", { ascending: false })
          .limit(20);
        if (cancelled) return;
        if (error) {
          console.warn("[exchange] vendor OI fetch failed", error.message);
          setVendorEntries([]);
        } else {
          const entries = (data ?? []) as OpenIntelligenceRow[];
          setVendorEntries(entries);
          const contributorIds = [...new Set(entries.map((e) => e.user_id))];
          if (contributorIds.length > 0) {
            fetchBulkPublicReputations(contributorIds)
              .then(setContributorRepMap)
              .catch(() => undefined);
          }
        }
      } catch {
        if (!cancelled) setVendorEntries([]);
      } finally {
        if (!cancelled) setLoadingEntries(false);
      }
    })();
    return () => { cancelled = true; };
  }, [expanded, canAccessExchange, item.vendor_id, item.eagoh_id]);

  const buildExchangeAccess = useCallback(
    (entry: OpenIntelligenceRow): FeedbackAccessInfo => ({
      accessSource: "exchange",
      exchangePurchaseId: item.id,
      isOwnEntry: entry.user_id === userId,
    }),
    [item.id, userId],
  );

  // Phase 7A: Category options derived from vendor entries
  const exchangeCategoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of vendorEntries) {
      const cat = e.selected_category ?? e.tag;
      if (cat) set.add(cat);
    }
    return Array.from(set).sort();
  }, [vendorEntries]);

  // Phase 7A: Filtered & sorted vendor entries
  const filteredVendorEntries = useMemo(() => {
    const exchangeFilters: MyIntelligenceFilters = {
      search: exchangeSearch,
      category: exchangeCategoryFilter,
      validationStatus: exchangeValidationFilter,
      confidence: "all",
      sharing: "all",
      sort: exchangeSort,
    };
    return applyEntryFilters(vendorEntries, exchangeFilters);
  }, [vendorEntries, exchangeSearch, exchangeCategoryFilter, exchangeValidationFilter, exchangeSort]);

  const handleRateEntry = useCallback((entryId: string): void => {
    h.light();
    setFeedbackModalEntryId(entryId);
  }, [h]);

  const handleDisputeEntry = useCallback((entryId: string): void => {
    h.light();
    setDisputeModalEntryId(entryId);
  }, [h]);

  const hasExpiredForRender = new Date(item.expires_at).getTime() <= Date.now();

  return (
    <View>
      <Pressable
        onPress={() => {
          if (canAccessExchange) {
            h.light();
            setExpanded((prev) => !prev);
          }
        }}
        disabled={!canAccessExchange}
        style={({ pressed }) => [pressed && styles.pressed]}
      >
        <View style={styles.activeSyncCard}>
          <View style={styles.activeSyncLeft}>
            <View style={styles.activeSyncImage}>
              <OptimizedEagohImage tone="cyan" label={item.eagoh_name} size="banner" imageUrl={item.eagoh_image_url} />
            </View>
            <View style={styles.activeSyncInfo}>
              <Text style={styles.activeSyncName} numberOfLines={1}>{item.eagoh_name}</Text>
              <Text style={styles.activeSyncVendor}>by {item.vendor_username ?? "Anonymous"}</Text>
              <Text style={styles.activeSyncLevel}>{item.sync_level} Sync · {item.days} day(s)</Text>
            </View>
          </View>
          <View style={styles.activeSyncRight}>
            <View style={[styles.activeSyncStatus, isExpiring && styles.activeSyncStatusWarn]}>
              <Power color={isExpiring ? palette.ember : palette.success} size={12} />
              <Text style={[styles.activeSyncStatusText, isExpiring && styles.activeSyncStatusTextWarn]}>
                {isExpiring ? "Expiring" : "Active"}
              </Text>
            </View>
            <Text style={[styles.activeSyncTime, isExpiring && styles.activeSyncTimeWarn]}>{remaining}</Text>
            <Text style={styles.activeSyncCost}>{item.edge_cost} EC</Text>
            {canAccessExchange && (
              <View style={styles.exchangeExpandHint}>
                <ChevronDown
                  color={palette.cyan}
                  size={14}
                  style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
                />
                <Text style={styles.exchangeExpandText}>{expanded ? "Hide" : "Rate"}</Text>
              </View>
            )}
            {hasExpiredForRender && (
              <View style={styles.exchangeExpiredBadge}>
                <Text style={styles.exchangeExpiredText}>EXPIRED</Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>

      {expanded && canAccessExchange && (
        <View style={styles.exchangeOISection}>
          <Text style={styles.exchangeOIHeader}>LICENSED INTELLIGENCE</Text>

          {/* Phase 7A: Exchange search & filter */}
          {vendorEntries.length > 0 ? (
            <View style={styles.exchangeSearchRow}>
              <View style={styles.exchangeSearchWrap}>
                <Search color={palette.muted} size={14} />
                <TextInput
                  value={exchangeSearch}
                  onChangeText={setExchangeSearch}
                  placeholder="Search licensed intelligence..."
                  placeholderTextColor={palette.muted}
                  style={styles.exchangeSearchInput}
                  returnKeyType="search"
                />
                {exchangeSearch.length > 0 ? (
                  <Pressable onPress={() => setExchangeSearch("")} style={styles.exchangeSearchClear}>
                    <X color={palette.muted} size={13} />
                  </Pressable>
                ) : null}
              </View>
              <Pressable
                onPress={() => { h.selection(); setExchangeFilterOpen(!exchangeFilterOpen); }}
                style={({ pressed }) => [
                  styles.exchangeFilterToggle,
                  (exchangeSort !== "newest" || exchangeValidationFilter !== "all" || exchangeCategoryFilter !== "all") && { borderColor: palette.cyan },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <SlidersHorizontal color={palette.muted} size={14} />
              </Pressable>
            </View>
          ) : null}

          {exchangeFilterOpen && vendorEntries.length > 0 ? (
            <View style={styles.exchangeFilterPanel}>
              <Text style={styles.exchangeFilterLabel}>Sort</Text>
              <View style={styles.exchangeFilterChips}>
                {(["newest", "highest_quality"] as SortOption[]).map((opt) => (
                  <Pressable
                    key={opt}
                    onPress={() => { h.selection(); setExchangeSort(opt); }}
                    style={({ pressed }) => [
                      styles.exchangeFilterChip,
                      exchangeSort === opt && { borderColor: palette.cyan, backgroundColor: `${palette.cyan}12` },
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Text style={[styles.exchangeFilterChipText, exchangeSort === opt && { color: palette.cyan }]}>
                      {SORT_LABELS[opt]}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[styles.exchangeFilterLabel, { marginTop: 8 }]}>Validation</Text>
              <View style={styles.exchangeFilterChips}>
                {VALIDATION_STATUS_FILTER_OPTIONS.filter((o) => o.id !== "withdrawn" && o.id !== "rejected").map((opt) => (
                  <Pressable
                    key={opt.id}
                    onPress={() => { h.selection(); setExchangeValidationFilter(opt.id); }}
                    style={({ pressed }) => [
                      styles.exchangeFilterChip,
                      exchangeValidationFilter === opt.id && { borderColor: palette.cyan, backgroundColor: `${palette.cyan}12` },
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Text style={[styles.exchangeFilterChipText, exchangeValidationFilter === opt.id && { color: palette.cyan }]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {exchangeCategoryOptions.length > 0 ? (
                <>
                  <Text style={[styles.exchangeFilterLabel, { marginTop: 8 }]}>Category</Text>
                  <View style={styles.exchangeFilterChips}>
                    <Pressable
                      onPress={() => { h.selection(); setExchangeCategoryFilter("all"); }}
                      style={({ pressed }) => [
                        styles.exchangeFilterChip,
                        exchangeCategoryFilter === "all" && { borderColor: palette.cyan, backgroundColor: `${palette.cyan}12` },
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text style={[styles.exchangeFilterChipText, exchangeCategoryFilter === "all" && { color: palette.cyan }]}>All</Text>
                    </Pressable>
                    {exchangeCategoryOptions.map((cat) => (
                      <Pressable
                        key={cat}
                        onPress={() => { h.selection(); setExchangeCategoryFilter(cat); }}
                        style={({ pressed }) => [
                          styles.exchangeFilterChip,
                          exchangeCategoryFilter === cat && { borderColor: palette.cyan, backgroundColor: `${palette.cyan}12` },
                          pressed && { opacity: 0.85 },
                        ]}
                      >
                        <Text style={[styles.exchangeFilterChipText, exchangeCategoryFilter === cat && { color: palette.cyan }]} numberOfLines={1}>
                          {cat.replace(/_/g, " ")}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}
            </View>
          ) : null}

          {loadingEntries ? (
            <View style={styles.exchangeLoadingWrap}>
              <ActivityIndicator color={palette.cyan} size="small" />
            </View>
          ) : vendorEntries.length === 0 ? (
            <Text style={styles.exchangeEmptyText}>No shared intelligence available for this sync.</Text>
          ) : filteredVendorEntries.length === 0 ? (
            <View style={styles.exchangeFilterEmpty}>
              <Search color={palette.muted} size={24} />
              <Text style={styles.exchangeFilterEmptyTitle}>No Intelligence Matches Your Search</Text>
              <Text style={styles.exchangeFilterEmptyDesc}>Try adjusting your search or filters.</Text>
            </View>
          ) : (
            filteredVendorEntries.map((entry) => (
              <IntelligenceEntryCard
                key={entry.id}
                entry={entry}
                contributorReputation={contributorRepMap.get(entry.user_id)}
                access={buildExchangeAccess(entry)}
                onRate={handleRateEntry}
                onDispute={handleDisputeEntry}
              />
            ))
          )}
        </View>
      )}

      <FeedbackModal
        visible={feedbackModalEntryId !== null}
        entryId={feedbackModalEntryId}
        access={
          feedbackModalEntryId
            ? buildExchangeAccess(
                vendorEntries.find((e) => e.id === feedbackModalEntryId) ??
                  ({ user_id: "", id: "" } as OpenIntelligenceRow),
              )
            : null
        }
        onClose={() => setFeedbackModalEntryId(null)}
      />
      <DisputeModal
        visible={disputeModalEntryId !== null}
        entryId={disputeModalEntryId}
        access={
          disputeModalEntryId
            ? buildExchangeAccess(
                vendorEntries.find((e) => e.id === disputeModalEntryId) ??
                  ({ user_id: "", id: "" } as OpenIntelligenceRow),
              )
            : null
        }
        onClose={() => setDisputeModalEntryId(null)}
      />
    </View>
  );
});

// ── My Listing Card ────────────────────────────────────────────────────

const MyListingCard = memo(function MyListingCard({
  item,
  onToggle,
  onEdit,
  onRecalc,
  reputation,
}: {
  item: EnrichedListing;
  onToggle: (id: string, active: boolean) => void;
  onEdit: (listing: EnrichedListing) => void;
  onRecalc: () => void;
  reputation: ReputationRow | undefined;
}): JSX.Element {
  const eagoh = item.eagoh;
  const eagohRank: RankTier = (reputation?.rank as RankTier) ?? "Dormant";
  const rkColor = rankColor(eagohRank);
  const imageUrl = resolveMarketplaceEagohImage(eagoh);
  const tone: RenderTone = eagohRank === "Syndicate Prime" || eagohRank === "Oracle" ? "gold" : eagohRank === "Diamond" ? "cyan" : "violet";
  const knowledgeAttrs = parseKnowledgeAttributes(eagoh?.dna, 2);
  const minPrice = [item.price_25_per_day, item.price_50_per_day, item.price_75_per_day, item.price_100_per_day]
    .filter((p) => p > 0)
    .sort((a, b) => a - b)[0];

  return (
    <View style={[styles.myListingCard, !item.active && styles.myListingCardInactive]}>
      <View style={styles.myListingRow}>
        {/* EAGOH Image — larger, full-body with dark gradient background */}
        <View style={styles.myListingImageSection}>
          <LinearGradient
            colors={["#03060B", `${rkColor}12`, "#050D18"]}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              styles.myListingSpotlight,
              { backgroundColor: `${rkColor}0E`, width: 60, height: 60 },
            ]}
          />
          <View style={styles.myListingImageInner}>
            <OptimizedEagohImage
              tone={tone}
              label={eagoh?.name ?? "Unnamed"}
              size="card"
              imageUrl={imageUrl}
              contentFit="contain"
              showLabel={false}
            />
          </View>
          {/* Domain badge overlay */}
          {eagoh?.domain && (
            <View style={styles.myListingDomainBadge}>
              <Text style={styles.myListingDomainBadgeText}>{domainLabel(eagoh.domain)}</Text>
            </View>
          )}
        </View>

        {/* Info */}
        <View style={styles.myListingInfo}>
          <View style={styles.myListingTop}>
            <Text style={styles.myListingName} numberOfLines={2} ellipsizeMode="tail">{eagoh?.name ?? "Unnamed"}</Text>
            <View style={[styles.activeDot, item.active ? styles.activeDotOn : styles.activeDotOff]} />
          </View>
          {reputation && (
            <View style={[styles.myListingRepBadge, { borderColor: rkColor }]}>
              <Award color={rkColor} size={10} />
              <Text style={[styles.myListingRepBadgeText, { color: rkColor }]}>
                {rankEmoji(eagohRank)} {eagohRank} · {reputation.reputation_score}
              </Text>
            </View>
          )}
          {/* DNA archetype tags (non-dom entries only) */}
          {knowledgeAttrs.archetypeTags.length > 0 && (
            <View style={styles.listingDna}>
              {knowledgeAttrs.archetypeTags.slice(0, 3).map((d) => (
                <View key={d} style={styles.dnaTag}>
                  <Text style={styles.dnaTagText}>{d}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Cleaned knowledge attributes — max 2, human-readable */}
          {knowledgeAttrs.attrs.length > 0 && (
            <View style={styles.knowledgeRow}>
              {knowledgeAttrs.attrs.map((attr) => (
                <View key={attr.label + attr.value} style={styles.knowledgeItem}>
                  <Text style={styles.knowledgeLabel}>{attr.label}</Text>
                  <Text style={styles.knowledgeValue} numberOfLines={1} ellipsizeMode="tail">{attr.value}</Text>
                </View>
              ))}
              {knowledgeAttrs.remainingCount > 0 && (
                <Text style={styles.knowledgeMore}>+{knowledgeAttrs.remainingCount} more</Text>
              )}
            </View>
          )}
          {/* Metrics */}
          <View style={styles.myListingMetrics}>
            <View style={styles.metricRow}>
              <Signal color={palette.success} size={10} />
              <Text style={styles.metric}>Sync: {item.sync_success_score}</Text>
            </View>
            <View style={styles.metricRow}>
              <Sparkles color={palette.cyan} size={10} />
              <Text style={styles.metric}>Quality: {item.avg_quality_score}</Text>
            </View>
          </View>
          <View style={styles.myListingPrices}>
            {(["25%", "50%", "75%", "100%"] as const).map((level) => {
              const price = level === "25%" ? item.price_25_per_day : level === "50%" ? item.price_50_per_day : level === "75%" ? item.price_75_per_day : item.price_100_per_day;
              if (price <= 0) return null;
              return (
                <View key={level} style={styles.myListingPriceTag}>
                  <Text style={styles.myListingPriceText}>{level}: {price} EC</Text>
                </View>
              );
            })}
          </View>
          {minPrice && (
            <Text style={styles.myListingMinPrice}>From {minPrice} EC/day</Text>
          )}
        </View>
      </View>

      {/* Actions */}
      <View style={styles.myListingActions}>
        <Pressable
          onPress={() => onEdit(item)}
          style={styles.myListingEditBtn}
        >
          <Pencil color={palette.cyan} size={13} />
          <Text style={styles.myListingEditText}>Edit Pricing</Text>
        </Pressable>
        <Pressable
          onPress={() => shareListing(
            eagoh?.name ?? "My EAGOH",
            item.vendor_username,
            item.id,
            item.description,
          )}
          style={styles.myListingShareBtn}
        >
          <Share2 color={palette.violet} size={13} />
          <Text style={styles.myListingShareText}>Share</Text>
        </Pressable>
        <Pressable
          onPress={() => copyListingLink(item.id)}
          style={styles.myListingShareBtn}
        >
          <Link2 color={palette.violet} size={13} />
          <Text style={styles.myListingShareText}>Copy Link</Text>
        </Pressable>
        <Pressable
          onPress={() => onToggle(item.id, !item.active)}
          style={[styles.myListingActionBtn, item.active ? styles.myListingActionBtnOff : styles.myListingActionBtnOn]}
        >
          <Text style={[styles.myListingActionText, item.active && styles.myListingActionTextOff]}>
            {item.active ? "Deactivate" : "Activate"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
});

// ── Marketplace Sponsored Banner Carousel ──────────────────────────────

const MktSponsoredBanner = memo(function MktSponsoredBanner({ item, userId, reputation }: { item: EnrichedBanner; userId: string | null; reputation: ReputationRow | undefined }): JSX.Element {
  const h = useHaptics();
  const eagohRank: RankTier = (reputation?.rank as RankTier) ?? "Dormant";
  const repScore = reputation?.reputation_score ?? 0;
  const accent = repScore > 0 ? rankColor(eagohRank) : (item.vendor_rank === "S-TIER" ? palette.gold : item.vendor_rank === "ELITE" ? palette.cyan : palette.violet);
  const domainLabel: string = item.eagoh_domain.charAt(0).toUpperCase() + item.eagoh_domain.slice(1).replace(/_/g, " ");

  useEffect(() => {
    if (userId) recordBannerImpression(item.id, userId).catch(() => undefined);
  }, [item.id, userId]);

  return (
    <Pressable
      onLongPress={() => {
        h.medium();
        if (userId) recordBannerTapHold(item.id, userId).catch(() => undefined);
      }}
      onPress={() => {
        if (userId) recordBannerTap(item.id, userId).catch(() => undefined);
      }}
      delayLongPress={280}
      style={({ pressed }) => [
        styles.mktBannerCard,
        pressed && styles.pressed,
        item.colored_border && { borderColor: accent, borderWidth: 1.5 },
        item.hot_badge && { borderColor: palette.ember },
      ]}
    >
      {item.hot_badge && (
        <View style={styles.mktHotBadge}>
          <Text style={styles.mktHotBadgeText}>HOT</Text>
        </View>
      )}
      <View style={styles.mktBannerImage}>
        <OptimizedEagohImage tone={item.vendor_rank === "S-TIER" ? "gold" : item.vendor_rank === "ELITE" ? "cyan" : "violet"} label={item.eagoh_name.slice(0, 8).toUpperCase()} size="banner" imageUrl={item.eagoh_image_url} />
      </View>
      <View style={styles.mktBannerInfo}>
        <Text style={styles.mktBannerName} numberOfLines={1}>{item.eagoh_name}</Text>
        <Text style={styles.mktBannerDomain}>{domainLabel}</Text>
        {repScore > 0 && (
          <View style={[styles.mktBannerRankRow, { borderColor: `${accent}33`, backgroundColor: `${accent}10` }]}>
            <Award color={accent} size={11} />
            <Text style={[styles.mktBannerRankText, { color: accent }]}>{rankEmoji(eagohRank)} {eagohRank} · {repScore}</Text>
          </View>
        )}
        <View style={styles.mktBannerMeta}>
          <Text style={styles.mktBannerScore}>Q: {item.quality_score}</Text>
          <Text style={styles.mktBannerSync}>Sync: {item.sync_score}</Text>
        </View>
      </View>
    </Pressable>
  );
});

const MktSponsoredCarousel = memo(function MktSponsoredCarousel({ userId }: { userId: string | null }): JSX.Element | null {
  const [banners, setBanners] = useState<EnrichedBanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [bannerRepMap, setBannerRepMap] = useState<Map<string, ReputationRow>>(new Map());

  useEffect(() => {
    setLoading(true);
    getActiveBanners("marketplace")
      .then((b) => {
        setBanners(b);
        setLoading(false);
        const eagohIds = [...new Set(b.map((bb) => bb.eagoh_id))];
        if (eagohIds.length > 0) {
          getBulkReputations(eagohIds).then(setBannerRepMap).catch(() => undefined);
        }
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (banners.length === 0) return null;

  return (
    <View style={{ marginTop: 16, gap: 10 }}>
      <View style={styles.sectionHeader}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Megaphone color={palette.gold} size={15} />
          <Text style={styles.sectionTitle}>Sponsored EAGOHs</Text>
        </View>
        <Text style={styles.sectionCount}>{banners.length}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 16 }} {...HORIZONTAL_LIST_PERFORMANCE_PROPS}>
        {banners.map((b) => (
          <MktSponsoredBanner key={b.id} item={b} userId={userId} reputation={bannerRepMap.get(b.eagoh_id)} />
        ))}
      </ScrollView>
    </View>
  );
});

// ── Main Screen ────────────────────────────────────────────────────────

export default function MarketplaceScreen(): JSX.Element {
  const h = useHaptics();
  const router = useRouter();
  const { user } = useAuth();
  const { profile, effectiveSubscriptionTier } = useProfile();
  const { balances } = useEdge();
  const { palette: pal } = useAppTheme();

  const [filters, setFilters] = useState<ListingFilters>({});
  const [listings, setListings] = useState<EnrichedListing[]>([]);
  const [myListings, setMyListings] = useState<EnrichedListing[]>([]);
  const [activeSyncs, setActiveSyncsState] = useState<EnrichedPurchase[]>([]);
  const [purchases, setPurchases] = useState<EnrichedPurchase[]>([]);
  const [filterMeta, setFilterMeta] = useState<{ domains: string[]; sports: string[]; ranks: string[] }>({ domains: [], sports: [], ranks: [] });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"browse" | "rankings" | "my-listings" | "my-syncs" | "my-purchases">("browse");
  const [rankingsData, setRankingsData] = useState<Array<{ rank: number; eagoh_id: string; eagoh_name: string; reputation_score: number; rank_tier: RankTier; marketplace_trust: number; sync_success: number; marketplace_sales: number; owner_username: string }>>([]);
  const [rankingsLoading, setRankingsLoading] = useState(false);
  const [repMap, setRepMap] = useState<Map<string, ReputationRow>>(new Map());
  const [vendorMetricsMap, setVendorMetricsMap] = useState<Map<string, VendorQualityMetrics>>(new Map());
  const [vendorRepMap, setVendorRepMap] = useState<Map<string, PublicReputation>>(new Map());

  const [purchaseModal, setPurchaseModal] = useState<EnrichedListing | null>(null);
  const [purchasing, setPurchasing] = useState(false);

  const [createModal, setCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);

  const [editModal, setEditModal] = useState<EnrichedListing | null>(null);
  const [updating, setUpdating] = useState(false);

  const [showSourceInfo, setShowSourceInfo] = useState(false);
  const [publicProfileVendorId, setPublicProfileVendorId] = useState<string | null>(null);

  const isPaid = canTransact(effectiveSubscriptionTier);

  const loadData = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    try {
      const [l, meta, syncs, myList, myPurch] = await Promise.all([
        listActiveListings(filters),
        getActiveFilters(),
        getActiveSyncs(user.id),
        isPaid ? getMyListings(user.id) : Promise.resolve([]),
        isPaid ? getMyPurchases(user.id) : Promise.resolve([]),
      ]);
      setListings(l);
      setFilterMeta(meta);
      setActiveSyncsState(syncs);
      setMyListings(myList);
      setPurchases(myPurch);
      // Load reputations for all listings
      const allEagohIds = [...new Set(l.map((li) => li.eagoh_id))];
      if (allEagohIds.length > 0) {
        getBulkReputations(allEagohIds).then(setRepMap).catch(() => undefined);
      }
      // Phase 6A: Load vendor quality metrics + public reputations for trust indicators
      const allVendorIds = [...new Set(l.map((li) => li.vendor_id))];
      if (allVendorIds.length > 0) {
        fetchBulkPublicReputations(allVendorIds).then(setVendorRepMap).catch(() => undefined);
        Promise.all(allVendorIds.map((vid) => fetchVendorQualityMetrics(vid).then((m) => [vid, m] as const)))
          .then((results) => {
            const map = new Map<string, VendorQualityMetrics>();
            for (const [vid, m] of results) {
              if (m) map.set(vid, m);
            }
            setVendorMetricsMap(map);
          })
          .catch(() => undefined);
      }
    } catch (err) {
      console.warn("[marketplace] load error", err);
    } finally {
      setLoading(false);
    }
  }, [user?.id, isPaid, filters]);

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  const handlePurchaseConfirm = useCallback(async (level: SyncLevel, days: number) => {
    if (!user?.id || !profile || !purchaseModal) return;
    setPurchasing(true);
    try {
      const result = await purchaseSync(user.id, profile, purchaseModal.id, level, days);
      if (!result.ok) {
        Alert.alert("Purchase Failed", result.error);
      } else {
        h.success();
        Alert.alert("Sync Purchased", `You now have ${level} sync access for ${days} day(s).`);
        setPurchaseModal(null);
        loadData();
      }
    } catch (err: unknown) {
      Alert.alert("Error", (err as Error).message ?? "Purchase failed.");
    } finally {
      setPurchasing(false);
    }
  }, [user?.id, profile, purchaseModal, loadData]);

  const handleToggleListing = useCallback(async (id: string, active: boolean) => {
    try {
      await toggleListingActive(id, active);
      h.selection();
      loadData();
    } catch {
      Alert.alert("Error", "Failed to update listing.");
    }
  }, [loadData, h]);

  const renderHeader = useCallback(
    () => (
      <View>
        <Hero />
        <VendorStatsCard />

        {/* Active Syncs (above filters, compact) */}
        {isPaid && activeSyncs.length > 0 && (
          <View style={styles.activeSyncsSection}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Your Active Syncs</Text>
              <Text style={styles.sectionCount}>{activeSyncs.length}</Text>
            </View>
            {activeSyncs.map((s) => (
              <ActiveSyncCard key={s.id} item={s} userId={user?.id} />
            ))}
          </View>
        )}

        {/* Tab bar: Browse | Rankings | My Listings | My Syncs | My Purchases */}
        {(true) && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRail}>
            {([
              { key: "browse", label: "Marketplace" },
              { key: "rankings", label: "Rankings" },
              ...(isPaid ? [
                { key: "my-listings" as const, label: "My Listings" },
                { key: "my-syncs" as const, label: "Active Syncs" },
                { key: "my-purchases" as const, label: "My Purchases" },
              ] : []),
            ]).map((t) => (
              <Pressable
                key={t.key}
                onPress={() => {
                  setTab(t.key as typeof tab);
                  if (t.key === "rankings" && rankingsData.length === 0) {
                    setRankingsLoading(true);
                    getLeaderboard("top_vendors", {}, 10, 0)
                      .then((r) => {
                        setRankingsData(r.entries.map((e) => ({
                          rank: e.rank,
                          eagoh_id: e.eagoh_id,
                          eagoh_name: e.eagoh_name,
                          reputation_score: e.reputation_score,
                          rank_tier: e.rank_tier,
                          marketplace_trust: e.marketplace_trust,
                          sync_success: e.sync_success,
                          marketplace_sales: e.marketplace_sales,
                          owner_username: e.owner_username,
                        })));
                        setRankingsLoading(false);
                      })
                      .catch(() => setRankingsLoading(false));
                  }
                }}
                style={[styles.tabChip, tab === t.key && styles.tabChipActive]}
              >
                <Text style={[styles.tabChipText, tab === t.key && styles.tabChipTextActive]}>{t.label}</Text>
              </Pressable>
            ))}
            {isPaid && (
              <Pressable onPress={() => setCreateModal(true)} style={styles.createListingBtn}>
                <PlusCircle color={palette.cyan} size={14} />
                <Text style={styles.createListingText}>Create Listing</Text>
              </Pressable>
            )}
          </ScrollView>
        )}

        {/* Filters (only in marketplace browse) */}
        {tab === "browse" && (
          <FilterPanel
            filters={filters}
            setFilters={setFilters}
            domains={filterMeta.domains}
            sports={filterMeta.sports}
            ranks={filterMeta.ranks}
          />
        )}
      </View>
    ),
    [filters, setFilters, filterMeta, tab, activeSyncs, isPaid, user?.id],
  );

  // Group listings by domain, sorted by most listings first
  const domainGroups = useMemo(() => {
    const groups = new Map<string, EnrichedListing[]>();
    for (const l of listings) {
      const dom = l.eagoh?.domain ?? l.eagoh?.sport ?? "other";
      if (!groups.has(dom)) groups.set(dom, []);
      groups.get(dom)!.push(l);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [listings]);

  const renderListings = () => {
    if (tab === "browse") {
      if (loading) {
        return (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={palette.cyan} size="large" />
          </View>
        );
      }
      if (listings.length === 0) {
        return (
          <View style={styles.emptyWrap}>
            <PackageOpen color={palette.muted} size={40} />
            <Text style={styles.emptyTitle}>No Listings Found</Text>
            <Text style={styles.emptyBody}>
              {Object.values(filters).some((v) => v)
                ? "Try adjusting your filters."
                : "No EAGOHs are currently listed for sync. Be the first to list one!"}
            </Text>
          </View>
        );
      }

      return (
        <View style={styles.domainCarouselsWrap}>
          {domainGroups.map(([domain, domainListings]) => (
            <View key={domain} style={styles.carouselSection}>
              <View style={styles.carouselSectionHeader}>
                <Text style={styles.carouselSectionTitle}>{domainLabel(domain)}</Text>
                <Text style={styles.carouselSectionCount}>{domainListings.length}</Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.carouselRail}
                {...HORIZONTAL_LIST_PERFORMANCE_PROPS}
              >
                {domainListings.map((item) => (
                  <ListingCard
                    key={item.id}
                    item={item}
                    isPaid={isPaid}
                    onPurchase={(l) => setPurchaseModal(l)}
                    reputation={repMap.get(item.eagoh_id)}
                    onViewVendorProfile={(vendorId) => setPublicProfileVendorId(vendorId)}
                    vendorMetrics={vendorMetricsMap.get(item.vendor_id)}
                    vendorRep={vendorRepMap.get(item.vendor_id)}
                  />
                ))}
              </ScrollView>
            </View>
          ))}
        </View>
      );
    }

    if (tab === "my-listings") {
      if (myListings.length === 0) {
        return (
          <View style={styles.emptyWrap}>
            <PackageOpen color={palette.muted} size={40} />
            <Text style={styles.emptyTitle}>No Listings</Text>
            <Text style={styles.emptyBody}>Create your first listing to offer EAGOH sync access.</Text>
            <Pressable onPress={() => setCreateModal(true)} style={styles.emptyActionBtn}>
              <PlusCircle color={palette.void} size={16} />
              <Text style={styles.emptyActionText}>Create Listing</Text>
            </Pressable>
          </View>
        );
      }
      return (
        <View style={styles.listingsWrap}>
          {myListings.map((item) => (
            <MyListingCard
              key={item.id}
              item={item}
              onToggle={handleToggleListing}
              onEdit={(l) => setEditModal(l)}
              onRecalc={loadData}
              reputation={repMap.get(item.eagoh_id)}
            />
          ))}
        </View>
      );
    }

    if (tab === "my-syncs") {
      const allActive = activeSyncs;
      if (allActive.length === 0) {
        return (
          <View style={styles.emptyWrap}>
            <Clock color={palette.muted} size={40} />
            <Text style={styles.emptyTitle}>No Active Syncs</Text>
            <Text style={styles.emptyBody}>Purchase sync access from the Browse tab.</Text>
          </View>
        );
      }
      return (
        <View style={styles.listingsWrap}>
          {allActive.map((s) => (
            <ActiveSyncCard key={s.id} item={s} userId={user?.id} />
          ))}
        </View>
      );
    }

    if (tab === "my-purchases") {
      if (purchases.length === 0) {
        return (
          <View style={styles.emptyWrap}>
            <Clock color={palette.muted} size={40} />
            <Text style={styles.emptyTitle}>No Purchase History</Text>
            <Text style={styles.emptyBody}>Your past sync purchases will appear here.</Text>
          </View>
        );
      }
      return (
        <View style={styles.listingsWrap}>
          {purchases.map((s) => (
            <ActiveSyncCard key={s.id} item={s} userId={user?.id} />
          ))}
        </View>
      );
    }

    if (tab === "rankings") {
      if (rankingsLoading) {
        return (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={palette.gold} size="large" />
          </View>
        );
      }
      if (rankingsData.length === 0) {
        return (
          <View style={styles.emptyWrap}>
            <TrendingUp color={palette.muted} size={40} />
            <Text style={styles.emptyTitle}>No Rankings Yet</Text>
            <Text style={styles.emptyBody}>Marketplace rankings will appear as vendors list their EAGOHs.</Text>
          </View>
        );
      }
      return (
        <View style={styles.listingsWrap}>
          {rankingsData.map((entry) => {
            const rkColor = rankColor(entry.rank_tier as RankTier);
            return (
              <View key={entry.eagoh_id} style={styles.rankingCard}>
                <View style={[styles.cardGlow, { backgroundColor: rkColor }]} />
                <View style={styles.rankingCardLeft}>
                  <Text style={[styles.rankingNumber, entry.rank <= 3 && { color: palette.gold }]}>#{entry.rank}</Text>
                  <View>
                    <Text style={styles.rankingName} numberOfLines={1}>{entry.eagoh_name}</Text>
                    <Text style={styles.rankingVendor}>{entry.owner_username || "Anonymous"}</Text>
                  </View>
                </View>
                <View style={styles.rankingCardRight}>
                  <View style={[styles.rankingRankBadge, { borderColor: rkColor + "44", backgroundColor: rkColor + "18" }]}>
                    <Text style={[styles.rankingRankBadgeText, { color: rkColor }]}>{entry.rank_tier}</Text>
                  </View>
                  <View style={styles.rankingMetrics}>
                    <View style={styles.rankingMetric}>
                      <Signal color={palette.success} size={10} />
                      <Text style={styles.rankingMetricText}>{entry.sync_success}</Text>
                    </View>
                    <View style={styles.rankingMetric}>
                      <Star color={palette.gold} size={10} />
                      <Text style={styles.rankingMetricText}>{entry.reputation_score}</Text>
                    </View>
                    <View style={styles.rankingMetric}>
                      <Coins color={palette.gold} size={10} />
                      <Text style={styles.rankingMetricText}>{entry.marketplace_sales}</Text>
                    </View>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      );
    }

    return null;
  };

  const renderSponsoredCarousel = useCallback(() => {
    if (tab !== "browse") return null;
    return <MktSponsoredCarousel userId={user?.id ?? null} />;
  }, [tab, user?.id]);

  // ── Free-tier lock ──────────────────────────────────────────────
  if (!isPaid) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.lockedRoot}>
          <LinearGradient colors={["rgba(54,245,255,0.06)", "rgba(10,18,30,0.72)", "rgba(3,6,11,0.96)"]} style={StyleSheet.absoluteFill} />
          <View style={styles.lockedContent}>
            <View style={[styles.lockedIcon, { borderColor: "rgba(54,245,255,0.35)" }]}>
              <ArrowRightLeft color={palette.cyan} size={40} />
            </View>
            <Text style={styles.lockedTitle}>Exchange requires Pro or higher.</Text>
            <Text style={styles.lockedSubtitle}>
              Upgrade to Pro or higher to browse, buy, and sell EAGOH intelligence syncs on the Exchange.
            </Text>
            <Pressable
              onPress={() => router.push("/subscription" as never)}
              style={({ pressed }) => [styles.lockedCta, pressed && { opacity: 0.85 }]}
            >
              <Crown color={palette.void} size={16} />
              <Text style={styles.lockedCtaText}>View Plans</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: pal.void }]}>
      <SafeAreaView edges={["top"]} style={styles.safe}>
        <FlatList
          data={[] as any[]}
          renderItem={null}
          ListHeaderComponent={renderHeader}
          ListFooterComponent={() => (<View>{renderListings()}{renderSponsoredCarousel()}</View>)}
          keyExtractor={() => "dummy"}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          {...LIST_PERFORMANCE_PROPS}
        />
      </SafeAreaView>

      {/* Free user upsell */}
      {!isPaid && !loading && (
        <View style={styles.freeUpsell}>
          <LinearGradient colors={["rgba(138,92,255,0.25)", "rgba(10,20,38,0.95)"]} style={StyleSheet.absoluteFill} />
          <Shield color={palette.violet} size={18} />
          <Text style={styles.freeUpsellText}>Upgrade to Pro to buy and sell EAGOH syncs</Text>
        </View>
      )}

      {/* Modals */}
      <PurchaseModal
        visible={!!purchaseModal}
        listing={purchaseModal}
        onClose={() => { console.log("[Exchange] Closing purchase modal, resetting showSourceInfo"); setPurchaseModal(null); setShowSourceInfo(false); }}
        onConfirm={handlePurchaseConfirm}
        showSourceInfo={showSourceInfo}
        onToggleSourceInfo={() => { console.log("[Exchange] Toggling source info, current:", showSourceInfo); setShowSourceInfo((v) => !v); }}
        purchasing={purchasing}
        reputation={repMap.get(purchaseModal?.eagoh_id ?? "")}
        onViewVendorProfile={(vendorId) => setPublicProfileVendorId(vendorId)}
      />
      <CreateListingModal
        visible={createModal}
        onClose={() => setCreateModal(false)}
        onCreated={loadData}
        creating={creating}
      />
      <EditListingModal
        visible={!!editModal}
        listing={editModal}
        onClose={() => setEditModal(null)}
        onUpdated={loadData}
        updating={updating}
      />
      <PublicProfileModal
        visible={!!publicProfileVendorId}
        userId={publicProfileVendorId}
        currentUserId={user?.id ?? null}
        onClose={() => setPublicProfileVendorId(null)}
      />
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  // Free-tier locked page
  lockedRoot: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, overflow: "hidden" as const, padding: 24 },
  lockedContent: { alignItems: "center" as const, gap: 16, maxWidth: 340 },
  lockedIcon: { width: 80, height: 80, borderRadius: 5, borderWidth: 1, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: "rgba(54,245,255,0.08)" },
  lockedTitle: { color: palette.text, fontSize: 20, fontWeight: "900" as const, textAlign: "center" as const, letterSpacing: -0.5 },
  lockedSubtitle: { color: palette.muted, fontSize: 13, fontWeight: "600" as const, textAlign: "center" as const, lineHeight: 20 },
  lockedCta: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 5, backgroundColor: palette.cyan, marginTop: 8 },
  lockedCtaText: { color: palette.void, fontSize: 15, fontWeight: "900" as const, letterSpacing: 0.5 },
  scroll: { padding: 16, paddingBottom: 130, gap: 16 },

  // Hero
  hero: {
    minHeight: 200,
    borderRadius: 5,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(54,245,255,0.18)",
    padding: 20,
    justifyContent: "flex-end",
    backgroundColor: palette.panelStrong,
  },
  radarDisc: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 1,
    borderColor: "rgba(54,245,255,0.18)",
    right: -40,
    top: -40,
    backgroundColor: "rgba(54,245,255,0.04)",
  },
  kicker: { color: palette.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 2.2, marginBottom: 6 },
  title: { color: palette.text, fontSize: 32, fontWeight: "900", letterSpacing: -0.8, lineHeight: 34 },
  subtitle: { color: palette.muted, fontSize: 13, lineHeight: 19, marginTop: 8, fontWeight: "700" },
  heroStats: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  heroStat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: "rgba(3,6,11,0.45)",
  },
  heroStatText: { color: palette.text, fontSize: 11, fontWeight: "900" },

  // Vendor Stats
  vendorStatsCard: {
    borderRadius: 5,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(138,92,255,0.25)",
    padding: 14,
  },
  vendorStatsHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  vendorStatsTitle: { color: palette.text, fontSize: 15, fontWeight: "900", flex: 1 },
  rankBadge: {
    fontSize: 10,
    fontWeight: "900",
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
    overflow: "hidden",
  },
  vendorStatsGrid: { flexDirection: "row", gap: 10 },
  vendorStatItem: { flex: 1, alignItems: "center", gap: 3 },
  vendorStatValue: { color: palette.text, fontSize: 20, fontWeight: "900" },
  vendorStatLabel: { color: palette.muted, fontSize: 10, fontWeight: "800", textAlign: "center" },

  // Active Syncs section
  activeSyncsSection: { gap: 8 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  sectionTitle: { color: palette.text, fontSize: 16, fontWeight: "900" },
  sectionCount: {
    color: palette.cyan,
    fontSize: 12,
    fontWeight: "900",
    backgroundColor: palette.cyanSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
  },

  // Filters
  filterPanel: {
    gap: 10,
    borderRadius: 5,
    padding: 12,
    backgroundColor: "rgba(14,24,37,0.72)",
    borderWidth: 1,
    borderColor: palette.line,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 42,
    borderRadius: 5,
    paddingHorizontal: 12,
    backgroundColor: "rgba(3,6,11,0.62)",
    borderWidth: 1,
    borderColor: palette.line,
  },
  searchInput: { color: palette.text, flex: 1, fontSize: 13, fontWeight: "800" },
  filterHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  filterTitle: { color: palette.text, fontSize: 13, fontWeight: "900", letterSpacing: 1, flex: 1 },
  filterLabel: { color: palette.muted, fontSize: 10, fontWeight: "900", letterSpacing: 1, marginBottom: 2 },
  clearFilterBtn: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5, backgroundColor: palette.emberSoft },
  clearFilterText: { color: palette.ember, fontSize: 11, fontWeight: "900" },
  chipRail: { gap: 7, paddingRight: 8 },
  chip: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  activeChip: { backgroundColor: palette.cyan, borderColor: palette.cyan },
  chipText: { color: palette.muted, fontSize: 11, fontWeight: "900" },
  activeChipText: { color: palette.void },

  // Tabs
  tabRail: { gap: 8, paddingRight: 8, paddingTop: 16, paddingBottom: 16 },
  tabChip: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  tabChipActive: { backgroundColor: palette.cyan, borderColor: palette.cyan },
  tabChipText: { color: palette.muted, fontSize: 12, fontWeight: "900" },
  tabChipTextActive: { color: palette.void },
  createListingBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: palette.cyan,
    borderRadius: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: palette.cyanSoft,
  },
  createListingText: { color: palette.cyan, fontSize: 12, fontWeight: "900" },

  // Listing Cards — horizontal layout: image left 48%, info right 52%
  listingsWrap: { gap: 12 },
  domainCarouselsWrap: { gap: 22, paddingBottom: 8 },
  listingCard: {
    borderRadius: 5,
    backgroundColor: "rgba(14,24,37,0.84)",
    borderWidth: 1,
    borderColor: palette.line,
    overflow: "hidden",
    flexDirection: "row" as const,
    flexShrink: 0,
  },
  cardGlow: { position: "absolute", width: 80, height: 80, borderRadius: 40, opacity: 0.10, right: -20, top: -20 },

  // Image Section — left 40%, fills full card height
  imageSection: {
    borderRadius: 5,
    overflow: "hidden",
    borderRightWidth: 1,
    borderColor: palette.line,
    backgroundColor: "#03060B",
  },
  // ImageWrapper — centers the EAGOH, minimal padding so image fills its section
  imageWrapper: {
    flex: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    paddingHorizontal: 6,
    paddingVertical: 18,
    overflow: "hidden" as const,
  },
  // Radial spotlight glow behind the EAGOH character
  radialSpotlight: {
    position: "absolute",
    borderRadius: 999,
    alignSelf: "center",
    top: "50%" as const,
    transform: [{ translateY: "-50%" as const }],
  },
  listingImageDomainBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: "rgba(3,6,11,0.82)",
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  listingImageDomainBadgeText: { color: palette.cyan, fontSize: 9, fontWeight: "900" },
  rankPillSmall: {
    position: "absolute",
    bottom: 6,
    left: 6,
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  rankPillSmallText: { fontSize: 8, fontWeight: "900" },

  // Info Section — right 60%, fills remaining card width, content spaced top-to-bottom
  infoSection: {
    flex: 1,
    padding: 12,
    gap: 4,
    justifyContent: "space-between" as const,
  },
  listingInfo: { gap: 4 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  listingName: { color: palette.text, fontSize: 16, fontWeight: "900", flex: 1, flexShrink: 1 },
  listingDomain: { color: palette.cyan, fontSize: 12, fontWeight: "800" },
  listingDna: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 },
  dnaTag: {
    backgroundColor: "rgba(138,92,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(138,92,255,0.25)",
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  dnaTagText: { color: palette.violet, fontSize: 9, fontWeight: "900" },
  // Knowledge attribute rows (cleaned domain DNA values)
  knowledgeRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6, marginTop: 3 },
  knowledgeItem: { flexDirection: "row" as const, alignItems: "center" as const, gap: 3 },
  knowledgeLabel: { color: palette.muted, fontSize: 8, fontWeight: "800" as const, letterSpacing: 0.3 },
  knowledgeValue: { color: palette.text, fontSize: 9, fontWeight: "900" as const },
  knowledgeMore: { color: palette.cyan, fontSize: 9, fontWeight: "800" as const, marginLeft: 2 },
  teamText: { color: palette.gold, fontSize: 10, fontWeight: "900", marginTop: 2 },
  metricGrid: { gap: 1, marginTop: 4 },
  metricRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  metric: { color: palette.text, fontSize: 10, fontWeight: "800" },
  // Phase 6A: Trust indicators
  trustRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 5, flexWrap: "wrap" as const },
  trustPill: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, borderWidth: 1 },
  trustPillText: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 0.3 },
  vendorStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: palette.line,
  },
  vendorText: { color: palette.muted, fontSize: 11, fontWeight: "800" },

  // Price + Buy button — stacked vertically, button under price text
  priceButtonCol: {
    gap: 6,
  },
  pricePreview: { color: palette.gold, fontSize: 13, fontWeight: "900" },
  buyButton: {
    minHeight: 40,
    borderRadius: 5,
    backgroundColor: palette.cyan,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 14,
    alignSelf: "stretch" as const,
  },
  buyButtonDisabled: { backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: palette.line },
  buyButtonText: { color: palette.void, fontSize: 12, fontWeight: "900" },
  buyButtonTextDisabled: { color: palette.muted },

  // My Listing Card
  myListingCard: {
    borderRadius: 5,
    padding: 12,
    backgroundColor: "rgba(14,24,37,0.84)",
    borderWidth: 1,
    borderColor: palette.line,
  },
  myListingCardInactive: { opacity: 0.55 },
  myListingRow: { flexDirection: "row", gap: 12 },
  // Image section — left side, full EAGOH view with dark gradient background
  myListingImageSection: {
    width: 110,
    minHeight: 150,
    borderRadius: 5,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "#03060B",
    flexShrink: 0,
  },
  myListingSpotlight: {
    position: "absolute",
    borderRadius: 999,
    alignSelf: "center",
    top: "50%" as const,
    transform: [{ translateY: "-50%" as const }],
  },
  myListingImageInner: {
    flex: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    paddingHorizontal: 8,
    paddingVertical: 14,
    overflow: "hidden" as const,
  },
  myListingDomainBadge: {
    position: "absolute",
    top: 4,
    left: 4,
    backgroundColor: "rgba(3,6,11,0.82)",
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  myListingDomainBadgeText: { color: palette.cyan, fontSize: 8, fontWeight: "900" },
  myListingRepBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 3,
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: "flex-start" as const,
  },
  myListingRepBadgeText: { fontSize: 10, fontWeight: "900" as const },
  myListingMetrics: { gap: 1 },
  myListingImagePlaceholder: { alignItems: "center", justifyContent: "center", flex: 1 },
  myListingInfo: { flex: 1, gap: 4 },
  myListingTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  myListingName: { color: palette.text, fontSize: 16, fontWeight: "900", flex: 1, flexShrink: 1 },
  myListingMinPrice: { color: palette.gold, fontSize: 12, fontWeight: "900" },
  activeDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0, marginLeft: 8 },
  activeDotOn: { backgroundColor: palette.success },
  activeDotOff: { backgroundColor: palette.ember },
  myListingPrices: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 4 },
  myListingPriceTag: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  myListingPriceText: { color: palette.muted, fontSize: 11, fontWeight: "800" },
  myListingActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  myListingEditBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: palette.cyan,
    borderRadius: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: palette.cyanSoft,
  },
  myListingEditText: { color: palette.cyan, fontSize: 12, fontWeight: "900" },
  myListingShareBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: palette.violet,
    borderRadius: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "rgba(169,77,255,0.08)",
  },
  myListingShareText: { color: palette.violet, fontSize: 12, fontWeight: "900" },
  myListingActionBtn: { borderRadius: 5, paddingHorizontal: 14, paddingVertical: 7 },
  myListingActionBtnOff: { backgroundColor: palette.emberSoft, borderWidth: 1, borderColor: palette.ember },
  myListingActionBtnOn: { backgroundColor: palette.successSoft, borderWidth: 1, borderColor: palette.success },
  myListingActionText: { fontSize: 12, fontWeight: "900", color: palette.success },
  myListingActionTextOff: { color: palette.ember },

  // Active Sync Card
  activeSyncCard: {
    flexDirection: "row",
    borderRadius: 5,
    padding: 10,
    backgroundColor: "rgba(14,24,37,0.76)",
    borderWidth: 1,
    borderColor: palette.line,
    justifyContent: "space-between",
  },
  activeSyncLeft: { flexDirection: "row", gap: 10, flex: 1 },
  activeSyncImage: {
    width: 48,
    height: 58,
    borderRadius: 5,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.line,
  },
  activeSyncInfo: { flex: 1, justifyContent: "center", gap: 2 },
  activeSyncName: { color: palette.text, fontSize: 14, fontWeight: "900" },
  activeSyncVendor: { color: palette.muted, fontSize: 11, fontWeight: "800" },
  activeSyncLevel: { color: palette.cyan, fontSize: 11, fontWeight: "800" },
  activeSyncRight: { alignItems: "flex-end", justifyContent: "center", gap: 4 },
  activeSyncStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: palette.successSoft,
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  activeSyncStatusWarn: { backgroundColor: palette.emberSoft },
  activeSyncStatusText: { color: palette.success, fontSize: 10, fontWeight: "900" },
  activeSyncStatusTextWarn: { color: palette.ember },
  activeSyncTime: { color: palette.text, fontSize: 12, fontWeight: "900" },
  activeSyncTimeWarn: { color: palette.ember },
  activeSyncCost: { color: palette.gold, fontSize: 11, fontWeight: "900" },

  // Exchange buyer feedback expand section
  exchangeExpandHint: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 4 },
  exchangeExpandText: { color: palette.cyan, fontSize: 9, fontWeight: "900" as const, letterSpacing: 0.5 },
  exchangeOISection: {
    marginTop: 8,
    padding: 12,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(10,20,38,0.50)",
    gap: 10,
  },
  exchangeOIHeader: { color: palette.cyan, fontSize: 9, fontWeight: "900" as const, letterSpacing: 1.5, textTransform: "uppercase" as const },
  exchangeLoadingWrap: { alignItems: "center", paddingVertical: 20 },
  exchangeEmptyText: { color: palette.muted, fontSize: 12, fontWeight: "700" as const, textAlign: "center" as const, paddingVertical: 16 },

  // Phase 7A: Exchange search & filter
  exchangeSearchRow: { flexDirection: "row" as const, gap: 8, alignItems: "center" as const, marginTop: 6, marginBottom: 6 },
  exchangeSearchWrap: {
    flex: 1, flexDirection: "row" as const, alignItems: "center" as const, gap: 8,
    paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: palette.line,
    backgroundColor: "rgba(10,18,30,0.50)", minHeight: 38,
  },
  exchangeSearchInput: {
    flex: 1, color: palette.text, fontSize: 12, fontWeight: "700" as const,
    paddingVertical: 8,
  },
  exchangeSearchClear: { width: 22, height: 22, alignItems: "center" as const, justifyContent: "center" as const },
  exchangeFilterToggle: {
    width: 38, height: 38, borderRadius: 6, borderWidth: 1,
    borderColor: palette.line, backgroundColor: "rgba(10,18,30,0.50)",
    alignItems: "center" as const, justifyContent: "center" as const,
  },
  exchangeFilterPanel: {
    borderRadius: 6, borderWidth: 1, borderColor: palette.line,
    backgroundColor: "rgba(10,20,38,0.40)", padding: 10, gap: 4, marginBottom: 6,
  },
  exchangeFilterLabel: {
    color: palette.cyan, fontSize: 9, fontWeight: "900" as const,
    letterSpacing: 1.5, textTransform: "uppercase" as const,
  },
  exchangeFilterChips: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 5, marginTop: 4 },
  exchangeFilterChip: {
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 4, borderWidth: 1,
    borderColor: palette.line, backgroundColor: "rgba(255,255,255,0.03)",
  },
  exchangeFilterChipText: { fontSize: 10, fontWeight: "800" as const, color: palette.muted },
  exchangeFilterEmpty: { alignItems: "center" as const, paddingVertical: 24, gap: 6 },
  exchangeFilterEmptyTitle: { color: palette.text, fontSize: 13, fontWeight: "900" as const },
  exchangeFilterEmptyDesc: { color: palette.muted, fontSize: 11, fontWeight: "700" as const, textAlign: "center" as const },
  exchangeExpiredBadge: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3,
    backgroundColor: `${palette.ember}18`, borderWidth: 1, borderColor: `${palette.ember}44`,
    marginTop: 4,
  },
  exchangeExpiredText: { color: palette.ember, fontSize: 8, fontWeight: "900" as const, letterSpacing: 1 },

  // Empty
  emptyWrap: { alignItems: "center", paddingVertical: 40, gap: 10 },
  emptyTitle: { color: palette.text, fontSize: 18, fontWeight: "900" },
  emptyBody: { color: palette.muted, fontSize: 13, fontWeight: "700", textAlign: "center", lineHeight: 19, paddingHorizontal: 20 },
  emptyHint: { color: palette.muted, fontSize: 13, fontWeight: "700", paddingVertical: 8 },
  emptyActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: palette.cyan,
    borderRadius: 5,
    paddingHorizontal: 16,
    paddingVertical: 9,
    marginTop: 6,
  },
  emptyActionText: { color: palette.void, fontSize: 13, fontWeight: "900" },

  // Loading
  loadingWrap: { alignItems: "center", paddingVertical: 40 },

  // Free upsell
  freeUpsell: {
    position: "absolute",
    bottom: 90,
    left: 16,
    right: 16,
    borderRadius: 5,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(138,92,255,0.25)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
  },
  freeUpsellText: { color: palette.text, fontSize: 13, fontWeight: "800", flex: 1 },

  // ── Modals ──────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "flex-end",
  },
  modalOverlayAbs: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "flex-end",
    zIndex: 9999,
    elevation: 9999,
  },
  modalSheet: {
    maxHeight: "85%",
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    overflow: "hidden",
    padding: 18,
  },
  modalSheetCreate: {
    maxHeight: SCREEN_HEIGHT * 0.75,
    height: SCREEN_HEIGHT * 0.75,
    flexShrink: 0,
  },
  createModalScroll: { paddingBottom: 24 },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.line,
    alignSelf: "center",
    marginBottom: 16,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  modalTitle: { color: palette.text, fontSize: 20, fontWeight: "900" },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  modalSectionLabel: { color: palette.muted, fontSize: 11, fontWeight: "900", letterSpacing: 1, marginBottom: 4, marginTop: 12 },
  modalSectionDesc: { color: palette.text, fontSize: 12, fontWeight: "700", marginBottom: 8, lineHeight: 17 },

  // ── Source Info absolute overlay (inside PurchaseModal) ────────
  sourceInfoOverlayAbsolute: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center" as const,
    alignItems: "center" as const,
    padding: 16,
    zIndex: 10,
  },
  infoContainerAbsolute: {
    width: "100%" as const,
    maxHeight: SCREEN_HEIGHT * 0.80,
    borderRadius: 5,
    overflow: "hidden" as const,
    borderWidth: 1,
    borderColor: "rgba(54,245,255,0.16)",
  },
  infoHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
    backgroundColor: "rgba(10,22,40,0.95)",
  },
  infoHeaderTitle: { color: palette.text, fontSize: 18, fontWeight: "900" as const },
  infoBody: {
    flexShrink: 1,
  },
  infoBodyContent: {
    padding: 16,
    paddingBottom: 24,
    gap: 10,
  },
  infoFooter: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: palette.line,
    backgroundColor: "rgba(10,22,40,0.95)",
  },
  infoEagohPreview: { flexDirection: "row" as const, gap: 12 },
  infoDivider: {
    height: 1,
    backgroundColor: palette.line,
    marginVertical: 4,
  },

  // Purchase modal specific
  modalEagohPreview: { flexDirection: "row", gap: 12, marginBottom: 8 },
  modalEagohImage: {
    width: 64,
    height: 78,
    borderRadius: 5,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.line,
  },
  modalEagohNameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  modalEagohName: { color: palette.text, fontSize: 17, fontWeight: "900", flex: 1 },
  infoIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: palette.line,
  },
  modalEagohDomain: { color: palette.cyan, fontSize: 12, fontWeight: "800" },
  modalVendor: { color: palette.muted, fontSize: 12, fontWeight: "700" },

  detailRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  detailRowCol: { gap: 6 },
  detailIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  detailLabel: { color: palette.muted, fontSize: 11, fontWeight: "800", width: 90 },
  detailValue: { color: palette.text, fontSize: 12, fontWeight: "900", flex: 1 },
  detailDnaWrap: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 },
  detailDnaTag: {
    backgroundColor: "rgba(138,92,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(138,92,255,0.25)",
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  detailDnaTagText: { color: palette.violet, fontSize: 9, fontWeight: "900" },

  syncLevelGrid: { flexDirection: "row", gap: 8 },
  syncLevelChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 5,
    padding: 10,
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  syncLevelChipActive: { borderColor: palette.cyan, backgroundColor: palette.cyanSoft },
  syncLevelChipDisabled: { opacity: 0.35 },
  syncLevelText: { color: palette.text, fontSize: 13, fontWeight: "900" },
  syncLevelTextActive: { color: palette.cyan },
  syncLevelTextDisabled: { color: palette.muted },
  syncLevelPrice: { color: palette.gold, fontSize: 10, fontWeight: "900" },
  syncLevelPriceActive: { color: palette.gold },

  daysRow: { flexDirection: "row", gap: 8 },
  dayChip: {
    width: 44,
    height: 38,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  dayChipActive: { borderColor: palette.cyan, backgroundColor: palette.cyanSoft },
  dayChipText: { color: palette.text, fontSize: 15, fontWeight: "900" },
  dayChipTextActive: { color: palette.cyan },

  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderColor: palette.line,
  },
  totalLabel: { color: palette.muted, fontSize: 13, fontWeight: "800" },
  totalValueRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  totalValue: { color: palette.gold, fontSize: 22, fontWeight: "900" },
  totalBreakdown: { color: palette.muted, fontSize: 11, fontWeight: "700", marginTop: 2 },

  confirmButton: {
    marginTop: 14,
    minHeight: 46,
    borderRadius: 5,
    backgroundColor: palette.cyan,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  confirmButtonDisabled: { backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: palette.line },
  confirmButtonText: { color: palette.void, fontSize: 14, fontWeight: "900" },

  // Retention disclaimer
  retentionNoticeRow: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 2, marginTop: 8, marginBottom: 4 },
  retentionNoticeText: { color: palette.muted, fontSize: 10, fontWeight: "700" },
  retentionDisclaimerSection: { paddingHorizontal: 2, paddingVertical: 6 },
  retentionDisclaimerHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  retentionDisclaimerTitle: { color: palette.cyan, fontSize: 12, fontWeight: "900" },
  retentionDisclaimerBody: { color: palette.text, fontSize: 11, fontWeight: "600", lineHeight: 16, marginBottom: 4 },
  retentionDisclaimerFootnote: { color: palette.muted, fontSize: 10, fontWeight: "700", lineHeight: 14 },

  // Create listing specific
  priceGrid: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  priceInputWrap: { flex: 1, minWidth: "45%", gap: 3 },
  priceInputLabel: { color: palette.muted, fontSize: 10, fontWeight: "800" },
  priceInput: {
    color: palette.text,
    fontSize: 14,
    fontWeight: "900",
    backgroundColor: "rgba(3,6,11,0.62)",
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  descriptionInput: {
    color: palette.text,
    fontSize: 13,
    fontWeight: "700",
    backgroundColor: "rgba(3,6,11,0.62)",
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 5,
    paddingHorizontal: 10,
    paddingVertical: 10,
    minHeight: 70,
    textAlignVertical: "top",
  },

  // Edit listing modal specific
  editEagohPreview: { flexDirection: "row", gap: 12, marginBottom: 4 },
  editEagohImage: {
    width: 72,
    height: 86,
    borderRadius: 5,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.void,
  },
  editStatusText: { fontSize: 10, fontWeight: "800", marginTop: 2 },

  // Netflix-style domain carousels
  carouselsWrap: { gap: 20, paddingBottom: 8 },
  carouselSection: { gap: 8 },
  carouselSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 4,
  },
  carouselSectionTitle: { color: palette.text, fontSize: 17, fontWeight: "900", letterSpacing: -0.3 },
  carouselSectionCount: {
    color: palette.cyan,
    fontSize: 11,
    fontWeight: "900",
    backgroundColor: palette.cyanSoft,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  carouselRail: { gap: 10, paddingRight: 8 },
  carouselCard: {
    width: 164,
    borderRadius: 5,
    backgroundColor: "rgba(14,24,37,0.84)",
    borderWidth: 1,
    borderColor: palette.line,
    overflow: "hidden",
  },
  carouselCardImage: {
    width: "100%",
    height: 146,
    overflow: "hidden",
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
  },
  carouselImagePlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.void,
  },
  carouselCardInfo: { padding: 10, gap: 3 },
  carouselCardName: { color: palette.text, fontSize: 13, fontWeight: "900" },
  carouselCardVendor: { color: palette.muted, fontSize: 11, fontWeight: "700" },
  carouselCardPrice: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  carouselCardPriceText: { color: palette.gold, fontSize: 12, fontWeight: "900" },
  carouselCardPriceFree: { color: palette.success, fontSize: 12, fontWeight: "900", marginTop: 3 },

  repScoreBadge: { flexDirection: "row" as const, alignItems: "center" as const, gap: 3, borderWidth: 1, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  repScoreText: { fontSize: 10, fontWeight: "900" as const },
  vendorDivider: { width: 1, height: 12, backgroundColor: palette.line },
  vendorRepText: { fontSize: 11, fontWeight: "800" as const },
  // Source Credentials label (on listing cards)
  credentialsLabel: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: "rgba(54,245,255,0.12)",
  },
  credentialsLabelText: { color: palette.cyan, fontSize: 9, fontWeight: "800" as const },
  // Source Credentials section (in purchase modal)
  sourceCredentialsSection: {
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "rgba(54,245,255,0.16)",
    overflow: "hidden" as const,
    marginTop: 4,
  },
  sourceCredentialsHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(54,245,255,0.08)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(54,245,255,0.10)",
  },
  sourceCredentialsTitle: { color: palette.cyan, fontSize: 12, fontWeight: "900" as const },
  sourceCredentialsBody: { padding: 12, gap: 8 },
  sourceCredRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
  sourceCredRowCol: { gap: 4 },
  sourceCredBodyText: { color: palette.text, fontSize: 11, fontWeight: "700" as const, lineHeight: 16, marginTop: 2 },
  sourceCredPlaceholder: { color: palette.muted, fontSize: 11, fontWeight: "700" as const, lineHeight: 16, fontStyle: "italic" as const },
  myListingRepRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: palette.line },
  myListingRepText: { fontSize: 11, fontWeight: "800" as const },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },

  // Marketplace sponsored banner carousel
  mktBannerCard: {
    width: 200,
    borderRadius: 5,
    padding: 10,
    backgroundColor: "rgba(14,24,37,0.84)",
    borderWidth: 1,
    borderColor: palette.line,
    overflow: "hidden",
    flexDirection: "column",
    gap: 8,
  },
  mktHotBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    zIndex: 2,
    borderRadius: 5,
    backgroundColor: palette.ember,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  mktHotBadgeText: { color: palette.text, fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  mktBannerImage: {
    width: "100%",
    height: 100,
    borderRadius: 5,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.line,
  },
  mktBannerInfo: { gap: 3 },
  mktBannerName: { color: palette.text, fontSize: 14, fontWeight: "900" },
  mktBannerDomain: { color: palette.cyan, fontSize: 11, fontWeight: "800" },
  mktBannerMeta: { flexDirection: "row", gap: 10, marginTop: 2 },
  mktBannerScore: { color: palette.gold, fontSize: 11, fontWeight: "900" },
  mktBannerSync: { color: palette.violet, fontSize: 11, fontWeight: "900" },
  mktBannerRankRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4, borderRadius: 5, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 3, marginTop: 2 },
  mktBannerRankText: { fontSize: 10, fontWeight: "900" as const },

  // Rankings tab
  rankingCard: {
    borderRadius: 5,
    padding: 12,
    backgroundColor: "rgba(14,24,37,0.84)",
    borderWidth: 1,
    borderColor: palette.line,
    overflow: "hidden" as const,
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
  },
  rankingCardLeft: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, flex: 1 },
  rankingNumber: { color: palette.text, fontSize: 18, fontWeight: "900" as const, minWidth: 36 },
  rankingName: { color: palette.text, fontSize: 14, fontWeight: "900" as const },
  rankingVendor: { color: palette.muted, fontSize: 11, fontWeight: "700" as const, marginTop: 1 },
  rankingCardRight: { alignItems: "flex-end" as const, gap: 6 },
  rankingRankBadge: {
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: "hidden" as const,
  },
  rankingRankBadgeText: { fontSize: 10, fontWeight: "900" as const },
  rankingMetrics: { flexDirection: "row" as const, gap: 8 },
  rankingMetric: { flexDirection: "row" as const, alignItems: "center" as const, gap: 3 },
  rankingMetricText: { color: palette.text, fontSize: 10, fontWeight: "800" as const },
});
