import { supabase } from "@/lib/supabase";
import type { SubscriptionTier } from "@/services/profile";

/**
 * EAGOH persistence service.
 *
 * Tables (run `expo/supabase-schema.sql` to create):
 *   - public.eagohs              -> identity + sport + cybernetics + pose + lab
 *   - public.eagoh_customization -> appearance map (jsonb)
 *   - public.eagoh_fanatic_teams -> team affinity rows
 *   - public.eagoh_labs          -> selected lab affinity rows
 *
 * No AI / image generation is connected — `image_url` is a placeholder reference only.
 */

export type TeamFocusMode = "none" | "pro_only" | "college_only" | "pro_college";

// ── Domain DNA helpers — store domain specialization data in the dna JSONB array ──
const DOMAIN_DNA_PREFIX = "dom:";

/** Maps EagohDraft camelCase keys to their snake_case DB column equivalents used in DNA entries. */
const DOMAIN_DRAFT_TO_COLUMN: Record<string, string> = {
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

/** Set of all valid snake_case column names for domain data (for parsing validation). */
const VALID_DOMAIN_COLUMNS: Set<string> = new Set(Object.values(DOMAIN_DRAFT_TO_COLUMN));

/** Encodes domain-specific draft fields into prefixed DNA array entries (e.g. "dom:business_industry:marketing"). */
function encodeDomainDna(draft: EagohDraft): string[] {
  const entries: string[] = [];
  for (const [draftKey, dbCol] of Object.entries(DOMAIN_DRAFT_TO_COLUMN)) {
    const value = (draft as unknown as Record<string, string | undefined>)[draftKey];
    if (value) entries.push(`${DOMAIN_DNA_PREFIX}${dbCol}:${value}`);
  }
  return entries;
}

/** Parses domain DNA entries and returns a partial record keyed by snake_case column names. */
function parseDomainFromDna(dna: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of dna) {
    if (typeof entry === "string" && entry.startsWith(DOMAIN_DNA_PREFIX)) {
      const rest = entry.slice(DOMAIN_DNA_PREFIX.length);
      const colonIdx = rest.indexOf(":");
      if (colonIdx > 0) {
        const field = rest.slice(0, colonIdx);
        const value = rest.slice(colonIdx + 1);
        if (value && VALID_DOMAIN_COLUMNS.has(field)) {
          result[field] = value;
        }
      }
    }
  }
  return result;
}

/** Applies parsed domain DNA values onto an EagohRecord and returns it. */
function applyDomainDnaToRecord(record: EagohRecord): EagohRecord {
  const decoded = parseDomainFromDna(record.dna ?? []);
  if (Object.keys(decoded).length === 0) return record;
  const result = { ...record };
  for (const [col, val] of Object.entries(decoded)) {
    (result as Record<string, unknown>)[col] = val;
  }
  return result;
}

export type EagohRecord = {
  id: string;
  user_id: string;
  name: string;
  sport: string;
  gender: string | null;
  domain: string | null;
  body_type: string | null;
  style_notes: string | null;
  cybernetic_intensity: string | null;
  pose: string | null;
  lab: string | null;
  dna: string[];
  image_url: string | null;
  image_thumb_url: string | null;
  image_prompt: string | null;
  image_generated_at: string | null;
  last_name_change: string | null;
  is_default_shell: boolean;
  is_user_forged: boolean;
  status: string | null;
  team_focus_mode: TeamFocusMode | null;
  pro_team_focus_id: string | null;
  pro_team_focus_name: string | null;
  college_team_focus_id: string | null;
  college_team_focus_name: string | null;
  music_genre: string | null;
  music_role: string | null;
  film_tv_category: string | null;
  film_tv_genre: string | null;
  film_tv_role: string | null;
  fashion_style_category: string | null;
  fashion_role: string | null;
  education_subject: string | null;
  education_role: string | null;
  gaming_genre: string | null;
  gaming_role: string | null;
  business_industry: string | null;
  business_role: string | null;
  finance_focus: string | null;
  finance_role: string | null;
  technology_area: string | null;
  technology_role: string | null;
  health_fitness_area: string | null;
  health_fitness_role: string | null;
  created_at?: string;
  updated_at?: string;
};

export type EagohCustomization = {
  eagoh_id: string;
  appearance: Record<string, string>;
};

export type EagohFanaticTeamRow = { eagoh_id: string; team_id: string };
export type EagohLabRow = { eagoh_id: string; lab_id: string };

export type EagohFull = EagohRecord & {
  appearance: Record<string, string>;
  /** Legacy fanatic teams array (deprecated, use pro_team_focus_id / college_team_focus_id). */
  teams: string[];
  labs: string[];
};

