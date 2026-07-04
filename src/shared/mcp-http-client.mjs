export const DEFAULT_MCP_REQUEST_TIMEOUT_MS = 30000;
export const JSON_RPC_VERSION = "2.0";

const DEFAULT_PROTOCOL_VERSION = "2025-03-26";
const MCP_TOOL_TEXT_LIMIT = 12000;
const MCP_TOOL_TRUNCATION_SUFFIX = "...[已截断]";

const normalizeText = (value) => (typeof value === "string" ? value.trim() : "");

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export class McpHttpClientError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "McpHttpClientError";
    this.kind = options.kind || "client";
    this.method = options.method;
    this.isMcpHttpClientError = true;
    this.isMcpBridgeFallbackEligible = options.fallbackEligible === true;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export class McpToolResultError extends Error {
  constructor(toolName, content, result) {
    super(`${toolName} 调用失败：${content || "MCP 工具返回错误"}`);
    this.name = "McpToolResultError";
    this.toolName = toolName;
    this.content = content;
    this.result = result;
    this.isMcpToolResultError = true;
    this.isMcpBridgeFallbackEligible = false;
  }
}

export function isMcpBridgeFallbackEligibleError(error) {
  return Boolean(error?.isMcpBridgeFallbackEligible);
}

export function isMcpToolResultError(error) {
  return Boolean(error?.isMcpToolResultError);
}

export function parseSseJsonRpcResponse(text) {
  return collectSseJsonRpcPayloads(text)[0];
}

export async function listMcpTools(input = {}) {
  const result = await requestAfterInitialize(input, "tools/list", {});
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  return tools.map(normalizeMcpTool).filter(Boolean);
}

export async function callMcpTool(input = {}) {
  const toolName = normalizeText(input.toolName || input.name);
  if (!toolName) {
    throw new McpHttpClientError("缺少 MCP tool name", { kind: "validation", fallbackEligible: false });
  }

  const result = await requestAfterInitialize(input, "tools/call", {
    name: toolName,
    arguments: isRecord(input.arguments) ? input.arguments : {},
  });
  const content = formatMcpToolContent(result);

  if (result?.isError) {
    throw new McpToolResultError(toolName, content, result);
  }

  return content;
}

async function requestAfterInitialize(input, method, params) {
  const initialize = await sendJsonRpcRequest(input, "initialize", {
    protocolVersion: DEFAULT_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: {
      name: "moon-tab-ai-sidebar",
      version: "1.0.0",
    },
  }, undefined, 1);
  const initialized = await sendJsonRpcNotification(
    input,
    "notifications/initialized",
    {},
    initialize.sessionId,
  );

  const response = await sendJsonRpcRequest(
    input,
    method,
    params,
    initialized.sessionId,
    2,
  );
  return response.result;
}

async function sendJsonRpcRequest(input, method, params, sessionId, id) {
  const endpoint = normalizeEndpoint(input);
  const fetcher = input.fetcher || input.fetchImpl || globalThis.fetch;
  if (typeof fetcher !== "function") {
    throw new McpHttpClientError("当前环境缺少 fetch，无法连接 MCP HTTP 服务", {
      kind: "transport",
      method,
      fallbackEligible: true,
    });
  }

  const response = await fetchWithTimeout(fetcher, endpoint, {
    method: "POST",
    headers: buildRequestHeaders(input, sessionId),
    body: JSON.stringify({
      jsonrpc: JSON_RPC_VERSION,
      id,
      method,
      params,
    }),
  }, normalizeTimeoutMs(input), method);

  const payload = await readJsonRpcResponse(response, id);
  if (!response?.ok) {
    throw new McpHttpClientError(createHttpErrorMessage(response, payload, method), {
      kind: "http",
      method,
      fallbackEligible: true,
    });
  }

  if (payload?.error) {
    throw new McpHttpClientError(createJsonRpcErrorMessage(payload.error, method), {
      kind: "jsonrpc",
      method,
      fallbackEligible: false,
    });
  }

  if (!payload || typeof payload !== "object" || !Object.prototype.hasOwnProperty.call(payload, "result")) {
    throw new McpHttpClientError(`MCP ${method} 响应缺少 result`, {
      kind: "protocol",
      method,
      fallbackEligible: true,
    });
  }

  return {
    result: payload.result,
    sessionId: readHeader(response.headers, "Mcp-Session-Id") || sessionId,
  };
}

