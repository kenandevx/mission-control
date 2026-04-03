"use client";

import { useMemo, useState } from "react";
import { formatDistance } from "date-fns";
import { SearchIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Agent, AgentLog } from "@/types/agents";
import { cn } from "@/lib/utils";

type LogsExplorerProps = {
  logs?: AgentLog[];
  agents?: Agent[];
  page: number;
  pageCount: number;
  totalCount: number;
  initialNowIso: string;
  onPageChange: (next: number) => void;
};

type FilterGroup = "all" | "chat" | "tool" | "memory" | "system" | "worker" | "error";

type NormalizedLog = {
  id: string;
  agentId: string;
  agentName: string;
  occurredAt: string;
  level: string;
  type: string;
  eventType: string;
  channelType: string;
  direction: string;
  message: string;
  messagePreview: string;
  runId: string;
  sessionKey: string;
  sourceMessageId: string;
  memorySource: string;
  rawPayload: unknown;
};

const levelClasses: Record<string, string> = {
  info: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  debug: "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
};

const channelClasses: Record<string, string> = {
  telegram: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  gateway: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  internal: "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  qdrant: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
};

function safeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (value == null) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[object]";
    }
  }
  return String(value);
}

function pickString(...values: unknown[]) {
  for (const value of values) {
    const text = safeString(value).trim();
    if (text) return text;
  }
  return "";
}

function extractVisibleMessageFromEnvelope(text: string): string {
  const raw = String(text || "");
  if (!raw) return "";

  let cleaned = raw
    .replace(/\[\[\s*reply_to_current\s*\]\]/gi, "")
    .replace(/\[\[\s*reply_to:\s*[^\]]+\]\]/gi, "");

  // Strip known metadata blocks entirely.
  cleaned = cleaned
    .replace(/Conversation info\s*\(untrusted metadata\)?:\s*```json[\s\S]*?```/gi, "")
    .replace(/Sender\s*\(untrusted metadata\)?:\s*```json[\s\S]*?```/gi, "")
    .replace(/Replied message\s*\(untrusted metadata\)?:\s*```json[\s\S]*?```/gi, "");

  // Remove any remaining fenced blocks.
  cleaned = cleaned.replace(/```[\s\S]*?```/g, " ");

  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(Conversation info|Sender|Replied message)/i.test(line));

  if (!lines.length) return "";

  // Prefer the first human-looking line (stable preview, avoids random tail like "exitCode": 0).
  const preferred = lines.find((line) => {
    if (/^[\[{"']/.test(line)) return false;
    if (/^(\}|\]|\),?)$/.test(line)) return false;
    if (/^"?[A-Za-z0-9_]+"?\s*:\s*.+$/.test(line)) return false; // object field lines
    return /[A-Za-z]/.test(line);
  });

  if (preferred) return preferred.replace(/\s+/g, " ").trim();

  // fallback
  return lines[0].replace(/\s+/g, " ").trim();
}

