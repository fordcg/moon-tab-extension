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
import {
  WEBSITE_RESULT_LIMIT,
  enrichNoOpSearchDecision,
  normalizeSearchDecision,
  preserveMixedLanguageSearchTerms,
  resolveWebsiteCandidates,
  uniqueWebsiteCandidates,
} from "./helpers/decision-utils.mjs";
import {
  AI_REFUSAL_PATTERN,
  buildDecisionUserPrompt,
  isLikelySearchQueryText,
  looksLikeGatewayErrorPage,
  looksLikeHtmlDocument,
  parseJsonSafely,
  unwrapJsonFence,
} from "../../shared/search-ai-contract.mjs";
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
const SUGGESTION_REFRESH_DEBOUNCE = 220;
const TRANSIENT_RETRY_DELAYS = [450, 1100];
const SEARCH_OUTLINE_STROKE_WIDTH = 1;
const SEARCH_OUTLINE_INSET = 6;
const BING_SEARCH_ORIGIN_PATTERN = "https://www.bing.com/*";
const BING_RSS_ENDPOINT = "https://www.bing.com/search?format=rss&mkt=zh-CN&q=";
const extensionApi = typeof chrome !== "undefined" ? chrome : null;
let currentSearchTarget = getSearchTargetById(DEFAULT_SEARCH_TARGET_ID);
const availableSearchTargets = SEARCH_TARGETS;
let searchHistoryItems = [];
let suggestions = [];
let isSuggestionsOpen = false;
let highlightedSuggestionIndex = -1;
let activeSuggestionRequestId = 0;
let suggestionRefreshTimeoutId = 0;
let shouldKeepSuggestionsClosed = false;
let shouldSkipNextSubmit = false;

const createHtmlResponseError = () => new Error("搜索接口返回了 HTML 页面，请确认填写的是 API 接口地址，而不是站点首页或后台页面。");
const createAiRefusalError = () => new Error("AI 没有返回可用的搜索决策，而是返回了说明性文本。请更换模型或稍后重试。");
const createAiDecisionFormatError = () => new Error("AI 没有返回可用的搜索决策，请更换模型或稍后重试。");
let isAiSearchEnabled = false;
let isAiSearchPending = false;
let isAiSearchActivating = false;
let activeAiSearchPreview = null;

const parseBingRssResults = (rawText) => {
  const xml = new DOMParser().parseFromString(rawText, "application/xml");
  if (xml.querySelector("parsererror")) {
    throw new Error("网站搜索结果解析失败");
  }

  return uniqueWebsiteCandidates(
    Array.from(xml.querySelectorAll("item")).map((item) => ({
      title: item.querySelector("title")?.textContent ?? "",
      url: item.querySelector("link")?.textContent ?? "",
      description: item.querySelector("description")?.textContent ?? "",
    })),
  ).slice(0, WEBSITE_RESULT_LIMIT + 2);
};

const fetchWebsiteCandidatesFromBing = async (query) => {
  await ensureOriginPermission(BING_SEARCH_ORIGIN_PATTERN, "未授予 Bing 搜索权限，无法获取候选网站。");

  const response = await fetch(`${BING_RSS_ENDPOINT}${encodeURIComponent(query)}`, {
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml;q=0.9,*/*;q=0.8",
      "X-Title": "Moon Tab",
    },
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(normalizeResponseError(response.status, rawText));
  }

  return parseBingRssResults(rawText);
};

const buildWebsiteSelectionPrompt = (originalQuery, refinedQuery, candidates) => [
  "你是浏览器搜索结果整理器。",
  "你会收到用户主搜索词、AI 细化搜索词，以及网页搜索返回的候选网站。",
  "只输出一个 JSON 对象，不要输出解释、markdown 或多余文本。",
  "输出格式: {\"websites\":[{\"title\":\"网站标题\",\"url\":\"原始候选 URL\",\"description\":\"一句话说明这个网站为什么值得打开\"}]}。",
  "必须只从提供的候选网站里挑选 3 到 4 个，不要编造新网址，不要修改 URL。",
  "description 必须是中文，一句话说清用户打开这个网站能得到什么。",
  `用户主搜索词: ${originalQuery}`,
  `AI 细化搜索词: ${refinedQuery}`,
  `候选网站: ${JSON.stringify(candidates)}`,
].join("\n");

const requestAiWebsiteCandidates = async (originalQuery, refinedQuery, candidates, settings) => {
  if (!isChatCompletionsEndpoint(settings.endpoint) || !settings.model || !candidates.length) {
    return [];
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), SEARCH_REQUEST_TIMEOUT);

  try {
    const headers = {
      "Content-Type": "application/json",
      Accept: "*/*",
      "X-Title": "Moon Tab",
    };

    if (settings.apiKey) {
      headers.Authorization = `Bearer ${settings.apiKey}`;
    }

    const response = await fetch(resolveChatCompletionsEndpoint(settings.endpoint), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: "user", content: buildWebsiteSelectionPrompt(originalQuery, refinedQuery, candidates) }],
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(normalizeResponseError(response.status, rawText));
    }

    const assistantText = extractAssistantText(parseJsonSafely(rawText) ?? {});
    const normalizedText = unwrapJsonFence(assistantText || rawText);
    const payload = parseJsonSafely(normalizedText);
    if (!payload || typeof payload !== "object") {
      return [];
    }

    return resolveWebsiteCandidates(payload).slice(0, WEBSITE_RESULT_LIMIT);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return [];
    }

    return [];
  } finally {
    window.clearTimeout(timeoutId);
  }
};

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

const resolveDecisionWebsites = async (originalQuery, decision, settings) => {
  if (!decision || decision.mode !== "search") {
    return uniqueWebsiteCandidates(decision?.websites ?? []).slice(0, WEBSITE_RESULT_LIMIT);
  }

  const embeddedWebsites = uniqueWebsiteCandidates(decision.websites ?? []).slice(0, WEBSITE_RESULT_LIMIT);
  if (embeddedWebsites.length) {
    return embeddedWebsites;
  }

  const bingCandidates = await fetchWebsiteCandidatesFromBing(decision.target);
  const aiCandidates = await requestAiWebsiteCandidates(originalQuery, decision.target, bingCandidates, settings);
  return (aiCandidates.length ? aiCandidates : bingCandidates).slice(0, WEBSITE_RESULT_LIMIT);
};

