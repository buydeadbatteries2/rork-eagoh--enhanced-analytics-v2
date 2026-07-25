import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useMemo } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, StyleSheet, View, Text } from "react-native";
import { AuthProvider, useAuth } from "@/providers/AuthProvider";
import { ProfileProvider } from "@/providers/ProfileProvider";
import { EagohProvider } from "@/providers/EagohProvider";
import { EdgeProvider } from "@/providers/EdgeProvider";
import { ForgeProvider } from "@/providers/ForgeProvider";
import { RevenueCatProvider } from "@/providers/RevenueCatProvider";
import { palette } from "@/constants/colors";
import { startupLog } from "@/utils/startupLogger";

startupLog("AppEntry_imports_loaded", "success");

startupLog("SplashScreen_preventAutoHideAsync", "start");
SplashScreen.preventAutoHideAsync();
startupLog("SplashScreen_preventAutoHideAsync", "success");

startupLog("QueryClient_creation", "start");
const queryClient = new QueryClient();
startupLog("QueryClient_creation", "success");

/** Auth guard — redirects based on auth state. Must live inside providers to access useAuth. */
function AuthGate(): JSX.Element {
  startupLog("AuthGate_render", "start");
  const { isAuthenticated, isReady } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!isReady) return;

    const inAuthGroup = segments[0] === "(auth)";

    if (!isAuthenticated && !inAuthGroup) {
      // Not signed in and not already on an auth screen → go to login
      startupLog("AuthGate_redirect_login", "success");
      router.replace("/(auth)/login");
    } else if (isAuthenticated && inAuthGroup) {
      // Signed in but on an auth screen → go to home
      startupLog("AuthGate_redirect_home", "success");
      router.replace("/(tabs)");
    }
  }, [isReady, isAuthenticated, segments, router]);

  useEffect(() => {
    if (isReady) {
      startupLog("SplashScreen_hideAsync", "start");
      SplashScreen.hideAsync();
      startupLog("SplashScreen_hideAsync", "success");
    }
  }, [isReady]);
  startupLog("AuthGate_render", "success");

  // Show nothing while auth is loading — prevents flash of wrong screen
  if (!isReady) {
    return (
      <View style={authStyles.splash}>
        <StatusBar style="light" />
        <ActivityIndicator color={palette.cyan} size="large" />
        <Text style={authStyles.splashText}>INITIALIZING TRUST PROTOCOL</Text>
      </View>
    );
  }

  // Auth gate renders nothing itself — the Stack below handles routing
  return (
    <GestureHandlerRootView style={authStyles.root}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.void },
        }}
      >
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="+not-found"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="labs"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="factions"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="open-intelligence"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="leaderboards"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="settings"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="legal/terms"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="legal/privacy"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="legal/disclaimer"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="public-profile"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="public-listing"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="subscription"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="edge-store"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="analyst-archive"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="analyst-thread-detail"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="my-intelligence"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="moderation"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="notifications"
          options={{ presentation: "modal", headerShown: false }}
        />
      </Stack>
    </GestureHandlerRootView>
  );
}

const authStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.void },
  splash: {
    flex: 1,
    backgroundColor: palette.void,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  splashText: {
    color: palette.cyan,
    fontSize: 10,
    fontWeight: "900" as const,
    letterSpacing: 3.2,
    marginTop: 8,
  },
});

export default function RootLayout(): JSX.Element {
  startupLog("RootLayout_render", "start");
  startupLog("RootLayout_render", "success");
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ProfileProvider>
          <RevenueCatProvider>
            <EdgeProvider>
              <EagohProvider>
                <ForgeProvider>
                  <AuthGate />
                </ForgeProvider>
              </EagohProvider>
            </EdgeProvider>
          </RevenueCatProvider>
        </ProfileProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
