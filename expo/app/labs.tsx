import { palette } from "@/constants/colors";
import { useAppTheme } from "@/providers/ThemeProvider";
import { HORIZONTAL_LIST_PERFORMANCE_PROPS, LIST_PERFORMANCE_PROPS } from "@/app/_components/PerformancePrimitives";
import { LinearGradient } from "expo-linear-gradient";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Activity,
  BrainCircuit,
  Check,
  ChevronRight,
  Crown,
  Eye,
  Footprints,
  Gem,
  Orbit,
  Radar,
  ScanFace,
  Shirt,
  MessageCircle,
  Send,
  SlidersHorizontal,
  Sparkles,
  Settings,
  Signal,
  TrendingUp,
  TrendingDown,
  Cpu,
  Zap,
  Target,
  Heart,
  Waves,
} from "lucide-react-native";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, DimensionValue, Easing, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEdge } from "@/providers/EdgeProvider";
import { getQuickCheckCost, runQuickCheck, runQuickAnalytics, runStandardSession, runDeepDive, type AnalystRequestKind, type AnalystCallError, type ConversationMessage } from "@/services/analyst";

type LabMode = "forge" | "intelligence" | "analyst";
type ForgeStep = "Identity" | "DNA" | "Teams" | "Body" | "Pose" | "Preview";
type OptionTone = "cyan" | "gold" | "violet" | "ember" | "success";
type ForgeOption = { id: string; label: string; detail?: string; tone: OptionTone };
type AppearanceCategory = { id: string; title: string; icon: React.ReactNode; options: ForgeOption[] };
type EntryDepth = "Quick" | "Basic" | "Advanced";
type ObservationType = { id: string; label: string; tone: OptionTone };
type SessionType = { id: string; name: string; cost: string; model: string; duration: string; mood: string; tone: OptionTone };
type ChatMessage = { id: string; sender: "user" | "analyst"; text: string; confidence?: number; cost?: number };
type AnalystResponse = { ok?: boolean; reply?: string; model?: string; error?: string };

function detectQuickCheckKind(prompt: string): AnalystRequestKind {
  const lower = prompt.toLowerCase();
  if (/(vs\.?|against|matchup|face off|faceoff)/.test(lower)) return "matchup";
  if (/(player|starter|qb|guard|forward|striker|pitcher|rb|wr|confidence|fatigue)/.test(lower)) return "player_confidence";
  if (/(team|roster|lineup|squad|franchise|defense|offense)/.test(lower)) return "team_analysis";
  return "general";
}

type ForgeState = {
  name: string;
  sport: string;
  gender: string;
  dna: string[];
  teams: string[];
  appearance: Record<string, string>;
  cyberneticIntensity: string;
  pose: string;
  lab: string;
};

type ObservationScore = {
  trustLevel: number;
  influenceStrength: number;
  validationScore: number;
  confidenceContribution: number;
};

const steps: ForgeStep[] = ["Identity", "DNA", "Teams", "Body", "Pose", "Preview"];
const entryDepths: { id: EntryDepth; max: number; detail: string; tone: OptionTone }[] = [
  { id: "Quick", max: 110, detail: "lightweight signal input", tone: "cyan" },
  { id: "Basic", max: 200, detail: "deeper human observation", tone: "gold" },
  { id: "Advanced", max: 400, detail: "high-context intelligence feed", tone: "violet" },
];

const sports: ForgeOption[] = [
  { id: "football", label: "Football", detail: "power reads + field command", tone: "gold" },
  { id: "basketball", label: "Basketball", detail: "tempo vision + clutch heat", tone: "cyan" },
  { id: "soccer", label: "Soccer", detail: "space mapping + pressure IQ", tone: "success" },
  { id: "baseball", label: "Baseball", detail: "pattern patience + precision", tone: "violet" },
];
const genders: ForgeOption[] = [
  { id: "masculine", label: "Masculine", tone: "cyan" },
  { id: "feminine", label: "Feminine", tone: "gold" },
  { id: "androgynous", label: "Androgynous", tone: "violet" },
  { id: "nonbinary", label: "Non-binary", tone: "success" },
];
const archetypes: ForgeOption[] = [
  { id: "oracle", label: "Oracle", detail: "predictive reads", tone: "cyan" },
  { id: "enforcer", label: "Enforcer", detail: "dominance signals", tone: "ember" },
  { id: "strategist", label: "Strategist", detail: "decision trees", tone: "violet" },
  { id: "icon", label: "Icon", detail: "fan magnetism", tone: "gold" },
  { id: "phantom", label: "Phantom", detail: "stealth edge", tone: "success" },
];
const fanaticTeams: ForgeOption[] = [
  { id: "austin", label: "Austin Fanatics", detail: "loyalty heat 92", tone: "cyan" },
  { id: "metro", label: "Metro Ultras", detail: "chant network active", tone: "gold" },
  { id: "north", label: "North End Loyal", detail: "heritage faction", tone: "success" },
  { id: "coastal", label: "Coastal Signal", detail: "rivalry pulse high", tone: "violet" },
];
const appearanceCategories: AppearanceCategory[] = [
  { id: "headwear", title: "Headwear", icon: <Crown color={palette.gold} size={18} />, options: [
    { id: "cowboy-hat", label: "Cowboy hat", tone: "gold" }, { id: "tactical-hood", label: "Tactical hood", tone: "ember" }, { id: "cyber-helmet", label: "Cyber helmet", tone: "cyan" }, { id: "sports-visor", label: "Sports visor", tone: "success" },
  ] },
  { id: "body", title: "Body", icon: <Shirt color={palette.cyan} size={18} />, options: [
    { id: "football-pads", label: "Football pads", tone: "gold" }, { id: "tactical-jacket", label: "Tactical jacket", tone: "ember" }, { id: "cyber-armor", label: "Cyber armor", tone: "cyan" }, { id: "sports-gear", label: "Sports gear", tone: "success" },
  ] },
  { id: "footwear", title: "Footwear", icon: <Footprints color={palette.success} size={18} />, options: [
    { id: "running-shoes", label: "Running shoes", tone: "success" }, { id: "tactical-boots", label: "Tactical boots", tone: "ember" }, { id: "futuristic-cleats", label: "Futuristic cleats", tone: "cyan" },
  ] },
  { id: "accessories", title: "Accessories", icon: <Gem color={palette.violet} size={18} />, options: [
    { id: "diamond-chains", label: "Diamond chains", tone: "gold" }, { id: "watches", label: "Watches", tone: "cyan" }, { id: "rings", label: "Rings", tone: "violet" }, { id: "pendants", label: "Pendants", tone: "success" }, { id: "visors", label: "Visors", tone: "ember" },
  ] },
];
const intensities: ForgeOption[] = [
  { id: "minimal", label: "Minimal", detail: "subtle neural seams", tone: "success" }, { id: "moderate", label: "Moderate", detail: "visible optic glow", tone: "cyan" }, { id: "heavy", label: "Heavy", detail: "reinforced limbs", tone: "gold" }, { id: "assimilated", label: "Assimilated", detail: "full machine myth", tone: "violet" },
];
const poses: ForgeOption[] = [
  { id: "arms-crossed", label: "Arms crossed", detail: "unshaken authority", tone: "gold" }, { id: "strategist-stance", label: "Strategist stance", detail: "mid-call calculation", tone: "violet" }, { id: "relaxed-confidence", label: "Relaxed confidence", detail: "premium calm", tone: "success" }, { id: "tactical-stance", label: "Tactical stance", detail: "ready to deploy", tone: "cyan" },
];
const labs: ForgeOption[] = [
  { id: "neon-vault", label: "Neon Vault", detail: "identity calibration", tone: "cyan" }, { id: "obsidian-bay", label: "Obsidian Bay", detail: "armor diagnostics", tone: "violet" }, { id: "gold-ring", label: "Gold Ring", detail: "fanatic resonance", tone: "gold" },
];
const observationTypes: ObservationType[] = [
  { id: "fatigue", label: "Fatigue", tone: "gold" }, { id: "injury-concern", label: "Injury concern", tone: "ember" }, { id: "crowd-pressure", label: "Crowd pressure", tone: "violet" }, { id: "rivalry", label: "Rivalry", tone: "ember" }, { id: "momentum", label: "Momentum", tone: "success" }, { id: "coaching-decisions", label: "Coaching decisions", tone: "cyan" }, { id: "emotional-instability", label: "Emotional instability", tone: "violet" }, { id: "media-pressure", label: "Media pressure", tone: "gold" }, { id: "defensive-weakness", label: "Defensive weakness", tone: "ember" }, { id: "offensive-inconsistency", label: "Offensive inconsistency", tone: "cyan" }, { id: "weather-influence", label: "Weather influence", tone: "success" }, { id: "lineup-chemistry", label: "Lineup chemistry", tone: "gold" },
];
const sessionTypes: SessionType[] = [
  { id: "quick-check", name: "Quick Check", cost: "1-3 Neurons", model: "Pulse-Lite", duration: "2 min", mood: "Alert + concise", tone: "cyan" },
  { id: "quick-analytics", name: "Quick Analytics", cost: "12 Neurons", model: "Tactic-Core", duration: "6 min", mood: "Tactical + calm", tone: "gold" },
  { id: "standard", name: "Standard Session", cost: "20 Neurons", model: "EAGOH Analyst", duration: "15 min", mood: "Emotionally aware", tone: "success" },
  { id: "oracle", name: "Oracle Deep Dive", cost: "40 Neurons", model: "Oracle-Synapse", duration: "30 min", mood: "Deep strategic", tone: "violet" },
];
const suggestedPrompts: string[] = ["Run a rivalry pressure read", "Explain the confidence shift", "What memory should I watch?", "Build a 5-day tactical forecast"];
const memoryCards = [
  { id: "m1", title: "Crowd pressure pattern", detail: "Late-game noise affects defensive substitutions.", score: "92%" },
  { id: "m2", title: "Fatigue marker", detail: "Starter workload spikes after travel compression.", score: "86%" },
];
const initialChatMessages: ChatMessage[] = [
  { id: "c1", sender: "analyst", text: "I’m reading the signal with tactical caution. Momentum is real, but emotional volatility is the risk pocket.", confidence: 91 },
  { id: "c2", sender: "user", text: "Should I trust the late-game edge?" },
  { id: "c3", sender: "analyst", text: "Trust it conditionally. The edge strengthens if lineup chemistry stays stable through the first pressure swing.", confidence: 88 },
];
const functionsBaseUrl = process.env.EXPO_PUBLIC_RORK_FUNCTIONS_URL;

