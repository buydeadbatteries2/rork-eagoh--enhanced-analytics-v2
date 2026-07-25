import { supabase } from "@/lib/supabase";
import { getTeamById } from "@/data/teams";
import type { RankTier } from "./reputation";

// ── Categories ──────────────────────────────────────────────────────────

export const LEADERBOARD_CATEGORIES = [
  "overall",
  "by_domain",
  "top_vendors",
  "top_faction_contributors",
  "top_oi_feeders",
  "fanatic_specialists",
  "rising",
  "sponsored_standouts",
] as const;

export type LeaderboardCategory = (typeof LEADERBOARD_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<LeaderboardCategory, string> = {
  overall: "Top EAGOHs Overall",
  by_domain: "Top by Domain",
  top_vendors: "Top Marketplace Vendors",
  top_faction_contributors: "Top Faction Contributors",
  top_oi_feeders: "Top Open Intelligence Feeders",
  fanatic_specialists: "Fanatic Team Specialists",
  rising: "Rising EAGOHs",
  sponsored_standouts: "Sponsored Standouts",
};

// ── Timeframes ──────────────────────────────────────────────────────────

export type Timeframe = "today" | "week" | "month" | "all_time";

export const TIMEFRAMES: Timeframe[] = ["today", "week", "month", "all_time"];

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
  all_time: "All Time",
};

// ── Entry Type ──────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  rank: number;
  eagoh_id: string;
  eagoh_name: string;
  owner_username: string;
  owner_id: string;
  domain: string;
  rank_tier: RankTier;
  reputation_score: number;
  primary_dna: string[];
  fanatic_teams: string[];
  marketplace_trust: number;
  faction_influence: number;
  intelligence_quality: number;
  sync_success: number;
  total_observations: number;
  marketplace_sales: number;
  image_thumb_url: string | null;
}

// ── Filters ─────────────────────────────────────────────────────────────

export interface LeaderboardFilters {
  domain?: string;
  rankTier?: RankTier;
  fanaticTeam?: string;
  factionId?: string;
  timeframe?: Timeframe;
  search?: string;
}

// ── Query ───────────────────────────────────────────────────────────────

/**
 * Fetch ranked EAGOHs from the reputation table joined with eagohs and profiles.
 * Supports category, filters, pagination, and timeframe slicing.
 */
