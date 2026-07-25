/**
 * Shared EAGOH hero banner — matches the Sessions page hero card layout exactly.
 *
 * Used by both Sessions (SelectedEagohCard) and Forge (preview area replacement).
 * The "mode" prop controls which labels and badges are shown; the visual structure
 * (image, gradient, shadow, border, typography) is identical for both.
 *
 * Pills are displayed vertically on the left side to avoid overlap with the EAGOH image.
 */

import { palette as darkPalette } from "@/constants/colors";
import { useAppTheme, type ThemePalette } from "@/providers/ThemeProvider";
import { INTELLIGENCE_DOMAINS } from "@/services/domains";
import type { EagohRecord } from "@/services/eagohs";
import {
  BadgeCheck,
  BookOpen,
  BrainCircuit,
  ChevronDown,
  Sparkles,
} from "lucide-react-native";
import React from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

type BannerMode = "sessions" | "forge";

type TopBadgeConfig = {
  text: string;
  color: string;
  backgroundColor: string;
  borderColor: string;
  dotColor?: string;
};

interface EagohHeroBannerProps {
  /** Visual + data context */
  mode: BannerMode;

  /** Domain info */
  domainId?: string | null;
  domainTone: string;

  /** Image */
  imageUrl?: string | null;

  /** Fallback image shown when imageUrl is absent (e.g. default Forge hero) */
  fallbackImageUrl?: string | null;

  /** Top-left domain tag text (e.g. "SPORTS") */
  domainLabel: string;

  /** Top-right badge */
  topRightBadge?: TopBadgeConfig;

  /** Bottom-left label (e.g. "ACTIVE EAGOH", "FORGING") */
  bottomLabel: string;

  /** Bottom-left name text */
  bottomName: string;

  /** Bottom-right button text */
  changeBtnText: string;

  /** Press handler */
  onPress: () => void;

  /** Is the tier free? */
  isFree?: boolean;

  /** Editing badge (Forge mode) */
  isEditing?: boolean;

  /** Specialty / sport / genre label shown as a pill (Forge mode) */
  specialtyLabel?: string | null;

  /** Credentials status pill */
  credentialStatus?: "complete" | "missing" | null;

  /** Credentials pill press handler */
  onCredentialsPress?: () => void;
}

function toneHex(tone: string, pal: ThemePalette): string {
  if (tone === "gold") return pal.gold;
  if (tone === "violet") return pal.violet;
  if (tone === "ember") return pal.ember;
  if (tone === "success") return pal.success;
  return pal.cyan;
}

