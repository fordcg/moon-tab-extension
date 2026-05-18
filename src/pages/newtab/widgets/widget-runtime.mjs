import { createWidgetEditModeController } from "./widget-edit-mode.mjs";
import { createWidgetShell } from "./widget-shell.mjs";
import {
  WIDGET_STAGE_TRANSFORM_PREF,
  applyWidgetTransform,
  createWidgetTransformController,
  sanitizeStageTransform,
} from "./widget-transform.mjs";

const isTemplateElement = (value) => value instanceof HTMLTemplateElement;
const isHtmlElement = (value) => value instanceof HTMLElement;
const SHELL_MARKER_ATTRIBUTE = "data-widget-id";
const DESKTOP_STAGE_SLOT_BY_WIDGET_ID = Object.freeze({
  search: "center",
  todo: "left-lower",
  calendar: "right-lower",
  quicksites: "lower-center",
});

const applyStageSlot = ({ article, widgetId }) => {
  article.dataset.widgetSlot = DESKTOP_STAGE_SLOT_BY_WIDGET_ID[widgetId] ?? "stack";
};

const moveWidgetStickerToHeader = ({ body, ornament }) => {
  const sticker = body.querySelector(".widget-note__sticker");
  if (!(sticker instanceof HTMLImageElement) || !(ornament instanceof HTMLElement)) {
    return;
  }

  ornament.replaceChildren(sticker);
};

