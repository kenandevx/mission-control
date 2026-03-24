"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type ClearLogsButtonProps = {
  agentId?: string;
};

export function ClearLogsButton({ agentId }: ClearLogsButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const title = agentId ? "Clear Agent Logs" : "Clear All Logs";
  const description = agentId
    ? "This removes all stored log events for the current agent from the database."
    : "This removes all stored agent log events for the current workspace from the database.";

  async function clearLogs() {
    setSubmitting(true);
    try {
      const response = await fetch("/api/agent/logs", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(agentId ? { agentId } : {}),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to clear logs.");
      }
      toast.success(agentId ? "Agent logs cleared" : "Workspace logs cleared");
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to clear logs.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Trash2Icon className="h-4 w-4" />
          {agentId ? "Empty agent logs" : "Empty logs"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void clearLogs()} disabled={submitting}>
            {submitting ? "Clearing..." : "Delete logs"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
