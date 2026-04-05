/**
 * Centralized status → color mapping for agenda events.
 *
 * ★ SINGLE SOURCE OF TRUTH for all agenda status colors.
 * Every component imports from here — never hardcode status colors elsewhere.
 *
 * Design hex values (authoritative):
 *   Scheduled:    #7BB8CC (teal-blue)
 *   Queued:       #9B82AD (deep lavender)
 *   Running:      #D68A4A (burnt-orange)
 *   Auto-retry:   #E07BA5 (deep rose)
 *   Stale Recov:  #D98E7A (terracotta)
 *   Succeeded:    #1B5E20 (dark forest green)
 *   Needs Retry:  #E6B94D (golden amber)
 *   Failed:       #C62828 (deep crimson)
 *   Cancelled:    #9E9E9E (medium grey)
 *   Skipped:      #C9B47C (muted gold)
 *   Draft:        #8B9DAF (slate-grey)
 */

// ── Canonical hex palette (authoritative, used directly in style props) ─────

export const STATUS_HEX: Record<string, string> = {
  scheduled:      "#7BB8CC",
  queued:         "#9B82AD",
  running:        "#D68A4A",
  auto_retry:     "#E07BA5",
  stale_recovery: "#D98E7A",
  succeeded:      "#1B5E20",
  needs_retry:    "#E6B94D",
  failed:         "#C62828",
  cancelled:      "#9E9E9E",
  skipped:        "#C9B47C",
  draft:          "#8B9DAF",
};

/** Return the hex color for a status key. Falls back to muted-grey. */
export function statusHex(status: string | null | undefined): string {
  return (status && STATUS_HEX[status]) || "#9CA3AF";
}

/** Generate a translucent background (10 % opacity) from a hex value. */
export function statusBg(status: string | null | undefined): string {
  const hex = statusHex(status);
  return hex + "1A"; // 10 % (1/16)
}

/** Return the best text color for a given status hex.
 *  Cancelled/Draft/Skipped are light → return dark text.
 *  All others are dark/medium → return the same hex (or white for very dark). */
function needsDarkText(hex: string): boolean {
  // Luminance threshold: light backgrounds need dark text
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55;
}

/** Generate an inline-text color from a status key. */
export function statusText(status: string | null | undefined): string {
  if (!status) return "#6B7280";
  const hex = STATUS_HEX[status] ?? "#9CA3AF";
  return needsDarkText(hex) ? "#374151" : hex;
}

// ── Status metadata (label, description, tooltip) ───────────────────────────

export const STATUS_META: ReadonlyArray<{
  key: string;
  label: string;
  desc: string;
  tooltip: string;
  animated?: boolean;
  muted?: boolean;
}> = [
  // — Active lifecycle —
  { key: "scheduled",      label: "Scheduled",      desc: "Waiting for its time slot — no cron job assigned yet.",                                    tooltip: "Scheduled for future execution" },
  { key: "queued",         label: "Queued",         desc: "Cron job assigned in the gateway — waiting to fire.",                                       tooltip: "Cron job assigned, waiting to fire" },
  { key: "running",        label: "Running",        desc: "Agent is actively executing this task right now.",                                          tooltip: "Currently executing", animated: true },
  { key: "auto_retry",     label: "Auto-retrying",  desc: "Automatically retrying with a fallback model.",                                             tooltip: "Automatically retrying with fallback model", animated: true },
  { key: "stale_recovery", label: "Stale Recovery", desc: "Recovered from a stuck running state.",                                                     tooltip: "Recovered from a stuck running state" },
  // — Terminal —
  { key: "succeeded",      label: "Succeeded",      desc: "Task completed successfully. Output and artifacts available.",                               tooltip: "The run completed successfully" },
  { key: "failed",         label: "Failed",         desc: "All retry attempts exhausted — terminal failure.",                                          tooltip: "The run failed — check output for errors" },
  // — Action needed —
  { key: "needs_retry",    label: "Needs Retry",    desc: "Run failed. Manual retry required.",                                                        tooltip: "All retries exhausted — needs manual retry" },
  // — Disabled / inactive —
  { key: "cancelled",      label: "Cancelled",      desc: "Manually dismissed — will not run or retry.",                                               tooltip: "Manually dismissed", muted: true },
  { key: "skipped",        label: "Skipped",        desc: "Skipped because a dependency event failed or timed out.",                                   tooltip: "Skipped due to unmet dependency", muted: true },
  { key: "draft",          label: "Draft",          desc: "Inactive event — won't schedule or run until set to Active.",                               tooltip: "Inactive event", muted: true },
] as const;

