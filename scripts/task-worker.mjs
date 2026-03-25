#!/usr/bin/env node
import postgres from "postgres";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { normalizeWorkerSettings, capacityLeft } from "../lib/tasks/worker-core.mjs";

const execFileAsync = promisify(execFile);

const connectionString = process.env.DATABASE_URL?.trim() || process.env.OPENCLAW_DATABASE_URL?.trim();
if (!connectionString) {
  console.error("[task-worker] Missing DATABASE_URL or OPENCLAW_DATABASE_URL");
  process.exit(1);
}

const sql = postgres(connectionString, {
  max: 10,
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 10,
});

let shuttingDown = false;
let timer = null;
const myQueue = process.env.WORKER_QUEUE || 'default';

let _openclawConfig = null;
async function getOpenclawConfig() {
  if (_openclawConfig) return _openclawConfig;
  try {
    const { stdout } = await execFileAsync('node', ['-e', `
      const fs = require('fs');
      const path = require('path');
      const configPath = process.env.OPENCLAW_CONFIG_PATH || (process.env.OPENCLAW_HOME + '/openclaw.json');
      console.log(JSON.stringify(JSON.parse(fs.readFileSync(configPath, 'utf8'))));
    `], { env: { ...process.env, OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH || '/home/nodejs/openclaw.json', OPENCLAW_HOME: process.env.OPENCLAW_HOME || '/home/nodejs' } });
    _openclawConfig = JSON.parse(stdout.trim());
  } catch {
    _openclawConfig = {};
  }
  return _openclawConfig;
}

async function hasTelegramBinding(agentId) {
  const config = await getOpenclawConfig();
  const bindings = config?.bindings ?? [];
  return bindings.some(b => b?.agentId === agentId && b?.match?.channel === 'telegram');
}

async function workspaceId() {
  const rows = await sql`select id from workspaces order by created_at asc limit 1`;
  return rows[0]?.id ?? null;
}

async function getSettings() {
  const rows = await sql`select enabled, poll_interval_seconds, max_concurrency from worker_settings where id=1 limit 1`;
  return normalizeWorkerSettings({
    enabled: rows[0]?.enabled ?? true,
    pollIntervalSeconds: rows[0]?.poll_interval_seconds ?? 20,
    maxConcurrency: rows[0]?.max_concurrency ?? 3,
  });
}

async function getColumnIdsByTitle(boardId, names) {
  const rows = await sql`
    select id, lower(trim(title)) as title
    from columns
    where board_id = ${boardId}::uuid
  `;
  const wanted = new Set(names.map((x) => x.toLowerCase()));
  return rows.filter((r) => wanted.has(r.title)).map((r) => r.id);
}

async function writeActivity(ticketId, event, details, level = "info") {
  const result = await sql`insert into ticket_activity (ticket_id, source, event, details, level) values (${ticketId}::uuid, 'Worker', ${event}, ${details}, ${level}) returning id::text`;
  const insertedId = result[0]?.id;
  if (insertedId) {
    await sql`select pg_notify('ticket_activity', ${insertedId})`;
  }
}

async function sendTelegramMessage(ticket, text, chatId = null) {
  const targetId = chatId ?? ticket.telegram_chat_id;
  if (!targetId) return;
  try {
    await execFileAsync("openclaw", [
      "message", "send",
      "--channel", "telegram",
      "--target", String(targetId),
      "--message", text,
      "--json"
    ], { timeout: 60000, env: process.env });
  } catch (e) {
    console.warn("Failed to send Telegram message", e.message);
  }
}

