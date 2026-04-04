#!/usr/bin/env node
/**
 * Agenda Scheduler v3 — cron-based execution engine.
 *
 * Responsibilities (this process only):
 *   1. For each active event, expand RRULE over next 48h → create occurrences
 *   2. For each upcoming occurrence without a cron job → render prompt → openclaw cron add --at
 *   3. Listen for pg_notify('agenda_change') for scheduleFallback signals from bridge-logger
 *      and create a new cron job with the fallback model.
 *
 * Result sync (succeeded/failed/needs_retry) is handled entirely by bridge-logger,
 * which watches ~/.openclaw/cron/runs/*.jsonl and writes to DB directly.
 * No polling. No shared state. No race conditions.
 */
import postgres from "postgres";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { assertAgendaSchema } from "./agenda-schema-check.mjs";
import { renderUnifiedTaskMessage } from "./prompt-renderer.mjs";
import { getRunArtifactDir } from "./runtime-artifacts.mjs";
import { buildCleanEnv, getOpenClawHome } from "./openclaw-config.mjs";
import {
  transitionOccurrenceToQueued,
  transitionOccurrenceToNeedsRetry,
  transitionStaleRunningToNeedsRetry,
} from "./agenda-domain.mjs";

const execFileAsync = promisify(execFile);

const connectionString = process.env.DATABASE_URL?.trim() || process.env.OPENCLAW_DATABASE_URL?.trim();
if (!connectionString) {
  console.error("[agenda-scheduler] Missing DATABASE_URL / OPENCLAW_DATABASE_URL");
  process.exit(1);
}

const OPENCLAW_HOME = getOpenClawHome();
const SERVICE_NAME = "agenda-scheduler";
const LOOKAHEAD_DAYS = parseInt(process.env.AGENDA_LOOKAHEAD_DAYS || "14", 10);

const sql = postgres(connectionString, { max: 5, prepare: false, idle_timeout: 20, connect_timeout: 10 });

// ── Service heartbeat ─────────────────────────────────────────────────────────
async function writeHeartbeat(status = "running", lastError = null) {
  try {
    await sql`
      INSERT INTO service_health (name, status, pid, last_heartbeat_at, last_error, started_at, updated_at)
      VALUES (${SERVICE_NAME}, ${status}, ${process.pid}, now(), ${lastError}, now(), now())
      ON CONFLICT (name) DO UPDATE SET
        status = ${status}, pid = ${process.pid}, last_heartbeat_at = now(),
        last_error = COALESCE(${lastError}, service_health.last_error), updated_at = now()
    `;
  } catch (err) {
    console.warn("[agenda-scheduler] Heartbeat write failed:", err.message);
  }
}

// ── OpenClaw cron helpers ─────────────────────────────────────────────────────

/** Run openclaw cron command, return parsed JSON output */
async function cronCmd(args, timeoutMs = 15000) {
  const env = buildCleanEnv();
  const result = await execFileAsync("openclaw", ["cron", ...args], {
    timeout: timeoutMs,
    env,
    maxBuffer: 5 * 1024 * 1024,
  });
  const raw = (result.stdout || "").trim() || (result.stderr || "").trim();
  return raw ? JSON.parse(raw) : null;
}

/** Create a one-shot cron job for an occurrence. Returns the cron job ID. */
async function createCronJob({ title, message, agentId, model, scheduledFor, sessionTarget, timeoutSeconds }) {
  // If the scheduled time is already past or within 30s, schedule for 30s from now.
  // Cron rejects --at timestamps in the past with INVALID_REQUEST.
  const scheduledMs = new Date(scheduledFor).getTime();
  const msUntil = scheduledMs - Date.now();
  const atValue = msUntil > 30_000 ? new Date(scheduledFor).toISOString() : "30s";
  const target = (sessionTarget === "main" || sessionTarget === "isolated") ? sessionTarget : "isolated";
  const args = [
    "add",
    "--name", `MC: ${title}`,
    "--at", atValue,
    "--session", target,
    "--message", message,
    "--agent", agentId || "main",
    "--keep-after-run",
    "--json",
  ];
  if (model?.trim()) {
    args.push("--model", model.trim());
  }
  if (timeoutSeconds && Number.isFinite(Number(timeoutSeconds))) {
    args.push("--timeout-seconds", String(Math.max(60, Number(timeoutSeconds))));
  }
  const result = await cronCmd(args, 20000);
  return result?.id || null;
}

