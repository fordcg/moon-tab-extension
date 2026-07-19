import {
  NETWORK_CLEAR_REQUESTS_TOOL_ID,
  NETWORK_CLEAR_REQUESTS_TOOL_NAME,
  NETWORK_COMPARE_REQUESTS_TOOL_ID,
  NETWORK_COMPARE_REQUESTS_TOOL_NAME,
  NETWORK_CREATE_PLAYBOOK_DRAFT_TOOL_ID,
  NETWORK_CREATE_PLAYBOOK_DRAFT_TOOL_NAME,
  NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID,
  NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME,
  NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID,
  NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_NAME,
  NETWORK_GET_REQUEST_DETAILS_TOOL_ID,
  NETWORK_GET_REQUEST_DETAILS_TOOL_NAME,
  NETWORK_LIST_REQUESTS_TOOL_ID,
  NETWORK_LIST_REQUESTS_TOOL_NAME,
  NETWORK_SUMMARIZE_API_CANDIDATES_TOOL_ID,
  NETWORK_SUMMARIZE_API_CANDIDATES_TOOL_NAME,
  NETWORK_WAIT_FOR_REQUESTS_TOOL_ID,
  NETWORK_WAIT_FOR_REQUESTS_TOOL_NAME,
} from "../../shared/models/toolRegistry";
import type { ModelToolCall, ModelToolResult } from "../../shared/models/types";
import type { BoundaryGrantContext } from "../../shared/toolAuthorization";
import type { ChatNetworkToolAttachment, NetworkHeader, NetworkRequestDetail, NetworkRequestMeta } from "../../shared/types";
import { createNetworkContextPrompt, formatNetworkAttachmentSummary, redactNetworkInlineSensitiveText, redactNetworkRequestDetail, redactNetworkTextSnippets } from "../../shared/networkContext";
import { truncateText } from "../../shared/utils/text";
import { isJavaScriptDetail } from "./jsSourceIndex";
import { JsSourceToolExecutor } from "./jsSourceToolExecutor";
import type { BrowserNetworkRecorder, NetworkRequestFilter, NetworkWaitFilter } from "./networkRecorder";

type NetworkToolName =
  | typeof NETWORK_LIST_REQUESTS_TOOL_ID
  | typeof NETWORK_LIST_REQUESTS_TOOL_NAME
  | typeof NETWORK_GET_REQUEST_DETAILS_TOOL_ID
  | typeof NETWORK_GET_REQUEST_DETAILS_TOOL_NAME
  | typeof NETWORK_CLEAR_REQUESTS_TOOL_ID
  | typeof NETWORK_CLEAR_REQUESTS_TOOL_NAME
  | typeof NETWORK_WAIT_FOR_REQUESTS_TOOL_ID
  | typeof NETWORK_WAIT_FOR_REQUESTS_TOOL_NAME
  | typeof NETWORK_SUMMARIZE_API_CANDIDATES_TOOL_ID
  | typeof NETWORK_SUMMARIZE_API_CANDIDATES_TOOL_NAME
  | typeof NETWORK_COMPARE_REQUESTS_TOOL_ID
  | typeof NETWORK_COMPARE_REQUESTS_TOOL_NAME
  | typeof NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID
  | typeof NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_NAME
  | typeof NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID
  | typeof NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME
  | typeof NETWORK_CREATE_PLAYBOOK_DRAFT_TOOL_ID
  | typeof NETWORK_CREATE_PLAYBOOK_DRAFT_TOOL_NAME;

interface NetworkRecorderLike {
  isEnabled: boolean | (() => boolean);
  listRequests(filter?: NetworkRequestFilter, options?: { redacted?: boolean }): NetworkRequestMeta[];
  getDetails(requestIds: string[], options?: { redacted?: boolean }): Promise<NetworkRequestDetail[]>;
  clear(): void;
  waitForRequests(filter?: NetworkWaitFilter, options?: { redacted?: boolean }): Promise<NetworkRequestMeta[]>;
}

interface ParameterCandidate {
  location: string;
  name: string;
  value: string;
  reason: string;
}

interface ApiCandidateAccumulator {
  method: string;
  urlPattern: string;
  sampleUrl: string;
  sampleIds: string[];
  statuses: Set<string>;
  resourceTypes: Set<string>;
  queryKeys: Set<string>;
  reasons: Set<string>;
  count: number;
  score: number;
  failedCount: number;
  maxDurationMs?: number;
}

interface ApiCandidateSummary {
  method: string;
  urlPattern: string;
  sampleUrl: string;
  sampleIds: string[];
  statuses: string[];
  resourceTypes: string[];
  queryKeys: string[];
  reasons: string[];
  count: number;
  score: number;
  failedCount: number;
  maxDurationMs?: number;
}

interface NetworkRequestSignature {
  requestId: string;
  method: string;
  urlPattern: string;
  urlIncludes: string;
  resourceType?: string;
  queryKeys: string[];
  bodyKeys: string[];
  requestHeaderNames: string[];
  responseStatus?: number;
  responseMimeType?: string;
  responseJsonKeys: string[];
}

