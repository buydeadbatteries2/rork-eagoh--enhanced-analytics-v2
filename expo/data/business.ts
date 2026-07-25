/**
 * Business Domain — canonical industry and role definitions.
 *
 * Used by the Forge wizard when Intelligence Domain = Business, and for
 * marketplace filtering, leaderboards, and faction team-focus lookups.
 */

export type BusinessIndustry = {
  id: string;
  label: string;
};

export type BusinessRole = {
  id: string;
  label: string;
};

export const BUSINESS_INDUSTRIES: BusinessIndustry[] = [
  { id: "marketing", label: "Marketing" },
  { id: "retail", label: "Retail" },
  { id: "saas", label: "SaaS" },
  { id: "real_estate", label: "Real Estate" },
  { id: "ecommerce", label: "E-Commerce" },
  { id: "startups", label: "Startups" },
];

export const BUSINESS_ROLES: BusinessRole[] = [
  { id: "founder", label: "Founder" },
  { id: "ceo", label: "CEO" },
  { id: "investor", label: "Investor" },
  { id: "marketer", label: "Marketer" },
  { id: "sales", label: "Sales" },
  { id: "operations", label: "Operations" },
];

/** Look up a business industry by canonical id. */
export function getBusinessIndustry(industryId: string): BusinessIndustry | undefined {
  return BUSINESS_INDUSTRIES.find((i) => i.id === industryId);
}

/** Look up a business role by canonical id. */
export function getBusinessRole(roleId: string): BusinessRole | undefined {
  return BUSINESS_ROLES.find((r) => r.id === roleId);
}
