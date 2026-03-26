#!/usr/bin/env node
import postgres from "postgres";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Worker } from "bullmq";
import { normalizeWorkerSettings, capacityLeft } from "../lib/tasks/worker-core.mjs";
import { enqueueTicket } from "../lib/tasks/ticket-queue.mjs";

const execFileAsync = promisify(execFile);

const connectionString = process.env.DATABASE_URL?.trim() || process.env.OPENCLAW_DATABASE_URL?.trim();
if (!connectionString) {
  console.error("[task-worker] Missing DATABASE_URL or OPENCLAW_DATABASE_URL");
  process.exit(1);
}

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
let notifyListenerActive = false;
const myQueue = process.env.WORKER_QUEUE || "default";
const MAX_RETRIES = 3;
const BACKOFF_SECONDS = [30, 120, 480];
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
      for (const [key, val] of Object.entries(data)) {
        if (val?.deliveryContext?.channel === "telegram" && val?.deliveryContext?.to) {
          return String(val.deliveryContext.to).replace(/^telegram:/, "");
        }
      }
    } catch {}
  }
  return null;
}
function buildTicketPrompt(ticket, subtaskRows, commentRows, processRows, suffix) {
  const processSection = processRows.length > 0
    ? [`### Processes`, ``, ...processRows.map((p, pi) => [
        `${pi + 1}. **${p.process_name}**${p.process_description ? `: ${p.process_description}` : ""}`,
        ``,
        ...(p.steps || []).map((s, si) => `  ${pi + 1}.${si + 1}. ${s.step_title}: ${s.instruction}`),
        ``,
      ])]
    : [];

  const parts = [
    `## Ticket: ${ticket.title}`,
    ``,
    ticket.description && `### Description`,
    ticket.description || null,
    ``,
    subtaskRows.length > 0 && `### Subtasks`,
    subtaskRows.length > 0 ? subtaskRows.map((s, i) => `  ${i + 1}. [${s.completed ? 'x' : ' '}] ${s.title}`).join('\n') : null,
    ``,
    commentRows.length > 0 && `### Notes / Comments`,
    commentRows.length > 0 ? commentRows.map(c => `[${c.author_name}] ${new Date(c.created_at).toISOString().split('T')[0]}: ${c.content}`).join('\n') : null,
    ``,
    ticket.plan_text && `### Plan`,
    ticket.plan_text || null,
    ``,
    `### Metadata`,
    ticket.priority && `Priority: ${ticket.priority}`,
    ticket.due_date && `Due: ${new Date(ticket.due_date).toISOString().split('T')[0]}`,
    Array.isArray(ticket.tags) && ticket.tags.length > 0 && `Tags: ${ticket.tags.join(', ')}`,
    subtaskRows.length > 0 && `Subtask progress: ${subtaskRows.filter(s => s.completed).length}/${subtaskRows.length}`,
    ticket.checklist_total > 0 && ticket.checklist_total !== subtaskRows.length && `Legacy checklist progress: ${ticket.checklist_done}/${ticket.checklist_total}`,
    ``,
    ...processSection,
    ``,
    suffix,
  ];
  return parts.filter(Boolean).join('\n');
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

async function getRetryCount(ticketId) { const rows = await sql`select count(*)::int as n from ticket_activity where ticket_id = ${ticketId}::uuid and event = 'Failed' and source = 'Worker'`; return Number(rows[0]?.n ?? 0); }
async function scheduleRetry(ticketId, retryCount) { const backoffSec = BACKOFF_SECONDS[Math.min(retryCount, BACKOFF_SECONDS.length - 1)]; const scheduledFor = new Date(Date.now() + backoffSec * 1000).toISOString(); await sql`update tickets set execution_state='queued', scheduled_for=${scheduledFor}, updated_at=now() where id=${ticketId}::uuid`; await writeActivity(ticketId, "Retry scheduled", `Retry ${retryCount + 1}/${MAX_RETRIES} scheduled in ${backoffSec}s.`, "warning"); }
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
async function handleFailureWithRetry(ticketId, ticket) { const retryCount = await getRetryCount(ticketId); if (retryCount < MAX_RETRIES) await scheduleRetry(ticketId, retryCount); else await sql`update tickets set execution_state='failed', updated_at=now() where id=${ticketId}::uuid`; }
async function executeTicket(ticket, boardId, wid) { const ticketId=ticket.id; let agentId=ticket.assigned_agent_id; const agentRows = await sql`select id from agents where workspace_id = ${wid} and openclaw_agent_id = ${agentId} limit 1`; if (agentRows.length===0) agentId='main'; const chatIdForDelivery = ticket.telegram_chat_id ?? await getRecentChatId(wid, agentId); const latestRows = await sql`select execution_state, column_id from tickets where id=${ticketId}::uuid limit 1`; const latest = latestRows[0]; if (!latest || ['done','executing'].includes(latest.execution_state)) return; await sql`update tickets set execution_state='executing', updated_at=now() where id=${ticketId}::uuid and execution_state not in ('done','executing')`; await writeActivity(ticketId, "Picked up", "Worker picked up ticket.", "info"); await sendTelegramMessage(ticket, `🚀 Starting execution of "${ticket.title}"`, chatIdForDelivery); const [subtaskRows, commentRows, processRows] = await Promise.all([
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
const prompt = buildTicketPrompt(ticket, subtaskRows, commentRows, grouped, 'Execute the above ticket. Report progress via activity tools and mark completion when done.'); const args = ["agent", "--agent", agentId, "--message", prompt, "--json"]; let result; try { const { stdout } = await execFileAsync("openclaw", args, { timeout: 10 * 60 * 1000, env: process.env }); const parsed = JSON.parse(stdout); const inner = parsed?.result ?? parsed; const rawPayloads = Array.isArray(inner?.payloads) ? inner.payloads : []; result = { success: true, result: parsed, _rawPayloads: rawPayloads }; } catch (error) { result = { success: false, error: error.message }; } if (result.success) { const payloads = result._rawPayloads; const responseText = payloads.map(p => p.text ?? '').join('\n').trim(); if (responseText) await sql`insert into ticket_activity (ticket_id, source, event, details, level) values (${ticketId}::uuid, ${agentId}, 'Agent response', ${responseText}, 'info')`; await extractAndAttachFiles(ticketId, responseText); if (chatIdForDelivery && responseText) await sendTelegramMessage(ticket, responseText, chatIdForDelivery); const completedIds = await getColumnIdsByTitle(boardId, ["completed", "done"]); const completedColumnId = completedIds[0] ?? null; if (completedColumnId) await sql`update tickets set execution_state='done', column_id=${completedColumnId}::uuid, updated_at=now() where id=${ticketId}::uuid`; else await sql`update tickets set execution_state='done', updated_at=now() where id=${ticketId}::uuid`; await writeActivity(ticketId, "Completed", `Agent "${agentId}" completed successfully.`, "success"); } else { await writeActivity(ticketId, "Failed", `Agent "${agentId}" failed: ${result.error}`, "error"); await handleFailureWithRetry(ticketId, ticket); const retryCount = await getRetryCount(ticketId); if (chatIdForDelivery) await sendTelegramMessage(ticket, retryCount >= MAX_RETRIES ? `❌ Ticket "${ticket.title}" failed after ${MAX_RETRIES} retries: ${result.error}` : `⚠️ Ticket "${ticket.title}" failed, retrying in ${BACKOFF_SECONDS[Math.min(retryCount - 1, BACKOFF_SECONDS.length - 1)]}s (attempt ${retryCount}/${MAX_RETRIES})`, chatIdForDelivery); } }
async function handleTicket(ticket, boardId, wid) { try { if (ticket.execution_mode === 'planned' && ticket.approval_state !== 'approved') { if (!ticket.plan_text) await generatePlan(ticket, wid); else await sql`update tickets set execution_state='awaiting_approval', updated_at=now() where id=${ticket.id}::uuid and execution_state != 'awaiting_approval'`; return; } await executeTicket(ticket, boardId, wid); } catch (error) { await writeActivity(ticket.id, "Worker error", String(error.message || error), "error"); await handleFailureWithRetry(ticket.id, ticket); } }
async function promoteAutoApprove(wid, queueName) { const rows = await sql`select id, board_id from tickets where workspace_id = ${wid}::uuid and queue_name = ${queueName} and auto_approve = true and (execution_state = 'open' or execution_state = 'pending') and (scheduled_for is null or scheduled_for <= now()) limit 100`; for (const row of rows) { const inProgressIds = await getColumnIdsByTitle(row.board_id, ["in progress", "doing"]); const toColumnId = inProgressIds[0]; if (!toColumnId) continue; await sql`update tickets set column_id=${toColumnId}::uuid, execution_state='queued', approval_state='approved', approved_by='auto', approved_at=now(), updated_at=now() where id=${row.id}::uuid`; await writeActivity(row.id, "Auto approved", "Auto-approved and queued by worker.", "info"); await enqueueTicket(row.id, { source: "auto-approve" }); } }
async function processJob(job) { const wid = await workspaceId(); if (!wid) return { skipped: true }; const settings = await getSettings(); if (!settings.enabled) return { skipped: true }; await promoteAutoApprove(wid, myQueue); const ticketId = String(job.data?.ticketId || job.id?.replace(/^ticket-/, "") || ""); if (!ticketId) return { skipped: true }; const rows = await sql`select t.*, b.id as board_id from tickets t join boards b on b.id = t.board_id where t.id=${ticketId}::uuid limit 1`; const ticket = rows[0]; if (!ticket) return { skipped: true }; if (["executing","done"].includes(ticket.execution_state)) return { skipped: true }; if (!['queued','ready_to_execute','picked_up','planning','awaiting_approval'].includes(ticket.execution_state)) return { skipped: true }; await handleTicket(ticket, ticket.board_id, wid); return { ok: true }; }
async function setupWorker() { ticketWorker = new Worker("tickets", async (job) => { try { return await processJob(job); } catch (error) { console.error("[task-worker] job failed", error); throw error; } }, { connection: redisConnection, concurrency: Math.max(1, Number(process.env.TICKET_WORKER_CONCURRENCY || latestSettings.maxConcurrency || 3)), stalledInterval: 30000 }); ticketWorker.on("stalled", (jobId) => console.warn("[task-worker] stalled job", jobId)); ticketWorker.on("completed", (job) => console.log(`[task-worker] completed ${job.id}`)); ticketWorker.on("failed", (job, err) => console.error(`[task-worker] failed ${job?.id}`, err?.message || err)); }
async function setupNotifyBridge() { await sql.listen('ticket_ready', async (payload) => { if (shuttingDown) return; const ticketId = String(payload || '').trim(); if (ticketId) await enqueueTicket(ticketId, { source: 'notify' }); }); notifyListenerActive = true; }
async function handleTick() { try { const settings = await getSettings(); const out = { picked: 0, reason: "bullmq" }; await sql`update worker_settings set last_tick_at=now(), updated_at=now() where id=1`; await sql`select pg_notify('worker_tick', ${JSON.stringify({ picked: out.picked, reason: out.reason, interval: settings.pollIntervalSeconds, concurrency: settings.maxConcurrency, at: new Date().toISOString() })})`; } catch (error) { console.error("[task-worker] tick failed", error); } }
async function main() { await getOpenclawConfig(); await setupWorker(); await setupNotifyBridge(); await handleTick(); promoteTimer = setInterval(async () => { void promoteAutoApprove(await workspaceId(), myQueue); }, 60000); settingsTimer = setInterval(() => { void getSettings(); }, 30000); console.log("[task-worker] started (bullmq)"); await new Promise(() => {}); }
async function shutdown() { if (shuttingDown) return; shuttingDown = true; if (promoteTimer) clearInterval(promoteTimer); if (settingsTimer) clearInterval(settingsTimer); if (ticketWorker) await ticketWorker.close(); await sql.end({ timeout: 5 }); process.exit(0); }
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown); await main();