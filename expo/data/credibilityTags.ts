/**
 * Domain-specific credibility tags for EAGOH Knowledge Credentials.
 *
 * Each domain's tags represent real roles, perspectives, and expertise levels
 * that a source can claim. Tags change based on the selected EAGOH domain.
 */

export const SPORTS_TAGS = [
  "Former Athlete",
  "Coach",
  "Analyst",
  "Scout",
  "Trainer",
  "Referee",
  "Fan Expert",
  "Content Creator",
] as const;

export const MUSIC_TAGS = [
  "Artist",
  "Producer",
  "Songwriter",
  "Engineer",
  "DJ",
  "Manager",
  "A&R",
  "Music Critic",
  "Performer",
] as const;

export const FILM_TV_TAGS = [
  "Actor",
  "Director",
  "Writer",
  "Producer",
  "Film Critic",
  "Editor",
  "Cinematographer",
  "Casting",
  "Entertainment Analyst",
] as const;

export const FASHION_TAGS = [
  "Designer",
  "Stylist",
  "Model",
  "Brand Owner",
  "Influencer",
  "Collector",
  "Fashion Critic",
  "Retail Expert",
] as const;

export const EDUCATION_TAGS = [
  "Teacher",
  "Tutor",
  "Student",
  "Researcher",
  "Professor",
  "Curriculum Designer",
  "Academic Coach",
] as const;

export const GAMING_TAGS = [
  "Player",
  "Coach",
  "Streamer",
  "Esports Analyst",
  "Developer",
  "Content Creator",
  "Competitive Gamer",
] as const;

export const BUSINESS_TAGS = [
  "Founder",
  "Operator",
  "Marketer",
  "Sales Professional",
  "Investor",
  "Consultant",
  "Manager",
  "Strategist",
] as const;

export const FINANCE_TAGS = [
  "Investor",
  "Trader",
  "Analyst",
  "Budgeting Expert",
  "Real Estate Investor",
  "Financial Educator",
  "Researcher",
] as const;

export const TECHNOLOGY_TAGS = [
  "Developer",
  "Engineer",
  "Founder",
  "Cybersecurity Specialist",
  "AI Builder",
  "Product Designer",
  "Tech Reviewer",
] as const;

export const HEALTH_FITNESS_TAGS = [
  "Athlete",
  "Trainer",
  "Coach",
  "Nutritionist",
  "Bodybuilder",
  "Runner",
  "Wellness Creator",
] as const;

/**
 * Returns the domain-specific credibility tag options for a given domain ID.
 * Falls back to generic tags if the domain is unrecognized.
 */
export function getCredibilityTagsForDomain(domain: string): readonly string[] {
  switch (domain) {
    case "sports":
      return SPORTS_TAGS;
    case "music":
      return MUSIC_TAGS;
    case "film-tv":
      return FILM_TV_TAGS;
    case "fashion":
      return FASHION_TAGS;
    case "education":
      return EDUCATION_TAGS;
    case "gaming":
      return GAMING_TAGS;
    case "business":
      return BUSINESS_TAGS;
    case "finance":
      return FINANCE_TAGS;
    case "technology":
      return TECHNOLOGY_TAGS;
    case "health-fitness":
      return HEALTH_FITNESS_TAGS;
    default:
      return [
        "Industry Professional",
        "Analyst",
        "Content Creator",
        "Hobby Expert",
      ] as const;
  }
}
