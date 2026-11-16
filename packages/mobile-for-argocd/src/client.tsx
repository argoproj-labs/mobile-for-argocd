import { createContext, useContext } from "react";
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
  type ArgoConnection,
} from "./api";

export class ArgoClient {
  constructor(readonly connection: ArgoConnection) {}

  get serverUrl(): string {
    return this.connection.serverUrl;
  }

  get displayName(): string {
    return this.connection.name ?? this.hostname;
  }

  get hostname(): string {
    try {
      return new URL(this.serverUrl).hostname;
    } catch {
      return this.serverUrl;
    }
  }

  get queryKeys() {
    const s = this.serverUrl;
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
    return listApplications(this.connection);
  }

  getApplication(name: string, namespace: string) {
    return getApplication(this.connection, name, namespace);
  }

  refreshApplication(name: string, namespace: string, hard = false) {
    return refreshApplication(this.connection, name, namespace, hard);
  }

  syncApplication(
    name: string,
    namespace: string,
    opts: SyncApplicationOptions = {},
  ) {
    return syncApplication(this.connection, name, namespace, opts);
  }

  rollbackApplication(name: string, namespace: string, id: number) {
    return rollbackApplication(this.connection, name, namespace, id);
  }

  getUserInfo(): Promise<UserInfo> {
    return getUserInfo(this.connection);
  }

  watchApplication(
    name: string,
    namespace: string,
    resourceVersion: string,
    onEvent: (type: string, app: Application) => void,
    signal: AbortSignal,
  ) {
    return watchApplication(
      this.connection,
      name,
      namespace,
      resourceVersion,
      onEvent,
      signal,
    );
  }

  getManagedResources(name: string, namespace: string) {
    return getManagedResources(this.connection, name, namespace);
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
      this.connection,
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
      this.connection,
      appName,
      appNamespace,
      group,
      kind,
      namespace,
      resourceName,
    );
  }

  getResourceTree(name: string, namespace: string) {
    return getResourceTree(this.connection, name, namespace);
  }

  watchResourceTree(
    name: string,
    namespace: string,
    onTree: (tree: ResourceTree) => void,
    signal: AbortSignal,
  ) {
    return watchResourceTree(this.connection, name, namespace, onTree, signal);
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
      this.connection,
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
      this.connection,
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
      this.connection,
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
      this.connection,
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
      this.connection,
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
    return watchApplications(this.connection, resourceVersion, onEvent, signal);
  }
}

export const ArgoClientContext = createContext<ArgoClient | null>(null);

export function useArgoClient(): ArgoClient {
  const client = useContext(ArgoClientContext);
  if (!client)
    throw new Error("useArgoClient must be used within ArgoProvider");
  return client;
}