async function sendJsonRpcNotification(input, method, params, sessionId) {
  const endpoint = normalizeEndpoint(input);
  const fetcher = input.fetcher || input.fetchImpl || globalThis.fetch;
  if (typeof fetcher !== "function") {
    throw new McpHttpClientError("当前环境缺少 fetch，无法连接 MCP HTTP 服务", {
      kind: "transport",
      method,
      fallbackEligible: true,
    });
  }

  const response = await fetchWithTimeout(fetcher, endpoint, {
    method: "POST",
    headers: buildRequestHeaders(input, sessionId),
    body: JSON.stringify({
      jsonrpc: JSON_RPC_VERSION,
      method,
      params,
    }),
  }, normalizeTimeoutMs(input), method);

  if (!response?.ok) {
    const payload = await readJsonRpcResponse(response);
    throw new McpHttpClientError(createHttpErrorMessage(response, payload, method), {
      kind: "http",
      method,
      fallbackEligible: true,
    });
  }

  const payload = await readJsonRpcResponse(response).catch(() => undefined);
  if (payload?.error) {
    throw new McpHttpClientError(createJsonRpcErrorMessage(payload.error, method), {
      kind: "jsonrpc",
      method,
      fallbackEligible: false,
    });
  }

  return {
    sessionId: readHeader(response.headers, "Mcp-Session-Id") || sessionId,
  };
}

async function fetchWithTimeout(fetcher, endpoint, init, timeoutMs, method) {
  const controller = typeof AbortController === "function" ? new AbortController() : undefined;
  const timeoutError = new McpHttpClientError(`MCP 请求超时：${method}`, {
    kind: "timeout",
    method,
    fallbackEligible: true,
  });
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      controller?.abort();
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetcher(endpoint, controller ? { ...init, signal: controller.signal } : init),
      timeout,
    ]);
    if (!response || typeof response !== "object") {
      throw new Error("MCP HTTP 服务返回了无效响应");
    }
    return response;
  } catch (error) {
    if (error === timeoutError || error?.name === "AbortError") {
      throw timeoutError;
    }
    if (error?.isMcpHttpClientError) {
      throw error;
    }
    const message = error instanceof Error && error.message ? error.message : String(error);
    throw new McpHttpClientError(`MCP HTTP 请求失败：${message}`, {
      kind: "transport",
      method,
      fallbackEligible: true,
      cause: error,
    });
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function readJsonRpcResponse(response, requestId) {
  const contentType = readHeader(response?.headers, "content-type").toLowerCase();
  if (contentType.includes("text/event-stream")) {
    return readTextJsonRpcResponse(response, requestId);
  }

  if (typeof response?.json === "function") {
    try {
      return await (typeof response.clone === "function" ? response.clone().json() : response.json());
    } catch {
      // 有些 MCP HTTP server 使用 text/event-stream，继续读取 text。
    }
  }

  return readTextJsonRpcResponse(response, requestId);
}

async function readTextJsonRpcResponse(response, requestId) {
  if (typeof response?.text !== "function") {
    return undefined;
  }

  const text = await response.text().catch(() => "");
  const payload = requestId === undefined
    ? parseSseJsonRpcResponse(text)
    : parseSseJsonRpcResponseById(text, requestId);
  if (payload) return payload;
  return text ? { message: text } : undefined;
}

function parseSseJsonRpcResponseById(text, requestId) {
  return collectSseJsonRpcPayloads(text).find(
    (payload) => payload && Object.prototype.hasOwnProperty.call(payload, "id") && payload.id === requestId,
  );
}

function collectSseJsonRpcPayloads(text) {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) return [];

  try {
    return [JSON.parse(value)];
  } catch {
    // 继续按 text/event-stream 解析。
  }

  const payloads = [];
  for (const eventText of value.split(/\r?\n\r?\n/)) {
    const dataLines = eventText
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());
    if (!dataLines.length) continue;

    const joinedPayload = parseJsonRpcDataText(
      dataLines.filter((line) => normalizeText(line) !== "[DONE]").join("\n"),
    );
    if (joinedPayload) {
      payloads.push(joinedPayload);
      continue;
    }

    for (const dataLine of dataLines) {
      const payload = parseJsonRpcDataText(dataLine);
      if (payload) payloads.push(payload);
    }
  }

  return payloads;
}

