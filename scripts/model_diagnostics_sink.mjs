import { createServer } from "node:http";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_OUTPUT_DIR = resolve(PROJECT_ROOT, ".tmp");
const DEFAULT_PORT = Number.parseInt(process.env.MODEL_DIAGNOSTICS_PORT || "17334", 10);
const DEFAULT_HOST = process.env.MODEL_DIAGNOSTICS_HOST || "127.0.0.1";
const MAX_REQUEST_BYTES = Number.parseInt(process.env.MODEL_DIAGNOSTICS_MAX_BYTES || `${8 * 1024 * 1024}`, 10);
const MAX_RECORDS = Number.parseInt(process.env.MODEL_DIAGNOSTICS_MAX_RECORDS || "200", 10);

export function diagnosticsPaths(outputDir = DEFAULT_OUTPUT_DIR) {
  return {
    outputDir,
    json: resolve(outputDir, "model-diagnostics.json"),
    ndjson: resolve(outputDir, "model-diagnostics.ndjson"),
    readable: resolve(outputDir, "model-diagnostics-readable.md"),
  };
}

export function chatRequestLogPaths(outputDir = resolve(PROJECT_ROOT, ".tmp/chat-request-logs")) {
  return {
    outputDir,
    latestJson: resolve(outputDir, "latest.json"),
    latestMd: resolve(outputDir, "latest.md"),
    eventsNdjson: resolve(outputDir, "events.ndjson"),
    historyDir: resolve(outputDir, "history"),
  };
}

export async function resetDiagnostics(paths = diagnosticsPaths()) {
  await mkdir(paths.outputDir, { recursive: true });
  await Promise.all([
    writeFile(paths.json, "[]\n", "utf8"),
    writeFile(paths.readable, renderDiagnosticsMarkdown([]), "utf8"),
    rm(paths.ndjson, { force: true }),
  ]);
}

export async function handleDiagnosticRecord(record, options = {}) {
  const paths = options.paths || diagnosticsPaths(options.outputDir || DEFAULT_OUTPUT_DIR);
  await mkdir(paths.outputDir, { recursive: true });

  const normalized = normalizeDiagnosticRecord(record, options.now ?? Date.now());
  const records = await readJsonArray(paths.json);
  const nextRecords = upsertDiagnosticsRecord(records, normalized, options.maxRecords || MAX_RECORDS);

  await Promise.all([
    appendFile(paths.ndjson, `${JSON.stringify(normalized)}\n`, "utf8"),
    writeFile(paths.json, `${JSON.stringify(nextRecords, null, 2)}\n`, "utf8"),
    writeFile(paths.readable, renderDiagnosticsMarkdown(nextRecords), "utf8"),
  ]);

  return { record: normalized, count: nextRecords.length };
}

export function upsertDiagnosticsRecord(records, record, maxRecords = MAX_RECORDS) {
  const source = Array.isArray(records) ? records : [];
  const next = [...source];
  const id = typeof record?.id === "string" && record.id ? record.id : undefined;
  const index = id ? next.findIndex((item) => item?.id === id) : -1;
  if (index >= 0) {
    next[index] = mergeDiagnosticRecords(next[index], record);
  } else {
    next.push(record);
  }
  next.sort((a, b) => numberValue(a?.startedAt, a?.receivedAt) - numberValue(b?.startedAt, b?.receivedAt));
  return next.slice(Math.max(0, next.length - maxRecords));
}

export function renderDiagnosticsMarkdown(records) {
  const items = Array.isArray(records) ? records : [];
  const lines = ["# Model Diagnostics", ""];

  if (items.length === 0) {
    lines.push("暂无模型调用记录。", "");
    return lines.join("\n");
  }

  items.forEach((record, index) => {
    lines.push(...renderRecordMarkdown(record, index + 1), "");
  });

  return lines.join("\n");
}

