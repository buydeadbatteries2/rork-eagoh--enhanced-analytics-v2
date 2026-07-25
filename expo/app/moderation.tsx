/**
 * Moderation Queue — Phase 6B
 *
 * Admin-only screen for reviewing disputed or reported entries.
 * Shows entry ID, content preview, dispute reason, explanation,
 * supporting URL, validation status, report count, and contributor
 * reputation summary.
 *
 * Reporter identities are never exposed.
 *
 * Moderation actions (all through secure worker, admin-only):
 *   - Dismiss dispute
 *   - Mark community supported
 *   - Mark externally supported
 *   - Mark disputed
 *   - Reject entry
 */

import { palette } from "@/constants/colors";
import { useAppTheme } from "@/providers/ThemeProvider";
import { useProfile } from "@/providers/ProfileProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useSafeBack } from "@/hooks/useSafeBack";
import {
  VALIDATION_STATUS_LABELS,
  validationStatusColor,
  trustLabel,
  trustLabelColor,
  DISPUTE_REASON_LABELS,
  fetchModerationQueue,
  performModerationAction,
  hasModerationAccess,
  fetchModerationAudit,
  MODERATION_ACTION_LABELS,
  type ModerationQueueItem,
  type ModerationAction,
  type ModerationAuditEntry,
} from "@/services/openIntelligence";
import {
  AlertTriangle,
  ChevronLeft,
  Check,
  ExternalLink,
  Eye,
  Gavel,
  History,
  RefreshCw,
  ShieldAlert,
  Star,
  X,
  XCircle,
} from "lucide-react-native";
import React, { memo, useCallback, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery, useQueryClient } from "@tanstack/react-query";

// ── Dispute Card ────────────────────────────────────────────────────────

