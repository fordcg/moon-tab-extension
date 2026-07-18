import { buildPromptExpandedUserContent } from "../../shared/chat/buildChatRequestMessages";
import type { AutomationPlaybookSelection, ChatImageAttachment, ChatMessage, ChatPromptInvocation, ChatTokenUsageEntry, ChatToolAttachment, ChatToolCallRecord } from "../../shared/types";
import type { ModelRequestMessage, ModelResponseData, ModelToolCall, ModelToolExecutor, ModelToolRegistryEntry, ModelToolResultMessage } from "../../shared/models/types";
import { BROWSER_SCREENSHOT_TOOL_ID, BROWSER_SCREENSHOT_TOOL_NAME, isBrowserAutomationToolId } from "../../shared/models/toolRegistry";
import { redactSensitiveText } from "../../shared/security/redaction";
import { createAutomationReportToolAttachment, isBrowserScreenshotToolAttachment } from "../../shared/toolArtifacts";
import { truncateText } from "../../shared/utils/text";

const DEFAULT_MAX_TOOL_ITERATIONS = 8;
const REDACTED_TOOL_ARGUMENT_VALUE = "[已脱敏]";
const UNSERIALIZABLE_TOOL_ARGUMENT_VALUE = "[无法序列化的参数]";
const MAX_TOOL_ARGUMENT_REDACTION_DEPTH = 8;
const SENSITIVE_TOOL_ARGUMENT_KEY_PATTERN = /(?:access[_-]?token|token|secret|password|passwd|pwd|authorization|auth|api[_-]?key|session|jwt|credential|cookie|set-cookie|bearer)/i;
const FINAL_RESPONSE_INSTRUCTION = [
  "工具调用阶段已经结束，当前请求不会再执行任何工具。",
  "请只基于上文用户问题和已经返回的工具结果，直接给出面向用户的最终中文答复。",
  "最终答复必须区分事实证据、模型推断和未验证假设：工具结果可作为事实证据，基于证据的判断要标明为模型推断，未被工具或用户确认的信息要标明为未验证假设。",
  "上一轮工具决策阶段的自然语言正文只作为过程参考，不要把其中的待办话术当作还会继续执行的计划。",
  "不要再声称将继续调用、测试或等待工具；如果信息不足，请明确说明已完成的部分和无法继续验证的原因。",
].join("\n");
const MAX_ITERATIONS_REACHED_INSTRUCTION = [
  "工具调用轮次已达上限，系统不会再执行任何工具。",
  "请立刻给出最终中文答复：总结已经完成的结果、失败/未完成的站点，以及还需要用户处理的事项。",
  "如果打开了临时网页，应说明已尽量关闭；若未能关闭，提醒用户手动关闭。",
  "不要再规划新的工具调用。",
].join("\n");

const GUIDANCE_PREFIX = "用户在当前任务运行中补充了以下引导：";
const GUIDANCE_SUFFIX = "请在不丢弃已完成结果的前提下，优先依据该引导调整后续工具调用和最终回答。若引导与原目标冲突，说明采用了新的用户引导。";

interface GuidanceItem {
  id: string;
  content: string;
  attachments?: ChatImageAttachment[];
  promptInvocations?: ChatPromptInvocation[];
  userMessageId?: string;
}

export interface RunModelToolLoopInput {
  initialMessages: ModelRequestMessage[];
  tools: ModelToolRegistryEntry[];
  enabledToolIds: string[];
  /** When false, screenshot OCR follow-ups are skipped and screenshot tool calls are rejected. */
  supportsVision?: boolean;
  requestModel: (messages: ModelRequestMessage[]) => Promise<ModelToolLoopResponse>;
  requestFinalModel?: (messages: ModelRequestMessage[]) => Promise<ModelToolLoopResponse>;
  executeTool: ModelToolExecutor;
  automationPlaybookSelection?: AutomationPlaybookSelection;
  onToolTurnMessage?: (message: ChatMessage) => void;
  onToolCallStart?: (record: ChatToolCallRecord) => void;
  onToolCallComplete?: (record: ChatToolCallRecord, attachments: ChatToolAttachment[]) => void;
  consumeGuidance?: () => GuidanceItem[];
  onGuidanceConsumed?: (followUpId: string) => void;
  maxIterations?: number;
  signal?: AbortSignal;
}

