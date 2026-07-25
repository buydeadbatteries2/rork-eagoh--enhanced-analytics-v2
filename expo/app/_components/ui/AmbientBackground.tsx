import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { palette } from "@/constants/colors";

/**
 * Global ambient background layer.
 * Renders deep navy gradient + neural grid + floating glow orbs + slow scan line.
 * Sits behind every screen via the tabs layout so all pages share one atmosphere.
 */
function AmbientBackground(): JSX.Element {
  const scan = useRef(new Animated.Value(0)).current;
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(scan, { toValue: 1, duration: 8000, useNativeDriver: true }),
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: 6500, useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration: 6500, useNativeDriver: true }),
      ]),
    ).start();
  }, [drift, scan]);

  const scanY = scan.interpolate({ inputRange: [0, 1], outputRange: [-40, 1100] });
  const orbY = drift.interpolate({ inputRange: [0, 1], outputRange: [0, -22] });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={[palette.void, "#050B16", palette.obsidian, "#03070F"]}
        style={StyleSheet.absoluteFill}
      />
      {/* faint neural grid */}
      <View style={styles.grid}>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <View key={`v${i}`} style={[styles.gridLine, { left: `${i * 14}%` }]} />
        ))}
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
          <View key={`h${i}`} style={[styles.gridLineH, { top: `${i * 10}%` }]} />
        ))}
      </View>
      {/* floating glow orbs */}
      <Animated.View style={[styles.orbBlue, { transform: [{ translateY: orbY }] }]} />
      <Animated.View style={[styles.orbViolet, { transform: [{ translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, 18] }) }] }]} />
      <Animated.View style={[styles.orbCyan, { transform: [{ translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, -12] }) }] }]} />
      {/* slow scan line */}
      <Animated.View style={[styles.scanLine, { transform: [{ translateY: scanY }] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { ...StyleSheet.absoluteFillObject, opacity: 0.18 },
  gridLine: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "rgba(108,230,255,0.10)" },
  gridLineH: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: "rgba(108,230,255,0.06)" },
  orbBlue: {
    position: "absolute", top: 80, left: -90, width: 260, height: 260, borderRadius: 130,
    backgroundColor: palette.blue, opacity: 0.10,
  },
  orbViolet: {
    position: "absolute", top: 340, right: -110, width: 300, height: 300, borderRadius: 150,
    backgroundColor: palette.violet, opacity: 0.09,
  },
  orbCyan: {
    position: "absolute", bottom: 120, left: -60, width: 220, height: 220, borderRadius: 110,
    backgroundColor: palette.cyan, opacity: 0.08,
  },
  scanLine: {
    position: "absolute", left: 0, right: 0, height: 90,
    backgroundColor: "rgba(108,230,255,0.04)",
    borderTopWidth: 1, borderTopColor: "rgba(108,230,255,0.18)",
  },
});

export default React.memo(AmbientBackground);