const setSearchStatus = (message, tone = "neutral") => {
  if (!(searchStatus instanceof HTMLElement)) {
    return;
  }

  searchStatus.textContent = message;
  searchStatus.dataset.tone = tone;
  searchStatus.hidden = !message;
};

const clearSuggestions = () => {
  suggestions = [];
  isSuggestionsOpen = false;
  highlightedSuggestionIndex = -1;
};

const groupSuggestionItems = (items) => {
  const normalizedItems = Array.isArray(items) ? items : [];
  const queryItems = normalizedItems.filter((item) => item?.type === "query");
  const actionItems = normalizedItems.filter((item) => item?.type === "action");

  return [
    {
      id: "queries",
      label: "搜索建议",
      items: queryItems,
    },
    {
      id: "actions",
      label: "快捷操作",
      items: actionItems,
    },
  ].filter((group) => group.items.length > 0);
};

const renderSearchTargetMenu = () => {
  if (!(searchTargetMenu instanceof HTMLElement)) {
    return;
  }

  searchTargetMenu.innerHTML = "";

  const group = document.createElement("div");
  group.className = "search-target-menu-group";
  group.setAttribute("role", "presentation");

  const label = document.createElement("p");
  label.className = "search-dropdown-group-label";
  label.textContent = "搜索目标";
  group.appendChild(label);

  availableSearchTargets.forEach((target) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-target-menu-item";
    button.dataset.targetId = target.id;
    button.setAttribute("role", "option");
    button.textContent = target.label;
    group.appendChild(button);
  });

  searchTargetMenu.appendChild(group);
};

const renderSuggestions = () => {
  if (!(searchSuggestions instanceof HTMLElement)) {
    return;
  }

  searchSuggestions.innerHTML = "";

  const groups = groupSuggestionItems(suggestions);
  groups.forEach((group) => {
    const groupElement = document.createElement("div");
    groupElement.className = "search-suggestions-group";
    groupElement.dataset.groupId = group.id;
    groupElement.setAttribute("role", "presentation");

    const label = document.createElement("p");
    label.className = "search-dropdown-group-label";
    label.textContent = group.label;
    groupElement.appendChild(label);

    group.items.forEach((item) => {
      const suggestionIndex = suggestions.indexOf(item);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-suggestion-item";
      button.dataset.type = item.type ?? "query";
      button.dataset.query = item.query ?? "";
      button.dataset.index = String(suggestionIndex);
      button.dataset.highlighted = suggestionIndex === highlightedSuggestionIndex ? "true" : "false";
      button.setAttribute("aria-selected", suggestionIndex === highlightedSuggestionIndex ? "true" : "false");
      if (item.targetId) {
        button.dataset.targetId = item.targetId;
      }
      button.textContent = item.label ?? item.query ?? "";
      groupElement.appendChild(button);
    });

    searchSuggestions.appendChild(groupElement);
  });

  searchSuggestions.hidden = !isSuggestionsOpen || groups.length === 0;
};

const setSearchTargetMenuOpen = (open) => {
  if (searchTargetTrigger instanceof HTMLButtonElement) {
    searchTargetTrigger.setAttribute("aria-expanded", open ? "true" : "false");
  }

  if (searchTargetMenu instanceof HTMLElement) {
    searchTargetMenu.hidden = !open;
  }
};

const syncRenderedSearchUi = () => {
  renderSearchTargetMenu();
  renderSuggestions();
};

const setSuggestionHighlight = (nextIndex) => {
  const hasSuggestions = suggestions.length > 0;
  if (!hasSuggestions) {
    highlightedSuggestionIndex = -1;
    renderSuggestions();
    return null;
  }

  const normalizedIndex = Math.min(Math.max(nextIndex, 0), suggestions.length - 1);
  highlightedSuggestionIndex = normalizedIndex;
  renderSuggestions();
  return suggestions[normalizedIndex] ?? null;
};

const moveSuggestionHighlight = (direction) => {
  if (!suggestions.length) {
    return null;
  }

  const baseIndex = highlightedSuggestionIndex >= 0 ? highlightedSuggestionIndex : direction > 0 ? -1 : suggestions.length;
  const nextIndex = direction > 0
    ? (baseIndex + 1) % suggestions.length
    : (baseIndex - 1 + suggestions.length) % suggestions.length;
  return setSuggestionHighlight(nextIndex);
};

const getHighlightedSuggestion = () => (
  highlightedSuggestionIndex >= 0 && highlightedSuggestionIndex < suggestions.length
    ? suggestions[highlightedSuggestionIndex]
    : null
);

const dismissSuggestions = () => {
  shouldKeepSuggestionsClosed = true;
  isSuggestionsOpen = false;
  highlightedSuggestionIndex = -1;
  renderSuggestions();
};

const applySuggestions = (items, options = {}) => {
  suggestions = Array.isArray(items) ? [...items] : [];
  highlightedSuggestionIndex = -1;
  const keepClosed = options.keepClosed ?? shouldKeepSuggestionsClosed;
  isSuggestionsOpen = keepClosed ? false : suggestions.length > 0;
  shouldKeepSuggestionsClosed = false;
  renderSuggestions();
};

const closeSearchMenus = () => {
  setSearchTargetMenuOpen(false);
  dismissSuggestions();
};

const applySuggestionQueryToInput = (query) => {
  if (!(searchInput instanceof HTMLInputElement)) {
    return;
  }

  searchInput.value = query;
  searchInput.focus();
  searchInput.setSelectionRange(query.length, query.length);
};

