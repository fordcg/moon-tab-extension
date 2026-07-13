import { useEffect, useRef, useState } from "react";
import { ChatPanel } from "./components/ChatPanel";
import { NotificationHost } from "./components/NotificationHost";
import type { SettingsTab } from "./components/SettingsPanel";
import { SessionList } from "./components/SessionList";
import { useAppStore } from "./state/appStore";
import { sendRuntimeMessage } from "./state/runtimeMessage";
import {
  BROWSER_CONTROL_AUTOMATION_MODE_CHANGED_MESSAGE_TYPE,
  BROWSER_CONTROL_BOUNDARY_CHOICE_REQUEST_MESSAGE_TYPE,
  BROWSER_CONTROL_DETACHED_MESSAGE_TYPE,
  type BrowserControlAutomationModeChangedMessage,
  type BrowserControlBoundaryChoiceRequestMessage,
  type BrowserControlRuntimeEvent,
} from "../shared/browserControl";
import { SIDE_PANEL_FLOATING_CLOSE_TYPE, SIDE_PANEL_OPEN_FLOATING_TYPE } from "../shared/sidePanelRuntime";

interface SidePanelActionResponse {
  ok: boolean;
  message?: string;
}

type SidePanelDrawerPage = "history" | "settings";
type SidePanelDrawerOrigin = "header" | "history";

