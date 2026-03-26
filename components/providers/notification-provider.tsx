"use client";

import { useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";

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

  // SSE: ticket activity stream
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

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
        const dedupeKey = `ticket-${row.id || row.ticket_id}-${row.event}`;
        notify(
          `${match.icon} ${match.title}`,
          ticketName + (row.details ? ` — ${row.details.slice(0, 100)}` : ""),
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
        const level = String(row.level || "info");
        const message = String(row.message_preview || row.message || "");

        // Only notify on important agent events
        if (eventType === "system.startup") {
          notify("🟢 Agent started", message.slice(0, 100), "info", `log-${row.id}`);
        } else if (eventType === "system.error") {
          notify("🔴 System error", message.slice(0, 100), "error", `log-${row.id}`);
        }
      } catch { /* ignore */ }
    });
    logSSE.onerror = () => { /* reconnects automatically */ };

    return () => {
      ticketSSE.close();
      logSSE.close();
      mountedRef.current = false;
    };
  }, [notify]);

  return null;
}
