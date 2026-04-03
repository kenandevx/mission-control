#!/usr/bin/env node
/**
 * Agenda selfcheck v2 — validates cron-based execution engine health.
 * No BullMQ/Redis checks — execution is via openclaw cron.
 */
import postgres from "postgres";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertAgendaSchema } from "./agenda-schema-check.mjs";

const execFileAsync = promisify(execFile);

const dbUrl = process.env.DATABASE_URL?.trim() || process.env.OPENCLAW_DATABASE_URL?.trim();
if (!dbUrl) {
  console.error("[agenda-selfcheck] Missing DATABASE_URL / OPENCLAW_DATABASE_URL");
  process.exit(1);
}

const sql = postgres(dbUrl, { max: 2, prepare: false });

function buildCleanEnv() {
  const env = { ...process.env };
  delete env.OPENCLAW_GATEWAY_URL;
  delete env.OPENCLAW_GATEWAY_TOKEN;
  return env;
}

async function main() {
  const out = {
    schema: false,
    cronGateway: false,
    activeOccurrences: 0,
    stuckOccurrences: 0,
    activeLocks: 0,
    failedLatestEvents: 0,
  };

  // 1. Schema check
  await assertAgendaSchema(sql);
  out.schema = true;

  // 2. Gateway + cron connectivity
  try {
    const env = buildCleanEnv();
    const result = await execFileAsync("openclaw", ["cron", "list", "--json"], {
      timeout: 15000, env, maxBuffer: 2 * 1024 * 1024,
    });
    const raw = (result.stdout || "").trim() || (result.stderr || "").trim();
    if (raw) JSON.parse(raw); // confirm it parses
    out.cronGateway = true;
  } catch (err) {
    console.warn("[agenda-selfcheck] Cron gateway check failed:", err.message);
  }

  // 3. Active occurrences (queued/running)
  const [{ c: activeOccurrences }] = await sql`
    SELECT COUNT(*)::int as c FROM agenda_occurrences
    WHERE status IN ('queued', 'running')
  `;
  out.activeOccurrences = activeOccurrences;

  // 4. Stuck occurrences: queued but no cron_job_id, older than 5 minutes
  const [{ c: stuckOccurrences }] = await sql`
    SELECT COUNT(*)::int as c FROM agenda_occurrences
    WHERE status = 'queued'
      AND cron_job_id IS NULL
      AND queued_at < now() - interval '5 minutes'
  `;
  out.stuckOccurrences = stuckOccurrences;

  // 5. Active agent execution locks (should be zero with cron engine)
  const [{ c: activeLocks }] = await sql`
    SELECT COUNT(*)::int as c FROM agent_execution_locks
  `.catch(() => [{ c: 0 }]);
  out.activeLocks = activeLocks;

  // 6. Failed latest occurrences
  const [{ c: failedLatestEvents }] = await sql`
    WITH latest_per_event AS (
      SELECT DISTINCT ON (agenda_event_id) agenda_event_id, status
      FROM agenda_occurrences
      ORDER BY agenda_event_id, scheduled_for DESC, created_at DESC
    )
    SELECT COUNT(*)::int as c FROM latest_per_event
    WHERE status IN ('failed', 'needs_retry')
  `;
  out.failedLatestEvents = failedLatestEvents;

  console.log("[agenda-selfcheck] OK", out);

  if (out.stuckOccurrences > 0) {
    console.warn(`[agenda-selfcheck] ⚠️ ${out.stuckOccurrences} occurrence(s) queued without cron_job_id — scheduler may need a restart`);
  }
  if (!out.cronGateway) {
    console.warn("[agenda-selfcheck] ⚠️ Cannot reach openclaw cron gateway — events will not fire until resolved");
  }
  if (out.activeLocks > 0) {
    console.warn(`[agenda-selfcheck] ⚠️ ${out.activeLocks} stale agent execution lock(s) — run: DELETE FROM agent_execution_locks`);
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
