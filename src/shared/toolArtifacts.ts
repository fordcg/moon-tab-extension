import type {
  AutomationPlaybookSelection,
  AutomationFailureSummary,
  AutomationReportType,
  AutomationReportStep,
  AutomationTimelineEvent,
  ChatAutomationReportToolAttachment,
  ChatBrowserScreenshotToolAttachment,
  ChatGenericToolAttachment,
  ChatJsSourceToolAttachment,
  ChatMessage,
  ChatNetworkContextAttachment,
  ChatNetworkToolAttachment,
  ChatSourceMapToolAttachment,
  ChatToolCallRecord,
  ChatToolAttachment,
  ChatWebSearchResult,
  ChatWebSearchPayload,
  ChatWebSearchToolAttachment,
  JsSourceContext,
  JsSourceFetchFailure,
  JsSourceMatch,
  JsSourceResource,
  SourceMapCandidate,
  SourceMapOriginalContext,
  SourceMapResolvedLocation,
} from "./types";
import {
  formatNetworkAttachmentForExport,
  formatNetworkAttachmentSummary,
  redactNetworkInlineSensitiveText,
  redactNetworkRequestDetail,
  redactNetworkText,
  redactNetworkTextSnippets,
} from "./networkContext";
import { isPngDataUrl } from "./tabCapture";
import { createTavilySearchContextPrompt, formatTavilySearchAttachmentSummary } from "./webSearch/tavily";
import { truncateText } from "./utils/text";

const TOOL_ATTACHMENT_KIND_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
import {
  aggregateAutomationReportType,
  createAutomationFailureSummary,
  createAutomationReportStep,
  createAutomationTimeline,
  createWebSearchToolAttachment,
  formatAutomationReportAttachmentForText,
  formatAutomationReportSummary,
  formatBrowserScreenshotAttachmentSummary,
  formatJsSourceAttachmentForText,
  formatJsSourceAttachmentSummary,
  formatSourceMapAttachmentForText,
  formatSourceMapAttachmentSummary,
  inferAutomationReportType,
  normalizeAutomationReportPlaybook,
  normalizeAutomationReportToolAttachment,
  normalizeBrowserScreenshotToolAttachment,
  normalizeComparableText,
  normalizeGenericToolAttachment,
  normalizeJsSourceToolAttachment,
  normalizeNetworkToolAttachment,
  normalizeOptionalString,
  normalizeSourceMapToolAttachment,
  normalizeWebSearchToolAttachment,
  redactGenericToolText,
  redactNetworkAttachmentRequestsForSharedText,
  shouldPreserveNetworkAttachmentRaw,
  uniqueBy,
  uniqueNonEmptyStrings,
} from "./toolAttachmentInternals";

export { formatAutomationReportTypeLabel } from "./toolAttachmentInternals";
export { createWebSearchToolAttachment } from "./toolAttachmentInternals";

const GENERIC_DETAIL_LIMIT = 4000;
const AUTOMATION_EVIDENCE_LIMIT = 500;
const AUTOMATION_CONCLUSION_LIMIT = 800;
type ToolAttachmentAggregateGroup = {
  attachments: ChatToolAttachment[];
  toolDisplayName?: string;
};

type MixedToolAttachmentAggregatePart = {
  summary: string;
  details: string;
  redacted: boolean;
  truncated: boolean;
};

export function createNetworkToolAttachment(attachment: ChatNetworkContextAttachment): ChatNetworkToolAttachment {
  const requests = attachment.requests.map(redactNetworkRequestDetail);
  return {
    id: attachment.id,
    kind: "network",
    title: "Network 请求详情",
    summary: formatNetworkAttachmentSummary(requests),
    createdAt: attachment.createdAt,
    redacted: true,
    truncated: attachment.truncated,
    requests,
  };
}

