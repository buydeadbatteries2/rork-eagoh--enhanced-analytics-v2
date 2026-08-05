/**
 * BannerBookingsHistory — displays the authenticated user's banner booking
 * history with EAGOH name/image, location, dates, listing link, premium
 * effects, total neurons charged, purchase date, and computed booking status.
 *
 * Tapping a booking opens a detail modal showing all selected dates, 6 AM ET
 * start time, total cost, listing being promoted, and transaction/reference ID.
 *
 * Data source: sponsored_banners table (RLS-enforced, purchaser_id = userId).
 */

import React, { memo, useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import {
  Calendar as CalendarIcon,
  ChevronRight,
  Coins,
  ExternalLink,
  Flame,
  Home,
  Megaphone,
  ShoppingBag,
  Sparkles,
  X,
} from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { palette } from "@/constants/colors";
import { useHaptics } from "@/hooks/useHaptics";
import {
  getMyBannerBookings,
  type BannerBooking,
  type BannerBookingStatus,
} from "@/services/sponsoredBanners";
import { buildPublicListingUrl } from "@/services/sharing";

type P = typeof palette;

// ── Status helpers ──────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  BannerBookingStatus,
  { label: string; color: string; bg: string }
> = {
  scheduled: {
    label: "Scheduled",
    color: palette.cyan,
    bg: palette.cyanSoft,
  },
  active: {
    label: "Active",
    color: palette.success,
    bg: palette.successSoft,
  },
  completed: {
    label: "Completed",
    color: palette.muted,
    bg: "rgba(141,162,181,0.12)",
  },
  cancelled: {
    label: "Cancelled",
    color: palette.ember,
    bg: palette.emberSoft,
  },
  failed: {
    label: "Failed",
    color: palette.ember,
    bg: palette.emberSoft,
  },
};

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

function formatWeekday(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

function formatPurchaseDate(isoStr: string): string {
  const date = new Date(isoStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Booking Detail Modal ────────────────────────────────────────────────

function BookingDetailModal({
  booking,
  visible,
  onClose,
  pal,
}: {
  booking: BannerBooking | null;
  visible: boolean;
  onClose: () => void;
  pal: P;
}): JSX.Element | null {
  if (!booking) return null;

  const statusCfg = STATUS_CONFIG[booking.status];
  const dates = booking.booking_dates ?? [booking.start_date];
  const listingUrl = booking.listing_id
    ? buildPublicListingUrl(booking.listing_id)
    : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={detailStyles.overlay}>
        <View style={detailStyles.sheet}>
          <LinearGradient
            colors={[pal.graphite, pal.void]}
            style={StyleSheet.absoluteFill}
          />

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={detailStyles.scrollContent}
          >
            {/* Header */}
            <View style={detailStyles.handle} />
            <View style={detailStyles.headerRow}>
              <Megaphone color={pal.cyan} size={18} />
              <Text style={detailStyles.title}>Booking Details</Text>
              <Pressable
                onPress={onClose}
                style={detailStyles.closeBtn}
                hitSlop={8}
              >
                <X color={pal.muted} size={20} />
              </Pressable>
            </View>

            {/* EAGOH name + image */}
            <View style={detailStyles.eagohRow}>
              {booking.eagoh_image_url ? (
                <View style={detailStyles.eagohThumb}>
                  <ExpoImage
                    source={{ uri: booking.eagoh_image_url }}
                    style={{ width: "100%", height: "100%" }}
                  />
                </View>
              ) : (
                <View style={detailStyles.eagohThumbFallback}>
                  <Sparkles color={pal.muted} size={20} />
                </View>
              )}
              <View style={detailStyles.eagohInfo}>
                <Text style={detailStyles.eagohName}>{booking.eagoh_name}</Text>
                <View style={detailStyles.statusBadge(booking.status)}>
                  <Text style={detailStyles.statusBadgeText(booking.status)}>
                    {statusCfg.label}
                  </Text>
                </View>
              </View>
            </View>

            {/* Location */}
            <View style={detailStyles.fieldRow}>
              <View style={detailStyles.fieldIcon}>
                {booking.location === "home" ? (
                  <Home color={pal.cyan} size={14} />
                ) : (
                  <ShoppingBag color={pal.cyan} size={14} />
                )}
              </View>
              <Text style={detailStyles.fieldLabel}>Location</Text>
              <Text style={detailStyles.fieldValue}>
                {booking.location === "home" ? "Home Page" : "Marketplace"}
              </Text>
            </View>

            {/* Promotion dates */}
            <Text style={detailStyles.sectionLabel}>
              Promotion Dates · 6:00 AM ET
            </Text>
            <View style={detailStyles.datesContainer}>
              {dates.map((d: string, i: number) => (
                <View key={`${d}-${i}`} style={detailStyles.dateRow}>
                  <CalendarIcon color={pal.cyan} size={13} />
                  <Text style={detailStyles.dateText}>
                    {formatWeekday(d)}, {formatDisplayDate(d)}
                  </Text>
                  <Text style={detailStyles.timeText}>6:00 AM ET</Text>
                </View>
              ))}
            </View>

            {/* Premium effects */}
            <View style={detailStyles.effectsRow}>
              <View
                style={[
                  detailStyles.effectChip,
                  booking.colored_border
                    ? detailStyles.effectActive(pal.gold)
                    : detailStyles.effectInactive,
                ]}
              >
                <Text
                  style={[
                    detailStyles.effectText,
                    {
                      color: booking.colored_border ? pal.gold : pal.muted,
                    },
                  ]}
                >
                  Colored Border
                </Text>
              </View>
              <View
                style={[
                  detailStyles.effectChip,
                  booking.hot_badge
                    ? detailStyles.effectActive(pal.ember)
                    : detailStyles.effectInactive,
                ]}
              >
                <Flame
                  color={booking.hot_badge ? pal.ember : pal.muted}
                  size={11}
                />
                <Text
                  style={[
                    detailStyles.effectText,
                    {
                      color: booking.hot_badge ? pal.ember : pal.muted,
                    },
                  ]}
                >
                  Hot Badge
                </Text>
              </View>
            </View>

            {/* Total cost */}
            <View style={detailStyles.costRow}>
              <Text style={detailStyles.costLabel}>Total Neurons Charged</Text>
              <View style={detailStyles.costValueRow}>
                <Coins color={pal.gold} size={16} />
                <Text style={detailStyles.costValue}>{booking.edge_cost}</Text>
              </View>
            </View>

            {/* Listing being promoted */}
            {listingUrl && (
              <View style={detailStyles.fieldRow}>
                <View style={detailStyles.fieldIcon}>
                  <ExternalLink color={pal.cyan} size={14} />
                </View>
                <Text style={detailStyles.fieldLabel}>Listing</Text>
                <Text
                  style={detailStyles.fieldValueMono}
                  numberOfLines={1}
                  ellipsizeMode="middle"
                >
                  {listingUrl.replace("https://eagoh.app", "")}
                </Text>
              </View>
            )}

            {/* Reference / Transaction ID */}
            <View style={detailStyles.refRow}>
              <Text style={detailStyles.refLabel}>Reference ID</Text>
              <Text style={detailStyles.refValue}>
                {booking.idempotency_key ?? booking.id}
              </Text>
            </View>

            {/* Purchase date */}
            <View style={detailStyles.fieldRow}>
              <View style={detailStyles.fieldIcon}>
                <CalendarIcon color={pal.muted} size={14} />
              </View>
              <Text style={detailStyles.fieldLabel}>Booked On</Text>
              <Text style={detailStyles.fieldValue}>
                {formatPurchaseDate(booking.created_at)}
              </Text>
            </View>

            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Detail modal styles ─────────────────────────────────────────────────

const detailStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(2,4,10,0.88)",
  },
  sheet: {
    maxHeight: "85%",
    borderRadius: 16,
    overflow: "hidden" as const,
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 40,
    gap: 10,
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignSelf: "center",
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    marginBottom: 6,
  },
  title: {
    color: palette.text,
    fontSize: 18,
    fontWeight: "900" as const,
    flex: 1,
  },
  closeBtn: { padding: 4 },
  eagohRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    paddingVertical: 8,
  },
  eagohThumb: {
    width: 52,
    height: 52,
    borderRadius: 5,
    backgroundColor: palette.graphite,
    overflow: "hidden" as const,
    borderWidth: 1,
    borderColor: palette.line,
  },
  eagohThumbFallback: {
    width: 52,
    height: 52,
    borderRadius: 5,
    backgroundColor: palette.blueSoft,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderWidth: 1,
    borderColor: palette.line,
  },
  eagohInfo: { flex: 1, gap: 6 },
  eagohName: {
    color: palette.text,
    fontSize: 16,
    fontWeight: "900" as const,
  },
  statusBadge: (status: BannerBookingStatus) => ({
    alignSelf: "flex-start" as const,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: STATUS_CONFIG[status].bg,
  }),
  statusBadgeText: (status: BannerBookingStatus) => ({
    color: STATUS_CONFIG[status].color,
    fontSize: 10,
    fontWeight: "900" as const,
    letterSpacing: 0.5,
    textTransform: "uppercase" as const,
  }),
  fieldRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.line,
  },
  fieldIcon: {
    width: 28,
    height: 28,
    borderRadius: 5,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: palette.blueSoft,
    borderWidth: 1,
    borderColor: palette.line,
  },
  fieldLabel: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: "800" as const,
  },
  fieldValue: {
    color: palette.text,
    fontSize: 13,
    fontWeight: "700" as const,
    flex: 1,
    textAlign: "right" as const,
  },
  fieldValueMono: {
    color: palette.cyan,
    fontSize: 11,
    fontWeight: "700" as const,
    flex: 1,
    textAlign: "right" as const,
    fontFamily: undefined as unknown as string,
  },
  sectionLabel: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: "900" as const,
    letterSpacing: 1.5,
    textTransform: "uppercase" as const,
    marginTop: 6,
    marginBottom: 2,
  },
  datesContainer: { gap: 4 },
  dateRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 5,
    backgroundColor: "rgba(108,230,255,0.06)",
  },
  dateText: {
    color: palette.text,
    fontSize: 12,
    fontWeight: "700" as const,
    flex: 1,
  },
  timeText: {
    color: palette.cyan,
    fontSize: 10,
    fontWeight: "800" as const,
  },
  effectsRow: {
    flexDirection: "row" as const,
    gap: 8,
    marginTop: 4,
  },
  effectChip: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 5,
    borderWidth: 1,
  },
  effectActive: (color: string) => ({
    borderColor: color,
    backgroundColor: color === palette.gold ? palette.goldSoft : palette.emberSoft,
  }),
  effectInactive: {
    borderColor: palette.line,
    backgroundColor: palette.panel,
  },
  effectText: {
    fontSize: 11,
    fontWeight: "800" as const,
  },
  costRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between",
    borderRadius: 5,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: palette.goldSoft,
    borderWidth: 1,
    borderColor: "rgba(255,181,71,0.22)",
    marginTop: 6,
  },
  costLabel: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: "700" as const,
  },
  costValueRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  costValue: {
    color: palette.gold,
    fontSize: 20,
    fontWeight: "900" as const,
  },
  refRow: {
    paddingVertical: 8,
    gap: 4,
  },
  refLabel: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: "900" as const,
    letterSpacing: 1.2,
    textTransform: "uppercase" as const,
  },
  refValue: {
    color: palette.cyan,
    fontSize: 11,
    fontWeight: "700" as const,
  },
});