const NETWORK_DISABLED_MESSAGE = "Network 采集尚未启用，请先开启浏览器控制。";
const REQUEST_IDS_INVALID_MESSAGE = "requestIds 必须是包含 1 到 100 个非空字符串的数组。";
const MAX_DETAIL_IDS = 100;
const MAX_PLAYBOOK_REQUEST_IDS = 20;
const MAX_REQUEST_ID_LENGTH = 256;
const MAX_LIST_LIMIT = 200;
const MAX_FILTER_TEXT_LENGTH = 200;
const MAX_METHOD_LENGTH = 32;
const MAX_RESOURCE_TYPE_LENGTH = 64;
const MAX_KEYWORDS = 20;
const MAX_PLAYBOOK_TEXT_LENGTH = 240;
const JS_SNIPPET_RADIUS = 120;
const DEFAULT_JS_KEYWORDS = ["sign", "signature", "encrypt", "crypto", "md5", "sha", "aes", "nonce", "timestamp", "token"];
const STATIC_RESOURCE_TYPES = new Set(["document", "stylesheet", "image", "media", "font", "script", "texttrack", "manifest"]);
const STATIC_PATH_EXTENSION_PATTERN = /\.(?:css|js|mjs|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|map|mp4|webm|mp3|wav|pdf)(?:$|\?)/i;
const NETWORK_TOOL_NAMES = new Set<string>([
  NETWORK_LIST_REQUESTS_TOOL_ID,
  NETWORK_LIST_REQUESTS_TOOL_NAME,
  NETWORK_GET_REQUEST_DETAILS_TOOL_ID,
  NETWORK_GET_REQUEST_DETAILS_TOOL_NAME,
  NETWORK_CLEAR_REQUESTS_TOOL_ID,
  NETWORK_CLEAR_REQUESTS_TOOL_NAME,
  NETWORK_WAIT_FOR_REQUESTS_TOOL_ID,
  NETWORK_WAIT_FOR_REQUESTS_TOOL_NAME,
  NETWORK_SUMMARIZE_API_CANDIDATES_TOOL_ID,
  NETWORK_SUMMARIZE_API_CANDIDATES_TOOL_NAME,
  NETWORK_COMPARE_REQUESTS_TOOL_ID,
  NETWORK_COMPARE_REQUESTS_TOOL_NAME,
  NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID,
  NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_NAME,
  NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID,
  NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME,
  NETWORK_CREATE_PLAYBOOK_DRAFT_TOOL_ID,
  NETWORK_CREATE_PLAYBOOK_DRAFT_TOOL_NAME,
]);

export class BrowserNetworkToolExecutor {
  private jsSourceExecutor: JsSourceToolExecutor | undefined;

  constructor(
    private readonly recorder: NetworkRecorderLike | BrowserNetworkRecorder,
    private readonly onClear?: () => void,
    private readonly getBoundaryGrant?: () => BoundaryGrantContext | undefined,
    private readonly isFullAccess?: () => boolean,
  ) {}

  async execute(toolCall: ModelToolCall): Promise<ModelToolResult> {
    if (!this.isEnabled()) {
      return createErrorResult(toolCall, NETWORK_DISABLED_MESSAGE);
    }

    if (!isNetworkToolName(toolCall.name)) {
      return createErrorResult(toolCall, `未知的 Network 工具：${toolCall.name}。`);
    }

    try {
      return await this.executeTool(toolCall);
    } catch {
      return createErrorResult(toolCall, "Network 工具执行失败，请稍后重试。");
    }
  }

