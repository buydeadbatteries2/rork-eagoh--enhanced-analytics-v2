/**
 * Observation Tags — domain-specific category → subtag taxonomies for
 * Open Intelligence entries. Each domain gets its own set of categories
 * and subtags, matching the hierarchical architecture used by Sports.
 */

import type { TagCategory } from "@/services/openIntelligence";

// ── Sports (preserved exactly as existing) ────────────────────────────

const SPORTS_TAGS: TagCategory[] = [
  {
    id: "physical-performance",
    label: "Physical / Performance",
    tags: [
      { id: "injury", label: "Injury" },
      { id: "fatigue", label: "Fatigue" },
      { id: "conditioning", label: "Conditioning" },
      { id: "recovery", label: "Recovery" },
      { id: "mobility", label: "Mobility" },
      { id: "stamina", label: "Stamina" },
    ],
  },
  {
    id: "emotional-mental",
    label: "Emotional / Mental",
    tags: [
      { id: "frustration", label: "Frustration" },
      { id: "confidence", label: "Confidence" },
      { id: "pressure", label: "Pressure" },
      { id: "rivalry", label: "Rivalry" },
      { id: "motivation", label: "Motivation" },
      { id: "tilt", label: "Tilt" },
    ],
  },
  {
    id: "strategic",
    label: "Strategic",
    tags: [
      { id: "coaching", label: "Coaching" },
      { id: "rotation", label: "Rotation" },
      { id: "pace", label: "Pace" },
      { id: "matchup", label: "Matchup" },
      { id: "ball_dominance", label: "Ball Dominance" },
      { id: "defensive_scheme", label: "Defensive Scheme" },
    ],
  },
  {
    id: "environment",
    label: "Environment",
    tags: [
      { id: "crowd", label: "Crowd" },
      { id: "travel", label: "Travel" },
      { id: "weather", label: "Weather" },
      { id: "arena_energy", label: "Arena Energy" },
      { id: "national_tv", label: "National TV" },
      { id: "referees", label: "Referees" },
    ],
  },
  {
    id: "narrative",
    label: "Narrative",
    tags: [
      { id: "revenge_game", label: "Revenge Game" },
      { id: "media_pressure", label: "Media Pressure" },
      { id: "contract_year", label: "Contract Year" },
      { id: "team_drama", label: "Team Drama" },
      { id: "trade_rumors", label: "Trade Rumors" },
    ],
  },
  {
    id: "statistical",
    label: "Statistical",
    tags: [
      { id: "shooting", label: "Shooting" },
      { id: "fouls", label: "Fouls" },
      { id: "turnovers", label: "Turnovers" },
      { id: "clutch", label: "Clutch" },
      { id: "rebounding", label: "Rebounding" },
      { id: "defensive_impact", label: "Defensive Impact" },
    ],
  },
];

// ── Music ──────────────────────────────────────────────────────────────

const MUSIC_TAGS: TagCategory[] = [
  {
    id: "music-creative",
    label: "Creative",
    tags: [
      { id: "songwriting", label: "Songwriting" },
      { id: "composition", label: "Composition" },
      { id: "production", label: "Production" },
      { id: "arrangement", label: "Arrangement" },
      { id: "sound_design", label: "Sound Design" },
      { id: "recording_quality", label: "Recording Quality" },
    ],
  },
  {
    id: "music-performance",
    label: "Performance",
    tags: [
      { id: "vocals", label: "Vocals" },
      { id: "instrumentation", label: "Instrumentation" },
      { id: "stage_presence", label: "Stage Presence" },
      { id: "touring", label: "Touring" },
      { id: "live_shows", label: "Live Shows" },
      { id: "rehearsal", label: "Rehearsal" },
    ],
  },
  {
    id: "music-industry",
    label: "Industry",
    tags: [
      { id: "marketing", label: "Marketing" },
      { id: "branding", label: "Branding" },
      { id: "distribution", label: "Distribution" },
      { id: "streaming", label: "Streaming" },
      { id: "social_media", label: "Social Media" },
      { id: "fan_engagement", label: "Fan Engagement" },
    ],
  },
  {
    id: "music-business",
    label: "Business",
    tags: [
      { id: "royalties", label: "Royalties" },
      { id: "publishing", label: "Publishing" },
      { id: "management", label: "Management" },
      { id: "ar", label: "A&R" },
      { id: "contracts", label: "Contracts" },
      { id: "label_strategy", label: "Label Strategy" },
    ],
  },
  {
    id: "music-narrative",
    label: "Narrative",
    tags: [
      { id: "artist_story", label: "Artist Story" },
      { id: "public_image", label: "Public Image" },
      { id: "collaboration", label: "Collaboration" },
      { id: "creative_direction", label: "Creative Direction" },
      { id: "momentum", label: "Momentum" },
    ],
  },
  {
    id: "music-analytics",
    label: "Analytics",
    tags: [
      { id: "streaming_growth", label: "Streaming Growth" },
      { id: "audience_growth", label: "Audience Growth" },
      { id: "engagement_metrics", label: "Engagement Metrics" },
      { id: "chart_performance", label: "Chart Performance" },
      { id: "market_trends", label: "Market Trends" },
    ],
  },
];

