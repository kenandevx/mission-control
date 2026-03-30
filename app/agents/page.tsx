import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageHeader } from "@/components/layout/page-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AgentsClientGrid } from "./agents-client";
import { PageReveal } from "@/components/ui/page-reveal";

export const dynamic = "force-dynamic";

export default function AgentsPage() {
  const showAgentDebug = process.env.NEXT_PUBLIC_AGENT_DEBUG_OVERLAY === "true";
  return (
    <SidebarProvider
      style={
        { "--sidebar-width": "calc(var(--spacing) * 72)", "--header-height": "calc(var(--spacing) * 14)" } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" initialUser={null} />
      <SidebarInset>
        <PageHeader page="Agents" />
        <PageReveal label="Loading agents…" className="flex flex-1 flex-col gap-4 px-3 py-4 sm:px-4 lg:gap-6 lg:px-6">
          {/* Client renders skeleton until agents are fetched — SSR renders nothing */}
          <AgentsClientGrid showAgentDebug={showAgentDebug} />
        </PageReveal>
      </SidebarInset>
    </SidebarProvider>
  );
}
