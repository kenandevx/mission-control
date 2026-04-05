import { getSql } from "@/lib/local-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SSE endpoint — streams agenda change notifications via PostgreSQL LISTEN/NOTIFY.
 * Clients receive an `agenda_change` event whenever events or occurrences mutate,
 * then refetch the data they need.
 */
export async function GET(request: Request): Promise<Response> {
  const encoder = new TextEncoder();
  const sql = getSql();

  // AbortSignal from the client disconnect
  const { signal } = request;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let cleanupStarted = false;

      const cleanup = () => {
        if (cleanupStarted) return;
        cleanupStarted = true;
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        if (unlisten) unlisten().catch(() => {});
        try { controller.close(); } catch { /* already closed */ }
      };

      const send = (event: string, data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          // client disconnected
          cleanup();
        }
      };

      // Heartbeat every 25s to keep connection alive through proxies/load balancers
      const heartbeat = setInterval(() => send("ping", "keepalive"), 25_000);

      // Listen on the agenda_change PG channel
      let unlisten: (() => Promise<void>) | null = null;
      try {
        const listenMeta = await sql.listen("agenda_change", (payload: string) => {
          send("agenda_change", payload || JSON.stringify({ ts: Date.now() }));
        });
        unlisten = () => listenMeta.unlisten();
      } catch {
        // If listen fails, we still serve heartbeats (graceful degradation)
      }

      // Handle client disconnect via AbortSignal
      signal.addEventListener("abort", cleanup, { once: true });

      // Send initial connected event
      send("connected", JSON.stringify({ ts: Date.now() }));
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
