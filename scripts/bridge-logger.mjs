#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import os from "node:os";
import postgres from "postgres";
import {
  transitionOccurrenceToSucceeded,
  transitionOccurrenceToNeedsRetry,
  transitionOccurrenceToFailed,
} from "./agenda-domain.mjs";

const WORKSPACE_ROOT = path.resolve(path.join(import.meta.dirname, ".."));
const STATE_DIR = path.join(WORKSPACE_ROOT, ".runtime", "bridge-logger");
const OFFSETS_PATH = path.join(STATE_DIR, "offsets.json");
const DEAD_LETTER_PATH = path.join(STATE_DIR, "dead-letter.jsonl");
const LOCK_PATH = path.join(STATE_DIR, "bridge-logger.lock");

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(os.homedir(), ".openclaw");
const AGENTS_DIR = path.join(OPENCLAW_HOME, "agents");
const GATEWAY_LOG_DIR = "/tmp/openclaw";
const CRON_RUNS_DIR = path.join(OPENCLAW_HOME, "cron", "runs");

const SCAN_INTERVAL_MS = 5000;
const DEAD_LETTER_REPLAY_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 45000;
const BL_SERVICE_NAME = "bridge-logger";
const DEDUPE_WINDOW_MS = 30000;

const dedupeMap = new Map();
const watched = new Set();
const offsets = new Map();
let stateDirty = false;
let replayInFlight = false;

function isConnectionEndedError(error) {
  const message = String(error?.message || error || "");
  return message.includes("CONNECTION_ENDED") || message.includes("write CONNECTION_ENDED");
}

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function acquireLockOrExit() {
  try {
    if (fs.existsSync(LOCK_PATH)) {
      const raw = fs.readFileSync(LOCK_PATH, "utf8").trim();
      // Lock file format: "pid:startTimeMs"
      const colonIdx = raw.indexOf(":");
      if (colonIdx > 0) {
        const previousPid = Number(raw.slice(0, colonIdx));
        const previousStartMs = Number(raw.slice(colonIdx + 1));
        if (Number.isFinite(previousPid) && previousPid > 0 && Number.isFinite(previousStartMs)) {
          // PID collision with a very recent timestamp → likely a real concurrent instance
          const now = Date.now();
          const isRecent = (now - previousStartMs) < 30_000; // within 30s
          if (previousPid !== process.pid && isRecent) {
            console.error(`[bridge-logger] another instance is already running (pid=${previousPid}). Exiting.`);
            process.exit(1);
          }
          // Stale lock (different PID or old timestamp from a previous run) — continue to overwrite
        }
      }
    }
    fs.writeFileSync(LOCK_PATH, `${process.pid}:${Date.now()}`);
  } catch (error) {
    console.error("[bridge-logger] failed to acquire lock:", error?.message || error);
    process.exit(1);
  }
}

function releaseLock() {
  try {
    if (!fs.existsSync(LOCK_PATH)) return;
    const raw = fs.readFileSync(LOCK_PATH, "utf8").trim();
    const colonIdx = raw.indexOf(":");
    const current = colonIdx > 0 ? raw.slice(0, colonIdx) : raw;
    if (current === String(process.pid)) fs.unlinkSync(LOCK_PATH);
  } catch {
    // ignore lock release errors
  }
}