export async function handleChatRequestLogEvent(event, options = {}) {
  const paths = options.paths || chatRequestLogPaths(options.outputDir);
  await mkdir(paths.outputDir, { recursive: true });
  await mkdir(paths.historyDir, { recursive: true });
  const normalized = normalizeChatEvent(event, options.now ?? Date.now());
  await appendFile(paths.eventsNdjson, `${JSON.stringify(normalized)}\n`, "utf8");

  const sessionPath = resolve(paths.historyDir, `${sanitizeRequestId(normalized.requestId)}.json`);
  const session = await readJsonObject(sessionPath, { requestId: normalized.requestId, events: [] });
  const nextSession = {
    ...session,
    requestId: session.requestId || normalized.requestId,
    events: [...(session.events || []), normalized],
    updatedAt: normalized.at,
  };

  if (normalized.type === "session_start") {
    nextSession.sidebarState = normalized.sidebarState ?? nextSession.sidebarState;
    nextSession.mode = normalized.mode ?? normalized.sidebarState?.mode ?? nextSession.mode;
    nextSession.systemPrompt = normalized.systemPrompt ?? normalized.sidebarState?.systemPrompt ?? nextSession.systemPrompt;
    if (normalized.exposedToolIds !== undefined) nextSession.exposedToolIds = normalized.exposedToolIds;
    if (normalized.enabledToolIds !== undefined) nextSession.enabledToolIds = normalized.enabledToolIds;
    if (normalized.mcpServers !== undefined) nextSession.mcpServers = normalized.mcpServers;
    if (normalized.sessionId !== undefined) nextSession.sessionId = normalized.sessionId;
    if (normalized.source !== undefined) nextSession.source = normalized.source;
  }
  if (normalized.type === "session_end") {
    if (normalized.status !== undefined) nextSession.status = normalized.status;
  }

  const markdown = renderChatSessionMarkdown(nextSession);
  await writeFile(sessionPath, `${JSON.stringify(nextSession, null, 2)}\n`, "utf8");
  await writeFile(resolve(paths.historyDir, `${sanitizeRequestId(normalized.requestId)}.md`), markdown, "utf8");
  await writeFile(paths.latestJson, `${JSON.stringify(nextSession, null, 2)}\n`, "utf8");
  await writeFile(paths.latestMd, markdown, "utf8");
  return { requestId: nextSession.requestId, eventCount: nextSession.events.length };
}

export function renderChatSessionMarkdown(session) {
  const value = session && typeof session === "object" ? session : {};
  const events = Array.isArray(value.events) ? value.events : [];
  const mode = value.mode ?? value.sidebarState?.mode;
  const systemPrompt = value.systemPrompt ?? value.sidebarState?.systemPrompt;
  const enabledToolIds = value.enabledToolIds ?? value.sidebarState?.enabledToolIds ?? [];
  const exposedToolIds = value.exposedToolIds ?? value.sidebarState?.exposedToolIds ?? [];
  const mcpServers = value.mcpServers ?? value.sidebarState?.mcpServers;

  const lines = [
    "# Chat Request Log",
    "",
    `- requestId: \`${value.requestId || "-"}\``,
    `- status: ${value.status || "in_progress"}`,
    `- updatedAt: ${formatDate(value.updatedAt)}`,
    value.sessionId ? `- sessionId: \`${value.sessionId}\`` : null,
    value.source ? `- source: ${value.source}` : null,
    "",
    "## 侧栏状态",
    "",
    `- mode: ${mode || "-"}`,
    `- enabledToolIds: ${formatList(enabledToolIds)}`,
    `- exposedToolIds: ${formatList(exposedToolIds)}`,
    `- mcpServers: ${formatJsonInline(mcpServers)}`,
    "",
    "### systemPrompt",
    "",
    "```text",
    truncate(String(systemPrompt ?? ""), 20000) || "(empty)",
    "```",
    "",
    "## 时间线",
    "",
  ].filter((line) => line !== null);

  if (events.length === 0) {
    lines.push("暂无事件。", "");
    return lines.join("\n");
  }

  events.forEach((event, index) => {
    lines.push(...renderChatEventMarkdown(event, index + 1), "");
  });

  return lines.join("\n");
}

