/**
 * Analyst Archive — shows all analyst threads with pagination.
 *
 * Reached from the Sessions page "View All Analyst Threads" button.
 * Displays every thread with session type, EAGOH name, title preview,
 * created date, message count, and last message preview.
 *
 * Tapping a thread reopens it in the Sessions chat view.
 */

import { palette } from "@/constants/colors";
import { useHaptics } from "@/hooks/useHaptics";
import { useSafeBack } from "@/hooks/useSafeBack";
import { useProfile } from "@/providers/ProfileProvider";
import {
  listThreads,
  deleteThread,
  type ThreadWithMeta,
} from "@/services/analystThreads";
import type { AnalystSessionType } from "@/services/analyst";
import {
  ArrowLeft,
  ChevronRight,
  Info,
  MessageSquare,
  Trash2,
} from "lucide-react-native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";

// ── Session type metadata for display ───────────────────────────────────────

type SessionMeta = {
  id: AnalystSessionType;
  name: string;
  tone: "cyan" | "gold" | "violet" | "ember" | "success";
};

const SESSION_META: Record<string, SessionMeta> = {
  "quick-check": { id: "quick-check", name: "Quick Check", tone: "cyan" },
  "quick-analytics": { id: "quick-analytics", name: "Quick Analysis", tone: "gold" },
  "standard": { id: "standard", name: "Standard Analysis", tone: "success" },
  "oracle": { id: "oracle", name: "Oracle Deep Dive", tone: "violet" },
  "premium-event": { id: "premium-event", name: "Premium Event", tone: "ember" },
};

function toneColor(tone: string): string {
  if (tone === "gold") return palette.gold;
  if (tone === "violet") return palette.violet;
  if (tone === "ember") return palette.ember;
  if (tone === "success") return palette.success;
  return palette.cyan;
}

const PAGE_SIZE = 10;

// ── Main Screen ─────────────────────────────────────────────────────────────

