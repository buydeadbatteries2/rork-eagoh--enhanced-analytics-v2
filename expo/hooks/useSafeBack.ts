import { useRouter, useNavigation } from "expo-router";
import { useCallback } from "react";

/**
 * Returns a safe back handler that checks navigation state before dispatching
 * GO_BACK. On web, router.canGoBack() is unsupported (throws "imperative method
 * not supported"), so we read the stack depth from navigation.getState() instead.
 *
 * Falls back to navigating to the given route when there is no screen to go
 * back to (e.g. when the screen was accessed via a direct URL / refresh).
 */
export function useSafeBack(fallbackRoute = "/(tabs)"): () => void {
  const router = useRouter();
  const navigation = useNavigation();

  return useCallback(() => {
    const state = navigation.getState();
    // In a stack navigator, index > 0 means there are previous routes.
    if (state && state.index > 0) {
      router.back();
    } else {
      router.replace(fallbackRoute as never);
    }
  }, [router, navigation, fallbackRoute]);
}
