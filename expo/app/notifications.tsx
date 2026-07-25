/**
 * Intelligence Notifications — Phase 6C
 *
 * Notification center accessible from the Profile/Settings screen.
 * Shows unread count, title, message, created date, and read/unread state.
 * Actions: mark one notification as read, mark all as read.
 * Tapping a notification with an entry ID opens My Intelligence.
 *
 * Security:
 *   - All reads go through the secure worker (GET /notifications)
 *   - Mark-read actions go through the secure worker (POST /notifications/mark-read,
 *     POST /notifications/mark-all-read)
 *   - Reporter identity is never included in notifications
 */

import { palette } from "@/constants/colors";
import { useAppTheme } from "@/providers/ThemeProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useSafeBack } from "@/hooks/useSafeBack";
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type IntelligenceNotification,
} from "@/services/openIntelligence";
import {
  Bell,
  BellOff,
  Check,
  CheckCheck,
  ChevronLeft,
  Clock,
  MessageSquare,
  ShieldAlert,
  Star,
  XCircle,
} from "lucide-react-native";
import React, { memo, useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";

// ── Notification icon by type ────────────────────────────────────────────

function notificationIcon(type: string): JSX.Element {
  const size = 16;
  switch (type) {
    case "community_supported":
      return <Star color={palette.cyan} size={size} />;
    case "externally_supported":
      return <Star color={palette.success} size={size} />;
    case "disputed":
      return <ShieldAlert color={palette.gold} size={size} />;
    case "rejected":
      return <XCircle color={palette.ember} size={size} />;
    case "dispute_dismissed":
      return <Check color={palette.muted} size={size} />;
    case "outdated":
      return <Clock color={palette.gold} size={size} />;
    case "exchange_sharing_disabled":
      return <BellOff color={palette.ember} size={size} />;
    case "faction_sharing_removed":
      return <BellOff color={palette.violet} size={size} />;
    default:
      return <Bell color={palette.cyan} size={size} />;
  }
}

function notificationColor(type: string): string {
  switch (type) {
    case "community_supported":
      return palette.cyan;
    case "externally_supported":
      return palette.success;
    case "disputed":
      return palette.gold;
    case "rejected":
      return palette.ember;
    case "dispute_dismissed":
      return palette.muted;
    case "outdated":
      return palette.gold;
    case "exchange_sharing_disabled":
      return palette.ember;
    case "faction_sharing_removed":
      return palette.violet;
    default:
      return palette.cyan;
  }
}

// ── Notification Card ────────────────────────────────────────────────────

function NotificationCard({
  notification,
  onMarkRead,
  onTap,
  busy,
}: {
  notification: IntelligenceNotification;
  onMarkRead: (id: string) => void;
  onTap: (entryId: string | null) => void;
  busy: string | null;
}): JSX.Element {
  const h = useHaptics();
  const color = notificationColor(notification.notificationType);
  const dateLabel = new Date(notification.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Pressable
      onPress={() => {
        h.selection();
        if (!notification.isRead) {
          onMarkRead(notification.id);
        }
        onTap(notification.entryId);
      }}
      style={({ pressed }) => [
        notifStyles.card,
        { borderColor: notification.isRead ? palette.line : `${color}33` },
        !notification.isRead && { backgroundColor: `${color}08` },
        pressed && notifStyles.pressed,
      ]}
    >
      <View style={[notifStyles.iconWrap, { borderColor: `${color}33`, backgroundColor: `${color}12` }]}>
        {notificationIcon(notification.notificationType)}
      </View>
      <View style={notifStyles.content}>
        <View style={notifStyles.topRow}>
          <Text style={[notifStyles.notifTitle, { color: notification.isRead ? palette.muted : palette.text }]}>
            {notification.title}
          </Text>
          {!notification.isRead ? (
            <View style={[notifStyles.unreadDot, { backgroundColor: color }]} />
          ) : null}
        </View>
        <Text style={notifStyles.message}>{notification.message}</Text>
        <View style={notifStyles.bottomRow}>
          <Clock color={palette.muted} size={10} />
          <Text style={notifStyles.date}>{dateLabel}</Text>
          {notification.entryId ? (
            <Text style={notifStyles.entryHint}>Tap to view entry →</Text>
          ) : null}
        </View>
      </View>
      {!notification.isRead ? (
        <Pressable
          onPress={() => { h.light(); onMarkRead(notification.id); }}
          style={({ pressed }) => [notifStyles.markBtn, pressed && notifStyles.pressed]}
          disabled={busy === `read:${notification.id}`}
        >
          {busy === `read:${notification.id}` ? (
            <ActivityIndicator color={palette.cyan} size={13} />
          ) : (
            <Check color={palette.cyan} size={14} />
          )}
        </Pressable>
      ) : null}
    </Pressable>
  );
}

// ── Main Screen ──────────────────────────────────────────────────────────

export default function NotificationsScreen(): JSX.Element {
  const goBack = useSafeBack();
  const router = useRouter();
  const { palette: pal } = useAppTheme();
  const queryClient = useQueryClient();
  const h = useHaptics();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const notificationsQuery = useQuery<IntelligenceNotification[]>({
    queryKey: ["notifications"],
    queryFn: async () => {
      const result = await fetchNotifications();
      if (result.ok) return result.notifications;
      throw new Error(result.error);
    },
  });

  const unreadCount = (notificationsQuery.data ?? []).filter((n) => !n.isRead).length;

  const refreshAll = useCallback((): void => {
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }, [queryClient]);

  const handleMarkRead = useCallback(async (notificationId: string): Promise<void> => {
    setBusy(`read:${notificationId}`);
    setActionMsg(null);
    const result = await markNotificationRead(notificationId);
    setBusy(null);
    if (result.ok) {
      refreshAll();
    } else {
      setActionMsg(result.error ?? "Failed to mark as read.");
    }
  }, [refreshAll]);

  const handleMarkAllRead = useCallback(async (): Promise<void> => {
    if (unreadCount === 0) return;
    h.light();
    setBusy("mark-all");
    setActionMsg(null);
    const result = await markAllNotificationsRead();
    setBusy(null);
    if (result.ok) {
      setActionMsg("All notifications marked as read.");
      refreshAll();
    } else {
      setActionMsg(result.error ?? "Failed to mark all as read.");
    }
  }, [unreadCount, h, refreshAll]);

  const handleTap = useCallback((entryId: string | null): void => {
    if (entryId) {
      router.push("/my-intelligence" as never);
    }
  }, [router]);

  const notifications = notificationsQuery.data ?? [];

  return (
    <SafeAreaView style={[notifStyles.safe, { backgroundColor: pal.void }]} edges={["top"]}>
      {/* Header */}
      <View style={notifStyles.header}>
        <Pressable onPress={goBack} style={notifStyles.backBtn}>
          <ChevronLeft color={palette.text} size={22} />
        </Pressable>
        <View style={notifStyles.headerCenter}>
          <Text style={notifStyles.kicker}>NOTIFICATIONS</Text>
          <Text style={notifStyles.headerTitle}>Intelligence Alerts</Text>
        </View>
        <Pressable
          onPress={handleMarkAllRead}
          style={notifStyles.markAllBtn}
          disabled={busy !== null || unreadCount === 0}
        >
          {busy === "mark-all" ? (
            <ActivityIndicator color={palette.cyan} size={16} />
          ) : (
            <CheckCheck color={unreadCount > 0 ? palette.cyan : palette.muted} size={18} />
          )}
        </Pressable>
      </View>

      <ScrollView
        style={notifStyles.scroll}
        contentContainerStyle={notifStyles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Unread summary */}
        <View style={notifStyles.summaryBar}>
          <Bell color={unreadCount > 0 ? palette.cyan : palette.muted} size={16} />
          <Text style={notifStyles.summaryText}>
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? "s" : ""}` : "All caught up"}
          </Text>
        </View>

        {/* Action message */}
        {actionMsg ? (
          <View style={[notifStyles.actionMsgBox, { borderColor: `${actionMsg.includes("Failed") ? palette.ember : palette.success}33` }]}>
            <Text style={[notifStyles.actionMsgText, { color: actionMsg.includes("Failed") ? palette.ember : palette.success }]}>
              {actionMsg}
            </Text>
          </View>
        ) : null}

        {/* Notifications list */}
        {notificationsQuery.isLoading ? (
          <ActivityIndicator color={palette.cyan} size="large" style={{ paddingVertical: 40 }} />
        ) : notificationsQuery.error ? (
          <View style={notifStyles.errorState}>
            <MessageSquare color={palette.ember} size={28} />
            <Text style={notifStyles.errorText}>
              {(notificationsQuery.error as Error).message ?? "Failed to load notifications."}
            </Text>
          </View>
        ) : notifications.length === 0 ? (
          <View style={notifStyles.emptyState}>
            <BellOff color={palette.muted} size={32} />
            <Text style={notifStyles.emptyTitle}>No Notifications</Text>
            <Text style={notifStyles.emptyDesc}>
              You'll be notified here when moderation actions, disputes, or status changes affect your intelligence entries.
            </Text>
          </View>
        ) : (
          <View style={notifStyles.list}>
            {notifications.map((n) => (
              <NotificationCard
                key={n.id}
                notification={n}
                onMarkRead={handleMarkRead}
                onTap={handleTap}
                busy={busy}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────

const notifStyles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 8, paddingTop: 6, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: palette.line,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, alignItems: "center" },
  kicker: { color: palette.gold, fontSize: 9, fontWeight: "900", letterSpacing: 2 },
  headerTitle: { color: palette.text, fontSize: 18, fontWeight: "900", marginTop: 1 },
  markAllBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },

  scroll: { flex: 1 },
  scrollContent: { padding: 14, gap: 10 },

  summaryBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 12, borderRadius: 5, borderWidth: 1, borderColor: palette.line,
    backgroundColor: "rgba(10,20,38,0.45)",
  },
  summaryText: { fontSize: 12, fontWeight: "800", color: palette.text },

  actionMsgBox: {
    padding: 10, borderRadius: 5, borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  actionMsgText: { fontSize: 11, fontWeight: "800", textAlign: "center" },

  list: { gap: 8 },
  card: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    borderRadius: 6, borderWidth: 1, borderColor: palette.line,
    backgroundColor: "rgba(10,20,38,0.50)", padding: 12,
  },
  iconWrap: {
    width: 34, height: 34, borderRadius: 5,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1,
  },
  content: { flex: 1, gap: 4 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  notifTitle: { fontSize: 13, fontWeight: "900", flex: 1 },
  unreadDot: { width: 7, height: 7, borderRadius: 4 },
  message: { fontSize: 11, fontWeight: "600", color: palette.text, lineHeight: 16 },
  bottomRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  date: { fontSize: 9, fontWeight: "700", color: palette.muted },
  entryHint: { fontSize: 9, fontWeight: "800", color: palette.cyan, marginLeft: "auto" },

  markBtn: {
    width: 30, height: 30, borderRadius: 5, borderWidth: 1,
    borderColor: `${palette.cyan}33`, backgroundColor: `${palette.cyan}0A`,
    alignItems: "center", justifyContent: "center",
  },

  emptyState: { alignItems: "center", paddingVertical: 50, gap: 10 },
  emptyTitle: { color: palette.text, fontSize: 16, fontWeight: "900" },
  emptyDesc: { color: palette.muted, fontSize: 12, fontWeight: "700", textAlign: "center", lineHeight: 18 },

  errorState: { alignItems: "center", paddingVertical: 40, gap: 8 },
  errorText: { color: palette.ember, fontSize: 12, fontWeight: "800", textAlign: "center" },

  pressed: { transform: [{ scale: 0.985 }], opacity: 0.88 },
});
