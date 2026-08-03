/**
 * FreeUserWelcomePopup — daily promotional popup shown only to Free-tier users.
 *
 * Displays once per calendar day per authenticated user. Never appears for
 * paid subscribers (Pro, Oracle Elite, Syndicate). Waits for subscription
 * state to finish loading before deciding to show.
 *
 * Uses the existing normalized `effectiveSubscriptionTier` from useProfile(),
 * which works identically in Expo Go (test tier override) and TestFlight
 * (real RevenueCat entitlements).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { BrainCircuit, Check, Crown, X, Zap } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { palette } from "@/constants/colors";
import { useAuth } from "@/providers/AuthProvider";
import { useProfile } from "@/providers/ProfileProvider";
import { useHaptics } from "@/hooks/useHaptics";

// ── Message rotation ─────────────────────────────────────────────────────────

type WelcomeMessage = {
  title: string;
  body: string;
};

const WELCOME_MESSAGES: readonly WelcomeMessage[] = [
  {
    title: "Welcome back, brainiac.",
    body: "Your EAGOH is ready to think—but the Free plan is keeping some of its best neurons locked away.",
  },
  {
    title: "Your EAGOH called.",
    body: "It wants a bigger brain. Free neurons are nice, but a fully powered EAGOH is a different beast.",
  },
  {
    title: "Free neurons are cool.",
    body: "A fully powered EAGOH is cooler. Unlock the full lab and watch your intelligence go nuclear.",
  },
  {
    title: "Your EAGOH has ambition.",
    body: "Your Free plan has limits. Give it the neurons it deserves and see what it can really do.",
  },
  {
    title: "Welcome back.",
    body: "Ready to unlock the rest of the lab? Your EAGOH is waiting at the door.",
  },
  {
    title: "Your analysis is warming up.",
    body: "Give it more neurons. The Free plan is a taste—upgrade for the full intellectual feast.",
  },
] as const;

// ── Paid benefits list ───────────────────────────────────────────────────────

const PAID_BENEFITS: readonly { icon: React.ReactNode; label: string }[] = [
  { icon: <Zap color={palette.cyan} size={15} />, label: "More monthly neurons" },
  { icon: <BrainCircuit color={palette.cyan} size={15} />, label: "More EAGOH slots" },
  { icon: <Check color={palette.cyan} size={15} />, label: "Open Intelligence" },
  { icon: <Check color={palette.cyan} size={15} />, label: "Advanced analysis sessions" },
  { icon: <Check color={palette.cyan} size={15} />, label: "Forge customization" },
  { icon: <Check color={palette.cyan} size={15} />, label: "Faction access" },
  { icon: <Check color={palette.cyan} size={15} />, label: "Exchange features" },
] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns today's date key in YYYY-MM-DD format (UTC). */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Builds the AsyncStorage key for a given user and day. */
function storageKey(userId: string, dateKey: string): string {
  return `eagoh_free_popup_${userId}_${dateKey}`;
}

