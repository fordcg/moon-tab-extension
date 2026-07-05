import { REDACTED_VALUE, isSensitiveName, redactNetworkRecord, truncateText } from "./network-redaction.mjs";

export const NETWORK_LIST_REQUESTS_TOOL_ID = "network.list_requests";
export const NETWORK_LIST_REQUESTS_TOOL_NAME = "network_list_requests";
export const NETWORK_GET_REQUEST_DETAILS_TOOL_ID = "network.get_request_details";
export const NETWORK_GET_REQUEST_DETAILS_TOOL_NAME = "network_get_request_details";
export const NETWORK_CLEAR_REQUESTS_TOOL_ID = "network.clear_requests";
export const NETWORK_CLEAR_REQUESTS_TOOL_NAME = "network_clear_requests";
export const NETWORK_COMPARE_REQUESTS_TOOL_ID = "network.compare_requests";
export const NETWORK_COMPARE_REQUESTS_TOOL_NAME = "network_compare_requests";
export const NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID = "network.find_parameter_candidates";
export const NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_NAME = "network_find_parameter_candidates";
export const NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID = "network.extract_js_candidates";
export const NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME = "network_extract_js_candidates";

export const NETWORK_LIST_REQUESTS_DEFAULT_LIMIT = 50;
export const NETWORK_LIST_REQUESTS_MAX_LIMIT = 200;
export const NETWORK_RESOURCE_TYPES_MAX_ITEMS = 20;
export const NETWORK_RESOURCE_TYPE_MAX_LENGTH = 64;
export const NETWORK_REQUEST_IDS_MAX_ITEMS = 50;
export const NETWORK_REQUEST_ID_MAX_LENGTH = 256;
export const NETWORK_JS_KEYWORDS_MAX_ITEMS = 20;
export const NETWORK_JS_KEYWORD_MAX_LENGTH = 120;
export const NETWORK_JS_URL_INCLUDES_MAX_LENGTH = 240;
export const NETWORK_JS_CANDIDATES_DEFAULT_LIMIT = 12;
export const NETWORK_JS_CANDIDATES_MAX_LIMIT = 40;

const NETWORK_GROUP_ID = "network";
const FORMAT_FIELD_MAX_LENGTH = 12000;
const ANALYSIS_VALUE_MAX_LENGTH = 160;
const ANALYSIS_CANDIDATE_MAX_ITEMS = 80;
const LIST_ALLOWED_KEYS = new Set(["tabId", "resourceTypes", "limit"]);
const CLEAR_ALLOWED_KEYS = new Set(["tabId"]);
const DETAILS_ALLOWED_KEYS = new Set(["tabId", "requestIds"]);
const JS_CANDIDATES_ALLOWED_KEYS = new Set(["tabId", "requestIds", "keywords", "urlIncludes", "limit"]);
const ANALYSIS_FIELD_PREFIX_ORDER = Object.freeze(["method", "path", "query.", "requestHeaders.", "body."]);
const CANDIDATE_REASON_ORDER = Object.freeze(["签名", "时间戳", "随机数/请求 ID", "凭据", "加密或编码载荷"]);
const CANDIDATE_REASON_LABELS = Object.freeze({
  签名: "疑似签名字段",
  时间戳: "疑似时间戳字段",
  "随机数/请求 ID": "疑似随机数/请求 ID 字段",
  凭据: "疑似凭据字段",
  加密或编码载荷: "疑似加密或编码载荷",
});
const PUBLIC_CANDIDATE_LIST_BRAND = Symbol("networkParameterCandidates");
const MISSING_ANALYSIS_VALUE = "(缺失)";
const EMPTY_ANALYSIS_VALUE = "(空)";
const DEFAULT_JS_CANDIDATE_KEYWORDS = Object.freeze([
  "sign",
  "signature",
  "encrypt",
  "crypto",
  "md5",
  "sha",
  "aes",
  "nonce",
  "timestamp",
  "token",
]);
const JS_SNIPPET_RADIUS = 120;
const JS_FORMATTED_SNIPPET_MAX_LENGTH = 360;
const JS_STRING_LITERAL_SOURCE =
  "\"(?:\\\\[\\s\\S]|[^\"\\\\\\r\\n])*\"|'(?:\\\\[\\s\\S]|[^'\\\\\\r\\n])*'|`(?:\\\\[\\s\\S]|[^`\\\\])*`";
const JS_STRING_LITERAL_PATTERN = new RegExp(JS_STRING_LITERAL_SOURCE, "g");
const JS_SNIPPET_VALUE_SOURCE = `(?:${JS_STRING_LITERAL_SOURCE}|[^\\s&,;}]+)`;
const JS_NAME_SOURCE = "[A-Za-z_$][A-Za-z0-9_$%.[\\]-]*";
const JS_PROPERTY_KEY_SOURCE = "[^\"'\\r\\n]{1,160}";
const JS_ASSIGNMENT_OPERATOR_SOURCE = "\\|\\|=|\\?\\?=|\\+=|[:=]";
const JS_BARE_ASSIGNMENT_PATTERN = new RegExp(
  `\\b(${JS_NAME_SOURCE})(\\s*(?:${JS_ASSIGNMENT_OPERATOR_SOURCE})\\s*)(${JS_SNIPPET_VALUE_SOURCE})`,
  "g",
);
const JS_QUOTED_PROPERTY_PATTERN = new RegExp(
  `(["'])(${JS_PROPERTY_KEY_SOURCE})\\1(\\s*:\\s*)(${JS_SNIPPET_VALUE_SOURCE})`,
  "g",
);
const JS_COMPUTED_PROPERTY_PATTERN = new RegExp(
  `(\\[\\s*)(["'])(${JS_PROPERTY_KEY_SOURCE})\\2(\\s*\\]\\s*:\\s*)(${JS_SNIPPET_VALUE_SOURCE})`,
  "g",
);
const JS_BRACKET_ASSIGNMENT_PATTERN = new RegExp(
  `(\\[\\s*)(["'])(${JS_PROPERTY_KEY_SOURCE})\\2(\\s*\\]\\s*(?:${JS_ASSIGNMENT_OPERATOR_SOURCE})\\s*)(${JS_SNIPPET_VALUE_SOURCE})`,
  "g",
);

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