export function createAutomationReportToolAttachment(input: {
  objective: string;
  conclusion: string;
  records: ChatToolCallRecord[];
  attachments?: ChatToolAttachment[];
  playbook?: AutomationPlaybookSelection;
  createdAt?: number;
}): ChatAutomationReportToolAttachment | undefined {
  const steps = input.records.map((record) => createAutomationReportStep(record, input.attachments ?? []));
  const timeline = createAutomationTimeline(input.records, steps);
  const createdAt = input.createdAt ?? Math.max(...input.records.map((record) => record.completedAt ?? record.startedAt), Date.now());
  const report = normalizeAutomationReportToolAttachment({
    id: `tool-attachment-automation-report-${createdAt}`,
    kind: "automation-report",
    title: "自动化任务报告",
    reportType: inferAutomationReportType(input.records),
    objective: input.objective,
    conclusion: input.conclusion,
    playbook: normalizeAutomationReportPlaybook(input.playbook),
    createdAt,
    redacted: true,
    truncated: false,
    steps,
    timeline,
    failureSummary: createAutomationFailureSummary(steps),
    fullAccessIncluded: input.records.some((record) => record.toolId.startsWith("full_access.")),
  } as Partial<ChatToolAttachment>);
  return report;
}

export function collectMessageToolAttachments(message: ChatMessage): ChatToolAttachment[] {
  return aggregateToolAttachments(collectRawMessageToolAttachments(message), message.toolCallRecords);
}

// 原始附件用于工具调用详情追溯；聚合附件用于消息展示、导出和后续追问，避免同一轮多次工具调用撑开附件区。
export function collectRawMessageToolAttachments(message: ChatMessage): ChatToolAttachment[] {
  const attachments = uniqueToolAttachmentsById(message.toolAttachments ?? []);
  const legacyAttachments: ChatToolAttachment[] = [];
  if (message.networkContextAttachment) {
    legacyAttachments.push(createNetworkToolAttachment(message.networkContextAttachment));
  }
  return mergeCompatibleToolAttachments(attachments, legacyAttachments);
}

export function aggregateToolAttachments(attachments: ChatToolAttachment[], records: ChatToolCallRecord[] = []): ChatToolAttachment[] {
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const recordsByAttachmentId = createRecordsByAttachmentId(records);
  const groups = new Map<string, ToolAttachmentAggregateGroup>();
  const order: string[] = [];
  for (const attachment of attachments) {
    const target = createToolAttachmentAggregateTarget(attachment, recordsById, recordsByAttachmentId);
    if (!groups.has(target.key)) {
      groups.set(target.key, { attachments: [], toolDisplayName: target.toolDisplayName });
      order.push(target.key);
    }
    groups.get(target.key)?.attachments.push(attachment);
  }

  return order
    .map((groupKey) => {
      const group = groups.get(groupKey);
      return group ? aggregateToolAttachmentGroup(group) : undefined;
    })
    .filter((attachment): attachment is ChatToolAttachment => Boolean(attachment));
}

export function formatToolAttachmentForPrompt(attachment: ChatToolAttachment): string | undefined {
  if (isWebSearchToolAttachment(attachment)) {
    return ["后续追问需要继续参考以下历史网络搜索结果：", createTavilySearchContextPrompt(attachment)].join("\n");
  }

  if (isNetworkToolAttachment(attachment)) {
    const requests = redactNetworkAttachmentRequestsForSharedText(attachment);
    return ["后续追问需要继续参考以下历史 Network 请求详情：", formatNetworkAttachmentForExport(requests)].join("\n");
  }

  if (isJsSourceToolAttachment(attachment)) {
    return ["后续追问需要继续参考以下历史 JS 源码片段：", formatJsSourceAttachmentForText(attachment)].join("\n");
  }

  if (isSourceMapToolAttachment(attachment)) {
    return ["后续追问需要继续参考以下历史 Source Map 解析结果：", formatSourceMapAttachmentForText(attachment)].join("\n");
  }

  if (isBrowserScreenshotToolAttachment(attachment)) {
    return [
      "后续追问可参考一张历史浏览器截图附件，但正文只保留元数据，不注入图片 base64：",
      formatBrowserScreenshotAttachmentSummary(attachment),
    ].join("\n");
  }

  if (isAutomationReportToolAttachment(attachment)) {
    return ["后续追问需要继续参考以下自动化任务报告：", formatAutomationReportAttachmentForText(attachment)].join("\n");
  }

  const safeAttachment = sanitizeGenericToolAttachment(attachment);
  if (safeAttachment.details?.trim()) {
    return [`后续追问需要继续参考以下历史工具附件：${safeAttachment.title}`, safeAttachment.details.trim()].join("\n");
  }

  return safeAttachment.summary.trim() ? [`后续追问需要继续参考以下历史工具附件：${safeAttachment.title}`, safeAttachment.summary.trim()].join("\n") : undefined;
}

