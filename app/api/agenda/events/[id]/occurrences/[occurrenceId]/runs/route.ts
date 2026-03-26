import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";

type Json = Record<string, unknown>;
const ok = (data: Json = {}) => NextResponse.json({ ok: true, ...data });
const fail = (message: string, status = 400) =>
  NextResponse.json({ ok: false, error: message }, { status });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; occurrenceId: string }> },
) {
  try {
    const sql = getSql();
    const { occurrenceId } = await params;

    const attempts = await sql`
      select
        ara.id,
        ara.attempt_no,
        ara.status,
        ara.started_at,
        ara.finished_at,
        ara.summary,
        ara.error_message
      from agenda_run_attempts ara
      where ara.occurrence_id = ${occurrenceId}
      order by ara.attempt_no asc
    `;

    if (!attempts || attempts.length === 0) {
      return ok({ attempts: [], steps: [] });
    }

    // Fetch all steps for these attempts
    const attemptIds = attempts.map((a) => a.id);
    const steps = await sql`
      select
        ars.id,
        ars.run_attempt_id,
        ars.process_version_id,
        ars.process_step_id,
        ars.step_order,
        ars.agent_id,
        ars.skill_key,
        ars.input_payload,
        ars.output_payload,
        ars.status,
        ars.started_at,
        ars.finished_at,
        ars.error_message,
        ps.title as step_title,
        ps.instruction as step_instruction,
        p.name as process_name
      from agenda_run_steps ars
      left join process_steps ps on ps.id = ars.process_step_id
      left join process_versions pv on pv.id = ars.process_version_id
      left join processes p on p.id = pv.process_id
      where ars.run_attempt_id = any(${attemptIds})
      order by ars.run_attempt_id, ars.step_order asc
    `;

    return ok({ attempts, steps });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to load run details", 500);
  }
}
