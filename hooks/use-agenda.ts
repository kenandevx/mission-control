"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { EventInput } from "@fullcalendar/core";

export type AgendaEventProcess = {
  id: string;
  process_version_id: string;
  sort_order: number;
  process_name: string;
  version_number: number;
};

export type AgendaEvent = {
  id: string;
  title: string;
  free_prompt: string | null;
  default_agent_id: string | null;
  timezone: string;
  starts_at: string;
  ends_at: string | null;
  recurrence_rule: string | null;
  recurrence_until: string | null;
  status: "draft" | "active";
  created_by: string | null;
  created_at: string;
  updated_at: string;
  processes: AgendaEventProcess[];
  latest_occurrence_status?: string | null;
  run_started_at?: string | null;
  run_finished_at?: string | null;
  // scheduled_for of the next occurrence — used for the cron countdown timer in FullCalendar.
  // One-time events: the occurrence's scheduled_for from agenda_occurrences.
  // Recurring events: the specific occurrence ISO timestamp (from RRULE expansion).
  scheduled_for?: string | null;
};

export type AgendaOccurrence = {
  id: string;
  agenda_event_id: string;
  scheduled_for: string;
  status: "scheduled" | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "needs_retry";
  latest_attempt_no: number;
  locked_at: string | null;
  created_at: string;
  attempts: {
    id: string;
    attempt_no: number;
    status: string;
    started_at: string;
    finished_at: string | null;
    summary: string | null;
    error_message: string | null;
  }[];
};

export type AgendaEventDetail = AgendaEvent & {
  occurrences: AgendaOccurrence[];
};

export type AgendaEventFormData = {
  title: string;
  request: string;
  agentId: string;
  processVersionIds: string[];
  status: "draft" | "active";
  startsAt: string;
  startsTime: string;
  endsAt: string;
  endsTime: string;
  timezone: string;
  recurrence: "none" | "daily" | "weekly" | "monthly";
  weekdays: string[];
  recurrenceUntil: string;
  executionWindowMinutes?: number;
  fallbackModel?: string;
};

async function apiFetch(path: string, body: Record<string, unknown>) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiGet(path: string) {
  const res = await fetch(path, { cache: "reload" });
  return res.json();
}

function toRecurrenceRule(recurrence: AgendaEventFormData["recurrence"], weekdays: string[]): string | null {
  if (recurrence === "none") return null;
  if (recurrence === "daily") return "FREQ=DAILY";
  if (recurrence === "weekly") {
    const days = weekdays.length > 0 ? weekdays.sort().map((d) => ["SU","MO","TU","WE","TH","FR","SA"][Number(d)]).join(",") : "MO";
    return `FREQ=WEEKLY;BYDAY=${days}`;
  }
  if (recurrence === "monthly") return "FREQ=MONTHLY";
  return null;
}

function toCalendarEvents(events: AgendaEvent[]): EventInput[] {
  return events.map((e) => {
    const latestResult = (e.latest_occurrence_status ?? null) as CalendarEventLatestResult;
    // color_key from the event row (user-chosen palette) — cast from the API response
    const colorKey = (e as unknown as Record<string, unknown>).color_key as string | undefined;
    return {
      id: e.id,
      title: e.title,
      start: e.starts_at,
      end: e.ends_at || undefined,
      allDay: false,
      // backgroundColor is not used by CustomMonthAgenda (it derives color from resolveEventColor)
      // but set it anyway for FullCalendar fallback rendering
      backgroundColor: e.status === "draft" ? "#6b7280" : "#3b82f6",
      borderColor: e.status === "draft" ? "#6b7280" : "#2563eb",
      extendedProps: {
        request: e.free_prompt ?? "",
        agentId: e.default_agent_id ?? "",
        timezone: e.timezone,
        recurrence: e.recurrence_rule ?? "none",
        isRecurring: !!e.recurrence_rule && e.recurrence_rule !== "none" && e.recurrence_rule !== "null",
        status: e.status,
        color: colorKey,
        processes: e.processes ?? [],
        latestResult,
        runStartedAt: e.run_started_at ?? null,
        runFinishedAt: e.run_finished_at ?? null,
        nextRuns: [],
        // scheduled_for of this specific occurrence — used for live countdown timer.
        // One-time: occurrence's scheduled_for from agenda_occurrences.
        // Recurring: per-occurrence ISO timestamp from RRULE expansion.
        // Falls back to starts_at for pre-fix events.
        scheduledFor: e.scheduled_for ?? e.starts_at ?? null,
      },
    };
  });
}

type CalendarEventLatestResult = "scheduled" | "running" | "succeeded" | "failed" | "needs_retry" | "queued" | null;