// ── Film & Television ──────────────────────────────────────────────────

const FILM_TV_TAGS: TagCategory[] = [
  {
    id: "film-creative",
    label: "Creative",
    tags: [
      { id: "storytelling", label: "Storytelling" },
      { id: "screenwriting", label: "Screenwriting" },
      { id: "character_development", label: "Character Development" },
      { id: "world_building", label: "World Building" },
      { id: "dialogue", label: "Dialogue" },
    ],
  },
  {
    id: "film-production",
    label: "Production",
    tags: [
      { id: "directing", label: "Directing" },
      { id: "cinematography", label: "Cinematography" },
      { id: "editing", label: "Editing" },
      { id: "visual_effects", label: "Visual Effects" },
      { id: "budget", label: "Budget" },
    ],
  },
  {
    id: "film-performance",
    label: "Performance",
    tags: [
      { id: "acting", label: "Acting" },
      { id: "casting", label: "Casting" },
      { id: "chemistry", label: "Chemistry" },
      { id: "improvisation", label: "Improvisation" },
      { id: "star_power", label: "Star Power" },
    ],
  },
  {
    id: "film-industry",
    label: "Industry",
    tags: [
      { id: "distribution", label: "Distribution" },
      { id: "streaming", label: "Streaming" },
      { id: "studio_strategy", label: "Studio Strategy" },
      { id: "marketing", label: "Marketing" },
      { id: "promotion", label: "Promotion" },
    ],
  },
  {
    id: "film-narrative",
    label: "Narrative",
    tags: [
      { id: "reviews", label: "Reviews" },
      { id: "audience_reception", label: "Audience Reception" },
      { id: "franchise_potential", label: "Franchise Potential" },
      { id: "cultural_impact", label: "Cultural Impact" },
      { id: "awards_buzz", label: "Awards Buzz" },
    ],
  },
  {
    id: "film-analytics",
    label: "Analytics",
    tags: [
      { id: "box_office", label: "Box Office" },
      { id: "ratings", label: "Ratings" },
      { id: "watch_time", label: "Watch Time" },
      { id: "audience_metrics", label: "Audience Metrics" },
      { id: "trend_momentum", label: "Trend Momentum" },
    ],
  },
];

// ── Fashion ────────────────────────────────────────────────────────────

const FASHION_TAGS: TagCategory[] = [
  {
    id: "fashion-creative",
    label: "Creative",
    tags: [
      { id: "design", label: "Design" },
      { id: "styling", label: "Styling" },
      { id: "collection_planning", label: "Collection Planning" },
      { id: "color_palette", label: "Color Palette" },
      { id: "silhouette", label: "Silhouette" },
    ],
  },
  {
    id: "fashion-industry",
    label: "Industry",
    tags: [
      { id: "retail", label: "Retail" },
      { id: "branding", label: "Branding" },
      { id: "marketing", label: "Marketing" },
      { id: "fashion_week", label: "Fashion Week" },
      { id: "merchandising", label: "Merchandising" },
    ],
  },
  {
    id: "fashion-trend",
    label: "Trend",
    tags: [
      { id: "streetwear", label: "Streetwear" },
      { id: "luxury", label: "Luxury" },
      { id: "seasonal_trends", label: "Seasonal Trends" },
      { id: "sneaker_culture", label: "Sneaker Culture" },
      { id: "vintage", label: "Vintage" },
    ],
  },
  {
    id: "fashion-business",
    label: "Business",
    tags: [
      { id: "manufacturing", label: "Manufacturing" },
      { id: "supply_chain", label: "Supply Chain" },
      { id: "pricing", label: "Pricing" },
      { id: "brand_positioning", label: "Brand Positioning" },
      { id: "consumer_demand", label: "Consumer Demand" },
    ],
  },
  {
    id: "fashion-narrative",
    label: "Narrative",
    tags: [
      { id: "influencer_culture", label: "Influencer Culture" },
      { id: "personal_brand", label: "Personal Brand" },
      { id: "celebrity_impact", label: "Celebrity Impact" },
      { id: "cultural_relevance", label: "Cultural Relevance" },
    ],
  },
  {
    id: "fashion-analytics",
    label: "Analytics",
    tags: [
      { id: "sales", label: "Sales" },
      { id: "consumer_behavior", label: "Consumer Behavior" },
      { id: "trend_forecasting", label: "Trend Forecasting" },
      { id: "engagement", label: "Engagement" },
      { id: "drop_performance", label: "Drop Performance" },
    ],
  },
];

