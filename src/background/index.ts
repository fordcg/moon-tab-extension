import "./imagefreeToolRuntime";
import { handleModelCatalogMessage, type ModelCatalogMessage } from "./modelCatalogMessageHandler";
import { handleAgentToolsMessage, type AgentToolsMessage, type AgentToolsRuntimeMessage } from "./agentToolsMessageHandler";
import {
  browserControlManager,
  handleBrowserControlMessage,
  handleBrowserControlTabRemoved,
  type BrowserControlMessage,
} from "./browserControlMessageHandler";
import { createBackgroundToolExecutor, shouldExposeTool, type BackgroundToolExecutorOptions } from "./backgroundToolRuntime";
import { handleSidePanelRuntimeMessage, initializeSidePanelController } from "./sidePanelController";
import { handleChatSendMessage, type ChatSendMessage } from "./modelRequestHandler";
import {
  handlePageContextListTabsMessage,
  handlePageContextMessage,
  type PageContextExtractMessage,
  type PageContextListTabsMessage,
} from "./pageContextMessageHandler";
import type { TabCaptureVisibleMessage } from "../shared/tabCapture";
import type { ChatImageAttachment, ChatMessage, ChatPromptInvocation, ChatToolAttachment, ChatToolCallRecord } from "../shared/types";
import {
  commitSyncRestore,
  handleSyncAlarm,
  handleSyncBackupMessage,
  prepareSyncRestore,
  restoreSyncAlarmFromSettings,
  type SyncBackupMessage,
  type SyncBackupResponse,
} from "./syncBackupHandler";
import type { PreparedSyncRestore } from "../shared/sync/backupService";
import { handleTabCaptureVisibleMessage } from "./tabCaptureMessageHandler";
import {
  handleCurrentTabUrlMessage,
  handleUrlPatternGenerationMessage,
  type CurrentTabUrlMessage,
  type UrlPatternGenerationMessage,
} from "./urlPatternGenerationMessageHandler";
import { handleMcpMessage, type McpMessage } from "./mcpMessageHandler";
import { getRegisteredModelTools } from "../shared/models/toolRegistry";
import type { SidePanelRuntimeMessage } from "../shared/sidePanelRuntime";
import { createNetworkDevtoolsBridge } from "./networkDevtoolsBridge";
import { BrowserNetworkToolExecutor } from "./browserControl/networkToolExecutor";
import { exportAllDataForSync, recoverInterruptedChatSessions, replaceAllDataFromSync } from "../shared/storage/repositories";
import { installModelProviderHeaderRules } from "./modelProviderRequestHeaders";

const DEBUG_PREFIX = "[提取规则 AI 生成诊断]";
const networkDevtoolsBridge = createNetworkDevtoolsBridge();
const CHAT_STREAM_KEEPALIVE_INTERVAL_MS = 20_000;
const CHAT_RESTORE_SETTLEMENT_TIMEOUT_MS = 15_000;
const CHAT_RESTORE_ABORT_REASON = "sync_restore";
const CHAT_USER_ABORT_REASON = "user_cancel";
const CHAT_RESTORE_ABORT_MESSAGE = "正在恢复备份，已停止旧的模型请求";
const activeChatStreamCounts = new Map<string, number>();
const activeDirectChatRequests = new Set<ActiveDirectChatRequest>();
const activeChatStreamRequests = new Set<ActiveChatStreamRequest>();
const deferredRestoreCanceledResponses = new Set<(response?: unknown) => void>();
let syncRestoreInProgress = false;
let syncRestoreOperationInProgress = false;
let restoreBarrierActivityRevision = 0;
const DEVTOOLS_LEGACY_NETWORK_TOOL_IDS = new Set([
  "network.list_requests",
  "network.get_request_details",
  "network.clear_requests",
  "network.compare_requests",
  "network.find_parameter_candidates",
  "network.extract_js_candidates",
]);
const NETWORK_DEVTOOLS_NOT_CONNECTED_RESPONSE = { ok: false, message: "未检测到当前标签页 DevTools Network 连接。" } as const;

