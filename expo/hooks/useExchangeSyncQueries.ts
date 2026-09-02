import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useFocusEffect } from "expo-router";
import { getActiveSyncs, getMyPurchases, type EnrichedPurchase } from "@/services/marketplace";
import {
  getUnreadSaleCount,
  getVendorActiveSyncs,
  getVendorDashboardStats,
  getVendorSalesHistory,
  type VendorDashboardStats,
  type VendorSale,
} from "@/services/vendorSales";

/**
 * Phase D2.3Q — durable Exchange sync datasets.
 *
 * Active Syncs and Purchase History are rebuilt from Supabase
 * (public.marketplace_sync_purchases, the authoritative source) as two
 * INDEPENDENT React Query queries keyed by the authenticated buyer user ID:
 *
 *   ["exchange-active-syncs", userId]      → active = true (+ completed status)
 *   ["exchange-purchase-history", userId]  → all statuses, newest first
 *
 * Both are account-wide: never filtered by the selected buyer EAGOH, domain,
 * sport, marketplace filters, listing visibility, or the current tab. A
 * marketplace listing/filter failure can never erase or block either dataset,
 * and a Purchase History failure can never erase Active Syncs (or vice versa).
 *
 * Lifecycle triggers:
 *   - enabled only when the authenticated user ID is available
 *   - refetchOnMount: "always" → rebuilt after every cold start
 *   - retry transient failures (2 retries, exponential backoff)
 *   - placeholderData keeps previous data visible during refetch — valid
 *     cached data is never replaced with [] because a request failed
 *   - refetch on Exchange screen focus (re-focus only; the mount fetch is
 *     covered by refetchOnMount, so no duplicate request on cold start)
 *   - refetch when AppState returns to active from background/inactive
 *   - after a successful purchase: invalidate both keys (each active query
 *     refetches exactly once) — no optimistic row, no repeat of the
 *     purchase RPC
 *
 * Diagnostics are development-only and contain only: query name, result
 * count, success/failure, and a safe Supabase error code. Never UUIDs,
 * JWTs, emails, balances, full database errors, or purchase payloads.
 */

export const EXCHANGE_ACTIVE_SYNCS_KEY = "exchange-active-syncs";
export const EXCHANGE_PURCHASE_HISTORY_KEY = "exchange-purchase-history";

/** Extracts a safe Supabase/PostgREST error code (or undefined) from any thrown value. */
function safeErrorCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return undefined;
}

/** Dev-only diagnostic: query name, count, success/failure, safe error code. */
function logSyncDiagnostic(name: string, ok: boolean, count: number, code?: string): void {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  console.log(
    `[exchange-syncs] ${name} ok=${ok} count=${count}${code ? ` code=${code}` : ""}`,
  );
}

/**
 * Active Syncs query options: buyer's currently active, completed sync
 * purchases (expired ones drop out automatically; they remain in history).
 */
export function exchangeActiveSyncsQueryOptions(userId: string | undefined) {
  return {
    queryKey: [EXCHANGE_ACTIVE_SYNCS_KEY, userId] as const,
    queryFn: async (): Promise<EnrichedPurchase[]> => {
      if (!userId) return [];
      try {
        const rows = await getActiveSyncs(userId);
        logSyncDiagnostic(EXCHANGE_ACTIVE_SYNCS_KEY, true, rows.length);
        return rows;
      } catch (err) {
        logSyncDiagnostic(EXCHANGE_ACTIVE_SYNCS_KEY, false, 0, safeErrorCode(err));
        throw err;
      }
    },
    enabled: !!userId,
    refetchOnMount: "always" as const,
    staleTime: 0,
    retry: 2,
    placeholderData: keepPreviousData,
    gcTime: 30 * 60_000,
  };
}

/**
 * Purchase History query options: the buyer's complete user-owned,
 * read-only purchase history — active, expired, refunded, reversed, and
 * otherwise inactive purchases — newest first. Never gated on subscription
 * tier: a temporary free resolution during profile hydration must not hide
 * an authenticated buyer's own history.
 */
