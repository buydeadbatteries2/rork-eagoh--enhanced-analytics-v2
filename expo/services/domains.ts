/**
 * EAGOH Intelligence Domains service.
 *
 * Each EAGOH is forged with exactly ONE intelligence domain. The EAGOH can
 * only answer questions within that domain — out-of-domain requests are
 * politely rejected with a suggestion to create or select a domain-matching
 * EAGOH.
 *
 * Domain guard rules:
 *   - Normalise domain IDs before every comparison (case, aliases, separators).
 *   - Score ALL domains against the prompt; only reject when a DIFFERENT domain
 *     has stronger keyword matches than the EAGOH's own domain.
 *   - Fail OPEN when no domain keywords are detected (uncertain classification).
 *   - Do not require keyword matches for valid sessions — a Sports EAGOH should
 *     accept "Who has the edge?" even without obvious sports keywords.
 */

export type IntelligenceDomain = {
  id: string;
  label: string;
  description: string;
  icon: string; // lucide icon name for UI rendering
  tone: "cyan" | "gold" | "violet" | "ember" | "success";
  color: string; // brand-accent hex for domain badges / accents
};

export const INTELLIGENCE_DOMAINS: IntelligenceDomain[] = [
  { id: "sports", label: "Sports", description: "Game analysis, player performance, tactical breakdowns, and athletic intelligence.", icon: "Trophy", tone: "gold", color: "#3B82F6" },
  { id: "music", label: "Music", description: "Genre analysis, artist insights, production techniques, and sound culture.", icon: "Music", tone: "violet", color: "#A855F7" },
  { id: "film-tv", label: "Film & Television", description: "Screen analysis, narrative structure, character study, and visual storytelling.", icon: "Film", tone: "ember", color: "#EF4444" },
  { id: "fashion", label: "Fashion", description: "Style analysis, trend forecasting, design language, and aesthetic intelligence.", icon: "Shirt", tone: "cyan", color: "#F59E0B" },
  { id: "education", label: "Education", description: "Learning systems, curriculum design, knowledge transfer, and academic strategy.", icon: "GraduationCap", tone: "success", color: "#22C55E" },
  { id: "gaming", label: "Gaming", description: "Game mechanics, meta analysis, esports strategy, and interactive design.", icon: "Gamepad2", tone: "violet", color: "#06B6D4" },
  { id: "business", label: "Business", description: "Market strategy, operations, entrepreneurship, and commercial intelligence.", icon: "Briefcase", tone: "gold", color: "#94A3B8" },
  { id: "finance", label: "Finance", description: "Market analysis, investment strategy, risk assessment, and economic insight.", icon: "LineChart", tone: "success", color: "#10B981" },
  { id: "technology", label: "Technology", description: "Software architecture, hardware analysis, emerging tech, and digital strategy.", icon: "Cpu", tone: "cyan", color: "#0EA5E9" },
  { id: "health-fitness", label: "Health & Fitness", description: "Training science, nutrition strategy, biometric analysis, and wellness intelligence.", icon: "Heart", tone: "ember", color: "#F97316" },
];

// ── Domain ID normalization ──────────────────────────────────────────

/** Canonical domain IDs (derived from INTELLIGENCE_DOMAINS at load time). */
const CANONICAL_IDS = new Set(INTELLIGENCE_DOMAINS.map((d) => d.id));

/**
 * Map non‑canonical domain-id strings to their canonical form.
 * Handles case, separators, singular/plural, label‑style names, and snake_case.
 */
const NORMALIZE_MAP: Record<string, string> = {
  // Singular → plural
  "sport": "sports",
  // Separator variations → canonical hyphen form
  "film_tv": "film-tv",
  "film & television": "film-tv",
  "film and television": "film-tv",
  "film-television": "film-tv",
  "filmtv": "film-tv",
  "filmtelevision": "film-tv",
  "film_television": "film-tv",
  "health_fitness": "health-fitness",
  "health & fitness": "health-fitness",
  "health and fitness": "health-fitness",
  "healthfitness": "health-fitness",
  "health-fit": "health-fitness",
  "health_fit": "health-fitness",
};

/**
 * Normalise a domain ID string to its canonical form.
 *
 * Examples (all → "sports"):
 *   "Sports", "sports", "SPORTS", "sport"
 *
 * Examples (all → "film-tv"):
 *   "Film & Television", "film_tv", "film-and-television", "Film & TV"
 */
