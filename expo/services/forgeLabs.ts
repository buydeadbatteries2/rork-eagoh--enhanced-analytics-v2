/**
 * Shared Forge Lab configuration — single source of truth for all lab
 * environments used by the EAGOH Forge.
 *
 * Used by:
 *  - Forge Lab selector (forge.tsx)
 *  - Labs feature card (labs.tsx)
 *  - Image generation prompt (imagePrompt.ts)
 *  - Forge confirmation summary
 *  - EAGOH edit/reforge restore
 *
 * Canonical IDs use snake_case. Legacy hyphenated IDs (e.g. "neon-vault")
 * and display names are normalized to canonical IDs via normalizeLabId().
 */

export type LabTone = "cyan" | "gold" | "violet" | "ember" | "success";

export type ForgeLab = {
  /** Stable canonical key (snake_case). */
  id: string;
  /** Display name shown in the selector and summary. */
  label: string;
  /** Short tagline shown under the label. */
  detail: string;
  /** UI accent tone. */
  tone: LabTone;
  /** Hex color for UI accents / glow effects. */
  primaryColor: string;
  /** Secondary hex color for gradients. */
  secondaryColor: string;
  /** Human-readable glow description for summary display. */
  glowDescription: string;
  /** Full environment description injected into the image-generation prompt. */
  generationPrompt: string;
};

/** The canonical 8 lab options, in display order. */
export const FORGE_LABS: ForgeLab[] = [
  {
    id: "neon_vault",
    label: "Neon Vault",
    detail: "identity calibration",
    tone: "cyan",
    primaryColor: "#36F5FF",
    secondaryColor: "#0A6E78",
    glowDescription: "electric cyan glow",
    generationPrompt:
      "futuristic laboratory with electric-cyan energy lighting, neon-blue plasma accents, and dark metallic architecture",
  },
  {
    id: "obsidian_bay",
    label: "Obsidian Bay",
    detail: "armor diagnostics",
    tone: "violet",
    primaryColor: "#7C5CFF",
    secondaryColor: "#2A1E5C",
    glowDescription: "violet plasma glow",
    generationPrompt:
      "futuristic laboratory with deep-violet energy lighting, purple plasma accents, and dark obsidian metallic architecture",
  },
  {
    id: "gold_ring",
    label: "Gold Ring",
    detail: "fanatic resonance",
    tone: "gold",
    primaryColor: "#FFD23F",
    secondaryColor: "#7A6418",
    glowDescription: "warm gold resonance",
    generationPrompt:
      "futuristic laboratory with warm gold energy lighting, amber resonance accents, and dark metallic architecture",
  },
  {
    id: "plasma_chamber",
    label: "Plasma Chamber",
    detail: "energy containment",
    tone: "violet",
    primaryColor: "#B14EFF",
    secondaryColor: "#4A1E7A",
    glowDescription: "electric purple violet glow",
    generationPrompt:
      "futuristic laboratory with electric-purple energy lighting, violet plasma accents, and dark metallic architecture",
  },
  {
    id: "crimson_core",
    label: "Crimson Core",
    detail: "reactor calibration",
    tone: "ember",
    primaryColor: "#FF3B5C",
    secondaryColor: "#7A1A2A",
    glowDescription: "deep crimson energy glow",
    generationPrompt:
      "futuristic laboratory with deep crimson energy lighting, red reactor glow, and black metallic architecture",
  },
  {
    id: "arctic_reactor",
    label: "Arctic Reactor",
    detail: "cryogenic sync",
    tone: "cyan",
    primaryColor: "#5BBFFF",
    secondaryColor: "#1A4A6E",
    glowDescription: "ice blue white-blue glow",
    generationPrompt:
      "futuristic laboratory with icy blue and white illumination, silver metallic architecture, and cold reactor lighting",
  },
  {
    id: "emerald_nexus",
    label: "Emerald Nexus",
    detail: "neural grid sync",
    tone: "success",
    primaryColor: "#22DD66",
    secondaryColor: "#0A5C2A",
    glowDescription: "emerald neon green glow",
    generationPrompt:
      "futuristic laboratory with emerald-neon energy lighting, green digital accents, and graphite metallic architecture",
  },
  {
    id: "solar_foundry",
    label: "Solar Foundry",
    detail: "thermal forging",
    tone: "gold",
    primaryColor: "#FF8C1A",
    secondaryColor: "#7A4010",
    glowDescription: "orange amber warm energy glow",
    generationPrompt:
      "futuristic laboratory with orange and amber energy lighting, warm reactor glow, and gunmetal architecture",
  },
];

/** Quick lookup by canonical ID. */
const LAB_MAP: ReadonlyMap<string, ForgeLab> = new Map(
  FORGE_LABS.map((lab) => [lab.id, lab]),
);

/**
 * Legacy ID mappings — normalizes older saved values to canonical IDs.
 * Handles hyphenated variants, display names, and short keys.
 */
const LEGACY_MAP: Record<string, string> = {
  // Hyphenated legacy → canonical
  "neon-vault": "neon_vault",
  "obsidian-bay": "obsidian_bay",
  "gold-ring": "gold_ring",
  // Display name → canonical
  "Neon Vault": "neon_vault",
  "Obsidian Bay": "obsidian_bay",
  "Gold Ring": "gold_ring",
  // Short keys → canonical
  neon: "neon_vault",
  obsidian: "obsidian_bay",
  gold: "gold_ring",
};

/**
 * Normalize any saved lab value to its canonical ID.
 * Returns "neon_vault" as the safe default for unrecognized values
 * (preserves backward compat — older EAGOHs always had a valid lab).
 */
export function normalizeLabId(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "neon_vault";
  const trimmed = raw.trim();
  if (LAB_MAP.has(trimmed)) return trimmed;
  const legacy = LEGACY_MAP[trimmed];
  if (legacy && LAB_MAP.has(legacy)) return legacy;
  // Case-insensitive fallback for display names
  const lower = trimmed.toLowerCase();
  const legacyLower = LEGACY_MAP[lower] ?? LEGACY_MAP[trimmed];
  if (legacyLower && LAB_MAP.has(legacyLower)) return legacyLower;
  // If it's a legacy hyphenated form not in the map, try replacing hyphens
  const underscored = lower.replace(/-/g, "_");
  if (LAB_MAP.has(underscored)) return underscored;
  return "neon_vault";
}

/** Get a ForgeLab by its canonical ID (after normalization). */
export function getForgeLab(id: string | null | undefined): ForgeLab {
  return LAB_MAP.get(normalizeLabId(id)) ?? FORGE_LABS[0];
}

/** Get the generation prompt for a lab ID. */
export function getLabGenerationPrompt(id: string | null | undefined): string {
  return getForgeLab(id).generationPrompt;
}

/** Get the display label for a lab ID. */
export function getLabLabel(id: string | null | undefined): string {
  return getForgeLab(id).label;
}

/** Selector option type compatible with the existing ForgeOption shape. */
export type LabOption = {
  id: string;
  label: string;
  detail: string;
  tone: LabTone;
};

/** Lab options formatted for the OptionChip selector. */
export const LAB_OPTIONS: LabOption[] = FORGE_LABS.map((lab) => ({
  id: lab.id,
  label: lab.label,
  detail: lab.detail,
  tone: lab.tone,
}));
