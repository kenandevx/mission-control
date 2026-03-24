import { readFileSync } from "node:fs";
import { getSql } from "@/lib/local-db";
import { collectRuntimeSnapshots } from "@/lib/runtime/collector";
import { mergeAgentWithRuntime } from "@/lib/runtime/merge";
import type { AgentHealthActivity, AgentLogPageInfo } from "@/types/agents";
import type { BoardHydration, BoardState, Column, Ticket, TicketPriority } from "@/types/tasks";

type BoardRow = { id: string; workspace_id: string; name: string; description: string | null };
type ColumnRow = { id: string; board_id: string; title: string; color_key: string | null; is_default: boolean | null; position: number | null };
type TicketRow = {
  id: string;
  workspace_id: string;
  board_id: string;
  column_id: string;
  title: string;
  description: string | null;
  priority: string | null;
  due_date: string | null;
  tags: string[] | null;
  assignee_ids: string[] | null;
  assigned_agent_id: string | null;
  auto_approve: boolean | null;
  execution_mode: string | null;
  plan_text: string | null;
  plan_approved: boolean | null;
  scheduled_for: string | null;
  execution_state: string | null;
  checklist_done: number | null;
  checklist_total: number | null;
  comments_count: number | null;
  attachments_count: number | null;
  position: number | null;
  created_at: string;
  updated_at: string;
};
type ActivityRow = { id: string; occurred_at: string; source: string; event: string; details: string; level: string };

type DashboardActivityLog = {
  id: string;
  occurredAt: string;
  source: "Agent" | "Tasks" | "System" | "API";
  event: string;
  details: string;
  level: "info" | "success" | "warning" | "error";
};

type ChartPoint = { date: string; created: number; completed: number; logs: number };

function emptyBoardState(): BoardState {
  return { columns: {}, columnOrder: [], tickets: {}, ticketIdsByColumn: {} } as BoardState;
}

export async function getSetupStatus(): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`select setup_completed from app_settings where id = 1 limit 1`;
  const row = rows[0] ?? { setup_completed: true };
  return Boolean(row.setup_completed ?? true);
}