export function App() {
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>("channels");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerPage, setDrawerPage] = useState<SidePanelDrawerPage>("history");
  const [drawerOrigin, setDrawerOrigin] = useState<SidePanelDrawerOrigin>("header");
  const drawerRestoreFocusRef = useRef<HTMLElement | null>(null);
  const searchParams = new URLSearchParams(window.location.search);
  const floatingMode = searchParams.get("floating") === "1";
  const floatingTabId = resolveFloatingTabId(searchParams.get("tabId"));
  const historyPanelDefaultOpen = useAppStore((state) => state.chatPreferences.historyDrawerDefaultOpen);
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const historyPanelUserToggled = useRef(false);
  const loadChannelConfig = useAppStore((state) => state.loadChannelConfig);
  const loadExtractionRules = useAppStore((state) => state.loadExtractionRules);
  const loadPromptTemplates = useAppStore((state) => state.loadPromptTemplates);
  const loadChatData = useAppStore((state) => state.loadChatData);
  const loadSyncSettings = useAppStore((state) => state.loadSyncSettings);
  const refreshPageContext = useAppStore((state) => state.refreshPageContext);
  const createChatSession = useAppStore((state) => state.createChatSession);
  const composerHasDraft = useAppStore((state) => state.composerHasDraft);
  const markBrowserControlDetached = useAppStore((state) => state.markBrowserControlDetached);
  const markBrowserAutomationModeChanged = useAppStore((state) => state.markBrowserAutomationModeChanged);
  const showBoundaryChoiceRequest = useAppStore((state) => state.showBoundaryChoiceRequest);
  const addNotification = useAppStore((state) => state.addNotification);

  const handleFloatingAssistantAction = async () => {
    if (floatingMode) {
      if (typeof floatingTabId !== "number") {
        addNotification({ type: "error", title: "关闭悬浮助手失败", message: "缺少有效的标签页 ID，无法关闭悬浮助手" });
        return;
      }

      const response = await sendTabMessage<SidePanelActionResponse | undefined>(floatingTabId, { type: SIDE_PANEL_FLOATING_CLOSE_TYPE });
      if (response?.ok === false) {
        addNotification({ type: "error", title: "关闭悬浮助手失败", message: response.message ?? "关闭悬浮助手失败" });
        return;
      }

      addNotification({ type: "success", title: "悬浮助手已关闭", message: response?.message ?? "悬浮助手已关闭" });
      return;
    }

    const response = await sendRuntimeMessage<SidePanelActionResponse | undefined>({ type: SIDE_PANEL_OPEN_FLOATING_TYPE });
    if (response?.ok === false) {
      addNotification({ type: "error", title: "打开悬浮助手失败", message: response.message ?? "打开悬浮助手失败" });
      return;
    }

    addNotification({ type: "success", title: "悬浮助手已打开", message: response?.message ?? "悬浮助手已打开" });
  };

  const handleToggleHistoryPanel = () => {
    historyPanelUserToggled.current = true;
    setHistoryPanelOpen((value) => !value);
  };

  const rememberDrawerTrigger = () => {
    if (!drawerOpen && document.activeElement instanceof HTMLElement) {
      drawerRestoreFocusRef.current = document.activeElement;
    }
  };

  const openHistoryDrawer = () => {
    rememberDrawerTrigger();
    setDrawerOrigin("history");
    setDrawerPage("history");
    setDrawerOpen(true);
  };

  const openSettings = (tab: SettingsTab = "channels", origin: SidePanelDrawerOrigin = drawerOpen ? "history" : "header") => {
    rememberDrawerTrigger();
    setSettingsInitialTab(tab);
    setDrawerOrigin(origin);
    setDrawerPage("settings");
    setDrawerOpen(true);
  };

  const closeDrawer = () => setDrawerOpen(false);

  const returnSettingsToHistory = () => {
    setDrawerOrigin("history");
    setDrawerPage("history");
  };

  const handleDrawerOpenChange = (open: boolean) => setDrawerOpen(open);

  const restoreDrawerFocus = () => {
    const target = drawerRestoreFocusRef.current;
    if (!target?.isConnected) {
      return;
    }

    window.requestAnimationFrame(() => target.focus());
  };

  useEffect(() => {
    void Promise.all([loadChannelConfig(), loadExtractionRules(), loadPromptTemplates(), loadChatData(), loadSyncSettings()]).then(() => refreshPageContext());
  }, [loadChannelConfig, loadExtractionRules, loadPromptTemplates, loadChatData, loadSyncSettings, refreshPageContext]);

  useEffect(() => {
    if (!historyPanelDefaultOpen && !historyPanelUserToggled.current) {
      setHistoryPanelOpen(false);
    }
  }, [historyPanelDefaultOpen]);

  useEffect(() => {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.onMessage?.addListener) {
      return;
    }

    const handleRuntimeMessage = (message: unknown) => {
      if (isBrowserControlDetachedEvent(message)) {
        markBrowserControlDetached();
        return;
      }

      if (isAutomationModeChangedEvent(message)) {
        markBrowserAutomationModeChanged(message.mode);
        return;
      }

      if (isBoundaryChoiceRequestEvent(message)) {
        showBoundaryChoiceRequest(message);
      }
    };

    runtime.onMessage.addListener(handleRuntimeMessage);
    return () => {
      runtime.onMessage.removeListener?.(handleRuntimeMessage);
    };
  }, [markBrowserAutomationModeChanged, markBrowserControlDetached, showBoundaryChoiceRequest]);

  const chatMainLayoutClassName = [
    "chat-main-layout",
    historyPanelOpen ? "" : "chat-main-layout-history-collapsed",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className="app-shell sidebar-shell">
      <section className="app-header sidebar-topbar" aria-label="侧栏操作">
        <h1 className="app-title sidebar-topbar-title">月标签 AI 助手</h1>
        <div className="app-header-actions">
          <button
            className="ui-button-secondary app-header-icon-button"
            type="button"
            aria-label="新建对话"
            title="新建对话"
            onClick={() => void createChatSession({ preserveSelectedModel: composerHasDraft })}
          >
            <svg className="app-header-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>
          <button
            className="ui-button-secondary app-header-icon-button"
            type="button"
            aria-label={floatingMode ? "关闭悬浮助手" : "打开悬浮助手"}
            title={floatingMode ? "关闭悬浮助手" : "打开悬浮助手"}
            onClick={() => void handleFloatingAssistantAction()}
          >
            <svg className="app-header-icon" viewBox="0 0 24 24" aria-hidden="true">
              {floatingMode ? (
                <>
                  <rect x="4.5" y="4.5" width="15" height="15" rx="2.2" />
                  <path d="M9 9l6 6" />
                  <path d="M15 9l-6 6" />
                </>
              ) : (
                <>
                  <path d="M14 4h6v6" />
                  <path d="M20 4 12 12" />
                  <rect x="4" y="8" width="10" height="12" rx="1.8" />
                </>
              )}
            </svg>
          </button>
          <button
            className="ui-button-secondary app-header-icon-button"
            type="button"
            aria-label="设置"
            title="设置"
            onClick={() => (drawerOpen && drawerPage === "settings" ? closeDrawer() : openSettings("channels"))}
          >
            <svg className="app-header-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
            </svg>
          </button>
        </div>
      </section>
      <section className={chatMainLayoutClassName}>
        {historyPanelOpen ? <SessionList /> : <div aria-hidden="true" className="session-list-placeholder" />}
        <ChatPanel
          drawerOpen={drawerOpen}
          drawerPage={drawerPage}
          drawerOrigin={drawerOrigin}
          settingsInitialTab={settingsInitialTab}
          historyPanelOpen={historyPanelOpen}
          onDrawerOpenChange={handleDrawerOpenChange}
          onRestoreDrawerFocus={restoreDrawerFocus}
          onOpenHistoryDrawer={openHistoryDrawer}
          onOpenSettings={openSettings}
          onReturnSettingsToHistory={returnSettingsToHistory}
          onToggleHistoryPanel={handleToggleHistoryPanel}
        />
      </section>
      {!drawerOpen ? <NotificationHost /> : null}
    </main>
  );
}

