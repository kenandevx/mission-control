import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { LogsPageClient } from "@/components/agents/logs-page-client";
import { getSql } from "@/lib/local-db";
import type { AgentLog } from "@/types/agents";
import { PageReveal } from "@/components/ui/page-reveal";

export const dynamic = "force-dynamic";

type LogRow = {
  id: string;
  agent_id: string;
  runtime_agent_id: string | null;
  occurred_at: string;
  level: AgentLog["level"];
  type: AgentLog["type"];
  run_id: string | null;
  message: string | null;
  event_id: string | null;
  event_type: AgentLog["eventType"] | null;
  direction: AgentLog["direction"] | null;
  channel_type: AgentLog["channelType"] | null;
  session_key: string | null;
  source_message_id: string | null;
  correlation_id: string | null;
  status: string | null;
  retry_count: number | null;
  message_preview: string | null;
  is_json: boolean | null;
  contains_pii: boolean | null;
  memory_source: AgentLog["memorySource"] | null;
  memory_key: string | null;
  collection: string | null;
  query_text: string | null;
  result_count: number | null;
  raw_payload: unknown | null;
};

export default async function LogsPage() {
  const sql = getSql();
  const limit = 50;
  const page = 1;
  const offset = 0;

  const [{ count }] = await sql`select count(*)::int as count from agent_logs`;

  const rows = await sql<LogRow[]>`
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
      l.raw_payload
    from agent_logs l
    order by l.occurred_at desc
    limit ${limit}
    offset ${offset}
  `;

  const initialLogs: AgentLog[] = rows.map((row) => ({
    id: row.id,
    agentId: row.runtime_agent_id || row.agent_id,
    occurredAt: row.occurred_at,
    level: row.level,
    type: row.type,
    runId: row.run_id || "",
    message: row.message || "",
    eventId: row.event_id || undefined,
    eventType: row.event_type || undefined,
    direction: row.direction || undefined,
    channelType: row.channel_type || undefined,
    sessionKey: row.session_key || undefined,
    sourceMessageId: row.source_message_id || undefined,
    correlationId: row.correlation_id || undefined,
    status: row.status || undefined,
    retryCount: row.retry_count ?? undefined,
    messagePreview: row.message_preview || undefined,
    isJson: row.is_json ?? undefined,
    containsPii: row.contains_pii ?? undefined,
    memorySource: row.memory_source || undefined,
    memoryKey: row.memory_key || undefined,
    collection: row.collection || undefined,
    queryText: row.query_text || undefined,
    resultCount: row.result_count ?? undefined,
    rawPayload: row.raw_payload ?? null,
  }));

  const pageInfo = {
    page,
    limit,
    totalCount: count,
    pageCount: Math.max(1, Math.ceil(Number(count || 0) / limit)),
  };
  const initialNowIso = new Date().toISOString();

  return (
    <SidebarProvider
      style={{ "--sidebar-width": "calc(var(--spacing) * 72)", "--header-height": "calc(var(--spacing) * 14)" } as React.CSSProperties}
    >
      <AppSidebar variant="inset" initialUser={null} />
      <SidebarInset>
        <PageReveal label="Loading logs…">
          <LogsPageClient initialLogs={initialLogs} initialAgents={[]} initialPageInfo={pageInfo} initialNowIso={initialNowIso} />
        </PageReveal>
      </SidebarInset>
    </SidebarProvider>
  );
}
