import { palette } from "@/constants/colors";
import { useAuth } from "@/providers/AuthProvider";
import { signOutUser } from "@/services/auth";
import { useProfile } from "@/providers/ProfileProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useSafeBack } from "@/hooks/useSafeBack";
import { useRouter } from "expo-router";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Bell,
  Camera,
  ChevronRight,
  Coins,
  Cpu,
  Crown,
  FileText,
  Hand,
  ImageIcon,
  Info,
  Layers3,
  Link2,
  Lock,
  LogOut,
  Mail,
  MessageCircle,
  RefreshCcw,
  Shield,
  Sliders,
  Star,
  Trash2,
  Upload,
  User,
  Vibrate,
  X,
  Zap,
} from "lucide-react-native";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ProfilePreferences } from "@/services/profile";
import {
  createShareAttempt,
  verifyShareScreenshot,
  getShareAttempts,
  getShareStatus,
  statusLabel,
  statusTone,
  SHARE_BADGES,
  SHARE_REWARD_AMOUNT,
  type ShareAttempt,
  type ShareAttemptStatus,
  type BadgeInfo,
} from "@/services/socialShareVerification";
import { useEagohs } from "@/providers/EagohProvider";
import { Share as RNShare } from "react-native";
import { CheckCircle2, Clock, Copy, Gift, Share2, Trophy, XCircle, QrCode, Sparkles, ChevronDown, RefreshCw, X as XIcon, ImagePlus, Camera as CameraIcon, ScanLine } from "lucide-react-native";
import { copyToClipboard } from "@/services/sharing";
import * as ImagePicker from "expo-image-picker";
import { File as ExpoFile } from "expo-file-system";
import { supabase } from "@/lib/supabase";
import { useQuery } from "@tanstack/react-query";
import { fetchNotifications } from "@/services/openIntelligence";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import { useRef } from "react";
import EagohShareCard from "@/app/_components/EagohShareCard";

type P = typeof palette;

// ── Section types ──────────────────────────────────────────────────────────

type SectionRow =
  | { kind: "info"; label: string; value: string; icon: React.ReactNode }
  | { kind: "input"; label: string; value: string; placeholder: string; icon: React.ReactNode; onChangeText: (text: string) => void; onSave: () => void; saving: boolean }
  | { kind: "button"; label: string; variant: "primary" | "danger"; icon: React.ReactNode; onPress: () => void; loading?: boolean }
  | { kind: "toggle"; label: string; value: boolean; icon: React.ReactNode; onToggle: () => void }
  | { kind: "picker"; label: string; value: string; options: { id: string; label: string; icon: React.ReactNode }[]; icon: React.ReactNode; onSelect: (id: string) => void }
  | { kind: "link"; label: string; icon: React.ReactNode; onPress: () => void }
  | { kind: "adminOverride"; tier: string; expiresAt: string | null; note: string | null }
  | { kind: "custom"; render: () => React.ReactNode }
  | { kind: "imageUpload"; label: string; currentUrl: string | null; icon: React.ReactNode; onPress: () => void; uploading: boolean; helperText?: string; infoTitle?: string; infoBody?: string };

type SettingsSection = {
  id: string;
  title: string;
  titleIcon: React.ReactNode;
  rows: SectionRow[];
};

// ── Image Upload Row ─────────────────────────────────────────────────────

