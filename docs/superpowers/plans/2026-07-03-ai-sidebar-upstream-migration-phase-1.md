# AI Sidebar Upstream Migration Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve Moon Tab while migrating the first phase of upstream Browser AI Assistant capabilities: generic Tools/MCP center, MCP server management, audit visibility, token usage normalization, notifications, and grouped model selection.

**Architecture:** Keep the existing no-build MV3 extension and do not overwrite `src/ai-assistant/sidePanel.js`. Add source-owned shared modules under `src/shared/`, move new background behavior behind small service modules imported by `src/ai-assistant/background/index.js`, and keep the side-panel UI integration in the existing DOM adapter files.

**Tech Stack:** Chrome MV3, PowerShell, plain ESM JavaScript, Node `assert` tests, existing Python/Playwright smoke scripts, `chrome.storage.local`, existing bundled side-panel integration layer.

---

## Scope Guard

This plan implements only phase 1 from `docs/superpowers/specs/2026-07-03-ai-sidebar-upstream-migration-design.md`.

Do not implement Playbook, `browser.extract_content`, debugger-backed Network recorder, `js.*`, `sourcemap.*`, `runtime.*`, `replay.*`, `full_access.*`, or a React/TypeScript/Vite rewrite in this plan.

The worktree is already dirty. Do not revert unrelated files. Each task commit must stage only files listed in that task.

## File Structure

Create:

- `src/shared/mcp-settings.mjs`
  Owns generic MCP server config normalization, server id generation, bearer token key naming, and old Grok config migration helpers.

- `src/shared/mcp-http-client.mjs`
  Owns MCP HTTP/Streamable HTTP JSON-RPC calls: `initialize`, `tools/list`, `tools/call`, timeout, JSON/SSE response parsing.

- `src/shared/mcp-tool-adapter.mjs`
  Owns stable MCP tool ids, model-callable function names, collision handling, and conversion to assistant tool definitions.

- `src/shared/token-usage.mjs`
  Owns usage normalization for OpenAI-compatible, DeepSeek, and Anthropic responses plus session usage aggregation.

- `src/shared/agent-tool-audit.mjs`
  Owns audit record creation, sensitive-field redaction, result summarization, and max-log slicing.

- `src/ai-assistant/background/agent-tools-service.js`
  Owns `agentTools.*` message handling, settings persistence, MCP refresh/call, audit persistence, and Grok compatibility.

- `src/ai-assistant/notification-host.js`
  Owns a small DOM notification host for side-panel adapter actions.

- `scripts/test_mcp_settings.mjs`
  Tests MCP settings normalization and Grok compatibility.

- `scripts/test_mcp_http_client.mjs`
  Tests MCP JSON-RPC and SSE parsing behavior.

- `scripts/test_mcp_tool_adapter.mjs`
  Tests stable ids, safe model names, and collisions.

- `scripts/test_token_usage.mjs`
  Tests token usage normalization and aggregation.

- `scripts/test_agent_tool_audit.mjs`
  Tests audit redaction and log slicing.

Modify:

- `src/shared/agent-tool-registry.mjs`
  Keep `ToolRegistry` and `ToolActionQueue`, but delegate MCP-specific adapter behavior to `mcp-tool-adapter.mjs` or keep a backward-compatible wrapper.

- `src/ai-assistant/background/index.js`
  Import and route `agentTools.*` handling through `agent-tools-service.js`. Preserve existing imagefree and browser-control behavior.

- `src/ai-assistant/agent-tools-dialog.js`
  Replace Grok-only UI with a generic Tools/MCP center: Server management, discovered tools, audit log, Grok preset.

- `src/ai-assistant/sidePanel-layout.js`
  Add model grouping adapter and optional token meter mount only through DOM enhancement hooks.

- `src/ai-assistant/sidePanel-layout.css`
  Add styles for generic Tools/MCP sections, audit log, notifications, token meter, and grouped model menu.

- `src/ai-assistant/index.html`
  Load `notification-host.js` before `sidePanel-layout.js`.

- `scripts/test_tool_registry.mjs`
  Update expectations for generic MCP conversion and keep backward compatibility coverage.

- `scripts/test_background_agent_tools_wiring.mjs`
  Replace assertions that expect removed advanced controls with assertions for generic Tools/MCP, audit, and Grok preset.

- `scripts/run_unit_tests.mjs`
  Add the new Node test scripts.

- `README.md` and `docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md`
  Document generic MCP center, Grok preset compatibility, audit, and phase boundaries.

## Implementation Notes

- Use `apply_patch` for manual edits.
- Use PowerShell commands. Do not use bash heredoc.
- Git commit messages must be Chinese.
- Do not use `git checkout --`, `git reset --hard`, or other destructive commands.
- Before each commit, run `git diff --cached --name-status` and confirm only task files are staged.

---

### Task 1: MCP Settings Model

**Files:**
- Create: `src/shared/mcp-settings.mjs`
- Create: `scripts/test_mcp_settings.mjs`
- Modify: `scripts/run_unit_tests.mjs`

- [ ] **Step 1: Write the failing MCP settings test**

Create `scripts/test_mcp_settings.mjs` with:

```js
import assert from "node:assert/strict";
import {
  DEFAULT_MCP_SETTINGS,
  MCP_BEARER_TOKEN_SETTING_PREFIX,
  createMcpBearerTokenSettingKey,
  createMcpServerId,
  migrateLegacyGrokMcpSettings,
  normalizeMcpSettings,
} from "../src/shared/mcp-settings.mjs";

assert.deepEqual(normalizeMcpSettings(undefined), DEFAULT_MCP_SETTINGS);

const normalized = normalizeMcpSettings({
  servers: [
    {
      id: " Main.Server ",
      name: " Main MCP ",
      endpointUrl: " http://127.0.0.1:17333/mcp ",
      enabled: true,
      tools: [
        {
          name: " search.web ",
          description: " Search ",
          inputSchema: { type: "object", properties: { query: { type: "string" } } },
        },
        { name: "", description: "invalid" },
      ],
      lastRefreshAt: 123,
      lastRefreshError: " old ",
    },
  ],
});

assert.equal(normalized.servers.length, 1);
assert.equal(normalized.servers[0].id, "Main.Server");
assert.equal(normalized.servers[0].name, "Main MCP");
assert.equal(normalized.servers[0].endpointUrl, "http://127.0.0.1:17333/mcp");
assert.equal(normalized.servers[0].enabled, true);
assert.equal(normalized.servers[0].tools.length, 1);
assert.equal(normalized.servers[0].tools[0].name, "search.web");
assert.equal(normalized.servers[0].lastRefreshAt, 123);
assert.equal(normalized.servers[0].lastRefreshError, "old");

assert.equal(createMcpBearerTokenSettingKey("Main.Server"), `${MCP_BEARER_TOKEN_SETTING_PREFIX}Main.Server`);
assert.equal(createMcpServerId("Grok Search", "http://127.0.0.1:17333/"), "grok-search-127-0-0-1-17333");
assert.equal(createMcpServerId("", "http://localhost:3000/mcp"), "mcp-localhost-3000");

const migrated = migrateLegacyGrokMcpSettings({
  enabled: true,
  baseUrl: "http://127.0.0.1:17333/",
  exposeToChat: true,
  grokApiKey: "xai-secret",
  grokBaseUrl: "https://api.x.ai/v1",
  grokModel: "grok-4.20-multi-agent-xhigh",
});

assert.equal(migrated.settings.servers.length, 1);
assert.equal(migrated.settings.servers[0].name, "Grok 搜索");
assert.equal(migrated.settings.servers[0].enabled, true);
assert.equal(migrated.settings.servers[0].endpointUrl, "http://127.0.0.1:17333/");
assert.equal(migrated.legacyGrok.grokApiKey, "xai-secret");
assert.equal(migrated.legacyGrok.grokBaseUrl, "https://api.x.ai/v1");
assert.equal(migrated.legacyGrok.grokModel, "grok-4.20-multi-agent-xhigh");

console.log("mcp settings tests passed");
```

- [ ] **Step 2: Add the test command to the unit runner**

Modify `scripts/run_unit_tests.mjs` by inserting this command immediately after `scripts/test_tool_registry.mjs`:

```js
["node", ["scripts/test_mcp_settings.mjs"]],
```

- [ ] **Step 3: Run the new test and verify it fails**

Run:

```powershell
node scripts/test_mcp_settings.mjs
```

Expected: FAIL with `Cannot find module` for `src/shared/mcp-settings.mjs`.

- [ ] **Step 4: Implement `mcp-settings.mjs`**

Create `src/shared/mcp-settings.mjs` with:

