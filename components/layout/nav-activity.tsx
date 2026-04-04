"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
} from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
} from "@/components/ui/sidebar";

// ── Types ────────────────────────────────────────────────────────────────────

type ActivityEntry = {
  id: string;
  type: "ticket" | "agenda";
  title: string;
  event: string;
  agent: string;
  level: string;
  timestamp: string;
  targetUrl?: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return "";
  const diff = Math.max(0, now - then);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatActivityEvent(entry: ActivityEntry): string {
  const raw = (entry.event || "").toLowerCase();
  if (raw === "force_retry" || raw.includes("force_retry") || raw.includes("force retry")) return "Force Retried";
  if (raw === "auto_retry" || raw.includes("auto_retry")) return "Auto-retrying";
  if (raw === "needs_retry" || raw.includes("needs_retry")) return "Needs Retry";
  if (raw === "stale_recovery" || raw.includes("stale")) return "Stale Recovery";
  if (raw.includes("running") || raw.includes("picked up") || raw.includes("planning")) return "Executing";
  if (raw.includes("queued") || raw.includes("scheduled")) return "Queued";
  if (raw === "succeeded" || raw.includes("succeeded") || raw.includes("completed")) return "Completed";
  if (raw === "failed" || raw.includes("failed") || raw.includes("expired")) return "Failed";
  if (raw === "cancelled" || raw.includes("cancelled")) return "Cancelled";
  if (raw === "created" || raw.includes("created")) return "Created";
  return entry.event || "Activity";
}

const LEVEL_CONFIG: Record<
  string,
  {
    dot: string;
    text: string;
    Icon: typeof CheckCircle2;
  }
> = {
  success: { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", Icon: CheckCircle2 },
  error: { dot: "bg-red-500", text: "text-red-600 dark:text-red-400", Icon: XCircle },
  warning: { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", Icon: AlertTriangle },
  info: { dot: "bg-blue-500", text: "text-blue-600 dark:text-blue-400", Icon: Info },
};

const MAX_ENTRIES = 8;

// ── Singleton SSE (survives remounts, no reconnect flicker) ──────────────────

let _globalEs: EventSource | null = null;
let _globalEntries: ActivityEntry[] = [];
let _globalConnected = false;
let _initialLoaded = false;
let _maxEntries = MAX_ENTRIES;
const _listeners = new Set<() => void>();

function notifyListeners() {
  for (const fn of _listeners) fn();
}

async function loadInitialEntries() {
  if (_initialLoaded) return;
  _initialLoaded = true;
  try {
    const res = await fetch("/api/notifications/recent", { cache: "reload" });
    const json = await res.json();
    if (json.ok && Array.isArray(json.entries)) {
      if (typeof json.limit === "number" && json.limit > 0) {
        _maxEntries = json.limit;
      }
      _globalEntries = json.entries.slice(0, _maxEntries);
      notifyListeners();
    }
  } catch {
    /* ignore fetch errors */
  }
}

function ensureConnection() {
  if (_globalEs && _globalEs.readyState !== EventSource.CLOSED) return;

  _globalEs = new EventSource("/api/notifications/stream");

  _globalEs.addEventListener("connected", () => {
    _globalConnected = true;
    notifyListeners();
  });

  _globalEs.addEventListener("activity", (e) => {
    try {
      const entry: ActivityEntry = JSON.parse(e.data);
      _globalEntries = [entry, ..._globalEntries.filter(x => x.id !== entry.id)].slice(0, _maxEntries);
      _globalConnected = true;
      notifyListeners();
    } catch {
      /* ignore parse errors */
    }
  });

  _globalEs.onerror = () => {
    _globalConnected = false;
    notifyListeners();
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export function NavActivity(): React.ReactElement {
  const [entries, setEntries] = useState<ActivityEntry[]>(_globalEntries);
  const [connected, setConnected] = useState(_globalConnected);

  useEffect(() => {
    // Fetch from DB on first mount, then SSE for live updates
    void loadInitialEntries();
    ensureConnection();

    const listener = () => {
      setEntries([..._globalEntries]);
      setConnected(_globalConnected);
    };
    _listeners.add(listener);
    listener();

    return () => {
      _listeners.delete(listener);
    };
  }, []);

  // Refresh relative times every 30s
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="flex items-center justify-between">
        <span>Live Activity</span>
        <span className="flex items-center gap-1">
          <span
            className={cn(
              "size-1.5 rounded-full transition-colors",
              connected ? "bg-emerald-500" : "bg-amber-500 animate-pulse"
            )}
          />
          <span className="text-[9px] text-muted-foreground">
            {connected ? "Live" : "…"}
          </span>
        </span>
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <div className="flex flex-col gap-0.5 px-2 pb-1">
          {entries.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/50 py-2 text-center">
              No activity yet
            </p>
          ) : (
            // Deduplicate by id — same occurrence can appear twice from SSE + polling
            [...new Map(entries.map((e) => [e.id, e])).values()].map((entry) => {
              const config = LEVEL_CONFIG[entry.level] || LEVEL_CONFIG.info;
              const href = entry.targetUrl || (entry.type === "agenda" ? "/agenda" : "/boards");
              return (
                <Link
                  key={entry.id}
                  href={href}
                  className="flex items-start gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/40"
                  title={`Open ${entry.type} details`}
                >
                  <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", config.dot)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className={cn("text-[10px] font-medium truncate", config.text)}>
                        {formatActivityEvent(entry)}
                      </span>
                      <span className="text-[8px] text-muted-foreground/50 shrink-0 tabular-nums">
                        {relativeTime(entry.timestamp)}
                      </span>
                    </div>
                    <p className="text-[9px] text-muted-foreground/80 truncate leading-tight">
                      {entry.title}{entry.agent ? ` · ${entry.agent}` : ""}
                    </p>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