async function generatePlan(ticket, wid) {
  await sql`update tickets set execution_state='planning', updated_at=now() where id=${ticket.id}::uuid`;
  await writeActivity(ticket.id, "Planning", "Generating plan for approval.", "info");

  // Fetch subtasks and comments for richer context
  const [subtaskRows, commentRows] = await Promise.all([
    sql`select title, completed from ticket_subtasks where ticket_id = ${ticket.id}::uuid order by position asc, created_at asc`,
    sql`select content, author_name, created_at from ticket_comments where ticket_id = ${ticket.id}::uuid order by created_at asc limit 10`,
  ]);

  const prompt = [
    `## Ticket: ${ticket.title}`,
    '',
    ticket.description && `### Description`,
    ticket.description || null,
    '',
    subtaskRows.length > 0 && `### Subtasks`,
    subtaskRows.length > 0 ? subtaskRows.map((s, i) => `  ${i + 1}. [${s.completed ? 'x' : ' '}] ${s.title}`).join('\n') : null,
    '',
    commentRows.length > 0 && `### Notes / Comments`,
    commentRows.length > 0
      ? commentRows.map(c => `[${c.author_name}] ${new Date(c.created_at).toISOString().split('T')[0]}: ${c.content}`).join('\n')
      : null,
    '',
    `### Metadata`,
    ticket.priority && `Priority: ${ticket.priority}`,
    ticket.due_date && `Due: ${new Date(ticket.due_date).toISOString().split('T')[0]}`,
    Array.isArray(ticket.tags) && ticket.tags.length > 0 && `Tags: ${ticket.tags.join(', ')}`,
    '',
    "Create an execution plan only.",
    "Do not execute anything.",
    "Return a concise numbered plan plus acceptance criteria."
  ].filter(Boolean).join("\n");

  let agentId = "planner";
  const args = ["agent", "--agent", agentId, "--message", prompt, "--json"];
  const chatId = ticket.telegram_chat_id ?? await getRecentChatId(wid, agentId);

  try {
    // Fallback to main if planner not registered
    if ((await sql`select id from agents where workspace_id = ${wid} and openclaw_agent_id = ${agentId} limit 1`).length === 0) {
      args[2] = "main";
    }
    const { stdout } = await execFileAsync("openclaw", args, { timeout: 5 * 60 * 1000, env: process.env });
    const result = JSON.parse(stdout);
    const payloads = result?.payloads ?? [];
    const planText = payloads.map(p => p.text ?? '').join('\n').trim() || result?.text || result?.reply || JSON.stringify(result);

    // Write the generated plan to ticket activity
    await sql`
      insert into ticket_activity (ticket_id, source, event, details, level)
      values (${ticket.id}::uuid, 'planner', 'Plan generated', ${planText}, 'info')
    `;
    const insertedPlan = await sql`select id::text from ticket_activity where ticket_id = ${ticket.id}::uuid order by occurred_at desc limit 1`;
    if (insertedPlan[0]?.id) await sql`select pg_notify('ticket_activity', ${insertedPlan[0].id})`;

    await sql`update tickets set plan_text=${planText}, approval_state='pending', execution_state='awaiting_approval', plan_generated_at=now(), updated_at=now() where id=${ticket.id}::uuid`;
    await writeActivity(ticket.id, "Plan ready", "Waiting for user approval.", "info");
    await sendTelegramMessage(ticket, `Plan ready for "${ticket.title}"\n\n${planText}\n\nApprove in Mission Control to start execution.`, chatId);
  } catch (error) {
    await writeActivity(ticket.id, "Planning failed", error.message, "error");
    await sendTelegramMessage(ticket, `❌ Planning failed for "${ticket.title}": ${error.message}`, chatId);
    await sql`update tickets set execution_state='failed', updated_at=now() where id=${ticket.id}::uuid`;
  }
}

async function handleTicket(ticket, boardId, wid) {
  try {
    // Planned ticket needing approval?
    if (ticket.execution_mode === 'planned' && ticket.approval_state !== 'approved') {
      if (!ticket.plan_text) {
        await generatePlan(ticket, wid);
      } else {
        // Already has plan; ensure awaiting_approval state
        await sql`update tickets set execution_state='awaiting_approval', updated_at=now() where id=${ticket.id}::uuid and execution_state != 'awaiting_approval'`;
      }
      return;
    }

    // Execute (direct or approved planned)
    await executeTicket(ticket, boardId, wid);
  } catch (error) {
    console.error("Ticket handling error", ticket.id, error);
    await writeActivity(ticket.id, "Worker error", String(error.message || error), "error");
    await sql`update tickets set execution_state='failed', updated_at=now() where id=${ticket.id}::uuid`;
  }
}