```js
export const MCP_SETTINGS_KEY = "aiSidebar.mcpSettings.v1";
export const MCP_BEARER_TOKEN_SETTING_PREFIX = "mcpBearerToken:";

export const DEFAULT_GROK_MCP_BRIDGE_URL = "http://127.0.0.1:17333/";
export const DEFAULT_GROK_API_BASE_URL = "https://api.x.ai/v1";
export const DEFAULT_GROK_MODEL = "grok-4.20-multi-agent-xhigh";

export const DEFAULT_MCP_SETTINGS = Object.freeze({
  servers: Object.freeze([]),
});

const normalizeText = (value) => (typeof value === "string" ? value.trim() : "");

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const normalizeHttpUrl = (value) => {
  const text = normalizeText(value);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
};

const normalizeTimestamp = (value) => {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : 0;
};

const normalizeInputSchema = (value) =>
  isRecord(value) ? value : { type: "object", additionalProperties: true };

const normalizeMcpTool = (value) => {
  if (!isRecord(value)) return undefined;
  const name = normalizeText(value.name);
  if (!name) return undefined;
  return {
    name,
    description: normalizeText(value.description),
    inputSchema: normalizeInputSchema(value.inputSchema),
    disabledReason: normalizeText(value.disabledReason),
  };
};

const normalizeMcpServer = (value) => {
  if (!isRecord(value)) return undefined;
  const endpointUrl = normalizeHttpUrl(value.endpointUrl);
  if (!endpointUrl) return undefined;
  const name = normalizeText(value.name) || "MCP Server";
  const id = normalizeText(value.id) || createMcpServerId(name, endpointUrl);
  return {
    id,
    name,
    endpointUrl,
    enabled: value.enabled !== false,
    tools: Array.isArray(value.tools) ? value.tools.map(normalizeMcpTool).filter(Boolean) : [],
    lastRefreshAt: normalizeTimestamp(value.lastRefreshAt),
    lastRefreshError: normalizeText(value.lastRefreshError),
  };
};

export function normalizeMcpSettings(value) {
  if (!isRecord(value) || !Array.isArray(value.servers)) {
    return { servers: [] };
  }

  const seenIds = new Set();
  const servers = [];
  for (const rawServer of value.servers) {
    const server = normalizeMcpServer(rawServer);
    if (!server || seenIds.has(server.id)) continue;
    seenIds.add(server.id);
    servers.push(server);
  }

  return { servers };
}

export function createMcpBearerTokenSettingKey(serverId) {
  return `${MCP_BEARER_TOKEN_SETTING_PREFIX}${normalizeText(serverId)}`;
}

export function createMcpServerId(name, endpointUrl) {
  const label = normalizeText(name) || "mcp";
  let host = "server";
  try {
    const url = new URL(normalizeText(endpointUrl));
    host = `${url.hostname}-${url.port || (url.protocol === "https:" ? "443" : "80")}`;
  } catch {
    host = "server";
  }
  const slug = `${label}-${host}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || `mcp-${Date.now()}`;
}

export function migrateLegacyGrokMcpSettings(legacyMcp) {
  const source = isRecord(legacyMcp) ? legacyMcp : {};
  const endpointUrl = normalizeHttpUrl(source.baseUrl) || DEFAULT_GROK_MCP_BRIDGE_URL;
  const server = {
    id: createMcpServerId("Grok 搜索", endpointUrl),
    name: "Grok 搜索",
    endpointUrl,
    enabled: source.enabled === true,
    tools: [],
    lastRefreshAt: 0,
    lastRefreshError: "",
  };

  return {
    settings: { servers: [server] },
    legacyGrok: {
      enabled: source.enabled === true,
      exposeToChat: source.exposeToChat === true,
      grokApiKey: normalizeText(source.grokApiKey),
      grokBaseUrl: normalizeHttpUrl(source.grokBaseUrl) || DEFAULT_GROK_API_BASE_URL,
      grokModel: normalizeText(source.grokModel) || DEFAULT_GROK_MODEL,
      grokApiStyle: normalizeText(source.grokApiStyle).toLowerCase(),
    },
  };
}
```

- [ ] **Step 5: Run the MCP settings test**

Run:

```powershell
node scripts/test_mcp_settings.mjs
```

Expected: `mcp settings tests passed`.

- [ ] **Step 6: Commit Task 1**

Run:

```powershell
git add -- src/shared/mcp-settings.mjs scripts/test_mcp_settings.mjs scripts/run_unit_tests.mjs
git diff --cached --name-status
git commit -m "feat: 增加通用 MCP 设置模型"
```

Expected staged files:

```text
A	src/shared/mcp-settings.mjs
A	scripts/test_mcp_settings.mjs
M	scripts/run_unit_tests.mjs
```

---

### Task 2: MCP HTTP Client and Tool Adapter

**Files:**
- Create: `src/shared/mcp-http-client.mjs`
- Create: `src/shared/mcp-tool-adapter.mjs`
- Create: `scripts/test_mcp_http_client.mjs`
- Create: `scripts/test_mcp_tool_adapter.mjs`
- Modify: `src/shared/agent-tool-registry.mjs`
- Modify: `scripts/test_tool_registry.mjs`
- Modify: `scripts/run_unit_tests.mjs`

- [ ] **Step 1: Write the failing MCP HTTP client test**

Create `scripts/test_mcp_http_client.mjs` with:

```js
import assert from "node:assert/strict";
import { callMcpTool, listMcpTools } from "../src/shared/mcp-http-client.mjs";

const requests = [];
const fetcher = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : {};
  requests.push({ url, init, body });
  if (body.method === "initialize") {
    return {
      ok: true,
      headers: new Map([["mcp-session-id", "session-1"]]),
      json: async () => ({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26" } }),
      text: async () => "",
    };
  }
  if (body.method === "tools/list") {
    return {
      ok: true,
      headers: new Map(),
      json: async () => ({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          tools: [
            { name: "search.web", description: "Search", inputSchema: { type: "object" } },
          ],
        },
      }),
      text: async () => "",
    };
  }
  if (body.method === "tools/call") {
    return {
      ok: true,
      headers: new Map(),
      json: async () => ({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: `result:${body.params.arguments.query}` }] },
      }),
      text: async () => "",
    };
  }
  throw new Error(`unexpected ${body.method}`);
};

const server = {
  id: "main",
  name: "Main",
  endpointUrl: "http://127.0.0.1:17333/mcp",
  enabled: true,
  tools: [],
};

const tools = await listMcpTools({ server, bearerToken: "secret", fetcher });
assert.equal(tools.length, 1);
assert.equal(tools[0].name, "search.web");
assert.equal(requests[0].init.headers.Authorization, "Bearer secret");
assert.equal(requests[1].init.headers["Mcp-Session-Id"], "session-1");

const content = await callMcpTool({
  server,
  bearerToken: "secret",
  toolName: "search.web",
  arguments: { query: "moon" },
  fetcher,
});
assert.equal(content, "result:moon");

const sseFetcher = async (_url, init = {}) => {
  const body = JSON.parse(init.body);
  if (body.method === "initialize") {
    return {
      ok: true,
      headers: new Map(),
      json: async () => ({ jsonrpc: "2.0", id: body.id, result: {} }),
      text: async () => "",
    };
  }
  return {
    ok: true,
    headers: new Map(),
    json: async () => {
      throw new Error("not json");
    },
    text: async () => `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } })}\n\n`,
  };
};

assert.deepEqual(await listMcpTools({ server, fetcher: sseFetcher }), []);

console.log("mcp http client tests passed");
```

- [ ] **Step 2: Write the failing MCP tool adapter test**

Create `scripts/test_mcp_tool_adapter.mjs` with:

```js
import assert from "node:assert/strict";
import {
  MODEL_TOOL_GROUP_MCP_REMOTE_ID,
  createMcpToolId,
  createMcpToolName,
  createMcpToolRegistryEntries,
  parseMcpToolId,
} from "../src/shared/mcp-tool-adapter.mjs";

const id = createMcpToolId("server.with.dot", "search.web");
assert.equal(id, "mcp.server%2Ewith%2Edot.search.web");
assert.deepEqual(parseMcpToolId(id), { serverId: "server.with.dot", toolName: "search.web" });

assert.equal(createMcpToolName("Grok Search", "search.web"), "mcp_grok_search_search_web");
assert.match(createMcpToolName("中文", "搜索"), /^mcp_tool_[a-z0-9]+$/);

const entries = createMcpToolRegistryEntries([
  {
    id: "server.one",
    name: "Server One",
    enabled: true,
    endpointUrl: "http://127.0.0.1:17333/",
    tools: [
      { name: "search", description: "Search", inputSchema: { type: "object" } },
      { name: "disabled", disabledReason: "off", inputSchema: { type: "object" } },
    ],
  },
  {
    id: "server.two",
    name: "Server Two",
    enabled: false,
    endpointUrl: "http://127.0.0.1:17334/",
    tools: [{ name: "search", inputSchema: { type: "object" } }],
  },
]);