export function exchangePurchaseHistoryQueryOptions(userId: string | undefined) {
  return {
    queryKey: [EXCHANGE_PURCHASE_HISTORY_KEY, userId] as const,
    queryFn: async (): Promise<EnrichedPurchase[]> => {
      if (!userId) return [];
      try {
        const rows = await getMyPurchases(userId);
        logSyncDiagnostic(EXCHANGE_PURCHASE_HISTORY_KEY, true, rows.length);
        return rows;
      } catch (err) {
        logSyncDiagnostic(EXCHANGE_PURCHASE_HISTORY_KEY, false, 0, safeErrorCode(err));
        throw err;
      }
    },
    enabled: !!userId,
    refetchOnMount: "always" as const,
    staleTime: 0,
    retry: 2,
    placeholderData: keepPreviousData,
    gcTime: 30 * 60_000,
  };
}

/** Independent Active Syncs query for the authenticated buyer. */
export function useExchangeActiveSyncs(userId: string | undefined) {
  return useQuery<EnrichedPurchase[]>(exchangeActiveSyncsQueryOptions(userId));
}

/** Independent Purchase History query for the authenticated buyer. */
export function useExchangePurchaseHistory(userId: string | undefined) {
  return useQuery<EnrichedPurchase[]>(exchangePurchaseHistoryQueryOptions(userId));
}

/**
 * Refetch both sync datasets exactly once each (active observers only).
 * Used after a successful purchase: invalidate both keys — React Query
 * refetches each active query exactly once. No optimistic purchase row is
 * created and the purchase RPC is never repeated.
 */
export function invalidateExchangeSyncQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: [EXCHANGE_ACTIVE_SYNCS_KEY] });
  void queryClient.invalidateQueries({ queryKey: [EXCHANGE_PURCHASE_HISTORY_KEY] });
}

/**
 * Lifecycle refetch for the Exchange screen: refetch both datasets when the
 * screen re-focuses and when AppState returns to active from
 * background/inactive. The initial focus run is skipped — refetchOnMount
 * "always" already covers the cold-start fetch — so no duplicate listeners
 * or request loops are created.
 */
export function useExchangeSyncForegroundRefetch(userId: string | undefined): void {
  const queryClient = useQueryClient();

  const refetchBoth = useCallback(() => {
    if (!userId) return;
    void queryClient.refetchQueries({
      queryKey: [EXCHANGE_ACTIVE_SYNCS_KEY, userId],
      type: "active",
    });
    void queryClient.refetchQueries({
      queryKey: [EXCHANGE_PURCHASE_HISTORY_KEY, userId],
      type: "active",
    });
  }, [queryClient, userId]);

  // Screen focus — first (mount) focus is intentionally skipped.
  const firstFocusRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!firstFocusRef.current) {
        firstFocusRef.current = true;
        return;
      }
      refetchBoth();
    }, [refetchBoth]),
  );

  // AppState background/inactive → active. The listener is registered once
  // and only fires on transitions, never on initial mount.
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      if (previousState !== "active" && nextState === "active") {
        refetchBoth();
      }
    });
    return () => subscription.remove();
  }, [refetchBoth]);
}

// ==========================================================================
// Phase D2.3R — VENDOR sale visibility datasets.
//
// All vendor queries are ACCOUNT-WIDE: keyed by the authenticated user ID
// as vendor_id and never filtered by the selected EAGOH, marketplace
// filters, domain, or the current tab. They are fully INDEPENDENT of each
// other and of the buyer/marketplace queries — one failing request can
// never erase or block another dataset.
//
//   ["exchange-vendor-active-syncs", userId]  → active customer syncs
//   ["exchange-vendor-sales-history", userId] → all statuses, newest first
//   ["exchange-vendor-unread-sales", userId]  → unread exchange_sale count
//   ["exchange-vendor-dashboard", userId]     → headline dashboard stats
//
// Lifecycle: refetchOnMount "always" (cold start), retry, refetch on
// Exchange/Sales & Orders focus and on AppState return to active, and
// invalidation after a successful sale notification flow.
// ==========================================================================

