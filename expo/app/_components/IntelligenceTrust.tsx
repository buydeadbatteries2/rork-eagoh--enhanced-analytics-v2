/**
 * IntelligenceTrust — reusable trust UI components for Phase 6A.
 *
 * Provides:
 *   - ValidationBadge: shows validation status with proper label/color
 *   - QualityScoreBar: shows quality 0-100 as a bar with label
 *   - TrustLabel: shows contributor reputation trust label
 *   - OutdatedWarning: shows outdated warning when applicable
 *   - DisputedWarning: shows disputed warning when applicable
 *   - FeedbackModal: rate intelligence through secure worker
 *   - DisputeModal: report/dispute intelligence through secure worker
 *   - IntelligenceEntryCard: displays a shared OI entry with trust indicators + rate/dispute actions
 *
 * All feedback and dispute submissions go through the secure worker endpoints.
 * No direct Supabase writes occur from the client.
 */

import { palette } from "@/constants/colors";
import {
  VALIDATION_STATUS_LABELS,
  validationStatusColor,
  trustLabel,
  trustLabelColor,
  FEEDBACK_TYPE_LABELS,
  FEEDBACK_TYPES_LIST,
  DISPUTE_REASON_LABELS,
  DISPUTE_REASONS_LIST,
  submitFeedback,
  submitDispute,
  type OpenIntelligenceRow,
} from "@/services/openIntelligence";
import type { PublicReputation } from "@/services/openIntelligence";
import { useHaptics } from "@/hooks/useHaptics";
import {
  AlertTriangle,
  Clock,
  FileWarning,
  Flag,
  Send,
  Shield,
  Star,
  ThumbsUp,
  X,
} from "lucide-react-native";
import React, { memo, useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

// ── Validation Badge ────────────────────────────────────────────────────

export const ValidationBadge = memo(function ValidationBadge({
  status,
}: {
  status: string;
}): JSX.Element {
  const color = validationStatusColor(status);
  const label = VALIDATION_STATUS_LABELS[status] ?? "Pending Review";
  return (
    <View style={[trustStyles.badge, { borderColor: `${color}44`, backgroundColor: `${color}12` }]}>
      <Shield color={color} size={9} />
      <Text style={[trustStyles.badgeText, { color }]}>{label}</Text>
    </View>
  );
});

// ── Quality Score Bar ───────────────────────────────────────────────────

export const QualityScoreBar = memo(function QualityScoreBar({
  score,
  label = "Quality",
}: {
  score: number;
  label?: string;
}): JSX.Element {
  const clamped = Math.max(0, Math.min(100, score));
  const color = clamped >= 70 ? palette.success : clamped >= 40 ? palette.gold : palette.ember;
  return (
    <View style={trustStyles.qualityWrap}>
      <View style={trustStyles.qualityHeader}>
        <Text style={trustStyles.qualityLabel}>{label}</Text>
        <Text style={[trustStyles.qualityValue, { color }]}>{clamped}</Text>
      </View>
      <View style={trustStyles.qualityTrack}>
        <View style={[trustStyles.qualityFill, { width: `${clamped}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
});

// ── Trust Label ─────────────────────────────────────────────────────────

export const TrustLabel = memo(function TrustLabel({
  reputation,
}: {
  reputation: PublicReputation | null | undefined;
}): JSX.Element {
  const score = reputation?.overall_score ?? 50;
  const label = trustLabel(score);
  const color = trustLabelColor(score);
  return (
    <View style={[trustStyles.trustBadge, { borderColor: `${color}33`, backgroundColor: `${color}0A` }]}>
      <Star color={color} size={10} />
      <Text style={[trustStyles.trustText, { color }]}>{label}</Text>
      <Text style={[trustStyles.trustScore, { color: palette.muted }]}>{Math.round(score)}</Text>
    </View>
  );
});

// ── Outdated Warning ────────────────────────────────────────────────────

export const OutdatedWarning = memo(function OutdatedWarning(): JSX.Element {
  return (
    <View style={[trustStyles.warningBadge, { borderColor: `${palette.gold}33`, backgroundColor: `${palette.gold}0A` }]}>
      <Clock color={palette.gold} size={9} />
      <Text style={[trustStyles.warningText, { color: palette.gold }]}>Outdated</Text>
    </View>
  );
});

// ── Disputed Warning ────────────────────────────────────────────────────

export const DisputedWarning = memo(function DisputedWarning(): JSX.Element {
  return (
    <View style={[trustStyles.warningBadge, { borderColor: `${palette.ember}33`, backgroundColor: `${palette.ember}0A` }]}>
      <AlertTriangle color={palette.ember} size={9} />
      <Text style={[trustStyles.warningText, { color: palette.ember }]}>Disputed</Text>
    </View>
  );
});

// ── Trust Indicators Row ────────────────────────────────────────────────

/**
 * Compact row showing validation status, quality, and warnings for an entry.
 */
export const TrustIndicatorsRow = memo(function TrustIndicatorsRow({
  entry,
}: {
  entry: OpenIntelligenceRow;
}): JSX.Element {
  const status = entry.validation_status ?? "pending_review";
  // Hide rejected and withdrawn — they should never be shown
  if (status === "rejected" || status === "withdrawn") return <></>;

  return (
    <View style={trustStyles.indicatorsRow}>
      <ValidationBadge status={status} />
      {entry.outdated_flag ? <OutdatedWarning /> : null}
      {(status === "disputed" || (entry.active_dispute_count ?? 0) > 0) ? <DisputedWarning /> : null}
      <QualityScoreBar score={entry.quality_score ?? 0} />
    </View>
  );
});

// ── Feedback Modal ──────────────────────────────────────────────────────

export type FeedbackAccessInfo = {
  accessSource: "faction" | "exchange";
  factionId?: string;
  exchangePurchaseId?: string;
  isOwnEntry: boolean;
};

export function FeedbackModal({
  visible,
  entryId,
  access,
  onClose,
  onSubmitted,
}: {
  visible: boolean;
  entryId: string | null;
  access: FeedbackAccessInfo | null;
  onClose: () => void;
  onSubmitted?: () => void;
}): JSX.Element {
  const h = useHaptics();
  const [selectedType, setSelectedType] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setSelectedType("");
      setReason("");
      setResultMsg(null);
    }
  }, [visible, entryId]);

  const canSubmit = !!selectedType && !!entryId && !!access && !access.isOwnEntry && !submitting;

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!entryId || !access || !selectedType) return;
    h.light();
    setSubmitting(true);
    setResultMsg(null);

    const result = await submitFeedback({
      entryId,
      feedbackType: selectedType,
      optionalReason: reason.trim() || undefined,
      accessSource: access.accessSource,
      factionId: access.factionId,
      exchangePurchaseId: access.exchangePurchaseId,
    });

    setSubmitting(false);

    if (result.ok) {
      setResultMsg("Feedback submitted");
      h.success();
      onSubmitted?.();
      setTimeout(() => onClose(), 900);
    } else {
      // Map common errors to user-friendly messages
      const err = result.error;
      if (err.includes("own entry")) {
        setResultMsg("You cannot rate your own intelligence");
      } else if (err.includes("authorized access")) {
        setResultMsg("You do not have access to rate this intelligence");
      } else if (err.includes("limit")) {
        setResultMsg("Daily feedback limit reached");
      } else if (err.includes("rejected") || err.includes("withdrawn")) {
        setResultMsg("Feedback is not available for this entry");
      } else {
        setResultMsg(err);
      }
    }
  }, [entryId, access, selectedType, reason, h, onSubmitted, onClose]);

  if (!access) return <></>;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={trustStyles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={trustStyles.modalSheet}>
          <LinearGradient colors={["#0A1628", "#050D18"]} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={trustStyles.modalHandle} />
          <View style={trustStyles.modalHeader}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <ThumbsUp color={palette.cyan} size={18} />
              <Text style={trustStyles.modalTitle}>Rate Intelligence</Text>
            </View>
            <Pressable onPress={onClose} style={trustStyles.modalCloseBtn}>
              <X color={palette.muted} size={20} />
            </Pressable>
          </View>

          {access.isOwnEntry ? (
            <View style={trustStyles.modalBody}>
              <Text style={trustStyles.blockedText}>You cannot rate your own intelligence.</Text>
            </View>
          ) : (
            <ScrollView style={trustStyles.modalScroll} contentContainerStyle={trustStyles.modalBody} keyboardShouldPersistTaps="handled">
              <Text style={trustStyles.sectionLabel}>Your Feedback</Text>
              <View style={trustStyles.feedbackGrid}>
                {FEEDBACK_TYPES_LIST.map((type) => {
                  const isSelected = selectedType === type;
                  const color = type === "helpful" || type === "accurate_to_my_experience"
                    ? palette.success
                    : type === "needs_context"
                      ? palette.gold
                      : palette.ember;
                  return (
                    <Pressable
                      key={type}
                      onPress={() => { h.selection(); setSelectedType(type); }}
                      style={({ pressed }) => [
                        trustStyles.feedbackChip,
                        isSelected && { borderColor: color, backgroundColor: `${color}14` },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Text style={[trustStyles.feedbackChipText, isSelected && { color }]}>
                        {FEEDBACK_TYPE_LABELS[type]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[trustStyles.sectionLabel, { marginTop: 14 }]}>Additional Context (optional)</Text>
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="Add a brief reason..."
                placeholderTextColor={palette.muted}
                multiline
                style={trustStyles.reasonInput}
                maxLength={300}
                textAlignVertical="top"
              />

              {resultMsg ? (
                <View style={[trustStyles.resultBox, { borderColor: `${palette.cyan}33` }]}>
                  <Text style={[trustStyles.resultText, { color: palette.cyan }]}>{resultMsg}</Text>
                </View>
              ) : null}

              <Pressable
                onPress={handleSubmit}
                disabled={!canSubmit}
                style={({ pressed }) => [
                  trustStyles.submitBtn,
                  !canSubmit && trustStyles.submitBtnDisabled,
                  pressed && { opacity: 0.85 },
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color={palette.void} size="small" />
                ) : (
                  <>
                    <Send color={canSubmit ? palette.void : palette.muted} size={15} />
                    <Text style={[trustStyles.submitBtnText, !canSubmit && { color: palette.muted }]}>
                      Submit Feedback
                    </Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Dispute Modal ───────────────────────────────────────────────────────

export function DisputeModal({
  visible,
  entryId,
  access,
  onClose,
  onSubmitted,
}: {
  visible: boolean;
  entryId: string | null;
  access: FeedbackAccessInfo | null;
  onClose: () => void;
  onSubmitted?: () => void;
}): JSX.Element {
  const h = useHaptics();
  const [selectedReason, setSelectedReason] = useState<string>("");
  const [explanation, setExplanation] = useState<string>("");
  const [supportingUrl, setSupportingUrl] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setSelectedReason("");
      setExplanation("");
      setSupportingUrl("");
      setResultMsg(null);
    }
  }, [visible, entryId]);

  const canSubmit = !!selectedReason && explanation.trim().length >= 10 && !!entryId && !!access && !access.isOwnEntry && !submitting;

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!entryId || !access || !selectedReason || explanation.trim().length < 10) return;
    h.light();
    setSubmitting(true);
    setResultMsg(null);

    const result = await submitDispute({
      entryId,
      reasonCategory: selectedReason,
      explanation: explanation.trim(),
      supportingUrl: supportingUrl.trim() || undefined,
      accessSource: access.accessSource,
      factionId: access.factionId,
      exchangePurchaseId: access.exchangePurchaseId,
    });

    setSubmitting(false);

    if (result.ok) {
      setResultMsg("Dispute submitted for review");
      h.success();
      onSubmitted?.();
      setTimeout(() => onClose(), 900);
    } else {
      const err = result.error;
      if (err.includes("own entry")) {
        setResultMsg("You cannot dispute your own entry.");
      } else if (err.includes("authorized access")) {
        setResultMsg("You do not have access to dispute this intelligence.");
      } else if (err.includes("already")) {
        setResultMsg("You have already disputed this entry.");
      } else if (err.includes("limit")) {
        setResultMsg("Daily dispute limit reached.");
      } else {
        setResultMsg(err);
      }
    }
  }, [entryId, access, selectedReason, explanation, supportingUrl, h, onSubmitted, onClose]);

  if (!access) return <></>;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={trustStyles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={trustStyles.modalSheet}>
          <LinearGradient colors={["#0A1628", "#050D18"]} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={trustStyles.modalHandle} />
          <View style={trustStyles.modalHeader}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Flag color={palette.ember} size={18} />
              <Text style={trustStyles.modalTitle}>Report or Dispute</Text>
            </View>
            <Pressable onPress={onClose} style={trustStyles.modalCloseBtn}>
              <X color={palette.muted} size={20} />
            </Pressable>
          </View>

          {access.isOwnEntry ? (
            <View style={trustStyles.modalBody}>
              <Text style={trustStyles.blockedText}>You cannot dispute your own intelligence.</Text>
            </View>
          ) : (
            <ScrollView style={trustStyles.modalScroll} contentContainerStyle={trustStyles.modalBody} keyboardShouldPersistTaps="handled">
              <Text style={trustStyles.sectionLabel}>Reason</Text>
              <View style={trustStyles.feedbackGrid}>
                {DISPUTE_REASONS_LIST.map((reason) => {
                  const isSelected = selectedReason === reason;
                  return (
                    <Pressable
                      key={reason}
                      onPress={() => { h.selection(); setSelectedReason(reason); }}
                      style={({ pressed }) => [
                        trustStyles.feedbackChip,
                        isSelected && { borderColor: palette.ember, backgroundColor: `${palette.ember}14` },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Text style={[trustStyles.feedbackChipText, isSelected && { color: palette.ember }]}>
                        {DISPUTE_REASON_LABELS[reason]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[trustStyles.sectionLabel, { marginTop: 14 }]}>Explanation (min 10 chars)</Text>
              <TextInput
                value={explanation}
                onChangeText={setExplanation}
                placeholder="Explain why this intelligence is problematic..."
                placeholderTextColor={palette.muted}
                multiline
                style={trustStyles.reasonInput}
                maxLength={500}
                textAlignVertical="top"
              />
              <Text style={trustStyles.charHint}>{explanation.trim().length}/500</Text>

              <Text style={[trustStyles.sectionLabel, { marginTop: 10 }]}>Supporting URL (optional)</Text>
              <TextInput
                value={supportingUrl}
                onChangeText={setSupportingUrl}
                placeholder="https://..."
                placeholderTextColor={palette.muted}
                style={trustStyles.urlInput}
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={300}
              />

              {resultMsg ? (
                <View style={[trustStyles.resultBox, { borderColor: `${palette.ember}33` }]}>
                  <Text style={[trustStyles.resultText, { color: palette.ember }]}>{resultMsg}</Text>
                </View>
              ) : null}

              <Pressable
                onPress={handleSubmit}
                disabled={!canSubmit}
                style={({ pressed }) => [
                  trustStyles.submitBtn,
                  { backgroundColor: palette.ember },
                  !canSubmit && trustStyles.submitBtnDisabled,
                  pressed && { opacity: 0.85 },
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color={palette.void} size="small" />
                ) : (
                  <>
                    <Flag color={canSubmit ? palette.void : palette.muted} size={15} />
                    <Text style={[trustStyles.submitBtnText, !canSubmit && { color: palette.muted }]}>
                      Submit Dispute
                    </Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Intelligence Entry Card (shared OI with trust indicators) ───────────

/**
 * Displays a shared Open Intelligence entry with trust indicators,
 * contributor reputation, and rate/dispute action buttons.
 *
 * Used in Faction detail shared intelligence sections.
 */
export const IntelligenceEntryCard = memo(function IntelligenceEntryCard({
  entry,
  contributorReputation,
  access,
  onRate,
  onDispute,
}: {
  entry: OpenIntelligenceRow;
  contributorReputation?: PublicReputation | null;
  access: FeedbackAccessInfo;
  onRate: (entryId: string) => void;
  onDispute: (entryId: string) => void;
}): JSX.Element | null {
  const status = entry.validation_status ?? "pending_review";
  // Hide rejected and withdrawn
  if (status === "rejected" || status === "withdrawn") return null;

  const isOwn = access.isOwnEntry;

  return (
    <View style={trustStyles.entryCard}>
      <View style={trustStyles.entryTopRow}>
        <ValidationBadge status={status} />
        {entry.outdated_flag ? <OutdatedWarning /> : null}
        {(status === "disputed" || (entry.active_dispute_count ?? 0) > 0) ? <DisputedWarning /> : null}
      </View>

      <Text style={trustStyles.entryContent} numberOfLines={4}>{entry.content}</Text>

      <View style={trustStyles.entryMetaRow}>
        <QualityScoreBar score={entry.quality_score ?? 0} />
        {contributorReputation ? (
          <View style={trustStyles.entryTrustWrap}>
            <TrustLabel reputation={contributorReputation} />
          </View>
        ) : null}
      </View>

      {!isOwn ? (
        <View style={trustStyles.entryActions}>
          <Pressable
            onPress={() => onRate(entry.id)}
            style={({ pressed }) => [trustStyles.entryActionBtn, pressed && { opacity: 0.7 }]}
          >
            <ThumbsUp color={palette.cyan} size={12} />
            <Text style={[trustStyles.entryActionText, { color: palette.cyan }]}>Rate</Text>
          </Pressable>
          <Pressable
            onPress={() => onDispute(entry.id)}
            style={({ pressed }) => [trustStyles.entryActionBtn, pressed && { opacity: 0.7 }]}
          >
            <Flag color={palette.ember} size={12} />
            <Text style={[trustStyles.entryActionText, { color: palette.ember }]}>Dispute</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});

// ── Styles ──────────────────────────────────────────────────────────────

const trustStyles = StyleSheet.create({
  // Badges
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
  },
  badgeText: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 0.5 },

  warningBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
  },
  warningText: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 0.5 },

  // Quality bar
  qualityWrap: { flex: 1, minWidth: 80 },
  qualityHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 3 },
  qualityLabel: { fontSize: 9, fontWeight: "700" as const, color: palette.muted, letterSpacing: 0.3 },
  qualityValue: { fontSize: 11, fontWeight: "900" as const },
  qualityTrack: { height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.06)", overflow: "hidden" as const },
  qualityFill: { height: "100%" as const, borderRadius: 2 },

  // Trust label
  trustBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
  },
  trustText: { fontSize: 10, fontWeight: "800" as const },
  trustScore: { fontSize: 9, fontWeight: "700" as const },

  // Indicators row
  indicatorsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap" as const,
    marginTop: 6,
  },

  // Entry card
  entryCard: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(10,20,38,0.50)",
    padding: 12,
    gap: 8,
  },
  entryTopRow: { flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" as const },
  entryContent: { color: palette.text, fontSize: 12, fontWeight: "600" as const, lineHeight: 18 },
  entryMetaRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" as const },
  entryTrustWrap: { flexShrink: 1 },
  entryActions: { flexDirection: "row", gap: 8, marginTop: 4 },
  entryActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(255,255,255,0.03)",
    minHeight: 30,
  },
  entryActionText: { fontSize: 10, fontWeight: "800" as const },

  // Modals
  modalOverlay: { flex: 1, justifyContent: "flex-end" as const, backgroundColor: "rgba(2,4,10,0.80)" },
  modalSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "85%" as const,
    minHeight: "50%" as const,
    overflow: "hidden" as const,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignSelf: "center" as const,
    marginTop: 8,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  modalTitle: { color: palette.text, fontSize: 17, fontWeight: "900" as const },
  modalCloseBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center" as const, justifyContent: "center" as const },
  modalScroll: { flex: 1 },
  modalBody: { padding: 16, paddingTop: 4, paddingBottom: 40 },
  sectionLabel: { color: palette.cyan, fontSize: 10, fontWeight: "900" as const, letterSpacing: 1.5, marginBottom: 8, textTransform: "uppercase" as const },

  feedbackGrid: { flexDirection: "row", flexWrap: "wrap" as const, gap: 6 },
  feedbackChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  feedbackChipText: { fontSize: 11, fontWeight: "700" as const, color: palette.text },

  reasonInput: {
    color: palette.text,
    fontSize: 13,
    fontWeight: "600" as const,
    minHeight: 70,
    borderRadius: 6,
    padding: 10,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(10,18,30,0.50)",
  },
  urlInput: {
    color: palette.text,
    fontSize: 13,
    fontWeight: "600" as const,
    borderRadius: 6,
    padding: 10,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(10,18,30,0.50)",
  },
  charHint: { color: palette.muted, fontSize: 10, fontWeight: "700" as const, marginTop: 4, textAlign: "right" as const },

  resultBox: {
    marginTop: 12,
    padding: 10,
    borderRadius: 5,
    borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  resultText: { fontSize: 12, fontWeight: "800" as const },

  blockedText: { color: palette.muted, fontSize: 13, fontWeight: "700" as const, textAlign: "center" as const, paddingVertical: 20 },

  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center" as const,
    gap: 8,
    borderRadius: 6,
    paddingVertical: 12,
    marginTop: 16,
    backgroundColor: palette.cyan,
  },
  submitBtnDisabled: { backgroundColor: "rgba(255,255,255,0.06)" },
  submitBtnText: { color: palette.void, fontSize: 14, fontWeight: "900" as const },
});
