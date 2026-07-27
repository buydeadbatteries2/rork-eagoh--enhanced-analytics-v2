/**
 * EAGOH Brand & Logo Guard — centralized prohibited-mark validator.
 *
 * Inspects all user-entered Forge customization fields for real company
 * logos, brand marks, sports-team logos, league logos, school logos,
 * designer monograms, trademarked emblems, and recognizable brand symbols.
 *
 * Used BEFORE image generation on both the client (fast feedback) and the
 * server (authoritative). The server copy is the source of truth — a
 * modified client cannot bypass it.
 *
 * Normalization defeats common evasion tricks:
 *   - lowercase + trim
 *   - collapse repeated whitespace / punctuation
 *   - common character substitutions (3→e, 1→i, 0→o, @→a, $→s, etc.)
 *   - remove spaces between letters ("n i k e" → "nike")
 *   - common misspellings and descriptive attempts
 *
 * Allowed: generic clothing, generic equipment, team colors, original
 * emblems, fictional symbols, non-branded accessories.
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

// ─── Prohibited brand database ─────────────────────────────────────────────
//
// Each entry has:
//  - aliases: canonical brand name + common misspellings / abbreviations
//  - descriptors: descriptive phrases users might use to recreate the mark
//
// This is NOT a complete list — the AI post-generation review catches
// anything that slips through text filtering.

type BrandEntry = {
  canonical: string;
  aliases: string[];
  descriptors: string[];
};

const PROHIBITED_BRANDS: BrandEntry[] = [
  // ── Athletic / Sportswear ──
  {
    canonical: "nike",
    aliases: ["nike", "nke", "nik3", "n!ke", "n1ke", "nikey", "nyke", "nikee"],
    descriptors: ["swoosh", "check-shaped athletic logo", "checkmark athletic logo", "nike swoosh", "swoosh logo", "the swoosh"],
  },
  {
    canonical: "adidas",
    aliases: ["adidas", "adiddas", "adidas", "ad1das", "adidas", "adiads", "addidas", "adidas"],
    descriptors: ["three stripes", "three adidas-style stripes", "trefoil", "adidas stripes", "three parallel stripes", "three-stripe design"],
  },
  {
    canonical: "jordan",
    aliases: ["jordan", "jordann", "j0rdan", "jumpman", "jordan brand", "air jordan", "jordans"],
    descriptors: ["jumpman silhouette", "jumpman logo", "jumpman-style silhouette", "jumpman symbol", "basketball player silhouette logo", "flying basketball player logo"],
  },
  {
    canonical: "under armour",
    aliases: ["under armour", "underarmour", "under armor", "underarmor", "ua logo", "u.a."],
    descriptors: ["under armour logo", "interlocking ua", "ua connected logo"],
  },
  {
    canonical: "puma",
    aliases: ["puma", "pumaa", "p0ma", "pumma"],
    descriptors: ["puma leaping cat", "puma cat logo", "leaping cat logo", "puma formstrip"],
  },
  {
    canonical: "reebok",
    aliases: ["reebok", "reebokk", "r33bok", "reebook"],
    descriptors: ["reebok logo", "reebok vector", "delta logo reebok"],
  },
  {
    canonical: "new balance",
    aliases: ["new balance", "newbalance", "n.b.", "nb logo"],
    descriptors: ["new balance logo", "nb stacked logo"],
  },
  {
    canonical: "champion",
    aliases: ["champion", "chamption", "champ1on"],
    descriptors: ["champion logo", "c logo champion"],
  },

  // ── Luxury / Fashion ──
  {
    canonical: "gucci",
    aliases: ["gucci", "gucc1", "guccci", "guccl", "guccy"],
    descriptors: ["gucci pattern", "gg monogram", "gucci monogram", "interlocking g logo", "green red green stripe gucci", "gucci snake"],
  },
  {
    canonical: "louis vuitton",
    aliases: ["louis vuitton", "louisvuitton", "lv", "l.v.", "louie vuitton", "louis vutton", "luis vuitton", "lv monogram"],
    descriptors: ["lv monogram", "louis vuitton monogram", "lv-style monogram", "lv pattern", "lv logo", "louis vuitton pattern", "lv flower pattern"],
  },
  {
    canonical: "prada",
    aliases: ["prada", "prad4", "pradaa", "prada"],
    descriptors: ["prada logo", "prada triangle logo", "inverted triangle prada"],
  },
  {
    canonical: "hermes",
    aliases: ["hermes", "hermès", "hermes", "h3rmes"],
    descriptors: ["hermes logo", "hermes horse carriage", "hermes h logo"],
  },
  {
    canonical: "burberry",
    aliases: ["burberry", "burberry", "burb3rry", "burbery"],
    descriptors: ["burberry check", "burberry plaid", "burberry pattern", "nova check"],
  },
  {
    canonical: "versace",
    aliases: ["versace", "versace", "v3rsace", "versache"],
    descriptors: ["versace logo", "medusa head versace", "versace medusa", "greek key versace"],
  },
  {
    canonical: "balenciaga",
    aliases: ["balenciaga", "balenciaga", "bal3nciaga"],
    descriptors: ["balenciaga logo", "balenciaga font logo"],
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
    aliases: ["supreme", "supr3me", "supremee", "supream"],
    descriptors: ["supreme logo", "supreme box logo", "red box logo supreme"],
  },

  // ── Tech ──
  {
    canonical: "apple",
    aliases: ["apple", "appl3", "appl", "apple inc"],
    descriptors: ["apple logo", "bitten apple symbol", "bitten apple logo", "apple emblem", "apple symbol on chest", "apple icon"],
  },
  {
    canonical: "microsoft",
    aliases: ["microsoft", "m1crosoft", "microsoft", "msft"],
    descriptors: ["microsoft logo", "windows logo", "four color squares microsoft", "windows flag"],
  },
  {
    canonical: "google",
    aliases: ["google", "g00gle", "googl", "google inc"],
    descriptors: ["google logo", "google g logo", "google colors logo"],
  },
  {
    canonical: "samsung",
    aliases: ["samsung", "samsng", "s4msung"],
    descriptors: ["samsung logo", "samsung wordmark"],
  },
  {
    canonical: "playstation",
    aliases: ["playstation", "play station", "ps5", "ps4", "ps3", "playstation logo"],
    descriptors: ["playstation logo", "ps logo", "p s logo", "playstation symbols", "circle triangle cross square logo"],
  },
  {
    canonical: "xbox",
    aliases: ["xbox", "x-box", "xboxx", "x b o x"],
    descriptors: ["xbox logo", "xbox green sphere", "xbox sphere logo"],
  },
  {
    canonical: "nintendo",
    aliases: ["nintendo", "n1ntendo", "nintend0"],
    descriptors: ["nintendo logo", "nintendo switch logo", "nintendo wordmark"],
  },

  // ── Social Media ──
  {
    canonical: "facebook",
    aliases: ["facebook", "faceb00k", "fb logo", "facebook logo"],
    descriptors: ["facebook logo", "f logo facebook", "blue f logo"],
  },
  {
    canonical: "x twitter",
    aliases: ["twitter", "x twitter", "x logo", "twitter logo", "tw1tter"],
    descriptors: ["x logo", "twitter logo", "blue bird social media logo", "twitter bird", "x social media logo"],
  },
  {
    canonical: "instagram",
    aliases: ["instagram", "insta", "instgram", "instagram logo", "ig logo"],
    descriptors: ["instagram logo", "instagram camera icon", "instagram gradient logo"],
  },
  {
    canonical: "tiktok",
    aliases: ["tiktok", "tik tok", "tik-tok", "tiktokk"],
    descriptors: ["tiktok logo", "tiktok music note logo", "tiktok symbol"],
  },
  {
    canonical: "youtube",
    aliases: ["youtube", "you tube", "youtub", "yt logo"],
    descriptors: ["youtube logo", "youtube play button", "red play button logo", "youtube subscribe button"],
  },
  {
    canonical: "snapchat",
    aliases: ["snapchat", "snap chat", "snapchat logo"],
    descriptors: ["snapchat logo", "snapchat ghost", "ghost logo snapchat"],
  },
  {
    canonical: "linkedin",
    aliases: ["linkedin", "linked in", "linkedin logo"],
    descriptors: ["linkedin logo", "in logo linkedin"],
  },
  {
    canonical: "threads",
    aliases: ["threads", "threadss", "threads logo"],
    descriptors: ["threads logo", "threads app logo", "at symbol threads"],
  },

  // ── Sports Leagues ──
  {
    canonical: "nfl",
    aliases: ["nfl", "n.f.l.", "national football league"],
    descriptors: ["nfl logo", "nfl shield", "football league shield logo", "nfl shield logo"],
  },
  {
    canonical: "nba",
    aliases: ["nba", "n.b.a.", "national basketball association"],
    descriptors: ["nba logo", "basketball player silhouette logo", "blue red nba logo", "nba emblem"],
  },
  {
    canonical: "mlb",
    aliases: ["mlb", "m.l.b.", "major league baseball"],
    descriptors: ["mlb logo", "baseball batter silhouette logo", "mlb emblem"],
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
    aliases: ["fifa", "f1fa", "fifa logo"],
    descriptors: ["fifa logo", "fifa emblem"],
  },
  {
    canonical: "uefa",
    aliases: ["uefa", "u.e.f.a."],
    descriptors: ["uefa logo", "uefa emblem"],
  },
  {
    canonical: "ncaa",
    aliases: ["ncaa", "n.c.a.a.", "ncaa logo"],
    descriptors: ["ncaa logo", "college sports logo"],
  },

  // ── Sports Teams ──
  {
    canonical: "new york yankees",
    aliases: ["yankees", "n y yankees", "new york yankees", "yankeees"],
    descriptors: ["yankees logo", "yankees cap logo", "ny interlocking logo", "yankees emblem", "yankee logo"],
  },
  {
    canonical: "los angeles lakers",
    aliases: ["lakers", "la lakers", "los angeles lakers", "lak3rs"],
    descriptors: ["lakers logo", "lakers emblem", "purple gold lakers logo"],
  },
  {
    canonical: "chicago bulls",
    aliases: ["bulls", "chicago bulls", "chi bulls", "bullss"],
    descriptors: ["bulls logo", "angry bull logo", "chicago bulls emblem", "bull head logo"],
  },
  {
    canonical: "boston celtics",
    aliases: ["celtics", "boston celtics", "celticss"],
    descriptors: ["celtics logo", "leprechaun logo celtics", "clover logo celtics"],
  },
  {
    canonical: "golden state warriors",
    aliases: ["warriors", "golden state warriors", "gs warriors", "warriorss"],
    descriptors: ["warriors logo", "golden state warriors emblem", "bay bridge logo warriors"],
  },
  {
    canonical: "dallas cowboys",
    aliases: ["cowboys", "dallas cowboys", "dal cowboys", "cowboyss"],
    descriptors: ["cowboys logo", "dallas star logo", "cowboys star", "lone star logo cowboys"],
  },
  {
    canonical: "new england patriots",
    aliases: ["patriots", "new england patriots", "ne patriots"],
    descriptors: ["patriots logo", "patriot head logo", "minuteman logo"],
  },
  {
    canonical: "green bay packers",
    aliases: ["packers", "green bay packers", "gb packers"],
    descriptors: ["packers logo", "g logo packers", "green bay g logo"],
  },
  {
    canonical: "miami heat",
    aliases: ["heat", "miami heat", "mia heat"],
    descriptors: ["miami heat logo", "heat flame logo"],
  },
  {
    canonical: "real madrid",
    aliases: ["real madrid", "realmadrid", "real mdrid"],
    descriptors: ["real madrid logo", "real madrid crest", "real madrid emblem"],
  },
  {
    canonical: "barcelona",
    aliases: ["barcelona", "fc barcelona", "barca", "barcelona fc"],
    descriptors: ["barcelona logo", "barca crest", "fc barcelona emblem"],
  },
  {
    canonical: "manchester united",
    aliases: ["manchester united", "man utd", "manu", "man united", "manchester utd"],
    descriptors: ["manchester united logo", "man utd crest", "red devil logo man united"],
  },
  {
    canonical: "liverpool",
    aliases: ["liverpool", "liverpool fc", "lfc", "liverpoo"],
    descriptors: ["liverpool logo", "liverpool crest", "liverpool bird emblem"],
  },

  // ── Entertainment ──
  {
    canonical: "disney",
    aliases: ["disney", "d1sney", "disneey", "walt disney"],
    descriptors: ["disney logo", "disney castle", "disney wordmark", "disney emblem"],
  },
  {
    canonical: "marvel",
    aliases: ["marvel", "m4rvel", "marvell", "marvel studios"],
    descriptors: ["marvel logo", "marvel studios logo", "marvel red logo", "marvel emblem"],
  },
  {
    canonical: "dc comics",
    aliases: ["dc comics", "dc", "d.c.", "dc logo"],
    descriptors: ["dc logo", "dc comics logo", "dc emblem"],
  },
  {
    canonical: "warner bros",
    aliases: ["warner bros", "warner brothers", "wb logo", "w b logo"],
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
    aliases: ["hbo", "h.b.o.", "hbo logo"],
    descriptors: ["hbo logo", "hbo max logo"],
  },
  {
    canonical: "spotify",
    aliases: ["spotify", "spot1fy", "spotifyy"],
    descriptors: ["spotify logo", "spotify green circle logo", "three sound waves logo"],
  },

  // ── Food / Beverage / Retail ──
  {
    canonical: "coca cola",
    aliases: ["coca cola", "cocacola", "coca-cola", "coke", "c0ca c0la"],
    descriptors: ["coca cola logo", "coke logo", "coca cola script logo", "coca cola wordmark"],
  },
  {
    canonical: "pepsi",
    aliases: ["pepsi", "p3psi", "pepsii"],
    descriptors: ["pepsi logo", "pepsi circle logo", "red blue white circle logo pepsi"],
  },
  {
    canonical: "starbucks",
    aliases: ["starbucks", "starbuckss", "star bucks", "starbux"],
    descriptors: ["starbucks logo", "starbucks siren", "green mermaid logo starbucks", "starbucks siren logo"],
  },
  {
    canonical: "mcdonalds",
    aliases: ["mcdonalds", "mcdonald's", "mcd", "mc donalds", "mcdonaldss"],
    descriptors: ["mcdonalds logo", "golden arches logo", "m arches logo", "mcdonalds arches"],
  },
  {
    canonical: "nike jordan",
    aliases: [],  // covered by jordan entry above
    descriptors: [],
  },

  // ── Automotive ──
  {
    canonical: "ferrari",
    aliases: ["ferrari", "f3rrari", "ferrarri"],
    descriptors: ["ferrari logo", "ferrari prancing horse", "prancing horse logo", "ferrari emblem", "yellow shield ferrari"],
  },
  {
    canonical: "lamborghini",
    aliases: ["lamborghini", "lamborghni", "lambo", "lamborgh1ni"],
    descriptors: ["lamborghini logo", "lamborghini bull", "charging bull logo lamborghini"],
  },
  {
    canonical: "porsche",
    aliases: ["porsche", "porshe", "p0rsche"],
    descriptors: ["porsche logo", "porsche crest", "stuttgart coat of arms porsche"],
  },
  {
    canonical: "mercedes benz",
    aliases: ["mercedes", "mercedes benz", "mercedez", "merc"],
    descriptors: ["mercedes logo", "three point star logo", "mercedes star", "mercedes emblem"],
  },
  {
    canonical: "bmw",
    aliases: ["bmw", "b.m.w.", "b m w"],
    descriptors: ["bmw logo", "bmw roundel", "blue white circle logo bmw", "bmw emblem"],
  },
  {
    canonical: "tesla",
    aliases: ["tesla", "t3sla", "teslaa"],
    descriptors: ["tesla logo", "tesla t logo", "tesla emblem"],
  },
];

// ─── Generic logo-shaped descriptor phrases ───────────────────────────────
//
// These are phrases that describe recognizable brand symbols without naming
// the brand. The AI post-generation review catches visual versions, but we
// block the text versions here too.

const GENERIC_LOGO_PHRASES: string[] = [
  "logo on chest",
  "logo on the chest",
  "brand logo",
  "branded logo",
  "brand mark",
  "brand symbol",
  "trademarked logo",
  "trademark logo",
  "copyrighted logo",
  "sponsor logo",
  "sponsor mark",
  "official logo",
  "real logo",
  "actual logo",
  "branded emblem",
  "branded symbol",
  "branded patch",
  "branded jersey",
  "branded hat",
  "branded shoes",
  "branded uniform",
  "designer logo",
  "designer monogram",
  "designer pattern",
  "designer emblem",
  "real brand",
  "real company logo",
  "real team logo",
  "real team uniform",
  "real jersey",
  "official team jersey",
  "official team uniform",
  "team logo",
  "league logo",
  "school logo",
  "university logo",
  "watermark",
  "copyrighted character",
  "copyrighted character insignia",
  "branded text",
  "readable brand name",
  "brand name on",
  "brand name text",
];

// ─── Normalization ─────────────────────────────────────────────────────────

/**
 * Normalize text for brand detection:
 * - lowercase + trim
 * - collapse repeated whitespace
 * - collapse repeated punctuation
 * - common leet-speak substitutions
 * - remove spaces between single letters
 */
