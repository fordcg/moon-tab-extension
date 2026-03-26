export const createSearchTargetController = ({ elements, callbacks }) => {
  const { searchTargetTrigger, searchTargetLabel, searchTargetMenu } = elements;
  const {
    getAvailableSearchTargets,
    getCurrentSearchTarget,
    setCurrentSearchTarget,
    resolveSearchTarget,
    hideAiSearchPreview,
    clearSearchStatus,
    dismissSuggestions,
    hasActiveAiPreview,
  } = callbacks;

  const render = () => {
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

    getAvailableSearchTargets().forEach((target) => {
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

  const setOpen = (open) => {
    if (searchTargetTrigger instanceof HTMLButtonElement) {
      searchTargetTrigger.setAttribute("aria-expanded", open ? "true" : "false");
    }

    if (searchTargetMenu instanceof HTMLElement) {
      searchTargetMenu.hidden = !open;
    }
  };

  const syncShell = () => {
    const activeTarget = resolveSearchTarget(getCurrentSearchTarget()?.id);
    setCurrentSearchTarget(activeTarget);

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

    if (hasActiveAiPreview() && !activeTarget.isGeneral) {
      hideAiSearchPreview();
      clearSearchStatus();
    }

    setOpen(false);
    dismissSuggestions();
  };

  const handleTriggerClick = () => {
    const willOpen = searchTargetMenu instanceof HTMLElement ? searchTargetMenu.hidden : true;
    setOpen(willOpen);
  };

  const handleMenuClick = (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-target-id]") : null;
    if (!(target instanceof HTMLButtonElement)) {
      return false;
    }

    setCurrentSearchTarget(resolveSearchTarget(target.dataset.targetId));
    syncShell();
    return true;
  };

  return {
    render,
    setOpen,
    syncShell,
    handleTriggerClick,
    handleMenuClick,
  };
};
