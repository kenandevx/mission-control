import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Runtime cache for agent and session data.
 *
 * v2: reads directly from OpenClaw's local files instead of spawning CLI
 * subprocesses. The previous approach (`openclaw agents list --json` and
 * `openclaw sessions --all-agents --json`) took ~10 seconds of CPU per
 * invocation due to Node.js cold boot + gateway WS handshake, causing
 * visible CPU spikes on every /agents and /agenda page load.
 *
 * Data sources:
 *   - Agent list: openclaw.json → agents.list[]
 *   - Agent identity: workspace IDENTITY.md per agent
 *   - Session activity: <agentDir>/sessions/sessions.json per agent
 */

const OPENCLAW_HOME = process.env.OPENCLAW_HOME ?? resolve(process.env.HOME ?? "/home/clawdbot", ".openclaw");

type AgentListEntry = {
  id: string;
  name: string;
  identityName: string;
  model: string | null;
  status: string;
  lastHeartbeatAt: string | null;
  isDefault?: boolean;
};

type SessionsData = {
  stores?: Array<{ agentId?: string }>;
  sessions?: Array<Record<string, unknown>>;
  [agentId: string]: unknown;
};

type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

const TTL_MS = 30_000;

let agentsCache: CacheEntry<AgentListEntry[]> | null = null;
let sessionsCache: CacheEntry<SessionsData> | null = null;

// ── File readers ────────────────────────────────────────────────────────────

function readJsonFile(filePath: string): unknown {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf8");
    // OpenClaw's JSON files sometimes have trailing commas
    const cleaned = raw.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function readIdentityName(agentId: string): string {
  // Check workspace agent folders first (where team identities are configured),
  // then fall back to the agent runtime dir.
  const paths = [
    resolve(OPENCLAW_HOME, "workspace", "agents", agentId, "IDENTITY.md"),
    resolve(OPENCLAW_HOME, "agents", agentId, "agent", "IDENTITY.md"),
  ];

  for (const p of paths) {
    try {
      if (!existsSync(p)) continue;
      const raw = readFileSync(p, "utf8");
      const nameMatch = raw.match(/^-\s*Name:\s*(.+)/m);
      if (nameMatch?.[1]?.trim()) return nameMatch[1].trim();
    } catch {
      continue;
    }
  }
  return "";
}

function loadAgentsFromConfig(): AgentListEntry[] {
  const configPath = resolve(OPENCLAW_HOME, "openclaw.json");
  const config = readJsonFile(configPath) as Record<string, unknown> | null;
  if (!config) return [];

  const agents = config.agents as Record<string, unknown> | undefined;
  if (!agents) return [];

  const defaultModel = (() => {
    const defaults = agents.defaults as Record<string, unknown> | undefined;
    const model = defaults?.model as Record<string, unknown> | undefined;
    return (model?.primary as string) ?? null;
  })();

  const list = agents.list as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(list)) return [];

  return list
    .filter((a) => {
      const id = String(a.id ?? "");
      // Skip temporary agent-meeting agents
      return id && !id.startsWith("am-");
    })
    .map((a) => {
      const id = String(a.id ?? "");
      const identityName = readIdentityName(id);
      const agentModel = a.model ? String(a.model) : null;
      return {
        id,
        name: a.name ? String(a.name) : id,
        identityName,
        model: agentModel ?? (id === "main" ? defaultModel : null),
        status: "idle",
        lastHeartbeatAt: null,
        isDefault: id === "main",
      };
    });
}

function loadSessionsData(): SessionsData {
  const result: SessionsData = { stores: [], sessions: [] };

  // Scan all agent session stores
  const agentsDir = resolve(OPENCLAW_HOME, "agents");
  if (!existsSync(agentsDir)) return result;

  try {
    for (const agentId of readdirSync(agentsDir)) {
      // Skip temporary agent-meeting agents
      if (agentId.startsWith("am-")) continue;

      const sessionsFile = join(agentsDir, agentId, "sessions", "sessions.json");
      const data = readJsonFile(sessionsFile) as Record<string, unknown> | null;
      if (!data) continue;

      result.stores!.push({ agentId });

      for (const [key, session] of Object.entries(data)) {
        if (!session || typeof session !== "object") continue;
        const s = session as Record<string, unknown>;
        result.sessions!.push({
          key,
          agentId,
          updatedAt: s.updatedAt ?? s.lastUpdatedAt ?? null,
          model: s.model ?? s.modelOverride ?? null,
          status: s.status ?? "unknown",
          channelType: s.origin
            ? String((s.origin as Record<string, unknown>).provider ?? "internal")
            : "internal",
        });
      }
    }
  } catch {
    // Partial read is fine
  }

  return result;
}

// ── Status derivation ───────────────────────────────────────────────────────

function deriveAgentStatus(
  sessionsData: SessionsData,
): Record<string, { status: string; lastHeartbeatAt: string | null }> {
  const result: Record<string, { status: string; lastHeartbeatAt: string | null }> = {};
  const sessions = sessionsData.sessions;
  if (!Array.isArray(sessions)) return result;

  const agentLatest: Record<string, number> = {};
  for (const s of sessions) {
    const agentId = s.agentId as string | undefined;
    const updatedAt = s.updatedAt as number | undefined;
    if (!agentId || !updatedAt) continue;
    if (!agentLatest[agentId] || updatedAt > agentLatest[agentId]) {
      agentLatest[agentId] = updatedAt;
    }
  }

  const now = Date.now();
  for (const [agentId, ts] of Object.entries(agentLatest)) {
    const ageMs = now - ts;
    result[agentId] = {
      status: ageMs <= 5 * 60 * 1000 ? "running" : "idle",
      lastHeartbeatAt: new Date(ts).toISOString(),
    };
  }
  return result;
}

// ── Public API ──────────────────────────────────────────────────────────────

function refreshIfNeeded(): void {
  const now = Date.now();
  if (!agentsCache || agentsCache.expiresAt <= now) {
    agentsCache = { data: loadAgentsFromConfig(), expiresAt: now + TTL_MS };
  }
  if (!sessionsCache || sessionsCache.expiresAt <= now) {
    sessionsCache = { data: loadSessionsData(), expiresAt: now + TTL_MS };
  }
}

export async function getCachedAgents(): Promise<AgentListEntry[]> {
  refreshIfNeeded();
  return agentsCache?.data ?? [];
}

export async function getCachedSessions(): Promise<SessionsData> {
  refreshIfNeeded();
  return sessionsCache?.data ?? {};
}

export function getAgentStatuses(): Record<
  string,
  { status: string; lastHeartbeatAt: string | null }
> {
  if (!sessionsCache?.data) return {};
  return deriveAgentStatus(sessionsCache.data);
}