export type ModelToolLoopResponse =
  | ({ ok: true } & ModelResponseData)
  | {
      ok: false;
      message: string;
    };

export async function runModelToolLoop(input: RunModelToolLoopInput): Promise<ModelToolLoopResponse> {
  // maxIterations <= 0 means unlimited (used by full_access mode).
  const configuredMax = input.maxIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
  const unlimited = typeof configuredMax === "number" && configuredMax <= 0;
  const maxIterations = unlimited ? Number.POSITIVE_INFINITY : Math.max(1, Math.floor(configuredMax));
  const enabledToolIds = new Set(input.enabledToolIds);
  let messages = [...input.initialMessages];
  const toolCallRecords: ChatToolCallRecord[] = [];
  const toolAttachments: ChatToolAttachment[] = [];
  const toolTurnMessages: ChatMessage[] = [];
  const tokenUsageEntries: ChatTokenUsageEntry[] = [];
  let lastResponse: ModelToolLoopResponse | undefined;
  let exhaustedByMaxIterations = false;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    if (shouldHonorAbort(input.signal)) {
      return createAbortResponse();
    }
    messages = appendGuidanceMessages(messages, input);
    const response = await input.requestModel(messages);
    // Prefer a concrete model failure over a generic abort when both happened around the same time.
    if (!response.ok) {
      if (shouldHonorAbort(input.signal) && response.message === "已终止本次生成。") {
        return createAbortResponse();
      }
      return response;
    }
    // If the model already returned tool calls / content, only stop for explicit user/restore cancel.
    // Generic abort (e.g. transient chat.stream port drop) must not discard a successful tool decision.
    if (shouldHonorAbort(input.signal)) {
      return createAbortResponse();
    }
    tokenUsageEntries.push(...(response.tokenUsageEntries ?? []));

    if (!response.toolCalls?.length) {
      lastResponse = {
        ok: true,
        content: response.content,
        thinking: response.thinking,
        ...(response.reasoningContent ? { reasoningContent: response.reasoningContent } : {}),
        ...(toolAttachments.length ? { toolAttachments } : {}),
        ...(toolTurnMessages.length ? { toolTurnMessages } : {}),
        ...(tokenUsageEntries.length ? { tokenUsageEntries: [...tokenUsageEntries] } : {}),
      };
      exhaustedByMaxIterations = false;
      break;
    }

    const currentTurnRecords: ChatToolCallRecord[] = [];
    const currentTurnAttachments: ChatToolAttachment[] = [];
    const toolTurnMessageId = createToolTurnMessageId(response.toolCalls[0]?.id);
    input.onToolTurnMessage?.(
      createToolTurnMessage({
        id: toolTurnMessageId,
        initialMessages: input.initialMessages,
        response,
        toolCallRecords: [],
        toolAttachments: [],
      }),
    );
    const executeCurrentTool = (toolCall: ModelToolCall) =>
      executeAllowedTool(toolCall, input.tools, enabledToolIds, input.executeTool, {
        signal: input.signal,
        supportsVision: Boolean(input.supportsVision),
        onStart: (record) => {
          toolCallRecords.push(record);
          currentTurnRecords.push(record);
          input.onToolCallStart?.(record);
        },
        onComplete: (record, attachments) => {
          const existingIndex = toolCallRecords.findIndex((item) => item.id === record.id);
          if (existingIndex >= 0) {
            toolCallRecords[existingIndex] = record;
          } else {
            toolCallRecords.push(record);
          }
          const currentTurnExistingIndex = currentTurnRecords.findIndex((item) => item.id === record.id);
          if (currentTurnExistingIndex >= 0) {
            currentTurnRecords[currentTurnExistingIndex] = record;
          } else {
            currentTurnRecords.push(record);
          }
          appendUniqueToolAttachments(toolAttachments, attachments);
          appendUniqueToolAttachments(currentTurnAttachments, attachments);
          input.onToolCallComplete?.(record, attachments);
        },
      });
    const hasBrowserAutomationToolCall = response.toolCalls.some((toolCall) => {
      const tool = input.tools.find((entry) => entry.name === toolCall.name || entry.id === toolCall.name);
      return tool ? isBrowserAutomationToolId(tool.id) : false;
    });
    const toolResultMessages: ModelToolResultMessage[] = [];
    if (hasBrowserAutomationToolCall) {
      // 浏览器自动化工具共享 tab、Network 缓存和一次性授权状态；串行执行避免同轮多个工具并发覆盖 grant。
      for (const toolCall of response.toolCalls) {
        toolResultMessages.push(await executeCurrentTool(toolCall));
      }
    } else {
      toolResultMessages.push(...await Promise.all(response.toolCalls.map(executeCurrentTool)));
    }
    if (shouldHonorAbort(input.signal)) {
      return createAbortResponse();
    }
    for (const toolResultMessage of toolResultMessages) {
      appendUniqueToolAttachments(toolAttachments, toolResultMessage.toolAttachments ?? []);
      appendUniqueToolAttachments(currentTurnAttachments, toolResultMessage.toolAttachments ?? []);
    }
    if (hasBrowserAutomationToolCall) {
      const report = createAutomationReportToolAttachment({
        objective: getAutomationObjective(input.initialMessages),
        conclusion: summarizeAutomationConclusion(currentTurnRecords),
        records: currentTurnRecords,
        attachments: currentTurnAttachments,
        playbook: input.automationPlaybookSelection,
      });
      if (report) {
        appendUniqueToolAttachments(toolAttachments, [report]);
        appendUniqueToolAttachments(currentTurnAttachments, [report]);
      }
    }
    const toolTurnMessage = createToolTurnMessage({
      id: toolTurnMessageId,
      initialMessages: input.initialMessages,
      response,
      toolCallRecords: currentTurnRecords,
      toolAttachments: currentTurnAttachments,
    });
    toolTurnMessages.push(toolTurnMessage);

    const visionFollowUp = input.supportsVision
      ? createScreenshotVisionFollowUpMessage({
          toolCallId: response.toolCalls[0]?.id,
          attachments: currentTurnAttachments,
          modelMeta: getModelMetaFromMessages(input.initialMessages),
        })
      : undefined;

    messages = [
      ...messages,
      {
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
        ...(response.reasoningContent ? { reasoningContent: response.reasoningContent } : {}),
      },
      ...toolResultMessages,
      ...(visionFollowUp ? [visionFollowUp] : []),
    ];
  }

  // If the loop finished because maxIterations was hit while tools were still requested,
  // lastResponse remains undefined and exhaustedByMaxIterations should be true.
  if (!lastResponse && !unlimited) {
    exhaustedByMaxIterations = true;
  }

  if (input.requestFinalModel && lastResponse?.ok) {
    if (shouldHonorAbort(input.signal)) {
      return createAbortResponse();
    }
    messages = appendGuidanceMessages(messages, input);
    const finalResponse = await input.requestFinalModel(createFinalRequestMessages(messages));
    if (shouldHonorAbort(input.signal)) {
      return createAbortResponse();
    }
    if (!finalResponse.ok) {
      return finalResponse;
    }
    tokenUsageEntries.push(...(finalResponse.tokenUsageEntries ?? []));

    return {
      ok: true,
      content: finalResponse.content,
      thinking: finalResponse.thinking,
      ...(finalResponse.reasoningContent ? { reasoningContent: finalResponse.reasoningContent } : {}),
      ...(toolAttachments.length ? { toolAttachments } : {}),
      ...(toolTurnMessages.length ? { toolTurnMessages } : {}),
      ...(tokenUsageEntries.length ? { tokenUsageEntries: [...tokenUsageEntries] } : {}),
    };
  }

  // Tool loop exhausted while model still wanted more tools, or no final response was produced.
  // Prefer a final natural-language answer over a hard failure when possible.
  if (input.requestFinalModel) {
    if (shouldHonorAbort(input.signal)) {
      return createAbortResponse();
    }
    messages = appendGuidanceMessages(messages, input);
    const exhaustionMessages = [
      ...messages,
      {
        role: "system" as const,
        content: MAX_ITERATIONS_REACHED_INSTRUCTION,
      },
    ];
    const finalResponse = await input.requestFinalModel(createFinalRequestMessages(exhaustionMessages));
    if (shouldHonorAbort(input.signal)) {
      return createAbortResponse();
    }
    if (finalResponse.ok) {
      tokenUsageEntries.push(...(finalResponse.tokenUsageEntries ?? []));
      const content = finalResponse.content?.trim()
        ? finalResponse.content
        : "工具调用轮次已达上限，已停止继续操作。请根据上文已完成结果继续处理未完成项。";
      return {
        ok: true,
        content,
        thinking: finalResponse.thinking,
        ...(finalResponse.reasoningContent ? { reasoningContent: finalResponse.reasoningContent } : {}),
        ...(toolAttachments.length ? { toolAttachments } : {}),
        ...(toolTurnMessages.length ? { toolTurnMessages } : {}),
        ...(tokenUsageEntries.length ? { tokenUsageEntries: [...tokenUsageEntries] } : {}),
      };
    }
  }

  if (lastResponse?.ok) {
    if (!exhaustedByMaxIterations) {
      return lastResponse;
    }
    return {
      ...lastResponse,
      content: lastResponse.content?.trim()
        ? `${lastResponse.content}

（提示：工具调用轮次已达上限，已停止继续操作。）`
        : "工具调用轮次已达上限，已停止继续操作。请根据上文已完成结果处理未完成项；若打开了临时网页请手动关闭。",
    };
  }

  return {
    ok: true,
    content: "工具调用轮次已达上限，已停止继续操作。请根据上文已完成结果处理未完成项；若打开了临时网页请手动关闭，或提高“浏览器自动化最大工具轮次”后重试。",
    ...(toolAttachments.length ? { toolAttachments } : {}),
    ...(toolTurnMessages.length ? { toolTurnMessages } : {}),
    ...(tokenUsageEntries.length ? { tokenUsageEntries: [...tokenUsageEntries] } : {}),
  };
}

