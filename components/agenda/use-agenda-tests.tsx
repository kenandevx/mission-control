"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const APPROVAL_KEY = "mc-agenda-test-approval-mode";
import type { TestDefinition, TestResult, TestRun, TestContext, AgendaSettings } from "./agenda-test-definitions";

export type { TestDefinition, TestResult, TestRun, TestContext };

const STORAGE_KEY = "mc-agenda-test-run";
const LOGS_KEY = "mc-agenda-test-logs";

// ── Persist to / restore from localStorage ─────────────────────────────────────

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota errors */
  }
}

// ── useAgendaTests hook ───────────────────────────────────────────────────────

export function useAgendaTests(tests: TestDefinition[]) {
  // Hydrate from localStorage on mount so results survive navigation
  const [testRun, setTestRun] = useState<TestRun | null>(() =>
    loadFromStorage<TestRun | null>(STORAGE_KEY, null)
  );
  const [liveLogs, setLiveLogs] = useState<Record<string, string[]>>(() =>
    loadFromStorage<Record<string, string[]>>(LOGS_KEY, {})
  );
  const [requireApprovalBetweenTests, setRequireApprovalBetweenTests] = useState<boolean>(() =>
    loadFromStorage<boolean>(APPROVAL_KEY, true)
  );
  const [waitingApprovalForTestId, setWaitingApprovalForTestId] = useState<string | null>(null);

  const runningRef = useRef(false);
  const interruptedRef = useRef(false);
  const approvalResolverRef = useRef<(() => void) | null>(null);

  // Persist whenever state changes (outside of active run — we save final results)
  useEffect(() => {
    if (!runningRef.current) {
      saveToStorage(STORAGE_KEY, testRun);
    }
  }, [testRun]);

  useEffect(() => {
    if (!runningRef.current) {
      saveToStorage(LOGS_KEY, liveLogs);
    }
  }, [liveLogs]);

  useEffect(() => {
    saveToStorage(APPROVAL_KEY, requireApprovalBetweenTests);
  }, [requireApprovalBetweenTests]);

  const log = useCallback((testId: string, msg: string) => {
    setLiveLogs((prev) => {
      const existing = prev[testId] ?? [];
      const next = { ...prev, [testId]: [...existing, msg] };
      saveToStorage(LOGS_KEY, next);
      return next;
    });
  }, []);

  const sleep = useCallback((ms: number) => new Promise<void>((r) => setTimeout(r, ms)), []);

  const counterRef = useRef(0);
  const uniqueName = useCallback((prefix: string) => {
    counterRef.current += 1;
    return `${prefix}-${Date.now()}-${counterRef.current}`;
  }, []);

  const apiGet = useCallback(async (path: string) => {
    const res = await fetch(path, { cache: "reload" });
    return res.json() as Promise<Record<string, unknown>>;
  }, []);

  const apiPost = useCallback(async (path: string, body: Record<string, unknown>) => {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return res.json() as Promise<Record<string, unknown>>;
  }, []);

  const apiPatch = useCallback(async (path: string, body: Record<string, unknown>) => {
    const res = await fetch(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return res.json() as Promise<Record<string, unknown>>;
  }, []);

  const apiDelete = useCallback(async (path: string) => {
    const res = await fetch(path, { method: "DELETE" });
    return res.json() as Promise<Record<string, unknown>>;
  }, []);

  const resetTestEvents = useCallback(async (): Promise<number> => {
    let deleted = 0;

    // Delete all agenda events (hard delete cleans DB + cancels cron jobs)
    const list = await apiGet("/api/agenda/events") as { events?: Array<{ id?: string }> };
    for (const event of (list.events ?? [])) {
      const id = String(event?.id ?? "").trim();
      if (!id) continue;
      try {
        const res = await apiDelete(`/api/agenda/events/${id}?hard=1`) as { ok?: boolean };
        if (res.ok) deleted += 1;
      } catch { /* ignore */ }
    }

    // Delete all processes (test-created ones have TST- prefix, but clean all for safety)
    try {
      const procs = await apiGet("/api/processes") as { processes?: Array<{ id?: string }> };
      for (const proc of (procs.processes ?? [])) {
        const id = String(proc?.id ?? "").trim();
        if (!id) continue;
        try { await apiDelete(`/api/processes/${id}?force=1`); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }

    return deleted;
  }, [apiGet, apiDelete]);

  const buildCtx = useCallback((settings: AgendaSettings): TestContext => ({
    log,
    apiGet,
    apiPost,
    apiPatch,
    apiDelete,
    sleep,
    uniqueName,
    settings,
    resetTestEvents,
  }), [log, apiGet, apiPost, apiPatch, apiDelete, sleep, uniqueName, resetTestEvents]);

  const waitForApproval = useCallback(async (testId: string) => {
    setWaitingApprovalForTestId(testId);
    await new Promise<void>((resolve) => {
      approvalResolverRef.current = () => {
        approvalResolverRef.current = null;
        setWaitingApprovalForTestId(null);
        resolve();
      };
    });
  }, []);

  const approveNextTest = useCallback(() => {
    approvalResolverRef.current?.();
  }, []);

  const runTests = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    interruptedRef.current = false;

    const runId = `run-${Date.now()}`;
    const startedAt = Date.now();
    const results: Record<string, TestResult> = {};

    setLiveLogs({});
    const initial: TestRun = { id: runId, startedAt, finishedAt: null, results: {}, interrupted: false };
    setTestRun(initial);
    saveToStorage(STORAGE_KEY, initial);

    // Fetch settings once for the entire run.
    // Test timing rules:
    // - setting missing/unset => use 15 minutes
    // - setting = 0 (free time) => use 1 minute for tests so dev runs stay fast
    // - setting > 0 => use that exact value
    let agendaSettings: AgendaSettings;
    try {
      const raw = await apiGet("/api/agenda/settings") as Record<string, unknown>;
      const rawInterval = Number(raw.schedulingIntervalMinutes);
      const schedulingIntervalMinutes = Number.isFinite(rawInterval) && rawInterval >= 0 ? Math.floor(rawInterval) : 15;
      const testSchedulingIntervalMinutes = schedulingIntervalMinutes === 0 ? 1 : schedulingIntervalMinutes;
      agendaSettings = {
        schedulingIntervalMinutes,
        testSchedulingIntervalMinutes,
        defaultExecutionWindowMinutes: Number(raw.defaultExecutionWindowMinutes ?? 30),
        maxRetries: Number(raw.maxRetries ?? 1),
        ...raw,
      };
    } catch {
      agendaSettings = {
        schedulingIntervalMinutes: 15,
        testSchedulingIntervalMinutes: 15,
        defaultExecutionWindowMinutes: 30,
        maxRetries: 1,
      };
    }

    // Clean slate once at the start of the run
    try {
      const cleanCtx = buildCtx(agendaSettings);
      const cleaned = await cleanCtx.resetTestEvents();
      if (cleaned > 0) log("_setup", `Reset: deleted ${cleaned} events + processes`);
    } catch { /* non-fatal */ }

    for (const test of tests) {
      if (interruptedRef.current) break;

      if (!test.skipReset) {
        try {
          const cleanCtx = buildCtx(agendaSettings);
          const cleaned = await cleanCtx.resetTestEvents();
          log(test.id, `Pre-test reset removed ${cleaned} event(s)`);
        } catch (err) {
          log(test.id, `Pre-test reset warning: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        log(test.id, "skipReset=true — preserving prior agenda state for this test");
      }

      const runningResult: TestResult = {
        id: test.id,
        name: test.name,
        description: test.description,
        status: "running",
        passed: false,
        message: "Running...",
        logs: [],
        durationMs: 0,
        startedAt: Date.now(),
        finishedAt: null,
      };

      results[test.id] = runningResult;
      setTestRun((prev) => {
        if (!prev) return prev;
        const next = { ...prev, results: { ...results } };
        saveToStorage(STORAGE_KEY, next);
        return next;
      });

      const ctx = buildCtx(agendaSettings);
      const result = await test.run(ctx);

      if (interruptedRef.current) {
        result.status = "skipped";
        result.message = "Interrupted";
      }

      results[test.id] = result;
      setTestRun((prev) => {
        if (!prev) return prev;
        const next = { ...prev, results: { ...results } };
        saveToStorage(STORAGE_KEY, next);
        return next;
      });

      if (requireApprovalBetweenTests && !interruptedRef.current) {
        log(test.id, "Paused — waiting for manual approval before reset/next test");
        await waitForApproval(test.id);
      }

      if (!test.skipReset && !interruptedRef.current) {
        try {
          const cleanCtx = buildCtx(agendaSettings);
          const cleaned = await cleanCtx.resetTestEvents();
          log(test.id, `Post-test reset removed ${cleaned} event(s)`);
        } catch (err) {
          log(test.id, `Post-test reset warning: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    setWaitingApprovalForTestId(null);
    runningRef.current = false;
    const finished: TestRun = {
      id: runId,
      startedAt,
      finishedAt: Date.now(),
      results: { ...results },
      interrupted: interruptedRef.current,
    };
    setTestRun(finished);
    saveToStorage(STORAGE_KEY, finished);
  }, [tests, buildCtx, apiGet, log, requireApprovalBetweenTests, waitForApproval]);

  const interruptTests = useCallback(() => {
    interruptedRef.current = true;
    approvalResolverRef.current?.();
  }, []);

  const clearResults = useCallback(() => {
    setTestRun(null);
    setLiveLogs({});
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LOGS_KEY);
    } catch { /* ignore */ }
  }, []);

  const cleanupAllEvents = useCallback(async (): Promise<{ deleted: number; failed: number }> => {
    const list = await apiGet("/api/agenda/events") as { ok?: boolean; events?: Array<{ id?: string }> };
    const events = Array.isArray(list.events) ? list.events : [];

    let deleted = 0;
    let failed = 0;

    for (const event of events) {
      const id = String(event?.id || "").trim();
      if (!id) continue;
      try {
        const res = await apiDelete(`/api/agenda/events/${id}?hard=1`) as { ok?: boolean };
        if (res.ok) deleted += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }

    return { deleted, failed };
  }, [apiDelete, apiGet]);

  return {
    testRun,
    liveLogs,
    requireApprovalBetweenTests,
    setRequireApprovalBetweenTests,
    waitingApprovalForTestId,
    approveNextTest,
    runTests,
    interruptTests,
    clearResults,
    cleanupAllEvents,
  };
}
