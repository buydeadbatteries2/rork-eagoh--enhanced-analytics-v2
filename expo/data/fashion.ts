/**
 * Fashion Domain — canonical style category and role definitions.
 *
 * Used by the Forge wizard when Intelligence Domain = Fashion, and for
 * marketplace filtering, leaderboards, and faction team-focus lookups.
 */

export type FashionStyleCategory = {
  id: string;
  label: string;
};

export type FashionRole = {
  id: string;
  label: string;
};

export const FASHION_STYLE_CATEGORIES: FashionStyleCategory[] = [
  { id: "streetwear", label: "Streetwear" },
  { id: "luxury", label: "Luxury" },
  { id: "casual", label: "Casual" },
  { id: "athletic", label: "Athletic" },
  { id: "formal", label: "Formal" },
  { id: "high_fashion", label: "High Fashion" },
  { id: "vintage", label: "Vintage" },
  { id: "designer", label: "Designer" },
];

export const FASHION_ROLES: FashionRole[] = [
  { id: "designer", label: "Designer" },
  { id: "stylist", label: "Stylist" },
  { id: "model", label: "Model" },
  { id: "influencer", label: "Influencer" },
  { id: "collector", label: "Collector" },
  { id: "brand_owner", label: "Brand Owner" },
  { id: "fan", label: "Fan" },
];

/** Look up a fashion style category by canonical id. */
export function getFashionStyleCategory(categoryId: string): FashionStyleCategory | undefined {
  return FASHION_STYLE_CATEGORIES.find((c) => c.id === categoryId);
}

/** Look up a fashion role by canonical id. */
export function getFashionRole(roleId: string): FashionRole | undefined {
  return FASHION_ROLES.find((r) => r.id === roleId);
}
