"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  IconDashboard,
  IconInnerShadowTop,
  IconListDetails,
  IconLogs,
  IconRobot,
  IconCalendar,
  IconStack2,
  IconSettings,
} from "@tabler/icons-react"

import { NavMain } from "@/components/layout/nav-main"
import { NavActivity } from "@/components/layout/nav-activity"
import { NavUser } from "@/components/layout/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { getDataAdapter } from "@/lib/db"
import packageJson from "../../package.json"
import { toast } from "sonner"

const data = {
  navMain: [
    { title: "Dashboard", url: "/dashboard", icon: IconDashboard },
    { title: "Boards", url: "/boards", icon: IconListDetails },
    { title: "Agenda", url: "/agenda", icon: IconCalendar },
    { title: "Processes", url: "/processes", icon: IconStack2 },
    { title: "Agents", url: "/agents", icon: IconRobot },
    { title: "System", url: "/logs", icon: IconLogs },
    { title: "Settings", url: "/settings", icon: IconSettings },
  ],
}

const APP_VERSION = packageJson.version || "0.1.0"

type SidebarUser = {
  name: string
  email: string
  avatar: string
}

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  initialUser: SidebarUser | null
  showActivity?: boolean
}

export function AppSidebar({ initialUser, showActivity = true, ...props }: AppSidebarProps) {
  const router = useRouter()
  const [user, setUser] = React.useState<SidebarUser | null>(initialUser)
  const [instanceName, setInstanceName] = React.useState("")
  const adapter = React.useMemo(() => getDataAdapter(), [])

  React.useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "getWorkerSettings" }),
          cache: "reload",
        })
        const json = await res.json()
        const next = String(json?.workerSettings?.instanceName || "Mission Control").trim() || "Mission Control"
        if (!cancelled) { setInstanceName(next); document.title = next; }
      } catch {
        if (!cancelled) setInstanceName("Mission Control")
      }
    })()

    const onNameChanged = (event: Event) => {
      const custom = event as CustomEvent<{ name?: string }>
      const next = String(custom.detail?.name || "Mission Control").trim() || "Mission Control"
      setInstanceName(next)
    }

    window.addEventListener("mc-instance-name-changed", onNameChanged as EventListener)
    return () => {
      cancelled = true
      window.removeEventListener("mc-instance-name-changed", onNameChanged as EventListener)
    }
  }, [])

  const handleLogout = async () => {
    try {
      await adapter.signOut()
      setUser(null)
      router.replace("/login")
      router.refresh()
      toast.success("Signed out")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to sign out."
      toast.error(message)
    }
  }

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:p-1.5!"
            >
              <a href="#">
                <IconInnerShadowTop className="size-5!" />
                <span className="text-base font-semibold">{instanceName || "\u00A0"}</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        {showActivity ? <NavActivity /> : null}
      </SidebarContent>
      <SidebarFooter>
        <button
          type="button"
          className="px-2 pb-2 text-xs text-muted-foreground text-left cursor-pointer hover:text-foreground/80"
          onClick={() => {
            const now = Date.now();
            const w = window as Window & { __mcDevClickCount?: number; __mcDevClickAt?: number };
            if (!w.__mcDevClickAt || now - w.__mcDevClickAt > 2000) {
              w.__mcDevClickCount = 0;
            }
            w.__mcDevClickAt = now;
            w.__mcDevClickCount = (w.__mcDevClickCount || 0) + 1;

            if (w.__mcDevClickCount >= 5) {
              w.__mcDevClickCount = 0;
              const current = localStorage.getItem("mc-dev-mode") === "1";
              const next = !current;
              localStorage.setItem("mc-dev-mode", next ? "1" : "0");
              window.dispatchEvent(new CustomEvent("mc-dev-mode-changed", { detail: { enabled: next } }));
              toast.success(next ? "Now in development mode" : "Development mode disabled");
            }
          }}
        >
          Version v{APP_VERSION}
        </button>
        {user ? <NavUser user={user} onLogout={handleLogout} /> : null}
      </SidebarFooter>
    </Sidebar>
  )
}