const applyHighlightedSuggestionToInput = () => {
  const highlightedSuggestion = getHighlightedSuggestion();
  if (!highlightedSuggestion || highlightedSuggestion.type !== "query") {
    return false;
  }

  const query = normalizeTextValue(highlightedSuggestion.query);
  if (!query) {
    return false;
  }

  applySuggestionQueryToInput(query);
  isSuggestionsOpen = true;
  renderSuggestions();
  return true;
};

const executeSuggestionItem = async (item, options = {}) => {
  if (!item || typeof item !== "object") {
    return false;
  }

  const query = normalizeTextValue(item.query);
  if (!query) {
    return false;
  }

  const shouldExecuteQuery = options.executeQuery === true;

  if (item.type === "action") {
    const targetId = typeof item.targetId === "string" ? item.targetId : currentSearchTarget?.id ?? DEFAULT_SEARCH_TARGET_ID;
    currentSearchTarget = resolveSearchTarget(targetId);
    syncSearchTargetShell();
    await runSearchForTarget(query, currentSearchTarget.id);
    return true;
  }

  applySuggestionQueryToInput(query);
  dismissSuggestions();

  if (shouldExecuteQuery) {
    await runDefaultSearchFlow(query);
    return true;
  }

  shouldSkipNextSubmit = true;
  return false;
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

const scheduleSuggestionRefresh = (query) => {
  const normalizedQuery = query.trim();
  activeSuggestionRequestId += 1;
  const requestId = activeSuggestionRequestId;

  window.clearTimeout(suggestionRefreshTimeoutId);

  if (!normalizedQuery) {
    clearSuggestions();
    renderSuggestions();
    return;
  }

  const localItems = createLocalSuggestionItems(normalizedQuery, searchHistoryItems, availableSearchTargets);
  applySuggestions(localItems);

  suggestionRefreshTimeoutId = window.setTimeout(() => {
    fetchRemoteSuggestionItems(normalizedQuery)
      .then((remoteItems) => {
        if (requestId !== activeSuggestionRequestId) {
          return;
        }

        applySuggestions(mergeSuggestionItems(localItems, remoteItems));
      })
      .catch(() => {
        if (requestId !== activeSuggestionRequestId) {
          return;
        }

        applySuggestions(localItems);
      });
  }, SUGGESTION_REFRESH_DEBOUNCE);
};

const hideAiSearchPreview = () => {
  activeAiSearchPreview = null;

  if (aiSearchPreview instanceof HTMLElement) {
    aiSearchPreview.hidden = true;
  }

  if (aiSearchPreviewIntent instanceof HTMLElement) {
    aiSearchPreviewIntent.textContent = "";
    aiSearchPreviewIntent.hidden = true;
  }

  if (aiSearchPreviewSummary instanceof HTMLElement) {
    aiSearchPreviewSummary.textContent = "";
  }

  if (aiSearchPreviewOriginalQuery instanceof HTMLElement) {
    aiSearchPreviewOriginalQuery.textContent = "";
  }

  if (aiSearchPreviewTargetLabel instanceof HTMLElement) {
    aiSearchPreviewTargetLabel.textContent = "";
  }

  if (aiSearchPreviewTarget instanceof HTMLElement) {
    aiSearchPreviewTarget.textContent = "";
  }

  if (aiSearchPreviewRelated instanceof HTMLElement) {
    aiSearchPreviewRelated.hidden = true;
  }

  if (aiSearchPreviewSuggestions instanceof HTMLElement) {
    aiSearchPreviewSuggestions.innerHTML = "";
  }

  if (aiSearchPreviewWebsites instanceof HTMLElement) {
    aiSearchPreviewWebsites.hidden = true;
  }

  if (aiSearchPreviewWebsitesList instanceof HTMLElement) {
    aiSearchPreviewWebsitesList.innerHTML = "";
  }

  if (aiSearchPreviewAction instanceof HTMLButtonElement) {
    aiSearchPreviewAction.textContent = "";
    aiSearchPreviewAction.disabled = false;
    aiSearchPreviewAction.hidden = false;
  }

  if (aiSearchPreviewSecondaryAction instanceof HTMLButtonElement) {
    aiSearchPreviewSecondaryAction.textContent = "";
    aiSearchPreviewSecondaryAction.hidden = true;
  }
};

const resolveSearchTarget = (targetId = currentSearchTarget?.id ?? DEFAULT_SEARCH_TARGET_ID) =>
  getSearchTargetById(targetId) ?? currentSearchTarget ?? SEARCH_TARGETS[0];

const syncSearchTargetShell = () => {
  const activeTarget = resolveSearchTarget(currentSearchTarget?.id ?? DEFAULT_SEARCH_TARGET_ID);
  currentSearchTarget = activeTarget;

  if (searchTargetLabel instanceof HTMLElement) {
    searchTargetLabel.textContent = activeTarget.label;
  }

  Array.from(searchTargetMenu?.querySelectorAll("[data-target-id]") ?? [])
    .filter((element) => element instanceof HTMLElement)
    .forEach((element) => {
      const isActive = element.dataset.targetId === activeTarget.id;
      element.setAttribute("aria-selected", isActive ? "true" : "false");
      element.classList.toggle("is-active", isActive);
    });

  if (activeAiSearchPreview && !activeTarget.isGeneral) {
    hideAiSearchPreview();
    setSearchStatus("", "neutral");
  }

  setSearchTargetMenuOpen(false);
  isSuggestionsOpen = false;
  renderSuggestions();
};

const resolvePreviewSearchQuery = (action) => {
  const queryFromInput = normalizeTextValue(searchInput instanceof HTMLInputElement ? searchInput.value : "");
  if (shouldBypassAiForCurrentTarget()) {
    return queryFromInput || normalizeTextValue(activeAiSearchPreview?.originalQuery);
  }

  return normalizeTextValue(action?.target) || queryFromInput;
};

const runSearchForTarget = async (query, targetId = currentSearchTarget?.id ?? DEFAULT_SEARCH_TARGET_ID) => {
  const searchTarget = resolveSearchTarget(targetId);
  currentSearchTarget = searchTarget;
  await recordSearchHistoryEntry(query);
  window.location.href = searchTarget.buildSearchUrl(query);
};

const runPreviewAction = async (action) => {
  if (!action || typeof action !== "object") {
    return;
  }

  if (action.type === "open") {
    openUrlInNewTab(action.target);
    return;
  }

  if (action.type === "search") {
    const previewQuery = resolvePreviewSearchQuery(action);
    if (!previewQuery) {
      return;
    }

    await runSearchForTarget(previewQuery, currentSearchTarget?.id ?? DEFAULT_SEARCH_TARGET_ID);
  }
};

const triggerAiSearchToggle = () => {
  if (!(aiSearchEnabledInput instanceof HTMLInputElement)) {
    setSearchStatus("设置项未就绪，请稍后重试。", "error");
    return;
  }

  if (isAiSearchPending || isAiSearchActivating) {
    return;
  }

  aiSearchEnabledInput.checked = !aiSearchEnabledInput.checked;
  aiSearchEnabledInput.dispatchEvent(new Event("change", { bubbles: true }));
};

const buildAiSearchPreview = (decision, originalQuery) => {
  const normalizedOriginalQuery = originalQuery.trim().toLowerCase();
  const normalizedTarget = normalizeTextValue(decision.target).toLowerCase();
  const isQueryChanged = normalizedOriginalQuery !== normalizedTarget;
  const websites = uniqueWebsiteCandidates(decision.websites ?? []).slice(0, WEBSITE_RESULT_LIMIT);
  const relatedQueries = uniqueTextList(decision.relatedQueries ?? []).filter((query) => {
    const normalizedQuery = query.trim().toLowerCase();
    return normalizedQuery && normalizedQuery !== normalizedTarget && normalizedQuery !== normalizedOriginalQuery;
  }).slice(0, 4);

  if (decision.mode === "open") {
    return {
      originalQuery,
      intent: decision.intent,
      target: decision.target,
      refinedQuery: decision.target,
      websites,
      summary: decision.summary || "识别为可直接打开的目标。",
      targetLabel: "目标地址",
      primaryAction: {
        type: "open",
        target: decision.target,
        label: "直接打开",
      },
      secondaryAction: normalizedOriginalQuery && normalizedOriginalQuery !== normalizedTarget
        ? {
          type: "search",
            target: originalQuery,
            label: "改为搜索原词",
          }
        : null,
      relatedQueries,
      readyMessage: websites.length
        ? "方案已就绪，可直接打开或改为搜索。"
        : relatedQueries.length
          ? "方案已就绪，可直接打开或切换方向。"
          : "方案已就绪，按回车继续。",
    };
  }

  const summary = decision.summary || (websites.length
    ? "已生成细化搜索词，并附带候选网站。"
    : isQueryChanged
      ? relatedQueries.length
        ? "已将搜索词收敛，并补充了相关方向。"
        : "已将搜索词收敛为更明确的表达。"
      : relatedQueries.length
        ? "主搜索词保持不变，并补充了相关方向。"
        : "搜索词可直接使用。");

  return {
    originalQuery,
    intent: decision.intent,
    target: decision.target,
    refinedQuery: decision.target,
    websites,
    summary,
    targetLabel: isQueryChanged ? "细化搜索词" : "搜索词",
    primaryAction: {
      type: "search",
      target: decision.target,
      label: isQueryChanged ? "搜索细化词" : "搜索该词",
    },
    secondaryAction: isQueryChanged
      ? {
          type: "search",
          target: originalQuery,
          label: "搜索原词",
        }
      : null,
    relatedQueries,
    readyMessage: websites.length
      ? "方案已就绪，可直接搜索或打开候选网站。"
      : relatedQueries.length
        ? "方案已就绪，可继续搜索或切换相关词。"
        : "方案已就绪，按回车继续。",
  };
};

const showAiSearchPreview = (preview) => {
  activeAiSearchPreview = preview;

  if (aiSearchPreviewIntent instanceof HTMLElement) {
    aiSearchPreviewIntent.textContent = preview.intent || "";
    aiSearchPreviewIntent.hidden = !preview.intent;
  }

  if (aiSearchPreviewSummary instanceof HTMLElement) {
    aiSearchPreviewSummary.textContent = preview.summary;
  }

  if (aiSearchPreviewOriginalQuery instanceof HTMLElement) {
    aiSearchPreviewOriginalQuery.textContent = preview.originalQuery;
  }

  if (aiSearchPreviewTargetLabel instanceof HTMLElement) {
    aiSearchPreviewTargetLabel.textContent = preview.targetLabel;
  }

  if (aiSearchPreviewTarget instanceof HTMLElement) {
    aiSearchPreviewTarget.textContent = preview.target;
  }

  if (aiSearchPreviewAction instanceof HTMLButtonElement) {
    aiSearchPreviewAction.textContent = preview.primaryAction.label;
    aiSearchPreviewAction.disabled = false;
    aiSearchPreviewAction.hidden = false;
  }

  if (aiSearchPreviewSecondaryAction instanceof HTMLButtonElement) {
    if (preview.secondaryAction) {
      aiSearchPreviewSecondaryAction.textContent = preview.secondaryAction.label;
      aiSearchPreviewSecondaryAction.hidden = false;
    } else {
      aiSearchPreviewSecondaryAction.textContent = "";
      aiSearchPreviewSecondaryAction.hidden = true;
    }
  }

  if (aiSearchPreviewSuggestions instanceof HTMLElement) {
    aiSearchPreviewSuggestions.innerHTML = "";

    preview.relatedQueries.forEach((query) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ai-search-preview-suggestion";
      button.textContent = query;
      button.dataset.query = query;
      aiSearchPreviewSuggestions.appendChild(button);
    });
  }

  if (aiSearchPreviewRelated instanceof HTMLElement) {
    aiSearchPreviewRelated.hidden = preview.relatedQueries.length === 0 || preview.websites.length > 0;
  }

  if (aiSearchPreviewWebsitesList instanceof HTMLElement) {
    aiSearchPreviewWebsitesList.innerHTML = "";

    preview.websites.forEach((website) => {
      const card = document.createElement("article");
      card.className = "ai-search-preview-website-card";

      const header = document.createElement("div");
      header.className = "ai-search-preview-website-header";

      const meta = document.createElement("div");

      const title = document.createElement("h3");
      title.className = "ai-search-preview-website-title";
      title.textContent = website.title;
      meta.appendChild(title);

      const host = document.createElement("p");
      host.className = "ai-search-preview-website-host";
      host.textContent = website.host || website.url;
      meta.appendChild(host);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "ai-search-preview-website-button";
      button.textContent = "新标签页打开";
      button.dataset.url = website.url;

      header.append(meta, button);
      card.appendChild(header);

      const description = document.createElement("p");
      description.className = "ai-search-preview-website-description";
      description.textContent = website.description || "在新标签页打开该站点。";
      card.appendChild(description);

      aiSearchPreviewWebsitesList.appendChild(card);
    });
  }

  if (aiSearchPreviewWebsites instanceof HTMLElement) {
    aiSearchPreviewWebsites.hidden = preview.websites.length === 0;
  }

  if (aiSearchPreview instanceof HTMLElement) {
    aiSearchPreview.hidden = false;
  }

  const firstWebsiteButton = aiSearchPreviewWebsitesList instanceof HTMLElement
    ? aiSearchPreviewWebsitesList.querySelector("button[data-url]")
    : null;

  if (firstWebsiteButton instanceof HTMLButtonElement) {
    firstWebsiteButton.focus();
  } else if (aiSearchPreviewAction instanceof HTMLButtonElement) {
    aiSearchPreviewAction.focus();
  }
};

