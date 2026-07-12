import type { McpDiscoveredTool, McpServerConfig } from "../types";
import { truncateText } from "../utils/text";

type Fetcher = typeof fetch;

interface McpClientInput {
  server: McpServerConfig;
  bearerToken?: string;
  fetcher?: Fetcher;
  signal?: AbortSignal;
}

interface ListMcpToolsInput extends McpClientInput {}

interface CallMcpToolInput extends McpClientInput {
  toolName: string;
  arguments: Record<string, unknown>;
}

interface JsonRpcResponse {
  id?: number | string;
  result?: unknown;
  error?: { code?: number; message?: string };
}

const DEFAULT_MCP_LIST_TIMEOUT_MS = 30000;
const DEFAULT_MCP_CALL_TIMEOUT_MS = 310000;

let nextRequestId = 1;

export async function listMcpTools(input: ListMcpToolsInput): Promise<McpDiscoveredTool[]> {
  return withMcpRequestTimeout(input, DEFAULT_MCP_LIST_TIMEOUT_MS, async (signal) => {
    const requestInput = { ...input, signal };
    try {
      const session = await initializeMcpSession(requestInput);
      const response = await sendMcpRequest(requestInput, "tools/list", createToolsListParams(session.protocolVersion), session.sessionId);
      const tools = response.result && typeof response.result === "object" && Array.isArray((response.result as { tools?: unknown }).tools)
        ? (response.result as { tools: unknown[] }).tools
        : [];

      return tools.map(normalizeMcpToolFromResponse).filter((tool): tool is McpDiscoveredTool => Boolean(tool));
    } catch (error) {
      if (!isBridgeFallbackEligibleError(error)) {
        throw error;
      }
      return listBridgeTools(requestInput);
    }
  });
}

export async function callMcpTool(input: CallMcpToolInput): Promise<string> {
  return withMcpRequestTimeout(input, DEFAULT_MCP_CALL_TIMEOUT_MS, async (signal) => {
    const requestInput = { ...input, signal };
    try {
      const session = await initializeMcpSession(requestInput);
      const response = await sendMcpRequest(
        requestInput,
        "tools/call",
        { name: input.toolName, arguments: input.arguments },
        session.sessionId,
      );
      return formatMcpToolResult(response.result);
    } catch (error) {
      if (!isBridgeFallbackEligibleError(error)) {
        throw error;
      }
      return callBridgeTool(requestInput);
    }
  });
}

async function initializeMcpSession(input: McpClientInput): Promise<{ protocolVersion?: string; sessionId?: string }> {
  const response = await sendMcpRequest(input, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "browser-ai-assistant", version: "mcp-tools-mvp" },
  });
  await sendMcpNotification(input, "notifications/initialized", undefined, response.sessionId);
  return { protocolVersion: readProtocolVersion(response.result), sessionId: response.sessionId };
}

async function sendMcpRequest(
  input: McpClientInput,
  method: string,
  params: Record<string, unknown> | undefined,
  sessionId?: string,
): Promise<JsonRpcResponse & { sessionId?: string }> {
  const fetcher = input.fetcher ?? fetch;
  const body = {
    jsonrpc: "2.0",
    id: nextRequestId++,
    method,
    ...(params ? { params } : {}),
  };
  const response = await fetcher(input.server.endpointUrl, {
    method: "POST",
    headers: createMcpHeaders(input.bearerToken, sessionId),
    body: JSON.stringify(body),
    signal: input.signal,
  });

  if (!response.ok) {
    throw new Error(`MCP 请求失败：${response.status} ${response.statusText}`.trim());
  }

  const rpcResponse = await readJsonRpcResponse(response);
  if (rpcResponse.error) {
    throw new Error(`MCP 请求失败：${rpcResponse.error.message || rpcResponse.error.code || "远端返回错误"}`);
  }

  return {
    ...rpcResponse,
    sessionId: response.headers.get("Mcp-Session-Id") ?? response.headers.get("mcp-session-id") ?? sessionId,
  };
}

async function sendMcpNotification(
  input: McpClientInput,
  method: string,
  params: Record<string, unknown> | undefined,
  sessionId?: string,
): Promise<void> {
  const fetcher = input.fetcher ?? fetch;
  const body = {
    jsonrpc: "2.0",
    method,
    ...(params ? { params } : {}),
  };
  const response = await fetcher(input.server.endpointUrl, {
    method: "POST",
    headers: createMcpHeaders(input.bearerToken, sessionId),
    body: JSON.stringify(body),
    signal: input.signal,
  });

  if (!response.ok) {
    throw new Error(`MCP 请求失败：${response.status} ${response.statusText}`.trim());
  }
}

async function withMcpRequestTimeout<T>(input: McpClientInput, timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (input.signal?.aborted) {
    throw new Error("MCP 请求已取消");
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortByCaller = () => controller.abort();
  input.signal?.addEventListener("abort", abortByCaller, { once: true });

  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(timedOut ? "MCP 请求超时" : "MCP 请求已取消");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    input.signal?.removeEventListener("abort", abortByCaller);
  }
}

