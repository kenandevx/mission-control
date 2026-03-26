"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  IconCalendar,
  IconClock,
  IconRepeat,
  IconRefresh,
  IconX,
  IconUser,
  IconBrain,
  IconFileText,
  IconProgressCheck,
  IconPencil,
  IconTrendingUp,
} from "@tabler/icons-react";


export type AgendaEventSummary = {
  id: string;
  title: string;
  freePrompt: string;
  agentId: string;
  agentName: string;
  processIds: string[];
  processNames: string[];
  status: "draft" | "active";
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timezone: string;
  recurrence: string;
  nextRuns: string[];
  latestResult: "succeeded" | "failed" | "running" | "pending" | null;
  recurrenceRule?: string | null;
  occurrenceId?: string;
  modelOverride?: string;
};

type RunAttempt = {
  id: string;
  attempt_no: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  summary: string | null;
  error_message: string | null;
};

type RunStep = {
  id: string;
  run_attempt_id: string;
  step_title: string | null;
  process_name: string | null;
  skill_key: string | null;
  agent_id: string | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  output_payload: string | null;
  error_message: string | null;
};

type Props = {
  open: boolean;
  event: AgendaEventSummary | null;
  agents?: { id: string; name: string }[];
  onClose: () => void;
  onEdit: (event: AgendaEventSummary) => void;
  onRetry: (occurrenceId: string) => void;
  onDelete: (eventId: string) => void;
};

