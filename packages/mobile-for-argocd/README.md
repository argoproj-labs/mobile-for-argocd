# @argoproj-labs/mobile-for-argocd

Argo CD screens and API client for Expo Router apps. The host app supplies the
connection (server URL and auth headers) and owns login and instance selection.

## Usage

Wrap the authenticated route group in `ArgoProvider`:

```tsx
// app/(app)/_layout.tsx
import { Stack } from "expo-router";
import { ArgoProvider } from "@argoproj-labs/mobile-for-argocd";

export default function AppLayout() {
  return (
    <ArgoProvider
      connection={{
        id: "prod",
        serverUrl: "https://argocd.example.com",
        name: "prod",
        headers: () => ({ Authorization: `Bearer ${token}` }),
      }}
      onUnauthorized={() => router.replace("/login")}
      onLogout={async () => {
        /* optional */
      }}
      InstanceSwitcher={MySwitcher /* optional */}
    >
      <Stack screenOptions={{ headerShown: false }} />
    </ArgoProvider>
  );
}
```

Keep `connection.headers` referentially stable (e.g. `useMemo`); a new function
recreates the API client.

## Routes

Screens navigate by path, so the host must mount them at these routes:

| File                           | Export          |
| ------------------------------ | --------------- |
| `app/(app)/(tabs)/_layout.tsx` | `AppTabs`       |
| `app/(app)/(tabs)/index.tsx`   | `AppsScreen`    |
| `app/(app)/(tabs)/user.tsx`    | `UserScreen`    |
| `app/(app)/details.tsx`        | `DetailsScreen` |
| `app/(app)/diff.tsx`           | `DiffScreen`    |
| `app/(app)/history.tsx`        | `HistoryScreen` |
| `app/(app)/logs.tsx`           | `LogsScreen`    |
| `app/(app)/tree.tsx`           | `TreeScreen`    |

Each route file is a re-export:

```ts
export { DetailsScreen as default } from "@argoproj-labs/mobile-for-argocd";
```

The package ships TypeScript source and expects the host to provide the peer
dependencies listed in `package.json`.