const EagohHeroBanner = React.memo(function EagohHeroBanner({
  mode,
  domainId,
  domainTone,
  imageUrl,
  fallbackImageUrl,
  domainLabel,
  topRightBadge,
  bottomLabel,
  bottomName,
  changeBtnText,
  onPress,
  isFree = false,
  isEditing = false,
  specialtyLabel,
  credentialStatus,
  onCredentialsPress,
}: EagohHeroBannerProps): JSX.Element {
  const { palette: pal } = useAppTheme();
  const accent = isFree ? "#6B7280" : toneHex(domainTone, pal);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { shadowColor: accent, borderColor: `${accent}55` },
        pressed && styles.pressed,
      ]}
    >
      {/* Featured image area */}
      <View style={[styles.imageWrap, { backgroundColor: pal.graphite }]}>
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={styles.image}
            resizeMode="contain"
          />
        ) : fallbackImageUrl ? (
          <Image
            source={{ uri: fallbackImageUrl }}
            style={styles.image}
            resizeMode="contain"
          />
        ) : (
          <View style={styles.placeholder}>
            <BrainCircuit
              color={mode === "forge" && !isFree ? accent : pal.muted}
              size={64}
            />
          </View>
        )}

        {/* Atmospheric gradient overlay */}
        <LinearGradient
          colors={[`${accent}22`, "transparent", `${pal.void}E6`]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {/* ── Vertical pills column (top-left) ──────── */}
        <View style={styles.pillsColumn}>
          {/* Editing badge (Forge mode only) */}
          {mode === "forge" && isEditing ? (
            <View style={styles.editingBadge}>
              <Sparkles color={darkPalette.gold} size={10} />
              <Text style={styles.editingBadgeText}>EDITING</Text>
            </View>
          ) : null}

          {/* Domain tag */}
          <View
            style={[
              styles.pill,
              { borderColor: `${accent}55`, backgroundColor: `${accent}1F` },
            ]}
          >
            <Text
              style={[styles.domainText, { color: accent }]}
              numberOfLines={1}
            >
              {domainLabel.toUpperCase()}
            </Text>
          </View>

          {/* Specialty / genre pill */}
          {specialtyLabel ? (
            <View
              style={[
                styles.pill,
                { borderColor: `${pal.muted}40`, backgroundColor: `${pal.panel}` },
              ]}
            >
              <Text
                style={[styles.specialtyText, { color: pal.muted }]}
                numberOfLines={1}
              >
                {specialtyLabel}
              </Text>
            </View>
          ) : null}

          {/* Credentials status pill */}
          {credentialStatus ? (
            <Pressable
              onPress={onCredentialsPress}
              style={[
                styles.pill,
                credentialStatus === "complete"
                  ? { borderColor: `${pal.success}40`, backgroundColor: `${pal.successSoft}` }
                  : { borderColor: `${pal.gold}40`, backgroundColor: `${pal.goldSoft}` },
              ]}
            >
              {credentialStatus === "complete" ? (
                <BadgeCheck color={pal.success} size={10} />
              ) : (
                <BookOpen color={pal.gold} size={10} />
              )}
              <Text
                style={[
                  styles.credStatusText,
                  { color: credentialStatus === "complete" ? pal.success : pal.gold },
                ]}
                numberOfLines={1}
              >
                {credentialStatus === "complete" ? "Credentials" : "+ Credentials"}
              </Text>
            </Pressable>
          ) : null}

          {/* Top-right badge (step counter, etc.) */}
          {topRightBadge ? (
            <View
              style={[
                styles.pill,
                {
                  borderColor: topRightBadge.borderColor,
                  backgroundColor: topRightBadge.backgroundColor,
                },
              ]}
            >
              {topRightBadge.dotColor ? (
                <View
                  style={[
                    styles.statusDot,
                    {
                      backgroundColor: topRightBadge.dotColor,
                      shadowColor: topRightBadge.dotColor,
                    },
                  ]}
                />
              ) : null}
              <Text
                style={[styles.statusText, { color: topRightBadge.color }]}
              >
                {topRightBadge.text}
              </Text>
            </View>
          ) : null}
        </View>

        {/* ── Title/name block (bottom-left) ──────── */}
        <View style={styles.nameBlock} pointerEvents="box-none">
          <Text style={[styles.label, { color: pal.cyan }]}>{bottomLabel}</Text>
          <Text style={[styles.name, { color: pal.text }]} numberOfLines={1}>
            {bottomName}
          </Text>
        </View>

        {/* ── Selector/action button (bottom-right) ── */}
        <View
          style={[
            styles.changeBtnBlock,
            {
              borderColor: `${accent}55`,
              backgroundColor: `${accent}22`,
            },
          ]}
        >
          <Text style={[styles.changeText, { color: accent }]}>
            {changeBtnText}
          </Text>
          <ChevronDown color={accent} size={13} />
        </View>
      </View>
    </Pressable>
  );
});

export default EagohHeroBanner;

const styles = StyleSheet.create({
  card: {
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
    overflow: "hidden",
    shadowOpacity: 0.4,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  imageWrap: {
    height: 260,
    width: "100%",
    position: "relative",
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  // ── Vertical pills column (top-left) ────────
  pillsColumn: {
    position: "absolute",
    top: 24,
    left: 18,
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 8,
    zIndex: 3,
    maxWidth: "52%",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 5,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  domainText: { fontSize: 9, fontWeight: "900", letterSpacing: 1.4 },
  specialtyText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },
  credStatusText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.6 },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    shadowOpacity: 0.9,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
  statusText: { fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  // ── Title/name block (bottom-left) ────────
  nameBlock: {
    position: "absolute",
    bottom: 20,
    left: 18,
    zIndex: 3,
    maxWidth: "58%",
  },
  label: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 3,
  },
  name: {
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  // ── Selector/action button (bottom-right) ──
  changeBtnBlock: {
    position: "absolute",
    bottom: 20,
    right: 18,
    zIndex: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 6,
    borderWidth: 1,
  },
  changeText: { fontSize: 11, fontWeight: "900", letterSpacing: 0.3 },
  editingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: "rgba(255,181,71,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,181,71,0.30)",
    alignSelf: "flex-start",
  },
  editingBadgeText: {
    color: darkPalette.gold,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  pressed: { transform: [{ scale: 0.985 }], opacity: 0.88 },
});
