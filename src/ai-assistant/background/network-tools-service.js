import {
  NETWORK_CLEAR_REQUESTS_TOOL_ID,
  NETWORK_CLEAR_REQUESTS_TOOL_NAME,
  NETWORK_COMPARE_REQUESTS_TOOL_ID,
  NETWORK_COMPARE_REQUESTS_TOOL_NAME,
  NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID,
  NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME,
  NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID,
  NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_NAME,
  NETWORK_GET_REQUEST_DETAILS_TOOL_ID,
  NETWORK_GET_REQUEST_DETAILS_TOOL_NAME,
  NETWORK_LIST_REQUESTS_TOOL_ID,
  NETWORK_LIST_REQUESTS_TOOL_NAME,
  formatNetworkClearRequestsResult,
  formatNetworkCompareRequestsResult,
  formatNetworkJsCandidatesResult,
  formatNetworkParameterCandidatesResult,
  formatNetworkRequestDetailsResult,
  formatNetworkRequestsListResult,
  normalizeNetworkClearRequestsArguments,
  normalizeNetworkCompareRequestsArguments,
  normalizeNetworkExtractJsCandidatesArguments,
  normalizeNetworkFindParameterCandidatesArguments,
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

  if (toolKind === "list") return executeNetworkListRequestsTool(toolCall, options);
  if (toolKind === "details") return executeNetworkGetRequestDetailsTool(toolCall, options);
  if (toolKind === "clear") return executeNetworkClearRequestsTool(toolCall, options);
  if (toolKind === "compare") return executeNetworkCompareRequestsTool(toolCall, options);
  if (toolKind === "extract-js-candidates") return executeNetworkExtractJsCandidatesTool(toolCall, options);
  return executeNetworkFindParameterCandidatesTool(toolCall, options);
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

async function executeNetworkClearRequestsTool(toolCall, options) {
  const validation = normalizeNetworkClearRequestsArguments(getRawToolArguments(toolCall));
  if (!validation.ok) {
    return createToolError(toolCall, validation.message, ERROR_CODES.INVALID_ARGUMENTS);
  }

  const args = validation.args;
  if (typeof options.clearNetworkRequests !== "function") {
    return createToolError(toolCall, NETWORK_UNAVAILABLE_MESSAGE, ERROR_CODES.DEVTOOLS_UNAVAILABLE);
  }

  try {
    const response = await options.clearNetworkRequests({ tabId: args.tabId });
    if (!response?.ok) {
      return createToolError(
        toolCall,
        response?.message || NETWORK_UNAVAILABLE_MESSAGE,
        normalizeReaderErrorCode(response?.code, ERROR_CODES.DEVTOOLS_UNAVAILABLE),
      );
    }

    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: formatNetworkClearRequestsResult(response),
      summary: "Network 请求缓存已清空。",
    };
  } catch (error) {
    return createToolError(toolCall, getErrorMessage(error), ERROR_CODES.NETWORK_TOOL_ERROR);
  }
}

async function executeNetworkCompareRequestsTool(toolCall, options) {
  const validation = normalizeNetworkCompareRequestsArguments(getRawToolArguments(toolCall));
  if (!validation.ok) {
    return createToolError(toolCall, validation.message, ERROR_CODES.INVALID_ARGUMENTS);
  }

  return executeNetworkDetailsAnalysisTool(toolCall, options, validation.args, formatNetworkCompareRequestsResult);
}

async function executeNetworkFindParameterCandidatesTool(toolCall, options) {
  const validation = normalizeNetworkFindParameterCandidatesArguments(getRawToolArguments(toolCall));
  if (!validation.ok) {
    return createToolError(toolCall, validation.message, ERROR_CODES.INVALID_ARGUMENTS);
  }

  return executeNetworkDetailsAnalysisTool(toolCall, options, validation.args, formatNetworkParameterCandidatesResult);
}

async function executeNetworkExtractJsCandidatesTool(toolCall, options) {
  const validation = normalizeNetworkExtractJsCandidatesArguments(getRawToolArguments(toolCall));
  if (!validation.ok) {
    return createToolError(toolCall, validation.message, ERROR_CODES.INVALID_ARGUMENTS);
  }

  const args = validation.args;
  return executeNetworkDetailsAnalysisTool(toolCall, options, args, (details) =>
    formatNetworkJsCandidatesResult(details, args),
  );
}

async function executeNetworkDetailsAnalysisTool(toolCall, options, args, formatter) {
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

    const details = filterDetailsByRequestIds(response.details, args.requestIds);
    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: formatter(details),
      summary: summarizeNetworkToolResult(details),
    };
  } catch (error) {
    return createToolError(toolCall, getErrorMessage(error), ERROR_CODES.NETWORK_TOOL_ERROR);
  }
}

function resolveNetworkToolKind(name) {
  if (name === NETWORK_LIST_REQUESTS_TOOL_ID || name === NETWORK_LIST_REQUESTS_TOOL_NAME) return "list";
  if (name === NETWORK_GET_REQUEST_DETAILS_TOOL_ID || name === NETWORK_GET_REQUEST_DETAILS_TOOL_NAME) return "details";
  if (name === NETWORK_CLEAR_REQUESTS_TOOL_ID || name === NETWORK_CLEAR_REQUESTS_TOOL_NAME) return "clear";
  if (name === NETWORK_COMPARE_REQUESTS_TOOL_ID || name === NETWORK_COMPARE_REQUESTS_TOOL_NAME) return "compare";
  if (name === NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID || name === NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_NAME) {
    return "find-parameter-candidates";
  }
  if (name === NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID || name === NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME) {
    return "extract-js-candidates";
  }
  return undefined;
}

function applyListFilters(requests, args) {
  const records = Array.isArray(requests) ? requests : [];
  if (!args.resourceTypes?.length) return records;

  const resourceTypes = new Set(args.resourceTypes.map((type) => type.toLowerCase()));
  return records.filter((request) => resourceTypes.has(String(request?.resourceType || "").trim().toLowerCase()));
}

function filterDetailsByRequestIds(details, requestIds) {
  const records = Array.isArray(details) ? details : [];
  const detailsById = new Map();
  for (const detail of records) {
    const id = String(detail?.id ?? "").trim();
    if (id && !detailsById.has(id)) {
      detailsById.set(id, detail);
    }
  }

  return requestIds.map((id) => detailsById.get(String(id).trim())).filter(Boolean);
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
