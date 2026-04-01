#!/usr/bin/env node
/**
 * Agenda Scheduler — runs every minute.
 * 1. Finds all active agenda events
 * 2. Expands RRULE / one-time events over a lookahead window
 * 3. Creates missing agenda_occurrences
 * 4. Enqueues due occurrences to BullMQ
 * v2: Passes scheduledFor, executionWindowMinutes, fallbackModel in job data.
 *     Service heartbeat to service_health table.
 */
import postgres from "postgres";
import { Queue } from "bullmq";
import * as dns from "node:dns";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const lookupAsync = promisify(dns.lookup.bind(dns));

const connectionString = process.env.DATABASE_URL?.trim() || process.env.OPENCLAW_DATABASE_URL?.trim();
if (!connectionString) {
  console.error("[agenda-scheduler] Missing DATABASE_URL / OPENCLAW_DATABASE_URL");
  process.exit(1);
}

const REDIS_HOST = process.env.REDIS_HOST || process.env.REDIS_URL?.replace(/^redis:\/\//, "").split(":")[0] || "localhost";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const SERVICE_NAME = "agenda-scheduler";

const sql = postgres(connectionString, { max: 5, prepare: false, idle_timeout: 20, connect_timeout: 10 });

const agendaQueue = new Queue("agenda", {
  connection: { host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD },
  defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200, attempts: 1 },
});

// ── Service heartbeat ─────────────────────────────────────────────────────────
async function writeHeartbeat(status = "running", lastError = null) {
  try {
    await sql`
      INSERT INTO service_health (name, status, pid, last_heartbeat_at, last_error, started_at, updated_at)
      VALUES (${SERVICE_NAME}, ${status}, ${process.pid}, now(), ${lastError}, now(), now())
      ON CONFLICT (name) DO UPDATE SET
        status = ${status},
        pid = ${process.pid},
        last_heartbeat_at = now(),
        last_error = COALESCE(${lastError}, service_health.last_error),
        updated_at = now()
    `;
  } catch (err) {
    console.warn("[agenda-scheduler] Heartbeat write failed:", err.message);
  }
}

let redisUp = false;
async function checkRedis() {
  try {
    await lookupAsync(REDIS_HOST);
    redisUp = true;
  } catch {
    redisUp = false;
  }
}

/**
 * Timezone-aware RRULE expansion.
 * Keeps the local time consistent across DST boundaries.
 * e.g. 02:08 CET stays 02:08 CEST after the clock change.
 */
function localTimeToUTC(localDateStr, localTimeStr, timezone) {
  // Try multiple UTC offsets to find the one that renders correctly in the target timezone
  // This handles DST gaps (e.g. 02:08 CET doesn't exist on spring-forward day)
  const targetLocal = `${localDateStr}T${localTimeStr}`;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
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
  // Fallback: if DST gap makes the time impossible, shift forward 1 hour (spring-forward)
  return new Date(base.getTime() - 3600000);
}

function extractLocalTime(utcDate, timezone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
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
    if (startDate >= from && startDate <= to) {
      return [startDate];
    }
    return [];
  }

  try {
    const { RRule } = await import("rrule");
    const tz = event.timezone || "UTC";
    const { time: localTime } = extractLocalTime(startDate, tz);

    // Expand RRULE using dtstart so it knows the series anchor
    const opts = RRule.parseString(event.recurrence_rule);
    opts.dtstart = startDate;
    const rule = new RRule(opts);
    const rawDates = rule.between(from, rangeEnd, true);

    // Snap local time to nearest 15-min boundary in case of drift
    const [lh, lm] = localTime.split(":").map(Number);
    const snappedMin = Math.round(lm / 15) * 15;
    const snappedH = snappedMin >= 60 ? (lh + 1) % 24 : lh;
    const snappedM = snappedMin >= 60 ? 0 : snappedMin;
    const snappedTime = `${String(snappedH).padStart(2, "0")}:${String(snappedM).padStart(2, "0")}`;

    // For each expanded date, re-anchor to the snapped local time
    // This fixes DST: 02:00 CET stays 02:00 CEST
    return rawDates.map((d) => {
      const { date: occDate } = extractLocalTime(d, tz);
      return localTimeToUTC(occDate, snappedTime, tz);
    });
  } catch (err) {
    console.warn("[agenda-scheduler] RRULE expansion failed:", err.message);
    if (startDate >= from && startDate <= to) return [startDate];
    return [];
  }
}