export const NETWORK_CLEAR_REQUESTS_PARAMETERS = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: Object.freeze({
    tabId: Object.freeze({
      type: "integer",
      minimum: 0,
      description: "可选 Chrome tabId。不传时清空当前后台缓存的 DevTools Network 请求。",
    }),
  }),
});

export const NETWORK_COMPARE_REQUESTS_PARAMETERS = Object.freeze({
  type: "object",
  required: Object.freeze(["requestIds"]),
  additionalProperties: false,
  properties: Object.freeze({
    requestIds: Object.freeze({
      type: "array",
      minItems: 2,
      maxItems: NETWORK_REQUEST_IDS_MAX_ITEMS,
      items: Object.freeze({
        type: "string",
        minLength: 1,
        maxLength: NETWORK_REQUEST_ID_MAX_LENGTH,
      }),
      description: "从 network.list_requests 返回的请求 ID 列表，去重后至少 2 个，用于横向对比。",
    }),
    tabId: Object.freeze({
      type: "integer",
      minimum: 0,
      description: "可选 Chrome tabId。不传时使用当前后台缓存的 Network 详情。",
    }),
  }),
});

export const NETWORK_FIND_PARAMETER_CANDIDATES_PARAMETERS = Object.freeze({
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
      description: "从 network.list_requests 返回的请求 ID 列表，用于查找疑似关键参数。",
    }),
    tabId: Object.freeze({
      type: "integer",
      minimum: 0,
      description: "可选 Chrome tabId。不传时使用当前后台缓存的 Network 详情。",
    }),
  }),
});

