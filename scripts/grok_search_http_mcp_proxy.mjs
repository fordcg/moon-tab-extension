const DEFAULT_BRIDGE_BASE_URL = "http://127.0.0.1:17333/";
const args = parseArgs(process.argv.slice(2));
const bridgeBaseUrl = normalizeBaseUrl(
  args.bridgeBaseUrl || process.env.GROK_SEARCH_MCP_BRIDGE_BASE_URL || DEFAULT_BRIDGE_BASE_URL,
);

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  drainMessages();
});

process.stdin.on("end", () => {
  process.exit(0);
});

function drainMessages() {
  while (buffer.length > 0) {
    if (/^Content-Length:/i.test(buffer.toString("ascii", 0, Math.min(buffer.length, 32)))) {
      if (!drainContentLengthMessage()) return;
      continue;
    }

    const newline = buffer.indexOf(10);
    if (newline === -1) return;
    const line = buffer.subarray(0, newline).toString("utf8").trim();
    buffer = buffer.subarray(newline + 1);
    if (line) handleMessageText(line);
  }
}

function drainContentLengthMessage() {
  const crlfHeaderEnd = buffer.indexOf(Buffer.from("\r\n\r\n"));
  const lfHeaderEnd = buffer.indexOf(Buffer.from("\n\n"));
  const hasCrlfHeader = crlfHeaderEnd !== -1;
  const hasLfHeader = lfHeaderEnd !== -1;
  if (!hasCrlfHeader && !hasLfHeader) return false;

  const headerEnd = hasCrlfHeader && (!hasLfHeader || crlfHeaderEnd <= lfHeaderEnd)
    ? crlfHeaderEnd
    : lfHeaderEnd;
  const separatorLength = headerEnd === crlfHeaderEnd ? 4 : 2;
  const header = buffer.subarray(0, headerEnd).toString("ascii");
  const match = header.match(/Content-Length:\s*(\d+)/i);
  if (!match) {
    buffer = buffer.subarray(headerEnd + separatorLength);
    return true;
  }

  const bodyLength = Number(match[1]);
  const bodyStart = headerEnd + separatorLength;
  const bodyEnd = bodyStart + bodyLength;
  if (buffer.length < bodyEnd) return false;

  const body = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
  buffer = buffer.subarray(bodyEnd);
  handleMessageText(body);
  return true;
}

function handleMessageText(text) {
  let message;
  try {
    message = JSON.parse(text);
  } catch (error) {
    process.stderr.write(`[grok-search-http-mcp-proxy] 无法解析 JSON：${error.message}\n`);
    return;
  }

  void handleJsonRpc(message).catch((error) => {
    if (!Object.prototype.hasOwnProperty.call(message, "id")) return;
    writeJsonRpc({
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: -32000,
        message: error instanceof Error && error.message ? error.message : "Grok Search MCP 代理请求失败",
      },
    });
  });
}

async function handleJsonRpc(message) {
  if (!message || typeof message !== "object") return;
  if (!Object.prototype.hasOwnProperty.call(message, "id")) return;

  const method = typeof message.method === "string" ? message.method : "";
  const params = message.params && typeof message.params === "object" ? message.params : {};

  if (method === "initialize") {
    writeResult(message.id, {
      protocolVersion: params.protocolVersion || "2024-11-05",
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "grok-search-http-mcp-proxy",
        version: "1.0.0",
      },
    });
    return;
  }

  if (method === "ping") {
    writeResult(message.id, {});
    return;
  }

  if (method === "tools/list") {
    writeResult(message.id, {
      tools: await fetchBridgeTools(),
    });
    return;
  }

  if (method === "tools/call") {
    const name = typeof params.name === "string" ? params.name.trim() : "";
    if (!name) throw new Error("缺少 MCP tool name");
    writeResult(message.id, await callBridgeTool(name, params.arguments));
    return;
  }

  writeJsonRpc({
    jsonrpc: "2.0",
    id: message.id,
    error: {
      code: -32601,
      message: `不支持的 MCP 方法：${method}`,
    },
  });
}

async function fetchBridgeTools() {
  const response = await fetch(new URL("/tools/list", bridgeBaseUrl), {
    headers: { Accept: "application/json" },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.message || `Grok Search Bridge 工具列表读取失败：${response.status}`);
  }
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return tools.map((tool) => ({
    name: String(tool.id || tool.name || "").trim(),
    description: typeof tool.description === "string" ? tool.description : "",
    inputSchema: tool.inputSchema || tool.input_schema || { type: "object", additionalProperties: true },
  })).filter((tool) => tool.name);
}

async function callBridgeTool(toolId, input) {
  const response = await fetch(new URL("/tools/call", bridgeBaseUrl), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      toolId,
      input: input && typeof input === "object" && !Array.isArray(input) ? input : {},
    }),
  });
  const body = await response.json().catch(() => ({}));
  const ok = response.ok && body?.ok !== false;
  const text = body?.content || body?.message || JSON.stringify(body || {});
  return {
    content: [{ type: "text", text: String(text) }],
    isError: !ok,
  };
}

function writeResult(id, result) {
  writeJsonRpc({
    jsonrpc: "2.0",
    id,
    result,
  });
}

function writeJsonRpc(payload) {
  const body = JSON.stringify(payload);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function normalizeBaseUrl(value) {
  try {
    const url = new URL(value || DEFAULT_BRIDGE_BASE_URL);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
    return url;
  } catch {
    throw new Error("Grok Search Bridge 地址格式无效。");
  }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--bridge-base-url") {
      result.bridgeBaseUrl = argv[++index];
    }
  }
  return result;
}