// ── Booking Card ────────────────────────────────────────────────────────

function BookingCard({
  booking,
  onPress,
  pal,
}: {
  booking: BannerBooking;
  onPress: () => void;
  pal: P;
}): JSX.Element {
  const h = useHaptics();
  const statusCfg = STATUS_CONFIG[booking.status];
  const dates = booking.booking_dates ?? [booking.start_date];
  const dateCount = dates.length;

  return (
    <Pressable
      onPress={() => {
        h.selection();
        onPress();
      }}
      style={({ pressed }) => [
        cardStyles.container,
        pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] },
      ]}
    >
      {/* EAGOH image + info */}
      <View style={cardStyles.topRow}>
        {booking.eagoh_image_url ? (
          <View style={cardStyles.thumb}>
            <ExpoImage
              source={{ uri: booking.eagoh_image_url }}
              style={{ width: "100%", height: "100%" }}
            />
          </View>
        ) : (
          <View style={cardStyles.thumbFallback}>
            <Sparkles color={pal.muted} size={16} />
          </View>
        )}

        <View style={cardStyles.info}>
          <Text style={cardStyles.eagohName} numberOfLines={1}>
            {booking.eagoh_name}
          </Text>
          <View style={cardStyles.metaRow}>
            {booking.location === "home" ? (
              <Home color={pal.cyan} size={11} />
            ) : (
              <ShoppingBag color={pal.cyan} size={11} />
            )}
            <Text style={cardStyles.metaText}>
              {booking.location === "home" ? "Home" : "Marketplace"}
            </Text>
            <Text style={cardStyles.dot}>·</Text>
            <CalendarIcon color={pal.muted} size={11} />
            <Text style={cardStyles.metaText}>
              {dateCount} date{dateCount > 1 ? "s" : ""}
            </Text>
          </View>
          <Text style={cardStyles.dateSummary} numberOfLines={1}>
            {dates.map((d) => formatDisplayDate(d)).join(", ")}
          </Text>
        </View>

        <View
          style={[
            cardStyles.statusBadge,
            { backgroundColor: statusCfg.bg },
          ]}
        >
          <Text style={[cardStyles.statusText, { color: statusCfg.color }]}>
            {statusCfg.label}
          </Text>
        </View>
      </View>

      {/* Effects + cost */}
      <View style={cardStyles.bottomRow}>
        <View style={cardStyles.effectsRow}>
          {booking.colored_border && (
            <View
              style={[
                cardStyles.effectPill,
                { borderColor: pal.gold, backgroundColor: palette.goldSoft },
              ]}
            >
              <Text style={[cardStyles.effectPillText, { color: pal.gold }]}>
                Border
              </Text>
            </View>
          )}
          {booking.hot_badge && (
            <View
              style={[
                cardStyles.effectPill,
                { borderColor: pal.ember, backgroundColor: palette.emberSoft },
              ]}
            >
              <Flame color={pal.ember} size={10} />
              <Text style={[cardStyles.effectPillText, { color: pal.ember }]}>
                Hot
              </Text>
            </View>
          )}
          {!booking.colored_border && !booking.hot_badge && (
            <Text style={cardStyles.noEffects}>No premium effects</Text>
          )}
        </View>
        <View style={cardStyles.costRow}>
          <Coins color={pal.gold} size={13} />
          <Text style={cardStyles.costText}>{booking.edge_cost}</Text>
        </View>
        <ChevronRight color={pal.muted} size={16} />
      </View>
    </Pressable>
  );
}

