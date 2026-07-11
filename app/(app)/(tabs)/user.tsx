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
import { useAccounts, useArgoClient } from "../../../lib/client";

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
  const {
    accounts,
    activeAccountId,
    switchAccount,
    removeAccount,
    updateUsername,
  } = useAccounts();

  const { data: userInfo, isLoading } = useQuery({
    queryKey: client.queryKeys.userInfo(),
    queryFn: () => client.getUserInfo(),
  });

  const hostname = (() => {
    try {
      return new URL(client.serverUrl).hostname;
    } catch {
      return client.serverUrl;
    }
  })();

  // Keep the saved account's display name in sync once we know who's logged in
  React.useEffect(() => {
    const current = accounts.find((a) => a.id === activeAccountId);
    if (
      userInfo?.username &&
      current &&
      current.username !== userInfo.username
    ) {
      updateUsername(activeAccountId!, userInfo.username);
    }
  }, [userInfo?.username, activeAccountId, accounts, updateUsername]);

  const accountHost = (url: string) => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  };

  const handleSwitchAccount = async (id: string) => {
    if (id === activeAccountId) return;
    await switchAccount(id);
    queryClient.clear();
    router.replace("/(app)/");
  };

  const handleRemoveAccount = (id: string) => {
    const account = accounts.find((a) => a.id === id);
    const label = account?.username || accountHost(account?.serverUrl ?? "");
    const consequence =
      accounts.length === 1
        ? "You'll be signed out."
        : id === activeAccountId
          ? "You'll be switched to another account."
          : "";
    Alert.alert("Remove account", `Remove ${label}? ${consequence}`.trim(), [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          queryClient.clear();
          await removeAccount(id);
        },
      },
    ]);
  };

  const handleAddAccount = () => {
    router.replace("/login");
  };

  const handleLogout = () => handleRemoveAccount(client.accountId);

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

        <SectionLabel label="Accounts" />
        <View style={s.card}>
          {accounts.map((account) => {
            const isActive = account.id === activeAccountId;
            return (
              <TouchableOpacity
                key={account.id}
                style={[s.accountRow, s.infoRowBorder]}
                onPress={() => handleSwitchAccount(account.id)}
                activeOpacity={0.7}
              >
                <View style={s.accountRowMain}>
                  <Text style={s.accountUsername} numberOfLines={1}>
                    {account.username || "Unknown user"}
                  </Text>
                  <Text style={s.accountHost} numberOfLines={1}>
                    {accountHost(account.serverUrl)}
                  </Text>
                </View>
                {isActive ? (
                  <Ionicons
                    name="checkmark-circle"
                    size={20}
                    color={colors.success}
                  />
                ) : (
                  <TouchableOpacity
                    onPress={() => handleRemoveAccount(account.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={18}
                      color={colors.faint}
                    />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={s.addAccountRow}
            onPress={handleAddAccount}
            activeOpacity={0.7}
          >
            <Ionicons
              name="add-circle-outline"
              size={18}
              color={colors.orange}
            />
            <Text style={s.addAccountText}>Add account</Text>
          </TouchableOpacity>
        </View>

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

  // Accounts
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  accountRowMain: {
    flex: 1,
    gap: 2,
  },
  accountUsername: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
  },
  accountHost: {
    fontSize: 12,
    fontFamily: MONO,
    color: colors.muted,
  },
  addAccountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  addAccountText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.orange,
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
