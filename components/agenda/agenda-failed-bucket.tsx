"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  IconRefresh,
  IconAlertTriangle,
  IconClock,
  IconFileText,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { statusHex } from "@/lib/status-colors";

type FailedOccurrence = {
  id: string;
  agenda_event_id: string;
  scheduled_for: string;
  status: "failed" | "needs_retry";
  latest_attempt_no: number;
  event_title: string;
  default_agent_id: string | null;
  last_error: string | null;
};

function StatusBadge({ status }: { status: string }): React.ReactElement {
  const map: Record<string, { label: string; color?: string }> = {
    failed: { label: "Failed", color: statusHex("failed") },
    needs_retry: { label: "Needs Retry", color: statusHex("needs_retry") },
  };
  const cfg = map[status] ?? { label: status };
  return (
    <Badge
      variant="outline"
      style={cfg.color ? { backgroundColor: `${cfg.color}1A`, color: cfg.color, borderColor: `${cfg.color}33` } : undefined}
    >
      {cfg.label}
    </Badge>
  );
}

function formatScheduledFor(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AgendaFailedDialog({ open, onOpenChange }: Props): React.ReactElement {
  const mountedRef = useRef(false);
  const [items, setItems] = useState<FailedOccurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  const fetchFailed = useCallback(async () => {
    try {
      const res = await fetch("/api/agenda/failed", { cache: "reload" });
      const json = await res.json();
      if (json.ok) {
        setItems(json.occurrences ?? []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (mountedRef.current) return;
    mountedRef.current = true;

    setLoading(true);
    void fetchFailed();
    const interval = setInterval(fetchFailed, 30_000);

    return () => {
      clearInterval(interval);
      mountedRef.current = false;
    };
  }, [open, fetchFailed]);

  // Re-fetch when dialog opens
  useEffect(() => {
    if (open) {
      setLoading(true);
      void fetchFailed();
    }
  }, [open, fetchFailed]);

  const handleRetry = useCallback(async (occ: FailedOccurrence) => {
    setRetrying((prev) => new Set(prev).add(occ.id));
    try {
      const res = await fetch(
        `/api/agenda/events/${occ.agenda_event_id}/occurrences/${occ.id}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
      );
      const json = await res.json();
      if (json.ok) {
        toast.success(`Retrying "${occ.event_title}" now`);
        setItems((prev) => prev.filter((i) => i.id !== occ.id));
        document.dispatchEvent(new CustomEvent("agenda-refresh"));
      } else {
        toast.error(json.error ?? "Retry failed");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setRetrying((prev) => { const next = new Set(prev); next.delete(occ.id); return next; });
    }
  }, []);

  const handleDelete = useCallback(async (occ: FailedOccurrence) => {
    setDeleting((prev) => new Set(prev).add(occ.id));
    try {
      // Delete the occurrence by setting it to cancelled
      const res = await fetch(
        `/api/agenda/events/${occ.agenda_event_id}/occurrences/${occ.id}`,
        { method: "DELETE" }
      );
      const json = await res.json();
      if (json.ok) {
        toast.success(`Removed "${occ.event_title}" from failed list`);
        setItems((prev) => prev.filter((i) => i.id !== occ.id));
      } else {
        // Fallback: just hide from UI
        setItems((prev) => prev.filter((i) => i.id !== occ.id));
        toast.success("Removed from list");
      }
    } catch {
      // Still remove from UI
      setItems((prev) => prev.filter((i) => i.id !== occ.id));
    } finally {
      setDeleting((prev) => { const next = new Set(prev); next.delete(occ.id); return next; });
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconAlertTriangle className="size-5 text-amber-500" />
            Failed Events
            {items.length > 0 && (
              <Badge variant="destructive" className="ml-1 text-xs">
                {items.length}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Events that failed or were missed. Retry to run now, view logs to see why, or delete to dismiss.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 max-h-[60vh] pr-2">
          {loading ? (
            <div className="flex flex-col gap-3 p-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <span className="text-3xl mb-3">✅</span>
              <p className="text-sm text-muted-foreground">All clear — no failed events</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 p-1">
              {[...items].sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime()).map((occ) => (
                <div
                  key={occ.id}
                  className="rounded-xl border bg-card shadow-sm overflow-hidden"
                >
                  {/* Header: title + badge + meta */}
                  <div className="flex flex-col gap-2 p-4 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold truncate">{occ.event_title}</span>
                      <StatusBadge status={occ.status} />
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <IconClock className="size-3" />
                        {formatScheduledFor(occ.scheduled_for)}
                      </span>
                      {occ.default_agent_id && (
                        <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">
                          {occ.default_agent_id}
                        </span>
                      )}
                      <span className="text-[10px]">
                        Attempt #{occ.latest_attempt_no}
                      </span>
                    </div>
                  </div>
                  {/* Actions row */}
                  <div className="flex items-center gap-1.5 px-4 pb-3">
                    <Button
                      size="sm"
                      className="gap-1.5 h-8 text-xs font-semibold cursor-pointer"
                      disabled={retrying.has(occ.id)}
                      onClick={() => handleRetry(occ)}
                    >
                      <IconRefresh className="size-3" />
                      Retry Now
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 h-8 text-xs cursor-pointer"
                      onClick={() => setExpandedLog(expandedLog === occ.id ? null : occ.id)}
                    >
                      <IconFileText className="size-3" />
                      Logs
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive cursor-pointer"
                      disabled={deleting.has(occ.id)}
                      onClick={() => handleDelete(occ)}
                      title="Dismiss"
                    >
                      <IconTrash className="size-3.5" />
                    </Button>
                  </div>

                  {/* Expanded log section */}
                  {expandedLog === occ.id && (
                    <div className="border-t bg-muted/20 p-4">
                      <p className="text-xs font-semibold text-muted-foreground mb-2">Error Details</p>
                      {occ.last_error ? (
                        <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-muted/40 rounded-lg p-3 text-red-600 dark:text-red-400 max-h-[200px] overflow-y-auto">
                          {occ.last_error}
                        </pre>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">No error details recorded</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
