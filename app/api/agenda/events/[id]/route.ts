import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";
import { Queue } from "bullmq";
import { DateTime } from "luxon";

type Json = Record<string, unknown>;

/**
 * Parse a datetime string from the client.
 * Accepts two formats:
 * 1. Local time (no Z/offset): "2026-04-01T18:50:00" — converted to UTC using the given timezone
 * 2. UTC time (with Z): "2026-04-01T16:50:00.000Z" — parsed directly (backward compat)
 */
function parseClientDateTime(value: string, timezone: string): Date | null {
  if (!value) return null;
  const str = String(value);
  if (/Z$|[+-]\d{2}:\d{2}$/.test(str)) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }
  const [datePart, timePart] = str.split("T");
  if (!datePart || !timePart) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }
  const [hour, minute] = timePart.slice(0, 5).split(":").map(Number);
  const [year, month, day] = datePart.split("-").map(Number);
  const dt = DateTime.fromObject(
    { year, month, day, hour, minute, second: 0, millisecond: 0 },
    { zone: timezone }
  );
  return dt.toUTC().toJSDate();
}

const ok = (data: Json = {}) => NextResponse.json({ ok: true, ...data });
const fail = (message: string, status = 400) =>
  NextResponse.json({ ok: false, error: message }, { status });

const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

/** Remove all BullMQ jobs related to an event's occurrences. */
async function removeQueuedJobs(sql: ReturnType<typeof getSql>, eventId: string) {
  try {
    const occurrences = await sql`
      SELECT id FROM agenda_occurrences WHERE agenda_event_id = ${eventId}
    `;
    if (!occurrences.length) return;

    const queue = new Queue("agenda", {
      connection: { host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD },
    });

    // Get all jobs in waiting, delayed, and active states
    const jobs = [
      ...await queue.getJobs(["waiting", "delayed", "active", "failed"], 0, 500),
    ];

    const occIds = new Set(occurrences.map((o) => String(o.id)));
    for (const job of jobs) {
      if (job?.data?.occurrenceId && occIds.has(String(job.data.occurrenceId))) {
        try { await job.remove(); } catch { /* already processing or removed */ }
      }
    }

    await queue.close();
  } catch (err) {
    console.warn("[event-delete] Failed to clean BullMQ jobs:", err);
  }
}

