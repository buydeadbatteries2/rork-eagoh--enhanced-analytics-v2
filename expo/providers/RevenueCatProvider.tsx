/**
 * RevenueCatProvider — React Query wrapper around the RevenueCat SDK.
 *
 * Exposes offerings, customer info, active entitlements, purchase/restore
 * functions, and a login/logout bridge for cross-device purchase sync.
 *
 * RevenueCat is configured lazily in a useEffect — NOT at module import time.
 * This avoids crashing Expo Go (which lacks native StoreKit).
 *
 * Automatically calls Purchases.logIn / logOut when the auth user changes.
 * Registers a CustomerInfoUpdateListener to keep state in sync.
 */

import createContextHook from "@nkzw/create-context-hook";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { useAuth } from "@/providers/AuthProvider";
import { startupLog } from "@/utils/startupLogger";
import {
  addCustomerInfoListener,
  configureRevenueCat,
  getCustomerInfo,
  getNeuronPackagesFromAllOfferings,
  getOfferings,
  getSubscriptionPackagesFromAllOfferings,
  getRevenueCatConfigError,
  getRevenueCatKeyMode,
  getRevenueCatRuntimeMode,
  getRevenueCatSubscriptionTier,
  isExpoGoRuntime,
  isRevenueCatConfigured,
  logInRevenueCat,
  logOutRevenueCat,
  NEURON_PRODUCT_AMOUNTS,
  purchasePackage,
  restorePurchases,
  type RevenueCatKeyMode,
  type RevenueCatRuntimeMode,
} from "@/services/revenuecat";
import type { SubscriptionTier } from "@/services/tiers";
import { TIER_MONTHLY_ALLOCATION } from "@/services/tiers";
import { syncSubscriptionWithBackend } from "@/services/subscriptionSync";
import type {
  CustomerInfo,
  PurchasesOffering,
  PurchasesPackage,
} from "react-native-purchases";

// ── Query keys ────────────────────────────────────────────────────────────

const offeringsKey = ["revenuecat", "offerings"] as const;
const customerInfoKey = ["revenuecat", "customerInfo"] as const;

// ── Provider ──────────────────────────────────────────────────────────────

