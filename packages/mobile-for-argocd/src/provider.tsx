import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ArgoConnection } from "./api";
import { ArgoClient, ArgoClientContext } from "./client";
import { ResourceFilterProvider } from "./components/resource-filter";

export type InstanceSwitcherProps = {
  visible: boolean;
  onClose: () => void;
};

export type ArgoHost = {
  /** Called when the server rejects the session (HTTP 401). */
  onUnauthorized: () => void;
  /** Ends the session. The Log out row is hidden when omitted. */
  onLogout?: () => Promise<void>;
  /** Sheet opened from the server name on the apps screen. Hidden when omitted. */
  InstanceSwitcher?: React.ComponentType<InstanceSwitcherProps>;
};

const ArgoHostContext = createContext<ArgoHost | null>(null);

export function useArgoHost(): ArgoHost {
  const host = useContext(ArgoHostContext);
  if (!host) throw new Error("useArgoHost must be used within ArgoProvider");
  return host;
}

export function ArgoProvider({
  connection,
  children,
  ...host
}: ArgoHost & {
  connection: ArgoConnection;
  children: React.ReactNode;
}) {
  const { onUnauthorized, onLogout, InstanceSwitcher } = host;

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 0,
            gcTime: 0,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (
          event.type === "updated" &&
          event.action.type === "error" &&
          event.action.error instanceof Error &&
          event.action.error.message === "Unauthorized"
        ) {
          onUnauthorized();
        }
      }),
    [queryClient, onUnauthorized],
  );

  const { id, serverUrl, name, headers } = connection;
  const client = useMemo(
    () => new ArgoClient({ id, serverUrl, name, headers }),
    [id, serverUrl, name, headers],
  );

  const hostValue = useMemo(
    () => ({ onUnauthorized, onLogout, InstanceSwitcher }),
    [onUnauthorized, onLogout, InstanceSwitcher],
  );

  return (
    <ArgoHostContext.Provider value={hostValue}>
      <ArgoClientContext.Provider value={client}>
        <QueryClientProvider client={queryClient}>
          <ResourceFilterProvider>{children}</ResourceFilterProvider>
        </QueryClientProvider>
      </ArgoClientContext.Provider>
    </ArgoHostContext.Provider>
  );
}