function DisputeDetail({
  reasonCategory,
  explanation,
  supportingUrl,
  status,
  createdAt,
}: {
  reasonCategory: string;
  explanation: string;
  supportingUrl: string | null;
  status: string;
  createdAt: string;
}): JSX.Element {
  const reasonLabel = DISPUTE_REASON_LABELS[reasonCategory] ?? reasonCategory;
  const dateLabel = new Date(createdAt).toLocaleDateString();

  return (
    <View style={modStyles.disputeCard}>
      <View style={modStyles.disputeHeader}>
        <View style={[modStyles.reasonBadge, { borderColor: `${palette.ember}33` }]}>
          <AlertTriangle color={palette.ember} size={9} />
          <Text style={[modStyles.reasonText, { color: palette.ember }]}>{reasonLabel}</Text>
        </View>
        <Text style={modStyles.disputeStatus}>{status}</Text>
        <Text style={modStyles.disputeDate}>{dateLabel}</Text>
      </View>
      <Text style={modStyles.disputeExplanation}>{explanation}</Text>
      {supportingUrl ? (
        <View style={modStyles.urlRow}>
          <ExternalLink color={palette.cyan} size={11} />
          <Text style={modStyles.urlText} numberOfLines={1}>{supportingUrl}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ── Moderation Item Card ────────────────────────────────────────────────

function ModerationItemCard({
  item,
  onAction,
  busy,
}: {
  item: ModerationQueueItem;
  onAction: (entryId: string, action: ModerationAction, disputeId?: string) => void;
  busy: string | null;
}): JSX.Element {
  const h = useHaptics();
  const [expanded, setExpanded] = useState(false);
  const [actionPickerOpen, setActionPickerOpen] = useState(false);

  const statusColor = validationStatusColor(item.validationStatus);
  const statusLabel = VALIDATION_STATUS_LABELS[item.validationStatus] ?? item.validationStatus;
  const repScore = item.contributorReputation;
  const repLabel = repScore !== null ? trustLabel(repScore) : "Unknown";
  const repColor = repScore !== null ? trustLabelColor(repScore) : palette.muted;

  const actions: { id: ModerationAction; label: string; color: string; icon: JSX.Element }[] = [
    { id: "dismiss_dispute", label: "Dismiss Dispute", color: palette.muted, icon: <X color={palette.muted} size={13} /> },
    { id: "mark_community_supported", label: "Community Supported", color: palette.cyan, icon: <Check color={palette.cyan} size={13} /> },
    { id: "mark_externally_supported", label: "Externally Supported", color: palette.success, icon: <Check color={palette.success} size={13} /> },
    { id: "mark_disputed", label: "Mark Disputed", color: palette.gold, icon: <AlertTriangle color={palette.gold} size={13} /> },
    { id: "reject_entry", label: "Reject Entry", color: palette.ember, icon: <XCircle color={palette.ember} size={13} /> },
  ];

  return (
    <View style={modStyles.itemCard}>
      {/* Status + Report count */}
      <View style={modStyles.itemTopRow}>
        <View style={[modStyles.statusBadge, { borderColor: `${statusColor}44`, backgroundColor: `${statusColor}12` }]}>
          <ShieldAlert color={statusColor} size={9} />
          <Text style={[modStyles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
        <View style={[modStyles.reportBadge, { borderColor: `${palette.ember}33` }]}>
          <AlertTriangle color={palette.ember} size={9} />
          <Text style={[modStyles.reportText, { color: palette.ember }]}>{item.reportCount} reports</Text>
        </View>
      </View>

      {/* Entry ID */}
      <Text style={modStyles.entryIdLabel}>Entry: {item.entryId.slice(0, 8)}…</Text>

      {/* Content preview */}
      <Pressable onPress={() => { h.selection(); setExpanded(!expanded); }}>
        <Text style={modStyles.contentPreview} numberOfLines={expanded ? undefined : 3}>
          {item.contentPreview}
        </Text>
        {item.contentPreview.length > 120 ? (
          <Text style={modStyles.expandText}>{expanded ? "Show less" : "Show more"}</Text>
        ) : null}
      </Pressable>

      {/* Contributor reputation */}
      <View style={modStyles.repRow}>
        <Star color={repColor} size={10} />
        <Text style={[modStyles.repLabel, { color: repColor }]}>{repLabel}</Text>
        {repScore !== null ? (
          <Text style={modStyles.repScore}>Score: {repScore}</Text>
        ) : null}
      </View>

      {/* Disputes */}
      {item.disputes.length > 0 ? (
        <View style={modStyles.disputesSection}>
          <Text style={modStyles.sectionLabel}>Active Disputes</Text>
          {item.disputes.map((d) => (
            <DisputeDetail
              key={d.id}
              reasonCategory={d.reasonCategory}
              explanation={d.explanation}
              supportingUrl={d.supportingUrl}
              status={d.status}
              createdAt={d.createdAt}
            />
          ))}
        </View>
      ) : (
        <Text style={modStyles.noDisputesText}>No active disputes — flagged by quality triggers.</Text>
      )}

      {/* Action button */}
      <Pressable
        onPress={() => { h.selection(); setActionPickerOpen(!actionPickerOpen); }}
        style={({ pressed }) => [modStyles.actionToggleBtn, pressed && modStyles.pressed]}
        disabled={busy !== null}
      >
        <Gavel color={palette.gold} size={13} />
        <Text style={[modStyles.actionToggleText, { color: palette.gold }]}>Moderation Actions</Text>
      </Pressable>

      {actionPickerOpen ? (
        <View style={modStyles.actionList}>
          {actions.map((a) => (
            <Pressable
              key={a.id}
              onPress={() => {
                h.selection();
                const firstDisputeId = item.disputes[0]?.id;
                onAction(item.entryId, a.id, a.id === "dismiss_dispute" || a.id === "mark_disputed" ? firstDisputeId : undefined);
                setActionPickerOpen(false);
              }}
              style={({ pressed }) => [
                modStyles.actionItem,
                { borderColor: `${a.color}22` },
                pressed && modStyles.pressed,
              ]}
              disabled={busy !== null}
            >
              {busy === `mod:${item.entryId}:${a.id}` ? (
                <ActivityIndicator color={a.color} size={13} />
              ) : (
                a.icon
              )}
              <Text style={[modStyles.actionItemText, { color: a.color }]}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ── Main Screen ─────────────────────────────────────────────────────────

export default function ModerationScreen(): JSX.Element {
  const goBack = useSafeBack();
  const { palette: pal } = useAppTheme();
  const { profile } = useProfile();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const isAdmin = hasModerationAccess(profile);

  const queueQuery = useQuery<ModerationQueueItem[]>({
    queryKey: ["moderation", "queue"],
    enabled: isAdmin,
    queryFn: async () => {
      const result = await fetchModerationQueue();
      if (result.ok) return result.queue;
      throw new Error(result.error);
    },
  });

  const handleAction = useCallback(async (entryId: string, action: ModerationAction, disputeId?: string): Promise<void> => {
    setBusy(`mod:${entryId}:${action}`);
    setActionMsg(null);
    const result = await performModerationAction(entryId, action, disputeId);
    setBusy(null);
    if (result.ok) {
      setActionMsg(`${MODERATION_ACTION_LABELS[action]} — applied successfully.`);
      queryClient.invalidateQueries({ queryKey: ["moderation", "queue"] });
    } else {
      setActionMsg(result.error ?? "Failed to perform moderation action.");
    }
  }, [queryClient]);

  const handleRefresh = useCallback((): void => {
    queryClient.invalidateQueries({ queryKey: ["moderation", "queue"] });
    queryClient.invalidateQueries({ queryKey: ["moderation", "audit"] });
  }, [queryClient]);

  // Phase 6C: Audit history (admin only, moderator identity never exposed)
  const auditQuery = useQuery<ModerationAuditEntry[]>({
    queryKey: ["moderation", "audit"],
    enabled: isAdmin,
    queryFn: async () => {
      const result = await fetchModerationAudit();
      if (result.ok) return result.audit;
      throw new Error(result.error);
    },
  });

  if (!isAdmin) {
    return (
      <SafeAreaView style={[modStyles.safe, { backgroundColor: pal.void }]} edges={["top"]}>
        <View style={modStyles.header}>
          <Pressable onPress={goBack} style={modStyles.backBtn}>
            <ChevronLeft color={palette.text} size={22} />
          </Pressable>
          <View style={modStyles.headerCenter}>
            <Text style={modStyles.kicker}>MODERATION</Text>
            <Text style={modStyles.title}>Access Denied</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
        <View style={modStyles.accessDenied}>
          <ShieldAlert color={palette.ember} size={40} />
          <Text style={modStyles.accessDeniedTitle}>Moderation Access Required</Text>
          <Text style={modStyles.accessDeniedDesc}>
            Only users with admin privileges can access the moderation queue.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[modStyles.safe, { backgroundColor: pal.void }]} edges={["top"]}>
      {/* Header */}
      <View style={modStyles.header}>
        <Pressable onPress={goBack} style={modStyles.backBtn}>
          <ChevronLeft color={palette.text} size={22} />
        </Pressable>
        <View style={modStyles.headerCenter}>
          <Text style={modStyles.kicker}>MODERATION</Text>
          <Text style={modStyles.title}>Dispute Queue</Text>
        </View>
        <Pressable onPress={handleRefresh} style={modStyles.refreshBtn}>
          <RefreshCw color={palette.cyan} size={18} />
        </Pressable>
      </View>

      <ScrollView
        style={modStyles.scroll}
        contentContainerStyle={modStyles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={undefined}
      >
        {/* Summary */}
        <View style={modStyles.summaryBar}>
          <View style={modStyles.summaryItem}>
            <Text style={modStyles.summaryValue}>{queueQuery.data?.length ?? 0}</Text>
            <Text style={modStyles.summaryLabel}>Flagged Entries</Text>
          </View>
          <View style={modStyles.summaryItem}>
            <Text style={[modStyles.summaryValue, { color: palette.ember }]}>
              {queueQuery.data?.reduce((sum, item) => sum + item.reportCount, 0) ?? 0}
            </Text>
            <Text style={modStyles.summaryLabel}>Total Reports</Text>
          </View>
        </View>

        {/* Action message */}
        {actionMsg ? (
          <View style={[modStyles.actionMsgBox, { borderColor: `${actionMsg.includes("Failed") ? palette.ember : palette.success}33` }]}>
            <Text style={[modStyles.actionMsgText, { color: actionMsg.includes("Failed") ? palette.ember : palette.success }]}>
              {actionMsg}
            </Text>
          </View>
        ) : null}

        {/* Queue */}
        {queueQuery.isLoading ? (
          <ActivityIndicator color={palette.cyan} size="large" style={{ paddingVertical: 40 }} />
        ) : queueQuery.error ? (
          <View style={modStyles.errorState}>
            <AlertTriangle color={palette.ember} size={28} />
            <Text style={modStyles.errorText}>
              {(queueQuery.error as Error).message ?? "Failed to load moderation queue."}
            </Text>
          </View>
        ) : (queueQuery.data?.length ?? 0) === 0 ? (
          <View style={modStyles.emptyState}>
            <Check color={palette.success} size={32} />
            <Text style={modStyles.emptyTitle}>Queue is Clear</Text>
            <Text style={modStyles.emptyDesc}>
              No disputed or reported entries requiring moderation at this time.
            </Text>
          </View>
        ) : (
          <View style={modStyles.queueList}>
            {queueQuery.data!.map((item) => (
              <ModerationItemCard
                key={item.entryId}
                item={item}
                onAction={handleAction}
                busy={busy}
              />
            ))}
          </View>
        )}

        {/* Phase 6C: Audit History */}
        <View style={modStyles.auditSection}>
          <View style={modStyles.auditHeader}>
            <History color={palette.gold} size={14} />
            <Text style={modStyles.auditTitle}>AUDIT HISTORY</Text>
          </View>
          {auditQuery.isLoading ? (
            <ActivityIndicator color={palette.muted} size="small" style={{ paddingVertical: 12 }} />
          ) : auditQuery.error ? (
            <Text style={modStyles.auditError}>Failed to load audit history.</Text>
          ) : (auditQuery.data?.length ?? 0) === 0 ? (
            <Text style={modStyles.auditEmpty}>No moderation actions recorded yet.</Text>
          ) : (
            <View style={modStyles.auditList}>
              {auditQuery.data!.slice(0, 20).map((a) => {
                const dateLabel = new Date(a.createdAt).toLocaleDateString(undefined, {
                  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                });
                const actionLabel = MODERATION_ACTION_LABELS[a.action as ModerationAction] ?? a.action;
                return (
                  <View key={a.id} style={modStyles.auditItem}>
                    <View style={modStyles.auditItemLeft}>
                      <Text style={modStyles.auditAction}>{actionLabel}</Text>
                      <Text style={modStyles.auditDate}>{dateLabel}</Text>
                    </View>
                    <View style={modStyles.auditStatusRow}>
                      {a.previousStatus ? (
                        <Text style={modStyles.auditPrevStatus}>
                          {VALIDATION_STATUS_LABELS[a.previousStatus as keyof typeof VALIDATION_STATUS_LABELS] ?? a.previousStatus}
                        </Text>
                      ) : null}
                      {a.previousStatus ? <Text style={modStyles.auditArrow}>→</Text> : null}
                      {a.newStatus ? (
                        <Text style={[modStyles.auditNewStatus, { color: validationStatusColor(a.newStatus) }]}>
                          {VALIDATION_STATUS_LABELS[a.newStatus as keyof typeof VALIDATION_STATUS_LABELS] ?? a.newStatus}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────

const modStyles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 8, paddingTop: 6, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: palette.line,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, alignItems: "center" },
  kicker: { color: palette.gold, fontSize: 9, fontWeight: "900", letterSpacing: 2 },
  title: { color: palette.text, fontSize: 18, fontWeight: "900", marginTop: 1 },
  refreshBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },

  scroll: { flex: 1 },
  scrollContent: { padding: 14, gap: 10 },

  // Summary
  summaryBar: {
    flexDirection: "row", gap: 8, padding: 14, borderRadius: 5,
    borderWidth: 1, borderColor: palette.line,
    backgroundColor: "rgba(10,20,38,0.45)",
  },
  summaryItem: { flex: 1, alignItems: "center", gap: 2 },
  summaryValue: { fontSize: 22, fontWeight: "900", color: palette.text },
  summaryLabel: { fontSize: 9, fontWeight: "700", color: palette.muted, textTransform: "uppercase", letterSpacing: 0.5 },

  // Action message
  actionMsgBox: {
    padding: 10, borderRadius: 5, borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  actionMsgText: { fontSize: 11, fontWeight: "800", textAlign: "center" },

  // Queue list
  queueList: { gap: 10 },
  itemCard: {
    borderRadius: 6, borderWidth: 1, borderColor: palette.line,
    backgroundColor: "rgba(10,20,38,0.50)", padding: 12, gap: 8,
  },
  itemTopRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  statusBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, borderWidth: 1,
  },
  statusText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  reportBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, borderWidth: 1,
    backgroundColor: "rgba(255,77,109,0.06)",
  },
  reportText: { fontSize: 9, fontWeight: "800" },

  entryIdLabel: { color: palette.muted, fontSize: 9, fontWeight: "700" },
  contentPreview: { color: palette.text, fontSize: 12, fontWeight: "700", lineHeight: 18 },
  expandText: { color: palette.cyan, fontSize: 10, fontWeight: "800", marginTop: 2 },

  // Reputation
  repRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  repLabel: { fontSize: 11, fontWeight: "800" },
  repScore: { fontSize: 10, fontWeight: "700", color: palette.muted },

  // Disputes
  disputesSection: { gap: 4 },
  sectionLabel: { color: palette.ember, fontSize: 9, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase" },
  noDisputesText: { color: palette.muted, fontSize: 10, fontWeight: "700", fontStyle: "italic" },

  disputeCard: {
    borderRadius: 4, borderWidth: 1, borderColor: "rgba(255,77,109,0.15)",
    backgroundColor: "rgba(255,77,109,0.03)", padding: 8, gap: 4,
  },
  disputeHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  reasonBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, borderWidth: 1,
  },
  reasonText: { fontSize: 9, fontWeight: "800" },
  disputeStatus: { fontSize: 9, fontWeight: "700", color: palette.muted, textTransform: "capitalize" },
  disputeDate: { fontSize: 9, fontWeight: "700", color: palette.muted, marginLeft: "auto" },
  disputeExplanation: { color: palette.text, fontSize: 11, fontWeight: "600", lineHeight: 16 },
  urlRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  urlText: { color: palette.cyan, fontSize: 10, fontWeight: "700", flex: 1 },

  // Actions
  actionToggleBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 4, borderWidth: 1,
    borderColor: `${palette.gold}33`, backgroundColor: `${palette.gold}0A`,
    minHeight: 32,
  },
  actionToggleText: { fontSize: 11, fontWeight: "800" },

  actionList: { gap: 3, paddingLeft: 4 },
  actionItem: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 4, borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.02)", minHeight: 32,
  },
  actionItemText: { fontSize: 10, fontWeight: "800" },

  // Access denied
  accessDenied: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 30 },
  accessDeniedTitle: { color: palette.text, fontSize: 18, fontWeight: "900" },
  accessDeniedDesc: { color: palette.muted, fontSize: 12, fontWeight: "700", textAlign: "center", lineHeight: 18 },

  // Empty/error states
  emptyState: { alignItems: "center", paddingVertical: 50, gap: 8 },
  emptyTitle: { color: palette.text, fontSize: 16, fontWeight: "900" },
  emptyDesc: { color: palette.muted, fontSize: 12, fontWeight: "700", textAlign: "center", lineHeight: 18 },

  errorState: { alignItems: "center", paddingVertical: 40, gap: 8 },
  errorText: { color: palette.ember, fontSize: 12, fontWeight: "800", textAlign: "center" },

  pressed: { transform: [{ scale: 0.985 }], opacity: 0.88 },

  // Phase 6C: Audit History
  auditSection: {
    marginTop: 10, padding: 12, borderRadius: 6, borderWidth: 1, borderColor: palette.line,
    backgroundColor: "rgba(10,20,38,0.45)", gap: 8,
  },
  auditHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  auditTitle: { color: palette.gold, fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
  auditList: { gap: 5 },
  auditItem: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)",
  },
  auditItemLeft: { flex: 1, gap: 1 },
  auditAction: { fontSize: 11, fontWeight: "800", color: palette.text },
  auditDate: { fontSize: 9, fontWeight: "700", color: palette.muted },
  auditStatusRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  auditPrevStatus: { fontSize: 9, fontWeight: "700", color: palette.muted },
  auditArrow: { fontSize: 10, fontWeight: "900", color: palette.muted },
  auditNewStatus: { fontSize: 9, fontWeight: "800" },
  auditEmpty: { color: palette.muted, fontSize: 11, fontWeight: "700", fontStyle: "italic", paddingVertical: 4 },
  auditError: { color: palette.ember, fontSize: 11, fontWeight: "800", paddingVertical: 4 },
});
