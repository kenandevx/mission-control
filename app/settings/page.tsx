import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageHeader } from "@/components/layout/page-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { SettingsPageClient } from "@/components/settings/settings-page-client";
import { PageReveal } from "@/components/ui/page-reveal";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
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
        <PageHeader page="Settings" />
        <PageReveal label="Loading settings…">
          <SettingsPageClient />
        </PageReveal>
      </SidebarInset>
    </SidebarProvider>
  );
}