async function executeTicket(ticket, boardId, wid) {
  const ticketId = ticket.id;

  // Verify agent exists; fallback to 'main' if missing
  let agentId = ticket.assigned_agent_id;
  const agentRows = await sql`select id from agents where workspace_id = ${wid} and openclaw_agent_id = ${agentId} limit 1`;
  if (agentRows.length === 0) {
    agentId = 'main';
  }

  // Resolve chat_id before any sends
  const chatIdForDelivery = ticket.telegram_chat_id ?? await getRecentChatId(wid, agentId);

  await sql`update tickets set execution_state='executing', updated_at=now() where id=${ticketId}::uuid`;
  await writeActivity(ticketId, "Picked up", "Worker picked up ticket.", "info");
  await sendTelegramMessage(ticket, `🚀 Starting execution of "${ticket.title}"`, chatIdForDelivery);

  // Fetch subtasks and comments for richer context
  const [subtaskRows, commentRows] = await Promise.all([
    sql`select title, completed from ticket_subtasks where ticket_id = ${ticketId}::uuid order by position asc, created_at asc`,
    sql`select content, author_name, created_at from ticket_comments where ticket_id = ${ticketId}::uuid order by created_at asc limit 20`,
  ]);

  // Build structured prompt with all ticket context
  const parts = [
    `## Ticket: ${ticket.title}`,
    '',
    ticket.description && `### Description`,
    ticket.description || null,
    '',
    subtaskRows.length > 0 && `### Subtasks`,
    subtaskRows.length > 0 ? subtaskRows.map((s, i) => `  ${i + 1}. [${s.completed ? 'x' : ' '}] ${s.title}`).join('\n') : null,
    '',
    commentRows.length > 0 && `### Notes / Comments`,
    commentRows.length > 0
      ? commentRows.map(c => `[${c.author_name}] ${new Date(c.created_at).toISOString().split('T')[0]}: ${c.content}`).join('\n')
      : null,
    '',
    ticket.plan_text && `### Plan`,
    ticket.plan_text || null,
    '',
    `### Metadata`,
    ticket.priority && `Priority: ${ticket.priority}`,
    ticket.due_date && `Due: ${new Date(ticket.due_date).toISOString().split('T')[0]}`,
    Array.isArray(ticket.tags) && ticket.tags.length > 0 && `Tags: ${ticket.tags.join(', ')}`,
    subtaskRows.length > 0 && `Subtask progress: ${subtaskRows.filter(s => s.completed).length}/${subtaskRows.length}`,
    ticket.checklist_total > 0 && ticket.checklist_total !== subtaskRows.length && `Legacy checklist progress: ${ticket.checklist_done}/${ticket.checklist_total}`,
    '',
    'Execute the above ticket. Report progress via activity tools and mark completion when done.',
  ].filter(Boolean);

  const prompt = parts.join('\n');

  const args = ["agent", "--agent", agentId, "--message", prompt, "--json"];

  let result;
  try {
    const { stdout } = await execFileAsync("openclaw", args, { timeout: 10 * 60 * 1000, env: process.env });
    const parsed = JSON.parse(stdout);
    // openclaw returns { result: { payloads: [{ text, mediaUrl }] } }
    const inner = parsed?.result ?? parsed;
    const rawPayloads = Array.isArray(inner?.payloads) ? inner.payloads : [];
    result = { success: true, result: parsed, _rawPayloads: rawPayloads };
  } catch (error) {
    result = { success: false, error: error.message };
    console.error("[executeTicket] exec error:", error.message);
  }

  if (result.success) {
    const payloads = result._rawPayloads;
    const responseText = payloads.map(p => p.text ?? '').join('\n').trim();

    // Write agent's full response to the ticket's activity log so it's visible in the UI
    if (responseText) {
      await sql`
        insert into ticket_activity (ticket_id, source, event, details, level)
        values (
          ${ticketId}::uuid,
          ${agentId},
          'Agent response',
          ${responseText},
          'info'
        )
      `;
      // Notify any open ticket details modals
      const inserted = await sql`select id::text from ticket_activity where ticket_id = ${ticketId}::uuid order by occurred_at desc limit 1`;
      if (inserted[0]?.id) await sql`select pg_notify('ticket_activity', ${inserted[0].id})`;
    }

    if (chatIdForDelivery && responseText) {
      await sendTelegramMessage(ticket, responseText, chatIdForDelivery);
    }

    const completedIds = await getColumnIdsByTitle(boardId, ["completed", "done"]);
    const completedColumnId = completedIds[0] ?? null;
    if (completedColumnId) {
      await sql`update tickets set execution_state='done', column_id=${completedColumnId}::uuid, updated_at=now() where id=${ticketId}::uuid`;
    } else {
      await sql`update tickets set execution_state='done', updated_at=now() where id=${ticketId}::uuid`;
    }
    await writeActivity(ticketId, "Completed", `Agent "${agentId}" completed successfully.`, "success");
    await sendTelegramMessage(ticket, `✅ Ticket "${ticket.title}" completed.`, chatIdForDelivery);
  } else {
    await sql`
      insert into ticket_activity (ticket_id, source, event, details, level)
      values (${ticketId}::uuid, ${agentId}, 'Agent error', ${result.error}, 'error')
    `;
    await sql`update tickets set execution_state='failed', updated_at=now() where id=${ticketId}::uuid`;
    await writeActivity(ticketId, "Failed", `Agent "${agentId}" failed: ${result.error}`, "error");
    await sendTelegramMessage(ticket, `❌ Ticket "${ticket.title}" failed: ${result.error}`, chatIdForDelivery);
  }
}

