import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import postgres from "postgres";

const rootDir = process.cwd();
const envPath = resolve(rootDir, ".env");

function loadEnvFile(pathname) {
  if (!existsSync(pathname)) return;
  const source = readFileSync(pathname, "utf8");
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (!key || process.env[key]) continue;
    process.env[key] = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
  }
}

function getDbUrl() {
  return process.env.DATABASE_URL?.trim() || process.env.OPENCLAW_DATABASE_URL?.trim();
}

async function resolveGatewayToken() {
  // 1. Read from openclaw.json (single source of truth)
  try {
    const configPath = resolve(process.env.OPENCLAW_HOME || resolve(process.env.HOME || "/home/clawdbot", ".openclaw"), "openclaw.json");
    const raw = readFileSync(configPath, "utf8");
    const cleaned = raw.replace(/,(\s*[}\]])/g, "$1");
    const cfg = JSON.parse(cleaned);
    const configToken = String(cfg?.gateway?.auth?.token || "").trim();
    if (configToken) return configToken;
  } catch { /* fall through to other sources */ }

  // 2. Env var fallback
  const envCandidates = [process.env.OPENCLAW_GATEWAY_TOKEN, process.env.OPENCLAW_GW_TOKEN, process.env.OPENCLAW_GATEWAY_API_TOKEN];
  for (const value of envCandidates) {
    const token = String(value || "").trim();
    if (token) return token;
  }

  // 3. DB fallback
  const dbUrl = getDbUrl();
  if (dbUrl) {
    try {
      const sql = postgres(dbUrl, { max: 1, prepare: false });
      const rows = await sql`select gateway_token from app_settings where id = 1 limit 1`;
      await sql.end();
      const token = String(rows[0]?.gateway_token || "").trim();
      if (token) return token;
    } catch {}
  }
  return null;
}

async function ensureWorkspace(sql) {
  let workspace = await sql`select id from workspaces order by created_at asc limit 1`;
  let workspaceId = workspace[0]?.id;
  if (!workspaceId) {
    const inserted = await sql`insert into workspaces (name, description) values ('OpenClaw Workspace', 'Default Mission Control workspace') returning id`;
    workspaceId = inserted[0]?.id;
  }
  if (!workspaceId) throw new Error("Missing workspace.");
  return workspaceId;
}

async function ensureAppSettings(sql, gatewayToken) {
  await sql`insert into app_settings (id, gateway_token, setup_completed) values (1, ${gatewayToken}, ${Boolean(String(gatewayToken || "").trim())}) on conflict (id) do update set gateway_token = excluded.gateway_token, setup_completed = excluded.setup_completed, updated_at = now()`;
}

function getOpenClawSessionsJson() {
  try {
    // openclaw sessions --json writes to stdout (verified in 4.x), but capture
    // stderr too as a safety net in case future versions change output streams.
    const result = execFileSync("openclaw", ["sessions", "--all-agents", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
    });
    // execFileSync returns stdout when stdio[1] is 'pipe'
    const stdout = typeof result === "string" ? result : "";
    if (stdout.trim()) return JSON.parse(stdout);
    return null;
  } catch (err) {
    // If the command failed but wrote to stderr, try parsing that
    const stderr = String(err?.stderr || "").trim();
    if (stderr) {
      try { return JSON.parse(stderr); } catch { /* not JSON */ }
    }
    return null;
  }
}

function loadAgentIdentity(agentId) {
  const paths = [
    `/home/clawdbot/.openclaw/agents/${agentId}/IDENTITY.md`,
    `/home/clawdbot/.openclaw/workspace/agents/${agentId}/IDENTITY.md`,
    `/home/clawdbot/.openclaw/workspace/${agentId}/IDENTITY.md`,
  ];
  for (const p of paths) {
    try {
      if (!existsSync(p)) continue;
      const text = readFileSync(p, "utf8");
      const name = (text.match(/^#\s*(.+)$/m)?.[1] || text.match(/^Name:\s*(.+)$/im)?.[1] || agentId).trim();
      const emoji = (text.match(/^Emoji:\s*(.+)$/im)?.[1] || "").trim();
      return { name, emoji };
    } catch {}
  }
  return { name: agentId, emoji: "" };
}

function latestSessionForAgent(sessionJson, agentId) {
  const sessions = Array.isArray(sessionJson?.sessions) ? sessionJson.sessions : [];
  const matched = sessions.filter((row) => String(row?.agentId || "") === agentId || String(row?.key || "").startsWith(`agent:${agentId}:`));
  matched.sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0));
  return matched[0] || null;
}

function toIso(value) {
  if (!value) return new Date().toISOString();
  const num = Number(value);
  if (Number.isFinite(num)) return new Date(num).toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.valueOf()) ? new Date().toISOString() : parsed.toISOString();
}