export default function AnalystArchiveScreen(): JSX.Element {
  const router = useRouter();
  const h = useHaptics();
  const { profile } = useProfile();
  const safeBack = useSafeBack();

  const [threads, setThreads] = useState<ThreadWithMeta[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const offsetRef = React.useRef(0);

  // Initial load — fetch first PAGE_SIZE threads
  React.useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await listThreads(profile.id, PAGE_SIZE, 0);
        if (cancelled) return;
        setThreads(data);
        offsetRef.current = data.length;
        setHasMore(data.length === PAGE_SIZE);
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to load threads.";
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profile?.id]);

  const handleBack = useCallback((): void => {
    h.selection();
    safeBack();
  }, [safeBack, h]);

  const handleReopenThread = useCallback((thread: ThreadWithMeta): void => {
    h.selection();
    // Open the dedicated thread detail screen — not the Sessions page
    router.push({
      pathname: "/analyst-thread-detail",
      params: { threadId: thread.id },
    } as never);
  }, [router, h]);

  const handleDeleteThread = useCallback((thread: ThreadWithMeta): void => {
    Alert.alert(
      "Delete Thread",
      `Delete "${thread.title}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteThread(thread.id, thread.user_id);
              setThreads((prev) => prev.filter((t) => t.id !== thread.id));
              h.warning();
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : "Failed to delete.";
              Alert.alert("Error", msg);
            }
          },
        },
      ],
    );
  }, [h]);

  // Real incremental loading — fetch the next PAGE_SIZE threads from Supabase
  const handleLoadMore = useCallback(async (): Promise<void> => {
    if (loadingMore || !hasMore || !profile?.id) return;
    setLoadingMore(true);
    try {
      const data = await listThreads(profile.id, PAGE_SIZE, offsetRef.current);
      if (data.length > 0) {
        setThreads((prev) => [...prev, ...data]);
        offsetRef.current += data.length;
      }
      // If we got fewer than PAGE_SIZE, there are no more threads
      setHasMore(data.length === PAGE_SIZE);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load more threads.";
      setError(msg);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, profile?.id]);

  const handleViewOI = useCallback((): void => {
    h.selection();
    router.push("/open-intelligence" as never);
  }, [router, h]);

  // ── Loading state ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView edges={["top"]} style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={handleBack} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}>
            <ArrowLeft color={palette.text} size={18} />
          </Pressable>
          <Text style={styles.headerTitle}>Analyst Archive</Text>
        </View>
        <View style={styles.centerState}>
          <ActivityIndicator color={palette.cyan} size="large" />
          <Text style={styles.centerText}>Loading threads…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────

  if (error) {
    return (
      <SafeAreaView edges={["top"]} style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={handleBack} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}>
            <ArrowLeft color={palette.text} size={18} />
          </Pressable>
          <Text style={styles.headerTitle}>Analyst Archive</Text>
        </View>
        <View style={styles.centerState}>
          <MessageSquare color={palette.muted} size={36} />
          <Text style={styles.centerTitle}>Couldn't Load Threads</Text>
          <Text style={styles.centerText}>{error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────

  if (threads.length === 0) {
    return (
      <SafeAreaView edges={["top"]} style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={handleBack} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}>
            <ArrowLeft color={palette.text} size={18} />
          </Pressable>
          <Text style={styles.headerTitle}>Analyst Archive</Text>
        </View>
        <View style={styles.centerState}>
          <MessageSquare color={palette.muted} size={36} />
          <Text style={styles.centerTitle}>No Threads Yet</Text>
          <Text style={styles.centerText}>
            No analyst threads yet. Run a Quick Check, Quick Analysis, or another session to create threads.
          </Text>
          <Pressable
            onPress={handleViewOI}
            style={({ pressed }) => [styles.viewOIBtn, pressed && { opacity: 0.8 }]}
          >
            <Info color={palette.cyan} size={14} />
            <Text style={styles.viewOIBtnText}>View My Intelligence Entries</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ── Thread list ────────────────────────────────────────────────────────

  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={handleBack} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}>
          <ArrowLeft color={palette.text} size={18} />
        </Pressable>
        <Text style={styles.headerTitle}>Analyst Archive</Text>
        <Text style={styles.headerCount}>{threads.length}{hasMore ? "+" : ""} thread{threads.length === 1 ? "" : "s"}</Text>
      </View>

      {/* Description banner */}
      <View style={styles.descBanner}>
        <Info color={palette.muted} size={13} />
        <Text style={styles.descText}>
          Analyst Archive shows your past AI session threads. Open Intelligence entries are managed separately in My Intelligence.
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {threads.map((thread) => {
          const meta = SESSION_META[thread.session_type] ?? SESSION_META["standard"];
          const ac = toneColor(meta.tone);
          return (
            <Pressable
              key={thread.id}
              onPress={() => handleReopenThread(thread)}
              style={({ pressed }) => [
                styles.threadCard,
                { borderColor: `${ac}22` },
                pressed && { opacity: 0.88 },
              ]}
            >
              <LinearGradient
                colors={[`${ac}08`, "rgba(8,15,26,0.85)", "rgba(6,11,20,0.92)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View style={[styles.threadIcon, { backgroundColor: `${ac}14`, borderColor: `${ac}33` }]}>
                <MessageSquare color={ac} size={16} />
              </View>
              <View style={styles.threadInfo}>
                <Text style={styles.threadTitle} numberOfLines={1}>{thread.title}</Text>
                <Text style={styles.threadMeta}>
                  {thread.eagoh_name ?? "EAGOH"} · {meta.name} · {thread.message_count} msg{thread.message_count === 1 ? "" : "s"} · {new Date(thread.updated_at).toLocaleDateString()}
                </Text>
                {thread.last_message_preview ? (
                  <Text style={styles.threadPreview} numberOfLines={2}>
                    {thread.last_message_preview}
                  </Text>
                ) : null}
              </View>
              <View style={styles.threadActions}>
                <Pressable
                  onPress={() => handleDeleteThread(thread)}
                  hitSlop={8}
                  style={styles.threadDelete}
                >
                  <Trash2 color={palette.muted} size={14} />
                </Pressable>
                <ChevronRight color={ac} size={16} />
              </View>
            </Pressable>
          );
        })}

        {/* Load More */}
        {hasMore ? (
          <Pressable
            onPress={handleLoadMore}
            disabled={loadingMore}
            style={({ pressed }) => [
              styles.loadMoreBtn,
              pressed && { opacity: 0.8 },
              loadingMore && { opacity: 0.5 },
            ]}
          >
            {loadingMore ? (
              <ActivityIndicator color={palette.cyan} size="small" />
            ) : (
              <Text style={styles.loadMoreText}>Load More</Text>
            )}
          </Pressable>
        ) : (
          <Text style={styles.endText}>— End of archive —</Text>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Bottom: View My Intelligence Entries */}
      <View style={styles.bottomBar}>
        <Pressable
          onPress={handleViewOI}
          style={({ pressed }) => [styles.viewOIBtn, pressed && { opacity: 0.8 }]}
        >
          <Info color={palette.cyan} size={14} />
          <Text style={styles.viewOIBtnText}>View My Intelligence Entries</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.void },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
    backgroundColor: palette.obsidian,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.panel,
    borderWidth: 1,
    borderColor: palette.line,
  },
  headerTitle: { color: palette.text, fontSize: 18, fontWeight: "900" as const, flex: 1 },
  headerCount: { color: palette.muted, fontSize: 12, fontWeight: "700" as const },

  scroll: { flex: 1 },
  scrollContent: { padding: 14, paddingBottom: 60, gap: 8 },

  threadCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
    gap: 12,
    overflow: "hidden" as const,
  },
  threadIcon: {
    width: 38,
    height: 38,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  threadInfo: { flex: 1, gap: 3 },
  threadTitle: { color: palette.text, fontSize: 15, fontWeight: "800" as const },
  threadMeta: { color: palette.muted, fontSize: 11, fontWeight: "600" as const },
  threadPreview: { color: palette.muted, fontSize: 12, fontWeight: "500" as const, lineHeight: 17, marginTop: 2 },
  threadActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  threadDelete: { padding: 4 },

  loadMoreBtn: {
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    marginTop: 8,
  },
  loadMoreText: { color: palette.cyan, fontSize: 13, fontWeight: "800" as const },
  endText: { color: palette.muted, fontSize: 12, fontWeight: "600" as const, textAlign: "center" as const, paddingVertical: 16 },

  centerState: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, padding: 40, gap: 14 },
  centerTitle: { color: palette.text, fontSize: 17, fontWeight: "900" as const, textAlign: "center" as const },
  centerText: { color: palette.muted, fontSize: 13, fontWeight: "600" as const, textAlign: "center" as const, lineHeight: 19 },

  descBanner: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: "rgba(108,230,255,0.04)" as const,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(108,230,255,0.12)" as const,
  },
  descText: {
    flex: 1,
    color: palette.muted,
    fontSize: 11,
    fontWeight: "600" as const,
    lineHeight: 16,
  },

  bottomBar: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: palette.line,
    backgroundColor: palette.obsidian,
  },
  viewOIBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    paddingVertical: 12,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "rgba(108,230,255,0.30)" as const,
    backgroundColor: "rgba(108,230,255,0.06)" as const,
  },
  viewOIBtnText: {
    color: palette.cyan,
    fontSize: 13,
    fontWeight: "800" as const,
  },
});
