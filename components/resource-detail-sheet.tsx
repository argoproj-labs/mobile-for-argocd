import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as jsYaml from "js-yaml";
import * as jsonMergePatch from "json-merge-patch";
import { diffLines as computeDiff } from "diff";
import type { ComponentProps } from "react";

import { colors } from "../lib/theme";
import { getHealth, getSync } from "../lib/status";
import { useArgoClient } from "../lib/client";
import type {
  LogEntry,
  ManagedResource,
  ResourceAction,
  ResourceActionParam,
} from "../lib/api";

const { height: SCREEN_H } = Dimensions.get("window");
const MONO = Platform.OS === "ios" ? "Menlo" : "monospace";
const CONTEXT_LINES = 3;
const ADD_COLOR = "#4ec46b";
const REMOVE_COLOR = "#f2766c";
const ADD_BG = "rgba(78,196,107,0.10)";
const REMOVE_BG = "rgba(242,118,108,0.10)";

type IoniconName = ComponentProps<typeof Ionicons>["name"];
type TabId = "summary" | "live" | "desired" | "diff" | "logs";

const LOG_KINDS = new Set([
  "pod",
  "deployment",
  "statefulset",
  "daemonset",
  "replicaset",
  "job",
]);

// ── Public types ───────────────────────────────────────────────

export interface ResourceDetailRef {
  group?: string;
  version?: string;
  kind: string;
  namespace?: string;
  name: string;
  health?: { status: string; message?: string };
  syncStatus?: string;
  info?: { name: string; value: string }[];
  images?: string[];
  createdAt?: string;
  children?: { kind: string; name: string }[];
}

type DeleteStrategy = "foreground" | "background" | "orphan";

export interface ResourceDetailSheetProps {
  visible: boolean;
  onClose: () => void;
  appName: string;
  appNamespace: string;
  resource: ResourceDetailRef | null;
  onDeleted?: () => void;
}

// ── YAML tokenizer ─────────────────────────────────────────────

type TokType =
  | "key"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "comment"
  | "operator"
  | "plain";

interface Tok {
  type: TokType;
  text: string;
}

const TOK_COLOR: Record<TokType, string> = {
  key: "#7EC8E3",
  string: "#98C379",
  number: "#D19A66",
  boolean: "#C678DD",
  null: "#C678DD",
  comment: "#5C6370",
  operator: "rgba(245,246,250,0.42)",
  plain: "#ABB2BF",
};

