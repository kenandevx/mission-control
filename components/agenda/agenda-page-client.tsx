"use client";

import { useCallback, useEffect, useState } from "react";
import { format, endOfMonth } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { AgendaDetailsSheet, type AgendaEventSummary } from "@/components/agenda/agenda-details-sheet";
import { CustomMonthAgenda, type AgendaCalendarEvent, type ViewMode } from "@/components/agenda/custom-month-agenda";
import { useAgenda } from "@/hooks/use-agenda";

type Props = {
  onEditEvent?: (event: AgendaEventSummary) => void;
  onDeleteEvent?: (eventId: string) => void;
  onAddEvent?: () => void;
  onDayClick?: (date: Date) => void;
  onEventDrop?: (eventId: string, newDate: string) => void;
  agentsForDetails?: { id: string; name: string }[];
};

export function AgendaPageClient({ onEditEvent, onDeleteEvent, onAddEvent, onDayClick, onEventDrop, agentsForDetails }: Props) {
  const { calendarEvents, loading, loadEvents } = useAgenda();
  const [detailsSheetOpen, setDetailsSheetOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<AgendaEventSummary | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());

  // Re-fetch when month changes
  useEffect(() => {
    const start = format(currentDate, "yyyy-MM-dd");
    const end = format(endOfMonth(currentDate), "yyyy-MM-dd");
    void loadEvents(start, end);
  }, [currentDate, loadEvents]);

  // External refresh events (after create/edit/delete)
  useEffect(() => {
    const handler = () => { void loadEvents(); };
    document.addEventListener("agenda-refresh", handler);
    return () => document.removeEventListener("agenda-refresh", handler);
  }, [loadEvents]);

  // Convert FullCalendar EventInput[] → AgendaCalendarEvent[]
  const eventsForCalendar: AgendaCalendarEvent[] = calendarEvents.map((e) => {
    const evt = e as AgendaCalendarEvent & {
      id?: string;
      title?: string;
      start?: string;
      end?: string;
      allDay?: boolean;
      backgroundColor?: string;
      extendedProps?: Record<string, unknown>;
    };
    return {
      id: String(evt.id ?? ""),
      title: String(evt.title ?? ""),
      start: String(evt.start ?? ""),
      end: evt.end ? String(evt.end) : "",
      allDay: evt.allDay ?? false,
      backgroundColor: evt.backgroundColor,
      extendedProps: evt.extendedProps ?? {},
    };
  });

  // Use a unique key to force full remount of the details sheet on each open
  const [sheetKey, setSheetKey] = useState(0);

  const handleEventClick = useCallback(
    async (eventId: string) => {
      // Close any existing sheet first to force remount
      setDetailsSheetOpen(false);
      setSelectedEvent(null);

      try {
        const res = await fetch(`/api/agenda/events/${eventId}`, { cache: "reload" });
        const json = await res.json();
        if (!json.ok) return;

        const evt = json.event as {
          id: string;
          title: string;
          free_prompt: string | null;
          default_agent_id: string | null;
          timezone: string;
          starts_at: string;
          ends_at: string | null;
          recurrence_rule: string | null;
          status: "draft" | "active";
        };
        const evtProcesses = (json.processes ?? []) as Array<{ process_name: string; process_version_id?: string }>;
        const evtOccurrences = (json.occurrences ?? []) as Array<{ id: string; scheduled_for: string }>;

        const timezone = evt.timezone ?? "Europe/Amsterdam";
        const rawRecurrence = evt.recurrence_rule ?? "none";
        const recurrenceInfo = parseRecurrenceRule(rawRecurrence);

        const { date: startDate, time: startTime } = extractDateTimeFields(evt.starts_at, timezone);
        const { date: endDate, time: endTime } = extractDateTimeFields(evt.ends_at, timezone);

        let occurrenceId: string | undefined;
        if (rawRecurrence !== "none" && evtOccurrences.length > 0) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const matching = evtOccurrences
            .filter((o) => new Date(o.scheduled_for) >= today)
            .sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());
          occurrenceId = matching[0]?.id;
        }

        const summary: AgendaEventSummary = {
          id: String(evt.id ?? ""),
          title: String(evt.title ?? ""),
          freePrompt: evt.free_prompt ?? "",
          agentId: evt.default_agent_id ?? "",
          agentName: "",
          processIds: evtProcesses.map((p) => p.process_version_id ?? "").filter(Boolean),
          processNames: evtProcesses.map((p) => p.process_name),
          status: evt.status ?? "draft",
          startDate,
          startTime,
          endDate,
          endTime,
          timezone,
          recurrence: recurrenceInfo.type,
          recurrenceRule: rawRecurrence !== "none" ? rawRecurrence : null,
          nextRuns: [],
          latestResult: null,
          occurrenceId,
          modelOverride: (evt as Record<string, unknown>).model_override as string ?? "",
        };

        setSelectedEvent(summary);
        setSheetKey((k) => k + 1);
        setDetailsSheetOpen(true);
      } catch {
        // ignore fetch errors
      }
    },
    []
  );

  const handleRetry = useCallback(
    async (occurrenceId: string) => {
      if (!selectedEvent) return;
      try {
        const res = await fetch(
          `/api/agenda/events/${selectedEvent.id}/occurrences/${occurrenceId}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
        );
        const json = await res.json();
        if (json.ok) {
          setDetailsSheetOpen(false);
          void loadEvents();
        }
      } catch {
        // ignore
      }
    },
    [selectedEvent, loadEvents]
  );

  return (
    <>
      <Card className="flex-1 overflow-hidden border-2 shadow-lg rounded-2xl py-0">
        <CardContent className="p-5">
          <CustomMonthAgenda
            events={eventsForCalendar}
            loading={loading}
            viewMode={viewMode}
            currentDate={currentDate}
            onViewModeChange={setViewMode}
            onDateChange={setCurrentDate}
            onEventClick={handleEventClick}
            onDayClick={onDayClick}
            onEventDrop={onEventDrop}
            onAddEvent={onAddEvent}
          />
        </CardContent>
      </Card>

      <AgendaDetailsSheet
        key={sheetKey}
        open={detailsSheetOpen}
        event={selectedEvent}
        agents={agentsForDetails}
        onClose={() => { setDetailsSheetOpen(false); setSelectedEvent(null); }}
        onEdit={onEditEvent ?? (() => {})}
        onRetry={handleRetry}
        onDelete={onDeleteEvent ?? (() => {})}
      />
    </>
  );
}

// ── Helpers (duplicated here to avoid circular dep from useAgenda) ─────────────

function parseRecurrenceRule(rule: string | null | undefined): {
  type: "none" | "daily" | "weekly" | "monthly";
  weekdays: string[];
} {
  if (!rule || rule === "none") return { type: "none", weekdays: [] };
  const dayMap: Record<string, string> = {
    SU: "0", MO: "1", TU: "2", WE: "3", TH: "4", FR: "5", SA: "6",
  };
  const bydayMatch = rule.match(/BYDAY=([^;]+)/);
  if (bydayMatch) {
    const days = bydayMatch[1].split(",").map((d) => dayMap[d] ?? d);
    return { type: "weekly", weekdays: days };
  }
  if (rule.includes("FREQ=DAILY")) return { type: "daily", weekdays: [] };
  if (rule.includes("FREQ=WEEKLY")) return { type: "weekly", weekdays: [] };
  if (rule.includes("FREQ=MONTHLY")) return { type: "monthly", weekdays: [] };
  return { type: "none", weekdays: [] };
}

function extractDateTimeFields(isoString: string | null | undefined, timezone: string) {
  if (!isoString) return { date: "", time: "" };
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return { date: "", time: "" };
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
  } catch {
    return { date: isoString.split("T")[0], time: isoString.split("T")[1]?.slice(0, 5) ?? "" };
  }
}
