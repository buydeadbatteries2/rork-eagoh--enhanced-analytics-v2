import createContextHook from "@nkzw/create-context-hook";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { useProfile } from "@/providers/ProfileProvider";
import { useEdge } from "@/providers/EdgeProvider";
import { supabase } from "@/lib/supabase";
import { runForge, type RunForgeMode, type RunForgeResult } from "@/services/forge";
import { buildForgePrompt, buildForgeSummary, type ForgePromptOptions } from "@/services/imagePrompt";
import { getForgeCost, type EdgeReason } from "@/services/edge";
import type { EagohDraft } from "@/services/eagohs";
import { startupLog } from "@/utils/startupLogger";

/**
 * ForgeProvider — orchestrates the EAGOH image generation flow.
 *
 * SECURE FLOW (Phase 12B):
 *   1. UI calls `prepareForge(draft, mode, scope?)` → returns a `pending` preview
 *      with the final prompt, summary lines, and Edge cost.
 *   2. UI shows the preview + cost and asks the user to confirm.
 *   3. UI calls `confirmForge()` → delegates to secure worker `/forge/generate`:
 *        - Worker verifies auth, tier, EAGOH limit, Neuron balance
 *        - Worker generates image server-side (OpenAI key never on client)
 *        - Worker creates/updates EAGOH row
 *        - Worker deducts Neurons atomically (refunds on failure)
 *   4. UI calls `cancelForge()` to dismiss the preview safely.
 *
 * NO client-side Edge deduction — the worker is the single source of truth.
 * If image gen fails, the worker rolls back and no Neurons are charged.
 */

export type ForgeMode = RunForgeMode;

/** Loading stage labels surfaced to the UI during generation. */
export type ForgeStage = "idle" | "authenticating" | "generating" | "persisting" | "done";

const STAGE_FLOW: ForgeStage[] = ["authenticating", "generating", "persisting"];

export type ForgePending = {
  mode: ForgeMode;
  scope: ForgePromptOptions["scope"];
  draft: EagohDraft;
  eagohId?: string;
  prompt: string;
  summary: string[];
  edgeCost: number;
};

const edgeReasonFor = (mode: ForgeMode): EdgeReason => {
  if (mode === "initial") return "forge_initial";
  if (mode === "full_reforge") return "forge_full_reforge";
  return "forge_partial_reforge";
};