const runActiveAiSearchPreview = async () => {
  if (!activeAiSearchPreview) {
    return;
  }

  await runPreviewAction(activeAiSearchPreview.primaryAction);
};

const renderAiSearchIndicator = () => {
  if (!(aiSearchIndicator instanceof HTMLElement) || !(aiSearchIndicatorText instanceof HTMLElement)) {
    return;
  }

  const state = isAiSearchPending
    ? "searching"
    : isAiSearchActivating
      ? "activating"
      : isAiSearchEnabled
        ? "ready"
        : "off";
  aiSearchIndicator.dataset.state = state;
  document.body.classList.toggle("is-ai-search-enabled", isAiSearchEnabled);
  document.body.classList.toggle("is-ai-search-searching", isAiSearchPending);
  document.body.classList.toggle("is-ai-search-activating", isAiSearchActivating);

  if (aiToggleButton instanceof HTMLButtonElement) {
    aiToggleButton.setAttribute("aria-pressed", isAiSearchEnabled ? "true" : "false");
    aiToggleButton.setAttribute("aria-label", isAiSearchActivating ? "AI搜索增强启用中" : isAiSearchEnabled ? "关闭AI搜索增强" : "开启AI搜索增强");
  }

  if (state === "searching") {
    aiSearchIndicatorText.textContent = "AI 正在生成搜索方案…";
    aiSearchIndicator.setAttribute("aria-label", "AI 正在生成搜索方案");
    return;
  }

  if (state === "activating") {
    aiSearchIndicatorText.textContent = "AI 搜索增强启用中…";
    aiSearchIndicator.setAttribute("aria-label", "AI 搜索增强启用中");
    return;
  }

  if (state === "ready") {
    aiSearchIndicatorText.textContent = "";
    aiSearchIndicator.setAttribute("aria-label", "");
    return;
  }

  aiSearchIndicatorText.textContent = "";
  aiSearchIndicator.setAttribute("aria-label", "");
};

