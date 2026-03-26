"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ArrowRightIcon, ActivityIcon, CpuIcon, BrainCircuitIcon, ZapIcon } from "lucide-react";
import { AgentDebugOverlay } from "@/components/agents/agent-debug-overlay";
import { AgentStatusBadge, formatAgentName } from "@/components/agents/agent-ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

// ── Agent emoji/icon mapping ─────────────────────────────────────────────────

const AGENT_EMOJIS: Record<string, string> = {
  main: "🤖",
  planner: "📋",
  developer: "💻",
  writer: "✍️",
  researcher: "🔍",
  test: "🧪",
  default: "⚡",
};

function getAgentEmoji(name: string, id: string): string {
  const lower = (name || id || "").toLowerCase();
  for (const [key, emoji] of Object.entries(AGENT_EMOJIS)) {
    if (lower.includes(key)) return emoji;
  }
  return AGENT_EMOJIS.default;
}

// ── Status gradient mapping ──────────────────────────────────────────────────

const STATUS_GRADIENTS: Record<string, string> = {
  running: "from-emerald-500/15 via-emerald-500/5 to-transparent",
  idle: "from-primary/8 via-primary/2 to-transparent",
  degraded: "from-red-500/15 via-red-500/5 to-transparent",
};

const STATUS_GLOW: Record<string, string> = {
  running: "shadow-emerald-500/10",
  idle: "",
  degraded: "shadow-red-500/10",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveAgentCardStatus(
  status: "running" | "idle" | "degraded",
  lastActivityAt: string | null,
  referenceTs: number | null,
): "running" | "idle" | "degraded" {
  if (status !== "idle") return status;
  if (!lastActivityAt || referenceTs == null) return status;
  const lastActivityTs = new Date(lastActivityAt).valueOf();
  return Number.isFinite(lastActivityTs) && referenceTs - lastActivityTs <= 2 * 60 * 1000
    ? "running"
    : status;
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function AgentsPageSkeleton(): React.ReactElement {
  return (
    <div className="flex flex-col gap-6">
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
      <div className="grid gap-4 md:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="overflow-hidden">
            <div className="h-2 w-full bg-muted animate-pulse" />
            <CardHeader className="gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-xl animate-pulse bg-muted" />
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

// ── Stat card configs ────────────────────────────────────────────────────────

const STAT_CONFIGS = [
  { label: "Total agents", color: "text-primary", bg: "bg-primary/10", icon: CpuIcon },
  { label: "Running", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10", icon: ActivityIcon },
  { label: "Responses (1h)", color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10", icon: ZapIcon },
  { label: "Memory ops (1h)", color: "text-fuchsia-600 dark:text-fuchsia-400", bg: "bg-fuchsia-500/10", icon: BrainCircuitIcon },
] as const;

// ── Main grid ────────────────────────────────────────────────────────────────

function AgentsClientGrid({ showAgentDebug }: { showAgentDebug: boolean }): React.ReactElement | null {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const startedRef = useRef(false);

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

  if (!mounted) return null;
  if (loading) return <AgentsPageSkeleton />;

  if (agents.length === 0) {
    return (
      <Empty className="min-h-72">
        <EmptyHeader>
          <div className="text-6xl mb-4">🤖</div>
          <EmptyTitle>No agents online</EmptyTitle>
          <EmptyDescription>
            Your agents will appear here once they connect. Start an agent to see it light up!
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const referenceTs = Date.now();
  const runningCount = agents.filter(
    (a) => resolveAgentCardStatus(a.status, a.lastHeartbeatAt, Date.now()) === "running",
  ).length;

  const statValues = [agents.length, runningCount, "—", "—"];

  return (
    <>
      {/* Stat cards with individual colors */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {STAT_CONFIGS.map((cfg, i) => {
          const Icon = cfg.icon;
          return (
            <Card key={cfg.label} className="overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardDescription>{cfg.label}</CardDescription>
                  <div className={`size-8 rounded-lg ${cfg.bg} flex items-center justify-center`}>
                    <Icon className={`size-4 ${cfg.color}`} />
                  </div>
                </div>
                <CardTitle className={`text-2xl ${cfg.color}`}>
                  {statValues[i]}
                </CardTitle>
              </CardHeader>
            </Card>
          );
        })}
      </div>

      {/* Agent cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {agents.map((agent) => {
          const cardStatus = resolveAgentCardStatus(agent.status, agent.lastHeartbeatAt, referenceTs);
          const gradient = STATUS_GRADIENTS[cardStatus] ?? STATUS_GRADIENTS.idle;
          const glow = STATUS_GLOW[cardStatus] ?? "";
          const emoji = getAgentEmoji(agent.name, agent.id);
          const isRunning = cardStatus === "running";

          return (
            <Link key={agent.id} href={`/agents/${encodeURIComponent(agent.id)}`} className="block group">
              <Card className={`h-full overflow-hidden border transition-all duration-200 hover:-translate-y-1 hover:shadow-lg hover:border-primary/40 ${glow}`}>
                {/* Gradient accent bar */}
                <div className={`h-1.5 w-full bg-gradient-to-r ${gradient}`} />

                <CardHeader className="gap-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {/* Agent avatar */}
                      <div className="relative">
                        <div className="size-11 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center text-xl">
                          {emoji}
                        </div>
                        {/* Pulse indicator for running agents */}
                        {isRunning && (
                          <span className="absolute -top-0.5 -right-0.5 flex size-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full size-3 bg-emerald-500" />
                          </span>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <CardTitle className="text-base group-hover:text-primary transition-colors">
                          {formatAgentName(agent.name)}
                        </CardTitle>
                        {showAgentDebug ? <AgentDebugOverlay agent={agent as any} /> : null}
                      </div>
                    </div>
                    <AgentStatusBadge status={cardStatus} />
                  </div>
                </CardHeader>

                <CardContent className="grid gap-3 text-sm pt-0">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Model</span>
                    <span className="text-sm text-foreground/80 truncate max-w-[320px]">{agent.model ?? "unknown"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Last heartbeat</span>
                    <span className="text-sm">
                      {agent.lastHeartbeatAt
                        ? formatDistanceToNow(new Date(agent.lastHeartbeatAt), { addSuffix: true })
                        : "unknown"}
                    </span>
                  </div>
                  {agent.isDefault && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Role</span>
                      <Badge variant="outline" className="text-[10px]">Default agent</Badge>
                    </div>
                  )}

                  <div className="pt-3 flex items-end justify-end text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-sm font-medium">View details</span>
                    <ArrowRightIcon className="ml-1.5 size-4" />
                  </div>
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
