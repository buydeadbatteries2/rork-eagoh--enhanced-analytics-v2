/**
 * EAGOH image prompt builder.
 *
 * Pure, structured prompt construction from forge inputs. No network calls.
 * Every prompt enforces:
 *  - full-body EAGOH render, head-to-toe
 *  - brain encased in a transparent glass dome head
 *  - same unified core EAGOH chassis / cybernetic suit
 *  - transparent background, isolated subject only
 *  - no human face — the head is always a glass dome with a brain inside
 *  - no team logos, no league logos, no copyrighted symbols
 *  - no real athlete likenesses
 *  - futuristic cybernetic premium aesthetic
 *
 * Reusable for initial forge, full reforge, and partial reforge prompts.
 */

export type ForgePromptInput = {
  name?: string;
  sport: string;
  gender?: string | null;
  dna: string[];
  teams: string[];
  appearance: Record<string, string>; // free-text descriptions per category
  cyberneticIntensity: string;
  pose: string;
  lab?: string | null;
  domain?: string | null;
  tier?: string | null;
};

export type ForgePromptOptions = {
  /** Limits the prompt to just the changed surface (partial reforge). */
  scope?: "full" | "headwear" | "body" | "footwear" | "accessories" | "pose" | "cybernetic";
};

const SPORT_CUES: Record<string, string> = {
  football: "powerful build, gridiron silhouette cues, no jersey logos",
  basketball: "lean explosive frame, court-ready silhouette, no jersey logos",
  soccer: "agile mid-pace build, pitch-ready silhouette, no kit logos",
  baseball: "balanced compact frame, diamond-ready silhouette, no team logos",
};

const INTENSITY_CUES: Record<string, string> = {
  minimal: "subtle neural seams along the jawline and forearms, restrained chrome accents",
  moderate: "visible cybernetic optic glow, sleek alloy plating on shoulders and forearms",
  heavy: "reinforced cybernetic limbs, exposed circuit traces, layered alloy chest plating",
  assimilated: "full machine-myth conversion, dense armored plating, glowing core lattice, only human eyes visible",
};

const POSE_CUES: Record<string, string> = {
  "arms-crossed": "standing tall, arms crossed firmly across chest, unshaken authority pose, facing camera directly, full-body visible",
  "strategist-stance": "calm mid-call calculation pose, one hand resting on chin, body slightly angled, contemplative strategist",
  "tactical-ready": "ready-to-deploy tactical stance, weight balanced on both feet, slight forward lean, hands at sides ready to move",
  "confident-walk": "mid-stride confident walk forward, one foot ahead, arms swinging naturally, powerful purposeful gait",
  "power-stance": "wide power stance with feet planted firmly apart, hands on hips, chest forward, commanding presence",
  "hands-behind-back": "standing upright with hands clasped behind back, calm sentinel posture, composed and watchful",
  "one-hand-forward": "one hand extended forward palm open as if issuing a directive, other arm at side, authoritative gesture",
  "champion-pose": "victory champion pose, one arm raised overhead in triumph, confident celebratory stance",
  "leaning-forward": "leaning forward slightly with both hands resting on an invisible tactical console, intense focused gaze",
  "calm-sentinel": "standing perfectly still, arms relaxed at sides, calm sentinel guardian pose, serene yet imposing",
};

const DNA_CUES: Record<string, string> = {
  oracle: "predictive analyst aura, cool cyan accent lighting",
  enforcer: "dominant enforcer aura, ember-red accent lighting",
  strategist: "tactical strategist aura, violet accent lighting",
  icon: "magnetic icon aura, gold accent lighting",
  phantom: "stealth phantom aura, deep teal accent lighting",
};

const GENDER_CUES: Record<string, string> = {
  masculine: "masculine-presenting build",
  feminine: "feminine-presenting build",
  androgynous: "androgynous build",
  nonbinary: "non-binary build",
  male: "masculine-presenting build",
  female: "feminine-presenting build",
  neutral: "androgynous balanced build",
};

const BODY_TYPE_CUES: Record<string, string> = {
  slim: "slim lean frame",
  average: "average athletic frame",
  muscular: "muscular powerful build",
  "heavy-husky": "heavy husky solid frame",
};

const TIER_AESTHETIC_CUES: Record<string, string> = {
  free: "battered dormant shell, cracked plating, dim lights, exposed wiring, dull gray black white muted tone",
  pro: "activated polished chassis, clean alloy lines, bright neural glow, ready stance, premium cybernetic finish",
  oracle_elite: "activated polished chassis, clean alloy lines, bright neural glow, ready stance, premium cybernetic finish",
  syndicate: "activated polished chassis, clean alloy lines, bright neural glow, ready stance, premium cybernetic finish",
};

/**
 * Describes appearance from the user's free-text inputs.
 * Each category value is the raw text the user typed — no ID mapping.
 */
function describeAppearance(appearance: Record<string, string>): string[] {
  const out: string[] = [];
  const labels: Record<string, string> = {
    headwear: "headwear",
    body: "body gear",
    footwear: "footwear",
    accessories: "accessories",
  };
  for (const [category, value] of Object.entries(appearance)) {
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    const label = labels[category] ?? category;
    out.push(`${label}: ${trimmed}`);
  }
  return out;
}

