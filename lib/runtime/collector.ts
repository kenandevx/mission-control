import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { getCachedAgents, getCachedSessions } from "@/lib/runtime/cache";
import type { RuntimeAssignee, RuntimeSnapshot, RuntimeSnapshotMap } from "@/lib/runtime/types";

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(os.homedir(), ".openclaw");
const AGENT_WORKSPACES_DIR = path.join(OPENCLAW_HOME, "workspace", "agents");
const IDENTITY_PATH = path.join(OPENCLAW_HOME, "workspace", "IDENTITY.md");
const STALE_SEC = 120;

function parseTime(value: unknown): string | null {
  if (value == null || value === "") return null;
  const num = Number(value);
  if (Number.isFinite(num)) {
    const epochMs = num > 1_000_000_000_000 ? num : num * 1000;
    const date = new Date(epochMs);
    return Number.isNaN(date.valueOf()) ? null : date.toISOString();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function heartbeatAgeSec(lastHeartbeatAt: string | null): number | null {
  if (!lastHeartbeatAt) return null;
  const ageMs = Date.now() - new Date(lastHeartbeatAt).valueOf();
  if (!Number.isFinite(ageMs) || ageMs < 0) return null;
  return Math.floor(ageMs / 1000);
}

function normalizeRuntimeName(value: unknown): string {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text && text.toLowerCase() !== "assistant" ? text.slice(0, 120) : "";
}

function initialsFromName(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("");
  return initials || name.slice(0, 2).toUpperCase() || "?";
}

async function readIdentityProfile(filePath: string): Promise<string> {
  try {
    const source = await fs.readFile(filePath, "utf8");
    const match = source.match(/^Name:\s*(.+)$/im) || source.match(/^\- Name:\s*(.+)$/im);
    return normalizeRuntimeName(match?.[1] || "");
  } catch {
    return "";
  }
}

function latestSessionsByAgent(sessionJson: { sessions?: Array<Record<string, unknown>> }): Map<string, Array<Record<string, unknown>>> {
  const byAgent = new Map<string, Array<Record<string, unknown>>>();
  for (const session of sessionJson.sessions || []) {
    const agentId = String(session.agentId || "").trim();
    if (!agentId) continue;
    const list = byAgent.get(agentId) || [];
    list.push(session);
    byAgent.set(agentId, list);
  }
  for (const [agentId, list] of byAgent) {
    list.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    byAgent.set(agentId, list.slice(0, 1));
  }
  return byAgent;
}

export type CollectorResult = {
  snapshots: RuntimeSnapshotMap;
  assignees: RuntimeAssignee[];
};

export async function collectRuntimeSnapshots(): Promise<CollectorResult> {
  const [registeredAgents, sessionJson] = await Promise.all([
    getCachedAgents(),
    getCachedSessions(),
  ]);

  const latestByAgent = latestSessionsByAgent(sessionJson as { sessions?: Array<Record<string, unknown>> });

  // Discover agent IDs dynamically from CLI output + sessions
  const agentIdSet = new Set<string>();
  for (const a of registeredAgents) {
    if (a.id) agentIdSet.add(a.id);
  }
  const stores = (sessionJson as Record<string, unknown>).stores;
  if (Array.isArray(stores)) {
    for (const s of stores) {
      const id = String((s as Record<string, unknown>)?.agentId || "").trim();
      if (id) agentIdSet.add(id);
    }
  }
  for (const key of latestByAgent.keys()) {
    agentIdSet.add(key);
  }

  const agentIds = Array.from(agentIdSet);
  const mainIdentity = await readIdentityProfile(IDENTITY_PATH);

  const assignees: RuntimeAssignee[] = [];
  const snapshots: RuntimeSnapshotMap = {};

  // Build identity names
  const identityNames = new Map<string, string>();
  for (const agentId of agentIds) {
    const isMain = agentId === "main";
    const fileIdentity = isMain ? "" : await readIdentityProfile(path.join(AGENT_WORKSPACES_DIR, agentId, "IDENTITY.md"));
    const name = isMain ? mainIdentity || "main" : fileIdentity || agentId;
    identityNames.set(agentId, name);
    assignees.push({ id: agentId, name, initials: initialsFromName(name), color: "#64748b" });
  }

  for (const agentId of agentIds) {
    const latest = latestByAgent.get(agentId)?.[0];
    const lastHeartbeatAt = parseTime(latest?.updatedAt || latest?.lastHeartbeatAt || null);
    const heartbeatAge = heartbeatAgeSec(lastHeartbeatAt);
    const activeRuns = latest?.kind === "direct" && heartbeatAge != null && heartbeatAge < STALE_SEC ? 1 : 0;
    const queueDepth = Math.max(0, latestByAgent.get(agentId)?.length || 0);
    const model = normalizeRuntimeName(latest?.model || null) || null;
    const name = identityNames.get(agentId) || agentId;

    snapshots[agentId] = {
      agentId,
      name,
      status: heartbeatAge == null ? "unknown" : heartbeatAge > STALE_SEC ? "degraded" : "running",
      model,
      activeRuns,
      queueDepth,
      uptimeMinutes: null,
      lastHeartbeatAt,
      heartbeatAgeSec: heartbeatAge,
      stale: heartbeatAge == null ? true : heartbeatAge > STALE_SEC,
      source: "openclaw-runtime",
      collectedAt: new Date().toISOString(),
      identity: { name, emoji: "", role: "" },
      activeSkills: [],
      soul: "",
    };
  }

  return { snapshots, assignees };
}