export const NETWORK_EXTRACT_JS_CANDIDATES_PARAMETERS = Object.freeze({
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
      description: "从 network.list_requests 返回的请求 ID 列表，用于提取 JS 候选片段。",
    }),
    tabId: Object.freeze({
      type: "integer",
      minimum: 0,
      description: "可选 Chrome tabId。不传时使用当前后台缓存的 Network 详情。",
    }),
    keywords: Object.freeze({
      type: "array",
      maxItems: NETWORK_JS_KEYWORDS_MAX_ITEMS,
      items: Object.freeze({
        type: "string",
        minLength: 1,
        maxLength: NETWORK_JS_KEYWORD_MAX_LENGTH,
      }),
      description: "可选搜索关键词，默认搜索常见签名、加密和凭据相关词。",
    }),
    urlIncludes: Object.freeze({
      type: "string",
      minLength: 1,
      maxLength: NETWORK_JS_URL_INCLUDES_MAX_LENGTH,
      description: "可选 URL 或路径片段，也会作为 JS 内容搜索词。",
    }),
    limit: Object.freeze({
      type: "integer",
      minimum: 1,
      maximum: NETWORK_JS_CANDIDATES_MAX_LIMIT,
      default: NETWORK_JS_CANDIDATES_DEFAULT_LIMIT,
      description: `最多返回的 JS 候选片段数量，默认 ${NETWORK_JS_CANDIDATES_DEFAULT_LIMIT}。`,
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
  Object.freeze({
    id: NETWORK_CLEAR_REQUESTS_TOOL_ID,
    name: NETWORK_CLEAR_REQUESTS_TOOL_NAME,
    groupId: NETWORK_GROUP_ID,
    displayName: "Network 清空请求缓存",
    description: "清空当前 DevTools Network 已采集的请求缓存。不会发送请求、读取原始凭据或关闭 DevTools。",
    parameters: NETWORK_CLEAR_REQUESTS_PARAMETERS,
  }),
  Object.freeze({
    id: NETWORK_COMPARE_REQUESTS_TOOL_ID,
    name: NETWORK_COMPARE_REQUESTS_TOOL_NAME,
    groupId: NETWORK_GROUP_ID,
    displayName: "Network 请求对比",
    description: "对比多个已脱敏 Network 请求的 method、path、query、请求头和请求体字段，找出稳定字段、变化字段和疑似关键参数。",
    parameters: NETWORK_COMPARE_REQUESTS_PARAMETERS,
  }),
  Object.freeze({
    id: NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID,
    name: NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_NAME,
    groupId: NETWORK_GROUP_ID,
    displayName: "Network 关键参数候选",
    description: "从已脱敏 Network 请求详情中查找签名、时间戳、随机数、凭据、加密或编码载荷等疑似关键参数。",
    parameters: NETWORK_FIND_PARAMETER_CANDIDATES_PARAMETERS,
  }),
  Object.freeze({
    id: NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID,
    name: NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME,
    groupId: NETWORK_GROUP_ID,
    displayName: "Network JS 候选片段",
    description: "从指定已脱敏 Network 请求详情中提取疑似签名、加密、token 或接口路径相关的 JS 片段。",
    parameters: NETWORK_EXTRACT_JS_CANDIDATES_PARAMETERS,
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
  return normalizeNetworkDetailsArguments(value, NETWORK_GET_REQUEST_DETAILS_TOOL_ID, 1);
}

export function normalizeNetworkClearRequestsArguments(value = {}) {
  if (!isPlainObject(value)) {
    return { ok: false, message: `${NETWORK_CLEAR_REQUESTS_TOOL_ID} 的参数必须是对象。` };
  }

  const extraKeys = Object.keys(value).filter((key) => !CLEAR_ALLOWED_KEYS.has(key));
  if (extraKeys.length > 0) {
    return { ok: false, message: `${NETWORK_CLEAR_REQUESTS_TOOL_ID} 不接受参数：${extraKeys.join("、")}。` };
  }

  const tabId = normalizeTabId(value.tabId, NETWORK_CLEAR_REQUESTS_TOOL_ID);
  if (!tabId.ok) return tabId;

  const args = {};
  if (tabId.value !== undefined) args.tabId = tabId.value;
  return { ok: true, args };
}

export function normalizeNetworkCompareRequestsArguments(value = {}) {
  return normalizeNetworkDetailsArguments(value, NETWORK_COMPARE_REQUESTS_TOOL_ID, 2);
}

export function normalizeNetworkFindParameterCandidatesArguments(value = {}) {
  return normalizeNetworkDetailsArguments(value, NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID, 1);
}

export function normalizeNetworkExtractJsCandidatesArguments(value = {}) {
  const details = normalizeNetworkDetailsArguments(value, NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID, 1, JS_CANDIDATES_ALLOWED_KEYS);
  if (!details.ok) return details;

  const keywords = normalizeJsCandidateKeywords(value.keywords);
  if (!keywords.ok) return keywords;

  const urlIncludes = normalizeJsUrlIncludes(value.urlIncludes);
  if (!urlIncludes.ok) return urlIncludes;

  const limit = normalizeJsCandidatesLimit(value.limit);
  if (!limit.ok) return limit;

  const args = { ...details.args };
  if (keywords.value?.length) args.keywords = keywords.value;
  if (urlIncludes.value !== undefined) args.urlIncludes = urlIncludes.value;
  if (limit.value !== NETWORK_JS_CANDIDATES_DEFAULT_LIMIT) args.limit = limit.value;
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

export function formatNetworkClearRequestsResult(result = {}) {
  const count = normalizeClearedCount(result?.clearedCount);
  const tabIdText = formatClearTabIdSuffix(result?.tabId);
  if (count === undefined) {
    return `已清空 Network 请求缓存${tabIdText}。`;
  }
  return `已清空 ${count} 个 Network 请求${tabIdText}。`;
}

export function formatNetworkCompareRequestsResult(details) {
  const records = normalizeNetworkAnalysisRecords(details);
  if (records.length === 0) {
    return "未找到请求详情。";
  }
  if (records.length < 2) {
    return "至少需要两个请求才能进行对比。请从 network.list_requests 选择两个或更多 requestIds。";
  }

  const extracted = records.map(extractNetworkAnalysisFields);
  const fields = collectNetworkAnalysisFieldNames(extracted);
  const stableFields = [];
  const changedFields = [];

  for (const fieldName of fields) {
    const values = extracted.map((entry) => getAnalysisFieldValue(entry, fieldName));
    const item = { fieldName, values };
    if (hasSameAnalysisValue(values)) {
      stableFields.push(item);
    } else {
      changedFields.push(item);
    }
  }

  const candidates = findNetworkParameterCandidatesFromFields(extracted, fields);
  const lines = [`Network 请求对比结果（${records.length} 个）：`];
  lines.push("稳定字段:");
  lines.push(formatStableAnalysisFields(stableFields));
  lines.push("变化字段:");
  lines.push(formatChangedAnalysisFields(changedFields, extracted));
  lines.push("疑似关键参数:");
  lines.push(formatNetworkParameterCandidateLines(candidates, extracted, { totalCandidateCount: candidates.length }));
  return lines.join("\n");
}

export function formatNetworkRequestsComparisonResult(details) {
  return formatNetworkCompareRequestsResult(details);
}

export function findNetworkParameterCandidates(details) {
  const analysis = createNetworkParameterCandidateAnalysis(details);
  return brandPublicNetworkParameterCandidates(
    analysis.candidates.map((candidate) => toPublicNetworkParameterCandidate(candidate, analysis.extracted)),
  );
}

export function findNetworkJsCandidates(details, options = {}) {
  const records = normalizeNetworkAnalysisRecords(details);
  const terms = createJsCandidateSearchTerms(options);
  const limit = normalizeJsCandidateResultLimit(options?.limit);
  const candidates = [];

  for (const record of records) {
    if (candidates.length >= limit) break;
    if (!isJsLikeNetworkRecord(record)) continue;

    const body = record?.responseBody === undefined || record?.responseBody === null ? "" : String(record.responseBody);
    if (!body) continue;
    const lowerBody = body.toLowerCase();
    const snippetRedactions = collectJsCandidateSnippetRedactions(body);

    for (const term of terms) {
      if (candidates.length >= limit) break;
      const lowerTerm = term.toLowerCase();
      let position = lowerBody.indexOf(lowerTerm);
      while (position >= 0 && candidates.length < limit) {
        const snippetInfo = createJsCandidateSnippet(body, position, term.length, snippetRedactions);
        const urlInfo = redactJsCandidateUrl(record?.url);
        candidates.push({
          requestId: normalizeDisplayText(record?.id, "(unknown)"),
          url: normalizeDisplayText(urlInfo.text, "(unknown)"),
          term,
          position,
          line: snippetInfo.line,
          column: snippetInfo.column,
          snippet: snippetInfo.snippet,
          redacted: Boolean(record?.redacted || urlInfo.redacted || snippetInfo.redacted),
          truncated: Boolean(record?.truncated || snippetInfo.truncated),
        });
        position = lowerBody.indexOf(lowerTerm, position + Math.max(1, lowerTerm.length));
      }
    }
  }

  return candidates;
}

export function formatNetworkJsCandidatesResult(details, options = {}) {
  const candidates = findNetworkJsCandidates(details, options);
  if (candidates.length === 0) {
    return "未找到匹配的 JS 候选资源。请先使用 network.list_requests 选择 resourceType=Script 的请求，或提供更具体的 keywords/urlIncludes 后重试。";
  }

  const lines = [`Network JS 候选片段（${candidates.length} 条）：`];
  for (const candidate of candidates) {
    const flags = formatFlags(candidate);
    lines.push(
      `- id=${normalizeDisplayText(candidate.requestId, "(unknown)")} term=${normalizeDisplayText(candidate.term, "(unknown)")} line=${candidate.line} column=${candidate.column} url=${formatLongText(candidate.url)}${flags ? ` flags=${flags}` : ""}`,
    );
    lines.push(indentBlock(formatJsCandidateSnippet(candidate.snippet)));
  }
  return lines.join("\n");
}

export function formatNetworkParameterCandidatesResult(input) {
  if (isPublicNetworkParameterCandidateList(input)) {
    return formatPublicNetworkParameterCandidates(input);
  }

  const analysis = createNetworkParameterCandidateAnalysis(input);
  if (analysis.records.length === 0) {
    return "未找到请求详情。";
  }

  const lines = [`Network 疑似关键参数（${analysis.records.length} 个请求）：`];
  lines.push(
    formatNetworkParameterCandidateLines(analysis.candidates, analysis.extracted, {
      totalCandidateCount: analysis.totalCandidateCount,
    }),
  );
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

function normalizeNetworkAnalysisRecords(details) {
  return Array.isArray(details)
    ? details.map((request) => redactNetworkRecord(request, FORMAT_FIELD_MAX_LENGTH))
    : [];
}

function createNetworkParameterCandidateAnalysis(details) {
  const records = normalizeNetworkAnalysisRecords(details);
  const extracted = records.map(extractNetworkAnalysisFields);
  const fields = collectNetworkAnalysisFieldNames(extracted);
  const allCandidates = findNetworkParameterCandidatesFromFields(extracted, fields);
  return {
    records,
    extracted,
    candidates: allCandidates.slice(0, ANALYSIS_CANDIDATE_MAX_ITEMS),
    totalCandidateCount: allCandidates.length,
  };
}

function extractNetworkAnalysisFields(record) {
  const fields = new Map();
  addAnalysisField(fields, "method", normalizeDisplayText(record?.method, "(unknown)").toUpperCase());

  const parsedUrl = parseNetworkAnalysisUrl(record?.url);
  if (parsedUrl) {
    addAnalysisField(fields, "path", parsedUrl.pathname || "/");
    for (const key of Array.from(new Set(parsedUrl.searchParams.keys()))) {
      addAnalysisField(fields, `query.${sanitizeAnalysisSegment(key)}`, parsedUrl.searchParams.getAll(key).join(", "));
    }
  } else {
    addAnalysisField(fields, "path", normalizeDisplayText(record?.url, "(unknown)"));
  }

  for (const header of Array.isArray(record?.requestHeaders) ? record.requestHeaders : []) {
    const headerName = normalizeHeaderFieldName(header?.name);
    if (!headerName) continue;
    addAnalysisField(fields, `requestHeaders.${headerName}`, header?.value);
  }

  for (const [fieldName, value] of extractRequestBodyAnalysisFields(record)) {
    addAnalysisField(fields, fieldName, value);
  }

  return {
    id: normalizeDisplayText(record?.id, "(unknown)"),
    fields,
  };
}

function parseNetworkAnalysisUrl(value) {
  const text = value === undefined || value === null ? "" : String(value).trim();
  if (!text) return undefined;

  try {
    return new URL(text);
  } catch {
    try {
      return new URL(text, "https://network.local");
    } catch {
      return undefined;
    }
  }
}

function extractRequestBodyAnalysisFields(record) {
  const fields = new Map();
  const bodyText = record?.requestBody === undefined || record?.requestBody === null ? "" : String(record.requestBody);
  const trimmed = bodyText.trim();
  if (!trimmed) return fields;

  const contentType = findRequestHeaderValue(record?.requestHeaders, "content-type").toLowerCase();
  if (isJsonRequestBody(contentType, trimmed)) {
    try {
      appendFlattenedBodyValue(fields, "body", JSON.parse(trimmed));
      return fields;
    } catch {
      // Fall through to form or plain text handling.
    }
  }

  if (isFormUrlEncodedRequestBody(contentType, trimmed)) {
    const params = new URLSearchParams(trimmed);
    for (const key of Array.from(new Set(params.keys()))) {
      addAnalysisField(fields, `body.${sanitizeAnalysisSegment(key)}`, params.getAll(key).join(", "));
    }
    if (fields.size > 0) return fields;
  }

  addAnalysisField(fields, "body.body", bodyText);
  return fields;
}

function isJsonRequestBody(contentType, text) {
  return contentType.includes("application/json") || contentType.includes("+json") || looksLikeJsonText(text);
}

function looksLikeJsonText(text) {
  return (text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"));
}

function isFormUrlEncodedRequestBody(contentType, text) {
  return contentType.includes("application/x-www-form-urlencoded") || (!contentType && looksLikeFormUrlEncodedText(text));
}

function looksLikeFormUrlEncodedText(text) {
  return /^[A-Za-z0-9_.%[\]-]+=/.test(text) && text.includes("=");
}

function appendFlattenedBodyValue(fields, prefix, value) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      addAnalysisField(fields, prefix, "[]");
      return;
    }
    value.forEach((item, index) => appendFlattenedBodyValue(fields, `${prefix}.${index}`, item));
    return;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      addAnalysisField(fields, prefix, "{}");
      return;
    }
    for (const [key, child] of entries) {
      appendFlattenedBodyValue(fields, `${prefix}.${sanitizeAnalysisSegment(key)}`, child);
    }
    return;
  }

  addAnalysisField(fields, prefix === "body" ? "body.body" : prefix, value);
}

function collectNetworkAnalysisFieldNames(extracted) {
  const names = new Set();
  for (const entry of extracted) {
    for (const fieldName of entry.fields.keys()) {
      names.add(fieldName);
    }
  }
  return Array.from(names).sort(compareAnalysisFieldNames);
}

function compareAnalysisFieldNames(left, right) {
  const leftIndex = analysisFieldPrefixIndex(left);
  const rightIndex = analysisFieldPrefixIndex(right);
  if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  return left.localeCompare(right, "en");
}

function analysisFieldPrefixIndex(fieldName) {
  const index = ANALYSIS_FIELD_PREFIX_ORDER.findIndex((prefix) =>
    fieldName === prefix || fieldName.startsWith(prefix)
  );
  return index >= 0 ? index : ANALYSIS_FIELD_PREFIX_ORDER.length;
}

function getAnalysisFieldValue(entry, fieldName) {
  return entry.fields.has(fieldName) ? entry.fields.get(fieldName) : MISSING_ANALYSIS_VALUE;
}

function hasSameAnalysisValue(values) {
  if (values.length <= 1) return true;
  const first = canonicalAnalysisValue(values[0]);
  return values.every((value) => canonicalAnalysisValue(value) === first);
}

function findNetworkParameterCandidatesFromFields(extracted, fields) {
  const candidates = [];
  for (const fieldName of fields) {
    const values = extracted.map((entry) => getAnalysisFieldValue(entry, fieldName));
    const presentValues = values.filter((value) => value !== MISSING_ANALYSIS_VALUE);
    if (presentValues.length === 0) continue;

    const reasons = detectParameterCandidateReasons(fieldName, presentValues);
    if (reasons.length === 0) continue;

    candidates.push({
      fieldName,
      reasons,
      values,
      presentCount: presentValues.length,
    });
  }

  return candidates.sort(compareNetworkParameterCandidates);
}

function compareNetworkParameterCandidates(left, right) {
  const leftReason = Math.min(...left.reasons.map(candidateReasonIndex));
  const rightReason = Math.min(...right.reasons.map(candidateReasonIndex));
  if (leftReason !== rightReason) return leftReason - rightReason;
  return compareAnalysisFieldNames(left.fieldName, right.fieldName);
}

function candidateReasonIndex(reason) {
  const index = CANDIDATE_REASON_ORDER.indexOf(reason);
  return index >= 0 ? index : CANDIDATE_REASON_ORDER.length;
}

function detectParameterCandidateReasons(fieldName, values) {
  const reasons = [];
  const baseName = getCandidateBaseName(fieldName);
  const tokens = splitCandidateNameTokens(baseName);
  const compact = tokens.join("");
  const lowerName = baseName.toLowerCase();

  if (
    hasCandidateToken(tokens, compact, ["signature", "sig", "sign", "hmac", "hash", "digest", "mac"]) ||
    lowerName.includes("signature")
  ) {
    reasons.push("签名");
  }

  if (
    hasCandidateToken(tokens, compact, ["timestamp", "ts", "time", "date", "expires", "expire", "expiry"]) ||
    compact.includes("xamzdate")
  ) {
    reasons.push("时间戳");
  }

  if (
    hasCandidateToken(tokens, compact, [
      "nonce",
      "random",
      "uuid",
      "guid",
      "requestid",
      "reqid",
      "rid",
      "traceid",
      "correlationid",
      "clientnonce",
    ])
  ) {
    reasons.push("随机数/请求 ID");
  }

  if (isCredentialCandidateName(baseName, tokens, compact)) {
    reasons.push("凭据");
  }

  if (isEncodedPayloadCandidateName(tokens, compact) || values.some(looksLikeEncodedOrEncryptedValue)) {
    reasons.push("加密或编码载荷");
  }

  return CANDIDATE_REASON_ORDER.filter((reason) => reasons.includes(reason));
}

function isCredentialCandidateName(baseName, tokens, compact) {
  if (isSensitiveName(baseName)) return true;
  return hasCandidateToken(tokens, compact, [
    "authorization",
    "auth",
    "apikey",
    "key",
    "token",
    "access",
    "refresh",
    "password",
    "passwd",
    "pwd",
    "secret",
    "session",
    "sessionid",
    "cookie",
    "setcookie",
    "credential",
    "credentials",
    "csrf",
    "xsrf",
    "bearer",
  ]);
}

function isEncodedPayloadCandidateName(tokens, compact) {
  return hasCandidateToken(tokens, compact, [
    "payload",
    "cipher",
    "ciphertext",
    "encrypted",
    "encryption",
    "encoded",
    "encoding",
    "base64",
    "blob",
    "jwt",
  ]);
}

function looksLikeEncodedOrEncryptedValue(value) {
  if (value === MISSING_ANALYSIS_VALUE || value === EMPTY_ANALYSIS_VALUE) return false;
  const text = String(value).trim();
  if (!text || text === "[已脱敏]") return false;
  if (/^[a-f0-9]{16,}$/i.test(text) && /[a-f]/i.test(text)) return true;
  if (/^[A-Za-z0-9+/_-]{16,}={0,2}$/.test(text) && /[A-Za-z]/.test(text) && /\d/.test(text)) return true;
  return false;
}

function getCandidateBaseName(fieldName) {
  const parts = String(fieldName).split(".");
  return parts[parts.length - 1] || fieldName;
}

function splitCandidateNameTokens(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function hasCandidateToken(tokens, compact, names) {
  return names.some((name) => tokens.includes(name) || compact === name || (name.length > 3 && compact.includes(name)));
}

function toPublicNetworkParameterCandidate(candidate, extracted) {
  return {
    name: getCandidateBaseName(candidate.fieldName),
    fieldName: candidate.fieldName,
    reasons: [...candidate.reasons],
    reasonLabels: candidate.reasons.map(formatCandidateReasonLabel),
    presentCount: candidate.presentCount,
    requestCount: extracted.length,
    samples: createPublicCandidateSamples(candidate.values, extracted),
  };
}

function createPublicCandidateSamples(values, extracted) {
  const samples = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === MISSING_ANALYSIS_VALUE) continue;
    samples.push({
      requestId: normalizeDisplayText(extracted[index]?.id, "(unknown)"),
      value: formatAnalysisValueForDisplay(value),
    });
    if (samples.length >= 6) break;
  }
  return samples;
}

function isPublicNetworkParameterCandidateList(value) {
  return (
    Array.isArray(value) &&
    (value[PUBLIC_CANDIDATE_LIST_BRAND] === true ||
      (value.length > 0 &&
        value.every(
          (item) =>
            item &&
            typeof item === "object" &&
            typeof item.name === "string" &&
            typeof item.fieldName === "string" &&
            Array.isArray(item.reasons) &&
            Array.isArray(item.samples),
        )))
  );
}

function brandPublicNetworkParameterCandidates(candidates) {
  Object.defineProperty(candidates, PUBLIC_CANDIDATE_LIST_BRAND, {
    value: true,
    enumerable: false,
  });
  return candidates;
}

function formatPublicNetworkParameterCandidates(candidates) {
  const visibleCandidates = candidates.slice(0, ANALYSIS_CANDIDATE_MAX_ITEMS);
  const lines = [`Network 疑似关键参数（${visibleCandidates.length}/${candidates.length} 条候选）：`];
  if (visibleCandidates.length === 0) {
    lines.push("  (未发现候选)");
    return lines.join("\n");
  }

  for (const candidate of visibleCandidates) {
    const reasonLabels = candidate.reasons.map(formatCandidateReasonLabel).join("、") || "疑似关键参数";
    const samples = formatPublicCandidateSamples(candidate);
    lines.push(
      `- ${candidate.fieldName}：${reasonLabels}；出现 ${candidate.presentCount}/${candidate.requestCount} 个请求；样例 ${samples}`,
    );
  }

  if (candidates.length > visibleCandidates.length) {
    lines.push(`另 ${candidates.length - visibleCandidates.length} 条候选未显示。`);
  }

  return lines.join("\n");
}

function formatPublicCandidateSamples(candidate) {
  const samples = candidate?.samples;
  if (!Array.isArray(samples) || samples.length === 0) return "(无)";
  return samples
    .slice(0, 6)
    .map(
      (sample) =>
        `id=${normalizeDisplayText(sample?.requestId, "(unknown)")}=${formatPublicCandidateSampleValue(candidate, sample?.value)}`,
    )
    .join("；");
}

function formatPublicCandidateSampleValue(candidate, value) {
  if (isSensitiveAnalysisFieldName(candidate?.fieldName || candidate?.name || "")) {
    return REDACTED_VALUE;
  }
  return formatAnalysisValueForDisplay(value);
}

function formatStableAnalysisFields(fields) {
  if (fields.length === 0) return "  (无)";
  return fields
    .map((field) => `- ${field.fieldName}: ${formatAnalysisValueForDisplay(field.values[0])}`)
    .join("\n");
}

function formatChangedAnalysisFields(fields, extracted) {
  if (fields.length === 0) return "  (无)";
  return fields
    .map((field) => `- ${field.fieldName}: ${formatAnalysisValueSamples(field.values, extracted)}`)
    .join("\n");
}

function formatNetworkParameterCandidateLines(candidates, extracted, options = {}) {
  if (candidates.length === 0) return "  (未发现)";
  const visibleCandidates = candidates.slice(0, ANALYSIS_CANDIDATE_MAX_ITEMS);
  const lines = visibleCandidates
    .map((candidate) => {
      const samples = formatAnalysisValueSamples(candidate.values, extracted, { onlyPresent: true });
      const reasonLabels = candidate.reasons.map(formatCandidateReasonLabel).join("、");
      return `- ${candidate.fieldName}：${reasonLabels}；出现 ${candidate.presentCount}/${extracted.length} 个请求；样例 ${samples}`;
    })
    .join("\n")
    .split("\n");
  const totalCandidateCount = options.totalCandidateCount ?? candidates.length;
  if (totalCandidateCount > visibleCandidates.length) {
    lines.push(`另 ${totalCandidateCount - visibleCandidates.length} 条候选未显示。`);
  }
  return lines.join("\n");
}

function formatCandidateReasonLabel(reason) {
  return CANDIDATE_REASON_LABELS[reason] || reason;
}

function formatAnalysisValueSamples(values, extracted, options = {}) {
  const pairs = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (options.onlyPresent && value === MISSING_ANALYSIS_VALUE) continue;
    pairs.push(`${formatAnalysisRequestRef(extracted[index])}=${formatAnalysisValueForDisplay(value)}`);
  }

  const visiblePairs = pairs.slice(0, 6);
  const suffix = pairs.length > visiblePairs.length ? `；另 ${pairs.length - visiblePairs.length} 个未显示` : "";
  return `${visiblePairs.join("；")}${suffix}`;
}

