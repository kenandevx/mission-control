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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const sql = getSql();
    const { id } = await params;
    const wid = await workspaceId(sql);
    if (!wid) return fail("Workspace not found", 500);

    const [event] = await sql`
      select ae.*
      from agenda_events ae
      where ae.id = ${id} and ae.workspace_id = ${wid}
      limit 1
    `;

    if (!event) return fail("Event not found.", 404);

    const processes = await sql`
      select aep.*, p.name as process_name, pv.version_number
      from agenda_event_processes aep
      join process_versions pv on pv.id = aep.process_version_id
      join processes p on p.id = pv.process_id
      where aep.agenda_event_id = ${id}
      order by aep.sort_order asc
    `;

    const occurrences = await sql`
      select ao.*,
        (
          select json_agg(ara.* order by ara.attempt_no asc)
          from agenda_run_attempts ara
          where ara.occurrence_id = ao.id
        ) as attempts
      from agenda_occurrences ao
      where ao.agenda_event_id = ${id}
      order by ao.scheduled_for desc
      limit 50
    `;

    return ok({ event, processes, occurrences });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to load event", 500);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const sql = getSql();
    const { id } = await params;
    const body = (await request.json()) as Json;
    const wid = await workspaceId(sql);
    if (!wid) return fail("Workspace not found", 500);

    const [existing] = await sql`
      select * from agenda_events where id = ${id} and workspace_id = ${wid} limit 1
    `;
    if (!existing) return fail("Event not found.", 404);

    // ── Recurring edit scope handling ──────────────────────────────────────────
    const editScope = body.editScope as string | undefined;
    const occurrenceId = body.occurrenceId as string | undefined;

    if (editScope === "single" && occurrenceId) {
      // Create/update an occurrence override for just this one instance
      const overriddenTitle = body.title !== undefined ? String(body.title).trim() : null;
      const overriddenFreePrompt = body.freePrompt !== undefined ? (body.freePrompt ? String(body.freePrompt) : null) : null;
      const overriddenAgentId = body.agentId !== undefined ? (body.agentId && body.agentId !== 'null' ? String(body.agentId) : null) : null;
      const overriddenStartsAt = body.startsAt !== undefined
        ? (body.startsAt ? new Date(String(body.startsAt)) : null)
        : null;
      // Upsert override
      const [existingOverride] = await sql`
        select id from agenda_occurrence_overrides
        where occurrence_id = ${occurrenceId}
        limit 1
      `;

      if (existingOverride) {
        await sql`
          update agenda_occurrence_overrides set
            overridden_title = coalesce(${overriddenTitle}, overridden_title),
            overridden_free_prompt = coalesce(${overriddenFreePrompt}, overridden_free_prompt),
            overridden_agent_id = coalesce(${overriddenAgentId}, overridden_agent_id),
            overridden_starts_at = coalesce(${overriddenStartsAt}, overridden_starts_at),
            updated_at = now()
          where id = ${existingOverride.id}
        `;
      } else {
        await sql`
          insert into agenda_occurrence_overrides
            (occurrence_id, overridden_title, overridden_free_prompt, overridden_agent_id, overridden_starts_at)
          values (${occurrenceId}, ${overriddenTitle}, ${overriddenFreePrompt}, ${overriddenAgentId}, ${overriddenStartsAt})
        `;
      }

      return ok({ eventId: id, scope: "single", occurrenceId });
    }

    if (editScope === "this_and_future" && occurrenceId) {
      // Split series: end existing series at the occurrence before this one,
      // create a new series starting from this occurrence's date.
      const [occurrence] = await sql`
        select scheduled_for from agenda_occurrences where id = ${occurrenceId} limit 1
      `;
      if (!occurrence) return fail("Occurrence not found.", 404);

      const splitDate = new Date(occurrence.scheduled_for);

      // Update existing series to end just before the split date
      await sql`
        update agenda_events set
          recurrence_until = ${splitDate.toISOString()},
          updated_at = now()
        where id = ${id}
      `;

      // Create new series from the split date with the updated fields
      const title = body.title !== undefined ? String(body.title).trim() : existing.title;
      const freePrompt = body.freePrompt !== undefined ? (body.freePrompt ? String(body.freePrompt) : null) : existing.free_prompt;
      const agentId = body.agentId !== undefined ? (body.agentId && body.agentId !== 'null' ? String(body.agentId) : null) : existing.default_agent_id;
      const timezone = body.timezone !== undefined ? String(body.timezone) : existing.timezone;
      const startsAt = body.startsAt !== undefined
        ? new Date(String(body.startsAt))
        : existing.starts_at;
      const endsAt = body.endsAt !== undefined
        ? (body.endsAt ? new Date(String(body.endsAt)) : null)
        : existing.ends_at;
      const recurrenceRule = body.recurrenceRule !== undefined
        ? (body.recurrenceRule && body.recurrenceRule !== "null" && body.recurrenceRule !== "none" ? String(body.recurrenceRule) : null)
        : existing.recurrence_rule;
      const recurrenceUntil = body.recurrenceUntil !== undefined
        ? (body.recurrenceUntil ? new Date(String(body.recurrenceUntil)) : null)
        : existing.recurrence_until;
      const status = body.status !== undefined ? String(body.status) : existing.status;
      const modelOverrideFuture = body.modelOverride !== undefined ? String(body.modelOverride ?? "") : (existing.model_override ?? "");
      const processVersionIds: string[] = Array.isArray(body.processVersionIds)
        ? body.processVersionIds.map(String)
        : [];

      const [newEvent] = await sql`
        insert into agenda_events (
          workspace_id, title, free_prompt, default_agent_id,
          timezone, starts_at, ends_at, recurrence_rule, recurrence_until, status, model_override, created_by
        ) values (
          ${wid}, ${title}, ${freePrompt}, ${agentId},
          ${timezone}, ${startsAt}, ${endsAt}, ${recurrenceRule}, ${recurrenceUntil}, ${status}, ${modelOverrideFuture}, ${existing.created_by}
        )
        returning *
      `;

      if (processVersionIds.length > 0) {
        for (let i = 0; i < processVersionIds.length; i++) {
          await sql`
            insert into agenda_event_processes (agenda_event_id, process_version_id, sort_order)
            values (${newEvent.id}, ${processVersionIds[i]}, ${i})
          `;
        }
      }

      return ok({ eventId: id, newEventId: newEvent.id, scope: "this_and_future" });
    }

    // ── Standard full-event update ─────────────────────────────────────────────
    const title = body.title !== undefined ? String(body.title).trim() : existing.title;
    const freePrompt = body.freePrompt !== undefined ? (body.freePrompt ? String(body.freePrompt) : null) : existing.free_prompt;
    const agentId = body.agentId !== undefined ? (body.agentId && body.agentId !== 'null' ? String(body.agentId) : null) : existing.default_agent_id;
    const timezone = body.timezone !== undefined ? String(body.timezone) : existing.timezone;
    const startsAt = body.startsAt !== undefined ? new Date(String(body.startsAt)) : existing.starts_at;
    const endsAt = body.endsAt !== undefined ? (body.endsAt ? new Date(String(body.endsAt)) : null) : existing.ends_at;
    const recurrenceRule = body.recurrenceRule !== undefined ? (body.recurrenceRule && body.recurrenceRule !== "null" && body.recurrenceRule !== "none" ? String(body.recurrenceRule) : null) : existing.recurrence_rule;
    const recurrenceUntil = body.recurrenceUntil !== undefined
      ? (body.recurrenceUntil ? new Date(String(body.recurrenceUntil)) : null)
      : existing.recurrence_until;
    const status = body.status !== undefined ? String(body.status) : existing.status;
    const modelOverrideStd = body.modelOverride !== undefined ? String(body.modelOverride ?? "") : (existing.model_override ?? "");

    await sql`
      update agenda_events set
        title = ${title},
        free_prompt = ${freePrompt},
        default_agent_id = ${agentId},
        timezone = ${timezone},
        starts_at = ${startsAt},
        ends_at = ${endsAt},
        recurrence_rule = ${recurrenceRule},
        recurrence_until = ${recurrenceUntil},
        status = ${status},
        model_override = ${modelOverrideStd},
        updated_at = now()
      where id = ${id}
    `;

    // Update process attachments if provided
    if (body.processVersionIds !== undefined) {
      const pvids: string[] = (body.processVersionIds as string[]).map(String);
      await sql`delete from agenda_event_processes where agenda_event_id = ${id}`;
      for (let i = 0; i < pvids.length; i++) {
        await sql`
          insert into agenda_event_processes (agenda_event_id, process_version_id, sort_order)
          values (${id}, ${pvids[i]}, ${i})
        `;
      }
    }

    return ok({ eventId: id });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to update event", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const sql = getSql();
    const { id } = await params;
    const wid = await workspaceId(sql);
    if (!wid) return fail("Workspace not found", 500);

    const [existing] = await sql`
      select id from agenda_events where id = ${id} and workspace_id = ${wid} limit 1
    `;
    if (!existing) return fail("Event not found.", 404);

    await sql`delete from agenda_events where id = ${id}`;
    return ok();
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to delete event", 500);
  }
}
