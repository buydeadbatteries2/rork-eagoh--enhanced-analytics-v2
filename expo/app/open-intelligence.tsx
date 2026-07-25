/**
 * Open Intelligence — user-submitted observation entries for each EAGOH.
 *
 * Features:
 *   - Select EAGOH (domain-locked)
 *   - Entry type picker (Quick / Basic / Advanced) with character limits
 *   - Domain-aware hierarchical taxonomy with category → subtag accordion
 *   - Multi-select subtags with chip display
 *   - Tag search within domain
 *   - Recently Used tags section
 *   - Custom tags (multiple, max 30 chars each)
 *   - Character counter (excluding spaces)
 *   - Confidence level picker
 *   - Local quality score preview before submit
 *   - Real Edge deduction via wallet (subscription first, purchased second)
 *   - Supabase persistence
 *   - Learning Feed showing recent entries for the selected EAGOH
 */

import { palette } from "@/constants/colors";
import { useAppTheme } from "@/providers/ThemeProvider";
import { useEagohs } from "@/providers/EagohProvider";
import { useEdge } from "@/providers/EdgeProvider";
import { useProfile } from "@/providers/ProfileProvider";
import { INTELLIGENCE_DOMAINS, getDomain, normalizeDomainId } from "@/services/domains";
import type { EagohRecord } from "@/services/eagohs";
import {
  CONFIDENCE_LEVELS,
  ENTRY_TYPE_EDGE_COST,
  ENTRY_TYPE_LIMITS,
  getTagsForDomain,
  getAllTagsForDomain,
  searchTagsForDomain,
  lookupTagLabelForDomain,
  computeQualityPreview,
  influenceLabel,
  getRecentTags,
  listEntriesForEagoh,
  listAllEntries,
  submitEntry,
  updateEntry,
  withdrawEntry,
  restoreEntry,
  toggleExchangeShare,
  toggleFactionShare,
  fetchVersionHistory,
  hasModerationAccess,
  VALIDATION_STATUS_LABELS,
  validationStatusColor,
  CHANGE_TYPE_LABELS,
  type ConfidenceLevel,
  type EntryType,
  type OpenIntelligenceRow,
  type VersionHistoryEntry,
} from "@/services/openIntelligence";
import { listUserFactions, type FactionRow } from "@/services/factions";
import { supabase } from "@/lib/supabase";
import { useHaptics } from "@/hooks/useHaptics";
import { LinearGradient } from "expo-linear-gradient";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Edit3,
  Eye,
  FileClock,
  FlaskConical,
  GitBranch,
  Hash,
  ListChecks,
  Plus,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  Sparkles,
  Tag,
  Trash2,
  X,
  Zap,
} from "lucide-react-native";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";

type OptionTone = "cyan" | "gold" | "violet" | "ember" | "success";

function toneColor(tone: OptionTone): string {
  if (tone === "gold") return palette.gold;
  if (tone === "violet") return palette.violet;
  if (tone === "ember") return palette.ember;
  if (tone === "success") return palette.success;
  return palette.cyan;
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }): JSX.Element {
  return (
    <View style={styles.sectionTitleWrap}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

// ── EAGOH Selector Card ──────────────────────────────────────────────

const EagohSelector = memo(function EagohSelector({
  eagohs,
  selectedId,
  onSelect,
}: {
  eagohs: EagohRecord[];
  selectedId: string;
  onSelect: (id: string) => void;
}): JSX.Element {
  const h = useHaptics();
  const [open, setOpen] = useState<boolean>(false);
  const selected = useMemo(() => eagohs.find((e) => e.id === selectedId), [eagohs, selectedId]);
  const domain = selected ? getDomain(selected.domain ?? "") : undefined;
  const accent = domain ? toneColor(domain.tone) : palette.muted;

  const handleSelect = useCallback((id: string): void => {
    h.selection();
    onSelect(id);
    setOpen(false);
  }, [onSelect, h]);

  return (
    <View>
      <Pressable
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [styles.eagohCard, pressed && styles.pressed]}
      >
        <View style={[styles.eagohAvatar, { borderColor: `${accent}55`, backgroundColor: `${accent}12` }]}>
          <BrainCircuit color={accent} size={22} />
        </View>
        <View style={styles.eagohInfo}>
          <Text style={styles.eagohName}>{selected?.name ?? "No EAGOH selected"}</Text>
          <Text style={[styles.eagohDomain, { color: accent }]}>
            {domain?.label ?? selected?.domain ?? "Select an EAGOH"}
          </Text>
        </View>
        <ChevronDown color={palette.muted} size={18} />
      </Pressable>

      {open ? (
        <View style={styles.dropdown}>
          {eagohs.length === 0 ? (
            <Text style={styles.emptyText}>No EAGOHs forged yet. Visit the Forge.</Text>
          ) : (
            eagohs.map((eagoh) => {
              const d = getDomain(eagoh.domain ?? "");
              const dt = d ? toneColor(d.tone) : palette.muted;
              const isSelected = eagoh.id === selectedId;
              return (
                <Pressable
                  key={eagoh.id}
                  onPress={() => handleSelect(eagoh.id)}
                  style={({ pressed }) => [
                    styles.dropdownItem,
                    isSelected && { borderColor: palette.cyan, backgroundColor: "rgba(108,230,255,0.08)" },
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={[styles.dropdownDot, { backgroundColor: dt }]} />
                  <View style={styles.dropdownInfo}>
                    <Text style={styles.dropdownName}>{eagoh.name}</Text>
                    <Text style={styles.dropdownDomain}>{d?.label ?? eagoh.domain ?? "No domain"}</Text>
                  </View>
                  {isSelected ? <Check color={palette.cyan} size={16} /> : null}
                </Pressable>
              );
            })
          )}
        </View>
      ) : null}
    </View>
  );
});

// ── Entry Type Picker ─────────────────────────────────────────────────

const entryTypes: { id: EntryType; label: string; detail: string; tone: OptionTone }[] = [
  { id: "quick_observation", label: "Quick Observation", detail: "110 chars max · lightweight signal", tone: "cyan" },
  { id: "basic_deep_entry", label: "Basic Deep Entry", detail: "200 chars max · deeper read", tone: "gold" },
  { id: "advanced_deep_entry", label: "Advanced Deep Entry", detail: "400 chars max · high-context feed", tone: "violet" },
];

const EntryTypeRow = memo(function EntryTypeRow({
  item,
  selected,
  onPress,
}: {
  item: typeof entryTypes[0];
  selected: boolean;
  onPress: () => void;
}): JSX.Element {
  const accent = toneColor(item.tone);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.entryTypeCard,
        selected && { borderColor: accent, backgroundColor: `${accent}12` },
        pressed && styles.pressed,
      ]}
    >
      <Zap color={selected ? accent : palette.muted} size={16} />
      <View style={styles.entryTypeCopy}>
        <Text style={[styles.entryTypeLabel, selected && { color: accent }]}>{item.label}</Text>
        <Text style={styles.entryTypeDetail}>{item.detail}</Text>
      </View>
      <Text style={[styles.entryTypeCost, { color: accent }]}>
        {ENTRY_TYPE_EDGE_COST[item.id]} Neurons
      </Text>
    </Pressable>
  );
});

// ── Selected Subtags Chips ────────────────────────────────────────────

const SelectedSubtagChip = memo(function SelectedSubtagChip({
  tagId,
  label,
  onRemove,
}: {
  tagId: string;
  label: string;
  onRemove: (id: string) => void;
}): JSX.Element {
  return (
    <Pressable
      onPress={() => onRemove(tagId)}
      style={({ pressed }) => [styles.selectedChip, pressed && styles.pressed]}
    >
      <Check color={palette.cyan} size={10} />
      <Text style={styles.selectedChipText}>{label}</Text>
      <X color={palette.muted} size={12} />
    </Pressable>
  );
});

// ── Tag Selector (multi-select, search, recently used) ─────────────────

