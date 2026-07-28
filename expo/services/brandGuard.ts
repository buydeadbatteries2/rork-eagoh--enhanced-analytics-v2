/**
 * EAGOH Brand & Logo Guard — centralized prohibited-mark validator.
 *
 * Inspects user-entered Forge customization fields for explicit requests to
 * reproduce real company logos, brand marks, sports-team logos, league logos,
 * school logos, designer monograms, and trademarked emblems.
 *
 * Design principles:
 *  - Block ONLY explicit requests to reproduce a recognizable real mark.
 *  - Allow negative statements ("no brands", "no logos", "unbranded").
 *  - Allow generic words ("brand", "company", "business", "logo") by themselves.
 *  - Require context terms (logo, emblem, mark, symbol, monogram, etc.) for
 *    ambiguous brand names that are also common words (apple, heat, bulls, etc.).
 *  - Use word boundaries for all brand-name matching — never substring match.
 *  - When confidence is low, allow the request and rely on the server-side
 *    prompt hardening + post-generation vision review.
 *
 * The server-side copy is the authoritative source of truth — a modified
 * client cannot bypass it.
 */

// ─── Types ────────────────────────────────────────────────────────────────

export type BrandGuardField = {
  /** Field label shown to the user (e.g. "Headwear"). */
  label: string;
  /** Raw user-entered text for this field. */
  value: string;
};

export type BrandGuardResult = {
  /** true if a prohibited brand/logo reference was detected. */
  blocked: boolean;
  /** Human-readable field label where the violation was found. */
  fieldLabel: string | null;
  /** Machine-readable field key for logging (not the raw user text). */
  fieldKey: string | null;
  /** Category of the detected prohibited content. */
  category: string | null;
  /** Safe user-facing error message (no legal threats). */
  message: string;
  /** Secondary suggestion for the user. */
  suggestion: string;
};

const ALLOWED_RESULT: BrandGuardResult = {
  blocked: false,
  fieldLabel: null,
  fieldKey: null,
  category: null,
  message: "",
  suggestion: "",
};

// ─── Context terms ─────────────────────────────────────────────────────────
//
// These are words that, when paired with a brand name, indicate the user is
// requesting reproduction of a recognizable mark. Without one of these (or a
// clear branded context), ambiguous names like "apple" or "heat" are allowed.

const CONTEXT_TERMS = [
  "logo",
  "emblem",
  "mark",
  "symbol",
  "monogram",
  "monogrammed",
  "branded",
  "brand",
  "trademark",
  "trademarked",
  "jersey",
  "hat",
  "cap",
  "shoe",
  "shoes",
  "sneaker",
  "sneakers",
  "uniform",
  "patch",
  "badge",
  "insignia",
  "crest",
  "seal",
  "wordmark",
  "jumpman",
  "swoosh",
  "trefoil",
  "pattern",
  "print",
  "design",
  "icon",
  "sign",
  "crest",
];

// ─── Brands that are also common English words ─────────────────────────────
//
// These brand names require a context term (logo, emblem, mark, etc.) before
// blocking. Without context, they are ordinary words and should be allowed.
// Example: "apple" alone → allowed; "apple logo" → blocked.

const AMBIGUOUS_BRANDS = new Set([
  "apple",
  "heat",
  "bulls",
  "warriors",
  "packers",
  "patriots",
  "barcelona",
  "threads",
  "xbox",
  "hbo",
  "dc",
  "lv",
  "ua",
  "nb",
  "mc",
  "playstation",
  "champion",
  "supreme",
  "tesla",
  "fifa",
  "uefa",
  "ncaa",
  "mls",
]);

// ─── Prohibited brand database ─────────────────────────────────────────────

type BrandEntry = {
  canonical: string;
  aliases: string[];
  /** Descriptive phrases that explicitly request reproduction of the mark. */
  descriptors: string[];
};

