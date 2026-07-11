import AsyncStorage from "@react-native-async-storage/async-storage";

export interface Account {
  id: string;
  serverUrl: string;
  token: string;
  username?: string;
}

const ACCOUNTS_KEY = "argocd:accounts";
const ACTIVE_ACCOUNT_KEY = "argocd:active-account";

// Pre-multi-account keys. Migrated into `accounts` the first time storage
// is read after an update, then removed.
const LEGACY_SERVER_URL_KEY = "argocd:server-url";
const LEGACY_TOKEN_KEY = "argocd:token";

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readAccounts(): Promise<Account[]> {
  const raw = await AsyncStorage.getItem(ACCOUNTS_KEY);
  return raw ? (JSON.parse(raw) as Account[]) : [];
}

async function writeAccounts(accounts: Account[]): Promise<void> {
  await AsyncStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

// One-time migration from the single server/token pair used before
// multi-account support existed.
async function migrateLegacy(): Promise<void> {
  const [legacyServer, legacyToken, hasAccounts] = await Promise.all([
    AsyncStorage.getItem(LEGACY_SERVER_URL_KEY),
    AsyncStorage.getItem(LEGACY_TOKEN_KEY),
    AsyncStorage.getItem(ACCOUNTS_KEY),
  ]);
  if (hasAccounts || !legacyServer || legacyToken === null) return;
  const account: Account = {
    id: generateId(),
    serverUrl: legacyServer,
    token: legacyToken,
  };
  await writeAccounts([account]);
  await AsyncStorage.setItem(ACTIVE_ACCOUNT_KEY, account.id);
  await AsyncStorage.multiRemove([LEGACY_SERVER_URL_KEY, LEGACY_TOKEN_KEY]);
}

export const accountsStorage = {
  list: async (): Promise<Account[]> => {
    await migrateLegacy();
    return readAccounts();
  },

  getActiveId: (): Promise<string | null> =>
    AsyncStorage.getItem(ACTIVE_ACCOUNT_KEY),

  setActiveId: (id: string): Promise<void> =>
    AsyncStorage.setItem(ACTIVE_ACCOUNT_KEY, id),

  getActive: async (): Promise<Account | null> => {
    const [accounts, activeId] = await Promise.all([
      accountsStorage.list(),
      accountsStorage.getActiveId(),
    ]);
    return accounts.find((a) => a.id === activeId) ?? accounts[0] ?? null;
  },

  // Adds (or, if the server+token pair already exists, re-activates) an
  // account and marks it active.
  add: async (input: {
    serverUrl: string;
    token: string;
    username?: string;
  }): Promise<Account> => {
    const accounts = await accountsStorage.list();
    const existing = accounts.find(
      (a) => a.serverUrl === input.serverUrl && a.token === input.token,
    );
    const account: Account = existing
      ? { ...existing, username: input.username ?? existing.username }
      : { ...input, id: generateId() };
    const next = existing
      ? accounts.map((a) => (a.id === account.id ? account : a))
      : [...accounts, account];
    await writeAccounts(next);
    await accountsStorage.setActiveId(account.id);
    return account;
  },

  updateUsername: async (id: string, username: string): Promise<void> => {
    const accounts = await accountsStorage.list();
    await writeAccounts(
      accounts.map((a) => (a.id === id ? { ...a, username } : a)),
    );
  },

  // Removes an account. If it was active, activates the next remaining
  // account (or clears the active pointer if none remain).
  remove: async (id: string): Promise<void> => {
    const accounts = await accountsStorage.list();
    const next = accounts.filter((a) => a.id !== id);
    await writeAccounts(next);
    const activeId = await accountsStorage.getActiveId();
    if (activeId === id) {
      if (next.length > 0) await accountsStorage.setActiveId(next[0].id);
      else await AsyncStorage.removeItem(ACTIVE_ACCOUNT_KEY);
    }
  },
};

// Remembers the last server URL entered on the login screen, purely to
// prefill the field — unrelated to which accounts are signed in.
const LAST_SERVER_KEY = "argocd:last-server-url";
export const serverStorage = {
  get: () => AsyncStorage.getItem(LAST_SERVER_KEY),
  set: (url: string) => AsyncStorage.setItem(LAST_SERVER_KEY, url),
};

const FAVORITES_KEY_PREFIX = "argocd:favorites:";

export const favoritesStorage = {
  get: async (accountId: string): Promise<Set<string>> => {
    const raw = await AsyncStorage.getItem(FAVORITES_KEY_PREFIX + accountId);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  },
  set: async (accountId: string, favs: Set<string>): Promise<void> => {
    await AsyncStorage.setItem(
      FAVORITES_KEY_PREFIX + accountId,
      JSON.stringify(Array.from(favs)),
    );
  },
};
