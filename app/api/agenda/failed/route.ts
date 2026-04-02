import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";

type Json = Record<string, unknown>;

const ok = (data: Json = {}): NextResponse => NextResponse.json({ ok: true, ...data });
const fail = (message: string, status = 400): NextResponse =>
  NextResponse.json({ ok: false, error: message }, { status });

export async function GET(): Promise<NextResponse> {
  try {
    const sql = getSql();

    // Show only events whose latest occurrence is currently failed/needs_retry
    const occurrences = await sql`
      WITH latest_per_event AS (
        SELECT DISTINCT ON (ao.agenda_event_id)
          ao.id,
          ao.agenda_event_id,
          ao.scheduled_for,
          ao.status,
          ao.latest_attempt_no,
          ao.locked_at,
          ao.created_at
        FROM agenda_occurrences ao
        ORDER BY ao.agenda_event_id, ao.scheduled_for DESC, ao.created_at DESC
      )
      SELECT
        l.id,
        l.agenda_event_id,
        l.scheduled_for,
        l.status,
        l.latest_attempt_no,
        l.locked_at,
        l.created_at,
        ae.title AS event_title,
        ae.default_agent_id,
        (
          SELECT COALESCE(ara.error_message, ara.summary)
          FROM agenda_run_attempts ara
          WHERE ara.occurrence_id = l.id
          ORDER BY ara.attempt_no DESC
          LIMIT 1
        ) AS last_error
      FROM latest_per_event l
      JOIN agenda_events ae ON ae.id = l.agenda_event_id
      WHERE l.status IN ('failed', 'needs_retry')
      ORDER BY l.scheduled_for DESC
    `;

    return ok({ occurrences });
  } catch {
    return fail("Failed to fetch failed occurrences", 500);
  }
}
