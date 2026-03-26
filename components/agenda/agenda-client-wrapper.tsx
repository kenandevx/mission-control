"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { IconCalendarEvent, IconGitBranch } from "@tabler/icons-react";
import { toast } from "sonner";
import { AgendaPageClient } from "@/components/agenda/agenda-page-client";
import { AgendaEventModal, type AgendaEventFormData } from "@/components/agenda/agenda-event-modal";
import { AgendaStatsCards } from "@/components/agenda/agenda-stats-cards";
import type { AgendaEventSummary } from "@/components/agenda/agenda-details-sheet";

type AgentOption = { id: string; name: string };
type ProcessOption = { id: string; name: string; version_number: number };

/**
 * Build an ISO 8601 datetime string that represents the given date+time
 * in the given IANA timezone. This ensures the server stores the correct
 * UTC instant (e.g. "2026-03-26T00:26:00" in "Europe/Amsterdam" → UTC-1h in CET).
 */
function buildTzAwareISO(date: string, time: string, timezone: string): string {
  // Create a Date object for the wall-clock time in the target timezone
  // by using Intl to figure out the UTC offset at that moment.
  const naive = new Date(`${date}T${time}:00Z`); // treat as UTC temporarily
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  // What wall-clock time does our naive UTC instant show in the target timezone?
  const parts = fmt.formatToParts(naive);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const wallH = Number(get("hour"));
  const wallM = Number(get("minute"));
  const wantH = Number(time.split(":")[0]);
  const wantM = Number(time.split(":")[1] ?? "0");

  // Offset in minutes: how far is the timezone from UTC?
  // If we send 00:26 UTC and the wall clock shows 01:26, offset = +60
  const diffMinutes = (wallH * 60 + wallM) - (wantH * 60 + wantM);
  // Handle day boundary wrap (e.g. UTC 23:00 → CET 00:00 next day: diff = -1380, should be +60)
  const offsetMinutes = ((diffMinutes + 1440 + 720) % 1440) - 720;

  // The user wants wantH:wantM in their timezone.
  // In UTC that is wantH:wantM minus the offset.
  const utcTotalMin = wantH * 60 + wantM - offsetMinutes;
  const utcDate = new Date(`${date}T00:00:00Z`);
  utcDate.setUTCMinutes(utcTotalMin);
  return utcDate.toISOString();
}

function toRecurrenceRule(recurrence: AgendaEventFormData["recurrence"], weekdays: string[]): string | null {
  if (recurrence === "none") return null;
  if (recurrence === "daily") return "FREQ=DAILY";
  if (recurrence === "weekly") {
    const days = weekdays.length > 0
      ? weekdays.sort().map((d) => ["SU","MO","TU","WE","TH","FR","SA"][Number(d)]).join(",")
      : "MO";
    return `FREQ=WEEKLY;BYDAY=${days}`;
  }
  if (recurrence === "monthly") return "FREQ=MONTHLY";
  return null;
}

function buildFormFromEvent(event: AgendaEventSummary): Partial<AgendaEventFormData> {
  const recurrence = (event.recurrence as AgendaEventFormData["recurrence"]) ?? "none";

  // Derive taskType and frequency from recurrence
  let taskType: "one_time" | "repeatable" = "one_time";
  let frequency: "daily" | "weekly" = "daily";
  if (recurrence === "daily" || recurrence === "weekly") {
    taskType = "repeatable";
    frequency = recurrence;
  }

  const startDateMode: "now" | "specific" = event.startDate ? "specific" : "now";
  const endDateMode: "forever" | "specific" = event.endDate ? "specific" : "forever";

  return {
    title: event.title,
    freePrompt: event.freePrompt ?? "",
    agentId: event.agentId ?? "",
    processVersionIds: event.processIds ?? [],
    status: event.status ?? "draft",
    startDate: event.startDate ?? "",
    startTime: event.startTime ?? "10:00",
    endDate: event.endDate ?? "",
    endTime: event.endTime ?? "",
    timezone: event.timezone ?? "Europe/Amsterdam",
    recurrence,
    taskType,
    frequency,
    startDateMode,
    endDateMode,
    modelOverride: event.modelOverride ?? "",
  };
}

