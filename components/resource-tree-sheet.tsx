import React, { useEffect, useState } from "react";
import {
  Dimensions,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";

import { colors } from "../lib/theme";
import { getHealth } from "../lib/status";
import type { ResourceNode } from "../lib/api";
import {
  ResourceDetailContent,
  type ResourceDetailRef,
} from "./resource-detail-sheet";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

const { height: SCREEN_H } = Dimensions.get("window");

// ── Helpers ───────────────────────────────────────────────────

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

function nodeKey(n: ResourceNode): string {
  return `${n.group ?? ""}/${n.kind}/${n.namespace ?? ""}/${n.name}`;
}

function nodeTitle(n: ResourceNode): string {
  const gk = [n.group, n.kind].filter(Boolean).join("/");
  return `${gk}: ${n.name}`;
}

// ── Node row ──────────────────────────────────────────────────

function NodeRow({
  node,
  childCount,
  onDrillDown,
  onPress,
  last,
}: {
  node: ResourceNode;
  childCount: number;
  onDrillDown?: () => void;
  onPress?: () => void;
  last?: boolean;
}) {
  const health = getHealth(node.health?.status ?? "Unknown");
  const hasChildren = childCount > 0;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={onPress ? 0.65 : 1}
      style={[styles.nodeRow, !last && styles.rowBorder]}
    >
      {/* Kind icon */}
      <Ionicons
        name={kindIcon(node.kind)}
        size={16}
        color={colors.muted}
        style={styles.kindIcon}
      />

      {/* Name + meta */}
      <View style={styles.nodeInfo}>
        <Text style={styles.nodeName} numberOfLines={1}>
          {node.name}
        </Text>
        <Text style={styles.nodeMeta} numberOfLines={1}>
          {[node.kind, node.namespace].filter(Boolean).join(" · ")}
        </Text>
      </View>

      {/* Health */}
      <Ionicons name={health.icon} size={14} color={health.color} />

      {/* Child count + chevron */}
      {hasChildren && (
        <TouchableOpacity
          onPress={onDrillDown}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.drillBtn}
        >
          <View style={styles.childBadge}>
            <Text style={styles.childBadgeText}>{childCount}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.muted} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

// ── Resource tree sheet ───────────────────────────────────────

// Stack entry stores parent UID so nodes are derived live from childMap on every render
interface Level {
  title: string;
  parentUid: string;
}

export interface ResourceTreeSheetProps {
  visible: boolean;
  onClose: () => void;
  rootNode: ResourceNode | null;
  childMap: Map<string, ResourceNode[]>;
  appName: string;
  appNamespace: string;
}

export function ResourceTreeSheet({
  visible,
  onClose,
  rootNode,
  childMap,
  appName,
  appNamespace,
}: ResourceTreeSheetProps) {
  const insets = useSafeAreaInsets();
  const [stack, setStack] = useState<Level[]>([]);
  const [detailNode, setDetailNode] = useState<ResourceDetailRef | null>(null);

  useEffect(() => {
    if (visible && rootNode) {
      setStack([{ title: nodeTitle(rootNode), parentUid: rootNode.uid ?? "" }]);
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = stack[stack.length - 1];
  // Always derive from live childMap — never store stale node arrays in the stack
  const currentNodes = current ? (childMap.get(current.parentUid) ?? []) : [];

  const push = (node: ResourceNode) => {
    setStack((s) => [
      ...s,
      { title: nodeTitle(node), parentUid: node.uid ?? "" },
    ]);
  };

  const pop = () => {
    if (stack.length <= 1) {
      onClose();
    } else {
      setStack((s) => s.slice(0, -1));
    }
  };

  if (!current) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={pop}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          onPress={onClose}
          activeOpacity={1}
        />
        <View style={[styles.sheet, { height: SCREEN_H * 0.72 }]}>
          {/* Handle */}
          <View style={styles.handleBar} />

          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              onPress={pop}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 12 }}
              style={styles.backBtn}
            >
              {stack.length > 1 ? (
                <>
                  <Ionicons
                    name="chevron-back"
                    size={16}
                    color={colors.orange}
                  />
                  <Text style={styles.backText}>Back</Text>
                </>
              ) : (
                <View style={{ width: 60 }} />
              )}
            </TouchableOpacity>

            <Text style={styles.headerTitle} numberOfLines={1}>
              {stack.length === 1 ? "Resources" : current.title}
            </Text>

            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 12, right: 8 }}
              style={styles.closeBtn}
            >
              <Text style={styles.closeBtnText}>Done</Text>
            </TouchableOpacity>
          </View>

          {/* Breadcrumb title for deep levels */}
          {stack.length > 1 && (
            <Text style={styles.breadcrumb} numberOfLines={1}>
              {stack
                .slice(0, -1)
                .map((l) => l.title)
                .join(" › ")}
            </Text>
          )}

          {/* Count */}
          <Text style={styles.countLabel}>
            {currentNodes.length}{" "}
            {currentNodes.length === 1 ? "resource" : "resources"}
          </Text>

          {/* List */}
          <FlatList
            data={currentNodes}
            keyExtractor={nodeKey}
            renderItem={({ item, index }) => {
              const children = item.uid ? (childMap.get(item.uid) ?? []) : [];
              return (
                <NodeRow
                  node={item}
                  childCount={children.length}
                  onDrillDown={() => push(item)}
                  onPress={() =>
                    setDetailNode({
                      group: item.group,
                      version: item.version,
                      kind: item.kind,
                      namespace: item.namespace,
                      name: item.name,
                      health: item.health,
                      info: item.info,
                      images: item.images,
                      createdAt: item.createdAt,
                    })
                  }
                  last={index === currentNodes.length - 1}
                />
              );
            }}
            style={styles.list}
            contentContainerStyle={{
              paddingBottom: insets.bottom + 16,
            }}
            showsVerticalScrollIndicator={false}
          />
        </View>
      </View>

      {/* Resource detail overlay — sits inside the modal, no nested Modal needed */}
      {detailNode && (
        <View style={StyleSheet.absoluteFillObject}>
          <ResourceDetailContent
            resource={detailNode}
            appName={appName}
            appNamespace={appNamespace}
            onClose={() => setDetailNode(null)}
          />
        </View>
      )}
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
    paddingTop: 4,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 60,
    gap: 2,
  },
  backText: {
    fontSize: 15,
    color: colors.orange,
    fontWeight: "500",
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    textAlign: "center",
    letterSpacing: -0.2,
    paddingHorizontal: 8,
  },
  closeBtn: {
    minWidth: 60,
    alignItems: "flex-end",
  },
  closeBtnText: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.orange,
  },

  // Breadcrumb
  breadcrumb: {
    fontSize: 11,
    color: colors.faint,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },

  // Count
  countLabel: {
    fontSize: 12,
    color: colors.muted,
    paddingHorizontal: 16,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },

  // List
  list: {
    flex: 1,
    backgroundColor: "#1C2140",
  },

  // Node row
  nodeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  kindIcon: {
    flexShrink: 0,
  },
  nodeInfo: {
    flex: 1,
    minWidth: 0,
  },
  nodeName: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.text,
    letterSpacing: -0.1,
  },
  nodeMeta: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 1,
  },

  // Drill-down button
  drillBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginLeft: 4,
  },
  childBadge: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  childBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.muted,
  },
});
