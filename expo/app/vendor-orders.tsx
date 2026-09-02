/**
 * Sales & Orders — Vendor purchase order history (Phase D2.3R).
 *
 * Two account-wide sections rebuilt from Supabase (authoritative source):
 *   • Active Customer Syncs — live syncs of this vendor's EAGOHs with buyer
 *     snapshot, sync %, duration, price, purchase/expiration dates, time
 *     remaining, and an Active badge.
 *   • Sales History — ALL statuses (Active, Completed, Expired, Refunded,
 *     Reversed), newest first. Expired sales are never removed.
 *
 * Durability (Phase D2.3R): independent React Query queries keyed by the
 * authenticated user ID, refetched on cold start (refetchOnMount "always"),
 * screen focus, and AppState return to active. A marketplace/listing failure
 * can never erase or block vendor sales. Opening this screen marks unread
 * exchange_sale notifications as read, so the Vendor Dashboard badge
 * ("New Sync Sale") updates immediately.
 */

import { palette } from "@/constants/colors";
import { useHaptics } from "@/hooks/useHaptics";
import { useSafeBack } from "@/hooks/useSafeBack";
import { useAuth } from "@/providers/AuthProvider";
import { OptimizedEagohImage } from "@/app/_components/PerformancePrimitives";
import {
  EXCHANGE_VENDOR_UNREAD_SALES_KEY,
  useExchangeVendorActiveSyncs,
  useExchangeVendorDashboard,
  useExchangeVendorForegroundRefetch,
  useExchangeVendorSalesHistory,
  useExchangeVendorUnreadSales,
} from "@/hooks/useExchangeSyncQueries";
import { markUnreadSaleNotificationsRead } from "@/services/vendorSales";
import {
  ChevronLeft,
  Coins,
  Crown,
  PackageOpen,
  TrendingUp,
  ShoppingBag,
  CheckCircle,
  XCircle,
  RotateCcw,
  WifiOff,
  Timer,
} from "lucide-react-native";
import React, { memo, useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import type { VendorSale } from "@/services/vendorSales";

// ── Status helpers ─────────────────────────────────────────────────────

export type OrderStatus = "Active" | "Completed" | "Expired" | "Refunded" | "Reversed";

/** Map the DB purchase_status to a user-facing order status. */
function mapOrderStatus(purchaseStatus: string | null, active: boolean): OrderStatus {
  if (!purchaseStatus || purchaseStatus === "completed") {
    return active ? "Active" : "Completed";
  }
  if (purchaseStatus === "expired") return "Expired";
  if (purchaseStatus === "refunded") return "Refunded";
  return "Reversed";
}

function statusColor(status: string): string {
  switch (status) {
    case "Active": return palette.success;
    case "Completed": return palette.cyan;
    case "Expired": return palette.muted;
    case "Refunded": return palette.ember;
    case "Reversed": return palette.gold;
    default: return palette.muted;
  }
}

function statusIcon(status: string): JSX.Element {
  const size = 12;
  const color = statusColor(status);
  switch (status) {
    case "Active": return <CheckCircle color={color} size={size} />;
    case "Completed": return <CheckCircle color={color} size={size} />;
    case "Expired": return <Timer color={color} size={size} />;
    case "Refunded": return <XCircle color={color} size={size} />;
    case "Reversed": return <RotateCcw color={color} size={size} />;
    default: return <PackageOpen color={color} size={size} />;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "—";
  }
}

/** Human time remaining until an expiration timestamp. */
function timeRemaining(expiresAt: string, now: number): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return "Expired";
  const mins = Math.floor(ms / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h left`;
  if (hours > 0) return `${hours}h ${mins % 60}m left`;
  return `${mins}m left`;
}

/** Re-render every 60s so "time remaining" stays honest without heavy timers. */
function useNow(intervalMs: number = 60_000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// ── Summary Card ───────────────────────────────────────────────────────

const SummaryCard = memo(function SummaryCard({
  activeSyncs,
  totalSales,
  earnedThisMonth,
}: {
  activeSyncs: number;
  totalSales: number;
  earnedThisMonth: number;
}): JSX.Element {
  return (
    <View style={styles.summaryCard}>
      <LinearGradient colors={["rgba(255,181,71,0.14)", "rgba(10,20,38,0.92)"]} style={StyleSheet.absoluteFill} />
      <View style={styles.summaryHeader}>
        <TrendingUp color={palette.gold} size={18} />
        <Text style={styles.summaryTitle}>Sales & Orders</Text>
      </View>
      <View style={styles.summaryGrid}>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: palette.cyan }]}>{activeSyncs}</Text>
          <Text style={styles.summaryLabel}>Active Syncs</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{totalSales}</Text>
          <Text style={styles.summaryLabel}>Total Sales</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: palette.gold }]}>{earnedThisMonth}</Text>
          <Text style={styles.summaryLabel}>EC This Month</Text>
        </View>
      </View>
    </View>
  );
});

// ── Active Customer Sync Card ──────────────────────────────────────────

const ActiveSyncCard = memo(function ActiveSyncCard({ sale }: { sale: VendorSale }): JSX.Element {
  const now = useNow();
  const remaining = timeRemaining(sale.expires_at, now);

  return (
    <View style={styles.orderCard}>
      <View style={styles.orderHeader}>
        <View style={styles.buyerRow}>
          {sale.buyer_avatar_url ? (
            <Image source={{ uri: sale.buyer_avatar_url }} style={styles.buyerAvatarLarge} contentFit="cover" />
          ) : (
            <View style={[styles.buyerAvatarLarge, styles.buyerAvatarFallback]}>
              <Text style={styles.buyerAvatarInitial}>{(sale.buyer_display_name ?? "?").slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
          <View>
            <Text style={styles.buyerNameLarge}>{sale.buyer_display_name ?? "Anonymous"}</Text>
            <Text style={styles.orderDate}>Purchased {formatDate(sale.created_at)}</Text>
          </View>
        </View>
        <View style={[styles.statusBadge, { borderColor: `${palette.success}44`, backgroundColor: `${palette.success}0E` }]}>
          {statusIcon("Active")}
          <Text style={[styles.statusText, { color: palette.success }]}>Active</Text>
        </View>
      </View>

      <View style={styles.orderBody}>
        <View style={styles.orderImageSection}>
          <OptimizedEagohImage
            tone="cyan"
            label={sale.eagoh_name}
            size="compact"
            imageUrl={sale.eagoh_image_url}
            showLabel={false}
          />
        </View>
        <View style={styles.orderInfo}>
          <Text style={styles.eagohName} numberOfLines={1}>{sale.eagoh_name}</Text>
          <View style={styles.detailsRow}>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Sync</Text>
              <Text style={styles.detailValue}>{sale.sync_level}</Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Duration</Text>
              <Text style={styles.detailValue}>{sale.days}d</Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Price</Text>
              <Text style={styles.detailValue}>{sale.edge_cost} EC</Text>
            </View>
          </View>
          <View style={styles.detailsRow}>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Expires</Text>
              <Text style={styles.detailValue}>{formatDate(sale.expires_at)}</Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Time Remaining</Text>
              <Text style={[styles.detailValue, { color: palette.success }]}>{remaining}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.orderFooter}>
        <Coins color={palette.gold} size={13} />
        <Text style={styles.earningsLabel}>You Earned</Text>
        <Text style={styles.earningsValue}>+{sale.edge_cost} EC</Text>
      </View>
    </View>
  );
});

// ── History Order Card ─────────────────────────────────────────────────

const OrderCard = memo(function OrderCard({
  order,
  highlighted,
}: {
  order: VendorSale;
  highlighted: boolean;
}): JSX.Element {
  const status = mapOrderStatus(order.purchase_status, order.active);
  const sColor = statusColor(status);

  return (
    <View style={[styles.orderCard, highlighted && styles.orderCardHighlighted]}>
      <View style={styles.orderHeader}>
        <Text style={styles.orderDate}>{formatDate(order.created_at)}</Text>
        <View style={[styles.statusBadge, { borderColor: `${sColor}44`, backgroundColor: `${sColor}0E` }]}>
          {statusIcon(status)}
          <Text style={[styles.statusText, { color: sColor }]}>{status}</Text>
        </View>
      </View>

      <View style={styles.orderBody}>
        <View style={styles.orderImageSection}>
          <OptimizedEagohImage
            tone="cyan"
            label={order.eagoh_name}
            size="compact"
            imageUrl={order.eagoh_image_url}
            showLabel={false}
          />
        </View>
        <View style={styles.orderInfo}>
          <Text style={styles.eagohName} numberOfLines={1}>{order.eagoh_name}</Text>
          <View style={styles.buyerRow}>
            {order.buyer_avatar_url ? (
              <Image source={{ uri: order.buyer_avatar_url }} style={styles.buyerAvatar} contentFit="cover" />
            ) : (
              <View style={[styles.buyerAvatar, styles.buyerAvatarFallback]} />
            )}
            <Text style={styles.buyerName}>{order.buyer_display_name ?? "Anonymous"}</Text>
          </View>
          <View style={styles.detailsRow}>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Sync</Text>
              <Text style={styles.detailValue}>{order.sync_level}</Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Duration</Text>
              <Text style={styles.detailValue}>{order.days}d</Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Buyer Cost</Text>
              <Text style={styles.detailValue}>{order.edge_cost} EC</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.orderFooter}>
        <Coins color={palette.gold} size={13} />
        <Text style={styles.earningsLabel}>Vendor Earnings</Text>
        <Text style={styles.earningsValue}>+{order.edge_cost} EC</Text>
      </View>
    </View>
  );
});

// ── Section Header ─────────────────────────────────────────────────────

function SectionHeader({ icon, title, count, error, onRetry, retrying }: {
  icon: JSX.Element;
  title: string;
  count: number;
  error: boolean;
  onRetry: () => void;
  retrying: boolean;
}): JSX.Element {
  return (
    <View style={styles.sectionHeaderWrap}>
      <View style={styles.sectionHeader}>
        {icon}
        <Text style={styles.sectionTitle}>{title}</Text>
        {!error ? <Text style={styles.sectionCount}>{count}</Text> : null}
      </View>
      {error ? (
        <Pressable onPress={onRetry} disabled={retrying} style={styles.sectionRetryBtn}>
          {retrying ? (
            <ActivityIndicator color={palette.cyan} size="small" />
          ) : (
            <>
              <WifiOff color={palette.ember} size={12} />
              <Text style={styles.sectionRetryText}>Load failed — Retry</Text>
            </>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────

export default function SalesOrdersScreen(): JSX.Element {
  const { user } = useAuth();
  const h = useHaptics();
  const goBack = useSafeBack();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ purchaseId?: string }>();
  const highlightedId = typeof params.purchaseId === "string" ? params.purchaseId : null;

  // Independent, account-wide vendor datasets (never filtered by the
  // selected EAGOH, filters, domain, or tab). refetchOnMount "always"
  // rebuilds everything after a cold start.
  const activeQuery = useExchangeVendorActiveSyncs(user?.id);
  const historyQuery = useExchangeVendorSalesHistory(user?.id);
  const dashboardQuery = useExchangeVendorDashboard(user?.id);
  const unreadQuery = useExchangeVendorUnreadSales(user?.id);
  // Focus + AppState return-to-active refetch (first focus skipped — the
  // mount fetch already covers cold start).
  useExchangeVendorForegroundRefetch(user?.id);

  // ── Mark unread sale notifications as read when the screen opens ──
  // The badge update is OPTIMISTIC (same query key the Vendor Dashboard
  // badge reads), so it clears immediately. If the worker call fails, the
  // invalidation restores the true count — the badge never lies.
  const unread = unreadQuery.data ?? 0;
  useEffect(() => {
    if (unread <= 0 || !user?.id) return;
    queryClient.setQueryData([EXCHANGE_VENDOR_UNREAD_SALES_KEY, user.id], 0);
    void markUnreadSaleNotificationsRead().finally(() => {
      void queryClient.invalidateQueries({ queryKey: [EXCHANGE_VENDOR_UNREAD_SALES_KEY] });
    });
  }, [unread, user?.id, queryClient]);

  const activeSales = activeQuery.data ?? [];
  const history = historyQuery.data ?? [];

  const handleRetryActive = useCallback(() => { h.light(); void activeQuery.refetch(); }, [h, activeQuery]);
  const handleRetryHistory = useCallback(() => { h.light(); void historyQuery.refetch(); }, [h, historyQuery]);

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    h.light();
    setRefreshing(true);
    try {
      await Promise.allSettled([
        activeQuery.refetch(),
        historyQuery.refetch(),
        dashboardQuery.refetch(),
        unreadQuery.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [h, activeQuery, historyQuery, dashboardQuery, unreadQuery]);

  const isLoading =
    (activeQuery.isPending && !activeQuery.isError) &&
    (historyQuery.isPending && !historyQuery.isError);
  // Full-screen error only when BOTH sections failed with nothing cached —
  // one failed request must never erase the other section.
  const isFirstLoadError =
    activeQuery.isError && activeSales.length === 0 &&
    historyQuery.isError && history.length === 0;

  const handleFullRetry = useCallback(() => {
    h.light();
    void activeQuery.refetch();
    void historyQuery.refetch();
  }, [h, activeQuery, historyQuery]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={goBack} style={styles.backBtn} hitSlop={12}>
          <ChevronLeft color={palette.text} size={22} />
        </Pressable>
        <Text style={styles.headerTitle}>Sales & Orders</Text>
        <View style={{ width: 22 }} />
      </View>

      {isFirstLoadError ? (
        <View style={styles.errorContainer}>
          <WifiOff color={palette.muted} size={40} />
          <Text style={styles.errorTitle}>Unable to load Sales & Orders</Text>
          <Text style={styles.errorHint}>
            EAGOH could not reach the marketplace service. Check your connection and try again.
          </Text>
          <Pressable
            onPress={handleFullRetry}
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
          >
            <RotateCcw color={palette.void} size={15} />
            <Text style={styles.retryBtnText}>Try Again</Text>
          </Pressable>
        </View>
      ) : isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={palette.cyan} size="large" />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={palette.cyan}
              colors={[palette.cyan]}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <SummaryCard
            activeSyncs={activeSales.length}
            totalSales={dashboardQuery.data?.totalSales ?? 0}
            earnedThisMonth={dashboardQuery.data?.earnedThisMonth ?? 0}
          />

          {/* ── Active Customer Syncs ── */}
          <SectionHeader
            icon={<ShoppingBag color={palette.success} size={15} />}
            title="Active Customer Syncs"
            count={activeSales.length}
            error={activeQuery.isError && activeSales.length === 0}
            onRetry={handleRetryActive}
            retrying={activeQuery.isFetching}
          />
          {activeSales.length === 0 && !(activeQuery.isError && activeSales.length === 0) ? (
            <View style={styles.emptyContainer}>
              <PackageOpen color={palette.muted} size={32} />
              <Text style={styles.emptyTitleSmall}>No Active Customer Syncs</Text>
              <Text style={styles.emptyHint}>
                When someone purchases a sync of your EAGOH, it appears here with live time remaining.
              </Text>
            </View>
          ) : (
            activeSales.map((sale) => <ActiveSyncCard key={sale.id} sale={sale} />)
          )}

          {/* ── Sales History ── */}
          <View style={styles.sectionDivider} />
          <SectionHeader
            icon={<Crown color={palette.gold} size={15} />}
            title="Sales History"
            count={history.length}
            error={historyQuery.isError && history.length === 0}
            onRetry={handleRetryHistory}
            retrying={historyQuery.isFetching}
          />
          {history.length === 0 && !(historyQuery.isError && history.length === 0) ? (
            <View style={styles.emptyContainer}>
              <PackageOpen color={palette.muted} size={32} />
              <Text style={styles.emptyTitleSmall}>No Sales Yet</Text>
              <Text style={styles.emptyHint}>
                When someone purchases your EAGOH sync, the order will appear here.
              </Text>
            </View>
          ) : (
            history.map((order) => (
              <OrderCard key={order.id} order={order} highlighted={order.id === highlightedId} />
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.void,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: palette.text,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { flex: 1 },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  // Summary
  summaryCard: {
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: palette.line,
    overflow: "hidden",
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  summaryTitle: {
    color: palette.text,
    fontSize: 15,
    fontWeight: "900",
    flex: 1,
  },
  summaryGrid: {
    flexDirection: "row",
    gap: 10,
  },
  summaryItem: {
    flex: 1,
    alignItems: "center",
  },
  summaryValue: {
    color: palette.text,
    fontSize: 22,
    fontWeight: "900",
  },
  summaryLabel: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: "700",
    marginTop: 4,
    textAlign: "center",
  },
  // Section header
  sectionHeaderWrap: { marginBottom: 12 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  sectionTitle: {
    color: palette.text,
    fontSize: 14,
    fontWeight: "900",
    flex: 1,
  },
  sectionCount: {
    color: palette.cyan,
    fontSize: 12,
    fontWeight: "900",
  },
  sectionRetryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: `${palette.ember}44`,
    backgroundColor: `${palette.ember}0E`,
    marginBottom: 8,
  },
  sectionRetryText: { color: palette.ember, fontSize: 11, fontWeight: "800" },
  sectionDivider: { height: 1, backgroundColor: palette.line, marginVertical: 18 },
  // Order card
  orderCard: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    backgroundColor: palette.graphite,
    borderWidth: 1,
    borderColor: palette.line,
  },
  orderCardHighlighted: {
    borderColor: palette.gold,
    borderWidth: 1.5,
    shadowColor: palette.gold,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  orderHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  orderDate: {
    color: palette.muted,
    fontSize: 11,
    fontWeight: "600",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "900",
  },
  orderBody: {
    flexDirection: "row",
    gap: 12,
  },
  orderImageSection: {
    width: 64,
    height: 64,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: palette.obsidian,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
  },
  orderInfo: {
    flex: 1,
  },
  eagohName: {
    color: palette.text,
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 6,
  },
  buyerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  buyerAvatarLarge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
  },
  buyerAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: palette.line,
  },
  buyerAvatarFallback: {
    backgroundColor: palette.obsidian,
    alignItems: "center",
    justifyContent: "center",
  },
  buyerAvatarInitial: {
    color: palette.cyan,
    fontSize: 13,
    fontWeight: "900",
  },
  buyerName: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  buyerNameLarge: {
    color: palette.text,
    fontSize: 14,
    fontWeight: "900",
  },
  detailsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 2,
  },
  detailItem: {
    flex: 1,
  },
  detailLabel: {
    color: palette.muted,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  detailValue: {
    color: palette.text,
    fontSize: 12,
    fontWeight: "800",
  },
  orderFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: palette.line,
  },
  earningsLabel: {
    color: palette.muted,
    fontSize: 11,
    fontWeight: "700",
    flex: 1,
  },
  earningsValue: {
    color: palette.gold,
    fontSize: 14,
    fontWeight: "900",
  },
  // Empty
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 28,
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(10,20,38,0.35)",
    marginBottom: 12,
  },
  emptyTitleSmall: {
    color: palette.text,
    fontSize: 14,
    fontWeight: "900",
  },
  emptyHint: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    paddingHorizontal: 28,
    lineHeight: 18,
  },
  // First-load error
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  errorTitle: {
    color: palette.text,
    fontSize: 17,
    fontWeight: "900",
    textAlign: "center",
  },
  errorHint: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 8,
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: palette.cyan,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  retryBtnText: {
    color: palette.void,
    fontSize: 14,
    fontWeight: "900",
  },
});
