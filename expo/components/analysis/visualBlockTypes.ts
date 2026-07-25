/**
 * Visual Block type definitions for analyst session responses.
 *
 * These are structured dashboard-style data blocks that the AI may optionally
 * return alongside its text analysis. They are rendered as visual cards
 * in the session UI, thread detail, and archive screens.
 *
 * The worker prompts the AI to include these when the analysis benefits from
 * visual presentation (comparisons, projections, statlines, trends).
 * They are NOT betting advice — all labels use analytical framing.
 */

export type VisualBlockType =
  | "score_comparison"
  | "consensus_meter"
  | "over_under_meter"
  | "spread_or_margin_meter"
  | "category_breakdown"
  | "trend_summary"
  | "statline_table"
  | "confidence_meter";

export type ScoreComparisonBlock = {
  type: "score_comparison";
  title: string;
  leftLabel: string;
  rightLabel: string;
  leftValue: string;
  rightValue: string;
};

export type ConsensusMeterBlock = {
  type: "consensus_meter";
  title: string;
  leftLabel: string;
  rightLabel: string;
  leftPercent: number;
  rightPercent: number;
};

export type OverUnderMeterBlock = {
  type: "over_under_meter";
  title: string;
  lineLabel: string;
  lineValue: string;
  underPercent: number;
  overPercent: number;
};

export type SpreadOrMarginMeterBlock = {
  type: "spread_or_margin_meter";
  title: string;
  leftLabel: string;
  rightLabel: string;
  marginLabel: string;
  marginValue: string;
  leftPercent: number;
  rightPercent: number;
};

export type CategoryBreakdownRow = {
  label: string;
  leftScore: number;
  rightScore: number;
};

export type CategoryBreakdownBlock = {
  type: "category_breakdown";
  title: string;
  leftLabel: string;
  rightLabel: string;
  rows: CategoryBreakdownRow[];
};

export type TrendSummaryItem = {
  label: string;
  value: string;
};

export type TrendSummaryBlock = {
  type: "trend_summary";
  title: string;
  items: TrendSummaryItem[];
};

export type StatlineTableRow = {
  label: string;
  leftValue: string;
  rightValue: string;
};

export type StatlineTableBlock = {
  type: "statline_table";
  title: string;
  leftLabel: string;
  rightLabel: string;
  rows: StatlineTableRow[];
};

export type ConfidenceMeterBlock = {
  type: "confidence_meter";
  title: string;
  label: string;
  percent: number;
};

export type VisualBlock =
  | ScoreComparisonBlock
  | ConsensusMeterBlock
  | OverUnderMeterBlock
  | SpreadOrMarginMeterBlock
  | CategoryBreakdownBlock
  | TrendSummaryBlock
  | StatlineTableBlock
  | ConfidenceMeterBlock;

/**
 * Safely parse an unknown value into a VisualBlock array.
 * Validates each block has a recognized type and required fields.
 * Returns null if the input is not valid.
 */
export function parseVisualBlocks(raw: unknown): VisualBlock[] | null {
  if (!Array.isArray(raw)) return null;
  const validTypes: Set<string> = new Set([
    "score_comparison",
    "consensus_meter",
    "over_under_meter",
    "spread_or_margin_meter",
    "category_breakdown",
    "trend_summary",
    "statline_table",
    "confidence_meter",
  ]);

  const result: VisualBlock[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const block = item as Record<string, unknown>;
    if (typeof block.type !== "string" || !validTypes.has(block.type)) continue;
    if (typeof block.title !== "string") continue;
    result.push(block as unknown as VisualBlock);
  }

  return result.length > 0 ? result : null;
}
