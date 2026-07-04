export const MODEL_TOOL_GROUP_MCP_REMOTE_ID = "mcp_remote";

const MODEL_TOOL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

const normalizeText = (value) => (typeof value === "string" ? value.trim() : "");

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function createMcpToolId(serverId, toolName) {
  const normalizedServerId = normalizeText(serverId);
  const normalizedToolName = normalizeText(toolName);
  if (!normalizedServerId || !normalizedToolName) {
    throw new Error("MCP 工具 id 需要 serverId 和 toolName");
  }
  return `mcp.${encodeMcpIdPart(normalizedServerId, { encodeDot: true })}.${encodeMcpIdPart(normalizedToolName)}`;
}

export function parseMcpToolId(toolId) {
  const value = normalizeText(toolId);
  if (!value.startsWith("mcp.")) return undefined;

  const body = value.slice(4);
  const separatorIndex = body.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex === body.length - 1) return undefined;

  try {
    const serverId = decodeURIComponent(body.slice(0, separatorIndex));
    const toolName = decodeURIComponent(body.slice(separatorIndex + 1));
    if (!serverId || !toolName) return undefined;
    return { serverId, toolName };
  } catch {
    return undefined;
  }
}

export function isMcpToolId(toolId) {
  return Boolean(parseMcpToolId(toolId));
}

export function createMcpToolName(serverId, toolName, usedNames = new Set()) {
  const serverSlug = normalizeModelNamePart(serverId);
  const toolSlug = normalizeModelNamePart(toolName);
  const hash = stableHash(`${normalizeText(serverId)}\n${normalizeText(toolName)}`);
  const baseName = serverSlug && toolSlug ? `mcp_${serverSlug}_${toolSlug}` : "";
  const candidate = MODEL_TOOL_NAME_PATTERN.test(baseName) ? baseName : `mcp_tool_${hash}`;
  return reserveUniqueModelName(candidate, hash, usedNames);
}

export function createMcpToolRegistryEntries(servers = []) {
  const usedNames = new Set();
  const entries = [];

  for (const server of Array.isArray(servers) ? servers : []) {
    if (!isRecord(server) || server.enabled === false) continue;

    const serverId = normalizeText(server.id || server.name || server.endpointUrl || server.endpoint || server.url);
    if (!serverId) continue;

    const serverName = normalizeText(server.name) || serverId;
    const endpointUrl = normalizeText(server.endpointUrl || server.endpoint || server.url);
    for (const tool of Array.isArray(server.tools) ? server.tools : []) {
      if (!isRecord(tool) || tool.enabled === false || tool.disabled === true || normalizeText(tool.disabledReason)) {
        continue;
      }

      const toolName = normalizeText(tool.name || tool.id);
      if (!toolName) continue;

      const description = normalizeText(tool.description) || `调用 MCP 服务器「${serverName}」的远程工具「${toolName}」。`;
      entries.push({
        id: createMcpToolId(serverId, toolName),
        name: createMcpToolName(serverId, toolName, usedNames),
        displayName: normalizeText(tool.displayName) || `${serverName} / ${toolName}`,
        groupId: MODEL_TOOL_GROUP_MCP_REMOTE_ID,
        description,
        parameters: normalizeInputSchema(tool.inputSchema || tool.input_schema),
        metadata: {
          serverId,
          serverName,
          endpointUrl,
          toolName,
        },
        toolClassification: {
          runtime: MODEL_TOOL_GROUP_MCP_REMOTE_ID,
          capabilities: ["external_tool"],
          risk: "external",
        },
      });
    }
  }

  return entries;
}

function encodeMcpIdPart(value, options = {}) {
  const encoded = encodeURIComponent(value);
  return options.encodeDot ? encoded.replace(/\./g, "%2E") : encoded;
}

function normalizeModelNamePart(value) {
  return normalizeText(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function reserveUniqueModelName(candidate, hash, usedNames) {
  if (!usedNames || typeof usedNames.has !== "function" || typeof usedNames.add !== "function") {
    return candidate;
  }

  if (!usedNames.has(candidate)) {
    usedNames.add(candidate);
    return candidate;
  }

  for (let index = 0; index < 1000; index += 1) {
    const suffix = index === 0 ? `_${hash}` : `_${hash}_${index + 1}`;
    const base = candidate.slice(0, Math.max(1, 64 - suffix.length)).replace(/_+$/g, "") || "mcp_tool";
    const name = `${base}${suffix}`;
    if (MODEL_TOOL_NAME_PATTERN.test(name) && !usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
  }

  const fallback = `mcp_tool_${stableHash(`${candidate}\n${usedNames.size}`)}`;
  usedNames.add(fallback);
  return fallback;
}

function normalizeInputSchema(value) {
  return isRecord(value) ? value : { type: "object", additionalProperties: true };
}

function stableHash(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}
