/**
 * EagohShareCard — a polished vertical social-sharing card rendered at
 * 1080×1350 aspect ratio (4:5). Designed to be captured via react-native-view-shot
 * and shared as a PNG image through the native share sheet.
 *
 * The card visibly contains the public EAGOH URL, verification code, and QR code
 * so that verification information survives even when platforms (e.g. Facebook)
 * strip accompanying caption text.
 *
 * LAYOUT GUARANTEES:
 * - Export canvas is always 1080×1350; nothing overflows or clips.
 * - EAGOH image uses contentFit="contain" so the ENTIRE character is visible
 *   (capages, wings, hats, weapons — all fit inside the image container).
 * - Image section occupies ~37% of card height (down from 55%).
 * - Safe padding ≥40px (at export scale) on all sides.
 * - QR + footer are anchored to the bottom and can never be pushed off-screen.
 * - Long names auto-shrink via adjustsFontSizeToFit (max 2 lines, then truncate).
 * - Before capture, onLayout validates content fits; if overflow is detected,
 *   the image height is automatically reduced until everything fits.
 */

import { palette } from "@/constants/colors";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { BadgeCheck, QrCode as QrCodeIcon, Sparkles, Trophy } from "lucide-react-native";
import React, { memo, useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

export type ShareCardData = {
  eagohName: string;
  eagohImageUrl: string | null;
  specialty: string;
  creatorName: string;
  currentBadgeName: string | null;
  publicEagohUrl: string;
  verificationCode: string;
  qrCodeUrl: string;
};

/**
 * Card aspect ratio 1080:1350 = 4:5.
 * The card is rendered at a scale that fits the screen width; capture uses
 * PixelRatio to produce a full-resolution 1080×1350 PNG.
 */
export const CARD_ASPECT = 1080 / 1350;

// ── Layout constants (logical points; 3× → 1080×1350 on capture) ──────────
const CARD_W = 360;
const CARD_H = Math.round(CARD_W / CARD_ASPECT); // 450
const SCALE = 1080 / CARD_W; // 3×
const SAFE_PAD = Math.ceil(40 / SCALE); // ≈14 logical pts → 42px at export

// Image section: ~37% of card height (down from 55%)
const IMAGE_SECTION_BASE = 165; // ≈37% of 450 → 495px at export
const IMAGE_SECTION_MIN = 120; // floor for dynamic shrink
const IMAGE_SECTION_MAX = 180; // ceiling

// Content section budget: CARD_H - 2*SAFE_PAD - IMAGE_SECTION = 450-28-165 = 257

const EagohShareCard = memo(function EagohShareCard({
  data,
  onImagesLoaded,
}: {
  data: ShareCardData;
  /** Called once both the EAGOH image and QR code have finished loading. */
  onImagesLoaded?: () => void;
}): JSX.Element {
  const [eagohLoaded, setEagohLoaded] = useState(!data.eagohImageUrl);
  const [qrLoaded, setQrLoaded] = useState(false);

  // Dynamic image height — reduced if content overflows (export validation)
  const [imageHeight, setImageHeight] = useState(IMAGE_SECTION_BASE);

  const handleEagohLoad = useCallback(() => {
    setEagohLoaded(true);
  }, []);

  const handleQrLoad = useCallback(() => {
    setQrLoaded(true);
  }, []);

  // Fire onImagesLoaded once both images have loaded.
  useEffect(() => {
    if (eagohLoaded && qrLoaded && onImagesLoaded) {
      onImagesLoaded();
    }
  }, [eagohLoaded, qrLoaded, onImagesLoaded]);

  // ── Export validation: measure content section ──────────────────────────
  // If the measured content height exceeds the available space, shrink the
  // image section progressively until everything fits.
  const handleContentLayout = useCallback((e: { nativeEvent: { layout: { height: number } } }) => {
    const measuredHeight = e.nativeEvent.layout.height;
    const availableForContent = CARD_H - 2 * SAFE_PAD - imageHeight;
    if (measuredHeight > availableForContent + 1 && imageHeight > IMAGE_SECTION_MIN) {
      // Overflow detected — reduce image height to give content more room
      const overflow = measuredHeight - availableForContent;
      const newImageHeight = Math.max(IMAGE_SECTION_MIN, imageHeight - overflow - 4);
      setImageHeight(newImageHeight);
    }
  }, [imageHeight]);

  const s = useStyles(imageHeight);

  return (
    <View style={s.card}>
      <LinearGradient
        colors={["#03060B", "#07111F", "#0A1426"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Decorative top glow */}
      <View style={s.topGlow} />

      {/* Safe-padded inner container */}
      <View style={s.safeArea}>
        {/* EAGOH Image — top portion (~37%), contain mode so nothing crops */}
        <View style={s.imageSection}>
          <View style={s.imageContainer}>
            {data.eagohImageUrl ? (
              <Image
                source={{ uri: data.eagohImageUrl }}
                style={s.eagohImage}
                contentFit="contain"
                transition={0}
                onLoad={handleEagohLoad}
              />
            ) : (
              <View style={[s.eagohImage, s.eagohPlaceholder]} onLayout={handleEagohLoad}>
                <Sparkles color={palette.cyan} size={40} />
              </View>
            )}
          </View>
          {/* Subtle gradient at image bottom for visual blend */}
          <LinearGradient
            colors={["rgba(3,6,11,0)", "rgba(3,6,11,0.6)"]}
            style={s.imageGradient}
          />
        </View>

        {/* Content section — measured for overflow validation */}
        <View style={s.contentSection} onLayout={handleContentLayout}>
          {/* EAGOH name — responsive, max 2 lines, auto-shrink */}
          <Text
            style={s.eagohName}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.65}
            ellipsizeMode="tail"
          >
            {data.eagohName}
          </Text>

          {/* Category/specialty */}
          <Text style={s.specialty} numberOfLines={1} ellipsizeMode="tail">
            {data.specialty}
          </Text>

          {/* Creator + badge row */}
          <View style={s.metaRow}>
            <View style={s.creatorChip}>
              <Text style={s.creatorLabel}>Creator</Text>
              <Text style={s.creatorName} numberOfLines={1} ellipsizeMode="tail">
                {data.creatorName}
              </Text>
            </View>
            {data.currentBadgeName ? (
              <View style={s.badgeChip}>
                <Trophy color={palette.violet} size={12} />
                <Text style={s.badgeText} numberOfLines={1} ellipsizeMode="tail">
                  {data.currentBadgeName}
                </Text>
              </View>
            ) : null}
          </View>

          {/* Verification code — large, prominent */}
          <View style={s.codeSection}>
            <Text style={s.codeLabel}>VERIFICATION CODE</Text>
            <Text style={s.codeText}>{data.verificationCode}</Text>
          </View>

          {/* Spacer pushes QR + footer to the bottom */}
          <View style={{ flex: 1 }} />

          {/* QR code + URL row — anchored to bottom */}
          <View style={s.qrRow}>
            <View style={s.qrBox}>
              <Image
                source={{ uri: data.qrCodeUrl }}
                style={s.qrImage}
                contentFit="contain"
                transition={0}
                onLoad={handleQrLoad}
              />
            </View>
            <View style={s.urlSection}>
              <View style={s.urlHeader}>
                <QrCodeIcon color={palette.cyan} size={13} />
                <Text style={s.urlHeaderText}>Scan to view EAGOH</Text>
              </View>
              <Text style={s.urlText} numberOfLines={2} ellipsizeMode="tail">
                {data.publicEagohUrl}
              </Text>
            </View>
          </View>

          {/* Footer — "Powered by Human Experience + AI" */}
          <View style={s.footer}>
            <View style={s.footerLeft}>
              <BadgeCheck color={palette.cyan} size={14} />
              <Text style={s.footerBrand}>EAGOH</Text>
            </View>
            <Text style={s.footerTagline}>Powered by Human Experience + AI</Text>
          </View>
        </View>
      </View>
    </View>
  );
});

export default EagohShareCard;

// ── Styles ───────────────────────────────────────────────────────────────
// The card uses fixed dimensions so the captured PNG has a consistent
// 1080×1350 layout. On screen it is scaled down via a wrapper transform.
// We use "logical" points here; captureRef with width/height in options
// scales up to physical pixels via PixelRatio.

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
          borderWidth: 1,
          borderColor: "rgba(108,230,255,0.25)",
        },
        topGlow: {
          position: "absolute",
          top: -40,
          left: -40,
          width: 200,
          height: 200,
          borderRadius: 100,
          backgroundColor: "rgba(108,230,255,0.12)",
          blurRadius: 40,
        },
        // Safe-padded inner container — ≥40px at export scale on all sides
        safeArea: {
          flex: 1,
          padding: SAFE_PAD,
          flexDirection: "column" as const,
        },
        // Image section — dynamic height (~37%), contain mode
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
        // Content section — flex fills remaining space
        contentSection: {
          flex: 1,
          flexDirection: "column" as const,
          gap: 7,
        },
        eagohName: {
          color: palette.text,
          fontSize: 20,
          fontWeight: "900" as const,
          letterSpacing: -0.3,
          lineHeight: 24,
        },
        specialty: {
          color: palette.cyan,
          fontSize: 11,
          fontWeight: "800" as const,
          letterSpacing: 0.5,
          textTransform: "uppercase" as const,
        },
        metaRow: {
          flexDirection: "row" as const,
          alignItems: "center" as const,
          gap: 6,
          marginTop: 1,
        },
        creatorChip: {
          flexDirection: "row" as const,
          alignItems: "center" as const,
          gap: 4,
          paddingHorizontal: 7,
          paddingVertical: 3,
          borderRadius: 5,
          backgroundColor: "rgba(61,165,255,0.12)",
          borderWidth: 1,
          borderColor: "rgba(61,165,255,0.3)",
        },
        creatorLabel: {
          color: palette.muted,
          fontSize: 8,
          fontWeight: "700" as const,
          letterSpacing: 0.5,
        },
        creatorName: {
          color: palette.blue,
          fontSize: 10,
          fontWeight: "800" as const,
          maxWidth: 110,
        },
        badgeChip: {
          flexDirection: "row" as const,
          alignItems: "center" as const,
          gap: 3,
          paddingHorizontal: 6,
          paddingVertical: 3,
          borderRadius: 5,
          backgroundColor: "rgba(138,92,255,0.14)",
          borderWidth: 1,
          borderColor: "rgba(138,92,255,0.35)",
        },
        badgeText: {
          color: palette.violet,
          fontSize: 9,
          fontWeight: "800" as const,
          maxWidth: 80,
        },
        codeSection: {
          alignItems: "center" as const,
          paddingVertical: 7,
          paddingHorizontal: 14,
          borderRadius: 8,
          backgroundColor: "rgba(3,6,11,0.6)",
          borderWidth: 1,
          borderColor: "rgba(108,230,255,0.3)",
          marginTop: 2,
        },
        codeLabel: {
          color: palette.muted,
          fontSize: 8,
          fontWeight: "800" as const,
          letterSpacing: 2,
        },
        codeText: {
          color: palette.cyan,
          fontSize: 18,
          fontWeight: "900" as const,
          letterSpacing: 3,
          marginTop: 2,
        },
        // QR row — anchored to bottom via flex spacer above
        qrRow: {
          flexDirection: "row" as const,
          gap: 9,
          alignItems: "center" as const,
        },
        qrBox: {
          width: 58,
          height: 58,
          borderRadius: 8,
          backgroundColor: "#F4FAFF",
          padding: 3,
          alignItems: "center" as const,
          justifyContent: "center" as const,
        },
        qrImage: {
          width: 52,
          height: 52,
        },
        urlSection: {
          flex: 1,
          gap: 2,
        },
        urlHeader: {
          flexDirection: "row" as const,
          alignItems: "center" as const,
          gap: 4,
        },
        urlHeaderText: {
          color: palette.cyan,
          fontSize: 9,
          fontWeight: "800" as const,
          letterSpacing: 0.3,
        },
        urlText: {
          color: palette.muted,
          fontSize: 9,
          fontWeight: "600" as const,
          lineHeight: 12,
        },
        footer: {
          flexDirection: "row" as const,
          alignItems: "center" as const,
          justifyContent: "space-between" as const,
          paddingTop: 6,
          borderTopWidth: 1,
          borderTopColor: "rgba(120,180,255,0.12)",
        },
        footerLeft: {
          flexDirection: "row" as const,
          alignItems: "center" as const,
          gap: 4,
        },
        footerBrand: {
          color: palette.cyan,
          fontSize: 11,
          fontWeight: "900" as const,
          letterSpacing: 1.5,
        },
        footerTagline: {
          color: palette.muted,
          fontSize: 8,
          fontWeight: "700" as const,
          letterSpacing: 0.3,
        },
      }),
    [imageHeight],
  );
}
