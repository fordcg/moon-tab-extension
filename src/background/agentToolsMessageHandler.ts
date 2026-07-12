import { callMcpTool, listMcpTools } from "../shared/mcp/httpClient";
import {
  clearMcpBearerToken,
  getMcpBearerToken,
  getMcpSettings,
  normalizeMcpSettings,
  saveMcpBearerToken,
  saveMcpSettings,
} from "../shared/mcp/settings";
import { createMcpToolName, createMcpToolRegistryEntries, parseMcpToolId } from "../shared/mcp/toolAdapter";
import type { ModelToolRegistryEntry } from "../shared/models/types";
import { resolveModelToolAvailability } from "../shared/models/toolAvailability";
import type { BrowserControlDiagnostics } from "../shared/browserControl";
import type { McpServerConfig, McpSettings } from "../shared/types";
import { getAppSetting, saveAppSetting } from "../shared/storage/repositories";

export const AGENT_TOOLS_SETTINGS_KEY = "aiSidebar.agentTools.v1";
export const AGENT_TOOLS_AUDIT_KEY = "aiSidebar.agentTools.audit.v1";

const DEFAULT_GROK_MCP_BRIDGE_URL = "http://127.0.0.1:17333/";
const DEFAULT_GROK_API_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_GROK_MODEL = "grok-4.20-multi-agent-xhigh";
const AGENT_TOOL_AUDIT_MAX = 80;
const REDACTED_VALUE = "[已脱敏]";
const MAX_REDACTION_DEPTH = 8;
const SENSITIVE_KEY_PATTERN = /(?:token|secret|password|passwd|pwd|authorization|auth|api[_-]?key|session|jwt|credential|cookie|set-cookie|bearer)/i;
const SENSITIVE_ASSIGNMENT_PATTERN = /\b(token|secret|password|passwd|pwd|authorization|auth|api[_-]?key|session|jwt|credential|cookie|set-cookie|bearer)\b\s*([:=])\s*("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s,;&}]+)/gi;
const SENSITIVE_JSON_STRING_PATTERN = /("(?:token|secret|password|passwd|pwd|authorization|auth|api[_-]?key|session|jwt|credential|cookie|set-cookie|bearer)"\s*:\s*)"(?:\\.|[^"])*"/gi;
const SENSITIVE_BEARER_PATTERN = /\bBearer\s+("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s,;&}]+)/gi;

type Fetcher = typeof fetch;

export type AgentToolsMessage =
  | { type: "agentTools.getStatus" }
  | { type: "agentTools.configureMcp"; mcp?: unknown }
  | { type: "agentTools.refreshMcp"; serverId?: unknown }
  | { type: "agentTools.call"; toolId?: unknown; input?: unknown }
  | { type: "agentTools.getAuditLog" }
  | { type: "agentTools.clearAuditLog" };

export type AgentToolsRuntimeMessage = {
  type: AgentToolsMessage["type"] | `agentTools.${string}`;
  mcp?: unknown;
  serverId?: unknown;
  toolId?: unknown;
  input?: unknown;
};

type StorageAreaLike = {
  get?: (keys?: unknown, callback?: (items: Record<string, unknown>) => void) => Promise<Record<string, unknown>> | void;
  set?: (items: Record<string, unknown>, callback?: () => void) => Promise<void> | void;
  remove?: (keys: string | string[], callback?: () => void) => Promise<void> | void;
};

interface AgentToolsAuditRecord {
  schemaVersion: 1;
  id: string;
  status: "success" | "error";
  tool: {
    id: string;
    name: string;
    displayName: string;
    serverId: string;
  };
  toolCall: {
    id: string;
    name: string;
    arguments: unknown;
  };
  arguments: unknown;
  result: unknown;
  resultSummary: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  errorMessage?: string;
}

export async function handleAgentToolsMessage(
  message: AgentToolsRuntimeMessage,
  fetcher: Fetcher = fetch,
  builtInTools: ModelToolRegistryEntry[] = [],
  diagnostics?: BrowserControlDiagnostics,
): Promise<Record<string, unknown>> {
  try {
    return await routeAgentToolsMessage(message, fetcher, builtInTools, diagnostics);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "工具管理请求失败。" };
  }
}

