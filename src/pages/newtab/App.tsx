import { useCallback, useEffect, useMemo, useState } from "react";
import { AI_CONFIG_STATES } from "../../shared/ai-config-state.mjs";
import {
  getStoredAiConfigState,
  getStoredSearchSettings,
  ensureOriginPermission,
  isChatCompletionsEndpoint,
  resolveChatCompletionsEndpoint,
  resolveOriginPatternSafely,
  saveStoredSearchSettings,
} from "../../shared/search-settings.mjs";
import { runPageTransition } from "../../shared/page-transition.mjs";
import { createAiPreviewService, buildAiSearchPreview } from "./ai-preview-service.mjs";
import { DEFAULT_SEARCH_TARGET_ID, SEARCH_TARGETS } from "./helpers/search-targets.mjs";
import { normalizeTextValue, resolveDirectNavigationTarget } from "./helpers/query-utils.mjs";
import { readSearchHistory, saveSearchHistoryEntry } from "./helpers/search-history.mjs";
import {
  createLocalSuggestionItems,
  fetchRemoteSuggestionItems,
  mergeSuggestionItems,
} from "./helpers/search-suggestions.mjs";
import { newtabAssets } from "./assets";
import { AiPreviewPanel } from "./components/AiPreviewPanel";
import { MenuIcon } from "./components/icons";
import { SearchPanel } from "./components/SearchPanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { WidgetBoard } from "./components/WidgetBoard";
import {
  createEmptyStatus,
  extensionApi,
  type AiPreviewAction,
  type AiRuntimeState,
  type AiSearchPreviewModel,
  type SearchSettings,
  type SearchTarget,
  type StatusMessage,
  type SuggestionItem,
} from "./components/types";

const SEARCH_REQUEST_TIMEOUT = 15_000;
const TRANSIENT_RETRY_DELAYS = [450, 1100];
const BING_SEARCH_ORIGIN_PATTERN = "https://www.bing.com/*";
const BING_RSS_ENDPOINT = "https://www.bing.com/search?format=rss&mkt=zh-CN&q=";
const SUGGESTION_DEBOUNCE_MS = 220;

const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  endpoint: "",
  apiKey: "",
  model: "",
  aiSearchEnabled: false,
};

const DEFAULT_RUNTIME_STATE: AiRuntimeState = {
  protocol: "",
  configState: AI_CONFIG_STATES.UNCONFIGURED,
  lastTestStatus: "",
  lastTestMessage: "",
  lastTestAt: "",
  lastRuntimeErrorMessage: "",
  lastRuntimeErrorAt: "",
};

function getSearchTargetById(targetId: string): SearchTarget {
  return (SEARCH_TARGETS as SearchTarget[]).find((target) => target.id === targetId) ?? (SEARCH_TARGETS as SearchTarget[])[0];
}

function canUseAiSearch(settings: SearchSettings, runtimeState: AiRuntimeState): boolean {
  return Boolean(settings.aiSearchEnabled && [AI_CONFIG_STATES.VALID, AI_CONFIG_STATES.DEGRADED].includes(runtimeState.configState));
}

