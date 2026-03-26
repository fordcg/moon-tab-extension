import {
  ensureOriginPermission,
  getStoredSearchSettings,
  initializeSettingsUi,
  isChatCompletionsEndpoint,
  resolveChatCompletionsEndpoint,
  resolveOriginPatternSafely,
} from "./settings/index.mjs";
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
import { createAiPreviewController } from "./ai-preview-controller.mjs";
import { createSuggestionsController } from "./suggestions-controller.mjs";
import { createSearchTargetController } from "./search-target-controller.mjs";
import { createStartupController } from "./startup-controller.mjs";
import { createInteractionsController } from "./interactions-controller.mjs";
import { initializeLiquidGlassBubbleLayer } from "./liquid-glass-bubble-layer.mjs";

const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const searchStatus = document.getElementById("search-status");
const aiSearchIndicator = document.getElementById("ai-search-indicator");
const aiSearchIndicatorText = document.getElementById("ai-search-indicator-text");
const aiToggleButton = document.getElementById("ai-toggle-btn");
const aiSearchEnabledInput = document.getElementById("ai-search-enabled");
const aiSearchPreview = document.getElementById("ai-search-preview");
const aiSearchPreviewIntent = document.getElementById("ai-search-preview-intent");
const aiSearchPreviewSummary = document.getElementById("ai-search-preview-summary");
const aiSearchPreviewOriginalQuery = document.getElementById("ai-search-preview-original-query");
const aiSearchPreviewTargetLabel = document.getElementById("ai-search-preview-target-label");
const aiSearchPreviewTarget = document.getElementById("ai-search-preview-target");
const aiSearchPreviewWebsites = document.getElementById("ai-search-preview-websites");
const aiSearchPreviewWebsitesList = document.getElementById("ai-search-preview-websites-list");
const aiSearchPreviewRelated = document.getElementById("ai-search-preview-related");
const aiSearchPreviewSuggestions = document.getElementById("ai-search-preview-suggestions");
const aiSearchPreviewAction = document.getElementById("ai-search-preview-action");
const aiSearchPreviewSecondaryAction = document.getElementById("ai-search-preview-secondary-action");
const searchTargetTrigger = document.getElementById("search-target-trigger");
const searchTargetLabel = document.getElementById("search-target-label");
const searchTargetMenu = document.getElementById("search-target-menu");
const searchSuggestions = document.getElementById("search-suggestions");
const searchFrame = document.querySelector(".outline-search-frame");
const searchOutline = document.querySelector(".outline-search-outline");
const searchOutlineRect = document.querySelector(".outline-search-outline-rect");
const homepageBubbleLayer = document.getElementById("homepage-bubble-layer");

const SEARCH_TRACE_DURATION = 1280;
const PLACEHOLDER_FADE_DURATION = 320;
const MODULE_REVEAL_DELAY = 160;
const SEARCH_REQUEST_TIMEOUT = 15000;
const TRANSIENT_RETRY_DELAYS = [450, 1100];
const SEARCH_OUTLINE_STROKE_WIDTH = 1;
const SEARCH_OUTLINE_INSET = 6;
const BING_SEARCH_ORIGIN_PATTERN = "https://www.bing.com/*";
const BING_RSS_ENDPOINT = "https://www.bing.com/search?format=rss&mkt=zh-CN&q=";
const extensionApi = typeof chrome !== "undefined" ? chrome : null;
let currentSearchTarget = getSearchTargetById(DEFAULT_SEARCH_TARGET_ID);
const availableSearchTargets = SEARCH_TARGETS;
let searchHistoryItems = [];

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
  if (!(searchStatus instanceof HTMLElement)) {
    return;
  }

  searchStatus.textContent = message;
  searchStatus.dataset.tone = tone;
  searchStatus.hidden = !message;
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

const triggerAiSearchToggle = () => {
  if (!(aiSearchEnabledInput instanceof HTMLInputElement)) {
    setSearchStatus("设置项未就绪，请稍后重试。", "error");
    return;
  }

  if (aiPreviewController.isPending?.() || false) {
    return;
  }

  aiSearchEnabledInput.checked = !aiSearchEnabledInput.checked;
  aiSearchEnabledInput.dispatchEvent(new Event("change", { bubbles: true }));
};

const syncAiSearchEnabled = (enabled) => {
  aiPreviewController.syncEnabled(enabled);
};

const syncAiSearchActivating = (activating) => {
  aiPreviewController.syncActivating(activating);
};

const focusSearchInputIfIdle = () => {
  if (!(searchInput instanceof HTMLInputElement) || searchInput.disabled) {
    return;
  }

  const activeElement = document.activeElement;
  const shouldFocus = !activeElement || activeElement === document.body || activeElement === document.documentElement;
  if (!shouldFocus) {
    return;
  }

  searchInput.focus({ preventScroll: true });
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

aiPreviewController = createAiPreviewController({
  elements: {
    searchForm,
    searchInput,
    searchStatus,
    aiSearchIndicator,
    aiSearchIndicatorText,
    aiToggleButton,
    aiSearchPreview,
    aiSearchPreviewIntent,
    aiSearchPreviewSummary,
    aiSearchPreviewOriginalQuery,
    aiSearchPreviewTargetLabel,
    aiSearchPreviewTarget,
    aiSearchPreviewWebsites,
    aiSearchPreviewWebsitesList,
    aiSearchPreviewRelated,
    aiSearchPreviewSuggestions,
    aiSearchPreviewAction,
    aiSearchPreviewSecondaryAction,
  },
  callbacks: {
    openUrlInNewTab,
    runSearchForTarget,
    runDefaultSearchFlow,
    getCurrentSearchTarget: () => currentSearchTarget,
    shouldBypassAiForCurrentTarget,
    getCurrentInputQuery: () => (searchInput instanceof HTMLInputElement ? searchInput.value : ""),
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
  elements: {
    searchInput,
    searchSuggestions,
  },
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
  elements: {
    searchTargetTrigger,
    searchTargetLabel,
    searchTargetMenu,
  },
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
  elements: {
    searchInput,
    searchFrame,
    searchOutline,
    searchOutlineRect,
  },
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
  elements: {
    searchForm,
    searchInput,
    aiToggleButton,
    aiSearchPreviewAction,
    aiSearchPreviewSecondaryAction,
    aiSearchPreviewSuggestions,
    aiSearchPreviewWebsitesList,
    searchTargetTrigger,
    searchTargetMenu,
    searchSuggestions,
  },
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
    getStoredSearchSettings,
    focusSearchInput: () => {
      searchInput.focus();
    },
  },
  deps: {
    isChatCompletionsEndpoint,
  },
});
interactionsController.bind();

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

initializeSettingsUi({
  setSearchStatus,
  syncAiSearchEnabled,
  syncAiSearchActivating,
});
syncRenderedSearchUi();
searchTargetController.syncShell();
aiPreviewController.renderIndicator();
void readSearchHistory(extensionApi).then((items) => {
  searchHistoryItems = Array.isArray(items) ? [...items] : [];
});
initializeLiquidGlassBubbleLayer({
  root: homepageBubbleLayer,
  prefersReducedMotionQuery: prefersReducedMotion,
});
startupController.initialize({ prefersReducedMotion });

window.addEventListener("resize", () => {
  startupController.handleResize();
});
