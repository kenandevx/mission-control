import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";

type Json = Record<string, unknown>;

const ok = (data: Json = {}) => NextResponse.json({ ok: true, ...data });
const fail = (message: string, status = 400) => NextResponse.json({ ok: false, error: message }, { status });

export async function GET() {
  try {
    const sql = getSql();
    const wid = await sql`select id from workspaces order by created_at asc limit 1`;
    const workspaceId = wid[0]?.id;
    if (!workspaceId) {
      return ok({ enabled: false, maxConcurrency: 0, activeNow: 0, queuedCount: 0, lastTickAt: null });
    }

    // Get worker settings
    const settingsRows = await sql`
      select enabled, poll_interval_seconds, max_concurrency, last_tick_at
      from worker_settings
      where id = 1
      limit 1
    `;
    const settings = settingsRows[0] ?? { enabled: false, max_concurrency: 0, last_tick_at: null };

    // Count active executions (tickets in 'executing' state with recent heartbeat)
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const activeRows = await sql`
      select count(*) as count
      from tickets
      where workspace_id = ${workspaceId}
        and execution_state = 'executing'
        and updated_at >= ${fiveMinAgo}
    `;
    const activeNow = Number(activeRows[0]?.count ?? 0);

    // Count queued tickets (states: queued, ready_to_execute, pending)
    const queuedRows = await sql`
      select count(*) as count
      from tickets
      where workspace_id = ${workspaceId}
        and execution_state in ('queued', 'ready_to_execute', 'pending')
    `;
    const queuedCount = Number(queuedRows[0]?.count ?? 0);

    return ok({
      enabled: Boolean(settings.enabled),
      maxConcurrency: Number(settings.max_concurrency ?? 0),
      activeNow,
      queuedCount,
      lastTickAt: settings.last_tick_at ? String(settings.last_tick_at) : null,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to load worker metrics", 500);
  }
}
