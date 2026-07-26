/**
 * Subscription sync service — calls the trusted backend /subscription/sync
 * endpoint which verifies RevenueCat entitlements, updates the Supabase tier,
 * and grants billing-period neuron allocations with idempotency.
 *
 * The mobile client NEVER grants subscription neurons directly. All tier
 * changes and neuron grants go through this backend endpoint.
 */

import { supabase } from "@/lib/supabase";

const FUNCTIONS_BASE_URL = process.env.EXPO_PUBLIC_RORK_FUNCTIONS_URL ?? "";

export type SubscriptionSyncResult = {
  ok: boolean;
  tier: string;
  previousTier: string;
  tierChanged: boolean;
  allocationGranted: number;
  newBalance: {
    subscription: number;
    purchased: number;
    total: number;
  };
  error?: string;
};

/**
 * Sync the user's subscription state with the backend.
 *
 * Sends the active RevenueCat entitlement IDs (from CustomerInfo) to the
 * backend, which derives the tier, updates Supabase, and grants neurons
 * idempotently. Returns the updated tier and balance so the client can
 * refresh immediately without a restart.
 *
 * @param activeEntitlements - The keys of customerInfo.entitlements.active
 */
export async function syncSubscriptionWithBackend(
  activeEntitlements: string[],
): Promise<SubscriptionSyncResult> {
  if (!FUNCTIONS_BASE_URL) {
    return {
      ok: false,
      tier: "free",
      previousTier: "free",
      tierChanged: false,
      allocationGranted: 0,
      newBalance: { subscription: 0, purchased: 0, total: 0 },
      error: "Backend not configured.",
    };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token ?? null;
  if (!token) {
    return {
      ok: false,
      tier: "free",
      previousTier: "free",
      tierChanged: false,
      allocationGranted: 0,
      newBalance: { subscription: 0, purchased: 0, total: 0 },
      error: "Not authenticated.",
    };
  }

  try {
    const res = await fetch(`${FUNCTIONS_BASE_URL}/subscription/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ entitlements: activeEntitlements }),
    });

    const data = (await res.json()) as SubscriptionSyncResult;
    return data;
  } catch (err) {
    console.warn("[subscription-sync] request failed", (err as Error).message);
    return {
      ok: false,
      tier: "free",
      previousTier: "free",
      tierChanged: false,
      allocationGranted: 0,
      newBalance: { subscription: 0, purchased: 0, total: 0 },
      error: "Network error.",
    };
  }
}
