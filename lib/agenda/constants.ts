/* ── Canonical occurrence statuses ────────────────────────────────────────────
 *
 *  ★ Derived from STATUS_META in status-colors.ts — single source of truth.
 *    Every new status added to STATUS_META automatically appears here.
 * ───────────────────────────────────────────────────────────────────────────── */

import { STATUS_META } from "@/lib/status-colors";

/** All valid occurrence status keys. */
export const OCCURRENCE_STATUSES = Object.fromEntries(
  STATUS_META.map(m => [m.key.toUpperCase(), m.key])
) as Record<string, string>;

export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[keyof typeof OCCURRENCE_STATUSES];

export const RETRYABLE_STATUSES = [
  OCCURRENCE_STATUSES.NEEDS_RETRY,
  OCCURRENCE_STATUSES.FAILED,
  OCCURRENCE_STATUSES.RUNNING,
  OCCURRENCE_STATUSES.QUEUED,
  OCCURRENCE_STATUSES.SCHEDULED,
  OCCURRENCE_STATUSES.AUTO_RETRY,
  OCCURRENCE_STATUSES.STALE_RECOVERY,
] as const;

export const FORCE_RETRYABLE_STATUSES = [
  ...RETRYABLE_STATUSES,
  OCCURRENCE_STATUSES.SUCCEEDED,
  OCCURRENCE_STATUSES.CANCELLED,
  OCCURRENCE_STATUSES.SKIPPED,
  OCCURRENCE_STATUSES.DRAFT,
] as const;

export const RETRY_REASON_CODES = {
  MANUAL_RETRY: "MANUAL_RETRY",
  LOCK_CONTENTION: "LOCK_CONTENTION",
  PROVIDER_REJECTED: "PROVIDER_REJECTED",
  WINDOW_MISSED: "WINDOW_MISSED",
  WORKER_STALLED: "WORKER_STALLED",
  RETRY_EXHAUSTED: "RETRY_EXHAUSTED",
} as const;

export type RetryReasonCode = (typeof RETRY_REASON_CODES)[keyof typeof RETRY_REASON_CODES];
