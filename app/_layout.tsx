import { Stack } from "expo-router";
import { Platform, View } from "react-native";
import {
  SafeAreaInsetsContext,
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { colors } from "../lib/theme";
import { UpgradeBanner } from "../components/upgrade-banner";

function RootContent() {
  const insets = useSafeAreaInsets();
  const showBanner = Platform.OS === "android";

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      {showBanner && <UpgradeBanner topInset={insets.top} />}
      {/* When the banner owns the top (status-bar) area, zero the top inset
          for the screens below so they don't double-pad and leave a gap. */}
      <SafeAreaInsetsContext.Provider
        value={showBanner ? { ...insets, top: 0 } : insets}
      >
        <Stack screenOptions={{ headerShown: false }} />
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <RootContent />
    </SafeAreaProvider>
  );
}
