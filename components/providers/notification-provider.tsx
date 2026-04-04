"use client";

import { useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { normalizeAgentLogPayload } from "@/lib/agent-log-utils";

// ── Notification settings (localStorage) ─────────────────────────────────────

const STORAGE_KEY = "mc-notification-settings";

type NotificationSettings = {
  enabled: boolean;
  sound: boolean;
};

function getSettings(): NotificationSettings {
  if (typeof window === "undefined") return { enabled: true, sound: true };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { enabled: true, sound: true };
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed.enabled !== false,
      sound: parsed.sound !== false,
    };
  } catch {
    return { enabled: true, sound: true };
  }
}

export function saveNotificationSettings(settings: NotificationSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  // Dispatch event so provider picks up changes
  window.dispatchEvent(new CustomEvent("mc-notification-settings-changed"));
}

export function loadNotificationSettings(): NotificationSettings {
  return getSettings();
}

// ── Notification sound ───────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;

function playNotificationSound(type: "success" | "info" | "warning" | "error" = "info"): void {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const ctx = audioCtx;

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

    if (type === "success") {
      // Two-tone ascending chime
      oscillator.frequency.setValueAtTime(523, ctx.currentTime); // C5
      oscillator.frequency.setValueAtTime(659, ctx.currentTime + 0.12); // E5
      oscillator.type = "sine";
    } else if (type === "error") {
      // Lower, more urgent
      oscillator.frequency.setValueAtTime(330, ctx.currentTime); // E4
      oscillator.frequency.setValueAtTime(262, ctx.currentTime + 0.15); // C4
      oscillator.type = "triangle";
    } else if (type === "warning") {
      // Single mid tone
      oscillator.frequency.setValueAtTime(440, ctx.currentTime); // A4
      oscillator.type = "triangle";
    } else {
      // Soft ping
      oscillator.frequency.setValueAtTime(587, ctx.currentTime); // D5
      oscillator.type = "sine";
    }

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.4);
  } catch {
    // AudioContext not available
  }
}

// ── Event matching — which events trigger notifications ──────────────────────

type TicketActivityRow = {
  id?: string;
  ticket_id?: string;
  ticket_title?: string;
  source?: string;
  event?: string;
  details?: string;
  level?: string;
};

const TICKET_NOTIFY_EVENTS: Record<string, { title: string; type: "success" | "info" | "warning" | "error"; icon: string }> = {
  "Picked up": { title: "Ticket picked up", type: "info", icon: "🚀" },
  "Completed": { title: "Ticket completed", type: "success", icon: "✅" },
  "Failed": { title: "Ticket failed", type: "error", icon: "❌" },
  "Planning": { title: "Planning started", type: "info", icon: "📋" },
  "Plan ready": { title: "Plan ready for approval", type: "warning", icon: "📝" },
  "Plan generated": { title: "Plan generated", type: "info", icon: "📝" },
  "Planning failed": { title: "Planning failed", type: "error", icon: "❌" },
  "Auto approved": { title: "Auto-approved", type: "info", icon: "⚡" },
  "Retry scheduled": { title: "Retry scheduled", type: "warning", icon: "🔄" },
  "Worker error": { title: "Worker error", type: "error", icon: "⚠️" },
  "Agent response": { title: "Agent responded", type: "success", icon: "🤖" },
  "Expired": { title: "Ticket expired", type: "warning", icon: "⏰" },
  "Needs retry": { title: "Needs manual retry", type: "warning", icon: "⚠️" },
  "Manual retry": { title: "Manual retry queued", type: "info", icon: "🔄" },
  "Fallback model used": { title: "Fallback model used", type: "warning", icon: "🔄" },
};

type AgendaOccurrenceRow = {
  id?: string;
  status?: string;
  event_title?: string;
  event_id?: string;
};

// ── Provider Component ───────────────────────────────────────────────────────

