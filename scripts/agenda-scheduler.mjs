#!/usr/bin/env node
/**
 * Agenda Scheduler v2 — cron-based execution engine.
 *
 * What it does every 60 seconds:
 *   1. For each active event, expand RRULE over next 48h → create occurrences
 *   2. For each upcoming occurrence without a cron job → render prompt → openclaw cron add --at
 *   3. Sync cron run results back to Postgres (run history for UI)
 *   4. Detect failed cron jobs → attempt fallback model retry if configured
 *   5. Detect Qdrant memories from failed isolated sessions → clean up
 *
 * No BullMQ. No Redis. No worker process. No stdout/stderr parsing.
 * Execution lives inside the OpenClaw gateway.
 */
import postgres from "postgres";
import { execFile } from "node:child_process";
import { readFile, open } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { assertAgendaSchema } from "./agenda-schema-check.mjs";
import { renderUnifiedTaskMessage } from "./prompt-renderer.mjs";
import { getRunArtifactDir, ensureArtifactDir, cleanupRunArtifacts, scanArtifactDir } from "./runtime-artifacts.mjs";

const execFileAsync = promisify(execFile);

const connectionString = process.env.DATABASE_URL?.trim() || process.env.OPENCLAW_DATABASE_URL?.trim();
if (!connectionString) {
  console.error("[agenda-scheduler] Missing DATABASE_URL / OPENCLAW_DATABASE_URL");
  process.exit(1);
}

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || resolve(process.env.HOME || "/home/clawdbot", ".openclaw");
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

