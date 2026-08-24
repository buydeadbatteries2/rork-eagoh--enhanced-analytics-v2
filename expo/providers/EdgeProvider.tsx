import createContextHook from "@nkzw/create-context-hook";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { useProfile } from "@/providers/ProfileProvider";
import {
  EDGE_COSTS,
  TIER_MONTHLY_ALLOCATION,
  addPurchasedEdge as addPurchasedEdgeService,
  addSubscriptionEdge as addSubscriptionEdgeService,
  applyMonthlyRollover as applyMonthlyRolloverService,
  deductForCustomization,
  deductForMarketplace,
  deductForObservation,
  deductForQuickCheck,
  getBalances,
  listTransactions,
  spendEdge as spendEdgeService,
  type EdgeBalances,
  type EdgeReason,
  type EdgeTransaction,
} from "@/services/edge";
import type { UserProfile } from "@/services/profile";
import { startupLog } from "@/utils/startupLogger";

/**
 * EdgeProvider — dedicated wallet hook over Supabase.
 *
 * Spend priority is enforced in the service layer (subscription first, then
 * purchased). Every mutation logs a row to `edge_transactions`, surfaced here
 * via `transactions` for UI history widgets.
 */

const profileKey = (userId: string | null | undefined): readonly unknown[] =>
  ["profile", userId ?? "anon"] as const;
const txKey = (userId: string | null | undefined): readonly unknown[] =>
  ["edge", "transactions", userId ?? "anon"] as const;