function formatTime(ts: string | null, timezone?: string) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString(undefined, {
      timeZone: timezone || undefined,
      month: "short", day: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

function ResultBadge({ status }: { status: string | null }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    succeeded: { label: "Succeeded", variant: "default" },
    failed:    { label: "Failed",    variant: "destructive" },
    running:   { label: "Running",   variant: "secondary" },
    pending:   { label: "Pending",   variant: "outline" },
    queued:    { label: "Queued",    variant: "outline" },
    scheduled: { label: "Scheduled", variant: "outline" },
  };
  const cfg = map[status ?? ""] ?? { label: status ?? "—", variant: "outline" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function AgentOutput({ outputPayload }: { outputPayload: string | null }) {
  if (!outputPayload) return null;
  let outputText = outputPayload;
  try {
    const parsed = JSON.parse(outputPayload);
    if (typeof parsed.output === "string") outputText = parsed.output;
    else if (typeof parsed === "string") outputText = parsed;
  } catch { /* keep raw */ }
  const cleaned = outputText.replace(/\n*>\s*`Agent:.*`$/, "").trim();
  return (
    <div className="rounded-lg border bg-muted/40 p-4">
      <pre className="text-sm whitespace-pre-wrap font-mono leading-relaxed">{cleaned}</pre>
    </div>
  );
}

function humanRecurrence(recurrence: string) {
  if (!recurrence || recurrence === "none") return null;
  const map: Record<string, string> = { daily: "Every day", weekly: "Every week", monthly: "Every month" };
  return map[recurrence] ?? recurrence;
}

export function AgendaDetailsSheet({ open, event, agents, onClose, onEdit, onRetry, onDelete }: Props) {
  const [activeTab, setActiveTab] = useState("overview");
  const [occurrences, setOccurrences] = useState<{ id: string; scheduled_for: string; status: string; latest_attempt_no: number }[]>([]);
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<RunAttempt[]>([]);
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Fetch occurrences on mount (component is keyed, so this runs fresh each time)
  useEffect(() => {
    if (!open || !event?.id) return;
    const controller = new AbortController();

    void (async () => {
      try {
        const res = await fetch(`/api/agenda/events/${event.id}`, {
          cache: "reload",
          signal: controller.signal,
        });
        const json = await res.json();
        if (json.ok && !controller.signal.aborted) {
          setOccurrences(json.occurrences ?? []);
          if (json.occurrences?.length > 0) setSelectedOccurrenceId(json.occurrences[0].id);
        }
      } catch { /* ignore aborts + fetch errors */ }
    })();

    return () => controller.abort();
  }, [open, event?.id]);

  useEffect(() => {
    if (!selectedOccurrenceId || !event?.id) return;
    setLoadingRuns(true);
    setAttempts([]);
    setSteps([]);
    setSelectedAttemptId(null);

    void (async () => {
      try {
        const res = await fetch(
          `/api/agenda/events/${event.id}/occurrences/${selectedOccurrenceId}/runs`,
          { cache: "reload" }
        );
        const json = await res.json();
        if (json.ok) {
          setAttempts(json.attempts ?? []);
          setSteps(json.steps ?? []);
          if (json.attempts?.length > 0) setSelectedAttemptId(json.attempts[json.attempts.length - 1].id);
        }
      } catch { /* ignore */ }
      finally { setLoadingRuns(false); }
    })();
  }, [selectedOccurrenceId, event?.id]);

  if (!event) return null;

  const isRecurring = event.recurrence && event.recurrence !== "none";
  const resolvedAgentName = (() => {
    if (event.agentName) return event.agentName;
    if (event.agentId) {
      const found = agents?.find((a) => a.id === event.agentId);
      if (found?.name) return found.name;
    }
    return "System default";
  })();

  const selectedOccurrence = occurrences.find((o) => o.id === selectedOccurrenceId);
  const selectedAttempt = attempts.find((a) => a.id === selectedAttemptId);
  const attemptSteps = steps.filter((s) => s.run_attempt_id === selectedAttemptId);

  const taskSummary = event.freePrompt.trim()
    ? event.freePrompt.trim()
    : event.processNames.length > 0
      ? `Runs ${event.processNames.join(" + ")}`
      : "No task specified";

  const recurrenceLabel = humanRecurrence(event.recurrence);

  return (
    <>
      <Sheet open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
        <SheetContent className="w-full sm:max-w-[640px] overflow-y-auto p-0 flex flex-col">
          {/* ── Header ── */}
          <div className="p-6 pb-4">
            <SheetHeader className="p-0 pb-0">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-2 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <SheetTitle className="text-xl leading-tight">{event.title}</SheetTitle>
                    <Badge
                      variant={event.status === "active" ? "default" : "outline"}
                      className="text-[10px] uppercase tracking-wider"
                    >
                      {event.status === "active" && (
                        <span className="size-1.5 rounded-full bg-emerald-400 mr-1 shrink-0" />
                      )}
                      {event.status}
                    </Badge>
                    {isRecurring && (
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wider gap-1">
                        <IconRepeat className="size-2.5" />
                        Recurring
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 h-8 text-xs font-semibold cursor-pointer"
                    onClick={() => onEdit(event)}
                  >
                    <IconPencil className="size-3" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 h-8 text-xs font-semibold text-destructive/70 hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <IconX className="size-3" />
                  </Button>
                </div>
              </div>
            </SheetHeader>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed line-clamp-3">
              {taskSummary}
            </p>
          </div>

          <Separator />

          {/* ── Tabs ── */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
            <div className="px-6 pt-3">
              <TabsList className="grid w-full grid-cols-3 h-9">
                <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
                <TabsTrigger value="runs" className="text-xs">Runs</TabsTrigger>
                <TabsTrigger value="output" className="text-xs">Output</TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {/* ── Overview ── */}
              <TabsContent value="overview" className="mt-0">
                <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-2 gap-3 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs">
                  {/* Schedule */}
                  <Card data-slot="card">
                    <CardHeader>
                      <CardDescription>Schedule</CardDescription>
                      <CardTitle className="text-lg font-semibold tabular-nums">
                        {event.startTime || "—"}
                      </CardTitle>
                      <CardAction>
                        <Badge variant="outline">
                          <IconCalendar className="size-3" />
                          {event.startDate || "Not set"}
                        </Badge>
                      </CardAction>
                    </CardHeader>
                    <CardFooter className="flex-col items-start gap-1 text-sm">
                      <div className="text-muted-foreground text-xs">{event.timezone}</div>
                      {(event.endDate || event.endTime) && (
                        <div className="text-muted-foreground text-xs">
                          Until {event.endDate} {event.endTime}
                        </div>
                      )}
                    </CardFooter>
                  </Card>

                  {/* Agent */}
                  <Card data-slot="card">
                    <CardHeader>
                      <CardDescription>Agent</CardDescription>
                      <CardTitle className="text-lg font-semibold truncate">
                        {resolvedAgentName}
                      </CardTitle>
                      <CardAction>
                        <Badge variant="outline">
                          <IconUser className="size-3" />
                          Assigned
                        </Badge>
                      </CardAction>
                    </CardHeader>
                    <CardFooter className="flex-col items-start gap-1 text-sm">
                      {event.agentId ? (
                        <div className="text-muted-foreground text-xs truncate max-w-full">{event.agentId}</div>
                      ) : (
                        <div className="text-muted-foreground text-xs">Using system default</div>
                      )}
                    </CardFooter>
                  </Card>

                  {/* Recurrence */}
                  {isRecurring && (
                    <Card data-slot="card">
                      <CardHeader>
                        <CardDescription>Recurrence</CardDescription>
                        <CardTitle className="text-lg font-semibold">
                          {recurrenceLabel}
                        </CardTitle>
                        <CardAction>
                          <Badge variant="outline">
                            <IconRepeat className="size-3" />
                            Active
                          </Badge>
                        </CardAction>
                      </CardHeader>
                      <CardFooter className="flex-col items-start gap-1 text-sm">
                        <div className="text-muted-foreground text-xs">Repeating schedule</div>
                      </CardFooter>
                    </Card>
                  )}

                  {/* Latest Occurrence */}
                  {selectedOccurrence && (
                    <Card data-slot="card" className={selectedOccurrence.status === "failed" ? "border-red-200 dark:border-red-900" : ""}>
                      <CardHeader>
                        <CardDescription>Latest Run</CardDescription>
                        <CardTitle className="text-lg font-semibold">
                          <ResultBadge status={selectedOccurrence.status} />
                        </CardTitle>
                        <CardAction>
                          <Badge variant="outline">
                            <IconClock className="size-3" />
                            Run
                          </Badge>
                        </CardAction>
                      </CardHeader>
                      <CardFooter className="flex-col items-start gap-1 text-sm">
                        <div className="text-muted-foreground text-xs">
                          {formatTime(selectedOccurrence.scheduled_for, event.timezone)}
                        </div>
                        {selectedOccurrence.status === "failed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 h-7 text-xs mt-1 cursor-pointer"
                            onClick={() => onRetry(selectedOccurrenceId!)}
                          >
                            <IconRefresh className="size-3" />
                            Retry
                          </Button>
                        )}
                      </CardFooter>
                    </Card>
                  )}
                </div>

                {/* Processes (full width below cards) */}
                {event.processNames.length > 0 && (
                  <div className="mt-3 *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs">
                    <Card data-slot="card">
                      <CardHeader>
                        <CardDescription>Attached Processes</CardDescription>
                        <CardTitle className="text-lg font-semibold tabular-nums">
                          {event.processNames.length}
                        </CardTitle>
                        <CardAction>
                          <Badge variant="outline">
                            <IconBrain className="size-3" />
                            Processes
                          </Badge>
                        </CardAction>
                      </CardHeader>
                      <CardFooter className="flex-col items-start gap-1.5 text-sm">
                        <div className="flex flex-wrap gap-1.5">
                          {event.processNames.map((name) => (
                            <Badge key={name} variant="secondary" className="text-xs">
                              {name}
                            </Badge>
                          ))}
                        </div>
                      </CardFooter>
                    </Card>
                  </div>
                )}
              </TabsContent>

              {/* ── Runs ── */}
              <TabsContent value="runs" className="flex flex-col gap-3 mt-0">
                {loadingRuns ? (
                  <div className="flex flex-col gap-3">
                    {[1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
                  </div>
                ) : attempts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <IconProgressCheck className="size-10 text-muted-foreground/50 mb-3" />
                    <p className="text-sm text-muted-foreground">No runs yet.</p>
                  </div>
                ) : (
                  attempts.map((attempt) => (
                    <Card
                      key={attempt.id}
                      data-slot="card"
                      className={`cursor-pointer transition-all ${
                        attempt.id === selectedAttemptId
                          ? "border-primary ring-1 ring-primary/20 bg-gradient-to-t from-primary/5 to-card shadow-xs"
                          : "hover:bg-muted/30 bg-gradient-to-t from-primary/5 to-card shadow-xs"
                      }`}
                      onClick={() => setSelectedAttemptId(attempt.id)}
                    >
                      <CardHeader>
                        <CardDescription>Attempt #{attempt.attempt_no}</CardDescription>
                        <CardTitle className="text-base font-semibold">
                          <ResultBadge status={attempt.status} />
                        </CardTitle>
                        <CardAction>
                          <Badge variant="outline">
                            <IconTrendingUp className="size-3" />
                            {attempt.status}
                          </Badge>
                        </CardAction>
                      </CardHeader>
                      <CardFooter className="flex-col items-start gap-1 text-sm">
                        <div className="text-muted-foreground text-xs">
                          {formatTime(attempt.started_at, event.timezone)}
                          {attempt.finished_at && ` → ${formatTime(attempt.finished_at, event.timezone)}`}
                        </div>
                        {(attempt.summary || attempt.error_message) && (
                          <div className="text-xs text-muted-foreground truncate max-w-full">
                            {attempt.summary || attempt.error_message}
                          </div>
                        )}
                      </CardFooter>
                    </Card>
                  ))
                )}
              </TabsContent>

              {/* ── Output ── */}
              <TabsContent value="output" className="flex flex-col gap-3 mt-0">
                {!selectedAttempt ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <IconFileText className="size-10 text-muted-foreground/50 mb-3" />
                    <p className="text-sm text-muted-foreground">Select a run to view output.</p>
                  </div>
                ) : attemptSteps.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <IconFileText className="size-10 text-muted-foreground/50 mb-3" />
                    <p className="text-sm text-muted-foreground">No output recorded.</p>
                  </div>
                ) : (
                  attemptSteps.map((step) => (
                    <Card
                      key={step.id}
                      data-slot="card"
                      className="bg-gradient-to-t from-primary/5 to-card shadow-xs"
                    >
                      <CardHeader>
                        <CardDescription>
                          {step.process_name ? `Process: ${step.process_name}` : "Free Prompt"}
                        </CardDescription>
                        <CardTitle className="text-base font-semibold">
                          <ResultBadge status={step.status} />
                        </CardTitle>
                        {(step.skill_key || step.agent_id) && (
                          <CardAction>
                            <Badge variant="outline" className="text-[10px]">
                              {[step.skill_key, step.agent_id].filter(Boolean).join(" · ")}
                            </Badge>
                          </CardAction>
                        )}
                      </CardHeader>
                      <CardContent>
                        {step.error_message ? (
                          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-600">
                            {step.error_message}
                          </div>
                        ) : step.status === "succeeded" && step.output_payload ? (
                          <AgentOutput outputPayload={step.output_payload} />
                        ) : (
                          <p className="text-sm text-muted-foreground">No output available</p>
                        )}
                      </CardContent>
                    </Card>
                  ))
                )}
              </TabsContent>
            </div>
          </Tabs>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this event?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &ldquo;{event.title}&rdquo; and all its occurrence history. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { onDelete(event.id); setDeleteDialogOpen(false); onClose(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete event
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
