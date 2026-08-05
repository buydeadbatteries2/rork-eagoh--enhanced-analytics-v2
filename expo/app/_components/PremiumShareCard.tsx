/**
 * PremiumShareCard — a reusable, premium trading-card-style share image
 * designed for EAGOH Marketplace listings, public profiles, featured EAGOHs,
 * and future promotional content.
 *
 * The card is rendered at 1080×1350 (4:5) aspect ratio — optimized for
 * social media feeds (Instagram, X/Twitter, Facebook). It is captured via
 * react-native-view-shot and shared through the native share sheet.
 *
 * Design language:
 *  - Dark futuristic background with layered gradients
 *  - Cyan/purple holographic glow accents
 *  - Metallic borders with subtle inner light
 *  - Premium trading-card aesthetic with rounded corners
 *  - Full EAGOH artwork (reused from stored image — never regenerated)
 *
 * Props are intentionally generic so this component can be reused for:
 *  - Marketplace Listings (starting price, listing URL)
 *  - Public Profiles (creator focus, profile URL)
 *  - Verified Shares (verification badge prominence)
 *  - Featured EAGOHs (quality score, domain showcase)
 *  - Exchange Promotions (pricing tiers)
 *  - Future advertisements
 */

import { palette } from "@/constants/colors";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { BadgeCheck, Dna, Globe, Sparkles, Star, Zap } from "lucide-react-native";
import React, { memo, useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

// ── Types ────────────────────────────────────────────────────────────────

export type PremiumShareCardData = {
  /** Full EAGOH artwork URL (stored image — never regenerated) */
  imageUri: string | null;
  /** EAGOH name or profile display name */
  name: string;
  /** Creator / vendor / profile owner name */
  creator: string;
  /** Intelligence domain label (e.g. "Sports", "Music", "Technology") */
  domain: string;
  /** Role within the domain (e.g. "Quarterback", "Producer") — null if N/A */
  role: string | null;
  /** DNA archetype tags (e.g. ["Tactical", "Aggressive", "Analytical"]) */
  dnaTags: string[] | null;
  /** Quality / reputation score (0-100 scale) */
  qualityScore: number;
  /** Starting price per day in EC (null for non-marketplace cards) */
  startingPrice: number | null;
  /** Public listing or profile URL */
  listingUrl: string;
  /** Whether the creator/vendor is social-verified */
  isVerified: boolean;
};

// ── Layout constants (logical points; 3× → 1080×1350 on capture) ──────────

export const PREMIUM_CARD_ASPECT = 1080 / 1350;

const CARD_W = 360;
const CARD_H = Math.round(CARD_W / PREMIUM_CARD_ASPECT); // 450
const SCALE = 1080 / CARD_W; // 3×
const SAFE_PAD = Math.ceil(40 / SCALE); // ≈14 logical pts → 42px at export

// Image section: ~42% of card height — generous space for full EAGOH artwork
const IMAGE_SECTION_BASE = 190; // ≈42% of 450 → 570px at export
const IMAGE_SECTION_MIN = 140;
const IMAGE_SECTION_MAX = 210;

// ── Component ──────────────────────────────────────────────────────────────

const PremiumShareCard = memo(function PremiumShareCard({
  data,
  onReady,
}: {
  data: PremiumShareCardData;
  /**
   * Called once the EAGOH image has finished loading (or immediately if no
   * image). The caller should then capture the card via react-native-view-shot.
   */
  onReady?: () => void;
}): JSX.Element {
  const [imageLoaded, setImageLoaded] = useState(!data.imageUri);
  const [imageHeight, setImageHeight] = useState(IMAGE_SECTION_BASE);

  const handleImageLoad = useCallback(() => {
    setImageLoaded(true);
  }, []);

  useEffect(() => {
    if (imageLoaded && onReady) {
      onReady();
    }
  }, [imageLoaded, onReady]);

  // Dynamic image height — shrink if content overflows
  const handleContentLayout = useCallback((e: { nativeEvent: { layout: { height: number } } }) => {
    const measuredHeight = e.nativeEvent.layout.height;
    const availableForContent = CARD_H - 2 * SAFE_PAD - imageHeight;
    if (measuredHeight > availableForContent + 1 && imageHeight > IMAGE_SECTION_MIN) {
      const overflow = measuredHeight - availableForContent;
      const newImageHeight = Math.max(IMAGE_SECTION_MIN, imageHeight - overflow - 4);
      setImageHeight(newImageHeight);
    }
  }, [imageHeight]);

  const s = useStyles(imageHeight);

  return (
    <View style={s.card}>
      {/* ── Layered background gradients ── */}
      <LinearGradient
        colors={["#03060B", "#07111F", "#0A1426", "#03060B"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Holographic top glow — cyan */}
      <View style={s.topGlowCyan} />
      {/* Holographic bottom glow — purple */}
      <View style={s.bottomGlowViolet} />

      {/* ── Metallic border overlay ── */}
      <View style={s.metallicBorder} />
      <View style={s.innerBorder} />

      {/* ── Safe-padded inner container ── */}
      <View style={s.safeArea}>
        {/* EAGOH Image — top ~42%, contain mode so nothing crops */}
        <View style={s.imageSection}>
          <View style={s.imageContainer}>
            {/* Subtle radial spotlight behind EAGOH */}
            <View style={s.imageSpotlight} />
            {data.imageUri ? (
              <Image
                source={{ uri: data.imageUri }}
                style={s.eagohImage}
                contentFit="contain"
                transition={0}
                onLoad={handleImageLoad}
              />
            ) : (
              <View style={[s.eagohImage, s.eagohPlaceholder]} onLayout={handleImageLoad}>
                <Sparkles color={palette.cyan} size={40} />
              </View>
            )}
          </View>
          {/* Gradient blend at image bottom */}
          <LinearGradient
            colors={["rgba(3,6,11,0)", "rgba(3,6,11,0.7)"]}
            style={s.imageGradient}
          />
        </View>

        {/* Content section */}
        <View style={s.contentSection} onLayout={handleContentLayout}>
          {/* Domain badge — top of content */}
          <View style={s.domainRow}>
            <View style={s.domainBadge}>
              <Globe color={palette.cyan} size={11} />
              <Text style={s.domainText}>{data.domain}</Text>
            </View>
            {data.isVerified && (
              <View style={s.verifiedBadge}>
                <BadgeCheck color={palette.cyan} size={12} />
                <Text style={s.verifiedText}>Verified</Text>
              </View>
            )}
          </View>

          {/* EAGOH name — large, responsive */}
          <Text
            style={s.eagohName}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            ellipsizeMode="tail"
          >
            {data.name}
          </Text>

          {/* Role (if available) */}
          {data.role && (
            <Text style={s.roleText} numberOfLines={1} ellipsizeMode="tail">
              {data.role}
            </Text>
          )}

          {/* DNA tags */}
          {data.dnaTags && data.dnaTags.length > 0 && (
            <View style={s.dnaRow}>
              <Dna color={palette.violet} size={10} />
              {data.dnaTags.map((tag) => (
                <View key={tag} style={s.dnaTag}>
                  <Text style={s.dnaTagText}>{tag}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Stats row — quality score + starting price */}
          <View style={s.statsRow}>
            {/* Quality score */}
            <View style={s.statItem}>
              <View style={s.statHeader}>
                <Star color={palette.gold} size={10} />
                <Text style={s.statLabel}>Quality</Text>
              </View>
              <Text style={s.statValue}>{data.qualityScore}</Text>
            </View>

            {/* Divider */}
            <View style={s.statDivider} />

            {/* Starting price */}
            {data.startingPrice !== null ? (
              <View style={s.statItem}>
                <View style={s.statHeader}>
                  <Zap color={palette.cyan} size={10} />
                  <Text style={s.statLabel}>From</Text>
                </View>
                <Text style={s.statValue}>{data.startingPrice} EC/day</Text>
              </View>
            ) : (
              <View style={s.statItem}>
                <View style={s.statHeader}>
                  <Sparkles color={palette.violet} size={10} />
                  <Text style={s.statLabel}>EAGOH</Text>
                </View>
                <Text style={s.statValue}>Analyst</Text>
              </View>
            )}

            {/* Divider */}
            <View style={s.statDivider} />

            {/* Creator */}
            <View style={s.statItem}>
              <View style={s.statHeader}>
                <BadgeCheck color={palette.blue} size={10} />
                <Text style={s.statLabel}>Creator</Text>
              </View>
              <Text style={s.statCreatorName} numberOfLines={1} ellipsizeMode="tail">
                {data.creator}
              </Text>
            </View>
          </View>

          {/* Spacer pushes footer to bottom */}
          <View style={{ flex: 1 }} />

          {/* Footer — EAGOH Marketplace branding */}
          <View style={s.footer}>
            <View style={s.footerLeft}>
              <View style={s.footerLogo}>
                <Sparkles color={palette.cyan} size={14} />
              </View>
              <View style={s.footerBrandSection}>
                <Text style={s.footerBrand}>EAGOH</Text>
                <Text style={s.footerSubbrand}>Marketplace</Text>
              </View>
            </View>
            <Text style={s.footerTagline}>Powered by Human Experience + AI</Text>
          </View>
        </View>
      </View>
    </View>
  );
});

export default PremiumShareCard;

// ── Styles ──────────────────────────────────────────────────────────────────

function useStyles(imageHeight: number) {
  return React.useMemo(
    () =>
      StyleSheet.create({
        card: {
          width: CARD_W,
          height: CARD_H,
          borderRadius: 16,
          overflow: "hidden",
          backgroundColor: "#03060B",
        },
        // Holographic glows
        topGlowCyan: {
          position: "absolute",
          top: -50,
          left: -30,
          width: 220,
          height: 220,
          borderRadius: 110,
          backgroundColor: "rgba(108,230,255,0.14)",
          blurRadius: 50,
        },
        bottomGlowViolet: {
          position: "absolute",
          bottom: -50,
          right: -30,
          width: 200,
          height: 200,
          borderRadius: 100,
          backgroundColor: "rgba(138,92,255,0.12)",
          blurRadius: 50,
        },
        // Metallic borders
        metallicBorder: {
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: 16,
          borderWidth: 1.5,
          borderColor: "rgba(108,230,255,0.35)",
        },
        innerBorder: {
          position: "absolute",
          top: 3,
          left: 3,
          right: 3,
          bottom: 3,
          borderRadius: 13,
          borderWidth: 0.5,
          borderColor: "rgba(138,92,255,0.20)",
        },
        // Safe-padded inner container
        safeArea: {
          flex: 1,
          padding: SAFE_PAD,
          flexDirection: "column" as const,
        },
        // Image section
        imageSection: {
          width: "100%",
          height: imageHeight,
          position: "relative" as const,
          marginBottom: 10,
        },
        imageContainer: {
          flex: 1,
          borderRadius: 10,
          overflow: "hidden",
          backgroundColor: "#07111F",
          alignItems: "center" as const,
          justifyContent: "center" as const,
          borderWidth: 1,
          borderColor: "rgba(108,230,255,0.15)",
        },
        imageSpotlight: {
          position: "absolute",
          top: "50%" as const,
          left: "50%" as const,
          width: 140,
          height: 140,
          borderRadius: 70,
          backgroundColor: "rgba(108,230,255,0.08)",
          transform: [{ translateX: -70 }, { translateY: -70 }],
        },
        eagohImage: {
          width: "100%",
          height: "100%",
        },
        eagohPlaceholder: {
          alignItems: "center" as const,
          justifyContent: "center" as const,
        },
        imageGradient: {
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 40,
        },
        // Content section
        contentSection: {
          flex: 1,
          flexDirection: "column" as const,
          gap: 6,
        },
        // Domain row
        domainRow: {
          flexDirection: "row" as const,
          alignItems: "center" as const,
          justifyContent: "space-between" as const,
        },
        domainBadge: {
          flexDirection: "row" as const,
          alignItems: "center" as const,
          gap: 4,
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: 5,
          backgroundColor: "rgba(108,230,255,0.12)",
          borderWidth: 1,
          borderColor: "rgba(108,230,255,0.3)",
        },
        domainText: {
          color: palette.cyan,
          fontSize: 10,
          fontWeight: "900" as const,
          letterSpacing: 0.5,
          textTransform: "uppercase" as const,
        },
        verifiedBadge: {
          flexDirection: "row" as const,
          alignItems: "center" as const,
          gap: 3,
          paddingHorizontal: 7,
          paddingVertical: 3,
          borderRadius: 5,
          backgroundColor: "rgba(61,165,255,0.14)",
          borderWidth: 1,
          borderColor: "rgba(61,165,255,0.35)",
        },
        verifiedText: {
          color: palette.blue,
          fontSize: 9,
          fontWeight: "900" as const,
          letterSpacing: 0.3,
        },
        // EAGOH name
        eagohName: {
          color: palette.text,
          fontSize: 22,
          fontWeight: "900" as const,
          letterSpacing: -0.3,
          lineHeight: 26,
        },
        // Role
        roleText: {
          color: palette.violet,
          fontSize: 12,
          fontWeight: "800" as const,
          letterSpacing: 0.3,
        },
        // DNA tags
        dnaRow: {
          flexDirection: "row" as const,
          alignItems: "center" as const,
          gap: 4,
          flexWrap: "wrap" as const,
        },
        dnaTag: {
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: 4,
          backgroundColor: "rgba(138,92,255,0.14)",
          borderWidth: 1,
          borderColor: "rgba(138,92,255,0.3)",
        },
        dnaTagText: {
          color: palette.violet,
          fontSize: 9,
          fontWeight: "800" as const,
        },
        // Stats row
        statsRow: {
          flexDirection: "row" as const,
          alignItems: "center" as const,
          gap: 6,
          marginTop: 4,
          paddingVertical: 8,
          paddingHorizontal: 10,
          borderRadius: 8,
          backgroundColor: "rgba(3,6,11,0.6)",
          borderWidth: 1,
          borderColor: "rgba(120,180,255,0.12)",
        },
        statItem: {
          flex: 1,
          gap: 2,
        },
        statHeader: {
          flexDirection: "row" as const,
          alignItems: "center" as const,
          gap: 3,
        },
        statLabel: {
          color: palette.muted,
          fontSize: 8,
          fontWeight: "800" as const,
          letterSpacing: 0.5,
          textTransform: "uppercase" as const,
        },
        statValue: {
          color: palette.text,
          fontSize: 13,
          fontWeight: "900" as const,
        },
        statCreatorName: {
          color: palette.blue,
          fontSize: 11,
          fontWeight: "800" as const,
        },
        statDivider: {
          width: 1,
          height: 28,
          backgroundColor: "rgba(120,180,255,0.15)",
        },
        // Footer
        footer: {
          flexDirection: "row" as const,
          alignItems: "center" as const,
          justifyContent: "space-between" as const,
          paddingTop: 8,
          borderTopWidth: 1,
          borderTopColor: "rgba(120,180,255,0.12)",
        },
        footerLeft: {
          flexDirection: "row" as const,
          alignItems: "center" as const,
          gap: 6,
        },
        footerLogo: {
          width: 26,
          height: 26,
          borderRadius: 6,
          backgroundColor: "rgba(108,230,255,0.12)",
          borderWidth: 1,
          borderColor: "rgba(108,230,255,0.3)",
          alignItems: "center" as const,
          justifyContent: "center" as const,
        },
        footerBrandSection: {
          gap: 0,
        },
        footerBrand: {
          color: palette.cyan,
          fontSize: 12,
          fontWeight: "900" as const,
          letterSpacing: 1.5,
        },
        footerSubbrand: {
          color: palette.muted,
          fontSize: 8,
          fontWeight: "800" as const,
          letterSpacing: 0.8,
        },
        footerTagline: {
          color: palette.muted,
          fontSize: 7,
          fontWeight: "700" as const,
          letterSpacing: 0.3,
        },
      }),
    [imageHeight],
  );
}
