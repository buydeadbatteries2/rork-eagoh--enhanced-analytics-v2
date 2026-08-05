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
 *  - Calendar date picker (replaces manual text entry)
 *  - Eastern Time 6 AM cutoff rule
 *  - 5-day scheduling window
 *  - Duration selector (1-5 days)
 *  - Premium effects (Colored Border, Hot Badge)
 *  - Total cost calculation
 *  - Purchase via existing purchaseBanner service
 *
 * The selected start date is normalized to 6:00 AM America/New_York
 * by the backend (sponsoredBanners.ts purchaseBanner function).
 */

import { useHaptics } from "@/hooks/useHaptics";
import { useEagohs } from "@/providers/EagohProvider";
import { useProfile } from "@/providers/ProfileProvider";
import { palette } from "@/constants/colors";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Coins,
  Megaphone,
  X,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
  computeBannerCost,
  purchaseBanner,
  type BannerLocation,
} from "@/services/sponsoredBanners";
import type { EagohRecord } from "@/services/eagohs";

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
 * Determine the earliest eligible promotion start date.
 *
 * All promotions begin at 6:00 AM Eastern Time. If today's 6 AM ET has
 * already passed, the earliest selectable date is tomorrow. If it hasn't
 * passed yet, today is still eligible.
 */
function getEarliestStartDate(): string {
  const { dateStr, hour } = getETNow();
  if (hour >= 6) {
    return addDays(dateStr, 1);
  }
  return dateStr;
}

/**
 * Get the 5 eligible start dates: earliest through earliest + 4.
 */
