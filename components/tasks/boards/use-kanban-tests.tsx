"use client";

import { useCallback, useRef, useState } from "react";
import type { TestContext, TestDefinition, TestResult, TestRun } from "./kanban-test-definitions";

const STORAGE_KEY = "mc-kanban-test-run-v1";

type LiveLogs = Record<string, string[]>;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function save<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function useKanbanTests(tests: TestDefinition[]) {
  const [testRun, setTestRun] = useState<TestRun | null>(() => load<TestRun | null>(STORAGE_KEY, null));
  const [liveLogs, setLiveLogs] = useState<LiveLogs>({});
  const interruptedRef = useRef(false);

  const appendLog = useCallback((testId: string, line: string) => {
    setLiveLogs((prev) => ({ ...prev, [testId]: [...(prev[testId] ?? []), line] }));
  }, []);

  const buildCtx = useCallback((): TestContext => ({
    log: appendLog,
    sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
    apiGet: async (path: string) => {
      const res = await fetch(path, { cache: "reload" });
      return await res.json();
    },
    apiPost: async (path: string, body: Record<string, unknown>) => {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return await res.json();
    },
  }), [appendLog]);

  const runTests = useCallback(async () => {
    interruptedRef.current = false;
    setLiveLogs({});

    const runId = `kanban-${Date.now()}`;
    const startedAt = Date.now();
    const results: Record<string, TestResult> = {};

    const initial: TestRun = { id: runId, startedAt, finishedAt: null, results: {}, interrupted: false };
    setTestRun(initial);
    save(STORAGE_KEY, initial);

    const ctx = buildCtx();

    for (const test of tests) {
      if (interruptedRef.current) break;

      const running: TestResult = {
        id: test.id,
        name: test.name,
        status: "running",
        startedAt: Date.now(),
        finishedAt: Date.now(),
        durationMs: 0,
        message: "Running...",
      };
      results[test.id] = running;
      setTestRun((prev) => {
        const next = prev ? { ...prev, results: { ...prev.results, [test.id]: running } } : prev;
        if (next) save(STORAGE_KEY, next);
        return next;
      });

      const out = await test.run(ctx);
      results[test.id] = out;
      setTestRun((prev) => {
        const next = prev ? { ...prev, results: { ...prev.results, [test.id]: out } } : prev;
        if (next) save(STORAGE_KEY, next);
        return next;
      });
    }

    const finished: TestRun = {
      id: runId,
      startedAt,
      finishedAt: Date.now(),
      results,
      interrupted: interruptedRef.current,
    };
    setTestRun(finished);
    save(STORAGE_KEY, finished);
  }, [buildCtx, tests]);

  const interruptTests = useCallback(() => {
    interruptedRef.current = true;
  }, []);

  const clearResults = useCallback(() => {
    interruptedRef.current = true;
    setTestRun(null);
    setLiveLogs({});
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { testRun, liveLogs, runTests, interruptTests, clearResults };
}
