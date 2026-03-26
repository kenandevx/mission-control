"use client";

import { useState, useCallback, useMemo } from "react";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isToday,
  addMonths, subMonths, addWeeks, subWeeks, addDays, subDays,
  format,
} from "date-fns";
import { Button } from "@/components/ui/button";
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
} from "@tabler/icons-react";
import type { AgendaEventSummary } from "@/components/agenda/agenda-details-sheet";

// ── Types ────────────────────────────────────────────────────────────────────

export type CalendarEvent = {
  id: string;
  title: string;
  date: string; // "yyyy-MM-dd"
  time?: string; // "HH:mm"
  color?: EventColor;
  isRecurring?: boolean;
  status?: "draft" | "active";
};

export type EventColor = "blue" | "green" | "orange" | "pink" | "purple" | "gray" | "default";

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

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_VISIBLE = 4;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

// ── Color palette — matches JSONC AgendaEventItem spec ──────────────────────────

const EVENT_COLORS: Record<EventColor, { bg: string; text: string; border: string }> = {
  blue:    { bg: "#e8f1ff", text: "#3b82f6", border: "#bfdbfe" },
  green:   { bg: "#eaf8ef", text: "#16a34a", border: "#bbf7d0" },
  orange:  { bg: "#fff3e8", text: "#ea580c", border: "#fed7aa" },
  pink:    { bg: "#fdecf3", text: "#ec4899", border: "#fbcfe8" },
  purple:  { bg: "#f3e8ff", text: "#8b5cf6", border: "#ddd6fe" },
  gray:    { bg: "#f3f4f6", text: "#6b7280", border: "#d1d5db" },
  default: { bg: "hsl(var(--secondary))", text: "hsl(var(--secondary-foreground))", border: "hsl(var(--border))" },
};

const DOT_COLORS: Record<EventColor, string> = {
  blue:    "#3b82f6",
  green:   "#16a34a",
  orange:  "#ea580c",
  pink:    "#ec4899",
  purple:  "#8b5cf6",
  gray:    "#9ca3af",
  default: "hsl(var(--muted-foreground))",
};

// ── Auto-color from event ID ────────────────────────────────────────────────
const ACTIVE_COLORS: EventColor[] = ["blue", "green", "orange", "pink", "purple"];
function hashColor(id: string): EventColor {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return ACTIVE_COLORS[Math.abs(hash) % ACTIVE_COLORS.length];
}

function resolveEventColor(event: CalendarEvent) {
  if (event.status === "draft") return EVENT_COLORS.gray;
  if (event.color && event.color !== "default" && EVENT_COLORS[event.color]) return EVENT_COLORS[event.color];
  // Auto-assign a color based on event ID
  const autoColor = hashColor(event.id);
  return EVENT_COLORS[autoColor];
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
  const resolvedKey = event.status === "draft" ? "gray" : (event.color && event.color !== "default" ? event.color : hashColor(event.id));
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
      className="flex items-center justify-between gap-1.5 h-[26px] px-[8px] rounded-md overflow-hidden w-full transition-all duration-150 hover:scale-[1.02] hover:shadow-sm"
      style={{
        backgroundColor: bg,
        borderLeft: `3px solid ${dotColor}`,
        opacity: isDraft ? 0.65 : 1,
        borderStyle: isDraft ? "dashed" : "solid",
      }}
    >
      {/* Left dot */}
      <span
        className="size-1.5 rounded-full shrink-0"
        style={{ backgroundColor: dotColor }}
      />

      {/* Title — fills remaining space */}
      <span
        className="flex-1 text-[12px] font-medium leading-none truncate"
        style={{ color, letterSpacing: "-0.01em" }}
      >
        {event.title}
      </span>

      {/* Time — right aligned */}
      {timeStr && (
        <span
          className="shrink-0 text-[11px] font-medium leading-none"
          style={{ color, opacity: 0.8 }}
        >
          {timeStr}
        </span>
      )}
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
  onEventDrop?: (eventId: string, newDate: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const dateStr = format(day, "yyyy-MM-dd");
  const dayEvents = events.filter((e) => e.date === dateStr);
  const visible = dayEvents.slice(0, MAX_VISIBLE);
  const overflow = dayEvents.length - MAX_VISIBLE;
  const hasEvents = dayEvents.length > 0;

  return (
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
          <span className="text-[9px] font-semibold text-primary/70 pl-0.5 pt-0.5">
            +{overflow} more
          </span>
        )}
      </div>
    </div>
  );
}