async function routeAgentToolsMessage(
  message: AgentToolsRuntimeMessage,
  fetcher: Fetcher,
  builtInTools: ModelToolRegistryEntry[],
  diagnostics: BrowserControlDiagnostics | undefined,
): Promise<Record<string, unknown>> {
  if (message.type === "agentTools.getStatus") {
    return createStatusResponse(builtInTools, diagnostics);
  }

  if (message.type === "agentTools.configureMcp") {
    await configureMcp(message.mcp, fetcher);
    return createStatusResponse(builtInTools, diagnostics);
  }

  if (message.type === "agentTools.refreshMcp") {
    await refreshMcpTools(typeof message.serverId === "string" ? message.serverId.trim() : "", fetcher);
    return createStatusResponse(builtInTools, diagnostics);
  }

  if (message.type === "agentTools.call") {
    return callRegisteredMcpTool(message, fetcher);
  }

  if (message.type === "agentTools.getAuditLog") {
    return { ok: true, auditLog: (await readAuditLog()).slice().reverse() };
  }

  if (message.type === "agentTools.clearAuditLog") {
    await storageRemove(AGENT_TOOLS_AUDIT_KEY);
    return { ok: true, auditLog: [] };
  }

  return { ok: false, message: "未知工具管理请求。" };
}

async function createStatusResponse(
  builtInTools: ModelToolRegistryEntry[],
  diagnostics?: BrowserControlDiagnostics,
): Promise<Record<string, unknown>> {
  const settings = await getMcpSettings();
  const mcpTools = createMcpToolRegistryEntries(settings.servers);
  const builtInToolsWithHealth = diagnostics ? builtInTools.map((tool) => ({
    ...tool,
    availability: resolveModelToolAvailability(tool, {
      debuggerPermissionDeclared: diagnostics.debuggerPermissionDeclared,
      browserControlEnabled: diagnostics.browserControlEnabled,
      browserControlAttached: diagnostics.browserControlAttached,
      browserAutomationMode: diagnostics.browserAutomationMode,
      networkSource: diagnostics.networkSource,
    }),
  })) : builtInTools;
  return {
    ok: true,
    settings: { mcp: settings },
    builtInTools: builtInToolsWithHealth,
    tools: [...builtInToolsWithHealth, ...mcpTools],
    mcp: { servers: settings.servers, tools: mcpTools },
    auditLog: (await readAuditLog()).slice().reverse(),
  };
}

async function configureMcp(rawMcpConfig: unknown, fetcher: Fetcher): Promise<void> {
  const startedAt = Date.now();
  const currentSettings = await getMcpSettings();
  const mcpConfig = isRecord(rawMcpConfig) ? rawMcpConfig : {};
  const rawServers = Array.isArray(mcpConfig.servers) ? mcpConfig.servers : currentSettings.servers;
  const nextSettings = normalizeMcpSettings({ servers: rawServers });

  await saveMcpSettings(nextSettings);
  await persistMcpBearerTokens(rawServers, nextSettings.servers);
  await saveLegacyAgentToolsSettings(mcpConfig);
  await pushGrokBridgeConfig(mcpConfig, fetcher);
  await appendAuditRecord(createAuditRecord({
    toolId: "agentTools.configureMcp",
    toolName: "agentTools.configureMcp",
    displayName: "AgentTools.configureMcp",
    serverId: "agentTools",
    input: mcpConfig,
    result: { ok: true },
    startedAt,
    completedAt: Date.now(),
    status: "success",
  }));
}