function appendGuidanceMessages(messages: ModelRequestMessage[], input: RunModelToolLoopInput): ModelRequestMessage[] {
  const guidanceItems = input.consumeGuidance?.() ?? [];
  if (guidanceItems.length === 0) {
    return messages;
  }

  const guidanceMessages = guidanceItems
    .map((item) => createGuidanceModelMessage(item))
    .filter((message) => Boolean(message.content.trim()) || Boolean(message.attachments?.length));
  for (const item of guidanceItems) {
    const createdAt = Date.now();
    input.onToolTurnMessage?.(createGuidanceToolTurnMessage(item, createdAt));
    input.onGuidanceConsumed?.(item.id);
  }

  return guidanceMessages.length ? [...messages, ...guidanceMessages] : messages;
}

function createGuidanceModelMessage(item: GuidanceItem): ChatMessage {
  const guidanceContent = buildGuidanceContent(item);
  return createGuidanceMessage(
    item.id,
    `${GUIDANCE_PREFIX}\n${guidanceContent}\n\n${GUIDANCE_SUFFIX}`,
    item.attachments,
  );
}

function createGuidanceMessage(id: string, content: string, attachments?: ChatImageAttachment[], createdAt = Date.now()): ChatMessage {
  return {
    id,
    role: "user",
    content,
    createdAt,
    modelId: "",
    endpointType: "openai_chat",
    streamMode: false,
    systemPrompt: "",
    contextPrompt: "",
    contextMode: "text",
    attachments,
  };
}