function getBullPriorityForScheduledAt(scheduledDate) {
  const ageSec = Math.max(0, Math.floor((Date.now() - scheduledDate.getTime()) / 1000));
  return Math.max(1, 2097152 - Math.min(ageSec, 2097151));
}

async function enqueueOccurrenceJob({ occurrenceId, eventId, title, freePrompt, agentId, timezone, processes, scheduledFor, executionWindowMinutes, fallbackModel }) {
  const scheduledDate = new Date(scheduledFor);
  const diffMs = scheduledDate.getTime() - Date.now();
  const delay = Math.max(0, diffMs);
  const queueJobId = `agenda-${occurrenceId}-${randomUUID()}`;

  await agendaQueue.add(
    "run-occurrence",
    {
      occurrenceId,
      eventId,
      title,
      freePrompt,
      agentId,
      timezone,
      processes,
      scheduledFor: scheduledDate.toISOString(),
      executionWindowMinutes: executionWindowMinutes || 30,
      fallbackModel: fallbackModel || "",
      queueJobId,
    },
    {
      delay,
      jobId: queueJobId,
      removeOnComplete: false,
      priority: getBullPriorityForScheduledAt(scheduledDate),
    }
  );

  await sql`
    update agenda_occurrences
    set status = 'queued', queue_job_id = ${queueJobId}, queued_at = now()
    where id = ${occurrenceId} and status in ('scheduled', 'queued')
  `;
}