chrome.runtime.onInstalled.addListener(() => {
  ensureOpenSidePanelContextMenu();
  runRestoreSyncAlarmFromSettings();
  void installModelProviderHeaderRules();
});

chrome.runtime.onStartup.addListener(() => {
  ensureOpenSidePanelContextMenu();
  runRestoreSyncAlarmFromSettings();
  void installModelProviderHeaderRules();
});

// Service worker 冷启动时也要安装，避免只依赖 onInstalled/onStartup 时会话规则丢失。
void installModelProviderHeaderRules();

initializeSidePanelController();

function ensureOpenSidePanelContextMenu(): void {
  const contextMenus = chrome.contextMenus;
  if (!contextMenus?.create) {
    return;
  }

  const createMenu = () => {
    try {
      contextMenus.create({
        id: "open-side-panel",
        title: "打开 AI 助手",
        contexts: ["page"],
      }, () => {
        // Ignore duplicate-id races during rapid service-worker restarts.
        void chrome.runtime.lastError;
      });
    } catch {
      // contextMenus may be unavailable in restricted runtimes.
    }
  };

  if (typeof contextMenus.removeAll === "function") {
    try {
      contextMenus.removeAll(() => {
        void chrome.runtime.lastError;
        createMenu();
      });
      return;
    } catch {
      // Fall through to create-only path.
    }
  }

  createMenu();
}

