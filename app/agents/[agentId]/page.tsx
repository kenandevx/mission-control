import { notFound } from "next/navigation";
import { getAgentDetailsData, getSidebarUser } from "@/lib/db/server-data";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageHeader } from "@/components/layout/page-header";
import { AgentDebugOverlay } from "@/components/agents/agent-debug-overlay";
import { AgentStatusBadge, formatAgentName } from "@/components/agents/agent-ui";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";

export default async function AgentPage({ params }: { params: Promise<{ agentId: string }> }) {
  const [{ agentId }, sidebarUser, data] = await Promise.all([params, getSidebarUser(), getAgentDetailsData()]);
  const agent = data.agent;
  if (!agent || agent.id !== agentId) notFound();

  return (
    <SidebarProvider style={{ "--sidebar-width": "calc(var(--spacing) * 72)", "--header-height": "calc(var(--spacing) * 14)" } as React.CSSProperties}>
      <AppSidebar variant="inset" initialUser={sidebarUser} />
      <SidebarInset>
        <PageHeader page="Agent" />
        <div className="flex flex-1 flex-col gap-4 px-3 py-4 sm:px-4 lg:gap-6 lg:px-6">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div className="space-y-2">
                <CardTitle className="text-2xl">{formatAgentName(agent.name)}</CardTitle>
                <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                  <span>ID: {agent.id}</span>
                  <span>Model: {agent.runtime.model ?? "unknown"}</span>
                  <span>Heartbeat: {agent.runtime.lastHeartbeatAt ? formatDistanceToNow(new Date(agent.runtime.lastHeartbeatAt), { addSuffix: true }) : "unknown"}</span>
                  <span>Queue: {agent.runtime.queueDepth ?? 0}</span>
                </div>
              </div>
              <AgentStatusBadge status={agent.status} />
            </CardHeader>
            <CardContent className="space-y-4">
              <AgentDebugOverlay agent={agent} />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Status</CardTitle></CardHeader><CardContent><Badge variant="outline">{agent.status}</Badge></CardContent></Card>
                <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Model</CardTitle></CardHeader><CardContent>{agent.runtime.model ?? "unknown"}</CardContent></Card>
                <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Last heartbeat</CardTitle></CardHeader><CardContent>{agent.runtime.lastHeartbeatAt ? formatDistanceToNow(new Date(agent.runtime.lastHeartbeatAt), { addSuffix: true }) : "unknown"}</CardContent></Card>
                <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Queue depth</CardTitle></CardHeader><CardContent>{agent.runtime.queueDepth ?? 0}</CardContent></Card>
              </div>
              <Empty className="min-h-40"><EmptyHeader><EmptyTitle>More agent data coming soon</EmptyTitle><EmptyDescription>This page now shows the live agent snapshot for {agent.id}.</EmptyDescription></EmptyHeader></Empty>
            </CardContent>
          </Card>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
