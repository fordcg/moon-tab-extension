import { buildAiSearchPreview, createAiPreviewService } from "./ai-preview-service.mjs";
import { DEFAULT_SEARCH_TARGET_ID } from "./helpers/search-targets.mjs";
import { normalizeTextValue } from "./helpers/query-utils.mjs";

export const createAiPreviewController = ({ elements, callbacks, deps, config = {} }) => {
  const {
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
    aiSearchPreviewWebsitesLabel,
    aiSearchPreviewWebsitesList,
    aiSearchPreviewRelated,
    aiSearchPreviewSuggestions,
    aiSearchPreviewAction,
    aiSearchPreviewSecondaryAction,
  } = elements;
  const {
    openUrlInNewTab,
    runSearchForTarget,
    runDefaultSearchFlow,
    getCurrentSearchTarget,
    shouldBypassAiForCurrentTarget,
    getCurrentInputQuery,
    setSearchStatus,
  } = callbacks;
  const aiPreviewService = createAiPreviewService({ deps, config });

  let isAiSearchEnabled = false;
  let isAiSearchPending = false;
  let isAiSearchActivating = false;
  let activeAiSearchPreview = null;

  const submitSearch = async ({ query, settings }) => {
    setSearchStatus("", "neutral");
    setPending(true);

    let shouldRunFallbackSearch = false;

    try {
      const decision = await aiPreviewService.requestAiSearchDecision(query, settings);
      let websites = [];
      let websiteWarning = "";

      try {
        websites = await aiPreviewService.resolveDecisionWebsites(query, decision, settings);
      } catch (error) {
        websiteWarning = error instanceof Error ? error.message : "候选网站暂时不可用";
      }

      const preview = showPreviewFromDecision({ ...decision, websites }, query);
      setSearchStatus(
        websiteWarning ? `${preview.readyMessage} 候选网站暂未加载，仍可继续搜索。` : preview.readyMessage,
        "neutral",
      );
    } catch (_error) {
      hidePreview();
      setSearchStatus("AI增强搜索暂时不可用，已切换为普通搜索。", "neutral");
      shouldRunFallbackSearch = true;
    } finally {
      setPending(false);

      if (shouldRunFallbackSearch) {
        void runDefaultSearchFlow(query);
      }
    }
  };

  const hidePreview = () => {
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
      aiSearchPreviewSuggestions.replaceChildren();
    }

    if (aiSearchPreviewWebsites instanceof HTMLElement) {
      aiSearchPreviewWebsites.hidden = true;
      if (aiSearchPreviewWebsites instanceof HTMLDetailsElement) {
        aiSearchPreviewWebsites.open = false;
      }
    }

    if (aiSearchPreviewWebsitesList instanceof HTMLElement) {
      aiSearchPreviewWebsitesList.replaceChildren();
    }

    if (aiSearchPreviewWebsitesLabel instanceof HTMLElement) {
      aiSearchPreviewWebsitesLabel.textContent = "候选网站";
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

  const resolvePreviewSearchQuery = (action) => {
    const queryFromInput = normalizeTextValue(getCurrentInputQuery());
    if (shouldBypassAiForCurrentTarget()) {
      return queryFromInput || normalizeTextValue(activeAiSearchPreview?.originalQuery);
    }

    return normalizeTextValue(action?.target) || queryFromInput;
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

      const activeTarget = getCurrentSearchTarget();
      await runSearchForTarget(previewQuery, activeTarget?.id ?? DEFAULT_SEARCH_TARGET_ID);
    }
  };

  const createSuggestionButton = (query) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ai-search-preview-suggestion";
    button.textContent = query;
    button.dataset.query = query;
    return button;
  };

  const createWebsiteCard = (website) => {
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

    return card;
  };

  const showPreview = (preview) => {
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
      aiSearchPreviewSuggestions.replaceChildren(...preview.relatedQueries.map(createSuggestionButton));
    }

    if (aiSearchPreviewRelated instanceof HTMLElement) {
      aiSearchPreviewRelated.hidden = preview.relatedQueries.length === 0 || preview.websites.length > 0;
    }

    if (aiSearchPreviewWebsitesList instanceof HTMLElement) {
      aiSearchPreviewWebsitesList.replaceChildren(...preview.websites.map(createWebsiteCard));
    }

    if (aiSearchPreviewWebsites instanceof HTMLElement) {
      aiSearchPreviewWebsites.hidden = preview.websites.length === 0;
      if (aiSearchPreviewWebsites instanceof HTMLDetailsElement) {
        aiSearchPreviewWebsites.open = false;
      }
    }

    if (aiSearchPreviewWebsitesLabel instanceof HTMLElement) {
      aiSearchPreviewWebsitesLabel.textContent = preview.websites.length
        ? `候选网站（${preview.websites.length}）`
        : "候选网站";
    }

    if (aiSearchPreview instanceof HTMLElement) {
      aiSearchPreview.hidden = false;
    }

    if (aiSearchPreviewAction instanceof HTMLButtonElement) {
      aiSearchPreviewAction.focus();
    }
  };

  const showPreviewFromDecision = (decision, originalQuery) => {
    const preview = buildAiSearchPreview(decision, originalQuery);
    showPreview(preview);
    return preview;
  };

  const runActivePreview = async () => {
    if (!activeAiSearchPreview) {
      return;
    }

    await runPreviewAction(activeAiSearchPreview.primaryAction);
  };

  const renderIndicator = () => {
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
      aiToggleButton.setAttribute("aria-label", "切换AI增强搜索");
    }

    if (state === "searching") {
      aiSearchIndicatorText.textContent = "AI 正在生成搜索方案…";
      aiSearchIndicator.setAttribute("aria-label", "AI 正在生成搜索方案");
      return;
    }

    if (state === "activating") {
      aiSearchIndicatorText.textContent = "AI增强搜索启用中…";
      aiSearchIndicator.setAttribute("aria-label", "AI增强搜索启用中");
      return;
    }

    aiSearchIndicatorText.textContent = "";
    aiSearchIndicator.setAttribute("aria-label", "");
  };

  const syncEnabled = (enabled) => {
    isAiSearchEnabled = enabled;
    if (enabled) {
      isAiSearchActivating = false;
    }

    if (!enabled) {
      isAiSearchPending = false;
      isAiSearchActivating = false;
      hidePreview();
    }

    renderIndicator();
  };

  const syncActivating = (activating) => {
    isAiSearchActivating = Boolean(activating) && !isAiSearchPending;
    renderIndicator();
  };

  const setPending = (pending) => {
    if (searchForm instanceof HTMLElement) {
      searchForm.classList.toggle("is-pending", pending);
    }

    isAiSearchPending = pending && isAiSearchEnabled;
    if (pending) {
      isAiSearchActivating = false;
      hidePreview();
    }

    renderIndicator();

    if (searchInput instanceof HTMLInputElement) {
      searchInput.disabled = pending;
      if (pending) {
        searchInput.setAttribute("aria-busy", "true");
      } else {
        searchInput.removeAttribute("aria-busy");
      }
    }
  };

  const hasActivePreviewForQuery = (query) => Boolean(activeAiSearchPreview && activeAiSearchPreview.originalQuery === query);

  const clearPreviewIfQueryChanged = (query) => {
    if (activeAiSearchPreview && query !== activeAiSearchPreview.originalQuery) {
      hidePreview();
      if (searchStatus instanceof HTMLElement) {
        searchStatus.textContent = "";
        searchStatus.dataset.tone = "neutral";
        searchStatus.hidden = true;
      }
      return true;
    }

    return false;
  };

  const handlePrimaryAction = async () => {
    await runActivePreview();
  };

  const handleSecondaryAction = async () => {
    if (!activeAiSearchPreview?.secondaryAction) {
      return;
    }

    await runPreviewAction(activeAiSearchPreview.secondaryAction);
  };

  const handleRelatedQueryClick = async (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-query]") : null;
    if (!(target instanceof HTMLButtonElement)) {
      return false;
    }

    const query = target.dataset.query?.trim();
    if (!query) {
      return false;
    }

    await runPreviewAction({ type: "search", target: query });
    return true;
  };

  const handleWebsiteClick = (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-url]") : null;
    if (!(target instanceof HTMLButtonElement)) {
      return false;
    }

    const url = target.dataset.url?.trim();
    if (!url) {
      return false;
    }

    openUrlInNewTab(url);
    return true;
  };

  return {
    hidePreview,
    showPreviewFromDecision,
    runActivePreview,
    renderIndicator,
    syncEnabled,
    syncActivating,
    setPending,
    isPending: () => isAiSearchPending || isAiSearchActivating,
    getActivePreview: () => activeAiSearchPreview,
    hasActivePreviewForQuery,
    clearPreviewIfQueryChanged,
    handlePrimaryAction,
    handleSecondaryAction,
    handleRelatedQueryClick,
    handleWebsiteClick,
    submitSearch,
  };
};