function runRestoreSyncAlarmFromSettings(): void {
  void restoreSyncAlarmFromSettings().catch((error) => {
    console.error("自动同步定时任务恢复失败", error);
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  handleBrowserControlTabRemoved(tabId);
});

type RuntimeMessage =
  | ModelCatalogMessage
  | AgentToolsMessage
  | PageContextExtractMessage
  | PageContextListTabsMessage
  | UrlPatternGenerationMessage
  | CurrentTabUrlMessage
  | ChatSendMessage
  | TabCaptureVisibleMessage
  | SyncBackupMessage
  | BrowserControlMessage
  | McpMessage
  | SidePanelRuntimeMessage
  | { type: "chat.getActiveStreamSessions" }
  | { type: "sync.restoreStarted" | "sync.restoreCommitted" | "sync.restoreRolledBack" | "sync.restoreFailed" }
  | { type: `networkContext.${string}`; tabId?: number; requestIds?: string[] };

type NetworkContextRuntimeMessage = Extract<RuntimeMessage, { type: `networkContext.${string}` }>;
type RuntimeAgentToolsPrefixMessage = Extract<AgentToolsRuntimeMessage, { type: `agentTools.${string}` }>;

interface ChatStreamStartMessage {
  type: "chat.stream.start";
  payload: ChatSendMessage;
}

interface ChatStreamFollowUpMessage {
  type: "chat.stream.followUp";
  payload: {
    followUpId?: string;
    content: string;
    attachments?: ChatImageAttachment[];
    promptInvocations?: ChatPromptInvocation[];
    userMessageId?: string;
  };
}

interface ChatStreamCancelMessage {
  type: "chat.stream.cancel";
}

interface ActiveDirectChatRequest {
  controller: AbortController;
  settled: Promise<void>;
}

interface ActiveChatStreamRequest {
  controller: AbortController;
  settled: Promise<void>;
  execution?: Promise<void>;
  abortForRestore: () => void;
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage | RuntimeAgentToolsPrefixMessage, sender, sendResponse) => {
  if (message.type === "chat.getActiveStreamSessions") {
    sendResponse({ ok: true, sessionIds: Array.from(activeChatStreamCounts.keys()) });
    return false;
  }

  if (isNetworkContextMessage(message)) {
    const scopedMessage = resolveDirectNetworkContextMessage(message, sender);
    if (!scopedMessage) {
      sendResponse(NETWORK_DEVTOOLS_NOT_CONNECTED_RESPONSE);
      return true;
    }
    void networkDevtoolsBridge.handleMessage(scopedMessage).then(sendResponse);
    return true;
  }

  const sidePanelResponse = handleSidePanelRuntimeMessage(message as SidePanelRuntimeMessage);
  if (sidePanelResponse) {
    void sidePanelResponse.then(sendResponse);
    return true;
  }

  if (message.type === "extractionRule.generateUrlPatterns") {
    console.debug(`${DEBUG_PREFIX} background 入口收到 runtime 消息`, {
      type: message.type,
      debugRequestId: message.debugRequestId,
      providerId: message.provider?.id,
      modelId: message.model?.id,
      url: message.url,
    });
  }

  if (message.type === "extractionRule.generateUrlPatterns") {
    void handleUrlPatternGenerationMessage(message)
      .then((response) => {
        console.debug(`${DEBUG_PREFIX} background 入口发送 runtime 响应`, {
          debugRequestId: message.debugRequestId,
          response,
        });
        sendResponse(response);
      })
      .catch((error) => {
        console.error(`${DEBUG_PREFIX} background 入口处理生成消息异常`, {
          debugRequestId: message.debugRequestId,
          error,
        });
        sendResponse({
          ok: false,
          message: error instanceof Error ? `AI 生成失败：${error.message}` : "AI 生成失败",
        });
      });
    return true;
  }

  if (message.type === "extractionRule.getCurrentTabUrl") {
    console.debug(`${DEBUG_PREFIX} background 入口收到当前标签页 URL 请求`, {
      debugRequestId: message.debugRequestId,
    });
    void handleCurrentTabUrlMessage(message)
      .then((response) => {
        console.debug(`${DEBUG_PREFIX} background 入口返回当前标签页 URL`, {
          debugRequestId: message.debugRequestId,
          response,
        });
        sendResponse(response);
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          message: error instanceof Error ? error.message : "未找到当前活动页面 URL",
        });
      });
    return true;
  }

  if (message.type === "pageContext.extract") {
    void handlePageContextMessage(message).then(sendResponse);
    return true;
  }

  if (message.type === "pageContext.listTabs") {
    void handlePageContextListTabsMessage().then(sendResponse);
    return true;
  }

  if (message.type === "chat.send") {
    handleDirectChatRequest(message, sender, sendResponse);
    return true;
  }

  if (message.type === "tab.captureVisible") {
    void handleTabCaptureVisibleMessage().then(sendResponse);
    return true;
  }

  if (message.type === "browserControl.setEnabled" ||
    message.type === "browserControl.getDiagnostics" ||
    message.type === "browserControl.setRuntimeReadonly" ||
    message.type === "browserControl.setAutomationMode" ||
    message.type === "browserControl.boundaryChoiceRespond") {
    void handleBrowserControlMessage(message, sender).then(sendResponse);
    return true;
  }

  if (message.type === "sync.restoreNow") {
    void handleSyncRestoreWithRequestBarrier(message).then(sendResponse);
    return true;
  }

  if (message.type === "sync.backupNow" || message.type === "sync.listRemoteBackups" || message.type === "sync.configureAlarm") {
    void handleSyncBackupMessage(message).then(sendResponse);
    return true;
  }

  if (message.type === "mcp.listTools") {
    void handleMcpMessage(message).then(sendResponse);
    return true;
  }

  if (isAgentToolsMessage(message)) {
    const builtInTools = getRegisteredModelTools().filter(shouldExposeToolWithNetworkCompatibility(getSenderTabId(sender)));
    void handleAgentToolsMessage(message, fetch, builtInTools, browserControlManager.getDiagnostics()).then(sendResponse);
    return true;
  }

  if (message.type !== "modelCatalog.list" && message.type !== "modelCatalog.test") {
    return false;
  }

  void handleModelCatalogMessage(message).then(sendResponse);
  return true;
});

