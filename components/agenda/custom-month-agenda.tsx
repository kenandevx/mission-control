"use client";

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isToday,
  addMonths, subMonths, addWeeks, subWeeks, addDays, subDays,
  format,
} from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IconChevronLeft,
  IconChevronRight,
  IconInfoCircle,
} from "@tabler/icons-react";
import type { AgendaEventSummary } from "@/components/agenda/agenda-details-sheet";
import { useNow, formatDuration, LiveDuration } from "@/hooks/use-now";
import {
  EVENT_COLORS, DOT_COLORS, STATUS_GUIDE_ENTRIES,
  resolveEventColorKey, resolveEventColor,
} from "@/lib/status-colors";
import type { EventColor } from "@/lib/status-colors";

// ── Types ────────────────────────────────────────────────────────────────────

export type CalendarEvent = {
  id: string;
  title: string;
  date: string; // "yyyy-MM-dd"
  time?: string; // "HH:mm"
  color?: EventColor;
  isRecurring?: boolean;
  status?: "draft" | "active";
  latestResult?: "scheduled" | "running" | "succeeded" | "failed" | "needs_retry" | "queued" | null;
  runStartedAt?: string | null;
  runFinishedAt?: string | null;
  timezone?: string;
  scheduledFor?: string | null; // ISO timestamp of the next occurrence's scheduled_for
};

// EventColor re-exported from @/lib/status-colors
export type { EventColor } from "@/lib/status-colors";

export type ViewMode = "month" | "week" | "day";

export type AgendaCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  backgroundColor?: string;
  extendedProps?: Record<string, unknown>;
};

// ── Current time indicator line ──────────────────────────────────────────────

function NowIndicator({ now, hourHeight, leftOffset = 0 }: { now: Date; hourHeight: number; leftOffset?: number | string }) {
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const topPx = ((hours * 60 + minutes) / 60) * hourHeight;
  return (
    <div
      className="absolute pointer-events-none z-[2]"
      style={{ top: `${topPx}px`, left: leftOffset, right: 0 }}
    >
      {/* Purple dot */}
      <div
        className="absolute -top-[6px] -left-[6px] size-[12px] rounded-full bg-primary shadow-md"
        style={{ boxShadow: "0 0 8px var(--primary-glow)" }}
      />
      {/* Accent line */}
      <div
        className="w-full h-[2.5px] bg-primary"
        style={{ boxShadow: "0 0 6px hsl(var(--accent) / 0.4)" }}
      />
    </div>
  );
}

function getTimezoneAbbr(timezone: string | undefined): string {
  if (!timezone) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      timeZoneName: 'short',
    }).formatToParts(new Date());
    return parts.find(p => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}


const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_VISIBLE = 4;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 72; // px per hour slot in week/day views

// Color palette, dot colors, status mapping, and resolve functions
// imported from @/lib/status-colors

// ── Occurrence status indicator ─────────────────────────────────────────────────

const RESULT_INDICATOR: Record<string, { emoji: string; color: string; pulse?: boolean }> = {
  running:      { emoji: "", color: "bg-orange-500", pulse: true },
  scheduled:    { emoji: "", color: "bg-teal-500" },
  queued:       { emoji: "", color: "bg-violet-500" },
  succeeded:    { emoji: "", color: "bg-emerald-500" },
  failed:       { emoji: "", color: "bg-rose-500" },
  needs_retry:  { emoji: "", color: "bg-amber-500" },
  cancelled:    { emoji: "", color: "bg-zinc-400" },
  skipped:      { emoji: "", color: "bg-yellow-500" },
  auto_retry:   { emoji: "", color: "bg-pink-500", pulse: true },
  stale_recovery: { emoji: "", color: "bg-orange-500" },
};

// ── Cron countdown (for queued/scheduled events) ─────────────────────────────

function CronCountdown({ scheduledFor }: { scheduledFor: string | null | undefined }) {
  const now = useNow(1_000);
  if (!scheduledFor) return null;
  const targetMs = new Date(scheduledFor).getTime();
  const diffMs = targetMs - now.getTime();
  if (diffMs <= 0) return null;
  const totalSecs = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSecs / 86_400);
  const hours = Math.floor((totalSecs % 86_400) / 3_600);
  const mins = Math.floor((totalSecs % 3_600) / 60);
  const secs = totalSecs % 60;
  let label: string;
  if (days > 0) label = `${days}d`;
  else if (hours > 0) label = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  else if (mins > 0) label = secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  else label = `${secs}s`;
  return (
    <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold tabular-nums text-gray-500 dark:text-gray-400 shrink-0">
      <svg viewBox="0 0 16 16" fill="none" className="size-2.5 shrink-0" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="8" cy="8" r="6.5" />
        <path d="M8 4.5v3.5l2 2" strokeLinecap="round" />
      </svg>
      {label}
    </span>
  );
}

function OccurrenceStatusDot({ result, size = 6 }: { result: CalendarEvent["latestResult"]; size?: number }) {
  if (!result || !RESULT_INDICATOR[result]) return null;
  const cfg = RESULT_INDICATOR[result];

  if (result === 'running') {
    return (
      <span className="relative flex shrink-0" style={{ width: size, height: size }} title="Running">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
        <span className="relative inline-flex rounded-full bg-orange-500" style={{ width: size, height: size }} />
      </span>
    );
  }

  if (result === 'needs_retry') {
    return (
      <span className="relative flex shrink-0" style={{ width: size, height: size }} title="Needs Retry">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-60" style={{ animationDuration: '2.5s' }} />
        <span className="relative inline-flex rounded-full bg-amber-500" style={{ width: size, height: size }} />
      </span>
    );
  }

  return (
    <span
      className="relative inline-flex shrink-0"
      title={result.charAt(0).toUpperCase() + result.slice(1)}
    >
      <span
        className={`relative inline-flex rounded-full ${cfg.color}`}
        style={{ width: size, height: size }}
      />
    </span>
  );
}

function RunningBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/12 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] leading-none text-orange-700 dark:text-orange-300 shadow-sm ring-1 ring-orange-500/20">
      <span className="relative inline-flex size-3 shrink-0 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-orange-500/30 animate-ping" />
        <span className="size-3 rounded-full border-[2.5px] border-orange-500 border-t-transparent animate-spin" />
      </span>
      <span>Running</span>
    </span>
  );
}

function NeedsRetryBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/12 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] leading-none text-amber-700 dark:text-amber-300 shadow-sm ring-1 ring-amber-500/20">
      <span className="relative inline-flex size-3 shrink-0 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-amber-500/20 animate-ping" style={{ animationDuration: '2.5s' }} />
        <span className="size-2 rounded-full bg-amber-500" />
      </span>
      <span className="animate-pulse" style={{ animationDuration: '2.5s' }}>Retry</span>
    </span>
  );
}

const STATUS_LABEL_COLORS: Record<string, string> = {
  scheduled: "#0891b2",
  queued: "#8b5cf6",
  running: "#2563eb",
  auto_retry: "#ec4899",
  stale_recovery: "#ea580c",
  succeeded: "#16a34a",
  failed: "#e11d48",
  needs_retry: "#d97706",
  cancelled: "#52525b",
  skipped: "#a16207",
  draft: "#6b7280",
};

function StatusGuideLabel({ statusKey, label }: { statusKey: string; label: string }) {
  const textColor = STATUS_LABEL_COLORS[statusKey] ?? undefined;
  return (
    <span className="text-xs font-semibold" style={{ color: textColor }}>{label}</span>
  );
}

// ── Recurring icon ─────────────────────────────────────────────────────────────

