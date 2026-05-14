import { searchWidgetDefinition } from "./definitions/search-widget.mjs";

const createPlaceholderWidgetTemplate = ({ documentRef, widgetId, title }) => {
  const template = documentRef.createElement("template");
  template.innerHTML = `
    <section class="homepage-widget-card homepage-widget-card--placeholder" data-widget-id="${widgetId}">
      <header class="homepage-widget-card__header">
        <h2 class="homepage-widget-card__title">${title}</h2>
      </header>
      <div class="homepage-widget-card__body" data-widget-placeholder="true"></div>
    </section>
  `.trim();
  return template;
};

const placeholderWidgetDefinitions = [
  {
    id: "quicksites",
    title: "快捷站点",
    core: false,
    canHide: true,
    defaultVisible: true,
    render: ({ documentRef }) => createPlaceholderWidgetTemplate({
      documentRef,
      widgetId: "quicksites",
      title: "快捷站点",
    }),
  },
  {
    id: "calendar",
    title: "日历",
    core: false,
    canHide: true,
    defaultVisible: true,
    render: ({ documentRef }) => createPlaceholderWidgetTemplate({
      documentRef,
      widgetId: "calendar",
      title: "日历",
    }),
  },
  {
    id: "todo",
    title: "待办",
    core: false,
    canHide: true,
    defaultVisible: true,
    render: ({ documentRef }) => createPlaceholderWidgetTemplate({
      documentRef,
      widgetId: "todo",
      title: "待办",
    }),
  },
];

export const WIDGET_REGISTRY = Object.freeze([
  searchWidgetDefinition,
  ...placeholderWidgetDefinitions,
]);

export const getWidgetById = (id) => WIDGET_REGISTRY.find((item) => item.id === id) ?? null;

export const listWidgets = () => [...WIDGET_REGISTRY];