// ── Education ──────────────────────────────────────────────────────────

const EDUCATION_TAGS: TagCategory[] = [
  {
    id: "education-learning",
    label: "Learning",
    tags: [
      { id: "study_techniques", label: "Study Techniques" },
      { id: "knowledge_retention", label: "Knowledge Retention" },
      { id: "research", label: "Research" },
      { id: "note_taking", label: "Note Taking" },
      { id: "practice", label: "Practice" },
    ],
  },
  {
    id: "education-teaching",
    label: "Teaching",
    tags: [
      { id: "instruction", label: "Instruction" },
      { id: "curriculum", label: "Curriculum" },
      { id: "assessment", label: "Assessment" },
      { id: "lesson_planning", label: "Lesson Planning" },
      { id: "student_support", label: "Student Support" },
    ],
  },
  {
    id: "education-performance",
    label: "Performance",
    tags: [
      { id: "academic_achievement", label: "Academic Achievement" },
      { id: "testing", label: "Testing" },
      { id: "grades", label: "Grades" },
      { id: "consistency", label: "Consistency" },
      { id: "focus", label: "Focus" },
    ],
  },
  {
    id: "education-career",
    label: "Career",
    tags: [
      { id: "skill_development", label: "Skill Development" },
      { id: "professional_growth", label: "Professional Growth" },
      { id: "certification", label: "Certification" },
      { id: "portfolio", label: "Portfolio" },
      { id: "career_path", label: "Career Path" },
    ],
  },
  {
    id: "education-narrative",
    label: "Narrative",
    tags: [
      { id: "student_experience", label: "Student Experience" },
      { id: "classroom_dynamics", label: "Classroom Dynamics" },
      { id: "motivation", label: "Motivation" },
      { id: "learning_barriers", label: "Learning Barriers" },
    ],
  },
  {
    id: "education-analytics",
    label: "Analytics",
    tags: [
      { id: "progress_tracking", label: "Progress Tracking" },
      { id: "outcomes", label: "Outcomes" },
      { id: "completion_rate", label: "Completion Rate" },
      { id: "performance_trends", label: "Performance Trends" },
    ],
  },
];

// ── Gaming ─────────────────────────────────────────────────────────────

const GAMING_TAGS: TagCategory[] = [
  {
    id: "gaming-gameplay",
    label: "Gameplay",
    tags: [
      { id: "mechanics", label: "Mechanics" },
      { id: "strategy", label: "Strategy" },
      { id: "meta", label: "Meta" },
      { id: "patch_changes", label: "Patch Changes" },
      { id: "skill_gap", label: "Skill Gap" },
    ],
  },
  {
    id: "gaming-competition",
    label: "Competition",
    tags: [
      { id: "ranked_play", label: "Ranked Play" },
      { id: "esports", label: "Esports" },
      { id: "tournament", label: "Tournament" },
      { id: "team_play", label: "Team Play" },
      { id: "matchup", label: "Matchup" },
    ],
  },
  {
    id: "gaming-content",
    label: "Content",
    tags: [
      { id: "streaming", label: "Streaming" },
      { id: "community", label: "Community" },
      { id: "creator_growth", label: "Creator Growth" },
      { id: "clips", label: "Clips" },
      { id: "audience_engagement", label: "Audience Engagement" },
    ],
  },
  {
    id: "gaming-equipment",
    label: "Equipment",
    tags: [
      { id: "hardware", label: "Hardware" },
      { id: "setup", label: "Setup" },
      { id: "controller", label: "Controller" },
      { id: "keyboard_mouse", label: "Keyboard Mouse" },
      { id: "performance", label: "Performance" },
    ],
  },
  {
    id: "gaming-narrative",
    label: "Narrative",
    tags: [
      { id: "lore", label: "Lore" },
      { id: "story", label: "Story" },
      { id: "character_balance", label: "Character Balance" },
      { id: "franchise_direction", label: "Franchise Direction" },
    ],
  },
  {
    id: "gaming-analytics",
    label: "Analytics",
    tags: [
      { id: "match_data", label: "Match Data" },
      { id: "win_rate", label: "Win Rate" },
      { id: "performance_metrics", label: "Performance Metrics" },
      { id: "usage_stats", label: "Usage Stats" },
      { id: "player_trends", label: "Player Trends" },
    ],
  },
];

