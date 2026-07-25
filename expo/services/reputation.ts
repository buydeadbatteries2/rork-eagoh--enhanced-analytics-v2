import { supabase } from "@/lib/supabase";

// ── Rank Tiers ─────────────────────────────────────────────────────────

export const RANK_TIERS = [
  "Dormant",
  "Activated",
  "Bronze",
  "Silver",
  "Gold",
  "Platinum",
  "Diamond",
  "Oracle",
  "Syndicate Prime",
] as const;

export type RankTier = (typeof RANK_TIERS)[number];

/** Reputation score thresholds for each rank */
export const RANK_THRESHOLDS: Record<RankTier, number> = {
  "Dormant": 0,
  "Activated": 1,
  "Bronze": 15,
  "Silver": 30,
  "Gold": 45,
  "Platinum": 60,
  "Diamond": 75,
  "Oracle": 88,
  "Syndicate Prime": 96,
};

export function computeRank(reputationScore: number): RankTier {
  let result: RankTier = "Dormant";
  for (const tier of RANK_TIERS) {
    if (reputationScore >= RANK_THRESHOLDS[tier]) {
      result = tier;
    }
  }
  return result;
}

export function rankColor(rank: RankTier): string {
  switch (rank) {
    case "Syndicate Prime": return "#FFD700";
    case "Oracle": return "#FF4DC4";
    case "Diamond": return "#6CE6FF";
    case "Platinum": return "#B4E0FF";
    case "Gold": return "#FFB547";
    case "Silver": return "#C0C0C0";
    case "Bronze": return "#CD7F32";
    case "Activated": return "#8DA2B5";
    default: return "#555";
  }
}

export function rankEmoji(rank: string): string {
  if (rank === "Syndicate Prime") return "★";
  if (rank === "Oracle") return "◆";
  if (rank === "Diamond") return "◇";
  if (rank === "Platinum") return "●";
  if (rank === "Gold") return "⬡";
  return "";
}

// ── Badges ─────────────────────────────────────────────────────────────

export interface BadgeDefinition {
  id: string;
  name: string;
  description: string;
}

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  {
    id: "high_iq_feed",
    name: "High IQ Feed",
    description: "Average Open Intelligence quality score above 75 across 10+ observations.",
  },
  {
    id: "trusted_vendor",
    name: "Trusted Vendor",
    description: "5+ marketplace sync sales with an average sync success score above 80.",
  },
  {
    id: "faction_asset",
    name: "Faction Asset",
    description: "Active member of a Faction with 15+ shared intelligence entries.",
  },
  {
    id: "fanatic_specialist",
    name: "Fanatic Specialist",
    description: "3+ Fanatic Teams bound with validated intelligence per team.",
  },
  {
    id: "rising_oracle",
    name: "Rising Oracle",
    description: "Reached Oracle rank with 50+ total observations.",
  },
  {
    id: "marketplace_magnet",
    name: "Marketplace Magnet",
    description: "10+ active marketplace sync purchases as a buyer or vendor.",
  },
  {
    id: "deep_sync_proven",
    name: "Deep Sync Proven",
    description: "Completed a 100% sync purchase that ran its full duration.",
  },
  {
    id: "sponsored_standout",
    name: "Sponsored Standout",
    description: "Purchased a sponsored banner with 100+ total impressions.",
  },
];

export type EarnedBadge = {
  id: string;
  eagoh_id: string;
  user_id: string;
  badge_id: string;
  badge_name: string;
  badge_description: string | null;
  earned_at: string;
};

// ── Reputation DB Types ────────────────────────────────────────────────

export interface ReputationRow {
  eagoh_id: string;
  user_id: string;
  reputation_score: number;
  rank: string;
  intelligence_quality: number;
  marketplace_trust: number;
  faction_influence: number;
  sync_success: number;
  activity_level: number;
  fanatic_team_strength: number;
  total_observations: number;
  total_validated: number;
  marketplace_sales: number;
  banner_impressions: number;
  last_calculated_at: string;
  created_at: string;
  updated_at: string;
}

