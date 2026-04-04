"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IconRefresh,
  IconSearch,
  IconAlertCircle,
  IconCircleCheck,
  IconInfoCircle,
  IconAlertTriangle,
  IconCalendarEvent,
  IconClock,
  IconFilter,
} from "@tabler/icons-react";

type LogEntry = {
  id: string;
  occurred_at: string;
  level: "info" | "warn" | "error";
  event_type: string;
  message: string;
  agenda_occurrence_id: string | null;
  runtime_agent_id: string | null;
  session_key: string | null;
  raw_payload: Record<string, unknown> | null;
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  "agenda.created":   "Occurrence created",
  "agenda.queued":    "Picked up by cron",
  "agenda.started":   "Execution started",
  "agenda.succeeded": "Succeeded",
  "agenda.failed":    "Failed",
  "agenda.fallback":  "Fallback queued",
  "agenda.error":     "Scheduler error",
};

const LEVEL_CONFIG: Record<string, { icon: React.ReactNode; className: string }> = {
  info:  { icon: <IconInfoCircle className="size-3.5 text-blue-500 shrink-0" />, className: "border-l-blue-400" },
  warn:  { icon: <IconAlertTriangle className="size-3.5 text-amber-500 shrink-0" />, className: "border-l-amber-400" },
  error: { icon: <IconAlertCircle className="size-3.5 text-red-500 shrink-0" />, className: "border-l-red-400" },
};

const EVENT_TYPE_BADGE: Record<string, string> = {
  "agenda.created":   "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  "agenda.queued":    "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "agenda.started":   "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  "agenda.succeeded": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "agenda.failed":    "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  "agenda.fallback":  "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "agenda.error":     "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

function formatTime(ts: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "short",
      timeStyle: "medium",
    }).format(new Date(ts));
  } catch {
    return ts;
  }
}

function RelativeTime({ ts }: { ts: string }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    const update = () => {
      const diff = Date.now() - new Date(ts).getTime();
      if (diff < 60_000) setLabel("just now");
      else if (diff < 3_600_000) setLabel(`${Math.floor(diff / 60_000)}m ago`);
      else if (diff < 86_400_000) setLabel(`${Math.floor(diff / 3_600_000)}h ago`);
      else setLabel(formatTime(ts));
    };
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [ts]);
  return <span title={formatTime(ts)}>{label}</span>;
}

export function AgendaLogsClient() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<"all" | "info" | "warn" | "error">("all");
  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const LIMIT = 50;

  const load = useCallback(async (p = page) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(LIMIT),
        page: String(p),
      });
      if (levelFilter !== "all") params.set("level", levelFilter);
      if (eventTypeFilter !== "all") params.set("eventType", eventTypeFilter);
      const res = await fetch(`/api/agenda/logs?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setLogs(json.logs ?? []);
      setTotal(json.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }, [page, levelFilter, eventTypeFilter]);

  useEffect(() => {
    void load(1);
    setPage(1);
  }, [levelFilter, eventTypeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load(page);
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 15s
  useEffect(() => {
    autoRefreshRef.current = setInterval(() => void load(page), 15_000);
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [load, page]);

  const filtered = search.trim()
    ? logs.filter((l) =>
        l.message.toLowerCase().includes(search.toLowerCase()) ||
        l.event_type.toLowerCase().includes(search.toLowerCase()) ||
        l.runtime_agent_id?.toLowerCase().includes(search.toLowerCase()) ||
        l.agenda_occurrence_id?.toLowerCase().includes(search.toLowerCase())
      )
    : logs;

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search messages, events, agents…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>

        <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
          <SelectTrigger className="h-9 w-[180px] cursor-pointer text-sm">
            <IconFilter className="size-3.5 mr-1 text-muted-foreground" />
            <SelectValue placeholder="Event type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All event types</SelectItem>
            {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={levelFilter} onValueChange={(v) => setLevelFilter(v as typeof levelFilter)}>
          <SelectTrigger className="h-9 w-[120px] cursor-pointer text-sm">
            <SelectValue placeholder="Level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warn">Warn</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 cursor-pointer"
          onClick={() => void load(page)}
        >
          <IconRefresh className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>

        <span className="text-xs text-muted-foreground ml-auto">
          {total} total · auto-refreshes every 15s
        </span>
      </div>

      {/* Log list */}
      <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border bg-card">
        {error ? (
          <div className="flex items-center gap-2 p-6 text-sm text-red-600">
            <IconAlertCircle className="size-4 shrink-0" />
            {error}
          </div>
        ) : loading && logs.length === 0 ? (
          <div className="flex flex-col gap-2 p-6">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 rounded-lg bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
            <IconCalendarEvent className="size-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No agenda logs yet.</p>
            <p className="text-xs text-muted-foreground/60">
              Logs appear once events are created and picked up by the scheduler.
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {filtered.map((log) => {
              const levelCfg = LEVEL_CONFIG[log.level] ?? LEVEL_CONFIG.info;
              const badgeClass = EVENT_TYPE_BADGE[log.event_type] ?? "bg-muted text-foreground";
              const label = EVENT_TYPE_LABELS[log.event_type] ?? log.event_type;
              const isExpanded = expandedIds.has(log.id);
              const hasPayload = log.raw_payload && Object.keys(log.raw_payload).length > 0;

              return (
                <div
                  key={log.id}
                  className={`flex flex-col gap-1 px-4 py-3 border-l-2 hover:bg-muted/30 transition-colors ${levelCfg.className}`}
                >
                  {/* Main row */}
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">{levelCfg.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${badgeClass}`}>
                          {label}
                        </span>
                        {log.runtime_agent_id && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {log.runtime_agent_id}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground ml-auto flex items-center gap-1">
                          <IconClock className="size-3" />
                          <RelativeTime ts={log.occurred_at} />
                        </span>
                      </div>
                      <p className="text-sm mt-1 leading-snug text-foreground/90">{log.message}</p>
                      {log.agenda_occurrence_id && (
                        <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                          occurrence: {log.agenda_occurrence_id}
                        </p>
                      )}
                    </div>
                    {hasPayload && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px] cursor-pointer shrink-0"
                        onClick={() => toggleExpand(log.id)}
                      >
                        {isExpanded ? "hide" : "details"}
                      </Button>
                    )}
                  </div>

                  {/* Expanded payload */}
                  {isExpanded && hasPayload && (
                    <pre className="mt-2 ml-7 text-[10px] bg-muted/40 rounded-md p-3 overflow-x-auto text-foreground/70 leading-relaxed">
                      {JSON.stringify(log.raw_payload, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="h-8 cursor-pointer"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 cursor-pointer"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

// Needed for status icon standalone use
function StatusIcon({ status }: { status: string }) {
  if (status === "succeeded") return <IconCircleCheck className="size-3.5 text-emerald-500" />;
  if (status === "failed") return <IconAlertCircle className="size-3.5 text-red-500" />;
  return null;
}
void StatusIcon; // silence unused warning
