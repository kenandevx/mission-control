"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { ClearLogsButton } from "@/components/agents/clear-logs-button";
import { LogsExplorer } from "@/components/agents/logs-explorer";
import { LogsLiveRefresh } from "@/components/agents/logs-live-refresh";
import { ServiceManager } from "@/components/agents/service-manager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollTextIcon, ServerIcon, CalendarClockIcon } from "lucide-react";
import type { Agent, AgentLog } from "@/types/agents";

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
  const [activeTab, setActiveTab] = useState("logs");
  const [agendaLogs, setAgendaLogs] = useState<AgentLog[]>([]);
  const [agendaPageInfo, setAgendaPageInfo] = useState<PageInfo>({ page: 1, limit: 50, totalCount: 0, pageCount: 1 });
  const [agendaLoading, setAgendaLoading] = useState(false);

  const isFirstPage = pageInfo.page === 1;

  const loadAgendaLogs = useCallback(async (p = 1) => {
    setAgendaLoading(true);
    try {
      const res = await fetch(`/api/agenda/logs?limit=${agendaPageInfo.limit}&page=${p}`, { cache: "reload" });
      const json = await res.json();
      if (json.ok) {
        setAgendaLogs(json.logs ?? []);
        setAgendaPageInfo((prev) => ({
          ...prev,
          page: p,
          totalCount: json.total ?? 0,
          pageCount: Math.max(1, Math.ceil((json.total ?? 0) / prev.limit)),
        }));
      }
    } catch { /* ignore */ } finally {
      setAgendaLoading(false);
    }
  }, [agendaPageInfo.limit]);

  // Fetch agenda logs when agenda tab is active
  useEffect(() => {
    if (activeTab === "agenda") void loadAgendaLogs(1);
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const onAgendaPageChange = async (next: number) => {
    await loadAgendaLogs(Math.max(1, next));
  };

  const handleLiveRow = useCallback((row: LogRow, totalCount: number) => {
    setLogs((prev) => {
      const exists = prev.some((x) => x.id === row.id);
      if (exists) return prev;
      const next = [row as unknown as AgentLog, ...prev];
      return next.slice(0, pageInfo.limit);
    });
    setPageInfo((prev) => ({
      ...prev,
      totalCount: totalCount > 0 ? totalCount : prev.totalCount + 1,
      pageCount: Math.max(1, Math.ceil((totalCount > 0 ? totalCount : prev.totalCount + 1) / prev.limit)),
    }));
  }, [pageInfo.limit]);

  const onPageChange = async (next: number) => {
    const target = Math.max(1, next);
    const res = await fetch(`/api/agent/logs?limit=${pageInfo.limit}&page=${target}`, { cache: "reload" });
    const json = await res.json();
    setLogs(Array.isArray(json?.logs) ? json.logs : []);
    setPageInfo((prev) => ({ ...prev, ...(json?.pageInfo || {}), page: target }));
  };

  const titleActions = useMemo(
    () => (
      <div className="flex w-full items-center justify-between gap-2">
        <LogsLiveRefresh isFirstPage={isFirstPage} onLiveRow={handleLiveRow} />
        <div className="flex items-center gap-2">
          <ClearLogsButton />
        </div>
      </div>
    ),
    [isFirstPage, handleLiveRow],
  );

  return (
    <>
      <PageHeader page="System" actions={titleActions} />
      <div className="flex flex-1 flex-col gap-4 px-3 py-4 sm:px-4 lg:gap-6 lg:px-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-10">
            <TabsTrigger value="logs" className="gap-1.5 cursor-pointer">
              <ScrollTextIcon className="size-3.5" />
              Runtime Logs
            </TabsTrigger>
            <TabsTrigger value="agenda" className="gap-1.5 cursor-pointer">
              <CalendarClockIcon className="size-3.5" />
              Agenda Logs
            </TabsTrigger>
            <TabsTrigger value="services" className="gap-1.5 cursor-pointer">
              <ServerIcon className="size-3.5" />
              Services
            </TabsTrigger>
          </TabsList>

          <TabsContent value="logs" className="mt-4">
            <LogsExplorer
              agents={agents}
              logs={logs}
              page={pageInfo.page}
              pageCount={pageInfo.pageCount}
              totalCount={pageInfo.totalCount}
              initialNowIso={initialNowIso}
              onPageChange={onPageChange}
            />
          </TabsContent>

          <TabsContent value="agenda" className="mt-4">
            {agendaLoading && agendaLogs.length === 0 ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground px-2">
                <CalendarClockIcon className="size-4 animate-pulse" />
                Loading agenda logs…
              </div>
            ) : (
              <LogsExplorer
                agents={agents}
                logs={agendaLogs as AgentLog[]}
                page={agendaPageInfo.page}
                pageCount={agendaPageInfo.pageCount}
                totalCount={agendaPageInfo.totalCount}
                initialNowIso={initialNowIso}
                onPageChange={onAgendaPageChange}
                initialFilterGroup="agenda"
              />
            )}
          </TabsContent>

          <TabsContent value="services" className="mt-4">
            <ServiceManager />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
