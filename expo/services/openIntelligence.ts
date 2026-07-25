import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import type { UserProfile } from "@/services/profile";
import { getObservationTags, getAllTagsFlat, searchTags } from "@/data/observationTags";

// ── Types ──────────────────────────────────────────────────────────────

export type EntryType = "quick_observation" | "basic_deep_entry" | "advanced_deep_entry";

export type ConfidenceLevel = "weak_suspicion" | "moderate_confidence" | "strong_confidence" | "verified_observation";

export type ValidationStatus =
  | "pending_review"
  | "validated" // legacy — kept for backward compatibility
  | "community_supported"
  | "externally_supported"
  | "disputed"
  | "rejected"
  | "withdrawn";

export type InfluenceScore = "low" | "medium" | "high";

export const ENTRY_TYPE_LIMITS: Record<EntryType, number> = {
  quick_observation: 110,
  basic_deep_entry: 200,
  advanced_deep_entry: 400,
};

export const ENTRY_TYPE_EDGE_COST: Record<EntryType, number> = {
  quick_observation: 10,
  basic_deep_entry: 15,
  advanced_deep_entry: 25,
};

export const CONFIDENCE_LEVELS: { id: ConfidenceLevel; label: string }[] = [
  { id: "weak_suspicion", label: "Weak Suspicion" },
  { id: "moderate_confidence", label: "Moderate Confidence" },
  { id: "strong_confidence", label: "Strong Confidence" },
  { id: "verified_observation", label: "Verified Observation" },
];

// ── Observation Tags ───────────────────────────────────────────────────

export type TagCategory = {
  id: string;
  label: string;
  tags: { id: string; label: string }[];
};

/** Sports defaults — kept for backward compatibility with sessions.tsx */
export const OBSERVATION_TAGS: TagCategory[] = getObservationTags("sports");

export const ALL_TAGS = OBSERVATION_TAGS.flatMap((cat) => cat.tags);

/**
 * Get observation tag categories for a given intelligence domain.
 * Falls back to Sports taxonomy when domain is empty or unknown.
 */
export function getTagsForDomain(domainId: string): TagCategory[] {
  return getObservationTags(domainId);
}

/**
 * Get a flat array of all tag {id, label} pairs for a given domain.
 */
export function getAllTagsForDomain(domainId: string): { id: string; label: string }[] {
  return getAllTagsFlat(domainId);
}

/**
 * Search tags within a domain by a query string.
 */
export function searchTagsForDomain(domainId: string, query: string): { id: string; label: string }[] {
  return searchTags(domainId, query);
}

/**
 * Look up a tag label by ID within a domain.
 */
export function lookupTagLabelForDomain(tagId: string, domainId?: string): string {
  const tags = domainId ? getAllTagsFlat(domainId) : ALL_TAGS;
  return tags.find((t) => t.id === tagId)?.label ?? tagId;
}

/** Backward-compat alias — re-export from observationTags */
export { lookupTagLabel } from "@/data/observationTags";

// ── Recently Used Tags (AsyncStorage) ──────────────────────────────────

const RECENT_TAGS_KEY = "eagoh_recent_tags";

/**
 * Record that a set of tags was used. Stores up to 20 most recent unique tag IDs
 * per user, ordered by most recent first.
 */
export async function recordRecentTags(tagIds: string[]): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(RECENT_TAGS_KEY);
    const existing: string[] = stored ? JSON.parse(stored) : [];
    const updated = [...new Set([...tagIds, ...existing])].slice(0, 20);
    await AsyncStorage.setItem(RECENT_TAGS_KEY, JSON.stringify(updated));
  } catch {
    // AsyncStorage is best-effort
  }
}

/**
 * Get recently used tag IDs, most recent first.
 */
export async function getRecentTags(): Promise<string[]> {
  try {
    const stored = await AsyncStorage.getItem(RECENT_TAGS_KEY);
    return stored ? JSON.parse(stored) as string[] : [];
  } catch {
    return [];
  }
}

// ── DB Row ─────────────────────────────────────────────────────────────

