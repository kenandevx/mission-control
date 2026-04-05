import { getSql } from "@/lib/local-db";

export const dynamic = "force-dynamic";

function sse(data: unknown, event = "message") {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET() {
  const sql = getSql();
  const encoder = new TextEncoder();

  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let listener: { unlisten: () => Promise<void> } | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const cleanup = async () => {
        if (closed) return;
        closed = true;
        if (keepAlive) clearInterval(keepAlive);
        keepAlive = null;
        if (listener) await listener.unlisten().catch(() => {});
        listener = null;
        try { controller.close(); } catch { /* already closed */ }
      };

      const send = async (payload: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          await cleanup();
        }
      };

      await send(sse({ connected: true }, "ready"));

      keepAlive = setInterval(() => {
        void send(sse({ ok: true }, "ping"));
      }, 20000);

      listener = await sql.listen("agent_logs", async (payload) => {
        const id = String(payload || "").trim();
        if (!id) return;
        const rows = await sql`
          select
            l.id,
            l.agent_id,
            l.runtime_agent_id,
            l.occurred_at,
            l.level,
            l.type,
            l.run_id,
            l.message,
            l.event_id,
            l.event_type,
            l.direction,
            l.channel_type,
            l.session_key,
            l.source_message_id,
            l.correlation_id,
            l.status,
            l.retry_count,
            l.message_preview,
            l.is_json,
            l.contains_pii,
            l.memory_source,
            l.memory_key,
            l.collection,
            l.query_text,
            l.result_count,
            l.raw_payload,
            a.openclaw_agent_id as agent_name
          from agent_logs l
          left join agents a on a.id = l.agent_id
          where l.id::text = ${id}
          limit 1
        `;
        const row = rows[0] || null;
        if (!row) return;
        await send(sse({ row }, "log_row"));
      });
    },
    async cancel() {
      closed = true;
      if (keepAlive) clearInterval(keepAlive);
      keepAlive = null;
      if (listener) await listener.unlisten().catch(() => {});
      listener = null;
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
