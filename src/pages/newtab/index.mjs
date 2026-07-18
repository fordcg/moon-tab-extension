import {
  ensureOriginPermission,
  getStoredAiConfigState,
  getStoredSearchSettings,
  isChatCompletionsEndpoint,
  resolveChatCompletionsEndpoint,
  resolveOriginPatternSafely,
} from "../../shared/search-settings.mjs";
import {
  normalizeTextValue,
  resolveDirectNavigationTarget,
  resolveNavigationTarget,
  uniqueTextList,
} from "./helpers/query-utils.mjs";
import { DEFAULT_SEARCH_TARGET_ID, getSearchTargetById, SEARCH_TARGETS } from "./helpers/search-targets.mjs";
import { readSearchHistory, saveSearchHistoryEntry } from "./helpers/search-history.mjs";
import {
  createLocalSuggestionItems,
  fetchRemoteSuggestionItems,
  mergeSuggestionItems,
} from "./helpers/search-suggestions.mjs";
import { getNewtabDomRefs } from "./dom-refs.mjs";
import { runPageTransition } from "../../shared/page-transition.mjs";
import { createAiPreviewController } from "./ai-preview-controller.mjs";
import { createSuggestionsController } from "./suggestions-controller.mjs";
import { createSearchTargetController } from "./search-target-controller.mjs";
import { createStartupController } from "./startup-controller.mjs";
import { createInteractionsController } from "./interactions-controller.mjs";
import { listWidgets } from "./widgets/registry.mjs";
import { createWidgetRuntime } from "./widgets/widget-runtime.mjs";
import * as widgetLayoutState from "./widgets/layout-state.mjs";
import { mountFloatingPetCompanion } from "../../shared/pet/pagePetHost.ts";

const registeredWidgets = listWidgets();
const initialElements = getNewtabDomRefs();
const widgetRuntime = createWidgetRuntime({
  documentRef: document,
  registryItems: registeredWidgets,
  layoutStateApi: widgetLayoutState,
  elements: initialElements.widgetRuntime,
});

await widgetRuntime.mount();

const elements = getNewtabDomRefs();
const { search, ai, controllerElements } = elements;
const { initializeSettingsUi } = await import("./settings/index.mjs");

const SEARCH_TRACE_DURATION = 1280;
const PLACEHOLDER_FADE_DURATION = 320;
const MODULE_REVEAL_DELAY = 160;
const SEARCH_REQUEST_TIMEOUT = 15000;
const TRANSIENT_RETRY_DELAYS = [450, 1100];
const SEARCH_OUTLINE_STROKE_WIDTH = 1;
const SEARCH_OUTLINE_INSET = 0;
const BING_SEARCH_ORIGIN_PATTERN = "https://www.bing.com/*";
const BING_RSS_ENDPOINT = "https://www.bing.com/search?format=rss&mkt=zh-CN&q=";
const extensionApi = typeof chrome !== "undefined" ? chrome : null;
const availableSearchTargets = SEARCH_TARGETS;
let currentSearchTarget = getSearchTargetById(DEFAULT_SEARCH_TARGET_ID);
let searchHistoryItems = [];
let cachedSidebarWindowId = null;

let aiPreviewController;
let suggestionsController;
let searchTargetController;
let startupController;
let interactionsController;

const openUrlInNewTab = (url) => {
  if (extensionApi?.tabs?.create) {
    extensionApi.tabs.create({ url, active: true });
    return;
  }

  const newWindow = window.open(url, "_blank", "noopener");
  if (newWindow) {
    newWindow.opener = null;
  }
};

const setSearchStatus = (message, tone = "neutral") => {
  if (!(search.status instanceof HTMLElement)) {
    return;
  }

  search.status.textContent = message;
  search.status.dataset.tone = tone;
  search.status.hidden = !message;
};

const syncRenderedSearchUi = () => {
  searchTargetController.render();
  suggestionsController.render();
};

const closeSearchMenus = () => {
  searchTargetController.setOpen(false);
  suggestionsController.dismiss();
};

const recordSearchHistoryEntry = async (query) => {
  const normalizedQuery = normalizeTextValue(query);
  if (!normalizedQuery) {
    return searchHistoryItems;
  }

  const nextHistoryItems = await saveSearchHistoryEntry(extensionApi, normalizedQuery);
  searchHistoryItems = Array.isArray(nextHistoryItems) ? [...nextHistoryItems] : [];
  return searchHistoryItems;
};

const hideAiSearchPreview = () => {
  aiPreviewController.hidePreview();
};

const resolveSearchTarget = (targetId = currentSearchTarget?.id ?? DEFAULT_SEARCH_TARGET_ID) =>
  getSearchTargetById(targetId) ?? currentSearchTarget ?? SEARCH_TARGETS[0];

