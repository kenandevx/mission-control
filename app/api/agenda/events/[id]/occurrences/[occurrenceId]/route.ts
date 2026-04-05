import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cleanupRunArtifacts, getRunArtifactDir } from "@/scripts/runtime-artifacts.mjs";
import { FORCE_RETRYABLE_STATUSES, RETRYABLE_STATUSES, OCCURRENCE_STATUSES } from "@/lib/agenda/constants";
import { buildCleanEnv } from "@/scripts/openclaw-config.mjs";
import { renderPromptForOccurrence } from "@/lib/agenda/render-prompt";

const execFileAsync = promisify(execFile);

type Json = Record<string, unknown>;

const ok = (data: Json = {}): NextResponse => NextResponse.json({ ok: true, ...data });
const fail = (message: string, status = 400): NextResponse =>
  NextResponse.json({ ok: false, error: message }, { status });

async function workspaceId(sql: ReturnType<typeof getSql>): Promise<string | null> {
  const rows = await sql`select id from workspaces order by created_at asc limit 1`;
  return rows[0]?.id ?? null;
}

/** Best-effort delete of an existing cron job before replacing it with a fresh retry job. */
async function removeCronJob(cronJobId: string): Promise<void> {
  const env = buildCleanEnv();
  await execFileAsync("openclaw", ["cron", "remove", cronJobId], {
    timeout: 15000,
    env,
    maxBuffer: 1024 * 1024,
  });
}

