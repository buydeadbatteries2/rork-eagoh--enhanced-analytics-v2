/**
 * NeuronActivity — displays the authenticated user's Neuron transaction
 * history from the `edge_transactions` table.
 *
 * Settings preview: shows only the 5 most recent transactions in a compact
 * layout with a "View All Neuron Activity" button.
 *
 * Full history: tapping the button opens a full-screen modal with all
 * transactions (newest first), filter tabs (All, Purchases, Spending,
 * Rewards, Refunds, Subscription), and complete transaction details.
 *
 * Data source: edge_transactions table (RLS-enforced, user_id = auth user).
 * Uses the shared React Query cache key from EdgeProvider so any mutation
 * (purchase, deduction, reward, refund) automatically refreshes this list.
 */

import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Award,
  ChevronRight,
  Crown,
  Gift,
  RotateCcw,
  ShoppingBag,
  Sparkles,
  X,
  Zap,
} from "lucide-react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { palette } from "@/constants/colors";
import { useHaptics } from "@/hooks/useHaptics";
import { listTransactions, type EdgeTransaction } from "@/services/edge";

type P = typeof palette;

const PREVIEW_COUNT = 5;

// ── Reason → user-friendly display mapping ───────────────────────────────

const REASON_TITLES: Record<string, string> = {
  quick_check: "Quick Check",
  quick_analysis: "Quick Analysis",
  standard_analysis: "Standard Analysis",
  oracle_dive: "Oracle Deep Dive",
  premium_event: "Premium Event Analysis",
  arena: "Arena Analysis",
  observation: "Open Intelligence Entry",
  marketplace: "Marketplace Sync",
  customization: "Customization",
  forge_initial: "Forge Creation",
  forge_full_reforge: "Full Reforge",
  forge_partial_reforge: "Partial Reforge",
  rename_eagoh: "EAGOH Rename",
  subscription_allocation: "Subscription Allocation",
  rollover: "Monthly Rollover",
  purchase: "Neuron Pack Purchase",
  faction_slot_expansion: "Faction Slot Expansion",
  sponsored_banner: "Banner Promotion",
  eagoh_slot_purchase: "EAGOH Slot Purchase",
  manual: "Manual Adjustment",
  social_share_reward: "Social Share Reward",
  arena_refund: "Arena Refund",
};

const BUCKET_LABELS: Record<string, string> = {
  subscription: "Subscription",
  purchased: "Purchased",
  mixed: "Mixed",
};

// ── Filter definitions ───────────────────────────────────────────────────

type ActivityFilter = "all" | "purchases" | "spending" | "rewards" | "refunds" | "subscription";

const FILTERS: { id: ActivityFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "purchases", label: "Purchases" },
  { id: "spending", label: "Spending" },
  { id: "rewards", label: "Rewards" },
  { id: "refunds", label: "Refunds" },
  { id: "subscription", label: "Subscription" },
];

/**
 * Determines whether a transaction is a refund. Refunds can have:
 * - reason = "arena_refund" (Arena refund RPC)
 * - reason = "sponsored_banner" + kind = "addition" + note contains "BANNER REFUND"
 */
function isRefund(tx: EdgeTransaction): boolean {
  const reason = tx.reason as string;
  if (reason === "arena_refund") return true;
  if (reason === "sponsored_banner" && tx.kind === "addition" && tx.note?.includes("BANNER REFUND")) return true;
  return false;
}

/** Returns the user-friendly title for a transaction, with "Refund: " prefix for refunds. */
function getTransactionTitle(tx: EdgeTransaction): string {
  const base = REASON_TITLES[tx.reason] ?? "Neuron Activity";
  if (isRefund(tx)) return `Refund: ${base}`;
  return base;
}

/** Returns true if the transaction is an addition (credit) vs deduction (debit). */
function isAddition(tx: EdgeTransaction): boolean {
  return tx.kind === "addition" || tx.kind === "rollover" || tx.kind === "purchase" || isRefund(tx);
}

/** Applies the selected filter to a transaction list. */
function applyFilter(txs: EdgeTransaction[], filter: ActivityFilter): EdgeTransaction[] {
  if (filter === "all") return txs;
  if (filter === "purchases") return txs.filter((t) => t.kind === "purchase");
  if (filter === "spending") return txs.filter((t) => t.kind === "deduction" && !isRefund(t));
  if (filter === "rewards") {
    return txs.filter(
      (t) =>
        t.kind === "addition" &&
        !isRefund(t) &&
        ((t.reason as string) === "social_share_reward" || t.reason === "manual" || t.reason === "marketplace"),
    );
  }
  if (filter === "refunds") return txs.filter((t) => isRefund(t));
  if (filter === "subscription") {
    return txs.filter((t) => t.reason === "subscription_allocation" || t.reason === "rollover");
  }
  return txs;
}

