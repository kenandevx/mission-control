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

function validateProcessSteps(steps: Json[]): string | null {
  if (!Array.isArray(steps) || steps.length === 0) return "At least one step is required.";
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const title = String(step.title || "").trim();
    const instruction = String(step.instruction || "").trim();
    if (!title) return `Step ${i + 1}: title is required.`;
    if (!instruction) return `Step ${i + 1}: instruction is required.`;
  }
  return null;
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

    const [process] = await sql`
      select p.*,
        pv.id as latest_version_id,
        pv.version_number,
        pv.version_label
      from processes p
      left join process_versions pv on pv.process_id = p.id
        and pv.version_number = (
          select max(pv2.version_number)
          from process_versions pv2
          where pv2.process_id = p.id
        )
      where p.id = ${id} and p.workspace_id = ${wid}
      limit 1
    `;

    if (!process) return fail("Process not found.", 404);

    const versions = await sql`
      select * from process_versions
      where process_id = ${id}
      order by version_number desc
    `;

    const steps = await sql`
      select ps.*
      from process_steps ps
      join process_versions pv on pv.id = ps.process_version_id
      where ps.process_version_id = ${process.latest_version_id}
      order by ps.step_order asc
    `;

    // Find agenda events tied to any version of this process
    const tiedEvents = await sql`
      select distinct ae.id, ae.title
      from agenda_events ae
      join agenda_event_processes aep on aep.agenda_event_id = ae.id
      join process_versions pv on pv.id = aep.process_version_id
      where pv.process_id = ${id}
    `;

    return ok({ process, versions, steps, tiedEvents });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to load process", 500);
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
      select * from processes where id = ${id} and workspace_id = ${wid} limit 1
    `;
    if (!existing) return fail("Process not found.", 404);

    const [latestPv] = await sql`
      select * from process_versions
      where process_id = ${id}
      order by version_number desc limit 1
    `;

    const name = body.name !== undefined ? String(body.name).trim() : existing.name;
    const description = body.description !== undefined ? String(body.description) : existing.description;
    const status = body.status !== undefined ? String(body.status) : existing.status;

    // If publishing, bump version and publish
    if (status === "published" && existing.status !== "published" && latestPv) {
      const newVersionNumber = latestPv.version_number + 1;
      const versionLabel = body.versionLabel ? String(body.versionLabel).trim() : "";

      const [newPv] = await sql`
        insert into process_versions (process_id, version_number, published_at, version_label)
        values (${id}, ${newVersionNumber}, now(), ${versionLabel})
        returning *
      `;

      const steps: Json[] = Array.isArray(body.steps) ? body.steps as Json[] : [];
      const stepValidationError = validateProcessSteps(steps);
      if (stepValidationError) return fail(stepValidationError);
      if (steps.length > 0) {
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          await sql`
            insert into process_steps (process_version_id, step_order, title, instruction, skill_key, agent_id, timeout_seconds, model_override)
            values (
              ${newPv.id},
              ${i},
              ${String(step.title || "")},
              ${String(step.instruction || "")},
              ${step.skillKey ? String(step.skillKey) : null},
              ${step.agentId ? String(step.agentId) : null},
              ${step.timeoutSeconds ? Number(step.timeoutSeconds) : null},
              ${step.modelOverride ? String(step.modelOverride) : ""}
            )
          `;
        }
      }

      await sql`
        update processes
        set name = ${name},
            description = ${description || null},
            status = ${status},
            updated_at = now()
        where id = ${id}
      `;

      return ok({ processId: id, newVersion: newVersionNumber });
    }

    // Draft update: update latest version in place
    await sql`
      update processes
      set name = ${name},
          description = ${description || null},
          status = ${status},
          updated_at = now()
      where id = ${id}
    `;

    // Update version label if provided
    if (body.versionLabel !== undefined && latestPv) {
      await sql`
        update process_versions
        set version_label = ${String(body.versionLabel).trim()}
        where id = ${latestPv.id}
      `;
    }

    if (Array.isArray(body.steps) && latestPv) {
      const steps = body.steps as Json[];
      const stepValidationError = validateProcessSteps(steps);
      if (stepValidationError) return fail(stepValidationError);

      // Replace steps on the current draft version
      await sql`delete from process_steps where process_version_id = ${latestPv.id}`;
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        await sql`
          insert into process_steps (process_version_id, step_order, title, instruction, skill_key, agent_id, timeout_seconds, model_override)
          values (
            ${latestPv.id},
            ${i},
            ${String(step.title || "")},
            ${String(step.instruction || "")},
            ${step.skillKey ? String(step.skillKey) : null},
            ${step.agentId ? String(step.agentId) : null},
            ${step.timeoutSeconds ? Number(step.timeoutSeconds) : null},
            ${step.modelOverride ? String(step.modelOverride) : ""}
          )
        `;
      }
    }

    return ok({ processId: id });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to update process", 500);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const sql = getSql();
    const { id } = await params;
    const wid = await workspaceId(sql);
    if (!wid) return fail("Workspace not found", 500);

    const [existing] = await sql`
      select id from processes where id = ${id} and workspace_id = ${wid} limit 1
    `;
    if (!existing) return fail("Process not found.", 404);

    const force = new URL(request.url).searchParams.get("force") === "1";

    const tiedEvents = await sql`
      select distinct ae.id, ae.title
      from agenda_events ae
      join agenda_event_processes aep on aep.agenda_event_id = ae.id
      join process_versions pv on pv.id = aep.process_version_id
      where pv.process_id = ${id}
      order by ae.title asc
    `;

    const tiedEventIds = tiedEvents.map((r) => (r as { id: string }).id);

    // Hard safety: never allow delete while any tied occurrence is currently running.
    if (tiedEventIds.length > 0) {
      const runningRows = await sql`
        select ao.id, ao.agenda_event_id
        from agenda_occurrences ao
        where ao.agenda_event_id = ANY(${tiedEventIds})
          and ao.status = 'running'
        limit 5
      `;
      if (runningRows.length > 0) {
        return fail("Cannot delete process while a tied agenda event is running. Wait for it to finish, then retry.", 409);
      }
    }

    // If tied agenda events exist, require explicit force delete.
    if (tiedEvents.length > 0 && !force) {
      return NextResponse.json({
        ok: false,
        error: "This process is tied to active agenda events. Remove those links first or force delete.",
        code: "PROCESS_IN_USE",
        tiedEvents,
      }, { status: 409 });
    }

    let deletedAgendaEvents = 0;
    if (tiedEventIds.length > 0 && force) {
      await sql`delete from agenda_events where id = ANY(${tiedEventIds})`;
      deletedAgendaEvents = tiedEventIds.length;
      await sql`SELECT pg_notify('agenda_change', ${JSON.stringify({ action: "force_delete_events" })})`;
    }

    await sql`delete from processes where id = ${id}`;
    return ok({ deletedAgendaEvents, tiedEvents: tiedEvents.length, forced: force });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to delete process", 500);
  }
}
