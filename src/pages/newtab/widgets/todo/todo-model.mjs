import {
  DEFAULT_TODO_FILTER,
  DEFAULT_TODO_PRIORITY,
  TODO_FILTERS,
  TODO_PRIORITIES,
  TODO_STORAGE_VERSION,
} from "./todo-constants.mjs";

const PRIORITY_WEIGHT = Object.freeze({
  [TODO_PRIORITIES.high]: 0,
  [TODO_PRIORITIES.medium]: 1,
  [TODO_PRIORITIES.low]: 2,
});

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const getTodayDateString = () => {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const normalizePriority = (value) =>
  Object.values(TODO_PRIORITIES).includes(value) ? value : DEFAULT_TODO_PRIORITY;

export const normalizeFilter = (value) =>
  Object.values(TODO_FILTERS).includes(value) ? value : DEFAULT_TODO_FILTER;

export const normalizeDueDate = (value) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";

const createTaskId = () => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `todo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const createTask = ({ title, priority = DEFAULT_TODO_PRIORITY, dueDate = "", now = new Date(), order = 0 }) => {
  const normalizedTitle = typeof title === "string" ? title.trim() : "";
  if (!normalizedTitle) {
    return null;
  }

  const timestamp = now.toISOString();
  return {
    id: createTaskId(),
    title: normalizedTitle,
    completed: false,
    priority: normalizePriority(priority),
    dueDate: normalizeDueDate(dueDate),
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: "",
    order: Number.isFinite(order) ? order : 0,
  };
};

export const normalizeTask = (value, index = 0) => {
  if (!isPlainObject(value)) {
    return null;
  }

  const title = typeof value.title === "string" ? value.title.trim() : "";
  if (!title) {
    return null;
  }

  const createdAt = typeof value.createdAt === "string" ? value.createdAt : new Date(0).toISOString();
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : createdAt;
  const completed = Boolean(value.completed);

  return {
    id: typeof value.id === "string" && value.id ? value.id : createTaskId(),
    title,
    completed,
    priority: normalizePriority(value.priority),
    dueDate: normalizeDueDate(value.dueDate),
    createdAt,
    updatedAt,
    completedAt: completed && typeof value.completedAt === "string" ? value.completedAt : "",
    order: Number.isFinite(value.order) ? value.order : index,
  };
};

export const normalizeTaskPayload = (payload) => {
  const tasks = Array.isArray(payload?.tasks)
    ? payload.tasks.map(normalizeTask).filter(Boolean)
    : [];

  return {
    version: TODO_STORAGE_VERSION,
    tasks,
  };
};

export const isTaskOverdue = (task, today = getTodayDateString()) =>
  Boolean(task?.dueDate) && !task.completed && task.dueDate < today;

export const sortTasks = (tasks, today = getTodayDateString()) =>
  [...tasks].sort((left, right) => {
    if (left.completed !== right.completed) {
      return left.completed ? 1 : -1;
    }

    const leftOverdue = isTaskOverdue(left, today);
    const rightOverdue = isTaskOverdue(right, today);
    if (leftOverdue !== rightOverdue) {
      return leftOverdue ? -1 : 1;
    }

    if (left.dueDate && right.dueDate && left.dueDate !== right.dueDate) {
      return left.dueDate.localeCompare(right.dueDate);
    }

    if (left.dueDate !== right.dueDate) {
      return left.dueDate ? -1 : 1;
    }

    const priorityDelta = PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority];
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return left.order - right.order;
  });

export const filterTasks = (tasks, filter, today = getTodayDateString()) => {
  const normalizedFilter = normalizeFilter(filter);
  if (normalizedFilter === TODO_FILTERS.active) {
    return tasks.filter((task) => !task.completed);
  }

  if (normalizedFilter === TODO_FILTERS.completed) {
    return tasks.filter((task) => task.completed);
  }

  if (normalizedFilter === TODO_FILTERS.overdue) {
    return tasks.filter((task) => isTaskOverdue(task, today));
  }

  return [...tasks];
};

export const getVisibleTasks = ({ tasks, filter, today = getTodayDateString() }) =>
  sortTasks(filterTasks(tasks, filter, today), today);

export const addTask = (tasks, input, now = new Date()) => {
  const order = tasks.reduce((max, task) => Math.max(max, Number(task.order) || 0), 0) + 1;
  const task = createTask({ ...input, now, order });
  return task ? [...tasks, task] : [...tasks];
};

export const updateTask = (tasks, taskId, updates, now = new Date()) =>
  tasks.map((task) => {
    if (task.id !== taskId) {
      return task;
    }

    const completed = typeof updates.completed === "boolean" ? updates.completed : task.completed;
    return {
      ...task,
      title: typeof updates.title === "string" && updates.title.trim() ? updates.title.trim() : task.title,
      priority: updates.priority === undefined ? task.priority : normalizePriority(updates.priority),
      dueDate: updates.dueDate === undefined ? task.dueDate : normalizeDueDate(updates.dueDate),
      completed,
      completedAt: completed ? task.completedAt || now.toISOString() : "",
      updatedAt: now.toISOString(),
    };
  });

export const deleteTask = (tasks, taskId) => tasks.filter((task) => task.id !== taskId);

export const clearCompletedTasks = (tasks) => tasks.filter((task) => !task.completed);
