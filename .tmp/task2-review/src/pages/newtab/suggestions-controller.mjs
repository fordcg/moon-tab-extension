export const createSuggestionsController = ({ elements, deps, callbacks, constants = {} }) => {
  const { searchInput, searchSuggestions } = elements;
  const {
    normalizeTextValue,
    resolveDirectNavigationTarget,
    createLocalSuggestionItems,
    fetchRemoteSuggestionItems,
    mergeSuggestionItems,
  } = deps;
  const {
    getSearchHistoryItems,
    getAvailableSearchTargets,
    getCurrentSearchTarget,
    setCurrentSearchTarget,
    resolveSearchTarget,
    syncSearchTargetShell,
    runSearchForTarget,
    runDefaultSearchFlow,
  } = callbacks;
  const suggestionRefreshDebounce = constants.suggestionRefreshDebounce ?? 220;

  let suggestions = [];
  let isSuggestionsOpen = false;
  let highlightedSuggestionIndex = -1;
  let activeSuggestionRequestId = 0;
  let suggestionRefreshTimeoutId = 0;
  let shouldKeepSuggestionsClosed = false;
  let shouldSkipNextSubmit = false;

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

  const dismiss = () => {
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
      const activeTarget = getCurrentSearchTarget();
      const targetId = typeof item.targetId === "string" ? item.targetId : activeTarget?.id;
      const resolvedTarget = resolveSearchTarget(targetId);
      setCurrentSearchTarget(resolvedTarget);
      syncSearchTargetShell();
      await runSearchForTarget(query, resolvedTarget.id);
      return true;
    }

    applySuggestionQueryToInput(query);
    dismiss();

    if (shouldExecuteQuery) {
      await runDefaultSearchFlow(query);
      return true;
    }

    shouldSkipNextSubmit = true;
    return false;
  };

  const handleInput = (query) => {
    const normalizedQuery = query.trim();
    activeSuggestionRequestId += 1;
    const requestId = activeSuggestionRequestId;

    window.clearTimeout(suggestionRefreshTimeoutId);

    if (!normalizedQuery) {
      clearSuggestions();
      renderSuggestions();
      return;
    }

    const localItems = createLocalSuggestionItems(
      normalizedQuery,
      getSearchHistoryItems(),
      getAvailableSearchTargets(),
    );
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
    }, suggestionRefreshDebounce);
  };

  const handleFocus = () => {
    if (!suggestions.length) {
      return;
    }

    isSuggestionsOpen = true;
    renderSuggestions();
  };

  const handleBlur = (activeElement, options = {}) => {
    const isWithinSuggestions = activeElement instanceof Node
      && searchSuggestions instanceof HTMLElement
      && searchSuggestions.contains(activeElement);
    const isWithinTargetMenu = activeElement instanceof Node
      && options.searchTargetMenu instanceof HTMLElement
      && options.searchTargetMenu.contains(activeElement);
    const isTargetTriggerFocused = activeElement === options.searchTargetTrigger;

    if (isWithinSuggestions || isWithinTargetMenu || isTargetTriggerFocused) {
      return false;
    }

    dismiss();
    return true;
  };

  const handleKeyDown = (event, options = {}) => {
    const isTargetMenuOpen = options.searchTargetMenu instanceof HTMLElement && !options.searchTargetMenu.hidden;
    const isSuggestionListVisible = isSuggestionsOpen && suggestions.length > 0;

    if (event.key === "ArrowDown" && isSuggestionListVisible) {
      event.preventDefault();
      moveSuggestionHighlight(1);
      return true;
    }

    if (event.key === "ArrowUp" && isSuggestionListVisible) {
      event.preventDefault();
      moveSuggestionHighlight(-1);
      return true;
    }

    if (event.key === "Tab" && isSuggestionListVisible) {
      const highlightedSuggestion = getHighlightedSuggestion();
      if (highlightedSuggestion?.type === "query") {
        event.preventDefault();
        applyHighlightedSuggestionToInput();
      }
      return true;
    }

    if (event.key === "Escape") {
      if (isTargetMenuOpen || isSuggestionListVisible) {
        event.preventDefault();
        dismiss();
        return true;
      }
      return false;
    }

    if (event.key === "Enter" && isSuggestionListVisible) {
      const inputValue = searchInput instanceof HTMLInputElement ? searchInput.value : "";
      const directTarget = resolveDirectNavigationTarget(inputValue);
      if (directTarget) {
        return false;
      }

      const highlightedSuggestion = getHighlightedSuggestion();
      if (highlightedSuggestion) {
        event.preventDefault();
        void executeSuggestionItem(highlightedSuggestion, { executeQuery: true });
        return true;
      }
    }

    return false;
  };

  const handleClick = async (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-index]") : null;
    if (!(target instanceof HTMLButtonElement)) {
      return false;
    }

    const suggestionIndex = Number.parseInt(target.dataset.index ?? "", 10);
    if (!Number.isInteger(suggestionIndex) || suggestionIndex < 0 || suggestionIndex >= suggestions.length) {
      return false;
    }

    await executeSuggestionItem(suggestions[suggestionIndex], { executeQuery: true });
    return true;
  };

  return {
    render: renderSuggestions,
    dismiss,
    close: dismiss,
    handleInput,
    handleFocus,
    handleBlur,
    handleKeyDown,
    handleClick,
    hasVisibleSuggestions: () => isSuggestionsOpen && suggestions.length > 0,
    shouldSkipNextSubmit: () => shouldSkipNextSubmit,
    consumeSkippedSubmit: () => {
      const currentValue = shouldSkipNextSubmit;
      shouldSkipNextSubmit = false;
      return currentValue;
    },
  };
};
