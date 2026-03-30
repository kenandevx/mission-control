#!/usr/bin/env node
import postgres from "postgres";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Worker, Queue } from "bullmq";
import { normalizeWorkerSettings } from "../lib/tasks/worker-core.mjs";
import { enqueueTicket } from "../lib/tasks/ticket-queue.mjs";
import { getRunArtifactDir, writeRunArtifacts, ensureArtifactDir } from "./runtime-artifacts.mjs";
import { renderUnifiedTaskMessage } from "./prompt-renderer.mjs";

const execFileAsync = promisify(execFile);

const connectionString = process.env.DATABASE_URL?.trim() || process.env.OPENCLAW_DATABASE_URL?.trim();
if (!connectionString) {
  console.error("[task-worker] Missing DATABASE_URL or OPENCLAW_DATABASE_URL");
  process.exit(1);
}

const TW_SERVICE_NAME = "task-worker";

const redisConnection = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
};

const sql = postgres(connectionString, { max: 10, prepare: false, idle_timeout: 20, connect_timeout: 10 });
let shuttingDown = false;
let promoteTimer = null;
let settingsTimer = null;
let ticketWorker = null;
const myQueue = process.env.WORKER_QUEUE || "default";
// Retry logic: 1 instant retry + 1 fallback retry = max 3 attempts total
let latestSettings = { enabled: true, pollIntervalSeconds: 20, maxConcurrency: 3 };

let _openclawConfig = null;
async function getOpenclawConfig() {
  if (_openclawConfig) return _openclawConfig;
  try {
    const configPath = process.env.OPENCLAW_CONFIG_PATH || `${process.env.OPENCLAW_HOME || "/home/nodejs"}/openclaw.json`;
    const raw = await fs.readFile(configPath, "utf8");
    _openclawConfig = JSON.parse(raw);
  } catch {
    _openclawConfig = {};
  }
  return _openclawConfig;
}

async function getOpenclawHome() {
  // Derive home from openclaw.json or known defaults
  const configPath = process.env.OPENCLAW_CONFIG_PATH || "/home/clawdbot/.openclaw/openclaw.json";
  try {
    // Home dir is the parent of openclaw.json
    return path.dirname(configPath);
  } catch {
    return "/home/clawdbot/.openclaw";
  }
}

// ── DB migration for cleanup columns ──────────────────────────────────────────
async function ensureCleanupColumns() {
  try {
    await sql`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS cleanup_status text`;
    await sql`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS cleanup_details jsonb`;
    await sql`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS session_snapshots jsonb`;
    console.log("[task-worker] Cleanup columns ensured");
  } catch (err) {
    console.warn("[task-worker] ensureCleanupColumns failed:", err.message);
  }
}

// ── Cleanup system helpers (ported from agenda-worker) ────────────────────────

const CLEANUP_ALLOWED_PREFIXES = ["/home/clawdbot/", "/storage/", "/tmp/"];
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.resolve(process.env.HOME || "/home/clawdbot", ".openclaw");

/**
 * Get session file path and current byte offset for an agent's main session.
 */
async function getAgentSessionSnapshot(agentId) {
  const sessionsPath = path.resolve(OPENCLAW_HOME, `agents/${agentId}/sessions/sessions.json`);
  try {
    const raw = await fs.readFile(sessionsPath, "utf8");
    const data = JSON.parse(raw);
    const mainKey = `agent:${agentId}:main`;
    const entry = data[mainKey];
    if (!entry?.sessionId) {
      console.warn(`[task-worker] No main session found for agent ${agentId} (key: ${mainKey})`);
      return null;
    }
    const sessionFilePath = entry.sessionFile || path.resolve(OPENCLAW_HOME, `agents/${agentId}/sessions/${entry.sessionId}.jsonl`);
    let byteOffset = 0;
    try {
      const s = await fs.stat(sessionFilePath);
      byteOffset = s.size;
    } catch {
      // File doesn't exist yet — offset 0
    }
    return { agentId, sessionFilePath, byteOffset };
  } catch (err) {
    console.warn(`[task-worker] Failed to read sessions.json for agent ${agentId}:`, err.message);
    return null;
  }
}

/**
 * Parse session file bytes for memory_store IDs.
 */
function parseMemoryStoreIds(sessionBytes) {
  const ids = [];
  const text = sessionBytes.toString("utf8");
  const lines = text.split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      if (!line.includes("memory_store")) continue;
      const uuidRegex = /["']id["']\s*:\s*["']([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})["']/gi;
      let match;
      while ((match = uuidRegex.exec(line)) !== null) {
        ids.push(match[1]);
      }
    } catch { /* skip */ }
  }
  return [...new Set(ids)];
}

/**
 * Delete memory entries from Qdrant via REST API.
 */
async function deleteQdrantMemories(memoryIds) {
  if (memoryIds.length === 0) return { deleted: [], errors: [] };
  const deleted = [];
  const errors = [];
  try {
    const resp = await fetch("http://localhost:6333/collections/memories/points/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: memoryIds }),
    });
    if (resp.ok) {
      deleted.push(...memoryIds);
      console.log(`[task-worker] Deleted ${memoryIds.length} memory entries from Qdrant`);
    } else {
      const body = await resp.text();
      errors.push(`Qdrant delete failed (${resp.status}): ${body.slice(0, 200)}`);
    }
  } catch (err) {
    errors.push(`Qdrant delete error: ${err.message}`);
  }
  return { deleted, errors };
}

