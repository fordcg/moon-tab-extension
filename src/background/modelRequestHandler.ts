import { parseAssistantResponse } from "../shared/chat/parseAssistantResponse";
import { createTokenUsageEntry } from "../shared/chat/tokenUsage";
import { createModelRequestPayload } from "../shared/models/modelRequestPayload";
import { shouldPassDeepSeekReasoningContent } from "../shared/models/openaiChatAdapter";
import { normalizeModelRequestRetryCount, shouldRetryModelResponse, withModelRequestRetry, type ModelRequestRetryProgress } from "../shared/models/modelRequestRetry";
import { CURRENT_TIME_TOOL_ID, getRegisteredModelTools, isBrowserAutomationToolId, resolveEnabledModelTools, TAVILY_SEARCH_TOOL_ID } from "../shared/models/toolRegistry";
import type { ModelRequestMessage, ModelToolCall, ModelToolChoice, ModelToolDefinition, ModelToolExecutor, ModelToolRegistryEntry, OpenAIStructuredOutputFormat } from "../shared/models/types";
import type {
  AutomationPlaybookSettings,
  ChatSendDebugContext,
  ChatImageAttachment,
  ChatMessage,
  ChatPromptInvocation,
  ChatTokenUsageEntry,
  ChatTokenUsageSource,
  ChatToolAttachment,
  ChatToolCallRecord,
  ExtractionRule,
  ImportedAutomationPlaybook,
  McpServerSecretMap,
  McpSettings,
  ModelConfig,
} from "../shared/types";
import { parseTavilyApiKeys, type TavilySearchOptions } from "../shared/webSearch/tavily";
import { getWebSearchSettings } from "../shared/webSearch/settings";
import { getEnabledAutomationPlaybooks, normalizeAutomationPlaybookSettings, shouldRunAutomationPlaybookSelection } from "../shared/automationPlaybooks";
import { parseMcpToolId } from "../shared/mcp/toolAdapter";
import { appendBrowserControlPromptIfNeeded, createBackgroundToolExecutor, createModelToolDefinition, normalizeBrowserAutomationMaxToolIterations, shouldExposeTool } from "./backgroundToolRuntime";
import { selectAutomationPlaybook } from "./automationPlaybookSelector";
import { createChatRequestLogClient, type ChatRequestLogClient } from "./chatRequestLogFile";
import { extractAssistantResponseData } from "./modelAssistantResponseParser";
import { readModelStreamResponse } from "./modelStreamResponseParser";
import { runModelToolLoop } from "./toolCalling/toolLoop";

export interface ChatSendMessage {
  type: "chat.send";
  tabId?: number;
  model: ModelConfig;
  messages: ModelRequestMessage[];
  stream: boolean;
  structuredOutput?: OpenAIStructuredOutputFormat;
  enabledToolIds?: string[];
  toolChoice?: ModelToolChoice;
  tavily?: TavilySearchOptions;
  retryCount?: number;
  tokenUsageSource?: ChatTokenUsageSource;
  browserAutomationMaxToolIterations?: number;
  automationPlaybookSettings?: AutomationPlaybookSettings;
  importedSkillPlaybooks?: ImportedAutomationPlaybook[];
  selectedPlaybookId?: string;
  extractionRules?: ExtractionRule[];
  mcp?: McpSettings & { bearerTokens?: McpServerSecretMap };
  debugContext?: ChatSendDebugContext;
  workspaceRequestLoggingEnabled?: boolean;
  requestLogging?: {
    sidebarState?: Record<string, unknown>;
  };
}

type ChatSendHandlerMessage = ChatSendMessage & {
  signal?: AbortSignal;
};

type PreparedChatSendMessage = ChatSendHandlerMessage & {
  tools?: ModelToolDefinition[];
};

export type ChatSendResponse =
  | {
      ok: true;
      content: string;
      thinking?: string;
      reasoningContent?: string;
      toolCalls?: ModelToolCall[];
      toolCallRecords?: ChatToolCallRecord[];
      toolAttachments?: ChatToolAttachment[];
      toolTurnMessages?: ChatMessage[];
      tokenUsageEntries?: ChatTokenUsageEntry[];
    }
  | {
      ok: false;
      message: string;
      status?: number;
      errorBody?: string;
    };

