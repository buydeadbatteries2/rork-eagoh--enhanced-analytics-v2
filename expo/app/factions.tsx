import { palette, glow } from "@/constants/colors";
import { useAppTheme } from "@/providers/ThemeProvider";
import { LIST_PERFORMANCE_PROPS } from "@/app/_components/PerformancePrimitives";
import { useAuth } from "@/providers/AuthProvider";
import { useProfile } from "@/providers/ProfileProvider";
import { useEdge } from "@/providers/EdgeProvider";
import {
  canParticipateInFactions,
  createFaction,
  getFactionLimit,
  getFactionFull,
  getMemberStatusColor,
  getMemberStatusLabel,
  getRoleLabel,
  joinFaction,
  leaveFaction,
  listAllFactions,
  listUserFactions,
  listPendingInvites,
  acceptInvite,
  declineInvite,
  inviteByEmailOrUsername,
  getMemberProfiles,
  promoteMember,
  shareIntelToFaction,
  purchaseFactionSlots,
  SLOT_EXPANSION_COSTS,
  computeFactionIntelScore,
  describeActivity,
  FACTION_VALIDATION,
  countUserFactionMemberships,
  type FactionRow,
  type FactionFull,
  type FactionMemberRow,
  type FactionInviteRow,
  type FactionActivityRow,
  type MemberStatus,
  type FactionRole,
} from "@/services/factions";
import { INTELLIGENCE_DOMAINS, getDomainColor } from "@/services/domains";
import { getBulkReputations, rankColor as repRankColor, RANK_TIERS, type RankTier } from "@/services/reputation";
import type { ReputationRow } from "@/services/reputation";
import { supabase } from "@/lib/supabase";
import TeamSelector from "@/app/_components/TeamSelector";
import {
  IntelligenceEntryCard,
  FeedbackModal,
  DisputeModal,
  type FeedbackAccessInfo,
} from "@/app/_components/IntelligenceTrust";
import {
  fetchBulkPublicReputations,
  applyEntryFilters,
  DEFAULT_FILTERS,
  SORT_LABELS,
  VALIDATION_STATUS_FILTER_OPTIONS,
  type OpenIntelligenceRow,
  type PublicReputation,
  type MyIntelligenceFilters,
  type SortOption,
} from "@/services/openIntelligence";
import { LinearGradient } from "expo-linear-gradient";
import { useHaptics } from "@/hooks/useHaptics";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Award,
  ChevronRight,
  ChevronDown,
  Plus,
  Shield,
  Users,
  Zap,
  X,
  Check,
  Clock,
  UserPlus,
  AlertTriangle,
  Brain,
  Crown,
  Target,
  Swords,
  LogOut,
  Star,
  ArrowUp,
  Search,
  SlidersHorizontal,
} from "lucide-react-native";
import { Image } from "expo-image";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// ── Helpers ────────────────────────────────────────────────────────────

