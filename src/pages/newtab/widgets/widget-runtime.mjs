import { createWidgetShell } from "./widget-shell.mjs";

const isTemplateElement = (value) => value instanceof HTMLTemplateElement;
const isHtmlElement = (value) => value instanceof HTMLElement;
const SHELL_MARKER_ATTRIBUTE = "data-widget-id";

export const createWidgetRuntime = ({ documentRef, registryItems, layoutStateApi, elements }) => {
  let currentLayout = null;
  const widgetCards = new Map();

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
    const rendered = widget.render({ documentRef });
    const content = resolveWidgetContent(rendered);
    card.body.appendChild(content);
    widgetCards.set(widget.id, card);
    return card;
  };

  const render = () => {
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

      const widget = registryItems.find((item) => item.id === widgetId);
      if (!widget) {
        continue;
      }

      const { article } = ensureWidgetCard(widget);
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
  };

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
  };

  return {
    mount,
    render,
  };
};
