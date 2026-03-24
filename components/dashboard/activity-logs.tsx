import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { cn } from "@/lib/utils"

type LogLevel = "info" | "success" | "warning" | "error"

export type DashboardActivityLog = {
  id: string
  occurredAt: string
  source: "Agent" | "Tasks" | "System" | "API"
  event: string
  details: string
  level: LogLevel
  agentName?: string
}

const levelBadgeClass: Record<LogLevel, string> = {
  info: "border-blue-500/40 bg-blue-500/15 text-blue-700 dark:text-blue-300",
  success: "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  error: "",
}

const levelBadgeVariant: Record<
  LogLevel,
  "outline" | "secondary" | "destructive"
> = {
  info: "outline",
  success: "outline",
  warning: "outline",
  error: "destructive",
}

function formatOccurredAt(occurredAt: string) {
  const date = new Date(occurredAt)
  return Number.isNaN(date.valueOf())
    ? occurredAt
    : date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
}

const eventLabelOverrides: Record<string, string> = {
  "chat.user_in": "User message",
  "chat.assistant_out": "Assistant reply",
  "tool.start": "Tool started",
  "tool.success": "Tool succeeded",
  "tool.error": "Tool failed",
}

function titleCaseWords(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function formatEventLabel(event: string) {
  const raw = String(event || "").trim()
  if (!raw) return "Event"
  if (eventLabelOverrides[raw]) return eventLabelOverrides[raw]
  const normalized = raw.replace(/[._-]+/g, " ")
  return titleCaseWords(normalized)
}

function displayName(log: DashboardActivityLog): string {
  if (log.agentName) return log.agentName
  if (log.source === "Agent") return "Agent"
  return log.source
}

export function ActivityLogs({ logs = [] }: { logs?: DashboardActivityLog[] }) {
  return (
    <Card className="h-full">
      <CardHeader className="border-b">
        <div>
          <CardTitle>Activity Logs</CardTitle>
          <CardDescription>
            Recent events across dashboard, task board, and agent runtime
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 px-0">
        <ScrollArea className="h-full">
          <div className="divide-y">
            {logs.map((log) => (
              <div
                key={log.id}
                className="flex items-start gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="flex items-center gap-2 mb-0.5 overflow-hidden">
                    <p className="shrink-0 text-xs font-semibold text-foreground">
                      {displayName(log)}
                    </p>
                    <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatOccurredAt(log.occurredAt)}
                    </p>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/70">{formatEventLabel(log.event)}</span>
                    {log.details ? <span> · {log.details}</span> : null}
                  </p>
                </div>
                {(log.level === "error" || log.level === "warning" || log.level === "success") && (
                  <Badge
                    variant={levelBadgeVariant[log.level]}
                    className={cn("shrink-0 capitalize self-center", levelBadgeClass[log.level])}
                  >
                    {log.level}
                  </Badge>
                )}
              </div>
            ))}
            {logs.length === 0 && (
              <div className="px-6 py-6">
                <Empty className="min-h-36">
                  <EmptyHeader>
                    <EmptyTitle>No activity logs yet</EmptyTitle>
                    <EmptyDescription>New events will appear here.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
