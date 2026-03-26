import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sql = getSql();
  const url = new URL(request.url);

  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 200);
  const page = Math.max(Number(url.searchParams.get("page") || 1), 1);
  const offset = (page - 1) * limit;
  const agentIdFilter = url.searchParams.get("agentId")?.trim() || null;

  const [{ count }] = agentIdFilter
    ? await sql`select count(*)::int as count from agent_logs where runtime_agent_id = ${agentIdFilter}`
    : await sql`select count(*)::int as count from agent_logs`;

  const rows = agentIdFilter
    ? await sql`
      select
        l.id, l.agent_id, l.runtime_agent_id, l.occurred_at, l.level, l.type,
        l.run_id, l.message, l.event_id, l.event_type, l.direction, l.channel_type,
        l.session_key, l.source_message_id, l.correlation_id, l.status, l.retry_count,
        l.message_preview, l.is_json, l.contains_pii, l.memory_source, l.memory_key,
        l.collection, l.query_text, l.result_count, l.raw_payload,
        a.openclaw_agent_id as agent_name
      from agent_logs l
      left join agents a on a.id = l.agent_id
      where l.runtime_agent_id = ${agentIdFilter}
      order by l.occurred_at desc
      limit ${limit}
      offset ${offset}
    `
    : await sql`
      select
        l.id, l.agent_id, l.runtime_agent_id, l.occurred_at, l.level, l.type,
        l.run_id, l.message, l.event_id, l.event_type, l.direction, l.channel_type,
        l.session_key, l.source_message_id, l.correlation_id, l.status, l.retry_count,
        l.message_preview, l.is_json, l.contains_pii, l.memory_source, l.memory_key,
        l.collection, l.query_text, l.result_count, l.raw_payload,
        a.openclaw_agent_id as agent_name
      from agent_logs l
      left join agents a on a.id = l.agent_id
      order by l.occurred_at desc
      limit ${limit}
      offset ${offset}
    `;

  return NextResponse.json({
    logs: rows,
    pageInfo: {
      page,
      limit,
      totalCount: count,
      pageCount: Math.max(1, Math.ceil(Number(count || 0) / limit)),
    },
  });
}

export async function POST(request: Request) {
  const sql = getSql();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const runtimeAgentId = String(body.runtimeAgentId || body.agentId || "").trim();
  const level = String(body.level || "info").trim();
  const type = String(body.type || "system").trim();
  const eventType = String(body.eventType || "").trim();
  const messageRaw = body.message ?? body.messagePreview ?? "";
  const message = (typeof messageRaw === "string" ? messageRaw : JSON.stringify(messageRaw)).trim();
  const sessionKey = String(body.sessionKey || "").trim() || null;
  const channelType = String(body.channelType || "").trim() || null;
  const memorySource = String(body.memorySource || "").trim() || null;
  const memoryKey = String(body.memoryKey || "").trim() || null;
  const collection = String(body.collection || "").trim() || null;
  const queryText = String(body.queryText || "").trim() || null;
  const resultCount = typeof body.resultCount === "number" ? body.resultCount : null;

  const workspace = await sql`select id from workspaces order by created_at asc limit 1`;
  const workspaceId = workspace[0]?.id ?? null;
  if (!workspaceId) return NextResponse.json({ ok: false, error: "No workspace found." }, { status: 400 });

  const agentRows = await sql`select id from agents where workspace_id = ${workspaceId} and openclaw_agent_id = ${runtimeAgentId} limit 1`;
  const agentDbId = agentRows[0]?.id ?? null;
  const inserted = await sql`
    insert into agent_logs (
      workspace_id, agent_id, runtime_agent_id, occurred_at, level, type, message, event_type, session_key,
      channel_type, memory_source, memory_key, collection, query_text, result_count, message_preview
    ) values (
      ${workspaceId}, ${agentDbId || workspaceId}, ${runtimeAgentId}, now(), ${level}, ${type}, ${message}, ${eventType}, ${sessionKey},
      ${channelType}, ${memorySource}, ${memoryKey}, ${collection}, ${queryText}, ${resultCount}, ${message.slice(0, 240)}
    ) returning *
  `;

  if (inserted[0]?.id) {
    await sql`select pg_notify('agent_logs', ${String(inserted[0].id)})`;
  }

  return NextResponse.json({ ok: true, log: inserted[0] ?? null });
}

export async function DELETE() {
  const sql = getSql();
  await sql`delete from agent_logs`;
  return NextResponse.json({ ok: true });
}