  private async executeTool(toolCall: ModelToolCall): Promise<ModelToolResult> {
    if (isToolCallName(toolCall.name, NETWORK_CLEAR_REQUESTS_TOOL_ID, NETWORK_CLEAR_REQUESTS_TOOL_NAME)) {
      this.recorder.clear();
      this.getJsSourceExecutor().clear();
      this.onClear?.();
      return { toolCallId: toolCall.id, name: toolCall.name, content: "已清空当前受控页面的 Network 请求缓存。" };
    }

    if (isToolCallName(toolCall.name, NETWORK_LIST_REQUESTS_TOOL_ID, NETWORK_LIST_REQUESTS_TOOL_NAME)) {
      const fullAccess = this.isFullAccess?.() === true;
      const requests = this.recorder.listRequests(normalizeRequestFilter(toolCall.arguments), { redacted: !fullAccess });
      return createNetworkResult(toolCall, formatRequestList(requests), requests.map((request) => createMetaDetail(request, fullAccess)), {
        preserveRaw: fullAccess,
        fullAccess,
      });
    }

    if (isToolCallName(toolCall.name, NETWORK_WAIT_FOR_REQUESTS_TOOL_ID, NETWORK_WAIT_FOR_REQUESTS_TOOL_NAME)) {
      const fullAccess = this.isFullAccess?.() === true;
      const requests = await this.recorder.waitForRequests(normalizeWaitFilter(toolCall.arguments), { redacted: !fullAccess });
      const content = requests.length ? `已捕获 ${requests.length} 个匹配的 Network 请求：\n${formatRequestList(requests)}` : "等待 Network 请求超时，未捕获到匹配请求。";
      return createNetworkResult(toolCall, content, requests.map((request) => createMetaDetail(request, fullAccess)), {
        preserveRaw: fullAccess,
        fullAccess,
      });
    }

    if (isToolCallName(toolCall.name, NETWORK_SUMMARIZE_API_CANDIDATES_TOOL_ID, NETWORK_SUMMARIZE_API_CANDIDATES_TOOL_NAME)) {
      const fullAccess = this.isFullAccess?.() === true;
      const requests = this.recorder.listRequests(normalizeRequestFilter(toolCall.arguments), { redacted: !fullAccess });
      return createNetworkResult(toolCall, summarizeApiCandidates(requests, toolCall.arguments), requests.map((request) => createMetaDetail(request, fullAccess)), {
        preserveRaw: fullAccess,
        fullAccess,
      });
    }

    if (isToolCallName(toolCall.name, NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID, NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME) && toolCall.arguments.requestIds === undefined) {
      const jsResult = await this.getJsSourceExecutor().searchForNetworkCompatibility(toolCall.arguments);
      return createNetworkResult(toolCall, jsResult.content, jsResult.resources.map((resource) => createMetaDetail({
        id: resource.id,
        url: resource.url,
        method: "GET",
        mimeType: resource.mimeType,
        resourceType: "Script",
      })));
    }

    const requestIds = normalizeRequestIds(toolCall.arguments.requestIds);
    if (!requestIds.ok) {
      return createErrorResult(toolCall, requestIds.message);
    }
    if (isToolCallName(toolCall.name, NETWORK_CREATE_PLAYBOOK_DRAFT_TOOL_ID, NETWORK_CREATE_PLAYBOOK_DRAFT_TOOL_NAME) && requestIds.requestIds.length > MAX_PLAYBOOK_REQUEST_IDS) {
      return createErrorResult(toolCall, `requestIds 最多支持 ${MAX_PLAYBOOK_REQUEST_IDS} 个请求用于生成 Playbook 草稿。`);
    }

    const revealCurrentResult = this.canRevealCurrentToolResult();
    const details = await this.recorder.getDetails(requestIds.requestIds, { redacted: !revealCurrentResult });
    if (isToolCallName(toolCall.name, NETWORK_GET_REQUEST_DETAILS_TOOL_ID, NETWORK_GET_REQUEST_DETAILS_TOOL_NAME)) {
      return createNetworkResult(toolCall, createNetworkContextPrompt({ userDemand: "Network 工具读取请求详情", details }), details, {
        preserveRaw: revealCurrentResult,
        fullAccess: this.isFullAccess?.() === true,
      });
    }

    if (isToolCallName(toolCall.name, NETWORK_COMPARE_REQUESTS_TOOL_ID, NETWORK_COMPARE_REQUESTS_TOOL_NAME)) {
      return createNetworkResult(toolCall, compareRequests(details), details, {
        preserveRaw: revealCurrentResult,
        fullAccess: this.isFullAccess?.() === true,
      });
    }

    if (isToolCallName(toolCall.name, NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID, NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_NAME)) {
      return createNetworkResult(toolCall, formatParameterCandidates(findParameterCandidates(details)), details, {
        preserveRaw: revealCurrentResult,
        fullAccess: this.isFullAccess?.() === true,
      });
    }

    if (isToolCallName(toolCall.name, NETWORK_CREATE_PLAYBOOK_DRAFT_TOOL_ID, NETWORK_CREATE_PLAYBOOK_DRAFT_TOOL_NAME)) {
      return createNetworkResult(toolCall, createNetworkPlaybookDraft(details, toolCall.arguments), details, {
        preserveRaw: revealCurrentResult,
        fullAccess: this.isFullAccess?.() === true,
      });
    }

    return createNetworkResult(toolCall, extractJsCandidates(details, toolCall.arguments), details, {
      preserveRaw: revealCurrentResult,
      fullAccess: this.isFullAccess?.() === true,
    });
  }

  private isEnabled(): boolean {
    return typeof this.recorder.isEnabled === "function" ? this.recorder.isEnabled() : this.recorder.isEnabled;
  }

  private getJsSourceExecutor(): JsSourceToolExecutor {
    this.jsSourceExecutor ??= new JsSourceToolExecutor({
      recorder: this.recorder,
      getCurrentPageUrl: async () => "",
      fetcher: { fetch: async () => ({ ok: false, url: "", message: "同源 JS 补位不可用于 Network 兼容入口。" }) },
    });
    return this.jsSourceExecutor;
  }

  private canRevealCurrentToolResult(): boolean {
    const grant = this.getBoundaryGrant?.();
    return Boolean(grant?.grants.includes("include_sensitive_field_in_current_tool_result") &&
      grant.grants.includes("write_sensitive_result_to_chat_once"));
  }

}

function isNetworkToolName(name: string): name is NetworkToolName {
  return NETWORK_TOOL_NAMES.has(name);
}

function isToolCallName(name: string, legacyId: string, publicName: string): boolean {
  return name === legacyId || name === publicName;
}