const PROHIBITED_BRANDS: BrandEntry[] = [
  // ── Athletic / Sportswear ──
  {
    canonical: "nike",
    aliases: ["nike", "nke", "nikey", "nyke", "nikee"],
    descriptors: ["nike swoosh", "swoosh logo", "the swoosh", "nike logo", "nike check logo"],
  },
  {
    canonical: "adidas",
    aliases: ["adidas", "adiddas", "ad1das", "adiads", "addidas"],
    descriptors: ["adidas three stripes", "three stripes logo", "adidas trefoil", "adidas stripes logo", "three-stripe adidas logo"],
  },
  {
    canonical: "jordan",
    aliases: ["jumpman", "jordan brand", "air jordan"],
    descriptors: ["jumpman logo", "jumpman silhouette", "jumpman symbol", "jordan logo", "flying basketball player logo"],
  },
  {
    canonical: "under armour",
    aliases: ["underarmour", "under armour", "under armor", "underarmor"],
    descriptors: ["under armour logo", "interlocking ua logo"],
  },
  {
    canonical: "puma",
    aliases: ["puma", "pumaa", "pumma"],
    descriptors: ["puma logo", "puma leaping cat", "puma cat logo", "leaping cat logo"],
  },
  {
    canonical: "reebok",
    aliases: ["reebok", "reebokk", "reebook"],
    descriptors: ["reebok logo", "reebok vector logo"],
  },
  {
    canonical: "new balance",
    aliases: ["new balance", "newbalance"],
    descriptors: ["new balance logo", "nb stacked logo"],
  },
  {
    canonical: "champion",
    aliases: ["champion"],
    descriptors: ["champion logo", "champion c logo"],
  },

  // ── Luxury / Fashion ──
  {
    canonical: "gucci",
    aliases: ["gucci", "gucc1", "guccci", "guccy"],
    descriptors: ["gucci logo", "gucci monogram", "gg monogram", "interlocking g logo", "gucci pattern"],
  },
  {
    canonical: "louis vuitton",
    aliases: ["louis vuitton", "louisvuitton", "louie vuitton", "louis vutton", "luis vuitton"],
    descriptors: ["louis vuitton logo", "louis vuitton monogram", "lv monogram", "lv logo", "louis vuitton pattern"],
  },
  {
    canonical: "prada",
    aliases: ["prada", "prad4", "pradaa"],
    descriptors: ["prada logo", "prada triangle logo"],
  },
  {
    canonical: "hermes",
    aliases: ["hermes", "hermès"],
    descriptors: ["hermes logo", "hermes horse carriage"],
  },
  {
    canonical: "burberry",
    aliases: ["burberry", "burbery"],
    descriptors: ["burberry logo", "burberry check", "burberry plaid", "burberry pattern", "nova check"],
  },
  {
    canonical: "versace",
    aliases: ["versace", "versache"],
    descriptors: ["versace logo", "versace medusa", "medusa head versace"],
  },
  {
    canonical: "balenciaga",
    aliases: ["balenciaga"],
    descriptors: ["balenciaga logo"],
  },
  {
    canonical: "dior",
    aliases: ["dior", "d1or", "diorr"],
    descriptors: ["dior logo", "cd logo dior", "dior oblique pattern"],
  },
  {
    canonical: "fendi",
    aliases: ["fendi", "f3ndi", "fendii"],
    descriptors: ["fendi logo", "ff logo fendi", "fendi zucca pattern"],
  },
  {
    canonical: "supreme",
    aliases: ["supreme", "supremee", "supream"],
    descriptors: ["supreme logo", "supreme box logo", "red box logo supreme"],
  },

  // ── Tech ──
  {
    canonical: "apple",
    aliases: ["apple"],
    descriptors: ["apple logo", "bitten apple logo", "bitten apple symbol", "apple emblem", "apple icon"],
  },
  {
    canonical: "microsoft",
    aliases: ["microsoft", "msft"],
    descriptors: ["microsoft logo", "windows logo", "four color squares microsoft", "windows flag logo"],
  },
  {
    canonical: "google",
    aliases: ["google", "g00gle", "googl"],
    descriptors: ["google logo", "google g logo"],
  },
  {
    canonical: "samsung",
    aliases: ["samsung", "samsng"],
    descriptors: ["samsung logo", "samsung wordmark"],
  },
  {
    canonical: "playstation",
    aliases: ["playstation", "play station"],
    descriptors: ["playstation logo", "ps logo", "playstation symbols logo"],
  },
  {
    canonical: "xbox",
    aliases: ["xbox", "x-box"],
    descriptors: ["xbox logo", "xbox green sphere", "xbox sphere logo"],
  },
  {
    canonical: "nintendo",
    aliases: ["nintendo", "n1ntendo", "nintend0"],
    descriptors: ["nintendo logo", "nintendo switch logo"],
  },

  // ── Social Media ──
  {
    canonical: "facebook",
    aliases: ["facebook", "faceb00k"],
    descriptors: ["facebook logo", "f logo facebook"],
  },
  {
    canonical: "twitter",
    aliases: ["twitter", "tw1tter"],
    descriptors: ["twitter logo", "twitter bird logo", "x twitter logo"],
  },
  {
    canonical: "instagram",
    aliases: ["instagram", "insta", "instgram"],
    descriptors: ["instagram logo", "instagram camera icon"],
  },
  {
    canonical: "tiktok",
    aliases: ["tiktok", "tik tok", "tik-tok"],
    descriptors: ["tiktok logo", "tiktok music note logo"],
  },
  {
    canonical: "youtube",
    aliases: ["youtube", "you tube", "youtub"],
    descriptors: ["youtube logo", "youtube play button", "red play button logo"],
  },
  {
    canonical: "snapchat",
    aliases: ["snapchat", "snap chat"],
    descriptors: ["snapchat logo", "snapchat ghost", "ghost logo snapchat"],
  },
  {
    canonical: "linkedin",
    aliases: ["linkedin", "linked in"],
    descriptors: ["linkedin logo", "in logo linkedin"],
  },
  {
    canonical: "threads",
    aliases: ["threads"],
    descriptors: ["threads logo", "threads app logo"],
  },

  // ── Sports Leagues ──
  {
    canonical: "nfl",
    aliases: ["nfl", "n.f.l.", "national football league"],
    descriptors: ["nfl logo", "nfl shield", "nfl shield logo"],
  },
  {
    canonical: "nba",
    aliases: ["nba", "n.b.a.", "national basketball association"],
    descriptors: ["nba logo", "nba emblem"],
  },
  {
    canonical: "mlb",
    aliases: ["mlb", "m.l.b.", "major league baseball"],
    descriptors: ["mlb logo", "mlb emblem"],
  },
  {
    canonical: "nhl",
    aliases: ["nhl", "n.h.l.", "national hockey league"],
    descriptors: ["nhl logo", "nhl shield"],
  },
  {
    canonical: "mls",
    aliases: ["mls", "m.l.s.", "major league soccer"],
    descriptors: ["mls logo", "mls shield"],
  },
  {
    canonical: "fifa",
    aliases: ["fifa", "f1fa"],
    descriptors: ["fifa logo", "fifa emblem"],
  },
  {
    canonical: "uefa",
    aliases: ["uefa", "u.e.f.a."],
    descriptors: ["uefa logo", "uefa emblem"],
  },
  {
    canonical: "ncaa",
    aliases: ["ncaa", "n.c.a.a."],
    descriptors: ["ncaa logo", "college sports logo ncaa"],
  },

  // ── Sports Teams ──
  {
    canonical: "new york yankees",
    aliases: ["yankees", "new york yankees", "yankeees"],
    descriptors: ["yankees logo", "yankees cap logo", "ny interlocking logo", "yankees emblem"],
  },
  {
    canonical: "los angeles lakers",
    aliases: ["lakers", "la lakers", "los angeles lakers"],
    descriptors: ["lakers logo", "lakers emblem", "purple gold lakers logo"],
  },
  {
    canonical: "chicago bulls",
    aliases: ["chicago bulls", "chi bulls"],
    descriptors: ["bulls logo", "chicago bulls emblem", "bull head logo"],
  },
  {
    canonical: "boston celtics",
    aliases: ["celtics", "boston celtics"],
    descriptors: ["celtics logo", "leprechaun logo celtics", "clover logo celtics"],
  },
  {
    canonical: "golden state warriors",
    aliases: ["golden state warriors", "gs warriors"],
    descriptors: ["warriors logo", "golden state warriors emblem", "bay bridge logo warriors"],
  },
  {
    canonical: "dallas cowboys",
    aliases: ["cowboys", "dallas cowboys", "dal cowboys"],
    descriptors: ["cowboys logo", "dallas star logo", "cowboys star"],
  },
  {
    canonical: "new england patriots",
    aliases: ["patriots", "new england patriots", "ne patriots"],
    descriptors: ["patriots logo", "patriot head logo", "minuteman logo"],
  },
  {
    canonical: "green bay packers",
    aliases: ["green bay packers", "gb packers"],
    descriptors: ["packers logo", "green bay g logo"],
  },
  {
    canonical: "miami heat",
    aliases: ["miami heat", "mia heat"],
    descriptors: ["miami heat logo", "heat flame logo"],
  },
  {
    canonical: "real madrid",
    aliases: ["real madrid", "realmadrid"],
    descriptors: ["real madrid logo", "real madrid crest", "real madrid emblem"],
  },
  {
    canonical: "barcelona",
    aliases: ["fc barcelona", "barca", "barcelona fc"],
    descriptors: ["barcelona logo", "barca crest", "fc barcelona emblem"],
  },
  {
    canonical: "manchester united",
    aliases: ["manchester united", "man utd", "manu", "man united", "manchester utd"],
    descriptors: ["manchester united logo", "man utd crest", "red devil logo man united"],
  },
  {
    canonical: "liverpool",
    aliases: ["liverpool", "liverpool fc", "lfc"],
    descriptors: ["liverpool logo", "liverpool crest", "liverpool bird emblem"],
  },

  // ── Entertainment ──
  {
    canonical: "disney",
    aliases: ["disney", "d1sney", "disneey", "walt disney"],
    descriptors: ["disney logo", "disney castle", "disney wordmark"],
  },
  {
    canonical: "marvel",
    aliases: ["marvel", "m4rvel", "marvell", "marvel studios"],
    descriptors: ["marvel logo", "marvel studios logo", "marvel emblem"],
  },
  {
    canonical: "dc comics",
    aliases: ["dc comics"],
    descriptors: ["dc logo", "dc comics logo", "dc emblem"],
  },
  {
    canonical: "warner bros",
    aliases: ["warner bros", "warner brothers"],
    descriptors: ["warner bros logo", "wb shield logo", "warner brothers emblem"],
  },
  {
    canonical: "pixar",
    aliases: ["pixar", "p1xar", "pixarr"],
    descriptors: ["pixar logo", "pixar lamp", "luxo lamp logo"],
  },
  {
    canonical: "netflix",
    aliases: ["netflix", "netfl1x", "netflixx", "nflix"],
    descriptors: ["netflix logo", "netflix n logo", "red n logo netflix"],
  },
  {
    canonical: "hbo",
    aliases: ["hbo", "h.b.o."],
    descriptors: ["hbo logo", "hbo max logo"],
  },
  {
    canonical: "spotify",
    aliases: ["spotify", "spot1fy", "spotifyy"],
    descriptors: ["spotify logo", "spotify green circle logo", "three sound waves logo spotify"],
  },

  // ── Food / Beverage / Retail ──
  {
    canonical: "coca cola",
    aliases: ["coca cola", "cocacola", "coca-cola", "coke"],
    descriptors: ["coca cola logo", "coke logo", "coca cola script logo", "coca cola wordmark"],
  },
  {
    canonical: "pepsi",
    aliases: ["pepsi", "p3psi", "pepsii"],
    descriptors: ["pepsi logo", "pepsi circle logo"],
  },
  {
    canonical: "starbucks",
    aliases: ["starbucks", "star bucks", "starbux"],
    descriptors: ["starbucks logo", "starbucks siren", "green mermaid logo starbucks"],
  },
  {
    canonical: "mcdonalds",
    aliases: ["mcdonalds", "mcdonald's", "mcd", "mc donalds"],
    descriptors: ["mcdonalds logo", "golden arches logo", "m arches logo"],
  },

  // ── Automotive ──
  {
    canonical: "ferrari",
    aliases: ["ferrari", "f3rrari", "ferrarri"],
    descriptors: ["ferrari logo", "ferrari prancing horse", "prancing horse logo"],
  },
  {
    canonical: "lamborghini",
    aliases: ["lamborghini", "lambo"],
    descriptors: ["lamborghini logo", "lamborghini bull", "charging bull logo lamborghini"],
  },
  {
    canonical: "porsche",
    aliases: ["porsche", "porshe"],
    descriptors: ["porsche logo", "porsche crest"],
  },
  {
    canonical: "mercedes benz",
    aliases: ["mercedes", "mercedes benz", "mercedez"],
    descriptors: ["mercedes logo", "three point star logo", "mercedes star", "mercedes emblem"],
  },
  {
    canonical: "bmw",
    aliases: ["bmw", "b.m.w."],
    descriptors: ["bmw logo", "bmw roundel", "blue white circle logo bmw", "bmw emblem"],
  },
  {
    canonical: "tesla",
    aliases: ["tesla", "t3sla", "teslaa"],
    descriptors: ["tesla logo", "tesla t logo", "tesla emblem"],
  },
];

