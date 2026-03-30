import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageHeader } from "@/components/layout/page-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ProcessesPageClient } from "@/components/processes/processes-page-client";
import { PageReveal } from "@/components/ui/page-reveal";

export const dynamic = "force-dynamic";

export default function ProcessesPage() {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 14)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" initialUser={null} showActivity={false} />
      <SidebarInset>
        <PageHeader page="Processes" />
        <PageReveal label="Loading processes…" className="flex flex-1 flex-col gap-4 px-3 py-4 sm:px-4 lg:gap-6 lg:px-6">
          <ProcessesPageClient />
        </PageReveal>
      </SidebarInset>
    </SidebarProvider>
  );
}
