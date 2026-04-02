export const AgendaReasonCodes = {
  MANUAL_RETRY: "MANUAL_RETRY",
  LOCK_CONTENTION: "LOCK_CONTENTION",
  PROVIDER_REJECTED: "PROVIDER_REJECTED",
  WINDOW_MISSED: "WINDOW_MISSED",
  WORKER_STALLED: "WORKER_STALLED",
  RETRY_EXHAUSTED: "RETRY_EXHAUSTED",
  ORPHANED_QUEUED: "ORPHANED_QUEUED",
};

export function reasonDetail(code, detail = "") {
  return detail ? `${code}: ${detail}` : code;
}
