import * as Haptics from "expo-haptics";
import { useProfile } from "@/providers/ProfileProvider";

/**
 * Wraps expo-haptics with the user's hapticsEnabled preference.
 * All haptics calls silently no-op when the preference is disabled
 * or when the profile/haptics context is unavailable.
 *
 * Safe by default — never crashes during initial auth loading,
 * profile loading, logged-out state, Expo Go preview, or
 * provider initialization.
 */
export function useHaptics(): {
  selection: () => void;
  notification: (type: Haptics.NotificationFeedbackType) => void;
  impact: (style: Haptics.ImpactFeedbackStyle) => void;
  light: () => void;
  medium: () => void;
  heavy: () => void;
  success: () => void;
  warning: () => void;
  error: () => void;
} {
  // Safe access — useProfile may return a context where profile is null
  // during initial auth loading. Hooks MUST NOT be wrapped in try/catch
  // as it violates React's Rules of Hooks by making hook registration
  // non-deterministic across renders.
  const profileContext = useProfile();

  const enabled =
    (profileContext?.profile?.preferences?.hapticsEnabled ?? true) !== false;

  const selection = (): void => {
    if (!enabled) return;
    try {
      Haptics.selectionAsync().catch(() => undefined);
    } catch {
      // Haptics unavailable; do not crash.
    }
  };

  const notification = (type: Haptics.NotificationFeedbackType): void => {
    if (!enabled) return;
    try {
      Haptics.notificationAsync(type).catch(() => undefined);
    } catch {
      // Haptics unavailable; do not crash.
    }
  };

  const impact = (style: Haptics.ImpactFeedbackStyle): void => {
    if (!enabled) return;
    try {
      Haptics.impactAsync(style).catch(() => undefined);
    } catch {
      // Haptics unavailable; do not crash.
    }
  };

  // Shortcut helpers for common patterns
  const light = (): void => impact(Haptics.ImpactFeedbackStyle.Light);
  const medium = (): void => impact(Haptics.ImpactFeedbackStyle.Medium);
  const heavy = (): void => impact(Haptics.ImpactFeedbackStyle.Heavy);
  const success = (): void => notification(Haptics.NotificationFeedbackType.Success);
  const warning = (): void => notification(Haptics.NotificationFeedbackType.Warning);
  const err = (): void => notification(Haptics.NotificationFeedbackType.Error);

  return { selection, notification, impact, light, medium, heavy, success, warning, error: err };
}
