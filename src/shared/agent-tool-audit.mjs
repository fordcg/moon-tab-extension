import { redactBodyText } from "./network-redaction.mjs";

export const AGENT_TOOL_AUDIT_MAX = 80;

const REDACTED_VALUE = "[已脱敏]";
const SENSITIVE_KEY_PATTERN = /(?:token|secret|password|passwd|pwd|authorization|auth|apiKey|api_key|session|jwt|credential|cookie|set-cookie)/i;
const MAX_REDACTION_DEPTH = 8;
const MAX_SUMMARY_LENGTH = 500;

export function redactAgentToolValue(value, depth = 0, key = "") {
  if (isSensitiveKey(key)) return REDACTED_VALUE;
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_REDACTION_DEPTH) return Array.isArray(value) ? [] : {};

  if (Array.isArray(value)) {
    return value.map((item, index) => redactAgentToolValue(item, depth + 1, String(index)));
  }

  const redacted = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    redacted[childKey] = redactAgentToolValue(childValue, depth + 1, childKey);
  }
  return redacted;
}

export function createAgentToolAuditRecord(input = {}) {
  const toolCall = isRecord(input.toolCall) ? input.toolCall : {};
  const tool = isRecord(input.tool) ? input.tool : {};
  const startedAt = normalizeTimestamp(input.startedAt);
  const completedAt = normalizeTimestamp(input.completedAt);
  const durationMs = Math.max(0, completedAt - startedAt);
  const resultSummary = summarizeResult(input.result);
  const status = isErrorResult(input.result) ? "error" : "success";

  const record = {
    schemaVersion: 1,
    id: createAuditRecordId(toolCall, startedAt, completedAt),
    toolCallId: normalizeText(toolCall.id),
    toolId: normalizeText(tool.id),
    toolName: normalizeText(tool.name || toolCall.name),
    displayName: normalizeText(tool.displayName || tool.name || toolCall.name),
    permission: normalizeText(tool.permission),
    risk: normalizeText(tool.risk),
    status,
    arguments: redactAgentToolValue(isRecord(toolCall.arguments) ? toolCall.arguments : {}),
    resultSummary,
    startedAt,
    completedAt,
    durationMs,
  };

  if (status === "error") {
    record.errorMessage = resultSummary;
  }

  return record;
}

export function sliceAgentToolAuditLog(records) {
  return (Array.isArray(records) ? records : []).slice(-AGENT_TOOL_AUDIT_MAX);
}

function summarizeResult(result) {
  if (!isRecord(result)) return "";

  if (typeof result.content === "string") {
    return summarizeValue(result.content);
  }

  if (Array.isArray(result.content)) {
    const text = result.content
      .map((item) => {
        if (typeof item === "string") return item;
        if (isRecord(item) && typeof item.text === "string") return item.text;
        if (isRecord(item) && typeof item.content === "string") return item.content;
        return "";
      })
      .filter(Boolean)
      .join("\n");
    if (text) return summarizeValue(text);
  }

  if (result.content !== undefined) {
    return summarizeValue(result.content);
  }

  if (typeof result.error === "string") {
    return summarizeValue(result.error);
  }

  if (typeof result.message === "string") {
    return summarizeValue(result.message);
  }

  return "";
}

function isErrorResult(result) {
  return isRecord(result) && result.isError === true;
}

function isSensitiveKey(key) {
  return typeof key === "string" && SENSITIVE_KEY_PATTERN.test(key);
}

function createAuditRecordId(toolCall, startedAt, completedAt) {
  const toolCallId = normalizeText(toolCall.id);
  if (toolCallId) return `${toolCallId}:${startedAt}:${completedAt}`;
  return `tool-call:${startedAt}:${completedAt}`;
}

function normalizeTimestamp(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}

function normalizeText(value) {
  return typeof value === "string" ? value : "";
}

function summarizeValue(value) {
  const redactedValue = redactAgentToolValue(value);
  const text = typeof redactedValue === "string" ? redactedValue : JSON.stringify(redactedValue);
  if (!text) return "";

  const redactedBody = redactBodyText(text, MAX_SUMMARY_LENGTH);
  const redactedText = redactedBody.text ?? "";
  if (redactedText.length <= MAX_SUMMARY_LENGTH) return redactedText;
  return `${redactedText.slice(0, MAX_SUMMARY_LENGTH - 1)}…`;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