function resolveFloatingTabId(tabId: string | null): number | undefined {
  if (!tabId) {
    return undefined;
  }

  const value = Number(tabId);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

async function sendTabMessage<T>(tabId: number, message: unknown): Promise<T> {
  const tabs = globalThis.chrome?.tabs;
  if (!tabs?.sendMessage) {
    return {
      ok: false,
      message: "当前环境不支持标签页消息请求",
    } as T;
  }

  return new Promise<T>((resolve) => {
    let settled = false;
    const finish = (response: T) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(response);
    };

    try {
      const maybePromise = tabs.sendMessage(tabId, message, (response: T) => {
        const runtimeError = globalThis.chrome?.runtime?.lastError?.message;
        if (runtimeError) {
          finish({
            ok: false,
            message: runtimeError,
          } as T);
          return;
        }

        finish(response);
      }) as Promise<T> | undefined;

      if (maybePromise && typeof maybePromise.then === "function") {
        void maybePromise.then(finish).catch((error) => {
          finish({
            ok: false,
            message: error instanceof Error ? error.message : "标签页消息请求失败",
          } as T);
        });
      }
    } catch (error) {
      finish({
        ok: false,
        message: error instanceof Error ? error.message : "标签页消息请求失败",
      } as T);
    }
  });
}

function isBrowserControlDetachedEvent(message: unknown): message is BrowserControlRuntimeEvent {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const event = message as { type?: unknown; tabId?: unknown; reason?: unknown };
  return event.type === BROWSER_CONTROL_DETACHED_MESSAGE_TYPE &&
    (typeof event.tabId === "undefined" || typeof event.tabId === "number") &&
    (
      event.reason === "canceled_by_user" ||
      event.reason === "target_closed" ||
      event.reason === "tab_removed" ||
      event.reason === "disabled_by_user" ||
      event.reason === "unknown"
    );
}

function isAutomationModeChangedEvent(message: unknown): message is BrowserControlAutomationModeChangedMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const event = message as { type?: unknown; mode?: unknown; tabId?: unknown; expiresAt?: unknown };
  return event.type === BROWSER_CONTROL_AUTOMATION_MODE_CHANGED_MESSAGE_TYPE &&
    (event.mode === "normal_restricted" || event.mode === "controlled_enhanced" || event.mode === "full_access") &&
    (typeof event.tabId === "undefined" || typeof event.tabId === "number") &&
    (typeof event.expiresAt === "undefined" || typeof event.expiresAt === "number");
}

function isBoundaryChoiceRequestEvent(message: unknown): message is BrowserControlBoundaryChoiceRequestMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  const event = message as { type?: unknown; requestId?: unknown; question?: unknown; choices?: unknown; expiresAt?: unknown };
  return event.type === BROWSER_CONTROL_BOUNDARY_CHOICE_REQUEST_MESSAGE_TYPE &&
    typeof event.requestId === "string" &&
    typeof event.question === "string" &&
    Array.isArray(event.choices) &&
    typeof event.expiresAt === "number";
}
