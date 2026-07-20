import React from "react";
import {
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors } from "../lib/theme";

// The app has migrated to a new Play Store listing. This banner nudges the
// existing (old-package) Android install base to move over. Android-only,
// and intentionally NOT merged to main — it ships only on the deprecated
// io.akuity.argocd.mobile listing.
const NEW_APP_ID = "io.argoprojlabs.argocd.mobile";
const MARKET_URL = `market://details?id=${NEW_APP_ID}`;
const WEB_URL = `https://play.google.com/store/apps/details?id=${NEW_APP_ID}`;

export function UpgradeBanner({ topInset = 0 }: { topInset?: number }) {
  if (Platform.OS !== "android") return null;

  const open = async () => {
    try {
      const canMarket = await Linking.canOpenURL(MARKET_URL);
      await Linking.openURL(canMarket ? MARKET_URL : WEB_URL);
    } catch {
      Linking.openURL(WEB_URL).catch(() => {});
    }
  };

  return (
    <View style={[styles.wrap, { paddingTop: topInset }]}>
      <TouchableOpacity style={styles.row} onPress={open} activeOpacity={0.85}>
        <Ionicons name="arrow-up-circle" size={20} color={colors.ink} />
        <View style={styles.textBlock}>
          <Text style={styles.title}>This app has moved</Text>
          <Text style={styles.sub}>
            Tap to install the new version on Google Play
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.ink} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.orange,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  textBlock: {
    flex: 1,
  },
  title: {
    fontSize: 13.5,
    fontWeight: "700",
    color: colors.ink,
    letterSpacing: -0.2,
  },
  sub: {
    fontSize: 11.5,
    fontWeight: "500",
    color: "rgba(11,21,48,0.75)",
    marginTop: 1,
  },
});
