import { calendarWidgetDefinition } from "./definitions/calendar-widget.mjs";
import { quicksitesWidgetDefinition } from "./definitions/quicksites-widget.mjs";
import { searchWidgetDefinition } from "./definitions/search-widget.mjs";
import { todoWidgetDefinition } from "./definitions/todo-widget.mjs";

export const WIDGET_REGISTRY = Object.freeze([
  searchWidgetDefinition,
  quicksitesWidgetDefinition,
  calendarWidgetDefinition,
  todoWidgetDefinition,
]);

export const getWidgetById = (id) => WIDGET_REGISTRY.find((item) => item.id === id) ?? null;

export const listWidgets = () => [...WIDGET_REGISTRY];