type Fetcher = typeof fetch;

interface ChatStreamCallbacks {
  onContentChunk?: (content: string) => void;
  onThinkingChunk?: (content: string) => void;
  onRetryProgress?: (progress: ModelRequestRetryProgress) => void;
  onFinalResponseStart?: () => void;
  onTokenUsageEntries?: (entries: ChatTokenUsageEntry[]) => void;
  onToolTurnMessage?: (message: ChatMessage) => void;
  onToolCallStart?: (record: ChatToolCallRecord) => void;
  onToolCallComplete?: (record: ChatToolCallRecord, attachments: ChatToolAttachment[]) => void;
  consumeGuidance?: () => Array<{
    id: string;
    content: string;
    attachments?: ChatImageAttachment[];
    promptInvocations?: ChatPromptInvocation[];
    userMessageId?: string;
  }>;
  onGuidanceConsumed?: (followUpId: string) => void;
}

interface ChatSendOptions {
  shouldExposeTool?: (tool: ReturnType<typeof getRegisteredModelTools>[number]) => boolean;
}

interface SessionLogCounters {
  modelRequestCount: number;
  toolCallCount: number;
  mcpCallCount: number;
}

export async function handleChatSendMessage(
  message: ChatSendHandlerMessage,
  fetcher: Fetcher = fetch,
  callbacks: ChatStreamCallbacks = {},
  executeTool?: ModelToolExecutor,
  options: ChatSendOptions = {},
): Promise<ChatSendResponse> {
  const requestId = message.debugContext?.requestId || createRequestId();
  const log = createChatRequestLogClient({
    enabled: Boolean(message.workspaceRequestLoggingEnabled),
    requestId,
    source: message.debugContext?.source,
    sessionId: message.debugContext?.sessionId,
    fetcher,
  });
  const counters: SessionLogCounters = {
    modelRequestCount: 0,
    toolCallCount: 0,
    mcpCallCount: 0,
  };
  const startedAt = Date.now();

  const enabledTools = resolveEnabledModelTools(getRegisteredModelTools(message.mcp), message.enabledToolIds ?? []);
  const exposeTool = options.shouldExposeTool ?? shouldExposeTool;
  const tavilyConfigured = await hasConfiguredTavilyApiKey();
  const exposedTools = message.structuredOutput
    ? []
    : enabledTools
      .filter(exposeTool)
      .filter((tool) => tool.id !== TAVILY_SEARCH_TOOL_ID || tavilyConfigured);
  const toolExecutor = executeTool ?? createBackgroundToolExecutor(message, fetcher);
  const skillPlaybooks = Array.isArray(message.importedSkillPlaybooks)
    ? message.importedSkillPlaybooks
    : [];
  const automationPlaybookSelection = await maybeSelectAutomationPlaybook(message, exposedTools, fetcher);
  const initialMessages = appendBrowserControlPromptIfNeeded(
    message.messages,
    exposedTools,
    automationPlaybookSelection,
    skillPlaybooks,
  );
  const exposedToolIds = exposedTools.map((tool) => tool.id);
  const toolOptions = exposedTools.length > 0
    ? {
        tools: exposedTools.map(createModelToolDefinition),
        toolChoice: message.toolChoice,
      }
    : {};

  emitSessionStart(log, message, exposedTools, exposedToolIds, initialMessages);

  const loggedCallbacks = createLoggedToolCallbacks(log, counters, callbacks);

  try {
    if (exposedTools.length > 0) {
      const response = await runModelToolLoop({
        initialMessages,
        tools: exposedTools,
        enabledToolIds: exposedToolIds,
        // 工具链路会产生决策与最终回答两次模型响应，需要固定来源，不能沿用调用方传入的普通请求来源。
        requestModel: (messages) =>
          requestModelOnce(
            { ...message, messages, stream: false, tools: toolOptions.tools, toolChoice: toolOptions.toolChoice, tokenUsageSource: "tool_decision" },
            fetcher,
            callbacks,
            log,
            counters,
          ),
        requestFinalModel: (messages: ModelRequestMessage[]) => {
          callbacks.onFinalResponseStart?.();
          return requestModelOnce(
            { ...message, messages, stream: message.stream, tools: undefined, toolChoice: undefined, tokenUsageSource: "tool_final" },
            fetcher,
            callbacks,
            log,
            counters,
          );
        },
        executeTool: toolExecutor,
        automationPlaybookSelection,
        signal: message.signal,
        onToolTurnMessage: callbacks.onToolTurnMessage,
        onToolCallStart: loggedCallbacks.onToolCallStart,
        onToolCallComplete: loggedCallbacks.onToolCallComplete,
        consumeGuidance: callbacks.consumeGuidance,
        onGuidanceConsumed: callbacks.onGuidanceConsumed,
        ...(exposedTools.some((tool) => isBrowserAutomationToolId(tool.id))
          ? { maxIterations: normalizeBrowserAutomationMaxToolIterations(message.browserAutomationMaxToolIterations) }
          : {}),
      });
      emitSessionEnd(log, response, counters, startedAt);
      return response;
    }

    const response = await requestModelOnce(
      { ...message, messages: initialMessages, tools: toolOptions.tools, toolChoice: toolOptions.toolChoice },
      fetcher,
      callbacks,
      log,
      counters,
    );
    emitSessionEnd(log, response, counters, startedAt);
    return response;
  } catch (error) {
    const failed: ChatSendResponse = {
      ok: false,
      message: error instanceof Error ? error.message : "模型请求失败，请稍后重试",
    };
    emitSessionEnd(log, failed, counters, startedAt);
    throw error;
  }
}

