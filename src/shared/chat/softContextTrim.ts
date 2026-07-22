import type { ChatMessage, ModelConfig } from "../types";
import { truncateText } from "../utils/text";
import { getMessagesFromLatestContextSummary } from "./contextCompression";

/** 达到该上下文预算占比后，先做确定性裁剪，不调用模型摘要。 */
export const SOFT_TRIM_THRESHOLD_PERCENT = 70;
export const DEFAULT_KEEP_RECENT_TOOL_TURNS = 2;
export const DEFAULT_MAX_USER_MESSAGE_CHARS = 12_000;
export const DEFAULT_MAX_ASSISTANT_MESSAGE_CHARS = 8_000;
export const DEFAULT_MAX_TOOL_TURN_CONTENT_CHARS = 2_000;
export const DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS = 128_000;

export interface SoftTrimOptions {
  keepRecentToolTurns?: number;
  maxUserMessageChars?: number;
  maxAssistantMessageChars?: number;
  maxToolTurnContentChars?: number;
}

export interface SoftTrimResult {
  messages: ChatMessage[];
  changed: boolean;
  foldedToolTurnCount: number;
  truncatedMessageCount: number;
}

/**
 * 请求路径上的确定性裁剪：不改持久化会话，只减少发给模型的体积。
 * - 从最新 context_summary 起算
 * - 较早 tool_call_turn 折叠为短摘要并去掉附件展开
 * - 截断过长 user/assistant/tool 正文
 */
export function softTrimChatMessagesForRequest(
  messages: ChatMessage[],
  options: SoftTrimOptions = {},
): SoftTrimResult {
  const keepRecentToolTurns = normalizePositiveInt(options.keepRecentToolTurns, DEFAULT_KEEP_RECENT_TOOL_TURNS);
  const maxUserMessageChars = normalizePositiveInt(options.maxUserMessageChars, DEFAULT_MAX_USER_MESSAGE_CHARS);
  const maxAssistantMessageChars = normalizePositiveInt(options.maxAssistantMessageChars, DEFAULT_MAX_ASSISTANT_MESSAGE_CHARS);
  const maxToolTurnContentChars = normalizePositiveInt(options.maxToolTurnContentChars, DEFAULT_MAX_TOOL_TURN_CONTENT_CHARS);

  const scopedMessages = getMessagesFromLatestContextSummary(messages);
  const toolTurnIndexes = scopedMessages
    .map((message, index) => (message.assistantMessageKind === "tool_call_turn" ? index : -1))
    .filter((index) => index >= 0);
  const firstKeptToolTurnIndex =
    toolTurnIndexes.length <= keepRecentToolTurns
      ? -1
      : toolTurnIndexes[toolTurnIndexes.length - keepRecentToolTurns] ?? -1;

  let foldedToolTurnCount = 0;
  let truncatedMessageCount = 0;
  const nextMessages = scopedMessages.map((message, index) => {
    if (message.assistantMessageKind === "tool_call_turn" && firstKeptToolTurnIndex >= 0 && index < firstKeptToolTurnIndex) {
      foldedToolTurnCount += 1;
      return foldToolTurnMessage(message);
    }

    if (message.assistantMessageKind === "tool_call_turn" && message.content.length > maxToolTurnContentChars) {
      truncatedMessageCount += 1;
      return {
        ...message,
        content: truncateText(message.content, maxToolTurnContentChars).text,
        // 最近工具轮也只保留摘要注入路径，避免详情 body 回灌。
        toolAttachments: undefined,
      };
    }

    if (message.role === "user" && message.content.length > maxUserMessageChars) {
      truncatedMessageCount += 1;
      return {
        ...message,
        content: truncateText(message.content, maxUserMessageChars).text,
      };
    }

    if (
      message.role === "assistant"
      && message.assistantMessageKind !== "context_summary"
      && message.assistantMessageKind !== "tool_call_turn"
      && message.content.length > maxAssistantMessageChars
    ) {
      truncatedMessageCount += 1;
      return {
        ...message,
        content: truncateText(message.content, maxAssistantMessageChars).text,
      };
    }

    return message;
  });

  const changed =
    foldedToolTurnCount > 0
    || truncatedMessageCount > 0
    || nextMessages.length !== messages.length
    || nextMessages.some((message, index) => message !== scopedMessages[index]);

  return {
    messages: nextMessages,
    changed,
    foldedToolTurnCount,
    truncatedMessageCount,
  };
}

export function resolveModelContextWindowTokens(model: Pick<ModelConfig, "modelId" | "maxTokens">): number {
  const modelId = model.modelId.trim().toLowerCase();
  if (!modelId) {
    return DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
  }
  if (modelId.includes("gemini") && (modelId.includes("1.5") || modelId.includes("2.0") || modelId.includes("2.5") || modelId.includes("pro"))) {
    return 1_000_000;
  }
  if (modelId.includes("claude")) {
    return 200_000;
  }
  if (modelId.includes("gpt-4.1") || modelId.includes("gpt-4o") || modelId.includes("o1") || modelId.includes("o3") || modelId.includes("o4")) {
    return 128_000;
  }
  if (modelId.includes("deepseek")) {
    return 128_000;
  }
  if (modelId.includes("qwen") && modelId.includes("long")) {
    return 128_000;
  }
  return DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
}

/**
 * 偏好上下文预算与模型可用窗口取更保守者，并预留输出 max_tokens 空间。
 */
export function resolveEffectiveMaxContextTokens(
  preferenceMaxContextTokens: number,
  model: Pick<ModelConfig, "modelId" | "maxTokens">,
): number {
  const preference = Math.max(1, Math.floor(preferenceMaxContextTokens || DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS));
  const windowTokens = resolveModelContextWindowTokens(model);
  const outputReserve = Math.max(1_024, Math.floor(model.maxTokens || 1_024));
  const usableWindow = Math.max(4_096, windowTokens - outputReserve - 1_024);
  return Math.min(preference, usableWindow);
}

function foldToolTurnMessage(message: ChatMessage): ChatMessage {
  const names = (message.toolCallRecords ?? [])
    .map((record) => record.displayName || record.name)
    .filter((name): name is string => Boolean(name?.trim()));
  const uniqueNames = Array.from(new Set(names));
  const stub = uniqueNames.length > 0
    ? `【已折叠的工具过程】${uniqueNames.join("、")}`
    : "【已折叠的工具过程】";

  return {
    ...message,
    content: stub,
    toolAttachments: undefined,
    toolAttachmentIds: undefined,
  };
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return fallback;
  }
  return Math.round(numberValue);
}
