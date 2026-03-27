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

export async function GET() {
  try {
    const sql = getSql();
    const wid = await workspaceId(sql);
    if (!wid) return ok({ processes: [] });

    const processes = await sql`
      with step_counts as (
        select pv.process_id, count(ps.id)::int as step_count
        from process_versions pv
        left join process_steps ps on ps.process_version_id = pv.id
        group by pv.process_id
      ),
      latest_versions as (
        select distinct on (pv.process_id)
          pv.process_id,
          pv.id,
          pv.version_number
        from process_versions pv
        order by pv.process_id, pv.version_number desc
      )
      select
        p.id,
        p.name,
        p.description,
        p.status,
        p.created_by,
        p.created_at,
        p.updated_at,
        lv.id as latest_version_id,
        lv.version_number,
        coalesce(sc.step_count, 0) as step_count
      from processes p
      left join latest_versions lv on lv.process_id = p.id
      left join step_counts sc on sc.process_id = p.id
      where p.workspace_id = ${wid}
      order by p.created_at desc
    `;

    return ok({ processes });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to load processes", 500);
  }
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const body = (await request.json()) as Json;
    const action = String(body.action || "");

    const wid = await workspaceId(sql);
    if (!wid) return fail("Workspace not found", 500);

    if (action === "createProcess") {
      const name = String(body.name || "").trim();
      const description = String(body.description || "").trim();
      const status = String(body.status || "draft");
      const steps: Json[] = Array.isArray(body.steps) ? body.steps as Json[] : [];

      if (!name) return fail("Process name is required.");

      // Insert process
      const [proc] = await sql`
        insert into processes (workspace_id, name, description, status, created_by)
        values (${wid}, ${name}, ${description || null}, ${status}, ${body.createdBy ? String(body.createdBy) : null})
        returning *
      `;

      // Create version 1
      const versionLabel = body.versionLabel ? String(body.versionLabel).trim() : "";
      const [version] = await sql`
        insert into process_versions (process_id, version_number, published_at, version_label)
        values (${proc.id}, 1, ${status === "published" ? new Date() : null}, ${versionLabel})
        returning *
      `;

      // Insert steps
      if (steps.length > 0) {
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          await sql`
            insert into process_steps (process_version_id, step_order, title, instruction, skill_key, agent_id, timeout_seconds, model_override)
            values (
              ${version.id},
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

      return ok({ process: { ...proc, latest_version_id: version.id, version_number: 1, step_count: steps.length } });
    }

    if (action === "duplicateProcess") {
      const processId = String(body.processId || "");

      const [source] = await sql`select * from processes where id = ${processId} and workspace_id = ${wid} limit 1`;
      if (!source) return fail("Process not found.", 404);

      const [latestPv] = await sql`
        select pv.* from process_versions pv
        where pv.process_id = ${processId}
        order by pv.version_number desc limit 1
      `;

      const [newProc] = await sql`
        insert into processes (workspace_id, name, description, status, created_by)
        values (${wid}, ${source.name + " (copy)"}, ${source.description}, 'draft', ${source.created_by})
        returning *
      `;

      const [newPv] = await sql`
        insert into process_versions (process_id, version_number)
        values (${newProc.id}, 1)
        returning *
      `;

      if (latestPv) {
        const oldSteps = await sql`
          select * from process_steps
          where process_version_id = ${latestPv.id}
          order by step_order asc
        `;
        for (const s of oldSteps) {
          await sql`
            insert into process_steps (process_version_id, step_order, title, instruction, skill_key, agent_id, timeout_seconds, model_override)
            values (${newPv.id}, ${s.step_order}, ${s.title}, ${s.instruction}, ${s.skill_key}, ${s.agent_id}, ${s.timeout_seconds}, ${s.model_override || ""})
          `;
        }
      }

      return ok({ process: newProc });
    }

    return fail(`Unsupported action: ${action}`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Process operation failed", 500);
  }
}
