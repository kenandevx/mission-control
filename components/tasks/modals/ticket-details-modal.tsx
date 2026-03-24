"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AssigneeMiniCard } from "@/components/tasks/modals/assignee-mini-card";
import { SectionCardHeader } from "@/components/tasks/modals/section-card-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { TICKET_PRIORITY_OPTIONS } from "@/types/tasks";
import type {
  Assignee,
  BoardState,
  TicketActivity,
  TicketAttachment,
  TicketComment,
  TicketDetailsForm,
  TicketExecutionState,
  TicketSubtask,
} from "@/types/tasks";
import {
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  FileIcon,
  GitBranchIcon,
  ImageIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SendHorizonalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

type TabValue = "project" | "comments" | "activity";
type ActivityFilter = "all" | "execution" | "comments";

type Props = {
  mode?: "create" | "edit";
  open: boolean;
  form: TicketDetailsForm;
  board: BoardState;
  assignees: Assignee[];
  attachments: TicketAttachment[];
  attachmentsLoading: boolean;
  attachmentsUploading: boolean;
  subtasks: TicketSubtask[];
  subtasksLoading: boolean;
  subtaskDraft: string;
  onSubtaskDraftChange: (value: string) => void;
  onAddSubtask: () => void;
  onToggleSubtask: (subtaskId: string, completed: boolean) => void;
  onDeleteSubtask: (subtaskId: string) => void;
  comments: TicketComment[];
  commentsLoading: boolean;
  commentDraft: string;
  onCommentDraftChange: (value: string) => void;
  onAddComment: () => void;
  onDeleteComment: (commentId: string) => void;
  activity: TicketActivity[];
  activityLoading: boolean;
  onChange: (patch: Partial<TicketDetailsForm>) => void;
  onUploadAttachments: (files: FileList | File[] | null) => void;
  onDeleteAttachment: (attachmentId: string) => void;
  onSave: (files?: File[]) => void;
  onRetryNow?: () => void;
  onCancelExecution?: () => void;
  onApprovePlan?: () => void;
  onRejectPlan?: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onClose: () => void;
};

const formatCommentDate = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const formatActivityDate = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const initialsFromName = (name: string) => {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "OC";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
};

const formatBytes = (size: number) => {
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
};

const shortenText = (value: string, max = 72) => {
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3).trimEnd()}...`;
};

const priorityLabel: Record<TicketDetailsForm["priority"], string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const executionLabel = (value: TicketDetailsForm["executionState"]) =>
  value.replaceAll("_", " ").replace(/^\w/, (char) => char.toUpperCase());

const EXECUTION_STEPS: Array<{ key: TicketExecutionState; label: string }> = [
  { key: "open", label: "Open" },
  { key: "draft", label: "Draft" },
  { key: "planning", label: "Planning" },
  { key: "awaiting_plan_approval", label: "Awaiting approval" },
  { key: "ready_to_execute", label: "Ready" },
  { key: "executing", label: "Executing" },
  { key: "done", label: "Done" },
  { key: "failed", label: "Failed" },
];

function ExecutionStepper({
  state,
  onChange,
}: {
  state: TicketExecutionState;
  onChange: (state: TicketExecutionState) => void;
}) {
  const isTerminal = state === "failed" || state === "done";
  const activeIndex = EXECUTION_STEPS.findIndex((s) => s.key === state);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {EXECUTION_STEPS.map((step, index) => {
        const isActive = step.key === state;
        const isPast = !isTerminal && index < activeIndex;
        return (
          <button
            key={step.key}
            type="button"
            onClick={() => onChange(step.key)}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground shadow-sm"
                : isPast
                ? "bg-primary/15 text-primary hover:bg-primary/25"
                : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
          >
            {step.label}
          </button>
        );
      })}
      {isTerminal && (
        <>
          <span className="text-xs text-muted-foreground/50">·</span>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-medium",
              state === "failed"
                ? "bg-destructive/10 text-destructive"
                : "bg-muted text-muted-foreground",
            )}
          >
            {state === "failed" ? "Failed" : "Cancelled"}
          </span>
        </>
      )}
    </div>
  );
}

export function TicketDetailsModal({
  mode = "edit",
  open,
  form,
  board,
  assignees,
  attachments,
  attachmentsLoading,
  attachmentsUploading,
  subtasks,
  subtasksLoading,
  subtaskDraft,
  onSubtaskDraftChange,
  onAddSubtask,
  onToggleSubtask,
  onDeleteSubtask,
  comments,
  commentsLoading,
  commentDraft,
  onCommentDraftChange,
  onAddComment,
  onDeleteComment,
  activity,
  activityLoading,
  onChange,
  onUploadAttachments,
  onDeleteAttachment,
  onSave,
  onRetryNow,
  onCancelExecution,
  onApprovePlan,
  onRejectPlan,
  onCopy,
  onDelete,
  onClose,
}: Props) {
  const [tab, setTab] = useState<TabValue>("project");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [overviewCollapsed, setOverviewCollapsed] = useState(false);
  const [tasksCollapsed, setTasksCollapsed] = useState(false);
  const [hideComplete, setHideComplete] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [createFiles, setCreateFiles] = useState<File[]>([]);
  const [previewAttachment, setPreviewAttachment] = useState<TicketAttachment | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);


  const assigneeById = useMemo(
    () => Object.fromEntries(assignees.map((assignee) => [assignee.id, assignee])),
    [assignees],
  );
  const selectedAssignees = form.assigneeIds
    .map((assigneeId) => assigneeById[assigneeId])
    .filter(Boolean);
  const statusTitle = board.columns[form.statusId]?.title || "Unknown";
  const ticketRef = form.id ? `T-${String(form.id).slice(0, 4).toUpperCase()}` : "T-NEW";
  const shortDescription = shortenText(form.description || "", 72);
  const dueLabel = form.dueDate ? `Due ${new Date(form.dueDate).toLocaleDateString()}` : "No due date";
  const statusLower = statusTitle.trim().toLowerCase();
  const inProgressLane = statusLower === "in progress" || statusLower === "doing";
  const hasRuntimeAgent = Boolean(form.assignedAgentId && form.assignedAgentId.trim());
  const executableState =
    form.executionState === "pending" ||
    form.executionState === "queued" ||
    form.executionState === "ready_to_execute";
  const canBePickedUp = inProgressLane && hasRuntimeAgent && (executableState || (form.executionMode === "planned" && form.planApproved));

  const visibleSubtasks = hideComplete
    ? subtasks.filter((subtask) => !subtask.completed)
    : subtasks;

  const filteredActivity = activity.filter((entry) => {
    if (activityFilter === "all") return true;
    const event = String(entry.event || "").toLowerCase();
    const details = String(entry.details || "").toLowerCase();
    const source = String(entry.source || "").toLowerCase();

    if (activityFilter === "execution") {
      return event.startsWith("ticket.") || details.includes("execution") || source === "agent";
    }

    if (activityFilter === "comments") {
      return event.includes("comment") || details.includes("comment");
    }

    return true;
  });

  useEffect(() => {
    if (!isEditingTitle) {
      return;
    }
    window.requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  }, [isEditingTitle]);

  const addCreateFiles = (selection: FileList | null) => {
    if (!selection || selection.length === 0) {
      return;
    }
    const incoming = Array.from(selection);
    setCreateFiles((previous) => [...previous, ...incoming]);
  };

  const removeCreateFile = (index: number) => {
    setCreateFiles((previous) => previous.filter((_, currentIndex) => currentIndex !== index));
  };

  const saveLabel = mode === "create" ? "Create ticket" : "Save";
  const handleSave = () => {
    if (mode === "create") {
      onSave(createFiles);
      return;
    }
    onSave();
  };

  const toggleAssignee = (assigneeId: string) => {
    const next = form.assigneeIds.includes(assigneeId)
      ? form.assigneeIds.filter((id) => id !== assigneeId)
      : [...form.assigneeIds, assigneeId];
    onChange({ assigneeIds: next });
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) onClose();
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="fixed inset-y-0 right-0 left-auto top-0 h-[100dvh] w-[100vw] max-w-[100vw] min-w-0 translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-l border-border/70 bg-background p-0 shadow-2xl data-[state=open]:slide-in-from-right-full data-[state=closed]:slide-out-to-right-full sm:w-[92vw] md:w-[70vw] lg:w-[48vw] xl:w-[40vw] 2xl:w-[34vw] sm:min-w-[360px] sm:max-w-[720px]"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Task details</DialogTitle>
            <DialogDescription>View and edit ticket details, comments, and activity.</DialogDescription>
          </DialogHeader>

          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as TabValue)}
            className="flex h-full min-h-0 flex-col"
          >
            <div className="border-b border-border/70 bg-background">
              <div className="px-4 pt-4 sm:px-6">
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <GitBranchIcon className="h-3.5 w-3.5" />
                    <span>{ticketRef}</span>
                  </div>
                  <div className="mx-auto flex items-center -space-x-2">
                    {selectedAssignees.slice(0, 3).map((assignee) => (
                      <Avatar key={assignee.id} className="h-6 w-6 border border-border bg-background">
                        <AvatarFallback className="text-[10px]">{initialsFromName(assignee.name)}</AvatarFallback>
                      </Avatar>
                    ))}
                  </div>
                  <div className="ml-auto flex items-center gap-1">
                    <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:bg-muted" aria-label="Duplicate" onClick={onCopy} disabled={mode !== "edit"}>
                      <CopyIcon className="h-4 w-4" />
                    </Button>
                    <Button onClick={handleSave} size="sm" className="h-7 rounded-md bg-primary/10 px-2 text-xs text-foreground hover:bg-muted">
                      {saveLabel}
                    </Button>
                    {mode === "edit" ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:bg-muted" aria-label="More actions">
                            <MoreHorizontalIcon className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem variant="destructive" onClick={onDelete}>
                            <Trash2Icon className="h-4 w-4" />
                            Delete task
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                    <Button variant="ghost" size="icon-sm" onClick={onClose} className="text-muted-foreground hover:bg-muted" aria-label="Close">
                      <XIcon className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-4 px-4 pb-4 pt-12 sm:px-6">
                <div className="flex items-center gap-3">
                  <span className="h-3.5 w-3.5 rounded-full border border-border bg-muted" />
                  <div className="min-w-0 flex-1">
                    {isEditingTitle ? (
                      <Input
                        ref={titleInputRef}
                        value={form.title}
                        placeholder="Untitled task"
                        onChange={(event) => onChange({ title: event.target.value })}
                        onBlur={() => setIsEditingTitle(false)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === "Escape") {
                            event.preventDefault();
                            setIsEditingTitle(false);
                          }
                        }}
                        className="h-11 border-0 bg-transparent pl-4 pr-0 text-2xl font-medium tracking-tight leading-tight text-foreground shadow-none focus-visible:ring-0"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setIsEditingTitle(true)}
                        className="flex min-h-11 w-full cursor-text items-center text-left"
                        aria-label="Edit ticket title"
                      >
                        <h2 className="text-2xl font-medium tracking-tight leading-tight text-foreground">
                          {form.title || "Untitled task"}
                        </h2>
                      </button>
                    )}
                    {shortDescription ? <p className="text-sm text-muted-foreground">{shortDescription}</p> : null}
                  </div>
                </div>

                <div className="rounded-xl border border-border/70 bg-card/60 p-4 text-sm shadow-sm">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-normal">{executionLabel(form.executionState)}</Badge>
                    <Badge variant="outline" className="font-normal">{priorityLabel[form.priority]} priority</Badge>
                    <Badge variant="outline" className="font-normal">{statusTitle}</Badge>
                    <Badge variant="outline" className="font-normal">{dueLabel}</Badge>
                  </div>

                  {!canBePickedUp && (
                    <p className="text-xs text-amber-600">
                      Not pickup-ready — requires column "In progress", runtime agent, and pending/queued state.
                    </p>
                  )}
                </div>
              </div>

              <div className="px-4 pb-3 sm:px-6">
                <TabsList className="h-10 w-full justify-start gap-1 rounded-none border-b border-border bg-transparent p-0">
                  <TabsTrigger value="project" className="rounded-none border-b-2 border-transparent px-3 text-xs text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none sm:text-sm">
                    Subtasks
                    <span className="ml-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{subtasks.length}</span>
                  </TabsTrigger>
                  <TabsTrigger value="comments" className="rounded-none border-b-2 border-transparent px-3 text-xs text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none sm:text-sm">
                    Comments
                  </TabsTrigger>
                  <TabsTrigger value="activity" className="rounded-none border-b-2 border-transparent px-3 text-xs text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none sm:text-sm">
                    Activity
                  </TabsTrigger>
                </TabsList>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
              <TabsContent value="project" className="m-0 flex flex-col gap-4 pb-4">
                <Card className="gap-0 border-border/70 bg-card/70 py-0 shadow-sm">
                  <SectionCardHeader
                    label="OVERVIEW"
                    collapsed={overviewCollapsed}
                    onToggle={() => setOverviewCollapsed((current) => !current)}
                  />
                  {!overviewCollapsed && (
                    <CardContent className="space-y-4 p-4 sm:p-5">
                      {/* Row 1: Status, Priority, Date — full width */}
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="space-y-1.5">
                          <Label>Status</Label>
                          <Select value={form.statusId} onValueChange={(value) => onChange({ statusId: value })}>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {board.columnOrder.map((columnId) => (
                                <SelectItem key={columnId} value={columnId}>
                                  {board.columns[columnId]?.title}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <Label>Priority</Label>
                          <Select
                            value={form.priority}
                            onValueChange={(value) =>
                              onChange({ priority: value as TicketDetailsForm["priority"] })
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TICKET_PRIORITY_OPTIONS.map((option) => (
                                <SelectItem key={option.key} value={option.key}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="ticket-date">Due date</Label>
                          <Input
                            id="ticket-date"
                            type="date"
                            value={form.scheduledFor || form.dueDate}
                            onChange={(event) =>
                              onChange({ dueDate: event.target.value, scheduledFor: event.target.value })
                            }
                          />
                        </div>
                      </div>

                      {/* Row 2: Execution Mode + action buttons — full width */}
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="space-y-1.5">
                            <Label>Execution</Label>
                            <Select
                              value={form.executionMode}
                              onValueChange={(value) =>
                                onChange({ executionMode: value as TicketDetailsForm["executionMode"] })
                              }
                            >
                              <SelectTrigger className="flex-1 min-w-[160px] h-9">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="direct">Direct</SelectItem>
                                <SelectItem value="planned">Planned (approval)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {mode === "edit" && (
                            <div className="flex flex-wrap items-center gap-2 pb-1.5">
                              {form.approvalState === "pending" ? (
                                <>
                                  <Button type="button" variant="outline" size="default" onClick={onRejectPlan} className="h-9">
                                    Reject plan
                                  </Button>
                                  <Button type="button" variant="default" size="default" onClick={onApprovePlan} className="h-9">
                                    Approve plan
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button type="button" variant="outline" size="default" onClick={onRetryNow} className="h-9">
                                    Retry now
                                  </Button>
                                  <Button type="button" variant="destructive" size="default" onClick={onCancelExecution} className="h-9">
                                    Cancel execution
                                  </Button>
                                </>
                              )}
                            </div>
                          )}
                        </div>

                        {form.executionMode === "planned" ? (
                          <div
                            className={cn(
                              "rounded-md border px-3 py-2 text-xs",
                              form.planApproved
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                                : "border-amber-500/30 bg-amber-500/10 text-amber-700",
                            )}
                          >
                            {form.planApproved
                              ? "✓ Plan approved — ticket can proceed."
                              : "⚠ Plan mode will generate a plan and wait for your approval before executing."}
                          </div>
                        ) : null}
                      </div>

                      {/* Row 3: Labels + Assignees — full width */}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="ticket-labels">Labels</Label>
                          <Input
                            id="ticket-labels"
                            value={form.tagsText}
                            placeholder="bug, ui, backend"
                            onChange={(event) => onChange({ tagsText: event.target.value })}
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label>Assignees</Label>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" className="w-full justify-between" size="sm">
                                <span>
                                  {selectedAssignees.length > 0
                                    ? `${selectedAssignees.length} selected — ${selectedAssignees
                                        .map((a) => a.name)
                                        .join(", ")}`
                                    : "Assign people"}
                                </span>
                                <MoreHorizontalIcon className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-64">
                              {assignees.map((assignee) => (
                                <DropdownMenuItem key={assignee.id} onClick={() => toggleAssignee(assignee.id)}>
                                  <span className="mr-2">{form.assigneeIds.includes(assignee.id) ? "✓" : ""}</span>
                                  {assignee.name}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>

                      {/* Row 4: Description (full width), then Attachments */}
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <Label htmlFor="ticket-description">Description</Label>
                          <Textarea
                            id="ticket-description"
                            value={form.description}
                            rows={mode === "create" ? 6 : 7}
                            onChange={(event) => onChange({ description: event.target.value })}
                            placeholder="Add notes, implementation details, or context..."
                            className="resize-none"
                          />
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <Label>Attachments</Label>
                            <Input
                              ref={attachmentInputRef}
                              type="file"
                              className="hidden"
                              multiple
                              onChange={(event) => {
                                if (mode === "create") {
                                  addCreateFiles(event.target.files);
                                } else {
                                  onUploadAttachments(event.target.files);
                                }
                                event.currentTarget.value = "";
                              }}
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => attachmentInputRef.current?.click()}
                              disabled={mode === "edit" ? attachmentsUploading : false}
                            >
                              <PlusIcon className="h-4 w-4" />
                              Upload
                            </Button>
                          </div>

                          {mode === "create" ? (
                            createFiles.length === 0 ? (
                              <p className="rounded-lg border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground">
                                No attachments. Click Upload to add files.
                              </p>
                            ) : (
                              <ScrollArea className="h-40 rounded-lg border border-border/70">
                                <div className="space-y-2 p-2">
                                  {createFiles.map((file, index) => (
                                    <div
                                      key={`${file.name}-${file.lastModified}-${index}`}
                                      className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-2 py-2"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm">{file.name}</p>
                                        <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        onClick={() => removeCreateFile(index)}
                                        aria-label={`Remove ${file.name}`}
                                      >
                                        <Trash2Icon className="h-4 w-4 text-destructive" />
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              </ScrollArea>
                            )
                          ) : attachmentsLoading ? (
                            <p className="rounded-lg border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground">
                              Loading attachments...
                            </p>
                          ) : attachments.length === 0 ? (
                            <p className="rounded-lg border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground">
                              No attachments yet.
                            </p>
                          ) : (
                            <ScrollArea className="h-40 rounded-lg border border-border/70">
                              <div className="space-y-2 p-2">
                                {attachments.map((attachment) => {
                                  const isImage = attachment.mimeType.startsWith("image/");
                                  return (
                                    <div
                                      key={attachment.id}
                                      className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/25 p-2"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                          {isImage ? (
                                            <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                          ) : (
                                            <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                          )}
                                          <p className="truncate text-sm">{attachment.name}</p>
                                        </div>
                                        <p className="text-xs text-muted-foreground">{formatBytes(attachment.size)}</p>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        {isImage ? (
                                          <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            onClick={() => setPreviewAttachment(attachment)}
                                            aria-label={`Preview ${attachment.name}`}
                                          >
                                            <EyeIcon className="h-4 w-4" />
                                          </Button>
                                        ) : null}
                                        <Button variant="ghost" size="icon-sm" asChild>
                                          <a
                                            href={attachment.url}
                                            download={attachment.name}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            aria-label={`Download ${attachment.name}`}
                                          >
                                            <DownloadIcon className="h-4 w-4" />
                                          </a>
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="icon-sm"
                                          onClick={() => onDeleteAttachment(attachment.id)}
                                          aria-label={`Delete ${attachment.name}`}
                                        >
                                          <Trash2Icon className="h-4 w-4 text-destructive" />
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </ScrollArea>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  )}
                </Card>
                {mode === "edit" ? (
                  <Card className="gap-0 border-border/70 bg-card/70 py-0 shadow-sm">
                    <SectionCardHeader
                      label="TASKS"
                      count={subtasks.length}
                      collapsed={tasksCollapsed}
                      onToggle={() => setTasksCollapsed((current) => !current)}
                    />
                    {!tasksCollapsed && (
                      <CardContent className="space-y-4 p-4 sm:p-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            value={subtaskDraft}
                            onChange={(event) => onSubtaskDraftChange(event.target.value)}
                            placeholder="Add subtask..."
                            className="h-9 min-w-[220px] flex-1"
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                onAddSubtask();
                              }
                            }}
                          />
                          <Button size="sm" variant="secondary" onClick={onAddSubtask}>
                            <PlusIcon className="h-4 w-4" />
                            Add task
                          </Button>
                          <Button
                            variant={hideComplete ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setHideComplete((current) => !current)}
                          >
                            Hide complete
                          </Button>
                        </div>

                        {subtasksLoading ? (
                          <p className="text-xs text-muted-foreground">Loading tasks...</p>
                        ) : visibleSubtasks.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No tasks to show.</p>
                        ) : (
                          <div className="space-y-1.5">
                            {visibleSubtasks.map((subtask) => (
                              <div
                                key={subtask.id}
                                className={cn(
                                  "flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 px-2 py-2",
                                  subtask.completed && "opacity-70",
                                )}
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <Checkbox
                                    checked={subtask.completed}
                                    onCheckedChange={(checked) =>
                                      onToggleSubtask(subtask.id, Boolean(checked))
                                    }
                                  />
                                  <p
                                    className={cn(
                                      "truncate text-sm",
                                      subtask.completed && "text-muted-foreground line-through",
                                    )}
                                  >
                                    {subtask.title}
                                  </p>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => onDeleteSubtask(subtask.id)}
                                  aria-label={`Delete ${subtask.title}`}
                                >
                                  <Trash2Icon className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    )}
                  </Card>
                ) : null}
              </TabsContent>

              <TabsContent value="comments" className="m-0 pb-4">
                <div className="space-y-4 rounded-xl border border-border/70 bg-card/70 p-4 sm:p-5">
                  {mode === "create" ? (
                    <p className="text-sm text-muted-foreground">
                      Comments are available after creating the ticket.
                    </p>
                  ) : (
                    <>
                      <div className="rounded-xl border border-[#1A212B] bg-[#10151C] p-3">
                        <div className="flex items-start gap-2">
                          <Avatar className="mt-1 h-7 w-7 border border-[#2a3240]">
                            <AvatarFallback className="text-[10px]">ME</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex items-center gap-2 rounded-lg border border-[#202733] bg-[#0B0F14] px-2 py-1.5 focus-within:ring-1 focus-within:ring-ring">
                              <Input
                                id="comment-draft"
                                value={commentDraft}
                                onChange={(event) => onCommentDraftChange(event.target.value)}
                                placeholder="Write a comment"
                                className="h-7 border-0 bg-transparent px-1 text-sm text-foreground shadow-none focus-visible:ring-0"
                              />
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={onAddComment}
                                disabled={!commentDraft.trim()}
                                className="h-7 w-7 rounded-md bg-[#1B222D] text-foreground hover:bg-[#273142]"
                                aria-label="Send comment"
                              >
                                <SendHorizonalIcon className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            <p className="text-right text-[11px] text-muted-foreground">Comments are visible to workspace collaborators.</p>
                          </div>
                        </div>
                      </div>

                      <Separator className="bg-border/70" />

                      {commentsLoading ? (
                        <p className="text-xs text-muted-foreground">Loading comments...</p>
                      ) : comments.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No comments yet.</p>
                      ) : (
                        <ScrollArea className="h-[360px] pr-1">
                          <div className="space-y-3">
                            {comments.map((comment) => (
                              <div key={comment.id} className="flex items-start gap-3">
                                <Avatar className="mt-0.5 h-8 w-8 border border-border/70">
                                  <AvatarFallback className="bg-muted text-[10px]">
                                    {initialsFromName(comment.authorName)}
                                  </AvatarFallback>
                                </Avatar>

                                <div className="min-w-0 flex-1 rounded-xl border border-border/70 bg-muted/20 p-3">
                                  <div className="mb-1.5 flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-medium">{comment.authorName}</p>
                                      <span className="text-xs text-muted-foreground">
                                        {formatCommentDate(comment.createdAt)}
                                      </span>
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      onClick={() => onDeleteComment(comment.id)}
                                      aria-label="Delete comment"
                                    >
                                      <Trash2Icon className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </div>

                                  <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                                    {comment.content}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      )}
                    </>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="activity" className="m-0 pb-4">
                <Card className="gap-0 border-border/70 bg-card/70 py-0 shadow-sm">
                  <CardContent className="space-y-3 p-4 sm:p-5">
                    <p className="text-sm font-medium">Activity</p>
                    {mode === "create" ? (
                      <p className="text-sm text-muted-foreground">
                        Activity is available after creating the ticket.
                      </p>
                    ) : activityLoading ? (
                      <p className="text-xs text-muted-foreground">Loading activity...</p>
                    ) : activity.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No activity yet.</p>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-1">
                          <Button type="button" size="sm" variant={activityFilter === "all" ? "default" : "outline"} onClick={() => setActivityFilter("all")}>All</Button>
                          <Button type="button" size="sm" variant={activityFilter === "execution" ? "default" : "outline"} onClick={() => setActivityFilter("execution")}>Execution</Button>
                          <Button type="button" size="sm" variant={activityFilter === "comments" ? "default" : "outline"} onClick={() => setActivityFilter("comments")}>Comments</Button>
                        </div>
                        <ScrollArea className="h-[360px] pr-1">
                          <div className="space-y-2">
                            {filteredActivity.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No activity for this filter.</p>
                            ) : null}
                            {filteredActivity.map((entry) => (
                            <div
                              key={entry.id}
                              className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={cn(
                                      "inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                                      entry.level === "success" && "bg-emerald-500/15 text-emerald-400",
                                      entry.level === "warning" && "bg-amber-500/15 text-amber-400",
                                      entry.level === "error" && "bg-destructive/15 text-destructive",
                                      entry.level === "info" && "bg-blue-500/15 text-blue-400",
                                    )}
                                  >
                                    {entry.level}
                                  </span>
                                  <p className="text-sm font-medium">{entry.event}</p>
                                </div>
                                <span className="text-xs text-muted-foreground">
                                  {formatActivityDate(entry.occurredAt)}
                                </span>
                              </div>
                              {(entry.details || entry.source) && (
                                <div className="mt-1 rounded-md border border-border/60 bg-background/80 px-2 py-1.5">
                                  <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Details</p>
                                  <p className="max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-foreground/90">
                                    {entry.details}
                                    {entry.source ? `\nsource: ${entry.source}` : ""}
                                  </p>
                                </div>
                              )}
                            </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(previewAttachment)}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setPreviewAttachment(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{previewAttachment?.name ?? "Image preview"}</DialogTitle>
            <DialogDescription>
              Preview of attached image. Use the download button to save.
            </DialogDescription>
          </DialogHeader>
          {previewAttachment ? (
            <div className="space-y-3">
              <div className="overflow-hidden rounded-md border bg-muted/20">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewAttachment.url}
                  alt={previewAttachment.name}
                  className="max-h-[70vh] w-full object-contain"
                />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{formatBytes(previewAttachment.size)}</span>
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={previewAttachment.url}
                    download={previewAttachment.name}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <DownloadIcon className="h-4 w-4" />
                    Download
                  </a>
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