function formatAnalysisRequestRef(entry) {
  return `id=${normalizeDisplayText(entry?.id, "(unknown)")}`;
}

function addAnalysisField(fields, fieldName, value) {
  const normalizedValue = normalizeAnalysisValueForField(fieldName, value);
  if (normalizedValue === undefined) return;
  const safeFieldName = normalizeAnalysisFieldName(fieldName);
  if (!safeFieldName) return;

  if (!fields.has(safeFieldName)) {
    fields.set(safeFieldName, normalizedValue);
    return;
  }

  const previous = fields.get(safeFieldName);
  if (previous === normalizedValue) return;
  fields.set(safeFieldName, `${previous}, ${normalizedValue}`);
}

function normalizeAnalysisFieldName(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

function normalizeAnalysisValueForField(fieldName, value) {
  if (isSensitiveAnalysisFieldName(fieldName)) {
    return REDACTED_VALUE;
  }
  return normalizeAnalysisValue(value);
}

function isSensitiveAnalysisFieldName(fieldName) {
  const baseName = getCandidateBaseName(fieldName);
  return isSensitiveName(baseName);
}

function normalizeAnalysisValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return "null";
  if (typeof value === "string") {
    const text = value.trim();
    return text || EMPTY_ANALYSIS_VALUE;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function canonicalAnalysisValue(value) {
  return value === undefined ? MISSING_ANALYSIS_VALUE : String(value);
}

function formatAnalysisValueForDisplay(value) {
  const text = canonicalAnalysisValue(value);
  const truncated = truncateText(text, ANALYSIS_VALUE_MAX_LENGTH);
  if (!truncated.truncated) return truncated.text;
  return `${truncated.text} [已截断]`;
}

function findRequestHeaderValue(headers, name) {
  const normalizedName = String(name).toLowerCase();
  for (const header of Array.isArray(headers) ? headers : []) {
    if (String(header?.name || "").trim().toLowerCase() === normalizedName) {
      return String(header?.value || "");
    }
  }
  return "";
}

function normalizeHeaderFieldName(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeAnalysisSegment(value) {
  const text = String(value || "").replace(/[\r\n]+/g, " ").trim();
  return text || "(empty)";
}

function normalizeNetworkDetailsArguments(value, toolName, minRequestIds, allowedKeys = DETAILS_ALLOWED_KEYS) {
  if (!isPlainObject(value)) {
    return { ok: false, message: `${toolName} 的参数必须是对象。` };
  }

  const extraKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (extraKeys.length > 0) {
    return { ok: false, message: `${toolName} 不接受参数：${extraKeys.join("、")}。` };
  }

  const requestIds = normalizeRequestIds(value.requestIds, { toolName, minItems: minRequestIds });
  if (!requestIds.ok) return requestIds;

  const tabId = normalizeTabId(value.tabId, toolName);
  if (!tabId.ok) return tabId;

  const args = { requestIds: requestIds.value };
  if (tabId.value !== undefined) args.tabId = tabId.value;
  return { ok: true, args };
}

function normalizeJsCandidateKeywords(value) {
  if (value === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(value)) {
    return { ok: false, message: `${NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID} 的 keywords 必须是字符串数组。` };
  }
  if (value.length > NETWORK_JS_KEYWORDS_MAX_ITEMS) {
    return { ok: false, message: `${NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID} 的 keywords 最多包含 ${NETWORK_JS_KEYWORDS_MAX_ITEMS} 项。` };
  }

  const normalized = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const keyword = item.trim();
    if (!keyword) continue;
    if (keyword.length > NETWORK_JS_KEYWORD_MAX_LENGTH) {
      return { ok: false, message: `${NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID} 的 keywords 每项不能超过 ${NETWORK_JS_KEYWORD_MAX_LENGTH} 个字符。` };
    }
    const key = keyword.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      normalized.push(keyword);
    }
  }

  return { ok: true, value: normalized };
}

function normalizeJsUrlIncludes(value) {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "string") {
    return { ok: false, message: `${NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID} 的 urlIncludes 必须是字符串。` };
  }
  const text = value.trim();
  if (!text) return { ok: true, value: undefined };
  if (text.length > NETWORK_JS_URL_INCLUDES_MAX_LENGTH) {
    return { ok: false, message: `${NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID} 的 urlIncludes 不能超过 ${NETWORK_JS_URL_INCLUDES_MAX_LENGTH} 个字符。` };
  }
  return { ok: true, value: text };
}

