import type { Agent, AgentFieldSource, AgentStatus } from "@/types/agents";
import type { RuntimeSnapshotMap } from "@/lib/runtime/types";

export const STALE_SEC = 120;

function toFiniteOrNull(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clampNonNeg(value: number | null): number | null {
  if (value == null) return null;
  return Math.max(0, Math.round(value));
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}

function stripRuntimePrefix(value: string) {
  return value.startsWith("runtime:") ? value.slice("runtime:".length) : value;
}

function cleanIdentityEmoji(value: unknown) {
  const text = nonEmpty(value);
  if (!text) return "";
  return text
    .replace(/[*`_]/g, "")
    .replace(/^emoji\s*/i, "")
    .replace(/^:\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);
}

function findRuntimeSnapshot(agentId: string, runtimeMap: RuntimeSnapshotMap) {
  const direct = runtimeMap[agentId];
  if (direct) return direct;

  const canonicalId = stripRuntimePrefix(agentId);
  if (canonicalId !== agentId && runtimeMap[canonicalId]) {
    return runtimeMap[canonicalId];
  }

  const prefixedId = `runtime:${canonicalId}`;
  if (runtimeMap[prefixedId]) return runtimeMap[prefixedId];

  for (const [runtimeId, snapshot] of Object.entries(runtimeMap)) {
    if (stripRuntimePrefix(runtimeId) === canonicalId) return snapshot;
  }

  return undefined;
}

function heartbeatAgeSec(lastHeartbeatAt: string | null): number | null {
  if (!lastHeartbeatAt) return null;
  const parsed = new Date(lastHeartbeatAt).valueOf();
  if (!Number.isFinite(parsed)) return null;
  const delta = Math.floor((Date.now() - parsed) / 1000);
  return delta >= 0 ? delta : null;
}

export function mergeAgentWithRuntime(agent: Agent, runtimeMap: RuntimeSnapshotMap): Agent {
  const runtime = findRuntimeSnapshot(agent.id, runtimeMap);
  const source = runtime ? "openclaw-runtime" : "database-fallback";
  const fallbackName = `Agent ${agent.id.slice(0, 8)}`;
  const runtimeName = nonEmpty(runtime?.name);
  const databaseName = nonEmpty(agent.name);
  const looksSyntheticDatabaseName = Boolean(
    databaseName &&
      (databaseName === agent.id ||
        databaseName.toLowerCase() === "main" ||
        databaseName.startsWith("Agent ")),
  );
  const preferredDatabaseName = looksSyntheticDatabaseName ? null : databaseName;
  const name = runtimeName ?? preferredDatabaseName ?? databaseName ?? fallbackName;
  const nameSource: AgentFieldSource = runtimeName
    ? "runtime"
    : preferredDatabaseName
      ? "database"
      : "fallback";

  const runtimeLastHeartbeat = nonEmpty(runtime?.lastHeartbeatAt);
  const databaseLastHeartbeat = nonEmpty(agent.runtime.lastHeartbeatAt);
  const lastHeartbeatAt =
    runtimeLastHeartbeat ??
    databaseLastHeartbeat ??
    null;
  const lastHeartbeatSource: AgentFieldSource = runtimeLastHeartbeat
    ? "runtime"
    : databaseLastHeartbeat
      ? "database"
      : "fallback";

  const age = heartbeatAgeSec(lastHeartbeatAt);
  const stale = age != null ? age > STALE_SEC : true;

  const rawStatus: AgentStatus =
    runtime && runtime.status !== "unknown"
      ? runtime.status
      : agent.status;
  const status: AgentStatus = stale && rawStatus === "running" ? "degraded" : rawStatus;
  const statusSource: AgentFieldSource =
    runtime && runtime.status !== "unknown" ? "runtime" : "database";

  const runtimeModel = nonEmpty(runtime?.model);
  const databaseModel = nonEmpty(agent.runtime.model);
  const model =
    runtimeModel ??
    databaseModel ??
    null;
  const modelSource: AgentFieldSource = runtimeModel
    ? "runtime"
    : databaseModel
      ? "database"
      : "fallback";

  const queueDepth = clampNonNeg(toFiniteOrNull(runtime?.queueDepth));
  const activeRuns = clampNonNeg(toFiniteOrNull(runtime?.activeRuns));
  const uptimeMinutes = clampNonNeg(toFiniteOrNull(runtime?.uptimeMinutes));
  const queueDepthSource: AgentFieldSource = queueDepth != null ? "runtime" : "fallback";
  const activeRunsSource: AgentFieldSource = activeRuns != null ? "runtime" : "fallback";
  const uptimeMinutesSource: AgentFieldSource = uptimeMinutes != null ? "runtime" : "fallback";

  return {
    ...agent,
    name,
    status,
    identity: {
      name: nonEmpty(runtime?.identity?.name) ?? agent.identity?.name ?? "",
      emoji: cleanIdentityEmoji(runtime?.identity?.emoji) || cleanIdentityEmoji(agent.identity?.emoji),
      role: nonEmpty(runtime?.identity?.role) ?? agent.identity?.role ?? "",
    },
    activeSkills: (runtime?.activeSkills ?? agent.activeSkills ?? []).filter(Boolean),
    soul: nonEmpty(runtime?.soul) ?? agent.soul ?? "",
    runtime: {
      ...agent.runtime,
      model,
      queueDepth,
      activeRuns,
      uptimeMinutes,
      lastHeartbeatAt,
    },
    runtimeMeta: {
      stale,
      heartbeatAgeSec: age,
      source,
      collectedAt: runtime?.collectedAt ?? null,
      fieldSources: {
        name: nameSource,
        status: statusSource,
        model: modelSource,
        queueDepth: queueDepthSource,
        activeRuns: activeRunsSource,
        lastHeartbeatAt: lastHeartbeatSource,
        uptimeMinutes: uptimeMinutesSource,
      },
    },
  };
}
