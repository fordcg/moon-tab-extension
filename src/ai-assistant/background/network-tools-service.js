import {
  NETWORK_GET_REQUEST_DETAILS_TOOL_ID,
  NETWORK_GET_REQUEST_DETAILS_TOOL_NAME,
  NETWORK_LIST_REQUESTS_TOOL_ID,
  NETWORK_LIST_REQUESTS_TOOL_NAME,
  formatNetworkRequestDetailsResult,
  formatNetworkRequestsListResult,
  normalizeNetworkGetRequestDetailsArguments,
  normalizeNetworkListRequestsArguments,
  summarizeNetworkToolResult,
} from "../../shared/network-tools.mjs";

const NETWORK_UNAVAILABLE_MESSAGE = "DevTools Network 不可用，请保持 DevTools 面板打开并连接后重试。";
const ERROR_CODES = Object.freeze({
  INVALID_ARGUMENTS: "INVALID_ARGUMENTS",
  DEVTOOLS_UNAVAILABLE: "DEVTOOLS_UNAVAILABLE",
  UNKNOWN_NETWORK_TOOL: "UNKNOWN_NETWORK_TOOL",
  NETWORK_TOOL_ERROR: "NETWORK_TOOL_ERROR",
});

export async function executeNetworkTool(toolCall, options = {}) {
  const toolKind = resolveNetworkToolKind(toolCall?.name);
  if (!toolKind) {
    return createToolError(
      toolCall,
      `未知 Network 工具：${toolCall?.name || "(unknown)"}。`,
      ERROR_CODES.UNKNOWN_NETWORK_TOOL,
    );
  }

  return toolKind === "list"
    ? executeNetworkListRequestsTool(toolCall, options)
    : executeNetworkGetRequestDetailsTool(toolCall, options);
}

async function executeNetworkListRequestsTool(toolCall, options) {
  const validation = normalizeNetworkListRequestsArguments(getRawToolArguments(toolCall));
  if (!validation.ok) {
    return createToolError(toolCall, validation.message, ERROR_CODES.INVALID_ARGUMENTS);
  }

  const args = validation.args;
  if (typeof options.getNetworkSnapshot !== "function") {
    return createToolError(toolCall, NETWORK_UNAVAILABLE_MESSAGE, ERROR_CODES.DEVTOOLS_UNAVAILABLE);
  }

  try {
    const response = await options.getNetworkSnapshot({ tabId: args.tabId });
    if (!response?.ok) {
      return createToolError(
        toolCall,
        response?.message || NETWORK_UNAVAILABLE_MESSAGE,
        normalizeReaderErrorCode(response?.code, ERROR_CODES.DEVTOOLS_UNAVAILABLE),
      );
    }

    const requests = applyListFilters(response.requests, args);
    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: formatNetworkRequestsListResult(requests, { limit: args.limit }),
      summary: summarizeNetworkToolResult(requests),
    };
  } catch (error) {
    return createToolError(toolCall, getErrorMessage(error), ERROR_CODES.NETWORK_TOOL_ERROR);
  }
}

async function executeNetworkGetRequestDetailsTool(toolCall, options) {
  const validation = normalizeNetworkGetRequestDetailsArguments(getRawToolArguments(toolCall));
  if (!validation.ok) {
    return createToolError(toolCall, validation.message, ERROR_CODES.INVALID_ARGUMENTS);
  }

  const args = validation.args;
  if (typeof options.getNetworkDetails !== "function") {
    return createToolError(toolCall, NETWORK_UNAVAILABLE_MESSAGE, ERROR_CODES.DEVTOOLS_UNAVAILABLE);
  }

  try {
    const response = await options.getNetworkDetails({ tabId: args.tabId, requestIds: args.requestIds });
    if (!response?.ok) {
      return createToolError(
        toolCall,
        response?.message || NETWORK_UNAVAILABLE_MESSAGE,
        normalizeReaderErrorCode(response?.code, ERROR_CODES.DEVTOOLS_UNAVAILABLE),
      );
    }

    const details = Array.isArray(response.details) ? response.details : [];
    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: formatNetworkRequestDetailsResult(details),
      summary: summarizeNetworkToolResult(details),
    };
  } catch (error) {
    return createToolError(toolCall, getErrorMessage(error), ERROR_CODES.NETWORK_TOOL_ERROR);
  }
}

function resolveNetworkToolKind(name) {
  if (name === NETWORK_LIST_REQUESTS_TOOL_ID || name === NETWORK_LIST_REQUESTS_TOOL_NAME) return "list";
  if (name === NETWORK_GET_REQUEST_DETAILS_TOOL_ID || name === NETWORK_GET_REQUEST_DETAILS_TOOL_NAME) return "details";
  return undefined;
}

function applyListFilters(requests, args) {
  const records = Array.isArray(requests) ? requests : [];
  if (!args.resourceTypes?.length) return records;

  const resourceTypes = new Set(args.resourceTypes.map((type) => type.toLowerCase()));
  return records.filter((request) => resourceTypes.has(String(request?.resourceType || "").trim().toLowerCase()));
}

function createToolError(toolCall, message, code) {
  return {
    toolCallId: toolCall?.id || "",
    name: toolCall?.name || "network",
    content: message,
    isError: true,
    code,
  };
}

function normalizeReaderErrorCode(value, fallback) {
  if (Object.values(ERROR_CODES).includes(value)) return value;
  if (typeof value !== "string") return fallback;

  const normalized = value.trim().toUpperCase();
  return Object.values(ERROR_CODES).includes(normalized) ? normalized : fallback;
}

function getRawToolArguments(toolCall) {
  if (toolCall && Object.prototype.hasOwnProperty.call(toolCall, "arguments")) {
    return toolCall.arguments;
  }
  return undefined;
}

function getErrorMessage(error) {
  const message = error instanceof Error && error.message ? error.message : "";
  return message || NETWORK_UNAVAILABLE_MESSAGE;
}
