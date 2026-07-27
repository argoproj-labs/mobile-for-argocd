import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { WebView, type WebViewNavigation } from "react-native-webview";

import { colors } from "../lib/theme";
import { getUserInfo, hostFromUrl } from "../lib/api";
import { COOKIE_SESSION } from "../lib/storage";
import { useInstanceStore } from "../lib/instanceStore";

export default function WebViewLogin() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { server } = useLocalSearchParams<{ server: string }>();
  const { upsertInstance } = useInstanceStore();

  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const done = useRef(false);

  // Argo CD's `argocd.token` cookie is HttpOnly, so we can't read it from JS.
  // Instead, ask the API who we are: the request rides the native cookie jar
  // (sharedCookiesEnabled), so a logged-in answer proves the HttpOnly cookie —
  // and any proxy session cookie — is being sent. No bearer token exists in
  // this flow; auth is carried entirely by the shared cookie.
  const probe = useCallback(
    async (manual: boolean) => {
      if (done.current || !server) return;
      if (manual) setChecking(true);
      try {
        const info = await getUserInfo(server, "");
        if (info?.loggedIn) {
          done.current = true;
          if (server) await upsertInstance(server, COOKIE_SESSION);
          router.replace("/(app)/");
          return;
        }
        if (manual) {
          setHint(
            "Not signed in yet. Finish logging in on this page, then tap Done.",
          );
        }
      } catch {
        if (manual) {
          setHint("Couldn't verify the session. Finish logging in, then Done.");
        }
      } finally {
        if (manual) setChecking(false);
      }
    },
    [server, router, upsertInstance],
  );

  const onNavChange = useCallback(
    (nav: WebViewNavigation) => {
      setHint(null);
      if (!nav.loading) void probe(false);
    },
    [probe],
  );

  if (!server) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.errorText}>No server URL provided.</Text>
      </View>
    );
  }

  // Go straight to the login page. The root path can't be relied on to
  // redirect there — behind a proxy, or with a custom index, it may serve
  // something else entirely. `server` stays the API base for the probe.
  const loginUrl = `${server.replace(/\/+$/, "")}/login`;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.headerBtn}
        >
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Sign in
          </Text>
          <Text style={styles.headerHost} numberOfLines={1}>
            {hostFromUrl(server)}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => void probe(true)}
          hitSlop={12}
          style={styles.headerBtn}
          disabled={checking}
        >
          {checking ? (
            <ActivityIndicator color={colors.orange} size="small" />
          ) : (
            <Text style={styles.doneText}>Done</Text>
          )}
        </TouchableOpacity>
      </View>

      {hint && (
        <View style={styles.hintBar}>
          <Ionicons name="information-circle" size={16} color={colors.orange} />
          <Text style={styles.hintText}>{hint}</Text>
        </View>
      )}

      <WebView
        source={{ uri: loginUrl }}
        style={styles.webview}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => {
          setLoading(false);
          void probe(false);
        }}
        onNavigationStateChange={onNavChange}
      />

      {loading && (
        <View style={styles.loadingBar}>
          <ActivityIndicator color={colors.orange} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.ink,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    color: colors.danger,
    fontSize: 15,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.inkMid,
  },
  headerBtn: {
    minWidth: 52,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitleWrap: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    letterSpacing: -0.2,
  },
  headerHost: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginTop: 1,
  },
  doneText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.orange,
  },
  hintBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "rgba(239,123,77,0.12)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(239,123,77,0.25)",
  },
  hintText: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
  },
  webview: {
    flex: 1,
    backgroundColor: "#fff",
  },
  loadingBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "transparent",
  },
});
