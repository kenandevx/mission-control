import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageHeader } from "@/components/layout/page-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AgendaClientWrapper } from "@/components/agenda/agenda-client-wrapper";
import "@/app/agenda/calendar-theme.css";

export const dynamic = "force-dynamic";

export default function AgendaPage() {
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
      <SidebarInset>
        <PageHeader page="Agenda" />
        <AgendaClientWrapper />
      </SidebarInset>
    </SidebarProvider>
  );
}