function toneColor(tone: OptionTone): string {
  if (tone === "gold") return palette.gold;
  if (tone === "violet") return palette.violet;
  if (tone === "ember") return palette.ember;
  if (tone === "success") return palette.success;
  return palette.cyan;
}
function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }): JSX.Element {
  return <View style={styles.sectionTitle}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.sectionHeading}>{title}</Text></View>;
}
const OptionChip = memo(function OptionChip({ option, selected, onPress }: { option: ForgeOption; selected: boolean; onPress: (id: string) => void }): JSX.Element {
  const h = useHaptics();
  const accent = toneColor(option.tone);
  const handlePress = useCallback((): void => { h.selection(); onPress(option.id); }, [onPress, option.id, h]);
  return <Pressable onPress={handlePress} style={({ pressed }) => [styles.optionChip, selected && { borderColor: accent, backgroundColor: `${accent}18` }, pressed && styles.pressed]}><View style={[styles.optionDot, { backgroundColor: selected ? accent : "rgba(255,255,255,0.16)" }]} /><View style={styles.optionCopy}><Text style={[styles.optionLabel, selected && { color: accent }]}>{option.label}</Text>{option.detail ? <Text style={styles.optionDetail}>{option.detail}</Text> : null}</View>{selected ? <Check color={accent} size={16} /> : null}</Pressable>;
});
function TransparentMockRender({ state }: { state: ForgeState }): JSX.Element {
  const intensityColor = toneColor(intensities.find((item) => item.id === state.cyberneticIntensity)?.tone ?? "cyan");
  return <View style={styles.renderStage}><Text style={styles.renderBadge}>TRANSPARENT MOCK RENDER</Text><View style={styles.haloOuter} /><View style={styles.avatarHead}><ScanFace color={intensityColor} size={36} /></View><View style={styles.avatarTorso}><LinearGradient colors={[`${intensityColor}42`, "rgba(255,255,255,0.04)"]} style={StyleSheet.absoluteFill} /><BrainCircuit color={palette.text} size={34} /></View><View style={styles.avatarLegs}><View style={[styles.avatarLeg, { backgroundColor: `${intensityColor}66` }]} /><View style={[styles.avatarLeg, { backgroundColor: `${intensityColor}44` }]} /></View><Text style={styles.renderName}>{state.name || "Unnamed EAGOH"}</Text><Text style={styles.renderMeta}>{state.pose.replace(/-/g, " ")} · no background scene</Text></View>;
}
function getScore(text: string, selectedTypes: string[], depth: EntryDepth): ObservationScore {
  const base = depth === "Advanced" ? 26 : depth === "Basic" ? 18 : 10;
  const lengthBoost = Math.min(34, Math.floor(text.trim().length / (depth === "Advanced" ? 9 : depth === "Basic" ? 7 : 5)));
  const typeBoost = Math.min(20, selectedTypes.length * 4);
  return {
    trustLevel: Math.min(99, base + lengthBoost + typeBoost + 18),
    influenceStrength: Math.min(96, base + lengthBoost + selectedTypes.length * 5 + 10),
    validationScore: Math.min(94, 42 + selectedTypes.length * 3 + Math.floor(text.trim().split(/\s+/).filter(Boolean).length / 2)),
    confidenceContribution: Math.min(91, base + Math.floor(lengthBoost * 1.15) + 12),
  };
}
function ScoreBar({ label, value, color }: { label: string; value: number; color: string }): JSX.Element {
  return <View style={styles.scoreRow}><View style={styles.scoreTop}><Text style={styles.scoreLabel}>{label}</Text><Text style={[styles.scoreValue, { color }]}>{value}%</Text></View><View style={styles.scoreTrack}><View style={[styles.scoreFill, { width: `${value}%`, backgroundColor: color }]} /></View></View>;
}
function TypingDots(): JSX.Element {
  return <View style={styles.typingDots}><View style={styles.dot} /><View style={[styles.dot, styles.dotMid]} /><View style={styles.dot} /></View>;
}

type AnalyticsBar = { label: string; value: number; sign: "+" | "-"; color: string };
const analyticsBars: AnalyticsBar[] = [
  { label: "Prediction Confidence", value: 210, sign: "+", color: palette.cyan },
  { label: "Pattern Recognition", value: 175, sign: "+", color: palette.success },
  { label: "Volatility Detection", value: 22, sign: "-", color: palette.ember },
  { label: "Momentum Tracking", value: 143, sign: "+", color: palette.gold },
];

const ForgeDashboard = memo(function ForgeDashboard({ stepIndex, totalSteps, completion }: { stepIndex: number; totalSteps: number; completion: string }): JSX.Element {
  const pulse = useRef(new Animated.Value(0)).current;
  const scan = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;
  const bars = useRef(analyticsBars.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    const scanLoop = Animated.loop(Animated.timing(scan, { toValue: 1, duration: 3400, easing: Easing.linear, useNativeDriver: true }));
    const shimmerLoop = Animated.loop(Animated.timing(shimmer, { toValue: 1, duration: 4200, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    scanLoop.start();
    shimmerLoop.start();
    Animated.stagger(120, bars.map((bar, i) => Animated.timing(bar, { toValue: 1, duration: 900 + i * 100, easing: Easing.out(Easing.cubic), useNativeDriver: false }))).start();
    return () => { loop.stop(); scanLoop.stop(); shimmerLoop.stop(); };
  }, [pulse, scan, shimmer, bars]);

  const haloScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.95] });
  const coreOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });
  const scanY = scan.interpolate({ inputRange: [0, 1], outputRange: [-10, 240] });
  const shimmerX = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-220, 320] });

  return (
    <View style={dashStyles.wrap}>
      <View style={dashStyles.headerBar}>
        <View style={dashStyles.signalChip}>
          <Animated.View style={[dashStyles.signalDot, { opacity: coreOpacity }]} />
          <Signal color={palette.cyan} size={12} />
          <Text style={dashStyles.signalText}>AI LINK</Text>
        </View>
        <View style={dashStyles.headerCenter}>
          <Text style={dashStyles.brandTitle}>EAGOH</Text>
          <View style={dashStyles.statusRow}>
            <View style={dashStyles.statusDot} />
            <Text style={dashStyles.statusText}>FORGE ONLINE</Text>
          </View>
        </View>
        <View style={dashStyles.settingsChip}>
          <Settings color={palette.cyan} size={16} />
        </View>
      </View>

      <View style={dashStyles.chamber}>
        <LinearGradient colors={["rgba(54,245,255,0.10)", "rgba(3,6,11,0.0)", "rgba(124,92,255,0.10)"]} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
        <View style={dashStyles.gridLinesV} pointerEvents="none">
          {Array.from({ length: 6 }).map((_, i) => <View key={`v${i}`} style={[dashStyles.gridV, { left: `${(i + 1) * 14}%` }]} />)}
        </View>
        <View style={dashStyles.gridLinesH} pointerEvents="none">
          {Array.from({ length: 5 }).map((_, i) => <View key={`h${i}`} style={[dashStyles.gridH, { top: `${(i + 1) * 16}%` }]} />)}
        </View>

        <Animated.View style={[dashStyles.scanLine, { transform: [{ translateY: scanY }] }]} pointerEvents="none">
          <LinearGradient colors={["rgba(54,245,255,0)", "rgba(54,245,255,0.55)", "rgba(54,245,255,0)"]} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} />
        </Animated.View>

        <View style={dashStyles.chamberHeader}>
          <Text style={dashStyles.chamberEyebrow}>FORGE SESSION</Text>
          <View style={dashStyles.chamberStatus}>
            <Cpu color={palette.success} size={10} />
            <Text style={dashStyles.chamberStatusText}>CORE ACTIVE</Text>
          </View>
        </View>

        <View style={dashStyles.chamberMain}>
          <View style={dashStyles.brainCol}>
            <View style={dashStyles.brainStage}>
              <Animated.View style={[dashStyles.brainHaloOuter, { transform: [{ scale: haloScale }], opacity: haloOpacity }]} />
              <Animated.View style={[dashStyles.brainHaloMid, { transform: [{ scale: haloScale }], opacity: haloOpacity }]} />
              <View style={dashStyles.brainHaloInner} />
              <Animated.View style={[dashStyles.brainCore, { opacity: coreOpacity }]}>
                <LinearGradient colors={["rgba(54,245,255,0.35)", "rgba(124,92,255,0.30)", "rgba(3,6,11,0.0)"]} style={StyleSheet.absoluteFill} />
                <BrainCircuit color={palette.cyan} size={72} />
              </Animated.View>
              <Animated.View style={[dashStyles.shimmer, { transform: [{ translateX: shimmerX }] }]} pointerEvents="none">
                <LinearGradient colors={["rgba(255,255,255,0)", "rgba(54,245,255,0.18)", "rgba(255,255,255,0)"]} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} />
              </Animated.View>
              <View style={[dashStyles.neuralNode, { top: 22, left: 18, backgroundColor: palette.cyan }]} />
              <View style={[dashStyles.neuralNode, { top: 40, right: 24, backgroundColor: palette.violet }]} />
              <View style={[dashStyles.neuralNode, { bottom: 38, left: 30, backgroundColor: palette.success }]} />
              <View style={[dashStyles.neuralNode, { bottom: 22, right: 18, backgroundColor: palette.gold }]} />
            </View>

            <Text style={dashStyles.metricLabel}>EDGE GENERATION</Text>
            <View style={dashStyles.metricRow}>
              <Text style={dashStyles.metricBig}>+18.7%</Text>
              <TrendingUp color={palette.success} size={22} />
            </View>
            <Text style={dashStyles.metricSub}>AI Confidence Increasing</Text>
          </View>

          <View style={dashStyles.sideCol}>
            <SideMetric icon={<Waves color={palette.cyan} size={12} />} label="DATA TEMP" value="2°C" tint={palette.cyan} />
            <SideMetric icon={<Activity color={palette.success} size={12} />} label="SYNC RATE" value="98%" tint={palette.success} />
            <SideMetric icon={<Zap color={palette.gold} size={12} />} label="MARKET FLOW" value="LIVE" tint={palette.gold} pulse />
            <SideMetric icon={<Target color={palette.violet} size={12} />} label="FOCUS LOCK" value={`${Math.round(((stepIndex + 1) / totalSteps) * 100)}%`} tint={palette.violet} />
          </View>
        </View>
      </View>

      <View style={dashStyles.analyticsCard}>
        <View style={dashStyles.analyticsHead}>
          <View>
            <Text style={dashStyles.analyticsEyebrow}>AI ANALYTICS RESPONSE</Text>
            <Text style={dashStyles.analyticsTitle}>Neural diagnostics</Text>
          </View>
          <View style={dashStyles.analyticsBadge}>
            <Sparkles color={palette.cyan} size={12} />
            <Text style={dashStyles.analyticsBadgeText}>{completion}</Text>
          </View>
        </View>
        {analyticsBars.map((bar, i) => {
          const width = bars[i].interpolate({ inputRange: [0, 1], outputRange: ["0%", `${Math.min(100, bar.value / 2.2)}%`] });
          const TrendIcon = bar.sign === "+" ? TrendingUp : TrendingDown;
          return (
            <View key={bar.label} style={dashStyles.barRow}>
              <View style={dashStyles.barTop}>
                <Text style={dashStyles.barLabel}>{bar.label}</Text>
                <View style={dashStyles.barValueWrap}>
                  <TrendIcon color={bar.color} size={12} />
                  <Text style={[dashStyles.barValue, { color: bar.color }]}>{bar.sign}{bar.value}%</Text>
                </View>
              </View>
              <View style={dashStyles.barTrack}>
                <Animated.View style={[dashStyles.barFill, { width, backgroundColor: bar.color, shadowColor: bar.color }]} />
              </View>
            </View>
          );
        })}
      </View>

      <View style={dashStyles.perfRow}>
        <PerfCard label="EDGE" value="92" status="Elite" tint={palette.cyan} icon={<Zap color={palette.cyan} size={14} />} />
        <PerfCard label="FOCUS" value="89" status="Locked In" tint={palette.violet} icon={<Target color={palette.violet} size={14} />} />
        <PerfCard label="RECOVERY" value="94%" status="Optimal" tint={palette.success} icon={<Heart color={palette.success} size={14} />} />
      </View>

      <View style={dashStyles.bottomStats}>
        <BottomStat label="TOTAL ANALYSES" value="23,450" />
        <View style={dashStyles.bottomStatDivider} />
        <BottomStat label="STREAK" value="7 Days" tint={palette.gold} />
        <View style={dashStyles.bottomStatDivider} />
        <BottomStat label="XP EARNED" value="245K" tint={palette.success} />
      </View>
    </View>
  );
});