/**
 * Run full 3-phase cleanup for a failed ticket.
 */
async function runFailureCleanup(ticketId, snapshots, detectedFilePaths, attemptStartTime) {
  const details = { memoryIds: [], filesDeleted: [], sessionsRestored: 0, errors: [] };

  try {
    await sql`UPDATE tickets SET cleanup_status = 'pending' WHERE id = ${ticketId}::uuid`;

    // Phase 1: Qdrant memory cleanup
    for (const snap of snapshots) {
      try {
        const { sessionFilePath, byteOffset } = snap;
        const currentStat = await fs.stat(sessionFilePath).catch(() => null);
        if (!currentStat || currentStat.size <= byteOffset) continue;

        const fd = await fs.open(sessionFilePath, "r");
        try {
          const bytesToRead = currentStat.size - byteOffset;
          const buf = Buffer.alloc(bytesToRead);
          await fd.read(buf, 0, bytesToRead, byteOffset);
          const memoryIds = parseMemoryStoreIds(buf);
          if (memoryIds.length > 0) {
            const result = await deleteQdrantMemories(memoryIds);
            details.memoryIds.push(...result.deleted);
            details.errors.push(...result.errors);
          }
        } finally {
          await fd.close();
        }
      } catch (err) {
        details.errors.push(`Memory cleanup for ${snap.agentId}: ${err.message}`);
      }
    }

    // Phase 2: Session file truncation
    for (const snap of snapshots) {
      try {
        const { sessionFilePath, byteOffset, agentId } = snap;
        if (!sessionFilePath || typeof byteOffset !== "number" || byteOffset < 0) {
          details.errors.push(`${agentId}: invalid snapshot data`);
          continue;
        }
        if (!sessionFilePath.includes("/.openclaw/agents/") || !sessionFilePath.endsWith(".jsonl")) {
          details.errors.push(`${agentId}: path rejected (safety check)`);
          continue;
        }
        const currentStat = await fs.stat(sessionFilePath).catch(() => null);
        if (!currentStat || !currentStat.isFile()) continue;
        if (currentStat.size > byteOffset) {
          await fs.truncate(sessionFilePath, byteOffset);
          details.sessionsRestored++;
          console.log(`[task-worker] Truncated session for agent ${agentId}: ${currentStat.size} → ${byteOffset} bytes`);
        }
      } catch (err) {
        details.errors.push(`Session truncate for ${snap.agentId}: ${err.message}`);
      }
    }

    // Phase 3: File deletion (targeted, never folder-recursive)
    const startTime = new Date(attemptStartTime).getTime();
    for (const filePath of detectedFilePaths) {
      try {
        const cleaned = String(filePath || "").replace(/[.,;:!?)}\]]+$/, "").trim();
        if (!cleaned) continue;
        if (!CLEANUP_ALLOWED_PREFIXES.some((p) => cleaned.startsWith(p))) continue;

        const fstat = await fs.lstat(cleaned).catch(() => null);
        if (!fstat || !fstat.isFile()) continue; // never touch folders/symlinks

        const ctime = Number(fstat.ctimeMs || 0);
        const mtime = Number(fstat.mtimeMs || 0);
        const birth = Number(fstat.birthtimeMs || 0);
        const changedAfterAttempt = ctime > startTime || mtime > startTime || birth > startTime;
        if (!changedAfterAttempt) continue; // don't touch pre-existing files

        await fs.unlink(cleaned);
        details.filesDeleted.push(cleaned);
        console.log(`[task-worker] Deleted file: ${cleaned}`);
      } catch (err) {
        details.errors.push(`File delete ${filePath}: ${err.message}`);
      }
    }

    const status = details.errors.length > 0 ? "failed" : "completed";
    await sql`
      UPDATE tickets
      SET cleanup_status = ${status}, cleanup_details = ${sql.json(details)}
      WHERE id = ${ticketId}::uuid
    `;
    console.log(`[task-worker] Cleanup ${status} for ticket ${ticketId}: ${details.sessionsRestored} sessions restored, ${details.memoryIds.length} memories deleted, ${details.filesDeleted.length} files deleted`);
  } catch (err) {
    console.error(`[task-worker] Cleanup error for ticket ${ticketId}:`, err.message);
    details.errors.push(`Cleanup error: ${err.message}`);
    try {
      await sql`
        UPDATE tickets
        SET cleanup_status = 'failed', cleanup_details = ${sql.json(details)}
        WHERE id = ${ticketId}::uuid
      `;
    } catch { /* best effort */ }
  }
  return details;
}

/**
 * Recover incomplete cleanups from previous crashes.
 */
async function recoverPendingCleanups() {
  try {
    const pending = await sql`
      SELECT id, session_snapshots, cleanup_details
      FROM tickets
      WHERE cleanup_status = 'pending'
    `;
    if (pending.length === 0) return;
    console.log(`[task-worker] Recovering ${pending.length} pending cleanup(s)...`);
    for (const row of pending) {
      const snapshots = row.session_snapshots || [];
      await runFailureCleanup(row.id, snapshots, [], new Date(0));
    }
  } catch (err) {
    console.warn(`[task-worker] Pending cleanup recovery failed:`, err.message);
  }
}