/** 压缩/预算估算用的摘要注入：只带 summary，不展开完整 body/源码。 */
export function formatToolAttachmentForPromptSummary(attachment: ChatToolAttachment): string | undefined {
  if (isWebSearchToolAttachment(attachment)) {
    const summary = formatTavilySearchAttachmentSummary(attachment).trim();
    return summary ? ["后续追问可参考以下历史网络搜索摘要：", summary].join("\n") : undefined;
  }

  if (isNetworkToolAttachment(attachment)) {
    const requests = redactNetworkAttachmentRequestsForSharedText(attachment);
    const summary = formatNetworkAttachmentSummary(requests).trim();
    return summary
      ? [
          "后续追问可参考以下历史 Network 请求摘要；完整 body/header 仅保存在附件弹窗，不默认注入模型上下文：",
          summary,
        ].join("\n")
      : undefined;
  }

  if (isJsSourceToolAttachment(attachment)) {
    const summary = formatJsSourceAttachmentSummary(attachment).trim();
    return summary
      ? [
          "后续追问可参考以下历史 JS 资源摘要；完整源码仅保存在附件弹窗，不默认注入模型上下文：",
          summary,
        ].join("\n")
      : undefined;
  }

  if (isSourceMapToolAttachment(attachment)) {
    const summary = formatSourceMapAttachmentSummary(attachment).trim();
    return summary
      ? [
          "后续追问可参考以下历史 Source Map 摘要；完整原始片段仅保存在附件弹窗，不默认注入模型上下文：",
          summary,
        ].join("\n")
      : undefined;
  }

  if (isBrowserScreenshotToolAttachment(attachment)) {
    return [
      "后续追问可参考一张历史浏览器截图附件；正文只保留元数据，不注入图片 base64：",
      formatBrowserScreenshotAttachmentSummary(attachment),
    ].join("\n");
  }

  if (isAutomationReportToolAttachment(attachment)) {
    return ["后续追问可参考以下自动化任务报告摘要：", formatAutomationReportSummary(attachment)].join("\n");
  }

  const safeAttachment = sanitizeGenericToolAttachment(attachment);
  const summary = safeAttachment.summary.trim();
  return summary ? [`后续追问可参考以下历史工具附件摘要：${safeAttachment.title}`, summary].join("\n") : undefined;
}

export function formatToolAttachmentForExport(attachment: ChatToolAttachment): string {
  if (isWebSearchToolAttachment(attachment)) {
    return ["# 网络搜索结果附件", "", formatTavilySearchAttachmentSummary(attachment), "", createTavilySearchContextPrompt(attachment)].join("\n");
  }

  if (isNetworkToolAttachment(attachment)) {
    const requests = redactNetworkAttachmentRequestsForSharedText(attachment);
    return ["# Network 请求详情附件", "", formatNetworkAttachmentSummary(requests), "", formatNetworkAttachmentForExport(requests)].join("\n");
  }

  if (isJsSourceToolAttachment(attachment)) {
    return ["# JS 源码片段附件", "", formatJsSourceAttachmentSummary(attachment), "", formatJsSourceAttachmentForText(attachment)].join("\n");
  }

  if (isSourceMapToolAttachment(attachment)) {
    return ["# Source Map 解析附件", "", formatSourceMapAttachmentSummary(attachment), "", formatSourceMapAttachmentForText(attachment)].join("\n");
  }

  if (isBrowserScreenshotToolAttachment(attachment)) {
    return ["# 浏览器截图附件", "", formatBrowserScreenshotAttachmentSummary(attachment)].join("\n");
  }

  if (isAutomationReportToolAttachment(attachment)) {
    return ["# 自动化任务报告附件", "", formatAutomationReportAttachmentForText(attachment)].join("\n");
  }

  const safeAttachment = sanitizeGenericToolAttachment(attachment);
  return ["# 工具结果附件", "", safeAttachment.summary, "", safeAttachment.details ?? ""].join("\n").trim();
}