function normalizeRequestFilter(args: Record<string, unknown>): NetworkRequestFilter {
  return {
    urlIncludes: normalizeOptionalString(args.urlIncludes, MAX_FILTER_TEXT_LENGTH),
    method: normalizeOptionalString(args.method, MAX_METHOD_LENGTH),
    resourceType: normalizeOptionalString(args.resourceType, MAX_RESOURCE_TYPE_LENGTH),
    status: typeof args.status === "number" && Number.isInteger(args.status) ? args.status : undefined,
    limit: normalizeLimit(args.limit),
  };
}

function normalizeWaitFilter(args: Record<string, unknown>): NetworkWaitFilter {
  return {
    ...normalizeRequestFilter(args),
    timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
  };
}

function normalizeRequestIds(value: unknown): { ok: true; requestIds: string[] } | { ok: false; message: string } {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_DETAIL_IDS) {
    return { ok: false, message: REQUEST_IDS_INVALID_MESSAGE };
  }

  const requestIds = value.map((item) => (typeof item === "string" ? item.trim() : ""));
  if (requestIds.some((item) => !item || item.length > MAX_REQUEST_ID_LENGTH)) {
    return { ok: false, message: REQUEST_IDS_INVALID_MESSAGE };
  }

  return { ok: true, requestIds: Array.from(new Set(requestIds)) };
}

function normalizeOptionalString(value: unknown, maxLength = MAX_FILTER_TEXT_LENGTH): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function normalizeAndRedactOptionalString(value: unknown, maxLength = MAX_FILTER_TEXT_LENGTH): string | undefined {
  const normalized = normalizeOptionalString(value, maxLength);
  return normalized ? redactNetworkTextSnippets(redactNetworkInlineSensitiveText(normalized)) : undefined;
}

function normalizeLimit(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(Math.max(Math.floor(value), 1), MAX_LIST_LIMIT);
}

function formatRequestList(requests: NetworkRequestMeta[]): string {
  if (requests.length === 0) {
    return "未找到匹配的 Network 请求。";
  }

  return requests
    .map((request, index) =>
      `${index + 1}. id=${request.id} | ${request.method || "GET"} | ${request.status ?? "unknown"} | ${request.resourceType ?? "unknown"} | ${request.url}`,
    )
    .join("\n");
}

function createMetaDetail(meta: NetworkRequestMeta, fullAccess = false): NetworkRequestDetail {
  const detail = {
    ...meta,
    truncated: false,
    redacted: false,
  };
  return fullAccess ? detail : redactNetworkRequestDetail(detail);
}

function createNetworkResult(
  toolCall: ModelToolCall,
  content: string,
  details: NetworkRequestDetail[],
  options: { preserveRaw?: boolean; fullAccess?: boolean } = {},
): ModelToolResult {
  return {
    toolCallId: toolCall.id,
    name: toolCall.name,
    content,
    ...(details.length ? { toolAttachments: [createNetworkAttachment(toolCall.id, details, options)] } : {}),
  };
}

function createNetworkAttachment(
  sourceToolCallId: string,
  details: NetworkRequestDetail[],
  options: { preserveRaw?: boolean; fullAccess?: boolean } = {},
): ChatNetworkToolAttachment {
  const preserveRaw = options.preserveRaw === true;
  const requests = preserveRaw ? details : details.map(redactNetworkRequestDetail);
  return {
    id: `tool-attachment-${sourceToolCallId}`,
    kind: "network",
    title: "Network 请求详情",
    summary: formatNetworkAttachmentSummary(requests),
    sourceToolCallId,
    createdAt: Date.now(),
    redacted: !preserveRaw,
    fullAccess: options.fullAccess === true && preserveRaw ? true : undefined,
    truncated: requests.some((request) => request.truncated),
    requests,
  };
}

function createErrorResult(toolCall: ModelToolCall, content: string): ModelToolResult {
  return {
    toolCallId: toolCall.id,
    name: toolCall.name,
    content,
    isError: true,
  };
}

function summarizeApiCandidates(requests: NetworkRequestMeta[], args: Record<string, unknown>): string {
  if (requests.length === 0) {
    return "未找到可分析的 Network 请求。";
  }

  const includeStaticAssets = args.includeStaticAssets === true;
  const candidates = createApiCandidateSummaries(requests, includeStaticAssets);
  if (candidates.length === 0) {
    return [
      "Network API 候选总览",
      "",
      `读取请求数：${requests.length}`,
      "未识别出明显 API 候选。可放宽过滤条件、执行目标页面操作后重试，或设置 includeStaticAssets=true 检查脚本/静态资源。",
    ].join("\n");
  }

  const shown = candidates.slice(0, 20);
  return [
    "Network API 候选总览",
    "",
    `读取请求数：${requests.length}`,
    `候选接口数：${candidates.length}`,
    `静态资源纳入：${includeStaticAssets ? "是" : "否"}`,
    "",
    ...shown.map(formatApiCandidateSummary),
    "",
    "建议下一步：",
    "- 先对高置信候选调用 network_get_request_details 读取脱敏详情。",
    "- 同一接口有多个样本时调用 network_compare_requests 对比稳定字段、变化字段和疑似签名参数。",
    "- 需要沉淀为可复用流程时，对目标 requestIds 调用 network_create_playbook_draft。",
  ].join("\n");
}

