import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";

export const dynamic = "force-dynamic";

type ActivityEntry = {
  id: string;
  type: "ticket" | "agenda";
  title: string;
  event: string;
  agent: string;
  level: string;
  timestamp: string;
  targetUrl?: string;
};

function agendaLevelFromStatus(status: string): string {
  switch (status) {
    case "succeeded":
      return "success";
    case "failed":
    case "needs_retry":
      return "error";
    case "running":
      return "warning";
    default:
      return "info";
  }
}

export async function GET(): Promise<Response> {
  try {
    const sql = getSql();

    let limit = 8;
    try {
      const [settingsRow] = await sql`SELECT sidebar_activity_count FROM worker_settings WHERE id = 1 LIMIT 1`;
      limit = Math.min(Math.max(Number(settingsRow?.sidebar_activity_count ?? 8), 1), 30);
    } catch {
      limit = 8;
    }

    const ticketRows = await sql`
      SELECT
        ta.id::text,
        ta.ticket_id::text,
        ta.source,
        ta.event,
        ta.level,
        ta.occurred_at,
        t.title AS ticket_title
      FROM ticket_activity ta
      LEFT JOIN tickets t ON t.id = ta.ticket_id
      ORDER BY ta.occurred_at DESC
      LIMIT ${limit}
    `;

    const agendaRows = await sql`
      SELECT
        ara.id::text,
        ara.occurrence_id::text,
        ao.agenda_event_id::text,
        ara.status,
        ara.started_at,
        ae.title,
        ae.default_agent_id AS agent_id
      FROM agenda_run_attempts ara
      JOIN agenda_occurrences ao ON ao.id = ara.occurrence_id
      JOIN agenda_events ae ON ae.id = ao.agenda_event_id
      ORDER BY ara.started_at DESC
      LIMIT ${limit}
    `;

    const entries: ActivityEntry[] = [];

    for (const row of ticketRows) {
      entries.push({
        id: `ticket-${row.id}`,
        type: "ticket",
        title: row.ticket_title || "Unknown ticket",
        event: row.event || "activity",
        agent: row.source || "Worker",
        level: row.level || "info",
        timestamp: row.occurred_at || new Date().toISOString(),
        targetUrl: row.ticket_id ? `/boards?ticket=${encodeURIComponent(String(row.ticket_id))}` : "/boards",
      });
    }

    for (const row of agendaRows) {
      entries.push({
        id: `agenda-${row.id}`,
        type: "agenda",
        title: row.title || "Unknown event",
        event: row.status || "change",
        agent: row.agent_id || "main",
        level: agendaLevelFromStatus(row.status || ""),
        timestamp: row.started_at || new Date().toISOString(),
        targetUrl: row.agenda_event_id ? `/agenda?event=${encodeURIComponent(String(row.agenda_event_id))}` : "/agenda",
      });
    }

    entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return NextResponse.json({ ok: true, entries: entries.slice(0, limit), limit });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to load recent activity" },
      { status: 500 },
    );
  }
}
