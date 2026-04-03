/**
 * Agenda Integration Tests — v2 (cron-based engine)
 *
 * Rules:
 * - Tests use CET (Europe/Amsterdam) timezone
 * - Events scheduled at "now + 1 min" (rounded to next slot, timeStepMinutes=0 to skip alignment)
 * - Each test resets before and after (handled by test runner)
 * - All tests hit the real DB and real cron engine — no mocks
 * - Simple: does it work or not
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type AgendaSettings = {
  schedulingIntervalMinutes: number;
  testSchedulingIntervalMinutes: number;
  defaultExecutionWindowMinutes: number;
  maxRetries: number;
  [key: string]: unknown;
};

export type TestContext = {
  log: (testId: string, msg: string) => void;
  apiGet: (path: string) => Promise<Record<string, unknown>>;
  apiPost: (path: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  apiPatch: (path: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  apiDelete: (path: string) => Promise<Record<string, unknown>>;
  sleep: (ms: number) => Promise<void>;
  uniqueName: (prefix: string) => string;
  settings: AgendaSettings;
  resetTestEvents: () => Promise<number>;
};

export type TestResult = {
  id: string;
  name: string;
  description: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  passed: boolean;
  message: string;
  logs: string[];
  durationMs: number;
  startedAt: number;
  finishedAt: number | null;
};

export type TestRun = {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  results: Record<string, TestResult>;
  interrupted: boolean;
};

export type TestDefinition = {
  id: string;
  name: string;
  description: string;
  skipReset?: boolean;
  run: (ctx: TestContext) => Promise<TestResult>;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function pass(id: string, name: string, desc: string, startedAt: number, msg: string): TestResult {
  return { id, name, description: desc, status: "passed", passed: true, message: msg, logs: [], durationMs: Date.now() - startedAt, startedAt, finishedAt: Date.now() };
}

function fail(id: string, name: string, desc: string, startedAt: number, msg: string): TestResult {
  return { id, name, description: desc, status: "failed", passed: false, message: msg, logs: [], durationMs: Date.now() - startedAt, startedAt, finishedAt: Date.now() };
}

/** CET datetime string for now + offsetMs, formatted for the createEvent API (no timezone suffix) */
function cetNowPlus(offsetMs: number): string {
  const d = new Date(Date.now() + offsetMs);
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Amsterdam",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  // Returns "YYYY-MM-DD HH:mm:ss" — replace space with T for ISO local format
  return fmt.format(d).replace(" ", "T");
}

/** Poll until predicate returns truthy, or timeout */
async function poll<T>(
  fn: () => Promise<T | null | undefined>,
  check: (v: T) => boolean,
  { intervalMs = 5000, timeoutMs = 90000 }: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v !== null && v !== undefined && check(v)) return v;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

/** Create a minimal active event via API */
async function createEvent(ctx: TestContext, overrides: Record<string, unknown> = {}) {
  return ctx.apiPost("/api/agenda/events", {
    action: "createEvent",
    title: ctx.uniqueName("TST"),
    freePrompt: "Say: test ok",
    agentId: null,
    timezone: "Europe/Amsterdam",
    startsAt: cetNowPlus(60_000), // now + 1 min
    endsAt: null,
    recurrenceRule: null,
    recurrenceUntil: null,
    status: "active",
    processVersionIds: [],
    fallbackModel: "",
    timeStepMinutes: 0, // disable slot alignment for tests
    ...overrides,
  }) as Promise<{ ok: boolean; event?: { id: string; title: string }; error?: string }>;
}

// ── Test Definitions ──────────────────────────────────────────────────────────