export function createDiagnosticsServer(options = {}) {
  const host = options.host || DEFAULT_HOST;
  const port = Number.isFinite(options.port) ? options.port : DEFAULT_PORT;
  const paths = options.paths || diagnosticsPaths(options.outputDir || DEFAULT_OUTPUT_DIR);
  const chatPaths = options.chatPaths || chatRequestLogPaths(options.chatOutputDir);
  const maxBytes = options.maxBytes || MAX_REQUEST_BYTES;
  const maxRecords = options.maxRecords || MAX_RECORDS;

  const server = createServer(async (req, res) => {
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);

      if (req.method === "GET" && url.pathname === "/health") {
        writeJson(res, 200, { ok: true, service: "model-diagnostics", paths, chatPaths });
        return;
      }

      if (req.method === "GET" && url.pathname === "/model-diagnostics") {
        writeJson(res, 200, await readJsonArray(paths.json));
        return;
      }

      if (req.method === "GET" && url.pathname === "/model-diagnostics/readable") {
        const markdown = await readText(paths.readable, renderDiagnosticsMarkdown([]));
        res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
        res.end(markdown);
        return;
      }

      if (req.method === "POST" && url.pathname === "/model-diagnostics/reset") {
        await resetDiagnostics(paths);
        writeJson(res, 200, { ok: true, paths });
        return;
      }

      if (req.method === "POST" && url.pathname === "/model-diagnostics") {
        const text = await readRequestBody(req, maxBytes);
        const payload = JSON.parse(text || "{}");
        const result = await handleDiagnosticRecord(payload, { paths, maxRecords });
        writeJson(res, 200, { ok: true, count: result.count, id: result.record.id });
        return;
      }

      if (req.method === "GET" && url.pathname === "/chat-request-logs/latest") {
        writeJson(res, 200, await readJsonObject(chatPaths.latestJson, { events: [] }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/chat-request-logs") {
        const text = await readRequestBody(req, maxBytes);
        const payload = JSON.parse(text || "{}");
        const result = await handleChatRequestLogEvent(payload, { paths: chatPaths });
        writeJson(res, 200, { ok: true, requestId: result.requestId, eventCount: result.eventCount });
        return;
      }

      writeJson(res, 404, { ok: false, message: "not found" });
    } catch (error) {
      writeJson(res, 500, { ok: false, message: formatError(error) });
    }
  });

  return { server, host, port, paths, chatPaths };
}

