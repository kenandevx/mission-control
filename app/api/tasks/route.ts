import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";

/* eslint-disable @typescript-eslint/no-explicit-any -- action-based route with validated body fields */
type Json = Record<string, any>;

const ok = (data: Json = {}) => NextResponse.json({ ok: true, ...data });
const fail = (message: string, status = 400) => NextResponse.json({ ok: false, error: message }, { status });

function validateScheduledFor(raw: unknown, stepRaw: unknown): { iso: string | null; error: string | null } {
  if (raw === undefined) return { iso: null, error: null };
  if (raw === null || String(raw).trim() === "") return { iso: null, error: null };

  const dt = new Date(String(raw));
  if (Number.isNaN(dt.getTime())) return { iso: null, error: "Invalid scheduled date/time." };

  const rawStep = stepRaw === undefined ? 15 : Number(stepRaw);
  const step = Number.isFinite(rawStep) ? Math.max(1, Math.floor(rawStep)) : 15;
  if (dt.getMinutes() % step !== 0) {
    if (step === 15) {
      return { iso: null, error: "Tickets can only be scheduled at 15-minute intervals (XX:00, XX:15, XX:30, XX:45)." };
    }
    return { iso: null, error: `Tickets can only be scheduled at ${step}-minute intervals.` };
  }

  return { iso: dt.toISOString(), error: null };
}

async function workspaceId(sql: ReturnType<typeof getSql>) {
  const rows = await sql`select id from workspaces order by created_at asc limit 1`;
  return rows[0]?.id ?? null;
}

async function normalizeTicketPosition(sql: ReturnType<typeof getSql>, columnId: string) {
  const rows = await sql`select id from tickets where column_id=${columnId} order by position asc, created_at asc`;
  for (let i = 0; i < rows.length; i += 1) {
    await sql`update tickets set position=${i}, updated_at=now() where id=${rows[i].id}`;
  }
}

async function ensureTasksAgentId(sql: ReturnType<typeof getSql>, wid: string) {
  const existing = await sql`select id from agents where workspace_id=${wid} and openclaw_agent_id='tasks' limit 1`;
  if (existing[0]?.id) return existing[0].id as string;
  const inserted = await sql`
    insert into agents (workspace_id, openclaw_agent_id, status, model, last_heartbeat_at)
    values (${wid}, 'tasks', 'running', 'mission-control', now())
    returning id
  `;
  return inserted[0]?.id as string;
}

async function logTaskAudit(
  sql: ReturnType<typeof getSql>,
  wid: string,
  params: { event: string; details?: string; level?: "info" | "success" | "warning" | "error"; ticketId?: string | null },
) {
  const level = params.level || "info";
  const details = params.details || "";
  await sql`insert into activity_logs (workspace_id, source, event, details, level) values (${wid}, 'Tasks', ${params.event}, ${details}, ${level})`;

  if (params.ticketId) {
    const activityInsert = await sql`insert into ticket_activity (ticket_id, source, event, details, level) values (${params.ticketId}, 'Tasks', ${params.event}, ${details}, ${level}) returning id::text`;
    const activityId = activityInsert[0]?.id;
    if (activityId) {
      await sql`select pg_notify('ticket_activity', ${activityId})`;
    }
  }

  const tasksAgentId = await ensureTasksAgentId(sql, wid);
  const inserted = await sql`
    insert into agent_logs (
      workspace_id, agent_id, runtime_agent_id, occurred_at, level, type, message, event_type, message_preview, raw_payload
    ) values (
      ${wid}, ${tasksAgentId}, 'tasks', now(), ${level}, 'workflow', ${`${params.event}${details ? ` — ${details}` : ''}`}, 'task.event', ${`${params.event}${details ? ` — ${details}` : ''}`.slice(0, 240)}, ${JSON.stringify({ event: params.event, details, ticketId: params.ticketId || null })}::jsonb
    ) returning id::text
  `;
  const insertedId = inserted[0]?.id;
  if (insertedId) {
    await sql`select pg_notify('agent_logs', ${insertedId})`;
  }
}

async function hasTableColumn(sql: ReturnType<typeof getSql>, tableName: string, columnName: string): Promise<boolean> {
  const rows = await sql`
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = ${tableName}
      and column_name = ${columnName}
    limit 1
  `;
  return rows.length > 0;
}

