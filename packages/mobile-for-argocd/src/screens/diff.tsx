import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { diffLines as computeDiff } from "diff";
import * as jsYaml from "js-yaml";

import { colors } from "../theme";
import { useArgoClient } from "../client";
import type { ManagedResource } from "../api";

// ── Colors ────────────────────────────────────────────────────

const ADD_COLOR = "#4ec46b";
const REMOVE_COLOR = "#f2766c";
const ADD_BG = "rgba(78,196,107,0.10)";
const REMOVE_BG = "rgba(242,118,108,0.10)";
const TERM_BG = "#0d1119";
const MONO = Platform.OS === "ios" ? "Menlo" : "monospace";
const CONTEXT_LINES = 3;

// ── Diff computation ──────────────────────────────────────────

type DiffLineType = "add" | "remove" | "context" | "collapse";

interface DiffLine {
  type: DiffLineType;
  content: string;
  lineNoOld: number | null;
  lineNoNew: number | null;
  collapseCount?: number;
}

function stateToYaml(raw: string | undefined | null): string {
  if (!raw) return "";
  try {
    return jsYaml.dump(JSON.parse(raw) as object, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
    });
  } catch {
    return raw;
  }
}

function buildDiffLines(
  oldYaml: string,
  newYaml: string,
  compact: boolean,
): DiffLine[] {
  const changes = computeDiff(oldYaml, newYaml);

  // Expand into flat lines
  const flat: { type: "add" | "remove" | "context"; content: string }[] = [];
  for (const ch of changes) {
    const type = ch.added ? "add" : ch.removed ? "remove" : "context";
    const lines = ch.value.split("\n");
    if (lines.at(-1) === "") lines.pop();
    for (const l of lines) flat.push({ type, content: l });
  }

  // Assign line numbers
  let lo = 1;
  let ln = 1;
  const numbered: DiffLine[] = flat.map((l) => {
    const d: DiffLine = {
      type: l.type,
      content: l.content,
      lineNoOld: l.type !== "add" ? lo : null,
      lineNoNew: l.type !== "remove" ? ln : null,
    };
    if (l.type !== "add") lo++;
    if (l.type !== "remove") ln++;
    return d;
  });

  if (!compact) return numbered;

  // Context collapsing
  const result: DiffLine[] = [];
  let i = 0;
  while (i < numbered.length) {
    if (numbered[i].type !== "context") {
      result.push(numbered[i++]);
      continue;
    }
    // Find full run of context lines
    let j = i;
    while (j < numbered.length && numbered[j].type === "context") j++;
    const run = numbered.slice(i, j);

    const isFirst = result.length === 0;
    const isLast = j === numbered.length;

    if (isFirst && isLast) {
      // Entire diff is context (no changes) — skip all
    } else if (isFirst) {
      // Leading context: keep only the last CONTEXT_LINES
      const keep = run.slice(-CONTEXT_LINES);
      if (run.length > CONTEXT_LINES) {
        result.push({
          type: "collapse",
          content: "",
          lineNoOld: null,
          lineNoNew: null,
          collapseCount: run.length - CONTEXT_LINES,
        });
      }
      result.push(...keep);
    } else if (isLast) {
      // Trailing context: keep only the first CONTEXT_LINES
      const keep = run.slice(0, CONTEXT_LINES);
      result.push(...keep);
      if (run.length > CONTEXT_LINES) {
        result.push({
          type: "collapse",
          content: "",
          lineNoOld: null,
          lineNoNew: null,
          collapseCount: run.length - CONTEXT_LINES,
        });
      }
    } else if (run.length > CONTEXT_LINES * 2) {
      // Middle context run: keep CONTEXT_LINES from each end
      result.push(...run.slice(0, CONTEXT_LINES));
      result.push({
        type: "collapse",
        content: "",
        lineNoOld: null,
        lineNoNew: null,
        collapseCount: run.length - CONTEXT_LINES * 2,
      });
      result.push(...run.slice(-CONTEXT_LINES));
    } else {
      result.push(...run);
    }
    i = j;
  }

  return result;
}

