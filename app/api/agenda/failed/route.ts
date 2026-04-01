import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";

type Json = Record<string, unknown>;

const ok = (data: Json = {}): NextResponse => NextResponse.json({ ok: true, ...data });
const fail = (message: string, status = 400): NextResponse =>
  NextResponse.json({ ok: false, error: message }, { status });

export async function GET(): Promise<NextResponse> {
  try {
    const sql = getSql();

    const occurrences = await sql`
      SELECT
        ao.id,
        ao.agenda_event_id,
        ao.scheduled_for,
        ao.status,
        ao.latest_attempt_no,
        ao.locked_at,
        ao.created_at,
        ae.title AS event_title,
        ae.default_agent_id,
        (
          SELECT COALESCE(ara.error_message, ara.summary)
          FROM agenda_run_attempts ara
          WHERE ara.occurrence_id = ao.id
          ORDER BY ara.attempt_no DESC
          LIMIT 1
        ) AS last_error
      FROM agenda_occurrences ao
      JOIN agenda_events ae ON ae.id = ao.agenda_event_id
      WHERE ao.status IN ('failed', 'needs_retry')
      ORDER BY ao.scheduled_for DESC
      LIMIT 100
    `;

    return ok({ occurrences });
  } catch {
    return fail("Failed to fetch failed occurrences", 500);
  }
}