export const EXCHANGE_VENDOR_ACTIVE_SYNCS_KEY = "exchange-vendor-active-syncs";
export const EXCHANGE_VENDOR_SALES_HISTORY_KEY = "exchange-vendor-sales-history";
export const EXCHANGE_VENDOR_UNREAD_SALES_KEY = "exchange-vendor-unread-sales";
export const EXCHANGE_VENDOR_DASHBOARD_KEY = "exchange-vendor-dashboard";

/** Vendor Active Customer Syncs query options (account-wide, newest first). */
export function exchangeVendorActiveSyncsQueryOptions(vendorId: string | undefined) {
  return {
    queryKey: [EXCHANGE_VENDOR_ACTIVE_SYNCS_KEY, vendorId] as const,
    queryFn: async (): Promise<VendorSale[]> => {
      if (!vendorId) return [];
      try {
        const rows = await getVendorActiveSyncs(vendorId);
        logSyncDiagnostic(EXCHANGE_VENDOR_ACTIVE_SYNCS_KEY, true, rows.length);
        return rows;
      } catch (err) {
        logSyncDiagnostic(EXCHANGE_VENDOR_ACTIVE_SYNCS_KEY, false, 0, safeErrorCode(err));
        throw err;
      }
    },
    enabled: !!vendorId,
    refetchOnMount: "always" as const,
    staleTime: 0,
    retry: 2,
    placeholderData: keepPreviousData,
    gcTime: 30 * 60_000,
  };
}

/** Vendor Sales History query options: ALL statuses, never trimmed. */
export function exchangeVendorSalesHistoryQueryOptions(vendorId: string | undefined) {
  return {
    queryKey: [EXCHANGE_VENDOR_SALES_HISTORY_KEY, vendorId] as const,
    queryFn: async (): Promise<VendorSale[]> => {
      if (!vendorId) return [];
      try {
        const rows = await getVendorSalesHistory(vendorId);
        logSyncDiagnostic(EXCHANGE_VENDOR_SALES_HISTORY_KEY, true, rows.length);
        return rows;
      } catch (err) {
        logSyncDiagnostic(EXCHANGE_VENDOR_SALES_HISTORY_KEY, false, 0, safeErrorCode(err));
        throw err;
      }
    },
    enabled: !!vendorId,
    refetchOnMount: "always" as const,
    staleTime: 0,
    retry: 2,
    placeholderData: keepPreviousData,
    gcTime: 30 * 60_000,
  };
}

/** Unread exchange_sale notification count (via the secure worker endpoint). */
export function exchangeVendorUnreadSalesQueryOptions(vendorId: string | undefined) {
  return {
    queryKey: [EXCHANGE_VENDOR_UNREAD_SALES_KEY, vendorId] as const,
    queryFn: async (): Promise<number> => {
      if (!vendorId) return 0;
      try {
        const count = await getUnreadSaleCount();
        logSyncDiagnostic(EXCHANGE_VENDOR_UNREAD_SALES_KEY, true, count);
        return count;
      } catch (err) {
        logSyncDiagnostic(EXCHANGE_VENDOR_UNREAD_SALES_KEY, false, 0, safeErrorCode(err));
        throw err;
      }
    },
    enabled: !!vendorId,
    refetchOnMount: "always" as const,
    staleTime: 0,
    retry: 1,
    gcTime: 30 * 60_000,
  };
}

