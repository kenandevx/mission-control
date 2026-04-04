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
  // Status → calendar pill color mapping (single source of truth):
  //   Gray  = scheduled | queued (waiting in cron, NOT active yet)
  //   Blue  = running ONLY (agent actively executing right now)
  //   Green = succeeded
  //   Amber = needs_retry
  //   Rose  = failed
  //   Gray muted = cancelled / skipped / draft (handled via opacity in resolveEventColorKey)
  scheduled:    "gray",
  queued:       "gray",   // cron assigned, waiting to fire — NOT blue; blue = only running
  running:      "blue",   // agent actively executing
  succeeded:    "green",
  failed:       "rose",
  needs_retry:  "amber",
  cancelled:    "gray",
  skipped:      "gray",
};

export function resolveEventColorKey(event: { status?: string; latestResult?: string | null; color?: EventColor }): EventColor {
  if (event.status === "draft") return "gray"; // draft = gray/muted
  if (event.latestResult && STATUS_COLOR_MAP[event.latestResult]) {
    return STATUS_COLOR_MAP[event.latestResult];
  }
  // Active event with no occurrence yet, or occurrence is scheduled = gray (not yet running)
  if (event.status === "active") return "gray";
  return "gray";
}

export function resolveEventColor(event: { status?: string; latestResult?: string | null; color?: EventColor }) {
  return EVENT_COLORS[resolveEventColorKey(event)];
}

// ── Badge colors (detail sheet, run cards) ──────────────────────────────────

export const STATUS_BADGE_MAP: Record<string, { label: string; className: string; tooltip: string }> = {
  succeeded:    { label: "✓ Succeeded",    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", tooltip: "The run completed successfully" },
  failed:       { label: "✗ Failed",       className: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400", tooltip: "The run failed — check output for errors" },
  running:      { label: "● Running",      className: "border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400", tooltip: "Currently executing" },
  pending:      { label: "Pending",        className: "border-muted-foreground/30 bg-muted/40 text-muted-foreground", tooltip: "Waiting to be picked up" },
  queued:       { label: "Queued",         className: "border-muted-foreground/30 bg-muted/40 text-muted-foreground", tooltip: "Scheduled in cron engine, waiting to run" },
  scheduled:    { label: "Scheduled",      className: "border-muted-foreground/30 bg-muted/40 text-muted-foreground", tooltip: "Scheduled for future execution" },
  needs_retry:  { label: "⚠ Needs Retry",  className: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400", tooltip: "All retries exhausted — needs manual retry" },
  cancelled:    { label: "Cancelled",       className: "border-muted-foreground/30 bg-muted/40 text-muted-foreground", tooltip: "This occurrence was cancelled" },
  skipped:      { label: "⏭ Skipped",       className: "border-slate-400/40 bg-slate-400/10 text-slate-500 dark:text-slate-400", tooltip: "Skipped due to unmet dependency" },
  force_retry:  { label: "↺ Force Retry",   className: "border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400", tooltip: "Manually force-retried" },
  auto_retry:   { label: "↺ Auto-retrying", className: "border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400", tooltip: "Automatically retrying with fallback model" },
  stale_recovery: { label: "⟳ Stale Recovery", className: "border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400", tooltip: "Recovered from stale/stuck state" },
};

export const STATUS_BADGE_FALLBACK = { label: "—", className: "border-muted-foreground/30 text-muted-foreground", tooltip: "" };

// ── Status guide entries (for the legend popup) ─────────────────────────────

export const STATUS_GUIDE_ENTRIES: ReadonlyArray<{
  key: string; label: string; desc: string; colorKey: EventColor;
  bg: string; ring: string; animated?: boolean; muted?: boolean;
}> = [
  {
    key: "scheduled",
    label: "Scheduled",
    desc: "Created and scheduled — waiting for its time slot. No cron job fired yet.",
    colorKey: "gray" as EventColor,
    bg: "bg-slate-500/8 dark:bg-slate-500/10",
    ring: "ring-slate-500/15",
  },
  {
    key: "queued",
    label: "Queued",
    desc: "Cron job assigned in the gateway — waiting for its scheduled time slot. Agent has not started yet.",
    colorKey: "gray" as EventColor,
    bg: "bg-slate-500/8 dark:bg-slate-500/10",
    ring: "ring-slate-500/15",
  },
  {
    key: "auto_retry",
    label: "Auto-retrying",
    desc: "Automatically retrying with the configured fallback model after primary model failure.",
    colorKey: "indigo" as EventColor,
    bg: "bg-indigo-500/8 dark:bg-indigo-500/10",
    ring: "ring-indigo-500/20",
    animated: true,
  },
  {
    key: "force_retry",
    label: "Force Retry",
    desc: "Manually triggered re-run of a completed or failed occurrence.",
    colorKey: "purple" as EventColor,
    bg: "bg-purple-500/8 dark:bg-purple-500/10",
    ring: "ring-purple-500/20",
  },
  {
    key: "stale_recovery",
    label: "Stale Recovery",
    desc: "Recovered from a stuck or stale running state — was not completed cleanly.",
    colorKey: "orange" as EventColor,
    bg: "bg-orange-500/8 dark:bg-orange-500/10",
    ring: "ring-orange-500/20",
  },
  {
    key: "running",
    label: "Running",
    desc: "Agent is actively executing this task right now.",
    colorKey: "blue" as EventColor,
    bg: "bg-blue-500/8 dark:bg-blue-500/10",
    ring: "ring-blue-500/20",
    animated: true,
  },
  {
    key: "succeeded",
    label: "Succeeded",
    desc: "Task completed successfully. Output and artifacts are available.",
    colorKey: "green" as EventColor,
    bg: "bg-emerald-500/8 dark:bg-emerald-500/10",
    ring: "ring-emerald-500/20",
  },
  {
    key: "needs_retry",
    label: "Needs Retry",
    desc: "Run failed but retries remain. Waiting for manual or automatic retry.",
    colorKey: "amber" as EventColor,
    bg: "bg-amber-500/8 dark:bg-amber-500/10",
    ring: "ring-amber-500/20",
  },
  {
    key: "failed",
    label: "Failed",
    desc: "All retry attempts exhausted — terminal failure. Check output for errors.",
    colorKey: "rose" as EventColor,
    bg: "bg-red-500/8 dark:bg-red-500/10",
    ring: "ring-red-500/20",
  },
  {
    key: "skipped",
    label: "Skipped",
    desc: "Skipped because a dependency event failed or timed out.",
    colorKey: "gray" as EventColor,
    bg: "bg-slate-500/8 dark:bg-slate-500/10",
    ring: "ring-slate-500/15",
    muted: true,
  },
  {
    key: "cancelled",
    label: "Cancelled",
    desc: "Manually dismissed — will not run or retry.",
    colorKey: "gray" as EventColor,
    bg: "bg-slate-500/8 dark:bg-slate-500/10",
    ring: "ring-slate-500/15",
    muted: true,
  },
  {
    key: "draft",
    label: "Draft",
    desc: "Inactive event — won't schedule or run until set to Active.",
    colorKey: "gray" as EventColor,
    bg: "bg-muted/60",
    ring: "ring-border",
    muted: true,
  },
] as const;
