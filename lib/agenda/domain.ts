import type postgres from "postgres";
import { OCCURRENCE_STATUSES, RETRY_REASON_CODES } from "@/lib/agenda/constants";

export type SqlClient = ReturnType<typeof postgres>;

export async function transitionToScheduledManualRetry(sql: SqlClient, params: {
  occurrenceId: string;
  latestAttemptNo: number;
  retryNow: Date;
}): Promise<void> {
  await sql`
    update agenda_occurrences
    set status = ${OCCURRENCE_STATUSES.QUEUED},
        locked_at = null,
        latest_attempt_no = ${params.latestAttemptNo},
        retry_requested_at = now(),
        last_retry_reason = ${RETRY_REASON_CODES.MANUAL_RETRY},
        cron_job_id = null,
        queued_at = null,
    where id = ${params.occurrenceId}
  `;
}