// ── Per-agent execution locks ─────────────────────────────────────────────────

async function acquireAgentLocks(agentIds, referenceId) {
  const acquired = [];
  const failed = [];
  for (const agentId of agentIds) {
    try {
      const [row] = await sql`
        INSERT INTO agent_execution_locks (agent_id, occurrence_id, locked_at)
        VALUES (${agentId}, ${referenceId}, now())
        ON CONFLICT DO NOTHING
        RETURNING agent_id
      `;
      if (row) {
        acquired.push(agentId);
      } else {
        failed.push(agentId);
      }
    } catch (err) {
      console.warn(`[task-worker] Lock acquire error for agent ${agentId}:`, err.message);
      failed.push(agentId);
    }
  }
  return { acquired, failed };
}

async function releaseAgentLocks(agentIds) {
  for (const agentId of agentIds) {
    try {
      await sql`DELETE FROM agent_execution_locks WHERE agent_id = ${agentId}`;
    } catch (err) {
      console.warn(`[task-worker] Lock release error for agent ${agentId}:`, err.message);
    }
  }
}

// ── Stale ticket recovery ─────────────────────────────────────────────────────

async function recoverStaleTickets() {
  try {
    const stale = await sql`
      UPDATE tickets
      SET execution_state = 'needs_retry', updated_at = now()
      WHERE execution_state = 'executing'
        AND updated_at < now() - interval '15 minutes'
      RETURNING id, title, assigned_agent_id, telegram_chat_id
    `;
    if (stale.length > 0) {
      console.log(`[task-worker] Recovered ${stale.length} stale ticket(s) → needs_retry`);
      for (const row of stale) {
        await writeActivity(row.id, "Stale recovery", "Ticket stuck executing >15min — set to needs_retry", "warning");
        const chatId = row.telegram_chat_id ?? await getRecentChatId(await workspaceId(), row.assigned_agent_id || "main");
        await sendTelegramMessage(row, `⚠️ Stale ticket recovered: "${row.title}"\n\nStuck executing >15min. Status set to needs_retry.\nRetry manually in Mission Control.`, chatId);
      }
    }

    // Also recover stale agent execution locks (>20 minutes old)
    try {
      const staleLocks = await sql`
        DELETE FROM agent_execution_locks
        WHERE locked_at < now() - interval '20 minutes'
        RETURNING agent_id
      `;
      if (staleLocks.length > 0) {
        console.log(`[task-worker] Recovered ${staleLocks.length} stale agent execution lock(s): ${staleLocks.map(r => r.agent_id).join(", ")}`);
      }
    } catch (err) {
      console.warn("[task-worker] Stale agent lock recovery failed:", err.message);
    }
  } catch (err) {
    console.warn("[task-worker] Stale ticket recovery failed:", err.message);
  }
}

async function getRecentChatId(wid, agentId) {
  const home = await getOpenclawHome();
  // Scan agent session files for a known Telegram delivery context
  const searchPaths = [
    `${home}/agents/${agentId}/sessions/sessions.json`,
    `${home}/agents/main/sessions/sessions.json`,
  ];
  for (const sessionsPath of searchPaths) {
    try {
      const raw = await fs.readFile(sessionsPath, "utf8");
      const data = JSON.parse(raw);
      for (const [, val] of Object.entries(data)) {
        if (val?.deliveryContext?.channel === "telegram" && val?.deliveryContext?.to) {
          return String(val.deliveryContext.to).replace(/^telegram:/, "");
        }
      }
    } catch {}
  }
  return null;
}
function buildTicketPrompt(ticket, subtaskRows, commentRows, processRows, suffix) {
  const contextParts = [];
  if (ticket.description) contextParts.push(ticket.description);
  if (ticket.priority) contextParts.push(`Priority: ${ticket.priority}`);
  if (ticket.due_date) contextParts.push(`Due: ${new Date(ticket.due_date).toISOString().split("T")[0]}`);
  if (Array.isArray(ticket.tags) && ticket.tags.length > 0) contextParts.push(`Tags: ${ticket.tags.join(", ")}`);
  if (subtaskRows.length > 0) contextParts.push(`Subtasks: ${subtaskRows.filter(s => s.completed).length}/${subtaskRows.length}`);
  if (commentRows.length > 0) {
    contextParts.push("Notes:");
    contextParts.push(commentRows.map(c => `- [${c.author_name}] ${new Date(c.created_at).toISOString().split("T")[0]}: ${c.content}`).join("\n"));
  }

  const instructions = [];
  processRows.forEach((p) => {
    (p.steps || []).forEach((s) => {
      instructions.push({
        order: Number(s.step_order),
        title: s.step_title || p.process_name,
        instruction: s.instruction,
      });
    });
  });

  const request = [ticket.plan_text ? `Plan:\n${ticket.plan_text}` : null, suffix].filter(Boolean).join("\n\n");

  return renderUnifiedTaskMessage({
    title: ticket.title,
    context: contextParts.join("\n"),
    instructions,
    request,
  });
}
async function workspaceId() { const rows = await sql`select id from workspaces order by created_at asc limit 1`; return rows[0]?.id ?? null; }
async function getSettings() { const rows = await sql`select enabled, poll_interval_seconds, max_concurrency from worker_settings where id=1 limit 1`; latestSettings = normalizeWorkerSettings({ enabled: rows[0]?.enabled ?? true, pollIntervalSeconds: rows[0]?.poll_interval_seconds ?? 20, maxConcurrency: rows[0]?.max_concurrency ?? 3 }); return latestSettings; }
async function getColumnIdsByTitle(boardId, names) { const rows = await sql`select id, lower(trim(title)) as title from columns where board_id = ${boardId}::uuid`; const wanted = new Set(names.map((x)=>x.toLowerCase())); return rows.filter((r)=>wanted.has(r.title)).map((r)=>r.id); }
async function writeActivity(ticketId, event, details, level = "info") { const result = await sql`insert into ticket_activity (ticket_id, source, event, details, level) values (${ticketId}::uuid, 'Worker', ${event}, ${details}, ${level}) returning id::text`; const insertedId = result[0]?.id; if (insertedId) await sql`select pg_notify('ticket_activity', ${insertedId})`; }
async function sendTelegramMessage(ticket, text, chatId = null) { const targetId = chatId ?? ticket.telegram_chat_id; if (!targetId) return; try { await execFileAsync("openclaw", ["message","send","--channel","telegram","--target",String(targetId),"--message",text,"--json"], { timeout: 60000, env: process.env }); } catch (e) { console.warn("Failed to send Telegram message", e.message); } }
/**
 * Detect file paths in agent response text and auto-attach them to the ticket.
 * Matches patterns like:
 *   📄 /path/to/file.md
 *   /home/.../file.txt — description
 *   Created file: /path/to/file.pdf
 *   The file already exists from just a moment ago: \n📄 /path/to/file
 */
