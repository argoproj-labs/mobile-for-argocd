import AsyncStorage from "@react-native-async-storage/async-storage";

const SERVER_URL_KEY = "argocd:server-url";
const TOKEN_KEY = "argocd:token";

// Sentinel stored as the "token" after a browser (WebView) login. Argo CD's
// argocd.token cookie is HttpOnly, so there is no bearer to keep — auth rides
// the shared native cookie jar instead. authHeader() sends no Bearer for this.
export const COOKIE_SESSION = "__cookie_session__";

export const serverStorage = {
  get: () => AsyncStorage.getItem(SERVER_URL_KEY),
  set: (url: string) => AsyncStorage.setItem(SERVER_URL_KEY, url),
  clear: () => AsyncStorage.removeItem(SERVER_URL_KEY),
};

export const tokenStorage = {
  get: () => AsyncStorage.getItem(TOKEN_KEY),
  set: (token: string) => AsyncStorage.setItem(TOKEN_KEY, token),
  clear: () => AsyncStorage.removeItem(TOKEN_KEY),
};

// ── Multi-instance types ───────────────────────────────────────

// A known Argo CD server. An empty `token` means the server has been added but
// not signed in to yet — it still belongs in the list, it just has no session.
export type Instance = {
  id: string;
  url: string;
  token: string;
};

export const hasSession = (inst: Instance | null | undefined): boolean =>
  !!inst && inst.token !== "";

// ── Multi-instance storage ─────────────────────────────────────

const INSTANCES_KEY = "argocd:instances";
const ACTIVE_INSTANCE_KEY = "argocd:active-instance";
const LEGACY_FAVORITES_KEY = "argocd:favorites";
const FAVORITES_KEY_PREFIX = "argocd:favorites:";

export const instancesStorage = {
  get: async (): Promise<Instance[]> => {
    const raw = await AsyncStorage.getItem(INSTANCES_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as Instance[];
    } catch {
      return [];
    }
  },
  set: (instances: Instance[]) =>
    AsyncStorage.setItem(INSTANCES_KEY, JSON.stringify(instances)),
};

export const activeInstanceStorage = {
  get: () => AsyncStorage.getItem(ACTIVE_INSTANCE_KEY),
  set: (id: string) => AsyncStorage.setItem(ACTIVE_INSTANCE_KEY, id),
  clear: () => AsyncStorage.removeItem(ACTIVE_INSTANCE_KEY),
};

export const instanceFavoritesStorage = {
  get: async (instanceId: string): Promise<Set<string>> => {
    const raw = await AsyncStorage.getItem(FAVORITES_KEY_PREFIX + instanceId);
    if (!raw) return new Set();
    try {
      return new Set(JSON.parse(raw) as string[]);
    } catch {
      return new Set();
    }
  },
  set: (instanceId: string, favs: Set<string>) =>
    AsyncStorage.setItem(
      FAVORITES_KEY_PREFIX + instanceId,
      JSON.stringify(Array.from(favs)),
    ),
};

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function upsertInstance(
  url: string,
  token: string,
): Promise<Instance> {
  const instances = await instancesStorage.get();
  const existing = instances.find((i) => i.url === url);
  if (existing) {
    existing.token = token;
    await instancesStorage.set(instances);
    await activeInstanceStorage.set(existing.id);
    return existing;
  }
  const inst: Instance = { id: generateId(), url, token };
  await instancesStorage.set([...instances, inst]);
  await activeInstanceStorage.set(inst.id);
  return inst;
}

// Add a server without signing in to it. Returns the existing entry when the
// URL is already known so re-adding never duplicates.
export async function addServer(url: string): Promise<Instance> {
  const instances = await instancesStorage.get();
  const existing = instances.find((i) => i.url === url);
  if (existing) return existing;

  const inst: Instance = { id: generateId(), url, token: "" };
  await instancesStorage.set([...instances, inst]);
  return inst;
}

// Repoint an existing entry at a different URL. Any session is dropped — a
// token issued by the old server is meaningless to the new one.
export async function updateInstanceUrl(
  id: string,
  url: string,
): Promise<void> {
  const instances = await instancesStorage.get();
  const inst = instances.find((i) => i.id === id);
  if (!inst || inst.url === url) return;

  inst.url = url;
  inst.token = "";
  await instancesStorage.set(instances);
}

// Migrate from legacy flat storage (argocd:server-url / argocd:token) to
// the new per-instance list. Idempotent — skips if instances already exist.
export async function migrateLegacyStorage(): Promise<void> {
  const instances = await instancesStorage.get();
  if (instances.length > 0) return;

  const [token, server] = await Promise.all([
    tokenStorage.get(),
    serverStorage.get(),
  ]);
  // A saved URL is worth keeping even with no token — it is the server the
  // user was last signing in to, and dropping it would lose their only entry.
  if (!server) return;

  const inst = token
    ? await upsertInstance(server, token)
    : await addServer(server);
  await activeInstanceStorage.set(inst.id);

  // Carry over legacy favorites to the new per-instance key
  const legacyFavs = await AsyncStorage.getItem(LEGACY_FAVORITES_KEY);
  if (legacyFavs) {
    await AsyncStorage.setItem(FAVORITES_KEY_PREFIX + inst.id, legacyFavs);
  }

  // Retire the legacy keys so removing every instance doesn't resurrect one
  // from them on the next launch.
  await Promise.all([serverStorage.clear(), tokenStorage.clear()]);
}

// Legacy favorites export — kept so old import sites compile; superseded by
// instanceFavoritesStorage for new code.
const FAVORITES_KEY = "argocd:favorites";

export const favoritesStorage = {
  get: async (): Promise<Set<string>> => {
    const raw = await AsyncStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  },
  set: async (favs: Set<string>): Promise<void> => {
    await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(favs)));
  },
};
