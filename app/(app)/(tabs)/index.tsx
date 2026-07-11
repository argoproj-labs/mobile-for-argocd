import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActivityIndicator,
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
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { colors } from "../../../lib/theme";
import { appKey, appSource, type Application } from "../../../lib/api";
import { favoritesStorage } from "../../../lib/storage";
import { useArgoClient } from "../../../lib/client";
import { getHealth, getSync, healthSeverity } from "../../../lib/status";

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

function isAutoSync(app: Application): boolean {
  return !!app.spec.syncPolicy?.automated;
}

// ── Status pill ────────────────────────────────────────────────
function StatusPill({
  kind,
  status,
}: {
  kind: "health" | "sync";
  status: string;
}) {
  const t = kind === "health" ? getHealth(status) : getSync(status);
  return (
    <View
      style={[styles.pill, { backgroundColor: t.bg, borderColor: t.border }]}
    >
      <Ionicons name={t.icon} size={11} color={t.color} />
      <Text style={[styles.pillText, { color: t.color }]}>{status}</Text>
    </View>
  );
}

// ── App card ──────────────────────────────────────────────────
interface AppCardProps {
  app: Application;
  isFav: boolean;
  onPress: () => void;
  onToggleFav: (key: string) => void;
}

function AppCard({ app, isFav, onPress, onToggleFav }: AppCardProps) {
  const src = appSource(app);
  const key = appKey(app);
  const auto = isAutoSync(app);

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={styles.card}>
      {/* Row 1: icon + name + fav */}
      <View style={styles.cardRow}>
        <View style={styles.appIcon}>
          <Ionicons name="cube-outline" size={14} color={colors.orange} />
        </View>
        <View style={styles.cardNameBlock}>
          <Text style={styles.cardName} numberOfLines={2}>
            {app.metadata.name}
          </Text>
          <Text style={styles.cardProject}>{app.spec.project}</Text>
        </View>
        <TouchableOpacity
          onPress={() => onToggleFav(key)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name={isFav ? "star" : "star-outline"}
            size={18}
            color={isFav ? "#F2C94C" : colors.faint}
          />
        </TouchableOpacity>
      </View>

      {/* Row 2: pills */}
      <View style={styles.cardPills}>
        <StatusPill
          kind="health"
          status={app.status?.health?.status ?? "Unknown"}
        />
        <StatusPill
          kind="sync"
          status={app.status?.sync?.status ?? "Unknown"}
        />
        {auto && (
          <View
            style={[
              styles.pill,
              {
                backgroundColor: "rgba(59,150,226,0.14)",
                borderColor: "rgba(59,150,226,0.40)",
              },
            ]}
          >
            <Ionicons name="flash" size={11} color="#3B96E2" />
            <Text style={[styles.pillText, { color: "#3B96E2" }]}>Auto</Text>
          </View>
        )}
      </View>

      {/* Row 3: meta */}
      <View style={styles.cardMeta}>
        <MetaRow label="Repo" value={src ? shortRepo(src.repoURL) : "—"} mono />
        <MetaRow label="Target" value={src?.targetRevision ?? "—"} mono />
        <MetaRow label="Cluster" value={destLabel(app)} mono />
        <MetaRow
          label="Last sync"
          value={timeAgo(app.status?.operationState?.finishedAt)}
        />
      </View>
    </TouchableOpacity>
  );
}

function MetaRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text
        style={[styles.metaValue, mono && styles.metaMono]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </>
  );
}

// ── Health bar ─────────────────────────────────────────────────
function HealthBar({ counts }: { counts: Record<string, number> }) {
  const order = [
    "Healthy",
    "Progressing",
    "Suspended",
    "Degraded",
    "Missing",
    "Unknown",
  ];
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return (
    <View style={styles.healthBar}>
      {order.map((k) => {
        const n = counts[k] ?? 0;
        if (!n) return null;
        return (
          <View
            key={k}
            style={{ flex: n / total, backgroundColor: getHealth(k).color }}
          />
        );
      })}
    </View>
  );
}

