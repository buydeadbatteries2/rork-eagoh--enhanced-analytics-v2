/**
 * BannerPurchaseModal — shared promotion modal for EAGOH sponsored banners.
 *
 * Used by:
 *  - Home page (defaultLocation = "home", 250 Neurons/day)
 *  - Exchange page (defaultLocation = "marketplace", 150 Neurons/day)
 *
 * Features:
 *  - EAGOH selection from user's EAGOHs
 *  - Banner location selector (Home Page / Marketplace)
 *  - Multi-date calendar (1-5 individual future dates, nonconsecutive allowed)
 *  - Current day disabled, past dates disabled
 *  - Eastern Time 6 AM normalization (all promotions begin at 6 AM ET)
 *  - Listing link field with dropdown of user's active Exchange listings
 *  - Premium effects (Colored Border, Hot Badge)
 *  - Total cost calculated from selected date count
 *  - Purchase via existing purchaseBanner service with effective tier
 *
 * The effective subscription tier is passed through to spendEdge so that
 * dev test tiers (Expo Go) and admin overrides are respected — not just
 * the raw DB subscription_tier column.
 */

import { useHaptics } from "@/hooks/useHaptics";
import { useEagohs } from "@/providers/EagohProvider";
import { useProfile } from "@/providers/ProfileProvider";
import { palette } from "@/constants/colors";
import {
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Coins,
  Link2,
  Megaphone,
  X,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { LinearGradient } from "expo-linear-gradient";
import {
  computeBannerCostForDates,
  parseListingUrl,
  purchaseBanner,
  type BannerLocation,
} from "@/services/sponsoredBanners";
import { getMyListings, type EnrichedListing } from "@/services/marketplace";
import { buildPublicListingUrl } from "@/services/sharing";
import type { EagohRecord } from "@/services/eagohs";
import type { SubscriptionTier } from "@/services/profile";
import { useQuery } from "@tanstack/react-query";

// ── Eastern Time date utilities ───────────────────────────────────────────

/**
 * Get the current date and hour in America/New_York timezone.
 * Returns { dateStr: "YYYY-MM-DD", hour: 0-23 } in ET.
 */
function getETNow(): { dateStr: string; hour: number } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value ?? "2026";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const hour = parseInt(hourStr, 10) === 24 ? 0 : parseInt(hourStr, 10);
  return { dateStr: `${year}-${month}-${day}`, hour };
}

/**
 * Add days to a "YYYY-MM-DD" string using UTC arithmetic to avoid timezone shifts.
 */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Get tomorrow's date in ET. The current calendar day is never selectable.
 */
function getEarliestSelectableDate(): string {
  const { dateStr } = getETNow();
  return addDays(dateStr, 1);
}

/**
 * Compare two "YYYY-MM-DD" strings. Returns negative if a < b, 0 if equal, positive if a > b.
 */
function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Format a "YYYY-MM-DD" string for display (e.g. "Aug 6, 2026").
 */
function formatDisplayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Format a "YYYY-MM-DD" string as weekday short name (e.g. "Mon").
 */