export function normalizeToolAttachment(value: unknown): ChatToolAttachment | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Partial<ChatToolAttachment>;
  const kind = typeof source.kind === "string" ? source.kind.trim() : "";
  if (!TOOL_ATTACHMENT_KIND_PATTERN.test(kind)) {
    return undefined;
  }

  if (kind === "web-search") {
    return normalizeWebSearchToolAttachment(source);
  }

  if (kind === "network") {
    return normalizeNetworkToolAttachment(source);
  }

  if (kind === "js-source") {
    return normalizeJsSourceToolAttachment(source);
  }

  if (kind === "source-map") {
    return normalizeSourceMapToolAttachment(source);
  }

  if (kind === "browser-screenshot") {
    return normalizeBrowserScreenshotToolAttachment(source);
  }

  if (kind === "automation-report") {
    return normalizeAutomationReportToolAttachment(source);
  }

  return normalizeGenericToolAttachment(source, kind);
}

export function isWebSearchToolAttachment(attachment: ChatToolAttachment): attachment is ChatWebSearchToolAttachment {
  return attachment.kind === "web-search" && "results" in attachment;
}

export function isNetworkToolAttachment(attachment: ChatToolAttachment): attachment is ChatNetworkToolAttachment {
  return attachment.kind === "network" && "requests" in attachment;
}

export function isJsSourceToolAttachment(attachment: ChatToolAttachment): attachment is ChatJsSourceToolAttachment {
  return attachment.kind === "js-source" && "resources" in attachment && "jsMatches" in attachment && "contexts" in attachment;
}

export function isSourceMapToolAttachment(attachment: ChatToolAttachment): attachment is ChatSourceMapToolAttachment {
  return attachment.kind === "source-map" && "candidates" in attachment && "resolvedLocations" in attachment && "originalContexts" in attachment;
}

export function isBrowserScreenshotToolAttachment(attachment: ChatToolAttachment): attachment is ChatBrowserScreenshotToolAttachment {
  return attachment.kind === "browser-screenshot" && "dataUrl" in attachment && "mediaType" in attachment && "target" in attachment;
}

export function isAutomationReportToolAttachment(attachment: ChatToolAttachment): attachment is ChatAutomationReportToolAttachment {
  return attachment.kind === "automation-report" && "steps" in attachment && Array.isArray(attachment.steps);
}

export function uniqueToolAttachmentsById(attachments: ChatToolAttachment[]): ChatToolAttachment[] {
  return uniqueBy(attachments, (attachment) => attachment.id);
}

export function mergeCompatibleToolAttachments(primary: ChatToolAttachment[], compatible: ChatToolAttachment[]): ChatToolAttachment[] {
  const result = uniqueToolAttachmentsById(primary);
  for (const attachment of compatible) {
    if (result.some((item) => isSameToolAttachmentContent(item, attachment))) {
      continue;
    }
    result.push(attachment);
  }
  return result;
}

function isSameToolAttachmentContent(left: ChatToolAttachment, right: ChatToolAttachment): boolean {
  return left.id === right.id || createToolAttachmentContentKey(left) === createToolAttachmentContentKey(right);
}

