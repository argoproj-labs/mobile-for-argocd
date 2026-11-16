import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import { colors } from "../theme";
import { useArgoClient } from "../client";
import type { AppSource, RevisionHistory } from "../api";

const MONO = Platform.OS === "ios" ? "Menlo" : "monospace";

// ── Helpers ────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs > 0 ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

function shortRepo(url: string): string {
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    return u.pathname.replace(/^\//, "").replace(/\.git$/, "") || u.hostname;
  } catch {
    return url;
  }
}

function shortRev(rev?: string): string {
  if (!rev) return "—";
  return rev.length > 7 ? rev.slice(0, 7) : rev;
}

// ── Source row ─────────────────────────────────────────────────

function SourceRow({
  source,
  revision,
  index,
  total,
}: {
  source: AppSource;
  revision?: string;
  index?: number;
  total?: number;
}) {
  const label = total && total > 1 ? `Source ${(index ?? 0) + 1}` : null;
  return (
    <View style={s.sourceRow}>
      {label && <Text style={s.sourceLabel}>{label}</Text>}
      <View style={s.sourceDetails}>
        <View style={s.revRow}>
          <Text style={s.revText}>{shortRev(revision)}</Text>
          {source.chart && (
            <View style={s.helmBadge}>
              <Text style={s.helmBadgeText}>Helm</Text>
            </View>
          )}
        </View>
        <Text style={s.repoText} numberOfLines={1}>
          {shortRepo(source.repoURL)}
          {source.path ? ` · ${source.path}` : ""}
          {source.chart ? ` · ${source.chart}` : ""}
        </Text>
      </View>
    </View>
  );
}

// ── Deployment card ────────────────────────────────────────────

interface EnrichedEntry extends RevisionHistory {
  isCurrent: boolean;
  activeMs: number | null; // null = still active
  deployDurationMs: number | null;
}