const syncAiSearchEnabled = (enabled) => {
  isAiSearchEnabled = enabled;
  if (enabled) {
    isAiSearchActivating = false;
  }

  if (!enabled) {
    isAiSearchPending = false;
    isAiSearchActivating = false;
    hideAiSearchPreview();
  }

  renderAiSearchIndicator();
};

const syncAiSearchActivating = (activating) => {
  isAiSearchActivating = Boolean(activating) && !isAiSearchPending;
  renderAiSearchIndicator();
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

const setSearchPending = (pending) => {
  if (searchForm instanceof HTMLElement) {
    searchForm.classList.toggle("is-pending", pending);
  }

  isAiSearchPending = pending && isAiSearchEnabled;
  if (pending) {
    isAiSearchActivating = false;
  }

  if (pending) {
    hideAiSearchPreview();
  }

  renderAiSearchIndicator();

  if (searchInput instanceof HTMLInputElement) {
    searchInput.disabled = pending;
    if (pending) {
      searchInput.setAttribute("aria-busy", "true");
    } else {
      searchInput.removeAttribute("aria-busy");
    }
  }
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

const normalizeAssistantDecisionText = (value) => {
  const normalizedText = unwrapJsonFence(value);
  if (looksLikeHtmlDocument(normalizedText)) {
    throw createHtmlResponseError();
  }

  if (AI_REFUSAL_PATTERN.test(normalizedText)) {
    throw createAiRefusalError();
  }

  const directPayload = parseJsonSafely(normalizedText);
  if (directPayload) {
    return normalizeSearchDecision(directPayload);
  }

  const firstBraceIndex = normalizedText.indexOf("{");
  const lastBraceIndex = normalizedText.lastIndexOf("}");
  if (firstBraceIndex !== -1 && lastBraceIndex > firstBraceIndex) {
    const embeddedPayload = parseJsonSafely(normalizedText.slice(firstBraceIndex, lastBraceIndex + 1));
    if (embeddedPayload) {
      return normalizeSearchDecision(embeddedPayload);
    }
  }

  const openTarget = resolveNavigationTarget(normalizedText);
  if (openTarget) {
    return { mode: "open", target: openTarget };
  }

  if (isLikelySearchQueryText(normalizedText)) {
    return { mode: "search", target: normalizedText };
  }

  throw createAiDecisionFormatError();
};

const extractChoiceText = (choice) => {
  if (!choice || typeof choice !== "object") {
    return "";
  }

  if (typeof choice.text === "string") {
    return choice.text;
  }

  const message = choice.message && typeof choice.message === "object" ? choice.message : null;
  const delta = choice.delta && typeof choice.delta === "object" ? choice.delta : null;
  const content = message?.content ?? delta?.content ?? "";

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }

        if (typeof item.text === "string") {
          return item.text;
        }

        if (item.type === "text" && typeof item.content === "string") {
          return item.content;
        }

        return "";
      })
      .join("");
  }

  return "";
};

