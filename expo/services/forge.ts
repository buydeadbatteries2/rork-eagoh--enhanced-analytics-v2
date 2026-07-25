/**
 * EAGOH Forge orchestration service.
 *
 * Delegates ALL server-side work to the secure Cloudflare Worker route
 * `/forge/generate`:
 *   - Auth verification (Supabase JWT)
 *   - Tier check + EAGOH limit check
 *   - Neuron balance check + atomic deduction
 *   - OpenAI image generation (key never reaches the client)
 *   - EAGOH row create/update
 *   - Image generation history log
 *
 * If any step fails after image generation, the worker rolls back and
 * no Neurons are charged — the client never needs to refund.
 *
 * Edge deduction is NOT performed on the client — the worker is the
 * single source of truth for the atomic transaction.
 */

import { buildForgePrompt, type ForgePromptInput, type ForgePromptOptions } from "@/services/imagePrompt";
import { generateEagohImage, type ImageGenSize } from "@/services/imageGen";
import type { ImageGenerationMode } from "@/services/imageStorage";
import type { SubscriptionTier } from "@/services/profile";
import type { EagohDraft, EagohRecord } from "@/services/eagohs";

export type RunForgeMode = ImageGenerationMode;

export type RunForgeInput = {
  userId: string;
  tier: SubscriptionTier;
  mode: RunForgeMode;
  draft: EagohDraft;
  /** Required for full and partial reforge — the existing EAGOH being updated. */
  eagohId?: string;
  /** Scope hint for partial reforge prompts. */
  scope?: ForgePromptOptions["scope"];
  edgeCost: number;
  size?: ImageGenSize;
};

export type RunForgeResult =
  | { ok: true; eagoh: EagohRecord; imageUrl: string; thumbUrl: string | null; prompt: string }
  | { ok: false; reason: ForgeErrorReason; error: string };

export type ForgeErrorReason = "limit" | "image" | "persist" | "auth" | "balance";

function toPromptInput(draft: EagohDraft, tier?: SubscriptionTier): ForgePromptInput {
  return {
    name: draft.name,
    sport: draft.sport,
    gender: draft.gender,
    dna: draft.dna,
    teams: draft.teams,
    appearance: draft.appearance,
    cyberneticIntensity: draft.cyberneticIntensity,
    pose: draft.pose,
    lab: draft.lab,
    domain: draft.domain,
    tier: tier ?? "free",
  };
}

/**
 * Run the forge pipeline via the secure worker.
 *
 * The worker handles everything: auth, tier check, limit check, image
 * generation, EAGOH create/update, and Neuron deduction. If any step
 * fails, the worker rolls back — no client-side refund needed.
 */
export async function runForge(input: RunForgeInput): Promise<RunForgeResult> {
  const promptInput = toPromptInput(input.draft, input.tier);
  const prompt = buildForgePrompt(promptInput, {
    scope: input.mode === "partial_reforge" ? input.scope ?? "full" : "full",
  });

  // Delegate entirely to the secure worker endpoint.
  // edgeCost is NOT sent — the worker enforces the cost server-side.
  const gen = await generateEagohImage({
    prompt,
    mode: input.mode,
    draft: input.draft as unknown as Record<string, unknown>,
    eagohId: input.eagohId,
    scope: input.mode === "partial_reforge" ? input.scope ?? "full" : "full",
    size: input.size ?? "1024x1536",
  });

  if (!gen.ok) {
    // Classify the error reason from the worker's error message.
    const msg = gen.error;
    let reason: ForgeErrorReason = "image";
    if (/insufficient|balance|neurons|edge store/i.test(msg)) reason = "balance";
    else if (/forge requires|pro or higher|limit|upgrade|tier/i.test(msg)) reason = "limit";
    else if (/auth|sign in|session|expired/i.test(msg)) reason = "auth";
    else if (/create|persist|update|eagoh|save/i.test(msg)) reason = "persist";
    return { ok: false, reason, error: msg };
  }

  // The worker returns the image URL; we construct a minimal EagohRecord
  // for the client cache. The full record will be refetched via query invalidation.
  const eagoh: EagohRecord = {
    id: input.eagohId ?? "new",
    user_id: input.userId,
    name: input.draft.name,
    sport: input.draft.sport,
    gender: input.draft.gender,
    domain: input.draft.domain,
    body_type: input.draft.bodyType,
    style_notes: input.draft.styleNotes,
    cybernetic_intensity: input.draft.cyberneticIntensity,
    pose: input.draft.pose,
    lab: input.draft.lab,
    dna: input.draft.dna,
    image_url: gen.imageUrl,
    image_thumb_url: gen.thumbUrl,
    image_prompt: prompt,
    image_generated_at: new Date().toISOString(),
    last_name_change: null,
    is_default_shell: false,
    is_user_forged: true,
    status: "active",
    team_focus_mode: null,
    pro_team_focus_id: null,
    pro_team_focus_name: null,
    college_team_focus_id: null,
    college_team_focus_name: null,
    music_genre: null,
    music_role: null,
    film_tv_category: null,
    film_tv_genre: null,
    film_tv_role: null,
    fashion_style_category: null,
    fashion_role: null,
    education_subject: null,
    education_role: null,
    gaming_genre: null,
    gaming_role: null,
    business_industry: null,
    business_role: null,
    finance_focus: null,
    finance_role: null,
    technology_area: null,
    technology_role: null,
    health_fitness_area: null,
    health_fitness_role: null,
  };

  return { ok: true, eagoh, imageUrl: gen.imageUrl, thumbUrl: gen.thumbUrl, prompt };
}
