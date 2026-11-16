import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

interface StatusToken {
  color: string;
  bg: string;
  border: string;
  icon: IoniconName;
}

export const healthTokens: Record<string, StatusToken> = {
  Healthy: {
    color: "#5CD9B0",
    bg: "rgba(92,217,176,0.14)",
    border: "rgba(92,217,176,0.40)",
    icon: "heart",
  },
  Degraded: {
    color: "#F25D5D",
    bg: "rgba(242,93,93,0.14)",
    border: "rgba(242,93,93,0.40)",
    icon: "heart-dislike",
  },
  Progressing: {
    color: "#3B96E2",
    bg: "rgba(59,150,226,0.14)",
    border: "rgba(59,150,226,0.40)",
    icon: "refresh-circle",
  },
  Suspended: {
    color: "#A78BFA",
    bg: "rgba(167,139,250,0.14)",
    border: "rgba(167,139,250,0.40)",
    icon: "pause-circle",
  },
  Missing: {
    color: "#F2C94C",
    bg: "rgba(242,201,76,0.14)",
    border: "rgba(242,201,76,0.40)",
    icon: "alert-circle",
  },
  Unknown: {
    color: "rgba(245,246,250,0.6)",
    bg: "rgba(255,255,255,0.06)",
    border: "rgba(255,255,255,0.14)",
    icon: "help-circle-outline",
  },
};

export const syncTokens: Record<string, StatusToken> = {
  Synced: {
    color: "#5CD9B0",
    bg: "rgba(92,217,176,0.14)",
    border: "rgba(92,217,176,0.40)",
    icon: "checkmark-circle",
  },
  OutOfSync: {
    color: "#F2C94C",
    bg: "rgba(242,201,76,0.14)",
    border: "rgba(242,201,76,0.40)",
    icon: "time",
  },
  Unknown: {
    color: "rgba(245,246,250,0.6)",
    bg: "rgba(255,255,255,0.06)",
    border: "rgba(255,255,255,0.14)",
    icon: "help-circle-outline",
  },
};

export const operationPhaseTokens: Record<string, StatusToken> = {
  Succeeded: {
    color: "#5CD9B0",
    bg: "rgba(92,217,176,0.14)",
    border: "rgba(92,217,176,0.40)",
    icon: "checkmark-circle",
  },
  Failed: {
    color: "#F25D5D",
    bg: "rgba(242,93,93,0.14)",
    border: "rgba(242,93,93,0.40)",
    icon: "close-circle",
  },
  Error: {
    color: "#F25D5D",
    bg: "rgba(242,93,93,0.14)",
    border: "rgba(242,93,93,0.40)",
    icon: "alert-circle",
  },
  Running: {
    color: "#3B96E2",
    bg: "rgba(59,150,226,0.14)",
    border: "rgba(59,150,226,0.40)",
    icon: "refresh-circle",
  },
  Progressing: {
    color: "#3B96E2",
    bg: "rgba(59,150,226,0.14)",
    border: "rgba(59,150,226,0.40)",
    icon: "refresh-circle",
  },
  Terminating: {
    color: "#EF7B4D",
    bg: "rgba(239,123,77,0.14)",
    border: "rgba(239,123,77,0.40)",
    icon: "hourglass",
  },
  Pending: {
    color: "rgba(245,246,250,0.6)",
    bg: "rgba(255,255,255,0.06)",
    border: "rgba(255,255,255,0.14)",
    icon: "time",
  },
  Waiting: {
    color: "rgba(245,246,250,0.6)",
    bg: "rgba(255,255,255,0.06)",
    border: "rgba(255,255,255,0.14)",
    icon: "time",
  },
};

export function getOperationPhase(phase: string): StatusToken {
  return operationPhaseTokens[phase] ?? operationPhaseTokens.Pending;
}

export const HEALTH_ORDER = [
  "Degraded",
  "Missing",
  "Progressing",
  "Suspended",
  "Unknown",
  "Healthy",
];

export function getHealth(status: string): StatusToken {
  return healthTokens[status] ?? healthTokens.Unknown;
}

export function getSync(status: string): StatusToken {
  return syncTokens[status] ?? syncTokens.Unknown;
}

export function healthSeverity(status: string): number {
  return HEALTH_ORDER.indexOf(status in healthTokens ? status : "Unknown");
}
