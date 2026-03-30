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
import { getProviderLabel } from "@/lib/models";
import { useModels } from "@/lib/use-models";
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
  BotIcon,
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
  SquarePenIcon,
  TagIcon,
  Trash2Icon,
  UserIcon,
  XIcon,
  ZapIcon,
  LockIcon,
  ShieldCheckIcon,
} from "lucide-react";

function getTimezoneAbbr(timezone: string, date?: Date): string {
  try {
    const d = date || new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'short',
    }).formatToParts(d);
    return parts.find(p => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

type ProcessOption = {
  id: string;
  name: string;
  versionId: string;
  versionNumber: number;
};

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

// ── Helpers ──────────────────────────────────────────────────────────────────

const executionLabel = (v: string) => v.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
const formatDate = (v: string) => new Date(v).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const initials = (name: string) => {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return "OC";
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
};
const fmtBytes = (s: number) => s < 1024 ? `${s} B` : s < 1048576 ? `${(s / 1024).toFixed(1)} KB` : `${(s / 1048576).toFixed(1)} MB`;

// ── Markdown renderer for agent output ───────────────────────────────────────

function renderActivityInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  while (remaining.length > 0) {
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(<code key={key++} className="px-1 py-0.5 bg-muted rounded text-[10px] font-mono">{codeMatch[1]}</code>);
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      parts.push(<strong key={key++} className="font-bold">{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }
    const italicMatch = remaining.match(/^\*(.+?)\*/);
    if (italicMatch) {
      parts.push(<em key={key++}>{italicMatch[1]}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }
    const nextSpecial = remaining.search(/[`*]/);
    if (nextSpecial === -1) { parts.push(remaining); break; }
    if (nextSpecial === 0) { parts.push(remaining[0]); remaining = remaining.slice(1); }
    else { parts.push(remaining.slice(0, nextSpecial)); remaining = remaining.slice(nextSpecial); }
  }
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

function ActivityMarkdown({ text }: { text: string }) {
  // Strip agent footer line
  const cleaned = text.replace(/\n*>\s*`Agent:.*`$/, "").trim();
  const lines = cleaned.split("\n");
  return (
    <div className="flex flex-col gap-0.5 text-[12px] leading-relaxed text-foreground/90">
      {lines.map((line, i) => {
        if (line.startsWith("### ")) return <h4 key={i} className="text-[12px] font-bold mt-2 mb-0.5">{renderActivityInline(line.slice(4))}</h4>;
        if (line.startsWith("## ")) return <h3 key={i} className="text-[13px] font-bold mt-2 mb-0.5">{renderActivityInline(line.slice(3))}</h3>;
        if (line.startsWith("# ")) return <h2 key={i} className="text-sm font-bold mt-2 mb-0.5">{renderActivityInline(line.slice(2))}</h2>;
        if (/^[-*]\s/.test(line)) return (
          <div key={i} className="flex gap-1.5 pl-1">
            <span className="text-muted-foreground shrink-0">•</span>
            <span>{renderActivityInline(line.replace(/^[-*]\s/, ""))}</span>
          </div>
        );
        if (/^\d+\.\s/.test(line)) {
          const num = line.match(/^(\d+)\./)?.[1];
          return (
            <div key={i} className="flex gap-1.5 pl-1">
              <span className="text-muted-foreground shrink-0 tabular-nums">{num}.</span>
              <span>{renderActivityInline(line.replace(/^\d+\.\s/, ""))}</span>
            </div>
          );
        }
        if (line.trim() === "") return <div key={i} className="h-1" />;
        return <p key={i}>{renderActivityInline(line)}</p>;
      })}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function TicketDetailsModal({
  mode = "edit", open, form, board, assignees, processes = [],
  attachments, attachmentsLoading, attachmentsUploading,
  subtasks, subtasksLoading, subtaskDraft, onSubtaskDraftChange, onAddSubtask, onToggleSubtask, onDeleteSubtask,
  comments, commentsLoading, commentDraft, onCommentDraftChange, onAddComment, onDeleteComment,
  activity, activityLoading, onChange, onUploadAttachments, onDeleteAttachment,
  onSave, onRetryNow, onCancelExecution, onApprovePlan, onRejectPlan, onStartExecution,
  onCopy, onDelete, onClose,
}: Props) {
  const isEditing = mode === "edit";
  const [createFiles, setCreateFiles] = useState<File[]>([]);
  const [previewAtt, setPreviewAtt] = useState<TicketAttachment | null>(null);
  // Auto-open activity when there are agent responses
  const hasAgentOutput = activity.some((e) => e.event === "Agent response" || e.event === "Plan generated");
  const [showActivity, setShowActivity] = useState(hasAgentOutput);
  const models = useModels();
  const attachRef = useRef<HTMLInputElement | null>(null);

  const hasAgent = Boolean(form.assignedAgentId);
  const showStart = isEditing && hasAgent && ["open", "draft"].includes(form.executionState);
  const showRetry = isEditing && ["failed", "needs_retry", "expired"].includes(form.executionState);
  const showCancel = isEditing && ["executing", "planning"].includes(form.executionState);
  const showApproval = isEditing && form.executionState === "awaiting_approval";
  const isLocked = isEditing && ["executing", "running"].includes(form.executionState);

  const removeProcess = (pvId: string) => onChange({ processVersionIds: form.processVersionIds.filter((id) => id !== pvId) });

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="sm:max-w-[760px] max-h-[92vh] overflow-hidden p-0">
          {/* Header */}
          <DialogHeader className="px-6 pt-5 pb-0">
            <div className="flex items-center gap-3">
              <div className={cn("flex items-center justify-center size-8 rounded-lg shrink-0", isEditing ? "bg-primary/10" : "bg-primary")}>
                <ClipboardListIcon className={cn("size-4", isEditing ? "text-primary" : "text-primary-foreground")} />
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-base">{isEditing ? "Edit ticket" : "New ticket"}</DialogTitle>
                <DialogDescription className="text-[11px]">
                  {isEditing ? "Update details, checklist, and attachments" : "Create a new ticket"}
                </DialogDescription>
              </div>
              {isEditing && (
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon-sm" onClick={onCopy} className="cursor-pointer"><CopyIcon className="h-3.5 w-3.5" /></Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" className="cursor-pointer"><MoreHorizontalIcon className="h-3.5 w-3.5" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem variant="destructive" onClick={onDelete} className="cursor-pointer">
                        <Trash2Icon className="h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          </DialogHeader>

          {/* Execution lock banner */}
          {isLocked && (
            <div className="mx-6 mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
              <LockIcon className="size-3.5 shrink-0" />
              <span>This ticket is currently executing. Editing is disabled until execution completes or is cancelled.</span>
            </div>
          )}

          {/* Two-column Trello layout */}
          <div className="flex overflow-hidden" style={{ maxHeight: "calc(92vh - 140px)" }}>
            {/* ── Main column (left) ─────────────────────────────── */}
            <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4 min-w-0">
              {/* Title */}
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold text-muted-foreground">Title</Label>
                <Input
                  placeholder="Ticket title..."
                  value={form.title}
                  onChange={(e) => onChange({ title: e.target.value })}
                  className="h-10 text-base font-semibold"
                  autoFocus
                />
              </div>

              {/* Description */}
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <FileTextIcon className="size-3" /> Description
                </Label>
                <Textarea
                  placeholder="Add a more detailed description..."
                  value={form.description}
                  onChange={(e) => onChange({ description: e.target.value })}
                  rows={6}
                  className="resize-y text-sm min-h-[120px]"
                />
              </div>

              {/* Checklist (Subtasks) */}
              <div className="flex flex-col gap-2">
                <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <CheckSquareIcon className="size-3" /> Checklist
                  {subtasks.length > 0 && (
                    <span className="text-[10px] tabular-nums">
                      ({subtasks.filter((s) => s.completed).length}/{subtasks.length})
                    </span>
                  )}
                </Label>

                {subtasks.length > 0 && (
                  <div className="rounded-lg border divide-y">
                    {subtasks.map((st) => (
                      <div key={st.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors">
                        <Checkbox checked={st.completed} onCheckedChange={(c) => onToggleSubtask(st.id, Boolean(c))} />
                        <span className={cn("flex-1 text-sm", st.completed && "line-through text-muted-foreground")}>{st.title}</span>
                        <Button variant="ghost" size="icon-sm" onClick={() => onDeleteSubtask(st.id)} className="size-6 cursor-pointer opacity-0 group-hover:opacity-100">
                          <XIcon className="size-3 text-muted-foreground" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <Input
                    value={subtaskDraft}
                    onChange={(e) => onSubtaskDraftChange(e.target.value)}
                    placeholder="Add item..."
                    className="h-8 text-sm flex-1"
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAddSubtask(); } }}
                  />
                  <Button size="sm" variant="secondary" onClick={onAddSubtask} className="h-8 cursor-pointer">Add</Button>
                </div>
              </div>

              {/* Attachments */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                    <PaperclipIcon className="size-3" /> Attachments
                  </Label>
                  <input ref={attachRef} type="file" className="hidden" multiple
                    onChange={(e) => { if (mode === "create") { if (e.target.files?.length) setCreateFiles((p) => [...p, ...Array.from(e.target.files!)]); } else onUploadAttachments(e.target.files); e.currentTarget.value = ""; }} />
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] cursor-pointer" onClick={() => attachRef.current?.click()}>
                    <PlusIcon className="size-3" /> Add
                  </Button>
                </div>

                {mode === "create" && createFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {createFiles.map((f, i) => (
                      <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md border bg-muted/20 px-2 py-1.5 text-xs">
                        <FileIcon className="size-3 text-muted-foreground" />
                        <span className="truncate max-w-[120px]">{f.name}</span>
                        <button onClick={() => setCreateFiles((p) => p.filter((_, j) => j !== i))} className="cursor-pointer"><XIcon className="size-3" /></button>
                      </div>
                    ))}
                  </div>
                )}

                {isEditing && attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {attachments.map((att) => {
                      const mime = att.mimeType || "application/octet-stream";
                      const url = att.url || "";
                      const isImage = mime.startsWith("image/");
                      const isPdf = mime === "application/pdf";
                      const isPreviewable = isImage || isPdf;
                      const isDataUrl = url.startsWith("data:");
                      // For file-served URLs, download link forces attachment
                      const downloadUrl = isDataUrl
                        ? url
                        : url.includes("/api/files?")
                          ? `${url}&download=1`
                          : url;

                      return (
                        <div key={att.id} className="flex items-center gap-2 rounded-md border bg-muted/20 px-2 py-1.5 text-xs">
                          {isImage ? <ImageIcon className="size-3 text-muted-foreground" /> : <FileIcon className="size-3 text-muted-foreground" />}
                          <span className="truncate max-w-[120px]">{att.name}</span>
                          <span className="text-muted-foreground">{fmtBytes(att.size)}</span>
                          {isPreviewable && (
                            <button
                              onClick={() => {
                                if (isImage) setPreviewAtt(att);
                                else window.open(url, "_blank");
                              }}
                              className="cursor-pointer"
                            >
                              <EyeIcon className="size-3" />
                            </button>
                          )}
                          <a href={downloadUrl} download={att.name} target="_blank" rel="noopener noreferrer"><DownloadIcon className="size-3" /></a>
                          <button onClick={() => onDeleteAttachment(att.id)} className="cursor-pointer"><Trash2Icon className="size-3 text-destructive" /></button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Comments (edit only) */}
              {isEditing && (
                <div className="flex flex-col gap-2">
                  <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                    <SquarePenIcon className="size-3" /> Comments
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={commentDraft}
                      onChange={(e) => onCommentDraftChange(e.target.value)}
                      placeholder="Write a comment..."
                      className="h-8 text-sm flex-1"
                      onKeyDown={(e) => { if (e.key === "Enter" && commentDraft.trim()) { e.preventDefault(); onAddComment(); } }}
                    />
                    <Button size="icon-sm" variant="ghost" onClick={onAddComment} disabled={!commentDraft.trim()} className="h-8 w-8 cursor-pointer">
                      <SendHorizonalIcon className="size-3.5" />
                    </Button>
                  </div>
                  {comments.length > 0 && (
                    <ScrollArea className="max-h-[160px]">
                      <div className="space-y-1.5">
                        {comments.map((c) => (
                          <div key={c.id} className="flex items-start gap-2 rounded-md border bg-muted/10 p-2">
                            <Avatar className="size-5 mt-0.5"><AvatarFallback className="text-[8px]">{initials(c.authorName)}</AvatarFallback></Avatar>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-medium">{c.authorName}</span>
                                <span className="text-[9px] text-muted-foreground">{formatDate(c.createdAt)}</span>
                              </div>
                              <p className="text-xs text-foreground/80 whitespace-pre-wrap">{c.content}</p>
                            </div>
                            <button onClick={() => onDeleteComment(c.id)} className="cursor-pointer shrink-0"><Trash2Icon className="size-3 text-destructive/50" /></button>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              )}

              {/* Activity + Agent Output (edit only) */}
              {isEditing && activity.length > 0 && (
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => setShowActivity(!showActivity)}
                    className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 cursor-pointer hover:text-foreground transition-colors"
                  >
                    <ZapIcon className="size-3" /> Activity & Output ({activity.length})
                    <span className="text-[9px]">{showActivity ? "▲" : "▼"}</span>
                  </button>
                  {showActivity && (
                    <ScrollArea className="max-h-[400px]">
                      <div className="space-y-2">
                        {activity.map((e) => {
                          const isAgentOutput = e.source !== "Worker" && e.source !== "Tasks" && e.event === "Agent response";
                          const isError = e.level === "error";
                          const isPlan = e.event === "Plan generated" || e.event === "Plan ready";
                          const hasDetails = Boolean(e.details?.trim());
                          const levelBorder = isError
                            ? "border-l-destructive"
                            : e.level === "success"
                              ? "border-l-emerald-500"
                              : e.level === "warning"
                                ? "border-l-amber-500"
                                : "border-l-blue-500";
                          return (
                            <div
                              key={e.id}
                              className={cn(
                                "rounded-lg border border-border/40 bg-muted/10 px-3 py-2 border-l-[3px]",
                                levelBorder,
                              )}
                            >
                              {/* Header row */}
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  {isAgentOutput && <BotIcon className="size-3 text-primary shrink-0" />}
                                  {isPlan && <ListIcon className="size-3 text-primary shrink-0" />}
                                  <span className={cn(
                                    "text-[11px] font-semibold truncate",
                                    isError ? "text-destructive" : isAgentOutput ? "text-primary" : "text-foreground/80",
                                  )}>
                                    {e.event}
                                  </span>
                                  {e.source && e.source !== "Tasks" && (
                                    <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 shrink-0">
                                      {e.source}
                                    </Badge>
                                  )}
                                </div>
                                <span className="text-[9px] text-muted-foreground shrink-0">{formatDate(e.occurredAt)}</span>
                              </div>

                              {/* Details / Agent output */}
                              {hasDetails && (isAgentOutput || isPlan) ? (
                                <div className="rounded-md bg-card border p-3 mt-1.5">
                                  <ActivityMarkdown text={e.details} />
                                </div>
                              ) : hasDetails ? (
                                <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5 whitespace-pre-wrap break-words line-clamp-4">
                                  {e.details}
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              )}
            </div>

            {/* ── Sidebar (right) — Trello style ─────────────────── */}
            <div className="w-[220px] shrink-0 border-l bg-muted/10 px-4 py-4 overflow-y-auto flex flex-col gap-3">
              {/* Agent */}
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Agent</Label>
                <Select value={form.assignedAgentId || "__none__"} onValueChange={(v) => onChange({ assignedAgentId: v === "__none__" ? "" : v })}>
                  <SelectTrigger className="h-8 text-xs w-full cursor-pointer"><SelectValue placeholder="No agent" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No agent (manual)</SelectItem>
                    {assignees.map((a) => <SelectItem key={a.id} value={a.id}>{a.name || a.id}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Processes */}
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Processes</Label>
                {form.processVersionIds.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {form.processVersionIds.map((pvId) => {
                      const p = processes.find((pr) => pr.versionId === pvId);
                      return (
                        <Badge key={pvId} variant="secondary" className="text-[10px] gap-1 pr-1">
                          {p ? p.name : pvId.slice(0, 6)}
                          <button onClick={() => removeProcess(pvId)} className="cursor-pointer"><XIcon className="size-2.5" /></button>
                        </Badge>
                      );
                    })}
                  </div>
                )}
                {processes.length > 0 && (
                  <Select onValueChange={(v) => { if (v && !form.processVersionIds.includes(v)) onChange({ processVersionIds: [...form.processVersionIds, v] }); }}>
                    <SelectTrigger className="h-8 text-xs w-full cursor-pointer"><SelectValue placeholder="Add process..." /></SelectTrigger>
                    <SelectContent>
                      {processes.filter((p) => !form.processVersionIds.includes(p.versionId)).map((p) => (
                        <SelectItem key={p.versionId} value={p.versionId}>{p.name} v{p.versionNumber}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <Separator />

              {/* List */}
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">List</Label>
                <Select value={form.statusId} onValueChange={(v) => onChange({ statusId: v })}>
                  <SelectTrigger className="h-8 text-xs w-full cursor-pointer"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {board.columnOrder.map((colId) => <SelectItem key={colId} value={colId}>{board.columns[colId]?.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Priority */}
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Priority</Label>
                <Select value={form.priority} onValueChange={(v) => onChange({ priority: v as TicketDetailsForm["priority"] })}>
                  <SelectTrigger className="h-8 text-xs w-full cursor-pointer"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TICKET_PRIORITY_OPTIONS.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Due date */}
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Due date</Label>
                <Input
                  type="date"
                  value={form.dueDate || form.scheduledFor}
                  onChange={(e) => onChange({ dueDate: e.target.value, scheduledFor: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>

              {/* Labels */}
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Labels</Label>
                <Input
                  value={form.tagsText}
                  onChange={(e) => onChange({ tagsText: e.target.value })}
                  placeholder="bug, ui..."
                  className="h-8 text-xs"
                />
              </div>

              {/* Execution mode */}
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Execution</Label>
                <Select value={form.executionMode} onValueChange={(v) => onChange({ executionMode: v as TicketDetailsForm["executionMode"] })}>
                  <SelectTrigger className="h-8 text-xs w-full cursor-pointer"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="direct">Direct</SelectItem>
                    <SelectItem value="planned">Planned</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Fallback model */}
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <ShieldCheckIcon className="size-3" />
                  Fallback Model
                </Label>
                <Select
                  value={form.fallbackModel || "__none__"}
                  onValueChange={(v) => onChange({ fallbackModel: v === "__none__" ? "" : v })}
                  disabled={isLocked}
                >
                  <SelectTrigger className="h-8 text-xs w-full cursor-pointer">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {models.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        <span className="font-medium">{m.alias}</span>
                        <span className="text-muted-foreground text-[10px] ml-1">({getProviderLabel(m.id)})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Execution state badge */}
              {isEditing && (
                <div className="flex flex-wrap gap-1">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[9px]",
                      form.executionState === "needs_retry" && "border-amber-500 text-amber-600 dark:text-amber-400",
                      form.executionState === "expired" && "border-gray-400 text-gray-500",
                      form.executionState === "failed" && "border-destructive text-destructive",
                    )}
                  >
                    {executionLabel(form.executionState)}
                  </Badge>
                  {form.executionMode === "planned" && (
                    <Badge variant="outline" className="text-[9px]">{form.planApproved ? "Approved" : "Pending"}</Badge>
                  )}
                </div>
              )}

              {/* Execution controls */}
              {(showStart || showRetry || showCancel || showApproval) && (
                <div className="flex flex-col gap-1.5">
                  {showStart && (
                    <Button size="sm" onClick={onStartExecution} className="h-7 text-[11px] gap-1 w-full cursor-pointer">
                      <PlayIcon className="size-3" /> Start
                    </Button>
                  )}
                  {showRetry && (
                    <Button size="sm" variant="outline" onClick={onRetryNow} className="h-7 text-[11px] gap-1 w-full cursor-pointer">
                      <RefreshCwIcon className="size-3" /> Retry
                    </Button>
                  )}
                  {showCancel && (
                    <Button size="sm" variant="outline" onClick={onCancelExecution} className="h-7 text-[11px] gap-1 w-full cursor-pointer">
                      <XIcon className="size-3" /> Cancel
                    </Button>
                  )}
                  {showApproval && (
                    <>
                      <Button size="sm" onClick={onApprovePlan} className="h-7 text-[11px] w-full cursor-pointer">Approve</Button>
                      <Button size="sm" variant="destructive" onClick={onRejectPlan} className="h-7 text-[11px] w-full cursor-pointer">Reject</Button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <DialogFooter className="px-6 py-3 border-t">
            <Button variant="ghost" onClick={onClose} className="cursor-pointer">Cancel</Button>
            <Button onClick={() => onSave(mode === "create" ? createFiles : undefined)} className="gap-1.5 cursor-pointer">
              <ClipboardListIcon className="size-3.5" />
              {isEditing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image preview */}
      <Dialog open={Boolean(previewAtt)} onOpenChange={(o) => { if (!o) setPreviewAtt(null); }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{previewAtt?.name}</DialogTitle>
            <DialogDescription>Image preview</DialogDescription>
          </DialogHeader>
          {previewAtt && (
            <img src={previewAtt.url} alt={previewAtt.name} className="max-h-[70vh] w-full object-contain rounded-md" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
