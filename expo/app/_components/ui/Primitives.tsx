import { LinearGradient } from "expo-linear-gradient";
import { useHaptics } from "@/hooks/useHaptics";
import React, { useCallback } from "react";
import { Animated, Pressable, StyleSheet, Text, View, type ViewStyle, type TextStyle } from "react-native";
import { palette, radii, glow } from "@/constants/colors";

/**
 * Shared themed primitives so every screen feels like part of the same
 * futuristic EAGOH operating system. Import these instead of building
 * one-off cards / buttons / section headers per screen.
 */

export function GlowCard({ children, style, tone = "blue" }: { children: React.ReactNode; style?: ViewStyle; tone?: "blue" | "cyan" | "violet" | "gold" }): JSX.Element {
  const accent = tone === "cyan" ? palette.cyan : tone === "violet" ? palette.violet : tone === "gold" ? palette.gold : palette.blue;
  return (
    <View style={[styles.card, { shadowColor: accent }, style]}>
      <LinearGradient
        colors={["rgba(10,20,40,0.72)", "rgba(7,17,31,0.62)"]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.cardGlow, { backgroundColor: accent }]} />
      {children}
    </View>
  );
}

export function GlowButton({ label, onPress, tone = "blue", style }: { label: string; onPress: () => void; tone?: "blue" | "cyan" | "violet" | "gold"; style?: ViewStyle }): JSX.Element {
  const h = useHaptics();
  const accent = tone === "cyan" ? palette.cyan : tone === "violet" ? palette.violet : tone === "gold" ? palette.gold : palette.blue;
  const handlePress = useCallback((): void => {
    h.selection();
    onPress();
  }, [onPress, h]);
  return (
    <Pressable onPress={handlePress} style={({ pressed }) => [styles.button, { backgroundColor: accent, shadowColor: accent }, pressed && styles.pressed, style]}>
      <Text style={[styles.buttonLabel, { color: palette.void }]}>{label}</Text>
    </Pressable>
  );
}

export function GhostButton({ label, onPress, style }: { label: string; onPress: () => void; style?: ViewStyle }): JSX.Element {
  const h = useHaptics();
  const handlePress = useCallback((): void => {
    h.selection();
    onPress();
  }, [onPress, h]);
  return (
    <Pressable onPress={handlePress} style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed, style]}>
      <Text style={styles.ghostLabel}>{label}</Text>
    </Pressable>
  );
}

export function SectionTitle({ eyebrow, title, action, style }: { eyebrow: string; title: string; action?: string; style?: ViewStyle }): JSX.Element {
  return (
    <View style={[styles.section, style]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.title}>{title}</Text>
      </View>
      {action ? <Text style={styles.action}>{action}</Text> : null}
    </View>
  );
}

export function NeonDivider({ tone = "blue" }: { tone?: "blue" | "cyan" | "violet" | "gold" }): JSX.Element {
  const accent = tone === "cyan" ? palette.cyan : tone === "violet" ? palette.violet : tone === "gold" ? palette.gold : palette.blue;
  return (
    <View style={styles.dividerRow}>
      <View style={[styles.dividerDot, { backgroundColor: accent, shadowColor: accent }]} />
      <View style={[styles.dividerLine, { backgroundColor: `${accent}33` }]} />
      <View style={[styles.dividerDot, { backgroundColor: accent, shadowColor: accent }]} />
    </View>
  );
}

export function NeonPill({ label, tone = "blue", style }: { label: string; tone?: "blue" | "cyan" | "violet" | "gold" | "success" | "muted"; style?: ViewStyle }): JSX.Element {
  const accent = tone === "cyan" ? palette.cyan : tone === "violet" ? palette.violet : tone === "gold" ? palette.gold : tone === "success" ? palette.success : tone === "muted" ? palette.muted : palette.blue;
  return (
    <View style={[styles.pill, { borderColor: `${accent}55`, backgroundColor: `${accent}14` }, style]}>
      <View style={[styles.pillDot, { backgroundColor: accent }]} />
      <Text style={[styles.pillLabel, { color: accent } as TextStyle]}>{label}</Text>
    </View>
  );
}

const PulseDotComponent = ({ tone = "cyan", size = 8 }: { tone?: "blue" | "cyan" | "violet" | "gold" | "success"; size?: number }): JSX.Element => {
  const accent = tone === "blue" ? palette.blue : tone === "violet" ? palette.violet : tone === "gold" ? palette.gold : tone === "success" ? palette.success : palette.cyan;
  const pulse = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, useNativeDriver: true }),
      ]),
    ).start();
  }, [pulse]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] });
  return (
    <View style={{ width: size * 2, height: size * 2, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{ position: "absolute", width: size, height: size, borderRadius: size / 2, backgroundColor: accent, opacity, transform: [{ scale }] }} />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: accent }} />
    </View>
  );
};
export const PulseDot = React.memo(PulseDotComponent);

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.xl,
    padding: 18,
    borderWidth: 1,
    borderColor: palette.line,
    overflow: "hidden",
    ...glow.blue,
    shadowOpacity: 0.22,
  },
  cardGlow: { position: "absolute", right: -40, top: -40, width: 130, height: 130, borderRadius: 65, opacity: 0.14 },
  button: {
    minHeight: 52,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
  },
  buttonLabel: { fontSize: 14, fontWeight: "900", letterSpacing: 1.4 },
  ghostButton: {
    minHeight: 50,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: "rgba(108,230,255,0.06)",
  },
  ghostLabel: { color: palette.cyan, fontSize: 13, fontWeight: "900", letterSpacing: 1.2 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  section: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 12, gap: 10 },
  eyebrow: { color: palette.blue, fontSize: 11, fontWeight: "900", letterSpacing: 2.2 },
  title: { color: palette.text, fontSize: 22, fontWeight: "900", letterSpacing: -0.4, marginTop: 4 },
  action: { color: palette.cyan, fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 8 },
  dividerDot: { width: 6, height: 6, borderRadius: 3, shadowOpacity: 0.8, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  dividerLine: { flex: 1, height: 1 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill, borderWidth: 1 },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillLabel: { fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
});