function normalizeJsCandidatesLimit(value) {
  if (value === undefined) {
    return { ok: true, value: NETWORK_JS_CANDIDATES_DEFAULT_LIMIT };
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > NETWORK_JS_CANDIDATES_MAX_LIMIT
  ) {
    return {
      ok: false,
      message: `${NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID} 的 limit 必须是 1 到 ${NETWORK_JS_CANDIDATES_MAX_LIMIT} 的整数。`,
    };
  }
  return { ok: true, value };
}

function normalizeJsCandidateResultLimit(value) {
  const normalized = normalizeJsCandidatesLimit(value);
  return normalized.ok ? normalized.value : NETWORK_JS_CANDIDATES_DEFAULT_LIMIT;
}

function normalizeClearedCount(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

function formatClearTabIdSuffix(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "";
  return `（tabId=${Math.floor(value)}）`;
}

function createJsCandidateSearchTerms(options = {}) {
  const keywords = normalizeJsCandidateKeywords(options?.keywords);
  const terms = keywords.ok && keywords.value?.length ? [...keywords.value] : [...DEFAULT_JS_CANDIDATE_KEYWORDS];
  const urlIncludes = normalizeJsUrlIncludes(options?.urlIncludes);
  if (urlIncludes.ok && urlIncludes.value) terms.push(urlIncludes.value);

  const seen = new Set();
  return terms.filter((term) => {
    const key = term.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isJsLikeNetworkRecord(record) {
  const resourceType = String(record?.resourceType || "").trim().toLowerCase();
  if (resourceType === "script") return true;

  const pathname = parseNetworkAnalysisUrl(record?.url)?.pathname || String(record?.url || "");
  if (/\.(mjs|js)$/i.test(pathname)) return true;

  const mimeType = String(record?.mimeType || "").trim().toLowerCase();
  return mimeType.includes("javascript") || mimeType.includes("ecmascript") || mimeType === "text/jscript";
}

function createJsCandidateSnippet(body, position, termLength, snippetRedactions = []) {
  const start = Math.max(0, position - JS_SNIPPET_RADIUS);
  const end = Math.min(body.length, position + termLength + JS_SNIPPET_RADIUS);
  const redactedSnippet = redactJsCandidateSnippetWindow(body, start, end, snippetRedactions);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < body.length ? "..." : "";
  const truncated = truncateText(redactedSnippet.text, JS_FORMATTED_SNIPPET_MAX_LENGTH - prefix.length - suffix.length);
  const beforeMatch = body.slice(0, position);
  const lines = beforeMatch.split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
    snippet: `${prefix}${truncated.text}${suffix}`,
    redacted: redactedSnippet.redacted,
    truncated: truncated.truncated || start > 0 || end < body.length,
  };
}

function redactJsCandidateSnippet(value) {
  const text = String(value || "");
  return redactJsCandidateSnippetWindow(text, 0, text.length, collectJsCandidateSnippetRedactions(text));
}

function collectJsCandidateSnippetRedactions(text) {
  const ranges = [];
  collectJsCandidateSnippetRedactionRanges(ranges, text, JS_QUOTED_PROPERTY_PATTERN, (match) => {
    const [, , key, , rawValue] = match;
    return { key, rawValue, replacement: formatRedactedJsCandidateValue, redactRhsExpression: true };
  });

  collectJsCandidateSnippetRedactionRanges(ranges, text, JS_COMPUTED_PROPERTY_PATTERN, (match) => {
    const [, , , key, , rawValue] = match;
    return { key, rawValue, replacement: formatRedactedJsCandidateValue, redactRhsExpression: true };
  });

  collectJsCandidateSnippetRedactionRanges(ranges, text, JS_BRACKET_ASSIGNMENT_PATTERN, (match) => {
    const [, , , key, , rawValue] = match;
    return { key, rawValue, replacement: formatRedactedJsCandidateValue, redactRhsExpression: true };
  });

  collectJsCandidateSnippetRedactionRanges(ranges, text, JS_BARE_ASSIGNMENT_PATTERN, (match) => {
    const [, key, , rawValue] = match;
    return { key, rawValue, replacement: REDACTED_VALUE, redactRhsExpression: true };
  });

  collectJsCandidateUrlLiteralRedactionRanges(ranges, text);

  return ranges.sort((a, b) => a.start - b.start || b.end - a.end);
}

function collectJsCandidateSnippetRedactionRanges(ranges, text, pattern, createRange) {
  for (const match of text.matchAll(pattern)) {
    const range = createRange(match);
    if (!range?.rawValue || !isSensitiveName(range.key)) continue;
    const valueOffset = match[0].lastIndexOf(range.rawValue);
    if (valueOffset < 0) continue;
    const start = match.index + valueOffset;
    const end = range.redactRhsExpression ? findJsCandidateRhsEnd(text, start) : start + range.rawValue.length;
    const rawText = text.slice(start, end);
    const replacement = typeof range.replacement === "function" ? range.replacement(rawText) : range.replacement;
    ranges.push({
      start,
      end,
      replacement,
    });
  }
}

function collectJsCandidateUrlLiteralRedactionRanges(ranges, text) {
  for (const match of text.matchAll(JS_STRING_LITERAL_PATTERN)) {
    const literal = match[0];
    const redactedLiteral = redactJsCandidateUrlLiteral(literal);
    if (!redactedLiteral.redacted) continue;
    ranges.push({
      start: match.index,
      end: match.index + literal.length,
      replacement: redactedLiteral.text,
    });
  }
}

function findJsCandidateRhsEnd(text, start) {
  let quote = "";
  let escaped = false;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === ")") {
      if (parenDepth === 0) return index;
      parenDepth -= 1;
      continue;
    }
    if (char === "]") {
      if (bracketDepth === 0) return index;
      bracketDepth -= 1;
      continue;
    }
    if (char === "}") {
      if (braceDepth === 0) return index;
      braceDepth -= 1;
      continue;
    }
    if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && (char === ";" || char === "," || char === "\n" || char === "\r")) {
      return index;
    }
  }

  return text.length;
}

