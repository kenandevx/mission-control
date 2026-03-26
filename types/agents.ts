export type AgentStatus = "running" | "idle" | "degraded";
export type AgentLogLevel = "info" | "warning" | "error" | "debug";
export type AgentLogType = "workflow" | "tool" | "memory" | "system" | "worker" | "bullmq";
export type AgentLogEventType =
  | "chat.user_in"
  | "chat.assistant_out"
  | "chat.reaction"
  | "tool.start"
  | "tool.success"
  | "tool.error"
  | "system.startup"
  | "system.shutdown"
  | "system.error"
  | "system.warning"
  | "heartbeat.tick"
  | "heartbeat.status_change"
  | "memory.read"
  | "memory.write"
  | "memory.search"
  | "memory.upsert"
  | "memory.error";
export type AgentLogChannelType = "telegram" | "internal" | "gateway" | "qdrant";
export type AgentLogDirection = "inbound" | "outbound" | "internal";
export type AgentLogMemorySource =
  | ""
  | "session"
  | "daily_file"
  | "long_term_file"
  | "episodic_file"
  | "qdrant_vector";
export type AgentLogJsonState = "none" | "valid" | "invalid";

export type AgentRuntime = {
  model: string | null;
  queueDepth: number | null;
  activeRuns: number | null;
  lastHeartbeatAt: string | null;
  uptimeMinutes: number | null;
};

export type AgentFieldSource = "runtime" | "database" | "fallback";

export type AgentRuntimeMeta = {
  stale: boolean;
  heartbeatAgeSec: number | null;
  source: "openclaw-runtime" | "database-fallback";
  collectedAt: string | null;
  fieldSources: {
    name: AgentFieldSource;
    status: AgentFieldSource;
    model: AgentFieldSource;
    queueDepth: AgentFieldSource;
    activeRuns: AgentFieldSource;
    lastHeartbeatAt: AgentFieldSource;
    uptimeMinutes: AgentFieldSource;
  };
};

export type AgentLogPageInfo = {
  limit: number;
  page: number;
  shownCount: number;
  totalCount: number;
  pageCount: number;
};

export type AgentHealthActivity = {
  lastActivityAt: string | null;
  responses1h: number;
  errors1h: number;
};

export type AgentIdentity = {
  name: string;
  emoji: string;
  role: string;
};

export type Agent = {
  id: string;
  name: string;
  status: AgentStatus;
  runtime: AgentRuntime;
  runtimeMeta?: AgentRuntimeMeta;
  identity?: AgentIdentity;
  activeSkills?: string[];
  soul?: string;
};

export type AgentLog = {
  id: string;
  agentId: string;
  occurredAt: string;
  level: AgentLogLevel;
  type: AgentLogType;
  runId: string;
  message: string;
  eventId?: string;
  eventType?: AgentLogEventType;
  direction?: AgentLogDirection;
  channelType?: AgentLogChannelType;
  sessionKey?: string;
  sourceMessageId?: string;
  correlationId?: string;
  status?: string;
  retryCount?: number;
  messagePreview?: string;
  isJson?: boolean;
  jsonState?: AgentLogJsonState;
  containsPii?: boolean;
  memorySource?: AgentLogMemorySource;
  memoryKey?: string;
  collection?: string;
  queryText?: string;
  resultCount?: number | null;
  rawPayload?: unknown | null;
};