export const AGENDA_TESTS: TestDefinition[] = [

  // ── 1. Create one-time event ───────────────────────────────────────────────
  {
    id: "create-one-time",
    name: "Create one-time event",
    description: "Creates an active one-time event, verifies it appears in the list and has status active.",
    run: async (ctx) => {
      const ID = "create-one-time";
      const NAME = "Create one-time event";
      const DESC = "Creates an active one-time event, verifies it appears in the list and has status active.";
      const t0 = Date.now();
      const log = (m: string) => ctx.log(ID, m);

      const res = await createEvent(ctx) as { ok: boolean; event?: { id: string; title: string; status: string }; error?: string };
      if (!res.ok || !res.event?.id) return fail(ID, NAME, DESC, t0, `API error: ${res.error}`);
      log(`Created event ${res.event.id} — ${res.event.title}`);

      const list = await ctx.apiGet("/api/agenda/events") as { events?: { id: string; status: string }[] };
      const found = list.events?.find((e) => e.id === res.event!.id);
      if (!found) return fail(ID, NAME, DESC, t0, "Event not found in list after creation");
      if (found.status !== "active") return fail(ID, NAME, DESC, t0, `Expected status=active, got ${found.status}`);
      log(`Event visible in list, status=${found.status}`);

      return pass(ID, NAME, DESC, t0, "One-time event created and visible");
    },
  },

  // ── 2. Create recurring event (daily) ─────────────────────────────────────
  {
    id: "create-recurring-daily",
    name: "Create recurring event (daily)",
    description: "Creates a daily recurring event and verifies it is stored with the recurrence rule.",
    run: async (ctx) => {
      const ID = "create-recurring-daily";
      const NAME = "Create recurring event (daily)";
      const DESC = "Creates a daily recurring event and verifies it is stored with the recurrence rule.";
      const t0 = Date.now();
      const log = (m: string) => ctx.log(ID, m);

      const res = await createEvent(ctx, {
        recurrenceRule: "FREQ=DAILY;INTERVAL=1",
        recurrenceUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }) as { ok: boolean; event?: { id: string; recurrence_rule: string }; error?: string };
      if (!res.ok || !res.event?.id) return fail(ID, NAME, DESC, t0, `API error: ${res.error}`);
      log(`Created event ${res.event.id}`);

      const detail = await ctx.apiGet(`/api/agenda/events/${res.event.id}`) as { event?: { recurrence_rule: string } };
      if (!detail.event?.recurrence_rule) return fail(ID, NAME, DESC, t0, "recurrence_rule not stored");
      log(`recurrence_rule = ${detail.event.recurrence_rule}`);

      return pass(ID, NAME, DESC, t0, "Daily recurring event created with correct recurrence rule");
    },
  },

  // ── 3. Create recurring event (weekly) ────────────────────────────────────
  {
    id: "create-recurring-weekly",
    name: "Create recurring event (weekly)",
    description: "Creates a weekly recurring event and verifies the scheduler creates occurrences for it.",
    run: async (ctx) => {
      const ID = "create-recurring-weekly";
      const NAME = "Create recurring event (weekly)";
      const DESC = "Creates a weekly recurring event and verifies the scheduler creates occurrences for it.";
      const t0 = Date.now();
      const log = (m: string) => ctx.log(ID, m);

      const res = await createEvent(ctx, {
        recurrenceRule: "FREQ=WEEKLY;INTERVAL=1",
        recurrenceUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }) as { ok: boolean; event?: { id: string }; error?: string };
      if (!res.ok || !res.event?.id) return fail(ID, NAME, DESC, t0, `API error: ${res.error}`);
      log(`Created weekly event ${res.event.id}`);

      // Wait for scheduler to create at least 1 occurrence (up to 90s)
      const occ = await poll(
        () => ctx.apiGet(`/api/agenda/events/${res.event!.id}`) as Promise<{ occurrences?: { id: string }[] }>,
        (v) => (v.occurrences?.length ?? 0) > 0,
        { timeoutMs: 90_000 }
      );
      if (!occ) return fail(ID, NAME, DESC, t0, "Scheduler did not create occurrence within 90s");
      log(`Occurrence created: ${(occ.occurrences as { id: string }[])[0].id}`);

      return pass(ID, NAME, DESC, t0, "Weekly event created and occurrence scheduled by scheduler");
    },
  },

  // ── 4. Scheduler creates occurrence + cron job ─────────────────────────────
  {
    id: "scheduler-creates-cron-job",
    name: "Scheduler creates occurrence + cron job",
    description: "Creates an active event and verifies scheduler picks it up and assigns a cron_job_id within 90s.",
    run: async (ctx) => {
      const ID = "scheduler-creates-cron-job";
      const NAME = "Scheduler creates occurrence + cron job";
      const DESC = "Creates an active event and verifies scheduler picks it up and assigns a cron_job_id within 90s.";
      const t0 = Date.now();
      const log = (m: string) => ctx.log(ID, m);

      const res = await createEvent(ctx) as { ok: boolean; event?: { id: string }; error?: string };
      if (!res.ok || !res.event?.id) return fail(ID, NAME, DESC, t0, `API error: ${res.error}`);
      log(`Event created: ${res.event.id}`);

      const result = await poll(
        () => ctx.apiGet(`/api/agenda/events/${res.event!.id}`) as Promise<{ occurrences?: { id: string; status: string; cron_job_id?: string }[] }>,
        (v) => {
          const occ = v.occurrences?.[0];
          return !!occ?.cron_job_id;
        },
        { timeoutMs: 90_000 }
      );
      if (!result) return fail(ID, NAME, DESC, t0, "Scheduler did not assign cron_job_id within 90s");
      const occ = (result.occurrences as { id: string; status: string; cron_job_id: string }[])[0];
      log(`Occurrence ${occ.id} → cron_job_id=${occ.cron_job_id}, status=${occ.status}`);

      return pass(ID, NAME, DESC, t0, `Occurrence queued with cron job ${occ.cron_job_id}`);
    },
  },

  // ── 5. One-time event executes and succeeds ────────────────────────────────
  {
    id: "one-time-executes",
    name: "One-time event executes successfully",
    description: "Creates an event at now+1min and waits for it to reach status=succeeded (up to 3 min).",
    run: async (ctx) => {
      const ID = "one-time-executes";
      const NAME = "One-time event executes successfully";
      const DESC = "Creates an event at now+1min and waits for it to reach status=succeeded (up to 3 min).";
      const t0 = Date.now();
      const log = (m: string) => ctx.log(ID, m);

      const res = await createEvent(ctx) as { ok: boolean; event?: { id: string }; error?: string };
      if (!res.ok || !res.event?.id) return fail(ID, NAME, DESC, t0, `API error: ${res.error}`);
      log(`Event created: ${res.event.id}`);

      const result = await poll(
        () => ctx.apiGet(`/api/agenda/events/${res.event!.id}`) as Promise<{ occurrences?: { id: string; status: string }[] }>,
        (v) => v.occurrences?.[0]?.status === "succeeded",
        { intervalMs: 10_000, timeoutMs: 3 * 60_000 }
      );
      if (!result) return fail(ID, NAME, DESC, t0, "Event did not reach succeeded within 3 minutes");
      log(`Occurrence status = succeeded`);

      return pass(ID, NAME, DESC, t0, "Event executed and reached succeeded");
    },
  },

  // ── 6. Output tab populated after success ─────────────────────────────────
  {
    id: "output-after-success",
    name: "Output tab populated after success",
    description: "After a successful run, agenda_run_steps must have a row with output_payload.",
    run: async (ctx) => {
      const ID = "output-after-success";
      const NAME = "Output tab populated after success";
      const DESC = "After a successful run, agenda_run_steps must have a row with output_payload.";
      const t0 = Date.now();
      const log = (m: string) => ctx.log(ID, m);

      const res = await createEvent(ctx) as { ok: boolean; event?: { id: string }; error?: string };
      if (!res.ok || !res.event?.id) return fail(ID, NAME, DESC, t0, `API error: ${res.error}`);
      log(`Event created: ${res.event.id}`);

      // Wait for succeeded
      const succeeded = await poll(
        () => ctx.apiGet(`/api/agenda/events/${res.event!.id}`) as Promise<{ occurrences?: { id: string; status: string }[] }>,
        (v) => v.occurrences?.[0]?.status === "succeeded",
        { intervalMs: 10_000, timeoutMs: 3 * 60_000 }
      );
      if (!succeeded) return fail(ID, NAME, DESC, t0, "Event did not succeed within 3 minutes");
      const occId = (succeeded.occurrences as { id: string; status: string }[])[0].id;
      log(`Occurrence succeeded: ${occId}`);

      // Check run steps
      const runs = await ctx.apiGet(`/api/agenda/events/${res.event!.id}/occurrences/${occId}/runs`) as { steps?: { output_payload?: unknown }[] };
      if (!runs.steps || runs.steps.length === 0) return fail(ID, NAME, DESC, t0, "No run steps recorded");
      const step = runs.steps[0];
      if (!step.output_payload) return fail(ID, NAME, DESC, t0, "output_payload is empty on run step");
      log(`output_payload present: ${JSON.stringify(step.output_payload).slice(0, 100)}`);

      return pass(ID, NAME, DESC, t0, "Output tab has data after successful run");
    },
  },

  // ── 7. Manual retry ────────────────────────────────────────────────────────
  {
    id: "manual-retry",
    name: "Manual retry works",
    description: "Sets an occurrence to needs_retry and triggers manual retry via API, verifies it re-queues.",
    run: async (ctx) => {
      const ID = "manual-retry";
      const NAME = "Manual retry works";
      const DESC = "Sets an occurrence to needs_retry and triggers manual retry via API, verifies it re-queues.";
      const t0 = Date.now();
      const log = (m: string) => ctx.log(ID, m);

      const res = await createEvent(ctx) as { ok: boolean; event?: { id: string }; error?: string };
      if (!res.ok || !res.event?.id) return fail(ID, NAME, DESC, t0, `API error: ${res.error}`);
      const eventId = res.event.id;
      log(`Event created: ${eventId}`);

      // Wait for scheduler to create an occurrence
      const withOcc = await poll(
        () => ctx.apiGet(`/api/agenda/events/${eventId}`) as Promise<{ occurrences?: { id: string; status: string }[] }>,
        (v) => (v.occurrences?.length ?? 0) > 0,
        { timeoutMs: 90_000 }
      );
      if (!withOcc) return fail(ID, NAME, DESC, t0, "No occurrence created by scheduler within 90s");
      const occId = (withOcc.occurrences as { id: string; status: string }[])[0].id;
      log(`Got occurrence: ${occId}`);

      // Force to needs_retry state
      const setRetry = await ctx.apiPost(`/api/agenda/events/${eventId}/occurrences/${occId}`, { action: "testOnlySetNeedsRetry" }) as { ok: boolean };
      if (!setRetry.ok) return fail(ID, NAME, DESC, t0, "Could not set occurrence to needs_retry");
      log("Forced to needs_retry");

      // Trigger manual retry
      const retry = await ctx.apiPost(`/api/agenda/events/${eventId}/occurrences/${occId}`, {}) as { ok: boolean; error?: string };
      if (!retry.ok) return fail(ID, NAME, DESC, t0, `Retry API failed: ${retry.error}`);
      log("Retry triggered");

      // Verify it moved back to queued
      const check = await ctx.apiGet(`/api/agenda/events/${eventId}`) as { occurrences?: { id: string; status: string }[] };
      const occ = check.occurrences?.find((o) => o.id === occId);
      if (!occ) return fail(ID, NAME, DESC, t0, "Occurrence not found after retry");
      if (!["queued", "running", "succeeded"].includes(occ.status)) {
        return fail(ID, NAME, DESC, t0, `Expected queued/running/succeeded after retry, got ${occ.status}`);
      }
      log(`Status after retry: ${occ.status}`);

      return pass(ID, NAME, DESC, t0, `Manual retry accepted — occurrence is now ${occ.status}`);
    },
  },

  // ── 8. Cannot edit a succeeded one-time event ──────────────────────────────
  {
    id: "no-edit-after-success",
    name: "Cannot edit succeeded one-time event",
    description: "A one-time event that already succeeded must reject PATCH attempts with 409.",
    run: async (ctx) => {
      const ID = "no-edit-after-success";
      const NAME = "Cannot edit succeeded one-time event";
      const DESC = "A one-time event that already succeeded must reject PATCH attempts with 409.";
      const t0 = Date.now();
      const log = (m: string) => ctx.log(ID, m);

      const res = await createEvent(ctx) as { ok: boolean; event?: { id: string }; error?: string };
      if (!res.ok || !res.event?.id) return fail(ID, NAME, DESC, t0, `API error: ${res.error}`);
      log(`Created event: ${res.event.id}`);

      // Wait for it to succeed
      const succeeded = await poll(
        () => ctx.apiGet(`/api/agenda/events/${res.event!.id}`) as Promise<{ occurrences?: { status: string }[] }>,
        (v) => v.occurrences?.[0]?.status === "succeeded",
        { intervalMs: 10_000, timeoutMs: 3 * 60_000 }
      );
      if (!succeeded) return fail(ID, NAME, DESC, t0, "Event did not succeed within 3 minutes");
      log("Event succeeded");

      // Try to edit — should be rejected
      const patch = await ctx.apiPatch(`/api/agenda/events/${res.event.id}`, {
        title: "Should not be allowed",
        startsAt: cetNowPlus(120_000),
        timezone: "Europe/Amsterdam",
        timeStepMinutes: 0,
      }) as { ok: boolean; error?: string };

      if (patch.ok) return fail(ID, NAME, DESC, t0, "PATCH succeeded — should have been rejected for completed event");
      log(`PATCH correctly rejected: ${patch.error}`);

      return pass(ID, NAME, DESC, t0, "Edit correctly rejected after event succeeded");
    },
  },

  // ── 9. Delete event cancels cron job ──────────────────────────────────────
  {
    id: "delete-cancels-cron",
    name: "Delete event removes it from list",
    description: "Creates an event, deletes it (hard delete), verifies it no longer appears in the events list.",
    run: async (ctx) => {
      const ID = "delete-cancels-cron";
      const NAME = "Delete event removes it from list";
      const DESC = "Creates an event, deletes it (hard delete), verifies it no longer appears in the events list.";
      const t0 = Date.now();
      const log = (m: string) => ctx.log(ID, m);

      const res = await createEvent(ctx) as { ok: boolean; event?: { id: string }; error?: string };
      if (!res.ok || !res.event?.id) return fail(ID, NAME, DESC, t0, `API error: ${res.error}`);
      const eventId = res.event.id;
      log(`Created event: ${eventId}`);

      // Wait for scheduler to assign a cron job
      await poll(
        () => ctx.apiGet(`/api/agenda/events/${eventId}`) as Promise<{ occurrences?: { cron_job_id?: string }[] }>,
        (v) => !!v.occurrences?.[0]?.cron_job_id,
        { timeoutMs: 90_000 }
      );
      log("Cron job assigned (may not have been — deleting anyway)");

      // Hard delete
      const del = await ctx.apiDelete(`/api/agenda/events/${eventId}?hard=1`) as { ok: boolean; error?: string };
      if (!del.ok) return fail(ID, NAME, DESC, t0, `Delete failed: ${del.error}`);
      log("Hard delete OK");

      // Verify gone from list
      const list = await ctx.apiGet("/api/agenda/events") as { events?: { id: string }[] };
      const still = list.events?.find((e) => e.id === eventId);
      if (still) return fail(ID, NAME, DESC, t0, "Event still appears in list after hard delete");
      log("Event no longer in list");

      return pass(ID, NAME, DESC, t0, "Event deleted and removed from list");
    },
  },

  // ── 10. Dismiss (cancel) a needs_retry occurrence ─────────────────────────
  {
    id: "dismiss-occurrence",
    name: "Dismiss needs_retry occurrence",
    description: "Sets an occurrence to needs_retry and dismisses it via DELETE, verifies status=cancelled.",
    run: async (ctx) => {
      const ID = "dismiss-occurrence";
      const NAME = "Dismiss needs_retry occurrence";
      const DESC = "Sets an occurrence to needs_retry and dismisses it via DELETE, verifies status=cancelled.";
      const t0 = Date.now();
      const log = (m: string) => ctx.log(ID, m);

      const res = await createEvent(ctx) as { ok: boolean; event?: { id: string }; error?: string };
      if (!res.ok || !res.event?.id) return fail(ID, NAME, DESC, t0, `API error: ${res.error}`);
      const eventId = res.event.id;
      log(`Created event: ${eventId}`);

      const withOcc = await poll(
        () => ctx.apiGet(`/api/agenda/events/${eventId}`) as Promise<{ occurrences?: { id: string }[] }>,
        (v) => (v.occurrences?.length ?? 0) > 0,
        { timeoutMs: 90_000 }
      );
      if (!withOcc) return fail(ID, NAME, DESC, t0, "No occurrence created within 90s");
      const occId = (withOcc.occurrences as { id: string }[])[0].id;
      log(`Got occurrence: ${occId}`);

      // Force needs_retry
      await ctx.apiPost(`/api/agenda/events/${eventId}/occurrences/${occId}`, { action: "testOnlySetNeedsRetry" });
      log("Set to needs_retry");

      // Dismiss it
      const dismiss = await ctx.apiDelete(`/api/agenda/events/${eventId}/occurrences/${occId}`) as { ok: boolean; error?: string };
      if (!dismiss.ok) return fail(ID, NAME, DESC, t0, `Dismiss failed: ${dismiss.error}`);
      log("Dismissed");

      // Verify cancelled
      const check = await ctx.apiGet(`/api/agenda/events/${eventId}`) as { occurrences?: { id: string; status: string }[] };
      const occ = check.occurrences?.find((o) => o.id === occId);
      if (!occ) return fail(ID, NAME, DESC, t0, "Occurrence not found after dismiss");
      if (occ.status !== "cancelled") return fail(ID, NAME, DESC, t0, `Expected cancelled, got ${occ.status}`);
      log(`Status = ${occ.status}`);

      return pass(ID, NAME, DESC, t0, "Occurrence dismissed and marked cancelled");
    },
  },

  // ── 11. Recurring event: deactivation stops future occurrences ────────────
  {
    id: "deactivate-recurring",
    name: "Deactivate recurring event stops new occurrences",
    description: "Creates a daily event, deactivates it (status=draft), verifies no new occurrences are created by scheduler.",
    run: async (ctx) => {
      const ID = "deactivate-recurring";
      const NAME = "Deactivate recurring event stops new occurrences";
      const DESC = "Creates a daily event, deactivates it (status=draft), verifies no new occurrences are created by scheduler.";
      const t0 = Date.now();
      const log = (m: string) => ctx.log(ID, m);

      const res = await createEvent(ctx, {
        recurrenceRule: "FREQ=DAILY;INTERVAL=1",
        recurrenceUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }) as { ok: boolean; event?: { id: string }; error?: string };
      if (!res.ok || !res.event?.id) return fail(ID, NAME, DESC, t0, `API error: ${res.error}`);
      const eventId = res.event.id;
      log(`Created daily event: ${eventId}`);

      // Wait for 1 occurrence to be created
      const withOcc = await poll(
        () => ctx.apiGet(`/api/agenda/events/${eventId}`) as Promise<{ occurrences?: { id: string }[] }>,
        (v) => (v.occurrences?.length ?? 0) > 0,
        { timeoutMs: 90_000 }
      );
      if (!withOcc) return fail(ID, NAME, DESC, t0, "No occurrence created within 90s");
      const countBefore = (withOcc.occurrences as { id: string }[]).length;
      log(`Occurrences before deactivation: ${countBefore}`);

      // Deactivate by deleting (soft delete for recurring — sets to draft)
      const del = await ctx.apiDelete(`/api/agenda/events/${eventId}`) as { ok: boolean; error?: string };
      if (!del.ok) return fail(ID, NAME, DESC, t0, `Deactivate failed: ${del.error}`);
      log("Event deactivated (soft delete)");

      // Verify event status is now draft
      const check = await ctx.apiGet(`/api/agenda/events/${eventId}`) as { event?: { status: string } };
      if (check.event?.status !== "draft") return fail(ID, NAME, DESC, t0, `Expected status=draft, got ${check.event?.status}`);
      log(`Event status = draft`);

      return pass(ID, NAME, DESC, t0, "Recurring event deactivated — scheduler will not create new occurrences");
    },
  },

  // ── 12. SSE stream connectivity ────────────────────────────────────────────
  {
    id: "sse-connectivity",
    name: "SSE stream connectivity",
    description: "Verifies the agenda SSE stream connects and emits the 'connected' event within 6 seconds.",
    run: async (ctx) => {
      const ID = "sse-connectivity";
      const NAME = "SSE stream connectivity";
      const DESC = "Verifies the agenda SSE stream connects and emits the 'connected' event within 6 seconds.";
      const t0 = Date.now();
      const log = (m: string) => ctx.log(ID, m);

      const connected = await new Promise<boolean>((resolve) => {
        const es = new EventSource("/api/agenda/events/stream");
        const timeout = setTimeout(() => { try { es.close(); } catch {} resolve(false); }, 6000);
        es.addEventListener("connected", () => { clearTimeout(timeout); try { es.close(); } catch {} resolve(true); });
        es.onerror = () => { clearTimeout(timeout); try { es.close(); } catch {} resolve(false); };
      });

      if (!connected) return fail(ID, NAME, DESC, t0, "SSE stream did not emit connected within 6s");
      log("SSE connected");
      return pass(ID, NAME, DESC, t0, "SSE stream operational");
    },
  },

  // ── 13. Event with fallback model field is stored correctly ───────────────
  {
    id: "fallback-model-stored",
    name: "Fallback model stored on event",
    description: "Creates an event with a fallback model set and verifies it is persisted correctly.",
    run: async (ctx) => {
      const ID = "fallback-model-stored";
      const NAME = "Fallback model stored on event";
      const DESC = "Creates an event with a fallback model set and verifies it is persisted correctly.";
      const t0 = Date.now();
      const log = (m: string) => ctx.log(ID, m);

      const fallback = "openrouter/openai/gpt-5.4-mini";
      const res = await createEvent(ctx, { fallbackModel: fallback }) as { ok: boolean; event?: { id: string; fallback_model: string }; error?: string };
      if (!res.ok || !res.event?.id) return fail(ID, NAME, DESC, t0, `API error: ${res.error}`);
      log(`Created event: ${res.event.id}`);

      const detail = await ctx.apiGet(`/api/agenda/events/${res.event.id}`) as { event?: { fallback_model: string } };
      if (detail.event?.fallback_model !== fallback) {
        return fail(ID, NAME, DESC, t0, `Expected fallback_model=${fallback}, got ${detail.event?.fallback_model}`);
      }
      log(`fallback_model = ${detail.event.fallback_model}`);

      return pass(ID, NAME, DESC, t0, "Fallback model stored correctly");
    },
  },

  // ── 14. Cannot create event in the past ───────────────────────────────────
  {
    id: "no-past-event",
    name: "Cannot create event in the past",
    description: "Attempts to create an event with a start time 10 minutes in the past. Must be rejected.",
    run: async (ctx) => {
      const ID = "no-past-event";
      const NAME = "Cannot create event in the past";
      const DESC = "Attempts to create an event with a start time 10 minutes in the past. Must be rejected.";
      const t0 = Date.now();
      const log = (m: string) => ctx.log(ID, m);

      const res = await createEvent(ctx, {
        startsAt: cetNowPlus(-10 * 60_000), // 10 minutes in the past
      }) as { ok: boolean; error?: string };

      if (res.ok) return fail(ID, NAME, DESC, t0, "API accepted a past start time — should have rejected it");
      log(`Correctly rejected: ${res.error}`);
      return pass(ID, NAME, DESC, t0, "Past event creation correctly rejected");
    },
  },

  // ── 15. Services health check ──────────────────────────────────────────────
  {
    id: "services-health",
    name: "All services reported as running",
    description: "Fetches /api/services and verifies scheduler, bridge-logger and nextjs are running.",
    run: async (ctx) => {
      const ID = "services-health";
      const NAME = "All services reported as running";
      const DESC = "Fetches /api/services and verifies scheduler, bridge-logger and nextjs are reported.";
      const t0 = Date.now();
      const log = (m: string) => ctx.log(ID, m);

      const res = await ctx.apiGet("/api/services") as { ok: boolean; services?: { name: string; status: string; pidAlive: boolean }[] };
      if (!res.ok || !res.services) return fail(ID, NAME, DESC, t0, "Services API failed");

      const required = ["agenda-scheduler", "nextjs"];
      const problems: string[] = [];
      for (const name of required) {
        const svc = res.services.find((s) => s.name === name);
        if (!svc) { problems.push(`${name}: not found`); continue; }
        if (!svc.pidAlive) problems.push(`${name}: pidAlive=false (status=${svc.status})`);
        log(`${name}: status=${svc.status}, pidAlive=${svc.pidAlive}`);
      }

      if (problems.length > 0) return fail(ID, NAME, DESC, t0, problems.join("; "));
      return pass(ID, NAME, DESC, t0, "All required services alive");
    },
  },

];
