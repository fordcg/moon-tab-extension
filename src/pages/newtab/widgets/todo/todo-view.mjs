import {
  DEFAULT_TODO_PRIORITY,
  TODO_FILTER_LABELS,
  TODO_FILTERS,
  TODO_PRIORITIES,
  TODO_PRIORITY_LABELS,
} from "./todo-constants.mjs";
import { getVisibleTasks, isTaskOverdue } from "./todo-model.mjs";

export const TODO_PET_GROOM_IMAGE = "./assets/hero/pet-groom/pet-groom.png";
export const TODO_PET_GROOM_IDLE_IMAGE = "./assets/hero/pet-groom/pet-groom-01.png";

const createOption = ({ documentRef, value, label }) => {
  const option = documentRef.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
};

const createPrioritySelect = ({ documentRef, value, datasetRole }) => {
  const select = documentRef.createElement("select");
  select.className = "todo-priority-select";
  select.dataset.todoInput = datasetRole;
  select.append(
    createOption({ documentRef, value: TODO_PRIORITIES.high, label: "高优先级" }),
    createOption({ documentRef, value: TODO_PRIORITIES.medium, label: "中优先级" }),
    createOption({ documentRef, value: TODO_PRIORITIES.low, label: "低优先级" }),
  );
  select.value = value;
  return select;
};

export const createTodoView = ({ documentRef }) => {
  const root = documentRef.createElement("section");
  root.className = "todo-manager";
  root.dataset.todoManager = "true";
  root.dataset.todoDrawerOpen = "false";

  const drawerToggle = documentRef.createElement("button");
  drawerToggle.type = "button";
  drawerToggle.className = "todo-drawer-toggle";
  drawerToggle.dataset.todoAction = "toggle-drawer";
  drawerToggle.setAttribute("aria-label", "展开待办抽屉");
  drawerToggle.setAttribute("aria-expanded", "false");

  const petPeek = documentRef.createElement("img");
  petPeek.className = "todo-drawer-toggle__pet";
  petPeek.src = TODO_PET_GROOM_IDLE_IMAGE;
  petPeek.alt = "";
  drawerToggle.appendChild(petPeek);

  const drawer = documentRef.createElement("div");
  drawer.className = "todo-drawer";
  drawer.dataset.todoDrawer = "true";
  drawer.setAttribute("aria-hidden", "true");

  const drawerPeekButton = documentRef.createElement("button");
  drawerPeekButton.type = "button";
  drawerPeekButton.className = "widget-note__pet-peek-button";
  drawerPeekButton.dataset.todoAction = "toggle-drawer";
  drawerPeekButton.setAttribute("aria-label", "收起待办抽屉");

  const drawerPeek = documentRef.createElement("img");
  drawerPeek.className = "widget-note__pet-peek";
  drawerPeek.src = "./assets/hero/pet-left-peek.png";
  drawerPeek.alt = "";
  drawerPeekButton.appendChild(drawerPeek);

  const sticker = documentRef.createElement("img");
  sticker.className = "widget-note__sticker";
  sticker.src = "./assets/widgets/todo-sticker.png";
  sticker.alt = "";

  const listPanel = documentRef.createElement("div");
  listPanel.className = "todo-manager-panel todo-manager-panel--list";
  listPanel.dataset.todoPanel = "list";

  const toolbar = documentRef.createElement("div");
  toolbar.className = "todo-manager-toolbar";

  const addNewButton = documentRef.createElement("button");
  addNewButton.type = "button";
  addNewButton.className = "todo-add-new-button";
  addNewButton.dataset.todoAction = "open-create";
  addNewButton.setAttribute("aria-label", "新增任务");
  addNewButton.textContent = "+";

  toolbar.appendChild(addNewButton);

  const editorPanel = documentRef.createElement("div");
  editorPanel.className = "todo-manager-panel todo-manager-panel--editor";
  editorPanel.dataset.todoPanel = "editor";
  editorPanel.hidden = true;

  const editorTitle = documentRef.createElement("p");
  editorTitle.className = "todo-editor-title";
  editorTitle.dataset.todoEditorTitle = "true";
  editorTitle.textContent = "新增任务";

  const form = documentRef.createElement("form");
  form.className = "todo-manager-form";
  form.dataset.todoForm = "true";

  const titleInput = documentRef.createElement("input");
  titleInput.type = "text";
  titleInput.className = "todo-title-input";
  titleInput.dataset.todoInput = "title";
  titleInput.placeholder = "添加新任务";
  titleInput.maxLength = 80;
  titleInput.autocomplete = "off";

  const prioritySelect = createPrioritySelect({
    documentRef,
    value: DEFAULT_TODO_PRIORITY,
    datasetRole: "priority",
  });

  const dueInput = documentRef.createElement("input");
  dueInput.type = "date";
  dueInput.className = "todo-date-input";
  dueInput.dataset.todoInput = "dueDate";

  const addButton = documentRef.createElement("button");
  addButton.type = "submit";
  addButton.className = "todo-add-button";
  addButton.dataset.todoAction = "add";
  addButton.textContent = "保存";

  const cancelButton = documentRef.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "todo-cancel-button";
  cancelButton.dataset.todoAction = "cancel-edit";
  cancelButton.textContent = "取消";

  const deleteEditorButton = documentRef.createElement("button");
  deleteEditorButton.type = "button";
  deleteEditorButton.className = "todo-editor-delete-button";
  deleteEditorButton.dataset.todoAction = "delete";
  deleteEditorButton.textContent = "删除";
  deleteEditorButton.hidden = true;

  form.append(titleInput, prioritySelect, dueInput, addButton, cancelButton, deleteEditorButton);

  const filters = documentRef.createElement("div");
  filters.className = "todo-filter-list";
  filters.setAttribute("role", "tablist");

  for (const [filter, label] of Object.entries(TODO_FILTER_LABELS)) {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.className = "todo-filter-button";
    button.dataset.todoFilter = filter;
    button.textContent = label;
    filters.appendChild(button);
  }

  const list = documentRef.createElement("div");
  list.className = "todo-task-list";
  list.dataset.todoList = "true";

  const footer = documentRef.createElement("div");
  footer.className = "todo-manager-footer";

  const summary = documentRef.createElement("p");
  summary.className = "todo-manager-summary";
  summary.dataset.todoSummary = "true";

  const clearButton = documentRef.createElement("button");
  clearButton.type = "button";
  clearButton.className = "todo-clear-button";
  clearButton.dataset.todoAction = "clear-completed";
  clearButton.textContent = "清空已完成";

  footer.append(summary, clearButton);
  listPanel.append(filters, toolbar, list, footer);
  editorPanel.append(editorTitle, form);
  drawer.append(drawerPeekButton, sticker, listPanel, editorPanel);
  root.append(drawerToggle, drawer);

  return {
    root,
    elements: {
      root,
      drawer,
      drawerToggle,
      drawerTogglePet: petPeek,
      listPanel,
      editorPanel,
      editorTitle,
      form,
      titleInput,
      prioritySelect,
      dueInput,
      addNewButton,
      cancelButton,
      deleteEditorButton,
      filters,
      list,
      summary,
      clearButton,
    },
  };
};

