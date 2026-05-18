import { searchWidgetDefinition } from "./definitions/search-widget.mjs";

const placeholderWidgetDefinitions = [
  {
    id: "quicksites",
    title: "快捷站点",
    core: false,
    canHide: true,
    defaultVisible: true,
    render: () => null,
  },
  {
    id: "calendar",
    title: "日历",
    core: false,
    canHide: true,
    defaultVisible: true,
    render: () => null,
  },
  {
    id: "todo",
    title: "待办",
    core: false,
    canHide: true,
    defaultVisible: true,
    render: () => null,
  },
];

export const WIDGET_REGISTRY = Object.freeze([
  searchWidgetDefinition,
  ...placeholderWidgetDefinitions,
]);

export const getWidgetById = (id) => WIDGET_REGISTRY.find((item) => item.id === id) ?? null;

export const listWidgets = () => [...WIDGET_REGISTRY];
