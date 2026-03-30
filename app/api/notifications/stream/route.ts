import { getSql } from "@/lib/local-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

function levelFromAction(action: string): string {
  switch (action) {
    case "succeeded":
      return "success";
    case "failed":
    case "needs_retry":
    case "stale_recovery":
      return "error";
    case "running":
    case "auto_retry":
      return "warning";
    default:
      return "info";
  }
}

/**
 * Unified SSE endpoint — streams live activity from both the ticket system
 * and the agenda system via PostgreSQL LISTEN/NOTIFY.
 */
export async function GET(request: Request): Promise<Response> {
  const sql = getSql();
  const encoder = new TextEncoder();
  const { signal } = request;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const send = (event: string, data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          cleanup();
        }
      };

      // Heartbeat every 25s
      const heartbeat = setInterval(() => send("ping", "keepalive"), 25_000);

      let unlistenTicket: (() => Promise<void>) | null = null;
      let unlistenAgenda: (() => Promise<void>) | null = null;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        if (unlistenTicket) unlistenTicket().catch(() => {});
        if (unlistenAgenda) unlistenAgenda().catch(() => {});
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      signal.addEventListener("abort", cleanup, { once: true });

      // Send initial connected event
      send("connected", JSON.stringify({ ts: Date.now() }));

      // Listen for ticket activity
      try {
        const meta = await sql.listen("ticket_activity", async (payload: string) => {
          const id = String(payload || "").trim();
          if (!id) return;
          try {
            const rows = await sql`
              SELECT
                ta.id,
                ta.ticket_id,
                ta.source,
                ta.event,
                ta.level,
                ta.occurred_at,
                t.title AS ticket_title
              FROM ticket_activity ta
              LEFT JOIN tickets t ON t.id = ta.ticket_id
              WHERE ta.id::text = ${id}
              LIMIT 1
            `;
            const row = rows[0];
            if (!row) return;
            const entry: ActivityEntry = {
              id: `ticket-${row.id}`,
              type: "ticket",
              title: row.ticket_title || "Unknown ticket",
              event: row.event || "activity",
              agent: row.source || "Worker",
              level: row.level || "info",
              timestamp: row.occurred_at || new Date().toISOString(),
              targetUrl: row.ticket_id ? `/boards?ticket=${encodeURIComponent(String(row.ticket_id))}` : "/boards",
            };
            send("activity", JSON.stringify(entry));
          } catch {
            /* ignore lookup errors */
          }
        });
        unlistenTicket = () => meta.unlisten();
      } catch {
        /* graceful degradation */
      }

      // Listen for agenda changes
      try {
        const meta = await sql.listen("agenda_change", async (payload: string) => {
          try {
            const data = typeof payload === "string" ? JSON.parse(payload) : payload;
            const action = data?.action || "change";
            const occurrenceId = data?.occurrenceId;
            if (!occurrenceId) return;

            // Look up occurrence + event details
            const rows = await sql`
              SELECT
                ao.id,
                ao.status,
                ao.agenda_event_id,
                ae.title,
                ae.default_agent_id AS agent_id
              FROM agenda_occurrences ao
              JOIN agenda_events ae ON ae.id = ao.agenda_event_id
              WHERE ao.id = ${occurrenceId}
              LIMIT 1
            `;
            const row = rows[0];
            if (!row) return;

            const entry: ActivityEntry = {
              id: `agenda-${occurrenceId}-${Date.now()}`,
              type: "agenda",
              title: row.title || "Unknown event",
              event: action,
              agent: row.agent_id || "main",
              level: levelFromAction(action),
              timestamp: new Date().toISOString(),
            };
            send("activity", JSON.stringify(entry));
          } catch {
            /* ignore parse/lookup errors */
          }
        });
        unlistenAgenda = () => meta.unlisten();
      } catch {
        /* graceful degradation */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
