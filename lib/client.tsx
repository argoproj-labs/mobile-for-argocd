import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useRouter } from "expo-router";
import {
  deleteResource,
  patchResource,
  getApplication,
  getManagedResource,
  getManagedResources,
  getResource,
  getResourceActions,
  getResourceTree,
  getUserInfo,
  listApplications,
  refreshApplication,
  rollbackApplication,
  runResourceAction,
  streamLogs,
  syncApplication,
  watchApplication,
  watchApplications,
  watchResourceTree,
  type Application,
  type LogEntry,
  type ResourceAction,
  type ResourceActionParam,
  type ResourceTree,
  type SyncApplicationOptions,
  type UserInfo,
} from "./api";
import { accountsStorage, type Account } from "./storage";

export class ArgoClient {
  constructor(
    readonly serverUrl: string,
    readonly token: string,
    readonly accountId: string,
  ) {}

  get hostname(): string {
    try {
      return new URL(this.serverUrl).hostname;
    } catch {
      return this.serverUrl;
    }
  }

  get queryKeys() {
    // Partition the cache by account, not server URL, since two accounts
    // (e.g. different users) can share the same server.
    const s = this.accountId;
    return {
      userInfo: () => ["userInfo", s] as const,
      applications: () => ["applications", s] as const,
      application: (namespace: string, name: string) =>
        ["application", s, namespace, name] as const,
      managedResources: (namespace: string, name: string) =>
        ["managedResources", s, namespace, name] as const,
      resourceTree: (namespace: string, name: string) =>
        ["resourceTree", s, namespace, name] as const,
      resource: (
        appNamespace: string,
        appName: string,
        group: string | undefined,
        version: string | undefined,
        kind: string,
        namespace: string | undefined,
        name: string,
      ) =>
        [
          "resource",
          s,
          appNamespace,
          appName,
          group,
          version,
          kind,
          namespace,
          name,
        ] as const,
      managedResource: (
        appNamespace: string,
        appName: string,
        group: string | undefined,
        kind: string,
        namespace: string | undefined,
        name: string,
      ) =>
        [
          "managedResource",
          s,
          appNamespace,
          appName,
          group,
          kind,
          namespace,
          name,
        ] as const,
      resourceActions: (
        appNamespace: string,
        appName: string,
        group: string | undefined,
        version: string | undefined,
        kind: string,
        namespace: string | undefined,
        name: string,
      ) =>
        [
          "resourceActions",
          s,
          appNamespace,
          appName,
          group,
          version,
          kind,
          namespace,
          name,
        ] as const,
    };
  }

  listApplications() {
    return listApplications(this.serverUrl, this.token);
  }

  getApplication(name: string, namespace: string) {
    return getApplication(this.serverUrl, this.token, name, namespace);
  }

  refreshApplication(name: string, namespace: string, hard = false) {
    return refreshApplication(
      this.serverUrl,
      this.token,
      name,
      namespace,
      hard,
    );
  }

  syncApplication(
    name: string,
    namespace: string,
    opts: SyncApplicationOptions = {},
  ) {
    return syncApplication(this.serverUrl, this.token, name, namespace, opts);
  }

  rollbackApplication(name: string, namespace: string, id: number) {
    return rollbackApplication(this.serverUrl, this.token, name, namespace, id);
  }

  getUserInfo(): Promise<UserInfo> {
    return getUserInfo(this.serverUrl, this.token);
  }

  watchApplication(
    name: string,
    namespace: string,
    resourceVersion: string,
    onEvent: (type: string, app: Application) => void,
    signal: AbortSignal,
  ) {
    return watchApplication(
      this.serverUrl,
      this.token,
      name,
      namespace,
      resourceVersion,
      onEvent,
      signal,
    );
  }

  getManagedResources(name: string, namespace: string) {
    return getManagedResources(this.serverUrl, this.token, name, namespace);
  }

  getResource(
    appName: string,
    appNamespace: string,
    group: string | undefined,
    version: string | undefined,
    kind: string,
    namespace: string | undefined,
    resourceName: string,
  ) {
    return getResource(
      this.serverUrl,
      this.token,
      appName,
      appNamespace,
      group,
      version,
      kind,
      namespace,
      resourceName,
    );
  }

  getManagedResource(
    appName: string,
    appNamespace: string,
    group: string | undefined,
    kind: string,
    namespace: string | undefined,
    resourceName: string,
  ) {
    return getManagedResource(
      this.serverUrl,
      this.token,
      appName,
      appNamespace,
      group,
      kind,
      namespace,
      resourceName,
    );
  }

  getResourceTree(name: string, namespace: string) {
    return getResourceTree(this.serverUrl, this.token, name, namespace);
  }

