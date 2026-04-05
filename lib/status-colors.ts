/**
 * Centralized status → color mapping for agenda events.
 *
 * ★ SINGLE SOURCE OF TRUTH for all agenda status colors.
 * Every component imports from here — never hardcode status colors elsewhere.
 *
 * Design hex values (authoritative):
 *   Scheduled:    #A8DADC (soft powder-blue)
 *   Queued:       #CDB4DB (soft lavender)
 *   Running:      #F4A261 (warm sand-orange)
 *   Auto-retry:   #FFAFCC (soft pink)
 *   Stale Recov:  #FFB4A2 (soft peach)
 *   Succeeded:    #2E7D32 (forest green)
 *   Needs Retry:  #FFD166 (warm yellow)
 *   Failed:       #E63946 (imperial red)
 *   Cancelled:    #D3D3D3 (light silver)
 *   Skipped:      #EAD7A1 (soft gold)
 *   Draft:        #C9D6DF (steel blue-grey)
 */

// ── Canonical hex palette (authoritative, used directly in style props) ─────

export const STATUS_HEX: Record<string, string> = {
  scheduled:      "#A8DADC",
  queued:         "#CDB4DB",
  running:        "#F4A261",
  auto_retry:     "#FFAFCC",
  stale_recovery: "#FFB4A2",
  succeeded:      "#2E7D32",
  needs_retry:    "#FFD166",
  failed:         "#E63946",
  cancelled:      "#D3D3D3",
  skipped:        "#EAD7A1",
  draft:          "#C9D6DF",
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
  // Map our exact hex → the closest Tailwind palette class for convenience.
  // Consumers that need exact hex should use statusHex()/statusBg()/statusText().
  switch (status) {
    case 'scheduled':      return { border: 'border-[#A8DADC]/40', bg: 'bg-[#A8DADC]/10', text: 'text-gray-800', darkText: 'text-gray-800' };
    case 'queued':         return { border: 'border-[#CDB4DB]/40', bg: 'bg-[#CDB4DB]/10', text: 'text-gray-800', darkText: 'text-gray-800' };
    case 'running':        return { border: 'border-[#F4A261]/40', bg: 'bg-[#F4A261]/10', text: 'text-[#B4570B]', darkText: 'text-[#B4570B]' };
    case 'auto_retry':     return { border: 'border-[#FFAFCC]/40', bg: 'bg-[#FFAFCC]/10', text: 'text-gray-800', darkText: 'text-gray-800' };
    case 'stale_recovery': return { border: 'border-[#FFB4A2]/40', bg: 'bg-[#FFB4A2]/10', text: 'text-[#8B3A2F]', darkText: 'text-[#8B3A2F]' };
    case 'succeeded':      return { border: 'border-[#2E7D32]/40', bg: 'bg-[#2E7D32]/10', text: 'text-[#2E7D32]', darkText: 'text-[#2E7D32]' };
    case 'needs_retry':    return { border: 'border-[#FFD166]/40', bg: 'bg-[#FFD166]/10', text: 'text-gray-800', darkText: 'text-gray-800' };
    case 'failed':         return { border: 'border-[#E63946]/40', bg: 'bg-[#E63946]/10', text: 'text-[#E63946]', darkText: 'text-[#E63946]' };
    case 'cancelled':      return { border: 'border-[#D3D3D3]/40', bg: 'bg-[#D3D3D3]/10', text: 'text-gray-800', darkText: 'text-gray-800' };
    case 'skipped':        return { border: 'border-[#EAD7A1]/40', bg: 'bg-[#EAD7A1]/10', text: 'text-gray-800', darkText: 'text-gray-800' };
    case 'draft':          return { border: 'border-[#C9D6DF]/40', bg: 'bg-[#C9D6DF]/10', text: 'text-gray-800', darkText: 'text-gray-800' };
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

/** @deprecated Use STATUS_HEX + statusHex() instead */
export const DOT_COLORS: Record<string, string> = Object.fromEntries(
  STATUS_KEYS.map(k => [k, STATUS_HEX[k]])
);

/** @deprecated Use STATUS_HEX instead */
export type EventColor =
  | "blue" | "green" | "orange" | "pink" | "purple" | "teal"
  | "amber" | "indigo" | "rose" | "cyan" | "lime" | "gray" | "yellow"
  | "zinc" | "sky" | "violet" | "fuchsia" | "default";

/** @deprecated Use STATUS_HEX */
export const EVENT_COLORS: Record<EventColor, { bg: string; text: string; border: string }> = {
  blue:    { bg: "#e0edff", text: "#2563eb", border: "#bfdbfe" },
  green:   { bg: "#def7e4", text: "#2E7D32", border: "#bbf7d0" },
  orange:  { bg: "#fff3e0", text: "#F4A261", border: "#fed7aa" },
  pink:    { bg: "#fce7f3", text: "#FFAFCC", border: "#fbcfe8" },
  purple:  { bg: "#f3e8ff", text: "#7c3aed", border: "#ddd6fe" },
  teal:    { bg: "#e0f7f4", text: "#0f766e", border: "#99f6e4" },
  amber:   { bg: "#fef3c7", text: "#FFD166", border: "#fde68a" },
  indigo:  { bg: "#e0e7ff", text: "#4f46e5", border: "#c7d2fe" },
  rose:    { bg: "#ffe4e6", text: "#E63946", border: "#fecdd3" },
  cyan:    { bg: "#e0f9fe", text: "#A8DADC", border: "#a5f3fc" },
  lime:    { bg: "#f0fdf4", text: "#4d7c0f", border: "#d9f99d" },
  gray:    { bg: "#f3f4f6", text: "#6b7280", border: "#d1d5db" },
  yellow:  { bg: "#fefce8", text: "#EAD7A1", border: "#fde047" },
  zinc:    { bg: "#f4f4f5", text: "#D3D3D3", border: "#d4d4d8" },
  sky:     { bg: "#f0f9ff", text: "#0284c7", border: "#bae6fd" },
  violet:  { bg: "#f5f3ff", text: "#CDB4DB", border: "#ddd6fe" },
  fuchsia: { bg: "#fdf4ff", text: "#FFAFCC", border: "#f5d0fe" },
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