/** Picks a message deterministically by date so it's stable within a day. */
function messageForDate(dateKey: string): WelcomeMessage {
  // Simple hash from the date string to pick an index — stable per day,
  // rotates across days.
  let hash = 0;
  for (let i = 0; i < dateKey.length; i++) {
    hash = (hash * 31 + dateKey.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % WELCOME_MESSAGES.length;
  return WELCOME_MESSAGES[idx];
}

// ── Component ────────────────────────────────────────────────────────────────

export function FreeUserWelcomePopup(): JSX.Element | null {
  const { user } = useAuth();
  const { effectiveSubscriptionTier, isTierLoading } = useProfile();
  const h = useHaptics();
  const router = useRouter();

  const [visible, setVisible] = useState<boolean>(false);
  const [message, setMessage] = useState<WelcomeMessage>(WELCOME_MESSAGES[0]);
  const [scaleAnim] = useState<Animated.Value>(new Animated.Value(0.85));
  const [opacityAnim] = useState<Animated.Value>(new Animated.Value(0));

  const userId = user?.id ?? null;

  // ── Decide whether to show the popup ────────────────────────────────────
  // Wait until subscription state is loaded. Only show for free users.
  // Check AsyncStorage for today's date key.
  useEffect(() => {
    if (!userId || isTierLoading) return;

    // Only show for free tier — never for paid subscribers
    if (effectiveSubscriptionTier !== "free") return;

    const dateKey = todayKey();
    const key = storageKey(userId, dateKey);

    let cancelled = false;

    AsyncStorage.getItem(key)
      .then((shown) => {
        if (cancelled || shown === "true") return;
        setMessage(messageForDate(dateKey));
        setVisible(true);
      })
      .catch(() => {
        // AsyncStorage read failed — don't show popup to avoid spamming
      });

    return () => {
      cancelled = true;
    };
  }, [userId, effectiveSubscriptionTier, isTierLoading]);

  // ── Entrance animation ──────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 8,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, scaleAnim, opacityAnim]);

  // ── Mark as shown for today and close ───────────────────────────────────
  const dismissForToday = useCallback((): void => {
    if (!userId) return;
    h.light();
    const dateKey = todayKey();
    const key = storageKey(userId, dateKey);
    AsyncStorage.setItem(key, "true").catch(() => {
      // Best-effort — if AsyncStorage fails, the popup may reappear,
      // but that's a minor UX issue, not a crash.
    });
    // Animate out then hide
    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 0.85,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setVisible(false);
      // Reset for next potential show
      scaleAnim.setValue(0.85);
      opacityAnim.setValue(0);
    });
  }, [userId, h, scaleAnim, opacityAnim]);

  // ── Navigate to subscription page ───────────────────────────────────────
  const handleUnlock = useCallback((): void => {
    if (!userId) return;
    // Mark as shown so it doesn't reappear after navigating back
    const dateKey = todayKey();
    AsyncStorage.setItem(storageKey(userId, dateKey), "true").catch(() => {});
    h.selection();
    setVisible(false);
    scaleAnim.setValue(0.85);
    opacityAnim.setValue(0);
    router.push("/subscription" as never);
  }, [userId, h, router, scaleAnim, opacityAnim]);

  if (!visible) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={dismissForToday}
      statusBarTranslucent
    >
      <Pressable style={popupStyles.backdrop} onPress={dismissForToday}>
        <Animated.View
          style={[
            popupStyles.backdropFade,
            { opacity: opacityAnim },
          ]}
        />
        <Pressable onPress={(e) => e.stopPropagation()} style={popupStyles.centerWrap}>
          <Animated.View
            style={[
              popupStyles.card,
              {
                transform: [{ scale: scaleAnim }],
                opacity: opacityAnim,
              },
            ]}
          >
            <LinearGradient
              colors={["rgba(108,230,255,0.12)", "rgba(138,92,255,0.08)", "rgba(255,184,77,0.06)"]}
              style={StyleSheet.absoluteFill}
            />

            {/* X close button */}
            <Pressable
              onPress={dismissForToday}
              hitSlop={12}
              style={popupStyles.closeBtn}
            >
              <X color={palette.muted} size={20} />
            </Pressable>

            {/* Brain icon */}
            <View style={popupStyles.iconWrap}>
              <LinearGradient
                colors={["rgba(108,230,255,0.22)", "rgba(138,92,255,0.14)"]}
                style={StyleSheet.absoluteFill}
              />
              <BrainCircuit color={palette.cyan} size={34} />
            </View>

            {/* Title */}
            <Text style={popupStyles.title}>{message.title}</Text>

            {/* Body */}
            <Text style={popupStyles.body}>{message.body}</Text>

            {/* Benefits list */}
            <View style={popupStyles.benefitsWrap}>
              {PAID_BENEFITS.map((benefit, i) => (
                <View key={i} style={popupStyles.benefitRow}>
                  <View style={popupStyles.benefitIcon}>{benefit.icon}</View>
                  <Text style={popupStyles.benefitText}>{benefit.label}</Text>
                </View>
              ))}
            </View>

            {/* Buttons */}
            <Pressable
              onPress={handleUnlock}
              style={({ pressed }) => [
                popupStyles.primaryBtn,
                pressed && popupStyles.pressed,
              ]}
            >
              <Crown color={palette.void} size={17} />
              <Text style={popupStyles.primaryBtnText}>Unlock More Neurons</Text>
            </Pressable>

            <Pressable
              onPress={dismissForToday}
              hitSlop={8}
              style={popupStyles.secondaryBtn}
            >
              <Text style={popupStyles.secondaryBtnText}>Maybe Later</Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const popupStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 100,
  },
  backdropFade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(2, 4, 10, 0.82)",
  },
  centerWrap: {
    zIndex: 1,
  },
  card: {
    width: 330,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "rgba(108,230,255,0.28)",
    backgroundColor: palette.obsidian,
    padding: 24,
    paddingTop: 22,
    overflow: "hidden",
    gap: 14,
    shadowColor: palette.cyan,
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  closeBtn: {
    position: "absolute",
    top: 14,
    right: 14,
    width: 32,
    height: 32,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.panel,
    zIndex: 2,
  },
  iconWrap: {
    width: 58,
    height: 58,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "rgba(108,230,255,0.32)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  title: {
    color: palette.text,
    fontSize: 24,
    fontWeight: "900" as const,
    letterSpacing: -0.5,
    lineHeight: 30,
  },
  body: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: "700" as const,
    lineHeight: 21,
  },
  benefitsWrap: {
    gap: 9,
    paddingVertical: 4,
  },
  benefitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  benefitIcon: {
    width: 26,
    height: 26,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.panel,
  },
  benefitText: {
    color: palette.text,
    fontSize: 13,
    fontWeight: "700" as const,
  },
  primaryBtn: {
    minHeight: 52,
    borderRadius: 5,
    backgroundColor: palette.cyan,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
    shadowColor: palette.cyan,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
  primaryBtnText: {
    color: palette.void,
    fontSize: 15,
    fontWeight: "900" as const,
  },
  secondaryBtn: {
    alignItems: "center",
    paddingVertical: 10,
  },
  secondaryBtnText: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: "700" as const,
  },
  pressed: {
    transform: [{ scale: 0.97 }],
    opacity: 0.9,
  },
});
