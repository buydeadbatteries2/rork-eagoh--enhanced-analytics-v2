import createContextHook from "@nkzw/create-context-hook";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/providers/AuthProvider";
import {
  ensureProfile,
  getEffectiveSubscriptionTier,
  hasActiveAdminOverride,
  setPreferences as setPreferencesService,
  setSelectedEagohs as setSelectedEagohsService,
  setSelectedLabs as setSelectedLabsService,
  setSubscriptionTier as setSubscriptionTierService,
  updateProfile as updateProfileService,
  type ProfilePreferences,
  type ProfileUpdate,
  type SubscriptionTier,
  type UserProfile,
} from "@/services/profile";
import {
  addPurchasedEdge as addPurchasedEdgeService,
  addSubscriptionEdge as addSubscriptionEdgeService,
  applyMonthlyRollover as applyMonthlyRolloverService,
  getBalances,
  spendEdge as spendEdgeService,
  type EdgeReason,
} from "@/services/edge";
import {
  getTestSubscriptionTier,
  setTestSubscriptionTier as setTestTierAsync,
  clearTestSubscriptionTier as clearTestTierAsync,
} from "@/services/testSubscription";
import { startupLog } from "@/utils/startupLogger";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Returns true when lastRolloverAt is null or in a past calendar month. */
function needsMonthlyAllocation(lastRolloverAt: string | null | undefined): boolean {
  if (!lastRolloverAt) return true;
  const last = new Date(lastRolloverAt);
  const now = new Date();
  return (
    last.getUTCFullYear() < now.getUTCFullYear() ||
    (last.getUTCFullYear() === now.getUTCFullYear() && last.getUTCMonth() < now.getUTCMonth())
  );
}

/**
 * ProfileProvider – owns the React Query cache for the current user's profile
 * and exposes typed mutations for updating it. Edge helpers operate against
 * the latest cached profile so the UI never needs to refetch first.
 */

const profileKey = (userId: string | null | undefined): readonly unknown[] => ["profile", userId ?? "anon"] as const;