export function normalizeForBrandCheck(raw: string): string {
  let s = (raw ?? "").toLowerCase().trim();

  // Collapse all whitespace to single spaces
  s = s.replace(/\s+/g, " ");

  // Common character substitutions (leet speak)
  s = s
    .replace(/3/g, "e")
    .replace(/1/g, "i")
    .replace(/0/g, "o")
    .replace(/@/g, "a")
    .replace(/\$/g, "s")
    .replace(/7/g, "t")
    .replace(/4/g, "a")
    .replace(/8/g, "b")
    .replace(/9/g, "g")
    .replace(/2/g, "z");

  // Remove all non-alphanumeric except spaces and hyphens
  s = s.replace(/[^a-z0-9 \-]/g, " ");

  // Collapse spaces again after substitution
  s = s.replace(/\s+/g, " ").trim();

  // Remove spaces between single letters: "n i k e" → "nike", "l v" → "lv"
  s = s.replace(/\b([a-z]) (?=[a-z]\b)/g, "$1");
  // Run it again for longer sequences like "n i k e"
  s = s.replace(/\b([a-z]) (?=[a-z])/g, (match, _g1, _offset, fullStr) => {
    // Only collapse if the remaining letters form a word boundary within 5 chars
    const rest = fullStr.slice(_offset + 2, _offset + 8);
    if (/^[a-z]([a-z]| )*[a-z]\b/.test(rest)) return _g1;
    return match;
  });
  // Final pass: collapse all remaining single-letter-spaced sequences
  s = s.replace(/([a-z]) ([a-z]) ([a-z]) ([a-z])/g, "$1$2$3$4");
  s = s.replace(/([a-z]) ([a-z]) ([a-z])/g, "$1$2$3");
  s = s.replace(/([a-z]) ([a-z])/g, "$1$2");

  // Collapse hyphens: "n-i-k-e" → "nike"
  s = s.replace(/([a-z])-([a-z])-([a-z])-([a-z])/g, "$1$2$3$4");
  s = s.replace(/([a-z])-([a-z])-([a-z])/g, "$1$2$3");
  s = s.replace(/([a-z])-([a-z])/g, "$1$2");

  // Collapse repeated characters (e.g., "nikkee" → "nike", "adiddas" → "adidas")
  // Only collapse 3+ consecutive same chars to 2, then check
  s = s.replace(/(.)\1{2,}/g, "$1$1");

  // Final whitespace cleanup
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

// ─── Detection ─────────────────────────────────────────────────────────────

const BLOCKED_MESSAGE =
  "Real company, brand, team, or organization logos cannot be added to an EAGOH. You can use original designs and color schemes instead.";
const BLOCKED_SUGGESTION =
  "Try describing the colors, materials, or style without naming or recreating the logo.";

/**
 * Check a single normalized text string against the prohibited brand database.
 * Returns the matched brand canonical name + category, or null if clean.
 */
function detectBrandInText(normalized: string): { canonical: string; category: string } | null {
  for (const brand of PROHIBITED_BRANDS) {
    // Check canonical name as whole word
    if (normalized.includes(brand.canonical)) {
      return { canonical: brand.canonical, category: "brand_name" };
    }
    // Check aliases
    for (const alias of brand.aliases) {
      if (alias.length >= 2 && normalized.includes(alias)) {
        return { canonical: brand.canonical, category: "brand_alias" };
      }
    }
    // Check descriptors
    for (const desc of brand.descriptors) {
      if (desc.length >= 3 && normalized.includes(normalizeForBrandCheck(desc))) {
        return { canonical: brand.canonical, category: "brand_descriptor" };
      }
    }
  }

  // Check generic logo phrases
  for (const phrase of GENERIC_LOGO_PHRASES) {
    const normalizedPhrase = normalizeForBrandCheck(phrase);
    if (normalizedPhrase.length >= 3 && normalized.includes(normalizedPhrase)) {
      return { canonical: phrase, category: "generic_logo_phrase" };
    }
  }

  return null;
}

/**
 * Validate an array of Forge customization fields for prohibited brand/logo content.
 *
 * @param fields Array of { label, value } pairs for all user-entered text fields
 * @returns BrandGuardResult — check `.blocked` to determine if generation should stop
 */
export function validateForgeFields(fields: BrandGuardField[]): BrandGuardResult {
  for (const field of fields) {
    const value = (field.value ?? "").trim();
    if (value.length === 0) continue;

    const normalized = normalizeForBrandCheck(value);
    const detection = detectBrandInText(normalized);

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
  const normalized = normalizeForBrandCheck(text);
  const detection = detectBrandInText(normalized);

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