function redactJsCandidateSnippetWindow(body, start, end, snippetRedactions) {
  let text = "";
  let cursor = start;
  let redacted = false;

  for (const range of snippetRedactions) {
    const overlapStart = Math.max(start, range.start, cursor);
    const overlapEnd = Math.min(end, range.end);
    if (overlapEnd <= overlapStart) continue;

    text += body.slice(cursor, overlapStart);
    text += range.replacement;
    cursor = overlapEnd;
    redacted = true;
  }

  text += body.slice(cursor, end);
  return { text, redacted };
}

function formatRedactedJsCandidateValue(value) {
  const quote = String(value || "")[0];
  if (quote === "\"" || quote === "'" || quote === "`") {
    return `${quote}${REDACTED_VALUE}${quote}`;
  }
  return REDACTED_VALUE;
}

function redactJsCandidateUrlLiteral(value) {
  const text = String(value || "");
  const quote = text[0];
  if ((quote !== "\"" && quote !== "'" && quote !== "`") || text.length < 2) {
    return { text, redacted: false };
  }

  const innerText = text.slice(1, -1);
  if (!innerText.includes("?") && !innerText.includes("#")) {
    return { text, redacted: false };
  }

  const urlInfo = redactJsCandidateUrl(innerText);
  if (!urlInfo.redacted) return { text, redacted: false };
  return { text: `${quote}${urlInfo.text}${quote}`, redacted: true };
}