interface ResourceDiff {
  resource: ManagedResource;
  lines: DiffLine[];
  addCount: number;
  removeCount: number;
}

function buildResourceDiffs(
  items: ManagedResource[],
  compact: boolean,
): ResourceDiff[] {
  const result: ResourceDiff[] = [];
  for (const r of items) {
    if (r.hook) continue;
    const oldYaml = stateToYaml(r.normalizedLiveState);
    const newYaml = stateToYaml(r.predictedLiveState);
    if (oldYaml === newYaml) continue;
    const lines = buildDiffLines(oldYaml, newYaml, compact);
    const addCount = lines.filter((l) => l.type === "add").length;
    const removeCount = lines.filter((l) => l.type === "remove").length;
    result.push({ resource: r, lines, addCount, removeCount });
  }
  return result;
}

// ── Resource diff section ─────────────────────────────────────

function resourceLabel(r: ManagedResource): string {
  const parts = [r.group, r.kind].filter(Boolean).join("/");
  const loc = [r.namespace, r.name].filter(Boolean).join("/");
  return `${parts}: ${loc}`;
}

function DiffLineRow({ line }: { line: DiffLine }) {
  if (line.type === "collapse") {
    return (
      <View style={styles.collapseRow}>
        <Text style={styles.collapseText}>
          {"· · · "}
          {line.collapseCount} unchanged{" "}
          {line.collapseCount === 1 ? "line" : "lines"}
          {" · · ·"}
        </Text>
      </View>
    );
  }

  const isAdd = line.type === "add";
  const isRemove = line.type === "remove";
  const bg = isAdd ? ADD_BG : isRemove ? REMOVE_BG : "transparent";
  const opColor = isAdd ? ADD_COLOR : isRemove ? REMOVE_COLOR : colors.faint;
  const op = isAdd ? "+" : isRemove ? "−" : " ";

  return (
    <View style={[styles.diffRow, { backgroundColor: bg }]}>
      <Text style={styles.lineNo}>
        {line.lineNoOld != null ? String(line.lineNoOld) : ""}
      </Text>
      <Text style={styles.lineNo}>
        {line.lineNoNew != null ? String(line.lineNoNew) : ""}
      </Text>
      <Text style={[styles.opCol, { color: opColor }]}>{op}</Text>
      <Text style={styles.diffContent} numberOfLines={1}>
        {line.content}
      </Text>
    </View>
  );
}

function ResourceSection({ diff }: { diff: ResourceDiff }) {
  return (
    <View style={styles.resourceSection}>
      {/* Resource header */}
      <View style={styles.resourceHeader}>
        <Text style={styles.resourceLabel} numberOfLines={1}>
          {resourceLabel(diff.resource)}
        </Text>
        <View style={styles.diffCounts}>
          <Text style={[styles.countText, { color: ADD_COLOR }]}>
            +{diff.addCount}
          </Text>
          <Text style={[styles.countText, { color: REMOVE_COLOR }]}>
            −{diff.removeCount}
          </Text>
        </View>
      </View>

      {/* Diff lines */}
      <View style={styles.diffBlock}>
        {diff.lines.map((line, i) => (
          <DiffLineRow key={i} line={line} />
        ))}
      </View>
    </View>
  );
}

// ── Diff screen ───────────────────────────────────────────────

