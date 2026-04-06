"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  RefreshCwIcon,
  Trash2Icon,
  PlayIcon,
  PauseIcon,
  ZapIcon,
  ClockIcon,
  ActivityIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  LayersIcon,
  Loader2Icon,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

type QueueJob = {
  id: string;
  name: string;
  data: Record<string, unknown>;
  state: string;
  attemptsMade: number;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
  delay: number;
  failedReason?: string;
};

type QueueInfo = {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  jobs: QueueJob[];
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATE_BADGE: Record<string, { class: string; label: string }> = {
  active: { class: "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", label: "Active" },
  waiting: { class: "border-blue-500/40 bg-blue-500/15 text-blue-700 dark:text-blue-300", label: "Waiting" },
  delayed: { class: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300", label: "Delayed" },
  failed: { class: "border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-300", label: "Failed" },
};

function jobLabel(job: QueueJob): string {
  const d = job.data;
  return String(d.title || d.ticketId || d.occurrenceId || d.eventId || job.name || job.id);
}

// ── Component ────────────────────────────────────────────────────────────────

export function QueueManager(): React.ReactElement {
  const [queues, setQueues] = useState<QueueInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ action: string; queue: string; jobId?: string; label: string } | null>(null);
  const startedRef = useRef(false);

  const fetchQueues = useCallback(async () => {
    try {
      const res = await fetch("/api/queues", { cache: "reload" });
      const json = await res.json();
      if (json.ok) setQueues(json.queues ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void fetchQueues();
    const timer = setInterval(fetchQueues, 10_000);
    return () => { clearInterval(timer); startedRef.current = false; };
  }, [fetchQueues]);

  const doAction = useCallback(async (action: string, queue: string, jobId?: string) => {
    setActionInFlight(`${action}-${queue}-${jobId || ""}`);
    try {
      const res = await fetch("/api/queues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, queue, jobId }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(json.message || "Done");
        void fetchQueues();
      } else {
        toast.error(json.error || "Action failed");
      }
    } catch {
      toast.error("Action failed");
    } finally {
      setActionInFlight(null);
      setConfirmAction(null);
    }
  }, [fetchQueues]);

  const handleConfirmedAction = useCallback(() => {
    if (!confirmAction) return;
    void doAction(confirmAction.action, confirmAction.queue, confirmAction.jobId);
  }, [confirmAction, doAction]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LayersIcon className="size-5 text-primary" />
            Job Queues
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2Icon className="size-4 animate-spin" />
            Loading queues...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        {queues.map((q) => {
          const totalJobs = q.waiting + q.active + q.delayed + q.failed;
          const isTickets = q.name === "tickets";
          const icon = isTickets ? "🎫" : "📅";
          const displayName = isTickets ? "Ticket Queue" : "Agenda Queue";

          return (
            <Card key={q.name} className="overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <span className="text-lg">{icon}</span>
                      {displayName}
                      <Badge variant="secondary" className="text-[10px] font-mono">{q.name}</Badge>
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {totalJobs === 0 ? "Queue is empty" : `${totalJobs} job${totalJobs !== 1 ? "s" : ""} in queue`}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="cursor-pointer"
                      onClick={() => void fetchQueues()}
                      title="Refresh"
                    >
                      <RefreshCwIcon className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="cursor-pointer"
                      onClick={() => setConfirmAction({ action: "pauseQueue", queue: q.name, label: `Pause ${displayName}` })}
                      title="Pause queue"
                    >
                      <PauseIcon className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="cursor-pointer"
                      onClick={() => void doAction("resumeQueue", q.name)}
                      title="Resume queue"
                    >
                      <PlayIcon className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="cursor-pointer text-destructive hover:text-destructive"
                      onClick={() => setConfirmAction({ action: "cleanQueue", queue: q.name, label: `Clean entire ${displayName}` })}
                      title="Clean all jobs"
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Stat pills */}
                <div className="flex flex-wrap gap-2 mt-3">
                  <div className="flex items-center gap-1.5 rounded-lg border bg-emerald-500/5 border-emerald-500/20 px-2.5 py-1.5">
                    <ActivityIcon className="size-3 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">{q.active}</span>
                    <span className="text-[10px] text-muted-foreground">active</span>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-lg border bg-blue-500/5 border-blue-500/20 px-2.5 py-1.5">
                    <ClockIcon className="size-3 text-blue-600 dark:text-blue-400" />
                    <span className="text-[11px] font-bold text-blue-700 dark:text-blue-300">{q.waiting}</span>
                    <span className="text-[10px] text-muted-foreground">waiting</span>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-lg border bg-amber-500/5 border-amber-500/20 px-2.5 py-1.5">
                    <ZapIcon className="size-3 text-amber-600 dark:text-amber-400" />
                    <span className="text-[11px] font-bold text-amber-700 dark:text-amber-300">{q.delayed}</span>
                    <span className="text-[10px] text-muted-foreground">delayed</span>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-lg border bg-red-500/5 border-red-500/20 px-2.5 py-1.5">
                    <AlertTriangleIcon className="size-3 text-red-600 dark:text-red-400" />
                    <span className="text-[11px] font-bold text-red-700 dark:text-red-300">{q.failed}</span>
                    <span className="text-[10px] text-muted-foreground">failed</span>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-lg border bg-muted/30 px-2.5 py-1.5">
                    <CheckCircle2Icon className="size-3 text-muted-foreground" />
                    <span className="text-[11px] font-bold">{q.completed}</span>
                    <span className="text-[10px] text-muted-foreground">completed</span>
                  </div>
                </div>
              </CardHeader>

              {/* Jobs table */}
              {q.jobs.length > 0 && (
                <CardContent className="pt-0">
                  <div className="rounded-md border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Job</TableHead>
                          <TableHead>State</TableHead>
                          <TableHead>Created</TableHead>
                          <TableHead>Details</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {q.jobs.map((job) => {
                          const badge = STATE_BADGE[job.state] ?? STATE_BADGE.waiting;
                          const isBusy = actionInFlight === `removeJob-${q.name}-${job.id}`;
                          return (
                            <TableRow key={job.id} className={cn(
                              job.state === "failed" && "bg-red-500/[0.03]",
                              job.state === "active" && "bg-emerald-500/[0.03]",
                            )}>
                              <TableCell>
                                <div className="font-semibold text-[13px]">{jobLabel(job)}</div>
                                <div className="text-[10px] font-mono text-muted-foreground/60">{job.id}</div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={cn("text-[10px]", badge.class)}>
                                  {badge.label}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground tabular-nums">
                                {job.timestamp ? formatDistanceToNow(new Date(job.timestamp), { addSuffix: true }) : "—"}
                              </TableCell>
                              <TableCell className="max-w-[250px]">
                                {job.failedReason ? (
                                  <span className="text-[11px] text-red-600 dark:text-red-400 line-clamp-2">{job.failedReason}</span>
                                ) : job.delay > 0 ? (
                                  <span className="text-[11px] text-amber-600 dark:text-amber-400">
                                    Delayed {Math.round(job.delay / 1000)}s
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-muted-foreground">
                                    {job.attemptsMade > 0 ? `${job.attemptsMade} attempt${job.attemptsMade !== 1 ? "s" : ""}` : "—"}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  {(job.state === "failed" || job.state === "delayed") && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="cursor-pointer gap-1 h-7 px-2 text-[11px]"
                                      title={job.state === "failed" ? "Retry this job" : "Run now (promote from delayed)"}
                                      disabled={actionInFlight === `retryJob-${q.name}-${job.id}`}
                                      onClick={() => void doAction(job.state === "failed" ? "retryJob" : "promoteJob", q.name, job.id)}
                                    >
                                      {actionInFlight === `retryJob-${q.name}-${job.id}` || actionInFlight === `promoteJob-${q.name}-${job.id}` ? (
                                        <Loader2Icon className="size-3 animate-spin" />
                                      ) : (
                                        <RefreshCwIcon className="size-3" />
                                      )}
                                      {job.state === "failed" ? "Retry" : "Run now"}
                                    </Button>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="cursor-pointer gap-1 h-7 px-2 text-[11px] text-destructive hover:text-destructive"
                                    title="Remove job"
                                    disabled={isBusy}
                                    onClick={() => setConfirmAction({
                                      action: "removeJob",
                                      queue: q.name,
                                      jobId: job.id,
                                      label: `Remove job "${jobLabel(job)}"`,
                                    })}
                                  >
                                    {isBusy ? <Loader2Icon className="size-3 animate-spin" /> : <Trash2Icon className="size-3" />}
                                    Remove
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              )}

              {q.jobs.length === 0 && totalJobs === 0 && (
                <CardContent className="pt-0">
                  <div className="flex flex-col items-center py-6 text-center">
                    <span className="text-2xl mb-2">✨</span>
                    <span className="text-sm text-muted-foreground">Queue is clear — no pending jobs</span>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {/* Confirm dialog */}
      <AlertDialog open={Boolean(confirmAction)} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangleIcon className="size-5 text-destructive" />
              {confirmAction?.label}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.action === "cleanQueue"
                ? "This will remove ALL jobs from this queue — waiting, delayed, and failed. Active jobs will finish. This cannot be undone."
                : confirmAction?.action === "pauseQueue"
                  ? "This will pause the queue. No new jobs will be processed until you resume."
                  : "This will remove this job from the queue. If it's currently running, it may still complete."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmedAction}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 cursor-pointer"
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