function DeploymentCard({
  entry,
  onRollback,
  rollingBack,
}: {
  entry: EnrichedEntry;
  onRollback?: () => void;
  rollingBack?: boolean;
}) {
  const initiator = entry.initiatedBy?.automated
    ? "Automated"
    : entry.initiatedBy?.username || "Unknown";
  const isAuto = !!entry.initiatedBy?.automated;

  const sources: { source: AppSource; revision?: string }[] =
    entry.sources && entry.sources.length > 0
      ? entry.sources.map((src, i) => ({
          source: src,
          revision: entry.revisions?.[i],
        }))
      : entry.source
        ? [{ source: entry.source, revision: entry.revision }]
        : [];

  return (
    <View style={s.card}>
      {/* Top: time + badge */}
      <View style={s.cardTop}>
        <View style={s.timeBlock}>
          <Text style={s.timeAgo}>{timeAgo(entry.deployedAt)}</Text>
          <Text style={s.timeAbs}>{formatDate(entry.deployedAt)}</Text>
        </View>
        {entry.isCurrent && (
          <View style={s.currentBadge}>
            <Text style={s.currentBadgeText}>CURRENT</Text>
          </View>
        )}
      </View>

      {/* Sources */}
      {sources.length > 0 && (
        <View style={s.sourcesBlock}>
          {sources.map((src, i) => (
            <SourceRow
              key={i}
              source={src.source}
              revision={src.revision}
              index={i}
              total={sources.length}
            />
          ))}
        </View>
      )}

      {/* Meta row */}
      <View style={s.metaRow}>
        <Ionicons
          name={isAuto ? "flash" : "person-outline"}
          size={12}
          color={isAuto ? colors.success : colors.muted}
        />
        <Text style={s.metaText}>{initiator}</Text>
        {entry.deployDurationMs != null && (
          <>
            <Text style={s.metaDot}>·</Text>
            <Ionicons name="hourglass-outline" size={11} color={colors.faint} />
            <Text style={s.metaText}>
              {formatDuration(entry.deployDurationMs)}
            </Text>
          </>
        )}
        <Text style={s.metaDot}>·</Text>
        <Ionicons name="time-outline" size={11} color={colors.faint} />
        <Text style={s.metaText}>
          {entry.activeMs != null
            ? formatDuration(entry.activeMs)
            : "Active now"}
        </Text>
      </View>

      {/* Rollback */}
      {onRollback && (
        <TouchableOpacity
          style={s.rollbackBtn}
          onPress={onRollback}
          disabled={rollingBack}
          activeOpacity={0.7}
        >
          {rollingBack ? (
            <ActivityIndicator size="small" color={colors.orange} />
          ) : (
            <>
              <Ionicons
                name="arrow-undo-outline"
                size={14}
                color={colors.orange}
              />
              <Text style={s.rollbackBtnText}>Rollback to this version</Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Screen ─────────────────────────────────────────────────────

export default function HistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const client = useArgoClient();
  const queryClient = useQueryClient();
  const { name, namespace } = useLocalSearchParams<{
    name: string;
    namespace: string;
  }>();

  const [rollingBackId, setRollingBackId] = useState<number | null>(null);

  const { data: app, isLoading } = useQuery({
    queryKey: client.queryKeys.application(namespace, name),
    queryFn: () => client.getApplication(name, namespace),
  });

  const rollbackMutation = useMutation({
    mutationFn: (id: number) => client.rollbackApplication(name, namespace, id),
    onMutate: (id) => setRollingBackId(id),
    onSettled: () => setRollingBackId(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: client.queryKeys.application(namespace, name),
      });
      router.back();
    },
    onError: (err: Error) => {
      Alert.alert("Rollback failed", err.message);
    },
  });

  const entries = useMemo((): EnrichedEntry[] => {
    const raw = (app?.status?.history ?? []).slice().reverse();
    return raw.map((item, i) => {
      const prevItem = i > 0 ? raw[i - 1] : null;
      const activeMs = prevItem
        ? new Date(prevItem.deployedAt).getTime() -
          new Date(item.deployedAt).getTime()
        : null;
      const deployDurationMs =
        item.deployStartedAt != null
          ? new Date(item.deployedAt).getTime() -
            new Date(item.deployStartedAt).getTime()
          : null;
      return { ...item, isCurrent: i === 0, activeMs, deployDurationMs };
    });
  }, [app?.status?.history]);

  const shortName = name.split("/").pop()?.slice(0, 24) ?? name;

  const handleRollback = (entry: EnrichedEntry) => {
    Alert.alert(
      "Rollback",
      `Roll back to deployment from ${formatDate(entry.deployedAt)}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Rollback",
          style: "destructive",
          onPress: () => rollbackMutation.mutate(entry.id),
        },
      ],
    );
  };

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      <LinearGradient
        colors={["#171B33", "#0E1226"]}
        style={[s.header, { paddingTop: insets.top }]}
      >
        <View style={s.headerNav}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={s.backBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={18} color={colors.orange} />
            <Text style={s.backText}>{shortName}</Text>
          </TouchableOpacity>
        </View>
        <View style={s.headerInfo}>
          <Text style={s.headerLabel}>Deployment history</Text>
          <Text style={s.headerAppName} numberOfLines={1}>
            {name}
          </Text>
          {!isLoading && (
            <Text style={s.headerHint}>{entries.length} deployments</Text>
          )}
        </View>
      </LinearGradient>

      {isLoading && entries.length === 0 ? (
        <View style={s.loading}>
          <ActivityIndicator size="large" color={colors.orange} />
        </View>
      ) : entries.length === 0 ? (
        <View style={s.loading}>
          <Text style={s.emptyText}>No deployment history</Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <DeploymentCard
              entry={item}
              onRollback={
                item.isCurrent ? undefined : () => handleRollback(item)
              }
              rollingBack={rollingBackId === item.id}
            />
          )}
          contentContainerStyle={[
            s.list,
            { paddingBottom: insets.bottom + 24 },
          ]}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={s.separator} />}
        />
      )}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0E1226",
  },

  // Header
  header: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    paddingBottom: 12,
  },
  headerNav: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingTop: 6,
    minHeight: 44,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  backText: {
    fontSize: 17,
    fontWeight: "400",
    color: colors.orange,
    letterSpacing: -0.4,
  },
  headerInfo: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  headerLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: colors.faint,
    textTransform: "uppercase",
  },
  headerAppName: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.3,
    marginTop: 4,
    marginBottom: 2,
  },
  headerHint: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },

  // States
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 15,
    color: colors.muted,
  },

  // List
  list: {
    paddingTop: 16,
    paddingHorizontal: 16,
  },
  separator: {
    height: 10,
  },

  // Card
  card: {
    backgroundColor: "#1C2140",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: 14,
    gap: 10,
  },

  // Card top
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  timeBlock: {
    gap: 2,
  },
  timeAgo: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.3,
  },
  timeAbs: {
    fontSize: 11,
    color: colors.muted,
    fontFamily: MONO,
  },
  currentBadge: {
    backgroundColor: "rgba(239,123,77,0.15)",
    borderWidth: 1,
    borderColor: "rgba(239,123,77,0.40)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  currentBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.orange,
    letterSpacing: 0.6,
  },

  // Sources
  sourcesBlock: {
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingTop: 10,
    gap: 8,
  },
  sourceRow: {
    gap: 2,
  },
  sourceLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: colors.faint,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  sourceDetails: {
    gap: 3,
  },
  revRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  revText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
    fontFamily: MONO,
    letterSpacing: -0.2,
  },
  helmBadge: {
    backgroundColor: "rgba(59,150,226,0.14)",
    borderWidth: 1,
    borderColor: "rgba(59,150,226,0.35)",
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  helmBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#3B96E2",
    letterSpacing: 0.3,
  },
  repoText: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: MONO,
  },

  // Meta row
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 5,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingTop: 10,
  },
  metaText: {
    fontSize: 12,
    color: colors.muted,
    fontWeight: "500",
  },
  metaDot: {
    fontSize: 12,
    color: colors.hairlineHi,
    marginHorizontal: 1,
  },

  // Rollback
  rollbackBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingTop: 12,
    minHeight: 36,
  },
  rollbackBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.orange,
  },
});