const FILE_PATH_REGEX = /(?:📄\s*)?(\/(home|storage|tmp|var|etc)[^\s\n,)}\]"'`]+\.[a-zA-Z0-9]{1,10})/g;
const ATTACH_EXTENSIONS = new Set([
  ".md", ".txt", ".json", ".csv", ".pdf", ".html", ".htm", ".xml",
  ".yaml", ".yml", ".toml", ".png", ".jpg", ".jpeg", ".gif", ".webp",
  ".svg", ".mp3", ".wav", ".mp4", ".webm", ".zip", ".tar", ".gz",
  ".log", ".sh", ".ts", ".tsx", ".js", ".jsx", ".css", ".py", ".rs",
  ".go", ".sql", ".env",
]);

async function extractAndAttachFiles(ticketId, responseText) {
  if (!responseText) return [];
  const matches = [...responseText.matchAll(FILE_PATH_REGEX)];
  const seen = new Set();
  const attached = [];

  for (const match of matches) {
    const filePath = match[1];
    if (seen.has(filePath)) continue;
    seen.add(filePath);

    const ext = path.extname(filePath).toLowerCase();
    if (!ATTACH_EXTENSIONS.has(ext)) continue;

    try {
      const resolved = path.resolve(filePath);
      const stat = fsSync.statSync(resolved);
      if (!stat.isFile() || stat.size > 50 * 1024 * 1024) continue; // Skip dirs and files >50MB

      const fileName = path.basename(resolved);
      const mimeMap = {
        ".md": "text/markdown", ".txt": "text/plain", ".json": "application/json",
        ".csv": "text/csv", ".pdf": "application/pdf", ".html": "text/html",
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
        ".zip": "application/zip", ".tar": "application/x-tar", ".gz": "application/gzip",
        ".log": "text/plain", ".sh": "text/x-shellscript",
      };
      const mimeType = mimeMap[ext] || "application/octet-stream";
      const url = `/api/files?path=${encodeURIComponent(resolved)}`;

      await sql`
        insert into ticket_attachments (ticket_id, name, url, mime_type, size, path)
        values (${ticketId}::uuid, ${fileName}, ${url}, ${mimeType}, ${stat.size}, ${resolved})
      `;
      attached.push({ name: fileName, path: resolved, size: stat.size });
    } catch {
      // Skip files we can't access
    }
  }

  if (attached.length > 0) {
    await sql`update tickets set attachments_count = coalesce((select count(*) from ticket_attachments where ticket_id=${ticketId}::uuid), 0), updated_at=now() where id=${ticketId}::uuid`;
    const names = attached.map(a => a.name).join(", ");
    await writeActivity(ticketId, "Files attached", `Auto-attached ${attached.length} file(s): ${names}`, "success");
  }

  return attached;
}