export function useAgenda() {
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<EventInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefetching, setIsRefetching] = useState(false);
  const [error, setError] = useState("");
  const hasLoadedOnce = useRef(false);

  const loadEvents = useCallback(async (start?: string, end?: string) => {
    // Only block the initial load with the loading spinner.
    // Subsequent refetches update data in-place — no skeleton.
    if (!hasLoadedOnce.current) {
      setLoading(true);
      setError("");
    } else {
      setIsRefetching(true);
      setError("");
    }
    try {
      let url = "/api/agenda/events";
      if (start && end) url += `?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
      const json = await apiGet(url);
      if (json.ok) {
        const evts: AgendaEvent[] = json.events ?? [];
        setEvents(evts);
        setCalendarEvents(toCalendarEvents(evts));
        hasLoadedOnce.current = true;
      } else {
        setError(json.error ?? "Failed to load events");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
      setIsRefetching(false);
    }
  }, []);

  const createEvent = async (form: AgendaEventFormData) => {
    const startsAt = form.startsAt && form.startsTime
      ? `${form.startsAt}T${form.startsTime}:00`
      : form.startsAt ? `${form.startsAt}T10:00:00` : null;
    const endsAt = form.endsAt
      ? (form.endsTime ? `${form.endsAt}T${form.endsTime}:00` : `${form.endsAt}T10:00:00`)
      : null;
    const recurrenceRule = toRecurrenceRule(form.recurrence, form.weekdays);
    const recurrenceUntil = form.recurrenceUntil ? new Date(form.recurrenceUntil).toISOString() : null;

    const json = await apiFetch("/api/agenda/events", {
      action: "createEvent",
      title: form.title,
      freePrompt: form.request || null,
      agentId: form.agentId || null,
      timezone: form.timezone,
      startsAt,
      endsAt,
      recurrenceRule,
      recurrenceUntil,
      status: form.status,
      processVersionIds: form.processVersionIds,
      executionWindowMinutes: form.executionWindowMinutes ?? 30,
      fallbackModel: form.fallbackModel ?? "",
    });

    if (json.ok) {
      await loadEvents();
      toast.success("Event created");
      return json.event;
    } else {
      toast.error(json.error ?? "Failed to create event");
      throw new Error(json.error);
    }
  };

  const updateEvent = async (id: string, form: Partial<AgendaEventFormData>) => {
    const patch: Record<string, unknown> = {};
    if (form.title !== undefined) patch.title = form.title;
    if (form.request !== undefined) patch.freePrompt = form.request || null;
    if (form.agentId !== undefined) patch.agentId = form.agentId || null;
    if (form.timezone !== undefined) patch.timezone = form.timezone;
    if (form.startsAt !== undefined) {
      const t = form.startsTime ?? "10:00";
      patch.startsAt = form.startsAt ? `${form.startsAt}T${t}:00` : undefined;
    }
    if (form.endsAt !== undefined) {
      const t = form.endsTime ?? "";
      patch.endsAt = form.endsAt ? (t ? `${form.endsAt}T${t}:00` : `${form.endsAt}T10:00:00`) : null;
    }
    if (form.recurrence !== undefined) {
      patch.recurrenceRule = toRecurrenceRule(form.recurrence, form.weekdays ?? []);
    }
    if (form.recurrenceUntil !== undefined) {
      patch.recurrenceUntil = form.recurrenceUntil ? new Date(form.recurrenceUntil).toISOString() : null;
    }
    if (form.status !== undefined) patch.status = form.status;
    if (form.processVersionIds !== undefined) patch.processVersionIds = form.processVersionIds;
    if (form.executionWindowMinutes !== undefined) patch.executionWindowMinutes = form.executionWindowMinutes;
    if (form.fallbackModel !== undefined) patch.fallbackModel = form.fallbackModel;

    const res = await fetch(`/api/agenda/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (json.ok) {
      await loadEvents();
      toast.success("Event updated");
    } else {
      toast.error(json.error ?? "Failed to update event");
    }
  };

  const deleteEvent = async (id: string) => {
    try {
      const res = await fetch(`/api/agenda/events/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.ok) {
        // Optimistic update — remove from local state so no flash
        setEvents((prev) => prev.filter((e) => e.id !== id));
        setCalendarEvents((prev) => prev.filter((e) => (e as EventInput & { id: string }).id !== id));
        toast.success("Event deleted");
        // Full refetch to sync with server (won't show skeleton)
        void loadEvents();
      } else {
        toast.error(json.error ?? "Failed to delete event");
      }
    } catch {
      toast.error("Failed to delete event");
    }
  };

  const getEventDetail = async (id: string): Promise<AgendaEventDetail | null> => {
    const res = await fetch(`/api/agenda/events/${id}`, { cache: "reload" });
    const json = await res.json();
    if (json.ok) return json;
    return null;
  };

  const retryOccurrence = async (occurrenceId: string) => {
    // Find event that owns this occurrence
    const res = await apiGet(`/api/agenda/events`);
    if (!res.ok) return;
    const allEvents: AgendaEvent[] = res.events ?? [];
    for (const evt of allEvents) {
      const occRes = await apiGet(`/api/agenda/events/${evt.id}`);
      if (!occRes.ok) continue;
      const occurrences: AgendaOccurrence[] = occRes.occurrences ?? [];
      const occ = occurrences.find((o) => o.id === occurrenceId);
      if (!occ) continue;
      const json = await apiFetch(`/api/agenda/events/${evt.id}/occurrences/${occurrenceId}`, {});
      if (json.ok) {
        toast.success("Run retried");
        await loadEvents();
        return;
      }
    }
    toast.error("Failed to retry");
  };

  return {
    events,
    calendarEvents,
    loading,
    error,
    loadEvents,
    createEvent,
    updateEvent,
    deleteEvent,
    getEventDetail,
    retryOccurrence,
  };
}