function createGuidanceToolTurnMessage(item: GuidanceItem, createdAt: number): ChatMessage {
  return {
    id: `message-${createdAt}-guided-follow-up-${item.id}`,
    role: "assistant",
    assistantMessageKind: "tool_call_turn",
    content: "",
    createdAt,
    modelId: "",
    endpointType: "openai_chat",
    streamMode: false,
    systemPrompt: "",
    contextPrompt: "",
    contextMode: "text",
    toolCallRecords: [
      {
        id: `guided-follow-up-${item.id}`,
        toolId: "chat.follow_up_guidance",
        name: "chat_follow_up_guidance",
        displayName: "已引导对话",
        arguments: {},
        status: "success",
        startedAt: createdAt,
        completedAt: createdAt,
        resultSummary: getGuidanceResultSummary(item),
      },
    ],
  };
}

function buildGuidanceContent(item: GuidanceItem): string {
  const expandedContent = item.promptInvocations?.length
    ? buildPromptExpandedUserContent({
        content: item.content,
        promptInvocations: item.promptInvocations,
      }).trim()
    : item.content.trim();
  if (expandedContent) {
    return expandedContent;
  }
  return item.attachments?.length ? "用户补充了图片附件。" : "";
}

function getGuidanceResultSummary(item: GuidanceItem): string {
  const content = item.content.trim();
  if (content) {
    return content;
  }
  if (item.promptInvocations?.length) {
    return "已选用任务策略";
  }
  if (item.attachments?.length) {
    return "图片消息";
  }
  return "";
}

