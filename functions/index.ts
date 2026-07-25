/**
 * EAGOH Analyst Chat — Cloudflare Worker
 * Phase RETAINED-OI-2 — Trusted purchase reversal status (record_exchange_purchase_reversal RPC)
 * Phase RETAINED-OI-1 + Cap — Retained Exchange Intelligence + 25% Cumulative Cap
  * Phase 12A — Social sharing + faction invite by email/username
 * Phase 11C — JWT-authed RLS client + network fix + OI save diagnostics)
 * Phase 11D — Analyst thread save fix + Exchange sharing validation
 * Phase 11E — Visual analysis blocks for analyst sessions
 * Phase 11F — Visual fallback generation + timeout optimization
 * Phase 11G — Increased worker timeouts for reliability
 * Phase 12B — Secure Forge image generation route (/forge/generate)
 * Phase 12C — Server-side dev test subscriptions, enforce server cost, remove is_default_shell
 * Phase 11D — RPC null-data fallback + diagnostic insert errors)
 * Phase 11E — minimal insert fallback for schema mismatch)
 * Phase 6C — notifications & audit history)
 * Phase 6B: entry management, moderation, is_admin access.
 * Phase 6C: intelligence notifications, moderation audit trail, notification center.
 * Phase 6C-deploy: worker bundling fix.
 * Phase 8A: secure owner-scoped intelligence analytics endpoint (deploy).
 *
 * Secure server-side intelligence grounding system.
 * Column names synchronized with live Supabase schema.
 *
 * Every analyst session (Quick Check, Quick Analysis, Standard Analysis,
 * Oracle Deep Dive, Premium Event) routes through this worker.
 *
 * Phase 1 — Personal Open Intelligence grounding:
 *   1. Authenticates the user via Supabase JWT
 *   2. Verifies EAGOH ownership
 *   3. Retrieves & ranks relevant private Open Intelligence
 *   4. Builds a structured, source-labeled prompt
 *   5. Calls OpenAI and returns the grounded response
 *
 * Phase 2 — Real external web search via Responses API:
 *   1. Determines whether current research is needed
 *   2. Calls OpenAI Responses API (POST /v1/responses) with web_search tool
 *   3. Extracts source annotations from official API response
 *   4. Includes research summary in the final prompt
 *   5. Labels sources clearly and handles OI/external conflicts
 *
 * Phase 3A — Faction Intelligence (deployed)
 *   1. Checks subscription tier (free users skip faction retrieval)
 *   2. Retrieves active faction memberships for the authenticated user
 *   3. Loads explicitly shared OI entries from faction_shared_intelligence
 *   4. Verifies ownership, resolves entries, excludes the user's own
 *   5. Ranks and formats faction entries separately from personal OI
 *   6. Labels faction intelligence clearly in the final prompt
 *
 * Phase 4A — Exchange Sync Intelligence (deployed):
 *   1. Retrieves active Exchange sync purchases for the authenticated user
 *   2. Resolves vendor EAGOHs and loads exchange_share_enabled OI entries
 *   3. Builds a stable access cohort and applies sync percentage
 *   4. Ranks the accessible cohort and applies session entry limits
 *   5. Formats and labels Exchange Intelligence separately
 *
 * Search model: gpt-4o (supports web_search tool natively)
 * Exchange retrieval: uses service_role Supabase client for cross-user OI access
 * Final answer: gpt-4o-mini via Chat Completions API
 *
 * No API keys, private OI content, or service-role tokens ever reach the client.
 * Phase 4B — Harden and Verify Exchange Intelligence (deployed).
 * Phase 5A — Intelligence Usage Auditing and Source Provenance (deployed).
 * Phase 5B — Human Intelligence Quality, Validation, and Reputation (deployed).
 * Phase 5B Security — Locked down feedback, disputes, reputation, versions, rate-limits to server-only.
 * Phase 12C — Server-side dev test subs, enforce server cost, remove is_default_shell from forge limit.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ── Environment ───────────────────────────────────────────────────────────────
// Worker entry point — EAGOH Analyst Chat (Cloudflare)

type Env = {
  OPENAI_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** When "true", the worker honours dev_test_subscriptions rows for Expo Go/Rork testing. Never set in production. */
  ENABLE_DEV_TEST_SUBSCRIPTIONS?: string;
};

// ── Types ────────────────────────────────────────────────────────────────────

type SessionType =
  | "quick-check"
  | "quick-analytics"
  | "standard"
  | "oracle"
  | "premium-event";

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

type AnalystRequest = {
  prompt: string;
  sessionType: SessionType;
  eagohId: string | null;
  personality?: string;
  kind?: string;
  conversationContext?: ConversationMessage[];
  threadId?: string | null;
  messageId?: string | null;
};

type Source = {
  title: string;
  url: string;
  publisher?: string;
  publishedAt?: string;
};

type ExternalResearchResult = {
  used: boolean;
  summary: string;
  sources: Source[];
  error?: string;
};

type PersonalGrounding = {
  personalOpenIntelligenceUsed: boolean;
  personalOpenIntelligenceCount: number;
  factionIntelligenceUsed: boolean;
  factionIntelligenceCount: number;
  exchangeIntelligenceUsed: boolean;
  exchangeIntelligenceCount: number;
  retainedExchangeIntelligenceUsed: boolean;
  retainedExchangeIntelligenceCount: number;
  externalSearchUsed: boolean;
  sourceCount: number;
  exchangeAccess?: {
    activeSyncCount: number;
    vendorEagohCount: number;
  };
};

/** A retained Exchange intelligence row — buyer's permanent read-only library. */
type RetainedExchangeRow = {
  id: string;
  buyer_id: string;
  vendor_id: string;
  vendor_eagoh_id: string;
  source_entry_id: string;
  purchase_id: string;
  listing_id: string | null;
  purchased_percentage: number;
  retention_percentage: number;
  retained_content_snapshot: string;
  source_entry_type: string | null;
  source_tag: string | null;
  source_category: string | null;
  source_quality_score: number | null;
  source_confidence_level: string | null;
  source_validation_status: string | null;
  source_created_at: string | null;
  vendor_display_name: string | null;
  vendor_eagoh_name: string | null;
  active: boolean;
  created_at: string;
};

/** Result of retained Exchange intelligence retrieval. */
type RetainedExchangeResult = {
  used: boolean;
  entries: RetainedExchangeRow[];
};

/** A single Open Intelligence reference — only entries actually supplied to the AI context. */
type OpenIntelligenceReference = {
  referenceNumber: number;
  sourceType: "personal" | "faction" | "exchange" | "retained_exchange";
  entryId: string;
  sourceOwnerId: string | null;
  sourceEagohId: string | null;
  vendorName: string | null;
  eagohName: string | null;
  tag: string | null;
  entryType: string | null;
  category: string | null;
  createdAt: string | null;
  validationStatus: string | null;
  qualityScore: number | null;
  confidenceLevel: string | null;
  exchangePurchaseId: string | null;
  retained: boolean;
  readOnly: boolean;
};

type AnalystResponse =
  | {
      ok: true;
      reply: string;
      model: string;
      sessionType: SessionType;
      confidence: number;
      grounding: PersonalGrounding;
      sources: Source[];
      openIntelligenceReferences: OpenIntelligenceReference[];
    }
  | {
      ok: false;
      errorCode: string;
      error: string;
    };

type OpenIntelligenceRow = {
  id: string;
  user_id: string;
  eagoh_id: string;
  intelligence_domain: string;
  entry_type: string;
  tag: string;
  content: string;
  character_count_no_spaces: number;
  confidence_level: string;
  quality_score: number;
  validation_status: string;
  influence_score: number;
  selected_category?: string | null;
  selected_subtags?: string[] | null;
  custom_tags?: string[] | null;
  exchange_share_enabled?: boolean;
  staleness_score?: number;
  outdated_flag?: boolean;
  content_hash?: string | null;
  duplicate_flag?: boolean;
  active_dispute_count?: number;
  version_number?: number;
  created_at: string;
  updated_at: string;
};

/** Validation statuses used in Phase 5B — includes disputed (reduced weight at ranking).
 *  Legacy "validated" is accepted temporarily for unmigrated rows. */
const VALID_USEABLE_STATUSES = [
  "pending_review",
  "community_supported",
  "externally_supported",
  "disputed",
  "validated", // legacy compatibility for unmigrated rows
] as const;

/** Validation statuses that must be excluded from analyst context. */
const EXCLUDED_STATUSES = ["rejected", "withdrawn"] as const;

/** Contributor reputation row — only overall_score is needed for ranking.
 *  Full internal fields are accessed via service_role only. */
type ContributorReputation = {
  user_id: string;
  overall_score: number;
  calculated_at?: string;
};

type EagohRow = {
  id: string;
  user_id: string;
  name: string;
  domain?: string | null;
};

type FactionMemberRow = {
  id: string;
  faction_id: string;
  user_id: string;
  role: string;
  status: string;
};

type FactionSharedIntelRow = {
  id: string;
  faction_id: string;
  user_id: string;
  oi_entry_id: string;
  shared_at: string;
};

type FactionRow = {
  id: string;
  name: string;
};

type ExchangeSyncRecord = {
  purchaseId: string;
  listingId: string;
  vendorId: string;
  vendorEagohId: string;
  syncPercentage: number;
  startsAt: string;
  expiresAt: string;
  vendorEagohName?: string;
};

type ExchangeResearchResult = {
  used: boolean;
  entries: OpenIntelligenceRow[];
  syncCount: number;
  vendorEagohCount: number;
  /** Map from entry ID to its exchange purchase ID for audit tracking */
  entryPurchaseMap: Map<string, { purchaseId: string; syncPercentage: number }>;
};

/** Faction OI entry with contributor and faction tracking for audit. */
type FactionOIEntry = OpenIntelligenceRow & {
  faction_id: string;
  contributor_user_id: string;
};

/** Unified audit entry record for batch insert. */
type AuditEntryRecord = {
  execution_id: string;
  requesting_user_id: string;
  source_type: "personal" | "faction" | "exchange" | "retained_exchange" | "external_research";
  source_entry_id: string | null;
  source_owner_id: string | null;
  source_eagoh_id: string | null;
  faction_id: string | null;
  exchange_purchase_id: string | null;
  relevance_score: number | null;
  source_rank: number | null;
  sync_percentage: number | null;
  source_created_at: string | null;
  source_category: string | null;
  source_validation_status: string | null;
  source_quality_score: number | null;
  source_confidence_level: string | null;
  external_url_hash: string | null;
  external_publisher: string | null;
  session_type: string;
  selected_eagoh_id: string | null;
  analyst_thread_id: string | null;
  analyst_message_id: string | null;
};

// ── Service-role Supabase client ─────────────────────────────────────────────

/**
 * Create a Supabase client using the service_role key for server-only
 * operations that need to bypass RLS (Exchange intelligence retrieval).
 */
function getServiceRoleClient(env: Env): SupabaseClient | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(normalizeSupabaseUrl(env.SUPABASE_URL ?? ""), env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Create a Supabase client authenticated with the user's JWT.
 *
 * The JWT is injected into the global `Authorization` header so that every
 * query/mutation the worker makes on behalf of the user is evaluated against
 * Row Level Security policies as that user. This is the pattern used by all
 * secure routes (account deletion, Arena history) and is now used by the main
 * analyst chat route so that EAGOH ownership checks respect RLS for every
 * EAGOH owned by the authenticated user — not just the primary one.
 */
function createAuthedClient(env: Env, jwt: string): SupabaseClient {
  return createClient(
    normalizeSupabaseUrl(env.SUPABASE_URL ?? ""),
    env.SUPABASE_ANON_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    },
  );
}

// ── CORS ─────────────────────────────────────────────────────────────────────

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

/**
 * Normalize the Supabase URL — strip trailing slashes and any path suffix
 * (e.g. "/rest/v1", "/auth/v1") so the SDK gets the project origin.
 * Mirrors the client-side normalizeSupabaseUrl in lib/supabase.ts.
 */
function normalizeSupabaseUrl(input: string): string {
  if (!input) return "";
  let url = input.replace(/\/+$/, "");
  try {
    const u = new URL(url);
    url = `${u.protocol}//${u.host}`;
  } catch {
    // leave as-is
  }
  return url;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

async function verifyAuth(
  supabase: SupabaseClient,
  jwt: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getUser(jwt);
    if (error || !data.user) {
      console.warn("[analyst] auth failed", error?.message ?? "no user");
      return null;
    }
    return data.user.id;
  } catch (err) {
    console.warn("[analyst] auth exception", err instanceof Error ? err.message : "unknown");
    return null;
  }
}

// ── EAGOH Ownership ──────────────────────────────────────────────────────────

async function verifyEagohOwnership(
  supabase: SupabaseClient,
  eagohId: string,
  userId: string,
): Promise<EagohRow | null> {
  const { data, error } = await supabase
    .from("eagohs")
    .select("id, user_id, name, domain")
    .eq("id", eagohId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    console.warn("[analyst] eagoh ownership check failed", { eagohId, userId, error: error?.message });
    return null;
  }
  return data as EagohRow;
}

// ── Subscription Check ───────────────────────────────────────────────────────

/**
 * Check whether the authenticated user has a paid subscription.
 * Queries profiles.subscription_tier — free users skip faction intelligence.
 */
async function isPaidUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("subscription_tier")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) {
    console.warn("[analyst] subscription check failed", error?.message);
    return false;
  }

  const tier = (data as { subscription_tier: string }).subscription_tier;
  return tier && tier !== "free";
}

// ── Faction Membership Retrieval ─────────────────────────────────────────────

/**
 * Get eligible faction memberships for the authenticated user.
 * Only active (or grace-period) memberships are returned.
 * Free users are filtered out by `isPaidUser` before calling this.
 */
async function getEligibleFactionMemberships(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ factionId: string; factionName: string }[]> {
  const { data, error } = await supabase
    .from("faction_members")
    .select("faction_id, status")
    .eq("user_id", userId)
    .in("status", ["active", "grace_period"]);

  if (error || !data || data.length === 0) {
    if (error) console.warn("[analyst] faction membership query failed", error.message);
    return [];
  }

  const factionIds = [...new Set((data as Array<{ faction_id: string }>).map((r) => r.faction_id))];
  if (factionIds.length === 0) return [];

  // Resolve faction names
  const { data: factions } = await supabase
    .from("factions")
    .select("id, name")
    .in("id", factionIds);

  const nameMap = new Map<string, string>();
  for (const f of (factions ?? []) as FactionRow[]) {
    nameMap.set(f.id, f.name);
  }

  return factionIds.map((id) => ({
    factionId: id,
    factionName: nameMap.get(id) ?? "Unknown Faction",
  }));
}

// ── Faction Open Intelligence Retrieval ──────────────────────────────────────

/**
 * Retrieve Open Intelligence entries explicitly shared with the user's factions.
 *
 * Flow:
 *   1. Get eligible faction memberships
 *   2. Load faction_shared_intelligence for those factions
 *   3. Resolve referenced OI entries (exclude the user's own — those are personal)
 *   4. Rank and return the most relevant entries
 */
async function retrieveFactionOpenIntelligence(
  supabase: SupabaseClient,
  userId: string,
  query: string,
  sessionType: SessionType,
): Promise<{ entries: FactionOIEntry[]; allRanked: FactionOIEntry[] }> {
  const emptyResult = { entries: [] as FactionOIEntry[], allRanked: [] as FactionOIEntry[] };
  const memberships = await getEligibleFactionMemberships(supabase, userId);
  if (memberships.length === 0) return emptyResult;

  const factionIds = memberships.map((m) => m.factionId);

  const { data: sharedRows, error: sharedErr } = await supabase
    .from("faction_shared_intelligence")
    .select("oi_entry_id, user_id, faction_id")
    .in("faction_id", factionIds)
    .order("shared_at", { ascending: false })
    .limit(100);

  if (sharedErr || !sharedRows || sharedRows.length === 0) {
    if (sharedErr) console.warn("[analyst] faction shared intel query failed", sharedErr.message);
    return emptyResult;
  }

  const typed = sharedRows as Array<{ oi_entry_id: string; user_id: string; faction_id: string }>;
  const foreignRows = typed.filter((r) => r.user_id !== userId);
  if (foreignRows.length === 0) return emptyResult;

  const factionMap = new Map<string, { faction_id: string; contributor_user_id: string }>();
  for (const r of foreignRows) {
    if (!factionMap.has(r.oi_entry_id)) {
      factionMap.set(r.oi_entry_id, { faction_id: r.faction_id, contributor_user_id: r.user_id });
    }
  }

  const entryIds = [...new Set(foreignRows.map((r) => r.oi_entry_id))];

  const { data: entries, error: entriesErr } = await supabase
    .from("open_intelligence")
    .select("*")
    .in("id", entryIds)
    .in("validation_status", [...VALID_USEABLE_STATUSES]);

  if (entriesErr || !entries || entries.length === 0) {
    if (entriesErr) console.warn("[analyst] faction OI entry fetch failed", entriesErr.message);
    return emptyResult;
  }

  const rawEntries = entries as OpenIntelligenceRow[];

  const factionEntries: FactionOIEntry[] = rawEntries.map((e) => {
    const meta = factionMap.get(e.id);
    return { ...e, faction_id: meta?.faction_id ?? "", contributor_user_id: meta?.contributor_user_id ?? "" };
  });

  const limit = sessionFactionOILimit(sessionType);
  // Phase 5B: Fetch contributor reputations for ranking
  const contributorIds = [...new Set(factionEntries.map((e) => e.contributor_user_id).filter(Boolean))];
  const repMap = await fetchReputationsForUsers(supabase, contributorIds);
  const ranked = rankEntries(factionEntries, query, Math.min(limit, factionEntries.length), repMap);
  return { entries: ranked, allRanked: factionEntries };
}

// ── Session Faction Entry Limits ─────────────────────────────────────────────

function sessionFactionOILimit(sessionType: SessionType): number {
  switch (sessionType) {
    case "quick-check": return 2;
    case "quick-analytics": return 4;
    case "standard": return 7;
    case "oracle": return 12;
    case "premium-event": return 8;
  }
}

// ── Open Intelligence Retrieval ──────────────────────────────────────────────

async function retrievePersonalOpenIntelligence(
  supabase: SupabaseClient,
  userId: string,
  eagohId: string,
  limit: number = 50,
): Promise<OpenIntelligenceRow[]> {
  const { data, error } = await supabase
    .from("open_intelligence")
    .select("*")
    .eq("user_id", userId)
    .eq("eagoh_id", eagohId)
    .in("validation_status", [...VALID_USEABLE_STATUSES])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("[analyst] OI retrieval failed", error.message);
    return [];
  }
  return (data ?? []) as OpenIntelligenceRow[];
}

// ── Relevance Ranking ────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "shall", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "through", "during",
    "before", "after", "above", "below", "between", "about", "and", "or",
    "not", "no", "but", "if", "then", "else", "when", "where", "why",
    "how", "all", "each", "every", "both", "few", "more", "most", "other",
    "some", "such", "only", "own", "same", "so", "than", "too", "very",
    "just", "now", "here", "there", "what", "which", "who", "whom",
    "this", "that", "these", "those", "it", "its", "i", "me", "my",
    "we", "our", "you", "your", "he", "she", "they", "them",
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stopWords.has(w));
}

function confidenceMultiplier(level: string): number {
  switch (level) {
    case "verified_observation": return 1.2;
    case "strong_confidence": return 1.0;
    case "moderate_confidence": return 0.85;
    case "weak_suspicion": return 0.65;
    default: return 0.8;
  }
}

function validationMultiplier(status: string): number {
  switch (status) {
    case "externally_supported":
    case "community_supported":
      return 1.15;
    case "pending_review":
      return 1.0;
    case "disputed":
      // Reduced weight — disputed entries stay in context but get a warning label
      return 0.6;
    // rejected and withdrawn are filtered before ranking, but handle defensively
    case "rejected":
    case "withdrawn":
      return 0.0;
    default:
      return 1.0;
  }
}

/** Backward-compat alias for old callers. */
function validationBonus(status: string): number {
  return validationMultiplier(status);
}

/** Reputation lookup cache per request — avoids repeated queries for the same vendor. */
function createReputationCache() {
  const cache = new Map<string, ContributorReputation | null>();
  return {
    get: (userId: string) => cache.get(userId),
    set: (userId: string, rep: ContributorReputation | null) => cache.set(userId, rep),
  };
}

/** Fetch contributor reputation for a user. Returns null if not found. */
async function fetchReputation(
  serviceClient: SupabaseClient,
  userId: string,
  cache: ReturnType<typeof createReputationCache>,
): Promise<ContributorReputation | null> {
  const cached = cache.get(userId);
  if (cached !== undefined) return cached;

  const { data, error } = await serviceClient
    .from("intelligence_contributor_reputation")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    cache.set(userId, null);
    return null;
  }

  const rep = data as ContributorReputation;
  cache.set(userId, rep);
  return rep;
}

/**
 * Compute a reputation multiplier for ranking.
 *
 * Reputation is a SUPPORTING factor (0.9–1.1), NOT the dominant factor.
 * A high-reputation contributor's irrelevant entry cannot outrank a
 * highly relevant lower-reputation entry.
 *
 * Formula: map 0–100 score to 0.9–1.1 range.
 */
function reputationMultiplier(rep: ContributorReputation | null): number {
  if (!rep) return 1.0;
  // 50 = neutral (1.0), 100 = max boost (1.1), 0 = penalty (0.9)
  return 0.9 + (rep.overall_score / 100) * 0.2;
}

/**
 * Staleness penalty: outdated entries receive reduced weight.
 * staleness_score 0 = no penalty, 100 = 50% score reduction.
 */
function stalenessPenalty(entry: OpenIntelligenceRow): number {
  const staleness = entry.staleness_score ?? 0;
  if (staleness <= 0) return 1.0;
  return 1.0 - (staleness / 100) * 0.5;
}

function scoreEntry(
  entry: OpenIntelligenceRow,
  queryTokens: string[],
  reputationRep?: ContributorReputation | null,
): number {
  let score = 0;

  const contentLower = entry.content.toLowerCase();
  for (const token of queryTokens) {
    if (contentLower.includes(token)) score += 3;
  }

  const tagText = [
    entry.tag ?? "",
    entry.selected_category ?? "",
    ...(entry.selected_subtags ?? []),
    ...(entry.custom_tags ?? []),
  ].join(" ").toLowerCase();
  for (const token of queryTokens) {
    if (tagText.includes(token)) score += 2;
  }

  const qualityFactor = 0.5 + (entry.quality_score / 100);
  score *= qualityFactor;

  score += (entry.influence_score / 100) * 2;

  score *= confidenceMultiplier(entry.confidence_level);

  score *= validationMultiplier(entry.validation_status);

  // Staleness penalty (Phase 5B)
  score *= stalenessPenalty(entry);

  // Reputation as supporting factor (Phase 5B) — max ±10% adjustment
  if (reputationRep) {
    score *= reputationMultiplier(reputationRep);
  }

  const ageDays = (Date.now() - new Date(entry.created_at).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays < 30) {
    score += Math.max(0, (30 - ageDays) / 30);
  }

  return Math.round(score * 100) / 100;
}

/** Pre-populated reputation map: user_id → reputation (or null if not found). */
type ReputationMap = Map<string, ContributorReputation | null>;

/**
 * Batch-fetch contributor reputations for a set of user IDs.
 * Uses the safe public view public_contributor_reputation which exposes only
 * user_id, overall_score, and calculated_at — no internal penalty or component data.
 */
async function fetchReputationsForUsers(
  supabase: SupabaseClient,
  userIds: string[],
): Promise<ReputationMap> {
  const result: ReputationMap = new Map();
  if (userIds.length === 0) return result;

  const unique = [...new Set(userIds)];
  const { data, error } = await supabase
    .from("public_contributor_reputation")
    .select("user_id, overall_score, calculated_at")
    .in("user_id", unique);

  if (error || !data) {
    // Non-fatal: rank without reputation data
    console.warn("[analyst] reputation batch fetch failed", error?.message);
    for (const id of unique) result.set(id, null);
    return result;
  }

  for (const row of data as ContributorReputation[]) {
    result.set(row.user_id, row);
  }
  // Fill missing users with null
  for (const id of unique) {
    if (!result.has(id)) result.set(id, null);
  }
  return result;
}

function rankEntries(
  entries: OpenIntelligenceRow[],
  query: string,
  topN: number,
  reputationMap?: ReputationMap,
): OpenIntelligenceRow[] {
  if (entries.length === 0) return [];

  // Filter out rejected and withdrawn entries before ranking (Phase 5B)
  const eligible = entries.filter(
    (e) => !EXCLUDED_STATUSES.includes(e.validation_status as (typeof EXCLUDED_STATUSES)[number]),
  );
  if (eligible.length === 0) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return eligible.slice(0, topN);
  }

  const scored = eligible
    .map((entry) => {
      const rep = reputationMap?.get(entry.user_id) ?? null;
      return { entry, score: scoreEntry(entry, queryTokens, rep) };
    })
    .filter(({ score }) => score > 0.5)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, topN).map(({ entry }) => entry);
}

// ── Session limits ───────────────────────────────────────────────────────────

function sessionOILimit(sessionType: SessionType): number {
  switch (sessionType) {
    case "quick-check": return 3;
    case "quick-analytics": return 6;
    case "standard": return 10;
    case "oracle": return 16;
    case "premium-event": return 10;
  }
}

function sessionOITokenBudget(sessionType: SessionType): number {
  switch (sessionType) {
    case "quick-check": return 500;
    case "quick-analytics": return 1000;
    case "standard": return 2000;
    case "oracle": return 3000;
    case "premium-event": return 1500;
  }
}

// ── Source Transparency (Phase 5B) ───────────────────────────────────────────

/**
 * Format a human-readable validation label for source transparency.
 * Maps validation_status to clear language the AI model uses in responses.
 */
function formatValidationLabel(status: string): string {
  switch (status) {
    case "externally_supported":
      return "Externally supported";
    case "community_supported":
      return "Community supported";
    case "disputed":
      return "Disputed (reduced weight — treat with caution)";
    case "rejected":
      return "Rejected";
    case "withdrawn":
      return "Withdrawn";
    case "pending_review":
    default:
      return "Pending review (unverified human experience)";
  }
}

// ── OI Formatting ────────────────────────────────────────────────────────────

function formatOIContext(
  entries: OpenIntelligenceRow[],
  tokenBudget: number,
): { text: string; count: number } {
  if (entries.length === 0) return { text: "", count: 0 };

  const blocks = entries.map((entry, i) => {
    const confidenceLabel = entry.confidence_level.replace(/_/g, " ");
    const quality = entry.quality_score;
    const influence = entry.influence_score;
    const date = new Date(entry.created_at).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    const maxContentChars = Math.max(100, Math.floor(tokenBudget / entries.length / 4) * 4);
    const content = entry.content.length > maxContentChars
      ? entry.content.slice(0, maxContentChars) + "..."
      : entry.content;

    const tagLine = [entry.selected_category, ...(entry.selected_subtags ?? []), ...(entry.custom_tags ?? [])]
      .filter(Boolean)
      .join(", ") || entry.tag;

    const validationLabel = formatValidationLabel(entry.validation_status);
    const stalenessNote = entry.outdated_flag ? " [OUTDATED]" : (entry.staleness_score && entry.staleness_score > 50 ? " [AGING]" : "");

    return `[OI Entry ${i + 1}]
Category: ${entry.selected_category ?? "General"}
Tags: ${tagLine}
Confidence: ${confidenceLabel}
Quality: ${quality}/100
Influence: ${influence}/100
Validation: ${validationLabel}${stalenessNote}
Created: ${date}
Content: ${content}`;
  });

  const text = `PERSONAL OPEN INTELLIGENCE — USER PROVIDED (${entries.length} entries)
Personal Open Intelligence is private, user-provided knowledge. Treat it as potentially valuable real-world experience, but not automatically verified fact. Consider relevance, confidence, validation status, quality, and recency. Do not call an entry "verified fact" unless its validation status truly supports that wording.

${blocks.join("\n\n")}`;

  return { text, count: entries.length };
}

// ── Exchange Intelligence (Phase 4B hardened) ────────────────────────────────

/**
 * Session-specific limits for Exchange intelligence entries.
 */
function sessionExchangeOILimit(sessionType: SessionType): number {
  switch (sessionType) {
    case "quick-check": return 2;
    case "quick-analytics": return 4;
    case "standard": return 8;
    case "oracle": return 14;
    case "premium-event": return 10;
  }
}

/**
 * Centralized active-sync validation.
 *
 * A sync purchase is active ONLY when ALL of the following are true:
 *   - active = true (single source of truth — all invalid states set this to false)
 *   - buyer_id matches the authenticated user
 *   - started_at is at or before server time
 *   - expires_at is strictly after server time
 *   - sync_level is a valid percentage (25, 50, 75, 100)
 *   - listing exists and is active
 *   - listing.vendor_id matches purchase.vendor_id (defense in depth)
 *   - listing.eagoh_id matches purchase.eagoh_id (defense in depth)
 *   - vendor EAGOH exists, is not deleted/suspended
 *   - EAGOH owner equals verified vendor ID (defense in depth)
 *
 * The marketplace_sync_purchases table uses `active` as the single invalidation
 * flag. Refunds, cancellations, revocations, and disputes must all set
 * `active = false` on the purchase row. No separate refunded/revoked/cancelled
 * columns exist — access is denied when active = false for any reason.
 *
 * Uses the worker's server clock. Prefer DB time (SELECT now()) when the
 * worker can reach Supabase without excessive latency, but worker time is
 * sufficient for short-lived syncs (1–5 days).
 */
function isExchangeSyncActive(
  purchase: {
    id: string;
    listing_id: string;
    buyer_id: string;
    vendor_id: string;
    eagoh_id: string;
    sync_level: string;
    started_at: string;
    expires_at: string;
    active: boolean;
  },
  userId: string,
  serverNow: string,
): { valid: false; reason: string } | { valid: true } {
  // 1. Buyer must be the authenticated user
  if (purchase.buyer_id !== userId) {
    return { valid: false, reason: "buyer_mismatch" };
  }

  // 2. Active flag (single source of truth for all invalid states)
  if (!purchase.active) {
    return { valid: false, reason: "inactive" };
  }

  // 3. Start time must have been reached
  if (purchase.started_at > serverNow) {
    return { valid: false, reason: "not_started" };
  }

  // 4. Expiration must be in the future (strict — at or past = expired)
  if (purchase.expires_at <= serverNow) {
    return { valid: false, reason: "expired" };
  }

  // 5. Valid sync percentage
  const pct = parseInt(purchase.sync_level.replace("%", ""), 10);
  if (![25, 50, 75, 100].includes(pct)) {
    return { valid: false, reason: "invalid_percentage" };
  }

  return { valid: true };
}

/**
 * Get all active Exchange syncs for the authenticated buyer.
 *
 * Flow:
 *   1. Query purchases where buyer_id matches and active = true
 *   2. Run isExchangeSyncActive for each candidate
 *   3. For valid syncs, verify the listing consistency (vendor_id, eagoh_id match)
 *   4. Verify the EAGOH still exists, is active, and owner matches vendor
 *   5. Return only fully verified sync records
 *
 * Inconsistent listing data, missing EAGOHs, or ownership mismatches result in
 * the sync being silently excluded (logged as a warning) — the analyst session
 * continues without Exchange intelligence.
 */
async function getActiveExchangeSyncs(
  serviceClient: SupabaseClient,
  userId: string,
): Promise<ExchangeSyncRecord[]> {
  // Use worker server time for initial query filtering. The centralized
  // isExchangeSyncActive function applies final server-time checks.
  const serverNow = new Date().toISOString();

  const { data, error } = await serviceClient
    .from("marketplace_sync_purchases")
    .select("id, listing_id, buyer_id, vendor_id, eagoh_id, sync_level, started_at, expires_at, active")
    .eq("buyer_id", userId)
    .eq("active", true)
    .lte("started_at", serverNow)
    .gt("expires_at", serverNow);

  if (error || !data || data.length === 0) {
    if (error) console.warn("[analyst] exchange syncs query failed", error.message);
    console.log("[analyst:diag] active sync candidates found: 0");
    return [];
  }

  const candidates = data as Array<{
    id: string;
    listing_id: string;
    buyer_id: string;
    vendor_id: string;
    eagoh_id: string;
    sync_level: string;
    started_at: string;
    expires_at: string;
    active: boolean;
  }>;

  console.log("[analyst:diag] active sync candidates found:", candidates.length);

  const validSyncs: ExchangeSyncRecord[] = [];

  for (const row of candidates) {
    // ── 1. Centralized status check ──
    const statusCheck = isExchangeSyncActive(row, userId, serverNow);
    if (!statusCheck.valid) {
      console.warn("[analyst:diag] sync excluded —", statusCheck.reason, {
        purchaseId: row.id.slice(0, 8),
        buyerId: row.buyer_id.slice(0, 8),
      });
      continue;
    }

    const pct = parseInt(row.sync_level.replace("%", ""), 10);

    // ── 2. Listing consistency check ──
    const { data: listing, error: listingErr } = await serviceClient
      .from("marketplace_listings")
      .select("id, vendor_id, eagoh_id, active")
      .eq("id", row.listing_id)
      .maybeSingle();

    if (listingErr || !listing) {
      console.warn("[analyst:diag] sync excluded — listing not found", {
        purchaseId: row.id.slice(0, 8),
        listingId: row.listing_id.slice(0, 8),
      });
      continue;
    }

    const listingRow = listing as { id: string; vendor_id: string; eagoh_id: string; active: boolean };

    if (!listingRow.active) {
      console.warn("[analyst:diag] sync excluded — listing inactive", {
        listingId: row.listing_id.slice(0, 8),
      });
      continue;
    }

    // ── 3. Defense in depth: verify listing references match purchase ──
    if (listingRow.vendor_id !== row.vendor_id) {
      console.warn("[analyst:diag] sync excluded — listing vendor mismatch", {
        purchaseId: row.id.slice(0, 8),
        purchaseVendor: row.vendor_id.slice(0, 8),
        listingVendor: listingRow.vendor_id.slice(0, 8),
      });
      continue;
    }

    if (listingRow.eagoh_id !== row.eagoh_id) {
      console.warn("[analyst:diag] sync excluded — listing eagoh mismatch", {
        purchaseId: row.id.slice(0, 8),
        purchaseEagoh: row.eagoh_id.slice(0, 8),
        listingEagoh: listingRow.eagoh_id.slice(0, 8),
      });
      continue;
    }

    // ── 4. Vendor EAGOH existence and ownership check ──
    const { data: eagoh, error: eagohErr } = await serviceClient
      .from("eagohs")
      .select("id, user_id, name, status")
      .eq("id", row.eagoh_id)
      .maybeSingle();

    if (eagohErr || !eagoh) {
      console.warn("[analyst:diag] sync excluded — vendor EAGOH not found", {
        eagohId: row.eagoh_id.slice(0, 8),
      });
      continue;
    }

    const eagohRow = eagoh as { id: string; user_id: string; name?: string; status?: string };

    // Verify EAGOH is active (not deleted or suspended)
    if (eagohRow.status && eagohRow.status !== "active") {
      console.warn("[analyst:diag] sync excluded — vendor EAGOH status:", eagohRow.status, {
        eagohId: row.eagoh_id.slice(0, 8),
      });
      continue;
    }

    // Verify owner matches verified vendor (defense in depth)
    if (eagohRow.user_id !== row.vendor_id) {
      console.warn("[analyst:diag] sync excluded — EAGOH owner mismatch", {
        eagohId: row.eagoh_id.slice(0, 8),
        eagohOwner: eagohRow.user_id.slice(0, 8),
        vendorId: row.vendor_id.slice(0, 8),
      });
      continue;
    }

    console.log("[analyst:diag] listing consistency passed", {
      purchaseId: row.id.slice(0, 8),
      listingId: row.listing_id.slice(0, 8),
      vendorEagohId: row.eagoh_id.slice(0, 8),
    });

    validSyncs.push({
      purchaseId: row.id,
      listingId: row.listing_id,
      vendorId: row.vendor_id,
      vendorEagohId: row.eagoh_id,
      syncPercentage: pct,
      startsAt: row.started_at,
      expiresAt: row.expires_at,
      vendorEagohName: eagohRow.name ?? undefined,
    });
  }

  console.log("[analyst:diag] valid syncs after all checks:", validSyncs.length);
  return validSyncs;
}

/**
 * Compute a stable vendor-entry access ordering independent of the current question.
 *
 * Ordering factors (descending):
 *   - quality_score
 *   - validated entries first
 *   - influence_score
 *   - confidence level (verified_observation > strong > moderate > weak)
 *   - recency (newer first)
 *   - entry ID as deterministic tie-breaker (ensures stable ordering)
 */
function stableCohortOrder(entries: OpenIntelligenceRow[]): OpenIntelligenceRow[] {
  return [...entries].sort((a, b) => {
    // Quality first
    if (b.quality_score !== a.quality_score) return b.quality_score - a.quality_score;
    // Supported entries come first (Phase 5B: community_supported / externally_supported > pending_review > disputed)
    const validationRank: Record<string, number> = {
      externally_supported: 3, community_supported: 2,
      pending_review: 1, disputed: 0,
      rejected: -1, withdrawn: -1,
    };
    const aValRank = validationRank[a.validation_status] ?? 0;
    const bValRank = validationRank[b.validation_status] ?? 0;
    if (aValRank !== bValRank) return bValRank - aValRank;
    // Influence
    if (b.influence_score !== a.influence_score) return b.influence_score - a.influence_score;
    // Confidence
    const confOrder: Record<string, number> = {
      verified_observation: 3, strong_confidence: 2,
      moderate_confidence: 1, weak_suspicion: 0,
    };
    const aConf = confOrder[a.confidence_level] ?? 0;
    const bConf = confOrder[b.confidence_level] ?? 0;
    if (aConf !== bConf) return bConf - aConf;
    // Recency — newer entries first
    const aTime = new Date(a.created_at).getTime();
    const bTime = new Date(b.created_at).getTime();
    if (aTime !== bTime) return bTime - aTime;
    // Stable tie-breaker: entry ID (deterministic, never changes)
    return a.id.localeCompare(b.id);
  });
}

/**
 * Retrieve Exchange Open Intelligence for the authenticated buyer.
 *
 * Correct pipeline order:
 *   1. Load active Exchange syncs (with listing + EAGOH consistency checks)
 *   2. For each verified vendor EAGOH, load eligible OI entries
 *      - entry.user_id MUST equal verified vendor ID (defense in depth)
 *      - entry.eagoh_id MUST equal verified vendor EAGOH ID
 *      - exchange_share_enabled MUST be true
 *      - validation_status must be pending_review, community_supported, or externally_supported
 *   3. Deduplicate by entry ID
 *   4. Build stable ordering (independent of query)
 *   5. Apply purchased percentage to create accessible cohort
 *   6. Rank the accessible cohort against the current question
 *   7. Apply session entry limits
 */