// ─── Negation detection ────────────────────────────────────────────────────
//
// Detects phrases where the user is explicitly requesting that logos/brands
// be EXCLUDED. These must NEVER be blocked.

const NEGATION_PATTERNS = [
  /\bno\s+brands?\b/i,
  /\bno\s+logos?\b/i,
  /\bwithout\s+(?:any\s+)?(?:brands?|logos?|branding)\b/i,
  /\bunbranded\b/i,
  /\bno\s+(?:company|team|brand)\s+(?:symbols?|marks?|logos?|emblems?)\b/i,
  /\bno\s+(?:real\s+)?(?:brand|company|team)\s+(?:names?|logos?)\b/i,
  /\bwithout\s+(?:real\s+)?(?:brand|company|team)\s+(?:logos?|marks?)\b/i,
  /\bavoid\s+(?:all\s+)?(?:brands?|logos?|branding)\b/i,
  /\bno\s+real\s+(?:brands?|logos?|company\s+logos?|team\s+logos?)\b/i,
  /\boriginal\s+(?:emblem|logo|symbol|insignia|design)\b/i,
  /\bfictional\s+(?:emblem|logo|symbol|insignia|design|company)\b/i,
  /\bgeneric\s+(?:emblem|logo|symbol|insignia|design|clothing|shoes?|athletic)\b/i,
  /\bgeneric\s+(?:three|3)\s+line\s+pattern\b/i,
];