function createToolAttachmentContentKey(attachment: ChatToolAttachment): string {
  if (isWebSearchToolAttachment(attachment)) {
    return [
      attachment.kind,
      attachment.provider,
      normalizeComparableText(attachment.query),
      normalizeComparableText(attachment.answer ?? ""),
      ...attachment.results.map((result) =>
        [normalizeComparableText(result.url), normalizeComparableText(result.title), normalizeComparableText(result.content)].join("\u0001"),
      ),
    ].join("\u0000");
  }

  if (isNetworkToolAttachment(attachment)) {
    return [
      attachment.kind,
      ...attachment.requests.map((request) =>
        [normalizeComparableText(request.id), normalizeComparableText(request.method), normalizeComparableText(request.url), String(request.status ?? "")].join("\u0001"),
      ),
    ].join("\u0000");
  }

  if (isJsSourceToolAttachment(attachment)) {
    return [
      attachment.kind,
      normalizeComparableText(attachment.query?.join(" ") ?? ""),
      ...attachment.resources.map((resource) => [resource.id, resource.source, normalizeComparableText(resource.url)].join("\u0001")),
      ...attachment.jsMatches.map((match) => [match.resourceId, String(match.position), normalizeComparableText(match.term)].join("\u0001")),
      ...attachment.contexts.map((context) => [context.resourceId, String(context.position)].join("\u0001")),
    ].join("\u0000");
  }

  if (isSourceMapToolAttachment(attachment)) {
    return [
      attachment.kind,
      ...attachment.candidates.map((candidate) => [candidate.resourceId, candidate.source, normalizeComparableText(candidate.url ?? ""), candidate.status].join("\u0001")),
      ...attachment.resolvedLocations.map((location) => [location.resourceId, String(location.generatedLine), String(location.generatedColumn), normalizeComparableText(location.source ?? "")].join("\u0001")),
      ...attachment.originalContexts.map((context) => [context.resourceId, String(context.generatedLine), String(context.generatedColumn), normalizeComparableText(context.source ?? "")].join("\u0001")),
    ].join("\u0000");
  }

  if (isBrowserScreenshotToolAttachment(attachment)) {
    return [attachment.kind, attachment.target, attachment.uid ?? "", attachment.dataUrl].join("\u0000");
  }

  if (isAutomationReportToolAttachment(attachment)) {
    return [
      attachment.kind,
      normalizeComparableText(attachment.objective),
      ...attachment.steps.map((step) => [step.toolCallId, step.toolName, step.status, normalizeComparableText(step.evidence)].join("\u0001")),
    ].join("\u0000");
  }

  return [attachment.kind, normalizeComparableText(attachment.title), normalizeComparableText(attachment.summary), normalizeComparableText(attachment.details ?? "")].join("\u0000");
}

function createRecordsByAttachmentId(records: ChatToolCallRecord[]): Map<string, ChatToolCallRecord> {
  const recordsByAttachmentId = new Map<string, ChatToolCallRecord>();
  for (const record of records) {
    for (const attachmentId of record.attachmentIds ?? []) {
      if (!recordsByAttachmentId.has(attachmentId)) {
        recordsByAttachmentId.set(attachmentId, record);
      }
    }
  }
  return recordsByAttachmentId;
}

function createToolAttachmentAggregateTarget(
  attachment: ChatToolAttachment,
  recordsById: Map<string, ChatToolCallRecord>,
  recordsByAttachmentId: Map<string, ChatToolCallRecord>,
): { key: string; toolDisplayName?: string } {
  // 兼容旧工具结果：有的历史或过渡数据只在工具记录里保存 attachmentIds，附件本身没有 sourceToolCallId。
  const record = attachment.sourceToolCallId ? recordsById.get(attachment.sourceToolCallId) : recordsByAttachmentId.get(attachment.id);
  if (record) {
    return { key: `tool:${record.toolId || record.name}`, toolDisplayName: record.displayName || record.name };
  }

  // 缺少工具记录的旧数据无法可靠判断“同一工具”，带调用 ID 的附件保守地按调用拆开。
  if (attachment.sourceToolCallId) {
    return { key: `${attachment.kind}\u0000call:${attachment.sourceToolCallId}` };
  }

  return { key: `${attachment.kind}\u0000legacy` };
}

export function aggregateToolAttachmentGroupByKind(attachments: ChatToolAttachment[]): ChatToolAttachment | undefined {
  if (attachments.length === 0) {
    return undefined;
  }
  return aggregateToolAttachmentGroup({ attachments });
}

function aggregateToolAttachmentGroup(group: ToolAttachmentAggregateGroup): ChatToolAttachment | undefined {
  const { attachments } = group;
  if (attachments.length === 0) {
    return undefined;
  }

  const kinds = uniqueNonEmptyStrings(attachments.map((attachment) => attachment.kind));
  if (kinds.length > 1) {
    return aggregateMixedKindToolAttachments(attachments, group.toolDisplayName);
  }

  const kind = kinds[0] ?? attachments[0].kind;
  if (kind === "web-search") {
    return aggregateWebSearchToolAttachments(attachments.filter(isWebSearchToolAttachment));
  }

  if (kind === "network") {
    return aggregateNetworkToolAttachments(attachments.filter(isNetworkToolAttachment));
  }

  if (kind === "js-source") {
    return aggregateJsSourceToolAttachments(attachments.filter(isJsSourceToolAttachment));
  }

  if (kind === "source-map") {
    return aggregateSourceMapToolAttachments(attachments.filter(isSourceMapToolAttachment));
  }

  if (kind === "browser-screenshot") {
    return attachments[0];
  }

  if (kind === "automation-report") {
    return aggregateAutomationReportToolAttachments(attachments.filter(isAutomationReportToolAttachment));
  }

  const genericAttachments = attachments.map(sanitizeGenericToolAttachment);
  if (genericAttachments.length === 1) {
    return genericAttachments[0];
  }

  return aggregateGenericToolAttachments(kind, genericAttachments);
}