export function normalizeDomainId(raw: string): string {
  const trimmed = raw.trim();
  // Fast path: already canonical
  if (CANONICAL_IDS.has(trimmed)) return trimmed;

  // Try the explicit map first
  const lower = trimmed.toLowerCase();
  if (NORMALIZE_MAP[lower] !== undefined) return NORMALIZE_MAP[lower];

  // Try stripping separators and re‑matching
  const collapsed = lower.replace(/[^a-z0-9]/g, "");
  if (NORMALIZE_MAP[collapsed] !== undefined) return NORMALIZE_MAP[collapsed];

  // Try matching against canonical ids by collapsed form
  for (const canonical of CANONICAL_IDS) {
    if (canonical.replace(/[^a-z0-9]/g, "") === collapsed) return canonical;
  }

  // Try matching against domain labels (e.g. "Film & Television" → "film-tv")
  const domainByLabel = INTELLIGENCE_DOMAINS.find(
    (d) => d.label.toLowerCase().replace(/[^a-z0-9]/g, "") === collapsed,
  );
  if (domainByLabel) return domainByLabel.id;

  // Fallback: return the lowercased trimmed input as-is
  return lower;
}

// ── Domain lookup ────────────────────────────────────────────────────

/** Look up a domain by id (with normalisation). Returns undefined for unknown ids. */
export function getDomain(domainId: string): IntelligenceDomain | undefined {
  const normalized = normalizeDomainId(domainId);
  return INTELLIGENCE_DOMAINS.find((d) => d.id === normalized);
}

// ── Keyword‑based domain detection ───────────────────────────────────

/**
 * Keyword bank for every intelligence domain.
 * These are lightweight signal words — not exhaustive, but tuned to catch
 * clearly out‑of‑domain prompts while failing open on ambiguous input.
 */
const DOMAIN_KEYWORDS: Record<string, string[]> = {
  sports: ["game", "match", "player", "team", "score", "win", "loss", "championship", "league", "tournament", "coach", "tactic", "play", "athlete", "stadium", "season", "quarter", "half", "goal", "touchdown", "basket", "defense", "offense", "training", "draft", "trade", "rivalry", "playoff", "final", "sport", "lakers", "cowboys", "yankees", "nuggets", "bullpen", "recruiting", "lineup", "roster", "qb", "pitcher", "nba", "nfl", "mlb", "nhl", "ufc", "boxing"],
  music: ["song", "album", "artist", "band", "beat", "rhythm", "melody", "genre", "concert", "tour", "lyric", "verse", "chorus", "producer", "instrument", "vocal", "track", "release", "stream", "playlist", "radio", "label", "studio", "recording", "mix", "sound", "bass", "drum", "guitar", "piano", "hook", "rollout"],
  "film-tv": ["movie", "film", "show", "episode", "actor", "director", "scene", "script", "plot", "character", "cinema", "tv", "series", "season", "premiere", "screen", "camera", "trailer", "cast", "role", "drama", "comedy", "thriller", "documentary", "animation", "netflix", "hbo", "streaming", "oscar", "award", "box office"],
  fashion: ["style", "fashion", "wear", "outfit", "designer", "brand", "collection", "runway", "trend", "fabric", "textile", "shoe", "dress", "suit", "jacket", "accessory", "luxury", "streetwear", "couture", "vogue", "seasonal", "aesthetic", "look", "model", "fit", "tailor", "garment", "label"],
  education: ["learn", "teach", "student", "school", "university", "college", "course", "class", "lesson", "curriculum", "degree", "professor", "academic", "study", "exam", "test", "grade", "education", "training", "lecture", "textbook", "research", "knowledge", "skill", "certificate", "diploma", "homework", "tutor", "online course"],
  gaming: ["game", "gaming", "esports", "player", "level", "boss", "quest", "rpg", "fps", "mmo", "console", "pc", "steam", "xbox", "playstation", "nintendo", "twitch", "stream", "speedrun", "meta", "patch", "update", "dlc", "character", "class", "build", "loot", "raid", "rank", "competitive"],
  business: ["business", "company", "startup", "revenue", "profit", "market", "strategy", "ceo", "founder", "entrepreneur", "sales", "marketing", "growth", "funding", "investor", "venture", "ipo", "acquisition", "merger", "brand", "product", "customer", "pipeline", "roi", "kpi", "stakeholder", "board", "operational", "scale"],
  finance: ["stock", "market", "invest", "trade", "crypto", "bitcoin", "portfolio", "dividend", "bond", "fund", "etf", "index", "nasdaq", "sp500", "forex", "option", "futures", "hedge", "risk", "capital", "asset", "liability", "equity", "debt", "interest rate", "inflation", "recession", "bull", "bear", "wallet", "apple stock"],
  technology: ["code", "software", "hardware", "app", "api", "cloud", "server", "database", "algorithm", "ai", "machine learning", "blockchain", "web", "mobile", "frontend", "backend", "devops", "cybersecurity", "iot", "data", "network", "protocol", "framework", "library", "sdk", "compiler", "debug", "deploy", "scale"],
  "health-fitness": ["workout", "exercise", "diet", "nutrition", "calorie", "protein", "muscle", "cardio", "yoga", "run", "gym", "fitness", "health", "wellness", "sleep", "recovery", "injury", "weight", "body", "heart rate", "step", "hydration", "supplement", "vitamin", "meditation", "stress", "flexibility", "strength", "endurance"],
};