export function AgendaClientWrapper() {
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [processes, setProcesses] = useState<ProcessOption[]>([]);

  // Modal state
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<AgendaEventSummary | null>(null);
  const [editingFormData, setEditingFormData] = useState<Partial<AgendaEventFormData>>({});

  // Recurring edit scope dialog
  const [scopeDialogOpen, setScopeDialogOpen] = useState(false);
  const [pendingEditData, setPendingEditData] = useState<AgendaEventFormData | null>(null);
  const [pendingOccurrenceId, setPendingOccurrenceId] = useState<string | null>(null);

  // Load agents + processes ONCE when wrapper mounts (AbortController survives StrictMode remount)
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [agentsRes, procsRes] = await Promise.all([
          fetch("/api/agents", { cache: "reload", signal: controller.signal }),
          fetch("/api/processes", { cache: "reload", signal: controller.signal }),
        ]);
        const agentsJson = await agentsRes.json();
        const procsJson = await procsRes.json();
        if (!controller.signal.aborted) {
          if (agentsJson.agents) {
            setAgents(
              agentsJson.agents.map((a: { id: string; name: string }) => ({
                id: a.id,
                name: a.name,
              }))
            );
          }
          if (procsJson.processes) {
            setProcesses(
              procsJson.processes
                .filter((p: { latest_version_id: string | null }) => p.latest_version_id)
                .map((p: { id: string; name: string; version_number: number | null; latest_version_id: string }) => ({
                  id: p.latest_version_id,
                  name: p.name,
                  version_number: p.version_number ?? 1,
                }))
            );
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          // only log real errors
          console.error("[agenda] failed to load agents/processes", err);
        }
      }
    })();
    return () => controller.abort();
  }, []);

  const openNewEventModal = () => {
    setEditingEvent(null);
    setEditingFormData({});
    setEventModalOpen(true);
  };

  const handleDayClick = useCallback((date: Date) => {
    const dateStr = date.toISOString().split("T")[0]; // yyyy-MM-dd
    setEditingEvent(null);
    setEditingFormData({ startDate: dateStr });
    setEventModalOpen(true);
  }, []);

  const handleEventDrop = useCallback(async (eventId: string, newDate: string, newTime?: string) => {
    try {
      // Fetch current event to get existing time + timezone
      const res = await fetch(`/api/agenda/events/${eventId}`, { cache: "reload" });
      const json = await res.json();
      if (!json.ok) return;
      const evt = json.event;
      const tz = evt.timezone || "Europe/Amsterdam";

      // Use the new time if provided (week/day view drop), otherwise keep existing time
      let timeToUse: string;
      if (newTime) {
        timeToUse = newTime;
      } else {
        // Extract current time from starts_at in the event's timezone
        const d = new Date(evt.starts_at);
        const fmt = new Intl.DateTimeFormat("en-CA", {
          timeZone: tz,
          hour: "2-digit", minute: "2-digit", hour12: false,
        });
        const parts = fmt.formatToParts(d);
        const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
        timeToUse = `${get("hour")}:${get("minute")}`;
      }

      // Build new starts_at with new date and time
      const newStartsAt = buildTzAwareISO(newDate, timeToUse, tz);

      const patchRes = await fetch(`/api/agenda/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startsAt: newStartsAt }),
      });
      const patchJson = await patchRes.json();
      if (patchJson.ok) {
        toast.success(newTime ? `Event moved to ${newDate} ${newTime}` : "Event moved");
        void document.dispatchEvent(new CustomEvent("agenda-refresh"));
      } else {
        toast.error(patchJson.error ?? "Failed to move event");
      }
    } catch {
      toast.error("Failed to move event");
    }
  }, []);

  const openEditEventModal = useCallback((event: AgendaEventSummary) => {
    setEditingEvent(event);
    setEditingFormData(buildFormFromEvent(event));
    setEventModalOpen(true);
  }, []);

  const handleModalSave = (data: AgendaEventFormData) => {
    const isRecurring = data.recurrence !== "none" && editingEvent && editingEvent.recurrence !== "none";

    if (editingEvent && isRecurring) {
      setPendingEditData(data);
      setPendingOccurrenceId(editingEvent.occurrenceId ?? null);
      setScopeDialogOpen(true);
      setEventModalOpen(false);
      return;
    }

    saveEvent(data, null, null);
    setEventModalOpen(false);
  };

  const handleScopeSelect = (scope: "single" | "this_and_future") => {
    if (!pendingEditData) return;
    saveEvent(pendingEditData, scope, pendingOccurrenceId);
    setScopeDialogOpen(false);
    setPendingEditData(null);
    setPendingOccurrenceId(null);
  };

  const saveEvent = async (
    data: AgendaEventFormData,
    scope: "single" | "this_and_future" | null,
    occurrenceId: string | null
  ) => {
    const tz = data.timezone || "Europe/Amsterdam";

    if (editingEvent) {
      const startsAt = data.startDate && data.startTime
        ? buildTzAwareISO(data.startDate, data.startTime, tz)
        : data.startDate
          ? buildTzAwareISO(data.startDate, "10:00", tz)
          : null;
      const endsAt = data.endDate
        ? buildTzAwareISO(data.endDate, data.endTime || "10:00", tz)
        : null;
      const recurrenceRule = toRecurrenceRule(data.recurrence, data.weekdays);

      const body: Record<string, unknown> = {
        title: data.title,
        freePrompt: data.freePrompt || null,
        agentId: data.agentId || null,
        timezone: tz,
        startsAt,
        endsAt,
        recurrenceRule,
        status: data.status,
        processVersionIds: data.processVersionIds,
        modelOverride: data.modelOverride || "",
      };

      if (scope) {
        body.editScope = scope;
        body.occurrenceId = occurrenceId;
      }

      const res = await fetch(`/api/agenda/events/${editingEvent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(
          scope === "single"
            ? "Only this occurrence updated"
            : scope === "this_and_future"
              ? "This and all upcoming events updated"
              : "Event updated"
        );
      } else {
        toast.error(json.error ?? "Failed to update event");
      }
    } else {
      const startsAt = data.startDate && data.startTime
        ? buildTzAwareISO(data.startDate, data.startTime, tz)
        : data.startDate
          ? buildTzAwareISO(data.startDate, "10:00", tz)
          : null;
      const endsAt = data.endDate
        ? buildTzAwareISO(data.endDate, data.endTime || "10:00", tz)
        : null;
      const recurrenceRule = toRecurrenceRule(data.recurrence, data.weekdays);

      const res = await fetch("/api/agenda/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createEvent",
          title: data.title,
          freePrompt: data.freePrompt || null,
          agentId: data.agentId || null,
          timezone: tz,
          startsAt,
          endsAt,
          recurrenceRule,
          recurrenceUntil: data.recurrenceUntil || null,
          status: data.status,
          processVersionIds: data.processVersionIds,
          modelOverride: data.modelOverride || "",
        }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("Event created");
      } else {
        toast.error(json.error ?? "Failed to create event");
      }
    }

    setEditingEvent(null);
    setEditingFormData({});
    void document.dispatchEvent(new CustomEvent("agenda-refresh"));
  };

  const handleDeleteEvent = async (eventId: string) => {
    const res = await fetch(`/api/agenda/events/${eventId}`, { method: "DELETE" });
    const json = await res.json();
    if (json.ok) {
      toast.success("Event deleted");
      void document.dispatchEvent(new CustomEvent("agenda-refresh"));
    } else {
      toast.error(json.error ?? "Failed to delete event");
    }
  };

  return (
    <>
      <div className="@container/main flex flex-1 flex-col">
        <div className="flex flex-col gap-4 pt-4 md:gap-6">
          <AgendaStatsCards />
          <div className="px-4 lg:px-6">
            <AgendaPageClient
              onEditEvent={openEditEventModal}
              onDeleteEvent={handleDeleteEvent}
              onDayClick={handleDayClick}
              onEventDrop={handleEventDrop}
              onAddEvent={openNewEventModal}
              agentsForDetails={agents}
            />
          </div>
        </div>
      </div>

      <AgendaEventModal
        open={eventModalOpen}
        agents={agents}
        processes={processes}
        initialData={editingFormData}
        onClose={() => {
          setEventModalOpen(false);
          setEditingEvent(null);
          setEditingFormData({});
        }}
        onSave={handleModalSave}
      />

      <AlertDialog
        open={scopeDialogOpen}
        onOpenChange={(open: boolean) => {
          setScopeDialogOpen(open);
          if (!open) {
            setPendingEditData(null);
            setPendingOccurrenceId(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <IconGitBranch className="size-5 text-primary" />
              How should we apply these changes?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              This is a recurring event. Choose whether to change only this occurrence or this and all upcoming ones.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-3 mt-2">
            <Button
              variant="outline"
              className="h-auto py-4 justify-start text-left gap-3 cursor-pointer"
              onClick={() => handleScopeSelect("single")}
            >
              <IconCalendarEvent className="size-5 text-muted-foreground shrink-0" />
              <div>
                <p className="font-semibold text-sm">Only this occurrence</p>
                <p className="text-xs text-muted-foreground">
                  Changes apply to this one instance only. Other occurrences stay the same.
                </p>
              </div>
            </Button>
            <Button
              variant="outline"
              className="h-auto py-4 justify-start text-left gap-3 cursor-pointer"
              onClick={() => handleScopeSelect("this_and_future")}
            >
              <IconGitBranch className="size-5 text-primary shrink-0" />
              <div>
                <p className="font-semibold text-sm">This and all upcoming</p>
                <p className="text-xs text-muted-foreground">
                  This occurrence and all future ones change. Past occurrences are preserved.
                </p>
              </div>
            </Button>
          </div>
          <AlertDialogFooter className="mt-2">
            <AlertDialogCancel
              onClick={() => {
                setScopeDialogOpen(false);
                setPendingEditData(null);
                setPendingOccurrenceId(null);
              }}
            >
              Cancel
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