async function run() {
  await checkRedis();
  if (!redisUp) {
    console.warn("[agenda-scheduler] Redis unavailable, skipping cycle");
    return;
  }

  const LOOKAHEAD_DAYS = parseInt(process.env.AGENDA_LOOKAHEAD_DAYS || "14", 10);
  const now = new Date();
  const from = new Date(now.getTime() - 35 * 60 * 1000); // 35-min backfill (covers previous 1-2 quarter-hour slots)
  const to = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

  const rows = await sql`
    select
      ae.id,
      ae.title,
      ae.free_prompt,
      ae.default_agent_id,
      ae.starts_at,
      ae.ends_at,
      ae.recurrence_rule,
      ae.recurrence_until,
      ae.timezone,
      ae.status,
      ae.execution_window_minutes,
      ae.fallback_model,
      coalesce(
        (select json_agg(json_build_object(
          'process_version_id', aep.process_version_id,
          'sort_order', aep.sort_order
        ) order by aep.sort_order)
        from agenda_event_processes aep
        where aep.agenda_event_id = ae.id),
        '[]'
      ) as processes
    from agenda_events ae
    where ae.status = 'active'
  `;

  let enqueued = 0;

  for (const event of rows) {
    const occurrences = await expandOccurrences(event, from, to);

    for (const scheduledFor of occurrences) {
      // Insert occurrence (skip if already exists — never overwrite status)
      await sql`
        insert into agenda_occurrences (agenda_event_id, scheduled_for, status)
        values (${event.id}, ${scheduledFor}, 'scheduled')
        on conflict (agenda_event_id, scheduled_for) do nothing
      `;

      const [occ] = await sql`
        select id, status from agenda_occurrences
        where agenda_event_id = ${event.id} and scheduled_for = ${scheduledFor}
      `;

      if (occ && occ.status === "scheduled") {
        // Only enqueue jobs that are due within the next 2 minutes (scheduler runs every 60s)
        const diffMs = scheduledFor.getTime() - now.getTime();
        const TWO_MINUTES = 2 * 60 * 1000;

        if (diffMs <= TWO_MINUTES) {
          await enqueueOccurrenceJob({
            occurrenceId: occ.id,
            eventId: event.id,
            title: event.title,
            freePrompt: event.free_prompt,
            agentId: event.default_agent_id,
            timezone: event.timezone,
            processes: event.processes,
            scheduledFor,
            executionWindowMinutes: event.execution_window_minutes || 30,
            fallbackModel: event.fallback_model || "",
          });
          enqueued++;
        }
        // Future occurrences stay as 'scheduled' in DB — will be enqueued when their time comes
      }
    }
  }

  // Rescue pass: enqueue any due scheduled/queued occurrence directly from DB, even if it
  // came from manual retry, test injection, or a draft event.
  // Also mark stale queued/scheduled due occurrences as needs_retry once they are past the
  // execution window without ever being picked up.
  const dueOccurrences = await sql`
    select
      ao.id as occurrence_id,
      ao.status as occurrence_status,
      ao.scheduled_for,
      ao.queue_job_id,
      ao.queued_at,
      ao.latest_attempt_no,
      ae.id as event_id,
      ae.title,
      ae.free_prompt,
      ae.default_agent_id,
      ae.timezone,
      ae.execution_window_minutes,
      ae.fallback_model,
      coalesce(
        (select json_agg(json_build_object(
          'process_version_id', aep.process_version_id,
          'sort_order', aep.sort_order
        ) order by aep.sort_order)
        from agenda_event_processes aep
        where aep.agenda_event_id = ae.id),
        '[]'
      ) as processes
    from agenda_occurrences ao
    join agenda_events ae on ae.id = ao.agenda_event_id
    where ao.status in ('scheduled', 'queued')
      and ao.scheduled_for <= ${new Date(now.getTime() + 2 * 60 * 1000)}
      and ao.scheduled_for >= ${new Date(now.getTime() - 35 * 60 * 1000)}
  `;

  let rescued = 0;
  let markedNeedsRetry = 0;
  for (const row of dueOccurrences) {
    const scheduledDate = new Date(row.scheduled_for);
    const windowMinutes = Number(row.execution_window_minutes || 30);
    const ageMinutes = (now.getTime() - scheduledDate.getTime()) / 60000;

    if (ageMinutes > windowMinutes) {
      const reason = `Missed execution window before worker pickup — ${Math.round(ageMinutes)}min past ${windowMinutes}min limit`;
      const attemptNo = Number(row.latest_attempt_no ?? 0) + 1;
      await sql`
        update agenda_occurrences
        set status = 'needs_retry', queue_job_id = null, queued_at = null, latest_attempt_no = ${attemptNo}, last_retry_reason = ${reason}
        where id = ${row.occurrence_id} and status in ('scheduled', 'queued')
      `;
      await sql`
        insert into agenda_run_attempts (occurrence_id, attempt_no, queue_job_id, status, started_at, finished_at, summary, error_message)
        values (${row.occurrence_id}, ${attemptNo}, ${row.queue_job_id ?? null}, 'failed', now(), now(), ${reason}, ${reason})
      `;
      await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: 'needs_retry', occurrenceId: row.occurrence_id })})`;
      markedNeedsRetry++;
      continue;
    }

    const queuedAt = row.queued_at ? new Date(row.queued_at) : null;
    const staleQueued = !queuedAt || (now.getTime() - queuedAt.getTime()) > 90_000;
    if (!staleQueued) continue;

    try {
      await enqueueOccurrenceJob({
        occurrenceId: row.occurrence_id,
        eventId: row.event_id,
        title: row.title,
        freePrompt: row.free_prompt,
        agentId: row.default_agent_id,
        timezone: row.timezone,
        processes: row.processes,
        scheduledFor: row.scheduled_for,
        executionWindowMinutes: row.execution_window_minutes || 30,
        fallbackModel: row.fallback_model || "",
      });
      rescued++;
      enqueued++;
    } catch (err) {
      console.warn(`[agenda-scheduler] Rescue enqueue failed for ${row.occurrence_id}:`, err.message);
    }
  }

  console.log(`[agenda-scheduler] ${new Date().toISOString()} — scanned ${rows.length} events, rescue-scanned ${dueOccurrences.length} due occurrences, rescued ${rescued}, auto-marked-needs_retry ${markedNeedsRetry}, enqueued ${enqueued} occurrences`);
}

// ── Service heartbeat on startup + every 30s ──────────────────────────────────
await writeHeartbeat("running");
const heartbeatInterval = setInterval(() => writeHeartbeat("running"), 30_000);

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[agenda-scheduler] Shutting down...");
  clearInterval(heartbeatInterval);
  await writeHeartbeat("stopped").catch(() => {});
  await agendaQueue.close();
  await sql.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Run immediately then every 60s
void run();
setInterval(run, 60_000);
