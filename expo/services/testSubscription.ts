/**
 * Development-only test subscription persistence.
 *
 * Stores a per-user test tier in AsyncStorage so test subscriptions
 * survive app restarts in Expo Go / Rork preview. Each user gets their
 * own key — one account never inherits another's test tier.
 *
 * This module is a no-op outside of __DEV__.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import type { SubscriptionTier } from "@/services/profile";

const keyFor = (userId: string): string => `eagoh_test_subscription_${userId}`;

/**
 * Sync a dev test tier to the server-side dev_test_subscriptions table.
 * The secure Forge worker reads this table to recognise dev test subscriptions.
 * Only works in __DEV__ — Supabase RLS policies require auth.uid() = user_id.
 */
async function syncTestTierToServer(userId: string, tier: SubscriptionTier): Promise<void> {
  try {
    await supabase
      .from("dev_test_subscriptions")
      .upsert({
        user_id: userId,
        test_tier: tier,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
  } catch {
    // Best-effort — AsyncStorage is the local fallback
  }
}

/**
 * Remove the dev test tier from the server-side table.
 */
async function clearTestTierOnServer(userId: string): Promise<void> {
  try {
    await supabase
      .from("dev_test_subscriptions")
      .delete()
      .eq("user_id", userId);
  } catch {
    // Best-effort
  }
}

/**
 * Read the persisted test subscription tier for a user.
 * Returns null in production or when no test tier is stored.
 */
export async function getTestSubscriptionTier(userId: string): Promise<SubscriptionTier | null> {
  if (!__DEV__) return null;
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (!raw) return null;
    // Validate the stored value is a known tier
    if (raw === "free" || raw === "pro" || raw === "oracle_elite" || raw === "syndicate") {
      return raw as SubscriptionTier;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persist a test subscription tier for a user (development only).
 * Also syncs to the server-side dev_test_subscriptions table so the secure
 * Forge worker can recognise the test tier without trusting client input.
 */
export async function setTestSubscriptionTier(userId: string, tier: SubscriptionTier): Promise<void> {
  if (!__DEV__) return;
  await AsyncStorage.setItem(keyFor(userId), tier);
  await syncTestTierToServer(userId, tier);
}

/**
 * Remove the persisted test subscription tier for a user.
 * Also removes it from the server-side table.
 */
export async function clearTestSubscriptionTier(userId: string): Promise<void> {
  if (!__DEV__) return;
  try {
    await AsyncStorage.removeItem(keyFor(userId));
  } catch {
    // Best-effort
  }
  await clearTestTierOnServer(userId);
}