export const createWidgetRuntime = ({ documentRef, registryItems, layoutStateApi, elements }) => {
  let currentLayout = null;
  const widgetCards = new Map();
  const widgetRegistryById = new Map(registryItems.map((item) => [item.id, item]));

  const isWidgetVisible = (widgetId) =>
    Boolean(currentLayout) &&
    currentLayout.orderedWidgetIds.includes(widgetId) &&
    !currentLayout.hiddenWidgetIds.includes(widgetId);

  const getWidgetStageTransformPrefs = (widgetId) =>
    currentLayout?.widgetPrefs?.[widgetId]?.[WIDGET_STAGE_TRANSFORM_PREF] ?? {};

  const persistWidgetStageTransform = async ({ widgetId, transform }) => {
    if (!currentLayout || typeof layoutStateApi.updateWidgetPrefs !== "function") {
      return;
    }

    try {
      currentLayout = await layoutStateApi.updateWidgetPrefs({
        layout: currentLayout,
        widgetId,
        widgetPrefs: {
          [WIDGET_STAGE_TRANSFORM_PREF]: sanitizeStageTransform(transform),
        },
        registryItems,
      });
    } catch (error) {
      console.warn("Failed to save widget transform preferences.", error);
    }
  };

  const setPanelOpen = (open) => {
    if (!(elements.panel instanceof HTMLElement)) {
      return;
    }

    if (open) {
      renderPanel();
    }

    elements.panel.hidden = !open;
    elements.panelTrigger?.setAttribute("aria-expanded", open ? "true" : "false");
  };

  const editModeController = createWidgetEditModeController({
    elements,
    setPanelOpen,
  });
  const transformController = createWidgetTransformController({
    documentRef,
    getIsEditMode: editModeController.getIsEditMode,
    getTransformPrefs: getWidgetStageTransformPrefs,
    persistTransform: persistWidgetStageTransform,
  });

  const sanitizeWidgetContent = (contentRoot) => {
    const nestedShells = contentRoot.querySelectorAll(`[${SHELL_MARKER_ATTRIBUTE}]`);
    for (const nestedShell of nestedShells) {
      nestedShell.removeAttribute(SHELL_MARKER_ATTRIBUTE);
    }

    return contentRoot;
  };

  const resolveWidgetContent = (rendered) => {
    const content = documentRef.createDocumentFragment();

    if (isTemplateElement(rendered)) {
      content.appendChild(rendered.content.cloneNode(true));
    } else if (isHtmlElement(rendered)) {
      content.appendChild(rendered);
    }

    return sanitizeWidgetContent(content);
  };

  const renderPanel = () => {
    if (!(elements.panelList instanceof HTMLElement) || !currentLayout) {
      return;
    }

    elements.panelList.replaceChildren();
    const hiddenWidgetIdSet = new Set(currentLayout.hiddenWidgetIds);

    for (const widget of registryItems) {
      if (widget.core) {
        continue;
      }

      const row = documentRef.createElement("div");
      row.className = "widget-panel-row";
      row.dataset.widgetId = widget.id;

      const meta = documentRef.createElement("div");
      meta.className = "widget-panel-meta";

      const label = documentRef.createElement("span");
      label.className = "widget-panel-label";
      label.textContent = widget.title;

      const visibility = documentRef.createElement("span");
      visibility.className = "widget-panel-visibility";

      const button = documentRef.createElement("button");
      button.type = "button";
      button.className = "ui-btn-secondary widget-panel-button";

      if (hiddenWidgetIdSet.has(widget.id)) {
        visibility.textContent = "已隐藏";
        button.dataset.widgetPanelAction = "restore";
        button.dataset.widgetId = widget.id;
        button.textContent = "恢复";
      } else if (isWidgetVisible(widget.id)) {
        visibility.textContent = "已显示";
        button.disabled = true;
        button.textContent = "已添加";
      } else {
        visibility.textContent = "未显示";
        button.dataset.widgetPanelAction = "restore";
        button.dataset.widgetId = widget.id;
        button.textContent = "添加";
      }

      meta.append(label, visibility);
      row.append(meta, button);
      elements.panelList.appendChild(row);
    }
  };

  const render = () => {
    renderWidgets();
    renderPanel();
  };

  const applyLayoutMutation = async ({ widgetId, mutator }) => {
    if (!currentLayout || typeof mutator !== "function") {
      return;
    }

    currentLayout = await mutator({
      layout: currentLayout,
      widgetId,
      registryItems,
    });
    render();
  };

  const ensureWidgetCard = (widget) => {
    const existingCard = widgetCards.get(widget.id);
    if (existingCard) {
      return existingCard;
    }

    const card = createWidgetShell({
      documentRef,
      widget,
      canHide: widget.canHide,
    });
    applyStageSlot({ article: card.article, widgetId: widget.id });
    applyWidgetTransform({
      article: card.article,
      transform: getWidgetStageTransformPrefs(widget.id),
    });

    const rendered = widget.render({ documentRef });
    const content = resolveWidgetContent(rendered);
    card.body.appendChild(content);
    moveWidgetStickerToHeader(card);

    card.article.addEventListener("click", async (event) => {
      const actionButton =
        event.target instanceof Element
          ? event.target.closest("[data-widget-action='hide']")
          : null;

      if (!actionButton) {
        return;
      }

      await applyLayoutMutation({
        widgetId: widget.id,
        mutator: layoutStateApi.hideWidget,
      });
    });

    transformController.install({ article: card.article, widgetId: widget.id });
    widgetCards.set(widget.id, card);
    editModeController.registerCard(card);
    return card;
  };

  function renderWidgets() {
    if (!(elements.root instanceof HTMLElement) || !currentLayout) {
      return;
    }

    const visibleWidgetIds = [];
    const hiddenWidgetIdSet = new Set(currentLayout.hiddenWidgetIds);
    const registryIds = new Set(registryItems.map((item) => item.id));

    for (const widgetId of currentLayout.orderedWidgetIds) {
      if (hiddenWidgetIdSet.has(widgetId)) {
        continue;
      }

      const widget = widgetRegistryById.get(widgetId);
      if (!widget) {
        continue;
      }

      const { article } = ensureWidgetCard(widget);
      applyWidgetTransform({
        article,
        transform: getWidgetStageTransformPrefs(widget.id),
      });
      visibleWidgetIds.push(widgetId);
      elements.root.appendChild(article);
    }

    const visibleWidgetIdSet = new Set(visibleWidgetIds);

    for (const [widgetId, card] of widgetCards.entries()) {
      if (!registryIds.has(widgetId)) {
        card.article.remove();
        widgetCards.delete(widgetId);
        continue;
      }

      if (!visibleWidgetIdSet.has(widgetId)) {
        card.article.remove();
      }
    }
  }

  elements.panelList?.addEventListener("click", async (event) => {
    const actionButton =
      event.target instanceof Element
        ? event.target.closest("[data-widget-panel-action='restore']")
        : null;

    if (!(actionButton instanceof HTMLElement)) {
      return;
    }

    await applyLayoutMutation({
      widgetId: actionButton.getAttribute("data-widget-id") ?? "",
      mutator: layoutStateApi.restoreWidget,
    });
  });

  const mount = async () => {
    try {
      currentLayout = await layoutStateApi.loadWidgetLayout({ registryItems });
    } catch (error) {
      console.warn("Failed to load widget layout. Falling back to default layout.", error);
      currentLayout = layoutStateApi.normalizeWidgetLayout({
        layout: layoutStateApi.createDefaultWidgetLayout({ registryItems }),
        registryItems,
      });
    }

    render();
    editModeController.sync();
    setPanelOpen(false);
  };

  return {
    mount,
    render,
  };
};
