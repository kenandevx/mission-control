#!/usr/bin/env node
/**
 * Agenda Scheduler — runs every minute.
 * 1. Finds all active agenda events
 * 2. Expands RRULE / one-time events over a lookahead window
 * 3. Creates missing agenda_occurrences
 * 4. Enqueues due occurrences to BullMQ
 */
import postgres from "postgres";
import { Queue } from "bullmq";
import * as dns from "node:dns";
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

const sql = postgres(connectionString, { max: 5, prepare: false, idle_timeout: 20, connect_timeout: 10 });

const agendaQueue = new Queue("agenda", {
  connection: { host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD },
  defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200, attempts: 1 },
});

let redisUp = false;
async function checkRedis() {
  try {
    await lookupAsync(REDIS_HOST);
    redisUp = true;
  } catch {
    redisUp = false;
  }
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
    const rule = RRule.fromString(event.recurrence_rule);
    return rule.between(from, rangeEnd, true);
  } catch {
    // Fallback: single occurrence
    if (startDate >= from && startDate <= to) return [startDate];
    return [];
  }
}

async function run() {
  await checkRedis();
  if (!redisUp) {
    console.warn("[agenda-scheduler] Redis unavailable, skipping cycle");
    return;
  }

  const LOOKAHEAD_DAYS = parseInt(process.env.AGENDA_LOOKAHEAD_DAYS || "14", 10);
  const now = new Date();
  const from = new Date(now.getTime() - 10 * 60 * 1000); // 10-min backfill
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
        // Enqueue if within 1 minute of now
        const diffMs = scheduledFor.getTime() - now.getTime();
        const delay = Math.max(0, diffMs);

        await agendaQueue.add(
          "run-occurrence",
          {
            occurrenceId: occ.id,
            eventId: event.id,
            title: event.title,
            freePrompt: event.free_prompt,
            agentId: event.default_agent_id,
            timezone: event.timezone,
            processes: event.processes,
          },
          {
            delay,
            jobId: `agenda-${occ.id}`,
            removeOnComplete: false, // keep history
          }
        );

        enqueued++;
      }
    }
  }

  console.log(`[agenda-scheduler] ${new Date().toISOString()} — scanned ${rows.length} events, enqueued ${enqueued} occurrences`);
}

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[agenda-scheduler] Shutting down...");
  await agendaQueue.close();
  await sql.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Run immediately then every 60s
void run();
setInterval(run, 60_000);
