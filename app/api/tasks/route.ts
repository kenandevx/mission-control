import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";

/* eslint-disable @typescript-eslint/no-explicit-any -- action-based route with validated body fields */
type Json = Record<string, any>;

const ok = (data: Json = {}) => NextResponse.json({ ok: true, ...data });
const fail = (message: string, status = 400) => NextResponse.json({ ok: false, error: message }, { status });

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

async function getWorkerSettings(sql: ReturnType<typeof getSql>) {
  const rows = await sql`
    select enabled, poll_interval_seconds, max_concurrency, last_tick_at
    from worker_settings
    where id = 1
    limit 1
  `;
  const row = rows[0] || { enabled: true, poll_interval_seconds: 20, max_concurrency: 3, last_tick_at: null };
  return {
    enabled: Boolean(row.enabled),
    pollIntervalSeconds: Number(row.poll_interval_seconds || 20),
    maxConcurrency: Number(row.max_concurrency || 3),
    lastTickAt: row.last_tick_at ? String(row.last_tick_at) : null,
  };
}

function formatDateUTC(dateStr: string | null) {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    // Use UTC to avoid timezone/locale mismatches between server/client
    return d.toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

function formatDateTimeUTC(dateStr: string | null) {
  if (!dateStr) return "No tasks yet";
  try {
    const d = new Date(dateStr);
    return d.toLocaleString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  } catch {
    return "—";
  }
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
      const processVersionIds = Array.isArray(body.processVersionIds) ? body.processVersionIds.map(String) : [];

      const rows = await sql`
        insert into tickets (
          workspace_id, board_id, column_id, title, description, priority, due_date,
          tags, assignee_ids, assigned_agent_id, execution_mode, plan_text, plan_approved, scheduled_for, execution_state,
          checklist_done, checklist_total, comments_count, attachments_count, position, telegram_chat_id, process_version_ids
        ) values (
          ${wid}, ${boardId}, ${columnId}, ${title}, ${String(body.description || "")}, ${String(body.priority || "low")}, ${body.dueDate || null},
          ${sql.array(tags)}, ${sql.array(assigneeIds)}, ${String(body.assignedAgentId || "")}, ${String(body.executionMode || "direct")}, ${String(body.planText || "")}, ${Boolean(body.planApproved)}, ${body.scheduledFor || null}, ${String(body.executionState || "open")},
          ${Number(body.checklistDone || 0)}, ${Number(body.checklistTotal || 0)}, ${Number(body.commentsCount || 0)}, ${Number(body.attachmentsCount || 0)}, ${position}, ${body.telegramChatId || null}, ${sql.array(processVersionIds)}::uuid[]
        )
        returning *
      `;
      const created = rows[0];
      if (created?.id) {
        await logTaskAudit(sql, wid, { event: 'Ticket created', details: created.title || title, level: 'success', ticketId: created.id });
        // Only notify if already queued (e.g. plan-approved ticket being re-created)
        if (created.execution_state === 'queued' || created.execution_state === 'ready_to_execute') {
          await sql`select pg_notify('ticket_ready', ${created.id}::text)`;
        }
      }
      return ok({ ticket: created });
    }

    if (action === "updateTicket") {
      const ticketId = String(body.ticketId || "");
      if (!ticketId) return fail("Ticket id is required.");
      const tags = Array.isArray(body.tags) ? body.tags.map(String) : [];
      const assigneeIds = Array.isArray(body.assigneeIds) ? body.assigneeIds.map(String) : [];
      const processVersionIds = Array.isArray(body.processVersionIds) ? body.processVersionIds.map(String) : [];

      const beforeRows = await sql`select * from tickets where id=${ticketId} limit 1`;
      const before = beforeRows[0];
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
          assigned_agent_id = coalesce(${body.assignedAgentId || null}, assigned_agent_id),
          process_version_ids = case when ${body.processVersionIds === undefined} then process_version_ids else ${sql.array(processVersionIds)}::uuid[] end,
          execution_mode = coalesce(${body.executionMode || null}, execution_mode),
          plan_text = case when ${body.planText === undefined} then plan_text else ${body.planText ?? null} end,
          plan_approved = coalesce(${body.planApproved ?? null}, plan_approved),
          approved_by = case when ${body.planApproved === true} then 'operator' else approved_by end,
          approved_at = case when ${body.planApproved === true} then now() else approved_at end,
          scheduled_for = case when ${body.scheduledFor === undefined} then scheduled_for else ${body.scheduledFor ?? null} end,
          execution_state = coalesce(${body.executionState || null}, execution_state),
          checklist_done = coalesce(${body.checklistDone ?? null}, checklist_done),
          checklist_total = coalesce(${body.checklistTotal ?? null}, checklist_total),
          comments_count = coalesce(${body.commentsCount ?? null}, comments_count),
          attachments_count = coalesce(${body.attachmentsCount ?? null}, attachments_count),
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
          await logTaskAudit(sql, wid, {
            event: 'Moved column',
            details: 'Column changed.',
            level: 'info',
            ticketId: updated.id,
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
      await logTaskAudit(sql, wid, { event: 'Ticket deleted', details: ticketId, level: 'warning' });
      return ok();
    }

    if (action === "approvePlan") {
      const ticketId = String(body.ticketId || "");
      const actorId = String(body.actorId || "operator");
      if (!ticketId) return fail("Ticket id is required.");

      const updatedRows = await sql`
        update tickets
        set approval_state = 'approved',
            execution_state = 'queued',
            plan_approved = true,
            approved_at = now(),
            approved_by = ${actorId},
            updated_at = now()
        where id = ${ticketId}
          and approval_state = 'pending'
        returning *
      `;
      const updated = updatedRows[0];
      if (!updated) return fail("Plan not in pending state or ticket not found.", 404);

      await logTaskAudit(sql, wid, {
        event: 'Plan approved',
        details: `Approved by ${actorId}`,
        level: 'success',
        ticketId: updated.id,
      });

      // Notify worker
      await sql`select pg_notify('ticket_ready', ${ticketId}::text)`;

      return ok({ ticket: updated });
    }

    if (action === "rejectPlan") {
      const ticketId = String(body.ticketId || "");
      if (!ticketId) return fail("Ticket id is required.");

      const updatedRows = await sql`
        update tickets
        set approval_state = 'rejected',
            execution_state = 'draft',
            updated_at = now()
        where id = ${ticketId}
          and approval_state = 'pending'
        returning *
      `;
      const updated = updatedRows[0];
      if (!updated) return fail("Plan not in pending state or ticket not found.", 404);

      await logTaskAudit(sql, wid, {
        event: 'Plan rejected',
        details: `Rejected by operator`,
        level: 'warning',
        ticketId: updated.id,
      });

      return ok({ ticket: updated });
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
      await logTaskAudit(sql, wid, { event: 'Moved ticket', details: 'Moved to a new column.', level: 'info', ticketId });

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

      if (pollIntervalSeconds !== null && (!Number.isFinite(pollIntervalSeconds) || pollIntervalSeconds < 5 || pollIntervalSeconds > 300)) {
        return fail("pollIntervalSeconds must be between 5 and 300");
      }
      if (maxConcurrency !== null && (!Number.isFinite(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 20)) {
        return fail("maxConcurrency must be between 1 and 20");
      }

      await sql`
        insert into worker_settings (id, enabled, poll_interval_seconds, max_concurrency)
        values (1, coalesce(${enabled}, true), coalesce(${pollIntervalSeconds}, 20), coalesce(${maxConcurrency}, 3))
        on conflict (id) do update
          set enabled = coalesce(${enabled}, worker_settings.enabled),
              poll_interval_seconds = coalesce(${pollIntervalSeconds}, worker_settings.poll_interval_seconds),
              max_concurrency = coalesce(${maxConcurrency}, worker_settings.max_concurrency),
              updated_at = now()
      `;

      const workerSettings = await getWorkerSettings(sql);
      await logTaskAudit(sql, wid, {
        event: "Worker settings updated",
        details: `enabled=${workerSettings.enabled}, interval=${workerSettings.pollIntervalSeconds}s, concurrency=${workerSettings.maxConcurrency}`,
        level: "info",
      });
      return ok({ workerSettings });
    }

    if (action === "listProcesses") {
      const rows = await sql`
        select p.id, p.name, p.description, pv.id as version_id, pv.version_number
        from processes p
        left join process_versions pv on pv.process_id = p.id
        where p.workspace_id = ${wid}
        order by p.name, pv.version_number
      `;
      return ok({ rows });
    }

    if (action === "startExecution") {
      const ticketId = String(body.ticketId || "");
      if (!ticketId) return fail("Ticket id is required.");

      const rows = await sql`select * from tickets where id=${ticketId} limit 1`;
      const ticket = rows[0];
      if (!ticket) return fail("Ticket not found.", 404);
      if (!ticket.assigned_agent_id) return fail("No agent assigned to this ticket.");

      await sql`update tickets set execution_state='queued', updated_at=now() where id=${ticketId}`;
      await sql`select pg_notify('ticket_ready', ${ticketId}::text)`;
      await logTaskAudit(sql, wid, { event: 'Execution started', details: `Queued for agent ${ticket.assigned_agent_id}`, level: 'info', ticketId });

      const updated = await sql`select * from tickets where id=${ticketId} limit 1`;
      return ok({ ticket: updated[0] });
    }

    if (action === "retryExecution") {
      const ticketId = String(body.ticketId || "");
      if (!ticketId) return fail("Ticket id is required.");

      const rows = await sql`select * from tickets where id=${ticketId} limit 1`;
      const ticket = rows[0];
      if (!ticket) return fail("Ticket not found.", 404);
      if (!ticket.assigned_agent_id) return fail("No agent assigned to this ticket.");

      await sql`update tickets set execution_state='queued', updated_at=now() where id=${ticketId}`;
      await sql`select pg_notify('ticket_ready', ${ticketId}::text)`;
      await logTaskAudit(sql, wid, { event: 'Retry requested', details: `Re-queued for agent ${ticket.assigned_agent_id}`, level: 'warning', ticketId });

      const updated = await sql`select * from tickets where id=${ticketId} limit 1`;
      return ok({ ticket: updated[0] });
    }

    return fail(`Unsupported action: ${action}`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Task operation failed", 500);
  }
}