const extractAssistantText = (payload) => {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const firstChoice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  return extractChoiceText(firstChoice).trim();
};

const normalizeChatCompletionsDecision = (payload) => {
  const assistantText = extractAssistantText(payload);
  if (!assistantText) {
    throw new Error("chat/completions 没有返回可用内容");
  }

  return normalizeAssistantDecisionText(assistantText);
};

const normalizeChatCompletionsStream = (rawText) => {
  const streamText = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]")
    .map((line) => parseJsonSafely(line))
    .filter(Boolean)
    .map((payload) => {
      const firstChoice = Array.isArray(payload.choices) ? payload.choices[0] : null;
      return extractChoiceText(firstChoice);
    })
    .join("")
    .trim();

  if (!streamText) {
    throw new Error("chat/completions 流式返回中没有可用内容");
  }

  return normalizeAssistantDecisionText(streamText);
};

const normalizeResponseError = (status, rawText) => {
  const payload = parseJsonSafely(rawText);
  const errorMessage = payload && typeof payload === "object"
    ? payload.error?.message ?? payload.message ?? ""
    : "";
  const preview = (errorMessage || rawText || "").trim();

  if (status >= 500 && looksLikeHtmlDocument(preview)) {
    return `搜索接口上游暂时不可用（${status}）：${looksLikeGatewayErrorPage(preview) ? "网关返回了错误页面" : "服务端返回了 HTML 错误页"}`;
  }

  if (looksLikeHtmlDocument(preview)) {
    return createHtmlResponseError().message;
  }

  if (status === 403 && /1010/.test(preview)) {
    return "搜索接口被服务端拦截（403 / error code: 1010）";
  }

  if (preview) {
    return `搜索接口请求失败（${status}）：${preview.slice(0, 200)}`;
  }

  return `搜索接口请求失败（${status}）`;
};

const normalizeApiDecision = (rawText, settings) => {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("搜索接口返回为空");
  }

  if (looksLikeHtmlDocument(trimmed)) {
    throw createHtmlResponseError();
  }

  const directPayload = parseJsonSafely(trimmed);
  if (directPayload) {
    if (isChatCompletionsEndpoint(settings.endpoint) && Array.isArray(directPayload.choices)) {
      return normalizeChatCompletionsDecision(directPayload);
    }

    return normalizeSearchDecision(directPayload);
  }

  if (isChatCompletionsEndpoint(settings.endpoint) && /^data:/m.test(trimmed)) {
    return normalizeChatCompletionsStream(trimmed);
  }

  return normalizeAssistantDecisionText(trimmed);
};

