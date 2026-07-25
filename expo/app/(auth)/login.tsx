/**
 * Auth / Login screen — extracted from HomeScreen so it renders outside the
 * Tabs navigator. When a session is detected (via onAuthStateChange), the
 * root layout replaces this route group with (tabs).
 */

import { palette } from "@/constants/colors";
import { useHaptics } from "@/hooks/useHaptics";
import { useAuth } from "@/providers/AuthProvider";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  ChevronRight,
} from "lucide-react-native";
import React, { useCallback, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { formatAuthError, safeAuthLog } from "@/utils/authErrors";

// ── Logo Mark ───────────────────────────────────────────────────────────────

function LogoMark({ size = 72 }: { size?: number }): JSX.Element {
  return (
    <View style={[styles.logo, { width: size, height: size, borderRadius: size / 2 }]}>
      <Image
        source={require("@/assets/images/brain-logo.png")}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        resizeMode="cover"
        accessibilityLabel="EAGOH brain logo"
      />
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  gradient: { flex: 1, justifyContent: "center", padding: 28 },
  authFlex: { flex: 1, justifyContent: "center" },
  logo: {
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(54,245,255,0.30)",
    backgroundColor: "rgba(3,6,11,0.72)",
    marginBottom: 24,
    overflow: "hidden" as const,
    shadowColor: palette.cyan,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  authTitle: {
    color: palette.text,
    fontSize: 28,
    fontWeight: "900" as const,
    letterSpacing: -0.5,
    textAlign: "center" as const,
  },
  authBody: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: "600" as const,
    textAlign: "center" as const,
    marginTop: 10,
    marginBottom: 28,
    lineHeight: 20,
  },
  inputField: { marginBottom: 14 },
  fieldLabel: {
    color: palette.cyan,
    fontSize: 11,
    fontWeight: "900" as const,
    letterSpacing: 1.4,
    marginBottom: 6,
    textTransform: "uppercase" as const,
  },
  inputControl: {
    backgroundColor: "rgba(3,6,11,0.62)",
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: palette.text,
    fontSize: 15,
    fontWeight: "700" as const,
  },
  errorText: {
    color: palette.ember,
    fontSize: 12,
    fontWeight: "800" as const,
    textAlign: "center" as const,
    marginBottom: 12,
    marginTop: 2,
  },
  primaryButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    backgroundColor: palette.cyan,
    paddingVertical: 14,
    borderRadius: 5,
    marginTop: 8,
  },
  primaryButtonText: {
    color: palette.void,
    fontSize: 15,
    fontWeight: "900" as const,
    letterSpacing: 0.5,
  },
  secondaryButton: {
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingVertical: 14,
    borderRadius: 5,
    marginTop: 10,
    borderWidth: 1,
    borderColor: palette.line,
  },
  secondaryButtonText: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: "800" as const,
  },
  boot: {
    color: palette.cyan,
    fontSize: 10,
    fontWeight: "900" as const,
    letterSpacing: 3.2,
    textAlign: "center" as const,
    marginTop: 22,
  },
});

// ── Main component ──────────────────────────────────────────────────────────

export default function LoginScreen(): JSX.Element {
  const h = useHaptics();
  const router = useRouter();
  const { signIn, signUp, signInState, signUpState } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [username, setUsername] = useState<string>("");
  const [localError, setLocalError] = useState<string | null>(null);

  const isPending = signInState.isPending || signUpState.isPending;
  const signInErr = signInState.error ?? null;
  const signUpErr = signUpState.error ?? null;
  const activeError = mode === "signin" ? signInErr : signUpErr;
  const errorText = localError ?? (activeError ? formatAuthError(activeError) : null);

  const submit = useCallback(async (): Promise<void> => {
    setLocalError(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setLocalError("Email and password are required.");
      return;
    }
    const emailOk = /.+@.+\..+/.test(trimmedEmail);
    if (!emailOk) {
      setLocalError("Enter a valid email address.");
      return;
    }
    if (mode === "signup" && password.length < 6) {
      setLocalError("Password must be at least 6 characters.");
      return;
    }
    h.selection();
    try {
      if (mode === "signin") {
        await signIn({ email: trimmedEmail, password });
      } else {
        await signUp({ email: trimmedEmail, password, username: username.trim() || undefined });
      }
      // onAuthStateChange will fire SIGNED_IN → root layout replaces auth with tabs
    } catch (err: unknown) {
      // Log safe diagnostics only (no passwords, tokens, or headers)
      console.warn(
        `[auth] ${mode} failed:`,
        JSON.stringify(safeAuthLog(mode === "signin" ? "signin" : "signup", err)),
      );
      // error surfaces via mutation state — formatted by formatAuthError
    }
  }, [email, password, username, mode, signIn, signUp, h]);

  const toggleMode = useCallback((): void => {
    setLocalError(null);
    setMode((m) => (m === "signin" ? "signup" : "signin"));
  }, []);

  return (
    <SafeAreaView style={styles.root}>
      <LinearGradient colors={[palette.void, palette.obsidian]} style={styles.gradient}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.authFlex}>
          <LogoMark size={72} />
          <Text style={styles.authTitle}>{mode === "signin" ? "Rejoin the grid" : "Create your signal"}</Text>
          <Text style={styles.authBody}>
            Sign {mode === "signin" ? "in" : "up"} to access factions, labs, and your EAGOH command layer.
          </Text>

          {mode === "signup" ? (
            <View style={styles.inputField}>
              <Text style={styles.fieldLabel}>Alias</Text>
              <TextInput
                value={username}
                onChangeText={setUsername}
                placeholder="nova.eagoh"
                placeholderTextColor={palette.muted}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.inputControl}
                editable={!isPending}
              />
            </View>
          ) : null}

          <View style={styles.inputField}>
            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@signal.net"
              placeholderTextColor={palette.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              style={styles.inputControl}
              editable={!isPending}
            />
          </View>

          <View style={styles.inputField}>
            <Text style={styles.fieldLabel}>Passcode</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={palette.muted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              textContentType={mode === "signup" ? "newPassword" : "password"}
              style={styles.inputControl}
              editable={!isPending}
            />
          </View>

          {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

          <Pressable
            onPress={submit}
            disabled={isPending}
            style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.8 }, isPending && { opacity: 0.5 }]}
          >
            <Text style={styles.primaryButtonText}>
              {isPending ? "Loading…" : mode === "signin" ? "Enter the grid" : "Create account"}
            </Text>
            {!isPending && <ChevronRight color={palette.void} size={20} />}
          </Pressable>

          <Pressable
            onPress={toggleMode}
            disabled={isPending}
            style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.secondaryButtonText}>
              {mode === "signin" ? "Create an account" : "Already have an account? Sign in"}
            </Text>
          </Pressable>
        </KeyboardAvoidingView>

        <Text style={styles.boot}>TRUST YOUR EAGOH.</Text>
      </LinearGradient>
    </SafeAreaView>
  );
}
