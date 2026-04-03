// BullMQ/Redis removed in v2 — ticket execution via openclaw cron.
// This file is kept as a stub; ticket scheduling is not yet migrated to cron.

export function getTicketQueue() {
  return null;
}

export async function closeTicketQueue() {
  // no-op
}
