import { Image, type ImageContentFit } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Hexagon } from "lucide-react-native";
import React, { memo, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { palette } from "@/constants/colors";

export type RenderTone = "cyan" | "gold" | "violet" | "ember" | "success";

type OptimizedEagohImageProps = {
  tone: RenderTone;
  label: string;
  size?: "compact" | "banner" | "profile" | "card";
  highResolution?: boolean;
  /** Actual EAGOH image URL (thumbnail or full). When provided, displays the real image as the primary visual. */
  imageUrl?: string | null;
  /** Image fit mode — "contain" keeps the full EAGOH visible without clipping. Defaults to "cover". */
  contentFit?: ImageContentFit;
  /** Show the name label overlay on the image. Defaults to true. */
  showLabel?: boolean;
};

export const LIST_PERFORMANCE_PROPS = {
  removeClippedSubviews: true,
  initialNumToRender: 3,
  maxToRenderPerBatch: 2,
  updateCellsBatchingPeriod: 80,
  windowSize: 4,
} as const;

export const HORIZONTAL_LIST_PERFORMANCE_PROPS = {
  removeClippedSubviews: true,
  initialNumToRender: 2,
  maxToRenderPerBatch: 2,
  updateCellsBatchingPeriod: 90,
  windowSize: 3,
} as const;

export function renderToneColor(tone: RenderTone): string {
  if (tone === "gold") return palette.gold;
  if (tone === "violet") return palette.violet;
  if (tone === "ember") return palette.ember;
  if (tone === "success") return palette.success;
  return palette.cyan;
}

/** Lightweight image render. Displays the real EAGOH image when imageUrl is provided, otherwise shows a decorative cybernetic placeholder. */
export const OptimizedEagohImage = memo(function OptimizedEagohImage({ tone, label, size = "compact", highResolution = false, imageUrl, contentFit = "cover", showLabel = true }: OptimizedEagohImageProps): JSX.Element {
  const color = renderToneColor(tone);
  const dimensions = size === "profile" ? styles.profile : size === "banner" ? styles.banner : size === "card" ? styles.card : styles.compact;
  const fallbackUri = useMemo<string>(() => {
    return `https://images.unsplash.com/photo-1518005020951-eccb494ad742?w=${highResolution ? 720 : 240}&q=${highResolution ? 72 : 35}&fm=webp&fit=crop&auto=format&sat=-70&blend=${color.replace("#", "")}&blend-mode=screen&blend-alpha=22&eagoh=${highResolution ? "hires" : "thumb"}-${label}`;
  }, [color, highResolution, label]);

  const hasRealImage = !!imageUrl;

  return (
    <View style={[styles.shell, dimensions]}>
      <Image
        source={{ uri: imageUrl ?? fallbackUri }}
        style={StyleSheet.absoluteFill}
        contentFit={hasRealImage ? contentFit : "cover"}
        cachePolicy="memory-disk"
        transition={120}
        recyclingKey={hasRealImage ? `img-${imageUrl?.slice(-24)}` : `${tone}-${label}-${size}`}
        placeholder={{ blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj" }}
      />
      {!hasRealImage && (
        <>
          <LinearGradient colors={[`${color}44`, "rgba(255,255,255,0.03)", palette.void]} style={StyleSheet.absoluteFill} />
          <View style={[styles.ring, { borderColor: color }]} />
          <Hexagon color={color} size={size === "profile" ? 58 : 38} strokeWidth={1.4} />
          <Text style={[styles.label, { color }]}>{label}</Text>
        </>
      )}
      {hasRealImage && (
        <>
          <LinearGradient colors={["rgba(3,6,11,0.0)", palette.panel]} style={StyleSheet.absoluteFill} />
          {showLabel && (
            <Text style={[styles.label, { color: "rgba(255,255,255,0.85)" }]}>{label}</Text>
          )}
        </>
      )}
      <View style={[styles.ring, { borderColor: color, opacity: hasRealImage ? 0.35 : 0.72 }]} />
    </View>
  );
});

const styles = StyleSheet.create({
  shell: { overflow: "hidden", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", backgroundColor: palette.void },
  compact: { width: 104, minHeight: 128, borderRadius: 5 },
  banner: { width: 116, minHeight: 136, borderRadius: 5 },
  profile: { width: 150, height: 230, borderRadius: 5 },
  card: { width: "100%", aspectRatio: 0.75, borderRadius: 5 },
  ring: { position: "absolute", width: "62%", aspectRatio: 1, borderRadius: 5, borderWidth: 1, opacity: 0.72 },
  label: { position: "absolute", bottom: 12, fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
});