/** Build clean env for openclaw CLI calls — no gateway override vars */
function buildCleanEnv() {
  const env = { ...process.env };
  delete env.OPENCLAW_GATEWAY_URL;
  delete env.OPENCLAW_GATEWAY_TOKEN;
  return env;
}

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
async function createCronJob({ title, message, agentId, model, scheduledFor, chatId, timeoutSeconds }) {
  // If the scheduled time is already past or within 30s, run immediately.
  // Cron rejects --at timestamps in the past with INVALID_REQUEST.
  const scheduledMs = new Date(scheduledFor).getTime();
  const msUntil = scheduledMs - Date.now();
  const atValue = msUntil > 30_000 ? new Date(scheduledFor).toISOString() : "30s";
  const args = [
    "add",
    "--name", `MC: ${title}`,
    "--at", atValue,
    "--session", "isolated",
    "--message", message,
    "--agent", agentId || "main",
    "--best-effort-deliver",
    "--keep-after-run",
    "--json",
  ];
  if (model?.trim()) {
    args.push("--model", model.trim());
  }
  if (timeoutSeconds && Number.isFinite(Number(timeoutSeconds))) {
    args.push("--timeout-seconds", String(Math.max(60, Number(timeoutSeconds))));
  }
  if (chatId) {
    args.push("--announce", "--channel", "telegram", "--to", String(chatId));
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

/** Delete a cron job. */
async function deleteCronJob(cronJobId) {
  const env = buildCleanEnv();
  await execFileAsync("openclaw", ["cron", "rm", cronJobId], {
    timeout: 15000,
    env,
    maxBuffer: 1024 * 1024,
  }).catch(() => { /* already deleted is fine */ });
}

/** Get run history for a cron job. */
async function getCronRuns(cronJobId, limit = 10) {
  try {
    const env = buildCleanEnv();
    const result = await execFileAsync("openclaw", ["cron", "runs", "--id", cronJobId, "--limit", String(limit)], {
      timeout: 15000,
      env,
      maxBuffer: 5 * 1024 * 1024,
    });
    const raw = (result.stdout || "").trim() || (result.stderr || "").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

/** Fetch all cron job states at once — returns Map<jobId, state> */
async function getAllCronJobStates() {
  try {
    const env = buildCleanEnv();
    const result = await execFileAsync("openclaw", ["cron", "list", "--json"], {
      timeout: 15000,
      env,
      maxBuffer: 5 * 1024 * 1024,
    });
    const raw = (result.stdout || "").trim() || (result.stderr || "").trim();
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);
    const map = new Map();
    for (const job of (parsed?.jobs || [])) {
      map.set(job.id, job.state ?? {});
    }
    return map;
  } catch {
    return new Map();
  }
}

// ── Telegram chat ID discovery ───────────────────────────────────────────────
let _cachedChatId = null;
async function getTelegramChatId(agentId = "main") {
  if (_cachedChatId) return _cachedChatId;
  const searchPaths = [
    resolve(OPENCLAW_HOME, `agents/${agentId}/sessions/sessions.json`),
    resolve(OPENCLAW_HOME, "agents/main/sessions/sessions.json"),
  ];
  for (const sessionsPath of searchPaths) {
    try {
      const raw = await readFile(sessionsPath, "utf8");
      const data = JSON.parse(raw);
      for (const [, val] of Object.entries(data)) {
        if (val?.deliveryContext?.channel === "telegram" && val?.deliveryContext?.to) {
          _cachedChatId = String(val.deliveryContext.to).replace(/^telegram:/, "");
          return _cachedChatId;
        }
      }
    } catch { /* ignore */ }
  }
  return null;
}

// ── Telegram notification ────────────────────────────────────────────────────
async function sendTelegramNotification(message, agentId = "main") {
  try {
    const chatId = await getTelegramChatId(agentId);
    if (!chatId) return;
    const env = buildCleanEnv();
    await execFileAsync("openclaw", [
      "message", "send",
      "--channel", "telegram",
      "--target", chatId,
      "--message", message,
    ], { timeout: 30000, env });
  } catch (err) {
    console.warn("[agenda-scheduler] Telegram notification failed:", err.message);
  }
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
async function renderPromptForEvent(event) {
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

  // Build artifact dir path WITHOUT creating it.
  // It only gets created if the agent actually writes files to it.
  const artifactDir = getRunArtifactDir({
    kind: "agenda",
    entityId: event.id,
    occurrenceId: "cron",
    runId: randomUUID(),
  });

  return renderUnifiedTaskMessage({
    title: event.title,
    instructions: composedSteps,
    request: event.free_prompt ? String(event.free_prompt) : "",
    artifactDir,
  });
}

// ── Qdrant memory cleanup ────────────────────────────────────────────────────
async function parseMemoryStoreIds(sessionFilePath) {
  const ids = [];
  try {
    const raw = await readFile(sessionFilePath, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    for (const line of lines) {
      if (!line.includes("memory_store")) continue;
      const uuidRegex = /["']id["']\s*:\s*["']([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})["']/gi;
      let match;
      while ((match = uuidRegex.exec(line)) !== null) ids.push(match[1]);
    }
  } catch { /* file may not exist */ }
  return [...new Set(ids)];
}

async function deleteQdrantMemories(memoryIds) {
  if (memoryIds.length === 0) return;
  try {
    const resp = await fetch("http://localhost:6333/collections/memories/points/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: memoryIds }),
    });
    if (resp.ok) {
      console.log(`[agenda-scheduler] Deleted ${memoryIds.length} orphaned memory entries from Qdrant`);
    } else {
      console.warn(`[agenda-scheduler] Qdrant delete failed (${resp.status})`);
    }
  } catch (err) {
    console.warn(`[agenda-scheduler] Qdrant delete error:`, err.message);
  }
}

/** Clean up Qdrant memories from a failed isolated cron session. */
async function cleanupFailedCronSession(sessionId) {
  if (!sessionId) return;
  // Isolated cron sessions live under agents/main/sessions/<sessionId>.jsonl
  const sessionFilePath = resolve(OPENCLAW_HOME, `agents/main/sessions/${sessionId}.jsonl`);
  const memoryIds = await parseMemoryStoreIds(sessionFilePath);
  if (memoryIds.length > 0) {
    await deleteQdrantMemories(memoryIds);
  }
}

// ── Sync cron run results to Postgres ────────────────────────────────────────
async function syncCronRunResults() {
  // Load max_retries from worker_settings (controls fallback model threshold)
  const [settingsRow] = await sql`SELECT max_retries FROM worker_settings WHERE id = 1 LIMIT 1`;
  const maxRetries = Math.max(1, Number(settingsRow?.max_retries ?? 1));

  // Fetch all cron job states once (avoids one list call per occurrence)
  const cronJobStates = await getAllCronJobStates();

  // Find occurrences that have a cron_job_id but are still in running/queued state
  const pending = await sql`
    SELECT ao.id as occurrence_id, ao.cron_job_id, ao.agenda_event_id,
           ao.status, ao.latest_attempt_no, ao.fallback_attempted,
           ao.rendered_prompt,
           ae.title, ae.fallback_model, ae.default_agent_id
    FROM agenda_occurrences ao
    JOIN agenda_events ae ON ae.id = ao.agenda_event_id
    WHERE ao.cron_job_id IS NOT NULL
      AND ao.status IN ('queued', 'running')
    LIMIT 100
  `;

  for (const occ of pending) {
    try {
      const runs = await getCronRuns(occ.cron_job_id, 5);

      // Detect "running" state: cron has fired (nextRunAtMs is past) but hasn't finished yet.
      const jobState = cronJobStates.get(occ.cron_job_id) || {};
      const nextRunAtMs = jobState?.nextRunAtMs;
      const latestRunAtMs = runs[0]?.runAtMs || 0;
      const cronFiredButNotSynced = nextRunAtMs && Date.now() > nextRunAtMs + 10_000 && nextRunAtMs > latestRunAtMs;

      if ((runs.length === 0 || !runs[0].action) && cronFiredButNotSynced) {
        // Cron fired but no finished entry yet → running
        if (occ.status === "queued") {
          await sql`UPDATE agenda_occurrences SET status = 'running', locked_at = now() WHERE id = ${occ.occurrence_id} AND status = 'queued'`;
          await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "running", occurrenceId: occ.occurrence_id })})`;
          console.log(`[agenda-scheduler] Occurrence ${occ.occurrence_id} → running`);
        }
        continue;
      }

      if (runs.length === 0) continue;

      if (cronFiredButNotSynced && occ.status === "queued") {
        await sql`UPDATE agenda_occurrences SET status = 'running', locked_at = now() WHERE id = ${occ.occurrence_id} AND status = 'queued'`;
        await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "running", occurrenceId: occ.occurrence_id })})`;
        continue; // will sync on next cycle when finished
      }

      const latest = runs[0]; // newest first

      if (latest.action === "finished") {
        if (latest.status === "ok") {
          // Succeeded
          const attemptNo = Number(occ.latest_attempt_no || 0) + 1;
          await sql`
            UPDATE agenda_occurrences
            SET status = 'succeeded', latest_attempt_no = ${attemptNo},
                locked_at = null, cron_synced_at = now()
            WHERE id = ${occ.occurrence_id} AND status IN ('queued', 'running')
          `;
          const [insertedAttempt] = await sql`
            INSERT INTO agenda_run_attempts
              (occurrence_id, attempt_no, queue_job_id, status, started_at, finished_at, summary)
            VALUES
              (${occ.occurrence_id}, ${attemptNo}, ${occ.cron_job_id}, 'succeeded',
               ${new Date(latest.runAtMs || Date.now())},
               ${new Date((latest.runAtMs || Date.now()) + (latest.durationMs || 0))},
               ${String(latest.summary || "").slice(0, 500)})
            ON CONFLICT DO NOTHING
            RETURNING id
          `;
          // Insert a run step so the Output tab shows the agent's response
          if (insertedAttempt?.id) {
            // Scan for artifacts the agent may have written
            const stableArtifactDir = getRunArtifactDir({
              kind: "agenda",
              entityId: occ.agenda_event_id,
              occurrenceId: occ.occurrence_id,
              runId: "artifacts",
            });
            const scannedFiles = await scanArtifactDir(stableArtifactDir);
            const artifactData = scannedFiles.length > 0 ? { files: scannedFiles } : null;
            if (scannedFiles.length > 0) {
              console.log(`[agenda-scheduler] Found ${scannedFiles.length} artifact(s) for occurrence ${occ.occurrence_id}`);
            }
            await sql`
              INSERT INTO agenda_run_steps
                (run_attempt_id, step_order, agent_id, input_payload, output_payload, artifact_payload, status, started_at, finished_at)
              VALUES
                (${insertedAttempt.id}, 0, ${occ.default_agent_id || 'main'},
                 ${sql.json({ instruction: String(occ.rendered_prompt || '(Prompt stored in cron job)').slice(0, 2000), cronJobId: occ.cron_job_id })},
                 ${sql.json({ output: String(latest.summary || '').trim() })},
                 ${artifactData ? sql.json(artifactData) : null},
                 'succeeded',
                 ${new Date(latest.runAtMs || Date.now())},
                 ${new Date((latest.runAtMs || Date.now()) + (latest.durationMs || 0))})
              ON CONFLICT DO NOTHING
            `;
          }
          await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "succeeded", occurrenceId: occ.occurrence_id })})`;
          console.log(`[agenda-scheduler] Occurrence ${occ.occurrence_id} succeeded via cron`);
          // Result synced to DB — cron job no longer needed, clean it up
          await deleteCronJob(occ.cron_job_id).catch(() => {});
          await sql`UPDATE agenda_occurrences SET cron_job_id = NULL WHERE id = ${occ.occurrence_id}`;

        } else {
          // Failed — check if we should try fallback model
          const fallbackModel = String(occ.fallback_model || "").trim();
          const attemptNo = Number(occ.latest_attempt_no || 0) + 1;

          // Record the failed attempt
          const [failedAttempt] = await sql`
            INSERT INTO agenda_run_attempts
              (occurrence_id, attempt_no, queue_job_id, status, started_at, finished_at, summary, error_message)
            VALUES
              (${occ.occurrence_id}, ${attemptNo}, ${occ.cron_job_id}, 'failed',
               ${new Date(latest.runAtMs || Date.now())},
               ${new Date((latest.runAtMs || Date.now()) + (latest.durationMs || 0))},
               ${String(latest.summary || latest.error || "").slice(0, 500)},
               ${String(latest.error || "").slice(0, 500)})
            ON CONFLICT DO NOTHING
            RETURNING id
          `;
          // Insert a failed step for the Output tab
          if (failedAttempt?.id) {
            await sql`
              INSERT INTO agenda_run_steps
                (run_attempt_id, step_order, agent_id, input_payload, output_payload, status, started_at, finished_at, error_message)
              VALUES
                (${failedAttempt.id}, 0, ${occ.default_agent_id || 'main'},
                 ${sql.json({ instruction: String(occ.rendered_prompt || '(Prompt stored in cron job)').slice(0, 2000), cronJobId: occ.cron_job_id })},
                 ${sql.json({ output: String(latest.error || latest.summary || '').trim() })},
                 'failed',
                 ${new Date(latest.runAtMs || Date.now())},
                 ${new Date((latest.runAtMs || Date.now()) + (latest.durationMs || 0))},
                 ${String(latest.error || '').slice(0, 500)})
              ON CONFLICT DO NOTHING
            `;
          }

          // Clean up Qdrant memories from the failed session
          if (latest.sessionId) {
            await cleanupFailedCronSession(latest.sessionId).catch((e) =>
              console.warn(`[agenda-scheduler] Qdrant cleanup failed for session ${latest.sessionId}:`, e.message)
            );
          }

          const attemptedSoFar = Number(occ.latest_attempt_no || 0) + 1;
          if (fallbackModel && !occ.fallback_attempted && attemptedSoFar >= maxRetries) {
            // All primary retries exhausted — retry with fallback model
            console.log(`[agenda-scheduler] Attempting fallback model for ${occ.occurrence_id}: ${fallbackModel}`);
            try {
              await editCronJob(occ.cron_job_id, { model: fallbackModel });
              await runCronJobNow(occ.cron_job_id);
              await sql`
                UPDATE agenda_occurrences
                SET fallback_attempted = TRUE, latest_attempt_no = ${attemptNo},
                    cron_synced_at = now()
                WHERE id = ${occ.occurrence_id}
              `;
              await sendTelegramNotification(
                `🔄 Agenda event "${occ.title}" failed — retrying with fallback model (${fallbackModel})`,
                occ.default_agent_id || "main"
              );
            } catch (err) {
              console.warn(`[agenda-scheduler] Fallback retry failed for ${occ.occurrence_id}:`, err.message);
              await markNeedsRetry(occ, attemptNo, latest.error || "Fallback retry failed");
              await deleteCronJob(occ.cron_job_id).catch(() => {});
              await sql`UPDATE agenda_occurrences SET cron_job_id = NULL WHERE id = ${occ.occurrence_id}`;
            }
          } else {
            // All retries exhausted
            await markNeedsRetry(occ, attemptNo, latest.error || "Cron retries exhausted");
            // Result synced — delete the cron job
            await deleteCronJob(occ.cron_job_id).catch(() => {});
            await sql`UPDATE agenda_occurrences SET cron_job_id = NULL WHERE id = ${occ.occurrence_id}`;
          }
        }
      }
    } catch (err) {
      console.warn(`[agenda-scheduler] Sync failed for occurrence ${occ.occurrence_id}:`, err.message);
    }
  }
}

async function markNeedsRetry(occ, attemptNo, reason) {
  await sql`
    UPDATE agenda_occurrences
    SET status = 'needs_retry', latest_attempt_no = ${attemptNo},
        locked_at = null, last_retry_reason = ${String(reason).slice(0, 500)},
        cron_synced_at = now()
    WHERE id = ${occ.occurrence_id} AND status IN ('queued', 'running')
  `;
  await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "needs_retry", occurrenceId: occ.occurrence_id })})`;
  await sendTelegramNotification(
    `⚠️ Agenda event "${occ.title}" needs manual retry\n\nReason: ${String(reason).slice(0, 200)}\n\nOpen Mission Control to retry.`,
    occ.default_agent_id || "main"
  );
  console.warn(`[agenda-scheduler] Occurrence ${occ.occurrence_id} → needs_retry: ${reason}`);
}

// ── Main scheduling cycle ─────────────────────────────────────────────────────
async function runCycle() {
  const now = new Date();
  const from = new Date(now.getTime() - 5 * 60 * 1000); // 5min back (catch just-missed)
  const to = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

  // Load all active events
  const events = await sql`
    SELECT ae.*, w.id as workspace_id
    FROM agenda_events ae
    JOIN workspaces w ON w.id = ae.workspace_id
    WHERE ae.status = 'active'
  `;

  // Discover Telegram chat ID once
  const chatId = await getTelegramChatId("main");

  let scheduled = 0;

  for (const event of events) {
    try {
      const occurrences = await expandOccurrences(event, from, to);

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

        // Skip if already has a cron job or is past terminal state
        if (occ.cron_job_id || ["succeeded", "failed", "cancelled", "needs_retry"].includes(occ.status)) continue;

        // Only schedule occurrences within the next 48h (don't create hundreds of cron jobs upfront)
        const hoursUntil = (scheduledFor.getTime() - now.getTime()) / 3600000;
        if (hoursUntil > 48 || hoursUntil < -1) continue;

        // Render the prompt
        const message = await renderPromptForEvent(event);

        // Store the rendered prompt. Replace the random artifact dir path in the prompt
        // with a stable occurrence-scoped path so the agent always writes to the same place.
        const stableArtifactDir = getRunArtifactDir({
          kind: "agenda",
          entityId: event.id,
          occurrenceId: occ.id,
          runId: "artifacts",
        });
        const stableMessage = message.replace(
          /runtime-artifacts\/agenda\/[^\s]+/g,
          `runtime-artifacts/agenda/${event.id}/occurrences/${occ.id}/artifacts`
        );
        await sql`UPDATE agenda_occurrences SET rendered_prompt = ${stableMessage} WHERE id = ${occ.id}`;

        // Create the cron job
        const cronJobId = await createCronJob({
          title: event.title,
          message,
          agentId: event.default_agent_id || "main",
          model: event.model_override || event.fallback_model || null,
          scheduledFor,
          chatId,
          timeoutSeconds: null,
        });

        if (!cronJobId) {
          console.warn(`[agenda-scheduler] Failed to create cron job for occurrence ${occ.id} — marking needs_retry`);
          await sql`
            UPDATE agenda_occurrences
            SET status = 'needs_retry',
                last_retry_reason = 'Cron job creation failed — check gateway logs'
            WHERE id = ${occ.id} AND status = 'scheduled'
          `;
          await sql`INSERT INTO agenda_run_attempts
            (occurrence_id, attempt_no, status, started_at, finished_at, summary, error_message)
            VALUES (${occ.id}, 1, 'failed', now(), now(),
              'Failed to create cron job', 'Cron job creation failed — check gateway logs')
            ON CONFLICT DO NOTHING
          `;
          await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "needs_retry", occurrenceId: occ.id })})`;
          continue;
        }

        // Update occurrence with cron job ID and mark queued
        await sql`
          UPDATE agenda_occurrences
          SET status = 'queued', cron_job_id = ${cronJobId}, queued_at = now()
          WHERE id = ${occ.id} AND status = 'scheduled'
        `;

        scheduled++;
        console.log(`[agenda-scheduler] Scheduled occurrence ${occ.id} → cron job ${cronJobId}`);
      }
    } catch (err) {
      console.error(`[agenda-scheduler] Event processing failed for event=${event.id}:`, err.message);
    }
  }

  // Sync run results from cron back to Postgres
  await syncCronRunResults();

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

console.log("[agenda-scheduler] Started — cron-based scheduler active");