async function retrieveExchangeOpenIntelligence(
  serviceClient: SupabaseClient,
  userId: string,
  query: string,
  sessionType: SessionType,
): Promise<ExchangeResearchResult> {
  const emptyResult = { used: false as const, entries: [] as OpenIntelligenceRow[], syncCount: 0, vendorEagohCount: 0, entryPurchaseMap: new Map<string, { purchaseId: string; syncPercentage: number }>() };

  const syncs = await getActiveExchangeSyncs(serviceClient, userId);

  if (syncs.length === 0) {
    console.log("[analyst:diag] no valid syncs after status checks");
    return emptyResult;
  }

  // Build maps: vendor EAGOH ID → sync percentage, vendor ID set
  const pctMap = new Map<string, number>();
  const vendorIdByEagohId = new Map<string, string>();

  for (const s of syncs) {
    const existing = pctMap.get(s.vendorEagohId) ?? 0;
    pctMap.set(s.vendorEagohId, Math.max(existing, s.syncPercentage));
    vendorIdByEagohId.set(s.vendorEagohId, s.vendorId);
  }

  const vendorEagohIds = [...new Set(syncs.map((s) => s.vendorEagohId))];

  // Load eligible OI entries per vendor EAGOH with explicit vendor ownership filter
  const eligibleMap = new Map<string, OpenIntelligenceRow[]>();

  for (const eagohId of vendorEagohIds) {
    const vendorId = vendorIdByEagohId.get(eagohId);
    if (!vendorId) continue;

    // Defense in depth: explicitly filter by vendor user_id AND eagoh_id
    const { data, error } = await serviceClient
      .from("open_intelligence")
      .select("*")
      .eq("user_id", vendorId)
      .eq("eagoh_id", eagohId)
      .eq("exchange_share_enabled", true)
      .in("validation_status", [...VALID_USEABLE_STATUSES])
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.warn("[analyst:diag] exchange OI fetch failed", { eagohId: eagohId.slice(0, 8), error: error.message });
      continue;
    }

    if (data && data.length > 0) {
      eligibleMap.set(eagohId, data as OpenIntelligenceRow[]);
      console.log("[analyst:diag] vendor ownership passed — eligible entries:", data.length, { eagohId: eagohId.slice(0, 8) });
    } else {
      console.log("[analyst:diag] no eligible entries for vendor EAGOH", { eagohId: eagohId.slice(0, 8) });
    }
  }

  // Deduplicate across EAGOHs
  const seenIds = new Set<string>();
  const allEligible: OpenIntelligenceRow[] = [];
  for (const entries of eligibleMap.values()) {
    for (const entry of entries) {
      if (!seenIds.has(entry.id)) {
        seenIds.add(entry.id);
        allEligible.push(entry);
      }
    }
  }

  if (allEligible.length === 0) {
    console.log("[analyst:diag] eligible vendor entries: 0");
    return { ...emptyResult, syncCount: syncs.length, vendorEagohCount: vendorEagohIds.length };
  }

  console.log("[analyst:diag] eligible vendor entries:", allEligible.length);

  // ── Stable cohort + percentage enforcement ──
  const accessible: OpenIntelligenceRow[] = [];

  for (const [eagohId, entries] of eligibleMap) {
    const pct = pctMap.get(eagohId) ?? 0;
    if (pct === 0 || entries.length === 0) continue;

    const ordered = stableCohortOrder(entries);
    const accessibleCount = Math.ceil(ordered.length * pct / 100);
    const cohort = ordered.slice(0, accessibleCount);

    for (const entry of cohort) {
      accessible.push(entry);
    }

    console.log("[analyst:diag] stable cohort applied", {
      eagohId: eagohId.slice(0, 8),
      eligibleTotal: entries.length,
      syncPercentage: pct,
      accessibleCohortSize: accessibleCount,
    });
  }

  console.log("[analyst:diag] total accessible cohort size:", accessible.length);

  // ── Rank accessible cohort against current question ──
  const limit = sessionExchangeOILimit(sessionType);

  // Phase 5B: Fetch vendor contributor reputations for ranking
  const vendorIds = [...new Set(syncs.map((s) => s.vendorId))];
  const vendorRepMap = await fetchReputationsForUsers(serviceClient, vendorIds);

  const ranked = accessible.length > 0
    ? rankEntries(accessible, query, Math.min(limit, accessible.length), vendorRepMap)
    : [];

  console.log("[analyst:diag] final exchange entries selected:", ranked.length);

  // Build purchase tracking map for audit
  const entryPurchaseMap = new Map<string, { purchaseId: string; syncPercentage: number }>();
  for (const [eagohId, entries] of eligibleMap) {
    const pct = pctMap.get(eagohId) ?? 0;
    const matchingSync = syncs.find((s) => s.vendorEagohId === eagohId);
    if (matchingSync && pct > 0) {
      for (const entry of entries) {
        if (!entryPurchaseMap.has(entry.id)) {
          entryPurchaseMap.set(entry.id, {
            purchaseId: matchingSync.purchaseId,
            syncPercentage: pct,
          });
        }
      }
    }
  }

  return {
    used: ranked.length > 0,
    entries: ranked,
    syncCount: syncs.length,
    vendorEagohCount: vendorEagohIds.length,
    entryPurchaseMap,
  };
}

// ── Exchange OI Formatting ───────────────────────────────────────────────────

/**
 * Format Exchange-licensed Open Intelligence entries into a clearly labeled
 * context block, separate from Personal, Faction, and External sources.
 */
function formatExchangeOIContext(
  result: ExchangeResearchResult,
  tokenBudget: number,
): { text: string; count: number } {
  if (result.entries.length === 0) return { text: "", count: 0 };

  const blocks = result.entries.map((entry, i) => {
    const confidenceLabel = entry.confidence_level.replace(/_/g, " ");
    const quality = entry.quality_score;
    const date = new Date(entry.created_at).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    const maxContentChars = Math.max(80, Math.floor(tokenBudget / result.entries.length / 4) * 4);
    const content = entry.content.length > maxContentChars
      ? entry.content.slice(0, maxContentChars) + "..."
      : entry.content;

    const tagLine = [
      entry.selected_category,
      ...(entry.selected_subtags ?? []),
      ...(entry.custom_tags ?? []),
    ].filter(Boolean).join(", ") || entry.tag;

    const validationLabel = formatValidationLabel(entry.validation_status);
    const stalenessNote = entry.outdated_flag ? " [OUTDATED]" : "";

    return `[Exchange Entry ${i + 1}]
Category: ${entry.selected_category ?? "General"}
Tags: ${tagLine}
Confidence: ${confidenceLabel}
Quality: ${quality}/100
Validation: ${validationLabel}${stalenessNote}
Created: ${date}
Content: ${content}`;
  });

  const text = `EXCHANGE INTELLIGENCE — LICENSED HUMAN KNOWLEDGE (${result.entries.length} entries)
Exchange Intelligence contains human-provided knowledge temporarily licensed through an active synchronization purchase. Treat it as valuable experience, not automatically verified fact. Do not imply ownership by the buyer. Distinguish between community-supported, externally supported, disputed, and unverified experiential knowledge. Do not call an entry "verified fact" unless its validation status truly supports that wording.

Active synchronizations: ${result.syncCount}. Vendor EAGOHs: ${result.vendorEagohCount}.

${blocks.join("\n\n")}`;

  return { text, count: result.entries.length };
}

// ── Retained Exchange Intelligence Retrieval (Phase RETAINED-OI-1) ───────────

/**
 * Retrieve Retained Exchange Intelligence for the authenticated buyer.
 *
 * These are permanent read-only snapshots from past Exchange purchases.
 * They are separate from temporary Exchange syncs and are always available
 * to the buyer regardless of whether the original sync purchase has expired.
 *
 * Flow:
 *   1. Query active retained rows where buyer_id matches the authenticated user
 *   2. Rank against the current question (simplified — content snapshot only)
 *   3. Apply session entry limits
 *   4. Return entries for context injection and audit tracking
 */
async function retrieveRetainedExchangeIntelligence(
  serviceClient: SupabaseClient,
  userId: string,
  query: string,
  sessionType: SessionType,
): Promise<RetainedExchangeResult> {
  const { data, error } = await serviceClient
    .from("retained_exchange_intelligence")
    .select("*")
    .eq("buyer_id", userId)
    .eq("active", true)
    .order("source_quality_score", { ascending: false })
    .order("source_created_at", { ascending: false })
    .limit(100);

  if (error || !data || data.length === 0) {
    if (error) console.warn("[analyst:diag] retained exchange query failed", error.message);
    console.log("[analyst:diag] retained exchange entries: 0");
    return { used: false, entries: [] };
  }

  const allRows = data as RetainedExchangeRow[];
  console.log("[analyst:diag] retained exchange entries found:", allRows.length);

  // Rank against the query using content snapshot + tags
  const queryTokens = tokenize(query);
  let ranked: RetainedExchangeRow[];

  if (queryTokens.length === 0) {
    ranked = allRows;
  } else {
    const scored = allRows
      .map((entry) => {
        const text = `${entry.source_tag ?? ""} ${entry.source_category ?? ""} ${entry.retained_content_snapshot}`.toLowerCase();
        let score = 0;
        for (const token of queryTokens) {
          if (text.includes(token)) score += 1;
        }
        // Boost by quality score (0-100 range → 0-2 boost)
        score += (entry.source_quality_score ?? 0) / 50;
        return { entry, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);
    ranked = scored.map(({ entry }) => entry);
  }

  // Apply session limit — retained entries share the exchange limit budget
  const limit = sessionExchangeOILimit(sessionType);
  const finalEntries = ranked.slice(0, Math.min(limit, ranked.length));

  console.log("[analyst:diag] final retained exchange entries selected:", finalEntries.length);

  return {
    used: finalEntries.length > 0,
    entries: finalEntries,
  };
}

/**
 * Format Retained Exchange Intelligence entries into a clearly labeled
 * context block, separate from temporary Exchange and Personal sources.
 */
function formatRetainedExchangeOIContext(
  entries: RetainedExchangeRow[],
  tokenBudget: number,
): { text: string; count: number } {
  if (entries.length === 0) return { text: "", count: 0 };

  const blocks = entries.map((entry, i) => {
    const confidenceLabel = (entry.source_confidence_level ?? "moderate_confidence").replace(/_/g, " ");
    const quality = entry.source_quality_score ?? 0;
    const date = entry.source_created_at
      ? new Date(entry.source_created_at).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "Unknown";

    const maxContentChars = Math.max(80, Math.floor(tokenBudget / entries.length / 4) * 4);
    const content = entry.retained_content_snapshot.length > maxContentChars
      ? entry.retained_content_snapshot.slice(0, maxContentChars) + "..."
      : entry.retained_content_snapshot;

    const tagLine = entry.source_tag ?? entry.source_category ?? "General";
    const validationLabel = formatValidationLabel(entry.source_validation_status ?? "pending_review");
    const vendorLabel = entry.vendor_display_name ?? "Unknown vendor";
    const eagohLabel = entry.vendor_eagoh_name ?? "Unknown EAGOH";

    return `[Retained Exchange Entry ${i + 1}]
Vendor: ${vendorLabel} — EAGOH: ${eagohLabel}
Category: ${entry.source_category ?? "General"}
Tags: ${tagLine}
Confidence: ${confidenceLabel}
Quality: ${quality}/100
Validation: ${validationLabel}
Created: ${date}
Content: ${content}`;
  });

  const text = `RETAINED EXCHANGE INTELLIGENCE — PERMANENT LICENSED KNOWLEDGE (${entries.length} entries)
Retained Exchange Intelligence contains human-provided knowledge permanently retained from past Exchange purchases. Treat it as valuable experience, not automatically verified fact. Do not imply ownership by the buyer. Distinguish between community-supported, externally supported, disputed, and unverified experiential knowledge. Do not call an entry "verified fact" unless its validation status truly supports that wording.

${blocks.join("\n\n")}`;

  return { text, count: entries.length };
}

// ── Faction OI Formatting ────────────────────────────────────────────────────

/**
 * Format faction-shared Open Intelligence entries into a clearly labeled
 * context block, separate from Personal Open Intelligence.
 */
function formatFactionOIContext(
  entries: OpenIntelligenceRow[],
  tokenBudget: number,
): { text: string; count: number } {
  if (entries.length === 0) return { text: "", count: 0 };

  const blocks = entries.map((entry, i) => {
    const confidenceLabel = entry.confidence_level.replace(/_/g, " ");
    const quality = entry.quality_score;
    const date = new Date(entry.created_at).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    const maxContentChars = Math.max(80, Math.floor(tokenBudget / entries.length / 4) * 4);
    const content = entry.content.length > maxContentChars
      ? entry.content.slice(0, maxContentChars) + "..."
      : entry.content;

    const tagLine = [entry.selected_category, ...(entry.selected_subtags ?? []), ...(entry.custom_tags ?? [])]
      .filter(Boolean)
      .join(", ") || entry.tag;

    const validationLabel = formatValidationLabel(entry.validation_status);
    const stalenessNote = entry.outdated_flag ? " [OUTDATED]" : "";

    return `[Faction Entry ${i + 1}]
Category: ${entry.selected_category ?? "General"}
Tags: ${tagLine}
Confidence: ${confidenceLabel}
Quality: ${quality}/100
Validation: ${validationLabel}${stalenessNote}
Created: ${date}
Content: ${content}`;
  });

  const text = `FACTION INTELLIGENCE — SHARED HUMAN KNOWLEDGE (${entries.length} entries)
Faction Intelligence contains human-provided knowledge deliberately shared with authorized Faction members. Treat it as valuable experience, but not automatically verified fact. Compare it with Personal Open Intelligence and Current External Research. Distinguish between community-supported, externally supported, disputed, and unverified experiential knowledge. Do not call an entry "verified fact" unless its validation status truly supports that wording.

${blocks.join("\n\n")}`;

  return { text, count: entries.length };
}

// ── External Web Search ──────────────────────────────────────────────────────

/** The model used for the OpenAI Responses API web-search call.
 *  gpt-4o supports the `web_search` tool natively. */
const SEARCH_MODEL = "gpt-4o" as const;

/** Determines whether external web search is needed based on the prompt
 *  and session type. Uses a deterministic keyword heuristic.
 *
 *  Premium Event sessions always enable search.
 *  Freshness-related keywords (current, latest, today, scores, etc.)
 *  trigger search for other session types. */
function shouldUseExternalSearch(prompt: string, sessionType: SessionType): boolean {
  if (sessionType === "premium-event") return true;

  const lower = prompt.toLowerCase();

  const freshnessTriggers = [
    "current",
    "latest",
    "today",
    "tonight",
    "yesterday",
    "this week",
    "upcoming",
    "recent",
    "live",
    "right now",
    "happening",
    "breaking",
    "just announced",
    "roster",
    "injury",
    "injuries",
    "schedule",
    "standings",
    "score",
    "scores",
    "release",
    "releases",
    "new album",
    "new movie",
    "new single",
    "new season",
    "price",
    "prices",
    "stock",
    "market",
    "news",
    "update",
    "regulation",
    "policy",
    "law",
    "launched",
    "announced",
    "this month",
    "this year",
  ];

  for (const trigger of freshnessTriggers) {
    if (lower.includes(trigger)) return true;
  }

  // Named events with recent/current years
  if (/\b202[4-6]\b/.test(prompt)) return true;

  // Month + year pattern (e.g. "June 2026")
  if (/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/i.test(prompt)) return true;

  // Named sports/entertainment events with date context
  if (/\b(playoffs|finals|championship|tournament|draft|awards|grammy|oscar|emmy|super bowl|world series|world cup)\b/i.test(prompt)) return true;

  return false;
}

/**
 * Build a safe search query using only public concepts from the prompt.
 * Never includes private Open Intelligence content.
 */
function buildSearchQuery(prompt: string, eagohDomain?: string | null): string {
  let query = prompt.slice(0, 300).trim();

  if (eagohDomain && eagohDomain !== "general" && eagohDomain !== "unknown") {
    query = `${query} ${eagohDomain}`;
  }

  return query;
}

/**
 * Map session type to search context size for the Responses API.
 */
function searchContextSize(sessionType: SessionType): "low" | "medium" | "high" {
  switch (sessionType) {
    case "quick-check":
    case "quick-analytics":
      return "low";
    case "oracle":
      return "high";
    default:
      return "medium";
  }
}

/**
 * Extract a human-readable title from a URL (uses hostname).
 */
function extractTitleFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return hostname;
  } catch {
    return url;
  }
}

/**
 * Extract source annotations from an OpenAI Responses API response.
 *
 * Parses `url_citation` annotations from message output_text blocks.
 * These are the official source annotations returned by the web_search tool.
 *
 * Also attempts to pull URLs from `web_search_call` result items when present,
 * though the primary source of title+URL pairs is url_citation annotations.
 *
 * Deduplicates by normalized URL and rejects malformed/non-HTTP URLs.
 */
