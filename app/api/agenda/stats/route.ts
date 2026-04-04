import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = getSql();

    const [totalEvents, notRanYetCount, runningCount, failedCount] = await Promise.all([
      // Only count active events (exclude drafts)
      sql`select count(*) as c from agenda_events where status = 'active'`.then(r => Number(r[0]?.c ?? 0)),
      sql`
        select count(*) as c
        from agenda_occurrences ao
        join agenda_events ae on ae.id = ao.agenda_event_id
        where ae.status = 'active'
          and ao.status in ('scheduled', 'queued')
      `.then(r => Number(r[0]?.c ?? 0)),
      sql`
        select count(*) as c
        from agenda_occurrences ao
        where ao.status = 'running'
      `.then(r => Number(r[0]?.c ?? 0)),
      sql`
        with latest_per_event as (
          select distinct on (ao.agenda_event_id)
            ao.agenda_event_id,
            ao.status,
            ao.scheduled_for
          from agenda_occurrences ao
          order by ao.agenda_event_id, ao.scheduled_for desc, ao.created_at desc
        )
        select count(*) as c
        from latest_per_event
        where status in ('failed', 'needs_retry')
      `.then(r => Number(r[0]?.c ?? 0)),
    ]);

    return NextResponse.json({
      ok: true,
      totalEvents,
      notRanYetCount,
      runningCount,
      failedCount,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load stats" },
      { status: 500 }
    );
  }
}
