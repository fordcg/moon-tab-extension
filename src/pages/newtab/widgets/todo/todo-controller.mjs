import { DEFAULT_TODO_FILTER, DEFAULT_TODO_PRIORITY, TODO_STORAGE_VERSION } from "./todo-constants.mjs";
import {
  addTask,
  clearCompletedTasks,
  deleteTask,
  getTodayDateString,
  normalizeFilter,
  updateTask,
} from "./todo-model.mjs";
import { readTodoPayload, writeTodoPayload } from "./todo-storage.mjs";
import { createTodoView, renderTodoTasks } from "./todo-view.mjs";

export const createTodoController = ({ documentRef }) => {
  const view = createTodoView({ documentRef });
  const state = {
    tasks: [],
    filter: DEFAULT_TODO_FILTER,
    mode: "list",
    editingTaskId: "",
    drawerOpen: false,
    today: getTodayDateString(),
  };

  const persist = async () => {
    const payload = await writeTodoPayload({
      version: TODO_STORAGE_VERSION,
      tasks: state.tasks,
    });
    state.tasks = payload.tasks;
  };

  const render = () => {
    renderTodoTasks({ documentRef, elements: view.elements, state });
  };

  const commitTasks = async (tasks) => {
    state.tasks = tasks;
    await persist();
    render();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const title = view.elements.titleInput.value;
    const priority = view.elements.prioritySelect.value;
    const dueDate = view.elements.dueInput.value;

    if (state.editingTaskId) {
      state.mode = "list";
      const editingTaskId = state.editingTaskId;
      state.editingTaskId = "";
      await commitTasks(updateTask(state.tasks, editingTaskId, { title, priority, dueDate }));
      return;
    }

    const nextTasks = addTask(state.tasks, { title, priority, dueDate });
    if (nextTasks.length === state.tasks.length) {
      view.elements.titleInput.focus();
      return;
    }

    view.elements.titleInput.value = "";
    view.elements.prioritySelect.value = DEFAULT_TODO_PRIORITY;
    view.elements.dueInput.value = "";
    state.mode = "list";
    await commitTasks(nextTasks);
  };

  const getTaskIdFromEvent = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const row = target?.closest("[data-todo-task]");
    return row instanceof HTMLElement ? row.dataset.todoTask ?? "" : "";
  };

  const bind = () => {
    view.elements.form.addEventListener("submit", (event) => {
      void handleSubmit(event);
    });

    view.elements.filters.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest("[data-todo-filter]") : null;
      if (!(button instanceof HTMLElement)) {
        return;
      }

      state.filter = normalizeFilter(button.dataset.todoFilter);
      render();
    });

    view.elements.list.addEventListener("change", (event) => {
      const target = event.target;
      const taskId = getTaskIdFromEvent(event);
      if (!taskId || !(target instanceof HTMLElement)) {
        return;
      }

      if (target.dataset.todoAction === "toggle" && target instanceof HTMLInputElement) {
        void commitTasks(updateTask(state.tasks, taskId, { completed: target.checked }));
      }
    });

    view.root.addEventListener("click", (event) => {
      const action = event.target instanceof Element ? event.target.closest("[data-todo-action]") : null;
      if (!(action instanceof HTMLElement)) {
        return;
      }

      const isWidgetEditMode = view.root.closest("[data-widget-edit-mode='true']");

      if (action.dataset.todoAction === "open-create") {
        state.drawerOpen = true;
        state.mode = "create";
        state.editingTaskId = "";
        render();
        view.elements.titleInput.focus();
      }

      if (action.dataset.todoAction === "toggle-drawer") {
        if (isWidgetEditMode) {
          return;
        }
        state.drawerOpen = !state.drawerOpen;
        if (!state.drawerOpen) {
          state.mode = "list";
          state.editingTaskId = "";
        }
        render();
      }

      if (action.dataset.todoAction === "cancel-edit") {
        state.mode = "list";
        state.editingTaskId = "";
        render();
      }

      if (action.dataset.todoAction === "edit") {
        const taskId = getTaskIdFromEvent(event);
        if (taskId) {
          state.mode = "edit";
          state.drawerOpen = true;
          state.editingTaskId = taskId;
          render();
          view.elements.titleInput.focus();
        }
      }

      if (action.dataset.todoAction === "delete") {
        const taskId = state.editingTaskId || getTaskIdFromEvent(event);
        if (taskId) {
          state.mode = "list";
          state.editingTaskId = "";
          void commitTasks(deleteTask(state.tasks, taskId));
        }
      }

      if (action.dataset.todoAction === "clear-completed") {
        void commitTasks(clearCompletedTasks(state.tasks));
      }
    });
  };

  const mount = async () => {
    bind();
    render();
    const payload = await readTodoPayload();
    state.tasks = payload.tasks;
    render();
  };

  return {
    root: view.root,
    mount,
  };
};
