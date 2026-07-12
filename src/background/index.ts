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
import { handleSyncAlarm, handleSyncBackupMessage, restoreSyncAlarmFromSettings, type SyncBackupMessage } from "./syncBackupHandler";
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

const DEBUG_PREFIX = "[提取规则 AI 生成诊断]";
const networkDevtoolsBridge = createNetworkDevtoolsBridge();
const CHAT_STREAM_KEEPALIVE_INTERVAL_MS = 20_000;
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
});

chrome.runtime.onStartup.addListener(() => {
  ensureOpenSidePanelContextMenu();
  runRestoreSyncAlarmFromSettings();
});

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

chrome.runtime.onMessage.addListener((message: RuntimeMessage | RuntimeAgentToolsPrefixMessage, sender, sendResponse) => {
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
    const tabId = resolveChatRuntimeTabId(message, sender);
    // 非流式 sendMessage 没有稳定端口可推送中间事件，Token 用量随最终响应一次性返回给调用方。
    void handleChatSendMessage(
      message,
      fetch,
      {},
      createBackgroundToolExecutor(message, fetch, { networkCompatibilityExecutor: createNetworkCompatibilityExecutor(tabId) }),
      { shouldExposeTool: shouldExposeToolWithNetworkCompatibility(tabId) },
    ).then(sendResponse);
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

  if (message.type === "sync.backupNow" || message.type === "sync.listRemoteBackups" || message.type === "sync.restoreNow" || message.type === "sync.configureAlarm") {
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
  // Grok MCP 等远程工具可能连续 60–180s 无 fetch 事件；MV3 service worker 空闲约 30s 会被挂起，
  // 导致 chat.stream 端口被动断开，侧栏误报“流式响应异常中断”。长连接期间做轻量保活。
  const keepAliveTimer = setInterval(() => {
    try {
      void chrome.runtime.getPlatformInfo(() => undefined);
    } catch {
      // ignore keep-alive failures; next tick retries while the port remains open.
    }
  }, CHAT_STREAM_KEEPALIVE_INTERVAL_MS);
  const postToPort = (message: unknown) => {
    if (!disconnected) {
      port.postMessage(message);
    }
  };
  const handlePortMessage = (message: ChatStreamStartMessage | ChatStreamFollowUpMessage) => {
    if (message.type === "chat.stream.followUp") {
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

    if (message.type !== "chat.stream.start") {
      return;
    }

    const tabId = resolveChatRuntimeTabId(message.payload, port.sender);
    const chatMessage = { ...message.payload, signal: controller.signal };
    void handleChatSendMessage(chatMessage, fetch, {
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
        postToPort({ type: "error", message: "模型请求失败，请稍后重试" });
      });
  };

  port.onMessage.addListener(handlePortMessage);
  port.onDisconnect.addListener(() => {
    disconnected = true;
    clearInterval(keepAliveTimer);
    controller.abort();
  });
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
