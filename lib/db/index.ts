import type {
  AdapterSession,
  AdapterUser,
  BoardRecord,
  ColumnRecord,
  CreateBoardPayload,
  CreateColumnPayload,
  CreateTicketActivityPayload,
  CreateTicketPayload,
  CreateTicketSubtaskPayload,
  MoveTicketPayload,
  TaskDataAdapter,
  TicketActivityRecord,
  TicketAttachmentRecord,
  TicketCommentRecord,
  TicketRecord,
  TicketSubtaskRecord,
  UpdateBoardPatch,
  UpdateColumnPatch,
  UpdateTicketPatch,
  UpdateTicketSubtaskPatch,
} from "@/lib/db/adapter";

async function post(action: string, payload: Record<string, unknown> = {}) {
  const res = await fetch("/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || "Request failed.");
  return data;
}

const noopUser: AdapterUser = {
  id: "local-user",
  email: "",
  name: "Operator",
  avatarUrl: "",
};

const adapter: TaskDataAdapter = {
  async signUp() {
    return noopUser;
  },
  async signIn() {
    return noopUser;
  },
  async signOut() {},
  async getSession(): Promise<AdapterSession> {
    return { accessToken: "", user: noopUser };
  },
  async getUser() {
    return noopUser;
  },

  async listBoards() {
    const res = await fetch("/api/tasks", { cache: "reload" });
    const data = await res.json();
    const boards = Array.isArray(data.boards) ? data.boards : [];
    return boards.map((row: any) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      description: row.description ?? "",
      createdAt: row.created_at,
    })) as BoardRecord[];
  },

  async getBoard(boardId: string) {
    const boards = await this.listBoards();
    return boards.find((b) => b.id === boardId) ?? null;
  },

  async createBoard(payload: CreateBoardPayload) {
    const data = await post("createBoard", payload);
    const row = data.board;
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      description: row.description ?? "",
      createdAt: row.created_at,
    } as BoardRecord;
  },

  async updateBoard(boardId: string, patch: UpdateBoardPatch) {
    const data = await post("updateBoard", { boardId, ...patch });
    const row = data.board;
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      description: row.description ?? "",
      createdAt: row.created_at,
    } as BoardRecord;
  },

  async deleteBoard(boardId: string) {
    await post("deleteBoard", { boardId });
  },

  async listColumns(boardId: string) {
    const res = await fetch("/api/tasks", { cache: "reload" });
    const data = await res.json();
    const rows = (Array.isArray(data.columns) ? data.columns : []).filter((row: any) => row.board_id === boardId);
    return rows.map((row: any) => ({
      id: row.id,
      boardId: row.board_id,
      title: row.title,
      colorKey: row.color_key,
      isDefault: Boolean(row.is_default),
      position: row.position,
      createdAt: row.created_at,
    })) as ColumnRecord[];
  },

  async createColumn(boardId: string, payload: CreateColumnPayload) {
    const data = await post("createColumn", { boardId, ...payload });
    const row = data.column;
    return {
      id: row.id,
      boardId: row.board_id,
      title: row.title,
      colorKey: row.color_key,
      isDefault: Boolean(row.is_default),
      position: row.position,
      createdAt: row.created_at,
    } as ColumnRecord;
  },

  async updateColumn(columnId: string, patch: UpdateColumnPatch) {
    await post("updateColumn", { columnId, ...patch });
    const res = await fetch("/api/tasks", { cache: "reload" });
    const data = await res.json();
    const row = (Array.isArray(data.columns) ? data.columns : []).find((c: any) => c.id === columnId);
    if (!row) throw new Error("Column not found.");
    return {
      id: row.id,
      boardId: row.board_id,
      title: row.title,
      colorKey: row.color_key,
      isDefault: Boolean(row.is_default),
      position: row.position,
      createdAt: row.created_at,
    } as ColumnRecord;
  },

  async deleteColumn(columnId: string) {
    await post("deleteColumn", { columnId });
  },

  async reorderColumns(boardId: string, orderedColumnIds: string[]) {
    await post("reorderColumns", { boardId, orderedColumnIds });
  },

  async listTickets(boardId: string) {
    const res = await fetch("/api/tasks", { cache: "reload" });
    const data = await res.json();
    const rows = (Array.isArray(data.tickets) ? data.tickets : []).filter((row: any) => row.board_id === boardId);
    return rows.map(toTicketRecord);
  },

  async createTicket(boardId: string, payload: CreateTicketPayload) {
    const data = await post("createTicket", { boardId, ...payload });
    return toTicketRecord(data.ticket);
  },

  async updateTicket(ticketId: string, patch: UpdateTicketPatch) {
    const data = await post("updateTicket", { ticketId, ...patch });
    return toTicketRecord(data.ticket);
  },

  async deleteTicket(ticketId: string) {
    await post("deleteTicket", { ticketId });
  },

  async moveTicket(ticketId: string, payload: MoveTicketPayload) {
    await post("moveTicket", { ticketId, ...payload });
  },

  async reorderTickets(columnId: string, orderedTicketIds: string[]) {
    await post("reorderTickets", { columnId, orderedTicketIds });
  },

  async listTicketAttachments(ticketId: string) {
    const data = await post("listTicketAttachments", { ticketId });
    return (data.rows || []).map((row: any) => ({
      id: row.id,
      ticketId: row.ticket_id,
      name: row.name,
      url: row.url,
      mimeType: row.mime_type,
      size: row.size,
      path: row.path,
      createdAt: row.created_at,
    })) as TicketAttachmentRecord[];
  },

  async uploadTicketAttachment(ticketId: string, file: File) {
    const form = new FormData();
    form.set("action", "uploadAttachment");
    form.set("ticketId", ticketId);
    form.set("file", file);
    const res = await fetch("/api/tasks", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Upload failed.");
    const row = data.attachment;
    return {
      id: row.id,
      ticketId: row.ticket_id,
      name: row.name,
      url: row.url,
      mimeType: row.mime_type,
      size: row.size,
      path: row.path,
      createdAt: row.created_at,
    } as TicketAttachmentRecord;
  },

  async deleteTicketAttachment(attachmentId: string) {
    await post("deleteAttachment", { attachmentId });
  },

  async listTicketSubtasks(ticketId: string) {
    const data = await post("listTicketSubtasks", { ticketId });
    return (data.rows || []).map((row: any) => ({
      id: row.id,
      ticketId: row.ticket_id,
      title: row.title,
      completed: Boolean(row.completed),
      position: row.position,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })) as TicketSubtaskRecord[];
  },

  async createTicketSubtask(ticketId: string, payload: CreateTicketSubtaskPayload) {
    const data = await post("createSubtask", { ticketId, ...payload });
    const row = data.subtask;
    return {
      id: row.id,
      ticketId: row.ticket_id,
      title: row.title,
      completed: Boolean(row.completed),
      position: row.position,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } as TicketSubtaskRecord;
  },

  async updateTicketSubtask(subtaskId: string, patch: UpdateTicketSubtaskPatch) {
    const data = await post("updateSubtask", { subtaskId, ...patch });
    const row = data.subtask;
    return {
      id: row.id,
      ticketId: row.ticket_id,
      title: row.title,
      completed: Boolean(row.completed),
      position: row.position,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } as TicketSubtaskRecord;
  },

  async deleteTicketSubtask(subtaskId: string) {
    await post("deleteSubtask", { subtaskId });
  },

  async listTicketComments(ticketId: string) {
    const data = await post("listTicketComments", { ticketId });
    return (data.rows || []).map((row: any) => ({
      id: row.id,
      ticketId: row.ticket_id,
      authorId: row.author_id,
      authorName: row.author_name,
      content: row.content,
      createdAt: row.created_at,
    })) as TicketCommentRecord[];
  },

  async createTicketComment(ticketId: string, content: string) {
    const data = await post("createComment", { ticketId, content });
    const row = data.comment;
    return {
      id: row.id,
      ticketId: row.ticket_id,
      authorId: row.author_id,
      authorName: row.author_name,
      content: row.content,
      createdAt: row.created_at,
    } as TicketCommentRecord;
  },

  async deleteTicketComment(commentId: string) {
    await post("deleteComment", { commentId });
  },

  async listTicketActivity(ticketId: string) {
    const data = await post("listTicketActivity", { ticketId });
    return (data.rows || []).map((row: any) => ({
      id: row.id,
      ticketId: row.ticket_id,
      source: row.source,
      event: row.event,
      details: row.details,
      level: row.level,
      occurredAt: row.occurred_at,
    })) as TicketActivityRecord[];
  },

  async createTicketActivity(ticketId: string, payload: CreateTicketActivityPayload) {
    const data = await post("createActivity", { ticketId, ...payload });
    const row = data.activity;
    return {
      id: row.id,
      ticketId: row.ticket_id,
      source: row.source,
      event: row.event,
      details: row.details,
      level: row.level,
      occurredAt: row.occurred_at,
    } as TicketActivityRecord;
  },
};

function toTicketRecord(row: any): TicketRecord {
  return {
    id: row.id,
    boardId: row.board_id,
    columnId: row.column_id,
    title: row.title,
    description: row.description ?? "",
    priority: row.priority,
    dueDate: row.due_date,
    tags: row.tags ?? [],
    assigneeIds: row.assignee_ids ?? [],
    assignedAgentId: row.assigned_agent_id ?? "",
    executionMode: row.execution_mode ?? "direct",
    planText: row.plan_text ?? "",
    planApproved: Boolean(row.plan_approved),
    scheduledFor: row.scheduled_for,
    executionState: row.execution_state ?? "open",
    checklistDone: row.checklist_done ?? 0,
    checklistTotal: row.checklist_total ?? 0,
    attachmentsCount: row.attachments_count ?? 0,
    commentsCount: row.comments_count ?? 0,
    position: row.position ?? 0,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as TicketRecord;
}

export function getDataAdapter(): TaskDataAdapter {
  return adapter;
}
