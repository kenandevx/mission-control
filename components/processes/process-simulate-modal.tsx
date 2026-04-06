"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import {
  IconPlayerPlay,
  IconCheck,
  IconLoader2,
  IconTrash,
  IconFile,
  IconPhoto,
  IconDownload,
  IconRobot,
  IconCode,
  IconCpu,
} from "@tabler/icons-react";
import { toast } from "sonner";

type FileInfo = { path: string; name: string; size: number };

type StepResult = {
  stepIndex: number;
  title?: string;
  instruction?: string;
  agentId?: string;
  skillKey?: string | null;
  modelOverride?: string | null;
  status: "running" | "succeeded" | "failed" | "pending";
  output?: string;
  error?: string;
  filesCreated?: FileInfo[];
};

type Props = {
  open: boolean;
  processId?: string;
  processName?: string;
  steps?: Array<{
    title: string;
    instruction: string;
    skillKey?: string;
    agentId?: string;
    modelOverride?: string;
    timeoutSeconds?: number | null;
  }>;
  autoStart?: boolean;
  onClose: () => void;
};

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

// ── Markdown rendering (same as agenda-details-sheet) ─────────────────────────

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  while (remaining.length > 0) {
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) { parts.push(<code key={key++} className="px-1 py-0.5 bg-muted rounded text-xs font-mono">{codeMatch[1]}</code>); remaining = remaining.slice(codeMatch[0].length); continue; }
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) { parts.push(<strong key={key++} className="font-bold">{boldMatch[1]}</strong>); remaining = remaining.slice(boldMatch[0].length); continue; }
    const italicMatch = remaining.match(/^\*(.+?)\*/);
    if (italicMatch) { parts.push(<em key={key++}>{italicMatch[1]}</em>); remaining = remaining.slice(italicMatch[0].length); continue; }
    const nextSpecial = remaining.search(/[`*]/);
    if (nextSpecial === -1) { parts.push(remaining); break; }
    if (nextSpecial === 0) { parts.push(remaining[0]); remaining = remaining.slice(1); }
    else { parts.push(remaining.slice(0, nextSpecial)); remaining = remaining.slice(nextSpecial); }
  }
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("### ")) nodes.push(<h4 key={i} className="text-sm font-bold mt-3 mb-1">{renderInline(line.slice(4))}</h4>);
    else if (line.startsWith("## ")) nodes.push(<h3 key={i} className="text-base font-bold mt-3 mb-1">{renderInline(line.slice(3))}</h3>);
    else if (line.startsWith("# ")) nodes.push(<h2 key={i} className="text-lg font-bold mt-3 mb-1">{renderInline(line.slice(2))}</h2>);
    else if (/^[-*]\s/.test(line)) nodes.push(<div key={i} className="flex gap-2 pl-1"><span className="text-muted-foreground shrink-0">•</span><span className="text-sm leading-relaxed">{renderInline(line.replace(/^[-*]\s/, ""))}</span></div>);
    else if (/^\d+\.\s/.test(line)) { const num = line.match(/^(\d+)\./)?.[1]; nodes.push(<div key={i} className="flex gap-2 pl-1"><span className="text-muted-foreground shrink-0 tabular-nums text-sm">{num}.</span><span className="text-sm leading-relaxed">{renderInline(line.replace(/^\d+\.\s/, ""))}</span></div>); }
    else if (line.trim() === "") nodes.push(<div key={i} className="h-2" />);
    else nodes.push(<p key={i} className="text-sm leading-relaxed">{renderInline(line)}</p>);
  }
  return nodes;
}

function ResultBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    running:   { label: "● Running",  className: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
    succeeded: { label: "✓ Succeeded", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
    failed:    { label: "✗ Failed",    className: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400" },
    pending:   { label: "Pending",     className: "border-muted-foreground/30 text-muted-foreground" },
  };
  const cfg = map[status] ?? map.pending;
  return <Badge variant="outline" className={`text-[10px] uppercase tracking-wider ${cfg.className}`}>{cfg.label}</Badge>;
}

function isImageFile(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(name);
}

export function ProcessSimulateModal({ open, processId, processName, steps, autoStart, onClose }: Props) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [stepResults, setStepResults] = useState<StepResult[]>([]);
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [sessionSnapshots, setSessionSnapshots] = useState<Array<{ agentId: string; sessionFilePath: string; byteOffset: number }>>([]);
  const [cleaning, setCleaning] = useState(false);
  const [cleaned, setCleaned] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const autoStartedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setRunning(false);
      setDone(false);
      setStepResults([]);
      setAllFiles([]);
      setSessionSnapshots([]);
      setCleaning(false);
      setCleaned(false);
      autoStartedRef.current = false;
      abortRef.current?.abort();
    }
  }, [open]);

  const startSimulation = useCallback(async () => {
    setRunning(true);
    setDone(false);
    setStepResults([]);
    setAllFiles([]);
    setSessionSnapshots([]);
    setCleaned(false);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const body = processId ? { processId } : { steps };
      const res = await fetch("/api/processes/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.done) {
              setAllFiles(data.allFilesCreated || []);
              setSessionSnapshots(data.sessionSnapshots || []);
              setDone(true);
              setRunning(false);
              continue;
            }
            setStepResults((prev) => {
              const entry: StepResult = {
                stepIndex: data.stepIndex,
                title: data.title,
                instruction: data.instruction,
                agentId: data.agentId,
                skillKey: data.skillKey,
                modelOverride: data.modelOverride,
                status: data.status,
                output: data.output,
                error: data.error,
                filesCreated: data.filesCreated,
              };
              const existing = prev.findIndex((r) => r.stepIndex === data.stepIndex);
              if (existing >= 0) { const next = [...prev]; next[existing] = { ...next[existing], ...entry }; return next; }
              return [...prev, entry];
            });
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") toast.error("Simulation failed");
    } finally {
      setRunning(false);
      setDone(true);
    }
  }, [processId, steps]);

  useEffect(() => {
    if (open && autoStart && !autoStartedRef.current && !running && !done) {
      autoStartedRef.current = true;
      // Delay slightly so the dialog renders first
      const t = setTimeout(() => {
        void startSimulation();
      }, 150);
      return () => clearTimeout(t);
    }
  }, [open, autoStart, running, done, startSimulation]);

  const hasSnapshots = sessionSnapshots.length > 0;

  const handleCleanup = async () => {
    if (allFiles.length === 0 && !hasSnapshots) return;
    setCleaning(true);
    try {
      const res = await fetch("/api/processes/simulate/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: allFiles, sessionSnapshots }),
      });
      const json = await res.json();
      if (json.ok) {
        const parts: string[] = [];
        if (json.deleted.length > 0) parts.push(`${json.deleted.length} file(s)`);
        if (json.sessionsRestored > 0) parts.push(`${json.sessionsRestored} session(s) restored`);
        toast.success(`Cleaned up ${parts.join(" and ")}`);
        if (json.errors.length > 0) toast.warning(`${json.errors.length} item(s) could not be cleaned`);
        setCleaned(true);
      }
    } catch { toast.error("Cleanup failed"); }
    finally { setCleaning(false); }
  };

  const succeededCount = stepResults.filter((r) => r.status === "succeeded").length;
  const failedCount = stepResults.filter((r) => r.status === "failed").length;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) { abortRef.current?.abort(); onClose(); } }}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <IconPlayerPlay className="size-4 text-primary" />
                Simulate {processName ? `— ${processName}` : "Process"}
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {!running && !done && "Run a simulation to preview what each step produces."}
                {running && "Running simulation..."}
                {done && `Simulation complete — ${succeededCount} succeeded, ${failedCount} failed`}
              </p>
            </div>
            {!running && !done && (
              <Button onClick={startSimulation} className="gap-1.5 cursor-pointer">
                <IconPlayerPlay className="size-3.5" />
                Run Simulation
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
          {stepResults.length === 0 && !running ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <IconPlayerPlay className="size-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">Click &quot;Run Simulation&quot; to start</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {stepResults.map((result) => (
                <Card
                  key={result.stepIndex}
                  data-slot="card"
                  className="bg-gradient-to-t from-primary/12 to-card shadow-xs"
                >
                  {/* Step header */}
                  <CardHeader>
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <Badge variant="outline" className="size-5 p-0 flex items-center justify-center text-[9px] font-bold shrink-0">
                        {result.stepIndex + 1}
                      </Badge>
                      {result.title || `Step ${result.stepIndex + 1}`}
                    </CardTitle>
                    <CardAction>
                      <ResultBadge status={result.status} />
                    </CardAction>
                  </CardHeader>

                  <CardContent className="flex flex-col gap-3">
                    {/* Step metadata */}
                    <div className="flex flex-col gap-1.5 rounded-lg bg-muted/30 p-3">
                      {result.agentId && (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-14 shrink-0">Agent</span>
                          <span className="text-xs font-mono text-foreground/80 flex items-center gap-1">
                            <IconRobot className="size-3 text-primary" />
                            {result.agentId}
                          </span>
                        </div>
                      )}
                      {result.skillKey && (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-14 shrink-0">Skill</span>
                          <Badge variant="secondary" className="text-[10px]">
                            <IconCode className="size-2.5 mr-0.5" />
                            {result.skillKey}
                          </Badge>
                        </div>
                      )}
                      {result.modelOverride && (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-14 shrink-0">Model</span>
                          <span className="text-xs font-mono text-foreground/80 flex items-center gap-1">
                            <IconCpu className="size-3 text-primary" />
                            {result.modelOverride}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Instruction */}
                    {result.instruction && (
                      <div className="rounded-lg border border-dashed border-muted-foreground/20 bg-muted/20 p-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Instruction</p>
                        <p className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">
                          {result.instruction.length > 300 ? result.instruction.slice(0, 300) + "…" : result.instruction}
                        </p>
                      </div>
                    )}

                    {/* Running state */}
                    {result.status === "running" && (
                      <div className="flex items-center gap-2 py-4 justify-center">
                        <IconLoader2 className="size-5 animate-spin text-amber-500" />
                        <span className="text-sm text-muted-foreground animate-pulse">Processing step {result.stepIndex + 1}...</span>
                      </div>
                    )}

                    {/* Output — rendered as markdown */}
                    {result.output && (
                      <>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Output</p>
                        <div className="rounded-lg border bg-muted/40 p-4 flex flex-col gap-0.5 max-h-[300px] overflow-auto">
                          {renderMarkdown(result.output.replace(/\n*>\s*`Agent:.*`$/, "").trim())}
                        </div>
                      </>
                    )}

                    {/* Error */}
                    {result.error && (
                      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-600">
                        {result.error}
                      </div>
                    )}

                    {/* Files */}
                    {result.filesCreated && result.filesCreated.length > 0 && (
                      <div className="flex flex-col gap-2 mt-1">
                        <p className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
                          <IconFile className="size-3 text-primary" />
                          Files ({result.filesCreated.length})
                        </p>
                        <div className="grid grid-cols-1 gap-2">
                          {result.filesCreated.map((file) => (
                            <div
                              key={file.path}
                              className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3 transition-colors hover:bg-muted/40"
                            >
                              <div className="flex items-center justify-center size-10 rounded-lg bg-primary/10 shrink-0">
                                {isImageFile(file.name)
                                  ? <IconPhoto className="size-5 text-primary" />
                                  : <IconFile className="size-5 text-primary" />
                                }
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{file.name}</p>
                                <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                              </div>
                              <a
                                href={`/api/files?path=${encodeURIComponent(file.path)}`}
                                download={file.name}
                                className="shrink-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs cursor-pointer">
                                  <IconDownload className="size-3" />
                                  Download
                                </Button>
                              </a>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Footer with cleanup */}
        {done && (
          <div className="border-t px-6 py-4 flex items-center justify-between shrink-0">
            <div className="text-xs text-muted-foreground">
              {allFiles.length > 0
                ? `${allFiles.length} file(s) created during simulation`
                : "No files created during simulation"}
              {hasSnapshots && ` · ${sessionSnapshots.length} agent session(s) tracked`}
            </div>
            <div className="flex items-center gap-2">
              {(allFiles.length > 0 || hasSnapshots) && !cleaned && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleCleanup}
                  disabled={cleaning}
                  className="gap-1.5 cursor-pointer"
                >
                  {cleaning ? <IconLoader2 className="size-3.5 animate-spin" /> : <IconTrash className="size-3.5" />}
                  {cleaning ? "Cleaning..." : "Cleanup All"}
                </Button>
              )}
              {cleaned && (
                <Badge variant="outline" className="text-emerald-600 border-emerald-500/30 bg-emerald-500/10">
                  <IconCheck className="size-3 mr-1" />
                  Cleaned
                </Badge>
              )}
              <Button variant="outline" size="sm" onClick={onClose} className="cursor-pointer">
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
