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
  instancesStorage,
  migrateLegacyStorage,
  upsertInstance as storageUpsert,
} from "./storage";

type InstanceStore = {
  instances: Instance[];
  activeId: string | null;
  activeInstance: Instance | null;
  isLoaded: boolean;
  upsertInstance: (url: string, token: string) => Promise<Instance>;
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
      setInstances(storedInstances);
      setActiveId(storedActiveId);
      setIsLoaded(true);
    })();
  }, []);

  const activeInstance =
    instances.find((i: Instance) => i.id === activeId) ?? null;

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
        isLoaded,
        upsertInstance,
        removeInstance,
        switchInstance,
      }}
    >
      {children}
    </InstanceStoreContext.Provider>
  );
}
