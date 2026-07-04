import { callMcpTool, listMcpTools } from "./mcp-http-client.mjs";
import { createMcpToolId } from "./mcp-tool-adapter.mjs";

export const TOOL_PERMISSION_SCOPES = Object.freeze({
  SAFE: "safe",
  PAGE: "page",
  NETWORK: "network",
  BROWSER_CONTROL: "browser-control",
  EXTERNAL: "external",
  MCP: "mcp",
});

const DEFAULT_TIMEOUT_MS = 30000;

const normalizeToolId = (value) => (typeof value === "string" ? value.trim() : "");

export function createToolDefinition(definition) {
  const id = normalizeToolId(definition?.id);
  if (!id) {
    throw new Error("工具定义必须包含非空 id");
  }
  if (typeof definition?.handler !== "function") {
    throw new Error(`工具 ${id} 缺少 handler`);
  }

  return Object.freeze({
    id,
    name: definition.name || id,
    description: definition.description || "",
    inputSchema: definition.inputSchema || { type: "object", additionalProperties: true },
    permission: definition.permission || TOOL_PERMISSION_SCOPES.SAFE,
    timeoutMs: Number.isFinite(definition.timeoutMs) ? definition.timeoutMs : DEFAULT_TIMEOUT_MS,
    handler: definition.handler,
  });
}

export class ToolRegistry {
  #tools = new Map();

  register(definition) {
    const tool = createToolDefinition(definition);
    if (this.#tools.has(tool.id)) {
      throw new Error(`工具 ${tool.id} 已注册`);
    }
    this.#tools.set(tool.id, tool);
    return tool;
  }

  unregister(toolId) {
    return this.#tools.delete(normalizeToolId(toolId));
  }

  get(toolId) {
    return this.#tools.get(normalizeToolId(toolId));
  }

  list(filter = {}) {
    const permission = filter.permission;
    return Array.from(this.#tools.values()).filter((tool) => !permission || tool.permission === permission);
  }

  async call(toolId, input = {}, context = {}) {
    const tool = this.get(toolId);
    if (!tool) {
      return { ok: false, message: `工具 ${toolId} 未注册` };
    }

    const validation = validateBasicSchema(tool.inputSchema, input);
    if (!validation.ok) {
      return { ok: false, message: `工具 ${tool.id} 参数无效：${validation.message}` };
    }

    return withTimeout(
      Promise.resolve().then(() => tool.handler(input, context)),
      tool.timeoutMs,
      `工具 ${tool.id} 执行超时`,
    );
  }
}

export class ToolActionQueue {
  #chain = Promise.resolve();