assert.equal(entries.length, 1);
assert.equal(entries[0].groupId, MODEL_TOOL_GROUP_MCP_REMOTE_ID);
assert.equal(entries[0].toolClassification.runtime, "mcp_remote");
assert.equal(entries[0].metadata.serverId, "server.one");
assert.equal(entries[0].metadata.toolName, "search");

console.log("mcp tool adapter tests passed");
```

- [ ] **Step 3: Add test commands to the unit runner**

Modify `scripts/run_unit_tests.mjs` by inserting after `scripts/test_mcp_settings.mjs`:

```js
["node", ["scripts/test_mcp_http_client.mjs"]],
["node", ["scripts/test_mcp_tool_adapter.mjs"]],
```

- [ ] **Step 4: Run the new tests and verify they fail**

Run:

```powershell
node scripts/test_mcp_http_client.mjs
node scripts/test_mcp_tool_adapter.mjs
```

Expected: both fail with `Cannot find module`.

- [ ] **Step 5: Implement `mcp-http-client.mjs`**

Create `src/shared/mcp-http-client.mjs` with:

```js
const DEFAULT_MCP_REQUEST_TIMEOUT_MS = 30000;
const JSON_RPC_VERSION = "2.0";

const getHeader = (headers, name) => {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get(name) ?? headers.get(name.toLowerCase()) ?? undefined;
  return headers[name] ?? headers[name.toLowerCase()];
};

const truncateText = (value, maxLength = 12000) => {
  const text = String(value ?? "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...[已截断]`;
};

const createHeaders = (bearerToken, sessionId) => ({
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
  ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
  ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
});

async function withTimeout(run, timeoutMs = DEFAULT_MCP_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("MCP 请求超时");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readJsonRpcResponse(response) {
  try {
    const payload = await response.json();
    if (payload && typeof payload === "object") return payload;
  } catch {
    const text = await response.text();
    return parseSseJsonRpcResponse(text);
  }
  throw new Error("MCP 响应格式无效");
}

export function parseSseJsonRpcResponse(text) {
  const dataLines = String(text ?? "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  for (const line of dataLines) {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === "object" && ("result" in parsed || "error" in parsed)) {
      return parsed;
    }
  }
  throw new Error("MCP SSE 响应格式无效");
}

async function sendMcpRequest(input, method, params, sessionId) {
  const fetcher = input.fetcher ?? fetch;
  if (typeof fetcher !== "function") throw new Error("当前环境缺少 fetch，无法连接 MCP Server");
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await withTimeout(
    (signal) => fetcher(input.server.endpointUrl, {
      method: "POST",
      headers: createHeaders(input.bearerToken, sessionId),
      body: JSON.stringify({ jsonrpc: JSON_RPC_VERSION, id, method, ...(params ? { params } : {}) }),
      signal,
    }),
    input.timeoutMs,
  );
  if (!response.ok) throw new Error(`MCP 请求失败：${response.status} ${response.statusText ?? ""}`.trim());
  const payload = await readJsonRpcResponse(response);
  if (payload.error) throw new Error(`MCP 请求失败：${payload.error.message || payload.error.code || "远端返回错误"}`);
  return {
    result: payload.result,
    sessionId: getHeader(response.headers, "Mcp-Session-Id") ?? sessionId,
  };
}

async function initializeMcpSession(input) {
  const response = await sendMcpRequest(input, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "moon-tab-extension", version: "mcp-tools-phase-1" },
  });
  return {
    protocolVersion: response.result?.protocolVersion,
    sessionId: response.sessionId,
  };
}

const normalizeTool = (value) => {
  if (!value || typeof value !== "object" || typeof value.name !== "string" || !value.name.trim()) return undefined;
  return {
    name: value.name.trim(),
    description: typeof value.description === "string" ? value.description.trim() : "",
    inputSchema: value.inputSchema && typeof value.inputSchema === "object"
      ? value.inputSchema
      : { type: "object", additionalProperties: true },
    disabledReason: "",
  };
};

export async function listMcpTools(input) {
  const session = await initializeMcpSession(input);
  const response = await sendMcpRequest(input, "tools/list", undefined, session.sessionId);
  const tools = Array.isArray(response.result?.tools) ? response.result.tools : [];
  return tools.map(normalizeTool).filter(Boolean);
}

export async function callMcpTool(input) {
  const session = await initializeMcpSession(input);
  const response = await sendMcpRequest(input, "tools/call", {
    name: input.toolName,
    arguments: input.arguments ?? {},
  }, session.sessionId);
  return formatMcpToolResult(response.result);
}

function formatMcpToolResult(result) {
  if (!result || typeof result !== "object") return "MCP 工具已返回空结果";
  if (typeof result.content === "string") return truncateText(result.content);
  if (Array.isArray(result.content)) {
    const text = result.content.map(formatMcpContentBlock).filter(Boolean).join("\n");
    return truncateText(text || "MCP 工具已返回空结果");
  }
  return truncateText(JSON.stringify(result, null, 2));
}

function formatMcpContentBlock(value) {
  if (!value || typeof value !== "object") return "";
  if (value.type === "text" && typeof value.text === "string") return value.text;
  if (value.type === "resource" && value.resource) return JSON.stringify(value.resource, null, 2);
  return JSON.stringify(value);
}
```

- [ ] **Step 6: Implement `mcp-tool-adapter.mjs`**

Create `src/shared/mcp-tool-adapter.mjs` with:

```js
export const MODEL_TOOL_GROUP_MCP_REMOTE_ID = "mcp_remote";

const MODEL_TOOL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

export function createMcpToolId(serverId, toolName) {
  return `mcp.${encodeMcpToolIdPart(serverId)}.${encodeURIComponent(String(toolName ?? "").trim())}`;
}

export function parseMcpToolId(toolId) {
  const match = String(toolId ?? "").match(/^mcp\.([^.]+)\.(.+)$/);
  if (!match) return undefined;
  return {
    serverId: decodeMcpToolIdPart(match[1]),
    toolName: decodeURIComponent(match[2]),
  };
}

export function createMcpToolName(serverId, toolName, usedNames = new Set()) {
  const normalized = `mcp_${serverId}_${toolName}`
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  const baseName = MODEL_TOOL_NAME_PATTERN.test(normalized) ? normalized : `mcp_tool_${hashText(`${serverId}:${toolName}`)}`;
  return createCollisionSafeName(baseName, `${serverId}:${toolName}`, usedNames);
}

export function createMcpToolRegistryEntries(servers) {
  const usedNames = new Set();
  const entries = [];
  for (const server of Array.isArray(servers) ? servers : []) {
    if (!server?.enabled) continue;
    for (const tool of Array.isArray(server.tools) ? server.tools : []) {
      if (!tool?.name || tool.disabledReason) continue;
      entries.push({
        id: createMcpToolId(server.id, tool.name),
        name: createMcpToolName(server.id, tool.name, usedNames),
        displayName: `${server.name}.${tool.name}`,
        groupId: MODEL_TOOL_GROUP_MCP_REMOTE_ID,
        description: tool.description || `调用 MCP Server「${server.name}」提供的工具 ${tool.name}`,
        parameters: isValidInputSchema(tool.inputSchema) ? tool.inputSchema : { type: "object", additionalProperties: true },
        metadata: { serverId: server.id, toolName: tool.name },
        toolClassification: {
          runtime: "mcp_remote",
          capabilities: ["external_tool"],
          risk: "external",
        },
      });
    }
  }
  return entries;
}

export function isMcpToolId(toolId) {
  return Boolean(parseMcpToolId(toolId));
}

function encodeMcpToolIdPart(value) {
  return encodeURIComponent(String(value ?? "").trim()).replace(/\./g, "%2E");
}

function decodeMcpToolIdPart(value) {
  return decodeURIComponent(String(value ?? "").replace(/%2e/gi, "%2E"));
}

