"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Play, Square, RotateCcw, Bug } from "lucide-react";
import { KANBAN_TESTS, type TestResult } from "./kanban-test-definitions";
import { useKanbanTests } from "./use-kanban-tests";

function statusColor(status: TestResult["status"]) {
  if (status === "passed") return "bg-emerald-500/10 text-emerald-600 border-emerald-500/30";
  if (status === "failed") return "bg-red-500/10 text-red-600 border-red-500/30";
  if (status === "running") return "bg-blue-500/10 text-blue-600 border-blue-500/30";
  if (status === "skipped") return "bg-gray-500/10 text-gray-600 border-gray-500/30";
  return "bg-muted text-muted-foreground border-border";
}

export function KanbanTestPanel() {
  const [open, setOpen] = useState(false);
  const [isDevMode, setIsDevMode] = useState(false);
  const { testRun, liveLogs, runTests, interruptTests, clearResults } = useKanbanTests(KANBAN_TESTS);

  useEffect(() => {
    const update = () => setIsDevMode(localStorage.getItem("mc-dev-mode") === "1");
    update();
    window.addEventListener("mc-dev-mode-changed", update as EventListener);
    return () => window.removeEventListener("mc-dev-mode-changed", update as EventListener);
  }, []);

  const isRunning = useMemo(() => Object.values(testRun?.results ?? {}).some((r) => r.status === "running"), [testRun]);

  if (!isDevMode) return null;

  return (
    <>
      <div className="fixed bottom-4 left-4 z-[70]">
        <Button size="sm" variant={open ? "default" : "outline"} onClick={() => setOpen((v) => !v)} className="gap-1.5">
          <Bug className="size-4" />
          Kanban Tests
        </Button>
      </div>

      {open && (
        <Card className="fixed bottom-16 left-4 z-[70] w-[460px] max-w-[calc(100vw-2rem)] p-3 shadow-2xl border bg-background/95 backdrop-blur">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="font-semibold">Kanban Integration Tests</h3>
              <p className="text-xs text-muted-foreground">Kanban-only checks. Separate from Agenda tests.</p>
            </div>
            <Badge variant="outline">{KANBAN_TESTS.length} tests</Badge>
          </div>

          <div className="flex gap-2 mb-3">
            <Button size="sm" onClick={() => void runTests()} disabled={isRunning} className="gap-1.5">
              <Play className="size-3.5" /> Run
            </Button>
            <Button size="sm" variant="outline" onClick={() => interruptTests()} disabled={!isRunning} className="gap-1.5">
              <Square className="size-3.5" /> Stop
            </Button>
            <Button size="sm" variant="outline" onClick={() => clearResults()} className="gap-1.5">
              <RotateCcw className="size-3.5" /> Reset
            </Button>
          </div>

          <ScrollArea className="h-72 pr-2">
            <div className="space-y-2">
              {KANBAN_TESTS.map((t) => {
                const result = testRun?.results?.[t.id];
                const logs = liveLogs[t.id] ?? [];
                return (
                  <div key={t.id} className="rounded-lg border p-2">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="text-sm font-medium leading-tight">{t.name}</div>
                      <Badge variant="outline" className={statusColor(result?.status ?? "pending")}>
                        {result?.status ?? "pending"}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{t.description}</div>
                    {result?.message && <div className="text-xs mt-1">{result.message}</div>}
                    {logs.length > 0 && (
                      <div className="mt-1 rounded bg-muted/40 p-1.5 text-[11px] max-h-20 overflow-auto space-y-0.5">
                        {logs.map((l, i) => <div key={i}>{l}</div>)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </Card>
      )}
    </>
  );
}