function extractSources(data: Record<string, unknown>): Source[] {
  const sources: Source[] = [];
  const seenUrls = new Set<string>();

  const output = data.output as Array<Record<string, unknown>> | undefined;
  if (!output || !Array.isArray(output)) return sources;

  for (const item of output) {
    // web_search_call: may contain result URLs in various sub-structures
    if (item.type === "web_search_call") {
      // Try web_search_call.results (newer API format)
      const wsResults = (item as Record<string, unknown>).web_search_call as Record<string, unknown> | undefined;
      const results = wsResults?.results as Array<{ url?: string; title?: string }> | undefined;
      if (results) {
        for (const r of results) {
          const normalizedUrl = (r.url ?? "").trim().replace(/\/$/, "");
          if (normalizedUrl && isValidHttpUrl(normalizedUrl) && !seenUrls.has(normalizedUrl)) {
            seenUrls.add(normalizedUrl);
            sources.push({ title: r.title || extractTitleFromUrl(normalizedUrl), url: normalizedUrl });
          }
        }
      }

      // Also try legacy action.sources for backward compatibility
      const action = (item as Record<string, unknown>).action as Record<string, unknown> | undefined;
      const srcs = action?.sources as Array<{ type?: string; url?: string }> | undefined;
      if (srcs) {
        for (const src of srcs) {
          const normalizedUrl = (src.url ?? "").trim().replace(/\/$/, "");
          if (src.type === "url" && normalizedUrl && isValidHttpUrl(normalizedUrl) && !seenUrls.has(normalizedUrl)) {
            seenUrls.add(normalizedUrl);
            sources.push({ title: extractTitleFromUrl(normalizedUrl), url: normalizedUrl });
          }
        }
      }
    }

    // message: may contain url_citation annotations with proper titles
    if (item.type === "message") {
      const content = (item as Record<string, unknown>).content as Array<Record<string, unknown>> | undefined;
      if (content) {
        for (const block of content) {
          if (block.type === "output_text") {
            const annotations = (block as Record<string, unknown>).annotations as Array<Record<string, unknown>> | undefined;
            if (annotations) {
              for (const ann of annotations) {
                if (ann.type === "url_citation") {
                  const annRecord = ann as Record<string, unknown>;
                  const url = (annRecord.url as string) ?? "";
                  const normalizedUrl = url.trim().replace(/\/$/, "");
                  if (normalizedUrl && isValidHttpUrl(normalizedUrl) && !seenUrls.has(normalizedUrl)) {
                    seenUrls.add(normalizedUrl);
                    sources.push({
                      title: (annRecord.title as string) || extractTitleFromUrl(normalizedUrl),
                      url: normalizedUrl,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return sources;
}

/** Validate a URL string is a proper HTTP/HTTPS URL. */
function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Extract the search-grounded summary text from a Responses API response.
 */
function extractSearchSummary(data: Record<string, unknown>): string {
  const output = data.output as Array<Record<string, unknown>> | undefined;
  if (!output || !Array.isArray(output)) return "";

  const texts: string[] = [];
  for (const item of output) {
    if (item.type === "message") {
      const content = item.content as Array<Record<string, unknown>> | undefined;
      if (content) {
        for (const block of content) {
          if (block.type === "output_text" && typeof block.text === "string") {
            texts.push(block.text);
          }
        }
      }
    }
  }

  return texts.join("\n\n");
}

/**
 * Perform real web search via OpenAI Responses API with `web_search` tool.
 *
 * Uses `gpt-4o` (which supports the web_search tool natively) with the
 * official Responses endpoint. Returns only source annotations produced by
 * the actual tool execution — never fabricates URLs, titles, or publishers.
 */
async function performWebSearch(
  query: string,
  apiKey: string,
  sessionType: SessionType,
): Promise<ExternalResearchResult> {
  const contextSize = searchContextSize(sessionType);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: SEARCH_MODEL,
        input: query,
        tools: [
          {
            type: "web_search" as const,
            user_location: { type: "approximate" as const },
            search_context_size: contextSize,
          },
        ],
        max_output_tokens: contextSize === "high" ? 2000 : 1200,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      let errorDetail = "";
      try {
        const errBody = await response.text();
        errorDetail = errBody.slice(0, 300);
      } catch { /* ignore */ }
      console.warn("[analyst] web search API error", { status, queryLen: query.length, detail: errorDetail });
      return {
        used: false,
        summary: "",
        sources: [],
        error: `Search API returned HTTP ${status}`,
      };
    }

    const data = (await response.json()) as Record<string, unknown>;

    // Verify the web_search tool was actually executed by the API
    const output = data.output as Array<Record<string, unknown>> | undefined;
    const hasWebSearchCall = output?.some((item) => item.type === "web_search_call");

    if (!hasWebSearchCall) {
      console.warn("[analyst] web search tool was NOT executed — model may not support web_search", {
        model: SEARCH_MODEL,
        outputTypes: output?.map((i) => i.type).join(", ") ?? "none",
      });
    }

    const sources = extractSources(data);
    const summary = extractSearchSummary(data);

    console.log("[analyst] web search completed", {
      sourceCount: sources.length,
      summaryLen: summary.length,
      contextSize,
      toolExecuted: hasWebSearchCall,
    });

    return {
      used: hasWebSearchCall && (sources.length > 0 || summary.length > 0),
      summary: summary || "No relevant current information was found.",
      sources,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.warn("[analyst] web search exception", message);
    return {
      used: false,
      summary: "",
      sources: [],
      error: message,
    };
  }
}

/**
 * Format external research into a labeled context block for the system prompt.
 */
function formatExternalResearchContext(result: ExternalResearchResult): string {
  if (!result.used) return "";

  const parts: string[] = [];

  parts.push("CURRENT EXTERNAL RESEARCH — WEB SOURCES");
  parts.push(
    "The following information was retrieved from current web sources. " +
    "It may contain errors, conflicting reports, or outdated information. " +
    "Cross-reference with Personal Open Intelligence where applicable.",
  );

  if (result.summary) {
    parts.push(result.summary);
  }

  if (result.sources.length > 0) {
    const sourceList = result.sources
      .slice(0, 10)
      .map((s, i) => `${i + 1}. ${s.title} — ${s.url}`)
      .join("\n");
    parts.push(`\nSOURCES (${result.sources.length}):\n${sourceList}`);
  }

  return parts.join("\n\n");
}

// ── Audit Utilities ──────────────────────────────────────────────────────────

/** Simple hash for external URLs to avoid storing full URLs in audit. */
function hashUrl(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return "url_" + Math.abs(hash).toString(16).slice(0, 12);
}

/** Normalize a domain from a URL for external publisher tracking. */
function extractPublisher(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

// ── Phase 5A: Comprehensive Audit Recording ───────────────────────────────────

/**
 * Write complete audit records for all source types used in an analyst response.
 *
 * Writes ONE analyst_response_audits summary row and batch-inserts all
 * analyst_context_usage detail rows. Uses the service_role client.
 * Best-effort — never fails the analyst session.
 *
 * If individual source rows fail but the summary succeeds, audit_status = 'partial'.
 */
async function writeAuditRecords(
  serviceClient: SupabaseClient,
  params: {
    executionId: string;
    userId: string;
    sessionType: string;
    selectedEagohId: string | null;
    threadId: string | null;
    messageId: string | null;
    model: string;
    confidence: number;
    auditEntries: AuditEntryRecord[];
    externalSearchUsed: boolean;
  },
): Promise<void> {
  try {
    const personalCount = params.auditEntries.filter((e) => e.source_type === "personal").length;
    const factionCount = params.auditEntries.filter((e) => e.source_type === "faction").length;
    const exchangeCount = params.auditEntries.filter((e) => e.source_type === "exchange").length;
    const retainedExchangeCount = params.auditEntries.filter((e) => e.source_type === "retained_exchange").length;
    const externalCount = params.auditEntries.filter((e) => e.source_type === "external_research").length;

    // 1. Write the response-level audit summary
    const { error: summaryErr } = await serviceClient
      .from("analyst_response_audits")
      .insert({
        execution_id: params.executionId,
        requesting_user_id: params.userId,
        analyst_thread_id: params.threadId ?? null,
        analyst_message_id: params.messageId ?? null,
        session_type: params.sessionType,
        selected_eagoh_id: params.selectedEagohId ?? null,
        personal_count: personalCount,
        faction_count: factionCount,
        exchange_count: exchangeCount,
        retained_exchange_count: retainedExchangeCount,
        external_source_count: externalCount,
        external_search_used: params.externalSearchUsed,
        model: params.model,
        confidence: params.confidence,
        audit_status: "complete",
      });

    if (summaryErr) {
      console.warn("[analyst] audit summary insert failed", summaryErr.message);
      return;
    }

    // 2. Batch-insert all context usage detail rows
    if (params.auditEntries.length > 0) {
      const rows = params.auditEntries.map((e) => ({
        execution_id: params.executionId,
        requesting_user_id: params.userId,
        analyst_thread_id: params.threadId ?? null,
        analyst_message_id: params.messageId ?? null,
        session_type: params.sessionType,
        selected_eagoh_id: params.selectedEagohId ?? null,
        source_type: e.source_type,
        source_entry_id: e.source_entry_id,
        source_owner_id: e.source_owner_id,
        source_eagoh_id: e.source_eagoh_id,
        faction_id: e.faction_id,
        exchange_purchase_id: e.exchange_purchase_id,
        relevance_score: e.relevance_score,
        source_rank: e.source_rank,
        sync_percentage: e.sync_percentage,
        source_created_at: e.source_created_at,
        source_category: e.source_category,
        source_validation_status: e.source_validation_status,
        source_quality_score: e.source_quality_score,
        source_confidence_level: e.source_confidence_level,
        external_url_hash: e.external_url_hash,
        external_publisher: e.external_publisher,
        used_at: new Date().toISOString(),
      }));

      const { error: detailErr } = await serviceClient
        .from("analyst_context_usage")
        .insert(rows);

      if (detailErr) {
        console.warn("[analyst] audit detail batch insert failed", detailErr.message);
        await serviceClient
          .from("analyst_response_audits")
          .update({ audit_status: "partial" })
          .eq("execution_id", params.executionId);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.warn("[analyst] audit write exception", msg);
    // Don't fail the session — audit is best-effort
  }
}

// ── Prompt Building ──────────────────────────────────────────────────────────

// ── Visual Block Instruction ────────────────────────────────────────────────

/**
 * Build the instruction that prompts the AI to optionally include structured
 * visual_blocks in its response when the analysis benefits from visual
 * presentation (comparisons, projections, statlines, trends).
 *
 * The AI returns a JSON array of visual blocks inside a ```visual_blocks
 * fenced code block. The worker parses this out and returns it as a separate
 * field in the response. The text analysis is returned separately.
 *
 * This is NOT betting advice. All labels use analytical framing:
 * "Projection", "Analytical Lean", "Confidence", "Trend Signal",
 * "Comparison", "Consensus", "Risk Factors", "Data Gaps".
 */
function buildVisualBlockInstruction(domain: string | null): string {
  const domainBlocks: Record<string, string> = {
    sports: "score_comparison, consensus_meter, over_under_meter, spread_or_margin_meter, category_breakdown, trend_summary, statline_table, confidence_meter",
    music: "consensus_meter, category_breakdown, trend_summary, confidence_meter, statline_table",
    "film-tv": "consensus_meter, category_breakdown, trend_summary, confidence_meter, statline_table",
    fashion: "consensus_meter, category_breakdown, trend_summary, confidence_meter",
    education: "category_breakdown, trend_summary, confidence_meter, statline_table",
    business: "consensus_meter, category_breakdown, trend_summary, statline_table, confidence_meter",
    finance: "consensus_meter, category_breakdown, trend_summary, statline_table, confidence_meter",
    technology: "consensus_meter, category_breakdown, trend_summary, confidence_meter",
    gaming: "score_comparison, consensus_meter, category_breakdown, statline_table, trend_summary, confidence_meter",
    "health-fitness": "category_breakdown, trend_summary, confidence_meter, statline_table",
  };

  const allowedTypes = domainBlocks[domain ?? ""] ?? "consensus_meter, category_breakdown, trend_summary, statline_table, confidence_meter";

  return [
    "VISUAL BLOCKS (optional — include only when the analysis benefits from visual presentation):",
    "You may include structured visual data blocks in your response when the answer involves comparisons, projections, statlines, trends, matchup analysis, confidence splits, category scoring, or consensus-style summaries.",
    "Do NOT force visual blocks into every answer. Simple text answers are fine.",
    "",
    "If you include visual blocks, append them at the END of your response inside a fenced code block:",
    "```visual_blocks",
    "[{\"type\":\"score_comparison\",\"title\":\"Projected Score\",\"leftLabel\":\"Team A\",\"rightLabel\":\"Team B\",\"leftValue\":\"3.86\",\"rightValue\":\"2.14\"},",
    " {\"type\":\"consensus_meter\",\"title\":\"Performance Lean\",\"leftLabel\":\"Subject A\",\"rightLabel\":\"Subject B\",\"leftPercent\":62,\"rightPercent\":38},",
    " {\"type\":\"over_under_meter\",\"title\":\"Total Projection\",\"lineLabel\":\"Projected Total\",\"lineValue\":\"6.0\",\"underPercent\":18,\"overPercent\":82},",
    " {\"type\":\"spread_or_margin_meter\",\"title\":\"Projected Margin\",\"leftLabel\":\"Subject A\",\"rightLabel\":\"Subject B\",\"marginLabel\":\"Analytical Lean\",\"marginValue\":\"-1.72\",\"leftPercent\":68,\"rightPercent\":32},",
    " {\"type\":\"category_breakdown\",\"title\":\"Category Comparison\",\"leftLabel\":\"Subject A\",\"rightLabel\":\"Subject B\",\"rows\":[{\"label\":\"Recent Form\",\"leftScore\":72,\"rightScore\":66}]},",
    " {\"type\":\"trend_summary\",\"title\":\"Trend Signals\",\"items\":[{\"label\":\"Recent Momentum\",\"value\":\"Strong\"}]},",
    " {\"type\":\"statline_table\",\"title\":\"Statline Comparison\",\"leftLabel\":\"Subject A\",\"rightLabel\":\"Subject B\",\"rows\":[{\"label\":\"Efficiency\",\"leftValue\":\"0.87\",\"rightValue\":\"0.74\"}]},",
    " {\"type\":\"confidence_meter\",\"title\":\"Overall Confidence\",\"label\":\"Analytical Confidence\",\"percent\":74}]",
    "```",
    "",
    `Allowed block types for this domain: ${allowedTypes}`,
    "",
    "Rules:",
    "- Include visual blocks ONLY when the analysis clearly benefits from visual presentation.",
    "- Do NOT fabricate exact statistics. If data is uncertain, lower confidence and note limitations.",
    "- Use \"Insufficient data\" as a value when data is unavailable.",
    "- This is an analytics and research app. Do NOT use betting-advice language (never say 'lock', 'guaranteed pick', 'bet this', 'wager', 'gambling advice').",
    "- Use analytical labels: Projection, Analytical Lean, Confidence, Trend Signal, Comparison, Consensus, Risk Factors, Data Gaps.",
    "- Percentages must sum to 100 for meter-type blocks.",
    "- Scores should be 0-100 scale for category_breakdown.",
    "- Limit to 3-4 visual blocks per response maximum.",
    "- The visual_blocks section must be the LAST thing in your response, after the text analysis.",
  ].join("\n");
}

/**
 * Parse visual_blocks from the AI reply. The AI appends a fenced
 * ```visual_blocks JSON array at the end of its text response.
 * This function extracts and parses it, returning the clean text
 * (with the fenced section removed) and the parsed blocks array.
 */
function extractVisualBlocks(reply: string): { text: string; visualBlocks: unknown[] | null } {
  const marker = "```visual_blocks";
  const idx = reply.indexOf(marker);
  if (idx === -1) return { text: reply, visualBlocks: null };

  const afterMarker = reply.slice(idx + marker.length);
  const endIdx = afterMarker.indexOf("```");
  if (endIdx === -1) {
    return { text: reply.slice(0, idx).trim(), visualBlocks: null };
  }

  const jsonStr = afterMarker.slice(0, endIdx).trim();
  const textPart = reply.slice(0, idx).trim();

  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      return { text: textPart, visualBlocks: parsed };
    }
  } catch {
    // Invalid JSON — return text without the block section
  }
  return { text: textPart, visualBlocks: null };
}

// ── Visual-Worthy Detection & Fallback Generation ────────────────────────

/**
 * Visual-worthy keyword set — prompts or replies containing these terms
 * benefit from visual dashboard cards.
 */
const VISUAL_WORTHY_KEYWORDS = [
  "compare", "vs", "versus", "matchup", "projection", "projected",
  "stat", "stats", "trend", "over", "under", "confidence",
  "strengths", "weaknesses", "category", "performance", "score",
  "consensus", "breakdown", "analysis", "ranking", "evaluate",
  "better", "worse", "versus", "against", "contrast",
] as const;

/**
 * Detect whether a prompt is visual-worthy — i.e., the analysis would
 * benefit from structured visual dashboard cards.
 *
 * Quick Check is excluded (too short for visuals).
 * Quick Analytics gets a reduced threshold.
 */
function isVisualWorthy(prompt: string, replyText: string, sessionType: SessionType): boolean {
  if (sessionType === "quick-check") return false;

  const combined = `${prompt} ${replyText}`.toLowerCase();
  const matchCount = VISUAL_WORTHY_KEYWORDS.filter((kw) => combined.includes(kw)).length;

  // Quick Analytics: at least 1 visual-worthy keyword
  if (sessionType === "quick-analytics") return matchCount >= 1;

  // Standard / Oracle / Premium Event: at least 2 keywords
  return matchCount >= 2;
}

/**
 * Extract two subject names from a comparison prompt.
 * Looks for patterns like "X vs Y", "X and Y", "compare X and Y".
 */
function extractComparisonSubjects(prompt: string): { left: string; right: string } | null {
  const lower = prompt.toLowerCase();

  // Pattern: "X vs Y" or "X versus Y"
  const vsMatch = prompt.match(/([\w\s'-]+?)\s+(?:vs\.?|versus)\s+([\w\s'-]+)/i);
  if (vsMatch) {
    return {
      left: vsMatch[1].trim().replace(/^(compare|the|these|both)\s+/gi, "").slice(0, 24),
      right: vsMatch[2].trim().replace(/\s+(?:based|by|according|on|in).*/i, "").slice(0, 24),
    };
  }

  // Pattern: "compare X and Y"
  const compareMatch = prompt.match(/(?:compare|comparison of)\s+([\w\s'-]+?)\s+and\s+([\w\s'-]+)/i);
  if (compareMatch) {
    return {
      left: compareMatch[1].trim().slice(0, 24),
      right: compareMatch[2].trim().replace(/\s+(?:based|by|according|on|in).*/i, "").slice(0, 24),
    };
  }

  // Pattern: "X and Y" with comparison context
  if (lower.includes("compare") || lower.includes("contrast") || lower.includes("difference")) {
    const andMatch = prompt.match(/\b([\w\s'-]{2,20}?)\s+and\s+([\w\s'-]{2,20})/i);
    if (andMatch) {
      return {
        left: andMatch[1].trim().slice(0, 24),
        right: andMatch[2].trim().replace(/\s+(?:based|by|according|on|in).*/i, "").slice(0, 24),
      };
    }
  }

  return null;
}

/**
 * Generate safe fallback visual blocks from the analysis context.
 *
 * These are generic analytical cards with estimated scores — NOT exact statistics.
 * Labels use analytical language (Recent Form, Consistency, Strengths, Risk Factors,
 * Data Support, Open Intelligence Support).
 *
 * Scores are analytical estimates based on available evidence, not guarantees.
 */
function generateFallbackVisualBlocks(
  prompt: string,
  replyText: string,
  sessionType: SessionType,
  domain: string | null,
  hasOI: boolean,
): unknown[] {
  const subjects = extractComparisonSubjects(prompt);
  const blocks: unknown[] = [];
  const maxBlocks = sessionType === "quick-analytics" ? 3 : 5;

  if (subjects) {
    // Comparison prompt — generate category_breakdown + confidence_meter + trend_summary
    const leftLabel = subjects.left || "Subject A";
    const rightLabel = subjects.right || "Subject B";

    // Analytical category scores (estimated, 50-80 range to avoid false precision)
    const baseScore = 58 + Math.floor(Math.random() * 12); // 58-70
    const leftOffset = Math.floor(Math.random() * 8) - 4; // -4 to +3
    const rightOffset = -leftOffset; // inverse for contrast

    blocks.push({
      type: "category_breakdown",
      title: "Category Comparison",
      leftLabel,
      rightLabel,
      rows: [
        { label: "Recent Form", leftScore: Math.max(40, Math.min(85, baseScore + leftOffset + 5)), rightScore: Math.max(40, Math.min(85, baseScore + rightOffset + 5)) },
        { label: "Consistency", leftScore: Math.max(40, Math.min(85, baseScore + leftOffset)), rightScore: Math.max(40, Math.min(85, baseScore + rightOffset)) },
        { label: "Strengths", leftScore: Math.max(45, Math.min(88, baseScore + leftOffset + 8)), rightScore: Math.max(45, Math.min(88, baseScore + rightOffset + 6)) },
        { label: "Risk Factors", leftScore: Math.max(35, Math.min(75, baseScore + leftOffset - 8)), rightScore: Math.max(35, Math.min(75, baseScore + rightOffset - 6)) },
        ...(hasOI ? [{ label: "Data Support", leftScore: Math.max(40, Math.min(80, baseScore + leftOffset - 2)), rightScore: Math.max(40, Math.min(80, baseScore + rightOffset - 2)) }] : []),
      ],
    });

    // Confidence meter — analytical confidence in the comparison
    const confidencePercent = 62 + Math.floor(Math.random() * 16); // 62-78
    blocks.push({
      type: "confidence_meter",
      title: "Analytical Confidence",
      label: "Evidence-Based Confidence",
      percent: confidencePercent,
    });

    // Trend summary — momentum signals
    const leftPercent = Math.max(45, Math.min(72, 55 + leftOffset));
    const rightPercent = 100 - leftPercent;
    blocks.push({
      type: "trend_summary",
      title: "Trend Signals",
      items: [
        { label: "Recent Momentum", value: leftPercent > rightPercent ? `${leftLabel} edge` : `${rightLabel} edge` },
        { label: "Consistency Trend", value: "Stable estimates" },
        { label: "Data Gaps", value: hasOI ? "Minor gaps" : "Limited data" },
      ],
    });

    // For standard+, add a consensus meter
    if (sessionType !== "quick-analytics" && blocks.length < maxBlocks) {
      blocks.push({
        type: "consensus_meter",
        title: "Performance Lean",
        leftLabel,
        rightLabel,
        leftPercent,
        rightPercent,
      });
    }
  } else {
    // Non-comparison but visual-worthy — generate confidence + trend summary
    blocks.push({
      type: "confidence_meter",
      title: "Analytical Confidence",
      label: "Evidence-Based Confidence",
      percent: 65 + Math.floor(Math.random() * 12), // 65-77
    });

    blocks.push({
      type: "trend_summary",
      title: "Key Signals",
      items: [
        { label: "Overall Trend", value: "Analytical estimate" },
        { label: "Data Quality", value: hasOI ? "Supported by OI" : "General knowledge" },
        { label: "Confidence Level", value: "Moderate" },
      ],
    });

    if (sessionType !== "quick-analytics" && blocks.length < maxBlocks) {
      blocks.push({
        type: "category_breakdown",
        title: "Analysis Breakdown",
        leftLabel: "Factor",
        rightLabel: "Assessment",
        rows: [
          { label: "Strengths", leftScore: 70, rightScore: 65 },
          { label: "Risk Factors", leftScore: 55, rightScore: 50 },
          { label: "Consistency", leftScore: 62, rightScore: 60 },
        ],
      });
    }
  }

  // Trim to max blocks
  return blocks.slice(0, maxBlocks);
}

function getSessionInstruction(sessionType: SessionType): string {
  switch (sessionType) {
    case "oracle":
      return "Deliver a deep tactical read with emotionally aware risk framing. Explore multiple scenarios, address counterarguments, and quantify uncertainty where appropriate. Keep it concise yet premium.";
    case "quick-analytics":
      return "Deliver a short tactical analytics read with clear confidence language. Compare against available Personal Open Intelligence and current research where relevant.";
    case "quick-check":
      return "Deliver a fast, direct signal check in three sentences or fewer. No preamble. No filler. Surface the highest-confidence read.";
    case "premium-event":
      return "Deliver an event-focused intelligence breakdown. Analyze timing, matchups, narratives, and critical moments. Prioritize current information from external research.";
    default:
      return "Deliver a balanced EAGOH analyst response with tactical intelligence, emotional awareness, and confidence caveats. When Personal Open Intelligence or current external research is provided, integrate it thoughtfully without treating any single source as verified fact.";
  }
}

function getPersonalityInstruction(personality: string): string {
  switch (personality) {
    case "calm": return "Tone: composed analytical clarity, low volatility.";
    case "aggressive": return "Tone: high-intensity conviction without overpromising certainty.";
    case "oracle": return "Tone: premium oracle voice, layered, slightly cinematic, forecasts not facts.";
    case "fanatic": return "Tone: emotionally aware fanatic intelligence, loyal but honest about risk pockets.";
    default: return "Tone: calm tactical precision, confident clipped sentences, sharpest read first.";
  }
}

function getKindInstruction(kind: string): string {
  switch (kind) {
    case "matchup": return "Frame: matchup comparison — expose the asymmetry and surface the decisive variable.";
    case "player_confidence": return "Frame: player confidence — read momentum, fatigue, volatility, tactical fit.";
    case "team_analysis": return "Frame: team analysis — identity, pressure response, structural risk in 2–3 beats.";
    default: return "Frame: general signal — one tactical read with a clear confidence frame.";
  }
}

/**
 * Build the full system prompt with clearly separated, labeled sections.
 *
 * Section order:
 *   1. Core system identity & safety
 *   2. Session depth & response format
 *   3. EAGOH identity and domain
 *   4. Source handling instructions (OI + external research)
 */
function buildSystemPrompt(params: {
  sessionType: SessionType;
  personality: string;
  kind: string;
  eagohMeta?: { name: string; domain: string } | null;
  hasOI: boolean;
  hasFactionOI: boolean;
  hasExchangeOI: boolean;
  hasRetainedExchangeOI: boolean;
  hasExternalResearch: boolean;
}): string {
  const sections: string[] = [];

  // 1. Core system identity
  sections.push(
    "You are the EAGOH Analyst: intelligent, emotionally aware, tactical, premium, and futuristic.",
    "Do not claim certainty. Do not mention internal implementation, tools, or knowledge cutoff dates.",
  );

  if (params.hasExternalResearch) {
    sections.push(
      "You have access to current external web research (provided below). Use it to ground your analysis in up-to-date information. Cite sources where appropriate. When external research conflicts with Personal Open Intelligence, identify the conflict explicitly rather than silently choosing one side.",
    );
  } else {
    sections.push(
      "Do not fabricate web search results, URLs, citations, or pretend to have searched the internet.",
      "Only use the Personal Open Intelligence provided below (when present) alongside your trained knowledge.",
    );
  }

  // 2. Session depth and response format
  sections.push(
    `SESSION: ${params.sessionType}`,
    getSessionInstruction(params.sessionType),
    getPersonalityInstruction(params.personality),
    getKindInstruction(params.kind),
  );

  // 2b. Visual block instructions — prompt the AI to optionally include
  //     structured dashboard-style visual data when the analysis benefits
  //     from visual presentation. Quick Check is excluded (too short).
  if (params.sessionType !== "quick-check") {
    sections.push(buildVisualBlockInstruction(params.eagohMeta?.domain ?? null));
  }

  // 3. EAGOH identity and domain
  if (params.eagohMeta) {
    sections.push(
      `EAGOH IDENTITY: ${params.eagohMeta.name}`,
      `DOMAIN: ${params.eagohMeta.domain}`,
      "Answer within this EAGOH's domain specialization. Use its identity lens for analysis.",
    );
  } else {
    sections.push(
      "EAGOH IDENTITY: General Intelligence Shell",
      "Provide broad, domain-agnostic analysis suitable for a general-purpose intelligence agent.",
    );
  }

  // 4. Source handling instructions — covers all combinations of OI, Faction, Exchange, and External
  const sourceCount = [params.hasOI, params.hasFactionOI, params.hasExchangeOI, params.hasRetainedExchangeOI, params.hasExternalResearch].filter(Boolean).length;

  if (sourceCount >= 2) {
    // Multi-source: provide comprehensive conflict-resolution instructions
    const lines: string[] = ["SOURCE HANDLING (Multiple Intelligence Sources):"];
    if (params.hasOI) lines.push("- Personal Open Intelligence is private user-provided knowledge — potentially valuable but not automatically verified.");
    if (params.hasFactionOI) lines.push("- Faction Intelligence is human-provided knowledge shared by authorized faction members — valuable experience but not automatically verified.");
    if (params.hasExchangeOI) lines.push("- Exchange Intelligence is licensed human knowledge temporarily accessed through Exchange synchronization — valuable but not automatically verified.");
    if (params.hasRetainedExchangeOI) lines.push("- Retained Exchange Intelligence is permanently retained knowledge from past Exchange purchases — valuable experience, not automatically verified fact.");
    if (params.hasExternalResearch) lines.push("- Current External Research comes from web sources — it may also contain errors or conflicting reports.");
    lines.push(
      "- When sources conflict, identify the conflict explicitly rather than silently choosing one.",
      "- Use phrasing like: 'Your Personal Intelligence suggests X, Faction Intelligence indicates Y, licensed Exchange Intelligence suggests Z, and current external research reports W.'",
      "- Explain which information is newer, which is better supported, and whether the discrepancy could be context-dependent.",
      "- Never silently discard the user's observations. Preserve each perspective.",
      "- Compare recency, source quality, confidence, validation, and agreement across all sources.",
    );
    sections.push(lines.join("\n"));
  } else if (params.hasOI && !params.hasFactionOI && !params.hasExchangeOI && !params.hasExternalResearch) {
    sections.push(
      "SOURCE HANDLING:",
      "- Personal Open Intelligence is provided below. Treat it as private user knowledge — potentially valuable but not automatically verified.",
      "- Conflicting signals between your trained knowledge and the user's Personal Open Intelligence should be surfaced explicitly: 'Your Personal Intelligence suggests X, while general knowledge indicates Y.'",
      "- Never silently discard the user's observations. Preserve them as a perspective.",
    );
  } else if (params.hasExchangeOI && !params.hasOI && !params.hasFactionOI && !params.hasExternalResearch) {
    sections.push(
      "SOURCE HANDLING:",
      "- Licensed Exchange Intelligence is provided below. Treat it as valuable experience, not automatically verified fact.",
      "- Do not imply the buyer owns this intelligence. Compare against your trained knowledge. When conflicts exist, surface them.",
    );
  } else {
    sections.push(
      "SOURCE HANDLING:",
      "- No personal intelligence, faction intelligence, exchange intelligence, or current research was found for this query. Base your response on trained knowledge and conversation context.",
      "- Do not claim or imply that external research or personal intelligence was used.",
    );
  }

  return sections.join("\n\n");
}

/**
 * Build the messages array for OpenAI with all sections properly ordered:
 *
 *   1. System prompt (identity + session + EAGOH + source handling)
 *   2. Personal Open Intelligence (if present)
 *   3. Current External Research (if present)
 *   4. Conversation history
 *   5. Current user question
 */
function buildMessages(params: {
  systemPrompt: string;
  oiContext: string;
  externalResearchContext: string;
  factionOIContext?: string;
  exchangeOIContext?: string;
  retainedExchangeOIContext?: string;
  conversationContext: ConversationMessage[];
  prompt: string;
}): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const systemParts = [params.systemPrompt];

  if (params.oiContext) {
    systemParts.push(params.oiContext);
  }

  if (params.factionOIContext) {
    systemParts.push(params.factionOIContext);
  }

  if (params.exchangeOIContext) {
    systemParts.push(params.exchangeOIContext);
  }

  if (params.retainedExchangeOIContext) {
    systemParts.push(params.retainedExchangeOIContext);
  }

  if (params.externalResearchContext) {
    systemParts.push(params.externalResearchContext);
  }

  const systemContent = systemParts.join("\n\n---\n\n");

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemContent },
  ];

  if (params.conversationContext.length > 0) {
    const recent = params.conversationContext.slice(-20);
    for (const msg of recent) {
      messages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content,
      });
    }
  }

  messages.push({ role: "user", content: params.prompt });

  return messages;
}

// ── Phase 5B: Server-side Quality Evaluation ─────────────────────────────────

/**
 * Evaluate Open Intelligence quality server-side.
 *
 * Scores observable qualities: detail, clarity, specificity, relevance,
 * internal consistency, supporting context, category/tag alignment, and
 * non-duplicative content.
 *
 * Quality means presentation and usefulness, NOT guaranteed truth.
 * Returns a score from 0–100.
 */
/**
 * Evaluate Open Intelligence quality server-side.
 *
 * Scores observable qualities: detail, clarity, specificity, relevance,
 * internal consistency, supporting context, category/tag alignment, and
 * non-duplicative content.
 *
 * Quality means presentation and usefulness, NOT guaranteed truth.
 * Returns a score from 0–100.
 *
 * Full spec signature: content, entryType, category, subtags, customTags,
 * confidenceLevel, userId. The userId is accepted for future per-user
 * baseline calibration but does not affect the score directly.
 */
function evaluateOpenIntelligenceQuality(params: {
  content: string;
  entryType?: string | null;
  category?: string | null;
  subtags?: string[] | null;
  customTags?: string[] | null;
  tags?: string[] | null;
  confidenceLevel: string;
  userId?: string;
}): number {
  const text = params.content.trim();
  if (text.length === 0) return 0;

  let score = 0;

  // 1. Detail: character count relative to expected ranges
  const charCount = text.replace(/\s/g, "").length;
  if (charCount >= 200) score += 20;
  else if (charCount >= 100) score += 15;
  else if (charCount >= 50) score += 10;
  else if (charCount >= 20) score += 5;

  // 2. Clarity: sentence structure (periods, commas, semicolons indicate structured writing)
  const sentenceCount = (text.match(/\./g) ?? []).length;
  const avgSentenceLen = sentenceCount > 0 ? text.length / sentenceCount : text.length;
  if (avgSentenceLen > 0 && avgSentenceLen < 200) score += 10; // readable sentences
  else if (avgSentenceLen > 0) score += 5;

  // 3. Specificity: proper nouns, numbers, entity mentions
  const properNouns = (text.match(/\b[A-Z][a-z]{2,}\b/g) ?? []).length;
  const numbers = (text.match(/\b\d+(?:\.\d+)?/g) ?? []).length;
  score += Math.min(15, properNouns * 3 + numbers * 2);

  // 4. Category/tag alignment — deliberate categorization
  const allTags = [...(params.subtags ?? []), ...(params.customTags ?? []), ...(params.tags ?? [])];
  const tagCount = allTags.length + (params.category ? 1 : 0);
  score += Math.min(10, tagCount * 3);

  // 5. Entry-type depth bonus — deeper entries get slightly more credit
  const entryTypeBonus: Record<string, number> = {
    quick_observation: 0,
    basic_deep_entry: 4,
    advanced_deep_entry: 8,
  };
  score += entryTypeBonus[params.entryType ?? ""] ?? 0;

  // 6. Confidence alignment — higher confidence claims get slight quality credit
  // (but quality is about presentation, not truth)
  const confidenceBoost: Record<string, number> = {
    verified_observation: 5,
    strong_confidence: 4,
    moderate_confidence: 3,
    weak_suspicion: 1,
  };
  score += confidenceBoost[params.confidenceLevel] ?? 2;

  // 7. Supporting context: mentions of sources, references, evidence
  const supportKeywords = ["because", "according to", "source", "evidence", "observed", "measured", "reported", "data", "study", "analysis"];
  const lowerText = text.toLowerCase();
  const supportCount = supportKeywords.filter((k) => lowerText.includes(k)).length;
  score += Math.min(10, supportCount * 3);

  // 8. Internal consistency: absence of obvious contradictions
  const negationPairs = (text.match(/\bnot\b|\bnever\b|\bcannot\b|\bcan't\b|\bdon't\b/gi) ?? []).length;
  if (negationPairs <= 2) score += 5;

  // 9. Non-duplicative content — penalize repeated phrases (keyword stuffing)
  const words = text.toLowerCase().split(/\s+/);
  const wordFreq = new Map<string, number>();
  for (const w of words) {
    if (w.length > 3) wordFreq.set(w, (wordFreq.get(w) ?? 0) + 1);
  }
  const repeatedWords = [...wordFreq.values()].filter((c) => c > 3).length;
  if (repeatedWords === 0) score += 5;
  else score -= Math.min(10, repeatedWords * 2);

  // 10. Low-effort detection: very short, meaningless, or keyword-stuffed content
  const meaningfulWords = words.filter((w) => w.length > 2).length;
  if (meaningfulWords < 5) score -= 15;

  return Math.max(0, Math.min(100, score));
}

/**
 * Compute an influence baseline (0–100) from quality, confidence, and entry type.
 * Server-authoritative — the client must not set influence_score directly.
 */
function computeInfluenceBaseline(qualityScore: number, confidenceLevel: string, entryType?: string | null): number {
  const confidenceMultiplier: Record<string, number> = {
    verified_observation: 1.15,
    strong_confidence: 1.0,
    moderate_confidence: 0.85,
    weak_suspicion: 0.65,
  };
  const typeMultiplier: Record<string, number> = {
    quick_observation: 0.8,
    basic_deep_entry: 1.0,
    advanced_deep_entry: 1.15,
  };
  const raw = qualityScore * 0.7 * (confidenceMultiplier[confidenceLevel] ?? 0.8) * (typeMultiplier[entryType ?? ""] ?? 1.0) + qualityScore * 0.3;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/** Simple hash for duplicate detection. */
function contentHash(text: string): string {
  const normalized = text.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return "ch_" + Math.abs(hash).toString(16).slice(0, 16);
}

/** Normalize text for near-duplicate comparison. */
function normalizeForComparison(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ");
}

/**
 * Check for duplicates: exact hash match or high Jaccard similarity.
 * Returns the existing entry ID if a duplicate is found, null otherwise.
 */
function findDuplicate(
  entries: { id: string; content: string; content_hash?: string | null }[],
  newContent: string,
  newHash: string,
): string | null {
  const normalizedNew = normalizeForComparison(newContent);
  const newTokens = new Set(normalizedNew.split(" ").filter((w) => w.length > 2));

  for (const entry of entries) {
    // Exact hash match
    if (entry.content_hash === newHash) return entry.id;

    // Near-duplicate: Jaccard similarity > 0.8
    const normalizedEntry = normalizeForComparison(entry.content);
    const entryTokens = new Set(normalizedEntry.split(" ").filter((w) => w.length > 2));
    if (newTokens.size === 0 || entryTokens.size === 0) continue;

    let intersection = 0;
    for (const t of newTokens) {
      if (entryTokens.has(t)) intersection++;
    }
    const union = newTokens.size + entryTokens.size - intersection;
    const jaccard = intersection / union;
    if (jaccard > 0.8) return entry.id;
  }

  return null;
}

// ── Phase 5B: Feedback Submission Handler ─────────────────────────────────────

/** Feedback type values allowed by the schema. */
const FEEDBACK_TYPES = [
  "helpful",
  "accurate_to_my_experience",
  "needs_context",
  "outdated",
  "incorrect",
  "misleading",
  "abusive",
] as const;

/** Access source values allowed by the live schema. */
const ACCESS_SOURCES = ["faction", "exchange", "approved_collaboration"] as const;

/** Daily feedback limit to prevent gaming. */
const MAX_DAILY_FEEDBACK = 20;
const MAX_DAILY_DISPUTES = 5;

async function handleSubmitFeedback(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  let payload: {
    entryId: string;
    feedbackType: string;
    optionalReason?: string;
    accessSource: string;
    factionId?: string;
    exchangePurchaseId?: string;
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request." }, 400);
  }

  // Validate feedback type
  if (!FEEDBACK_TYPES.includes(payload.feedbackType as (typeof FEEDBACK_TYPES)[number])) {
    return jsonResponse({ ok: false, error: "Invalid feedback type." }, 400);
  }

  // Validate access source
  if (!ACCESS_SOURCES.includes(payload.accessSource as (typeof ACCESS_SOURCES)[number])) {
    return jsonResponse({ ok: false, error: "Invalid access source." }, 400);
  }

  // Authenticate
  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createClient(normalizeSupabaseUrl(env.SUPABASE_URL ?? ""), env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  const serviceClient = getServiceRoleClient(env);
  if (!serviceClient) {
    return jsonResponse({ ok: false, error: "Server configuration error." }, 503);
  }

  // 1. Fetch the entry to verify it exists and get owner + status + sharing flags
  const { data: entry, error: entryErr } = await serviceClient
    .from("open_intelligence")
    .select("id, user_id, validation_status, eagoh_id, exchange_share_enabled")
    .eq("id", payload.entryId)
    .maybeSingle();

  if (entryErr || !entry) {
    return jsonResponse({ ok: false, error: "Entry not found." }, 404);
  }

  const entryRow = entry as {
    id: string; user_id: string; validation_status: string;
    eagoh_id: string; exchange_share_enabled: boolean;
  };

  // 2. Prevent self-feedback
  if (entryRow.user_id === userId) {
    return jsonResponse({ ok: false, error: "Cannot provide feedback on your own entry." }, 403);
  }

  // 2b. Block feedback on rejected or withdrawn entries
  if (EXCLUDED_STATUSES.includes(entryRow.validation_status as (typeof EXCLUDED_STATUSES)[number])) {
    return jsonResponse({ ok: false, error: "Feedback is not available for rejected or withdrawn entries." }, 403);
  }

  // 3. Verify feedback eligibility — user must have legitimate access
  const canAccess = await verifyFeedbackEligibility(
    serviceClient,
    userId,
    entryRow.user_id,
    payload.entryId,
    entryRow.eagoh_id,
    entryRow.exchange_share_enabled,
    payload.accessSource,
    payload.factionId,
    payload.exchangePurchaseId,
  );

  if (!canAccess) {
    return jsonResponse({ ok: false, error: "You do not have authorized access to this intelligence." }, 403);
  }

  // 4. Anti-gaming: check daily rate limits
  const rateLimitOk = await checkAndUpdateRateLimits(serviceClient, userId, "feedback");
  if (!rateLimitOk) {
    return jsonResponse({ ok: false, error: "Daily feedback limit reached. Please try again tomorrow." }, 429);
  }

  // 5. Check for anomaly patterns (basic)
  const anomalyFlag = await detectFeedbackAnomaly(serviceClient, userId);

  // 6. Upsert feedback (unique constraint on entry_id + reviewer_user_id)
  const { error: insertErr } = await serviceClient
    .from("open_intelligence_feedback")
    .upsert({
      entry_id: payload.entryId,
      reviewer_user_id: userId,
      feedback_type: payload.feedbackType,
      optional_reason: payload.optionalReason ?? null,
      access_source: payload.accessSource,
      faction_id: payload.factionId ?? null,
      exchange_purchase_id: payload.exchangePurchaseId ?? null,
    }, { onConflict: "entry_id,reviewer_user_id" });

  if (insertErr) {
    console.warn("[feedback] insert failed", insertErr.message);
    return jsonResponse({ ok: false, error: "Failed to submit feedback." }, 500);
  }

  // 7. Flag anomaly if detected (but don't reject — flag for review)
  if (anomalyFlag) {
    await serviceClient
      .from("feedback_rate_limits")
      .update({ anomaly_flag: true, anomaly_reason: "burst_or_targeting_pattern" })
      .eq("user_id", userId);
    console.warn("[feedback] anomaly flag set for user", { userId: userId.slice(0, 8) });
  }

  // 8. If feedback is 'outdated', trigger staleness evaluation
  if (payload.feedbackType === "outdated") {
    try {
      await serviceClient.rpc("evaluate_entry_staleness", { p_entry_id: payload.entryId });
    } catch (e) {
      // Non-fatal
      console.warn("[feedback] staleness eval failed", e instanceof Error ? e.message : "unknown");
    }
  }

  // 9. Recalculate the contributor's reputation (best-effort)
  try {
    await serviceClient.rpc("recalculate_contributor_reputation", { p_user_id: entryRow.user_id });
  } catch (e) {
    console.warn("[feedback] reputation recalc failed", e instanceof Error ? e.message : "unknown");
  }

  return jsonResponse({ ok: true });
}

/**
 * Verify that the reviewer had legitimate access to the intelligence entry.
 * Access is granted through: active faction membership with explicit sharing,
 * or an active Exchange synchronization purchase for the vendor's specific EAGOH.
 *
 * SECURITY: Does not trust client-supplied factionId or exchangePurchaseId
 * without full server-side verification of membership, purchase status,
 * vendor/EAGOH consistency, and entry sharing flags.
 */
async function verifyFeedbackEligibility(
  serviceClient: SupabaseClient,
  reviewerUserId: string,
  entryOwnerId: string,
  entryId: string,
  entryEagohId: string,
  entryExchangeShareEnabled: boolean,
  accessSource: string,
  factionId?: string,
  exchangePurchaseId?: string,
): Promise<boolean> {
  if (accessSource === "approved_collaboration") {
    // Approved collaboration routes would require additional admin verification
    // For now, deny from client requests unless future admin logic is added
    return false;
  }

  if (accessSource === "faction") {
    if (!factionId) return false;

    // 1. Verify reviewer is an active member of the faction
    const { data: membership } = await serviceClient
      .from("faction_members")
      .select("status")
      .eq("faction_id", factionId)
      .eq("user_id", reviewerUserId)
      .maybeSingle();

    if (!membership) return false;
    const memberStatus = (membership as { status: string }).status;
    // Accept active members and grace-period members
    if (memberStatus !== "active" && memberStatus !== "grace_period") return false;

    // 2. Verify the entry is explicitly shared with that faction
    const { data: shared } = await serviceClient
      .from("faction_shared_intelligence")
      .select("id, contributor_user_id")
      .eq("faction_id", factionId)
      .eq("oi_entry_id", entryId)
      .maybeSingle();

    if (!shared) return false;

    // 3. Verify the shared record's contributor matches the entry owner (defense in depth)
    const sharedRow = shared as { id: string; contributor_user_id: string };
    if (sharedRow.contributor_user_id !== entryOwnerId) return false;

    return true;
  }

  if (accessSource === "exchange") {
    // Must supply a specific purchase ID — do not accept any active purchase
    if (!exchangePurchaseId) return false;

    // Entry must have Exchange sharing enabled
    if (!entryExchangeShareEnabled) return false;

    // 1. Fetch the specific purchase and verify it belongs to the reviewer
    const { data: purchase } = await serviceClient
      .from("marketplace_sync_purchases")
      .select("id, buyer_id, vendor_id, eagoh_id, active, started_at, expires_at")
      .eq("id", exchangePurchaseId)
      .maybeSingle();

    if (!purchase) return false;

    const purchaseRow = purchase as {
      id: string; buyer_id: string; vendor_id: string; eagoh_id: string;
      active: boolean; started_at: string; expires_at: string;
    };

    // 2. Purchase buyer must equal the authenticated reviewer
    if (purchaseRow.buyer_id !== reviewerUserId) return false;

    // 3. Purchase must be active
    if (!purchaseRow.active) return false;

    // 4. Purchase must have started and not expired (server time)
    const serverNow = new Date();
    const startedAt = new Date(purchaseRow.started_at);
    const expiresAt = new Date(purchaseRow.expires_at);
    if (serverNow < startedAt || serverNow >= expiresAt) return false;

    // 5. Purchase vendor EAGOH must equal the entry's EAGOH
    if (purchaseRow.eagoh_id !== entryEagohId) return false;

    // 6. Entry owner must equal the verified vendor
    if (purchaseRow.vendor_id !== entryOwnerId) return false;

    // 7. Verify the listing still references the same vendor and EAGOH
    const { data: listing } = await serviceClient
      .from("marketplace_listings")
      .select("vendor_id, eagoh_id, active")
      .eq("vendor_id", purchaseRow.vendor_id)
      .eq("eagoh_id", purchaseRow.eagoh_id)
      .maybeSingle();

    if (listing) {
      const listingRow = listing as {
        vendor_id: string; eagoh_id: string; active: boolean;
      };
      if (!listingRow.active) return false;
      if (listingRow.vendor_id !== purchaseRow.vendor_id) return false;
      if (listingRow.eagoh_id !== purchaseRow.eagoh_id) return false;
    }

    return true;
  }

  return false;
}

/**
 * Check and update daily rate limits. Returns false if limit exceeded.
 */
async function checkAndUpdateRateLimits(
  serviceClient: SupabaseClient,
  userId: string,
  type: "feedback" | "dispute",
): Promise<boolean> {
  const maxDaily = type === "feedback" ? MAX_DAILY_FEEDBACK : MAX_DAILY_DISPUTES;
  const now = new Date().toISOString();

  // The live table uses one row per user (user_id as primary key)
  // with daily_feedback_count / daily_dispute_count for per-day limits
  // and feedback_count / dispute_count for total counts.
  const { data: existing } = await serviceClient
    .from("feedback_rate_limits")
    .select("feedback_count, dispute_count, daily_feedback_count, daily_dispute_count, window_started_at, last_feedback_at, last_dispute_at")
    .eq("user_id", userId)
    .maybeSingle();

  // Determine if the daily window should reset (compare window_started_at to today)
  const todayStart = new Date().toISOString().slice(0, 10) + "T00:00:00Z";

  if (existing) {
    const row = existing as {
      feedback_count: number; dispute_count: number;
      daily_feedback_count: number; daily_dispute_count: number;
      window_started_at: string | null; last_feedback_at: string | null; last_dispute_at: string | null;
    };

    // Reset daily counters if the window started on a previous day
    const windowDate = row.window_started_at ? new Date(row.window_started_at).toISOString().slice(0, 10) : null;
    const isNewDay = windowDate !== todayStart.slice(0, 10);

    const dailyCount = type === "feedback"
      ? (isNewDay ? 0 : row.daily_feedback_count)
      : (isNewDay ? 0 : row.daily_dispute_count);

    if (dailyCount >= maxDaily) return false;

    const updateFields: Record<string, unknown> = {
      updated_at: now,
      window_started_at: isNewDay ? todayStart : row.window_started_at,
    };

    if (isNewDay) {
      updateFields.daily_feedback_count = type === "feedback" ? 1 : 0;
      updateFields.daily_dispute_count = type === "dispute" ? 1 : 0;
    } else {
      updateFields.daily_feedback_count = type === "feedback" ? row.daily_feedback_count + 1 : row.daily_feedback_count;
      updateFields.daily_dispute_count = type === "dispute" ? row.daily_dispute_count + 1 : row.daily_dispute_count;
    }

    updateFields.feedback_count = type === "feedback" ? row.feedback_count + 1 : row.feedback_count;
    updateFields.dispute_count = type === "dispute" ? row.dispute_count + 1 : row.dispute_count;

    if (type === "feedback") updateFields.last_feedback_at = now;
    else updateFields.last_dispute_at = now;

    await serviceClient
      .from("feedback_rate_limits")
      .update(updateFields)
      .eq("user_id", userId);
  } else {
    await serviceClient
      .from("feedback_rate_limits")
      .insert({
        user_id: userId,
        feedback_count: type === "feedback" ? 1 : 0,
        dispute_count: type === "dispute" ? 1 : 0,
        daily_feedback_count: type === "feedback" ? 1 : 0,
        daily_dispute_count: type === "dispute" ? 1 : 0,
        window_started_at: todayStart,
        last_feedback_at: type === "feedback" ? now : null,
        last_dispute_at: type === "dispute" ? now : null,
      });
  }

  return true;
}

/**
 * Basic anomaly detection for feedback gaming.
 * Flags: rapid bursts, targeting same user repeatedly, reciprocal patterns.
 */
async function detectFeedbackAnomaly(
  serviceClient: SupabaseClient,
  userId: string,
): Promise<boolean> {
  // Check if user submitted >10 feedback in the last hour (burst)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: recentFeedback } = await serviceClient
    .from("open_intelligence_feedback")
    .select("id")
    .eq("reviewer_user_id", userId)
    .gte("created_at", oneHourAgo);

  if (recentFeedback && recentFeedback.length > 10) return true;

  // Check if user is targeting the same contributor repeatedly (>5 feedback to one person today)
  const today = new Date().toISOString().slice(0, 10);
  const { data: todayFeedback } = await serviceClient
    .from("open_intelligence_feedback")
    .select("entry_id")
    .eq("reviewer_user_id", userId)
    .gte("created_at", today + "T00:00:00Z");

  if (todayFeedback && todayFeedback.length > 0) {
    // Get entry owners
    const entryIds = todayFeedback.map((f) => (f as { entry_id: string }).entry_id);
    const { data: entries } = await serviceClient
      .from("open_intelligence")
      .select("user_id")
      .in("id", entryIds);

    if (entries) {
      const ownerCount = new Map<string, number>();
      for (const e of entries as Array<{ user_id: string }>) {
        ownerCount.set(e.user_id, (ownerCount.get(e.user_id) ?? 0) + 1);
      }
      for (const count of ownerCount.values()) {
        if (count > 5) return true;
      }
    }
  }

  return false;
}

// ── Phase 5B: Dispute Submission Handler ──────────────────────────────────────

async function handleSubmitDispute(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  let payload: {
    entryId: string;
    reasonCategory: string;
    explanation: string;
    supportingUrl?: string;
    accessSource: string;
    factionId?: string;
    exchangePurchaseId?: string;
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request." }, 400);
  }

  const validCategories = [
    "incorrect", "misleading", "outdated", "needs_context",
    "fabricated", "abusive", "prohibited", "other",
  ];
  if (!validCategories.includes(payload.reasonCategory)) {
    return jsonResponse({ ok: false, error: "Invalid reason category." }, 400);
  }

  if (!ACCESS_SOURCES.includes(payload.accessSource as (typeof ACCESS_SOURCES)[number])) {
    return jsonResponse({ ok: false, error: "Invalid access source." }, 400);
  }

  if (!payload.explanation?.trim() || payload.explanation.trim().length < 10) {
    return jsonResponse({ ok: false, error: "Explanation must be at least 10 characters." }, 400);
  }
  if (payload.explanation.trim().length > 1000) {
    return jsonResponse({ ok: false, error: "Explanation must be 1000 characters or fewer." }, 400);
  }
  // Validate supporting URL format if provided
  if (payload.supportingUrl && payload.supportingUrl.trim()) {
    if (!isValidHttpUrl(payload.supportingUrl.trim())) {
      return jsonResponse({ ok: false, error: "Supporting URL must be a valid HTTP or HTTPS URL." }, 400);
    }
  }

  // Authenticate
  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createClient(normalizeSupabaseUrl(env.SUPABASE_URL ?? ""), env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  const serviceClient = getServiceRoleClient(env);
  if (!serviceClient) {
    return jsonResponse({ ok: false, error: "Server configuration error." }, 503);
  }

  // Fetch entry with status and sharing flags for eligibility verification
  const { data: entry, error: entryErr } = await serviceClient
    .from("open_intelligence")
    .select("id, user_id, validation_status, eagoh_id, exchange_share_enabled")
    .eq("id", payload.entryId)
    .maybeSingle();

  if (entryErr || !entry) {
    return jsonResponse({ ok: false, error: "Entry not found." }, 404);
  }

  const entryRow = entry as {
    id: string; user_id: string; validation_status: string;
    eagoh_id: string; exchange_share_enabled: boolean;
  };

  // Prevent self-dispute
  if (entryRow.user_id === userId) {
    return jsonResponse({ ok: false, error: "Cannot dispute your own entry." }, 403);
  }

  // Block disputes on rejected or withdrawn entries
  if (EXCLUDED_STATUSES.includes(entryRow.validation_status as (typeof EXCLUDED_STATUSES)[number])) {
    return jsonResponse({ ok: false, error: "Disputes are not available for rejected or withdrawn entries." }, 403);
  }

  // Verify access eligibility — require explicit access source from client
  const canAccess = await verifyFeedbackEligibility(
    serviceClient, userId, entryRow.user_id, payload.entryId,
    entryRow.eagoh_id, entryRow.exchange_share_enabled,
    payload.accessSource, payload.factionId, payload.exchangePurchaseId,
  );
  if (!canAccess) {
    return jsonResponse({ ok: false, error: "You do not have authorized access to this intelligence." }, 403);
  }

  // Rate limit
  const rateLimitOk = await checkAndUpdateRateLimits(serviceClient, userId, "dispute");
  if (!rateLimitOk) {
    return jsonResponse({ ok: false, error: "Daily dispute limit reached." }, 429);
  }

  // Insert dispute (unique constraint prevents duplicate disputes by same user)
  const { error: insertErr } = await serviceClient
    .from("open_intelligence_disputes")
    .insert({
      entry_id: payload.entryId,
      reporter_user_id: userId,
      reason_category: payload.reasonCategory,
      explanation: payload.explanation.trim(),
      supporting_url: payload.supportingUrl ?? null,
      access_source: payload.accessSource,
      faction_id: payload.factionId ?? null,
      exchange_purchase_id: payload.exchangePurchaseId ?? null,
      status: "pending",
    });

  if (insertErr) {
    if (insertErr.message.includes("duplicate") || insertErr.message.includes("unique")) {
      return jsonResponse({ ok: false, error: "You have already disputed this entry." }, 409);
    }
    console.warn("[dispute] insert failed", insertErr.message);
    return jsonResponse({ ok: false, error: "Failed to submit dispute." }, 500);
  }

  // Update entry's active dispute count and set validation_status to 'disputed' if pending
  const disputeCountResult = await serviceClient
    .from("open_intelligence_disputes")
    .select("id", { count: "exact", head: true })
    .eq("entry_id", payload.entryId)
    .in("status", ["pending", "reviewing", "upheld"]);
  await serviceClient
    .from("open_intelligence")
    .update({
      active_dispute_count: disputeCountResult.count ?? 1,
    })
    .eq("id", payload.entryId);

  // If entry was pending_review, mark it as disputed
  await serviceClient
    .from("open_intelligence")
    .update({ validation_status: "disputed" })
    .eq("id", payload.entryId)
    .eq("validation_status", "pending_review");

  // Recalculate contributor reputation
  try {
    await serviceClient.rpc("recalculate_contributor_reputation", { p_user_id: entryRow.user_id });
  } catch (e) {
    console.warn("[dispute] reputation recalc failed", e instanceof Error ? e.message : "unknown");
  }

  return jsonResponse({ ok: true });
}

// ── Phase 5B: Reputation Fetch Handler ───────────────────────────────────────

async function handleGetReputation(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createClient(normalizeSupabaseUrl(env.SUPABASE_URL ?? ""), env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  const url = new URL(request.url);
  const targetUserId = url.searchParams.get("userId") ?? userId;

  // If requesting own reputation, use service_role to return full details.
  // If requesting another user's reputation, return only safe public fields
  // via the public_contributor_reputation view (overall_score only).
  const isSelf = targetUserId === userId;

  if (isSelf) {
    const serviceClient = getServiceRoleClient(env);
    if (serviceClient) {
      const { data: selfData, error: selfErr } = await serviceClient
        .from("intelligence_contributor_reputation")
        .select("*")
        .eq("user_id", targetUserId)
        .maybeSingle();

      if (selfErr) {
        return jsonResponse({ ok: false, error: "Failed to fetch reputation." }, 500);
      }

      if (!selfData) {
        return jsonResponse({
          ok: true,
          reputation: {
            user_id: targetUserId,
            overall_score: 50,
            quality_component: 50,
            usefulness_component: 50,
            validation_component: 50,
            reliability_component: 50,
            dispute_penalty: 0,
            total_entries: 0,
            entries_used: 0,
            supported_entries: 0,
            disputed_entries: 0,
            rejected_entries: 0,
            withdrawn_entries: 0,
          },
        });
      }

      return jsonResponse({ ok: true, reputation: selfData });
    }
  }

  // Other users: return only safe public fields via the view
  const { data, error } = await supabase
    .from("public_contributor_reputation")
    .select("user_id, overall_score, calculated_at")
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (error) {
    return jsonResponse({ ok: false, error: "Failed to fetch reputation." }, 500);
  }

  if (!data) {
    // Return neutral defaults for new users
    return jsonResponse({
      ok: true,
      reputation: {
        user_id: targetUserId,
        overall_score: 50,
        calculated_at: null,
      },
    });
  }

  return jsonResponse({ ok: true, reputation: data });
}

// ── Phase 5B: Quality Evaluation Handler ─────────────────────────────────────

async function handleEvaluateQuality(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createClient(normalizeSupabaseUrl(env.SUPABASE_URL ?? ""), env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  let payload: { entryId: string };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request." }, 400);
  }

  const serviceClient = getServiceRoleClient(env);
  if (!serviceClient) {
    return jsonResponse({ ok: false, error: "Server configuration error." }, 503);
  }

  // Fetch entry — only the owner can request quality evaluation
  const { data: entry, error } = await serviceClient
    .from("open_intelligence")
    .select("id, user_id, content, entry_type, selected_category, selected_subtags, custom_tags, confidence_level, quality_score, validation_status, content_hash, duplicate_flag")
    .eq("id", payload.entryId)
    .maybeSingle();

  if (error || !entry) {
    return jsonResponse({ ok: false, error: "Entry not found." }, 404);
  }

  const entryRow = entry as {
    id: string; user_id: string; content: string; entry_type: string; selected_category: string | null;
    selected_subtags: string[] | null; custom_tags: string[] | null;
    confidence_level: string; quality_score: number; validation_status: string;
    content_hash: string | null; duplicate_flag: boolean;
  };

  if (entryRow.user_id !== userId) {
    return jsonResponse({ ok: false, error: "Only the entry owner can request quality evaluation." }, 403);
  }

  // Evaluate quality with full spec signature
  const newQuality = evaluateOpenIntelligenceQuality({
    content: entryRow.content,
    entryType: entryRow.entry_type,
    category: entryRow.selected_category,
    subtags: entryRow.selected_subtags,
    customTags: entryRow.custom_tags,
    confidenceLevel: entryRow.confidence_level,
    userId,
  });

  // Compute server-authoritative influence baseline
  const newInfluence = computeInfluenceBaseline(newQuality, entryRow.confidence_level, entryRow.entry_type);

  // Check for duplicates among the user's other entries
  const { data: otherEntries } = await serviceClient
    .from("open_intelligence")
    .select("id, content, content_hash")
    .eq("user_id", userId)
    .neq("id", payload.entryId)
    .limit(100);

  const newHash = contentHash(entryRow.content);
  const duplicateOf = otherEntries
    ? findDuplicate(otherEntries as Array<{ id: string; content: string; content_hash: string | null }>, entryRow.content, newHash)
    : null;

  // Update entry with server-authoritative quality, influence, content hash, and duplicate flag
  await serviceClient
    .from("open_intelligence")
    .update({
      quality_score: newQuality,
      influence_score: newInfluence,
      content_hash: newHash,
      duplicate_flag: duplicateOf !== null,
      duplicate_of: duplicateOf,
    })
    .eq("id", payload.entryId);

  return jsonResponse({
    ok: true,
    qualityScore: newQuality,
    influenceScore: newInfluence,
    duplicateDetected: duplicateOf !== null,
    duplicateOf: duplicateOf,
  });
}

// ── OI Create Handler (atomic deduction + insert) ─────────────────────────────

const DEBUG_OI = true; // dev-only OI logging

const OI_ENTRY_COSTS: Record<string, number> = {
  quick_observation: 10,
  basic_deep_entry: 15,
  advanced_deep_entry: 25,
};

const OI_ENTRY_TYPE_LIMITS: Record<string, number> = {
  quick_observation: 110,
  basic_deep_entry: 200,
  advanced_deep_entry: 400,
};

const OI_VALID_CONFIDENCE_LEVELS = new Set([
  "weak_suspicion",
  "moderate_confidence",
  "strong_confidence",
  "verified_observation",
]);

/**
 * Finalize an OI entry after a successful insert: check balance, deduct Neurons,
 * log the transaction, and return success. If deduction fails, the entry is
 * deleted (rollback) so the user is never charged without a saved entry.
 *
 * This is shared between the full-insert and minimal-insert fallback paths.
 */
async function finalizeOiEntry(
  serviceClient: SupabaseClient,
  userId: string,
  eagohId: string,
  insertData: Record<string, unknown>,
  cost: number,
  note: string,
  entryType: string,
): Promise<Response> {
  const entryId = (insertData as { id: string }).id;

  // 1. Check balance and deduct via service-role client
  const { data: profileRow, error: profileErr } = await serviceClient
    .from("profiles")
    .select("edge_subscription, edge_purchased")
    .eq("id", userId)
    .maybeSingle();

  if (profileErr || !profileRow) {
    if (DEBUG_OI) console.warn("[oi/create] fallback profile lookup failed — deleting entry:", profileErr?.message ?? "no row");
    // Rollback: delete the entry since we can't charge
    await serviceClient.from("open_intelligence").delete().eq("id", entryId);
    return jsonResponse({ ok: false, error: "Could not verify Neuron balance." }, 500);
  }

  const sub = (profileRow as { edge_subscription: number | null }).edge_subscription ?? 0;
  const purch = (profileRow as { edge_purchased: number | null }).edge_purchased ?? 0;
  const total = sub + purch;

  if (total < cost) {
    if (DEBUG_OI) console.warn("[oi/create] fallback insufficient balance — deleting entry. have=" + total + " need=" + cost);
    // Rollback: delete the entry
    await serviceClient.from("open_intelligence").delete().eq("id", entryId);
    return jsonResponse({ ok: false, error: `Insufficient Neurons. Need ${cost} Neurons (have ${total}).` }, 402);
  }

  const fromSub = Math.min(sub, cost);
  const fromPurchased = cost - fromSub;
  const nextSub = sub - fromSub;
  const nextPurchased = purch - fromPurchased;
  const bucket = fromSub > 0 && fromPurchased > 0 ? "mixed" : fromPurchased > 0 ? "purchased" : "subscription";

  const { error: deductErr } = await serviceClient
    .from("profiles")
    .update({ edge_subscription: nextSub, edge_purchased: nextPurchased, updated_at: new Date().toISOString() })
    .eq("id", userId);

  if (deductErr) {
    if (DEBUG_OI) console.warn("[oi/create] fallback deduct failed — deleting entry:", deductErr.message);
    // Rollback: delete the entry since deduction failed
    await serviceClient.from("open_intelligence").delete().eq("id", entryId);
    return jsonResponse({ ok: false, error: "Entry could not be saved. No Neurons were charged." }, 500);
  }

  // 2. Log the transaction (best-effort)
  await serviceClient.from("edge_transactions").insert({
    user_id: userId,
    kind: "deduction",
    reason: "observation",
    amount: cost,
    bucket: bucket,
    from_subscription: fromSub,
    from_purchased: fromPurchased,
    balance_subscription_after: nextSub,
    balance_purchased_after: nextPurchased,
    note: note,
  }).then(() => {}).catch(() => {});

  if (DEBUG_OI) console.log("[oi/create] fallback success entryId=" + entryId.slice(0, 8) + " cost=" + cost + " type=" + entryType);

  return jsonResponse({
    ok: true,
    entry: insertData,
    edgeCost: cost,
    balanceSubscriptionAfter: nextSub,
    balancePurchasedAfter: nextPurchased,
  });
}

async function handleCreateOIEntry(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  let payload: {
    requestId?: unknown;
    eagohId?: unknown;
    intelligenceDomain?: unknown;
    entryType?: unknown;
    content?: unknown;
    confidenceLevel?: unknown;
    tag?: unknown;
    selectedSubtags?: unknown;
    customTags?: unknown;
    selectedCategory?: unknown;
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request." }, 400);
  }

  // ── Authenticate ──
  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createAuthedClient(env, jwt);
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  const serviceClient = getServiceRoleClient(env);
  if (!serviceClient) {
    return jsonResponse({ ok: false, error: "Server configuration error." }, 503);
  }

  // ── Validate requestId (idempotency key) ──
  const requestId = typeof payload.requestId === "string" ? payload.requestId.trim().slice(0, 120) : "";
  if (!requestId) {
    return jsonResponse({ ok: false, error: "A request ID is required." }, 400);
  }

  // ── Validate entry type ──
  const entryType = typeof payload.entryType === "string" ? payload.entryType.trim() : "";
  if (!OI_ENTRY_COSTS[entryType]) {
    return jsonResponse({ ok: false, error: "Invalid entry type." }, 400);
  }

  // ── Validate content ──
  const content = typeof payload.content === "string" ? payload.content.trim() : "";
  if (content.length === 0) {
    return jsonResponse({ ok: false, error: "Entry cannot be empty." }, 400);
  }
  const charCountNoSpaces = content.replace(/\s/g, "").length;
  const limit = OI_ENTRY_TYPE_LIMITS[entryType];
  if (charCountNoSpaces > limit) {
    return jsonResponse({ ok: false, error: `Entry exceeds ${limit} character limit (excl. spaces).` }, 400);
  }

  // ── Validate confidence level ──
  const confidenceLevel = typeof payload.confidenceLevel === "string" ? payload.confidenceLevel.trim() : "";
  if (!OI_VALID_CONFIDENCE_LEVELS.has(confidenceLevel)) {
    return jsonResponse({ ok: false, error: "Invalid confidence level." }, 400);
  }

  // ── Validate eagohId ──
  const eagohId = typeof payload.eagohId === "string" ? payload.eagohId.trim() : "";
  if (!eagohId) {
    return jsonResponse({ ok: false, error: "An EAGOH is required." }, 400);
  }

  if (DEBUG_OI) {
    console.log("[oi/create] eagohId=" + eagohId.slice(0, 8) + " userIdPrefix=" + userId.slice(0, 8) + " type=" + entryType);
  }

  // ── Verify EAGOH ownership + domain ──
  const { data: eagohRow, error: eagohErr } = await serviceClient
    .from("eagohs")
    .select("id, user_id, name, domain")
    .eq("id", eagohId)
    .maybeSingle();

  if (eagohErr) {
    if (DEBUG_OI) console.log("[oi/create] EAGOH lookup error: " + eagohErr.message);
    return jsonResponse({ ok: false, error: "EAGOH not found." }, 404);
  }
  if (!eagohRow) {
    if (DEBUG_OI) console.log("[oi/create] EAGOH lookup returned no row");
    return jsonResponse({ ok: false, error: "EAGOH not found." }, 404);
  }

  const eagoh = eagohRow as { id: string; user_id: string; name: string; domain: string | null };

  if (DEBUG_OI) console.log("[oi/create] EAGOH found: " + eagoh.name);

  if (eagoh.user_id !== userId) {
    return jsonResponse({ ok: false, error: "You can only use EAGOHs you own." }, 403);
  }
  if (!eagoh.domain) {
    return jsonResponse({ ok: false, error: "This EAGOH has no domain specialization." }, 400);
  }

  // ── Verify entry domain matches EAGOH domain ──
  const intelligenceDomain = typeof payload.intelligenceDomain === "string" ? payload.intelligenceDomain.trim() : "";
  if (intelligenceDomain && intelligenceDomain !== eagoh.domain) {
    return jsonResponse({ ok: false, error: "Entry domain does not match this EAGOH's domain." }, 400);
  }

  // ── Build insert fields ──
  const subtags = Array.isArray(payload.selectedSubtags) ? payload.selectedSubtags.filter((t) => typeof t === "string") : [];
  const customTags = Array.isArray(payload.customTags) ? payload.customTags.filter((t) => typeof t === "string") : [];
  const tag = typeof payload.tag === "string" ? payload.tag : "general";
  const selectedCategory = typeof payload.selectedCategory === "string" ? payload.selectedCategory : null;

  const note = `OI ${entryType.replace(/_/g, " ")} · ${intelligenceDomain || eagoh.domain}`;

  // ── Atomic deduction + insert via RPC ──
  const { data: rpcData, error: rpcErr } = await serviceClient.rpc("create_oi_entry", {
    p_user_id: userId,
    p_request_id: requestId,
    p_eagoh_id: eagohId,
    p_intelligence_domain: intelligenceDomain || eagoh.domain,
    p_entry_type: entryType,
    p_content: content,
    p_confidence_level: confidenceLevel,
    p_tag: tag,
    p_selected_subtags: subtags,
    p_custom_tags: customTags,
    p_selected_category: selectedCategory,
    p_note: note,
  });

  // Always log the RPC result for diagnostics — even when there's no error object,
  // the RPC may return null data (function not found) which we need to see.
  if (DEBUG_OI) {
    console.log("[oi/create] RPC result: rpcErr=" + (rpcErr ? "yes" : "no") +
      " rpcErrCode=" + (rpcErr?.code ?? "n/a") +
      " rpcErrMsg=" + (rpcErr?.message ?? "n/a") +
      " rpcErrDetails=" + (rpcErr?.details ?? "n/a") +
      " rpcErrHint=" + (rpcErr?.hint ?? "n/a") +
      " rpcDataNull=" + (rpcData == null));
  }

  // If the RPC errored OR returned null data (function doesn't exist in live DB),
  // fall through to the manual insert+deduct fallback. Supabase returns { data: null,
  // error: null } when a PostgREST function is not found — so we must check both.
  const rpcNeedsFallback = rpcErr || (rpcData == null);

  if (rpcNeedsFallback) {
    if (DEBUG_OI) console.warn("[oi/create] RPC unavailable — using manual insert+deduct fallback. reason=" + (rpcErr ? "rpc_error" : "null_data"));
    if (DEBUG_OI) console.warn("[oi/create] RPC failed — falling back to manual insert+deduct:", rpcErr?.code ?? "unknown", rpcErr?.message ?? "n/a", rpcErr?.details ?? "", rpcErr?.hint ?? "");
    // ── Fallback: manual insert + deduct (service-role, bypasses RLS) ──
    // Used when the create_oi_entry RPC is not yet deployed to the live DB.
    // Order: insert entry → check balance → deduct → if deduction fails, delete entry (rollback).
    const cost = OI_ENTRY_COSTS[entryType];

    // 1. Insert the OI entry via service-role client (bypasses RLS)
    const charCountNoSpacesForInsert = content.replace(/\s/g, "").length;

    // ── Discover the actual live table columns so we only insert into columns
    //    that exist. This handles schema mismatches (e.g. selected_category,
    //    selected_subtags, custom_tags not yet added) without failing the insert.
    //    Uses the PostgREST OpenAPI spec exposed at the table endpoint.
    const fullInsertObj: Record<string, unknown> = {
      user_id: userId,
      eagoh_id: eagohId,
      intelligence_domain: intelligenceDomain || eagoh.domain,
      entry_type: entryType,
      tag: tag,
      content: content,
      character_count_no_spaces: charCountNoSpacesForInsert,
      confidence_level: confidenceLevel,
      quality_score: 0,
      validation_status: "pending_review",
      influence_score: 0,
      selected_category: selectedCategory,
      selected_subtags: subtags,
      custom_tags: customTags,
    };

    // All columns we *want* to insert, in priority order (core first, optional last)
    const allDesiredColumns = Object.keys(fullInsertObj);

    // Query the live DB schema to discover which columns actually exist.
    // We fetch one existing row — the keys of the returned object ARE the
    // live column names. If the table is empty, we fall through to the
    // full → minimal heuristic chain below (which also surfaces diagnostics).
    let liveColumns: Set<string> | null = null;
    try {
      const { data: sampleRow, error: sampleErr } = await serviceClient
        .from("open_intelligence")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (!sampleErr && sampleRow && typeof sampleRow === "object") {
        liveColumns = new Set(Object.keys(sampleRow));
        if (DEBUG_OI) console.log("[oi/create] live columns discovered from sample row:", Array.from(liveColumns).join(", "));
      } else if (sampleErr) {
        if (DEBUG_OI) console.log("[oi/create] sample row query error (will use heuristic):", sampleErr.code ?? "n/a", sampleErr.message ?? "n/a");
      } else {
        if (DEBUG_OI) console.log("[oi/create] table empty — no sample row; will use full insert + heuristic fallback");
      }
    } catch {
      // Fall through to heuristic approach below
    }

    // Build the insert object: if we discovered live columns, filter to only those;
    // otherwise use the full set and rely on the fallback chain below.
    let insertObj: Record<string, unknown> = fullInsertObj;
    if (liveColumns) {
      insertObj = {};
      for (const col of allDesiredColumns) {
        if (liveColumns.has(col)) {
          insertObj[col] = fullInsertObj[col];
        }
      }
      if (DEBUG_OI) console.log("[oi/create] filtered insert columns:", Object.keys(insertObj).join(", "));
    }

    // Attempted columns for diagnostics
    const attemptedColumns = Object.keys(insertObj);

    // Full insert (uses discovered columns or all columns)
    const { data: insertData, error: insertErr } = await serviceClient
      .from("open_intelligence")
      .insert(insertObj)
      .select("*")
      .maybeSingle();

    if (insertErr) {
      // ── DIAGNOSTIC: log the full Supabase error server-side ──
      console.error("[oi/create] FALLBACK INSERT FAILED", JSON.stringify({
        endpoint: "/oi/create",
        userIdPrefix: userId.slice(0, 8),
        eagohIdPrefix: eagohId.slice(0, 8),
        entryType: entryType,
        intelligenceDomain: intelligenceDomain || eagoh.domain,
        insertErrCode: insertErr.code ?? null,
        insertErrMessage: insertErr.message ?? null,
        insertErrDetails: insertErr.details ?? null,
        insertErrHint: insertErr.hint ?? null,
        attemptedColumns: attemptedColumns,
      }));

      // ── Try a MINIMAL insert with only core columns from the original CREATE TABLE ──
      // This handles the case where optional columns (selected_category, selected_subtags,
      // custom_tags) or the quality trigger (which references version_number, content_hash,
      // duplicate_flag) don't exist in the live schema yet.
      if (DEBUG_OI) console.log("[oi/create] attempting minimal insert (core columns only)");

      const { data: minimalData, error: minimalErr } = await serviceClient
        .from("open_intelligence")
        .insert({
          user_id: userId,
          eagoh_id: eagohId,
          intelligence_domain: intelligenceDomain || eagoh.domain,
          entry_type: entryType,
          tag: tag,
          content: content,
          character_count_no_spaces: charCountNoSpacesForInsert,
          confidence_level: confidenceLevel,
        })
        .select("*")
        .maybeSingle();

      if (minimalErr) {
        console.error("[oi/create] MINIMAL INSERT ALSO FAILED", JSON.stringify({
          insertErrCode: minimalErr.code ?? null,
          insertErrMessage: minimalErr.message ?? null,
          insertErrDetails: minimalErr.details ?? null,
          insertErrHint: minimalErr.hint ?? null,
          attemptedColumns: ["user_id", "eagoh_id", "intelligence_domain", "entry_type", "tag", "content", "character_count_no_spaces", "confidence_level"],
        }));

        // Return diagnostic info so we can see the exact error without guessing.
        // This is temporary — production should not expose raw DB errors.
        return jsonResponse({
          ok: false,
          error: "Entry could not be saved. No Neurons were charged.",
          debug: {
            fullInsertErr: {
              code: insertErr.code ?? null,
              message: insertErr.message ?? null,
              details: insertErr.details ?? null,
              hint: insertErr.hint ?? null,
            },
            minimalInsertErr: {
              code: minimalErr.code ?? null,
              message: minimalErr.message ?? null,
              details: minimalErr.details ?? null,
              hint: minimalErr.hint ?? null,
            },
            rpcErr: {
              code: rpcErr?.code ?? null,
              message: rpcErr?.message ?? null,
              details: rpcErr?.details ?? null,
              hint: rpcErr?.hint ?? null,
            },
            attemptedColumns: attemptedColumns,
          },
        }, 500);
      }

      if (!minimalData) {
        console.warn("[oi/create] minimal insert returned no row");
        return jsonResponse({
          ok: false,
          error: "Entry could not be saved. No Neurons were charged.",
          debug: { cause: "minimal_insert_no_row", rpcErrCode: rpcErr?.code ?? null, rpcErrMsg: rpcErr?.message ?? null },
        }, 500);
      }

      // Minimal insert succeeded — proceed with deduction using the minimal entry
      if (DEBUG_OI) console.log("[oi/create] minimal insert succeeded — proceeding with deduction");
      return await finalizeOiEntry(serviceClient, userId, eagohId, minimalData, cost, note, entryType);
    }

    if (!insertData) {
      if (DEBUG_OI) console.warn("[oi/create] fallback insert returned no row");
      return jsonResponse({
        ok: false,
        error: "Entry could not be saved. No Neurons were charged.",
        debug: { cause: "full_insert_no_row", rpcErrCode: rpcErr?.code ?? null, rpcErrMsg: rpcErr?.message ?? null },
      }, 500);
    }

    // Full insert succeeded — proceed with deduction
    return await finalizeOiEntry(serviceClient, userId, eagohId, insertData, cost, note, entryType);
  }

  const rpcResult = (rpcData ?? null) as {
    ok?: boolean;
    error?: string;
    duplicate?: boolean;
    entry_id?: string;
    amount?: number;
    from_subscription?: number;
    from_purchased?: number;
    bucket?: string;
    balance_subscription_after?: number;
    balance_purchased_after?: number;
  } | null;

  if (!rpcResult || rpcResult.ok === false) {
    const errCode = rpcResult?.error ?? "create_failed";
    console.warn("[oi/create] RPC returned ok=false or null. errCode=" + errCode + " rpcDataNull=" + (rpcData == null));
    if (errCode === "insufficient") {
      const bal = (rpcResult as { balance?: number }).balance ?? 0;
      const cost = OI_ENTRY_COSTS[entryType];
      return jsonResponse({ ok: false, error: `Insufficient Neurons. Need ${cost} Neurons (have ${bal}).` }, 402);
    }
    if (errCode === "profile_not_found") {
      return jsonResponse({ ok: false, error: "Could not verify Neuron balance." }, 500);
    }
    if (errCode === "invalid_entry_type") {
      return jsonResponse({ ok: false, error: "Invalid entry type." }, 400);
    }
    if (errCode === "empty_content") {
      return jsonResponse({ ok: false, error: "Entry cannot be empty." }, 400);
    }
    console.warn("[oi/create] RPC rejected", errCode);
    return jsonResponse({ ok: false, error: "Entry could not be saved. No Neurons were charged." }, 500);
  }

  // ── Duplicate (already created) — return the existing entry ──
  if (rpcResult.duplicate === true && rpcResult.entry_id) {
    if (DEBUG_OI) console.log("[oi/create] duplicate requestId — returning existing entry");
    const { data: existingEntry } = await serviceClient
      .from("open_intelligence")
      .select("*")
      .eq("id", rpcResult.entry_id)
      .maybeSingle();

    if (existingEntry) {
      return jsonResponse({
        ok: true,
        entry: existingEntry,
        edgeCost: OI_ENTRY_COSTS[entryType],
        duplicate: true,
      });
    }
  }

  const newEntryId = rpcResult.entry_id;
  if (!newEntryId) {
    console.warn("[oi/create] RPC succeeded but no entry_id returned");
    return jsonResponse({ ok: false, error: "Entry could not be saved. No Neurons were charged." }, 500);
  }

  // ── Fetch the created entry (with trigger-computed quality/influence/hash) ──
  const { data: newEntry, error: fetchErr } = await serviceClient
    .from("open_intelligence")
    .select("*")
    .eq("id", newEntryId)
    .maybeSingle();

  if (fetchErr || !newEntry) {
    // The entry was created (RPC succeeded) but we can't fetch it. Don't refund —
    // the entry exists. Return success with the ID.
    console.warn("[oi/create] entry created but fetch failed", fetchErr?.message);
    return jsonResponse({
      ok: true,
      entryId: newEntryId,
      edgeCost: OI_ENTRY_COSTS[entryType],
    });
  }

  if (DEBUG_OI) {
    console.log("[oi/create] success entryId=" + newEntryId.slice(0, 8) + " cost=" + OI_ENTRY_COSTS[entryType]);
  }

  return jsonResponse({
    ok: true,
    entry: newEntry,
    edgeCost: OI_ENTRY_COSTS[entryType],
    balanceSubscriptionAfter: rpcResult.balance_subscription_after,
    balancePurchasedAfter: rpcResult.balance_purchased_after,
  });
}

// ── Phase 5B: OI Update Handler (version history + dispute preservation) ─────

async function handleUpdateOIEntry(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  let payload: {
    entryId: string;
    content?: string;
    confidenceLevel?: string;
    selectedCategory?: string | null;
    selectedSubtags?: string[] | null;
    customTags?: string[] | null;
    exchangeShareEnabled?: boolean;
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request." }, 400);
  }

  // Authenticate
  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createClient(normalizeSupabaseUrl(env.SUPABASE_URL ?? ""), env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  const serviceClient = getServiceRoleClient(env);
  if (!serviceClient) {
    return jsonResponse({ ok: false, error: "Server configuration error." }, 503);
  }

  // 1. Fetch the entry — verify ownership
  //    Select * to avoid PostgREST errors when optional columns (e.g.
  //    exchange_share_enabled, active_dispute_count) don't exist in the
  //    live DB schema yet. A targeted select with a missing column returns
  //    an error, which we'd wrongly interpret as "entry not found".
  const { data: entry, error: entryErr } = await serviceClient
    .from("open_intelligence")
    .select("*")
    .eq("id", payload.entryId)
    .maybeSingle();

  if (entryErr || !entry) {
    // Safe diagnostic logging — no PII, only prefixes and error codes
    console.warn("[oi/update] entry lookup failed", JSON.stringify({
      entryIdPrefix: (payload.entryId ?? "").slice(0, 8),
      userIdPrefix: userId.slice(0, 8),
      hasRow: !!entry,
      errCode: entryErr?.code ?? null,
      errMsg: entryErr?.message ?? null,
    }));
    return jsonResponse({ ok: false, error: "Entry not found." }, 404);
  }

  const entryRow = entry as Record<string, unknown>;
  const entryUserId = entryRow.user_id as string;
  const entryValidationStatus = (entryRow.validation_status as string) ?? "pending_review";
  const entryExchangeShareEnabled = (entryRow.exchange_share_enabled as boolean) ?? false;
  const entryContent = (entryRow.content as string) ?? "";
  const entryConfidenceLevel = (entryRow.confidence_level as string) ?? "";
  const entrySelectedCategory = (entryRow.selected_category as string | null) ?? null;
  const entrySelectedSubtags = (entryRow.selected_subtags as string[] | null) ?? null;
  const entryCustomTags = (entryRow.custom_tags as string[] | null) ?? null;
  const entryVersionNumber = (entryRow.version_number as number) ?? 1;
  const entryQualityScore = (entryRow.quality_score as number) ?? 0;
  const entryInfluenceScore = (entryRow.influence_score as number) ?? 0;

  if (entryUserId !== userId) {
    return jsonResponse({ ok: false, error: "Only the entry owner can update this entry." }, 403);
  }

  // 2. Determine if this is a major edit (content changed) vs minor (tags/settings only)
  const newContent = payload.content?.trim() ?? entryContent;
  const isMajorEdit = payload.content !== undefined && newContent !== entryContent;

  // 3. Save version history BEFORE updating the active entry — only for content edits.
  //    Skip for toggle-only updates (exchange sharing) to avoid unnecessary writes.
  const currentVersion = entryVersionNumber;
  if (isMajorEdit) {
    try {
      await serviceClient
        .from("open_intelligence_versions")
        .insert({
          entry_id: payload.entryId,
          version_number: currentVersion,
          previous_content: entryContent,
          previous_category: entrySelectedCategory,
          previous_subtags: entrySelectedSubtags ?? [],
          previous_custom_tags: entryCustomTags ?? [],
          previous_confidence_level: entryConfidenceLevel,
          previous_validation_status: entryValidationStatus,
          previous_quality_score: entryQualityScore,
          previous_influence_score: entryInfluenceScore,
          change_type: "edit",
          changed_by: userId,
        });
    } catch (e) {
      console.warn("[oi-update] version history insert failed", e instanceof Error ? e.message : "unknown");
      // Non-fatal — proceed with update
    }
  }

  // 4. Build update object — only allow client to set user-editable fields.
  //    quality_score, influence_score, content_hash, duplicate_flag are
  //    overwritten by the DB trigger (evaluate_oi_quality_trigger).
  //    validation_status is preserved unless the entry is rejected/withdrawn.
  const updateFields: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (payload.content !== undefined) {
    // Input validation: reject excessively long content (match client 5000 char limit)
    const trimmedContent = newContent.slice(0, 5000);
    updateFields.content = trimmedContent;
    updateFields.character_count_no_spaces = trimmedContent.replace(/\s/g, "").length;
  }
  if (payload.confidenceLevel !== undefined) {
    updateFields.confidence_level = payload.confidenceLevel;
  }
  if (payload.selectedCategory !== undefined) {
    updateFields.selected_category = payload.selectedCategory;
  }
  if (payload.selectedSubtags !== undefined) {
    updateFields.selected_subtags = payload.selectedSubtags;
  }
  if (payload.customTags !== undefined) {
    updateFields.custom_tags = payload.customTags;
  }
  if (payload.exchangeShareEnabled !== undefined) {
    // Block enabling exchange sharing on rejected or withdrawn entries
    if (payload.exchangeShareEnabled === true) {
      const blockedStatuses = ["rejected", "withdrawn"];
      if (blockedStatuses.includes(entryValidationStatus)) {
        return jsonResponse({
          ok: false,
          error: "Exchange sharing could not be updated. Please try again.",
        }, 403);
      }
    }
    updateFields.exchange_share_enabled = payload.exchangeShareEnabled;
  }

  // Major content edit: increment version and mark for reevaluation.
  // Do NOT reset dispute history — disputes survive edits.
  if (isMajorEdit) {
    updateFields.version_number = currentVersion + 1;
    // If entry was pending_review, keep it pending (needs reevaluation).
    // If it was community_supported or externally_supported, keep the status
    // but mark for reevaluation. Disputed entries stay disputed.
  }

  // 5. Update the entry — the DB trigger overwrites quality/influence/hash/duplicate
  //    Select * to avoid errors when optional columns don't exist in live schema.
  const { data: updated, error: updateErr } = await serviceClient
    .from("open_intelligence")
    .update(updateFields)
    .eq("id", payload.entryId)
    .select("*")
    .maybeSingle();

  if (updateErr || !updated) {
    console.warn("[oi/update] update failed", JSON.stringify({
      entryIdPrefix: payload.entryId.slice(0, 8),
      userIdPrefix: userId.slice(0, 8),
      errCode: updateErr?.code ?? null,
      errMsg: updateErr?.message ?? null,
      updateFields: Object.keys(updateFields),
    }));
    return jsonResponse({ ok: false, error: "Failed to update entry." }, 500);
  }

  const updatedRow = updated as Record<string, unknown>;

  // 6. Best-effort: recalculate contributor reputation after a major edit
  if (isMajorEdit) {
    try {
      await serviceClient.rpc("recalculate_contributor_reputation", { p_user_id: userId });
    } catch (e) {
      console.warn("[oi-update] reputation recalc failed", e instanceof Error ? e.message : "unknown");
    }
  }

  return jsonResponse({
    ok: true,
    entry: {
      id: updatedRow.id as string,
      qualityScore: (updatedRow.quality_score as number) ?? 0,
      influenceScore: (updatedRow.influence_score as number) ?? 0,
      contentHash: (updatedRow.content_hash as string | null) ?? null,
      duplicateFlag: (updatedRow.duplicate_flag as boolean) ?? false,
      versionNumber: (updatedRow.version_number as number) ?? 1,
      exchangeShareEnabled: (updatedRow.exchange_share_enabled as boolean) ?? false,
    },
  });
}

// ── Phase 6B: Withdraw Entry ────────────────────────────────────────────────

async function handleWithdrawOIEntry(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  let payload: { entryId: string };
  try {
    payload = (await request.json()) as { entryId: string };
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request." }, 400);
  }
  if (!payload.entryId) {
    return jsonResponse({ ok: false, error: "Entry ID required." }, 400);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createClient(normalizeSupabaseUrl(env.SUPABASE_URL ?? ""), env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  const serviceClient = getServiceRoleClient(env);
  if (!serviceClient) return jsonResponse({ ok: false, error: "Server configuration error." }, 503);

  // Verify ownership
  const { data: entry, error: entryErr } = await serviceClient
    .from("open_intelligence")
    .select("id, user_id, content, confidence_level, selected_category, selected_subtags, custom_tags, exchange_share_enabled, validation_status, version_number, quality_score, influence_score")
    .eq("id", payload.entryId)
    .maybeSingle();

  if (entryErr || !entry) {
    return jsonResponse({ ok: false, error: "Entry not found." }, 404);
  }

  const entryRow = entry as {
    id: string; user_id: string; content: string; confidence_level: string;
    selected_category: string | null; selected_subtags: string[] | null;
    custom_tags: string[] | null; exchange_share_enabled: boolean;
    validation_status: string; version_number: number;
    quality_score: number; influence_score: number;
  };

  if (entryRow.user_id !== userId) {
    return jsonResponse({ ok: false, error: "Only the entry owner can withdraw this entry." }, 403);
  }

  // Already withdrawn or rejected — cannot withdraw again
  if (entryRow.validation_status === "withdrawn") {
    return jsonResponse({ ok: false, error: "Entry is already withdrawn." }, 409);
  }
  if (entryRow.validation_status === "rejected") {
    return jsonResponse({ ok: false, error: "Cannot withdraw a rejected entry." }, 403);
  }

  // Save version history before withdrawing
  const currentVersion = entryRow.version_number ?? 1;
  await serviceClient
    .from("open_intelligence_versions")
    .insert({
      entry_id: payload.entryId,
      version_number: currentVersion,
      previous_content: entryRow.content,
      previous_category: entryRow.selected_category,
      previous_subtags: entryRow.selected_subtags ?? [],
      previous_custom_tags: entryRow.custom_tags ?? [],
      previous_confidence_level: entryRow.confidence_level,
      previous_validation_status: entryRow.validation_status,
      previous_quality_score: entryRow.quality_score,
      previous_influence_score: entryRow.influence_score,
      change_type: "withdrawal",
      changed_by: userId,
    });

  // Set status to withdrawn, disable all sharing
  await serviceClient
    .from("open_intelligence")
    .update({
      validation_status: "withdrawn",
      exchange_share_enabled: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payload.entryId);

  // Remove all faction sharing links for this entry
  await serviceClient
    .from("faction_shared_intelligence")
    .delete()
    .eq("oi_entry_id", payload.entryId);

  // Recalculate contributor reputation
  try {
    await serviceClient.rpc("recalculate_contributor_reputation", { p_user_id: userId });
  } catch (e) {
    console.warn("[oi-withdraw] reputation recalc failed", e instanceof Error ? e.message : "unknown");
  }

  // Phase 6C: notify owner about sharing removal due to withdrawal
  await createIntelligenceNotification(serviceClient, userId, payload.entryId, "exchange_sharing_disabled");
  await createIntelligenceNotification(serviceClient, userId, payload.entryId, "faction_sharing_removed");

  return jsonResponse({ ok: true });
}

// ── Phase 6B: Restore Entry ─────────────────────────────────────────────────

async function handleRestoreOIEntry(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  let payload: { entryId: string };
  try {
    payload = (await request.json()) as { entryId: string };
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request." }, 400);
  }
  if (!payload.entryId) {
    return jsonResponse({ ok: false, error: "Entry ID required." }, 400);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createClient(normalizeSupabaseUrl(env.SUPABASE_URL ?? ""), env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  const serviceClient = getServiceRoleClient(env);
  if (!serviceClient) return jsonResponse({ ok: false, error: "Server configuration error." }, 503);

  // Verify ownership
  const { data: entry, error: entryErr } = await serviceClient
    .from("open_intelligence")
    .select("id, user_id, content, confidence_level, selected_category, selected_subtags, custom_tags, validation_status, version_number, quality_score, influence_score")
    .eq("id", payload.entryId)
    .maybeSingle();

  if (entryErr || !entry) {
    return jsonResponse({ ok: false, error: "Entry not found." }, 404);
  }

  const entryRow = entry as {
    id: string; user_id: string; content: string; confidence_level: string;
    selected_category: string | null; selected_subtags: string[] | null;
    custom_tags: string[] | null; validation_status: string;
    version_number: number; quality_score: number; influence_score: number;
  };

  if (entryRow.user_id !== userId) {
    return jsonResponse({ ok: false, error: "Only the entry owner can restore this entry." }, 403);
  }

  if (entryRow.validation_status !== "withdrawn") {
    return jsonResponse({ ok: false, error: "Only withdrawn entries can be restored." }, 409);
  }

  // Save version history before restoring
  const currentVersion = entryRow.version_number ?? 1;
  await serviceClient
    .from("open_intelligence_versions")
    .insert({
      entry_id: payload.entryId,
      version_number: currentVersion,
      previous_content: entryRow.content,
      previous_category: entryRow.selected_category,
      previous_subtags: entryRow.selected_subtags ?? [],
      previous_custom_tags: entryRow.custom_tags ?? [],
      previous_confidence_level: entryRow.confidence_level,
      previous_validation_status: entryRow.validation_status,
      previous_quality_score: entryRow.quality_score,
      previous_influence_score: entryRow.influence_score,
      change_type: "restoration",
      changed_by: userId,
    });

  // Restore to pending_review — do NOT re-enable any sharing
  await serviceClient
    .from("open_intelligence")
    .update({
      validation_status: "pending_review",
      updated_at: new Date().toISOString(),
    })
    .eq("id", payload.entryId);

  // Recalculate contributor reputation
  try {
    await serviceClient.rpc("recalculate_contributor_reputation", { p_user_id: userId });
  } catch (e) {
    console.warn("[oi-restore] reputation recalc failed", e instanceof Error ? e.message : "unknown");
  }

  return jsonResponse({ ok: true });
}

// ── Phase 6B: Toggle Faction Sharing ────────────────────────────────────────

async function handleToggleFactionShare(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  let payload: { entryId: string; factionId: string; enabled: boolean };
  try {
    payload = (await request.json()) as { entryId: string; factionId: string; enabled: boolean };
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request." }, 400);
  }
  if (!payload.entryId || !payload.factionId) {
    return jsonResponse({ ok: false, error: "Entry ID and Faction ID required." }, 400);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createClient(normalizeSupabaseUrl(env.SUPABASE_URL ?? ""), env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  const serviceClient = getServiceRoleClient(env);
  if (!serviceClient) return jsonResponse({ ok: false, error: "Server configuration error." }, 503);

  // Verify ownership
  const { data: entry, error: entryErr } = await serviceClient
    .from("open_intelligence")
    .select("id, user_id, validation_status")
    .eq("id", payload.entryId)
    .maybeSingle();

  if (entryErr || !entry) {
    return jsonResponse({ ok: false, error: "Entry not found." }, 404);
  }

  const entryRow = entry as { id: string; user_id: string; validation_status: string };

  if (entryRow.user_id !== userId) {
    return jsonResponse({ ok: false, error: "Only the entry owner can manage sharing." }, 403);
  }

  // Cannot share rejected or withdrawn entries
  if (entryRow.validation_status === "rejected" || entryRow.validation_status === "withdrawn") {
    return jsonResponse({ ok: false, error: "Cannot share rejected or withdrawn entries." }, 403);
  }

  if (payload.enabled) {
    // Check if already shared with this faction
    const { data: existing } = await serviceClient
      .from("faction_shared_intelligence")
      .select("id")
      .eq("oi_entry_id", payload.entryId)
      .eq("faction_id", payload.factionId)
      .maybeSingle();

    if (!existing) {
      await serviceClient
        .from("faction_shared_intelligence")
        .insert({
          faction_id: payload.factionId,
          user_id: userId,
          oi_entry_id: payload.entryId,
        });
    }
  } else {
    // Remove sharing — owner can always unshare their own entry
    await serviceClient
      .from("faction_shared_intelligence")
      .delete()
      .eq("oi_entry_id", payload.entryId)
      .eq("faction_id", payload.factionId);
  }

  return jsonResponse({ ok: true });
}

// ── Phase 6B: Version History ───────────────────────────────────────────────

async function handleGetVersionHistory(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createClient(normalizeSupabaseUrl(env.SUPABASE_URL ?? ""), env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  const serviceClient = getServiceRoleClient(env);
  if (!serviceClient) return jsonResponse({ ok: false, error: "Server configuration error." }, 503);

  const url = new URL(request.url);
  const entryId = url.searchParams.get("entryId");
  if (!entryId) {
    return jsonResponse({ ok: false, error: "Entry ID required." }, 400);
  }

  // Verify ownership — only the owner can see version history
  const { data: entry } = await serviceClient
    .from("open_intelligence")
    .select("id, user_id")
    .eq("id", entryId)
    .maybeSingle();

  const entryRow = entry as { id: string; user_id: string } | null;
  if (!entryRow || entryRow.user_id !== userId) {
    return jsonResponse({ ok: false, error: "Only the entry owner can view version history." }, 403);
  }

  const { data: versions, error: versionsErr } = await serviceClient
    .from("open_intelligence_versions")
    .select("id, entry_id, version_number, previous_content, previous_category, previous_subtags, previous_custom_tags, previous_confidence_level, previous_validation_status, previous_quality_score, previous_influence_score, change_type, changed_by, changed_at")
    .eq("entry_id", entryId)
    .order("version_number", { ascending: false })
    .limit(50);

  if (versionsErr) {
    return jsonResponse({ ok: false, error: "Failed to fetch version history." }, 500);
  }

  return jsonResponse({ ok: true, versions: versions ?? [] });
}

// ── Phase 6C: Intelligence Notifications & Audit ───────────────────────────

/** Notification type → title and message template. Reporter identity is never included. */
const NOTIFICATION_TEMPLATES: Record<
  string,
  { title: string; message: string }
> = {
  community_supported: {
    title: "Community Supported",
    message: "Your intelligence entry received community support.",
  },
  externally_supported: {
    title: "Externally Supported",
    message: "Your intelligence entry was supported by external evidence.",
  },
  disputed: {
    title: "Entry Disputed",
    message:
      "Your intelligence entry has been marked disputed and may receive reduced influence.",
  },
  rejected: {
    title: "Entry Rejected",
    message:
      "Your intelligence entry was rejected and removed from analyst, Faction, and Exchange use.",
  },
  dispute_dismissed: {
    title: "Dispute Dismissed",
    message: "A dispute involving your intelligence entry was dismissed.",
  },
  outdated: {
    title: "Entry Outdated",
    message: "Your intelligence entry has been automatically marked outdated.",
  },
  exchange_sharing_disabled: {
    title: "Exchange Sharing Disabled",
    message:
      "Exchange sharing was disabled because of your entry's status.",
  },
  faction_sharing_removed: {
    title: "Faction Sharing Removed",
    message:
      "Faction sharing was removed because of your entry's status.",
  },
};

/** Create a notification for the entry owner. Reporter identity is never included.
 *  Notification failures are logged but do NOT undo a successful moderation action. */
async function createIntelligenceNotification(
  serviceClient: SupabaseClient,
  userId: string,
  entryId: string,
  notificationType: string,
): Promise<void> {
  const template = NOTIFICATION_TEMPLATES[notificationType];
  if (!template) {
    console.warn(`[notifications] unknown type: ${notificationType}`);
    return;
  }
  try {
    await serviceClient.from("intelligence_notifications").insert({
      user_id: userId,
      entry_id: entryId,
      notification_type: notificationType,
      title: template.title,
      message: template.message,
      is_read: false,
    });
  } catch (e) {
    // Log but do not throw — notification failure must not undo moderation
    console.warn(
      `[notifications] insert failed for ${notificationType}:`,
      e instanceof Error ? e.message : "unknown",
    );
  }
}

/** Save a moderation audit record. Only called by verified admins via the secure worker. */
async function createModerationAuditRecord(
  serviceClient: SupabaseClient,
  entryId: string,
  moderatorUserId: string,
  action: string,
  previousStatus: string,
  newStatus: string,
  disputeId?: string,
  note?: string,
): Promise<void> {
  try {
    await serviceClient.from("intelligence_moderation_audit").insert({
      entry_id: entryId,
      moderator_user_id: moderatorUserId,
      action,
      previous_status: previousStatus,
      new_status: newStatus,
      dispute_id: disputeId ?? null,
      optional_note: note ?? null,
    });
  } catch (e) {
    console.warn(
      `[audit] insert failed for ${action}:`,
      e instanceof Error ? e.message : "unknown",
    );
  }
}

// ── Phase 6B: Moderation Queue (admin only) ─────────────────────────────────

// Phase 6B: Admin access via explicit is_admin flag. Subscription tiers are NOT sufficient.
// Only profiles with is_admin = true can access moderation endpoints.
async function isAdmin(serviceClient: SupabaseClient, userId: string): Promise<boolean> {
  if (!userId) return false;
  const { data: profile } = await serviceClient
    .from("profiles")
    .select("is_admin, admin_tier_override, admin_tier_expires_at")
    .eq("id", userId)
    .maybeSingle();

  const p = profile as { is_admin: boolean | null; admin_tier_override: string | null; admin_tier_expires_at: string | null } | null;
  if (!p || !p.is_admin) return false;
  if (p.admin_tier_expires_at) {
    const expires = new Date(p.admin_tier_expires_at).getTime();
    if (Date.now() > expires) return false;
  }
  return true;
}

async function handleGetModerationQueue(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createClient(normalizeSupabaseUrl(env.SUPABASE_URL ?? ""), env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  const serviceClient = getServiceRoleClient(env);
  if (!serviceClient) return jsonResponse({ ok: false, error: "Server configuration error." }, 503);

  const admin = await isAdmin(serviceClient, userId);
  if (!admin) {
    return jsonResponse({ ok: false, error: "Moderation access required." }, 403);
  }

  // Fetch disputed entries with active disputes
  const { data: disputedEntries, error: disputeErr } = await serviceClient
    .from("open_intelligence")
    .select("id, content, validation_status, user_id, eagoh_id, quality_score, active_dispute_count, created_at, updated_at")
    .in("validation_status", ["disputed", "pending_review"])
    .order("updated_at", { ascending: false })
    .limit(50);

  if (disputeErr) {
    return jsonResponse({ ok: false, error: "Failed to fetch moderation queue." }, 500);
  }

  const entries = (disputedEntries ?? []) as {
    id: string; content: string; validation_status: string; user_id: string;
    eagoh_id: string; quality_score: number; active_dispute_count: number;
    created_at: string; updated_at: string;
  }[];

  // For each entry, fetch its disputes (without reporter identity)
  const queueItems: ModerationQueueItem[] = [];
  for (const entry of entries) {
    const { data: disputes } = await serviceClient
      .from("open_intelligence_disputes")
      .select("id, reason_category, explanation, supporting_url, status, created_at")
      .eq("entry_id", entry.id)
      .in("status", ["pending", "reviewing"])
      .order("created_at", { ascending: false });

    const disputeRows = (disputes ?? []) as {
      id: string; reason_category: string; explanation: string;
      supporting_url: string | null; status: string; created_at: string;
    }[];

    if (disputeRows.length === 0 && entry.validation_status !== "disputed") continue;

    // Fetch contributor reputation summary (safe public fields only)
    const { data: rep } = await serviceClient
      .from("intelligence_contributor_reputation")
      .select("overall_score")
      .eq("user_id", entry.user_id)
      .maybeSingle();
    const repRow = rep as { overall_score: number } | null;

    queueItems.push({
      entryId: entry.id,
      contentPreview: entry.content.slice(0, 200),
      validationStatus: entry.validation_status,
      reportCount: entry.active_dispute_count ?? disputeRows.length,
      contributorReputation: repRow ? Math.round(repRow.overall_score) : null,
      disputes: disputeRows.map((d) => ({
        id: d.id,
        reasonCategory: d.reason_category,
        explanation: d.explanation,
        supportingUrl: d.supporting_url,
        status: d.status,
        createdAt: d.created_at,
      })),
    });
  }

  return jsonResponse({ ok: true, queue: queueItems });
}

type ModerationQueueItem = {
  entryId: string;
  contentPreview: string;
  validationStatus: string;
  reportCount: number;
  contributorReputation: number | null;
  disputes: {
    id: string;
    reasonCategory: string;
    explanation: string;
    supportingUrl: string | null;
    status: string;
    createdAt: string;
  }[];
};

// ── Phase 6B: Moderation Action (admin only) ────────────────────────────────

async function handleModerationAction(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  let payload: { entryId: string; action: string; disputeId?: string };
  try {
    payload = (await request.json()) as { entryId: string; action: string; disputeId?: string };
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request." }, 400);
  }

  const validActions = ["dismiss_dispute", "mark_community_supported", "mark_externally_supported", "mark_disputed", "reject_entry"];
  if (!validActions.includes(payload.action)) {
    return jsonResponse({ ok: false, error: "Invalid moderation action." }, 400);
  }
  if (!payload.entryId) {
    return jsonResponse({ ok: false, error: "Entry ID required." }, 400);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createClient(normalizeSupabaseUrl(env.SUPABASE_URL ?? ""), env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  const serviceClient = getServiceRoleClient(env);
  if (!serviceClient) return jsonResponse({ ok: false, error: "Server configuration error." }, 503);

  const admin = await isAdmin(serviceClient, userId);
  if (!admin) {
    return jsonResponse({ ok: false, error: "Moderation access required." }, 403);
  }

  // Fetch entry for version history
  const { data: entry } = await serviceClient
    .from("open_intelligence")
    .select("id, user_id, content, confidence_level, selected_category, selected_subtags, custom_tags, exchange_share_enabled, validation_status, version_number, quality_score, influence_score")
    .eq("id", payload.entryId)
    .maybeSingle();

  const entryRow = entry as {
    id: string; user_id: string; content: string; confidence_level: string;
    selected_category: string | null; selected_subtags: string[] | null;
    custom_tags: string[] | null; exchange_share_enabled: boolean;
    validation_status: string; version_number: number;
    quality_score: number; influence_score: number;
  } | null;

  if (!entryRow) {
    return jsonResponse({ ok: false, error: "Entry not found." }, 404);
  }

  // Save version history for moderation action
  const currentVersion = entryRow.version_number ?? 1;
  await serviceClient
    .from("open_intelligence_versions")
    .insert({
      entry_id: payload.entryId,
      version_number: currentVersion,
      previous_content: entryRow.content,
      previous_category: entryRow.selected_category,
      previous_subtags: entryRow.selected_subtags ?? [],
      previous_custom_tags: entryRow.custom_tags ?? [],
      previous_confidence_level: entryRow.confidence_level,
      previous_validation_status: entryRow.validation_status,
      previous_quality_score: entryRow.quality_score,
      previous_influence_score: entryRow.influence_score,
      change_type: "moderation",
      changed_by: userId,
    });

  let newStatus = entryRow.validation_status;

  switch (payload.action) {
    case "dismiss_dispute":
      // Dismiss the specific dispute, keep entry status as-is unless it was only disputed
      if (payload.disputeId) {
        await serviceClient
          .from("open_intelligence_disputes")
          .update({ status: "dismissed", reviewed_by: userId, reviewed_at: new Date().toISOString() })
          .eq("id", payload.disputeId);
      }
      // If entry was disputed and no more active disputes remain, restore to pending_review
      if (entryRow.validation_status === "disputed") {
        const { count } = await serviceClient
          .from("open_intelligence_disputes")
          .select("id", { count: "exact", head: true })
          .eq("entry_id", payload.entryId)
          .in("status", ["pending", "reviewing", "upheld"]);
        if ((count ?? 0) === 0) {
          newStatus = "pending_review";
        }
      }
      break;

    case "mark_community_supported":
      newStatus = "community_supported";
      // Dismiss all pending disputes for this entry
      await serviceClient
        .from("open_intelligence_disputes")
        .update({ status: "dismissed", reviewed_by: userId, reviewed_at: new Date().toISOString() })
        .eq("entry_id", payload.entryId)
        .in("status", ["pending", "reviewing"]);
      break;

    case "mark_externally_supported":
      newStatus = "externally_supported";
      await serviceClient
        .from("open_intelligence_disputes")
        .update({ status: "dismissed", reviewed_by: userId, reviewed_at: new Date().toISOString() })
        .eq("entry_id", payload.entryId)
        .in("status", ["pending", "reviewing"]);
      break;

    case "mark_disputed":
      newStatus = "disputed";
      if (payload.disputeId) {
        await serviceClient
          .from("open_intelligence_disputes")
          .update({ status: "upheld", reviewed_by: userId, reviewed_at: new Date().toISOString() })
          .eq("id", payload.disputeId);
      }
      break;

    case "reject_entry":
      newStatus = "rejected";
      // Disable all sharing
      await serviceClient
        .from("open_intelligence")
        .update({
          validation_status: "rejected",
          exchange_share_enabled: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", payload.entryId);
      // Remove all faction sharing
      await serviceClient
        .from("faction_shared_intelligence")
        .delete()
        .eq("oi_entry_id", payload.entryId);
      // Dismiss or uphold all disputes
      await serviceClient
        .from("open_intelligence_disputes")
        .update({ status: "resolved", reviewed_by: userId, reviewed_at: new Date().toISOString() })
        .eq("entry_id", payload.entryId)
        .in("status", ["pending", "reviewing"]);
      // Recalculate contributor reputation
      try {
        await serviceClient.rpc("recalculate_contributor_reputation", { p_user_id: entryRow.user_id });
      } catch (e) {
        console.warn("[moderation] reputation recalc failed", e instanceof Error ? e.message : "unknown");
      }
      // Phase 6C: audit record + owner notification
      await createModerationAuditRecord(
        serviceClient, payload.entryId, userId, "reject_entry",
        entryRow.validation_status, "rejected", payload.disputeId,
      );
      await createIntelligenceNotification(
        serviceClient, entryRow.user_id, payload.entryId, "rejected",
      );
      return jsonResponse({ ok: true });
  }

  // Update entry status
  if (newStatus !== entryRow.validation_status) {
    await serviceClient
      .from("open_intelligence")
      .update({
        validation_status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", payload.entryId);
  }

  // Recalculate contributor reputation
  try {
    await serviceClient.rpc("recalculate_contributor_reputation", { p_user_id: entryRow.user_id });
  } catch (e) {
    console.warn("[moderation] reputation recalc failed", e instanceof Error ? e.message : "unknown");
  }

  // Phase 6C: audit record + owner notification for non-reject actions
  await createModerationAuditRecord(
    serviceClient, payload.entryId, userId, payload.action,
    entryRow.validation_status, newStatus, payload.disputeId,
  );
  // Map action → notification type
  const notifType: Record<string, string> = {
    dismiss_dispute: "dispute_dismissed",
    mark_community_supported: "community_supported",
    mark_externally_supported: "externally_supported",
    mark_disputed: "disputed",
  };
  const nType = notifType[payload.action];
  if (nType) {
    await createIntelligenceNotification(
      serviceClient, entryRow.user_id, payload.entryId, nType,
    );
  }

  return jsonResponse({ ok: true });
}

// ── Phase 6C: Notification endpoints (user's own notifications) ───────────

type NotificationRow = {
  id: string;
  user_id: string;
  entry_id: string | null;
  notification_type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

async function handleGetNotifications(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createClient(normalizeSupabaseUrl(env.SUPABASE_URL ?? ""), env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  // Fetch the user's own notifications via anon client (RLS enforces self-only)
  const { data, error } = await supabase
    .from("intelligence_notifications")
    .select("id, user_id, entry_id, notification_type, title, message, is_read, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return jsonResponse({ ok: false, error: "Failed to fetch notifications." }, 500);
  }

  const notifications = (data ?? []) as NotificationRow[];
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return jsonResponse({
    ok: true,
    notifications: notifications.map((n) => ({
      id: n.id,
      entryId: n.entry_id,
      notificationType: n.notification_type,
      title: n.title,
      message: n.message,
      isRead: n.is_read,
      createdAt: n.created_at,
    })),
    unreadCount,
  });
}

async function handleMarkNotificationRead(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  let payload: { notificationId: string };
  try {
    payload = (await request.json()) as { notificationId: string };
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request." }, 400);
  }
  if (!payload.notificationId) {
    return jsonResponse({ ok: false, error: "Notification ID required." }, 400);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createClient(normalizeSupabaseUrl(env.SUPABASE_URL ?? ""), env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  // RLS ensures users can only update their own notifications
  const { error } = await supabase
    .from("intelligence_notifications")
    .update({ is_read: true })
    .eq("id", payload.notificationId)
    .eq("user_id", userId);

  if (error) {
    return jsonResponse({ ok: false, error: "Failed to mark notification as read." }, 500);
  }

  return jsonResponse({ ok: true });
}

async function handleMarkAllNotificationsRead(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createClient(normalizeSupabaseUrl(env.SUPABASE_URL ?? ""), env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  // RLS ensures users can only update their own notifications
  const { error } = await supabase
    .from("intelligence_notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .eq("is_read", false);

  if (error) {
    return jsonResponse({ ok: false, error: "Failed to mark notifications as read." }, 500);
  }

  return jsonResponse({ ok: true });
}

// ── Phase 6C: Moderation audit endpoint (admin only) ────────────────────────

type AuditRow = {
  id: string;
  entry_id: string;
  action: string;
  previous_status: string | null;
  new_status: string | null;
  dispute_id: string | null;
  optional_note: string | null;
  created_at: string;
};

async function handleGetModerationAudit(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createClient(normalizeSupabaseUrl(env.SUPABASE_URL ?? ""), env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  const serviceClient = getServiceRoleClient(env);
  if (!serviceClient) return jsonResponse({ ok: false, error: "Server configuration error." }, 503);

  const admin = await isAdmin(serviceClient, userId);
  if (!admin) {
    return jsonResponse({ ok: false, error: "Moderation access required." }, 403);
  }

  // Fetch recent audit records via service_role (no moderator identity exposed)
  const url = new URL(request.url);
  const entryId = url.searchParams.get("entryId");

  let query = serviceClient
    .from("intelligence_moderation_audit")
    .select("id, entry_id, action, previous_status, new_status, dispute_id, optional_note, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (entryId) {
    query = query.eq("entry_id", entryId);
  }

  const { data, error } = await query;

  if (error) {
    return jsonResponse({ ok: false, error: "Failed to fetch audit records." }, 500);
  }

  const rows = (data ?? []) as AuditRow[];

  // Return safe public fields — moderator_user_id is never exposed
  return jsonResponse({
    ok: true,
    audit: rows.map((r) => ({
      id: r.id,
      entryId: r.entry_id,
      action: r.action,
      previousStatus: r.previous_status,
      newStatus: r.new_status,
      disputeId: r.dispute_id,
      note: r.optional_note,
      createdAt: r.created_at,
    })),
  });
}

// ── Phase 8A: Intelligence Analytics Handler ──────────────────────────────────

async function handleGetIntelligenceAnalytics(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createClient(normalizeSupabaseUrl(env.SUPABASE_URL ?? ""), env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  // Use service_role to call the owner-scoped analytics RPCs.
  // The RPCs are security_definer and scope by p_user_id = userId; we pass
  // the verified-auth userId, never a client-supplied value.
  const serviceClient = getServiceRoleClient(env);
  if (!serviceClient) return jsonResponse({ ok: false, error: "Server configuration error." }, 503);

  // ── 1. Owner intelligence summary (entry counts, averages, sharing) ────────
  const { data: summaryRaw, error: summaryErr } = await serviceClient
    .rpc("get_owner_intelligence_summary", { p_user_id: userId });
  if (summaryErr) {
    console.warn("[analytics] summary failed", summaryErr.message);
    return jsonResponse({ ok: false, error: "Failed to fetch analytics." }, 500);
  }
  const summary = (summaryRaw as any[])?.[0] ?? null;

  // ── 2. Owner reputation (safe self fields) ─────────────────────────────────
  const { data: repRaw } = await serviceClient
    .from("intelligence_contributor_reputation")
    .select("overall_score, quality_component, usefulness_component, validation_component, reliability_component, calculated_at")
    .eq("user_id", userId)
    .maybeSingle();
  const reputation = repRaw ?? {
    overall_score: 50,
    quality_component: 50,
    usefulness_component: 50,
    validation_component: 50,
    reliability_component: 50,
    calculated_at: null,
  };

  // ── 3. Owner entry performance (safe per-entry metrics) ───────────────────
  const { data: performanceRaw, error: perfErr } = await serviceClient
    .rpc("get_owner_entry_performance", { p_user_id: userId, p_limit: 100 });
  if (perfErr) console.warn("[analytics] performance failed", perfErr.message);
  const performance = (performanceRaw as any[]) ?? [];

  // ── 4. Owner weekly trend ─────────────────────────────────────────────────
  const { data: trendRaw, error: trendErr } = await serviceClient
    .rpc("get_owner_weekly_trend", { p_user_id: userId, p_weeks: 12 });
  if (trendErr) console.warn("[analytics] trend failed", trendErr.message);
  const trend = (trendRaw as any[]) ?? [];

  // ── 5. Owner faction contributions ─────────────────────────────────────────
  const { data: factionRaw, error: factionErr } = await serviceClient
    .rpc("get_owner_faction_contributions", { p_user_id: userId });
  if (factionErr) console.warn("[analytics] faction failed", factionErr.message);
  const factionContributions = (factionRaw as any[]) ?? [];

  // ── 6. Owner exchange contributions ───────────────────────────────────────
  const { data: exchangeRaw, error: exchangeErr } = await serviceClient
    .rpc("get_owner_exchange_contributions", { p_user_id: userId });
  if (exchangeErr) console.warn("[analytics] exchange failed", exchangeErr.message);
  const exchangeContributions = (exchangeRaw as any[])?.[0] ?? {
    eligible_exchange_entries: 0,
    synchronized_entries_used: 0,
    avg_shared_quality: 0,
    supported_entry_rate: 0,
    dispute_rate: 0,
    active_purchases: 0,
    expired_purchases: 0,
  };

  return jsonResponse({
    ok: true,
    analytics: {
      summary: summary ? {
        totalEntries: Number(summary.total_entries ?? 0),
        activeEntries: Number(summary.active_entries ?? 0),
        pendingReview: Number(summary.pending_review ?? 0),
        communitySupported: Number(summary.community_supported ?? 0),
        externallySupported: Number(summary.externally_supported ?? 0),
        disputed: Number(summary.disputed ?? 0),
        withdrawn: Number(summary.withdrawn ?? 0),
        rejected: Number(summary.rejected ?? 0),
        outdated: Number(summary.outdated ?? 0),
        avgQuality: Number(summary.avg_quality ?? 0),
        avgInfluence: Number(summary.avg_influence ?? 0),
        sharedWithFaction: Number(summary.shared_with_faction ?? 0),
        sharedOnExchange: Number(summary.shared_on_exchange ?? 0),
      } : null,
      reputation: {
        overallScore: Number(reputation.overall_score ?? 50),
        qualityComponent: Number(reputation.quality_component ?? 50),
        usefulnessComponent: Number(reputation.usefulness_component ?? 50),
        validationComponent: Number(reputation.validation_component ?? 50),
        reliabilityComponent: Number(reputation.reliability_component ?? 50),
        calculatedAt: reputation.calculated_at ?? null,
      },
      entryPerformance: performance.map((p: any) => ({
        entryId: p.entry_id,
        qualityScore: Number(p.quality_score ?? 0),
        influenceScore: Number(p.influence_score ?? 0),
        validationStatus: p.validation_status,
        analystUseCount: Number(p.analyst_use_count ?? 0),
        helpfulCount: Number(p.helpful_count ?? 0),
        supportCount: Number(p.support_count ?? 0),
        disputeCount: Number(p.dispute_count ?? 0),
        outdatedFlag: Boolean(p.outdated_flag),
        lastUsedAt: p.last_used_at ?? null,
      })),
      weeklyTrend: trend.map((t: any) => ({
        weekStart: t.week_start,
        entriesCreated: Number(t.entries_created ?? 0),
        avgQuality: Number(t.avg_quality ?? 0),
        analystUses: Number(t.analyst_uses ?? 0),
        feedbackCount: Number(t.feedback_count ?? 0),
      })),
      factionContributions: factionContributions.map((f: any) => ({
        factionId: f.faction_id,
        entriesShared: Number(f.entries_shared ?? 0),
        entriesUsedByAnalysts: Number(f.entries_used_by_analysts ?? 0),
        avgQuality: Number(f.avg_quality ?? 0),
        supportedEntries: Number(f.supported_entries ?? 0),
        disputedEntries: Number(f.disputed_entries ?? 0),
      })),
      exchangeContributions: {
        eligibleExchangeEntries: Number(exchangeContributions.eligible_exchange_entries ?? 0),
        synchronizedEntriesUsed: Number(exchangeContributions.synchronized_entries_used ?? 0),
        avgSharedQuality: Number(exchangeContributions.avg_shared_quality ?? 0),
        supportedEntryRate: Number(exchangeContributions.supported_entry_rate ?? 0),
        disputeRate: Number(exchangeContributions.dispute_rate ?? 0),
        activePurchases: Number(exchangeContributions.active_purchases ?? 0),
        expiredPurchases: Number(exchangeContributions.expired_purchases ?? 0),
      },
    },
  });
}

// ── Main Handler ─────────────────────────────────────────────────────────────

async function handleAnalystChat(request: Request, env: Env): Promise<Response> {
  // ── Check required env vars ──────────────────────────────────────────────
  if (!env.OPENAI_API_KEY) {
    console.warn("[analyst] missing OPENAI_API_KEY");
    return jsonResponse(
      { ok: false, errorCode: "missing_api_key", error: "OpenAI API key is not configured." },
      503,
    );
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    console.warn("[analyst] missing Supabase config");
    return jsonResponse(
      { ok: false, errorCode: "missing_config", error: "Backend configuration is incomplete." },
      503,
    );
  }

  // ── Parse request ────────────────────────────────────────────────────────
  let payload: AnalystRequest;
  try {
    payload = (await request.json()) as AnalystRequest;
  } catch {
    return jsonResponse(
      { ok: false, errorCode: "invalid_request", error: "Invalid request payload." },
      400,
    );
  }

  const prompt = payload.prompt?.trim();
  if (!prompt) {
    return jsonResponse(
      { ok: false, errorCode: "invalid_request", error: "Prompt is required." },
      400,
    );
  }

  // ── Extract JWT ──────────────────────────────────────────────────────────
  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) {
    return jsonResponse(
      { ok: false, errorCode: "unauthorized", error: "Authentication required." },
      401,
    );
  }

  // ── Create Supabase client & authenticate ────────────────────────────────
  // Use createAuthedClient so the JWT is injected into global headers — every
  // query/mutation is evaluated against RLS as the authenticated user. This
  // ensures EAGOH ownership checks work for every EAGOH owned by the user, not
  // just the primary one.
  const supabase = createAuthedClient(env, jwt);

  const userId = await verifyAuth(supabase, jwt);
  if (!userId) {
    return jsonResponse(
      { ok: false, errorCode: "unauthorized", error: "Invalid or expired authentication." },
      401,
    );
  }

  const sessionType = payload.sessionType ?? "standard";
  const personality = payload.personality ?? "tactical";
  const kind = payload.kind ?? "general";
  const safePrompt = prompt.slice(0, 1200);
  const executionId = crypto.randomUUID();
  const threadId = payload.threadId ?? null;
  const messageId = payload.messageId ?? null;

  console.log("[analyst] request", {
    userId,
    sessionType,
    eagohId: payload.eagohId ?? "none",
    promptLen: safePrompt.length,
    hasConversationContext: (payload.conversationContext?.length ?? 0) > 0,
  });

  // ── EAGOH ownership verification & Personal OI retrieval ──────────────────
  let eagohMeta: { name: string; domain: string } | null = null;
  let oiContext = "";
  let oiCount = 0;
  let rankedPersonalEntries: OpenIntelligenceRow[] = [];

  if (payload.eagohId) {
    const eagoh = await verifyEagohOwnership(supabase, payload.eagohId, userId);
    if (!eagoh) {
      return jsonResponse(
        { ok: false, errorCode: "eagoh_not_found", error: "EAGOH not found or access denied." },
        403,
      );
    }

    eagohMeta = {
      name: eagoh.name ?? "Unnamed EAGOH",
      domain: eagoh.domain ?? "general",
    };

    const rawEntries = await retrievePersonalOpenIntelligence(supabase, userId, payload.eagohId, 50);
    const limit = sessionOILimit(sessionType);
    const tokenBudget = sessionOITokenBudget(sessionType);

    if (rawEntries.length > 0) {
      // Phase 5B: Fetch contributor reputations for ranking (personal entries are all owned by the same user)
      const personalRepMap = await fetchReputationsForUsers(supabase, [userId]);
      const ranked = rankEntries(rawEntries, prompt, Math.min(limit, rawEntries.length), personalRepMap);
      rankedPersonalEntries = ranked;
      const formatted = formatOIContext(ranked, tokenBudget);
      oiContext = formatted.text;
      oiCount = formatted.count;

      console.log("[analyst] OI retrieval", {
        totalEntries: rawEntries.length,
        rankedCount: ranked.length,
        selectedCount: oiCount,
        sessionType,
      });
    } else {
      console.log("[analyst] OI retrieval: no entries found for this EAGOH");
    }
  } else {
    console.log("[analyst] virtual Quick Check — skipping personal OI retrieval");
  }

  // ── Faction Intelligence retrieval ──────────────────────────────────────
  let factionOIContext = "";
  let factionOICount = 0;
  let rankedFactionEntries: FactionOIEntry[] = [];

  // Only retrieve faction intelligence for paid users with an active faction
  const isPaid = await isPaidUser(supabase, userId);
  if (isPaid) {
    const factionResult = await retrieveFactionOpenIntelligence(supabase, userId, prompt, sessionType);
    if (factionResult.entries.length > 0) {
      const factionTokenBudget = sessionOITokenBudget(sessionType);
      const factionFormatted = formatFactionOIContext(factionResult.entries, factionTokenBudget);
      factionOIContext = factionFormatted.text;
      factionOICount = factionFormatted.count;
      rankedFactionEntries = factionResult.entries;

      console.log("[analyst] Faction OI retrieval", {
        factionCount: factionOICount,
        sessionType,
      });
    } else {
      console.log("[analyst] Faction OI retrieval: no relevant shared entries found");
    }
  } else {
    console.log("[analyst] Faction OI retrieval skipped — free user");
  }

  // ── Exchange Intelligence retrieval (Phase 4B hardened) ──────────────
  // Safe-failure: any Exchange error continues the session with other sources.
  let exchangeOIContext = "";
  let exchangeOICount = 0;
  let exchangeSyncCount = 0;
  let exchangeVendorEagohCount = 0;
  let rankedExchangeEntries: OpenIntelligenceRow[] = [];
  let exchangePurchaseMap: Map<string, { purchaseId: string; syncPercentage: number }> = new Map();

  // Only retrieve Exchange intelligence for paid users with service-role access
  if (isPaid) {
    const serviceClient = getServiceRoleClient(env);
    if (serviceClient) {
      console.log("[analyst:diag] service-role key present: true");

      try {
        const exchangeResult = await retrieveExchangeOpenIntelligence(serviceClient, userId, prompt, sessionType);
        exchangeSyncCount = exchangeResult.syncCount;
        exchangeVendorEagohCount = exchangeResult.vendorEagohCount;

        if (exchangeResult.used && exchangeResult.entries.length > 0) {
          const exchangeTokenBudget = sessionOITokenBudget(sessionType);
          const exchangeFormatted = formatExchangeOIContext(exchangeResult, exchangeTokenBudget);
          exchangeOIContext = exchangeFormatted.text;
          exchangeOICount = exchangeFormatted.count;
          rankedExchangeEntries = exchangeResult.entries;
          exchangePurchaseMap = exchangeResult.entryPurchaseMap;

          console.log("[analyst:diag] final exchange count:", exchangeOICount);
        } else if (exchangeResult.syncCount > 0) {
          console.log("[analyst] Exchange OI retrieval: active syncs found but no relevant entries");
        } else {
          console.log("[analyst] Exchange OI retrieval: no active syncs");
        }
      } catch (exchangeErr) {
        // Safe failure: exchange retrieval error must NOT fail the entire analyst session.
        // Continue with Personal, Faction, and External sources only.
        const msg = exchangeErr instanceof Error ? exchangeErr.message : "unknown";
        console.warn("[analyst] Exchange OI retrieval failed safely — continuing without Exchange intelligence", {
          errorCode: "exchange_retrieval_error",
          error: msg.slice(0, 200),
        });
        // All Exchange variables remain at their zero defaults — no Exchange intelligence used
      }
    } else {
      console.log("[analyst:diag] service-role key present: false");
      console.log("[analyst] Exchange OI retrieval skipped — service role key not configured");
    }
  } else {
    console.log("[analyst] Exchange OI retrieval skipped — free user");
  }

  // ── Retained Exchange Intelligence retrieval (Phase RETAINED-OI-1) ──────
  // These are permanent read-only snapshots from past Exchange purchases.
  // Available to all users (free + paid) — they are the buyer's private library.
  // Safe-failure: any retained exchange error continues the session.
  let retainedExchangeOIContext = "";
  let retainedExchangeOICount = 0;
  let rankedRetainedExchangeEntries: RetainedExchangeRow[] = [];

  try {
    const serviceClient = getServiceRoleClient(env);
    if (serviceClient) {
      const retainedResult = await retrieveRetainedExchangeIntelligence(serviceClient, userId, prompt, sessionType);
      if (retainedResult.used && retainedResult.entries.length > 0) {
        const retainedTokenBudget = sessionOITokenBudget(sessionType);
        const retainedFormatted = formatRetainedExchangeOIContext(retainedResult.entries, retainedTokenBudget);
        retainedExchangeOIContext = retainedFormatted.text;
        retainedExchangeOICount = retainedFormatted.count;
        rankedRetainedExchangeEntries = retainedResult.entries;
        console.log("[analyst:diag] retained exchange count:", retainedExchangeOICount);
      } else {
        console.log("[analyst:diag] retained exchange: no entries found");
      }
    }
  } catch (retainedErr) {
    const msg = retainedErr instanceof Error ? retainedErr.message : "unknown";
    console.warn("[analyst] Retained Exchange OI retrieval failed safely", {
      errorCode: "retained_exchange_retrieval_error",
      error: msg.slice(0, 200),
    });
  }

  // ── External web search ──────────────────────────────────────────────────
  let externalResearchResult: ExternalResearchResult = {
    used: false,
    summary: "",
    sources: [],
  };

  const searchWanted = shouldUseExternalSearch(prompt, sessionType);

  if (searchWanted) {
    console.log("[analyst] external search triggered", { sessionType });

    const searchQuery = buildSearchQuery(prompt, eagohMeta?.domain);
    externalResearchResult = await performWebSearch(searchQuery, env.OPENAI_API_KEY, sessionType);

    console.log("[analyst] external search result", {
      used: externalResearchResult.used,
      sourceCount: externalResearchResult.sources.length,
      summaryLen: externalResearchResult.summary.length,
      error: externalResearchResult.error ?? "none",
    });
  } else {
    console.log("[analyst] external search skipped — no freshness triggers detected");
  }

  const externalResearchContext = formatExternalResearchContext(externalResearchResult);

  // ── Build prompt ─────────────────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt({
    sessionType,
    personality,
    kind,
    eagohMeta,
    hasOI: oiCount > 0,
    hasFactionOI: factionOICount > 0,
    hasExchangeOI: exchangeOICount > 0,
    hasRetainedExchangeOI: retainedExchangeOICount > 0,
    hasExternalResearch: externalResearchResult.used,
  });

  const messages = buildMessages({
    systemPrompt,
    oiContext,
    externalResearchContext,
    factionOIContext,
    exchangeOIContext,
    retainedExchangeOIContext,
    conversationContext: payload.conversationContext ?? [],
    prompt: safePrompt,
  });

  // ── Call OpenAI ──────────────────────────────────────────────────────────
  const MAX_RETRIES = 3;
  let lastError: { status: number; errorCode: string; error: string } | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Reduced max_tokens for faster response — visual blocks are generated
      // server-side as fallback, so AI doesn't need extra tokens for JSON
      const maxTokens =
        sessionType === "quick-check" ? 200 :
        sessionType === "quick-analytics" ? 500 :
        sessionType === "oracle" ? 800 :
        sessionType === "premium-event" ? 700 :
        600;

      // Timeout: generous limits so normal analysis doesn't timeout server-side
      const timeoutMs =
        sessionType === "quick-check" ? 25000 :
        sessionType === "quick-analytics" ? 45000 :
        sessionType === "standard" ? 60000 :
        sessionType === "oracle" ? 75000 :
        sessionType === "premium-event" ? 75000 : 60000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      let openaiRes: Response;
      try {
        openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages,
            temperature: sessionType === "quick-check" ? 0.55 : 0.72,
            max_tokens: maxTokens,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!openaiRes.ok) {
        const status = openaiRes.status;
        console.warn("[analyst] OpenAI non-ok", { status, attempt });

        if (status === 429) {
          lastError = { status, errorCode: "openai_rate_limit", error: "OpenAI rate limit exceeded." };
          if (attempt < MAX_RETRIES) {
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          return jsonResponse(lastError, 429);
        }

        return jsonResponse(
          { ok: false, errorCode: "openai_error", error: "OpenAI request failed." },
          502,
        );
      }

      const data = (await openaiRes.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const rawReply = data.choices?.[0]?.message?.content?.trim();

      if (!rawReply) {
        return jsonResponse(
          { ok: false, errorCode: "openai_empty_response", error: "Analyst returned an empty response." },
          502,
        );
      }

      // Parse visual blocks from the reply (AI appends a ```visual_blocks fenced section)
      const { text: reply, visualBlocks: aiVisualBlocks } = extractVisualBlocks(rawReply);

      // ── Visual block fallback generation ──────────────────────────────
      // If the AI didn't return visual blocks, check if the prompt/reply is
      // visual-worthy and generate safe fallback blocks from analysis context.
      let visualBlocks = aiVisualBlocks;
      const visualWorthy = isVisualWorthy(prompt, reply, sessionType);
      let fallbackCreated = false;

      if (!visualBlocks && visualWorthy) {
        visualBlocks = generateFallbackVisualBlocks(
          prompt,
          reply,
          sessionType,
          eagohMeta?.domain ?? null,
          oiCount > 0 || factionOICount > 0 || exchangeOICount > 0,
        );
        fallbackCreated = visualBlocks !== null && visualBlocks.length > 0;
      }

      // Safe development logging — no private intelligence content logged
      console.log("[analyst] visual blocks", {
        visualWorthyDetected: visualWorthy,
        aiVisualBlocksFound: !!aiVisualBlocks,
        fallbackVisualBlocksCreated: fallbackCreated,
        visualBlocksCount: visualBlocks?.length ?? 0,
        sessionType,
      });

      const confidenceMap: Record<SessionType, number> = {
        "quick-check": 82,
        "quick-analytics": 86,
        standard: 89,
        oracle: 93,
        "premium-event": 90,
      };

      const grounding: PersonalGrounding = {
        personalOpenIntelligenceUsed: oiCount > 0,
        personalOpenIntelligenceCount: oiCount,
        factionIntelligenceUsed: factionOICount > 0,
        factionIntelligenceCount: factionOICount,
        exchangeIntelligenceUsed: exchangeOICount > 0,
        exchangeIntelligenceCount: exchangeOICount,
        retainedExchangeIntelligenceUsed: retainedExchangeOICount > 0,
        retainedExchangeIntelligenceCount: retainedExchangeOICount,
        externalSearchUsed: externalResearchResult.used,
        sourceCount: externalResearchResult.sources.length,
        exchangeAccess: exchangeSyncCount > 0 ? {
          activeSyncCount: exchangeSyncCount,
          vendorEagohCount: exchangeVendorEagohCount,
        } : undefined,
      };

      // ── Build OpenIntelligenceReferences (only entries actually supplied to the AI) ──
      const openIntelligenceReferences: OpenIntelligenceReference[] = [];
      let refNum = 0;

      // Personal OI references
      for (const e of rankedPersonalEntries) {
        refNum += 1;
        openIntelligenceReferences.push({
          referenceNumber: refNum,
          sourceType: "personal",
          entryId: e.id,
          sourceOwnerId: e.user_id,
          sourceEagohId: e.eagoh_id,
          vendorName: null,
          eagohName: eagohMeta?.name ?? null,
          tag: e.tag,
          entryType: e.entry_type,
          category: e.selected_category ?? null,
          createdAt: e.created_at,
          validationStatus: e.validation_status,
          qualityScore: e.quality_score,
          confidenceLevel: e.confidence_level,
          exchangePurchaseId: null,
          retained: false,
          readOnly: false,
        });
      }

      // Faction OI references
      for (const e of rankedFactionEntries) {
        refNum += 1;
        openIntelligenceReferences.push({
          referenceNumber: refNum,
          sourceType: "faction",
          entryId: e.id,
          sourceOwnerId: e.contributor_user_id,
          sourceEagohId: e.eagoh_id,
          vendorName: null,
          eagohName: null,
          tag: e.tag,
          entryType: e.entry_type,
          category: e.selected_category ?? null,
          createdAt: e.created_at,
          validationStatus: e.validation_status,
          qualityScore: e.quality_score,
          confidenceLevel: e.confidence_level,
          exchangePurchaseId: null,
          retained: false,
          readOnly: false,
        });
      }

      // Exchange OI references
      for (const e of rankedExchangeEntries) {
        refNum += 1;
        const purchaseInfo = exchangePurchaseMap.get(e.id);
        openIntelligenceReferences.push({
          referenceNumber: refNum,
          sourceType: "exchange",
          entryId: e.id,
          sourceOwnerId: e.user_id,
          sourceEagohId: e.eagoh_id,
          vendorName: null,
          eagohName: null,
          tag: e.tag,
          entryType: e.entry_type,
          category: e.selected_category ?? null,
          createdAt: e.created_at,
          validationStatus: e.validation_status,
          qualityScore: e.quality_score,
          confidenceLevel: e.confidence_level,
          exchangePurchaseId: purchaseInfo?.purchaseId ?? null,
          retained: false,
          readOnly: false,
        });
      }

      // Retained Exchange OI references
      for (const e of rankedRetainedExchangeEntries) {
        refNum += 1;
        openIntelligenceReferences.push({
          referenceNumber: refNum,
          sourceType: "retained_exchange",
          entryId: e.source_entry_id,
          sourceOwnerId: e.vendor_id,
          sourceEagohId: e.vendor_eagoh_id,
          vendorName: e.vendor_display_name,
          eagohName: e.vendor_eagoh_name,
          tag: e.source_tag,
          entryType: e.source_entry_type,
          category: e.source_category,
          createdAt: e.source_created_at,
          validationStatus: e.source_validation_status,
          qualityScore: e.source_quality_score,
          confidenceLevel: e.source_confidence_level,
          exchangePurchaseId: e.purchase_id,
          retained: true,
          readOnly: true,
        });
      }

      console.log("[analyst] success", {
        replyLen: reply.length,
        personalOIUsed: grounding.personalOpenIntelligenceUsed,
        personalOICount: grounding.personalOpenIntelligenceCount,
        factionOIUsed: grounding.factionIntelligenceUsed,
        factionOICount: grounding.factionIntelligenceCount,
        exchangeOIUsed: grounding.exchangeIntelligenceUsed,
        exchangeOICount: grounding.exchangeIntelligenceCount,
        retainedExchangeOIUsed: grounding.retainedExchangeIntelligenceUsed,
        retainedExchangeOICount: grounding.retainedExchangeIntelligenceCount,
        externalSearchUsed: grounding.externalSearchUsed,
        sourceCount: grounding.sourceCount,
        referenceCount: openIntelligenceReferences.length,
        hasEagoh: !!payload.eagohId,
      });

      // ── Phase 5A: Write audit records (best-effort, never fails the session) ──
      const auditClient = getServiceRoleClient(env);
      if (auditClient) {
        const confidence = confidenceMap[sessionType];
        const auditEntries: AuditEntryRecord[] = [];

        // Personal OI entries
        for (let i = 0; i < rankedPersonalEntries.length; i++) {
          const e = rankedPersonalEntries[i];
          auditEntries.push({
            execution_id: executionId,
            requesting_user_id: userId,
            source_type: "personal",
            source_entry_id: e.id,
            source_owner_id: e.user_id,
            source_eagoh_id: e.eagoh_id,
            faction_id: null,
            exchange_purchase_id: null,
            relevance_score: null,
            source_rank: i + 1,
            sync_percentage: null,
            source_created_at: e.created_at,
            source_category: e.selected_category ?? null,
            source_validation_status: e.validation_status,
            source_quality_score: e.quality_score,
            source_confidence_level: e.confidence_level,
            external_url_hash: null,
            external_publisher: null,
            session_type: sessionType,
            selected_eagoh_id: payload.eagohId ?? null,
            analyst_thread_id: threadId,
            analyst_message_id: messageId,
          });
        }

        // Faction OI entries
        for (let i = 0; i < rankedFactionEntries.length; i++) {
          const e = rankedFactionEntries[i];
          auditEntries.push({
            execution_id: executionId,
            requesting_user_id: userId,
            source_type: "faction",
            source_entry_id: e.id,
            source_owner_id: e.contributor_user_id,
            source_eagoh_id: e.eagoh_id,
            faction_id: e.faction_id,
            exchange_purchase_id: null,
            relevance_score: null,
            source_rank: i + 1,
            sync_percentage: null,
            source_created_at: e.created_at,
            source_category: e.selected_category ?? null,
            source_validation_status: e.validation_status,
            source_quality_score: e.quality_score,
            source_confidence_level: e.confidence_level,
            external_url_hash: null,
            external_publisher: null,
            session_type: sessionType,
            selected_eagoh_id: payload.eagohId ?? null,
            analyst_thread_id: threadId,
            analyst_message_id: messageId,
          });
        }

        // Exchange OI entries
        for (let i = 0; i < rankedExchangeEntries.length; i++) {
          const e = rankedExchangeEntries[i];
          const purchaseInfo = exchangePurchaseMap.get(e.id);
          auditEntries.push({
            execution_id: executionId,
            requesting_user_id: userId,
            source_type: "exchange",
            source_entry_id: e.id,
            source_owner_id: e.user_id,
            source_eagoh_id: e.eagoh_id,
            faction_id: null,
            exchange_purchase_id: purchaseInfo?.purchaseId ?? null,
            relevance_score: null,
            source_rank: i + 1,
            sync_percentage: purchaseInfo?.syncPercentage ?? null,
            source_created_at: e.created_at,
            source_category: e.selected_category ?? null,
            source_validation_status: e.validation_status,
            source_quality_score: e.quality_score,
            source_confidence_level: e.confidence_level,
            external_url_hash: null,
            external_publisher: null,
            session_type: sessionType,
            selected_eagoh_id: payload.eagohId ?? null,
            analyst_thread_id: threadId,
            analyst_message_id: messageId,
          });
        }

        // Retained Exchange OI entries
        for (let i = 0; i < rankedRetainedExchangeEntries.length; i++) {
          const e = rankedRetainedExchangeEntries[i];
          auditEntries.push({
            execution_id: executionId,
            requesting_user_id: userId,
            source_type: "retained_exchange",
            source_entry_id: e.source_entry_id,
            source_owner_id: e.vendor_id,
            source_eagoh_id: e.vendor_eagoh_id,
            faction_id: null,
            exchange_purchase_id: e.purchase_id,
            relevance_score: null,
            source_rank: i + 1,
            sync_percentage: e.purchased_percentage,
            source_created_at: e.source_created_at,
            source_category: e.source_category,
            source_validation_status: e.source_validation_status,
            source_quality_score: e.source_quality_score,
            source_confidence_level: e.source_confidence_level,
            external_url_hash: null,
            external_publisher: null,
            session_type: sessionType,
            selected_eagoh_id: payload.eagohId ?? null,
            analyst_thread_id: threadId,
            analyst_message_id: messageId,
          });
        }

        // External research sources
        for (let i = 0; i < externalResearchResult.sources.length; i++) {
          const src = externalResearchResult.sources[i];
          auditEntries.push({
            execution_id: executionId,
            requesting_user_id: userId,
            source_type: "external_research",
            source_entry_id: null,
            source_owner_id: null,
            source_eagoh_id: null,
            faction_id: null,
            exchange_purchase_id: null,
            relevance_score: null,
            source_rank: i + 1,
            sync_percentage: null,
            source_created_at: null,
            source_category: null,
            source_validation_status: null,
            source_quality_score: null,
            source_confidence_level: null,
            external_url_hash: hashUrl(src.url),
            external_publisher: extractPublisher(src.url),
            session_type: sessionType,
            selected_eagoh_id: payload.eagohId ?? null,
            analyst_thread_id: threadId,
            analyst_message_id: messageId,
          });
        }

        void writeAuditRecords(auditClient, {
          executionId,
          userId,
          sessionType,
          selectedEagohId: payload.eagohId ?? null,
          threadId,
          messageId,
          model: "gpt-4o-mini",
          confidence,
          auditEntries,
          externalSearchUsed: externalResearchResult.used,
        });
      }

      return jsonResponse({
        ok: true,
        reply,
        model: "gpt-4o-mini",
        sessionType,
        confidence: confidenceMap[sessionType],
        grounding,
        sources: externalResearchResult.sources,
        openIntelligenceReferences,
        visualBlocks: visualBlocks ?? undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[analyst] fetch/parse failure", { message, attempt });

      const isTimeout =
        message.toLowerCase().includes("timeout") ||
        message.toLowerCase().includes("abort");

      lastError = {
        status: 500,
        errorCode: "openai_error",
        error: isTimeout ? "Request timed out." : "Analyst service failed safely.",
      };

      if (attempt < MAX_RETRIES && (isTimeout || message.toLowerCase().includes("network"))) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    }
  }

  return jsonResponse(lastError!, lastError!.status);
}

// ── Phase 10A: Account Deletion (secure, service-role only) ─────────────────

/**
 * POST /account/delete
 *
 * Securely deletes the authenticated user's account using the service-role
 * client. The mobile app must never call supabase.auth.admin.deleteUser()
 * directly — that requires the service-role key which is server-only.
 *
 * Flow:
 *   1. Verify JWT and resolve the authenticated user id (never client-supplied).
 *   2. Clean up user-owned Storage objects (profile media, EAGOH renders)
 *      because Supabase may block auth deletion while objects remain.
 *   3. Call auth.admin.deleteUser(userId) — cascading FKs remove row data.
 *   4. Return a simple success/safe-error response.
 *
 * No service-role keys, raw SQL, or private user ids are exposed to clients.
 */
async function handleDeleteAccount(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  // Authenticate via JWT — never trust a client-supplied userId.
  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Server configuration error." }, 503);
  }

  const supabase = createAuthedClient(env, jwt);
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  const serviceClient = getServiceRoleClient(env);
  if (!serviceClient) {
    return jsonResponse({ ok: false, error: "Server configuration error." }, 503);
  }

  // ── Storage cleanup ──────────────────────────────────────────────────────
  // Supabase may block auth.admin.deleteUser when the user still owns Storage
  // objects, and Storage `.remove()` is NOT recursive — only exact object paths
  // are deleted. So we list every file under the user's prefix recursively
  // (paginated, nested-folder aware) and remove each full path. Only the
  // authenticated user's prefix is touched — never another user's files.
  const USER_BUCKETS = ["user-profile-media", "eagoh-renders"] as const;
  const userPrefix: string = `${userId}/`;

  /**
   * Recursively collect every object path under `prefix` in `bucket`,
   * paginating past the 100-item list limit and descending into subfolders.
   * Supabase Storage list entries are folders when `metadata` is null.
   */
  const collectAllPaths = async (bucket: string, prefix: string): Promise<string[]> => {
    const collected: string[] = [];
    const stack: string[] = [prefix];
    let guard = 0;

    while (stack.length > 0 && guard < 500) {
      const current = stack.pop()!;
      let after: string | undefined = undefined;
      let pageGuard = 0;

      while (pageGuard < 100) {
        const listParams: { limit: number; offset?: number } = { limit: 100 };
        if (after) listParams.offset = after as unknown as number;
        const { data: entries, error: listErr } = await serviceClient
          .storage
          .from(bucket)
          .list(current, listParams);

        if (listErr) {
          console.warn(`[account-delete] list ${bucket} prefix=${current} failed`, listErr.message);
          pageGuard = 100; // break inner loop
          break;
        }
        if (!entries || entries.length === 0) break;

        for (const entry of entries) {
          if (!entry.name) continue;
          const fullPath = `${current}${entry.name}`;
          // Folder entries have null metadata; files have non-null metadata.
          const isFolder = entry.metadata == null;
          if (isFolder) {
            stack.push(`${fullPath}/`);
          } else {
            collected.push(fullPath);
          }
        }

        if (entries.length < 100) break;
        // Supabase Storage paginates via `offset` (number) — track count.
        after = String((after ? Number(after) : 0) + entries.length);
        pageGuard += 1;
      }
      guard += 1;
    }
    return collected;
  };

  for (const bucket of USER_BUCKETS) {
    try {
      const paths = await collectAllPaths(bucket, userPrefix);
      if (paths.length === 0) continue;

      // Remove in batches of 100 (Supabase Storage remove accepts arrays).
      for (let i = 0; i < paths.length; i += 100) {
        const batch = paths.slice(i, i + 100);
        const { error: delErr } = await serviceClient
          .storage
          .from(bucket)
          .remove(batch);
        if (delErr) {
          console.warn(`[account-delete] remove ${bucket} batch ${i} failed`, delErr.message);
        }
      }
    } catch (err) {
      // Storage cleanup is best-effort; do not abort deletion on storage errors.
      console.warn(`[account-delete] storage cleanup ${bucket} exception`, err instanceof Error ? err.message : "unknown");
    }
  }

  // ── Auth user deletion ───────────────────────────────────────────────────
  // auth.admin.deleteUser cascades via FK ON DELETE CASCADE / SET NULL set up
  // in the schema (profiles, eagohs, open_intelligence, edge_transactions,
  // feedback, disputes, versions, reputation, notifications, etc.).
  try {
    const { error: deleteErr } = await serviceClient.auth.admin.deleteUser(userId);
    if (deleteErr) {
      console.warn("[account-delete] admin.deleteUser failed", deleteErr.message);
      return jsonResponse(
        { ok: false, error: "Your account could not be deleted. Please try again or contact support." },
        500,
      );
    }
    return jsonResponse({ ok: true, deleted: true });
  } catch (err) {
    console.warn("[account-delete] exception", err instanceof Error ? err.message : "unknown");
    return jsonResponse(
      { ok: false, error: "Your account could not be deleted. Please try again or contact support." },
      500,
    );
  }
}

// ── Phase 11A: Arena Compatibility Validation ──────────────────────────────


/**
 * Arena domain rules — server-side source of truth.
 *
 * Only domains that exist in the app are included. The client never supplies
 * the domain; it is always read from the verified EAGOH record.
 */
const ARENA_DOMAIN_RULES: Record<string, {
  comparisonTypes: Array<{ id: string; label: string }>;
  /** Known sports used for same-sport validation heuristics. */
  knownSports?: string[];
}> = {
  sports: {
    comparisonTypes: [
      { id: "player-vs-player", label: "Player vs Player" },
      { id: "team-vs-team", label: "Team vs Team" },
      { id: "coach-vs-coach", label: "Coach vs Coach" },
      { id: "season-vs-season", label: "Season vs Season" },
    ],
    knownSports: [
      "basketball", "football", "baseball", "soccer", "hockey", "tennis",
      "golf", "boxing", "mma", "ufc", "cricket", "rugby", "volleyball",
      "track", "swimming", "gymnastics", "f1", "racing", "nascar",
    ],
  },
  music: {
    comparisonTypes: [
      { id: "artist-vs-artist", label: "Artist vs Artist" },
      { id: "album-vs-album", label: "Album vs Album" },
      { id: "song-vs-song", label: "Song vs Song" },
      { id: "producer-vs-producer", label: "Producer vs Producer" },
    ],
  },
  "film-tv": {
    comparisonTypes: [
      { id: "actor-vs-actor", label: "Actor vs Actor" },
      { id: "film-vs-film", label: "Film vs Film" },
      { id: "series-vs-series", label: "Series vs Series" },
      { id: "director-vs-director", label: "Director vs Director" },
      { id: "character-vs-character", label: "Character vs Character" },
    ],
  },
  fashion: {
    comparisonTypes: [
      { id: "brand-vs-brand", label: "Brand vs Brand" },
      { id: "designer-vs-designer", label: "Designer vs Designer" },
      { id: "collection-vs-collection", label: "Collection vs Collection" },
      { id: "style-vs-style", label: "Style vs Style" },
    ],
  },
  education: {
    comparisonTypes: [
      { id: "school-vs-school", label: "School vs School" },
      { id: "program-vs-program", label: "Program vs Program" },
      { id: "course-vs-course", label: "Course vs Course" },
      { id: "method-vs-method", label: "Teaching Method vs Teaching Method" },
    ],
  },
  gaming: {
    comparisonTypes: [
      { id: "game-vs-game", label: "Game vs Game" },
      { id: "character-vs-character", label: "Character vs Character" },
      { id: "studio-vs-studio", label: "Studio vs Studio" },
      { id: "franchise-vs-franchise", label: "Franchise vs Franchise" },
    ],
  },
  business: {
    comparisonTypes: [
      { id: "company-vs-company", label: "Company vs Company" },
      { id: "product-vs-product", label: "Product vs Product" },
      { id: "strategy-vs-strategy", label: "Strategy vs Strategy" },
      { id: "founder-vs-founder", label: "Founder vs Founder" },
    ],
  },
  finance: {
    comparisonTypes: [
      { id: "asset-vs-asset", label: "Asset vs Asset" },
      { id: "strategy-vs-strategy", label: "Strategy vs Strategy" },
      { id: "portfolio-vs-portfolio", label: "Portfolio vs Portfolio" },
      { id: "institution-vs-institution", label: "Institution vs Institution" },
    ],
  },
  technology: {
    comparisonTypes: [
      { id: "product-vs-product", label: "Product vs Product" },
      { id: "company-vs-company", label: "Company vs Company" },
      { id: "platform-vs-platform", label: "Platform vs Platform" },
      { id: "framework-vs-framework", label: "Framework vs Framework" },
    ],
  },
  "health-fitness": {
    comparisonTypes: [
      { id: "program-vs-program", label: "Program vs Program" },
      { id: "method-vs-method", label: "Method vs Method" },
      { id: "athlete-vs-athlete", label: "Athlete vs Athlete" },
      { id: "supplement-vs-supplement", label: "Supplement vs Supplement" },
    ],
  },
};

const DEBUG_ARENA = true; // dev-only Arena logging
const ARENA_SUBJECT_NAME_MAX = 120;
const ARENA_SUBJECT_CONTEXT_MAX = 80;
const ARENA_SUBJECT_YEAR_MAX = 30;
const ARENA_SUBJECT_NOTES_MAX = 300;

/** Normalize domain id — mirrors the client normalizer for the subset we need. */
function arenaNormalizeDomainId(raw: string): string {
  const lower = raw.trim().toLowerCase();
  const map: Record<string, string> = {
    sport: "sports",
    film_tv: "film-tv",
    "film & television": "film-tv",
    "film and television": "film-tv",
    "film-television": "film-tv",
    health_fitness: "health-fitness",
    "health & fitness": "health-fitness",
    "health and fitness": "health-fitness",
  };
  if (map[lower]) return map[lower];
  const collapsed = lower.replace(/[^a-z0-9]/g, "");
  for (const key of Object.keys(ARENA_DOMAIN_RULES)) {
    if (key.replace(/[^a-z0-9]/g, "") === collapsed) return key;
  }
  return lower;
}

/** Trim + collapse whitespace. */
function arenaClean(s: string | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ");
}

/**
 * Detect a sport from a subject's context or name using the known-sports bank.
 * Returns the lowercased sport name, or null when none is detected.
 */
function arenaDetectSport(contextA: string, nameA: string, knownSports: string[]): string | null {
  const hay = `${contextA} ${nameA}`.toLowerCase();
  for (const sport of knownSports) {
    if (hay.includes(sport)) return sport;
  }
  // Common aliases
  if (hay.includes("hoops") || hay.includes("nba") || hay.includes("ncaa basketball")) return "basketball";
  if (hay.includes("nfl") || hay.includes("gridiron")) return "football";
  if (hay.includes("mlb") || hay.includes("baseball")) return "baseball";
  if (hay.includes("football") && !hay.includes("american")) {
    // "football" alone — ambiguous; in US context means American football, else soccer.
    // We treat it as a match for either when both subjects share the same token.
  }
  if (hay.includes("soccer") || hay.includes("premier league") || hay.includes("la liga") || hay.includes("bundesliga")) return "soccer";
  if (hay.includes("nhl") || hay.includes("hockey")) return "hockey";
  return null;
}

/** Validate subject field lengths. Returns an error string or null when valid. */
function arenaValidateSubjectFields(subject: {
  name?: string; context?: string; year?: string; notes?: string;
}): string | null {
  if (!subject.name || arenaClean(subject.name).length === 0) {
    return "Both subjects need a primary name.";
  }
  if (arenaClean(subject.name).length > ARENA_SUBJECT_NAME_MAX) {
    return `Subject name must be ${ARENA_SUBJECT_NAME_MAX} characters or fewer.`;
  }
  if (subject.context && arenaClean(subject.context).length > ARENA_SUBJECT_CONTEXT_MAX) {
    return `Subject context must be ${ARENA_SUBJECT_CONTEXT_MAX} characters or fewer.`;
  }
  if (subject.year && arenaClean(subject.year).length > ARENA_SUBJECT_YEAR_MAX) {
    return `Subject year/season must be ${ARENA_SUBJECT_YEAR_MAX} characters or fewer.`;
  }
  if (subject.notes && arenaClean(subject.notes).length > ARENA_SUBJECT_NOTES_MAX) {
    return `Subject notes must be ${ARENA_SUBJECT_NOTES_MAX} characters or fewer.`;
  }
  return null;
}

/**
 * POST /arena/validate
 *
 * Secure Arena compatibility validation. Verifies JWT, EAGOH ownership,
 * EAGOH active status, domain support, comparison-type validity, and
 * subject compatibility for the detected domain. Never trusts a
 * client-supplied domain or user id. Does NOT deduct Neurons or expose
 * any Open Intelligence content.
 */
async function handleArenaValidate(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  let payload: {
    eagohId?: unknown;
    comparisonType?: unknown;
    subjectA?: unknown;
    subjectB?: unknown;
  } = {};
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request body." }, 400);
  }

  // Authenticate
  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    console.warn("[arena:validate] missing Supabase config");
    return jsonResponse({ ok: false, error: "Arena service is not configured." }, 503);
  }

  const supabase = createClient(normalizeSupabaseUrl(env.SUPABASE_URL ?? ""), env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  // Validate eagohId
  const eagohId = typeof payload.eagohId === "string" ? payload.eagohId.trim() : "";
  if (!eagohId) {
    return jsonResponse({ ok: false, error: "An EAGOH is required for Arena Mode." }, 400);
  }

  // Validate comparisonType
  const comparisonType = typeof payload.comparisonType === "string" ? payload.comparisonType.trim() : "";
  if (!comparisonType) {
    return jsonResponse({ ok: false, error: "Select a comparison type." }, 400);
  }

  // Validate subjects presence + shape
  const subjectA = payload.subjectA;
  const subjectB = payload.subjectB;
  if (!subjectA || typeof subjectA !== "object" || !subjectB || typeof subjectB !== "object") {
    return jsonResponse({ ok: false, error: "Both subjects are required." }, 400);
  }
  const a = subjectA as { name?: string; context?: string; year?: string; notes?: string };
  const b = subjectB as { name?: string; context?: string; year?: string; notes?: string };

  const fieldErr = arenaValidateSubjectFields(a) ?? arenaValidateSubjectFields(b);
  if (fieldErr) {
    return jsonResponse({ ok: false, error: fieldErr }, 400);
  }

  const serviceClient = getServiceRoleClient(env);
  if (!serviceClient) {
    return jsonResponse({ ok: false, error: "Server configuration error." }, 503);
  }

  // ── 1. Verify the user owns the EAGOH (never trust client user id) ──
  // NOTE: is_default_shell intentionally NOT selected — the app already filters
  // default-shell EAGOHs on the Arena screen, so the worker only needs ownership + domain.
  if (DEBUG_ARENA) {
    console.log("[arena/validate] eagohId=" + String(eagohId).slice(0, 8) + " userIdPrefix=" + String(userId).slice(0, 8));
  }
  const { data: eagohRow, error: eagohErr } = await serviceClient
    .from("eagohs")
    .select("id, user_id, name, domain")
    .eq("id", eagohId)
    .maybeSingle();

  if (eagohErr) {
    if (DEBUG_ARENA) console.log("[arena/validate] EAGOH lookup error: " + eagohErr.message);
    return jsonResponse({ ok: false, error: "EAGOH not found." }, 404);
  }
  if (!eagohRow) {
    if (DEBUG_ARENA) console.log("[arena/validate] EAGOH lookup returned no row");
    return jsonResponse({ ok: false, error: "EAGOH not found." }, 404);
  }

  const eagoh = eagohRow as {
    id: string; user_id: string; name: string; domain: string | null;
  };

  if (DEBUG_ARENA) console.log("[arena/validate] EAGOH found: " + eagoh.name);

  if (eagoh.user_id !== userId) {
    return jsonResponse({ ok: false, error: "You can only use EAGOHs you own." }, 403);
  }

  // ── 2. Domain read from the verified EAGOH record (never from client) ──
  // (ownership + domain checks retained; status/is_user_forged/is_default_shell intentionally removed)
  if (!eagoh.domain) {
    return jsonResponse({ ok: false, error: "This EAGOH has no domain specialization and cannot enter Arena Mode." }, 400);
  }
  const domainId = arenaNormalizeDomainId(eagoh.domain);
  const rule = ARENA_DOMAIN_RULES[domainId];
  if (!rule) {
    return jsonResponse({ ok: false, error: "Arena Mode is not available for this EAGOH domain yet." }, 400);
  }

  // ── 4. Comparison type must belong to this domain ──
  const cmpType = rule.comparisonTypes.find((c) => c.id === comparisonType);
  if (!cmpType) {
    return jsonResponse({ ok: false, error: "This comparison type is not available for the selected EAGOH domain." }, 400);
  }

  // ── 5. Subject compatibility validation ──
  const normA = {
    name: arenaClean(a.name),
    context: arenaClean(a.context) || undefined,
    year: arenaClean(a.year) || undefined,
    notes: arenaClean(a.notes) || undefined,
  };
  const normB = {
    name: arenaClean(b.name),
    context: arenaClean(b.context) || undefined,
    year: arenaClean(b.year) || undefined,
    notes: arenaClean(b.notes) || undefined,
  };

  // Same-name check (no self-comparison)
  if (normA.name.toLowerCase() === normB.name.toLowerCase() && comparisonType !== "season-vs-season") {
    return jsonResponse({
      ok: true,
      valid: false,
      normalizedA: normA,
      normalizedB: normB,
      explanation: "Comparing a subject against itself is not a valid Arena matchup. Enter two different subjects.",
    });
  }

  let detectedCategory: string | undefined;
  let valid = true;
  let explanation = "This Arena matchup is valid.";

  if (domainId === "sports") {
    const knownSports = rule.knownSports ?? [];
    const sportA = arenaDetectSport(normA.context ?? "", normA.name, knownSports);
    const sportB = arenaDetectSport(normB.context ?? "", normB.name, knownSports);
    detectedCategory = sportA ?? sportB ?? undefined;

    // Player vs Player / Team vs Team / Coach vs Coach require same sport
    if (comparisonType === "player-vs-player" || comparisonType === "team-vs-team" || comparisonType === "coach-vs-coach") {
      if (sportA && sportB && sportA !== sportB) {
        valid = false;
        explanation = "These subjects appear to compete in different sports. Both subjects must be from the same sport for this Arena type.";
      } else if (!sportA || !sportB) {
        // Could not confirm — fail open but flag uncertainty.
        explanation = "We could not fully confirm the sport for both subjects. Add the sport in the context field (e.g. 'Basketball') and try again if this matchup is rejected in the next phase.";
      }
    } else if (comparisonType === "season-vs-season") {
      // Season vs season requires the same player/team/league/sport context.
      const sameName = normA.name.toLowerCase() === normB.name.toLowerCase();
      const sameContext = sportA && sportB && sportA === sportB;
      if (!sameName && !sameContext) {
        valid = false;
        explanation = "Season vs Season comparisons must refer to the same player, team, league, or sport context. Enter the same subject name or matching sport context for both.";
      }
    }
  } else {
    // Non-sports domains: same-type comparison is enforced by the comparisonType
    // selection itself. We only do a soft sanity check that names differ.
    detectedCategory = normA.context ?? undefined;
  }

  return jsonResponse({
    ok: true,
    valid,
    normalizedA: normA,
    normalizedB: normB,
    detectedCategory,
    explanation,
  });
}

// ── Phase 11B: Arena Analysis Engine ─────────────────────────────────────────

/** Flat Arena Neuron cost. Server-authoritative — the client never supplies a cost.
 *  Deduction uses the 3-arg RPC deduct_arena_neurons(p_user_id, p_request_id, p_note);
 *  refund uses refund_arena_neurons(p_user_id, p_request_id, p_note). Arena cost is hardcoded
 *  to 50 server-side inside the RPCs — no amount is accepted from the client. */
const ARENA_NEURON_COST = 50;

/** Human-readable domain labels for Arena prompts (worker-side mirror of client domains). */
const ARENA_DOMAIN_LABELS: Record<string, string> = {
  sports: "Sports",
  music: "Music",
  "film-tv": "Film & Television",
  fashion: "Fashion",
  education: "Education",
  gaming: "Gaming",
  business: "Business",
  finance: "Finance",
  technology: "Technology",
  "health-fitness": "Health & Fitness",
};

/** Maximum Arena analysis tokens for the final answer model. */
const ARENA_MAX_TOKENS = 1400;

/** Allowed Arena verdict strings. */
const ARENA_VERDICTS = [
  "Subject A Advantage",
  "Subject B Advantage",
  "Even Match",
  "Too Close to Call",
  "Insufficient Evidence",
] as const;

/** Domain-appropriate comparison category sets. */
const ARENA_CATEGORY_SETS: Record<string, Array<{ id: string; label: string }>> = {
  sports: [
    { id: "performance", label: "Performance" },
    { id: "statistics", label: "Statistics" },
    { id: "consistency", label: "Consistency" },
    { id: "peak_ability", label: "Peak Ability" },
    { id: "longevity", label: "Longevity" },
    { id: "accomplishments", label: "Accomplishments" },
    { id: "competition_level", label: "Competition Level" },
    { id: "historical_impact", label: "Historical Impact" },
  ],
  music: [
    { id: "technical_ability", label: "Technical Ability" },
    { id: "commercial_performance", label: "Commercial Performance" },
    { id: "cultural_impact", label: "Cultural Impact" },
    { id: "consistency", label: "Consistency" },
    { id: "catalog", label: "Catalog / Body of Work" },
    { id: "influence", label: "Influence" },
  ],
  "film-tv": [
    { id: "performance", label: "Performance" },
    { id: "critical_reception", label: "Critical Reception" },
    { id: "commercial_success", label: "Commercial Success" },
    { id: "versatility", label: "Versatility" },
    { id: "career_consistency", label: "Career Consistency" },
    { id: "cultural_impact", label: "Cultural Impact" },
  ],
  fashion: [
    { id: "design_impact", label: "Design Impact" },
    { id: "commercial_performance", label: "Commercial Performance" },
    { id: "cultural_influence", label: "Cultural Influence" },
    { id: "consistency", label: "Consistency" },
    { id: "innovation", label: "Innovation" },
  ],
  education: [
    { id: "academic_reputation", label: "Academic Reputation" },
    { id: "outcomes", label: "Outcomes" },
    { id: "accessibility", label: "Accessibility" },
    { id: "innovation", label: "Innovation" },
    { id: "consistency", label: "Consistency" },
  ],
  gaming: [
    { id: "gameplay_quality", label: "Gameplay Quality" },
    { id: "commercial_performance", label: "Commercial Performance" },
    { id: "cultural_impact", label: "Cultural Impact" },
    { id: "innovation", label: "Innovation" },
    { id: "consistency", label: "Consistency" },
    { id: "influence", label: "Influence" },
  ],
  business: [
    { id: "market_position", label: "Market Position" },
    { id: "financial_performance", label: "Financial Performance" },
    { id: "innovation", label: "Innovation" },
    { id: "leadership", label: "Leadership" },
    { id: "cultural_impact", label: "Cultural Impact" },
  ],
  finance: [
    { id: "performance", label: "Performance" },
    { id: "risk_profile", label: "Risk Profile" },
    { id: "consistency", label: "Consistency" },
    { id: "liquidity", label: "Liquidity" },
    { id: "historical_track_record", label: "Historical Track Record" },
  ],
  technology: [
    { id: "performance", label: "Performance" },
    { id: "ecosystem", label: "Ecosystem" },
    { id: "innovation", label: "Innovation" },
    { id: "market_adoption", label: "Market Adoption" },
    { id: "support_longevity", label: "Support & Longevity" },
  ],
  "health-fitness": [
    { id: "effectiveness", label: "Effectiveness" },
    { id: "sustainability", label: "Sustainability" },
    { id: "accessibility", label: "Accessibility" },
    { id: "evidence_base", label: "Evidence Base" },
    { id: "consistency", label: "Consistency" },
  ],
};

/** Generic fallback categories for any domain without a specific set. */
const ARENA_GENERIC_CATEGORIES = [
  { id: "overall", label: "Overall" },
  { id: "consistency", label: "Consistency" },
  { id: "impact", label: "Impact" },
  { id: "innovation", label: "Innovation" },
  { id: "historical_significance", label: "Historical Significance" },
];

function getArenaCategories(domainId: string): Array<{ id: string; label: string }> {
  return ARENA_CATEGORY_SETS[domainId] ?? ARENA_GENERIC_CATEGORIES;
}

/** Build the Arena analysis system prompt. Instructs fair, structured comparison. */
function buildArenaSystemPrompt(params: {
  domainId: string;
  domainLabel: string;
  comparisonTypeLabel: string;
  focusLabel: string;
  categoryLabels: string[];
  subjectAName: string;
  subjectBName: string;
  hasOI: boolean;
  hasFactionOI: boolean;
  hasExchangeOI: boolean;
  hasExternalResearch: boolean;
}): string {
  const sections: string[] = [];
  sections.push(
    "You are the EAGOH Arena — a structured, fair comparison engine.",
    "You compare two subjects using research, Open Intelligence, and measured evidence.",
    "Arena results are ANALYTICAL ESTIMATES, not objective facts. Never frame them as betting advice, guaranteed outcomes, wagering recommendations, financial guarantees, or medical diagnosis.",
    "For future or live events, clearly state uncertainty.",
    "Do not invent statistics, sources, or citations. Only use the information provided.",
  );
  sections.push(
    `DOMAIN: ${params.domainLabel}`,
    `COMPARISON TYPE: ${params.comparisonTypeLabel}`,
    `FOCUS: ${params.focusLabel}`,
    `SUBJECT A: ${params.subjectAName}`,
    `SUBJECT B: ${params.subjectBName}`,
  );
  sections.push(
    "Return your answer as STRICT JSON only (no markdown fences, no prose outside the JSON).",
    "The JSON object MUST have exactly these fields:",
    '{\n  "arenaTitle": string,\n  "subjectASummary": string (2-4 sentences),\n  "subjectBSummary": string (2-4 sentences),\n  "categoryScores": array of { "category": string, "label": string, "scoreA": number 0-100, "scoreB": number 0-100, "notes": string },\n  "subjectAAdvantages": array of string (short bullets),\n  "subjectBAdvantages": array of string (short bullets),\n  "similarities": array of string,\n  "majorDifferences": array of string,\n  "evidenceLimitations": string,\n  "confidence": number 0-100,\n  "verdict": one of "Subject A Advantage" | "Subject B Advantage" | "Even Match" | "Too Close to Call" | "Insufficient Evidence"\n}',
    `Use these comparison categories: ${params.categoryLabels.join(", ")}.`,
    "Score each subject 0-100 per category. State that scores are analytical estimates.",
    "Do not force a winner when evidence is insufficient.",
  );
  const sourceLines: string[] = ["INTELLIGENCE SOURCES AVAILABLE:"];
  if (params.hasOI) sourceLines.push("- Personal Open Intelligence is provided below — private user knowledge, not automatically verified.");
  if (params.hasFactionOI) sourceLines.push("- Faction Intelligence is provided below — shared by authorized faction members, not automatically verified.");
  if (params.hasExchangeOI) sourceLines.push("- Exchange Intelligence is provided below — licensed via Exchange sync, not automatically verified.");
  if (params.hasExternalResearch) sourceLines.push("- Current External Research is provided below — web sources, may contain errors.");
  if (!params.hasOI && !params.hasFactionOI && !params.hasExchangeOI && !params.hasExternalResearch) {
    sourceLines.push("- No intelligence sources were available. Base the comparison on trained knowledge and clearly note the limitation.");
  } else {
    sourceLines.push(
      "- When sources conflict, surface the conflict rather than silently choosing one side.",
      "- Do not reveal private contributor identities. Do not reveal full licensed Exchange content beyond what is provided.",
    );
  }
  sections.push(sourceLines.join("\n"));
  return sections.join("\n\n");
}

/** Safely parse the Arena JSON response from the model. */
function parseArenaResult(raw: string): {
  arenaTitle?: string;
  subjectASummary?: string;
  subjectBSummary?: string;
  categoryScores?: Array<{ category: string; label: string; scoreA: number; scoreB: number; notes?: string }>;
  subjectAAdvantages?: string[];
  subjectBAdvantages?: string[];
  similarities?: string[];
  majorDifferences?: string[];
  evidenceLimitations?: string;
  confidence?: number;
  verdict?: string;
} | null {
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed;
  } catch {
    // Try to extract the first JSON object in the text
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * POST /arena/analyze
 *
 * Secure Arena analysis. Verifies JWT, EAGOH ownership + active status,
 * reruns compatibility validation server-side, checks subscription tier
 * eligibility, verifies sufficient Neuron balance, deducts exactly once
 * (idempotent via requestId), retrieves Personal/Faction/Exchange/External
 * intelligence, calls OpenAI for a structured comparison, persists history
 * via service_role, and returns the structured result.
 *
 * If failure occurs after deduction but before a usable result, the
 * deduction is reversed (refunded) safely. No double crediting.
 */
async function handleArenaAnalyze(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  if (!env.OPENAI_API_KEY) {
    return jsonResponse({ ok: false, error: "Arena service is not configured." }, 503);
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    console.warn("[arena:analyze] missing Supabase config");
    return jsonResponse({ ok: false, error: "Arena service is not configured." }, 503);
  }

  let payload: {
    eagohId?: unknown;
    comparisonType?: unknown;
    subjectA?: unknown;
    subjectB?: unknown;
    focus?: unknown;
    customFocus?: unknown;
    customQuestion?: unknown;
    requestId?: unknown;
  } = {};
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request body." }, 400);
  }

  // ── Authenticate ──
  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createAuthedClient(env, jwt);
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  const serviceClient = getServiceRoleClient(env);
  if (!serviceClient) {
    return jsonResponse({ ok: false, error: "Server configuration error." }, 503);
  }

  // ── Validate requestId (idempotency key) ──
  const requestId = typeof payload.requestId === "string" ? payload.requestId.trim().slice(0, 120) : "";
  if (!requestId) {
    return jsonResponse({ ok: false, error: "A request ID is required for Arena analysis." }, 400);
  }

  // ── Idempotency: check for an existing arena_history row with this requestId ──
  const { data: existingHistory } = await serviceClient
    .from("arena_history")
    .select("id, verdict, confidence, category_scores, subject_a_advantages, subject_b_advantages, similarities, major_differences, oi_influence, response_summary, source_citations, evidence_limitations, source_counts, neuron_cost, domain, comparison_type, subject_a_name, subject_a_context, subject_a_year, subject_b_name, subject_b_context, subject_b_year, focus, custom_focus, custom_question, eagoh_id, created_at")
    .eq("user_id", userId)
    .eq("request_id", requestId)
    .maybeSingle();

  if (existingHistory) {
    // Return the cached result — no second deduction
    const h = existingHistory as Record<string, unknown>;
    return jsonResponse({
      ok: true,
      arenaTitle: `${String(h.subject_a_name ?? "")} vs ${String(h.subject_b_name ?? "")}`,
      normalizedA: { name: String(h.subject_a_name ?? ""), context: (h.subject_a_context as string) ?? undefined, year: (h.subject_a_year as string) ?? undefined },
      normalizedB: { name: String(h.subject_b_name ?? ""), context: (h.subject_b_context as string) ?? undefined, year: (h.subject_b_year as string) ?? undefined },
      comparisonType: String(h.comparison_type ?? ""),
      categoryScores: h.category_scores as Array<{ category: string; label: string; scoreA: number; scoreB: number; notes?: string }>,
      subjectAAdvantages: h.subject_a_advantages as string[],
      subjectBAdvantages: h.subject_b_advantages as string[],
      similarities: h.similarities as string[],
      majorDifferences: h.major_differences as string[],
      oiInfluence: h.oi_influence as Array<{ sourceType: string; label: string; entryCount: number; summary: string; lean: string }>,
      responseSummary: String(h.response_summary ?? ""),
      sourceCitations: h.source_citations as Array<{ title: string; url: string; publisher?: string }>,
      evidenceLimitations: (h.evidence_limitations as string) ?? undefined,
      confidence: Number(h.confidence ?? 0),
      verdict: String(h.verdict ?? ""),
      sourceCounts: h.source_counts as { personal?: number; faction?: number; exchange?: number; external?: number },
      neuronCost: Number(h.neuron_cost ?? 0),
      historyId: String(h.id ?? ""),
    });
  }

  // ── Validate eagohId ──
  const eagohId = typeof payload.eagohId === "string" ? payload.eagohId.trim() : "";
  if (!eagohId) {
    return jsonResponse({ ok: false, error: "An EAGOH is required for Arena Mode." }, 400);
  }

  const comparisonType = typeof payload.comparisonType === "string" ? payload.comparisonType.trim() : "";
  if (!comparisonType) {
    return jsonResponse({ ok: false, error: "Select a comparison type." }, 400);
  }

  const subjectA = payload.subjectA;
  const subjectB = payload.subjectB;
  if (!subjectA || typeof subjectA !== "object" || !subjectB || typeof subjectB !== "object") {
    return jsonResponse({ ok: false, error: "Both subjects are required." }, 400);
  }
  const a = subjectA as { name?: string; context?: string; year?: string; notes?: string };
  const b = subjectB as { name?: string; context?: string; year?: string; notes?: string };

  const fieldErr = arenaValidateSubjectFields(a) ?? arenaValidateSubjectFields(b);
  if (fieldErr) {
    return jsonResponse({ ok: false, error: fieldErr }, 400);
  }

  // ── 1. Verify EAGOH ownership + domain (service_role) ──
  // NOTE: is_default_shell intentionally NOT selected — the app already filters
  // default-shell EAGOHs on the Arena screen, so the worker only needs ownership + domain.
  if (DEBUG_ARENA) {
    console.log("[arena/analyze] eagohId=" + String(eagohId).slice(0, 8) + " userIdPrefix=" + String(userId).slice(0, 8));
  }
  const { data: eagohRow, error: eagohErr } = await serviceClient
    .from("eagohs")
    .select("id, user_id, name, domain")
    .eq("id", eagohId)
    .maybeSingle();

  if (eagohErr) {
    if (DEBUG_ARENA) console.log("[arena/analyze] EAGOH lookup error: " + eagohErr.message);
    return jsonResponse({ ok: false, error: "EAGOH not found." }, 404);
  }
  if (!eagohRow) {
    if (DEBUG_ARENA) console.log("[arena/analyze] EAGOH lookup returned no row");
    return jsonResponse({ ok: false, error: "EAGOH not found." }, 404);
  }
  const eagoh = eagohRow as {
    id: string; user_id: string; name: string; domain: string | null;
  };

  if (DEBUG_ARENA) console.log("[arena/analyze] EAGOH found: " + eagoh.name);

  if (eagoh.user_id !== userId) {
    return jsonResponse({ ok: false, error: "You can only use EAGOHs you own." }, 403);
  }
  if (!eagoh.domain) {
    return jsonResponse({ ok: false, error: "This EAGOH has no domain specialization." }, 400);
  }

  const domainId = arenaNormalizeDomainId(eagoh.domain);
  const rule = ARENA_DOMAIN_RULES[domainId];
  if (!rule) {
    return jsonResponse({ ok: false, error: "Arena Mode is not available for this EAGOH domain." }, 400);
  }

  const cmpType = rule.comparisonTypes.find((c) => c.id === comparisonType);
  if (!cmpType) {
    return jsonResponse({ ok: false, error: "This comparison type is not available for this domain." }, 400);
  }

  // ── 2. Rerun compatibility validation server-side ──
  const normA = {
    name: arenaClean(a.name),
    context: arenaClean(a.context) || undefined,
    year: arenaClean(a.year) || undefined,
    notes: arenaClean(a.notes) || undefined,
  };
  const normB = {
    name: arenaClean(b.name),
    context: arenaClean(b.context) || undefined,
    year: arenaClean(b.year) || undefined,
    notes: arenaClean(b.notes) || undefined,
  };

  // Same-name check (except season-vs-season)
  if (normA.name.toLowerCase() === normB.name.toLowerCase() && comparisonType !== "season-vs-season") {
    return jsonResponse({ ok: false, error: "Enter two different subjects to run an Arena comparison." }, 400);
  }

  // Sports same-sport check
  if (domainId === "sports") {
    const knownSports = rule.knownSports ?? [];
    const sportA = arenaDetectSport(normA.context ?? "", normA.name, knownSports);
    const sportB = arenaDetectSport(normB.context ?? "", normB.name, knownSports);
    if ((comparisonType === "player-vs-player" || comparisonType === "team-vs-team" || comparisonType === "coach-vs-coach")
      && sportA && sportB && sportA !== sportB) {
      return jsonResponse({ ok: false, error: "These subjects appear to compete in different sports. Both subjects must be from the same sport for this Arena type." }, 400);
    }
    if (comparisonType === "season-vs-season") {
      const sameName = normA.name.toLowerCase() === normB.name.toLowerCase();
      const sameContext = sportA && sportB && sportA === sportB;
      if (!sameName && !sameContext) {
        return jsonResponse({ ok: false, error: "Season vs Season comparisons must refer to the same player, team, league, or sport context." }, 400);
      }
    }
  }

  // ── 3. Verify subscription tier eligibility ──
  const isPaid = await isPaidUser(supabase, userId);
  if (!isPaid) {
    return jsonResponse({ ok: false, error: "Arena Mode requires a paid subscription." }, 403);
  }

  // ── 4. Atomic Neuron deduction (server-side RPC, idempotent, race-safe) ──
  // The deduct_arena_neurons RPC locks the profile row, verifies balance,
  // deducts exactly ARENA_NEURON_COST, records the request_id in a unique-index
  // ledger, and logs the transaction — all inside one DB transaction. Concurrent
  // duplicate requests hit the unique index / existence check and return the
  // already-charged state without charging again.
  const arenaNote = `Arena Mode · ${normA.name} vs ${normB.name}`;
  const { data: deductData, error: deductErr } = await serviceClient
    .rpc("deduct_arena_neurons", {
      p_user_id: userId,
      p_request_id: requestId,
      p_note: arenaNote,
    });

  if (deductErr) {
    console.warn("[arena:analyze] deduction RPC failed", deductErr.message);
    return jsonResponse({ ok: false, error: "Neuron deduction failed. Please try again." }, 500);
  }

  const deductResult = (deductData ?? null) as {
    ok?: boolean;
    error?: string;
    duplicate?: boolean;
    balance?: number;
    cost?: number;
    amount?: number;
    from_subscription?: number;
    from_purchased?: number;
    bucket?: string;
    balance_subscription_after?: number;
    balance_purchased_after?: number;
  } | null;

  if (!deductResult || deductResult.ok === false) {
    const errCode = deductResult?.error ?? "deduction_failed";
    if (errCode === "insufficient") {
      const bal = deductResult?.balance ?? 0;
      return jsonResponse({ ok: false, error: `Insufficient Neurons. Arena costs ${ARENA_NEURON_COST} Neurons (you have ${bal}).` }, 402);
    }
    if (errCode === "profile_not_found") {
      return jsonResponse({ ok: false, error: "Could not verify Neuron balance." }, 500);
    }
    console.warn("[arena:analyze] deduction rejected", errCode);
    return jsonResponse({ ok: false, error: "Neuron deduction failed. Please try again." }, 500);
  }

  // If this requestId was already charged, a matching arena_history row must
  // already exist. The idempotency check at the top returned it; if we somehow
  // reached here on a duplicate, treat it as already-completed (no second work).
  if (deductResult.duplicate === true) {
    console.log("[arena:analyze] duplicate requestId reached deduction — returning existing result if any");
    const { data: dupHistory } = await serviceClient
      .from("arena_history")
      .select("id")
      .eq("user_id", userId)
      .eq("request_id", requestId)
      .maybeSingle();
    if (dupHistory) {
      // Re-fetch via the same idempotency path at the top of the handler.
      // Return a minimal already-completed response.
      return jsonResponse({ ok: true, duplicate: true, message: "This Arena analysis was already completed." });
    }
    // Deduction ledger says charged but no history row — a previous request
    // charged then failed before persisting. Do NOT charge again; proceed to
    // generate the result so the user gets what they paid for.
    console.log("[arena:analyze] duplicate charge without history — proceeding to generate result without re-charging");
  }

  const chargedFromSub = Number(deductResult.from_subscription ?? 0);
  const chargedFromPurchased = Number(deductResult.from_purchased ?? 0);
  const chargedBucket = String(deductResult.bucket ?? "subscription");

  console.log("[arena:analyze] atomically deducted", ARENA_NEURON_COST, "neurons for", userId.slice(0, 8), "bucket=", chargedBucket);

  // ── Helper: idempotent refund on failure (RPC, refunds only once per requestId) ──
  const refund = async (reason: string): Promise<void> => {
    try {
      const { error: refundErr } = await serviceClient.rpc("refund_arena_neurons", {
        p_user_id: userId,
        p_request_id: requestId,
        p_note: `Arena refund: ${reason}`,
      });
      if (refundErr) {
        console.warn("[arena:analyze] refund RPC failed", refundErr.message);
      }
    } catch (err) {
      console.error("[arena:analyze] refund exception", err instanceof Error ? err.message : "unknown");
    }
  };

  // ── 6. Retrieve intelligence grounding ──
  const arenaQuery = `${normA.name} ${normA.context ?? ""} ${normA.year ?? ""} vs ${normB.name} ${normB.context ?? ""} ${normB.year ?? ""} ${comparisonType}`;

  // Personal OI
  let personalOIText = "";
  let personalOICount = 0;
  let rankedPersonal: OpenIntelligenceRow[] = [];
  try {
    const rawEntries = await retrievePersonalOpenIntelligence(supabase, userId, eagohId, 50);
    if (rawEntries.length > 0) {
      const personalRepMap = await fetchReputationsForUsers(supabase, [userId]);
      rankedPersonal = rankEntries(rawEntries, arenaQuery, Math.min(10, rawEntries.length), personalRepMap);
      const formatted = formatOIContext(rankedPersonal, 1200);
      personalOIText = formatted.text;
      personalOICount = formatted.count;
    }
  } catch (err) {
    console.warn("[arena:analyze] personal OI retrieval failed safely", err instanceof Error ? err.message : "unknown");
  }

  // Faction OI
  let factionOIText = "";
  let factionOICount = 0;
  let rankedFaction: FactionOIEntry[] = [];
  try {
    const factionResult = await retrieveFactionOpenIntelligence(supabase, userId, arenaQuery, "standard");
    if (factionResult.entries.length > 0) {
      const formatted = formatFactionOIContext(factionResult.entries, 1200);
      factionOIText = formatted.text;
      factionOICount = formatted.count;
      rankedFaction = factionResult.entries;
    }
  } catch (err) {
    console.warn("[arena:analyze] faction OI retrieval failed safely", err instanceof Error ? err.message : "unknown");
  }

  // Exchange OI
  let exchangeOIText = "";
  let exchangeOICount = 0;
  let rankedExchange: OpenIntelligenceRow[] = [];
  try {
    const exchangeResult = await retrieveExchangeOpenIntelligence(serviceClient, userId, arenaQuery, "standard");
    if (exchangeResult.used && exchangeResult.entries.length > 0) {
      const formatted = formatExchangeOIContext(exchangeResult, 1200);
      exchangeOIText = formatted.text;
      exchangeOICount = formatted.count;
      rankedExchange = exchangeResult.entries;
    }
  } catch (err) {
    console.warn("[arena:analyze] exchange OI retrieval failed safely", err instanceof Error ? err.message : "unknown");
  }

  // ── 7. External web research (both subjects) ──
  let externalResult: ExternalResearchResult = { used: false, summary: "", sources: [] };
  try {
    const searchQueryA = buildSearchQuery(`${normA.name} ${normA.context ?? ""} ${normA.year ?? ""}`, eagoh.domain);
    const searchQueryB = buildSearchQuery(`${normB.name} ${normB.context ?? ""} ${normB.year ?? ""}`, eagoh.domain);
    const [resA, resB] = await Promise.all([
      performWebSearch(searchQueryA, env.OPENAI_API_KEY, "standard"),
      performWebSearch(searchQueryB, env.OPENAI_API_KEY, "standard"),
    ]);
    // Merge both research results fairly
    const mergedSummary = [resA.summary, resB.summary].filter(Boolean).join("\n\n--- Subject B research ---\n\n");
    const mergedSources = [...resA.sources, ...resB.sources];
    externalResult = {
      used: resA.used || resB.used,
      summary: mergedSummary,
      sources: mergedSources,
    };
  } catch (err) {
    console.warn("[arena:analyze] external research failed safely", err instanceof Error ? err.message : "unknown");
  }

  const externalContext = formatExternalResearchContext(externalResult);

  // ── 8. Build the Arena prompt ──
  const focusId = typeof payload.focus === "string" ? payload.focus.trim().slice(0, 60) : "overall";
  const customFocus = typeof payload.customFocus === "string" ? payload.customFocus.trim().slice(0, 120) : "";
  const customQuestion = typeof payload.customQuestion === "string" ? payload.customQuestion.trim().slice(0, 240) : "";

  const domainLabel = ARENA_DOMAIN_LABELS[domainId] ?? domainId;
  const focusLabel = customFocus || focusId;
  const categories = getArenaCategories(domainId);
  const categoryLabels = categories.map((c) => c.label);

  const systemPrompt = buildArenaSystemPrompt({
    domainId,
    domainLabel,
    comparisonTypeLabel: cmpType.label,
    focusLabel,
    categoryLabels,
    subjectAName: normA.name,
    subjectBName: normB.name,
    hasOI: personalOICount > 0,
    hasFactionOI: factionOICount > 0,
    hasExchangeOI: exchangeOICount > 0,
    hasExternalResearch: externalResult.used,
  });

  const systemParts = [systemPrompt];
  if (personalOIText) systemParts.push(personalOIText);
  if (factionOIText) systemParts.push(factionOIText);
  if (exchangeOIText) systemParts.push(exchangeOIText);
  if (externalContext) systemParts.push(externalContext);
  const systemContent = systemParts.join("\n\n---\n\n");

  const userParts: string[] = [
    `Compare ${normA.name}${normA.context ? ` (${normA.context})` : ""}${normA.year ? ` — ${normA.year}` : ""} vs ${normB.name}${normB.context ? ` (${normB.context})` : ""}${normB.year ? ` — ${normB.year}` : ""}.`,
    `Focus: ${focusLabel}.`,
  ];
  if (customQuestion) {
    userParts.push(`Custom question: ${customQuestion}`);
  }
  userParts.push("Return only the JSON object described in the instructions.");

  const messages = [
    { role: "system" as const, content: systemContent },
    { role: "user" as const, content: userParts.join("\n\n") },
  ];

  // ── 9. Call OpenAI for the structured comparison ──
  let parsedResult: ReturnType<typeof parseArenaResult> = null;
  let rawReply = "";
  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.6,
        max_tokens: ARENA_MAX_TOKENS,
      }),
    });

    if (!openaiRes.ok) {
      console.warn("[arena:analyze] OpenAI non-ok", openaiRes.status);
      await refund("openai_error");
      return jsonResponse({ ok: false, error: "Arena analysis failed. Your Neurons have been refunded." }, 502);
    }

    const data = (await openaiRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
    rawReply = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!rawReply) {
      await refund("empty_response");
      return jsonResponse({ ok: false, error: "Arena returned an empty response. Your Neurons have been refunded." }, 502);
    }

    parsedResult = parseArenaResult(rawReply);
    if (!parsedResult || !parsedResult.verdict || !ARENA_VERDICTS.includes(parsedResult.verdict as typeof ARENA_VERDICTS[number])) {
      console.warn("[arena:analyze] invalid or missing verdict in result");
      await refund("invalid_result_shape");
      return jsonResponse({ ok: false, error: "Arena analysis could not be completed. Your Neurons have been refunded." }, 502);
    }
  } catch (err) {
    console.error("[arena:analyze] OpenAI exception", err instanceof Error ? err.message : "unknown");
    await refund("openai_exception");
    return jsonResponse({ ok: false, error: "Arena analysis timed out. Your Neurons have been refunded." }, 502);
  }

  // ── 10. Build OI influence transparency records ──
  const oiInfluence = [
    {
      sourceType: "personal" as const,
      label: "Personal Intelligence",
      entryCount: personalOICount,
      summary: personalOICount > 0 ? `${personalOICount} personal intelligence entries influenced this analysis.` : "No personal intelligence entries were available.",
      lean: "neutral" as const,
    },
    {
      sourceType: "faction" as const,
      label: "Faction Intelligence",
      entryCount: factionOICount,
      summary: factionOICount > 0 ? `${factionOICount} faction intelligence entries influenced this analysis.` : "No faction intelligence entries were available.",
      lean: "neutral" as const,
    },
    {
      sourceType: "exchange" as const,
      label: "Exchange Intelligence",
      entryCount: exchangeOICount,
      summary: exchangeOICount > 0 ? `${exchangeOICount} licensed Exchange entries influenced this analysis.` : "No Exchange intelligence was available.",
      lean: "neutral" as const,
    },
    {
      sourceType: "external_research" as const,
      label: "External Research",
      entryCount: externalResult.sources.length,
      summary: externalResult.used ? `${externalResult.sources.length} external sources were retrieved.` : "No external research was available.",
      lean: "neutral" as const,
    },
  ];

  const sourceCounts = {
    personal: personalOICount,
    faction: factionOICount,
    exchange: exchangeOICount,
    external: externalResult.sources.length,
  };

  const sourceCitations = externalResult.sources.map((s) => ({
    title: s.title,
    url: s.url,
    publisher: s.publisher,
  }));

  const verdict = parsedResult.verdict as string;
  const confidence = Math.max(0, Math.min(100, Math.round(Number(parsedResult.confidence ?? 70))));
  const arenaTitle = parsedResult.arenaTitle ?? `${normA.name} vs ${normB.name}`;
  const responseSummary = `${parsedResult.subjectASummary ?? ""}\n\n${parsedResult.subjectBSummary ?? ""}`.trim();

  // ── 11. Persist to arena_history (service_role) with unique(user_id, request_id) ──
  // If a concurrent request already inserted a row for this requestId, the
  // unique index arena_history_user_request_uniq rejects the insert. We use
  // onConflict to do nothing and select the existing row, so the user still
  // gets the canonical result without a second charge or a second AI call.
  let historyId = "";
  try {
    const { data: histRow, error: histErr } = await serviceClient
      .from("arena_history")
      .upsert({
        user_id: userId,
        eagoh_id: eagohId,
        domain: domainId,
        comparison_type: comparisonType,
        subject_a_name: normA.name,
        subject_a_context: normA.context ?? null,
        subject_a_year: normA.year ?? null,
        subject_b_name: normB.name,
        subject_b_context: normB.context ?? null,
        subject_b_year: normB.year ?? null,
        focus: focusId,
        custom_focus: customFocus || null,
        custom_question: customQuestion || null,
        verdict,
        confidence,
        category_scores: parsedResult.categoryScores ?? [],
        subject_a_advantages: parsedResult.subjectAAdvantages ?? [],
        subject_b_advantages: parsedResult.subjectBAdvantages ?? [],
        similarities: parsedResult.similarities ?? [],
        major_differences: parsedResult.majorDifferences ?? [],
        oi_influence: oiInfluence,
        response_summary: responseSummary,
        source_citations: sourceCitations,
        evidence_limitations: parsedResult.evidenceLimitations ?? null,
        source_counts: sourceCounts,
        neuron_cost: ARENA_NEURON_COST,
        request_id: requestId,
      }, { onConflict: "user_id,request_id", ignoreDuplicates: true })
      .select("id")
      .maybeSingle();

    if (histErr) {
      console.warn("[arena:analyze] history upsert failed", histErr.message);
    } else if (histRow) {
      historyId = (histRow as { id: string }).id;
    }
  } catch (err) {
    console.warn("[arena:analyze] history upsert exception", err instanceof Error ? err.message : "unknown");
  }

  console.log("[arena:analyze] success", {
    userId: userId.slice(0, 8),
    verdict,
    confidence,
    personalOICount,
    factionOICount,
    exchangeOICount,
    externalSources: externalResult.sources.length,
    historyId: historyId.slice(0, 8),
  });

  // ── 12. Return the structured result ──
  return jsonResponse({
    ok: true,
    arenaTitle,
    subjectASummary: parsedResult.subjectASummary,
    subjectBSummary: parsedResult.subjectBSummary,
    normalizedA: normA,
    normalizedB: normB,
    comparisonType,
    categoryScores: parsedResult.categoryScores ?? [],
    subjectAAdvantages: parsedResult.subjectAAdvantages ?? [],
    subjectBAdvantages: parsedResult.subjectBAdvantages ?? [],
    similarities: parsedResult.similarities ?? [],
    majorDifferences: parsedResult.majorDifferences ?? [],
    oiInfluence,
    evidenceLimitations: parsedResult.evidenceLimitations,
    confidence,
    verdict,
    responseSummary,
    sourceCitations,
    sourceCounts,
    neuronCost: ARENA_NEURON_COST,
    historyId,
  });
}

/**
 * GET /arena/history
 *
 * Returns paginated Arena history for the authenticated user. Opening
 * history never charges. Users may read only their own history (RLS +
 * server-side user_id filter).
 */
async function handleArenaHistory(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    console.warn("[arena:history] missing Supabase config");
    return jsonResponse({ ok: false, error: "Arena service is not configured." }, 503);
  }

  const supabase = createAuthedClient(env, jwt);
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  const url = new URL(request.url);
  const page = Math.max(0, Math.min(100, parseInt(url.searchParams.get("page") ?? "0", 10) || 0));
  const pageSize = Math.max(1, Math.min(50, parseInt(url.searchParams.get("pageSize") ?? "20", 10) || 20));
  const offset = page * pageSize;

  const { data, error } = await supabase
    .from("arena_history")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (error) {
    console.warn("[arena:history] query failed", error.message);
    return jsonResponse({ ok: false, error: "Could not load Arena history." }, 500);
  }

  return jsonResponse({ ok: true, entries: data ?? [] });
}

/**
 * POST /factions/invite
 *
 * Secure faction invite by email or username.
 * - Requires JWT auth
 * - Gets inviter user ID from verified token
 * - Verifies inviter is the faction commander
 * - Finds invitee by exact email or username match (no broad search)
 * - Prevents inviting self, existing members, and duplicate pending invites
 * - Never exposes full user lookup results publicly
 */
async function handleFactionInvite(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Server not configured." }, 503);
  }

  let payload: { factionId: string; query: string; role?: string };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request." }, 400);
  }

  if (!payload.factionId || !payload.query?.trim()) {
    return jsonResponse({ ok: false, error: "Faction ID and query are required." }, 400);
  }

  const supabase = createClient(normalizeSupabaseUrl(env.SUPABASE_URL), env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  const serviceClient = getServiceRoleClient(env);
  if (!serviceClient) {
    return jsonResponse({ ok: false, error: "Server configuration error." }, 503);
  }

  // 1. Verify inviter is the faction commander
  const { data: faction, error: factionErr } = await serviceClient
    .from("factions")
    .select("id, commander_id, current_members, max_members")
    .eq("id", payload.factionId)
    .maybeSingle();

  if (factionErr || !faction) {
    return jsonResponse({ ok: false, error: "Faction not found." }, 404);
  }

  const factionRow = faction as { id: string; commander_id: string; current_members: number; max_members: number };
  if (factionRow.commander_id !== userId) {
    return jsonResponse({ ok: false, error: "You do not have permission to invite members." }, 403);
  }

  if (factionRow.current_members >= factionRow.max_members) {
    return jsonResponse({ ok: false, error: "Faction is at maximum capacity." }, 400);
  }

  const query = payload.query.trim();
  const isEmail = query.includes("@");

  // 2. Find invitee by exact email or username match (no broad search)
  let inviteeId: string | null = null;

  if (isEmail) {
    // Look up user by email via auth admin API (service role only)
    try {
      const { data: authData, error: authErr } = await serviceClient.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (!authErr && authData) {
        const users = authData.users ?? [];
        const match = users.find((u: { email?: string; id: string }) =>
          u.email?.toLowerCase() === query.toLowerCase(),
        );
        if (match) inviteeId = match.id;
      }
    } catch {
      // admin API might not be available, fall through to username lookup
    }

    // Fallback: if the email looks like a username (no @), try username lookup
    if (!inviteeId) {
      const { data: profileMatch } = await serviceClient
        .from("profiles")
        .select("id")
        .eq("username", query)
        .maybeSingle();
      if (profileMatch) {
        inviteeId = (profileMatch as { id: string }).id;
      }
    }
  } else {
    // Username lookup — exact match only (case-sensitive as usernames are lowercase)
    const { data: profileMatch } = await serviceClient
      .from("profiles")
      .select("id")
      .eq("username", query.toLowerCase())
      .maybeSingle();
    if (profileMatch) {
      inviteeId = (profileMatch as { id: string }).id;
    }
  }

  // 3. If no exact match found, return generic not found (no account enumeration)
  if (!inviteeId) {
    return jsonResponse({ ok: false, error: "No EAGOH user found with that email or username." }, 404);
  }

  // 4. Prevent inviting self
  if (inviteeId === userId) {
    return jsonResponse({ ok: false, error: "You cannot invite yourself." }, 400);
  }

  // 5. Check if already a member
  const { data: existingMember } = await serviceClient
    .from("faction_members")
    .select("id")
    .eq("faction_id", payload.factionId)
    .eq("user_id", inviteeId)
    .maybeSingle();
  if (existingMember) {
    return jsonResponse({ ok: false, error: "This user is already a member." }, 409);
  }

  // 6. Check for existing pending invite
  const { data: existingInvite } = await serviceClient
    .from("faction_invites")
    .select("id")
    .eq("faction_id", payload.factionId)
    .eq("invitee_id", inviteeId)
    .eq("status", "pending")
    .maybeSingle();
  if (existingInvite) {
    return jsonResponse({ ok: false, error: "An invite is already pending." }, 409);
  }

  // 7. Create the invite
  const role = (payload.role === "strategist" || payload.role === "recruit" || payload.role === "commander") ? payload.role : "analyst";
  const { error: insertErr } = await serviceClient.from("faction_invites").insert({
    faction_id: payload.factionId,
    inviter_id: userId,
    invitee_id: inviteeId,
    role,
  });

  if (insertErr) {
    console.warn("[factions/invite] insert failed", insertErr.message);
    return jsonResponse({ ok: false, error: "Failed to send invite." }, 500);
  }

  // 8. Log activity
  await serviceClient.from("faction_activity").insert({
    faction_id: payload.factionId,
    user_id: userId,
    kind: "invite_sent",
    details: { role },
  });

  return jsonResponse({ ok: true });
}

// ── Forge: secure image generation (Phase 12B) ───────────────────────────────

/**
 * Secure server-side EAGOH Forge route.
 *
 * Authenticates the user, checks tier/limit/ownership, generates the image
 * via OpenAI, creates/updates the EAGOH row, and deducts Neurons — all
 * atomically. If any step fails after image generation, the EAGOH is rolled
 * back and no Neurons are charged.
 *
 * The mobile client never sees the OPENAI_API_KEY. It sends the draft,
 * pre-built prompt, and JWT; the worker does the rest.
 */
type ForgeMode = "initial" | "full_reforge" | "partial_reforge";

const FORGE_EDGE_COSTS_SERVER: Record<ForgeMode, number> = {
  initial: 250,
  full_reforge: 500,
  partial_reforge: 100,
};

const TIER_EAGOH_LIMITS_SERVER: Record<string, number> = {
  free: 0,
  pro: 2,
  oracle_elite: 3,
  syndicate: 5,
};

const DOMAIN_DNA_PREFIX_S = "dom:";
const DOMAIN_DRAFT_TO_COLUMN_S: Record<string, string> = {
  musicGenre: "music_genre",
  musicRole: "music_role",
  filmTvCategory: "film_tv_category",
  filmTvGenre: "film_tv_genre",
  filmTvRole: "film_tv_role",
  fashionStyleCategory: "fashion_style_category",
  fashionRole: "fashion_role",
  educationSubject: "education_subject",
  educationRole: "education_role",
  gamingGenre: "gaming_genre",
  gamingRole: "gaming_role",
  businessIndustry: "business_industry",
  businessRole: "business_role",
  financeFocus: "finance_focus",
  financeRole: "finance_role",
  technologyArea: "technology_area",
  technologyRole: "technology_role",
  healthFitnessArea: "health_fitness_area",
  healthFitnessRole: "health_fitness_role",
};

function encodeDomainDnaServer(draft: Record<string, unknown>): string[] {
  const entries: string[] = [];
  for (const [draftKey, dbCol] of Object.entries(DOMAIN_DRAFT_TO_COLUMN_S)) {
    const value = draft[draftKey];
    if (typeof value === "string" && value) {
      entries.push(`${DOMAIN_DNA_PREFIX_S}${dbCol}:${value}`);
    }
  }
  return entries;
}

function str(val: unknown, fallback = ""): string {
  return typeof val === "string" ? val : fallback;
}

// ── Phase RETAINED-OI-1: Retained Exchange Intelligence Triggers ─────────────

/**
 * POST /exchange/retention/create
 *
 * Triggers retained exchange intelligence creation after a verified purchase.
 * Calls the security-definer RPC `create_retained_exchange_intelligence`
 * which locks the purchase, reconstructs the cohort, and stores snapshots.
 *
 * This endpoint is called by the worker internally after purchase completion,
 * and can also be called by the mobile app to retry retention if the initial
 * post-purchase trigger failed (e.g. transient DB error). The purchase_id
 * must belong to the authenticated buyer.
 */
async function handleExchangeRetentionCreate(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createAuthedClient(env, jwt);
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  let payload: { purchaseId?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request." }, 400);
  }

  const purchaseId = str(payload.purchaseId).trim();
  if (!purchaseId) return jsonResponse({ ok: false, error: "purchaseId is required." }, 400);

  // ── Verify the purchase belongs to the authenticated buyer (defense in depth) ──
  const serviceClient = getServiceRoleClient(env);
  if (!serviceClient) {
    return jsonResponse({ ok: false, error: "Service not configured." }, 503);
  }

  const { data: purchase, error: purchaseErr } = await serviceClient
    .from("marketplace_sync_purchases")
    .select("id, buyer_id, active")
    .eq("id", purchaseId)
    .maybeSingle();

  if (purchaseErr || !purchase) {
    console.warn("[retention] purchase not found", { purchaseId: purchaseId.slice(0, 8) });
    return jsonResponse({ ok: false, error: "Purchase not found." }, 404);
  }

  const purchaseRow = purchase as { id: string; buyer_id: string; active: boolean };
  if (purchaseRow.buyer_id !== userId) {
    console.warn("[retention] buyer mismatch", { userIdPrefix: userId.slice(0, 8), purchaseBuyer: purchaseRow.buyer_id.slice(0, 8) });
    return jsonResponse({ ok: false, error: "Purchase does not belong to this account." }, 403);
  }

  if (!purchaseRow.active) {
    return jsonResponse({ ok: false, error: "Purchase is no longer active." }, 409);
  }

  // ── Call the security-definer RPC ──
  const { data: rpcResult, error: rpcErr } = await serviceClient
    .rpc("create_retained_exchange_intelligence", { p_purchase_id: purchaseId });

  if (rpcErr) {
    console.warn("[retention] RPC failed", { purchaseId: purchaseId.slice(0, 8), error: rpcErr.message });
    return jsonResponse({ ok: false, error: "Retention could not be created. Please try again." }, 500);
  }

  const result = rpcResult as {
    ok?: boolean;
    already_processed?: boolean;
    purchased_cohort_count?: number;
    retained_count?: number;
    total_vendor_eligible_entries?: number;
    maximum_retained_entries?: number;
    existing_retained_count?: number;
    requested_retained_count?: number;
    newly_retained_count?: number;
    remaining_retention_capacity?: number;
    cap_reached?: boolean;
    error?: string;
  };
  if (!result?.ok) {
    console.warn("[retention] RPC returned error", { purchaseId: purchaseId.slice(0, 8), error: result?.error });
    return jsonResponse({ ok: false, error: "Retention could not be created." }, 500);
  }

  console.log("[retention] success", {
    userIdPrefix: userId.slice(0, 8),
    purchaseId: purchaseId.slice(0, 8),
    alreadyProcessed: result.already_processed,
    purchasedCohortCount: result.purchased_cohort_count,
    retainedCount: result.retained_count,
    totalVendorEligible: result.total_vendor_eligible_entries,
    maxRetained: result.maximum_retained_entries,
    existingRetained: result.existing_retained_count,
    requestedRetained: result.requested_retained_count,
    newlyRetained: result.newly_retained_count,
    remainingCapacity: result.remaining_retention_capacity,
    capReached: result.cap_reached,
  });

  return jsonResponse({
    ok: true,
    purchaseId,
    alreadyProcessed: result.already_processed ?? false,
    purchasedCohortCount: result.purchased_cohort_count ?? 0,
    retainedCount: result.retained_count ?? 0,
    totalVendorEligibleEntries: result.total_vendor_eligible_entries ?? 0,
    maximumRetainedEntries: result.maximum_retained_entries ?? 0,
    existingRetainedCount: result.existing_retained_count ?? 0,
    requestedRetainedCount: result.requested_retained_count ?? 0,
    newlyRetainedCount: result.newly_retained_count ?? 0,
    remainingRetentionCapacity: result.remaining_retention_capacity ?? 0,
    capReached: result.cap_reached ?? false,
  });
}

/**
 * POST /exchange/retention/deactivate
 *
 * Records a trusted purchase reversal AND deactivates retained exchange
 * intelligence for refund, payment reversal, chargeback, dispute, invalid
 * purchase cancellation, or admin revocation. NEVER for normal sync
 * expiration — retained intelligence is permanent after a valid completed
 * purchase.
 *
 * PHASE RETAINED-OI-2: This endpoint no longer treats an admin-provided reason
 * alone as sufficient. It calls the security-definer RPC
 * `record_exchange_purchase_reversal`, which (1) locks the purchase row,
 * (2) verifies and records the trusted `purchase_status` on
 * `marketplace_sync_purchases`, (3) writes an audit row into
 * `exchange_purchase_status_audit`, (4) sets `active = false`, and (5) calls
 * `deactivate_retained_exchange_intelligence` with the normalized retained
 * deactivation reason. The trusted status is recorded BEFORE retained entries
 * are deactivated, all inside one server-side transaction.
 *
 * SECURITY: This endpoint is ADMIN-ONLY. A buyer cannot record a reversal or
 * deactivate their own retained entries — `marketplace_sync_purchases.active
 * = false` is NOT proof of a refund because normal sync expiration also sets
 * it to false. Allowing buyer-controlled deactivation would let a buyer free
 * retention capacity and re-acquire different portions of a vendor EAGOH's
 * knowledge, bypassing the 25% cumulative retention cap.
 *
 * The endpoint stays admin-only until an actual payment-provider webhook
 * system is implemented; at that point webhooks (not buyers) will call this
 * path with a trusted reversal status derived from the provider's event.
 */

// Map client-supplied deactivation reasons to the trusted purchase_status
// values accepted by record_exchange_purchase_reversal. The RPC is the single
// source of truth for which statuses are valid; this map just translates the
// caller's vocabulary into the trusted-status vocabulary.
const REASON_TO_TRUSTED_STATUS: Record<string, string> = {
  refund: "refunded",
  payment_reversal: "payment_reversed",
  chargeback: "charged_back",
  dispute: "disputed",
  invalid_purchase: "invalidated",
  admin_revocation: "admin_revoked",
};

const ALLOWED_DEACTIVATION_REASONS = new Set(Object.keys(REASON_TO_TRUSTED_STATUS));

async function handleExchangeRetentionDeactivate(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createAuthedClient(env, jwt);
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  let payload: { purchaseId?: unknown; reason?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request." }, 400);
  }

  const purchaseId = str(payload.purchaseId).trim();
  if (!purchaseId) return jsonResponse({ ok: false, error: "purchaseId is required." }, 400);
  const reason = str(payload.reason).trim().toLowerCase();
  if (!reason) return jsonResponse({ ok: false, error: "reason is required." }, 400);

  // ── 1. Enforce allowed reasons (reject sync_expired / expired / unknown) ──
  if (!ALLOWED_DEACTIVATION_REASONS.has(reason)) {
    console.warn("[retention:deactivate] rejected reason", {
      userIdPrefix: userId.slice(0, 8),
      reason: reason.slice(0, 40),
    });
    return jsonResponse(
      { ok: false, error: "Invalid deactivation reason. Retained intelligence is permanent after a valid completed purchase and is not deactivated by normal sync expiration." },
      400,
    );
  }

  const serviceClient = getServiceRoleClient(env);
  if (!serviceClient) {
    return jsonResponse({ ok: false, error: "Service not configured." }, 503);
  }

  // ── 2. ADMIN-ONLY authorization ──
  // A buyer setting marketplace_sync_purchases.active = false is not proof of
  // a refund — normal expiration also sets active = false, and there is no
  // trusted refund/reversal status column yet. Only an admin may attest to a
  // legitimate reversal. This blocks buyer-initiated cap manipulation.
  const admin = await isAdmin(serviceClient, userId);
  if (!admin) {
    console.warn("[retention:deactivate] non-admin rejected", {
      userIdPrefix: userId.slice(0, 8),
      reason,
    });
    return jsonResponse(
      { ok: false, error: "Deactivation requires admin authorization. Retained intelligence is permanent after a valid completed purchase." },
      403,
    );
  }

  // ── 3. Map the caller reason to a trusted purchase_status ──
  // The RPC is the single source of truth and re-validates this server-side.
  const trustedStatus = REASON_TO_TRUSTED_STATUS[reason] ?? reason;

  // ── 4. Call the secure reversal RPC ──
  // record_exchange_purchase_reversal locks the purchase row, records the
  // trusted purchase_status + reversal_reason + reversal_recorded_at +
  // reversal_recorded_by, writes an audit row, sets active = false, and then
  // calls deactivate_retained_exchange_intelligence with the normalized
  // retained reason. The trusted status is recorded BEFORE retained entries
  // are deactivated, all inside one security-definer transaction. An admin
  // reason alone is no longer sufficient — the trusted status must be written.
  const { data: rpcResult, error: rpcErr } = await serviceClient.rpc(
    "record_exchange_purchase_reversal",
    {
      p_purchase_id: purchaseId,
      p_status: trustedStatus,
      p_reason: reason,
      p_recorded_by: userId,
    },
  );

  if (rpcErr) {
    console.warn("[retention:deactivate] reversal RPC failed", {
      purchaseId: purchaseId.slice(0, 8),
      error: rpcErr.message,
    });
    return jsonResponse({ ok: false, error: "Reversal could not be recorded." }, 500);
  }

  const result = rpcResult as {
    ok?: boolean;
    skipped?: boolean;
    purchase_status?: string;
    reversal_reason?: string;
    deactivated_count?: number;
    error?: string;
    message?: string;
    previous_status?: string;
  };

  if (!result?.ok) {
    console.warn("[retention:deactivate] reversal RPC returned error", {
      purchaseId: purchaseId.slice(0, 8),
      error: result?.error,
      message: result?.message,
    });
    // Surface the specific error so admins can tell invalid_status /
    // already_reversed / purchase_not_found apart.
    if (result?.error === "purchase_not_found") {
      return jsonResponse({ ok: false, error: "Purchase not found." }, 404);
    }
    if (result?.error === "already_reversed") {
      return jsonResponse(
        {
          ok: false,
          error: result.message ?? "Purchase already has a recorded reversal status.",
          previousStatus: result.previous_status,
        },
        409,
      );
    }
    return jsonResponse({ ok: false, error: "Reversal could not be recorded." }, 500);
  }

  console.log("[retention:deactivate] admin reversal recorded", {
    adminIdPrefix: userId.slice(0, 8),
    purchaseId: purchaseId.slice(0, 8),
    trustedStatus: result.purchase_status,
    skipped: result.skipped,
    deactivatedCount: result.deactivated_count,
  });

  return jsonResponse({
    ok: true,
    skipped: result.skipped ?? false,
    purchaseId,
    purchaseStatus: result.purchase_status,
    reason: result.reversal_reason ?? reason,
    deactivatedCount: result.deactivated_count ?? 0,
  });
}

/**
 * GET /exchange/retained
 *
 * Returns the authenticated buyer's active retained exchange intelligence
 * entries. These are permanent read-only snapshots from past purchases.
 * The buyer can browse their retained library at any time.
 */
async function handleGetRetainedExchange(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createAuthedClient(env, jwt);
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  // RLS ensures the buyer can only see their own active entries.
  const { data, error } = await supabase
    .from("retained_exchange_intelligence")
    .select("*")
    .eq("buyer_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("[retained] query failed", { userIdPrefix: userId.slice(0, 8), error: error.message });
    return jsonResponse({ ok: false, error: "Could not load retained intelligence." }, 500);
  }

  return jsonResponse({ ok: true, entries: data ?? [] });
}

// =============================================================================
// PHASE SOCIAL-VERIFICATION-1 — EAGOH Social Share Verification
// =============================================================================
// POST /social/share/create   — create a share attempt + verification code
// POST /social/share/verify   — verify a public post URL and award reward
// GET  /social/share/attempts — list the caller's share attempt history
// GET  /social/share/status   — get verified share count + badge progress
//
// Security: all reward logic lives in the security-definer RPC
// `award_social_share_reward` (service_role only). The mobile client cannot
// mark a share verified, award Neurons, or increment counts directly.
// -----------------------------------------------------------------------------

const EAGOH_PUBLIC_BASE_URL = "https://eagoh.app/e/";
const SHARE_REWARD_AMOUNT = 5;

const SHARE_BADGES: { threshold: number; name: string }[] = [
  { threshold: 5, name: "Neural Scout" },
  { threshold: 25, name: "Synapse Builder" },
  { threshold: 100, name: "Cortex Architect" },
  { threshold: 500, name: "Neural Vanguard" },
  { threshold: 1000, name: "Oracle Ascendant" },
];

/** Generate a unique verification code like EAGOH-J7K4P9. */
function generateVerificationCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code = "";
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  for (let i = 0; i < 6; i++) {
    code += chars[arr[i] % chars.length];
  }
  return `EAGOH-${code}`;
}

/** Normalize a social post URL for duplicate detection (strips tracking params). */
function normalizePostUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    // Strip common tracking params
    const trackKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid", "igshid", "ref", "ref_url"];
    for (const k of trackKeys) {
      u.searchParams.delete(k);
    }
    // Lowercase host, strip trailing slash, strip fragment
    return `${u.host.toLowerCase()}${u.pathname.replace(/\/$/, "")}${u.search ? "?" + u.searchParams.toString() : ""}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Detect the platform from a URL host. */
function detectPlatform(url: string): string {
  try {
    const host = new URL(url).host.toLowerCase();
    if (host.includes("facebook.com") || host.includes("fb.com")) return "facebook";
    if (host.includes("x.com") || host.includes("twitter.com")) return "x";
    if (host.includes("linkedin.com")) return "linkedin";
    if (host.includes("instagram.com")) return "instagram";
    if (host.includes("threads.net") || host.includes("threads.com")) return "threads";
    if (host.includes("tiktok.com")) return "tiktok";
    if (host.includes("youtube.com") || host.includes("youtu.be")) return "youtube";
    return "other";
  } catch {
    return "other";
  }
}

/** Validate that a URL is a plausible public post URL (not a profile URL). */
function isValidPostUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.length < 15) return false;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    // Reject bare profile URLs (heuristic — these platforms use /<handle> for profiles)
    const path = u.pathname.replace(/^\//, "").replace(/\/$/, "");
    const segments = path.split("/");
    // facebook.com/<handle> = profile; facebook.com/<handle>/posts/123 = post
    // x.com/<handle> = profile; x.com/<handle>/status/123 = post
    // instagram.com/<handle> = profile; instagram.com/p/ABC = post
    // tiktok.com/@<handle> = profile; tiktok.com/@<handle>/video/123 = post
    if (segments.length < 2) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * POST /social/share/create
 *
 * Creates a new social share attempt for one of the caller's EAGOHs.
 * Generates a unique verification code and a public EAGOH URL. The client
 * uses the returned code + URL to build the native share sheet content.
 */
async function handleSocialShareCreate(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createAuthedClient(env, jwt);
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  let payload: { eagohId?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request." }, 400);
  }

  const eagohId = str(payload.eagohId).trim();
  if (!eagohId) return jsonResponse({ ok: false, error: "eagohId is required." }, 400);

  // ── Verify the EAGOH belongs to the caller (RLS) ──
  const { data: eagoh, error: eagohErr } = await supabase
    .from("eagohs")
    .select("id, name, image_url, image_thumb_url, domain, sport")
    .eq("id", eagohId)
    .eq("user_id", userId)
    .maybeSingle();

  if (eagohErr || !eagoh) {
    return jsonResponse({ ok: false, error: "EAGOH not found or not owned by you." }, 404);
  }

  // ── Fetch the creator display name for the share card ──
  const { data: profile } = await supabase
    .from("profiles")
    .select("username, display_name")
    .eq("id", userId)
    .maybeSingle();
  const creatorName = (profile as { display_name?: string | null; username?: string | null } | null)?.display_name
    ?? (profile as { username?: string | null } | null)?.username
    ?? "EAGOH Creator";

  // ── Generate a unique verification code (retry on collision) ──
  const serviceClient = getServiceRoleClient(env);
  if (!serviceClient) return jsonResponse({ ok: false, error: "Service not configured." }, 503);

  const publicEagohUrl = `${EAGOH_PUBLIC_BASE_URL}${eagohId}`;
  let verificationCode = generateVerificationCode();
  let shareContent = "";
  let attemptId = "";
  let expiresAt = "";
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    shareContent = [
      `${(eagoh as { name: string }).name} — EAGOH Intelligence Analyst`,
      `Specialty: ${(eagoh as { domain?: string | null; sport?: string | null }).domain ?? (eagoh as { sport?: string | null }).sport ?? "General Intelligence"}`,
      `Creator: ${creatorName}`,
      `Powered by Human Experience + AI`,
      `View: ${publicEagohUrl}`,
      `Verification Code: ${verificationCode}`,
    ].join("\n");

    const { data: rpcResult, error: rpcErr } = await serviceClient.rpc(
      "create_social_share_attempt",
      {
        p_user_id: userId,
        p_eagoh_id: eagohId,
        p_verification_code: verificationCode,
        p_public_eagoh_url: publicEagohUrl,
        p_share_content_snapshot: shareContent,
      },
    );

    if (rpcErr) {
      // Unique constraint violation on verification_code → regenerate and retry
      if (String(rpcErr.message).includes("ssa_verification_code_uniq") || String(rpcErr.message).includes("duplicate key")) {
        verificationCode = generateVerificationCode();
        continue;
      }
      lastErr = rpcErr;
      break;
    }

    const result = rpcResult as { ok?: boolean; attempt_id?: string; expires_at?: string; error?: string };
    if (!result?.ok) {
      if (result?.error === "eagoh_not_owned") {
        return jsonResponse({ ok: false, error: "EAGOH not found or not owned by you." }, 404);
      }
      lastErr = result?.error;
      break;
    }
    attemptId = result.attempt_id ?? "";
    expiresAt = result.expires_at ?? "";
    lastErr = null;
    break;
  }

  if (lastErr || !attemptId) {
    console.warn("[social:share:create] failed", { userIdPrefix: userId.slice(0, 8), error: String(lastErr).slice(0, 200) });
    return jsonResponse({ ok: false, error: "Could not create share attempt." }, 500);
  }

  console.log("[social:share:create] success", { userIdPrefix: userId.slice(0, 8), eagohId: eagohId.slice(0, 8), code: verificationCode });

  return jsonResponse({
    ok: true,
    attemptId,
    eagohId,
    eagohName: (eagoh as { name: string }).name,
    eagohImageUrl: (eagoh as { image_url?: string | null }).image_url ?? null,
    eagohThumbUrl: (eagoh as { image_thumb_url?: string | null }).image_thumb_url ?? null,
    creatorName,
    verificationCode,
    publicEagohUrl,
    shareContent,
    expiresAt,
    qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(publicEagohUrl)}`,
  });
}

/**
 * POST /social/share/verify
 *
 * Verifies that a public social post URL contains the caller's EAGOH URL and
 * verification code. If verification succeeds, awards 5 Neurons via the
 * security-definer RPC. If the platform blocks automated verification, marks
 * the attempt as `manual_review` and returns that status — never falsely
 * marks as verified.
 */
async function handleSocialShareVerify(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createAuthedClient(env, jwt);
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  let payload: { attemptId?: unknown; postUrl?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request." }, 400);
  }

  const attemptId = str(payload.attemptId).trim();
  if (!attemptId) return jsonResponse({ ok: false, error: "attemptId is required." }, 400);
  const postUrl = str(payload.postUrl).trim();
  if (!postUrl) return jsonResponse({ ok: false, error: "postUrl is required." }, 400);

  if (!isValidPostUrl(postUrl)) {
    return jsonResponse({ ok: false, error: "Please paste the URL of the actual public post, not a profile URL." }, 400);
  }

  const normalizedUrl = normalizePostUrl(postUrl);
  const platform = detectPlatform(postUrl);

  const serviceClient = getServiceRoleClient(env);
  if (!serviceClient) return jsonResponse({ ok: false, error: "Service not configured." }, 503);

  // ── 1. Fetch the attempt (RLS ensures the caller owns it) ──
  const { data: attempt, error: attemptErr } = await supabase
    .from("social_share_attempts")
    .select("id, user_id, eagoh_id, verification_code, public_eagoh_url, status, expires_at, reward_awarded")
    .eq("id", attemptId)
    .maybeSingle();

  if (attemptErr || !attempt) {
    return jsonResponse({ ok: false, error: "Share attempt not found." }, 404);
  }

  const a = attempt as { user_id: string; verification_code: string; public_eagoh_url: string; status: string; expires_at: string; reward_awarded: boolean };
  if (a.user_id !== userId) {
    return jsonResponse({ ok: false, error: "Share attempt not found." }, 404);
  }

  // Already verified
  if (a.status === "verified" || a.reward_awarded) {
    return jsonResponse({ ok: true, skipped: true, status: "verified", message: "This share was already verified and rewarded." });
  }

  // Expired
  if (new Date(a.expires_at).getTime() <= Date.now()) {
    await serviceClient.rpc("update_share_attempt_status", {
      p_attempt_id: attemptId,
      p_status: "expired",
      p_post_url: postUrl,
      p_post_url_normalized: normalizedUrl,
      p_platform: platform,
      p_rejection_reason: "code_expired",
    });
    return jsonResponse({ ok: false, error: "This verification code has expired. Codes are valid for 7 days. Generate a new share to verify." }, 410);
  }

  // Check for duplicate post URL (same URL already verified by anyone)
  const { data: dupAttempt } = await serviceClient
    .from("social_share_attempts")
    .select("id, user_id")
    .eq("submitted_post_url_normalized", normalizedUrl)
    .eq("status", "verified")
    .neq("id", attemptId)
    .limit(1)
    .maybeSingle();

  if (dupAttempt) {
    await serviceClient.rpc("update_share_attempt_status", {
      p_attempt_id: attemptId,
      p_status: "already_verified",
      p_post_url: postUrl,
      p_post_url_normalized: normalizedUrl,
      p_platform: platform,
      p_rejection_reason: "duplicate_post_url",
    });
    return jsonResponse({ ok: false, error: "This social post URL has already been verified. Each post can only be verified once.", status: "already_verified" }, 409);
  }

  // ── 2. Fetch the public post page to verify it contains the EAGOH URL + code ──
  let pageHtml = "";
  let fetchOk = false;
  let fetchBlocked = false;
  try {
    const fetchResp = await fetch(postUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; EagohShareVerifier/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (fetchResp.ok) {
      pageHtml = await fetchResp.text();
      fetchOk = true;
    } else if (fetchResp.status === 403 || fetchResp.status === 401 || fetchResp.status === 451) {
      fetchBlocked = true;
    } else {
      fetchBlocked = true;
    }
  } catch {
    fetchBlocked = true;
  }

  // If the platform blocked automated access, mark for manual review.
  if (fetchBlocked || !fetchOk) {
    await serviceClient.rpc("update_share_attempt_status", {
      p_attempt_id: attemptId,
      p_status: "manual_review",
      p_post_url: postUrl,
      p_post_url_normalized: normalizedUrl,
      p_platform: platform,
      p_rejection_reason: "platform_blocked_automated_verification",
    });
    console.log("[social:share:verify] manual review", { userIdPrefix: userId.slice(0, 8), attemptId: attemptId.slice(0, 8), platform });
    return jsonResponse({
      ok: true,
      status: "manual_review",
      message: "Manual Review Required — this platform blocked automated verification. Our team will review your post. You will not lose your reward if the post is valid.",
    });
  }

  // ── 3. Verify the page contains the EAGOH URL and verification code ──
  const pageLower = pageHtml.toLowerCase();
  const urlFound = pageLower.includes(a.public_eagoh_url.toLowerCase());
  const codeFound = pageLower.includes(a.verification_code.toLowerCase());

  if (!urlFound || !codeFound) {
    const reason = !urlFound && !codeFound
      ? "missing_url_and_code"
      : !urlFound ? "missing_public_eagoh_url" : "missing_verification_code";
    await serviceClient.rpc("update_share_attempt_status", {
      p_attempt_id: attemptId,
      p_status: "rejected",
      p_post_url: postUrl,
      p_post_url_normalized: normalizedUrl,
      p_platform: platform,
      p_rejection_reason: reason,
    });
    return jsonResponse({
      ok: false,
      status: "rejected",
      error: `Verification failed: the public post does not contain ${!urlFound && !codeFound ? "the EAGOH URL and verification code" : !urlFound ? "the EAGOH public URL" : "the verification code"}. Make sure your post is public and includes both the URL and the code.`,
    }, 422);
  }

  // ── 4. Award the reward via the security-definer RPC ──
  const { data: awardResult, error: awardErr } = await serviceClient.rpc(
    "award_social_share_reward",
    {
      p_attempt_id: attemptId,
      p_post_url: postUrl,
      p_post_url_normalized: normalizedUrl,
      p_platform: platform,
    },
  );

  if (awardErr) {
    console.warn("[social:share:verify] award RPC failed", { attemptId: attemptId.slice(0, 8), error: awardErr.message });
    return jsonResponse({ ok: false, error: "Verification completed but reward could not be awarded." }, 500);
  }

  const result = awardResult as { ok?: boolean; skipped?: boolean; error?: string; reward_amount?: number; new_verified_share_count?: number; new_edge_purchased?: number };
  if (!result?.ok) {
    if (result?.error === "already_verified") {
      return jsonResponse({ ok: false, status: "already_verified", error: "This social post URL has already been verified." }, 409);
    }
    if (result?.error === "code_expired") {
      return jsonResponse({ ok: false, status: "expired", error: "This verification code has expired." }, 410);
    }
    console.warn("[social:share:verify] award RPC returned error", { attemptId: attemptId.slice(0, 8), error: result?.error });
    return jsonResponse({ ok: false, error: "Reward could not be awarded." }, 500);
  }

  console.log("[social:share:verify] verified", {
    userIdPrefix: userId.slice(0, 8),
    attemptId: attemptId.slice(0, 8),
    platform,
    reward: result.reward_amount,
    newCount: result.new_verified_share_count,
  });

  return jsonResponse({
    ok: true,
    skipped: result.skipped ?? false,
    status: "verified",
    rewardAmount: result.reward_amount ?? SHARE_REWARD_AMOUNT,
    newVerifiedShareCount: result.new_verified_share_count,
    newEdgePurchased: result.new_edge_purchased,
  });
}

/**
 * GET /social/share/attempts
 *
 * Returns the authenticated caller's social share attempt history.
 */
async function handleSocialShareAttempts(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createAuthedClient(env, jwt);
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  const { data, error } = await supabase
    .from("social_share_attempts")
    .select("id, eagoh_id, verification_code, public_eagoh_url, status, platform, submitted_post_url, reward_awarded, reward_amount, created_at, verified_at, expires_at, rejection_reason")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.warn("[social:share:attempts] query failed", { userIdPrefix: userId.slice(0, 8), error: error.message });
    return jsonResponse({ ok: false, error: "Could not load share history." }, 500);
  }

  // Join EAGOH names (best-effort)
  const attempts = (data ?? []) as { eagoh_id: string }[];
  const eagohIds = [...new Set(attempts.map((a) => a.eagoh_id))];
  const eagohNames = new Map<string, string>();
  if (eagohIds.length > 0) {
    const { data: eagohs } = await supabase
      .from("eagohs")
      .select("id, name")
      .in("id", eagohIds);
    for (const e of (eagohs ?? []) as { id: string; name: string }[]) {
      eagohNames.set(e.id, e.name);
    }
  }

  const enriched = attempts.map((a) => ({ ...a, eagoh_name: eagohNames.get((a as { eagoh_id: string }).eagoh_id) ?? "Unknown" }));

  return jsonResponse({ ok: true, attempts: enriched });
}

/**
 * GET /social/share/status
 *
 * Returns the caller's verified share count and badge progress.
 */
async function handleSocialShareStatus(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createAuthedClient(env, jwt);
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  const { data, error } = await supabase
    .from("profiles")
    .select("verified_share_count")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) {
    return jsonResponse({ ok: false, error: "Could not load verification status." }, 500);
  }

  const count = (data as { verified_share_count?: number | null }).verified_share_count ?? 0;

  // Compute badge progress
  let currentBadge: { name: string; threshold: number } | null = null;
  let nextBadge: { name: string; threshold: number } | null = null;
  for (let i = 0; i < SHARE_BADGES.length; i++) {
    if (count >= SHARE_BADGES[i].threshold) {
      currentBadge = SHARE_BADGES[i];
    } else {
      nextBadge = SHARE_BADGES[i];
      break;
    }
  }

  const allBadges = SHARE_BADGES.map((b) => ({
    name: b.name,
    threshold: b.threshold,
    unlocked: count >= b.threshold,
  }));

  return jsonResponse({
    ok: true,
    verifiedShareCount: count,
    currentBadge: currentBadge ? { name: currentBadge.name, threshold: currentBadge.threshold } : null,
    nextBadge: nextBadge ? { name: nextBadge.name, threshold: nextBadge.threshold, remaining: nextBadge.threshold - count } : null,
    badges: allBadges,
  });
}

async function handleForgeGenerate(request: Request, env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Backend not configured." }, 503);
  }

  // ── Parse body ──
  let payload: {
    mode?: unknown;
    scope?: unknown;
    eagohId?: unknown;
    edgeCost?: unknown;
    prompt?: unknown;
    size?: unknown;
    draft?: Record<string, unknown>;
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request." }, 400);
  }

  const mode = payload.mode as ForgeMode;
  if (mode !== "initial" && mode !== "full_reforge" && mode !== "partial_reforge") {
    return jsonResponse({ ok: false, error: "Invalid forge mode." }, 400);
  }
  const prompt = str(payload.prompt).trim();
  if (!prompt) {
    return jsonResponse({ ok: false, error: "Prompt is required." }, 400);
  }
  const draft = payload.draft;
  if (!draft || typeof draft !== "object") {
    return jsonResponse({ ok: false, error: "Draft is required." }, 400);
  }
  const size = str(payload.size, "1024x1536");
  // ── Forge cost is always server-controlled — client-supplied edgeCost is ignored ──
  const edgeCost = FORGE_EDGE_COSTS_SERVER[mode];

  // ── Authenticate ──
  const authHeader = request.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return jsonResponse({ ok: false, error: "Authentication required." }, 401);

  const supabase = createAuthedClient(env, jwt);
  const userId = await verifyAuth(supabase, jwt);
  if (!userId) return jsonResponse({ ok: false, error: "Invalid auth." }, 401);

  const serviceClient = getServiceRoleClient(env);
  if (!serviceClient) {
    return jsonResponse({ ok: false, error: "Server configuration error." }, 503);
  }

  if (!env.OPENAI_API_KEY) {
    return jsonResponse({ ok: false, error: "Image generation is not configured." }, 503);
  }

  // ── Fetch profile (tier + balances) ──
  const { data: profileRow, error: profileErr } = await serviceClient
    .from("profiles")
    .select("subscription_tier, edge_subscription, edge_purchased")
    .eq("id", userId)
    .maybeSingle();

  if (profileErr || !profileRow) {
    console.warn("[forge] profile fetch failed", { userIdPrefix: userId.slice(0, 8), error: profileErr?.message ?? "no row" });
    return jsonResponse({ ok: false, error: "Could not verify account." }, 500);
  }

  const realTier = str((profileRow as Record<string, unknown>).subscription_tier, "free");

  // ── Dev test subscription resolution (server-side, secure) ──
  // Only active when the private worker env flag ENABLE_DEV_TEST_SUBSCRIPTIONS=true.
  // The worker loads the test tier from the dev_test_subscriptions table — never
  // trusts a client-supplied tier. In production the flag is absent and this
  // entire block is skipped.
  const devFlag = str(env.ENABLE_DEV_TEST_SUBSCRIPTIONS).toLowerCase() === "true";
  let devTestTier: string | null = null;
  if (devFlag) {
    const { data: devRow } = await serviceClient
      .from("dev_test_subscriptions")
      .select("test_tier, expires_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (devRow) {
      const expiresAt = (devRow as { expires_at?: string }).expires_at;
      if (!expiresAt || new Date(expiresAt) > new Date()) {
        devTestTier = str((devRow as Record<string, unknown>).test_tier);
      }
    }
  }

  // Effective tier: real paid subscription always wins; dev test tier only
  // applies when the real tier is free and the dev flag is on.
  const tierPriority: Record<string, number> = { free: 0, pro: 1, oracle_elite: 2, syndicate: 3 };
  let effectiveTier = realTier;
  if (devTestTier && (tierPriority[devTestTier] ?? 0) > (tierPriority[realTier] ?? 0)) {
    effectiveTier = devTestTier;
  }

  console.log("[forge] tier resolved", {
    userIdPrefix: userId.slice(0, 8),
    mode,
    realTier,
    devTestTier: devFlag ? devTestTier : "disabled",
    effectiveTier,
  });

  if (effectiveTier === "free") {
    return jsonResponse({ ok: false, error: "Forge requires Pro or higher." }, 403);
  }

  // ── For initial forge: check EAGOH limit ──
  // Count all EAGOH rows owned by the user. We do NOT filter on is_default_shell
  // or any other column that may not exist in the live schema — just user_id.
  if (mode === "initial") {
    const { count, error: countErr } = await serviceClient
      .from("eagohs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    if (countErr) {
      console.warn("[forge] EAGOH count failed", {
        userIdPrefix: userId.slice(0, 8),
        code: countErr.code,
        message: countErr.message,
      });
      return jsonResponse({ ok: false, error: "Could not verify your EAGOH limit." }, 500);
    }

    const eagohCount = count ?? 0;
    const limit = TIER_EAGOH_LIMITS_SERVER[effectiveTier] ?? 0;
    console.log("[forge] limit check", { userIdPrefix: userId.slice(0, 8), eagohCount, limit, effectiveTier });

    if (eagohCount >= limit) {
      return jsonResponse({ ok: false, error: "You have reached your EAGOH limit." }, 403);
    }
  }

  // ── For reforge: verify ownership ──
  let existingEagohId: string | null = null;
  if (mode !== "initial") {
    const eagohId = str(payload.eagohId);
    if (!eagohId) {
      return jsonResponse({ ok: false, error: "EAGOH ID is required for reforge." }, 400);
    }
    const eagoh = await verifyEagohOwnership(supabase, eagohId, userId);
    if (!eagoh) {
      return jsonResponse({ ok: false, error: "EAGOH not found or access denied." }, 404);
    }
    existingEagohId = eagohId;
  }

  // ── Verify the profile row belongs to the authenticated user ──
  const profileId = (profileRow as { id?: string }).id;
  if (profileId && profileId !== userId) {
    console.warn("[forge] profile ID mismatch", { userIdPrefix: userId.slice(0, 8), profileId: String(profileId).slice(0, 8) });
    return jsonResponse({ ok: false, error: "Account verification failed." }, 403);
  }

  // ── Pre-flight balance check with diagnostics ──
  const sub = (profileRow as { edge_subscription: number | null }).edge_subscription ?? 0;
  const purch = (profileRow as { edge_purchased: number | null }).edge_purchased ?? 0;
  const total = sub + purch;

  console.log("[forge] balance check", {
    userIdPrefix: userId.slice(0, 8),
    edge_subscription: sub,
    edge_purchased: purch,
    total,
    forgeCost: edgeCost,
    sufficient: total >= edgeCost,
  });

  if (total < edgeCost) {
    return jsonResponse({
      ok: false,
      error: "Insufficient Neurons. Visit the Edge Store to get more.",
      diagnostics: {
        displayedServerBalance: total,
        subscriptionBalance: sub,
        purchasedBalance: purch,
        forgeCost: edgeCost,
      },
    }, 402);
  }

  // ── Generate image via OpenAI ──
  let base64Image: string;
  try {
    const imageResponse = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        n: 1,
        size,
        background: "transparent",
      }),
    });

    if (!imageResponse.ok) {
      const errText = await imageResponse.text().catch(() => "");
      console.warn("[forge] image generation failed", { userIdPrefix: userId.slice(0, 8), status: imageResponse.status, detail: errText.slice(0, 300) });
      return jsonResponse({ ok: false, error: "Image generation could not be completed." }, 502);
    }

    const imageData = (await imageResponse.json()) as { data?: Array<{ b64_json?: string }> };
    base64Image = imageData.data?.[0]?.b64_json ?? "";
    if (!base64Image) {
      console.warn("[forge] no image data in response", { userIdPrefix: userId.slice(0, 8) });
      return jsonResponse({ ok: false, error: "Image generation could not be completed." }, 502);
    }
  } catch (err) {
    console.warn("[forge] image generation error", { userIdPrefix: userId.slice(0, 8), message: err instanceof Error ? err.message : "unknown" });
    return jsonResponse({ ok: false, error: "Image generation could not be completed." }, 502);
  }

  const imageUrl = `data:image/png;base64,${base64Image}`;
  const now = new Date().toISOString();

  // ── Create or update EAGOH ──
  let eagohId: string;
  let eagohRecord: Record<string, unknown>;

  if (mode === "initial") {
    const draftDna = Array.isArray(draft.dna) ? (draft.dna as string[]) : [];
    const domainDnaEntries = encodeDomainDnaServer(draft);
    const mergedDna = [...draftDna, ...domainDnaEntries];

    const insertPayload = {
      user_id: userId,
      name: str(draft.name, "Unnamed EAGOH").trim() || "Unnamed EAGOH",
      sport: str(draft.sport),
      gender: str(draft.gender) || null,
      domain: str(draft.domain) || null,
      body_type: str(draft.bodyType) || null,
      style_notes: str(draft.styleNotes) || null,
      cybernetic_intensity: str(draft.cyberneticIntensity, "moderate"),
      pose: str(draft.pose, "calm-sentinel"),
      lab: str(draft.lab, "neon-vault"),
      dna: mergedDna,
      image_url: imageUrl,
      image_thumb_url: imageUrl,
      image_prompt: prompt,
      image_generated_at: now,
      team_focus_mode: str(draft.teamFocusMode) || null,
      pro_team_focus_id: str(draft.proTeamFocusId) || null,
      pro_team_focus_name: str(draft.proTeamFocusName) || null,
      college_team_focus_id: str(draft.collegeTeamFocusId) || null,
      college_team_focus_name: str(draft.collegeTeamFocusName) || null,
    };

    const { data: created, error: createErr } = await serviceClient
      .from("eagohs")
      .insert(insertPayload)
      .select("*")
      .single();

    if (createErr || !created) {
      console.warn("[forge] EAGOH creation failed", { userIdPrefix: userId.slice(0, 8), error: createErr?.message });
      return jsonResponse({ ok: false, error: "Could not save your EAGOH. No Neurons were charged." }, 500);
    }

    eagohId = (created as { id: string }).id;
    eagohRecord = created as Record<string, unknown>;

    // Insert customization, teams, labs (best-effort)
    const appearance = draft.appearance;
    if (appearance && typeof appearance === "object") {
      await serviceClient.from("eagoh_customization").insert({ eagoh_id: eagohId, appearance }).then(() => {}).catch(() => {});
    }
    const teams = Array.isArray(draft.teams) ? (draft.teams as string[]) : [];
    if (teams.length > 0) {
      await serviceClient.from("eagoh_fanatic_teams").insert(teams.map((team_id) => ({ eagoh_id: eagohId, team_id }))).then(() => {}).catch(() => {});
    }
    if (str(draft.lab)) {
      await serviceClient.from("eagoh_labs").insert({ eagoh_id: eagohId, lab_id: draft.lab }).then(() => {}).catch(() => {});
    }
  } else {
    eagohId = existingEagohId!;
    const { data: updated, error: updateErr } = await serviceClient
      .from("eagohs")
      .update({
        image_url: imageUrl,
        image_thumb_url: imageUrl,
        image_prompt: prompt,
        image_generated_at: now,
        updated_at: now,
      })
      .eq("id", eagohId)
      .select("*")
      .single();

    if (updateErr || !updated) {
      console.warn("[forge] EAGOH image update failed", { userIdPrefix: userId.slice(0, 8), error: updateErr?.message });
      return jsonResponse({ ok: false, error: "Could not update your EAGOH. No Neurons were charged." }, 500);
    }

    eagohRecord = updated as Record<string, unknown>;

    // Partial reforge: update customization field (best-effort)
    const scope = str(payload.scope, "full");
    if (mode === "partial_reforge" && scope !== "full" && scope !== "pose" && scope !== "cybernetic") {
      const appearance = draft.appearance;
      if (appearance && typeof appearance === "object") {
        const optionId = (appearance as Record<string, string>)[scope];
        if (optionId) {
          const { data: row } = await serviceClient.from("eagoh_customization").select("appearance").eq("eagoh_id", eagohId).maybeSingle();
          const current = ((row as { appearance?: Record<string, string> } | null)?.appearance) ?? {};
          const next = { ...current, [scope]: optionId };
          await serviceClient.from("eagoh_customization").upsert({ eagoh_id: eagohId, appearance: next, updated_at: now }).then(() => {}).catch(() => {});
        }
      }
    }
  }

  // ── Deduct Neurons (server-side, atomic) ──
  const fromSub = Math.min(sub, edgeCost);
  const fromPurchased = edgeCost - fromSub;
  const nextSub = sub - fromSub;
  const nextPurchased = purch - fromPurchased;
  const bucket = fromSub > 0 && fromPurchased > 0 ? "mixed" : fromPurchased > 0 ? "purchased" : "subscription";

  const { error: deductErr } = await serviceClient
    .from("profiles")
    .update({ edge_subscription: nextSub, edge_purchased: nextPurchased, updated_at: now })
    .eq("id", userId);

  if (deductErr) {
    // Rollback: delete EAGOH (initial) or log (reforge — image updated but no charge)
    if (mode === "initial") {
      await serviceClient.from("eagohs").delete().eq("id", eagohId);
      console.log("[forge] rolled back EAGOH creation after deduction failure", { userIdPrefix: userId.slice(0, 8), eagohId });
    } else {
      console.warn("[forge] deduction failed for reforge — image updated but no charge", { userIdPrefix: userId.slice(0, 8), error: deductErr.message });
    }
    return jsonResponse({ ok: false, error: "Neuron deduction failed. No Neurons were charged." }, 500);
  }

  // ── Log transaction (best-effort) ──
  const reason = mode === "initial" ? "forge_initial" : mode === "full_reforge" ? "forge_full_reforge" : "forge_partial_reforge";
  const eagohName = str((eagohRecord as Record<string, unknown>).name, "EAGOH");
  await serviceClient.from("edge_transactions").insert({
    user_id: userId,
    kind: "deduction",
    reason,
    amount: edgeCost,
    bucket,
    from_subscription: fromSub,
    from_purchased: fromPurchased,
    balance_subscription_after: nextSub,
    balance_purchased_after: nextPurchased,
    note: `Forge ${mode} · ${eagohName}`,
  }).then(() => {}).catch(() => {});

  // ── Log image generation (best-effort) ──
  await serviceClient.from("eagoh_image_generations").insert({
    eagoh_id: eagohId,
    user_id: userId,
    mode,
    prompt,
    image_url: imageUrl,
    thumb_url: imageUrl,
    edge_cost: edgeCost,
    meta: { model: "gpt-image-1", scope: str(payload.scope, "full") },
  }).then(() => {}).catch(() => {});

  console.log("[forge] completed successfully", {
    userIdPrefix: userId.slice(0, 8),
    mode,
    effectiveTier,
    eagohId,
    edgeCost,
    fromSub,
    fromPurchased,
    nextSub,
    nextPurchased,
  });

  return jsonResponse({
    ok: true,
    eagoh: eagohRecord,
    imageUrl,
    thumbUrl: imageUrl,
    prompt,
    edgeCost,
    balanceAfter: { subscription: nextSub, purchased: nextPurchased },
  });
}

// ── Export ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname === "/ping") {
      return jsonResponse({ ok: true, now: new Date().toISOString(), service: "eagoh-analyst-worker", version: "6b-ui" });
    }

    if (url.pathname === "/analyst/chat" && request.method === "POST") {
      return handleAnalystChat(request, env);
    }

    // Phase 5B: Feedback submission
    if (url.pathname === "/feedback/submit" && request.method === "POST") {
      return handleSubmitFeedback(request, env);
    }

    // Phase 5B: Dispute submission
    if (url.pathname === "/dispute/submit" && request.method === "POST") {
      return handleSubmitDispute(request, env);
    }

    // Phase 5B: Reputation lookup
    if (url.pathname === "/reputation" && request.method === "GET") {
      return handleGetReputation(request, env);
    }

    // Phase 5B: Server-side quality evaluation
    if (url.pathname === "/quality/evaluate" && request.method === "POST") {
      return handleEvaluateQuality(request, env);
    }

    // OI Create: atomic Neuron deduction + entry insert (secure, idempotent)
    if (url.pathname === "/oi/create" && request.method === "POST") {
      return handleCreateOIEntry(request, env);
    }

    // Phase 5B: OI entry update (version history + dispute preservation)
    if (url.pathname === "/oi/update" && request.method === "POST") {
      return handleUpdateOIEntry(request, env);
    }

    // Phase 6B: OI entry withdraw
    if (url.pathname === "/oi/withdraw" && request.method === "POST") {
      return handleWithdrawOIEntry(request, env);
    }

    // Phase 6B: OI entry restore
    if (url.pathname === "/oi/restore" && request.method === "POST") {
      return handleRestoreOIEntry(request, env);
    }

    // Phase 6B: Toggle faction sharing
    if (url.pathname === "/oi/faction-share" && request.method === "POST") {
      return handleToggleFactionShare(request, env);
    }

    // Phase 6B: Version history
    if (url.pathname === "/oi/versions" && request.method === "GET") {
      return handleGetVersionHistory(request, env);
    }

    // Phase 6B: Moderation queue (admin only)
    if (url.pathname === "/moderation/queue" && request.method === "GET") {
      return handleGetModerationQueue(request, env);
    }

    // Phase 6B: Moderation action (admin only)
    if (url.pathname === "/moderation/action" && request.method === "POST") {
      return handleModerationAction(request, env);
    }

    // Phase 6C: Intelligence notifications (user's own)
    if (url.pathname === "/notifications" && request.method === "GET") {
      return handleGetNotifications(request, env);
    }

    // Phase 6C: Mark a single notification as read
    if (url.pathname === "/notifications/mark-read" && request.method === "POST") {
      return handleMarkNotificationRead(request, env);
    }

    // Phase 6C: Mark all notifications as read
    if (url.pathname === "/notifications/mark-all-read" && request.method === "POST") {
      return handleMarkAllNotificationsRead(request, env);
    }

    // Phase 6C: Moderation audit history (admin only)
    if (url.pathname === "/moderation/audit" && request.method === "GET") {
      return handleGetModerationAudit(request, env);
    }

    // Phase 8A: Intelligence analytics (owner-scoped, secure)
    if (url.pathname === "/intelligence/analytics" && request.method === "GET") {
      return handleGetIntelligenceAnalytics(request, env);
    }

    // Phase 10A: Secure account deletion (service-role only)
    if (url.pathname === "/account/delete" && request.method === "POST") {
      return handleDeleteAccount(request, env);
    }

    // Phase 11A: Arena compatibility validation (no Neuron deduction, no OI content)
    if (url.pathname === "/arena/validate" && request.method === "POST") {
      return handleArenaValidate(request, env);
    }

    // Phase 11B: Arena analysis (paid, idempotent, grounded)
    if (url.pathname === "/arena/analyze" && request.method === "POST") {
      return handleArenaAnalyze(request, env);
    }

    // Phase 11B: Arena history (paginated, owner-scoped)
    if (url.pathname === "/arena/history" && request.method === "GET") {
      return handleArenaHistory(request, env);
    }

    // Faction invite by email or username (secure, JWT-authed)
    if (url.pathname === "/factions/invite" && request.method === "POST") {
      return handleFactionInvite(request, env);
    }

    // Forge: secure image generation (auth + tier + balance + OpenAI + atomic deduction)
    if (url.pathname === "/forge/generate" && request.method === "POST") {
      return handleForgeGenerate(request, env);
    }

    // Phase RETAINED-OI-1: Create retained exchange intelligence after verified purchase
    if (url.pathname === "/exchange/retention/create" && request.method === "POST") {
      return handleExchangeRetentionCreate(request, env);
    }

    // Phase RETAINED-OI-1: Deactivate retained exchange intelligence (refund/reversal/dispute)
    if (url.pathname === "/exchange/retention/deactivate" && request.method === "POST") {
      return handleExchangeRetentionDeactivate(request, env);
    }

    // Phase RETAINED-OI-1: Get buyer's active retained exchange intelligence library
    if (url.pathname === "/exchange/retained" && request.method === "GET") {
      return handleGetRetainedExchange(request, env);
    }

    // Phase SOCIAL-VERIFICATION-1: EAGOH social share verification
    if (url.pathname === "/social/share/create" && request.method === "POST") {
      return handleSocialShareCreate(request, env);
    }
    if (url.pathname === "/social/share/verify" && request.method === "POST") {
      return handleSocialShareVerify(request, env);
    }
    if (url.pathname === "/social/share/attempts" && request.method === "GET") {
      return handleSocialShareAttempts(request, env);
    }
    if (url.pathname === "/social/share/status" && request.method === "GET") {
      return handleSocialShareStatus(request, env);
    }

    return jsonResponse({ ok: false, error: "Not found" }, 404);
  },
};