async function readJsonArray(path) {
  try {
    const text = await readFile(path, "utf8");
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

async function readJsonObject(path, fallback = {}) {
  try {
    const text = await readFile(path, "utf8");
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

async function readText(path, fallback) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return fallback;
  }
}

function normalizeChatEvent(event, receivedAt) {
  const value = event && typeof event === "object" ? event : {};
  const at = typeof value.at === "number" && Number.isFinite(value.at) ? value.at : receivedAt;
  const requestId =
    typeof value.requestId === "string" && value.requestId.trim()
      ? value.requestId.trim()
      : `chat-${at}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    ...value,
    schemaVersion: value.schemaVersion === 1 ? 1 : 1,
    requestId,
    type: typeof value.type === "string" && value.type ? value.type : "unknown",
    at,
    atIso: typeof value.atIso === "string" && value.atIso ? value.atIso : new Date(at).toISOString(),
    receivedAt,
  };
}

function sanitizeRequestId(requestId) {
  const value = String(requestId || "unknown").trim() || "unknown";
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
}

function renderChatEventMarkdown(event, index) {
  const type = event?.type || "unknown";
  const lines = [
    `### ${index}. ${type}`,
    "",
    `- at: ${event?.atIso || formatDate(event?.at)}`,
  ];

  if (type === "session_start") {
    lines.push(`- mode: ${event?.mode ?? event?.sidebarState?.mode ?? "-"}`);
    lines.push(`- enabledToolIds: ${formatList(event?.enabledToolIds)}`);
    lines.push(`- exposedToolIds: ${formatList(event?.exposedToolIds)}`);
    if (event?.systemPrompt) {
      lines.push("", "```text", truncate(String(event.systemPrompt), 12000), "```");
    }
  } else if (type === "model_request") {
    const messages = Array.isArray(event?.messages) ? event.messages : [];
    lines.push(`- messages: ${messages.length}`);
    if (messages.length) {
      lines.push("", "```text", renderPromptMessages(messages.map((item) => ({
        role: item?.role || "message",
        content: messageContentToText(item?.content ?? item),
      }))), "```");
    }
    if (event?.tools !== undefined) {
      lines.push("", "<details><summary>tools</summary>", "", "```json", stringifyForMarkdown(event.tools), "```", "", "</details>");
    }
  } else if (type === "model_response") {
    lines.push(`- status: ${event?.status ?? "-"}`);
    if (event?.content !== undefined || event?.response !== undefined || event?.text !== undefined) {
      lines.push("", "```text", truncate(messageContentToText(event?.content ?? event?.text ?? event?.response), 12000), "```");
    } else if (event?.body !== undefined) {
      lines.push("", "```json", stringifyForMarkdown(event.body), "```");
    }
  } else if (type === "tool_call_start" || type === "tool_call_complete") {
    lines.push(`- tool: ${event?.toolName || event?.name || event?.toolId || "-"}`);
    if (event?.arguments !== undefined || event?.input !== undefined) {
      lines.push("", "```json", stringifyForMarkdown(event.arguments ?? event.input), "```");
    }
    if (event?.result !== undefined || event?.output !== undefined) {
      lines.push("", "```json", stringifyForMarkdown(event.result ?? event.output), "```");
    }
  } else if (type === "mcp_call" || type === "mcp_result") {
    lines.push(`- server: ${event?.serverName || event?.serverId || "-"}`);
    lines.push(`- tool: ${event?.toolName || event?.name || "-"}`);
    if (event?.arguments !== undefined || event?.input !== undefined) {
      lines.push("", "```json", stringifyForMarkdown(event.arguments ?? event.input), "```");
    }
    if (event?.result !== undefined || event?.output !== undefined) {
      lines.push("", "```json", stringifyForMarkdown(event.result ?? event.output), "```");
    }
  } else if (type === "session_end") {
    lines.push(`- status: ${event?.status ?? "-"}`);
    if (event?.errorMessage) lines.push(`- error: ${event.errorMessage}`);
  } else {
    lines.push("", "```json", stringifyForMarkdown(event), "```");
  }

  return lines;
}

function formatList(value) {
  if (!Array.isArray(value) || value.length === 0) return "-";
  return value.map((item) => String(item)).join(", ");
}

function formatJsonInline(value) {
  if (value === undefined) return "-";
  try {
    return truncate(JSON.stringify(value), 500);
  } catch {
    return String(value);
  }
}

function normalizeDiagnosticRecord(record, receivedAt) {
  const value = record && typeof record === "object" ? record : {};
  return {
    ...value,
    id: typeof value.id === "string" && value.id ? value.id : `model-${receivedAt}-${Math.random().toString(36).slice(2, 8)}`,
    kind: typeof value.kind === "string" && value.kind ? value.kind : "model-call",
    status: typeof value.status === "string" && value.status ? value.status : "unknown",
    receivedAt,
  };
}

function mergeDiagnosticRecords(previous, next) {
  return {
    ...previous,
    ...next,
    request: next.request ?? previous.request,
    response: next.response ?? previous.response,
    errorMessage: next.errorMessage ?? previous.errorMessage,
    promptSummary: next.promptSummary ?? previous.promptSummary,
    responseSummary: next.responseSummary ?? previous.responseSummary,
    receivedAt: next.receivedAt ?? previous.receivedAt,
  };
}

function renderRecordMarkdown(record, index) {
  const request = record?.request || {};
  const response = record?.response || {};
  const body = request.body;
  const messages = extractPromptMessages(body);
  const tools = extractToolSummaries(body);
  const title = `${index}. ${record?.model || body?.model || "unknown-model"} · ${record?.status || "unknown"}`;
  const lines = [
    `## ${title}`,
    "",
    `- id: \`${record?.id || ""}\``,
    `- time: ${formatDate(record?.startedAt || record?.receivedAt)}`,
    `- duration: ${typeof record?.durationMs === "number" ? `${record.durationMs}ms` : "-"}`,
    `- endpoint: ${request.method || ""} ${request.url || ""}`.trim(),
    `- http: ${formatHttp(response)}`,
    `- prompt: ${record?.promptSummary || summarizePrompt(messages, tools) || "-"}`,
    `- response summary: ${record?.responseSummary || summarizeResponse(response.body) || record?.errorMessage || "-"}`,
  ];

  if (record?.errorMessage) {
    lines.push(`- error: ${record.errorMessage}`);
  }

  lines.push("");

  if (messages.length) {
    lines.push("<details><summary>提示词 / messages</summary>", "", "```text", renderPromptMessages(messages), "```", "", "</details>", "");
  }

  if (tools.length) {
    lines.push("<details><summary>工具定义摘要</summary>", "", "```text", renderToolSummaries(tools), "```", "", "</details>", "");
  }

  lines.push(
    "<details><summary>完整请求体</summary>",
    "",
    "```json",
    stringifyForMarkdown(body ?? request.bodyText ?? request),
    "```",
    "",
    "</details>",
    "",
    "<details><summary>模型原始返回</summary>",
    "",
    response.body === undefined && response.bodyText === undefined && !record?.errorMessage ? "```text\n暂无返回。\n```" : "```json",
  );

  if (response.body !== undefined || response.bodyText !== undefined || record?.errorMessage) {
    lines.push(stringifyForMarkdown(response.body ?? response.bodyText ?? { errorMessage: record.errorMessage }), "```");
  }

  lines.push("", "</details>");
  return lines;
}

function extractPromptMessages(body) {
  if (!body || typeof body !== "object") return [];
  const messages = [];

  if (typeof body.system === "string") {
    messages.push({ role: "system", content: body.system });
  }

  if (Array.isArray(body.messages)) {
    for (const item of body.messages) {
      messages.push({ role: item?.role || "message", content: messageContentToText(item?.content) });
    }
    return messages;
  }

  if (typeof body.input === "string") {
    messages.push({ role: "user", content: body.input });
    return messages;
  }

  if (Array.isArray(body.input)) {
    for (const item of body.input) {
      messages.push({ role: item?.role || item?.type || "input", content: messageContentToText(item?.content ?? item) });
    }
    return messages;
  }

  if (Array.isArray(body.contents)) {
    for (const item of body.contents) {
      messages.push({ role: item?.role || "content", content: messageContentToText(item?.parts ?? item?.content ?? item) });
    }
  }

  return messages;
}

function messageContentToText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (typeof content === "number" || typeof content === "boolean") return String(content);
  if (Array.isArray(content)) {
    return content.map((item) => messageContentToText(item)).filter(Boolean).join("\n");
  }
  if (typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.input_text === "string") return content.input_text;
    if (typeof content.output_text === "string") return content.output_text;
    if (typeof content.content === "string") return content.content;
    if (typeof content.image_url === "string" || typeof content.data === "string" || content.inline_data) return `[${content.type || "media"}]`;
    if (Array.isArray(content.parts)) return messageContentToText(content.parts);
    return truncate(JSON.stringify(content), 2000);
  }
  return String(content);
}

