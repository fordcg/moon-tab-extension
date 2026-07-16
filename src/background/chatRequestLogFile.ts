export const CHAT_REQUEST_LOG_ENDPOINT = "http://127.0.0.1:17334/chat-request-logs";
export const CHAT_REQUEST_LOG_HEALTH_ENDPOINT = "http://127.0.0.1:17334/health";
export const CHAT_REQUEST_LOG_SINK_PROTOCOL = "moon-tab-log-sink://ensure";

export type ChatRequestLogSinkStatus =
  | "unknown"
  | "running"
  | "starting"
  | "unavailable";

export async function probeChatRequestLogSink(
  fetcher: typeof fetch = globalThis.fetch?.bind(globalThis),
): Promise<"running" | "unavailable"> {
  if (typeof fetcher !== "function") {
    return "unavailable";
  }
  try {
    const response = await fetcher(CHAT_REQUEST_LOG_HEALTH_ENDPOINT, {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      return "unavailable";
    }
    const payload = (await response.json().catch(() => null)) as { ok?: unknown } | null;
    return payload && payload.ok ? "running" : "unavailable";
  } catch {
    return "unavailable";
  }
}

/**
 * Best-effort auto-start for the local log sink.
 * Chrome extensions cannot spawn Node directly, so we:
 * 1) probe /health
 * 2) if down, open a local custom protocol registered by
 *    `npm run model-diagnostics:install-autostart`
 * 3) poll /health briefly
 */
export async function ensureChatRequestLogSink(input: {
  fetcher?: typeof fetch;
  openExternal?: (url: string) => void;
  pollAttempts?: number;
  pollIntervalMs?: number;
} = {}): Promise<ChatRequestLogSinkStatus> {
  const fetcher = input.fetcher ?? globalThis.fetch?.bind(globalThis);
  if (typeof fetcher !== "function") {
    return "unavailable";
  }

  if ((await probeChatRequestLogSink(fetcher)) === "running") {
    return "running";
  }

  const openExternal =
    input.openExternal ??
    ((url: string) => {
      try {
        // Side panel / extension pages can open custom protocol URLs.
        globalThis.open?.(url, "_blank", "noopener,noreferrer");
      } catch {
        // ignore
      }
    });

  try {
    openExternal(CHAT_REQUEST_LOG_SINK_PROTOCOL);
  } catch {
    // Protocol may be unregistered; fall through to polling/unavailable.
  }

  const attempts = Math.max(1, input.pollAttempts ?? 12);
  const intervalMs = Math.max(50, input.pollIntervalMs ?? 250);
  for (let index = 0; index < attempts; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    if ((await probeChatRequestLogSink(fetcher)) === "running") {
      return "running";
    }
  }

  return "unavailable";
}

const REDACTED = "[已脱敏]";
const SENSITIVE_KEY = /(?:token|secret|password|passwd|pwd|authorization|auth|api[_-]?key|session|jwt|credential|cookie|set-cookie|bearer)/i;
const MAX_STRING_LENGTH = 8_000;
const MAX_DEPTH = 12;
const BASE64_IMAGE_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,/i;
const LONG_BASE64_PATTERN = /^[A-Za-z0-9+/=\s]{200,}$/;
const INLINE_SECRET_PATTERNS = [
  /\b(Bearer|Basic)\s+[^\s,;&}"']+/gi,
  /\b(token|secret|password|passwd|pwd|authorization|auth|api[_-]?key|session|jwt|credential|cookie|set-cookie|bearer)\b(\s*[=:]\s*)(?:Bearer\s+)?("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s,;&}]+)/gi,
];

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
  const sessionToken = createLogSessionToken();

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
            headers: { "Content-Type": "application/json", "X-Chat-Log-Session": sessionToken },
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
  return INLINE_SECRET_PATTERNS.reduce((redacted, pattern) => redacted.replace(pattern, (match, prefix: string, separator?: string) => {
    if (separator !== undefined) {
      return `${prefix}${separator}${REDACTED}`;
    }
    return `${prefix} ${REDACTED}`;
  }), value);
}

function createLogSessionToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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
