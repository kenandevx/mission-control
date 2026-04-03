import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";

export const dynamic = "force-dynamic";

// BullMQ/Redis queue removed in v2 — execution now via openclaw cron.
// This endpoint returns cron job stats for display in the UI.

export async function GET() {
  try {
    const sql = getSql();

    const [total, queued, running, succeeded, failed, needsRetry] = await Promise.all([
      sql`SELECT COUNT(*)::int as c FROM agenda_occurrences`,
      sql`SELECT COUNT(*)::int as c FROM agenda_occurrences WHERE status = 'queued'`,
      sql`SELECT COUNT(*)::int as c FROM agenda_occurrences WHERE status = 'running'`,
      sql`SELECT COUNT(*)::int as c FROM agenda_occurrences WHERE status = 'succeeded'`,
      sql`SELECT COUNT(*)::int as c FROM agenda_occurrences WHERE status = 'failed'`,
      sql`SELECT COUNT(*)::int as c FROM agenda_occurrences WHERE status = 'needs_retry'`,
    ]);

    return NextResponse.json({
      ok: true,
      queues: [
        {
          name: "agenda (cron)",
          engine: "openclaw-cron",
          waiting: queued[0].c,
          active: running[0].c,
          completed: succeeded[0].c,
          failed: failed[0].c + needsRetry[0].c,
          delayed: 0,
          paused: 0,
          total: total[0].c,
          jobs: [],
        },
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch queue info";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// Queue management actions — no longer applicable with cron engine
export async function POST() {
  return NextResponse.json({
    ok: false,
    error: "Queue management actions are not available in v2 (cron-based engine). Use the Agenda page to manage events and retries.",
  }, { status: 410 });
}