async function persistMcpBearerTokens(rawServers: unknown[], normalizedServers: McpServerConfig[]): Promise<void> {
  await Promise.all(normalizedServers.map(async (server) => {
    const rawServer = rawServers.find((item) => isRecord(item) && normalizeText(item.id) === server.id);
    if (!isRecord(rawServer)) {
      return;
    }

    const bearerToken = typeof rawServer.bearerToken === "string" ? rawServer.bearerToken : undefined;
    if (rawServer.clearBearerToken === true || bearerToken === "") {
      await clearMcpBearerToken(server.id);
      return;
    }

    if (typeof bearerToken === "string") {
      await saveMcpBearerToken(server.id, bearerToken);
    }
  }));
}

async function refreshMcpTools(targetServerId: string, fetcher: Fetcher): Promise<void> {
  const settings = await getMcpSettings();
  const servers: McpSettings["servers"] = [];

  for (const server of settings.servers) {
    if (!server.enabled || (targetServerId && server.id !== targetServerId)) {
      servers.push(server);
      continue;
    }

    try {
      const tools = await listMcpTools({
        server,
        bearerToken: await getMcpBearerToken(server.id),
        fetcher,
      });
      servers.push({ ...server, tools, lastRefreshError: undefined, updatedAt: Date.now() });
    } catch (error) {
      servers.push({
        ...server,
        lastRefreshError: error instanceof Error ? error.message : "MCP 工具刷新失败",
        updatedAt: Date.now(),
      });
    }
  }

  await saveMcpSettings({ servers });
  await enableDiscoveredMcpToolsInChatPreferences(servers);
}

async function enableDiscoveredMcpToolsInChatPreferences(servers: McpSettings["servers"]): Promise<void> {
  const toolIds = createMcpToolRegistryEntries(servers).map((tool) => tool.id);
  if (toolIds.length === 0) {
    return;
  }

  try {
    const currentPreferences = await getAppSetting<Record<string, unknown>>("chatPreferences");
    const currentEnabledToolIds = Array.isArray(currentPreferences?.enabledToolIds)
      ? currentPreferences.enabledToolIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const nextEnabledToolIds = Array.from(new Set([...currentEnabledToolIds, ...toolIds]));
    if (nextEnabledToolIds.length === currentEnabledToolIds.length) {
      return;
    }

    await saveAppSetting({
      key: "chatPreferences",
      value: {
        ...(currentPreferences && typeof currentPreferences === "object" ? currentPreferences : {}),
        enabledToolIds: nextEnabledToolIds,
        toolCallingEnabled: true,
      },
      updatedAt: Date.now(),
    });
  } catch {
    // Preferences storage may be unavailable in some test/runtime contexts.
  }
}

async function callRegisteredMcpTool(message: AgentToolsRuntimeMessage, fetcher: Fetcher): Promise<Record<string, unknown>> {
  const toolId = typeof message.toolId === "string" ? message.toolId : "";
  const metadata = parseMcpToolId(toolId);
  if (!metadata) {
    return { ok: false, message: "MCP 工具标识无效。" };
  }

  const settings = await getMcpSettings();
  const server = settings.servers.find((item) => item.id === metadata.serverId && item.enabled);
  const discoveredTool = server?.tools.find((tool) => tool.name === metadata.toolName && !tool.disabledReason);
  if (!server || !discoveredTool) {
    return { ok: false, message: "MCP 工具未注册或未启用。" };
  }

  const startedAt = Date.now();
  const input = isRecord(message.input) ? message.input : {};
  const toolName = createMcpToolName(server.id, discoveredTool.name);

  try {
    const content = await callMcpTool({
      server,
      toolName: metadata.toolName,
      arguments: input,
      bearerToken: await getMcpBearerToken(server.id),
      fetcher,
    });
    await appendAuditRecord(createAuditRecord({
      toolId,
      toolName,
      displayName: `${server.name}.${discoveredTool.name}`,
      serverId: server.id,
      input,
      result: { content },
      startedAt,
      completedAt: Date.now(),
      status: "success",
    }));
    return { ok: true, content };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "MCP 工具调用失败。";
    await appendAuditRecord(createAuditRecord({
      toolId,
      toolName,
      displayName: `${server.name}.${discoveredTool.name}`,
      serverId: server.id,
      input,
      result: { isError: true, content: messageText },
      startedAt,
      completedAt: Date.now(),
      status: "error",
    }));
    return { ok: false, message: messageText };
  }
}

