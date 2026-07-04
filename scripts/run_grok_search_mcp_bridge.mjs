import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_SERVER_PATH = "D:\\novel\\2\\.claude-grok-search-mcp\\server.mjs";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 17333;
const DEFAULT_REQUEST_TIMEOUT_MS = 310000;
const DEFAULT_GROK_MODEL = "grok-4.20-multi-agent-xhigh";
const DEFAULT_GROK_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_CONFIG_DIR = resolve(
  process.env.LOCALAPPDATA || process.env.APPDATA || process.cwd(),
  "MoonTab",
);
const DEFAULT_CONFIG_FILE = resolve(DEFAULT_CONFIG_DIR, "grok-search-mcp-bridge.config.json");

const args = parseArgs(process.argv.slice(2));
let client;
let server;
let bridgeRuntime;
let bridgeConfig;
let recentToolTransportFailure;

const TRANSPORT_FAILURE_CACHE_MS = 60000;

async function main() {
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const serverPath = args.server || process.env.GROK_SEARCH_MCP_SERVER_PATH || DEFAULT_SERVER_PATH;
  const host = args.host || process.env.MCP_BRIDGE_HOST || DEFAULT_HOST;
  const port = Number(args.port || process.env.MCP_BRIDGE_PORT || DEFAULT_PORT);
  const requestTimeoutMs = Number(
    args.timeoutMs || process.env.MCP_BRIDGE_REQUEST_TIMEOUT_MS || DEFAULT_REQUEST_TIMEOUT_MS,
  );
  const configFile = args.configFile || process.env.GROK_SEARCH_MCP_BRIDGE_CONFIG_FILE || DEFAULT_CONFIG_FILE;
  const savedConfig = await readSavedBridgeConfig(configFile);
  bridgeConfig = normalizeBridgeConfig({
    ...savedConfig,
    apiKey: firstNonEmpty(args.apiKey, process.env.GROK_API_KEY, process.env.XAI_API_KEY, savedConfig.apiKey, ""),
    baseUrl: firstNonEmpty(
      args.baseUrl,
      process.env.GROK_BASE_URL,
      process.env.XAI_BASE_URL,
      savedConfig.baseUrl,
      DEFAULT_GROK_BASE_URL,
    ),
    model:
      firstNonEmpty(
        args.model,
        process.env.GROK_SEARCH_MCP_MODEL,
        process.env.GROK_MODEL,
        process.env.XAI_MODEL,
        savedConfig.model,
      ) ||
      DEFAULT_GROK_MODEL,
    apiStyle: firstNonEmpty(
      args.apiStyle,
      process.env.GROK_API_STYLE,
      process.env.XAI_API_STYLE,
      savedConfig.apiStyle,
      "",
    ),
  });
  bridgeConfig.configFile = configFile;

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    fail(`MCP Bridge 端口无效：${port}`);
  }

  if (!existsSync(serverPath)) {
    fail(`找不到 Grok Search MCP server：${serverPath}`);
  }

  bridgeRuntime = {
    command: process.execPath,
    args: [serverPath],
    cwd: resolve(serverPath, ".."),
    timeoutMs: requestTimeoutMs,
  };
  client = createConfiguredClient();

  if (args.listToolsOnce) {
    try {
      await client.initialize();
      const tools = await listMcpTools(client, { timeoutMs: requestTimeoutMs });
      process.stdout.write(`${JSON.stringify({ tools }, null, 2)}\n`);
      await client.close();
      process.exit(0);
    } catch (error) {
      await client.close();
      fail(error instanceof Error ? error.message : String(error));
    }
  }

  server = http.createServer((request, response) => {
    void handleHttpRequest(request, response, {
      host,
      port,
      requestTimeoutMs,
    }).catch((error) => {
      writeJson(response, 500, {
        ok: false,
        message: error instanceof Error && error.message ? error.message : "MCP Bridge 请求处理失败",
      });
    });
  });

  server.listen(port, host, async () => {
    try {
      await client.initialize();
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      console.log(`Grok Search MCP Bridge 已启动：http://${host}:${actualPort}/`);
      console.log(`stdio server：${serverPath}`);
      console.log(`Grok API：${bridgeConfig.baseUrl}`);
      console.log(`Grok model：${bridgeConfig.model}`);
      console.log(`Bridge config：${configFile}`);
      if (!bridgeConfig.apiKey) {
        console.warn("提示：未配置 GROK_API_KEY / XAI_API_KEY，可在侧边栏“工具和 MCP”里保存 API Key。");
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      await shutdown(1);
    }
  });

  process.on("SIGINT", () => {
    void shutdown(0);
  });

  process.on("SIGTERM", () => {
    void shutdown(0);
  });
}