const shouldRetryTransientFailure = (status, rawText) => {
  if ([429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  const preview = rawText.toLowerCase();
  return preview.includes("upstream_error")
    || /\b429\b/.test(preview)
    || preview.includes("temporarily unavailable")
    || preview.includes("try again later");
};

const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

const buildChatCompletionBodies = (query, settings) => {
  return [{
    model: settings.model,
    messages: [
      { role: "user", content: buildDecisionUserPrompt(query) },
    ],
    temperature: 0,
    stream: false,
  }];
};

const requestAiSearchDecision = async (query, settings) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), SEARCH_REQUEST_TIMEOUT);

  try {
    const originPattern = resolveOriginPatternSafely(settings.endpoint, "搜索接口地址无效，请重新在设置里填写。");
    await ensureOriginPermission(originPattern, "未授予该搜索接口域名权限，无法调用 AI 搜索。");

    const headers = {
      "Content-Type": "application/json",
      Accept: "*/*",
      "X-Title": "Moon Tab",
    };

    if (settings.apiKey) {
      headers.Authorization = `Bearer ${settings.apiKey}`;
    }

    const effectiveEndpoint = isChatCompletionsEndpoint(settings.endpoint)
      ? resolveChatCompletionsEndpoint(settings.endpoint)
      : settings.endpoint;

    const requestBodies = isChatCompletionsEndpoint(settings.endpoint)
      ? buildChatCompletionBodies(query, settings)
      : [{ query }];

    let lastError = null;
    for (let index = 0; index < requestBodies.length; index += 1) {
      const requestBody = requestBodies[index];
      const transientAttempts = TRANSIENT_RETRY_DELAYS.length + 1;

      for (let attempt = 0; attempt < transientAttempts; attempt += 1) {
        const response = await fetch(effectiveEndpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        const rawText = await response.text();
        if (response.ok) {
          return normalizeApiDecision(rawText, { ...settings, endpoint: effectiveEndpoint });
        }

        lastError = new Error(normalizeResponseError(response.status, rawText));

        const canRetryTransiently = attempt < TRANSIENT_RETRY_DELAYS.length && shouldRetryTransientFailure(response.status, rawText);
        if (canRetryTransiently) {
          await delay(TRANSIENT_RETRY_DELAYS[attempt]);
          continue;
        }

        throw lastError;
      }
    }

    if (lastError) {
      throw lastError;
    }

    throw new Error("搜索接口请求失败");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("搜索接口请求超时");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

if (searchForm instanceof HTMLFormElement && searchInput instanceof HTMLInputElement) {
  if (aiToggleButton instanceof HTMLButtonElement) {
    aiToggleButton.addEventListener("click", () => {
      triggerAiSearchToggle();
    });
  }

  if (aiSearchPreviewAction instanceof HTMLButtonElement) {
    aiSearchPreviewAction.addEventListener("click", () => {
      void runActiveAiSearchPreview();
    });
  }

  if (aiSearchPreviewSecondaryAction instanceof HTMLButtonElement) {
    aiSearchPreviewSecondaryAction.addEventListener("click", () => {
      if (!activeAiSearchPreview?.secondaryAction) {
        return;
      }

      void runPreviewAction(activeAiSearchPreview.secondaryAction);
    });
  }

  if (aiSearchPreviewSuggestions instanceof HTMLElement) {
    aiSearchPreviewSuggestions.addEventListener("click", (event) => {
      const target = event.target instanceof HTMLElement ? event.target.closest("button[data-query]") : null;
      if (!(target instanceof HTMLButtonElement)) {
        return;
      }

      const query = target.dataset.query?.trim();
      if (!query) {
        return;
      }

      void runPreviewAction({ type: "search", target: query });
    });
  }

  if (aiSearchPreviewWebsitesList instanceof HTMLElement) {
    aiSearchPreviewWebsitesList.addEventListener("click", (event) => {
      const target = event.target instanceof HTMLElement ? event.target.closest("button[data-url]") : null;
      if (!(target instanceof HTMLButtonElement)) {
        return;
      }

      const url = target.dataset.url?.trim();
      if (!url) {
        return;
      }

      openUrlInNewTab(url);
    });
  }

  if (searchTargetTrigger instanceof HTMLButtonElement) {
    searchTargetTrigger.addEventListener("click", () => {
      const willOpen = searchTargetMenu instanceof HTMLElement ? searchTargetMenu.hidden : true;
      setSearchTargetMenuOpen(willOpen);
    });
  }

  if (searchTargetMenu instanceof HTMLElement) {
    searchTargetMenu.addEventListener("click", (event) => {
      const target = event.target instanceof HTMLElement ? event.target.closest("button[data-target-id]") : null;
      if (!(target instanceof HTMLButtonElement)) {
        return;
      }

      currentSearchTarget = resolveSearchTarget(target.dataset.targetId);
      syncSearchTargetShell();
    });
  }

  if (searchSuggestions instanceof HTMLElement) {
    searchSuggestions.addEventListener("click", (event) => {
      const target = event.target instanceof HTMLElement ? event.target.closest("button[data-index]") : null;
      if (!(target instanceof HTMLButtonElement)) {
        return;
      }

      const suggestionIndex = Number.parseInt(target.dataset.index ?? "", 10);
      if (!Number.isInteger(suggestionIndex) || suggestionIndex < 0 || suggestionIndex >= suggestions.length) {
        return;
      }

      void executeSuggestionItem(suggestions[suggestionIndex], { executeQuery: true });
    });
  }

  if (searchInput instanceof HTMLInputElement) {
    searchInput.addEventListener("keydown", (event) => {
      const isTargetMenuOpen = searchTargetMenu instanceof HTMLElement && !searchTargetMenu.hidden;
      const isSuggestionListVisible = isSuggestionsOpen && suggestions.length > 0;

      if (event.key === "ArrowDown" && isSuggestionListVisible) {
        event.preventDefault();
        moveSuggestionHighlight(1);
        return;
      }

      if (event.key === "ArrowUp" && isSuggestionListVisible) {
        event.preventDefault();
        moveSuggestionHighlight(-1);
        return;
      }

      if (event.key === "Tab" && isSuggestionListVisible) {
        const highlightedSuggestion = getHighlightedSuggestion();
        if (highlightedSuggestion?.type === "query") {
          event.preventDefault();
          applyHighlightedSuggestionToInput();
        }
        return;
      }

      if (event.key === "Escape") {
        if (isTargetMenuOpen || isSuggestionListVisible) {
          event.preventDefault();
          closeSearchMenus();
        }
        return;
      }

      if (event.key === "Enter" && isSuggestionListVisible) {
        const directTarget = resolveDirectNavigationTarget(searchInput.value);
        if (directTarget) {
          return;
        }

        const highlightedSuggestion = getHighlightedSuggestion();
        if (highlightedSuggestion) {
          event.preventDefault();
          void executeSuggestionItem(highlightedSuggestion, { executeQuery: true });
          return;
        }
      }
    });
  }

  searchInput.addEventListener("focus", () => {
    if (!suggestions.length) {
      return;
    }

    isSuggestionsOpen = true;
    renderSuggestions();
  });

  searchInput.addEventListener("blur", () => {
    window.setTimeout(() => {
      const activeElement = document.activeElement;
      const isWithinSuggestions = activeElement instanceof Node && searchSuggestions instanceof HTMLElement && searchSuggestions.contains(activeElement);
      const isWithinTargetMenu = activeElement instanceof Node && searchTargetMenu instanceof HTMLElement && searchTargetMenu.contains(activeElement);
      const isTargetTriggerFocused = activeElement === searchTargetTrigger;
      if (isWithinSuggestions || isWithinTargetMenu || isTargetTriggerFocused) {
        return;
      }

      closeSearchMenus();
    }, 120);
  });

  searchInput.addEventListener("input", () => {
    const query = searchInput.value.trim();

    if (activeAiSearchPreview && query !== activeAiSearchPreview.originalQuery) {
      hideAiSearchPreview();
      setSearchStatus("", "neutral");
    }

    scheduleSuggestionRefresh(query);
  });

  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    const clickedInsideSuggestions = searchSuggestions instanceof HTMLElement && searchSuggestions.contains(target);
    const clickedInsideTargetMenu = searchTargetMenu instanceof HTMLElement && searchTargetMenu.contains(target);
    const clickedTargetTrigger = searchTargetTrigger instanceof HTMLElement && searchTargetTrigger.contains(target);
    const clickedSearchInput = searchInput.contains(target);

    if (!clickedInsideSuggestions && !clickedInsideTargetMenu && !clickedTargetTrigger && !clickedSearchInput) {
      closeSearchMenus();
    }
  });

  searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (shouldSkipNextSubmit) {
      shouldSkipNextSubmit = false;
      return;
    }

    const query = searchInput.value.trim();
    if (!query) {
      hideAiSearchPreview();
      setSearchStatus("请输入要搜索或打开的内容。", "error");
      searchInput.focus();
      return;
    }

    let settings;
    try {
      settings = await getStoredSearchSettings();
    } catch (error) {
      setSearchStatus(error instanceof Error ? error.message : "读取设置失败", "error");
      return;
    }

    if (!shouldUseAiSearchFlow(settings)) {
      hideAiSearchPreview();
      await runDefaultSearchFlow(query);
      return;
    }

    if (activeAiSearchPreview && activeAiSearchPreview.originalQuery === query) {
      await runActiveAiSearchPreview();
      return;
    }

    if (!settings.endpoint) {
      hideAiSearchPreview();
      setSearchStatus("请先在设置里填写搜索接口地址，再开启 AI 搜索增强。", "error");
      return;
    }

    if (isChatCompletionsEndpoint(settings.endpoint) && !settings.model) {
      hideAiSearchPreview();
      setSearchStatus("chat/completions 接口需要先在设置里填写模型名称。", "error");
      return;
    }

    setSearchStatus("", "neutral");
    setSearchPending(true);

    let shouldRunFallbackSearch = false;

    try {
      const decision = preserveMixedLanguageSearchTerms(
        enrichNoOpSearchDecision(await requestAiSearchDecision(query, settings), query),
        query,
      );
      let websites = [];
      let websiteWarning = "";

      try {
        websites = await resolveDecisionWebsites(query, decision, settings);
      } catch (error) {
        websiteWarning = error instanceof Error ? error.message : "候选网站暂时不可用";
      }

      const preview = buildAiSearchPreview({ ...decision, websites }, query);
      showAiSearchPreview(preview);

      if (websiteWarning) {
        setSearchStatus(`${preview.readyMessage} 候选网站暂未加载，仍可继续搜索。`, "neutral");
      } else {
        setSearchStatus(preview.readyMessage, "neutral");
      }
    } catch (error) {
      hideAiSearchPreview();
      setSearchStatus("AI 搜索增强暂时不可用，已切换为普通搜索。", "neutral");
      shouldRunFallbackSearch = true;
    } finally {
      setSearchPending(false);

      if (shouldRunFallbackSearch) {
        void runDefaultSearchFlow(query);
      }
    }
  });
}