/** Vendor Dashboard headline stats (active syncs, total sales, EC/month). */
export function exchangeVendorDashboardQueryOptions(vendorId: string | undefined) {
  return {
    queryKey: [EXCHANGE_VENDOR_DASHBOARD_KEY, vendorId] as const,
    queryFn: async (): Promise<VendorDashboardStats> => {
      if (!vendorId) return { activeCustomerSyncs: 0, totalSales: 0, earnedThisMonth: 0 };
      try {
        const stats = await getVendorDashboardStats(vendorId);
        logSyncDiagnostic(EXCHANGE_VENDOR_DASHBOARD_KEY, true, stats.totalSales);
        return stats;
      } catch (err) {
        logSyncDiagnostic(EXCHANGE_VENDOR_DASHBOARD_KEY, false, 0, safeErrorCode(err));
        throw err;
      }
    },
    enabled: !!vendorId,
    refetchOnMount: "always" as const,
    staleTime: 0,
    retry: 2,
    gcTime: 30 * 60_000,
  };
}

/** Independent vendor Active Customer Syncs query. */
export function useExchangeVendorActiveSyncs(vendorId: string | undefined) {
  return useQuery<VendorSale[]>(exchangeVendorActiveSyncsQueryOptions(vendorId));
}

/** Independent vendor Sales History query. */
export function useExchangeVendorSalesHistory(vendorId: string | undefined) {
  return useQuery<VendorSale[]>(exchangeVendorSalesHistoryQueryOptions(vendorId));
}

/** Independent unread sale notification count query. */
export function useExchangeVendorUnreadSales(vendorId: string | undefined) {
  return useQuery<number>(exchangeVendorUnreadSalesQueryOptions(vendorId));
}

/** Independent vendor dashboard stats query. */
export function useExchangeVendorDashboard(vendorId: string | undefined) {
  return useQuery<VendorDashboardStats>(exchangeVendorDashboardQueryOptions(vendorId));
}

/**
 * Invalidate every vendor dataset — each active query refetches exactly
 * once. Used after the mark-read flow so the badge updates immediately.
 */
export function invalidateExchangeVendorQueries(queryClient: QueryClient, vendorId: string | undefined): void {
  void queryClient.invalidateQueries({ queryKey: [EXCHANGE_VENDOR_ACTIVE_SYNCS_KEY, vendorId] });
  void queryClient.invalidateQueries({ queryKey: [EXCHANGE_VENDOR_SALES_HISTORY_KEY, vendorId] });
  void queryClient.invalidateQueries({ queryKey: [EXCHANGE_VENDOR_UNREAD_SALES_KEY, vendorId] });
  void queryClient.invalidateQueries({ queryKey: [EXCHANGE_VENDOR_DASHBOARD_KEY, vendorId] });
}

/**
 * Lifecycle refetch for vendor datasets: refetch all four when the screen
 * re-focuses and when AppState returns to active. The initial focus run is
 * skipped — refetchOnMount "always" already covers the cold-start fetch.
 */
export function useExchangeVendorForegroundRefetch(vendorId: string | undefined): void {
  const queryClient = useQueryClient();

  const refetchAll = useCallback(() => {
    if (!vendorId) return;
    void queryClient.refetchQueries({ queryKey: [EXCHANGE_VENDOR_ACTIVE_SYNCS_KEY, vendorId], type: "active" });
    void queryClient.refetchQueries({ queryKey: [EXCHANGE_VENDOR_SALES_HISTORY_KEY, vendorId], type: "active" });
    void queryClient.refetchQueries({ queryKey: [EXCHANGE_VENDOR_UNREAD_SALES_KEY, vendorId], type: "active" });
    void queryClient.refetchQueries({ queryKey: [EXCHANGE_VENDOR_DASHBOARD_KEY, vendorId], type: "active" });
  }, [queryClient, vendorId]);

  const firstFocusRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!firstFocusRef.current) {
        firstFocusRef.current = true;
        return;
      }
      refetchAll();
    }, [refetchAll]),
  );

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      if (previousState !== "active" && nextState === "active") {
        refetchAll();
      }
    });
    return () => subscription.remove();
  }, [refetchAll]);
}
