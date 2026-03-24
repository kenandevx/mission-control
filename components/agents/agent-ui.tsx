import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  AgentLogChannelType,
  AgentLogDirection,
  AgentLogEventType,
  AgentLogLevel,
  AgentLogMemorySource,
  AgentLogType,
  AgentStatus,
} from "@/types/agents";

const statusClass: Record<AgentStatus, string> = {
  running: "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  idle: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  degraded: "border-destructive/40 bg-destructive/15 text-destructive",
};

const levelClass: Record<AgentLogLevel, string> = {
  info: "border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300",
  debug: "border-zinc-500/40 bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  warning: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  error: "",
};

const levelVariant: Record<AgentLogLevel, "outline" | "destructive"> = {
  info: "outline",
  debug: "outline",
  warning: "outline",
  error: "destructive",
};

const typeClass: Record<AgentLogType, string> = {
  workflow: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  tool: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  memory: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  system: "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
};

const eventTypeClass: Record<AgentLogEventType, string> = {
  "chat.user_in": "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  "chat.assistant_out": "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  "chat.reaction": "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  "tool.start": "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  "tool.success": "border-lime-500/30 bg-lime-500/10 text-lime-700 dark:text-lime-300",
  "tool.error": "border-destructive/30 bg-destructive/10 text-destructive",
  "system.startup": "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  "system.shutdown": "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  "system.error": "border-destructive/30 bg-destructive/10 text-destructive",
  "system.warning": "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  "heartbeat.tick": "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  "heartbeat.status_change": "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  "memory.read": "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  "memory.write": "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  "memory.search": "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
  "memory.upsert": "border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-300",
  "memory.error": "border-destructive/30 bg-destructive/10 text-destructive",
};

const channelTypeClass: Record<AgentLogChannelType, string> = {
  internal: "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  telegram: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  gateway: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  qdrant: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
};

const directionClass: Record<AgentLogDirection, string> = {
  inbound: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  outbound: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  internal: "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
};

const memorySourceClass: Record<Exclude<AgentLogMemorySource, "">, string> = {
  session: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  daily_file: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  long_term_file: "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300",
  episodic_file: "border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-300",
  qdrant_vector: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
};

const levelLabel: Record<AgentLogLevel, string> = {
  info: "Info",
  debug: "Debug",
  warning: "Warning",
  error: "Error",
};

const typeLabel: Record<AgentLogType, string> = {
  workflow: "Workflow",
  tool: "Tool",
  memory: "Memory",
  system: "System",
};

const eventTypeLabel: Record<AgentLogEventType, string> = {
  "chat.user_in": "User Message",
  "chat.assistant_out": "Assistant Reply",
  "chat.reaction": "Chat Reaction",
  "tool.start": "Tool Start",
  "tool.success": "Tool Success",
  "tool.error": "Tool Failure",
  "system.startup": "System Startup",
  "system.shutdown": "System Shutdown",
  "system.error": "System Error",
  "system.warning": "System Warning",
  "heartbeat.tick": "Heartbeat Tick",
  "heartbeat.status_change": "Heartbeat State",
  "memory.read": "Memory Read",
  "memory.write": "Memory Write",
  "memory.search": "Memory Search",
  "memory.upsert": "Memory Upsert",
  "memory.error": "Memory Error",
};

const channelLabel: Record<AgentLogChannelType, string> = {
  internal: "Internal",
  telegram: "Telegram",
  gateway: "Gateway",
  qdrant: "Qdrant",
};

const directionLabel: Record<AgentLogDirection, string> = {
  inbound: "Inbound",
  outbound: "Outbound",
  internal: "Internal",
};

const memorySourceLabel: Record<Exclude<AgentLogMemorySource, "">, string> = {
  session: "Session",
  daily_file: "Daily File",
  long_term_file: "Long-term File",
  episodic_file: "Episodic File",
  qdrant_vector: "Qdrant Vector",
};

const memorySourceHelpText: Record<Exclude<AgentLogMemorySource, "">, string> = {
  session: "In-session context only (not persisted as long-term memory).",
  daily_file: "Persisted in workspace daily memory markdown files under ~/.openclaw/workspace/memory/*.md.",
  long_term_file: "Persisted in long-term markdown memory files (MEMORY.md / shared memory docs).",
  episodic_file: "Persisted in episodic memory files under ~/.openclaw/workspace/memory/episodes/.",
  qdrant_vector: "Persisted in Qdrant vector store for semantic retrieval.",
};

const statusHelpText: Record<AgentStatus, string> = {
  running: "Running: agent heartbeat is recent and runtime is active.",
  idle: "Idle: agent is healthy but no recent activity is detected.",
  degraded: "Degraded: heartbeat is stale or runtime signals are partially unavailable.",
};

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn("cursor-help capitalize", statusClass[status])}>
            {status}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {statusHelpText[status]}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function AgentLogLevelBadge({ level }: { level: AgentLogLevel }) {
  return (
    <Badge
      variant={levelVariant[level]}
      className={cn(levelClass[level])}
    >
      {levelLabel[level]}
    </Badge>
  );
}

export function AgentLogTypeBadge({ type }: { type: AgentLogType }) {
  return (
    <Badge variant="outline" className={cn(typeClass[type])}>
      {typeLabel[type]}
    </Badge>
  );
}

export function AgentLogEventTypeBadge({ eventType }: { eventType: AgentLogEventType }) {
  return (
    <Badge variant="outline" className={cn(eventTypeClass[eventType])}>
      {eventTypeLabel[eventType]}
    </Badge>
  );
}

export function AgentLogChannelBadge({ channel }: { channel: AgentLogChannelType }) {
  return (
    <Badge variant="outline" className={cn(channelTypeClass[channel])}>
      {channelLabel[channel]}
    </Badge>
  );
}

export function AgentLogDirectionBadge({ direction }: { direction: AgentLogDirection }) {
  return (
    <Badge variant="outline" className={cn(directionClass[direction])}>
      {directionLabel[direction]}
    </Badge>
  );
}

export function AgentLogMemorySourceBadge({ memorySource }: { memorySource: Exclude<AgentLogMemorySource, ""> }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn("cursor-help", memorySourceClass[memorySource])}>
            {memorySourceLabel[memorySource]}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6} className="max-w-xs text-xs">
          {memorySourceHelpText[memorySource]}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const genericBotNamePattern = /^(openclaw|dashboard)\s+bot(?:\s+(.+))?$/i;

export function formatAgentName(value: string) {
  const raw = String(value || "").trim().replace(/\s+/g, " ");
  if (!raw) return "Agent";

  const match = raw.match(genericBotNamePattern);
  if (!match) return raw;

  const suffix = (match[2] || "").trim();
  return suffix || "Bot";
}

const AMSTERDAM_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Amsterdam",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatTimestamp(value: string | null | undefined) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return AMSTERDAM_FORMATTER.format(date).replace(" ", " ").replace(" at ", ", ");
}
