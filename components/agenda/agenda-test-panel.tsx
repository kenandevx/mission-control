"use client";

import { useState, useSyncExternalStore } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  IconPlayerPlay,
  IconX,
  IconCheck,
  IconAlertTriangle,
  IconClock,
  IconChevronDown,
  IconChevronRight,
  IconBug,
  IconShieldCheck,
  IconRefresh,
  IconPlayerTrackNext,
} from "@tabler/icons-react";
import { useAgendaTests } from "./use-agenda-tests";
import { AGENDA_TESTS } from "./agenda-test-definitions";
import type { TestResult } from "./agenda-test-definitions";

function statusIcon(status: TestResult["status"]) {
  switch (status) {
    case "passed": return <IconCheck className="size-4 text-emerald-500" />;
    case "failed":  return <IconAlertTriangle className="size-4 text-red-500" />;
    case "running": return <div className="size-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />;
    case "skipped": return <IconX className="size-4 text-muted-foreground" />;
    default:        return <IconClock className="size-4 text-muted-foreground" />;
  }
}

function statusBadge(status: TestResult["status"]) {
  switch (status) {
    case "passed": return <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 text-xs gap-1"><span className="size-1.5 rounded-full bg-emerald-500 shrink-0" />Passed</Badge>;
    case "failed":  return <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-600 text-xs gap-1"><span className="size-1.5 rounded-full bg-red-500 shrink-0" />Failed</Badge>;
    case "running": return <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-xs gap-1"><div className="size-1.5 rounded-full border border-primary border-t-transparent animate-spin shrink-0" />Running</Badge>;
    case "skipped": return <Badge variant="outline" className="text-muted-foreground text-xs gap-1">Skipped</Badge>;
    default:        return <Badge variant="outline" className="text-muted-foreground text-xs">Pending</Badge>;
  }
}

