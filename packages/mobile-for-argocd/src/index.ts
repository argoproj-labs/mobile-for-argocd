export * from "./api";
export * from "./status";
export { colors } from "./theme";
export { ArgoClient, useArgoClient } from "./client";
export {
  ArgoProvider,
  useArgoHost,
  type ArgoHost,
  type InstanceSwitcherProps,
} from "./provider";
export { favoritesStorage } from "./favorites";

export { default as AppTabs } from "./screens/tabs";
export { default as AppsScreen } from "./screens/apps";
export { default as UserScreen } from "./screens/user";
export { default as DetailsScreen } from "./screens/details";
export { default as DiffScreen } from "./screens/diff";
export { default as HistoryScreen } from "./screens/history";
export { default as LogsScreen } from "./screens/logs";
export { default as TreeScreen } from "./screens/tree";