export interface EagohReputationDisplay {
  rank: RankTier;
  reputationScore: number;
  intelligenceQuality: number;
  marketplaceTrust: number;
  factionInfluence: number;
  syncSuccess: number;
  activityLevel: number;
  fanaticTeamStrength: number;
  totalObservations: number;
  totalValidated: number;
  marketplaceSales: number;
  bannerImpressions: number;
  badges: EarnedBadge[];
  lastCalculatedAt: string | null;
}

// ── Compute Reputation Score (mock/local) ──────────────────────────────

interface ScoreInput {
  avgOiQuality: number;
  validatedObservations: number;
  marketplaceSales: number;
  syncSuccessScore: number;
  factionSharedCount: number;
  bannerImpressions: number;
  eagohAgeDays: number;
  totalObservations: number;
}

/**
 * Compute a total reputation score (0–100) and its component breakdown.
 *
 * Weights:
 *   - Intelligence Quality (OI avg quality): 25 points
 *   - Validated Observations count: 15 points
 *   - Marketplace Trust (sales + sync): 20 points
 *   - Faction Influence (shared entries): 20 points
 *   - Sponsored Banner Engagement: 10 points
 *   - EAGOH Age / Activity: 10 points
 */
export function computeReputationComponents(input: ScoreInput): {
  reputationScore: number;
  intelligenceQuality: number;
  marketplaceTrust: number;
  factionInfluence: number;
  syncSuccess: number;
  activityLevel: number;
  fanaticTeamStrength: number;
} {
  // Intelligence Quality: 0-25 based on avg quality score
  const intelligenceQuality = Math.min(25, Math.round((input.avgOiQuality / 100) * 25));

  // Marketplace Trust: 0-20 based on sales count + sync success
  const salesScore = Math.min(10, Math.round((input.marketplaceSales / 20) * 10));
  const syncScore = Math.min(10, Math.round((input.syncSuccessScore / 100) * 10));
  const marketplaceTrust = salesScore + syncScore;

  // Faction Influence: 0-20 based on shared entries
  const factionInfluence = Math.min(20, Math.round((input.factionSharedCount / 30) * 20));

  // Sync Success: 0-10 (already calculated above in marketplace, but separate metric)
  const syncSuccess = Math.round((input.syncSuccessScore / 100) * 100);

  // Activity Level: 0-10 based on EAGOH age and total observations
  const ageScore = Math.min(5, Math.round((input.eagohAgeDays / 90) * 5));
  const obsScore = Math.min(5, Math.round((input.totalObservations / 50) * 5));
  const activityLevel = ageScore + obsScore;

  // Fanatic Team Strength: proxy from validated observations
  const fanaticTeamStrength = Math.min(10, Math.round((input.validatedObservations / 20) * 10));

  // Bonus: sponsored banner engagement: 0-10
  const bannerEngagement = Math.min(10, Math.round((input.bannerImpressions / 500) * 10));

  const reputationScore = Math.max(0, Math.min(100,
    intelligenceQuality + marketplaceTrust + factionInfluence + activityLevel + fanaticTeamStrength + bannerEngagement,
  ));

  return {
    reputationScore,
    intelligenceQuality,
    marketplaceTrust,
    factionInfluence,
    syncSuccess,
    activityLevel,
    fanaticTeamStrength,
  };
}

// ── CRUD: Reputation ───────────────────────────────────────────────────

export async function getReputation(eagohId: string): Promise<ReputationRow | null> {
  const { data, error } = await supabase
    .from("eagoh_reputation")
    .select("*")
    .eq("eagoh_id", eagohId)
    .maybeSingle();
  if (error) {
    console.warn("[reputation] getReputation error", error.message);
    return null;
  }
  return (data as ReputationRow | null) ?? null;
}