async function workspaceId(sql: ReturnType<typeof getSql>) {
  const rows = await sql`select id from workspaces order by created_at asc limit 1`;
  return rows[0]?.id ?? null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const sql = getSql();
    const { id } = await params;
    const wid = await workspaceId(sql);
    if (!wid) return fail("Workspace not found", 500);

    const [event] = await sql`
      select ae.*
      from agenda_events ae
      where ae.id = ${id} and ae.workspace_id = ${wid}
      limit 1
    `;

    if (!event) return fail("Event not found.", 404);

    const processes = await sql`
      select aep.*, p.name as process_name, pv.version_number
      from agenda_event_processes aep
      join process_versions pv on pv.id = aep.process_version_id
      join processes p on p.id = pv.process_id
      where aep.agenda_event_id = ${id}
      order by aep.sort_order asc
    `;

    const occurrences = await sql`
      select ao.*,
        (
          select json_agg(ara.* order by ara.attempt_no asc)
          from agenda_run_attempts ara
          where ara.occurrence_id = ao.id
        ) as attempts
      from agenda_occurrences ao
      where ao.agenda_event_id = ${id}
      order by ao.scheduled_for desc
      limit 50
    `;

    return ok({ event, processes, occurrences });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to load event", 500);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const sql = getSql();
    const { id } = await params;
    const body = (await request.json()) as Json;
    const wid = await workspaceId(sql);
    if (!wid) return fail("Workspace not found", 500);

    const [existing] = await sql`
      select * from agenda_events where id = ${id} and workspace_id = ${wid} limit 1
    `;
    if (!existing) return fail("Event not found.", 404);

    // ── Check for running occurrences ──────────────────────────────────────────
    const editScope = body.editScope as string | undefined;
    const occurrenceId = body.occurrenceId as string | undefined;

    const [runningOcc] = await sql`
      SELECT id FROM agenda_occurrences
      WHERE agenda_event_id = ${id} AND status = 'running'
      LIMIT 1
    `;
    if (runningOcc) {
      // For single-occurrence edits, only block if that specific occurrence is running
      if (editScope === "single" && occurrenceId) {
        const [thisRunning] = await sql`
          SELECT id FROM agenda_occurrences
          WHERE id = ${occurrenceId} AND status = 'running'
          LIMIT 1
        `;
        if (thisRunning) {
          return fail("Cannot edit event while executing", 409);
        }
      } else {
        return fail("Cannot edit event while executing", 409);
      }
    }

    // ── Recurring edit scope handling ──────────────────────────────────────────

    if (editScope === "single" && occurrenceId) {
      // Create/update an occurrence override for just this one instance
      const overriddenTitle = body.title !== undefined ? String(body.title).trim() : null;
      const overriddenFreePrompt = body.freePrompt !== undefined ? (body.freePrompt ? String(body.freePrompt) : null) : null;
      const overriddenAgentId = body.agentId !== undefined ? (body.agentId && body.agentId !== 'null' ? String(body.agentId) : null) : null;
      const overrideTimezone = body.timezone !== undefined ? String(body.timezone) : (existing.timezone || "Europe/Amsterdam");
      const overriddenStartsAt = body.startsAt !== undefined
        ? (body.startsAt ? parseClientDateTime(String(body.startsAt), overrideTimezone) : null)
        : null;
      // Upsert override
      const [existingOverride] = await sql`
        select id from agenda_occurrence_overrides
        where occurrence_id = ${occurrenceId}
        limit 1
      `;

      if (existingOverride) {
        await sql`
          update agenda_occurrence_overrides set
            overridden_title = coalesce(${overriddenTitle}, overridden_title),
            overridden_free_prompt = coalesce(${overriddenFreePrompt}, overridden_free_prompt),
            overridden_agent_id = coalesce(${overriddenAgentId}, overridden_agent_id),
            overridden_starts_at = coalesce(${overriddenStartsAt}, overridden_starts_at),
            updated_at = now()
          where id = ${existingOverride.id}
        `;
      } else {
        await sql`
          insert into agenda_occurrence_overrides
            (occurrence_id, overridden_title, overridden_free_prompt, overridden_agent_id, overridden_starts_at)
          values (${occurrenceId}, ${overriddenTitle}, ${overriddenFreePrompt}, ${overriddenAgentId}, ${overriddenStartsAt})
        `;
      }

      await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "update" })})`;
      return ok({ eventId: id, scope: "single", occurrenceId });
    }

    if (editScope === "this_and_future" && occurrenceId) {
      // Split series: end existing series at the occurrence before this one,
      // create a new series starting from this occurrence's date.
      const [occurrence] = await sql`
        select scheduled_for from agenda_occurrences where id = ${occurrenceId} limit 1
      `;
      if (!occurrence) return fail("Occurrence not found.", 404);

      const splitDate = new Date(occurrence.scheduled_for);

      // Update existing series to end just before the split date
      await sql`
        update agenda_events set
          recurrence_until = ${splitDate.toISOString()},
          updated_at = now()
        where id = ${id}
      `;

      // Create new series from the split date with the updated fields
      const title = body.title !== undefined ? String(body.title).trim() : existing.title;
      const freePrompt = body.freePrompt !== undefined ? (body.freePrompt ? String(body.freePrompt) : null) : existing.free_prompt;
      const agentId = body.agentId !== undefined ? (body.agentId && body.agentId !== 'null' ? String(body.agentId) : null) : existing.default_agent_id;
      const timezone = body.timezone !== undefined ? String(body.timezone) : existing.timezone;
      const startsAt = body.startsAt !== undefined
        ? parseClientDateTime(String(body.startsAt), timezone)
        : existing.starts_at;
      const endsAt = body.endsAt !== undefined
        ? (body.endsAt ? parseClientDateTime(String(body.endsAt), timezone) : null)
        : existing.ends_at;
      const recurrenceRule = body.recurrenceRule !== undefined
        ? (body.recurrenceRule && body.recurrenceRule !== "null" && body.recurrenceRule !== "none" ? String(body.recurrenceRule) : null)
        : existing.recurrence_rule;
      const recurrenceUntil = body.recurrenceUntil !== undefined
        ? (body.recurrenceUntil ? new Date(String(body.recurrenceUntil)) : null)
        : existing.recurrence_until;
      const status = body.status !== undefined ? String(body.status) : existing.status;
      const modelOverrideFuture = body.modelOverride !== undefined ? String(body.modelOverride ?? "") : (existing.model_override ?? "");
      const processVersionIds: string[] = Array.isArray(body.processVersionIds)
        ? body.processVersionIds.map(String)
        : [];

      const [newEvent] = await sql`
        insert into agenda_events (
          workspace_id, title, free_prompt, default_agent_id,
          timezone, starts_at, ends_at, recurrence_rule, recurrence_until, status, model_override, created_by
        ) values (
          ${wid}, ${title}, ${freePrompt}, ${agentId},
          ${timezone}, ${startsAt}, ${endsAt}, ${recurrenceRule}, ${recurrenceUntil}, ${status}, ${modelOverrideFuture}, ${existing.created_by}
        )
        returning *
      `;

      if (processVersionIds.length > 0) {
        for (let i = 0; i < processVersionIds.length; i++) {
          await sql`
            insert into agenda_event_processes (agenda_event_id, process_version_id, sort_order)
            values (${newEvent.id}, ${processVersionIds[i]}, ${i})
          `;
        }
      }

      await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "update" })})`;
      return ok({ eventId: id, newEventId: newEvent.id, scope: "this_and_future" });
    }

    // ── Standard full-event update ─────────────────────────────────────────────
    const title = body.title !== undefined ? String(body.title).trim() : existing.title;
    const freePrompt = body.freePrompt !== undefined ? (body.freePrompt ? String(body.freePrompt) : null) : existing.free_prompt;
    const agentId = body.agentId !== undefined ? (body.agentId && body.agentId !== 'null' ? String(body.agentId) : null) : existing.default_agent_id;
    const timezone = body.timezone !== undefined ? String(body.timezone) : existing.timezone;
    const startsAt = body.startsAt !== undefined ? parseClientDateTime(String(body.startsAt), timezone) ?? existing.starts_at : existing.starts_at;
    const endsAt = body.endsAt !== undefined ? (body.endsAt ? parseClientDateTime(String(body.endsAt), timezone) : null) : existing.ends_at;
    const recurrenceRule = body.recurrenceRule !== undefined ? (body.recurrenceRule && body.recurrenceRule !== "null" && body.recurrenceRule !== "none" ? String(body.recurrenceRule) : null) : existing.recurrence_rule;
    const recurrenceUntil = body.recurrenceUntil !== undefined
      ? (body.recurrenceUntil ? new Date(String(body.recurrenceUntil)) : null)
      : existing.recurrence_until;
    const status = body.status !== undefined ? String(body.status) : existing.status;
    const modelOverrideStd = body.modelOverride !== undefined ? String(body.modelOverride ?? "") : (existing.model_override ?? "");

    // Guard: cannot revert to draft if event has any non-idle occurrences
    if (status === "draft" && existing.status !== "draft") {
      const [hasOcc] = await sql`
        SELECT 1 FROM agenda_occurrences
        WHERE agenda_event_id = ${id}
          AND status IN ('running', 'succeeded', 'needs_retry', 'failed', 'scheduled')
        LIMIT 1
      `;
      if (hasOcc) return fail("Cannot set event back to draft — it has existing occurrences.", 409);
    }

    if (!title) return fail("Title is required.");
    if (!startsAt || isNaN(new Date(startsAt).getTime())) return fail("Valid start date is required.");
    // 5-minute grace period for wizard completion time.
    // If within grace window, bump to now so the scheduler executes immediately.
    const PAST_GRACE_MS = 5 * 60 * 1000;
    const nowMs = Date.now();
    let effectiveStartsAt = startsAt;
    let bumpedToNow = false;
    const startsAtMs = new Date(startsAt).getTime();
    if (startsAtMs < nowMs - PAST_GRACE_MS) return fail("Cannot schedule events in the past.");
    if (startsAtMs < nowMs) {
      // Within grace window — bump to now so it executes immediately
      effectiveStartsAt = new Date();
      bumpedToNow = true;
    }

    // Resolve scheduling interval: body override (dev/test) → DB setting → default 15
    const timeStepMinutes = await (async () => {
      if (body.timeStepMinutes !== undefined) return Math.max(0, Math.floor(Number(body.timeStepMinutes)));
      const [ws] = await sql`SELECT scheduling_interval_minutes FROM worker_settings WHERE id = 1 LIMIT 1`;
      return Number(ws?.scheduling_interval_minutes ?? 15);
    })();

    if (timeStepMinutes > 0) {
      if (new Date(startsAt).getMinutes() % timeStepMinutes !== 0) {
        return fail(`Events can only be scheduled at ${timeStepMinutes}-minute intervals.`);
      }

      const slotStart = new Date(startsAt);
      slotStart.setSeconds(0, 0);
      const slotEnd = new Date(slotStart.getTime() + timeStepMinutes * 60 * 1000);
      const [conflict] = await sql`
        SELECT id, title FROM agenda_events
        WHERE workspace_id = ${wid}
          AND id <> ${id}
          AND status IN ('active', 'draft')
          AND starts_at >= ${slotStart}
          AND starts_at < ${slotEnd}
        LIMIT 1
      `;
      if (conflict) {
        return fail(`Time slot already taken by "${conflict.title}". Events must be at least ${timeStepMinutes} minutes apart.`);
      }
    }

    await sql`
      update agenda_events set
        title = ${title},
        free_prompt = ${freePrompt},
        default_agent_id = ${agentId},
        timezone = ${timezone},
        starts_at = ${effectiveStartsAt},
        ends_at = ${endsAt},
        recurrence_rule = ${recurrenceRule},
        recurrence_until = ${recurrenceUntil},
        status = ${status},
        model_override = ${modelOverrideStd},
        updated_at = now()
      where id = ${id}
    `;

    // If a one-time active event is edited into the past, mark it needs_retry immediately.
    let autoNeedsRetry = false;
    const autoNeedsRetryReason = "Start time is already in the past for an active one-time event; occurrence was auto-marked as needs_retry.";
    if (status === "active" && !recurrenceRule && !bumpedToNow && new Date(effectiveStartsAt) < new Date()) {
      const [occurrence] = await sql`
        insert into agenda_occurrences (agenda_event_id, scheduled_for, status)
        values (${id}, ${effectiveStartsAt}, 'needs_retry')
        on conflict (agenda_event_id, scheduled_for) do update
          set status = 'needs_retry'
        returning id
      `;
      await sql`
        insert into agenda_run_attempts (occurrence_id, attempt_no, status, started_at, finished_at, summary, error_message)
        values (${occurrence.id}, 1, 'failed', now(), now(), ${autoNeedsRetryReason}, ${autoNeedsRetryReason})
        on conflict do nothing
      `;
      await sql`
        update agenda_occurrences set latest_attempt_no = 1 where id = ${occurrence.id}
      `;
      autoNeedsRetry = true;
    }

    // Update process attachments if provided
    if (body.processVersionIds !== undefined) {
      const pvids: string[] = (body.processVersionIds as string[]).map(String);
      await sql`delete from agenda_event_processes where agenda_event_id = ${id}`;
      for (let i = 0; i < pvids.length; i++) {
        await sql`
          insert into agenda_event_processes (agenda_event_id, process_version_id, sort_order)
          values (${id}, ${pvids[i]}, ${i})
        `;
      }
    }

    await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "update" })})`;
    return ok({
      eventId: id,
      autoNeedsRetry,
      warning: autoNeedsRetry ? autoNeedsRetryReason : null,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to update event", 500);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const sql = getSql();
    const { id } = await params;
    const wid = await workspaceId(sql);
    if (!wid) return fail("Workspace not found", 500);

    const [existing] = await sql`
      select id, recurrence_rule from agenda_events where id = ${id} and workspace_id = ${wid} limit 1
    `;
    if (!existing) return fail("Event not found.", 404);

    const hardDelete = new URL(request.url).searchParams.get("hard") === "1";
    if (hardDelete) {
      await removeQueuedJobs(sql, id);
      // Release any agent execution locks held by this event's occurrences
      await sql`
        DELETE FROM agent_execution_locks
        WHERE occurrence_id IN (SELECT ao.id FROM agenda_occurrences ao WHERE ao.agenda_event_id = ${id})
      `;
      await sql`delete from agenda_events where id = ${id}`;
      await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "delete" })})`;
      return ok({ hardDeleted: true });
    }

    const isRecurring = existing.recurrence_rule && existing.recurrence_rule !== "null" && existing.recurrence_rule !== "none";

    if (isRecurring) {
      // Cancel all future occurrences, keep past ones for history
      await sql`
        UPDATE agenda_occurrences SET status = 'cancelled'
        WHERE agenda_event_id = ${id} AND scheduled_for > now()
          AND status IN ('scheduled', 'queued', 'needs_retry')
      `;
      // Delete future occurrences that never ran
      await sql`
        DELETE FROM agenda_occurrences
        WHERE agenda_event_id = ${id} AND scheduled_for > now()
          AND status = 'cancelled' AND latest_attempt_no = 0
      `;
      // Deactivate the event so scheduler stops creating new occurrences
      await sql`UPDATE agenda_events SET status = 'draft', recurrence_until = now(), updated_at = now() WHERE id = ${id}`;
    } else {
      // Non-recurring: delete entirely (cascades to occurrences, attempts, steps)
      await removeQueuedJobs(sql, id);
      await sql`
        DELETE FROM agent_execution_locks
        WHERE occurrence_id IN (SELECT ao.id FROM agenda_occurrences ao WHERE ao.agenda_event_id = ${id})
      `;
      await sql`delete from agenda_events where id = ${id}`;
    }

    await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "delete" })})`;
    return ok();
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to delete event", 500);
  }
}