const TagSelector = memo(function TagSelector({
  selectedSubtags,
  onToggleSubtag,
  customTags,
  onAddCustomTag,
  onRemoveCustomTag,
  domainId,
}: {
  selectedSubtags: string[];
  onToggleSubtag: (id: string) => void;
  customTags: string[];
  onAddCustomTag: (tag: string) => void;
  onRemoveCustomTag: (tag: string) => void;
  domainId: string;
}): JSX.Element {
  const h = useHaptics();
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [customInput, setCustomInput] = useState<string>("");
  const [recentTags, setRecentTags] = useState<string[]>([]);

  const tags = useMemo(() => getTagsForDomain(domainId), [domainId]);
  const allTags = useMemo(() => getAllTagsForDomain(domainId), [domainId]);

  // Reset accordion & search when domain changes
  useEffect(() => {
    setOpenCategories({});
    setSearchQuery("");
  }, [domainId]);

  // Load recent tags (filtered to current domain)
  useEffect(() => {
    getRecentTags().then((allRecent) => {
      const allTagIds = new Set(allTags.map((t) => t.id));
      setRecentTags(allRecent.filter((id) => allTagIds.has(id)));
    });
  }, [allTags]);

  const toggleCategory = useCallback((id: string): void => {
    setOpenCategories((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleToggle = useCallback((tagId: string): void => {
    h.selection();
    onToggleSubtag(tagId);
  }, [onToggleSubtag, h]);

  const handleAddCustom = useCallback((): void => {
    const trimmed = customInput.trim().slice(0, 30);
    if (trimmed && !customTags.includes(trimmed)) {
      onAddCustomTag(trimmed);
      setCustomInput("");
    }
  }, [customInput, customTags, onAddCustomTag]);

  const handleRemoveSelected = useCallback((tagId: string): void => {
    h.selection();
    onToggleSubtag(tagId);
  }, [onToggleSubtag, h]);

  // Filtered search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    return searchTagsForDomain(domainId, searchQuery);
  }, [searchQuery, domainId]);

  // Recently used tags with labels
  const recentTagsWithLabels = useMemo(() => {
    return recentTags
      .filter((id) => !selectedSubtags.includes(id))
      .slice(0, 8)
      .map((id) => {
        const label = allTags.find((t) => t.id === id)?.label ?? id.replace("custom:", "");
        return { id, label };
      });
  }, [recentTags, selectedSubtags, allTags]);

  const hasAnySelection = selectedSubtags.length > 0 || customTags.length > 0;

  return (
    <View style={styles.tagSection}>
      {/* Selected subtags chips */}
      {selectedSubtags.length > 0 ? (
        <View style={styles.selectedTagsRow}>
          {selectedSubtags.map((tagId) => (
            <SelectedSubtagChip
              key={tagId}
              tagId={tagId}
              label={lookupTagLabelForDomain(tagId, domainId)}
              onRemove={handleRemoveSelected}
            />
          ))}
        </View>
      ) : null}

      {/* Custom tags chips */}
      {customTags.length > 0 ? (
        <View style={styles.selectedTagsRow}>
          {customTags.map((ct) => (
            <SelectedSubtagChip
              key={`custom-${ct}`}
              tagId={`custom:${ct}`}
              label={ct}
              onRemove={() => onRemoveCustomTag(ct)}
            />
          ))}
        </View>
      ) : null}

      {/* Search bar */}
      <View style={styles.searchWrap}>
        <Search color={palette.muted} size={14} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search tags…"
          placeholderTextColor={palette.muted}
          style={styles.searchInput}
        />
        {searchQuery.length > 0 ? (
          <Pressable onPress={() => setSearchQuery("")}>
            <X color={palette.muted} size={14} />
          </Pressable>
        ) : null}
      </View>

      {/* Search results */}
      {searchResults !== null ? (
        searchResults.length > 0 ? (
          <View style={styles.searchResults}>
            {searchResults.map((tag) => {
              const isSelected = selectedSubtags.includes(tag.id);
              return (
                <Pressable
                  key={tag.id}
                  onPress={() => handleToggle(tag.id)}
                  style={({ pressed }) => [
                    styles.tagChip,
                    isSelected && { borderColor: palette.cyan, backgroundColor: "rgba(108,230,255,0.12)" },
                    pressed && styles.pressed,
                  ]}
                >
                  {isSelected ? <Check color={palette.cyan} size={11} /> : <Hash color={palette.muted} size={11} />}
                  <Text style={[styles.tagChipText, isSelected && { color: palette.cyan }]}>{tag.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Text style={styles.searchEmpty}>No tags match "{searchQuery}"</Text>
        )
      ) : null}

      {/* Recently Used — only show when not searching */}
      {!searchQuery && recentTagsWithLabels.length > 0 ? (
        <View style={styles.tagCategory}>
          <View style={styles.tagCategoryHeader}>
            <Clock color={palette.gold} size={12} />
            <Text style={[styles.tagCategoryLabel, { color: palette.gold }]}>Recently Used</Text>
          </View>
          <View style={styles.tagGrid}>
            {recentTagsWithLabels.map((tag) => (
              <Pressable
                key={tag.id}
                onPress={() => handleToggle(tag.id)}
                style={({ pressed }) => [
                  styles.tagChip,
                  { borderColor: "rgba(255,181,71,0.25)" },
                  pressed && styles.pressed,
                ]}
              >
                <Hash color={palette.gold} size={11} />
                <Text style={[styles.tagChipText, { color: palette.gold }]}>{tag.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {/* Category accordions — hidden while searching */}
      {!searchQuery ? (
        tags.map((cat) => {
          const isOpen = openCategories[cat.id] ?? false;
          const selectedInCat = cat.tags.filter((t) => selectedSubtags.includes(t.id)).length;
          return (
            <View key={cat.id} style={styles.tagCategory}>
              <Pressable
                onPress={() => toggleCategory(cat.id)}
                style={({ pressed }) => [styles.tagCategoryHeader, pressed && styles.pressed]}
              >
                <Text style={styles.tagCategoryLabel}>
                  {cat.label}
                  {selectedInCat > 0 ? (
                    <Text style={styles.categoryCount}> ({selectedInCat})</Text>
                  ) : null}
                </Text>
                {isOpen ? <ChevronDown color={palette.muted} size={14} /> : <ChevronRight color={palette.muted} size={14} />}
              </Pressable>
              {isOpen ? (
                <View style={styles.tagGrid}>
                  {cat.tags.map((tag) => {
                    const isSelected = selectedSubtags.includes(tag.id);
                    return (
                      <Pressable
                        key={tag.id}
                        onPress={() => handleToggle(tag.id)}
                        style={({ pressed }) => [
                          styles.tagChip,
                          isSelected && { borderColor: palette.cyan, backgroundColor: "rgba(108,230,255,0.12)" },
                          pressed && styles.pressed,
                        ]}
                      >
                        {isSelected ? <Check color={palette.cyan} size={11} /> : <Hash color={palette.muted} size={11} />}
                        <Text style={[styles.tagChipText, isSelected && { color: palette.cyan }]}>{tag.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        })
      ) : null}

      {/* Custom Tags */}
      <View style={styles.tagCategory}>
        <View style={styles.tagCategoryHeader}>
          <Plus color={palette.gold} size={12} />
          <Text style={[styles.tagCategoryLabel, { color: palette.gold }]}>Custom Tags</Text>
        </View>
        <View style={styles.customTagWrap}>
          <TextInput
            value={customInput}
            onChangeText={(t) => setCustomInput(t.slice(0, 30))}
            placeholder="Enter custom tag (max 30 chars)"
            placeholderTextColor={palette.muted}
            maxLength={30}
            style={styles.customTagInput}
            onSubmitEditing={handleAddCustom}
            returnKeyType="done"
          />
          <Pressable
            onPress={handleAddCustom}
            disabled={!customInput.trim()}
            style={({ pressed }) => [
              styles.customAddBtn,
              !customInput.trim() && { opacity: 0.4 },
              pressed && styles.pressed,
            ]}
          >
            <Plus color={palette.void} size={14} />
          </Pressable>
        </View>
        {customInput.length > 0 ? (
          <Text style={styles.customTagCount}>{customInput.length}/30</Text>
        ) : null}
      </View>

      {/* Empty state */}
      {!hasAnySelection && !searchQuery ? (
        <Text style={styles.tagEmptyState}>
          Select tags that best describe what your EAGOH is learning.
        </Text>
      ) : null}
    </View>
  );
});

// ── Confidence Level Picker ───────────────────────────────────────────

const ConfidencePicker = memo(function ConfidencePicker({
  selected,
  onSelect,
}: {
  selected: ConfidenceLevel;
  onSelect: (v: ConfidenceLevel) => void;
}): JSX.Element {
  return (
    <View style={styles.confidenceRow}>
      {CONFIDENCE_LEVELS.map((level) => {
        const isSelected = selected === level.id;
        return (
          <Pressable
            key={level.id}
            onPress={() => onSelect(level.id)}
            style={({ pressed }) => [
              styles.confidenceChip,
              isSelected && { borderColor: palette.cyan, backgroundColor: "rgba(108,230,255,0.10)" },
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.confidenceDot, { backgroundColor: isSelected ? palette.cyan : "rgba(255,255,255,0.18)" }]} />
            <Text style={[styles.confidenceText, isSelected && { color: palette.cyan }]}>
              {level.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
});

// ── Quality Score Preview ─────────────────────────────────────────────

const ScorePreview = memo(function ScorePreview({
  content,
  entryType,
  confidenceLevel,
  tag,
  domainId,
}: {
  content: string;
  entryType: EntryType;
  confidenceLevel: ConfidenceLevel;
  tag: string;
  domainId: string;
}): JSX.Element {
  const score = useMemo(() => {
    if (!content.trim()) return null;
    return computeQualityPreview({ content, entryType, confidenceLevel, tag }, domainId);
  }, [content, entryType, confidenceLevel, tag, domainId]);

  if (!score) {
    return (
      <View style={styles.scorePanel}>
        <BarChart3 color={palette.muted} size={14} />
        <Text style={styles.scorePlaceholder}>Enter intelligence to see quality preview.</Text>
      </View>
    );
  }

  const infLabel = influenceLabel(score.influenceScore);
  const infColor = infLabel === "high" ? palette.success : infLabel === "medium" ? palette.gold : palette.muted;

  return (
    <View style={styles.scorePanel}>
      <View style={styles.scoreRow}>
        <View style={styles.scoreItem}>
          <Text style={styles.scoreLabel}>Quality</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${score.qualityScore}%`, backgroundColor: palette.cyan }]} />
          </View>
          <Text style={[styles.scoreValue, { color: palette.cyan }]}>{score.qualityScore}</Text>
        </View>
        <View style={styles.scoreItem}>
          <Text style={styles.scoreLabel}>Influence</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${score.influenceScore}%`, backgroundColor: infColor }]} />
          </View>
          <Text style={[styles.scoreValue, { color: infColor }]}>{infLabel}</Text>
        </View>
      </View>
      <View style={styles.scoreMeta}>
        <Eye color={palette.muted} size={11} />
        <Text style={styles.scoreMetaText}>Validation: Pending Review</Text>
      </View>
    </View>
  );
});

// ── Learning Feed ─────────────────────────────────────────────────────

const LearningEntry = memo(function LearningEntry({
  entry,
  domainId,
}: {
  entry: OpenIntelligenceRow;
  domainId: string;
}): JSX.Element {
  const domainTags = useMemo(() => getAllTagsForDomain(domainId), [domainId]);

  // Build display tags from selected_subtags, custom_tags, or fallback to legacy tag field
  const displayTags: string[] = useMemo(() => {
    if (entry.selected_subtags && entry.selected_subtags.length > 0) {
      return entry.selected_subtags.map((id) => domainTags.find((t) => t.id === id)?.label ?? id);
    }
    if (entry.custom_tags && entry.custom_tags.length > 0) {
      return entry.custom_tags;
    }
    return [entry.tag === "general" ? "General" : entry.tag.replace("custom:", "")];
  }, [entry, domainTags]);

  const infLabel = influenceLabel(entry.influence_score);
  const infColor = infLabel === "high" ? palette.success : infLabel === "medium" ? palette.gold : palette.muted;

  const entryLabel = entry.entry_type === "quick_observation" ? "Quick"
    : entry.entry_type === "basic_deep_entry" ? "Basic"
    : "Advanced";

  // Phase 6A: Use proper validation status labels
  const statusKey = entry.validation_status ?? "pending_review";
  const statusLabel = VALIDATION_STATUS_LABELS[statusKey] ?? "Pending Review";
  const statusColor = validationStatusColor(statusKey);

  return (
    <View style={styles.learningCard}>
      <View style={styles.learningTop}>
        <View style={styles.learningBadgeRow}>
          {displayTags.slice(0, 3).map((label, idx) => (
            <View key={idx} style={styles.learningBadge}>
              <Hash color={palette.cyan} size={10} />
              <Text style={styles.learningBadgeText}>{label}</Text>
            </View>
          ))}
          {displayTags.length > 3 ? (
            <Text style={styles.learningBadgeMore}>+{displayTags.length - 3}</Text>
          ) : null}
        </View>
        <View style={styles.learningMeta}>
          <Text style={styles.learningType}>{entryLabel}</Text>
          <Text style={styles.learningDot}>·</Text>
          <Clock color={palette.muted} size={10} />
          <Text style={styles.learningTime}>
            {new Date(entry.created_at).toLocaleDateString()}
          </Text>
        </View>
      </View>
      <Text style={styles.learningContent} numberOfLines={3}>{entry.content}</Text>
      <View style={styles.learningScores}>
        <View style={styles.learningScoreItem}>
          <Text style={styles.learningScoreLabel}>Quality</Text>
          <Text style={[styles.learningScoreVal, { color: palette.cyan }]}>{entry.quality_score}</Text>
        </View>
        <View style={styles.learningScoreDivider} />
        <View style={styles.learningScoreItem}>
          <Text style={styles.learningScoreLabel}>Influence</Text>
          <Text style={[styles.learningScoreVal, { color: infColor }]}>{infLabel}</Text>
        </View>
        <View style={styles.learningScoreDivider} />
        <View style={styles.learningScoreItem}>
          <Text style={styles.learningScoreLabel}>Status</Text>
          <Text style={[styles.learningScoreVal, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>
    </View>
  );
});

// ── My Intelligence: Entry Card ───────────────────────────────────────

type MyExpandedEntry = {
  entry: OpenIntelligenceRow;
  sharedFactionIds: string[];
};

function MyEntryStatusBadge({ status }: { status: string }): JSX.Element {
  const color = validationStatusColor(status);
  const label = VALIDATION_STATUS_LABELS[status] ?? "Pending Review";
  return (
    <View style={[styles.myBadge, { borderColor: `${color}44`, backgroundColor: `${color}12` }]}>
      <ShieldAlert color={color} size={9} />
      <Text style={[styles.myBadgeText, { color }]}>{label}</Text>
    </View>
  );
}

function MySharePill({ enabled, label }: { enabled: boolean; label: string }): JSX.Element {
  const color = enabled ? palette.success : palette.muted;
  return (
    <View style={[styles.mySharePill, { borderColor: `${color}33` }]}>
      <Text style={[styles.mySharePillText, { color }]}>
        {label}: {enabled ? "On" : "Off"}
      </Text>
    </View>
  );
}

function MyEntryCard({
  data,
  factions,
  onEdit,
  onWithdraw,
  onRestore,
  onToggleExchange,
  onToggleFaction,
  onShowVersions,
  busy,
}: {
  data: MyExpandedEntry;
  factions: FactionRow[];
  onEdit: (entry: OpenIntelligenceRow) => void;
  onWithdraw: (entry: OpenIntelligenceRow) => void;
  onRestore: (entryId: string) => void;
  onToggleExchange: (entryId: string, enabled: boolean) => void;
  onToggleFaction: (entryId: string, factionId: string, enabled: boolean) => void;
  onShowVersions: (entryId: string) => void;
  busy: string | null;
}): JSX.Element {
  const h = useHaptics();
  const { entry, sharedFactionIds } = data;
  const status = entry.validation_status ?? "pending_review";
  const isWithdrawn = status === "withdrawn";
  const isRejected = status === "rejected";
  const isDisputed = status === "disputed" || (entry.active_dispute_count ?? 0) > 0;
  const isOutdated = entry.outdated_flag ?? false;
  const [factionPickerOpen, setFactionPickerOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const canEdit = !isWithdrawn && !isRejected;
  const canWithdraw = !isWithdrawn && !isRejected;
  const canRestore = isWithdrawn;
  const canShare = !isWithdrawn && !isRejected;

  const createdDate = useMemo(() => new Date(entry.created_at).toLocaleDateString(), [entry.created_at]);
  const updatedDate = useMemo(() => new Date(entry.updated_at).toLocaleDateString(), [entry.updated_at]);

  return (
    <View style={styles.myEntryCard}>
      <View style={styles.myEntryTopRow}>
        <MyEntryStatusBadge status={status} />
        {isOutdated ? (
          <View style={[styles.myWarnBadge, { borderColor: `${palette.gold}33` }]}>
            <Clock color={palette.gold} size={9} />
            <Text style={[styles.myWarnText, { color: palette.gold }]}>Outdated</Text>
          </View>
        ) : null}
        {isDisputed ? (
          <View style={[styles.myWarnBadge, { borderColor: `${palette.ember}33` }]}>
            <AlertTriangle color={palette.ember} size={9} />
            <Text style={[styles.myWarnText, { color: palette.ember }]}>Disputed</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.myEntryContent} numberOfLines={expanded ? undefined : 3}>
        {entry.content}
      </Text>
      {entry.content.length > 120 ? (
        <Pressable onPress={() => { h.selection(); setExpanded(!expanded); }} style={styles.myExpandBtn}>
          <Text style={styles.myExpandText}>{expanded ? "Show less" : "Show more"}</Text>
        </Pressable>
      ) : null}

      <View style={styles.myMetaGrid}>
        <View style={styles.myMetaItem}>
          <Text style={styles.myMetaLabel}>Category</Text>
          <Text style={styles.myMetaValue}>{entry.selected_category ?? entry.tag ?? "—"}</Text>
        </View>
        <View style={styles.myMetaItem}>
          <Text style={styles.myMetaLabel}>Confidence</Text>
          <Text style={styles.myMetaValue}>{(entry.confidence_level ?? "").replace(/_/g, " ")}</Text>
        </View>
        <View style={styles.myMetaItem}>
          <Text style={styles.myMetaLabel}>Quality</Text>
          <Text style={[styles.myMetaValue, { color: palette.cyan }]}>{entry.quality_score}</Text>
        </View>
        <View style={styles.myMetaItem}>
          <Text style={styles.myMetaLabel}>Version</Text>
          <Text style={styles.myMetaValue}>{entry.version_number ?? 1}</Text>
        </View>
        <View style={styles.myMetaItem}>
          <Text style={styles.myMetaLabel}>Created</Text>
          <Text style={styles.myMetaValue}>{createdDate}</Text>
        </View>
        <View style={styles.myMetaItem}>
          <Text style={styles.myMetaLabel}>Updated</Text>
          <Text style={styles.myMetaValue}>{updatedDate}</Text>
        </View>
      </View>

      <View style={styles.myShareRow}>
        <MySharePill enabled={entry.exchange_share_enabled ?? false} label="Exchange" />
        {sharedFactionIds.length > 0 ? (
          <MySharePill enabled={true} label={`Faction (${sharedFactionIds.length})`} />
        ) : (
          <MySharePill enabled={false} label="Faction" />
        )}
      </View>

      <View style={styles.myActionsRow}>
        {canEdit ? (
          <Pressable
            onPress={() => { h.selection(); onEdit(entry); }}
            style={({ pressed }) => [styles.myActionBtn, pressed && styles.pressed]}
            disabled={busy !== null}
          >
            <Edit3 color={palette.cyan} size={13} />
            <Text style={[styles.myActionText, { color: palette.cyan }]}>Edit</Text>
          </Pressable>
        ) : null}

        {canWithdraw ? (
          <Pressable
            onPress={() => { h.selection(); onWithdraw(entry); }}
            style={({ pressed }) => [styles.myActionBtn, { borderColor: `${palette.ember}33` }, pressed && styles.pressed]}
            disabled={busy !== null}
          >
            {busy === `withdraw:${entry.id}` ? (
              <ActivityIndicator color={palette.ember} size={13} />
            ) : (
              <Trash2 color={palette.ember} size={13} />
            )}
            <Text style={[styles.myActionText, { color: palette.ember }]}>Withdraw</Text>
          </Pressable>
        ) : null}

        {canRestore ? (
          <Pressable
            onPress={() => { h.selection(); onRestore(entry.id); }}
            style={({ pressed }) => [styles.myActionBtn, { borderColor: `${palette.success}33` }, pressed && styles.pressed]}
            disabled={busy !== null}
          >
            {busy === `restore:${entry.id}` ? (
              <ActivityIndicator color={palette.success} size={13} />
            ) : (
              <RotateCcw color={palette.success} size={13} />
            )}
            <Text style={[styles.myActionText, { color: palette.success }]}>Restore</Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => { h.selection(); onShowVersions(entry.id); }}
          style={({ pressed }) => [styles.myActionBtn, pressed && styles.pressed]}
          disabled={busy !== null}
        >
          <FileClock color={palette.muted} size={13} />
          <Text style={[styles.myActionText, { color: palette.muted }]}>History</Text>
        </Pressable>
      </View>

      {canShare ? (
        <View style={styles.mySharingSection}>
          <Pressable
            onPress={() => { h.selection(); onToggleExchange(entry.id, !(entry.exchange_share_enabled ?? false)); }}
            style={({ pressed }) => [styles.myToggleRow, pressed && styles.pressed]}
            disabled={busy !== null}
          >
            <Text style={styles.myToggleLabel}>Exchange Sharing</Text>
            <View style={[styles.myToggleSwitch, entry.exchange_share_enabled && { backgroundColor: palette.cyan, borderColor: palette.cyan }]}>
              <View style={[styles.myToggleKnob, entry.exchange_share_enabled && { transform: [{ translateX: 16 }] }]} />
            </View>
          </Pressable>

          {factions.length > 0 ? (
            <View>
              <Pressable
                onPress={() => { h.selection(); setFactionPickerOpen(!factionPickerOpen); }}
                style={({ pressed }) => [styles.myToggleRow, pressed && styles.pressed]}
              >
                <Text style={styles.myToggleLabel}>Faction Sharing</Text>
                <ChevronDown color={palette.muted} size={14} />
              </Pressable>

              {factionPickerOpen ? (
                <View style={styles.myFactionList}>
                  {factions.map((f) => {
                    const isShared = sharedFactionIds.includes(f.id);
                    return (
                      <Pressable
                        key={f.id}
                        onPress={() => { h.selection(); onToggleFaction(entry.id, f.id, !isShared); }}
                        style={({ pressed }) => [styles.myFactionItem, pressed && styles.pressed]}
                        disabled={busy !== null}
                      >
                        <Text style={styles.myFactionName}>{f.name}</Text>
                        <View style={[styles.myToggleSwitch, isShared && { backgroundColor: palette.violet, borderColor: palette.violet }]}>
                          <View style={[styles.myToggleKnob, isShared && { transform: [{ translateX: 16 }] }]} />
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ── Edit Entry Modal ───────────────────────────────────────────────────

function EditEntryModal({
  visible,
  entry,
  domainId,
  onClose,
  onSaved,
}: {
  visible: boolean;
  entry: OpenIntelligenceRow | null;
  domainId: string;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const h = useHaptics();
  const [editContent, setEditContent] = useState<string>("");
  const [editConfidence, setEditConfidence] = useState<ConfidenceLevel>("moderate_confidence");
  const [editCategory, setEditCategory] = useState<string>("");
  const [editSubtags, setEditSubtags] = useState<string[]>([]);
  const [editCustomTags, setEditCustomTags] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const tags = useMemo(() => getTagsForDomain(domainId), [domainId]);
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (visible && entry) {
      setEditContent(entry.content);
      setEditConfidence((entry.confidence_level as ConfidenceLevel) ?? "moderate_confidence");
      setEditCategory(entry.selected_category ?? "");
      setEditSubtags(entry.selected_subtags ?? []);
      setEditCustomTags(entry.custom_tags ?? []);
      setResultMsg(null);
      setOpenCats({});
    }
  }, [visible, entry]);

  const canSubmit = editContent.trim().length > 0 && !submitting;

  const handleAddCustom = useCallback((): void => {
    const trimmed = customInput.trim().slice(0, 30);
    if (trimmed && !editCustomTags.includes(trimmed)) {
      setEditCustomTags((prev) => [...prev, trimmed]);
      setCustomInput("");
    }
  }, [customInput, editCustomTags]);

  const handleSave = useCallback(async (): Promise<void> => {
    if (!entry || !editContent.trim()) return;
    h.light();
    setSubmitting(true);
    setResultMsg(null);

    const result = await updateEntry({
      entryId: entry.id,
      content: editContent.trim(),
      confidenceLevel: editConfidence,
      selectedCategory: editCategory || null,
      selectedSubtags: editSubtags.length > 0 ? editSubtags : null,
      customTags: editCustomTags.length > 0 ? editCustomTags : null,
    });

    setSubmitting(false);

    if (result.ok) {
      setResultMsg("Entry updated. Quality recalculated server-side.");
      h.success();
      onSaved();
      setTimeout(() => onClose(), 800);
    } else {
      setResultMsg(result.error ?? "Failed to update entry.");
    }
  }, [entry, editContent, editConfidence, editCategory, editSubtags, editCustomTags, h, onSaved, onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.modalSheet}>
          <LinearGradient colors={["#0A1628", "#050D18"]} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Edit3 color={palette.cyan} size={18} />
              <Text style={styles.modalTitle}>Edit Intelligence</Text>
            </View>
            <Pressable onPress={onClose} style={styles.modalCloseBtn}>
              <X color={palette.muted} size={20} />
            </Pressable>
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.sectionLabel}>Content</Text>
            <TextInput
              value={editContent}
              onChangeText={setEditContent}
              placeholder="Edit your observation..."
              placeholderTextColor={palette.muted}
              multiline
              style={styles.modalContentInput}
              textAlignVertical="top"
            />

            <Text style={[styles.sectionLabel, { marginTop: 14 }]}>Confidence Level</Text>
            <View style={styles.modalConfidenceRow}>
              {(["weak_suspicion", "moderate_confidence", "strong_confidence", "verified_observation"] as ConfidenceLevel[]).map((level) => {
                const isSelected = editConfidence === level;
                return (
                  <Pressable
                    key={level}
                    onPress={() => { h.selection(); setEditConfidence(level); }}
                    style={({ pressed }) => [
                      styles.modalConfidenceChip,
                      isSelected && { borderColor: palette.cyan, backgroundColor: "rgba(108,230,255,0.10)" },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.modalConfidenceText, isSelected && { color: palette.cyan }]}>
                      {level.replace(/_/g, " ")}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.sectionLabel, { marginTop: 14 }]}>Category</Text>
            <View style={styles.modalCatRow}>
              {tags.map((cat) => {
                const isSelected = editCategory === cat.id;
                return (
                  <Pressable
                    key={cat.id}
                    onPress={() => { h.selection(); setEditCategory(isSelected ? "" : cat.id); }}
                    style={({ pressed }) => [
                      styles.modalCatChip,
                      isSelected && { borderColor: palette.cyan, backgroundColor: "rgba(108,230,255,0.10)" },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.modalCatText, isSelected && { color: palette.cyan }]}>{cat.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.sectionLabel, { marginTop: 14 }]}>Subtags</Text>
            {tags.map((cat) => {
              const isOpen = openCats[cat.id] ?? false;
              const selectedInCat = cat.tags.filter((t) => editSubtags.includes(t.id)).length;
              return (
                <View key={cat.id} style={styles.modalTagCat}>
                  <Pressable
                    onPress={() => setOpenCats((prev) => ({ ...prev, [cat.id]: !prev[cat.id] }))}
                    style={({ pressed }) => [styles.modalTagCatHeader, pressed && styles.pressed]}
                  >
                    <Text style={styles.modalTagCatLabel}>
                      {cat.label}{selectedInCat > 0 ? <Text style={styles.categoryCount}> ({selectedInCat})</Text> : null}
                    </Text>
                    {isOpen ? <ChevronDown color={palette.muted} size={14} /> : <ChevronRight color={palette.muted} size={14} />}
                  </Pressable>
                  {isOpen ? (
                    <View style={styles.tagGrid}>
                      {cat.tags.map((tag) => {
                        const isSelected = editSubtags.includes(tag.id);
                        return (
                          <Pressable
                            key={tag.id}
                            onPress={() => {
                              h.selection();
                              setEditSubtags((prev) => prev.includes(tag.id) ? prev.filter((id) => id !== tag.id) : [...prev, tag.id]);
                            }}
                            style={({ pressed }) => [
                              styles.tagChip,
                              isSelected && { borderColor: palette.cyan, backgroundColor: "rgba(108,230,255,0.12)" },
                              pressed && styles.pressed,
                            ]}
                          >
                            {isSelected ? <Check color={palette.cyan} size={11} /> : <Hash color={palette.muted} size={11} />}
                            <Text style={[styles.tagChipText, isSelected && { color: palette.cyan }]}>{tag.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              );
            })}

            <Text style={[styles.sectionLabel, { marginTop: 14 }]}>Custom Tags</Text>
            <View style={styles.customTagWrap}>
              <TextInput
                value={customInput}
                onChangeText={(t) => setCustomInput(t.slice(0, 30))}
                placeholder="Add custom tag (max 30 chars)"
                placeholderTextColor={palette.muted}
                maxLength={30}
                style={styles.customTagInput}
                onSubmitEditing={handleAddCustom}
                returnKeyType="done"
              />
              <Pressable
                onPress={handleAddCustom}
                disabled={!customInput.trim()}
                style={({ pressed }) => [styles.customAddBtn, !customInput.trim() && { opacity: 0.4 }, pressed && styles.pressed]}
              >
                <Plus color={palette.void} size={14} />
              </Pressable>
            </View>
            {editCustomTags.length > 0 ? (
              <View style={styles.selectedTagsRow}>
                {editCustomTags.map((ct) => (
                  <Pressable
                    key={`edit-${ct}`}
                    onPress={() => { h.selection(); setEditCustomTags((prev) => prev.filter((t) => t !== ct)); }}
                    style={({ pressed }) => [styles.selectedChip, pressed && styles.pressed]}
                  >
                    <Check color={palette.cyan} size={10} />
                    <Text style={styles.selectedChipText}>{ct}</Text>
                    <X color={palette.muted} size={12} />
                  </Pressable>
                ))}
              </View>
            ) : null}

            <Text style={styles.modalNotice}>
              Quality score, influence score, and validation status are calculated
              server-side and cannot be set manually.
            </Text>

            {resultMsg ? (
              <View style={[styles.modalResultBox, { borderColor: `${resultMsg.includes("updated") ? palette.success : palette.ember}33` }]}>
                <Text style={[styles.modalResultText, { color: resultMsg.includes("updated") ? palette.success : palette.ember }]}>
                  {resultMsg}
                </Text>
              </View>
            ) : null}

            <Pressable
              onPress={handleSave}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.modalSubmitBtn,
                !canSubmit && { backgroundColor: "rgba(255,255,255,0.06)" },
                pressed && { opacity: 0.85 },
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={palette.void} size="small" />
              ) : (
                <>
                  <Save color={canSubmit ? palette.void : palette.muted} size={15} />
                  <Text style={[styles.modalSubmitText, !canSubmit && { color: palette.muted }]}>Save Changes</Text>
                </>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Version History Modal ──────────────────────────────────────────────

function VersionHistoryModal({
  visible,
  entryId,
  onClose,
}: {
  visible: boolean;
  entryId: string | null;
  onClose: () => void;
}): JSX.Element {
  const [versions, setVersions] = useState<VersionHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible && entryId) {
      setLoading(true);
      setError(null);
      fetchVersionHistory(entryId).then((result) => {
        setLoading(false);
        if (result.ok) {
          setVersions(result.versions);
        } else {
          setError(result.error);
        }
      });
    }
  }, [visible, entryId]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.modalSheet}>
          <LinearGradient colors={["#0A1628", "#050D18"]} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <GitBranch color={palette.cyan} size={18} />
              <Text style={styles.modalTitle}>Version History</Text>
            </View>
            <Pressable onPress={onClose} style={styles.modalCloseBtn}>
              <X color={palette.muted} size={20} />
            </Pressable>
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalBody}>
            {loading ? (
              <ActivityIndicator color={palette.cyan} size="large" style={{ paddingVertical: 30 }} />
            ) : error ? (
              <Text style={styles.modalErrorText}>{error}</Text>
            ) : versions.length === 0 ? (
              <Text style={styles.modalEmptyText}>No version history yet.</Text>
            ) : (
              versions.map((v) => {
                const changeLabel = CHANGE_TYPE_LABELS[v.change_type] ?? v.change_type;
                const dateLabel = new Date(v.changed_at).toLocaleDateString();
                return (
                  <View key={v.id} style={styles.versionItem}>
                    <View style={styles.versionHeader}>
                      <View style={[styles.versionBadge, { borderColor: `${palette.cyan}33` }]}>
                        <Text style={[styles.versionBadgeText, { color: palette.cyan }]}>v{v.version_number}</Text>
                      </View>
                      <Text style={styles.versionChangeType}>{changeLabel}</Text>
                      <Text style={styles.versionDate}>{dateLabel}</Text>
                    </View>
                    {v.previous_content ? (
                      <Text style={styles.versionContent} numberOfLines={3}>{v.previous_content}</Text>
                    ) : (
                      <Text style={styles.versionNoContent}>No content snapshot</Text>
                    )}
                    {v.previous_validation_status ? (
                      <Text style={styles.versionMetaText}>
                        Status: {VALIDATION_STATUS_LABELS[v.previous_validation_status] ?? v.previous_validation_status}
                      </Text>
                    ) : null}
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Confirm Dialog ─────────────────────────────────────────────────────

function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  confirmColor,
  onConfirm,
  onCancel,
  busy,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}): JSX.Element {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={styles.confirmSheet}>
          <LinearGradient colors={["#0A1628", "#050D18"]} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <Text style={styles.confirmTitle}>{title}</Text>
          <Text style={styles.confirmMessage}>{message}</Text>
          <View style={styles.confirmBtnRow}>
            <Pressable
              onPress={onCancel}
              disabled={busy}
              style={({ pressed }) => [styles.confirmCancelBtn, pressed && styles.pressed]}
            >
              <Text style={styles.confirmCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={busy}
              style={({ pressed }) => [
                styles.confirmActionBtn,
                { backgroundColor: confirmColor },
                busy && { opacity: 0.6 },
                pressed && styles.pressed,
              ]}
            >
              {busy ? (
                <ActivityIndicator color={palette.void} size="small" />
              ) : (
                <Text style={styles.confirmActionText}>{confirmLabel}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────

export default function OpenIntelligenceScreen(): JSX.Element {
  const h = useHaptics();
  const { eagohs } = useEagohs();
  const { profile, invalidate: invalidateProfile } = useProfile();
  const { balances } = useEdge();
  const { palette: pal } = useAppTheme();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [selectedEagohId, setSelectedEagohId] = useState<string>("");
  const [entryType, setEntryType] = useState<EntryType>("quick_observation");
  const [content, setContent] = useState<string>("");
  const [selectedSubtags, setSelectedSubtags] = useState<string[]>([]);
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [confidenceLevel, setConfidenceLevel] = useState<ConfidenceLevel>("moderate_confidence");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);
  const { height: windowHeight } = useWindowDimensions();
  const contentInputRef = useRef<TextInput | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const scrollYRef = useRef<number>(0);

  // ── My Intelligence tab state ──
  const [activeTab, setActiveTab] = useState<"add" | "my">("add");
  const [editingEntry, setEditingEntry] = useState<OpenIntelligenceRow | null>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [versionModalVisible, setVersionModalVisible] = useState(false);
  const [versionEntryId, setVersionEntryId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [myActionMsg, setMyActionMsg] = useState<string | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<OpenIntelligenceRow | null>(null);
  const [withdrawConfirmVisible, setWithdrawConfirmVisible] = useState(false);
  const [restoreTargetId, setRestoreTargetId] = useState<string | null>(null);
  const [restoreConfirmVisible, setRestoreConfirmVisible] = useState(false);

  const isAdmin = hasModerationAccess(profile);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const handleContentFocus = useCallback((): void => {
    setTimeout(() => {
      contentInputRef.current?.measureInWindow((_x, inputY, _w, inputHeight) => {
        const inputBottom = inputY + inputHeight;
        const safeBottom = windowHeight - keyboardHeight - 20;
        if (inputBottom > safeBottom) {
          scrollViewRef.current?.scrollTo({ y: scrollYRef.current + (inputBottom - safeBottom) + 12, animated: true });
        }
      });
    }, 180);
  }, [keyboardHeight, windowHeight]);

  // Sync EAGOH selection on load
  useEffect(() => {
    if (!selectedEagohId && eagohs.length > 0) {
      setSelectedEagohId(eagohs[0].id);
    }
  }, [eagohs, selectedEagohId]);

  // Reset tag selections when the selected EAGOH changes
  useEffect(() => {
    setSelectedSubtags([]);
    setCustomTags([]);
  }, [selectedEagohId]);

  const selectedEagoh = useMemo(() => eagohs.find((e) => e.id === selectedEagohId), [eagohs, selectedEagohId]);
  const rawDomain = selectedEagoh?.domain?.trim() || "sports";
  const currentDomain = normalizeDomainId(rawDomain);
  const domain = selectedEagoh ? getDomain(selectedEagoh.domain ?? "") : undefined;
  const domainTone = domain ? toneColor(domain.tone) : palette.muted;

  // Dev-only: resolve loaded taxonomy categories for debug display
  const loadedCategoryLabels = useMemo(() => {
    const cats = getTagsForDomain(currentDomain);
    return cats.map((c) => c.label);
  }, [currentDomain]);

  // Dev-only logging: trace domain resolution when EAGOH changes
  if (__DEV__) {
    useEffect(() => {
      if (!selectedEagoh) return;
      console.log("[open-intelligence] EAGOH switched", {
        eagohId: selectedEagoh.id,
        eagohName: selectedEagoh.name,
        eagohDomain: selectedEagoh.domain,
        rawDomain,
        normalizedDomain: currentDomain,
        loadedCategories: loadedCategoryLabels,
      });
    }, [selectedEagohId, selectedEagoh?.id, selectedEagoh?.name, selectedEagoh?.domain, rawDomain, currentDomain, loadedCategoryLabels]);
  }

  const limit = ENTRY_TYPE_LIMITS[entryType];
  const edgeCost = ENTRY_TYPE_EDGE_COST[entryType];
  const charCountNoSpaces = content.trim().replace(/\s/g, "").length;
  const canSubmit = !!selectedEagohId && content.trim().length > 0 && charCountNoSpaces <= limit && balances.total >= edgeCost && !isSubmitting;

  // Learning feed
  const feedQuery = useQuery<OpenIntelligenceRow[]>({
    queryKey: ["oi", "feed", selectedEagohId],
    enabled: !!selectedEagohId,
    queryFn: () => listEntriesForEagoh(selectedEagohId, 20),
  });

  const handleToggleSubtag = useCallback((tagId: string): void => {
    setSelectedSubtags((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  }, []);

  // ── My Intelligence queries ──
  const myEntriesQuery = useQuery<OpenIntelligenceRow[]>({
    queryKey: ["oi", "my-entries", profile?.id],
    enabled: !!profile?.id && activeTab === "my",
    queryFn: () => listAllEntries(profile!.id, 100),
  });

  const myFactionsQuery = useQuery<FactionRow[]>({
    queryKey: ["factions", "user", profile?.id],
    enabled: !!profile?.id && activeTab === "my",
    queryFn: () => listUserFactions(profile!.id),
  });

  const sharedFactionQuery = useQuery<Array<{ oi_entry_id: string; faction_id: string }>>({
    queryKey: ["oi", "my-shared-factions", profile?.id],
    enabled: !!profile?.id && activeTab === "my" && (myFactionsQuery.data?.length ?? 0) > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("faction_shared_intelligence")
        .select("oi_entry_id, faction_id")
        .eq("user_id", profile!.id);
      if (error) throw error;
      return (data ?? []) as Array<{ oi_entry_id: string; faction_id: string }>;
    },
  });

  const myFactions = myFactionsQuery.data ?? [];

  const myExpandedEntries: MyExpandedEntry[] = useMemo(() => {
    const entries = myEntriesQuery.data ?? [];
    const sharedMap = sharedFactionQuery.data ?? [];
    return entries.map((entry) => ({
      entry,
      sharedFactionIds: sharedMap
        .filter((s) => s.oi_entry_id === entry.id)
        .map((s) => s.faction_id),
    }));
  }, [myEntriesQuery.data, sharedFactionQuery.data]);

  const refreshMyEntries = useCallback((): void => {
    queryClient.invalidateQueries({ queryKey: ["oi", "my-entries"] });
    queryClient.invalidateQueries({ queryKey: ["oi", "my-shared-factions"] });
  }, [queryClient]);

  const handleEditEntry = useCallback((entry: OpenIntelligenceRow): void => {
    setEditingEntry(entry);
    setEditModalVisible(true);
  }, []);

  const handleWithdrawEntry = useCallback((entry: OpenIntelligenceRow): void => {
    setWithdrawTarget(entry);
    setWithdrawConfirmVisible(true);
  }, []);

  const handleConfirmWithdraw = useCallback(async (): Promise<void> => {
    if (!withdrawTarget) return;
    setBusy(`withdraw:${withdrawTarget.id}`);
    setMyActionMsg(null);
    const result = await withdrawEntry(withdrawTarget.id);
    setBusy(null);
    if (result.ok) {
      h.success();
      setMyActionMsg("Entry withdrawn. It is no longer visible in analyst context.");
      refreshMyEntries();
    } else {
      setMyActionMsg(result.error ?? "Failed to withdraw entry.");
    }
    setWithdrawConfirmVisible(false);
    setWithdrawTarget(null);
  }, [withdrawTarget, h, refreshMyEntries]);

  const handleRestoreEntry = useCallback((entryId: string): void => {
    setRestoreTargetId(entryId);
    setRestoreConfirmVisible(true);
  }, []);

  const handleConfirmRestore = useCallback(async (): Promise<void> => {
    if (!restoreTargetId) return;
    setBusy(`restore:${restoreTargetId}`);
    setMyActionMsg(null);
    const result = await restoreEntry(restoreTargetId);
    setBusy(null);
    if (result.ok) {
      h.success();
      setMyActionMsg("Entry restored to Pending Review. Re-enable sharing manually.");
      refreshMyEntries();
    } else {
      setMyActionMsg(result.error ?? "Failed to restore entry.");
    }
    setRestoreConfirmVisible(false);
    setRestoreTargetId(null);
  }, [restoreTargetId, h, refreshMyEntries]);

  const handleToggleExchange = useCallback(async (entryId: string, enabled: boolean): Promise<void> => {
    setBusy(`exchange:${entryId}`);
    setMyActionMsg(null);
    const result = await toggleExchangeShare(entryId, enabled);
    setBusy(null);
    if (result.ok) {
      h.selection();
      setMyActionMsg(`Exchange sharing ${enabled ? "enabled" : "disabled"}.`);
      refreshMyEntries();
    } else {
      setMyActionMsg(result.error ?? "Exchange sharing could not be updated. Please try again.");
    }
  }, [h, refreshMyEntries]);

  const handleToggleFaction = useCallback(async (entryId: string, factionId: string, enabled: boolean): Promise<void> => {
    setBusy(`faction:${entryId}:${factionId}`);
    setMyActionMsg(null);
    const result = await toggleFactionShare(entryId, factionId, enabled);
    setBusy(null);
    if (result.ok) {
      h.selection();
      setMyActionMsg(`Faction sharing ${enabled ? "enabled" : "disabled"}.`);
      refreshMyEntries();
    } else {
      setMyActionMsg(result.error ?? "Failed to toggle faction sharing.");
    }
  }, [h, refreshMyEntries]);

  const handleShowVersions = useCallback((entryId: string): void => {
    setVersionEntryId(entryId);
    setVersionModalVisible(true);
  }, []);

  const handleAddCustomTag = useCallback((tag: string): void => {
    setCustomTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
  }, []);

  const handleRemoveCustomTag = useCallback((tag: string): void => {
    setCustomTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  const legacyTag = useMemo(() => {
    const all = [...selectedSubtags, ...customTags.map((t) => `custom:${t}`)];
    return all.join(", ") || "general";
  }, [selectedSubtags, customTags]);

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!selectedEagohId || !profile || !content.trim()) return;
    h.success();
    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);

    const result = await submitEntry({
      userId: profile.id,
      profile,
      eagohId: selectedEagohId,
      intelligenceDomain: selectedEagoh?.domain ?? "unknown",
      entryType,
      tag: legacyTag,
      content: content.trim(),
      confidenceLevel,
      selectedSubtags,
      customTags,
    });

    if (result.ok) {
      setContent("");
      setSelectedSubtags([]);
      setCustomTags([]);
      setSubmitSuccess(`Entry saved. ${result.edgeCost} Neurons deducted.`);
      queryClient.invalidateQueries({ queryKey: ["oi", "feed", selectedEagohId] });
      invalidateProfile();
    } else {
      setSubmitError(result.error ?? "Entry could not be saved. No Neurons were charged.");
      invalidateProfile();
    }
    setIsSubmitting(false);
  }, [selectedEagohId, profile, content, selectedEagoh, entryType, legacyTag, confidenceLevel, selectedSubtags, customTags, queryClient, invalidateProfile]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: pal.void }]} edges={["top"]}>
      {/* Header — fixed outside KAV */}
      <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>OPEN INTELLIGENCE</Text>
            <Text style={styles.title}>Observation Feed</Text>
          </View>
          {isAdmin ? (
            <Pressable
              onPress={() => { h.selection(); router.push("/moderation" as never); }}
              style={({ pressed }) => [styles.headerBadge, { borderColor: `${palette.gold}33`, backgroundColor: `${palette.gold}0A` }, pressed && styles.pressed]}
            >
              <ShieldAlert color={palette.gold} size={18} />
            </Pressable>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>

      {/* Tab Switcher */}
      <View style={styles.tabBar}>
        <Pressable
          onPress={() => { h.selection(); setActiveTab("add"); }}
          style={({ pressed }) => [
            styles.tabBtn,
            activeTab === "add" && styles.tabBtnActive,
            pressed && styles.pressed,
          ]}
        >
          <Plus color={activeTab === "add" ? palette.cyan : palette.muted} size={14} />
          <Text style={[styles.tabText, activeTab === "add" && { color: palette.cyan }]}>Add Intelligence</Text>
        </Pressable>
        <Pressable
          onPress={() => { h.selection(); setActiveTab("my"); }}
          style={({ pressed }) => [
            styles.tabBtn,
            activeTab === "my" && styles.tabBtnActive,
            pressed && styles.pressed,
          ]}
        >
          <ListChecks color={activeTab === "my" ? palette.cyan : palette.muted} size={14} />
          <Text style={[styles.tabText, activeTab === "my" && { color: palette.cyan }]}>My Intelligence</Text>
        </Pressable>
      </View>

      {activeTab === "my" ? (
        /* ── My Intelligence Tab ── */
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 50 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Summary */}
          <View style={styles.mySummaryRow}>
            <View style={styles.mySummaryItem}>
              <Text style={styles.mySummaryValue}>{myExpandedEntries.length}</Text>
              <Text style={styles.mySummaryLabel}>Total Entries</Text>
            </View>
            <View style={styles.mySummaryItem}>
              <Text style={[styles.mySummaryValue, { color: palette.cyan }]}>
                {myExpandedEntries.filter((e) => e.entry.exchange_share_enabled ?? false).length}
              </Text>
              <Text style={styles.mySummaryLabel}>Exchange Shared</Text>
            </View>
            <View style={styles.mySummaryItem}>
              <Text style={[styles.mySummaryValue, { color: palette.violet }]}>
                {myExpandedEntries.filter((e) => e.sharedFactionIds.length > 0).length}
              </Text>
              <Text style={styles.mySummaryLabel}>Faction Shared</Text>
            </View>
          </View>

          {myActionMsg ? (
            <View style={[styles.myActionMsgBox, { borderColor: `${myActionMsg.includes("Failed") ? palette.ember : palette.success}33` }]}>
              <Text style={[styles.myActionMsgText, { color: myActionMsg.includes("Failed") ? palette.ember : palette.success }]}>
                {myActionMsg}
              </Text>
            </View>
          ) : null}

          {myEntriesQuery.isLoading ? (
            <ActivityIndicator color={palette.cyan} size="large" style={{ paddingVertical: 40 }} />
          ) : myExpandedEntries.length === 0 ? (
            <View style={styles.myEmptyState}>
              <Activity color={palette.muted} size={32} />
              <Text style={styles.myEmptyTitle}>No Intelligence Entries</Text>
              <Text style={styles.myEmptyDesc}>
                Submit observations from the Add Intelligence tab to see them here.
              </Text>
            </View>
          ) : (
            <View style={styles.myEntriesList}>
              {myExpandedEntries.map((data) => (
                <MyEntryCard
                  key={data.entry.id}
                  data={data}
                  factions={myFactions}
                  onEdit={handleEditEntry}
                  onWithdraw={handleWithdrawEntry}
                  onRestore={handleRestoreEntry}
                  onToggleExchange={handleToggleExchange}
                  onToggleFaction={handleToggleFaction}
                  onShowVersions={handleShowVersions}
                  busy={busy}
                />
              ))}
            </View>
          )}
        </ScrollView>
      ) : (
        /* ── Add Intelligence Tab (original form) ── */
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          ref={scrollViewRef}
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: keyboardHeight > 0 ? keyboardHeight + 24 : 50 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onScroll={(e) => { scrollYRef.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
        >
          {/* EAGOH Selector */}
          <View style={styles.block}>
            <SectionTitle eyebrow="SELECT EAGOH" title="Choose the intelligence unit" />
            <EagohSelector eagohs={eagohs} selectedId={selectedEagohId} onSelect={setSelectedEagohId} />
          </View>

          {/* Domain Lock Banner */}
          {selectedEagoh && domain ? (
            <View style={[styles.domainBanner, { borderColor: `${domainTone}33`, backgroundColor: `${domainTone}0A` }]}>
              <BrainCircuit color={domainTone} size={14} />
              <View>
                <Text style={[styles.domainBannerTitle, { color: domainTone }]}>{domain.label}</Text>
                <Text style={styles.domainBannerDesc}>Entries are locked to this EAGOH's intelligence domain.</Text>
              </View>
            </View>
          ) : null}

          {/* Dev-only debug: current domain & loaded category labels */}
          {__DEV__ && selectedEagoh ? (
            <View style={styles.debugBanner}>
              <Text style={styles.debugLabel}>Current Domain: <Text style={styles.debugValue}>{currentDomain}</Text></Text>
              <Text style={styles.debugLabel}>Loaded Categories: <Text style={styles.debugValue}>{loadedCategoryLabels.join(", ") || "(none)"}</Text></Text>
            </View>
          ) : null}

          {/* Entry Type */}
          <View style={styles.block}>
            <SectionTitle eyebrow="ENTRY TYPE" title="Select observation depth" />
            <View style={styles.entryTypeList}>
              {entryTypes.map((et) => (
                <EntryTypeRow
                  key={et.id}
                  item={et}
                  selected={entryType === et.id}
                  onPress={() => setEntryType(et.id)}
                />
              ))}
            </View>
          </View>

          {/* Content Input */}
          <View style={styles.block}>
            <SectionTitle eyebrow="INTELLIGENCE" title="Enter your observation" />
            <TextInput
              ref={contentInputRef}
              value={content}
              onChangeText={(v) => setContent(v.slice(0, limit * 2))}
              onFocus={handleContentFocus}
              placeholder={`What did you observe? Max ${limit} chars excl. spaces…`}
              placeholderTextColor={palette.muted}
              multiline
              style={styles.contentInput}
              textAlignVertical="top"
            />
            <View style={styles.charRow}>
              <Text style={styles.charHint}>
                {entryType === "quick_observation" ? "Quick Observation" : entryType === "basic_deep_entry" ? "Basic Deep Entry" : "Advanced Deep Entry"}
              </Text>
              <Text style={[styles.charCount, charCountNoSpaces > limit && { color: palette.ember }]}>
                {charCountNoSpaces}/{limit} chars excl. spaces
              </Text>
            </View>
          </View>

          {/* Tag Selection */}
          <View style={styles.block}>
            <SectionTitle eyebrow="OBSERVATION TAGS" title="Classify the signal" />
            <TagSelector
              key={currentDomain}
              selectedSubtags={selectedSubtags}
              onToggleSubtag={handleToggleSubtag}
              customTags={customTags}
              onAddCustomTag={handleAddCustomTag}
              onRemoveCustomTag={handleRemoveCustomTag}
              domainId={currentDomain}
            />
          </View>

          {/* Confidence Level */}
          <View style={styles.block}>
            <SectionTitle eyebrow="CONFIDENCE" title="How certain are you?" />
            <ConfidencePicker selected={confidenceLevel} onSelect={setConfidenceLevel} />
          </View>

          {/* Quality Score Preview */}
          <View style={styles.block}>
            <SectionTitle eyebrow="QUALITY PREVIEW" title="Mock scoring analysis" />
            <ScorePreview
              content={content}
              entryType={entryType}
              confidenceLevel={confidenceLevel}
              tag={legacyTag}
              domainId={currentDomain}
            />
          </View>

          {/* Submit */}
          <View style={styles.submitSection}>
            {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}
            {submitSuccess ? <Text style={styles.successText}>{submitSuccess}</Text> : null}

            <View style={styles.submitRow}>
              <View style={styles.submitCost}>
                <Zap color={balances.total >= edgeCost ? palette.gold : palette.ember} size={16} />
                <Text style={[styles.submitCostText, balances.total < edgeCost && { color: palette.ember }]}>
                  {edgeCost} Neurons
                </Text>
              </View>
              <Pressable
                onPress={handleSubmit}
                disabled={!canSubmit}
                style={({ pressed }) => [
                  styles.submitButton,
                  !canSubmit && styles.disabledButton,
                  pressed && styles.pressed,
                ]}
              >
                <LinearGradient
                  colors={canSubmit ? [palette.cyan, "rgba(61,165,255,0.85)"] : ["rgba(255,255,255,0.08)", "rgba(255,255,255,0.04)"]}
                  style={StyleSheet.absoluteFill}
                />
                {isSubmitting ? (
                  <ActivityIndicator color={palette.void} />
                ) : (
                  <>
                    <Sparkles color={canSubmit ? palette.void : palette.muted} size={16} />
                    <Text style={[styles.submitText, !canSubmit && { color: palette.muted }]}>Submit Entry</Text>
                  </>
                )}
              </Pressable>
            </View>

            {balances.total < edgeCost ? (
              <Text style={styles.insufficientEdge}>
                Insufficient Neurons. Need {edgeCost} Neurons (have {balances.total}).
              </Text>
            ) : null}
          </View>

          {/* Learning Feed */}
          <View style={styles.feedSection}>
            <View style={styles.feedHeader}>
              <Activity color={palette.cyan} size={16} />
              <Text style={styles.feedTitle}>Learning Feed</Text>
              <Text style={styles.feedCount}>
                {feedQuery.data?.length ?? 0} entries
              </Text>
            </View>

            {feedQuery.isLoading ? (
              <ActivityIndicator color={palette.cyan} style={styles.feedLoader} />
            ) : feedQuery.data && feedQuery.data.length > 0 ? (
              feedQuery.data.map((entry) => (
                <LearningEntry key={entry.id} entry={entry} domainId={currentDomain} />
              ))
            ) : (
              <Text style={styles.feedEmpty}>
                {selectedEagoh ? `No entries for ${selectedEagoh.name} yet. Submit your first observation above.` : "Select an EAGOH and submit an entry to populate the feed."}
              </Text>
            )}
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
      )}

      {/* Edit Entry Modal */}
      <EditEntryModal
        visible={editModalVisible}
        entry={editingEntry}
        domainId={editingEntry ? normalizeDomainId(editingEntry.intelligence_domain ?? "sports") : "sports"}
        onClose={() => setEditModalVisible(false)}
        onSaved={refreshMyEntries}
      />

      {/* Version History Modal */}
      <VersionHistoryModal
        visible={versionModalVisible}
        entryId={versionEntryId}
        onClose={() => setVersionModalVisible(false)}
      />

      {/* Withdraw Confirmation */}
      <ConfirmDialog
        visible={withdrawConfirmVisible}
        title="Withdraw Entry?"
        message={
          "This entry will stop being used by analysts.\n" +
          "Faction sharing will be removed.\n" +
          "Exchange sharing will be disabled.\n" +
          "The entry will not be permanently deleted."
        }
        confirmLabel="Withdraw"
        confirmColor={palette.ember}
        onConfirm={handleConfirmWithdraw}
        onCancel={() => { setWithdrawConfirmVisible(false); setWithdrawTarget(null); }}
        busy={busy !== null}
      />

      {/* Restore Confirmation */}
      <ConfirmDialog
        visible={restoreConfirmVisible}
        title="Restore Entry?"
        message={
          "The entry returns to Pending Review.\n" +
          "Sharing must be manually enabled again."
        }
        confirmLabel="Restore"
        confirmColor={palette.success}
        onConfirm={handleConfirmRestore}
        onCancel={() => { setRestoreConfirmVisible(false); setRestoreTargetId(null); }}
        busy={busy !== null}
      />
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },
  kav: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
  },
  kicker: { color: palette.cyan, fontSize: 10, fontWeight: "900", letterSpacing: 2.2 },
  title: { color: palette.text, fontSize: 22, fontWeight: "900", letterSpacing: -0.5, marginTop: 2 },
  headerBadge: {
    width: 40,
    height: 40,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(108,230,255,0.30)",
    backgroundColor: "rgba(108,230,255,0.08)",
  },

  scroll: { flex: 1 },
  scrollContent: { padding: 14, paddingTop: 12, gap: 8 },

  block: { marginBottom: 8 },

  // Section titles
  sectionTitleWrap: { marginBottom: 6 },
  eyebrow: { color: palette.cyan, fontSize: 10, fontWeight: "900", letterSpacing: 1.8, textTransform: "uppercase" },
  sectionTitle: { color: palette.text, fontSize: 16, fontWeight: "900", letterSpacing: 0.3, marginTop: 1 },

  // EAGOH selector
  eagohCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 56,
    borderRadius: 5,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(10,20,35,0.55)",
  },
  eagohAvatar: {
    width: 40,
    height: 40,
    borderRadius: 5,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  eagohInfo: { flex: 1 },
  eagohName: { color: palette.text, fontSize: 14, fontWeight: "900" },
  eagohDomain: { fontSize: 11, fontWeight: "700", marginTop: 1 },
  dropdown: {
    marginTop: 4,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(8,16,28,0.95)",
    overflow: "hidden",
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  dropdownDot: { width: 8, height: 8, borderRadius: 4 },
  dropdownInfo: { flex: 1 },
  dropdownName: { color: palette.text, fontSize: 13, fontWeight: "800" },
  dropdownDomain: { color: palette.muted, fontSize: 10, marginTop: 1 },
  emptyText: { color: palette.muted, fontSize: 13, fontWeight: "700", textAlign: "center", paddingVertical: 20 },

  // Domain banner
  domainBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 10,
    borderRadius: 5,
    borderWidth: 1,
    marginBottom: 4,
  },
  domainBannerTitle: { fontSize: 12, fontWeight: "900" },
  domainBannerDesc: { color: palette.muted, fontSize: 10, lineHeight: 15, marginTop: 2 },

  // Debug banner (dev-only)
  debugBanner: {
    padding: 8,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "rgba(255,181,71,0.35)",
    backgroundColor: "rgba(255,181,71,0.06)",
    marginBottom: 4,
    gap: 2,
  },
  debugLabel: { color: palette.gold, fontSize: 10, fontWeight: "700" },
  debugValue: { color: palette.text, fontSize: 10, fontWeight: "900" },

  // Entry type
  entryTypeList: { gap: 4 },
  entryTypeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    borderRadius: 5,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  entryTypeCopy: { flex: 1 },
  entryTypeLabel: { color: palette.text, fontSize: 13, fontWeight: "800" },
  entryTypeDetail: { color: palette.muted, fontSize: 10, marginTop: 1 },
  entryTypeCost: { fontSize: 12, fontWeight: "900" },

  // Content input
  contentInput: {
    color: palette.text,
    fontSize: 13,
    fontWeight: "700",
    minHeight: 110,
    borderRadius: 5,
    padding: 12,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(10,18,30,0.50)",
  },
  charRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
  },
  charHint: { color: palette.muted, fontSize: 10, fontWeight: "700" },
  charCount: { fontSize: 11, fontWeight: "900", color: palette.text },

  // Tags — selected chips
  selectedTagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    marginBottom: 6,
  },
  selectedChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "rgba(108,230,255,0.35)",
    backgroundColor: "rgba(108,230,255,0.12)",
  },
  selectedChipText: { color: palette.cyan, fontSize: 11, fontWeight: "800" },

  // Search
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    minHeight: 38,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(255,255,255,0.03)",
    marginBottom: 6,
  },
  searchInput: {
    flex: 1,
    color: palette.text,
    fontSize: 12,
    fontWeight: "700",
    paddingVertical: 4,
  },
  searchResults: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    marginBottom: 8,
  },
  searchEmpty: {
    color: palette.muted,
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
    paddingVertical: 10,
    marginBottom: 8,
  },

  // Tags
  tagSection: { gap: 4 },
  tagCategory: { marginBottom: 4 },
  tagCategoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  tagCategoryLabel: { color: palette.text, fontSize: 12, fontWeight: "900", flex: 1 },
  categoryCount: { color: palette.cyan, fontSize: 11, fontWeight: "700" },
  tagGrid: { flexDirection: "row", flexWrap: "wrap", gap: 5, paddingLeft: 4 },
  tagChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  tagChipText: { color: palette.muted, fontSize: 11, fontWeight: "800" },
  tagEmptyState: {
    color: palette.muted,
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
    paddingVertical: 14,
    fontStyle: "italic",
  },
  customTagWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 4,
    marginTop: 4,
  },
  customTagInput: {
    flex: 1,
    color: palette.text,
    fontSize: 13,
    fontWeight: "700",
    minHeight: 40,
    borderRadius: 5,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 181, 71, 0.3)",
    backgroundColor: "rgba(255,181,71,0.06)",
  },
  customAddBtn: {
    width: 32,
    height: 32,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.gold,
  },
  customTagCount: {
    color: palette.gold,
    fontSize: 10,
    fontWeight: "800",
    textAlign: "right",
    marginTop: 4,
    paddingRight: 4,
  },

  // Confidence
  confidenceRow: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  confidenceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(255,255,255,0.03)",
    flexGrow: 1,
  },
  confidenceDot: { width: 7, height: 7, borderRadius: 4 },
  confidenceText: { color: palette.text, fontSize: 11, fontWeight: "800" },

  // Quality score
  scorePanel: {
    borderRadius: 5,
    padding: 12,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(10,18,30,0.50)",
    gap: 8,
  },
  scorePlaceholder: { color: palette.muted, fontSize: 12, fontWeight: "700" },
  scoreRow: { flexDirection: "row", gap: 10 },
  scoreItem: { flex: 1, gap: 6 },
  scoreLabel: { color: palette.muted, fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  progressTrack: { height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden" },
  progressFill: { height: 5, borderRadius: 3 },
  scoreValue: { fontSize: 16, fontWeight: "900" },
  scoreMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  scoreMetaText: { color: palette.muted, fontSize: 10, fontWeight: "700" },

  // Submit
  submitSection: { gap: 8, marginTop: 4 },
  submitRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  submitCost: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    minHeight: 48,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  submitCostText: { color: palette.gold, fontSize: 15, fontWeight: "900" },
  submitButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 5,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    shadowColor: palette.cyan,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  submitText: { color: palette.void, fontSize: 14, fontWeight: "900" },
  insufficientEdge: { color: palette.ember, fontSize: 11, fontWeight: "800", textAlign: "center" },

  // Feed
  feedSection: { marginTop: 14, gap: 8 },
  feedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
  },
  feedTitle: { color: palette.text, fontSize: 16, fontWeight: "900", flex: 1 },
  feedCount: { color: palette.muted, fontSize: 11, fontWeight: "800" },
  feedLoader: { paddingVertical: 20 },
  feedEmpty: { color: palette.muted, fontSize: 12, fontWeight: "700", textAlign: "center", paddingVertical: 18 },

  // Learning card
  learningCard: {
    borderRadius: 5,
    padding: 12,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(10,18,30,0.45)",
    gap: 6,
  },
  learningTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 4 },
  learningBadgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, flex: 1 },
  learningBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: "rgba(108,230,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(108,230,255,0.20)",
  },
  learningBadgeText: { color: palette.cyan, fontSize: 9, fontWeight: "900" },
  learningBadgeMore: { color: palette.muted, fontSize: 9, fontWeight: "700", alignSelf: "center" },
  learningMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  learningType: { color: palette.muted, fontSize: 10, fontWeight: "700" },
  learningDot: { color: palette.muted, fontSize: 8 },
  learningTime: { color: palette.muted, fontSize: 10, fontWeight: "700" },
  learningContent: { color: palette.text, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  learningScores: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.05)",
  },
  learningScoreItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  learningScoreLabel: { color: palette.muted, fontSize: 9, fontWeight: "700", textTransform: "uppercase" },
  learningScoreVal: { fontSize: 11, fontWeight: "900" },
  learningScoreDivider: { width: 1, height: 12, backgroundColor: palette.line },

  // General
  disabledButton: { opacity: 0.45 },
  pressed: { transform: [{ scale: 0.985 }], opacity: 0.88 },
  errorText: { color: palette.ember, fontSize: 11, fontWeight: "800", textAlign: "center" },
  successText: { color: palette.success, fontSize: 11, fontWeight: "800", textAlign: "center" },
  bottomSpacer: { height: 50 },

  // ── Tab Bar ──
  tabBar: {
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
  },
  tabBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  tabBtnActive: {
    borderColor: palette.cyan,
    backgroundColor: "rgba(108,230,255,0.08)",
  },
  tabText: { color: palette.muted, fontSize: 12, fontWeight: "900" },

  // ── My Intelligence: Summary ──
  mySummaryRow: {
    flexDirection: "row",
    gap: 8,
    padding: 14,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(10,20,38,0.45)",
  },
  mySummaryItem: { flex: 1, alignItems: "center", gap: 2 },
  mySummaryValue: { fontSize: 22, fontWeight: "900", color: palette.text },
  mySummaryLabel: { fontSize: 9, fontWeight: "700", color: palette.muted, textTransform: "uppercase", letterSpacing: 0.5 },

  // ── My Intelligence: Action Message ──
  myActionMsgBox: {
    padding: 10,
    borderRadius: 5,
    borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  myActionMsgText: { fontSize: 11, fontWeight: "800", textAlign: "center" },

  // ── My Intelligence: Entries List ──
  myEntriesList: { gap: 10 },
  myEntryCard: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(10,20,38,0.50)",
    padding: 12,
    gap: 8,
  },
  myEntryTopRow: { flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" },
  myEntryContent: { color: palette.text, fontSize: 12, fontWeight: "700", lineHeight: 18 },
  myExpandBtn: { alignSelf: "flex-start", paddingVertical: 2 },
  myExpandText: { color: palette.cyan, fontSize: 10, fontWeight: "800" },

  // Badges
  myBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, borderWidth: 1,
  },
  myBadgeText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  myWarnBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, borderWidth: 1,
    backgroundColor: "rgba(255,77,109,0.06)",
  },
  myWarnText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },

  // Meta grid
  myMetaGrid: {
    flexDirection: "row", flexWrap: "wrap", gap: 6,
    paddingTop: 6, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.05)",
  },
  myMetaItem: { width: "48%", gap: 1 },
  myMetaLabel: { fontSize: 8, fontWeight: "700", color: palette.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  myMetaValue: { fontSize: 11, fontWeight: "800", color: palette.text },

  // Share pills
  myShareRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  mySharePill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  mySharePillText: { fontSize: 9, fontWeight: "800" },

  // Actions
  myActionsRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  myActionBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4, borderWidth: 1,
    borderColor: palette.line, backgroundColor: "rgba(255,255,255,0.03)",
    minHeight: 32,
  },
  myActionText: { fontSize: 10, fontWeight: "800" },

  // Sharing toggles
  mySharingSection: {
    gap: 4, paddingTop: 8, marginTop: 4,
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.05)",
  },
  myToggleRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 8, paddingHorizontal: 4,
  },
  myToggleLabel: { flex: 1, color: palette.text, fontSize: 12, fontWeight: "800" },
  myToggleSwitch: {
    width: 34, height: 18, borderRadius: 9,
    borderWidth: 1, borderColor: palette.line,
    backgroundColor: "rgba(255,255,255,0.06)",
    justifyContent: "center",
  },
  myToggleKnob: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: palette.text,
    marginLeft: 2,
  },

  myFactionList: { paddingLeft: 20, gap: 2 },
  myFactionItem: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 6, paddingHorizontal: 4,
  },
  myFactionName: { flex: 1, color: palette.text, fontSize: 11, fontWeight: "700" },

  // Empty state
  myEmptyState: { alignItems: "center", paddingVertical: 50, gap: 8 },
  myEmptyTitle: { color: palette.text, fontSize: 16, fontWeight: "900" },
  myEmptyDesc: { color: palette.muted, fontSize: 12, fontWeight: "700", textAlign: "center", lineHeight: 18 },

  // ── Modal (shared) ──
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(2,4,10,0.80)" },
  modalSheet: {
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    maxHeight: "85%", minHeight: "50%", overflow: "hidden",
  },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.15)", alignSelf: "center", marginTop: 8 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  modalTitle: { color: palette.text, fontSize: 17, fontWeight: "900" },
  modalCloseBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  modalScroll: { flex: 1 },
  modalBody: { padding: 16, paddingTop: 4, paddingBottom: 40 },
  sectionLabel: { color: palette.cyan, fontSize: 10, fontWeight: "900", letterSpacing: 1.5, marginBottom: 6, textTransform: "uppercase" },

  // Edit modal
  modalContentInput: {
    color: palette.text, fontSize: 13, fontWeight: "700",
    minHeight: 100, borderRadius: 5, padding: 12,
    borderWidth: 1, borderColor: palette.line,
    backgroundColor: "rgba(10,18,30,0.50)",
  },
  modalConfidenceRow: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  modalConfidenceChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4, borderWidth: 1,
    borderColor: palette.line, backgroundColor: "rgba(255,255,255,0.03)",
  },
  modalConfidenceText: { fontSize: 10, fontWeight: "800", color: palette.muted },

  modalCatRow: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  modalCatChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4, borderWidth: 1,
    borderColor: palette.line, backgroundColor: "rgba(255,255,255,0.03)",
  },
  modalCatText: { fontSize: 10, fontWeight: "800", color: palette.muted },

  modalTagCat: { marginBottom: 4 },
  modalTagCatHeader: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 8, paddingHorizontal: 4,
  },
  modalTagCatLabel: { color: palette.text, fontSize: 12, fontWeight: "900", flex: 1 },

  modalNotice: {
    color: palette.muted, fontSize: 10, fontWeight: "700",
    lineHeight: 15, marginTop: 10, padding: 8, borderRadius: 4,
    backgroundColor: "rgba(255,181,71,0.06)",
  },
  modalResultBox: { marginTop: 12, padding: 10, borderRadius: 5, borderWidth: 1, backgroundColor: "rgba(255,255,255,0.03)" },
  modalResultText: { fontSize: 12, fontWeight: "800" },

  modalSubmitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, borderRadius: 6, paddingVertical: 12, marginTop: 16,
    backgroundColor: palette.cyan,
  },
  modalSubmitText: { color: palette.void, fontSize: 14, fontWeight: "900" },

  // Version history
  versionItem: {
    borderRadius: 5, borderWidth: 1, borderColor: palette.line,
    backgroundColor: "rgba(10,20,38,0.45)", padding: 10, marginBottom: 8, gap: 4,
  },
  versionHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  versionBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, borderWidth: 1 },
  versionBadgeText: { fontSize: 10, fontWeight: "900" },
  versionChangeType: { fontSize: 11, fontWeight: "800", color: palette.text, flex: 1 },
  versionDate: { fontSize: 10, fontWeight: "700", color: palette.muted },
  versionContent: { color: palette.text, fontSize: 11, fontWeight: "600", lineHeight: 16 },
  versionNoContent: { color: palette.muted, fontSize: 10, fontWeight: "700", fontStyle: "italic" },
  versionMetaText: { fontSize: 9, fontWeight: "700", color: palette.muted },

  modalErrorText: { color: palette.ember, fontSize: 12, fontWeight: "800", textAlign: "center", paddingVertical: 20 },
  modalEmptyText: { color: palette.muted, fontSize: 12, fontWeight: "700", textAlign: "center", paddingVertical: 20 },

  // Confirm dialog
  confirmSheet: {
    borderRadius: 12,
    padding: 20,
    marginHorizontal: 20,
    overflow: "hidden",
  },
  confirmTitle: { color: palette.text, fontSize: 18, fontWeight: "900", marginBottom: 8 },
  confirmMessage: { color: palette.muted, fontSize: 13, fontWeight: "700", lineHeight: 20, marginBottom: 16 },
  confirmBtnRow: { flexDirection: "row", gap: 10 },
  confirmCancelBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 6, borderWidth: 1,
    borderColor: palette.line, alignItems: "center", justifyContent: "center",
  },
  confirmCancelText: { color: palette.muted, fontSize: 14, fontWeight: "800" },
  confirmActionBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 6,
    alignItems: "center", justifyContent: "center",
  },
  confirmActionText: { color: palette.void, fontSize: 14, fontWeight: "900" },
});
