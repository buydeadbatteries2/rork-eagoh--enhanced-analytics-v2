/**
 * AnalysisVisualBlock — renders structured visual data blocks from analyst
 * session responses as dashboard-style cards.
 *
 * Supports 8 visual block types:
 *   - score_comparison: two-value score display
 *   - consensus_meter: split-bar percentage meter
 *   - over_under_meter: over/under projection bar
 *   - spread_or_margin_meter: margin comparison bar
 *   - category_breakdown: multi-row category comparison
 *   - trend_summary: labeled trend items
 *   - statline_table: stat table with two columns
 *   - confidence_meter: single confidence indicator
 *
 * Style: dark cards with neon cyan/purple/gold accents, rounded panels,
 * mobile-friendly readable numbers. No sportsbook or gambling branding.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { palette } from "@/constants/colors";
import { LinearGradient } from "expo-linear-gradient";
import type {
  VisualBlock,
  ScoreComparisonBlock,
  ConsensusMeterBlock,
  OverUnderMeterBlock,
  SpreadOrMarginMeterBlock,
  CategoryBreakdownBlock,
  TrendSummaryBlock,
  StatlineTableBlock,
  ConfidenceMeterBlock,
} from "./visualBlockTypes";

// ── Shared primitives ─────────────────────────────────────────────────────

function BlockContainer({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <View style={styles.container}>
      <LinearGradient
        colors={["rgba(108,230,255,0.06)", "rgba(8,15,26,0.85)", "rgba(6,11,20,0.92)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Text style={styles.title}>{title}</Text>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

function SideLabel({ label, color }: { label: string; color: string }): JSX.Element {
  return (
    <Text style={[styles.sideLabel, { color }]} numberOfLines={2}>
      {label}
    </Text>
  );
}

function BigValue({ value, color }: { value: string; color: string }): JSX.Element {
  return <Text style={[styles.bigValue, { color }]}>{value}</Text>;
}

function MeterBar({ leftPercent, rightPercent, leftColor, rightColor }: {
  leftPercent: number;
  rightPercent: number;
  leftColor: string;
  rightColor: string;
}): JSX.Element {
  return (
    <View style={styles.meterBar}>
      <View style={[styles.meterFill, { width: `${Math.min(100, Math.max(0, leftPercent))}%`, backgroundColor: leftColor }]} />
      <View style={[styles.meterFill, { width: `${Math.min(100, Math.max(0, rightPercent))}%`, backgroundColor: rightColor }]} />
    </View>
  );
}

function PercentLabel({ leftPercent, rightPercent, leftColor, rightColor }: {
  leftPercent: number;
  rightPercent: number;
  leftColor: string;
  rightColor: string;
}): JSX.Element {
  return (
    <View style={styles.percentRow}>
      <Text style={[styles.percentText, { color: leftColor }]}>{Math.round(leftPercent)}%</Text>
      <Text style={[styles.percentText, { color: rightColor }]}>{Math.round(rightPercent)}%</Text>
    </View>
  );
}

// ── Individual block renderers ────────────────────────────────────────────

function ScoreComparisonView({ block }: { block: ScoreComparisonBlock }): JSX.Element {
  return (
    <BlockContainer title={block.title}>
      <View style={styles.scoreRow}>
        <View style={styles.scoreSide}>
          <SideLabel label={block.leftLabel} color={palette.cyan} />
          <BigValue value={block.leftValue} color={palette.cyan} />
        </View>
        <View style={styles.scoreDivider} />
        <View style={styles.scoreSide}>
          <SideLabel label={block.rightLabel} color={palette.violet} />
          <BigValue value={block.rightValue} color={palette.violet} />
        </View>
      </View>
    </BlockContainer>
  );
}

function ConsensusMeterView({ block }: { block: ConsensusMeterBlock }): JSX.Element {
  return (
    <BlockContainer title={block.title}>
      <View style={styles.labelRow}>
        <SideLabel label={block.leftLabel} color={palette.cyan} />
        <SideLabel label={block.rightLabel} color={palette.violet} />
      </View>
      <MeterBar leftPercent={block.leftPercent} rightPercent={block.rightPercent} leftColor={palette.cyan} rightColor={palette.violet} />
      <PercentLabel leftPercent={block.leftPercent} rightPercent={block.rightPercent} leftColor={palette.cyan} rightColor={palette.violet} />
    </BlockContainer>
  );
}

function OverUnderMeterView({ block }: { block: OverUnderMeterBlock }): JSX.Element {
  return (
    <BlockContainer title={block.title}>
      <View style={styles.lineRow}>
        <Text style={styles.lineLabel}>{block.lineLabel}</Text>
        <Text style={styles.lineValue}>{block.lineValue}</Text>
      </View>
      <View style={styles.overUnderBar}>
        <View style={[styles.underFill, { width: `${Math.min(100, Math.max(0, block.underPercent))}%` }]}>
          <Text style={styles.barLabel}>Under</Text>
        </View>
        <View style={[styles.overFill, { width: `${Math.min(100, Math.max(0, block.overPercent))}%` }]}>
          <Text style={styles.barLabel}>Over</Text>
        </View>
      </View>
      <View style={styles.percentRow}>
        <Text style={[styles.percentText, { color: palette.gold }]}>{Math.round(block.underPercent)}% Under</Text>
        <Text style={[styles.percentText, { color: palette.success }]}>{Math.round(block.overPercent)}% Over</Text>
      </View>
    </BlockContainer>
  );
}

function SpreadOrMarginMeterView({ block }: { block: SpreadOrMarginMeterBlock }): JSX.Element {
  return (
    <BlockContainer title={block.title}>
      <View style={styles.marginRow}>
        <Text style={styles.marginLabel}>{block.marginLabel}</Text>
        <Text style={[styles.marginValue, { color: palette.gold }]}>{block.marginValue}</Text>
      </View>
      <View style={styles.labelRow}>
        <SideLabel label={block.leftLabel} color={palette.cyan} />
        <SideLabel label={block.rightLabel} color={palette.violet} />
      </View>
      <MeterBar leftPercent={block.leftPercent} rightPercent={block.rightPercent} leftColor={palette.cyan} rightColor={palette.violet} />
      <PercentLabel leftPercent={block.leftPercent} rightPercent={block.rightPercent} leftColor={palette.cyan} rightColor={palette.violet} />
    </BlockContainer>
  );
}

function CategoryBreakdownView({ block }: { block: CategoryBreakdownBlock }): JSX.Element {
  return (
    <BlockContainer title={block.title}>
      <View style={styles.categoryHeader}>
        <Text style={styles.categoryHeaderLabel}>Category</Text>
        <Text style={[styles.categoryHeaderScore, { color: palette.cyan }]}>{block.leftLabel}</Text>
        <Text style={[styles.categoryHeaderScore, { color: palette.violet }]}>{block.rightLabel}</Text>
      </View>
      {block.rows.map((row, idx) => {
        const maxScore = Math.max(row.leftScore, row.rightScore, 100);
        return (
          <View key={`cat-${idx}`}>
            <View style={styles.categoryRow}>
              <Text style={styles.categoryLabel}>{row.label}</Text>
              <Text style={[styles.categoryScore, { color: palette.cyan }]}>{row.leftScore}</Text>
              <Text style={[styles.categoryScore, { color: palette.violet }]}>{row.rightScore}</Text>
            </View>
            <View style={styles.categoryBarRow}>
              <View style={styles.categoryBarLeft}>
                <View style={[styles.categoryBarFill, { width: `${(row.leftScore / maxScore) * 100}%`, backgroundColor: palette.cyan }]} />
              </View>
              <View style={styles.categoryBarRight}>
                <View style={[styles.categoryBarFill, { width: `${(row.rightScore / maxScore) * 100}%`, backgroundColor: palette.violet }]} />
              </View>
            </View>
          </View>
        );
      })}
    </BlockContainer>
  );
}

function TrendSummaryView({ block }: { block: TrendSummaryBlock }): JSX.Element {
  return (
    <BlockContainer title={block.title}>
      <View style={styles.trendGrid}>
        {block.items.map((item, idx) => (
          <View key={`trend-${idx}`} style={styles.trendItem}>
            <Text style={styles.trendLabel}>{item.label}</Text>
            <Text style={styles.trendValue}>{item.value}</Text>
          </View>
        ))}
      </View>
    </BlockContainer>
  );
}

function StatlineTableView({ block }: { block: StatlineTableBlock }): JSX.Element {
  return (
    <BlockContainer title={block.title}>
      <View style={styles.statlineHeader}>
        <Text style={styles.statlineHeaderLabel}>Stat</Text>
        <Text style={[styles.statlineHeaderValue, { color: palette.cyan }]}>{block.leftLabel}</Text>
        <Text style={[styles.statlineHeaderValue, { color: palette.violet }]}>{block.rightLabel}</Text>
      </View>
      {block.rows.map((row, idx) => (
        <View key={`stat-${idx}`} style={[styles.statlineRow, idx % 2 === 1 && styles.statlineRowAlt]}>
          <Text style={styles.statlineLabel}>{row.label}</Text>
          <Text style={[styles.statlineValue, { color: palette.cyan }]}>{row.leftValue}</Text>
          <Text style={[styles.statlineValue, { color: palette.violet }]}>{row.rightValue}</Text>
        </View>
      ))}
    </BlockContainer>
  );
}

function ConfidenceMeterView({ block }: { block: ConfidenceMeterBlock }): JSX.Element {
  const pct = Math.min(100, Math.max(0, block.percent));
  const color = pct >= 80 ? palette.success : pct >= 60 ? palette.cyan : pct >= 40 ? palette.gold : palette.ember;
  return (
    <BlockContainer title={block.title}>
      <View style={styles.confidenceRow}>
        <View style={styles.confidenceCircle}>
          <Text style={[styles.confidencePercent, { color }]}>{Math.round(pct)}%</Text>
        </View>
        <View style={styles.confidenceInfo}>
          <Text style={styles.confidenceLabel}>{block.label}</Text>
          <View style={styles.confidenceBar}>
            <View style={[styles.confidenceBarFill, { width: `${pct}%`, backgroundColor: color }]} />
          </View>
        </View>
      </View>
    </BlockContainer>
  );
}

// ── Main renderer ─────────────────────────────────────────────────────────

/** Render a single visual block by dispatching on its type. */
export function AnalysisVisualBlock({ block }: { block: VisualBlock }): JSX.Element | null {
  switch (block.type) {
    case "score_comparison":
      return <ScoreComparisonView block={block} />;
    case "consensus_meter":
      return <ConsensusMeterView block={block} />;
    case "over_under_meter":
      return <OverUnderMeterView block={block} />;
    case "spread_or_margin_meter":
      return <SpreadOrMarginMeterView block={block} />;
    case "category_breakdown":
      return <CategoryBreakdownView block={block} />;
    case "trend_summary":
      return <TrendSummaryView block={block} />;
    case "statline_table":
      return <StatlineTableView block={block} />;
    case "confidence_meter":
      return <ConfidenceMeterView block={block} />;
    default:
      return null;
  }
}