function parseJsonRpcDataText(data) {
  const value = normalizeText(data);
  if (!value || value === "[DONE]") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function normalizeEndpoint(input) {
  const server = isRecord(input.server) ? input.server : {};
  const endpoint = normalizeText(
    input.endpoint ||
      input.url ||
      input.endpointUrl ||
      server.endpoint ||
      server.url ||
      server.endpointUrl,
  );
  if (!endpoint) {
    throw new McpHttpClientError("缺少 MCP HTTP endpoint", {
      kind: "configuration",
      fallbackEligible: true,
    });
  }

  try {
    const url = new URL(endpoint);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("protocol");
    }
    return url.toString();
  } catch {
    throw new McpHttpClientError(`MCP HTTP endpoint 格式无效：${endpoint}`, {
      kind: "configuration",
      fallbackEligible: true,
    });
  }
}

function normalizeTimeoutMs(input) {
  const server = isRecord(input.server) ? input.server : {};
  const timeoutMs = Number(input.timeoutMs ?? server.timeoutMs);
  return Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_MCP_REQUEST_TIMEOUT_MS;
}

function buildRequestHeaders(input, sessionId) {
  const server = isRecord(input.server) ? input.server : {};
  const token = normalizeText(input.bearerToken || input.token || server.bearerToken || server.token);
  const headers = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    ...normalizeHeaders(server.headers),
    ...normalizeHeaders(input.headers),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }

  return headers;
}

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const result = {};
  if (typeof headers.forEach === "function") {
    headers.forEach((value, key) => {
      if (value !== undefined && value !== null) result[String(key)] = String(value);
    });
    return result;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null) result[key] = String(value);
  }
  return result;
}

function readHeader(headers, name) {
  if (!headers) return "";
  const lowerName = name.toLowerCase();
  if (typeof headers.get === "function") {
    return normalizeText(headers.get(name) || headers.get(lowerName));
  }

  if (typeof headers.forEach === "function") {
    let found = "";
    headers.forEach((value, key) => {
      if (!found && String(key).toLowerCase() === lowerName) {
        found = normalizeText(String(value));
      }
    });
    return found;
  }

  if (typeof headers === "object") {
    for (const [key, value] of Object.entries(headers)) {
      if (String(key).toLowerCase() === lowerName) {
        return normalizeText(String(value));
      }
    }
  }

  return "";
}

function normalizeMcpTool(tool) {
  if (!isRecord(tool)) return undefined;
  const name = normalizeText(tool.name || tool.id);
  if (!name) return undefined;
  return {
    ...tool,
    id: normalizeText(tool.id) || name,
    name,
    description: normalizeText(tool.description),
    inputSchema: isRecord(tool.inputSchema)
      ? tool.inputSchema
      : isRecord(tool.input_schema)
        ? tool.input_schema
        : { type: "object", additionalProperties: true },
  };
}

function formatMcpToolContent(result) {
  const content = result?.content;
  let text;

  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content.map(formatMcpContentBlock).filter(Boolean).join("\n");
  } else if (typeof result === "string") {
    text = result;
  } else {
    text = safeJsonStringify(result ?? {});
  }

  return truncateToolContent(text);
}

function formatMcpContentBlock(block) {
  if (typeof block === "string") return block;
  if (!isRecord(block)) return "";
  if (block.type === "text" && typeof block.text === "string") return block.text;
  if (block.type === "resource") return safeJsonStringify(block.resource ?? block);
  if (isRecord(block.resource)) return safeJsonStringify(block.resource);
  if (typeof block.text === "string") return block.text;
  return safeJsonStringify(block);
}

function truncateToolContent(text) {
  const value = String(text ?? "");
  return value.length > MCP_TOOL_TEXT_LIMIT
    ? `${value.slice(0, MCP_TOOL_TEXT_LIMIT)}${MCP_TOOL_TRUNCATION_SUFFIX}`
    : value;
}

function safeJsonStringify(value) {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? "" : text;
  } catch {
    return String(value);
  }
}

function createHttpErrorMessage(response, payload, method) {
  const status = Number.isFinite(response?.status) ? response.status : 0;
  const statusText = normalizeText(response?.statusText);
  const payloadMessage = normalizeText(payload?.message || payload?.error?.message);
  const suffix = payloadMessage || statusText || "请求失败";
  return `MCP ${method} HTTP 请求失败：${status || "unknown"} ${suffix}`.trim();
}

function createJsonRpcErrorMessage(error, method) {
  if (typeof error === "string") return `MCP ${method} 调用失败：${error}`;
  const message = normalizeText(error?.message) || safeJsonStringify(error);
  return `MCP ${method} 调用失败：${message}`;
}
