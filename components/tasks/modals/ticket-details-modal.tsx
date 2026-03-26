"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
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
  TicketSubtask,
} from "@/types/tasks";
import {
  CheckSquareIcon,
  ClipboardListIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  ListIcon,
  MoreHorizontalIcon,
  PaperclipIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SendHorizonalIcon,
  SettingsIcon,
  SquarePenIcon,
  TagIcon,
  Trash2Icon,
  UserIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";

type ProcessOption = {
  id: string;
  name: string;
  versionId: string;
  versionNumber: number;
};

type ActivityFilter = "all" | "execution" | "comments";

const executionLabel = (value: string) =>
  value.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());

const formatCommentDate = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const formatActivityDate = formatCommentDate;

const initialsFromName = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "OC";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
};

const formatBytes = (size: number) =>
  size < 1024
    ? `${size} B`
    : size / 1024 < 1024
      ? `${(size / 1024).toFixed(1)} KB`
      : `${(size / 1024 / 1024).toFixed(1)} MB`;

type Props = {
  mode?: "create" | "edit";
  open: boolean;
  form: TicketDetailsForm;
  board: BoardState;
  assignees: Assignee[];
  processes?: ProcessOption[];
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
  onStartExecution?: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export function TicketDetailsModal({
  mode = "edit",
  open,
  form,
  board,
  assignees,
  processes = [],
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
  onStartExecution,
  onCopy,
  onDelete,
  onClose,
}: Props) {
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [createFiles, setCreateFiles] = useState<File[]>([]);
  const [previewAttachment, setPreviewAttachment] = useState<TicketAttachment | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  const isEditing = mode === "edit";
  const saveLabel = isEditing ? "Save changes" : "Create ticket";

  const addCreateFiles = (selection: FileList | null) => {
    if (selection?.length) setCreateFiles((prev) => [...prev, ...Array.from(selection)]);
  };
  const removeCreateFile = (index: number) =>
    setCreateFiles((prev) => prev.filter((_, i) => i !== index));

  const handleSave = () => {
    onSave(mode === "create" ? createFiles : undefined);
  };

  const toggleAssignee = (assigneeId: string) =>
    onChange({
      assigneeIds: form.assigneeIds.includes(assigneeId)
        ? form.assigneeIds.filter((id) => id !== assigneeId)
        : [...form.assigneeIds, assigneeId],
    });

  const removeProcess = (pvId: string) =>
    onChange({
      processVersionIds: form.processVersionIds.filter((id) => id !== pvId),
    });

  // Execution control visibility
  const hasAgent = Boolean(form.assignedAgentId);
  const showStartExecution =
    isEditing && hasAgent && (form.executionState === "open" || form.executionState === "draft");
  const showRetry = isEditing && form.executionState === "failed";
  const showCancel =
    isEditing &&
    (form.executionState === "executing" || form.executionState === "planning");
  const showApproval = isEditing && form.executionState === "awaiting_approval";
  const showExecutionControls =
    showStartExecution || showRetry || showCancel || showApproval;

  const filteredActivity = useMemo(() => {
    if (activityFilter === "all") return activity;
    if (activityFilter === "execution") {
      return activity.filter((e) => {
        const ev = (e.event || "").toLowerCase();
        return (
          ev.includes("plan") ||
          ev.includes("execute") ||
          ev.includes("fail") ||
          ev.includes("retry") ||
          ev.includes("picked") ||
          ev.includes("completed") ||
          ev.includes("queued")
        );
      });
    }
    return activity.filter((e) =>
      (e.event || "").toLowerCase().includes("comment"),
    );
  }, [activity, activityFilter]);

  const selectedAssignees = form.assigneeIds
    .map((id) => assignees.find((a) => a.id === id))
    .filter(Boolean) as Assignee[];

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) onClose();
        }}
      >
        <DialogContent className="sm:max-w-[640px] max-h-[92vh] overflow-y-auto p-0">
          {/* Header */}
          <DialogHeader className="px-6 pt-6 pb-0">
            <div className="flex items-center gap-3 mb-1">
              <div
                className={cn(
                  "flex items-center justify-center size-9 rounded-lg shrink-0",
                  isEditing ? "bg-primary/10" : "bg-primary",
                )}
              >
                <ClipboardListIcon
                  className={cn(
                    "size-4.5",
                    isEditing ? "text-primary" : "text-primary-foreground",
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-lg">
                  {isEditing ? "Edit ticket" : "New ticket"}
                </DialogTitle>
                <DialogDescription className="text-xs mt-0.5">
                  {isEditing
                    ? "Update details, manage subtasks, attachments, and execution."
                    : "Create a new ticket with description, processes, and assignment."}
                </DialogDescription>
              </div>
              {isEditing && (
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="cursor-pointer text-muted-foreground hover:bg-muted"
                    onClick={onCopy}
                    aria-label="Duplicate"
                  >
                    <CopyIcon className="h-4 w-4" />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="cursor-pointer text-muted-foreground hover:bg-muted"
                        aria-label="More actions"
                      >
                        <MoreHorizontalIcon className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={onDelete}
                        className="cursor-pointer"
                      >
                        <Trash2Icon className="h-4 w-4" />
                        Delete ticket
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          </DialogHeader>

          <div className="flex flex-col gap-5 px-6 py-5">
            {/* Title */}
            <div className="flex flex-col gap-2">
              <Label
                htmlFor="td-title"
                className="text-xs font-semibold text-foreground/80"
              >
                Title <span className="text-destructive ml-0.5">*</span>
              </Label>
              <Input
                id="td-title"
                placeholder="e.g. Fix authentication flow"
                value={form.title}
                onChange={(e) => onChange({ title: e.target.value })}
                className="h-10"
                autoFocus
              />
            </div>

            {/* Description */}
            <div className="flex flex-col gap-2">
              <Label
                htmlFor="td-desc"
                className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5"
              >
                <FileTextIcon className="size-3.5 text-primary" />
                Description
              </Label>
              <Textarea
                id="td-desc"
                placeholder="Add notes, implementation details, or context..."
                value={form.description}
                onChange={(e) => onChange({ description: e.target.value })}
                rows={4}
                className="resize-none"
              />
            </div>

            {/* Processes */}
            <div className="flex flex-col gap-2">
              <Label className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
                <ListIcon className="size-3.5 text-primary" />
                Attached processes
              </Label>

              {form.processVersionIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {form.processVersionIds.map((pvId) => {
                    const proc = processes.find((p) => p.versionId === pvId);
                    return (
                      <Badge
                        key={pvId}
                        variant="secondary"
                        className="gap-1.5 pl-2.5 pr-1.5 py-1 text-xs font-semibold"
                      >
                        {proc
                          ? `${proc.name}${proc.versionNumber ? ` v${proc.versionNumber}` : ""}`
                          : pvId.slice(0, 8)}
                        <button
                          type="button"
                          onClick={() => removeProcess(pvId)}
                          className="ml-0.5 cursor-pointer hover:text-destructive rounded-sm transition-colors"
                        >
                          <XIcon className="size-3" />
                        </button>
                      </Badge>
                    );
                  })}
                </div>
              )}

              {processes.length > 0 ? (
                <Select
                  onValueChange={(v) => {
                    if (v && !form.processVersionIds.includes(v)) {
                      onChange({
                        processVersionIds: [...form.processVersionIds, v],
                      });
                    }
                  }}
                >
                  <SelectTrigger className="h-10 w-full cursor-pointer">
                    <SelectValue placeholder="Attach a process..." />
                  </SelectTrigger>
                  <SelectContent>
                    {processes.filter(
                      (p) => !form.processVersionIds.includes(p.versionId),
                    ).length === 0 ? (
                      <SelectItem value="__empty__" disabled>
                        All processes attached
                      </SelectItem>
                    ) : (
                      processes
                        .filter(
                          (p) => !form.processVersionIds.includes(p.versionId),
                        )
                        .map((p) => (
                          <SelectItem key={p.versionId} value={p.versionId}>
                            {p.name}
                            {p.versionNumber ? ` (v${p.versionNumber})` : ""}
                          </SelectItem>
                        ))
                    )}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-[11px] text-muted-foreground/70">
                  No processes available. Create processes in the Processes page.
                </p>
              )}
            </div>

            <Separator />

            {/* Assignment & Priority */}
            <div className="flex flex-col gap-4">
              <Label className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
                <UserIcon className="size-3.5 text-primary" />
                Assignment &amp; Priority
              </Label>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-[11px] text-muted-foreground font-medium">
                    Agent
                  </Label>
                  <Select
                    value={form.assignedAgentId || "__none__"}
                    onValueChange={(v) =>
                      onChange({ assignedAgentId: v === "__none__" ? "" : v })
                    }
                  >
                    <SelectTrigger className="h-10 cursor-pointer">
                      <SelectValue placeholder="No agent (manual)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        No agent (manual)
                      </SelectItem>
                      {assignees.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name || a.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label className="text-[11px] text-muted-foreground font-medium">
                    Priority
                  </Label>
                  <Select
                    value={form.priority}
                    onValueChange={(v) =>
                      onChange({
                        priority: v as TicketDetailsForm["priority"],
                      })
                    }
                  >
                    <SelectTrigger className="h-10 cursor-pointer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TICKET_PRIORITY_OPTIONS.map((opt) => (
                        <SelectItem
                          key={opt.key}
                          value={opt.key}
                          className="cursor-pointer"
                        >
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Assignees (collaborators) */}
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11px] text-muted-foreground font-medium">
                  Assignees / Collaborators
                </Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-between cursor-pointer h-10"
                    >
                      <span className="truncate">
                        {selectedAssignees.length > 0
                          ? `${selectedAssignees.length} selected — ${selectedAssignees.map((a) => a.name).join(", ")}`
                          : "Assign people"}
                      </span>
                      <MoreHorizontalIcon className="h-4 w-4 shrink-0" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    {assignees.map((assignee) => (
                      <DropdownMenuItem
                        key={assignee.id}
                        onClick={() => toggleAssignee(assignee.id)}
                        className="cursor-pointer"
                      >
                        <span className="mr-2">
                          {form.assigneeIds.includes(assignee.id) ? "✓" : ""}
                        </span>
                        {assignee.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Status & Execution */}
            <div className="flex flex-col gap-4">
              <Label className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
                <SettingsIcon className="size-3.5 text-primary" />
                Status &amp; Execution
              </Label>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-[11px] text-muted-foreground font-medium">
                    Column / Status
                  </Label>
                  <Select
                    value={form.statusId}
                    onValueChange={(v) => onChange({ statusId: v })}
                  >
                    <SelectTrigger className="h-10 cursor-pointer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {board.columnOrder.map((colId) => (
                        <SelectItem
                          key={colId}
                          value={colId}
                          className="cursor-pointer"
                        >
                          {board.columns[colId]?.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label className="text-[11px] text-muted-foreground font-medium">
                    Execution mode
                  </Label>
                  <Select
                    value={form.executionMode}
                    onValueChange={(v) =>
                      onChange({
                        executionMode:
                          v as TicketDetailsForm["executionMode"],
                      })
                    }
                  >
                    <SelectTrigger className="h-10 cursor-pointer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="direct" className="cursor-pointer">
                        Direct
                      </SelectItem>
                      <SelectItem value="planned" className="cursor-pointer">
                        Planned (approval)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {isEditing && (
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="text-xs font-normal"
                  >
                    {executionLabel(form.executionState)}
                  </Badge>
                  {form.executionMode === "planned" && (
                    <Badge
                      variant="outline"
                      className="text-xs font-normal"
                    >
                      {form.planApproved ? "Plan approved" : "Plan pending"}
                    </Badge>
                  )}
                </div>
              )}
            </div>

            {/* Schedule & Labels */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="td-due"
                  className="text-[11px] text-muted-foreground font-medium flex items-center gap-1.5"
                >
                  Due date
                </Label>
                <Input
                  id="td-due"
                  type="date"
                  value={form.scheduledFor || form.dueDate}
                  onChange={(e) =>
                    onChange({
                      dueDate: e.target.value,
                      scheduledFor: e.target.value,
                    })
                  }
                  className="h-10"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="td-labels"
                  className="text-[11px] text-muted-foreground font-medium flex items-center gap-1.5"
                >
                  <TagIcon className="size-3 text-muted-foreground" />
                  Labels
                </Label>
                <Input
                  id="td-labels"
                  value={form.tagsText}
                  placeholder="bug, ui, backend"
                  onChange={(e) => onChange({ tagsText: e.target.value })}
                  className="h-10"
                />
              </div>
            </div>

            <Separator />

            {/* Subtasks */}
            <div className="flex flex-col gap-3">
              <Label className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
                <CheckSquareIcon className="size-3.5 text-primary" />
                Subtasks
              </Label>

              <div className="flex items-center gap-2">
                <Input
                  value={subtaskDraft}
                  onChange={(e) => onSubtaskDraftChange(e.target.value)}
                  placeholder="Add subtask..."
                  className="h-9 flex-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onAddSubtask();
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={onAddSubtask}
                  className="cursor-pointer"
                >
                  <PlusIcon className="h-4 w-4" />
                  Add
                </Button>
              </div>

              {subtasksLoading ? (
                <p className="text-xs text-muted-foreground">
                  Loading subtasks...
                </p>
              ) : subtasks.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No subtasks yet.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {subtasks.map((subtask) => (
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
                            subtask.completed &&
                              "text-muted-foreground line-through",
                          )}
                        >
                          {subtask.title}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onDeleteSubtask(subtask.id)}
                        className="cursor-pointer"
                        aria-label={`Delete ${subtask.title}`}
                      >
                        <Trash2Icon className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Attachments */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
                  <PaperclipIcon className="size-3.5 text-primary" />
                  Attachments
                </Label>
                <Input
                  ref={attachmentInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  onChange={(e) => {
                    if (mode === "create") {
                      addCreateFiles(e.target.files);
                    } else {
                      onUploadAttachments(e.target.files);
                    }
                    e.currentTarget.value = "";
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => attachmentInputRef.current?.click()}
                  disabled={isEditing ? attachmentsUploading : false}
                  className="cursor-pointer"
                >
                  <PlusIcon className="h-4 w-4" />
                  Upload
                </Button>
              </div>

              {mode === "create" ? (
                createFiles.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground">
                    No attachments. Click Upload to add files.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {createFiles.map((file, index) => (
                      <div
                        key={`${file.name}-${file.lastModified}-${index}`}
                        className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-2 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{file.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatBytes(file.size)}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeCreateFile(index)}
                          className="cursor-pointer"
                        >
                          <Trash2Icon className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )
              ) : attachmentsLoading ? (
                <p className="text-xs text-muted-foreground">
                  Loading attachments...
                </p>
              ) : attachments.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground">
                  No attachments yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {attachments.map((att) => {
                    const isImage = att.mimeType.startsWith("image/");
                    return (
                      <div
                        key={att.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/25 p-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {isImage ? (
                              <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            ) : (
                              <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            )}
                            <p className="truncate text-sm">{att.name}</p>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {formatBytes(att.size)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          {isImage && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setPreviewAttachment(att)}
                              className="cursor-pointer"
                            >
                              <EyeIcon className="h-4 w-4" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon-sm" asChild>
                            <a
                              href={att.url}
                              download={att.name}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <DownloadIcon className="h-4 w-4" />
                            </a>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => onDeleteAttachment(att.id)}
                            className="cursor-pointer"
                          >
                            <Trash2Icon className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Execution Controls */}
            {showExecutionControls && (
              <>
                <Separator />
                <div className="flex flex-col gap-3">
                  <Label className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
                    <ZapIcon className="size-3.5 text-primary" />
                    Execution Controls
                  </Label>
                  <div className="flex flex-wrap items-center gap-2">
                    {showStartExecution && (
                      <Button
                        size="sm"
                        onClick={onStartExecution}
                        className="gap-1.5 cursor-pointer"
                      >
                        <PlayIcon className="h-3.5 w-3.5" />
                        Start execution
                      </Button>
                    )}
                    {showRetry && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onRetryNow}
                        className="gap-1.5 cursor-pointer"
                      >
                        <RefreshCwIcon className="h-3.5 w-3.5" />
                        Retry
                      </Button>
                    )}
                    {showCancel && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onCancelExecution}
                        className="gap-1.5 cursor-pointer"
                      >
                        <XIcon className="h-3.5 w-3.5" />
                        Cancel
                      </Button>
                    )}
                    {showApproval && (
                      <>
                        <Button
                          size="sm"
                          onClick={onApprovePlan}
                          className="gap-1.5 cursor-pointer"
                        >
                          Approve plan
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={onRejectPlan}
                          className="gap-1.5 cursor-pointer"
                        >
                          Reject plan
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Comments — edit mode only */}
            {isEditing && (
              <>
                <Separator />
                <div className="flex flex-col gap-3">
                  <Label className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
                    <SquarePenIcon className="size-3.5 text-primary" />
                    Comments
                  </Label>

                  <div className="flex items-start gap-2">
                    <div className="flex-1 flex items-center gap-2 rounded-lg border border-border/70 bg-muted/10 px-2 py-1.5 focus-within:ring-1 focus-within:ring-ring">
                      <Input
                        value={commentDraft}
                        onChange={(e) => onCommentDraftChange(e.target.value)}
                        placeholder="Write a comment..."
                        className="h-7 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && commentDraft.trim()) {
                            e.preventDefault();
                            onAddComment();
                          }
                        }}
                      />
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={onAddComment}
                        disabled={!commentDraft.trim()}
                        className="h-7 w-7 cursor-pointer"
                        aria-label="Send comment"
                      >
                        <SendHorizonalIcon className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {commentsLoading ? (
                    <p className="text-xs text-muted-foreground">
                      Loading comments...
                    </p>
                  ) : comments.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No comments yet.
                    </p>
                  ) : (
                    <ScrollArea className="max-h-[200px]">
                      <div className="space-y-2">
                        {comments.map((comment) => (
                          <div
                            key={comment.id}
                            className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/20 p-2.5"
                          >
                            <Avatar className="mt-0.5 h-6 w-6 border border-border/70">
                              <AvatarFallback className="bg-muted text-[9px]">
                                {initialsFromName(comment.authorName)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-medium">
                                  {comment.authorName}
                                </p>
                                <span className="text-[10px] text-muted-foreground">
                                  {formatCommentDate(comment.createdAt)}
                                </span>
                              </div>
                              <p className="mt-0.5 whitespace-pre-wrap text-xs leading-5 text-foreground">
                                {comment.content}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => onDeleteComment(comment.id)}
                              className="cursor-pointer shrink-0"
                            >
                              <Trash2Icon className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              </>
            )}

            {/* Activity — edit mode only */}
            {isEditing && (
              <>
                <Separator />
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
                      <ZapIcon className="size-3.5 text-primary" />
                      Activity
                    </Label>
                    <div className="flex gap-1">
                      {(["all", "execution", "comments"] as const).map(
                        (filter) => (
                          <Button
                            key={filter}
                            type="button"
                            size="sm"
                            variant={
                              activityFilter === filter ? "default" : "outline"
                            }
                            onClick={() => setActivityFilter(filter)}
                            className="h-6 px-2 text-[10px] cursor-pointer capitalize"
                          >
                            {filter}
                          </Button>
                        ),
                      )}
                    </div>
                  </div>

                  {activityLoading ? (
                    <p className="text-xs text-muted-foreground">
                      Loading activity...
                    </p>
                  ) : filteredActivity.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No activity yet.
                    </p>
                  ) : (
                    <ScrollArea className="max-h-[200px]">
                      <div className="space-y-1.5">
                        {filteredActivity.map((entry) => (
                          <div
                            key={entry.id}
                            className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-medium">
                                {entry.event}
                              </p>
                              <span className="text-[10px] text-muted-foreground">
                                {formatActivityDate(entry.occurredAt)}
                              </span>
                            </div>
                            {entry.details && (
                              <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-foreground/80 line-clamp-3">
                                {entry.details}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              </>
            )}
          </div>

          <DialogFooter className="px-6 pb-6 pt-0 gap-2">
            <Button
              variant="ghost"
              onClick={onClose}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button onClick={handleSave} className="gap-1.5 cursor-pointer">
              <ClipboardListIcon className="size-3.5" />
              {saveLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image preview dialog */}
      <Dialog
        open={Boolean(previewAttachment)}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPreviewAttachment(null);
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {previewAttachment?.name ?? "Image preview"}
            </DialogTitle>
            <DialogDescription>
              Preview of attached image.
            </DialogDescription>
          </DialogHeader>
          {previewAttachment && (
            <div className="space-y-3">
              <div className="overflow-hidden rounded-md border bg-muted/20">
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
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