function RecurringIcon({ size = 9 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      className="shrink-0 opacity-70"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}

// ── Event pill — matches JSONC AgendaEventItem spec ─────────────────────────────

function EventPill({ event }: { event: CalendarEvent }) {
  const resolved = resolveEventColor(event);
  const { bg, text: color } = resolved;
  const resolvedKey = resolveEventColorKey(event);
  const dotColor = DOT_COLORS[resolvedKey] ?? "#6b7280";
  const isDraft = event.status === "draft";

  // Parse 12/24h time from "HH:mm"
  const timeStr = (() => {
    if (!event.time) return null;
    const [h, m] = event.time.split(":").map(Number);
    if (isNaN(h)) return null;
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
  })();

  return (
    <div
      className={[
        "flex flex-col gap-0.5 min-h-[30px] px-[8px] py-[4px] rounded-md overflow-hidden w-full transition-all duration-150 hover:shadow-md hover:brightness-95",
        event.latestResult === "running" ? "agenda-running ring-1 ring-orange-400/20" : "",
        event.latestResult === "needs_retry" ? "agenda-needs-retry" : "",
      ].join(" ")}
      style={{
        backgroundColor: bg,
        // Use explicit border props to avoid React shorthand conflict warning
        borderLeftWidth: "3px",
        borderLeftStyle: isDraft ? "dashed" : "solid",
        borderLeftColor: dotColor,
        opacity: isDraft ? 0.65 : 1,
      }}
    >
      {/* Title row */}
      <div className="flex items-center gap-1.5">
        <span
          className="size-1.5 rounded-full shrink-0"
          style={{ backgroundColor: dotColor }}
        />
        <span
          className="flex-1 text-[12px] font-semibold leading-tight truncate"
          style={{ color, letterSpacing: "-0.01em" }}
        >
          {event.title}
        </span>
        <OccurrenceStatusDot result={event.latestResult} size={6} />
      </div>

      {/* Time + status row */}
      <div className="flex items-center gap-1.5 pl-[14px]">
        {timeStr && (
          <span
            className="text-[10px] font-medium leading-none"
            style={{ color, opacity: 0.7 }}
          >
            {timeStr}
          </span>
        )}
        {(event.latestResult === "queued" || event.latestResult === "scheduled") && (
          <CronCountdown scheduledFor={event.scheduledFor} />
        )}
        {event.latestResult && event.latestResult !== "scheduled" && event.latestResult !== "queued" && (
          event.latestResult === "running" ? (
            <span className="inline-flex items-center gap-1.5">
              <RunningBadge />
              <LiveDuration startedAt={event.runStartedAt} finishedAt={event.runFinishedAt} prefix="· " className="text-[9px] font-bold tabular-nums text-orange-600 dark:text-orange-400" />
            </span>
          ) : event.latestResult === "needs_retry" ? (
            <NeedsRetryBadge />
          ) : (
            <span
              className="text-[8px] font-bold uppercase tracking-wider leading-none"
              style={{
                color: event.latestResult === "succeeded" ? "#16a34a"
                  : event.latestResult === "failed" ? "#dc2626"
                  : event.latestResult === "cancelled" ? "#71717a"
                  : event.latestResult === "skipped" ? "#ca8a04"
                  : undefined,
                opacity: 0.85,
              }}
            >
              {event.latestResult === "succeeded" ? "✓ Done"
                : event.latestResult === "failed" ? "✗ Failed"
                : event.latestResult === "cancelled" ? "Cancelled"
                : event.latestResult === "skipped" ? "⏭ Skipped"
                : event.latestResult}
              <LiveDuration startedAt={event.runStartedAt} finishedAt={event.runFinishedAt} prefix=" · " className="text-[8px] font-bold tabular-nums" />
            </span>
          )
        )}
      </div>
    </div>
  );
}

// ── Time-grid event block (larger, for week/day views) ───────────────────────

function TimeGridEventBlock({ event }: { event: CalendarEvent }) {
  const resolved = resolveEventColor(event);
  const { bg, text: color } = resolved;
  const resolvedKey = resolveEventColorKey(event);
  const dotColor = DOT_COLORS[resolvedKey] ?? "#6b7280";
  const isDraft = event.status === "draft";

  const timeStr = (() => {
    if (!event.time) return null;
    const [h, m] = event.time.split(":").map(Number);
    if (isNaN(h)) return null;
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
  })();

  return (
    <div
      className={[
        "flex flex-col gap-0.5 px-[10px] py-[6px] rounded-lg overflow-visible w-full min-h-[56px] transition-all duration-150 hover:shadow-lg hover:brightness-95",
        event.latestResult === "running" ? "agenda-running ring-1 ring-orange-400/25" : "",
        event.latestResult === "needs_retry" ? "agenda-needs-retry" : "",
      ].join(" ")}
      style={{
        backgroundColor: bg,
        // Use explicit border props to avoid React shorthand conflict warning
        borderLeftWidth: "4px",
        borderLeftStyle: isDraft ? "dashed" : "solid",
        borderLeftColor: dotColor,
        opacity: isDraft ? 0.65 : 1,
      }}
    >
      {/* Title row with status */}
      <div className="flex items-center gap-1.5">
        <span
          className="flex-1 text-[13px] font-bold leading-tight truncate"
          style={{ color, letterSpacing: "-0.01em" }}
        >
          {event.title}
        </span>
        <OccurrenceStatusDot result={event.latestResult} size={8} />
      </div>

      {/* Time + recurring + status label */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {timeStr && (
          <span
            className="text-[11px] font-semibold leading-none"
            style={{ color, opacity: 0.7 }}
          >
            {timeStr}{event.timezone ? ` ${getTimezoneAbbr(event.timezone)}` : ''}
          </span>
        )}
        {(event.latestResult === "queued" || event.latestResult === "scheduled") && (
          <CronCountdown scheduledFor={event.scheduledFor} />
        )}
        {event.isRecurring && <RecurringIcon size={10} />}
        {event.latestResult && event.latestResult !== "scheduled" && event.latestResult !== "queued" && (
          event.latestResult === "running" ? (
            <span className="inline-flex items-center gap-1.5">
              <RunningBadge />
              <LiveDuration startedAt={event.runStartedAt} finishedAt={event.runFinishedAt} prefix="· " className="text-[10px] font-bold tabular-nums text-orange-600 dark:text-orange-400" />
            </span>
          ) : event.latestResult === "needs_retry" ? (
            <NeedsRetryBadge />
          ) : (
            <span
              className="text-[9px] font-bold uppercase tracking-wider leading-none"
              style={{
                color: event.latestResult === "succeeded" ? "#16a34a"
                  : event.latestResult === "failed" ? "#dc2626"
                  : event.latestResult === "cancelled" ? "#71717a"
                  : event.latestResult === "skipped" ? "#ca8a04"
                  : undefined,
                opacity: 0.8,
              }}
            >
              {event.latestResult === "succeeded" ? "✓ Done"
                : event.latestResult === "failed" ? "✗ Failed"
                : event.latestResult === "cancelled" ? "Cancelled"
                : event.latestResult === "skipped" ? "⏭ Skipped"
                : event.latestResult}
              <LiveDuration startedAt={event.runStartedAt} finishedAt={event.runFinishedAt} prefix=" · " className="text-[9px] font-bold tabular-nums" />
            </span>
          )
        )}
      </div>
    </div>
  );
}

// ── Day cell ─────────────────────────────────────────────────────────────────

function DayCell({
  day,
  events,
  isCurrentMonth,
  isToday,
  onEventClick,
  onDayClick,
  onEventDrop,
}: {
  day: Date;
  events: CalendarEvent[];
  isCurrentMonth: boolean;
  isToday: boolean;
  onEventClick: (event: CalendarEvent) => void;
  onDayClick?: (date: Date) => void;
  onEventDrop?: (eventId: string, newDate: string, newTime?: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [showAllDialog, setShowAllDialog] = useState(false);
  const dateStr = format(day, "yyyy-MM-dd");
  const dayEvents = events.filter((e) => e.date === dateStr)
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const visible = dayEvents.slice(0, MAX_VISIBLE);
  const overflow = dayEvents.length - MAX_VISIBLE;
  const hasEvents = dayEvents.length > 0;

  return (
    <>
      <div
        onClick={() => onDayClick?.(day)}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const eventId = e.dataTransfer.getData("text/event-id");
          if (eventId && onEventDrop) onEventDrop(eventId, dateStr);
        }}
        className={[
          "relative flex flex-col gap-1 border-r border-b min-h-[108px] p-1.5",
          "transition-all duration-150",
          "hover:bg-muted/40 cursor-pointer",
          !isCurrentMonth ? "opacity-35" : "",
          dragOver ? "bg-primary/10 ring-2 ring-primary/30 ring-inset" : "",
          isToday ? "bg-primary/5" : hasEvents ? "bg-primary/[0.02]" : "",
        ].join(" ")}
      >
        {/* Date number */}
        <span
          className={[
            "self-start text-[11px] font-bold w-6 h-6",
            "flex items-center justify-center leading-none rounded-full mb-0.5",
            "transition-all duration-150",
            isToday
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-foreground/50 hover:text-foreground",
          ].join(" ")}
        >
          {format(day, "d")}
        </span>

        {/* Event pills */}
        <div className="flex flex-col gap-0.5 flex-1">
          {visible.map((evt) => (
            <div
              key={evt.id}
              draggable
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.setData("text/event-id", evt.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={(e) => { e.stopPropagation(); onEventClick(evt); }}
              className="cursor-grab active:cursor-grabbing"
            >
              <EventPill event={evt} />
            </div>
          ))}
          {overflow > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowAllDialog(true); }}
              className="flex items-center gap-1 text-[10px] font-bold text-primary hover:text-primary/80 bg-primary/8 hover:bg-primary/15 rounded-md px-2 py-1 mt-0.5 transition-all cursor-pointer w-fit"
            >
              <span>+{overflow} more</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* All events dialog for this day */}
      {showAllDialog && (
        <Dialog open={showAllDialog} onOpenChange={setShowAllDialog}>
          <DialogContent className="sm:max-w-[480px] max-h-[80vh] overflow-hidden p-0">
            <DialogHeader className="px-6 pt-5 pb-3">
              <div className="flex items-center gap-3">
                <div className="flex flex-col items-center justify-center select-none">
                  <span className="text-[9px] font-black tracking-[0.15em] text-primary/60 uppercase">
                    {format(day, "MMM").toUpperCase()}
                  </span>
                  <span className="text-[26px] font-black leading-none text-primary tracking-tight">
                    {format(day, "d")}
                  </span>
                </div>
                <div className="h-10 w-px bg-border/60" />
                <div>
                  <DialogTitle className="text-base">{format(day, "EEEE, MMMM d")}</DialogTitle>
                  <DialogDescription className="text-[11px]">
                    {dayEvents.length} event{dayEvents.length !== 1 ? "s" : ""} scheduled
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="overflow-y-auto px-6 pb-5 flex flex-col gap-2 max-h-[60vh]">
              {dayEvents.map((evt) => {
                const resolved = resolveEventColor(evt);
                const resolvedKey = resolveEventColorKey(evt);
                const dotColor = DOT_COLORS[resolvedKey] ?? "#6b7280";
                const timeStr = (() => {
                  if (!evt.time) return null;
                  const [h, m] = evt.time.split(":").map(Number);
                  if (isNaN(h)) return null;
                  const ampm = h >= 12 ? "PM" : "AM";
                  const h12 = h % 12 || 12;
                  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
                })();

                return (
                  <button
                    key={evt.id}
                    onClick={() => { setShowAllDialog(false); onEventClick(evt); }}
                    className="w-full text-left rounded-xl border bg-card hover:bg-muted/40 hover:border-primary/30 transition-all duration-150 p-3 cursor-pointer group"
                  >
                    <div className="flex items-start gap-3">
                      {/* Color indicator */}
                      <div
                        className="w-1 self-stretch rounded-full shrink-0 mt-0.5"
                        style={{ backgroundColor: dotColor }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                            {evt.title}
                          </span>
                          {evt.isRecurring && <RecurringIcon size={11} />}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {timeStr && (
                            <span className="text-[11px] text-muted-foreground font-medium">{timeStr}</span>
                          )}
                          {evt.status === "draft" && (
                            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60 bg-muted px-1.5 py-0.5 rounded">
                              Draft
                            </span>
                          )}
                          {evt.latestResult && evt.latestResult !== "scheduled" && evt.latestResult !== "queued" && (
                            evt.latestResult === "running" ? (
                              <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-orange-500/10">
                                <RunningBadge />
                                <LiveDuration startedAt={evt.runStartedAt} finishedAt={evt.runFinishedAt} prefix="· " className="text-[10px] font-bold tabular-nums text-orange-600 dark:text-orange-400" />
                              </span>
                            ) : evt.latestResult === "needs_retry" ? (
                              <NeedsRetryBadge />
                            ) : (
                              <span
                                className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                                style={{
                                  color: evt.latestResult === "succeeded" ? "#16a34a"
                                    : evt.latestResult === "failed" ? "#dc2626"
                                    : evt.latestResult === "cancelled" ? "#71717a"
                                    : evt.latestResult === "skipped" ? "#ca8a04"
                                    : undefined,
                                  backgroundColor: evt.latestResult === "succeeded" ? "rgba(22,163,74,0.1)"
                                    : evt.latestResult === "failed" ? "rgba(220,38,38,0.1)"
                                    : evt.latestResult === "cancelled" ? "rgba(113,113,122,0.1)"
                                    : evt.latestResult === "skipped" ? "rgba(202,138,4,0.1)"
                                    : undefined,
                                }}
                              >
                                {evt.latestResult === "succeeded" ? "✓ Done"
                                  : evt.latestResult === "failed" ? "✗ Failed"
                                  : evt.latestResult === "cancelled" ? "Cancelled"
                                  : evt.latestResult === "skipped" ? "⏭ Skipped"
                                  : evt.latestResult}
                                <LiveDuration startedAt={evt.runStartedAt} finishedAt={evt.runFinishedAt} prefix=" · " className="text-[9px] font-bold tabular-nums" />
                              </span>
                            )
                          )}
                        </div>
                      </div>
                      {/* Arrow hint */}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-muted-foreground/40 group-hover:text-primary transition-colors mt-1">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ── WeekHourCell ────────────────────────────────────────────────────────────
// One cell in the week grid: a single (day × hour) slot.
// Shows up to MAX_VISIBLE events + "+N more" button that opens a mini-modal.

function WeekHourCell({
  day,
  hour,
  dateStr,
  visible,
  overflow,
  allHourEvts,
  isTodayCol,
  isDragOver,
  nowLineAt,
  onEventClick,
  onEventDrop,
  onDragEnter,
  onDragLeave,
  onDropEvent,
}: {
  day: Date;
  hour: number;
  dateStr: string;
  visible: CalendarEvent[];
  overflow: number;
  allHourEvts: CalendarEvent[];
  isTodayCol: boolean;
  isDragOver: boolean;
  nowLineAt: number | null; // minute offset (0-59) to render now-line, or null
  onEventClick: (evt: CalendarEvent) => void;
  onEventDrop?: (eventId: string, newDate: string, newTime?: string) => void;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDropEvent: (eventId: string) => void;
}) {
  const [showMore, setShowMore] = useState(false);

  return (
    <>
      <div
        className={cn(
          "relative border-b border-l border-dashed border-border/30 p-1 min-h-[60px] flex flex-col gap-1 transition-colors",
          isTodayCol ? "bg-primary/[0.025]" : "",
          isDragOver ? "bg-primary/10" : "",
        )}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragEnter(); }}
        onDragLeave={onDragLeave}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData("text/event-id");
          if (id) onDropEvent(id);
        }}
      >
        {/* Now line — 1px, full width, spans all day columns */}
        {nowLineAt !== null && (
          <div
            className="absolute left-0 right-0 h-px bg-primary pointer-events-none z-[1]"
            style={{ top: `${(nowLineAt / 60) * 100}%` }}
          />
        )}
        {visible.map((evt) => (
          <div
            key={evt.id}
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              e.dataTransfer.setData("text/event-id", evt.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onClick={(e) => { e.stopPropagation(); onEventClick(evt); }}
            className="cursor-grab active:cursor-grabbing"
          >
            <TimeGridEventBlock event={evt} />
          </div>
        ))}
        {overflow > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowMore(true); }}
            className="flex items-center gap-1 text-[10px] font-bold text-primary hover:text-primary/80 bg-primary/8 hover:bg-primary/15 rounded-md px-2 py-1 transition-all cursor-pointer w-fit"
          >
            +{overflow} more
          </button>
        )}
      </div>

      {/* Overflow modal — shows all events for this hour slot */}
      {showMore && (
        <Dialog open={showMore} onOpenChange={setShowMore}>
          <DialogContent className="sm:max-w-[480px] max-h-[80vh] overflow-hidden p-0">
            <DialogHeader className="px-6 pt-5 pb-3">
              <div className="flex items-center gap-3">
                <div className="flex flex-col items-center justify-center select-none">
                  <span className="text-[9px] font-black tracking-[0.15em] text-primary/60 uppercase">
                    {format(day, "MMM").toUpperCase()}
                  </span>
                  <span className="text-[26px] font-black leading-none text-primary tracking-tight">
                    {format(day, "d")}
                  </span>
                </div>
                <div className="h-10 w-px bg-border/60" />
                <div>
                  <DialogTitle className="text-base">
                    {format(day, "EEEE, MMMM d")} · {String(hour).padStart(2, "0")}:00
                  </DialogTitle>
                  <DialogDescription className="text-[11px]">
                    {allHourEvts.length} event{allHourEvts.length !== 1 ? "s" : ""} at this hour
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="overflow-y-auto px-4 pb-5 flex flex-col gap-2 max-h-[60vh]">
              {allHourEvts.map((evt) => {
                const resolved = resolveEventColor(evt);
                const resolvedKey = resolveEventColorKey(evt);
                const dotColor = DOT_COLORS[resolvedKey] ?? "#6b7280";
                const timeStr = (() => {
                  if (!evt.time) return null;
                  const [h, m] = evt.time.split(":").map(Number);
                  if (isNaN(h)) return null;
                  const ampm = h >= 12 ? "PM" : "AM";
                  const h12 = h % 12 || 12;
                  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
                })();
                return (
                  <button
                    key={evt.id}
                    onClick={() => { setShowMore(false); onEventClick(evt); }}
                    className="w-full text-left rounded-xl border bg-card hover:bg-muted/40 hover:border-primary/30 transition-all duration-150 p-3 cursor-pointer group"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-1 self-stretch rounded-full shrink-0 mt-0.5" style={{ backgroundColor: dotColor }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{evt.title}</span>
                          {evt.isRecurring && <RecurringIcon size={11} />}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {timeStr && <span className="text-[11px] text-muted-foreground font-medium">{timeStr}</span>}
                          {evt.latestResult && evt.latestResult !== "scheduled" && evt.latestResult !== "queued" && (
                            evt.latestResult === "running" ? (
                              <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-orange-500/10">
                                <RunningBadge />
                                <LiveDuration startedAt={evt.runStartedAt} finishedAt={evt.runFinishedAt} prefix="· " className="text-[10px] font-bold tabular-nums text-orange-600 dark:text-orange-400" />
                              </span>
                            ) : evt.latestResult === "needs_retry" ? (
                              <NeedsRetryBadge />
                            ) : (
                              <span
                                className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                                style={{
                                  color: evt.latestResult === "succeeded" ? "#16a34a" : evt.latestResult === "failed" ? "#dc2626" : evt.latestResult === "cancelled" ? "#71717a" : evt.latestResult === "skipped" ? "#ca8a04" : undefined,
                                  backgroundColor: evt.latestResult === "succeeded" ? "rgba(22,163,74,0.1)" : evt.latestResult === "failed" ? "rgba(220,38,38,0.1)" : evt.latestResult === "cancelled" ? "rgba(113,113,122,0.1)" : evt.latestResult === "skipped" ? "rgba(202,138,4,0.1)" : undefined,
                                }}
                              >
                                {evt.latestResult === "succeeded" ? "✓ Done" : evt.latestResult === "failed" ? "✗ Failed" : evt.latestResult === "cancelled" ? "Cancelled" : evt.latestResult === "skipped" ? "⏭ Skipped" : evt.latestResult}
                              </span>
                            )
                          )}
                        </div>
                      </div>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-muted-foreground/40 group-hover:text-primary transition-colors mt-1"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                    </div>
                  </button>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ── Week view ─────────────────────────────────────────────────────────────────

function WeekView({
  weekDays,
  events,
  onEventClick,
  onEventDrop,
  className,
}: {
  weekDays: Date[];
  events: CalendarEvent[];
  onEventClick: (evt: CalendarEvent) => void;
  onEventDrop?: (eventId: string, newDate: string, newTime?: string) => void;
  className?: string;
}) {
  const now = useNow(60_000);
  const nowHour = now.getHours();
  const nowMinute = now.getMinutes();
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll so the current hour is visible on mount
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const currentHour = new Date().getHours();
    // Each hour row is min 60px; scroll to 1h before now
    const scrollToHour = Math.max(0, currentHour - 1);
    container.scrollTop = scrollToHour * 60;
  }, []);

  return (
    <div ref={scrollContainerRef} className={`overflow-x-auto overflow-y-auto min-h-0 h-full ${className ?? ""}`}>
      <div className="min-w-[720px]">
        {/* Day header row */}
        <div className="grid grid-cols-8 border-b bg-muted/40 sticky top-0 z-10">
          <div className="w-12" />
          {weekDays.map((day) => (
            <div
              key={day.toISOString()}
              className={[
                "flex flex-col items-center py-2.5 border-l",
                isToday(day) ? "bg-primary/6" : "",
              ].join(" ")}
            >
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                {format(day, "EEE")}
              </span>
              <span
                className={[
                  "text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full leading-none mt-1",
                  isToday(day)
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-foreground/70",
                ].join(" ")}
              >
                {format(day, "d")}
              </span>
            </div>
          ))}
        </div>

        {/* Time + content grid — one row per hour, height auto-expands to content */}
        <div className="grid grid-cols-8">
          {HOURS.map((h) => (
            <React.Fragment key={h}>
              {/* Hour gutter label */}
              <div
                key={`gutter-${h}`}
                className="relative border-b border-r border-dashed border-border/30 flex items-start justify-end pr-2 pt-1 min-h-[60px]"
              >
                <span className="text-[10px] text-muted-foreground/50 font-semibold tabular-nums">
                  {String(h).padStart(2, "0")}:00
                </span>
                {/* Now dot on gutter — sits on the line, right-aligned to connect with day columns */}
                {h === nowHour && (
                  <div
                    className="absolute right-0 translate-x-[5px] -translate-y-[5px] pointer-events-none z-[1]"
                    style={{ top: `${(nowMinute / 60) * 100}%` }}
                  >
                    <div className="size-[9px] rounded-full bg-primary" style={{ boxShadow: "0 0 6px hsl(var(--primary) / 0.6)" }} />
                  </div>
                )}
              </div>

              {/* One cell per day for this hour */}
              {weekDays.map((day) => {
                const dateStr = format(day, "yyyy-MM-dd");
                const cellKey = `${dateStr}-${h}`;
                const hourEvts = events
                  .filter((e) => e.date === dateStr && !!e.time)
                  .filter((e) => Number(e.time!.split(":")[0]) === h)
                  .sort((a, b) => Number(a.time!.split(":")[1] ?? 0) - Number(b.time!.split(":")[1] ?? 0));

                const visible = hourEvts.slice(0, MAX_VISIBLE);
                const overflow = hourEvts.length - MAX_VISIBLE;

                return (
                  <WeekHourCell
                    key={cellKey}
                    day={day}
                    hour={h}
                    dateStr={dateStr}
                    visible={visible}
                    overflow={overflow}
                    allHourEvts={hourEvts}
                    isTodayCol={isToday(day)}
                    isDragOver={dragOverCell === cellKey}
                    nowLineAt={h === nowHour ? nowMinute : null}
                    onEventClick={onEventClick}
                    onEventDrop={onEventDrop}
                    onDragEnter={() => setDragOverCell(cellKey)}
                    onDragLeave={() => setDragOverCell((p) => p === cellKey ? null : p)}
                    onDropEvent={(eventId) => {
                      setDragOverCell(null);
                      if (onEventDrop) onEventDrop(eventId, dateStr, `${String(h).padStart(2, "0")}:00`);
                    }}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Day view ─────────────────────────────────────────────────────────────────

function DayView({
  day,
  events,
  onEventClick,
  onEventDrop,
  className,
}: {
  day: Date;
  events: CalendarEvent[];
  onEventClick: (evt: CalendarEvent) => void;
  onEventDrop?: (eventId: string, newDate: string, newTime?: string) => void;
  className?: string;
}) {
  const now = useNow();
  const dayStr = format(day, "yyyy-MM-dd");
  const dayEvts = events.filter((e) => e.date === dayStr);
  const showNowLine = isToday(day);
  const [dragOverHour, setDragOverHour] = useState<number | null>(null);
  const dayScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to current time on mount
  useEffect(() => {
    const container = dayScrollRef.current;
    if (!container) return;
    const scrollToHour = Math.max(0, now.getHours() - 1);
    container.scrollTop = scrollToHour * HOUR_HEIGHT;
  }, []);

  return (
    <div ref={dayScrollRef} className={`overflow-x-auto overflow-y-auto min-h-0 h-full ${className ?? ""}`}>
      <div className="min-w-[520px]">
        {/* Day header */}
        <div className="flex flex-col items-center py-4 border-b bg-muted/40">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
            {format(day, "EEEE")}
          </span>
          <span
            className={[
              "text-3xl font-bold w-12 h-12 flex items-center justify-center rounded-full leading-none mt-1",
              isToday(day)
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-foreground",
            ].join(" ")}
          >
            {format(day, "d")}
          </span>
        </div>

        {/* Time grid */}
        <div className="relative">
          {showNowLine && (
            <NowIndicator now={now} hourHeight={HOUR_HEIGHT} leftOffset={64} />
          )}
          {HOURS.map((h) => {
            const hourEvts = dayEvts.filter((e) => {
              if (!e.time) return false;
              const [eh] = e.time.split(":").map(Number);
              return eh === h;
            });
            return (
              <div
                key={h}
                className={[
                  "flex border-b border-dashed border-border/30 min-h-[60px] transition-colors",
                  dragOverHour === h ? "bg-primary/10" : "",
                ].join(" ")}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverHour(h);
                }}
                onDragLeave={() => setDragOverHour((prev) => prev === h ? null : prev)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverHour(null);
                  const eventId = e.dataTransfer.getData("text/event-id");
                  if (!eventId || !onEventDrop) return;
                  const timeStr = `${String(h).padStart(2, "0")}:00`;
                  onEventDrop(eventId, dayStr, timeStr);
                }}
              >
                <div className="w-16 shrink-0 flex items-start justify-end pr-2 pt-1">
                  <span className="text-[10px] text-muted-foreground/50 font-semibold tabular-nums">
                    {String(h).padStart(2, "0")}:00
                  </span>
                </div>
                <div className="flex-1 py-1.5 pr-1.5 relative">
                  {hourEvts.map((evt) => (
                    <div
                      key={evt.id}
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        e.dataTransfer.setData("text/event-id", evt.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onClick={() => onEventClick(evt)}
                      className="mb-1.5 cursor-grab active:cursor-grabbing"
                    >
                      <TimeGridEventBlock event={evt} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = {
  events: AgendaCalendarEvent[];
  loading?: boolean;
  viewMode: ViewMode;
  currentDate: Date;
  onViewModeChange: (v: ViewMode) => void;
  onDateChange: (d: Date) => void;
  onEventClick: (eventId: string, occurrenceDate?: string) => void;
  onDayClick?: (date: Date) => void;
  onEventDrop?: (eventId: string, newDate: string, newTime?: string) => void;
  onAddEvent?: () => void;
  failedCount?: number;
  onOpenFailed?: () => void;
};

export function CustomMonthAgenda({
  events,
  loading,
  viewMode,
  currentDate,
  onViewModeChange,
  onDateChange,
  onEventClick,
  onDayClick,
  onEventDrop,
  onAddEvent,
  failedCount,
  onOpenFailed,
}: Props) {
  const [showStatusLegend, setShowStatusLegend] = useState(false);
  // ── Convert events ─────────────────────────────────────────────────────────
  const calendarEvents: CalendarEvent[] = useMemo(() => {
    return events.map((e) => {
      const start = e.start ? new Date(e.start) : new Date();
      const props = (e.extendedProps ?? {}) as Record<string, unknown>;
      const tz = (props.timezone as string) || undefined;

      // Format date/time in the event's own timezone, not browser local
      let dateStr: string;
      let timeStr: string | undefined;
      if (tz) {
        try {
          const fmt = new Intl.DateTimeFormat("en-CA", {
            timeZone: tz,
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", hour12: false,
          });
          const parts = fmt.formatToParts(start);
          const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
          dateStr = `${get("year")}-${get("month")}-${get("day")}`;
          timeStr = e.allDay ? undefined : `${get("hour")}:${get("minute")}`;
        } catch {
          dateStr = format(start, "yyyy-MM-dd");
          timeStr = e.allDay ? undefined : format(start, "HH:mm");
        }
      } else {
        dateStr = format(start, "yyyy-MM-dd");
        timeStr = e.allDay ? undefined : format(start, "HH:mm");
      }

      return {
        id: e.id,
        title: e.title,
        date: dateStr,
        time: timeStr,
        color: (props.color as EventColor) ?? "default",
        isRecurring: !!props.recurrence && (props.recurrence as string) !== "none",
        status: (props.status as "draft" | "active") ?? "active",
        latestResult: (props.latestResult as CalendarEvent["latestResult"]) ?? null,
        runStartedAt: (props.runStartedAt as string) ?? null,
        runFinishedAt: (props.runFinishedAt as string) ?? null,
        timezone: tz,
        scheduledFor: (props.scheduledFor as string) ?? (e.start ?? null),
      };
    });
  }, [events]);

  // ── Navigation ─────────────────────────────────────────────────────────────
  const handlePrev = useCallback(() => {
    if (viewMode === "month") onDateChange(subMonths(currentDate, 1));
    else if (viewMode === "week") onDateChange(subWeeks(currentDate, 1));
    else onDateChange(subDays(currentDate, 1));
  }, [viewMode, currentDate, onDateChange]);

  const handleNext = useCallback(() => {
    if (viewMode === "month") onDateChange(addMonths(currentDate, 1));
    else if (viewMode === "week") onDateChange(addWeeks(currentDate, 1));
    else onDateChange(addDays(currentDate, 1));
  }, [viewMode, currentDate, onDateChange]);

  const handleToday = useCallback(() => onDateChange(new Date()), [onDateChange]);

  // ── Month grid ─────────────────────────────────────────────────────────────
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const gridDays = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const weeks = useMemo(() => {
    const result: Date[][] = [];
    for (let i = 0; i < gridDays.length; i += 7) result.push(gridDays.slice(i, i + 7));
    return result;
  }, [gridDays]);

  const weekDays = useMemo(() => {
    return eachDayOfInterval({
      start: startOfWeek(currentDate, { weekStartsOn: 1 }),
      end: endOfWeek(currentDate, { weekStartsOn: 1 }),
    });
  }, [currentDate]);

  // ── Display text (client-only to avoid SSR hydration mismatch on TZ/midnight) ─
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const badgeMonth = mounted ? format(currentDate, "MMM").toUpperCase() : "";
  const badgeDay = mounted ? format(currentDate, "d") : "";

  const titleText = mounted
    ? viewMode === "week"
      ? `${format(weekDays[0], "MMM d")} – ${format(weekDays[6], "MMM d, yyyy")}`
      : viewMode === "day"
        ? format(currentDate, "EEEE, MMMM d, yyyy")
        : format(currentDate, "MMMM yyyy")
    : "";

  const rangeText = mounted
    ? viewMode === "week"
      ? `${format(weekDays[0], "MMM d")} – ${format(weekDays[6], "MMM d, yyyy")}`
      : viewMode === "day"
        ? format(currentDate, "EEEE, MMMM d, yyyy")
        : `${format(monthStart, "MMM d, yyyy")} — ${format(monthEnd, "MMM d, yyyy")}`
    : "";

  const handleEventClick = useCallback(
    (evt: CalendarEvent) => onEventClick(evt.id, evt.date),
    [onEventClick]
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      {/* ── Header bar ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Left: badge + title */}
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center justify-center select-none">
            <span className="text-[10px] font-black tracking-[0.15em] text-primary/60 uppercase">
              {badgeMonth}
            </span>
            <span className="text-[28px] font-black leading-none text-primary tracking-tight">
              {badgeDay}
            </span>
          </div>

          <div className="h-10 w-px bg-border/60" />

          <div className="flex flex-col gap-0.5">
            <h2 className="text-[17px] font-bold tracking-tight text-foreground">
              {titleText}
            </h2>
            <p className="text-[11px] text-muted-foreground/70">{rangeText}</p>
          </div>
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 rounded-lg cursor-pointer"
            onClick={handlePrev}
          >
            <IconChevronLeft className="size-4" />
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3.5 rounded-lg text-[13px] font-semibold cursor-pointer"
            onClick={handleToday}
          >
            Today
          </Button>

          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 rounded-lg cursor-pointer"
            onClick={handleNext}
          >
            <IconChevronRight className="size-4" />
          </Button>

          <Select value={viewMode} onValueChange={(v) => onViewModeChange(v as ViewMode)}>
            <SelectTrigger className="h-9 w-[132px] rounded-lg text-[13px] font-medium cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Month</SelectItem>
              <SelectItem value="week">Week</SelectItem>
              <SelectItem value="day">Day</SelectItem>
            </SelectContent>
          </Select>

          <div className="w-px h-7 bg-border/60 mx-1" />

          {(failedCount ?? 0) > 0 && (
            <Button
              size="sm"
              variant="destructive"
              className="h-9 px-4 rounded-lg text-[13px] font-semibold cursor-pointer gap-1.5"
              onClick={onOpenFailed}
            >
              <IconChevronLeft className="size-0 hidden" />{/* spacer for import */}
              ⚠️ Failed Events
              <span className="bg-white/20 text-white text-[11px] font-bold px-1.5 py-0.5 rounded-md ml-0.5">
                {failedCount}
              </span>
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 rounded-lg cursor-pointer"
            onClick={() => setShowStatusLegend(true)}
            title="Event status legend"
          >
            <IconInfoCircle className="size-[18px]" />
          </Button>

          <Button
            size="sm"
            className="h-9 px-4 rounded-lg text-[13px] font-semibold cursor-pointer"
            onClick={onAddEvent}
          >
            + Add event
          </Button>
        </div>
      </div>

      {/* ── Calendar card ───────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card overflow-hidden shadow-sm flex-1 min-h-0 flex flex-col">
        {/* Weekday header — month view only */}
        {viewMode === "month" && (
          <div className="grid grid-cols-7 border-b bg-muted/30">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className="py-2.5 text-center text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 border-r last:border-r-0"
              >
                {day}
              </div>
            ))}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="grid grid-cols-7 flex-1 min-h-0 overflow-auto">
            {Array.from({ length: 35 }).map((_, i) => (
              <div
                key={i}
                className="min-h-[108px] border-r border-b p-1.5 animate-pulse"
              >
                <div className="h-4 w-4 bg-muted rounded-full mb-2" />
                <div className="space-y-1">
                  <div className="h-4 bg-muted rounded" />
                  <div className="h-4 bg-muted rounded w-3/4" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Month view */}
        {!loading && viewMode === "month" && (
          <div className="flex flex-col flex-1 min-h-0 overflow-auto">
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7">
                {week.map((day, di) => (
                  <DayCell
                    key={di}
                    day={day}
                    events={calendarEvents}
                    isCurrentMonth={isSameMonth(day, currentDate)}
                    isToday={isToday(day)}
                    onEventClick={handleEventClick}
                    onDayClick={onDayClick}
                    onEventDrop={onEventDrop}
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Week view */}
        {!loading && viewMode === "week" && (
          <div className="flex-1 min-h-0">
            <WeekView
              className="h-full"
              weekDays={weekDays}
              events={calendarEvents}
              onEventClick={handleEventClick}
              onEventDrop={onEventDrop}
            />
          </div>
        )}

        {/* Day view */}
        {!loading && viewMode === "day" && (
          <div className="flex-1 min-h-0">
            <DayView
              className="h-full"
              day={currentDate}
              events={calendarEvents}
              onEventClick={handleEventClick}
              onEventDrop={onEventDrop}
            />
          </div>
        )}
      </div>

      <Dialog open={showStatusLegend} onOpenChange={setShowStatusLegend}>
        <DialogContent className="sm:max-w-[440px] p-0 gap-0 overflow-hidden">
          <div className="px-5 pt-5 pb-3">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-base font-semibold">Status Guide</DialogTitle>
              <DialogDescription className="text-xs">
                What each indicator means on the calendar.
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="px-5 pb-5 flex flex-col gap-4">

            {/* Lifecycle group */}
            <div className="flex flex-col gap-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-1 mb-1.5">
                Lifecycle
              </p>
              {(["scheduled", "queued", "running", "auto_retry", "stale_recovery", "succeeded"] as const).map((key) => {
                const item = STATUS_GUIDE_ENTRIES.find((e) => e.key === key);
                if (!item) return null;
                const dotColor = DOT_COLORS[item.colorKey];
                return (
                  <div
                    key={item.key}
                    className={`flex items-center gap-3 rounded-md px-3 py-2.5 ring-1 ring-inset ${item.bg} ${item.ring}`}
                  >
                    {/* Colored dot */}
                    <div
                      className={`shrink-0 rounded-full w-2.5 h-2.5 ${item.animated ? "animate-pulse" : ""}`}
                      style={{ backgroundColor: dotColor, boxShadow: `0 0 4px ${dotColor}60` }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <StatusGuideLabel statusKey={item.key} label={item.label} />
                      </div>
                      <p className="text-[11px] leading-snug text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Action needed group */}
            <div className="flex flex-col gap-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-1 mb-1.5">
                Action Needed
              </p>
              {(["needs_retry", "failed"] as const).map((key) => {
                const item = STATUS_GUIDE_ENTRIES.find((e) => e.key === key);
                if (!item) return null;
                const dotColor = DOT_COLORS[item.colorKey];
                return (
                  <div
                    key={item.key}
                    className={`flex items-center gap-3 rounded-md px-3 py-2.5 ring-1 ring-inset ${item.bg} ${item.ring}`}
                  >
                    <div
                      className="shrink-0 rounded-full w-2.5 h-2.5"
                      style={{ backgroundColor: dotColor, boxShadow: `0 0 4px ${dotColor}60` }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <StatusGuideLabel statusKey={item.key} label={item.label} />
                      </div>
                      <p className="text-[11px] leading-snug text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Inactive group */}
            <div className="flex flex-col gap-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-1 mb-1.5">
                Inactive
              </p>
              {(["cancelled", "skipped", "draft"] as const).map((key) => {
                const item = STATUS_GUIDE_ENTRIES.find((e) => e.key === key);
                if (!item) return null;
                const dotColor = DOT_COLORS[item.colorKey];
                return (
                  <div
                    key={item.key}
                    className={`flex items-center gap-3 rounded-md px-3 py-2.5 ring-1 ring-inset ${item.bg} ${item.ring} opacity-60`}
                  >
                    <div
                      className="shrink-0 rounded-full w-2.5 h-2.5"
                      style={{ backgroundColor: dotColor, boxShadow: `0 0 4px ${dotColor}40` }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <StatusGuideLabel statusKey={item.key} label={item.label} />
                      </div>
                      <p className="text-[11px] leading-snug text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>

          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