function SideMetric({ icon, label, value, tint, pulse: shouldPulse }: { icon: React.ReactNode; label: string; value: string; tint: string; pulse?: boolean }): JSX.Element {
  const blink = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!shouldPulse) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(blink, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(blink, { toValue: 0, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [blink, shouldPulse]);
  const liveOpacity = shouldPulse ? blink.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) : 1;
  return (
    <View style={[dashStyles.sideMetric, { borderColor: `${tint}38` }]}>
      <View style={dashStyles.sideMetricTop}>{icon}<Text style={dashStyles.sideMetricLabel}>{label}</Text></View>
      <Animated.Text style={[dashStyles.sideMetricValue, { color: tint, opacity: liveOpacity }]}>{value}</Animated.Text>
    </View>
  );
}

function PerfCard({ label, value, status, tint, icon }: { label: string; value: string; status: string; tint: string; icon: React.ReactNode }): JSX.Element {
  return (
    <View style={[dashStyles.perfCard, { borderColor: `${tint}3A` }]}>
      <LinearGradient colors={[`${tint}1F`, "rgba(3,6,11,0.0)"]} style={StyleSheet.absoluteFill} />
      <View style={dashStyles.perfTop}>{icon}<Text style={dashStyles.perfLabel}>{label}</Text></View>
      <Text style={[dashStyles.perfValue, { color: tint }]}>{value}</Text>
      <PerfMicroGraph tint={tint} />
      <Text style={dashStyles.perfStatus}>{status}</Text>
    </View>
  );
}

function PerfMicroGraph({ tint }: { tint: string }): JSX.Element {
  const heights = useMemo(() => [40, 55, 35, 65, 50, 70, 60, 80, 70, 90], []);
  return (
    <View style={dashStyles.microGraph}>
      {heights.map((h, i) => (
        <View key={i} style={[dashStyles.microBar, { height: `${h}%`, backgroundColor: i === heights.length - 1 ? tint : `${tint}66` }]} />
      ))}
    </View>
  );
}

function BottomStat({ label, value, tint }: { label: string; value: string; tint?: string }): JSX.Element {
  return (
    <View style={dashStyles.bottomStat}>
      <Text style={dashStyles.bottomStatLabel}>{label}</Text>
      <Text style={[dashStyles.bottomStatValue, tint ? { color: tint } : null]}>{value}</Text>
    </View>
  );
}