function redactJsCandidateUrl(value) {
  const text = value === undefined || value === null ? "" : String(value).trim();
  if (!text) return { text, redacted: false };

  const hashIndex = text.indexOf("#");
  const beforeHash = hashIndex >= 0 ? text.slice(0, hashIndex) : text;
  const hash = hashIndex >= 0 ? text.slice(hashIndex) : "";
  const urlInfo = redactJsCandidateQuerySegment(beforeHash);
  const hashInfo = redactJsCandidateQuerySegment(hash);

  if (!urlInfo.redacted && !hashInfo.redacted) return { text, redacted: false };
  return { text: `${urlInfo.text}${hashInfo.text}`, redacted: true };
}

function redactJsCandidateQuerySegment(value) {
  const queryIndex = value.indexOf("?");
  if (queryIndex >= 0) {
    return redactJsCandidateParameterSegment(value, queryIndex + 1);
  }
  if (value.startsWith("#") && value.slice(1).includes("=")) {
    return redactJsCandidateParameterSegment(value, 1);
  }
  return { text: value, redacted: false };
}

function redactJsCandidateParameterSegment(value, paramsStartIndex) {
  const params = new URLSearchParams(value.slice(paramsStartIndex));
  let redacted = false;
  for (const key of Array.from(new Set(params.keys()))) {
    if (!isSensitiveJsCandidateUrlParamName(key)) continue;
    if (params.getAll(key).some((item) => item !== REDACTED_VALUE)) {
      redacted = true;
    }
    params.set(key, REDACTED_VALUE);
  }

  if (!redacted) return { text: value, redacted: false };
  return { text: `${value.slice(0, paramsStartIndex)}${params.toString()}`, redacted: true };
}

