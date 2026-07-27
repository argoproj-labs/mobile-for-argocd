import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { InstanceStoreProvider } from "../lib/instanceStore";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <InstanceStoreProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </InstanceStoreProvider>
    </SafeAreaProvider>
  );
}