/** Edit an existing cron job (e.g. update message after process version change). */
async function editCronJob(cronJobId, { message, model }) {
  const args = ["edit", cronJobId, "--json"];
  if (message) args.push("--message", message);
  if (model?.trim()) args.push("--model", model.trim());
  else args.push("--model", ""); // clear model override if not set
  await cronCmd(args, 15000);
}

/** Force-run a cron job immediately (for retry). */
async function runCronJobNow(cronJobId) {
  const env = buildCleanEnv();
  await execFileAsync("openclaw", ["cron", "run", cronJobId], {
    timeout: 15000,
    env,
    maxBuffer: 1024 * 1024,
  });
}

/**
 * Returns a Set of cron job IDs that currently exist in the gateway.
 * Used to detect orphaned occurrences whose cron jobs were lost during restart.
 */
async function getLiveCronJobIds() {
  try {
    const result = await cronCmd(["list", "--json"], 10000);
    const jobs = Array.isArray(result) ? result : (result?.jobs ?? result?.data ?? []);
    return new Set(jobs.map((j) => j.id).filter(Boolean));
  } catch (err) {
    console.warn("[agenda-scheduler] Could not fetch live cron job list:", err.message);
    return null; // null = don't sweep (gateway may be overloaded; skip this cycle)
  }
}

/** Delete a cron job. */
async function deleteCronJob(cronJobId) {
  const env = buildCleanEnv();
  await execFileAsync("openclaw", ["cron", "rm", cronJobId], {
    timeout: 15000,
    env,
    maxBuffer: 1024 * 1024,
  }).catch(() => { /* already deleted is fine */ });
}


// ── RRULE expansion (unchanged from v1 — works well) ─────────────────────────
function localTimeToUTC(localDateStr, localTimeStr, timezone) {
  const targetLocal = `${localDateStr}T${localTimeStr}`;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const get = (parts) => {
    const g = (type) => parts.find((p) => p.type === type)?.value ?? "";
    return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
  };
  const base = new Date(`${localDateStr}T${localTimeStr}:00Z`);
  for (let offsetH = -12; offsetH <= 14; offsetH++) {
    const candidate = new Date(base.getTime() - offsetH * 3600000);
    const rendered = get(fmt.formatToParts(candidate));
    if (rendered === targetLocal) return candidate;
  }
  return new Date(base.getTime() - 3600000);
}

