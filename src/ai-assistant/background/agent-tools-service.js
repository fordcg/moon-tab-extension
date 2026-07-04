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

const storageGet = (keys) =>
  new Promise((resolve) => {
    const storage = createStorage();
    if (!storage?.get) {
      resolve({});
      return;
    }
    storage.get(keys, (items) => resolve(items || {}));
  });

const storageSet = (items) =>
  new Promise((resolve) => {
    const storage = createStorage();
    if (!storage?.set) {
      resolve();
      return;
    }
    storage.set(items, resolve);
  });

const storageRemove = (keys) =>
  new Promise((resolve) => {
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
  try {
    return await routeAgentToolsMessage(message, fetcher, builtInTools);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "工具管理请求失败。" };
  }
}

async function routeAgentToolsMessage(message, fetcher, builtInTools) {
  if (message.type === "agentTools.getStatus") {
    const settings = await readMcpSettings();
    const auditLog = (await readAuditLog()).slice().reverse();
    const mcpTools = createMcpToolRegistryEntries(settings.servers);
    return {
      ok: true,
      settings: { mcp: settings },
      builtInTools,
      tools: [...builtInTools, ...mcpTools],
      mcp: { servers: settings.servers, tools: mcpTools },
      auditLog,
    };
  }

  if (message.type === "agentTools.configureMcp") {
    const current = await readMcpSettings();
    const incomingServers = Array.isArray(message.mcp?.servers) ? message.mcp.servers : current.servers;
    await writeMcpSettings({ servers: incomingServers });
    await pushLegacyGrokConfig(message.mcp, fetcher);
    return routeAgentToolsMessage({ type: "agentTools.getStatus" }, fetcher, builtInTools);
  }

  if (message.type === "agentTools.refreshMcp") {
    const settings = await readMcpSettings();
    const targetServerId = normalizeText(message.serverId);
    const servers = [];
    for (const server of settings.servers) {
      servers.push(!targetServerId || server.id === targetServerId ? await refreshServerTools(server, fetcher) : server);
    }
    await writeMcpSettings({ servers });
    return routeAgentToolsMessage({ type: "agentTools.getStatus" }, fetcher, builtInTools);
  }

  if (message.type === "agentTools.clearAuditLog") {
    await storageRemove([AGENT_TOOLS_AUDIT_KEY]);
    return { ok: true, auditLog: [] };
  }

  if (message.type === "agentTools.getAuditLog") {
    return { ok: true, auditLog: (await readAuditLog()).slice().reverse() };
  }

  if (message.type === "agentTools.call") {
    return callRegisteredMcpTool(message, fetcher);
  }

  return { ok: false, message: "未知工具管理请求。" };
}

async function callRegisteredMcpTool(message, fetcher) {
  const settings = await readMcpSettings();
  const metadata = parseMcpToolId(message.toolId);
  const server = metadata ? settings.servers.find((item) => item.id === metadata.serverId && item.enabled) : undefined;
  const discoveredTool = server?.tools.find((tool) => tool.name === metadata.toolName && !tool.disabledReason);
  if (!server || !discoveredTool) return { ok: false, message: "MCP 工具未注册或未启用。" };

  const startedAt = Date.now();
  const toolCall = {
    id: `direct-${startedAt}`,
    name: discoveredTool.name,
    arguments: message.input ?? {},
  };
  const tool = {
    id: message.toolId,
    name: discoveredTool.name,
    displayName: `${server.name}.${discoveredTool.name}`,
    permission: "mcp",
    risk: "external",
  };

  try {
    const items = await storageGet([createMcpBearerTokenSettingKey(server.id)]);
    const content = await callMcpTool({
      server,
      bearerToken: normalizeText(items[createMcpBearerTokenSettingKey(server.id)]),
      toolName: metadata.toolName,
      arguments: message.input ?? {},
      fetcher,
    });
    await appendAuditRecord(createAgentToolAuditRecord({ toolCall, tool, result: { content }, startedAt, completedAt: Date.now() }));
    return { ok: true, content };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "MCP 工具调用失败。";
    await appendAuditRecord(
      createAgentToolAuditRecord({
        toolCall,
        tool,
        result: { isError: true, content: messageText },
        startedAt,
        completedAt: Date.now(),
      }),
    );
    return { ok: false, message: messageText };
  }
}
