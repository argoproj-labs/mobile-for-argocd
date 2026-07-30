import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import { colors } from "../../lib/theme";
import { appSource, type Application, type ResourceNode } from "../../lib/api";
import { useArgoClient } from "../../lib/client";
import { getHealth, getOperationPhase, getSync } from "../../lib/status";
import { SyncSheet } from "../../components/sync-sheet";
import { ResourceTreeSheet } from "../../components/resource-tree-sheet";
import {
  ResourceDetailSheet,
  type ResourceDetailRef,
} from "../../components/resource-detail-sheet";
import {
  applyResourceFilter,
  ResourceFilterSheet,
  resourceFilterCount,
  useResourceFilter,
} from "../../components/resource-filter";

// ── Helpers ───────────────────────────────────────────────────

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
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function shortRepo(url: string): string {
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    return u.pathname.replace(/^\//, "").replace(/\.git$/, "") || u.hostname;
  } catch {
    return url;
  }
}

function destLabel(app: Application): string {
  const d = app.spec.destination;
  if (d.name) return d.name;
  if (d.server) {
    try {
      return new URL(d.server).hostname;
    } catch {
      return d.server;
    }
  }
  return "—";
}

function shortSha(rev?: string): string {
  if (!rev) return "—";
  return rev.length > 7 ? rev.slice(0, 7) : rev;
}

// ── Section wrapper ────────────────────────────────────────────

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {action}
      </View>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

// ── Detail row ────────────────────────────────────────────────

