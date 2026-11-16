import { useQueryClient } from "@tanstack/react-query";
import type { InstanceSwitcherProps } from "@argoproj-labs/mobile-for-argocd";
import { useInstanceStore } from "../lib/instanceStore";
import type { Instance } from "../lib/storage";
import { ServerSheet } from "./server-sheet";

// Switching servers invalidates every cached response. A server with no
// session just becomes active and the app layout routes to login.
export function InstanceSwitcher({ visible, onClose }: InstanceSwitcherProps) {
  const queryClient = useQueryClient();
  const { activeId, switchInstance } = useInstanceStore();

  const handleSelect = (inst: Instance) => {
    onClose();
    if (inst.id === activeId) return;
    queryClient.clear();
    void switchInstance(inst.id);
  };

  return (
    <ServerSheet
      visible={visible}
      onClose={onClose}
      onSelect={handleSelect}
      subtitle="Switch between your Argo CD instances"
    />
  );
}
