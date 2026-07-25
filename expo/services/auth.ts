import { supabase } from "@/lib/supabase";
import type { Session, User } from "@supabase/supabase-js";
import { logOutRevenueCat } from "@/services/revenuecat";

/**
 * Auth service – wraps Supabase auth calls behind a clean async API so the rest
 * of the app never imports `supabase` directly for authentication.
 *
 * signOutUser() is the single centralized sign-out flow: RevenueCat logout first,
 * Supabase signOut second, returns success. Callers are responsible for
 * navigating away after it resolves.
 */

export type AuthCredentials = { email: string; password: string };
export type AuthSignupInput = AuthCredentials & { username?: string };

export async function signUpWithEmail({ email, password, username }: AuthSignupInput): Promise<{ user: User | null; session: Session | null }> {
  const normalizedEmail = email.trim().toLowerCase();
  const trimmedUsername = username?.trim() || undefined;
  const { data, error } = await supabase.auth.signUp({
    email: normalizedEmail,
    password,
    options: { data: trimmedUsername ? { username: trimmedUsername } : undefined },
  });
  if (error) throw error;
  return { user: data.user, session: data.session };
}

export async function signInWithEmail({ email, password }: AuthCredentials): Promise<{ user: User | null; session: Session | null }> {
  const normalizedEmail = email.trim().toLowerCase();
  const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
  if (error) throw error;
  return { user: data.user, session: data.session };
}

/** Low-level Supabase signOut. Prefer signOutUser() for the full flow. */
export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Centralized sign-out sequence.
 *
 * 1. Attempt RevenueCat logOut safely (failure does not block Supabase signOut).
 * 2. Call Supabase auth.signOut().
 * 3. Return { success: true } so callers can navigate away.
 *
 * RevenueCat logout failure is logged but does not prevent sign out.
 * Supabase signOut failure throws so the caller can show an error.
 */
export async function signOutUser(): Promise<{ success: true }> {
  // Step 1 — RevenueCat logout (safe: catch errors, don't block)
  try {
    await logOutRevenueCat();
    if (__DEV__) {
      console.log("[auth] RevenueCat logOut completed");
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (__DEV__) {
      console.warn("[auth] RevenueCat logOut failed (non-blocking):", msg);
    }
  }

  // Step 2 — Supabase signOut
  await signOut();

  if (__DEV__) {
    console.log("[auth] signOutUser complete — session cleared");
  }

  return { success: true };
}

export async function sendPasswordReset(email: string, redirectTo?: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
  if (error) throw error;
}

export async function updatePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function getCurrentSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session ?? null;
}

export function onAuthStateChange(cb: (session: Session | null) => void): { unsubscribe: () => void } {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return { unsubscribe: (): void => data.subscription.unsubscribe() };
}