export type EagohDraft = {
  name: string;
  sport: string;
  gender: string;
  domain: string;
  bodyType: string;
  styleNotes: string;
  dna: string[];
  /** Legacy teams array (deprecated for sports domain). */
  teams: string[];
  /** Team focus mode for sports-domain EAGOHs. */
  teamFocusMode: TeamFocusMode;
  proTeamFocusId: string;
  proTeamFocusName: string;
  collegeTeamFocusId: string;
  collegeTeamFocusName: string;
  /** Music domain specialization. */
  musicGenre: string;
  musicRole: string;
  /** Film & TV domain specialization. */
  filmTvCategory: string;
  filmTvGenre: string;
  filmTvRole: string;
  /** Fashion domain specialization. */
  fashionStyleCategory: string;
  fashionRole: string;
  /** Education domain specialization. */
  educationSubject: string;
  educationRole: string;
  /** Gaming domain specialization. */
  gamingGenre: string;
  gamingRole: string;
  /** Business domain specialization. */
  businessIndustry: string;
  businessRole: string;
  /** Finance domain specialization. */
  financeFocus: string;
  financeRole: string;
  /** Technology domain specialization. */
  technologyArea: string;
  technologyRole: string;
  /** Health & Fitness domain specialization. */
  healthFitnessArea: string;
  healthFitnessRole: string;
  appearance: Record<string, string>;
  cyberneticIntensity: string;
  pose: string;
  lab: string;
  imageUrl?: string | null;
};

/** Maximum user-forged EAGOHs per tier. Default shells are excluded. */
export const TIER_EAGOH_LIMITS: Record<SubscriptionTier, number> = {
  free: 0,
  pro: 2,
  oracle_elite: 3,
  syndicate: 5,
};

export function getEagohLimit(tier: SubscriptionTier): number {
  return TIER_EAGOH_LIMITS[tier] ?? 1;
}

