import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";
import { RRule } from "rrule";

type Json = Record<string, unknown>;

const ok = (data: Json = {}) => NextResponse.json({ ok: true, ...data });
const fail = (message: string, status = 400) =>
  NextResponse.json({ ok: false, error: message }, { status });

async function workspaceId(sql: ReturnType<typeof getSql>) {
  const rows = await sql`select id from workspaces order by created_at asc limit 1`;
  return rows[0]?.id ?? null;
}

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const wid = await workspaceId(sql);
    if (!wid) return ok({ events: [] });

    const url = new URL(request.url);
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");

    let events;
    if (start && end) {
      events = await sql`
        select
          ae.*,
          coalesce(
            (select json_agg(json_build_object(
              'id', aep.id,
              'process_version_id', aep.process_version_id,
              'sort_order', aep.sort_order,
              'process_name', p.name,
              'version_number', pv.version_number
            ) order by aep.sort_order)
            from agenda_event_processes aep
            join process_versions pv on pv.id = aep.process_version_id
            join processes p on p.id = pv.process_id
            where aep.agenda_event_id = ae.id),
            '[]'
          ) as processes
        from agenda_events ae
        where ae.workspace_id = ${wid}
          and (
            (${start}::timestamptz is not null and ae.starts_at <= ${end}::timestamptz)
            and (${end}::timestamptz is not null and (ae.ends_at is null or ae.ends_at >= ${start}::timestamptz))
          )
        order by ae.starts_at asc
      `;
    } else {
      events = await sql`
        select
          ae.*,
          coalesce(
            (select json_agg(json_build_object(
              'id', aep.id,
              'process_version_id', aep.process_version_id,
              'sort_order', aep.sort_order,
              'process_name', p.name,
              'version_number', pv.version_number
            ) order by aep.sort_order)
            from agenda_event_processes aep
            join process_versions pv on pv.id = aep.process_version_id
            join processes p on p.id = pv.process_id
            where aep.agenda_event_id = ae.id),
            '[]'
          ) as processes
        from agenda_events ae
        where ae.workspace_id = ${wid}
        order by ae.starts_at asc
      `;
    }

    // Expand recurring events using RRULE
    if (start && end) {
      const rangeStart = new Date(start);
      const rangeEnd = new Date(end);
      // Set rangeEnd to end of day so the last day is included
      rangeEnd.setHours(23, 59, 59, 999);

      const expanded: Array<Record<string, unknown>> = [];
      for (const event of events) {
        if (!event.recurrence_rule || event.recurrence_rule === "null" || event.recurrence_rule === "none") {
          expanded.push(event);
          continue;
        }

        try {
          const eventStart = new Date(event.starts_at);
          const eventDuration = event.ends_at
            ? new Date(event.ends_at).getTime() - eventStart.getTime()
            : 0;

          const rruleOptions = RRule.parseString(event.recurrence_rule);
          rruleOptions.dtstart = eventStart;
          if (event.recurrence_until) {
            rruleOptions.until = new Date(event.recurrence_until);
          }
          const rule = new RRule(rruleOptions);

          const occurrences = rule.between(rangeStart, rangeEnd, true);

          for (const occ of occurrences) {
            const endsAt = eventDuration
              ? new Date(occ.getTime() + eventDuration).toISOString()
              : event.ends_at;
            expanded.push({
              ...event,
              starts_at: occ.toISOString(),
              ends_at: endsAt,
              _occurrenceDate: occ.toISOString().split("T")[0],
            });
          }
        } catch {
          // If RRULE parsing fails, return event as-is
          expanded.push(event);
        }
      }
      // Attach latest occurrence status to each event
      const expandedIds = expanded.map((e) => (e as Record<string, unknown>).id).filter(Boolean);
      if (expandedIds.length > 0) {
        const occRows = await sql`
          select distinct on (agenda_event_id)
            agenda_event_id, status as latest_occurrence_status
          from agenda_occurrences
          where agenda_event_id = ANY(${expandedIds as string[]})
          order by agenda_event_id, scheduled_for desc
        `;
        const statusMap = new Map<string, string>();
        for (const r of occRows) statusMap.set(r.agenda_event_id, r.latest_occurrence_status);
        for (const e of expanded) {
          (e as Record<string, unknown>).latest_occurrence_status = statusMap.get((e as Record<string, unknown>).id as string) ?? null;
        }
      }
      return ok({ events: expanded });
    }

    // Attach latest occurrence status for non-range queries too
    const eventIds = events.map((e: Record<string, unknown>) => e.id).filter(Boolean);
    if (eventIds.length > 0) {
      const occRows = await sql`
        select distinct on (agenda_event_id)
          agenda_event_id, status as latest_occurrence_status
        from agenda_occurrences
        where agenda_event_id = ANY(${eventIds as string[]})
        order by agenda_event_id, scheduled_for desc
      `;
      const statusMap = new Map<string, string>();
      for (const r of occRows) statusMap.set(r.agenda_event_id, r.latest_occurrence_status);
      for (const e of events) {
        (e as Record<string, unknown>).latest_occurrence_status = statusMap.get((e as Record<string, unknown>).id as string) ?? null;
      }
    }

    return ok({ events });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to load agenda events", 500);
  }
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const body = (await request.json()) as Json;
    const action = String(body.action || "");

    const wid = await workspaceId(sql);
    if (!wid) return fail("Workspace not found", 500);

    if (action === "createEvent") {
      const title = String(body.title || "").trim();
      const freePrompt = body.freePrompt ? String(body.freePrompt) : null;
      const agentId = body.agentId && body.agentId !== 'null' ? String(body.agentId) : null;
      const timezone = String(body.timezone || "Europe/Amsterdam");
      const startsAt = body.startsAt ? new Date(String(body.startsAt)) : null;
      const endsAt = body.endsAt ? new Date(String(body.endsAt)) : null;
      const recurrenceRule = body.recurrenceRule && body.recurrenceRule !== "null" && body.recurrenceRule !== "none" ? String(body.recurrenceRule) : null;
      const recurrenceUntil = body.recurrenceUntil ? new Date(String(body.recurrenceUntil)) : null;
      const status = String(body.status || "draft");
      const modelOverride = body.modelOverride ? String(body.modelOverride) : "";
      const processVersionIds: string[] = Array.isArray(body.processVersionIds)
        ? body.processVersionIds.map(String)
        : [];

      if (!title) return fail("Title is required.");
      if (!startsAt || isNaN(startsAt.getTime())) return fail("Valid start date is required.");

      const [event] = await sql`
        insert into agenda_events (
          workspace_id, title, free_prompt, default_agent_id,
          timezone, starts_at, ends_at, recurrence_rule, recurrence_until, status, model_override, created_by
        ) values (
          ${wid}, ${title}, ${freePrompt}, ${agentId},
          ${timezone}, ${startsAt}, ${endsAt}, ${recurrenceRule}, ${recurrenceUntil}, ${status}, ${modelOverride}, ${body.createdBy ? String(body.createdBy) : null}
        )
        returning *
      `;

      // Attach processes
      for (let i = 0; i < processVersionIds.length; i++) {
        await sql`
          insert into agenda_event_processes (agenda_event_id, process_version_id, sort_order)
          values (${event.id}, ${processVersionIds[i]}, ${i})
        `;
      }

      return ok({ event });
    }

    return fail(`Unsupported action: ${action}`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Agenda event operation failed", 500);
  }
}
