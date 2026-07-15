import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Image,
  KeyboardAvoidingView,
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
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import {
  AuthRequest,
  exchangeCodeAsync,
  fetchDiscoveryAsync,
  makeRedirectUri,
  type DiscoveryDocument,
  ResponseType,
} from "expo-auth-session";

import { colors } from "../lib/theme";
import {
  fetchAuthSettings,
  hostFromUrl,
  loginWithPassword,
  normalizeUrl,
  resolveOidcConfig,
  type AuthSettings,
  type OidcFlowConfig,
} from "../lib/api";
import { serverStorage, tokenStorage } from "../lib/storage";

WebBrowser.maybeCompleteAuthSession();

// ── Seeded RNG (Mulberry32) ────────────────────────────────────
function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Starfield ─────────────────────────────────────────────────
interface Star {
  left: string;
  top: string;
  size: number;
  opacity: number;
}

function Starfield() {
  const stars = useMemo<Star[]>(() => {
    const rng = mulberry32(7);
    const out: Star[] = [];
    for (let i = 0; i < 80; i++) {
      out.push({
        left: `${(rng() * 100).toFixed(1)}%`,
        top: `${(rng() * 100).toFixed(1)}%`,
        size: 1,
        opacity: 0.3 + rng() * 0.4,
      });
    }
    for (let i = 0; i < 26; i++) {
      out.push({
        left: `${(rng() * 100).toFixed(1)}%`,
        top: `${(rng() * 100).toFixed(1)}%`,
        size: 1.5,
        opacity: 0.5 + rng() * 0.4,
      });
    }
    for (let i = 0; i < 8; i++) {
      out.push({
        left: `${(rng() * 100).toFixed(1)}%`,
        top: `${(rng() * 60).toFixed(1)}%`,
        size: 2 + rng() * 1.5,
        opacity: 0.9,
      });
    }
    return out;
  }, []);

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {stars.map((s, i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            left: s.left as `${number}%`,
            top: s.top as `${number}%`,
            width: s.size,
            height: s.size,
            borderRadius: s.size,
            backgroundColor: "#fff",
            opacity: s.opacity,
          }}
        />
      ))}
    </View>
  );
}

// ── Background glows ───────────────────────────────────────────
function GlowEffects() {
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <View style={styles.glowPurple} />
      <View style={styles.glowOrange} />
    </View>
  );
}

// ── Argo wordmark ─────────────────────────────────────────────
function ArgoWordmark({ size = 28 }: { size?: number }) {
  const d = size * 1.15;
  return (
    <View style={styles.wordmarkRow}>
      {/* Three concentric circles built from nested Views */}
      <View
        style={{
          width: d,
          height: d,
          borderRadius: d / 2,
          borderWidth: 2,
          borderColor: "rgba(239,123,77,0.35)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: d * 0.65,
            height: d * 0.65,
            borderRadius: d * 0.325,
            borderWidth: 2,
            borderColor: "rgba(239,123,77,0.55)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View
            style={{
              width: d * 0.3,
              height: d * 0.3,
              borderRadius: d * 0.15,
              backgroundColor: colors.orange,
            }}
          />
        </View>
      </View>
      <Text style={[styles.wordmarkText, { fontSize: size }]}>argo</Text>
    </View>
  );
}

// ── Server chip ────────────────────────────────────────────────
function ServerChip({
  url,
  onPress,
}: {
  url: string | null;
  onPress: () => void;
}) {
  const label = url ? hostFromUrl(url) : "tap to add server";
  const hasServer = !!url;

  return (
    <TouchableOpacity onPress={onPress} style={styles.chip} activeOpacity={0.7}>
      <View style={[styles.chipDot, !hasServer && styles.chipDotOff]} />
      <Text style={styles.chipText} numberOfLines={1}>
        {label}
      </Text>
      <Ionicons name="chevron-down" size={12} color="rgba(255,255,255,0.5)" />
    </TouchableOpacity>
  );
}

// ── Error toast ────────────────────────────────────────────────
function ErrorToast({
  visible,
  message,
}: {
  visible: boolean;
  message: string;
}) {
  const ty = useRef(new Animated.Value(-20)).current;
  const op = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(ty, {
        toValue: visible ? 0 : -20,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(op, {
        toValue: visible ? 1 : 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, ty, op]);

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[styles.toast, { transform: [{ translateY: ty }], opacity: op }]}
    >
      <Ionicons name="alert-circle" size={20} color={colors.danger} />
      <Text style={styles.toastText}>{message}</Text>
    </Animated.View>
  );
}

// ── Success overlay ────────────────────────────────────────────
function SuccessOverlay({ visible }: { visible: boolean }) {
  const bgOp = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.6)).current;
  const circleOp = useRef(new Animated.Value(0)).current;
  const textOp = useRef(new Animated.Value(0)).current;
  const textTy = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(bgOp, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
        Animated.timing(circleOp, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(300),
          Animated.parallel([
            Animated.timing(textOp, {
              toValue: 1,
              duration: 400,
              useNativeDriver: true,
            }),
            Animated.timing(textTy, {
              toValue: 0,
              duration: 400,
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]).start();
    } else {
      bgOp.setValue(0);
      scale.setValue(0.6);
      circleOp.setValue(0);
      textOp.setValue(0);
      textTy.setValue(8);
    }
  }, [visible, bgOp, scale, circleOp, textOp, textTy]);

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[
        StyleSheet.absoluteFillObject,
        styles.successOverlay,
        { opacity: bgOp },
      ]}
    >
      <Animated.View
        style={[
          styles.successCircle,
          { transform: [{ scale }], opacity: circleOp },
        ]}
      >
        <Ionicons name="checkmark" size={44} color={colors.success} />
      </Animated.View>
      <Animated.Text
        style={[
          styles.successText,
          { opacity: textOp, transform: [{ translateY: textTy }] },
        ]}
      >
        Welcome back
      </Animated.Text>
    </Animated.View>
  );
}