function createApiCandidateSummaries(requests: NetworkRequestMeta[], includeStaticAssets: boolean): ApiCandidateSummary[] {
  const groups = new Map<string, ApiCandidateAccumulator>();
  for (const request of requests) {
    const signal = scoreApiCandidate(request);
    if (!includeStaticAssets && !signal.likelyApi) {
      continue;
    }

    const method = (request.method || "GET").toUpperCase();
    const urlPattern = createEndpointUrlPattern(request.url);
    const key = `${method} ${urlPattern}`;
    const parsedUrl = safeUrl(request.url);
    const current = groups.get(key) ?? {
      method,
      urlPattern,
      sampleUrl: request.url,
      sampleIds: [],
      statuses: new Set<string>(),
      resourceTypes: new Set<string>(),
      queryKeys: new Set<string>(),
      reasons: new Set<string>(),
      count: 0,
      score: 0,
      failedCount: 0,
    };
    current.count += 1;
    current.score = Math.max(current.score, signal.score);
    if (current.sampleIds.length < 5) {
      current.sampleIds.push(request.id);
    }
    current.statuses.add(String(request.status ?? "unknown"));
    current.resourceTypes.add(request.resourceType || "unknown");
    for (const key of parsedUrl.searchParams.keys()) {
      current.queryKeys.add(key);
    }
    for (const reason of signal.reasons) {
      current.reasons.add(reason);
    }
    if (request.failed || (typeof request.status === "number" && request.status >= 400)) {
      current.failedCount += 1;
    }
    if (typeof request.durationMs === "number" && Number.isFinite(request.durationMs)) {
      current.maxDurationMs = Math.max(current.maxDurationMs ?? 0, request.durationMs);
    }
    groups.set(key, current);
  }

  return Array.from(groups.values())
    .map((item): ApiCandidateSummary => ({
      method: item.method,
      urlPattern: item.urlPattern,
      sampleUrl: item.sampleUrl,
      sampleIds: item.sampleIds,
      statuses: Array.from(item.statuses).sort(),
      resourceTypes: Array.from(item.resourceTypes).sort(),
      queryKeys: Array.from(item.queryKeys).sort().slice(0, 20),
      reasons: Array.from(item.reasons).slice(0, 8),
      count: item.count,
      score: item.score + Math.min(item.count - 1, 3),
      failedCount: item.failedCount,
      maxDurationMs: item.maxDurationMs,
    }))
    .sort((a, b) => b.score - a.score || b.count - a.count || a.urlPattern.localeCompare(b.urlPattern));
}

function scoreApiCandidate(request: NetworkRequestMeta): { score: number; reasons: string[]; likelyApi: boolean } {
  const method = (request.method || "GET").toUpperCase();
  const resourceType = (request.resourceType || "").toLowerCase();
  const mimeType = (request.mimeType || "").toLowerCase();
  const url = safeUrl(request.url);
  const path = url.pathname.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  if (["xhr", "fetch", "websocket", "eventsource"].includes(resourceType)) {
    score += 4;
    reasons.push(`资源类型=${request.resourceType}`);
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    score += 3;
    reasons.push(`非只读方法=${method}`);
  }
  if (/\b(json|graphql|event-stream|x-www-form-urlencoded|protobuf|grpc)\b/.test(mimeType)) {
    score += 3;
    reasons.push(`响应类型=${request.mimeType}`);
  }
  if (/\/(?:api|ajax|graphql|rpc|rest|v\d+)(?:\/|$)/i.test(path) || path.includes("/api/") || path.endsWith("/graphql")) {
    score += 3;
    reasons.push("路径疑似接口");
  }
  if (typeof request.status === "number" && request.status >= 400) {
    score += 2;
    reasons.push(`错误状态=${request.status}`);
  }
  if (request.failed || request.error) {
    score += 2;
    reasons.push("请求失败");
  }
  if (request.requestBody) {
    score += 2;
    reasons.push("存在请求体");
  }
  if (url.searchParams.size > 0) {
    score += 1;
    reasons.push("存在查询参数");
  }
  if (typeof request.durationMs === "number" && request.durationMs >= 2000) {
    score += 1;
    reasons.push(`耗时较长=${Math.round(request.durationMs)}ms`);
  }
  if (!isLikelyStaticAsset(request)) {
    score += 1;
  }

  const likelyApi = score >= 4 && (!isLikelyStaticAsset(request) || ["xhr", "fetch", "websocket", "eventsource"].includes(resourceType));
  return { score, reasons: reasons.length ? reasons : ["普通请求"], likelyApi };
}

