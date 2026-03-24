import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ArrowRightIcon } from "lucide-react";
import { AgentDebugOverlay } from "@/components/agents/agent-debug-overlay";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageHeader } from "@/components/layout/page-header";
import { AgentStatusBadge, formatAgentName } from "@/components/agents/agent-ui";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { getAgentsAndLogsData, getSidebarUser } from "@/lib/db/server-data";

export const dynamic = "force-dynamic";

function resolveAgentCardStatus(status: "running" | "idle" | "degraded", lastActivityAt: string | null, referenceTs: number | null) {
  if (status !== "idle") return status;
  if (!lastActivityAt || referenceTs == null) return status;
  const lastActivityTs = new Date(lastActivityAt).valueOf();
  return Number.isFinite(lastActivityTs) && referenceTs - lastActivityTs <= 2 * 60 * 1000 ? "running" : status;
}

export default async function AgentsPage() {
  const showAgentDebug = process.env.NEXT_PUBLIC_AGENT_DEBUG_OVERLAY === "true";
  const [, { agents, logs }] = await Promise.all([getSidebarUser(), getAgentsAndLogsData()]);
  const referenceTs = (() => { const latestTs = logs.map((log) => new Date(log.occurredAt).valueOf()).find((ts) => Number.isFinite(ts)); return typeof latestTs === "number" ? latestTs : null; })();
  const recentCutoff = referenceTs != null ? referenceTs - 60 * 60 * 1000 : null;
  const recentLogs = logs.filter((log) => { const ts = new Date(log.occurredAt).valueOf(); return Number.isFinite(ts) && recentCutoff != null && ts >= recentCutoff; });
  const responses1h = recentLogs.filter((log) => log.eventType === "chat.assistant_out").length;
  const memoryOps1h = recentLogs.filter((log) => Boolean(log.eventType?.startsWith("memory."))).length;
  const errorLogs = recentLogs.filter((log) => log.level === "error" || Boolean(log.eventType?.endsWith(".error"))).length;
  const activityByAgent = new Map<string, { lastActivityAt: string | null; responses1h: number; errors1h: number }>();
  for (const agent of agents) activityByAgent.set(agent.id, { lastActivityAt: null, responses1h: 0, errors1h: 0 });
  for (const log of logs) { const entry = activityByAgent.get(log.agentId) ?? { lastActivityAt: null, responses1h: 0, errors1h: 0 }; const ts = new Date(log.occurredAt).valueOf(); const isRecent = Number.isFinite(ts) && recentCutoff != null && ts >= recentCutoff; if (!entry.lastActivityAt || log.occurredAt > entry.lastActivityAt) entry.lastActivityAt = log.occurredAt; if (isRecent && log.eventType === "chat.assistant_out") entry.responses1h += 1; if (isRecent && (log.level === "error" || Boolean(log.eventType?.endsWith(".error")))) entry.errors1h += 1; activityByAgent.set(log.agentId, entry); }
  const runningCount = agents.filter((agent) => resolveAgentCardStatus(agent.status, activityByAgent.get(agent.id)?.lastActivityAt ?? null, referenceTs) === "running").length;
  return <SidebarProvider style={{ "--sidebar-width": "calc(var(--spacing) * 72)", "--header-height": "calc(var(--spacing) * 14)" } as React.CSSProperties}><AppSidebar variant="inset" initialUser={null} /><SidebarInset><PageHeader page="Agents" /><div className="flex flex-1 flex-col"><div className="flex flex-1 flex-col gap-4 px-3 py-4 sm:px-4 lg:gap-6 lg:px-6"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Card><CardHeader className="pb-2"><CardDescription>Total agents</CardDescription><CardTitle className="text-2xl">{agents.length}</CardTitle></CardHeader></Card><Card><CardHeader className="pb-2"><CardDescription>Running</CardDescription><CardTitle className="text-2xl text-emerald-700 dark:text-emerald-300">{runningCount}</CardTitle></CardHeader></Card><Card><CardHeader className="pb-2"><CardDescription>Responses (1h)</CardDescription><CardTitle className="text-2xl text-blue-700 dark:text-blue-300">{responses1h}</CardTitle></CardHeader></Card><Card><CardHeader className="pb-2"><CardDescription>Memory ops (1h)</CardDescription><CardTitle className="text-2xl text-fuchsia-700 dark:text-fuchsia-300">{memoryOps1h}</CardTitle><p className="text-xs text-muted-foreground">Errors (1h): {errorLogs}</p></CardHeader></Card></div>{agents.length === 0 ? <Empty className="min-h-72"><EmptyHeader><EmptyTitle>No agents yet</EmptyTitle><EmptyDescription>Create or connect agents to see them here.</EmptyDescription></EmptyHeader></Empty> : <div className="grid gap-4 md:grid-cols-2">{agents.map((agent) => { const lastActivityAt = activityByAgent.get(agent.id)?.lastActivityAt ?? null; const cardStatus = resolveAgentCardStatus(agent.status, lastActivityAt, referenceTs); return (<Link key={agent.id} href={`/agents/${encodeURIComponent(agent.id)}`} className="block"><Card className="h-full border transition-transform hover:-translate-y-0.5 hover:shadow-md hover:border-primary/40"><CardHeader className="gap-3"><div className="flex items-start justify-between gap-3"><div className="space-y-2"><CardTitle className="text-base">{formatAgentName(agent.name)}</CardTitle>{showAgentDebug ? <AgentDebugOverlay agent={agent} /> : null}</div><AgentStatusBadge status={cardStatus} /></div></CardHeader><CardContent className="grid gap-3 text-sm"><div className="flex items-center justify-between"><span className="text-muted-foreground">Model</span><span>{agent.runtime.model ?? "unknown"}</span></div><div className="flex items-center justify-between"><span className="text-muted-foreground">Last heartbeat</span><span>{agent.runtime.lastHeartbeatAt ? formatDistanceToNow(new Date(agent.runtime.lastHeartbeatAt), { addSuffix: true }) : "unknown"}</span></div><div className="flex items-center justify-between"><span className="text-muted-foreground">Queue depth</span><span>{agent.runtime.queueDepth ?? "unknown"}</span></div><div className="flex items-center justify-between"><span className="text-muted-foreground">Recent activity</span><span>{lastActivityAt ? formatDistanceToNow(new Date(lastActivityAt), { addSuffix: true }) : "unknown"}</span></div><div className="flex items-center justify-end text-primary"><span>Open</span><ArrowRightIcon className="ml-1 size-4" /></div></CardContent></Card></Link>); })}</div>}</div></div></SidebarInset></SidebarProvider>;
}