function createFinalRequestMessages(messages: ModelRequestMessage[]): ModelRequestMessage[] {
  return [
    ...messages,
    {
      role: "user",
      content: FINAL_RESPONSE_INSTRUCTION,
    },
  ];
}

function createAbortResponse(): ModelToolLoopResponse {
  return { ok: false, message: "已终止本次生成。" };
}

/**
 * Only honor explicit user cancel / sync restore.
 * Bare AbortSignal without a known reason is treated as non-fatal for the tool loop
 * so transient port disconnects cannot drop already-received tool decisions.
 */
function shouldHonorAbort(signal?: AbortSignal): boolean {
  if (!signal?.aborted) {
    return false;
  }
  const reason = signal.reason;
  if (reason === "user_cancel" || reason === "sync_restore") {
    return true;
  }
  if (typeof reason === "string") {
    return reason === "user_cancel" || reason === "sync_restore";
  }
  // Unknown / empty abort reason: do not kill the tool loop.
  return false;
}

function createToolTurnMessage(input: {
  id: string;
  initialMessages: ModelRequestMessage[];
  response: Extract<ModelToolLoopResponse, { ok: true }>;
  toolCallRecords: ChatToolCallRecord[];
  toolAttachments: ChatToolAttachment[];
}): ChatMessage {
  const createdAt = Date.now();
  const baseMessage = input.initialMessages.find((message): message is ChatMessage => "id" in message && "modelId" in message);
  return {
    id: input.id,
    role: "assistant",
    assistantMessageKind: "tool_call_turn",
    content: input.response.content,
    thinking: input.response.thinking,
    reasoningContent: input.response.reasoningContent,
    createdAt,
    modelId: baseMessage?.modelId ?? "",
    endpointType: baseMessage?.endpointType ?? "openai_chat",
    streamMode: baseMessage?.streamMode ?? false,
    systemPrompt: baseMessage?.systemPrompt ?? "",
    contextPrompt: baseMessage?.contextPrompt ?? "",
    contextMode: baseMessage?.contextMode ?? "text",
    matchedRuleId: baseMessage?.matchedRuleId,
    toolCallRecords: input.toolCallRecords,
    toolAttachments: input.toolAttachments.length ? input.toolAttachments : undefined,
  };
}

function createToolTurnMessageId(firstToolCallId: string | undefined): string {
  return `message-${Date.now()}-tool-turn-${firstToolCallId ?? "unknown"}`;
}

function getAutomationObjective(messages: ModelRequestMessage[]): string {
  const userMessage = messages.find((message): message is Extract<ModelRequestMessage, { role: "user"; content: string }> =>
    message.role === "user" && typeof message.content === "string" && Boolean(message.content.trim()),
  );
  return truncateText(userMessage?.content.trim() || "未记录任务目标", 500).text;
}

function summarizeAutomationConclusion(records: ChatToolCallRecord[]): string {
  const successCount = records.filter((record) => record.status === "success").length;
  const errorRecords = records.filter((record) => record.status === "error");
  if (errorRecords.length > 0) {
    const failedTools = Array.from(new Set(errorRecords.map((record) => record.displayName || record.name))).join("、");
    return `已执行 ${records.length} 个自动化步骤，其中 ${successCount} 个成功、${errorRecords.length} 个失败；失败工具：${failedTools}。`;
  }
  return `已执行 ${records.length} 个自动化步骤，全部成功完成。`;
}

