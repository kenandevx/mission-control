"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePendingApprovalsCount } from "./use-pending-approvals-count";

export function ApprovalsList() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { refresh: refreshCount } = usePendingApprovalsCount();

  const fetchTickets = async () => {
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "listPendingApprovals" }),
      });
      const data = await res.json();
      setTickets(data.tickets || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    fetchTickets();
    return () => { startedRef.current = false; };
  }, []);

  const approve = async (ticketId: string) => {
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approvePlan", ticketId, actorId: "operator" }),
    });
    await fetchTickets();
    refreshCount();
  };

  const reject = async (ticketId: string) => {
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "rejectPlan", ticketId }),
    });
    await fetchTickets();
    refreshCount();
  };

  if (loading) return <div className="p-4">Loading pending approvals...</div>;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead className="max-w-md">Plan</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Agent</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tickets.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="text-center text-muted-foreground">
              No pending approvals.
            </TableCell>
          </TableRow>
        ) : (
          tickets.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-medium">{t.title}</TableCell>
              <TableCell className="max-w-md truncate" title={t.plan_text}>
                {t.plan_text}
              </TableCell>
              <TableCell>{t.priority}</TableCell>
              <TableCell>{t.status_id}</TableCell>
              <TableCell>{t.assigned_agent_id}</TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant="outline" onClick={() => approve(t.id)}>
                  Approve
                </Button>
                <Button size="sm" variant="destructive" onClick={() => reject(t.id)}>
                  Reject
                </Button>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