// ── Text field ─────────────────────────────────────────────────
interface FieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  secureTextEntry?: boolean;
  autoComplete?: "username" | "current-password" | "off";
  error?: boolean;
  trailing?: React.ReactNode;
  onFocus?: () => void;
  onBlur?: () => void;
  focused?: boolean;
}

function Field({
  label,
  value,
  onChangeText,
  secureTextEntry,
  autoComplete,
  error,
  trailing,
  onFocus,
  onBlur,
  focused,
}: FieldProps) {
  const borderColor = error
    ? "rgba(255,107,107,0.5)"
    : focused
      ? "rgba(239,123,77,0.55)"
      : colors.hairline;
  const labelColor = error
    ? colors.danger
    : focused
      ? colors.orange
      : colors.faint;

  return (
    <View style={[styles.field, { borderColor }]}>
      <Text style={[styles.fieldLabel, { color: labelColor }]}>{label}</Text>
      <View style={styles.fieldRow}>
        <TextInput
          style={styles.fieldInput}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secureTextEntry}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={autoComplete}
          placeholderTextColor={colors.faint}
          onFocus={onFocus}
          onBlur={onBlur}
          keyboardAppearance="dark"
        />
        {trailing}
      </View>
    </View>
  );
}

// ── Eye toggle ─────────────────────────────────────────────────
function EyeToggle({ open, onPress }: { open: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.eyeBtn}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Ionicons
        name={open ? "eye" : "eye-off"}
        size={20}
        color={colors.muted}
      />
    </TouchableOpacity>
  );
}

const DEMO_SERVER = "https://cd.apps.argoproj.io";

