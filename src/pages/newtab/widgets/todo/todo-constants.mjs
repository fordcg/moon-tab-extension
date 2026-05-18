export const TODO_STORAGE_KEY = "newtabTodoTasks";
export const TODO_STORAGE_VERSION = 1;

export const TODO_FILTERS = Object.freeze({
  all: "all",
  active: "active",
  completed: "completed",
  overdue: "overdue",
});

export const TODO_PRIORITIES = Object.freeze({
  low: "low",
  medium: "medium",
  high: "high",
});

export const TODO_PRIORITY_LABELS = Object.freeze({
  [TODO_PRIORITIES.low]: "低",
  [TODO_PRIORITIES.medium]: "中",
  [TODO_PRIORITIES.high]: "高",
});

export const TODO_FILTER_LABELS = Object.freeze({
  [TODO_FILTERS.all]: "全部",
  [TODO_FILTERS.active]: "进行中",
  [TODO_FILTERS.completed]: "已完成",
  [TODO_FILTERS.overdue]: "逾期",
});

export const DEFAULT_TODO_FILTER = TODO_FILTERS.all;
export const DEFAULT_TODO_PRIORITY = TODO_PRIORITIES.medium;