// ── Search field ───────────────────────────────────────────────
function SearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <View style={styles.searchBar}>
      <Ionicons name="search" size={14} color={colors.muted} />
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChange}
        placeholder="Search applications"
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardAppearance="dark"
        clearButtonMode="while-editing"
      />
      {!!value && Platform.OS !== "ios" && (
        <TouchableOpacity onPress={() => onChange("")}>
          <Ionicons name="close-circle" size={16} color={colors.muted} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Filter pill components ────────────────────────────────────

function FavChip({ on, onPress }: { on: boolean; onPress: () => void }) {
  const accent = "#F2C94C";
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.filterPill,
        {
          backgroundColor: on ? accent + "24" : "rgba(255,255,255,0.05)",
          borderColor: on ? accent + "88" : colors.hairline,
        },
      ]}
      activeOpacity={0.7}
    >
      <Ionicons
        name={on ? "star" : "star-outline"}
        size={14}
        color={on ? accent : colors.muted}
      />
    </TouchableOpacity>
  );
}

function DropdownChip({
  label,
  open,
  onPress,
}: {
  label: string;
  open: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.filterPill}
      activeOpacity={0.7}
    >
      <Text style={styles.filterPillText}>{label}</Text>
      <Ionicons
        name={open ? "chevron-up" : "chevron-down"}
        size={11}
        color={colors.muted}
      />
    </TouchableOpacity>
  );
}

