"use client";

import { useEffect, useRef, useState, useCallback } from "react";
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
};

// ── Persistent store (survives remounts) ─────────────────────────────────────

// Module-level singleton: keeps SSE connection + entries alive across
// React component mount/unmount cycles (page navigations).
let _globalEs: EventSource | null = null;
let _globalEntries: ActivityEntry[] = [];
let _globalConnected = false;
const _listeners = new Set<() => void>();

function notifyListeners() {
  for (const fn of _listeners) fn();
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
      // Deduplicate by id
      _globalEntries = [entry, ..._globalEntries.filter(x => x.id !== entry.id)].slice(0, MAX_ENTRIES);
      _globalConnected = true;
      notifyListeners();
    } catch {
      /* ignore parse errors */
    }
  });

  _globalEs.onerror = () => {
    _globalConnected = false;
    notifyListeners();
    // EventSource auto-reconnects
  };
}

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

// ── Component ────────────────────────────────────────────────────────────────

export function NavActivity(): React.ReactElement {
  const [entries, setEntries] = useState<ActivityEntry[]>(_globalEntries);
  const [connected, setConnected] = useState(_globalConnected);

  // Subscribe to the global singleton and ensure connection exists
  useEffect(() => {
    ensureConnection();

    const listener = () => {
      setEntries([..._globalEntries]);
      setConnected(_globalConnected);
    };
    _listeners.add(listener);

    // Sync initial state (connection may already be live from previous mount)
    listener();

    return () => {
      _listeners.delete(listener);
      // Don't close the EventSource — keep it alive for next mount
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
            entries.map((entry) => {
              const config = LEVEL_CONFIG[entry.level] || LEVEL_CONFIG.info;
              return (
                <div
                  key={entry.id}
                  className="flex items-start gap-1.5 py-1 animate-in fade-in slide-in-from-top-1 duration-300"
                >
                  <span
                    className={cn("mt-1 size-1.5 shrink-0 rounded-full", config.dot)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={cn(
                          "text-[10px] font-medium truncate",
                          config.text
                        )}
                      >
                        {entry.event}
                      </span>
                      <span className="text-[8px] text-muted-foreground/50 shrink-0 tabular-nums">
                        {relativeTime(entry.timestamp)}
                      </span>
                    </div>
                    <p className="text-[9px] text-muted-foreground/70 truncate leading-tight">
                      {entry.type === "agenda" ? "📅 " : "🎫 "}
                      {entry.title}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