export const [RevenueCatProvider, useRevenueCat] = createContextHook(() => {
  startupLog("RevenueCatProvider", "start");
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // ── Lazy configuration state ────────────────────────────────────────────
  const [rcState, setRcState] = useState<{
    configured: boolean;
    runtimeMode: RevenueCatRuntimeMode;
    keyMode: RevenueCatKeyMode;
    configError: string | null;
    initialized: boolean;
  }>({
    configured: isRevenueCatConfigured(),
    runtimeMode: getRevenueCatRuntimeMode(),
    keyMode: getRevenueCatKeyMode(),
    configError: getRevenueCatConfigError(),
    initialized: false,
  });

  const { configured, runtimeMode, keyMode, configError } = rcState;

  // Safe guards for whether RevenueCat operations can proceed
  const isAvailable = configured;
  const canRealPurchase = configured && runtimeMode !== "test-store" && runtimeMode !== "unconfigured";

  // Track previous user ID to detect login/logout transitions
  const prevUserId = useRef<string | null>(null);

  // ── Lazy configure on mount ─────────────────────────────────────────

  useEffect(() => {
    if (rcState.initialized) return;

    console.log("[RevenueCat] ── Diagnostics ──");
    console.log("[RevenueCat] Platform:", Platform.OS);
    console.log("[RevenueCat] Expo Go:", isExpoGoRuntime());
    console.log("[RevenueCat] Test Store enabled:", process.env.EXPO_PUBLIC_REVENUECAT_USE_TEST_STORE === "true");

    const result = configureRevenueCat();
    console.log("[RevenueCat] Runtime mode:", result.runtimeMode);
    console.log("[RevenueCat] Configured:", result.configured);
    if (result.error) {
      console.log("[RevenueCat] Config error:", result.error);
    }

    setRcState({
      configured: result.configured,
      runtimeMode: result.runtimeMode,
      keyMode: result.keyMode,
      configError: result.error,
      initialized: true,
    });
  }, [rcState.initialized]);

  // ── Offerings ────────────────────────────────────────────────────────

  const offeringsQuery = useQuery<{
    offering: PurchasesOffering | null;
    allOfferings: PurchasesOffering[];
  }>({
    queryKey: offeringsKey,
    queryFn: getOfferings,
    staleTime: 5 * 60 * 1000,
    enabled: configured,
  });

  const currentOffering: PurchasesOffering | null = offeringsQuery.data?.offering ?? null;
  const allOfferings: PurchasesOffering[] = offeringsQuery.data?.allOfferings ?? [];

  const packages: PurchasesPackage[] = useMemo(
    () => currentOffering?.availablePackages ?? [],
    [currentOffering],
  );

  // ── Customer Info ────────────────────────────────────────────────────

  const customerInfoQuery = useQuery<CustomerInfo | null>({
    queryKey: customerInfoKey,
    queryFn: getCustomerInfo,
    staleTime: 60 * 1000,
    enabled: configured,
  });

  const customerInfo: CustomerInfo | null = customerInfoQuery.data ?? null;

  const activeSubscriptions: string[] = useMemo(
    () => customerInfo?.activeSubscriptions ?? [],
    [customerInfo],
  );

  const activeEntitlements: string[] = useMemo(
    () => customerInfo?.entitlements.active
      ? Object.keys(customerInfo.entitlements.active)
      : [],
    [customerInfo],
  );

  // ── Derived tier ─────────────────────────────────────────────────────

  const revenueCatTier: SubscriptionTier = useMemo(
    () => getRevenueCatSubscriptionTier(customerInfo),
    [customerInfo],
  );

  const monthlyAllocation: number = TIER_MONTHLY_ALLOCATION[revenueCatTier] ?? 0;

  // ── Invalidate helpers ───────────────────────────────────────────────

  const invalidateOfferings = useCallback((): void => {
    queryClient.invalidateQueries({ queryKey: offeringsKey });
  }, [queryClient]);

  const invalidateCustomerInfo = useCallback((): void => {
    queryClient.invalidateQueries({ queryKey: customerInfoKey });
  }, [queryClient]);

  const refreshAll = useCallback((): void => {
    invalidateOfferings();
    invalidateCustomerInfo();
  }, [invalidateOfferings, invalidateCustomerInfo]);

  // ── Backend subscription sync (trusted) ─────────────────────────────
  // The client NEVER writes subscription_tier to Supabase directly.
  // All tier changes and neuron grants go through the /subscription/sync
  // backend endpoint which verifies the RevenueCat entitlements.
  const syncSubscription = useCallback(
    async (customerInfo: CustomerInfo | null): Promise<void> => {
      if (!user?.id || !configured) return;
      const activeEnts = customerInfo?.entitlements?.active
        ? Object.keys(customerInfo.entitlements.active)
        : [];
      try {
        const result = await syncSubscriptionWithBackend(activeEnts);
        if (result.ok && (result.tierChanged || result.allocationGranted > 0)) {
          // Invalidate the profile cache so the UI refreshes immediately
          queryClient.invalidateQueries({ queryKey: ["profile", user.id] });
          queryClient.refetchQueries({ queryKey: ["profile", user.id] });
        }
      } catch (err) {
        console.warn("[RevenueCat] backend sync failed", (err as Error).message);
      }
    },
    [user?.id, configured, queryClient],
  );

  // ── CustomerInfoUpdateListener ───────────────────────────────────────

  useEffect(() => {
    if (!configured) return;

    const listener = addCustomerInfoListener((newInfo) => {
      if (__DEV__) {
        console.log("[RevenueCat] CustomerInfo updated — active subs:", newInfo.activeSubscriptions);
      }
      queryClient.setQueryData(customerInfoKey, newInfo);
      // Trigger backend sync — the backend verifies entitlements and grants
      // neurons idempotently. The listener is NOT permission to grant neurons
      // without backend idempotency.
      void syncSubscription(newInfo);
    });

    return () => {
      listener.remove();
    };
  }, [configured, queryClient, syncSubscription]);

  // ── Auto login/logout when auth user changes ─────────────────────────

  useEffect(() => {
    const currentUserId = user?.id ?? null;
    const previousUserId = prevUserId.current;

    // Skip if no change
    if (currentUserId === previousUserId) return;
    prevUserId.current = currentUserId;

    if (!configured) return;

    if (currentUserId) {
      // User logged in or switched — log into RevenueCat
      logInRevenueCat(currentUserId)
        .then((info) => {
          queryClient.setQueryData(customerInfoKey, info);
          queryClient.invalidateQueries({ queryKey: offeringsKey });
          // Sync the subscription state with the backend after login
          void syncSubscription(info);
          if (__DEV__) {
            const tier = getRevenueCatSubscriptionTier(info);
            console.log("[RevenueCat] Logged in — tier:", tier);
          }
        })
        .catch((err: unknown) => {
          console.warn("[RevenueCat] logIn failed:", err);
        });
    } else if (previousUserId) {
      // User logged out
      logOutRevenueCat()
        .then((info) => {
          queryClient.setQueryData(customerInfoKey, info);
        })
        .catch((err: unknown) => {
          console.warn("[RevenueCat] logOut failed:", err);
        });
    }
  }, [user?.id, configured, queryClient, syncSubscription]);

  // ── Purchase ─────────────────────────────────────────────────────────

  const purchaseMutation = useMutation({
    mutationFn: (pkg: PurchasesPackage) => purchasePackage(pkg),
    onSuccess: (result) => {
      queryClient.setQueryData(customerInfoKey, result.customerInfo);
      // Sync with backend — verifies entitlement and grants neurons
      void syncSubscription(result.customerInfo);
    },
  });

  /** Purchase a package. Returns the full transaction result with transactionIdentifier for idempotency. */
  const purchase = useCallback(
    async (pkg: PurchasesPackage): Promise<{
      customerInfo: CustomerInfo;
      transactionIdentifier: string;
      productIdentifier: string;
    }> => {
      if (!configured) {
        throw new Error("RevenueCat is not configured. Purchases are not available in this build.");
      }
      return purchaseMutation.mutateAsync(pkg);
    },
    [purchaseMutation, configured],
  );

  // ── Restore ──────────────────────────────────────────────────────────

  const restoreMutation = useMutation({
    mutationFn: restorePurchases,
    onSuccess: (info) => {
      queryClient.setQueryData(customerInfoKey, info);
      // Sync with backend — verifies entitlement and grants missing neurons
      void syncSubscription(info);
    },
  });

  const restore = useCallback((): Promise<CustomerInfo> => {
    if (!configured) {
      throw new Error("RevenueCat is not configured. Restore is not available in this build.");
    }
    return restoreMutation.mutateAsync();
  }, [restoreMutation, configured]);

  // ── Login / Logout (manual — also done automatically via effect) ────

  const logIn = useCallback(
    (uid: string): Promise<CustomerInfo> => {
      if (!configured) {
        console.warn("[RevenueCat] logIn skipped — RC not configured");
        return Promise.resolve(null as unknown as CustomerInfo);
      }
      return logInRevenueCat(uid).then((info) => {
        queryClient.setQueryData(customerInfoKey, info);
        void syncSubscription(info);
        return info;
      });
    },
    [queryClient, syncSubscription, configured],
  );

  const logOut = useCallback((): Promise<CustomerInfo> => {
    if (!configured) {
      return Promise.resolve(null as unknown as CustomerInfo);
    }
    return logOutRevenueCat().then((info) => {
      queryClient.setQueryData(customerInfoKey, info);
      return info;
    });
  }, [queryClient, configured]);

  // ── Derived state ───────────────────────────────────────────────────

  const isSubscribed = revenueCatTier !== "free";
  const isLoading = offeringsQuery.isLoading || customerInfoQuery.isLoading;

  // ── Neuron packages — search ALL offerings, not just the current one ─

  const allNeuronPackages: PurchasesPackage[] = useMemo(
    () => getNeuronPackagesFromAllOfferings(currentOffering, allOfferings),
    [currentOffering, allOfferings],
  );

  // ── Subscription packages — search ALL offerings, not just the current one ─

  const subscriptionPackages: PurchasesPackage[] = useMemo(
    () => getSubscriptionPackagesFromAllOfferings(currentOffering, allOfferings),
    [currentOffering, allOfferings],
  );

  /** @deprecated — use allNeuronPackages for store display; this only scans the current offering */
  const consumablePackages: PurchasesPackage[] = useMemo(
    () =>
      packages.filter((p) => {
        const pid = p.product.identifier;
        return pid in NEURON_PRODUCT_AMOUNTS;
      }),
    [packages],
  );

  // ── Diagnostics (dev only) ───────────────────────────────────────────

  const diagnostics = useMemo(() => {
    if (!__DEV__) return null;
    return {
      platform: Platform.OS,
      expoGoDetected: isExpoGoRuntime(),
      runtimeMode,
      configured,
      keyMode,
      configError,
      rcUserId: customerInfo?.originalAppUserId ?? null,
      supabaseUserId: user?.id ?? null,
      rcMatchesSupabase: customerInfo?.originalAppUserId === user?.id,
      offeringId: currentOffering?.identifier ?? null,
      allOfferingIds: allOfferings.map((o) => o.identifier),
      subscriptionProductIds: subscriptionPackages.map((p) => p.product.identifier),
      neuronProductIds: allNeuronPackages.map((p) => ({
        packageId: p.identifier,
        productId: p.product.identifier,
        price: p.product.priceString ?? `$${p.product.price}`,
        type: p.product.productCategory ?? "unknown",
        amount: NEURON_PRODUCT_AMOUNTS[p.product.identifier] ?? 0,
      })),
      neuronPackCount: allNeuronPackages.length,
      activeSubscriptions,
      derivedTier: revenueCatTier,
      mockPurchasesEnabled: process.env.EXPO_PUBLIC_ENABLE_MOCK_NEURON_PURCHASES === "true",
      canRealPurchase,
      isAvailable,
    };
  }, [
    runtimeMode,
    configured,
    keyMode,
    configError,
    customerInfo,
    user?.id,
    currentOffering,
    allOfferings,
    subscriptionPackages,
    allNeuronPackages,
    activeSubscriptions,
    revenueCatTier,
    canRealPurchase,
    isAvailable,
  ]);

  if (__DEV__ && diagnostics) {
    console.log("[RevenueCat] Diagnostics:", JSON.stringify(diagnostics, null, 2));
  }

  return {
    /** Whether the RevenueCat SDK is configured with a valid API key. */
    configured,
    /** The active key mode for diagnostics. */
    keyMode,
    /** The resolved runtime mode. */
    runtimeMode,
    /** Whether RevenueCat is available for operations (configured + not errored). */
    isAvailable,
    /** Whether real (native App Store / Play Store) purchases are available. */
    canRealPurchase,
    /** Configuration error message, if any. */
    configError,
    /** The current offering with its packages. */
    currentOffering,
    /** All available offerings. */
    allOfferings,
    /** Available packages in the current offering. */
    packages,
    /** Subscription packages only (custom_pro_sub, custom_oracle_elite_sub, custom_syndicate_sub). */
    subscriptionPackages,
    /** Consumable Neuron packages only (store_edge_*). @deprecated — use allNeuronPackages. */
    consumablePackages,
    /** All Neuron packages across ALL offerings (not just current). The one to use for the store. */
    allNeuronPackages,
    /** The latest customer info from RevenueCat. */
    customerInfo,
    /** Active subscription product identifiers. */
    activeSubscriptions,
    /** Active entitlement identifiers. */
    activeEntitlements,
    /** The subscription tier derived from RevenueCat. */
    revenueCatTier,
    /** Monthly Neuron allocation for the derived tier. */
    monthlyAllocation,
    /** Whether the user has at least one paid subscription. */
    isSubscribed,
    /** Whether offerings or customer info are still loading. */
    isLoading,
    /** Offerings query loading state. */
    isOfferingsLoading: offeringsQuery.isLoading,
    /** CustomerInfo query loading state. */
    isCustomerInfoLoading: customerInfoQuery.isLoading,
    /** Refetch offerings and customer info. */
    refreshAll,

    /** Purchase a package — returns the updated CustomerInfo. */
    purchase,
    /** Restore previous purchases — returns the latest CustomerInfo. */
    restore,
    /** Log the current auth user into RevenueCat for cross-device sync. */
    logIn,
    /** Log out the current RevenueCat user. */
    logOut,

    /** Whether a purchase is in flight. */
    isPurchasing: purchaseMutation.isPending,
    /** Whether a restore is in flight. */
    isRestoring: restoreMutation.isPending,

    /** Sync subscription with backend (verifies entitlements, grants neurons). */
    syncSubscription,

    /** Dev-only diagnostics object. */
    diagnostics,
  };
  startupLog("RevenueCatProvider", "success");
});
