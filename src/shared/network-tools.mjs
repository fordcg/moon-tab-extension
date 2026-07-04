import { redactNetworkRecord, truncateText } from "./network-redaction.mjs";

export const NETWORK_LIST_REQUESTS_TOOL_ID = "network.list_requests";
export const NETWORK_LIST_REQUESTS_TOOL_NAME = "network_list_requests";
export const NETWORK_GET_REQUEST_DETAILS_TOOL_ID = "network.get_request_details";
export const NETWORK_GET_REQUEST_DETAILS_TOOL_NAME = "network_get_request_details";

export const NETWORK_LIST_REQUESTS_DEFAULT_LIMIT = 50;
export const NETWORK_LIST_REQUESTS_MAX_LIMIT = 200;
export const NETWORK_RESOURCE_TYPES_MAX_ITEMS = 20;
export const NETWORK_RESOURCE_TYPE_MAX_LENGTH = 64;
export const NETWORK_REQUEST_IDS_MAX_ITEMS = 50;
export const NETWORK_REQUEST_ID_MAX_LENGTH = 256;

const NETWORK_GROUP_ID = "network";
const FORMAT_FIELD_MAX_LENGTH = 12000;
const LIST_ALLOWED_KEYS = new Set(["tabId", "resourceTypes", "limit"]);
const DETAILS_ALLOWED_KEYS = new Set(["tabId", "requestIds"]);

export const NETWORK_LIST_REQUESTS_PARAMETERS = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: Object.freeze({
    tabId: Object.freeze({
      type: "integer",
      minimum: 0,
      description: "可选 Chrome tabId。不传时使用当前后台缓存的 Network snapshot。",
    }),
    resourceTypes: Object.freeze({
      type: "array",
      maxItems: NETWORK_RESOURCE_TYPES_MAX_ITEMS,
      items: Object.freeze({
        type: "string",
        minLength: 1,
        maxLength: NETWORK_RESOURCE_TYPE_MAX_LENGTH,
      }),
      description: "可选资源类型过滤，大小写不敏感，例如 xhr、fetch、script。",
    }),
    limit: Object.freeze({
      type: "integer",
      minimum: 1,
      maximum: NETWORK_LIST_REQUESTS_MAX_LIMIT,
      description: `最多返回的请求数量，默认 ${NETWORK_LIST_REQUESTS_DEFAULT_LIMIT}。`,
    }),
  }),
});

export const NETWORK_GET_REQUEST_DETAILS_PARAMETERS = Object.freeze({
  type: "object",
  required: Object.freeze(["requestIds"]),
  additionalProperties: false,
  properties: Object.freeze({
    requestIds: Object.freeze({
      type: "array",
      minItems: 1,
      maxItems: NETWORK_REQUEST_IDS_MAX_ITEMS,
      items: Object.freeze({
        type: "string",
        minLength: 1,
        maxLength: NETWORK_REQUEST_ID_MAX_LENGTH,
      }),
      description: "从 network.list_requests 返回的请求 ID 列表。",
    }),
    tabId: Object.freeze({
      type: "integer",
      minimum: 0,
      description: "可选 Chrome tabId。不传时使用当前后台缓存的 Network 详情。",
    }),
  }),
});

export const NETWORK_TOOL_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: NETWORK_LIST_REQUESTS_TOOL_ID,
    name: NETWORK_LIST_REQUESTS_TOOL_NAME,
    groupId: NETWORK_GROUP_ID,
    displayName: "Network 请求列表",
    description: "列出 DevTools Network 已采集的已脱敏请求摘要。需要 DevTools 面板保持打开并连接。",
    parameters: NETWORK_LIST_REQUESTS_PARAMETERS,
  }),
  Object.freeze({
    id: NETWORK_GET_REQUEST_DETAILS_TOOL_ID,
    name: NETWORK_GET_REQUEST_DETAILS_TOOL_NAME,
    groupId: NETWORK_GROUP_ID,
    displayName: "Network 请求详情",
    description: "读取指定 DevTools Network 请求的已脱敏详情。只能使用 list_requests 返回的 requestIds。",
    parameters: NETWORK_GET_REQUEST_DETAILS_PARAMETERS,
  }),
]);