const runSearchForTarget = async (query, targetId = currentSearchTarget?.id ?? DEFAULT_SEARCH_TARGET_ID) => {
  const searchTarget = resolveSearchTarget(targetId);
  currentSearchTarget = searchTarget;
  await recordSearchHistoryEntry(query);
  window.location.href = searchTarget.buildSearchUrl(query);
};

const refreshSidebarWindowId = async () => {
  if (!extensionApi?.tabs?.query) {
    return;
  }
  try {
    const [activeTab] = await extensionApi.tabs.query({ active: true, currentWindow: true });
    if (typeof activeTab?.windowId === "number") {
      cachedSidebarWindowId = activeTab.windowId;
    }
  } catch (_error) {
    // 查询失败时保留旧的 windowId，open 时再兜底处理。
  }
};

const openAiSidebar = () => {
  if (!extensionApi?.sidePanel?.open || typeof window === "undefined") {
    setSearchStatus("当前环境不支持侧边栏，请在兼容浏览器中重试。", "error");
    return;
  }

  // sidePanel.open() 必须同步运行在用户手势任务内，任何 await 都会丢失手势，
  // 因此用启动时预取并缓存的 windowId，避免在点击处理里再 await tabs.query。
  if (typeof cachedSidebarWindowId !== "number") {
    setSearchStatus("正在准备 AI 侧边栏，请再点一次。", "error");
    void refreshSidebarWindowId();
    return;
  }

  try {
    const openResult = extensionApi.sidePanel.open({ windowId: cachedSidebarWindowId });
    setSearchStatus("已打开 AI 助手侧边栏。", "success");
    void openResult?.catch?.((error) => {
      setSearchStatus(error instanceof Error ? error.message : "打开 AI 侧边栏失败。", "error");
    });
  } catch (error) {
    setSearchStatus(error instanceof Error ? error.message : "打开 AI 侧边栏失败。", "error");
  }
};

const triggerAiSearchToggle = () => {
  if (!(ai.enabledInput instanceof HTMLInputElement)) {
    setSearchStatus("设置项未就绪，请稍后重试。", "error");
    return;
  }

  if (aiPreviewController.isPending?.() || false) {
    return;
  }

  ai.enabledInput.checked = !ai.enabledInput.checked;
  ai.enabledInput.dispatchEvent(new Event("change", { bubbles: true }));
};

const syncAiSearchEnabled = (enabled) => {
  aiPreviewController.syncEnabled(enabled);
};

const syncAiSearchActivating = (activating) => {
  aiPreviewController.syncActivating(activating);
};

const syncAiConfigState = (configState) => {
  if (configState !== "valid" && configState !== "degraded") {
    hideAiSearchPreview();
  }
};

const focusSearchInputIfIdle = () => {
  if (!(search.input instanceof HTMLInputElement) || search.input.disabled) {
    return;
  }

  const activeElement = document.activeElement;
  const shouldFocus = !activeElement || activeElement === document.body || activeElement === document.documentElement;
  if (!shouldFocus) {
    return;
  }

  search.input.focus({ preventScroll: true });
};

const runDefaultSearchFlow = async (query) => {
  const directTarget = resolveDirectNavigationTarget(query);
  if (directTarget) {
    window.location.href = directTarget;
    return;
  }

  await runSearchForTarget(normalizeTextValue(query), currentSearchTarget?.id ?? DEFAULT_SEARCH_TARGET_ID);
};

const shouldBypassAiForCurrentTarget = () => {
  const activeTarget = resolveSearchTarget(currentSearchTarget?.id ?? DEFAULT_SEARCH_TARGET_ID);
  return !activeTarget.isGeneral;
};

const shouldUseAiSearchFlow = (settings) => Boolean(settings?.aiSearchEnabled) && !shouldBypassAiForCurrentTarget();

const getHomepageSearchSettings = async () => {
  const [settings, aiConfigState] = await Promise.all([
    getStoredSearchSettings(),
    getStoredAiConfigState(),
  ]);

  return {
    ...settings,
    aiSearchEnabled: Boolean(
      settings.aiSearchEnabled
      && (aiConfigState?.configState === "valid" || aiConfigState?.configState === "degraded")
    ),
  };
};

aiPreviewController = createAiPreviewController({
  elements: controllerElements.aiPreview,
  callbacks: {
    openUrlInNewTab,
    runSearchForTarget,
    runDefaultSearchFlow,
    getCurrentSearchTarget: () => currentSearchTarget,
    shouldBypassAiForCurrentTarget,
    getCurrentInputQuery: () => (search.input instanceof HTMLInputElement ? search.input.value : ""),
    setSearchStatus,
  },
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
});