async function importAgentsFromSessions(sql, workspaceId, sessionJson) {
  const stores = Array.isArray(sessionJson?.stores) ? sessionJson.stores : [];
  const agentIds = new Set(['main', 'research-agent', 'developer-agent', 'writer-agent', 'test-agent']);
  for (const store of stores) {
    const agentId = String(store?.agentId || "").trim();
    if (agentId) agentIds.add(agentId);
  }
  let count = 0;
  for (const agentId of agentIds) {
    const latest = latestSessionForAgent(sessionJson, agentId);
    const status = latest && Number(latest?.ageMs || 0) < 30 * 60 * 1000 ? "running" : "idle";
    const model = String(latest?.model || "").trim() || null;
    const lastHeartbeatAt = toIso(latest?.updatedAt || latest?.lastHeartbeatAt || Date.now());
    const agentRows = await sql`insert into agents (workspace_id, openclaw_agent_id, status, model, last_heartbeat_at) values (${workspaceId}, ${agentId}, ${status}, ${model}, ${lastHeartbeatAt}) on conflict (workspace_id, openclaw_agent_id) do update set status = excluded.status, model = excluded.model, last_heartbeat_at = excluded.last_heartbeat_at, updated_at = now() returning id`;
    const agentDbId = agentRows[0]?.id;
    if (agentDbId) {
      await sql`insert into agent_logs (workspace_id, agent_id, runtime_agent_id, occurred_at, level, type, message, event_type, message_preview, raw_payload) values (${workspaceId}, ${agentDbId}, ${agentId}, now(), 'info', 'system', ${`Gateway sync updated ${agentId}`}, 'system.sync', ${`Gateway sync updated ${agentId}`.slice(0,240)}, ${JSON.stringify({ agentId, status, model, lastHeartbeatAt })}::jsonb)`;
    }
    count += 1;
  }
  return count;
}

function normalizeEventType(eventType, type, message = "") {
  if (eventType) return eventType;
  const normalized = String(message || "").toLowerCase();
  if (type === 'memory' || normalized.includes('memory')) return 'memory.event';
  if (type === 'tool' || normalized.includes('tool')) return 'tool.event';
  if (type === 'workflow' || normalized.includes('chat')) return 'chat.event';
  return 'system.event';
}

async function importLogs(sql, workspaceId, sessionJson) {
  const sessions = Array.isArray(sessionJson?.sessions) ? sessionJson.sessions : [];
  let count = 0;
  for (const row of sessions) {
    const agentId = String(row?.agentId || "").trim();
    if (!agentId) continue;
    const eventType = normalizeEventType(String(row?.eventType || "").trim(), String(row?.type || "").trim(), String(row?.message || row?.summary || row?.event || row?.key || ""));
    const message = String(row?.message || row?.summary || row?.event || row?.key || "").trim();
    const level = String(row?.level || "info").trim();
    const sessionKey = String(row?.key || "").trim() || null;
    const channelType = String(row?.channelType || row?.channel || "internal").trim() || null;
    await sql`
      insert into agent_logs (
        workspace_id, agent_id, runtime_agent_id, occurred_at, level, type, message, event_type,
        session_key, channel_type, status, message_preview, raw_payload
      ) values (
        ${workspaceId}, (select id from agents where workspace_id = ${workspaceId} and openclaw_agent_id = ${agentId} limit 1), ${agentId}, ${toIso(row?.updatedAt || row?.lastHeartbeatAt || Date.now())}, ${level}, ${String(row?.type || 'system').trim()}, ${message}, ${eventType}, ${sessionKey}, ${channelType}, ${String(row?.status || '').trim() || null}, ${message.slice(0, 240)}, ${JSON.stringify(row)}::jsonb
      )
      on conflict do nothing
    `;
    count += 1;
  }
  return count;
}

async function main() {
  loadEnvFile(envPath);
  const dbUrl = getDbUrl();
  if (!dbUrl) throw new Error("Missing DATABASE_URL.");
  const token = await resolveGatewayToken();
  const sql = postgres(dbUrl, { max: 1, prepare: false });

  try {
    const workspaceId = await ensureWorkspace(sql);
    if (token) await ensureAppSettings(sql, token);
    const sessionJson = getOpenClawSessionsJson();
    const importedAgents = sessionJson ? await importAgentsFromSessions(sql, workspaceId, sessionJson) : 0;
    const importedEvents = sessionJson ? await importLogs(sql, workspaceId, sessionJson) : 0;
    console.log(JSON.stringify({ ok: true, importedAgents, importedEvents }, null, 2));
  } finally {
    await sql.end();
  }
}

await main();
