import { COOKIE_SESSION } from "./storage";

export interface UserInfo {
  loggedIn: boolean;
  username: string;
  iss: string;
  groups?: string[];
}

function authHeader(token: string): Record<string, string> {
  // COOKIE_SESSION / "anonymous" / empty → no bearer; rely on the cookie jar.
  return token && token !== "anonymous" && token !== COOKIE_SESSION
    ? { Authorization: `Bearer ${token}` }
    : {};
}

// Parse a response as JSON, but fail with a readable message when a proxy
// returns its own HTML login page instead of Argo CD's JSON. Without this the
// bare res.json() throws "Unexpected token '<'", surfacing as a "json error".
async function readJson<T>(res: Response): Promise<T> {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    throw new Error(
      "Server returned a non-JSON response. Argo CD may be behind a login " +
        'proxy — try "Sign in via browser".',
    );
  }
  return res.json() as Promise<T>;
}

export async function getUserInfo(
  serverUrl: string,
  token: string,
): Promise<UserInfo> {
  const res = await fetch(`${serverUrl}/api/v1/session/userinfo`, {
    headers: authHeader(token),
  });
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<UserInfo>;
}

export interface AuthSettings {
  url?: string;
  dexConfig?: {
    connectors?: { id: string; name: string; type: string }[];
  };
  oidcConfig?: {
    name: string;
    issuer: string;
    clientID: string;
    cliClientID?: string;
    scopes?: string[];
  };
  userLoginsDisabled?: boolean;
}

export interface OidcFlowConfig {
  issuer: string;
  clientId: string;
  scopes: string[];
  // Pre-built endpoints — set for Dex to avoid fetching /.well-known/
  // (the endpoint is often unreachable from mobile due to proxy/network rules)
  endpoints?: {
    authorizationEndpoint: string;
    tokenEndpoint: string;
  };
}

export function resolveOidcConfig(
  settings: AuthSettings,
  serverUrl: string,
): OidcFlowConfig | null {
  if (settings.oidcConfig) {
    return {
      issuer: settings.oidcConfig.issuer,
      clientId: settings.oidcConfig.cliClientID ?? settings.oidcConfig.clientID,
      scopes: settings.oidcConfig.scopes?.length
        ? settings.oidcConfig.scopes
        : ["openid", "profile", "email", "groups"],
    };
  }
  if (settings.dexConfig?.connectors?.length) {
    // Dex issuer lives at {argocd_url}/api/dex — prefer the URL the server
    // reports over the client-supplied serverUrl to handle reverse-proxy setups
    const base = (settings.url ?? serverUrl).replace(/\/+$/, "");
    const issuer = `${base}/api/dex`;
    return {
      issuer,
      clientId: "argo-cd-cli",
      scopes: ["openid", "profile", "email", "groups", "offline_access"],
      // Dex paths are well-known; building them avoids fetching /.well-known/
      // which may be blocked by the proxy sitting in front of ArgoCD
      endpoints: {
        authorizationEndpoint: `${issuer}/auth`,
        tokenEndpoint: `${issuer}/token`,
      },
    };
  }
  return null;
}

export function normalizeUrl(raw: string): string {
  const u = raw.trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) return `https://${u}`;
  return u.replace(/\/+$/, "");
}

export function hostFromUrl(url: string): string {
  try {
    return new URL(normalizeUrl(url)).host;
  } catch {
    return url;
  }
}

export async function fetchAuthSettings(
  serverUrl: string,
): Promise<AuthSettings> {
  const res = await fetch(`${serverUrl}/api/v1/settings`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return readJson<AuthSettings>(res);
}

// Log out of the Argo CD session. The server responds with a Set-Cookie that
// overwrites argocd.token with an empty value, which the native cookie jar
// applies — the only way to invalidate the HttpOnly cookie captured during a
// browser login, since JS can neither read nor clear it. After this, requests
// carry an empty token and the server treats them as unauthenticated.
export async function logout(serverUrl: string): Promise<void> {
  // Best-effort server-side logout. NOTE: this alone does not end a browser
  // (cookie) session — Argo CD clears the cookie with an empty value and no
  // Max-Age, which iOS's cookie jar ignores, so the HttpOnly argocd.token
  // survives. Fully clearing it requires a native cookie API (not available
  // in Expo Go); see the logout flow in the caller.
  await fetch(`${serverUrl}/api/v1/session`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  }).catch(() => {});
}