export async function getBadges(eagohId: string): Promise<EarnedBadge[]> {
  const { data, error } = await supabase
    .from("eagoh_badges")
    .select("*")
    .eq("eagoh_id", eagohId)
    .order("earned_at", { ascending: false });
  if (error) {
    console.warn("[reputation] getBadges error", error.message);
    return [];
  }
  return (data ?? []) as EarnedBadge[];
}

export async function getRankHistory(eagohId: string, limit: number = 20): Promise<Array<{
  id: string;
  eagoh_id: string;
  user_id: string;
  previous_rank: string | null;
  new_rank: string;
  reputation_score: number;
  reason: string | null;
  created_at: string;
}>> {
  const { data, error } = await supabase
    .from("eagoh_rank_history")
    .select("*")
    .eq("eagoh_id", eagohId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("[reputation] getRankHistory error", error.message);
    return [];
  }
  return (data ?? []) as any[];
}

/**
 * Recalculate and persist the reputation for a given EAGOH.
 * Pulls live data from OI, marketplace, factions, and banners.
 */
export async function recalculateReputation(eagohId: string, userId: string): Promise<ReputationRow> {
  // ── Gather component data ──────────────────────────────────────────

  // Open Intelligence: avg quality + validated + total count
  let avgOiQuality = 0;
  let validatedCount = 0;
  let totalObservations = 0;
  const { data: oiRows } = await supabase
    .from("open_intelligence")
    .select("quality_score, validation_status")
    .eq("eagoh_id", eagohId);
  if (oiRows && oiRows.length > 0) {
    const rows = oiRows as { quality_score: number; validation_status: string }[];
    totalObservations = rows.length;
    validatedCount = rows.filter((r) => r.validation_status === "validated").length;
    avgOiQuality = Math.round(rows.reduce((s, r) => s + (r.quality_score ?? 0), 0) / rows.length);
  }

  // Marketplace: sales count + sync success
  let marketplaceSales = 0;
  let syncSuccessScore = 0;
  const { data: vendorEagohs } = await supabase
    .from("eagohs")
    .select("user_id")
    .eq("id", eagohId)
    .maybeSingle();
  if (vendorEagohs) {
    const vendorId = (vendorEagohs as { user_id: string }).user_id;
    const { count: salesCount } = await supabase
      .from("marketplace_sync_purchases")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", vendorId);
    marketplaceSales = salesCount ?? 0;

    // Sync success from vendor stats
    const { data: stats } = await supabase
      .from("marketplace_vendor_stats")
      .select("sync_success_score")
      .eq("vendor_id", vendorId)
      .maybeSingle();
    if (stats) {
      syncSuccessScore = (stats as { sync_success_score: number }).sync_success_score ?? 0;
    }
  }

  // Faction: shared intelligence count
  let factionSharedCount = 0;
  const { count: fsCount } = await supabase
    .from("faction_shared_intelligence")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  factionSharedCount = fsCount ?? 0;

  // Banner impressions
  let bannerImpressions = 0;
  const { data: userBanners } = await supabase
    .from("sponsored_banners")
    .select("id")
    .eq("purchaser_id", userId);
  if (userBanners && userBanners.length > 0) {
    const bannerIds = (userBanners as { id: string }[]).map((b) => b.id);
    let total = 0;
    for (const bid of bannerIds) {
      const { data: analytics } = await supabase
        .from("banner_analytics")
        .select("impressions")
        .eq("banner_id", bid);
      if (analytics) {
        total += (analytics as { impressions: number }[]).reduce((s, r) => s + (r.impressions ?? 0), 0);
      }
    }
    bannerImpressions = total;
  }

  // EAGOH age
  const { data: eagohRow } = await supabase
    .from("eagohs")
    .select("created_at")
    .eq("id", eagohId)
    .maybeSingle();
  const createdAt = (eagohRow as { created_at: string } | null)?.created_at;
  const eagohAgeDays = createdAt
    ? Math.max(1, Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)))
    : 1;

  // ── Compute score ──────────────────────────────────────────────────
  const components = computeReputationComponents({
    avgOiQuality,
    validatedObservations: validatedCount,
    marketplaceSales,
    syncSuccessScore,
    factionSharedCount,
    bannerImpressions,
    eagohAgeDays,
    totalObservations,
  });

  const rank = computeRank(components.reputationScore);

  // ── Persist ────────────────────────────────────────────────────────
  const existing = await getReputation(eagohId);

  const row = {
    eagoh_id: eagohId,
    user_id: userId,
    reputation_score: components.reputationScore,
    rank,
    intelligence_quality: components.intelligenceQuality,
    marketplace_trust: components.marketplaceTrust,
    faction_influence: components.factionInfluence,
    sync_success: components.syncSuccess,
    activity_level: components.activityLevel,
    fanatic_team_strength: components.fanaticTeamStrength,
    total_observations: totalObservations,
    total_validated: validatedCount,
    marketplace_sales: marketplaceSales,
    banner_impressions: bannerImpressions,
    last_calculated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  let result: ReputationRow;
  if (existing) {
    const { data: updated, error } = await supabase
      .from("eagoh_reputation")
      .update(row)
      .eq("eagoh_id", eagohId)
      .select("*")
      .single();
    if (error) throw error;
    result = updated as ReputationRow;
  } else {
    const insertRow = { ...row, created_at: new Date().toISOString() };
    const { data: created, error } = await supabase
      .from("eagoh_reputation")
      .insert(insertRow)
      .select("*")
      .single();
    if (error) throw error;
    result = created as ReputationRow;
  }

  // ── Record rank change if different ────────────────────────────────
  if (!existing || existing.rank !== rank) {
    await supabase.from("eagoh_rank_history").insert({
      eagoh_id: eagohId,
      user_id: userId,
      previous_rank: existing?.rank ?? null,
      new_rank: rank,
      reputation_score: components.reputationScore,
      reason: existing ? `Recalculated — score ${components.reputationScore}` : "Initial reputation calculation",
    });
  }

  // ── Check and award badges ─────────────────────────────────────────
  await checkAndAwardBadges(eagohId, userId, {
    avgOiQuality,
    totalObservations,
    marketplaceSales,
    syncSuccessScore,
    factionSharedCount,
    bannerImpressions,
    rank,
    validatedObservations: validatedCount,
  });

  return result;
}