suggestionsController = createSuggestionsController({
  elements: controllerElements.suggestions,
  deps: {
    normalizeTextValue,
    resolveDirectNavigationTarget,
    createLocalSuggestionItems,
    fetchRemoteSuggestionItems,
    mergeSuggestionItems,
  },
  callbacks: {
    getSearchHistoryItems: () => searchHistoryItems,
    getAvailableSearchTargets: () => availableSearchTargets,
    getCurrentSearchTarget: () => currentSearchTarget,
    setCurrentSearchTarget: (target) => {
      currentSearchTarget = target;
    },
    resolveSearchTarget,
    syncSearchTargetShell: () => {
      searchTargetController.syncShell();
    },
    runSearchForTarget,
    runDefaultSearchFlow,
  },
  constants: {
    suggestionRefreshDebounce: 220,
  },
});

searchTargetController = createSearchTargetController({
  elements: controllerElements.searchTarget,
  callbacks: {
    getAvailableSearchTargets: () => availableSearchTargets,
    getCurrentSearchTarget: () => currentSearchTarget,
    setCurrentSearchTarget: (target) => {
      currentSearchTarget = target;
    },
    resolveSearchTarget,
    hideAiSearchPreview,
    clearSearchStatus: () => {
      setSearchStatus("", "neutral");
    },
    dismissSuggestions: () => {
      suggestionsController.dismiss();
    },
    hasActiveAiPreview: () => Boolean(aiPreviewController.getActivePreview()),
  },
});

startupController = createStartupController({
  elements: controllerElements.startup,
  callbacks: {
    focusSearchInputIfIdle,
  },
  config: {
    searchTraceDuration: SEARCH_TRACE_DURATION,
    placeholderFadeDuration: PLACEHOLDER_FADE_DURATION,
    moduleRevealDelay: MODULE_REVEAL_DELAY,
    searchOutlineStrokeWidth: SEARCH_OUTLINE_STROKE_WIDTH,
    searchOutlineInset: SEARCH_OUTLINE_INSET,
  },
});

interactionsController = createInteractionsController({
  elements: controllerElements.interactions,
  controllers: {
    aiPreviewController,
    suggestionsController,
    searchTargetController,
  },
  callbacks: {
    triggerAiSearchToggle,
    closeSearchMenus,
    hideAiSearchPreview,
    setSearchStatus,
    shouldUseAiSearchFlow,
    runDefaultSearchFlow,
    getStoredSearchSettings: getHomepageSearchSettings,
    focusSearchInput: () => {
      search.input.focus();
    },
  },
  deps: {
    isChatCompletionsEndpoint,
  },
});
interactionsController.bind();

// 启动即预取 windowId，并在标签/窗口焦点变化时刷新，保证点击时缓存可用。
void refreshSidebarWindowId();
extensionApi?.tabs?.onActivated?.addListener?.(() => {
  void refreshSidebarWindowId();
});
extensionApi?.windows?.onFocusChanged?.addListener?.(() => {
  void refreshSidebarWindowId();
});
window.addEventListener("focus", () => {
  void refreshSidebarWindowId();
});

ai.openSidebarButton?.addEventListener("click", () => {
  openAiSidebar();
});

const openDarkRoomButton = document.getElementById("open-dark-room");
openDarkRoomButton?.addEventListener("click", () => {
  const darkRoomUrl = extensionApi?.runtime?.getURL
    ? extensionApi.runtime.getURL("src/pages/game/index.html")
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
});

const homepageManageMenu = document.getElementById("homepage-manage-menu");
const closeHomepageManageMenu = () => {
  if (homepageManageMenu instanceof HTMLDetailsElement) {
    homepageManageMenu.open = false;
  }
};

document.addEventListener("click", (event) => {
  if (!(homepageManageMenu instanceof HTMLDetailsElement) || !homepageManageMenu.open) {
    return;
  }

  if (event.target instanceof Node && homepageManageMenu.contains(event.target)) {
    return;
  }

  closeHomepageManageMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeHomepageManageMenu();
  }
});

homepageManageMenu?.addEventListener("click", (event) => {
  const actionButton =
    event.target instanceof Element
      ? event.target.closest(".homepage-manage-item")
      : null;

  if (actionButton) {
    window.requestAnimationFrame(closeHomepageManageMenu);
  }
});

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

initializeSettingsUi({
  setSearchStatus,
  syncAiSearchEnabled,
  syncAiSearchActivating,
  syncAiConfigState,
});
syncRenderedSearchUi();
searchTargetController.syncShell();
aiPreviewController.renderIndicator();
void readSearchHistory(extensionApi).then((items) => {
  searchHistoryItems = Array.isArray(items) ? [...items] : [];
});
startupController.initialize({ prefersReducedMotion });

// Newtab is an extension page, so content scripts do not run. Mount the same
// floating pet host used on normal webpages.
mountFloatingPetCompanion({
  openSidePanel: () => {
    openAiSidebar();
  },
});

window.addEventListener("resize", () => {
  startupController.handleResize();
});
