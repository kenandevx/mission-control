"use client";

import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { Agent, AgentFieldSource } from "@/types/agents";

type AgentDebugOverlayProps = {
  agent: Agent;
  className?: string;
};

function formatDebugValue(value: unknown) {
  if (value == null || value === "") return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

const sourceClassName: Record<AgentFieldSource, string> = {
  runtime: "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  database: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  fallback: "border-zinc-500/40 bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
};

export function AgentDebugOverlay({ agent, className }: AgentDebugOverlayProps) {
  const [open, setOpen] = useState(false);
  const rows = [
    ["name", agent.name, agent.runtimeMeta?.fieldSources.name ?? "fallback"],
    ["status", agent.status, agent.runtimeMeta?.fieldSources.status ?? "fallback"],
    ["model", agent.runtime.model, agent.runtimeMeta?.fieldSources.model ?? "fallback"],
    ["queueDepth", agent.runtime.queueDepth, agent.runtimeMeta?.fieldSources.queueDepth ?? "fallback"],
    ["activeRuns", agent.runtime.activeRuns, agent.runtimeMeta?.fieldSources.activeRuns ?? "fallback"],
    ["lastHeartbeatAt", agent.runtime.lastHeartbeatAt, agent.runtimeMeta?.fieldSources.lastHeartbeatAt ?? "fallback"],
    ["uptimeMinutes", agent.runtime.uptimeMinutes, agent.runtimeMeta?.fieldSources.uptimeMinutes ?? "fallback"],
    ["runtimeMeta.stale", agent.runtimeMeta?.stale, "fallback"],
    ["runtimeMeta.heartbeatAgeSec", agent.runtimeMeta?.heartbeatAgeSec, "fallback"],
    ["runtimeMeta.source", agent.runtimeMeta?.source, "fallback"],
  ] as const;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-xs">
          source: {agent.runtimeMeta?.source ?? "database-fallback"}
        </Badge>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="xs" className="text-muted-foreground">
            Debug
            <ChevronDownIcon
              className={cn("size-3 transition-transform", open ? "rotate-180" : "")}
            />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="grid gap-x-3 gap-y-1 font-mono text-xs sm:grid-cols-[auto_auto_1fr]">
            {rows.map(([label, value, fieldSource]) => (
              <div key={label} className="contents">
                <span className="text-muted-foreground">{label}</span>
                <Badge variant="outline" className={cn("text-xs", sourceClassName[fieldSource])}>
                  {fieldSource}
                </Badge>
                <span className="break-all">{formatDebugValue(value)}</span>
              </div>
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