export default function LabsScreen(): JSX.Element {
  const { palette: pal } = useAppTheme();
  const h = useHaptics();
  const [mode, setMode] = useState<LabMode>("analyst");
  const [activeStep, setActiveStep] = useState<ForgeStep>("Identity");
  const [depth, setDepth] = useState<EntryDepth>("Quick");
  const [observation, setObservation] = useState<string>("Starter guard looks fatigued during rivalry road games; crowd pressure changes late defensive rotations.");
  const [selectedTypes, setSelectedTypes] = useState<string[]>(["fatigue", "crowd-pressure", "defensive-weakness"]);
  const [selectedSession, setSelectedSession] = useState<string>("standard");
  const [draftPrompt, setDraftPrompt] = useState<string>("What should I watch before the next rivalry window?");
  const [messages, setMessages] = useState<ChatMessage[]>(initialChatMessages);
  const [isAnalystTyping, setIsAnalystTyping] = useState<boolean>(false);
  const [analystError, setAnalystError] = useState<string | null>(null);
  const [connectedModel, setConnectedModel] = useState<string>("gpt-4o-mini");
  const { deductQuickCheck, total: edgeTotal, isMutating: isEdgeMutating } = useEdge();
  const [forgeState, setForgeState] = useState<ForgeState>({ name: "Apex Cipher", sport: "football", gender: "androgynous", dna: ["oracle", "icon"], teams: ["austin"], appearance: { headwear: "cyber-helmet", body: "cyber-armor", footwear: "futuristic-cleats", accessories: "diamond-chains" }, cyberneticIntensity: "moderate", pose: "strategist-stance", lab: "neon-vault" });
  const stepIndex = steps.indexOf(activeStep);
  const completion = useMemo((): string => `${Math.round(((stepIndex + 1) / steps.length) * 100)}%`, [stepIndex]);
  const maxLength = entryDepths.find((item) => item.id === depth)?.max ?? 110;
  const scores = useMemo((): ObservationScore => getScore(observation, selectedTypes, depth), [observation, selectedTypes, depth]);
  const setSingle = useCallback((key: keyof ForgeState, value: string): void => { setForgeState((current) => ({ ...current, [key]: value })); }, []);
  const toggleList = useCallback((key: "dna" | "teams", value: string): void => { setForgeState((current) => ({ ...current, [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value] })); }, []);
  const setAppearance = useCallback((categoryId: string, optionId: string): void => { setForgeState((current) => ({ ...current, appearance: { ...current.appearance, [categoryId]: optionId } })); }, []);
  const goNext = useCallback((): void => { setActiveStep(steps[Math.min(stepIndex + 1, steps.length - 1)]); }, [stepIndex]);
  const goBack = useCallback((): void => { setActiveStep(steps[Math.max(stepIndex - 1, 0)]); }, [stepIndex]);
  const toggleObservationType = useCallback((id: string): void => { h.selection(); setSelectedTypes((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }, [h]);
  const handleDepth = useCallback((nextDepth: EntryDepth): void => { h.selection(); const nextMax = entryDepths.find((item) => item.id === nextDepth)?.max ?? 110; setDepth(nextDepth); setObservation((current) => current.slice(0, nextMax)); }, [h]);
  const handleSendPrompt = useCallback(async (): Promise<void> => {
    const prompt = draftPrompt.trim();
    if (!prompt || isAnalystTyping || isEdgeMutating) return;
    h.selection();
    setAnalystError(null);

    // ---- Quick Check path: live OpenAI via secure server — Edge deducted ONLY on success ----
    if (selectedSession === "quick-check") {
      const cost = getQuickCheckCost(prompt);
      if (edgeTotal < cost) {
        setAnalystError(`Insufficient Neurons. Quick Check needs ${cost} Neurons (have ${edgeTotal}).`);
        return;
      }
      const kind = detectQuickCheckKind(prompt);
      setDraftPrompt("");
      setMessages((current) => [...current, { id: `u-${Date.now()}`, sender: "user", text: prompt }]);
      setIsAnalystTyping(true);

      // Build conversation context from memory cards
      const memoryContext: ConversationMessage[] = memoryCards.map((item) => ({
        role: "user" as const,
        content: `${item.title}: ${item.detail}`,
      }));

      // Call analyst FIRST — do NOT deduct Edge until we know the call succeeded
      const result = await runQuickCheck({
        prompt,
        eagohId: null,
        kind,
        personality: "tactical",
        conversationContext: memoryContext,
      });

      if (!result.ok) {
        // Analyst failed — do NOT deduct Edge
        setAnalystError(result.error);
        setMessages((current) => [...current, { id: `a-${Date.now()}`, sender: "analyst", text: result.fallback, confidence: 72 }]);
        setIsAnalystTyping(false);
        return;
      }

      // Analyst succeeded — now deduct Edge
      try {
        await deductQuickCheck(prompt, `Quick Check (${kind}) · ${cost} Neurons`);
      } catch (deductionErr) {
        console.warn("Neuron deduction failed after successful analyst call", deductionErr instanceof Error ? deductionErr.message : deductionErr);
        // Still show the reply — Edge deduction is a secondary concern
        setConnectedModel(result.model);
        setMessages((current) => [...current, { id: `a-${Date.now()}`, sender: "analyst", text: result.reply, confidence: result.confidence }]);
        setAnalystError("Neuron deduction failed, but here's your analysis.");
        setIsAnalystTyping(false);
        return;
      }

      setConnectedModel(result.model);
      setMessages((current) => [...current, { id: `a-${Date.now()}`, sender: "analyst", text: result.reply, confidence: result.confidence, cost }]);
      setIsAnalystTyping(false);
      return;
    }

    // ---- Other session types: use error-aware analyst wrappers ----
    setDraftPrompt("");
    setMessages((current) => [...current, { id: `u-${Date.now()}`, sender: "user", text: prompt }]);
    setIsAnalystTyping(true);

    const memoryContext: ConversationMessage[] = memoryCards.map((item) => ({
      role: "user" as const,
      content: `${item.title}: ${item.detail}`,
    }));
    let result: Awaited<ReturnType<typeof runQuickCheck>>;
    if (selectedSession === "quick-analysis") {
      result = await runQuickAnalytics({ prompt, eagohId: null, kind: "general", personality: "calm", conversationContext: memoryContext });
    } else if (selectedSession === "oracle") {
      result = await runDeepDive({ prompt, eagohId: null, kind: "general", personality: "oracle", conversationContext: memoryContext });
    } else {
      result = await runStandardSession({ prompt, eagohId: null, kind: "general", personality: "calm", conversationContext: memoryContext });
    }

    if (result.ok) {
      setConnectedModel(result.model);
      setMessages((current) => [...current, { id: `a-${Date.now()}`, sender: "analyst", text: result.reply, confidence: result.confidence }]);
    } else {
      setAnalystError(result.error);
      setMessages((current) => [...current, { id: `a-${Date.now()}`, sender: "analyst", text: result.fallback, confidence: 74 }]);
    }
    setIsAnalystTyping(false);
  }, [draftPrompt, isAnalystTyping, isEdgeMutating, selectedSession, edgeTotal, deductQuickCheck]);

  const renderStep = (): JSX.Element => {
    if (activeStep === "Identity") return <View style={styles.stepPanel}><SectionTitle eyebrow="01 / IDENTITY" title="Name the intelligence entity." /><TextInput value={forgeState.name} onChangeText={(value) => setSingle("name", value)} placeholder="Enter EAGOH name" placeholderTextColor={palette.muted} style={styles.input} /><SectionTitle eyebrow="SPORT MATRIX" title="Select a primary sport." /><View style={styles.gridList}>{sports.map((item) => <OptionChip key={item.id} option={item} selected={forgeState.sport === item.id} onPress={(id) => setSingle("sport", id)} />)}</View><SectionTitle eyebrow="FORM FACTOR" title="Choose gender expression." /><View style={styles.gridList}>{genders.map((item) => <OptionChip key={item.id} option={item} selected={forgeState.gender === item.id} onPress={(id) => setSingle("gender", id)} />)}</View></View>;
    if (activeStep === "DNA") return <View style={styles.stepPanel}><SectionTitle eyebrow="02 / DNA ARCHETYPES" title="Stack the behavioral code." />{archetypes.map((item) => <OptionChip key={item.id} option={item} selected={forgeState.dna.includes(item.id)} onPress={(id) => toggleList("dna", id)} />)}<SectionTitle eyebrow="CYBERNETIC INTENSITY" title="Define the machine ratio." />{intensities.map((item) => <OptionChip key={item.id} option={item} selected={forgeState.cyberneticIntensity === item.id} onPress={(id) => setSingle("cyberneticIntensity", id)} />)}</View>;
    if (activeStep === "Teams") return <View style={styles.stepPanel}><SectionTitle eyebrow="03 / FANATIC TEAMS" title="Bind mock team affinities." /><Text style={styles.notice}>No team logos or copyrighted imagery are used. These are fictional mock affinity labels.</Text>{fanaticTeams.map((item) => <OptionChip key={item.id} option={item} selected={forgeState.teams.includes(item.id)} onPress={(id) => toggleList("teams", id)} />)}</View>;
    if (activeStep === "Body") return <View style={styles.stepPanel}><SectionTitle eyebrow="04 / APPEARANCE" title="Forge the premium silhouette." />{appearanceCategories.map((category) => <View key={category.id} style={styles.categoryCard}><View style={styles.categoryHeader}>{category.icon}<Text style={styles.categoryTitle}>{category.title}</Text></View>{category.options.map((item) => <OptionChip key={item.id} option={item} selected={forgeState.appearance[category.id] === item.id} onPress={(id) => setAppearance(category.id, id)} />)}</View>)}</View>;
    if (activeStep === "Pose") return <View style={styles.stepPanel}><SectionTitle eyebrow="05 / FIXED POSE" title="Lock the render stance." />{poses.map((item) => <OptionChip key={item.id} option={item} selected={forgeState.pose === item.id} onPress={(id) => setSingle("pose", id)} />)}<SectionTitle eyebrow="LAB PREVIEW" title="Choose the selected lab." />{labs.map((item) => <OptionChip key={item.id} option={item} selected={forgeState.lab === item.id} onPress={(id) => setSingle("lab", id)} />)}</View>;
    return <View style={styles.stepPanel}><SectionTitle eyebrow="06 / FINAL REVIEW" title="Preview selected lab and forged identity." /><TransparentMockRender state={forgeState} /><View style={styles.summaryCard}><Text style={styles.summaryTitle}>{forgeState.name}</Text><Text style={styles.summaryText}>Sport: {forgeState.sport} · Gender: {forgeState.gender}</Text><Text style={styles.summaryText}>DNA: {forgeState.dna.join(" + ")}</Text><Text style={styles.summaryText}>Teams: {forgeState.teams.length} selected · Lab: {forgeState.lab}</Text><Text style={styles.summaryText}>Appearance uses transparent mock render layers only.</Text></View></View>;
  };

  const renderAnalystChat = (): JSX.Element => {
    const activeSession = sessionTypes.find((item) => item.id === selectedSession) ?? sessionTypes[0];
    const accent = toneColor(activeSession.tone);
    return <View style={styles.intelWrap}>
      <View style={styles.chatHero}><View><Text style={styles.kicker}>EAGOH ANALYST</Text><Text style={styles.title}>Oracle Channel</Text></View><View style={[styles.moodOrb, { borderColor: accent }]}><MessageCircle color={accent} size={24} /></View><Text style={styles.heroText}>Secure analyst chat now routes through the private EAGOH server path. If the service is unavailable, the chamber falls back safely to local tactical responses.</Text><View style={styles.personalityStrip}><Text style={[styles.personalityText, { color: accent }]}>{activeSession.mood}</Text><Text style={styles.personalityText}>Confidence 91%</Text><Text style={styles.personalityText}>Model {connectedModel}</Text></View></View>
      <View style={styles.sessionGrid}>{sessionTypes.map((item) => { const selected = item.id === selectedSession; const itemAccent = toneColor(item.tone); return <Pressable key={item.id} onPress={() => { h.selection(); setSelectedSession(item.id); }} style={[styles.sessionCard, selected && { borderColor: itemAccent, backgroundColor: `${itemAccent}16` }]}><View style={styles.sessionTop}><Text style={[styles.sessionName, selected && { color: itemAccent }]}>{item.name}</Text><Text style={[styles.sessionCost, { color: itemAccent }]}>{item.cost}</Text></View><Text style={styles.sessionMeta}>{item.model} · {item.duration}</Text><Text style={styles.sessionMood}>{item.mood}</Text></Pressable>; })}</View>
      <View style={styles.chatPanel}><View style={styles.chatPanelHeader}><View><Text style={styles.eyebrow}>SECURE ANALYST SESSION</Text><Text style={styles.sectionHeading}>{activeSession.model}</Text></View><View style={[styles.confidencePill, { borderColor: accent }]}><Sparkles color={accent} size={14} /><Text style={[styles.confidenceText, { color: accent }]}>91%</Text></View></View>{messages.map((message) => { const isAnalyst = message.sender === "analyst"; return <View key={message.id} style={[styles.messageBubble, isAnalyst ? styles.analystBubble : styles.userBubble]}><Text style={isAnalyst ? styles.analystText : styles.userText}>{message.text}</Text>{message.confidence ? <Text style={[styles.messageConfidence, { color: accent }]}>Analyst confidence {message.confidence}%</Text> : null}</View>; })}{isAnalystTyping ? <View style={styles.typingRow}><TypingDots /><Text style={styles.typingText}>Analyst is forming a tactical response...</Text></View> : null}{analystError ? <Text style={styles.errorText}>{analystError}</Text> : null}</View>
      <View style={styles.stepPanel}><SectionTitle eyebrow="MEMORY PREVIEWS" title="Context cards ready for the analyst." />{memoryCards.map((item) => <View key={item.id} style={styles.memoryCard}><View><Text style={styles.memoryTitle}>{item.title}</Text><Text style={styles.memoryDetail}>{item.detail}</Text></View><Text style={styles.memoryScore}>{item.score}</Text></View>)}</View>
      <View style={styles.stepPanel}><SectionTitle eyebrow="SUGGESTED PROMPTS" title="Start with a tactical question." /><View style={styles.typeGrid}>{suggestedPrompts.map((prompt) => <Pressable key={prompt} onPress={() => setDraftPrompt(prompt)} style={styles.promptChip}><Text style={styles.typeLabel}>{prompt}</Text></Pressable>)}</View><View style={styles.composer}><TextInput value={draftPrompt} onChangeText={setDraftPrompt} placeholder="Ask your EAGOH analyst..." placeholderTextColor={palette.muted} style={styles.composerInput} editable={!isAnalystTyping} /><Pressable onPress={handleSendPrompt} disabled={isAnalystTyping || !draftPrompt.trim()} style={[styles.sendButton, { backgroundColor: accent }, (isAnalystTyping || !draftPrompt.trim()) && styles.disabledButton]}><Send color={palette.void} size={18} /></Pressable></View><Text style={styles.notice}>OpenAI is called only through the secure server route. No API key is stored in the mobile app and no real Edge is deducted yet.</Text></View>
    </View>;
  };

  const renderOpenIntelligence = (): JSX.Element => (
    <View style={styles.intelWrap}>
      <View style={styles.intelHero}><View><Text style={styles.kicker}>OPEN INTELLIGENCE</Text><Text style={styles.title}>Observation Feed</Text></View><View style={styles.orbit}><Radar color={palette.cyan} size={24} /></View><Text style={styles.heroText}>Feed human observations into your EAGOH with local mock scoring only. No AI processing, APIs, or backend connection.</Text></View>
      <View style={styles.depthRow}>{entryDepths.map((item) => { const selected = item.id === depth; const accent = toneColor(item.tone); return <Pressable key={item.id} onPress={() => handleDepth(item.id)} style={[styles.depthCard, selected && { borderColor: accent, backgroundColor: `${accent}16` }]}><Text style={[styles.depthTitle, selected && { color: accent }]}>{item.id}</Text><Text style={styles.depthDetail}>{item.max} char max</Text><Text style={styles.depthFine}>{item.detail}</Text></Pressable>; })}</View>
      <View style={styles.stepPanel}><SectionTitle eyebrow={`${depth.toUpperCase()} ENTRY`} title="Feed a field observation." /><TextInput value={observation} onChangeText={(value) => setObservation(value.slice(0, maxLength))} multiline maxLength={maxLength} placeholder="Enter observation signal..." placeholderTextColor={palette.muted} style={styles.observationInput} /><View style={styles.charRow}><Text style={styles.noticeInline}>{depth === "Quick" ? "Quick Observation" : `${depth} Deep Entry`}</Text><Text style={[styles.charCount, observation.length > maxLength * 0.9 && { color: palette.gold }]}>{observation.length}/{maxLength}</Text></View></View>
      <View style={styles.stepPanel}><SectionTitle eyebrow="OBSERVATION TYPES" title="Classify the signal." /><View style={styles.typeGrid}>{observationTypes.map((item) => { const selected = selectedTypes.includes(item.id); const accent = toneColor(item.tone); return <Pressable key={item.id} onPress={() => toggleObservationType(item.id)} style={[styles.typeChip, selected && { borderColor: accent, backgroundColor: `${accent}18` }]}><Text style={[styles.typeLabel, selected && { color: accent }]}>{item.label}</Text></Pressable>; })}</View></View>
      <View style={styles.qualityPanel}><View style={styles.qualityHeader}><View><Text style={styles.eyebrow}>MOCK QUALITY SCORE</Text><Text style={styles.sectionHeading}>Local scoring preview</Text></View><View style={styles.qualityOrb}><Eye color={palette.gold} size={22} /></View></View><ScoreBar label="Trust level" value={scores.trustLevel} color={palette.cyan} /><ScoreBar label="Influence strength" value={scores.influenceStrength} color={palette.gold} /><ScoreBar label="Validation score" value={scores.validationScore} color={palette.success} /><ScoreBar label="Confidence contribution" value={scores.confidenceContribution} color={palette.violet} /><Text style={styles.notice}>Scores are mock UI states based on entry length, depth, and selected types. They do not process predictions.</Text></View>
      <View style={styles.summaryCard}><Text style={styles.summaryTitle}>Observation Capsule</Text><Text style={styles.summaryText}>Target EAGOH: Apex Cipher · Selected types: {selectedTypes.length}</Text><Text style={styles.summaryText}>Entry mode: {depth} · Stored locally as mock state only</Text></View>
    </View>
  );

  const renderLabContent = useCallback((): JSX.Element => (
    <>
      <View style={styles.modeSwitch}><Pressable onPress={() => setMode("analyst")} style={[styles.modeButton, mode === "analyst" && styles.modeButtonActive]}><MessageCircle color={mode === "analyst" ? palette.void : palette.cyan} size={17} /><Text style={[styles.modeText, mode === "analyst" && styles.modeTextActive]}>Analyst</Text></Pressable><Pressable onPress={() => setMode("intelligence")} style={[styles.modeButton, mode === "intelligence" && styles.modeButtonActive]}><Activity color={mode === "intelligence" ? palette.void : palette.cyan} size={17} /><Text style={[styles.modeText, mode === "intelligence" && styles.modeTextActive]}>Open Intel</Text></Pressable><Pressable onPress={() => setMode("forge")} style={[styles.modeButton, mode === "forge" && styles.modeButtonActive]}><SlidersHorizontal color={mode === "forge" ? palette.void : palette.cyan} size={17} /><Text style={[styles.modeText, mode === "forge" && styles.modeTextActive]}>Forge</Text></Pressable></View>
      {mode === "analyst" ? renderAnalystChat() : mode === "intelligence" ? renderOpenIntelligence() : <View style={styles.forgeWrap}>
        <ForgeDashboard stepIndex={stepIndex} totalSteps={steps.length} completion={completion} />
        <View style={styles.forgeTopBar}><Text style={styles.forgeBrand}>FORGE</Text><View style={styles.streakPill}><View style={styles.streakDot} /><Text style={styles.streakText}>Step {stepIndex + 1} of {steps.length}</Text></View></View>
        <View style={styles.forgeHero}><TransparentMockRender state={forgeState} /><View style={styles.forgeHeroFooter}><View style={styles.forgeHeroFooterRow}><Text style={styles.forgeHeroName}>{(forgeState.name || "UNNAMED EAGOH").toUpperCase()}</Text><Text style={styles.forgeHeroDivider}>|</Text><Text style={styles.forgeHeroMeta}>Sync Score <Text style={styles.forgeHeroMetaValue}>{Math.round(((stepIndex + 1) / steps.length) * 99)}</Text></Text></View><View style={styles.forgeHeroUnderlineTrack}><View style={[styles.forgeHeroUnderlineFill, { width: completion as DimensionValue }]} /></View></View></View>
        <View style={styles.forgeCard}>
          <View style={styles.forgeCardTopRow}><View style={styles.missionPill}><Text style={styles.missionPillText}>Step {String(stepIndex + 1).padStart(2, "0")}</Text></View><Text style={styles.forgeCardSubtle}>Day {stepIndex + 1} of {steps.length}</Text></View>
          <Text style={styles.forgeCardTitle}>{activeStep === "Identity" ? "Identity Calibration" : activeStep === "DNA" ? "DNA Sequencing" : activeStep === "Teams" ? "Fanatic Binding" : activeStep === "Body" ? "Silhouette Assembly" : activeStep === "Pose" ? "Stance Lock" : "Final Review"}</Text>
          <Text style={styles.forgeCardMeta}>{activeStep === "Identity" ? "5 Min" : activeStep === "DNA" ? "7 Min" : activeStep === "Teams" ? "4 Min" : activeStep === "Body" ? "10 Min" : activeStep === "Pose" ? "3 Min" : "6 Min"} <Text style={styles.forgeCardDot}>·</Text> Combined</Text>
          <View style={styles.forgeDivider} />
          <Text style={styles.forgeTodayFocus}>TODAY'S FOCUS</Text>
          <Text style={styles.forgeFocusBody}>{activeStep === "Identity" ? "Replace anonymity with a coded intelligence identity." : activeStep === "DNA" ? "Stack archetype behavior into a unified tactical signature." : activeStep === "Teams" ? "Bind mock fanatic affinities to amplify resonance." : activeStep === "Body" ? "Assemble a premium silhouette without copyrighted assets." : activeStep === "Pose" ? "Lock the stance and select the calibration lab." : "Review the forged intelligence before deployment."}</Text>
          <View style={styles.forgeFocusChips}><View style={styles.forgeFocusChip}><Text style={styles.forgeFocusChipText}>{activeStep}</Text></View><View style={[styles.forgeFocusChip, styles.forgeFocusChipAccent]}><Text style={[styles.forgeFocusChipText, styles.forgeFocusChipTextAccent]}>{activeStep === "Preview" ? "Deployment ready" : "Calibration phase"}</Text></View></View>
          <Pressable onPress={goNext} style={({ pressed }) => [styles.deployButton, pressed && styles.pressed]}><Text style={styles.deployButtonText}>{activeStep === "Preview" ? "FORGE" : "DEPLOY"}</Text></Pressable>
          <Pressable onPress={goBack} disabled={stepIndex === 0} style={({ pressed }) => [styles.briefingRow, pressed && styles.pressed, stepIndex === 0 && styles.disabledButton]}><Text style={styles.briefingText}>{stepIndex === 0 ? "Mission briefing  \u2191" : "Back to previous step  \u2191"}</Text></Pressable>
        </View>
        <FlatList horizontal data={steps} keyExtractor={(item) => item} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stepTabs} renderItem={({ item, index }) => { const selected = item === activeStep; return <Pressable onPress={() => setActiveStep(item)} style={[styles.forgeStepTab, selected && styles.forgeStepTabActive]}><Text style={[styles.forgeStepTabIndex, selected && styles.forgeStepTabIndexActive]}>{String(index + 1).padStart(2, "0")}</Text><Text style={[styles.forgeStepTabText, selected && styles.forgeStepTabTextActive]}>{item}</Text></Pressable>; }} {...HORIZONTAL_LIST_PERFORMANCE_PROPS} />
        <View style={styles.forgeCard}>{renderStep()}</View>
        <View style={styles.actions}><Pressable disabled={stepIndex === 0} onPress={goBack} style={[styles.secondaryButton, stepIndex === 0 && styles.disabledButton]}><Text style={styles.secondaryButtonText}>Back</Text></Pressable><Pressable onPress={goNext} style={styles.deployButton}><Text style={styles.deployButtonText}>{activeStep === "Preview" ? "FORGE YOUR EAGOH" : "CONTINUE"}</Text></Pressable></View>
      </View>}
    </>
  ), [activeStep, completion, forgeState, goBack, goNext, mode, renderAnalystChat, renderOpenIntelligence, renderStep, stepIndex]);

  return <LinearGradient colors={[pal.void, pal.obsidian, pal.void]} style={styles.root}><SafeAreaView edges={["top"]} style={[styles.safe, { backgroundColor: pal.void }]}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}><ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">{renderLabContent()}</ScrollView></KeyboardAvoidingView></SafeAreaView></LinearGradient>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, safe: { flex: 1 }, kav: { flex: 1 }, scroll: { padding: 18, paddingBottom: 120, gap: 16 },
  modeSwitch: { flexDirection: "row", gap: 10, padding: 5, borderRadius: 5, borderWidth: 1, borderColor: palette.line, backgroundColor: "rgba(255,255,255,0.04)" },
  modeButton: { flex: 1, minHeight: 48, borderRadius: 5, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 }, modeButtonActive: { backgroundColor: palette.cyan }, modeText: { color: palette.cyan, fontSize: 14, fontWeight: "900" }, modeTextActive: { color: palette.void },
  hero: { borderWidth: 1, borderColor: palette.line, borderRadius: 5, padding: 18, backgroundColor: "rgba(14, 24, 37, 0.82)", overflow: "hidden" }, intelHero: { borderWidth: 1, borderColor: "rgba(54,245,255,0.28)", borderRadius: 5, padding: 18, backgroundColor: "rgba(3,6,11,0.70)", overflow: "hidden", gap: 10 }, heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 }, kicker: { color: palette.cyan, fontSize: 12, fontWeight: "900", letterSpacing: 2.2 }, title: { color: palette.text, fontSize: 38, fontWeight: "900", letterSpacing: -1.4, marginTop: 4 }, orbit: { width: 54, height: 54, borderRadius: 5, alignItems: "center", justifyContent: "center", backgroundColor: palette.cyanSoft, borderWidth: 1, borderColor: "rgba(54,245,255,0.32)" }, heroText: { color: palette.muted, fontSize: 14, lineHeight: 21, marginTop: 12, fontWeight: "700" },
  progressShell: { height: 8, borderRadius: 5, backgroundColor: "rgba(255,255,255,0.09)", marginTop: 16, overflow: "hidden" }, progressFill: { height: 8, borderRadius: 5, backgroundColor: palette.success }, stepTabs: { gap: 10, paddingRight: 18 }, stepTab: { minWidth: 96, borderRadius: 5, padding: 12, borderWidth: 1, borderColor: palette.line, backgroundColor: "rgba(255,255,255,0.04)" }, stepTabActive: { borderColor: palette.cyan, backgroundColor: palette.cyanSoft }, stepTabIndex: { color: palette.muted, fontSize: 10, fontWeight: "900" }, stepTabText: { color: palette.text, fontSize: 13, fontWeight: "900", marginTop: 2 }, stepTabTextActive: { color: palette.cyan }, forgeGrid: { gap: 16 },
  renderStage: { minHeight: 330, borderRadius: 5, borderWidth: 1, borderColor: "rgba(54,245,255,0.28)", backgroundColor: "rgba(3,6,11,0.52)", alignItems: "center", justifyContent: "center", overflow: "hidden", padding: 18 }, renderBadge: { position: "absolute", top: 14, color: palette.muted, fontSize: 10, fontWeight: "900", letterSpacing: 1.5 }, haloOuter: { position: "absolute", width: 210, height: 210, borderRadius: 105, borderWidth: 1, borderColor: "rgba(54,245,255,0.18)" }, avatarHead: { width: 76, height: 76, borderRadius: 5, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.line, backgroundColor: "rgba(255,255,255,0.06)", marginBottom: 10 }, avatarTorso: { width: 132, height: 126, borderRadius: 5, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.line, overflow: "hidden" }, avatarLegs: { flexDirection: "row", gap: 12, marginTop: 10 }, avatarLeg: { width: 36, height: 74, borderRadius: 5 }, renderName: { color: palette.text, fontSize: 22, fontWeight: "900", marginTop: 16 }, renderMeta: { color: palette.muted, fontSize: 12, fontWeight: "800", textTransform: "capitalize", marginTop: 4 },
  stepPanel: { borderWidth: 1, borderColor: palette.line, borderRadius: 5, padding: 16, backgroundColor: palette.panel, gap: 12 }, sectionTitle: { marginTop: 2 }, eyebrow: { color: palette.gold, fontSize: 11, fontWeight: "900", letterSpacing: 1.8 }, sectionHeading: { color: palette.text, fontSize: 22, fontWeight: "900", letterSpacing: -0.4, marginTop: 3 }, input: { minHeight: 56, borderRadius: 5, borderWidth: 1, borderColor: "rgba(54,245,255,0.28)", backgroundColor: "rgba(255,255,255,0.05)", color: palette.text, paddingHorizontal: 16, fontSize: 17, fontWeight: "900" }, observationInput: { minHeight: 132, borderRadius: 5, borderWidth: 1, borderColor: "rgba(54,245,255,0.28)", backgroundColor: "rgba(255,255,255,0.05)", color: palette.text, padding: 16, fontSize: 15, fontWeight: "800", lineHeight: 22, textAlignVertical: "top" },
  gridList: { gap: 10 }, optionChip: { flex: 1, minHeight: 58, borderRadius: 5, borderWidth: 1, borderColor: palette.line, backgroundColor: "rgba(255,255,255,0.045)", padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }, pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] }, optionDot: { width: 9, height: 9, borderRadius: 5 }, optionCopy: { flex: 1 }, optionLabel: { color: palette.text, fontSize: 14, fontWeight: "900" }, optionDetail: { color: palette.muted, fontSize: 11, fontWeight: "700", marginTop: 2 }, notice: { color: palette.muted, lineHeight: 19, fontSize: 13, fontWeight: "700", borderWidth: 1, borderColor: palette.line, borderRadius: 5, padding: 12, backgroundColor: "rgba(255,184,77,0.08)" }, noticeInline: { color: palette.muted, fontSize: 12, fontWeight: "900" },
  categoryCard: { borderWidth: 1, borderColor: palette.line, borderRadius: 5, padding: 12, gap: 10, backgroundColor: "rgba(0,0,0,0.16)" }, categoryHeader: { flexDirection: "row", alignItems: "center", gap: 8 }, categoryTitle: { color: palette.text, fontSize: 16, fontWeight: "900" }, summaryCard: { borderWidth: 1, borderColor: palette.line, borderRadius: 5, padding: 14, backgroundColor: "rgba(255,255,255,0.04)", gap: 6 }, summaryTitle: { color: palette.cyan, fontSize: 20, fontWeight: "900" }, summaryText: { color: palette.muted, fontSize: 13, fontWeight: "700", lineHeight: 18, textTransform: "capitalize" }, actions: { flexDirection: "row", gap: 12 }, secondaryButton: { flex: 0.8, minHeight: 56, borderRadius: 5, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.line, backgroundColor: "rgba(255,255,255,0.04)" }, disabledButton: { opacity: 0.36 }, secondaryButtonText: { color: palette.text, fontSize: 15, fontWeight: "900" }, primaryButton: { flex: 1.2, minHeight: 56, borderRadius: 5, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, backgroundColor: palette.cyan }, primaryButtonText: { color: palette.void, fontSize: 15, fontWeight: "900", letterSpacing: 0.5 },
  forgeWrap: { gap: 16 },
  forgeTopBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2, marginTop: 2 },
  forgeBrand: { color: palette.text, fontSize: 13, fontWeight: "700", letterSpacing: 4, fontFamily: "Courier" as const },
  streakPill: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 5, borderWidth: 1, borderColor: "rgba(141,162,181,0.28)", backgroundColor: "rgba(255,255,255,0.03)" },
  streakDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.cyan },
  streakText: { color: palette.text, fontSize: 12, fontWeight: "700" },
  forgeHero: { borderRadius: 5, overflow: "hidden", backgroundColor: "#070D16", borderWidth: 1, borderColor: "rgba(141,162,181,0.14)" },
  forgeHeroFooter: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 18, gap: 10 },
  forgeHeroFooterRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  forgeHeroName: { color: palette.cyan, fontSize: 14, fontWeight: "700", letterSpacing: 3 },
  forgeHeroDivider: { color: "rgba(141,162,181,0.4)", fontSize: 14 },
  forgeHeroMeta: { color: palette.muted, fontSize: 13, fontWeight: "600" },
  forgeHeroMetaValue: { color: palette.text, fontWeight: "900" },
  forgeHeroUnderlineTrack: { height: 2, backgroundColor: "rgba(141,162,181,0.14)", borderRadius: 2, overflow: "hidden" },
  forgeHeroUnderlineFill: { height: 2, backgroundColor: palette.cyan, borderRadius: 2 },
  forgeCard: { borderRadius: 5, padding: 22, backgroundColor: "#0B121C", borderWidth: 1, borderColor: "rgba(141,162,181,0.12)", gap: 12 },
  forgeCardTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  missionPill: { borderRadius: 5, borderWidth: 1, borderColor: "rgba(141,162,181,0.30)", paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "rgba(255,255,255,0.02)" },
  missionPillText: { color: palette.text, fontSize: 12, fontWeight: "700", letterSpacing: 1, fontFamily: "Courier" as const },
  forgeCardSubtle: { color: palette.muted, fontSize: 13, fontWeight: "500", fontFamily: "Courier" as const },
  forgeCardTitle: { color: palette.text, fontSize: 32, fontWeight: "800", letterSpacing: -0.8, marginTop: 4 },
  forgeCardMeta: { color: palette.muted, fontSize: 14, fontWeight: "500", fontFamily: "Courier" as const },
  forgeCardDot: { color: palette.muted },
  forgeDivider: { height: 1, backgroundColor: "rgba(141,162,181,0.18)", marginVertical: 6 },
  forgeTodayFocus: { color: palette.muted, fontSize: 11, fontWeight: "700", letterSpacing: 3, fontFamily: "Courier" as const },
  forgeFocusBody: { color: palette.text, fontSize: 18, fontWeight: "500", lineHeight: 26, marginTop: 2 },
  forgeFocusChips: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 6 },
  forgeFocusChip: { borderRadius: 5, borderWidth: 1, borderColor: "rgba(141,162,181,0.30)", paddingHorizontal: 14, paddingVertical: 8 },
  forgeFocusChipAccent: { borderColor: "rgba(54,245,255,0.45)" },
  forgeFocusChipText: { color: palette.text, fontSize: 13, fontWeight: "500" },
  forgeFocusChipTextAccent: { color: palette.cyan },
  deployButton: { backgroundColor: palette.text, borderRadius: 5, paddingVertical: 20, alignItems: "center", justifyContent: "center", marginTop: 14, flex: 1 },
  deployButtonText: { color: "#0B121C", fontSize: 15, fontWeight: "800", letterSpacing: 4 },
  briefingRow: { alignItems: "center", paddingVertical: 12 },
  briefingText: { color: palette.muted, fontSize: 13, fontWeight: "500", fontFamily: "Courier" as const },
  forgeStepTab: { minWidth: 92, borderRadius: 5, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: "rgba(141,162,181,0.18)", backgroundColor: "rgba(255,255,255,0.02)" },
  forgeStepTabActive: { borderColor: "rgba(54,245,255,0.55)", backgroundColor: "rgba(54,245,255,0.10)" },
  forgeStepTabIndex: { color: palette.muted, fontSize: 10, fontWeight: "700", letterSpacing: 1, fontFamily: "Courier" as const },
  forgeStepTabIndexActive: { color: palette.cyan },
  forgeStepTabText: { color: palette.text, fontSize: 13, fontWeight: "700", marginTop: 3 },
  forgeStepTabTextActive: { color: palette.cyan },
  intelWrap: { gap: 16 }, chatHero: { borderWidth: 1, borderColor: "rgba(154,112,255,0.34)", borderRadius: 5, padding: 18, backgroundColor: "rgba(12,8,26,0.78)", overflow: "hidden", gap: 10 }, moodOrb: { position: "absolute", top: 18, right: 18, width: 54, height: 54, borderRadius: 5, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1 }, personalityStrip: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }, personalityText: { color: palette.muted, fontSize: 11, fontWeight: "900", borderWidth: 1, borderColor: palette.line, borderRadius: 5, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "rgba(255,255,255,0.04)" }, sessionGrid: { gap: 10 }, sessionCard: { borderRadius: 5, borderWidth: 1, borderColor: palette.line, backgroundColor: "rgba(255,255,255,0.045)", padding: 14, gap: 5 }, sessionTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, sessionName: { color: palette.text, fontSize: 16, fontWeight: "900" }, sessionCost: { fontSize: 12, fontWeight: "900" }, sessionMeta: { color: palette.cyan, fontSize: 12, fontWeight: "900" }, sessionMood: { color: palette.muted, fontSize: 12, fontWeight: "700" }, chatPanel: { borderWidth: 1, borderColor: "rgba(54,245,255,0.24)", borderRadius: 5, padding: 16, backgroundColor: "rgba(3,6,11,0.82)", gap: 12 }, chatPanelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }, confidencePill: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 5, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "rgba(255,255,255,0.04)" }, confidenceText: { fontSize: 12, fontWeight: "900" }, messageBubble: { maxWidth: "88%", borderRadius: 5, padding: 13, gap: 6 }, analystBubble: { alignSelf: "flex-start", borderTopLeftRadius: 2, backgroundColor: "rgba(54,245,255,0.10)", borderWidth: 1, borderColor: "rgba(54,245,255,0.20)" },
  userBubble: { alignSelf: "flex-end", borderTopRightRadius: 2, backgroundColor: "rgba(255,184,77,0.16)", borderWidth: 1, borderColor: "rgba(255,184,77,0.24)" },
  analystText: { color: palette.text, fontSize: 14, fontWeight: "800", lineHeight: 20 },
  userText: { color: palette.text, fontSize: 14, fontWeight: "900", lineHeight: 20 },
  messageConfidence: { fontSize: 11, fontWeight: "900" },
  typingRow: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 2 },
  typingDots: { flexDirection: "row", gap: 4, alignItems: "center" },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.cyan, opacity: 0.55 },
  dotMid: { opacity: 1, transform: [{ translateY: -2 }] },
  typingText: { color: palette.muted, fontSize: 12, fontWeight: "800" },
  errorText: { color: palette.ember, fontSize: 12, fontWeight: "800", marginTop: 4 },
  memoryCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderWidth: 1, borderColor: palette.line, borderRadius: 5, padding: 12, backgroundColor: "rgba(255,255,255,0.04)" },
  memoryTitle: { color: palette.text, fontSize: 14, fontWeight: "900" },
  memoryDetail: { color: palette.muted, fontSize: 12, fontWeight: "700", marginTop: 3, lineHeight: 17 },
  memoryScore: { color: palette.success, fontSize: 13, fontWeight: "900" },
  promptChip: { borderRadius: 5, borderWidth: 1, borderColor: "rgba(154,112,255,0.28)", backgroundColor: "rgba(154,112,255,0.12)", paddingHorizontal: 12, paddingVertical: 10 },
  composer: { minHeight: 58, borderRadius: 5, borderWidth: 1, borderColor: "rgba(54,245,255,0.24)", backgroundColor: "rgba(255,255,255,0.05)", flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 10 },
  composerInput: { flex: 1, color: palette.text, fontSize: 14, fontWeight: "800" },
  sendButton: { width: 40, height: 40, borderRadius: 5, alignItems: "center", justifyContent: "center" },
  depthRow: { gap: 10 },
  depthCard: { borderRadius: 5, borderWidth: 1, borderColor: palette.line, backgroundColor: "rgba(255,255,255,0.045)", padding: 14 },
  depthTitle: { color: palette.text, fontSize: 18, fontWeight: "900" },
  depthDetail: { color: palette.cyan, fontSize: 12, fontWeight: "900", marginTop: 4 },
  depthFine: { color: palette.muted, fontSize: 12, fontWeight: "700", marginTop: 2 },
  charRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  charCount: { color: palette.cyan, fontSize: 12, fontWeight: "900" },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  typeChip: { borderRadius: 5, borderWidth: 1, borderColor: palette.line, backgroundColor: "rgba(255,255,255,0.045)", paddingHorizontal: 12, paddingVertical: 10 },
  typeLabel: { color: palette.text, fontSize: 12, fontWeight: "900" },
  qualityPanel: { borderWidth: 1, borderColor: "rgba(54,245,255,0.24)", borderRadius: 5, padding: 16, backgroundColor: "rgba(14,24,37,0.84)", gap: 14 },
  qualityHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  qualityOrb: { width: 50, height: 50, borderRadius: 5, alignItems: "center", justifyContent: "center", backgroundColor: palette.goldSoft, borderWidth: 1, borderColor: "rgba(255,184,77,0.28)" },
  scoreRow: { gap: 7 },
  scoreTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  scoreLabel: { color: palette.text, fontSize: 13, fontWeight: "900" },
  scoreValue: { fontSize: 13, fontWeight: "900" },
  scoreTrack: { height: 8, borderRadius: 5, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.08)" },
  scoreFill: { height: 8, borderRadius: 5 },
});

