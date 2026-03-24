"use client";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyFooter, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { type Assignee, type Ticket } from "@/types/tasks";
import { TicketCard } from "../shared/ticket-card";

type Props = {
  tickets: Ticket[];
  assigneeById: Record<string, Assignee>;
  searchQuery: string;
  onTicketClick: (ticketId: string) => void;
  onTicketCopy: (ticketId: string) => void;
  onTicketDelete: (ticketId: string) => void;
  onClearSearch: () => void;
};

export function GridView({
  tickets,
  assigneeById,
  searchQuery,
  onTicketClick,
  onTicketCopy,
  onTicketDelete,
  onClearSearch,
}: Props) {
  if (tickets.length === 0) {
    return (
      <Empty className="min-h-56">
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
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {tickets.map((ticket) => (
        <TicketCard
          key={ticket.id}
          ticket={ticket}
          assigneeById={assigneeById}
          onClick={() => onTicketClick(ticket.id)}
          onCopy={() => onTicketCopy(ticket.id)}
          onDelete={() => onTicketDelete(ticket.id)}
        />
      ))}
    </div>
  );
}