async function maybeSelectAutomationPlaybook(
  message: ChatSendHandlerMessage,
  exposedTools: ReturnType<typeof resolveEnabledModelTools>,
  fetcher: Fetcher,
) {
  if (!message.automationPlaybookSettings || message.structuredOutput || exposedTools.length === 0 || !exposedTools.some((tool) => isBrowserAutomationToolId(tool.id))) {
    return undefined;
  }
  const skillPlaybooks = Array.isArray(message.importedSkillPlaybooks)
    ? message.importedSkillPlaybooks
    : [];
  const playbooks = getEnabledAutomationPlaybooks(message.automationPlaybookSettings, skillPlaybooks);
  if (playbooks.length === 0) {
    return undefined;
  }

  // Slash-selected strategy forces this playbook; skip model preselection.
  const forcedId = typeof message.selectedPlaybookId === "string" ? message.selectedPlaybookId.trim() : "";
  if (forcedId) {
    const forced = playbooks.find((item) => item.id === forcedId);
    if (forced) {
      return {
        playbookId: forced.id,
        title: forced.title,
        source: forced.source,
        confidence: "high" as const,
        reason: "用户通过 / 指定任务策略",
      };
    }
  }

  const userContent = getLatestUserContent(message.messages);
  if (!shouldRunAutomationPlaybookSelection(userContent)) {
    return undefined;
  }
  return selectAutomationPlaybook({
    model: message.model,
    userContent,
    pageContextSummary: getPageContextSummary(message.messages),
    playbooks,
    retryCount: message.retryCount,
    fetcher,
    signal: message.signal,
  });
}

function getLatestUserContent(messages: ModelRequestMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && typeof message.content === "string" && message.content.trim()) {
      return message.content.trim();
    }
  }
  return "";
}

function getPageContextSummary(messages: ModelRequestMessage[]): string | undefined {
  const systemText = messages
    .filter((message): message is Extract<ModelRequestMessage, { role: "system"; content: string }> => message.role === "system" && typeof message.content === "string")
    .map((message) => message.content)
    .join("\n");
  const title = systemText.match(/页面标题[:：]\s*(.+)/)?.[1]?.trim();
  const url = systemText.match(/当前 URL[:：]\s*(.+)/)?.[1]?.trim() ?? systemText.match(/URL[:：]\s*(https?:\/\/\S+)/)?.[1]?.trim();
  const parts = [title ? `标题：${title.slice(0, 120)}` : "", url ? `URL：${url.slice(0, 200)}` : ""].filter(Boolean);
  return parts.length ? parts.join("\n") : undefined;
}