// ── Business ───────────────────────────────────────────────────────────

const BUSINESS_TAGS: TagCategory[] = [
  {
    id: "business-leadership",
    label: "Leadership",
    tags: [
      { id: "team_management", label: "Team Management" },
      { id: "decision_making", label: "Decision Making" },
      { id: "communication", label: "Communication" },
      { id: "hiring", label: "Hiring" },
      { id: "culture", label: "Culture" },
    ],
  },
  {
    id: "business-growth",
    label: "Growth",
    tags: [
      { id: "scaling", label: "Scaling" },
      { id: "operations", label: "Operations" },
      { id: "productivity", label: "Productivity" },
      { id: "customer_acquisition", label: "Customer Acquisition" },
      { id: "retention", label: "Retention" },
    ],
  },
  {
    id: "business-marketing",
    label: "Marketing",
    tags: [
      { id: "branding", label: "Branding" },
      { id: "sales", label: "Sales" },
      { id: "ads", label: "Ads" },
      { id: "funnels", label: "Funnels" },
      { id: "positioning", label: "Positioning" },
    ],
  },
  {
    id: "business-finance",
    label: "Finance",
    tags: [
      { id: "revenue", label: "Revenue" },
      { id: "expenses", label: "Expenses" },
      { id: "profitability", label: "Profitability" },
      { id: "pricing", label: "Pricing" },
      { id: "cash_flow", label: "Cash Flow" },
    ],
  },
  {
    id: "business-narrative",
    label: "Narrative",
    tags: [
      { id: "company_culture", label: "Company Culture" },
      { id: "reputation", label: "Reputation" },
      { id: "founder_story", label: "Founder Story" },
      { id: "market_perception", label: "Market Perception" },
    ],
  },
  {
    id: "business-analytics",
    label: "Analytics",
    tags: [
      { id: "kpis", label: "KPIs" },
      { id: "forecasting", label: "Forecasting" },
      { id: "market_analysis", label: "Market Analysis" },
      { id: "conversion_rate", label: "Conversion Rate" },
      { id: "growth_trends", label: "Growth Trends" },
    ],
  },
];

// ── Finance ────────────────────────────────────────────────────────────

const FINANCE_TAGS: TagCategory[] = [
  {
    id: "finance-investment",
    label: "Investment",
    tags: [
      { id: "stocks", label: "Stocks" },
      { id: "etfs", label: "ETFs" },
      { id: "real_estate", label: "Real Estate" },
      { id: "crypto", label: "Crypto" },
      { id: "bonds", label: "Bonds" },
    ],
  },
  {
    id: "finance-strategy",
    label: "Strategy",
    tags: [
      { id: "portfolio_management", label: "Portfolio Management" },
      { id: "risk_management", label: "Risk Management" },
      { id: "diversification", label: "Diversification" },
      { id: "entry_timing", label: "Entry Timing" },
      { id: "exit_timing", label: "Exit Timing" },
    ],
  },
  {
    id: "finance-market",
    label: "Market",
    tags: [
      { id: "trends", label: "Trends" },
      { id: "macroeconomics", label: "Macroeconomics" },
      { id: "interest_rates", label: "Interest Rates" },
      { id: "sentiment", label: "Sentiment" },
      { id: "volatility", label: "Volatility" },
    ],
  },
  {
    id: "finance-personal",
    label: "Personal Finance",
    tags: [
      { id: "budgeting", label: "Budgeting" },
      { id: "saving", label: "Saving" },
      { id: "debt", label: "Debt" },
      { id: "retirement", label: "Retirement" },
      { id: "emergency_fund", label: "Emergency Fund" },
    ],
  },
  {
    id: "finance-narrative",
    label: "Narrative",
    tags: [
      { id: "investor_sentiment", label: "Investor Sentiment" },
      { id: "company_story", label: "Company Story" },
      { id: "market_fear", label: "Market Fear" },
      { id: "market_confidence", label: "Market Confidence" },
    ],
  },
  {
    id: "finance-analytics",
    label: "Analytics",
    tags: [
      { id: "technical_analysis", label: "Technical Analysis" },
      { id: "fundamental_analysis", label: "Fundamental Analysis" },
      { id: "valuation", label: "Valuation" },
      { id: "performance", label: "Performance" },
      { id: "historical_trend", label: "Historical Trend" },
    ],
  },
];

