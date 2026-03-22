"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  IconDashboard,
  IconInnerShadowTop,
  IconListDetails,
  IconLogs,
  IconRobot,
} from "@tabler/icons-react"

import { NavMain } from "@/components/layout/nav-main"
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
    { title: "Agents", url: "/agents", icon: IconRobot },
    { title: "Logs", url: "/logs", icon: IconLogs },
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
}

export function AppSidebar({ initialUser, ...props }: AppSidebarProps) {
  const router = useRouter()
  const [user, setUser] = React.useState<SidebarUser | null>(initialUser)
  const adapter = React.useMemo(() => getDataAdapter(), [])

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
                <span className="text-base font-semibold">openclaw</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
      </SidebarContent>
      <SidebarFooter>
        <div className="px-2 pb-2 text-xs text-muted-foreground">Version v{APP_VERSION}</div>
        {user ? <NavUser user={user} onLogout={handleLogout} /> : null}
      </SidebarFooter>
    </Sidebar>
  )
}