export function normalizeNetworkListRequestsArguments(value = {}) {
  if (!isPlainObject(value)) {
    return { ok: false, message: "network.list_requests 的参数必须是对象。" };
  }

  const extraKeys = Object.keys(value).filter((key) => !LIST_ALLOWED_KEYS.has(key));
  if (extraKeys.length > 0) {
    return { ok: false, message: `network.list_requests 不接受参数：${extraKeys.join("、")}。` };
  }

  const tabId = normalizeTabId(value.tabId, "network.list_requests");
  if (!tabId.ok) return tabId;

  const resourceTypes = normalizeResourceTypes(value.resourceTypes);
  if (!resourceTypes.ok) return resourceTypes;

  const limit = normalizeListLimit(value.limit);
  if (!limit.ok) return limit;

  const args = {};
  if (tabId.value !== undefined) args.tabId = tabId.value;
  if (resourceTypes.value?.length) args.resourceTypes = resourceTypes.value;
  args.limit = limit.value;
  return { ok: true, args };
}

export function normalizeNetworkGetRequestDetailsArguments(value = {}) {
  if (!isPlainObject(value)) {
    return { ok: false, message: "network.get_request_details 的参数必须是对象。" };
  }

  const extraKeys = Object.keys(value).filter((key) => !DETAILS_ALLOWED_KEYS.has(key));
  if (extraKeys.length > 0) {
    return { ok: false, message: `network.get_request_details 不接受参数：${extraKeys.join("、")}。` };
  }

  const requestIds = normalizeRequestIds(value.requestIds);
  if (!requestIds.ok) return requestIds;

  const tabId = normalizeTabId(value.tabId, "network.get_request_details");
  if (!tabId.ok) return tabId;

  const args = { requestIds: requestIds.value };
  if (tabId.value !== undefined) args.tabId = tabId.value;
  return { ok: true, args };
}

export function formatNetworkRequestsListResult(requests, options = {}) {
  const records = Array.isArray(requests) ? requests.map((request) => redactNetworkRecord(request, FORMAT_FIELD_MAX_LENGTH)) : [];
  if (records.length === 0) {
    return "未找到匹配的 Network 请求。";
  }

  const limit = normalizeFormatLimit(options?.limit, records.length);
  const visibleRecords = records.slice(0, limit);
  const lines = [
    `Network 请求列表（${visibleRecords.length}/${records.length} 个，limit=${limit}）：`,
  ];

  for (const request of visibleRecords) {
    lines.push(`- ${formatRequestListItem(request)}`);
  }

  if (records.length > visibleRecords.length) {
    lines.push(`还有 ${records.length - visibleRecords.length} 个请求未显示，请提高 limit 或缩小过滤条件。`);
  }

  return lines.join("\n");
}

export function formatNetworkRequestDetailsResult(details) {
  const records = Array.isArray(details) ? details.map((request) => redactNetworkRecord(request, FORMAT_FIELD_MAX_LENGTH)) : [];
  if (records.length === 0) {
    return "未找到请求详情。";
  }

  const lines = [`Network 请求详情（${records.length} 个）：`];
  records.forEach((request, index) => {
    if (index > 0) lines.push("");
    lines.push(`## id=${normalizeDisplayText(request?.id, "(unknown)")}`);
    lines.push(`method: ${normalizeDisplayText(request?.method, "(unknown)")}`);
    lines.push(`status: ${normalizeDisplayText(request?.status, "(unknown)")}`);
    lines.push(`resourceType: ${normalizeDisplayText(request?.resourceType, "(unknown)")}`);
    lines.push(`durationMs: ${normalizeDisplayText(request?.durationMs, "(unknown)")}`);
    lines.push(`url: ${formatLongText(request?.url)}`);
    lines.push(`flags: ${formatFlags(request) || "无"}`);
    lines.push("requestHeaders:");
    lines.push(formatHeaders(request?.requestHeaders));
    lines.push("responseHeaders:");
    lines.push(formatHeaders(request?.responseHeaders));
    lines.push("requestBody:");
    lines.push(indentBlock(formatBody(request?.requestBody)));
    lines.push("responseBody:");
    lines.push(indentBlock(formatBody(request?.responseBody)));
    if (request?.responseBodyEncoding !== undefined) {
      lines.push(`responseBodyEncoding: ${normalizeDisplayText(request.responseBodyEncoding, "(unknown)")}`);
    }
  });

  return lines.join("\n");
}

export function summarizeNetworkToolResult(result) {
  const records = Array.isArray(result)
    ? result
    : Array.isArray(result?.requests)
      ? result.requests
      : Array.isArray(result?.details)
        ? result.details
        : [];
  const redactedCount = records.filter((request) => request?.redacted === true).length;
  const truncatedCount = records.filter((request) => request?.truncated === true).length;
  const parts = [`${records.length} 个 Network 请求`];
  if (redactedCount > 0) parts.push(`${redactedCount} 个已脱敏`);
  if (truncatedCount > 0) parts.push(`${truncatedCount} 个已截断`);
  return `${parts.join("，")}。`;
}

function normalizeTabId(value, toolName) {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    return { ok: false, message: `${toolName} 的 tabId 必须是数字。` };
  }
  return { ok: true, value };
}

