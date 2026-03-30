import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";

type Json = Record<string, unknown>;

const ok = (data: Json = {}) => NextResponse.json({ ok: true, ...data });
const fail = (message: string, status = 400) => NextResponse.json({ ok: false, error: message }, { status });

async function workspaceId(sql: ReturnType<typeof getSql>) {
  const rows = await sql`select id from workspaces order by created_at asc limit 1`;
  return rows[0]?.id ?? null;
}

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const wid = await workspaceId(sql);
    if (!wid) return fail("Workspace not found", 500);

    const url = new URL(request.url);
    const occurrenceId = String(url.searchParams.get("occurrenceId") || "").trim();
    if (!occurrenceId) return fail("occurrenceId is required");

    const attempts = await sql`
      select ara.id, ara.attempt_no, ara.status, ara.started_at, ara.finished_at
      from agenda_run_attempts ara
      join agenda_occurrences ao on ao.id = ara.occurrence_id
      join agenda_events ae on ae.id = ao.agenda_event_id
      where ara.occurrence_id = ${occurrenceId}
        and ae.workspace_id = ${wid}
      order by ara.attempt_no desc
      limit 1
    `;

    const latest = attempts[0];
    if (!latest) return ok({ steps: [], attempt: null });

    const steps = await sql`
      select id, step_order, process_step_id, skill_key, agent_id, status, input_payload, output_payload, artifact_payload, error_message
      from agenda_run_steps
      where run_attempt_id = ${latest.id}
      order by step_order asc
    `;

    return ok({ attempt: latest, steps });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to load run steps", 500);
  }
}