async function hasConfiguredTavilyApiKey(): Promise<boolean> {
  try {
    const settings = await getWebSearchSettings();
    return parseTavilyApiKeys(settings.tavily.apiKeysText).length > 0;
  } catch {
    return false;
  }
}

function logPreparedModelRequest(
  message: PreparedChatSendMessage,
  retryCount: number,
  log: ChatRequestLogClient,
  counters: SessionLogCounters,
): void {
  const debugContext = normalizeChatSendDebugContext(message);
  if (debugContext) {
    console.debug("[chat-send] 准备发送模型请求", {
      debugContext,
      model: {
        id: message.model.id,
        modelId: message.model.modelId,
        displayName: message.model.displayName,
        channelName: message.model.channelName,
        endpointType: message.model.endpointType,
      },
      request: {
        stream: message.stream,
        messageCount: message.messages.length,
        retryCount,
        tokenUsageSource: message.tokenUsageSource ?? "chat",
        enabledToolIds: message.enabledToolIds ?? [],
        currentTimeToolEnabled: Boolean(message.enabledToolIds?.includes(CURRENT_TIME_TOOL_ID)),
        toolCount: message.tools?.length ?? 0,
        toolChoice: message.toolChoice,
        structuredOutput: Boolean(message.structuredOutput),
        ...(typeof message.tabId === "number" ? { tabId: message.tabId } : {}),
      },
    });
  }

  counters.modelRequestCount += 1;
  log.emit("model_request", {
    tokenUsageSource: message.tokenUsageSource ?? "chat",
    stream: message.stream,
    retryCount,
    messages: message.messages,
    tools: message.tools,
    toolChoice: message.toolChoice,
    endpointType: message.model.endpointType,
    modelId: message.model.modelId,
  });
}

function normalizeChatSendDebugContext(message: PreparedChatSendMessage): ChatSendDebugContext | undefined {
  if (!message.debugContext) {
    return undefined;
  }

  return {
    ...message.debugContext,
    stream: message.debugContext.stream ?? message.stream,
    tokenUsageSource: message.debugContext.tokenUsageSource ?? message.tokenUsageSource,
    requestMessageCount: message.debugContext.requestMessageCount ?? message.messages.length,
    enabledToolIds: message.debugContext.enabledToolIds ?? message.enabledToolIds,
    currentTimeToolEnabled: Boolean(message.enabledToolIds?.includes(CURRENT_TIME_TOOL_ID)),
    ...(message.debugContext.selectedTabId === undefined && typeof message.tabId === "number" ? { selectedTabId: message.tabId } : {}),
  };
}