async function getOrCreateSession(wid, agentId, telegramChatId) {
  if (!telegramChatId) return null;

  // Look up existing session
  const sessionRows = await sql`
    select openclaw_session_key from agent_sessions
    where workspace_id = ${wid} and agent_id = (select id from agents where workspace_id = ${wid} and openclaw_agent_id = ${agentId} limit 1) and telegram_chat_id = ${telegramChatId}
    limit 1
  `;
  if (sessionRows[0]?.openclaw_session_key) {
    // Update last_used_at
    await sql`update agent_sessions set last_used_at = now() where openclaw_session_key = ${sessionRows[0].openclaw_session_key}`;
    return sessionRows[0].openclaw_session_key;
  }

  // Create new session by sending a "hello" message with --deliver to establish session
  try {
    const { stdout } = await execFileAsync("openclaw", [
      "agent",
      "--agent", agentId,
      "--channel", "telegram",
      "--to", telegramChatId,
      "--message", "(Session init)",
      "--deliver",
      "--json",
    ], { timeout: 2 * 60 * 1000, env: process.env });

    let result;
    try {
      result = JSON.parse(stdout);
    } catch (e) {
      console.error("[task-worker] session init parse error", e);
      return null;
    }

    const sessionKey = result.session_key || result.sessionId;
    if (!sessionKey) {
      console.error("[task-worker] session init missing session_key", result);
      return null;
    }

    // Ensure agent record exists
    const agentRows = await sql`select id from agents where workspace_id = ${wid} and openclaw_agent_id = ${agentId} limit 1`;
    let agentUuid = agentRows[0]?.id;
    if (!agentUuid) {
      const insertAgent = await sql`insert into agents (workspace_id, openclaw_agent_id) values (${wid}, ${agentId}) returning id`;
      agentUuid = insertAgent[0].id;
    }

    await sql`insert into agent_sessions (workspace_id, agent_id, telegram_chat_id, openclaw_session_key) values (${wid}, ${agentUuid}, ${telegramChatId}, ${sessionKey}) on conflict (workspace_id, agent_id, telegram_chat_id) do update set openclaw_session_key = EXCLUDED.openclaw_session_key, last_used_at = now()`;

    return sessionKey;
  } catch (error) {
    console.error("[task-worker] session init failed", error);
    return null;
  }
}