function getEligibleDates(): string[] {
  const earliest = getEarliestStartDate();
  return Array.from({ length: 5 }, (_, i) => addDays(earliest, i));
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

// ── Calendar Picker ───────────────────────────────────────────────────────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function CalendarPicker({
  selectedDate,
  onSelectDate,
  eligibleDates,
}: {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  eligibleDates: string[];
}): JSX.Element {
  const eligibleSet = useMemo(() => new Set(eligibleDates), [eligibleDates]);

  const earliestDate = eligibleDates[0] ?? getEarliestStartDate();
  const latestDate = eligibleDates[eligibleDates.length - 1] ?? earliestDate;

  const minYear = parseInt(earliestDate.slice(0, 4), 10);
  const minMonth = parseInt(earliestDate.slice(5, 7), 10);
  const maxYear = parseInt(latestDate.slice(0, 4), 10);
  const maxMonth = parseInt(latestDate.slice(5, 7), 10);

  const [viewYear, setViewYear] = useState<number>(() =>
    parseInt(earliestDate.slice(0, 4), 10),
  );
  const [viewMonth, setViewMonth] = useState<number>(() =>
    parseInt(earliestDate.slice(5, 7), 10),
  );

  const canGoPrev = viewYear > minYear || (viewYear === minYear && viewMonth > minMonth);
  const canGoNext = viewYear < maxYear || (viewYear === maxYear && viewMonth < maxMonth);

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

  return (
    <View style={calStyles.container}>
      {/* Month header with navigation */}
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

      {/* Weekday labels */}
      <View style={calStyles.weekdayRow}>
        {WEEKDAY_LABELS.map((label, i) => (
          <Text key={i} style={calStyles.weekdayLabel}>{label}</Text>
        ))}
      </View>

      {/* Date grid */}
      <View style={calStyles.grid}>
        {cells.map((dateStr, i) => {
          if (!dateStr) {
            return <View key={`empty-${i}`} style={calStyles.emptyCell} />;
          }
          const isEligible = eligibleSet.has(dateStr);
          const isSelected = dateStr === selectedDate;

          return (
            <Pressable
              key={dateStr}
              onPress={() => isEligible && onSelectDate(dateStr)}
              disabled={!isEligible}
              style={[
                calStyles.dateCell,
                isSelected && calStyles.dateCellSelected,
                !isEligible && calStyles.dateCellDisabled,
              ]}
            >
              <Text
                style={[
                  calStyles.dateText,
                  isSelected && calStyles.dateTextSelected,
                  !isEligible && calStyles.dateTextDisabled,
                ]}
              >
                {parseInt(dateStr.slice(8, 10), 10)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Selected date display + eligible count */}
      <View style={calStyles.selectedRow}>
        <CalendarIcon color={palette.cyan} size={14} />
        <Text style={calStyles.selectedText}>
          {formatWeekday(selectedDate)}, {formatDisplayDate(selectedDate)}
        </Text>
        <Text style={calStyles.eligibleHint}>5 eligible dates</Text>
      </View>
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
  eligibleHint: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: "700",
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
  const { profile } = useProfile();
  const [selectedEagohId, setSelectedEagohId] = useState<string>("");
  const [location, setLocation] = useState<BannerLocation>(defaultLocation);
  const [eligibleDates, setEligibleDates] = useState<string[]>(() => getEligibleDates());
  const [startDate, setStartDate] = useState<string>(() => getEarliestStartDate());
  const [days, setDays] = useState<number>(1);
  const [coloredBorder, setColoredBorder] = useState<boolean>(false);
  const [hotBadge, setHotBadge] = useState<boolean>(false);
  const [purchasing, setPurchasing] = useState(false);

  // Sync location + reset state when modal opens
  useEffect(() => {
    if (visible) {
      setLocation(defaultLocation);
      const dates = getEligibleDates();
      setEligibleDates(dates);
      setStartDate(dates[0]);
    }
  }, [visible, defaultLocation]);

  const myEagohs = (eagohs ?? []).filter((e: EagohRecord) => e.user_id === userId);
  const totalCost = computeBannerCost(location, days, coloredBorder, hotBadge);

  const handlePurchase = async () => {
    if (!userId || !profile || !selectedEagohId) return;
    setPurchasing(true);
    try {
      const result = await purchaseBanner(
        { userId, eagohId: selectedEagohId, location, startDate, days, coloredBorder, hotBadge },
        profile,
      );
      if (result.ok) {
        h.success();
        Alert.alert(
          "Banner Purchased",
          `Your EAGOH will be promoted for ${days} day(s) starting ${formatDisplayDate(startDate)}.`,
        );
        onPurchased();
        onClose();
      } else {
        Alert.alert("Purchase Failed", result.error);
      }
    } catch (err: unknown) {
      Alert.alert("Error", (err as Error).message ?? "Failed to purchase banner.");
    } finally {
      setPurchasing(false);
    }
  };

  const reset = () => {
    setSelectedEagohId("");
    setLocation(defaultLocation);
    setDays(1);
    setColoredBorder(false);
    setHotBadge(false);
  };

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

          {/* Scrollable content — calendar + all controls must be reachable */}
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
                  onPress={() => setSelectedEagohId(e.id)}
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

            {/* Start Date — Calendar Picker */}
            <Text style={modalStyles.sectionLabel}>Start Date (6 AM ET)</Text>
            <CalendarPicker
              selectedDate={startDate}
              onSelectDate={setStartDate}
              eligibleDates={eligibleDates}
            />

            {/* Duration */}
            <Text style={modalStyles.sectionLabel}>Duration (1-5 days)</Text>
            <View style={modalStyles.daysRow}>
              {[1, 2, 3, 4, 5].map((d) => (
                <Pressable
                  key={d}
                  onPress={() => setDays(d)}
                  style={[modalStyles.dayChip, days === d && modalStyles.dayChipActive]}
                >
                  <Text style={[modalStyles.dayChipText, days === d && modalStyles.dayChipTextActive]}>
                    {d}
                  </Text>
                </Pressable>
              ))}
            </View>

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
              {location === "home" ? "Home" : "Marketplace"} · {days} day(s)
              {coloredBorder ? " · Border" : ""}{hotBadge ? " · Hot Badge" : ""}
            </Text>

            {/* Purchase Button */}
            <Pressable
              onPress={handlePurchase}
              disabled={purchasing || !selectedEagohId}
              style={({ pressed }) => [
                modalStyles.confirmButton,
                (purchasing || !selectedEagohId) && modalStyles.confirmButtonDisabled,
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
  daysRow: {
    flexDirection: "row",
    gap: 10,
  },
  dayChip: {
    width: 48,
    height: 42,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.panel,
  },
  dayChipActive: {
    backgroundColor: palette.cyan,
    borderColor: palette.cyan,
  },
  dayChipText: {
    color: palette.muted,
    fontSize: 15,
    fontWeight: "900",
  },
  dayChipTextActive: {
    color: palette.void,
  },
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
