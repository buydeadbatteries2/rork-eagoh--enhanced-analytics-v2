import createContextHook from "@nkzw/create-context-hook";
import { useMutation } from "@tanstack/react-query";
import type { Session, User } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import {
  getCurrentSession,
  onAuthStateChange,
  sendPasswordReset,
  signInWithEmail,
  signOut as signOutService,
  signUpWithEmail,
  updatePassword as updatePasswordService,
  type AuthCredentials,
  type AuthSignupInput,
} from "@/services/auth";
import { startupLog } from "@/utils/startupLogger";

/**
 * AuthProvider – exposes the current Supabase session and auth actions.
 * Session is persisted automatically by the Supabase client (AsyncStorage on
 * native, localStorage on web), so users stay logged in across restarts.
 */

export const [AuthProvider, useAuth] = createContextHook(() => {
  startupLog("AuthProvider", "start");
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isReady, setIsReady] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    startupLog("SessionRestoration", "start");
    getCurrentSession()
      .then((s) => {
        if (!mounted) return;
        setSession(s);
        setUser(s?.user ?? null);
        startupLog("SessionRestoration", "success");
      })
      .catch((e) => {
        console.warn("[auth] getCurrentSession failed", e);
        startupLog("SessionRestoration", "failed", e);
      })
      .finally(() => {
        if (mounted) setIsReady(true);
      });
    const sub = onAuthStateChange((s) => {
      setSession(s);
      setUser(s?.user ?? null);
    });
    return (): void => {
      mounted = false;
      sub.unsubscribe();
    };
  }, []);
  startupLog("AuthProvider", "success");

  const signUpMutation = useMutation({
    mutationFn: (input: AuthSignupInput) => signUpWithEmail(input),
  });

  const signInMutation = useMutation({
    mutationFn: (input: AuthCredentials) => signInWithEmail(input),
  });

  const signOutMutation = useMutation({
    mutationFn: () => signOutService(),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({ email, redirectTo }: { email: string; redirectTo?: string }) => sendPasswordReset(email, redirectTo),
  });

  const updatePasswordMutation = useMutation({
    mutationFn: (newPassword: string) => updatePasswordService(newPassword),
  });

  const signUp = useCallback((input: AuthSignupInput) => signUpMutation.mutateAsync(input), [signUpMutation]);
  const signIn = useCallback((input: AuthCredentials) => signInMutation.mutateAsync(input), [signInMutation]);
  const signOut = useCallback(() => signOutMutation.mutateAsync(), [signOutMutation]);
  const resetPassword = useCallback(
    (email: string, redirectTo?: string) => resetPasswordMutation.mutateAsync({ email, redirectTo }),
    [resetPasswordMutation],
  );
  const updatePassword = useCallback((newPassword: string) => updatePasswordMutation.mutateAsync(newPassword), [updatePasswordMutation]);

  return {
    session,
    user,
    isAuthenticated: !!session,
    isReady,
    signUp,
    signIn,
    signOut,
    resetPassword,
    updatePassword,
    signUpState: { isPending: signUpMutation.isPending, error: signUpMutation.error as Error | null },
    signInState: { isPending: signInMutation.isPending, error: signInMutation.error as Error | null },
    signOutState: { isPending: signOutMutation.isPending, error: signOutMutation.error as Error | null },
    resetPasswordState: { isPending: resetPasswordMutation.isPending, error: resetPasswordMutation.error as Error | null },
    updatePasswordState: { isPending: updatePasswordMutation.isPending, error: updatePasswordMutation.error as Error | null },
  };
});
