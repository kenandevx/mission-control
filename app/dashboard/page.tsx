import { AppSidebar } from "@/components/layout/app-sidebar";
import { ChartAreaInteractive } from "@/components/dashboard/chart-area-interactive";
import { SectionCards } from "@/components/dashboard/section-cards";
import { SiteHeader } from "@/components/dashboard/site-header";
import { getDashboardData, getDashboardStats } from "@/lib/db/server-data";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [{ chartData }, stats] = await Promise.all([
    getDashboardData(),
    getDashboardStats(),
  ]);

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
        <SiteHeader />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">

              {/* Row 1: Total counts */}
              <SectionCards
                boards={stats.boards}
                tickets={stats.tickets}
                agendaEvents={stats.agendaEvents}
                processes={stats.processes}
                logs={stats.logs}
              />

              {/* Row 2: Chart */}
              <ChartAreaInteractive data={chartData} />

            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
