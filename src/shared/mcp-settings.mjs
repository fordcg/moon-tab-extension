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