function loadOffsets() {
  try {
    if (!fs.existsSync(OFFSETS_PATH)) return;
    const parsed = JSON.parse(fs.readFileSync(OFFSETS_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object") return;
    for (const [k, v] of Object.entries(parsed)) {
      if (Number.isFinite(v)) offsets.set(k, Number(v));
    }
  } catch {
    // ignore malformed offsets
  }
}

function flushOffsets() {
  if (!stateDirty) return;
  stateDirty = false;
  const out = {};
  for (const [k, v] of offsets.entries()) out[k] = v;
  fs.writeFileSync(OFFSETS_PATH, JSON.stringify(out, null, 2));
}

function setOffset(filePath, value) {
  offsets.set(filePath, Math.max(0, Number(value) || 0));
  stateDirty = true;
}

function getOffset(filePath) {
  const value = offsets.get(filePath);
  return Number.isFinite(value) ? Number(value) : null;
}

function listSessionFiles() {
  if (!fs.existsSync(AGENTS_DIR)) return [];
  const files = [];
  for (const agentId of fs.readdirSync(AGENTS_DIR)) {
    const sessionsDir = path.join(AGENTS_DIR, agentId, "sessions");
    if (!fs.existsSync(sessionsDir)) continue;
    for (const f of fs.readdirSync(sessionsDir)) {
      if (f.endsWith(".jsonl")) files.push(path.join(sessionsDir, f));
    }
  }
  return files;
}

function parseSessionMeta(filePath) {
  const sessionsDir = path.dirname(filePath);
  const agentDir = path.dirname(sessionsDir);
  const runtimeAgentId = path.basename(agentDir);
  const sessionKey = path.basename(filePath, ".jsonl");
  return { runtimeAgentId, sessionKey };
}

function listGatewayFiles() {
  if (!fs.existsSync(GATEWAY_LOG_DIR)) return [];
  return fs
    .readdirSync(GATEWAY_LOG_DIR)
    .filter((name) => name.startsWith("openclaw-") && name.endsWith(".log"))
    .map((name) => path.join(GATEWAY_LOG_DIR, name));
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function normalizeRecord(raw) {
  const nested = raw?.message && typeof raw.message === "object" ? raw.message : raw;
  return {
    role: String(nested?.role || raw?.role || "").toLowerCase(),
    text: String(nested?.text || raw?.text || nested?.message || raw?.message || ""),
    runId: String(nested?.run_id || raw?.run_id || nested?.id || raw?.id || ""),
    sourceMessageId: String(nested?.message_id || raw?.message_id || nested?.id || raw?.id || ""),
    eventType: String(nested?.event_type || raw?.event_type || nested?.eventType || raw?.eventType || ""),
    model: String(nested?.model || raw?.model || ""),
    toolCalls: Array.isArray(nested?.toolCalls) ? nested.toolCalls : Array.isArray(raw?.toolCalls) ? raw.toolCalls : [],
    raw,
  };
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isErrorLike(text) {
  const t = String(text || "").toLowerCase();
  // Operational messages that contain "error"/"fail" but are NOT actual errors
  const safePatterns = [
    "error backoff",       // cron recovery — normal
    "failover decision",   // embedded run failover — normal
    "agent end",           // embedded run end — normal
    "backoff applied",     // retry backoff — normal
    "error_count",         // metric field name
    "error_rate",          // metric field name
    "on_error",            // config/handler name
    "retry after",         // recovery message
  ];
  if (safePatterns.some((p) => t.includes(p))) return false;
  return ["error", "failed", "exception", "timeout", "permission denied", "unauthorized"].some((x) => t.includes(x));
}

function hasMemoryHints(text) {
  const t = String(text || "").toLowerCase();
  return ["memory", "qdrant", "vector", "embedding", "memory_store", "memory_search"].some((x) => t.includes(x));
}

function inferMemoryEvent(text, status = "success") {
  const t = String(text || "").toLowerCase();
  if (status === "error" || isErrorLike(t)) return "memory.error";
  if (t.includes("search") || t.includes("query") || t.includes("recall")) return "memory.search";
  if (t.includes("upsert") || t.includes("insert") || t.includes("persist")) return "memory.upsert";
  if (t.includes("write") || t.includes("save") || t.includes("append") || t.includes("update")) return "memory.write";
  return "memory.read";
}

function preview(text) {
  const t = cleanText(text);
  return t.length > 240 ? `${t.slice(0, 239)}…` : t;
}

function inferChannelTypeFromText(text) {
  const lower = String(text || "").toLowerCase();
  if (lower.includes("telegram")) return "telegram";
  if (lower.includes("gateway") || lower.includes("websocket") || lower.includes("ws://")) return "gateway";
  if (lower.includes("qdrant") || lower.includes("vector") || lower.includes("embedding")) return "qdrant";
  return "internal";
}

function shouldEmit(key) {
  const now = Date.now();
  for (const [k, ts] of dedupeMap.entries()) {
    if (now - ts > DEDUPE_WINDOW_MS) dedupeMap.delete(k);
  }
  if (dedupeMap.has(key)) return false;
  dedupeMap.set(key, now);
  return true;
}

function appendDeadLetter(row, error) {
  const line = JSON.stringify({ at: new Date().toISOString(), error: String(error || "insert failed"), row });
  fs.appendFileSync(DEAD_LETTER_PATH, `${line}\n`);
}

async function replayDeadLetters(sql) {
  if (replayInFlight || !fs.existsSync(DEAD_LETTER_PATH)) return;
  replayInFlight = true;
  try {
    const lines = fs.readFileSync(DEAD_LETTER_PATH, "utf8").split(/\r?\n/).filter(Boolean);
    if (!lines.length) return;
    const keep = [];
    for (const line of lines) {
      const parsed = parseJsonLine(line);
      const row = parsed?.row;
      if (!row) continue;
      try {
        await insertLogRow(sql, row);
      } catch {
        keep.push(line);
      }
    }
    if (!keep.length) fs.unlinkSync(DEAD_LETTER_PATH);
    else fs.writeFileSync(DEAD_LETTER_PATH, `${keep.join("\n")}\n`);
  } finally {
    replayInFlight = false;
  }
}

async function getWorkspaceId(sql) {
  const rows = await sql`select id from workspaces order by created_at asc limit 1`;
  return rows[0]?.id || null;
}

async function ensureAgent(sql, workspaceId, runtimeAgentId, model = "") {
  // Pure upsert — no race window between SELECT and INSERT
  const result = await sql`
    insert into agents (workspace_id, openclaw_agent_id, status, model, last_heartbeat_at)
    values (${workspaceId}, ${runtimeAgentId}, 'running', ${model || null}, now())
    on conflict (workspace_id, openclaw_agent_id) do update
      set status = 'running',
          model = coalesce(${model || null}, agents.model),
          last_heartbeat_at = now(),
          updated_at = now()
    returning id
  `;
  return result[0]?.id;
}

async function insertLogRow(sql, row) {
  const existing = await sql`
    select id
    from agent_logs
    where runtime_agent_id = ${row.runtime_agent_id}
      and coalesce(event_type, '') = ${row.event_type || ''}
      and coalesce(message_preview, '') = ${row.message_preview || ''}
      and occurred_at > now() - interval '8 seconds'
    limit 1
  `;
  if (existing[0]?.id) return;

  const inserted = await sql`
    insert into agent_logs (
      workspace_id, agent_id, runtime_agent_id, occurred_at, level, type, run_id, message, event_type,
      direction, channel_type, session_key, source_message_id, correlation_id, status, retry_count,
      message_preview, is_json, contains_pii, memory_source, memory_key, collection, query_text,
      result_count, raw_payload
    ) values (
      ${row.workspace_id}, ${row.agent_id}, ${row.runtime_agent_id}, now(),
      ${row.level}, ${row.type}, ${row.run_id || null}, ${row.message || null}, ${row.event_type || null},
      ${row.direction || null}, ${row.channel_type || null}, ${row.session_key || null}, ${row.source_message_id || null},
      ${row.correlation_id || null}, ${row.status || null}, ${row.retry_count ?? 0}, ${row.message_preview || null},
      ${row.is_json ?? false}, ${row.contains_pii ?? false}, ${row.memory_source || null}, ${row.memory_key || null},
      ${row.collection || null}, ${row.query_text || null}, ${row.result_count ?? null}, ${row.raw_payload || null}
    ) returning id::text
  `;

  const insertedId = inserted[0]?.id || "";
  if (insertedId) {
    await sql`select pg_notify('agent_logs', ${insertedId})`;
  }
}

async function emitLog(sql, ctx, payload) {
  const dedupeKey = `${ctx.runtimeAgentId}|${ctx.sessionKey}|${payload.event_type}|${payload.message_preview}`;
  if (!shouldEmit(dedupeKey)) return;

  const row = {
    workspace_id: ctx.workspaceId,
    agent_id: ctx.agentDbId,
    runtime_agent_id: ctx.runtimeAgentId,
    session_key: `agent:${ctx.runtimeAgentId}:${ctx.sessionKey}`,
    source_message_id: payload.source_message_id || "",
    correlation_id: payload.correlation_id || payload.run_id || payload.source_message_id || "",
    ...payload,
  };

  try {
    await insertLogRow(sql, row);
  } catch (error) {
    appendDeadLetter(row, error?.message || String(error));
  }
}

async function handleToolCalls(sql, ctx, toolCalls, runId) {
  for (const call of toolCalls || []) {
    const name = cleanText(call?.name || call?.tool || "unknown_tool");
    const statusRaw = cleanText(call?.status || call?.state || call?.outcome || "started").toLowerCase();
    const status = statusRaw.includes("error") || statusRaw.includes("fail") ? "error" : statusRaw.includes("success") || statusRaw.includes("done") ? "success" : "started";
    const probe = `${name} ${JSON.stringify(call?.arguments || {})} ${JSON.stringify(call?.result || {})}`.toLowerCase();
    const isMemory = hasMemoryHints(probe) || name.includes("memory") || name.includes("qdrant") || name.includes("vector");
    const eventType = isMemory ? inferMemoryEvent(probe, status) : status === "error" ? "tool.error" : status === "started" ? "tool.start" : "tool.success";

    await emitLog(sql, ctx, {
      level: status === "error" ? "error" : "info",
      type: isMemory ? "memory" : "tool",
      run_id: runId,
      event_type: eventType,
      direction: "internal",
      channel_type: probe.includes("qdrant") || probe.includes("vector") ? "qdrant" : "internal",
      status,
      message: `Tool ${name} (${status}) ${preview(JSON.stringify(call?.arguments || {}))}`,
      message_preview: preview(`Tool ${name} (${status}) ${JSON.stringify(call?.arguments || {})}`),
      source_message_id: cleanText(call?.id || ""),
      memory_source: isMemory ? (probe.includes("qdrant") ? "qdrant_vector" : "session") : null,
      memory_key: cleanText(call?.id || ""),
      collection: cleanText(call?.arguments?.collection || call?.collection || ""),
      query_text: cleanText(call?.arguments?.query || call?.arguments?.text || ""),
      result_count: Number.isFinite(call?.result_count) ? call.result_count : null,
      raw_payload: call,
      is_json: true,
      contains_pii: false,
    });
  }
}

async function handleGatewayLine(sql, filePath, line) {
  const raw = cleanText(line);
  if (!raw) return;

  const workspaceId = await getWorkspaceId(sql);
  if (!workspaceId) return;

  const runtimeAgentId = "main";
  const agentDbId = await ensureAgent(sql, workspaceId, runtimeAgentId, "");
  if (!agentDbId) return;

  const lower = raw.toLowerCase();
  const isError = isErrorLike(lower);
  const isTool = lower.includes("tool") || lower.includes("function_call") || lower.includes("call_");
  const isMemory = hasMemoryHints(lower);

  let eventType = "system.warning";
  let type = "system";
  let level = isError ? "error" : "info";

  if (isMemory) {
    type = "memory";
    eventType = inferMemoryEvent(lower, isError ? "error" : "success");
  } else if (isTool) {
    type = "tool";
    eventType = isError ? "tool.error" : "tool.success";
  } else if (lower.includes("startup") || lower.includes("started")) {
    eventType = "system.startup";
  } else if (lower.includes("shutdown") || lower.includes("stopped")) {
    eventType = "system.shutdown";
  } else if (isError) {
    eventType = "system.error";
  }

  await emitLog(sql, {
    workspaceId,
    agentDbId,
    runtimeAgentId,
    sessionKey: `gateway:${path.basename(filePath)}`,
  }, {
    level,
    type,
    run_id: "",
    event_type: eventType,
    direction: "internal",
    channel_type: isMemory ? "qdrant" : "gateway",
    message: raw,
    message_preview: preview(raw),
    source_message_id: "",
    raw_payload: { source: path.basename(filePath), line: raw },
    is_json: false,
    contains_pii: false,
    memory_source: isMemory ? (lower.includes("qdrant") ? "qdrant_vector" : "session") : null,
    retry_count: 0,
  });
}

async function handleSessionLine(sql, filePath, line) {
  const parsed = parseJsonLine(line);
  if (!parsed) return;

  const normalized = normalizeRecord(parsed);
  const { runtimeAgentId, sessionKey } = parseSessionMeta(filePath);
  if (!runtimeAgentId || !sessionKey) return;

  const workspaceId = await getWorkspaceId(sql);
  if (!workspaceId) return;
  const agentDbId = await ensureAgent(sql, workspaceId, runtimeAgentId, normalized.model);
  if (!agentDbId) return;

  const ctx = { workspaceId, agentDbId, runtimeAgentId, sessionKey };

  const role = normalized.role;
  const text = cleanText(normalized.text);
  const runId = normalized.runId || "";
  const sourceMessageId = normalized.sourceMessageId || "";
  const explicitEventType = normalized.eventType || "";

  if (text) {
    let eventType = "system.warning";
    let type = "system";
    let level = "info";
    let direction = "internal";
    let channelType = inferChannelTypeFromText(text);

    if (explicitEventType.startsWith("chat.") || explicitEventType.startsWith("tool.") || explicitEventType.startsWith("memory.") || explicitEventType.startsWith("system.") || explicitEventType.startsWith("heartbeat.")) {
      eventType = explicitEventType;
      if (explicitEventType.startsWith("chat.")) {
        type = "workflow";
        direction = explicitEventType === "chat.user_in" ? "inbound" : "outbound";
      } else if (explicitEventType.startsWith("tool.")) {
        type = "tool";
      } else if (explicitEventType.startsWith("memory.")) {
        type = "memory";
      } else {
        type = "system";
      }
      if (explicitEventType.endsWith("error")) level = "error";
    } else
    if (role === "assistant") {
      eventType = "chat.assistant_out";
      type = "workflow";
      direction = "outbound";
    } else if (role === "user") {
      eventType = "chat.user_in";
      type = "workflow";
      direction = "inbound";
      if (channelType === "internal") channelType = "telegram";
    } else if (role.includes("tool")) {
      type = "tool";
      eventType = isErrorLike(text) ? "tool.error" : "tool.success";
      level = isErrorLike(text) ? "error" : "info";
    } else if (hasMemoryHints(text)) {
      type = "memory";
      eventType = inferMemoryEvent(text, isErrorLike(text) ? "error" : "success");
      channelType = text.toLowerCase().includes("qdrant") ? "qdrant" : "internal";
      level = isErrorLike(text) ? "error" : "info";
    } else {
      eventType = isErrorLike(text) ? "system.error" : "system.warning";
      type = "system";
      level = isErrorLike(text) ? "error" : "warning";
    }

    await emitLog(sql, ctx, {
      level,
      type,
      run_id: runId,
      event_type: eventType,
      direction,
      channel_type: channelType,
      message: text,
      message_preview: preview(text),
      source_message_id: sourceMessageId,
      raw_payload: normalized.raw,
      is_json: false,
      contains_pii: false,
      memory_source: type === "memory" ? (channelType === "qdrant" ? "qdrant_vector" : "session") : null,
      retry_count: 0,
    });
  }

  if (normalized.toolCalls?.length) {
    await handleToolCalls(sql, ctx, normalized.toolCalls, runId);
  }
}

function tailFile(getSql, onDbReset, filePath, handler, startFromBeginning = false) {
  if (watched.has(filePath)) return;
  watched.add(filePath);

  let pos = 0;
  let draining = false;
  let pending = false;

  const drain = () => {
    if (draining) {
      pending = true;
      return;
    }
    draining = true;
    fs.stat(filePath, (err, stat) => {
      if (err) {
        draining = false;
        return;
      }
      if (stat.size < pos) pos = 0;
      if (stat.size === pos) {
        draining = false;
        if (pending) {
          pending = false;
          drain();
        }
        return;
      }

      const end = stat.size;
      const stream = fs.createReadStream(filePath, { start: pos, end });
      const rl = readline.createInterface({ input: stream });
      rl.on("line", (line) => {
        handler(getSql(), filePath, line).catch((e) => {
          if (isConnectionEndedError(e)) {
            console.warn("[bridge-logger] DB connection ended during line processing; reconnecting...");
            onDbReset();
            return;
          }
          console.error("[bridge-logger] line error:", e?.message || e);
        });
      });
      rl.on("close", () => {
        pos = end;
        setOffset(filePath, pos);
        draining = false;
        if (pending) {
          pending = false;
          drain();
        }
      });
    });
  };

  fs.stat(filePath, (err, stat) => {
    if (err) return;
    const offset = getOffset(filePath);
    if (offset == null) {
      if (startFromBeginning) {
        // Cron run files: always read from the start — the result is already in the file
        pos = 0;
        setOffset(filePath, 0);
        drain();
      } else {
        // Session/gateway files: skip existing content on first encounter
        pos = stat.size;
        setOffset(filePath, pos);
      }
      return;
    }
    pos = Math.min(offset, stat.size);
    if (stat.size > pos) drain();
  });

  try {
    // Use polling-based watch for better compatibility (avoid "illegal path" errors with inotify)
    fs.watchFile(filePath, { interval: 1000 }, () => drain());
  } catch (error) {
    console.error(`[bridge-logger] fs.watchFile failed for ${filePath}:`, error?.message || error);
  }
}

async function heartbeat(sql) {
  const workspaceId = await getWorkspaceId(sql);
  if (!workspaceId) return;
  const rows = await sql`select id from agents where workspace_id=${workspaceId}`;
  for (const row of rows) {
    await sql`update agents set last_heartbeat_at=now(), updated_at=now() where id=${row.id}`;
  }
}

// ── Cron run JSONL watcher ───────────────────────────────────────────────────
// Watches ~/.openclaw/cron/runs/<jobId>.jsonl for new lines.
// Each line is a finished cron run. On completion we:
//   1. Write agenda_run_attempts + agenda_run_steps so the Output tab works.
//   2. pg_notify('agenda_change') so the calendar updates instantly.
//   3. Trigger Qdrant cleanup for failed sessions.
// This replaces the scheduler's polling-based syncCronRunResults() entirely.

function listCronRunFiles() {
  if (!fs.existsSync(CRON_RUNS_DIR)) return [];
  return fs
    .readdirSync(CRON_RUNS_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(CRON_RUNS_DIR, f));
}

/** Parse jobId from the file path: ~/.openclaw/cron/runs/<jobId>.jsonl */
function cronJobIdFromPath(filePath) {
  return path.basename(filePath, ".jsonl");
}

/**
 * Delete Qdrant memory entries that were written by a failed isolated session.
 * Parses the session JSONL for memory_store tool result IDs.
 * We use proper JSON parsing (not regex) to avoid false positives.
 */
async function cleanupFailedCronSessionMemories(sessionId) {
  if (!sessionId) return;
  const sessionFilePath = path.join(OPENCLAW_HOME, "agents", "main", "sessions", `${sessionId}.jsonl`);
  const ids = [];
  try {
    const raw = fs.readFileSync(sessionFilePath, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let parsed;
      try { parsed = JSON.parse(line); } catch { continue; }
      // Look for tool result lines where the tool was memory_store
      const role = parsed?.role ?? parsed?.message?.role ?? "";
      if (role !== "tool") continue;
      const toolName = parsed?.name ?? parsed?.message?.name ?? "";
      if (toolName !== "memory_store") continue;
      // The result content contains the stored memory id
      const content = parsed?.content ?? parsed?.message?.content ?? "";
      const text = typeof content === "string" ? content : JSON.stringify(content);
      const match = text.match(/["']id["']\s*:\s*["']([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})["']/i);
      if (match?.[1]) ids.push(match[1]);
    }
  } catch {
    // Session file may not exist yet or be unreadable — skip silently
    return;
  }
  if (ids.length === 0) return;
  try {
    const resp = await fetch("http://localhost:6333/collections/memories/points/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: [...new Set(ids)] }),
    });
    if (resp.ok) {
      console.log(`[bridge-logger] cron cleanup: deleted ${ids.length} orphaned Qdrant entries from session ${sessionId}`);
    } else {
      console.warn(`[bridge-logger] cron cleanup: Qdrant delete returned ${resp.status} for session ${sessionId}`);
    }
  } catch (err) {
    console.warn(`[bridge-logger] cron cleanup: Qdrant request failed for session ${sessionId}:`, err.message);
  }
}

/**
 * Emit a structured agenda log entry into agent_logs.
 * These are the events visible in the Agenda Logs panel.
 * event_type uses the "agenda.*" namespace so they can be filtered.
 */
async function emitAgendaLog(sql, {
  workspaceId,
  agentDbId,
  agentId,
  occurrenceId,
  sessionKey,
  eventType,   // e.g. "agenda.started" | "agenda.succeeded" | "agenda.failed" | "agenda.fallback"
  level,       // "info" | "warn" | "error"
  message,
  rawPayload = null,
}) {
  const preview = String(message || "").slice(0, 240);
  try {
    // Ensure agent row exists (agent_id is NOT NULL in agent_logs)
    let resolvedAgentDbId = agentDbId;
    if (!resolvedAgentDbId && workspaceId && agentId) {
      resolvedAgentDbId = await ensureAgent(sql, workspaceId, agentId);
    }
    if (!resolvedAgentDbId) {
      console.warn('[bridge-logger] emitAgendaLog: could not resolve agentDbId, skipping log');
      return;
    }
    await sql`
      INSERT INTO agent_logs (
        workspace_id, agent_id, runtime_agent_id, occurred_at, level, type,
        message, event_type, session_key, direction, channel_type,
        message_preview, is_json, contains_pii, agenda_occurrence_id,
        raw_payload
      ) VALUES (
        ${workspaceId}, ${resolvedAgentDbId}, ${agentId}, now(), ${level}, 'agenda',
        ${message}, ${eventType}, ${sessionKey || null}, 'internal', 'internal',
        ${preview}, ${rawPayload != null}, false, ${occurrenceId || null},
        ${rawPayload ? sql.json(rawPayload) : null}
      )
      ON CONFLICT DO NOTHING
    `;
  } catch (err) {
    // Non-fatal — log emission failure must never break the main sync path
    console.warn('[bridge-logger] emitAgendaLog failed:', err?.message);
  }
}


/**
 * Process a single finished cron run line and write results to the DB.
 *
 * Flow (per run):
 *   1. Find occurrence by cron_job_id — status must be queued or running
 *   2. Claim it: queued → running with locked_at = run start time
 *      (enables the stale-running sweep in the scheduler)
 *   3. Write final result via domain transitions (succeeded / needs_retry)
 *   4. Write agenda_run_attempts + agenda_run_steps (cron_job_id column)
 *   5. pg_notify so the UI updates immediately
 */
async function handleCronRunLine(getSql, jobId, line) {
  let run;
  try { run = JSON.parse(line); } catch { return; }

  if (run?.action !== "finished") return;

  const sql = getSql();

  // Find the occurrence that owns this cron job.
  const occurrences = await sql`
    SELECT ao.id as occurrence_id, ao.agenda_event_id, ao.latest_attempt_no,
           ao.fallback_attempted, ao.rendered_prompt, ao.status,
           ae.title, ae.fallback_model, ae.default_agent_id, ae.execution_window_minutes, ae.session_target
    FROM agenda_occurrences ao
    JOIN agenda_events ae ON ae.id = ao.agenda_event_id
    WHERE ao.cron_job_id = ${jobId}
      AND ao.status IN ('queued', 'running')
    LIMIT 1
  `;

  if (occurrences.length === 0) {
    // No matching occurrence — cron job may have been a manual retry or already synced
    return;
  }

  const occ = occurrences[0];
  const attemptNo = Number(occ.latest_attempt_no || 0) + 1;
  const succeeded = run.status === "ok";
  const errorText = String(run.error || "").slice(0, 2000);
  const summaryText = String(run.summary || "").slice(0, 8000);
  const startedAt = new Date(run.runAtMs || Date.now());
  const finishedAt = new Date((run.runAtMs || Date.now()) + (run.durationMs || 0));
  const sessionKey = run.sessionKey || `agent:main:cron:${jobId}`;

  // Resolve workspace + agent DB IDs for agenda log emission (best-effort)
  let wid = null;
  let agentDbId = null;
  try {
    const [ws] = await sql`SELECT id FROM workspaces ORDER BY created_at ASC LIMIT 1`;
    wid = ws?.id || null;
    if (wid) {
      const [ag] = await sql`SELECT id FROM agents WHERE workspace_id = ${wid} AND openclaw_agent_id = ${occ.default_agent_id || 'main'} LIMIT 1`;
      agentDbId = ag?.id || null;
    }
  } catch { /* non-fatal */ }

  // 4A: Claim the occurrence as running before writing the final result.
  // locked_at is set to the actual run start time so the stale-running sweep
  // has accurate timing data (not just "when bridge-logger processed this").
  if (occ.status === 'queued') {
    await sql`
      UPDATE agenda_occurrences
      SET status = 'running',
          locked_at = ${startedAt}
      WHERE id = ${occ.occurrence_id}
        AND status = 'queued'
    `;
    // Emit: agenda run started
    await emitAgendaLog(sql, {
      workspaceId: wid,
      agentDbId,
      agentId: occ.default_agent_id || 'main',
      occurrenceId: occ.occurrence_id,
      sessionKey,
      eventType: 'agenda.started',
      level: 'info',
      message: `Agenda run started: "${occ.title}" (attempt ${attemptNo}, cron job ${jobId})`,
      rawPayload: { cronJobId: jobId, attemptNo, model: run.model || null, sessionId: run.sessionId || null },
    });
  }

  if (succeeded) {
    // ── Success path ──────────────────────────────────────────────────────────
    const written = await transitionOccurrenceToSucceeded(sql, {
      occurrenceId: occ.occurrence_id,
      attemptNo,
    });
    if (!written) return; // Another process got there first (race guard)

    const [attempt] = await sql`
      INSERT INTO agenda_run_attempts
        (occurrence_id, attempt_no, cron_job_id, status, started_at, finished_at, summary)
      VALUES
        (${occ.occurrence_id}, ${attemptNo}, ${jobId}, 'succeeded',
         ${startedAt}, ${finishedAt}, ${summaryText})
      ON CONFLICT DO NOTHING
      RETURNING id
    `;

    if (attempt?.id) {
      await sql`
        INSERT INTO agenda_run_steps
          (run_attempt_id, step_order, agent_id, input_payload, output_payload, status, started_at, finished_at)
        VALUES
          (${attempt.id}, 0, ${occ.default_agent_id || 'main'},
           ${sql.json({ cronJobId: jobId, prompt: String(occ.rendered_prompt || '').slice(0, 2000) })},
           ${sql.json({ output: summaryText })},
           'succeeded', ${startedAt}, ${finishedAt})
        ON CONFLICT DO NOTHING
      `;
    }

    await sql`SELECT pg_notify('agenda_change', ${JSON.stringify({ action: 'succeeded', occurrenceId: occ.occurrence_id })})`;
    // Notify main session (only for isolated runs — main session runs are already in chat)
    notifyMainSession(occ.session_target || 'isolated', {
      title: occ.title, status: 'succeeded', summary: summaryText,
      occurrenceId: occ.occurrence_id, eventId: occ.agenda_event_id,
    }).catch(() => {});
    await emitAgendaLog(sql, {
      workspaceId: wid, agentDbId,
      agentId: occ.default_agent_id || 'main',
      occurrenceId: occ.occurrence_id, sessionKey,
      eventType: 'agenda.succeeded', level: 'info',
      message: `Agenda run succeeded: "${occ.title}" (attempt ${attemptNo}, ${run.durationMs ? Math.round(run.durationMs/1000)+'s' : 'unknown duration'})`,
      rawPayload: { cronJobId: jobId, attemptNo, durationMs: run.durationMs, summary: summaryText, model: run.model || null },
    });
    console.log(`[bridge-logger] cron ${jobId} → occurrence ${occ.occurrence_id} succeeded (attempt ${attemptNo})`);

  } else {
    // ── Failure path ──────────────────────────────────────────────────────────
    const [attempt] = await sql`
      INSERT INTO agenda_run_attempts
        (occurrence_id, attempt_no, cron_job_id, status, started_at, finished_at, summary, error_message)
      VALUES
        (${occ.occurrence_id}, ${attemptNo}, ${jobId}, 'failed',
         ${startedAt}, ${finishedAt}, ${summaryText}, ${errorText})
      ON CONFLICT DO NOTHING
      RETURNING id
    `;

    if (attempt?.id) {
      await sql`
        INSERT INTO agenda_run_steps
          (run_attempt_id, step_order, agent_id, input_payload, output_payload, status,
           started_at, finished_at, error_message)
        VALUES
          (${attempt.id}, 0, ${occ.default_agent_id || 'main'},
           ${sql.json({ cronJobId: jobId, prompt: String(occ.rendered_prompt || '').slice(0, 2000) })},
           ${sql.json({ output: errorText || summaryText })},
           'failed', ${startedAt}, ${finishedAt}, ${errorText})
        ON CONFLICT DO NOTHING
      `;
    }

    // Qdrant cleanup for failed isolated sessions
    if (run.sessionId) {
      cleanupFailedCronSessionMemories(run.sessionId).catch((e) =>
        console.warn(`[bridge-logger] cron cleanup error for session ${run.sessionId}:`, e.message)
      );
    }

    // Load settings to check fallback model threshold
    const [settings] = await sql`SELECT max_retries, default_fallback_model FROM worker_settings WHERE id = 1 LIMIT 1`;
    const maxRetries = Math.max(1, Number(settings?.max_retries ?? 1));
    const globalFallback = String(settings?.default_fallback_model || "").trim();
    const fallbackModel = String(occ.fallback_model || globalFallback || "").trim();

    const shouldTryFallback = fallbackModel && !occ.fallback_attempted && attemptNo >= maxRetries;

    if (shouldTryFallback) {
      // Mark fallback_attempted before transitioning — prevents a second fallback attempt
      // if the scheduler sees this before the status updates.
      await sql`
        UPDATE agenda_occurrences
        SET fallback_attempted = true, cron_synced_at = now()
        WHERE id = ${occ.occurrence_id}
      `;
      await transitionOccurrenceToNeedsRetry(sql, {
        occurrenceId: occ.occurrence_id,
        attemptNo,
        reasonText: 'RETRY_EXHAUSTED: primary retries exhausted, fallback model queued',
      });
      await sql`SELECT pg_notify('agenda_change', ${JSON.stringify({
        action: 'needs_retry',
        occurrenceId: occ.occurrence_id,
        fallbackModel,
        scheduleFallback: true,
      })})`;
      await emitAgendaLog(sql, {
        workspaceId: wid, agentDbId,
        agentId: occ.default_agent_id || 'main',
        occurrenceId: occ.occurrence_id, sessionKey,
        eventType: 'agenda.fallback', level: 'warn',
        message: `Agenda run exhausted primary retries, queuing fallback model for "${occ.title}" (attempt ${attemptNo})`,
        rawPayload: { cronJobId: jobId, attemptNo, fallbackModel, error: errorText.slice(0, 400) },
      });
      console.warn(`[bridge-logger] cron ${jobId} → occurrence ${occ.occurrence_id} exhausted — queuing fallback model ${fallbackModel}`);
    } else if (occ.fallback_attempted) {
      // Fallback also failed — this is a terminal failure. Mark as 'failed' (not retryable
      // without a manual Force Retry). Alert the user.
      await transitionOccurrenceToFailed(sql, {
        occurrenceId: occ.occurrence_id,
        attemptNo,
        reasonText: `FALLBACK_EXHAUSTED: ${errorText.slice(0, 400)}`,
      });
      await sql`SELECT pg_notify('agenda_change', ${JSON.stringify({ action: 'failed', occurrenceId: occ.occurrence_id })})`;
      await emitAgendaLog(sql, {
        workspaceId: wid, agentDbId,
        agentId: occ.default_agent_id || 'main',
        occurrenceId: occ.occurrence_id, sessionKey,
        eventType: 'agenda.failed', level: 'error',
        message: `Agenda run permanently failed (fallback also exhausted): "${occ.title}" (attempt ${attemptNo}) — ${errorText.slice(0, 300)}`,
        rawPayload: { cronJobId: jobId, attemptNo, error: errorText.slice(0, 1000), durationMs: run.durationMs, terminal: true },
      });
      console.warn(`[bridge-logger] cron ${jobId} → occurrence ${occ.occurrence_id} FAILED (terminal): ${errorText.slice(0, 120)}`);
      notifyMainSession(occ.session_target || 'isolated', {
        title: occ.title, status: 'failed', summary: errorText.slice(0, 200),
        occurrenceId: occ.occurrence_id, eventId: occ.agenda_event_id,
      }).catch(() => {});
      sendTelegramAlert(getSql, occ.title, occ.occurrence_id, errorText).catch(() => {});
    } else {
      // Retries exhausted, no fallback configured (or fallback not yet attempted via scheduler).
      // Mark needs_retry — user can manually retry or the fallback signal will kick in.
      await transitionOccurrenceToNeedsRetry(sql, {
        occurrenceId: occ.occurrence_id,
        attemptNo,
        reasonText: `RETRY_EXHAUSTED: ${errorText.slice(0, 400)}`,
      });
      await sql`UPDATE agenda_occurrences SET cron_synced_at = now() WHERE id = ${occ.occurrence_id}`;
      await sql`SELECT pg_notify('agenda_change', ${JSON.stringify({ action: 'needs_retry', occurrenceId: occ.occurrence_id })})`;
      await emitAgendaLog(sql, {
        workspaceId: wid, agentDbId,
        agentId: occ.default_agent_id || 'main',
        occurrenceId: occ.occurrence_id, sessionKey,
        eventType: 'agenda.failed', level: 'error',
        message: `Agenda run failed: "${occ.title}" (attempt ${attemptNo}) — ${errorText.slice(0, 300)}`,
        rawPayload: { cronJobId: jobId, attemptNo, error: errorText.slice(0, 1000), durationMs: run.durationMs },
      });
      console.warn(`[bridge-logger] cron ${jobId} → occurrence ${occ.occurrence_id} needs_retry: ${errorText.slice(0, 120)}`);
      notifyMainSession(occ.session_target || 'isolated', {
        title: occ.title, status: 'needs_retry', summary: errorText.slice(0, 200),
        occurrenceId: occ.occurrence_id, eventId: occ.agenda_event_id,
      }).catch(() => {});
      sendTelegramAlert(getSql, occ.title, occ.occurrence_id, errorText).catch(() => {});
    }
  }
}
/** Send a Telegram alert for a failed occurrence. Reads chatId from app_settings. */
/**
 * Inject a short system event into the main OpenClaw session to notify
 * the main agent that an agenda task finished.
 * Only fires for isolated sessions — main session runs already land in chat.
 * Non-fatal.
 */
async function notifyMainSession(sessionTarget, { title, status, summary, occurrenceId, eventId }) {
  if (sessionTarget !== 'isolated') return; // main session user already sees the output
  try {
    const statusEmoji = status === 'succeeded' ? '✅' : status === 'needs_retry' ? '⚠️' : '❌';
    const statusLabel = status === 'succeeded' ? 'completed' : status === 'needs_retry' ? 'needs retry' : 'failed';
    const snippet = summary ? ` — ${String(summary).slice(0, 120)}${summary.length > 120 ? '…' : ''}` : '';
    const systemEvent = `${statusEmoji} Agenda task "${title}" ${statusLabel}${snippet}. (Mission Control)`;
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    await execFileAsync("openclaw", [
      "cron", "add",
      "--at", "5s",
      "--session", "main",
      "--system-event", systemEvent,
      "--delete-after-run",
      "--json",
    ], { timeout: 15000 });
  } catch (err) {
    console.warn("[bridge-logger] notifyMainSession failed (non-fatal):", err?.message);
  }
}

async function sendTelegramAlert(getSql, title, occurrenceId, reason) {
  try {
    const sql = getSql();
    const [settings] = await sql`SELECT gateway_token FROM app_settings WHERE id = 1 LIMIT 1`;
    if (!settings?.gateway_token) return;
    // Discover chatId from sessions.json
    const sessionsPath = path.join(OPENCLAW_HOME, "agents", "main", "sessions", "sessions.json");
    let chatId;
    try {
      const data = JSON.parse(fs.readFileSync(sessionsPath, "utf8"));
      for (const val of Object.values(data)) {
        if (val?.deliveryContext?.channel === "telegram" && val?.deliveryContext?.to) {
          chatId = String(val.deliveryContext.to).replace(/^telegram:/, "");
          break;
        }
      }
    } catch { return; }
    if (!chatId) return;
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    await execFileAsync("openclaw", [
      "message", "send",
      "--channel", "telegram",
      "--target", chatId,
      "--message", `⚠️ Agenda event "${title}" needs manual retry\n\nReason: ${String(reason || "").slice(0, 200)}\n\nOpen Mission Control to retry.`,
    ], { timeout: 30000 });
  } catch (err) {
    console.warn("[bridge-logger] Telegram alert failed:", err.message);
  }
}

async function main() {
  ensureStateDir();
  acquireLockOrExit();
  loadOffsets();

  const databaseUrl = process.env.DATABASE_URL || process.env.OPENCLAW_DATABASE_URL || "postgresql://openclaw:openclaw@localhost:5432/mission_control";
  let sql = postgres(databaseUrl, { max: 2, prepare: false });

  const getSql = () => sql;

  const resetSql = () => {
    try {
      void sql.end({ timeout: 1 });
    } catch {
      // ignore
    }
    sql = postgres(databaseUrl, { max: 2, prepare: false });
  };

  const guarded = async (fn) => {
    try {
      await fn();
    } catch (error) {
      if (isConnectionEndedError(error)) {
        console.warn("[bridge-logger] DB connection ended; reconnecting...");
        resetSql();
        return;
      }
      throw error;
    }
  };

  const scan = () => {
    const sessionFiles = listSessionFiles();
    for (const filePath of sessionFiles) tailFile(getSql, resetSql, filePath, handleSessionLine);

    const gatewayFiles = listGatewayFiles();
    for (const filePath of gatewayFiles) tailFile(getSql, resetSql, filePath, handleGatewayLine);

    // Watch cron run result files — each file is one job, each line is one completed run.
    // This is the source of truth for agenda occurrence result sync (replaces scheduler polling).
    const cronRunFiles = listCronRunFiles();
    for (const filePath of cronRunFiles) {
      const jobId = cronJobIdFromPath(filePath);
      tailFile(
        getSql,
        resetSql,
        filePath,
        (sql, fp, line) => handleCronRunLine(getSql, jobId, line).catch((err) =>
          console.error(`[bridge-logger] cron run handler error for job ${jobId}:`, err.message)
        ),
        true, // startFromBeginning — cron run result is already written when we first see the file
      );
    }

    flushOffsets();
  };

  // Service health heartbeat
  async function blWriteHeartbeat(status = "running", lastError = null) {
    try {
      await getSql()`
        INSERT INTO service_health (name, status, pid, last_heartbeat_at, last_error, started_at, updated_at)
        VALUES (${BL_SERVICE_NAME}, ${status}, ${process.pid}, now(), ${lastError}, now(), now())
        ON CONFLICT (name) DO UPDATE SET
          status = ${status},
          pid = ${process.pid},
          last_heartbeat_at = now(),
          last_error = COALESCE(${lastError}, service_health.last_error),
          updated_at = now()
      `;
    } catch (err) {
      console.warn("[bridge-logger] Service heartbeat write failed:", err.message);
    }
  }

  scan();
  const scanTimer = setInterval(scan, SCAN_INTERVAL_MS);
  const deadLetterTimer = setInterval(() => {
    void guarded(() => replayDeadLetters(getSql()));
  }, DEAD_LETTER_REPLAY_MS);
  const heartbeatTimer = setInterval(() => {
    void guarded(() => heartbeat(getSql()));
  }, HEARTBEAT_INTERVAL_MS);

  // Service health heartbeat on startup + every 30s
  void guarded(() => blWriteHeartbeat("running"));
  const serviceHeartbeatTimer = setInterval(() => {
    void guarded(() => blWriteHeartbeat("running"));
  }, 30_000);

  const shutdown = async () => {
    clearInterval(scanTimer);
    clearInterval(deadLetterTimer);
    clearInterval(heartbeatTimer);
    clearInterval(serviceHeartbeatTimer);
    await blWriteHeartbeat("stopped").catch(() => {});
    flushOffsets();
    await sql.end({ timeout: 3 });
    releaseLock();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("[bridge-logger] started");
}

main().catch((error) => {
  console.error("[bridge-logger] fatal:", error?.stack || error?.message || error);
  releaseLock();
  process.exit(1);
});