  enqueue(task) {
    const run = this.#chain.then(task, task);
    this.#chain = run.catch(() => undefined);
    return run;
  }
}

export function createHttpMcpToolAdapter(options) {
  const baseUrl = new URL(options?.baseUrl || "http://127.0.0.1:17333/");
  const fetchImpl = options?.fetchImpl || options?.fetcher || globalThis.fetch;
  const headers = options?.headers || {};
  const server = createHttpMcpServerConfig(options, baseUrl, headers);

  if (typeof fetchImpl !== "function") {
    throw new Error("当前环境缺少 fetch，无法连接 MCP Bridge");
  }

  const bridgeFetch = async (path, init = {}) => {
    const url = new URL(path, baseUrl);
    const response = await fetchImpl(url.toString(), {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...headers,
        ...(init.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || `MCP Bridge 请求失败：${response.status}`);
    }
    return payload;
  };

  const bridgeListTools = async () => {
    const payload = await bridgeFetch("/tools/list");
    return Array.isArray(payload.tools) ? payload.tools : [];
  };

  const bridgeCallTool = async (toolId, input = {}) =>
    bridgeFetch("/tools/call", {
      method: "POST",
      body: JSON.stringify({ toolId, input }),
    });

  const callRemoteTool = async (toolName, input = {}) => {
    const content = await callMcpTool({
      server,
      toolName,
      arguments: input && typeof input === "object" && !Array.isArray(input) ? input : {},
      fetcher: fetchImpl,
    });
    return { ok: true, content };
  };

  return {
    async listTools() {
      return withBridgeFallback(
        () => listMcpTools({ server, fetcher: fetchImpl }),
        bridgeListTools,
        "MCP 工具列表读取失败",
      );
    },
    async callTool(toolId, input = {}) {
      const normalizedToolId = normalizeToolId(toolId);
      return withBridgeFallback(
        () => callRemoteTool(normalizedToolId, input),
        () => bridgeCallTool(normalizedToolId, input),
        `MCP 工具 ${normalizedToolId} 调用失败`,
      );
    },
    toToolDefinitions(permission = TOOL_PERMISSION_SCOPES.MCP) {
      return this.listTools().then((tools) =>
        tools.map((tool) =>
          createToolDefinition({
            id: createMcpToolId(server.id || "legacy", tool.id || tool.name),
            name: tool.name || tool.id,
            description: tool.description || "",
            inputSchema: tool.inputSchema || { type: "object", additionalProperties: true },
            permission,
            timeoutMs: Number.isFinite(tool.timeoutMs) ? tool.timeoutMs : undefined,
            handler: (input) => this.callTool(tool.id || tool.name, input),
          }),
        ),
      );
    },
  };
}

function createHttpMcpServerConfig(options = {}, baseUrl, headers) {
  const source = options.server && typeof options.server === "object" ? options.server : {};
  const endpointUrl = source.endpoint || source.url || source.endpointUrl || options.endpoint || options.url || options.endpointUrl || baseUrl.toString();
  const timeoutMs = Number.isFinite(source.timeoutMs)
    ? source.timeoutMs
    : Number.isFinite(options.timeoutMs)
      ? options.timeoutMs
      : undefined;

  return {
    ...source,
    id: normalizeToolId(source.id || options.serverId || "legacy"),
    name: source.name || options.serverName || "MCP Server",
    endpoint: endpointUrl,
    endpointUrl,
    token: options.token || options.bearerToken || source.token || source.bearerToken,
    headers: {
      ...(source.headers || {}),
      ...(headers || {}),
    },
    timeoutMs,
  };
}

async function withBridgeFallback(mcpOperation, bridgeOperation, message) {
  let mcpError;
  try {
    return await mcpOperation();
  } catch (error) {
    mcpError = error;
  }

  try {
    return await bridgeOperation();
  } catch (bridgeError) {
    throw new Error(`${message}：${formatErrorMessage(mcpError)}；旧 Bridge fallback 失败：${formatErrorMessage(bridgeError)}`);
  }
}

function formatErrorMessage(error) {
  return error instanceof Error && error.message ? error.message : String(error);
}

async function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = globalThis.setTimeout(() => resolve({ ok: false, message }), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function validateBasicSchema(schema, input) {
  if (!schema || typeof schema !== "object") {
    return { ok: true };
  }

  if (schema.type === "object" && (input === null || typeof input !== "object" || Array.isArray(input))) {
    return { ok: false, message: "必须是对象" };
  }

  if (schema.required && Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (!Object.prototype.hasOwnProperty.call(input, key)) {
        return { ok: false, message: `缺少字段 ${key}` };
      }
    }
  }

  const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!Object.prototype.hasOwnProperty.call(input, key) || !propertySchema?.type) {
      continue;
    }
    const value = input[key];
    if (!matchesJsonType(value, propertySchema.type)) {
      return { ok: false, message: `字段 ${key} 类型应为 ${propertySchema.type}` };
    }
  }

  return { ok: true };
}

function matchesJsonType(value, type) {
  if (Array.isArray(type)) {
    return type.some((item) => matchesJsonType(value, item));
  }
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "null") return value === null;
  return true;
}