/**
 * Score EVERY domain against a prompt and return the domain ID with the
 * highest keyword‑match count. Returns null when zero keywords match
 * across all domains (uncertain → fail open).
 */
export function detectPromptDomain(prompt: string): string | null {
  const lower = prompt.toLowerCase();
  let bestDomain: string | null = null;
  let bestScore = 0;

  for (const [domainId, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestDomain = domainId;
    }
  }

  return bestScore > 0 ? bestDomain : null;
}

/**
 * Check whether a user prompt falls within the given EAGOH domain.
 *
 * Algorithm:
 *   1. Normalise the EAGOH domain ID.
 *   2. Score ALL domains against the prompt.
 *   3. If NO domain keywords matched → fail OPEN (allow).
 *   4. If the EAGOH's own domain scored ANY matches → allow.
 *   5. If a DIFFERENT domain scored stronger → reject.
 */
export function isPromptInDomain(prompt: string, domainId: string): boolean {
  const normalizedId = normalizeDomainId(domainId);
  const domain = getDomain(normalizedId);
  if (!domain) return true;

  const lower = prompt.toLowerCase();
  const ownKeywords = DOMAIN_KEYWORDS[normalizedId] ?? [];

  // Direct match against own domain keywords → allow immediately
  const ownScore = ownKeywords.filter((kw) => lower.includes(kw)).length;
  if (ownScore > 0) return true;

  // Score ALL other domains — find the strongest competitor
  let bestOtherScore = 0;
  for (const otherId of Object.keys(DOMAIN_KEYWORDS)) {
    if (otherId === normalizedId) continue;
    const otherKeywords = DOMAIN_KEYWORDS[otherId] ?? [];
    const otherScore = otherKeywords.filter((kw) => lower.includes(kw)).length;
    if (otherScore > bestOtherScore) bestOtherScore = otherScore;
  }

  // No keywords matched anywhere → fail OPEN
  if (bestOtherScore === 0) return true;

  // Only reject when another domain CLEARLY scores higher (>= 2 matches while own has 0).
  // Single-keyword matches are too noisy — they cause false rejections on short prompts.
  if (bestOtherScore >= 2 && ownScore < 2) return false;

  // Uncertain → fail open
  return true;
}

/**
 * Return the domain ID that the prompt most strongly matches
 * (for use in rejection messages). Null when uncertain.
 */
export function getDetectedDomainForPrompt(prompt: string): string | null {
  return detectPromptDomain(prompt);
}

/** Get the brand-accent hex color for a domain. */
export function getDomainColor(domainId: string): string {
  const domain = getDomain(domainId);
  return domain?.color ?? "#6B7280";
}

/**
 * Generate a polite out-of-domain rejection message.
 * Format: "This EAGOH is specialized in [Domain]. Please select or forge
 * an EAGOH for [Detected Domain] to analyze this topic."
 */
export function getDomainRejection(domainId: string, detectedDomainId?: string | null): string {
  const domain = getDomain(domainId);
  const domainLabel = domain?.label ?? domainId;

  if (detectedDomainId) {
    const detectedDomain = getDomain(detectedDomainId);
    const detectedLabel = detectedDomain?.label ?? detectedDomainId;
    return `This EAGOH is specialized in ${domainLabel}. Please select or forge an EAGOH for ${detectedLabel} to analyze this topic.`;
  }

  // Fallback when no domain was confidently detected
  const suggestions = INTELLIGENCE_DOMAINS.filter((d) => d.id !== normalizeDomainId(domainId))
    .slice(0, 3)
    .map((d) => d.label)
    .join(", ");

  return `This EAGOH is specialized in ${domainLabel}. This question may fall outside its domain. Try creating or selecting an EAGOH tuned for one of these domains: ${suggestions}.`;
}
