/**
 * SocialPlatformIcon — shared icon renderer for social media platforms.
 *
 * Uses lucide-react-native icons where available, and branded monogram
 * badges for platforms without a lucide icon. Both paths render inside
 * a circular badge with the platform's brand color.
 *
 * One shared component used by:
 *   - PublicSocialLinks (public profile + modal)
 *   - SocialLinksEditor (Settings)
 */
import { palette } from "@/constants/colors";
import {
  AtSign,
  Bot,
  Camera,
  Facebook,
  Globe,
  Instagram,
  Linkedin,
  Music2,
  Play,
  Share2,
  Sparkles,
  Twitch,
  Twitter,
  Youtube,
  type LucideIcon,
} from "lucide-react-native";
import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { PlatformConfig, SocialLinkPlatform } from "@/services/socialLinks";
import { PLATFORM_CONFIGS } from "@/services/socialLinks";

// ── Icon mapping ───────────────────────────────────────────────────────

const ICON_MAP: Partial<Record<SocialLinkPlatform, LucideIcon>> = {
  x: Twitter,
  instagram: Instagram,
  facebook: Facebook,
  youtube: Youtube,
  linkedin: Linkedin,
  twitch: Twitch,
  website: Globe,
  // Platforms without a direct lucide icon — use generic alternatives
  threads: AtSign,
  tiktok: Music2,
  reddit: Share2,
  snapchat: Camera,
  pinterest: Sparkles,
  discord: Bot,
};

// ── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
  smallBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
  monogram: {
    fontSize: 14,
    fontWeight: "900",
  },
  smallMonogram: {
    fontSize: 12,
    fontWeight: "900",
  },
});

// ── Component ──────────────────────────────────────────────────────────

export type SocialPlatformIconProps = {
  platform: SocialLinkPlatform;
  /** "normal" = 40px, "small" = 36px */
  size?: "normal" | "small";
  /** Override the icon color (defaults to platform brand color) */
  color?: string;
  style?: import("react-native").ViewStyle;
};

/**
 * Render a social platform icon badge.
 * Uses lucide icons where available; falls back to a monogram badge.
 */
export const SocialPlatformIcon = memo(function SocialPlatformIcon({
  platform,
  size = "normal",
  color,
  style,
}: SocialPlatformIconProps): JSX.Element {
  const config: PlatformConfig = PLATFORM_CONFIGS[platform];
  const Icon = ICON_MAP[platform];
  const badgeStyle = size === "small" ? styles.smallBadge : styles.badge;
  const monogramStyle = size === "small" ? styles.smallMonogram : styles.monogram;
  const iconColor = color ?? config.brandColor;

  // For platforms with a light brand color, use a dark background
  const isLightBrand =
    config.brandColor === "#FFFFFF" ||
    config.brandColor === "#FFFC00" ||
    config.brandColor === "#6CE6FF";

  const backgroundColor = isLightBrand
    ? "rgba(255,255,255,0.08)"
    : `${config.brandColor}15`;

  const borderColor = isLightBrand
    ? "rgba(255,255,255,0.20)"
    : `${config.brandColor}44`;

  return (
    <View
      style={[
        badgeStyle,
        { backgroundColor, borderColor },
        style,
      ]}
    >
      {Icon ? (
        <Icon
          color={iconColor}
          size={size === "small" ? 18 : 20}
          strokeWidth={2.2}
        />
      ) : (
        <Text
          style={[
            monogramStyle,
            { color: iconColor },
          ]}
        >
          {config.monogram}
        </Text>
      )}
    </View>
  );
});

export default SocialPlatformIcon;