const ImageUploadRow = memo(function ImageUploadRow({
  label,
  currentUrl,
  icon,
  onPress,
  uploading,
  helperText,
  infoTitle,
  infoBody,
  s,
  pal,
}: Extract<SectionRow, { kind: "imageUpload" }> & { s: ReturnType<typeof createStyles>; pal: P }): JSX.Element {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <>
      <View style={s.row}>
        <View style={s.rowIcon}>{icon}</View>
        <View style={s.rowContent}>
          <View style={{ flexDirection: "row" as const, alignItems: "center" as const, gap: 6 }}>
            <Text style={s.rowLabel}>{label}</Text>
            {infoTitle || infoBody ? (
              <Pressable
                onPress={() => setShowInfo(true)}
                hitSlop={8}
                style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
              >
                <Info color={pal.cyan} size={14} />
              </Pressable>
            ) : null}
          </View>
          {helperText ? (
            <Text style={s.rowHint}>{helperText}</Text>
          ) : null}
          <View style={{ flexDirection: "row" as const, alignItems: "center" as const, gap: 10, marginTop: 8 }}>
            {currentUrl ? (
              <View style={{ width: 48, height: 48, borderRadius: 5, backgroundColor: pal.graphite, overflow: "hidden" as const, borderWidth: 1, borderColor: pal.line }}>
                <ExpoImage source={{ uri: currentUrl }} style={{ width: "100%", height: "100%" }} />
              </View>
            ) : (
              <View style={{ width: 48, height: 48, borderRadius: 5, backgroundColor: pal.blueSoft, alignItems: "center" as const, justifyContent: "center" as const, borderWidth: 1, borderColor: pal.line }}>
                <Camera color={pal.muted} size={22} />
              </View>
            )}
            <Pressable
              onPress={onPress}
              disabled={uploading}
              style={({ pressed }) => [
                s.saveBtn,
                pressed && { opacity: 0.7 },
              ]}
            >
              {uploading ? (
                <ActivityIndicator color={pal.text} size="small" />
              ) : (
                <Text style={s.saveBtnText}>{currentUrl ? "Change" : "Upload"}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>

      <Modal
        visible={showInfo}
        transparent
        animationType="fade"
        onRequestClose={() => setShowInfo(false)}
      >
        <Pressable
          onPress={() => setShowInfo(false)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center", padding: 24 }}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View style={{
              backgroundColor: pal.panel,
              borderRadius: 5,
              borderWidth: 1,
              borderColor: pal.line,
              padding: 18,
              maxWidth: 320,
              width: "100%" as const,
              gap: 12,
            }}>
              <View style={{ flexDirection: "row" as const, alignItems: "center" as const, gap: 8 }}>
                <Info color={pal.cyan} size={18} />
                <Text style={{ color: pal.text, fontSize: 15, fontWeight: "900" as const, flex: 1 }}>
                  {infoTitle ?? label}
                </Text>
                <Pressable
                  onPress={() => setShowInfo(false)}
                  hitSlop={8}
                  style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
                >
                  <X color={pal.muted} size={18} />
                </Pressable>
              </View>
              {infoBody ? (
                <Text style={{ color: pal.muted, fontSize: 13, fontWeight: "600" as const, lineHeight: 20 }}>
                  {infoBody}
                </Text>
              ) : null}
              <Pressable
                onPress={() => setShowInfo(false)}
                style={({ pressed }) => [s.saveBtn, { alignSelf: "flex-end" as const }, pressed && { opacity: 0.7 }]}
              >
                <Text style={s.saveBtnText}>Got it</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
});

// ── Social Verification Panel ─────────────────────────────────────────────
// EAGOH Social Share Verification — share an EAGOH on social media, verify
// the public post, and earn 5 Neurons per verified share. Badge progress is
// tracked across 5 tiers. All reward logic is server-side.

function toneColor(tone: "success" | "cyan" | "gold" | "ember" | "muted", pal: P): string {
  if (tone === "success") return pal.success;
  if (tone === "cyan") return pal.cyan;
  if (tone === "gold") return pal.gold;
  if (tone === "ember") return pal.ember;
  return pal.muted;
}

function badgeForCount(count: number): { name: string; threshold: number } | null {
  for (let i = SHARE_BADGES.length - 1; i >= 0; i--) {
    if (count >= SHARE_BADGES[i].threshold) return SHARE_BADGES[i];
  }
  return null;
}

function nextBadgeForCount(count: number): { name: string; threshold: number; remaining: number } | null {
  for (let i = 0; i < SHARE_BADGES.length; i++) {
    if (count < SHARE_BADGES[i].threshold) {
      return { name: SHARE_BADGES[i].name, threshold: SHARE_BADGES[i].threshold, remaining: SHARE_BADGES[i].threshold - count };
    }
  }
  return null;
}

const EagohSelector = memo(function EagohSelector({
  pal,
  eagohs,
  selectedId,
  onSelect,
  verifiedCount,
  currentBadgeName,
}: {
  pal: P;
  eagohs: { id: string; name: string; image_url: string | null; image_thumb_url: string | null; domain: string | null; sport: string | null }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  verifiedCount: number;
  currentBadgeName: string | null;
}): JSX.Element {
  const h = useHaptics();
  const [expanded, setExpanded] = useState(false);
  const selected = eagohs.find((e) => e.id === selectedId) ?? null;
  const specialty = selected ? (selected.domain ?? selected.sport ?? "General Intelligence") : "";

  const s = useMemo(() => ({
    selectorWrap: { gap: 8 } as const,
    selectedCard: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
      padding: 10,
      borderRadius: 5,
      backgroundColor: pal.panel,
      borderWidth: 1,
      borderColor: pal.line,
    } as const,
    eagohThumb: {
      width: 48,
      height: 48,
      borderRadius: 5,
      backgroundColor: pal.graphite,
    } as const,
    eagohInfo: { flex: 1, gap: 2 } as const,
    eagohName: { color: pal.text, fontSize: 14, fontWeight: "900" as const } as const,
    eagohSpec: { color: pal.muted, fontSize: 11, fontWeight: "600" as const } as const,
    badgeChip: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 3,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 5,
      backgroundColor: pal.violetSoft,
      borderWidth: 1,
      borderColor: `${pal.violet}55`,
    } as const,
    badgeChipText: { color: pal.violet, fontSize: 9, fontWeight: "800" as const } as const,
    countRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4 } as const,
    countText: { color: pal.cyan, fontSize: 11, fontWeight: "800" as const } as const,
    chevron: { padding: 4 } as const,
    dropdown: { gap: 4, maxHeight: 260 } as const,
    dropdownItem: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
      padding: 8,
      borderRadius: 5,
      backgroundColor: "rgba(255,255,255,0.02)",
      borderWidth: 1,
      borderColor: pal.line,
    } as const,
    dropdownItemSelected: {
      borderColor: pal.cyan,
      backgroundColor: pal.cyanSoft,
    } as const,
  }), [pal]);

  return (
    <View style={s.selectorWrap}>
      <Pressable
        onPress={() => { h.selection(); setExpanded(!expanded); }}
        style={({ pressed }) => [s.selectedCard, pressed && { opacity: 0.8 }]}
      >
        {selected ? (
          <>
            {selected.image_thumb_url || selected.image_url ? (
              <ExpoImage
                source={{ uri: selected.image_thumb_url ?? selected.image_url ?? "" }}
                style={s.eagohThumb}
                contentFit="cover"
              />
            ) : (
              <View style={[s.eagohThumb, { alignItems: "center", justifyContent: "center" }]}>
                <Sparkles color={pal.cyan} size={20} />
              </View>
            )}
            <View style={s.eagohInfo}>
              <Text style={s.eagohName}>{selected.name}</Text>
              <Text style={s.eagohSpec}>{specialty}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                {currentBadgeName && (
                  <View style={s.badgeChip}>
                    <Trophy color={pal.violet} size={9} />
                    <Text style={s.badgeChipText}>{currentBadgeName}</Text>
                  </View>
                )}
                <View style={s.countRow}>
                  <CheckCircle2 color={pal.cyan} size={10} />
                  <Text style={s.countText}>{verifiedCount} verified</Text>
                </View>
              </View>
            </View>
          </>
        ) : (
          <View style={s.eagohInfo}>
            <Text style={s.eagohName}>Select an EAGOH</Text>
            <Text style={s.eagohSpec}>Choose one of your EAGOHs to share</Text>
          </View>
        )}
        <ChevronDown color={pal.muted} size={18} style={s.chevron} />
      </Pressable>

      {expanded && (
        <ScrollView style={s.dropdown} nestedScrollEnabled>
          {eagohs.length === 0 && (
            <Text style={{ color: pal.muted, fontSize: 11, fontWeight: "600", padding: 8 }}>
              Forge an EAGOH first to share it.
            </Text>
          )}
          {eagohs.map((e) => (
            <Pressable
              key={e.id}
              onPress={() => { h.selection(); onSelect(e.id); setExpanded(false); }}
              style={({ pressed }) => [
                s.dropdownItem,
                e.id === selectedId && s.dropdownItemSelected,
                pressed && { opacity: 0.8 },
              ]}
            >
              {e.image_thumb_url || e.image_url ? (
                <ExpoImage
                  source={{ uri: e.image_thumb_url ?? e.image_url ?? "" }}
                  style={{ width: 36, height: 36, borderRadius: 5, backgroundColor: pal.graphite }}
                  contentFit="cover"
                />
              ) : (
                <View style={{ width: 36, height: 36, borderRadius: 5, backgroundColor: pal.graphite, alignItems: "center", justifyContent: "center" }}>
                  <Sparkles color={pal.cyan} size={14} />
                </View>
              )}
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={{ color: pal.text, fontSize: 12, fontWeight: "800" }}>{e.name}</Text>
                <Text style={{ color: pal.muted, fontSize: 10, fontWeight: "600" }}>{e.domain ?? e.sport ?? "General"}</Text>
              </View>
              {e.id === selectedId && <CheckCircle2 color={pal.cyan} size={14} />}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
});

const BadgeProgress = memo(function BadgeProgress({
  pal,
  count,
  badges,
}: {
  pal: P;
  count: number;
  badges: BadgeInfo[];
}): JSX.Element {
  const s = useMemo(() => ({
    wrap: { gap: 8 } as const,
    header: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 } as const,
    countBig: { color: pal.cyan, fontSize: 22, fontWeight: "900" as const } as const,
    countLabel: { color: pal.muted, fontSize: 10, fontWeight: "700" as const, letterSpacing: 1 } as const,
    progressWrap: { gap: 6 } as const,
    badgeRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 5,
      borderWidth: 1,
    } as const,
    badgeRowUnlocked: {
      backgroundColor: pal.violetSoft,
      borderColor: `${pal.violet}66`,
    } as const,
    badgeRowLocked: {
      backgroundColor: "rgba(255,255,255,0.02)",
      borderColor: pal.line,
    } as const,
    badgeIcon: { width: 28, alignItems: "center" } as const,
    badgeInfo: { flex: 1, gap: 2 } as const,
    badgeName: { fontSize: 12, fontWeight: "900" as const } as const,
    badgeThreshold: { fontSize: 10, fontWeight: "600" as const } as const,
    progressBar: {
      height: 4,
      borderRadius: 2,
      backgroundColor: pal.graphite,
      overflow: "hidden" as const,
    } as const,
    progressFill: {
      height: 4,
      borderRadius: 2,
    } as const,
  }), [pal]);

  const nextB = nextBadgeForCount(count);
  const currentB = badgeForCount(count);

  return (
    <View style={s.wrap}>
      <View style={s.header}>
        <Trophy color={pal.violet} size={18} />
        <Text style={s.countBig}>{count}</Text>
        <Text style={s.countLabel}>VERIFIED SHARES</Text>
      </View>

      {currentB && (
        <View style={[s.badgeRow, s.badgeRowUnlocked]}>
          <View style={s.badgeIcon}><Trophy color={pal.violet} size={16} /></View>
          <View style={s.badgeInfo}>
            <Text style={[s.badgeName, { color: pal.violet }]}>{currentB.name}</Text>
            <Text style={[s.badgeThreshold, { color: pal.muted }]}>Current badge · {currentB.threshold} shares</Text>
          </View>
        </View>
      )}

      {nextB && (
        <View style={{ gap: 4 }}>
          <Text style={{ color: pal.muted, fontSize: 10, fontWeight: "700", paddingHorizontal: 2 }}>
            {count} of {nextB.threshold} verified shares · {nextB.remaining} remaining until {nextB.name}
          </Text>
          <View style={s.progressBar}>
            <View style={[s.progressFill, { width: `${Math.min(100, (count / nextB.threshold) * 100)}%`, backgroundColor: pal.violet }]} />
          </View>
        </View>
      )}

      <View style={s.progressWrap}>
        {badges.map((b) => {
          const unlocked = b.unlocked;
          return (
            <View key={b.name} style={[s.badgeRow, unlocked ? s.badgeRowUnlocked : s.badgeRowLocked]}>
              <View style={s.badgeIcon}>
                <Trophy color={unlocked ? pal.violet : pal.muted} size={16} />
              </View>
              <View style={s.badgeInfo}>
                <Text style={[s.badgeName, { color: unlocked ? pal.violet : pal.muted }]}>
                  {b.name}
                </Text>
                <Text style={[s.badgeThreshold, { color: pal.muted }]}>
                  {b.threshold} shares{unlocked ? " · Unlocked" : ""}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
});

const HistoryList = memo(function HistoryList({
  pal,
  attempts,
}: {
  pal: P;
  attempts: ShareAttempt[];
}): JSX.Element {
  const s = useMemo(() => ({
    wrap: { gap: 6 } as const,
    emptyText: { color: pal.muted, fontSize: 11, fontWeight: "600", paddingVertical: 8, textAlign: "center" as const } as const,
    row: {
      padding: 10,
      borderRadius: 5,
      backgroundColor: "rgba(255,255,255,0.02)",
      borderWidth: 1,
      borderColor: pal.line,
      gap: 4,
    } as const,
    rowTop: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const } as const,
    eagohName: { color: pal.text, fontSize: 12, fontWeight: "800" as const, flex: 1 } as const,
    statusChip: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 3,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 5,
    } as const,
    statusChipText: { fontSize: 9, fontWeight: "800" as const } as const,
    postUrl: { color: pal.muted, fontSize: 10, fontWeight: "500" as const } as const,
    rowBottom: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const } as const,
    dateText: { color: pal.muted, fontSize: 9, fontWeight: "600" as const } as const,
    rewardText: { color: pal.success, fontSize: 10, fontWeight: "800" as const } as const,
  }), [pal]);

  if (attempts.length === 0) {
    return (
      <View>
        <Text style={s.emptyText}>No share attempts yet. Share an EAGOH to get started.</Text>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      {attempts.slice(0, 10).map((a) => {
        const tone = statusTone(a.status);
        const toneC = toneColor(tone, pal);
        const date = new Date(a.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        return (
          <View key={a.id} style={s.row}>
            <View style={s.rowTop}>
              <Text style={s.eagohName} numberOfLines={1}>{a.eagoh_name}</Text>
              <View style={[s.statusChip, { backgroundColor: `${toneC}22`, borderWidth: 1, borderColor: `${toneC}55` }]}>
                {a.status === "verified" ? <CheckCircle2 color={toneC} size={10} /> : null}
                {a.status === "manual_review" ? <Clock color={toneC} size={10} /> : null}
                {a.status === "rejected" || a.status === "already_verified" || a.status === "expired" ? <XCircle color={toneC} size={10} /> : null}
                <Text style={[s.statusChipText, { color: toneC }]}>{statusLabel(a.status)}</Text>
              </View>
            </View>
            {a.submitted_post_url ? (
              <Text style={s.postUrl} numberOfLines={1}>{a.submitted_post_url}</Text>
            ) : null}
            <View style={s.rowBottom}>
              <Text style={s.dateText}>{date}</Text>
              {a.reward_awarded ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <Gift color={pal.success} size={10} />
                  <Text style={s.rewardText}>+{a.reward_amount} Neurons</Text>
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
});

const SocialVerificationPanel = memo(function SocialVerificationPanel({
  pal,
}: {
  pal: P;
}): JSX.Element {
  const { user } = useAuth();
  const h = useHaptics();
  const { eagohs } = useEagohs();
  const queryClient = useQueryClient();
  const { refetch: refetchProfile } = useProfile();

  const [selectedEagohId, setSelectedEagohId] = useState<string | null>(null);
  const [loadingShare, setLoadingShare] = useState(false);
  const [cardPhase, setCardPhase] = useState<"idle" | "creating" | "ready" | "capturing" | "sharing">("idle");
  const [activeAttempt, setActiveAttempt] = useState<{ attemptId: string; verificationCode: string; publicEagohUrl: string; shareContent: string; qrCodeUrl: string; eagohName: string; eagohImageUrl: string | null; creatorName: string; specialty: string } | null>(null);
  const [imagesReady, setImagesReady] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const cardRef = useRef<View>(null);
  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);
  const [screenshotBase64, setScreenshotBase64] = useState<string | null>(null);
  const [screenshotHash, setScreenshotHash] = useState<string>("");
  const [postUrlInput, setPostUrlInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; status: string; message?: string; rewardAmount?: number } | null>(null);
  const [history, setHistory] = useState<ShareAttempt[]>([]);
  const [badges, setBadges] = useState<BadgeInfo[]>(SHARE_BADGES.map((b) => ({ name: b.name, threshold: b.threshold, unlocked: false })));
  const [verifiedCount, setVerifiedCount] = useState(0);
  const [loadingData, setLoadingData] = useState(true);
  const [showVerifySection, setShowVerifySection] = useState(false);
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);

  const userForgedEagohs = useMemo(() => eagohs.filter((e) => !e.is_default_shell), [eagohs]);
  const currentBadgeName = useMemo(() => badgeForCount(verifiedCount)?.name ?? null, [verifiedCount]);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    try {
      const [status, attempts] = await Promise.all([getShareStatus(), getShareAttempts()]);
      if (status.ok) {
        setVerifiedCount(status.verifiedShareCount);
        if (status.badges) setBadges(status.badges);
      }
      setHistory(attempts);
    } catch {
      // ignore — panel still renders with defaults
    } finally {
      setLoadingData(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Auto-select first EAGOH if none selected
  useEffect(() => {
    if (!selectedEagohId && userForgedEagohs.length > 0) {
      setSelectedEagohId(userForgedEagohs[0].id);
    }
  }, [selectedEagohId, userForgedEagohs]);

  const handleShare = useCallback(async () => {
    if (!selectedEagohId || loadingShare) return;
    setLoadingShare(true);
    setShareError(null);
    setVerifyResult(null);
    setShowVerifySection(false);
    setCardPhase("creating");
    setImagesReady(false);
    try {
      // 1. Create the backend share attempt first (generates verification code)
      const result = await createShareAttempt(selectedEagohId);
      const selectedEagoh = userForgedEagohs.find((e) => e.id === selectedEagohId);
      const specialty = selectedEagoh ? (selectedEagoh.domain ?? selectedEagoh.sport ?? "General Intelligence") : "General Intelligence";
      setActiveAttempt({
        attemptId: result.attemptId,
        verificationCode: result.verificationCode,
        publicEagohUrl: result.publicEagohUrl,
        shareContent: result.shareContent,
        qrCodeUrl: result.qrCodeUrl,
        eagohName: result.eagohName,
        eagohImageUrl: result.eagohImageUrl,
        creatorName: result.creatorName,
        specialty,
      });
      h.success();
      // Card is now rendered with the verification code; wait for images to load.
      // The actual capture + share happens in handleCaptureAndShare, triggered
      // either automatically once imagesReady becomes true or by the user tapping Share.
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not create share.";
      setShareError(msg);
      setCardPhase("idle");
      Alert.alert("Share Failed", msg);
      h.warning();
    } finally {
      setLoadingShare(false);
    }
  }, [selectedEagohId, loadingShare, h, userForgedEagohs]);

  // Auto-capture + share once both the EAGOH image and QR code have loaded.
  useEffect(() => {
    if (cardPhase === "creating" && imagesReady && activeAttempt && cardRef.current) {
      void handleCaptureAndShare();
    }
  }, [cardPhase, imagesReady, activeAttempt]);

  const handleCaptureAndShare = useCallback(async () => {
    if (!activeAttempt || !cardRef.current) return;
    setCardPhase("capturing");
    setShareError(null);
    try {
      // Capture the card at 1080×1350 physical pixels.
      // The card is 360×450 logical points; we scale via PixelRatio to get
      // a high-quality PNG. We request width=1080 so the library scales up.
      const targetWidth = 1080;
      const uri = await captureRef(cardRef, {
        result: "tmpfile",
        format: "png",
        quality: 1,
        width: targetWidth,
        height: Math.round(targetWidth / (1080 / 1350)),
      });

      setCardPhase("sharing");

      // Build the share text (URL + code) — some platforms preserve it.
      const shareText = `${activeAttempt.eagohName} — EAGOH Intelligence Analyst\n${activeAttempt.publicEagohUrl}\nVerification Code: ${activeAttempt.verificationCode}`;

      // Prefer expo-sharing (supports image files) over RNShare for image sharing.
      const fileUri = uri.startsWith("file://") ? uri : `file://${uri}`;

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: "image/png",
          dialogTitle: `Share ${activeAttempt.eagohName}`,
          UTI: "public.image",
        });
        h.success();
        setCardPhase("ready");
        setShowVerifySection(true);
      } else {
        // Fallback to RNShare with the image URI + text.
        try {
          await RNShare.share({
            message: shareText,
            url: fileUri,
            title: `Share ${activeAttempt.eagohName}`,
          });
          h.success();
          setCardPhase("ready");
          setShowVerifySection(true);
        } catch {
          // User cancelled — keep card ready so they can retry.
          setCardPhase("ready");
          setShowVerifySection(true);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not capture the share card image.";
      console.warn("[social:share] capture/share failed", msg.slice(0, 200));
      setShareError(msg);
      setCardPhase("ready"); // allow retry
      Alert.alert(
        "Card Capture Failed",
        "The EAGOH share card image could not be generated. You can retry sharing, or cancel to go back. The share attempt was not marked as shared.",
      );
      h.warning();
    }
  }, [activeAttempt, h]);

  const handleCancelShare = useCallback(() => {
    h.selection();
    setActiveAttempt(null);
    setCardPhase("idle");
    setImagesReady(false);
    setShareError(null);
    setShowVerifySection(false);
  }, [h]);

  // ── Screenshot selection ─────────────────────────────────────────────
  const handlePickScreenshot = useCallback(async () => {
    h.selection();
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission Required", "Photo library access is needed to upload a screenshot.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 0.8,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const uri = asset.uri;
    const b64 = asset.base64 ?? null;
    if (!b64) {
      Alert.alert("Upload Failed", "Could not read the selected image. Please try a different screenshot.");
      return;
    }
    // Validate file size (10 MB max)
    const maxBytes = 10 * 1024 * 1024;
    const byteLen = Math.floor((b64.length * 3) / 4);
    if (byteLen > maxBytes) {
      Alert.alert("File Too Large", "This screenshot is over 10 MB. Please select a smaller image.");
      return;
    }
    // Compute a simple hash for duplicate detection (FNV-1a on the base64)
    let hash = 2166136261;
    for (let i = 0; i < b64.length; i += 47) {
      const chunk = b64.slice(i, i + 47);
      for (let j = 0; j < chunk.length; j++) {
        hash ^= chunk.charCodeAt(j);
        hash = Math.imul(hash, 16777619);
      }
    }
    const hashStr = `h_${(hash >>> 0).toString(16).padStart(8, "0")}_${byteLen}`;
    setScreenshotUri(uri);
    setScreenshotBase64(b64);
    setScreenshotHash(hashStr);
    setVerifyResult(null);
  }, [h]);

  const handleTakeScreenshot = useCallback(async () => {
    h.selection();
    const camPerm = await ImagePicker.requestCameraPermissionsAsync();
    if (!camPerm.granted) {
      Alert.alert("Permission Required", "Camera access is needed to take a photo.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 0.8,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const b64 = asset.base64 ?? null;
    if (!b64) return;
    const maxBytes = 10 * 1024 * 1024;
    const byteLen = Math.floor((b64.length * 3) / 4);
    if (byteLen > maxBytes) {
      Alert.alert("File Too Large", "This photo is over 10 MB. Please try again with less detail.");
      return;
    }
    let hash = 2166136261;
    for (let i = 0; i < b64.length; i += 47) {
      const chunk = b64.slice(i, i + 47);
      for (let j = 0; j < chunk.length; j++) {
        hash ^= chunk.charCodeAt(j);
        hash = Math.imul(hash, 16777619);
      }
    }
    const hashStr = `h_${(hash >>> 0).toString(16).padStart(8, "0")}_${byteLen}`;
    setScreenshotUri(asset.uri);
    setScreenshotBase64(b64);
    setScreenshotHash(hashStr);
    setVerifyResult(null);
  }, [h]);

  const handleRemoveScreenshot = useCallback(() => {
    h.selection();
    setScreenshotUri(null);
    setScreenshotBase64(null);
    setScreenshotHash("");
    setVerifyResult(null);
  }, [h]);

  const handleVerify = useCallback(async () => {
    if (!activeAttempt || verifying || !screenshotBase64) return;
    setVerifying(true);
    setVerifyResult(null);
    try {
      const result = await verifyShareScreenshot(
        activeAttempt.attemptId,
        screenshotBase64,
        screenshotHash,
        postUrlInput.trim() || undefined,
      );
      setVerifyResult({
        ok: result.ok,
        status: result.status,
        message: result.message ?? result.error,
        rewardAmount: result.rewardAmount,
      });
      if (result.ok && result.status === "verified") {
        h.success();
        setPostUrlInput("");
        setScreenshotUri(null);
        setScreenshotBase64(null);
        setScreenshotHash("");
        await loadData(); // refresh history + count
        // Invalidate profile + marketplace caches so the verified badge
        // appears immediately across all screens without restart.
        queryClient.invalidateQueries({ queryKey: ["profile"] });
        queryClient.invalidateQueries({ queryKey: ["marketplace"] });
        queryClient.invalidateQueries({ queryKey: ["public-profile"] });
        refetchProfile?.();
      } else {
        h.warning();
        await loadData();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Verification failed. Please try again.";
      setVerifyResult({ ok: false, status: "rejected", message: msg });
      h.warning();
    } finally {
      setVerifying(false);
    }
  }, [activeAttempt, verifying, screenshotBase64, screenshotHash, postUrlInput, h, loadData, queryClient, refetchProfile]);

  const inlineStyles = useMemo(
    () => ({
      container: { padding: 14, gap: 14 } as const,
      sectionTitle: { color: pal.text, fontSize: 13, fontWeight: "900" as const, letterSpacing: 0.5 } as const,
      sectionHint: { color: pal.muted, fontSize: 11, fontWeight: "600" as const, lineHeight: 16 } as const,
      rewardBanner: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        padding: 10,
        borderRadius: 5,
        backgroundColor: pal.successSoft,
        borderWidth: 1,
        borderColor: `${pal.success}55`,
      } as const,
      rewardText: { color: pal.success, fontSize: 12, fontWeight: "800" as const, flex: 1 } as const,
      shareBtn: {
        minHeight: 44,
        borderRadius: 5,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        flexDirection: "row" as const,
        gap: 8,
        backgroundColor: pal.cyan,
      } as const,
      shareBtnText: { color: pal.void, fontSize: 14, fontWeight: "900" as const } as const,
      verifyBtn: {
        minHeight: 44,
        borderRadius: 5,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        flexDirection: "row" as const,
        gap: 8,
        backgroundColor: pal.violet,
        opacity: 1,
      } as const,
      verifyBtnText: { color: pal.void, fontSize: 14, fontWeight: "900" as const } as const,
      textInput: {
        backgroundColor: "rgba(3,6,11,0.62)",
        borderWidth: 1,
        borderColor: pal.line,
        borderRadius: 5,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: pal.text,
        fontSize: 13,
        fontWeight: "700" as const,
        minHeight: 44,
      } as const,
      codeBox: {
        alignItems: "center" as const,
        padding: 12,
        borderRadius: 5,
        backgroundColor: pal.graphite,
        borderWidth: 1,
        borderColor: pal.cyan,
        gap: 4,
      } as const,
      codeLabel: { color: pal.muted, fontSize: 9, fontWeight: "700" as const, letterSpacing: 1.5 } as const,
      codeText: { color: pal.cyan, fontSize: 18, fontWeight: "900" as const, letterSpacing: 2 } as const,
      qrWrap: {
        alignItems: "center" as const,
        gap: 4,
        paddingVertical: 8,
      } as const,
      qrLabel: { color: pal.muted, fontSize: 10, fontWeight: "600" as const } as const,
      resultBox: {
        padding: 10,
        borderRadius: 5,
        borderWidth: 1,
        gap: 4,
      } as const,
      divider: {
        height: 1,
        backgroundColor: pal.line,
        marginVertical: 2,
      } as const,
      privacyHelper: {
        color: pal.ember,
        fontSize: 10,
        fontWeight: "700" as const,
        lineHeight: 15,
        backgroundColor: pal.emberSoft,
        padding: 8,
        borderRadius: 5,
        borderWidth: 1,
        borderColor: `${pal.ember}30`,
      } as const,
    }),
    [pal],
  );

  if (loadingData) {
    return (
      <View style={{ padding: 14, alignItems: "center" }}>
        <ActivityIndicator color={pal.cyan} size="small" />
      </View>
    );
  }

  return (
    <View style={inlineStyles.container}>
      {/* Reward info banner */}
      <View style={inlineStyles.rewardBanner}>
        <Gift color={pal.success} size={16} />
        <Text style={inlineStyles.rewardText}>
          Earn {SHARE_REWARD_AMOUNT} Neurons per verified social share
        </Text>
      </View>

      {/* 1. EAGOH Selection */}
      <View>
        <Text style={inlineStyles.sectionTitle}>1. Select Your EAGOH</Text>
        <View style={{ height: 6 }} />
        <EagohSelector
          pal={pal}
          eagohs={userForgedEagohs}
          selectedId={selectedEagohId}
          onSelect={setSelectedEagohId}
          verifiedCount={verifiedCount}
          currentBadgeName={currentBadgeName}
        />
      </View>

      {/* 2. Share My EAGOH button */}
      <Pressable
        onPress={handleShare}
        disabled={!selectedEagohId || loadingShare || cardPhase === "capturing" || cardPhase === "sharing"}
        style={({ pressed }) => [
          inlineStyles.shareBtn,
          { opacity: !selectedEagohId || loadingShare || cardPhase === "capturing" || cardPhase === "sharing" ? 0.5 : 1 },
          pressed && { opacity: 0.8 },
        ]}
      >
        {loadingShare || cardPhase === "creating" ? (
          <>
            <ActivityIndicator color={pal.void} size="small" />
            <Text style={inlineStyles.shareBtnText}>Creating EAGOH Card...</Text>
          </>
        ) : cardPhase === "capturing" ? (
          <>
            <ActivityIndicator color={pal.void} size="small" />
            <Text style={inlineStyles.shareBtnText}>Capturing Card...</Text>
          </>
        ) : cardPhase === "sharing" ? (
          <>
            <ActivityIndicator color={pal.void} size="small" />
            <Text style={inlineStyles.shareBtnText}>Opening Share Sheet...</Text>
          </>
        ) : (
          <>
            <Share2 color={pal.void} size={16} />
            <Text style={inlineStyles.shareBtnText}>Share My EAGOH</Text>
          </>
        )}
      </Pressable>

      {/* Share card preview + capture target */}
      {activeAttempt && (
        <View style={{ gap: 12 }}>
          {/* Card preview — this is the capture target */}
          <View style={{ alignItems: "center", paddingVertical: 8 }}>
            <View
              ref={cardRef}
              collapsable={false}
              style={{ borderRadius: 16, overflow: "hidden" }}
            >
              <EagohShareCard
                data={{
                  eagohName: activeAttempt.eagohName,
                  eagohImageUrl: activeAttempt.eagohImageUrl,
                  specialty: activeAttempt.specialty,
                  creatorName: activeAttempt.creatorName,
                  currentBadgeName: currentBadgeName,
                  publicEagohUrl: activeAttempt.publicEagohUrl,
                  verificationCode: activeAttempt.verificationCode,
                  qrCodeUrl: activeAttempt.qrCodeUrl,
                }}
                onImagesLoaded={() => { setImagesReady(true); }}
              />
            </View>
          </View>

          {/* Loading indicator while card images load */}
          {cardPhase === "creating" && !imagesReady && (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 4 }}>
              <ActivityIndicator color={pal.cyan} size="small" />
              <Text style={{ color: pal.muted, fontSize: 11, fontWeight: "700" }}>
                Loading card images...
              </Text>
            </View>
          )}

          {/* Error state */}
          {shareError && (
            <View style={{ padding: 10, borderRadius: 5, backgroundColor: pal.emberSoft, borderWidth: 1, borderColor: `${pal.ember}55`, gap: 4 }}>
              <Text style={{ color: pal.ember, fontSize: 11, fontWeight: "800" }}>
                Card capture failed: {shareError}
              </Text>
              <Text style={{ color: pal.muted, fontSize: 10, fontWeight: "600" }}>
                The share attempt was not marked as shared. You can retry below.
              </Text>
            </View>
          )}

          {/* Action buttons — Share / Regenerate / Cancel */}
          {cardPhase === "ready" && (
            <View style={{ gap: 8 }}>
              <Pressable
                onPress={() => void handleCaptureAndShare()}
                style={({ pressed }) => [
                  inlineStyles.shareBtn,
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Share2 color={pal.void} size={16} />
                <Text style={inlineStyles.shareBtnText}>Share Card Image</Text>
              </Pressable>
              {!showVerifySection && (
                <Pressable
                  onPress={() => { h.selection(); void handleShare(); }}
                  style={({ pressed }) => [
                    { minHeight: 40, borderRadius: 5, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, backgroundColor: pal.panel, borderWidth: 1, borderColor: pal.line },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <RefreshCw color={pal.cyan} size={14} />
                  <Text style={{ color: pal.cyan, fontSize: 12, fontWeight: "800" }}>Regenerate Card</Text>
                </Pressable>
              )}
              <Pressable
                onPress={handleCancelShare}
                style={({ pressed }) => [
                  { minHeight: 40, borderRadius: 5, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, backgroundColor: pal.emberSoft, borderWidth: 1, borderColor: `${pal.ember}44` },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <XIcon color={pal.ember} size={14} />
                <Text style={{ color: pal.ember, fontSize: 12, fontWeight: "800" }}>Cancel</Text>
              </Pressable>
            </View>
          )}

          {/* Verification code + URL summary (always visible after attempt) */}
          <View style={inlineStyles.codeBox}>
            <Text style={inlineStyles.codeLabel}>VERIFICATION CODE</Text>
            <Text style={inlineStyles.codeText}>{activeAttempt.verificationCode}</Text>
          </View>

          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Text style={{ color: pal.muted, fontSize: 10, fontWeight: "600", flex: 1 }} numberOfLines={2}>
              {activeAttempt.publicEagohUrl}
            </Text>
            <Pressable
              onPress={() => { h.selection(); copyToClipboard(activeAttempt.publicEagohUrl, "EAGOH link"); }}
              style={({ pressed }) => [pressed && { opacity: 0.7 }]}
            >
              <Copy color={pal.cyan} size={16} />
            </Pressable>
          </View>
        </View>
      )}

      {/* 3. Verify My Share — AI Screenshot Verification */}
      {showVerifySection && activeAttempt && (
        <View style={{ gap: 10 }}>
          <Text style={inlineStyles.sectionTitle}>3. Verify Your Share</Text>
          <Text style={inlineStyles.sectionHint}>
            Upload a screenshot of your published post. Make sure the EAGOH card and verification code are visible.
          </Text>

          {/* Helper: caption freedom */}
          <View style={{
            flexDirection: "row" as const,
            alignItems: "flex-start" as const,
            gap: 6,
            padding: 8,
            borderRadius: 5,
            backgroundColor: pal.cyanSoft,
            borderWidth: 1,
            borderColor: `${pal.cyan}33`,
          }}>
            <Sparkles color={pal.cyan} size={12} style={{ marginTop: 1 }} />
            <Text style={{ color: pal.cyan, fontSize: 10, fontWeight: "700", flex: 1, lineHeight: 15 }}>
              You can write any caption you want. Your verification code only needs to be visible on the EAGOH card.
            </Text>
          </View>

          {/* Screenshot upload area */}
          {!screenshotUri ? (
            <View style={{ gap: 8 }}>
              <Pressable
                onPress={() => void handlePickScreenshot()}
                disabled={uploadingScreenshot}
                style={({ pressed }) => [
                  {
                    minHeight: 120,
                    borderRadius: 8,
                    alignItems: "center" as const,
                    justifyContent: "center" as const,
                    gap: 8,
                    backgroundColor: pal.graphite,
                    borderWidth: 1.5,
                    borderColor: `${pal.cyan}44`,
                    borderStyle: "dashed" as const,
                  },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <ImagePlus color={pal.cyan} size={28} />
                <Text style={{ color: pal.cyan, fontSize: 14, fontWeight: "900" }}>Upload Post Screenshot</Text>
                <Text style={{ color: pal.muted, fontSize: 10, fontWeight: "600" }}>
                  Select from Photos
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void handleTakeScreenshot()}
                disabled={uploadingScreenshot}
                style={({ pressed }) => [
                  {
                    minHeight: 44,
                    borderRadius: 5,
                    alignItems: "center" as const,
                    justifyContent: "center" as const,
                    flexDirection: "row" as const,
                    gap: 8,
                    backgroundColor: pal.panel,
                    borderWidth: 1,
                    borderColor: pal.line,
                  },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <CameraIcon color={pal.text} size={16} />
                <Text style={{ color: pal.text, fontSize: 12, fontWeight: "800" }}>Take Photo Instead</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              {/* Screenshot preview */}
              <View style={{
                borderRadius: 8,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: pal.line,
                backgroundColor: pal.graphite,
              }}>
                <ExpoImage
                  source={{ uri: screenshotUri }}
                  style={{ width: "100%", height: 240, backgroundColor: pal.graphite }}
                  contentFit="contain"
                  cachePolicy="none"
                />
              </View>

              {/* Replace / Remove buttons */}
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable
                  onPress={() => void handlePickScreenshot()}
                  style={({ pressed }) => [
                    {
                      flex: 1,
                      minHeight: 40,
                      borderRadius: 5,
                      alignItems: "center" as const,
                      justifyContent: "center" as const,
                      flexDirection: "row" as const,
                      gap: 6,
                      backgroundColor: pal.panel,
                      borderWidth: 1,
                      borderColor: pal.line,
                    },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <RefreshCw color={pal.cyan} size={14} />
                  <Text style={{ color: pal.cyan, fontSize: 12, fontWeight: "800" }}>Replace</Text>
                </Pressable>
                <Pressable
                  onPress={handleRemoveScreenshot}
                  style={({ pressed }) => [
                    {
                      minHeight: 40,
                      borderRadius: 5,
                      alignItems: "center" as const,
                      justifyContent: "center" as const,
                      flexDirection: "row" as const,
                      gap: 6,
                      paddingHorizontal: 14,
                      backgroundColor: pal.emberSoft,
                      borderWidth: 1,
                      borderColor: `${pal.ember}44`,
                    },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Trash2 color={pal.ember} size={14} />
                  <Text style={{ color: pal.ember, fontSize: 12, fontWeight: "800" }}>Remove</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Optional post URL */}
          <View style={{ gap: 4, marginTop: 2 }}>
            <Text style={{ color: pal.muted, fontSize: 10, fontWeight: "700", letterSpacing: 0.5 }}>
              POST LINK — OPTIONAL
            </Text>
            <TextInput
              style={[inlineStyles.textInput, { minHeight: 40 }]}
              value={postUrlInput}
              onChangeText={setPostUrlInput}
              placeholder="Optional: paste your post URL for audit"
              placeholderTextColor={pal.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>

          {/* Verify button */}
          <Pressable
            onPress={handleVerify}
            disabled={verifying || !screenshotBase64}
            style={({ pressed }) => [
              inlineStyles.verifyBtn,
              { opacity: verifying || !screenshotBase64 ? 0.5 : 1 },
              pressed && { opacity: 0.8 },
            ]}
          >
            {verifying ? (
              <>
                <ActivityIndicator color={pal.void} size="small" />
                <Text style={inlineStyles.verifyBtnText}>AI is verifying your published post...</Text>
              </>
            ) : (
              <>
                <ScanLine color={pal.void} size={16} />
                <Text style={inlineStyles.verifyBtnText}>Verify My Share</Text>
              </>
            )}
          </Pressable>

          {verifyResult && (
            <View style={[
              inlineStyles.resultBox,
              {
                backgroundColor: verifyResult.ok && verifyResult.status === "verified" ? pal.successSoft : verifyResult.status === "manual_review" ? pal.goldSoft : pal.emberSoft,
                borderColor: verifyResult.ok && verifyResult.status === "verified" ? `${pal.success}55` : verifyResult.status === "manual_review" ? `${pal.gold}55` : `${pal.ember}55`,
              },
            ]}>
              <Text style={{
                color: verifyResult.ok && verifyResult.status === "verified" ? pal.success : verifyResult.status === "manual_review" ? pal.gold : pal.ember,
                fontSize: 12,
                fontWeight: "800",
              }}>
                {verifyResult.status === "verified" ? "Share Verified" : verifyResult.status === "manual_review" ? "Needs Review" : "Verification Failed"}
              </Text>
              {verifyResult.message ? (
                <Text style={{ color: pal.text, fontSize: 11, fontWeight: "600", lineHeight: 16 }}>
                  {verifyResult.message}
                </Text>
              ) : null}
              {verifyResult.ok && verifyResult.status === "verified" && verifyResult.rewardAmount ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                  <Gift color={pal.success} size={12} />
                  <Text style={{ color: pal.success, fontSize: 11, fontWeight: "900" }}>+{verifyResult.rewardAmount} Neurons awarded!</Text>
                </View>
              ) : null}
            </View>
          )}
        </View>
      )}

      <View style={inlineStyles.divider} />

      {/* 6. Badges */}
      <View>
        <Text style={inlineStyles.sectionTitle}>Badges</Text>
        <View style={{ height: 8 }} />
        <BadgeProgress pal={pal} count={verifiedCount} badges={badges} />
      </View>

      <View style={inlineStyles.divider} />

      {/* 7. Verification History */}
      <View>
        <Text style={inlineStyles.sectionTitle}>Verification History</Text>
        <View style={{ height: 8 }} />
        <HistoryList pal={pal} attempts={history} />
      </View>

      <View style={inlineStyles.privacyHelper}>
        <Text style={{ color: pal.ember, fontSize: 10, fontWeight: "900" }}>
          Verification is handled securely on our servers using AI screenshot analysis. You cannot directly mark a share as verified or award yourself Neurons. Duplicate screenshots and expired codes are automatically rejected.
        </Text>
      </View>
    </View>
  );
});

// ── Styles factory (parametrised on palette so theme changes re-render) ────

function createStyles(pal: P) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: pal.void },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 18,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: pal.line,
      backgroundColor: pal.obsidian,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 5,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: pal.panel,
      borderWidth: 1,
      borderColor: pal.line,
    },
    headerTitle: {
      color: pal.text,
      fontSize: 18,
      fontWeight: "900" as const,
      flex: 1,
    },
    scroll: { flex: 1 },
    scrollContent: { padding: 18, paddingBottom: 120, gap: 14 },

    // Section
    section: {
      borderRadius: 5,
      backgroundColor: pal.panel,
      borderWidth: 1,
      borderColor: pal.line,
      overflow: "hidden" as const,
    },
    sectionHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderBottomWidth: 1,
      borderBottomColor: pal.line,
      backgroundColor: pal.cyanSoft,
    },
    sectionHeaderText: {
      color: pal.text,
      fontSize: 13,
      fontWeight: "900" as const,
      letterSpacing: 0.8,
      textTransform: "uppercase" as const,
    },
    sectionBody: { gap: 0 },

    // Row base
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: 14,
      paddingVertical: 12,
      gap: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: pal.line,
    },
    rowDanger: {
      backgroundColor: pal.emberSoft,
    },
    rowIcon: {
      width: 34,
      height: 34,
      borderRadius: 5,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      backgroundColor: pal.blueSoft,
      borderWidth: 1,
      borderColor: pal.line,
    },
    rowContent: { flex: 1 },
    rowLabel: {
      color: pal.text,
      fontSize: 13,
      fontWeight: "800" as const,
    },
    rowValue: {
      color: pal.muted,
      fontSize: 12,
      fontWeight: "600" as const,
      marginTop: 2,
    },
    rowHint: {
      color: pal.muted,
      fontSize: 11,
      fontWeight: "600" as const,
      marginTop: 2,
    },

    // Input row
    inputRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      marginTop: 6,
    },
    textInput: {
      flex: 1,
      backgroundColor: pal.blueSoft,
      borderWidth: 1,
      borderColor: pal.line,
      borderRadius: 5,
      paddingHorizontal: 10,
      paddingVertical: 8,
      color: pal.text,
      fontSize: 13,
      fontWeight: "700" as const,
    },
    saveBtn: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 5,
      backgroundColor: pal.cyan,
    },
    saveBtnText: {
      color: pal.void,
      fontSize: 12,
      fontWeight: "900" as const,
    },

    // Toggle
    toggleTrack: {
      width: 46,
      height: 26,
      borderRadius: 13,
      backgroundColor: pal.line,
      justifyContent: "center" as const,
      padding: 3,
    },
    toggleTrackActive: {
      backgroundColor: pal.successSoft,
    },
    toggleThumb: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: pal.muted,
    },
    toggleThumbActive: {
      backgroundColor: pal.success,
      alignSelf: "flex-end" as const,
    },

    // Picker
    pickerOptions: {
      flexDirection: "row" as const,
      gap: 8,
      marginTop: 8,
    },
    pickerChip: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 5,
      backgroundColor: pal.blueSoft,
      borderWidth: 1,
      borderColor: pal.line,
    },
    pickerChipActive: {
      backgroundColor: pal.cyanSoft,
      borderColor: pal.cyan,
    },
    pickerChipText: {
      color: pal.muted,
      fontSize: 12,
      fontWeight: "700" as const,
    },
    pickerChipTextActive: {
      color: pal.text,
    },

    // Admin override
    adminOverrideRow: {
      backgroundColor: pal.goldSoft,
      borderBottomColor: pal.gold,
    },
    adminOverrideHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      marginBottom: 6,
    },
    adminOverrideLabel: {
      color: pal.gold,
      fontSize: 12,
      fontWeight: "800" as const,
      letterSpacing: 0.5,
    },
    adminOverrideDetails: {
      gap: 2,
    },
    adminOverrideDetail: {
      color: pal.muted,
      fontSize: 11,
      fontWeight: "600" as const,
      lineHeight: 16,
    },
  });
}

// ── Sub-components ─────────────────────────────────────────────────────────

const SectionHeader = memo(function SectionHeader({
  title,
  icon,
  s,
}: {
  title: string;
  icon: React.ReactNode;
  s: ReturnType<typeof createStyles>;
}): JSX.Element {
  return (
    <View style={s.sectionHeader}>
      {icon}
      <Text style={s.sectionHeaderText}>{title}</Text>
    </View>
  );
});

const InfoRow = memo(function InfoRow({ label, value, icon, s }: Extract<SectionRow, { kind: "info" }> & { s: ReturnType<typeof createStyles> }): JSX.Element {
  return (
    <View style={s.row}>
      <View style={s.rowIcon}>{icon}</View>
      <View style={s.rowContent}>
        <Text style={s.rowLabel}>{label}</Text>
        <Text style={s.rowValue}>{value}</Text>
      </View>
    </View>
  );
});

const InputRow = memo(function InputRow({
  label,
  value,
  placeholder,
  icon,
  onChangeText,
  onSave,
  saving,
  s,
  pal,
}: Extract<SectionRow, { kind: "input" }> & { s: ReturnType<typeof createStyles>; pal: P }): JSX.Element {
  return (
    <View style={s.row}>
      <View style={s.rowIcon}>{icon}</View>
      <View style={s.rowContent}>
        <Text style={s.rowLabel}>{label}</Text>
        <View style={s.inputRow}>
          <TextInput
            style={s.textInput}
            value={value}
            placeholder={placeholder}
            placeholderTextColor={pal.muted}
            onChangeText={onChangeText}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            onPress={onSave}
            disabled={saving}
            style={({ pressed }) => [
              s.saveBtn,
              pressed && { opacity: 0.7 },
            ]}
          >
            {saving ? (
              <ActivityIndicator color={pal.text} size="small" />
            ) : (
              <Text style={s.saveBtnText}>Save</Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
});

const ButtonRow = memo(function ButtonRow({
  label,
  variant,
  icon,
  onPress,
  loading,
  s,
  pal,
}: Extract<SectionRow, { kind: "button" }> & { s: ReturnType<typeof createStyles>; pal: P }): JSX.Element {
  const isDanger = variant === "danger";
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [
        s.row,
        isDanger && s.rowDanger,
        pressed && { opacity: 0.75 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isDanger ? pal.ember : pal.cyan} style={s.rowIcon} />
      ) : (
        <View style={s.rowIcon}>{icon}</View>
      )}
      <View style={s.rowContent}>
        <Text style={[s.rowLabel, isDanger && { color: pal.ember }]}>
          {label}
        </Text>
      </View>
      {loading && <ActivityIndicator color={isDanger ? pal.ember : pal.cyan} size="small" />}
    </Pressable>
  );
});

const ToggleRow = memo(function ToggleRow({
  label,
  value,
  icon,
  onToggle,
  s,
}: Extract<SectionRow, { kind: "toggle" }> & { s: ReturnType<typeof createStyles> }): JSX.Element {
  return (
    <Pressable onPress={onToggle} style={({ pressed }) => [s.row, pressed && { opacity: 0.75 }]}>
      <View style={s.rowIcon}>{icon}</View>
      <View style={s.rowContent}>
        <Text style={s.rowLabel}>{label}</Text>
        <Text style={s.rowHint}>{value ? "On" : "Off"}</Text>
      </View>
      <View style={[s.toggleTrack, value && s.toggleTrackActive]}>
        <View style={[s.toggleThumb, value && s.toggleThumbActive]} />
      </View>
    </Pressable>
  );
});

const PickerRow = memo(function PickerRow({
  label,
  value,
  options,
  icon,
  onSelect,
  s,
}: Extract<SectionRow, { kind: "picker" }> & { s: ReturnType<typeof createStyles> }): JSX.Element {
  const selected = useMemo(
    () => options.find((o) => o.id === value) ?? options[0],
    [options, value],
  );

  return (
    <View style={s.row}>
      <View style={s.rowIcon}>{icon}</View>
      <View style={s.rowContent}>
        <Text style={s.rowLabel}>{label}</Text>
        <View style={s.pickerOptions}>
          {options.map((opt) => {
            const isActive = opt.id === value;
            return (
              <Pressable
                key={opt.id}
                onPress={() => onSelect(opt.id)}
                style={({ pressed }) => [
                  s.pickerChip,
                  isActive && s.pickerChipActive,
                  pressed && { opacity: 0.7 },
                ]}
              >
                {opt.icon}
                <Text
                  style={[
                    s.pickerChipText,
                    isActive && s.pickerChipTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
});

const LinkRow = memo(function LinkRow({
  label,
  icon,
  onPress,
  s,
  pal,
}: Extract<SectionRow, { kind: "link" }> & { s: ReturnType<typeof createStyles>; pal: P }): JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
    >
      <View style={s.rowIcon}>{icon}</View>
      <View style={s.rowContent}>
        <Text style={s.rowLabel}>{label}</Text>
      </View>
      <ChevronRight color={pal.muted} size={16} />
    </Pressable>
  );
});

const AdminOverrideRow = memo(function AdminOverrideRow({
  tier,
  expiresAt,
  note,
  s,
  pal,
}: Extract<SectionRow, { kind: "adminOverride" }> & { s: ReturnType<typeof createStyles>; pal: P }): JSX.Element {
  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1).replace("_", " ");
  const expiresLabel = expiresAt
    ? new Date(expiresAt).toLocaleDateString()
    : "No expiration";

  return (
    <View style={[s.row, s.adminOverrideRow]}>
      <View style={s.rowIcon}>
        <Crown color={pal.gold} size={18} />
      </View>
      <View style={s.rowContent}>
        <View style={s.adminOverrideHeader}>
          <Zap color={pal.gold} size={12} />
          <Text style={s.adminOverrideLabel}>Promotional Access Active</Text>
        </View>
        <View style={s.adminOverrideDetails}>
          <Text style={s.adminOverrideDetail}>
            Tier: <Text style={{ color: pal.gold, fontWeight: "900" }}>{tierLabel}</Text>
          </Text>
          <Text style={s.adminOverrideDetail}>Expires: {expiresLabel}</Text>
          {note ? (
            <Text style={s.adminOverrideDetail}>Note: {note}</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
});

// ── Main screen ────────────────────────────────────────────────────────────

export default function SettingsScreen(): JSX.Element {
  const router = useRouter();
  const safeBack = useSafeBack();
  const { user, resetPassword, resetPasswordState } = useAuth();
  const {
    profile,
    effectiveSubscriptionTier,
    isAdminOverrideActive,
    updateProfile,
    setPreferences,
    refetch,
  } = useProfile();
  const pal = palette;
  const h = useHaptics();
  const queryClient = useQueryClient();

  // ── Themed styles ──────────────────────────────────────────────────────
  const s = useMemo(() => createStyles(pal), [pal]);

  // ── Local state ────────────────────────────────────────────────────────
  const [usernameDraft, setUsernameDraft] = useState<string>(
    profile?.username ?? "",
  );
  const [savingUsername, setSavingUsername] = useState<boolean>(false);
  const [uploadingAvatar, setUploadingAvatar] = useState<boolean>(false);
  const [uploadingBanner, setUploadingBanner] = useState<boolean>(false);

  const usernameValue = profile?.username ?? "";
  const displayUsername = usernameDraft || usernameValue;

  const email = user?.email ?? "—";
  const currentTier = effectiveSubscriptionTier;
  const baseTier = profile?.subscription_tier ?? "free";
  const hapticsEnabled = profile?.preferences?.hapticsEnabled !== false;

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleSaveUsername = useCallback(async (): Promise<void> => {
    if (!usernameDraft.trim()) return;
    setSavingUsername(true);
    try {
      await updateProfile({ username: usernameDraft.trim() });
      h.success();
    } catch (err) {
      console.warn("[settings] username save failed", err);
    } finally {
      setSavingUsername(false);
    }
  }, [usernameDraft, updateProfile, h]);

  const handleResetPassword = useCallback((): void => {
    if (!user?.email) return;
    resetPassword(user.email)
      .then(() => {
        Alert.alert(
          "Password Reset Sent",
          "Check your email for a password reset link.",
        );
      })
      .catch((err: unknown) => {
        Alert.alert("Error", "Failed to send reset email. Please try again.");
        console.warn("[settings] resetPassword failed", err);
      });
  }, [user?.email, resetPassword]);

  const [isRestoringPurchases, setIsRestoringPurchases] = useState(false);

  const handleRestorePurchases = useCallback(async (): Promise<void> => {
    h.selection();
    setIsRestoringPurchases(true);
    try {
      const { restorePurchases } = await import("@/services/revenuecat");
      const customerInfo = await restorePurchases();
      const activeCount = customerInfo?.activeSubscriptions?.length ?? 0;
      if (activeCount > 0) {
        Alert.alert("Purchases Restored", "Your subscription has been restored successfully.");
      } else {
        Alert.alert("No Purchases Found", "No previous purchases were found to restore.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Restore failed";
      Alert.alert("Restore Failed", msg);
    } finally {
      setIsRestoringPurchases(false);
    }
  }, [h]);

  const [signingOut, setSigningOut] = useState<boolean>(false);

  const handleLogout = useCallback((): void => {
    // Prevent duplicate sign-out taps
    if (signingOut) return;
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: () => {
          setSigningOut(true);
          h.warning();
          signOutUser()
            .then(() => {
              // Clear all user-specific React Query caches
              queryClient.clear();
              // onAuthStateChange fires SIGNED_OUT → root layout replaces (tabs) with (auth)
              router.replace("/(auth)/login" as never);
            })
            .catch((e: unknown) => {
              setSigningOut(false);
              Alert.alert("Sign Out Failed", "Unable to sign out. Please try again.");
              console.warn("[settings] signOut failed", e);
            });
        },
      },
    ]);
  }, [signingOut, h, router, queryClient]);

  const handleToggleHaptics = useCallback((): void => {
    const next = !hapticsEnabled;
    setPreferences({
      ...(profile?.preferences ?? {}),
      hapticsEnabled: next,
    }).catch((err: unknown) => console.warn("[settings] haptics toggle failed", err));
  }, [hapticsEnabled, profile?.preferences, setPreferences]);



  const handleClearCache = useCallback((): void => {
    Alert.alert(
      "Clear Local Cache",
      "This will clear cached app data stored on your device. Your account and EAGOH data on our servers will not be affected.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear Cache",
          style: "destructive",
          onPress: () => {
            queryClient.clear();
            h.success();
            Alert.alert("Cache Cleared", "Local cache has been cleared successfully.");
          },
        },
      ],
    );
  }, [queryClient, h]);

  const handleExportData = useCallback((): void => {
    Alert.alert("Data Export", "Data export coming soon.");
  }, []);

  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const handleDeleteAccount = useCallback((): void => {
    Alert.alert(
      "Delete Account",
      "Are you sure you want to delete your account? This action cannot be undone. All your EAGOHs, observations, marketplace listings, and faction memberships will be permanently removed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Account",
          style: "destructive",
          onPress: async () => {
            if (!user?.id) return;
            setIsDeletingAccount(true);
            try {
              // Resolve the current access token to authorize the secure worker call.
              const { data: sessionData } = await supabase.auth.getSession();
              const accessToken = sessionData?.session?.access_token;
              if (!accessToken) {
                Alert.alert(
                  "Deletion Failed",
                  "Your account could not be deleted. Please try again or contact support.",
                );
                return;
              }

              const functionsUrl = process.env.EXPO_PUBLIC_RORK_FUNCTIONS_URL;
              if (!functionsUrl) {
                Alert.alert(
                  "Deletion Failed",
                  "Your account could not be deleted. Please try again or contact support.",
                );
                return;
              }

              // Call the secure worker endpoint — never the admin API from the client.
              const res = await fetch(`${functionsUrl}/account/delete`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${accessToken}`,
                },
              });
              const data = (await res.json()) as { ok?: boolean; error?: string };

              if (!res.ok || !data.ok) {
                Alert.alert(
                  "Deletion Failed",
                  data.error ??
                    "Your account could not be deleted. Please try again or contact support.",
                );
                return;
              }

              // Clear all local React Query / cached data before signing out.
              queryClient.clear();

              // Sign out of RevenueCat first (non-blocking), then Supabase.
              try {
                const { logOutRevenueCat } = await import("@/services/revenuecat");
                await logOutRevenueCat();
              } catch {
                // Non-critical — account is already deleted server-side.
              }

              await signOutUser();

              Alert.alert(
                "Account Deleted",
                "Your account has been permanently deleted. We're sorry to see you go.",
              );
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : "Unknown error";
              if (__DEV__) console.warn("[settings] account delete failed:", msg);
              Alert.alert(
                "Deletion Failed",
                "Your account could not be deleted. Please try again or contact support.",
              );
            } finally {
              setIsDeletingAccount(false);
            }
          },
        },
      ],
    );
  }, [user?.id, queryClient]);

  const handleManageSubscription = useCallback((): void => {
    h.selection();
    router.push("/subscription" as never);
  }, [router, h]);

  const navigateTo = useCallback(
    (route: string) => (): void => {
      h.selection();
      router.push(route as never);
    },
    [router, h],
  );

  const uploadProfileMedia = useCallback(async (type: "avatar" | "banner", setUploading: (v: boolean) => void): Promise<void> => {
    if (!user?.id) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission Required", "Photo library access is needed to upload a profile image.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: type === "avatar" ? [1, 1] : [3, 1],
        quality: 0.8,
        base64: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];

      // ── Dev log: asset diagnostics ──────────────────────────────────
      if (__DEV__) {
        console.log("[settings] upload asset", {
          fileName: asset.fileName ?? "(none)",
          mimeType: asset.mimeType ?? "(none)",
          type: asset.type ?? "(none)",
          uri: asset.uri,
        });
      }

      // ── Format validation (mimeType-first, NOT filename) ────────────
      const acceptedMimes = ["image/jpeg", "image/jpg", "image/png", "image/webp"] as const;
      const mimeType = (asset.mimeType ?? "").toLowerCase();

      // HEIC is not natively uploadable — show a clear message if encountered
      const isHeic = mimeType === "image/heic" || mimeType === "image/heif";
      if (isHeic) {
        Alert.alert(
          "Unsupported Format",
          "This image format is not currently supported. Please choose a different photo.",
        );
        return;
      }

      // Determine a safe extension and content-type from mimeType
      let ext: string;
      let contentType: string;
      if (mimeType && acceptedMimes.includes(mimeType as typeof acceptedMimes[number])) {
        // Extract extension from mimeType (e.g. "image/png" → "png")
        ext = mimeType.split("/")[1] === "jpeg" || mimeType.split("/")[1] === "jpg" ? "jpg" : mimeType.split("/")[1];
        contentType = mimeType;
      } else if (asset.type === "image") {
        // mimeType missing on iOS — fall back to uri extension
        const uriExt = (asset.uri.split(".").pop()?.split("?")[0] ?? "").toLowerCase();
        if (["jpg", "jpeg", "png", "webp"].includes(uriExt)) {
          ext = uriExt === "jpeg" ? "jpg" : uriExt;
          contentType = `image/${uriExt === "jpg" ? "jpeg" : uriExt}`;
        } else {
          // asset.type says "image" but no recognizable extension — assume jpeg
          ext = "jpg";
          contentType = "image/jpeg";
        }
      } else {
        Alert.alert(
          "Unsupported Format",
          `Please select a PNG, JPG, or WebP image.`,
        );
        return;
      }

      // ── File size validation ───────────────────────────────────────
      const maxBytes = type === "avatar" ? 3 * 1024 * 1024 : 5 * 1024 * 1024;
      const maxLabel = type === "avatar" ? "3 MB" : "5 MB";
      if (asset.fileSize && asset.fileSize > maxBytes) {
        const fileSizeMB = (asset.fileSize / (1024 * 1024)).toFixed(1);
        Alert.alert(
          "File Too Large",
          `This image is ${fileSizeMB} MB. ${type === "avatar" ? "Profile images" : "Banners"} must be under ${maxLabel}. Please select a smaller image or resize it before uploading.`,
        );
        return;
      }

      setUploading(true);

      // ── Read file bytes via expo-file-system File API ──────────────
      // Uses native file reading that works with file://, ph://, content:// URIs
      let fileBytes: ArrayBuffer;
      try {
        const expoFile = new ExpoFile(asset.uri);
        fileBytes = await expoFile.arrayBuffer();
      } catch (_fsError) {
        // Fallback: use ImagePicker's built-in base64 when File API unavailable
        if (asset.base64) {
          const binaryString = atob(asset.base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          fileBytes = bytes.buffer;
        } else {
          Alert.alert("Upload Failed", "Unable to read selected image on this device.");
          return;
        }
      }

      // ── Dev log: file diagnostics ──────────────────────────────────
      if (__DEV__) {
        console.log("[settings] upload file", {
          byteLength: fileBytes.byteLength,
          maxBytes,
          contentType,
          uri: asset.uri,
          mimeType: asset.mimeType ?? "(none)",
        });
      }

      // ── Double-check byte size ─────────────────────────────────────
      if (fileBytes.byteLength > maxBytes) {
        const sizeMB = (fileBytes.byteLength / (1024 * 1024)).toFixed(1);
        Alert.alert(
          "File Too Large",
          `This image is ${sizeMB} MB after processing. ${type === "avatar" ? "Profile images" : "Banners"} must be under ${maxLabel}. Please select a smaller image.`,
        );
        return;
      }

      // ── Upload path: {userId}/{type}/{type}-{timestamp}.{ext} ──────
      const timestamp = Date.now();
      const storagePath = `${user.id}/${type}/${type}-${timestamp}.${ext}`;

      if (__DEV__) {
        console.log("[settings] upload storage", { storagePath, contentType });
      }

      const { error: uploadError } = await supabase.storage
        .from("user-profile-media")
        .upload(storagePath, fileBytes, { upsert: true, contentType });
      if (uploadError) {
        console.warn("[settings] upload error", uploadError.message);
        Alert.alert("Upload Failed", "Could not upload image. The service may be temporarily unavailable. Please try again.");
        return;
      }

      const { data: urlData } = supabase.storage.from("user-profile-media").getPublicUrl(storagePath);
      const publicUrl = urlData?.publicUrl;

      if (__DEV__) {
        console.log("[settings] upload publicUrl", publicUrl);
      }

      if (publicUrl) {
        const field = type === "avatar" ? { avatar_url: publicUrl } : { banner_url: publicUrl };
        try {
          await updateProfile(field);
          h.success();
        } catch (profileErr) {
          console.warn("[settings] profile update error", profileErr);
          Alert.alert("Upload Succeeded", "Image saved to storage but profile update failed. Your image should appear shortly.");
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[settings] ${type} upload error`, msg);
      Alert.alert("Upload Failed", "Could not upload image. Please check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }, [user?.id, updateProfile, h]);

  const handleAvatarUpload = useCallback((): void => {
    void uploadProfileMedia("avatar", setUploadingAvatar);
  }, [uploadProfileMedia]);

  const handleBannerUpload = useCallback((): void => {
    void uploadProfileMedia("banner", setUploadingBanner);
  }, [uploadProfileMedia]);

  // Phase 6C: unread notification count for the settings badge
  const notificationsCountQuery = useQuery<number>({
    queryKey: ["notifications", "unread-count"],
    queryFn: async () => {
      const result = await fetchNotifications();
      return result.ok ? result.unreadCount : 0;
    },
    staleTime: 30_000,
  });
  const unreadCount = notificationsCountQuery.data ?? 0;

  // ── Sections ────────────────────────────────────────────────────────────

  const sections: SettingsSection[] = useMemo<SettingsSection[]>(() => {
    const secs: SettingsSection[] = [
      {
        id: "account",
        title: "Account",
        titleIcon: <User color={pal.cyan} size={15} />,
        rows: [
          {
            kind: "info",
            label: "Email Address",
            value: email,
            icon: <Mail color={pal.muted} size={18} />,
          },
          {
            kind: "input",
            label: "Username",
            value: displayUsername,
            placeholder: "Enter username",
            icon: <User color={pal.muted} size={18} />,
            onChangeText: setUsernameDraft,
            onSave: handleSaveUsername,
            saving: savingUsername,
          },
          {
            kind: "button",
            label: "Send Password Reset Email",
            variant: "primary",
            icon: <Lock color={pal.cyan} size={18} />,
            onPress: handleResetPassword,
            loading: resetPasswordState.isPending,
          },
          {
            kind: "button",
            label: "Restore Purchases",
            variant: "primary",
            icon: <RefreshCcw color={pal.cyan} size={18} />,
            onPress: handleRestorePurchases,
            loading: isRestoringPurchases,
          },
          {
            kind: "button",
            label: "Sign Out",
            variant: "danger",
            icon: <LogOut color={pal.ember} size={18} />,
            onPress: handleLogout,
            loading: signingOut,
          },
        ],
      },
      {
        id: "notifications",
        title: "Intelligence Notifications",
        titleIcon: <Bell color={pal.gold} size={15} />,
        rows: [
          {
            kind: "custom" as const,
            render: () => (
              <Pressable
                onPress={() => { h.selection(); router.push("/notifications" as never); }}
                style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
              >
                <View style={s.rowIcon}>
                  <Bell color={pal.gold} size={18} />
                </View>
                <View style={s.rowContent}>
                  <Text style={s.rowLabel}>Notification Center</Text>
                  <Text style={s.rowHint}>
                    {unreadCount > 0
                      ? `${unreadCount} unread notification${unreadCount > 1 ? "s" : ""}`
                      : "View intelligence alerts"}
                  </Text>
                </View>
                {unreadCount > 0 ? (
                  <View style={{
                    minWidth: 20, height: 20, borderRadius: 10,
                    backgroundColor: pal.ember,
                    alignItems: "center", justifyContent: "center",
                    paddingHorizontal: 6,
                  }}>
                    <Text style={{ color: pal.void, fontSize: 10, fontWeight: "900" as const }}>
                      {unreadCount}
                    </Text>
                  </View>
                ) : (
                  <ChevronRight color={pal.muted} size={18} />
                )}
              </Pressable>
            ),
          },
        ],
      },
      {
        id: "profileMedia",
        title: "Profile Media",
        titleIcon: <Camera color={pal.cyan} size={15} />,
        rows: [
          {
            kind: "imageUpload" as const,
            label: "Profile Image",
            currentUrl: profile?.avatar_url ?? null,
            icon: <User color={pal.muted} size={18} />,
            onPress: handleAvatarUpload,
            uploading: uploadingAvatar,
            helperText: "Recommended: 800 × 800 px. PNG or JPG. Max 3 MB.",
            infoTitle: "Profile Image Tips",
            infoBody: "Recommended size: 800 × 800 px.\nUse a square image for best results.",
          },
          {
            kind: "imageUpload" as const,
            label: "Profile Banner",
            currentUrl: profile?.banner_url ?? null,
            icon: <ImageIcon color={pal.muted} size={18} />,
            onPress: handleBannerUpload,
            uploading: uploadingBanner,
            helperText: "Recommended: 1500 × 500 px (3:1 ratio). PNG or JPG. Max 5 MB.",
            infoTitle: "Banner Tips",
            infoBody: "Recommended size: 1500 × 500 px.\nImages may be cropped on smaller devices.\nKeep important content centered.",
          },
        ],
      },
      {
        id: "socialVerification",
        title: "Social Verification",
        titleIcon: <BadgeCheck color={pal.cyan} size={15} />,
        rows: [
          {
            kind: "custom" as const,
            render: () => <SocialVerificationPanel pal={pal} />,
          },
        ],
      },

      {
        id: "feedback",
        title: "Touch Feedback",
        titleIcon: <Hand color={pal.ember} size={15} />,
        rows: [
          {
            kind: "toggle",
            label: "Haptics",
            value: hapticsEnabled,
            icon: <Vibrate color={pal.muted} size={18} />,
            onToggle: handleToggleHaptics,
          },
        ],
      },
      {
        id: "subscription",
        title: "Subscription",
        titleIcon: <Crown color={pal.gold} size={15} />,
        rows: [
          {
            kind: "info",
            label: "Effective Tier",
            value: currentTier.replace("_", " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
            icon: <Star color={pal.gold} size={18} />,
          },
          {
            kind: "info",
            label: "Base Tier",
            value: baseTier.replace("_", " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
            icon: <Layers3 color={pal.muted} size={18} />,
          },
          {
            kind: "info",
            label: "Current Neuron Balance",
            value: `${(profile?.edge_subscription ?? 0) + (profile?.edge_purchased ?? 0)} Neurons`,
            icon: <Zap color={pal.cyan} size={18} />,
          },
          ...(isAdminOverrideActive && profile
            ? [
                {
                  kind: "adminOverride" as const,
                  tier: profile.admin_tier_override ?? "",
                  expiresAt: profile.admin_tier_expires_at,
                  note: profile.admin_tier_note,
                },
              ]
            : []),
          {
            kind: "link",
            label: "Manage Subscription",
            icon: <Crown color={pal.gold} size={18} />,
            onPress: () => { h.selection(); router.push("/subscription" as never); },
          },
          {
            kind: "link",
            label: "Neuron Store",
            icon: <Coins color={pal.gold} size={18} />,
            onPress: navigateTo("/edge-store"),
          },

        ],
      },
      {
        id: "privacy",
        title: "Privacy & Safety",
        titleIcon: <Shield color={pal.success} size={15} />,
        rows: [
          {
            kind: "button",
            label: "Clear Local Cache",
            variant: "primary",
            icon: <RefreshCcw color={pal.cyan} size={18} />,
            onPress: handleClearCache,
          },
          {
            kind: "button",
            label: "Export My Data",
            variant: "primary",
            icon: <Upload color={pal.muted} size={18} />,
            onPress: handleExportData,
          },
          {
            kind: "button",
            label: "Delete Account",
            variant: "danger",
            icon: <Trash2 color={pal.ember} size={18} />,
            onPress: handleDeleteAccount,
            loading: isDeletingAccount,
          },
        ],
      },
      {
        id: "legal",
        title: "Legal",
        titleIcon: <FileText color={pal.muted} size={15} />,
        rows: [
          {
            kind: "link",
            label: "Terms of Service",
            icon: <FileText color={pal.muted} size={18} />,
            onPress: navigateTo("/legal/terms"),
          },
          {
            kind: "link",
            label: "Privacy Policy",
            icon: <Shield color={pal.muted} size={18} />,
            onPress: navigateTo("/legal/privacy"),
          },
          {
            kind: "link",
            label: "Disclaimer",
            icon: <AlertTriangle color={pal.muted} size={18} />,
            onPress: navigateTo("/legal/disclaimer"),
          },
        ],
      },
      {
        id: "about",
        title: "About EAGOH",
        titleIcon: <Info color={pal.blue} size={15} />,
        rows: [
          {
            kind: "info",
            label: "App Name",
            value: "EAGOH",
            icon: <Cpu color={pal.cyan} size={18} />,
          },
          {
            kind: "info",
            label: "Full Name",
            value: "Enhanced Analytics & Game Oracle Hub",
            icon: <Info color={pal.muted} size={18} />,
          },
          {
            kind: "info",
            label: "Company",
            value: "NDSTRII Studios LLC",
            icon: <Star color={pal.gold} size={18} />,
          },
          {
            kind: "info",
            label: "App Version",
            value: Constants.expoConfig?.version ?? "1.0.0",
            icon: <Layers3 color={pal.muted} size={18} />,
          },
          {
            kind: "info",
            label: "Build Number",
            value: String(
              Constants.expoConfig?.ios?.buildNumber ??
                Constants.expoConfig?.android?.versionCode ??
                "1",
            ),
            icon: <Cpu color={pal.muted} size={18} />,
          },
          {
            kind: "link",
            label: "Contact Support",
            icon: <MessageCircle color={pal.cyan} size={18} />,
            onPress: () => {
              Alert.alert("Contact Support", "eagohsupport@ndstriistudios.com");
            },
          },
        ],
      },
    ];

    return secs;
  }, [
    email,
    displayUsername,
    handleSaveUsername,
    savingUsername,
    uploadingAvatar,
    uploadingBanner,
    handleAvatarUpload,
    handleBannerUpload,
    handleResetPassword,
    resetPasswordState.isPending,
    handleLogout,
    signingOut,
    hapticsEnabled,
    handleToggleHaptics,
    currentTier,
    baseTier,
    profile,
    isAdminOverrideActive,
    handleManageSubscription,
    handleClearCache,
    handleExportData,
    handleDeleteAccount,
    navigateTo,
    pal,
    unreadCount,
  ]);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <SafeAreaView edges={["top"]} style={s.safe}>
      <View style={s.header}>
        <Pressable
          onPress={() => { safeBack(); }}
          style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.6 }]}
        >
          <ArrowLeft color={pal.text} size={20} />
        </Pressable>
        <Sliders color={pal.cyan} size={20} />
        <Text style={s.headerTitle}>Settings</Text>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {sections.map((section) => (
          <View key={section.id} style={s.section}>
            <SectionHeader title={section.title} icon={section.titleIcon} s={s} />
            <View style={s.sectionBody}>
              {section.rows.map((row, idx) => {
                const key = `${section.id}-${idx}`;
                switch (row.kind) {
                  case "info":
                    return <InfoRow key={key} {...row} s={s} />;
                  case "input":
                    return <InputRow key={key} {...row} s={s} pal={pal} />;
                  case "button":
                    return <ButtonRow key={key} {...row} s={s} pal={pal} />;
                  case "toggle":
                    return <ToggleRow key={key} {...row} s={s} />;
                  case "picker":
                    return <PickerRow key={key} {...row} s={s} />;
                  case "link":
                    return <LinkRow key={key} {...row} s={s} pal={pal} />;
                  case "adminOverride":
                    return <AdminOverrideRow key={key} {...row} s={s} pal={pal} />;
                  case "imageUpload":
                    return <ImageUploadRow key={key} {...row} s={s} pal={pal} />;
                  case "custom":
                    return <View key={key}>{row.render()}</View>;
                  default:
                    return null;
                }
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
