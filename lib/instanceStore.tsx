import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  type Instance,
  activeInstanceStorage,
  addServer as storageAddServer,
  hasSession,
  instancesStorage,
  migrateLegacyStorage,
  updateInstanceUrl as storageUpdateUrl,
  upsertInstance as storageUpsert,
} from "./storage";

type InstanceStore = {
  instances: Instance[];
  activeId: string | null;
  /** The selected server, signed in or not. */
  activeInstance: Instance | null;
  /** The selected server only when it has a usable session. */
  activeSession: Instance | null;
  isLoaded: boolean;
  upsertInstance: (url: string, token: string) => Promise<Instance>;
  addServer: (url: string) => Promise<Instance>;
  updateInstanceUrl: (id: string, url: string) => Promise<void>;
  removeInstance: (id: string) => Promise<void>;
  switchInstance: (id: string) => Promise<void>;
};

const InstanceStoreContext = createContext<InstanceStore | null>(null);

export function useInstanceStore(): InstanceStore {
  const store = useContext(InstanceStoreContext);
  if (!store)
    throw new Error(
      "useInstanceStore must be used within InstanceStoreProvider",
    );
  return store;
}

export function InstanceStoreProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      await migrateLegacyStorage();
      const [storedInstances, storedActiveId] = await Promise.all([
        instancesStorage.get(),
        activeInstanceStorage.get(),
      ]);
      // A stored id can outlive its instance (interrupted write, manual edit).
      // Fall back to the first server so the app never boots with servers
      // configured but none of them selected.
      const resolvedId =
        storedActiveId && storedInstances.some((i) => i.id === storedActiveId)
          ? storedActiveId
          : (storedInstances[0]?.id ?? null);
      if (resolvedId !== storedActiveId) {
        if (resolvedId) await activeInstanceStorage.set(resolvedId);
        else await activeInstanceStorage.clear();
      }

      setInstances(storedInstances);
      setActiveId(resolvedId);
      setIsLoaded(true);
    })();
  }, []);

  const activeInstance =
    instances.find((i: Instance) => i.id === activeId) ?? null;
  const activeSession = hasSession(activeInstance) ? activeInstance : null;

  const upsertInstance = useCallback(
    async (url: string, token: string): Promise<Instance> => {
      const inst = await storageUpsert(url, token);
      const updated = await instancesStorage.get();
      setInstances(updated);
      setActiveId(inst.id);
      return inst;
    },
    [],
  );

  // Adding selects the new server so the login form immediately points at it.
  const addServer = useCallback(async (url: string): Promise<Instance> => {
    const inst = await storageAddServer(url);
    const updated = await instancesStorage.get();
    setInstances(updated);
    await activeInstanceStorage.set(inst.id);
    setActiveId(inst.id);
    return inst;
  }, []);

  const updateInstanceUrl = useCallback(async (id: string, url: string) => {
    await storageUpdateUrl(id, url);
    setInstances(await instancesStorage.get());
  }, []);

  const removeInstance = useCallback(
    async (id: string) => {
      const newInstances = instances.filter((i: Instance) => i.id !== id);
      await instancesStorage.set(newInstances);

      if (activeId === id) {
        const next = newInstances[0] ?? null;
        if (next) {
          await activeInstanceStorage.set(next.id);
          setActiveId(next.id);
        } else {
          await activeInstanceStorage.clear();
          setActiveId(null);
        }
      }
      setInstances(newInstances);
    },
    [instances, activeId],
  );

  const switchInstance = useCallback(async (id: string) => {
    await activeInstanceStorage.set(id);
    setActiveId(id);
  }, []);

  return (
    <InstanceStoreContext.Provider
      value={{
        instances,
        activeId,
        activeInstance,
        activeSession,
        isLoaded,
        upsertInstance,
        addServer,
        updateInstanceUrl,
        removeInstance,
        switchInstance,
      }}
    >
      {children}
    </InstanceStoreContext.Provider>
  );
}