async function getWorkerSettings(sql: ReturnType<typeof getSql>) {
  const hasSidebarActivityCount = await hasTableColumn(sql, "worker_settings", "sidebar_activity_count");

  const rows = hasSidebarActivityCount
    ? await sql`
        select enabled, poll_interval_seconds, max_concurrency, last_tick_at, agenda_concurrency, default_execution_window_minutes, auto_retry_after_minutes, max_retries, default_fallback_model, sidebar_activity_count, instance_name
        from worker_settings
        where id = 1
        limit 1
      `
    : await sql`
        select enabled, poll_interval_seconds, max_concurrency, last_tick_at, agenda_concurrency, default_execution_window_minutes, auto_retry_after_minutes, max_retries, default_fallback_model, instance_name
        from worker_settings
        where id = 1
        limit 1
      `;

  const row = rows[0] || {
    enabled: true,
    poll_interval_seconds: 20,
    max_concurrency: 3,
    last_tick_at: null,
    agenda_concurrency: 5,
    default_execution_window_minutes: 30,
    auto_retry_after_minutes: 0,
    max_retries: 1,
    default_fallback_model: "",
    sidebar_activity_count: 8,
    instance_name: "Mission Control",
  };

  return {
    enabled: Boolean(row.enabled),
    pollIntervalSeconds: Number(row.poll_interval_seconds || 20),
    maxConcurrency: Number(row.max_concurrency || 3),
    lastTickAt: row.last_tick_at ? String(row.last_tick_at) : null,
    agendaConcurrency: Number(row.agenda_concurrency || 5),
    defaultExecutionWindowMinutes: Number(row.default_execution_window_minutes || 30),
    autoRetryAfterMinutes: Number(row.auto_retry_after_minutes || 0),
    maxRetries: Number(row.max_retries ?? 1),
    defaultFallbackModel: String(row.default_fallback_model || ""),
    sidebarActivityCount: Number(row.sidebar_activity_count ?? 8),
    instanceName: String(row.instance_name || "Mission Control"),
  };
}