async function requestModelOnce(
  message: PreparedChatSendMessage,
  fetcher: Fetcher,
  callbacks: ChatStreamCallbacks = {},
  log: ChatRequestLogClient,
  counters: SessionLogCounters,
): Promise<ChatSendResponse> {
  try {
    const payload = createModelRequestPayload(message.model, message.messages, message.stream, message.structuredOutput, {
      tools: message.tools,
      toolChoice: message.toolChoice,
    });
    const requestInit = {
      method: "POST",
      headers: payload.headers,
      body: JSON.stringify(payload.body),
      signal: message.signal,
    };
    const retryCount = normalizeModelRequestRetryCount(message.retryCount);
    logPreparedModelRequest(message, retryCount, log, counters);

    if (message.stream) {
      const streamResponse = await withModelRequestRetry(() => fetcher(payload.url, requestInit), retryCount, {
        signal: message.signal,
        onRetryResult: cancelRetryableResponseBody,
        onRetryScheduled: callbacks.onRetryProgress,
      });

      if (!streamResponse.ok) {
        const failed: ChatSendResponse = {
          ok: false,
          message: `模型请求失败：${streamResponse.status} ${streamResponse.statusText}`.trim(),
        };
        emitModelResponse(log, {
          ...failed,
          status: streamResponse.status,
        });
        return failed;
      }

      const response = await readModelStreamResponse(streamResponse, message.model, callbacks, message.tokenUsageSource ?? "chat");
      if (response.ok && response.tokenUsageEntries?.length) {
        callbacks.onTokenUsageEntries?.(response.tokenUsageEntries);
      }
      emitModelResponse(log, response);
      return response;
    }

    const modelResponse = await withModelRequestRetry(() => fetchAndReadModelResponse(fetcher, payload.url, requestInit), retryCount, {
      signal: message.signal,
      shouldRetryResult: (result) => result.retryable,
      onRetryResult: (result) => cancelRetryableResponseBody(result.response),
      onRetryScheduled: callbacks.onRetryProgress,
    });

    if (!modelResponse.response.ok) {
      const errorBody = message.structuredOutput ? await readSafeErrorBody(modelResponse.response) : undefined;
      const failed: ChatSendResponse = {
        ok: false,
        message: `模型请求失败：${modelResponse.response.status} ${modelResponse.response.statusText}`.trim(),
        ...(message.structuredOutput ? { status: modelResponse.response.status, errorBody } : {}),
      };
      emitModelResponse(log, {
        ...failed,
        status: modelResponse.response.status,
      });
      return failed;
    }

    const responseData = extractAssistantResponseData(modelResponse.data, {
      structuredOutput: message.structuredOutput,
      collectToolCalls: Boolean(message.tools?.length),
    });
    if (!responseData.content && !responseData.toolCalls?.length) {
      const failed: ChatSendResponse = { ok: false, message: "模型响应中没有可用内容" };
      emitModelResponse(log, failed);
      return failed;
    }

    const parsed = parseAssistantResponse(responseData.content);
    const tokenUsageEntry = responseData.tokenUsage
      ? createTokenUsageEntry({
          usage: responseData.tokenUsage,
          source: message.tokenUsageSource ?? "chat",
          modelId: message.model.id,
          endpointType: message.model.endpointType,
        })
      : undefined;
    if (tokenUsageEntry) {
      callbacks.onTokenUsageEntries?.([tokenUsageEntry]);
    }
    const success: ChatSendResponse = {
      ok: true,
      content: parsed.content,
      thinking: responseData.reasoningContent || parsed.thinking,
      ...(shouldPassDeepSeekReasoningContent(message.model) && responseData.reasoningContent
        ? { reasoningContent: responseData.reasoningContent }
        : {}),
      ...(responseData.toolCalls?.length ? { toolCalls: responseData.toolCalls } : {}),
      ...(tokenUsageEntry ? { tokenUsageEntries: [tokenUsageEntry] } : {}),
    };
    emitModelResponse(log, success);
    return success;
  } catch {
    const failed: ChatSendResponse = {
      ok: false,
      message: "模型请求失败，请稍后重试",
    };
    emitModelResponse(log, failed);
    return failed;
  }
}

async function fetchAndReadModelResponse(
  fetcher: Fetcher,
  url: string,
  init: RequestInit,
): Promise<{ response: Response; data?: unknown; retryable: boolean }> {
  const response = await fetcher(url, init);

  if (!response.ok) {
    return { response, retryable: shouldRetryModelResponse(response) };
  }

  const data = await response.json();
  return { response, data, retryable: false };
}

function cancelRetryableResponseBody(response: Response): Promise<void> | void {
  // 已决定丢弃该响应并重试时主动取消 body，避免连续失败占用连接资源。
  return response.body?.cancel().catch(() => undefined);
}

async function readSafeErrorBody(response: Response): Promise<string | undefined> {
  try {
    // 这里只在错误响应分支读取一次 body，用作结构化输出能力降级的诊断快照；读取后不会再复用该响应体。
    const text = await response.text();
    return text.slice(0, 2000);
  } catch {
    return undefined;
  }
}

function emitSessionStart(
  log: ChatRequestLogClient,
  message: ChatSendHandlerMessage,
  exposedTools: ModelToolRegistryEntry[],
  exposedToolIds: string[],
  initialMessages: ModelRequestMessage[],
): void {
  log.emit("session_start", {
    debugContext: message.debugContext,
    sidebarState: message.requestLogging?.sidebarState,
    mode: message.requestLogging?.sidebarState?.mode,
    enabledToolIds: message.enabledToolIds ?? [],
    exposedToolIds,
    toolDefinitions: exposedTools.map((tool) => ({
      id: tool.id,
      name: tool.name,
      displayName: tool.displayName,
      description: tool.description,
      runtime: tool.toolClassification?.runtime,
      risk: tool.toolClassification?.risk,
    })),
    mcp: summarizeMcpForLog(message.mcp),
    model: {
      id: message.model.id,
      modelId: message.model.modelId,
      displayName: message.model.displayName,
      channelName: message.model.channelName,
      endpointType: message.model.endpointType,
    },
    systemPrompt: extractSystemPrompt(initialMessages),
    privateMode: message.debugContext?.privateMode,
  });
}

