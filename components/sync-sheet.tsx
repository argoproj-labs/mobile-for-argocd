import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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

import { colors } from "../lib/theme";
import {
  appSource,
  type Application,
  type SyncApplicationOptions,
} from "../lib/api";

const { height: SCREEN_H } = Dimensions.get("window");

type PropPolicy = "foreground" | "background" | "orphan";
type ResourceItem = NonNullable<Application["status"]["resources"]>[number];

function rKey(r: ResourceItem): string {
  return [r.group, r.kind, r.namespace, r.name].filter(Boolean).join("/");
}

// ── Checkbox ───────────────────────────────────────────────────

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <View
      style={[
        styles.checkbox,
        checked && {
          backgroundColor: colors.orange,
          borderColor: colors.orange,
        },
      ]}
    >
      {checked && <Ionicons name="checkmark" size={11} color="#fff" />}
    </View>
  );
}

// ── CheckCard (2x2 flag grid item) ────────────────────────────

function CheckCard({
  label,
  sub,
  checked,
  onToggle,
}: {
  label: string;
  sub: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onToggle}
      activeOpacity={0.7}
      style={[styles.checkCard, checked && styles.checkCardActive]}
    >
      <Checkbox checked={checked} />
      <View style={styles.checkCardText}>
        <Text style={styles.checkCardLabel}>{label}</Text>
        <Text style={styles.checkCardSub}>{sub}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ── CheckRow (list item with checkbox) ───────────────────────

function CheckRow({
  label,
  checked,
  onToggle,
  last,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onToggle}
      activeOpacity={0.7}
      style={[styles.checkRow, !last && styles.rowBorder]}
    >
      <Checkbox checked={checked} />
      <Text style={styles.checkRowLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── SectionTitle ───────────────────────────────────────────────

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

// ── Card ───────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

// ── Sync sheet ─────────────────────────────────────────────────

export interface SyncSheetProps {
  visible: boolean;
  onClose: () => void;
  app: Application;
  onSync: (opts: SyncApplicationOptions) => Promise<void>;
}

function parseSyncPolicy(app: Application) {
  const opts = app.spec.syncPolicy?.syncOptions ?? [];
  const has = (s: string) => opts.includes(s);
  const propMatch = opts
    .find((o) => o.startsWith("PrunePropagationPolicy="))
    ?.split("=")[1] as PropPolicy | undefined;
  return {
    prune: app.spec.syncPolicy?.automated?.prune ?? false,
    skipSchema: has("Validate=false"),
    autoNs: has("CreateNamespace=true"),
    pruneLast: has("PruneLast=true"),
    applyOOSOnly: has("ApplyOutOfSyncOnly=true"),
    respectIgnore: has("RespectIgnoreDifferences=true"),
    serverSide: has("ServerSideApply=true"),
    replace: has("Replace=true"),
    propagation: (
      ["foreground", "background", "orphan"] as PropPolicy[]
    ).includes(propMatch as PropPolicy)
      ? (propMatch as PropPolicy)
      : ("foreground" as PropPolicy),
  };
}

export function SyncSheet({ visible, onClose, app, onSync }: SyncSheetProps) {
  const insets = useSafeAreaInsets();
  const src = useMemo(() => appSource(app), [app]);

  const [revision, setRevision] = useState(src?.targetRevision ?? "HEAD");
  const [prune, setPrune] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [applyOnly, setApplyOnly] = useState(false);
  const [force, setForce] = useState(false);

  const [skipSchema, setSkipSchema] = useState(false);
  const [autoNs, setAutoNs] = useState(false);
  const [pruneLast, setPruneLast] = useState(false);
  const [applyOOSOnly, setApplyOOSOnly] = useState(false);
  const [respectIgnore, setRespectIgnore] = useState(false);
  const [serverSide, setServerSide] = useState(false);

  const [propagation, setPropagation] = useState<PropPolicy>("foreground");
  const [propOpen, setPropOpen] = useState(false);
  const [replace, setReplace] = useState(false);

  const [isPending, setIsPending] = useState(false);

  const nonHookResources = useMemo(
    () => (app.status.resources ?? []).filter((r) => !r.hook),
    [app.status.resources],
  );
  const allKeys = useMemo(() => nonHookResources.map(rKey), [nonHookResources]);
  const oosKeys = useMemo(
    () => nonHookResources.filter((r) => r.status === "OutOfSync").map(rKey),
    [nonHookResources],
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set(allKeys));

  useEffect(() => {
    if (visible) {
      const d = parseSyncPolicy(app);
      setRevision(src?.targetRevision ?? "HEAD");
      setPrune(d.prune);
      setDryRun(false);
      setApplyOnly(false);
      setForce(false);
      setSkipSchema(d.skipSchema);
      setAutoNs(d.autoNs);
      setPruneLast(d.pruneLast);
      setApplyOOSOnly(d.applyOOSOnly);
      setRespectIgnore(d.respectIgnore);
      setServerSide(d.serverSide);
      setPropagation(d.propagation);
      setPropOpen(false);
      setReplace(d.replace);
      setSelected(new Set(allKeys));
      setIsPending(false);
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const handleSubmit = async () => {
    const syncOpts: string[] = [];
    if (skipSchema) syncOpts.push("Validate=false");
    if (autoNs) syncOpts.push("CreateNamespace=true");
    if (pruneLast) syncOpts.push("PruneLast=true");
    if (applyOOSOnly) syncOpts.push("ApplyOutOfSyncOnly=true");
    if (respectIgnore) syncOpts.push("RespectIgnoreDifferences=true");
    if (serverSide) syncOpts.push("ServerSideApply=true");
    if (replace) syncOpts.push("Replace=true");
    if (propagation !== "foreground")
      syncOpts.push(`PrunePropagationPolicy=${propagation}`);

    const allSelected = nonHookResources.every((r) => selected.has(rKey(r)));
    const resources = allSelected
      ? null
      : nonHookResources
          .filter((r) => selected.has(rKey(r)))
          .map((r) => ({
            group: r.group,
            kind: r.kind,
            name: r.name,
            namespace: r.namespace,
          }));

    setIsPending(true);
    try {
      await onSync({
        revision: revision || "HEAD",
        prune,
        dryRun,
        applyOnly,
        force,
        syncOptions: syncOpts,
        resources,
      });
      onClose();
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          onPress={onClose}
          activeOpacity={1}
        />
        <View style={[styles.sheet, { height: SCREEN_H * 0.92 }]}>
          {/* Handle */}
          <View style={styles.handleBar} />

          {/* Title row */}
          <View style={styles.titleRow}>
            <View style={{ width: 60 }} />
            <Text style={styles.titleText}>Synchronize</Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.doneBtn}
              hitSlop={{ top: 8, bottom: 8, left: 16, right: 0 }}
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>

          {/* Scrollable content */}
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Source */}
            <View style={styles.sourceBlock}>
              <Text style={styles.sourceLabel}>
                Synchronizing application manifests from
              </Text>
              <Text style={styles.sourceUrl} numberOfLines={2}>
                {src?.repoURL ?? ""}
              </Text>
            </View>

            {/* Revision */}
            <View>
              <SectionTitle title="REVISION" />
              <View style={styles.inputWrap}>
                <TextInput
                  style={styles.input}
                  value={revision}
                  onChangeText={setRevision}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholderTextColor={colors.faint}
                  selectionColor={colors.orange}
                />
              </View>
            </View>

            {/* Primary flags */}
            <View style={styles.checkGrid}>
              <CheckCard
                label="PRUNE"
                sub="Delete resources removed from Git"
                checked={prune}
                onToggle={() => setPrune((v) => !v)}
              />
              <CheckCard
                label="DRY RUN"
                sub="Validate only"
                checked={dryRun}
                onToggle={() => setDryRun((v) => !v)}
              />
              <CheckCard
                label="APPLY ONLY"
                sub="Skip hooks"
                checked={applyOnly}
                onToggle={() => setApplyOnly((v) => !v)}
              />
              <CheckCard
                label="FORCE"
                sub="Override conflicts"
                checked={force}
                onToggle={() => setForce((v) => !v)}
              />
            </View>

            {/* Sync options */}
            <View>
              <SectionTitle title="SYNC OPTIONS" />
              <Card>
                <CheckRow
                  label="Skip schema validation"
                  checked={skipSchema}
                  onToggle={() => setSkipSchema((v) => !v)}
                />
                <CheckRow
                  label="Auto-create namespace"
                  checked={autoNs}
                  onToggle={() => setAutoNs((v) => !v)}
                />
                <CheckRow
                  label="Prune last"
                  checked={pruneLast}
                  onToggle={() => setPruneLast((v) => !v)}
                />
                <CheckRow
                  label="Apply out of sync only"
                  checked={applyOOSOnly}
                  onToggle={() => setApplyOOSOnly((v) => !v)}
                />
                <CheckRow
                  label="Respect ignore differences"
                  checked={respectIgnore}
                  onToggle={() => setRespectIgnore((v) => !v)}
                />
                <CheckRow
                  label="Server-side apply"
                  checked={serverSide}
                  onToggle={() => setServerSide((v) => !v)}
                  last
                />
              </Card>
            </View>

            {/* Prune propagation policy */}
            <View>
              <SectionTitle title="PRUNE PROPAGATION POLICY" />
              <TouchableOpacity
                onPress={() => setPropOpen((v) => !v)}
                style={styles.dropdown}
                activeOpacity={0.7}
              >
                <Text style={styles.dropdownValue}>{propagation}</Text>
                <Ionicons
                  name={propOpen ? "chevron-up" : "chevron-down"}
                  size={14}
                  color={colors.muted}
                />
              </TouchableOpacity>
              {propOpen && (
                <View style={[styles.card, { marginTop: 6 }]}>
                  {(["foreground", "background", "orphan"] as PropPolicy[]).map(
                    (p, i, arr) => (
                      <TouchableOpacity
                        key={p}
                        onPress={() => {
                          setPropagation(p);
                          setPropOpen(false);
                        }}
                        activeOpacity={0.7}
                        style={[
                          styles.dropdownOption,
                          i < arr.length - 1 && styles.rowBorder,
                        ]}
                      >
                        <Text
                          style={[
                            styles.dropdownOptionText,
                            propagation === p && { color: colors.orange },
                          ]}
                        >
                          {p}
                        </Text>
                        {propagation === p && (
                          <Ionicons
                            name="checkmark"
                            size={14}
                            color={colors.orange}
                          />
                        )}
                      </TouchableOpacity>
                    ),
                  )}
                </View>
              )}
            </View>

            {/* Replace / Retry */}
            <View style={styles.checkGrid}>
              <CheckCard
                label="REPLACE"
                sub="kubectl replace"
                checked={replace}
                onToggle={() => setReplace((v) => !v)}
              />
            </View>

            {/* Resources */}
            <View>
              <View style={styles.resourcesHeader}>
                <SectionTitle title="SYNCHRONIZE RESOURCES" />
                <View style={styles.selLinks}>
                  <TouchableOpacity
                    onPress={() => setSelected(new Set(allKeys))}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  >
                    <Text style={styles.selLink}>all</Text>
                  </TouchableOpacity>
                  <Text style={styles.selSep}>/</Text>
                  <TouchableOpacity
                    onPress={() => setSelected(new Set(oosKeys))}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  >
                    <Text style={styles.selLink}>out of sync</Text>
                  </TouchableOpacity>
                  <Text style={styles.selSep}>/</Text>
                  <TouchableOpacity
                    onPress={() => setSelected(new Set())}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  >
                    <Text style={styles.selLink}>none</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={styles.selCount}>
                {selected.size} of {nonHookResources.length} selected
              </Text>
              <Card>
                {nonHookResources.map((r, i) => {
                  const key = rKey(r);
                  const isOn = selected.has(key);
                  return (
                    <TouchableOpacity
                      key={key}
                      onPress={() => toggle(key)}
                      activeOpacity={0.7}
                      style={[
                        styles.resourceRow,
                        i < nonHookResources.length - 1 && styles.rowBorder,
                        isOn && styles.resourceRowActive,
                      ]}
                    >
                      <Checkbox checked={isOn} />
                      <Text
                        style={styles.resourceKey}
                        numberOfLines={1}
                        ellipsizeMode="middle"
                      >
                        {key}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </Card>
            </View>
          </ScrollView>

          {/* Footer */}
          <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
            <TouchableOpacity
              onPress={onClose}
              style={styles.cancelBtn}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void handleSubmit()}
              disabled={isPending || selected.size === 0}
              activeOpacity={0.85}
              style={[
                styles.syncBtn,
                (isPending || selected.size === 0) && styles.syncBtnDisabled,
              ]}
            >
              {isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.syncBtnText}>
                  {dryRun ? "Run dry-run" : "Synchronize"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
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
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 4,
  },
  titleText: {
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: -0.2,
    color: colors.text,
  },
  doneBtn: {
    width: 60,
    alignItems: "flex-end",
  },
  doneBtnText: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.orange,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
    paddingBottom: 8,
  },

  // Source
  sourceBlock: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    paddingBottom: 12,
    gap: 4,
  },
  sourceLabel: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 20,
  },
  sourceUrl: {
    fontSize: 13,
    color: colors.orange,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 20,
  },

  // Section
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: colors.faint,
    textTransform: "uppercase",
    paddingHorizontal: 4,
    marginBottom: 6,
  },

  // Input
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 14,
    padding: 0,
  },

  // CheckCard grid
  checkGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  checkCard: {
    flexBasis: "47%",
    flexGrow: 1,
    flexShrink: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 10,
    padding: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  checkCardActive: {
    backgroundColor: "rgba(239,123,77,0.08)",
    borderColor: "rgba(239,123,77,0.4)",
  },
  checkCardText: {
    flex: 1,
    minWidth: 0,
  },
  checkCardLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: 0.4,
  },
  checkCardSub: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },

  // Card
  card: {
    backgroundColor: "#1C2140",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: "hidden",
  },

  // CheckRow
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  checkRowLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },

  // Checkbox
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.hairlineHi,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  // Dropdown
  dropdown: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
  },
  dropdownValue: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.text,
    textTransform: "capitalize",
  },
  dropdownOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  dropdownOptionText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: "500",
    textTransform: "capitalize",
  },

  // Resources
  resourcesHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selLinks: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingRight: 4,
  },
  selLink: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.orange,
  },
  selSep: {
    fontSize: 12,
    color: colors.faint,
    paddingHorizontal: 4,
  },
  selCount: {
    fontSize: 11,
    color: colors.muted,
    paddingHorizontal: 4,
    marginTop: 2,
    marginBottom: 8,
  },
  resourceRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 10,
  },
  resourceRowActive: {
    backgroundColor: "rgba(239,123,77,0.06)",
  },
  resourceKey: {
    flex: 1,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 11,
    color: colors.text,
    lineHeight: 16,
  },

  // Footer
  footer: {
    flexDirection: "row",
    gap: 10,
    padding: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  cancelBtn: {
    flex: 1,
    height: 54,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: colors.hairlineHi,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    letterSpacing: -0.2,
  },
  syncBtn: {
    flex: 1,
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.orange,
    alignItems: "center",
    justifyContent: "center",
  },
  syncBtnDisabled: {
    opacity: 0.4,
  },
  syncBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
    letterSpacing: -0.2,
  },
});