function aggregateMixedKindToolAttachments(attachments: ChatToolAttachment[], toolDisplayName?: string): ChatGenericToolAttachment {
  const parts = attachments.map(formatToolAttachmentForMixedAggregate);
  const details = uniqueNonEmptyStrings(parts.map((part) => part.details)).join("\n\n");
  const summary = uniqueNonEmptyStrings(parts.map((part) => part.summary)).join("\n");
  const truncatedDetails = truncateText(details, GENERIC_DETAIL_LIMIT);
  return {
    id: `tool-attachment-tool-result-set-aggregated-${attachments.map((attachment) => attachment.id).join("-")}`,
    kind: "tool-result-set",
    title: `${toolDisplayName ?? attachments[0].title}结果`,
    summary,
    createdAt: Math.max(...attachments.map((attachment) => attachment.createdAt)),
    redacted: parts.every((part) => part.redacted),
    truncated: parts.some((part) => part.truncated) || truncatedDetails.truncated,
    details: truncatedDetails.text || undefined,
  };
}

function formatToolAttachmentForMixedAggregate(attachment: ChatToolAttachment): MixedToolAttachmentAggregatePart {
  if (isNetworkToolAttachment(attachment)) {
    const requests = attachment.requests.map(redactNetworkRequestDetail);
    const summary = formatNetworkAttachmentSummary(requests);
    return {
      summary,
      details: ["# Network 请求详情附件", "", summary, "", formatNetworkAttachmentForExport(requests)].join("\n"),
      redacted: true,
      truncated: attachment.truncated || requests.some((request) => request.truncated),
    };
  }

  if (
    isWebSearchToolAttachment(attachment)
    || isJsSourceToolAttachment(attachment)
    || isSourceMapToolAttachment(attachment)
    || isBrowserScreenshotToolAttachment(attachment)
    || isAutomationReportToolAttachment(attachment)
  ) {
    return {
      summary: attachment.summary,
      details: formatToolAttachmentForExport(attachment),
      redacted: attachment.redacted,
      truncated: attachment.truncated,
    };
  }

  const safeAttachment = sanitizeGenericToolAttachment(attachment);
  return {
    summary: safeAttachment.summary,
    details: formatToolAttachmentForExport(safeAttachment),
    redacted: safeAttachment.redacted,
    truncated: safeAttachment.truncated,
  };
}

export function sanitizeGenericToolAttachment(attachment: ChatToolAttachment): ChatGenericToolAttachment {
  const normalized = normalizeGenericToolAttachment(attachment, attachment.kind);
  if (normalized) {
    return normalized;
  }

  const redactedSummary = redactGenericToolText(attachment.summary ?? "");
  const redactedDetails = "details" in attachment && typeof attachment.details === "string" ? redactGenericToolText(attachment.details) : undefined;
  const truncatedDetails = redactedDetails ? truncateText(redactedDetails, GENERIC_DETAIL_LIMIT) : undefined;
  return {
    ...attachment,
    title: normalizeOptionalString(attachment.title) ?? attachment.kind,
    summary: redactedSummary,
    redacted: true,
    truncated: attachment.truncated || Boolean(truncatedDetails?.truncated),
    details: truncatedDetails?.text,
  };
}