function ActivePill({
  icon,
  label,
  count,
  accent,
  onPress,
  onClear,
}: {
  icon?: React.ReactNode;
  label: string;
  count?: number;
  accent: string;
  onPress: () => void;
  onClear: () => void;
}) {
  return (
    <View
      style={[
        styles.activePill,
        { backgroundColor: accent + "24", borderColor: accent + "66" },
      ]}
    >
      <TouchableOpacity
        onPress={onPress}
        style={styles.activePillLeft}
        activeOpacity={0.7}
      >
        {icon}
        <Text style={[styles.activePillLabel, { color: accent }]}>{label}</Text>
        {count != null && (
          <Text style={[styles.activePillCount, { color: accent }]}>
            {count}
          </Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onClear}
        style={styles.activePillClear}
        hitSlop={{ top: 6, bottom: 6, left: 0, right: 6 }}
        activeOpacity={0.7}
      >
        <Ionicons name="close" size={10} color={accent} />
      </TouchableOpacity>
    </View>
  );
}

// ── Label expansion ───────────────────────────────────────────

const LABEL_ACCENT = "#5CD1A0";

function LabelExpansion({
  filters,
  labelMap,
  onAdd,
  onRemove,
}: {
  filters: string[];
  labelMap: Map<string, string[]>;
  onAdd: (f: string) => void;
  onRemove: (f: string) => void;
}) {
  const [input, setInput] = useState("");
  const eqIdx = input.indexOf("=");
  const inputKey = eqIdx >= 0 ? input.slice(0, eqIdx) : input;
  const inputVal = eqIdx >= 0 ? input.slice(eqIdx + 1) : null;

  const suggestions = (() => {
    if (eqIdx === -1) {
      const q = input.toLowerCase();
      const keys = Array.from(labelMap.keys())
        .filter((k) => !q || k.toLowerCase().includes(q))
        .slice(0, 5);
      return keys
        .flatMap((k) =>
          (labelMap.get(k) ?? [])
            .slice(0, 2)
            .filter((v) => !filters.includes(`${k}=${v}`))
            .map((v) => ({
              text: `${k}=${v}`,
              onTap: () => {
                onAdd(`${k}=${v}`);
                setInput("");
              },
            })),
        )
        .slice(0, 8);
    }
    const vals = labelMap.get(inputKey) ?? [];
    const q = inputVal!.toLowerCase();
    return vals
      .filter((v) => !q || v.toLowerCase().includes(q))
      .filter((v) => !filters.includes(`${inputKey}=${v}`))
      .slice(0, 8)
      .map((v) => ({
        text: v,
        onTap: () => {
          onAdd(`${inputKey}=${v}`);
          setInput("");
        },
      }));
  })();

  const trimmed = input.trim();
  const canSubmit =
    trimmed.length > 0 &&
    !trimmed.startsWith("=") &&
    !trimmed.endsWith("=") &&
    !filters.includes(trimmed);

  const handleSubmit = () => {
    if (!canSubmit) return;
    onAdd(trimmed);
    setInput("");
  };

  return (
    <View style={styles.labelExpansion}>
      {filters.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.labelFiltersRow}
          keyboardShouldPersistTaps="handled"
        >
          {filters.map((f) => (
            <View key={f} style={styles.labelFilterChip}>
              <Text style={styles.labelFilterText}>{f}</Text>
              <TouchableOpacity
                onPress={() => onRemove(f)}
                hitSlop={{ top: 4, bottom: 4, left: 0, right: 6 }}
              >
                <Ionicons name="close" size={9} color={colors.muted} />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}
      <View style={styles.labelInputRow}>
        <Ionicons name="pricetag-outline" size={13} color={colors.muted} />
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={handleSubmit}
          placeholder="key  or  key=value"
          placeholderTextColor={colors.faint}
          style={styles.labelInput}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardAppearance="dark"
          returnKeyType="done"
        />
        {canSubmit && (
          <TouchableOpacity
            onPress={handleSubmit}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons
              name="return-down-back-outline"
              size={16}
              color={colors.orange}
            />
          </TouchableOpacity>
        )}
      </View>
      {suggestions.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.labelSuggestRow}
          keyboardShouldPersistTaps="handled"
        >
          {suggestions.map((s, i) => (
            <TouchableOpacity
              key={i}
              onPress={s.onTap}
              style={styles.labelSuggestChip}
              activeOpacity={0.7}
            >
              <Text style={styles.labelSuggestText}>{s.text}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// ── Bottom sheet ───────────────────────────────────────────────
function BottomSheet({
  visible,
  onClose,
  title,
  height,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  height: number;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.sheetContainer}>
        <TouchableOpacity
          style={[styles.sheetBackdrop]}
          onPress={onClose}
          activeOpacity={1}
        />
        <View
          style={[styles.sheet, { height, paddingBottom: insets.bottom + 16 }]}
        >
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={{ width: 60 }} />
            <Text style={styles.sheetTitle}>{title}</Text>
            <TouchableOpacity
              onPress={onClose}
              style={{ width: 60, alignItems: "flex-end" }}
            >
              <Text style={styles.sheetDone}>Done</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 16 }}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Sort sheet ─────────────────────────────────────────────────
type SortKey = "name" | "lastSync" | "health" | "project";

const SORT_OPTS: { key: SortKey; label: string; sub: string }[] = [
  { key: "name", label: "Name", sub: "A → Z" },
  { key: "lastSync", label: "Last sync", sub: "Most recent first" },
  { key: "health", label: "Health", sub: "Worst first" },
  { key: "project", label: "Project", sub: "Grouped" },
];

function SortSheet({
  visible,
  onClose,
  sortKey,
  setSortKey,
}: {
  visible: boolean;
  onClose: () => void;
  sortKey: SortKey;
  setSortKey: (k: SortKey) => void;
}) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Sort by"
      height={340}
    >
      <View style={styles.filterCard}>
        {SORT_OPTS.map((o, i) => (
          <TouchableOpacity
            key={o.key}
            onPress={() => {
              setSortKey(o.key);
              onClose();
            }}
            style={[
              styles.filterRow,
              i < SORT_OPTS.length - 1 && styles.filterRowBorder,
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.filterRowLabel}>{o.label}</Text>
              <Text style={styles.filterRowSub}>{o.sub}</Text>
            </View>
            {sortKey === o.key && (
              <Ionicons name="checkmark" size={20} color={colors.orange} />
            )}
          </TouchableOpacity>
        ))}
      </View>
    </BottomSheet>
  );
}

// ── Empty state ────────────────────────────────────────────────
function EmptyState({
  hasFilters,
  onClear,
}: {
  hasFilters: boolean;
  onClear: () => void;
}) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <Ionicons name="search" size={22} color={colors.muted} />
      </View>
      <Text style={styles.emptyTitle}>No matching apps</Text>
      <Text style={styles.emptyBody}>
        Try a different search term or clear the active filter.
      </Text>
      {hasFilters && (
        <TouchableOpacity onPress={onClear} style={styles.clearBtn}>
          <Text style={styles.clearBtnText}>Clear filters</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const PAGE_SIZE = 20;

// ── Page footer ────────────────────────────────────────────────
function ListFooter({
  hasMore,
  total,
  shown,
}: {
  hasMore: boolean;
  total: number;
  shown: number;
}) {
  if (!hasMore) {
    if (total === 0) return null;
    return (
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {total} app{total !== 1 ? "s" : ""}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.footer}>
      <ActivityIndicator size="small" color={colors.muted} />
      <Text style={styles.footerText}>
        {shown} of {total}
      </Text>
    </View>
  );
}

// ── Apps list screen ───────────────────────────────────────────
export default function AppsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const client = useArgoClient();
  const queryClient = useQueryClient();

  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [favOn, setFavOn] = useState(false);
  const [syncSel, setSyncSel] = useState<string[]>([]);
  const [healthSel, setHealthSel] = useState<string[]>([]);
  const [projectSel, setProjectSel] = useState<string[]>([]);
  const [namespaceSel, setNamespaceSel] = useState<string[]>([]);
  const [labelFilters, setLabelFilters] = useState<string[]>([]);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [showSort, setShowSort] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const abortRef = useRef<AbortController | null>(null);

  // Load favorites on mount; abort watch on unmount
  useEffect(() => {
    favoritesStorage.get(client.accountId).then(setFavorites);
    return () => {
      abortRef.current?.abort();
    };
  }, [client.accountId]);

  // Initial list fetch — react-query owns loading/error/data
  const queryKey = client.queryKeys.applications();
  const {
    data,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey,
    queryFn: () => client.listApplications(),
  });

  const apps = useMemo(() => data?.items ?? [], [data]);

  // Live watch — starts once the initial list succeeds, updates the query cache
  useEffect(() => {
    const rv = data?.resourceVersion;
    if (!rv) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const watch = async () => {
      try {
        await client.watchApplications(
          rv,
          (type, app) => {
            if (ctrl.signal.aborted) return;
            queryClient.setQueryData<{
              items: Application[];
              resourceVersion: string;
            }>(queryKey, (prev) => {
              if (!prev) return prev;
              const key = appKey(app);
              const idx = prev.items.findIndex((a) => appKey(a) === key);
              if (type === "DELETED") {
                return {
                  ...prev,
                  items:
                    idx >= 0
                      ? prev.items.filter((_, i) => i !== idx)
                      : prev.items,
                };
              }
              const items =
                idx >= 0
                  ? prev.items.map((a, i) => (i === idx ? app : a))
                  : [app, ...prev.items];
              return { ...prev, items };
            });
          },
          ctrl.signal,
        );
      } catch {
        if (ctrl.signal.aborted) return;
        // Invalidate so react-query re-fetches the list and restarts the watch
        void queryClient.invalidateQueries({ queryKey });
      }
    };

    void watch();
    return () => {
      ctrl.abort();
    };
  }, [data?.resourceVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Favorites toggle
  const toggleFav = useCallback(
    (key: string) => {
      setFavorites((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        favoritesStorage.set(client.accountId, next);
        return next;
      });
    },
    [client.accountId],
  );

  // Health/sync counts (for bar + chips + filter badges)
  const healthCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of apps) {
      const h = a.status?.health?.status ?? "Unknown";
      c[h] = (c[h] ?? 0) + 1;
    }
    return c;
  }, [apps]);

  const syncCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of apps) {
      const s = a.status?.sync?.status ?? "Unknown";
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [apps]);

  const projectCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of apps) c[a.spec.project] = (c[a.spec.project] ?? 0) + 1;
    return c;
  }, [apps]);

  const namespaceCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of apps) {
      const ns = a.metadata.namespace ?? "";
      c[ns] = (c[ns] ?? 0) + 1;
    }
    return c;
  }, [apps]);

  const availableProjects = useMemo(
    () => Array.from(new Set(apps.map((a) => a.spec.project))).sort(),
    [apps],
  );

  const availableNamespaces = useMemo(
    () =>
      Array.from(
        new Set(apps.map((a) => a.metadata.namespace).filter(Boolean)),
      ).sort() as string[],
    [apps],
  );

  const availableLabelMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const a of apps) {
      for (const [k, v] of Object.entries(a.metadata.labels ?? {})) {
        if (!m.has(k)) m.set(k, new Set());
        m.get(k)!.add(v);
      }
    }
    const result = new Map<string, string[]>();
    for (const [k, vs] of m) result.set(k, Array.from(vs).sort());
    return result;
  }, [apps]);

  const addLabelFilter = useCallback(
    (f: string) =>
      setLabelFilters((prev) => [...prev.filter((x) => x !== f), f]),
    [],
  );
  const removeLabelFilter = useCallback(
    (f: string) => setLabelFilters((prev) => prev.filter((x) => x !== f)),
    [],
  );

  // Filter + sort — full list (used for counts and pagination source)
  const filteredSortedApps = useMemo(() => {
    let list = apps;

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          a.metadata.name.toLowerCase().includes(q) ||
          a.spec.project.toLowerCase().includes(q) ||
          destLabel(a).toLowerCase().includes(q),
      );
    }

    if (favOn) list = list.filter((a) => favorites.has(appKey(a)));

    if (syncSel.length > 0)
      list = list.filter((a) =>
        syncSel.includes(a.status?.sync?.status ?? "Unknown"),
      );

    if (healthSel.length > 0)
      list = list.filter((a) =>
        healthSel.includes(a.status?.health?.status ?? "Unknown"),
      );

    if (projectSel.length > 0)
      list = list.filter((a) => projectSel.includes(a.spec.project));

    if (namespaceSel.length > 0)
      list = list.filter((a) =>
        namespaceSel.includes(a.metadata.namespace ?? ""),
      );

    if (labelFilters.length > 0) {
      list = list.filter((a) => {
        const labels = a.metadata.labels ?? {};
        return labelFilters.every((f) => {
          const eqIdx = f.indexOf("=");
          if (eqIdx === -1) return f in labels;
          return labels[f.slice(0, eqIdx)] === f.slice(eqIdx + 1);
        });
      });
    }

    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.metadata.name.localeCompare(b.metadata.name);
        case "project":
          return (
            a.spec.project.localeCompare(b.spec.project) ||
            a.metadata.name.localeCompare(b.metadata.name)
          );
        case "lastSync": {
          const ta = a.status?.operationState?.finishedAt ?? "";
          const tb = b.status?.operationState?.finishedAt ?? "";
          return tb.localeCompare(ta);
        }
        case "health":
          return (
            healthSeverity(a.status?.health?.status ?? "Unknown") -
            healthSeverity(b.status?.health?.status ?? "Unknown")
          );
        default:
          return 0;
      }
    });

    return list;
  }, [
    apps,
    search,
    favOn,
    syncSel,
    healthSel,
    projectSel,
    namespaceSel,
    labelFilters,
    favorites,
    sortKey,
  ]);

  // Reset to first page whenever the filtered set changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [
    search,
    favOn,
    syncSel,
    healthSel,
    projectSel,
    namespaceSel,
    labelFilters,
    sortKey,
  ]);

  // Paginated slice passed to FlatList
  const visibleApps = useMemo(
    () => filteredSortedApps.slice(0, visibleCount),
    [filteredSortedApps, visibleCount],
  );
  const hasMore = visibleCount < filteredSortedApps.length;

  const hasFilters =
    search !== "" ||
    favOn ||
    syncSel.length > 0 ||
    healthSel.length > 0 ||
    projectSel.length > 0 ||
    namespaceSel.length > 0 ||
    labelFilters.length > 0;

  const clearAll = useCallback(() => {
    setSearch("");
    setFavOn(false);
    setSyncSel([]);
    setHealthSel([]);
    setProjectSel([]);
    setNamespaceSel([]);
    setLabelFilters([]);
    setOpenGroup(null);
  }, []);

  const serverName = client.hostname;

  // Header rendered as FlatList's ListHeaderComponent
  const ListHeader = useMemo(
    () => (
      <View style={[styles.header, { paddingTop: insets.top }]}>
        {/* Nav row */}
        <View style={styles.navRow}>
          <View style={styles.serverBtn}>
            <Text style={styles.serverName} numberOfLines={1}>
              {serverName}
            </Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => setShowSort(true)}
            >
              <Ionicons name="reorder-three" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Large title */}
        <View style={styles.titleRow}>
          <Text style={styles.largeTitle}>Applications</Text>
          {isLoading ? (
            <ActivityIndicator
              size="small"
              color={colors.muted}
              style={{ marginLeft: 8 }}
            />
          ) : (
            <Text style={styles.appCount}>{apps.length}</Text>
          )}
        </View>

        {/* Search */}
        <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
          <SearchField value={search} onChange={setSearch} />
        </View>

        {/* Filter pill row */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillRow}
          keyboardShouldPersistTaps="handled"
        >
          <FavChip on={favOn} onPress={() => setFavOn((v) => !v)} />

          {syncSel.length === 0 ? (
            <DropdownChip
              label="Sync"
              open={openGroup === "sync"}
              onPress={() =>
                setOpenGroup((g) => (g === "sync" ? null : "sync"))
              }
            />
          ) : syncSel.length === 1 ? (
            <ActivePill
              icon={
                <Ionicons
                  name={getSync(syncSel[0]).icon}
                  size={11}
                  color={getSync(syncSel[0]).color}
                />
              }
              label={syncSel[0]}
              count={syncCounts[syncSel[0]]}
              accent={getSync(syncSel[0]).color}
              onPress={() =>
                setOpenGroup((g) => (g === "sync" ? null : "sync"))
              }
              onClear={() => {
                setSyncSel([]);
                setOpenGroup(null);
              }}
            />
          ) : (
            <ActivePill
              label={`Sync · ${syncSel.length}`}
              accent={colors.orange}
              onPress={() =>
                setOpenGroup((g) => (g === "sync" ? null : "sync"))
              }
              onClear={() => {
                setSyncSel([]);
                setOpenGroup(null);
              }}
            />
          )}

          {healthSel.length === 0 ? (
            <DropdownChip
              label="Health"
              open={openGroup === "health"}
              onPress={() =>
                setOpenGroup((g) => (g === "health" ? null : "health"))
              }
            />
          ) : healthSel.length === 1 ? (
            <ActivePill
              icon={
                <Ionicons
                  name={getHealth(healthSel[0]).icon}
                  size={11}
                  color={getHealth(healthSel[0]).color}
                />
              }
              label={healthSel[0]}
              count={healthCounts[healthSel[0]]}
              accent={getHealth(healthSel[0]).color}
              onPress={() =>
                setOpenGroup((g) => (g === "health" ? null : "health"))
              }
              onClear={() => {
                setHealthSel([]);
                setOpenGroup(null);
              }}
            />
          ) : (
            <ActivePill
              label={`Health · ${healthSel.length}`}
              accent={colors.orange}
              onPress={() =>
                setOpenGroup((g) => (g === "health" ? null : "health"))
              }
              onClear={() => {
                setHealthSel([]);
                setOpenGroup(null);
              }}
            />
          )}

          {projectSel.length === 0 ? (
            <DropdownChip
              label="Project"
              open={openGroup === "projects"}
              onPress={() =>
                setOpenGroup((g) => (g === "projects" ? null : "projects"))
              }
            />
          ) : (
            <ActivePill
              label={
                projectSel.length === 1
                  ? projectSel[0]
                  : `Project · ${projectSel.length}`
              }
              accent="#7DA9F1"
              onPress={() =>
                setOpenGroup((g) => (g === "projects" ? null : "projects"))
              }
              onClear={() => {
                setProjectSel([]);
                setOpenGroup(null);
              }}
            />
          )}

          {namespaceSel.length === 0 ? (
            <DropdownChip
              label="Namespace"
              open={openGroup === "namespaces"}
              onPress={() =>
                setOpenGroup((g) => (g === "namespaces" ? null : "namespaces"))
              }
            />
          ) : (
            <ActivePill
              label={
                namespaceSel.length === 1
                  ? namespaceSel[0]
                  : `Namespace · ${namespaceSel.length}`
              }
              accent="#B79CFF"
              onPress={() =>
                setOpenGroup((g) => (g === "namespaces" ? null : "namespaces"))
              }
              onClear={() => {
                setNamespaceSel([]);
                setOpenGroup(null);
              }}
            />
          )}

          {labelFilters.length === 0 ? (
            <DropdownChip
              label="Labels"
              open={openGroup === "labels"}
              onPress={() =>
                setOpenGroup((g) => (g === "labels" ? null : "labels"))
              }
            />
          ) : (
            <ActivePill
              icon={
                <Ionicons
                  name="pricetag-outline"
                  size={11}
                  color={LABEL_ACCENT}
                />
              }
              label={`Labels · ${labelFilters.length}`}
              accent={LABEL_ACCENT}
              onPress={() =>
                setOpenGroup((g) => (g === "labels" ? null : "labels"))
              }
              onClear={() => {
                setLabelFilters([]);
                setOpenGroup(null);
              }}
            />
          )}
        </ScrollView>

        {/* Expansion strip */}
        {openGroup !== null && (
          <View style={styles.expansionStrip}>
            {openGroup === "labels" ? (
              <LabelExpansion
                filters={labelFilters}
                labelMap={availableLabelMap}
                onAdd={addLabelFilter}
                onRemove={removeLabelFilter}
              />
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.expansionRail}
                keyboardShouldPersistTaps="handled"
              >
                {(openGroup === "sync"
                  ? ["Synced", "OutOfSync", "Unknown"]
                  : openGroup === "health"
                    ? [
                        "Healthy",
                        "Progressing",
                        "Degraded",
                        "Missing",
                        "Suspended",
                        "Unknown",
                      ]
                    : openGroup === "projects"
                      ? availableProjects
                      : availableNamespaces
                ).map((v) => {
                  const isStatus =
                    openGroup === "sync" || openGroup === "health";
                  const t = isStatus
                    ? openGroup === "sync"
                      ? getSync(v)
                      : getHealth(v)
                    : null;
                  const accent =
                    openGroup === "projects" ? "#7DA9F1" : "#B79CFF";
                  const chipColor = t ? t.color : accent;
                  const sel =
                    openGroup === "sync"
                      ? syncSel
                      : openGroup === "health"
                        ? healthSel
                        : openGroup === "projects"
                          ? projectSel
                          : namespaceSel;
                  const cnt =
                    openGroup === "sync"
                      ? (syncCounts[v] ?? 0)
                      : openGroup === "health"
                        ? (healthCounts[v] ?? 0)
                        : openGroup === "projects"
                          ? (projectCounts[v] ?? 0)
                          : (namespaceCounts[v] ?? 0);
                  const on = sel.includes(v);
                  return (
                    <TouchableOpacity
                      key={v}
                      onPress={() => {
                        const toggle = (prev: string[]) =>
                          prev.includes(v)
                            ? prev.filter((x) => x !== v)
                            : [...prev, v];
                        if (openGroup === "sync") setSyncSel(toggle);
                        else if (openGroup === "health") setHealthSel(toggle);
                        else if (openGroup === "projects")
                          setProjectSel(toggle);
                        else setNamespaceSel(toggle);
                      }}
                      style={[
                        styles.expansionChip,
                        {
                          backgroundColor: on
                            ? chipColor + "24"
                            : "rgba(255,255,255,0.05)",
                          borderColor: on ? chipColor + "88" : colors.hairline,
                        },
                      ]}
                      activeOpacity={0.7}
                    >
                      {t && (
                        <Ionicons
                          name={t.icon}
                          size={10}
                          color={on ? t.color : colors.muted}
                        />
                      )}
                      <Text
                        style={[
                          styles.expansionChipText,
                          { color: on ? chipColor : colors.text },
                        ]}
                      >
                        {v}
                      </Text>
                      <Text
                        style={[
                          styles.expansionChipCount,
                          { color: on ? chipColor : colors.faint },
                        ]}
                      >
                        {cnt}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        )}

        {/* Health bar */}
        {apps.length > 0 && (
          <View style={styles.healthBarRow}>
            <HealthBar counts={healthCounts} />
          </View>
        )}

        <View style={styles.headerBorder} />
      </View>
    ),
    [
      insets.top,
      serverName,
      apps.length,
      isLoading,
      healthCounts,
      syncCounts,
      projectCounts,
      namespaceCounts,
      availableProjects,
      availableNamespaces,
      availableLabelMap,
      search,
      favOn,
      syncSel,
      healthSel,
      projectSel,
      namespaceSel,
      labelFilters,
      openGroup,
      addLabelFilter,
      removeLabelFilter,
    ],
  );

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {queryError && !isLoading && (
        <View style={[styles.errorBanner, { paddingTop: insets.top + 8 }]}>
          <Ionicons name="alert-circle" size={14} color={colors.danger} />
          <Text style={styles.errorText}>
            {queryError instanceof Error
              ? queryError.message
              : "Failed to load"}{" "}
            — retrying…
          </Text>
        </View>
      )}

      <FlatList
        data={visibleApps}
        keyExtractor={(a) => appKey(a)}
        renderItem={({ item }) => (
          <AppCard
            app={item}
            isFav={favorites.has(appKey(item))}
            onPress={() =>
              router.push({
                pathname: "/(app)/details",
                params: {
                  name: item.metadata.name,
                  namespace: item.metadata.namespace,
                },
              })
            }
            onToggleFav={toggleFav}
          />
        )}
        contentContainerStyle={[
          styles.listContent,
          filteredSortedApps.length === 0 && { flexGrow: 1 },
        ]}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={
          isLoading ? null : (
            <EmptyState hasFilters={hasFilters} onClear={clearAll} />
          )
        }
        ListFooterComponent={
          <ListFooter
            hasMore={hasMore}
            total={filteredSortedApps.length}
            shown={visibleApps.length}
          />
        }
        onEndReached={() => {
          if (hasMore) setVisibleCount((c) => c + PAGE_SIZE);
        }}
        onEndReachedThreshold={0.4}
        initialNumToRender={PAGE_SIZE}
        maxToRenderPerBatch={10}
        windowSize={5}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />

      <SortSheet
        visible={showSort}
        onClose={() => setShowSort(false)}
        sortKey={sortKey}
        setSortKey={setSortKey}
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
    backgroundColor: "#171B33",
  },
  headerBorder: {
    height: 1,
    backgroundColor: colors.hairline,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  serverBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    padding: 8,
  },
  serverName: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.orange,
    letterSpacing: -0.2,
    maxWidth: 200,
  },
  headerActions: {
    flexDirection: "row",
    gap: 8,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    paddingHorizontal: 20,
    paddingBottom: 8,
    paddingTop: 4,
    gap: 10,
  },
  largeTitle: {
    fontSize: 32,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.6,
  },
  appCount: {
    fontSize: 14,
    color: colors.muted,
    fontWeight: "500",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },

  // Health bar
  healthBarRow: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
  },
  healthBar: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.06)",
  },

  // Search
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 36,
    paddingHorizontal: 10,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    letterSpacing: -0.2,
    padding: 0,
    margin: 0,
  },

  // Filter pills
  pillRow: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    paddingTop: 2,
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    height: 34,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: "rgba(255,255,255,0.05)",
    gap: 5,
    flexShrink: 0,
  },
  filterPillText: {
    fontSize: 12.5,
    fontWeight: "600",
    color: colors.text,
    letterSpacing: -0.1,
  },
  activePill: {
    flexDirection: "row",
    alignItems: "stretch",
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    overflow: "hidden",
    flexShrink: 0,
  },
  activePillLeft: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 10,
    paddingRight: 4,
    gap: 5,
  },
  activePillLabel: {
    fontSize: 12.5,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
  activePillCount: {
    fontSize: 10,
    fontWeight: "500",
    opacity: 0.7,
  },
  activePillClear: {
    paddingHorizontal: 9,
    alignItems: "center",
    justifyContent: "center",
  },

  // Expansion strip
  expansionStrip: {
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    backgroundColor: "rgba(255,255,255,0.025)",
  },
  expansionRail: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    flexDirection: "row",
  },
  expansionChip: {
    flexDirection: "row",
    alignItems: "center",
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    gap: 5,
    flexShrink: 0,
  },
  expansionChipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  expansionChipCount: {
    fontSize: 10,
    fontWeight: "500",
    opacity: 0.65,
  },

  // Label expansion
  labelExpansion: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 8,
  },
  labelFiltersRow: {
    flexDirection: "row",
    gap: 6,
    paddingBottom: 4,
  },
  labelFilterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#5CD1A020",
    borderWidth: 1,
    borderColor: "#5CD1A060",
  },
  labelFilterText: {
    fontSize: 11.5,
    fontWeight: "600",
    color: "#5CD1A0",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  labelInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 34,
    paddingHorizontal: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 8,
  },
  labelInput: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    padding: 0,
    margin: 0,
  },
  labelSuggestRow: {
    flexDirection: "row",
    gap: 6,
    paddingTop: 4,
  },
  labelSuggestChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  labelSuggestText: {
    fontSize: 11.5,
    color: colors.text,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },

  // List
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 96,
    gap: 12,
  },

  // Card
  card: {
    backgroundColor: "#1C2140",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: 16,
    gap: 12,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  appIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "rgba(239,123,77,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,123,77,0.3)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  cardNameBlock: {
    flex: 1,
    minWidth: 0,
  },
  cardName: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
    letterSpacing: -0.2,
    lineHeight: 20,
  },
  cardProject: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  cardPills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  cardMeta: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    rowGap: 6,
    columnGap: 8,
  },
  metaLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.faint,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    width: 52,
    paddingTop: 1,
  },
  metaValue: {
    fontSize: 12,
    color: colors.text,
    flex: 1,
    minWidth: 80,
  },
  metaMono: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 11,
  },

  // Error banner
  errorBanner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: "rgba(242,93,93,0.15)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(242,93,93,0.3)",
  },
  errorText: {
    fontSize: 12,
    color: colors.danger,
    flex: 1,
  },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 48,
    gap: 12,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
  },
  emptyBody: {
    fontSize: 13,
    color: colors.muted,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 260,
  },

  // Bottom sheet
  sheetContainer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    backgroundColor: "#171B33",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderBottomWidth: 0,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.hairlineHi,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    letterSpacing: -0.2,
  },
  sheetDone: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.orange,
  },

  // Filter
  filterCard: {
    backgroundColor: "#1C2140",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: "hidden",
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    paddingHorizontal: 14,
  },
  filterRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  filterRowLabel: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    fontWeight: "500",
  },
  filterRowSub: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  clearBtn: {
    alignSelf: "center",
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: "rgba(239,123,77,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,123,77,0.35)",
  },
  clearBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.orange,
  },

  // Footer
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
  },
  footerText: {
    fontSize: 12,
    color: colors.faint,
    fontWeight: "500",
  },
});