// Look up the most recent Telegram chat_id for this agent by reading its sessions.json.
// Falls back to main agent's session if the named agent has no Telegram sessions yet.
async function getRecentChatId(wid, agentId) {
  // Try the named agent first
  const sessionsPath = `${process.env.OPENCLAW_STATE_DIR || '/home/nodejs'}/agents/${agentId}/sessions/sessions.json`;
  try {
    const { stdout: sessionsData } = await execFileAsync('node', ['-e', `
      const fs = require('fs');
      const path = require('path');
      const data = JSON.parse(fs.readFileSync('${sessionsPath}', 'utf8'));
      for (const [key, val] of Object.entries(data)) {
        if (key.startsWith('agent:') && key.includes(':telegram:') && val.deliveryContext?.channel === 'telegram' && val.deliveryContext?.to) {
          console.log(val.deliveryContext.to);
          break;
        }
      }
    `]);
    const chatId = sessionsData.trim();
    if (chatId) return chatId.replace(/^telegram:/, '');
  } catch {}

  // Fallback: try main agent's sessions
  const mainPath = `${process.env.OPENCLAW_STATE_DIR || '/home/nodejs'}/agents/main/sessions/sessions.json`;
  try {
    const { stdout: mainData } = await execFileAsync('node', ['-e', `
      const fs = require('fs');
      const data = JSON.parse(fs.readFileSync('${mainPath}', 'utf8'));
      for (const [key, val] of Object.entries(data)) {
        if (key.startsWith('agent:') && key.includes(':telegram:') && val.deliveryContext?.channel === 'telegram' && val.deliveryContext?.to) {
          console.log(val.deliveryContext.to);
          break;
        }
      }
    `]);
    const raw = mainData.trim();
    return raw ? raw.replace(/^telegram:/, '') : null;
  } catch {
    return null;
  }
}

async function dispatchToAgent(ticket, wid) {
  const plan = (ticket.plan_text || `Execute ticket: ${ticket.title}`).trim();
  const agentId = ticket.assigned_agent_id;
  const telegramChatId = ticket.telegram_chat_id ?? await getRecentChatId(wid, agentId);

  const args = [
    "agent",
    "--agent", agentId,
    "--message", plan,
    "--json",
  ];

  if (telegramChatId) {
    const sessionKey = await getOrCreateSession(wid, agentId, telegramChatId);
    if (sessionKey) args.push("--session-id", sessionKey);
    args.push("--deliver", "--channel", "telegram", "--to", telegramChatId);
  }

  try {
    const { stdout } = await execFileAsync("openclaw", args, { timeout: 10 * 60 * 1000, env: process.env });
    let result;
    try {
      result = JSON.parse(stdout);
    } catch {
      result = { raw: stdout };
    }
    return { success: true, result };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      code: error.code,
      stdout: error.stdout,
      stderr: error.stderr,
    };
  }
}

async function promoteAutoApprove(wid, queueName) {
  const rows = await sql`
    select id, board_id
    from tickets
    where workspace_id = ${wid}::uuid
      and queue_name = ${queueName}
      and auto_approve = true
      and (execution_state = 'open' or execution_state = 'pending')
      and (scheduled_for is null or scheduled_for <= now())
    limit 100
  `;
  for (const row of rows) {
    const inProgressIds = await getColumnIdsByTitle(row.board_id, ["in progress", "doing"]);
    const toColumnId = inProgressIds[0];
    if (!toColumnId) continue;
    await sql`update tickets set column_id=${toColumnId}::uuid, execution_state='queued', approval_state='approved', approved_by='auto', approved_at=now(), updated_at=now() where id=${row.id}::uuid`;
    await writeActivity(row.id, "Auto approved", "Auto-approved and queued by worker.", "info");
    // Notify that this ticket is now ready
    await sql`select pg_notify('ticket_ready', ${row.id}::text)`;
  }
}