export async function loginWithPassword(
  serverUrl: string,
  username: string,
  password: string,
): Promise<string> {
  const res = await fetch(`${serverUrl}/api/v1/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, string>;
    throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
  }
  const data = await readJson<{ token: string }>(res);
  return data.token;
}

// ── Application model ─────────────────────────────────────────

export interface RevisionHistory {
  id: number;
  revision?: string;
  revisions?: string[];
  source?: AppSource;
  sources?: AppSource[];
  deployStartedAt?: string;
  deployedAt: string;
  initiatedBy?: { username?: string; automated?: boolean };
}

export interface AppSource {
  repoURL: string;
  targetRevision?: string;
  path?: string;
  chart?: string;
}

export interface Application {
  metadata: {
    name: string;
    namespace: string;
    resourceVersion?: string;
    annotations?: Record<string, string>;
    labels?: Record<string, string>;
    creationTimestamp?: string;
    deletionTimestamp?: string;
  };
  spec: {
    project: string;
    source?: AppSource;
    sources?: AppSource[];
    destination: {
      server?: string;
      name?: string;
      namespace?: string;
    };
    syncPolicy?: {
      automated?: { prune?: boolean; selfHeal?: boolean };
      syncOptions?: string[];
    };
  };
  operation?: {
    sync?: Record<string, unknown>;
  };
  status: {
    health?: { status: string; message?: string };
    sync?: { status: string; revision?: string };
    operationState?: {
      phase?: string;
      startedAt?: string;
      finishedAt?: string;
      message?: string;
      syncResult?: { revision?: string; revisions?: string[] };
      operation?: { sync?: Record<string, unknown> };
    };
    summary?: {
      externalURLs?: string[];
      images?: string[];
    };
    resources?: {
      group?: string;
      version?: string;
      kind: string;
      name: string;
      namespace?: string;
      status?: string;
      health?: { status: string; message?: string };
      hook?: boolean;
      requiresPruning?: boolean;
      syncWave?: number;
    }[];
    history?: RevisionHistory[];
    conditions?: {
      type: string;
      message: string;
      lastTransitionTime?: string;
    }[];
    sourceHydrator?: Record<string, unknown>;
  };
}

export function appKey(app: Application): string {
  return `${app.metadata.namespace ?? "argocd"}/${app.metadata.name}`;
}

export function appSource(app: Application): AppSource | null {
  return app.spec.source ?? app.spec.sources?.[0] ?? null;
}

// ── Applications API ──────────────────────────────────────────

const APP_FIELDS = [
  "metadata.name",
  "metadata.namespace",
  "metadata.annotations",
  "metadata.labels",
  "metadata.creationTimestamp",
  "metadata.deletionTimestamp",
  "spec",
  "operation.sync",
  "status.sourceHydrator",
  "status.sync.status",
  "status.sync.revision",
  "status.health",
  "status.operationState.phase",
  "status.operationState.finishedAt",
  "status.operationState.operation.sync",
  "status.summary",
  "status.resources",
  "status.history",
];

const LIST_FIELDS = [
  "metadata.resourceVersion",
  ...APP_FIELDS.map((f) => `items.${f}`),
].join(",");

const WATCH_FIELDS = [
  "result.type",
  ...APP_FIELDS.map((f) => `result.application.${f}`),
].join(",");

export async function getApplication(
  serverUrl: string,
  token: string,
  name: string,
  namespace: string,
): Promise<Application> {
  const res = await fetch(
    `${serverUrl}/api/v1/applications/${encodeURIComponent(name)}?appNamespace=${encodeURIComponent(namespace)}`,
    { headers: authHeader(token) },
  );
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<Application>;
}

export async function refreshApplication(
  serverUrl: string,
  token: string,
  name: string,
  namespace: string,
  hard = false,
): Promise<Application> {
  const params = new URLSearchParams({
    appNamespace: namespace,
    refresh: hard ? "hard" : "normal",
  });
  const res = await fetch(
    `${serverUrl}/api/v1/applications/${encodeURIComponent(name)}?${params.toString()}`,
    { headers: authHeader(token) },
  );
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<Application>;
}

export interface SyncApplicationOptions {
  revision?: string;
  prune?: boolean;
  dryRun?: boolean;
  applyOnly?: boolean;
  force?: boolean;
  syncOptions?: string[];
  resources?:
    | {
        group?: string;
        kind: string;
        name: string;
        namespace?: string;
      }[]
    | null;
}

export async function syncApplication(
  serverUrl: string,
  token: string,
  name: string,
  namespace: string,
  opts: SyncApplicationOptions = {},
): Promise<void> {
  const force = opts.force ?? false;
  const strategy = opts.applyOnly ? { apply: { force } } : { hook: { force } };

  const res = await fetch(
    `${serverUrl}/api/v1/applications/${encodeURIComponent(name)}/sync`,
    {
      method: "POST",
      headers: {
        ...authHeader(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        appNamespace: namespace,
        revision: opts.revision || "HEAD",
        prune: opts.prune ?? false,
        dryRun: opts.dryRun ?? false,
        strategy,
        resources: opts.resources ?? null,
        syncOptions: opts.syncOptions?.length
          ? { items: opts.syncOptions }
          : null,
      }),
    },
  );
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, string>;
    throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
  }
}

export async function rollbackApplication(
  serverUrl: string,
  token: string,
  name: string,
  namespace: string,
  id: number,
): Promise<void> {
  const res = await fetch(
    `${serverUrl}/api/v1/applications/${encodeURIComponent(name)}/rollback`,
    {
      method: "POST",
      headers: {
        ...authHeader(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id, appNamespace: namespace }),
    },
  );
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, string>;
    throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
  }
}

// ── Resource tree ─────────────────────────────────────────────

export interface ResourceRef {
  uid?: string;
  kind: string;
  namespace?: string;
  name: string;
  version?: string;
  group?: string;
}

export interface ResourceNode {
  group?: string;
  version?: string;
  kind: string;
  namespace?: string;
  name: string;
  uid?: string;
  resourceVersion?: string;
  parentRefs?: ResourceRef[];
  health?: { status: string; message?: string };
  info?: { name: string; value: string }[];
  images?: string[];
  createdAt?: string;
}

export interface ResourceTree {
  nodes?: ResourceNode[];
  orphanedNodes?: ResourceNode[];
}

export async function getResource(
  serverUrl: string,
  token: string,
  appName: string,
  appNamespace: string,
  group: string | undefined,
  version: string | undefined,
  kind: string,
  namespace: string | undefined,
  resourceName: string,
): Promise<object> {
  const params = new URLSearchParams({
    appNamespace,
    resourceName,
    kind,
    group: group ?? "",
  });
  if (namespace) params.set("namespace", namespace);
  if (version) params.set("version", version);
  const res = await fetch(
    `${serverUrl}/api/v1/applications/${encodeURIComponent(appName)}/resource?${params.toString()}`,
    { headers: authHeader(token) },
  );
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { manifest?: string };
  return data.manifest ? (JSON.parse(data.manifest) as object) : {};
}

export async function deleteResource(
  serverUrl: string,
  token: string,
  appName: string,
  appNamespace: string,
  group: string | undefined,
  version: string | undefined,
  kind: string,
  namespace: string | undefined,
  resourceName: string,
  force: boolean,
  orphan: boolean,
): Promise<void> {
  const params = new URLSearchParams({
    appNamespace,
    resourceName,
    kind,
    group: group ?? "",
  });
  if (namespace) params.set("namespace", namespace);
  if (version) params.set("version", version);
  if (force) params.set("force", "true");
  if (orphan) params.set("orphan", "true");
  const res = await fetch(
    `${serverUrl}/api/v1/applications/${encodeURIComponent(appName)}/resource?${params.toString()}`,
    {
      method: "DELETE",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
    },
  );
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function patchResource(
  serverUrl: string,
  token: string,
  appName: string,
  appNamespace: string,
  group: string | undefined,
  version: string | undefined,
  kind: string,
  namespace: string | undefined,
  resourceName: string,
  patch: string,
  patchType = "application/merge-patch+json",
): Promise<void> {
  const params = new URLSearchParams({
    appNamespace,
    resourceName,
    kind,
    group: group ?? "",
    patchType,
  });
  if (namespace) params.set("namespace", namespace);
  if (version) params.set("version", version);
  const res = await fetch(
    `${serverUrl}/api/v1/applications/${encodeURIComponent(appName)}/resource?${params.toString()}`,
    {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, string>;
    throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
  }
}

// ── Resource actions ──────────────────────────────────────────

export interface ResourceActionParam {
  name: string;
  value: string;
  type: string;
  default: string;
}

export interface ResourceAction {
  name: string;
  params?: ResourceActionParam[];
  disabled?: boolean;
  iconClass?: string;
  displayName?: string;
}

export async function getResourceActions(
  serverUrl: string,
  token: string,
  appName: string,
  appNamespace: string,
  group: string | undefined,
  version: string | undefined,
  kind: string,
  namespace: string | undefined,
  resourceName: string,
): Promise<ResourceAction[]> {
  const params = new URLSearchParams({
    appNamespace,
    resourceName,
    kind,
    group: group ?? "",
  });
  if (namespace) params.set("namespace", namespace);
  if (version) params.set("version", version);
  const res = await fetch(
    `${serverUrl}/api/v1/applications/${encodeURIComponent(appName)}/resource/actions?${params.toString()}`,
    { headers: authHeader(token) },
  );
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { actions?: ResourceAction[] };
  const actions = data.actions ?? [];
  actions.sort((a, b) => a.name.localeCompare(b.name));
  return actions;
}

export async function runResourceAction(
  serverUrl: string,
  token: string,
  appName: string,
  appNamespace: string,
  group: string | undefined,
  version: string | undefined,
  kind: string,
  namespace: string | undefined,
  resourceName: string,
  action: string,
  actionParams: ResourceActionParam[],
): Promise<void> {
  const res = await fetch(
    `${serverUrl}/api/v1/applications/${encodeURIComponent(appName)}/resource/actions/v2`,
    {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        appNamespace,
        namespace,
        resourceName,
        version,
        kind,
        group: group ?? "",
        action,
        resourceActionParameters: actionParams,
      }),
    },
  );
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, string>;
    throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
  }
}

export async function getManagedResource(
  serverUrl: string,
  token: string,
  appName: string,
  appNamespace: string,
  group: string | undefined,
  kind: string,
  namespace: string | undefined,
  resourceName: string,
): Promise<ManagedResource | null> {
  const params = new URLSearchParams({
    appNamespace,
    name: resourceName,
    kind,
  });
  if (namespace) params.set("namespace", namespace);
  if (group) params.set("group", group);
  const res = await fetch(
    `${serverUrl}/api/v1/applications/${encodeURIComponent(appName)}/managed-resources?${params.toString()}`,
    { headers: authHeader(token) },
  );
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { items: ManagedResource[] };
  return data.items?.[0] ?? null;
}

export async function getResourceTree(
  serverUrl: string,
  token: string,
  name: string,
  namespace: string,
): Promise<ResourceTree> {
  const res = await fetch(
    `${serverUrl}/api/v1/applications/${encodeURIComponent(name)}/resource-tree?appNamespace=${encodeURIComponent(namespace)}`,
    { headers: authHeader(token) },
  );
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<ResourceTree>;
}

export function watchResourceTree(
  serverUrl: string,
  token: string,
  name: string,
  namespace: string,
  onTree: (tree: ResourceTree) => void,
  signal: AbortSignal,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RNEventSource = require("react-native-sse")
    .default as typeof import("react-native-sse").default;

  const url = `${serverUrl}/api/v1/stream/applications/${encodeURIComponent(name)}/resource-tree?appNamespace=${encodeURIComponent(namespace)}`;

  return new Promise((resolve, reject) => {
    const es = new RNEventSource(url, { headers: authHeader(token) });
    const cleanup = () => es.close();

    es.addEventListener("message", (event) => {
      if (!event.data) return;
      try {
        const evt = JSON.parse(event.data) as {
          result?: ResourceTree;
          error?: { message: string };
        };
        if (evt.error) {
          cleanup();
          reject(new Error(evt.error.message));
          return;
        }
        if (evt.result) onTree(evt.result);
      } catch {
        // skip malformed messages
      }
    });

    es.addEventListener("error", (event) => {
      cleanup();
      if ("xhrStatus" in event && event.xhrStatus === 401) {
        reject(new Error("Unauthorized"));
      } else {
        const msg = "message" in event ? event.message : "Watch error";
        reject(new Error(msg));
      }
    });

    es.addEventListener("close", () => resolve());
    signal.addEventListener("abort", () => {
      cleanup();
      resolve();
    });
  });
}

// ── Managed resources / diff ──────────────────────────────────

export interface ManagedResource {
  group?: string;
  version?: string;
  kind: string;
  namespace?: string;
  name: string;
  targetState?: string;
  liveState?: string;
  normalizedLiveState?: string;
  predictedLiveState?: string;
  hook?: boolean;
  requiresPruning?: boolean;
}

export async function getManagedResources(
  serverUrl: string,
  token: string,
  name: string,
  namespace: string,
): Promise<ManagedResource[]> {
  const res = await fetch(
    `${serverUrl}/api/v1/applications/${encodeURIComponent(name)}/managed-resources?appNamespace=${encodeURIComponent(namespace)}`,
    { headers: authHeader(token) },
  );
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { items: ManagedResource[] };
  return data.items ?? [];
}

export async function listApplications(
  serverUrl: string,
  token: string,
): Promise<{ items: Application[]; resourceVersion: string }> {
  const res = await fetch(
    `${serverUrl}/api/v1/applications?fields=${encodeURIComponent(LIST_FIELDS)}`,
    { headers: authHeader(token) },
  );
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as {
    metadata: { resourceVersion: string };
    items: Application[];
  };
  return {
    items: data.items ?? [],
    resourceVersion: data.metadata.resourceVersion,
  };
}

export function watchApplication(
  serverUrl: string,
  token: string,
  name: string,
  namespace: string,
  resourceVersion: string,
  onEvent: (type: string, app: Application) => void,
  signal: AbortSignal,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RNEventSource = require("react-native-sse")
    .default as typeof import("react-native-sse").default;

  const params = new URLSearchParams({
    name,
    appNamespace: namespace,
    resourceVersion,
  });
  const url = `${serverUrl}/api/v1/stream/applications?${params.toString()}`;

  return new Promise((resolve, reject) => {
    const es = new RNEventSource(url, {
      headers: authHeader(token),
    });

    const cleanup = () => {
      es.close();
    };

    es.addEventListener("message", (event) => {
      if (!event.data) return;
      try {
        const evt = JSON.parse(event.data) as {
          result?: { type: string; application: Application };
          error?: { message: string };
        };
        if (evt.error) {
          cleanup();
          reject(new Error(evt.error.message));
          return;
        }
        if (evt.result?.type && evt.result.application) {
          onEvent(evt.result.type, evt.result.application);
        }
      } catch {
        // skip malformed messages
      }
    });

    es.addEventListener("error", (event) => {
      cleanup();
      if ("xhrStatus" in event && event.xhrStatus === 401) {
        reject(new Error("Unauthorized"));
      } else {
        const msg = "message" in event ? event.message : "Watch error";
        reject(new Error(msg));
      }
    });

    es.addEventListener("close", () => {
      resolve();
    });

    signal.addEventListener("abort", () => {
      cleanup();
      resolve();
    });
  });
}

// ── Pod logs ──────────────────────────────────────────────────

export interface LogEntry {
  content: string;
  timeStamp?: string;
  timeStampStr?: string;
  podName?: string;
  last?: boolean;
  first?: boolean;
}

export function streamLogs(
  serverUrl: string,
  token: string,
  appName: string,
  appNamespace: string,
  namespace: string,
  podName: string | undefined,
  group: string | undefined,
  kind: string | undefined,
  resourceName: string | undefined,
  container: string,
  tail: number,
  follow: boolean,
  previous: boolean,
  onEntry: (entry: LogEntry) => void,
  onError: (err: Error) => void,
  onDone: () => void,
): () => void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RNEventSource = require("react-native-sse")
    .default as typeof import("react-native-sse").default;

  const params = new URLSearchParams({
    appNamespace,
    container,
    namespace,
    follow: follow.toString(),
    tailLines: String(tail),
    sinceSeconds: "0",
  });
  if (podName) {
    params.set("podName", podName);
  } else {
    params.set("group", group ?? "");
    if (kind) params.set("kind", kind);
    if (resourceName) params.set("resourceName", resourceName);
  }
  if (previous) params.set("previous", "true");

  const url = `${serverUrl}/api/v1/applications/${encodeURIComponent(appName)}/logs?${params.toString()}`;

  const es = new RNEventSource(url, {
    headers: authHeader(token),
  });

  const cleanup = () => es.close();

  es.addEventListener("message", (event) => {
    if (!event.data) return;
    try {
      const parsed = JSON.parse(event.data) as {
        result?: LogEntry;
        error?: { message?: string };
      };
      if (parsed.error) {
        cleanup();
        onError(new Error(parsed.error.message ?? "Log stream error"));
        return;
      }
      if (parsed.result) {
        if (parsed.result.last) {
          cleanup();
          onDone();
        } else {
          onEntry(parsed.result);
        }
      }
    } catch {
      // skip malformed events
    }
  });

  es.addEventListener("error", (event) => {
    cleanup();
    const msg =
      "message" in event && event.message
        ? String(event.message)
        : "Stream error";
    onError(new Error(msg));
  });

  return cleanup;
}

export function watchApplications(
  serverUrl: string,
  token: string,
  resourceVersion: string,
  onEvent: (type: string, app: Application) => void,
  signal: AbortSignal,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RNEventSource = require("react-native-sse")
    .default as typeof import("react-native-sse").default;

  const url = `${serverUrl}/api/v1/stream/applications?resourceVersion=${encodeURIComponent(resourceVersion)}&fields=${encodeURIComponent(WATCH_FIELDS)}`;

  return new Promise((resolve, reject) => {
    const es = new RNEventSource(url, {
      headers: authHeader(token),
    });

    const cleanup = () => {
      es.close();
    };

    es.addEventListener("message", (event) => {
      if (!event.data) return;
      try {
        const evt = JSON.parse(event.data) as {
          result?: { type: string; application: Application };
          error?: { message: string };
        };
        if (evt.error) {
          cleanup();
          reject(new Error(evt.error.message));
          return;
        }
        if (evt.result?.type && evt.result.application) {
          onEvent(evt.result.type, evt.result.application);
        }
      } catch {
        // skip malformed messages
      }
    });

    es.addEventListener("error", (event) => {
      cleanup();
      if ("xhrStatus" in event && event.xhrStatus === 401) {
        reject(new Error("Unauthorized"));
      } else {
        const msg = "message" in event ? event.message : "Watch error";
        reject(new Error(msg));
      }
    });

    es.addEventListener("close", () => {
      resolve();
    });

    signal.addEventListener("abort", () => {
      cleanup();
      resolve();
    });
  });
}
