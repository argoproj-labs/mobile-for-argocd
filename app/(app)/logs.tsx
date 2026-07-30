import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors } from "../../lib/theme";
import { useArgoClient } from "../../lib/client";
import type { LogEntry } from "../../lib/api";

const MONO = Platform.OS === "ios" ? "Menlo" : "monospace";
const MAX_LINES = 5_000;
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

// ── Types ──────────────────────────────────────────────────────

interface LogLine {
  id: number;
  content: string;
  ts: string;
}

// ── Helpers ────────────────────────────────────────────────────

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function extractContainers(spec: object): string[] {
  const s = spec as {
    containers?: { name: string }[];
    initContainers?: { name: string }[];
  };
  return [...(s.containers ?? []), ...(s.initContainers ?? [])]
    .map((c) => c.name)
    .filter(Boolean);
}

// ── LogLine row ────────────────────────────────────────────────

const LogLineRow = React.memo(function LogLineRow({
  line,
  showTs,
  wrap,
}: {
  line: LogLine;
  showTs: boolean;
  wrap: boolean;
}) {
  return (
    <View style={styles.row}>
      {showTs && !!line.ts && (
        <Text style={styles.ts} numberOfLines={1}>
          {line.ts}{" "}
        </Text>
      )}
      <Text
        style={styles.content}
        numberOfLines={wrap ? undefined : 1}
        selectable
      >
        {line.content}
      </Text>
    </View>
  );
});

// ── Toggle pill ────────────────────────────────────────────────

