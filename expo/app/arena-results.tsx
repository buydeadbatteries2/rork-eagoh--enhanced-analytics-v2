/**
 * Arena Results Screen — Phase 11B
 *
 * Displays a structured Arena comparison: verdict, confidence, side-by-side
 * category scores, advantages, similarities, differences, Open Intelligence
 * influence, source citations, and evidence limitations.
 *
 * Receives either a fresh result (via `result` param) or a history entry
 * (via `history` param). Opening history never charges.
 *
 * Actions:
 *   - New Matchup: returns to a blank Arena setup screen
 *   - Rematch: returns to setup with the same subjects/settings filled in
 */

import { palette } from "@/constants/colors";
import { useAppTheme } from "@/providers/ThemeProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useSafeBack } from "@/hooks/useSafeBack";
import {
  ARENA_NEURON_COST,
  type ArenaAnalysisResult,
  type ArenaCategoryScore,
  type ArenaCitation,
  type ArenaHistoryEntry,
  type ArenaSourceInfluence,
  type ArenaVerdict,
} from "@/services/arena";
import {
  ArrowLeft,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Info,
  Link2,
  Plus,
  RefreshCw,
  Scale,
  Sparkles,
  Swords,
  Trophy,
  Zap,
} from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";

// ── Helpers ──────────────────────────────────────────────────────────────────

function verdictColor(verdict: string): string {
  if (verdict.startsWith("Subject A")) return palette.cyan;
  if (verdict.startsWith("Subject B")) return palette.gold;
  if (verdict === "Even Match") return palette.violet;
  if (verdict === "Too Close to Call") return palette.gold;
  return palette.muted;
}

function sourceInfluenceIcon(type: string): React.ReactNode {
  if (type === "personal") return <Sparkles color={palette.cyan} size={13} />;
  if (type === "faction") return <Swords color={palette.violet} size={13} />;
  if (type === "exchange") return <Link2 color={palette.success} size={13} />;
  return <ExternalLink color={palette.gold} size={13} />;
}

function leanLabel(lean: string): string {
  if (lean === "a") return "Leans A";
  if (lean === "b") return "Leans B";
  return "Neutral";
}

function leanColor(lean: string): string {
  if (lean === "a") return palette.cyan;
  if (lean === "b") return palette.gold;
  return palette.muted;
}

// ── Category score bar ───────────────────────────────────────────────────────

