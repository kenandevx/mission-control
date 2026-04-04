import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";

export const dynamic = "force-dynamic";

/**
 * GET /api/agenda/logs
 *
 * Returns structured agenda execution logs from agent_logs.
 * These are the "agenda.*" event_type rows emitted by bridge-logger
 * when cron runs start, succeed, fail, or trigger fallback.
 *
 * Query params:
 *   occurrenceId  — filter to a specific occurrence (UUID)
 *   eventId       — filter to all occurrences of an event (UUID) — joined via agenda_occurrences
 *   level         — "info" | "warn" | "error"
 *   limit         — default 100, max 500
 *   page          — 1-indexed
 *   since         — ISO timestamp, only return logs after this time
 */
export async function GET(request: Request) {
  const sql = getSql();
  const url = new URL(request.url);

  const occurrenceId = url.searchParams.get("occurrenceId")?.trim() || null;
  const eventTypeFilter = url.searchParams.get("eventType")?.trim() || null;
  const eventId = url.searchParams.get("eventId")?.trim() || null;
  const levelFilter = url.searchParams.get("level")?.trim() || null;
  const since = url.searchParams.get("since")?.trim() || null;
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 500);
  const page = Math.max(Number(url.searchParams.get("page") || 1), 1);
  const offset = (page - 1) * limit;

  try {
    // Build filter conditions
    // Always filter to type='agenda' to keep this endpoint fast
    let rows;
    let total: number;

    if (occurrenceId) {
      // Fast path: filter by the indexed agenda_occurrence_id column
      const countRow = await sql`
        SELECT COUNT(*)::int as c FROM agent_logs
        WHERE type = 'agenda'
          AND agenda_occurrence_id = ${occurrenceId}::uuid
          ${levelFilter ? sql`AND level = ${levelFilter}` : sql``}
          ${since ? sql`AND occurred_at > ${since}::timestamptz` : sql``}
      `;
      total = countRow[0]?.c ?? 0;

      rows = await sql`
        SELECT
          l.id, l.occurred_at, l.level, l.event_type, l.message, l.message_preview,
          l.session_key, l.agenda_occurrence_id, l.raw_payload, l.runtime_agent_id
        FROM agent_logs l
        WHERE l.type = 'agenda'
          AND l.agenda_occurrence_id = ${occurrenceId}::uuid
          ${levelFilter ? sql`AND l.level = ${levelFilter}` : sql``}
          ${since ? sql`AND l.occurred_at > ${since}::timestamptz` : sql``}
        ORDER BY l.occurred_at ASC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (eventId) {
      // Filter to all occurrences of a given event
      const countRow = await sql`
        SELECT COUNT(*)::int as c FROM agent_logs l
        WHERE l.type = 'agenda'
          AND l.agenda_occurrence_id IN (
            SELECT id FROM agenda_occurrences WHERE agenda_event_id = ${eventId}::uuid
          )
          ${levelFilter ? sql`AND l.level = ${levelFilter}` : sql``}
          ${since ? sql`AND l.occurred_at > ${since}::timestamptz` : sql``}
      `;
      total = countRow[0]?.c ?? 0;

      rows = await sql`
        SELECT
          l.id, l.occurred_at, l.level, l.event_type, l.message, l.message_preview,
          l.session_key, l.agenda_occurrence_id, l.raw_payload, l.runtime_agent_id,
          ao.scheduled_for, ao.status as occurrence_status
        FROM agent_logs l
        JOIN agenda_occurrences ao ON ao.id = l.agenda_occurrence_id
        WHERE l.type = 'agenda'
          AND ao.agenda_event_id = ${eventId}::uuid
          ${levelFilter ? sql`AND l.level = ${levelFilter}` : sql``}
          ${since ? sql`AND l.occurred_at > ${since}::timestamptz` : sql``}
        ORDER BY l.occurred_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      // All agenda logs (system log view)
      const countRow = await sql`
        SELECT COUNT(*)::int as c FROM agent_logs
        WHERE type = 'agenda'
          ${levelFilter ? sql`AND level = ${levelFilter}` : sql``}
          ${eventTypeFilter ? sql`AND event_type = ${eventTypeFilter}` : sql``}
          ${since ? sql`AND occurred_at > ${since}::timestamptz` : sql``}
      `;
      total = countRow[0]?.c ?? 0;

      rows = await sql`
        SELECT
          l.id, l.occurred_at, l.level, l.event_type, l.message, l.message_preview,
          l.session_key, l.agenda_occurrence_id, l.raw_payload, l.runtime_agent_id,
          ao.scheduled_for, ao.status as occurrence_status,
          ae.title as event_title
        FROM agent_logs l
        LEFT JOIN agenda_occurrences ao ON ao.id = l.agenda_occurrence_id
        LEFT JOIN agenda_events ae ON ae.id = ao.agenda_event_id
        WHERE l.type = 'agenda'
          ${levelFilter ? sql`AND l.level = ${levelFilter}` : sql``}
          ${eventTypeFilter ? sql`AND l.event_type = ${eventTypeFilter}` : sql``}
          ${since ? sql`AND l.occurred_at > ${since}::timestamptz` : sql``}
        ORDER BY l.occurred_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    return NextResponse.json({
      ok: true,
      logs: rows,
      total,
      pageInfo: {
        page,
        limit,
        total,
        pageCount: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error("[agenda/logs] Error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
