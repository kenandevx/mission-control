import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = getSql();

    const [activeCount, todayCount, failedCount, totalProcesses, publishedProcesses] = await Promise.all([
      sql`select count(*) as c from agenda_events where status = 'active'`.then(r => Number(r[0]?.c ?? 0)),
      sql`
        select count(*) as c
        from agenda_occurrences ao
        join agenda_events ae on ae.id = ao.agenda_event_id
        where ae.status = 'active'
          and ao.scheduled_for >= now()::date
          and ao.scheduled_for < (now()::date + interval '1 day')
      `.then(r => Number(r[0]?.c ?? 0)),
      sql`
        select count(*) as c
        from agenda_occurrences
        where status = 'failed'
          and scheduled_for >= now() - interval '24 hours'
      `.then(r => Number(r[0]?.c ?? 0)),
      sql`select count(*) as c from processes`.then(r => Number(r[0]?.c ?? 0)),
      sql`select count(*) as c from processes where status = 'published'`.then(r => Number(r[0]?.c ?? 0)),
    ]);

    return NextResponse.json({
      ok: true,
      activeEvents: activeCount,
      todayOccurrences: todayCount,
      failedLast24h: failedCount,
      totalProcesses,
      publishedProcesses,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load stats" },
      { status: 500 }
    );
  }
}