const dashStyles = StyleSheet.create({
  wrap: { gap: 14 },
  headerBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4, paddingVertical: 4 },
  signalChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 5, borderWidth: 1, borderColor: "rgba(54,245,255,0.30)", backgroundColor: "rgba(54,245,255,0.08)" },
  signalDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.cyan },
  signalText: { color: palette.cyan, fontSize: 10, fontWeight: "900", letterSpacing: 1.4 },
  headerCenter: { alignItems: "center", gap: 4 },
  brandTitle: { color: palette.text, fontSize: 22, fontWeight: "900", letterSpacing: 6 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: palette.success },
  statusText: { color: palette.success, fontSize: 9, fontWeight: "900", letterSpacing: 2 },
  settingsChip: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(54,245,255,0.30)", backgroundColor: "rgba(54,245,255,0.08)" },

  chamber: { borderRadius: 5, borderWidth: 1, borderColor: "rgba(54,245,255,0.22)", backgroundColor: "rgba(7,13,22,0.92)", overflow: "hidden", padding: 16, gap: 14 },
  gridLinesV: { ...StyleSheet.absoluteFillObject },
  gridLinesH: { ...StyleSheet.absoluteFillObject },
  gridV: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "rgba(54,245,255,0.05)" },
  gridH: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: "rgba(54,245,255,0.05)" },
  scanLine: { position: "absolute", left: 0, right: 0, height: 80 },
  chamberHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chamberEyebrow: { color: palette.cyan, fontSize: 10, fontWeight: "900", letterSpacing: 2.4 },
  chamberStatus: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5, borderWidth: 1, borderColor: "rgba(99,255,183,0.28)", backgroundColor: "rgba(99,255,183,0.08)" },
  chamberStatusText: { color: palette.success, fontSize: 9, fontWeight: "900", letterSpacing: 1.4 },
  chamberMain: { flexDirection: "row", gap: 12, alignItems: "stretch" },
  brainCol: { flex: 1, alignItems: "center", gap: 8 },
  brainStage: { width: 200, height: 200, alignItems: "center", justifyContent: "center" },
  brainHaloOuter: { position: "absolute", width: 200, height: 200, borderRadius: 100, borderWidth: 1, borderColor: "rgba(54,245,255,0.20)" },
  brainHaloMid: { position: "absolute", width: 150, height: 150, borderRadius: 75, borderWidth: 1, borderColor: "rgba(54,245,255,0.30)" },
  brainHaloInner: { position: "absolute", width: 110, height: 110, borderRadius: 55, borderWidth: 1, borderColor: "rgba(124,92,255,0.40)" },
  brainCore: { width: 130, height: 130, borderRadius: 65, alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 1, borderColor: "rgba(54,245,255,0.55)", shadowColor: palette.cyan, shadowOpacity: 0.6, shadowRadius: 18, shadowOffset: { width: 0, height: 0 } },
  shimmer: { position: "absolute", top: 0, bottom: 0, width: 120 },
  neuralNode: { position: "absolute", width: 6, height: 6, borderRadius: 3 },
  metricLabel: { color: palette.muted, fontSize: 10, fontWeight: "900", letterSpacing: 2.4, marginTop: 6 },
  metricRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  metricBig: { color: palette.cyan, fontSize: 36, fontWeight: "900", letterSpacing: -1, textShadowColor: "rgba(54,245,255,0.55)", textShadowRadius: 12 },
  metricSub: { color: palette.success, fontSize: 11, fontWeight: "800", letterSpacing: 0.4 },

  sideCol: { width: 110, gap: 8, justifyContent: "flex-start" },
  sideMetric: { borderRadius: 5, borderWidth: 1, padding: 9, backgroundColor: "rgba(3,6,11,0.55)", gap: 4 },
  sideMetricTop: { flexDirection: "row", alignItems: "center", gap: 5 },
  sideMetricLabel: { color: palette.muted, fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  sideMetricValue: { fontSize: 16, fontWeight: "900", letterSpacing: 0.4 },

  analyticsCard: { borderRadius: 5, borderWidth: 1, borderColor: "rgba(54,245,255,0.18)", backgroundColor: "rgba(11,18,28,0.92)", padding: 16, gap: 12 },
  analyticsHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  analyticsEyebrow: { color: palette.cyan, fontSize: 10, fontWeight: "900", letterSpacing: 2.2 },
  analyticsTitle: { color: palette.text, fontSize: 18, fontWeight: "900", letterSpacing: -0.3, marginTop: 2 },
  analyticsBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 5, borderWidth: 1, borderColor: "rgba(54,245,255,0.35)", backgroundColor: "rgba(54,245,255,0.08)" },
  analyticsBadgeText: { color: palette.cyan, fontSize: 11, fontWeight: "900" },
  barRow: { gap: 6 },
  barTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  barLabel: { color: palette.text, fontSize: 13, fontWeight: "800" },
  barValueWrap: { flexDirection: "row", alignItems: "center", gap: 5 },
  barValue: { fontSize: 12, fontWeight: "900" },
  barTrack: { height: 8, borderRadius: 5, backgroundColor: "rgba(255,255,255,0.06)", overflow: "hidden" },
  barFill: { height: 8, borderRadius: 5, shadowOpacity: 0.7, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },

  perfRow: { flexDirection: "row", gap: 10 },
  perfCard: { flex: 1, borderRadius: 5, borderWidth: 1, padding: 12, backgroundColor: "rgba(7,13,22,0.92)", overflow: "hidden", gap: 6, minHeight: 130 },
  perfTop: { flexDirection: "row", alignItems: "center", gap: 5 },
  perfLabel: { color: palette.muted, fontSize: 9, fontWeight: "900", letterSpacing: 1.4 },
  perfValue: { fontSize: 26, fontWeight: "900", letterSpacing: -0.6 },
  microGraph: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 30, marginTop: 2 },
  microBar: { flex: 1, borderRadius: 1.5, minHeight: 3 },
  perfStatus: { color: palette.text, fontSize: 11, fontWeight: "800" },

  bottomStats: { flexDirection: "row", alignItems: "center", borderRadius: 5, borderWidth: 1, borderColor: "rgba(141,162,181,0.18)", backgroundColor: "rgba(11,18,28,0.85)", paddingVertical: 12, paddingHorizontal: 14 },
  bottomStat: { flex: 1, alignItems: "center", gap: 3 },
  bottomStatLabel: { color: palette.muted, fontSize: 8, fontWeight: "900", letterSpacing: 1.4 },
  bottomStatValue: { color: palette.text, fontSize: 15, fontWeight: "900", letterSpacing: 0.4 },
  bottomStatDivider: { width: 1, height: 28, backgroundColor: "rgba(141,162,181,0.20)" },
});

