export type RuntimeStatus = "running" | "idle" | "degraded" | "unknown";

export type RuntimeSnapshotIdentity = {
  name: string;
  emoji: string;
  role: string;
};

export type RuntimeAssignee = {
  id: string;
  name: string;
  initials: string;
  color: string;
};

export type RuntimeSnapshot = {
  agentId: string;
  name: string;
  status: RuntimeStatus;
  model: string | null;
  activeRuns: number | null;
  queueDepth: number | null;
  uptimeMinutes: number | null;
  lastHeartbeatAt: string | null;
  heartbeatAgeSec: number | null;
  stale: boolean;
  source: "openclaw-runtime";
  collectedAt: string;
  identity: RuntimeSnapshotIdentity;
  activeSkills: string[];
  soul: string;
};

export type RuntimeSnapshotMap = Record<string, RuntimeSnapshot>;
