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
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import type { ComponentProps } from "react";

import { colors } from "../theme";
import { useArgoClient } from "../client";
import type { ResourceNode } from "../api";
import { getHealth } from "../status";
import {
  ResourceDetailSheet,
  type ResourceDetailRef,
} from "../components/resource-detail-sheet";
import {
  applyResourceFilter,
  ResourceFilterSheet,
  resourceFilterCount,
  useResourceFilter,
} from "../components/resource-filter";

const MONO = Platform.OS === "ios" ? "Menlo" : "monospace";
const INDENT = 18;

// ── Types ──────────────────────────────────────────────────────

interface FlatItem {
  uid: string;
  node: ResourceNode;
  depth: number;
  childCount: number;
  isExpanded: boolean;
}

// ── Helpers ────────────────────────────────────────────────────

type IoniconName = ComponentProps<typeof Ionicons>["name"];

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

function nodeUid(node: ResourceNode): string {
  return (
    node.uid ??
    `${node.group ?? ""}/${node.kind}/${node.namespace ?? ""}/${node.name}`
  );
}

function flattenTree(
  nodes: ResourceNode[],
  childMap: Map<string, ResourceNode[]>,
  expanded: Set<string>,
  depth = 0,
): FlatItem[] {
  const result: FlatItem[] = [];
  for (const node of nodes) {
    const uid = nodeUid(node);
    const children = node.uid ? (childMap.get(node.uid) ?? []) : [];
    result.push({
      uid,
      node,
      depth,
      childCount: children.length,
      isExpanded: expanded.has(uid),
    });
    if (expanded.has(uid) && children.length > 0) {
      result.push(...flattenTree(children, childMap, expanded, depth + 1));
    }
  }
  return result;
}

// ── Node row ───────────────────────────────────────────────────

const TreeNodeRow = React.memo(function TreeNodeRow({
  item,
  onPress,
  onToggle,
  last,
}: {
  item: FlatItem;
  onPress: () => void;
  onToggle?: () => void;
  last: boolean;
}) {
  const { node, depth, childCount, isExpanded } = item;
  const health = getHealth(node.health?.status ?? "Unknown");
  const isHealthy = !node.health?.status || node.health.status === "Healthy";

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.65}
      style={[
        styles.row,
        !last && styles.rowBorder,
        { paddingLeft: 12 + depth * INDENT },
      ]}
    >
      {/* Expand chevron — separate tap target so row tap always opens detail */}
      <TouchableOpacity
        onPress={onToggle}
        disabled={!onToggle}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.chevronWrap}
        activeOpacity={0.5}
      >
        {childCount > 0 ? (
          <Ionicons
            name="chevron-forward"
            size={11}
            color={colors.faint}
            style={{ transform: [{ rotate: isExpanded ? "90deg" : "0deg" }] }}
          />
        ) : (
          <View style={{ width: 11 }} />
        )}
      </TouchableOpacity>

      {/* Kind icon */}
      <View style={styles.kindBox}>
        <Ionicons name={kindIcon(node.kind)} size={13} color={colors.muted} />
      </View>

      {/* Name + meta */}
      <View style={styles.nodeInfo}>
        <Text style={styles.nodeName} numberOfLines={1}>
          {node.name}
        </Text>
        {(node.health?.message || depth === 0) && (
          <Text
            style={[
              styles.nodeMeta,
              !!node.health?.message && !isHealthy && { color: health.color },
            ]}
            numberOfLines={1}
          >
            {node.health?.message ||
              `${node.kind}${node.namespace ? ` · ${node.namespace}` : ""}`}
          </Text>
        )}
      </View>

      {/* Child count */}
      {childCount > 0 && <Text style={styles.childCount}>{childCount}</Text>}

      {/* Health icon */}
      <Ionicons
        name={health.icon}
        size={13}
        color={health.color}
        style={{ opacity: isHealthy ? 0.45 : 1 }}
      />
    </TouchableOpacity>
  );
});

// ── Screen ─────────────────────────────────────────────────────