// ── Technology ─────────────────────────────────────────────────────────

const TECHNOLOGY_TAGS: TagCategory[] = [
  {
    id: "tech-development",
    label: "Development",
    tags: [
      { id: "software_engineering", label: "Software Engineering" },
      { id: "mobile_development", label: "Mobile Development" },
      { id: "web_development", label: "Web Development" },
      { id: "api", label: "API" },
      { id: "testing", label: "Testing" },
    ],
  },
  {
    id: "tech-infrastructure",
    label: "Infrastructure",
    tags: [
      { id: "cloud", label: "Cloud" },
      { id: "devops", label: "DevOps" },
      { id: "networking", label: "Networking" },
      { id: "databases", label: "Databases" },
      { id: "scalability", label: "Scalability" },
    ],
  },
  {
    id: "tech-security",
    label: "Security",
    tags: [
      { id: "cybersecurity", label: "Cybersecurity" },
      { id: "privacy", label: "Privacy" },
      { id: "authentication", label: "Authentication" },
      { id: "threats", label: "Threats" },
      { id: "compliance", label: "Compliance" },
    ],
  },
  {
    id: "tech-innovation",
    label: "Innovation",
    tags: [
      { id: "ai", label: "AI" },
      { id: "robotics", label: "Robotics" },
      { id: "automation", label: "Automation" },
      { id: "hardware", label: "Hardware" },
      { id: "emerging_tech", label: "Emerging Tech" },
    ],
  },
  {
    id: "tech-narrative",
    label: "Narrative",
    tags: [
      { id: "product_vision", label: "Product Vision" },
      { id: "startup_culture", label: "Startup Culture" },
      { id: "user_adoption", label: "User Adoption" },
      { id: "market_fit", label: "Market Fit" },
    ],
  },
  {
    id: "tech-analytics",
    label: "Analytics",
    tags: [
      { id: "performance_metrics", label: "Performance Metrics" },
      { id: "usage_analytics", label: "Usage Analytics" },
      { id: "reliability", label: "Reliability" },
      { id: "speed", label: "Speed" },
      { id: "error_rates", label: "Error Rates" },
    ],
  },
];

// ── Health & Fitness ───────────────────────────────────────────────────

const HEALTH_FITNESS_TAGS: TagCategory[] = [
  {
    id: "health-training",
    label: "Training",
    tags: [
      { id: "strength", label: "Strength" },
      { id: "cardio", label: "Cardio" },
      { id: "mobility", label: "Mobility" },
      { id: "endurance", label: "Endurance" },
      { id: "flexibility", label: "Flexibility" },
    ],
  },
  {
    id: "health-recovery",
    label: "Recovery",
    tags: [
      { id: "sleep", label: "Sleep" },
      { id: "injury_prevention", label: "Injury Prevention" },
      { id: "rest_days", label: "Rest Days" },
      { id: "rehab", label: "Rehab" },
      { id: "stress", label: "Stress" },
    ],
  },
  {
    id: "health-nutrition",
    label: "Nutrition",
    tags: [
      { id: "diet", label: "Diet" },
      { id: "protein", label: "Protein" },
      { id: "hydration", label: "Hydration" },
      { id: "supplementation", label: "Supplementation" },
      { id: "meal_planning", label: "Meal Planning" },
    ],
  },
  {
    id: "health-mental",
    label: "Mental",
    tags: [
      { id: "motivation", label: "Motivation" },
      { id: "discipline", label: "Discipline" },
      { id: "consistency", label: "Consistency" },
      { id: "confidence", label: "Confidence" },
      { id: "habit_building", label: "Habit Building" },
    ],
  },
  {
    id: "health-narrative",
    label: "Narrative",
    tags: [
      { id: "lifestyle", label: "Lifestyle" },
      { id: "transformation", label: "Transformation" },
      { id: "personal_goals", label: "Personal Goals" },
      { id: "barriers", label: "Barriers" },
    ],
  },
  {
    id: "health-analytics",
    label: "Analytics",
    tags: [
      { id: "biometrics", label: "Biometrics" },
      { id: "progress_tracking", label: "Progress Tracking" },
      { id: "weight_trend", label: "Weight Trend" },
      { id: "performance_trend", label: "Performance Trend" },
      { id: "consistency", label: "Consistency" },
    ],
  },
];

