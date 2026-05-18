export const getNewtabDomRefs = () => {
  const search = {
    form: document.getElementById("search-form"),
    input: document.getElementById("search-input"),
    status: document.getElementById("search-status"),
    suggestions: document.getElementById("search-suggestions"),
    frame: document.querySelector(".outline-search-frame"),
    outline: document.querySelector(".outline-search-outline"),
    outlineRect: document.querySelector(".outline-search-outline-rect"),
  };
  const ai = {
    indicator: document.getElementById("ai-search-indicator"),
    indicatorText: document.getElementById("ai-search-indicator-text"),
    toggleButton: document.getElementById("ai-toggle-btn"),
    openSidebarButton: document.getElementById("open-ai-sidebar"),
    enabledInput: document.getElementById("ai-search-enabled"),
    preview: document.getElementById("ai-search-preview"),
    previewIntent: document.getElementById("ai-search-preview-intent"),
    previewSummary: document.getElementById("ai-search-preview-summary"),
    previewOriginalQuery: document.getElementById("ai-search-preview-original-query"),
    previewTargetLabel: document.getElementById("ai-search-preview-target-label"),
    previewTarget: document.getElementById("ai-search-preview-target"),
    previewWebsites: document.getElementById("ai-search-preview-websites"),
    previewWebsitesList: document.getElementById("ai-search-preview-websites-list"),
    previewRelated: document.getElementById("ai-search-preview-related"),
    previewSuggestions: document.getElementById("ai-search-preview-suggestions"),
    previewAction: document.getElementById("ai-search-preview-action"),
    previewSecondaryAction: document.getElementById("ai-search-preview-secondary-action"),
  };
  const targets = {
    trigger: document.getElementById("search-target-trigger"),
    label: document.getElementById("search-target-label"),
    menu: document.getElementById("search-target-menu"),
  };
  const widgetRuntime = {
    root: document.getElementById("widget-root"),
    panelTrigger: document.getElementById("open-widget-panel"),
    panel: document.getElementById("widget-panel"),
    panelList: document.getElementById("widget-panel-list"),
    panelStatus: document.getElementById("widget-panel-status"),
  };

  return {
    search,
    ai,
    targets,
    widgetRuntime,
    controllerElements: {
      aiPreview: {
        searchForm: search.form,
        searchInput: search.input,
        searchStatus: search.status,
        aiSearchIndicator: ai.indicator,
        aiSearchIndicatorText: ai.indicatorText,
        aiToggleButton: ai.toggleButton,
        aiSearchPreview: ai.preview,
        aiSearchPreviewIntent: ai.previewIntent,
        aiSearchPreviewSummary: ai.previewSummary,
        aiSearchPreviewOriginalQuery: ai.previewOriginalQuery,
        aiSearchPreviewTargetLabel: ai.previewTargetLabel,
        aiSearchPreviewTarget: ai.previewTarget,
        aiSearchPreviewWebsites: ai.previewWebsites,
        aiSearchPreviewWebsitesList: ai.previewWebsitesList,
        aiSearchPreviewRelated: ai.previewRelated,
        aiSearchPreviewSuggestions: ai.previewSuggestions,
        aiSearchPreviewAction: ai.previewAction,
        aiSearchPreviewSecondaryAction: ai.previewSecondaryAction,
      },
      suggestions: {
        searchInput: search.input,
        searchSuggestions: search.suggestions,
      },
      searchTarget: {
        searchTargetTrigger: targets.trigger,
        searchTargetLabel: targets.label,
        searchTargetMenu: targets.menu,
      },
      startup: {
        searchInput: search.input,
        searchFrame: search.frame,
        searchOutline: search.outline,
        searchOutlineRect: search.outlineRect,
      },
      interactions: {
        searchForm: search.form,
        searchInput: search.input,
        aiToggleButton: ai.toggleButton,
        aiSearchPreviewAction: ai.previewAction,
        aiSearchPreviewSecondaryAction: ai.previewSecondaryAction,
        aiSearchPreviewSuggestions: ai.previewSuggestions,
        aiSearchPreviewWebsitesList: ai.previewWebsitesList,
        searchTargetTrigger: targets.trigger,
        searchTargetMenu: targets.menu,
        searchSuggestions: search.suggestions,
      },
    },
  };
};
