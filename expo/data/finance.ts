/**
 * Finance Domain — canonical focus and role definitions.
 *
 * Used by the Forge wizard when Intelligence Domain = Finance, and for
 * marketplace filtering, leaderboards, and faction team-focus lookups.
 */

export type FinanceFocus = {
  id: string;
  label: string;
};

export type FinanceRole = {
  id: string;
  label: string;
};

export const FINANCE_FOCUSES: FinanceFocus[] = [
  { id: "stocks", label: "Stocks" },
  { id: "etfs", label: "ETFs" },
  { id: "real_estate", label: "Real Estate" },
  { id: "personal_finance", label: "Personal Finance" },
  { id: "crypto", label: "Crypto" },
  { id: "retirement", label: "Retirement" },
];

export const FINANCE_ROLES: FinanceRole[] = [
  { id: "investor", label: "Investor" },
  { id: "trader", label: "Trader" },
  { id: "analyst", label: "Analyst" },
  { id: "financial_advisor", label: "Financial Advisor" },
  { id: "budgeter", label: "Budgeter" },
];

/** Look up a finance focus by canonical id. */
export function getFinanceFocus(focusId: string): FinanceFocus | undefined {
  return FINANCE_FOCUSES.find((f) => f.id === focusId);
}

/** Look up a finance role by canonical id. */
export function getFinanceRole(roleId: string): FinanceRole | undefined {
  return FINANCE_ROLES.find((r) => r.id === roleId);
}
