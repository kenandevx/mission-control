import type {
  AgentLogChannelType,
  AgentLogDirection,
  AgentLogEventType,
  AgentLogJsonState,
  AgentLogLevel,
  AgentLogMemorySource,
  AgentLogType,
} from "@/types/agents";

const METADATA_LINE_PATTERNS = [
  /^Conversation info(?:\s*\(untrusted metadata\))?:/i,
  /^Sender(?:\s*\(untrusted metadata\))?:/i,
  /^Replied message(?:\s*\(untrusted metadata\))?:/i,
  /^Message type:/i,
  /^Reply tag:/i,
];

const METADATA_JSON_KEYS = new Set([
  "conversation",
  "conversation_info",
  "sender",
  "replied_message",
  "reply_to",
  "reply_to_current",
  "channel",
  "chat_id",
  "message_id",
]);

function parseJson(value: string): { ok: boolean; value: unknown } {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false, value: null };
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMetadataJson(value: unknown): boolean {
  if (!isObjectRecord(value)) return false;
  const keys = Object.keys(value).map((key) => key.trim().toLowerCase()).filter(Boolean);
  if (keys.length === 0) return false;
  return keys.every((key) => {
    if (METADATA_JSON_KEYS.has(key)) return true;
    return key.includes("conversation") || key.includes("sender") || key.includes("reply");
  });
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateWithEllipsis(value: string, max: number): string {
  if (value.length <= max) return value;
  if (max <= 3) return value.slice(0, max);
  return `${value.slice(0, max - 3)}...`;
}

function stripMetadataJsonFences(input: string): string {
  return input.replace(/```(?:json)?\s*([\s\S]*?)```/gi, (block, body: string) => {
    const parsed = parseJson(body.trim());
    if (parsed.ok && isMetadataJson(parsed.value)) return "";
    return block;
  });
}

function stripMessageWrappers(input: string): string {
  let next = input;
  next = next.replace(/\[\[\s*reply_to_current\s*\]\]/gi, "");
  next = next.replace(/\[\[\s*reply_to:\s*[^\]]+\]\]/gi, "");
  next = next.replace(/<\/?reply[^>]*>/gi, "");
  next = next.replace(/\[(assistant|user|system)\]\s*:\s*/gi, "");
  return next;
}

function stripMetadataLines(input: string): string {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => METADATA_LINE_PATTERNS.every((pattern) => !pattern.test(line)));
  return lines.join(" ");
}

function parseFencedJson(text: string): { ok: boolean; value: unknown | null; sawJsonLike: boolean } {
  const matches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  if (matches.length === 0) return { ok: false, value: null, sawJsonLike: false };

  for (const match of matches) {
    const candidate = String(match[1] ?? "").trim();
    if (!candidate) continue;
    const parsed = parseJson(candidate);
    if (parsed.ok) return { ok: true, value: parsed.value, sawJsonLike: true };
  }

  return { ok: false, value: null, sawJsonLike: true };
}

export function extractFirstValidJsonFromText(text: string): unknown | null {
  const source = String(text ?? "");
  if (!source.trim()) return null;

  const direct = parseJson(source.trim());
  if (direct.ok) return direct.value;

  const fenced = parseFencedJson(source);
  if (fenced.ok) return fenced.value;

  let inString = false;
  let escaped = false;
  let start = -1;
  const stack: string[] = [];

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{" || ch === "[") {
      if (stack.length === 0) start = i;
      stack.push(ch);
      continue;
    }

    if (ch === "}" || ch === "]") {
      if (stack.length === 0) continue;
      const top = stack[stack.length - 1];
      const matches = (top === "{" && ch === "}") || (top === "[" && ch === "]");
      if (!matches) {
        stack.length = 0;
        start = -1;
        continue;
      }

      stack.pop();
      if (stack.length === 0 && start >= 0) {
        const candidate = source.slice(start, i + 1).trim();
        const parsed = parseJson(candidate);
        if (parsed.ok) return parsed.value;
        start = -1;
      }
    }
  }

  return null;
}

function findJsonPayload(message: string): { state: AgentLogJsonState; payload: unknown | null } {
  const trimmed = message.trim();
  if (!trimmed) return { state: "none", payload: null };

  let sawJsonLike = false;
  const directLooksJson =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));
  if (directLooksJson) {
    sawJsonLike = true;
    const direct = parseJson(trimmed);
    if (direct.ok) return { state: "valid", payload: direct.value };
  }

  const fenced = parseFencedJson(trimmed);
  sawJsonLike = sawJsonLike || fenced.sawJsonLike;
  if (fenced.ok) return { state: "valid", payload: fenced.value };

  const extracted = extractFirstValidJsonFromText(trimmed);
  if (extracted != null) return { state: "valid", payload: extracted };

  return {
    state: sawJsonLike ? "invalid" : "none",
    payload: null,
  };
}

function previewFromPayload(payload: unknown): string {
  const pretty = JSON.stringify(payload, null, 2);
  const lines = pretty.split("\n").slice(0, 2).join(" ");
  return truncateWithEllipsis(collapseWhitespace(lines), 240);
}

function previewFromText(message: string): string {
  return truncateWithEllipsis(collapseWhitespace(message), 240);
}

export function cleanAgentLogMessage(message: string): string {
  const noJsonMetadata = stripMetadataJsonFences(message);
  const withoutWrappers = stripMessageWrappers(noJsonMetadata);
  const withoutMetadataLines = stripMetadataLines(withoutWrappers);
  return collapseWhitespace(withoutMetadataLines);
}