export const [EdgeProvider, useEdge] = createContextHook(() => {
  startupLog("EdgeProvider", "start");
  const { user } = useAuth();
  const { profile, effectiveSubscriptionTier } = useProfile();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  const balances: EdgeBalances = useMemo(
    () => (profile ? getBalances(profile) : { subscription: 0, purchased: 0, total: 0 }),
    [profile],
  );

  const txQuery = useQuery<EdgeTransaction[]>({
    queryKey: txKey(userId),
    enabled: !!userId,
    queryFn: () => (userId ? listTransactions(userId, 50) : Promise.resolve([])),
  });

  const writeBack = useCallback(
    (next: UserProfile): void => {
      queryClient.setQueryData(profileKey(userId), next);
      queryClient.invalidateQueries({ queryKey: txKey(userId) });
    },
    [queryClient, userId],
  );

  /**
   * Apply trusted Neuron balances returned by the Worker (Phase S2B-2).
   *
   * Accepts ONLY validated numeric balances from successful analyst results
   * (subscription + purchased must sum to total, all non-negative integers).
   * The server already persisted them via deduct_neurons_atomic — this
   * performs NO Supabase wallet write. Uses a functional updater over the
   * CURRENT cached profile (never a closed-over snapshot) so newer unrelated
   * fields survive, and always invalidates the profile + transaction queries
   * when a user is signed in — even if no profile is cached yet, since the
   * Worker may already have completed the deduction.
   */
  const applyServerBalances = useCallback(
    ({ subscription, purchased, total }: { subscription: number; purchased: number; total: number }): void => {
      const isNonNegativeInt = (v: unknown): v is number =>
        typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 0;
      if (
        !isNonNegativeInt(subscription) ||
        !isNonNegativeInt(purchased) ||
        !isNonNegativeInt(total) ||
        total !== subscription + purchased
      ) {
        return;
      }
      if (!userId) return;
      queryClient.setQueryData<UserProfile | null | undefined>(
        profileKey(userId),
        (current) =>
          current
            ? {
                ...current,
                edge_subscription: subscription,
                edge_purchased: purchased,
              }
            : current,
      );
      queryClient.invalidateQueries({ queryKey: txKey(userId) });
      // Background refetch for confirmation — the optimistic cache update
      // above renders immediately.
      queryClient.invalidateQueries({ queryKey: profileKey(userId) });
    },
    [queryClient, userId],
  );

  const requireCtx = useCallback((): { uid: string; p: UserProfile } => {
    if (!userId || !profile) throw new Error("Profile not loaded");
    return { uid: userId, p: profile };
  }, [userId, profile]);

  const spendMutation = useMutation({
    mutationFn: ({ amount, reason, note }: { amount: number; reason: EdgeReason; note?: string }) => {
      const { uid, p } = requireCtx();
      return spendEdgeService(uid, p, amount, reason, note, effectiveSubscriptionTier);
    },
    onSuccess: writeBack,
  });

  const quickCheckMutation = useMutation({
    mutationFn: ({ prompt, note }: { prompt: string; note?: string }) => {
      const { uid, p } = requireCtx();
      return deductForQuickCheck(uid, p, prompt, note, effectiveSubscriptionTier);
    },
    onSuccess: writeBack,
  });

  const observationMutation = useMutation({
    mutationFn: (note?: string) => {
      const { uid, p } = requireCtx();
      return deductForObservation(uid, p, note, effectiveSubscriptionTier);
    },
    onSuccess: writeBack,
  });

  const marketplaceMutation = useMutation({
    mutationFn: ({ amount, note }: { amount?: number; note?: string } = {}) => {
      const { uid, p } = requireCtx();
      return deductForMarketplace(uid, p, amount, note, effectiveSubscriptionTier);
    },
    onSuccess: writeBack,
  });

  const customizationMutation = useMutation({
    mutationFn: ({ amount, note }: { amount?: number; note?: string } = {}) => {
      const { uid, p } = requireCtx();
      return deductForCustomization(uid, p, amount, note, effectiveSubscriptionTier);
    },
    onSuccess: writeBack,
  });

  const purchaseMutation = useMutation({
    mutationFn: ({ amount, note }: { amount: number; note?: string }) => {
      const { uid, p } = requireCtx();
      return addPurchasedEdgeService(uid, p, amount, note);
    },
    onSuccess: writeBack,
  });

  const grantMutation = useMutation({
    mutationFn: ({ amount, reason, note }: { amount: number; reason?: EdgeReason; note?: string }) => {
      const { uid, p } = requireCtx();
      return addSubscriptionEdgeService(uid, p, amount, reason ?? "manual", note);
    },
    onSuccess: writeBack,
  });

  const rolloverMutation = useMutation({
    mutationFn: () => {
      const { uid, p } = requireCtx();
      return applyMonthlyRolloverService(uid, p, effectiveSubscriptionTier);
    },
    onSuccess: writeBack,
  });

  const canAfford = useCallback((cost: number): boolean => balances.total >= Math.max(0, cost), [balances.total]);

  const tier = effectiveSubscriptionTier;
  const monthlyAllocation = TIER_MONTHLY_ALLOCATION[tier] ?? 0;

  return {
    balances,
    subscription: balances.subscription,
    purchased: balances.purchased,
    total: balances.total,
    tier,
    monthlyAllocation,
    costs: EDGE_COSTS,
    transactions: txQuery.data ?? [],
    isLoadingTransactions: txQuery.isLoading,
    canAfford,

    // trusted Worker-reported balances (analyst sessions — Phase S2B-2)
    applyServerBalances,

    // generic
    spend: (amount: number, reason: EdgeReason, note?: string) =>
      spendMutation.mutateAsync({ amount, reason, note }),

    // reusable deduction helpers
    deductQuickCheck: (prompt: string, note?: string) =>
      quickCheckMutation.mutateAsync({ prompt, note }),
    deductObservation: (note?: string) => observationMutation.mutateAsync(note),
    deductMarketplace: (amount?: number, note?: string) =>
      marketplaceMutation.mutateAsync({ amount, note }),
    deductCustomization: (amount?: number, note?: string) =>
      customizationMutation.mutateAsync({ amount, note }),

    // additions
    purchase: (amount: number, note?: string) => purchaseMutation.mutateAsync({ amount, note }),
    grantSubscription: (amount: number, reason?: EdgeReason, note?: string) =>
      grantMutation.mutateAsync({ amount, reason, note }),

    // monthly cycle
    applyMonthlyRollover: () => rolloverMutation.mutateAsync(),

    isMutating:
      spendMutation.isPending ||
      quickCheckMutation.isPending ||
      observationMutation.isPending ||
      marketplaceMutation.isPending ||
      customizationMutation.isPending ||
      purchaseMutation.isPending ||
      grantMutation.isPending ||
      rolloverMutation.isPending,
  };
  startupLog("EdgeProvider", "success");
});
