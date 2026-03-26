export const createInteractionsController = ({ elements, controllers, callbacks, deps }) => {
  const {
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
  } = elements;
  const { aiPreviewController, suggestionsController, searchTargetController } = controllers;
  const {
    triggerAiSearchToggle,
    closeSearchMenus,
    hideAiSearchPreview,
    setSearchStatus,
    shouldUseAiSearchFlow,
    runDefaultSearchFlow,
    getStoredSearchSettings,
    focusSearchInput,
  } = callbacks;
  const { isChatCompletionsEndpoint } = deps;

  const bind = () => {
    if (!(searchForm instanceof HTMLFormElement) || !(searchInput instanceof HTMLInputElement)) {
      return;
    }

    if (aiToggleButton instanceof HTMLButtonElement) {
      aiToggleButton.addEventListener("click", () => {
        triggerAiSearchToggle();
      });
    }

    if (aiSearchPreviewAction instanceof HTMLButtonElement) {
      aiSearchPreviewAction.addEventListener("click", () => {
        void aiPreviewController.handlePrimaryAction();
      });
    }

    if (aiSearchPreviewSecondaryAction instanceof HTMLButtonElement) {
      aiSearchPreviewSecondaryAction.addEventListener("click", () => {
        void aiPreviewController.handleSecondaryAction();
      });
    }

    if (aiSearchPreviewSuggestions instanceof HTMLElement) {
      aiSearchPreviewSuggestions.addEventListener("click", (event) => {
        void aiPreviewController.handleRelatedQueryClick(event);
      });
    }

    if (aiSearchPreviewWebsitesList instanceof HTMLElement) {
      aiSearchPreviewWebsitesList.addEventListener("click", (event) => {
        aiPreviewController.handleWebsiteClick(event);
      });
    }

    if (searchTargetTrigger instanceof HTMLButtonElement) {
      searchTargetTrigger.addEventListener("click", () => {
        searchTargetController.handleTriggerClick();
      });
    }

    if (searchTargetMenu instanceof HTMLElement) {
      searchTargetMenu.addEventListener("click", (event) => {
        searchTargetController.handleMenuClick(event);
      });
    }

    if (searchSuggestions instanceof HTMLElement) {
      searchSuggestions.addEventListener("click", (event) => {
        void suggestionsController.handleClick(event);
      });
    }

    searchInput.addEventListener("keydown", (event) => {
      const wasHandled = suggestionsController.handleKeyDown(event, {
        searchTargetMenu,
      });
      if (wasHandled && event.key === "Escape") {
        searchTargetController.setOpen(false);
      }
    });

    searchInput.addEventListener("focus", () => {
      suggestionsController.handleFocus();
    });

    searchInput.addEventListener("blur", () => {
      window.setTimeout(() => {
        const activeElement = document.activeElement;
        const shouldCloseSuggestions = suggestionsController.handleBlur(activeElement, {
          searchTargetMenu,
          searchTargetTrigger,
        });
        if (shouldCloseSuggestions) {
          searchTargetController.setOpen(false);
        }
      }, 120);
    });

    searchInput.addEventListener("input", () => {
      const query = searchInput.value.trim();

      if (aiPreviewController.clearPreviewIfQueryChanged(query)) {
        setSearchStatus("", "neutral");
      }

      suggestionsController.handleInput(query);
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

      if (suggestionsController.consumeSkippedSubmit()) {
        return;
      }

      const query = searchInput.value.trim();
      if (!query) {
        hideAiSearchPreview();
        setSearchStatus("请输入要搜索或打开的内容。", "error");
        focusSearchInput();
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

      if (aiPreviewController.hasActivePreviewForQuery(query)) {
        await aiPreviewController.runActivePreview();
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

      await aiPreviewController.submitSearch({ query, settings });
    });
  };

  return {
    bind,
  };
};