function emitModelResponse(log: ChatRequestLogClient, response: ChatSendResponse): void {
  if (response.ok) {
    log.emit("model_response", {
      content: response.content,
      thinking: response.thinking,
      reasoningContent: response.reasoningContent,
      toolCalls: response.toolCalls,
      tokenUsage: response.tokenUsageEntries,
    });
    return;
  }

  log.emit("model_response", {
    ok: false,
    errorMessage: response.message,
    status: response.status,
    errorBody: response.errorBody,
  });
}

function emitSessionEnd(
  log: ChatRequestLogClient,
  response: ChatSendResponse,
  counters: SessionLogCounters,
  startedAt: number,
): void {
  log.emit("session_end", {
    status: response.ok ? "success" : "error",
    finalContentSummary: response.ok ? summarizeText(response.content) : undefined,
    errorMessage: response.ok ? undefined : response.message,
    toolCallCount: counters.toolCallCount,
    mcpCallCount: counters.mcpCallCount,
    modelRequestCount: counters.modelRequestCount,
    totalDurationMs: Math.max(0, Date.now() - startedAt),
  });
}

function createLoggedToolCallbacks(
  log: ChatRequestLogClient,
  counters: SessionLogCounters,
  callbacks: ChatStreamCallbacks,
): Pick<ChatStreamCallbacks, "onToolCallStart" | "onToolCallComplete"> {
  return {
    onToolCallStart: (record) => {
      counters.toolCallCount += 1;
      log.emit("tool_call_start", { record });
      const mcp = parseMcpToolId(record.toolId);
      if (mcp) {
        counters.mcpCallCount += 1;
        log.emit("mcp_call", {
          serverId: mcp.serverId,
          toolName: mcp.toolName,
          record,
        });
      }
      callbacks.onToolCallStart?.(record);
    },
    onToolCallComplete: (record, attachments) => {
      log.emit("tool_call_complete", {
        record,
        attachments: summarizeAttachments(attachments),
      });
      const mcp = parseMcpToolId(record.toolId);
      if (mcp) {
        log.emit("mcp_result", {
          serverId: mcp.serverId,
          toolName: mcp.toolName,
          record,
          attachments: summarizeAttachments(attachments),
        });
      }
      callbacks.onToolCallComplete?.(record, attachments);
    },
  };
}

function summarizeMcpForLog(mcp: ChatSendMessage["mcp"]): Array<Record<string, unknown>> | undefined {
  if (!mcp?.servers?.length) {
    return undefined;
  }

  return mcp.servers.map((server) => ({
    id: server.id,
    name: server.name,
    endpointUrl: server.endpointUrl,
    enabled: server.enabled,
    lastRefreshError: server.lastRefreshError,
    tools: (server.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      disabledReason: tool.disabledReason,
    })),
  }));
}

function extractSystemPrompt(messages: ModelRequestMessage[]): string | undefined {
  const systemMessages = messages
    .filter((message): message is Extract<ModelRequestMessage, { role: "system"; content: string }> => message.role === "system" && typeof message.content === "string")
    .map((message) => message.content.trim())
    .filter(Boolean);
  if (systemMessages.length === 0) {
    return undefined;
  }
  return systemMessages.join("\n\n");
}

function summarizeAttachments(attachments: ChatToolAttachment[]): Array<Record<string, unknown>> {
  return attachments.map((attachment) => ({
    id: attachment.id,
    kind: attachment.kind,
    title: attachment.title,
    summary: attachment.summary,
    sourceToolCallId: attachment.sourceToolCallId,
    redacted: attachment.redacted,
    truncated: attachment.truncated,
  }));
}

function summarizeText(value: string | undefined, maxLength = 240): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}…`;
}

function createRequestId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