// ── Badges Logic ───────────────────────────────────────────────────────

interface BadgeCheckInput {
  avgOiQuality: number;
  totalObservations: number;
  marketplaceSales: number;
  syncSuccessScore: number;
  factionSharedCount: number;
  bannerImpressions: number;
  rank: RankTier;
  validatedObservations: number;
}

async function checkAndAwardBadges(
  eagohId: string,
  userId: string,
  input: BadgeCheckInput,
): Promise<void> {
  const existingBadges = await getBadges(eagohId);
  const existingIds = new Set(existingBadges.map((b) => b.badge_id));

  const toAward: BadgeDefinition[] = [];

  // High IQ Feed: avg quality > 75, 10+ observations
  if (!existingIds.has("high_iq_feed") && input.avgOiQuality >= 75 && input.totalObservations >= 10) {
    toAward.push(BADGE_DEFINITIONS.find((b) => b.id === "high_iq_feed")!);
  }

  // Trusted Vendor: 5+ sales, sync success > 80
  if (!existingIds.has("trusted_vendor") && input.marketplaceSales >= 5 && input.syncSuccessScore >= 80) {
    toAward.push(BADGE_DEFINITIONS.find((b) => b.id === "trusted_vendor")!);
  }

  // Faction Asset: 15+ shared intel
  if (!existingIds.has("faction_asset") && input.factionSharedCount >= 15) {
    toAward.push(BADGE_DEFINITIONS.find((b) => b.id === "faction_asset")!);
  }

  // Fanatic Specialist: 3+ validated per Fanatic Team (proxy: validated >= 3)
  if (!existingIds.has("fanatic_specialist") && input.validatedObservations >= 3) {
    toAward.push(BADGE_DEFINITIONS.find((b) => b.id === "fanatic_specialist")!);
  }

  // Rising Oracle: Oracle+ rank with 50+ observations
  if (!existingIds.has("rising_oracle") && (input.rank === "Oracle" || input.rank === "Syndicate Prime") && input.totalObservations >= 50) {
    toAward.push(BADGE_DEFINITIONS.find((b) => b.id === "rising_oracle")!);
  }

  // Marketplace Magnet: 10+ marketplace sales/purchases
  if (!existingIds.has("marketplace_magnet") && input.marketplaceSales >= 10) {
    toAward.push(BADGE_DEFINITIONS.find((b) => b.id === "marketplace_magnet")!);
  }

  // Deep Sync Proven: sync success > 90
  if (!existingIds.has("deep_sync_proven") && input.syncSuccessScore >= 90) {
    toAward.push(BADGE_DEFINITIONS.find((b) => b.id === "deep_sync_proven")!);
  }

  // Sponsored Standout: 100+ banner impressions
  if (!existingIds.has("sponsored_standout") && input.bannerImpressions >= 100) {
    toAward.push(BADGE_DEFINITIONS.find((b) => b.id === "sponsored_standout")!);
  }

  // Persist new badges
  for (const badge of toAward) {
    const { error } = await supabase.from("eagoh_badges").insert({
      eagoh_id: eagohId,
      user_id: userId,
      badge_id: badge.id,
      badge_name: badge.name,
      badge_description: badge.description,
    });
    if (error) {
      console.warn("[reputation] failed to award badge", badge.id, error.message);
    }
  }
}

