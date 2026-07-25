import createContextHook from "@nkzw/create-context-hook";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { useProfile } from "@/providers/ProfileProvider";
import {
  createEagoh as createEagohService,
  deleteEagoh as deleteEagohService,
  getEagohFull as getEagohFullService,
  getEagohLimit,
  listEagohs as listEagohsService,
  type CreateEagohResult,
  type EagohDraft,
  type EagohFull,
  type EagohRecord,
} from "@/services/eagohs";
import { startupLog } from "@/utils/startupLogger";

const eagohsKey = (userId: string | null | undefined): readonly unknown[] => ["eagohs", userId ?? "anon"] as const;
const eagohFullKey = (eagohId: string): readonly unknown[] => ["eagoh", eagohId] as const;

/**
 * EagohProvider – owns the cached list of the current user's EAGOHs and
 * exposes typed mutations for creating/deleting them. Full per-EAGOH data
 * (customization, teams, labs) is fetched lazily via `useEagohFull(id)`.
 */
export const [EagohProvider, useEagohs] = createContextHook(() => {
  startupLog("EagohProvider", "start");
  const { user } = useAuth();
  const { profile } = useProfile();
  const userId = user?.id ?? null;
  const { effectiveSubscriptionTier: tier } = useProfile();
  const queryClient = useQueryClient();

  const listQuery = useQuery<EagohRecord[]>({
    queryKey: eagohsKey(userId),
    enabled: !!userId,
    queryFn: () => (userId ? listEagohsService(userId) : Promise.resolve([])),
  });

  const eagohs: EagohRecord[] = listQuery.data ?? [];
  /** Only user-forged EAGOHs count against the tier limit. Default shells are excluded. */
  const userForgedEagohs = eagohs.filter((e) => !e.is_default_shell);
  const limit = getEagohLimit(tier);
  const remaining = Math.max(0, limit - userForgedEagohs.length);
  const canCreate = !!userId && remaining > 0;

  const createMutation = useMutation({
    mutationFn: (draft: EagohDraft): Promise<CreateEagohResult> => {
      if (!userId) throw new Error("Not signed in");
      return createEagohService(userId, tier, draft);
    },
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: eagohsKey(userId) });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (eagohId: string): Promise<void> => deleteEagohService(eagohId),
    onSuccess: (_void, eagohId) => {
      queryClient.invalidateQueries({ queryKey: eagohsKey(userId) });
      queryClient.removeQueries({ queryKey: eagohFullKey(eagohId) });
    },
  });

  const refetch = useCallback(() => {
    listQuery.refetch().catch(() => undefined);
  }, [listQuery]);

  return {
    eagohs,
    limit,
    remaining,
    canCreate,
    tier,
    isLoading: listQuery.isLoading,
    error: listQuery.error as Error | null,
    refetch,
    createEagoh: (draft: EagohDraft) => createMutation.mutateAsync(draft),
    isCreating: createMutation.isPending,
    deleteEagoh: (eagohId: string) => deleteMutation.mutateAsync(eagohId),
    isDeleting: deleteMutation.isPending,
  };
  startupLog("EagohProvider", "success");
});

/** Lazy hook – fetches a single EAGOH's full payload (customization + teams + labs). */
export function useEagohFull(eagohId: string | null | undefined) {
  return useQuery<EagohFull | null>({
    queryKey: eagohFullKey(eagohId ?? "none"),
    enabled: !!eagohId,
    queryFn: () => (eagohId ? getEagohFullService(eagohId) : Promise.resolve(null)),
  });
}