async function processTick() {
  const wid = await workspaceId();
  if (!wid) return { picked: 0, reason: "no-workspace" };

  const settings = await getSettings();
  if (!settings.enabled) return { picked: 0, reason: "disabled", settings };

  await promoteAutoApprove(wid, myQueue);

  const runningRows = await sql`select count(*)::int as n from tickets where workspace_id = ${wid}::uuid and execution_state='executing'`;
  const executing = Number(runningRows[0]?.n ?? 0);
  const limit = capacityLeft(settings.maxConcurrency, executing);
  if (limit <= 0) return { picked: 0, reason: "at-capacity", settings };

  const inProgressRows = await sql`
    select distinct c.id
    from columns c
    join boards b on b.id = c.board_id
    where b.workspace_id = ${wid}::uuid
      and lower(trim(c.title)) in ('in progress', 'doing')
  `;
  const inProgressIds = inProgressRows.map((r) => r.id);
  if (inProgressIds.length === 0) return { picked: 0, reason: "no-in-progress-list", settings };

  const candidates = await sql.begin(async (tx) => {
    const rows = await tx`
      select t.id, t.board_id, t.title, t.description, t.plan_text, t.execution_state,
             t.execution_mode, t.approval_state,
             t.checklist_done, t.checklist_total, t.priority, t.due_date, t.tags,
             t.assigned_agent_id, t.telegram_chat_id
      from tickets t
      where t.workspace_id = ${wid}::uuid
        and t.column_id = any(${tx.array(inProgressIds)}::uuid[])
        and t.execution_state in ('queued', 'ready_to_execute')
        and t.queue_name = ${myQueue}
        and coalesce(t.assigned_agent_id, '') <> ''
        and (t.scheduled_for is null or t.scheduled_for <= now())
      order by t.updated_at asc, t.created_at asc
      for update skip locked
      limit ${limit}
    `;

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    await tx`update tickets set execution_state='picked_up', updated_at=now() where id = any(${tx.array(ids)}::uuid[])`;
    return rows;
  });

  await Promise.all(candidates.map((row) => handleTicket(row, row.board_id, wid)));
  return { picked: candidates.length, reason: "ok", settings };
}

async function handleNotify() {
  // Guard against overlapping ticks
  if (handleNotify.running) return;
  handleNotify.running = true;
  try {
    await handleTick();
  } finally {
    handleNotify.running = false;
  }
}

async function handleTick() {
  try {
    const out = await processTick();
    const settings = out.settings || (await getSettings());
    console.log(`[task-worker] tick picked=${out.picked} reason=${out.reason} concurrency=${settings.maxConcurrency}`);

    await sql`update worker_settings set last_tick_at=now(), updated_at=now() where id=1`;
    await sql`select pg_notify('worker_tick', ${JSON.stringify({
      picked: out.picked,
      reason: out.reason,
      interval: settings.pollIntervalSeconds,
      concurrency: settings.maxConcurrency,
      at: new Date().toISOString()
    })})`;
  } catch (error) {
    console.error("[task-worker] tick failed", error);
  }
}

async function main() {
  // Initial tick to pick up any existing ready tickets
  await handleTick();

  // Listen for new ready tickets
  await sql.listen('ticket_ready', handleNotify);

  // Periodic polling as fallback
  setInterval(async () => {
    await handleNotify();
  }, (await getSettings()).pollIntervalSeconds * 1000);

  // Keep process alive
  await new Promise(() => {});
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (timer) clearTimeout(timer);
  await sql.end({ timeout: 5 });
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("[task-worker] started (event-driven)");
await main();