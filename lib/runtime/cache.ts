import { execFile } from "node:child_process";

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
const EXEC_TIMEOUT_MS = 8_000;

let agentsCache: CacheEntry<AgentListEntry[]> | null = null;
let sessionsCache: CacheEntry<SessionsData> | null = null;
let inflightPromise: Promise<void> | null = null;

function execAsync(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", timeout: EXEC_TIMEOUT_MS }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

async function refreshCache(): Promise<void> {
  const now = Date.now();

  const agentsValid = agentsCache && agentsCache.expiresAt > now;
  const sessionsValid = sessionsCache && sessionsCache.expiresAt > now;

  if (agentsValid && sessionsValid) return;

  // Deduplicate concurrent refreshes
  if (inflightPromise) return inflightPromise;

  inflightPromise = (async () => {
    try {
      const [agentsRaw, sessionsRaw] = await Promise.all([
        agentsValid ? Promise.resolve(null) : execAsync("openclaw", ["agents", "list", "--json"]).catch(() => "[]"),
        sessionsValid ? Promise.resolve(null) : execAsync("openclaw", ["sessions", "--all-agents", "--json"]).catch(() => "{}"),
      ]);

      const expiry = Date.now() + TTL_MS;

      if (agentsRaw !== null) {
        agentsCache = {
          data: JSON.parse(agentsRaw.trim() || "[]"),
          expiresAt: expiry,
        };
      }

      if (sessionsRaw !== null) {
        sessionsCache = {
          data: JSON.parse(sessionsRaw.trim() || "{}"),
          expiresAt: expiry,
        };
      }
    } finally {
      inflightPromise = null;
    }
  })();

  return inflightPromise;
}

export async function getCachedAgents(): Promise<AgentListEntry[]> {
  await refreshCache();
  return agentsCache?.data ?? [];
}

export async function getCachedSessions(): Promise<SessionsData> {
  await refreshCache();
  return sessionsCache?.data ?? {};
}
