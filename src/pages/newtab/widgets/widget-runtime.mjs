import { createWidgetShell } from "./widget-shell.mjs";

const isTemplateElement = (value) => value instanceof HTMLTemplateElement;
const isHtmlElement = (value) => value instanceof HTMLElement;

export const createWidgetRuntime = ({ documentRef, registryItems, layoutStateApi, elements }) => {
  let currentLayout = null;

  const renderWidget = (widget) => {
    const { article, body } = createWidgetShell({
      documentRef,
      widget,
      canHide: widget.canHide,
    });
    const rendered = widget.render({ documentRef });

    if (isTemplateElement(rendered)) {
      body.appendChild(rendered.content.cloneNode(true));
    } else if (isHtmlElement(rendered)) {
      body.appendChild(rendered);
    }

    return article;
  };

  const render = () => {
    if (!(elements.root instanceof HTMLElement) || !currentLayout) {
      return;
    }

    elements.root.innerHTML = "";

    for (const widgetId of currentLayout.orderedWidgetIds) {
      if (currentLayout.hiddenWidgetIds.includes(widgetId)) {
        continue;
      }

      const widget = registryItems.find((item) => item.id === widgetId);
      if (!widget) {
        continue;
      }

      elements.root.appendChild(renderWidget(widget));
    }
  };

  const mount = async () => {
    currentLayout = await layoutStateApi.loadWidgetLayout({ registryItems });
    render();
  };

  return {
    mount,
    render,
  };
};
