import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageHeader } from "@/components/layout/page-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AgendaLogsClient } from "@/components/agenda/agenda-logs-client";

export const dynamic = "force-dynamic";

export default function AgendaLogsPage() {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 14)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" initialUser={null} />
      <SidebarInset className="h-svh md:h-[calc(100svh-1rem)] overflow-hidden min-h-0">
        <PageHeader page="Agenda Logs" />
        <div className="flex flex-1 min-h-0 overflow-hidden px-4 lg:px-6 py-4">
          <AgendaLogsClient />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
