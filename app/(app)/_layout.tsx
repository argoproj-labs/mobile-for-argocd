import { useCallback, useEffect, useMemo } from "react";
import { Stack, useRouter } from "expo-router";
import { ArgoProvider, logout } from "@argoproj-labs/mobile-for-argocd";
import { useInstanceStore } from "../../lib/instanceStore";
import { instanceConnection } from "../../lib/storage";
import { InstanceSwitcher } from "../../components/instance-switcher";

export default function AppLayout() {
  const router = useRouter();
  const { activeSession, isLoaded, removeInstance } = useInstanceStore();

  // A server that has been added but never signed in to has no session, so
  // it routes to login rather than rendering the app against a blank token.
  useEffect(() => {
    if (isLoaded && !activeSession) router.replace("/login");
  }, [isLoaded, activeSession, router]);

  const connection = useMemo(
    () => (activeSession ? instanceConnection(activeSession) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSession?.id, activeSession?.url, activeSession?.token],
  );

  const onUnauthorized = useCallback(() => router.replace("/login"), [router]);

  // Expire the server session cookie before dropping local state, so a
  // browser-login (cookie) session doesn't silently persist in the jar.
  // With no instance left the effect above routes to login.
  const onLogout = useCallback(async () => {
    if (!activeSession) return;
    await logout(activeSession.url);
    await removeInstance(activeSession.id);
  }, [activeSession, removeInstance]);

  if (!connection) return null;

  return (
    <ArgoProvider
      connection={connection}
      onUnauthorized={onUnauthorized}
      onLogout={onLogout}
      InstanceSwitcher={InstanceSwitcher}
    >
      <Stack screenOptions={{ headerShown: false }} />
    </ArgoProvider>
  );
}
