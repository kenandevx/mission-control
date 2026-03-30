export type TestStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export type TestResult = {
  id: string;
  name: string;
  status: TestStatus;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  message: string;
  details?: string[];
};

export type TestContext = {
  log: (testId: string, line: string) => void;
  sleep: (ms: number) => Promise<void>;
  apiGet: (path: string) => Promise<unknown>;
  apiPost: (path: string, body: Record<string, unknown>) => Promise<unknown>;
};

export type TestDefinition = {
  id: string;
  name: string;
  description: string;
  run: (ctx: TestContext) => Promise<TestResult>;
};

export type TestRun = {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  results: Record<string, TestResult>;
  interrupted: boolean;
};

function makeResult(
  id: string,
  name: string,
  startedAt: number,
  pass: boolean,
  message: string,
  details: string[] = [],
): TestResult {
  const finishedAt = Date.now();
  return {
    id,
    name,
    status: pass ? "passed" : "failed",
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt - startedAt),
    message,
    details,
  };
}

function isoOffset(mins: number): string {
  const dt = new Date(Date.now() + mins * 60_000);
  dt.setSeconds(0, 0);
  return dt.toISOString();
}

export const KANBAN_TESTS: TestDefinition[] = [
  {
    id: "kanban-autostart-requires-assigned-agent",
    name: "Kanban: auto execution requires assigned agent",
    description: "Tickets should not auto-queue without assigned agent; with assigned agent they should be ready_to_execute.",
    run: async (ctx) => {
      const startedAt = Date.now();
      try {
        const board = await ctx.apiPost("/api/tasks", { action: "createBoard", name: `TST-board-${Date.now()}`, description: "" }) as { ok: boolean; board?: { id: string }; error?: string };
        if (!board.ok || !board.board?.id) return makeResult("kanban-autostart-requires-assigned-agent", "Kanban: auto execution requires assigned agent", startedAt, false, `Create board failed: ${board.error ?? "unknown"}`, []);

        const col = await ctx.apiPost("/api/tasks", { action: "createColumn", boardId: board.board.id, title: "Todo", colorKey: "slate", isDefault: true }) as { ok: boolean; column?: { id: string }; error?: string };
        if (!col.ok || !col.column?.id) return makeResult("kanban-autostart-requires-assigned-agent", "Kanban: auto execution requires assigned agent", startedAt, false, `Create column failed: ${col.error ?? "unknown"}`, []);

        const noAgent = await ctx.apiPost("/api/tasks", {
          action: "createTicket",
          boardId: board.board.id,
          columnId: col.column.id,
          title: `TST-no-agent-${Date.now()}`,
          description: "",
          executionMode: "direct",
          executionState: "ready_to_execute",
          assignedAgentId: "",
        }) as { ok: boolean; ticket?: { execution_state: string }; error?: string };
        if (!noAgent.ok || !noAgent.ticket) return makeResult("kanban-autostart-requires-assigned-agent", "Kanban: auto execution requires assigned agent", startedAt, false, `Create ticket(no agent) failed: ${noAgent.error ?? "unknown"}`, []);
        if (noAgent.ticket.execution_state !== "open") {
          return makeResult("kanban-autostart-requires-assigned-agent", "Kanban: auto execution requires assigned agent", startedAt, false, `Expected open without agent, got ${noAgent.ticket.execution_state}`, []);
        }

        const withAgent = await ctx.apiPost("/api/tasks", {
          action: "createTicket",
          boardId: board.board.id,
          columnId: col.column.id,
          title: `TST-with-agent-${Date.now()}`,
          description: "",
          executionMode: "direct",
          executionState: "open",
          assignedAgentId: "main",
        }) as { ok: boolean; ticket?: { execution_state: string }; error?: string };
        if (!withAgent.ok || !withAgent.ticket) return makeResult("kanban-autostart-requires-assigned-agent", "Kanban: auto execution requires assigned agent", startedAt, false, `Create ticket(with agent) failed: ${withAgent.error ?? "unknown"}`, []);
        if (withAgent.ticket.execution_state !== "ready_to_execute") {
          return makeResult("kanban-autostart-requires-assigned-agent", "Kanban: auto execution requires assigned agent", startedAt, false, `Expected ready_to_execute with agent, got ${withAgent.ticket.execution_state}`, []);
        }

        return makeResult("kanban-autostart-requires-assigned-agent", "Kanban: auto execution requires assigned agent", startedAt, true, "No-agent ticket stayed open; assigned-agent ticket moved to ready_to_execute", []);
      } catch (err) {
        return makeResult("kanban-autostart-requires-assigned-agent", "Kanban: auto execution requires assigned agent", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },
  {
    id: "kanban-schedule-interval-validation",
    name: "Kanban: scheduled time interval validation",
    description: "Scheduled tickets must respect 15-minute intervals by default, or custom dev step when provided.",
    run: async (ctx) => {
      const startedAt = Date.now();
      try {
        const board = await ctx.apiPost("/api/tasks", { action: "createBoard", name: `TST-board-step-${Date.now()}`, description: "" }) as { ok: boolean; board?: { id: string }; error?: string };
        if (!board.ok || !board.board?.id) return makeResult("kanban-schedule-interval-validation", "Kanban: scheduled time interval validation", startedAt, false, `Create board failed: ${board.error ?? "unknown"}`, []);

        const col = await ctx.apiPost("/api/tasks", { action: "createColumn", boardId: board.board.id, title: "Todo", colorKey: "slate", isDefault: true }) as { ok: boolean; column?: { id: string }; error?: string };
        if (!col.ok || !col.column?.id) return makeResult("kanban-schedule-interval-validation", "Kanban: scheduled time interval validation", startedAt, false, `Create column failed: ${col.error ?? "unknown"}`, []);

        const badDefault = new Date(Date.now() + 8 * 60 * 1000);
        badDefault.setSeconds(0, 0);
        if ([0, 15, 30, 45].includes(badDefault.getMinutes())) badDefault.setMinutes(badDefault.getMinutes() + 7);

        const resDefault = await ctx.apiPost("/api/tasks", {
          action: "createTicket",
          boardId: board.board.id,
          columnId: col.column.id,
          title: `TST-step-default-${Date.now()}`,
          assignedAgentId: "main",
          scheduledFor: badDefault.toISOString(),
        }) as { ok: boolean; error?: string };

        if (resDefault.ok) return makeResult("kanban-schedule-interval-validation", "Kanban: scheduled time interval validation", startedAt, false, "Expected default 15-minute validation rejection", []);

        const bad30 = new Date(Date.now() + 40 * 60 * 1000);
        bad30.setSeconds(0, 0);
        if (bad30.getMinutes() % 30 === 0) bad30.setMinutes(bad30.getMinutes() + 15);

        const res30 = await ctx.apiPost("/api/tasks", {
          action: "createTicket",
          boardId: board.board.id,
          columnId: col.column.id,
          title: `TST-step-30-${Date.now()}`,
          assignedAgentId: "main",
          scheduledFor: bad30.toISOString(),
          timeStepMinutes: 30,
        }) as { ok: boolean; error?: string };

        if (res30.ok) return makeResult("kanban-schedule-interval-validation", "Kanban: scheduled time interval validation", startedAt, false, "Expected 30-minute custom-step validation rejection", []);

        // Happy path aligned schedule
        const good = isoOffset(30);
        const resGood = await ctx.apiPost("/api/tasks", {
          action: "createTicket",
          boardId: board.board.id,
          columnId: col.column.id,
          title: `TST-step-good-${Date.now()}`,
          assignedAgentId: "main",
          scheduledFor: good,
        }) as { ok: boolean; error?: string };

        if (!resGood.ok) return makeResult("kanban-schedule-interval-validation", "Kanban: scheduled time interval validation", startedAt, false, `Expected aligned schedule success, got ${resGood.error ?? "unknown"}`, []);

        return makeResult("kanban-schedule-interval-validation", "Kanban: scheduled time interval validation", startedAt, true, "Kanban scheduling validates default/custom step and allows aligned schedule", []);
      } catch (err) {
        return makeResult("kanban-schedule-interval-validation", "Kanban: scheduled time interval validation", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },
  {
    id: "kanban-future-scheduled-not-immediate",
    name: "Kanban: future-scheduled ticket is not executed immediately",
    description: "A ticket scheduled in the future should remain queued/ready and not jump to executing/done right away.",
    run: async (ctx) => {
      const startedAt = Date.now();
      try {
        const board = await ctx.apiPost("/api/tasks", { action: "createBoard", name: `TST-board-future-${Date.now()}`, description: "" }) as { ok: boolean; board?: { id: string }; error?: string };
        if (!board.ok || !board.board?.id) return makeResult("kanban-future-scheduled-not-immediate", "Kanban: future-scheduled ticket is not executed immediately", startedAt, false, `Create board failed: ${board.error ?? "unknown"}`, []);

        const col = await ctx.apiPost("/api/tasks", { action: "createColumn", boardId: board.board.id, title: "Todo", colorKey: "slate", isDefault: true }) as { ok: boolean; column?: { id: string }; error?: string };
        if (!col.ok || !col.column?.id) return makeResult("kanban-future-scheduled-not-immediate", "Kanban: future-scheduled ticket is not executed immediately", startedAt, false, `Create column failed: ${col.error ?? "unknown"}`, []);

        const starts = isoOffset(30);
        const created = await ctx.apiPost("/api/tasks", {
          action: "createTicket",
          boardId: board.board.id,
          columnId: col.column.id,
          title: `TST-future-${Date.now()}`,
          assignedAgentId: "main",
          executionMode: "direct",
          executionState: "open",
          scheduledFor: starts,
        }) as { ok: boolean; ticket?: { id: string; execution_state: string }; error?: string };

        if (!created.ok || !created.ticket?.id) return makeResult("kanban-future-scheduled-not-immediate", "Kanban: future-scheduled ticket is not executed immediately", startedAt, false, `Create ticket failed: ${created.error ?? "unknown"}`, []);

        await ctx.sleep(4000);
        const all = await ctx.apiGet("/api/tasks") as { ok: boolean; tickets?: Array<{ id: string; execution_state: string }>; error?: string };
        const t = (all.tickets ?? []).find((x) => x.id === created.ticket!.id);
        if (!t) return makeResult("kanban-future-scheduled-not-immediate", "Kanban: future-scheduled ticket is not executed immediately", startedAt, false, "Ticket not found after creation", []);

        if (["executing", "done"].includes(t.execution_state)) {
          return makeResult("kanban-future-scheduled-not-immediate", "Kanban: future-scheduled ticket is not executed immediately", startedAt, false, `Expected not to execute immediately, got state=${t.execution_state}`, []);
        }

        return makeResult("kanban-future-scheduled-not-immediate", "Kanban: future-scheduled ticket is not executed immediately", startedAt, true, `State after short wait: ${t.execution_state}`, []);
      } catch (err) {
        return makeResult("kanban-future-scheduled-not-immediate", "Kanban: future-scheduled ticket is not executed immediately", startedAt, false, `Exception: ${err instanceof Error ? err.message : String(err)}`, []);
      }
    },
  },
];
