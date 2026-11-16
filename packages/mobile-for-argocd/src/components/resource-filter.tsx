import React, { createContext, useContext, useMemo, useState } from "react";
import {
  Dimensions,
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

import { colors } from "../theme";
import { getHealth, getSync } from "../status";

// ── Types ──────────────────────────────────────────────────────

export interface ResourceFilterState {
  name: string;
  kinds: string[];
  sync: string[];
  health: string[];
  namespaces: string[];
}

export const EMPTY_RESOURCE_FILTER: ResourceFilterState = {
  name: "",
  kinds: [],
  sync: [],
  health: [],
  namespaces: [],
};

export function resourceFilterCount(f: ResourceFilterState): number {
  return (
    (f.name ? 1 : 0) +
    f.kinds.length +
    f.sync.length +
    f.health.length +
    f.namespaces.length
  );
}

// ── Shared context (lifted to layout so details + tree share state) ────────

interface ResourceFilterCtx {
  filter: ResourceFilterState;
  setFilter: React.Dispatch<React.SetStateAction<ResourceFilterState>>;
}

const ResourceFilterContext = createContext<ResourceFilterCtx>({
  filter: EMPTY_RESOURCE_FILTER,
  setFilter: () => {},
});

export function ResourceFilterProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [filter, setFilter] = useState<ResourceFilterState>(
    EMPTY_RESOURCE_FILTER,
  );
  return (
    <ResourceFilterContext.Provider value={{ filter, setFilter }}>
      {children}
    </ResourceFilterContext.Provider>
  );
}

export function useResourceFilter(): ResourceFilterCtx {
  return useContext(ResourceFilterContext);
}

// ── Glob matching ──────────────────────────────────────────────

function matchGlob(pattern: string, text: string): boolean {
  if (!pattern) return true;
  const p = pattern.toLowerCase();
  const t = text.toLowerCase();
  if (!p.includes("*") && !p.includes("?")) return t.includes(p);
  const re = p
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  try {
    return new RegExp(`^${re}$`).test(t);
  } catch {
    return t.includes(p);
  }
}

// ── Filter application ─────────────────────────────────────────

export function applyResourceFilter<
  T extends {
    name: string;
    kind: string;
    namespace?: string;
    health?: { status: string } | null;
    status?: string; // sync status — only present on managed resources, not tree nodes
  },
>(items: T[], f: ResourceFilterState): T[] {
  let list = items;
  if (f.name) list = list.filter((r) => matchGlob(f.name, r.name));
  if (f.kinds.length) list = list.filter((r) => f.kinds.includes(r.kind));
  if (f.sync.length)
    list = list.filter((r) =>
      // Tree nodes carry no sync status — pass them through
      r.status !== undefined ? f.sync.includes(r.status) : true,
    );
  if (f.health.length)
    list = list.filter((r) => f.health.includes(r.health?.status ?? "Unknown"));
  if (f.namespaces.length)
    list = list.filter((r) => f.namespaces.includes(r.namespace ?? ""));
  return list;
}

// ── Shared UI pieces ───────────────────────────────────────────

