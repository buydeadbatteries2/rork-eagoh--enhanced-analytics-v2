/**
 * SocialVerifiedBadge — single reusable verification badge component.
 *
 * Represents successful EAGOH social-share verification.
 * Does NOT represent government/legal identity verification.
 *
 * Variants:
 *   iconOnly — small check icon only, accessible label
 *   compact  — check icon + "Verified"
 *   full     — check icon + "Verified EAGOH Contributor" + optional badge level
 *
 * Used in:
 *   - Public Profile page
 *   - PublicProfileModal
 *   - Exchange listing cards (vendor strip)
 *   - Profile page EAGOH cards (overlay)
 */
import { palette } from "@/constants/colors";
import { BadgeCheck } from "lucide-react-native";
import React, { memo, useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View, Alert } from "react-native";

// ── Types ────────────────────────────────────────────────────────────────

export type BadgeVariant = "iconOnly" | "compact" | "full";

export type SocialVerifiedBadgeProps = {
  /** Whether the profile owner has completed social-share verification. */
  isVerified: boolean;
  /** Badge variant — controls visual size and text. */
  variant?: BadgeVariant;
  /** Optional social badge level name (e.g. "Neural Scout"). Shown in full variant. */
  badgeName?: string | null;
  /** Optional verified share count. Shown in full variant when > 0. */
  verifiedShareCount?: number | null;
  /** Whether the badge should render. If false, renders null. */
  showWhenUnverified?: boolean;
  /** Override icon size (defaults: iconOnly=14, compact=12, full=14). */
  iconSize?: number;
  /** Extra styles for the container. */
  style?: import("react-native").ViewStyle;
};

// ── Styles ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: palette.cyanSoft,
    borderWidth: 1,
    borderColor: `${palette.cyan}55`,
  },
  iconOnlyWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  labelText: {
    color: palette.cyan,
    fontSize: 10,
    fontWeight: "800" as const,
    letterSpacing: 0.3,
  },
  fullLabelText: {
    color: palette.cyan,
    fontSize: 11,
    fontWeight: "800" as const,
    letterSpacing: 0.3,
  },
  badgeLevelText: {
    color: palette.violet,
    fontSize: 10,
    fontWeight: "700" as const,
    marginLeft: 4,
  },
  countText: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: "700" as const,
    marginLeft: 4,
  },
});

// ── Component ────────────────────────────────────────────────────────────

/**
 * Shared social verification badge. Renders nothing when `isVerified` is false
 * and `showWhenUnverified` is not true (the default).
 *
 * Tap shows an alert with the explanation text.
 */
export const SocialVerifiedBadge = memo(function SocialVerifiedBadge({
  isVerified,
  variant = "compact",
  badgeName,
  verifiedShareCount,
  showWhenUnverified = false,
  iconSize,
  style,
}: SocialVerifiedBadgeProps): JSX.Element | null {
  const [pressed, setPressed] = useState(false);

  const handlePress = useCallback(() => {
    Alert.alert(
      "Verified EAGOH Contributor",
      "This contributor has successfully completed EAGOH social-share verification.",
      [{ text: "OK" }],
    );
  }, []);

  if (!isVerified && !showWhenUnverified) return null;

  const size = iconSize ?? (variant === "iconOnly" ? 14 : variant === "compact" ? 12 : 14);

  if (variant === "iconOnly") {
    return (
      <Pressable
        onPress={handlePress}
        onAccessibilityLabel="Verified EAGOH Contributor"
        accessibilityRole="button"
        accessibilityHint="Shows that this contributor completed EAGOH social-share verification."
        style={({ pressed: p }) => [
          styles.iconOnlyWrap,
          { opacity: p ? 0.7 : 1 },
          style,
        ]}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <View style={{ position: "relative" }}>
          <BadgeCheck color={palette.cyan} size={size} strokeWidth={2.5} />
        </View>
      </Pressable>
    );
  }

  if (variant === "full") {
    return (
      <Pressable
        onPress={handlePress}
        accessibilityLabel="Verified EAGOH Contributor"
        accessibilityRole="button"
        accessibilityHint="Shows that this contributor completed EAGOH social-share verification."
        onAccessibilityTap={handlePress}
        style={({ pressed: p }) => [
          styles.badgeRow,
          { opacity: p ? 0.7 : 1, paddingHorizontal: 8, paddingVertical: 4 },
          style,
        ]}
      >
        <BadgeCheck color={palette.cyan} size={size} strokeWidth={2.5} />
        <Text style={styles.fullLabelText}>Verified EAGOH Contributor</Text>
        {badgeName ? <Text style={styles.badgeLevelText}>{badgeName}</Text> : null}
        {verifiedShareCount != null && verifiedShareCount > 0 ? (
          <Text style={styles.countText}>· {verifiedShareCount}</Text>
        ) : null}
      </Pressable>
    );
  }

  // compact (default)
  return (
    <Pressable
      onPress={handlePress}
      accessibilityLabel="Verified EAGOH Contributor"
      accessibilityRole="button"
      accessibilityHint="Shows that this contributor completed EAGOH social-share verification."
      onAccessibilityTap={handlePress}
      style={({ pressed: p }) => [
        styles.badgeRow,
        { opacity: p ? 0.7 : 1 },
        style,
      ]}
    >
      <BadgeCheck color={palette.cyan} size={size} strokeWidth={2.5} />
      <Text style={styles.labelText}>Verified</Text>
    </Pressable>
  );
});

export default SocialVerifiedBadge;
