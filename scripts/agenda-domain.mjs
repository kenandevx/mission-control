import { reasonDetail } from "./agenda-codes.mjs";

export async function transitionOccurrenceToQueued(sql, {
  occurrenceId,
  queueJobId,
  reasonCode,
  reasonText,
}) {
  const reason = reasonCode ? reasonDetail(reasonCode, reasonText || "") : (reasonText || null);
  await sql`
    update agenda_occurrences
    set status = 'queued',
        queue_job_id = ${queueJobId ?? null},
        queued_at = now(),
        last_retry_reason = coalesce(${reason}, last_retry_reason)
    where id = ${occurrenceId}
  `;
}

export async function transitionOccurrenceToNeedsRetry(sql, {
  occurrenceId,
  attemptNo,
  reasonCode,
  reasonText,
  clearQueue = true,
  clearLock = false,
}) {
  const reason = reasonDetail(reasonCode, reasonText || "");
  await sql`
    update agenda_occurrences
    set status = 'needs_retry',
        latest_attempt_no = coalesce(${attemptNo}, latest_attempt_no),
        last_retry_reason = ${reason},
        queue_job_id = case when ${clearQueue} then null else queue_job_id end,
        queued_at = case when ${clearQueue} then null else queued_at end,
        locked_at = case when ${clearLock} then null else locked_at end
    where id = ${occurrenceId}
  `;
}

export async function transitionOccurrenceToSucceeded(sql, {
  occurrenceId,
  attemptNo,
}) {
  await sql`
    update agenda_occurrences
    set status = 'succeeded',
        latest_attempt_no = ${attemptNo},
        queue_job_id = null,
        queued_at = null,
        locked_at = null
    where id = ${occurrenceId} and status = 'running'
  `;
}

export async function transitionOccurrenceToRunning(sql, {
  occurrenceId,
}) {
  const rows = await sql`
    update agenda_occurrences
    set status = 'running',
        locked_at = now(),
        queue_job_id = null,
        queued_at = null
    where id = ${occurrenceId} and status in ('scheduled', 'queued', 'needs_retry')
    returning id, latest_attempt_no
  `;
  return rows[0] || null;
}

export async function transitionOccurrenceToScheduledRetry(sql, {
  occurrenceId,
  scheduledFor,
  latestAttemptNo,
  reasonCode,
  reasonText,
}) {
  const reason = reasonDetail(reasonCode, reasonText || "");
  await sql`
    update agenda_occurrences
    set status = 'scheduled',
        locked_at = null,
        latest_attempt_no = ${latestAttemptNo},
        scheduled_for = ${scheduledFor},
        retry_requested_at = now(),
        last_retry_reason = ${reason},
        queue_job_id = null,
        queued_at = null
    where id = ${occurrenceId}
  `;
}

export async function transitionStaleRunningToNeedsRetry(sql, {
  reason,
  olderThanMinutes = 15,
}) {
  return sql`
    update agenda_occurrences
    set status = 'needs_retry',
        locked_at = null,
        queue_job_id = null,
        queued_at = null,
        last_retry_reason = ${reason}
    where status = 'running'
      and locked_at < now() - make_interval(mins => ${olderThanMinutes})
    returning id
  `;
}