export const [ForgeProvider, useForge] = createContextHook(() => {
  startupLog("ForgeProvider", "start");
  const { user } = useAuth();
  const { profile, effectiveSubscriptionTier } = useProfile();
  const { total: edgeTotal, isMutating: isEdgeMutating } = useEdge();
  const queryClient = useQueryClient();

  const [pending, setPending] = useState<ForgePending | null>(null);
  const [lastResult, setLastResult] = useState<RunForgeResult | null>(null);
  const [stage, setStage] = useState<ForgeStage>("idle");

  const prepareForge = useCallback(
    (
      draft: EagohDraft,
      mode: ForgeMode,
      options: { eagohId?: string; scope?: ForgePromptOptions["scope"]; edgeCost?: number } = {},
    ): ForgePending => {
      const scope: ForgePromptOptions["scope"] = options.scope ?? "full";
      const prompt = buildForgePrompt(
        {
          name: draft.name,
          sport: draft.sport,
          gender: draft.gender,
          dna: draft.dna,
          teams: draft.teams,
          appearance: draft.appearance,
          cyberneticIntensity: draft.cyberneticIntensity,
          pose: draft.pose,
          lab: draft.lab,
          domain: draft.domain,
          tier: effectiveSubscriptionTier,
        },
        { scope: mode === "partial_reforge" ? scope : "full" },
      );
      const summary = buildForgeSummary({
        name: draft.name,
        sport: draft.sport,
        gender: draft.gender,
        dna: draft.dna,
        teams: draft.teams,
        appearance: draft.appearance,
        cyberneticIntensity: draft.cyberneticIntensity,
        pose: draft.pose,
        lab: draft.lab,
      });
      if (draft.domain) {
        summary.push(`Domain: ${draft.domain}`);
      }
      const edgeCost = options.edgeCost ?? getForgeCost(mode);
      const next: ForgePending = { mode, scope, draft, eagohId: options.eagohId, prompt, summary, edgeCost };
      setPending(next);
      return next;
    },
    [effectiveSubscriptionTier],
  );

  const cancelForge = useCallback((): void => {
    setPending(null);
    setStage("idle");
  }, []);

  const confirmMutation = useMutation({
    mutationFn: async (): Promise<RunForgeResult> => {
      if (!pending) throw new Error("No forge pending confirmation.");
      if (!user?.id || !profile) throw new Error("Profile not loaded.");

      // ── Refresh the profile from Supabase before Forge to ensure the
      // displayed balance matches the live DB value the worker will check.
      // The worker is the final source of truth, but we refresh first so
      // the client-side balance check uses real data, not stale cache.
      try {
        const { data: freshProfile } = await supabase
          .from("profiles")
          .select("edge_subscription, edge_purchased")
          .eq("id", user.id)
          .maybeSingle();
        if (freshProfile) {
          const freshSub = (freshProfile as { edge_subscription: number | null }).edge_subscription ?? 0;
          const freshPurch = (freshProfile as { edge_purchased: number | null }).edge_purchased ?? 0;
          const freshTotal = freshSub + freshPurch;
          console.log("[ForgeProvider] pre-forge balance refresh", { freshSub, freshPurch, freshTotal, cost: pending.edgeCost });
          if (freshTotal < pending.edgeCost) {
            return { ok: false, reason: "balance", error: `Insufficient Neurons. Need ${pending.edgeCost} (have ${freshTotal}).` };
          }
        }
      } catch (refreshErr) {
        // If refresh fails, proceed to worker — the worker does its own balance check.
        console.warn("[ForgeProvider] pre-forge refresh failed, proceeding to worker:", refreshErr instanceof Error ? refreshErr.message : String(refreshErr));
      }

      // Simulate stage progression for UX while the worker does the real work.
      setStage("authenticating");
      const stageTimer = setInterval(() => {
        setStage((prev) => {
          const idx = STAGE_FLOW.indexOf(prev);
          if (idx >= 0 && idx < STAGE_FLOW.length - 1) {
            return STAGE_FLOW[idx + 1];
          }
          return prev;
        });
      }, 3000);

      try {
        // Delegate entirely to the secure worker — no client-side Edge deduction.
        const result = await runForge({
          userId: user.id,
          tier: effectiveSubscriptionTier,
          mode: pending.mode,
          draft: pending.draft,
          eagohId: pending.eagohId,
          scope: pending.scope,
          edgeCost: pending.edgeCost,
        });
        return result;
      } finally {
        clearInterval(stageTimer);
        setStage("done");
      }
    },
    onSuccess: (result) => {
      setLastResult(result);
      if (result.ok) {
        // Refresh the EAGOH list cache so the new render shows up.
        queryClient.invalidateQueries({ queryKey: ["eagohs", user?.id ?? "anon"] });
        if (pending?.eagohId) {
          queryClient.invalidateQueries({ queryKey: ["eagoh", pending.eagohId] });
        }
        // ── Invalidate and refetch the profile from Supabase so the
        // displayed Neuron balance reflects the worker's atomic deduction.
        queryClient.invalidateQueries({ queryKey: ["profile", user?.id ?? "anon"] });
        queryClient.refetchQueries({ queryKey: ["profile", user?.id ?? "anon"] });
        queryClient.invalidateQueries({ queryKey: ["edge", "transactions", user?.id ?? "anon"] });
        setPending(null);
        setStage("idle");
      } else if (result.reason === "balance") {
        // Balance check failed — invalidate and refetch the profile cache
        // so the UI refreshes with the real DB balance.
        queryClient.invalidateQueries({ queryKey: ["profile", user?.id ?? "anon"] });
        queryClient.refetchQueries({ queryKey: ["profile", user?.id ?? "anon"] });
      }
    },
    onError: () => {
      setStage("idle");
    },
  });

  const confirmForge = useCallback((): Promise<RunForgeResult> => confirmMutation.mutateAsync(), [confirmMutation]);

  const value = useMemo(
    () => ({
      pending,
      lastResult,
      prepareForge,
      cancelForge,
      confirmForge,
      isGenerating: confirmMutation.isPending || isEdgeMutating,
      canAfford: pending ? edgeTotal >= pending.edgeCost : true,
      edgeTotal,
      stage,
    }),
    [pending, lastResult, prepareForge, cancelForge, confirmForge, confirmMutation.isPending, isEdgeMutating, edgeTotal, stage],
  );

  startupLog("ForgeProvider", "success");
  return value;
});
