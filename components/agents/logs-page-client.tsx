"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { ClearLogsButton } from "@/components/agents/clear-logs-button";
import { LogsExplorer } from "@/components/agents/logs-explorer";
import { LogsLiveRefresh } from "@/components/agents/logs-live-refresh";
import type { Agent, AgentLog } from "@/types/agents";

type PageInfo = {
  page: number;
  limit: number;
  totalCount: number;
  pageCount: number;
};

type Props = {
  initialLogs: AgentLog[];
  initialAgents: Agent[];
  initialPageInfo: PageInfo;
  initialNowIso: string;
};

export function LogsPageClient({ initialLogs, initialAgents, initialPageInfo, initialNowIso }: Props) {
  const [agents] = useState<Agent[]>(initialAgents);
  const [logs, setLogs] = useState<AgentLog[]>(initialLogs);
  const [pageInfo, setPageInfo] = useState<PageInfo>(initialPageInfo);

  const isFirstPage = pageInfo.page === 1;

  useEffect(() => {
    const es = new EventSource("/api/agent/logs/stream");
    es.addEventListener("log_row", (event) => {
      if (!isFirstPage) return;
      try {
        const parsed = JSON.parse((event as MessageEvent).data || "{}");
        const row = parsed?.row;
        if (!row) return;
        setLogs((prev) => {
          const exists = prev.some((x: unknown) => (x as { id?: string })?.id === row.id);
          if (exists) return prev;
          const next = [row, ...prev];
          return next.slice(0, pageInfo.limit);
        });
        setPageInfo((prev) => ({ ...prev, totalCount: prev.totalCount + 1, pageCount: Math.max(1, Math.ceil((prev.totalCount + 1) / prev.limit)) }));
      } catch {
        // ignore malformed stream row
      }
    });
    return () => es.close();
  }, [isFirstPage, pageInfo.limit]);

  const onPageChange = async (next: number) => {
    const target = Math.max(1, next);
    const res = await fetch(`/api/agent/logs?limit=${pageInfo.limit}&page=${target}`, { cache: "no-store" });
    const json = await res.json();
    setLogs(Array.isArray(json?.logs) ? json.logs : []);
    setPageInfo((prev) => ({ ...prev, ...(json?.pageInfo || {}), page: target }));
  };

  const titleActions = useMemo(
    () => (
      <div className="flex w-full items-center justify-between gap-2">
        <LogsLiveRefresh />
        <div className="flex items-center gap-2">
          <ClearLogsButton />
        </div>
      </div>
    ),
    [],
  );

  return (
    <>
      <PageHeader page="Logs" actions={titleActions} />
      <div className="flex flex-1 flex-col gap-4 px-3 py-4 sm:px-4 lg:gap-6 lg:px-6">
        <LogsExplorer
          agents={agents}
          logs={logs}
          page={pageInfo.page}
          pageCount={pageInfo.pageCount}
          totalCount={pageInfo.totalCount}
          initialNowIso={initialNowIso}
          onPageChange={onPageChange}
        />
      </div>
    </>
  );
}