function describeDna(dna: string[]): string {
  const phrases = dna.map((id) => DNA_CUES[id]).filter(Boolean);
  return phrases.join(", ");
}

function describeTeams(teams: string[]): string {
  if (teams.length === 0) return "";
  // Fanatic team themes are mood/lighting cues only — never logos, never real teams.
  return `subtle fictional faction lighting hint (no logos, no real team marks): ${teams.length} affinity layer${teams.length === 1 ? "" : "s"}`;
}

const NEGATIVE_GUARDRAILS =
  "Absolutely no human face — the head is a transparent glass dome containing a visible brain only. No team logos, no league marks, no recognizable real athlete likeness, no copyrighted brand iconography, no stadium or environment, no background scene, no shadows on the floor, no text, no watermark. No team colors as direct design elements — only inspired lighting hues allowed.";

const CORE_CHASSIS =
  "Same unified EAGOH core chassis design across all renders — sleek full-body cybernetic suit with layered alloy plating, integrated neural conduit lines, shoulder-mounted interface nodes, and forearm data blades. The head is always a transparent glass dome containing a visible brain — never a human face. The chassis is always present and consistent.";

const POSITIVE_FRAMING =
  "Full-body character render, brain visible inside a transparent glass dome helmet head, no human face, same core EAGOH chassis and suit, isolated subject only on a fully transparent background, centered, head-to-toe visible, photographic premium quality, sharp edges, cinematic rim lighting, futuristic cybernetic style, collectible-grade tactical character art, identity-driven, mobile-optimized clean silhouette.";

/**
 * Build a structured prompt string from forge inputs.
 *
 * Scope variants enable partial reforges where only a single surface (e.g. footwear)
 * is described in detail while the rest stays as a brief identity anchor.
 */
export function buildForgePrompt(input: ForgePromptInput, options: ForgePromptOptions = {}): string {
  const { scope = "full" } = options;
  const sportCue = SPORT_CUES[input.sport] ?? "premium athlete silhouette, no logos";
  const intensityCue = INTENSITY_CUES[input.cyberneticIntensity] ?? INTENSITY_CUES.moderate;
  const poseCue = POSE_CUES[input.pose] ?? POSE_CUES["calm-sentinel"];
  const genderCue = input.gender ? GENDER_CUES[input.gender] ?? "balanced athletic build" : "balanced athletic build";
  const dnaCue = describeDna(input.dna);
  const teamCue = describeTeams(input.teams);
  const appearanceList = describeAppearance(input.appearance);

  const identityAnchor = [
    `EAGOH codename "${(input.name ?? "Unnamed EAGOH").slice(0, 48)}"`,
    `${input.sport} archetype`,
    genderCue,
  ].join(", ");

  const tierCue = TIER_AESTHETIC_CUES[input.tier ?? "free"] ?? TIER_AESTHETIC_CUES.free;

  if (scope === "full") {
    const body = [
      POSITIVE_FRAMING,
      CORE_CHASSIS,
      identityAnchor,
      sportCue,
      `chassis state: ${tierCue}`,
      `cybernetic intensity: ${intensityCue}`,
      `DNA traits: ${dnaCue || "balanced tactical signature"}`,
      teamCue,
      appearanceList.length ? `wearing ${appearanceList.join(", ")}` : "",
      `pose: ${poseCue}`,
      NEGATIVE_GUARDRAILS,
    ].filter(Boolean);
    return body.join(" — ");
  }

  // Partial reforge: tight, surface-focused prompt with identity anchor.
  const surface = (() => {
    if (scope === "headwear") return appearanceList.find((s) => s.startsWith("headwear:"));
    if (scope === "body") return appearanceList.find((s) => s.startsWith("body gear:"));
    if (scope === "footwear") return appearanceList.find((s) => s.startsWith("footwear:"));
    if (scope === "accessories") return appearanceList.find((s) => s.startsWith("accessories:"));
    if (scope === "pose") return `pose change to ${poseCue}`;
    if (scope === "cybernetic") return `cybernetic intensity change to ${intensityCue}`;
    return undefined;
  })();

  return [
    POSITIVE_FRAMING,
    identityAnchor,
    `partial reforge — focus surface: ${surface ?? scope}`,
    NEGATIVE_GUARDRAILS,
  ].join(" — ");
}

/** Summary lines for the confirmation flow — never sent to the image model. */
export function buildForgeSummary(input: ForgePromptInput): string[] {
  return [
    `Name: ${input.name?.trim() || "Unnamed EAGOH"}`,
    `Sport: ${input.sport}`,
    `Cybernetic intensity: ${input.cyberneticIntensity}`,
    `Pose: ${input.pose.replace(/-/g, " ")}`,
    `DNA: ${input.dna.length ? input.dna.join(" + ") : "none selected"}`,
    `Fanatic affinities: ${input.teams.length} selected`,
    `Appearance layers: ${Object.keys(input.appearance).length}`,
  ];
}