export async function getLeaderboard(
  category: LeaderboardCategory,
  filters: LeaderboardFilters = {},
  limit: number = 25,
  offset: number = 0,
): Promise<{ entries: LeaderboardEntry[]; total: number }> {
  // Build the base query: reputation + eagohs + profiles
  let query = supabase
    .from("eagoh_reputation")
    .select(`*, eagohs!inner(id, name, user_id, domain, dna, fanatic_teams, image_thumb_url, created_at), profiles!eagohs(user_id)!inner(username)`, {
      count: "exact",
    });

  // Exclude dormant
  query = query.neq("rank", "Dormant");

  // ── Timeframe slicing ───────────────────────────────────────────────
  if (filters.timeframe && filters.timeframe !== "all_time") {
    const now = new Date();
    let since: Date;
    switch (filters.timeframe) {
      case "today":
        since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case "week":
        since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "month":
        since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
    }
    query = query.gte("updated_at", since!.toISOString());
  }

  // ── Category-specific sorting ───────────────────────────────────────
  let sortColumn: string;
  switch (category) {
    case "top_vendors":
      sortColumn = "marketplace_sales";
      query = query.gt("marketplace_sales", 0);
      break;
    case "top_faction_contributors":
      sortColumn = "faction_influence";
      query = query.gt("faction_influence", 0);
      break;
    case "top_oi_feeders":
      sortColumn = "intelligence_quality";
      query = query.gt("total_observations", 0);
      break;
    case "fanatic_specialists":
      sortColumn = "fanatic_team_strength";
      query = query.gt("fanatic_team_strength", 0);
      break;
    case "rising":
      // Rising: sort by reputation growth (proxied by reputation_score, but filter for lower ranks showing momentum)
      sortColumn = "reputation_score";
      query = query.in("rank", ["Activated", "Bronze", "Silver", "Gold"]);
      break;
    case "sponsored_standouts":
      sortColumn = "banner_impressions";
      query = query.gt("banner_impressions", 0);
      break;
    case "by_domain":
      sortColumn = "reputation_score";
      if (filters.domain) {
        // Filter domain via the joined eagohs table
        query = query.eq("eagohs.domain", filters.domain);
      }
      break;
    case "overall":
    default:
      sortColumn = "reputation_score";
      break;
  }

  // ── Additional filters ──────────────────────────────────────────────
  if (filters.rankTier) {
    query = query.eq("rank", filters.rankTier);
  }

  if (filters.domain && category !== "by_domain") {
    query = query.eq("eagohs.domain", filters.domain);
  }

  if (filters.search) {
    query = query.ilike("eagohs.name", `%${filters.search}%`);
  }

  // ── Sorting and pagination ─────────────────────────────────────────
  query = query
    .order(sortColumn, { ascending: false })
    .order("reputation_score", { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    console.warn("[leaderboards] query error", error.message);
    return { entries: [], total: 0 };
  }

  const rows = (data ?? []) as any[];

  // ── Map to LeaderboardEntry ─────────────────────────────────────────
  const entries: LeaderboardEntry[] = rows.map((row, index) => {
    const eagoh = row.eagohs ?? {};
    const profile = row.profiles ?? {};
    return {
      rank: offset + index + 1,
      eagoh_id: row.eagoh_id,
      eagoh_name: eagoh.name ?? "Unnamed",
      owner_username: profile.username ?? "Anonymous",
      owner_id: eagoh.user_id ?? "",
      domain: eagoh.domain ?? "unknown",
      rank_tier: (row.rank as RankTier) ?? "Activated",
      reputation_score: row.reputation_score ?? 0,
      primary_dna: Array.isArray(eagoh.dna) ? eagoh.dna.slice(0, 3) : [],
      fanatic_teams: Array.isArray(eagoh.fanatic_teams) ? eagoh.fanatic_teams : [],
      marketplace_trust: row.marketplace_trust ?? 0,
      faction_influence: row.faction_influence ?? 0,
      intelligence_quality: row.intelligence_quality ?? 0,
      sync_success: row.sync_success ?? 0,
      total_observations: row.total_observations ?? 0,
      marketplace_sales: row.marketplace_sales ?? 0,
      image_thumb_url: eagoh.image_thumb_url ?? null,
    };
  });

  // Post-filter: fanaticTeam and factionId are applied client-side since they need subqueries
  let filtered = entries;
  if (filters.fanaticTeam) {
    const teamQuery = filters.fanaticTeam!.toLowerCase();
    filtered = filtered.filter((e) =>
      e.fanatic_teams.some((t) => {
        const display = getTeamById(t)?.display_name ?? "";
        return t.toLowerCase().includes(teamQuery) || display.toLowerCase().includes(teamQuery);
      }),
    );
  }
  if (filters.factionId) {
    // Filter by faction membership via subquery
    const { data: factionMemberIds } = await supabase
      .from("faction_members")
      .select("user_id")
      .eq("faction_id", filters.factionId)
      .eq("status", "active");
    if (factionMemberIds) {
      const memberIdSet = new Set((factionMemberIds as { user_id: string }[]).map((m) => m.user_id));
      filtered = filtered.filter((e) => memberIdSet.has(e.owner_id));
    }
  }

  return {
    entries: filtered,
    total: count ?? filtered.length,
  };
}

/**
 * Get a user's EAGOH rankings across all leaderboard categories.
 */
export async function getUserRankings(userId: string): Promise<{
  eagohEntries: LeaderboardEntry[];
  bestCategory: string;
  rankChanges: Array<{ eagoh_id: string; previous_rank: string | null; new_rank: string; reason: string | null; created_at: string }>;
}> {
  // Get all user EAGOH IDs
  const { data: userEagohs } = await supabase
    .from("eagohs")
    .select("id")
    .eq("user_id", userId);
  const eagohIds = (userEagohs ?? []).map((e: { id: string }) => e.id);
  if (eagohIds.length === 0) {
    return { eagohEntries: [], bestCategory: "overall", rankChanges: [] };
  }

  // Get their reputation rows
  const { data: reps } = await supabase
    .from("eagoh_reputation")
    .select("*")
    .in("eagoh_id", eagohIds);
  if (!reps || reps.length === 0) {
    return { eagohEntries: [], bestCategory: "overall", rankChanges: [] };
  }

  // Count all non-dormant reputations to calculate approximate rank positions
  const { count: totalActive } = await supabase
    .from("eagoh_reputation")
    .select("id", { count: "exact", head: true })
    .neq("rank", "Dormant");

  const total = totalActive ?? 0;

  // Get EAGOH details
  const { data: eagohData } = await supabase
    .from("eagohs")
    .select("id, name, domain, dna, fanatic_teams, image_thumb_url")
    .in("id", eagohIds);
  const eagohMap = new Map((eagohData ?? []).map((e: any) => [e.id, e]));

  // Get rank history
  let rankHistory: any[] = [];
  if (eagohIds.length > 0) {
    const { data: history } = await supabase
      .from("eagoh_rank_history")
      .select("*")
      .in("eagoh_id", eagohIds)
      .order("created_at", { ascending: false })
      .limit(10);
    rankHistory = history ?? [];
  }

  const entries: LeaderboardEntry[] = (reps as any[]).map((rep: any, i: number) => {
    const eagoh = eagohMap.get(rep.eagoh_id) ?? {};
    // Approximate rank: count how many have higher reputation_score
    const approxRank = total > 0 ? Math.max(1, Math.round(((total - (i + 1)) / total) * total)) : 1;
    return {
      rank: approxRank,
      eagoh_id: rep.eagoh_id,
      eagoh_name: eagoh.name ?? "Unnamed",
      owner_username: "",
      owner_id: userId,
      domain: eagoh.domain ?? "unknown",
      rank_tier: (rep.rank as RankTier) ?? "Activated",
      reputation_score: rep.reputation_score ?? 0,
      primary_dna: Array.isArray(eagoh.dna) ? eagoh.dna.slice(0, 3) : [],
      fanatic_teams: Array.isArray(eagoh.fanatic_teams) ? eagoh.fanatic_teams : [],
      marketplace_trust: rep.marketplace_trust ?? 0,
      faction_influence: rep.faction_influence ?? 0,
      intelligence_quality: rep.intelligence_quality ?? 0,
      sync_success: rep.sync_success ?? 0,
      total_observations: rep.total_observations ?? 0,
      marketplace_sales: rep.marketplace_sales ?? 0,
      image_thumb_url: eagoh.image_thumb_url ?? null,
    };
  });

  // Determine best category
  let bestCategory = "overall";
  let highest = 0;
  for (const e of entries) {
    if (e.marketplace_sales > highest) { highest = e.marketplace_sales; bestCategory = "top_vendors"; }
    if (e.faction_influence > highest) { highest = e.faction_influence; bestCategory = "top_faction_contributors"; }
    if (e.intelligence_quality > highest) { highest = e.intelligence_quality; bestCategory = "top_oi_feeders"; }
  }

  return {
    eagohEntries: entries.sort((a, b) => b.reputation_score - a.reputation_score),
    bestCategory,
    rankChanges: rankHistory.map((h: any) => ({
      eagoh_id: h.eagoh_id,
      previous_rank: h.previous_rank,
      new_rank: h.new_rank,
      reason: h.reason,
      created_at: h.created_at,
    })),
  };
}

/**
 * Get all distinct domains for filter chips.
 */
export async function getLeaderboardDomains(): Promise<string[]> {
  const { data } = await supabase
    .from("eagohs")
    .select("domain")
    .not("domain", "is", null);
  const domains = new Set((data ?? []).map((r: { domain: string }) => r.domain));
  return [...domains].sort();
}
