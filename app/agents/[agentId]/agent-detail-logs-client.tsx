"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { LogsExplorer } from "@/components/agents/logs-explorer";
import { Badge } from "@/components/ui/badge";
import type { AgentLog } from "@/types/agents";

type PageInfo = {
  page: number;
  limit: number;
  totalCount: number;
  pageCount: number;
};

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
  // snake_case from API
  runtime_agent_id?: string;
  agent_id?: string;
};

type Props = {
  agentId: string;
  initialLogs: AgentLog[];
  initialPageInfo: PageInfo;
  initialNowIso: string;
};

export function AgentDetailLogsClient({ agentId, initialLogs, initialPageInfo, initialNowIso }: Props): React.ReactElement {
  const [logs, setLogs] = useState<AgentLog[]>(initialLogs);
  const [pageInfo, setPageInfo] = useState<PageInfo>(initialPageInfo);
  const [liveState, setLiveState] = useState<"connecting" | "connected" | "offline">("connecting");
  const mountedRef = useRef(false);

  const isFirstPage = pageInfo.page === 1;

  // SSE live stream — filter for this agent only
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    const eventSource = new EventSource("/api/agent/logs/stream");

    eventSource.addEventListener("ready", () => setLiveState("connected"));
    eventSource.addEventListener("heartbeat", () => setLiveState("connected"));
    eventSource.addEventListener("log_row", (event) => {
      setLiveState("connected");
      if (!isFirstPage) return;
      try {
        const parsed = JSON.parse((event as MessageEvent).data || "{}");
        const row: LogRow | undefined = parsed?.row;
        if (!row) return;

        // Filter: only show logs for this agent
        const rowAgentId = row.runtime_agent_id || row.agentId || row.agent_id || "";
        if (rowAgentId !== agentId) return;

        const totalCount = parsed?.totalCount as number | undefined;

        setLogs((prev) => {
          const exists = prev.some((x) => x.id === row.id);
          if (exists) return prev;
          const next = [row as unknown as AgentLog, ...prev];
          return next.slice(0, pageInfo.limit);
        });
        setPageInfo((prev) => {
          const newTotal = totalCount && totalCount > 0 ? totalCount : prev.totalCount + 1;
          return {
            ...prev,
            totalCount: newTotal,
            pageCount: Math.max(1, Math.ceil(newTotal / prev.limit)),
          };
        });
      } catch {
        // ignore malformed stream row
      }
    });
    eventSource.onerror = () => setLiveState("offline");

    return () => {
      eventSource.close();
      mountedRef.current = false;
    };
  }, [agentId, isFirstPage, pageInfo.limit]);

  const onPageChange = useCallback(async (next: number) => {
    const target = Math.max(1, next);
    try {
      const res = await fetch(
        `/api/agent/logs?limit=${pageInfo.limit}&page=${target}&agentId=${encodeURIComponent(agentId)}`,
        { cache: "no-cache" },
      );
      const json = await res.json();
      setLogs(Array.isArray(json?.logs) ? json.logs : []);
      setPageInfo((prev) => ({ ...prev, ...(json?.pageInfo || {}), page: target }));
    } catch (err) {
      console.error("Failed to load agent logs", err);
    }
  }, [agentId, pageInfo.limit]);

  const liveBadge = useMemo(() => {
    const variant = liveState === "connected" ? "default" : liveState === "connecting" ? "secondary" : "destructive";
    const label = liveState === "connected" ? "Live: Connected" : liveState === "connecting" ? "Live: Connecting" : "Live: Offline";
    return <Badge variant={variant}>{label}</Badge>;
  }, [liveState]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Agent Logs</h3>
        {liveBadge}
      </div>
      <LogsExplorer
        logs={logs}
        agents={[]}
        page={pageInfo.page}
        pageCount={pageInfo.pageCount}
        totalCount={pageInfo.totalCount}
        initialNowIso={initialNowIso}
        onPageChange={onPageChange}
      />
    </div>
  );
}
