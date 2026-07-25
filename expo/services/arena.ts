/**
 * Arena Mode — shared types and domain-based comparison rules.
 *
 * Single source of truth for Arena configuration. Screens and the worker
 * validation endpoint both reference these types. Domain rules are only
 * defined for EAGOH domains that actually exist in the app
 * (see @/services/domains INTELLIGENCE_DOMAINS).
 *
 * Phase 11A builds the setup UI, eligibility checks, and a secure
 * compatibility-validation endpoint. No AI comparison is generated yet
 * and no Neurons are deducted.
 */

import { INTELLIGENCE_DOMAINS, normalizeDomainId } from "@/services/domains";
import { supabase } from "@/lib/supabase";

// ── Shared types ─────────────────────────────────────────────────────────────

/** A subject entered by the user for Arena comparison. */
export type ArenaSubject = {
  /** Primary name (e.g. "LeBron James", "Dallas Cowboys", "Thriller"). */
  name: string;
  /** Optional organization, league, category, or context. */
  context?: string;
  /** Optional year or season (e.g. "2024", "2022-23"). */
  year?: string;
  /** Optional freeform notes. */
  notes?: string;
};

/** Comparison type id (e.g. "player-vs-player", "team-vs-team"). */
export type ArenaComparisonTypeId = string;

/** A selectable comparison focus option. */
export type ArenaComparisonFocus = {
  id: string;
  label: string;
};

/** A comparison type definition for a domain. */
export type ArenaComparisonType = {
  id: ArenaComparisonTypeId;
  /** Human label (e.g. "Player vs Player"). */
  label: string;
  /** Short description of what this comparison type evaluates. */
  description: string;
};

/** Per-domain Arena rules. */
export type ArenaDomainRule = {
  /** Canonical domain id matching INTELLIGENCE_DOMAINS. */
  domain: string;
  /** Comparison types available for this domain. */
  comparisonTypes: ArenaComparisonType[];
  /** UI labels for subject fields (e.g. "Sport", "Genre"). */
  labels: {
    /** Label for the optional context field. */
    context: string;
    /** Placeholder example for the context field. */
    contextPlaceholder: string;
    /** Label for the optional year/season field. */
    year: string;
  };
  /**
   * Compatibility rule description used for validation explanations and
   * in-app guidance. This is display text, not logic — the worker performs
   * the actual server-side validation.
   */
  compatibilityRules: string[];
  /** Allowed focus options for this domain. */
  focusOptions: ArenaComparisonFocus[];
  /** Example valid matchups for guidance. */
  examples: string[];
};

/** Request body sent to POST /arena/validate. */
export type ArenaValidationRequest = {
  eagohId: string;
  comparisonType: ArenaComparisonTypeId;
  subjectA: ArenaSubject;
  subjectB: ArenaSubject;
};

// ── Phase 11B: Arena analysis types ─────────────────────────────────────────

/** A single category score in an Arena comparison. */
export type ArenaCategoryScore = {
  category: string;
  label: string;
  scoreA: number;
  scoreB: number;
  notes?: string;
};

/** Which subject a source type tended to support. */
export type ArenaSourceLean = "a" | "b" | "neutral";

/** Transparency record for one intelligence source type. */
export type ArenaSourceInfluence = {
  sourceType: "personal" | "faction" | "exchange" | "external_research";
  label: string;
  entryCount: number;
  summary: string;
  lean: ArenaSourceLean;
};

/** A single external citation returned by the Arena analysis. */
export type ArenaCitation = {
  title: string;
  url: string;
  publisher?: string;
};

/** Allowed Arena verdict strings. */
export type ArenaVerdict =
  | "Subject A Advantage"
  | "Subject B Advantage"
  | "Even Match"
  | "Too Close to Call"
  | "Insufficient Evidence";

/** Request body sent to POST /arena/analyze. */
export type ArenaAnalysisRequest = {
  eagohId: string;
  comparisonType: ArenaComparisonTypeId;
  subjectA: ArenaSubject;
  subjectB: ArenaSubject;
  focus?: string;
  customFocus?: string;
  customQuestion?: string;
  requestId: string;
};

