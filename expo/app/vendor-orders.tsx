/**
 * Sales & Orders — Vendor purchase order history.
 *
 * Shows summary totals (Sales This Month, EC Earned This Month, Lifetime Sales)
 * and a list of vendor purchase orders derived from marketplace_sync_purchases.
 *
 * Each order shows: Order ID, EAGOH name + image, buyer display name,
 * purchased percentage, duration, purchase date, total buyer cost,
 * vendor earnings, and status (Active, Completed, Refunded, Reversed).
 *
 * Newest orders first. Uses React Query for caching + auto-refresh.
 */

import { palette } from "@/constants/colors";
import { useHaptics } from "@/hooks/useHaptics";
import { useSafeBack } from "@/hooks/useSafeBack";
import { useAuth } from "@/providers/AuthProvider";
import { getVendorOrders, getVendorEarningsSummary, type VendorOrder, type VendorEarningsSummary } from "@/services/vendorOrders";
import { OptimizedEagohImage } from "@/app/_components/PerformancePrimitives";
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
} from "lucide-react-native";
import React, { memo, useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";

// ── Status helpers ─────────────────────────────────────────────────────

function statusColor(status: string): string {
  switch (status) {
    case "Active": return palette.success;
    case "Completed": return palette.cyan;
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

// ── Summary Card ───────────────────────────────────────────────────────

const SummaryCard = memo(function SummaryCard({ summary }: { summary: VendorEarningsSummary | undefined }): JSX.Element {
  return (
    <View style={styles.summaryCard}>
      <LinearGradient colors={["rgba(255,181,71,0.14)", "rgba(10,20,38,0.92)"]} style={StyleSheet.absoluteFill} />
      <View style={styles.summaryHeader}>
        <TrendingUp color={palette.gold} size={18} />
        <Text style={styles.summaryTitle}>Sales & Orders</Text>
      </View>
      <View style={styles.summaryGrid}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{summary?.salesThisMonth ?? 0}</Text>
          <Text style={styles.summaryLabel}>Sales This Month</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: palette.gold }]}>{summary?.earnedThisMonth ?? 0}</Text>
          <Text style={styles.summaryLabel}>EC Earned</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: palette.cyan }]}>{summary?.lifetimeSales ?? 0}</Text>
          <Text style={styles.summaryLabel}>Lifetime Sales</Text>
        </View>
      </View>
    </View>
  );
});

// ── Order Card ─────────────────────────────────────────────────────────

const OrderCard = memo(function OrderCard({ order }: { order: VendorOrder }): JSX.Element {
  const sColor = statusColor(order.status);
  const orderIdShort = order.id.slice(0, 8).toUpperCase();

  return (
    <View style={styles.orderCard}>
      <View style={styles.orderHeader}>
        <View style={styles.orderHeaderLeft}>
          <Text style={styles.orderId}>#{orderIdShort}</Text>
          <Text style={styles.orderDate}>{formatDate(order.created_at)}</Text>
        </View>
        <View style={[styles.statusBadge, { borderColor: `${sColor}44`, backgroundColor: `${sColor}0E` }]}>
          {statusIcon(order.status)}
          <Text style={[styles.statusText, { color: sColor }]}>{order.status}</Text>
        </View>
      </View>

      <View style={styles.orderBody}>
        {/* EAGOH Image */}
        <View style={styles.orderImageSection}>
          <OptimizedEagohImage
            tone="cyan"
            label={order.eagoh_name}
            size="compact"
            imageUrl={order.eagoh_image_url}
            showLabel={false}
          />
        </View>

        {/* Info */}
        <View style={styles.orderInfo}>
          <Text style={styles.eagohName} numberOfLines={1}>{order.eagoh_name}</Text>

          {/* Buyer */}
          <View style={styles.buyerRow}>
            {order.buyer_avatar_url ? (
              <Image source={{ uri: order.buyer_avatar_url }} style={styles.buyerAvatar} contentFit="cover" />
            ) : (
              <View style={[styles.buyerAvatar, styles.buyerAvatarFallback]} />
            )}
            <Text style={styles.buyerName}>{order.buyer_display_name ?? "Anonymous"}</Text>
          </View>

          {/* Details */}
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

      {/* Earnings footer */}
      <View style={styles.orderFooter}>
        <Coins color={palette.gold} size={13} />
        <Text style={styles.earningsLabel}>Vendor Earnings</Text>
        <Text style={styles.earningsValue}>+{order.vendor_earnings} EC</Text>
      </View>
    </View>
  );
});

// ── Main Screen ────────────────────────────────────────────────────────

export default function SalesOrdersScreen(): JSX.Element {
  const { user } = useAuth();
  const h = useHaptics();
  const queryClient = useQueryClient();
  const goBack = useSafeBack();

  const ordersQuery = useQuery<VendorOrder[]>({
    queryKey: ["vendorOrders", user?.id],
    queryFn: () => getVendorOrders(user!.id),
    staleTime: 30_000,
    enabled: !!user?.id,
  });

  const summaryQuery = useQuery<VendorEarningsSummary>({
    queryKey: ["vendorEarningsSummary", user?.id],
    queryFn: () => getVendorEarningsSummary(user!.id),
    staleTime: 30_000,
    enabled: !!user?.id,
  });

  const handleRefresh = useCallback(() => {
    h.light();
    queryClient.invalidateQueries({ queryKey: ["vendorOrders", user?.id] });
    queryClient.invalidateQueries({ queryKey: ["vendorEarningsSummary", user?.id] });
  }, [h, queryClient, user?.id]);

  const orders = ordersQuery.data ?? [];
  const isLoading = ordersQuery.isLoading && orders.length === 0;

  const renderItem = useCallback(({ item }: { item: VendorOrder }) => (
    <OrderCard order={item} />
  ), []);

  const ListHeader = useCallback(() => (
    <View>
      <SummaryCard summary={summaryQuery.data} />
      <View style={styles.sectionHeader}>
        <ShoppingBag color={palette.cyan} size={15} />
        <Text style={styles.sectionTitle}>Order History</Text>
        <Text style={styles.sectionCount}>{orders.length}</Text>
      </View>
    </View>
  ), [summaryQuery.data, orders.length]);

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

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={palette.cyan} size="large" />
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={
            !ordersQuery.isLoading ? (
              <View style={styles.emptyContainer}>
                <PackageOpen color={palette.muted} size={40} />
                <Text style={styles.emptyTitle}>No Sales Yet</Text>
                <Text style={styles.emptyHint}>
                  When someone purchases your EAGOH sync, the order will appear here.
                </Text>
              </View>
            ) : null
          }
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={ordersQuery.isRefetching || summaryQuery.isRefetching}
              onRefresh={handleRefresh}
              tintColor={palette.cyan}
              colors={[palette.cyan]}
            />
          }
          showsVerticalScrollIndicator={false}
        />
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
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
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
  // Order card
  orderCard: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    backgroundColor: palette.graphite,
    borderWidth: 1,
    borderColor: palette.line,
  },
  orderHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  orderHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  orderId: {
    color: palette.cyan,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
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
    gap: 6,
    marginBottom: 8,
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
  },
  buyerName: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  detailsRow: {
    flexDirection: "row",
    gap: 12,
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
    justifyContent: "center",
    paddingVertical: 60,
    gap: 12,
  },
  emptyTitle: {
    color: palette.text,
    fontSize: 16,
    fontWeight: "900",
  },
  emptyHint: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    paddingHorizontal: 40,
    lineHeight: 20,
  },
});