function aggregateWebSearchToolAttachments(attachments: ChatWebSearchToolAttachment[]): ChatWebSearchToolAttachment | undefined {
  if (attachments.length === 0) {
    return undefined;
  }

  const first = attachments[0];
  const results = uniqueBy(attachments.flatMap((attachment) => attachment.results), (result) => result.url.trim() || result.title.trim());
  const createdAt = Math.max(...attachments.map((attachment) => attachment.createdAt));
  const aggregated: ChatWebSearchToolAttachment = {
    id: `tool-attachment-web-search-aggregated-${attachments.map((attachment) => attachment.id).join("-")}`,
    kind: "web-search",
    title: first.title || "网络搜索结果",
    summary: "",
    createdAt,
    redacted: false,
    truncated: attachments.some((attachment) => attachment.truncated),
    provider: first.provider,
    query: uniqueNonEmptyStrings(attachments.map((attachment) => attachment.query)).join("；"),
    answer: uniqueNonEmptyStrings(attachments.map((attachment) => attachment.answer)).join("\n\n") || undefined,
    results,
  };
  return {
    ...aggregated,
    summary: formatTavilySearchAttachmentSummary(aggregated),
  };
}

function aggregateNetworkToolAttachments(attachments: ChatNetworkToolAttachment[]): ChatNetworkToolAttachment | undefined {
  if (attachments.length === 0) {
    return undefined;
  }

  const preserveRaw = attachments.every(shouldPreserveNetworkAttachmentRaw);
  const requests = uniqueBy(
    attachments.flatMap((attachment) => shouldPreserveNetworkAttachmentRaw(attachment)
      ? attachment.requests
      : attachment.requests.map(redactNetworkRequestDetail)),
    (request) => request.id.trim() || `${request.method}\u0000${request.url}\u0000${request.status ?? ""}`,
  );
  const createdAt = Math.max(...attachments.map((attachment) => attachment.createdAt));
  return {
    id: `tool-attachment-network-aggregated-${attachments.map((attachment) => attachment.id).join("-")}`,
    kind: "network",
    title: "Network 请求详情",
    summary: formatNetworkAttachmentSummary(requests),
    createdAt,
    redacted: !preserveRaw,
    fullAccess: preserveRaw || undefined,
    truncated: attachments.some((attachment) => attachment.truncated || attachment.requests.some((request) => request.truncated)),
    requests,
  };
}

function aggregateJsSourceToolAttachments(attachments: ChatJsSourceToolAttachment[]): ChatJsSourceToolAttachment | undefined {
  if (attachments.length === 0) {
    return undefined;
  }

  const resources = uniqueBy(attachments.flatMap((attachment) => attachment.resources), (resource) => resource.id.trim() || resource.url.trim());
  const jsMatches = uniqueBy(attachments.flatMap((attachment) => attachment.jsMatches), (match) => `${match.resourceId}\u0000${match.position}\u0000${match.term}`);
  const contexts = uniqueBy(attachments.flatMap((attachment) => attachment.contexts), (context) => `${context.resourceId}\u0000${context.position}`);
  const failedFetches = uniqueBy(attachments.flatMap((attachment) => attachment.failedFetches), (failure) => `${failure.url}\u0000${failure.message}`);
  const createdAt = Math.max(...attachments.map((attachment) => attachment.createdAt));
  const aggregated: ChatJsSourceToolAttachment = {
    id: `tool-attachment-js-source-aggregated-${attachments.map((attachment) => attachment.id).join("-")}`,
    kind: "js-source",
    title: "JS 源码片段",
    summary: "",
    createdAt,
    redacted: true,
    truncated: attachments.some((attachment) => attachment.truncated),
    query: uniqueNonEmptyStrings(attachments.flatMap((attachment) => attachment.query)).slice(0, 20),
    resources,
    jsMatches,
    contexts,
    failedFetches,
  };
  return {
    ...aggregated,
    summary: formatJsSourceAttachmentSummary(aggregated),
  };
}