export const [ProfileProvider, useProfile] = createContextHook(() => {
  startupLog("ProfileProvider", "start");
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const username = (user?.user_metadata as { username?: string } | undefined)?.username ?? null;
  const queryClient = useQueryClient();

  // ── Test subscription tier (dev-only, per-user, persisted in AsyncStorage) ──
  const [testTier, setTestTier] = useState<SubscriptionTier | null>(null);
  const [testTierLoaded, setTestTierLoaded] = useState(false);

  useEffect(() => {
    if (!userId) {
      setTestTier(null);
      setTestTierLoaded(true);
      return;
    }
    setTestTierLoaded(false);
    getTestSubscriptionTier(userId).then((tier) => {
      setTestTier(tier);
      setTestTierLoaded(true);
    }).catch(() => {
      setTestTier(null);
      setTestTierLoaded(true);
    });
  }, [userId]);

  const profileQuery = useQuery<UserProfile | null>({
    queryKey: profileKey(userId),
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) return null;
      return ensureProfile(userId, username);
    },
  });

  const profile: UserProfile | null = profileQuery.data ?? null;

  // ── Effective tier: test tier override takes precedence in __DEV__ only ──
  // In production, testTier is always null and this falls through to the DB tier.
  // Computed early so all mutations and effects below use the correct tier.
  const dbEffectiveTier = getEffectiveSubscriptionTier(profile);
  const effectiveSubscriptionTier: SubscriptionTier = __DEV__ && testTier ? testTier : dbEffectiveTier;

  // Loading state: profile not yet fetched OR test tier not yet loaded from AsyncStorage
  const isTierLoading: boolean = profileQuery.isLoading || (!testTierLoaded && !!userId);

  const invalidate = useCallback((): void => {
    queryClient.invalidateQueries({ queryKey: profileKey(userId) });
  }, [queryClient, userId]);

  const setQueryData = useCallback((next: UserProfile): void => {
    queryClient.setQueryData(profileKey(userId), next);
  }, [queryClient, userId]);

  const updateMutation = useMutation({
    mutationFn: (patch: ProfileUpdate): Promise<UserProfile> => {
      if (!userId) throw new Error("Not signed in");
      return updateProfileService(userId, patch);
    },
    onSuccess: (next) => queryClient.setQueryData(profileKey(userId), next),
  });

  const setTierMutation = useMutation({
    mutationFn: (tier: SubscriptionTier): Promise<UserProfile> => {
      if (!userId) throw new Error("Not signed in");
      return setSubscriptionTierService(userId, tier);
    },
    onSuccess: (next) => queryClient.setQueryData(profileKey(userId), next),
  });

  const setLabsMutation = useMutation({
    mutationFn: (labs: string[]): Promise<UserProfile> => {
      if (!userId) throw new Error("Not signed in");
      return setSelectedLabsService(userId, labs);
    },
    onSuccess: (next) => queryClient.setQueryData(profileKey(userId), next),
  });

  const setEagohsMutation = useMutation({
    mutationFn: (eagohs: string[]): Promise<UserProfile> => {
      if (!userId) throw new Error("Not signed in");
      return setSelectedEagohsService(userId, eagohs);
    },
    onSuccess: (next) => queryClient.setQueryData(profileKey(userId), next),
  });

  const setPreferencesMutation = useMutation({
    mutationFn: (preferences: ProfilePreferences): Promise<UserProfile> => {
      if (!userId) throw new Error("Not signed in");
      return setPreferencesService(userId, preferences);
    },
    onSuccess: (next) => queryClient.setQueryData(profileKey(userId), next),
  });

  const addPurchasedEdgeMutation = useMutation({
    mutationFn: (amount: number): Promise<UserProfile> => {
      if (!userId || !profile) throw new Error("Profile not loaded");
      return addPurchasedEdgeService(userId, profile, amount);
    },
    onSuccess: (next) => queryClient.setQueryData(profileKey(userId), next),
  });

  const addSubscriptionEdgeMutation = useMutation({
    mutationFn: (amount: number): Promise<UserProfile> => {
      if (!userId || !profile) throw new Error("Profile not loaded");
      return addSubscriptionEdgeService(userId, profile, amount);
    },
    onSuccess: (next) => queryClient.setQueryData(profileKey(userId), next),
  });

  const spendEdgeMutation = useMutation({
    mutationFn: (amount: number): Promise<UserProfile> => {
      if (!userId || !profile) throw new Error("Profile not loaded");
      return spendEdgeService(userId, profile, amount, "manual", undefined, effectiveSubscriptionTier);
    },
    onSuccess: (next) => queryClient.setQueryData(profileKey(userId), next),
  });

  const rolloverMutation = useMutation({
    mutationFn: (capPct?: number): Promise<UserProfile> => {
      if (!userId || !profile) throw new Error("Profile not loaded");
      void capPct;
      return applyMonthlyRolloverService(userId, profile, effectiveSubscriptionTier);
    },
    onSuccess: (next) => queryClient.setQueryData(profileKey(userId), next),
  });

  const balances = profile ? getBalances(profile) : { subscription: 0, purchased: 0, total: 0 };

  // ── Auto-allocation: grant Neurons on first login and monthly thereafter ──
  // Wait for test tier to load so dev test subscriptions get the correct allocation.
  const allocRanRef = useRef(false);
  useEffect(() => {
    if (!profile || !userId) return;
    if (allocRanRef.current) return;
    // Don't run until the test tier has been loaded from AsyncStorage
    // (in __DEV__) so we use the correct effective tier for allocation.
    if (!testTierLoaded) return;

    const tier = effectiveSubscriptionTier;

    // Only grant if the user hasn't received allocation this calendar month.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lastRollover: string | null = (profile as any).last_rollover_at ?? null;
    if (!needsMonthlyAllocation(lastRollover)) return;

    allocRanRef.current = true;
    applyMonthlyRolloverService(userId, profile, tier).then((next) => {
      queryClient.setQueryData(profileKey(userId), next);
    }).catch((err) => {
      console.warn("[ProfileProvider] auto-allocation failed:", (err as Error).message);
      allocRanRef.current = false; // retry next mount
    });
  }, [profile, userId, queryClient, testTierLoaded, effectiveSubscriptionTier]);

  // ── Upgrade allocation: trigger rollover when effective tier changes from free → paid ──
  // Uses effectiveSubscriptionTier so dev test tier upgrades also trigger allocation.
  const prevTierRef = useRef<SubscriptionTier | null>(null);
  useEffect(() => {
    if (!profile || !userId) return;
    // Don't track until test tier has loaded to avoid false upgrade detection.
    if (!testTierLoaded) return;

    const tier = effectiveSubscriptionTier;
    const prevTier = prevTierRef.current;
    prevTierRef.current = tier;

    // Only trigger on actual upgrade from free to paid (not on first mount)
    if (!prevTier || prevTier === tier) return;
    if (prevTier !== "free") return;
    if (tier === "free") return;

    // Grant the new paid tier's monthly allocation immediately
    if (__DEV__) {
      console.log(`[ProfileProvider] Tier upgrade detected: ${prevTier} → ${tier} — triggering allocation`);
    }
    applyMonthlyRolloverService(userId, profile, tier).then((next) => {
      queryClient.setQueryData(profileKey(userId), next);
    }).catch((err) => {
      console.warn("[ProfileProvider] upgrade allocation failed:", (err as Error).message);
    });
  }, [profile, userId, queryClient, testTierLoaded, effectiveSubscriptionTier]);

  const isAdminOverrideActive: boolean = hasActiveAdminOverride(profile);

  // ── Test subscription helpers (dev-only) ──────────────────────────────
  const setTestSubscription = useCallback(
    async (tier: SubscriptionTier): Promise<void> => {
      if (!userId) return;
      await setTestTierAsync(userId, tier);
      setTestTier(tier);
    },
    [userId],
  );

  const clearTestSubscription = useCallback(
    async (): Promise<void> => {
      if (!userId) return;
      await clearTestTierAsync(userId);
      setTestTier(null);
    },
    [userId],
  );

  return {
    profile,
    balances,
    effectiveSubscriptionTier,
    isAdminOverrideActive,
    isLoading: profileQuery.isLoading,
    isTierLoading,
    error: profileQuery.error as Error | null,
    refetch: profileQuery.refetch,
    invalidate,

    /** Dev-only: active test subscription tier, or null. */
    testTier: __DEV__ ? testTier : null,
    /** Dev-only: set a test subscription tier (persists to AsyncStorage). */
    setTestSubscription,
    /** Dev-only: clear the test subscription tier. */
    clearTestSubscription,

    updateProfile: (patch: ProfileUpdate) => updateMutation.mutateAsync(patch),
    setSubscriptionTier: (tier: SubscriptionTier) => setTierMutation.mutateAsync(tier),
    setSelectedLabs: (labs: string[]) => setLabsMutation.mutateAsync(labs),
    setSelectedEagohs: (eagohs: string[]) => setEagohsMutation.mutateAsync(eagohs),
    setPreferences: (preferences: ProfilePreferences) => setPreferencesMutation.mutateAsync(preferences),

    addPurchasedEdge: (amount: number) => addPurchasedEdgeMutation.mutateAsync(amount),
    addSubscriptionEdge: (amount: number) => addSubscriptionEdgeMutation.mutateAsync(amount),
    spendEdge: (amount: number) => spendEdgeMutation.mutateAsync(amount),
    applyMonthlyRollover: (capPct?: number) => rolloverMutation.mutateAsync(capPct ?? 0.1),
    _edgeReason: undefined as EdgeReason | undefined,
  };
  startupLog("ProfileProvider", "success");
});