/** Create a new one-shot cron job for a manual retry */
async function createRetryCronJob(params: {
  title: string;
  message: string;
  agentId: string;
  model?: string;
  sessionTarget?: string;
}): Promise<string | null> {
  const target = params.sessionTarget === "main" ? "main" : "isolated";
  const isMain = target === "main";
  const args = [
    "cron", "add",
    "--name", `MC retry: ${params.title}`,
    "--at", "30s",
    "--session", target,
    // Main session requires --system-event; isolated sessions use --message.
    isMain ? "--system-event" : "--message",
    params.message,
    "--agent", params.agentId || "main",
    "--delete-after-run",
    ...(isMain ? [] : ["--no-deliver"]),
    "--json",
  ];
  if (params.model?.trim()) args.push("--model", params.model.trim());

  const env = buildCleanEnv();
  const result = await execFileAsync("openclaw", args, {
    timeout: 20000, env, maxBuffer: 5 * 1024 * 1024,
  });
  const raw = (result.stdout || "").trim() || (result.stderr || "").trim();
  const parsed = raw ? JSON.parse(raw) : null;
  return parsed?.id || null;
}

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

    // ── Test-only helpers ─────────────────────────────────────────────────────
    if (action === "testOnlySetNeedsRetry") {
      const [occ] = await sql`
        select ao.id from agenda_occurrences ao
        join agenda_events ae on ae.id = ao.agenda_event_id
        where ao.id = ${occurrenceId} and ae.workspace_id = ${wid} limit 1
      `;
      if (!occ) return fail("Occurrence not found.", 404);
      await sql`update agenda_occurrences set status = 'needs_retry', locked_at = null where id = ${occurrenceId}`;
      await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "test_needs_retry", occurrenceId })})`;
      return ok({ occurrenceId, status: "needs_retry" });
    }

    if (action === "testOnlySetRunning") {
      const [occ] = await sql`
        select ao.id from agenda_occurrences ao
        join agenda_events ae on ae.id = ao.agenda_event_id
        where ao.id = ${occurrenceId} and ae.workspace_id = ${wid} limit 1
      `;
      if (!occ) return fail("Occurrence not found.", 404);
      await sql`update agenda_occurrences set status = 'running', locked_at = now() where id = ${occurrenceId}`;
      await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "test_running", occurrenceId })})`;
      return ok({ occurrenceId, status: "running" });
    }

    if (action === "testOnlySetFailed") {
      // For integration tests: simulate terminal failure (fallback also exhausted).
      // Sets status='failed', fallback_attempted=true, locked_at=NULL.
      const [occ] = await sql`
        select ao.id from agenda_occurrences ao
        join agenda_events ae on ae.id = ao.agenda_event_id
        where ao.id = ${occurrenceId} and ae.workspace_id = ${wid} limit 1
      `;
      if (!occ) return fail("Occurrence not found.", 404);
      await sql`
        update agenda_occurrences
        set status = 'failed', locked_at = null, fallback_attempted = true,
            last_retry_reason = 'FALLBACK_EXHAUSTED: test-only'
        where id = ${occurrenceId}
      `;
      await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "failed", occurrenceId })})`;
      return ok({ occurrenceId, status: "failed" });
    }

    // ── Standard / force retry ────────────────────────────────────────────────
    const [occurrence] = await sql`
      select ao.id, ao.status, ao.cron_job_id, ao.rendered_prompt,
             ao.latest_attempt_no, ao.fallback_attempted,
             ae.workspace_id, ae.title, ae.free_prompt, ae.default_agent_id,
             ae.fallback_model, ae.model_override, ae.session_target
      from agenda_occurrences ao
      join agenda_events ae on ae.id = ao.agenda_event_id
      where ao.id = ${occurrenceId} and ae.workspace_id = ${wid}
      limit 1
    `;
    if (!occurrence) return fail("Occurrence not found.", 404);

    const forceRetry = body.force === true;
    const retryableStatuses: readonly string[] = forceRetry ? FORCE_RETRYABLE_STATUSES : RETRYABLE_STATUSES;
    if (!retryableStatuses.includes(occurrence.status as string)) {
      return fail(
        occurrence.status === "succeeded"
          ? "This occurrence already executed successfully. Use Force Retry to run it again."
          : `Cannot retry occurrence with status "${occurrence.status}"`,
        400,
      );
    }

    // Clean up prior artifacts on force retry of a completed occurrence
    if (forceRetry && ["succeeded", "cancelled"].includes(occurrence.status as string)) {
      const [latestAttempt] = await sql`
        select id from agenda_run_attempts
        where occurrence_id = ${occurrenceId}
        order by attempt_no desc limit 1
      `;
      if (latestAttempt?.id) {
        const artifactDir = getRunArtifactDir({
          kind: "agenda",
          entityId: eventId,
          occurrenceId,
          runId: latestAttempt.id as string,
        });
        await cleanupRunArtifacts(artifactDir);
      }
    }

    const existingCronJobId = occurrence.cron_job_id as string | null;

    const sessionTarget = (occurrence.session_target as string) || "isolated";
    // Main-session agenda runs do not reliably honor per-event model pinning.
    // Ignore override model there so runtime behavior matches stored config/UI.
    const overrideModel = sessionTarget === "main"
      ? undefined
      : ((body.model as string | undefined) || (occurrence.model_override as string) || undefined);

    // Step 1: always replace retry cron jobs with a freshly rendered one.
    // Re-using an existing cron job can preserve stale rendered_prompt text, old
    // marker formats, and outdated model/session behavior.
    if (existingCronJobId) {
      try {
        await removeCronJob(existingCronJobId);
      } catch (err) {
        console.warn(`[occurrence-retry] removeCronJob failed for ${existingCronJobId}; continuing with fresh job:`, (err as Error).message);
      }
    }

    let cronJobId: string | null = null;
    // Always re-render on manual retry so old occurrences pick up current
    // marker format and prompt logic instead of reusing stale rendered_prompt text.
    let retryMessage: string;
    try {
      retryMessage = await renderPromptForOccurrence(
        sql,
        { id: eventId, title: occurrence.title as string, free_prompt: occurrence.free_prompt as string | null },
        occurrenceId,
      );
      // Persist the freshly-rendered prompt so subsequent retries also use the latest version.
      await sql`UPDATE agenda_occurrences SET rendered_prompt = ${retryMessage} WHERE id = ${occurrenceId}`;
    } catch (renderErr) {
      console.warn(`[occurrence-retry] Re-render failed, falling back to stored prompt:`, (renderErr as Error).message);
      retryMessage = (occurrence.rendered_prompt as string | null)
        || `${occurrence.title}. ${occurrence.free_prompt || ""}`.trim();
    }

    try {
      cronJobId = await createRetryCronJob({
        title: occurrence.title as string,
        message: retryMessage,
        agentId: (occurrence.default_agent_id as string) || "main",
        model: overrideModel,
        sessionTarget,
      });
    } catch (err) {
      console.error(`[occurrence-retry] Failed to create retry cron job for ${occurrenceId}:`, err);
      return fail(`Failed to create retry cron job: ${(err as Error).message}`, 500);
    }

    if (!cronJobId) {
      return fail("Cron job creation returned no ID — check gateway logs.", 500);
    }

    // Step 2: atomically update the occurrence to queued with the cron job ID.
    // Use a WHERE guard so we never overwrite a status that changed underneath us.
    const guardStatuses: string[] = [...(forceRetry ? FORCE_RETRYABLE_STATUSES : RETRYABLE_STATUSES)];
    const updated = await sql`
      update agenda_occurrences
      set status = 'queued',
          cron_job_id = ${cronJobId},
          locked_at = null,
          retry_requested_at = now(),
          last_retry_reason = 'MANUAL_RETRY',
          fallback_attempted = false
      where id = ${occurrenceId}
        and status = any(${sql.array(guardStatuses)})
      returning id
    `;

    if (updated.length === 0) {
      // Status changed between our read and write — tell the client so they can refresh
      return fail("Occurrence status changed before retry could be applied — please refresh.", 409);
    }

    await sql`select pg_notify('agenda_change', ${JSON.stringify({
      action: forceRetry ? "force_retry" : "retry",
      occurrenceId,
    })})`;

    return ok({ occurrenceId, status: OCCURRENCE_STATUSES.QUEUED, forced: forceRetry });
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
      where ao.id = ${occurrenceId} and ae.workspace_id = ${wid} limit 1
    `;
    if (!occurrence) return fail("Occurrence not found.", 404);

    await sql`
      update agenda_occurrences
      set status = 'cancelled'
      where id = ${occurrenceId}
        and status not in ('running')
    `;
    await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "dismiss", occurrenceId })})`;
    return ok({ occurrenceId, status: "cancelled" });
  } catch (err) {
    console.error("[occurrence-dismiss] Error:", err);
    return fail("Failed to dismiss occurrence", 500);
  }
}