function extractToolSummaries(body) {
  if (!body || typeof body !== "object") return [];
  const tools = [];

  if (Array.isArray(body.tools)) {
    for (const tool of body.tools) {
      if (tool?.type === "function" && tool.function) {
        tools.push(toolSummary(tool.function.name, tool.function.description, tool.function.parameters));
      } else if (tool?.name || tool?.description || tool?.input_schema) {
        tools.push(toolSummary(tool.name, tool.description, tool.input_schema));
      } else if (Array.isArray(tool?.function_declarations)) {
        for (const fn of tool.function_declarations) {
          tools.push(toolSummary(fn.name, fn.description, fn.parameters));
        }
      } else {
        tools.push(toolSummary(tool?.type || "tool", undefined, tool));
      }
    }
  }

  if (Array.isArray(body.functions)) {
    for (const fn of body.functions) {
      tools.push(toolSummary(fn?.name, fn?.description, fn?.parameters));
    }
  }

  return tools.filter(Boolean);
}

function toolSummary(name, description, schema) {
  return {
    name: name || "未命名工具",
    description: description || "",
    schemaKeys: schema && typeof schema === "object" ? Object.keys(schema).slice(0, 12) : [],
    required: Array.isArray(schema?.required) ? schema.required : [],
  };
}

function renderPromptMessages(messages) {
  return messages.map((message, index) => `[${index + 1}] ${message.role}\n${truncate(message.content, 12000)}`).join("\n\n---\n\n");
}

