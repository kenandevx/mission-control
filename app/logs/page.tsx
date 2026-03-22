import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { LogsPageClient } from "@/components/agents/logs-page-client";
import { getSql } from "@/lib/local-db";

export const dynamic = "force-dynamic";

export default async function LogsPage() {
  const sql = getSql();
  const limit = 50;
  const page = 1;
  const offset = 0;

  const [{ count }] = await sql`select count(*)::int as count from agent_logs`;

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
    order by l.occurred_at desc
    limit ${limit}
    offset ${offset}
  `;

  const pageInfo = {
    page,
    limit,
    totalCount: count,
    pageCount: Math.max(1, Math.ceil(Number(count || 0) / limit)),
  };

  return (
    <SidebarProvider style={{ "--sidebar-width": "calc(var(--spacing) * 72)", "--header-height": "calc(var(--spacing) * 14)" } as React.CSSProperties}>
      <AppSidebar variant="inset" initialUser={null} />
      <SidebarInset>
        <LogsPageClient initialLogs={rows as never[]} initialAgents={[]} initialPageInfo={pageInfo} />
      </SidebarInset>
    </SidebarProvider>
  );
}