// ── Week view ─────────────────────────────────────────────────────────────────

function WeekView({
  weekDays,
  events,
  onEventClick,
}: {
  weekDays: Date[];
  events: CalendarEvent[];
  onEventClick: (evt: CalendarEvent) => void;
}) {
  return (
    <div className="overflow-x-auto">
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

        {/* Time + content grid */}
        <div className="grid grid-cols-8 relative">
          {/* Hour gutter */}
          <div className="flex flex-col">
            {HOURS.map((h) => (
              <div
                key={h}
                className="h-12 border-b border-dashed border-border/30 flex items-start justify-end pr-2 pt-1"
              >
                <span className="text-[10px] text-muted-foreground/50 font-semibold tabular-nums">
                  {String(h).padStart(2, "0")}:00
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {weekDays.map((day) => {
            const dateStr = format(day, "yyyy-MM-dd");
            const dayEvts = events.filter((e) => e.date === dateStr);
            return (
              <div
                key={day.toISOString()}
                className={[
                  "relative border-l",
                  isToday(day) ? "bg-primary/[0.025]" : "",
                ].join(" ")}
              >
                {HOURS.map((h) => (
                  <div key={h} className="h-12 border-b border-dashed border-border/30" />
                ))}
                {dayEvts.map((evt) => {
                  if (!evt.time) return null;
                  const [hour, minute] = evt.time.split(":").map(Number);
                  const top = (hour + minute / 60) * 48;
                  return (
                    <div
                      key={evt.id}
                      onClick={(e) => { e.stopPropagation(); onEventClick(evt); }}
                      className="absolute left-0.5 right-0.5 z-[5]"
                      style={{ top: `${top}px` }}
                    >
                      <EventPill event={evt} />
                    </div>
                  );
                })}
              </div>
            );
          })}
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
}: {
  day: Date;
  events: CalendarEvent[];
  onEventClick: (evt: CalendarEvent) => void;
}) {
  const dayStr = format(day, "yyyy-MM-dd");
  const dayEvts = events.filter((e) => e.date === dayStr);

  return (
    <div className="overflow-x-auto">
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
          {HOURS.map((h) => {
            const hourEvts = dayEvts.filter((e) => {
              if (!e.time) return false;
              const [eh] = e.time.split(":").map(Number);
              return eh === h;
            });
            return (
              <div
                key={h}
                className="flex border-b border-dashed border-border/30 min-h-[60px]"
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
                      onClick={() => onEventClick(evt)}
                      className="mb-1 cursor-pointer"
                    >
                      <EventPill event={evt} />
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
  onEventClick: (eventId: string) => void;
  onDayClick?: (date: Date) => void;
  onEventDrop?: (eventId: string, newDate: string) => void;
  onAddEvent?: () => void;
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
}: Props) {
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

  // ── Display text ───────────────────────────────────────────────────────────
  const badgeMonth = format(currentDate, "MMM").toUpperCase();
  const badgeDay = format(currentDate, "d");

  const titleText = viewMode === "week"
    ? `${format(weekDays[0], "MMM d")} – ${format(weekDays[6], "MMM d, yyyy")}`
    : viewMode === "day"
      ? format(currentDate, "EEEE, MMMM d, yyyy")
      : format(currentDate, "MMMM yyyy");

  const rangeText = viewMode === "week"
    ? `${format(weekDays[0], "MMM d")} – ${format(weekDays[6], "MMM d, yyyy")}`
    : viewMode === "day"
      ? format(currentDate, "EEEE, MMMM d, yyyy")
      : `${format(monthStart, "MMM d, yyyy")} — ${format(monthEnd, "MMM d, yyyy")}`;

  const handleEventClick = useCallback(
    (evt: CalendarEvent) => onEventClick(evt.id),
    [onEventClick]
  );

  return (
    <div className="flex flex-col gap-4">
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
      <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
        {/* Weekday header — month & week view */}
        {viewMode !== "day" && (
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
          <div className="grid grid-cols-7">
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
          <div className="flex flex-col">
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
          <div className="p-3">
            <WeekView
              weekDays={weekDays}
              events={calendarEvents}
              onEventClick={handleEventClick}
            />
          </div>
        )}

        {/* Day view */}
        {!loading && viewMode === "day" && (
          <div className="p-3">
            <DayView
              day={currentDate}
              events={calendarEvents}
              onEventClick={handleEventClick}
            />
          </div>
        )}
      </div>
    </div>
  );
}
