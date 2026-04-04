import { getSql } from "@/lib/local-db";

export const dynamic = "force-dynamic";

function sse(data: unknown, event = "message") {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET() {
  const sql = getSql();
  const encoder = new TextEncoder();

  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let listenerActivity: { unlisten: () => Promise<void> } | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(sse({ connected: true }, "ready")));

      keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(sse({ ok: true }, "ping")));
      }, 20000);

      // Note: worker_tick listener removed in v2 (BullMQ/Redis removed; execution via openclaw cron)

      // Listen for ticket activity notifications (by ID)
      listenerActivity = await sql.listen("ticket_activity", async (payload) => {
        const id = String(payload || "").trim();
        if (!id) return;
        try {
          const rows = await sql`
            select
              ta.id,
              ta.ticket_id,
              ta.source,
              ta.event,
              ta.details,
              ta.level,
              ta.occurred_at,
              t.title as ticket_title,
              t.board_id
            from ticket_activity ta
            left join tickets t on t.id = ta.ticket_id
            where ta.id::text = ${id}
            limit 1
          `;
          const row = rows[0] || null;
          if (!row) return;
          controller.enqueue(encoder.encode(sse({ row }, "ticket_activity")));
        } catch (err) {
          // ignore
        }
      });
    },
    async cancel() {
      if (keepAlive) clearInterval(keepAlive);
      keepAlive = null;
      if (listenerActivity) await listenerActivity.unlisten();
      listenerActivity = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
