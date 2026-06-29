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
  const fetchImpl = options?.fetchImpl || globalThis.fetch;
  const headers = options?.headers || {};

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

  return {
    async listTools() {
      const payload = await bridgeFetch("/tools/list");
      return Array.isArray(payload.tools) ? payload.tools : [];
    },
    async callTool(toolId, input = {}) {
      return bridgeFetch("/tools/call", {
        method: "POST",
        body: JSON.stringify({ toolId, input }),
      });
    },
    toToolDefinitions(permission = TOOL_PERMISSION_SCOPES.MCP) {
      return this.listTools().then((tools) =>
        tools.map((tool) =>
          createToolDefinition({
            id: `mcp.${tool.id || tool.name}`,
            name: tool.name || tool.id,
            description: tool.description || "",
            inputSchema: tool.inputSchema || { type: "object", additionalProperties: true },
            permission,
            handler: (input) => this.callTool(tool.id || tool.name, input),
          }),
        ),
      );
    },
  };
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