function Toggle({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.toggle, active && styles.toggleActive]}
    >
      <Text style={[styles.toggleText, active && styles.toggleTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ── Logs screen ────────────────────────────────────────────────

export default function LogsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const client = useArgoClient();

  const {
    appName,
    appNamespace,
    namespace,
    podName,
    group,
    kind,
    resourceName,
  } = useLocalSearchParams<{
    appName: string;
    appNamespace: string;
    namespace: string;
    podName?: string;
    group?: string;
    kind?: string;
    resourceName?: string;
  }>();

  // ── Controls state ─────────────────────────────────────────

  const [follow, setFollow] = useState(true);
  const [showTs, setShowTs] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [previous, setPrevious] = useState(false);
  const [tail] = useState(1000);
  const [container, setContainer] = useState<string>("");
  const [containers, setContainers] = useState<string[]>([]);
  const [filterText, setFilterText] = useState("");
  const [showFilter, setShowFilter] = useState(false);

  // ── Lines state ────────────────────────────────────────────

  const [lines, setLines] = useState<LogLine[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const lineIdRef = useRef(0);
  const bufferRef = useRef<LogLine[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);
  const flatListRef = useRef<FlatList<LogLine>>(null);
  const autoScrollRef = useRef(true);

  // ── Pod spec fetch for container list ──────────────────────

  const hasPod = !!podName || kind?.toLowerCase() === "pod";
  const specQueryKey = client.queryKeys.resource(
    appNamespace,
    appName,
    group,
    undefined,
    kind ?? "Pod",
    namespace,
    podName ?? resourceName ?? "",
  );

  const { data: podSpec } = useQuery({
    queryKey: specQueryKey,
    queryFn: () =>
      client.getResource(
        appName,
        appNamespace,
        group,
        undefined,
        kind ?? "Pod",
        namespace,
        podName ?? resourceName ?? "",
      ),
    enabled: hasPod,
  });

  useEffect(() => {
    if (!podSpec) return;
    const spec = (podSpec as { spec?: object })?.spec;
    if (!spec) return;
    const cs = extractContainers(spec);
    setContainers(cs);
    if (!container && cs.length > 0) setContainer(cs[0]);
  }, [podSpec]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Batch flush (100 ms) ───────────────────────────────────

  useEffect(() => {
    const timer = setInterval(() => {
      if (bufferRef.current.length === 0) return;
      const batch = bufferRef.current.splice(0, bufferRef.current.length);
      setLines((prev) => {
        const next = [...prev, ...batch];
        return next.length > MAX_LINES
          ? next.slice(next.length - MAX_LINES)
          : next;
      });
    }, 100);
    return () => clearInterval(timer);
  }, []);

  // ── Auto-scroll when lines update ─────────────────────────

  useEffect(() => {
    if (autoScrollRef.current) {
      flatListRef.current?.scrollToEnd({ animated: false });
    }
  }, [lines]);

  // ── Stream lifecycle ───────────────────────────────────────

  const startStream = useCallback(() => {
    const c = container || (hasPod ? "" : "");
    if (!c && hasPod) return; // wait for container to be set

    cleanupRef.current?.();
    lineIdRef.current = 0;
    bufferRef.current = [];
    setLines([]);
    setStreaming(true);
    setError(null);
    autoScrollRef.current = true;
    setShowScrollBtn(false);

    const cleanup = client.streamLogs(
      appName,
      appNamespace,
      namespace,
      podName,
      group,
      kind,
      resourceName,
      c,
      tail,
      follow,
      previous,
      (entry: LogEntry) => {
        bufferRef.current.push({
          id: lineIdRef.current++,
          content: stripAnsi(entry.content ?? ""),
          ts: entry.timeStampStr ?? "",
        });
      },
      (err: Error) => {
        setStreaming(false);
        setError(err.message);
      },
      () => {
        setStreaming(false);
      },
    );

    cleanupRef.current = cleanup;
  }, [
    appName,
    appNamespace,
    namespace,
    podName,
    group,
    kind,
    resourceName,
    container,
    tail,
    follow,
    previous,
    hasPod,
    client,
  ]);

  // Start stream once container is known (or immediately for non-pod resources)
  useEffect(() => {
    if (hasPod && !container) return;
    startStream();
    return () => {
      cleanupRef.current?.();
    };
  }, [container, follow, previous, tail]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll tracking ────────────────────────────────────────

  const handleScroll = useCallback(
    (event: any) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent as {
          contentOffset: { y: number };
          contentSize: { height: number };
          layoutMeasurement: { height: number };
        };
      const distFromBottom =
        contentSize.height - layoutMeasurement.height - contentOffset.y;
      const nearBottom = distFromBottom < 80;
      autoScrollRef.current = nearBottom;
      setShowScrollBtn(!nearBottom && streaming);
    },
    [streaming],
  );

  const scrollToBottom = useCallback(() => {
    autoScrollRef.current = true;
    setShowScrollBtn(false);
    flatListRef.current?.scrollToEnd({ animated: true });
  }, []);

  // ── Filtered lines ─────────────────────────────────────────

  const filteredLines = useMemo(() => {
    if (!filterText) return lines;
    const lower = filterText.toLowerCase();
    return lines.filter((l) => l.content.toLowerCase().includes(lower));
  }, [lines, filterText]);

  // ── Title ──────────────────────────────────────────────────

  const title = podName ?? resourceName ?? kind ?? "Logs";

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 12 }}
        >
          <Ionicons name="chevron-back" size={18} color={colors.orange} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <TouchableOpacity
          onPress={() => setShowFilter((v) => !v)}
          style={styles.searchBtn}
          hitSlop={{ top: 8, bottom: 8, left: 12, right: 8 }}
        >
          <Ionicons
            name={showFilter ? "search" : "search-outline"}
            size={18}
            color={showFilter ? colors.orange : colors.muted}
          />
        </TouchableOpacity>
      </View>

      {/* Container pills */}
      {containers.length > 1 && (
        <View style={styles.containerBar}>
          {containers.map((c) => (
            <TouchableOpacity
              key={c}
              onPress={() => setContainer(c)}
              activeOpacity={0.7}
              style={[
                styles.containerPill,
                c === container && styles.containerPillActive,
              ]}
            >
              <Text
                style={[
                  styles.containerPillText,
                  c === container && styles.containerPillTextActive,
                ]}
              >
                {c}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Controls */}
      <View style={styles.controls}>
        <Toggle
          label="Follow"
          active={follow}
          onPress={() => setFollow((v) => !v)}
        />
        <Toggle
          label="Timestamps"
          active={showTs}
          onPress={() => setShowTs((v) => !v)}
        />
        <Toggle label="Wrap" active={wrap} onPress={() => setWrap((v) => !v)} />
        <Toggle
          label="Previous"
          active={previous}
          onPress={() => setPrevious((v) => !v)}
        />
        <TouchableOpacity
          onPress={startStream}
          style={styles.reloadBtn}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <Ionicons name="reload" size={14} color={colors.muted} />
        </TouchableOpacity>
      </View>

      {/* Filter bar */}
      {showFilter && (
        <View style={styles.filterRow}>
          <Ionicons name="search" size={13} color={colors.muted} />
          <TextInput
            style={styles.filterInput}
            value={filterText}
            onChangeText={setFilterText}
            placeholder="Filter..."
            placeholderTextColor={colors.faint}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
          />
          {!!filterText && (
            <TouchableOpacity onPress={() => setFilterText("")}>
              <Ionicons name="close-circle" size={15} color={colors.muted} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Log content */}
      <View style={styles.logContainer}>
        {error ? (
          <View style={styles.centerState}>
            <Ionicons
              name="alert-circle-outline"
              size={28}
              color={colors.muted}
            />
            <Text style={styles.stateText}>{error}</Text>
            <TouchableOpacity onPress={startStream} style={styles.retryBtn}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : lines.length === 0 && !streaming ? (
          <View style={styles.centerState}>
            <Text style={styles.stateText}>No logs</Text>
          </View>
        ) : lines.length === 0 && streaming ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.orange} />
            <Text style={styles.stateText}>Waiting for logs…</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={filteredLines}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => (
              <LogLineRow line={item} showTs={showTs} wrap={wrap} />
            )}
            style={styles.flatList}
            contentContainerStyle={{ paddingBottom: insets.bottom + 8 }}
            showsVerticalScrollIndicator={false}
            onScroll={handleScroll}
            scrollEventThrottle={100}
            removeClippedSubviews
            maxToRenderPerBatch={40}
            windowSize={8}
          />
        )}

        {/* Scroll-to-bottom FAB */}
        {showScrollBtn && (
          <TouchableOpacity
            onPress={scrollToBottom}
            style={styles.scrollFab}
            activeOpacity={0.8}
          >
            <Ionicons name="arrow-down" size={18} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      {/* Status bar */}
      <View
        style={[styles.statusBar, { paddingBottom: insets.bottom > 0 ? 0 : 8 }]}
      >
        <View style={styles.statusLeft}>
          {streaming ? (
            <>
              <View style={styles.liveDot} />
              <Text style={styles.statusText}>Live</Text>
            </>
          ) : error ? (
            <Text style={[styles.statusText, { color: colors.danger }]}>
              Error
            </Text>
          ) : (
            <Text style={styles.statusText}>Done</Text>
          )}
        </View>
        <Text style={styles.lineCount}>
          {filteredLines.length !== lines.length
            ? `${filteredLines.length} / ${lines.length} lines`
            : `${lines.length} lines`}
        </Text>
        {container ? (
          <Text style={styles.containerLabel}>{container}</Text>
        ) : null}
      </View>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.ink,
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minWidth: 60,
  },
  backText: {
    fontSize: 15,
    color: colors.orange,
    fontWeight: "500",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
    letterSpacing: -0.2,
    fontFamily: MONO,
  },
  searchBtn: {
    minWidth: 60,
    alignItems: "flex-end",
  },

  // Container pills
  containerBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  containerPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  containerPillActive: {
    backgroundColor: "rgba(239,123,77,0.18)",
    borderColor: colors.orange,
  },
  containerPillText: {
    fontSize: 12,
    fontFamily: MONO,
    color: colors.muted,
  },
  containerPillTextActive: {
    color: colors.orange,
    fontWeight: "600",
  },

  // Controls
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    flexWrap: "wrap",
  },
  toggle: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  toggleActive: {
    backgroundColor: "rgba(239,123,77,0.15)",
    borderColor: colors.orange,
  },
  toggleText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.muted,
  },
  toggleTextActive: {
    color: colors.orange,
  },
  reloadBtn: {
    padding: 6,
    marginLeft: "auto" as unknown as number,
  },

  // Filter
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  filterInput: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    fontFamily: MONO,
    paddingVertical: 0,
  },

  // Log area
  logContainer: {
    flex: 1,
    backgroundColor: "#0d1119",
    position: "relative",
  },
  flatList: {
    flex: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 1,
  },
  ts: {
    fontSize: 11,
    fontFamily: MONO,
    color: "rgba(245,246,250,0.35)",
    flexShrink: 0,
  },
  content: {
    flex: 1,
    fontSize: 12,
    fontFamily: MONO,
    color: "#d6dae0",
    lineHeight: 18,
  },

  // Scroll FAB
  scrollFab: {
    position: "absolute",
    right: 16,
    bottom: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.orange,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },

  // Status bar
  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 6,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    backgroundColor: colors.ink,
    gap: 8,
  },
  statusLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
  },
  statusText: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: "600",
  },
  lineCount: {
    fontSize: 11,
    color: colors.faint,
    flex: 1,
    textAlign: "center",
  },
  containerLabel: {
    fontSize: 11,
    color: colors.faint,
    fontFamily: MONO,
  },

  // Empty / error states
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingBottom: 60,
  },
  stateText: {
    fontSize: 13,
    color: colors.muted,
    textAlign: "center",
    paddingHorizontal: 32,
  },
  retryBtn: {
    marginTop: 4,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "rgba(239,123,77,0.15)",
    borderWidth: 1,
    borderColor: colors.orange,
  },
  retryText: {
    fontSize: 13,
    color: colors.orange,
    fontWeight: "600",
  },
});