export type OpenIntelligenceRow = {
  id: string;
  user_id: string;
  eagoh_id: string;
  intelligence_domain: string;
  entry_type: EntryType;
  tag: string; // stored tag id (or custom text) — backward compat
  content: string;
  character_count_no_spaces: number;
  confidence_level: ConfidenceLevel;
  quality_score: number;
  validation_status: ValidationStatus;
  influence_score: number; // stored as 0-100, mapped to low/medium/high on read
  selected_category?: string | null;
  selected_subtags?: string[] | null;
  custom_tags?: string[] | null;
  // Phase 5B fields
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

// ── Quality Scoring ────────────────────────────────────────────────────

interface ScoringInput {
  content: string;
  entryType: EntryType;
  confidenceLevel: ConfidenceLevel;
  tag: string;
}

export interface QualityScoreResult {
  qualityScore: number; // 0–100
  influenceScore: number; // 0–100, mapped to low/medium/high
}

/**
 * PREVIEW ONLY — local quality scoring for immediate UI feedback.
 *
 * The authoritative quality_score, influence_score, content_hash, and
 * duplicate_flag are calculated server-side by the DB trigger
 * (evaluate_oi_quality_trigger) and the worker's evaluateOpenIntelligenceQuality.
 * Client-submitted values for these fields are overwritten on insert/update.
 *
 * Do NOT rely on this score for ranking, validation, or reputation.
 *
 * Factors:
 *   - specificity (entity/name mentions)
 *   - entry length (relative to type max)
 *   - confidence level multiplier
 *   - tag selection signal
 */
export function computeQualityPreview(input: ScoringInput, domainId?: string): QualityScoreResult {
  const text = input.content.trim();
  const charCount = text.replace(/\s/g, "").length;
  const limit = ENTRY_TYPE_LIMITS[input.entryType];

  // Specificity: look for team/player/entity mentions via proper noun patterns
  const properNouns = (text.match(/\b[A-Z][a-z]{2,}\b/g) ?? []).length;
  const specificityScore = Math.min(35, properNouns * 7 + (text.includes("vs") || text.includes("against") ? 8 : 0));

  // Length density: how used the character budget is
  const fillRatio = Math.min(1, charCount / limit);
  const lengthScore = Math.min(25, Math.round(fillRatio * 25));

  // Confidence multiplier
  const confidenceMultiplier: Record<ConfidenceLevel, number> = {
    weak_suspicion: 0.6,
    moderate_confidence: 0.8,
    strong_confidence: 1.0,
    verified_observation: 1.15,
  };
  const confidenceBase = Math.round(20 * confidenceMultiplier[input.confidenceLevel]);

  // Tag signal (custom tags get a small bonus for specificity)
  const domainTags = domainId ? getAllTagsFlat(domainId) : ALL_TAGS;
  const isCustomTag = !domainTags.some((t) => t.id === input.tag);
  const tagScore = isCustomTag ? 12 : 8;

  // Bonus: entry type depth
  const depthBonus: Record<EntryType, number> = {
    quick_observation: 0,
    basic_deep_entry: 4,
    advanced_deep_entry: 8,
  };

  const rawQuality = specificityScore + lengthScore + confidenceBase + tagScore + depthBonus[input.entryType];
  const qualityScore = Math.max(0, Math.min(100, rawQuality));

  // Influence: based on quality + confidence signal
  const rawInfluence = qualityScore * 0.7 + confidenceBase * 1.5 + specificityScore * 0.4;
  const influenceScore = Math.max(0, Math.min(100, Math.round(rawInfluence)));

  return { qualityScore, influenceScore };
}

function influenceLabel(score: number): InfluenceScore {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

// ── Tag formatting helpers ─────────────────────────────────────────────

/**
 * Format subtags array into a display string for the legacy `tag` column.
 */
function formatTagField(subtags: string[], customTags?: string[]): string {
  const all = [...subtags, ...(customTags ?? []).map((t) => `custom:${t}`)];
  return all.join(", ") || "general";
}

// ── CRUD ────────────────────────────────────────────────────────────────

export interface SubmitEntryInput {
  userId: string;
  profile: UserProfile;
  eagohId: string;
  intelligenceDomain: string;
  entryType: EntryType;
  tag: string;
  content: string;
  confidenceLevel: ConfidenceLevel;
  selectedCategory?: string;
  selectedSubtags?: string[];
  customTags?: string[];
}

export interface SubmitEntryResult {
  ok: boolean;
  entry?: OpenIntelligenceRow;
  error?: string;
  edgeCost?: number;
}

/**
 * Submit an open intelligence entry through the secure worker.
 *
 * The worker:
 *   1. Authenticates the user via JWT
 *   2. Verifies EAGOH ownership and domain match
 *   3. Validates entry type, content, and confidence level
 *   4. Atomically deducts Neurons and inserts the OI entry via a DB RPC
 *      (create_oi_entry) — if either step fails, both roll back
 *   5. Returns the saved entry with server-authoritative quality scores
 *   6. Never trusts client-supplied userId, balance, quality, or influence
 *
 * The user never loses Neurons if the entry is not saved.
 */
export async function submitEntry(input: SubmitEntryInput): Promise<SubmitEntryResult> {
  // ── Local pre-validation (fast-fail before network call) ──
  const cleanContent = input.content.trim();
  const charCountNoSpaces = cleanContent.replace(/\s/g, "").length;
  const limit = ENTRY_TYPE_LIMITS[input.entryType];

  if (charCountNoSpaces > limit) {
    return { ok: false, error: `Entry exceeds ${limit} character limit (excl. spaces). Currently at ${charCountNoSpaces}.` };
  }
  if (charCountNoSpaces === 0) {
    return { ok: false, error: "Entry cannot be empty." };
  }

  const edgeCost = ENTRY_TYPE_EDGE_COST[input.entryType];
  const totalEdge = (input.profile.edge_subscription ?? 0) + (input.profile.edge_purchased ?? 0);
  if (totalEdge < edgeCost) {
    return { ok: false, error: `Insufficient Neurons. Need ${edgeCost} Neurons (have ${totalEdge}).`, edgeCost };
  }

  // ── Call the secure worker endpoint ──
  const functionsUrl = process.env.EXPO_PUBLIC_RORK_FUNCTIONS_URL;
  if (!functionsUrl) {
    return { ok: false, error: "Backend not configured." };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) {
    return { ok: false, error: "Please sign in again." };
  }

  if (__DEV__) {
    const expiresAt = sessionData?.session?.expires_at;
    console.log("[oi/create] endpoint=" + functionsUrl + "/oi/create, hasSession:true, hasToken:true, expiresAt=" + (expiresAt ?? "unknown"));
  }

  const subtags = input.selectedSubtags ?? [];
  const customTags = input.customTags ?? [];
  const formattedTag = formatTagField(subtags, customTags);
  const requestId = `${input.userId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  let res: Response;
  try {
    res = await fetch(`${functionsUrl}/oi/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        requestId,
        eagohId: input.eagohId,
        intelligenceDomain: input.intelligenceDomain,
        entryType: input.entryType,
        content: cleanContent,
        confidenceLevel: input.confidenceLevel,
        tag: formattedTag,
        selectedSubtags: subtags,
        customTags,
        selectedCategory: input.selectedCategory ?? undefined,
      }),
    });
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }

  if (__DEV__) {
    console.log("[oi/create] response status=" + res.status);
  }

  if (res.status === 401) {
    return { ok: false, error: "Your session expired. Please sign in again." };
  }

  let data: { ok: boolean; entry?: OpenIntelligenceRow; error?: string; edgeCost?: number; debug?: Record<string, unknown> };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }

  if (!data.ok) {
    if (__DEV__) {
      console.warn("[oi/create] worker returned error", data.error);
      if (data.debug) {
        console.warn("[oi/create] DEBUG diagnostics", JSON.stringify(data.debug, null, 2));
      }
    }
    return { ok: false, error: data.error ?? "Entry could not be saved. No Neurons were charged." };
  }

  // Record recently used tags (best-effort)
  try {
    await recordRecentTags([...subtags, ...customTags.map((t) => `custom:${t}`)]);
  } catch {
    // best-effort
  }

  return { ok: true, entry: data.entry, edgeCost: data.edgeCost ?? edgeCost };
}

