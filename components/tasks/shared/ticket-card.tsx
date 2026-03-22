"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type Assignee, type Ticket, formatDue } from "@/types/tasks";
import { cn } from "@/lib/utils";

type Props = {
  ticket: Ticket;
  assigneeById: Record<string, Assignee>;
  onClick: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
  dense?: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  isDragging?: boolean;
};

const priorityStyles: Record<Ticket["priority"], string> = {
  low: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  high: "border-orange-500/30 bg-orange-500/10 text-orange-500",
  urgent: "border-destructive/30 bg-destructive/10 text-destructive",
};

const priorityDot: Record<Ticket["priority"], string> = {
  low: "bg-emerald-500",
  medium: "bg-amber-500",
  high: "bg-orange-500",
  urgent: "bg-destructive",
};

const priorityLabel = (priority: Ticket["priority"]) =>
  priority.charAt(0).toUpperCase() + priority.slice(1);

const executionStateStyles: Record<string, string> = {
  open: "border-slate-500/30 bg-slate-500/10 text-slate-400",
  planning: "border-blue-500/30 bg-blue-500/10 text-blue-500",
  awaiting_plan_approval: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  ready_to_execute: "border-cyan-500/30 bg-cyan-500/10 text-cyan-500",
  executing: "border-indigo-500/30 bg-indigo-500/10 text-indigo-500",
  done: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
};

const executionLabel = (value?: string) => {
  if (!value) return "Pending";
  return value.replaceAll("_", " ").replace(/^\w/, (char) => char.toUpperCase());
};

const approvalStateStyles: Record<string, string> = {
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  approved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  rejected: "border-destructive/30 bg-destructive/10 text-destructive",
  none: "border-slate-500/30 bg-slate-500/10 text-slate-400",
};

export function TicketCard({
  ticket,
  assigneeById,
  onClick,
  onCopy,
  onDelete,
  dense,
  dragHandleProps,
  isDragging,
}: Props) {
  const visibleAssignees = ticket.assigneeIds.slice(0, 3);
  const extra = ticket.assigneeIds.length - visibleAssignees.length;
  const shortDesc = ticket.description?.trim().replace(/\s+/g, " ") ?? "";
  const descPreview = shortDesc.length > 80 ? `${shortDesc.slice(0, 80)}…` : shortDesc;

  return (
    <Card
      className={cn(
        "group cursor-pointer select-none border-border bg-card py-0",
        "transition-[transform,box-shadow] duration-150",
        "hover:-translate-y-0.5 hover:shadow-md",
        isDragging && "opacity-50",
      )}
      onClick={onClick}
      {...dragHandleProps}
    >
      <CardContent className={cn("flex flex-col gap-2.5", dense ? "p-3" : "p-4")}>
        {/* Tags row + kebab */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-h-5 min-w-0 flex-wrap items-center gap-1">
            <Badge
              variant="outline"
              className={cn(
                "h-5 px-1.5 py-0 text-xs font-medium",
                executionStateStyles[ticket.executionState || "pending"] || executionStateStyles.pending,
              )}
            >
              {executionLabel(ticket.executionState)}
            </Badge>
            {ticket.priority ? (
              <Badge
                variant="outline"
                className={cn("h-5 px-1.5 py-0 text-[11px] font-medium", priorityStyles[ticket.priority])}
              >
                <span className={cn("mr-1 h-1.5 w-1.5 rounded-full", priorityDot[ticket.priority])} />
                {priorityLabel(ticket.priority)}
              </Badge>
            ) : null}
            {ticket.executionMode === "plan" ? (
              <Badge
                variant="outline"
                className={cn(
                  "h-5 px-1.5 py-0 text-[11px] font-medium",
                  approvalStateStyles[ticket.planApproved ? "approved" : "pending"] || approvalStateStyles.pending,
                )}
              >
                {ticket.planApproved ? "Plan approved" : "Plan pending"}
              </Badge>
            ) : null}
            {ticket.tags.length > 0
              ? ticket.tags.slice(0, 2).map((tag) => (
                  <Badge key={tag} variant="secondary" className="h-5 px-1.5 py-0 text-[11px] font-normal">
                    {tag}
                  </Badge>
                ))
              : null}
            {ticket.tags.length > 2 && (
              <span className="text-[11px] text-muted-foreground">+{ticket.tags.length - 2}</span>
            )}
          </div>
          <div
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="shrink-0"
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Ticket actions"
                >
                  <KebabIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onClick}>Open</DropdownMenuItem>
                {onCopy && (
                  <DropdownMenuItem onClick={onCopy}>Copy</DropdownMenuItem>
                )}
                {onDelete && (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={onDelete}
                  >
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Title */}
        <p className="text-sm font-semibold leading-snug line-clamp-2 text-foreground">
          {ticket.title}
        </p>

        {/* Description preview */}
        {descPreview && (
          <p className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
            {descPreview}
          </p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          {/* Assignee avatars */}
          <div className="flex items-center -space-x-1.5">
            {visibleAssignees.map((id) => {
              const a = assigneeById[id];
              if (!a) return null;
              return (
                <Avatar key={id} className="h-5 w-5 border border-background text-[10px]">
                  <AvatarFallback style={{ backgroundColor: a.color }} className="text-white text-[10px]">
                    {a.initials}
                  </AvatarFallback>
                </Avatar>
              );
            })}
            {extra > 0 && (
              <Avatar className="h-5 w-5 border border-background">
                <AvatarFallback className="text-[10px] bg-muted text-muted-foreground">
                  +{extra}
                </AvatarFallback>
              </Avatar>
            )}
          </div>

          {/* Meta */}
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {ticket.dueDate && (
              <span className="flex items-center gap-1">
                <CalendarIcon className="w-3 h-3" />
                {formatDue(ticket.dueDate)}
              </span>
            )}
            {ticket.checklistTotal > 0 && (
              <span className="flex items-center gap-1">
                <CheckIcon className="w-3 h-3" />
                {ticket.checklistDone}/{ticket.checklistTotal}
              </span>
            )}
            {ticket.comments > 0 && (
              <span className="flex items-center gap-1">
                <CommentIcon className="w-3 h-3" />
                {ticket.comments}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function KebabIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function CommentIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
