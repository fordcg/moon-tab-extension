export const createWidgetEditModeController = ({ elements, setPanelOpen }) => {
  let isEditMode = false;
  const cards = new Set();

  const syncCard = ({ article }) => {
    article.dataset.widgetEditing = isEditMode ? "true" : "false";
    const controls = article.querySelectorAll(
      "[data-widget-transform-control], [data-widget-action='hide']",
    );

    for (const control of controls) {
      if (!(control instanceof HTMLButtonElement)) {
        continue;
      }

      control.disabled = !isEditMode;
      control.tabIndex = isEditMode ? 0 : -1;
      control.setAttribute("aria-hidden", isEditMode ? "false" : "true");
    }
  };

  const sync = () => {
    if (elements.root instanceof HTMLElement) {
      elements.root.dataset.widgetEditMode = isEditMode ? "true" : "false";
    }

    if (elements.editTrigger instanceof HTMLButtonElement) {
      elements.editTrigger.setAttribute("aria-pressed", isEditMode ? "true" : "false");
      elements.editTrigger.textContent = "编辑布局";
    }

    if (elements.saveTrigger instanceof HTMLButtonElement) {
      elements.saveTrigger.disabled = !isEditMode;
    }

    for (const card of cards) {
      syncCard(card);
    }
  };

  const setEditMode = (nextEditMode) => {
    isEditMode = Boolean(nextEditMode);
    sync();
    setPanelOpen(isEditMode);
  };

  const registerCard = (card) => {
    cards.add(card);
    syncCard(card);
  };

  elements.editTrigger?.addEventListener("click", () => {
    setEditMode(true);
  });

  elements.saveTrigger?.addEventListener("click", () => {
    setEditMode(false);
  });

  return {
    getIsEditMode: () => isEditMode,
    registerCard,
    setEditMode,
    sync,
  };
};