  watchResourceTree(
    name: string,
    namespace: string,
    onTree: (tree: ResourceTree) => void,
    signal: AbortSignal,
  ) {
    return watchResourceTree(
      this.serverUrl,
      this.token,
      name,
      namespace,
      onTree,
      signal,
    );
  }

  deleteResource(
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
    return deleteResource(
      this.serverUrl,
      this.token,
      appName,
      appNamespace,
      group,
      version,
      kind,
      namespace,
      resourceName,
      force,
      orphan,
    );
  }

  patchResource(
    appName: string,
    appNamespace: string,
    group: string | undefined,
    version: string | undefined,
    kind: string,
    namespace: string | undefined,
    resourceName: string,
    patch: string,
    patchType?: string,
  ): Promise<void> {
    return patchResource(
      this.serverUrl,
      this.token,
      appName,
      appNamespace,
      group,
      version,
      kind,
      namespace,
      resourceName,
      patch,
      patchType,
    );
  }

  getResourceActions(
    appName: string,
    appNamespace: string,
    group: string | undefined,
    version: string | undefined,
    kind: string,
    namespace: string | undefined,
    resourceName: string,
  ): Promise<ResourceAction[]> {
    return getResourceActions(
      this.serverUrl,
      this.token,
      appName,
      appNamespace,
      group,
      version,
      kind,
      namespace,
      resourceName,
    );
  }

  runResourceAction(
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
    return runResourceAction(
      this.serverUrl,
      this.token,
      appName,
      appNamespace,
      group,
      version,
      kind,
      namespace,
      resourceName,
      action,
      actionParams,
    );
  }

  streamLogs(
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
    return streamLogs(
      this.serverUrl,
      this.token,
      appName,
      appNamespace,
      namespace,
      podName,
      group,
      kind,
      resourceName,
      container,
      tail,
      follow,
      previous,
      onEntry,
      onError,
      onDone,
    );
  }

  watchApplications(
    resourceVersion: string,
    onEvent: (type: string, app: Application) => void,
    signal: AbortSignal,
  ) {
    return watchApplications(
      this.serverUrl,
      this.token,
      resourceVersion,
      onEvent,
      signal,
    );
  }
}

const ArgoClientContext = createContext<ArgoClient | null>(null);

export function useArgoClient(): ArgoClient {
  const client = useContext(ArgoClientContext);
  if (!client)
    throw new Error("useArgoClient must be used within ArgoClientProvider");
  return client;
}

interface AccountsContextValue {
  accounts: Account[];
  activeAccountId: string | null;
  switchAccount: (id: string) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  refreshAccounts: () => Promise<void>;
  updateUsername: (id: string, username: string) => Promise<void>;
}

const AccountsContext = createContext<AccountsContextValue | null>(null);

export function useAccounts(): AccountsContextValue {
  const ctx = useContext(AccountsContext);
  if (!ctx)
    throw new Error("useAccounts must be used within ArgoClientProvider");
  return ctx;
}

export function ArgoClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [client, setClient] = useState<ArgoClient | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);

  const activate = useCallback((account: Account) => {
    setActiveAccountId(account.id);
    setClient(new ArgoClient(account.serverUrl, account.token, account.id));
  }, []);

  const refreshAccounts = useCallback(async () => {
    const [list, active] = await Promise.all([
      accountsStorage.list(),
      accountsStorage.getActive(),
    ]);
    setAccounts(list);
    if (!active) {
      router.replace("/login");
      return;
    }
    activate(active);
  }, [router, activate]);

  useEffect(() => {
    refreshAccounts();
    // Only run once on mount — switching/removing accounts updates state
    // directly instead of re-reading storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchAccount = useCallback(
    async (id: string) => {
      const account = accounts.find((a) => a.id === id);
      if (!account) return;
      await accountsStorage.setActiveId(id);
      activate(account);
    },
    [accounts, activate],
  );

  const removeAccount = useCallback(
    async (id: string) => {
      await accountsStorage.remove(id);
      const list = await accountsStorage.list();
      setAccounts(list);
      const active = await accountsStorage.getActive();
      if (!active) {
        setClient(null);
        setActiveAccountId(null);
        router.replace("/login");
        return;
      }
      activate(active);
    },
    [router, activate],
  );

  const updateUsername = useCallback(async (id: string, username: string) => {
    await accountsStorage.updateUsername(id, username);
    setAccounts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, username } : a)),
    );
  }, []);

  if (!client) return null;

  return (
    <AccountsContext.Provider
      value={{
        accounts,
        activeAccountId,
        switchAccount,
        removeAccount,
        refreshAccounts,
        updateUsername,
      }}
    >
      <ArgoClientContext.Provider value={client}>
        {children}
      </ArgoClientContext.Provider>
    </AccountsContext.Provider>
  );
}