function tokenizeValue(text: string): Tok[] {
  if (!text) return [];
  if (/^[|>][-+]?\s*$/.test(text) || /^[|>][-+]?\s*#/.test(text))
    return [{ type: "operator", text }];
  if (text.startsWith("&") || text.startsWith("*"))
    return [{ type: "operator", text }];

  if (text.startsWith('"')) {
    const m = text.match(/^("(?:[^"\\]|\\.)*")(.*)/s);
    if (m) return [{ type: "string", text: m[1] }, ...tokenizeValue(m[2])];
  }
  if (text.startsWith("'")) {
    const m = text.match(/^('(?:[^'\\]|\\.)*')(.*)/s);
    if (m) return [{ type: "string", text: m[1] }, ...tokenizeValue(m[2])];
  }

  const nullM = text.match(/^(null|~)(\s*)$/i);
  if (nullM)
    return [
      { type: "null", text: nullM[1] },
      { type: "plain", text: nullM[2] },
    ];

  const boolM = text.match(/^(true|false|yes|no)(\s*)$/i);
  if (boolM)
    return [
      { type: "boolean", text: boolM[1] },
      { type: "plain", text: boolM[2] },
    ];

  const numM = text.match(/^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(\s*)$/);
  if (numM)
    return [
      { type: "number", text: numM[1] },
      { type: "plain", text: numM[2] },
    ];

  const ci = text.indexOf(" #");
  if (ci > 0)
    return [
      ...tokenizeValue(text.slice(0, ci)),
      { type: "comment", text: text.slice(ci) },
    ];

  return [{ type: "plain", text }];
}

function tokenizeLine(line: string): Tok[] {
  if (!line.trim()) return [{ type: "plain", text: line || " " }];
  const out: Tok[] = [];
  let rest = line;

  const wsM = rest.match(/^(\s+)/);
  if (wsM) {
    out.push({ type: "plain", text: wsM[1] });
    rest = rest.slice(wsM[1].length);
  }

  if (rest.startsWith("---") || rest.startsWith("..."))
    return [...out, { type: "operator", text: rest }];
  if (rest.startsWith("#")) return [...out, { type: "comment", text: rest }];

  // list item marker
  const listM = rest.match(/^(-\s+)/);
  if (listM) {
    out.push({ type: "operator", text: listM[1] });
    rest = rest.slice(listM[1].length);
  }

  // key: value
  const keyM = rest.match(/^([a-zA-Z_$][a-zA-Z0-9_$.\-/]*)(\s*:\s*)/);
  if (keyM) {
    out.push({ type: "key", text: keyM[1] });
    out.push({ type: "operator", text: keyM[2] });
    rest = rest.slice(keyM[0].length);
  }

  out.push(...tokenizeValue(rest));
  return out;
}

// ── YAML render ────────────────────────────────────────────────

function HighlightedYaml({ yaml }: { yaml: string }) {
  const lines = useMemo(() => yaml.split("\n"), [yaml]);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.yamlScroll}
    >
      <View style={styles.yamlLines}>
        {lines.map((line, i) => (
          <Text key={i} numberOfLines={1} style={styles.yamlLine}>
            {tokenizeLine(line).map((tok, j) => (
              <Text key={j} style={{ color: TOK_COLOR[tok.type] }}>
                {tok.text}
              </Text>
            ))}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

// ── Diff helpers ───────────────────────────────────────────────

type DiffLineType = "add" | "remove" | "context" | "collapse";
interface DiffLine {
  type: DiffLineType;
  content: string;
  lineNoOld: number | null;
  lineNoNew: number | null;
  collapseCount?: number;
}

function buildDiffLines(oldY: string, newY: string): DiffLine[] {
  const changes = computeDiff(oldY, newY);
  const flat: { type: "add" | "remove" | "context"; content: string }[] = [];
  for (const ch of changes) {
    const type = ch.added ? "add" : ch.removed ? "remove" : "context";
    const lines = ch.value.split("\n");
    if (lines.at(-1) === "") lines.pop();
    for (const l of lines) flat.push({ type, content: l });
  }
  let lo = 1,
    ln = 1;
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

  const result: DiffLine[] = [];
  let i = 0;
  while (i < numbered.length) {
    if (numbered[i].type !== "context") {
      result.push(numbered[i++]);
      continue;
    }
    let j = i;
    while (j < numbered.length && numbered[j].type === "context") j++;
    const run = numbered.slice(i, j);
    const isFirst = result.length === 0;
    const isLast = j === numbered.length;
    if (isFirst && isLast) {
      // skip all
    } else if (isFirst) {
      if (run.length > CONTEXT_LINES)
        result.push({
          type: "collapse",
          content: "",
          lineNoOld: null,
          lineNoNew: null,
          collapseCount: run.length - CONTEXT_LINES,
        });
      result.push(...run.slice(-CONTEXT_LINES));
    } else if (isLast) {
      result.push(...run.slice(0, CONTEXT_LINES));
      if (run.length > CONTEXT_LINES)
        result.push({
          type: "collapse",
          content: "",
          lineNoOld: null,
          lineNoNew: null,
          collapseCount: run.length - CONTEXT_LINES,
        });
    } else if (run.length > CONTEXT_LINES * 2) {
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

function DiffLineRow({ line }: { line: DiffLine }) {
  if (line.type === "collapse")
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
  const isAdd = line.type === "add";
  const isRemove = line.type === "remove";
  const bg = isAdd ? ADD_BG : isRemove ? REMOVE_BG : "transparent";
  const opColor = isAdd ? ADD_COLOR : isRemove ? REMOVE_COLOR : colors.faint;
  return (
    <View style={[styles.diffRow, { backgroundColor: bg }]}>
      <Text style={styles.lineNo}>{line.lineNoOld ?? ""}</Text>
      <Text style={styles.lineNo}>{line.lineNoNew ?? ""}</Text>
      <Text style={[styles.opCol, { color: opColor }]}>
        {isAdd ? "+" : isRemove ? "−" : " "}
      </Text>
      <Text style={styles.diffContent}>{line.content}</Text>
    </View>
  );
}

// ── Small helpers ──────────────────────────────────────────────

function kindIcon(kind: string): IoniconName {
  switch (kind.toLowerCase()) {
    case "pod":
      return "ellipse-outline";
    case "service":
      return "git-branch-outline";
    case "deployment":
      return "layers-outline";
    case "replicaset":
      return "copy-outline";
    case "statefulset":
      return "server-outline";
    case "daemonset":
      return "git-network-outline";
    case "job":
      return "time-outline";
    case "cronjob":
      return "calendar-outline";
    case "configmap":
      return "document-outline";
    case "secret":
      return "key-outline";
    case "ingress":
      return "globe-outline";
    case "serviceaccount":
      return "person-outline";
    case "persistentvolumeclaim":
      return "save-outline";
    default:
      return "cube-outline";
  }
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

function objectToYaml(obj: object | null | undefined): string {
  if (!obj) return "";
  try {
    return jsYaml.dump(obj, { indent: 2, lineWidth: -1, noRefs: true });
  } catch {
    return JSON.stringify(obj, null, 2);
  }
}

function removeManagedFields(obj: object): object {
  const copy = JSON.parse(JSON.stringify(obj)) as {
    metadata?: { managedFields?: unknown };
  };
  if (copy.metadata?.managedFields !== undefined) {
    delete copy.metadata.managedFields;
  }
  return copy;
}

function timeAgo(iso?: string): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`;
}

// ── Log tab helpers ────────────────────────────────────────────

const LOG_ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;
const MAX_LOG_LINES = 5_000;

interface LogLine {
  id: number;
  content: string;
  ts: string;
}

function stripAnsiLog(s: string): string {
  return s.replace(LOG_ANSI_RE, "");
}

function extractContainersFromSpec(spec: unknown): string[] {
  const s = spec as {
    containers?: { name: string }[];
    initContainers?: { name: string }[];
    template?: {
      spec?: {
        containers?: { name: string }[];
        initContainers?: { name: string }[];
      };
    };
  };
  const ps = s?.template?.spec ?? s;
  return [...(ps?.containers ?? []), ...(ps?.initContainers ?? [])]
    .map((c) => (c as { name: string }).name)
    .filter(Boolean);
}

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
    <View style={logTabStyles.logRow}>
      {showTs && !!line.ts && (
        <Text style={logTabStyles.logTs} numberOfLines={1}>
          {line.ts}{" "}
        </Text>
      )}
      <Text
        style={logTabStyles.logContent}
        numberOfLines={wrap ? undefined : 1}
        selectable
      >
        {line.content}
      </Text>
    </View>
  );
});

function LogToggle({
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
      style={[logTabStyles.toggle, active && logTabStyles.toggleActive]}
    >
      <Text
        style={[
          logTabStyles.toggleText,
          active && logTabStyles.toggleTextActive,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function MetaRow({
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
    <View style={[styles.metaRow, !last && styles.metaRowBorder]}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text
        style={[styles.metaValue, mono && styles.metaMono]}
        numberOfLines={2}
      >
        {value || "—"}
      </Text>
    </View>
  );
}

function SummaryContent({ resource }: { resource: ResourceDetailRef }) {
  const gv = [resource.group, resource.version].filter(Boolean).join("/");
  return (
    <View style={styles.summaryWrap}>
      <Text style={styles.sectionHeader}>METADATA</Text>
      <View style={styles.card}>
        <MetaRow label="Kind" value={resource.kind} />
        {!!gv && <MetaRow label="Group/Ver" value={gv} mono />}
        <MetaRow label="Namespace" value={resource.namespace ?? "—"} mono />
        <MetaRow label="Created" value={timeAgo(resource.createdAt)} last />
      </View>

      {resource.info && resource.info.length > 0 && (
        <>
          <Text style={styles.sectionHeader}>INFO</Text>
          <View style={styles.card}>
            {resource.info.map((f, i) => (
              <MetaRow
                key={f.name}
                label={f.name}
                value={f.value}
                last={i === resource.info!.length - 1}
              />
            ))}
          </View>
        </>
      )}

      {!!resource.health?.message && (
        <>
          <Text style={styles.sectionHeader}>HEALTH MESSAGE</Text>
          <View style={styles.card}>
            <View style={styles.metaRow}>
              <Text style={[styles.metaValue, styles.messageText]}>
                {resource.health.message}
              </Text>
            </View>
          </View>
        </>
      )}

      {resource.images && resource.images.length > 0 && (
        <>
          <Text style={styles.sectionHeader}>IMAGES</Text>
          <View style={styles.card}>
            {resource.images.map((img, i) => (
              <View
                key={img}
                style={[
                  styles.metaRow,
                  i < resource.images!.length - 1 && styles.metaRowBorder,
                ]}
              >
                <Text
                  style={[styles.metaValue, styles.metaMono]}
                  numberOfLines={2}
                >
                  {img}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

function LiveContent({
  state,
  isLoading,
  error,
  appName,
  appNamespace,
  resource,
}: {
  state: object | undefined;
  isLoading: boolean;
  error: Error | null;
  appName: string;
  appNamespace: string;
  resource: ResourceDetailRef;
}) {
  const client = useArgoClient();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const [hideMgd, setHideMgd] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editYaml, setEditYaml] = useState("");
  const [editBase, setEditBase] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const yaml = useMemo(() => {
    if (!state) return "";
    return objectToYaml(hideMgd ? removeManagedFields(state) : state);
  }, [state, hideMgd]);

  const startEdit = () => {
    const base = (hideMgd ? removeManagedFields(state!) : state!) as Record<
      string,
      unknown
    >;
    setEditBase(base);
    setEditYaml(objectToYaml(base));
    setSaveError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setSaveError(null);
  };

  const saveEdit = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      let updated: Record<string, unknown>;
      try {
        updated = jsYaml.load(editYaml) as Record<string, unknown>;
      } catch (e) {
        throw new Error(
          `Invalid YAML: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      const patch = jsonMergePatch.generate(editBase, updated) ?? {};
      await client.patchResource(
        appName,
        appNamespace,
        resource.group,
        resource.version,
        resource.kind,
        resource.namespace,
        resource.name,
        JSON.stringify(patch),
      );
      await queryClient.invalidateQueries({
        queryKey: client.queryKeys.resource(
          appNamespace,
          appName,
          resource.group,
          resource.version,
          resource.kind,
          resource.namespace,
          resource.name,
        ),
      });
      setEditing(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <StateBlock loading />;
  if (error) return <StateBlock message={error.message} />;
  if (!state) return <StateBlock message="No live state available" />;

  return (
    <View style={styles.liveRoot}>
      {/* Sticky toolbar */}
      <View style={styles.liveToolbar}>
        {!editing && (
          <TouchableOpacity
            onPress={() => setHideMgd((v) => !v)}
            activeOpacity={0.75}
            style={styles.mgdToggle}
          >
            <View style={[styles.check, hideMgd && styles.checkOn]}>
              {hideMgd && <Ionicons name="checkmark" size={10} color="#fff" />}
            </View>
            <Text style={styles.toggleLabel}>Hide managed fields</Text>
          </TouchableOpacity>
        )}
        {editing ? (
          <View style={styles.editBtnGroup}>
            <TouchableOpacity
              onPress={cancelEdit}
              disabled={saving}
              activeOpacity={0.7}
              style={styles.editCancelBtn}
            >
              <Text style={styles.editCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void saveEdit()}
              disabled={saving}
              activeOpacity={0.7}
              style={styles.editSaveBtn}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.editSaveText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onPress={startEdit}
            activeOpacity={0.7}
            style={styles.editBtnInline}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="pencil-outline" size={13} color={colors.orange} />
            <Text style={styles.editBtnInlineText}>Edit</Text>
          </TouchableOpacity>
        )}
      </View>

      {!!saveError && (
        <View style={styles.saveErrorRow}>
          <Text style={styles.saveErrorText}>{saveError}</Text>
        </View>
      )}

      {/* Scrollable content */}
      <ScrollView
        style={styles.liveScroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {editing ? (
          <TextInput
            multiline
            value={editYaml}
            onChangeText={setEditYaml}
            style={styles.yamlEditInput}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            textAlignVertical="top"
            scrollEnabled={false}
          />
        ) : (
          <HighlightedYaml yaml={yaml} />
        )}
      </ScrollView>
    </View>
  );
}

function DiffContent({ managed }: { managed: ManagedResource }) {
  const lines = useMemo(() => {
    const oldY = stateToYaml(managed.normalizedLiveState);
    const newY = stateToYaml(managed.predictedLiveState);
    return buildDiffLines(oldY, newY);
  }, [managed.normalizedLiveState, managed.predictedLiveState]);

  const adds = lines.filter((l) => l.type === "add").length;
  const removes = lines.filter((l) => l.type === "remove").length;
  return (
    <View>
      <View style={styles.diffStat}>
        <Text style={[styles.diffCount, { color: ADD_COLOR }]}>+{adds}</Text>
        <Text style={[styles.diffCount, { color: REMOVE_COLOR }]}>
          −{removes}
        </Text>
      </View>
      <View style={styles.diffBlock}>
        {lines.map((line, i) => (
          <DiffLineRow key={i} line={line} />
        ))}
      </View>
    </View>
  );
}

function StateBlock({
  loading,
  message,
}: {
  loading?: boolean;
  message?: string;
}) {
  return (
    <View style={styles.stateBlock}>
      {loading ? (
        <ActivityIndicator color={colors.orange} />
      ) : (
        <>
          <Ionicons
            name="alert-circle-outline"
            size={24}
            color={colors.muted}
          />
          <Text style={styles.stateText}>{message}</Text>
        </>
      )}
    </View>
  );
}

// ── Logs tab (inline viewer) ──────────────────────────────────

function LogsTabContent({
  resource,
  appName,
  appNamespace,
}: {
  resource: ResourceDetailRef;
  appName: string;
  appNamespace: string;
}) {
  const client = useArgoClient();
  const isPod = resource.kind.toLowerCase() === "pod";

  const [follow, setFollow] = useState(true);
  const [showTs, setShowTs] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [previous, setPrevious] = useState(false);
  const [container, setContainer] = useState("");
  const [containers, setContainers] = useState<string[]>([]);
  const [filterText, setFilterText] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const lineIdRef = useRef(0);
  const bufferRef = useRef<LogLine[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);
  const flatListRef = useRef<FlatList<LogLine>>(null);
  const autoScrollRef = useRef(true);

  const { data: liveObj } = useQuery({
    queryKey: client.queryKeys.resource(
      appNamespace,
      appName,
      resource.group,
      resource.version,
      resource.kind,
      resource.namespace,
      resource.name,
    ),
    queryFn: () =>
      client.getResource(
        appName,
        appNamespace,
        resource.group,
        resource.version,
        resource.kind,
        resource.namespace,
        resource.name,
      ),
  });

  useEffect(() => {
    if (!liveObj) return;
    const spec = (liveObj as { spec?: unknown })?.spec;
    if (!spec) return;
    const cs = extractContainersFromSpec(spec);
    setContainers(cs);
    setContainer((prev) => prev || cs[0] || "");
  }, [liveObj]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (bufferRef.current.length === 0) return;
      const batch = bufferRef.current.splice(0);
      setLines((prev) => {
        const next = [...prev, ...batch];
        return next.length > MAX_LOG_LINES
          ? next.slice(next.length - MAX_LOG_LINES)
          : next;
      });
    }, 100);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (autoScrollRef.current) {
      flatListRef.current?.scrollToEnd({ animated: false });
    }
  }, [lines]);

  const startStream = useCallback(() => {
    if (!container) return;
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
      resource.namespace ?? "",
      isPod ? resource.name : undefined,
      !isPod ? resource.group : undefined,
      !isPod ? resource.kind : undefined,
      !isPod ? resource.name : undefined,
      container,
      1000,
      follow,
      previous,
      (entry: LogEntry) => {
        bufferRef.current.push({
          id: lineIdRef.current++,
          content: stripAnsiLog(entry.content ?? ""),
          ts: entry.timeStampStr ?? "",
        });
      },
      (err: Error) => {
        setStreaming(false);
        setError(err.message);
      },
      () => setStreaming(false),
    );
    cleanupRef.current = cleanup;
  }, [
    appName,
    appNamespace,
    resource,
    container,
    follow,
    previous,
    isPod,
    client,
  ]);

  useEffect(() => {
    if (!container) return;
    startStream();
    return () => {
      cleanupRef.current?.();
    };
  }, [container, follow, previous]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScroll = useCallback(
    (e: {
      nativeEvent: {
        contentOffset: { y: number };
        contentSize: { height: number };
        layoutMeasurement: { height: number };
      };
    }) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const dist =
        contentSize.height - layoutMeasurement.height - contentOffset.y;
      autoScrollRef.current = dist < 80;
      setShowScrollBtn(dist >= 80 && streaming);
    },
    [streaming],
  );

  const scrollToBottom = useCallback(() => {
    autoScrollRef.current = true;
    setShowScrollBtn(false);
    flatListRef.current?.scrollToEnd({ animated: true });
  }, []);

  const filteredLines = useMemo(() => {
    if (!filterText) return lines;
    const lower = filterText.toLowerCase();
    return lines.filter((l) => l.content.toLowerCase().includes(lower));
  }, [lines, filterText]);

  return (
    <View style={logTabStyles.root}>
      {containers.length > 1 && (
        <View style={logTabStyles.containerBar}>
          {containers.map((c) => (
            <TouchableOpacity
              key={c}
              onPress={() => setContainer(c)}
              style={[
                logTabStyles.pill,
                c === container && logTabStyles.pillActive,
              ]}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  logTabStyles.pillText,
                  c === container && logTabStyles.pillTextActive,
                ]}
              >
                {c}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={logTabStyles.controls}>
        <LogToggle
          label="Follow"
          active={follow}
          onPress={() => setFollow((v) => !v)}
        />
        <LogToggle
          label="TS"
          active={showTs}
          onPress={() => setShowTs((v) => !v)}
        />
        <LogToggle
          label="Wrap"
          active={wrap}
          onPress={() => setWrap((v) => !v)}
        />
        <LogToggle
          label="Prev"
          active={previous}
          onPress={() => setPrevious((v) => !v)}
        />
        <TouchableOpacity
          onPress={startStream}
          style={logTabStyles.iconBtn}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Ionicons name="reload" size={14} color={colors.muted} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setShowFilter((v) => !v)}
          style={logTabStyles.iconBtn}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Ionicons
            name={showFilter ? "search" : "search-outline"}
            size={14}
            color={showFilter ? colors.orange : colors.muted}
          />
        </TouchableOpacity>
      </View>

      {showFilter && (
        <View style={logTabStyles.filterRow}>
          <Ionicons name="search" size={13} color={colors.muted} />
          <TextInput
            style={logTabStyles.filterInput}
            value={filterText}
            onChangeText={setFilterText}
            placeholder="Filter…"
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

      <View style={logTabStyles.logArea}>
        {error ? (
          <View style={logTabStyles.centerState}>
            <Ionicons
              name="alert-circle-outline"
              size={24}
              color={colors.muted}
            />
            <Text style={logTabStyles.stateText}>{error}</Text>
            <TouchableOpacity
              onPress={startStream}
              style={logTabStyles.retryBtn}
            >
              <Text style={logTabStyles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : lines.length === 0 && !streaming ? (
          <View style={logTabStyles.centerState}>
            <Text style={logTabStyles.stateText}>No logs</Text>
          </View>
        ) : lines.length === 0 ? (
          <View style={logTabStyles.centerState}>
            <ActivityIndicator color={colors.orange} />
            <Text style={logTabStyles.stateText}>Waiting for logs…</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={filteredLines}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => (
              <LogLineRow line={item} showTs={showTs} wrap={wrap} />
            )}
            style={logTabStyles.flatList}
            showsVerticalScrollIndicator={false}
            onScroll={handleScroll}
            scrollEventThrottle={100}
            removeClippedSubviews
            maxToRenderPerBatch={40}
            windowSize={8}
          />
        )}
        {showScrollBtn && (
          <TouchableOpacity
            onPress={scrollToBottom}
            style={logTabStyles.scrollFab}
            activeOpacity={0.8}
          >
            <Ionicons name="arrow-down" size={16} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      <View style={logTabStyles.statusBar}>
        <View style={logTabStyles.statusLeft}>
          {streaming ? (
            <>
              <View style={logTabStyles.liveDot} />
              <Text style={logTabStyles.statusText}>Live</Text>
            </>
          ) : error ? (
            <Text style={[logTabStyles.statusText, { color: colors.danger }]}>
              Error
            </Text>
          ) : (
            <Text style={logTabStyles.statusText}>Done</Text>
          )}
        </View>
        <Text style={logTabStyles.lineCount}>
          {filteredLines.length !== lines.length
            ? `${filteredLines.length} / ${lines.length} lines`
            : `${lines.length} lines`}
        </Text>
        {!!container && (
          <Text style={logTabStyles.containerLabel}>{container}</Text>
        )}
      </View>
    </View>
  );
}

// ── Delete modal ───────────────────────────────────────────────

const STRATEGIES: { id: DeleteStrategy; label: string; sub: string }[] = [
  {
    id: "foreground",
    label: "Foreground",
    sub: "Delete after dependents are removed",
  },
  {
    id: "background",
    label: "Background",
    sub: "Delete immediately; garbage-collect dependents",
  },
  {
    id: "orphan",
    label: "Orphan",
    sub: "Delete resource; leave dependents intact",
  },
];

function DeleteModal({
  visible,
  resource,
  isManaged,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  resource: ResourceDetailRef;
  isManaged: boolean;
  onCancel: () => void;
  onConfirm: (force: boolean, orphan: boolean) => void;
}) {
  const [strategy, setStrategy] = useState<DeleteStrategy>("foreground");
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      setStrategy("foreground");
      setConfirmText("");
      setLoading(false);
    }
  }, [visible]);

  const isValid = !isManaged || confirmText === resource.name;
  const children = resource.children ?? [];
  const SHOW_MAX = 4;

  async function handleDelete() {
    setLoading(true);
    try {
      await onConfirm(strategy === "background", strategy === "orphan");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <View style={deleteStyles.overlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          onPress={onCancel}
          activeOpacity={1}
        />
        <View style={deleteStyles.dialog}>
          {/* Header */}
          <View style={deleteStyles.dialogHeader}>
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
            <Text style={deleteStyles.dialogTitle} numberOfLines={1}>
              Delete {resource.kind} — {resource.name}
            </Text>
          </View>

          <ScrollView
            style={deleteStyles.dialogBody}
            showsVerticalScrollIndicator={false}
          >
            {/* Warning */}
            <Text style={deleteStyles.warningText}>
              Deleting resources can be{" "}
              <Text style={{ color: colors.danger, fontWeight: "700" }}>
                dangerous
              </Text>
              . Be sure you understand the effects before continuing.
            </Text>

            {/* Dependent resources */}
            {children.length > 0 && (
              <View style={deleteStyles.childrenBlock}>
                <Text style={deleteStyles.childrenLabel}>
                  DEPENDENT RESOURCES
                </Text>
                {children.slice(0, SHOW_MAX).map((c, i) => (
                  <View key={i} style={deleteStyles.childRow}>
                    <Text style={deleteStyles.childText}>
                      {c.kind}/{c.name}
                    </Text>
                  </View>
                ))}
                {children.length > SHOW_MAX && (
                  <Text style={deleteStyles.moreText}>
                    and {children.length - SHOW_MAX} more
                  </Text>
                )}
              </View>
            )}

            {/* Strategy */}
            <Text style={deleteStyles.sectionLabel}>DELETION STRATEGY</Text>
            <View style={deleteStyles.strategyBlock}>
              {STRATEGIES.map((s, i) => (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => setStrategy(s.id)}
                  activeOpacity={0.7}
                  style={[
                    deleteStyles.strategyRow,
                    i < STRATEGIES.length - 1 && deleteStyles.strategyBorder,
                  ]}
                >
                  <View
                    style={[
                      deleteStyles.radio,
                      strategy === s.id && deleteStyles.radioActive,
                    ]}
                  >
                    {strategy === s.id && (
                      <View style={deleteStyles.radioDot} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={deleteStyles.strategyLabel}>{s.label}</Text>
                    <Text style={deleteStyles.strategySub}>{s.sub}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            {/* Confirmation input */}
            {isManaged && (
              <View style={deleteStyles.confirmBlock}>
                <Text style={deleteStyles.sectionLabel}>
                  TYPE{" "}
                  <Text style={deleteStyles.confirmName}>{resource.name}</Text>{" "}
                  TO CONFIRM
                </Text>
                <TextInput
                  style={deleteStyles.confirmInput}
                  value={confirmText}
                  onChangeText={setConfirmText}
                  placeholder={resource.name}
                  placeholderTextColor={colors.faint}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={deleteStyles.dialogFooter}>
            <TouchableOpacity
              onPress={onCancel}
              activeOpacity={0.7}
              style={deleteStyles.cancelBtn}
            >
              <Text style={deleteStyles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void handleDelete()}
              disabled={!isValid || loading}
              activeOpacity={0.8}
              style={[
                deleteStyles.deleteBtn,
                (!isValid || loading) && deleteStyles.deleteBtnDisabled,
              ]}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={deleteStyles.deleteText}>Delete</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── ActionModal ───────────────────────────────────────────────

function ActionModal({
  visible,
  action,
  resource,
  appName,
  appNamespace,
  onCancel,
  onDone,
}: {
  visible: boolean;
  action: ResourceAction | null;
  resource: ResourceDetailRef;
  appName: string;
  appNamespace: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const client = useArgoClient();
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const defaults: Record<string, string> = {};
    for (const p of action?.params ?? []) {
      defaults[p.name] = p.default ?? "";
    }
    setParamValues(defaults);
    setError(null);
    setLoading(false);
  }, [visible, action]);

  const handleRun = async () => {
    if (!action) return;
    setLoading(true);
    setError(null);
    try {
      const params: ResourceActionParam[] = (action.params ?? []).map((p) => ({
        name: p.name,
        value: paramValues[p.name] ?? p.default ?? "",
        type: p.type,
        default: p.default,
      }));
      await client.runResourceAction(
        appName,
        appNamespace,
        resource.group,
        resource.version,
        resource.kind,
        resource.namespace,
        resource.name,
        action.name,
        params,
      );
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  };

  if (!action) return null;

  const hasParams = (action.params ?? []).length > 0;
  const displayName = action.displayName || action.name;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={actionStyles.overlay}>
        <View style={actionStyles.modal}>
          <Text style={actionStyles.title}>{displayName}</Text>

          {!hasParams && (
            <Text style={actionStyles.message}>
              Run <Text style={actionStyles.messageBold}>{displayName}</Text> on
              this resource?
            </Text>
          )}

          {hasParams &&
            (action.params ?? []).map((p) => (
              <View key={p.name} style={actionStyles.paramRow}>
                <Text style={actionStyles.paramLabel}>{p.name}</Text>
                <TextInput
                  style={actionStyles.paramInput}
                  value={paramValues[p.name] ?? ""}
                  onChangeText={(v) =>
                    setParamValues((prev) => ({ ...prev, [p.name]: v }))
                  }
                  placeholder={p.default ?? ""}
                  placeholderTextColor={colors.faint}
                />
              </View>
            ))}

          {!!error && <Text style={actionStyles.error}>{error}</Text>}

          <View style={actionStyles.buttons}>
            <TouchableOpacity
              onPress={onCancel}
              disabled={loading}
              style={actionStyles.cancelBtn}
            >
              <Text style={actionStyles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void handleRun()}
              disabled={loading}
              style={actionStyles.runBtn}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={actionStyles.runText}>Run</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const actionStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modal: {
    width: "100%",
    backgroundColor: "#1C2140",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: 20,
    gap: 14,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.2,
  },
  message: {
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
  },
  messageBold: {
    fontWeight: "600",
    color: colors.text,
  },
  paramRow: {
    gap: 6,
  },
  paramLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.muted,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  paramInput: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: colors.text,
    fontFamily: MONO,
  },
  error: {
    fontSize: 12,
    color: colors.danger,
    lineHeight: 17,
  },
  buttons: {
    flexDirection: "row",
    gap: 10,
    marginTop: 2,
  },
  cancelBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.muted,
  },
  runBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.orange,
    alignItems: "center",
    justifyContent: "center",
  },
  runText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
});

// ── ResourceDetailContent ──────────────────────────────────────

export interface ResourceDetailContentProps {
  resource: ResourceDetailRef;
  appName: string;
  appNamespace: string;
  onClose: () => void;
  onDeleted?: () => void;
}

export function ResourceDetailContent({
  resource,
  appName,
  appNamespace,
  onClose,
  onDeleted,
}: ResourceDetailContentProps) {
  const insets = useSafeAreaInsets();
  const client = useArgoClient();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>("summary");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ResourceAction | null>(
    null,
  );

  const resourceKey = `${resource.group}/${resource.kind}/${resource.namespace}/${resource.name}`;
  useEffect(() => {
    setActiveTab("summary");
  }, [resourceKey]);

  const enabled = true;

  const {
    data: liveState,
    isLoading: liveLoading,
    error: liveError,
  } = useQuery({
    queryKey: client.queryKeys.resource(
      appNamespace,
      appName,
      resource.group,
      resource.version,
      resource.kind,
      resource.namespace,
      resource.name,
    ),
    queryFn: () =>
      client.getResource(
        appName,
        appNamespace,
        resource.group,
        resource.version,
        resource.kind,
        resource.namespace,
        resource.name,
      ),
    enabled,
  });

  const { data: appData } = useQuery({
    queryKey: client.queryKeys.application(appNamespace, appName),
    queryFn: () => client.getApplication(appName, appNamespace),
    enabled: false,
  });

  const liveResourceVersion = (
    liveState as { metadata?: { resourceVersion?: string } } | undefined
  )?.metadata?.resourceVersion;

  const actionsEnabled = enabled && liveResourceVersion !== undefined;
  const { data: actions, isPending: actionsPending } = useQuery({
    queryKey: [
      ...client.queryKeys.resourceActions(
        appNamespace,
        appName,
        resource.group,
        resource.version,
        resource.kind,
        resource.namespace,
        resource.name,
      ),
      liveResourceVersion,
    ],
    queryFn: () =>
      client.getResourceActions(
        appName,
        appNamespace,
        resource.group,
        resource.version,
        resource.kind,
        resource.namespace,
        resource.name,
      ),
    enabled: actionsEnabled,
    placeholderData: keepPreviousData,
  });

  // Read live node from tree cache (kept current by watchResourceTree stream)
  const { data: treeData } = useQuery({
    queryKey: client.queryKeys.resourceTree(appNamespace, appName),
    queryFn: () => client.getResourceTree(appName, appNamespace),
    enabled: false,
  });

  const liveTreeNode = useMemo(
    () =>
      treeData?.nodes?.find(
        (n) =>
          n.kind === resource.kind &&
          n.name === resource.name &&
          (n.namespace ?? "") === (resource.namespace ?? "") &&
          (n.group ?? "") === (resource.group ?? ""),
      ),
    [treeData, resource],
  );

  const liveHealth = liveTreeNode?.health ?? resource.health;
  const treeNodeRv = liveTreeNode?.resourceVersion;

  // Read live sync status from app cache (kept current by watchApplication stream)
  const liveSyncStatus = useMemo(() => {
    const r = appData?.status?.resources?.find(
      (r) =>
        r.kind === resource.kind &&
        r.name === resource.name &&
        (r.namespace ?? "") === (resource.namespace ?? "") &&
        (r.group ?? "") === (resource.group ?? ""),
    );
    return r?.status ?? resource.syncStatus;
  }, [appData, resource]);

  const { data: managed } = useQuery({
    queryKey: [
      ...client.queryKeys.managedResource(
        appNamespace,
        appName,
        resource.group,
        resource.kind,
        resource.namespace,
        resource.name,
      ),
      treeNodeRv,
    ],
    queryFn: () =>
      client.getManagedResource(
        appName,
        appNamespace,
        resource.group,
        resource.kind,
        resource.namespace,
        resource.name,
      ),
    enabled,
  });

  const health = getHealth(liveHealth?.status ?? "Unknown");
  const sync = liveSyncStatus ? getSync(liveSyncStatus) : null;
  const hasDesired = !!managed?.targetState;
  const hasDiff =
    !!managed?.normalizedLiveState &&
    !!managed?.predictedLiveState &&
    managed.normalizedLiveState !== managed.predictedLiveState;
  const hasLogs = LOG_KINDS.has(resource.kind.toLowerCase());

  const tabs: { id: TabId; label: string }[] = [
    { id: "summary", label: "SUMMARY" },
    { id: "live", label: "LIVE" },
    ...(hasDesired ? [{ id: "desired" as TabId, label: "DESIRED" }] : []),
    ...(hasDesired ? [{ id: "diff" as TabId, label: "DIFF" }] : []),
    ...(hasLogs ? [{ id: "logs" as TabId, label: "LOGS" }] : []),
  ];

  const kindGk = [resource.group, resource.kind].filter(Boolean).join("/");

  return (
    <View style={styles.overlay}>
      <TouchableOpacity
        style={StyleSheet.absoluteFillObject}
        onPress={onClose}
        activeOpacity={1}
      />
      <View style={[styles.sheet, { height: SCREEN_H * 0.88 }]}>
        {/* Handle */}
        <View style={styles.handleBar} />

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={styles.kindRow}>
              <Ionicons
                name={kindIcon(resource.kind)}
                size={14}
                color={colors.muted}
              />
              <Text style={styles.headerKind} numberOfLines={1}>
                {kindGk}
              </Text>
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity
                onPress={() => setShowDeleteModal(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.trashBtn}
              >
                <Ionicons
                  name="trash-outline"
                  size={16}
                  color={colors.danger}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={{ top: 8, bottom: 8, left: 12, right: 8 }}
              >
                <Text style={styles.doneBtn}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.headerName} numberOfLines={1}>
            {resource.name}
          </Text>

          {!!resource.namespace && (
            <Text style={styles.headerNs} numberOfLines={1}>
              {resource.namespace}
            </Text>
          )}

          <View style={styles.pillRow}>
            <View
              style={[
                styles.pill,
                { backgroundColor: health.bg, borderColor: health.border },
              ]}
            >
              <Ionicons name={health.icon} size={11} color={health.color} />
              <Text style={[styles.pillText, { color: health.color }]}>
                {liveHealth?.status ?? "Unknown"}
              </Text>
            </View>
            {sync && (
              <View
                style={[
                  styles.pill,
                  { backgroundColor: sync.bg, borderColor: sync.border },
                ]}
              >
                <Ionicons name={sync.icon} size={11} color={sync.color} />
                <Text style={[styles.pillText, { color: sync.color }]}>
                  {liveSyncStatus}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Action chips */}
        {liveLoading ||
        (actionsEnabled && actionsPending) ||
        !!actions?.length ? (
          liveLoading || (actionsEnabled && actionsPending) ? (
            <View style={styles.actionChipsBar}>
              <View style={styles.actionChipsInner}>
                <ActivityIndicator size="small" color={colors.muted} />
              </View>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.actionChipsBar}
              contentContainerStyle={styles.actionChipsInner}
            >
              {actions!.map((action) => (
                <TouchableOpacity
                  key={action.name}
                  disabled={!!action.disabled}
                  onPress={() => setConfirmAction(action)}
                  style={[
                    styles.actionChip,
                    !!action.disabled && styles.actionChipDisabled,
                  ]}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="play-circle-outline"
                    size={13}
                    color={action.disabled ? colors.faint : colors.orange}
                  />
                  <Text
                    style={[
                      styles.actionChipText,
                      !!action.disabled && styles.actionChipTextDisabled,
                    ]}
                  >
                    {action.displayName || action.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )
        ) : null}

        {/* Tab bar */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabBar}
          contentContainerStyle={styles.tabBarInner}
        >
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              style={[styles.tab, activeTab === tab.id && styles.tabActive]}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === tab.id && styles.tabTextActive,
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Content */}
        {activeTab === "logs" ? (
          <LogsTabContent
            resource={resource}
            appName={appName}
            appNamespace={appNamespace}
          />
        ) : activeTab === "live" ? (
          <LiveContent
            state={liveState}
            isLoading={liveLoading}
            error={liveError instanceof Error ? liveError : null}
            appName={appName}
            appNamespace={appNamespace}
            resource={resource}
          />
        ) : (
          <ScrollView
            style={styles.contentScroll}
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            showsVerticalScrollIndicator={false}
          >
            {activeTab === "summary" && <SummaryContent resource={resource} />}

            {activeTab === "desired" &&
              (hasDesired ? (
                <HighlightedYaml yaml={stateToYaml(managed!.targetState)} />
              ) : (
                <StateBlock message="Not managed by ArgoCD" />
              ))}

            {activeTab === "diff" &&
              (hasDiff ? (
                <DiffContent managed={managed!} />
              ) : (
                <StateBlock message="Resource is in sync — no differences" />
              ))}
          </ScrollView>
        )}

        <ActionModal
          visible={confirmAction !== null}
          action={confirmAction}
          resource={resource}
          appName={appName}
          appNamespace={appNamespace}
          onCancel={() => setConfirmAction(null)}
          onDone={() => {
            setConfirmAction(null);
            void queryClient.invalidateQueries({
              queryKey: client.queryKeys.resource(
                appNamespace,
                appName,
                resource.group,
                resource.version,
                resource.kind,
                resource.namespace,
                resource.name,
              ),
            });
          }}
        />

        <DeleteModal
          visible={showDeleteModal}
          resource={resource}
          isManaged={!!managed}
          onCancel={() => setShowDeleteModal(false)}
          onConfirm={async (force, orphan) => {
            await client.deleteResource(
              appName,
              appNamespace,
              resource.group,
              resource.version,
              resource.kind,
              resource.namespace,
              resource.name,
              force,
              orphan,
            );
            setShowDeleteModal(false);
            void queryClient.invalidateQueries({
              queryKey: client.queryKeys.application(appNamespace, appName),
            });
            onClose();
            onDeleted?.();
          }}
        />
      </View>
    </View>
  );
}

// ── ResourceDetailSheet (modal wrapper) ───────────────────────

export function ResourceDetailSheet({
  visible,
  onClose,
  appName,
  appNamespace,
  resource,
  onDeleted,
}: ResourceDetailSheetProps) {
  if (!resource) return null;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <ResourceDetailContent
        resource={resource}
        appName={appName}
        appNamespace={appNamespace}
        onClose={onClose}
        onDeleted={onDeleted}
      />
    </Modal>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    backgroundColor: "#171B33",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.hairline,
  },
  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.hairlineHi,
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 4,
  },

  // Header
  header: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  trashBtn: {
    padding: 2,
  },
  kindRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flex: 1,
  },
  headerKind: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: MONO,
    flex: 1,
  },
  doneBtn: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.orange,
  },
  headerName: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.3,
    marginTop: 2,
    marginBottom: 2,
  },
  headerNs: {
    fontSize: 12,
    color: colors.faint,
    fontFamily: MONO,
    marginBottom: 8,
  },
  pillRow: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.1,
  },

  // Action chips
  actionChipsBar: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  actionChipsInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 8,
    minHeight: 44,
  },
  actionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(239,123,77,0.4)",
    backgroundColor: "rgba(239,123,77,0.08)",
  },
  actionChipDisabled: {
    borderColor: colors.hairline,
    backgroundColor: "transparent",
  },
  actionChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.orange,
  },
  actionChipTextDisabled: {
    color: colors.faint,
  },

  // Tab bar
  tabBar: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    flexGrow: 0,
  },
  tabBarInner: {
    flexDirection: "row",
    paddingHorizontal: 16,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: {
    borderBottomColor: colors.orange,
  },
  tabText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: colors.faint,
  },
  tabTextActive: {
    color: colors.orange,
  },

  // Content
  contentScroll: {
    flex: 1,
    backgroundColor: "#1C2140",
  },

  // Summary
  summaryWrap: {
    padding: 14,
    gap: 6,
  },
  sectionHeader: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: colors.faint,
    textTransform: "uppercase",
    paddingLeft: 4,
    marginTop: 4,
    marginBottom: 2,
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: "hidden",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 9,
    gap: 8,
  },
  metaRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  metaLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.muted,
    width: 70,
    flexShrink: 0,
    paddingTop: 1,
  },
  metaValue: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
  },
  metaMono: {
    fontFamily: MONO,
    fontSize: 12,
  },
  messageText: {
    fontSize: 12,
    color: colors.muted,
  },

  // YAML
  yamlScroll: {
    backgroundColor: "#0d1119",
  },
  yamlLines: {
    padding: 14,
  },
  yamlLine: {
    fontFamily: MONO,
    fontSize: 12,
    lineHeight: 18,
  },

  // Live tab
  liveRoot: {
    flex: 1,
    backgroundColor: "#1C2140",
  },
  liveScroll: {
    flex: 1,
  },

  // Live tab toolbar
  liveToolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  mgdToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  editBtnInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  editBtnInlineText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.orange,
  },
  editBtnGroup: {
    flexDirection: "row",
    gap: 8,
    flex: 1,
    justifyContent: "flex-end",
  },
  editCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  editCancelText: {
    fontSize: 12,
    fontWeight: "500",
    color: colors.muted,
  },
  editSaveBtn: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 7,
    backgroundColor: colors.orange,
    minWidth: 60,
    alignItems: "center",
  },
  editSaveText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#fff",
  },
  saveErrorRow: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "rgba(255,107,107,0.10)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,107,107,0.25)",
  },
  saveErrorText: {
    fontSize: 12,
    color: colors.danger,
    lineHeight: 17,
  },
  yamlEditInput: {
    backgroundColor: "#0d1119",
    padding: 14,
    fontFamily: MONO,
    fontSize: 12,
    lineHeight: 18,
    color: "#ABB2BF",
    minHeight: 300,
  },

  // Managed fields toggle (kept for reference, replaced by liveToolbar)
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  check: {
    width: 16,
    height: 16,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: colors.hairlineHi,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: {
    backgroundColor: colors.orange,
    borderColor: colors.orange,
  },
  toggleLabel: {
    fontSize: 12,
    color: colors.muted,
    fontWeight: "500",
  },

  // Diff
  diffStat: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  diffCount: {
    fontSize: 13,
    fontFamily: MONO,
    fontWeight: "600",
  },
  diffBlock: {
    backgroundColor: "#0d1119",
  },
  diffRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 20,
  },
  lineNo: {
    width: 28,
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

  // State blocks
  stateBlock: {
    padding: 40,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  stateText: {
    fontSize: 13,
    color: colors.muted,
    textAlign: "center",
  },
});

// ── Log tab styles ─────────────────────────────────────────────

const logTabStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0d1119",
  },
  containerBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: "#171B33",
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  pillActive: {
    backgroundColor: "rgba(239,123,77,0.18)",
    borderColor: colors.orange,
  },
  pillText: {
    fontSize: 11,
    fontFamily: MONO,
    color: colors.muted,
  },
  pillTextActive: {
    color: colors.orange,
    fontWeight: "600",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: "#171B33",
  },
  toggle: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 7,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  toggleActive: {
    backgroundColor: "rgba(239,123,77,0.15)",
    borderColor: colors.orange,
  },
  toggleText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.muted,
  },
  toggleTextActive: {
    color: colors.orange,
  },
  iconBtn: {
    padding: 5,
    marginLeft: "auto" as unknown as number,
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  filterInput: {
    flex: 1,
    fontSize: 12,
    color: colors.text,
    fontFamily: MONO,
    paddingVertical: 0,
  },
  logArea: {
    flex: 1,
    position: "relative",
  },
  flatList: {
    flex: 1,
  },
  logRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 1,
  },
  logTs: {
    fontSize: 10,
    fontFamily: MONO,
    color: "rgba(245,246,250,0.35)",
    flexShrink: 0,
  },
  logContent: {
    flex: 1,
    fontSize: 11,
    fontFamily: MONO,
    color: "#d6dae0",
    lineHeight: 17,
  },
  scrollFab: {
    position: "absolute",
    right: 14,
    bottom: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.orange,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
  },
  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    backgroundColor: "#171B33",
    gap: 8,
  },
  statusLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.success,
  },
  statusText: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: "600",
  },
  lineCount: {
    flex: 1,
    fontSize: 11,
    color: colors.faint,
    textAlign: "center",
  },
  containerLabel: {
    fontSize: 10,
    color: colors.faint,
    fontFamily: MONO,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: 200,
  },
  stateText: {
    fontSize: 13,
    color: colors.muted,
    textAlign: "center",
    paddingHorizontal: 24,
  },
  retryBtn: {
    paddingHorizontal: 18,
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

// ── Delete modal styles ────────────────────────────────────────

const deleteStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.65)",
    padding: 20,
  },
  dialog: {
    width: "100%",
    maxHeight: "80%",
    backgroundColor: "#171B33",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: "hidden",
  },
  dialogHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  dialogTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.2,
  },
  dialogBody: {
    flexGrow: 0,
    padding: 16,
  },
  warningText: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 19,
    marginBottom: 14,
  },
  childrenBlock: {
    marginBottom: 14,
  },
  childrenLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: colors.faint,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  childRow: {
    paddingVertical: 4,
    paddingLeft: 8,
  },
  childText: {
    fontSize: 12,
    fontFamily: MONO,
    color: colors.muted,
  },
  moreText: {
    fontSize: 12,
    color: colors.faint,
    paddingLeft: 8,
    paddingTop: 2,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: colors.faint,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  strategyBlock: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: "hidden",
    marginBottom: 14,
  },
  strategyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  strategyBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: colors.hairlineHi,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  radioActive: {
    borderColor: colors.orange,
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.orange,
  },
  strategyLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 1,
  },
  strategySub: {
    fontSize: 11,
    color: colors.faint,
    lineHeight: 15,
  },
  confirmBlock: {
    marginBottom: 4,
  },
  confirmName: {
    fontFamily: MONO,
    color: colors.text,
  },
  confirmInput: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    fontFamily: MONO,
    color: colors.text,
    marginTop: 4,
  },
  dialogFooter: {
    flexDirection: "row",
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: "center",
  },
  cancelText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  deleteBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255,107,107,0.20)",
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: "center",
  },
  deleteBtnDisabled: {
    opacity: 0.4,
  },
  deleteText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.danger,
  },
});
