import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import { startupLog } from "@/utils/startupLogger";

/**
 * Shared Supabase client for the EAGOH app.
 * - Uses AsyncStorage for session persistence on native.
 * - Uses default localStorage on web automatically when `storage` is undefined.
 * Reads keys from public env so they can be safely inlined into the client bundle.
 *
 * If env vars are missing we fall back to harmless placeholders so the app can
 * still boot in preview/dev. Calls to supabase will fail gracefully at runtime
 * instead of crashing the entire React tree at import time.
 */

const rawUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").trim();
const rawKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

/**
 * Normalize the Supabase URL — strip trailing slashes and any accidental path
 * suffix (e.g. "/rest/v1", "/auth/v1") that users sometimes paste from the
 * dashboard. The SDK only wants the project origin like
 * https://xyzcompany.supabase.co
 */
function normalizeSupabaseUrl(input: string): string {
  if (!input) return "";
  let url = input.replace(/\/+$/, "");
  try {
    const u = new URL(url);
    url = `${u.protocol}//${u.host}`;
  } catch {
    // leave as-is; createClient will throw a clearer error
  }
  return url;
}

const supabaseUrl = normalizeSupabaseUrl(rawUrl);
const supabaseAnonKey = rawKey;

export const isSupabaseConfigured: boolean = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  console.warn(
    "[supabase] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY — using placeholder client. Auth and profile features will be disabled until env vars are set."
  );
}

const effectiveUrl = supabaseUrl || "https://placeholder.supabase.co";
const effectiveKey = supabaseAnonKey || "placeholder-anon-key";

startupLog("SupabaseInit", "start");
let supabaseClient: SupabaseClient;
try {
  supabaseClient = createClient(effectiveUrl, effectiveKey, {
    auth: {
      storage: Platform.OS === "web" ? undefined : (AsyncStorage as unknown as Storage),
      autoRefreshToken: isSupabaseConfigured,
      persistSession: isSupabaseConfigured,
      detectSessionInUrl: Platform.OS === "web",
    },
  });
  startupLog("SupabaseInit", "success");
} catch (err) {
  startupLog("SupabaseInit", "failed", err);
  throw err;
}

export const supabase: SupabaseClient = supabaseClient;

export default supabase;