function formatApiCandidateSummary(candidate: ApiCandidateSummary, index: number): string {
  const confidence = candidate.score >= 9 ? "高" : candidate.score >= 6 ? "中" : "低";
  const duration = typeof candidate.maxDurationMs === "number" ? ` | 最慢=${Math.round(candidate.maxDurationMs)}ms` : "";
  const failed = candidate.failedCount > 0 ? ` | 失败/错误=${candidate.failedCount}` : "";
  const query = candidate.queryKeys.length ? `\n   查询参数：${candidate.queryKeys.join("、")}` : "";
  return [
    `${index + 1}. [${confidence}] ${candidate.method} ${candidate.urlPattern}`,
    `   ids=${candidate.sampleIds.join(", ")} | 次数=${candidate.count} | 状态=${candidate.statuses.join("/")} | 类型=${candidate.resourceTypes.join("/")}${duration}${failed}`,
    `   线索：${candidate.reasons.join("；")}`,
    `   建议：network_get_request_details {"requestIds":[${candidate.sampleIds.map((id) => `"${id}"`).join(",")}]}${candidate.count > 1 ? "；network_compare_requests 可横向对比样本" : ""}`,
    query,
  ].filter(Boolean).join("\n");
}

function isLikelyStaticAsset(request: NetworkRequestMeta): boolean {
  const resourceType = (request.resourceType || "").toLowerCase();
  if (STATIC_RESOURCE_TYPES.has(resourceType)) {
    return true;
  }
  return STATIC_PATH_EXTENSION_PATTERN.test(request.url);
}

function createNetworkPlaybookDraft(details: NetworkRequestDetail[], args: Record<string, unknown>): string {
  if (details.length === 0) {
    return "未找到请求详情，无法生成 Playbook 草稿。";
  }

  const signatures = details.map(createRequestSignature);
  const primary = signatures[0];
  const title = normalizeAndRedactOptionalString(args.title, 120) ?? `接口复用：${primary.method} ${primary.urlIncludes}`;
  const objective = normalizeAndRedactOptionalString(args.objective, MAX_PLAYBOOK_TEXT_LENGTH) ?? `复用 ${primary.method} ${primary.urlPattern} 的接口分析流程`;
  const includeResponseHints = args.includeResponseHints !== false;
  const draft = {
    id: createPlaybookDraftId(title, primary),
    title,
    description: `由 ${details.length} 条 Network 请求详情生成的接口分析 Playbook 草稿。`,
    tags: ["Network", "API", "接口", "自动化"],
    source: "skill",
    defaultEnabled: true,
    risk: "high",
    recommendedCapabilities: ["observe_page", "analyze_site", "confirm_boundary"],
    selectionHints: uniqueStrings([
      title,
      objective,
      primary.urlIncludes,
      ...signatures.map((signature) => signature.urlPattern),
    ]).slice(0, 8),
    prompt: createNetworkPlaybookPrompt(title, objective, signatures, includeResponseHints),
  };

  return [
    "接口 Playbook 草稿",
    "",
    "可复制到自动化策略导入的 JSON：",
    "```json",
    JSON.stringify(draft, null, 2),
    "```",
    "",
    "请求签名摘要：",
    ...signatures.map(formatRequestSignature),
    "",
    "注意：草稿只固化脱敏后的结构化线索，不会开启未授权权限；后续读取敏感原文、请求重放或完全访问仍必须走现有边界确认。",
  ].join("\n");
}

function createRequestSignature(detail: NetworkRequestDetail): NetworkRequestSignature {
  const url = safeUrl(detail.url);
  return {
    requestId: detail.id,
    method: (detail.method || "GET").toUpperCase(),
    urlPattern: createEndpointUrlPattern(detail.url),
    urlIncludes: createUrlIncludesHint(detail.url),
    resourceType: detail.resourceType,
    queryKeys: Array.from(url.searchParams.keys()).slice(0, 20),
    bodyKeys: parseBodyFields(detail.requestBody, detail.requestHeaders).map(([key]) => key).slice(0, 30),
    requestHeaderNames: uniqueStrings((detail.requestHeaders ?? []).map((header) => header.name.toLowerCase())).slice(0, 30),
    responseStatus: detail.status,
    responseMimeType: detail.mimeType,
    responseJsonKeys: extractJsonFieldKeys(detail.responseBody).slice(0, 30),
  };
}

function formatRequestSignature(signature: NetworkRequestSignature, index: number): string {
  return [
    `${index + 1}. ${signature.method} ${signature.urlPattern}`,
    `   requestId=${signature.requestId} | urlIncludes=${signature.urlIncludes}${signature.resourceType ? ` | resourceType=${signature.resourceType}` : ""}${signature.responseStatus ? ` | status=${signature.responseStatus}` : ""}`,
    signature.queryKeys.length ? `   query：${signature.queryKeys.join("、")}` : "",
    signature.bodyKeys.length ? `   body：${signature.bodyKeys.join("、")}` : "",
    signature.requestHeaderNames.length ? `   request headers：${signature.requestHeaderNames.join("、")}` : "",
    signature.responseJsonKeys.length ? `   response JSON：${signature.responseJsonKeys.join("、")}` : "",
  ].filter(Boolean).join("\n");
}