export function NotificationProvider(): null {
  const mountedRef = useRef(false);
  const settingsRef = useRef<NotificationSettings>(getSettings());
  const seenIdsRef = useRef(new Set<string>());

  // Listen for settings changes
  useEffect(() => {
    const handler = () => { settingsRef.current = getSettings(); };
    window.addEventListener("mc-notification-settings-changed", handler);
    return () => window.removeEventListener("mc-notification-settings-changed", handler);
  }, []);

  const notify = useCallback((title: string, description: string, type: "success" | "info" | "warning" | "error", dedupeKey?: string) => {
    const s = settingsRef.current;
    if (!s.enabled) return;

    // Dedupe by key
    if (dedupeKey) {
      if (seenIdsRef.current.has(dedupeKey)) return;
      seenIdsRef.current.add(dedupeKey);
      // Keep set from growing unbounded
      if (seenIdsRef.current.size > 500) {
        const arr = [...seenIdsRef.current];
        seenIdsRef.current = new Set(arr.slice(-250));
      }
    }

    // Show toast
    if (type === "success") toast.success(title, { description });
    else if (type === "error") toast.error(title, { description });
    else if (type === "warning") toast.warning(title, { description });
    else toast.info(title, { description });

    // Play sound
    if (s.sound) playNotificationSound(type);
  }, []);

  // SSE: ticket activity stream + polling for failed agenda & service health
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    // Track initial load to avoid notification storms
    let failedSeeded = false;
    let servicesSeeded = false;
    const knownFailedIds = new Set<string>();
    const knownServiceStatuses = new Map<string, string>();

    // Ticket activity SSE
    const ticketSSE = new EventSource("/api/events");
    ticketSSE.addEventListener("ticket_activity", (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent).data || "{}");
        const row = (parsed?.row ?? parsed) as TicketActivityRow;
        if (!row?.event) return;

        const match = TICKET_NOTIFY_EVENTS[row.event];
        if (!match) return;

        const ticketName = row.ticket_title || "Ticket";
        const details = row.details ? normalizeAgentLogPayload(row.details).messagePreview : "";
        const dedupeKey = `ticket-${row.id || row.ticket_id}-${row.event}`;
        notify(
          `${match.icon} ${match.title}`,
          ticketName + (details ? ` — ${details}` : ""),
          match.type,
          dedupeKey,
        );
      } catch { /* ignore */ }
    });
    ticketSSE.onerror = () => { /* reconnects automatically */ };

    // Agent logs SSE — notify on agenda run completions
    const logSSE = new EventSource("/api/agent/logs/stream");
    logSSE.addEventListener("log_row", (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent).data || "{}");
        const row = parsed?.row;
        if (!row) return;

        const eventType = String(row.event_type || row.eventType || "");
        const rawMsg = String(row.message || "");
        const messagePreview = normalizeAgentLogPayload(rawMsg).messagePreview;

        // Only notify on important agent events
        if (eventType === "system.startup") {
          notify("🟢 Agent started", messagePreview, "info", `log-${row.id}`);
        } else if (eventType === "system.error") {
          notify("🔴 System error", messagePreview, "error", `log-${row.id}`);
        }
      } catch { /* ignore */ }
    });
    logSSE.onerror = () => { /* reconnects automatically */ };

    // Poll: failed agenda occurrences (every 60s)
    const pollFailed = async () => {
      try {
        const res = await fetch("/api/agenda/failed", { cache: "reload" });
        const json = await res.json();
        if (!json.ok) return;
        const occs: AgendaOccurrenceRow[] = json.occurrences ?? [];

        if (!failedSeeded) {
          // Seed initial state without notifying
          for (const o of occs) if (o.id) knownFailedIds.add(o.id);
          failedSeeded = true;
          return;
        }

        for (const o of occs) {
          if (!o.id || knownFailedIds.has(o.id)) continue;
          knownFailedIds.add(o.id);

          const title = o.event_title || "Agenda event";
          if (o.status === "needs_retry") {
            notify("⚠️ Needs Retry", title, "warning", `failed-${o.id}`);
          } else if (o.status === "expired") {
            notify("⏰ Expired", title, "warning", `failed-${o.id}`);
          } else if (o.status === "failed") {
            // Critical: play sound + toast
            notify("❌ Failed", title, "error", `failed-${o.id}`);
          }
        }
      } catch { /* ignore */ }
    };

    // Poll: service health (every 30s)
    const pollServices = async () => {
      try {
        const res = await fetch("/api/services", { cache: "reload" });
        const json = await res.json();
        if (!json.ok) return;
        const svcs: { name: string; status: string; pidAlive: boolean }[] = json.services ?? [];

        if (!servicesSeeded) {
          for (const s of svcs) knownServiceStatuses.set(s.name, s.pidAlive ? s.status : "stopped");
          servicesSeeded = true;
          return;
        }

        for (const s of svcs) {
          const effectiveStatus = s.pidAlive ? s.status : "stopped";
          const prev = knownServiceStatuses.get(s.name);
          knownServiceStatuses.set(s.name, effectiveStatus);

          if (prev === effectiveStatus) continue;
          if (!prev) continue; // First time seeing this service

          if (effectiveStatus === "stopped" && prev === "running") {
            notify(`🔴 ${s.name} stopped`, "Service is no longer running", "warning", `svc-${s.name}-stopped`);
          } else if (effectiveStatus === "error") {
            notify(`🔴 ${s.name} error`, "Service encountered an error", "error", `svc-${s.name}-error`);
          } else if (effectiveStatus === "running" && prev !== "running") {
            notify(`🟢 ${s.name} started`, "Service is now running", "info", `svc-${s.name}-started`);
          }
        }
      } catch { /* ignore */ }
    };

    void pollFailed();
    void pollServices();
    const failedTimer = setInterval(pollFailed, 60_000);
    const servicesTimer = setInterval(pollServices, 30_000);

    return () => {
      ticketSSE.close();
      logSSE.close();
      clearInterval(failedTimer);
      clearInterval(servicesTimer);
      mountedRef.current = false;
    };
  }, [notify]);

  return null;
}
