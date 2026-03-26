"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ArrowRightIcon } from "lucide-react";
import { AgentDebugOverlay } from "@/components/agents/agent-debug-overlay";
import { AgentStatusBadge, formatAgentName } from "@/components/agents/agent-ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

type AgentEntry = {
  id: string;
  name: string;
  status: "running" | "idle" | "degraded";
  model: string | null;
  queueDepth: number | null;
  lastHeartbeatAt: string | null;
  isDefault?: boolean;
};

function resolveAgentCardStatus(
  status: "running" | "idle" | "degraded",
  lastActivityAt: string | null,
  referenceTs: number | null,
) {
  if (status !== "idle") return status;
  if (!lastActivityAt || referenceTs == null) return status;
  const lastActivityTs = new Date(lastActivityAt).valueOf();
  return Number.isFinite(lastActivityTs) && referenceTs - lastActivityTs <= 2 * 60 * 1000
    ? "running"
    : status;
}

function AgentsPageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {/* Stat cards skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {["Total agents", "Running", "Responses (1h)", "Memory ops (1h)"].map((label) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <div className="h-8 w-12 rounded animate-pulse bg-muted mt-1" />
            </CardHeader>
          </Card>
        ))}
      </div>

      {/* Agent cards skeleton */}
      <div className="grid gap-4 md:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader className="gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-2">
                  <div className="h-4 w-32 rounded animate-pulse bg-muted" />
                </div>
                <div className="h-5 w-16 rounded-full animate-pulse bg-muted" />
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Model</span>
                <div className="h-3 w-24 rounded animate-pulse bg-muted" />
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last heartbeat</span>
                <div className="h-3 w-20 rounded animate-pulse bg-muted" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AgentsClientGrid({ showAgentDebug }: { showAgentDebug: boolean }) {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const startedRef = useRef(false);

  // Set mounted=true after first client render — SSR renders nothing (no hydration mismatch)
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const load = async () => {
      try {
        const res = await fetch("/api/agents", { cache: "reload" });
        const json = await res.json();
        setAgents(json.agents ?? []);
      } catch (err) {
        console.error("Failed to load agents", err);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  // During SSR and before client mount — render nothing (matches server output)
  if (!mounted) return null;

  // Show skeleton while fetching
  if (loading) return <AgentsPageSkeleton />;

  if (agents.length === 0) {
    return (
      <Empty className="min-h-72">
        <EmptyHeader>
          <EmptyTitle>No agents yet</EmptyTitle>
          <EmptyDescription>Create or connect agents to see them here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const referenceTs = Date.now();

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardDescription>Total agents</CardDescription><CardTitle className="text-2xl">{agents.length}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Running</CardDescription><CardTitle className="text-2xl text-emerald-700 dark:text-emerald-300">{agents.filter((a) => resolveAgentCardStatus(a.status, a.lastHeartbeatAt, Date.now()) === "running").length}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Responses (1h)</CardDescription><CardTitle className="text-2xl text-blue-700 dark:text-blue-300">—</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Memory ops (1h)</CardDescription><CardTitle className="text-2xl text-fuchsia-700 dark:text-emerald-300">—</CardTitle></CardHeader></Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {agents.map((agent) => {
          const cardStatus = resolveAgentCardStatus(agent.status, agent.lastHeartbeatAt, referenceTs);
          return (
            <Link key={agent.id} href={`/agents/${encodeURIComponent(agent.id)}`} className="block">
              <Card className="h-full border transition-transform hover:-translate-y-0.5 hover:shadow-md hover:border-primary/40">
                <CardHeader className="gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2">
                      <CardTitle className="text-base">{formatAgentName(agent.name)}</CardTitle>
                      {showAgentDebug ? <AgentDebugOverlay agent={agent as any} /> : null}
                    </div>
                    <AgentStatusBadge status={cardStatus} />
                  </div>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm">
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Model</span><span>{agent.model ?? "unknown"}</span></div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Last heartbeat</span>
                    <span>{agent.lastHeartbeatAt ? formatDistanceToNow(new Date(agent.lastHeartbeatAt), { addSuffix: true }) : "unknown"}</span>
                  </div>
                  <div className="pt-12 flex items-end justify-end text-primary"><span>Open</span><ArrowRightIcon className="ml-1 size-4" /></div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </>
  );
}

export { AgentsClientGrid, AgentsPageSkeleton };