function formatWeekday(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

// ── Calendar Picker (Multi-Date) ──────────────────────────────────────────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MAX_DATES = 5;

function MultiDateCalendarPicker({
  selectedDates,
  onToggleDate,
}: {
  selectedDates: string[];
  onToggleDate: (date: string) => void;
}): JSX.Element {
  const earliestSelectable = getEarliestSelectableDate();
  const selectedSet = useMemo(() => new Set(selectedDates), [selectedDates]);

  const [viewYear, setViewYear] = useState<number>(() =>
    parseInt(earliestSelectable.slice(0, 4), 10),
  );
  const [viewMonth, setViewMonth] = useState<number>(() =>
    parseInt(earliestSelectable.slice(5, 7), 10),
  );

  // Allow navigation to any month from the earliest selectable month onward
  const minYear = parseInt(earliestSelectable.slice(0, 4), 10);
  const minMonth = parseInt(earliestSelectable.slice(5, 7), 10);

  const canGoPrev = viewYear > minYear || (viewYear === minYear && viewMonth > minMonth);
  const canGoNext = true; // Allow navigating to any future month

  const goPrev = useCallback(() => {
    if (!canGoPrev) return;
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else {
      setViewMonth((m) => m - 1);
    }
  }, [canGoPrev, viewMonth]);

  const goNext = useCallback(() => {
    if (!canGoNext) return;
    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }, [canGoNext, viewMonth]);

  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth - 1, 1).getDay();

  const cells: (string | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const mm = String(viewMonth).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    cells.push(`${viewYear}-${mm}-${dd}`);
  }

  const handleToggle = useCallback(
    (dateStr: string) => {
      const isPast = compareDates(dateStr, earliestSelectable) < 0;
      if (isPast) return; // past/current dates not selectable
      const isAlreadySelected = selectedSet.has(dateStr);
      if (!isAlreadySelected && selectedDates.length >= MAX_DATES) return; // limit reached
      onToggleDate(dateStr);
    },
    [earliestSelectable, selectedSet, selectedDates.length, onToggleDate],
  );

  return (
    <View style={calStyles.container}>
      <View style={calStyles.header}>
        <Pressable
          onPress={goPrev}
          disabled={!canGoPrev}
          style={({ pressed }) => [
            calStyles.navBtn,
            !canGoPrev && calStyles.navBtnDisabled,
            pressed && { opacity: 0.7 },
          ]}
        >
          <ChevronLeft color={canGoPrev ? palette.cyan : palette.muted} size={18} />
        </Pressable>
        <Text style={calStyles.monthTitle}>
          {MONTH_NAMES[viewMonth - 1]} {viewYear}
        </Text>
        <Pressable
          onPress={goNext}
          disabled={!canGoNext}
          style={({ pressed }) => [
            calStyles.navBtn,
            !canGoNext && calStyles.navBtnDisabled,
            pressed && { opacity: 0.7 },
          ]}
        >
          <ChevronRight color={canGoNext ? palette.cyan : palette.muted} size={18} />
        </Pressable>
      </View>

      <View style={calStyles.weekdayRow}>
        {WEEKDAY_LABELS.map((label, i) => (
          <Text key={i} style={calStyles.weekdayLabel}>{label}</Text>
        ))}
      </View>

      <View style={calStyles.grid}>
        {cells.map((dateStr, i) => {
          if (!dateStr) {
            return <View key={`empty-${i}`} style={calStyles.emptyCell} />;
          }
          const isPast = compareDates(dateStr, earliestSelectable) < 0;
          const isSelected = selectedSet.has(dateStr);
          const isDisabled = isPast;

          return (
            <Pressable
              key={dateStr}
              onPress={() => handleToggle(dateStr)}
              disabled={isDisabled}
              style={[
                calStyles.dateCell,
                isSelected && calStyles.dateCellSelected,
                isDisabled && calStyles.dateCellDisabled,
              ]}
            >
              <Text
                style={[
                  calStyles.dateText,
                  isSelected && calStyles.dateTextSelected,
                  isDisabled && calStyles.dateTextDisabled,
                ]}
              >
                {parseInt(dateStr.slice(8, 10), 10)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={calStyles.selectedRow}>
        <CalendarIcon color={palette.cyan} size={14} />
        <Text style={calStyles.selectedText}>
          {selectedDates.length} of {MAX_DATES} dates selected
        </Text>
      </View>

      {selectedDates.length >= MAX_DATES && (
        <Text style={calStyles.limitHint}>
          You can select up to {MAX_DATES} promotion dates.
        </Text>
      )}

      {selectedDates.length > 0 && (
        <View style={calStyles.dateListContainer}>
          {selectedDates.map((d) => (
            <View key={d} style={calStyles.dateChipRow}>
              <Text style={calStyles.dateChipText}>
                {formatWeekday(d)}, {formatDisplayDate(d)}
              </Text>
              <Pressable
                onPress={() => onToggleDate(d)}
                style={({ pressed }) => [calStyles.dateChipRemove, pressed && { opacity: 0.7 }]}
              >
                <X color={palette.muted} size={12} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Calendar styles ───────────────────────────────────────────────────────

const calStyles = StyleSheet.create({
  container: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(108,230,255,0.18)",
    backgroundColor: "rgba(7,17,31,0.7)",
    padding: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  navBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(108,230,255,0.08)",
  },
  navBtnDisabled: { opacity: 0.3 },
  monthTitle: {
    color: palette.text,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  weekdayRow: {
    flexDirection: "row",
    marginBottom: 6,
  },
  weekdayLabel: {
    flex: 1,
    textAlign: "center",
    color: palette.muted,
    fontSize: 10,
    fontWeight: "800",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  emptyCell: {
    width: `${100 / 7}%` as unknown as number,
    aspectRatio: 1,
  },
  dateCell: {
    width: `${100 / 7}%` as unknown as number,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
  },
  dateCellSelected: {
    backgroundColor: palette.cyan,
  },
  dateCellDisabled: {
    opacity: 0.25,
  },
  dateText: {
    color: palette.text,
    fontSize: 13,
    fontWeight: "800",
  },
  dateTextSelected: {
    color: palette.void,
    fontWeight: "900",
  },
  dateTextDisabled: {
    color: palette.muted,
  },
  selectedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(108,230,255,0.12)",
  },
  selectedText: {
    color: palette.cyan,
    fontSize: 13,
    fontWeight: "800",
    flex: 1,
  },
  limitHint: {
    color: palette.gold,
    fontSize: 10,
    fontWeight: "700",
    marginTop: 4,
  },
  dateListContainer: {
    marginTop: 8,
    gap: 4,
  },
  dateChipRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(108,230,255,0.06)",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  dateChipText: {
    color: palette.text,
    fontSize: 11,
    fontWeight: "700",
  },
  dateChipRemove: {
    padding: 4,
  },
});

// ── Banner Purchase Modal ─────────────────────────────────────────────────

export type BannerPurchaseModalProps = {
  visible: boolean;
  onClose: () => void;
  onPurchased: () => void;
  userId: string | null;
  /** Pre-selected banner location when modal opens */
  defaultLocation?: BannerLocation;
};

export default function BannerPurchaseModal({
  visible,
  onClose,
  onPurchased,
  userId,
  defaultLocation = "home",
}: BannerPurchaseModalProps): JSX.Element {
  const h = useHaptics();
  const { eagohs } = useEagohs();
  const { profile, effectiveSubscriptionTier } = useProfile();
  const [selectedEagohId, setSelectedEagohId] = useState<string>("");
  const [location, setLocation] = useState<BannerLocation>(defaultLocation);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [coloredBorder, setColoredBorder] = useState<boolean>(false);
  const [hotBadge, setHotBadge] = useState<boolean>(false);
  const [purchasing, setPurchasing] = useState(false);
  const [listingUrl, setListingUrl] = useState<string>("");
  const [listingUrlError, setListingUrlError] = useState<string | null>(null);
  const [showListingDropdown, setShowListingDropdown] = useState<boolean>(false);

  // Fetch user's active Exchange listings for the dropdown
  const { data: myListings } = useQuery<EnrichedListing[]>({
    queryKey: ["myListings", userId],
    queryFn: () => getMyListings(userId!),
    enabled: !!userId && visible,
    staleTime: 60 * 1000,
  });

  // Filter to active listings only
  const activeListings = useMemo(
    () => (myListings ?? []).filter((l) => l.active),
    [myListings],
  );

  // Find active listings for the currently selected EAGOH
  const eagohListings = useMemo(
    () => activeListings.filter((l) => l.eagoh_id === selectedEagohId),
    [activeListings, selectedEagohId],
  );

  // Sync location + reset state when modal opens
  useEffect(() => {
    if (visible) {
      setLocation(defaultLocation);
      setSelectedDates([]);
      setSelectedEagohId("");
      setListingUrl("");
      setListingUrlError(null);
      setShowListingDropdown(false);
    }
  }, [visible, defaultLocation]);

  // Auto-populate listing URL when EAGOH is selected and exactly one active listing exists
  useEffect(() => {
    if (eagohListings.length === 1) {
      setListingUrl(buildPublicListingUrl(eagohListings[0].id));
      setListingUrlError(null);
    } else if (eagohListings.length === 0 && selectedEagohId) {
      // Don't clear if user manually typed a URL — only clear if switching EAGOH
      setListingUrl((prev) => {
        // Only clear if the current URL was auto-populated (matches one of our listing URLs)
        const wasAutoPopulated = activeListings.some(
          (l) => buildPublicListingUrl(l.id) === prev,
        );
        return wasAutoPopulated ? "" : prev;
      });
    }
  }, [eagohListings, selectedEagohId, activeListings]);

  const myEagohs = (eagohs ?? []).filter((e: EagohRecord) => e.user_id === userId);
  const totalCost = computeBannerCostForDates(location, selectedDates, coloredBorder, hotBadge);

  // Validate listing URL
  const validateListingUrl = useCallback(
    async (url: string): Promise<string | null> => {
      const trimmed = url.trim();
      if (!trimmed) {
        return "Enter a valid EAGOH Exchange listing link.";
      }
      const listingId = parseListingUrl(trimmed);
      if (!listingId) {
        return "Enter a valid EAGOH Exchange listing link.";
      }
      // Client-side pre-validation: check if listing belongs to user and is active
      if (userId) {
        try {
          const { supabase } = await import("@/lib/supabase");
          const { data: listing, error } = await supabase
            .from("marketplace_listings")
            .select("id, vendor_id, active")
            .eq("id", listingId)
            .maybeSingle();
          if (error || !listing) {
            return "Enter a valid EAGOH Exchange listing link.";
          }
          const row = listing as { id: string; vendor_id: string; active: boolean };
          if (row.vendor_id !== userId) {
            return "This listing does not belong to your account.";
          }
          if (!row.active) {
            return "This Exchange listing is not currently active.";
          }
        } catch {
          // If validation fails, let the server-side check catch it
        }
      }
      return null;
    },
    [userId],
  );

  const handleListingUrlChange = useCallback(
    (text: string) => {
      setListingUrl(text);
      setListingUrlError(null);
    },
    [],
  );

  const handleSelectListing = useCallback(
    (listing: EnrichedListing) => {
      setListingUrl(buildPublicListingUrl(listing.id));
      setListingUrlError(null);
      setShowListingDropdown(false);
      h.selection();
    },
    [h],
  );

  const toggleDate = useCallback(
    (date: string) => {
      setSelectedDates((prev) => {
        if (prev.includes(date)) {
          return prev.filter((d) => d !== date);
        }
        if (prev.length >= MAX_DATES) return prev;
        return [...prev, date].sort();
      });
    },
    [],
  );

  const handlePurchase = async () => {
    if (!userId || !profile || !selectedEagohId) return;
    if (selectedDates.length === 0) {
      Alert.alert("Select Dates", "Select at least one promotion date.");
      return;
    }

    // Validate listing URL
    const urlError = await validateListingUrl(listingUrl);
    if (urlError) {
      setListingUrlError(urlError);
      Alert.alert("Listing Required", urlError);
      return;
    }

    const listingId = parseListingUrl(listingUrl);

    setPurchasing(true);
    try {
      const result = await purchaseBanner(
        {
          userId,
          eagohId: selectedEagohId,
          location,
          startDate: selectedDates[0],
          days: selectedDates.length,
          selectedDates,
          listingId,
          coloredBorder,
          hotBadge,
          effectiveTier: effectiveSubscriptionTier as SubscriptionTier,
        },
        profile,
      );
      if (result.ok) {
        h.success();
        const dateList = selectedDates.map((d) => formatDisplayDate(d)).join(", ");
        Alert.alert(
          result.duplicate ? "Already Booked" : "Banner Booked Successfully",
          result.duplicate
            ? `This banner was already booked. Your EAGOH will be promoted on: ${dateList}.`
            : `Banner booked successfully. Your EAGOH will be promoted on: ${dateList}.`,
        );
        onPurchased();
        onClose();
      } else {
        h.error();
        Alert.alert("Purchase Failed", result.error);
      }
    } catch (err: unknown) {
      h.error();
      Alert.alert("Purchase Failed", "Banner purchase failed. No neurons were charged.");
    } finally {
      setPurchasing(false);
    }
  };

  const reset = () => {
    setSelectedEagohId("");
    setLocation(defaultLocation);
    setSelectedDates([]);
    setColoredBorder(false);
    setHotBadge(false);
    setListingUrl("");
    setListingUrlError(null);
    setShowListingDropdown(false);
  };

  const canPurchase = selectedEagohId && selectedDates.length > 0 && listingUrl.trim() && !purchasing;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => { reset(); onClose(); }}
    >
      <View style={modalStyles.overlay}>
        <View style={modalStyles.sheet}>
          <LinearGradient
            colors={[palette.graphite, palette.void]}
            style={StyleSheet.absoluteFill}
          />

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={modalStyles.scrollContent}
          >
            <View style={modalStyles.handle} />
            <View style={modalStyles.headerRow}>
              <Megaphone color={palette.cyan} size={20} />
              <Text style={modalStyles.title}>Promote Your EAGOH</Text>
              <Pressable
                onPress={() => { reset(); onClose(); }}
                style={modalStyles.closeBtn}
              >
                <X color={palette.muted} size={20} />
              </Pressable>
            </View>

            {/* Select EAGOH */}
            <Text style={modalStyles.sectionLabel}>Select EAGOH</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={modalStyles.chipRail}
            >
              {myEagohs.map((e: EagohRecord) => (
                <Pressable
                  key={e.id}
                  onPress={() => { setSelectedEagohId(e.id); h.selection(); }}
                  style={[modalStyles.chip, selectedEagohId === e.id && modalStyles.chipActive]}
                >
                  <Text style={[modalStyles.chipText, selectedEagohId === e.id && modalStyles.chipTextActive]}>
                    {e.name}
                  </Text>
                </Pressable>
              ))}
              {myEagohs.length === 0 && (
                <Text style={modalStyles.emptyHint}>No EAGOHs. Forge one first.</Text>
              )}
            </ScrollView>

            {/* Location */}
            <Text style={modalStyles.sectionLabel}>Banner Location</Text>
            <View style={modalStyles.locationRow}>
              <Pressable
                onPress={() => setLocation("home")}
                style={[modalStyles.locationChip, location === "home" && modalStyles.locationChipActive]}
              >
                <Text style={[modalStyles.locationChipText, location === "home" && modalStyles.locationChipTextActive]}>
                  Home Page
                </Text>
                <Text style={[modalStyles.locationPrice, location === "home" && modalStyles.locationPriceActive]}>
                  250 Neurons/day
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setLocation("marketplace")}
                style={[modalStyles.locationChip, location === "marketplace" && modalStyles.locationChipActive]}
              >
                <Text style={[modalStyles.locationChipText, location === "marketplace" && modalStyles.locationChipTextActive]}>
                  Marketplace
                </Text>
                <Text style={[modalStyles.locationPrice, location === "marketplace" && modalStyles.locationPriceActive]}>
                  150 Neurons/day
                </Text>
              </Pressable>
            </View>

            {/* Listing Link */}
            <Text style={modalStyles.sectionLabel}>Listing Link</Text>
            <Text style={modalStyles.helperText}>
              Paste the Exchange listing link you want this banner to open.
            </Text>
            <View style={modalStyles.listingInputRow}>
              <Link2 color={palette.muted} size={16} style={modalStyles.listingInputIcon} />
              <TextInput
                style={[
                  modalStyles.listingInput,
                  listingUrlError && modalStyles.listingInputError,
                ]}
                placeholder="https://eagoh.app/listing/..."
                placeholderTextColor={palette.muted}
                value={listingUrl}
                onChangeText={handleListingUrlChange}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            </View>

            {/* Listing dropdown / select button */}
            {activeListings.length > 0 && (
              <Pressable
                onPress={() => setShowListingDropdown((v) => !v)}
                style={({ pressed }) => [
                  modalStyles.selectListingBtn,
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text style={modalStyles.selectListingBtnText}>
                  {showListingDropdown ? "Hide listings" : `Select from your listings (${activeListings.length})`}
                </Text>
                <ChevronDown
                  color={palette.cyan}
                  size={14}
                  style={{ transform: [{ rotate: showListingDropdown ? "180deg" : "0deg" }] }}
                />
              </Pressable>
            )}

            {showListingDropdown && activeListings.length > 0 && (
              <View style={modalStyles.listingDropdown}>
                {activeListings.map((listing) => {
                  const eagohName = listing.eagoh?.name ?? "Unknown";
                  const url = buildPublicListingUrl(listing.id);
                  const isSelected = listingUrl === url;
                  return (
                    <Pressable
                      key={listing.id}
                      onPress={() => handleSelectListing(listing)}
                      style={[
                        modalStyles.listingDropdownItem,
                        isSelected && modalStyles.listingDropdownItemActive,
                      ]}
                    >
                      <Text
                        style={[
                          modalStyles.listingDropdownText,
                          isSelected && modalStyles.listingDropdownTextActive,
                        ]}
                        numberOfLines={1}
                      >
                        {eagohName}
                      </Text>
                      <Text style={modalStyles.listingDropdownUrl} numberOfLines={1}>
                        {url.replace("https://eagoh.app", "")}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {listingUrlError && (
              <Text style={modalStyles.listingErrorText}>{listingUrlError}</Text>
            )}

            {/* Multi-Date Calendar */}
            <Text style={modalStyles.sectionLabel}>Promotion Dates (6 AM ET)</Text>
            <MultiDateCalendarPicker
              selectedDates={selectedDates}
              onToggleDate={toggleDate}
            />

            {/* Premium Effects */}
            <Text style={modalStyles.sectionLabel}>Premium Effects</Text>
            <View style={modalStyles.premiumRow}>
              <Pressable
                onPress={() => setColoredBorder(!coloredBorder)}
                style={[modalStyles.premiumChip, coloredBorder && modalStyles.premiumChipActive]}
              >
                <Text style={[modalStyles.premiumChipText, coloredBorder && modalStyles.premiumChipTextActive]}>
                  Colored Border
                </Text>
                <Text style={[modalStyles.premiumChipPrice, coloredBorder && modalStyles.premiumChipPriceActive]}>
                  +10 Neurons/day
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setHotBadge(!hotBadge)}
                style={[modalStyles.premiumChip, hotBadge && modalStyles.premiumChipActive]}
              >
                <Text style={[modalStyles.premiumChipText, hotBadge && modalStyles.premiumChipTextActive]}>
                  Hot Badge
                </Text>
                <Text style={[modalStyles.premiumChipPrice, hotBadge && modalStyles.premiumChipPriceActive]}>
                  +15 Neurons/day
                </Text>
              </Pressable>
            </View>

            {/* Total */}
            <View style={modalStyles.totalRow}>
              <Text style={modalStyles.totalLabel}>Total Cost</Text>
              <View style={modalStyles.totalValueRow}>
                <Coins color={palette.gold} size={18} />
                <Text style={modalStyles.totalValue}>{totalCost} Neurons</Text>
              </View>
            </View>
            <Text style={modalStyles.totalBreakdown}>
              {location === "home" ? "Home" : "Marketplace"} · {selectedDates.length} date(s)
              {coloredBorder ? " · Border" : ""}{hotBadge ? " · Hot Badge" : ""}
            </Text>

            {/* Purchase Button */}
            <Pressable
              onPress={handlePurchase}
              disabled={!canPurchase}
              style={({ pressed }) => [
                modalStyles.confirmButton,
                !canPurchase && modalStyles.confirmButtonDisabled,
                pressed && { transform: [{ scale: 0.98 }], opacity: 0.88 },
              ]}
            >
              {purchasing ? (
                <ActivityIndicator color={palette.void} size="small" />
              ) : (
                <>
                  <CalendarIcon color={palette.void} size={17} />
                  <Text style={modalStyles.confirmButtonText}>Purchase Banner</Text>
                </>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Modal styles ──────────────────────────────────────────────────────────

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: palette.overlay,
  },
  sheet: {
    maxHeight: "90%",
    borderRadius: 16,
    overflow: "hidden",
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 38,
    gap: 12,
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignSelf: "center",
    marginBottom: 6,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  title: {
    color: palette.text,
    fontSize: 18,
    fontWeight: "900",
    flex: 1,
  },
  closeBtn: {
    padding: 6,
  },
  sectionLabel: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  helperText: {
    color: palette.muted,
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 4,
  },
  chipRail: {
    gap: 7,
    paddingRight: 12,
  },
  chip: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: palette.panel,
  },
  chipActive: {
    backgroundColor: palette.cyan,
    borderColor: palette.cyan,
  },
  chipText: {
    color: palette.muted,
    fontSize: 11,
    fontWeight: "900",
  },
  chipTextActive: {
    color: palette.void,
  },
  emptyHint: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: "700",
    paddingVertical: 8,
  },
  locationRow: {
    flexDirection: "row",
    gap: 10,
  },
  locationChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 5,
    padding: 12,
    alignItems: "center",
    gap: 4,
    backgroundColor: palette.panel,
  },
  locationChipActive: {
    backgroundColor: palette.cyanSoft,
    borderColor: palette.cyan,
  },
  locationChipText: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: "900",
  },
  locationChipTextActive: {
    color: palette.cyan,
  },
  locationPrice: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: "800",
  },
  locationPriceActive: {
    color: palette.cyan,
  },
  // Listing link field
  listingInputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 5,
    backgroundColor: palette.panel,
    paddingHorizontal: 10,
    gap: 8,
  },
  listingInputIcon: {
    marginTop: 0,
  },
  listingInput: {
    flex: 1,
    color: palette.text,
    fontSize: 12,
    fontWeight: "600",
    paddingVertical: 10,
    paddingHorizontal: 0,
  },
  listingInputError: {
    borderColor: palette.ember,
  },
  selectListingBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "rgba(108,230,255,0.22)",
    backgroundColor: "rgba(108,230,255,0.06)",
  },
  selectListingBtnText: {
    color: palette.cyan,
    fontSize: 11,
    fontWeight: "800",
  },
  listingDropdown: {
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(7,17,31,0.85)",
    padding: 4,
    gap: 2,
  },
  listingDropdownItem: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 4,
  },
  listingDropdownItemActive: {
    backgroundColor: "rgba(108,230,255,0.12)",
  },
  listingDropdownText: {
    color: palette.text,
    fontSize: 12,
    fontWeight: "800",
  },
  listingDropdownTextActive: {
    color: palette.cyan,
  },
  listingDropdownUrl: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: "600",
    marginTop: 1,
  },
  listingErrorText: {
    color: palette.ember,
    fontSize: 11,
    fontWeight: "700",
  },
  // Premium effects
  premiumRow: {
    flexDirection: "row",
    gap: 10,
  },
  premiumChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 5,
    padding: 10,
    alignItems: "center",
    gap: 4,
    backgroundColor: palette.panel,
  },
  premiumChipActive: {
    backgroundColor: palette.goldSoft,
    borderColor: palette.gold,
  },
  premiumChipText: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: "900",
  },
  premiumChipTextActive: {
    color: palette.gold,
  },
  premiumChipPrice: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: "800",
  },
  premiumChipPriceActive: {
    color: palette.gold,
  },
  // Total
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 5,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: palette.goldSoft,
    borderWidth: 1,
    borderColor: "rgba(255,181,71,0.22)",
  },
  totalLabel: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  totalValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  totalValue: {
    color: palette.gold,
    fontSize: 20,
    fontWeight: "900",
  },
  totalBreakdown: {
    color: palette.muted,
    fontSize: 11,
    textAlign: "center",
    marginTop: -6,
  },
  // Purchase button
  confirmButton: {
    minHeight: 52,
    borderRadius: 5,
    backgroundColor: palette.cyan,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    shadowColor: palette.cyan,
    shadowOpacity: 0.35,
    shadowRadius: 18,
  },
  confirmButtonDisabled: {
    opacity: 0.5,
  },
  confirmButtonText: {
    color: palette.void,
    fontSize: 15,
    fontWeight: "900",
  },
});
