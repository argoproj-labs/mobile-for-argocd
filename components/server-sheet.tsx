import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
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
import { hostFromUrl, normalizeUrl } from "../lib/api";
import { type Instance, hasSession } from "../lib/storage";
import { useInstanceStore } from "../lib/instanceStore";

const DEMO_SERVER = "https://cd.apps.argoproj.io";
const NEW_ROW = "__new__";

// Shared server list used by both the login screen and the apps list header,
// so there is exactly one place to view, add, edit, or remove servers.
// Editing happens inline — a row turns into a text field rather than handing
// off to a second sheet.
export function ServerSheet({
  visible,
  onClose,
  onSelect,
  subtitle,
  dismissible = true,
}: {
  visible: boolean;
  onClose: () => void;
  /** Row tapped. Receives the instance; the caller decides what selecting means. */
  onSelect: (inst: Instance) => void;
  subtitle: string;
  /** False while a server is required — hides every way to back out. */
  dismissible?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { instances, activeId, addServer, updateInstanceUrl, removeInstance } =
    useInstanceStore();

  // Which row is in edit mode: an instance id, NEW_ROW, or null.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const startEdit = useCallback((id: string, url: string) => {
    setEditing(id);
    setDraft(url);
    setError(null);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setDraft("");
    setError(null);
  }, []);

  // With nothing saved yet there is nothing to pick, so open straight into an
  // empty row instead of showing a bare sheet.
  useEffect(() => {
    if (visible && instances.length === 0) {
      setEditing(NEW_ROW);
      setDraft("");
      setError(null);
    } else if (!visible) {
      cancelEdit();
    }
  }, [visible, instances.length, cancelEdit]);

  const commitEdit = useCallback(async () => {
    const url = normalizeUrl(draft);
    if (!url) {
      setError("Enter a server URL");
      return;
    }
    try {
      if (!new URL(url).hostname) throw new Error();
    } catch {
      setError("Enter a valid URL, e.g. https://argocd.example.com");
      return;
    }

    const clash = instances.find((i) => i.url === url && i.id !== editing);
    if (clash) {
      setError("That server is already in the list");
      return;
    }

    if (editing === NEW_ROW) await addServer(url);
    else if (editing) await updateInstanceUrl(editing, url);
    cancelEdit();
  }, [draft, editing, instances, addServer, updateInstanceUrl, cancelEdit]);

  const confirmRemove = useCallback(
    (inst: Instance) => {
      Alert.alert("Remove server", `Remove ${hostFromUrl(inst.url)}?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => void removeInstance(inst.id),
        },
      ]);
    },
    [removeInstance],
  );

  const renderEditor = (key: string) => (
    <View key={key} style={s.editRow}>
      <TextInput
        style={s.editInput}
        value={draft}
        onChangeText={(t) => {
          setDraft(t);
          setError(null);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="url"
        keyboardType="url"
        keyboardAppearance="dark"
        placeholder="https://argocd.example.com"
        placeholderTextColor={colors.faint}
        returnKeyType="done"
        onSubmitEditing={() => void commitEdit()}
        autoFocus
      />
      <TouchableOpacity
        testID="btn-confirm-server"
        onPress={() => void commitEdit()}
        hitSlop={10}
      >
        <Ionicons name="checkmark" size={22} color={colors.success} />
      </TouchableOpacity>
      <TouchableOpacity
        testID="btn-cancel-server"
        onPress={cancelEdit}
        hitSlop={10}
      >
        <Ionicons name="close" size={22} color={colors.muted} />
      </TouchableOpacity>
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      // A no-op rather than undefined: Android's back button falls back to
      // dismissing the modal when no handler is supplied.
      onRequestClose={dismissible ? onClose : () => {}}
    >
      <View style={s.overlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          onPress={dismissible ? onClose : undefined}
          activeOpacity={1}
        />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={s.handle} />
          <View style={s.header}>
            <View style={{ width: 60 }} />
            <Text style={s.title}>Servers</Text>
            {dismissible ? (
              <TouchableOpacity
                onPress={onClose}
                style={{ width: 60, alignItems: "flex-end" }}
              >
                <Text style={s.done}>Done</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ width: 60 }} />
            )}
          </View>

          <Text style={s.subtitle}>{subtitle}</Text>

          <ScrollView
            style={{ maxHeight: 280 }}
            contentContainerStyle={{ paddingTop: 14 }}
            keyboardShouldPersistTaps="handled"
          >
            {instances.length > 0 && (
              <View style={s.card}>
                {instances.map((inst, i) => {
                  const border = i < instances.length - 1 && s.rowBorder;
                  if (editing === inst.id) {
                    return (
                      <View key={inst.id} style={[s.rowWrap, border]}>
                        {renderEditor(inst.id)}
                      </View>
                    );
                  }
                  const isActive = inst.id === activeId;
                  return (
                    <View key={inst.id} style={[s.row, border]}>
                      <TouchableOpacity
                        testID={`btn-select-server-${i}`}
                        style={s.rowMain}
                        onPress={() => onSelect(inst)}
                        activeOpacity={0.7}
                      >
                        <Ionicons
                          name={
                            isActive ? "checkmark-circle" : "ellipse-outline"
                          }
                          size={20}
                          color={isActive ? colors.orange : colors.muted}
                        />
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[s.hostname, isActive && s.hostnameActive]}
                            numberOfLines={1}
                          >
                            {hostFromUrl(inst.url)}
                          </Text>
                          {!hasSession(inst) && (
                            <Text style={s.rowNote}>Not signed in</Text>
                          )}
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity
                        testID={`btn-edit-server-${i}`}
                        onPress={() => startEdit(inst.id, inst.url)}
                        hitSlop={10}
                        style={s.rowAction}
                      >
                        <Ionicons
                          name="pencil"
                          size={17}
                          color={colors.muted}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        testID={`btn-remove-server-${i}`}
                        onPress={() => confirmRemove(inst)}
                        hitSlop={10}
                        style={s.rowAction}
                      >
                        <Ionicons
                          name="trash-outline"
                          size={17}
                          color={colors.muted}
                        />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            )}

            {editing === NEW_ROW && (
              <View style={[s.card, instances.length > 0 && { marginTop: 10 }]}>
                {renderEditor(NEW_ROW)}
              </View>
            )}

            {error && (
              <View style={s.errorRow}>
                <Ionicons name="alert-circle" size={14} color={colors.danger} />
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}
          </ScrollView>

          {editing !== NEW_ROW && (
            <TouchableOpacity
              testID="btn-add-server"
              style={s.addBtn}
              onPress={() => startEdit(NEW_ROW, "")}
              activeOpacity={0.7}
            >
              <Ionicons
                name="add-circle-outline"
                size={18}
                color={colors.orange}
              />
              <Text style={s.addBtnText}>Add server</Text>
            </TouchableOpacity>
          )}

          {editing === NEW_ROW && (
            <TouchableOpacity
              testID="btn-demo-server"
              style={s.demoBtn}
              onPress={() => {
                setDraft(DEMO_SERVER);
                setError(null);
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="flask-outline" size={14} color={colors.orange} />
              <Text style={s.demoBtnText}>Use public demo server</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    backgroundColor: "#1C2140",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
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
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.3,
  },
  done: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.orange,
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 6,
    letterSpacing: -0.1,
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 12,
    gap: 6,
  },
  rowWrap: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rowAction: {
    padding: 8,
  },
  hostname: {
    fontSize: 15,
    color: colors.text,
    fontWeight: "500",
    letterSpacing: -0.2,
  },
  hostnameActive: {
    color: colors.orange,
  },
  rowNote: {
    fontSize: 11,
    color: colors.faint,
    marginTop: 2,
  },
  editRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  editInput: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    fontWeight: "500",
    letterSpacing: -0.2,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    padding: 0,
    margin: 0,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
  },
  errorText: {
    fontSize: 13,
    color: colors.danger,
    flex: 1,
    lineHeight: 18,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    paddingVertical: 8,
  },
  addBtnText: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.orange,
  },
  demoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
  },
  demoBtnText: {
    fontSize: 13,
    color: colors.orange,
    fontWeight: "500",
  },
});