// Helper lookups from STATUS_META
const _metaMap = new Map(STATUS_META.map(m => [m.key, m]));
export function statusMeta(key: string) {
  return _metaMap.get(key) ?? null;
}
export function statusLabel(key: string): string {
  return _metaMap.get(key)?.label ?? key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
export function statusTooltip(key: string): string {
  return _metaMap.get(key)?.tooltip ?? "";
}
export function statusDesc(key: string): string {
  return _metaMap.get(key)?.desc ?? "";
}
export function statusIsAnimated(key: string): boolean {
  return _metaMap.get(key)?.animated ?? false;
}
export function statusIsMuted(key: string): boolean {
  return _metaMap.get(key)?.muted ?? false;
}
export const STATUS_KEYS = STATUS_META.map(m => m.key);

// ── Tailwind badge classes (derived from STATUS_HEX) ─────────────────────────

function _nearestTailwindStatus(status: string): { border: string; bg: string; text: string; darkText: string } {
  switch (status) {
    case 'scheduled':      return { border: 'border-[#7BB8CC]/40', bg: 'bg-[#7BB8CC]/10', text: 'text-[#7BB8CC]', darkText: 'text-[#7BB8CC]' };
    case 'queued':         return { border: 'border-[#9B82AD]/40', bg: 'bg-[#9B82AD]/10', text: 'text-[#9B82AD]', darkText: 'text-[#9B82AD]' };
    case 'running':        return { border: 'border-[#D68A4A]/40', bg: 'bg-[#D68A4A]/10', text: 'text-[#D68A4A]', darkText: 'text-[#D68A4A]' };
    case 'auto_retry':     return { border: 'border-[#E07BA5]/40', bg: 'bg-[#E07BA5]/10', text: 'text-[#E07BA5]', darkText: 'text-[#E07BA5]' };
    case 'stale_recovery': return { border: 'border-[#D98E7A]/40', bg: 'bg-[#D98E7A]/10', text: 'text-[#D98E7A]', darkText: 'text-[#D98E7A]' };
    case 'succeeded':      return { border: 'border-[#1B5E20]/40', bg: 'bg-[#1B5E20]/10', text: 'text-[#1B5E20]', darkText: 'text-[#1B5E20]' };
    case 'needs_retry':    return { border: 'border-[#E6B94D]/40', bg: 'bg-[#E6B94D]/10', text: 'text-[#E6B94D]', darkText: 'text-[#E6B94D]' };
    case 'failed':         return { border: 'border-[#C62828]/40', bg: 'bg-[#C62828]/10', text: 'text-[#C62828]', darkText: 'text-[#C62828]' };
    case 'cancelled':      return { border: 'border-[#9E9E9E]/40', bg: 'bg-[#9E9E9E]/10', text: 'text-[#9E9E9E]', darkText: 'text-[#9E9E9E]' };
    case 'skipped':        return { border: 'border-[#C9B47C]/40', bg: 'bg-[#C9B47C]/10', text: 'text-[#C9B47C]', darkText: 'text-[#C9B47C]' };
    case 'draft':          return { border: 'border-[#8B9DAF]/40', bg: 'bg-[#8B9DAF]/10', text: 'text-[#8B9DAF]', darkText: 'text-[#8B9DAF]' };
    default:               return { border: 'border-muted-foreground/30', bg: 'bg-muted/10', text: 'text-muted-foreground', darkText: 'text-muted-foreground' };
  }
}

export const STATUS_BADGE_MAP = Object.fromEntries(
  STATUS_META.map(m => {
    const t = _nearestTailwindStatus(m.key);
    return [
      m.key,
      {
        label: m.label,
        className: `${t.border} ${t.bg} ${t.text} dark:${t.darkText}`,
        tooltip: m.tooltip,
      },
    ];
  })
) as Record<string, { label: string; className: string; tooltip: string }>;

export const STATUS_BADGE_FALLBACK = { label: "—", className: "border-muted-foreground/30 text-muted-foreground", tooltip: "" };

// ── Status guide entries (for the legend popup) ─────────────────────────────
// Derived directly from STATUS_META + STATUS_HEX — no duplication.

export const STATUS_GUIDE_ENTRIES = STATUS_META.map(m => {
  const hex = STATUS_HEX[m.key] ?? "#9CA3AF";
  return {
    key: m.key,
    label: m.label,
    desc: m.desc,
    colorKey: m.key as string,
    animated: m.animated,
    muted: m.muted,
    hex,
    /** Inline style for the dot */
    dotStyle: { backgroundColor: hex, boxShadow: `0 0 4px ${hex}60` },
    /** Inline style for the card bg */
    cardBg: `${hex}14`,
    /** Inline style for the card ring */
    cardRing: `${hex}25`,
  };
});

// ── Backward-compat aliases (still exported but DEPRECATED — use STATUS_HEX) ─

/** Map legacy EventColor names → the correct STATUS_HEX value. */
const _EVENT_COLOR_TO_HEX: Record<string, string> = {
  cyan:    STATUS_HEX.scheduled,       // scheduled → cyan
  violet:  STATUS_HEX.queued,          // queued → violet
  orange:  STATUS_HEX.running,         // running → orange
  pink:    STATUS_HEX.auto_retry,      // auto_retry → pink
  fuchsia: STATUS_HEX.stale_recovery,  // stale_recovery → fuchsia
  green:   STATUS_HEX.succeeded,       // succeeded → green
  amber:   STATUS_HEX.needs_retry,     // needs_retry → amber
  rose:    STATUS_HEX.failed,          // failed → rose
  zinc:    STATUS_HEX.cancelled,       // cancelled → zinc
  yellow:  STATUS_HEX.skipped,         // skipped → yellow
  gray:    STATUS_HEX.draft,           // draft → gray
  default: "#9CA3AF",
  // Legacy aliases → same hex as their primary:
  blue:    "#2563eb",
  indigo:  "#4f46e5",
  red:     STATUS_HEX.failed,
  sky:     "#0284c7",
  teal:    "#0f766e",
  purple:  "#7c3aed",
  lime:    "#4d7c0f",
};

/** @deprecated Use STATUS_HEX + statusHex() instead */
export const DOT_COLORS: Record<string, string> = Object.fromEntries(
  STATUS_KEYS.map(k => [k, STATUS_HEX[k]])
);
// Also include EventColor keys so legacy resolveEventColorKey lookups work:
Object.assign(DOT_COLORS, _EVENT_COLOR_TO_HEX);

/** @deprecated Use STATUS_HEX instead */
export type EventColor =
  | "blue" | "green" | "orange" | "pink" | "purple" | "teal"
  | "amber" | "indigo" | "rose" | "cyan" | "lime" | "gray" | "yellow"
  | "zinc" | "sky" | "violet" | "fuchsia" | "default";

/** @deprecated Use STATUS_HEX */
export const EVENT_COLORS: Record<EventColor, { bg: string; text: string; border: string }> = {
  blue:    { bg: "#e0edff", text: "#2563eb", border: "#bfdbfe" },
  green:   { bg: "#def7e4", text: "#1B5E20", border: "#bbf7d0" },
  orange:  { bg: "#fff3e0", text: "#D68A4A", border: "#fed7aa" },
  pink:    { bg: "#fce7f3", text: "#E07BA5", border: "#fbcfe8" },
  purple:  { bg: "#f3e8ff", text: "#7c3aed", border: "#ddd6fe" },
  teal:    { bg: "#e0f7f4", text: "#0f766e", border: "#99f6e4" },
  amber:   { bg: "#fef3c7", text: "#E6B94D", border: "#fde68a" },
  indigo:  { bg: "#e0e7ff", text: "#4f46e5", border: "#c7d2fe" },
  rose:    { bg: "#ffe4e6", text: "#C62828", border: "#fecdd3" },
  cyan:    { bg: "#e0f9fe", text: "#7BB8CC", border: "#a5f3fc" },
  lime:    { bg: "#f0fdf4", text: "#4d7c0f", border: "#d9f99d" },
  gray:    { bg: "#f3f4f6", text: "#6b7280", border: "#d1d5db" },
  yellow:  { bg: "#fefce8", text: "#C9B47C", border: "#fde047" },
  zinc:    { bg: "#f4f4f5", text: "#9E9E9E", border: "#d4d4d8" },
  sky:     { bg: "#f0f9ff", text: "#0284c7", border: "#bae6fd" },
  violet:  { bg: "#f5f3ff", text: "#9B82AD", border: "#ddd6fe" },
  fuchsia: { bg: "#fdf4ff", text: "#E07BA5", border: "#f5d0fe" },
  default: { bg: "hsl(var(--secondary))", text: "hsl(var(--secondary-foreground))", border: "hsl(var(--border))" },
};

// ── Status → key mapping (kept for resolveEventColorKey / resolveEventColor) ─

export const STATUS_COLOR_MAP: Record<string, EventColor> = {
  scheduled:      "cyan",
  queued:         "violet",
  running:        "orange",
  succeeded:      "green",
  failed:         "rose",
  needs_retry:    "amber",
  cancelled:      "zinc",
  skipped:        "yellow",
  auto_retry:     "pink",
  stale_recovery: "fuchsia",
};

export function resolveEventColorKey(event: { status?: string; latestResult?: string | null; color?: EventColor }): EventColor {
  if (event.status === "draft") return "gray";
  if (event.latestResult && STATUS_COLOR_MAP[event.latestResult]) {
    return STATUS_COLOR_MAP[event.latestResult];
  }
  if (event.status === "active") return "cyan";
  return "gray";
}

export function resolveEventColor(event: { status?: string; latestResult?: string | null; color?: EventColor }) {
  return EVENT_COLORS[resolveEventColorKey(event)];
}