function aggregateSourceMapToolAttachments(attachments: ChatSourceMapToolAttachment[]): ChatSourceMapToolAttachment | undefined {
  if (attachments.length === 0) {
    return undefined;
  }

  const candidates = uniqueBy(attachments.flatMap((attachment) => attachment.candidates), (candidate) =>
    `${candidate.resourceId}\u0000${candidate.source}\u0000${candidate.url ?? ""}\u0000${candidate.status}`,
  );
  const resolvedLocations = uniqueBy(attachments.flatMap((attachment) => attachment.resolvedLocations), (location) =>
    `${location.resourceId}\u0000${location.generatedLine}\u0000${location.generatedColumn}\u0000${location.source ?? ""}`,
  );
  const originalContexts = uniqueBy(attachments.flatMap((attachment) => attachment.originalContexts), (context) =>
    `${context.resourceId}\u0000${context.generatedLine}\u0000${context.generatedColumn}\u0000${context.source ?? ""}`,
  );
  const failures = uniqueBy(attachments.flatMap((attachment) => attachment.failures), (failure) =>
    `${failure.resourceId ?? ""}\u0000${failure.url ?? ""}\u0000${failure.message}`,
  );
  const createdAt = Math.max(...attachments.map((attachment) => attachment.createdAt));
  const aggregated: ChatSourceMapToolAttachment = {
    id: `tool-attachment-source-map-aggregated-${attachments.map((attachment) => attachment.id).join("-")}`,
    kind: "source-map",
    title: "Source Map 解析结果",
    summary: "",
    createdAt,
    redacted: true,
    truncated: attachments.some((attachment) => attachment.truncated),
    candidates,
    resolvedLocations,
    originalContexts,
    failures,
  };
  return {
    ...aggregated,
    summary: formatSourceMapAttachmentSummary(aggregated),
  };
}

function aggregateAutomationReportToolAttachments(attachments: ChatAutomationReportToolAttachment[]): ChatAutomationReportToolAttachment | undefined {
  if (attachments.length === 0) {
    return undefined;
  }

  const steps = uniqueBy(attachments.flatMap((attachment) => attachment.steps), (step) => step.toolCallId || `${step.toolName}\u0000${step.startedAt}`);
  const timeline = uniqueBy(attachments.flatMap((attachment) => attachment.timeline), (event) => event.id || `${event.type}\u0000${event.at}\u0000${event.label}`);
  const createdAt = Math.max(...attachments.map((attachment) => attachment.createdAt));
  const fullAccessIncluded = attachments.some((attachment) => attachment.fullAccessIncluded);
  const playbook = attachments.map((attachment) => attachment.playbook).find((item): item is AutomationPlaybookSelection => Boolean(item));
  const report: ChatAutomationReportToolAttachment = {
    id: `tool-attachment-automation-report-aggregated-${attachments.map((attachment) => attachment.id).join("-")}`,
    kind: "automation-report",
    title: "自动化任务报告",
    summary: "",
    createdAt,
    redacted: attachments.every((attachment) => attachment.redacted),
    truncated: attachments.some((attachment) => attachment.truncated),
    objective: uniqueNonEmptyStrings(attachments.map((attachment) => attachment.objective)).join("；") || "未记录任务目标",
    conclusion: uniqueNonEmptyStrings(attachments.map((attachment) => attachment.conclusion)).join("\n") || "暂无结论",
    playbook,
    reportType: aggregateAutomationReportType(attachments),
    steps,
    timeline: timeline.sort((a, b) => a.at - b.at),
    failureSummary: createAutomationFailureSummary(steps),
    fullAccessIncluded,
  };
  return {
    ...report,
    summary: formatAutomationReportSummary(report),
  };
}

function aggregateGenericToolAttachments(kind: string, attachments: ChatToolAttachment[]): ChatGenericToolAttachment {
  const first = attachments[0];
  const details = uniqueNonEmptyStrings(
    attachments.map((attachment) => ("details" in attachment && typeof attachment.details === "string" ? attachment.details : undefined)),
  ).join("\n\n");
  const truncatedDetails = truncateText(details, GENERIC_DETAIL_LIMIT);
  return {
    id: `tool-attachment-${kind}-aggregated-${attachments.map((attachment) => attachment.id).join("-")}`,
    kind,
    title: first.title,
    summary: uniqueNonEmptyStrings(attachments.map((attachment) => attachment.summary)).join("\n"),
    createdAt: Math.max(...attachments.map((attachment) => attachment.createdAt)),
    redacted: attachments.every((attachment) => attachment.redacted),
    truncated: attachments.some((attachment) => attachment.truncated) || truncatedDetails.truncated,
    details: truncatedDetails.text || undefined,
  };
}

