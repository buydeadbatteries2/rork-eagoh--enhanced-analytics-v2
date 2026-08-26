/**
 * PurchaseSyncModal — shared Exchange purchase-sync modal.
 *
 * Extracted from marketplace.tsx so both the Exchange listing cards and the
 * public-listing screen (reached via sponsored EAGOH banner taps) use the
 * exact same purchase flow, percentages, durations, EC cost, ownership checks,
 * and purchase endpoint.
 *
 * Single implementation — no duplicate purchase logic.
 */

import { palette } from "@/constants/colors";
import { LinearGradient } from "expo-linear-gradient";
import {
  ArrowRightLeft,
  Award,
  BookOpen,
  Clock,
  Coins,
  Crown,
  Dna,
  Info,
  ScrollText,
  Shield,
  Signal,
  Sparkles,
  Star,
  Tag,
  UserCheck,
  X,
} from "lucide-react-native";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { OptimizedEagohImage } from "@/app/_components/PerformancePrimitives";
import SocialVerifiedBadge from "@/app/_components/SocialVerifiedBadge";
import { getTeamById } from "@/data/teams";
import {
  computeTotalCost,
  resolveMarketplaceEagohImage,
  type EnrichedListing,
  type SyncLevel,
} from "@/services/marketplace";
import type { EagohRecord } from "@/services/eagohs";
import {
  getPublicEagohCredentials,
  type EagohCredentialsRow,
} from "@/services/eagohCredentials";
import {
  getBulkReputations,
  rankColor as repRankColor,
  RANK_TIERS,
  type RankTier,
  type ReputationRow,
} from "@/services/reputation";
import { getSocialVerificationState } from "@/services/socialVerification";

// ── Constants ────────────────────────────────────────────────────────────

const SYNC_LEVELS: SyncLevel[] = ["25%", "50%", "75%", "100%"];
const DAYS = [1, 2, 3, 4, 5];

const SYNC_DESCRIPTIONS: Record<SyncLevel, string> = {
  "25%": "Basic surface-level intelligence signals",
  "50%": "Moderate depth analysis patterns",
  "75%": "Advanced analytical framework access",
  "100%": "Full intelligence model synchronization",
};

// ── Helpers ──────────────────────────────────────────────────────────────

function domainLabel(d: string): string {
  return d.charAt(0).toUpperCase() + d.slice(1).replace(/_/g, " ");
}

function rankEmoji(rank: string): string {
  if (rank === "Syndicate Prime") return "★";
  if (rank === "Oracle") return "◆";
  if (rank === "Diamond") return "◇";
  if (rank === "Platinum") return "●";
  if (rank === "Gold") return "⬡";
  return "";
}

function rankColor(rank: string): string {
  if (RANK_TIERS.includes(rank as RankTier)) return repRankColor(rank as RankTier);
  switch (rank) {
    case "S-TIER": return palette.gold;
    case "ELITE": return palette.cyan;
    case "PRO": return palette.violet;
    case "RISING": return palette.success;
    default: return palette.muted;
  }
}

// ── Domain DNA cleaning helpers ──────────────────────────────────────────

const DOMAIN_FIELD_LABELS: Record<string, string> = {
  music_genre: "Genre",
  music_role: "Role",
  film_tv_category: "Category",
  film_tv_genre: "Genre",
  film_tv_role: "Role",
  fashion_style_category: "Style",
  fashion_role: "Role",
  education_subject: "Subject",
  education_role: "Role",
  gaming_genre: "Genre",
  gaming_role: "Role",
  business_industry: "Industry",
  business_role: "Role",
  finance_focus: "Focus",
  finance_role: "Role",
  technology_area: "Area",
  technology_role: "Role",
  health_fitness_area: "Area",
  health_fitness_role: "Role",
};

