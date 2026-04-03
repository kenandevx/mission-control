import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cleanupRunArtifacts, getRunArtifactDir } from "@/scripts/runtime-artifacts.mjs";
import { FORCE_RETRYABLE_STATUSES, RETRYABLE_STATUSES, OCCURRENCE_STATUSES } from "@/lib/agenda/constants";

const execFileAsync = promisify(execFile);

type Json = Record<string, unknown>;

const ok = (data: Json = {}): NextResponse => NextResponse.json({ ok: true, ...data });
const fail = (message: string, status = 400): NextResponse =>
  NextResponse.json({ ok: false, error: message }, { status });

async function workspaceId(sql: ReturnType<typeof getSql>): Promise<string | null> {
  const rows = await sql`select id from workspaces order by created_at asc limit 1`;
  return rows[0]?.id ?? null;
}

/** Build clean env — no gateway override vars */
function buildCleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env } as NodeJS.ProcessEnv;
  delete env.OPENCLAW_GATEWAY_URL;
  delete env.OPENCLAW_GATEWAY_TOKEN;
  return env;
}

/** Force-run a cron job immediately */
async function runCronJobNow(cronJobId: string): Promise<void> {
  const env = buildCleanEnv();
  await execFileAsync("openclaw", ["cron", "run", cronJobId], {
    timeout: 15000,
    env,
    maxBuffer: 1024 * 1024,
  });
}

/** Create a new one-shot cron job for a retry with optional model override */
async function createRetryCronJob(params: {
  title: string;
  message: string;
  agentId: string;
  model?: string;
  chatId?: string;
}): Promise<string | null> {
  const args = [
    "cron", "add",
    "--name", `MC retry: ${params.title}`,
    "--at", "30s",
    "--session", "isolated",
    "--message", params.message,
    "--agent", params.agentId || "main",
    "--best-effort-deliver",
    "--keep-after-run",
    "--json",
  ];
  if (params.model?.trim()) args.push("--model", params.model.trim());
  if (params.chatId) args.push("--announce", "--channel", "telegram", "--to", params.chatId);

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

    // ── Standard retry ────────────────────────────────────────────────────────
    const [occurrence] = await sql`
      select ao.*, ae.workspace_id, ae.title, ae.free_prompt, ae.default_agent_id,
             ae.timezone, ae.fallback_model, ae.model_override
      from agenda_occurrences ao
      join agenda_events ae on ae.id = ao.agenda_event_id
      where ao.id = ${occurrenceId} and ae.workspace_id = ${wid}
      limit 1
    `;
    if (!occurrence) return fail("Occurrence not found.", 404);

    // Get the Telegram chat ID for delivery
    const sessionsPath = `${process.env.HOME || '/home/clawdbot'}/.openclaw/agents/main/sessions/sessions.json`;
    let chatId: string | undefined;
    try {
      const { readFile } = await import("node:fs/promises");
      const sessData = JSON.parse(await readFile(sessionsPath, "utf-8")) as Record<string, { deliveryContext?: { channel?: string; to?: string } }>;
      for (const val of Object.values(sessData)) {
        if (val?.deliveryContext?.channel === "telegram" && val?.deliveryContext?.to) {
          chatId = String(val.deliveryContext.to).replace(/^telegram:/, "");
          break;
        }
      }
    } catch { /* no chat ID available */ }

    const forceRetry = body.force === true;
    const retryableStatuses = forceRetry ? FORCE_RETRYABLE_STATUSES : RETRYABLE_STATUSES;
    if (!retryableStatuses.includes(occurrence.status)) {
      return fail(
        occurrence.status === "succeeded"
          ? "This occurrence already executed successfully. Use Force Retry to run it again."
          : `Cannot retry occurrence with status "${occurrence.status}"`,
        400,
      );
    }

    // Clean up prior artifacts on force retry
    if (forceRetry && ["succeeded", "cancelled"].includes(occurrence.status)) {
      const [latestAttempt] = await sql`
        select id from agenda_run_attempts
        where occurrence_id = ${occurrenceId}
        order by attempt_no desc limit 1
      `;
      if (latestAttempt?.id) {
        const artifactDir = getRunArtifactDir({ kind: "agenda", entityId: eventId, occurrenceId, runId: latestAttempt.id });
        await cleanupRunArtifacts(artifactDir);
      }
    }

    const existingCronJobId = occurrence.cron_job_id as string | null;

    if (existingCronJobId) {
      // Re-run the existing cron job immediately
      try {
        await runCronJobNow(existingCronJobId);
      } catch (err) {
        console.warn(`[occurrence-retry] cron run failed for ${existingCronJobId}:`, err);
        // If the cron job no longer exists, we'll create a new one below
      }
    } else {
      // No existing cron job — create a new one-shot retry job
      // We need the rendered prompt, which the scheduler has already stored as the cron job message.
      // For now, build a simple re-run request. The scheduler will pick it up if cron creation fails.
      const overrideModel = (body.model as string) || (occurrence.model_override as string) || null;

      try {
        // Use stored rendered_prompt (includes process steps) if available,
        // otherwise fall back to free_prompt only
        const retryMessage = (occurrence.rendered_prompt as string | null)
          || `${occurrence.title}. ${occurrence.free_prompt || ""}`.trim();
        const newCronJobId = await createRetryCronJob({
          title: occurrence.title as string,
          message: retryMessage,
          agentId: (occurrence.default_agent_id as string) || "main",
          model: overrideModel || undefined,
          chatId,
        });

        if (newCronJobId) {
          await sql`
            update agenda_occurrences
            set cron_job_id = ${newCronJobId}, fallback_attempted = false
            where id = ${occurrenceId}
          `;
        }
      } catch (err) {
        console.warn(`[occurrence-retry] Failed to create retry cron job:`, err);
      }
    }

    // Reset occurrence status to queued
    await sql`
      update agenda_occurrences
      set status = 'queued', locked_at = null,
          retry_requested_at = now(),
          last_retry_reason = 'MANUAL_RETRY',
          fallback_attempted = false
      where id = ${occurrenceId}
    `;

    await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: forceRetry ? "force_retry" : "retry", occurrenceId })})`;
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

    await sql`update agenda_occurrences set status = 'cancelled' where id = ${occurrenceId}`;
    await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "dismiss" })})`;
    return ok({ occurrenceId, status: "cancelled" });
  } catch {
    return fail("Failed to dismiss occurrence", 500);
  }
}