export function App() {
  const targets = SEARCH_TARGETS as SearchTarget[];
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState<SearchSettings>(DEFAULT_SEARCH_SETTINGS);
  const [runtimeState, setRuntimeState] = useState<AiRuntimeState>(DEFAULT_RUNTIME_STATE);
  const [currentTarget, setCurrentTarget] = useState<SearchTarget>(() => getSearchTargetById(DEFAULT_SEARCH_TARGET_ID));
  const [searchHistoryItems, setSearchHistoryItems] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [status, setStatus] = useState<StatusMessage>(() => createEmptyStatus());
  const [aiPending, setAiPending] = useState(false);
  const [aiActivating, setAiActivating] = useState(false);
  const [preview, setPreview] = useState<AiSearchPreviewModel | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [manageMenuOpen, setManageMenuOpen] = useState(false);
  const [widgetEditMode, setWidgetEditMode] = useState(false);
  const [cachedSidebarWindowId, setCachedSidebarWindowId] = useState<number | null>(null);

  const aiEnabled = canUseAiSearch(settings, runtimeState);
  const aiPreviewService = useMemo(() => createAiPreviewService({
    deps: {
      ensureOriginPermission,
      isChatCompletionsEndpoint,
      resolveChatCompletionsEndpoint,
      resolveOriginPatternSafely,
    },
    config: {
      searchRequestTimeout: SEARCH_REQUEST_TIMEOUT,
      transientRetryDelays: TRANSIENT_RETRY_DELAYS,
      bingSearchOriginPattern: BING_SEARCH_ORIGIN_PATTERN,
      bingRssEndpoint: BING_RSS_ENDPOINT,
    },
  }), []);

  const refreshStoredSnapshot = useCallback(async () => {
    const [nextSettings, nextRuntimeState] = await Promise.all([
      getStoredSearchSettings(),
      getStoredAiConfigState(),
    ]);
    setSettings(nextSettings);
    setRuntimeState(nextRuntimeState);
  }, []);

  useEffect(() => {
    void refreshStoredSnapshot().catch((error) => {
      setStatus({ message: error instanceof Error ? error.message : "读取 AI 配置失败", tone: "error" });
    });
    void readSearchHistory(extensionApi).then((items) => {
      setSearchHistoryItems(Array.isArray(items) ? items.map((item) => String(item)) : []);
    });
  }, [refreshStoredSnapshot]);

  useEffect(() => {
    document.body.classList.toggle("is-ai-search-enabled", aiEnabled);
    document.body.classList.toggle("is-ai-search-searching", aiPending);
    document.body.classList.toggle("is-ai-search-activating", aiActivating);
  }, [aiActivating, aiEnabled, aiPending]);

  useEffect(() => {
    const refreshSidebarWindowId = async () => {
      if (!extensionApi?.tabs?.query) {
        return;
      }
      try {
        const [activeTab] = await extensionApi.tabs.query({ active: true, currentWindow: true });
        if (typeof activeTab?.windowId === "number") {
          setCachedSidebarWindowId(activeTab.windowId);
        }
      } catch {
        // Keep the previous window id if Chrome rejects a cold-start query.
      }
    };

    void refreshSidebarWindowId();
    const handleFocus = () => void refreshSidebarWindowId();
    window.addEventListener("focus", handleFocus);
    extensionApi?.tabs?.onActivated?.addListener?.(handleFocus);
    extensionApi?.windows?.onFocusChanged?.addListener?.(handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
      extensionApi?.tabs?.onActivated?.removeListener?.(handleFocus);
      extensionApi?.windows?.onFocusChanged?.removeListener?.(handleFocus);
    };
  }, []);

  useEffect(() => {
    if (!manageMenuOpen) {
      return;
    }

    const manageMenu = document.getElementById("homepage-manage-menu");
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && manageMenu?.contains(event.target)) {
        return;
      }
      setManageMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setManageMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [manageMenuOpen]);

  const openAiSidebar = useCallback(() => {
    if (!extensionApi?.sidePanel?.open || typeof window === "undefined") {
      setStatus({ message: "当前环境不支持侧边栏，请在兼容浏览器中重试。", tone: "error" });
      return;
    }

    try {
      const openResult = extensionApi.runtime?.sendMessage?.({ type: "pet.openSidePanel" });
      if (openResult && typeof openResult.then === "function") {
        void openResult
          .then((response: { ok?: boolean; message?: string } | undefined) => {
            setStatus(response?.ok === false
              ? { message: response.message || "打开 AI 侧边栏失败。", tone: "error" }
              : { message: "已打开 AI 助手侧边栏。", tone: "success" });
          })
          .catch((error: unknown) => {
            setStatus({ message: error instanceof Error ? error.message : "打开 AI 侧边栏失败。", tone: "error" });
          });
        return;
      }
    } catch {
      // Fall back to direct sidePanel.open below.
    }

    if (typeof cachedSidebarWindowId !== "number") {
      setStatus({ message: "正在准备 AI 侧边栏，请再点一次。", tone: "error" });
      return;
    }

    try {
      const openResult = extensionApi.sidePanel.open({ windowId: cachedSidebarWindowId });
      setStatus({ message: "已打开 AI 助手侧边栏。", tone: "success" });
      void openResult?.catch?.((error: unknown) => {
        setStatus({ message: error instanceof Error ? error.message : "打开 AI 侧边栏失败。", tone: "error" });
      });
    } catch (error) {
      setStatus({ message: error instanceof Error ? error.message : "打开 AI 侧边栏失败。", tone: "error" });
    }
  }, [cachedSidebarWindowId]);


  useEffect(() => {
    const normalizedQuery = normalizeTextValue(query);
    if (!normalizedQuery || preview) {
      setSuggestions([]);
      return;
    }

    const timer = window.setTimeout(() => {
      const localItems = createLocalSuggestionItems(normalizedQuery, searchHistoryItems, targets) as SuggestionItem[];
      setSuggestions(localItems);
      void fetchRemoteSuggestionItems(normalizedQuery).then((remoteItems: SuggestionItem[]) => {
        setSuggestions(mergeSuggestionItems(localItems, remoteItems) as SuggestionItem[]);
      });
    }, SUGGESTION_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [preview, query, searchHistoryItems, targets]);

  const recordSearchHistoryEntry = async (value: string) => {
    const normalizedQuery = normalizeTextValue(value);
    if (!normalizedQuery) {
      return;
    }
    const nextItems = await saveSearchHistoryEntry(extensionApi, normalizedQuery);
    setSearchHistoryItems(Array.isArray(nextItems) ? nextItems.map((item) => String(item)) : []);
  };

  const runSearchForTarget = async (value: string, targetId = currentTarget.id) => {
    const normalizedQuery = normalizeTextValue(value);
    if (!normalizedQuery) {
      return;
    }
    const target = getSearchTargetById(targetId);
    setCurrentTarget(target);
    await recordSearchHistoryEntry(normalizedQuery);
    window.location.href = target.buildSearchUrl(normalizedQuery);
  };

  const runDefaultSearchFlow = async (value: string) => {
    const normalizedQuery = normalizeTextValue(value);
    if (!normalizedQuery) {
      setStatus({ message: "请输入搜索内容。", tone: "error" });
      return;
    }
    const directTarget = resolveDirectNavigationTarget(normalizedQuery);
    if (directTarget) {
      window.location.href = directTarget;
      return;
    }
    await runSearchForTarget(normalizedQuery, currentTarget.id);
  };

  const openUrlInNewTab = (url: string) => {
    if (extensionApi?.tabs?.create) {
      extensionApi.tabs.create({ url, active: true });
      return;
    }
    const newWindow = window.open(url, "_blank", "noopener");
    if (newWindow) {
      newWindow.opener = null;
    }
  };

  const runPreviewAction = async (action: AiPreviewAction) => {
    if (action.type === "open") {
      openUrlInNewTab(action.target);
      return;
    }
    await runSearchForTarget(action.target || query, currentTarget.id);
  };

  const handleSubmit = async (value: string) => {
    const normalizedQuery = normalizeTextValue(value);
    if (!normalizedQuery) {
      setStatus({ message: "请输入搜索内容。", tone: "error" });
      return;
    }

    if (preview?.originalQuery === normalizedQuery) {
      await runPreviewAction(preview.primaryAction);
      return;
    }

    setSuggestions([]);
    setStatus(createEmptyStatus());
    if (!aiEnabled || !currentTarget.isGeneral) {
      await runDefaultSearchFlow(normalizedQuery);
      return;
    }

    setAiPending(true);
    setPreview(null);
    try {
      const decision = await aiPreviewService.requestAiSearchDecision(normalizedQuery, settings);
      let websites: unknown[] = [];
      let websiteWarning = "";
      try {
        websites = (await aiPreviewService.resolveDecisionWebsites(normalizedQuery, decision, settings)) as unknown[];
      } catch (error) {
        websiteWarning = error instanceof Error ? error.message : "候选网站暂时不可用";
      }
      const nextPreview = buildAiSearchPreview({ ...decision, websites }, normalizedQuery) as AiSearchPreviewModel;
      setPreview(nextPreview);
      setStatus({
        message: websiteWarning ? `${nextPreview.readyMessage} 候选网站暂未加载，仍可继续搜索。` : nextPreview.readyMessage,
        tone: "neutral",
      });
    } catch {
      setPreview(null);
      setStatus({ message: "AI增强搜索暂时不可用，已切换为普通搜索。", tone: "neutral" });
      await runDefaultSearchFlow(normalizedQuery);
    } finally {
      setAiPending(false);
    }
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (preview && normalizeTextValue(value) !== preview.originalQuery) {
      setPreview(null);
      setStatus(createEmptyStatus());
    }
  };

  const handleTargetChange = (target: SearchTarget) => {
    setCurrentTarget(target);
    setPreview(null);
    setStatus(createEmptyStatus());
  };

  const handleRunSuggestion = (item: SuggestionItem) => {
    setQuery(item.query);
    setPreview(null);
    if (item.type === "action" && item.targetId) {
      void runSearchForTarget(item.query, item.targetId);
      return;
    }
    void runDefaultSearchFlow(item.query);
  };

  const toggleAiSearch = async () => {
    if (aiPending) {
      return;
    }

    const nextEnabled = !settings.aiSearchEnabled;
    setAiActivating(nextEnabled);
    try {
      const [currentSettings, currentRuntimeState] = await Promise.all([
        getStoredSearchSettings(),
        getStoredAiConfigState(),
      ]);
      if (nextEnabled && !canUseAiSearch({ ...currentSettings, aiSearchEnabled: true }, currentRuntimeState)) {
        throw new Error(
          currentRuntimeState.configState === AI_CONFIG_STATES.CONFIGURED
            ? "请先点击“测试连接”，确认接口可用后再开启 AI 搜索增强。"
            : currentRuntimeState.configState === AI_CONFIG_STATES.INVALID
              ? "当前接口测试未通过，请修正配置并重新测试后再开启 AI 搜索增强。"
              : "请先完整配置并测试接口连接，再开启 AI 搜索增强。",
        );
      }

      const nextSettings = { ...currentSettings, aiSearchEnabled: nextEnabled };
      await saveStoredSearchSettings(nextSettings);
      setSettings(nextSettings);
      setRuntimeState(currentRuntimeState);
      setStatus(createEmptyStatus());
      if (!nextEnabled) {
        setPreview(null);
      }
    } catch (error) {
      setStatus({ message: error instanceof Error ? error.message : "保存 AI 开关失败", tone: "error" });
      setSettings(await getStoredSearchSettings());
      setRuntimeState(await getStoredAiConfigState());
    } finally {
      setAiActivating(false);
    }
  };

  const openDarkRoom = () => {
    const runtime = extensionApi?.runtime;
    const darkRoomUrl = runtime?.getURL
      ? runtime.getURL("src/pages/game/index.html")
      : "./../game/index.html";

    void runPageTransition({
      documentRef: document,
      windowRef: window,
      label: "正在进入暗室",
      mode: "enter-game",
      onComplete: () => {
        window.location.href = darkRoomUrl;
      },
    });
  };

  const searchNode = (
    <>
      <SearchPanel
        query={query}
        currentTarget={currentTarget}
        targets={targets}
        suggestions={suggestions}
        aiEnabled={aiEnabled}
        aiPending={aiPending}
        aiActivating={aiActivating}
        status={status}
        preview={preview}
        onQueryChange={handleQueryChange}
        onSubmit={(value) => void handleSubmit(value)}
        onTargetChange={handleTargetChange}
        onToggleAi={() => void toggleAiSearch()}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSidebar={openAiSidebar}
        onRunSuggestion={handleRunSuggestion}
      />
      <AiPreviewPanel preview={preview} onAction={(action) => void runPreviewAction(action)} onWebsiteOpen={openUrlInNewTab} />
    </>
  );

  return (
    <main className="homepage-shell">
      <section className="homepage-hero" aria-label="新标签页搜索">
        <section id="homepage-stage" className="homepage-stage" aria-label="主页搜索区域">
          <div id="homepage-bubble-layer" className="homepage-stage__ambient homepage-paper-glow" aria-hidden="true" />
          <div className="homepage-stage__decor" aria-hidden="true">
            <img data-stage-asset="bg-ambient" className="homepage-stage__asset homepage-stage__asset--bg" src={newtabAssets.desktopBgAmbient} alt="" />
            <img data-stage-asset="cloud-ribbon" className="homepage-stage__asset homepage-stage__asset--cloud-ribbon" src={newtabAssets.cloudRibbon} alt="" />
            <img data-stage-asset="pet-left" className="homepage-stage__asset homepage-stage__asset--pet-left" src={newtabAssets.petLeftPeek} alt="" />
            <img data-stage-asset="pet-right" className="homepage-stage__asset homepage-stage__asset--pet-right" src={newtabAssets.petRightBuddy} alt="" />
            <img data-stage-asset="pet-mini" className="homepage-stage__asset homepage-stage__asset--pet-mini" src={newtabAssets.petMiniPair} alt="" />
          </div>

          <SettingsDialog
            open={settingsOpen}
            settings={settings}
            runtimeState={runtimeState}
            onClose={() => setSettingsOpen(false)}
            onSnapshotChange={(nextSettings, nextRuntimeState) => {
              setSettings(nextSettings);
              setRuntimeState(nextRuntimeState);
              if (!canUseAiSearch(nextSettings, nextRuntimeState)) {
                setPreview(null);
              }
            }}
            onSearchStatus={setStatus}
            onAiActivatingChange={setAiActivating}
          />

          <section className="homepage-focus-shell layout-newtab-hero" aria-label="主页搜索区域">
            <details id="homepage-manage-menu" className="homepage-manage-menu" open={manageMenuOpen} onToggle={(event) => setManageMenuOpen(event.currentTarget.open)}>
              <summary id="homepage-manage-trigger" className="ui-btn-icon homepage-manage-trigger" aria-label="打开页面管理菜单">
                <MenuIcon />
              </summary>
              <div className="homepage-manage-popover" role="group" aria-label="页面管理">
                <button id="toggle-widget-edit-mode" className="homepage-manage-item homepage-widget-edit-trigger" type="button" aria-pressed={widgetEditMode} onClick={() => { setWidgetEditMode(true); setManageMenuOpen(false); }}>
                  编辑布局
                </button>
                <button id="open-dark-room" className="homepage-manage-item" type="button" aria-label="打开暗室" onClick={() => { setManageMenuOpen(false); openDarkRoom(); }}>
                  暗室
                </button>
                <button id="open-ai-sidebar" className="settings-trigger homepage-manage-item search-ai-sidebar-trigger" type="button" aria-label="打开 AI 助手侧边栏" onClick={() => { setManageMenuOpen(false); openAiSidebar(); }}>
                  AI 侧栏
                </button>
                <button id="open-settings" className="settings-trigger homepage-manage-item" type="button" aria-label="打开设置" onClick={() => { setManageMenuOpen(false); setSettingsOpen(true); }}>
                  设置
                </button>
              </div>
            </details>

            <WidgetBoard searchNode={searchNode} editMode={widgetEditMode} onEditModeChange={setWidgetEditMode} />
          </section>
        </section>
      </section>
    </main>
  );
}
