import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";
import { Queue } from "bullmq";
import { cleanupRunArtifacts, getRunArtifactDir } from "@/scripts/runtime-artifacts.mjs";

type Json = Record<string, unknown>;

const ok = (data: Json = {}): NextResponse => NextResponse.json({ ok: true, ...data });
const fail = (message: string, status = 400): NextResponse =>
  NextResponse.json({ ok: false, error: message }, { status });

async function workspaceId(sql: ReturnType<typeof getSql>): Promise<string | null> {
  const rows = await sql`select id from workspaces order by created_at asc limit 1`;
  return rows[0]?.id ?? null;
}

const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; occurrenceId: string }> },
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const body = (await request.json()) as Json;
    const action = String(body.action || "");

    const { id: eventId, occurrenceId } = await params;
    const wid = await workspaceId(sql);
    if (!wid) return fail("Workspace not found", 500);

    // ── Test-only: directly set an occurrence to needs_retry ─────────────────
    // Used by automated tests to create a needs_retry occurrence without
    // needing to trigger the full failure/cleanup cycle.
    if (action === "testOnlySetNeedsRetry") {
      const [occ] = await sql`
        select ao.id from agenda_occurrences ao
        join agenda_events ae on ae.id = ao.agenda_event_id
        where ao.id = ${occurrenceId} and ae.workspace_id = ${wid}
        limit 1
      `;
      if (!occ) return fail("Occurrence not found.", 404);

      await sql`
        update agenda_occurrences
        set status = 'needs_retry', locked_at = null
        where id = ${occurrenceId}
      `;
      await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "test_needs_retry", occurrenceId })})`;
      return ok({ occurrenceId, status: "needs_retry" });
    }

    // ── Test-only: directly set an occurrence to running ─────────────────────
    // Used by automated tests to simulate a running occurrence without needing
    // the full scheduler + worker pipeline.
    if (action === "testOnlySetRunning") {
      const [occ] = await sql`
        select ao.id from agenda_occurrences ao
        join agenda_events ae on ae.id = ao.agenda_event_id
        where ao.id = ${occurrenceId} and ae.workspace_id = ${wid}
        limit 1
      `;
      if (!occ) return fail("Occurrence not found.", 404);

      await sql`
        update agenda_occurrences
        set status = 'running', locked_at = now()
        where id = ${occurrenceId}
      `;
      await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "test_running", occurrenceId })})`;
      return ok({ occurrenceId, status: "running" });
    }

    // ── Standard retry ─────────────────────────────────────────────────────
    const [occurrence] = await sql`
      select ao.*, ae.workspace_id, ae.title, ae.free_prompt, ae.default_agent_id,
             ae.timezone, ae.execution_window_minutes, ae.fallback_model
      from agenda_occurrences ao
      join agenda_events ae on ae.id = ao.agenda_event_id
      where ao.id = ${occurrenceId} and ae.workspace_id = ${wid}
      limit 1
    `;
    if (!occurrence) return fail("Occurrence not found.", 404);

    const forceRetry = body.force === true;

    // Allow retry from needs_retry, failed, or running by default.
    // Succeeded/cancelled/completed states require explicit force=true because this is a re-execution.
    const retryableStatuses = forceRetry
      ? ["needs_retry", "failed", "running", "queued", "scheduled", "succeeded", "cancelled"]
      : ["needs_retry", "failed", "running", "queued", "scheduled"];
    if (!retryableStatuses.includes(occurrence.status)) {
      return fail(
        occurrence.status === "succeeded"
          ? "This occurrence already executed successfully. Use Force Retry to clean up and run it again."
          : `Cannot retry occurrence with status "${occurrence.status}"`,
        400,
      );
    }

    // If force-retrying a running occurrence, mark current attempt as failed.
    if (occurrence.status === "running") {
      await sql`
        update agenda_run_attempts
        set status = 'failed', finished_at = now(), summary = 'Force retried by user while running', error_message = 'Force retried by user while running'
        where occurrence_id = ${occurrenceId} and status = 'running'
      `;
    }

    // If force-retrying a previously completed occurrence, best-effort clean up prior run artifacts
    // and annotate the previous attempt so downstream debugging is clear.
    if (forceRetry && ["succeeded", "cancelled"].includes(occurrence.status)) {
      const [latestAttempt] = await sql`
        select id, attempt_no
        from agenda_run_attempts
        where occurrence_id = ${occurrenceId}
        order by attempt_no desc
        limit 1
      `;
      if (latestAttempt?.id) {
        const artifactDir = getRunArtifactDir({
          kind: "agenda",
          entityId: eventId,
          occurrenceId,
          runId: latestAttempt.id,
        });
        await cleanupRunArtifacts(artifactDir);
        await sql`
          update agenda_run_attempts
          set summary = coalesce(summary, 'Previously executed occurrence force-retried by user'),
              error_message = coalesce(error_message, 'Previously executed occurrence force-retried by user')
          where id = ${latestAttempt.id}
        `;
      }
    }

    // Get the actual max attempt number so the next run gets the right number
    const [maxAttempt] = await sql`
      select coalesce(max(attempt_no), 0) as max_no
      from agenda_run_attempts
      where occurrence_id = ${occurrenceId}
    `;

    // Reset status to scheduled, move scheduled_for to NOW so the retry runs fresh
    // (preserveScheduledFor: true keeps original date — used by tests for execution window checks)
    const preserveDate = body.preserveScheduledFor === true;
    const retryNow = preserveDate ? new Date(occurrence.scheduled_for) : new Date();
    if (!preserveDate) {
      await sql`
        update agenda_occurrences
        set status = 'scheduled', locked_at = null, latest_attempt_no = ${maxAttempt.max_no},
            scheduled_for = ${retryNow}, retry_requested_at = now(), last_retry_reason = 'Manual retry requested by user'
        where id = ${occurrenceId}
      `;
    } else {
      await sql`
        update agenda_occurrences
        set status = 'scheduled', locked_at = null, latest_attempt_no = ${maxAttempt.max_no}, retry_requested_at = now(), last_retry_reason = 'Manual retry requested by user'
        where id = ${occurrenceId}
      `;
    }

    // Get attached processes
    const processes = await sql`
      select aep.process_version_id, aep.sort_order
      from agenda_event_processes aep
      where aep.agenda_event_id = ${eventId}
      order by aep.sort_order asc
    `;

    // Enqueue directly to BullMQ for immediate execution.
    // Preserve oldest-first ordering across retryable occurrences with a BullMQ-safe
    // bounded priority (smaller = older = higher priority).
    const scheduledDate = new Date(occurrence.scheduled_for);
    const ageSec = Math.max(0, Math.floor((Date.now() - scheduledDate.getTime()) / 1000));
    const priority = Math.max(1, 2097152 - Math.min(ageSec, 2097151));

    try {
      const queueJobId = `agenda-${occurrenceId}-${Date.now()}`;
      const agendaQueue = new Queue("agenda", {
        connection: { host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD },
      });

      await agendaQueue.add(
        "run-occurrence",
        {
          occurrenceId,
          eventId,
          title: occurrence.title,
          freePrompt: occurrence.free_prompt,
          agentId: occurrence.default_agent_id,
          timezone: occurrence.timezone,
          processes: processes.map((p: Record<string, unknown>) => ({
            process_version_id: p.process_version_id,
            sort_order: p.sort_order,
          })),
          scheduledFor: retryNow.toISOString(),
          executionWindowMinutes: body.executionWindowMinutes != null
            ? Number(body.executionWindowMinutes)
            : 999, // Default: don't expire on manual retry
          fallbackModel: occurrence.fallback_model || "",
        },
        {
          jobId: queueJobId,
          removeOnComplete: false,
          priority,
        }
      );

      await sql`
        update agenda_occurrences
        set status = 'queued', queue_job_id = ${queueJobId}, queued_at = now()
        where id = ${occurrenceId} and status = 'scheduled'
      `;

      await agendaQueue.close();
    } catch (err) {
      // If BullMQ enqueue fails, the scheduler will pick it up next cycle
      console.warn("[occurrence-retry] BullMQ enqueue failed:", err);
    }

    await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: forceRetry ? "force_retry" : "retry" })})`;
    return ok({ occurrenceId, status: "scheduled", forced: forceRetry });
  } catch (err) {
    console.error("[occurrence-retry] Error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return fail(`Failed to retry occurrence: ${msg}`, 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; occurrenceId: string }> },
): Promise<NextResponse> {
  try {
    const sql = getSql();
    const { occurrenceId } = await params;
    const wid = await workspaceId(sql);
    if (!wid) return fail("Workspace not found", 500);

    const [occurrence] = await sql`
      select ao.id from agenda_occurrences ao
      join agenda_events ae on ae.id = ao.agenda_event_id
      where ao.id = ${occurrenceId} and ae.workspace_id = ${wid}
      limit 1
    `;
    if (!occurrence) return fail("Occurrence not found.", 404);

    // Mark as cancelled (dismiss from failed list)
    await sql`
      update agenda_occurrences set status = 'cancelled' where id = ${occurrenceId}
    `;

    await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "dismiss" })})`;
    return ok({ occurrenceId, status: "cancelled" });
  } catch {
    return fail("Failed to dismiss occurrence", 500);
  }
}