async function executeAllowedTool(
  toolCall: ModelToolCall,
  tools: ModelToolRegistryEntry[],
  enabledToolIds: Set<string>,
  executeTool: ModelToolExecutor,
  callbacks: {
    signal?: AbortSignal;
    supportsVision?: boolean;
    onStart: (record: ChatToolCallRecord) => void;
    onComplete: (record: ChatToolCallRecord, attachments: ChatToolAttachment[]) => void;
  },
): Promise<ModelToolResultMessage> {
  const tool = tools.find((candidate) => candidate.name === toolCall.name);
  const runningRecord: ChatToolCallRecord = {
    id: toolCall.id,
    toolId: tool?.id ?? toolCall.name,
    name: toolCall.name,
    displayName: tool?.displayName ?? toolCall.name,
    arguments: sanitizeToolArguments(toolCall.arguments),
    status: "running",
    startedAt: Date.now(),
  };
  callbacks.onStart(runningRecord);

  if (!tool) {
    return completeToolError(runningRecord, toolCall, `工具 ${toolCall.name} 未注册，已拒绝执行。`, callbacks);
  }

  if (!enabledToolIds.has(tool.id)) {
    return completeToolError(runningRecord, toolCall, `工具 ${toolCall.name} 未启用，已拒绝执行。`, callbacks);
  }

  if (
    !callbacks.supportsVision &&
    (tool.id === BROWSER_SCREENSHOT_TOOL_ID || tool.name === BROWSER_SCREENSHOT_TOOL_NAME || toolCall.name === BROWSER_SCREENSHOT_TOOL_NAME)
  ) {
    return completeToolError(
      runningRecord,
      toolCall,
      "当前模型不支持视觉理解/识图，已跳过 screenshot。请改用 take_snapshot/DOM/Network，或对验证码标记 needs_human 后继续其他站点。",
      callbacks,
    );
  }

  if (toolCall.parseError) {
    return completeToolError(runningRecord, toolCall, `工具 ${toolCall.name} 参数无效：${toolCall.parseError}`, callbacks);
  }

  try {
    if (shouldHonorAbort(callbacks.signal)) {
      return completeToolError(runningRecord, toolCall, "已终止本次生成。", callbacks);
    }
    const result = await executeTool(toolCall, tool, { signal: callbacks.signal });
    if (shouldHonorAbort(callbacks.signal)) {
      return completeToolError(runningRecord, toolCall, "已终止本次生成。", callbacks);
    }
    const resultMessage: ModelToolResultMessage = {
      role: "tool",
      toolCallId: result.toolCallId,
      name: result.name,
      content: result.content,
      ...(result.isError ? { isError: true } : {}),
      ...(result.toolAttachments?.length ? { toolAttachments: result.toolAttachments } : {}),
    };
    callbacks.onComplete(createCompletedToolRecord(runningRecord, resultMessage), result.toolAttachments ?? []);
    return resultMessage;
  } catch {
    return completeToolError(runningRecord, toolCall, `工具 ${toolCall.name} 执行失败，请稍后重试。`, callbacks);
  }
}

function completeToolError(
  runningRecord: ChatToolCallRecord,
  toolCall: ModelToolCall,
  content: string,
  callbacks: { onComplete: (record: ChatToolCallRecord, attachments: ChatToolAttachment[]) => void },
): ModelToolResultMessage {
  const result = createToolErrorResult(toolCall, content);
  callbacks.onComplete(createCompletedToolRecord(runningRecord, result), []);
  return result;
}

function createToolErrorResult(toolCall: ModelToolCall, content: string): ModelToolResultMessage {
  return {
    role: "tool",
    toolCallId: toolCall.id,
    name: toolCall.name,
    content,
    isError: true,
  };
}

function createCompletedToolRecord(record: ChatToolCallRecord, result: ModelToolResultMessage): ChatToolCallRecord {
  const attachmentIds = result.toolAttachments?.map((attachment) => attachment.id).filter(Boolean) ?? [];
  return {
    ...record,
    status: result.isError ? "error" : "success",
    completedAt: Date.now(),
    resultSummary: truncateText(result.content.trim(), 280).text,
    ...(result.isError ? { errorMessage: result.content } : {}),
    ...(attachmentIds.length ? { attachmentIds } : {}),
  };
}

function appendUniqueToolAttachments(target: ChatToolAttachment[], attachments: ChatToolAttachment[]): void {
  for (const attachment of attachments) {
    if (!target.some((item) => item.id === attachment.id)) {
      target.push(attachment);
    }
  }
}