function isAgentToolsMessage(message: RuntimeMessage | RuntimeAgentToolsPrefixMessage): message is AgentToolsRuntimeMessage {
  return typeof message.type === "string" && message.type.startsWith("agentTools.");
}

function isNetworkContextMessage(message: RuntimeMessage | RuntimeAgentToolsPrefixMessage): message is NetworkContextRuntimeMessage {
  return typeof message.type === "string" && message.type.startsWith("networkContext.");
}

function handleDirectChatRequest(
  message: ChatSendMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
): void {
  if (syncRestoreInProgress) {
    restoreBarrierActivityRevision += 1;
    deferredRestoreCanceledResponses.add(sendResponse);
    return;
  }

  const controller = new AbortController();
  const tabId = resolveChatRuntimeTabId(message, sender);
  const chatMessage = { ...message, signal: controller.signal };
  const execution = handleChatSendMessage(
    chatMessage,
    fetch,
    {},
    createBackgroundToolExecutor(message, fetch, { networkCompatibilityExecutor: createNetworkCompatibilityExecutor(tabId) }),
    { shouldExposeTool: shouldExposeToolWithNetworkCompatibility(tabId) },
  )
    .then((response) => {
      sendRuntimeResponseSafely(
        sendResponse,
        isRestoreAbort(controller.signal) ? createRestoreCanceledChatResponse() : response,
      );
    })
    .catch(() => {
      sendRuntimeResponseSafely(
        sendResponse,
        isRestoreAbort(controller.signal)
          ? createRestoreCanceledChatResponse()
          : { ok: false, message: "模型请求失败，请稍后重试" },
      );
    });
  const request: ActiveDirectChatRequest = {
    controller,
    settled: execution.then(() => undefined),
  };
  activeDirectChatRequests.add(request);
  void request.settled.finally(() => activeDirectChatRequests.delete(request));
}

function sendRuntimeResponseSafely(sendResponse: (response?: unknown) => void, response: unknown): void {
  try {
    sendResponse(response);
  } catch {
    // 请求页面可能在模型响应完成前关闭。
  }
}

async function handleSyncRestoreWithRequestBarrier(message: Extract<SyncBackupMessage, { type: "sync.restoreNow" }>): Promise<SyncBackupResponse> {
  if (syncRestoreOperationInProgress) {
    return { ok: false, message: "已有备份恢复正在进行" };
  }

  syncRestoreOperationInProgress = true;
  let prepared: PreparedSyncRestore;
  try {
    prepared = await prepareSyncRestore(message);
  } catch (error) {
    syncRestoreOperationInProgress = false;
    return {
      ok: false,
      message: error instanceof Error ? error.message : "同步操作失败，请重试",
    };
  }

  syncRestoreInProgress = true;
  restoreBarrierActivityRevision = 0;
  await broadcastSyncRestoreEvent("sync.restoreStarted");
  let rollbackSnapshot: Awaited<ReturnType<typeof exportAllDataForSync>> | undefined;
  try {
    const deadline = Date.now() + CHAT_RESTORE_SETTLEMENT_TIMEOUT_MS;
    await abortAndWaitForAllChatRequests(deadline);
    rollbackSnapshot = await exportAllDataForSync();
    await commitSyncRestoreBehindBarrier(prepared, deadline);
    flushDeferredRestoreCanceledResponses();
    await broadcastSyncRestoreEvent("sync.restoreCommitted");
    return { ok: true, message: "恢复完成" };
  } catch (error) {
    let rollbackSucceeded = true;
    if (rollbackSnapshot) {
      try {
        await replaceAllDataFromSync(rollbackSnapshot);
      } catch {
        rollbackSucceeded = false;
      }
    }
    await recoverAfterFailedRestore();
    flushDeferredRestoreCanceledResponses();
    await broadcastSyncRestoreEvent(rollbackSucceeded ? "sync.restoreRolledBack" : "sync.restoreFailed");
    return {
      ok: false,
      message: rollbackSucceeded
        ? error instanceof Error ? error.message : "等待旧模型请求结束失败，未恢复备份"
        : "恢复失败且无法还原原有数据，请重新打开侧栏检查本地数据",
    };
  } finally {
    syncRestoreInProgress = false;
    syncRestoreOperationInProgress = false;
    flushDeferredRestoreCanceledResponses();
  }
}