function DetailRow({
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
    <View style={[styles.detailRow, !last && styles.detailRowBorder]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text
        style={[styles.detailValue, mono && styles.detailMono]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

// ── Status tile ────────────────────────────────────────────────

function StatusTile({
  kind,
  status,
  subtitle,
}: {
  kind: "health" | "sync";
  status: string;
  subtitle: string;
}) {
  const t = kind === "health" ? getHealth(status) : getSync(status);
  return (
    <View style={[styles.statusTile, { borderColor: colors.hairline }]}>
      <View style={[styles.statusGlow, { backgroundColor: t.color }]} />
      <Text style={styles.statusTileKind}>
        {kind === "health" ? "HEALTH" : "SYNC"}
      </Text>
      <View style={styles.statusTileValueRow}>
        <Ionicons name={t.icon} size={20} color={t.color} />
        <Text style={[styles.statusTileValue, { color: t.color }]}>
          {status}
        </Text>
      </View>
      <Text style={styles.statusTileSubtitle} numberOfLines={1}>
        {subtitle}
      </Text>
    </View>
  );
}

// ── Resource row ──────────────────────────────────────────────

type ResourceItem = NonNullable<Application["status"]["resources"]>[number];

function ResourceRow({
  resource,
  appNamespace,
  childCount = 0,
  onDrillDown,
  onPress,
  last,
}: {
  resource: ResourceItem;
  appNamespace: string;
  childCount?: number;
  onDrillDown?: () => void;
  onPress?: () => void;
  last?: boolean;
}) {
  const health = getHealth(resource.health?.status ?? "Unknown");
  const sync = getSync(resource.status ?? "Unknown");
  const showNs = resource.namespace && resource.namespace !== appNamespace;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={onPress ? 0.65 : 1}
      style={[styles.resourceRow, !last && styles.detailRowBorder]}
    >
      <View style={styles.resourceLeft}>
        <Text style={styles.resourceName} numberOfLines={1}>
          {resource.name}
        </Text>
        {showNs && (
          <Text style={styles.resourceNs} numberOfLines={1}>
            {resource.namespace}
          </Text>
        )}
      </View>
      <View style={styles.resourceStatus}>
        <Ionicons name={health.icon} size={13} color={health.color} />
        <Ionicons
          name={sync.icon}
          size={13}
          color={sync.color}
          style={{ marginLeft: 6 }}
        />
        {resource.requiresPruning && (
          <Ionicons
            name="trash-outline"
            size={12}
            color={colors.faint}
            style={{ marginLeft: 6 }}
          />
        )}
      </View>
      {childCount > 0 && (
        <TouchableOpacity
          onPress={onDrillDown}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.resourceDrillBtn}
        >
          <View style={styles.resourceChildBadge}>
            <Text style={styles.resourceChildBadgeText}>{childCount}</Text>
          </View>
          <Ionicons name="chevron-forward" size={14} color={colors.muted} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

// ── Resource kind group ───────────────────────────────────────

function kindLabel(group: string | undefined, kind: string): string {
  if (!group) return kind;
  const short: Record<string, string> = {
    apps: "apps",
    batch: "batch",
    "networking.k8s.io": "networking",
    "rbac.authorization.k8s.io": "rbac",
  };
  return `${short[group] ?? group}/${kind}`;
}

function ResourceGroup({
  group,
  kind,
  items,
  appNamespace,
  treeNodes,
  childMap,
  onDrillDown,
  onSelectResource,
}: {
  group: string | undefined;
  kind: string;
  items: ResourceItem[];
  appNamespace: string;
  treeNodes: ResourceNode[];
  childMap: Map<string, ResourceNode[]>;
  onDrillDown: (node: ResourceNode) => void;
  onSelectResource: (ref: ResourceDetailRef) => void;
}) {
  return (
    <View style={styles.resourceGroup}>
      <View style={styles.resourceGroupHeader}>
        <Ionicons name="cube-outline" size={12} color={colors.muted} />
        <Text style={styles.resourceGroupKind}>{kindLabel(group, kind)}</Text>
        <Text style={styles.resourceGroupCount}>{items.length}</Text>
      </View>
      {items.map((r, i) => {
        const treeNode = treeNodes.find(
          (n) =>
            (n.group ?? "") === (r.group ?? "") &&
            n.kind === r.kind &&
            (n.namespace ?? "") === (r.namespace ?? "") &&
            n.name === r.name,
        );
        const children = treeNode?.uid
          ? (childMap.get(treeNode.uid) ?? [])
          : [];
        return (
          <ResourceRow
            key={`${r.namespace ?? ""}/${r.name}`}
            resource={r}
            appNamespace={appNamespace}
            childCount={children.length}
            onDrillDown={treeNode ? () => onDrillDown(treeNode) : undefined}
            onPress={() =>
              onSelectResource({
                group: r.group,
                version: r.version,
                kind: r.kind,
                namespace: r.namespace,
                name: r.name,
                health: treeNode?.health ?? r.health,
                syncStatus: r.status,
                info: treeNode?.info,
                images: treeNode?.images,
                createdAt: treeNode?.createdAt,
                children: treeNode?.uid
                  ? (childMap.get(treeNode.uid) ?? []).map((c) => ({
                      kind: c.kind,
                      name: c.name,
                    }))
                  : [],
              })
            }
            last={i === items.length - 1}
          />
        );
      })}
    </View>
  );
}

// ── Loading skeleton ──────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color={colors.muted} />
    </View>
  );
}

// ── Details screen ────────────────────────────────────────────

export default function AppDetailsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { name, namespace } = useLocalSearchParams<{
    name: string;
    namespace: string;
  }>();
  const client = useArgoClient();
  const queryClient = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const latestRvRef = useRef<string | null>(null);
  const [syncSheetOpen, setSyncSheetOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { filter: resourceFilter, setFilter: setResourceFilter } =
    useResourceFilter();
  const [showResourceFilter, setShowResourceFilter] = useState(false);

  const queryKey = client.queryKeys.application(namespace, name);
  const [treeSheet, setTreeSheet] = useState<ResourceNode | null>(null);
  const [detailResource, setDetailResource] =
    useState<ResourceDetailRef | null>(null);

  const { data: app, isLoading } = useQuery({
    queryKey,
    queryFn: () => client.getApplication(name, namespace),
  });

  const { data: treeData } = useQuery({
    queryKey: client.queryKeys.resourceTree(namespace, name),
    queryFn: () => client.getResourceTree(name, namespace),
    enabled: !!app,
  });

  const treeNodes = useMemo(() => treeData?.nodes ?? [], [treeData?.nodes]);

  const childMap = useMemo(() => {
    const map = new Map<string, ResourceNode[]>();
    for (const node of treeNodes) {
      for (const ref of node.parentRefs ?? []) {
        if (!ref.uid) continue;
        const existing = map.get(ref.uid);
        if (existing) {
          existing.push(node);
        } else {
          map.set(ref.uid, [node]);
        }
      }
    }
    return map;
  }, [treeNodes]);

  // Live watch loop — starts once when initial app data arrives, reconnects automatically
  useEffect(() => {
    if (!app) return;

    const rv = app.metadata.resourceVersion;
    if (!rv) return;

    latestRvRef.current = rv;
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const runWatch = async () => {
      while (!ctrl.signal.aborted) {
        const currentRv = latestRvRef.current;
        if (!currentRv) break;
        try {
          await client.watchApplication(
            name,
            namespace,
            currentRv,
            (type, updated) => {
              if (ctrl.signal.aborted) return;
              if (type === "DELETED") {
                void router.back();
                return;
              }
              if (updated.metadata.resourceVersion) {
                latestRvRef.current = updated.metadata.resourceVersion;
              }
              queryClient.setQueryData<Application>(queryKey, updated);
            },
            ctrl.signal,
          );
        } catch {
          if (ctrl.signal.aborted) return;
          await new Promise<void>((r) => setTimeout(r, 2_000));
        }
      }
    };

    void runWatch();
    return () => {
      ctrl.abort();
    };
  }, [!!app]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resource tree watch loop — streams live node updates once app is loaded
  useEffect(() => {
    if (!app) return;

    const ctrl = new AbortController();

    const runWatch = async () => {
      while (!ctrl.signal.aborted) {
        try {
          await client.watchResourceTree(
            name,
            namespace,
            (tree) => {
              if (ctrl.signal.aborted) return;
              queryClient.setQueryData(
                client.queryKeys.resourceTree(namespace, name),
                tree,
              );
            },
            ctrl.signal,
          );
        } catch {
          if (ctrl.signal.aborted) return;
          await new Promise<void>((r) => setTimeout(r, 2_000));
        }
      }
    };

    void runWatch();
    return () => ctrl.abort();
  }, [!!app]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const updated = await client.refreshApplication(name, namespace);
      queryClient.setQueryData<Application>(queryKey, updated);
    } catch (e) {
      Alert.alert("Refresh failed", e instanceof Error ? e.message : String(e));
    } finally {
      setIsRefreshing(false);
    }
  };

  const src = app ? appSource(app) : null;
  const opState = app?.status?.operationState;
  const opPhase = opState?.phase;
  const opToken = opPhase ? getOperationPhase(opPhase) : null;
  const revision = opState?.syncResult?.revision ?? app?.status?.sync?.revision;

  const allResourceKinds = useMemo(
    () =>
      [
        ...new Set(
          (app?.status?.resources ?? [])
            .filter((r) => !r.hook)
            .map((r) => r.kind),
        ),
      ].sort(),
    [app?.status?.resources],
  );

  const allResourceNamespaces = useMemo(
    () =>
      [
        ...new Set(
          (app?.status?.resources ?? [])
            .filter((r) => !r.hook && !!r.namespace)
            .map((r) => r.namespace as string),
        ),
      ].sort(),
    [app?.status?.resources],
  );

  const resourceFilterActiveCount = resourceFilterCount(resourceFilter);

  // Group resources by group+kind, sorted by kind then name
  const resourceGroups = useMemo(() => {
    if (!app?.status?.resources) return [];
    const base = applyResourceFilter(
      [...app?.status?.resources].filter((r) => !r.hook),
      resourceFilter,
    ).sort((a, b) => {
      const ka = kindLabel(a.group, a.kind);
      const kb = kindLabel(b.group, b.kind);
      return ka.localeCompare(kb) || a.name.localeCompare(b.name);
    });
    const groups: Map<
      string,
      { group?: string; kind: string; items: ResourceItem[] }
    > = new Map();
    for (const r of base) {
      const key = kindLabel(r.group, r.kind);
      if (!groups.has(key))
        groups.set(key, { group: r.group, kind: r.kind, items: [] });
      groups.get(key)!.items.push(r);
    }
    return Array.from(groups.values());
  }, [app?.status?.resources, resourceFilter]);

  const totalResources = resourceGroups.reduce(
    (sum, g) => sum + g.items.length,
    0,
  );
  const images = app?.status?.summary?.images ?? [];
  const externalURLs = app?.status?.summary?.externalURLs ?? [];

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* Header */}
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
            <Text style={styles.backText}>Apps</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuBtn} activeOpacity={0.7}>
            <View style={styles.menuDot} />
            <View style={styles.menuDot} />
            <View style={styles.menuDot} />
          </TouchableOpacity>
        </View>
        {app && (
          <View style={styles.headerAppInfo}>
            <Text style={styles.headerProject}>{app.spec.project}</Text>
            <Text style={styles.headerAppName} numberOfLines={2}>
              {name}
            </Text>
          </View>
        )}
      </LinearGradient>

      {isLoading && !app ? (
        <LoadingSkeleton />
      ) : !app ? (
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>App not found</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 24 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Status tiles */}
          <View style={styles.tilesRow}>
            <StatusTile
              kind="health"
              status={app.status?.health?.status ?? "Unknown"}
              subtitle="App health"
            />
            <StatusTile
              kind="sync"
              status={app.status?.sync?.status ?? "Unknown"}
              subtitle={
                (app.status?.sync?.status ?? "") === "Synced"
                  ? `to ${shortSha(app.status?.sync?.revision)}`
                  : `from ${shortSha(app.status?.sync?.revision)}`
              }
            />
          </View>

          {/* Action row */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              testID="sync-button"
              onPress={() => setSyncSheetOpen(true)}
              activeOpacity={0.85}
              style={{ flex: 1 }}
            >
              <LinearGradient
                colors={["#EF7B4D", "#E5613A"] as const}
                style={styles.actionBtnPrimary}
              >
                <Ionicons name="refresh" size={18} color="#fff" />
                <Text style={styles.actionLabelPrimary}>Sync</Text>
              </LinearGradient>
            </TouchableOpacity>

            {(
              [
                {
                  icon: "reload-circle-outline" as const,
                  label: "Refresh",
                  onPress: () => void handleRefresh(),
                  loading: isRefreshing,
                  disabled: isRefreshing,
                },
                {
                  icon: "git-compare-outline" as const,
                  label: "Diff",
                  onPress: () =>
                    router.push(
                      `/(app)/diff?name=${encodeURIComponent(name)}&namespace=${encodeURIComponent(namespace)}`,
                    ),
                  loading: false,
                  disabled: false,
                },
                {
                  icon: "time-outline" as const,
                  label: "History",
                  onPress: () =>
                    router.push(
                      `/(app)/history?name=${encodeURIComponent(name)}&namespace=${encodeURIComponent(namespace)}`,
                    ),
                  loading: false,
                  disabled: false,
                },
              ] as const
            ).map((btn) => (
              <TouchableOpacity
                key={btn.label}
                testID={`action-${btn.label.toLowerCase()}`}
                onPress={btn.onPress}
                disabled={btn.disabled}
                activeOpacity={0.7}
                style={[
                  styles.actionBtnGhost,
                  btn.disabled && styles.actionBtnDimmed,
                ]}
              >
                {btn.loading ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <Ionicons name={btn.icon} size={18} color={colors.text} />
                )}
                <Text style={styles.actionLabel}>{btn.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Summary */}
          <Section title="SUMMARY">
            <DetailRow label="Project" value={app.spec.project} />
            <DetailRow
              label="Namespace"
              value={app.spec.destination.namespace ?? "—"}
            />
            <DetailRow label="Cluster" value={destLabel(app)} mono />
            <DetailRow
              label="Created"
              value={timeAgo(app.metadata.creationTimestamp)}
              last
            />
          </Section>

          {/* Source */}
          {src && (
            <Section title="SOURCE">
              <DetailRow label="Repo" value={shortRepo(src.repoURL)} mono />
              {src.path && <DetailRow label="Path" value={src.path} mono />}
              {src.chart && <DetailRow label="Chart" value={src.chart} mono />}
              <DetailRow
                label="Revision"
                value={src.targetRevision ?? "HEAD"}
                mono
                last
              />
            </Section>
          )}

          {/* Last operation */}
          {opState && opToken && (
            <Section title="LAST OPERATION">
              <View style={[styles.detailRow, styles.detailRowBorder]}>
                <Text style={styles.detailLabel}>Phase</Text>
                <View style={styles.phaseRow}>
                  <Ionicons
                    name={opToken.icon}
                    size={14}
                    color={opToken.color}
                  />
                  <Text style={[styles.phaseText, { color: opToken.color }]}>
                    {opPhase}
                  </Text>
                </View>
              </View>
              <DetailRow
                label="Finished"
                value={timeAgo(opState.finishedAt ?? opState.startedAt)}
              />
              <DetailRow label="Revision" value={shortSha(revision)} mono />
              {opState.message ? (
                <View style={[styles.detailRow, { alignItems: "flex-start" }]}>
                  <Text style={styles.detailLabel}>Message</Text>
                  <Text
                    style={[styles.detailValue, styles.messageText]}
                    numberOfLines={3}
                  >
                    {opState.message}
                  </Text>
                </View>
              ) : (
                <DetailRow label="Message" value="—" last />
              )}
            </Section>
          )}

          {/* Resources */}
          {(resourceGroups.length > 0 || resourceFilterActiveCount > 0) && (
            <Section
              title={`RESOURCES · ${totalResources}`}
              action={
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => setShowResourceFilter(true)}
                    style={[
                      styles.treeBtn,
                      resourceFilterActiveCount > 0 && styles.treeBtnActive,
                    ]}
                    activeOpacity={0.7}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Ionicons
                      name="filter"
                      size={12}
                      color={
                        resourceFilterActiveCount > 0
                          ? colors.orange
                          : colors.muted
                      }
                    />
                    {resourceFilterActiveCount > 0 && (
                      <Text style={styles.treeBtnText}>
                        {resourceFilterActiveCount}
                      </Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() =>
                      router.push(
                        `/(app)/tree?name=${encodeURIComponent(name)}&namespace=${encodeURIComponent(namespace)}`,
                      )
                    }
                    style={styles.treeBtn}
                    activeOpacity={0.7}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Ionicons
                      name="git-network-outline"
                      size={12}
                      color={colors.orange}
                    />
                    <Text style={styles.treeBtnText}>Tree</Text>
                  </TouchableOpacity>
                </View>
              }
            >
              {resourceGroups.map((g, gi) => (
                <View
                  key={`${g.group ?? ""}/${g.kind}`}
                  style={gi < resourceGroups.length - 1 && styles.groupDivider}
                >
                  <ResourceGroup
                    group={g.group}
                    kind={g.kind}
                    items={g.items}
                    appNamespace={app.metadata.namespace}
                    treeNodes={treeNodes}
                    childMap={childMap}
                    onDrillDown={(node) => setTreeSheet(node)}
                    onSelectResource={setDetailResource}
                  />
                </View>
              ))}
            </Section>
          )}

          {/* Images */}
          {images.length > 0 && (
            <Section title={`IMAGES · ${images.length}`}>
              {images.map((img, i) => (
                <View
                  key={img}
                  style={[
                    styles.detailRow,
                    i < images.length - 1 && styles.detailRowBorder,
                  ]}
                >
                  <Text
                    style={[styles.detailValue, styles.detailMono, { flex: 1 }]}
                    numberOfLines={2}
                  >
                    {img}
                  </Text>
                </View>
              ))}
            </Section>
          )}

          {/* External URLs */}
          {externalURLs.length > 0 && (
            <Section title="EXTERNAL URLS">
              {externalURLs.map((url, i) => (
                <TouchableOpacity
                  key={url}
                  style={[
                    styles.detailRow,
                    i < externalURLs.length - 1 && styles.detailRowBorder,
                  ]}
                  onPress={() => void Linking.openURL(url)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[styles.detailValue, styles.linkText]}
                    numberOfLines={1}
                  >
                    {url}
                  </Text>
                  <Ionicons
                    name="open-outline"
                    size={14}
                    color={colors.orange}
                  />
                </TouchableOpacity>
              ))}
            </Section>
          )}

          {/* Conditions */}
          {app.status?.conditions && app.status.conditions.length > 0 && (
            <Section title={`CONDITIONS · ${app.status.conditions.length}`}>
              {app.status.conditions.map((c, i) => (
                <View
                  key={`${c.type}-${i}`}
                  style={[
                    styles.conditionRow,
                    i < app.status.conditions!.length - 1 &&
                      styles.detailRowBorder,
                  ]}
                >
                  <Text style={styles.conditionType}>{c.type}</Text>
                  <Text style={styles.conditionMessage} numberOfLines={3}>
                    {c.message}
                  </Text>
                </View>
              ))}
            </Section>
          )}
        </ScrollView>
      )}

      {app && (
        <SyncSheet
          visible={syncSheetOpen}
          onClose={() => setSyncSheetOpen(false)}
          app={app}
          onSync={async (opts) => {
            try {
              await client.syncApplication(name, namespace, opts);
            } catch (e) {
              Alert.alert(
                "Sync failed",
                e instanceof Error ? e.message : String(e),
              );
              throw e;
            }
          }}
        />
      )}

      <ResourceTreeSheet
        visible={treeSheet !== null}
        onClose={() => setTreeSheet(null)}
        rootNode={treeSheet}
        childMap={childMap}
        appName={name}
        appNamespace={namespace}
      />

      <ResourceDetailSheet
        visible={detailResource !== null}
        onClose={() => setDetailResource(null)}
        appName={name}
        appNamespace={namespace}
        resource={detailResource}
      />

      <ResourceFilterSheet
        visible={showResourceFilter}
        onClose={() => setShowResourceFilter(false)}
        state={resourceFilter}
        setState={setResourceFilter}
        allKinds={allResourceKinds}
        allNamespaces={allResourceNamespaces}
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
    paddingBottom: 14,
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
  menuBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    marginRight: 8,
  },
  menuDot: {
    width: 3.5,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: colors.text,
  },
  headerAppInfo: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  headerProject: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: colors.faint,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  headerAppName: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.4,
    lineHeight: 27,
  },

  // Status tiles
  tilesRow: {
    flexDirection: "row",
    gap: 10,
  },
  statusTile: {
    flex: 1,
    backgroundColor: "#1C2140",
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    paddingBottom: 12,
    overflow: "hidden",
  },
  statusGlow: {
    position: "absolute",
    top: -30,
    right: -30,
    width: 90,
    height: 90,
    borderRadius: 45,
    opacity: 0.13,
  },
  statusTileKind: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: colors.faint,
  },
  statusTileValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  statusTileValue: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  statusTileSubtitle: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 4,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },

  // Action row
  actionRow: {
    flexDirection: "row",
    gap: 8,
  },
  actionBtnPrimary: {
    height: 56,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  actionBtnGhost: {
    flex: 1,
    height: 56,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  actionBtnDimmed: {
    opacity: 0.45,
  },
  actionLabelPrimary: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.1,
    color: "#fff",
  },
  actionLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.1,
    color: colors.text,
  },

  // Loading
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    fontSize: 15,
    color: colors.muted,
  },

  // Scroll
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 16,
    paddingHorizontal: 16,
    gap: 12,
  },

  // Section
  section: {
    gap: 6,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 4,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    color: colors.faint,
    textTransform: "uppercase",
  },
  treeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  treeBtnActive: {
    backgroundColor: "rgba(239,123,77,0.10)",
    borderColor: "rgba(239,123,77,0.40)",
  },
  treeBtnText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.orange,
  },
  card: {
    backgroundColor: "#1C2140",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: "hidden",
  },

  // Detail rows
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 8,
  },
  detailRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.muted,
    width: 72,
    flexShrink: 0,
  },
  detailValue: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
  },
  detailMono: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
  },
  messageText: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 18,
  },
  linkText: {
    color: colors.orange,
    textDecorationLine: "underline",
  },

  // Phase
  phaseRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  phaseText: {
    fontSize: 13,
    fontWeight: "600",
  },

  // Resources
  resourceGroup: {
    gap: 0,
  },
  groupDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    marginBottom: 0,
  },
  resourceGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  resourceGroupKind: {
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
    color: colors.muted,
    letterSpacing: 0.2,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  resourceGroupCount: {
    fontSize: 11,
    color: colors.faint,
    fontWeight: "500",
  },
  resourceRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    paddingLeft: 32,
    gap: 8,
  },
  resourceLeft: {
    flex: 1,
    minWidth: 0,
  },
  resourceName: {
    fontSize: 13,
    color: colors.text,
    fontWeight: "500",
  },
  resourceNs: {
    fontSize: 11,
    color: colors.faint,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginTop: 1,
  },
  resourceStatus: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
  },
  resourceDrillBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: 6,
  },
  resourceChildBadge: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  resourceChildBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: colors.muted,
  },

  // Conditions
  conditionRow: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 4,
  },
  conditionType: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.muted,
    letterSpacing: 0.2,
  },
  conditionMessage: {
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
  },
});