function summarizeGatewayLogObject(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;

  const part0Raw = safeString(record["0"] || "");
  const part1 = record["1"];
  const part2Raw = safeString(record["2"] || "");

  const part0 = part0Raw.replace(/\\"/g, '"').replace(/\s+/g, " ").trim();
  const part2 = part2Raw.replace(/\s+/g, " ").trim();

  // Best case: explicit human message in slot 2 (e.g., "cron: timer armed")
  if (part2) {
    const context = part0 ? ` • ${part0}` : "";
    return `${part2}${context}`;
  }

  // Common gateway success logs in slot 1
  if (typeof part1 === "string") {
    const text = part1.replace(/\s+/g, " ").trim();
    if (text) return text;
  }

  // Structured object in slot 1 (e.g., timer payload)
  if (part1 && typeof part1 === "object") {
    const p1 = part1 as Record<string, unknown>;
    if (typeof p1.delayMs === "number") {
      const sec = Math.round((p1.delayMs as number) / 1000);
      const nextAt = typeof p1.nextAt === "number" ? new Date(p1.nextAt as number).toISOString() : "";
      return `Timer armed • every ${sec}s${nextAt ? ` • next ${nextAt}` : ""}`;
    }

    const compact = safeString(p1).replace(/\s+/g, " ").trim();
    if (compact) return compact.length > 200 ? `${compact.slice(0, 197)}...` : compact;
  }

  if (part0) return part0;
  return "";
}

function summarizePathListingText(text: string): string {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const pathLines = lines.filter((l) => l.startsWith("./") || l.startsWith("/"));
  if (pathLines.length < 20) return "";

  const nodeModules = pathLines.filter((l) => l.includes("/node_modules/")).length;
  const gitMeta = pathLines.filter((l) => l.includes("/.git/")).length;
  const supabase = pathLines.filter((l) => l.includes("/supabase/")).length;

  const parts = [
    `${pathLines.length} paths`,
    nodeModules ? `${nodeModules} node_modules` : "",
    gitMeta ? `${gitMeta} .git` : "",
    supabase ? `${supabase} supabase` : "",
  ].filter(Boolean);

  return `Filesystem listing: ${parts.join(" • ")}`;
}

function summarizeGitStatusText(text: string): string {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const statusLines = lines.filter((l) => /^(M|A|D|R|C|\?\?)\s+/.test(l));
  if (!statusLines.length) return "";

  const counts = { modified: 0, added: 0, deleted: 0, untracked: 0 };
  for (const line of statusLines) {
    if (line.startsWith("M ")) counts.modified += 1;
    else if (line.startsWith("A ")) counts.added += 1;
    else if (line.startsWith("D ")) counts.deleted += 1;
    else if (line.startsWith("?? ")) counts.untracked += 1;
  }

  const parts = [
    counts.modified ? `${counts.modified} modified` : "",
    counts.added ? `${counts.added} added` : "",
    counts.deleted ? `${counts.deleted} deleted` : "",
    counts.untracked ? `${counts.untracked} untracked` : "",
  ].filter(Boolean);

  return `Git status: ${statusLines.length} file(s) changed${parts.length ? ` (${parts.join(", ")})` : ""}`;
}

function summarizeToolJsonText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  // Case 1: plain JSON array output
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        const firstItem = arr[0] as Record<string, unknown> | undefined;
        const id = safeString(firstItem?.id);
        return `Tool output: ${arr.length} item(s)${id ? ` (first id: ${id})` : ""}`;
      }
    } catch {
      return "Tool output: JSON array";
    }
  }

  // Case 2: object-wrapped tool result (aggregated, durationMs, toolName...)
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const toolName = safeString(obj.toolName || obj.tool || "tool");
      const duration = Number(obj.durationMs);
      const aggregated = safeString(obj.aggregated || "");
      let itemCount = 0;
      if (aggregated.trim().startsWith("[")) {
        try {
          const arr = JSON.parse(aggregated);
          if (Array.isArray(arr)) itemCount = arr.length;
        } catch {
          // ignore
        }
      }

      if (itemCount > 0) {
        return `${toolName} completed${Number.isFinite(duration) ? ` in ${duration}ms` : ""} • ${itemCount} item(s)`;
      }
      if (aggregated) {
        return `${toolName} completed${Number.isFinite(duration) ? ` in ${duration}ms` : ""}`;
      }
    } catch {
      // ignore
    }
  }

  return "";
}