/**
 * Returns true if the text contains a negation phrase indicating the user
 * is explicitly requesting that logos/brands be excluded.
 */
function hasNegation(rawText: string): boolean {
  return NEGATION_PATTERNS.some((pattern) => pattern.test(rawText));
}

// ─── Normalization ─────────────────────────────────────────────────────────

/**
 * Normalize text for brand detection:
 * - lowercase + trim
 * - collapse repeated whitespace
 * - common leet-speak substitutions (applied conservatively)
 *
 * Does NOT remove all spaces or collapse all repeated characters — those
 * transformations create false positives by joining unrelated words.
 */
export function normalizeForBrandCheck(raw: string): string {
  let s = (raw ?? "").toLowerCase().trim();

  // Collapse all whitespace to single spaces
  s = s.replace(/\s+/g, " ");

  // Common character substitutions (leet speak) — only for single chars
  // surrounded by letters, not globally (to avoid corrupting normal text).
  s = s
    .replace(/(?<=[a-z])3(?=[a-z])/g, "e")
    .replace(/(?<=[a-z])1(?=[a-z])/g, "i")
    .replace(/(?<=[a-z])0(?=[a-z])/g, "o")
    .replace(/(?<=[a-z])@(?=[a-z])/g, "a")
    .replace(/(?<=[a-z])\$(?=[a-z])/g, "s")
    .replace(/(?<=[a-z])7(?=[a-z])/g, "t")
    .replace(/(?<=[a-z])4(?=[a-z])/g, "a")
    .replace(/(?<=[a-z])8(?=[a-z])/g, "b");

  // Remove spaces between single letters: "n i k e" → "nike"
  // Only collapse sequences of 2+ single-letter pairs
  s = s.replace(/\b([a-z]) (?=[a-z](?: [a-z]){1,4}\b)/g, (_, g1) => g1);
  // Second pass for the remaining pairs
  s = s.replace(/([a-z]) ([a-z]) ([a-z]) ([a-z])\b/g, "$1$2$3$4");
  s = s.replace(/([a-z]) ([a-z]) ([a-z])\b/g, "$1$2$3");
  s = s.replace(/([a-z]) ([a-z])\b/g, "$1$2");

  // Collapse hyphens between single letters: "n-i-k-e" → "nike"
  s = s.replace(/([a-z])-([a-z])-([a-z])-([a-z])/g, "$1$2$3$4");
  s = s.replace(/([a-z])-([a-z])-([a-z])/g, "$1$2$3");
  s = s.replace(/([a-z])-([a-z])/g, "$1$2");

  // Final whitespace cleanup
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

// ─── Word-boundary matching ────────────────────────────────────────────────

/**
 * Check if a term appears as a whole word in the text (word-boundary match).
 * This prevents false positives like "heat" matching inside "wheat".
 */
function matchesWordBoundary(text: string, term: string): boolean {
  if (term.length < 2) return false;
  // Escape regex special characters in the term
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}\\b`, "i");
  return pattern.test(text);
}

/**
 * Check if the text contains any context term (logo, emblem, mark, etc.)
 * that would indicate the user is requesting reproduction of a mark.
 */
function hasContextTerm(text: string): boolean {
  return CONTEXT_TERMS.some((term) => matchesWordBoundary(text, term));
}

// ─── Detection ─────────────────────────────────────────────────────────────

const BLOCKED_MESSAGE =
  "Real company, brand, team, or organization logos cannot be added to an EAGOH. You can use original designs and color schemes instead.";
const BLOCKED_SUGGESTION =
  "Try describing the colors, materials, or style without naming or recreating the logo.";

/**
 * Check a single normalized text string against the prohibited brand database.
 *
 * Blocking logic:
 * 1. If the text has a negation phrase ("no brands", "unbranded"), allow it.
 * 2. For brand descriptors (e.g. "nike swoosh", "lv monogram"): always block —
 *    these are explicit requests to reproduce a mark.
 * 3. For brand aliases (e.g. "nike", "lakers"): block only if the text also
 *    contains a context term (logo, emblem, mark, etc.), UNLESS the brand is
 *    unambiguous (not in AMBIGUOUS_BRANDS).
 * 4. For ambiguous brands (apple, heat, bulls, etc.): require context term.
 *
 * Returns the matched brand canonical name + category, or null if clean.
 */
function detectBrandInText(normalized: string, rawText: string): { canonical: string; category: string } | null {
  // ── Negation check: if the user is explicitly excluding logos, allow ──
  if (hasNegation(rawText)) {
    return null;
  }

  const hasContext = hasContextTerm(normalized);

  for (const brand of PROHIBITED_BRANDS) {
    // ── Check descriptors first (explicit mark reproduction requests) ──
    // Descriptors always block — they explicitly request a recognizable mark.
    for (const desc of brand.descriptors) {
      if (desc.length >= 3) {
        const normalizedDesc = desc.toLowerCase().trim();
        // Use word-boundary matching for descriptors too, but allow substring
        // since descriptors are multi-word phrases like "lv monogram"
        if (normalized.includes(normalizedDesc)) {
          return { canonical: brand.canonical, category: "brand_descriptor" };
        }
      }
    }

    // ── Check canonical name ──
    if (matchesWordBoundary(normalized, brand.canonical)) {
      // For ambiguous brands (apple, heat, etc.), require context
      const isAmbiguous = AMBIGUOUS_BRANDS.has(brand.canonical);
      if (!isAmbiguous || hasContext) {
        return { canonical: brand.canonical, category: "brand_name" };
      }
    }

    // ── Check aliases ──
    for (const alias of brand.aliases) {
      if (alias.length < 2) continue;
      if (matchesWordBoundary(normalized, alias)) {
        const isAmbiguous = AMBIGUOUS_BRANDS.has(alias) || AMBIGUOUS_BRANDS.has(brand.canonical);
        // For ambiguous aliases, require context
        if (!isAmbiguous || hasContext) {
          return { canonical: brand.canonical, category: "brand_alias" };
        }
      }
    }
  }

  return null;
}

/**
 * Validate an array of Forge customization fields for prohibited brand/logo content.
 *
 * Only blocks explicit requests to reproduce recognizable real marks.
 * Negative statements ("no brands", "no logos") are always allowed.
 * Generic words ("brand", "company", "business") are allowed by themselves.
 * Ambiguous brand names (apple, heat) require a context term (logo, emblem).
 *
 * @param fields Array of { label, value } pairs for all user-entered text fields
 * @returns BrandGuardResult — check `.blocked` to determine if generation should stop
 */
export function validateForgeFields(fields: BrandGuardField[]): BrandGuardResult {
  for (const field of fields) {
    const value = (field.value ?? "").trim();
    if (value.length === 0) continue;

    const normalized = normalizeForBrandCheck(value);
    const detection = detectBrandInText(normalized, value);

    if (detection) {
      return {
        blocked: true,
        fieldLabel: field.label,
        fieldKey: field.label.toLowerCase().replace(/\s+/g, "_"),
        category: detection.category,
        message: BLOCKED_MESSAGE,
        suggestion: BLOCKED_SUGGESTION,
      };
    }
  }

  return ALLOWED_RESULT;
}

/**
 * Validate a single text string (e.g. the combined prompt or edit prompt).
 */
export function validateForgeText(text: string, fieldLabel = "prompt"): BrandGuardResult {
  const value = (text ?? "").trim();
  if (value.length === 0) return ALLOWED_RESULT;

  const normalized = normalizeForBrandCheck(value);
  const detection = detectBrandInText(normalized, value);

  if (detection) {
    return {
      blocked: true,
      fieldLabel,
      fieldKey: fieldLabel.toLowerCase().replace(/\s+/g, "_"),
      category: detection.category,
      message: BLOCKED_MESSAGE,
      suggestion: BLOCKED_SUGGESTION,
    };
  }

  return ALLOWED_RESULT;
}

// ─── Mandatory anti-logo prompt suffix ─────────────────────────────────────
//
// This is appended to EVERY image generation request server-side.
// The user's prompt cannot override or remove it.

export const ANTI_LOGO_PROMPT_SUFFIX =
  "Do not include any real company logos, brand marks, sports-team logos, league logos, school logos, designer monograms, sponsor marks, copyrighted character insignias, watermarks, or recognizable trademarked symbols. All clothing, equipment, emblems, patterns, shoes, accessories, and insignias must be original and unbranded. Brand-inspired color combinations are allowed, but do not reproduce distinctive logos or protected visual identities. Do not include readable real brand names, logo-shaped chest emblems, branded hat symbols, branded shoe marks, branded jersey patches, sponsor graphics, or designer repeating patterns.";

export const ANTI_LOGO_RETRY_SUFFIX =
  "CRITICAL: The previous image contained a recognizable real-world logo or brand mark. You must NOT reproduce any real company logo, brand mark, sports team logo, league logo, school logo, designer monogram, sponsor mark, trademarked emblem, or recognizable brand symbol. Replace ALL logos with original fictional emblems. Remove ALL readable brand names. Replace ALL branded chest emblems, hat symbols, shoe marks, jersey patches, and sponsor graphics with original non-branded alternatives. All clothing, equipment, patterns, and accessories must be completely original and unbranded.";