function TestRow({ result, logs, isExpanded, onToggle }: {
  result: TestResult;
  logs: string[];
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const isRunning = result.status === "running";

  return (
    <div className="rounded-lg border bg-card shadow-xs overflow-hidden">
      {/* Header row */}
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left cursor-pointer"
        onClick={onToggle}
      >
        <div className="shrink-0">
          {statusIcon(result.status)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">{result.name}</span>
            {statusBadge(result.status)}
          </div>
          {result.finishedAt && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {result.durationMs < 1000
                ? `${result.durationMs}ms`
                : `${(result.durationMs / 1000).toFixed(1)}s`}
              {result.message && result.status !== "running" && (
                <span className="ml-2 text-foreground/60">{result.message}</span>
              )}
            </div>
          )}
          {isRunning && (
            <div className="text-xs text-primary mt-0.5 animate-pulse">Running...</div>
          )}
        </div>
        <div className="shrink-0 text-muted-foreground">
          {isExpanded ? <IconChevronDown className="size-4" /> : <IconChevronRight className="size-4" />}
        </div>
      </button>

      {/* Expanded log view */}
      {isExpanded && (
        <div className="border-t bg-muted/20">
          <ScrollArea className="max-h-[300px]">
            <div className="px-4 py-3 font-mono text-xs space-y-1">
              {logs.length === 0 && (
                <div className="text-muted-foreground italic">No logs yet.</div>
              )}
              {logs.map((line, i) => (
                <div key={i} className="text-foreground/80 leading-relaxed whitespace-pre-wrap break-all">
                  {line}
                </div>
              ))}
              {result.status === "pending" && (
                <div className="text-muted-foreground italic">Test has not started.</div>
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

function SummaryBar({ results, running }: {
  results: Record<string, TestResult>;
  running: boolean;
}) {
  const all = Object.values(results);
  const passed = all.filter((r) => r.status === "passed").length;
  const failed = all.filter((r) => r.status === "failed").length;
  const done = all.filter((r) => r.status === "passed" || r.status === "failed" || r.status === "skipped").length;
  const total = AGENDA_TESTS.length;

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {running ? (
        <div className="flex items-center gap-2 text-sm text-primary">
          <div className="size-2 rounded-full bg-primary animate-pulse" />
          Running tests...
          <span className="text-xs text-muted-foreground ml-2">{done}/{total}</span>
        </div>
      ) : done > 0 ? (
        <>
          <div className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            <IconShieldCheck className="size-4" />
            {passed} passed
          </div>
          {failed > 0 && (
            <div className="flex items-center gap-1.5 text-sm font-semibold text-red-600 dark:text-red-400">
              <IconAlertTriangle className="size-4" />
              {failed} failed
            </div>
          )}
          <div className="text-xs text-muted-foreground ml-auto">
            {done}/{total} tests · {all.filter((r) => r.status === "skipped").length} skipped
          </div>
        </>
      ) : (
        <div className="text-xs text-muted-foreground">
          {total} tests available — click Run Tests to execute
        </div>
      )}
    </div>
  );
}

export function AgendaTestPanel() {
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [expandedTests, setExpandedTests] = useState<Set<string>>(new Set());
  const {
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
  } = useAgendaTests(AGENDA_TESTS);

  const devModeEnabled = useSyncExternalStore(
    (onStoreChange) => {
      const handler = () => onStoreChange();
      window.addEventListener("mc-dev-mode-changed", handler as EventListener);
      window.addEventListener("storage", handler as EventListener);
      return () => {
        window.removeEventListener("mc-dev-mode-changed", handler as EventListener);
        window.removeEventListener("storage", handler as EventListener);
      };
    },
    () => localStorage.getItem("mc-dev-mode") === "1",
    () => false,
  );

  const isRunning = testRun && !testRun.finishedAt;

  const toggleExpand = (id: string) => {
    setExpandedTests((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRun = async () => {
    setExpandedTests(new Set());
    clearResults();
    await runTests();
  };

  const handleInterrupt = () => {
    interruptTests();
  };

  const handleReset = async () => {
    if (resetting) return;
    setResetting(true);
    try {
      interruptTests();
      clearResults();
      setExpandedTests(new Set());
      const { deleted, failed } = await cleanupAllEvents();
      if (failed > 0) {
        toast.warning(`Reset complete: ${deleted} events deleted, ${failed} failed.`);
      } else {
        toast.success(`Reset complete: ${deleted} events deleted.`);
      }
    } catch {
      toast.error("Reset failed while cleaning agenda events.");
    } finally {
      setResetting(false);
    }
  };

  const passedCount = testRun ? Object.values(testRun.results).filter((r) => r.status === "passed").length : 0;
  const failedCount = testRun ? Object.values(testRun.results).filter((r) => r.status === "failed").length : 0;
  const totalCount = AGENDA_TESTS.length;

  if (!devModeEnabled) return null;

  return (
    <>
      {/* Floating trigger button */}
      <div className="fixed bottom-6 right-6 z-50">
        <Button
          onClick={() => setOpen((v) => !v)}
          size="sm"
          className={[
            "gap-2 shadow-lg cursor-pointer",
            failedCount > 0 ? "bg-red-600 hover:bg-red-700 text-white" :
            passedCount > 0 && !isRunning ? "bg-emerald-600 hover:bg-emerald-700 text-white" :
            "bg-primary hover:bg-primary/90 text-primary-foreground",
          ].join(" ")}
        >
          <IconBug className="size-4" />
          {isRunning ? `${Object.values(testRun?.results ?? {}).filter((r) => r.status === "running" || (r.status !== "pending" && r.status !== "skipped")).length} running` : "Tests"}
          {testRun && !isRunning && (
            <span className="ml-1 text-xs opacity-80">
              {passedCount}/{totalCount}
            </span>
          )}
        </Button>
      </div>

      {/* Slide-up panel */}
      {open && (
        <div className="fixed bottom-16 right-6 z-50 w-[min(520px,calc(100vw-2rem))] max-h-[70vh] flex flex-col rounded-2xl border-2 shadow-2xl bg-background overflow-hidden">
          {/* Panel header */}
          <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
            <div className="flex items-center gap-3">
              <IconBug className="size-5 text-primary shrink-0" />
              <div>
                <h2 className="text-base font-bold">Agenda Integration Tests</h2>
                <p className="text-xs text-muted-foreground">Dev-mode only — tests real DB + cron engine</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isRunning ? (
                <>
                  <Button size="sm" variant="outline" onClick={handleInterrupt} disabled={resetting} className="gap-1.5 cursor-pointer text-red-600 border-red-300 hover:bg-red-50 dark:hover:bg-red-950 disabled:cursor-not-allowed">
                    <IconX className="size-3.5" />
                    Stop
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleReset} disabled={resetting} className="gap-1.5 cursor-pointer disabled:cursor-not-allowed">
                    <IconRefresh className={`size-3.5 ${resetting ? "animate-spin" : ""}`} />
                    {resetting ? "Resetting…" : "Reset"}
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" onClick={handleRun} disabled={resetting} className="gap-1.5 cursor-pointer disabled:cursor-not-allowed">
                    <IconPlayerPlay className="size-3.5" />
                    Run Tests
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleReset} disabled={resetting} className="gap-1.5 cursor-pointer disabled:cursor-not-allowed">
                    <IconRefresh className={`size-3.5 ${resetting ? "animate-spin" : ""}`} />
                    {resetting ? "Resetting…" : "Reset"}
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)} className="cursor-pointer">
                <IconX className="size-4" />
              </Button>
            </div>
          </div>

          {/* Summary bar */}
          <div className="px-5 py-3 border-b bg-muted/20 shrink-0 space-y-3">
            <SummaryBar results={testRun?.results ?? {}} running={!!isRunning} />
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="agenda-test-approval-mode"
                  checked={requireApprovalBetweenTests}
                  onCheckedChange={(checked) => setRequireApprovalBetweenTests(checked === true)}
                />
                <Label htmlFor="agenda-test-approval-mode" className="text-xs text-muted-foreground cursor-pointer">
                  Approve before reset + next test
                </Label>
              </div>
              {waitingApprovalForTestId && (
                <Button size="sm" onClick={approveNextTest} className="gap-1.5 cursor-pointer">
                  <IconPlayerTrackNext className="size-3.5" />
                  Approve Next Test
                </Button>
              )}
            </div>
          </div>

          {/* Test list */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-4 space-y-2">
              {AGENDA_TESTS.map((test) => {
                const result = testRun?.results[test.id];
                const logs = liveLogs[test.id] ?? result?.logs ?? [];
                return (
                  <TestRow
                    key={test.id}
                    result={result ?? {
                      id: test.id,
                      name: test.name,
                      description: test.description,
                      status: "pending",
                      passed: false,
                      message: "",
                      logs: [],
                      durationMs: 0,
                      startedAt: 0,
                      finishedAt: null,
                    }}
                    logs={logs}
                    isExpanded={expandedTests.has(test.id)}
                    onToggle={() => toggleExpand(test.id)}
                  />
                );
              })}
            </div>
          </ScrollArea>

          {/* Footer */}
          <div className="px-5 py-2.5 border-t bg-muted/10 shrink-0 space-y-1">
            {waitingApprovalForTestId && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 text-center font-medium">
                Paused after current test. Review logs, then approve to continue with reset + next test.
              </p>
            )}
            <p className="text-[10px] text-muted-foreground text-center">
              Tests run against live database. Some tests (scheduler polling) take up to 3 min.
              Gateway restarts do not break the test run — results are stored in component state.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