function createNetworkPlaybookPrompt(title: string, objective: string, signatures: NetworkRequestSignature[], includeResponseHints: boolean): string {
  const urlHints = uniqueStrings(signatures.map((signature) => signature.urlIncludes));
  const signatureLines = signatures.map((signature) => {
    const responseHints = includeResponseHints
      ? `；响应=${signature.responseStatus ?? "unknown"} ${signature.responseMimeType ?? "unknown"}${signature.responseJsonKeys.length ? `；响应字段=${signature.responseJsonKeys.join("、")}` : ""}`
      : "";
    return `- ${signature.method} ${signature.urlPattern}（urlIncludes=${signature.urlIncludes}；query=${signature.queryKeys.join("、") || "无"}；body=${signature.bodyKeys.join("、") || "无"}${responseHints}）`;
  });
  return [
    `任务策略：${title}`,
    `目标：${objective}`,
    "执行流程：",
    "1) 先确认当前页面和用户要触发的业务动作；若要观察新增请求，先调用 network_clear_requests 建立干净窗口。",
    `2) 触发业务动作后调用 network_wait_for_requests，urlIncludes 优先从以下片段选择：${urlHints.join("、") || "按页面现场选择"}。`,
    "3) 调用 network_summarize_api_candidates 复核候选接口，再对目标 requestIds 调用 network_get_request_details 读取脱敏详情。",
    "4) 同一接口有多次样本时调用 network_compare_requests；需要定位签名、时间戳、nonce、token 或加密载荷时调用 network_find_parameter_candidates。",
    "5) 需要追踪前端生成逻辑时，使用 network_extract_js_candidates 或 JS/Source Map 工具搜索接口路径和关键参数名。",
    "6) 工具结果出现脱敏字段、敏感字段、截断、同源读取、请求重放或完全访问边界时，必须按现有 boundary_request_user_choice 规则请求用户确认。",
    "接口签名：",
    ...signatureLines,
  ].join("\n");
}

function createEndpointUrlPattern(value: string): string {
  const url = safeUrl(value);
  const path = url.pathname
    .replace(/\/[0-9a-f]{16,}(?=\/|$)/gi, "/{id}")
    .replace(/\/[0-9]+(?=\/|$)/g, "/{id}")
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{13,}(?=\/|$)/gi, "/{id}");
  return `${url.origin}${path || "/"}`;
}

function createUrlIncludesHint(value: string): string {
  const url = safeUrl(value);
  const path = url.pathname || "/";
  if (path.length <= 80) {
    return path;
  }
  const parts = path.split("/").filter(Boolean);
  return parts.length ? `/${parts.slice(-2).join("/")}`.slice(0, 80) : path.slice(0, 80);
}

function createPlaybookDraftId(title: string, primary: NetworkRequestSignature): string {
  const raw = `${title} ${primary.method} ${primary.urlPattern}`.toLowerCase();
  const slug = raw
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  if (/^[a-z][a-z0-9_]{1,63}$/.test(slug)) {
    return slug;
  }
  return `network_api_${hashText(raw)}`;
}

function hashText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36).slice(0, 10);
}

function extractJsonFieldKeys(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return uniqueStrings(flattenJson(parsed).map(([key]) => key)).slice(0, 30);
  } catch {
    return [];
  }
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean)));
}

function compareRequests(details: NetworkRequestDetail[]): string {
  if (details.length < 2) {
    return "至少需要两个请求才能进行对比。";
  }

  const fieldsByRequest = details.map(flattenRequestFields);
  const allKeys = Array.from(new Set(fieldsByRequest.flatMap((fields) => Array.from(fields.keys())))).sort();
  const stableFields: string[] = [];
  const changedFields: string[] = [];
  for (const key of allKeys) {
    const values = fieldsByRequest.map((fields) => fields.get(key) ?? "");
    const uniqueValues = Array.from(new Set(values));
    if (uniqueValues.length <= 1) {
      stableFields.push(`${key}=${truncateText(uniqueValues[0] ?? "", 160).text}`);
    } else {
      changedFields.push(`${key}: ${uniqueValues.map((value) => truncateText(value, 80).text).join(" -> ")}`);
    }
  }

  const candidates = findParameterCandidates(details);
  return [
    "Network 请求对比结果",
    "",
    "稳定字段：",
    stableFields.slice(0, 30).map((item) => `- ${item}`).join("\n") || "- 无",
    "",
    "变化字段：",
    changedFields.slice(0, 50).map((item) => `- ${item}`).join("\n") || "- 无",
    "",
    "疑似关键参数：",
    formatParameterCandidates(candidates),
  ].join("\n");
}

function flattenRequestFields(detail: NetworkRequestDetail): Map<string, string> {
  const fields = new Map<string, string>();
  fields.set("method", detail.method);
  fields.set("path", safeUrl(detail.url).pathname);
  for (const [key, value] of safeUrl(detail.url).searchParams.entries()) {
    fields.set(`query.${key}`, value);
  }
  for (const header of detail.requestHeaders ?? []) {
    fields.set(`requestHeader.${header.name.toLowerCase()}`, header.value);
  }
  for (const [key, value] of parseBodyFields(detail.requestBody, detail.requestHeaders)) {
    fields.set(`body.${key}`, value);
  }
  return fields;
}