export async function GET() {
  try {
    const sql = getSql();
    const wid = await workspaceId(sql);
    if (!wid) return ok({ boards: [], columns: [], tickets: [], workerSettings: { enabled: true, pollIntervalSeconds: 20, maxConcurrency: 3, lastTickAt: null } });

    const [boards, columns, tickets, workerSettings] = await Promise.all([
      sql`select * from boards where workspace_id=${wid} order by created_at asc`,
      sql`select * from columns where board_id in (select id from boards where workspace_id=${wid}) order by position asc, created_at asc`,
      sql`select * from tickets where workspace_id=${wid} order by position asc, created_at asc`,
      getWorkerSettings(sql),
    ]);

    return ok({ boards, columns, tickets, workerSettings });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to load tasks", 500);
  }
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const contentType = request.headers.get("content-type") || "";
    const isMultipart = contentType.includes("multipart/form-data");

    let action = "";
    let body: Json = {};
    let form: FormData | null = null;

    if (isMultipart) {
      form = await request.formData();
      action = String(form.get("action") || "");
    } else {
      body = (await request.json()) as Json;
      action = String(body.action || "");
    }

    const wid = await workspaceId(sql);
    if (!wid) return fail("Workspace not found", 500);

    const removedExecutionActions = new Set(["approvePlan", "rejectPlan", "startExecution", "retryExecution", "retryFromNeedsRetry"]);
    if (removedExecutionActions.has(action)) {
      return fail("Ticket agent execution has been removed from Boards.", 410);
    }

    if (action === "createBoard") {
      const name = String(body.name || "").trim();
      const description = String(body.description || "").trim();
      if (!name) return fail("Board name is required.");
      const rows = await sql`insert into boards (workspace_id, name, description) values (${wid}, ${name}, ${description || null}) returning *`;
      await logTaskAudit(sql, wid, { event: 'Board created', details: name, level: 'success' });
      return ok({ board: rows[0] });
    }

    if (action === "updateBoard") {
      const boardId = String(body.boardId || "");
      const name = String(body.name || "").trim();
      const description = String(body.description || "").trim();
      if (!boardId || !name) return fail("Board id and name are required.");
      const rows = await sql`update boards set name=${name}, description=${description || null}, updated_at=now() where id=${boardId} returning *`;
      await logTaskAudit(sql, wid, { event: 'Board updated', details: name, level: 'info' });
      return ok({ board: rows[0] });
    }

    if (action === "deleteBoard") {
      const boardId = String(body.boardId || "");
      if (!boardId) return fail("Board id is required.");
      await sql`delete from boards where id=${boardId}`;
      await logTaskAudit(sql, wid, { event: 'Board deleted', details: boardId, level: 'warning' });
      return ok();
    }

    if (action === "createColumn") {
      const boardId = String(body.boardId || "");
      const title = String(body.title || "").trim();
      const colorKey = String(body.colorKey || "neutral");
      const isDefault = Boolean(body.isDefault);
      if (!boardId || !title) return fail("Board id and title are required.");
      const posRows = await sql`select coalesce(max(position), -1) + 1 as pos from columns where board_id=${boardId}`;
      const position = Number(posRows[0]?.pos ?? 0);
      const rows = await sql`insert into columns (board_id, title, color_key, is_default, position) values (${boardId}, ${title}, ${colorKey}, ${isDefault}, ${position}) returning *`;
      await logTaskAudit(sql, wid, { event: 'List created', details: title, level: 'success' });
      return ok({ column: rows[0] });
    }

    if (action === "updateColumn") {
      const columnId = String(body.columnId || "");
      if (!columnId) return fail("Column id is required.");
      const rows = await sql`update columns set title=coalesce(${body.title || null}, title), color_key=coalesce(${body.colorKey || null}, color_key), is_default=coalesce(${body.isDefault ?? null}, is_default), updated_at=now() where id=${columnId} returning *`;
      return ok({ column: rows[0] });
    }

    if (action === "deleteColumn") {
      const columnId = String(body.columnId || "");
      if (!columnId) return fail("Column id is required.");
      await sql`delete from columns where id=${columnId}`;
      await logTaskAudit(sql, wid, { event: 'List deleted', details: columnId, level: 'warning' });
      return ok();
    }

    if (action === "reorderColumns") {
      const orderedColumnIds = Array.isArray(body.orderedColumnIds) ? body.orderedColumnIds : [];
      for (let i = 0; i < orderedColumnIds.length; i += 1) {
        await sql`update columns set position=${i}, updated_at=now() where id=${String(orderedColumnIds[i])}`;
      }
      return ok();
    }

    if (action === "createTicket") {
      const boardId = String(body.boardId || "");
      const columnId = String(body.columnId || "");
      const title = String(body.title || "").trim();
      if (!boardId || !columnId || !title) return fail("Board, column and title are required.");

      const posRows = await sql`select coalesce(max(position), -1) + 1 as pos from tickets where column_id=${columnId}`;
      const position = Number(posRows[0]?.pos ?? 0);
      const tags = Array.isArray(body.tags) ? body.tags.map(String) : [];
      const assigneeIds = Array.isArray(body.assigneeIds) ? body.assigneeIds.map(String) : [];
      const scheduled = validateScheduledFor(body.scheduledFor, body.timeStepMinutes);
      if (scheduled.error) return fail(scheduled.error);

      const rows = await sql`
        insert into tickets (
          workspace_id, board_id, column_id, title, description, priority, due_date,
          tags, assignee_ids, assigned_agent_id, execution_mode, plan_text, plan_approved, scheduled_for, execution_state,
          checklist_done, checklist_total, comments_count, attachments_count, position, telegram_chat_id, process_version_ids,
          execution_window_minutes, fallback_model
        ) values (
          ${wid}, ${boardId}, ${columnId}, ${title}, ${String(body.description || "")}, ${String(body.priority || "low")}, ${body.dueDate || null},
          ${sql.array(tags)}, ${sql.array(assigneeIds)}, '', 'direct', '', false, ${scheduled.iso}, 'open',
          ${Number(body.checklistDone || 0)}, ${Number(body.checklistTotal || 0)}, ${Number(body.commentsCount || 0)}, ${Number(body.attachmentsCount || 0)}, ${position}, ${body.telegramChatId || null}, ${sql.array([])}::uuid[],
          60, ''
        )
        returning *
      `;
      const created = rows[0];
      if (created?.id) {
        await logTaskAudit(sql, wid, { event: 'Ticket created', details: created.title || title, level: 'success' });
      }
      return ok({ ticket: created });
    }

    if (action === "updateTicket") {
      const ticketId = String(body.ticketId || "");
      if (!ticketId) return fail("Ticket id is required.");
      const tags = Array.isArray(body.tags) ? body.tags.map(String) : [];
      const assigneeIds = Array.isArray(body.assigneeIds) ? body.assigneeIds.map(String) : [];

      const beforeRows = await sql`select * from tickets where id=${ticketId} limit 1`;
      const before = beforeRows[0];
      if (!before) return fail("Ticket not found.", 404);

      let scheduledIsoForUpdate: string | null = null;
      if (body.scheduledFor !== undefined) {
        const scheduled = validateScheduledFor(body.scheduledFor, body.timeStepMinutes);
        if (scheduled.error) return fail(scheduled.error);
        scheduledIsoForUpdate = scheduled.iso;
      }

      const rows = await sql`
        update tickets
        set
          column_id = coalesce(${body.columnId || null}, column_id),
          title = coalesce(${body.title || null}, title),
          description = coalesce(${body.description ?? null}, description),
          priority = coalesce(${body.priority || null}, priority),
          due_date = case when ${body.dueDate === undefined} then due_date else ${body.dueDate ?? null} end,
          tags = case when ${body.tags === undefined} then tags else ${sql.array(tags)} end,
          assignee_ids = case when ${body.assigneeIds === undefined} then assignee_ids else ${sql.array(assigneeIds)} end,
          assigned_agent_id = '',
          process_version_ids = ${sql.array([])}::uuid[],
          execution_mode = 'direct',
          plan_text = '',
          plan_approved = false,
          approved_by = null,
          approved_at = null,
          scheduled_for = case when ${body.scheduledFor === undefined} then scheduled_for else ${scheduledIsoForUpdate} end,
          execution_state = 'open',
          checklist_done = coalesce(${body.checklistDone ?? null}, checklist_done),
          checklist_total = coalesce(${body.checklistTotal ?? null}, checklist_total),
          comments_count = coalesce(${body.commentsCount ?? null}, comments_count),
          attachments_count = coalesce(${body.attachmentsCount ?? null}, attachments_count),
          execution_window_minutes = 60,
          fallback_model = '',
          updated_at = now()
        where id = ${ticketId}
        returning *
      `;
      const updated = rows[0];
      if (updated?.id && before) {
        if (before.execution_state !== updated.execution_state) {
          await logTaskAudit(sql, wid, {
            event: 'Execution updated',
            details: `State: ${before.execution_state} → ${updated.execution_state}`,
            level: 'info',
            ticketId: updated.id,
          });
          // Notify workers that this ticket is ready
          const newState = updated.execution_state;
          if (newState === 'queued' || newState === 'ready_to_execute') {
            await sql`select pg_notify('ticket_ready', ${ticketId}::text)`;
          }
        }
        if (before.column_id !== updated.column_id) {
          // Note: ticket_activity entry is created by the UI hook — only log to activity_logs/agent_logs here
          await logTaskAudit(sql, wid, {
            event: 'Moved column',
            details: 'Column changed.',
            level: 'info',
          });
        }
        if (before.plan_approved !== updated.plan_approved) {
          await logTaskAudit(sql, wid, {
            event: 'Plan approval updated',
            details: `Plan approved: ${before.plan_approved ? 'yes' : 'no'} → ${updated.plan_approved ? 'yes' : 'no'}`,
            level: updated.plan_approved ? 'success' : 'warning',
            ticketId: updated.id,
          });
        }
      }
      return ok({ ticket: updated });
    }

    if (action === "deleteTicket") {
      const ticketId = String(body.ticketId || "");
      if (!ticketId) return fail("Ticket id is required.");
      await sql`delete from tickets where id=${ticketId}`;
      // Note: ticket_activity entry is created by the UI hook — only log to activity_logs/agent_logs here
      await logTaskAudit(sql, wid, { event: 'Ticket deleted', details: ticketId, level: 'warning' });
      return ok();
    }

    if (action === "moveTicket") {
      const ticketId = String(body.ticketId || "");
      const toColumnId = String(body.toColumnId || "");
      const beforeTicketId = body.beforeTicketId ? String(body.beforeTicketId) : null;
      if (!ticketId || !toColumnId) return fail("Ticket id and destination column are required.");

      const ticketRows = await sql`select id, column_id from tickets where id=${ticketId} limit 1`;
      const current = ticketRows[0];
      if (!current) return fail("Ticket not found", 404);

      await sql`update tickets set column_id=${toColumnId}, updated_at=now() where id=${ticketId}`;
      // Note: ticket_activity entry is created by the UI hook — only log to activity_logs/agent_logs here
      await logTaskAudit(sql, wid, { event: 'Moved ticket', details: 'Moved to a new column.', level: 'info' });

      if (beforeTicketId) {
        const beforeRows = await sql`select position from tickets where id=${beforeTicketId} limit 1`;
        const targetPos = Number(beforeRows[0]?.position ?? 0);
        await sql`update tickets set position = position + 1 where column_id=${toColumnId} and id <> ${ticketId} and position >= ${targetPos}`;
        await sql`update tickets set position=${targetPos} where id=${ticketId}`;
      } else {
        const maxRows = await sql`select coalesce(max(position), -1) + 1 as pos from tickets where column_id=${toColumnId} and id <> ${ticketId}`;
        await sql`update tickets set position=${Number(maxRows[0]?.pos ?? 0)} where id=${ticketId}`;
      }

      await normalizeTicketPosition(sql, String(current.column_id));
      await normalizeTicketPosition(sql, toColumnId);
      return ok();
    }

    if (action === "reorderTickets") {
      const columnId = String(body.columnId || "");
      const orderedTicketIds = Array.isArray(body.orderedTicketIds) ? body.orderedTicketIds : [];
      if (!columnId) return fail("Column id is required.");
      for (let i = 0; i < orderedTicketIds.length; i += 1) {
        await sql`update tickets set position=${i}, updated_at=now() where id=${String(orderedTicketIds[i])} and column_id=${columnId}`;
      }
      return ok();
    }

    if (action === "listTicketAttachments") {
      const ticketId = String(body.ticketId || "");
      const rows = await sql`select * from ticket_attachments where ticket_id=${ticketId} order by created_at desc`;
      return ok({ rows });
    }

    if (action === "uploadAttachment" && form) {
      const ticketId = String(form.get("ticketId") || "");
      const file = form.get("file");
      if (!ticketId || !(file instanceof File)) return fail("Ticket and file are required.");
      const buffer = Buffer.from(await file.arrayBuffer());
      const mimeType = file.type || "application/octet-stream";
      const base64 = buffer.toString("base64");
      const url = `data:${mimeType};base64,${base64}`;

      const rows = await sql`
        insert into ticket_attachments (ticket_id, name, url, mime_type, size, path)
        values (${ticketId}, ${file.name}, ${url}, ${mimeType}, ${buffer.length}, 'inline')
        returning *
      `;
      await sql`update tickets set attachments_count = coalesce((select count(*) from ticket_attachments where ticket_id=${ticketId}), 0), updated_at=now() where id=${ticketId}`;
      return ok({ attachment: rows[0] });
    }

    if (action === "attachFileFromPath") {
      // Attach a local file by its path (used by task-worker for agent-created files)
      const ticketId = String(body.ticketId || "");
      const filePath = String(body.filePath || "");
      if (!ticketId || !filePath) return fail("Ticket id and file path are required.");

      const fs = await import("node:fs");
      const path = await import("node:path");
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        return fail("File not found or is not a file.");
      }

      const fileName = path.basename(resolved);
      const fileSize = fs.statSync(resolved).size;
      const ext = path.extname(resolved).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".md": "text/markdown", ".txt": "text/plain", ".json": "application/json",
        ".csv": "text/csv", ".pdf": "application/pdf", ".html": "text/html",
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
        ".zip": "application/zip", ".tar": "application/x-tar", ".gz": "application/gzip",
        ".ts": "text/typescript", ".js": "text/javascript", ".py": "text/x-python",
        ".sh": "text/x-shellscript", ".log": "text/plain", ".yaml": "application/x-yaml",
        ".yml": "application/x-yaml", ".xml": "application/xml", ".sql": "application/sql",
        ".css": "text/css", ".rs": "text/x-rust", ".go": "text/x-go",
      };
      const mimeType = mimeMap[ext] || "application/octet-stream";
      const url = `/api/files?path=${encodeURIComponent(resolved)}`;

      const rows = await sql`
        insert into ticket_attachments (ticket_id, name, url, mime_type, size, path)
        values (${ticketId}, ${fileName}, ${url}, ${mimeType}, ${fileSize}, ${resolved})
        returning *
      `;
      await sql`update tickets set attachments_count = coalesce((select count(*) from ticket_attachments where ticket_id=${ticketId}), 0), updated_at=now() where id=${ticketId}`;
      return ok({ attachment: rows[0] });
    }

    if (action === "deleteAttachment") {
      const attachmentId = String(body.attachmentId || "");
      const rows = await sql`delete from ticket_attachments where id=${attachmentId} returning ticket_id`;
      const ticketId = rows[0]?.ticket_id;
      if (ticketId) {
        await sql`update tickets set attachments_count = coalesce((select count(*) from ticket_attachments where ticket_id=${ticketId}), 0), updated_at=now() where id=${ticketId}`;
      }
      return ok();
    }

    if (action === "listTicketSubtasks") {
      const ticketId = String(body.ticketId || "");
      const rows = await sql`select * from ticket_subtasks where ticket_id=${ticketId} order by position asc, created_at asc`;
      return ok({ rows });
    }

    if (action === "createSubtask") {
      const ticketId = String(body.ticketId || "");
      const title = String(body.title || "").trim();
      if (!ticketId || !title) return fail("Ticket and title are required.");
      const posRows = await sql`select coalesce(max(position), -1) + 1 as pos from ticket_subtasks where ticket_id=${ticketId}`;
      const rows = await sql`insert into ticket_subtasks (ticket_id, title, position) values (${ticketId}, ${title}, ${Number(posRows[0]?.pos ?? 0)}) returning *`;
      return ok({ subtask: rows[0] });
    }

    if (action === "updateSubtask") {
      const subtaskId = String(body.subtaskId || "");
      const rows = await sql`update ticket_subtasks set title=coalesce(${body.title || null}, title), completed=coalesce(${body.completed ?? null}, completed), updated_at=now() where id=${subtaskId} returning *`;
      return ok({ subtask: rows[0] });
    }

    if (action === "deleteSubtask") {
      const subtaskId = String(body.subtaskId || "");
      await sql`delete from ticket_subtasks where id=${subtaskId}`;
      return ok();
    }

    if (action === "listTicketComments") {
      const ticketId = String(body.ticketId || "");
      const rows = await sql`select * from ticket_comments where ticket_id=${ticketId} order by created_at asc`;
      return ok({ rows });
    }

    if (action === "createComment") {
      const ticketId = String(body.ticketId || "");
      const content = String(body.content || "").trim();
      if (!ticketId || !content) return fail("Ticket and content are required.");
      const rows = await sql`insert into ticket_comments (ticket_id, author_name, content) values (${ticketId}, 'Operator', ${content}) returning *`;
      await sql`update tickets set comments_count = coalesce((select count(*) from ticket_comments where ticket_id=${ticketId}), 0), updated_at=now() where id=${ticketId}`;
      return ok({ comment: rows[0] });
    }

    if (action === "deleteComment") {
      const commentId = String(body.commentId || "");
      const rows = await sql`delete from ticket_comments where id=${commentId} returning ticket_id`;
      const ticketId = rows[0]?.ticket_id;
      if (ticketId) {
        await sql`update tickets set comments_count = coalesce((select count(*) from ticket_comments where ticket_id=${ticketId}), 0), updated_at=now() where id=${ticketId}`;
      }
      return ok();
    }

    if (action === "listTicketActivity") {
      const ticketId = String(body.ticketId || "");
      const rows = await sql`select * from ticket_activity where ticket_id=${ticketId} order by occurred_at desc`;
      return ok({ rows });
    }

    if (action === "listBoardActivity") {
      const boardId = String(body.boardId || "");
      const limit = Math.min(Math.max(Number(body.limit || 15), 1), 100);
      if (!boardId) return fail("Board id is required.");
      const rows = await sql`
        select
          ta.id,
          ta.ticket_id,
          ta.source,
          ta.event,
          ta.details,
          ta.level,
          ta.occurred_at,
          t.title as ticket_title
        from ticket_activity ta
        join tickets t on t.id = ta.ticket_id
        where t.board_id = ${boardId}
        order by ta.occurred_at desc
        limit ${limit}
      `;

      // Deterministic UTC formatting (no locale)
      const pad = (n: number) => String(n).padStart(2, "0");
      const formatDT = (dateStr: string | null) => {
        if (!dateStr) return "";
        try {
          const d = new Date(dateStr);
          const y = d.getUTCFullYear();
          const mo = pad(d.getUTCMonth() + 1);
          const day = pad(d.getUTCDate());
          const h = pad(d.getUTCHours());
          const min = pad(d.getUTCMinutes());
          return `${mo}/${day}/${y}, ${h}:${min} UTC`;
        } catch {
          return "";
        }
      };

      const formattedRows = rows.map(r => ({
        ...r,
        occurred_at_formatted: formatDT(r.occurred_at),
      }));
      return ok({ rows: formattedRows });
    }

    if (action === "createActivity") {
      const ticketId = String(body.ticketId || "");
      const event = String(body.event || "").trim();
      if (!ticketId || !event) return fail("Ticket and event are required.");
      const rows = await sql`
        insert into ticket_activity (ticket_id, source, event, details, level)
        values (${ticketId}, ${String(body.source || 'Tasks')}, ${event}, ${String(body.details || '')}, ${String(body.level || 'info')})
        returning *
      `;
      const inserted = rows[0];
      if (inserted?.id) {
        await sql`select pg_notify('ticket_activity', ${inserted.id})`;
      }
      return ok({ activity: rows[0] });
    }

    if (action === "getWorkerSettings") {
      const workerSettings = await getWorkerSettings(sql);
      return ok({ workerSettings });
    }

    if (action === "updateWorkerSettings") {
      const enabled = body.enabled === undefined ? null : Boolean(body.enabled);
      const pollIntervalSeconds = body.pollIntervalSeconds === undefined ? null : Number(body.pollIntervalSeconds);
      const maxConcurrency = body.maxConcurrency === undefined ? null : Number(body.maxConcurrency);
      const agendaConcurrency = body.agendaConcurrency === undefined ? null : Number(body.agendaConcurrency);
      const defaultExecutionWindowMinutes = body.defaultExecutionWindowMinutes === undefined ? null : Number(body.defaultExecutionWindowMinutes);
      const autoRetryAfterMinutes = body.autoRetryAfterMinutes === undefined ? null : Number(body.autoRetryAfterMinutes);
      const maxRetries = body.maxRetries === undefined ? null : Number(body.maxRetries);
      const defaultFallbackModel = body.defaultFallbackModel === undefined ? null : String(body.defaultFallbackModel || "");
      const sidebarActivityCount = body.sidebarActivityCount === undefined ? null : Number(body.sidebarActivityCount);
      const instanceName = body.instanceName === undefined ? null : String(body.instanceName || "").trim();

      if (pollIntervalSeconds !== null && (!Number.isFinite(pollIntervalSeconds) || pollIntervalSeconds < 5 || pollIntervalSeconds > 300)) {
        return fail("pollIntervalSeconds must be between 5 and 300");
      }
      if (maxConcurrency !== null && (!Number.isFinite(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 20)) {
        return fail("maxConcurrency must be between 1 and 20");
      }
      if (agendaConcurrency !== null && (!Number.isFinite(agendaConcurrency) || agendaConcurrency < 1 || agendaConcurrency > 10)) {
        return fail("agendaConcurrency must be between 1 and 10");
      }
      if (defaultExecutionWindowMinutes !== null && (!Number.isFinite(defaultExecutionWindowMinutes) || defaultExecutionWindowMinutes < 1 || defaultExecutionWindowMinutes > 1440)) {
        return fail("defaultExecutionWindowMinutes must be between 1 and 1440");
      }
      if (autoRetryAfterMinutes !== null && (!Number.isFinite(autoRetryAfterMinutes) || autoRetryAfterMinutes < 0 || autoRetryAfterMinutes > 1440)) {
        return fail("autoRetryAfterMinutes must be between 0 and 1440");
      }
      if (maxRetries !== null && (!Number.isFinite(maxRetries) || maxRetries < 0 || maxRetries > 5)) {
        return fail("maxRetries must be between 0 and 5");
      }
      if (sidebarActivityCount !== null && (!Number.isFinite(sidebarActivityCount) || sidebarActivityCount < 1 || sidebarActivityCount > 30)) {
        return fail("sidebarActivityCount must be between 1 and 30");
      }
      if (instanceName !== null && instanceName.length > 80) {
        return fail("instanceName must be 80 characters or less");
      }

      const hasSidebarActivityCount = await hasTableColumn(sql, "worker_settings", "sidebar_activity_count");

      if (hasSidebarActivityCount) {
        await sql`
          insert into worker_settings (id, enabled, poll_interval_seconds, max_concurrency, agenda_concurrency, default_execution_window_minutes, auto_retry_after_minutes, max_retries, default_fallback_model, sidebar_activity_count, instance_name)
          values (1, coalesce(${enabled}, true), coalesce(${pollIntervalSeconds}, 20), coalesce(${maxConcurrency}, 3), coalesce(${agendaConcurrency}, 5), coalesce(${defaultExecutionWindowMinutes}, 30), coalesce(${autoRetryAfterMinutes}, 0), coalesce(${maxRetries}, 1), coalesce(${defaultFallbackModel}, ''), coalesce(${sidebarActivityCount}, 8), coalesce(nullif(${instanceName}, ''), 'Mission Control'))
          on conflict (id) do update
            set enabled = coalesce(${enabled}, worker_settings.enabled),
                poll_interval_seconds = coalesce(${pollIntervalSeconds}, worker_settings.poll_interval_seconds),
                max_concurrency = coalesce(${maxConcurrency}, worker_settings.max_concurrency),
                agenda_concurrency = coalesce(${agendaConcurrency}, worker_settings.agenda_concurrency),
                default_execution_window_minutes = coalesce(${defaultExecutionWindowMinutes}, worker_settings.default_execution_window_minutes),
                auto_retry_after_minutes = coalesce(${autoRetryAfterMinutes}, worker_settings.auto_retry_after_minutes),
                max_retries = coalesce(${maxRetries}, worker_settings.max_retries),
                default_fallback_model = coalesce(${defaultFallbackModel}, worker_settings.default_fallback_model),
                sidebar_activity_count = coalesce(${sidebarActivityCount}, worker_settings.sidebar_activity_count),
                instance_name = coalesce(nullif(${instanceName}, ''), worker_settings.instance_name),
                updated_at = now()
        `;
      } else {
        await sql`
          insert into worker_settings (id, enabled, poll_interval_seconds, max_concurrency, agenda_concurrency, default_execution_window_minutes, auto_retry_after_minutes, max_retries, default_fallback_model, instance_name)
          values (1, coalesce(${enabled}, true), coalesce(${pollIntervalSeconds}, 20), coalesce(${maxConcurrency}, 3), coalesce(${agendaConcurrency}, 5), coalesce(${defaultExecutionWindowMinutes}, 30), coalesce(${autoRetryAfterMinutes}, 0), coalesce(${maxRetries}, 1), coalesce(${defaultFallbackModel}, ''), coalesce(nullif(${instanceName}, ''), 'Mission Control'))
          on conflict (id) do update
            set enabled = coalesce(${enabled}, worker_settings.enabled),
                poll_interval_seconds = coalesce(${pollIntervalSeconds}, worker_settings.poll_interval_seconds),
                max_concurrency = coalesce(${maxConcurrency}, worker_settings.max_concurrency),
                agenda_concurrency = coalesce(${agendaConcurrency}, worker_settings.agenda_concurrency),
                default_execution_window_minutes = coalesce(${defaultExecutionWindowMinutes}, worker_settings.default_execution_window_minutes),
                auto_retry_after_minutes = coalesce(${autoRetryAfterMinutes}, worker_settings.auto_retry_after_minutes),
                max_retries = coalesce(${maxRetries}, worker_settings.max_retries),
                default_fallback_model = coalesce(${defaultFallbackModel}, worker_settings.default_fallback_model),
                instance_name = coalesce(nullif(${instanceName}, ''), worker_settings.instance_name),
                updated_at = now()
        `;
      }

      const workerSettings = await getWorkerSettings(sql);
      await logTaskAudit(sql, wid, {
        event: "Worker settings updated",
        details: `enabled=${workerSettings.enabled}, interval=${workerSettings.pollIntervalSeconds}s, concurrency=${workerSettings.maxConcurrency}`,
        level: "info",
      });
      return ok({ workerSettings });
    }

    if (action === "listFailedTickets") {
      const rows = await sql`
        SELECT t.*, b.name as board_name,
          (SELECT ta.details FROM ticket_activity ta
           WHERE ta.ticket_id = t.id AND ta.event = 'Failed'
           ORDER BY ta.occurred_at DESC LIMIT 1) as last_error
        FROM tickets t
        JOIN boards b ON b.id = t.board_id
        WHERE t.workspace_id = ${wid}
          AND t.execution_state IN ('failed', 'needs_retry', 'expired')
        ORDER BY t.updated_at DESC
      `;
      return ok({ tickets: rows });
    }

    return fail(`Unsupported action: ${action}`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Task operation failed", 500);
  }
}