async function commitSyncRestoreBehindBarrier(prepared: PreparedSyncRestore, deadline: number): Promise<void> {
  while (true) {
    if (Date.now() >= deadline) {
      throw new Error("等待恢复静默窗口超时，未恢复备份");
    }
    await abortAndWaitForAllChatRequests(deadline);
    const revisionBeforeCommit = restoreBarrierActivityRevision;
    await commitSyncRestore(prepared);
    await yieldBackgroundTask();
    await abortAndWaitForAllChatRequests(deadline);
    await yieldBackgroundTask();
    if (restoreBarrierActivityRevision === revisionBeforeCommit) {
      return;
    }
  }
}

async function recoverAfterFailedRestore(): Promise<void> {
  await recoverInterruptedChatSessions([], Date.now()).catch(() => undefined);
}

function flushDeferredRestoreCanceledResponses(): void {
  for (const sendResponse of deferredRestoreCanceledResponses) {
    try {
      sendResponse(createRestoreCanceledChatResponse());
    } catch {
      // 请求页面可能已经关闭。
    }
  }
  deferredRestoreCanceledResponses.clear();
}

function yieldBackgroundTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function broadcastSyncRestoreEvent(type: "sync.restoreStarted" | "sync.restoreCommitted" | "sync.restoreRolledBack" | "sync.restoreFailed"): Promise<void> {
  const runtime = chrome.runtime as typeof chrome.runtime & {
    sendMessage?: (message: unknown) => Promise<unknown> | void;
  };
  try {
    await runtime.sendMessage?.({ type });
  } catch {
    // 没有其他扩展页面监听时无需阻断恢复结果。
  }
}

async function abortAndWaitForAllChatRequests(deadline: number): Promise<void> {
  while (activeDirectChatRequests.size > 0 || activeChatStreamRequests.size > 0) {
    const directRequests = Array.from(activeDirectChatRequests);
    const streamRequests = Array.from(activeChatStreamRequests);
    directRequests.forEach((request) => request.controller.abort(CHAT_RESTORE_ABORT_REASON));
    streamRequests.forEach((request) => request.abortForRestore());
    const settlements = [
      ...directRequests.map((request) => request.settled),
      ...streamRequests.map((request) => Promise.all([request.settled, request.execution ?? Promise.resolve()])),
    ];
    await waitForChatRequestSettlementBatch(settlements, deadline);
    await Promise.resolve();
  }
}