function toTitleCase(str: string): string {
  return str
    .replace(/_/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function cleanDomainValue(entry: string): string | null {
  if (!entry.startsWith("dom:")) return null;
  const rest = entry.slice(4);
  const colonIdx = rest.indexOf(":");
  if (colonIdx <= 0) return null;
  return toTitleCase(rest.slice(colonIdx + 1));
}

function domainFieldKey(entry: string): string | null {
  if (!entry.startsWith("dom:")) return null;
  const rest = entry.slice(4);
  const colonIdx = rest.indexOf(":");
  if (colonIdx <= 0) return null;
  return rest.slice(0, colonIdx);
}

type CleanedKnowledgeAttr = { label: string; value: string };

function parseKnowledgeAttributes(
  dna: string[] | undefined | null,
  maxDisplay: number = 2,
): { attrs: CleanedKnowledgeAttr[]; archetypeTags: string[]; remainingCount: number } {
  if (!dna || dna.length === 0) {
    return { attrs: [], archetypeTags: [], remainingCount: 0 };
  }
  const attrs: CleanedKnowledgeAttr[] = [];
  const archetypeTags: string[] = [];
  for (const entry of dna) {
    if (entry.startsWith("dom:")) {
      const key = domainFieldKey(entry);
      const value = cleanDomainValue(entry);
      if (key && value) {
        const label = DOMAIN_FIELD_LABELS[key] ?? toTitleCase(key.replace(/_role$/, "").replace(/_genre$/, "").replace(/_category$/, ""));
        attrs.push({ label, value });
      }
    } else {
      archetypeTags.push(entry);
    }
  }
  const remainingCount = Math.max(0, attrs.length - maxDisplay);
  return { attrs: attrs.slice(0, maxDisplay), archetypeTags, remainingCount };
}

// ── Types ────────────────────────────────────────────────────────────────

export type PurchaseSyncModalProps = {
  visible: boolean;
  listing: EnrichedListing | null;
  /** Informational only: the EAGOH the purchase will be attributed to. The
   *  Worker remains authoritative on eligibility and domain. */
  buyerInfo?: { name: string; domain: string } | null;
  /** Compact buyer-EAGOH selector options — shown only when multiple
   *  same-domain EAGOHs are eligible, so the user chooses which one is
   *  purchasing before confirmation. */
  buyerOptions?: Array<{ id: string; name: string }>;
  selectedBuyerEagohId?: string | null;
  onSelectBuyerEagoh?: (id: string) => void;
  onClose: () => void;
  onConfirm: (level: SyncLevel, days: number) => void;
  showSourceInfo: boolean;
  onToggleSourceInfo: () => void;
  purchasing: boolean;
  reputation: ReputationRow | undefined;
  onViewVendorProfile: (vendorId: string) => void;
};

// ── Component ────────────────────────────────────────────────────────────

export default function PurchaseSyncModal({
  visible,
  listing,
  buyerInfo,
  buyerOptions,
  selectedBuyerEagohId,
  onSelectBuyerEagoh,
  onClose,
  onConfirm,
  showSourceInfo,
  onToggleSourceInfo,
  purchasing,
  reputation,
  onViewVendorProfile,
}: PurchaseSyncModalProps): JSX.Element {
  const [selectedLevel, setSelectedLevel] = useState<SyncLevel>("25%");
  const [selectedDays, setSelectedDays] = useState<number>(1);

  const [credentials, setCredentials] = useState<EagohCredentialsRow | null>(null);
  const [loadingCredentials, setLoadingCredentials] = useState(false);

  useEffect(() => {
    setSelectedLevel("25%");
    setSelectedDays(1);
  }, [listing?.id]);

  useEffect(() => {
    if (showSourceInfo && listing) {
      setCredentials(null);
      setLoadingCredentials(true);
      let cancelled = false;
      getPublicEagohCredentials(listing.eagoh_id)
        .then((row) => { if (!cancelled) { setCredentials(row); setLoadingCredentials(false); } })
        .catch(() => { if (!cancelled) setLoadingCredentials(false); });
      return () => { cancelled = true; };
    }
  }, [showSourceInfo, listing?.eagoh_id]);

  if (!listing) return <></>;

  const eagoh = listing.eagoh;
  const totalCost = computeTotalCost(listing, selectedLevel, selectedDays);
  const imageUrl = resolveMarketplaceEagohImage(eagoh);

  const eagohRank: RankTier = (reputation?.rank as RankTier) ?? "Dormant";
  const rkColor = rankColor(eagohRank);
  const repScore = reputation?.reputation_score ?? 0;
  const detailKnowledgeAttrs = parseKnowledgeAttributes(eagoh?.dna, 99);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay} pointerEvents="box-none">
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />

        {/* ── Main Purchase Sheet ── */}
        <View style={styles.modalSheet}>
          <LinearGradient colors={["#0A1628", "#050D18"]} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Purchase Sync</Text>
            <Pressable onPress={onClose} style={styles.modalClose}>
              <X color={palette.muted} size={20} />
            </Pressable>
          </View>

          {/* EAGOH preview */}
          <View style={styles.modalEagohPreview}>
            <View style={styles.modalEagohImage}>
              <OptimizedEagohImage tone="cyan" label={eagoh?.name ?? "EAGOH"} size="banner" imageUrl={imageUrl} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.modalEagohNameRow}>
                <Text style={styles.modalEagohName}>{eagoh?.name}</Text>
                <Pressable
                  onPress={onToggleSourceInfo}
                  style={({ pressed }) => [
                    styles.infoIconBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Info color={palette.muted} size={16} />
                </Pressable>
              </View>
              <Text style={styles.modalEagohDomain}>{domainLabel(eagoh?.domain ?? eagoh?.sport ?? "")}</Text>
              <Pressable
                onPress={() => onViewVendorProfile(listing.vendor_id)}
                accessibilityLabel={`Open vendor profile for ${listing.vendor_username ?? "Anonymous"}`}
                accessibilityRole="link"
                style={({ pressed }) => [pressed && { opacity: 0.7 }]}
              >
                <Text style={[styles.modalVendor, { textDecorationLine: "underline" as const }]}>
                  by {listing.vendor_username ?? "Anonymous"}
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Phase D2: informational buyer line — the Worker is authoritative */}
          {buyerInfo && (
            <View style={styles.modalBuyerLine}>
              <UserCheck color={palette.cyan} size={13} />
              <Text style={styles.modalBuyerText} numberOfLines={1}>
                Purchasing for: {buyerInfo.name} · {domainLabel(buyerInfo.domain)}
              </Text>
            </View>
          )}

          {/* Phase D2.1: compact buyer selector when multiple same-domain
              EAGOHs are eligible — the user must choose which one purchases. */}
          {buyerOptions && buyerOptions.length > 1 && onSelectBuyerEagoh && (
            <View style={styles.modalBuyerSelectWrap}>
              <Text style={styles.modalBuyerSelectLabel}>
                {selectedBuyerEagohId ? "Purchasing as" : "Which EAGOH is purchasing?"}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.modalBuyerChipRail}
              >
                {buyerOptions.map((option) => {
                  const active = option.id === (selectedBuyerEagohId ?? "");
                  return (
                    <Pressable
                      key={option.id}
                      onPress={() => onSelectBuyerEagoh(option.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Purchase as ${option.name}`}
                      accessibilityState={{ selected: active }}
                      style={({ pressed }) => [
                        styles.modalBuyerChip,
                        active && styles.modalBuyerChipActive,
                        pressed && { opacity: 0.8 },
                      ]}
                    >
                      <Text
                        style={[styles.modalBuyerChipText, active && styles.modalBuyerChipTextActive]}
                        numberOfLines={1}
                      >
                        {option.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Sync level */}
          <Text style={styles.modalSectionLabel}>Sync Level</Text>
          <Text style={styles.modalSectionDesc}>{SYNC_DESCRIPTIONS[selectedLevel]}</Text>
          <View style={styles.syncLevelGrid}>
            {SYNC_LEVELS.map((level) => {
              const price = (level === "25%" ? listing.price_25_per_day : level === "50%" ? listing.price_50_per_day : level === "75%" ? listing.price_75_per_day : listing.price_100_per_day);
              const disabled = price <= 0;
              return (
                <Pressable
                  key={level}
                  onPress={() => !disabled && setSelectedLevel(level)}
                  style={[
                    styles.syncLevelChip,
                    selectedLevel === level && styles.syncLevelChipActive,
                    disabled && styles.syncLevelChipDisabled,
                  ]}
                >
                  <Text style={[styles.syncLevelText, selectedLevel === level && styles.syncLevelTextActive, disabled && styles.syncLevelTextDisabled]}>
                    {level}
                  </Text>
                  <Text style={[styles.syncLevelPrice, selectedLevel === level && styles.syncLevelPriceActive]}>
                    {disabled ? "—" : `${price} EC`}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Duration */}
          <Text style={styles.modalSectionLabel}>Duration (Days)</Text>
          <View style={styles.daysRow}>
            {DAYS.map((day) => (
              <Pressable
                key={day}
                onPress={() => setSelectedDays(day)}
                style={[styles.dayChip, selectedDays === day && styles.dayChipActive]}
              >
                <Text style={[styles.dayChipText, selectedDays === day && styles.dayChipTextActive]}>{day}</Text>
              </Pressable>
            ))}
          </View>

          {/* Total */}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Cost</Text>
            <View style={styles.totalValueRow}>
              <Coins color={palette.gold} size={18} />
              <Text style={styles.totalValue}>{totalCost} EC</Text>
            </View>
          </View>
          <Text style={styles.totalBreakdown}>
            {selectedLevel} sync × {selectedDays} day{selectedDays > 1 ? "s" : ""}
          </Text>

          {/* Retention short notice */}
          <View style={styles.retentionNoticeRow}>
            <Info color={palette.muted} size={11} />
            <Text style={styles.retentionNoticeText}>
              Retained Intelligence is limited to 25% per vendor EAGOH.
            </Text>
          </View>

          {/* Confirm */}
          <Pressable
            onPress={() => onConfirm(selectedLevel, selectedDays)}
            disabled={purchasing || totalCost <= 0}
            style={({ pressed }) => [
              styles.confirmButton,
              (purchasing || totalCost <= 0) && styles.confirmButtonDisabled,
              pressed && styles.pressed,
            ]}
          >
            {purchasing ? (
              <ActivityIndicator color={palette.void} size="small" />
            ) : (
              <>
                <ArrowRightLeft color={palette.void} size={17} />
                <Text style={styles.confirmButtonText}>Confirm Purchase</Text>
              </>
            )}
          </Pressable>
        </View>

        {/* ── Source Info Overlay (renders on top of Purchase Sheet) ── */}
        {showSourceInfo && (
          <View style={styles.sourceInfoOverlayAbsolute}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={onToggleSourceInfo}
            />
            <View style={styles.infoContainerAbsolute}>
              <LinearGradient colors={["#0A1628", "#050D18"]} style={StyleSheet.absoluteFill} pointerEvents="none" />

              <View style={styles.infoHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <BookOpen color={palette.cyan} size={18} />
                  <Text style={styles.infoHeaderTitle}>Source Info</Text>
                </View>
                <Pressable onPress={onToggleSourceInfo} style={styles.modalClose}>
                  <X color={palette.muted} size={20} />
                </Pressable>
              </View>

              <ScrollView
                style={styles.infoBody}
                contentContainerStyle={styles.infoBodyContent}
                showsVerticalScrollIndicator
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.infoEagohPreview}>
                  <View style={styles.modalEagohImage}>
                    <OptimizedEagohImage tone="cyan" label={eagoh?.name ?? "EAGOH"} size="banner" imageUrl={imageUrl} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalEagohName}>{eagoh?.name}</Text>
                    <Text style={styles.modalEagohDomain}>{domainLabel(eagoh?.domain ?? eagoh?.sport ?? "")}</Text>
                    <Text style={styles.modalVendor}>by {listing.vendor_username ?? "Anonymous"}</Text>
                    {(() => {
                      const vState = getSocialVerificationState({
                        verified_share_count: listing.vendor_verified_share_count,
                        is_social_verified: listing.is_vendor_verified,
                      });
                      return vState.isVerified ? (
                        <View style={{ marginTop: 2 }}>
                          <SocialVerifiedBadge
                            isVerified={vState.isVerified}
                            variant="compact"
                            badgeName={vState.badgeName}
                          />
                        </View>
                      ) : null;
                    })()}
                  </View>
                </View>

                <View style={styles.infoDivider} />

                <View style={styles.detailRow}>
                  <View style={styles.detailIconWrap}>
                    <Award color={palette.gold} size={14} />
                  </View>
                  <Text style={styles.detailLabel}>Reputation</Text>
                  <Text style={[styles.detailValue, { color: rkColor }]}>
                    {rankEmoji(eagohRank)} {eagohRank} {repScore > 0 ? `· ${repScore}` : ""}
                  </Text>
                </View>

                <View style={styles.detailRow}>
                  <View style={styles.detailIconWrap}>
                    <Signal color={palette.success} size={14} />
                  </View>
                  <Text style={styles.detailLabel}>Sync Success</Text>
                  <Text style={styles.detailValue}>{listing.sync_success_score}</Text>
                </View>

                <View style={styles.detailRow}>
                  <View style={styles.detailIconWrap}>
                    <Sparkles color={palette.cyan} size={14} />
                  </View>
                  <Text style={styles.detailLabel}>Quality Score</Text>
                  <Text style={styles.detailValue}>{listing.avg_quality_score}</Text>
                </View>

                <View style={styles.detailRow}>
                  <View style={styles.detailIconWrap}>
                    <Coins color={palette.gold} size={14} />
                  </View>
                  <Text style={styles.detailLabel}>Neurons Earned</Text>
                  <Text style={styles.detailValue}>{listing.edge_earned_this_month} EC/mo</Text>
                </View>

                <View style={styles.detailRow}>
                  <View style={styles.detailIconWrap}>
                    <Crown color={palette.violet} size={14} />
                  </View>
                  <Text style={styles.detailLabel}>Vendor Rank</Text>
                  <Text style={styles.detailValue}>{listing.vendor_rank}</Text>
                </View>

                {reputation && (
                  <View style={styles.detailRow}>
                    <View style={styles.detailIconWrap}>
                      <Shield color={rkColor} size={14} />
                    </View>
                    <Text style={styles.detailLabel}>Market Trust</Text>
                    <Text style={[styles.detailValue, { color: rkColor }]}>{reputation.marketplace_trust}</Text>
                  </View>
                )}

                {(detailKnowledgeAttrs.archetypeTags.length > 0 || detailKnowledgeAttrs.attrs.length > 0) && (
                  <View style={styles.detailRowCol}>
                    <View style={styles.detailIconWrap}>
                      <Dna color={palette.violet} size={14} />
                    </View>
                    <Text style={styles.detailLabel}>DNA</Text>
                    <View style={styles.detailDnaWrap}>
                      {detailKnowledgeAttrs.archetypeTags.map((d) => (
                        <View key={d} style={styles.detailDnaTag}>
                          <Text style={styles.detailDnaTagText}>{d}</Text>
                        </View>
                      ))}
                      {detailKnowledgeAttrs.attrs.map((attr) => (
                        <View key={attr.label + attr.value} style={styles.detailDnaTag}>
                          <Text style={styles.detailDnaTagText}>{attr.value}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {(eagoh?.pro_team_focus_name || eagoh?.college_team_focus_name || listing.fanatic_teams.length > 0) && (
                  <View style={styles.detailRow}>
                    <View style={styles.detailIconWrap}>
                      <Star color={palette.gold} size={14} />
                    </View>
                    <Text style={styles.detailLabel}>Teams</Text>
                    <Text style={styles.detailValue} numberOfLines={3}>
                      {[
                        eagoh?.pro_team_focus_name,
                        eagoh?.college_team_focus_name,
                        ...listing.fanatic_teams.map((id: string) => getTeamById(id)?.display_name ?? id),
                      ].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                )}

                {(credentials || listing.has_credentials || loadingCredentials) && (
                  <View style={styles.infoDivider} />
                )}

                <View style={styles.infoDivider} />
                <View style={styles.retentionDisclaimerSection}>
                  <View style={styles.retentionDisclaimerHeader}>
                    <Sparkles color={palette.cyan} size={13} />
                    <Text style={styles.retentionDisclaimerTitle}>Retained Exchange Intelligence</Text>
                  </View>
                  <Text style={styles.retentionDisclaimerBody}>
                    Each completed purchase may permanently add a limited selection of the purchased EAGOH's Open Intelligence to your private Retained Exchange Intelligence library. The retained amount is approximately 2% of the intelligence included with each purchase. You may retain no more than 25% of any individual vendor EAGOH's eligible Open Intelligence. Once that limit is reached, future purchases will still provide the purchased temporary access but will not add more retained entries.
                  </Text>
                  <Text style={styles.retentionDisclaimerFootnote}>
                    Retained entries are read-only, vendor-attributed, private, and cannot be resold, shared with Factions, or listed on the Exchange.
                  </Text>
                </View>

                {(credentials || listing.has_credentials || loadingCredentials) && (
                  <View style={styles.sourceCredentialsSection}>
                    <View style={styles.sourceCredentialsHeader}>
                      <BookOpen color={palette.cyan} size={13} />
                      <Text style={styles.sourceCredentialsTitle}>Source Credentials</Text>
                    </View>
                    <LinearGradient colors={["rgba(0,20,40,0.55)", "rgba(5,15,30,0.70)"]} style={StyleSheet.absoluteFill} />
                    {loadingCredentials ? (
                      <View style={{ padding: 16, alignItems: "center" }}>
                        <ActivityIndicator color={palette.cyan} size="small" />
                      </View>
                    ) : credentials ? (
                      <View style={styles.sourceCredentialsBody}>
                        <View style={styles.sourceCredRow}>
                          <View style={styles.detailIconWrap}>
                            <UserCheck color={palette.muted} size={12} />
                          </View>
                          <Text style={styles.detailLabel}>Vendor</Text>
                          <Text style={styles.detailValue}>{listing.vendor_username ?? "Anonymous"}</Text>
                        </View>
                        {credentials.public_title ? (
                          <View style={styles.sourceCredRow}>
                            <View style={styles.detailIconWrap}>
                              <Award color={palette.cyan} size={12} />
                            </View>
                            <Text style={styles.detailLabel}>Title</Text>
                            <Text style={styles.detailValue}>{credentials.public_title}</Text>
                          </View>
                        ) : null}
                        {credentials.domain_expertise ? (
                          <View style={styles.sourceCredRow}>
                            <View style={styles.detailIconWrap}>
                              <ScrollText color={palette.cyan} size={12} />
                            </View>
                            <Text style={styles.detailLabel}>Expertise</Text>
                            <Text style={styles.detailValue}>{credentials.domain_expertise}</Text>
                          </View>
                        ) : null}
                        {credentials.experience_summary ? (
                          <View style={styles.sourceCredRowCol}>
                            <View style={styles.detailIconWrap}>
                              <BookOpen color={palette.cyan} size={12} />
                            </View>
                            <Text style={styles.detailLabel}>Experience</Text>
                            <Text style={styles.sourceCredBodyText} numberOfLines={10}>
                              {credentials.experience_summary}
                            </Text>
                          </View>
                        ) : null}
                        {credentials.accolades ? (
                          <View style={styles.sourceCredRowCol}>
                            <View style={styles.detailIconWrap}>
                              <Star color={palette.gold} size={12} />
                            </View>
                            <Text style={styles.detailLabel}>Achievements</Text>
                            <Text style={styles.sourceCredBodyText} numberOfLines={6}>
                              {credentials.accolades}
                            </Text>
                          </View>
                        ) : null}
                        {credentials.years_experience ? (
                          <View style={styles.sourceCredRow}>
                            <View style={styles.detailIconWrap}>
                              <Clock color={palette.muted} size={12} />
                            </View>
                            <Text style={styles.detailLabel}>Years</Text>
                            <Text style={styles.detailValue}>{credentials.years_experience} years</Text>
                          </View>
                        ) : null}
                        {credentials.credibility_tags && credentials.credibility_tags.length > 0 ? (
                          <View style={styles.sourceCredRowCol}>
                            <View style={styles.detailIconWrap}>
                              <Tag color={palette.cyan} size={12} />
                            </View>
                            <Text style={styles.detailLabel}>Tags</Text>
                            <View style={styles.detailDnaWrap}>
                              {credentials.credibility_tags.map((tag: string) => (
                                <View key={tag} style={styles.detailDnaTag}>
                                  <Text style={styles.detailDnaTagText}>{tag}</Text>
                                </View>
                              ))}
                            </View>
                          </View>
                        ) : null}
                      </View>
                    ) : listing.has_credentials ? (
                      <View style={styles.sourceCredentialsBody}>
                        <Text style={styles.sourceCredPlaceholder}>
                          No source credentials have been added for this EAGOH yet.
                        </Text>
                      </View>
                    ) : null}
                  </View>
                )}
              </ScrollView>

              <View style={styles.infoFooter}>
                <Pressable
                  onPress={onToggleSourceInfo}
                  style={({ pressed }) => [
                    styles.confirmButton,
                    { marginTop: 0 },
                    pressed && styles.pressed,
                  ]}
                >
                  <X color={palette.void} size={17} />
                  <Text style={styles.confirmButtonText}>Close</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────

const SCREEN_HEIGHT = Dimensions.get("window").height;

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    maxHeight: "85%",
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    overflow: "hidden",
    padding: 18,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.line,
    alignSelf: "center",
    marginBottom: 16,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  modalTitle: { color: palette.text, fontSize: 20, fontWeight: "900" },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  modalSectionLabel: { color: palette.muted, fontSize: 11, fontWeight: "900", letterSpacing: 1, marginBottom: 4, marginTop: 12 },
  modalBuyerLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(34,211,238,0.08)",
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.25)",
  },
  modalBuyerText: { color: palette.cyan, fontSize: 11, fontWeight: "700", letterSpacing: 0.3, flexShrink: 1 },
  modalBuyerSelectWrap: { marginTop: 8 },
  modalBuyerSelectLabel: { color: palette.muted, fontSize: 10, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 },
  modalBuyerChipRail: { gap: 6, paddingRight: 12 },
  modalBuyerChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    backgroundColor: "rgba(148,163,184,0.08)",
    maxWidth: 160,
  },
  modalBuyerChipActive: {
    borderColor: palette.cyan,
    backgroundColor: "rgba(34,211,238,0.16)",
  },
  modalBuyerChipText: { color: palette.text, fontSize: 11, fontWeight: "700" },
  modalBuyerChipTextActive: { color: palette.cyan },
  modalSectionDesc: { color: palette.text, fontSize: 12, fontWeight: "700", marginBottom: 8, lineHeight: 17 },

  sourceInfoOverlayAbsolute: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
    zIndex: 10,
  },
  infoContainerAbsolute: {
    width: "100%",
    maxHeight: SCREEN_HEIGHT * 0.80,
    borderRadius: 5,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(54,245,255,0.16)",
  },
  infoHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
    backgroundColor: "rgba(10,22,40,0.95)",
  },
  infoHeaderTitle: { color: palette.text, fontSize: 18, fontWeight: "900" },
  infoBody: {
    flexShrink: 1,
  },
  infoBodyContent: {
    padding: 16,
    paddingBottom: 24,
    gap: 10,
  },
  infoFooter: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: palette.line,
    backgroundColor: "rgba(10,22,40,0.95)",
  },
  infoEagohPreview: { flexDirection: "row", gap: 12 },
  infoDivider: {
    height: 1,
    backgroundColor: palette.line,
    marginVertical: 4,
  },

  modalEagohPreview: { flexDirection: "row", gap: 12, marginBottom: 8 },
  modalEagohImage: {
    width: 64,
    height: 78,
    borderRadius: 5,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.line,
  },
  modalEagohNameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  modalEagohName: { color: palette.text, fontSize: 17, fontWeight: "900", flex: 1 },
  infoIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: palette.line,
  },
  modalEagohDomain: { color: palette.cyan, fontSize: 12, fontWeight: "800" },
  modalVendor: { color: palette.muted, fontSize: 12, fontWeight: "700" },

  detailRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  detailRowCol: { gap: 6 },
  detailIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  detailLabel: { color: palette.muted, fontSize: 11, fontWeight: "800", width: 90 },
  detailValue: { color: palette.text, fontSize: 12, fontWeight: "900", flex: 1 },
  detailDnaWrap: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 },
  detailDnaTag: {
    backgroundColor: "rgba(138,92,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(138,92,255,0.25)",
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  detailDnaTagText: { color: palette.violet, fontSize: 9, fontWeight: "900" },

  syncLevelGrid: { flexDirection: "row", gap: 8 },
  syncLevelChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 5,
    padding: 10,
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  syncLevelChipActive: { borderColor: palette.cyan, backgroundColor: palette.cyanSoft },
  syncLevelChipDisabled: { opacity: 0.35 },
  syncLevelText: { color: palette.text, fontSize: 13, fontWeight: "900" },
  syncLevelTextActive: { color: palette.cyan },
  syncLevelTextDisabled: { color: palette.muted },
  syncLevelPrice: { color: palette.gold, fontSize: 10, fontWeight: "900" },
  syncLevelPriceActive: { color: palette.gold },

  daysRow: { flexDirection: "row", gap: 8 },
  dayChip: {
    width: 44,
    height: 38,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  dayChipActive: { borderColor: palette.cyan, backgroundColor: palette.cyanSoft },
  dayChipText: { color: palette.text, fontSize: 15, fontWeight: "900" },
  dayChipTextActive: { color: palette.cyan },

  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderColor: palette.line,
  },
  totalLabel: { color: palette.muted, fontSize: 13, fontWeight: "800" },
  totalValueRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  totalValue: { color: palette.gold, fontSize: 22, fontWeight: "900" },
  totalBreakdown: { color: palette.muted, fontSize: 11, fontWeight: "700", marginTop: 2 },

  confirmButton: {
    marginTop: 14,
    minHeight: 46,
    borderRadius: 5,
    backgroundColor: palette.cyan,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  confirmButtonDisabled: { backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: palette.line },
  confirmButtonText: { color: palette.void, fontSize: 14, fontWeight: "900" },

  retentionNoticeRow: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 2, marginTop: 8, marginBottom: 4 },
  retentionNoticeText: { color: palette.muted, fontSize: 10, fontWeight: "700" },
  retentionDisclaimerSection: { paddingHorizontal: 2, paddingVertical: 6 },
  retentionDisclaimerHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  retentionDisclaimerTitle: { color: palette.cyan, fontSize: 12, fontWeight: "900" },
  retentionDisclaimerBody: { color: palette.text, fontSize: 11, fontWeight: "600", lineHeight: 16, marginBottom: 4 },
  retentionDisclaimerFootnote: { color: palette.muted, fontSize: 10, fontWeight: "700", lineHeight: 14 },

  sourceCredentialsSection: {
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "rgba(54,245,255,0.16)",
    overflow: "hidden",
    marginTop: 4,
  },
  sourceCredentialsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(54,245,255,0.08)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(54,245,255,0.10)",
  },
  sourceCredentialsTitle: { color: palette.cyan, fontSize: 12, fontWeight: "900" },
  sourceCredentialsBody: { padding: 12, gap: 8 },
  sourceCredRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sourceCredRowCol: { gap: 4 },
  sourceCredBodyText: { color: palette.text, fontSize: 11, fontWeight: "700", lineHeight: 16, marginTop: 2 },
  sourceCredPlaceholder: { color: palette.muted, fontSize: 11, fontWeight: "700", lineHeight: 16, fontStyle: "italic" },

  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
});
