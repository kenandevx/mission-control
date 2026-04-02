#!/usr/bin/env node
import postgres from "postgres";
import { Queue } from "bullmq";
import { assertAgendaSchema } from "./agenda-schema-check.mjs";

const dbUrl = process.env.DATABASE_URL?.trim() || process.env.OPENCLAW_DATABASE_URL?.trim();
if (!dbUrl) {
  console.error("[agenda-selfcheck] Missing DATABASE_URL / OPENCLAW_DATABASE_URL");
  process.exit(1);
}

const redisHost = process.env.REDIS_HOST || process.env.REDIS_URL?.replace(/^redis:\/\//, "").split(":")[0] || "localhost";
const redisPort = Number(process.env.REDIS_PORT || 6379);
const redisPassword = process.env.REDIS_PASSWORD || undefined;

const sql = postgres(dbUrl, { max: 2, prepare: false });

async function main() {
  const out = { schema: false, queue: false, staleQueuedRows: 0, queuedMissingJobs: 0, activeLocks: 0, failedLatestEvents: 0 };

  await assertAgendaSchema(sql);
  out.schema = true;

  const queue = new Queue("agenda", {
    connection: { host: redisHost, port: redisPort, password: redisPassword },
  });
  const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed");
  out.queue = true;
  await queue.close();

  const [{ c: staleQueuedRows }] = await sql`
    select count(*)::int as c
    from agenda_occurrences ao
    where ao.status = 'queued'
      and (ao.queue_job_id is null or ao.queued_at is null)
  `;
  out.staleQueuedRows = staleQueuedRows;

  const queuedRows = await sql`
    select id, queue_job_id
    from agenda_occurrences
    where status = 'queued'
      and queue_job_id is not null
    order by queued_at asc nulls last
    limit 200
  `;
  let queuedMissingJobs = 0;
  for (const row of queuedRows) {
    const job = await queue.getJob(row.queue_job_id);
    if (!job) queuedMissingJobs += 1;
  }
  out.queuedMissingJobs = queuedMissingJobs;

  const [{ c: activeLocks }] = await sql`
    select count(*)::int as c from agent_execution_locks
  `;
  out.activeLocks = activeLocks;

  const [{ c: failedLatestEvents }] = await sql`
    with latest_per_event as (
      select distinct on (agenda_event_id) agenda_event_id, status
      from agenda_occurrences
      order by agenda_event_id, scheduled_for desc, created_at desc
    )
    select count(*)::int as c
    from latest_per_event
    where status in ('failed', 'needs_retry')
  `;
  out.failedLatestEvents = failedLatestEvents;

  console.log("[agenda-selfcheck] OK", { ...out, queueCounts: counts });

  if (out.staleQueuedRows > 0) {
    console.warn(`[agenda-selfcheck] Found ${out.staleQueuedRows} queued rows without queue metadata`);
  }
  if (out.queuedMissingJobs > 0) {
    console.warn(`[agenda-selfcheck] Found ${out.queuedMissingJobs} queued rows that reference missing BullMQ jobs`);
  }
}

main()
  .catch((err) => {
    console.error("[agenda-selfcheck] FAILED", err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 }).catch(() => {});
  });