function extractLocalTime(utcDate, timezone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(utcDate);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

async function expandOccurrences(event, from, to) {
  const startDate = new Date(event.starts_at);
  const until = event.recurrence_until ? new Date(event.recurrence_until) : to;
  const rangeEnd = new Date(Math.min(to.getTime(), until.getTime()));

  if (!event.recurrence_rule || event.recurrence_rule === "null" || event.recurrence_rule === "none") {
    return startDate >= from && startDate <= to ? [startDate] : [];
  }
  try {
    const rruleMod = await import("rrule");
    const RRule = rruleMod?.RRule ?? rruleMod?.default?.RRule;
    if (!RRule) throw new Error("rrule module did not expose RRule");
    const tz = event.timezone || "UTC";
    const { time: localTime } = extractLocalTime(startDate, tz);
    const opts = RRule.parseString(event.recurrence_rule);
    opts.dtstart = startDate;
    const rule = new RRule(opts);
    const rawDates = rule.between(from, rangeEnd, true);
    const [lh, lm] = localTime.split(":").map(Number);
    const snappedMin = Math.round(lm / 15) * 15;
    const snappedH = snappedMin >= 60 ? (lh + 1) % 24 : lh;
    const snappedM = snappedMin >= 60 ? 0 : snappedMin;
    const snappedTime = `${String(snappedH).padStart(2, "0")}:${String(snappedM).padStart(2, "0")}`;
    return rawDates.map((d) => {
      const { date: occDate } = extractLocalTime(d, tz);
      return localTimeToUTC(occDate, snappedTime, tz);
    });
  } catch (err) {
    console.warn(`[agenda-scheduler] RRULE expansion failed for event=${event.id}:`, err.message);
    return startDate >= from && startDate <= to ? [startDate] : [];
  }
}

// ── Prompt rendering helper ───────────────────────────────────────────────────
async function renderPromptForEvent(event, occurrenceId) {
  // Load process steps if any
  const processes = await sql`
    select aep.process_version_id, aep.sort_order
    from agenda_event_processes aep
    where aep.agenda_event_id = ${event.id}
    order by aep.sort_order asc
  `;

  const composedSteps = [];
  let seq = 1;
  for (const proc of processes) {
    const stepRows = await sql`
      select * from process_steps
      where process_version_id = ${proc.process_version_id}
      order by step_order asc
    `;
    for (const stepRow of stepRows) {
      composedSteps.push({
        order: seq++,
        title: stepRow.title || `Step ${stepRow.step_order}`,
        instruction: String(stepRow.instruction || ""),
        skillKey: stepRow.skill_key || null,
      });
    }
  }

  // Build a stable, occurrence-scoped artifact path.
  // No random UUIDs — deterministic so the agent always writes to the same place.
  const artifactDir = getRunArtifactDir({
    kind: "agenda",
    entityId: event.id,
    occurrenceId: occurrenceId || "unknown",
    runId: "artifacts",
  });

  return renderUnifiedTaskMessage({
    title: event.title,
    instructions: composedSteps,
    request: event.free_prompt ? String(event.free_prompt) : "",
    artifactDir,
  });
}



// ── Main scheduling cycle ─────────────────────────────────────────────────────
async function runCycle() {
  const now = new Date();
  // Lookahead: from the epoch (to catch all unscheduled past occurrences) up to LOOKAHEAD_DAYS
  // The expansion window still uses a sensible from for RRULE (go back 30 days max to avoid
  // computing thousands of historical dates for high-frequency events)
  const rruleFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30d back for RRULE expansion
  const to = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

  // Load all active events
  const events = await sql`
    SELECT ae.*, w.id as workspace_id
    FROM agenda_events ae
    JOIN workspaces w ON w.id = ae.workspace_id
    WHERE ae.status = 'active'
  `;

  // ── Dead-cron-job sweep (gateway restart recovery) ──────────────────────────
  // Fetch all live cron job IDs from the gateway once per cycle.
  // Any queued/scheduled occurrence whose cron_job_id is NOT in this set
  // had its cron job lost (gateway restart, manual deletion, etc.)
  // and will be recreated below when we process it.
  const liveCronIds = await getLiveCronJobIds();
  if (liveCronIds !== null) {
    // Find queued occurrences with a cron_job_id that no longer exists in the gateway
    const orphaned = await sql`
      SELECT ao.id, ao.cron_job_id
      FROM agenda_occurrences ao
      WHERE ao.status = 'queued'
        AND ao.cron_job_id IS NOT NULL
        AND ao.scheduled_for <= ${new Date(now.getTime() + 48 * 3600_000)}
    `;
    for (const row of orphaned) {
      if (!liveCronIds.has(row.cron_job_id)) {
        // Cron job is gone — clear the ID so the loop below will recreate it
        await sql`
          UPDATE agenda_occurrences
          SET cron_job_id = NULL, status = 'scheduled'
          WHERE id = ${row.id} AND status = 'queued' AND cron_job_id = ${row.cron_job_id}
        `;
        console.warn(`[agenda-scheduler] Orphaned cron job ${row.cron_job_id} for occurrence ${row.id} — will reschedule`);
      }
    }
  }

  let scheduled = 0;

  for (const event of events) {
    try {
      const occurrences = await expandOccurrences(event, rruleFrom, to);

      // Sort oldest first so catch-up fires in chronological order
      occurrences.sort((a, b) => a.getTime() - b.getTime());

      for (const scheduledFor of occurrences) {
        // Upsert occurrence row
        await sql`
          INSERT INTO agenda_occurrences (agenda_event_id, scheduled_for, status)
          VALUES (${event.id}, ${scheduledFor}, 'scheduled')
          ON CONFLICT (agenda_event_id, scheduled_for) DO NOTHING
        `;

        const [occ] = await sql`
          SELECT id, status, cron_job_id
          FROM agenda_occurrences
          WHERE agenda_event_id = ${event.id} AND scheduled_for = ${scheduledFor}
        `;
        if (!occ) continue;

        // Skip terminal states — never re-fire completed/cancelled/failed work
        if (["succeeded", "failed", "cancelled", "needs_retry"].includes(occ.status)) continue;

        // Skip if already has a live cron job
        if (occ.cron_job_id) continue;

        // Schedule window: past occurrences (any age) get fired immediately as catch-up.
        // Future occurrences beyond 48h get their cron job created when they come closer.
        const hoursUntil = (scheduledFor.getTime() - now.getTime()) / 3600000;
        if (hoursUntil > 48) continue;
        // Note: no lower floor — hoursUntil may be negative (missed/past), these get --at 30s

        // Render the prompt with the stable, occurrence-scoped artifact path baked in.
        const message = await renderPromptForEvent(event, occ.id);

        // Persist the rendered prompt so retries always use the exact same message.
        await sql`UPDATE agenda_occurrences SET rendered_prompt = ${message} WHERE id = ${occ.id}`;

        // Log catch-up fires (past occurrences being scheduled now due to missed window)
        if (hoursUntil < -0.5) {
          const hoursAgo = Math.round(-hoursUntil * 10) / 10;
          console.warn(`[agenda-scheduler] Catch-up: occurrence ${occ.id} was scheduled ${hoursAgo}h ago — firing immediately`);
        }

        // Create the cron job — session target from event config (default: isolated)
        const cronJobId = await createCronJob({
          title: event.title,
          message,
          agentId: event.default_agent_id || "main",
          model: event.model_override || null,
          scheduledFor,
          sessionTarget: event.session_target || "isolated",
          timeoutSeconds: null,
        });

        if (!cronJobId) {
          console.warn(`[agenda-scheduler] Failed to create cron job for occurrence ${occ.id} — marking needs_retry`);
          await transitionOccurrenceToNeedsRetry(sql, {
            occurrenceId: occ.id,
            reasonCode: "PROVIDER_REJECTED",
            reasonText: "Cron job creation failed — check gateway logs",
          });
          await sql`
            INSERT INTO agenda_run_attempts
              (occurrence_id, attempt_no, status, started_at, finished_at, summary, error_message)
            VALUES
              (${occ.id}, 1, 'failed', now(), now(),
               'Failed to create cron job', 'Cron job creation failed — check gateway logs')
            ON CONFLICT DO NOTHING
          `;
          await sql`SELECT pg_notify('agenda_change', ${JSON.stringify({ action: "needs_retry", occurrenceId: occ.id })})`;
          continue;
        }

        // Atomically mark queued with the cron job ID
        await transitionOccurrenceToQueued(sql, {
          occurrenceId: occ.id,
          cronJobId,
        });

        scheduled++;
        console.log(`[agenda-scheduler] Scheduled occurrence ${occ.id} → cron job ${cronJobId}`);
      }
    } catch (err) {
      console.error(`[agenda-scheduler] Event processing failed for event=${event.id}:`, err.message);
    }
  }

  // ── Stale-running sweep ───────────────────────────────────────────────────────────────
  // Occurrences stuck in 'running' past their event’s execution_window_minutes are
  // timed out and sent to needs_retry so the user can investigate.
  // Per-event window is respected — a 2-hour report task won’t be killed at 15 min.
  try {
    const stale = await transitionStaleRunningToNeedsRetry(sql, {
      reason: "WORKER_STALLED: execution exceeded event window — check agent logs",
      defaultMinutes: 60,
    });
    if (stale.length > 0) {
      for (const row of stale) {
        const windowLabel = row.execution_window_minutes ? `${row.execution_window_minutes}min` : "60min (default)";
        console.warn(`[agenda-scheduler] Stale occurrence ${row.id} ("${row.title}") exceeded ${windowLabel} window → needs_retry`);
        await sql`SELECT pg_notify('agenda_change', ${JSON.stringify({ action: "needs_retry", occurrenceId: row.id })})`;
      }
    }
  } catch (err) {
    console.warn("[agenda-scheduler] Stale-running sweep failed (non-fatal):", err.message);
  }

  console.log(`[agenda-scheduler] Cycle complete — ${events.length} events, ${scheduled} new cron jobs created`);
}

// ── Startup ───────────────────────────────────────────────────────────────────
try {
  await assertAgendaSchema(sql);
  console.log("[agenda-scheduler] Schema assertion passed");
} catch (err) {
  console.error("[agenda-scheduler] Schema assertion failed:", err?.message || err);
  process.exit(1);
}

await writeHeartbeat("running");
const heartbeatInterval = setInterval(() => writeHeartbeat("running"), 30_000);

let runInProgress = false;
async function tick() {
  if (runInProgress) {
    console.warn("[agenda-scheduler] Previous cycle still running, skipping tick");
    return;
  }
  runInProgress = true;
  try {
    await runCycle();
    await writeHeartbeat("running", null);
  } catch (err) {
    console.error("[agenda-scheduler] Cycle failed:", err.message);
    await writeHeartbeat("degraded", err.message);
  } finally {
    runInProgress = false;
  }
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[agenda-scheduler] Shutting down...");
  clearInterval(heartbeatInterval);
  await writeHeartbeat("stopped").catch(() => {});
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
process.on("unhandledRejection", (reason) => console.error("[agenda-scheduler] Unhandled rejection:", reason));
process.on("uncaughtException", (err) => console.error("[agenda-scheduler] Uncaught exception:", err));

void tick();
setInterval(() => void tick(), 60_000);

// ── Fallback model listener ────────────────────────────────────────────────────────
// bridge-logger emits pg_notify('agenda_change', { action:'needs_retry', scheduleFallback:true })
// when a run fails and a fallback model is configured.
// We react here by creating a new cron job with the fallback model.
try {
  await sql.listen("agenda_change", async (payload) => {
    let data;
    try { data = JSON.parse(payload); } catch { return; }
    if (data?.action !== "needs_retry" || !data?.scheduleFallback || !data?.fallbackModel) return;

    const { occurrenceId, fallbackModel } = data;
    const [occ] = await sql`
      SELECT ao.id, ao.rendered_prompt, ae.title, ae.default_agent_id, ae.session_target, ao.scheduled_for
      FROM agenda_occurrences ao
      JOIN agenda_events ae ON ae.id = ao.agenda_event_id
      WHERE ao.id = ${occurrenceId} AND ao.status = 'needs_retry'
      LIMIT 1
    `;
    if (!occ) return;

    const message = occ.rendered_prompt || occ.title || "Run agenda task";
    let cronJobId = null;
    try {
      cronJobId = await createCronJob({
        title: `${occ.title} [fallback]`,
        message,
        agentId: occ.default_agent_id || "main",
        model: fallbackModel,
        scheduledFor: new Date(), // run immediately
        sessionTarget: occ.session_target || "isolated",
        timeoutSeconds: null,
      });
    } catch (err) {
      console.error(`[agenda-scheduler] Failed to create fallback cron job for occurrence ${occurrenceId}:`, err.message);
      return;
    }

    if (cronJobId) {
      await transitionOccurrenceToQueued(sql, {
        occurrenceId,
        cronJobId,
        reasonText: `FALLBACK_RETRY: retrying with fallback model ${fallbackModel}`,
      });
      await sql`SELECT pg_notify('agenda_change', ${JSON.stringify({ action: 'queued', occurrenceId })})`;
      console.log(`[agenda-scheduler] Fallback cron job created for occurrence ${occurrenceId} with model ${fallbackModel}`);
    }
  });
  console.log("[agenda-scheduler] Listening for fallback model signals");
} catch (err) {
  console.warn("[agenda-scheduler] Failed to set up fallback listener (non-fatal):", err.message);
}

console.log("[agenda-scheduler] Started — cron-based scheduler active");