function CategoryScoreBar({ score }: { score: ArenaCategoryScore }): JSX.Element {
  const aColor = palette.cyan;
  const bColor = palette.gold;
  const aPct = Math.max(0, Math.min(100, score.scoreA));
  const bPct = Math.max(0, Math.min(100, score.scoreB));
  const leader = aPct > bPct ? "A" : bPct > aPct ? "B" : "tie";

  return (
    <View style={resStyles.catCard}>
      <LinearGradient
        colors={["rgba(14,24,37,0.6)", "rgba(8,15,26,0.85)"]}
        style={StyleSheet.absoluteFill}
      />
      <View style={resStyles.catHeader}>
        <Text style={resStyles.catLabel}>{score.label}</Text>
        {leader !== "tie" ? (
          <View style={[resStyles.catLeaderChip, { borderColor: `${leader === "A" ? aColor : bColor}44` }]}>
            <Text style={[resStyles.catLeaderText, { color: leader === "A" ? aColor : bColor }]}>
              {leader === "A" ? "A" : "B"}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={resStyles.scoreRow}>
        <Text style={[resStyles.scoreNum, { color: aColor }]}>{aPct}</Text>
        <View style={resStyles.scoreBars}>
          <View style={resStyles.barTrack}>
            <View style={[resStyles.barFillA, { width: `${aPct}%`, backgroundColor: aColor }]} />
          </View>
          <View style={resStyles.barTrack}>
            <View style={[resStyles.barFillB, { width: `${bPct}%`, backgroundColor: bColor }]} />
          </View>
        </View>
        <Text style={[resStyles.scoreNum, { color: bColor }]}>{bPct}</Text>
      </View>
      {score.notes ? <Text style={resStyles.catNotes}>{score.notes}</Text> : null}
    </View>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

export default function ArenaResultsScreen(): JSX.Element {
  const { palette: pal } = useAppTheme();
  const h = useHaptics();
  const goBack = useSafeBack("/arena");
  const router = useRouter();
  const params = useLocalSearchParams<{
    result?: string;
    history?: string;
    historyId?: string;
    eagohName?: string;
    eagohDomain?: string;
  }>();

  // Parse the result (fresh analysis) or history entry
  const data = useMemo((): {
    result: ArenaAnalysisResult | null;
    history: ArenaHistoryEntry | null;
    isHistory: boolean;
  } => {
    if (params.history) {
      try {
        const parsed = JSON.parse(params.history) as ArenaHistoryEntry;
        return { result: null, history: parsed, isHistory: true };
      } catch {
        return { result: null, history: null, isHistory: true };
      }
    }
    if (params.result) {
      try {
        const parsed = JSON.parse(params.result) as ArenaAnalysisResult;
        return { result: parsed, history: null, isHistory: false };
      } catch {
        return { result: null, history: null, isHistory: false };
      }
    }
    return { result: null, history: null, isHistory: false };
  }, [params.result, params.history]);

  const [loading] = useState<boolean>(false);

  // Normalize fields from either source
  const arenaTitle = data.result?.arenaTitle
    ?? (data.history ? `${data.history.subject_a_name} vs ${data.history.subject_b_name}` : "Arena Result");
  const verdict = (data.result?.verdict ?? data.history?.verdict ?? "") as ArenaVerdict | string;
  const confidence = data.result?.confidence ?? data.history?.confidence ?? 0;
  const categoryScores = (data.result?.categoryScores ?? data.history?.category_scores ?? []) as ArenaCategoryScore[];
  const subjectAAdvantages = data.result?.subjectAAdvantages ?? data.history?.subject_a_advantages ?? [];
  const subjectBAdvantages = data.result?.subjectBAdvantages ?? data.history?.subject_b_advantages ?? [];
  const similarities = data.result?.similarities ?? data.history?.similarities ?? [];
  const majorDifferences = data.result?.majorDifferences ?? data.history?.major_differences ?? [];
  const oiInfluence = (data.result?.oiInfluence ?? data.history?.oi_influence ?? []) as ArenaSourceInfluence[];
  const sourceCitations = (data.result?.sourceCitations ?? data.history?.source_citations ?? []) as ArenaCitation[];
  const evidenceLimitations = data.result?.evidenceLimitations ?? data.history?.evidence_limitations ?? "";
  const sourceCounts = data.result?.sourceCounts ?? data.history?.source_counts ?? {};
  const neuronCost = data.result?.neuronCost ?? data.history?.neuron_cost ?? ARENA_NEURON_COST;
  const subjectAName = data.result?.normalizedA?.name ?? data.history?.subject_a_name ?? "Subject A";
  const subjectBName = data.result?.normalizedB?.name ?? data.history?.subject_b_name ?? "Subject B";
  const eagohName = params.eagohName ?? "EAGOH";
  const eagohDomain = params.eagohDomain ?? "";

  const vColor = verdictColor(verdict);

  // ── Actions ──
  const handleNewMatchup = useCallback(() => {
    h.selection();
    router.replace("/arena" as never);
  }, [h, router]);

  const handleRematch = useCallback(() => {
    h.selection();
    // Return to setup with the same subjects filled in (does not auto-run)
    const focus = data.history?.focus ?? "overall";
    router.replace({
      pathname: "/arena",
      params: {
        rematch: "1",
        eagohId: data.history?.eagoh_id ?? "",
        cmpType: data.history?.comparison_type ?? "",
        aName: subjectAName,
        aContext: data.history?.subject_a_context ?? "",
        aYear: data.history?.subject_a_year ?? "",
        bName: subjectBName,
        bContext: data.history?.subject_b_context ?? "",
        bYear: data.history?.subject_b_year ?? "",
        focus,
      },
    } as never);
  }, [h, router, data.history, subjectAName, subjectBName]);

  // ── Loading / error states ──
  if (loading) {
    return (
      <SafeAreaView style={resStyles.safe} edges={["top"]}>
        <View style={resStyles.centerWrap}>
          <ActivityIndicator color={palette.violet} size="large" />
          <Text style={resStyles.loadingText}>Loading Arena result…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!data.result && !data.history) {
    return (
      <SafeAreaView style={resStyles.safe} edges={["top"]}>
        <View style={resStyles.header}>
          <Pressable onPress={goBack} hitSlop={12} style={resStyles.backBtn}>
            <ArrowLeft color={palette.text} size={20} />
          </Pressable>
          <Text style={resStyles.headerTitle}>Arena Result</Text>
          <View style={{ width: 28 }} />
        </View>
        <View style={resStyles.centerWrap}>
          <CircleAlert color={palette.ember} size={36} />
          <Text style={resStyles.emptyTitle}>No Result Found</Text>
          <Text style={resStyles.emptyText}>This Arena result could not be loaded.</Text>
          <Pressable onPress={handleNewMatchup} style={resStyles.emptyCta}>
            <LinearGradient
              colors={[palette.violet, "rgba(138,92,255,0.6)"]}
              style={StyleSheet.absoluteFill}
            />
            <Text style={resStyles.emptyCtaText}>New Matchup</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={resStyles.safe} edges={["top"]}>
      {/* Header */}
      <View style={resStyles.header}>
        <Pressable onPress={goBack} hitSlop={12} style={resStyles.backBtn}>
          <ArrowLeft color={palette.text} size={20} />
        </Pressable>
        <View style={resStyles.headerCenter}>
          <Swords color={palette.violet} size={16} />
          <Text style={resStyles.headerTitle}>Arena Result</Text>
        </View>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView
        style={resStyles.scroll}
        contentContainerStyle={{ padding: 14, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* EAGOH context */}
        <View style={resStyles.eagohContextRow}>
          <Text style={resStyles.eagohContextLabel}>{eagohName}</Text>
          {eagohDomain ? <Text style={resStyles.eagohContextDomain}>· {eagohDomain}</Text> : null}
          {data.isHistory ? (
            <View style={resStyles.historyBadge}>
              <Text style={resStyles.historyBadgeText}>HISTORY</Text>
            </View>
          ) : null}
        </View>

        {/* Verdict hero card */}
        <View style={[resStyles.verdictCard, { borderColor: `${vColor}55` }]}>
          <LinearGradient
            colors={[`${vColor}14`, "rgba(8,15,26,0.9)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={resStyles.verdictIconWrap}>
            <LinearGradient
              colors={[`${vColor}22`, "rgba(8,15,26,0.7)"]}
              style={StyleSheet.absoluteFill}
            />
            <Trophy color={vColor} size={26} />
          </View>
          <Text style={resStyles.arenaTitle} numberOfLines={2}>{arenaTitle}</Text>
          <View style={[resStyles.verdictBadge, { borderColor: `${vColor}66`, backgroundColor: `${vColor}14` }]}>
            <Text style={[resStyles.verdictText, { color: vColor }]}>{verdict || "No Verdict"}</Text>
          </View>
          <View style={resStyles.confidenceRow}>
            <Text style={resStyles.confidenceLabel}>CONFIDENCE</Text>
            <Text style={[resStyles.confidenceValue, { color: vColor }]}>{confidence}%</Text>
          </View>
          <Text style={resStyles.disclaimer}>
            Arena scores are analytical estimates, not objective facts.
          </Text>
        </View>

        {/* Subject summaries */}
        {(data.result?.subjectASummary || data.result?.subjectBSummary || data.history?.response_summary) ? (
          <View style={resStyles.section}>
            <Text style={resStyles.sectionLabel}>SUBJECT SUMMARIES</Text>
            <View style={[resStyles.summaryCard, { borderColor: "rgba(108,230,255,0.28)" }]}>
              <LinearGradient
                colors={["rgba(108,230,255,0.06)", "rgba(8,15,26,0.7)"]}
                style={StyleSheet.absoluteFill}
              />
              <Text style={[resStyles.summaryName, { color: palette.cyan }]}>{subjectAName}</Text>
              <Text style={resStyles.summaryText}>
                {data.result?.subjectASummary ?? ""}
              </Text>
            </View>
            <View style={[resStyles.summaryCard, { borderColor: "rgba(255,181,71,0.28)" }]}>
              <LinearGradient
                colors={["rgba(255,181,71,0.06)", "rgba(8,15,26,0.7)"]}
                style={StyleSheet.absoluteFill}
              />
              <Text style={[resStyles.summaryName, { color: palette.gold }]}>{subjectBName}</Text>
              <Text style={resStyles.summaryText}>
                {data.result?.subjectBSummary ?? ""}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Category scores */}
        {categoryScores.length > 0 ? (
          <View style={resStyles.section}>
            <Text style={resStyles.sectionLabel}>CATEGORY SCORES</Text>
            <View style={resStyles.legendRow}>
              <View style={resStyles.legendItem}>
                <View style={[resStyles.legendDot, { backgroundColor: palette.cyan }]} />
                <Text style={resStyles.legendText}>{subjectAName}</Text>
              </View>
              <View style={resStyles.legendItem}>
                <View style={[resStyles.legendDot, { backgroundColor: palette.gold }]} />
                <Text style={resStyles.legendText}>{subjectBName}</Text>
              </View>
            </View>
            {categoryScores.map((cs, i) => (
              <CategoryScoreBar key={`${cs.category}-${i}`} score={cs} />
            ))}
          </View>
        ) : null}

        {/* Advantages side-by-side */}
        {(subjectAAdvantages.length > 0 || subjectBAdvantages.length > 0) ? (
          <View style={resStyles.section}>
            <Text style={resStyles.sectionLabel}>ADVANTAGES</Text>
            <View style={resStyles.advRow}>
              <View style={[resStyles.advCol, { borderColor: "rgba(108,230,255,0.25)" }]}>
                <LinearGradient
                  colors={["rgba(108,230,255,0.06)", "rgba(8,15,26,0.7)"]}
                  style={StyleSheet.absoluteFill}
                />
                <Text style={[resStyles.advColTitle, { color: palette.cyan }]}>{subjectAName}</Text>
                {subjectAAdvantages.map((adv, i) => (
                  <View key={i} style={resStyles.advItem}>
                    <View style={[resStyles.advDot, { backgroundColor: palette.cyan }]} />
                    <Text style={resStyles.advText}>{adv}</Text>
                  </View>
                ))}
              </View>
              <View style={[resStyles.advCol, { borderColor: "rgba(255,181,71,0.25)" }]}>
                <LinearGradient
                  colors={["rgba(255,181,71,0.06)", "rgba(8,15,26,0.7)"]}
                  style={StyleSheet.absoluteFill}
                />
                <Text style={[resStyles.advColTitle, { color: palette.gold }]}>{subjectBName}</Text>
                {subjectBAdvantages.map((adv, i) => (
                  <View key={i} style={resStyles.advItem}>
                    <View style={[resStyles.advDot, { backgroundColor: palette.gold }]} />
                    <Text style={resStyles.advText}>{adv}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        ) : null}

        {/* Similarities */}
        {similarities.length > 0 ? (
          <View style={resStyles.section}>
            <Text style={resStyles.sectionLabel}>SIMILARITIES</Text>
            <View style={resStyles.bulletCard}>
              <LinearGradient
                colors={["rgba(138,92,255,0.06)", "rgba(8,15,26,0.7)"]}
                style={StyleSheet.absoluteFill}
              />
              {similarities.map((s, i) => (
                <View key={i} style={resStyles.bulletRow}>
                  <View style={[resStyles.bulletDot, { backgroundColor: palette.violet }]} />
                  <Text style={resStyles.bulletText}>{s}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Major differences */}
        {majorDifferences.length > 0 ? (
          <View style={resStyles.section}>
            <Text style={resStyles.sectionLabel}>MAJOR DIFFERENCES</Text>
            <View style={resStyles.bulletCard}>
              <LinearGradient
                colors={["rgba(255,77,109,0.06)", "rgba(8,15,26,0.7)"]}
                style={StyleSheet.absoluteFill}
              />
              {majorDifferences.map((d, i) => (
                <View key={i} style={resStyles.bulletRow}>
                  <View style={[resStyles.bulletDot, { backgroundColor: palette.ember }]} />
                  <Text style={resStyles.bulletText}>{d}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Open Intelligence influence */}
        {oiInfluence.length > 0 ? (
          <View style={resStyles.section}>
            <Text style={resStyles.sectionLabel}>OPEN INTELLIGENCE INFLUENCE</Text>
            {oiInfluence.map((src, i) => (
              <View key={i} style={resStyles.oiCard}>
                <LinearGradient
                  colors={["rgba(14,24,37,0.6)", "rgba(8,15,26,0.85)"]}
                  style={StyleSheet.absoluteFill}
                />
                <View style={resStyles.oiHeader}>
                  {sourceInfluenceIcon(src.sourceType)}
                  <Text style={resStyles.oiLabel}>{src.label}</Text>
                  <View style={{ flex: 1 }} />
                  <View style={[resStyles.oiLeanChip, { borderColor: `${leanColor(src.lean)}44` }]}>
                    <Text style={[resStyles.oiLeanText, { color: leanColor(src.lean) }]}>
                      {leanLabel(src.lean)}
                    </Text>
                  </View>
                </View>
                <View style={resStyles.oiCountRow}>
                  <Text style={resStyles.oiCount}>{src.entryCount} {src.entryCount === 1 ? "entry" : "entries"}</Text>
                </View>
                <Text style={resStyles.oiSummary}>{src.summary}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Source citations */}
        {sourceCitations.length > 0 ? (
          <View style={resStyles.section}>
            <Text style={resStyles.sectionLabel}>SOURCE CITATIONS</Text>
            {sourceCitations.map((cite, i) => (
              <View key={i} style={resStyles.citeCard}>
                <LinearGradient
                  colors={["rgba(14,24,37,0.6)", "rgba(8,15,26,0.85)"]}
                  style={StyleSheet.absoluteFill}
                />
                <View style={resStyles.citeRow}>
                  <View style={resStyles.citeIcon}>
                    <ExternalLink color={palette.gold} size={12} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={resStyles.citeTitle} numberOfLines={2}>{cite.title}</Text>
                    {cite.publisher ? <Text style={resStyles.citePublisher}>{cite.publisher}</Text> : null}
                  </View>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* Evidence limitations */}
        {evidenceLimitations ? (
          <View style={resStyles.limitationsCard}>
            <LinearGradient
              colors={["rgba(255,181,71,0.06)", "rgba(8,15,26,0.7)"]}
              style={StyleSheet.absoluteFill}
            />
            <View style={resStyles.limitationsHeader}>
              <Info color={palette.gold} size={14} />
              <Text style={resStyles.limitationsTitle}>Evidence Limitations</Text>
            </View>
            <Text style={resStyles.limitationsText}>{evidenceLimitations}</Text>
          </View>
        ) : null}

        {/* Cost footer */}
        <View style={resStyles.costFooter}>
          <Zap color={palette.gold} size={12} />
          <Text style={resStyles.costFooterText}>{neuronCost} Neurons spent on this analysis</Text>
        </View>
      </ScrollView>

      {/* Sticky action bar */}
      <View style={resStyles.stickyBar}>
        <Pressable
          onPress={handleNewMatchup}
          style={({ pressed }) => [resStyles.newBtn, pressed && { opacity: 0.85 }]}
        >
          <Plus color={palette.cyan} size={16} />
          <Text style={resStyles.newBtnText}>New Matchup</Text>
        </Pressable>
        <Pressable
          onPress={handleRematch}
          style={({ pressed }) => [resStyles.rematchBtn, pressed && { opacity: 0.85 }]}
        >
          <LinearGradient
            colors={[palette.violet, "rgba(138,92,255,0.7)"]}
            style={StyleSheet.absoluteFill}
          />
          <RefreshCw color={palette.void} size={16} />
          <Text style={resStyles.rematchBtnText}>Rematch · {ARENA_NEURON_COST}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const resStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.void },
  scroll: { flex: 1 },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
  },
  backBtn: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  headerCenter: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerTitle: { color: palette.text, fontSize: 17, fontWeight: "900", letterSpacing: -0.3 },

  // Center / loading
  centerWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 30 },
  loadingText: { color: palette.muted, fontSize: 13, fontWeight: "700", marginTop: 12 },
  emptyTitle: { color: palette.text, fontSize: 20, fontWeight: "900", marginTop: 18, marginBottom: 8 },
  emptyText: { color: palette.muted, fontSize: 13, fontWeight: "700", textAlign: "center", marginBottom: 22 },
  emptyCta: { paddingVertical: 13, paddingHorizontal: 26, borderRadius: 8, overflow: "hidden" },
  emptyCtaText: { color: palette.void, fontSize: 14, fontWeight: "900", letterSpacing: 0.3 },

  // EAGOH context
  eagohContextRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  eagohContextLabel: { color: palette.violet, fontSize: 12, fontWeight: "900" },
  eagohContextDomain: { color: palette.muted, fontSize: 11, fontWeight: "700" },
  historyBadge: {
    marginLeft: 6,
    backgroundColor: "rgba(108,230,255,0.14)",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  historyBadgeText: { color: palette.cyan, fontSize: 9, fontWeight: "900", letterSpacing: 1 },

  // Verdict card
  verdictCard: {
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 18,
    alignItems: "center",
    overflow: "hidden",
    marginBottom: 18,
  },
  verdictIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(138,92,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    overflow: "hidden",
  },
  arenaTitle: { color: palette.text, fontSize: 18, fontWeight: "900", textAlign: "center", letterSpacing: -0.3, marginBottom: 12 },
  verdictBadge: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    marginBottom: 12,
  },
  verdictText: { fontSize: 15, fontWeight: "900", letterSpacing: 0.3 },
  confidenceRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  confidenceLabel: { color: palette.muted, fontSize: 10, fontWeight: "900", letterSpacing: 1.6 },
  confidenceValue: { fontSize: 16, fontWeight: "900" },
  disclaimer: { color: palette.muted, fontSize: 10, fontWeight: "700", fontStyle: "italic", textAlign: "center" },

  // Section
  section: { marginBottom: 18 },
  sectionLabel: {
    color: palette.gold,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 8,
  },

  // Summary cards
  summaryCard: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
    overflow: "hidden",
  },
  summaryName: { fontSize: 14, fontWeight: "900", marginBottom: 6 },
  summaryText: { color: palette.text, fontSize: 12, fontWeight: "700", lineHeight: 18 },

  // Legend
  legendRow: { flexDirection: "row", gap: 16, marginBottom: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: palette.muted, fontSize: 11, fontWeight: "800" },

  // Category score card
  catCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 12,
    marginBottom: 8,
    overflow: "hidden",
  },
  catHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  catLabel: { color: palette.text, fontSize: 13, fontWeight: "900", flex: 1 },
  catLeaderChip: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  catLeaderText: { fontSize: 11, fontWeight: "900" },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  scoreNum: { fontSize: 16, fontWeight: "900", width: 32, textAlign: "center" },
  scoreBars: { flex: 1, gap: 4 },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: "rgba(10,20,40,0.8)", overflow: "hidden" },
  barFillA: { height: 6, borderRadius: 3, alignSelf: "flex-start" },
  barFillB: { height: 6, borderRadius: 3, alignSelf: "flex-start" },
  catNotes: { color: palette.muted, fontSize: 10, fontWeight: "700", marginTop: 6, lineHeight: 15 },

  // Advantages
  advRow: { flexDirection: "row", gap: 8 },
  advCol: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    overflow: "hidden",
    minHeight: 60,
  },
  advColTitle: { fontSize: 12, fontWeight: "900", marginBottom: 8 },
  advItem: { flexDirection: "row", gap: 7, marginBottom: 6 },
  advDot: { width: 5, height: 5, borderRadius: 3, marginTop: 5 },
  advText: { color: palette.text, fontSize: 11, fontWeight: "700", flex: 1, lineHeight: 16 },

  // Bullet card
  bulletCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 12,
    overflow: "hidden",
  },
  bulletRow: { flexDirection: "row", gap: 8, marginBottom: 7 },
  bulletDot: { width: 5, height: 5, borderRadius: 3, marginTop: 6 },
  bulletText: { color: palette.text, fontSize: 12, fontWeight: "700", flex: 1, lineHeight: 17 },

  // OI influence
  oiCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 12,
    marginBottom: 8,
    overflow: "hidden",
  },
  oiHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  oiLabel: { color: palette.text, fontSize: 12, fontWeight: "900", flex: 1 },
  oiLeanChip: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 4,
    borderWidth: 1,
    backgroundColor: "rgba(10,20,40,0.6)",
  },
  oiLeanText: { fontSize: 9, fontWeight: "900", letterSpacing: 0.5 },
  oiCountRow: { marginBottom: 4 },
  oiCount: { color: palette.muted, fontSize: 10, fontWeight: "800" },
  oiSummary: { color: palette.text, fontSize: 11, fontWeight: "700", lineHeight: 16 },

  // Citations
  citeCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 10,
    marginBottom: 6,
    overflow: "hidden",
  },
  citeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  citeIcon: {
    width: 24,
    height: 24,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "rgba(255,181,71,0.30)",
    backgroundColor: "rgba(255,181,71,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  citeTitle: { color: palette.text, fontSize: 11, fontWeight: "800" },
  citePublisher: { color: palette.muted, fontSize: 10, fontWeight: "700", marginTop: 1 },

  // Limitations
  limitationsCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,181,71,0.25)",
    padding: 12,
    overflow: "hidden",
    marginBottom: 14,
  },
  limitationsHeader: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 7 },
  limitationsTitle: { color: palette.gold, fontSize: 12, fontWeight: "900" },
  limitationsText: { color: palette.muted, fontSize: 11, fontWeight: "700", lineHeight: 17 },

  // Cost footer
  costFooter: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 8 },
  costFooterText: { color: palette.muted, fontSize: 11, fontWeight: "800" },

  // Sticky bar
  stickyBar: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: palette.line,
    backgroundColor: palette.void,
  },
  newBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(108,230,255,0.35)",
    backgroundColor: "rgba(108,230,255,0.08)",
  },
  newBtnText: { color: palette.cyan, fontSize: 14, fontWeight: "900", letterSpacing: 0.3 },
  rematchBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    borderRadius: 8,
    overflow: "hidden",
  },
  rematchBtnText: { color: palette.void, fontSize: 14, fontWeight: "900", letterSpacing: 0.3 },
});
