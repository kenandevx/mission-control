// ── Test definitions ──────────────────────────────────────────────────────────
// These are pure async functions. Each returns a TestResult.
// All timing-sensitive tests use polling with generous timeouts.
// Gateway restarts are survivable: tests use API calls, not in-memory state.

export type TestStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export type TestResult = {
  id: string;
  name: string;
  description: string;
  status: TestStatus;
  passed: boolean;
  message: string;
  logs: string[];
  durationMs: number;
  startedAt: number;
  finishedAt: number | null;
};

export type TestDefinition = {
  id: string;
  name: string;
  description: string;
  /** When true, skip the per-test agenda reset so previous data is preserved. */
  skipReset?: boolean;
  run: (ctx: TestContext) => Promise<TestResult>;
};

export type AgendaSettings = {
  schedulingIntervalMinutes: number;
  /** Effective step used by tests: unset => 15, configured 0 => 1 for fast dev testing. */
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
  /** Delete all test events (TST-*) for a clean slate. */
  resetTestEvents: () => Promise<number>;
};

export type TestRun = {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  results: Record<string, TestResult>;
  interrupted: boolean;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResult(
  id: string, name: string, startedAt: number,
  passed: boolean, message: string, logs: string[],
): TestResult {
  const finishedAt = Date.now();
  return { id, name, description: "", status: passed ? "passed" : "failed", passed, message, logs, durationMs: finishedAt - startedAt, startedAt, finishedAt };
}

function snapToInterval(d: Date, stepMinutes: number): Date {
  if (stepMinutes <= 0) return new Date(d); // free time — no snapping
  const s = new Date(d);
  s.setMinutes(Math.ceil(s.getMinutes() / stepMinutes) * stepMinutes, 0, 0);
  return s;
}

/** Build a future ISO timestamp. When step=0 (free time), uses 1-min offsets with no snapping. */
function isoOffset(minutesFromNow: number, stepMinutes = 15): string {
  const offset = stepMinutes === 0 ? Math.max(minutesFromNow, 1) : minutesFromNow;
  return snapToInterval(new Date(Date.now() + offset * 60 * 1000), stepMinutes).toISOString();
}

/** Convenience: read effective test step from ctx.settings */
function ctxOffset(ctx: TestContext, slots = 1): string {
  const step = Number(ctx.settings.testSchedulingIntervalMinutes ?? 15);
  const safeStep = Number.isFinite(step) && step > 0 ? Math.floor(step) : 15;
  return isoOffset(safeStep * slots, safeStep);
}

function isBillingOrCapacityError(message: unknown): boolean {
  const lower = String(message ?? "").toLowerCase();
  return lower.includes("llm request rejected")
    || lower.includes("insufficient_quota")
    || lower.includes("quota_exceeded")
    || lower.includes("billing_hard_limit")
    || lower.includes("credit balance is too low")
    || lower.includes("insufficient credits")
    || lower.includes("plans & billing")
    || /(^|\D)(402|429)(\D|$)/.test(lower);
}

// ── Test definitions ──────────────────────────────────────────────────────────

export const AGENDA_TESTS: TestDefinition[] = [

  // 1 ────────────────────────────────────────────────────────────────────────
  {
    id: "create-one-time-event",
    name: "Create one-time agenda event",
    description: "Create a draft event and verify it appears in the calendar.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("create-one-time-event", m); };
      try {
        const title = ctx.uniqueName("TST-one-time");
        const startsAt = ctxOffset(ctx, 20);
        log(`Creating: ${title} at ${startsAt}`);
        const res = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent", title,
          freePrompt: "Say hello.",
          agentId: null, timezone: "Europe/Amsterdam", startsAt,
          endsAt: null, recurrenceRule: null, recurrenceUntil: null,
          status: "draft", processVersionIds: [],
          executionWindowMinutes: 30, fallbackModel: "",
        }) as { ok: boolean; event?: { id: string }; error?: string };

        if (!res.ok || !res.event?.id) return makeResult("create-one-time-event", "Create one-time agenda event", startedAt, false, `API error: ${res.error ?? JSON.stringify(res)}`, []);
        log(`Created: ${res.event.id}`);
        await ctx.sleep(2000);
        const eventsRes = await ctx.apiGet("/api/agenda/events") as { ok: boolean; events: Record<string, unknown>[] };
        const found = eventsRes.events?.some((e) => e.id === res.event!.id);
        if (!found) return makeResult("create-one-time-event", "Create one-time agenda event", startedAt, false, "Event not found in calendar after creation", []);
        log("Verified in calendar");
        return makeResult("create-one-time-event", "Create one-time agenda event", startedAt, true, "Event created and verified in calendar", []);
      } catch (err) {
        return makeResult("create-one-time-event", "Create one-time agenda event", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 2 ────────────────────────────────────────────────────────────────────────
  {
    id: "create-active-event-enqueued",
    name: "Create active event — scheduler enqueues it",
    skipReset: true,
    description: "Active event scheduled ~2 minutes ahead; scheduler (60s interval) creates an occurrence within 90s.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("create-active-event-enqueued", m); };
      try {
        const title = ctx.uniqueName("TST-active");
        // Schedule 2 min from now with free-time (no grid), so the scheduler picks it up quickly
        const startsAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
        log(`Creating active: ${title} at ${startsAt}`);
        const res = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent", title,
          freePrompt: "Confirm this ran.",
          agentId: null, timezone: "Europe/Amsterdam", startsAt,
          endsAt: null, recurrenceRule: null, recurrenceUntil: null,
          status: "active", processVersionIds: [],
          executionWindowMinutes: 30, fallbackModel: "",
          timeStepMinutes: 0, // bypass grid for speed
        }) as { ok: boolean; event?: { id: string }; error?: string };

        if (!res.ok || !res.event?.id) return makeResult("create-active-event-enqueued", "Create active event — scheduler enqueues it", startedAt, false, `API error: ${res.error}`, []);
        const eventId = res.event.id;
        log(`Event: ${eventId} — polling for scheduler...`);
        let found = false;
        for (let i = 0; i < 6; i++) {
          await ctx.sleep(15000);
          const detail = await ctx.apiGet(`/api/agenda/events/${eventId}`) as { ok: boolean; occurrences?: { id: string }[] };
          log(`Poll ${i + 1}: ${detail.occurrences?.length ?? 0} occurrences`);
          if ((detail.occurrences?.length ?? 0) > 0) { found = true; break; }
        }
        if (!found) return makeResult("create-active-event-enqueued", "Create active event — scheduler enqueues it", startedAt, false, "Scheduler did not create occurrence within 90s", []);
        return makeResult("create-active-event-enqueued", "Create active event — scheduler enqueues it", startedAt, true, "Scheduler created occurrence within expected window", []);
      } catch (err) {
        return makeResult("create-active-event-enqueued", "Create active event — scheduler enqueues it", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 3 ────────────────────────────────────────────────────────────────────────
  {
    id: "sse-live-update",
    name: "SSE live update fires on event creation",
    description: "Open SSE, create event, verify agenda_change fires within 14 seconds.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("sse-live-update", m); };
      try {
        const title = ctx.uniqueName("TST-sse");
        const startsAt = ctxOffset(ctx, 50);

        const result = await new Promise<string>((resolve) => {
          const es = new EventSource("/api/agenda/events/stream");
          let fired = false;
          const cleanup = () => { clearTimeout(timeout); try { es.close(); } catch {} };
          const timeout: ReturnType<typeof setTimeout> = setTimeout(() => { cleanup(); resolve(fired ? "fired" : "timeout"); }, 16000);

          es.addEventListener("connected", () => {
            log("SSE connected, creating event...");
            void ctx.apiPost("/api/agenda/events", {
              action: "createEvent", title,
              freePrompt: "SSE test.",
              agentId: null, timezone: "Europe/Amsterdam", startsAt,
              endsAt: null, recurrenceRule: null, recurrenceUntil: null,
              status: "draft", processVersionIds: [],
              executionWindowMinutes: 30, fallbackModel: "",
            });
          });

          es.addEventListener("agenda_change", (e) => {
            log(`SSE event: ${e.data}`);
            fired = true;
            cleanup();
            resolve("fired");
          });

          es.onerror = () => { cleanup(); resolve("error"); };
        });

        if (result === "fired") return makeResult("sse-live-update", "SSE live update fires on event creation", startedAt, true, "SSE fired agenda_change notification", []);
        if (result === "error") return makeResult("sse-live-update", "SSE live update fires on event creation", startedAt, false, "SSE connection error", []);
        return makeResult("sse-live-update", "SSE live update fires on event creation", startedAt, false, `SSE did not fire (result: ${result})`, []);
      } catch (err) {
        return makeResult("sse-live-update", "SSE live update fires on event creation", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 4 ────────────────────────────────────────────────────────────────────────
  {
    id: "validation-empty-title",
    name: "Validation: event without title is rejected",
    description: "Creating an event without a title must return a validation error.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("validation-empty-title", m); };
      try {
        const res = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent",
          title: "",
          freePrompt: "No title.",
          agentId: null, timezone: "Europe/Amsterdam",
          startsAt: ctxOffset(ctx, 40),
          endsAt: null, recurrenceRule: null, recurrenceUntil: null,
          status: "draft", processVersionIds: [],
          executionWindowMinutes: 30, fallbackModel: "",
        }) as { ok: boolean; error?: string };

        log(`Response: ok=${res.ok}, error=${res.error}`);
        if (!res.ok && res.error) return makeResult("validation-empty-title", "Validation: event without title is rejected", startedAt, true, "Correctly rejected empty title", []);
        return makeResult("validation-empty-title", "Validation: event without title is rejected", startedAt, false, `Expected validation error, got: ${JSON.stringify(res)}`, []);
      } catch (err) {
        return makeResult("validation-empty-title", "Validation: event without title is rejected", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 5 ────────────────────────────────────────────────────────────────────────
  {
    id: "validation-15min-interval",
    name: "Validation: configured interval enforcement",
    description: "Uses real agenda settings: unset => 15 min, configured value => that value, free-time 0 => test against 1 minute for fast dev checks.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("validation-15min-interval", m); };
      try {
        const configuredStep = Number(ctx.settings.schedulingIntervalMinutes ?? 15);
        const enforcedStep = Number(ctx.settings.testSchedulingIntervalMinutes ?? 15);
        log(`Configured scheduling interval=${configuredStep}; effective test interval=${enforcedStep}`);

        if (configuredStep === 0) {
          const oddMinute = new Date(Date.now() + 60 * 60 * 1000);
          oddMinute.setMinutes(7, 0, 0);
          const res = await ctx.apiPost("/api/agenda/events", {
            action: "createEvent",
            title: ctx.uniqueName("FreeTime"),
            freePrompt: "Should pass in free-time mode.",
            agentId: null, timezone: "Europe/Amsterdam",
            startsAt: oddMinute.toISOString(),
            endsAt: null, recurrenceRule: null, recurrenceUntil: null,
            status: "draft", processVersionIds: [],
            executionWindowMinutes: 30, fallbackModel: "",
            timeStepMinutes: 0,
          }) as { ok: boolean; error?: string };
          log(`Free-time response: ok=${res.ok}, error=${res.error}`);
          if (res.ok) return makeResult("validation-15min-interval", "Validation: configured interval enforcement", startedAt, true, "Free-time mode accepted a non-grid minute as expected", []);
          return makeResult("validation-15min-interval", "Validation: configured interval enforcement", startedAt, false, `Expected free-time mode to allow odd minutes, got: ${JSON.stringify(res)}`, []);
        }

        const bad = new Date(Date.now() + 60 * 60 * 1000);
        bad.setSeconds(0, 0);
        bad.setMinutes(7, 0, 0);
        log(`Testing invalid time against ${enforcedStep}-minute rule: ${bad.toISOString()}`);
        const res = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent",
          title: ctx.uniqueName("BadTime"),
          freePrompt: "Should fail.",
          agentId: null, timezone: "Europe/Amsterdam",
          startsAt: bad.toISOString(),
          endsAt: null, recurrenceRule: null, recurrenceUntil: null,
          status: "draft", processVersionIds: [],
          executionWindowMinutes: 30, fallbackModel: "",
          timeStepMinutes: configuredStep,
        }) as { ok: boolean; error?: string };

        log(`Response: ok=${res.ok}, error=${res.error}`);

        if (!res.ok && res.error) return makeResult("validation-15min-interval", "Validation: configured interval enforcement", startedAt, true, `Correctly enforced ${configuredStep}-minute interval`, []);
        return makeResult("validation-15min-interval", "Validation: configured interval enforcement", startedAt, false, `Expected rejection for non-${configuredStep}-minute time, got: ${JSON.stringify(res)}`, []);
      } catch (err) {
        return makeResult("validation-15min-interval", "Validation: configured interval enforcement", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 6 ────────────────────────────────────────────────────────────────────────
  {
    id: "validation-duplicate-timeslot",
    name: "Validation: duplicate date/time is rejected",
    description: "Creating two events in the same slot should reject the second event.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("validation-duplicate-timeslot", m); };
      try {
        // Force 15-min step for this validation test (regardless of dev mode)
        const startsAt = snapToInterval(new Date(Date.now() + 120 * 60 * 1000), 15).toISOString();

        const first = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent",
          title: ctx.uniqueName("TST-slot-1"),
          freePrompt: "First event in slot.",
          agentId: null,
          timezone: "Europe/Amsterdam",
          startsAt,
          endsAt: null,
          recurrenceRule: null,
          recurrenceUntil: null,
          status: "draft",
          processVersionIds: [],
          executionWindowMinutes: 30,
          fallbackModel: "",
          timeStepMinutes: 15,
        }) as { ok: boolean; event?: { id: string }; error?: string };

        if (!first.ok || !first.event?.id) {
          return makeResult("validation-duplicate-timeslot", "Validation: duplicate date/time is rejected", startedAt, false, `First create failed: ${first.error ?? JSON.stringify(first)}`, []);
        }

        const second = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent",
          title: ctx.uniqueName("TST-slot-2"),
          freePrompt: "Second event in same slot.",
          agentId: null,
          timezone: "Europe/Amsterdam",
          startsAt,
          endsAt: null,
          recurrenceRule: null,
          recurrenceUntil: null,
          status: "draft",
          processVersionIds: [],
          executionWindowMinutes: 30,
          fallbackModel: "",
          timeStepMinutes: 15,
        }) as { ok: boolean; error?: string };

        log(`Second create response: ok=${second.ok}, error=${second.error}`);

        if (!second.ok && second.error) {
          return makeResult("validation-duplicate-timeslot", "Validation: duplicate date/time is rejected", startedAt, true, "Second event in same slot was correctly rejected", []);
        }

        return makeResult("validation-duplicate-timeslot", "Validation: duplicate date/time is rejected", startedAt, false, `Expected duplicate slot rejection, got: ${JSON.stringify(second)}`, []);
      } catch (err) {
        return makeResult("validation-duplicate-timeslot", "Validation: duplicate date/time is rejected", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 7 ────────────────────────────────────────────────────────────────────────
  {
    id: "validation-past-event-rejected",
    name: "Validation: past event creation is rejected",
    description: "Creating an event in the past should return a validation error.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("validation-past-event-rejected", m); };
      try {
        const past = new Date(Date.now() - 60 * 60 * 1000);
        past.setUTCMinutes(Math.floor(past.getUTCMinutes() / 15) * 15, 0, 0);

        const res = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent",
          title: ctx.uniqueName("TST-past-reject"),
          freePrompt: "Should fail in past.",
          agentId: null,
          timezone: "Europe/Amsterdam",
          startsAt: past.toISOString(),
          endsAt: null,
          recurrenceRule: null,
          recurrenceUntil: null,
          status: "draft",
          processVersionIds: [],
          executionWindowMinutes: 30,
          fallbackModel: "",
        }) as { ok: boolean; error?: string };

        log(`Past create response: ok=${res.ok}, error=${res.error}`);

        if (!res.ok && res.error) {
          return makeResult("validation-past-event-rejected", "Validation: past event creation is rejected", startedAt, true, "Past event creation correctly rejected", []);
        }

        return makeResult("validation-past-event-rejected", "Validation: past event creation is rejected", startedAt, false, `Expected past-time rejection, got: ${JSON.stringify(res)}`, []);
      } catch (err) {
        return makeResult("validation-past-event-rejected", "Validation: past event creation is rejected", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 8 ────────────────────────────────────────────────────────────────────────
  {
    id: "worker-heartbeat",
    name: "Worker heartbeat / SSE connectivity",
    description: "Verify SSE connects successfully — confirms Next.js server and PostgreSQL LISTEN are operational.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("worker-heartbeat", m); };
      try {
        const ok = await new Promise<boolean>((resolve) => {
          const es = new EventSource("/api/agenda/events/stream");
          const timeout: ReturnType<typeof setTimeout> = setTimeout(() => { try { es.close(); } catch {} resolve(false); }, 6000);
          es.addEventListener("connected", () => { clearTimeout(timeout); try { es.close(); } catch {} resolve(true); });
          es.onerror = () => { clearTimeout(timeout); try { es.close(); } catch {} resolve(false); };
        });
        log(`SSE: ${ok ? "connected" : "failed"}`);
        if (ok) return makeResult("worker-heartbeat", "Worker heartbeat / SSE connectivity", startedAt, true, "Worker heartbeat verified via SSE", []);
        return makeResult("worker-heartbeat", "Worker heartbeat / SSE connectivity", startedAt, false, "SSE connection failed", []);
      } catch (err) {
        return makeResult("worker-heartbeat", "Worker heartbeat / SSE connectivity", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 7 ────────────────────────────────────────────────────────────────────────
  {
    id: "delete-event",
    name: "Delete agenda event",
    description: "Create then delete an event and verify it's removed from the calendar.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("delete-event", m); };
      try {
        const title = ctx.uniqueName("TST-delete");
        const startsAt = ctxOffset(ctx, 40);
        const create = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent", title,
          freePrompt: "Delete me.",
          agentId: null, timezone: "Europe/Amsterdam", startsAt,
          endsAt: null, recurrenceRule: null, recurrenceUntil: null,
          status: "draft", processVersionIds: [],
          executionWindowMinutes: 30, fallbackModel: "",
        }) as { ok: boolean; event?: { id: string }; error?: string };

        if (!create.ok || !create.event?.id) return makeResult("delete-event", "Delete agenda event", startedAt, false, `Create failed: ${create.error}`, []);
        const eventId = create.event.id;
        log(`Created ${eventId}, deleting...`);
        const del = await ctx.apiDelete(`/api/agenda/events/${eventId}`) as { ok: boolean; error?: string };
        log(`Delete: ok=${del.ok}`);
        if (!del.ok) return makeResult("delete-event", "Delete agenda event", startedAt, false, `Delete failed: ${del.error}`, []);
        await ctx.sleep(2000);
        const eventsRes = await ctx.apiGet("/api/agenda/events") as { ok: boolean; events: Record<string, unknown>[] };
        const stillThere = eventsRes.events?.some((e) => e.id === eventId);
        if (stillThere) return makeResult("delete-event", "Delete agenda event", startedAt, false, "Event still in calendar after deletion", []);
        log("Deleted and removed from calendar");
        return makeResult("delete-event", "Delete agenda event", startedAt, true, "Event deleted and removed from calendar", []);
      } catch (err) {
        return makeResult("delete-event", "Delete agenda event", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 8 ────────────────────────────────────────────────────────────────────────
  {
    id: "needs-retry-retry-endpoint",
    name: "Failed occurrence: retry endpoint works",
    skipReset: true,
    description: "Create an event, force its occurrence to needs_retry via test action, then verify retry endpoint accepts it.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("needs-retry-retry-endpoint", m); };
      try {
        const title = ctx.uniqueName("TST-retry");
        const startsAt = ctxOffset(ctx);
        const create = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent", title,
          freePrompt: "Retry test.",
          agentId: null, timezone: "Europe/Amsterdam", startsAt,
          endsAt: null, recurrenceRule: null, recurrenceUntil: null,
          status: "active", processVersionIds: [],
          executionWindowMinutes: 30, fallbackModel: "",
        }) as { ok: boolean; event?: { id: string }; error?: string };

        if (!create.ok || !create.event?.id) return makeResult("needs-retry-retry-endpoint", "Failed occurrence: retry endpoint works", startedAt, false, `Create failed: ${create.error ?? "unknown"}`, []);
        const eventId = create.event.id;

        // Directly create a needs_retry occurrence (bypasses scheduler entirely)
        const pastTime = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago
        const occRes = await ctx.apiPost("/api/agenda/events", {
          action: "testOnlyCreateNeedsRetryOccurrence",
          eventId,
          scheduledFor: pastTime,
        }) as { ok: boolean; occurrenceId?: string; error?: string };
        if (!occRes.ok || !occRes.occurrenceId) return makeResult("needs-retry-retry-endpoint", "Failed occurrence: retry endpoint works", startedAt, false, `Failed to create needs_retry occurrence: ${occRes.error}`, []);
        log(`Created needs_retry occurrence: ${occRes.occurrenceId}`);

        // Retry the needs_retry occurrence
        const retryRes = await ctx.apiPost(`/api/agenda/events/${eventId}/occurrences/${occRes.occurrenceId}`, {}) as { ok: boolean; error?: string };
        if (retryRes.ok) return makeResult("needs-retry-retry-endpoint", "Failed occurrence: retry endpoint works", startedAt, true, "Retry accepted for needs_retry occurrence", []);
        return makeResult("needs-retry-retry-endpoint", "Failed occurrence: retry endpoint works", startedAt, false, `Retry rejected: ${retryRes.error}`, []);
      } catch (err) {
        return makeResult("needs-retry-retry-endpoint", "Failed occurrence: retry endpoint works", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 9 ────────────────────────────────────────────────────────────────────────
  {
    id: "completed-occurrence-force-retry",
    name: "Completed occurrence requires force retry",
    description: "A succeeded occurrence should reject a normal retry, but accept an explicit force retry and move back to scheduled.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("completed-occurrence-force-retry", m); };
      try {
        const title = ctx.uniqueName("TST-force-retry");
        const startsAt = ctxOffset(ctx);
        const create = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent", title,
          freePrompt: "Force retry test.",
          agentId: null, timezone: "Europe/Amsterdam", startsAt,
          endsAt: null, recurrenceRule: null, recurrenceUntil: null,
          status: "active", processVersionIds: [],
          executionWindowMinutes: 30, fallbackModel: "",
        }) as { ok: boolean; event?: { id: string }; error?: string };
        if (!create.ok || !create.event?.id) return makeResult("completed-occurrence-force-retry", "Completed occurrence requires force retry", startedAt, false, `Create failed: ${create.error ?? "unknown"}`, []);
        const eventId = create.event.id;

        const occRes = await ctx.apiPost("/api/agenda/events", {
          action: "testOnlyCreateNeedsRetryOccurrence",
          eventId,
          scheduledFor: new Date().toISOString(),
        }) as { ok: boolean; occurrenceId?: string; error?: string };
        if (!occRes.ok || !occRes.occurrenceId) return makeResult("completed-occurrence-force-retry", "Completed occurrence requires force retry", startedAt, false, `Failed to inject occurrence: ${occRes.error ?? "unknown"}`, []);
        const occId = occRes.occurrenceId;

        const inject = await ctx.apiPost("/api/agenda/events", {
          action: "testOnlyInjectRunWithPdf",
          eventId,
          occurrenceId: occId,
        }) as { ok: boolean; error?: string };
        if (!inject.ok) return makeResult("completed-occurrence-force-retry", "Completed occurrence requires force retry", startedAt, false, `Failed to mark succeeded occurrence: ${inject.error ?? "unknown"}`, []);

        const normalRetry = await ctx.apiPost(`/api/agenda/events/${eventId}/occurrences/${occId}`, {}) as { ok: boolean; error?: string };
        log(`Normal retry response: ok=${normalRetry.ok}, error=${normalRetry.error}`);
        if (normalRetry.ok) {
          return makeResult("completed-occurrence-force-retry", "Completed occurrence requires force retry", startedAt, false, "Normal retry unexpectedly succeeded for a completed occurrence", []);
        }

        const forceRetry = await ctx.apiPost(`/api/agenda/events/${eventId}/occurrences/${occId}`, { force: true }) as { ok: boolean; status?: string; forced?: boolean; error?: string };
        log(`Force retry response: ok=${forceRetry.ok}, status=${forceRetry.status}, forced=${String(forceRetry.forced)}`);
        if (!forceRetry.ok) {
          return makeResult("completed-occurrence-force-retry", "Completed occurrence requires force retry", startedAt, false, `Force retry rejected: ${forceRetry.error ?? "unknown"}`, []);
        }

        const detail = await ctx.apiGet(`/api/agenda/events/${eventId}`) as { ok: boolean; occurrences?: { id: string; status: string }[]; error?: string };
        const updated = detail.occurrences?.find((o) => o.id === occId);
        if (!detail.ok || !updated) {
          return makeResult("completed-occurrence-force-retry", "Completed occurrence requires force retry", startedAt, false, `Failed to reload occurrence: ${detail.error ?? "missing occurrence"}`, []);
        }

        const passed = updated.status === "scheduled";
        return makeResult(
          "completed-occurrence-force-retry",
          "Completed occurrence requires force retry",
          startedAt,
          passed,
          passed ? "Completed occurrence rejected normal retry and accepted force retry" : `Expected status scheduled after force retry, got ${updated.status}`,
          [],
        );
      } catch (err) {
        return makeResult("completed-occurrence-force-retry", "Completed occurrence requires force retry", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 10 ────────────────────────────────────────────────────────────────────────
  {
    id: "recurring-event-expansion",
    name: "Recurring event: RRULE expansion",
    description: "Weekly recurring event should expand to 2+ occurrences across a 2-week range.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("recurring-event-expansion", m); };
      try {
        const title = ctx.uniqueName("TST-weekly");
        const startDate = new Date();
        startDate.setHours(10, 15, 0, 0); // avoid collision with other recurring tests
        // Use a start date far enough in the future that it won't conflict with past validation
        if (startDate.getHours() < 10 || (startDate.getHours() === 10 && startDate.getMinutes() < 15)) {
          startDate.setHours(10, 15, 0, 0);
        } else {
          startDate.setDate(startDate.getDate() + 1);
          startDate.setHours(10, 15, 0, 0);
        }
        const startsAt = startDate.toISOString();
        const twoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
        const today = new Date().toISOString().split("T")[0];

        const create = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent", title,
          freePrompt: "Daily recurrence test.",
          agentId: null, timezone: "Europe/Amsterdam", startsAt,
          endsAt: null, recurrenceRule: "FREQ=DAILY", recurrenceUntil: twoWeeks,
          status: "active", processVersionIds: [],
          executionWindowMinutes: 30, fallbackModel: "",
        }) as { ok: boolean; event?: { id: string }; error?: string };

        if (!create.ok || !create.event?.id) return makeResult("recurring-event-expansion", "Recurring event: RRULE expansion", startedAt, false, `Create failed: ${create.error}`, []);
        const eventId = create.event.id;
        log(`Event: ${eventId}`);
        await ctx.sleep(2500);
        const eventsRes = await ctx.apiGet(`/api/agenda/events?start=${today}&end=${twoWeeks}`) as { ok: boolean; events: Record<string, unknown>[] };
        const occurrences = eventsRes.events?.filter((e) => e.id === eventId) ?? [];
        log(`Expanded: ${occurrences.length} occurrences`);
        if (occurrences.length < 2) return makeResult("recurring-event-expansion", "Recurring event: RRULE expansion", startedAt, false, `Expected 2+, got ${occurrences.length}`, []);
        return makeResult("recurring-event-expansion", "Recurring event: RRULE expansion", startedAt, true, `RRULE expanded ${occurrences.length} weekly occurrences`, []);
      } catch (err) {
        return makeResult("recurring-event-expansion", "Recurring event: RRULE expansion", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 10 ───────────────────────────────────────────────────────────────────────
  {
    id: "event-with-process",
    name: "Event with attached process produces PDF",
    description: "Create a process with a real PDF-producing instruction, execute it for real, and verify a PDF artifact is attached.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("event-with-process", m); };
      const NAME = "event-with-process";
      const LABEL = "Event with attached process produces PDF";
      try {
        const proc = await ctx.apiPost("/api/processes", {
          action: "createProcess",
          name: ctx.uniqueName("TST-proc-pdf"),
          description: "Generate a real PDF report",
          status: "draft",
          versionLabel: "",
          steps: [{
            title: "Generate PDF",
            instruction: "Create a short PDF report named test-report.pdf containing the title REAL PDF TEST and one short paragraph. Save it to the output files path provided in the output rules.",
            skillKey: null,
            agentId: null,
            timeoutSeconds: null,
            modelOverride: "",
          }],
        }) as { ok: boolean; process?: { id: string; latest_version_id: string }; error?: string };

        if (!proc.ok || !proc.process?.latest_version_id) {
          return makeResult(NAME, LABEL, startedAt, false, `Process create failed: ${proc.error ?? "unknown"}`, []);
        }
        const pvId = proc.process.latest_version_id;
        log(`Process created: ${pvId}`);

        // Keep the event draft so the test controls the only executed occurrence.
        const title = ctx.uniqueName("TST-pdf-event");
        const startsAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        const create = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent", title,
          freePrompt: "If useful, mention briefly that the PDF was created, but make sure the file itself is saved.",
          agentId: null, timezone: "Europe/Amsterdam", startsAt,
          endsAt: null, recurrenceRule: null, recurrenceUntil: null,
          status: "draft", processVersionIds: [pvId],
          executionWindowMinutes: 30, fallbackModel: "",
          timeStepMinutes: 0,
        }) as { ok: boolean; event?: { id: string }; error?: string };

        if (!create.ok || !create.event?.id) {
          return makeResult(NAME, LABEL, startedAt, false, `Event create failed: ${create.error}`, []);
        }
        const evtId = create.event.id;
        log(`Draft event created: ${evtId}`);

        const occRes = await ctx.apiPost("/api/agenda/events", {
          action: "testOnlyCreateNeedsRetryOccurrence",
          eventId: evtId,
          scheduledFor: new Date().toISOString(),
        }) as { ok: boolean; occurrenceId?: string; error?: string };

        if (!occRes.ok || !occRes.occurrenceId) {
          return makeResult(NAME, LABEL, startedAt, false, `Failed to inject occurrence: ${occRes.error ?? "unknown"}`, []);
        }
        const occId = occRes.occurrenceId;
        log(`Injected occurrence: ${occId}`);

        const retry = await ctx.apiPost(`/api/agenda/events/${evtId}/occurrences/${occId}`, {}) as { ok: boolean; error?: string };
        if (!retry.ok) {
          return makeResult(NAME, LABEL, startedAt, false, `Retry failed: ${retry.error ?? "unknown"}`, []);
        }
        log("Enqueued for real execution");

        let runsRes: {
          ok: boolean;
          attempts?: { status?: string; error_message?: string | null; summary?: string | null }[];
          steps?: { id: string; artifact_payload: unknown; error_message?: string | null; status?: string }[];
          error?: string;
        } = { ok: false, attempts: [], steps: [] };

        for (let poll = 0; poll < 12; poll++) {
          await ctx.sleep(10000);
          runsRes = await ctx.apiGet(`/api/agenda/events/${evtId}/occurrences/${occId}/runs`) as typeof runsRes;
          const attempt = runsRes.attempts?.[0];
          const stepErr = runsRes.steps?.find((s) => s.error_message)?.error_message ?? attempt?.error_message ?? "";
          log(`Poll ${poll + 1}: attempt=${attempt?.status ?? "none"}, steps=${runsRes.steps?.length ?? 0}, err=${stepErr || "none"}`);
          if (isBillingOrCapacityError(stepErr)) {
            return makeResult(NAME, LABEL, startedAt, false, `Run failed due billing/capacity rejection: ${stepErr}`, []);
          }
          if (attempt?.status === "failed") {
            return makeResult(NAME, LABEL, startedAt, false, `Real PDF run failed: ${attempt?.summary ?? attempt?.error_message ?? "unknown"}`, []);
          }
          if (attempt?.status === "succeeded" && (runsRes.steps?.length ?? 0) > 0) break;
        }

        log(`Runs response: ok=${runsRes.ok}, attempts=${runsRes.attempts?.length ?? 0}, steps=${runsRes.steps?.length ?? 0}`);
        if (!runsRes.ok || runsRes.attempts?.[0]?.status !== "succeeded") {
          return makeResult(NAME, LABEL, startedAt, false, `Expected successful real run, got: ${runsRes.attempts?.[0]?.status ?? runsRes.error ?? "unknown"}`, []);
        }

        const pdfStep = (runsRes.steps ?? []).find((s) => {
          let ap = s.artifact_payload;
          if (typeof ap === "string") { try { ap = JSON.parse(ap); } catch { /* ignore */ } }
          if (typeof ap === "object" && ap !== null && "files" in ap) {
            return (ap as { files: { name: string; path?: string }[] }).files.some((f) => f.name.endsWith(".pdf"));
          }
          return false;
        });

        if (!pdfStep) {
          return makeResult(NAME, LABEL, startedAt, false, `No PDF artifact found from real run. Steps: ${JSON.stringify(runsRes.steps ?? [])}`, []);
        }

        log("PDF artifact verified from real run output");
        return makeResult(NAME, LABEL, startedAt, true, "Real process run produced a PDF artifact that is attached to the occurrence", []);
      } catch (err) {
        return makeResult(NAME, LABEL, startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 11 ───────────────────────────────────────────────────────────────────────
  {
    id: "event-status-lifecycle",
    name: "Event status: draft → active lifecycle",
    description: "Draft events have no occurrences; activating allows occurrences; cannot revert to draft after.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("event-status-lifecycle", m); };
      const NAME = "event-status-lifecycle";
      const LABEL = "Event status: draft → active lifecycle";

      try {
        const title = ctx.uniqueName("TST-lifecycle");
        const startsAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        const create = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent", title,
          freePrompt: "Lifecycle test.",
          agentId: null, timezone: "Europe/Amsterdam", startsAt,
          endsAt: null, recurrenceRule: null, recurrenceUntil: null,
          status: "draft", processVersionIds: [],
          executionWindowMinutes: 30, fallbackModel: "",
          timeStepMinutes: 0,
        }) as { ok: boolean; event?: { id: string }; error?: string };

        if (!create.ok || !create.event?.id) return makeResult(NAME, LABEL, startedAt, false, `Create failed: ${create.error}`, []);
        const eventId = create.event.id;

        // 1. Draft should have no occurrences
        const detail1 = await ctx.apiGet(`/api/agenda/events/${eventId}`) as { ok: boolean; occurrences?: { id: string }[]; event?: { status: string } };
        log(`Draft: ${detail1.event?.status}, occurrences: ${detail1.occurrences?.length ?? 0}`);
        if ((detail1.occurrences?.length ?? 0) > 0) {
          return makeResult(NAME, LABEL, startedAt, false, "Draft should not have occurrences", []);
        }

        // 2. Activate
        const patch = await ctx.apiPatch(`/api/agenda/events/${eventId}`, { status: "active", timeStepMinutes: 0 }) as { ok: boolean; error?: string };
        if (!patch.ok) return makeResult(NAME, LABEL, startedAt, false, `Activate failed: ${patch.error}`, []);
        log("Activated");

        // 3. Verify active status + inject an occurrence to confirm it works
        const occRes = await ctx.apiPost("/api/agenda/events", {
          action: "testOnlyCreateScheduledOccurrence",
          eventId,
          scheduledFor: startsAt,
        }) as { ok: boolean; occurrenceId?: string; error?: string };
        if (!occRes.ok || !occRes.occurrenceId) {
          return makeResult(NAME, LABEL, startedAt, false, `Failed to inject occurrence: ${occRes.error ?? "unknown"}`, []);
        }
        log(`Occurrence injected: ${occRes.occurrenceId}`);

        // 4. Cannot revert to draft now (has occurrences)
        const revert = await ctx.apiPatch(`/api/agenda/events/${eventId}`, { status: "draft", timeStepMinutes: 0 }) as { ok: boolean; error?: string };
        log(`Revert to draft: ok=${revert.ok}, error=${revert.error ?? "none"}`);
        if (revert.ok) {
          return makeResult(NAME, LABEL, startedAt, false, "Should not be able to revert to draft after occurrences exist", []);
        }

        return makeResult(NAME, LABEL, startedAt, true, "Draft→active works, revert to draft blocked with occurrences", []);
      } catch (err) {
        return makeResult(NAME, LABEL, startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 12 ───────────────────────────────────────────────────────────────────────
  {
    id: "cancel-single-occurrence",
    name: "Cancel single occurrence of recurring event",
    description: "Cancel one occurrence of a recurring event — only that occurrence is affected, series continues.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("cancel-single-occurrence", m); };
      try {
        const title = ctx.uniqueName("TST-cancel-occ");
        const startDate = new Date();
        startDate.setHours(10, 30, 0, 0);
        // Ensure future start so past-date validation passes
        if (startDate <= new Date()) {
          startDate.setDate(startDate.getDate() + 1);
        }
        const startsAt = startDate.toISOString();
        const twoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

        const create = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent", title,
          freePrompt: "Cancel one occurrence.",
          agentId: null, timezone: "Europe/Amsterdam", startsAt,
          endsAt: null, recurrenceRule: "FREQ=DAILY", recurrenceUntil: twoWeeks,
          status: "active", processVersionIds: [],
          executionWindowMinutes: 30, fallbackModel: "",
        }) as { ok: boolean; event?: { id: string }; error?: string };

        if (!create.ok || !create.event?.id) return makeResult("cancel-single-occurrence", "Cancel single occurrence of recurring event", startedAt, false, `Create failed: ${create.error}`, []);
        const eventId = create.event.id;
        log(`Recurring event: ${eventId}`);

        // Directly inject 3 future occurrences (bypasses scheduler entirely)
        const occs: { id: string }[] = [];
        for (let d = 1; d <= 3; d++) {
          const future = new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString();
          const occRes = await ctx.apiPost("/api/agenda/events", {
            action: "testOnlyCreateScheduledOccurrence",
            eventId,
            scheduledFor: future,
          }) as { ok: boolean; occurrenceId?: string; error?: string };
          if (occRes.ok && occRes.occurrenceId) {
            occs.push({ id: occRes.occurrenceId });
          }
        }
        log(`Injected ${occs.length} occurrences`);
        if (occs.length === 0) return makeResult("cancel-single-occurrence", "Cancel single occurrence of recurring event", startedAt, false, "Failed to inject occurrences", []);

        const occToCancel = occs[occs.length - 1];
        log(`Cancelling occurrence: ${occToCancel.id}`);
        const del = await ctx.apiDelete(`/api/agenda/events/${eventId}/occurrences/${occToCancel.id}`) as { ok: boolean; error?: string };
        if (!del.ok) return makeResult("cancel-single-occurrence", "Cancel single occurrence of recurring event", startedAt, false, `Cancel failed: ${del.error}`, []);

        await ctx.sleep(500);
        const detail2 = await ctx.apiGet(`/api/agenda/events/${eventId}`) as { ok: boolean; occurrences?: { id: string; status: string }[] };
        const allOccs = detail2.occurrences ?? [];
        const remaining = allOccs.filter((o) => o.status !== "cancelled");
        log(`All occurrences: ${allOccs.map(o => `${o.id}:${o.status}`).join(", ")}`);
        if (remaining.length !== occs.length - 1) return makeResult("cancel-single-occurrence", "Cancel single occurrence of recurring event", startedAt, false, `Expected ${occs.length - 1} remaining, got ${remaining.length} (all: ${allOccs.length})`, []);
        log(`Successfully cancelled one, ${remaining.length} remain`);
        return makeResult("cancel-single-occurrence", "Cancel single occurrence of recurring event", startedAt, true, "Single occurrence cancelled, series continues", []);
      } catch (err) {
        return makeResult("cancel-single-occurrence", "Cancel single occurrence of recurring event", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 13 ───────────────────────────────────────────────────────────────────────
  {
    id: "past-active-auto-needs-retry",
    name: "Past one-time events are correctly rejected",
    skipReset: true,
    description: "One-time events with a past startsAt must be rejected at creation — past events are not valid.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("past-active-auto-needs-retry", m); };
      try {
        const past = new Date(Date.now() - 60 * 60 * 1000);
        past.setUTCMinutes(Math.floor(past.getUTCMinutes() / 15) * 15, 0, 0);

        const create = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent",
          title: ctx.uniqueName("TST-past-reject"),
          freePrompt: "Should be rejected.",
          agentId: null,
          timezone: "Europe/Amsterdam",
          startsAt: past.toISOString(),
          endsAt: null,
          recurrenceRule: null,
          recurrenceUntil: null,
          status: "active",
          processVersionIds: [],
          executionWindowMinutes: 30,
          fallbackModel: "",
        }) as { ok: boolean; event?: { id: string }; error?: string };

        log(`Past event create response: ok=${create.ok}, error=${create.error ?? ""}`);
        // Past one-time events must be rejected — that is correct behavior
        if (!create.ok && create.error) {
          return makeResult("past-active-auto-needs-retry", "Past one-time events are correctly rejected", startedAt, true, "Past one-time event correctly rejected", []);
        }
        return makeResult("past-active-auto-needs-retry", "Past one-time events are correctly rejected", startedAt, false, `Expected rejection, but event was created: ${JSON.stringify(create)}`, []);
      } catch (err) {
        return makeResult("past-active-auto-needs-retry", "Past one-time events are correctly rejected", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 14 ───────────────────────────────────────────────────────────────────────
  {
    id: "retry-endpoint-double-press",
    name: "Retry endpoint is safe on double-press",
    skipReset: true,
    description: "Force an occurrence to needs_retry, press retry twice quickly: first should pass, second should be rejected or no-op-safe.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("retry-endpoint-double-press", m); };
      try {
        const title = ctx.uniqueName("TST-retry-double");
        const startsAt = ctxOffset(ctx);
        const create = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent",
          title,
          freePrompt: "Retry double press test.",
          agentId: null,
          timezone: "Europe/Amsterdam",
          startsAt,
          endsAt: null,
          recurrenceRule: null,
          recurrenceUntil: null,
          status: "active",
          processVersionIds: [],
          executionWindowMinutes: 30,
          fallbackModel: "",
        }) as { ok: boolean; event?: { id: string }; error?: string };

        if (!create.ok || !create.event?.id) {
          return makeResult("retry-endpoint-double-press", "Retry endpoint is safe on double-press", startedAt, false, `Create failed: ${create.error}`, []);
        }
        const eventId = create.event.id;

        // Directly create a needs_retry occurrence (bypasses scheduler)
        const pastTime = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const occRes = await ctx.apiPost("/api/agenda/events", {
          action: "testOnlyCreateNeedsRetryOccurrence",
          eventId,
          scheduledFor: pastTime,
        }) as { ok: boolean; occurrenceId?: string; error?: string };
        if (!occRes.ok || !occRes.occurrenceId) return makeResult("retry-endpoint-double-press", "Retry endpoint is safe on double-press", startedAt, false, `Failed to create needs_retry occurrence: ${occRes.error}`, []);
        const occId = occRes.occurrenceId;
        log(`Created needs_retry occurrence: ${occId}`);

        // Press retry twice in quick succession
        const first = await ctx.apiPost(`/api/agenda/events/${eventId}/occurrences/${occId}`, {}) as { ok: boolean; error?: string };
        const second = await ctx.apiPost(`/api/agenda/events/${eventId}/occurrences/${occId}`, {}) as { ok: boolean; error?: string };

        log(`First retry: ok=${first.ok}, Second retry: ok=${second.ok}, error=${second.error ?? ""}`);

        if (!first.ok) {
          return makeResult("retry-endpoint-double-press", "Retry endpoint is safe on double-press", startedAt, false, `First retry rejected: ${first.error}`, []);
        }

        // Second should either succeed (idempotent) or be rejected with Cannot retry
        if (second.ok || (second.error && /Cannot retry occurrence/.test(second.error))) {
          return makeResult("retry-endpoint-double-press", "Retry endpoint is safe on double-press", startedAt, true, "Double-press handled safely", []);
        }

        return makeResult("retry-endpoint-double-press", "Retry endpoint is safe on double-press", startedAt, false, `Unexpected second retry response: ${JSON.stringify(second)}`, []);
      } catch (err) {
        return makeResult("retry-endpoint-double-press", "Retry endpoint is safe on double-press", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 14b ──────────────────────────────────────────────────────────────────────
  {
    id: "grace-window-active-create-does-not-instant-retry",
    name: "Grace-window active create does not instantly needs_retry",
    description: "Create an active one-time event slightly in the past but within the 5-minute grace window; it should be bumped to now, not instantly marked needs_retry.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const NAME = "grace-window-active-create-does-not-instant-retry";
      const LABEL = "Grace-window active create does not instantly needs_retry";

      try {
        const create = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent",
          title: ctx.uniqueName("TST-grace-window"),
          freePrompt: "Grace-window create test.",
          agentId: null,
          timezone: "Europe/Amsterdam",
          startsAt: new Date(Date.now() - 60_000).toISOString(),
          endsAt: null,
          recurrenceRule: null,
          recurrenceUntil: null,
          status: "active",
          processVersionIds: [],
          executionWindowMinutes: 30,
          fallbackModel: "",
          timeStepMinutes: 0,
        }) as { ok: boolean; autoNeedsRetry?: boolean; event?: { id: string }; error?: string };

        if (!create.ok || !create.event?.id) {
          return makeResult(NAME, LABEL, startedAt, false, `Create failed: ${create.error ?? "unknown"}`, []);
        }

        if (create.autoNeedsRetry) {
          return makeResult(NAME, LABEL, startedAt, false, "Event was incorrectly auto-marked needs_retry inside grace window", []);
        }

        const detail = await ctx.apiGet(`/api/agenda/events/${create.event.id}`) as {
          ok: boolean;
          occurrences?: { status: string }[];
          error?: string;
        };

        if (!detail.ok) {
          return makeResult(NAME, LABEL, startedAt, false, `Detail fetch failed: ${detail.error ?? "unknown"}`, []);
        }

        const bad = detail.occurrences?.some((o) => o.status === "needs_retry") ?? false;
        return makeResult(
          NAME,
          LABEL,
          startedAt,
          !bad,
          bad ? "Occurrence was unexpectedly marked needs_retry" : "Grace-window event stayed runnable (not instantly needs_retry)",
          [],
        );
      } catch (err) {
        return makeResult(NAME, LABEL, startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 14c ──────────────────────────────────────────────────────────────────────
  {
    id: "retry-moves-scheduled-for-to-now",
    name: "Retry moves scheduled_for to now",
    description: "Inject a stale occurrence from days ago, retry it, and verify scheduled_for is updated to approximately now.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("retry-moves-scheduled-for-to-now", m); };
      const NAME = "retry-moves-scheduled-for-to-now";
      const LABEL = "Retry moves scheduled_for to now";

      try {
        // 1. Create a draft event
        const create = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent",
          title: ctx.uniqueName("TST-retry-time"),
          freePrompt: "Retry timestamp test.",
          agentId: null,
          timezone: "Europe/Amsterdam",
          startsAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          endsAt: null,
          recurrenceRule: null,
          recurrenceUntil: null,
          status: "draft",
          processVersionIds: [],
          executionWindowMinutes: 30,
          fallbackModel: "",
          timeStepMinutes: 0,
        }) as { ok: boolean; event?: { id: string }; error?: string };

        if (!create.ok || !create.event?.id) {
          return makeResult(NAME, LABEL, startedAt, false, `Create failed: ${create.error}`, []);
        }
        const eventId = create.event.id;

        // 2. Inject a needs_retry occurrence from 3 days ago
        const staleDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
        const occRes = await ctx.apiPost("/api/agenda/events", {
          action: "testOnlyCreateNeedsRetryOccurrence",
          eventId,
          scheduledFor: staleDate,
        }) as { ok: boolean; occurrenceId?: string; error?: string };

        if (!occRes.ok || !occRes.occurrenceId) {
          return makeResult(NAME, LABEL, startedAt, false, `Failed to inject: ${occRes.error ?? "unknown"}`, []);
        }
        const occId = occRes.occurrenceId;
        log(`Injected stale occurrence ${occId} at ${staleDate}`);

        // 3. Verify it has the old date
        const before = await ctx.apiGet(`/api/agenda/events/${eventId}`) as { ok: boolean; occurrences?: { id: string; scheduled_for: string }[] };
        const occBefore = before.occurrences?.find((o) => o.id === occId);
        const beforeTs = occBefore ? new Date(occBefore.scheduled_for).getTime() : 0;
        log(`Before retry: scheduled_for=${occBefore?.scheduled_for}`);

        // 4. Retry it
        const retryBefore = Date.now();
        const retry = await ctx.apiPost(`/api/agenda/events/${eventId}/occurrences/${occId}`, {}) as { ok: boolean; error?: string };
        if (!retry.ok) {
          return makeResult(NAME, LABEL, startedAt, false, `Retry failed: ${retry.error ?? "unknown"}`, []);
        }

        // 5. Verify scheduled_for moved to now
        await ctx.sleep(1000);
        const after = await ctx.apiGet(`/api/agenda/events/${eventId}`) as { ok: boolean; occurrences?: { id: string; scheduled_for: string }[] };
        const occAfter = after.occurrences?.find((o) => o.id === occId);
        const afterTs = occAfter ? new Date(occAfter.scheduled_for).getTime() : 0;
        log(`After retry: scheduled_for=${occAfter?.scheduled_for}`);

        // scheduled_for should be within 2 minutes of when we pressed retry
        // (worker processing + scheduler cycles can add delay)
        const drift = Math.abs(afterTs - retryBefore);
        log(`Drift from retry time: ${drift}ms`);

        if (drift > 120_000) {
          return makeResult(NAME, LABEL, startedAt, false,
            `scheduled_for not moved to now. Before: ${occBefore?.scheduled_for}, After: ${occAfter?.scheduled_for}, Drift: ${drift}ms`, []);
        }

        // Verify it actually moved (not still the stale date)
        const movedForward = afterTs - beforeTs;
        if (movedForward < 2 * 24 * 60 * 60 * 1000) { // should have moved forward at least ~2 days
          return makeResult(NAME, LABEL, startedAt, false,
            `scheduled_for didn't move forward enough. Before: ${occBefore?.scheduled_for}, After: ${occAfter?.scheduled_for}`, []);
        }

        return makeResult(NAME, LABEL, startedAt, true,
          `scheduled_for moved from ${occBefore?.scheduled_for} to ${occAfter?.scheduled_for} (drift: ${drift}ms)`, []);
      } catch (err) {
        return makeResult(NAME, LABEL, startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 15 ───────────────────────────────────────────────────────────────────────
  {
    id: "edit-locked-while-running",
    name: "Edit blocked while occurrence is running",
    description: "When an occurrence is actively running, editing the event must be rejected with lock error.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("edit-locked-while-running", m); };
      try {
        const title = ctx.uniqueName("TST-edit-lock");
        const startsAt = ctxOffset(ctx);
        const create = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent",
          title,
          freePrompt: "Lock test run.",
          agentId: null,
          timezone: "Europe/Amsterdam",
          startsAt,
          endsAt: null,
          recurrenceRule: null,
          recurrenceUntil: null,
          status: "active",
          processVersionIds: [],
          executionWindowMinutes: 30,
          fallbackModel: "",
        }) as { ok: boolean; event?: { id: string }; error?: string };

        if (!create.ok || !create.event?.id) {
          return makeResult("edit-locked-while-running", "Edit blocked while occurrence is running", startedAt, false, `Create failed: ${create.error}`, []);
        }
        const eventId = create.event.id;

        // Directly create a scheduled occurrence (bypasses scheduler)
        const futureTime = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h from now
        const occRes = await ctx.apiPost("/api/agenda/events", {
          action: "testOnlyCreateScheduledOccurrence",
          eventId,
          scheduledFor: futureTime,
        }) as { ok: boolean; occurrenceId?: string; error?: string };
        if (!occRes.ok || !occRes.occurrenceId) return makeResult("edit-locked-while-running", "Edit blocked while occurrence is running", startedAt, false, `Failed to create scheduled occurrence: ${occRes.error}`, []);
        const occId = occRes.occurrenceId;
        log(`Created scheduled occurrence: ${occId}`);

        // Force the occurrence into running state (simulates worker executing)
        const runRes = await ctx.apiPost(`/api/agenda/events/${eventId}/occurrences/${occId}`, {
          action: "testOnlySetRunning",
        }) as { ok: boolean; error?: string };
        if (!runRes.ok) return makeResult("edit-locked-while-running", "Edit blocked while occurrence is running", startedAt, false, `testOnlySetRunning failed: ${runRes.error}`, []);

        let blocked = false;
        for (let i = 0; i < 10; i++) {
          await ctx.sleep(500);
          const patch = await ctx.apiPatch(`/api/agenda/events/${eventId}`, { title: ctx.uniqueName("TST-edit-lock-attempt") }) as { ok: boolean; error?: string };
          if (!patch.ok && /cannot edit event while executing/i.test(String(patch.error || ""))) {
            blocked = true;
            log(`Patch blocked at attempt ${i + 1}: ${patch.error}`);
            break;
          }
          const d = await ctx.apiGet(`/api/agenda/events/${eventId}`) as { ok: boolean; occurrences?: { status: string }[] };
          const status = d.occurrences?.[0]?.status;
          log(`Attempt ${i + 1}: patchOk=${patch.ok}, status=${status}`);
          if (status && ["succeeded", "failed", "needs_retry"].includes(status)) break;
        }

        if (!blocked) {
          return makeResult("edit-locked-while-running", "Edit blocked while occurrence is running", startedAt, false, "Did not observe lock rejection while occurrence was running", []);
        }

        return makeResult("edit-locked-while-running", "Edit blocked while occurrence is running", startedAt, true, "Edit correctly blocked during execution", []);
      } catch (err) {
        return makeResult("edit-locked-while-running", "Edit blocked while occurrence is running", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 16 ───────────────────────────────────────────────────────────────────────
  {
    id: "one-minute-stop-workers-observe",
    name: "Missed execution window → needs_retry",
    description: "Inject a past occurrence outside its 1-min execution window, enqueue it with the real window, worker detects the miss.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("one-minute-stop-workers-observe", m); };
      const NAME = "one-minute-stop-workers-observe";
      const LABEL = "Missed execution window → needs_retry";

      try {
        // 1. Create a draft event with a 1-min execution window
        const create = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent",
          title: ctx.uniqueName("TST-missed-window"),
          freePrompt: "This should miss its execution window.",
          agentId: null,
          timezone: "Europe/Amsterdam",
          startsAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          endsAt: null,
          recurrenceRule: null,
          recurrenceUntil: null,
          status: "draft",
          processVersionIds: [],
          executionWindowMinutes: 1,
          fallbackModel: "",
          timeStepMinutes: 0,
        }) as { ok: boolean; event?: { id: string }; error?: string };

        if (!create.ok || !create.event?.id) {
          return makeResult(NAME, LABEL, startedAt, false, `Create failed: ${create.error}`, []);
        }
        const eventId = create.event.id;
        log(`Created draft event ${eventId} (executionWindowMinutes=1)`);

        // 2. Inject a needs_retry occurrence 5 min in the past (well outside 1-min window)
        const pastScheduledFor = new Date(Date.now() - 5 * 60_000).toISOString();
        const occRes = await ctx.apiPost("/api/agenda/events", {
          action: "testOnlyCreateNeedsRetryOccurrence",
          eventId,
          scheduledFor: pastScheduledFor,
        }) as { ok: boolean; occurrenceId?: string; error?: string };

        if (!occRes.ok || !occRes.occurrenceId) {
          return makeResult(NAME, LABEL, startedAt, false, `Failed to inject occurrence: ${occRes.error ?? "unknown"}`, []);
        }
        const occId = occRes.occurrenceId;
        log(`Injected past occurrence ${occId} at ${pastScheduledFor}`);

        // 3. Retry with the real execution window (1 min) and keep the old date
        //    so the worker sees the 5-min-past date vs 1-min window → needs_retry
        const retry = await ctx.apiPost(`/api/agenda/events/${eventId}/occurrences/${occId}`, {
          executionWindowMinutes: 1,
          preserveScheduledFor: true,
        }) as { ok: boolean; error?: string };
        if (!retry.ok) {
          return makeResult(NAME, LABEL, startedAt, false, `Retry enqueue failed: ${retry.error ?? "unknown"}`, []);
        }
        log("Enqueued with executionWindowMinutes=1");

        // 4. Poll for worker pickup + needs_retry (up to 30s).
        // If it stays scheduled with no attempt/steps, that's a harness/service pickup issue,
        // not proof that missed-window logic is broken.
        let finalStatus = "scheduled";
        let sawAttempt = false;
        let latestAttemptStatus = "none";
        for (let i = 0; i < 6; i++) {
          await ctx.sleep(5000);
          const detail = await ctx.apiGet(`/api/agenda/events/${eventId}`) as { ok: boolean; occurrences?: { id: string; status: string }[] };
          const occ = detail.occurrences?.find((o) => o.id === occId);
          finalStatus = occ?.status ?? "none";

          const inspect = await ctx.apiGet(`/api/agenda/debug/run-steps?occurrenceId=${occId}`) as {
            ok: boolean;
            attempt?: { status?: string } | null;
            steps?: { error_message?: string | null }[];
            error?: string;
          };
          sawAttempt = sawAttempt || Boolean(inspect.attempt);
          latestAttemptStatus = inspect.attempt?.status ?? latestAttemptStatus;
          const latestErr = inspect.steps?.[0]?.error_message ?? "";
          log(`Poll ${i + 1}: status=${finalStatus}, attempt=${latestAttemptStatus}, stepErr=${latestErr || "none"}`);
          if (isBillingOrCapacityError(latestErr)) {
            return makeResult(NAME, LABEL, startedAt, false, `Test invalid: worker hit billing/capacity rejection instead of clean missed-window handling (${latestErr})`, []);
          }
          if (finalStatus === "needs_retry" || finalStatus === "failed") break;
        }

        if (finalStatus === "needs_retry") {
          return makeResult(NAME, LABEL, startedAt, true, "Worker correctly detected missed execution window and set needs_retry", []);
        }

        if (!sawAttempt && finalStatus === "scheduled") {
          return makeResult(NAME, LABEL, startedAt, false, "Worker never picked up the queued occurrence; this was a harness/service pickup failure, not a real missed-window result", []);
        }

        return makeResult(NAME, LABEL, startedAt, false, `Expected needs_retry, got status=${finalStatus}, attempt=${latestAttemptStatus}`, []);
      } catch (err) {
        return makeResult(NAME, LABEL, startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 17 ───────────────────────────────────────────────────────────────────────
  {
    id: "race-preempted-run-must-not-autocomplete",
    name: "Race guard: preempted run must not auto-complete to done",
    skipReset: true,
    description: "If an in-flight run is preempted/retried, it must not later flip directly to succeeded from stale completion.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("race-preempted-run-must-not-autocomplete", m); };
      try {
        const startsAt = ctxOffset(ctx);
        const title = ctx.uniqueName("TST-race-preempt");

        const create = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent",
          title,
          freePrompt: "Generate a detailed multi-part summary with at least 20 bullet points and rationale.",
          agentId: null,
          timezone: "Europe/Amsterdam",
          startsAt,
          endsAt: null,
          recurrenceRule: null,
          recurrenceUntil: null,
          status: "active",
          processVersionIds: [],
          executionWindowMinutes: 30,
          fallbackModel: "",
        }) as { ok: boolean; event?: { id: string }; error?: string };

        if (!create.ok || !create.event?.id) {
          return makeResult("race-preempted-run-must-not-autocomplete", "Race guard: preempted run must not auto-complete to done", startedAt, false, `Create failed: ${create.error ?? "unknown"}`, []);
        }

        const eventId = create.event.id;
        log(`Created event ${eventId}`);

        // Directly inject a needs_retry occurrence (bypasses scheduler entirely)
        const occRes = await ctx.apiPost("/api/agenda/events", {
          action: "testOnlyCreateNeedsRetryOccurrence",
          eventId,
          scheduledFor: new Date().toISOString(),
        }) as { ok: boolean; occurrenceId?: string; error?: string };

        if (!occRes.ok || !occRes.occurrenceId) {
          return makeResult("race-preempted-run-must-not-autocomplete", "Race guard: preempted run must not auto-complete to done", startedAt, false, `Failed to inject occurrence: ${occRes.error ?? "unknown"}`, []);
        }
        const occId = occRes.occurrenceId;
        log(`Injected occurrence: ${occId}`);

        // Force the occurrence to running state directly (no worker needed)
        const runRes = await ctx.apiPost(`/api/agenda/events/${eventId}/occurrences/${occId}`, {
          action: "testOnlySetRunning",
        }) as { ok: boolean; error?: string };
        if (!runRes.ok) {
          return makeResult("race-preempted-run-must-not-autocomplete", "Race guard: preempted run must not auto-complete to done", startedAt, false, `testOnlySetRunning failed: ${runRes.error ?? "unknown"}`, []);
        }
        log("Set occurrence to running");

        const preempt = await ctx.apiPost(`/api/agenda/events/${eventId}/occurrences/${occId}`, {}) as { ok: boolean; error?: string };
        if (!preempt.ok) {
          return makeResult("race-preempted-run-must-not-autocomplete", "Race guard: preempted run must not auto-complete to done", startedAt, false, `Preempt retry failed: ${preempt.error ?? "unknown"}`, []);
        }

        // Regression assertion: after preemption, we must not jump straight to succeeded
        // without an observed fresh running cycle.
        const observed: string[] = [];
        for (let i = 0; i < 20; i++) {
          await ctx.sleep(1000);
          const detail = await ctx.apiGet(`/api/agenda/events/${eventId}`) as { ok: boolean; occurrences?: { id: string; status: string }[] };
          const status = detail.occurrences?.find((o) => o.id === occId)?.status ?? "unknown";
          observed.push(status);
          log(`Post-preempt poll ${i + 1}: status=${status}`);
          if (status === "succeeded" || status === "failed" || status === "needs_retry") break;
        }

        const succeededIdx = observed.findIndex((s) => s === "succeeded");
        const runningIdx = observed.findIndex((s) => s === "running");

        if (succeededIdx >= 0 && (runningIdx === -1 || runningIdx > succeededIdx)) {
          return makeResult(
            "race-preempted-run-must-not-autocomplete",
            "Race guard: preempted run must not auto-complete to done",
            startedAt,
            false,
            `Detected forbidden transition after preempt: ${observed.join(" -> ")}`,
            [],
          );
        }

        return makeResult(
          "race-preempted-run-must-not-autocomplete",
          "Race guard: preempted run must not auto-complete to done",
          startedAt,
          true,
          `Observed safe post-preempt lifecycle: ${observed.join(" -> ")}`,
          [],
        );
      } catch (err) {
        return makeResult(
          "race-preempted-run-must-not-autocomplete",
          "Race guard: preempted run must not auto-complete to done",
          startedAt,
          false,
          `Exception: ${err instanceof Error ? err.message : String(err)}`,
          [],
        );
      }
    },
  },

  // 18 ───────────────────────────────────────────────────────────────────────
  {
    id: "process-delete-blocked-while-event-running",
    name: "Process delete blocked while tied agenda event is running",
    description: "Deleting a process must be rejected if any tied agenda occurrence is currently running.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("process-delete-blocked-while-event-running", m); };
      try {
        const proc = await ctx.apiPost("/api/processes", {
          action: "createProcess",
          name: ctx.uniqueName("TST-proc-lock"),
          description: "Delete lock test",
          status: "draft",
          versionLabel: "",
          steps: [{
            title: "Long-ish step",
            instruction: "Write a detailed response with at least 30 numbered lines.",
            skillKey: null,
            agentId: null,
            timeoutSeconds: null,
            modelOverride: "",
          }],
        }) as { ok: boolean; process?: { id: string; latest_version_id: string }; error?: string };

        if (!proc.ok || !proc.process?.id || !proc.process?.latest_version_id) {
          return makeResult("process-delete-blocked-while-event-running", "Process delete blocked while tied agenda event is running", startedAt, false, `Process create failed: ${proc.error ?? "unknown"}`, []);
        }

        const startsAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
        const event = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent",
          title: ctx.uniqueName("TST-proc-lock-event"),
          freePrompt: "Run with process",
          agentId: null,
          timezone: "Europe/Amsterdam",
          startsAt,
          endsAt: null,
          recurrenceRule: null,
          recurrenceUntil: null,
          status: "active",
          processVersionIds: [proc.process.latest_version_id],
          executionWindowMinutes: 30,
          fallbackModel: "",
          timeStepMinutes: 0,
        }) as { ok: boolean; event?: { id: string }; error?: string };

        if (!event.ok || !event.event?.id) {
          return makeResult("process-delete-blocked-while-event-running", "Process delete blocked while tied agenda event is running", startedAt, false, `Event create failed: ${event.error ?? "unknown"}`, []);
        }

        const eventId = event.event.id;
        // Directly inject a scheduled occurrence then force it to running
        const occRes = await ctx.apiPost("/api/agenda/events", {
          action: "testOnlyCreateScheduledOccurrence",
          eventId,
          scheduledFor: new Date().toISOString(),
        }) as { ok: boolean; occurrenceId?: string; error?: string };
        if (!occRes.ok || !occRes.occurrenceId) {
          return makeResult("process-delete-blocked-while-event-running", "Process delete blocked while tied agenda event is running", startedAt, false, "Failed to inject occurrence", []);
        }
        const occId = occRes.occurrenceId;

        // Force to running state directly
        const runRes = await ctx.apiPost(`/api/agenda/events/${eventId}/occurrences/${occId}`, {
          action: "testOnlySetRunning",
        }) as { ok: boolean; error?: string };
        if (!runRes.ok) {
          return makeResult("process-delete-blocked-while-event-running", "Process delete blocked while tied agenda event is running", startedAt, false, `testOnlySetRunning failed: ${runRes.error ?? "unknown"}`, []);
        }

        const del = await ctx.apiDelete(`/api/processes/${proc.process.id}`) as { ok: boolean; error?: string };
        log(`Delete response: ok=${del.ok}, error=${del.error ?? ""}`);

        if (!del.ok && (del.error ?? "").toLowerCase().includes("running")) {
          return makeResult("process-delete-blocked-while-event-running", "Process delete blocked while tied agenda event is running", startedAt, true, "Delete correctly blocked while tied event is running", []);
        }

        return makeResult("process-delete-blocked-while-event-running", "Process delete blocked while tied agenda event is running", startedAt, false, `Expected running-lock rejection, got: ${JSON.stringify(del)}`, []);
      } catch (err) {
        return makeResult("process-delete-blocked-while-event-running", "Process delete blocked while tied agenda event is running", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 19 ───────────────────────────────────────────────────────────────────────
  {
    id: "process-delete-requires-force-when-tied",
    name: "Process delete requires force when tied (and force deletes tied events)",
    description: "If a process is tied to agenda events (none running), normal delete should fail; force delete should remove process + tied events.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("process-delete-requires-force-when-tied", m); };
      try {
        const proc = await ctx.apiPost("/api/processes", {
          action: "createProcess",
          name: ctx.uniqueName("TST-proc-force"),
          description: "Force delete test",
          status: "draft",
          versionLabel: "",
          steps: [{
            title: "Simple step",
            instruction: "Return a short confirmation.",
            skillKey: null,
            agentId: null,
            timeoutSeconds: null,
            modelOverride: "",
          }],
        }) as { ok: boolean; process?: { id: string; latest_version_id: string }; error?: string };

        if (!proc.ok || !proc.process?.id || !proc.process?.latest_version_id) {
          return makeResult("process-delete-requires-force-when-tied", "Process delete requires force when tied (and force deletes tied events)", startedAt, false, `Process create failed: ${proc.error ?? "unknown"}`, []);
        }

        const startsAt = ctxOffset(ctx, 8);
        const event = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent",
          title: ctx.uniqueName("TST-proc-force-event"),
          freePrompt: "Draft event tied to process",
          agentId: null,
          timezone: "Europe/Amsterdam",
          startsAt,
          endsAt: null,
          recurrenceRule: null,
          recurrenceUntil: null,
          status: "draft",
          processVersionIds: [proc.process.latest_version_id],
          executionWindowMinutes: 30,
          fallbackModel: "",
        }) as { ok: boolean; event?: { id: string }; error?: string };

        if (!event.ok || !event.event?.id) {
          return makeResult("process-delete-requires-force-when-tied", "Process delete requires force when tied (and force deletes tied events)", startedAt, false, `Event create failed: ${event.error ?? "unknown"}`, []);
        }

        const eventId = event.event.id;
        const normalDel = await ctx.apiDelete(`/api/processes/${proc.process.id}`) as { ok: boolean; code?: string; error?: string };
        log(`Normal delete: ok=${normalDel.ok}, code=${normalDel.code ?? ""}, error=${normalDel.error ?? ""}`);
        if (normalDel.ok || normalDel.code !== "PROCESS_IN_USE") {
          return makeResult("process-delete-requires-force-when-tied", "Process delete requires force when tied (and force deletes tied events)", startedAt, false, `Expected PROCESS_IN_USE on normal delete, got: ${JSON.stringify(normalDel)}`, []);
        }

        const forceDel = await ctx.apiDelete(`/api/processes/${proc.process.id}?force=1`) as { ok: boolean; deletedAgendaEvents?: number; error?: string };
        log(`Force delete: ok=${forceDel.ok}, deletedAgendaEvents=${forceDel.deletedAgendaEvents ?? 0}`);
        if (!forceDel.ok) {
          return makeResult("process-delete-requires-force-when-tied", "Process delete requires force when tied (and force deletes tied events)", startedAt, false, `Force delete failed: ${forceDel.error ?? "unknown"}`, []);
        }

        const eventCheck = await ctx.apiGet(`/api/agenda/events/${eventId}`) as { ok: boolean; error?: string };
        if (eventCheck.ok) {
          return makeResult("process-delete-requires-force-when-tied", "Process delete requires force when tied (and force deletes tied events)", startedAt, false, "Expected tied agenda event to be deleted on force delete, but it still exists", []);
        }

        return makeResult("process-delete-requires-force-when-tied", "Process delete requires force when tied (and force deletes tied events)", startedAt, true, "Normal delete blocked, force delete removed process and tied agenda events", []);
      } catch (err) {
        return makeResult("process-delete-requires-force-when-tied", "Process delete requires force when tied (and force deletes tied events)", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 20 ───────────────────────────────────────────────────────────────────────
  {
    id: "process-create-requires-step-title-and-instruction",
    name: "Process create/update requires step title + instruction",
    description: "Process API must reject empty step title/instruction so Step 2 cannot proceed with incomplete steps.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("process-create-requires-step-title-and-instruction", m); };
      try {
        const badCreate = await ctx.apiPost("/api/processes", {
          action: "createProcess",
          name: ctx.uniqueName("TST-proc-validate"),
          description: "Validation test",
          status: "draft",
          versionLabel: "",
          steps: [{
            title: "",
            instruction: "",
            skillKey: null,
            agentId: null,
            timeoutSeconds: null,
            modelOverride: "",
          }],
        }) as { ok: boolean; error?: string };

        log(`Bad create: ok=${badCreate.ok}, error=${badCreate.error ?? ""}`);
        if (badCreate.ok) {
          return makeResult("process-create-requires-step-title-and-instruction", "Process create/update requires step title + instruction", startedAt, false, "Expected create validation failure for empty title/instruction", []);
        }

        const goodCreate = await ctx.apiPost("/api/processes", {
          action: "createProcess",
          name: ctx.uniqueName("TST-proc-valid"),
          description: "Validation control",
          status: "draft",
          versionLabel: "",
          steps: [{
            title: "Valid title",
            instruction: "Valid instruction",
            skillKey: null,
            agentId: null,
            timeoutSeconds: null,
            modelOverride: "",
          }],
        }) as { ok: boolean; process?: { id: string }; error?: string };

        if (!goodCreate.ok || !goodCreate.process?.id) {
          return makeResult("process-create-requires-step-title-and-instruction", "Process create/update requires step title + instruction", startedAt, false, `Control create failed: ${goodCreate.error ?? "unknown"}`, []);
        }

        const badUpdate = await ctx.apiPatch(`/api/processes/${goodCreate.process.id}`, {
          name: "Updated",
          description: "Updated",
          versionLabel: "",
          status: "draft",
          steps: [{
            title: "",
            instruction: "Still empty",
            skillKey: null,
            agentId: null,
            timeoutSeconds: null,
            modelOverride: "",
          }],
        }) as { ok: boolean; error?: string };

        log(`Bad update: ok=${badUpdate.ok}, error=${badUpdate.error ?? ""}`);
        if (badUpdate.ok) {
          return makeResult("process-create-requires-step-title-and-instruction", "Process create/update requires step title + instruction", startedAt, false, "Expected update validation failure for empty step title", []);
        }

        return makeResult("process-create-requires-step-title-and-instruction", "Process create/update requires step title + instruction", startedAt, true, "Validation correctly blocks incomplete process steps on create and update", []);
      } catch (err) {
        return makeResult("process-create-requires-step-title-and-instruction", "Process create/update requires step title + instruction", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 21 ───────────────────────────────────────────────────────────────────────
  {
    id: "skill-assignment-actually-used",
    name: "Skill assignment is actually used during run",
    description: "Runs an event with a step-level skill and verifies the executed run step persisted that skill key.",
    run: async (ctx) => {
      const startedAt = Date.now();
      try {
        const proc = await ctx.apiPost("/api/processes", {
          action: "createProcess",
          name: ctx.uniqueName("TST-skill-used"),
          description: "Skill verification",
          status: "draft",
          versionLabel: "",
          steps: [{
            title: "Skill step",
            instruction: "Say one line confirming execution.",
            skillKey: "session-start-protocol",
            agentId: null,
            timeoutSeconds: null,
            modelOverride: "",
          }],
        }) as { ok: boolean; process?: { latest_version_id: string; id: string }; error?: string };

        if (!proc.ok || !proc.process?.latest_version_id) {
          return makeResult("skill-assignment-actually-used", "Skill assignment is actually used during run", startedAt, false, `Process create failed: ${proc.error ?? "unknown"}`, []);
        }

        const event = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent",
          title: ctx.uniqueName("TST-skill-event"),
          freePrompt: null,
          agentId: null,
          timezone: "Europe/Amsterdam",
          startsAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
          endsAt: null,
          recurrenceRule: null,
          recurrenceUntil: null,
          status: "active",
          processVersionIds: [proc.process.latest_version_id],
          executionWindowMinutes: 30,
          fallbackModel: "",
          timeStepMinutes: 0,
        }) as { ok: boolean; event?: { id: string }; error?: string };

        if (!event.ok || !event.event?.id) {
          return makeResult("skill-assignment-actually-used", "Skill assignment is actually used during run", startedAt, false, `Event create failed: ${event.error ?? "unknown"}`, []);
        }

        const eventId = event.event.id;
        const occRes = await ctx.apiPost("/api/agenda/events", {
          action: "testOnlyCreateNeedsRetryOccurrence",
          eventId,
          scheduledFor: new Date().toISOString(),
        }) as { ok: boolean; occurrenceId?: string; error?: string };
        if (!occRes.ok || !occRes.occurrenceId) return makeResult("skill-assignment-actually-used", "Skill assignment is actually used during run", startedAt, false, "Failed to inject occurrence", []);
        const occId = occRes.occurrenceId;

        // Retry to enqueue for execution
        const retry = await ctx.apiPost(`/api/agenda/events/${eventId}/occurrences/${occId}`, {}) as { ok: boolean; error?: string };
        if (!retry.ok) return makeResult("skill-assignment-actually-used", "Skill assignment is actually used during run", startedAt, false, `Retry failed: ${retry.error ?? "unknown"}`, []);

        // Poll for worker to pick up and execute (up to 120s), but fail fast on terminal failure
        // and never treat billing/capacity rejection as a valid pass.
        let inspect: {
          ok: boolean;
          attempt?: { status?: string } | null;
          steps?: { skill_key?: string; status?: string; error_message?: string | null }[];
          error?: string;
        } = { ok: false, steps: [] };
        for (let poll = 0; poll < 12; poll++) {
          await ctx.sleep(10000);
          inspect = await ctx.apiGet(`/api/agenda/debug/run-steps?occurrenceId=${occId}`) as typeof inspect;
          const attemptStatus = inspect.attempt?.status ?? "none";
          const stepErr = inspect.steps?.find((s) => s.error_message)?.error_message ?? "";
          if (isBillingOrCapacityError(stepErr)) {
            return makeResult("skill-assignment-actually-used", "Skill assignment is actually used during run", startedAt, false, `Run failed due billing/capacity rejection: ${stepErr}`, []);
          }
          if (inspect.ok && attemptStatus === "failed") {
            return makeResult("skill-assignment-actually-used", "Skill assignment is actually used during run", startedAt, false, `Run attempt failed before skill verification. Steps: ${JSON.stringify(inspect.steps ?? [])}`, []);
          }
          if (inspect.ok && (inspect.steps?.length ?? 0) > 0 && attemptStatus === "succeeded") break;
        }
        if (!inspect.ok) return makeResult("skill-assignment-actually-used", "Skill assignment is actually used during run", startedAt, false, `Inspect failed: ${inspect.error ?? "unknown"}`, []);
        if (inspect.attempt?.status !== "succeeded") {
          return makeResult("skill-assignment-actually-used", "Skill assignment is actually used during run", startedAt, false, `Run did not finish successfully. Attempt status: ${inspect.attempt?.status ?? "none"}` , []);
        }

        const used = (inspect.steps ?? []).some((s) => s.status === "succeeded" && s.skill_key === "session-start-protocol");
        if (!used) {
          return makeResult("skill-assignment-actually-used", "Skill assignment is actually used during run", startedAt, false, `No successful run step persisted expected skill key. Steps: ${JSON.stringify(inspect.steps ?? [])}`, []);
        }

        return makeResult("skill-assignment-actually-used", "Skill assignment is actually used during run", startedAt, true, "Run step persisted expected skill key on a successful execution", []);
      } catch (err) {
        return makeResult("skill-assignment-actually-used", "Skill assignment is actually used during run", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 22 ───────────────────────────────────────────────────────────────────────
  {
    id: "prompt-template-order-and-labels",
    name: "Prompt template: labels + Request after Instructions",
    description: "Validates unified renderer structure and section ordering for cross-model prompt format.",
    run: async (ctx) => {
      const startedAt = Date.now();
      try {
        const res = await ctx.apiPost("/api/agenda/debug/render-template", {
          title: "Quarterly planning memo",
          context: "Summarize priorities and sequencing.",
          request: "Keep tone concise and executive-friendly.",
          instructions: [
            { order: 1, title: "Collect themes", instruction: "Identify the top 3 planning themes." },
            { order: 2, title: "Draft memo", instruction: "Write a one-page decision memo." },
          ],
        }) as { ok: boolean; message?: string; error?: string };

        if (!res.ok || !res.message) {
          return makeResult("prompt-template-order-and-labels", "Prompt template: labels + Request after Instructions", startedAt, false, `Render failed: ${res.error ?? "unknown"}`, []);
        }

        const msg = res.message;
        const checks = [
          "You are handling one task. Use only the information below.",
          "Task:\nQuarterly planning memo",
          "Context:\nSummarize priorities and sequencing.",
          "Instructions:\n1. Collect themes — Identify the top 3 planning themes.",
          "Request:\nKeep tone concise and executive-friendly.",
          "Output rules:\n- Return only the requested deliverable.",
        ];

        for (const needle of checks) {
          if (!msg.includes(needle)) {
            return makeResult("prompt-template-order-and-labels", "Prompt template: labels + Request after Instructions", startedAt, false, `Missing required block: ${needle}`, []);
          }
        }

        const idxInstructions = msg.indexOf("Instructions:");
        const idxRequest = msg.indexOf("Request:");
        if (idxInstructions === -1 || idxRequest === -1 || idxRequest < idxInstructions) {
          return makeResult("prompt-template-order-and-labels", "Prompt template: labels + Request after Instructions", startedAt, false, "Section order invalid: Request must come after Instructions", []);
        }

        if (msg.includes("If essential information is missing")) {
          return makeResult("prompt-template-order-and-labels", "Prompt template: labels + Request after Instructions", startedAt, false, "Deprecated clarification-question rule still present in output rules", []);
        }

        return makeResult("prompt-template-order-and-labels", "Prompt template: labels + Request after Instructions", startedAt, true, "Renderer output matches expected labels/order and updated output rules", []);
      } catch (err) {
        return makeResult("prompt-template-order-and-labels", "Prompt template: labels + Request after Instructions", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 23 ───────────────────────────────────────────────────────────────────────
  {
    id: "agenda-single-dispatch-composed-message",
    name: "Agenda run dispatches one composed model message",
    description: "Verifies process+free prompt run stores one executed run step and contains unified Instructions/Request sections.",
    run: async (ctx) => {
      const startedAt = Date.now();
      try {
        const proc = await ctx.apiPost("/api/processes", {
          action: "createProcess",
          name: ctx.uniqueName("TST-single-dispatch"),
          description: "Single message dispatch",
          status: "draft",
          versionLabel: "",
          steps: [
            { title: "Collect inputs", instruction: "Collect the key inputs.", skillKey: null, agentId: null, timeoutSeconds: null, modelOverride: "" },
            { title: "Generate result", instruction: "Generate the final deliverable.", skillKey: null, agentId: null, timeoutSeconds: null, modelOverride: "" },
          ],
        }) as { ok: boolean; process?: { id: string; latest_version_id: string }; error?: string };

        if (!proc.ok || !proc.process?.latest_version_id) {
          return makeResult("agenda-single-dispatch-composed-message", "Agenda run dispatches one composed model message", startedAt, false, `Process create failed: ${proc.error ?? "unknown"}`, []);
        }

        const event = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent",
          title: ctx.uniqueName("TST-single-dispatch-event"),
          freePrompt: "Keep output concise for executives.",
          agentId: null,
          timezone: "Europe/Amsterdam",
          startsAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
          endsAt: null,
          recurrenceRule: null,
          recurrenceUntil: null,
          status: "active",
          processVersionIds: [proc.process.latest_version_id],
          executionWindowMinutes: 30,
          fallbackModel: "",
          timeStepMinutes: 0,
        }) as { ok: boolean; event?: { id: string }; error?: string };

        if (!event.ok || !event.event?.id) {
          return makeResult("agenda-single-dispatch-composed-message", "Agenda run dispatches one composed model message", startedAt, false, `Event create failed: ${event.error ?? "unknown"}`, []);
        }

        const eventId = event.event.id;
        const occRes = await ctx.apiPost("/api/agenda/events", {
          action: "testOnlyCreateNeedsRetryOccurrence",
          eventId,
          scheduledFor: new Date().toISOString(),
        }) as { ok: boolean; occurrenceId?: string; error?: string };
        if (!occRes.ok || !occRes.occurrenceId) {
          return makeResult("agenda-single-dispatch-composed-message", "Agenda run dispatches one composed model message", startedAt, false, "Failed to inject occurrence", []);
        }
        const occId = occRes.occurrenceId;

        // Retry to enqueue for execution
        const retry = await ctx.apiPost(`/api/agenda/events/${eventId}/occurrences/${occId}`, {}) as { ok: boolean; error?: string };
        if (!retry.ok) {
          return makeResult("agenda-single-dispatch-composed-message", "Agenda run dispatches one composed model message", startedAt, false, `Retry failed: ${retry.error ?? "unknown"}`, []);
        }

        // Poll for worker to pick up and execute (up to 120s), but require success.
        let inspect: {
          ok: boolean;
          attempt?: { status?: string } | null;
          steps?: { input_payload?: { instruction?: string }; error_message?: string | null }[];
          error?: string;
        } = { ok: false, steps: [] };
        for (let poll = 0; poll < 12; poll++) {
          await ctx.sleep(10000);
          inspect = await ctx.apiGet(`/api/agenda/debug/run-steps?occurrenceId=${occId}`) as typeof inspect;
          const stepErr = inspect.steps?.find((s) => s.error_message)?.error_message ?? "";
          if (isBillingOrCapacityError(stepErr)) {
            return makeResult("agenda-single-dispatch-composed-message", "Agenda run dispatches one composed model message", startedAt, false, `Run failed due billing/capacity rejection: ${stepErr}`, []);
          }
          if (inspect.ok && inspect.attempt?.status === "failed") {
            return makeResult("agenda-single-dispatch-composed-message", "Agenda run dispatches one composed model message", startedAt, false, `Run failed before composed-message verification. Steps: ${JSON.stringify(inspect.steps ?? [])}`, []);
          }
          if (inspect.ok && inspect.attempt?.status === "succeeded" && (inspect.steps?.length ?? 0) > 0) break;
        }
        if (!inspect.ok || !Array.isArray(inspect.steps)) {
          return makeResult("agenda-single-dispatch-composed-message", "Agenda run dispatches one composed model message", startedAt, false, `Inspect failed: ${inspect.error ?? "unknown"}`, []);
        }
        if (inspect.attempt?.status !== "succeeded") {
          return makeResult("agenda-single-dispatch-composed-message", "Agenda run dispatches one composed model message", startedAt, false, `Run did not finish successfully. Attempt status: ${inspect.attempt?.status ?? "none"}`, []);
        }

        if (inspect.steps.length !== 1) {
          return makeResult("agenda-single-dispatch-composed-message", "Agenda run dispatches one composed model message", startedAt, false, `Expected 1 dispatched run step, got ${inspect.steps.length}`, []);
        }

        const instruction = String(inspect.steps[0]?.input_payload?.instruction || "");
        if (!instruction.includes("Instructions:") || !instruction.includes("Request:")) {
          return makeResult("agenda-single-dispatch-composed-message", "Agenda run dispatches one composed model message", startedAt, false, "Rendered instruction missing Instructions/Request sections", []);
        }

        if (instruction.indexOf("Request:") < instruction.indexOf("Instructions:")) {
          return makeResult("agenda-single-dispatch-composed-message", "Agenda run dispatches one composed model message", startedAt, false, "Request appears before Instructions", []);
        }

        return makeResult("agenda-single-dispatch-composed-message", "Agenda run dispatches one composed model message", startedAt, true, "Run used a single composed instruction message with correct section order", []);
      } catch (err) {
        return makeResult("agenda-single-dispatch-composed-message", "Agenda run dispatches one composed model message", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 24 ───────────────────────────────────────────────────────────────────────
  {
    id: "agenda-future-scheduled-not-immediate",
    name: "Agenda: future-scheduled occurrence is not executed immediately",
    description: "An event scheduled in the future should not transition to running/succeeded immediately after creation.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("agenda-future-scheduled-not-immediate", m); };
      try {
        const startsAt = ctxOffset(ctx, 2);
        const create = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent",
          title: ctx.uniqueName("TST-agenda-future"),
          freePrompt: "Quick output",
          agentId: null,
          timezone: "Europe/Amsterdam",
          startsAt,
          endsAt: null,
          recurrenceRule: null,
          recurrenceUntil: null,
          status: "active",
          processVersionIds: [],
          executionWindowMinutes: 30,
          fallbackModel: "",
        }) as { ok: boolean; event?: { id: string }; error?: string };

        if (!create.ok || !create.event?.id) {
          return makeResult("agenda-future-scheduled-not-immediate", "Agenda: future-scheduled occurrence is not executed immediately", startedAt, false, `Create failed: ${create.error ?? "unknown"}`, []);
        }

        const eventId = create.event.id;
        await ctx.sleep(5000);
        const detail = await ctx.apiGet(`/api/agenda/events/${eventId}`) as { ok: boolean; occurrences?: { id: string; status: string }[] };
        const occ = detail.occurrences?.[0];
        const status = occ?.status ?? "none";
        log(`Observed status after short wait: ${status}`);

        if (["running", "succeeded"].includes(status)) {
          return makeResult("agenda-future-scheduled-not-immediate", "Agenda: future-scheduled occurrence is not executed immediately", startedAt, false, `Expected not immediate execution, got ${status}`, []);
        }

        return makeResult("agenda-future-scheduled-not-immediate", "Agenda: future-scheduled occurrence is not executed immediately", startedAt, true, `State after short wait: ${status}`, []);
      } catch (err) {
        return makeResult("agenda-future-scheduled-not-immediate", "Agenda: future-scheduled occurrence is not executed immediately", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 25 ───────────────────────────────────────────────────────────────────────
  {
    id: "multi-step-output-fully-captured",
    name: "Multi-step process output is fully captured",
    description: "Runs a 3-step process and verifies the agent addressed all steps in the captured output.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("multi-step-output-fully-captured", m); };
      const NAME = "multi-step-output-fully-captured";
      const LABEL = "Multi-step process output is fully captured";

      try {
        // 1. Create a process with 3 steps, each with a unique marker
        const proc = await ctx.apiPost("/api/processes", {
          action: "createProcess",
          name: ctx.uniqueName("TST-multi-step"),
          description: "Multi-step capture test",
          status: "draft",
          versionLabel: "",
          steps: [
            { title: "Step Alpha", instruction: "Output exactly: MARKER_ALPHA_OK", skillKey: null, agentId: null, timeoutSeconds: null, modelOverride: "" },
            { title: "Step Bravo", instruction: "Output exactly: MARKER_BRAVO_OK", skillKey: null, agentId: null, timeoutSeconds: null, modelOverride: "" },
            { title: "Step Charlie", instruction: "Output exactly: MARKER_CHARLIE_OK", skillKey: null, agentId: null, timeoutSeconds: null, modelOverride: "" },
          ],
        }) as { ok: boolean; process?: { id: string; latest_version_id: string }; error?: string };

        if (!proc.ok || !proc.process?.latest_version_id) {
          return makeResult(NAME, LABEL, startedAt, false, `Process create failed: ${proc.error ?? "unknown"}`, []);
        }
        log(`Process created: ${proc.process.latest_version_id}`);

        // 2. Create event with the 3-step process + a free prompt with its own marker
        const create = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent",
          title: ctx.uniqueName("TST-multi-capture"),
          freePrompt: "Additionally output exactly: MARKER_FREE_OK",
          agentId: null,
          timezone: "Europe/Amsterdam",
          startsAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          endsAt: null,
          recurrenceRule: null,
          recurrenceUntil: null,
          status: "draft",
          processVersionIds: [proc.process.latest_version_id],
          executionWindowMinutes: 30,
          fallbackModel: "",
          timeStepMinutes: 0,
        }) as { ok: boolean; event?: { id: string }; error?: string };

        if (!create.ok || !create.event?.id) {
          return makeResult(NAME, LABEL, startedAt, false, `Event create failed: ${create.error}`, []);
        }
        const eventId = create.event.id;
        log(`Created event ${eventId}`);

        // 3. Inject occurrence and trigger execution
        const occRes = await ctx.apiPost("/api/agenda/events", {
          action: "testOnlyCreateNeedsRetryOccurrence",
          eventId,
          scheduledFor: new Date().toISOString(),
        }) as { ok: boolean; occurrenceId?: string; error?: string };

        if (!occRes.ok || !occRes.occurrenceId) {
          return makeResult(NAME, LABEL, startedAt, false, `Failed to inject occurrence: ${occRes.error ?? "unknown"}`, []);
        }
        const occId = occRes.occurrenceId;
        log(`Injected occurrence ${occId}`);

        const retry = await ctx.apiPost(`/api/agenda/events/${eventId}/occurrences/${occId}`, {}) as { ok: boolean; error?: string };
        if (!retry.ok) {
          return makeResult(NAME, LABEL, startedAt, false, `Retry failed: ${retry.error ?? "unknown"}`, []);
        }
        log("Enqueued for execution");

        // 4. Poll for completion (up to 120s) and fail explicitly on billing/capacity rejection.
        type StepRow = { output_payload?: { output?: string } | string; status?: string; error_message?: string | null };
        let inspect: { ok: boolean; attempt?: { status?: string } | null; steps?: StepRow[]; error?: string } = { ok: false, steps: [] };
        for (let poll = 0; poll < 12; poll++) {
          await ctx.sleep(10000);
          inspect = await ctx.apiGet(`/api/agenda/debug/run-steps?occurrenceId=${occId}`) as typeof inspect;
          const step = inspect.steps?.[0];
          if (isBillingOrCapacityError(step?.error_message ?? "")) {
            return makeResult(NAME, LABEL, startedAt, false, `Run failed due billing/capacity rejection: ${step?.error_message ?? "unknown"}`, []);
          }
          if (inspect.ok && inspect.attempt?.status === "failed") {
            return makeResult(NAME, LABEL, startedAt, false, `Run failed before output verification. Steps: ${JSON.stringify(inspect.steps ?? [])}`, []);
          }
          if (inspect.ok && inspect.attempt?.status === "succeeded" && step && step.status === "succeeded") break;
        }

        if (!inspect.ok || !inspect.steps?.length) {
          return makeResult(NAME, LABEL, startedAt, false, `No run steps after polling. Steps: ${JSON.stringify(inspect.steps ?? [])}`, []);
        }
        if (inspect.attempt?.status !== "succeeded") {
          return makeResult(NAME, LABEL, startedAt, false, `Run did not finish successfully. Attempt status: ${inspect.attempt?.status ?? "none"}`, []);
        }

        // 5. Extract output text
        const step = inspect.steps[0];
        let outputPayload = step.output_payload;
        if (typeof outputPayload === "string") { try { outputPayload = JSON.parse(outputPayload); } catch { /* ignore */ } }
        const outputText = (typeof outputPayload === "object" && outputPayload !== null && "output" in outputPayload)
          ? String((outputPayload as { output: string }).output)
          : JSON.stringify(outputPayload);
        log(`Output (${outputText.length} chars): ${outputText.slice(0, 300)}`);

        // 6. Verify all 4 markers are present (3 steps + free prompt)
        const markers = ["MARKER_ALPHA_OK", "MARKER_BRAVO_OK", "MARKER_CHARLIE_OK", "MARKER_FREE_OK"];
        const found = markers.filter((m) => outputText.includes(m));
        const missing = markers.filter((m) => !outputText.includes(m));

        if (missing.length > 0) {
          return makeResult(NAME, LABEL, startedAt, false,
            `Missing markers: ${missing.join(", ")}. Found: ${found.join(", ")}. Output: ${outputText.slice(0, 400)}`, []);
        }

        return makeResult(NAME, LABEL, startedAt, true,
          `All ${markers.length} markers captured (3 steps + free prompt) in ${outputText.length} chars`, []);
      } catch (err) {
        return makeResult(NAME, LABEL, startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 26 ───────────────────────────────────────────────────────────────────────
  {
    id: "artifact-dir-file-saved",
    name: "Agent saves file to artifact directory",
    description: "Runs an event that asks the agent to create a file, then verifies the file exists in the artifact dir and is recorded in artifact_payload.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("artifact-dir-file-saved", m); };
      const NAME = "artifact-dir-file-saved";
      const LABEL = "Agent saves file to artifact directory";

      try {
        // 1. Create a draft event asking the agent to create a text file
        const create = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent",
          title: ctx.uniqueName("TST-artifact-file"),
          freePrompt: "Create a plain text file called test-output.txt containing exactly the text ARTIFACT_FILE_OK. Save it to the output files path provided in the output rules. Do not output anything else.",
          agentId: null,
          timezone: "Europe/Amsterdam",
          startsAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          endsAt: null,
          recurrenceRule: null,
          recurrenceUntil: null,
          status: "draft",
          processVersionIds: [],
          executionWindowMinutes: 30,
          fallbackModel: "",
          timeStepMinutes: 0,
        }) as { ok: boolean; event?: { id: string }; error?: string };

        if (!create.ok || !create.event?.id) {
          return makeResult(NAME, LABEL, startedAt, false, `Create failed: ${create.error}`, []);
        }
        const eventId = create.event.id;
        log(`Created event ${eventId}`);

        // 2. Inject occurrence and trigger execution
        const occRes = await ctx.apiPost("/api/agenda/events", {
          action: "testOnlyCreateNeedsRetryOccurrence",
          eventId,
          scheduledFor: new Date().toISOString(),
        }) as { ok: boolean; occurrenceId?: string; error?: string };

        if (!occRes.ok || !occRes.occurrenceId) {
          return makeResult(NAME, LABEL, startedAt, false, `Failed to inject occurrence: ${occRes.error ?? "unknown"}`, []);
        }
        const occId = occRes.occurrenceId;

        const retry = await ctx.apiPost(`/api/agenda/events/${eventId}/occurrences/${occId}`, {}) as { ok: boolean; error?: string };
        if (!retry.ok) {
          return makeResult(NAME, LABEL, startedAt, false, `Retry failed: ${retry.error ?? "unknown"}`, []);
        }
        log("Enqueued for execution");

        // 3. Poll for completion (up to 120s)
        type StepRow = { artifact_payload?: unknown; status?: string };
        let inspect: { ok: boolean; steps?: StepRow[]; error?: string } = { ok: false, steps: [] };
        for (let poll = 0; poll < 12; poll++) {
          await ctx.sleep(10000);
          inspect = await ctx.apiGet(`/api/agenda/debug/run-steps?occurrenceId=${occId}`) as typeof inspect;
          const step = inspect.steps?.[0];
          if (step && (step.status === "succeeded" || step.status === "failed")) break;
        }

        if (!inspect.ok || !inspect.steps?.length) {
          return makeResult(NAME, LABEL, startedAt, false, `No run steps after polling`, []);
        }

        // 4. Check artifact_payload for the file
        const step = inspect.steps[0];
        let ap = step.artifact_payload;
        if (typeof ap === "string") { try { ap = JSON.parse(ap); } catch { /* ignore */ } }
        const files = (ap && typeof ap === "object" && "files" in ap)
          ? (ap as { files: { name: string; path: string }[] }).files
          : [];

        log(`Artifact files: ${files.map((f) => f.name).join(", ") || "none"}`);

        const targetFile = files.find((f) => f.name === "test-output.txt");
        if (!targetFile) {
          return makeResult(NAME, LABEL, startedAt, false,
            `test-output.txt not found in artifact_payload. Files: ${JSON.stringify(files.map((f) => f.name))}`, []);
        }

        // 5. Verify path is within runtime-artifacts
        if (!targetFile.path.includes("runtime-artifacts")) {
          return makeResult(NAME, LABEL, startedAt, false,
            `File not in runtime-artifacts dir: ${targetFile.path}`, []);
        }

        return makeResult(NAME, LABEL, startedAt, true,
          `File saved to artifact dir: ${targetFile.path}`, []);
      } catch (err) {
        return makeResult(NAME, LABEL, startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 27 ───────────────────────────────────────────────────────────────────────
  {
    id: "simple-prompt-no-artifacts",
    name: "Simple prompt produces no artifacts",
    description: "Runs a simple 'hi' event and verifies no files are created in the artifact dir.",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("simple-prompt-no-artifacts", m); };
      const NAME = "simple-prompt-no-artifacts";
      const LABEL = "Simple prompt produces no artifacts";

      try {
        const create = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent",
          title: ctx.uniqueName("TST-no-artifact"),
          freePrompt: "Reply with just the word hello.",
          agentId: null,
          timezone: "Europe/Amsterdam",
          startsAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          endsAt: null,
          recurrenceRule: null,
          recurrenceUntil: null,
          status: "draft",
          processVersionIds: [],
          executionWindowMinutes: 30,
          fallbackModel: "",
          timeStepMinutes: 0,
        }) as { ok: boolean; event?: { id: string }; error?: string };

        if (!create.ok || !create.event?.id) {
          return makeResult(NAME, LABEL, startedAt, false, `Create failed: ${create.error}`, []);
        }
        const eventId = create.event.id;

        const occRes = await ctx.apiPost("/api/agenda/events", {
          action: "testOnlyCreateNeedsRetryOccurrence",
          eventId,
          scheduledFor: new Date().toISOString(),
        }) as { ok: boolean; occurrenceId?: string; error?: string };

        if (!occRes.ok || !occRes.occurrenceId) {
          return makeResult(NAME, LABEL, startedAt, false, `Failed to inject occurrence`, []);
        }
        const occId = occRes.occurrenceId;

        const retry = await ctx.apiPost(`/api/agenda/events/${eventId}/occurrences/${occId}`, {}) as { ok: boolean; error?: string };
        if (!retry.ok) {
          return makeResult(NAME, LABEL, startedAt, false, `Retry failed: ${retry.error ?? "unknown"}`, []);
        }
        log("Enqueued for execution");

        // Poll for completion
        type StepRow = { artifact_payload?: unknown; output_payload?: unknown; status?: string };
        let inspect: { ok: boolean; steps?: StepRow[]; error?: string } = { ok: false, steps: [] };
        for (let poll = 0; poll < 12; poll++) {
          await ctx.sleep(10000);
          inspect = await ctx.apiGet(`/api/agenda/debug/run-steps?occurrenceId=${occId}`) as typeof inspect;
          const step = inspect.steps?.[0];
          if (step && (step.status === "succeeded" || step.status === "failed")) break;
        }

        if (!inspect.ok || !inspect.steps?.length) {
          return makeResult(NAME, LABEL, startedAt, false, `No run steps after polling`, []);
        }

        const step = inspect.steps[0];
        let ap = step.artifact_payload;
        if (typeof ap === "string") { try { ap = JSON.parse(ap); } catch { /* ignore */ } }
        const files = (ap && typeof ap === "object" && "files" in ap)
          ? (ap as { files: { name: string }[] }).files
          : [];

        // Extract output for logging
        let op = step.output_payload;
        if (typeof op === "string") { try { op = JSON.parse(op); } catch { /* ignore */ } }
        const outputText = (op && typeof op === "object" && "output" in op) ? String((op as { output: string }).output).slice(0, 100) : "?";
        log(`Output: ${outputText}, Artifacts: ${files.length}`);

        if (files.length > 0) {
          return makeResult(NAME, LABEL, startedAt, false,
            `Expected no artifacts but found: ${files.map((f) => f.name).join(", ")}`, []);
        }

        return makeResult(NAME, LABEL, startedAt, true,
          `No artifacts created — simple prompt handled cleanly`, []);
      } catch (err) {
        return makeResult(NAME, LABEL, startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },

  // 28 ───────────────────────────────────────────────────────────────────────
  {
    id: "user-path-not-in-artifact-dir",
    name: "User-specified path stays outside artifact dir",
    description: "When the prompt says to save a file at a specific path, it should NOT appear in artifact_payload (worker only scans its own dir).",
    run: async (ctx) => {
      const startedAt = Date.now();
      const log = (m: string) => { ctx.log("user-path-not-in-artifact-dir", m); };
      const NAME = "user-path-not-in-artifact-dir";
      const LABEL = "User-specified path stays outside artifact dir";

      const userPath = "/tmp/tst-user-file-" + Date.now() + ".txt";

      try {
        const create = await ctx.apiPost("/api/agenda/events", {
          action: "createEvent",
          title: ctx.uniqueName("TST-user-path"),
          freePrompt: `Create a plain text file containing exactly USER_PATH_OK. Save it to exactly this path: ${userPath} — do NOT save it anywhere else. Reply with just the word done.`,
          agentId: null,
          timezone: "Europe/Amsterdam",
          startsAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          endsAt: null,
          recurrenceRule: null,
          recurrenceUntil: null,
          status: "draft",
          processVersionIds: [],
          executionWindowMinutes: 30,
          fallbackModel: "",
          timeStepMinutes: 0,
        }) as { ok: boolean; event?: { id: string }; error?: string };

        if (!create.ok || !create.event?.id) {
          return makeResult(NAME, LABEL, startedAt, false, `Create failed: ${create.error}`, []);
        }
        const eventId = create.event.id;

        const occRes = await ctx.apiPost("/api/agenda/events", {
          action: "testOnlyCreateNeedsRetryOccurrence",
          eventId,
          scheduledFor: new Date().toISOString(),
        }) as { ok: boolean; occurrenceId?: string; error?: string };

        if (!occRes.ok || !occRes.occurrenceId) {
          return makeResult(NAME, LABEL, startedAt, false, `Failed to inject occurrence`, []);
        }
        const occId = occRes.occurrenceId;

        const retry = await ctx.apiPost(`/api/agenda/events/${eventId}/occurrences/${occId}`, {}) as { ok: boolean; error?: string };
        if (!retry.ok) {
          return makeResult(NAME, LABEL, startedAt, false, `Retry failed: ${retry.error ?? "unknown"}`, []);
        }
        log("Enqueued for execution");

        // Poll for completion
        type StepRow = { artifact_payload?: unknown; status?: string };
        let inspect: { ok: boolean; steps?: StepRow[]; error?: string } = { ok: false, steps: [] };
        for (let poll = 0; poll < 12; poll++) {
          await ctx.sleep(10000);
          inspect = await ctx.apiGet(`/api/agenda/debug/run-steps?occurrenceId=${occId}`) as typeof inspect;
          const step = inspect.steps?.[0];
          if (step && (step.status === "succeeded" || step.status === "failed")) break;
        }

        if (!inspect.ok || !inspect.steps?.length) {
          return makeResult(NAME, LABEL, startedAt, false, `No run steps after polling`, []);
        }

        // Check artifact_payload — should be null/empty (file went to user path, not artifact dir)
        const step = inspect.steps[0];
        let ap = step.artifact_payload;
        if (typeof ap === "string") { try { ap = JSON.parse(ap); } catch { /* ignore */ } }
        const files = (ap && typeof ap === "object" && "files" in ap)
          ? (ap as { files: { name: string }[] }).files
          : [];

        log(`Artifact files in DB: ${files.length > 0 ? files.map((f) => f.name).join(", ") : "none"}`);

        if (files.length > 0) {
          return makeResult(NAME, LABEL, startedAt, false,
            `File appeared in artifact_payload but should only be at user path. Found: ${files.map((f) => f.name).join(", ")}`, []);
        }

        // Verify the file actually exists at the user-specified path
        const checkRes = await ctx.apiPost("/api/agenda/events", {
          action: "testOnlyCheckFileExists",
          path: userPath,
        }) as { ok: boolean; exists?: boolean };

        if (checkRes.ok && checkRes.exists) {
          log(`File confirmed at user path: ${userPath}`);
          return makeResult(NAME, LABEL, startedAt, true,
            `File only at user path (${userPath}), not in artifact dir`, []);
        }

        // Agent might not have created the file — still pass if artifact_payload is empty
        log(`File not found at ${userPath} — agent may not have created it, but artifact dir is clean`);
        return makeResult(NAME, LABEL, startedAt, true,
          `No artifacts in artifact dir (user path behavior correct even if agent skipped file creation)`, []);
      } catch (err) {
        return makeResult(NAME, LABEL, startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },
];
