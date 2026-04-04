#!/usr/bin/env node
/**
 * Agenda selfcheck v3 — validates cron-based execution engine health.
 *
 * Checks:
 *   1. Schema assertion (all required columns present)
 *   2. Gateway + cron connectivity
 *   3. Active occurrence counts
 *   4. Stuck occurrences: queued but no cron_job_id (scheduler bug)
 *   5. Orphaned cron jobs: queued occurrences whose cron_job_id no longer
 *      exists in the gateway (job was deleted or gateway was reset)
 *   6. Stale running: running occurrences past their execution_window_minutes
 *   7. Recent failure rate: how many of the last 10 occurrences failed
 */
import postgres from "postgres";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertAgendaSchema } from "./agenda-schema-check.mjs";
import { buildCleanEnv } from "./openclaw-config.mjs";

const execFileAsync = promisify(execFile);

const dbUrl = process.env.DATABASE_URL?.trim() || process.env.OPENCLAW_DATABASE_URL?.trim();
if (!dbUrl) {
  console.error("[agenda-selfcheck] Missing DATABASE_URL / OPENCLAW_DATABASE_URL");
  process.exit(1);
}

const sql = postgres(dbUrl, { max: 2, prepare: false });

async function main() {
  const out = {
    schema: false,
    cronGateway: false,
    activeOccurrences: 0,
    stuckOccurrences: 0,      // queued but no cron_job_id
    orphanedCronJobs: 0,       // cron_job_id in DB but not in gateway
    staleRunning: 0,           // running past execution_window_minutes
    recentFailureRate: null,   // % of last 10 occurrences that failed/needs_retry
    warnings: [],
  };

  // 1. Schema check
  try {
    await assertAgendaSchema(sql);
    out.schema = true;
  } catch (err) {
    out.warnings.push(`Schema: ${err.message}`);
    console.error("[agenda-selfcheck] FAILED:", err.message);
    process.exitCode = 1;
    return;
  }

  // 2. Gateway + cron connectivity — fetch live job list for later use
  let liveJobIds = new Set();
  try {
    const env = buildCleanEnv();
    const result = await execFileAsync("openclaw", ["cron", "list", "--json"], {
      timeout: 15000, env, maxBuffer: 2 * 1024 * 1024,
    });
    const raw = (result.stdout || "").trim() || (result.stderr || "").trim();
    if (raw) {
      const parsed = JSON.parse(raw);
      const jobs = Array.isArray(parsed?.entries) ? parsed.entries : [];
      for (const j of jobs) {
        if (j?.id) liveJobIds.add(j.id);
      }
    }
    out.cronGateway = true;
  } catch (err) {
    out.warnings.push(`Cron gateway unreachable: ${err.message}`);
    console.warn("[agenda-selfcheck] ⚠️  Cannot reach openclaw cron gateway — events will not fire until resolved");
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
      AND queued_at < now() - INTERVAL '5 minutes'
  `;
  out.stuckOccurrences = stuckOccurrences;
  if (stuckOccurrences > 0) {
    out.warnings.push(`${stuckOccurrences} occurrence(s) queued without cron_job_id — scheduler may need restart`);
  }

  // 5. Orphaned cron jobs: occurrence has cron_job_id but job is gone from gateway
  if (out.cronGateway && liveJobIds.size > 0) {
    const queuedWithJob = await sql`
      SELECT cron_job_id FROM agenda_occurrences
      WHERE status IN ('queued', 'running')
        AND cron_job_id IS NOT NULL
    `;
    const orphaned = queuedWithJob.filter((r) => !liveJobIds.has(r.cron_job_id));
    out.orphanedCronJobs = orphaned.length;
    if (orphaned.length > 0) {
      out.warnings.push(`${orphaned.length} occurrence(s) reference cron jobs that no longer exist in gateway`);
    }
  }

  // 6. Stale running: running occurrences past their event's execution_window_minutes
  const staleRows = await sql`
    SELECT ao.id, ae.title,
           COALESCE(ae.execution_window_minutes, 60) as window_minutes,
           ao.locked_at
    FROM agenda_occurrences ao
    JOIN agenda_events ae ON ae.id = ao.agenda_event_id
    WHERE ao.status = 'running'
      AND ao.locked_at IS NOT NULL
      AND ao.locked_at < now() - (
        GREATEST(COALESCE(ae.execution_window_minutes, 60), 5) * INTERVAL '1 minute'
      )
  `;
  out.staleRunning = staleRows.length;
  if (staleRows.length > 0) {
    for (const r of staleRows) {
      out.warnings.push(`Stale: occurrence ${r.id} ("${r.title}") running > ${r.window_minutes}min`);
    }
  }

  // 7. Recent failure rate (last 20 by scheduled_for)
  const recent = await sql`
    SELECT status FROM agenda_occurrences
    ORDER BY scheduled_for DESC
    LIMIT 20
  `;
  if (recent.length > 0) {
    const failed = recent.filter((r) => ['failed', 'needs_retry'].includes(r.status)).length;
    out.recentFailureRate = Math.round((failed / recent.length) * 100);
    if (out.recentFailureRate > 50) {
      out.warnings.push(`High failure rate: ${out.recentFailureRate}% of last ${recent.length} occurrences failed/needs_retry`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const healthy = out.schema && out.cronGateway && out.stuckOccurrences === 0
    && out.orphanedCronJobs === 0 && out.staleRunning === 0;

  if (healthy) {
    console.log("[agenda-selfcheck] OK", out);
  } else {
    console.warn("[agenda-selfcheck] DEGRADED", out);
    for (const w of out.warnings) {
      console.warn(`[agenda-selfcheck] ⚠️  ${w}`);
    }
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
