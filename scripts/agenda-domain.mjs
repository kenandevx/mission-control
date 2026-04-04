import { reasonDetail } from "./agenda-codes.mjs";

/**
 * Transition an occurrence to 'queued' and record the cron job ID.
 * cronJobId is the openclaw cron job ID that will execute this occurrence.
 */
export async function transitionOccurrenceToQueued(sql, {
  occurrenceId,
  cronJobId,
  reasonCode,
  reasonText,
}) {
  const reason = reasonCode ? reasonDetail(reasonCode, reasonText || "") : (reasonText || null);
  await sql`
    UPDATE agenda_occurrences
    SET status = 'queued',
        cron_job_id = ${cronJobId ?? null},
        queued_at = now(),
        last_retry_reason = COALESCE(${reason}, last_retry_reason)
    WHERE id = ${occurrenceId}
      AND status IN ('scheduled', 'needs_retry')
  `;
}

/**
 * Transition an occurrence to 'needs_retry'.
 * Clears the cron_job_id since the job is no longer active.
 */
export async function transitionOccurrenceToNeedsRetry(sql, {
  occurrenceId,
  attemptNo,
  reasonCode,
  reasonText,
}) {
  const reason = reasonDetail(reasonCode, reasonText || "");
  await sql`
    UPDATE agenda_occurrences
    SET status = 'needs_retry',
        latest_attempt_no = COALESCE(${attemptNo ?? null}, latest_attempt_no),
        last_retry_reason = ${reason},
        cron_job_id = null,
        queued_at = null,
        locked_at = null
    WHERE id = ${occurrenceId}
      AND status IN ('queued', 'running', 'scheduled')
  `;
}

/**
 * Transition an occurrence to 'succeeded'.
 * Only succeeds if status is currently 'running' (prevents double-write).
 */
export async function transitionOccurrenceToSucceeded(sql, {
  occurrenceId,
  attemptNo,
}) {
  const rows = await sql`
    UPDATE agenda_occurrences
    SET status = 'succeeded',
        latest_attempt_no = ${attemptNo},
        cron_job_id = null,
        queued_at = null,
        locked_at = null,
        cron_synced_at = now()
    WHERE id = ${occurrenceId}
      AND status = 'running'
    RETURNING id
  `;
  return rows[0] || null;
}

/**
 * Transition an occurrence from queued/scheduled → running.
 * Returns the row if the transition happened, null if it was already past.
 */
export async function transitionOccurrenceToRunning(sql, {
  occurrenceId,
}) {
  const rows = await sql`
    UPDATE agenda_occurrences
    SET status = 'running',
        locked_at = now()
    WHERE id = ${occurrenceId}
      AND status IN ('scheduled', 'queued', 'needs_retry')
    RETURNING id, latest_attempt_no
  `;
  return rows[0] || null;
}

/**
 * Reschedule an occurrence (used when retrying with a new time).
 */
export async function transitionOccurrenceToScheduledRetry(sql, {
  occurrenceId,
  scheduledFor,
  latestAttemptNo,
  reasonCode,
  reasonText,
}) {
  const reason = reasonDetail(reasonCode, reasonText || "");
  await sql`
    UPDATE agenda_occurrences
    SET status = 'scheduled',
        locked_at = null,
        latest_attempt_no = ${latestAttemptNo},
        scheduled_for = ${scheduledFor},
        retry_requested_at = now(),
        last_retry_reason = ${reason},
        cron_job_id = null,
        queued_at = null
    WHERE id = ${occurrenceId}
  `;
}

/**
 * Sweep stale 'running' occurrences back to 'needs_retry'.
 *
 * Uses per-event execution_window_minutes so a 2-hour task isn’t killed by a
 * 15-minute global timeout. Falls back to the provided defaultMinutes if the
 * event row has no window set.
 *
 * Returns the IDs of affected occurrences.
 */
export async function transitionStaleRunningToNeedsRetry(sql, {
  reason,
  defaultMinutes = 60,
}) {
  // Join to agenda_events to read the per-event execution_window_minutes.
  // An occurrence is stale when:
  //   locked_at < now() - INTERVAL '<execution_window_minutes> minutes'
  // We use GREATEST(coalesce(window, default), 5) to never use a window < 5 min.
  return sql`
    UPDATE agenda_occurrences ao
    SET status = 'needs_retry',
        locked_at = null,
        cron_job_id = null,
        queued_at = null,
        last_retry_reason = ${reason}
    FROM agenda_events ae
    WHERE ao.agenda_event_id = ae.id
      AND ao.status = 'running'
      AND ao.locked_at < now() - (
        GREATEST(COALESCE(ae.execution_window_minutes, ${defaultMinutes}), 5)
        * INTERVAL '1 minute'
      )
    RETURNING ao.id, ae.title, ae.execution_window_minutes
  `;
}