// ── Date formatting ──────────────────────────────────────────────────────

function formatDateTime(isoStr: string): string {
  const date = new Date(isoStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatTimeAgo(isoStr: string): string {
  const now = Date.now();
  const then = new Date(isoStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return formatDateTime(isoStr);
}

// ── Filter Tab Bar ───────────────────────────────────────────────────────

function FilterTab({
  label,
  active,
  onPress,
  pal,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  pal: P;
}): JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        filterStyles.tab,
        active && { backgroundColor: pal.blueSoft, borderColor: pal.blue },
        pressed && { opacity: 0.7 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Filter transactions by ${label}`}
      accessibilityState={{ selected: active }}
    >
      <Text
        numberOfLines={1}
        style={[
          filterStyles.tabText,
          { color: active ? pal.cyan : pal.muted },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const filterStyles = StyleSheet.create({
  tab: {
    // Compact chip: fixed row-height footprint, centered content. Grows
    // WIDER with text (never vertically) — no flex: 1, no percentage height.
    height: 34,
    minHeight: 34,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "rgba(120,180,255,0.18)",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    alignSelf: "center" as const,
    flexShrink: 0,
  },
  tabText: {
    fontSize: 11,
    fontWeight: "900" as const,
    letterSpacing: 0.3,
  },
});

// ── Transaction Row ──────────────────────────────────────────────────────

function TransactionRow({
  tx,
  pal,
  compact = false,
}: {
  tx: EdgeTransaction;
  pal: P;
  compact?: boolean;
}): JSX.Element {
  const title = getTransactionTitle(tx);
  const credit = isAddition(tx);
  const refund = isRefund(tx);
  const bucketLabel = BUCKET_LABELS[tx.bucket] ?? "Mixed";
  const remainingBalance = (tx.balance_subscription_after ?? 0) + (tx.balance_purchased_after ?? 0);

  // Icon based on transaction type
  const Icon = refund
    ? RotateCcw
    : credit
      ? tx.kind === "purchase"
        ? ShoppingBag
        : tx.reason === "subscription_allocation" || tx.reason === "rollover"
          ? Crown
          : (tx.reason as string) === "social_share_reward"
            ? Gift
            : Award
      : tx.reason === "sponsored_banner"
        ? Sparkles
        : tx.reason === "forge_initial" || tx.reason === "forge_full_reforge" || tx.reason === "forge_partial_reforge"
          ? Zap
          : ArrowDownCircle;

  const iconColor = refund
    ? pal.success
    : credit
      ? pal.success
      : pal.ember;

  const amountColor = refund
    ? pal.success
    : credit
      ? pal.success
      : pal.ember;

  return (
    <View style={compact ? txStylesCompact.container : txStyles.container}>
      <View style={compact ? txStylesCompact.iconWrap(iconColor) : txStyles.iconWrap(iconColor)}>
        <Icon color={iconColor} size={compact ? 14 : 16} />
      </View>

      <View style={compact ? txStylesCompact.content : txStyles.content}>
        <View style={compact ? txStylesCompact.topRow : txStyles.topRow}>
          <Text style={compact ? txStylesCompact.title : txStyles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={compact ? txStylesCompact.amount(amountColor) : txStyles.amount(amountColor)}>
            {credit ? "+" : "−"}
            {tx.amount}
          </Text>
        </View>

        <View style={compact ? txStylesCompact.metaRow : txStyles.metaRow}>
          <Text style={compact ? txStylesCompact.bucketText : txStyles.bucketText}>{bucketLabel}</Text>
          <Text style={compact ? txStylesCompact.dot : txStyles.dot}>·</Text>
          <Text style={compact ? txStylesCompact.timeText : txStyles.timeText}>{formatTimeAgo(tx.created_at)}</Text>
          {!compact && tx.note && !refund && (
            <>
              <Text style={txStyles.dot}>·</Text>
              <Text style={txStyles.noteText} numberOfLines={1}>
                {tx.note.length > 40 ? `${tx.note.slice(0, 38)}…` : tx.note}
              </Text>
            </>
          )}
        </View>

        {!compact && (
          <View style={txStyles.balanceRow}>
            <Text style={txStyles.balanceLabel}>Balance after</Text>
            <Text style={txStyles.balanceValue}>{remainingBalance} Neurons</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const txStyles = StyleSheet.create({
  container: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 5,
    backgroundColor: "rgba(10,20,40,0.55)",
    borderWidth: 1,
    borderColor: "rgba(120,180,255,0.12)",
  },
  iconWrap: (color: string) => ({
    width: 32,
    height: 32,
    borderRadius: 5,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: color === palette.success ? palette.successSoft : palette.emberSoft,
    borderWidth: 1,
    borderColor: color === palette.success ? "rgba(0,255,178,0.22)" : "rgba(255,77,109,0.22)",
  }),
  content: {
    flex: 1,
    gap: 4,
  },
  topRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between",
    gap: 8,
  },
  title: {
    color: palette.text,
    fontSize: 13,
    fontWeight: "900" as const,
    flex: 1,
  },
  amount: (color: string) => ({
    color,
    fontSize: 15,
    fontWeight: "900" as const,
    fontVariant: ["tabular-nums" as never],
  }),
  metaRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    flexWrap: "wrap" as const,
  },
  bucketText: {
    color: palette.cyan,
    fontSize: 10,
    fontWeight: "800" as const,
    letterSpacing: 0.3,
  },
  dot: {
    color: palette.muted,
    fontSize: 10,
  },
  timeText: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: "700" as const,
  },
  noteText: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: "600" as const,
    flex: 1,
  },
  balanceRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    marginTop: 2,
  },
  balanceLabel: {
    color: palette.muted,
    fontSize: 9,
    fontWeight: "700" as const,
    letterSpacing: 0.3,
    textTransform: "uppercase" as const,
  },
  balanceValue: {
    color: palette.text,
    fontSize: 11,
    fontWeight: "800" as const,
  },
});

const txStylesCompact = StyleSheet.create({
  container: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 5,
    backgroundColor: "rgba(10,20,40,0.55)",
    borderWidth: 1,
    borderColor: "rgba(120,180,255,0.12)",
  },
  iconWrap: (color: string) => ({
    width: 26,
    height: 26,
    borderRadius: 4,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: color === palette.success ? palette.successSoft : palette.emberSoft,
    borderWidth: 1,
    borderColor: color === palette.success ? "rgba(0,255,178,0.22)" : "rgba(255,77,109,0.22)",
  }),
  content: {
    flex: 1,
    gap: 2,
  },
  topRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between",
    gap: 6,
  },
  title: {
    color: palette.text,
    fontSize: 12,
    fontWeight: "800" as const,
    flex: 1,
  },
  amount: (color: string) => ({
    color,
    fontSize: 13,
    fontWeight: "900" as const,
    fontVariant: ["tabular-nums" as never],
  }),
  metaRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 3,
    flexWrap: "wrap" as const,
  },
  bucketText: {
    color: palette.cyan,
    fontSize: 9,
    fontWeight: "700" as const,
    letterSpacing: 0.2,
  },
  dot: {
    color: palette.muted,
    fontSize: 9,
  },
  timeText: {
    color: palette.muted,
    fontSize: 9,
    fontWeight: "600" as const,
  },
});

// ── Empty state styles ───────────────────────────────────────────────────

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

const countStyles = StyleSheet.create({
  text: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: "800" as const,
    letterSpacing: 0.5,
    textTransform: "uppercase" as const,
    paddingBottom: 2,
  },
});

// ── Full-screen Modal ────────────────────────────────────────────────────

function NeuronActivityModal({
  visible,
  onClose,
  allTxs,
  pal,
}: {
  visible: boolean;
  onClose: () => void;
  allTxs: EdgeTransaction[];
  pal: P;
}): JSX.Element {
  const h = useHaptics();
  const [activeFilter, setActiveFilter] = useState<ActivityFilter>("all");

  // Reset filter when modal opens
  useEffect(() => {
    if (visible) setActiveFilter("all");
  }, [visible]);

  const filtered = useMemo(
    () => applyFilter(allTxs, activeFilter),
    [allTxs, activeFilter],
  );

  const handleFilterPress = useCallback(
    (filter: ActivityFilter) => {
      h.selection();
      setActiveFilter(filter);
    },
    [h],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={modalStyles.container}>
        {/* Header */}
        <View style={modalStyles.header}>
          <Text style={modalStyles.headerTitle}>Neuron Activity</Text>
          <Pressable
            onPress={() => { h.selection(); onClose(); }}
            style={({ pressed }) => [modalStyles.closeBtn, pressed && { opacity: 0.7 }]}
            accessibilityLabel="Close Neuron Activity"
            accessibilityRole="button"
          >
            <X color={palette.text} size={20} />
          </Pressable>
        </View>

        {/* Filter tabs — compact horizontally scrollable row. The bar is
            height-locked so it can never expand vertically into columns. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={modalStyles.filterBar}
          contentContainerStyle={modalStyles.filterBarContent}
        >
          {FILTERS.map((f) => (
            <FilterTab
              key={f.id}
              label={f.label}
              active={activeFilter === f.id}
              onPress={() => handleFilterPress(f.id)}
              pal={pal}
            />
          ))}
        </ScrollView>

        {/* Transaction count */}
        <Text style={[countStyles.text, { paddingHorizontal: 16, paddingBottom: 6 }]}>
          {filtered.length} transaction{filtered.length !== 1 ? "s" : ""}
          {activeFilter !== "all" ? ` in ${FILTERS.find((f) => f.id === activeFilter)?.label}` : ""}
        </Text>

        {/* Full transaction list */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ gap: 4, paddingHorizontal: 16, paddingBottom: 24 }}
          showsVerticalScrollIndicator
        >
          {filtered.length === 0 ? (
            <View style={emptyStyles.container}>
              <Text style={emptyStyles.subtext}>
                No transactions in this category.
              </Text>
            </View>
          ) : (
            filtered.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} pal={pal} />
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050D18",
    paddingTop: 56,
  },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    color: palette.text,
    fontSize: 18,
    fontWeight: "900" as const,
    letterSpacing: 0.3,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: "rgba(120,180,255,0.12)",
  },
  // Compact filter row: constrained so the horizontal ScrollView can never
  // grow vertically — chips stay centered in a single ~44pt row.
  filterBar: {
    flexGrow: 0,
    flexShrink: 0,
    height: 44,
  },
  filterBarContent: {
    alignItems: "center" as const,
    justifyContent: "flex-start" as const,
    gap: 6,
    paddingHorizontal: 16,
  },
});

// ── Main Component (Settings Preview) ────────────────────────────────────

function NeuronActivityImpl({
  userId,
  pal,
}: {
  userId: string | null;
  pal: P;
}): JSX.Element {
  const h = useHaptics();
  const queryClient = useQueryClient();
  const [modalVisible, setModalVisible] = useState(false);

  // Share the same cache key as EdgeProvider so mutations auto-refresh
  const txKey = useMemo(
    () => ["edge", "transactions", userId ?? "anon"] as const,
    [userId],
  );

  const { data: transactions, isLoading } = useQuery<EdgeTransaction[]>({
    queryKey: txKey,
    enabled: !!userId,
    queryFn: () => (userId ? listTransactions(userId, 75) : Promise.resolve([])),
    staleTime: 15 * 1000,
  });

  const allTxs = useMemo(() => transactions ?? [], [transactions]);

  // Only 5 most recent for the Settings preview
  const previewTxs = useMemo(
    () => allTxs.slice(0, PREVIEW_COUNT),
    [allTxs],
  );

  // Refresh on mount
  useEffect(() => {
    if (userId) {
      queryClient.invalidateQueries({ queryKey: ["edge", "transactions", userId] });
    }
  }, [userId, queryClient]);

  const handleViewAll = useCallback(() => {
    h.selection();
    setModalVisible(true);
  }, [h]);

  if (isLoading) {
    return (
      <View style={{ paddingVertical: 20, alignItems: "center" }}>
        <ActivityIndicator color={pal.cyan} size="small" />
      </View>
    );
  }

  if (allTxs.length === 0) {
    return (
      <View style={emptyStyles.container}>
        <Zap color={pal.muted} size={22} />
        <Text style={emptyStyles.text}>No Neuron activity yet</Text>
        <Text style={emptyStyles.subtext}>
          Your transaction history will appear here as you use Neurons.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 4 }}>
      {/* Compact preview rows (max 5, newest first) */}
      {previewTxs.map((tx) => (
        <TransactionRow key={tx.id} tx={tx} pal={pal} compact />
      ))}

      {/* View All button */}
      <Pressable
        onPress={handleViewAll}
        style={({ pressed }) => [
          viewAllStyles.button,
          pressed && { opacity: 0.7 },
        ]}
        accessibilityLabel="View All Neuron Activity"
        accessibilityRole="button"
      >
        <Text style={viewAllStyles.text}>View All Neuron Activity</Text>
        <ChevronRight color={pal.cyan} size={16} />
      </Pressable>

      {/* Full-screen modal with complete history + filters */}
      <NeuronActivityModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        allTxs={allTxs}
        pal={pal}
      />
    </View>
  );
}

const viewAllStyles = StyleSheet.create({
  button: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: "rgba(0,200,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(0,200,255,0.25)",
    marginTop: 4,
  },
  text: {
    color: palette.cyan,
    fontSize: 12,
    fontWeight: "900" as const,
    letterSpacing: 0.3,
  },
});

const NeuronActivity = memo(NeuronActivityImpl);
export default NeuronActivity;
