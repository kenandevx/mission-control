export function normalizeWorkerSettings(input = {}) {
  const poll = Number(input?.pollIntervalSeconds ?? 20);
  const concurrency = Number(input?.maxConcurrency ?? 3);
  return {
    enabled: Boolean(input?.enabled ?? true),
    pollIntervalSeconds: Number.isFinite(poll) ? Math.min(300, Math.max(5, Math.round(poll))) : 20,
    maxConcurrency: Number.isFinite(concurrency) ? Math.min(20, Math.max(1, Math.round(concurrency))) : 3,
  };
}

export function isScheduleReady(scheduledFor, now = new Date()) {
  if (!scheduledFor) return true;
  const at = new Date(scheduledFor);
  if (Number.isNaN(at.valueOf())) return true;
  return at.valueOf() <= now.valueOf();
}

export function isPickupEligible(ticket, inProgressColumnIds, now = new Date()) {
  if (!inProgressColumnIds.has(ticket.column_id)) return false;
  if (!ticket.assigned_agent_id || !ticket.assigned_agent_id.trim()) return false;
  if (!(ticket.execution_state === "queued" || ticket.execution_state === "ready_to_execute")) return false;
  if (!isScheduleReady(ticket.scheduled_for, now)) return false;
  return true;
}

export function capacityLeft(maxConcurrency, currentlyExecuting) {
  return Math.max(0, Math.floor(maxConcurrency) - Math.max(0, Math.floor(currentlyExecuting)));
}