const _styles2_unused: Record<string, unknown> = ({
  _spacer: { height: 0 },
  _chatRest_inner: ({ chatHero: { borderWidth: 1, borderColor: "rgba(154,112,255,0.34)", borderRadius: 5, padding: 18, backgroundColor: "rgba(12,8,26,0.78)", overflow: "hidden", gap: 10 }, moodOrb: { position: "absolute", top: 18, right: 18, width: 54, height: 54, borderRadius: 5, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1 }, personalityStrip: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }, personalityText: { color: palette.muted, fontSize: 11, fontWeight: "900", borderWidth: 1, borderColor: palette.line, borderRadius: 5, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "rgba(255,255,255,0.04)" }, sessionGrid: { gap: 10 }, sessionCard: { borderRadius: 5, borderWidth: 1, borderColor: palette.line, backgroundColor: "rgba(255,255,255,0.045)", padding: 14, gap: 5 }, sessionTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, sessionName: { color: palette.text, fontSize: 16, fontWeight: "900" }, sessionCost: { fontSize: 12, fontWeight: "900" }, sessionMeta: { color: palette.cyan, fontSize: 12, fontWeight: "900" }, sessionMood: { color: palette.muted, fontSize: 12, fontWeight: "700" }, chatPanel: { borderWidth: 1, borderColor: "rgba(54,245,255,0.24)", borderRadius: 5, padding: 16, backgroundColor: "rgba(3,6,11,0.82)", gap: 12 }, chatPanelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }, confidencePill: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 5, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "rgba(255,255,255,0.04)" }, confidenceText: { fontSize: 12, fontWeight: "900" }, messageBubble: { maxWidth: "88%", borderRadius: 5, padding: 13, gap: 6 }, analystBubble: { alignSelf: "flex-start", borderTopLeftRadius: 2, backgroundColor: "rgba(54,245,255,0.10)", borderWidth: 1, borderColor: "rgba(54,245,255,0.20)" }, userBubble: { alignSelf: "flex-end", borderTopRightRadius: 2, backgroundColor: "rgba(255,184,77,0.16)", borderWidth: 1, borderColor: "rgba(255,184,77,0.24)" }, analystText: { color: palette.text, fontSize: 14, fontWeight: "800", lineHeight: 20 }, userText: { color: palette.text, fontSize: 14, fontWeight: "900", lineHeight: 20 }, messageConfidence: { fontSize: 11, fontWeight: "900" }, typingRow: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 2 }, typingDots: { flexDirection: "row", gap: 4, alignItems: "center" }, dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.cyan, opacity: 0.55 }, dotMid: { opacity: 1, transform: [{ translateY: -2 }] }, typingText: { color: palette.muted, fontSize: 12, fontWeight: "800" }, memoryCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderWidth: 1, borderColor: palette.line, borderRadius: 5, padding: 12, backgroundColor: "rgba(255,255,255,0.04)" }, memoryTitle: { color: palette.text, fontSize: 14, fontWeight: "900" }, memoryDetail: { color: palette.muted, fontSize: 12, fontWeight: "700", marginTop: 3, lineHeight: 17 }, memoryScore: { color: palette.success, fontSize: 13, fontWeight: "900" }, promptChip: { borderRadius: 5, borderWidth: 1, borderColor: "rgba(154,112,255,0.28)", backgroundColor: "rgba(154,112,255,0.12)", paddingHorizontal: 12, paddingVertical: 10 }, composer: { minHeight: 58, borderRadius: 5, borderWidth: 1, borderColor: "rgba(54,245,255,0.24)", backgroundColor: "rgba(255,255,255,0.05)", flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 10 }, composerInput: { flex: 1, color: palette.text, fontSize: 14, fontWeight: "800" }, sendButton: { width: 40, height: 40, borderRadius: 5, alignItems: "center", justifyContent: "center" }, depthRow: { gap: 10 }, depthCard: { borderRadius: 5, borderWidth: 1, borderColor: palette.line, backgroundColor: "rgba(255,255,255,0.045)", padding: 14 }, depthTitle: { color: palette.text, fontSize: 18, fontWeight: "900" }, depthDetail: { color: palette.cyan, fontSize: 12, fontWeight: "900", marginTop: 4 }, depthFine: { color: palette.muted, fontSize: 12, fontWeight: "700", marginTop: 2 }, charRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, charCount: { color: palette.cyan, fontSize: 12, fontWeight: "900" }, typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 }, typeChip: { borderRadius: 5, borderWidth: 1, borderColor: palette.line, backgroundColor: "rgba(255,255,255,0.045)", paddingHorizontal: 12, paddingVertical: 10 }, typeLabel: { color: palette.text, fontSize: 12, fontWeight: "900" }, qualityPanel: { borderWidth: 1, borderColor: "rgba(54,245,255,0.24)", borderRadius: 5, padding: 16, backgroundColor: "rgba(14,24,37,0.84)", gap: 14 }, qualityHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }, qualityOrb: { width: 50, height: 50, borderRadius: 5, alignItems: "center", justifyContent: "center", backgroundColor: palette.goldSoft, borderWidth: 1, borderColor: "rgba(255,184,77,0.28)" }, scoreRow: { gap: 7 }, scoreTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, scoreLabel: { color: palette.text, fontSize: 13, fontWeight: "900" }, scoreValue: { fontSize: 13, fontWeight: "900" }, scoreTrack: { height: 8, borderRadius: 5, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.08)" }, scoreFill: { height: 8, borderRadius: 5 } } as unknown as Record<string, unknown>),
});
