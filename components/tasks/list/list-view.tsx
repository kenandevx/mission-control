"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type Assignee, type BoardState, type Ticket, formatDue, toneColor } from "@/types/tasks";
import { cn } from "@/lib/utils";
import { Empty, EmptyDescription, EmptyFooter, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

type Props = {
  tickets: Ticket[];
  board: BoardState;
  assigneeById: Record<string, Assignee>;
  onTicketClick: (ticketId: string) => void;
  onTicketCopy: (ticketId: string) => void;
  onTicketDelete: (ticketId: string) => void;
  searchQuery: string;
  onClearSearch: () => void;
};

export function ListView({
  tickets,
  board,
  assigneeById,
  onTicketClick,
  onTicketCopy,
  onTicketDelete,
  searchQuery,
  onClearSearch,
}: Props) {
  if (tickets.length === 0) {
    return (
      <Card className="p-6">
        <Empty className="min-h-52">
          <EmptyHeader>
            <EmptyTitle>No tickets found</EmptyTitle>
            <EmptyDescription>No tickets match your search.</EmptyDescription>
          </EmptyHeader>
          {searchQuery && (
            <EmptyFooter>
              <Button variant="ghost" size="sm" onClick={onClearSearch}>
                Clear search
              </Button>
            </EmptyFooter>
          )}
        </Empty>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[40%]">Title</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Due</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead>Assignees</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {tickets.map((ticket) => {
            const column = board.columns[ticket.statusId];
            return (
              <TableRow
                key={ticket.id}
                className="cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => onTicketClick(ticket.id)}
              >
                <TableCell>
                  <span className="text-sm font-medium line-clamp-1">{ticket.title}</span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    {column && (
                      <span className={cn("h-2 w-2 rounded-full shrink-0", toneColor[column.tone])} />
                    )}
                    <span className="text-sm text-muted-foreground">{column?.title ?? "—"}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">
                    {formatDue(ticket.dueDate)}
                  </span>
                </TableCell>
                <TableCell>
                  {ticket.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {ticket.tags.slice(0, 2).map((tag) => (
                        <Badge key={tag} variant="secondary" className="h-5 px-1.5 text-xs font-normal">
                          {tag}
                        </Badge>
                      ))}
                      {ticket.tags.length > 2 && (
                        <Badge variant="outline" className="h-5 px-1.5 text-xs font-normal">
                          +{ticket.tags.length - 2}
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center -space-x-1.5">
                    {ticket.assigneeIds.slice(0, 3).map((id) => {
                      const a = assigneeById[id];
                      if (!a) return null;
                      return (
                        <Avatar key={id} className="h-5 w-5 border border-background">
                          <AvatarFallback style={{ backgroundColor: a.color }} className="text-white text-[10px]">
                            {a.initials}
                          </AvatarFallback>
                        </Avatar>
                      );
                    })}
                  </div>
                </TableCell>
                <TableCell>
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="flex justify-end"
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <KebabIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onTicketClick(ticket.id)}>Open</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onTicketCopy(ticket.id)}>Copy</DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => onTicketDelete(ticket.id)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
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