function renderToolSummaries(tools) {
  return tools.map((tool, index) => {
    const lines = [`[${index + 1}] ${tool.name}`];
    if (tool.description) lines.push(`description: ${truncate(tool.description, 1000)}`);
    if (tool.schemaKeys.length) lines.push(`schema keys: ${tool.schemaKeys.join(", ")}`);
    if (tool.required.length) lines.push(`required: ${tool.required.join(", ")}`);
    return lines.join("\n");
  }).join("\n\n---\n\n");
}

function summarizePrompt(messages, tools) {
  const roles = messages.map((item) => item.role).filter(Boolean);
  const messagePart = messages.length ? `${messages.length} 条消息${roles.length ? `（${roles.join(" → ")}）` : ""}` : "";
  const toolPart = tools.length ? `工具 ${tools.length} 个` : "";
  return [messagePart, toolPart].filter(Boolean).join("，");
}

function summarizeResponse(body) {
  if (!body || typeof body !== "object") return "";
  const message = Array.isArray(body.choices) ? body.choices[0]?.message : undefined;
  if (typeof message?.content === "string") return truncate(message.content, 700);
  if (Array.isArray(message?.tool_calls)) return `模型返回 ${message.tool_calls.length} 个工具调用。`;
  if (typeof body.content === "string") return truncate(body.content, 700);
  if (Array.isArray(body.content)) return truncate(messageContentToText(body.content), 700);
  return "";
}

function stringifyForMarkdown(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return truncate(text || "", 120000);
}

function formatHttp(response) {
  if (!response || typeof response !== "object" || response.status === undefined) return "-";
  return `${response.status} ${response.statusText || ""}`.trim();
}

function formatDate(value) {
  return typeof value === "number" ? new Date(value).toISOString() : "-";
}

function numberValue(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function truncate(text, limit) {
  const value = String(text ?? "");
  return value.length <= limit ? value : `${value.slice(0, limit)}…[已截断]`;
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(payload)}\n`);
}

function readRequestBody(req, maxBytes) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error(`request body too large: ${size} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function formatError(error) {
  return error instanceof Error && error.message ? error.message : String(error);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server, host, port, paths, chatPaths } = createDiagnosticsServer();
  await mkdir(paths.outputDir, { recursive: true });
  await mkdir(chatPaths.outputDir, { recursive: true });
  await mkdir(chatPaths.historyDir, { recursive: true });
  server.listen(port, host, () => {
    console.log(`模型调用诊断服务已启动：http://${host}:${port}`);
    console.log(`JSON: ${paths.json}`);
    console.log(`NDJSON: ${paths.ndjson}`);
    console.log(`Readable: ${paths.readable}`);
    console.log(`Chat logs: ${chatPaths.outputDir}`);
    console.log(`Chat latest: ${chatPaths.latestMd}`);
    console.log("按 Ctrl+C 停止。扩展未连接时服务会保持空闲等待。");
  });
  server.on("error", (error) => {
    console.error(`模型调用诊断服务启动失败：${formatError(error)}`);
    process.exitCode = 1;
  });
}