function findParameterCandidates(details: NetworkRequestDetail[]): ParameterCandidate[] {
  const candidates: ParameterCandidate[] = [];
  for (const detail of details) {
    for (const [key, value] of safeUrl(detail.url).searchParams.entries()) {
      appendCandidate(candidates, "query", key, value);
    }
    for (const header of detail.requestHeaders ?? []) {
      appendCandidate(candidates, "requestHeader", header.name, header.value);
    }
    for (const [key, value] of parseBodyFields(detail.requestBody, detail.requestHeaders)) {
      appendCandidate(candidates, "body", key, value);
    }
  }
  return candidates;
}

function appendCandidate(candidates: ParameterCandidate[], location: string, name: string, value: string): void {
  const lowerName = name.toLowerCase();
  const lowerValue = value.toLowerCase();
  const reasons: string[] = [];
  if (/sign|signature|sig|x-sign/.test(lowerName)) {
    reasons.push("疑似签名字段");
  }
  if (/timestamp|time|ts|_t/.test(lowerName)) {
    reasons.push("疑似时间戳字段");
  }
  if (/nonce|uuid|requestid|traceid|random/.test(lowerName)) {
    reasons.push("疑似随机数或请求标识字段");
  }
  if (/token|authorization|cookie/.test(lowerName)) {
    reasons.push("疑似凭据字段");
  }
  if (/^[a-f0-9]{24,}$/i.test(value) || /^[a-z0-9_-]{32,}$/i.test(value) || /[+/=]{2,}/.test(value) || lowerValue.includes("%3d")) {
    reasons.push("疑似加密或编码载荷");
  }

  for (const reason of reasons) {
    candidates.push({ location, name, value: truncateText(value, 160).text, reason });
  }
}

function formatParameterCandidates(candidates: ParameterCandidate[]): string {
  if (candidates.length === 0) {
    return "未发现明显的参数候选。";
  }

  return candidates
    .slice(0, 80)
    .map((candidate) => `- ${candidate.reason}: ${candidate.location}.${candidate.name}=${candidate.value}`)
    .join("\n");
}

function extractJsCandidates(details: NetworkRequestDetail[], args: Record<string, unknown>): string {
  const keywords = normalizeStringArray(args.keywords);
  const urlIncludes = normalizeOptionalString(args.urlIncludes);
  const searchTerms = keywords.length ? keywords : DEFAULT_JS_KEYWORDS;
  const sections: string[] = [];
  for (const detail of details) {
    if (!isJavaScriptDetail(detail)) {
      continue;
    }

    const body = detail.responseBody ?? "";
    const matches = [...searchTerms, ...(urlIncludes ? [urlIncludes] : [])].flatMap((term) => findSnippets(body, term));
    if (matches.length === 0) {
      continue;
    }

    sections.push([
      `JS 候选资源：${detail.url}`,
      ...matches.slice(0, 8).map((match) => `- 命中 ${match.term}: ${match.snippet}`),
    ].join("\n"));
  }

  return sections.length ? sections.join("\n\n") : "未找到匹配的 JS 候选资源。";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.map((item) => (typeof item === "string" ? item.trim().slice(0, MAX_FILTER_TEXT_LENGTH) : "")).filter(Boolean))).slice(0, MAX_KEYWORDS);
}

function findSnippets(text: string, term: string): Array<{ term: string; snippet: string }> {
  if (!text || !term) {
    return [];
  }

  const lowerText = text.toLowerCase();
  const lowerTerm = term.toLowerCase();
  const index = lowerText.indexOf(lowerTerm);
  if (index < 0) {
    return [];
  }

  const start = Math.max(0, index - JS_SNIPPET_RADIUS);
  const end = Math.min(text.length, index + term.length + JS_SNIPPET_RADIUS);
  return [{ term, snippet: truncateText(text.slice(start, end).replace(/\s+/g, " "), 320).text }];
}

function parseBodyFields(body: string | undefined, requestHeaders: NetworkHeader[] | undefined): Array<[string, string]> {
  if (!body) {
    return [];
  }

  if (isJsonBody(requestHeaders)) {
    try {
      const parsed = JSON.parse(body) as unknown;
      return flattenJson(parsed);
    } catch {
      return [["body", truncateText(body, 320).text]];
    }
  }

  if (isFormUrlEncoded(requestHeaders)) {
    const params = new URLSearchParams(body);
    return Array.from(params.entries());
  }

  return [["body", truncateText(body, 320).text]];
}

function isJsonBody(headers: NetworkHeader[] | undefined): boolean {
  return headers?.some((header) => header.name.toLowerCase() === "content-type" && header.value.toLowerCase().includes("json")) ?? false;
}

function isFormUrlEncoded(headers: NetworkHeader[] | undefined): boolean {
  return headers?.some((header) => header.name.toLowerCase() === "content-type" && header.value.toLowerCase().includes("application/x-www-form-urlencoded")) ?? false;
}

function flattenJson(value: unknown, prefix = ""): Array<[string, string]> {
  if (value === null || value === undefined) {
    return [];
  }
  if (typeof value !== "object") {
    return [[prefix || "value", String(value)]];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenJson(item, `${prefix}[${index}]`));
  }
  return Object.entries(value).flatMap(([key, item]) => flattenJson(item, prefix ? `${prefix}.${key}` : key));
}

function safeUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    return new URL(value, "https://example.invalid");
  }
}