async function handleHttpRequest(request, response, fallbackAddress) {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(
    request.url || "/",
    `http://${request.headers.host || `${fallbackAddress.host}:${fallbackAddress.port}`}`,
  );

  if (request.method === "GET" && url.pathname === "/health") {
    writeJson(response, 200, {
      ok: true,
      name: "grok-search-mcp-bridge",
      config: publicBridgeConfig(),
      model: bridgeConfig.model,
      timeoutMs: fallbackAddress.requestTimeoutMs,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/config") {
    writeJson(response, 200, {
      ok: true,
      config: publicBridgeConfig(),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/config") {
    const body = await readJsonBody(request);
    bridgeConfig = normalizeBridgeConfig({
      ...bridgeConfig,
      ...pickBridgeConfigInput(body),
    });
    bridgeConfig.configFile = bridgeConfig.configFile || args.configFile || process.env.GROK_SEARCH_MCP_BRIDGE_CONFIG_FILE || DEFAULT_CONFIG_FILE;
    await saveBridgeConfig(bridgeConfig.configFile, bridgeConfig);
    recentToolTransportFailure = undefined;
    await restartConfiguredClient();
    writeJson(response, 200, {
      ok: true,
      message: "Grok Search MCP 配置已更新。",
      config: publicBridgeConfig(),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/tools/list") {
    const tools = await listMcpTools(client, { timeoutMs: fallbackAddress.requestTimeoutMs });
    writeJson(response, 200, { tools });
    return;
  }

  if (request.method === "POST" && url.pathname === "/tools/call") {
    const body = await readJsonBody(request);
    const toolId = typeof body.toolId === "string" ? body.toolId.trim() : "";
    if (!toolId) {
      writeJson(response, 400, { ok: false, message: "缺少 toolId" });
      return;
    }
    const input = body.input && typeof body.input === "object" && !Array.isArray(body.input)
      ? body.input
      : {};
    const cachedFailure = getRecentToolTransportFailure();
    if (cachedFailure) {
      writeJson(response, 200, {
        ok: false,
        message: cachedFailure.message,
      });
      return;
    }
    const result = await client.request("tools/call", {
      name: toolId,
      arguments: input,
    });
    const content = normalizeMcpContent(result?.content);
    if (result?.isError) {
      const message = summarizeToolError(toolId, content);
      rememberToolTransportFailure(message);
      writeJson(response, 200, {
        ok: false,
        message,
      });
      return;
    }
    writeJson(response, 200, {
      ok: true,
      content: content || JSON.stringify(result ?? {}),
      raw: result,
    });
    return;
  }

  writeJson(response, 404, { ok: false, message: "未找到 MCP Bridge 路由" });
}

function getRecentToolTransportFailure() {
  if (!recentToolTransportFailure) return;
  if (Date.now() - recentToolTransportFailure.createdAt > TRANSPORT_FAILURE_CACHE_MS) {
    recentToolTransportFailure = undefined;
    return;
  }
  return recentToolTransportFailure;
}

function rememberToolTransportFailure(message) {
  if (!isTransportFailureMessage(message)) return;
  recentToolTransportFailure = {
    createdAt: Date.now(),
    message,
  };
}

function summarizeToolError(toolId, content) {
  const message = extractUpstreamErrorMessage(content) || content || `${toolId} 调用失败`;
  return `${toolId} 调用失败：${redactBridgeErrorText(truncateBridgeError(message, 900))}`;
}

function extractUpstreamErrorMessage(text) {
  const value = String(text || "");
  for (const match of value.matchAll(/^data:\s*(\{.*\})\s*$/gm)) {
    const message = parseUpstreamErrorMessage(match[1]);
    if (message) return message;
  }

  const jsonMessage = parseUpstreamErrorMessage(value);
  if (jsonMessage) return jsonMessage;

  const messageMatch = value.match(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (messageMatch) {
    try {
      return JSON.parse(`"${messageMatch[1]}"`);
    } catch {
      return messageMatch[1];
    }
  }

  const curlMatch = value.match(/(?:Console transport failed:\s*)?Transport request failed:[\s\S]*?curl:\s*\(35\)[\s\S]*?(?=(?:\. See https:\/\/curl\.se|$))/i);
  return curlMatch ? curlMatch[0] : "";
}

function parseUpstreamErrorMessage(text) {
  try {
    const payload = JSON.parse(text);
    const error = payload?.error && typeof payload.error === "object" ? payload.error : payload;
    const code = String(error?.code || error?.type || "");
    const message = typeof error?.message === "string" ? error.message.trim() : "";
    if (message && /upstream_error|transport|curl|tls|openssl/i.test(`${code} ${message}`)) {
      return message;
    }
  } catch {
    // 不是 JSON 时继续走文本提取。
  }
  return "";
}

function isTransportFailureMessage(message) {
  return /upstream_error|transport request failed|curl:\s*\(35\)|tls connect error|openssl/i.test(String(message || ""));
}

function redactBridgeErrorText(text) {
  return String(text || "")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [已脱敏]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[已脱敏]");
}

function truncateBridgeError(text, limit) {
  const value = String(text || "").trim();
  return value.length <= limit ? value : `${value.slice(0, limit)}…[已截断]`;
}

function createConfiguredClient() {
  return new StdioMcpClient({
    command: bridgeRuntime.command,
    args: bridgeRuntime.args,
    cwd: bridgeRuntime.cwd,
    env: makeChildEnv(bridgeConfig),
    timeoutMs: bridgeRuntime.timeoutMs,
  });
}

async function restartConfiguredClient() {
  const previous = client;
  client = createConfiguredClient();
  try {
    await client.initialize();
    await previous?.close();
  } catch (error) {
    await client?.close();
    client = previous;
    throw error;
  }
}

function makeChildEnv(config) {
  return {
    ...process.env,
    GROK_API_KEY: config.apiKey,
    XAI_API_KEY: config.apiKey,
    GROK_BASE_URL: config.baseUrl,
    XAI_BASE_URL: config.baseUrl,
    GROK_MODEL: config.model,
    XAI_MODEL: config.model,
    GROK_API_STYLE: config.apiStyle,
    XAI_API_STYLE: config.apiStyle,
  };
}

function normalizeBridgeConfig(input = {}) {
  return {
    apiKey: typeof input.apiKey === "string" ? input.apiKey.trim() : "",
    baseUrl: normalizeBridgeBaseUrl(input.baseUrl || DEFAULT_GROK_BASE_URL),
    model: typeof input.model === "string" && input.model.trim() ? input.model.trim() : DEFAULT_GROK_MODEL,
    apiStyle: typeof input.apiStyle === "string" ? input.apiStyle.trim().toLowerCase() : "",
  };
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeBridgeBaseUrl(value) {
  const text = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_GROK_BASE_URL;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("protocol");
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    throw new Error("Grok API Base URL 格式无效。");
  }
}

function pickBridgeConfigInput(body = {}) {
  const result = {};
  if (Object.prototype.hasOwnProperty.call(body, "apiKey")) result.apiKey = String(body.apiKey || "");
  if (Object.prototype.hasOwnProperty.call(body, "baseUrl")) result.baseUrl = String(body.baseUrl || "");
  if (Object.prototype.hasOwnProperty.call(body, "model")) result.model = String(body.model || "");
  if (Object.prototype.hasOwnProperty.call(body, "apiStyle")) result.apiStyle = String(body.apiStyle || "");
  return result;
}

function publicBridgeConfig() {
  return {
    baseUrl: bridgeConfig.baseUrl,
    model: bridgeConfig.model,
    apiStyle: bridgeConfig.apiStyle,
    hasApiKey: Boolean(bridgeConfig.apiKey),
  };
}

async function readSavedBridgeConfig(file) {
  if (!file) return {};
  try {
    const text = await readFile(file, "utf8");
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

async function saveBridgeConfig(file, config) {
  if (!file) return;
  await mkdir(dirname(file), { recursive: true });
  const payload = {
    apiKey: config.apiKey || "",
    baseUrl: config.baseUrl || DEFAULT_GROK_BASE_URL,
    model: config.model || DEFAULT_GROK_MODEL,
    apiStyle: config.apiStyle || "",
    updatedAt: new Date().toISOString(),
  };
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function listMcpTools(mcpClient, options = {}) {
  const result = await mcpClient.request("tools/list");
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  return tools
    .map((tool) => {
      const id = typeof tool?.id === "string" && tool.id.trim()
        ? tool.id.trim()
        : typeof tool?.name === "string"
          ? tool.name.trim()
          : "";
      if (!id) return;
      return {
        id,
        name: typeof tool.name === "string" && tool.name.trim() ? tool.name.trim() : id,
        description: typeof tool.description === "string" ? tool.description : "",
        inputSchema: tool.inputSchema || tool.input_schema || { type: "object", additionalProperties: true },
        timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : undefined,
      };
    })
    .filter(Boolean);
}

class StdioMcpClient {
  #child;
  #buffer = Buffer.alloc(0);
  #nextId = 1;
  #pending = new Map();
  #initializePromise;
  #closed = false;

  constructor(options) {
    this.options = options;
    this.#child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.#child.stdout.on("data", (chunk) => this.#onStdout(chunk));
    this.#child.stderr.on("data", (chunk) => {
      process.stderr.write(`[grok-search-mcp] ${chunk}`);
    });
    this.#child.on("exit", (code, signal) => {
      this.#closed = true;
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Grok Search MCP server 已退出：${reason}`));
      }
      this.#pending.clear();
    });
    this.#child.on("error", (error) => {
      this.#closed = true;
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.#pending.clear();
    });
  }

  initialize() {
    if (!this.#initializePromise) {
      this.#initializePromise = this.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "moon-tab-grok-search-bridge",
          version: "1.0.0",
        },
      });
    }
    return this.#initializePromise;
  }

  async request(method, params = {}) {
    if (method !== "initialize") {
      await this.initialize();
    }
    if (this.#closed || !this.#child.stdin.writable) {
      throw new Error("Grok Search MCP server 未运行");
    }

    const id = this.#nextId++;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`MCP 请求超时：${method}`));
      }, this.options.timeoutMs);

      this.#pending.set(id, { resolve, reject, timer });
      this.#child.stdin.write(`${JSON.stringify(payload)}\n`, "utf8", (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      });
    });
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("MCP Bridge 已关闭"));
    }
    this.#pending.clear();
    this.#child.kill();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  #onStdout(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);

    while (this.#buffer.length > 0) {
      if (/^Content-Length:/i.test(this.#buffer.toString("ascii", 0, Math.min(this.#buffer.length, 32)))) {
        if (!this.#drainContentLengthMessage()) return;
        continue;
      }

      const newline = this.#buffer.indexOf(10);
      if (newline === -1) return;
      const line = this.#buffer.subarray(0, newline).toString("utf8").trim();
      this.#buffer = this.#buffer.subarray(newline + 1);
      if (line) this.#handleMessageText(line);
    }
  }

  #drainContentLengthMessage() {
    const crlfHeaderEnd = this.#buffer.indexOf(Buffer.from("\r\n\r\n"));
    const lfHeaderEnd = this.#buffer.indexOf(Buffer.from("\n\n"));
    const hasCrlfHeader = crlfHeaderEnd !== -1;
    const hasLfHeader = lfHeaderEnd !== -1;
    if (!hasCrlfHeader && !hasLfHeader) return false;

    const headerEnd = hasCrlfHeader && (!hasLfHeader || crlfHeaderEnd <= lfHeaderEnd)
      ? crlfHeaderEnd
      : lfHeaderEnd;
    const separatorLength = headerEnd === crlfHeaderEnd ? 4 : 2;
    const header = this.#buffer.subarray(0, headerEnd).toString("ascii");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      this.#buffer = this.#buffer.subarray(headerEnd + separatorLength);
      return true;
    }

    const bodyLength = Number(match[1]);
    const bodyStart = headerEnd + separatorLength;
    const bodyEnd = bodyStart + bodyLength;
    if (this.#buffer.length < bodyEnd) return false;

    const body = this.#buffer.subarray(bodyStart, bodyEnd).toString("utf8");
    this.#buffer = this.#buffer.subarray(bodyEnd);
    this.#handleMessageText(body);
    return true;
  }

  #handleMessageText(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch (error) {
      process.stderr.write(`[grok-search-mcp] 无法解析 stdout JSON：${error.message}\n${text}\n`);
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(message, "id")) return;
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    clearTimeout(pending.timer);

    if (message.error) {
      pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      return;
    }

    pending.resolve(message.result);
  }
}

function normalizeMcpContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (item?.type === "text" && typeof item.text === "string") return item.text;
      if (typeof item?.text === "string") return item.text;
      return JSON.stringify(item);
    })
    .filter(Boolean)
    .join("\n");
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
    const size = chunks.reduce((total, item) => total + item.length, 0);
    if (size > 1024 * 1024) {
      throw new Error("请求体过大");
    }
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("请求体不是合法 JSON");
  }
}

function writeJson(response, statusCode, payload) {
  setCorsHeaders(response);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type,Accept");
}

async function shutdown(exitCode) {
  await client?.close();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  process.exit(exitCode);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--help" || item === "-h") {
      result.help = true;
    } else if (item === "--list-tools-once") {
      result.listToolsOnce = true;
    } else if (item === "--server") {
      result.server = argv[++index];
    } else if (item === "--host") {
      result.host = argv[++index];
    } else if (item === "--port") {
      result.port = argv[++index];
    } else if (item === "--timeout-ms") {
      result.timeoutMs = argv[++index];
    } else if (item === "--model") {
      result.model = argv[++index];
    } else if (item === "--api-key") {
      result.apiKey = argv[++index];
    } else if (item === "--base-url") {
      result.baseUrl = argv[++index];
    } else if (item === "--api-style") {
      result.apiStyle = argv[++index];
    } else if (item === "--config-file") {
      result.configFile = argv[++index];
    }
  }
  return result;
}

function printHelp() {
  console.log(`用法：
  npm run mcp:grok-search
  node scripts/run_grok_search_mcp_bridge.mjs --server "D:\\novel\\2\\.claude-grok-search-mcp\\server.mjs"
  node scripts/run_grok_search_mcp_bridge.mjs --model "${DEFAULT_GROK_MODEL}"

环境变量：
  GROK_API_KEY / XAI_API_KEY                Grok/XAI API Key，实际搜索调用必需
  GROK_BASE_URL / XAI_BASE_URL              默认 ${DEFAULT_GROK_BASE_URL}
  GROK_MODEL / XAI_MODEL                    默认 ${DEFAULT_GROK_MODEL}
  GROK_API_STYLE / XAI_API_STYLE            可选，例如 chat
  GROK_SEARCH_MCP_MODEL                     仅给 Bridge 使用的默认模型
  GROK_SEARCH_MCP_SERVER_PATH               stdio MCP server.mjs 路径
  GROK_SEARCH_MCP_BRIDGE_CONFIG_FILE        Bridge 持久化配置文件，默认 ${DEFAULT_CONFIG_FILE}
  MCP_BRIDGE_HOST                           默认 127.0.0.1
  MCP_BRIDGE_PORT                           默认 17333
  MCP_BRIDGE_REQUEST_TIMEOUT_MS             默认 310000

接口：
  GET  /tools/list
  POST /tools/call  {"toolId":"grok_search","input":{"query":"..."}}
  GET  /config
  POST /config      {"apiKey":"...","baseUrl":"https://api.x.ai/v1","model":"${DEFAULT_GROK_MODEL}"}
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
