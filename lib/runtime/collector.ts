import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { getSql } from "@/lib/local-db";
import type { RuntimeAssignee, RuntimeSnapshot, RuntimeSnapshotMap, RuntimeStatus } from "@/lib/runtime/types";

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(os.homedir(), ".openclaw");
const AGENT_WORKSPACES_DIR = path.join(OPENCLAW_HOME, "workspace", "agents");
const IDENTITY_PATH = path.join(OPENCLAW_HOME, "workspace", "IDENTITY.md");
const STALE_SEC = 120;
const AGENT_IDS = ["main", "research-agent", "developer-agent", "writer-agent", "test-agent"];

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

function initialsFromName(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("");
  return initials || name.slice(0, 2).toUpperCase() || "?";
}


async function emitRuntimeEvent(agentId: string, level: "info" | "warning" | "error", eventType: string, message: string, extra: Record<string, unknown> = {}) {
  try {
    const sql = getSql();
    const workspace = await sql`select id from workspaces order by created_at asc limit 1`;
    const workspaceId = workspace[0]?.id ?? null;
    if (!workspaceId) return;
    const agentRows = await sql`select id from agents where workspace_id = ${workspaceId} and openclaw_agent_id = ${agentId} limit 1`;
    const agentDbId = agentRows[0]?.id ?? null;
    if (!agentDbId) return;
    await sql`
      insert into agent_logs (workspace_id, agent_id, runtime_agent_id, occurred_at, level, type, message, event_type, message_preview, raw_payload)
      values (${workspaceId}, ${agentDbId}, ${agentId}, now(), ${level}, 'system', ${message}, ${eventType}, ${message.slice(0, 240)}, ${JSON.stringify(extra)}::jsonb)
    `;
  } catch {}
}

async function readIdentityProfile(filePath: string) {
  try {
    const source = await fs.readFile(filePath, "utf8");
    const match = source.match(/^Name:\s*(.+)$/im) || source.match(/^\- Name:\s*(.+)$/im);
    return normalizeRuntimeName(match?.[1] || "");
  } catch {
    return "";
  }
}

function readSessionsJson() {
  try {
    const output = execFileSync("openclaw", ["sessions", "--all-agents", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return JSON.parse(output) as { stores?: { agentId?: string }[]; sessions?: Array<Record<string, unknown>> };
  } catch {
    return { stores: [], sessions: [] };
  }
}

function latestSessionsByAgent(sessionJson: { sessions?: Array<Record<string, unknown>> }) {
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

export async function collectRuntimeSnapshots(): Promise<RuntimeSnapshotMap> {
  const sessionJson = readSessionsJson();
  const latestByAgent = latestSessionsByAgent(sessionJson);
  const agentIds = Array.from(new Set([...(sessionJson.stores || []).map((s) => String(s.agentId || "").trim()).filter(Boolean), ...latestByAgent.keys(), ...AGENT_IDS]));
  const mainIdentity = await readIdentityProfile(IDENTITY_PATH);
  const result: RuntimeSnapshotMap = {};

  const runtimeAssignees: RuntimeAssignee[] = [];
  for (const agentId of agentIds) {
    const isMain = agentId === "main";
    const fileIdentity = isMain ? "" : await readIdentityProfile(path.join(AGENT_WORKSPACES_DIR, agentId, "IDENTITY.md"));
    const name = isMain ? mainIdentity || "main" : fileIdentity || agentId;
    runtimeAssignees.push({ id: agentId, name, initials: initialsFromName(name), color: "#64748b" });
  }

  for (const agentId of agentIds) {
    const latest = latestByAgent.get(agentId)?.[0];
    const lastHeartbeatAt = parseTime(latest?.updatedAt || latest?.lastHeartbeatAt || null);
    const heartbeatAge = heartbeatAgeSec(lastHeartbeatAt);
    const activeRuns = latest?.kind === "direct" && heartbeatAge != null && heartbeatAge < STALE_SEC ? 1 : 0;
    const queueDepth = Math.max(0, latestByAgent.get(agentId)?.length || 0);
    const model = normalizeRuntimeName(latest?.model || null) || null;
    const name = runtimeAssignees.find((item) => item.id === agentId)?.name || agentId;
    if (latest) {
      await emitRuntimeEvent(agentId, "info", "runtime.snapshot", `Runtime snapshot collected for ${agentId}`, {
        model: latest?.model ?? null,
        heartbeatAt: lastHeartbeatAt,
        activeRuns,
        queueDepth,
      });
    }

    result[agentId] = {
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

  (result as any).__assignees = runtimeAssignees;
  return result;
}