// ── Server URL modal ───────────────────────────────────────────
function ServerModal({
  visible,
  initialValue,
  onSave,
  onCancel,
}: {
  visible: boolean;
  initialValue: string;
  onSave: (url: string) => void;
  onCancel: () => void;
}) {
  const [input, setInput] = useState(initialValue);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      setInput(initialValue);
      setError(null);
    }
  }, [visible, initialValue]);

  const handleSave = useCallback(async () => {
    const url = normalizeUrl(input);
    if (!url) return;

    try {
      const parsed = new URL(url);
      if (!parsed.hostname) throw new Error();
    } catch {
      setError("Enter a valid URL, e.g. https://argocd.example.com");
      return;
    }

    setValidating(true);
    setError(null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      await fetch(`${url}/api/version`, { signal: controller.signal });
      clearTimeout(timeout);
    } catch (e: unknown) {
      setValidating(false);
      if (e instanceof Error && e.name === "AbortError") {
        setError("Connection timed out. Check the URL and your network.");
      } else {
        setError("Could not reach the server. Check the URL and your network.");
      }
      return;
    }
    setValidating(false);
    onSave(url);
  }, [input, onSave]);

  const handleDemo = useCallback(() => {
    setInput(DEMO_SERVER);
    setError(null);
  }, []);

  const canSave = !!input.trim() && !validating;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.modalOverlay}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          onPress={onCancel}
          activeOpacity={1}
        />
        <View
          style={[styles.modalSheet, { paddingBottom: insets.bottom + 24 }]}
        >
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Server URL</Text>
          <Text style={styles.modalHint}>
            Enter the URL of your Argo CD instance
          </Text>
          <View
            style={[
              styles.field,
              {
                borderColor: error ? "rgba(255,107,107,0.5)" : colors.hairline,
                marginTop: 20,
              },
            ]}
          >
            <Text
              style={[
                styles.fieldLabel,
                { color: error ? colors.danger : colors.faint },
              ]}
            >
              URL
            </Text>
            <View style={styles.fieldRow}>
              <TextInput
                style={styles.fieldInput}
                value={input}
                onChangeText={(t) => {
                  setInput(t);
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
                onSubmitEditing={handleSave}
                autoFocus
              />
            </View>
          </View>

          {error ? (
            <View style={styles.modalError}>
              <Ionicons name="alert-circle" size={14} color={colors.danger} />
              <Text style={styles.modalErrorText}>{error}</Text>
            </View>
          ) : (
            <TouchableOpacity
              onPress={handleDemo}
              style={styles.demoBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="flask-outline" size={14} color={colors.orange} />
              <Text style={styles.demoBtnText}>Try public demo server</Text>
            </TouchableOpacity>
          )}

          <View style={styles.modalButtons}>
            <TouchableOpacity
              onPress={onCancel}
              style={[styles.btn, styles.btnGhost]}
              disabled={validating}
            >
              <Text style={[styles.btnText, { color: colors.muted }]}>
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              style={[
                styles.btn,
                styles.btnPrimary,
                !canSave && styles.btnPrimaryDisabled,
              ]}
              disabled={!canSave}
            >
              {validating ? (
                <View style={styles.spinner} />
              ) : (
                <Text style={styles.btnText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Login screen ───────────────────────────────────────────────
type LoginState =
  | "idle"
  | "loading-settings"
  | "signing-in"
  | "sso-pending"
  | "error"
  | "success";

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [authSettings, setAuthSettings] = useState<AuthSettings | null>(null);
  const [loginState, setLoginState] = useState<LoginState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState<"username" | "password" | null>(null);

  const [showServerModal, setShowServerModal] = useState(false);
  const [settingsRefreshKey, setSettingsRefreshKey] = useState(0);

  // Load saved server URL on mount
  useEffect(() => {
    serverStorage.get().then((url) => {
      if (url) {
        setServerUrl(url);
      } else {
        setShowServerModal(true);
      }
    });
  }, []);

  // Fetch auth settings when server URL changes or is re-saved
  useEffect(() => {
    if (!serverUrl) return;
    setLoginState("loading-settings");
    fetchAuthSettings(serverUrl)
      .then((settings) => {
        setAuthSettings(settings);
        setLoginState("idle");
      })
      .catch(() => {
        // Fall back to username/password login if settings can't be fetched
        setAuthSettings({ userLoginsDisabled: false });
        setLoginState("idle");
      });
  }, [serverUrl, settingsRefreshKey]);

  // ── OIDC / SSO ──────────────────────────────────────────────
  const oidcConfig: OidcFlowConfig | null = useMemo(
    () =>
      authSettings && serverUrl
        ? resolveOidcConfig(authSettings, serverUrl)
        : null,
    [authSettings, serverUrl],
  );

  const redirectUri = makeRedirectUri({
    scheme: "argocd",
    path: "auth/callback",
  });

  const [discovery, setDiscovery] = useState<DiscoveryDocument | null>(null);
  useEffect(() => {
    if (!oidcConfig) {
      setDiscovery(null);
      return;
    }
    // For Dex, endpoints are pre-built — no network fetch needed
    if (oidcConfig.endpoints) {
      setDiscovery(oidcConfig.endpoints as unknown as DiscoveryDocument);
      return;
    }
    // External OIDC: fetch discovery document
    setDiscovery(null);
    let active = true;
    const issuer = oidcConfig.issuer.replace(/\/+$/, "");
    fetchDiscoveryAsync(issuer)
      .then((doc) => {
        if (active) setDiscovery(doc);
      })
      .catch((err: unknown) => {
        console.warn("OIDC discovery failed:", String(err));
      });
    return () => {
      active = false;
    };
  }, [oidcConfig]);

  const ssoConfigured = !!oidcConfig;

  const ssoLabel = useMemo(() => {
    if (!authSettings) return "SSO Login";
    if (authSettings.oidcConfig)
      return `Continue with ${authSettings.oidcConfig.name}`;
    const connectors = authSettings.dexConfig?.connectors ?? [];
    if (connectors.length === 1) return `Continue with ${connectors[0].name}`;
    return "SSO Login";
  }, [authSettings]);

  const canSubmit =
    loginState === "idle" && username.trim().length > 0 && password.length > 0;

  const handleSignIn = useCallback(async () => {
    if (!canSubmit || !serverUrl) return;
    setLoginState("signing-in");
    setErrorMessage("");
    try {
      const token = await loginWithPassword(
        serverUrl,
        username.trim(),
        password,
      );
      await tokenStorage.set(token);
      setLoginState("success");
      setTimeout(() => router.replace("/(app)/"), 900);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Login failed";
      setErrorMessage(msg);
      setLoginState("error");
      setTimeout(() => setLoginState("idle"), 2400);
    }
  }, [canSubmit, serverUrl, username, password, router]);

  const handleSSO = useCallback(async () => {
    if (!oidcConfig || !discovery || loginState !== "idle") return;
    setLoginState("sso-pending");
    try {
      const request = new AuthRequest({
        clientId: oidcConfig.clientId,
        scopes: oidcConfig.scopes,
        redirectUri,
        usePKCE: true,
        responseType: ResponseType.Code,
      });
      const result = await request.promptAsync(discovery);
      if (result.type === "success") {
        const tokenResponse = await exchangeCodeAsync(
          {
            clientId: oidcConfig.clientId,
            code: result.params.code,
            redirectUri,
            extraParams: request.codeVerifier
              ? { code_verifier: request.codeVerifier }
              : undefined,
          },
          discovery,
        );
        const token = tokenResponse.idToken;
        if (!token) throw new Error("No id_token in token response");
        await tokenStorage.set(token);
        setLoginState("success");
        setTimeout(() => router.replace("/(app)/"), 900);
      } else {
        setLoginState("idle");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "SSO login failed";
      setErrorMessage(msg);
      setLoginState("error");
      setTimeout(() => setLoginState("idle"), 2400);
    }
  }, [oidcConfig, discovery, loginState, redirectUri, router]);

  const handleBrowserLogin = useCallback(() => {
    if (!serverUrl) {
      setShowServerModal(true);
      return;
    }
    router.push({
      pathname: "/webview-login",
      params: { server: serverUrl },
    });
  }, [serverUrl, router]);

  const handleAnonymous = useCallback(async () => {
    if (!serverUrl) {
      setShowServerModal(true);
      return;
    }
    await tokenStorage.set("anonymous");
    setLoginState("success");
    setTimeout(() => router.replace("/(app)/"), 900);
  }, [serverUrl, router]);

  const handleSaveServer = useCallback((url: string) => {
    serverStorage.set(url);
    setServerUrl(url);
    setAuthSettings(null);
    setSettingsRefreshKey((k) => k + 1);
    setShowServerModal(false);
  }, []);

  const isLoading = loginState === "signing-in" || loginState === "sso-pending";

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* Background */}
      <LinearGradient
        colors={[colors.inkSoft, colors.inkMid, colors.ink]}
        style={StyleSheet.absoluteFillObject}
        start={{ x: 0.5, y: 1 }}
        end={{ x: 0.5, y: 0 }}
      />
      <GlowEffects />
      <Starfield />

      {/* Server chip */}
      <View style={[styles.topBar, { paddingTop: insets.top + 16 }]}>
        <ServerChip url={serverUrl} onPress={() => setShowServerModal(true)} />
      </View>

      {/* Error toast */}
      <ErrorToast visible={loginState === "error"} message={errorMessage} />

      {/* Main content */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.content}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 36 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Hero */}
          <View style={styles.hero}>
            <Image
              source={require("../assets/argo-mascot.png")}
              style={styles.mascot}
              resizeMode="contain"
            />
            <ArgoWordmark size={28} />
            <Text style={styles.tagline}>{"Let's get stuff deployed!"}</Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            {/* SSO */}
            {ssoConfigured && (
              <TouchableOpacity
                onPress={handleSSO}
                disabled={
                  isLoading || loginState === "loading-settings" || !discovery
                }
                style={[
                  styles.btnSSO,
                  (isLoading || !discovery) && { opacity: 0.6 },
                ]}
                activeOpacity={0.8}
              >
                {loginState === "sso-pending" ? (
                  <View style={styles.spinner} />
                ) : (
                  <>
                    {/* SSO glyph: circle with inner dot */}
                    <View
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 9,
                        borderWidth: 2.5,
                        borderColor: "#fff",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <View
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: 2,
                          backgroundColor: "#fff",
                        }}
                      />
                    </View>
                    <Text style={styles.btnSSOText}>{ssoLabel}</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {/* Or divider */}
            {ssoConfigured && !authSettings?.userLoginsDisabled && (
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>OR</Text>
                <View style={styles.dividerLine} />
              </View>
            )}

            {/* Username / password */}
            {!authSettings?.userLoginsDisabled && (
              <>
                <Field
                  label="Username"
                  value={username}
                  onChangeText={setUsername}
                  autoComplete="username"
                  error={loginState === "error"}
                  focused={focused === "username"}
                  onFocus={() => setFocused("username")}
                  onBlur={() => setFocused(null)}
                />
                <Field
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoComplete="current-password"
                  error={loginState === "error"}
                  focused={focused === "password"}
                  onFocus={() => setFocused("password")}
                  onBlur={() => setFocused(null)}
                  trailing={
                    <EyeToggle
                      open={showPassword}
                      onPress={() => setShowPassword((v) => !v)}
                    />
                  }
                />
                <View style={{ height: 4 }} />
                <TouchableOpacity
                  onPress={handleSignIn}
                  disabled={!canSubmit}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={
                      canSubmit
                        ? [colors.orange, colors.orangeDeep]
                        : ["rgba(239,123,77,0.3)", "rgba(229,97,58,0.3)"]
                    }
                    style={styles.btnPrimary}
                    start={{ x: 0.5, y: 0 }}
                    end={{ x: 0.5, y: 1 }}
                  >
                    {loginState === "signing-in" ? (
                      <View style={styles.spinner} />
                    ) : (
                      <>
                        <Text style={styles.btnText}>Sign in</Text>
                        <Ionicons name="arrow-forward" size={16} color="#fff" />
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </>
            )}

            {/* Login fully disabled */}
            {authSettings?.userLoginsDisabled && !ssoConfigured && (
              <View style={styles.disabledMsg}>
                <Text style={styles.disabledMsgText}>
                  Login is disabled. Please contact your system administrator.
                </Text>
              </View>
            )}

            <View style={styles.footer}>
              <TouchableOpacity
                testID="btn-anonymous"
                onPress={handleAnonymous}
                activeOpacity={0.6}
              >
                <Text style={styles.footerLink}>Continue anonymously</Text>
              </TouchableOpacity>
              {/* Browser login — fallback for proxies / custom login pages
                  the native flows can't reach. */}
              <TouchableOpacity
                testID="btn-browser-login"
                onPress={handleBrowserLogin}
                disabled={isLoading}
                activeOpacity={0.6}
              >
                <Text style={styles.footerLink}>Sign in via browser</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Overlays */}
      <SuccessOverlay visible={loginState === "success"} />
      <ServerModal
        visible={showServerModal}
        initialValue={serverUrl ?? ""}
        onSave={handleSaveServer}
        onCancel={() => {
          if (serverUrl) setShowServerModal(false);
        }}
      />
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.ink,
  },

  // Background
  glowPurple: {
    position: "absolute",
    top: -80,
    right: -80,
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: "rgba(127,86,217,0.22)",
  },
  glowOrange: {
    position: "absolute",
    bottom: "8%",
    left: "50%",
    marginLeft: -210,
    width: 420,
    height: 220,
    borderRadius: 210,
    backgroundColor: "rgba(239,123,77,0.13)",
  },

  // Wordmark
  wordmarkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  wordmarkText: {
    fontWeight: "600",
    letterSpacing: -0.5,
    color: colors.orange,
  },

  // Chip
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: "center",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
    shadowColor: colors.success,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 4,
  },
  chipDotOff: {
    backgroundColor: colors.faint,
    shadowOpacity: 0,
  },
  chipText: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 0.2,
    maxWidth: 200,
  },

  // Toast
  toast: {
    position: "absolute",
    top: 80,
    left: 16,
    right: 16,
    zIndex: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,107,107,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,107,107,0.4)",
    borderRadius: 14,
    padding: 12,
  },
  toastText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: "500",
    letterSpacing: -0.1,
    flex: 1,
  },

  // Success overlay
  successOverlay: {
    backgroundColor: "rgba(11,21,48,0.85)",
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
  },
  successCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "rgba(92,217,176,0.15)",
    borderWidth: 2,
    borderColor: colors.success,
    alignItems: "center",
    justifyContent: "center",
  },
  successText: {
    fontSize: 22,
    fontWeight: "600",
    color: colors.text,
    letterSpacing: -0.4,
  },

  // Layout
  content: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  hero: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingTop: 100,
    paddingBottom: 24,
    gap: 18,
    minHeight: 280,
  },
  mascot: {
    width: 180,
    height: 180,
  },
  tagline: {
    fontSize: 15,
    color: colors.muted,
    fontWeight: "500",
    letterSpacing: -0.1,
    marginTop: -4,
  },
  form: {
    paddingHorizontal: 20,
    gap: 12,
  },

  // Fields
  field: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    minHeight: 64,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  fieldInput: {
    flex: 1,
    fontSize: 17,
    color: colors.text,
    fontWeight: "500",
    letterSpacing: -0.2,
    padding: 0,
    margin: 0,
  },
  eyeBtn: {
    padding: 4,
  },

  // Buttons
  btnSSO: {
    height: 54,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: colors.hairlineHi,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  btnSSOText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    letterSpacing: -0.2,
  },
  btnPrimary: {
    height: 54,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  btnPrimaryDisabled: {
    opacity: 0.5,
  },
  btnText: {
    fontSize: 17,
    fontWeight: "600",
    color: "#fff",
    letterSpacing: -0.2,
  },
  btnGhost: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: colors.hairlineHi,
  },
  btn: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },

  // Divider
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.hairline,
  },
  dividerText: {
    fontSize: 11,
    color: colors.faint,
    letterSpacing: 1.5,
    fontWeight: "600",
  },

  // Footer
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 20,
    marginTop: 14,
    paddingHorizontal: 4,
  },
  footerLink: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.muted,
  },

  // Disabled message
  disabledMsg: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: "rgba(255,107,107,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,107,107,0.25)",
  },
  disabledMsgText: {
    fontSize: 14,
    color: colors.danger,
    textAlign: "center",
    lineHeight: 20,
  },

  // Server modal
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  modalSheet: {
    backgroundColor: "#1C2140",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 16,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderBottomWidth: 0,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.hairlineHi,
    alignSelf: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.4,
  },
  modalHint: {
    fontSize: 14,
    color: colors.muted,
    marginTop: 6,
    letterSpacing: -0.1,
  },
  modalError: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  modalErrorText: {
    fontSize: 13,
    color: colors.danger,
    flex: 1,
    lineHeight: 18,
  },
  demoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    alignSelf: "flex-start",
  },
  demoBtnText: {
    fontSize: 13,
    color: colors.orange,
    fontWeight: "500",
  },
  modalButtons: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },

  // Spinner
  spinner: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.3)",
    borderTopColor: "#fff",
  },
});