function CheckRow({
  icon,
  label,
  on,
  onToggle,
  last,
}: {
  icon?: React.ReactNode;
  label: string;
  on: boolean;
  onToggle: () => void;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onToggle}
      style={[s.checkRow, !last && s.checkRowBorder]}
    >
      <View style={[s.checkbox, on && s.checkboxOn]}>
        {on && <Ionicons name="checkmark" size={12} color="#fff" />}
      </View>
      {icon && <View style={s.checkIcon}>{icon}</View>}
      <Text style={s.checkLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function GroupLabel({ label }: { label: string }) {
  return <Text style={s.groupLabel}>{label}</Text>;
}

function MiniSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <View style={s.miniSearch}>
      <Ionicons name="search" size={12} color={colors.muted} />
      <TextInput
        style={s.miniSearchInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardAppearance="dark"
        clearButtonMode="while-editing"
      />
    </View>
  );
}

// ── ResourceFilterSheet ────────────────────────────────────────

const HEALTH_VALUES = [
  "Healthy",
  "Progressing",
  "Suspended",
  "Degraded",
  "Missing",
  "Unknown",
] as const;

const SYNC_VALUES = ["Synced", "OutOfSync", "Unknown"] as const;

const SHEET_HEIGHT = Math.min(
  Math.round(Dimensions.get("window").height * 0.88),
  700,
);

export function ResourceFilterSheet({
  visible,
  onClose,
  state,
  setState,
  allKinds,
  allNamespaces,
}: {
  visible: boolean;
  onClose: () => void;
  state: ResourceFilterState;
  setState: React.Dispatch<React.SetStateAction<ResourceFilterState>>;
  allKinds: string[];
  allNamespaces: string[];
}) {
  const insets = useSafeAreaInsets();
  const [kindSearch, setKindSearch] = useState("");
  const [nsSearch, setNsSearch] = useState("");

  const visibleKinds = useMemo(
    () =>
      allKinds.filter((k) =>
        k.toLowerCase().includes(kindSearch.toLowerCase()),
      ),
    [allKinds, kindSearch],
  );

  const visibleNs = useMemo(
    () =>
      allNamespaces.filter((ns) =>
        ns.toLowerCase().includes(nsSearch.toLowerCase()),
      ),
    [allNamespaces, nsSearch],
  );

  const toggle = <K extends keyof ResourceFilterState>(
    key: K,
    value: string,
  ) => {
    setState((prev) => {
      const arr = prev[key] as string[];
      const next = arr.includes(value)
        ? arr.filter((v) => v !== value)
        : [...arr, value];
      return { ...prev, [key]: next };
    });
  };

  const hasAny = resourceFilterCount(state) > 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={s.overlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          onPress={onClose}
          activeOpacity={1}
        />
        <View
          style={[
            s.sheet,
            { height: SHEET_HEIGHT, paddingBottom: insets.bottom + 16 },
          ]}
        >
          <View style={s.handle} />

          {/* Header */}
          <View style={s.sheetHeader}>
            <View style={{ width: 60 }} />
            <Text style={s.sheetTitle}>Filter resources</Text>
            <TouchableOpacity
              onPress={onClose}
              style={{ width: 60, alignItems: "flex-end" }}
            >
              <Text style={s.sheetDone}>Done</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 16 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Name */}
            <View style={s.section}>
              <GroupLabel label="Name" />
              <View style={s.card}>
                <View style={s.nameRow}>
                  <Ionicons
                    name="search"
                    size={14}
                    color={colors.muted}
                    style={{ marginRight: 8 }}
                  />
                  <TextInput
                    style={s.nameInput}
                    value={state.name}
                    onChangeText={(v) =>
                      setState((prev) => ({ ...prev, name: v }))
                    }
                    placeholder="e.g. web*, *api*, my-pod"
                    placeholderTextColor={colors.faint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardAppearance="dark"
                    clearButtonMode="while-editing"
                  />
                </View>
              </View>
            </View>

            {/* Health */}
            <View style={s.section}>
              <GroupLabel label="Health status" />
              <View style={s.card}>
                {HEALTH_VALUES.map((k, i) => {
                  const t = getHealth(k);
                  return (
                    <CheckRow
                      key={k}
                      icon={
                        <Ionicons name={t.icon} size={14} color={t.color} />
                      }
                      label={k}
                      on={state.health.includes(k)}
                      onToggle={() => toggle("health", k)}
                      last={i === HEALTH_VALUES.length - 1}
                    />
                  );
                })}
              </View>
            </View>

            {/* Sync */}
            <View style={s.section}>
              <GroupLabel label="Sync status" />
              <View style={s.card}>
                {SYNC_VALUES.map((k, i) => {
                  const t = getSync(k);
                  return (
                    <CheckRow
                      key={k}
                      icon={
                        <Ionicons name={t.icon} size={14} color={t.color} />
                      }
                      label={k}
                      on={state.sync.includes(k)}
                      onToggle={() => toggle("sync", k)}
                      last={i === SYNC_VALUES.length - 1}
                    />
                  );
                })}
              </View>
            </View>

            {/* Kind */}
            {allKinds.length > 0 && (
              <View style={s.section}>
                <GroupLabel label="Kind" />
                <View style={s.card}>
                  {allKinds.length > 6 && (
                    <View style={s.searchInCard}>
                      <MiniSearch
                        value={kindSearch}
                        onChange={setKindSearch}
                        placeholder="Search kinds…"
                      />
                    </View>
                  )}
                  {visibleKinds.map((k, i) => (
                    <CheckRow
                      key={k}
                      label={k}
                      on={state.kinds.includes(k)}
                      onToggle={() => toggle("kinds", k)}
                      last={i === visibleKinds.length - 1}
                    />
                  ))}
                  {visibleKinds.length === 0 && (
                    <View style={s.noResults}>
                      <Text style={s.noResultsText}>No matching kinds</Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Namespace */}
            {allNamespaces.length > 0 && (
              <View style={s.section}>
                <GroupLabel label="Namespace" />
                <View style={s.card}>
                  {allNamespaces.length > 6 && (
                    <View style={s.searchInCard}>
                      <MiniSearch
                        value={nsSearch}
                        onChange={setNsSearch}
                        placeholder="Search namespaces…"
                      />
                    </View>
                  )}
                  {visibleNs.map((ns, i) => (
                    <CheckRow
                      key={ns}
                      label={ns}
                      on={state.namespaces.includes(ns)}
                      onToggle={() => toggle("namespaces", ns)}
                      last={i === visibleNs.length - 1}
                    />
                  ))}
                  {visibleNs.length === 0 && (
                    <View style={s.noResults}>
                      <Text style={s.noResultsText}>
                        No matching namespaces
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Clear */}
            {hasAny && (
              <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
                <TouchableOpacity
                  onPress={() => setState(EMPTY_RESOURCE_FILTER)}
                  style={s.clearBtn}
                >
                  <Text style={s.clearBtnText}>Clear all filters</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const MONO = Platform.OS === "ios" ? "Menlo" : "monospace";

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#171B33",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderBottomWidth: 0,
  },
  handle: {
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

  section: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  groupLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: colors.faint,
    textTransform: "uppercase",
    paddingBottom: 6,
    paddingLeft: 4,
  },
  card: {
    backgroundColor: "#1C2140",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: "hidden",
  },

  // Name row
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  nameInput: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    padding: 0,
    margin: 0,
    fontFamily: MONO,
  },

  // Check row
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    paddingHorizontal: 14,
  },
  checkRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.hairlineHi,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  checkboxOn: {
    backgroundColor: colors.orange,
    borderColor: colors.orange,
  },
  checkIcon: {
    width: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  checkLabel: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    fontWeight: "500",
  },

  // Mini search inside a card
  searchInCard: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  miniSearch: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  miniSearchInput: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    padding: 0,
    margin: 0,
    fontFamily: MONO,
  },

  noResults: {
    padding: 14,
    alignItems: "center",
  },
  noResultsText: {
    fontSize: 13,
    color: colors.faint,
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
});