function normalizeListLimit(value) {
  if (value === undefined) {
    return { ok: true, value: NETWORK_LIST_REQUESTS_DEFAULT_LIMIT };
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > NETWORK_LIST_REQUESTS_MAX_LIMIT
  ) {
    return { ok: false, message: `network.list_requests 的 limit 必须是 1 到 ${NETWORK_LIST_REQUESTS_MAX_LIMIT} 的整数。` };
  }
  return { ok: true, value };
}

function normalizeResourceTypes(value) {
  if (value === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(value)) {
    return { ok: false, message: "network.list_requests 的 resourceTypes 必须是字符串数组。" };
  }
  if (value.length > NETWORK_RESOURCE_TYPES_MAX_ITEMS) {
    return { ok: false, message: `network.list_requests 的 resourceTypes 最多包含 ${NETWORK_RESOURCE_TYPES_MAX_ITEMS} 项。` };
  }

  const normalized = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const resourceType = item.trim().toLowerCase();
    if (!resourceType) continue;
    if (resourceType.length > NETWORK_RESOURCE_TYPE_MAX_LENGTH) {
      return { ok: false, message: `network.list_requests 的 resourceTypes 每项不能超过 ${NETWORK_RESOURCE_TYPE_MAX_LENGTH} 个字符。` };
    }
    if (!seen.has(resourceType)) {
      seen.add(resourceType);
      normalized.push(resourceType);
    }
  }

  return { ok: true, value: normalized };
}

function normalizeRequestIds(value) {
  if (!Array.isArray(value)) {
    return { ok: false, message: requestIdsMessage() };
  }
  if (value.length < 1 || value.length > NETWORK_REQUEST_IDS_MAX_ITEMS) {
    return { ok: false, message: requestIdsMessage() };
  }

  const normalized = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string") {
      return { ok: false, message: requestIdsMessage() };
    }
    const requestId = item.trim();
    if (!requestId || requestId.length > NETWORK_REQUEST_ID_MAX_LENGTH) {
      return { ok: false, message: requestIdsMessage() };
    }
    if (!seen.has(requestId)) {
      seen.add(requestId);
      normalized.push(requestId);
    }
  }

  if (normalized.length < 1 || normalized.length > NETWORK_REQUEST_IDS_MAX_ITEMS) {
    return { ok: false, message: requestIdsMessage() };
  }

  return { ok: true, value: normalized };
}

function requestIdsMessage() {
  return `network.get_request_details 的 requestIds 必须是包含 1 到 ${NETWORK_REQUEST_IDS_MAX_ITEMS} 个非空字符串的数组，每项最长 ${NETWORK_REQUEST_ID_MAX_LENGTH} 字符。`;
}

function formatRequestListItem(request) {
  const parts = [
    `id=${normalizeDisplayText(request?.id, "(unknown)")}`,
    normalizeDisplayText(request?.method, "(unknown)"),
    `status=${normalizeDisplayText(request?.status, "(unknown)")}`,
    `type=${normalizeDisplayText(request?.resourceType, "(unknown)")}`,
    `durationMs=${normalizeDisplayText(request?.durationMs, "(unknown)")}`,
    `url=${formatLongText(request?.url)}`,
  ];
  const flags = formatFlags(request);
  if (flags) parts.push(`flags=${flags}`);
  return parts.join(" ");
}

function formatFlags(request) {
  const flags = [];
  if (request?.redacted === true) flags.push("已脱敏");
  if (request?.truncated === true) flags.push("已截断");
  return flags.join("、");
}

function formatHeaders(headers) {
  if (!Array.isArray(headers) || headers.length === 0) {
    return "  (无)";
  }
  return headers
    .map((header) => {
      const name = normalizeDisplayText(header?.name, "(unknown)");
      const value = formatLongText(header?.value);
      return `  - ${name}: ${value}`;
    })
    .join("\n");
}

function formatBody(value) {
  const text = formatLongText(value);
  return text || "(无)";
}

function indentBlock(value) {
  return String(value)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function formatLongText(value) {
  const text = value === undefined || value === null ? "" : String(value);
  const truncated = truncateText(text, FORMAT_FIELD_MAX_LENGTH);
  if (!truncated.truncated) return truncated.text;
  return `${truncated.text}\n[内容过长，已截断]`;
}

function normalizeDisplayText(value, fallback) {
  const text = value === undefined || value === null ? "" : String(value).trim();
  return text || fallback;
}

function normalizeFormatLimit(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return Math.max(1, fallback);
  }
  return Math.min(Math.floor(value), NETWORK_LIST_REQUESTS_MAX_LIMIT);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