async function saveLegacyAgentToolsSettings(mcpConfig: Record<string, unknown>): Promise<void> {
  const recognizedKeys = ["baseUrl", "grokBaseUrl", "grokModel", "grokApiKey", "clearGrokApiKey", "enabled", "exposeToChat"];
  if (!recognizedKeys.some((key) => key in mcpConfig)) {
    return;
  }

  const items = await storageGet(AGENT_TOOLS_SETTINGS_KEY);
  const current = isRecord(items[AGENT_TOOLS_SETTINGS_KEY]) ? items[AGENT_TOOLS_SETTINGS_KEY] : {};
  const currentMcp = isRecord(current.mcp) ? current.mcp : {};
  const nextMcp: Record<string, unknown> = { ...currentMcp };

  for (const key of ["baseUrl", "grokBaseUrl", "grokModel"] as const) {
    if (typeof mcpConfig[key] === "string") {
      nextMcp[key] = mcpConfig[key];
    }
  }
  for (const key of ["enabled", "exposeToChat"] as const) {
    if (typeof mcpConfig[key] === "boolean") {
      nextMcp[key] = mcpConfig[key];
    }
  }
  if (typeof mcpConfig.grokApiKey === "string" || mcpConfig.clearGrokApiKey === true) {
    nextMcp.grokApiKey = normalizeText(mcpConfig.grokApiKey);
  }

  await storageSet({ [AGENT_TOOLS_SETTINGS_KEY]: { ...current, mcp: nextMcp } });
}