function hasMemoryHints(normalized: string): boolean {
  const explicitMemoryOps =
    normalized.includes("memory_store") ||
    normalized.includes("memory_search") ||
    normalized.includes("memory_write") ||
    normalized.includes("memory_upsert") ||
    normalized.includes("memory.read") ||
    normalized.includes("memory.write") ||
    normalized.includes("memory.search") ||
    normalized.includes("memory.upsert");

  const vectorHints =
    normalized.includes("qdrant") ||
    normalized.includes("vector") ||
    normalized.includes("embedding") ||
    normalized.includes("collection");

  return explicitMemoryOps || vectorHints;
}

function classifyMemoryEventFromText(level: AgentLogLevel, normalized: string): AgentLogEventType {
  if (
    level === "error" ||
    normalized.includes("error") ||
    normalized.includes("failed") ||
    normalized.includes("timeout")
  ) {
    return "memory.error";
  }
  if (
    normalized.includes("upsert") ||
    normalized.includes("insert") ||
    normalized.includes("persist")
  ) {
    return "memory.upsert";
  }
  if (
    normalized.includes("write") ||
    normalized.includes("save") ||
    normalized.includes("append") ||
    normalized.includes("update")
  ) {
    return "memory.write";
  }
  if (
    normalized.includes("search") ||
    normalized.includes("query") ||
    normalized.includes("retrieve") ||
    normalized.includes("recall")
  ) {
    return "memory.search";
  }
  return "memory.read";
}

export function classifyAgentLogEvent(
  level: AgentLogLevel,
  type: AgentLogType,
  message: string,
): AgentLogEventType {
  const normalized = message.toLowerCase();
  if (normalized.includes("heartbeat") && normalized.includes("status")) return "heartbeat.status_change";
  if (normalized.includes("heartbeat") && normalized.includes("tick")) return "heartbeat.tick";

  if (type === "memory" || hasMemoryHints(normalized)) {
    return classifyMemoryEventFromText(level, normalized);
  }

  if (type === "tool") {
    if (level === "error") return "tool.error";
    if (normalized.includes("(started)")) return "tool.start";
    if (normalized.includes("(failed)")) return "tool.error";
    return "tool.success";
  }

  if (normalized.includes("reaction") || normalized.includes("react")) return "chat.reaction";
  if (type === "workflow" && normalized.startsWith("user:")) return "chat.user_in";
  if (normalized.startsWith("assistant:")) return "chat.assistant_out";
  if (normalized.startsWith("user:")) return "chat.user_in";
  if (normalized.includes("bridge logger started") || normalized.includes("startup")) return "system.startup";
  if (normalized.includes("bridge logger stopped") || normalized.includes("shutdown")) return "system.shutdown";
  if (level === "error") return "system.error";
  return "system.warning";
}

export function classifyAgentLogChannel(message: string): AgentLogChannelType {
  const normalized = message.toLowerCase();
  if (normalized.includes("telegram")) return "telegram";
  if (normalized.includes("qdrant") || normalized.includes("vector")) return "qdrant";

  const isGateway =
    normalized.includes("gateway") ||
    normalized.includes("ws://") ||
    normalized.includes("websocket") ||
    normalized.includes("unauthorized") ||
    normalized.includes("timeout");
  if (isGateway) return "gateway";

  return "internal";
}

export function classifyAgentLogDirection(
  eventType: AgentLogEventType,
  message: string,
): AgentLogDirection {
  if (eventType === "chat.user_in") return "inbound";
  if (eventType === "chat.assistant_out" || eventType === "chat.reaction") return "outbound";

  const normalized = message.toLowerCase();
  if (normalized.includes("inbound")) return "inbound";
  if (normalized.includes("outbound")) return "outbound";
  return "internal";
}

export function classifyAgentLogMemorySource(
  eventType: AgentLogEventType,
  message: string,
): AgentLogMemorySource {
  const normalized = message.toLowerCase();
  const hasMemoryEvent = eventType.startsWith("memory.");
  const hasHints = hasMemoryHints(normalized);
  if (!hasMemoryEvent && !hasHints) return "";

  if (normalized.includes("daily")) return "daily_file";
  if (normalized.includes("episodic")) return "episodic_file";
  if (normalized.includes("long-term") || normalized.includes("memory.md")) return "long_term_file";
  if (
    normalized.includes("qdrant") ||
    normalized.includes("vector") ||
    normalized.includes("embedding") ||
    normalized.includes("point")
  ) {
    return "qdrant_vector";
  }
  return "session";
}

export function detectContainsPii(message: string, payload: unknown): boolean {
  let payloadText = "";
  if (payload != null) {
    try {
      payloadText = JSON.stringify(payload);
    } catch {
      payloadText = "";
    }
  }
  const source = `${message} ${payloadText}`;
  if (!source.trim()) return false;

  const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  if (emailPattern.test(source)) return true;

  const phonePattern = /(?:\+?\d{1,3}[\s\-().]*)?(?:\d[\s\-().]*){7,14}\d/;
  if (phonePattern.test(source)) return true;

  const longNumericIdPattern = /\b\d{8,}\b/;
  return longNumericIdPattern.test(source);
}

export function normalizeAgentLogPayload(message: string): {
  cleanedMessage: string;
  messagePreview: string;
  jsonState: AgentLogJsonState;
  isJson: boolean;
  rawPayload: unknown | null;
} {
  const cleanedMessage = cleanAgentLogMessage(message);
  const { state, payload } = findJsonPayload(cleanedMessage || message);
  const messagePreview =
    state === "valid" && payload != null
      ? previewFromPayload(payload)
      : previewFromText(cleanedMessage || message);

  return {
    cleanedMessage,
    messagePreview,
    jsonState: state,
    isJson: state === "valid",
    rawPayload: state === "valid" ? payload : null,
  };
}