function toneColor(tone: string): string {
  if (tone === "gold") return palette.gold;
  if (tone === "violet") return palette.violet;
  if (tone === "ember") return palette.ember;
  if (tone === "success") return palette.success;
  return palette.cyan;
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }): JSX.Element {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

// ── Section item for FlatList ──────────────────────────────────────────

type SectionItem =
  | { id: string; kind: "hero" }
  | { id: string; kind: "gate" }
  | { id: string; kind: "invites" }
  | { id: string; kind: "my-factions" }
  | { id: string; kind: "discover"; factions: FactionRow[] }
  | { id: string; kind: "rankings" }
  | { id: string; kind: "empty" };

// ── Create Faction Modal ───────────────────────────────────────────────

const ALL_DOMAINS = INTELLIGENCE_DOMAINS.map((d) => d.id);

function CreateFactionModal({
  visible,
  onClose,
  onCreate,
  isCreating,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (fields: {
    name: string;
    description: string;
    motto: string;
    fanaticTeamFocus: string;
    domain: string;
  }) => void;
  isCreating: boolean;
}): JSX.Element {
  const h = useHaptics();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [motto, setMotto] = useState("");
  const [fanaticTeamFocus, setFanaticTeamFocus] = useState("");
  const [domain, setDomain] = useState("sports");

  const reset = useCallback(() => {
    setName("");
    setDescription("");
    setMotto("");
    setFanaticTeamFocus("");
    setDomain("sports");
  }, []);

  const handleCreate = useCallback(() => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    onCreate({
      name: trimmedName,
      description: description.trim(),
      motto: motto.trim(),
      fanaticTeamFocus,
      domain,
    });
    reset();
  }, [name, description, motto, fanaticTeamFocus, domain, onCreate, reset]);

  const isValid =
    name.trim().length > 0 &&
    name.trim().length <= FACTION_VALIDATION.nameMax &&
    description.length <= FACTION_VALIDATION.descriptionMax &&
    motto.length <= FACTION_VALIDATION.mottoMax;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <LinearGradient colors={[palette.void, palette.obsidian, palette.graphite]} style={styles.modalRoot}>
        <SafeAreaView edges={["top"]} style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <Pressable onPress={onClose} hitSlop={12}><X color={palette.muted} size={22} /></Pressable>
            <Text style={styles.modalTitle}>Create Faction</Text>
            <View style={{ width: 22 }} />
          </View>

          <KeyboardAvoidingView
            style={styles.modalKav}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={0}
          >
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
            {/* Name */}
            <Text style={styles.fieldLabel}>FACTION NAME</Text>
            <TextInput
              style={styles.fieldInput}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Neon Guard"
              placeholderTextColor={palette.muted}
              autoFocus
              maxLength={FACTION_VALIDATION.nameMax}
            />
            <Text style={styles.fieldHint}>{name.length}/{FACTION_VALIDATION.nameMax}</Text>

            {/* Description */}
            <Text style={styles.fieldLabel}>DESCRIPTION</Text>
            <TextInput
              style={[styles.fieldInput, styles.fieldTextArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="What does your Faction do? What intelligence does it gather?"
              placeholderTextColor={palette.muted}
              multiline
              numberOfLines={3}
              maxLength={FACTION_VALIDATION.descriptionMax}
            />
            <Text style={styles.fieldHint}>{description.length}/{FACTION_VALIDATION.descriptionMax}</Text>

            {/* Motto */}
            <Text style={styles.fieldLabel}>FACTION MOTTO</Text>
            <TextInput
              style={styles.fieldInput}
              value={motto}
              onChangeText={setMotto}
              placeholder="e.g. Knowledge is power."
              placeholderTextColor={palette.muted}
              maxLength={FACTION_VALIDATION.mottoMax}
            />
            <Text style={styles.fieldHint}>{motto.length}/{FACTION_VALIDATION.mottoMax}</Text>

            {/* Intelligence Domain */}
            <Text style={styles.fieldLabel}>PRIMARY INTELLIGENCE DOMAIN</Text>
            <View style={styles.domainRow}>
              {ALL_DOMAINS.map((d) => (
                <Pressable
                  key={d}
                  style={[styles.domainChip, domain === d && styles.domainChipActive]}
                  onPress={() => {
                    setDomain(d);
                    h.selection();
                  }}
                >
                  <Text style={[styles.domainChipText, domain === d && styles.domainChipTextActive]}>
                    {d.charAt(0).toUpperCase() + d.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Fanatic Team Focus */}
            <Text style={styles.fieldLabel}>FANATIC TEAM FOCUS (OPTIONAL)</Text>
            <TeamSelector
              selectedIds={fanaticTeamFocus ? [fanaticTeamFocus] : []}
              onToggle={(id: string): void => {
                setFanaticTeamFocus(prev => prev === id ? "" : id);
              }}
              mode="single"
              placeholder="Search NFL, NBA, MLB, NHL, WNBA, NCAAF, NCAAB…"
              maxSuggestions={8}
            />

            {/* Emblem placeholder note */}
            <View style={styles.emblemNote}>
              <Shield color={palette.muted} size={16} />
              <Text style={styles.emblemNoteText}>
                An emblem will be auto-generated from your Faction name. Custom emblems coming soon.
              </Text>
            </View>

            {/* Create button */}
            <Pressable
              style={[styles.createBtn, !isValid && styles.createBtnDisabled]}
              onPress={handleCreate}
              disabled={!isValid || isCreating}
            >
              {isCreating ? (
                <ActivityIndicator color={palette.text} />
              ) : (
                <>
                  <Shield color={palette.text} size={18} />
                  <Text style={styles.createBtnText}>CREATE FACTION</Text>
                </>
              )}
            </Pressable>
          </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </LinearGradient>
    </Modal>
  );
}

// ── Faction Card ──────────────────────────────────────────────────────

function FactionCard({
  faction,
  membership,
  expanded,
  onExpand,
}: {
  faction: FactionRow;
  membership: FactionMemberRow | null;
  expanded: boolean;
  onExpand: () => void;
}): JSX.Element {
  const accent = membership?.status === "dormant" ? palette.muted : palette.cyan;
  const role = membership ? getRoleLabel(membership.role) : null;
  const status = membership ? membership.status : null;

  return (
    <Pressable
      onPress={onExpand}
      style={({ pressed }) => [styles.factionCard, pressed && styles.pressed]}
    >
      <View style={[styles.cardGlow, { backgroundColor: accent }]} />

      <View style={styles.factionTop}>
        <View style={[styles.emblem, { borderColor: accent, backgroundColor: `${accent}18` }]}>
          <Text style={[styles.emblemText, { color: accent }]}>
            {(faction.emblem ?? faction.name.slice(0, 2)).toUpperCase()}
          </Text>
        </View>
        <View style={styles.factionTitleWrap}>
          <Text style={styles.factionName} numberOfLines={1}>{faction.name}</Text>
          {faction.motto ? (
            <Text style={styles.factionMotto} numberOfLines={1}>{faction.motto}</Text>
          ) : null}
          {role && (
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>{role}</Text>
            </View>
          )}
        </View>
        {expanded ? (
          <ChevronDown color={accent} size={20} />
        ) : (
          <ChevronRight color={accent} size={20} />
        )}
      </View>

      <View style={styles.metricRow}>
        <Metric label="Members" value={`${faction.current_members}/${faction.max_members}`} />
        <Metric label="Influence" value={`${faction.influence_score}`} />
        <View style={styles.domainMetric}>
          <Text style={styles.domainMetricLabel}>Domain</Text>
          <View style={[styles.domainBadgeSmall, { backgroundColor: `${getDomainColor(faction.intelligence_domain)}18`, borderColor: `${getDomainColor(faction.intelligence_domain)}33` }]}>
            <View style={[styles.domainDotSmall, { backgroundColor: getDomainColor(faction.intelligence_domain) }]} />
            <Text style={[styles.domainBadgeSmallText, { color: getDomainColor(faction.intelligence_domain) }]}>
              {INTELLIGENCE_DOMAINS.find((d) => d.id === faction.intelligence_domain)?.label ?? faction.intelligence_domain}
            </Text>
          </View>
        </View>
      </View>

      {status && (
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: palette[getMemberStatusColor(status)] }]} />
          <Text style={[styles.statusText, { color: palette[getMemberStatusColor(status)] }]}>
            {getMemberStatusLabel(status)}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

// ── Faction Detail (expanded view) ────────────────────────────────────

function FactionDetail({
  faction,
  full,
  onClose,
}: {
  faction: FactionRow;
  full: FactionFull | null | undefined;
  onClose: () => void;
}): JSX.Element {
  const { user } = useAuth();
  const { profile } = useProfile();
  const edge = useEdge();
  const queryClient = useQueryClient();
  const h = useHaptics();
  const userId = user?.id;

  const members = full?.members ?? [];
  const myMember = members.find((m) => m.user_id === userId) ?? null;
  const isCommander = myMember?.role === "commander";
  const canManage = isCommander || myMember?.role === "strategist";

  const activePaid = members.filter((m) => m.status === "active").length;
  const dormantMembers = members.filter((m) => m.status === "dormant").length;
  const graceMembers = members.filter((m) => m.status === "grace_period").length;
  const { score } = computeFactionIntelScore(
    activePaid,
    full?.sharedEntries.length ?? 0,
    0,
    full?.recentActivity.length ?? 0,
  );

  // ── Sub-states ──────────────────────────────────────────────────────

  const [inviteQuery, setInviteQuery] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [promoteTarget, setPromoteTarget] = useState<string | null>(null);
  const [promoteRole, setPromoteRole] = useState<FactionRole>("strategist");
  const [memberRepMap, setMemberRepMap] = useState<Map<string, ReputationRow>>(new Map());
  const [userToEagohMap, setUserToEagohMap] = useState<Map<string, string>>(new Map());
  const [memberProfileMap, setMemberProfileMap] = useState<Map<string, { username: string | null; avatar_url: string | null }>>(new Map());

  // ── Phase 6A: Shared intelligence trust UI state ───────────────────
  const [sharedOIEntries, setSharedOIEntries] = useState<OpenIntelligenceRow[]>([]);
  const [contributorRepMap, setContributorRepMap] = useState<Map<string, PublicReputation>>(new Map());
  const [feedbackModalEntryId, setFeedbackModalEntryId] = useState<string | null>(null);
  const [disputeModalEntryId, setDisputeModalEntryId] = useState<string | null>(null);

  // Phase 7A: Faction intelligence search & filter
  const [factionSearch, setFactionSearch] = useState("");
  const [factionFilterOpen, setFactionFilterOpen] = useState(false);
  const [factionSort, setFactionSort] = useState<SortOption>("newest");
  const [factionValidationFilter, setFactionValidationFilter] = useState("all");
  const [factionCategoryFilter, setFactionCategoryFilter] = useState("all");
  const [factionContributorFilter, setFactionContributorFilter] = useState("all");

  // Phase 6A: Fetch shared OI entries and contributor reputations when sharedEntries are available
  useEffect(() => {
    if (!full?.sharedEntries || full.sharedEntries.length === 0) {
      setSharedOIEntries([]);
      return;
    }
    const entryIds = full.sharedEntries.map((s) => s.oi_entry_id);
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("open_intelligence")
          .select("*")
          .in("id", entryIds)
          .in("validation_status", [
            "pending_review",
            "validated",
            "community_supported",
            "externally_supported",
            "disputed",
          ])
          .order("created_at", { ascending: false })
          .limit(30);
        if (cancelled) return;
        if (error) {
          console.warn("[factions] shared OI fetch failed", error.message);
          return;
        }
        const entries = (data ?? []) as OpenIntelligenceRow[];
        setSharedOIEntries(entries);
        // Fetch public reputations for contributors
        const contributorIds = [...new Set(entries.map((e) => e.user_id))];
        if (contributorIds.length > 0) {
          fetchBulkPublicReputations(contributorIds)
            .then(setContributorRepMap)
            .catch(() => undefined);
        }
      } catch {
        // best-effort — ignore fetch errors
      }
    })();
    return () => { cancelled = true; };
  }, [full?.sharedEntries]);

  // Phase 7A: Filtered & sorted faction shared intelligence
  const factionContributors = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of sharedOIEntries) {
      if (!map.has(e.user_id)) {
        const rep = contributorRepMap.get(e.user_id);
        map.set(e.user_id, rep ? `Reputation ${rep.overall_score}` : "Unknown");
      }
    }
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [sharedOIEntries, contributorRepMap]);

  const factionCategoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of sharedOIEntries) {
      const cat = e.selected_category ?? e.tag;
      if (cat) set.add(cat);
    }
    return Array.from(set).sort();
  }, [sharedOIEntries]);

  const filteredSharedOI = useMemo(() => {
    const factionFilters: MyIntelligenceFilters = {
      search: factionSearch,
      category: factionCategoryFilter,
      validationStatus: factionValidationFilter,
      confidence: "all",
      sharing: "all",
      sort: factionSort,
    };
    let result = applyEntryFilters(sharedOIEntries, factionFilters);
    if (factionContributorFilter !== "all") {
      result = result.filter((e) => e.user_id === factionContributorFilter);
    }
    return result;
  }, [sharedOIEntries, factionSearch, factionCategoryFilter, factionValidationFilter, factionSort, factionContributorFilter]);

  // Phase 6A: Build access info for feedback/dispute
  const myMemberStatus = myMember?.status ?? null;
  const hasFactionAccess = myMemberStatus === "active" || myMemberStatus === "grace_period";
  const buildFeedbackAccess = useCallback(
    (entry: OpenIntelligenceRow): FeedbackAccessInfo => ({
      accessSource: "faction",
      factionId: faction.id,
      isOwnEntry: entry.user_id === userId,
    }),
    [faction.id, userId],
  );

  const handleRateEntry = useCallback((entryId: string): void => {
    h.light();
    setFeedbackModalEntryId(entryId);
  }, [h]);

  const handleDisputeEntry = useCallback((entryId: string): void => {
    h.light();
    setDisputeModalEntryId(entryId);
  }, [h]);

  const handleFeedbackSubmitted = useCallback((): void => {
    queryClient.invalidateQueries({ queryKey: ["faction", faction.id] });
  }, [queryClient, faction.id]);

  // Load reputations for member EAGOHs + member profile info
  useEffect(() => {
    if (!full?.members || full.members.length === 0) return;
    const memberUserIds = full.members.map((m) => m.user_id);
    // Fetch member profiles (username, avatar_url)
    getMemberProfiles(memberUserIds).then(setMemberProfileMap).catch(() => undefined);
    Promise.all(
      full.members.map((m) =>
        supabase.from("eagohs").select("id").eq("user_id", m.user_id).maybeSingle()
      )
    ).then((results) => {
      const eagohIds: string[] = [];
      const userToEid = new Map<string, string>();
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.data) {
          const eid = (r.data as { id: string }).id;
          eagohIds.push(eid);
          userToEid.set(full.members[i].user_id, eid);
        }
      }
      setUserToEagohMap(userToEid);
      if (eagohIds.length > 0) {
        getBulkReputations(eagohIds).then(setMemberRepMap).catch(() => undefined);
      }
    }).catch(() => undefined);
  }, [full?.members]);

  const eagohIdForMember = (userId: string): string => userToEagohMap.get(userId) ?? "";

  // ── Handlers ────────────────────────────────────────────────────────

  const handleInvite = useCallback(async () => {
    if (!inviteQuery.trim() || !userId) return;
    setInviteSending(true);
    try {
      const result = await inviteByEmailOrUsername(faction.id, userId, inviteQuery.trim(), "analyst");
      if (result.ok) {
        Alert.alert("Invite Sent", "Faction invite sent.");
        setInviteQuery("");
        queryClient.invalidateQueries({ queryKey: ["faction", faction.id] });
      } else {
        Alert.alert("Error", result.error ?? "Failed to send invite.");
      }
    } catch {
      Alert.alert("Error", "Failed to send invite.");
    } finally {
      setInviteSending(false);
    }
  }, [inviteQuery, userId, faction.id, queryClient]);

  const handleSlotPurchase = useCallback(
    async (slots: number) => {
      if (!userId || !profile) return;
      const cost = SLOT_EXPANSION_COSTS.find((s) => s.slots === slots);
      if (!cost) return;

      if (!edge.canAfford(cost.cost)) {
        Alert.alert("Insufficient Neurons", `Need ${cost.cost} Neurons for +${slots} slots.`);
        return;
      }

      try {
        const result = await purchaseFactionSlots(faction.id, userId, profile, slots);
        if (result.ok) {
          Alert.alert("Slots Expanded", `Added +${slots} slots. New max: ${result.faction.max_members}`);
          queryClient.invalidateQueries({ queryKey: ["faction", faction.id] });
          queryClient.invalidateQueries({ queryKey: ["factions"] });
        } else {
          Alert.alert("Error", result.error);
        }
      } catch {
        Alert.alert("Error", "Slot expansion failed.");
      }
    },
    [userId, profile, faction.id, edge, queryClient],
  );

  const handlePromote = useCallback(
    async (targetUserId: string, newRole: FactionRole) => {
      if (!userId) return;
      try {
        const result = await promoteMember(faction.id, userId, targetUserId, newRole);
        if (result.ok) {
          Alert.alert("Promoted", `Member promoted to ${getRoleLabel(newRole)}.`);
          setPromoteTarget(null);
          queryClient.invalidateQueries({ queryKey: ["faction", faction.id] });
        } else {
          Alert.alert("Error", result.error);
        }
      } catch {
        Alert.alert("Error", "Promotion failed.");
      }
    },
    [userId, faction.id, queryClient],
  );

  const handleLeave = useCallback(async () => {
    if (!userId) return;
    Alert.alert("Leave Faction", "Are you sure you want to leave this Faction? Your intelligence remains attached to your EAGOH but will be removed from the shared pool.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: async () => {
          try {
            const result = await leaveFaction(faction.id, userId);
            if (result.ok) {
              queryClient.invalidateQueries({ queryKey: ["factions"] });
              queryClient.invalidateQueries({ queryKey: ["faction", faction.id] });
              onClose();
            } else {
              Alert.alert("Error", result.error ?? "Failed to leave faction.");
            }
          } catch {
            Alert.alert("Error", "Failed to leave faction.");
          }
        },
      },
    ]);
  }, [userId, faction.id, queryClient, onClose]);

  return (
    <View style={styles.detailWrap}>
      {/* ── Overview ─────────────────────────────────────────────────── */}
      <SectionHeader eyebrow="OVERVIEW" title={faction.name} />

      <View style={styles.overviewCard}>
        {faction.description ? (
          <Text style={styles.overviewText}>{faction.description}</Text>
        ) : null}
        {faction.motto ? (
          <View style={styles.mottoRow}>
            <Target color={palette.gold} size={14} />
            <Text style={styles.mottoText}>"{faction.motto}"</Text>
          </View>
        ) : null}
        <View style={styles.overviewMeta}>
          <View style={styles.overviewTag}>
            <Brain color={palette.cyan} size={12} />
            <Text style={styles.overviewTagText}>{faction.intelligence_domain}</Text>
          </View>
          {faction.fanatic_team_focus ? (
            <View style={styles.overviewTag}>
              <Swords color={palette.gold} size={12} />
              <Text style={styles.overviewTagText}>{faction.fanatic_team_focus}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* ── Top Ranked EAGOHs ────────────────────────────────────────── */}
      {memberRepMap.size > 0 && (
        <View style={styles.reputationSection}>
          <SectionHeader eyebrow="REPUTATION" title="Top Ranked Analysts" />
          <View style={styles.topRankedGrid}>
            {members
              .filter((m) => m.status === "active")
              .sort((a, b) => {
                const repA = memberRepMap.get(eagohIdForMember(a.user_id))?.reputation_score ?? 0;
                const repB = memberRepMap.get(eagohIdForMember(b.user_id))?.reputation_score ?? 0;
                return repB - repA;
              })
              .slice(0, 5)
              .map((m, i) => {
                const rep = memberRepMap.get(eagohIdForMember(m.user_id));
                if (!rep) return null;
                const rk = rep.rank as RankTier;
                const rc = repRankColor(rk);
                return (
                  <View key={m.id} style={[styles.topRankedRow, { borderColor: `${rc}22` }]}>
                    <Text style={[styles.topRankedNum, { color: i < 3 ? palette.gold : palette.muted }]}>#{i + 1}</Text>
                    <Crown color={rc} size={14} />
                    <Text style={styles.topRankedRole}>{getRoleLabel(m.role)}</Text>
                    <Text style={[styles.topRankedRank, { color: rc }]}>{rk}</Text>
                    <Text style={[styles.topRankedScore, { color: rc }]}>{rep.reputation_score}</Text>
                  </View>
                );
              })
              .filter(Boolean)}
          </View>
          {/* Faction average reputation */}
          {(() => {
            const activeReps = members
              .filter((m) => m.status === "active")
              .map((m) => memberRepMap.get(eagohIdForMember(m.user_id)))
              .filter(Boolean) as ReputationRow[];
            if (activeReps.length === 0) return null;
            const avgRep = Math.round(activeReps.reduce((s, r) => s + r.reputation_score, 0) / activeReps.length);
            return (
              <View style={styles.factionAvgRep}>
                <Star color={palette.gold} size={14} />
                <Text style={styles.factionAvgRepLabel}>Faction Avg Reputation:</Text>
                <Text style={styles.factionAvgRepValue}>{avgRep}</Text>
              </View>
            );
          })()}
        </View>
      )}

      {/* ── Members Roster ───────────────────────────────────────────── */}
      <SectionHeader eyebrow="ROSTER" title={`Members (${faction.current_members}/${faction.max_members})`} />
      <View style={styles.rosterStats}>
        <Text style={styles.rosterStat}><Text style={{ color: palette.cyan, fontWeight: "900" as const }}>{activePaid}</Text> Active</Text>
        {graceMembers > 0 ? <Text style={styles.rosterStat}><Text style={{ color: palette.gold, fontWeight: "900" as const }}>{graceMembers}</Text> Grace</Text> : null}
        {dormantMembers > 0 ? <Text style={styles.rosterStat}><Text style={{ color: palette.ember, fontWeight: "900" as const }}>{dormantMembers}</Text> Dormant</Text> : null}
      </View>

      {members.map((m) => {
        const memberProfile = memberProfileMap.get(m.user_id);
        const avatarUrl = memberProfile?.avatar_url ?? null;
        const memberUsername = memberProfile?.username ?? null;
        const initials = (memberUsername ?? getRoleLabel(m.role)).slice(0, 1).toUpperCase();
        return (
        <View key={m.id} style={styles.memberRow}>
          <View style={styles.memberAvatar}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.memberAvatarImg} contentFit="cover" />
            ) : (
              <View style={styles.memberAvatarFallback}>
                <Text style={styles.memberAvatarInitials}>{initials}</Text>
              </View>
            )}
          </View>
          <View style={[styles.memberDot, { backgroundColor: palette[getMemberStatusColor(m.status)] }]} />
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{memberUsername ?? getRoleLabel(m.role)}</Text>
            <Text style={styles.rowSub}>{getRoleLabel(m.role)} · {getMemberStatusLabel(m.status)}</Text>
          </View>
          {canManage && m.user_id !== userId && m.role !== "commander" && (
            <Pressable
              style={styles.promoteBtn}
              onPress={() => {
                setPromoteTarget(m.user_id);
                setPromoteRole(m.role === "recruit" ? "analyst" : m.role === "analyst" ? "strategist" : "strategist");
              }}
              hitSlop={8}
            >
              <ArrowUp color={palette.cyan} size={14} />
            </Pressable>
          )}
          {m.user_id === userId && !isCommander && (
            <Pressable style={styles.leaveBtnSmall} onPress={handleLeave} hitSlop={8}>
              <LogOut color={palette.ember} size={14} />
            </Pressable>
          )}
        </View>
        );
      })}

      {/* ── Intelligence Dashboard ────────────────────────────────────── */}
      <SectionHeader eyebrow="SCORE" title="Faction Intelligence" />
      <View style={styles.scoreCard}>
        <Text style={styles.scoreValue}>{score}</Text>
        <Text style={styles.scoreLabel}>Intelligence Score</Text>
        <View style={styles.scoreBreakdown}>
          <ScoreDetail label="Active Members" value={String(activePaid)} color={palette.cyan} />
          <ScoreDetail label="Shared Intel" value={String(full?.sharedEntries.length ?? 0)} color={palette.violet} />
          <ScoreDetail label="Recent Activity" value={String(full?.recentActivity.length ?? 0)} color={palette.gold} />
        </View>
      </View>

      {/* ── Commander Controls ────────────────────────────────────────── */}
      {isCommander && (
        <View style={styles.commanderSection}>
          <SectionHeader eyebrow="COMMAND" title="Management" />

          {/* Invite */}
          <Text style={styles.fieldLabel}>INVITE BY EMAIL OR USERNAME</Text>
          <View style={styles.inviteInputRow}>
            <TextInput
              style={[styles.fieldInput, { flex: 1 }]}
              value={inviteQuery}
              onChangeText={setInviteQuery}
              placeholder="friend@email.com or username"
              placeholderTextColor={palette.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
            <Pressable style={styles.inviteBtn} onPress={handleInvite} disabled={inviteSending}>
              {inviteSending ? (
                <ActivityIndicator color={palette.void} size={14} />
              ) : (
                <>
                  <UserPlus color={palette.text} size={16} />
                  <Text style={styles.inviteBtnText}>Send Invite</Text>
                </>
              )}
            </Pressable>
          </View>

          {/* Slot expansion */}
          <Text style={styles.fieldLabel}>EXPAND MEMBER SLOTS</Text>
          <View style={styles.slotRow}>
            {SLOT_EXPANSION_COSTS.map(({ slots, cost }) => (
              <Pressable
                key={slots}
                style={styles.slotBtn}
                onPress={() => handleSlotPurchase(slots)}
              >
                <Text style={styles.slotBtnLabel}>+{slots}</Text>
                <Text style={styles.slotBtnCost}>{cost}E</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* ── Top Contributors ────────────────────────────────────────── */}
      {full && full.sharedEntries && full.sharedEntries.length > 0 && (() => {
        const contribMap = new Map<string, number>();
        for (const entry of full.sharedEntries) {
          const uid = (entry as any).user_id ?? (entry as any).shared_by;
          if (uid) contribMap.set(uid, (contribMap.get(uid) ?? 0) + 1);
        }
        const topContribs = [...contribMap.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);
        if (topContribs.length === 0) return null;
        return (
          <View style={styles.topContribSection}>
            <SectionHeader eyebrow="CONTRIBUTORS" title="Top Intelligence Contributors" />
            {topContribs.map(([uid, count], i) => {
              const member = members.find((m) => m.user_id === uid);
              const rep = memberRepMap.get(eagohIdForMember(uid));
              return (
                <View key={uid} style={styles.contributorRow}>
                  <Text style={[styles.contributorRank, i < 3 && { color: palette.gold }]}>#{i + 1}</Text>
                  <View style={styles.rowText}>
                    <Text style={styles.contributorName}>{member ? getRoleLabel(member.role) : "Unknown"}</Text>
                    <Text style={styles.contributorCount}>{count} shared intelligence entries</Text>
                  </View>
                  {rep && (
                    <Text style={[styles.contributorRep, { color: repRankColor(rep.rank as RankTier) }]}>{rep.reputation_score}</Text>
                  )}
                </View>
              );
            })}
          </View>
        );
      })()}

      {/* ── Activity Feed ─────────────────────────────────────────────── */}
      <SectionHeader eyebrow="LOG" title="Recent Activity" />
      {(!full?.recentActivity || full.recentActivity.length === 0) ? (
        <Text style={styles.emptyText}>No activity recorded yet.</Text>
      ) : (
        full.recentActivity.slice(0, 15).map((act) => (
          <View key={act.id} style={styles.activityRow}>
            <Clock color={palette.muted} size={12} style={{ marginTop: 2 }} />
            <View style={styles.rowText}>
              <Text style={styles.activityDesc}>{describeActivity(act)}</Text>
              <Text style={styles.activityDate}>{new Date(act.created_at).toLocaleDateString()}</Text>
            </View>
          </View>
        ))
      )}

      {/* ── Promotion modal ──────────────────────────────────────────── */}
      {promoteTarget && (
        <View style={styles.promoteModal}>
          <Text style={styles.promoteTitle}>Promote Member</Text>
          <View style={styles.promoteOptions}>
            {(["strategist", "analyst", "recruit"] as FactionRole[]).map((role) => (
              <Pressable
                key={role}
                style={[styles.promoteOption, promoteRole === role && styles.promoteOptionActive]}
                onPress={() => setPromoteRole(role)}
              >
                <Text style={[styles.promoteOptionText, promoteRole === role && styles.promoteOptionTextActive]}>
                  {getRoleLabel(role)}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.promoteActions}>
            <Pressable style={styles.promoteCancel} onPress={() => setPromoteTarget(null)}>
              <Text style={styles.promoteCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={styles.promoteConfirm}
              onPress={() => handlePromote(promoteTarget, promoteRole)}
            >
              <Check color={palette.void} size={14} />
              <Text style={styles.promoteConfirmText}>Confirm</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* ── Phase 6A/7A: Shared Intelligence with Search & Filters ──── */}
      {sharedOIEntries.length > 0 && (
        <View style={styles.sharedIntelSection}>
          <SectionHeader eyebrow="SHARED INTELLIGENCE" title="Faction Knowledge Pool" />

          {/* Phase 7A: Search & filter bar */}
          <View style={styles.factionSearchRow}>
            <View style={styles.factionSearchWrap}>
              <Search color={palette.muted} size={14} />
              <TextInput
                value={factionSearch}
                onChangeText={setFactionSearch}
                placeholder="Search shared intelligence..."
                placeholderTextColor={palette.muted}
                style={styles.factionSearchInput}
                returnKeyType="search"
              />
              {factionSearch.length > 0 ? (
                <Pressable onPress={() => setFactionSearch("")} style={styles.factionSearchClear}>
                  <X color={palette.muted} size={13} />
                </Pressable>
              ) : null}
            </View>
            <Pressable
              onPress={() => { h.selection(); setFactionFilterOpen(!factionFilterOpen); }}
              style={({ pressed }) => [
                styles.factionFilterToggle,
                (factionSort !== "newest" || factionValidationFilter !== "all" || factionCategoryFilter !== "all" || factionContributorFilter !== "all") && { borderColor: palette.cyan },
                pressed && { opacity: 0.85 },
              ]}
            >
              <SlidersHorizontal color={palette.muted} size={14} />
            </Pressable>
          </View>

          {/* Phase 7A: Filter panel */}
          {factionFilterOpen ? (
            <View style={styles.factionFilterPanel}>
              <Text style={styles.factionFilterLabel}>Sort</Text>
              <View style={styles.factionFilterChips}>
                {(["newest", "highest_quality"] as SortOption[]).map((opt) => (
                  <Pressable
                    key={opt}
                    onPress={() => { h.selection(); setFactionSort(opt); }}
                    style={({ pressed }) => [
                      styles.factionFilterChip,
                      factionSort === opt && { borderColor: palette.cyan, backgroundColor: `${palette.cyan}12` },
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Text style={[styles.factionFilterChipText, factionSort === opt && { color: palette.cyan }]}>
                      {SORT_LABELS[opt]}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[styles.factionFilterLabel, { marginTop: 8 }]}>Validation</Text>
              <View style={styles.factionFilterChips}>
                {VALIDATION_STATUS_FILTER_OPTIONS.filter((o) => o.id !== "withdrawn" && o.id !== "rejected").map((opt) => (
                  <Pressable
                    key={opt.id}
                    onPress={() => { h.selection(); setFactionValidationFilter(opt.id); }}
                    style={({ pressed }) => [
                      styles.factionFilterChip,
                      factionValidationFilter === opt.id && { borderColor: palette.cyan, backgroundColor: `${palette.cyan}12` },
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Text style={[styles.factionFilterChipText, factionValidationFilter === opt.id && { color: palette.cyan }]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {factionCategoryOptions.length > 0 ? (
                <>
                  <Text style={[styles.factionFilterLabel, { marginTop: 8 }]}>Category</Text>
                  <View style={styles.factionFilterChips}>
                    <Pressable
                      onPress={() => { h.selection(); setFactionCategoryFilter("all"); }}
                      style={({ pressed }) => [
                        styles.factionFilterChip,
                        factionCategoryFilter === "all" && { borderColor: palette.cyan, backgroundColor: `${palette.cyan}12` },
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text style={[styles.factionFilterChipText, factionCategoryFilter === "all" && { color: palette.cyan }]}>All</Text>
                    </Pressable>
                    {factionCategoryOptions.map((cat) => (
                      <Pressable
                        key={cat}
                        onPress={() => { h.selection(); setFactionCategoryFilter(cat); }}
                        style={({ pressed }) => [
                          styles.factionFilterChip,
                          factionCategoryFilter === cat && { borderColor: palette.cyan, backgroundColor: `${palette.cyan}12` },
                          pressed && { opacity: 0.85 },
                        ]}
                      >
                        <Text style={[styles.factionFilterChipText, factionCategoryFilter === cat && { color: palette.cyan }]} numberOfLines={1}>
                          {cat.replace(/_/g, " ")}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}

              {factionContributors.length > 1 ? (
                <>
                  <Text style={[styles.factionFilterLabel, { marginTop: 8 }]}>Contributor</Text>
                  <View style={styles.factionFilterChips}>
                    <Pressable
                      onPress={() => { h.selection(); setFactionContributorFilter("all"); }}
                      style={({ pressed }) => [
                        styles.factionFilterChip,
                        factionContributorFilter === "all" && { borderColor: palette.cyan, backgroundColor: `${palette.cyan}12` },
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text style={[styles.factionFilterChipText, factionContributorFilter === "all" && { color: palette.cyan }]}>All</Text>
                    </Pressable>
                    {factionContributors.slice(0, 10).map((c) => (
                      <Pressable
                        key={c.id}
                        onPress={() => { h.selection(); setFactionContributorFilter(c.id); }}
                        style={({ pressed }) => [
                          styles.factionFilterChip,
                          factionContributorFilter === c.id && { borderColor: palette.cyan, backgroundColor: `${palette.cyan}12` },
                          pressed && { opacity: 0.85 },
                        ]}
                      >
                        <Text style={[styles.factionFilterChipText, factionContributorFilter === c.id && { color: palette.cyan }]} numberOfLines={1}>
                          {c.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}
            </View>
          ) : null}

          {filteredSharedOI.length === 0 ? (
            <View style={styles.factionEmptyState}>
              <Search color={palette.muted} size={28} />
              <Text style={styles.factionEmptyTitle}>No Shared Faction Intelligence Found</Text>
              <Text style={styles.factionEmptyDesc}>Try adjusting your search or filters.</Text>
            </View>
          ) : (
            filteredSharedOI.map((entry) => (
              <IntelligenceEntryCard
                key={entry.id}
                entry={entry}
                contributorReputation={contributorRepMap.get(entry.user_id)}
                access={buildFeedbackAccess(entry)}
                onRate={handleRateEntry}
                onDispute={handleDisputeEntry}
              />
            ))
          )}
        </View>
      )}

      {/* ── Phase 6A: Feedback & Dispute Modals ──────────────────────── */}
      <FeedbackModal
        visible={feedbackModalEntryId !== null}
        entryId={feedbackModalEntryId}
        access={
          feedbackModalEntryId
            ? buildFeedbackAccess(
                sharedOIEntries.find((e) => e.id === feedbackModalEntryId) ??
                { user_id: "", id: "" } as OpenIntelligenceRow,
              )
            : null
        }
        onClose={() => setFeedbackModalEntryId(null)}
        onSubmitted={handleFeedbackSubmitted}
      />
      <DisputeModal
        visible={disputeModalEntryId !== null}
        entryId={disputeModalEntryId}
        access={
          disputeModalEntryId
            ? buildFeedbackAccess(
                sharedOIEntries.find((e) => e.id === disputeModalEntryId) ??
                { user_id: "", id: "" } as OpenIntelligenceRow,
              )
            : null
        }
        onClose={() => setDisputeModalEntryId(null)}
        onSubmitted={handleFeedbackSubmitted}
      />
    </View>
  );
}

function ScoreDetail({ label, value, color }: { label: string; value: string; color: string }): JSX.Element {
  return (
    <View style={styles.scoreDetailWrap}>
      <Text style={[styles.scoreDetailValue, { color }]}>{value}</Text>
      <Text style={styles.scoreDetailLabel}>{label}</Text>
    </View>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────

export default function FactionsScreen(): JSX.Element {
  const { palette: pal } = useAppTheme();
  const h = useHaptics();
  const { user } = useAuth();
  const { profile } = useProfile();
  const userId = user?.id;
  const { effectiveSubscriptionTier: tier } = useProfile();
  const limits = getFactionLimit(tier);
  const canParticipate = canParticipateInFactions(tier);
  const queryClient = useQueryClient();

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [expandedFactionId, setExpandedFactionId] = useState<string | null>(null);

  // Queries
  const userFactionsQuery = useQuery<FactionRow[]>({
    queryKey: ["factions", "user", userId],
    enabled: !!userId,
    queryFn: () => (userId ? listUserFactions(userId) : Promise.resolve([])),
  });

  const allFactionsQuery = useQuery<FactionRow[]>({
    queryKey: ["factions", "all"],
    enabled: true,
    queryFn: () => listAllFactions(),
  });

  const invitesQuery = useQuery<FactionInviteRow[]>({
    queryKey: ["factions", "invites", userId],
    enabled: !!userId,
    queryFn: () => (userId ? listPendingInvites(userId) : Promise.resolve([])),
  });

  const expandedQuery = useQuery<FactionFull | null>({
    queryKey: ["faction", expandedFactionId],
    enabled: !!expandedFactionId,
    queryFn: () => (expandedFactionId ? getFactionFull(expandedFactionId) : Promise.resolve(null)),
  });

  // Create faction mutation
  const createMutation = useMutation({
    mutationFn: async (input: {
      name: string;
      description: string;
      motto: string;
      fanaticTeamFocus: string;
      domain: string;
    }) => {
      if (!userId || !profile) throw new Error("Not signed in");
      return createFaction({
        userId,
        profile,
        name: input.name,
        description: input.description || undefined,
        motto: input.motto || undefined,
        fanaticTeamFocus: input.fanaticTeamFocus || undefined,
        intelligence_domain: input.domain,
        effectiveTier: tier,
      });
    },
    onSuccess: (result) => {
      if (result.ok) {
        setCreateModalVisible(false);
        queryClient.invalidateQueries({ queryKey: ["factions", "user", userId] });
        queryClient.invalidateQueries({ queryKey: ["factions", "all"] });
        h.success();
      } else {
        Alert.alert("Error", result.error);
      }
    },
  });

  // Accept invite
  const acceptMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      if (!userId || !profile) throw new Error("Not signed in");
      return acceptInvite(inviteId, userId, profile, tier);
    },
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: ["factions", "invites", userId] });
        queryClient.invalidateQueries({ queryKey: ["factions", "user", userId] });
        h.success();
      } else {
        Alert.alert("Error", result.error);
      }
    },
  });

  const declineMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      if (!userId) return;
      return declineInvite(inviteId, userId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["factions", "invites", userId] });
    },
  });

  // Build sections
  const sections: SectionItem[] = useMemo(() => {
    const items: SectionItem[] = [];

    items.push({ id: "hero", kind: "hero" });

    if (!canParticipate) {
      items.push({ id: "gate", kind: "gate" });
      items.push({ id: "rankings", kind: "rankings" });
      return items;
    }

    // Invites
    const invites = invitesQuery.data ?? [];
    if (invites.length > 0) {
      items.push({ id: "invites", kind: "invites" });
    }

    // User's factions
    const userFactions = userFactionsQuery.data ?? [];
    if (userFactions.length > 0) {
      items.push({ id: "my-factions", kind: "my-factions" });
    }

    // Discoverable factions
    const all = allFactionsQuery.data ?? [];
    const userFactionIds = new Set(userFactions.map((f) => f.id));
    const discoverable = all.filter((f) => !userFactionIds.has(f.id));
    if (discoverable.length > 0) {
      items.push({ id: "discover", kind: "discover", factions: discoverable });
    }

    if (items.length <= 1) {
      items.push({ id: "empty", kind: "empty" });
    }

    items.push({ id: "rankings", kind: "rankings" });
    return items;
  }, [canParticipate, invitesQuery.data, userFactionsQuery.data, allFactionsQuery.data]);

  const handleCreateFaction = useCallback(
    (fields: { name: string; description: string; motto: string; fanaticTeamFocus: string; domain: string }) => {
      createMutation.mutate(fields);
    },
    [createMutation],
  );

  const handleJoin = useCallback(
    async (factionId: string) => {
      if (!userId || !profile) return;
      try {
        const result = await joinFaction(userId, profile, factionId, tier);
        if (result.ok) {
          queryClient.invalidateQueries({ queryKey: ["factions", "user", userId] });
          queryClient.invalidateQueries({ queryKey: ["factions", "all"] });
          queryClient.invalidateQueries({ queryKey: ["faction", factionId] });
          h.success();
        } else {
          Alert.alert("Error", result.error);
        }
      } catch {
        Alert.alert("Error", "Failed to join faction.");
      }
    },
    [userId, profile, queryClient],
  );

  const renderSection = useCallback(
    ({ item }: { item: SectionItem }): JSX.Element => {
      // ── Hero ────────────────────────────────────────────────────────
      if (item.kind === "hero") {
        return (
          <View style={styles.hero}>
            <LinearGradient
              colors={["rgba(54,245,255,0.22)", "rgba(124,92,255,0.13)", "rgba(255,184,77,0.08)"]}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.heroGrid} />
            <Text style={styles.kicker}>FACTION NETWORK</Text>
            <Text style={styles.title}>Private intelligence alliances for the sharpest analysts.</Text>
            <Text style={styles.subtitle}>
              {canParticipate
                ? "Create or join Factions to pool observations, share intelligence, and amplify your EAGOH's influence."
                : "Factions are reserved for Pro, Oracle Elite, and Syndicate subscribers."}
            </Text>
            {canParticipate && (
              <>
                <Pressable
                  style={styles.createFactionBtn}
                  onPress={() => {
                    h.light();
                    setCreateModalVisible(true);
                  }}
                >
                  <Plus color={palette.text} size={18} />
                  <Text style={styles.createFactionBtnText}>NEW FACTION</Text>
                </Pressable>
                <View style={styles.limitsRow}>
                  <Text style={styles.limitsText}>
                    {tier} tier: {limits.maxFactions} Faction{limits.maxFactions !== 1 ? "s" : ""}, {limits.includedSlots} included slots, max {limits.maxMembers} members
                  </Text>
                </View>
              </>
            )}
          </View>
        );
      }

      // ── Tier Gate ───────────────────────────────────────────────────
      if (item.kind === "gate") {
        return (
          <View style={styles.gateCard}>
            <AlertTriangle color={palette.gold} size={28} />
            <Text style={styles.gateTitle}>Faction Access Restricted</Text>
            <Text style={styles.gateSubtitle}>
              Faction creation and membership require a paid subscription. Upgrade to Pro, Oracle Elite, or Syndicate to join intelligence alliances.
            </Text>
            <View style={styles.gateTiers}>
              <View style={styles.gateTier}>
                <Text style={styles.gateTierName}>Pro</Text>
                <Text style={styles.gateTierLimit}>1 Faction · 3 Included · Max 10</Text>
              </View>
              <View style={styles.gateTier}>
                <Text style={styles.gateTierName}>Oracle Elite</Text>
                <Text style={styles.gateTierLimit}>2 Factions · 5 Included · Max 25</Text>
              </View>
              <View style={styles.gateTier}>
                <Text style={styles.gateTierName}>Syndicate</Text>
                <Text style={styles.gateTierLimit}>3 Factions · 10 Included · Max 100</Text>
              </View>
            </View>
          </View>
        );
      }

      // ── Invites ─────────────────────────────────────────────────────
      if (item.kind === "invites") {
        return (
          <View>
            <SectionHeader eyebrow="INVITES" title="Pending Alliance Invitations" />
            {(invitesQuery.data ?? []).map((invite) => (
              <View key={invite.id} style={styles.inviteCard}>
                <Shield color={palette.violet} size={22} />
                <View style={styles.rowText}>
                  <Text style={styles.inviteTitle}>Faction Invitation</Text>
                  <Text style={styles.inviteRole}>{getRoleLabel(invite.role)}</Text>
                </View>
                <View style={styles.inviteActions}>
                  <Pressable
                    style={[styles.inviteActionBtn, { backgroundColor: palette.success }]}
                    onPress={() => acceptMutation.mutate(invite.id)}
                  >
                    <Check color={palette.void} size={14} />
                  </Pressable>
                  <Pressable
                    style={[styles.inviteActionBtn, { backgroundColor: palette.ember }]}
                    onPress={() => declineMutation.mutate(invite.id)}
                  >
                    <X color={palette.void} size={14} />
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        );
      }

      // ── My Factions ─────────────────────────────────────────────────
      if (item.kind === "my-factions") {
        const userFactions = userFactionsQuery.data ?? [];
        return (
          <View>
            <SectionHeader eyebrow="MY ALLIANCES" title="Your Factions" />
            {userFactions.map((faction) => {
              const isExpanded = expandedFactionId === faction.id;
              return (
                <View key={faction.id}>
                  <FactionCard
                    faction={faction}
                    membership={null}
                    expanded={isExpanded}
                    onExpand={() => {
                      const next = isExpanded ? null : faction.id;
                      setExpandedFactionId(next);
                      h.selection();
                    }}
                  />
                  {isExpanded && (
                    <FactionDetail
                      faction={faction}
                      full={expandedQuery.data && expandedFactionId === faction.id ? expandedQuery.data : null}
                      onClose={() => setExpandedFactionId(null)}
                    />
                  )}
                </View>
              );
            })}
          </View>
        );
      }

      // ── Discover ────────────────────────────────────────────────────
      if (item.kind === "discover") {
        return (
          <View>
            <SectionHeader eyebrow="DISCOVER" title="All Factions" />
            {item.factions.map((faction) => (
              <View key={faction.id} style={styles.discoverCard}>
                <View style={styles.discoverInfo}>
                  <View style={[styles.discoverEmblem, { borderColor: palette.cyan, backgroundColor: "rgba(108,230,255,0.10)" }]}>
                    <Text style={styles.discoverEmblemText}>
                      {(faction.emblem ?? faction.name.slice(0, 2)).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.discoverName}>{faction.name}</Text>
                    {faction.motto ? (
                      <Text style={styles.discoverMotto} numberOfLines={1}>"{faction.motto}"</Text>
                    ) : null}
                    <View style={styles.discoverMeta}>
                      <Text style={styles.discoverMetaText}>{faction.intelligence_domain}</Text>
                      <Text style={styles.discoverMetaText}>·</Text>
                      <Text style={styles.discoverMetaText}>{faction.current_members}/{faction.max_members} members</Text>
                      <Text style={styles.discoverMetaText}>·</Text>
                      <Text style={[styles.discoverMetaText, { color: palette.cyan }]}>{faction.influence_score} score</Text>
                    </View>
                  </View>
                </View>
                <Pressable
                  style={styles.joinBtn}
                  onPress={() => handleJoin(faction.id)}
                >
                  <UserPlus color={palette.cyan} size={14} />
                  <Text style={styles.joinBtnText}>Join</Text>
                </Pressable>
              </View>
            ))}
          </View>
        );
      }

      // ── Rankings ────────────────────────────────────────────────────
      if (item.kind === "rankings") {
        const all = allFactionsQuery.data ?? [];
        const sorted = [...all].sort((a, b) => b.influence_score - a.influence_score).slice(0, 10);
        return (
          <View>
            <SectionHeader eyebrow="RANKINGS" title="Faction Influence Ladder" />
            {sorted.map((faction, index) => (
              <View key={faction.id} style={styles.rankingRow}>
                <Text style={[styles.rankNumber, index < 3 && { color: palette.gold }]}>
                  #{index + 1}
                </Text>
                <Star color={index < 3 ? palette.gold : palette.muted} size={12} />
                <Text style={styles.rankName}>{faction.name}</Text>
                <View style={styles.rankBar}>
                  <View
                    style={[
                      styles.rankFill,
                      { width: `${Math.min(100, faction.influence_score)}%`, backgroundColor: palette.cyan },
                    ]}
                  />
                </View>
                <Text style={styles.rankScore}>{faction.influence_score}</Text>
              </View>
            ))}
            {sorted.length === 0 && (
              <Text style={styles.emptyText}>No factions yet. Create one to begin.</Text>
            )}
          </View>
        );
      }

      // ── Empty state ─────────────────────────────────────────────────
      return (
        <View style={styles.emptySection}>
          <Zap color={palette.cyan} size={36} />
          <Text style={styles.emptyTitle}>No Factions Found</Text>
          <Text style={styles.emptySubtitle}>
            Create a new Faction or join an existing alliance to begin pooling intelligence.
          </Text>
          {canParticipate && (
            <Pressable
              style={styles.createFactionBtn}
              onPress={() => {
                h.light();
                setCreateModalVisible(true);
              }}
            >
              <Plus color={palette.text} size={18} />
              <Text style={styles.createFactionBtnText}>CREATE FACTION</Text>
            </Pressable>
          )}
        </View>
      );
    },
    [
      canParticipate,
      tier,
      limits,
      invitesQuery.data,
      userFactionsQuery.data,
      allFactionsQuery.data,
      expandedFactionId,
      expandedQuery.data,
      acceptMutation,
      declineMutation,
      handleJoin,
      userId,
    ],
  );

  const isLoading =
    userFactionsQuery.isLoading || allFactionsQuery.isLoading || invitesQuery.isLoading;

  return (
    <LinearGradient colors={[pal.void, pal.obsidian, pal.graphite]} style={styles.root}>
      <SafeAreaView edges={["top"]} style={styles.safe}>
        {isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={palette.cyan} size="large" />
          </View>
        ) : (
          <FlatList
            data={sections}
            keyExtractor={(item) => item.id}
            renderItem={renderSection}
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            {...LIST_PERFORMANCE_PROPS}
          />
        )}
      </SafeAreaView>

      <CreateFactionModal
        visible={createModalVisible}
        onClose={() => setCreateModalVisible(false)}
        onCreate={handleCreateFaction}
        isCreating={createMutation.isPending}
      />
    </LinearGradient>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { padding: 18, paddingBottom: 120, gap: 18 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },

  // Hero
  hero: {
    borderRadius: 5,
    overflow: "hidden",
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(54,245,255,0.28)",
    backgroundColor: palette.panel,
    gap: 4,
  },
  heroGrid: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    transform: [{ rotate: "-8deg" }, { scale: 1.18 }],
  },
  kicker: { color: palette.cyan, fontSize: 12, fontWeight: "900" as const, letterSpacing: 2.4, textTransform: "uppercase" as const },
  title: { color: palette.text, fontSize: 24, fontWeight: "900" as const, letterSpacing: -0.8, lineHeight: 28, marginTop: 6 },
  subtitle: { color: palette.muted, fontSize: 13, fontWeight: "700" as const, lineHeight: 19, marginTop: 8 },
  createFactionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: palette.cyan,
    borderRadius: 5,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignSelf: "flex-start",
    marginTop: 12,
  },
  createFactionBtnText: { color: palette.void, fontSize: 13, fontWeight: "900" as const, letterSpacing: 1.2 },
  limitsRow: { marginTop: 8 },
  limitsText: { color: palette.muted, fontSize: 11, fontWeight: "800" as const },

  // Gate
  gateCard: {
    borderRadius: 5,
    padding: 20,
    borderWidth: 1,
    borderColor: palette.gold,
    backgroundColor: "rgba(255,181,71,0.06)",
    alignItems: "center",
    gap: 10,
  },
  gateTitle: { color: palette.gold, fontSize: 18, fontWeight: "900" as const },
  gateSubtitle: { color: palette.muted, fontSize: 13, fontWeight: "700" as const, textAlign: "center", lineHeight: 19 },
  gateTiers: { width: "100%", gap: 8, marginTop: 6 },
  gateTier: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  gateTierName: { color: palette.text, fontSize: 14, fontWeight: "900" as const },
  gateTierLimit: { color: palette.muted, fontSize: 12, fontWeight: "700" as const },

  // Section headers
  sectionHeader: { marginTop: 2, marginBottom: 10 },
  eyebrow: { color: palette.gold, fontSize: 11, fontWeight: "900" as const, letterSpacing: 2, textTransform: "uppercase" as const },
  sectionTitle: { color: palette.text, fontSize: 18, fontWeight: "900" as const, marginTop: 4 },

  // Faction card
  factionCard: {
    marginBottom: 12,
    borderRadius: 5,
    padding: 16,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(8,15,26,0.92)",
    overflow: "hidden",
  },
  cardGlow: { position: "absolute", right: -28, top: -32, width: 96, height: 96, borderRadius: 5, opacity: 0.18 },
  factionTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  emblem: {
    width: 52,
    height: 52,
    borderRadius: 5,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emblemText: { fontSize: 17, fontWeight: "900" as const, letterSpacing: 1 },
  factionTitleWrap: { flex: 1, gap: 3 },
  factionName: { color: palette.text, fontSize: 17, fontWeight: "900" as const },
  factionMotto: { color: palette.muted, fontSize: 11, fontWeight: "700" as const, fontStyle: "italic" as const },
  // Domain display
  domainMetric: { paddingVertical: 8 },
  domainMetricLabel: { color: palette.muted, fontSize: 10, fontWeight: "900" as const, marginBottom: 4 },
  domainBadgeSmall: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5, borderWidth: 1, alignSelf: "flex-start" as const },
  domainDotSmall: { width: 6, height: 6, borderRadius: 3 },
  domainBadgeSmallText: { fontSize: 11, fontWeight: "900" as const },
  roleBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: "rgba(108,230,255,0.12)",
  },
  roleBadgeText: { color: palette.cyan, fontSize: 10, fontWeight: "900" as const, letterSpacing: 1 },
  metricRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  metric: {
    flex: 1,
    borderRadius: 5,
    padding: 8,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  metricValue: { color: palette.text, fontSize: 14, fontWeight: "900" as const },
  metricLabel: { color: palette.muted, fontSize: 10, fontWeight: "800" as const, marginTop: 2, textTransform: "uppercase" as const },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: "900" as const, letterSpacing: 1 },

  // Detail wrap
  detailWrap: {
    marginTop: -8,
    marginBottom: 16,
    padding: 14,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(8,12,22,0.86)",
    gap: 4,
  },

  // Overview
  overviewCard: {
    borderRadius: 5,
    padding: 12,
    marginBottom: 6,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    gap: 8,
  },
  overviewText: { color: palette.muted, fontSize: 13, fontWeight: "700" as const, lineHeight: 19 },
  mottoRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  mottoText: { color: palette.gold, fontSize: 13, fontWeight: "700" as const, fontStyle: "italic" as const },
  overviewMeta: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  overviewTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  overviewTagText: { color: palette.muted, fontSize: 11, fontWeight: "700" as const },

  // Roster stats
  rosterStats: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  rosterStat: { color: palette.muted, fontSize: 12, fontWeight: "700" as const },

  // Member row
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
  },
  memberAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.line,
  },
  memberAvatarImg: { width: "100%", height: "100%" },
  memberAvatarFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(108,230,255,0.10)",
  },
  memberAvatarInitials: { color: palette.cyan, fontSize: 13, fontWeight: "900" },
  memberDot: { width: 8, height: 8, borderRadius: 4 },
  promoteBtn: {
    width: 28,
    height: 28,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(108,230,255,0.10)",
  },
  leaveBtnSmall: {
    width: 28,
    height: 28,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,77,109,0.10)",
  },

  // Commander section
  commanderSection: { marginTop: 4, gap: 8 },

  // Slot expansion
  slotRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  slotBtn: {
    flex: 1,
    borderRadius: 5,
    padding: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(108,230,255,0.06)",
  },
  slotBtnLabel: { color: palette.text, fontSize: 15, fontWeight: "900" as const },
  slotBtnCost: { color: palette.cyan, fontSize: 11, fontWeight: "900" as const, marginTop: 2 },

  // Invite
  inviteInputRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  inviteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: palette.cyan,
    borderRadius: 5,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inviteBtnText: { color: palette.void, fontSize: 11, fontWeight: "900" as const },

  // Score card
  scoreCard: {
    borderRadius: 5,
    padding: 16,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(108,230,255,0.05)",
    alignItems: "center",
    marginBottom: 10,
  },
  scoreValue: { color: palette.cyan, fontSize: 40, fontWeight: "900" as const },
  scoreLabel: { color: palette.muted, fontSize: 12, fontWeight: "800" as const, marginTop: 2, textTransform: "uppercase" as const },
  scoreBreakdown: { flexDirection: "row", gap: 16, marginTop: 10 },
  scoreDetailWrap: { alignItems: "center" },
  scoreDetailValue: { fontSize: 18, fontWeight: "900" as const },
  scoreDetailLabel: { color: palette.muted, fontSize: 10, fontWeight: "700" as const, marginTop: 2, textTransform: "uppercase" as const },

  // Activity row
  activityRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
  },
  activityDesc: { color: palette.text, fontSize: 13, fontWeight: "700" as const, lineHeight: 18 },
  activityDate: { color: palette.muted, fontSize: 10, fontWeight: "700" as const, marginTop: 2 },
  rowText: { flex: 1 },
  rowTitle: { color: palette.text, fontSize: 13, fontWeight: "900" as const },
  rowSub: { color: palette.muted, fontSize: 11, fontWeight: "700" as const, marginTop: 2 },
  emptyText: { color: palette.muted, fontSize: 13, fontWeight: "700" as const, paddingVertical: 8 },

  // Discover cards
  discoverCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    marginBottom: 8,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(8,14,24,0.72)",
  },
  discoverInfo: { flex: 1, flexDirection: "row", gap: 10, alignItems: "center" },
  discoverEmblem: {
    width: 40,
    height: 40,
    borderRadius: 5,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  discoverEmblemText: { fontSize: 14, fontWeight: "900" as const, color: palette.cyan },
  discoverName: { color: palette.text, fontSize: 14, fontWeight: "900" as const },
  discoverMotto: { color: palette.muted, fontSize: 11, fontWeight: "700" as const, fontStyle: "italic" as const },
  discoverMeta: { flexDirection: "row", gap: 4, marginTop: 2 },
  discoverMetaText: { color: palette.muted, fontSize: 11, fontWeight: "700" as const },
  joinBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.cyan,
  },
  joinBtnText: { color: palette.cyan, fontSize: 11, fontWeight: "900" as const },

  // Invite card (in list)
  inviteCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 5,
    padding: 14,
    marginBottom: 9,
    backgroundColor: "rgba(14,24,37,0.72)",
    borderWidth: 1,
    borderColor: palette.line,
  },
  inviteTitle: { color: palette.text, fontSize: 14, fontWeight: "900" as const },
  inviteRole: { color: palette.muted, fontSize: 11, fontWeight: "700" as const, marginTop: 2 },
  inviteActions: { flexDirection: "row", gap: 6 },
  inviteActionBtn: {
    width: 28,
    height: 28,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
  },

  // Rankings
  rankingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10 },
  rankNumber: { color: palette.muted, width: 28, fontSize: 13, fontWeight: "900" as const },
  rankName: { color: palette.text, flex: 1, fontSize: 13, fontWeight: "900" as const },
  rankBar: { width: 78, height: 8, borderRadius: 5, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.08)" },
  rankFill: { height: "100%" as const, borderRadius: 5 },
  rankScore: { color: palette.muted, width: 28, textAlign: "right" as const, fontSize: 12, fontWeight: "900" as const },

  // Empty state
  emptySection: { alignItems: "center", paddingVertical: 40, gap: 10 },
  emptyTitle: { color: palette.text, fontSize: 16, fontWeight: "900" as const },
  emptySubtitle: { color: palette.muted, fontSize: 13, fontWeight: "700" as const, textAlign: "center", lineHeight: 19 },

  // Promotion modal (inline)
  promoteModal: {
    marginTop: 8,
    padding: 12,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.cyan,
    backgroundColor: "rgba(8,20,36,0.94)",
    gap: 10,
  },
  promoteTitle: { color: palette.text, fontSize: 14, fontWeight: "900" as const },
  promoteOptions: { flexDirection: "row", gap: 6 },
  promoteOption: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 5,
    alignItems: "center",
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  promoteOptionActive: { borderColor: palette.cyan, backgroundColor: "rgba(108,230,255,0.14)" },
  promoteOptionText: { color: palette.muted, fontSize: 12, fontWeight: "700" as const },
  promoteOptionTextActive: { color: palette.cyan, fontWeight: "900" as const },
  promoteActions: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  promoteCancel: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 5 },
  promoteCancelText: { color: palette.muted, fontSize: 12, fontWeight: "700" as const },
  promoteConfirm: {
    flexDirection: "row",
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 5,
    backgroundColor: palette.cyan,
    alignItems: "center",
  },
  promoteConfirmText: { color: palette.void, fontSize: 12, fontWeight: "900" as const },

  // Modal (Create Faction)
  modalRoot: { flex: 1 },
  modalSafe: { flex: 1 },
  modalKav: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
  },
  modalTitle: { color: palette.text, fontSize: 17, fontWeight: "900" as const },
  modalBody: { padding: 18, gap: 14 },
  fieldLabel: { color: palette.cyan, fontSize: 10, fontWeight: "900" as const, letterSpacing: 2, marginTop: 4, textTransform: "uppercase" as const },
  fieldHint: { color: palette.muted, fontSize: 10, fontWeight: "700" as const, textAlign: "right" as const, marginTop: -8 },
  fieldInput: {
    color: palette.text,
    fontSize: 15,
    fontWeight: "700" as const,
    padding: 12,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  fieldTextArea: { minHeight: 80, textAlignVertical: "top" as const },
  domainRow: { flexDirection: "row", flexWrap: "wrap" as const, gap: 8 },
  domainChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  domainChipActive: { borderColor: palette.cyan, backgroundColor: "rgba(108,230,255,0.12)" },
  domainChipText: { color: palette.muted, fontSize: 12, fontWeight: "700" as const },
  domainChipTextActive: { color: palette.cyan },
  emblemNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  emblemNoteText: { color: palette.muted, fontSize: 12, fontWeight: "700" as const, flex: 1 },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: palette.cyan,
    borderRadius: 5,
    paddingVertical: 14,
    marginTop: 8,
  },
  createBtnDisabled: { opacity: 0.4 },
  createBtnText: { color: palette.void, fontSize: 14, fontWeight: "900" as const, letterSpacing: 1.4 },

  pressed: { transform: [{ scale: 0.985 }], opacity: 0.86 },

  // Reputation section
  reputationSection: { marginTop: 4 },
  topRankedGrid: { gap: 6 },
  topRankedRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 5, borderWidth: 1, backgroundColor: "rgba(10,18,30,0.48)" },
  topRankedNum: { fontSize: 11, fontWeight: "900" as const, minWidth: 22 },
  topRankedRole: { color: palette.text, fontSize: 12, fontWeight: "800" as const, flex: 1 },
  topRankedRank: { fontSize: 11, fontWeight: "900" as const },
  topRankedScore: { fontSize: 11, fontWeight: "900" as const },
  factionAvgRep: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 5, backgroundColor: palette.goldSoft, borderWidth: 1, borderColor: "rgba(255,184,77,0.18)", marginTop: 8 },
  factionAvgRepLabel: { color: palette.muted, fontSize: 12, fontWeight: "800" as const, flex: 1 },
  factionAvgRepValue: { color: palette.gold, fontSize: 16, fontWeight: "900" as const },
  topContribSection: { marginTop: 8 },
  sharedIntelSection: { marginTop: 8, gap: 8 },
  contributorRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 5, backgroundColor: "rgba(16,27,42,0.54)", borderWidth: 1, borderColor: palette.line, marginTop: 6 },
  contributorRank: { color: palette.muted, fontSize: 13, fontWeight: "900" as const, minWidth: 24 },
  contributorName: { color: palette.text, fontSize: 13, fontWeight: "800" as const },
  contributorCount: { color: palette.muted, fontSize: 11, marginTop: 1 },
  contributorRep: { fontSize: 14, fontWeight: "900" as const },

  // Phase 7A: Faction intelligence search & filter
  factionSearchRow: { flexDirection: "row" as const, gap: 8, alignItems: "center" as const },
  factionSearchWrap: {
    flex: 1, flexDirection: "row" as const, alignItems: "center" as const, gap: 8,
    paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: palette.line,
    backgroundColor: "rgba(10,18,30,0.50)", minHeight: 40,
  },
  factionSearchInput: {
    flex: 1, color: palette.text, fontSize: 12, fontWeight: "700" as const,
    paddingVertical: 8,
  },
  factionSearchClear: { width: 22, height: 22, alignItems: "center" as const, justifyContent: "center" as const },
  factionFilterToggle: {
    width: 40, height: 40, borderRadius: 6, borderWidth: 1,
    borderColor: palette.line, backgroundColor: "rgba(10,18,30,0.50)",
    alignItems: "center" as const, justifyContent: "center" as const,
  },
  factionFilterPanel: {
    borderRadius: 6, borderWidth: 1, borderColor: palette.line,
    backgroundColor: "rgba(10,20,38,0.40)", padding: 10, gap: 4,
  },
  factionFilterLabel: {
    color: palette.cyan, fontSize: 9, fontWeight: "900" as const,
    letterSpacing: 1.5, textTransform: "uppercase" as const,
  },
  factionFilterChips: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 5, marginTop: 4 },
  factionFilterChip: {
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 4, borderWidth: 1,
    borderColor: palette.line, backgroundColor: "rgba(255,255,255,0.03)",
  },
  factionFilterChipText: { fontSize: 10, fontWeight: "800" as const, color: palette.muted },
  factionEmptyState: { alignItems: "center" as const, paddingVertical: 30, gap: 6 },
  factionEmptyTitle: { color: palette.text, fontSize: 14, fontWeight: "900" as const },
  factionEmptyDesc: { color: palette.muted, fontSize: 11, fontWeight: "700" as const, textAlign: "center" as const },
});