/** Structured Arena analysis result returned by the worker. */
export type ArenaAnalysisResult = {
  ok: boolean;
  arenaTitle?: string;
  subjectASummary?: string;
  subjectBSummary?: string;
  normalizedA?: ArenaSubject;
  normalizedB?: ArenaSubject;
  comparisonType?: ArenaComparisonTypeId;
  categoryScores?: ArenaCategoryScore[];
  subjectAAdvantages?: string[];
  subjectBAdvantages?: string[];
  similarities?: string[];
  majorDifferences?: string[];
  oiInfluence?: ArenaSourceInfluence[];
  evidenceLimitations?: string;
  confidence?: number;
  verdict?: ArenaVerdict;
  responseSummary?: string;
  sourceCitations?: ArenaCitation[];
  sourceCounts?: {
    personal?: number;
    faction?: number;
    exchange?: number;
    external?: number;
  };
  neuronCost?: number;
  historyId?: string;
  error?: string;
};

/** A row in the user's Arena history (from GET /arena/history). */
export type ArenaHistoryEntry = {
  id: string;
  eagoh_id: string;
  domain: string;
  comparison_type: string;
  subject_a_name: string;
  subject_a_context?: string | null;
  subject_a_year?: string | null;
  subject_b_name: string;
  subject_b_context?: string | null;
  subject_b_year?: string | null;
  focus?: string | null;
  custom_focus?: string | null;
  custom_question?: string | null;
  verdict: string;
  confidence: number;
  category_scores: ArenaCategoryScore[];
  subject_a_advantages: string[];
  subject_b_advantages: string[];
  similarities: string[];
  major_differences: string[];
  oi_influence: ArenaSourceInfluence[];
  response_summary: string;
  source_citations: ArenaCitation[];
  evidence_limitations?: string | null;
  source_counts: {
    personal?: number;
    faction?: number;
    exchange?: number;
    external?: number;
  };
  neuron_cost: number;
  created_at: string;
};

/** Result returned by local validation or the secure validation endpoint. */
export type ArenaValidationResult = {
  ok: boolean;
  valid: boolean;
  /** Normalized subject A (trimmed, collapsed whitespace). */
  normalizedA?: ArenaSubject;
  /** Normalized subject B (trimmed, collapsed whitespace). */
  normalizedB?: ArenaSubject;
  /** Detected category/sport/context when inferable. */
  detectedCategory?: string;
  /** Safe, user-facing explanation (valid or invalid). */
  explanation: string;
  error?: string;
};

// ── Local validation helpers ────────────────────────────────────────────────

/** Known sports used by the local sport-detection heuristic. Mirrors the worker. */
const ARENA_KNOWN_SPORTS: string[] = [
  "basketball", "football", "baseball", "soccer", "hockey", "tennis",
  "golf", "boxing", "mma", "ufc", "cricket", "rugby", "volleyball",
  "track", "swimming", "gymnastics", "f1", "racing", "nascar",
];

/**
 * Detect a sport from a subject's context or name using the known-sports bank.
 * Returns the lowercased sport name, or null when none is detected.
 * Mirrors the worker-side arenaDetectSport so local validation matches server-side.
 */
function arenaDetectSportLocal(context: string, name: string): string | null {
  const hay = `${context} ${name}`.toLowerCase();
  for (const sport of ARENA_KNOWN_SPORTS) {
    if (hay.includes(sport)) return sport;
  }
  if (hay.includes("hoops") || hay.includes("nba") || hay.includes("ncaa basketball")) return "basketball";
  if (hay.includes("nfl") || hay.includes("gridiron")) return "football";
  if (hay.includes("mlb")) return "baseball";
  if (hay.includes("soccer") || hay.includes("premier league") || hay.includes("la liga") || hay.includes("bundesliga")) return "soccer";
  if (hay.includes("nhl") || hay.includes("hockey")) return "hockey";
  return null;
}

/** Trim + collapse whitespace (client-side mirror of worker arenaClean). */
function arenaCleanLocal(s: string | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ");
}