const applySearchReadyState = () => {
  if (searchInput instanceof HTMLInputElement) {
    searchInput.disabled = false;
    searchInput.removeAttribute("aria-disabled");
  }

  document.body.classList.add("is-search-ready");
  window.requestAnimationFrame(() => {
    focusSearchInputIfIdle();
  });
};

const applyReadyState = () => {
  window.setTimeout(() => {
    document.body.classList.add("is-ready");
  }, PLACEHOLDER_FADE_DURATION + MODULE_REVEAL_DELAY);
};

const applyReducedMotionReadyState = () => {
  document.body.classList.add("is-ready");
};

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const syncSearchOutline = () => {
  if (!(searchFrame instanceof HTMLElement) || !(searchOutline instanceof SVGSVGElement) || !(searchOutlineRect instanceof SVGRectElement)) {
    return 0;
  }

  const rect = searchFrame.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const strokeWidth = SEARCH_OUTLINE_STROKE_WIDTH;
  const inset = SEARCH_OUTLINE_INSET;
  const halfStroke = strokeWidth / 2;
  const x = inset + halfStroke;
  const y = inset + halfStroke;
  const outlineWidth = Math.max(1, width - inset * 2 - strokeWidth);
  const outlineHeight = Math.max(1, height - inset * 2 - strokeWidth);
  const radius = Math.max(0, outlineHeight / 2 - halfStroke);

  searchOutline.setAttribute("viewBox", `0 0 ${width} ${height}`);
  searchOutlineRect.style.strokeWidth = String(strokeWidth);
  searchOutlineRect.setAttribute("x", String(x));
  searchOutlineRect.setAttribute("y", String(y));
  searchOutlineRect.setAttribute("width", String(outlineWidth));
  searchOutlineRect.setAttribute("height", String(outlineHeight));
  searchOutlineRect.setAttribute("rx", String(radius));
  searchOutlineRect.setAttribute("ry", String(radius));

  const length = searchOutlineRect.getTotalLength();
  searchOutlineRect.style.strokeDasharray = `${length}`;
  searchOutlineRect.style.strokeDashoffset = `${length}`;
  return length;
};

const setOutlineComplete = () => {
  if (searchOutlineRect instanceof SVGRectElement) {
    searchOutlineRect.style.strokeDashoffset = "0";
  }
};

const playSearchTrace = () => {
  const length = syncSearchOutline();
  if (!length || !(searchOutlineRect instanceof SVGRectElement)) {
    applyReadyState();
    return;
  }

  const traceAnimation = searchOutlineRect.animate(
    [{ strokeDashoffset: length }, { strokeDashoffset: 0 }],
    {
      duration: SEARCH_TRACE_DURATION,
      easing: "cubic-bezier(0.35, 0, 0.15, 1)",
      fill: "forwards",
    },
  );

  traceAnimation.finished
    .then(() => {
      setOutlineComplete();
      applyReadyState();
    })
    .catch(() => {
      setOutlineComplete();
      applyReadyState();
    });
};

initializeSettingsUi({
  setSearchStatus,
  syncAiSearchEnabled,
  syncAiSearchActivating,
});
syncRenderedSearchUi();
syncSearchTargetShell();
renderAiSearchIndicator();
void readSearchHistory(extensionApi).then((items) => {
  searchHistoryItems = Array.isArray(items) ? [...items] : [];
});
initializeLiquidGlassBubbleLayer({
  root: homepageBubbleLayer,
  prefersReducedMotionQuery: prefersReducedMotion,
});
applySearchReadyState();

if (prefersReducedMotion.matches) {
  syncSearchOutline();
  setOutlineComplete();
  applyReducedMotionReadyState();
} else {
  window.requestAnimationFrame(playSearchTrace);
}

window.addEventListener("resize", () => {
  const length = syncSearchOutline();
  if (document.body.classList.contains("is-search-ready") && length) {
    setOutlineComplete();
  }
});
