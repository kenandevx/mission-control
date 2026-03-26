"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";

type LiveState = "connecting" | "connected" | "offline";

type LogRow = {
  id: string;
  agentId: string;
  occurredAt: string;
  level: string;
  type: string;
  eventType?: string;
  channelType?: string;
  direction?: string;
  message?: string;
  messagePreview?: string;
  runId?: string;
  sessionKey?: string;
  sourceMessageId?: string;
  memorySource?: string;
  rawPayload?: unknown;
};

type LogsLiveRefreshProps = {
  isFirstPage: boolean;
  pageLimit: number;
  onLiveRow: (row: LogRow, totalCount: number) => void;
};

export function LogsLiveRefresh({ isFirstPage, pageLimit, onLiveRow }: LogsLiveRefreshProps) {
  const [state, setState] = useState<LiveState>("connecting");
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    const eventSource = new EventSource("/api/agent/logs/stream");

    eventSource.addEventListener("ready", () => setState("connected"));
    eventSource.addEventListener("log_row", (event) => {
      setState("connected");
      if (!isFirstPage) return;
      try {
        const parsed = JSON.parse((event as MessageEvent).data || "{}");
        const row: LogRow | undefined = parsed?.row;
        if (!row) return;
        const totalCount = parsed?.totalCount as number | undefined;
        onLiveRow(row, totalCount ?? 0);
      } catch {
        // ignore malformed stream row
      }
    });
    eventSource.addEventListener("heartbeat", () => setState("connected"));
    eventSource.onerror = () => setState("offline");

    return () => {
      eventSource.close();
      mountedRef.current = false;
    };
  }, [isFirstPage, onLiveRow]);

  const variant = useMemo(() => {
    if (state === "connected") return "default";
    if (state === "connecting") return "secondary";
    return "destructive";
  }, [state]);

  const label =
    state === "connected"
      ? "Live: Bridge Connected"
      : state === "connecting"
        ? "Live: Connecting"
        : "Live: Offline";

  return <Badge variant={variant}>{label}</Badge>;
}