function humanizePreview(message: string, payload: unknown): string {
  const msg = message.trim();
  if (msg && msg !== "[object Object]") {
    // Try to humanize JSON-like chat payloads
    try {
      const parsed = JSON.parse(msg) as Record<string, unknown>;

      const gatewaySummary = summarizeGatewayLogObject(parsed);
      if (gatewaySummary) return gatewaySummary.length > 220 ? `${gatewaySummary.slice(0, 217)}...` : gatewaySummary;

      const role = safeString(parsed.role).toLowerCase();
      const content = parsed.content;
      if (Array.isArray(content) && content.length > 0) {
        const first = content[0] as Record<string, unknown>;
        const rawText = safeString(first?.text || first?.message);

        // Tool results are often huge JSON arrays/objects; summarize them.
        if (role.includes("tool")) {
          const listingSummary = summarizePathListingText(rawText);
          if (listingSummary) return listingSummary;
          const gitSummary = summarizeGitStatusText(rawText);
          if (gitSummary) return gitSummary;
          const toolSummary = summarizeToolJsonText(rawText);
          if (toolSummary) return toolSummary;
        }

        const extracted = extractVisibleMessageFromEnvelope(rawText);
        const text = extracted || rawText.replace(/\s+/g, " ").trim();
        if (text) {
          const prefix = role ? `${role}: ` : "";
          const pretty = `${prefix}${text}`;
          return pretty.length > 220 ? `${pretty.slice(0, 217)}...` : pretty;
        }
      }
    } catch {
      // keep raw message path
    }

    const listingSummary = summarizePathListingText(msg);
    if (listingSummary) return listingSummary;

    const gitSummary = summarizeGitStatusText(msg);
    if (gitSummary) return gitSummary;

    const toolSummary = summarizeToolJsonText(msg);
    if (toolSummary) return toolSummary;

    const extracted = extractVisibleMessageFromEnvelope(msg);
    const compact = (extracted || msg).replace(/\s+/g, " ").trim();
    return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;

    const gatewaySummary = summarizeGatewayLogObject(record);
    if (gatewaySummary) return gatewaySummary.length > 220 ? `${gatewaySummary.slice(0, 217)}...` : gatewaySummary;

    const aggregatedDirect = safeString(record.aggregated || "");
    const details = (record.details && typeof record.details === "object") ? (record.details as Record<string, unknown>) : null;
    const aggregatedFromDetails = details ? safeString(details.aggregated || "") : "";
    const aggregated = aggregatedDirect || aggregatedFromDetails;
    if (aggregated) {
      const gitSummary = summarizeGitStatusText(aggregated);
      if (gitSummary) return gitSummary;
      const toolSummary = summarizeToolJsonText(aggregated);
      if (toolSummary) return toolSummary;
    }

    const nestedMessage = record.message as Record<string, unknown> | undefined;
    const nestedRole = safeString(nestedMessage?.role).toLowerCase();
    const nestedContent = Array.isArray(nestedMessage?.content) ? (nestedMessage?.content as Array<Record<string, unknown>>) : [];
    if (nestedContent.length > 0) {
      const rawText = safeString(nestedContent[0]?.text || nestedContent[0]?.message);

      if (nestedRole.includes("tool")) {
        const listingSummary = summarizePathListingText(rawText);
        if (listingSummary) return listingSummary;
        const gitSummary = summarizeGitStatusText(rawText);
        if (gitSummary) return gitSummary;
        const toolSummary = summarizeToolJsonText(rawText);
        if (toolSummary) return toolSummary;
      }

      const text = extractVisibleMessageFromEnvelope(rawText);
      if (text) return text.length > 220 ? `${text.slice(0, 217)}...` : text;
    }

    const preferredKeys = ["text", "event", "detail", "summary", "_meta"];
    for (const key of preferredKeys) {
      if (record[key] != null) {
        const value = safeString(record[key]).replace(/\s+/g, " ").trim();
        if (value) return value.length > 220 ? `${value.slice(0, 217)}...` : value;
      }
    }

    const parts = [record["2"], record["1"], record["0"]]
      .map((v) => safeString(v).replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (parts.length) {
      const joined = parts.join(" | ");
      return joined.length > 220 ? `${joined.slice(0, 217)}...` : joined;
    }

    const text = safeString(payload).replace(/\s+/g, " ").trim();
    return text.length > 220 ? `${text.slice(0, 217)}...` : text;
  }

  return "(no message)";
}

function normalizeLog(log: AgentLog): NormalizedLog {
  const row = log as unknown as Record<string, unknown>;
  const rawPayload = row.rawPayload ?? row.raw_payload ?? null;
  const message = pickString(row.message, row.message_preview, row.messagePreview);

  const levelRaw = row.level;
  const typeRaw = row.type;
  const directionRaw = row.direction;
  const channelRaw = row.channelType ?? row.channel_type;

  const level = typeof levelRaw === "string" ? levelRaw.toLowerCase() : "info";
  const type = typeof typeRaw === "string" ? typeRaw.toLowerCase() : "system";
  const direction = typeof directionRaw === "string" ? directionRaw.toLowerCase() : "internal";
  const channelType = typeof channelRaw === "string" ? channelRaw.toLowerCase() : "internal";

  return {
    id: pickString(row.id) || `${Date.now()}-${Math.random()}`,
    agentId: pickString(row.agentId, row.agent_id, row.runtime_agent_id, row.runtimeAgentId, "unknown"),
    agentName: pickString(row.agent_name, row.agentName, row.runtime_agent_id, row.runtimeAgentId, row.agentId, "unknown"),
    occurredAt: pickString(row.occurredAt, row.occurred_at, new Date().toISOString()),
    level,
    type,
    eventType: pickString(row.eventType, row.event_type, "system.warning").toLowerCase(),
    channelType,
    direction,
    message,
    messagePreview: humanizePreview(message, rawPayload),
    runId: pickString(row.runId, row.run_id),
    sessionKey: pickString(row.sessionKey, row.session_key),
    sourceMessageId: pickString(row.sourceMessageId, row.source_message_id),
    memorySource: pickString(row.memorySource, row.memory_source),
    rawPayload,
  };
}

function matchesGroup(log: NormalizedLog, group: FilterGroup) {
  if (group === "all") return true;
  if (group === "error") return log.level === "error" || log.level === "warning" || log.eventType.endsWith(".error");
  if (group === "chat") return log.eventType.startsWith("chat.") || log.type === "workflow";
  if (group === "tool") return log.eventType.startsWith("tool.") || log.type === "tool";
  if (group === "memory") return log.eventType.startsWith("memory.") || log.type === "memory";
  if (group === "system") return log.eventType.startsWith("system.") || log.eventType.startsWith("heartbeat.") || log.type === "system";
  if (group === "worker") return log.type === "worker" || log.type === "bullmq" || log.type === "cron";
  return true;
}

function fmtTime(value: string, baseNowIso: string) {
  const raw = String(value || "").trim();
  const normalized = raw.replace(/^"|"$/g, "");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "unknown";
  const base = new Date(baseNowIso);
  if (Number.isNaN(base.getTime())) return "unknown";
  return formatDistance(date, base, { addSuffix: true });
}

function eventLabel(eventType: string) {
  const map: Record<string, string> = {
    "chat.user_in": "User message received",
    "chat.assistant_out": "Assistant response emitted",
    "chat.reaction": "Reaction sent",
    "tool.start": "Tool started",
    "tool.success": "Tool completed",
    "tool.error": "Tool failed",
    "memory.read": "Memory read",
    "memory.write": "Memory write",
    "memory.search": "Memory search",
    "memory.upsert": "Memory upsert",
    "memory.error": "Memory error",
    "system.startup": "System startup",
    "system.shutdown": "System shutdown",
    "system.warning": "System warning",
    "system.error": "System error",
    "heartbeat.tick": "Heartbeat tick",
    "heartbeat.status_change": "Heartbeat status changed",
  };
  return map[eventType] || eventType;
}

function extractFullMessage(log: NormalizedLog): string {
  const payloadRecord = (log.rawPayload && typeof log.rawPayload === "object") ? (log.rawPayload as Record<string, unknown>) : null;
  const payloadMessage = payloadRecord?.message && typeof payloadRecord.message === "object"
    ? (payloadRecord.message as Record<string, unknown>)
    : null;
  const payloadContent = Array.isArray(payloadMessage?.content)
    ? (payloadMessage?.content as Array<Record<string, unknown>>)
    : [];
  const extractedFull = payloadContent.length > 0
    ? safeString(payloadContent[0]?.text || payloadContent[0]?.message)
    : "";
  return (log.message && log.message !== "[object Object]" ? log.message : "") ||
    extractedFull ||
    safeString(log.rawPayload) ||
    "(no message)";
}

function renderLogMarkdown(text: string): React.ReactNode[] {
  const cleaned = text.replace(/\n*>\s*`Agent:.*`$/, "").trim();
  const lines = cleaned.split("\n");
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("### ")) nodes.push(<h4 key={i} className="text-sm font-bold mt-3 mb-1">{line.slice(4)}</h4>);
    else if (line.startsWith("## ")) nodes.push(<h3 key={i} className="text-base font-bold mt-3 mb-1">{line.slice(3)}</h3>);
    else if (line.startsWith("# ")) nodes.push(<h2 key={i} className="text-lg font-bold mt-3 mb-1">{line.slice(2)}</h2>);
    else if (/^[-*]\s/.test(line)) nodes.push(<div key={i} className="flex gap-2 pl-1"><span className="text-muted-foreground shrink-0">•</span><span className="text-sm leading-relaxed">{line.replace(/^[-*]\s/, "")}</span></div>);
    else if (/^\d+\.\s/.test(line)) { const num = line.match(/^(\d+)\./)?.[1]; nodes.push(<div key={i} className="flex gap-2 pl-1"><span className="text-muted-foreground shrink-0 tabular-nums text-sm">{num}.</span><span className="text-sm leading-relaxed">{line.replace(/^\d+\.\s/, "")}</span></div>); }
    else if (line.trim() === "") nodes.push(<div key={i} className="h-2" />);
    else nodes.push(<p key={i} className="text-sm leading-relaxed">{line}</p>);
  }
  return nodes;
}