async function waitForChatRequestSettlementBatch(settlements: Promise<unknown>[], deadline: number): Promise<void> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    throw new Error("等待旧模型请求结束超时，未恢复备份");
  }
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error("等待旧模型请求结束超时，未恢复备份")), remainingMs);
  });
  try {
    await Promise.race([Promise.all(settlements), timeout]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

function createRestoreCanceledChatResponse() {
  return {
    ok: false as const,
    message: CHAT_RESTORE_ABORT_MESSAGE,
    restoreCanceled: true as const,
  };
}

function isRestoreAbort(signal: AbortSignal): boolean {
  return signal.aborted && signal.reason === CHAT_RESTORE_ABORT_REASON;
}

function isUserAbort(signal: AbortSignal): boolean {
  return signal.aborted && signal.reason === CHAT_USER_ABORT_REASON;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  void handleSyncAlarm(alarm);
});

chrome.runtime.onConnect.addListener((port) => {
  if (networkDevtoolsBridge.handlePortConnect(port)) {
    return;
  }

  if (port.name !== "chat.stream") {
    return;
  }

  const controller = new AbortController();
  const guidanceQueue: Array<{
    id: string;
    content: string;
    attachments?: ChatImageAttachment[];
    promptInvocations?: ChatPromptInvocation[];
    userMessageId?: string;
  }> = [];
  let disconnected = false;
  let streamStarted = false;
  let activeSessionId: string | undefined;
  // Grok MCP 等远程工具可能连续 60–180s 无 fetch 事件；MV3 service worker 空闲约 30s 会被挂起，
  // 导致 chat.stream 端口被动断开，侧栏误报“流式响应异常中断”。长连接期间做轻量保活。
  const keepAliveTimer = setInterval(() => {
    try {
      void chrome.runtime.getPlatformInfo(() => undefined);
    } catch {
      // ignore keep-alive failures; next tick retries while the port remains open.
    }
  }, CHAT_STREAM_KEEPALIVE_INTERVAL_MS);
  let restoreAbortPosted = false;
  let streamExecutionSettled = false;
  let settleStreamRequest!: () => void;
  const streamSettled = new Promise<void>((resolve) => {
    settleStreamRequest = resolve;
  });
  const streamRequest: ActiveChatStreamRequest = {
    controller,
    settled: streamSettled,
    abortForRestore: () => {
      if (!controller.signal.aborted) {
        controller.abort(CHAT_RESTORE_ABORT_REASON);
      }
      if (!restoreAbortPosted) {
        restoreAbortPosted = postToPort({ type: "restore:abort", message: CHAT_RESTORE_ABORT_MESSAGE });
      }
    },
  };
  function cleanUpDisconnectedStream(): void {
    if (disconnected) {
      return;
    }
    disconnected = true;
    clearInterval(keepAliveTimer);
    // Do NOT abort the in-flight model/tool loop on port disconnect.
    // Side panel reloads, focus changes, or transient port drops would otherwise kill
    // a request that already received tool calls and leave the UI as a false "stream interrupt".
    // Explicit user cancel / sync restore still abort via dedicated reasons.
    if (!streamRequest.execution || streamExecutionSettled) {
      activeChatStreamRequests.delete(streamRequest);
    }
    settleStreamRequest();
    if (activeSessionId) {
      const remaining = (activeChatStreamCounts.get(activeSessionId) ?? 1) - 1;
      if (remaining > 0) {
        activeChatStreamCounts.set(activeSessionId, remaining);
      } else {
        activeChatStreamCounts.delete(activeSessionId);
      }
      activeSessionId = undefined;
    }
  }
  function postToPort(message: unknown): boolean {
    if (disconnected) {
      return false;
    }
    try {
      port.postMessage(message);
      // Mirror tool progress to all extension pages (control window / other side panels).
      void broadcastAutomationLiveEvent(message);
      return true;
    } catch {
      try {
        port.disconnect();
      } catch {
        // 端口已经失效时仍需在本上下文完成清理。
      } finally {
        cleanUpDisconnectedStream();
      }
      return false;
    }
  }
  activeChatStreamRequests.add(streamRequest);
  if (syncRestoreInProgress) {
    restoreBarrierActivityRevision += 1;
    streamRequest.abortForRestore();
  }
  const handlePortMessage = (message: ChatStreamStartMessage | ChatStreamFollowUpMessage | ChatStreamCancelMessage) => {
    if (message.type === "chat.stream.followUp") {
      if (syncRestoreInProgress) {
        streamRequest.abortForRestore();
        return;
      }
      const content = typeof message.payload?.content === "string" ? message.payload.content.trim() : "";
      const id = typeof message.payload?.followUpId === "string" ? message.payload.followUpId : "";
      const attachments = Array.isArray(message.payload?.attachments) ? message.payload.attachments : undefined;
      const promptInvocations = Array.isArray(message.payload?.promptInvocations) ? message.payload.promptInvocations : undefined;
      if (id && (content || attachments?.length || promptInvocations?.length)) {
        guidanceQueue.push({
          id,
          content,
          attachments,
          promptInvocations,
          userMessageId: typeof message.payload?.userMessageId === "string" ? message.payload.userMessageId : undefined,
        });
      }
      return;
    }

    if (message.type === "chat.stream.cancel") {
      if (!controller.signal.aborted) {
        controller.abort(CHAT_USER_ABORT_REASON);
      }
      return;
    }

    if (message.type !== "chat.stream.start") {
      return;
    }
    if (streamStarted) {
      postToPort({ type: "error", message: "同一流式连接不能重复启动请求" });
      return;
    }
    streamStarted = true;
    if (syncRestoreInProgress) {
      restoreBarrierActivityRevision += 1;
      streamRequest.abortForRestore();
      return;
    }

    const sessionId = message.payload.debugContext?.sessionId;
    if (!activeSessionId && sessionId) {
      activeSessionId = sessionId;
      activeChatStreamCounts.set(sessionId, (activeChatStreamCounts.get(sessionId) ?? 0) + 1);
    }

    const tabId = resolveChatRuntimeTabId(message.payload, port.sender);
    const chatMessage = { ...message.payload, signal: controller.signal };
    const execution = handleChatSendMessage(chatMessage, fetch, {
      onContentChunk: (content) => postToPort({ type: "chunk", content }),
      onThinkingChunk: (content) => postToPort({ type: "thinking", content }),
      onRetryProgress: (progress) => postToPort({ type: "retry:progress", ...progress }),
      onFinalResponseStart: () => postToPort({ type: "assistant:final-start" }),
      onTokenUsageEntries: (tokenUsageEntries) => postToPort({ type: "token_usage", tokenUsageEntries }),
      onToolTurnMessage: (assistantMessage: ChatMessage) => postToPort({ type: "assistant:tool-turn", message: assistantMessage }),
      onToolCallStart: (record: ChatToolCallRecord) => postToPort({ type: "tool:start", record }),
      onToolCallComplete: (record: ChatToolCallRecord, attachments: ChatToolAttachment[]) => postToPort({ type: "tool:complete", record, attachments }),
      consumeGuidance: () => guidanceQueue.splice(0),
      onGuidanceConsumed: (followUpId: string) => postToPort({ type: "follow-up:consumed", followUpId }),
    }, createBackgroundToolExecutor(chatMessage, fetch, { networkCompatibilityExecutor: createNetworkCompatibilityExecutor(tabId) }), { shouldExposeTool: shouldExposeToolWithNetworkCompatibility(tabId) })
      .then((response) => {
        if (isRestoreAbort(controller.signal)) {
          streamRequest.abortForRestore();
          return;
        }
        if (isUserAbort(controller.signal)) {
          postToPort({ type: "canceled" });
          return;
        }
        if (disconnected) {
          return;
        }
        if (response.ok) {
          postToPort({
            type: "complete",
            content: response.content,
            thinking: response.thinking,
            reasoningContent: response.reasoningContent,
            toolCallRecords: response.toolCallRecords,
            toolAttachments: response.toolAttachments,
            tokenUsageEntries: response.tokenUsageEntries,
          });
          return;
        }

        postToPort({ type: "error", message: response.message });
      })
      .catch(() => {
        if (isRestoreAbort(controller.signal)) {
          streamRequest.abortForRestore();
          return;
        }
        if (isUserAbort(controller.signal)) {
          postToPort({ type: "canceled" });
          return;
        }
        postToPort({ type: "error", message: "模型请求失败，请稍后重试" });
      });
    streamRequest.execution = execution.then(() => undefined);
    void streamRequest.execution.finally(() => {
      streamExecutionSettled = true;
      if (disconnected) {
        activeChatStreamRequests.delete(streamRequest);
      }
    });
  };

  port.onMessage.addListener(handlePortMessage);
  port.onDisconnect.addListener(cleanUpDisconnectedStream);
});

export {};

function getSenderTabId(sender?: chrome.runtime.MessageSender): number | undefined {
  const tabId = sender?.tab?.id;
  return typeof tabId === "number" && Number.isInteger(tabId) ? tabId : undefined;
}

function getMessageTabId(message: { tabId?: number }): number | undefined {
  return typeof message.tabId === "number" && Number.isInteger(message.tabId) ? message.tabId : undefined;
}

function resolveChatRuntimeTabId(message: { tabId?: number }, sender?: chrome.runtime.MessageSender): number | undefined {
  const senderTabId = getSenderTabId(sender);
  if (senderTabId !== undefined) {
    return senderTabId;
  }
  const requestedTabId = getMessageTabId(message);
  return requestedTabId !== undefined && isSameExtensionPageSender(sender) ? requestedTabId : undefined;
}

function resolveDirectNetworkContextMessage(
  message: NetworkContextRuntimeMessage,
  sender?: chrome.runtime.MessageSender,
): NetworkContextRuntimeMessage | undefined {
  const senderTabId = getSenderTabId(sender);
  const requestedTabId = getMessageTabId(message);
  if (requestedTabId !== undefined) {
    if (senderTabId !== undefined) {
      return senderTabId === requestedTabId ? message : undefined;
    }
    return isTrustedNetworkContextExtensionSender(sender) ? message : undefined;
  }
  if (senderTabId === undefined) {
    return undefined;
  }
  return { ...message, tabId: senderTabId };
}

function isSameExtensionPageSender(sender?: chrome.runtime.MessageSender): boolean {
  const senderUrl = typeof sender?.url === "string" ? sender.url : undefined;
  if (!senderUrl) {
    return false;
  }
  const extensionRoot = chrome.runtime?.getURL?.("");
  if (!extensionRoot) {
    return false;
  }
  try {
    return isSameUrlAuthority(new URL(senderUrl), new URL(extensionRoot));
  } catch {
    return false;
  }
}

function isTrustedNetworkContextExtensionSender(sender?: chrome.runtime.MessageSender): boolean {
  const senderUrl = typeof sender?.url === "string" ? sender.url : undefined;
  if (!senderUrl) {
    return false;
  }
  const devtoolsUrl = chrome.runtime?.getURL?.("src/devtools/network.html");
  if (!devtoolsUrl) {
    return false;
  }
  try {
    const senderParsed = new URL(senderUrl);
    const devtoolsParsed = new URL(devtoolsUrl);
    return isSameUrlAuthority(senderParsed, devtoolsParsed) && senderParsed.pathname === devtoolsParsed.pathname;
  } catch {
    return false;
  }
}

function isSameUrlAuthority(left: URL, right: URL): boolean {
  return left.protocol === right.protocol && left.host === right.host;
}

function createNetworkCompatibilityExecutor(tabId?: number): BackgroundToolExecutorOptions["networkCompatibilityExecutor"] {
  if (tabId === undefined) {
    return undefined;
  }
  const networkCompatibilityRecorder = networkDevtoolsBridge.createRecorderAdapter(tabId);
  const executor = new BrowserNetworkToolExecutor(networkCompatibilityRecorder);
  return async (toolCall, tool) => {
    if (!networkCompatibilityRecorder.isEnabled() || !DEVTOOLS_LEGACY_NETWORK_TOOL_IDS.has(tool.id)) {
      return undefined;
    }
    return executor.execute(toolCall);
  };
}

function shouldExposeToolWithNetworkCompatibility(tabId?: number): (tool: ReturnType<typeof getRegisteredModelTools>[number]) => boolean {
  const networkCompatibilityRecorder = tabId === undefined ? undefined : networkDevtoolsBridge.createRecorderAdapter(tabId);
  return (tool) => {
    if (shouldExposeTool(tool)) {
      return true;
    }
    return DEVTOOLS_LEGACY_NETWORK_TOOL_IDS.has(tool.id) && networkCompatibilityRecorder?.isEnabled() === true;
  };
}