function readProtocolVersion(result: unknown): string | undefined {
  return result && typeof result === "object" && typeof (result as { protocolVersion?: unknown }).protocolVersion === "string"
    ? (result as { protocolVersion: string }).protocolVersion
    : undefined;
}

function createToolsListParams(protocolVersion: string | undefined): Record<string, unknown> | undefined {
  // 2025-03-26 的 tools/list 已是分页接口，部分远端实现会严格校验 params.cursor。
  return protocolVersion === "2025-03-26" ? { cursor: "" } : undefined;
}

function createMcpHeaders(bearerToken: string | undefined, sessionId: string | undefined): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
    ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
  };
}

async function readJsonRpcResponse(response: Response): Promise<JsonRpcResponse> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return parseSseJsonRpcResponse(await response.text());
  }

  return response.json() as Promise<JsonRpcResponse>;
}

function parseSseJsonRpcResponse(text: string): JsonRpcResponse {
  const dataLines = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter(Boolean);
  for (let index = dataLines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(dataLines[index]) as JsonRpcResponse;
    } catch {
      continue;
    }
  }
  throw new Error("MCP 响应格式无效");
}

async function listBridgeTools(input: McpClientInput): Promise<McpDiscoveredTool[]> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(createBridgeUrl(input.server.endpointUrl, "tools/list"), {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(input.bearerToken ? { Authorization: `Bearer ${input.bearerToken}` } : {}),
    },
    signal: input.signal,
  });
  if (!response.ok) {
    throw new Error(`MCP Bridge 工具列表读取失败：${response.status} ${response.statusText}`.trim());
  }

  const payload = await response.json() as { tools?: unknown };
  const tools = Array.isArray(payload.tools) ? payload.tools : [];
  return tools.map(normalizeMcpToolFromResponse).filter((tool): tool is McpDiscoveredTool => Boolean(tool));
}

async function callBridgeTool(input: CallMcpToolInput): Promise<string> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(createBridgeUrl(input.server.endpointUrl, "tools/call"), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(input.bearerToken ? { Authorization: `Bearer ${input.bearerToken}` } : {}),
    },
    body: JSON.stringify({
      toolId: input.toolName,
      input: input.arguments,
    }),
    signal: input.signal,
  });
  if (!response.ok) {
    throw new Error(`MCP Bridge 工具调用失败：${response.status} ${response.statusText}`.trim());
  }

  const payload = await response.json() as { ok?: unknown; content?: unknown; message?: unknown };
  if (payload.ok === false) {
    throw new Error(typeof payload.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : `MCP Bridge 工具调用失败：${input.toolName}`);
  }
  if (typeof payload.content === "string") {
    return truncateText(payload.content, 12000).text;
  }
  return truncateText(JSON.stringify(payload.content ?? payload), 12000).text;
}

function createBridgeUrl(endpointUrl: string, path: "tools/list" | "tools/call"): string {
  const url = new URL(endpointUrl);
  return `${url.protocol}//${url.host}/${path}`;
}

function isBridgeFallbackEligibleError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /MCP 请求失败：\s*(404|405|501)\b/i.test(message)
    || /未找到 MCP Bridge 路由/i.test(message)
    || /Failed to fetch|NetworkError|ECONNREFUSED|ENOTFOUND/i.test(message);
}

function normalizeMcpToolFromResponse(value: unknown): McpDiscoveredTool | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as { name?: unknown; id?: unknown; description?: unknown; inputSchema?: unknown; input_schema?: unknown };
  const name = typeof source.name === "string" && source.name.trim()
    ? source.name.trim()
    : typeof source.id === "string" && source.id.trim()
      ? source.id.trim()
      : "";
  if (!name) {
    return undefined;
  }

  const inputSchema = source.inputSchema && typeof source.inputSchema === "object" && !Array.isArray(source.inputSchema)
    ? source.inputSchema as Record<string, unknown>
    : source.input_schema && typeof source.input_schema === "object" && !Array.isArray(source.input_schema)
      ? source.input_schema as Record<string, unknown>
      : {};

  return {
    name,
    description: typeof source.description === "string" && source.description.trim() ? source.description.trim() : undefined,
    inputSchema,
  };
}

function formatMcpToolResult(result: unknown): string {
  if (!result || typeof result !== "object") {
    return truncateText(JSON.stringify(result ?? null), 12000).text;
  }

  const content = (result as { content?: unknown }).content;
  if (Array.isArray(content)) {
    const text = content.map(formatMcpContentBlock).filter(Boolean).join("\n");
    return truncateText(text || "MCP 工具已返回空结果", 12000).text;
  }

  return truncateText(JSON.stringify(result), 12000).text;
}

function formatMcpContentBlock(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const block = value as { type?: unknown; text?: unknown };
  if (block.type === "text" && typeof block.text === "string") {
    return block.text;
  }

  return JSON.stringify(value);
}