const LEVEL_ICONS: Record<string, { icon: string; color: string }> = {
  info: { icon: "ℹ️", color: "text-sky-600 dark:text-sky-400" },
  debug: { icon: "🔍", color: "text-zinc-600 dark:text-zinc-400" },
  warning: { icon: "⚠️", color: "text-amber-600 dark:text-amber-400" },
  error: { icon: "❌", color: "text-red-600 dark:text-red-400" },
};

const DIRECTION_LABELS: Record<string, string> = {
  inbound: "↙ Inbound",
  outbound: "↗ Outbound",
  internal: "↔ Internal",
};

function LogDetails({ log, initialNowIso }: { log: NormalizedLog; initialNowIso: string }) {
  const fullMessage = extractFullMessage(log);
  const [showRaw, setShowRaw] = useState(false);
  const levelCfg = LEVEL_ICONS[log.level] ?? LEVEL_ICONS.info;
  const isChat = log.eventType.startsWith("chat.");
  const isTool = log.eventType.startsWith("tool.");
  const isMemory = log.eventType.startsWith("memory.");

  // Extract structured details from payload
  const payloadRecord = (log.rawPayload && typeof log.rawPayload === "object") ? (log.rawPayload as Record<string, unknown>) : null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="cursor-pointer">Details</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[680px] max-h-[92vh] overflow-hidden p-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-0">
          <div className="flex items-center gap-3">
            <div className={cn(
              "flex items-center justify-center size-10 rounded-xl shrink-0",
              log.level === "error" ? "bg-red-500/15" :
              log.level === "warning" ? "bg-amber-500/15" :
              isChat ? "bg-blue-500/15" :
              isTool ? "bg-emerald-500/15" :
              isMemory ? "bg-fuchsia-500/15" :
              "bg-primary/10"
            )}>
              <span className="text-lg">{levelCfg.icon}</span>
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base">{eventLabel(log.eventType || log.type)}</DialogTitle>
              <DialogDescription className="text-[11px]">
                {log.eventType || log.type} • {fmtTime(log.occurredAt, initialNowIso)}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Two-column layout like ticket modal */}
        <div className="flex overflow-hidden" style={{ maxHeight: "calc(92vh - 140px)" }}>
          {/* Main content */}
          <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4 min-w-0">
            {/* Metadata grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1 rounded-lg border bg-muted/10 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Level</span>
                <Badge variant="outline" className={cn("w-fit capitalize", levelClasses[log.level] ?? levelClasses.info)}>{log.level}</Badge>
              </div>
              <div className="flex flex-col gap-1 rounded-lg border bg-muted/10 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Channel</span>
                <Badge variant="outline" className={cn("w-fit capitalize", channelClasses[log.channelType] ?? channelClasses.internal)}>{log.channelType || "internal"}</Badge>
              </div>
              <div className="flex flex-col gap-1 rounded-lg border bg-muted/10 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Direction</span>
                <span className="text-sm font-medium">{DIRECTION_LABELS[log.direction] ?? log.direction ?? "Internal"}</span>
              </div>
              <div className="flex flex-col gap-1 rounded-lg border bg-muted/10 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Agent</span>
                <span className="text-sm font-medium truncate">{log.agentName || "—"}</span>
              </div>
            </div>

            {/* Session / Run info */}
            {(log.sessionKey || log.runId || log.sourceMessageId) && (
              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Identifiers</span>
                <div className="rounded-lg border bg-muted/10 p-3 space-y-1.5">
                  {log.sessionKey && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">Session</span>
                      <code className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded max-w-[300px] truncate">{log.sessionKey}</code>
                    </div>
                  )}
                  {log.runId && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">Run ID</span>
                      <code className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded max-w-[300px] truncate">{log.runId}</code>
                    </div>
                  )}
                  {log.sourceMessageId && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">Message ID</span>
                      <code className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded max-w-[300px] truncate">{log.sourceMessageId}</code>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Memory info */}
            {log.memorySource && (
              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Memory</span>
                <div className="rounded-lg border bg-fuchsia-500/5 border-fuchsia-500/20 p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">Source</span>
                    <Badge variant="outline" className="text-[10px]">{log.memorySource}</Badge>
                  </div>
                </div>
              </div>
            )}

            {/* Message content */}
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {isChat ? "Message Content" : isTool ? "Tool Output" : isMemory ? "Memory Operation" : "Content"}
              </span>
              <div className="rounded-lg border bg-card p-4 max-h-[280px] overflow-auto">
                {isChat ? (
                  <div className="flex flex-col gap-0.5">{renderLogMarkdown(fullMessage)}</div>
                ) : (
                  <pre className="text-xs whitespace-pre-wrap break-words font-mono leading-relaxed">{fullMessage}</pre>
                )}
              </div>
            </div>

            {/* Raw payload — collapsible */}
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setShowRaw(!showRaw)}
                className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 cursor-pointer hover:text-foreground transition-colors"
              >
                Raw Payload
                <span className="text-[9px]">{showRaw ? "▲" : "▼"}</span>
              </button>
              {showRaw && (
                <pre className="max-h-[300px] overflow-auto rounded-lg border bg-muted/30 p-3 text-[11px] font-mono whitespace-pre-wrap break-all leading-relaxed">
{JSON.stringify(log.rawPayload, null, 2) || "null"}
                </pre>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LogsExplorer({ logs = [], agents = [], page, pageCount, totalCount, initialNowIso, onPageChange }: LogsExplorerProps) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<FilterGroup>("all");
  const [level, setLevel] = useState("all");
  const [channel, setChannel] = useState("all");
  const [agent, setAgent] = useState("all");

  const normalized = useMemo(() => logs.map(normalizeLog), [logs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return normalized.filter((log) => {
      if (!matchesGroup(log, group)) return false;
      if (level !== "all" && log.level !== level) return false;
      if (channel !== "all" && log.channelType !== channel) return false;
      if (agent !== "all" && log.agentName !== agent) return false;

      if (!q) return true;
      const haystack = [
        log.message,
        log.messagePreview,
        log.eventType,
        log.type,
        log.level,
        log.channelType,
        log.agentName,
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [normalized, query, group, level, channel, agent]);

  const agentOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const log of normalized) ids.add(log.agentName);
    for (const a of agents) ids.add(a.name || a.id);
    return [...ids].filter(Boolean).sort();
  }, [normalized, agents]);

  const pageButtons = useMemo(() => {
    const total = Math.max(1, pageCount);
    const start = Math.max(1, page - 2);
    const end = Math.min(total, start + 4);
    const adjustedStart = Math.max(1, end - 4);
    const values: number[] = [];
    for (let p = adjustedStart; p <= end; p += 1) values.push(p);
    return values;
  }, [page, pageCount]);

  const rangeStart = totalCount === 0 ? 0 : (page - 1) * 50 + 1;
  const rangeEnd = Math.min(totalCount, page * 50);

  return (
    <div className="grid gap-4 h-full">
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Runtime Logs</CardTitle>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search logs..." className="pl-9" />
            </div>

            <Select value={group} onValueChange={(v) => setGroup(v as FilterGroup)}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="All groups" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All groups</SelectItem>
                <SelectItem value="chat">Chat</SelectItem>
                <SelectItem value="tool">Tools</SelectItem>
                <SelectItem value="memory">Memory / Qdrant</SelectItem>
                <SelectItem value="system">System / Heartbeat</SelectItem>
                <SelectItem value="worker">Worker / Cron</SelectItem>
                <SelectItem value="error">Warnings + Errors</SelectItem>
              </SelectContent>
            </Select>

            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger className="w-[130px]"><SelectValue placeholder="All levels" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All levels</SelectItem>
                <SelectItem value="debug">Debug</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>

            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="All channels" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All channels</SelectItem>
                <SelectItem value="internal">Internal</SelectItem>
                <SelectItem value="telegram">Telegram</SelectItem>
                <SelectItem value="gateway">Gateway</SelectItem>
                <SelectItem value="qdrant">Qdrant</SelectItem>
              </SelectContent>
            </Select>

            <Select value={agent} onValueChange={setAgent}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="All agents" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All agents</SelectItem>
                {agentOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent className="space-y-3 flex flex-col h-full">
          <div className="rounded-md border overflow-hidden flex-1 min-h-0 overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Preview</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-16">
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-3xl">📭</span>
                        <span className="text-sm text-muted-foreground font-medium">No logs match your filters</span>
                        <span className="text-xs text-muted-foreground/60">Try adjusting your search or filter criteria</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filtered.map((log) => {
                  const isError = log.level === "error" || log.level === "warning";
                  return (
                    <TableRow key={log.id} className={cn(
                      "transition-colors",
                      log.level === "error" && "bg-red-500/[0.03] hover:bg-red-500/[0.06]",
                      log.level === "warning" && "bg-amber-500/[0.02] hover:bg-amber-500/[0.04]",
                    )}>
                      <TableCell className="text-xs text-muted-foreground tabular-nums">{fmtTime(log.occurredAt, initialNowIso)}</TableCell>
                      <TableCell><Badge variant="outline" className={cn("capitalize text-[10px]", levelClasses[log.level] ?? levelClasses.info)}>{log.level}</Badge></TableCell>
                      <TableCell className="max-w-[220px]">
                        <div className="font-semibold text-[13px] leading-tight">{eventLabel(log.eventType || log.type)}</div>
                        <div className="text-[10px] text-muted-foreground/60 font-mono mt-0.5">{log.eventType || log.type}</div>
                      </TableCell>
                      <TableCell><Badge variant="outline" className={cn("capitalize text-[10px]", channelClasses[log.channelType] ?? channelClasses.internal)}>{log.channelType || "internal"}</Badge></TableCell>
                      <TableCell className="text-sm font-medium">{log.agentName}</TableCell>
                      <TableCell className="max-w-[520px]">
                        <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-2">{log.messagePreview}</p>
                      </TableCell>
                      <TableCell className="text-right"><LogDetails log={log} initialNowIso={initialNowIso} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-muted-foreground">Showing {rangeStart}-{rangeEnd} of {totalCount} • Page {page} of {pageCount}</div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(1)}>First</Button>
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}>Previous</Button>
              {pageButtons.map((p) => (
                <Button key={p} variant={p === page ? "default" : "outline"} size="sm" onClick={() => onPageChange(p)}>
                  {p}
                </Button>
              ))}
              <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => onPageChange(Math.min(pageCount, page + 1))}>Next</Button>
              <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => onPageChange(pageCount)}>Last</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