/** Normalize domain id — mirrors the worker normalizer for the subset we need. */
function arenaNormalizeDomainIdLocal(raw: string): string {
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

/**
 * Validate an Arena matchup entirely on-device — no network call, no auth.
 *
 * Checks:
 *   - EAGOH exists with a domain
 *   - domain has Arena rules
 *   - comparison type is allowed for the domain
 *   - both subjects have names
 *   - same-name guard (except season-vs-season)
 *   - sports: both subjects share the same sport when detectable
 *   - player-vs-team mismatches are blocked by comparison-type selection
 *
 * The Run Arena worker still re-validates server-side before charging.
 */
export function validateArenaMatchupLocal(
  domainId: string,
  comparisonType: ArenaComparisonTypeId,
  subjectA: ArenaSubject,
  subjectB: ArenaSubject,
): ArenaValidationResult {
  const normalizedDomain = arenaNormalizeDomainIdLocal(domainId);
  const rule = ARENA_DOMAIN_RULES[normalizedDomain] ?? null;
  if (!rule) {
    return {
      ok: true,
      valid: false,
      explanation: "Arena Mode is not available for this EAGOH domain yet.",
    };
  }

  const cmpType = rule.comparisonTypes.find((c) => c.id === comparisonType);
  if (!cmpType) {
    return {
      ok: true,
      valid: false,
      explanation: "This comparison type is not available for the selected EAGOH domain.",
    };
  }

  const normA: ArenaSubject = {
    name: arenaCleanLocal(subjectA.name),
    context: arenaCleanLocal(subjectA.context) || undefined,
    year: arenaCleanLocal(subjectA.year) || undefined,
    notes: arenaCleanLocal(subjectA.notes) || undefined,
  };
  const normB: ArenaSubject = {
    name: arenaCleanLocal(subjectB.name),
    context: arenaCleanLocal(subjectB.context) || undefined,
    year: arenaCleanLocal(subjectB.year) || undefined,
    notes: arenaCleanLocal(subjectB.notes) || undefined,
  };

  if (!normA.name || !normB.name) {
    return {
      ok: true,
      valid: false,
      normalizedA: normA,
      normalizedB: normB,
      explanation: "Both subjects need a primary name.",
    };
  }

  // Same-name guard (except season-vs-season)
  if (
    normA.name.toLowerCase() === normB.name.toLowerCase() &&
    comparisonType !== "season-vs-season"
  ) {
    return {
      ok: true,
      valid: false,
      normalizedA: normA,
      normalizedB: normB,
      explanation:
        "Comparing a subject against itself is not a valid Arena matchup. Enter two different subjects.",
    };
  }

  let detectedCategory: string | undefined;
  let valid = true;
  let explanation = "Matchup confirmed. You can now run Arena.";

  if (normalizedDomain === "sports") {
    const sportA = arenaDetectSportLocal(normA.context ?? "", normA.name);
    const sportB = arenaDetectSportLocal(normB.context ?? "", normB.name);
    detectedCategory = sportA ?? sportB ?? undefined;

    if (
      comparisonType === "player-vs-player" ||
      comparisonType === "team-vs-team" ||
      comparisonType === "coach-vs-coach"
    ) {
      if (sportA && sportB && sportA !== sportB) {
        valid = false;
        explanation =
          "These subjects appear to be from different sports. Both subjects must be from the same sport for this Arena type.";
      } else if (!sportA || !sportB) {
        // Could not confirm — fail open but flag uncertainty.
        explanation =
          "Matchup confirmed. You can now run Arena. (Add the sport in the context field if the matchup is rejected during analysis.)";
      }
    } else if (comparisonType === "season-vs-season") {
      const sameName = normA.name.toLowerCase() === normB.name.toLowerCase();
      const sameContext = sportA && sportB && sportA === sportB;
      if (!sameName && !sameContext) {
        valid = false;
        explanation =
          "Season vs Season comparisons must refer to the same player, team, league, or sport context. Enter the same subject name or matching sport context for both.";
      }
    }
  } else {
    // Non-sports domains: same-type comparison is enforced by the comparisonType
    // selection itself.
    detectedCategory = normA.context ?? undefined;
  }

  return {
    ok: true,
    valid,
    normalizedA: normA,
    normalizedB: normB,
    detectedCategory,
    explanation,
  };
}

// ── Domain rules ─────────────────────────────────────────────────────────────

const GENERIC_FOCUS: ArenaComparisonFocus[] = [
  { id: "overall", label: "Overall" },
  { id: "strengths-weaknesses", label: "Strengths & Weaknesses" },
  { id: "historical-impact", label: "Historical Impact" },
];

export const ARENA_DOMAIN_RULES: Record<string, ArenaDomainRule> = {
  sports: {
    domain: "sports",
    comparisonTypes: [
      { id: "player-vs-player", label: "Player vs Player", description: "Compare two athletes who play the same sport." },
      { id: "team-vs-team", label: "Team vs Team", description: "Compare two teams from the same sport." },
      { id: "coach-vs-coach", label: "Coach vs Coach", description: "Compare two coaches from the same sport." },
      { id: "season-vs-season", label: "Season vs Season", description: "Compare two seasons for the same player, team, league, or sport context." },
    ],
    labels: {
      context: "Sport",
      contextPlaceholder: "e.g. Basketball, Football",
      year: "Season / Year",
    },
    compatibilityRules: [
      "Both subjects must be from the same sport.",
      "Professional players may be compared across different leagues when they play the same sport.",
      "Historical and current players may be compared.",
      "Professional and college teams may be compared within the same sport.",
      "A player cannot be compared with a team.",
      "Coaches must coach or have coached the same sport.",
      "Season comparisons must refer to the same player, team, league, or sport context.",
    ],
    focusOptions: [
      { id: "overall", label: "Overall" },
      { id: "performance", label: "Performance" },
      { id: "statistics", label: "Statistics" },
      { id: "career", label: "Career" },
      { id: "current-form", label: "Current Form" },
      { id: "strengths-weaknesses", label: "Strengths & Weaknesses" },
      { id: "historical-impact", label: "Historical Impact" },
    ],
    examples: [
      "LeBron James vs Michael Jordan (Basketball)",
      "Dallas Cowboys vs Alabama Crimson Tide (Football)",
      "New York Yankees vs Los Angeles Dodgers (Baseball)",
      "Patrick Mahomes 2022 vs Patrick Mahomes 2024 (Football)",
    ],
  },

  music: {
    domain: "music",
    comparisonTypes: [
      { id: "artist-vs-artist", label: "Artist vs Artist", description: "Compare two music artists." },
      { id: "album-vs-album", label: "Album vs Album", description: "Compare two albums." },
      { id: "song-vs-song", label: "Song vs Song", description: "Compare two songs." },
      { id: "producer-vs-producer", label: "Producer vs Producer", description: "Compare two producers." },
    ],
    labels: {
      context: "Genre / Category",
      contextPlaceholder: "e.g. Hip-Hop, Rock, Pop",
      year: "Year",
    },
    compatibilityRules: [
      "Both subjects must belong to the music domain.",
      "Compare like with like (artist vs artist, album vs album).",
    ],
    focusOptions: [
      { id: "overall", label: "Overall" },
      { id: "popularity", label: "Popularity" },
      { id: "technical-ability", label: "Technical Ability" },
      { id: "commercial-performance", label: "Commercial Performance" },
      { id: "cultural-impact", label: "Cultural Impact" },
      { id: "discography", label: "Discography" },
    ],
    examples: [
      "Jay-Z vs Nas (Hip-Hop)",
      "Thriller vs The Dark Side of the Moon (Album)",
      "Bohemian Rhapsody vs Stairway to Heaven (Song)",
    ],
  },

  "film-tv": {
    domain: "film-tv",
    comparisonTypes: [
      { id: "actor-vs-actor", label: "Actor vs Actor", description: "Compare two actors." },
      { id: "film-vs-film", label: "Film vs Film", description: "Compare two films." },
      { id: "series-vs-series", label: "Series vs Series", description: "Compare two TV series." },
      { id: "director-vs-director", label: "Director vs Director", description: "Compare two directors." },
      { id: "character-vs-character", label: "Character vs Character", description: "Compare two characters." },
    ],
    labels: {
      context: "Genre / Category",
      contextPlaceholder: "e.g. Drama, Sci-Fi, Comedy",
      year: "Year",
    },
    compatibilityRules: [
      "Both subjects must belong to the Film & Television domain.",
      "Compare like with like (actor vs actor, film vs film).",
    ],
    focusOptions: [
      { id: "overall", label: "Overall" },
      { id: "performance", label: "Performance" },
      { id: "critical-reception", label: "Critical Reception" },
      { id: "commercial-success", label: "Commercial Success" },
      { id: "cultural-impact", label: "Cultural Impact" },
      { id: "career", label: "Career" },
    ],
    examples: [
      "Daniel Day-Lewis vs Tom Hanks (Actor)",
      "The Godfather vs Pulp Fiction (Film)",
      "Breaking Bad vs The Wire (Series)",
      "Spielberg vs Scorsese (Director)",
    ],
  },

  fashion: {
    domain: "fashion",
    comparisonTypes: [
      { id: "brand-vs-brand", label: "Brand vs Brand", description: "Compare two fashion brands." },
      { id: "designer-vs-designer", label: "Designer vs Designer", description: "Compare two designers." },
      { id: "collection-vs-collection", label: "Collection vs Collection", description: "Compare two collections." },
      { id: "style-vs-style", label: "Style vs Style", description: "Compare two styles or aesthetics." },
    ],
    labels: {
      context: "Category",
      contextPlaceholder: "e.g. Streetwear, Couture, Luxury",
      year: "Year / Season",
    },
    compatibilityRules: [
      "Both subjects must belong to the Fashion domain.",
      "Compare like with like (brand vs brand, designer vs designer).",
    ],
    focusOptions: GENERIC_FOCUS,
    examples: [
      "Supreme vs Off-White (Streetwear)",
      "Virgil Abloh vs Rick Owens (Designer)",
      "Spring/Summer 2024 vs Fall/Winter 2024 (Collection)",
    ],
  },

  education: {
    domain: "education",
    comparisonTypes: [
      { id: "school-vs-school", label: "School vs School", description: "Compare two schools or universities." },
      { id: "program-vs-program", label: "Program vs Program", description: "Compare two academic programs." },
      { id: "course-vs-course", label: "Course vs Course", description: "Compare two courses." },
      { id: "method-vs-method", label: "Teaching Method vs Teaching Method", description: "Compare two teaching methods." },
    ],
    labels: {
      context: "Subject / Field",
      contextPlaceholder: "e.g. Engineering, Business",
      year: "Year",
    },
    compatibilityRules: [
      "Both subjects must belong to the Education domain.",
      "Compare like with like (school vs school, program vs program).",
    ],
    focusOptions: GENERIC_FOCUS,
    examples: [
      "MIT vs Stanford (University)",
      "CS at Berkeley vs CS at Carnegie Mellon (Program)",
      "Montessori vs Reggio Emilia (Teaching Method)",
    ],
  },

  gaming: {
    domain: "gaming",
    comparisonTypes: [
      { id: "game-vs-game", label: "Game vs Game", description: "Compare two games." },
      { id: "character-vs-character", label: "Character vs Character", description: "Compare two game characters." },
      { id: "studio-vs-studio", label: "Studio vs Studio", description: "Compare two game studios." },
      { id: "franchise-vs-franchise", label: "Franchise vs Franchise", description: "Compare two game franchises." },
    ],
    labels: {
      context: "Genre / Platform",
      contextPlaceholder: "e.g. RPG, FPS, PC, Console",
      year: "Year",
    },
    compatibilityRules: [
      "Both subjects must belong to the Gaming domain.",
      "Compare like with like (game vs game, studio vs studio).",
    ],
    focusOptions: GENERIC_FOCUS,
    examples: [
      "Elden Ring vs Breath of the Wild (Game)",
      "Mario vs Master Chief (Character)",
      "Nintendo vs Sony (Studio)",
      "Final Fantasy vs Dragon Quest (Franchise)",
    ],
  },

  business: {
    domain: "business",
    comparisonTypes: [
      { id: "company-vs-company", label: "Company vs Company", description: "Compare two companies." },
      { id: "product-vs-product", label: "Product vs Product", description: "Compare two products." },
      { id: "strategy-vs-strategy", label: "Strategy vs Strategy", description: "Compare two business strategies." },
      { id: "founder-vs-founder", label: "Founder vs Founder", description: "Compare two founders." },
    ],
    labels: {
      context: "Industry",
      contextPlaceholder: "e.g. Tech, Retail, Finance",
      year: "Year",
    },
    compatibilityRules: [
      "Both subjects must belong to the Business domain.",
      "Compare like with like (company vs company, product vs product).",
    ],
    focusOptions: GENERIC_FOCUS,
    examples: [
      "Apple vs Microsoft (Company)",
      "iPhone vs Pixel (Product)",
      "Jeff Bezos vs Elon Musk (Founder)",
    ],
  },

  finance: {
    domain: "finance",
    comparisonTypes: [
      { id: "asset-vs-asset", label: "Asset vs Asset", description: "Compare two financial assets." },
      { id: "strategy-vs-strategy", label: "Strategy vs Strategy", description: "Compare two investment strategies." },
      { id: "portfolio-vs-portfolio", label: "Portfolio vs Portfolio", description: "Compare two portfolio approaches." },
      { id: "institution-vs-institution", label: "Institution vs Institution", description: "Compare two financial institutions." },
    ],
    labels: {
      context: "Asset Class / Market",
      contextPlaceholder: "e.g. Equities, Crypto, Bonds",
      year: "Year",
    },
    compatibilityRules: [
      "Both subjects must belong to the Finance domain.",
      "Compare like with like (asset vs asset, strategy vs strategy).",
    ],
    focusOptions: GENERIC_FOCUS,
    examples: [
      "Apple stock vs Microsoft stock (Equities)",
      "Bitcoin vs Gold (Asset)",
      "Value vs Growth (Strategy)",
    ],
  },

  technology: {
    domain: "technology",
    comparisonTypes: [
      { id: "product-vs-product", label: "Product vs Product", description: "Compare two technology products." },
      { id: "company-vs-company", label: "Company vs Company", description: "Compare two technology companies." },
      { id: "platform-vs-platform", label: "Platform vs Platform", description: "Compare two platforms or ecosystems." },
      { id: "framework-vs-framework", label: "Framework vs Framework", description: "Compare two frameworks or stacks." },
    ],
    labels: {
      context: "Category",
      contextPlaceholder: "e.g. Hardware, Cloud, Mobile",
      year: "Year",
    },
    compatibilityRules: [
      "Both subjects must belong to the Technology domain.",
      "Compare like with like (product vs product, platform vs platform).",
    ],
    focusOptions: GENERIC_FOCUS,
    examples: [
      "AWS vs Azure (Cloud)",
      "iOS vs Android (Platform)",
      "React vs Vue (Framework)",
    ],
  },

  "health-fitness": {
    domain: "health-fitness",
    comparisonTypes: [
      { id: "program-vs-program", label: "Program vs Program", description: "Compare two fitness programs." },
      { id: "method-vs-method", label: "Method vs Method", description: "Compare two training or nutrition methods." },
      { id: "athlete-vs-athlete", label: "Athlete vs Athlete", description: "Compare two fitness athletes." },
      { id: "supplement-vs-supplement", label: "Supplement vs Supplement", description: "Compare two supplements." },
    ],
    labels: {
      context: "Category",
      contextPlaceholder: "e.g. Strength, Cardio, Nutrition",
      year: "Year",
    },
    compatibilityRules: [
      "Both subjects must belong to the Health & Fitness domain.",
      "Compare like with like (program vs program, method vs method).",
    ],
    focusOptions: GENERIC_FOCUS,
    examples: [
      "CrossFit vs Powerlifting (Program)",
      "Keto vs Paleo (Nutrition Method)",
      "Creatine vs Whey Protein (Supplement)",
    ],
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return the Arena domain rule for a domain id, or null when the domain
 * has no Arena configuration (e.g. an unknown domain).
 */
export function getArenaDomainRule(domainId: string): ArenaDomainRule | null {
  const normalized = normalizeDomainId(domainId);
  return ARENA_DOMAIN_RULES[normalized] ?? null;
}

/** True when the domain has Arena support (i.e. exists in INTELLIGENCE_DOMAINS and has rules). */
export function domainSupportsArena(domainId: string): boolean {
  const normalized = normalizeDomainId(domainId);
  if (!INTELLIGENCE_DOMAINS.some((d) => d.id === normalized)) return false;
  return ARENA_DOMAIN_RULES[normalized] !== undefined;
}

/** Find a comparison type within a domain rule. */
export function getComparisonType(
  domainId: string,
  comparisonTypeId: ArenaComparisonTypeId,
): ArenaComparisonType | null {
  const rule = getArenaDomainRule(domainId);
  if (!rule) return null;
  return rule.comparisonTypes.find((c) => c.id === comparisonTypeId) ?? null;
}

/** Normalize a subject: trim strings, collapse internal whitespace, drop empty optionals. */
export function normalizeSubject(subject: ArenaSubject): ArenaSubject {
  const clean = (s: string): string => s.trim().replace(/\s+/g, " ");
  const name = clean(subject.name);
  const context = subject.context ? clean(subject.context) : "";
  const year = subject.year ? clean(subject.year) : "";
  const notes = subject.notes ? clean(subject.notes) : "";
  return {
    name,
    context: context || undefined,
    year: year || undefined,
    notes: notes || undefined,
  };
}

/** Empty-state message shown when no analytics/contribution data exists. */
export const ARENA_EMPTY_NO_EAGOH = "Create an EAGOH in the Forge before entering Arena Mode.";

// ── Phase 11B: Arena Neuron cost ─────────────────────────────────────────────

/** Flat Arena analysis cost in Neurons. */
export const ARENA_NEURON_COST = 50;

// ── Worker base URL + auth ─────────────────────────────────────────────────

const ARENA_FUNCTIONS_BASE_URL =
  process.env.EXPO_PUBLIC_RORK_FUNCTIONS_URL ||
  "https://eagoh-mobile-app-backend.rork.app";

/** User-facing auth error when the session is invalid or expired. */
export const ARENA_AUTH_EXPIRED_MESSAGE = "Please sign out and sign back in.";

/** User-facing auth error when no session exists at all. */
export const ARENA_AUTH_REQUIRED_MESSAGE = "Please sign out and sign back in.";

/** True when a worker response indicates an auth failure (401 or invalid auth). */
export function isArenaAuthError(status: number, error?: string): boolean {
  if (status === 401) return true;
  if (error && /invalid auth|authentication required|unauthorized/i.test(error)) return true;
  return false;
}

/**
 * Development-only Arena auth diagnostic log. Never logs the token itself.
 */
function arenaAuthLog(event: string, details: Record<string, unknown>): void {
  if (process.env.NODE_ENV === "production") return;
  // eslint-disable-next-line no-console
  console.log(`[arena:auth] ${event}`, JSON.stringify(details));
}

/**
 * Get the current Supabase access token for worker auth.
 *
 * Identical to the working analyst service's getAccessToken(): reads the
 * session from the shared Supabase client (which has autoRefreshToken
 * enabled) and returns the access_token. No manual refreshSession() call —
 * the SDK handles token refresh automatically.
 *
 * Returns null only when there is genuinely no signed-in session.
 */
async function getArenaWorkerAuth(endpoint: string): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const session = data?.session;
    const token = session?.access_token ?? null;

    arenaAuthLog("getSession", {
      endpoint,
      hasSession: !!session,
      hasToken: !!token,
      expiresAt: session?.expires_at
        ? new Date(session.expires_at * 1000).toISOString()
        : "unknown",
    });

    return token;
  } catch (err) {
    arenaAuthLog("exception", {
      endpoint,
      error: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
}

/**
 * Safely parse a JSON response from the Arena worker. Returns null when the
 * response is not valid JSON (e.g. Cloudflare 503 text/plain "route unavailable"),
 * so callers can show a clean user message instead of crashing.
 */
async function safeArenaJson<T>(
  res: Response,
  fallbackError: string,
): Promise<T | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch (err) {
    console.warn(
      "[arena] non-JSON worker response",
      res.status,
      err instanceof Error ? err.message : "parse failed",
    );
    return null;
  }
}

// ── Worker analysis + history calls ─────────────────────────────────────────

/**
 * Run an Arena analysis through the secure worker endpoint POST /arena/analyze.
 * Deducts Neurons exactly once (idempotent via requestId). Returns a
 * structured Arena result. Never exposes Open Intelligence content beyond
 * what the authenticated user is authorized to access.
 */
export async function runArenaAnalysis(
  request: ArenaAnalysisRequest,
): Promise<ArenaAnalysisResult> {
  if (!ARENA_FUNCTIONS_BASE_URL) {
    return { ok: false, error: "Backend not configured." };
  }
  const token = await getArenaWorkerAuth("/arena/analyze");
  if (!token) {
    return { ok: false, error: ARENA_AUTH_REQUIRED_MESSAGE };
  }
  const analyzeUrl = `${ARENA_FUNCTIONS_BASE_URL}/arena/analyze`;
  arenaAuthLog("fetch-start", { endpoint: "/arena/analyze", url: analyzeUrl });
  try {
    const res = await fetch(analyzeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(request),
    });
    arenaAuthLog("fetch-response", {
      endpoint: "/arena/analyze",
      status: res.status,
      ok: res.ok,
    });
    const data = await safeArenaJson<ArenaAnalysisResult & { ok?: boolean }>(
      res,
      "Arena analysis failed.",
    );
    if (data === null) {
      return {
        ok: false,
        error: "Could not connect to Arena service. Please try again.",
      };
    }
    if (isArenaAuthError(res.status, data.error)) {
      arenaAuthLog("auth-rejected", {
        endpoint: "/arena/analyze",
        status: res.status,
        workerError: data.error ?? "none",
      });
      return { ok: false, error: ARENA_AUTH_EXPIRED_MESSAGE };
    }
    if (data.ok === false || res.status >= 400) {
      return {
        ok: false,
        error: data.error ?? "Arena analysis failed. Please try again.",
      };
    }
    return data;
  } catch (err) {
    console.warn("[arena] analyze fetch failed", err instanceof Error ? err.message : "unknown");
    return {
      ok: false,
      error: "Could not connect to Arena service. Please try again.",
    };
  }
}

/**
 * Fetch the authenticated user's Arena history (paginated) through the secure
 * worker endpoint GET /arena/history. Opening history never charges.
 */
export async function listArenaHistory(
  page: number = 0,
  pageSize: number = 20,
): Promise<{ ok: boolean; entries?: ArenaHistoryEntry[]; error?: string }> {
  if (!ARENA_FUNCTIONS_BASE_URL) {
    return { ok: false, error: "Backend not configured." };
  }
  const token = await getArenaWorkerAuth("/arena/history");
  if (!token) {
    return { ok: false, error: ARENA_AUTH_REQUIRED_MESSAGE };
  }
  try {
    const url = `${ARENA_FUNCTIONS_BASE_URL}/arena/history?page=${page}&pageSize=${pageSize}`;
    arenaAuthLog("fetch-start", { endpoint: "/arena/history", url });
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    arenaAuthLog("fetch-response", {
      endpoint: "/arena/history",
      status: res.status,
      ok: res.ok,
    });
    const data = await safeArenaJson<{ ok: boolean; entries?: ArenaHistoryEntry[]; error?: string }>(
      res,
      "Could not load Arena history.",
    );
    if (data === null) {
      return { ok: false, error: "Could not load Arena history. Please try again." };
    }
    if (isArenaAuthError(res.status, data.error)) {
      return { ok: false, error: ARENA_AUTH_EXPIRED_MESSAGE };
    }
    if (data.ok === false || res.status >= 400) {
      return { ok: false, error: data.error ?? "Could not load Arena history." };
    }
    return { ok: true, entries: data.entries ?? [] };
  } catch (err) {
    console.warn("[arena] history fetch failed", err instanceof Error ? err.message : "unknown");
    return { ok: false, error: "Could not load Arena history. Please try again." };
  }
}

// ── Worker validation call ─────────────────────────────────────────────────

/**
 * Validate an Arena matchup through the secure worker endpoint
 * POST /arena/validate. Never deducts Neurons and never exposes Open
 * Intelligence content. Returns a safe, user-facing explanation.
 */
export async function validateArenaMatchup(
  request: ArenaValidationRequest,
): Promise<ArenaValidationResult> {
  if (!ARENA_FUNCTIONS_BASE_URL) {
    return { ok: false, valid: false, explanation: "Backend not configured." };
  }
  const token = await getArenaWorkerAuth("/arena/validate");
  if (!token) {
    return { ok: false, valid: false, explanation: ARENA_AUTH_REQUIRED_MESSAGE };
  }
  try {
    const res = await fetch(`${ARENA_FUNCTIONS_BASE_URL}/arena/validate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(request),
    });
    const data = await safeArenaJson<ArenaValidationResult & { ok?: boolean }>(
      res,
      "Arena validation failed.",
    );
    if (data === null) {
      return {
        ok: false,
        valid: false,
        explanation: "Could not connect to Arena validation. Please try again.",
      };
    }
    if (isArenaAuthError(res.status, data.error)) {
      return {
        ok: false,
        valid: false,
        explanation: ARENA_AUTH_EXPIRED_MESSAGE,
      };
    }
    if (data.ok === false || res.status >= 400) {
      return {
        ok: false,
        valid: false,
        explanation: data.error ?? "Validation failed.",
      };
    }
    return {
      ok: true,
      valid: data.valid,
      normalizedA: data.normalizedA,
      normalizedB: data.normalizedB,
      detectedCategory: data.detectedCategory,
      explanation: data.explanation,
    };
  } catch (err) {
    console.warn("[arena] validate fetch failed", err instanceof Error ? err.message : "unknown");
    return {
      ok: false,
      valid: false,
      explanation: "Could not connect to Arena validation. Please try again.",
    };
  }
}
