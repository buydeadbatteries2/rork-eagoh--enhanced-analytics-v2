import createContextHook from "@nkzw/create-context-hook";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { supabase } from "@/lib/supabase";
import {
  ensureProfile,
  getEffectiveSubscriptionTier,
  hasActiveAdminOverride,
  setPreferences as setPreferencesService,
  setSelectedEagohs as setSelectedEagohsService,
  setSelectedLabs as setSelectedLabsService,
  updateProfile as updateProfileService,
  type ProfilePreferences,
  type ProfileUpdate,
  type SafeProfileUpdateResult,
  type SubscriptionTier,
  type UserProfile,
} from "@/services/profile";
import {
  applyMonthlyRollover as applyMonthlyRolloverService,
  getBalances,
  spendEdge as spendEdgeService,
} from "@/services/edge";
import {
  getTestSubscriptionTier,
  setTestSubscriptionTier as setTestTierAsync,
  clearTestSubscriptionTier as clearTestTierAsync,
} from "@/services/testSubscription";
import { startupLog } from "@/utils/startupLogger";
import { isComplimentaryActive, type ComplimentaryTier } from "@/services/tiers";

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

const FUNCTIONS_BASE_URL = process.env.EXPO_PUBLIC_RORK_FUNCTIONS_URL ?? "";

/**
 * Trigger the backend complimentary allocation endpoint.
 * The worker calls the SECURITY DEFINER RPC `grant_complimentary_allocation`
 * which is idempotent per month. Returns true on success.
 */