function isSensitiveJsCandidateUrlParamName(name) {
  const normalized = String(name || "").trim().toLowerCase().replace(/\[\]$/, "");
  return normalized === "sid" || isSensitiveName(name);
}

function formatJsCandidateSnippet(value) {
  return String(value || "").replace(/\r?\n/g, "\n");
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

function normalizeRequestIds(value, options = {}) {
  const toolName = options.toolName || NETWORK_GET_REQUEST_DETAILS_TOOL_ID;
  const minItems = options.minItems || 1;
  if (!Array.isArray(value)) {
    return { ok: false, message: requestIdsMessage(toolName, minItems) };
  }
  if (value.length < 1 || value.length > NETWORK_REQUEST_IDS_MAX_ITEMS) {
    return { ok: false, message: requestIdsMessage(toolName, minItems) };
  }

  const normalized = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string") {
      return { ok: false, message: requestIdsMessage(toolName, minItems) };
    }
    const requestId = item.trim();
    if (!requestId || requestId.length > NETWORK_REQUEST_ID_MAX_LENGTH) {
      return { ok: false, message: requestIdsMessage(toolName, minItems) };
    }
    if (!seen.has(requestId)) {
      seen.add(requestId);
      normalized.push(requestId);
    }
  }

  if (normalized.length < minItems || normalized.length > NETWORK_REQUEST_IDS_MAX_ITEMS) {
    return { ok: false, message: requestIdsMessage(toolName, minItems) };
  }

  return { ok: true, value: normalized };
}

function requestIdsMessage(toolName, minItems) {
  return `${toolName} 的 requestIds 必须是包含 ${minItems} 到 ${NETWORK_REQUEST_IDS_MAX_ITEMS} 个非空字符串的数组，每项最长 ${NETWORK_REQUEST_ID_MAX_LENGTH} 字符。`;
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
