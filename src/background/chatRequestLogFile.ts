export const CHAT_REQUEST_LOG_ENDPOINT = "http://127.0.0.1:17334/chat-request-logs";

const REDACTED = "[已脱敏]";
const SENSITIVE_KEY = /(?:token|secret|password|passwd|pwd|authorization|auth|api[_-]?key|session|jwt|credential|cookie|set-cookie|bearer)/i;
const MAX_STRING_LENGTH = 8_000;
const MAX_DEPTH = 12;
const BASE64_IMAGE_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,/i;
const LONG_BASE64_PATTERN = /^[A-Za-z0-9+/=\s]{200,}$/;

export type ChatRequestLogEventType =
  | "session_start"
  | "model_request"
  | "model_response"
  | "tool_call_start"
  | "tool_call_complete"
  | "mcp_call"
  | "mcp_result"
  | "session_end";

export interface ChatRequestLogEvent {
  schemaVersion: 1;
  requestId: string;
  type: ChatRequestLogEventType;
  at: number;
  atIso: string;
  source?: string;
  sessionId?: string;
  [key: string]: unknown;
}

export interface ChatRequestLogClient {
  enabled: boolean;
  requestId: string;
  emit(type: ChatRequestLogEventType, payload?: Record<string, unknown>): void;
}

export function createChatRequestLogClient(input: {
  enabled: boolean;
  requestId: string;
  source?: string;
  sessionId?: string;
  fetcher?: typeof fetch;
  endpoint?: string;
}): ChatRequestLogClient {
  const fetcher = input.fetcher ?? globalThis.fetch?.bind(globalThis);
  const endpoint = input.endpoint ?? CHAT_REQUEST_LOG_ENDPOINT;

  return {
    enabled: Boolean(input.enabled),
    requestId: input.requestId,
    emit(type, payload = {}) {
      if (!input.enabled || !fetcher) {
        return;
      }
      if (!isLocalEndpoint(endpoint)) {
        console.warn("[chat-send] 拒绝非本机请求日志端点", { endpoint });
        return;
      }

      const at = Date.now();
      // Redact payload first so envelope fields like sessionId are not wiped by the "session" key rule.
      const redactedPayload = redactForChatRequestLog(payload);
      const event: ChatRequestLogEvent = {
        schemaVersion: 1,
        requestId: input.requestId,
        type,
        at,
        atIso: new Date(at).toISOString(),
        ...(input.source ? { source: input.source } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...redactedPayload,
      };

      void Promise.resolve()
        .then(() =>
          fetcher(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(event),
          }),
        )
        .catch((error) => {
          console.warn("[chat-send] 写入工作区请求日志失败", {
            type,
            message: error instanceof Error ? error.message : String(error),
          });
        });
    },
  };
}

/**
 * Deep-redact sensitive keys and truncate huge / base64 image payloads before logging.
 * Kept as a pure export so Task 4 and tests can reuse the same redaction rules.
 */
export function redactForChatRequestLog<T>(value: T, depth = 0): T {
  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return redactString(value) as T;
  }

  if (typeof value !== "object" || depth >= MAX_DEPTH) {
    if (typeof value === "function" || typeof value === "symbol") {
      return String(value) as T;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactForChatRequestLog(item, depth + 1)) as T;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(input)) {
    if (SENSITIVE_KEY.test(key)) {
      output[key] = REDACTED;
      continue;
    }
    if (isImageLikeKey(key) && isImageLikeValue(nested)) {
      output[key] = "[image omitted]";
      continue;
    }
    output[key] = redactForChatRequestLog(nested, depth + 1);
  }
  return output as T;
}

function redactString(value: string): string {
  if (BASE64_IMAGE_PATTERN.test(value) || (value.length > 200 && LONG_BASE64_PATTERN.test(value))) {
    return "[binary/base64 omitted]";
  }
  if (value.length > MAX_STRING_LENGTH) {
    return `${value.slice(0, MAX_STRING_LENGTH)}…[truncated ${value.length - MAX_STRING_LENGTH} chars]`;
  }
  return value;
}

function isImageLikeKey(key: string): boolean {
  return /(?:image|thumbnail|screenshot|avatar|icon|photo|picture|media)/i.test(key);
}

function isImageLikeValue(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return BASE64_IMAGE_PATTERN.test(value) || (value.length > 200 && LONG_BASE64_PATTERN.test(value));
}

function isLocalEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return false;
  }
}