/** Lightweight list — does NOT load customization/teams/labs (lazy loaded per item). */
export async function listEagohs(userId: string): Promise<EagohRecord[]> {
  const { data, error } = await supabase
    .from("eagohs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const raw = (data ?? []) as EagohRecord[];
  return raw.map(applyDomainDnaToRecord);
}

export async function countEagohs(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("eagohs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw error;
  return count ?? 0;
}

/** Count only user-forged EAGOHs, excluding default dormant shells. */
export async function countUserForgedEagohs(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("eagohs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_default_shell", false);
  if (error) throw error;
  return count ?? 0;
}

/** Create the default dormant EAGOH shell for a new user. Idempotent — at most one per user. */
export async function createDefaultEagohShell(
  userId: string,
  defaultImageUrl: string,
): Promise<EagohRecord | null> {
  // Idempotency check — skip if one already exists
  const { data: existing } = await supabase
    .from("eagohs")
    .select("id")
    .eq("user_id", userId)
    .eq("is_default_shell", true)
    .maybeSingle();
  if (existing) return null;

  const { data: created, error } = await supabase
    .from("eagohs")
    .insert({
      user_id: userId,
      name: "EAGOH",
      domain: "general",
      image_url: defaultImageUrl,
      image_thumb_url: defaultImageUrl,
      is_default_shell: true,
      is_user_forged: false,
      status: "dormant",
      sport: "",
      dna: [],
      cybernetic_intensity: "minimal",
      pose: "calm-sentinel",
      lab: "neon-vault",
    })
    .select("*")
    .single();

  if (error || !created) {
    console.warn("[eagohs] failed to create default shell", error?.message ?? "unknown");
    return null;
  }

  return applyDomainDnaToRecord(created as EagohRecord);
}

export async function getEagohFull(eagohId: string): Promise<EagohFull | null> {
  const { data: base, error } = await supabase
    .from("eagohs")
    .select("*")
    .eq("id", eagohId)
    .maybeSingle();
  if (error) throw error;
  if (!base) return null;

  const [custom, teams, labs] = await Promise.all([
    supabase.from("eagoh_customization").select("appearance").eq("eagoh_id", eagohId).maybeSingle(),
    supabase.from("eagoh_fanatic_teams").select("team_id").eq("eagoh_id", eagohId),
    supabase.from("eagoh_labs").select("lab_id").eq("eagoh_id", eagohId),
  ]);

  return {
    ...applyDomainDnaToRecord(base as EagohRecord),
    appearance: ((custom.data as { appearance?: Record<string, string> } | null)?.appearance) ?? {},
    teams: ((teams.data as EagohFanaticTeamRow[] | null) ?? []).map((row) => row.team_id),
    labs: ((labs.data as EagohLabRow[] | null) ?? []).map((row) => row.lab_id),
  };
}

export type CreateEagohResult = { ok: true; eagoh: EagohRecord } | { ok: false; reason: "limit" | "error"; message: string };

export async function createEagoh(
  userId: string,
  tier: SubscriptionTier,
  draft: EagohDraft,
): Promise<CreateEagohResult> {
  const limit = getEagohLimit(tier);
  // Only count user-forged EAGOHs — default shells are excluded from the limit
  const current = await countUserForgedEagohs(userId);
  if (current >= limit) {
    return { ok: false, reason: "limit", message: `Your ${tier} tier allows ${limit} EAGOH${limit === 1 ? "" : "s"}. Upgrade to forge more.` };
  }

  // Merge domain DNA entries into the base dna array so domain data is persisted
  // in the existing dna JSONB column rather than separate columns (avoids schema drift).
  const domainDnaEntries = encodeDomainDna(draft);
  const mergedDna = [...draft.dna, ...domainDnaEntries];

  const insertPayload = {
    user_id: userId,
    name: draft.name?.trim() || "Unnamed EAGOH",
    sport: draft.sport,
    gender: draft.gender,
    domain: draft.domain || null,
    body_type: draft.bodyType || null,
    style_notes: draft.styleNotes || null,
    cybernetic_intensity: draft.cyberneticIntensity,
    pose: draft.pose,
    lab: draft.lab,
    dna: mergedDna,
    image_url: draft.imageUrl ?? null,
    team_focus_mode: draft.teamFocusMode || null,
    pro_team_focus_id: draft.proTeamFocusId || null,
    pro_team_focus_name: draft.proTeamFocusName || null,
    college_team_focus_id: draft.collegeTeamFocusId || null,
    college_team_focus_name: draft.collegeTeamFocusName || null,
  };

  const { data: created, error } = await supabase
    .from("eagohs")
    .insert(insertPayload)
    .select("*");
  if (error || !created || created.length === 0) return { ok: false, reason: "error", message: error?.message ?? "Failed to create EAGOH" };

  const eagoh = applyDomainDnaToRecord(created[0] as EagohRecord);

  try {
    await supabase.from("eagoh_customization").insert({ eagoh_id: eagoh.id, appearance: draft.appearance });
    if (draft.teams.length > 0) {
      await supabase
        .from("eagoh_fanatic_teams")
        .insert(draft.teams.map((team_id) => ({ eagoh_id: eagoh.id, team_id })));
    }
    if (draft.lab) {
      await supabase.from("eagoh_labs").insert({ eagoh_id: eagoh.id, lab_id: draft.lab });
    }
  } catch (childError) {
    console.warn("EAGOH child rows failed; base record exists.", childError);
  }

  return { ok: true, eagoh };
}

export async function deleteEagoh(eagohId: string): Promise<void> {
  const { error } = await supabase.from("eagohs").delete().eq("id", eagohId);
  if (error) throw error;
}

/**
 * Persist a newly generated image reference onto an EAGOH row. Does not
 * deduct Edge or call any image model — that orchestration lives in the
 * ForgeProvider.
 */
export async function updateEagohImage(
  eagohId: string,
  payload: { imageUrl: string; thumbUrl?: string | null; prompt: string },
): Promise<EagohRecord> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("eagohs")
    .update({
      image_url: payload.imageUrl,
      image_thumb_url: payload.thumbUrl ?? null,
      image_prompt: payload.prompt,
      image_generated_at: now,
      updated_at: now,
    })
    .eq("id", eagohId)
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("Failed to update EAGOH image");
  return applyDomainDnaToRecord(data as EagohRecord);
}

/** Partial-reforge persistence — swap one appearance category in customization. */
export async function updateEagohCustomizationField(
  eagohId: string,
  categoryId: string,
  optionId: string,
): Promise<void> {
  const { data: row } = await supabase
    .from("eagoh_customization")
    .select("appearance")
    .eq("eagoh_id", eagohId)
    .maybeSingle();
  const current = ((row as { appearance?: Record<string, string> } | null)?.appearance) ?? {};
  const next = { ...current, [categoryId]: optionId };
  const { error } = await supabase
    .from("eagoh_customization")
    .upsert({ eagoh_id: eagohId, appearance: next, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export type RenameEagohResult =
  | { ok: true; eagoh: EagohRecord }
  | { ok: false; reason: "free_tier" | "cooldown" | "error"; message: string };

/**
 * Rename an EAGOH. Deducts 75 Edge and enforces a 30-day cooldown.
 * Only Pro, Oracle Elite, and Syndicate users may rename.
 */
export async function renameEagohName(
  eagohId: string,
  newName: string,
  tier: string,
  lastNameChange: string | null | undefined,
): Promise<RenameEagohResult> {
  // --- Gate: free users cannot rename ---
  if (tier === "free") {
    return { ok: false, reason: "free_tier", message: "EAGOH renaming requires a Pro, Oracle Elite, or Syndicate subscription." };
  }

  // --- Cooldown check ---
  if (lastNameChange) {
    const last = new Date(lastNameChange).getTime();
    const msPerDay = 1000 * 60 * 60 * 24;
    const elapsedDays = (Date.now() - last) / msPerDay;
    if (elapsedDays < 30) {
      return { ok: false, reason: "cooldown", message: "Identity recalibration unavailable. EAGOH names may only be changed once every 30 days." };
    }
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("eagohs")
    .update({ name: newName.trim(), last_name_change: now, updated_at: now })
    .eq("id", eagohId)
    .select("*");

  if (error || !data || data.length === 0) {
    return { ok: false, reason: "error", message: error?.message ?? "Failed to rename EAGOH." };
  }

  return { ok: true, eagoh: applyDomainDnaToRecord(data[0] as EagohRecord) };
}