export const renderTodoTasks = ({ documentRef, elements, state }) => {
  const today = state.today;
  const visibleTasks = getVisibleTasks({ tasks: state.tasks, filter: state.filter, today });
  const editingTask = state.editingTaskId
    ? state.tasks.find((task) => task.id === state.editingTaskId) ?? null
    : null;
  const isEditorOpen = state.mode === "create" || Boolean(editingTask);
  const isDrawerOpen = Boolean(state.drawerOpen);
  const hasTodayActiveTasks = state.tasks.some((task) => !task.completed && task.dueDate === today);

  elements.root?.setAttribute?.("data-todo-drawer-open", String(isDrawerOpen));
  elements.root?.setAttribute?.("data-todo-has-today-tasks", String(hasTodayActiveTasks));
  elements.drawerTogglePet.src = hasTodayActiveTasks ? TODO_PET_GROOM_IMAGE : TODO_PET_GROOM_IDLE_IMAGE;
  elements.drawer.setAttribute("aria-hidden", String(!isDrawerOpen));
  elements.drawerToggle.setAttribute("aria-expanded", String(isDrawerOpen));
  elements.drawerToggle.setAttribute("aria-label", isDrawerOpen ? "收起待办抽屉" : "展开待办抽屉");
  elements.listPanel.hidden = isEditorOpen;
  elements.editorPanel.hidden = !isEditorOpen;
  elements.editorTitle.textContent = editingTask ? "编辑任务" : "新增任务";
  elements.deleteEditorButton.hidden = !editingTask;

  if (isEditorOpen) {
    elements.titleInput.value = editingTask?.title ?? "";
    elements.prioritySelect.value = editingTask?.priority ?? DEFAULT_TODO_PRIORITY;
    elements.dueInput.value = editingTask?.dueDate ?? "";
  }

  elements.list.replaceChildren();

  for (const task of visibleTasks) {
    const row = documentRef.createElement("article");
    row.className = "todo-task";
    row.dataset.todoTask = task.id;
    row.dataset.priority = task.priority;
    row.dataset.completed = String(task.completed);
    row.dataset.overdue = String(isTaskOverdue(task, today));

    const checkbox = documentRef.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "todo-task-toggle";
    checkbox.dataset.todoAction = "toggle";
    checkbox.checked = task.completed;
    checkbox.setAttribute("aria-label", `切换任务：${task.title}`);

    const title = documentRef.createElement("span");
    title.className = "todo-task-title";
    title.dataset.todoTaskTitle = "true";
    title.textContent = task.title;

    const meta = documentRef.createElement("span");
    meta.className = "todo-task-meta";

    const priorityMarker = documentRef.createElement("span");
    priorityMarker.className = "todo-priority-marker";
    priorityMarker.dataset.priority = task.priority;
    priorityMarker.setAttribute("aria-label", `${TODO_PRIORITY_LABELS[task.priority]}优先级`);

    const dueDateText = documentRef.createElement("span");
    dueDateText.className = "todo-task-due-date";
    dueDateText.textContent = task.dueDate || "无截止日期";

    meta.append(priorityMarker, dueDateText);

    const editButton = documentRef.createElement("button");
    editButton.type = "button";
    editButton.className = "todo-edit-button";
    editButton.dataset.todoAction = "edit";
    editButton.setAttribute("aria-label", `编辑任务：${task.title}`);
    editButton.textContent = "编辑";

    row.append(checkbox, title, meta, editButton);
    elements.list.appendChild(row);
  }

  if (visibleTasks.length === 0) {
    const empty = documentRef.createElement("p");
    empty.className = "todo-empty-state";
    empty.textContent = state.filter === TODO_FILTERS.all ? "还没有任务。" : "当前筛选没有任务。";
    elements.list.appendChild(empty);
  }

  for (const button of elements.filters.querySelectorAll("[data-todo-filter]")) {
    const selected = button.dataset.todoFilter === state.filter;
    button.dataset.active = String(selected);
    button.setAttribute("aria-selected", String(selected));
  }

  const activeCount = state.tasks.filter((task) => !task.completed).length;
  const completedCount = state.tasks.length - activeCount;
  elements.summary.textContent = `${activeCount} 个进行中 · ${completedCount} 个已完成`;
  elements.clearButton.disabled = completedCount === 0;
};
