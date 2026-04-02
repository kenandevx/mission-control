#!/usr/bin/env node
import postgres from "postgres";

const baseUrl = process.env.MC_BASE_URL || "http://localhost:3000";
const dbUrl = process.env.DATABASE_URL?.trim() || process.env.OPENCLAW_DATABASE_URL?.trim();
if (!dbUrl) {
  console.error("[agenda-smoke] Missing DATABASE_URL / OPENCLAW_DATABASE_URL");
  process.exit(1);
}
const sql = postgres(dbUrl, { max: 2, prepare: false });

async function apiPost(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function main() {
  const [event] = await sql`select id from agenda_events where title = 'test' order by created_at desc limit 1`;
  if (!event?.id) throw new Error("No test event found");

  const scheduledFor = new Date(Date.now() - 90_000).toISOString();
  const created = await apiPost("/api/agenda/events", {
    action: "testOnlyCreateNeedsRetryOccurrence",
    eventId: event.id,
    scheduledFor,
  });
  if (!created?.ok || !created?.occurrenceId) throw new Error(`Failed to create test occurrence: ${JSON.stringify(created)}`);

  const retried = await apiPost(`/api/agenda/events/${event.id}/occurrences/${created.occurrenceId}`, {});
  if (!retried?.ok) throw new Error(`Retry endpoint failed: ${JSON.stringify(retried)}`);

  await new Promise((r) => setTimeout(r, 4000));
  const [row] = await sql`select status, last_retry_reason from agenda_occurrences where id = ${created.occurrenceId}`;
  if (!row) throw new Error("Created occurrence not found");
  if (!["running", "queued", "succeeded", "needs_retry"].includes(String(row.status))) {
    throw new Error(`Unexpected status after retry: ${row.status}`);
  }

  console.log("[agenda-smoke] OK", {
    eventId: event.id,
    occurrenceId: created.occurrenceId,
    status: row.status,
    lastRetryReason: row.last_retry_reason,
  });
}

main()
  .catch((err) => {
    console.error("[agenda-smoke] FAILED", err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 }).catch(() => {});
  });
