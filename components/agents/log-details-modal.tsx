"use client";

import { useMemo, useState } from "react";
import type { AgentLog } from "@/types/agents";
import { extractFirstValidJsonFromText } from "@/lib/agent-log-utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AgentLogChannelBadge,
  AgentLogDirectionBadge,
  AgentLogEventTypeBadge,
  AgentLogLevelBadge,
  AgentLogMemorySourceBadge,
  formatTimestamp,
} from "@/components/agents/agent-ui";

type LogDetailsModalProps = {
  log: AgentLog | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function formatJsonPayload(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable payload]";
  }
}

function shortRunId(value: string) {
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

function buildMemoryReference(log: AgentLog | null) {
  if (!log) return "";
  const source = (log.memorySource || "").trim();
  const key = (log.memoryKey || "").trim();
  const collection = (log.collection || "").trim();

  if (!source && !key && !collection) return "";

  const parts = [
    source ? `source=${source}` : "",
    collection ? `collection=${collection}` : "",
    key ? `key=${key}` : "",
  ].filter(Boolean);

  return parts.join(" | ");
}

export function LogDetailsModal({ log, open, onOpenChange }: LogDetailsModalProps) {
  const [copied, setCopied] = useState(false);
  const runId = typeof log?.runId === "string" ? log.runId.trim() : "";
  const parsedPayload = useMemo(() => {
    if (!log) return "";
    if (log.rawPayload != null) return log.rawPayload;
    return extractFirstValidJsonFromText(log.message) ?? log.message;
  }, [log]);
  const prettyPayload = useMemo(() => formatJsonPayload(parsedPayload), [parsedPayload]);
  const displayMessage = useMemo(() => {
    if (!log) return "";
    if (log.isJson && log.messagePreview) return log.messagePreview;
    return log.message;
  }, [log]);

  const eventId = typeof log?.eventId === "string" ? log.eventId.trim() : "";
  const correlationId = typeof log?.correlationId === "string" ? log.correlationId.trim() : "";
  const sessionKey = typeof log?.sessionKey === "string" ? log.sessionKey.trim() : "";
  const sourceMessageId = typeof log?.sourceMessageId === "string" ? log.sourceMessageId.trim() : "";
  const status = typeof log?.status === "string" ? log.status.trim() : "";
  const retryCount = typeof log?.retryCount === "number" ? log.retryCount : 0;
  const memoryReference = buildMemoryReference(log);

  const fullLogCopyText = useMemo(() => {
    if (!log) return "";

    return [
      `id: ${log.id}`,
      `agentId: ${log.agentId}`,
      `occurredAt: ${log.occurredAt}`,
      `level: ${log.level}`,
      `type: ${log.type}`,
      `eventType: ${log.eventType ?? ""}`,
      `direction: ${log.direction ?? ""}`,
      `channelType: ${log.channelType ?? ""}`,
      `runId: ${log.runId}`,
      `eventId: ${eventId}`,
      `correlationId: ${correlationId}`,
      `sessionKey: ${sessionKey}`,
      `sourceMessageId: ${sourceMessageId}`,
      `status: ${status}`,
      `retryCount: ${retryCount}`,
      `containsPii: ${log.containsPii ? "true" : "false"}`,
      `memorySource: ${log.memorySource ?? ""}`,
      `memoryKey: ${log.memoryKey ?? ""}`,
      `collection: ${log.collection ?? ""}`,
      `queryText: ${log.queryText ?? ""}`,
      `resultCount: ${typeof log.resultCount === "number" ? log.resultCount : ""}`,
      `memoryReference: ${memoryReference}`,
      "",
      "message:",
      displayMessage,
      "",
      "rawPayload:",
      prettyPayload,
      "",
      "fullText:",
      [displayMessage, prettyPayload].filter(Boolean).join("\n\n"),
    ].join("\n");
  }, [
    log,
    eventId,
    correlationId,
    sessionKey,
    sourceMessageId,
    status,
    retryCount,
    displayMessage,
    prettyPayload,
    memoryReference,
  ]);

  async function handleCopy() {
    if (!log) return;
    try {
      await navigator.clipboard.writeText(fullLogCopyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Log Details</DialogTitle>
          <DialogDescription>
            Full event payload with JSON-aware rendering and copy support.
          </DialogDescription>
        </DialogHeader>

        {log ? (
          <div className="max-h-[calc(85vh-9rem)] space-y-3 overflow-y-auto pr-1">
            <div className="flex flex-wrap items-center gap-2">
              {log.eventType ? <AgentLogEventTypeBadge eventType={log.eventType} /> : null}
              {log.direction ? <AgentLogDirectionBadge direction={log.direction} /> : null}
              {log.channelType ? <AgentLogChannelBadge channel={log.channelType} /> : null}
              {log.memorySource ? <AgentLogMemorySourceBadge memorySource={log.memorySource} /> : null}
              <AgentLogLevelBadge level={log.level} />
              {runId ? (
                <Badge variant="outline" className="font-mono text-xs">
                  run {shortRunId(runId)}
                </Badge>
              ) : null}
              <Badge variant="outline" className="text-xs">
                {formatTimestamp(log.occurredAt)}
              </Badge>
            </div>

            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Message</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{displayMessage}</p>
            </div>

            <div className="overflow-visible rounded-lg border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Trace Metadata</p>
              <dl className="mt-2 grid gap-2 overflow-visible text-xs sm:grid-cols-2">
                {eventId ? (
                  <div>
                    <dt className="text-muted-foreground">Event ID</dt>
                    <dd className="break-all whitespace-pre-wrap font-mono text-foreground">{eventId}</dd>
                  </div>
                ) : null}
                {correlationId ? (
                  <div>
                    <dt className="text-muted-foreground">Correlation ID</dt>
                    <dd className="break-all whitespace-pre-wrap font-mono text-foreground">{correlationId}</dd>
                  </div>
                ) : null}
                {sessionKey ? (
                  <div>
                    <dt className="text-muted-foreground">Session Key</dt>
                    <dd className="break-all whitespace-pre-wrap font-mono text-foreground">{sessionKey}</dd>
                  </div>
                ) : null}
                {sourceMessageId ? (
                  <div>
                    <dt className="text-muted-foreground">Source Message ID</dt>
                    <dd className="break-all whitespace-pre-wrap font-mono text-foreground">{sourceMessageId}</dd>
                  </div>
                ) : null}
                {status ? (
                  <div>
                    <dt className="text-muted-foreground">Status</dt>
                    <dd className="text-foreground">{status}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-muted-foreground">Retry Count</dt>
                  <dd className="text-foreground">{retryCount}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Contains PII</dt>
                  <dd className="text-foreground">{log.containsPii ? "Yes" : "No"}</dd>
                </div>
                {log.memoryKey ? (
                  <div>
                    <dt className="text-muted-foreground">Memory Key</dt>
                    <dd className="break-all whitespace-pre-wrap font-mono text-foreground">{log.memoryKey}</dd>
                  </div>
                ) : null}
                {log.collection ? (
                  <div>
                    <dt className="text-muted-foreground">Collection</dt>
                    <dd className="text-foreground">{log.collection}</dd>
                  </div>
                ) : null}
                {log.queryText ? (
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">Query</dt>
                    <dd className="whitespace-pre-wrap text-foreground">{log.queryText}</dd>
                  </div>
                ) : null}
                {typeof log.resultCount === "number" ? (
                  <div>
                    <dt className="text-muted-foreground">Result Count</dt>
                    <dd className="text-foreground">{log.resultCount}</dd>
                  </div>
                ) : null}
                {memoryReference ? (
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">Memory Reference</dt>
                    <dd className="break-all whitespace-pre-wrap font-mono text-foreground">{memoryReference}</dd>
                  </div>
                ) : null}
              </dl>
            </div>

            <div className="rounded-lg border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Raw Payload</p>
              <pre className="mt-1 max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs text-foreground">
                {prettyPayload}
              </pre>
            </div>

            <div className="rounded-lg border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Full Log Text</p>
              <textarea
                readOnly
                value={fullLogCopyText}
                className="mt-1 min-h-56 w-full resize-y rounded-md border bg-muted p-3 font-mono text-xs text-foreground"
              />
            </div>
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={handleCopy} disabled={!log}>
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
