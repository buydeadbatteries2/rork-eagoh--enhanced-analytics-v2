import { Stack } from "expo-router";

/** Auth route group — own Stack so Login / Register never render inside the Tabs navigator. */
export default function AuthLayout(): JSX.Element {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="login" />
    </Stack>
  );
}
