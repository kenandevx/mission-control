/**
 * Centralized status → color mapping for agenda events.
 * Single source of truth — used by calendar pills, detail badges, and status guide.
 */

// ── Pill colors (calendar events) ───────────────────────────────────────────

export type EventColor =
  | "blue" | "green" | "orange" | "pink" | "purple" | "teal"
  | "amber" | "indigo" | "rose" | "cyan" | "lime" | "gray" | "default";

export const EVENT_COLORS: Record<EventColor, { bg: string; text: string; border: string }> = {
  blue:    { bg: "#e8f1ff", text: "#3b82f6", border: "#bfdbfe" },
  green:   { bg: "#eaf8ef", text: "#16a34a", border: "#bbf7d0" },
  orange:  { bg: "#fff3e8", text: "#ea580c", border: "#fed7aa" },
  pink:    { bg: "#fdecf3", text: "#ec4899", border: "#fbcfe8" },
  purple:  { bg: "#f3e8ff", text: "#8b5cf6", border: "#ddd6fe" },
  teal:    { bg: "#e6fcf5", text: "#0d9488", border: "#99f6e4" },
  amber:   { bg: "#fffbeb", text: "#d97706", border: "#fde68a" },
  indigo:  { bg: "#eef2ff", text: "#6366f1", border: "#c7d2fe" },
  rose:    { bg: "#fff1f2", text: "#e11d48", border: "#fecdd3" },
  cyan:    { bg: "#ecfeff", text: "#0891b2", border: "#a5f3fc" },
  lime:    { bg: "#f7fee7", text: "#65a30d", border: "#d9f99d" },
  gray:    { bg: "#f3f4f6", text: "#6b7280", border: "#d1d5db" },
  default: { bg: "hsl(var(--secondary))", text: "hsl(var(--secondary-foreground))", border: "hsl(var(--border))" },
};

export const DOT_COLORS: Record<EventColor, string> = {
  blue:    "#3b82f6",
  green:   "#16a34a",
  orange:  "#ea580c",
  pink:    "#ec4899",
  purple:  "#8b5cf6",
  teal:    "#0d9488",
  amber:   "#d97706",
  indigo:  "#6366f1",
  rose:    "#e11d48",
  cyan:    "#0891b2",
  lime:    "#65a30d",
  gray:    "#9ca3af",
  default: "hsl(var(--muted-foreground))",
};

// ── Status → color key mapping ──────────────────────────────────────────────

export const STATUS_COLOR_MAP: Record<string, EventColor> = {
  scheduled:   "gray",
  queued:      "gray",
  running:     "indigo",
  succeeded:   "green",
  failed:      "rose",
  needs_retry: "amber",
};

export function resolveEventColorKey(event: { status?: string; latestResult?: string | null }): EventColor {
  if (event.status === "draft") return "gray";
  if (event.latestResult && STATUS_COLOR_MAP[event.latestResult]) {
    return STATUS_COLOR_MAP[event.latestResult];
  }
  return "gray";
}

export function resolveEventColor(event: { status?: string; latestResult?: string | null }) {
  return EVENT_COLORS[resolveEventColorKey(event)];
}

// ── Badge colors (detail sheet, run cards) ──────────────────────────────────

export const STATUS_BADGE_MAP: Record<string, { label: string; className: string; tooltip: string }> = {
  succeeded:    { label: "✓ Succeeded",    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", tooltip: "The run completed successfully" },
  failed:       { label: "✗ Failed",       className: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400", tooltip: "The run failed — check output for errors" },
  running:      { label: "● Running",      className: "border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400", tooltip: "Currently executing" },
  pending:      { label: "Pending",        className: "border-muted-foreground/30 bg-muted/40 text-muted-foreground", tooltip: "Waiting to be picked up" },
  queued:       { label: "Queued",         className: "border-muted-foreground/30 bg-muted/40 text-muted-foreground", tooltip: "In the execution queue" },
  scheduled:    { label: "Scheduled",      className: "border-muted-foreground/30 bg-muted/40 text-muted-foreground", tooltip: "Scheduled for future execution" },
  needs_retry:  { label: "⚠ Needs Retry",  className: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400", tooltip: "All retries exhausted — needs manual retry" },
};

export const STATUS_BADGE_FALLBACK = { label: "—", className: "border-muted-foreground/30 text-muted-foreground", tooltip: "" };

// ── Status guide entries (for the legend popup) ─────────────────────────────

export const STATUS_GUIDE_ENTRIES: ReadonlyArray<{
  key: string; label: string; desc: string; colorKey: EventColor;
  bg: string; ring: string; animated?: boolean; muted?: boolean;
}> = [
  {
    key: "running",
    label: "Running",
    desc: "Currently being executed by an agent.",
    colorKey: "indigo" as EventColor,
    bg: "bg-blue-500/8 dark:bg-blue-500/10",
    ring: "ring-blue-500/20",
    animated: true,
  },
  {
    key: "scheduled",
    label: "Scheduled",
    desc: "Queued and waiting for its time slot.",
    colorKey: "gray" as EventColor,
    bg: "bg-slate-500/8 dark:bg-slate-500/10",
    ring: "ring-slate-500/15",
  },
  {
    key: "succeeded",
    label: "Succeeded",
    desc: "Completed successfully.",
    colorKey: "green" as EventColor,
    bg: "bg-emerald-500/8 dark:bg-emerald-500/10",
    ring: "ring-emerald-500/20",
  },
  {
    key: "needs_retry",
    label: "Needs Retry",
    desc: "Failed — awaiting manual or automatic retry.",
    colorKey: "amber" as EventColor,
    bg: "bg-amber-500/8 dark:bg-amber-500/10",
    ring: "ring-amber-500/20",
  },
  {
    key: "failed",
    label: "Failed",
    desc: "All retry attempts exhausted.",
    colorKey: "rose" as EventColor,
    bg: "bg-red-500/8 dark:bg-red-500/10",
    ring: "ring-red-500/20",
  },
  {
    key: "draft",
    label: "Draft",
    desc: "Inactive — won't run until activated.",
    colorKey: "gray" as EventColor,
    bg: "bg-muted/60",
    ring: "ring-border",
    muted: true,
  },
] as const;