/**
 * List entries for a specific EAGOH, newest first.
 */
export async function listEntriesForEagoh(
  eagohId: string,
  limit: number = 20,
  offset: number = 0,
): Promise<OpenIntelligenceRow[]> {
  const { data, error } = await supabase
    .from("open_intelligence")
    .select("*")
    .eq("eagoh_id", eagohId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as OpenIntelligenceRow[];
}

/**
 * List all entries for the current user, newest first.
 */
export async function listAllEntries(
  userId: string,
  limit: number = 50,
  offset: number = 0,
): Promise<OpenIntelligenceRow[]> {
  const { data, error } = await supabase
    .from("open_intelligence")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as OpenIntelligenceRow[];
}

/**
 * Count entries for an EAGOH.
 */
export async function countEntriesForEagoh(eagohId: string): Promise<number> {
  const { count, error } = await supabase
    .from("open_intelligence")
    .select("id", { count: "exact", head: true })
    .eq("eagoh_id", eagohId);
  if (error) throw error;
  return count ?? 0;
}

// ── Phase 5B: Server-side update (version history + dispute preservation) ─────

export interface UpdateEntryInput {
  entryId: string;
  content?: string;
  confidenceLevel?: ConfidenceLevel;
  selectedCategory?: string | null;
  selectedSubtags?: string[] | null;
  customTags?: string[] | null;
  exchangeShareEnabled?: boolean;
}

export interface UpdateEntryResult {
  ok: boolean;
  entry?: {
    id: string;
    qualityScore: number;
    influenceScore: number;
    contentHash: string | null;
    duplicateFlag: boolean;
    versionNumber: number;
  };
  error?: string;
}

/**
 * Update an Open Intelligence entry through the server-side worker.
 *
 * The worker:
 *   1. Verifies ownership
 *   2. Saves a version history record (preserving dispute history)
 *   3. Increments version_number on major content edits
 *   4. The DB trigger overwrites quality_score, influence_score, content_hash,
 *      and duplicate_flag with server-authoritative values
 *   5. Recalculates contributor reputation on major edits
 *
 * Client-submitted quality/influence/hash/duplicate values are ignored.
 */
export async function updateEntry(input: UpdateEntryInput): Promise<UpdateEntryResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) {
    return { ok: false, error: "Not authenticated." };
  }

  const functionsUrl = process.env.EXPO_PUBLIC_RORK_FUNCTIONS_URL;
  if (!functionsUrl) {
    return { ok: false, error: "Backend not configured." };
  }

  try {
    const res = await fetch(`${functionsUrl}/oi/update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(input),
    });

    const data = (await res.json()) as UpdateEntryResult;
    return data;
  } catch (err) {
    console.warn("[open-intelligence] update failed", err);
    return { ok: false, error: "Network error. Try again." };
  }
}

/**
 * Toggle Exchange sharing on an Open Intelligence entry.
 *
 * This is a convenience wrapper around updateEntry that only changes
 * exchange_share_enabled. When a vendor disables sharing, the entry
 * immediately stops being used in future analyst Exchange retrieval.
 * Existing purchased access does not override withdrawal.
 */
export async function toggleExchangeShare(
  entryId: string,
  enabled: boolean,
): Promise<UpdateEntryResult> {
  return updateEntry({ entryId, exchangeShareEnabled: enabled });
}

// ── Phase 6A: Trust UI Service Functions ────────────────────────────────

/** Validation status display labels for trust indicators. */
export const VALIDATION_STATUS_LABELS: Record<string, string> = {
  pending_review: "Pending Review",
  validated: "Community Supported",
  community_supported: "Community Supported",
  externally_supported: "Externally Supported",
  disputed: "Disputed",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

/** Validation status colors for trust indicators. */
export function validationStatusColor(status: string): string {
  switch (status) {
    case "externally_supported":
      return "#00FFB2";
    case "community_supported":
    case "validated":
      return "#6CE6FF";
    case "pending_review":
      return "#8DA2B5";
    case "disputed":
      return "#FFB547";
    case "rejected":
    case "withdrawn":
      return "#FF4D6D";
    default:
      return "#8DA2B5";
  }
}

/** Trust label from reputation overall_score (0-100). */
export function trustLabel(score: number): string {
  if (score >= 80) return "Highly Trusted";
  if (score >= 60) return "Trusted";
  if (score >= 40) return "Neutral";
  return "Developing";
}

/** Trust label color from reputation overall_score. */
export function trustLabelColor(score: number): string {
  if (score >= 80) return "#00FFB2";
  if (score >= 60) return "#6CE6FF";
  if (score >= 40) return "#FFB547";
  return "#8DA2B5";
}

/** Feedback type display labels. */
export const FEEDBACK_TYPE_LABELS: Record<string, string> = {
  helpful: "Helpful",
  accurate_to_my_experience: "Accurate to My Experience",
  needs_context: "Needs Context",
  outdated: "Outdated",
  incorrect: "Incorrect",
  misleading: "Misleading",
  abusive: "Abusive",
};

/** All feedback types in display order. */
export const FEEDBACK_TYPES_LIST: string[] = [
  "helpful",
  "accurate_to_my_experience",
  "needs_context",
  "outdated",
  "incorrect",
  "misleading",
  "abusive",
];

/** Dispute reason category display labels. */
export const DISPUTE_REASON_LABELS: Record<string, string> = {
  incorrect: "Incorrect",
  misleading: "Misleading",
  outdated: "Outdated",
  needs_context: "Needs Context",
  fabricated: "Fabricated",
  abusive: "Abusive",
  prohibited: "Prohibited",
  other: "Other",
};

/** All dispute reason categories in display order. */
export const DISPUTE_REASONS_LIST: string[] = [
  "incorrect",
  "misleading",
  "outdated",
  "needs_context",
  "fabricated",
  "abusive",
  "prohibited",
  "other",
];

// ── Worker call helpers ─────────────────────────────────────────────────

const FUNCTIONS_BASE_URL = process.env.EXPO_PUBLIC_RORK_FUNCTIONS_URL;

async function getWorkerAuth(): Promise<string | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  return sessionData?.session?.access_token ?? null;
}

/** Public contributor reputation (safe fields only). */
export type PublicReputation = {
  user_id: string;
  overall_score: number;
  calculated_at: string | null;
};

/** Fetch a user's public contributor reputation via the worker. */
export async function fetchPublicReputation(targetUserId: string): Promise<PublicReputation | null> {
  if (!FUNCTIONS_BASE_URL) return null;
  const token = await getWorkerAuth();
  if (!token) return null;
  try {
    const res = await fetch(
      `${FUNCTIONS_BASE_URL}/reputation?userId=${encodeURIComponent(targetUserId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = (await res.json()) as { ok: boolean; reputation?: PublicReputation };
    return data.ok ? data.reputation ?? null : null;
  } catch {
    return null;
  }
}

/** Batch fetch public reputations for multiple users. */
export async function fetchBulkPublicReputations(
  userIds: string[],
): Promise<Map<string, PublicReputation>> {
  const result = new Map<string, PublicReputation>();
  if (!userIds.length) return result;
  await Promise.all(
    userIds.map(async (uid) => {
      const rep = await fetchPublicReputation(uid);
      if (rep) result.set(uid, rep);
    }),
  );
  return result;
}

/** Vendor quality metrics from the safe RPC. */
export type VendorQualityMetrics = {
  avg_entry_quality: number;
  supported_entry_rate: number;
  dispute_rate: number;
  rejected_rate: number;
  recent_usefulness: number;
  eligible_exchange_entries: number;
  total_entries: number;
};

/** Fetch vendor quality metrics via the safe RPC. */
export async function fetchVendorQualityMetrics(
  vendorId: string,
): Promise<VendorQualityMetrics | null> {
  const { data, error } = await supabase
    .rpc("get_vendor_quality_metrics", { p_vendor_id: vendorId });
  if (error) {
    console.warn("[trust] vendor quality metrics failed", error.message);
    return null;
  }
  const row = (data as VendorQualityMetrics[])?.[0];
  return row ?? null;
}

/** Faction quality metrics from the safe RPC. */
export type FactionQualityMetrics = {
  total_shared_entries: number;
  avg_quality: number;
  supported_rate: number;
  disputed_rate: number;
  active_contributors: number;
  entries_used_in_responses: number;
};

/** Fetch faction quality metrics via the safe RPC. */
export async function fetchFactionQualityMetrics(
  factionId: string,
): Promise<FactionQualityMetrics | null> {
  const { data, error } = await supabase
    .rpc("get_faction_quality_metrics", { p_faction_id: factionId });
  if (error) {
    console.warn("[trust] faction quality metrics failed", error.message);
    return null;
  }
  const row = (data as FactionQualityMetrics[])?.[0];
  return row ?? null;
}

// ── Feedback & Dispute submission (secure worker only) ──────────────────

export type FeedbackResult =
  | { ok: true }
  | { ok: false; error: string };

/** Submit feedback through the secure worker. Never writes directly to Supabase. */
export async function submitFeedback(params: {
  entryId: string;
  feedbackType: string;
  optionalReason?: string;
  accessSource: "faction" | "exchange";
  factionId?: string;
  exchangePurchaseId?: string;
}): Promise<FeedbackResult> {
  if (!FUNCTIONS_BASE_URL) {
    return { ok: false, error: "Backend not configured." };
  }
  const token = await getWorkerAuth();
  if (!token) {
    return { ok: false, error: "Not authenticated." };
  }
  try {
    const res = await fetch(`${FUNCTIONS_BASE_URL}/feedback/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        entryId: params.entryId,
        feedbackType: params.feedbackType,
        optionalReason: params.optionalReason ?? undefined,
        accessSource: params.accessSource,
        factionId: params.factionId ?? undefined,
        exchangePurchaseId: params.exchangePurchaseId ?? undefined,
      }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    return data.ok ? { ok: true } : { ok: false, error: data.error ?? "Failed." };
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }
}

/** Submit a dispute through the secure worker. Never writes directly to Supabase. */
export async function submitDispute(params: {
  entryId: string;
  reasonCategory: string;
  explanation: string;
  supportingUrl?: string;
  accessSource: "faction" | "exchange";
  factionId?: string;
  exchangePurchaseId?: string;
}): Promise<FeedbackResult> {
  if (!FUNCTIONS_BASE_URL) {
    return { ok: false, error: "Backend not configured." };
  }
  const token = await getWorkerAuth();
  if (!token) {
    return { ok: false, error: "Not authenticated." };
  }
  try {
    const res = await fetch(`${FUNCTIONS_BASE_URL}/dispute/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        entryId: params.entryId,
        reasonCategory: params.reasonCategory,
        explanation: params.explanation,
        supportingUrl: params.supportingUrl ?? undefined,
        accessSource: params.accessSource,
        factionId: params.factionId ?? undefined,
        exchangePurchaseId: params.exchangePurchaseId ?? undefined,
      }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    return data.ok ? { ok: true } : { ok: false, error: data.error ?? "Failed." };
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }
}

// ── Phase 6B: Entry Management (secure worker only) ────────────────────

export type EntryActionResult =
  | { ok: true }
  | { ok: false; error: string };

/** Withdraw an entry through the secure worker. Sets validation_status to withdrawn. */
export async function withdrawEntry(entryId: string): Promise<EntryActionResult> {
  if (!FUNCTIONS_BASE_URL) return { ok: false, error: "Backend not configured." };
  const token = await getWorkerAuth();
  if (!token) return { ok: false, error: "Not authenticated." };
  try {
    const res = await fetch(`${FUNCTIONS_BASE_URL}/oi/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ entryId }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    return data.ok ? { ok: true } : { ok: false, error: data.error ?? "Failed." };
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }
}

/** Restore a withdrawn entry through the secure worker. Sets validation_status to pending_review. */
export async function restoreEntry(entryId: string): Promise<EntryActionResult> {
  if (!FUNCTIONS_BASE_URL) return { ok: false, error: "Backend not configured." };
  const token = await getWorkerAuth();
  if (!token) return { ok: false, error: "Not authenticated." };
  try {
    const res = await fetch(`${FUNCTIONS_BASE_URL}/oi/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ entryId }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    return data.ok ? { ok: true } : { ok: false, error: data.error ?? "Failed." };
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }
}

/** Toggle faction sharing for an entry through the secure worker. */
export async function toggleFactionShare(
  entryId: string,
  factionId: string,
  enabled: boolean,
): Promise<EntryActionResult> {
  if (!FUNCTIONS_BASE_URL) return { ok: false, error: "Backend not configured." };
  const token = await getWorkerAuth();
  if (!token) return { ok: false, error: "Not authenticated." };
  try {
    const res = await fetch(`${FUNCTIONS_BASE_URL}/oi/faction-share`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ entryId, factionId, enabled }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    return data.ok ? { ok: true } : { ok: false, error: data.error ?? "Failed." };
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }
}

// ── Phase 6B: Version History ────────────────────────────────────────────

export type VersionHistoryEntry = {
  id: string;
  entry_id: string;
  version_number: number;
  previous_content: string | null;
  previous_category: string | null;
  previous_subtags: string[] | null;
  previous_custom_tags: string[] | null;
  previous_confidence_level: string | null;
  previous_validation_status: string | null;
  previous_quality_score: number | null;
  previous_influence_score: number | null;
  change_type: string;
  changed_by: string;
  changed_at: string;
};

export type VersionHistoryResult =
  | { ok: true; versions: VersionHistoryEntry[] }
  | { ok: false; error: string };

/** Fetch version history for an entry through the secure worker. Owner-only. */
export async function fetchVersionHistory(entryId: string): Promise<VersionHistoryResult> {
  if (!FUNCTIONS_BASE_URL) return { ok: false, error: "Backend not configured." };
  const token = await getWorkerAuth();
  if (!token) return { ok: false, error: "Not authenticated." };
  try {
    const res = await fetch(
      `${FUNCTIONS_BASE_URL}/oi/versions?entryId=${encodeURIComponent(entryId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = (await res.json()) as { ok: boolean; error?: string; versions?: VersionHistoryEntry[] };
    if (data.ok && data.versions) {
      return { ok: true, versions: data.versions };
    }
    return { ok: false, error: data.error ?? "Failed." };
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }
}

/** Change type display labels. */
export const CHANGE_TYPE_LABELS: Record<string, string> = {
  create: "Created",
  edit: "Edited",
  moderation: "Moderated",
  withdrawal: "Withdrawn",
  restoration: "Restored",
  status_change: "Status Changed",
};

// ── Phase 6B: Moderation Queue (admin only) ──────────────────────────────

export type ModerationDispute = {
  id: string;
  reasonCategory: string;
  explanation: string;
  supportingUrl: string | null;
  status: string;
  createdAt: string;
};

export type ModerationQueueItem = {
  entryId: string;
  contentPreview: string;
  validationStatus: string;
  reportCount: number;
  contributorReputation: number | null;
  disputes: ModerationDispute[];
};

export type ModerationQueueResult =
  | { ok: true; queue: ModerationQueueItem[] }
  | { ok: false; error: string };

/** Fetch the moderation queue (admin only). */
export async function fetchModerationQueue(): Promise<ModerationQueueResult> {
  if (!FUNCTIONS_BASE_URL) return { ok: false, error: "Backend not configured." };
  const token = await getWorkerAuth();
  if (!token) return { ok: false, error: "Not authenticated." };
  try {
    const res = await fetch(`${FUNCTIONS_BASE_URL}/moderation/queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as { ok: boolean; error?: string; queue?: ModerationQueueItem[] };
    if (data.ok && data.queue) {
      return { ok: true, queue: data.queue };
    }
    return { ok: false, error: data.error ?? "Failed." };
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }
}

export type ModerationAction =
  | "dismiss_dispute"
  | "mark_community_supported"
  | "mark_externally_supported"
  | "mark_disputed"
  | "reject_entry";

export const MODERATION_ACTION_LABELS: Record<ModerationAction, string> = {
  dismiss_dispute: "Dismiss Dispute",
  mark_community_supported: "Mark Community Supported",
  mark_externally_supported: "Mark Externally Supported",
  mark_disputed: "Mark Disputed",
  reject_entry: "Reject Entry",
};

/** Perform a moderation action (admin only). */
export async function performModerationAction(
  entryId: string,
  action: ModerationAction,
  disputeId?: string,
): Promise<EntryActionResult> {
  if (!FUNCTIONS_BASE_URL) return { ok: false, error: "Backend not configured." };
  const token = await getWorkerAuth();
  if (!token) return { ok: false, error: "Not authenticated." };
  try {
    const res = await fetch(`${FUNCTIONS_BASE_URL}/moderation/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ entryId, action, disputeId: disputeId ?? undefined }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    return data.ok ? { ok: true } : { ok: false, error: data.error ?? "Failed." };
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }
}

/** Check if the current user has admin moderation access.
 *
 *  Uses the explicit is_admin flag verified server-side. Subscription tiers
 *  and admin_tier_override are NOT sufficient for moderation access.
 */
export function hasModerationAccess(profile: { is_admin: boolean | null; admin_tier_expires_at: string | null } | null | undefined): boolean {
  if (!profile || !profile.is_admin) return false;
  if (profile.admin_tier_expires_at) {
    const expires = new Date(profile.admin_tier_expires_at).getTime();
    if (Date.now() > expires) return false;
  }
  return true;
}

// ── Phase 6C: Intelligence Notifications & Audit ─────────────────────────

export type IntelligenceNotification = {
  id: string;
  entryId: string | null;
  notificationType: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
};

export type NotificationsResult =
  | { ok: true; notifications: IntelligenceNotification[]; unreadCount: number }
  | { ok: false; error: string };

/** Fetch the authenticated user's own notifications. */
export async function fetchNotifications(): Promise<NotificationsResult> {
  if (!FUNCTIONS_BASE_URL) return { ok: false, error: "Backend not configured." };
  const token = await getWorkerAuth();
  if (!token) return { ok: false, error: "Not authenticated." };
  try {
    const res = await fetch(`${FUNCTIONS_BASE_URL}/notifications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as {
      ok: boolean;
      error?: string;
      notifications?: IntelligenceNotification[];
      unreadCount?: number;
    };
    if (data.ok && data.notifications) {
      return { ok: true, notifications: data.notifications, unreadCount: data.unreadCount ?? 0 };
    }
    return { ok: false, error: data.error ?? "Failed." };
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }
}

/** Mark a single notification as read. */
export async function markNotificationRead(
  notificationId: string,
): Promise<EntryActionResult> {
  if (!FUNCTIONS_BASE_URL) return { ok: false, error: "Backend not configured." };
  const token = await getWorkerAuth();
  if (!token) return { ok: false, error: "Not authenticated." };
  try {
    const res = await fetch(`${FUNCTIONS_BASE_URL}/notifications/mark-read`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ notificationId }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    return data.ok ? { ok: true } : { ok: false, error: data.error ?? "Failed." };
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }
}

/** Mark all of the user's notifications as read. */
export async function markAllNotificationsRead(): Promise<EntryActionResult> {
  if (!FUNCTIONS_BASE_URL) return { ok: false, error: "Backend not configured." };
  const token = await getWorkerAuth();
  if (!token) return { ok: false, error: "Not authenticated." };
  try {
    const res = await fetch(`${FUNCTIONS_BASE_URL}/notifications/mark-all-read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    return data.ok ? { ok: true } : { ok: false, error: data.error ?? "Failed." };
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }
}

// ── Phase 6C: Moderation Audit History (admin only) ──────────────────────

export type ModerationAuditEntry = {
  id: string;
  entryId: string;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  disputeId: string | null;
  note: string | null;
  createdAt: string;
};

export type ModerationAuditResult =
  | { ok: true; audit: ModerationAuditEntry[] }
  | { ok: false; error: string };

/** Fetch moderation audit history (admin only). Moderator identity is never exposed. */
export async function fetchModerationAudit(
  entryId?: string,
): Promise<ModerationAuditResult> {
  if (!FUNCTIONS_BASE_URL) return { ok: false, error: "Backend not configured." };
  const token = await getWorkerAuth();
  if (!token) return { ok: false, error: "Not authenticated." };
  try {
    const url = new URL(`${FUNCTIONS_BASE_URL}/moderation/audit`);
    if (entryId) url.searchParams.set("entryId", entryId);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as {
      ok: boolean;
      error?: string;
      audit?: ModerationAuditEntry[];
    };
    if (data.ok && data.audit) {
      return { ok: true, audit: data.audit };
    }
    return { ok: false, error: data.error ?? "Failed." };
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }
}

/** Status explanation shown beneath the status badge on My Intelligence.
 *  Does not expose internal moderation notes. */
export function statusExplanation(status: string, isOutdated: boolean): string | null {
  if (isOutdated) {
    return "This entry may be outdated and could receive reduced influence in analyst context.";
  }
  switch (status) {
    case "community_supported":
      return "This entry has received community support and is trusted in analyst context.";
    case "externally_supported":
      return "This entry was supported by external evidence and carries higher trust.";
    case "disputed":
      return "This entry has been marked disputed and may receive reduced influence.";
    case "rejected":
      return "This entry was rejected and is excluded from analyst, Faction, and Exchange use.";
    default:
      return null;
  }
}

// ── Phase 7A: Search & Filtering ──────────────────────────────────────────

export type SortOption = "newest" | "oldest" | "highest_quality" | "lowest_quality" | "recently_updated";

export type SharingFilter = "all" | "faction" | "exchange" | "private";

export interface MyIntelligenceFilters {
  search: string;
  category: string; // "all" or a category id
  validationStatus: string; // "all" or a status id
  confidence: string; // "all" or a confidence level
  sharing: SharingFilter;
  sort: SortOption;
}

export const DEFAULT_FILTERS: MyIntelligenceFilters = {
  search: "",
  category: "all",
  validationStatus: "all",
  confidence: "all",
  sharing: "all",
  sort: "newest",
};

export const SORT_LABELS: Record<SortOption, string> = {
  newest: "Newest",
  oldest: "Oldest",
  highest_quality: "Highest Quality",
  lowest_quality: "Lowest Quality",
  recently_updated: "Recently Updated",
};

export const SHARING_LABELS: Record<SharingFilter, string> = {
  all: "All",
  faction: "Shared with Faction",
  exchange: "Shared on Exchange",
  private: "Private",
};

export const VALIDATION_STATUS_FILTER_OPTIONS: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending_review", label: "Pending Review" },
  { id: "community_supported", label: "Community Supported" },
  { id: "externally_supported", label: "Externally Supported" },
  { id: "disputed", label: "Disputed" },
  { id: "withdrawn", label: "Withdrawn" },
  { id: "rejected", label: "Rejected" },
];

export const CONFIDENCE_FILTER_OPTIONS: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  ...CONFIDENCE_LEVELS,
];

/** Statuses allowed in shared/public views (excludes withdrawn & rejected). */
export const SHARED_VIEW_STATUSES: string[] = [
  "pending_review",
  "validated",
  "community_supported",
  "externally_supported",
  "disputed",
];

/**
 * Apply client-side filtering & sorting to a list of entries.
 * Used for My Intelligence (all entries) and shared views.
 * The DB query is already scoped to authorized entries (owner or shared).
 */
export function applyEntryFilters(
  entries: OpenIntelligenceRow[],
  filters: MyIntelligenceFilters,
  sharedFactionMap?: Map<string, string[]>,
): OpenIntelligenceRow[] {
  const q = filters.search.trim().toLowerCase();
  let result = entries;

  if (q) {
    result = result.filter((e) => {
      const content = e.content.toLowerCase();
      const category = (e.selected_category ?? e.tag ?? "").toLowerCase();
      const subtags = (e.selected_subtags ?? []).join(" ").toLowerCase();
      const custom = (e.custom_tags ?? []).join(" ").toLowerCase();
      return (
        content.includes(q) ||
        category.includes(q) ||
        subtags.includes(q) ||
        custom.includes(q)
      );
    });
  }

  if (filters.category !== "all") {
    result = result.filter(
      (e) => (e.selected_category ?? e.tag ?? "") === filters.category,
    );
  }

  if (filters.validationStatus !== "all") {
    result = result.filter((e) => (e.validation_status ?? "pending_review") === filters.validationStatus);
  }

  if (filters.confidence !== "all") {
    result = result.filter((e) => e.confidence_level === filters.confidence);
  }

  if (filters.sharing !== "all") {
    if (filters.sharing === "exchange") {
      result = result.filter((e) => e.exchange_share_enabled ?? false);
    } else if (filters.sharing === "faction") {
      result = result.filter(
        (e) => (sharedFactionMap?.get(e.id)?.length ?? 0) > 0,
      );
    } else if (filters.sharing === "private") {
      result = result.filter(
        (e) =>
          !(e.exchange_share_enabled ?? false) &&
          (sharedFactionMap?.get(e.id)?.length ?? 0) === 0,
      );
    }
  }

  switch (filters.sort) {
    case "newest":
      result = [...result].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      break;
    case "oldest":
      result = [...result].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      break;
    case "highest_quality":
      result = [...result].sort((a, b) => (b.quality_score ?? 0) - (a.quality_score ?? 0));
      break;
    case "lowest_quality":
      result = [...result].sort((a, b) => (a.quality_score ?? 0) - (b.quality_score ?? 0));
      break;
    case "recently_updated":
      result = [...result].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      break;
  }

  return result;
}

/** Paginate an array of entries for incremental loading. */
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = page * pageSize;
  return items.slice(0, start + pageSize);
}

// ── Phase 7A: Saved Filter Presets ────────────────────────────────────────

export type SavedFilterPreset = {
  id: string;
  name: string;
  filters: MyIntelligenceFilters;
  createdAt: string;
};

/**
 * Storage key is user-scoped so one account never sees another account's
 * presets on the same device.
 */
const SAVED_FILTERS_KEY_PREFIX = "eagoh_oi_saved_filters_";
const MAX_SAVED_FILTERS = 5;

function savedFiltersKey(userId: string): string {
  return `${SAVED_FILTERS_KEY_PREFIX}${userId}`;
}

/** Load the authenticated user's saved filter presets from AsyncStorage. */
export async function loadSavedFilters(userId: string): Promise<SavedFilterPreset[]> {
  try {
    const stored = await AsyncStorage.getItem(savedFiltersKey(userId));
    const list: SavedFilterPreset[] = stored ? JSON.parse(stored) : [];
    return list.slice(0, MAX_SAVED_FILTERS);
  } catch {
    return [];
  }
}

/** Save a new filter preset for the authenticated user. Enforces the 5-preset limit. */
export async function saveFilterPreset(
  userId: string,
  name: string,
  filters: MyIntelligenceFilters,
): Promise<SavedFilterPreset[]> {
  try {
    const existing = await loadSavedFilters(userId);
    const preset: SavedFilterPreset = {
      id: `preset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim().slice(0, 40),
      filters,
      createdAt: new Date().toISOString(),
    };
    const updated = [preset, ...existing].slice(0, MAX_SAVED_FILTERS);
    await AsyncStorage.setItem(savedFiltersKey(userId), JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

/** Delete a saved filter preset by id for the authenticated user. */
export async function deleteFilterPreset(
  userId: string,
  presetId: string,
): Promise<SavedFilterPreset[]> {
  try {
    const existing = await loadSavedFilters(userId);
    const updated = existing.filter((p) => p.id !== presetId);
    await AsyncStorage.setItem(savedFiltersKey(userId), JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

// ── Phase 7A: Server-side paginated query for My Intelligence ───────────────

export interface PaginatedEntriesResult {
  entries: OpenIntelligenceRow[];
  hasMore: boolean;
  nextPage: number | undefined;
}

/**
 * Fetch a single page of the authenticated user's entries with server-side
 * filtering, sorting, and `.range()` pagination.
 *
 * Ownership is always scoped to userId. Search uses PostgREST ilike on
 * content, tag (which embeds subtags + custom tags via formatTagField),
 * and selected_category — covering all four search targets.
 * Faction sharing filter uses the pre-fetched sharedFactionEntryIds list.
 */
export async function listMyEntriesPage(
  userId: string,
  page: number,
  pageSize: number,
  filters: MyIntelligenceFilters,
  sharedFactionEntryIds: string[],
): Promise<PaginatedEntriesResult> {
  let query = supabase
    .from("open_intelligence")
    .select("*")
    .eq("user_id", userId);

  // Search: ilike on content, tag (embeds subtags + custom tags), selected_category
  const q = filters.search.trim();
  if (q) {
    const like = `%${q}%`;
    query = query.or(
      `content.ilike.${like},tag.ilike.${like},selected_category.ilike.${like}`,
    );
  }

  // Category filter
  if (filters.category !== "all") {
    query = query.eq("selected_category", filters.category);
  }

  // Validation status filter
  if (filters.validationStatus !== "all") {
    query = query.eq("validation_status", filters.validationStatus);
  }

  // Confidence filter
  if (filters.confidence !== "all") {
    query = query.eq("confidence_level", filters.confidence);
  }

  // Sharing filter
  if (filters.sharing === "exchange") {
    query = query.eq("exchange_share_enabled", true);
  } else if (filters.sharing === "faction") {
    if (sharedFactionEntryIds.length === 0) {
      return { entries: [], hasMore: false, nextPage: undefined };
    }
    query = query.in("id", sharedFactionEntryIds);
  } else if (filters.sharing === "private") {
    query = query.eq("exchange_share_enabled", false);
    if (sharedFactionEntryIds.length > 0) {
      const list = sharedFactionEntryIds.map((id) => `"${id}"`).join(",");
      query = query.filter("id", "not.in", `(${list})`);
    }
  }

  // Sort
  switch (filters.sort) {
    case "newest":
      query = query.order("created_at", { ascending: false });
      break;
    case "oldest":
      query = query.order("created_at", { ascending: true });
      break;
    case "highest_quality":
      query = query.order("quality_score", { ascending: false });
      break;
    case "lowest_quality":
      query = query.order("quality_score", { ascending: true });
      break;
    case "recently_updated":
      query = query.order("updated_at", { ascending: false });
      break;
  }

  // Range pagination
  const from = page * pageSize;
  const to = from + pageSize - 1;
  const { data, error } = await query.range(from, to);
  if (error) throw error;

  const entries = (data ?? []) as OpenIntelligenceRow[];
  const hasMore = entries.length === pageSize;
  return { entries, hasMore, nextPage: hasMore ? page + 1 : undefined };
}

/** Re-export helpers */
export { influenceLabel };

// ── Phase 8A: Intelligence Analytics ───────────────────────────────────────

/** Owner intelligence summary — entry counts, averages, sharing totals. */
export type IntelligenceSummary = {
  totalEntries: number;
  activeEntries: number;
  pendingReview: number;
  communitySupported: number;
  externallySupported: number;
  disputed: number;
  withdrawn: number;
  rejected: number;
  outdated: number;
  avgQuality: number;
  avgInfluence: number;
  sharedWithFaction: number;
  sharedOnExchange: number;
};

/** Safe contributor reputation summary (no anti-gaming or moderation data). */
export type ReputationSummary = {
  overallScore: number;
  qualityComponent: number;
  usefulnessComponent: number;
  validationComponent: number;
  reliabilityComponent: number;
  calculatedAt: string | null;
};

/** Safe per-entry performance metrics (no reviewer identities). */
export type EntryPerformance = {
  entryId: string;
  qualityScore: number;
  influenceScore: number;
  validationStatus: string;
  analystUseCount: number;
  helpfulCount: number;
  supportCount: number;
  disputeCount: number;
  outdatedFlag: boolean;
  lastUsedAt: string | null;
};

/** Weekly trend bucket. */
export type WeeklyTrendPoint = {
  weekStart: string;
  entriesCreated: number;
  avgQuality: number;
  analystUses: number;
  feedbackCount: number;
};

/** Owner's contribution summary for a single faction. */
export type FactionContribution = {
  factionId: string;
  entriesShared: number;
  entriesUsedByAnalysts: number;
  avgQuality: number;
  supportedEntries: number;
  disputedEntries: number;
};

/** Owner's Exchange (vendor) contribution summary. Buyer identities are never exposed. */
export type ExchangeContribution = {
  eligibleExchangeEntries: number;
  synchronizedEntriesUsed: number;
  avgSharedQuality: number;
  supportedEntryRate: number;
  disputeRate: number;
  activePurchases: number;
  expiredPurchases: number;
};

/** Full analytics response from the secure worker. */
export type IntelligenceAnalytics = {
  summary: IntelligenceSummary | null;
  reputation: ReputationSummary;
  entryPerformance: EntryPerformance[];
  weeklyTrend: WeeklyTrendPoint[];
  factionContributions: FactionContribution[];
  exchangeContributions: ExchangeContribution;
};

export type AnalyticsResult =
  | { ok: true; analytics: IntelligenceAnalytics }
  | { ok: false; error: string };

/** Fetch the authenticated user's intelligence analytics via the secure worker. */
export async function fetchIntelligenceAnalytics(): Promise<AnalyticsResult> {
  if (!FUNCTIONS_BASE_URL) return { ok: false, error: "Backend not configured." };
  const token = await getWorkerAuth();
  if (!token) return { ok: false, error: "Not authenticated." };
  try {
    const res = await fetch(`${FUNCTIONS_BASE_URL}/intelligence/analytics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as { ok: boolean; error?: string; analytics?: IntelligenceAnalytics };
    if (data.ok && data.analytics) {
      return { ok: true, analytics: data.analytics };
    }
    return { ok: false, error: data.error ?? "Failed." };
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }
}
