import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageHeader } from "@/components/layout/page-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { PageReveal } from "@/components/ui/page-reveal";
import { FileManagerClient } from "./file-manager-client";

export const dynamic = "force-dynamic";

export default function FileManagerPage(): React.JSX.Element {
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
        <PageHeader page="File Manager" />
        <PageReveal label="Loading files…" className="flex flex-1 flex-col gap-4 px-3 py-4 sm:px-4 lg:gap-6 lg:px-6">
          <FileManagerClient />
        </PageReveal>
      </SidebarInset>
    </SidebarProvider>
  );
}