export default function DiffScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { name, namespace } = useLocalSearchParams<{
    name: string;
    namespace: string;
  }>();
  const client = useArgoClient();
  const [compact, setCompact] = useState(true);

  const { data, isLoading, error } = useQuery({
    queryKey: client.queryKeys.managedResources(namespace, name),
    queryFn: () => client.getManagedResources(name, namespace),
  });

  const diffs = useMemo(
    () => (data ? buildResourceDiffs(data, compact) : []),
    [data, compact],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          testID="diff-back"
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={18} color={colors.orange} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Diff</Text>

        <TouchableOpacity
          onPress={() => setCompact((v) => !v)}
          style={styles.compactBtn}
        >
          <View style={[styles.compactCheck, compact && styles.compactCheckOn]}>
            {compact && <Ionicons name="checkmark" size={10} color="#fff" />}
          </View>
          <Text style={styles.compactLabel}>Compact</Text>
        </TouchableOpacity>
      </View>

      {/* Subtitle */}
      <View style={styles.subHeader}>
        <Text style={styles.subTitle} numberOfLines={1}>
          {name}
        </Text>
        {!isLoading && data && (
          <Text style={styles.subMeta}>
            {diffs.length} resource{diffs.length !== 1 ? "s" : ""} changed
          </Text>
        )}
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.orange} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons
            name="alert-circle-outline"
            size={32}
            color={colors.muted}
          />
          <Text style={styles.errorText}>
            {error instanceof Error ? error.message : "Failed to load diff"}
          </Text>
        </View>
      ) : diffs.length === 0 ? (
        <View style={styles.center}>
          <Ionicons
            name="checkmark-circle-outline"
            size={40}
            color={ADD_COLOR}
          />
          <Text style={styles.emptyText}>Everything is in sync</Text>
        </View>
      ) : (
        <FlatList
          data={diffs}
          keyExtractor={(item) =>
            `${item.resource.group}/${item.resource.kind}/${item.resource.namespace}/${item.resource.name}`
          }
          renderItem={({ item }) => <ResourceSection diff={item} />}
          ItemSeparatorComponent={() => <View style={styles.sectionSep} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        />
      )}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────

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
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minWidth: 70,
  },
  backText: {
    fontSize: 15,
    color: colors.orange,
    fontWeight: "500",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    letterSpacing: -0.2,
  },
  compactBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 70,
    justifyContent: "flex-end",
  },
  compactCheck: {
    width: 16,
    height: 16,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: colors.hairlineHi,
    alignItems: "center",
    justifyContent: "center",
  },
  compactCheckOn: {
    backgroundColor: colors.orange,
    borderColor: colors.orange,
  },
  compactLabel: {
    fontSize: 13,
    color: colors.muted,
    fontWeight: "500",
  },

  // Sub-header
  subHeader: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    gap: 2,
  },
  subTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.3,
  },
  subMeta: {
    fontSize: 12,
    color: colors.muted,
  },

  // States
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingBottom: 60,
  },
  errorText: {
    fontSize: 14,
    color: colors.muted,
    textAlign: "center",
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 15,
    color: colors.muted,
    fontWeight: "500",
  },

  // Resource section
  sectionSep: {
    height: 16,
  },
  resourceSection: {
    overflow: "hidden",
  },
  resourceHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.hairline,
    gap: 8,
  },
  resourceLabel: {
    flex: 1,
    fontSize: 12,
    fontFamily: MONO,
    color: colors.text,
    fontWeight: "500",
  },
  diffCounts: {
    flexDirection: "row",
    gap: 8,
  },
  countText: {
    fontSize: 12,
    fontFamily: MONO,
    fontWeight: "600",
  },

  // Diff block
  diffBlock: {
    backgroundColor: TERM_BG,
  },
  diffRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 20,
  },
  lineNo: {
    width: 32,
    fontSize: 10,
    fontFamily: MONO,
    color: "rgba(245,246,250,0.25)",
    textAlign: "right",
    paddingRight: 4,
    alignSelf: "stretch",
    paddingTop: 2,
    paddingBottom: 2,
  },
  opCol: {
    width: 14,
    fontSize: 12,
    fontFamily: MONO,
    textAlign: "center",
    paddingTop: 2,
    paddingBottom: 2,
  },
  diffContent: {
    flex: 1,
    fontSize: 11,
    fontFamily: MONO,
    color: "#d6dae0",
    paddingRight: 8,
    paddingTop: 2,
    paddingBottom: 2,
  },

  // Collapse
  collapseRow: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
    borderColor: "rgba(245,246,250,0.12)",
    backgroundColor: "rgba(255,255,255,0.02)",
    alignItems: "center",
  },
  collapseText: {
    fontSize: 11,
    fontFamily: MONO,
    color: "rgba(245,246,250,0.35)",
  },
});