async function generatePlan(ticket, wid) { await sql`update tickets set execution_state='planning', updated_at=now() where id=${ticket.id}::uuid`; await writeActivity(ticket.id, "Planning", "Generating plan for approval.", "info"); const [subtaskRows, commentRows, processRows] = await Promise.all([
    sql`select title, completed from ticket_subtasks where ticket_id = ${ticket.id}::uuid order by position asc, created_at asc`,
    sql`select content, author_name, created_at from ticket_comments where ticket_id = ${ticket.id}::uuid order by created_at asc limit 10`,
    ticket.process_version_ids?.length ? sql`
      select p.name as process_name, p.description as process_description,
             ps.step_order, ps.title as step_title, ps.instruction
      from process_versions pv
      join processes p on p.id = pv.process_id
      join process_steps ps on ps.process_version_id = pv.id
      where pv.id = ANY(${ticket.process_version_ids}::uuid[])
      order by p.name, ps.step_order asc
    ` : [],
  ]);
const grouped = [];
for (const r of processRows) {
  let g = grouped.find(g => g.process_name === r.process_name);
  if (!g) { g = { process_name: r.process_name, process_description: r.process_description, steps: [] }; grouped.push(g); }
  g.steps.push(r);
}
const prompt = buildTicketPrompt(ticket, subtaskRows, commentRows, grouped, "Create an execution plan only.\nDo not execute anything.\nReturn a concise numbered plan plus acceptance criteria."); let agentId = "planner"; const args = ["agent", "--agent", agentId, "--message", prompt, "--json"]; const chatId = ticket.telegram_chat_id ?? await getRecentChatId(wid, agentId); try { if ((await sql`select id from agents where workspace_id = ${wid} and openclaw_agent_id = ${agentId} limit 1`).length === 0) args[2] = "main"; const { stdout } = await execFileAsync("openclaw", args, { timeout: 5 * 60 * 1000, env: process.env }); const result = JSON.parse(stdout); const payloads = result?.payloads ?? []; const planText = payloads.map(p => p.text ?? '').join('\n').trim() || result?.text || result?.reply || JSON.stringify(result); await sql`insert into ticket_activity (ticket_id, source, event, details, level) values (${ticket.id}::uuid, 'planner', 'Plan generated', ${planText}, 'info')`; await sql`update tickets set plan_text=${planText}, approval_state='pending', execution_state='awaiting_approval', plan_generated_at=now(), updated_at=now() where id=${ticket.id}::uuid`; await writeActivity(ticket.id, "Plan ready", "Waiting for user approval.", "info"); await sendTelegramMessage(ticket, `Plan ready for "${ticket.title}"\n\n${planText}\n\nApprove in Mission Control to start execution.`, chatId); } catch (error) { await writeActivity(ticket.id, "Planning failed", error.message, "error"); await sendTelegramMessage(ticket, `❌ Planning failed for "${ticket.title}": ${error.message}`, chatId); await sql`update tickets set execution_state='failed', updated_at=now() where id=${ticket.id}::uuid`; } }
async function markNeedsRetry(ticketId, ticket) {
  await sql`update tickets set execution_state='needs_retry', updated_at=now() where id=${ticketId}::uuid`;
  await writeActivity(ticketId, "Needs retry", "All retries exhausted — needs manual retry.", "warning");
  const chatId = ticket.telegram_chat_id ?? await getRecentChatId(await workspaceId(), ticket.assigned_agent_id || 'main');
  await sendTelegramMessage(ticket, `⚠️ Ticket "${ticket.title}" needs manual retry (all retries exhausted)`, chatId);
}
async function executeTicket(ticket, boardId, wid) {
  const ticketId = ticket.id;
  let agentId = ticket.assigned_agent_id;
  const agentRows = await sql`select id from agents where workspace_id = ${wid} and openclaw_agent_id = ${agentId} limit 1`;
  if (agentRows.length === 0) agentId = 'main';
  const chatIdForDelivery = ticket.telegram_chat_id ?? await getRecentChatId(wid, agentId);

  // Execution window check (use DB time to avoid clock skew)
  const scheduledFor = ticket.scheduled_for ? new Date(ticket.scheduled_for) : null;
  const windowMinutes = ticket.execution_window_minutes || 60;
  if (scheduledFor) {
    const [{ now: dbNow }] = await sql`SELECT now() as now`;
    const diffMinutes = (new Date(dbNow).getTime() - scheduledFor.getTime()) / 60000;
    if (diffMinutes > windowMinutes) {
      await sql`UPDATE tickets SET execution_state = 'needs_retry', updated_at = now() WHERE id = ${ticketId}::uuid`;
      await writeActivity(ticketId, "Missed window", `Missed execution window (${windowMinutes}min) — needs manual retry`, "warning");
      await sendTelegramMessage(ticket, `⏰ Ticket "${ticket.title}" missed ${windowMinutes}min execution window — retry manually in Mission Control`, chatIdForDelivery);
      return;
    }
  }

  // ── Per-agent execution lock ──────────────────────────────────────────
  const uniqueAgentIds = [agentId];
  const { acquired: lockedAgents, failed: lockFailed } = await acquireAgentLocks(uniqueAgentIds, ticketId);
  if (lockFailed.length > 0) {
    await releaseAgentLocks(lockedAgents);
    console.log(`[task-worker] Agent lock contention for ticket ${ticketId} (agents: ${lockFailed.join(", ")}), re-queuing with 30s delay`);
    const requeue = new Queue("tickets", { connection: redisConnection });
    await requeue.add("ticket-" + ticketId, { ticketId }, { delay: 30000 });
    await requeue.close();
    return;
  }

  // Postgres claim lock
  const [claimed] = await sql`UPDATE tickets SET execution_state = 'executing', updated_at = now() WHERE id = ${ticketId}::uuid AND execution_state IN ('queued', 'ready_to_execute', 'picked_up') RETURNING id`;
  if (!claimed) {
    await releaseAgentLocks(lockedAgents);
    console.log(`[task-worker] Ticket ${ticketId} already claimed, skipping`);
    return;
  }

  // ── Session snapshot (pre-execution) ──────────────────────────────────
  const sessionSnapshots = [];
  const snap = await getAgentSessionSnapshot(agentId);
  if (snap) sessionSnapshots.push(snap);
  // Save snapshots to ticket for crash recovery
  await sql`UPDATE tickets SET session_snapshots = ${sql.json(sessionSnapshots)} WHERE id = ${ticketId}::uuid`;

  const attemptStartTime = new Date();

  // ── 5-minute long-running alert ───────────────────────────────────────
  const alertTimer = setTimeout(async () => {
    const msg = `⏱️ Long-running ticket alert\n\nTicket: "${ticket.title}"\nID: ${ticketId}\nAgent: ${agentId}\nRunning for: 5+ minutes\nStarted: ${attemptStartTime.toISOString()}\n\nCheck Mission Control for details.`;
    await sendTelegramMessage(ticket, msg, chatIdForDelivery);
    console.warn(`[task-worker] Long-running alert sent for ticket "${ticket.title}" (${ticketId})`);
  }, 5 * 60 * 1000);

  // Track all detected file paths for cleanup
  const allDetectedFilePaths = [];

  try {
    await writeActivity(ticketId, "Picked up", "Worker picked up ticket.", "info");
    await sendTelegramMessage(ticket, `🚀 Starting execution of "${ticket.title}"`, chatIdForDelivery);

    const [subtaskRows, commentRows, processRows] = await Promise.all([
      sql`select title, completed from ticket_subtasks where ticket_id = ${ticketId}::uuid order by position asc, created_at asc`,
      sql`select content, author_name, created_at from ticket_comments where ticket_id = ${ticketId}::uuid order by created_at asc limit 20`,
      ticket.process_version_ids?.length ? sql`
        select p.name as process_name, p.description as process_description,
               ps.step_order, ps.title as step_title, ps.instruction
        from process_versions pv
        join processes p on p.id = pv.process_id
        join process_steps ps on ps.process_version_id = pv.id
        where pv.id = ANY(${ticket.process_version_ids}::uuid[])
        order by p.name, ps.step_order asc
      ` : [],
    ]);

    const grouped = [];
    for (const r of processRows) {
      let g = grouped.find(g => g.process_name === r.process_name);
      if (!g) { g = { process_name: r.process_name, process_description: r.process_description, steps: [] }; grouped.push(g); }
      g.steps.push(r);
    }

    const prompt = buildTicketPrompt(ticket, subtaskRows, commentRows, grouped, 'Execute the above ticket. Report progress via activity tools and mark completion when done.');
    const runId = `${ticketId}-${Date.now()}`;
    const artifactDir = getRunArtifactDir({ kind: "ticket", entityId: ticketId, runId });
    await writeRunArtifacts({
      dir: artifactDir,
      requestText: prompt,
      meta: {
        ticketId,
        boardId,
        agentId,
        fallbackModel: ticket.fallback_model || null,
        processVersionIds: ticket.process_version_ids || [],
        createdAt: new Date().toISOString(),
      },
    });

    const args = ["agent", "--agent", agentId, "--message", prompt, "--json"];

    let result;
    try {
      const { stdout } = await execFileAsync("openclaw", args, { timeout: 10 * 60 * 1000, env: process.env });
      const parsed = JSON.parse(stdout);
      const inner = parsed?.result ?? parsed;
      const rawPayloads = Array.isArray(inner?.payloads) ? inner.payloads : [];
      result = { success: true, result: parsed, _rawPayloads: rawPayloads };
    } catch (error) {
      result = { success: false, error: error.message };
    }

    // ── Auto-retry (configurable, default 1) ────────────────────────────
    const [settingsRow] = await sql`SELECT max_retries FROM worker_settings WHERE id = 1 LIMIT 1`;
    const maxRetries = Number(settingsRow?.max_retries ?? 1);
    let retryCount = 0;
    while (!result.success && retryCount < maxRetries) {
      retryCount++;
      console.log(`[task-worker] Auto-retry ${retryCount}/${maxRetries} for ${ticketId}...`);
      await writeActivity(ticketId, "Retry", `Attempt ${retryCount + 1} — retrying immediately...`, "warning");
      try {
        const { stdout } = await execFileAsync("openclaw", args, { timeout: 10 * 60 * 1000, env: process.env });
        const parsed = JSON.parse(stdout);
        const inner = parsed?.result ?? parsed;
        const rawPayloads = Array.isArray(inner?.payloads) ? inner.payloads : [];
        result = { success: true, result: parsed, _rawPayloads: rawPayloads };
      } catch (retryErr) {
        result = { success: false, error: retryErr.message };
      }
    }

    // Fallback model retry if still failing and event has one set
    if (!result.success && ticket.fallback_model) {
      console.log(`[task-worker] All retries failed for ${ticketId}, trying fallback model: ${ticket.fallback_model}`);
      await writeActivity(ticketId, "Fallback retry", `Retrying with fallback model: ${ticket.fallback_model}`, "warning");
      const fallbackArgs = ["agent", "--agent", agentId, "--model", ticket.fallback_model, "--message", prompt, "--json"];
      try {
        const { stdout } = await execFileAsync("openclaw", fallbackArgs, { timeout: 10 * 60 * 1000, env: process.env });
        const parsed = JSON.parse(stdout);
        const inner = parsed?.result ?? parsed;
        const rawPayloads = Array.isArray(inner?.payloads) ? inner.payloads : [];
        result = { success: true, result: parsed, _rawPayloads: rawPayloads };
        await writeActivity(ticketId, "Fallback model used", `Switched to ${ticket.fallback_model} after retry failures.`, "warning");
      } catch (fbError) {
        result = { success: false, error: fbError.message };
      }
    }

    if (result.success) {
      const payloads = result._rawPayloads;
      const responseText = payloads.map(p => p.text ?? '').join('\n').trim();
      if (responseText) await sql`insert into ticket_activity (ticket_id, source, event, details, level) values (${ticketId}::uuid, ${agentId}, 'Agent response', ${responseText}, 'info')`;

      // Collect detected file paths
      const attachedFiles = await extractAndAttachFiles(ticketId, responseText);
      await writeRunArtifacts({
        dir: artifactDir,
        responseText,
        meta: {
          ticketId,
          success: true,
          attachedFilesCount: attachedFiles.length,
          finishedAt: new Date().toISOString(),
        },
      });

      if (attachedFiles.length > 0) {
        const filesDir = path.resolve(artifactDir, "files");
        await ensureArtifactDir(filesDir);
        for (const f of attachedFiles) {
          try {
            const sourcePath = String(f.path || "");
            if (!sourcePath) continue;
            const dest = path.resolve(filesDir, path.basename(sourcePath));
            await fs.copyFile(sourcePath, dest);
          } catch {}
        }
      }

      if (responseText) {
        const pathMatches = [...responseText.matchAll(FILE_PATH_REGEX)];
        for (const m of pathMatches) allDetectedFilePaths.push(m[1]);
      }

      if (chatIdForDelivery && responseText) await sendTelegramMessage(ticket, responseText, chatIdForDelivery);
      const completedIds = await getColumnIdsByTitle(boardId, ["completed", "done"]);
      const completedColumnId = completedIds[0] ?? null;
      if (completedColumnId) await sql`update tickets set execution_state='done', column_id=${completedColumnId}::uuid, updated_at=now() where id=${ticketId}::uuid`;
      else await sql`update tickets set execution_state='done', updated_at=now() where id=${ticketId}::uuid`;
      await writeActivity(ticketId, "Completed", `Agent "${agentId}" completed successfully.`, "success");
    } else {
      await writeRunArtifacts({
        dir: artifactDir,
        responseText: `Error: ${result.error || "unknown"}`,
        meta: {
          ticketId,
          success: false,
          error: result.error || "unknown",
          finishedAt: new Date().toISOString(),
        },
      });
      await writeActivity(ticketId, "Failed", `Agent "${agentId}" failed: ${result.error}`, "error");

      // Run 3-phase cleanup before marking as needs_retry
      console.log(`[task-worker] Running failure cleanup for ticket ${ticketId}...`);
      try {
        await runFailureCleanup(ticketId, sessionSnapshots, [...new Set(allDetectedFilePaths)], attemptStartTime);
      } catch (cleanupErr) {
        console.error(`[task-worker] Cleanup failed for ticket ${ticketId}:`, cleanupErr.message);
      }

      await markNeedsRetry(ticketId, ticket);
      if (chatIdForDelivery) await sendTelegramMessage(ticket, `⚠️ Ticket "${ticket.title}" needs manual retry (all retries exhausted)`, chatIdForDelivery);
    }
  } catch (fatalError) {
    // Fatal error — run cleanup + mark needs_retry
    console.error(`[task-worker] Fatal error executing ticket ${ticketId}:`, fatalError.message);
    try {
      await runFailureCleanup(ticketId, sessionSnapshots, [...new Set(allDetectedFilePaths)], attemptStartTime);
    } catch (cleanupErr) {
      console.error(`[task-worker] Cleanup failed for ticket ${ticketId}:`, cleanupErr.message);
    }
    await writeActivity(ticketId, "Fatal error", String(fatalError.message || fatalError), "error");
    await markNeedsRetry(ticketId, ticket);
  } finally {
    // Always release locks and clear timers
    clearTimeout(alertTimer);
    await releaseAgentLocks(lockedAgents);
  }
}
async function handleTicket(ticket, boardId, wid) { try { if (ticket.execution_mode === 'planned' && ticket.approval_state !== 'approved') { if (!ticket.plan_text) await generatePlan(ticket, wid); else await sql`update tickets set execution_state='awaiting_approval', updated_at=now() where id=${ticket.id}::uuid and execution_state != 'awaiting_approval'`; return; } await executeTicket(ticket, boardId, wid); } catch (error) { await writeActivity(ticket.id, "Worker error", String(error.message || error), "error"); await markNeedsRetry(ticket.id, ticket); } }
async function promoteAutoApprove(wid, queueName) { const rows = await sql`select id, board_id from tickets where workspace_id = ${wid}::uuid and queue_name = ${queueName} and auto_approve = true and (execution_state = 'open' or execution_state = 'pending') and (scheduled_for is null or scheduled_for <= now()) limit 100`; for (const row of rows) { const inProgressIds = await getColumnIdsByTitle(row.board_id, ["in progress", "doing"]); const toColumnId = inProgressIds[0]; if (!toColumnId) continue; await sql`update tickets set column_id=${toColumnId}::uuid, execution_state='queued', approval_state='approved', approved_by='auto', approved_at=now(), updated_at=now() where id=${row.id}::uuid`; await writeActivity(row.id, "Auto approved", "Auto-approved and queued by worker.", "info"); await enqueueTicket(row.id, { source: "auto-approve" }); } }
async function processJob(job) {
  const wid = await workspaceId();
  if (!wid) return { skipped: true };

  const settings = await getSettings();
  if (!settings.enabled) return { skipped: true };

  await promoteAutoApprove(wid, myQueue);

  const ticketId = String(job.data?.ticketId || job.id?.replace(/^ticket-/, "") || "");
  if (!ticketId) return { skipped: true };

  const rows = await sql`select t.*, b.id as board_id from tickets t join boards b on b.id = t.board_id where t.id=${ticketId}::uuid limit 1`;
  const ticket = rows[0];
  if (!ticket) return { skipped: true };

  if (["executing", "done"].includes(ticket.execution_state)) return { skipped: true };
  if (!["queued", "ready_to_execute", "picked_up", "planning", "awaiting_approval"].includes(ticket.execution_state)) return { skipped: true };

  if (ticket.scheduled_for) {
    const now = Date.now();
    const scheduledAt = new Date(ticket.scheduled_for).getTime();
    if (Number.isFinite(scheduledAt) && scheduledAt > now) {
      const delay = Math.max(5000, scheduledAt - now);
      const requeue = new Queue("tickets", { connection: redisConnection });
      await requeue.add(`ticket-${ticketId}-scheduled`, { ticketId }, { delay, removeOnComplete: true, removeOnFail: true });
      await requeue.close();
      return { skipped: true, reason: "scheduled_future", delayMs: delay };
    }
  }

  await handleTicket(ticket, ticket.board_id, wid);
  return { ok: true };
}
async function setupWorker() { ticketWorker = new Worker("tickets", async (job) => { try { return await processJob(job); } catch (error) { console.error("[task-worker] job failed", error); throw error; } }, { connection: redisConnection, concurrency: Math.max(1, Number(process.env.TICKET_WORKER_CONCURRENCY || latestSettings.maxConcurrency || 3)), stalledInterval: 30000 }); ticketWorker.on("stalled", (jobId) => console.warn("[task-worker] stalled job", jobId)); ticketWorker.on("completed", (job) => console.log(`[task-worker] completed ${job.id}`)); ticketWorker.on("failed", (job, err) => console.error(`[task-worker] failed ${job?.id}`, err?.message || err)); }
async function setupNotifyBridge() { await sql.listen('ticket_ready', async (payload) => { if (shuttingDown) return; const ticketId = String(payload || '').trim(); if (ticketId) await enqueueTicket(ticketId, { source: 'notify' }); }); }
async function handleTick() { try { const settings = await getSettings(); const out = { picked: 0, reason: "bullmq" }; await sql`update worker_settings set last_tick_at=now(), updated_at=now() where id=1`; await sql`select pg_notify('worker_tick', ${JSON.stringify({ picked: out.picked, reason: out.reason, interval: settings.pollIntervalSeconds, concurrency: settings.maxConcurrency, at: new Date().toISOString() })})`; } catch (error) { console.error("[task-worker] tick failed", error); } }
async function twWriteHeartbeat(status = "running", lastError = null) {
  try {
    await sql`
      INSERT INTO service_health (name, status, pid, last_heartbeat_at, last_error, started_at, updated_at)
      VALUES (${TW_SERVICE_NAME}, ${status}, ${process.pid}, now(), ${lastError}, now(), now())
      ON CONFLICT (name) DO UPDATE SET
        status = ${status},
        pid = ${process.pid},
        last_heartbeat_at = now(),
        last_error = COALESCE(${lastError}, service_health.last_error),
        updated_at = now()
    `;
  } catch (err) {
    console.warn("[task-worker] Heartbeat write failed:", err.message);
  }
}
let heartbeatTimer = null;
let staleRecoveryTimer = null;
async function main() {
  await getOpenclawConfig();
  await ensureCleanupColumns();
  await recoverPendingCleanups();
  await recoverStaleTickets();
  await setupWorker();
  await setupNotifyBridge();
  await handleTick();
  promoteTimer = setInterval(async () => { void promoteAutoApprove(await workspaceId(), myQueue); }, 60000);
  settingsTimer = setInterval(() => { void getSettings(); }, 30000);
  staleRecoveryTimer = setInterval(() => { void recoverStaleTickets(); }, 5 * 60 * 1000);
  await twWriteHeartbeat("running");
  heartbeatTimer = setInterval(() => twWriteHeartbeat("running"), 30000);
  console.log("[task-worker] started (bullmq)");
  await new Promise(() => {});
}
async function shutdown() { if (shuttingDown) return; shuttingDown = true; if (promoteTimer) clearInterval(promoteTimer); if (settingsTimer) clearInterval(settingsTimer); if (heartbeatTimer) clearInterval(heartbeatTimer); if (staleRecoveryTimer) clearInterval(staleRecoveryTimer); await twWriteHeartbeat("stopped").catch(() => {}); if (ticketWorker) await ticketWorker.close(); await sql.end({ timeout: 5 }); process.exit(0); }
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown); await main();