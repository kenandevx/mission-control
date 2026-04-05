/**
 * Centralized status → color mapping for agenda events.
 * Single source of truth — used by calendar pills, detail badges, and status guide.
 *
 * Every status gets a UNIQUE color for instant visual distinction.
 * Reordered logically through the lifecycle (scheduled → running → terminal).
 */

// ── Pill colors (calendar events) ───────────────────────────────────────────

export type EventColor =
  | "blue" | "green" | "orange" | "pink" | "purple" | "teal"
  | "amber" | "indigo" | "rose" | "cyan" | "lime" | "gray" | "yellow"
  | "zinc" | "sky" | "violet" | "default";

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
  yellow:  { bg: "#fefce8", text: "#ca8a04", border: "#fde047" },
  zinc:    { bg: "#f4f4f5", text: "#71717a", border: "#d4d4d8" },
  sky:     { bg: "#f0f9ff", text: "#0284c7", border: "#bae6fd" },
  violet:  { bg: "#f5f3ff", text: "#7c3aed", border: "#ddd6fe" },
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
  yellow:  "#ca8a04",
  zinc:    "#71717a",
  sky:     "#0284c7",
  violet:  "#7c3aed",
  default: "hsl(var(--muted-foreground))",
};

// ── Status → color key mapping ──────────────────────────────────────────────

export const STATUS_COLOR_MAP: Record<string, EventColor> = {
  scheduled:    "cyan",
  queued:       "violet",
  running:      "blue",
  succeeded:    "green",
  failed:       "rose",
  needs_retry:  "amber",
  cancelled:    "gray",
  skipped:      "yellow",
};

export function resolveEventColorKey(event: { status?: string; latestResult?: string | null; color?: EventColor }): EventColor {
  if (event.status === "draft") return "gray";
  if (event.latestResult && STATUS_COLOR_MAP[event.latestResult]) {
    return STATUS_COLOR_MAP[event.latestResult];
  }
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
  running:      { label: "● Running",      className: "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400", tooltip: "Currently executing" },
  pending:      { label: "Pending",        className: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400", tooltip: "Waiting to be picked up" },
  queued:       { label: "Queued",         className: "border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400", tooltip: "Cron job assigned, waiting to fire" },
  scheduled:    { label: "Scheduled",      className: "border-cyan-500/40 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400", tooltip: "Scheduled for future execution" },
  needs_retry:  { label: "⚠ Needs Retry",  className: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400", tooltip: "All retries exhausted — needs manual retry" },
  auto_retry:   { label: "↺ Auto-retry",   className: "border-teal-500/40 bg-teal-500/10 text-teal-600 dark:text-teal-400", tooltip: "Automatically retrying with fallback model" },
  stale_recovery: { label: "⟳ Stale",     className: "border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400", tooltip: "Recovered from a stuck running state" },
  cancelled:    { label: "Cancelled",      className: "border-zinc-500/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400", tooltip: "Manually dismissed" },
  skipped:      { label: "⏭ Skipped",      className: "border-yellow-500/40 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400", tooltip: "Skipped due to unmet dependency" },
  draft:        { label: "Draft",          className: "border-slate-400/40 bg-slate-400/10 text-slate-500 dark:text-slate-400", tooltip: "Inactive event" },
};

export const STATUS_BADGE_FALLBACK = { label: "—", className: "border-muted-foreground/30 text-muted-foreground", tooltip: "" };

// ── Status guide entries (for the legend popup) ─────────────────────────────
//
// Each status gets a UNIQUE pastel color that's easy to distinguish at a glance.
// Ordered chronologically through the lifecycle: scheduled → queued → running → terminal.

export const STATUS_GUIDE_ENTRIES: ReadonlyArray<{
  key: string; label: string; desc: string; colorKey: EventColor;
  bg: string; ring: string; animated?: boolean; muted?: boolean;
}> = [
  // ── Active lifecycle ──
  {
    key: "scheduled",
    label: "Scheduled",
    desc: "Created and waiting for its time to run. No cron job assigned yet.",
    colorKey: "cyan" as EventColor,
    bg: "bg-cyan-500/8 dark:bg-cyan-500/10",
    ring: "ring-cyan-500/15",
  },
  {
    key: "queued",
    label: "Queued",
    desc: "Cron job assigned in the gateway — waiting for its time slot to fire.",
    colorKey: "violet" as EventColor,
    bg: "bg-violet-500/8 dark:bg-violet-500/10",
    ring: "ring-violet-500/20",
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
  // ── Success ──
  {
    key: "succeeded",
    label: "Succeeded",
    desc: "Task completed successfully. Output and artifacts are available.",
    colorKey: "green" as EventColor,
    bg: "bg-emerald-500/8 dark:bg-emerald-500/10",
    ring: "ring-emerald-500/20",
  },
  // ── Terminal failures ──
  {
    key: "failed",
    label: "Failed",
    desc: "All retry attempts exhausted — terminal failure. Check output for errors.",
    colorKey: "rose" as EventColor,
    bg: "bg-red-500/8 dark:bg-red-500/10",
    ring: "ring-red-500/20",
  },
  {
    key: "needs_retry",
    label: "Needs Retry",
    desc: "Run failed. Waiting for manual intervention to retry.",
    colorKey: "amber" as EventColor,
    bg: "bg-amber-500/8 dark:bg-amber-500/10",
    ring: "ring-amber-500/20",
  },
  // ── Retry states ──
  {
    key: "auto_retry",
    label: "Auto-retrying",
    desc: "Automatically retrying with a fallback model after primary model failure.",
    colorKey: "teal" as EventColor,
    bg: "bg-teal-500/8 dark:bg-teal-500/10",
    ring: "ring-teal-500/20",
    animated: true,
  },
  {
    key: "stale_recovery",
    label: "Stale Recovery",
    desc: "Recovered from a stuck running state — the agent did not finish cleanly.",
    colorKey: "orange" as EventColor,
    bg: "bg-orange-500/8 dark:bg-orange-500/10",
    ring: "ring-orange-500/20",
  },
  // ── Disabled / inactive ──
  {
    key: "cancelled",
    label: "Cancelled",
    desc: "Manually dismissed — will not run or retry.",
    colorKey: "zinc" as EventColor,
    bg: "bg-zinc-500/8 dark:bg-zinc-500/10",
    ring: "ring-zinc-500/15",
    muted: true,
  },
  {
    key: "skipped",
    label: "Skipped",
    desc: "Skipped because a dependency event failed or timed out.",
    colorKey: "yellow" as EventColor,
    bg: "bg-yellow-500/8 dark:bg-yellow-500/10",
    ring: "ring-yellow-500/15",
    muted: true,
  },
  {
    key: "draft",
    label: "Draft",
    desc: "Inactive event — won't schedule or run until set to Active.",
    colorKey: "gray" as EventColor,
    bg: "bg-slate-400/8 dark:bg-slate-400/10",
    ring: "ring-slate-400/15",
    muted: true,
  },
] as const;
