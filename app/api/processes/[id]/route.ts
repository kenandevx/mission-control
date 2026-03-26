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

    return ok({ process, versions, steps });
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
      // Replace steps on the current draft version
      await sql`delete from process_steps where process_version_id = ${latestPv.id}`;
      const steps = body.steps as Json[];
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
  _request: Request,
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

    await sql`delete from processes where id = ${id}`;
    return ok();
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to delete process", 500);
  }
}
