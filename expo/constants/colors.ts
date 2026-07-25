/**
 * EAGOH Global Design System – Master visual tokens.
 * All screens import `palette`, so updating values here re-themes the entire app.
 * `theme` exposes radii, spacing, typography, and glow presets for reusable UI primitives.
 */

export const palette = {
  // --- Backgrounds ---
  void: "#02040A",
  obsidian: "#07111F",
  graphite: "#0A1426",
  panel: "rgba(10, 20, 40, 0.55)",
  panelStrong: "#0A1426",

  // --- Semantic aliases (map to background keys) ---
  background: "#02040A",       // → void
  surface: "#07111F",           // → obsidian
  card: "#0A1426",              // → graphite
  inputBackground: "rgba(10, 20, 40, 0.55)",  // → panel
  overlay: "rgba(2, 4, 10, 0.88)",

  // --- Neon glows ---
  blue: "#3DA5FF", // primary glow
  cyan: "#6CE6FF", // secondary glow (alias kept for compatibility)
  violet: "#8A5CFF", // accent glow
  gold: "#FFB547", // warning / highlight
  ember: "#FF4D6D", // danger
  success: "#00FFB2",

  // --- Soft tints ---
  blueSoft: "rgba(61, 165, 255, 0.16)",
  cyanSoft: "rgba(108, 230, 255, 0.16)",
  violetSoft: "rgba(138, 92, 255, 0.16)",
  goldSoft: "rgba(255, 181, 71, 0.14)",
  emberSoft: "rgba(255, 77, 109, 0.14)",
  successSoft: "rgba(0, 255, 178, 0.14)",

  // --- Text & borders ---
  text: "#F4FAFF",              // → textPrimary
  textPrimary: "#F4FAFF",
  muted: "#8DA2B5",             // → textSecondary
  textSecondary: "#8DA2B5",
  line: "rgba(120, 180, 255, 0.18)",   // → border
  border: "rgba(120, 180, 255, 0.18)",
  lineStrong: "rgba(120, 180, 255, 0.32)",

  // --- Input ---
  inputText: "#F4FAFF",
  placeholderText: "#8DA2B5",
};

export const radii = {
  xs: 5,
  sm: 5,
  md: 5,
  lg: 5,
  xl: 5,
  pill: 5,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  xxl: 30,
} as const;

export const glow = {
  blue: { shadowColor: palette.blue, shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 0 } },
  cyan: { shadowColor: palette.cyan, shadowOpacity: 0.4, shadowRadius: 18, shadowOffset: { width: 0, height: 0 } },
  violet: { shadowColor: palette.violet, shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 0 } },
  gold: { shadowColor: palette.gold, shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 0 } },
} as const;

export const typography = {
  eyebrow: { fontSize: 11, fontWeight: "900" as const, letterSpacing: 2.2, color: palette.blue },
  title: { fontSize: 26, fontWeight: "900" as const, letterSpacing: -0.6, color: palette.text },
  body: { fontSize: 14, fontWeight: "700" as const, lineHeight: 21, color: palette.muted },
  stat: { fontSize: 32, fontWeight: "900" as const, letterSpacing: -1, color: palette.text },
  mono: { fontSize: 12, fontWeight: "900" as const, letterSpacing: 1.6, color: palette.cyan },
} as const;

export const theme = { palette, radii, spacing, glow, typography } as const;
