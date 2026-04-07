"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { statusHex, statusLabel, statusMeta, statusText } from "@/lib/status-colors";
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
  ticketId?: string;
  boardId?: string;
};

function normalizeAgendaEvent(rawEvent: string): string {
  const raw = String(rawEvent || "").trim().toLowerCase();
  if (!raw) return raw;
  const withoutPrefix = raw.startsWith("agenda.") ? raw.slice("agenda.".length) : raw;
  if (withoutPrefix === "started") return "running";
  if (withoutPrefix === "created") return "scheduled";
  return withoutPrefix;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return "";
  const diff = Math.max(0, now - then);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 30) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Human-readable label for the event status/action. */
function formatActivityEvent(entry: ActivityEntry): string {
  const raw = (entry.event || "").toLowerCase();
  const normalizedAgenda = entry.type === "agenda" ? normalizeAgendaEvent(raw) : raw;

  // Agenda: use canonical labels from status-colors.ts
  if (entry.type === "agenda" && statusMeta(normalizedAgenda)) return statusLabel(normalizedAgenda);

  // Ticket / non-canonical fallback
  if (raw === "force_retry") return "Force retried";
  if (raw === "created")     return "Created";
  if (raw === "updated")     return "Updated";
  if (raw === "deleted")     return "Deleted";
  if (raw === "activity" || raw === "change") return "Activity";
  if (raw.includes("comment"))   return "Comment";
  if (raw.includes("assigned"))  return "Assigned";
  if (raw.includes("running"))   return "Running";
  if (raw.includes("succeeded") || raw.includes("completed")) return "Succeeded";
  if (raw.includes("failed")    || raw.includes("expired"))   return "Failed";
  if (raw.includes("cancelled")) return "Cancelled";
  // Title-case the raw value as last resort
  return entry.event
    ? entry.event.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Activity";
}

/** Friendly agent name. */
function agentLabel(agent: string): string {
  if (!agent || agent === "main") return "Main agent";
  if (agent === "worker")         return "Worker";
  // Strip common prefixes (e.g. "agent:main:xxx" → "xxx")
  const parts = agent.split(":");
  const last = parts[parts.length - 1];
  return last.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Dot visuals ──────────────────────────────────────────────────────────────

/** Returns inline style for the colored status dot. */
function dotStyle(entry: ActivityEntry): React.CSSProperties {
  // Agenda entries: use exact hex from status-colors
  if (entry.type === "agenda") {
    const normalized = normalizeAgendaEvent(entry.event);
    if (statusMeta(normalized)) {
      const hex = statusHex(normalized);
      return { backgroundColor: hex, boxShadow: `0 0 5px ${hex}70` };
    }
  }
  // Ticket / fallback: derive from level
  const LEVEL_HEX: Record<string, string> = {
    success: "#22c55e",
    error:   "#ef4444",
    warning: "#f59e0b",
    info:    "#3b82f6",
  };
  const hex = LEVEL_HEX[entry.level] ?? "#9CA3AF";
  return { backgroundColor: hex };
}

/** Returns the CSS color for the event label text. */
function labelColor(entry: ActivityEntry): string {
  if (entry.type === "agenda") {
    const normalized = normalizeAgendaEvent(entry.event);
    if (statusMeta(normalized)) return statusText(normalized);
  }
  const LEVEL_TEXT: Record<string, string> = {
    success: "#22c55e",
    error:   "#ef4444",
    warning: "#f59e0b",
    info:    "#3b82f6",
  };
  return LEVEL_TEXT[entry.level] ?? "#9CA3AF";
}

// ── Running dot animation class ───────────────────────────────────────────────

function isAnimated(entry: ActivityEntry): boolean {
  return entry.type === "agenda" && ["running", "auto_retry"].includes(normalizeAgendaEvent(entry.event));
}

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
      // Prepend and deduplicate — most recent update for a given id wins
      _globalEntries = [
        entry,
        ..._globalEntries.filter((x) => x.id !== entry.id),
      ].slice(0, _maxEntries);
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
  const router = useRouter();
  const [entries, setEntries] = useState<ActivityEntry[]>(_globalEntries);
  const [connected, setConnected] = useState(_globalConnected);

  useEffect(() => {
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

  // Refresh relative timestamps every 30 s
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Deduplicate before render — same id can arrive from both initial load + SSE
  const dedupedEntries = [...new Map(entries.map((e) => [e.id, e])).values()];

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
            {connected ? "Live" : "Connecting…"}
          </span>
        </span>
      </SidebarGroupLabel>

      <SidebarGroupContent>
        <div className="flex flex-col gap-0.5 px-2 pb-1">
          {dedupedEntries.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/40 py-3 text-center italic">
              No recent activity
            </p>
          ) : (
            dedupedEntries.map((entry) => {
              const href = entry.targetUrl || (entry.type === "agenda" ? "/agenda" : "/boards");
              const dot = dotStyle(entry);
              const color = labelColor(entry);
              const animated = isAnimated(entry);

              const handleEntryClick = (e: React.MouseEvent) => {
                e.preventDefault();
                if (entry.type === "ticket" && entry.ticketId && entry.boardId) {
                  // Navigate to the board, then dispatch a custom event to open
                  // the ticket modal — no ?ticket= in the URL so refresh is clean
                  router.push(`/boards?board=${encodeURIComponent(entry.boardId)}`);
                  window.dispatchEvent(new CustomEvent("mc:open-ticket", {
                    detail: { ticketId: entry.ticketId, boardId: entry.boardId },
                  }));
                } else {
                  router.push(href);
                }
              };

              return (
                <button
                  key={entry.id}
                  onClick={handleEntryClick}
                  className="flex items-start gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/40 group w-full text-left"
                  title={`${entry.title} — ${formatActivityEvent(entry)}`}
                >
                  {/* Status dot */}
                  <span
                    className={cn(
                      "mt-[3px] size-1.5 shrink-0 rounded-full",
                      animated && "animate-pulse"
                    )}
                    style={dot}
                  />

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {/* Top row: event label + timestamp */}
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className="text-[10px] font-semibold truncate"
                        style={{ color }}
                      >
                        {formatActivityEvent(entry)}
                      </span>
                      <span className="text-[8px] text-muted-foreground/50 shrink-0 tabular-nums">
                        {relativeTime(entry.timestamp)}
                      </span>
                    </div>

                    {/* Bottom row: title + agent badge */}
                    <div className="flex items-center gap-1 min-w-0">
                      <p className="text-[9px] text-muted-foreground/70 truncate leading-tight flex-1">
                        {entry.title}
                      </p>
                      {entry.agent && (
                        <span className="text-[8px] text-muted-foreground/40 shrink-0 tabular-nums">
                          {agentLabel(entry.agent)}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