function isValidInputSchema(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function createCollisionSafeName(baseName, source, usedNames) {
  let candidate = baseName.slice(0, 64).replace(/_+$/g, "");
  if (!candidate || !/^[a-zA-Z_]/.test(candidate)) candidate = `mcp_tool_${hashText(source)}`;
  if (!usedNames.has(candidate)) {
    usedNames.add(candidate);
    return candidate;
  }
  const suffix = `_${hashText(source).slice(0, 8)}`;
  candidate = `${candidate.slice(0, 64 - suffix.length)}${suffix}`;
  usedNames.add(candidate);
  return candidate;
}

function hashText(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
```

- [ ] **Step 7: Keep `createHttpMcpToolAdapter` backward compatible**

Modify `src/shared/agent-tool-registry.mjs` so the existing `createHttpMcpToolAdapter()` still works for old tests and scripts. Replace only the adapter implementation with a wrapper that uses the new modules:

```js
import { callMcpTool, listMcpTools } from "./mcp-http-client.mjs";
import { createMcpToolId } from "./mcp-tool-adapter.mjs";
```

Then update `toToolDefinitions()` inside `createHttpMcpToolAdapter` to create ids with `createMcpToolId("legacy", tool.name)` and call `callMcpTool({ server, toolName, arguments: input, fetcher: fetchImpl })`. Keep support for the existing `/tools/list` and `/tools/call` bridge if needed by detecting tools from the old bridge payload:

```js
async listTools() {
  const server = { id: "legacy", name: "Legacy MCP", endpointUrl: baseUrl.toString(), enabled: true, tools: [] };
  try {
    return await listMcpTools({ server, fetcher: fetchImpl });
  } catch {
    const payload = await bridgeFetch("/tools/list");
    return Array.isArray(payload.tools) ? payload.tools : [];
  }
}
```

- [ ] **Step 8: Update `scripts/test_tool_registry.mjs` for the new stable id**

Change the old assertion:

```js
assert.equal(definitions[0].id, "mcp.dev.echo");
```

to:

```js
assert.equal(definitions[0].id.startsWith("mcp."), true);
assert.match(definitions[0].id, /dev\.echo|dev%2Eecho/);
```

Keep the old `/tools/list` and `/tools/call` fake bridge in the test to prove backward compatibility.

- [ ] **Step 9: Run MCP tests**

Run:

```powershell
node scripts/test_mcp_http_client.mjs
node scripts/test_mcp_tool_adapter.mjs
node scripts/test_tool_registry.mjs
```

Expected:

```text
mcp http client tests passed
mcp tool adapter tests passed
tool registry tests passed
```

- [ ] **Step 10: Commit Task 2**

Run:

```powershell
git add -- src/shared/mcp-http-client.mjs src/shared/mcp-tool-adapter.mjs src/shared/agent-tool-registry.mjs scripts/test_mcp_http_client.mjs scripts/test_mcp_tool_adapter.mjs scripts/test_tool_registry.mjs scripts/run_unit_tests.mjs
git diff --cached --name-status
git commit -m "feat: 增加 MCP HTTP 客户端和工具映射"
```

Expected staged files:

```text
A	src/shared/mcp-http-client.mjs
A	src/shared/mcp-tool-adapter.mjs
M	src/shared/agent-tool-registry.mjs
A	scripts/test_mcp_http_client.mjs
A	scripts/test_mcp_tool_adapter.mjs
M	scripts/test_tool_registry.mjs
M	scripts/run_unit_tests.mjs
```

---

### Task 3: Token Usage and Audit Shared Modules

**Files:**
- Create: `src/shared/token-usage.mjs`
- Create: `src/shared/agent-tool-audit.mjs`
- Create: `scripts/test_token_usage.mjs`
- Create: `scripts/test_agent_tool_audit.mjs`
- Modify: `scripts/run_unit_tests.mjs`

- [ ] **Step 1: Write the failing token usage test**

Create `scripts/test_token_usage.mjs` with:

```js
import assert from "node:assert/strict";
import {
  addTokenUsage,
  createTokenUsageEntry,
  hasTokenUsage,
  mergeTokenUsageEntries,
  normalizeModelTokenUsage,
  sumTokenUsageEntries,
} from "../src/shared/token-usage.mjs";

assert.deepEqual(normalizeModelTokenUsage({
  usage: {
    prompt_tokens: 100,
    completion_tokens: 20,
    prompt_tokens_details: { cached_tokens: 30 },
  },
}), {
  inputTokens: 70,
  outputTokens: 20,
  cacheWriteTokens: 0,
  cacheReadTokens: 30,
});

assert.deepEqual(normalizeModelTokenUsage({
  usage: {
    prompt_cache_hit_tokens: 12,
    prompt_cache_miss_tokens: 40,
    completion_tokens: 9,
  },
}), {
  inputTokens: 40,
  outputTokens: 9,
  cacheWriteTokens: 0,
  cacheReadTokens: 12,
});

assert.deepEqual(normalizeModelTokenUsage({
  message: {
    usage: {
      input_tokens: 50,
      output_tokens: 7,
      cache_creation_input_tokens: 5,
      cache_read_input_tokens: 6,
    },
  },
}), {
  inputTokens: 50,
  outputTokens: 7,
  cacheWriteTokens: 5,
  cacheReadTokens: 6,
});

assert.equal(hasTokenUsage(undefined), false);
assert.equal(hasTokenUsage({ inputTokens: 1 }), true);
assert.deepEqual(addTokenUsage({ inputTokens: 1 }, { outputTokens: 2 }), {
  inputTokens: 1,
  outputTokens: 2,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
});

const first = createTokenUsageEntry("chat", { inputTokens: 1, outputTokens: 2 }, 100);
const second = createTokenUsageEntry("tool_decision", { cacheReadTokens: 3 }, 101);
assert.deepEqual(sumTokenUsageEntries([first, second]), {
  inputTokens: 1,
  outputTokens: 2,
  cacheWriteTokens: 0,
  cacheReadTokens: 3,
});
assert.equal(mergeTokenUsageEntries([first], [first, second]).length, 2);

console.log("token usage tests passed");
```

- [ ] **Step 2: Write the failing audit test**

Create `scripts/test_agent_tool_audit.mjs` with:

```js
import assert from "node:assert/strict";
import {
  AGENT_TOOL_AUDIT_MAX,
  createAgentToolAuditRecord,
  redactAgentToolValue,
  sliceAgentToolAuditLog,
} from "../src/shared/agent-tool-audit.mjs";

assert.equal(redactAgentToolValue("secret", 0, "apiKey"), "[已脱敏]");
assert.deepEqual(redactAgentToolValue({ token: "abc", nested: { ok: "yes" } }), {
  token: "[已脱敏]",
  nested: { ok: "yes" },
});

const record = createAgentToolAuditRecord({
  toolCall: { id: "call-1", name: "mcp_search", arguments: { query: "moon", authorization: "Bearer abc" } },
  tool: { id: "mcp.server.search", name: "mcp_search", displayName: "Server.search", permission: "mcp", risk: "external" },
  result: { content: "ok" },
  startedAt: 100,
  completedAt: 160,
});

assert.equal(record.toolCallId, "call-1");
assert.equal(record.durationMs, 60);
assert.equal(record.status, "success");
assert.equal(record.arguments.authorization, "[已脱敏]");
assert.equal(record.resultSummary, "ok");

const failed = createAgentToolAuditRecord({
  toolCall: { id: "call-2", name: "mcp_search", arguments: {} },
  tool: { id: "mcp.server.search", name: "mcp_search" },
  result: { isError: true, content: "bad" },
  startedAt: 100,
  completedAt: 101,
});
assert.equal(failed.status, "error");
assert.equal(failed.errorMessage, "bad");

const longLog = Array.from({ length: AGENT_TOOL_AUDIT_MAX + 5 }, (_, index) => ({ id: String(index) }));
assert.equal(sliceAgentToolAuditLog(longLog).length, AGENT_TOOL_AUDIT_MAX);
assert.equal(sliceAgentToolAuditLog(longLog)[0].id, "5");

console.log("agent tool audit tests passed");
```

- [ ] **Step 3: Add both tests to the unit runner**

Modify `scripts/run_unit_tests.mjs` by inserting after `scripts/test_mcp_tool_adapter.mjs`:

```js
["node", ["scripts/test_token_usage.mjs"]],
["node", ["scripts/test_agent_tool_audit.mjs"]],
```

- [ ] **Step 4: Run tests and verify they fail**

Run:

```powershell
node scripts/test_token_usage.mjs
node scripts/test_agent_tool_audit.mjs
```

Expected: both fail with `Cannot find module`.

- [ ] **Step 5: Implement `token-usage.mjs`**

Create `src/shared/token-usage.mjs` with functions named in the test. Use schema version `1`, source values `chat`, `tool_decision`, `tool_final`, and `title`, normalize missing token fields to `0`, read usage from `data.usage` or `data.message.usage`, and subtract cached OpenAI prompt tokens from `prompt_tokens` when `prompt_cache_miss_tokens` is absent.

The core normalization must match:

```js
const cacheReadTokens = deepSeekCacheReadTokens ?? openAICachedTokens ?? readOptionalTokenCount(source, "cache_read_input_tokens") ?? 0;
const cacheWriteTokens = readOptionalTokenCount(source, "cache_creation_input_tokens") ?? 0;
const promptTokens = readOptionalTokenCount(source, "prompt_tokens") ?? 0;
const inputTokens = deepSeekCacheMissTokens ?? readOptionalTokenCount(source, "input_tokens") ?? Math.max(0, promptTokens - cacheReadTokens);
const outputTokens = readOptionalTokenCount(source, "completion_tokens") ?? readOptionalTokenCount(source, "output_tokens") ?? 0;
```

- [ ] **Step 6: Implement `agent-tool-audit.mjs`**

Create `src/shared/agent-tool-audit.mjs` with exports:

```js
export const AGENT_TOOL_AUDIT_MAX = 80;
export function redactAgentToolValue(value, depth = 0, key = "") { /* exact behavior covered by test */ }
export function createAgentToolAuditRecord(input) { /* exact fields covered by test */ }
export function sliceAgentToolAuditLog(records) { return records.slice(-AGENT_TOOL_AUDIT_MAX); }
```

Sensitive key regex must match `token`, `secret`, `password`, `passwd`, `pwd`, `authorization`, `auth`, `apiKey`, `api_key`, `session`, `jwt`, `credential`, `cookie`, and `set-cookie`.

- [ ] **Step 7: Run shared module tests**

Run:

```powershell
node scripts/test_token_usage.mjs
node scripts/test_agent_tool_audit.mjs
```

Expected:

```text
token usage tests passed
agent tool audit tests passed
```

- [ ] **Step 8: Commit Task 3**

Run:

```powershell
git add -- src/shared/token-usage.mjs src/shared/agent-tool-audit.mjs scripts/test_token_usage.mjs scripts/test_agent_tool_audit.mjs scripts/run_unit_tests.mjs
git diff --cached --name-status
git commit -m "feat: 增加 Token 用量和工具审计基础模块"
```

---

### Task 4: Background Agent Tools Service

**Files:**
- Create: `src/ai-assistant/background/agent-tools-service.js`
- Modify: `src/ai-assistant/background/index.js`
- Modify: `scripts/test_background_agent_tools_wiring.mjs`

- [ ] **Step 1: Update the wiring test expectations**

Modify `scripts/test_background_agent_tools_wiring.mjs`:

Replace the assertion that requires `Grok 搜索 MCP` as the dialog focus with assertions that require generic controls:

```js
assert.match(
  agentToolsDialogSource,
  /工具和 MCP/,
  "agent tools dialog must be the generic Tools and MCP center",
);

assert.match(
  agentToolsDialogSource,
  /MCP Server|添加 Grok 搜索预设|审计日志|最近工具调用/,
  "agent tools dialog must expose server management, Grok preset, and audit log",
);
```

Replace the assertion that advanced MCP/audit controls are removed with:

```js
assert.match(
  agentToolsDialogSource,
  /agentTools\.clearAuditLog|getAuditLog|clearAuditLog/,
  "agent tools dialog must support clearing the audit log",
);
```

Add background assertions:

```js
assert.match(
  backgroundSource,
  /handleAgentToolsMessage/,
  "background must route agentTools messages through the source-owned service",
);

assert.match(
  backgroundSource,
  /agent-tools-service\.js/,
  "background must import the source-owned agent tools service",
);
```

- [ ] **Step 2: Run the wiring test and verify it fails**

Run:

```powershell
node scripts/test_background_agent_tools_wiring.mjs
```

Expected: FAIL because `agent-tools-service.js` is not imported and the dialog is still Grok-only.

- [ ] **Step 3: Implement `agent-tools-service.js`**

Create `src/ai-assistant/background/agent-tools-service.js` with source-owned service exports:

```js
import { createAgentToolAuditRecord, sliceAgentToolAuditLog } from "../../shared/agent-tool-audit.mjs";
import { callMcpTool, listMcpTools } from "../../shared/mcp-http-client.mjs";
import {
  DEFAULT_GROK_API_BASE_URL,
  DEFAULT_GROK_MCP_BRIDGE_URL,
  DEFAULT_GROK_MODEL,
  MCP_SETTINGS_KEY,
  createMcpBearerTokenSettingKey,
  migrateLegacyGrokMcpSettings,
  normalizeMcpSettings,
} from "../../shared/mcp-settings.mjs";
import { createMcpToolRegistryEntries, parseMcpToolId } from "../../shared/mcp-tool-adapter.mjs";

export const AGENT_TOOLS_SETTINGS_KEY = "aiSidebar.agentTools.v1";
export const AGENT_TOOLS_AUDIT_KEY = "aiSidebar.agentTools.audit.v1";

const normalizeText = (value) => (typeof value === "string" ? value.trim() : "");

const createStorage = () => globalThis.chrome?.storage?.local;

const storageGet = (keys) => new Promise((resolve) => {
  const storage = createStorage();
  if (!storage?.get) {
    resolve({});
    return;
  }
  storage.get(keys, (items) => resolve(items || {}));
});

const storageSet = (items) => new Promise((resolve) => {
  const storage = createStorage();
  if (!storage?.set) {
    resolve();
    return;
  }
  storage.set(items, resolve);
});

const storageRemove = (keys) => new Promise((resolve) => {
  const storage = createStorage();
  if (!storage?.remove) {
    resolve();
    return;
  }
  storage.remove(keys, resolve);
});

async function readMcpSettings() {
  const items = await storageGet([MCP_SETTINGS_KEY, AGENT_TOOLS_SETTINGS_KEY]);
  if (items[MCP_SETTINGS_KEY]) return normalizeMcpSettings(items[MCP_SETTINGS_KEY]);
  const legacy = items[AGENT_TOOLS_SETTINGS_KEY]?.mcp;
  return migrateLegacyGrokMcpSettings(legacy).settings;
}

async function writeMcpSettings(settings) {
  const normalized = normalizeMcpSettings(settings);
  await storageSet({ [MCP_SETTINGS_KEY]: normalized });
  return normalized;
}

async function readAuditLog() {
  const items = await storageGet([AGENT_TOOLS_AUDIT_KEY]);
  return Array.isArray(items[AGENT_TOOLS_AUDIT_KEY]) ? items[AGENT_TOOLS_AUDIT_KEY] : [];
}

async function appendAuditRecord(record) {
  const nextLog = sliceAgentToolAuditLog([...(await readAuditLog()), record]);
  await storageSet({ [AGENT_TOOLS_AUDIT_KEY]: nextLog });
  return record;
}

async function refreshServerTools(server, fetcher) {
  try {
    const items = await storageGet([createMcpBearerTokenSettingKey(server.id)]);
    const tools = await listMcpTools({
      server,
      bearerToken: normalizeText(items[createMcpBearerTokenSettingKey(server.id)]),
      fetcher,
    });
    return { ...server, tools, lastRefreshAt: Date.now(), lastRefreshError: "" };
  } catch (error) {
    return {
      ...server,
      tools: server.tools ?? [],
      lastRefreshAt: Date.now(),
      lastRefreshError: error instanceof Error ? error.message : "MCP 工具刷新失败",
    };
  }
}

async function pushLegacyGrokConfig(mcpConfig, fetcher) {
  if (!mcpConfig?.grokBaseUrl && !mcpConfig?.grokModel && !mcpConfig?.grokApiKey && !mcpConfig?.clearGrokApiKey) return;
  const baseUrl = normalizeText(mcpConfig.baseUrl) || DEFAULT_GROK_MCP_BRIDGE_URL;
  const url = new URL("/config", baseUrl);
  const payload = {
    baseUrl: normalizeText(mcpConfig.grokBaseUrl) || DEFAULT_GROK_API_BASE_URL,
    model: normalizeText(mcpConfig.grokModel) || DEFAULT_GROK_MODEL,
    ...(mcpConfig.grokApiKey || mcpConfig.clearGrokApiKey ? { apiKey: mcpConfig.grokApiKey || "" } : {}),
  };
  const response = await fetcher(url.toString(), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok && response.status !== 404) throw new Error(`Grok MCP 配置写入失败：${response.status}`);
}

export async function handleAgentToolsMessage(message, fetcher = fetch, builtInTools = []) {
  if (message.type === "agentTools.getStatus") {
    const settings = await readMcpSettings();
    const auditLog = (await readAuditLog()).slice().reverse();
    const mcpTools = createMcpToolRegistryEntries(settings.servers);
    return { ok: true, settings: { mcp: settings }, builtInTools, tools: [...builtInTools, ...mcpTools], mcp: { servers: settings.servers, tools: mcpTools }, auditLog };
  }

  if (message.type === "agentTools.configureMcp") {
    const current = await readMcpSettings();
    const incomingServers = Array.isArray(message.mcp?.servers) ? message.mcp.servers : current.servers;
    const nextSettings = await writeMcpSettings({ servers: incomingServers });
    await pushLegacyGrokConfig(message.mcp, fetcher);
    return handleAgentToolsMessage({ type: "agentTools.getStatus" }, fetcher, builtInTools);
  }

  if (message.type === "agentTools.refreshMcp") {
    const settings = await readMcpSettings();
    const targetServerId = normalizeText(message.serverId);
    const servers = [];
    for (const server of settings.servers) {
      servers.push(!targetServerId || server.id === targetServerId ? await refreshServerTools(server, fetcher) : server);
    }
    await writeMcpSettings({ servers });
    return handleAgentToolsMessage({ type: "agentTools.getStatus" }, fetcher, builtInTools);
  }

  if (message.type === "agentTools.clearAuditLog") {
    await storageRemove([AGENT_TOOLS_AUDIT_KEY]);
    return { ok: true, auditLog: [] };
  }

  if (message.type === "agentTools.getAuditLog") {
    return { ok: true, auditLog: (await readAuditLog()).slice().reverse() };
  }

  if (message.type === "agentTools.call") {
    const settings = await readMcpSettings();
    const metadata = parseMcpToolId(message.toolId);
    const server = metadata ? settings.servers.find((item) => item.id === metadata.serverId && item.enabled) : undefined;
    const discoveredTool = server?.tools.find((tool) => tool.name === metadata.toolName && !tool.disabledReason);
    if (!server || !discoveredTool) return { ok: false, message: "MCP 工具未注册或未启用。" };
    const startedAt = Date.now();
    const items = await storageGet([createMcpBearerTokenSettingKey(server.id)]);
    const content = await callMcpTool({
      server,
      bearerToken: normalizeText(items[createMcpBearerTokenSettingKey(server.id)]),
      toolName: metadata.toolName,
      arguments: message.input ?? {},
      fetcher,
    });
    await appendAuditRecord(createAgentToolAuditRecord({
      toolCall: { id: `direct-${startedAt}`, name: discoveredTool.name, arguments: message.input ?? {} },
      tool: { id: message.toolId, name: discoveredTool.name, displayName: `${server.name}.${discoveredTool.name}`, permission: "mcp", risk: "external" },
      result: { content },
      startedAt,
      completedAt: Date.now(),
    }));
    return { ok: true, content };
  }

  return { ok: false, message: "未知工具管理请求。" };
}
```

- [ ] **Step 4: Wire `background/index.js` to the service**

Because `src/ai-assistant/background/index.js` is currently generated/minified, make the smallest safe source-owned change:

1. Add this import near the existing import block:

```js
import { handleAgentToolsMessage } from "./agent-tools-service.js";
```

2. Replace the `agentToolsHandleMessage(e).then(n)` runtime route with:

```js
handleAgentToolsMessage(e, fetch, t()).then(n)
```

where `t()` is the existing bundled function that returns built-in tool definitions. If the minified symbol differs at implementation time, use the existing built-in tool list function already used by `agentToolsStatus()`.

- [ ] **Step 5: Run the wiring test**

Run:

```powershell
node scripts/test_background_agent_tools_wiring.mjs
```

Expected: fails only on dialog UI assertions until Task 5 is complete, but passes background import and routing assertions.

- [ ] **Step 6: Commit Task 4 if background assertions pass**

Run:

```powershell
git add -- src/ai-assistant/background/agent-tools-service.js src/ai-assistant/background/index.js scripts/test_background_agent_tools_wiring.mjs
git diff --cached --name-status
git commit -m "feat: 抽出工具和 MCP 后台服务"
```

If the wiring test still fails because the service import cannot parse, fix parse errors before committing.

---

### Task 5: Generic Tools and MCP Dialog

**Files:**
- Modify: `src/ai-assistant/agent-tools-dialog.js`
- Modify: `src/ai-assistant/sidePanel-layout.css`
- Modify: `scripts/test_background_agent_tools_wiring.mjs`

- [ ] **Step 1: Update dialog source assertions**

Ensure `scripts/test_background_agent_tools_wiring.mjs` contains these checks:

```js
assert.match(agentToolsDialogSource, /MCP Server/, "dialog must include MCP Server management copy");
assert.match(agentToolsDialogSource, /添加 Grok 搜索预设/, "dialog must include Grok preset action");
assert.match(agentToolsDialogSource, /最近工具调用|审计日志/, "dialog must include audit log copy");
assert.match(agentToolsDialogSource, /agentTools\.clearAuditLog|clearAuditLog/, "dialog must clear audit log");
assert.doesNotMatch(agentToolsDialogSource, /title\.textContent = "Grok 搜索 MCP"/, "dialog title must not be Grok-only");
```

- [ ] **Step 2: Run the wiring test and verify it fails on dialog UI**

Run:

```powershell
node scripts/test_background_agent_tools_wiring.mjs
```

Expected: FAIL because the dialog still has `title.textContent = "Grok 搜索 MCP"`.

- [ ] **Step 3: Replace the dialog title and state model**

In `src/ai-assistant/agent-tools-dialog.js`, replace:

```js
title.textContent = "Grok 搜索 MCP";
subtitle.textContent = "配置一次 Key、API 和模型，侧边栏 / Codex / Claude Code 共用。";
```

with:

```js
title.textContent = "工具和 MCP";
subtitle.textContent = "管理内置工具、HTTP MCP Server、Grok 搜索预设和最近工具调用。";
```

Add local helper functions:

```js
const createText = (tagName, className, text) => {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  node.textContent = text;
  return node;
};

const normalizeDialogServers = (status) => Array.isArray(status?.settings?.mcp?.servers)
  ? status.settings.mcp.servers
  : [];

const normalizeDialogAuditLog = (status) => Array.isArray(status?.auditLog) ? status.auditLog : [];
```

- [ ] **Step 4: Add MCP Server management section**

In `renderAgentToolsDialog`, after the status row, render:

```js
const serversSection = document.createElement("section");
serversSection.className = "sidepanel-agent-tools-section";
serversSection.append(createText("h3", "sidepanel-agent-tools-section-title", "MCP Server"));

const serverList = document.createElement("div");
serverList.className = "sidepanel-agent-tools-server-list";
const servers = normalizeDialogServers(status);
if (servers.length === 0) {
  serverList.append(createText("p", "sidepanel-agent-tools-muted", "暂无 MCP Server"));
}
for (const server of servers) {
  const item = document.createElement("article");
  item.className = "sidepanel-agent-tools-server";
  item.append(createText("strong", "", server.name || server.id));
  item.append(createText("p", "sidepanel-agent-tools-muted", server.endpointUrl || ""));
  item.append(createText("p", "sidepanel-agent-tools-muted", `状态：${server.enabled ? "已启用" : "已禁用"} · 已发现工具：${Array.isArray(server.tools) ? server.tools.length : 0}`));
  serverList.append(item);
}
serversSection.append(serverList);
```

Add a Grok preset button:

```js
const grokPreset = document.createElement("button");
grokPreset.type = "button";
grokPreset.className = "ui-button-secondary";
grokPreset.textContent = "添加 Grok 搜索预设";
grokPreset.addEventListener("click", async () => {
  const servers = normalizeDialogServers(status);
  const next = await sendAgentToolsMessage({
    type: "agentTools.configureMcp",
    mcp: {
      servers: [
        ...servers,
        {
          id: "grok-search-127-0-0-1-17333",
          name: "Grok 搜索",
          endpointUrl: "http://127.0.0.1:17333/",
          enabled: true,
          tools: [],
        },
      ],
      baseUrl: "http://127.0.0.1:17333/",
    },
  });
  renderAgentToolsDialog(dialog, next, close);
});
serversSection.append(grokPreset);
```

- [ ] **Step 5: Add discovered tools section**

Render:

```js
const toolsSection = document.createElement("section");
toolsSection.className = "sidepanel-agent-tools-section";
toolsSection.append(createText("h3", "sidepanel-agent-tools-section-title", "已发现工具"));
const tools = Array.isArray(status?.tools) ? status.tools : [];
if (tools.length === 0) {
  toolsSection.append(createText("p", "sidepanel-agent-tools-muted", "暂无工具"));
} else {
  const toolList = document.createElement("div");
  toolList.className = "sidepanel-agent-tools-tool-list";
  for (const tool of tools) {
    const item = document.createElement("div");
    item.className = "sidepanel-agent-tools-tool";
    item.append(createText("strong", "", tool.displayName || tool.name || tool.id));
    item.append(createText("span", "sidepanel-agent-tools-muted", tool.description || tool.permission || ""));
    toolList.append(item);
  }
  toolsSection.append(toolList);
}
```

- [ ] **Step 6: Add audit log section**

Render:

```js
const auditSection = document.createElement("section");
auditSection.className = "sidepanel-agent-tools-section";
auditSection.append(createText("h3", "sidepanel-agent-tools-section-title", "最近工具调用"));
const auditLog = normalizeDialogAuditLog(status);
if (auditLog.length === 0) {
  auditSection.append(createText("p", "sidepanel-agent-tools-muted", "暂无审计日志"));
} else {
  const auditList = document.createElement("div");
  auditList.className = "sidepanel-agent-tools-audit-list";
  for (const record of auditLog.slice(0, 20)) {
    const row = document.createElement("article");
    row.className = `sidepanel-agent-tools-audit is-${record.status || "unknown"}`;
    row.append(createText("strong", "", record.displayName || record.name || record.toolId || "工具调用"));
    row.append(createText("span", "sidepanel-agent-tools-muted", `${record.status || "unknown"} · ${record.durationMs ?? 0}ms`));
    row.append(createText("p", "sidepanel-agent-tools-muted", record.resultSummary || record.errorMessage || ""));
    auditList.append(row);
  }
  auditSection.append(auditList);
}
const clearAudit = document.createElement("button");
clearAudit.type = "button";
clearAudit.className = "ui-button-secondary";
clearAudit.textContent = "清空审计日志";
clearAudit.addEventListener("click", async () => {
  const next = await sendAgentToolsMessage({ type: "agentTools.clearAuditLog" });
  renderAgentToolsDialog(dialog, { ...status, auditLog: next.auditLog || [] }, close);
});
auditSection.append(clearAudit);
```

- [ ] **Step 7: Append sections in the dialog**

Replace the old Grok-only body append block with:

```js
body.append(statusRow, serversSection, toolsSection, auditSection);
```

Keep old Grok API Key form code only if it is nested under a clearly labeled compatibility section named `Grok 搜索预设配置`. Do not keep it as the primary dialog.

- [ ] **Step 8: Add CSS for the new sections**

In `src/ai-assistant/sidePanel-layout.css`, add:

```css
.sidepanel-agent-tools-section {
  display: grid;
  gap: 0.75rem;
  padding: 0.875rem;
  border: 1px solid var(--color-hairline, #d8dde8);
  border-radius: 0.5rem;
  background: var(--color-surface-soft, #f8fafc);
}

.sidepanel-agent-tools-section-title {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.4;
  font-weight: 650;
}

.sidepanel-agent-tools-server-list,
.sidepanel-agent-tools-tool-list,
.sidepanel-agent-tools-audit-list {
  display: grid;
  gap: 0.5rem;
}

.sidepanel-agent-tools-server,
.sidepanel-agent-tools-tool,
.sidepanel-agent-tools-audit {
  display: grid;
  gap: 0.25rem;
  min-width: 0;
  padding: 0.625rem;
  border: 1px solid var(--color-hairline, #d8dde8);
  border-radius: 0.5rem;
  background: #fff;
}

.sidepanel-agent-tools-audit.is-error {
  border-color: color-mix(in srgb, var(--color-error, #dc2626) 45%, #d8dde8);
}
```

- [ ] **Step 9: Run the wiring test**

Run:

```powershell
node scripts/test_background_agent_tools_wiring.mjs
```

Expected: `background agent tools wiring tests passed`.

- [ ] **Step 10: Commit Task 5**

Run:

```powershell
git add -- src/ai-assistant/agent-tools-dialog.js src/ai-assistant/sidePanel-layout.css scripts/test_background_agent_tools_wiring.mjs
git diff --cached --name-status
git commit -m "feat: 恢复通用工具和 MCP 中心"
```

---

### Task 6: Notification Host

**Files:**
- Create: `src/ai-assistant/notification-host.js`
- Modify: `src/ai-assistant/index.html`
- Modify: `src/ai-assistant/agent-tools-dialog.js`
- Modify: `src/ai-assistant/sidePanel-layout.css`
- Modify: `scripts/test_background_agent_tools_wiring.mjs`

- [ ] **Step 1: Add wiring test assertions for notification host**

In `scripts/test_background_agent_tools_wiring.mjs`, read `src/ai-assistant/index.html` already exists as `sidePanelHtml`. Add:

```js
assert.match(
  sidePanelHtml,
  /notification-host\.js/,
  "side panel must load the notification host before adapter dialogs use it",
);

assert.match(
  agentToolsDialogSource,
  /showAiSidebarNotification/,
  "agent tools dialog must use the shared notification host",
);
```

- [ ] **Step 2: Run the wiring test and verify it fails**

Run:

```powershell
node scripts/test_background_agent_tools_wiring.mjs
```

Expected: FAIL because `notification-host.js` is not loaded.

- [ ] **Step 3: Create `notification-host.js`**

Create:

```js
const HOST_CLASS = "sidepanel-notification-host";
const DEFAULT_DURATION_MS = 5000;

function ensureNotificationHost() {
  let host = document.querySelector(`.${HOST_CLASS}`);
  if (!host) {
    host = document.createElement("div");
    host.className = HOST_CLASS;
    host.setAttribute("aria-live", "polite");
    document.body.append(host);
  }
  return host;
}

export function showAiSidebarNotification({ type = "info", title = "", message = "", durationMs = DEFAULT_DURATION_MS } = {}) {
  const host = ensureNotificationHost();
  const item = document.createElement("section");
  item.className = `sidepanel-notification is-${type}`;
  item.setAttribute("role", type === "error" ? "alert" : "status");

  const content = document.createElement("div");
  content.className = "sidepanel-notification-content";
  const titleNode = document.createElement("strong");
  titleNode.textContent = title || resolveDefaultTitle(type);
  const messageNode = document.createElement("p");
  messageNode.textContent = message;
  content.append(titleNode, messageNode);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "sidepanel-notification-close";
  close.setAttribute("aria-label", `关闭通知：${titleNode.textContent}`);
  close.textContent = "×";
  close.addEventListener("click", () => item.remove());

  item.append(content, close);
  host.append(item);

  if (durationMs > 0) {
    setTimeout(() => item.remove(), durationMs);
  }
  return item;
}

function resolveDefaultTitle(type) {
  return type === "success" ? "操作成功"
    : type === "warning" ? "需要注意"
      : type === "error" ? "操作失败"
        : "提示";
}

globalThis.showAiSidebarNotification = showAiSidebarNotification;
```

- [ ] **Step 4: Load notification host in `index.html`**

Add before `sidePanel-layout.js`:

```html
<script type="module" crossorigin src="./notification-host.js"></script>
```

- [ ] **Step 5: Use notifications in `agent-tools-dialog.js`**

After successful save/refresh/clear operations, call:

```js
globalThis.showAiSidebarNotification?.({
  type: next?.ok === false ? "error" : "success",
  title: next?.ok === false ? "操作失败" : "工具设置已更新",
  message: next?.ok === false ? next.message || "工具管理请求失败" : "工具和 MCP 状态已刷新",
});
```

For catch blocks in `sendAgentToolsMessage`, call:

```js
globalThis.showAiSidebarNotification?.({
  type: "error",
  title: "工具管理请求失败",
  message: error instanceof Error && error.message ? error.message : "请稍后重试",
});
```

- [ ] **Step 6: Add notification CSS**

Add to `src/ai-assistant/sidePanel-layout.css`:

```css
.sidepanel-notification-host {
  position: fixed;
  top: 0.75rem;
  right: 0.75rem;
  z-index: 2147483647;
  display: grid;
  width: min(22rem, calc(100vw - 1.5rem));
  gap: 0.5rem;
  pointer-events: none;
}

.sidepanel-notification {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid var(--color-hairline, #d8dde8);
  border-radius: 0.5rem;
  background: #fff;
  box-shadow: 0 8px 24px rgb(31 41 55 / 12%);
  pointer-events: auto;
}

.sidepanel-notification-content {
  display: grid;
  gap: 0.125rem;
  min-width: 0;
}

.sidepanel-notification-content p {
  margin: 0;
  color: var(--color-muted, #64748b);
  font-size: 0.8125rem;
  line-height: 1.4;
}

.sidepanel-notification-close {
  border: 0;
  background: transparent;
  color: currentColor;
  cursor: pointer;
  font-size: 1rem;
}
```

- [ ] **Step 7: Run wiring test**

Run:

```powershell
node scripts/test_background_agent_tools_wiring.mjs
```

Expected: `background agent tools wiring tests passed`.

- [ ] **Step 8: Commit Task 6**

Run:

```powershell
git add -- src/ai-assistant/notification-host.js src/ai-assistant/index.html src/ai-assistant/agent-tools-dialog.js src/ai-assistant/sidePanel-layout.css scripts/test_background_agent_tools_wiring.mjs
git diff --cached --name-status
git commit -m "feat: 增加侧边栏统一通知"
```

---

### Task 7: Token Meter and Grouped Model Menu Adapter

**Files:**
- Modify: `src/ai-assistant/sidePanel-layout.js`
- Modify: `src/ai-assistant/sidePanel-layout.css`
- Modify: `scripts/test_background_agent_tools_wiring.mjs`

- [ ] **Step 1: Add source assertions for token meter and grouping**

In `scripts/test_background_agent_tools_wiring.mjs`, add:

```js
assert.match(
  sidePanelPreviewSource,
  /token-usage-meter|Token 暂无|Token 统计中/,
  "side panel preview must include token usage meter copy or adapter hooks",
);

assert.match(
  sidePanelPreviewSource,
  /model-select-group|按渠道|channel/,
  "side panel preview must include grouped model selector hooks",
);
```

Also read `sidePanelLayoutSource` from `src/ai-assistant/sidePanel-layout.js` and assert:

```js
assert.match(
  sidePanelLayoutSource,
  /renderTokenUsageMeter|token-usage-meter/,
  "layout adapter must render the token usage meter",
);

assert.match(
  sidePanelLayoutSource,
  /groupModelOptionsByChannel|model-select-group/,
  "layout adapter must group model options by channel",
);
```

- [ ] **Step 2: Run wiring test and verify it fails**

Run:

```powershell
node scripts/test_background_agent_tools_wiring.mjs
```

Expected: FAIL because hooks do not exist yet.

- [ ] **Step 3: Add token meter adapter hooks**

In `src/ai-assistant/sidePanel-layout.js`, add functions near existing composer enhancement helpers:

```js
function formatTokenCount(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return "0";
  if (numberValue >= 1_000_000) return `${(numberValue / 1_000_000).toFixed(numberValue >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (numberValue >= 1_000) return `${(numberValue / 1_000).toFixed(numberValue >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(Math.floor(numberValue));
}

function readTokenUsageFromDom() {
  const raw = document.querySelector("[data-token-usage]")?.getAttribute("data-token-usage");
  if (!raw) return { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
  try {
    const parsed = JSON.parse(raw);
    return {
      inputTokens: Number(parsed.inputTokens) || 0,
      outputTokens: Number(parsed.outputTokens) || 0,
      cacheWriteTokens: Number(parsed.cacheWriteTokens) || 0,
      cacheReadTokens: Number(parsed.cacheReadTokens) || 0,
    };
  } catch {
    return { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
  }
}

function renderTokenUsageMeter() {
  const composer = document.querySelector(".chat-composer");
  const contextStrip = document.querySelector(".context-strip");
  if (!composer || !contextStrip) return;
  let meter = contextStrip.querySelector(".token-usage-meter");
  if (!meter) {
    meter = document.createElement("div");
    meter.className = "token-usage-meter token-usage-meter-empty";
    meter.setAttribute("aria-label", "当前会话 Token 用量");
    meter.title = "当前会话 Token 用量";
    contextStrip.prepend(meter);
  }
  const usage = readTokenUsageFromDom();
  const hasUsage = usage.inputTokens || usage.outputTokens || usage.cacheWriteTokens || usage.cacheReadTokens;
  meter.classList.toggle("token-usage-meter-empty", !hasUsage);
  meter.replaceChildren();
  if (!hasUsage) {
    const span = document.createElement("span");
    span.textContent = composer.classList.contains("is-sending") ? "Token 统计中" : "Token 暂无";
    meter.append(span);
    return;
  }
  for (const [label, value] of [
    ["输入", usage.inputTokens],
    ["输出", usage.outputTokens],
    ["写入", usage.cacheWriteTokens],
    ["读取", usage.cacheReadTokens],
  ]) {
    const span = document.createElement("span");
    span.textContent = `${label} ${formatTokenCount(value)}`;
    meter.append(span);
  }
}
```

Call `renderTokenUsageMeter()` from the existing scheduled enhancement path.

- [ ] **Step 4: Add grouped model option helpers**

In `src/ai-assistant/sidePanel-layout.js`, add:

```js
function groupModelOptionsByChannel(options) {
  const groups = [];
  const groupMap = new Map();
  for (const option of options) {
    const channel = option.getAttribute("data-channel-name") || option.dataset?.channel || "其他";
    if (!groupMap.has(channel)) {
      const group = { channel, options: [] };
      groupMap.set(channel, group);
      groups.push(group);
    }
    groupMap.get(channel).options.push(option);
  }
  return groups;
}
```

Update `renderModelSelectMenu` so it wraps option rows in:

```js
const groupNode = document.createElement("div");
groupNode.className = "model-select-group";
const groupTitle = document.createElement("div");
groupTitle.className = "model-select-group-title";
groupTitle.textContent = group.channel;
groupNode.append(groupTitle, ...group.options.map(createModelOptionNode));
```

If the existing options do not expose channel metadata, keep one `其他` group. Do not change saved model values.

- [ ] **Step 5: Add CSS for token meter and model groups**

Add:

```css
.token-usage-meter {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.5rem;
  min-width: 0;
  color: var(--color-muted, #64748b);
  font-size: 0.75rem;
  line-height: 1.35;
}

.token-usage-meter span {
  white-space: nowrap;
}

.token-usage-meter-empty {
  opacity: 0.72;
}

.model-select-group {
  display: grid;
  gap: 0.125rem;
  padding: 0.25rem;
}

.model-select-group-title {
  padding: 0.25rem 0.5rem;
  color: var(--color-muted, #64748b);
  font-size: 0.75rem;
  font-weight: 650;
}
```

- [ ] **Step 6: Run syntax and wiring tests**

Run:

```powershell
node --check .\src\ai-assistant\sidePanel-layout.js
node scripts/test_background_agent_tools_wiring.mjs
```

Expected:

```text
background agent tools wiring tests passed
```

- [ ] **Step 7: Commit Task 7**

Run:

```powershell
git add -- src/ai-assistant/sidePanel-layout.js src/ai-assistant/sidePanel-layout.css scripts/test_background_agent_tools_wiring.mjs
git diff --cached --name-status
git commit -m "feat: 增加 Token 用量和模型分组入口"
```

---

### Task 8: Documentation and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md`
- Modify: `scripts/run_unit_tests.mjs`

- [ ] **Step 1: Update README**

In `README.md`, replace the Grok-only “工具和 MCP” usage section with:

```markdown
启动后在 AI 侧边栏“工具和 MCP”中可以：

- 新增 HTTP / Streamable HTTP MCP Server。
- 使用“添加 Grok 搜索预设”快速接入本地 Grok Search MCP Bridge。
- 启用或禁用 MCP Server。
- 刷新并查看 MCP Server 已发现工具。
- 查看最近工具调用审计日志和清空审计日志。

Grok 预设仍默认使用 `http://127.0.0.1:17333/`。保存 Grok API Key 时，Key 只保存在本机扩展存储，并同步写入本地 Bridge 的 `/config`；留空不会清除旧 Key，只有显式清除才删除。
```

- [ ] **Step 2: Update architecture doc**

In `docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md`, update the MCP and audit sections so they state:

```markdown
当前“工具和 MCP”入口是通用工具中心。Grok 搜索只是内置预设，不再是唯一 MCP 形态。

MCP 配置以 Server 列表保存，Bearer Token 使用 `mcpBearerToken:<serverId>` 独立保存。聊天发送前会根据工具开关、会话启用工具、Server 启用状态和工具禁用状态生成模型可见工具列表。工具执行前后台再次校验 Server 和工具缓存。

审计日志保留最近 80 条工具调用，参数和结果摘要默认脱敏。审计日志用于复盘工具调用，不保存 Bearer Token、API Key、Cookie 或响应体原文。
```

- [ ] **Step 3: Run full unit test suite**

Run:

```powershell
npm test
```

Expected final line:

```text
unit tests passed
```

- [ ] **Step 4: Run side-panel core smoke if available**

Run:

```powershell
python scripts\verify_ai_sidebar_core.py
```

Expected: no failure related to “工具和 MCP” or audit log. If browser setup fails for environmental reasons, capture the exact error in the final implementation report.

- [ ] **Step 5: Commit documentation**

Run:

```powershell
git add -- README.md docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md scripts/run_unit_tests.mjs
git diff --cached --name-status
git commit -m "docs: 更新工具和 MCP 迁移说明"
```

- [ ] **Step 6: Final verification status**

Run:

```powershell
git status --short
git log --oneline -5
```

Expected: only pre-existing unrelated dirty files remain, plus no staged changes.

## Self-Review Checklist

- Spec coverage:
  - Generic Tools/MCP center: Tasks 4 and 5.
  - Multi-server MCP: Tasks 1, 2, 4, 5.
  - Grok preset compatibility: Tasks 1, 4, 5, 8.
  - Audit log: Tasks 3, 4, 5, 8.
  - Token usage: Tasks 3 and 7.
  - Notifications: Task 6.
  - Model grouping: Task 7.
  - Documentation and phase boundaries: Task 8.

- Commands:
  - Unit tests are covered by `npm test`.
  - Focused tests are listed per task.
  - Smoke is covered by `python scripts\verify_ai_sidebar_core.py`.

- Commit strategy:
  - Each task ends with a Chinese commit.
  - Each commit stages only files listed in the task.