/** Render an array of visual blocks, stacked vertically. */
export function AnalysisVisualBlocks({ blocks }: { blocks: VisualBlock[] }): JSX.Element {
  return (
    <View style={styles.blocksStack}>
      {blocks.map((block, idx) => (
        <AnalysisVisualBlock key={`vblock-${idx}`} block={block} />
      ))}
    </View>
  );
}

/** Analytics disclaimer shown beneath visual blocks for projection-type content. */
export function AnalyticsDisclaimer(): JSX.Element {
  return (
    <View style={styles.disclaimer}>
      <Text style={styles.disclaimerText}>
        Analytics are estimates based on available data and user intelligence. They are not guarantees.
      </Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(108,230,255,0.18)" as const,
    padding: 14,
    gap: 12,
    overflow: "hidden" as const,
  },
  title: {
    color: palette.text,
    fontSize: 13,
    fontWeight: "900" as const,
    letterSpacing: 0.5,
  },
  content: { gap: 10 },

  // Score comparison
  scoreRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12 },
  scoreSide: { flex: 1, alignItems: "center" as const, gap: 6 },
  scoreDivider: {
    width: 1,
    height: 40,
    backgroundColor: "rgba(120,180,255,0.15)" as const,
  },

  // Labels
  sideLabel: {
    fontSize: 11,
    fontWeight: "700" as const,
    textAlign: "center" as const,
    lineHeight: 15,
  },
  bigValue: {
    fontSize: 28,
    fontWeight: "900" as const,
    letterSpacing: -0.5,
  },
  labelRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
  },

  // Meter bar
  meterBar: {
    flexDirection: "row" as const,
    height: 8,
    borderRadius: 4,
    overflow: "hidden" as const,
    backgroundColor: "rgba(10,20,40,0.6)" as const,
  },
  meterFill: { height: "100%" as const },
  percentRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
  },
  percentText: {
    fontSize: 12,
    fontWeight: "800" as const,
  },

  // Over/under
  lineRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
  },
  lineLabel: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: "700" as const,
  },
  lineValue: {
    color: palette.text,
    fontSize: 20,
    fontWeight: "900" as const,
  },
  overUnderBar: {
    flexDirection: "row" as const,
    height: 28,
    borderRadius: 6,
    overflow: "hidden" as const,
    backgroundColor: "rgba(10,20,40,0.6)" as const,
  },
  underFill: {
    backgroundColor: "rgba(255,181,71,0.5)" as const,
    justifyContent: "center" as const,
    paddingLeft: 8,
  },
  overFill: {
    backgroundColor: "rgba(0,255,178,0.5)" as const,
    justifyContent: "center" as const,
    alignItems: "flex-end" as const,
    paddingRight: 8,
  },
  barLabel: {
    fontSize: 10,
    fontWeight: "900" as const,
    color: palette.void,
  },

  // Spread/margin
  marginRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(120,180,255,0.10)" as const,
  },
  marginLabel: {
    color: palette.muted,
    fontSize: 11,
    fontWeight: "700" as const,
  },
  marginValue: {
    fontSize: 16,
    fontWeight: "900" as const,
  },

  // Category breakdown
  categoryHeader: {
    flexDirection: "row" as const,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(120,180,255,0.10)" as const,
  },
  categoryHeaderLabel: {
    flex: 1.5,
    color: palette.muted,
    fontSize: 10,
    fontWeight: "800" as const,
    letterSpacing: 0.5,
  },
  categoryHeaderScore: {
    flex: 1,
    fontSize: 10,
    fontWeight: "800" as const,
    textAlign: "center" as const,
  },
  categoryRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingVertical: 4,
  },
  categoryLabel: {
    flex: 1.5,
    color: palette.text,
    fontSize: 12,
    fontWeight: "600" as const,
  },
  categoryScore: {
    flex: 1,
    fontSize: 14,
    fontWeight: "900" as const,
    textAlign: "center" as const,
  },
  categoryBarRow: {
    flexDirection: "row" as const,
    gap: 4,
    paddingBottom: 4,
  },
  categoryBarLeft: { flex: 1, height: 4, borderRadius: 2, backgroundColor: "rgba(10,20,40,0.6)" as const, overflow: "hidden" as const },
  categoryBarRight: { flex: 1, height: 4, borderRadius: 2, backgroundColor: "rgba(10,20,40,0.6)" as const, overflow: "hidden" as const },
  categoryBarFill: { height: "100%" as const, borderRadius: 2 },

  // Trend summary
  trendGrid: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 8,
  },
  trendItem: {
    flexBasis: "47%" as const,
    flexGrow: 1,
    backgroundColor: "rgba(108,230,255,0.06)" as const,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(108,230,255,0.12)" as const,
    padding: 10,
    gap: 4,
  },
  trendLabel: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 0.3,
  },
  trendValue: {
    color: palette.text,
    fontSize: 15,
    fontWeight: "900" as const,
  },

  // Statline table
  statlineHeader: {
    flexDirection: "row" as const,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(120,180,255,0.10)" as const,
  },
  statlineHeaderLabel: {
    flex: 1.5,
    color: palette.muted,
    fontSize: 10,
    fontWeight: "800" as const,
    letterSpacing: 0.5,
  },
  statlineHeaderValue: {
    flex: 1,
    fontSize: 10,
    fontWeight: "800" as const,
    textAlign: "center" as const,
  },
  statlineRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingVertical: 6,
  },
  statlineRowAlt: {
    backgroundColor: "rgba(108,230,255,0.03)" as const,
    borderRadius: 4,
  },
  statlineLabel: {
    flex: 1.5,
    color: palette.text,
    fontSize: 12,
    fontWeight: "600" as const,
  },
  statlineValue: {
    flex: 1,
    fontSize: 13,
    fontWeight: "800" as const,
    textAlign: "center" as const,
  },

  // Confidence meter
  confidenceRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 14,
  },
  confidenceCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: "rgba(108,230,255,0.25)" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: "rgba(10,20,40,0.6)" as const,
  },
  confidencePercent: {
    fontSize: 16,
    fontWeight: "900" as const,
  },
  confidenceInfo: { flex: 1, gap: 8 },
  confidenceLabel: {
    color: palette.text,
    fontSize: 13,
    fontWeight: "700" as const,
  },
  confidenceBar: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(10,20,40,0.6)" as const,
    overflow: "hidden" as const,
  },
  confidenceBarFill: {
    height: "100%" as const,
    borderRadius: 3,
  },

  // Blocks stack
  blocksStack: { gap: 10 },

  // Disclaimer
  disclaimer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: "rgba(255,181,71,0.06)" as const,
    borderWidth: 1,
    borderColor: "rgba(255,181,71,0.12)" as const,
    marginTop: 2,
  },
  disclaimerText: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: "600" as const,
    textAlign: "center" as const,
    lineHeight: 14,
  },
});