export default function TreeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const client = useArgoClient();
  const { name, namespace } = useLocalSearchParams<{
    name: string;
    namespace: string;
  }>();

  const [detailResource, setDetailResource] =
    useState<ResourceDetailRef | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const { filter: filterState, setFilter: setFilterState } =
    useResourceFilter();
  const [showFilter, setShowFilter] = useState(false);

  const { data: treeData, isLoading } = useQuery({
    queryKey: client.queryKeys.resourceTree(namespace, name),
    queryFn: () => client.getResourceTree(name, namespace),
  });

  const treeNodes = useMemo(() => treeData?.nodes ?? [], [treeData?.nodes]);

  const activeFilterCount = resourceFilterCount(filterState);

  const allKinds = useMemo(
    () => [...new Set(treeNodes.map((n) => n.kind))].sort(),
    [treeNodes],
  );

  const allNamespaces = useMemo(
    () =>
      [
        ...new Set(
          treeNodes.map((n) => n.namespace).filter(Boolean) as string[],
        ),
      ].sort(),
    [treeNodes],
  );

  const filteredNodes = useMemo(
    () =>
      activeFilterCount > 0
        ? applyResourceFilter(treeNodes, filterState)
        : treeNodes,
    [treeNodes, filterState, activeFilterCount],
  );

  // childMap and rootNodes always built from the full unfiltered tree
  // so defaultExpanded can walk the real tree shape
  const { childMap, rootNodes } = useMemo(() => {
    const map = new Map<string, ResourceNode[]>();
    for (const node of treeNodes) {
      for (const ref of node.parentRefs ?? []) {
        if (!ref.uid) continue;
        const arr = map.get(ref.uid);
        if (arr) arr.push(node);
        else map.set(ref.uid, [node]);
      }
    }
    const roots = treeNodes.filter(
      (n) => !n.parentRefs || n.parentRefs.length === 0,
    );
    return { childMap: map, rootNodes: roots };
  }, [treeNodes]);

  // When filter active, rebuild tree from matched nodes only
  const { activeChildMap, activeRootNodes } = useMemo(() => {
    if (activeFilterCount === 0)
      return { activeChildMap: childMap, activeRootNodes: rootNodes };

    const inSet = new Set(
      filteredNodes.map((n) => n.uid).filter(Boolean) as string[],
    );
    const map = new Map<string, ResourceNode[]>();
    for (const node of filteredNodes) {
      for (const ref of node.parentRefs ?? []) {
        if (!ref.uid) continue;
        const arr = map.get(ref.uid);
        if (arr) arr.push(node);
        else map.set(ref.uid, [node]);
      }
    }
    const roots = filteredNodes.filter(
      (n) =>
        !n.parentRefs?.length ||
        n.parentRefs.every((ref) => !ref.uid || !inSet.has(ref.uid)),
    );
    return { activeChildMap: map, activeRootNodes: roots };
  }, [filteredNodes, activeFilterCount, childMap, rootNodes]);

  const defaultExpanded = useMemo(() => {
    const set = new Set<string>();
    for (const n of rootNodes) set.add(nodeUid(n));

    const uidMap = new Map<string, ResourceNode>();
    for (const n of treeNodes) {
      if (n.uid) uidMap.set(n.uid, n);
    }

    const walkUp = (n: ResourceNode) => {
      for (const ref of n.parentRefs ?? []) {
        if (!ref.uid) continue;
        const parent = uidMap.get(ref.uid);
        if (parent) {
          set.add(nodeUid(parent));
          walkUp(parent);
        }
      }
    };

    for (const n of treeNodes) {
      if (n.health?.status && n.health.status !== "Healthy") walkUp(n);
    }

    return set;
  }, [treeNodes, rootNodes]);

  useEffect(() => {
    if (treeNodes.length > 0 && !initializedRef.current) {
      initializedRef.current = true;
      setExpanded(defaultExpanded);
    }
  }, [defaultExpanded]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpanded = useCallback((uid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const all = new Set<string>();
    for (const n of treeNodes) all.add(nodeUid(n));
    setExpanded(all);
  }, [treeNodes]);

  const collapseAll = useCallback(() => setExpanded(new Set()), []);

  // When filter active, expand all matched nodes automatically
  const expandedForRender = useMemo(() => {
    if (activeFilterCount > 0) {
      const all = new Set<string>();
      for (const n of filteredNodes) all.add(nodeUid(n));
      return all;
    }
    return expanded;
  }, [activeFilterCount, filteredNodes, expanded]);

  const flatItems = useMemo(
    () => flattenTree(activeRootNodes, activeChildMap, expandedForRender),
    [activeRootNodes, activeChildMap, expandedForRender],
  );

  const openDetail = useCallback((node: ResourceNode) => {
    setDetailResource({
      group: node.group,
      version: node.version,
      kind: node.kind,
      namespace: node.namespace,
      name: node.name,
      health: node.health,
      info: node.info,
      images: node.images,
      createdAt: node.createdAt,
    });
  }, []);

  const shortName = name.split("/").pop()?.slice(0, 22) ?? name;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <LinearGradient
        colors={["#171B33", "#0E1226"]}
        style={[styles.header, { paddingTop: insets.top }]}
      >
        <View style={styles.headerNav}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={18} color={colors.orange} />
            <Text style={styles.backText}>{shortName}</Text>
          </TouchableOpacity>

          <View style={styles.headerBtns}>
            <TouchableOpacity
              onPress={expandAll}
              style={styles.headerBtn}
              activeOpacity={0.7}
            >
              <Text style={styles.headerBtnText}>Expand all</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={collapseAll}
              style={styles.headerBtn}
              activeOpacity={0.7}
            >
              <Text style={styles.headerBtnText}>Collapse</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowFilter(true)}
              style={[
                styles.headerBtn,
                activeFilterCount > 0 && styles.headerBtnActive,
              ]}
              activeOpacity={0.7}
            >
              <Ionicons
                name="filter"
                size={11}
                color={activeFilterCount > 0 ? colors.orange : colors.text}
              />
              {activeFilterCount > 0 && (
                <Text style={[styles.headerBtnText, { color: colors.orange }]}>
                  {activeFilterCount}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.headerInfo}>
          <Text style={styles.headerLabel}>Resource tree</Text>
          <Text style={styles.headerAppName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.headerHint}>
            {activeFilterCount > 0
              ? `${filteredNodes.length} of ${treeNodes.length} resources`
              : `${treeNodes.length} resources`}{" "}
            · tap for details · tap chevron to expand
          </Text>
        </View>
      </LinearGradient>

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.orange} />
        </View>
      ) : flatItems.length === 0 ? (
        <View style={styles.loading}>
          <Text style={styles.emptyText}>No resources</Text>
        </View>
      ) : (
        <FlatList
          data={flatItems}
          keyExtractor={(item) => item.uid}
          renderItem={({ item, index }) => (
            <TreeNodeRow
              item={item}
              onPress={() => openDetail(item.node)}
              onToggle={
                item.childCount > 0 ? () => toggleExpanded(item.uid) : undefined
              }
              last={index === flatItems.length - 1}
            />
          )}
          style={styles.list}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          maxToRenderPerBatch={30}
          windowSize={12}
        />
      )}

      <ResourceDetailSheet
        visible={detailResource !== null}
        onClose={() => setDetailResource(null)}
        appName={name}
        appNamespace={namespace}
        resource={detailResource}
      />

      <ResourceFilterSheet
        visible={showFilter}
        onClose={() => setShowFilter(false)}
        state={filterState}
        setState={setFilterState}
        allKinds={allKinds}
        allNamespaces={allNamespaces}
      />
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
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
    justifyContent: "space-between",
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
  headerBtns: {
    flexDirection: "row",
    gap: 6,
    paddingRight: 8,
  },
  headerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  headerBtnActive: {
    backgroundColor: "rgba(239,123,77,0.12)",
    borderColor: "rgba(239,123,77,0.40)",
  },
  headerBtnText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.text,
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
    flex: 1,
    backgroundColor: "#1C2140",
  },

  // Row
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 14,
    paddingVertical: 10,
    gap: 8,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  chevronWrap: {
    width: 16,
    alignItems: "center",
    flexShrink: 0,
  },
  kindBox: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  nodeInfo: {
    flex: 1,
    minWidth: 0,
  },
  nodeName: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.text,
    fontFamily: MONO,
    letterSpacing: -0.1,
  },
  nodeMeta: {
    fontSize: 10,
    color: colors.faint,
    marginTop: 2,
    fontFamily: MONO,
  },
  childCount: {
    fontSize: 10,
    color: colors.faint,
    fontFamily: MONO,
    flexShrink: 0,
  },
});
