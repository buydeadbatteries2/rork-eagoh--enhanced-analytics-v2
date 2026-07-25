/**
 * Shared page header used by Sessions and Forge pages.
 * Displays a small uppercase kicker label and a large title below it —
 * matching the cybernetic EAGOH brand typography.
 * Theme-aware: responds to light/dark mode preference.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "@/providers/ThemeProvider";

export interface EagohPageHeaderProps {
  kicker: string;
  title: string;
  /** Optional slot rendered after the title (e.g. an empty-state banner). */
  children?: React.ReactNode;
}

export default function EagohPageHeader({ kicker, title, children }: EagohPageHeaderProps): JSX.Element {
  const { palette: pal } = useAppTheme();

  return (
    <View style={styles.hero}>
      <Text style={[styles.kicker, { color: pal.cyan }]}>{kicker}</Text>
      <Text style={[styles.title, { color: pal.text }]}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { marginBottom: 14 },
  kicker: {
    fontSize: 10,
    fontWeight: "900" as const,
    letterSpacing: 2.2,
    marginBottom: 4,
  },
  title: {
    fontSize: 26,
    fontWeight: "900" as const,
    letterSpacing: -0.6,
  },
});