function createScreenshotVisionFollowUpMessage(input: {
  toolCallId?: string;
  attachments: ChatToolAttachment[];
  modelMeta: Pick<ChatMessage, "modelId" | "endpointType" | "streamMode" | "systemPrompt" | "contextPrompt" | "contextMode">;
}): ChatMessage | undefined {
  const images = input.attachments
    .filter(isBrowserScreenshotToolAttachment)
    .filter((attachment) => typeof attachment.dataUrl === "string" && attachment.dataUrl.startsWith("data:image/"))
    .slice(0, 3)
    .map((attachment, index) => ({
      id: attachment.id || `screenshot-vision-${Date.now()}-${index}`,
      name: attachment.uid ? `element-${attachment.uid}.png` : `viewport-${index + 1}.png`,
      mediaType: attachment.mediaType || "image/png",
      dataUrl: attachment.dataUrl,
    }));

  if (!images.length) {
    return undefined;
  }

  return {
    id: `vision-followup-${input.toolCallId || Date.now()}`,
    role: "user",
    content: [
      "以下图片来自上一轮 screenshot 工具附件，请直接识读。",
      "若是图形验证码：只输出验证码字符（忽略干扰线），然后 fill 输入框并 click 确认。",
      "若是 SHIELD/我不是机器人复选框：click 复选框本身，不要只点外层卡片。",
      "若是 Cloudflare Turnstile iframe：click 该 iframe UID（真实鼠标），不要只截图；图片点选挑战才 needs_human。",
      "若看不清：先对验证码图片元素再 screenshot(target=element)，不要猜测后直接放弃。",
    ].join("\n"),
    createdAt: Date.now(),
    modelId: input.modelMeta.modelId,
    endpointType: input.modelMeta.endpointType,
    streamMode: input.modelMeta.streamMode,
    systemPrompt: input.modelMeta.systemPrompt,
    contextPrompt: input.modelMeta.contextPrompt,
    contextMode: input.modelMeta.contextMode,
    attachments: images,
  };
}

function getModelMetaFromMessages(
  messages: ModelRequestMessage[],
): Pick<ChatMessage, "modelId" | "endpointType" | "streamMode" | "systemPrompt" | "contextPrompt" | "contextMode"> {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && typeof message === "object" && "modelId" in message && "endpointType" in message) {
      const chatMessage = message as ChatMessage;
      return {
        modelId: chatMessage.modelId,
        endpointType: chatMessage.endpointType,
        streamMode: chatMessage.streamMode,
        systemPrompt: chatMessage.systemPrompt,
        contextPrompt: chatMessage.contextPrompt,
        contextMode: chatMessage.contextMode,
      };
    }
  }
  return {
    modelId: "",
    endpointType: "openai_chat",
    streamMode: true,
    systemPrompt: "",
    contextPrompt: "",
    contextMode: "text",
  };
}

function sanitizeToolArguments(args: Record<string, unknown>): Record<string, unknown> {
  return sanitizeToolArgumentValue(args, "", 0, new WeakSet<object>()) as Record<string, unknown>;
}

function sanitizeToolArgumentValue(value: unknown, key: string, depth: number, seen: WeakSet<object>): unknown {
  if (key && SENSITIVE_TOOL_ARGUMENT_KEY_PATTERN.test(key)) {
    return REDACTED_TOOL_ARGUMENT_VALUE;
  }

  if (typeof value === "string") {
    return truncateText(redactSensitiveText(value), 1000).text;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    return UNSERIALIZABLE_TOOL_ARGUMENT_VALUE;
  }
  if (depth >= MAX_TOOL_ARGUMENT_REDACTION_DEPTH) {
    return Array.isArray(value) ? [] : {};
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value !== "object") {
    return UNSERIALIZABLE_TOOL_ARGUMENT_VALUE;
  }
  if (seen.has(value)) {
    return UNSERIALIZABLE_TOOL_ARGUMENT_VALUE;
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeToolArgumentValue(item, "", depth + 1, seen));
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        sanitizeToolArgumentValue(childValue, childKey, depth + 1, seen),
      ]),
    );
  } finally {
    seen.delete(value);
  }
}