const cardStyles = StyleSheet.create({
  container: {
    borderRadius: 5,
    backgroundColor: "rgba(10,20,40,0.55)",
    borderWidth: 1,
    borderColor: "rgba(120,180,255,0.18)",
    padding: 10,
    gap: 8,
  },
  topRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
  },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: 5,
    backgroundColor: palette.graphite,
    overflow: "hidden" as const,
    borderWidth: 1,
    borderColor: palette.line,
  },
  thumbFallback: {
    width: 40,
    height: 40,
    borderRadius: 5,
    backgroundColor: palette.blueSoft,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderWidth: 1,
    borderColor: palette.line,
  },
  info: { flex: 1, gap: 3 },
  eagohName: {
    color: palette.text,
    fontSize: 13,
    fontWeight: "900" as const,
  },
  metaRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
  },
  metaText: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: "700" as const,
  },
  dot: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: "900" as const,
  },
  dateSummary: {
    color: palette.cyan,
    fontSize: 10,
    fontWeight: "600" as const,
  },
  statusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    alignSelf: "flex-start" as const,
  },
  statusText: {
    fontSize: 9,
    fontWeight: "900" as const,
    letterSpacing: 0.5,
    textTransform: "uppercase" as const,
  },
  bottomRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(120,180,255,0.12)",
  },
  effectsRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    flex: 1,
  },
  effectPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
  },
  effectPillText: {
    fontSize: 9,
    fontWeight: "900" as const,
  },
  noEffects: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: "600" as const,
  },
  costRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
  },
  costText: {
    color: palette.gold,
    fontSize: 14,
    fontWeight: "900" as const,
  },
});

