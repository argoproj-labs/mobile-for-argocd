import React from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import { colors } from "../../../lib/theme";
import { useArgoClient } from "../../../lib/client";
import { logout } from "../../../lib/api";
import { tokenStorage } from "../../../lib/storage";

const MONO = Platform.OS === "ios" ? "Menlo" : "monospace";

function SectionLabel({ label }: { label: string }) {
  return <Text style={s.sectionLabel}>{label}</Text>;
}

function InfoRow({
  label,
  value,
  mono,
  last,
}: {
  label: string;
  value: string;
  mono?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[s.infoRow, !last && s.infoRowBorder]}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={[s.infoValue, mono && s.infoValueMono]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export default function UserScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const client = useArgoClient();
  const queryClient = useQueryClient();

  const { data: userInfo, isLoading } = useQuery({
    queryKey: client.queryKeys.userInfo(),
    queryFn: () => client.getUserInfo(),
  });

  const handleLogout = () => {
    Alert.alert("Log out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: async () => {
          // Expire the server session cookie before dropping local state, so a
          // browser-login (cookie) session doesn't silently persist in the jar.
          await logout(client.serverUrl);
          await tokenStorage.clear();
          queryClient.clear();
          router.replace("/login");
        },
      },
    ]);
  };

  const hostname = (() => {
    try {
      return new URL(client.serverUrl).hostname;
    } catch {
      return client.serverUrl;
    }
  })();

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      <LinearGradient
        colors={["#171B33", "#0E1226"]}
        style={[s.header, { paddingTop: insets.top }]}
      >
        <View style={s.headerContent}>
          <Image
            source={require("../../../assets/argo-mascot.png")}
            style={s.mascot}
            resizeMode="contain"
          />
          {isLoading ? (
            <ActivityIndicator color={colors.orange} style={{ marginTop: 8 }} />
          ) : (
            <>
              <Text style={s.username}>{userInfo?.username ?? "—"}</Text>
              <Text style={s.serverHost}>{hostname}</Text>
            </>
          )}
        </View>
      </LinearGradient>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[
          s.scrollContent,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {userInfo && (
          <>
            <SectionLabel label="Account" />
            <View style={s.card}>
              <InfoRow label="Username" value={userInfo.username} />
              <InfoRow
                label="Issuer"
                value={userInfo.iss}
                mono
                last={!userInfo.groups?.length}
              />
              {userInfo.groups && userInfo.groups.length > 0 && (
                <View style={s.groupsRow}>
                  <Text style={s.infoLabel}>Groups</Text>
                  <View style={s.groupsList}>
                    {userInfo.groups.map((g, i) => (
                      <View key={i} style={s.groupBadge}>
                        <Text style={s.groupBadgeText}>{g}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>

            <SectionLabel label="Server" />
            <View style={s.card}>
              <InfoRow label="Host" value={hostname} mono last />
            </View>
          </>
        )}

        <SectionLabel label="Session" />
        <View style={s.card}>
          <TouchableOpacity
            style={s.logoutRow}
            onPress={handleLogout}
            activeOpacity={0.7}
          >
            <Ionicons name="log-out-outline" size={18} color={colors.danger} />
            <Text style={s.logoutText}>Log out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0E1226",
  },

  // Header
  header: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    paddingBottom: 24,
  },
  headerContent: {
    alignItems: "center",
    paddingTop: 20,
    gap: 8,
  },
  mascot: {
    width: 80,
    height: 80,
  },
  username: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.3,
  },
  serverHost: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: MONO,
  },

  // Content
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 20,
    paddingHorizontal: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: colors.faint,
    textTransform: "uppercase",
    paddingLeft: 4,
    paddingBottom: 6,
    marginTop: 8,
  },
  card: {
    backgroundColor: "#1C2140",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: "hidden",
    marginBottom: 16,
  },

  // Info row
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
  },
  infoRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  infoLabel: {
    fontSize: 15,
    color: colors.muted,
    fontWeight: "500",
    flexShrink: 0,
  },
  infoValue: {
    fontSize: 15,
    color: colors.text,
    fontWeight: "500",
    textAlign: "right",
    flexShrink: 1,
  },
  infoValueMono: {
    fontFamily: MONO,
    fontSize: 13,
  },

  // Groups row
  groupsRow: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 10,
  },
  groupsList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  groupBadge: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  groupBadgeText: {
    fontSize: 12,
    color: colors.text,
    fontFamily: MONO,
    fontWeight: "500",
  },

  // Logout
  logoutRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.danger,
  },
});