/**
 * Get a complete EAGOH reputation display (score, rank, components, badges).
 */
export async function getEagohReputationDisplay(eagohId: string, userId: string): Promise<EagohReputationDisplay | null> {
  let rep = await getReputation(eagohId);
  if (!rep) {
    // Try to calculate on the fly
    try {
      rep = await recalculateReputation(eagohId, userId);
    } catch {
      return null;
    }
  }

  const badges = await getBadges(eagohId);

  return {
    rank: rep.rank as RankTier,
    reputationScore: rep.reputation_score,
    intelligenceQuality: rep.intelligence_quality,
    marketplaceTrust: rep.marketplace_trust,
    factionInfluence: rep.faction_influence,
    syncSuccess: rep.sync_success,
    activityLevel: rep.activity_level,
    fanaticTeamStrength: rep.fanatic_team_strength,
    totalObservations: rep.total_observations,
    totalValidated: rep.total_validated,
    marketplaceSales: rep.marketplace_sales,
    bannerImpressions: rep.banner_impressions,
    badges,
    lastCalculatedAt: rep.last_calculated_at,
  };
}

/**
 * Get reputations for multiple EAGOHs at once (for listings, faction rosters, etc.).
 */
export async function getBulkReputations(eagohIds: string[]): Promise<Map<string, ReputationRow>> {
  if (eagohIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("eagoh_reputation")
    .select("*")
    .in("eagoh_id", eagohIds);
  if (error) {
    console.warn("[reputation] getBulkReputations error", error.message);
    return new Map();
  }
  const map = new Map<string, ReputationRow>();
  for (const row of (data ?? []) as ReputationRow[]) {
    map.set(row.eagoh_id, row);
  }
  return map;
}

/**
 * Get all distinct ranks present in the reputation table (for filter chips).
 */
export async function getActiveRanks(): Promise<RankTier[]> {
  const { data, error } = await supabase
    .from("eagoh_reputation")
    .select("rank")
    .not("rank", "eq", "Dormant");
  if (error) return [];
  const ranks = new Set((data ?? []).map((r: { rank: string }) => r.rank));
  return [...ranks].filter((r): r is RankTier => RANK_TIERS.includes(r as RankTier)).sort((a, b) => {
    return RANK_TIERS.indexOf(b as RankTier) - RANK_TIERS.indexOf(a as RankTier);
  });
}