// ── Main Component ──────────────────────────────────────────────────────

function BannerBookingsHistoryImpl({
  userId,
  pal,
  refreshKey = 0,
}: {
  userId: string | null;
  pal: P;
  refreshKey?: number;
}): JSX.Element {
  const [selectedBooking, setSelectedBooking] = useState<BannerBooking | null>(
    null,
  );

  const { data: bookings, isLoading } = useQuery<BannerBooking[]>({
    queryKey: ["myBannerBookings", userId, refreshKey],
    queryFn: () => getMyBannerBookings(userId!),
    enabled: !!userId,
    staleTime: 30 * 1000,
  });

  const list = useMemo(() => bookings ?? [], [bookings]);

  const handleClose = useCallback(() => setSelectedBooking(null), []);

  if (isLoading) {
    return (
      <View style={{ paddingVertical: 20, alignItems: "center" }}>
        <ActivityIndicator color={pal.cyan} size="small" />
      </View>
    );
  }

  if (list.length === 0) {
    return (
      <View style={emptyStyles.container}>
        <Megaphone color={pal.muted} size={22} />
        <Text style={emptyStyles.text}>No banner bookings yet</Text>
        <Text style={emptyStyles.subtext}>
          Promote your EAGOH with a sponsored banner to see it here.
        </Text>
      </View>
    );
  }

  return (
    <>
      <View style={{ gap: 8 }}>
        {list.map((booking: BannerBooking) => (
          <BookingCard
            key={booking.id}
            booking={booking}
            onPress={() => setSelectedBooking(booking)}
            pal={pal}
          />
        ))}
      </View>

      <BookingDetailModal
        booking={selectedBooking}
        visible={!!selectedBooking}
        onClose={handleClose}
        pal={pal}
      />
    </>
  );
}

const emptyStyles = StyleSheet.create({
  container: {
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingVertical: 24,
    paddingHorizontal: 16,
    gap: 8,
  },
  text: {
    color: palette.text,
    fontSize: 13,
    fontWeight: "800" as const,
  },
  subtext: {
    color: palette.muted,
    fontSize: 11,
    fontWeight: "600" as const,
    textAlign: "center" as const,
  },
});

const BannerBookingsHistory = memo(BannerBookingsHistoryImpl);
export default BannerBookingsHistory;
