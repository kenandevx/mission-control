#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import os from "node:os";
import postgres from "postgres";

const WORKSPACE_ROOT = path.resolve(path.join(import.meta.dirname, ".."));
const STATE_DIR = path.join(WORKSPACE_ROOT, ".runtime", "bridge-logger");
const OFFSETS_PATH = path.join(STATE_DIR, "offsets.json");
const DEAD_LETTER_PATH = path.join(STATE_DIR, "dead-letter.jsonl");
const LOCK_PATH = path.join(STATE_DIR, "bridge-logger.lock");

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(os.homedir(), ".openclaw");
const AGENTS_DIR = path.join(OPENCLAW_HOME, "agents");
const GATEWAY_LOG_DIR = "/tmp/openclaw";

const SCAN_INTERVAL_MS = 5000;
const DEAD_LETTER_REPLAY_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 45000;
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
          if (previousPid === process.pid && isRecent) {
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
  const existing = await sql`
    select id from agents where workspace_id=${workspaceId} and openclaw_agent_id=${runtimeAgentId} limit 1
  `;
  if (existing[0]?.id) {
    if (model) {
      await sql`update agents set model=${model}, updated_at=now(), last_heartbeat_at=now() where id=${existing[0].id}`;
    }
    return existing[0].id;
  }
  const inserted = await sql`
    insert into agents (workspace_id, openclaw_agent_id, status, model, last_heartbeat_at)
    values (${workspaceId}, ${runtimeAgentId}, 'running', ${model || null}, now())
    returning id
  `;
  return inserted[0]?.id;
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

function tailFile(getSql, onDbReset, filePath, handler) {
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
      pos = stat.size;
      setOffset(filePath, pos);
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

    flushOffsets();
  };

  scan();
  const scanTimer = setInterval(scan, SCAN_INTERVAL_MS);
  const deadLetterTimer = setInterval(() => {
    void guarded(() => replayDeadLetters(getSql()));
  }, DEAD_LETTER_REPLAY_MS);
  const heartbeatTimer = setInterval(() => {
    void guarded(() => heartbeat(getSql()));
  }, HEARTBEAT_INTERVAL_MS);

  const shutdown = async () => {
    clearInterval(scanTimer);
    clearInterval(deadLetterTimer);
    clearInterval(heartbeatTimer);
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
