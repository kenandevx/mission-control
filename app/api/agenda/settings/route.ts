import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";

type Json = Record<string, unknown>;

const ok = (data: Json = {}): NextResponse => NextResponse.json({ ok: true, ...data });
const fail = (message: string, status = 400): NextResponse =>
  NextResponse.json({ ok: false, error: message }, { status });

async function workspaceId(sql: ReturnType<typeof getSql>): Promise<string | null> {
  const rows = await sql`select id from workspaces order by created_at asc limit 1`;
  return rows[0]?.id ?? null;
}

export async function GET(): Promise<NextResponse> {
  try {
    const sql = getSql();
    const wid = await workspaceId(sql);
    if (!wid) return fail("Workspace not found", 500);

    const [row] = await sql`
      select
        default_execution_window_minutes,
        auto_retry_after_minutes,
        max_retries,
        agenda_concurrency,
        scheduling_interval_minutes
      from worker_settings
      where id = 1
      limit 1
    `;

    return ok({
      defaultExecutionWindowMinutes: Number(row?.default_execution_window_minutes ?? 30),
      autoRetryAfterMinutes: Number(row?.auto_retry_after_minutes ?? 0),
      maxRetries: Number(row?.max_retries ?? 1),
      agendaConcurrency: Number(row?.agenda_concurrency ?? 5),
      schedulingIntervalMinutes: Number(row?.scheduling_interval_minutes ?? 15),
    });
  } catch {
    return fail("Failed to load agenda settings", 500);
  }
}