// ── Master lookup ──────────────────────────────────────────────────────

const DOMAIN_TAGS: Record<string, TagCategory[]> = {
  sports: SPORTS_TAGS,
  music: MUSIC_TAGS,
  "film-tv": FILM_TV_TAGS,
  fashion: FASHION_TAGS,
  education: EDUCATION_TAGS,
  gaming: GAMING_TAGS,
  business: BUSINESS_TAGS,
  finance: FINANCE_TAGS,
  technology: TECHNOLOGY_TAGS,
  "health-fitness": HEALTH_FITNESS_TAGS,
};

/** Fallback tags used when a domain has no explicit taxonomy. */
const FALLBACK_TAGS: TagCategory[] = [
  {
    id: "general-observation",
    label: "General",
    tags: [
      { id: "insight", label: "Insight" },
      { id: "trend", label: "Trend" },
      { id: "analysis", label: "Analysis" },
      { id: "signal", label: "Signal" },
    ],
  },
];

/**
 * Get observation tag categories for a given intelligence domain.
 * Normalises the domain ID before lookup so that any variant (case,
 * separators, labels, snake_case) resolves to the correct taxonomy.
 * Returns the Sports taxonomy only when the domain is genuinely
 * empty or unrecognised.
 */
export function getObservationTags(domainId: string): TagCategory[] {
  // Guard empty / nullish input
  const raw = (domainId ?? "").trim();
  if (!raw) return SPORTS_TAGS;

  // Normalise to canonical form before lookup
  const canonical = normaliseTagDomain(raw);
  return DOMAIN_TAGS[canonical] ?? SPORTS_TAGS;
}

/**
 * Get a flat array of all tag IDs for a given domain.
 */
export function getAllTagsFlat(domainId: string): { id: string; label: string }[] {
  const cats = getObservationTags(domainId);
  return cats.flatMap((cat) => cat.tags);
}

// ── Local domain normalisation (self-contained; avoids circular deps) ──

const TAG_CANONICAL_IDS = new Set(Object.keys(DOMAIN_TAGS));

const TAG_NORMALIZE_MAP: Record<string, string> = {
  "sport": "sports",
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
 * Normalise a domain ID for tag lookup. Mirrors domains.ts's
 * normaliseDomainId but is self-contained to avoid circular deps.
 */
function normaliseTagDomain(raw: string): string {
  const trimmed = raw.trim();
  if (TAG_CANONICAL_IDS.has(trimmed)) return trimmed;

  const lower = trimmed.toLowerCase();
  if (TAG_NORMALIZE_MAP[lower] !== undefined) return TAG_NORMALIZE_MAP[lower];

  // Collapsed form (strip all non-alphanumeric)
  const collapsed = lower.replace(/[^a-z0-9]/g, "");
  if (TAG_NORMALIZE_MAP[collapsed] !== undefined) return TAG_NORMALIZE_MAP[collapsed];

  // Try matching canonical IDs by collapsed form
  for (const canonical of TAG_CANONICAL_IDS) {
    if (canonical.replace(/[^a-z0-9]/g, "") === collapsed) return canonical;
  }

  // Unknown — return the lowercased input (will fallback to SPORTS_TAGS)
  return lower;
}

/**
 * Search tags within a domain by a query string.
 * Returns matching {id, label} pairs, ranked by how early the match appears.
 */
export function searchTags(domainId: string, query: string): { id: string; label: string }[] {
  const flat = getAllTagsFlat(domainId);
  const q = query.toLowerCase().trim();
  if (!q) return flat.slice(0, 12);
  const matches = flat.filter((t) => t.label.toLowerCase().includes(q));
  return matches.slice(0, 20);
}

/**
 * Look up a tag label by ID across a domain's taxonomy.
 */
export function lookupTagLabel(tagId: string, domainId: string): string {
  return getAllTagsFlat(domainId).find((t) => t.id === tagId)?.label ?? tagId;
}