async function triggerComplimentaryAllocation(token: string, tier: string): Promise<boolean> {
  if (!FUNCTIONS_BASE_URL) return false;
  try {
    const res = await fetch(`${FUNCTIONS_BASE_URL}/complimentary/allocate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ complimentaryTier: tier }),
    });
    return res.ok;
  } catch {
    return false;
  }
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
    mutationFn: (patch: ProfileUpdate): Promise<SafeProfileUpdateResult> => {
      if (!userId) throw new Error("Not signed in");
      return updateProfileService(userId, patch);
    },
    onSuccess: (next) => {
      // The RPC returns only safe fields — merge with the cached profile
      const cached = queryClient.getQueryData<UserProfile | null>(profileKey(userId));
      if (cached) {
        queryClient.setQueryData(profileKey(userId), { ...cached, ...next });
      }
    },
  });

  // ── setSubscriptionTier removed ──────────────────────────────────
  // subscription_tier is NEVER set by the client. The backend /subscription/sync
  // endpoint is the sole authority. The RPC throws if called.

  const setLabsMutation = useMutation({
    mutationFn: (labs: string[]): Promise<SafeProfileUpdateResult> => {
      if (!userId) throw new Error("Not signed in");
      return setSelectedLabsService(userId, labs);
    },
    onSuccess: (next) => {
      const cached = queryClient.getQueryData<UserProfile | null>(profileKey(userId));
      if (cached) queryClient.setQueryData(profileKey(userId), { ...cached, ...next });
    },
  });

  const setEagohsMutation = useMutation({
    mutationFn: (eagohs: string[]): Promise<SafeProfileUpdateResult> => {
      if (!userId) throw new Error("Not signed in");
      return setSelectedEagohsService(userId, eagohs);
    },
    onSuccess: (next) => {
      const cached = queryClient.getQueryData<UserProfile | null>(profileKey(userId));
      if (cached) queryClient.setQueryData(profileKey(userId), { ...cached, ...next });
    },
  });

  const setPreferencesMutation = useMutation({
    mutationFn: (preferences: ProfilePreferences): Promise<SafeProfileUpdateResult> => {
      if (!userId) throw new Error("Not signed in");
      return setPreferencesService(userId, preferences);
    },
    onSuccess: (next) => {
      const cached = queryClient.getQueryData<UserProfile | null>(profileKey(userId));
      if (cached) queryClient.setQueryData(profileKey(userId), { ...cached, ...next });
    },
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

  // ── Auto-allocation: grant free-tier Neurons on first login and monthly thereafter ──
  // IMPORTANT: The client ONLY grants free-tier (25) monthly neurons.
  // Paid-tier subscription allocations are ALWAYS handled by the backend
  // /subscription/sync endpoint, which verifies RevenueCat entitlements and
  // grants neurons idempotently. The client must NEVER call
  // applyMonthlyRollover for a paid tier — doing so applies a rollover on top
  // of the backend's already-correct grant, producing e.g. 1540 instead of 1400.
  const allocRanRef = useRef(false);
  useEffect(() => {
    if (!profile || !userId) return;
    if (allocRanRef.current) return;
    if (!testTierLoaded) return;

    const tier = effectiveSubscriptionTier;

    // ── Guard: only client-grant for the free tier ──
    // Paid tiers are granted exclusively by the backend /subscription/sync.
    if (tier !== "free") {
      allocRanRef.current = true;
      return;
    }

    // Only grant if the user hasn't received allocation this calendar month.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lastRollover: string | null = (profile as any).last_rollover_at ?? null;
    if (!needsMonthlyAllocation(lastRollover)) return;

    allocRanRef.current = true;
    applyMonthlyRolloverService(userId, profile, tier).then((next) => {
      queryClient.setQueryData(profileKey(userId), next);
    }).catch((err) => {
      console.warn("[ProfileProvider] free-tier auto-allocation failed:", (err as Error).message);
      allocRanRef.current = false; // retry next mount
    });
  }, [profile, userId, queryClient, testTierLoaded, effectiveSubscriptionTier]);

  // ── Paid tier grants are handled exclusively by the backend ──
  // The previous client-side upgrade effect (free → paid) was removed because
  // it called applyMonthlyRollover AFTER the backend already granted the
  // correct allocation, adding a spurious 10% rollover (e.g. 1400 → 1540).
  // The RevenueCatProvider's syncSubscription() calls the backend
  // /subscription/sync endpoint which is the sole authoritative grant path.

  // ── Complimentary access info ──────────────────────────────────────
  const complimentaryTier: ComplimentaryTier = profile?.complimentary_tier ?? null;
  const complimentaryExpiresAt: string | null = profile?.complimentary_tier_expires_at ?? null;
  const complimentaryActive: boolean = isComplimentaryActive(complimentaryTier, complimentaryExpiresAt);

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

  // ── Complimentary allocation trigger ──────────────────────────────────
  // When a user has active complimentary access, call the backend RPC to
  // grant the monthly allocation. The backend is idempotent — repeated calls
  // for the same month do not duplicate the grant.
  const compAllocRanRef = useRef(false);
  useEffect(() => {
    if (!profile || !userId) return;
    if (compAllocRanRef.current) return;
    if (!complimentaryActive || !complimentaryTier) {
      compAllocRanRef.current = false;
      return;
    }

    // Only trigger if the user needs a monthly allocation
    const lastRollover = (profile as Record<string, unknown>).last_rollover_at as string | null;
    if (!needsMonthlyAllocation(lastRollover)) {
      compAllocRanRef.current = true;
      return;
    }

    compAllocRanRef.current = true;
    supabase.auth.getSession().then(({ data: sessionData }: { data: { session: { access_token: string } | null } }) => {
      const token = sessionData.session?.access_token;
      if (!token) return;
      void triggerComplimentaryAllocation(token, complimentaryTier).then((ok) => {
        if (ok) {
          // Refresh profile to pick up any balance changes from the RPC.
          // The RPC may skip the allocation if the paid tier is higher —
          // in that case the balance is unchanged and this is a no-op refetch.
          queryClient.invalidateQueries({ queryKey: profileKey(userId) });
        } else {
          compAllocRanRef.current = false; // retry next mount
        }
      });
    });
  }, [profile, userId, queryClient, complimentaryActive, complimentaryTier]);

  return {
    profile,
    balances,
    effectiveSubscriptionTier,
    isAdminOverrideActive,
    complimentaryTier,
    complimentaryExpiresAt,
    complimentaryActive,
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
    setSelectedLabs: (labs: string[]) => setLabsMutation.mutateAsync(labs),
    setSelectedEagohs: (eagohs: string[]) => setEagohsMutation.mutateAsync(eagohs),
    setPreferences: (preferences: ProfilePreferences) => setPreferencesMutation.mutateAsync(preferences),

    spendEdge: (amount: number) => spendEdgeMutation.mutateAsync(amount),
    applyMonthlyRollover: (capPct?: number) => rolloverMutation.mutateAsync(capPct ?? 0.1),
  };
  startupLog("ProfileProvider", "success");
});