async function pushGrokBridgeConfig(mcpConfig: Record<string, unknown>, fetcher: Fetcher): Promise<void> {
  const shouldPush = typeof mcpConfig.grokBaseUrl === "string" ||
    typeof mcpConfig.grokModel === "string" ||
    typeof mcpConfig.grokApiKey === "string" ||
    mcpConfig.clearGrokApiKey === true ||
    typeof mcpConfig.grokApiStyle === "string";
  if (!shouldPush) {
    return;
  }

  const bridgeBaseUrl = normalizeText(mcpConfig.baseUrl) || DEFAULT_GROK_MCP_BRIDGE_URL;
  const bridgeBase = parseLocalBridgeBaseUrl(bridgeBaseUrl);
  if (!bridgeBase) {
    return;
  }
  const bridgeConfigUrl = new URL("config", bridgeBase);
  const grokBaseUrl = normalizeText(mcpConfig.grokBaseUrl) || DEFAULT_GROK_API_BASE_URL;
  const explicitApiStyle = normalizeText(mcpConfig.grokApiStyle).toLowerCase();
  const apiStyle = explicitApiStyle || (isLocalOpenAiCompatibleBaseUrl(grokBaseUrl) ? "chat" : "");
  const payload = {
    baseUrl: grokBaseUrl,
    model: normalizeText(mcpConfig.grokModel) || DEFAULT_GROK_MODEL,
    ...(apiStyle ? { apiStyle } : {}),
    ...(typeof mcpConfig.grokApiKey === "string" || mcpConfig.clearGrokApiKey === true
      ? { apiKey: normalizeText(mcpConfig.grokApiKey) }
      : {}),
  };
  const response = await fetcher(bridgeConfigUrl.toString(), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Grok MCP 配置写入失败：${response.status}`);
  }
}

function isLocalOpenAiCompatibleBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

async function readAuditLog(): Promise<Array<Record<string, unknown> | AgentToolsAuditRecord>> {
  const items = await storageGet(AGENT_TOOLS_AUDIT_KEY);
  const rawLog = items[AGENT_TOOLS_AUDIT_KEY];
  return Array.isArray(rawLog) ? rawLog.filter(isRecord) : [];
}

async function appendAuditRecord(record: AgentToolsAuditRecord): Promise<void> {
  const nextLog = [...await readAuditLog(), record]
    .map((item) => redactAgentToolValue(item))
    .filter(isRecord)
    .slice(-AGENT_TOOL_AUDIT_MAX);
  await storageSet({ [AGENT_TOOLS_AUDIT_KEY]: nextLog });
}

function createAuditRecord(input: {
  toolId: string;
  toolName: string;
  displayName: string;
  serverId: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  startedAt: number;
  completedAt: number;
  status: "success" | "error";
}): AgentToolsAuditRecord {
  const redactedResult = redactAgentToolValue(input.result);
  const resultSummary = summarizeAuditResult(redactedResult);
  return {
    schemaVersion: 1,
    id: `${input.toolId}:${input.startedAt}:${input.completedAt}`,
    status: input.status,
    tool: {
      id: input.toolId,
      name: input.toolName,
      displayName: input.displayName,
      serverId: input.serverId,
    },
    toolCall: {
      id: `direct-${input.startedAt}`,
      name: input.toolName,
      arguments: redactAgentToolValue(input.input),
    },
    arguments: redactAgentToolValue(input.input),
    result: redactedResult,
    resultSummary,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: Math.max(0, input.completedAt - input.startedAt),
    ...(input.status === "error" ? { errorMessage: resultSummary } : {}),
  };
}

function summarizeAuditResult(result: unknown): string {
  if (!isRecord(result)) {
    return typeof result === "string" ? redactSensitiveText(result) : "";
  }
  const content = result.content;
  if (typeof content === "string") {
    return redactSensitiveText(content).slice(0, 500);
  }
  return redactSensitiveText(JSON.stringify(result)).slice(0, 500);
}

function redactAgentToolValue(value: unknown, depth = 0, key = ""): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return REDACTED_VALUE;
  }
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (depth >= MAX_REDACTION_DEPTH) {
    return Array.isArray(value) ? [] : {};
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => redactAgentToolValue(item, depth + 1, String(index)));
  }

  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
    childKey,
    redactAgentToolValue(childValue, depth + 1, childKey),
  ]));
}

function redactSensitiveText(value: string): string {
  return value
    .replace(SENSITIVE_BEARER_PATTERN, `Bearer ${REDACTED_VALUE}`)
    .replace(SENSITIVE_JSON_STRING_PATTERN, `$1"${REDACTED_VALUE}"`)
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, (_match, key: string, separator: string) => `${key}${separator}${REDACTED_VALUE}`);
}

function getLocalStorageArea(): StorageAreaLike | undefined {
  return (globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome?.storage?.local as StorageAreaLike | undefined;
}

async function storageGet(keys: string | string[]): Promise<Record<string, unknown>> {
  const storage = getLocalStorageArea();
  if (typeof storage?.get !== "function") {
    return {};
  }
  return new Promise((resolve) => {
    let settled = false;
    const complete = (items: Record<string, unknown> | undefined) => {
      if (!settled) {
        settled = true;
        resolve(items ?? {});
      }
    };
    try {
      const maybePromise = storage.get?.(keys, complete);
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(complete, () => complete({}));
      }
    } catch {
      complete({});
    }
  });
}

async function storageSet(items: Record<string, unknown>): Promise<void> {
  const storage = getLocalStorageArea();
  if (typeof storage?.set !== "function") {
    return;
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    const complete = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    try {
      const maybePromise = storage.set?.(items, complete);
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(complete, complete);
      }
    } catch {
      complete();
    }
  });
}

async function storageRemove(keys: string | string[]): Promise<void> {
  const storage = getLocalStorageArea();
  if (typeof storage?.remove !== "function") {
    return;
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    const complete = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    try {
      const maybePromise = storage.remove?.(keys, complete);
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(complete, complete);
      }
    } catch {
      complete();
    }
  });
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function parseLocalBridgeBaseUrl(value: string): URL | undefined {
  try {
    const url = new URL(ensureTrailingSlash(value));
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]") {
      return url;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