function loadAgentIdentity(agentId: string) {
  const roots = [
    `/home/clawdbot/.openclaw/agents/${agentId}/IDENTITY.md`,
    `/home/clawdbot/.openclaw/workspace/agents/${agentId}/IDENTITY.md`,
    `/home/clawdbot/.openclaw/workspace/${agentId}/IDENTITY.md`,
  ];
  for (const path of roots) {
    try {
      const text = readFileSync(path, "utf8");
      const name = (text.match(/^#\s*(.+)$/m)?.[1] || text.match(/^Name:\s*(.+)$/im)?.[1] || agentId).trim();
      const emoji = (text.match(/^Emoji:\s*(.+)$/im)?.[1] || "").trim();
      return { name, emoji };
    } catch {}
  }
  return { name: agentId, emoji: "" };
}

export async function getSidebarUser() {
  return null;
}

export async function getWorkspaceAssignees() {
  const snapshots = (await collectRuntimeSnapshots().catch(() => ({}))) as any;
  return Object.values(snapshots)
    .filter((snapshot: any) => snapshot?.agentId)
    .map((snapshot: any) => ({
      id: snapshot.agentId,
      name: snapshot.identity?.name || snapshot.name || snapshot.agentId,
      initials:
        (snapshot.identity?.name || snapshot.name || snapshot.agentId)
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((part: string) => part[0]?.toUpperCase() || "")
          .join("") || snapshot.agentId.slice(0, 2).toUpperCase(),
      color: "#64748b",
      source: "runtime",
    }));
}

export async function getAgentsAndLogsData() {
  const runtimeSnapshots = (await collectRuntimeSnapshots().catch(() => ({}))) as any;
  const agents = Object.values(runtimeSnapshots)
    .filter((value: any) => value && value.agentId)
    .map((snapshot: any) => ({
      id: snapshot.agentId,
      name: snapshot.identity?.name || snapshot.name || snapshot.agentId,
      status: snapshot.status === "running" || snapshot.status === "degraded" ? snapshot.status : "idle",
      runtime: {
        model: snapshot.model ?? null,
        queueDepth: snapshot.queueDepth ?? null,
        activeRuns: snapshot.activeRuns ?? null,
        lastHeartbeatAt: snapshot.lastHeartbeatAt ?? null,
        uptimeMinutes: snapshot.uptimeMinutes ?? null,
      },
    }));

  const logs: any[] = [];
  const mergedAgents = agents.map((agent) => mergeAgentWithRuntime(agent, runtimeSnapshots as any));
  return {
    agents: mergedAgents,
    logs,
    pageInfo: {
      limit: 200,
      page: 1,
      shownCount: 0,
      totalCount: 0,
      pageCount: 1,
    } satisfies AgentLogPageInfo,
    logTotals: { total: 0, info: 0, warning: 0, error: 0 },
  };
}

export async function getAgentDetailsData() {
  const data = await getAgentsAndLogsData();
  return {
    agent: data.agents[0] ?? null,
    logs: data.logs,
    pageInfo: data.pageInfo,
    healthActivity: {
      lastActivityAt: null,
      responses1h: 0,
      errors1h: 0,
    } satisfies AgentHealthActivity,
    queueSummary: { assigned: 0, queued: 0, running: 0, blockedBySchedule: 0, blockedByApproval: 0, nextUp: [] },
  };
}

function toTone(colorKey: string | null): Column["tone"] {
  if (colorKey === "success" || colorKey === "emerald") return "success";
  if (colorKey === "warning" || colorKey === "amber") return "warning";
  if (colorKey === "info" || colorKey === "blue") return "info";
  return "neutral";
}

export async function getBoardsPageData(): Promise<BoardHydration[]> {
  const sql = getSql();
  const workspace = await sql`select id from workspaces order by created_at asc limit 1`;
  const wid = workspace[0]?.id ?? null;

  const boards = wid
    ? await sql<BoardRow[]>`select id, workspace_id, name, description from boards where workspace_id = ${wid} order by created_at asc`
    : [];
  const columns = wid
    ? await sql<ColumnRow[]>`select id, board_id, title, color_key, is_default, position from columns order by position asc, created_at asc`
    : [];
  const tickets = wid
    ? await sql<TicketRow[]>`select * from tickets where workspace_id = ${wid} order by position asc, created_at asc`
    : [];

  return boards.map((board) => {
    const boardColumns = columns.filter((column) => column.board_id === board.id);
    const boardTickets = tickets.filter((ticket) => ticket.board_id === board.id);

    const state: BoardState = emptyBoardState();

    for (const column of boardColumns) {
      state.columns[column.id] = {
        id: column.id,
        title: column.title,
        tone: toTone(column.color_key),
        isDefault: Boolean(column.is_default),
      } as Column;
      state.columnOrder.push(column.id);
      state.ticketIdsByColumn[column.id] = [];
    }

    for (const ticket of boardTickets) {
      const record = {
        id: ticket.id,
        title: ticket.title,
        description: ticket.description ?? "",
        statusId: ticket.column_id,
        priority: (ticket.priority ?? "medium") as TicketPriority,
        dueDate: ticket.due_date,
        tags: ticket.tags ?? [],
        assigneeIds: ticket.assignee_ids ?? [],
        assignedAgentId: ticket.assigned_agent_id ?? "",
        executionMode: (ticket.execution_mode as Ticket["executionMode"]) ?? "direct",
        planText: ticket.plan_text ?? "",
        planApproved: Boolean(ticket.plan_approved),
        scheduledFor: ticket.scheduled_for ? ticket.scheduled_for.slice(0, 10) : null,
        executionState: (ticket.execution_state as Ticket["executionState"]) ?? "open",
        checklistDone: ticket.checklist_done ?? 0,
        checklistTotal: ticket.checklist_total ?? 0,
        comments: ticket.comments_count ?? 0,
        attachments: ticket.attachments_count ?? 0,
        createdAt: Date.parse(ticket.created_at) || 0,
      } satisfies Ticket;

      state.tickets[ticket.id] = record;
      state.ticketIdsByColumn[ticket.column_id] = state.ticketIdsByColumn[ticket.column_id] || [];
      state.ticketIdsByColumn[ticket.column_id].push(ticket.id);
    }

    return {
      id: board.id,
      name: board.name,
      description: board.description ?? "",
      data: state,
    } as BoardHydration;
  });
}

export async function getDashboardData() {
  const boards = await getBoardsPageData();
  const first = boards[0] ?? null;
  const board = first?.data ?? emptyBoardState();
  const tickets = Object.values(board.tickets) as Ticket[];
  const activityLogs = (await getActivityLogs()).slice(0, 50);
  const chartData: ChartPoint[] = await getChartData();
  return { boardId: first?.id ?? null, board, tickets, activityLogs, chartData, logs24h: 0 };
}

async function getActivityLogs(): Promise<DashboardActivityLog[]> {
  const sql = getSql();
  const workspace = await sql`select id from workspaces order by created_at asc limit 1`;
  const workspaceId = workspace[0]?.id ?? null;
  const rows = workspaceId
    ? await sql<ActivityRow[]>`select id, occurred_at, source, event, details, level from activity_logs where workspace_id = ${workspaceId} order by occurred_at desc limit 50`
    : [];
  return rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    source: row.source as DashboardActivityLog["source"],
    event: row.event,
    details: row.details,
    level: row.level as DashboardActivityLog["level"],
  }));
}

async function getChartData(): Promise<ChartPoint[]> {
  return [];
}
