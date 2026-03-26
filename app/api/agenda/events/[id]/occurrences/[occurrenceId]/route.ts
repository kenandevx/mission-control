import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";

type Json = Record<string, unknown>;

const ok = (data: Json = {}) => NextResponse.json({ ok: true, ...data });
const fail = (message: string, status = 400) =>
  NextResponse.json({ ok: false, error: message }, { status });

async function workspaceId(sql: ReturnType<typeof getSql>) {
  const rows = await sql`select id from workspaces order by created_at asc limit 1`;
  return rows[0]?.id ?? null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; occurrenceId: string }> },
) {
  try {
    const sql = getSql();
    const { occurrenceId } = await params;
    const body = (await request.json()) as Json;
    const wid = await workspaceId(sql);
    if (!wid) return fail("Workspace not found", 500);

    const [occurrence] = await sql`
      select ao.*, ae.workspace_id
      from agenda_occurrences ao
      join agenda_events ae on ae.id = ao.agenda_event_id
      where ao.id = ${occurrenceId} and ae.workspace_id = ${wid}
      limit 1
    `;
    if (!occurrence) return fail("Occurrence not found.", 404);

    const newAttemptNo = occurrence.latest_attempt_no + 1;

    // Create new attempt
    const [attempt] = await sql`
      insert into agenda_run_attempts (occurrence_id, attempt_no, status, started_at)
      values (${occurrenceId}, ${newAttemptNo}, 'running', now())
      returning *
    `;

    // Update occurrence attempt counter
    await sql`
      update agenda_occurrences
      set latest_attempt_no = ${newAttemptNo},
          status = 'queued'
      where id = ${occurrenceId}
    `;

    return ok({ attempt, occurrenceId });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to retry occurrence", 500);
  }
}
