import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_TODO_FILTER,
  DEFAULT_TODO_PRIORITY,
  TODO_FILTER_LABELS,
  TODO_FILTERS,
  TODO_PRIORITIES,
  TODO_PRIORITY_LABELS,
  TODO_STORAGE_VERSION,
} from "../widgets/todo/todo-constants.mjs";
import {
  addTask,
  clearCompletedTasks,
  deleteTask,
  getTodayDateString,
  getVisibleTasks,
  isTaskOverdue,
  normalizeFilter,
  updateTask,
} from "../widgets/todo/todo-model.mjs";
import { readTodoPayload, writeTodoPayload } from "../widgets/todo/todo-storage.mjs";
import type { TodoMode, TodoTask } from "./types";

const TODO_PET_GROOM_IMAGE = "./assets/hero/pet-groom/pet-groom.webp";
const TODO_PET_GROOM_IDLE_IMAGE = "./assets/hero/pet-groom/pet-groom-01.webp";

export function TodoWidget() {
  const [tasks, setTasks] = useState<TodoTask[]>([]);
  const [filter, setFilter] = useState<string>(DEFAULT_TODO_FILTER);
  const [mode, setMode] = useState<TodoMode>("list");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftPriority, setDraftPriority] = useState<string>(DEFAULT_TODO_PRIORITY);
  const [draftDueDate, setDraftDueDate] = useState("");
  const today = getTodayDateString();
  const visibleTasks = useMemo(() => getVisibleTasks({ tasks, filter, today }) as TodoTask[], [filter, tasks, today]);
  const editingTask = editingTaskId ? tasks.find((task) => task.id === editingTaskId) ?? null : null;
  const editorOpen = mode === "create" || Boolean(editingTask);
  const hasTodayActiveTasks = tasks.some((task) => !task.completed && task.dueDate === today);
  const completedCount = tasks.filter((task) => task.completed).length;
  const activeCount = tasks.length - completedCount;

  useEffect(() => {
    void readTodoPayload().then((payload) => setTasks(payload.tasks));
  }, []);

  const commitTasks = async (nextTasks: TodoTask[]) => {
    const payload = await writeTodoPayload({ version: TODO_STORAGE_VERSION, tasks: nextTasks });
    setTasks(payload.tasks);
  };

  const openCreate = () => {
    setDrawerOpen(true);
    setMode("create");
    setEditingTaskId("");
    setDraftTitle("");
    setDraftPriority(DEFAULT_TODO_PRIORITY);
    setDraftDueDate("");
  };

  const openEdit = (task: TodoTask) => {
    setDrawerOpen(true);
    setMode("edit");
    setEditingTaskId(task.id);
    setDraftTitle(task.title);
    setDraftPriority(task.priority);
    setDraftDueDate(task.dueDate);
  };

  const closeEditor = () => {
    setMode("list");
    setEditingTaskId("");
    setDraftTitle("");
    setDraftPriority(DEFAULT_TODO_PRIORITY);
    setDraftDueDate("");
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (editingTaskId) {
      const taskId = editingTaskId;
      closeEditor();
      await commitTasks(updateTask(tasks, taskId, { title: draftTitle, priority: draftPriority, dueDate: draftDueDate }) as TodoTask[]);
      return;
    }

    const nextTasks = addTask(tasks, { title: draftTitle, priority: draftPriority, dueDate: draftDueDate }) as TodoTask[];
    if (nextTasks.length === tasks.length) {
      return;
    }
    closeEditor();
    await commitTasks(nextTasks);
  };

  const toggleDrawer = () => {
    setDrawerOpen((value) => {
      const next = !value;
      if (!next) {
        closeEditor();
      }
      return next;
    });
  };

  return (
    <section className="todo-manager" data-todo-manager="true" data-todo-drawer-open={drawerOpen} data-todo-has-today-tasks={hasTodayActiveTasks}>
      <button className="todo-drawer-toggle" type="button" aria-label={drawerOpen ? "收起待办抽屉" : "展开待办抽屉"} aria-expanded={drawerOpen} onClick={toggleDrawer}>
        <img className="todo-drawer-toggle__pet" src={hasTodayActiveTasks ? TODO_PET_GROOM_IMAGE : TODO_PET_GROOM_IDLE_IMAGE} alt="" />
      </button>

      <div className="todo-drawer" data-todo-drawer="true" aria-hidden={!drawerOpen}>
        <button className="widget-note__pet-peek-button" type="button" aria-label="收起待办抽屉" onClick={toggleDrawer}>
          <img className="widget-note__pet-peek" src="./assets/hero/pet-left-peek.webp" alt="" />
        </button>
        <img className="widget-note__sticker" src="./assets/widgets/todo-sticker.webp" alt="" />

        <div className="todo-manager-panel todo-manager-panel--list" hidden={editorOpen}>
          <div className="todo-filter-list" role="tablist">
            {Object.entries(TODO_FILTER_LABELS).map(([filterId, label]) => (
              <button
                type="button"
                className="todo-filter-button"
                data-active={filter === filterId}
                key={filterId}
                onClick={() => setFilter(normalizeFilter(filterId))}
              >
                {label as string}
              </button>
            ))}
          </div>
          <div className="todo-manager-toolbar">
            <button className="todo-add-new-button" type="button" aria-label="新增任务" onClick={openCreate}>+</button>
          </div>

          <div className="todo-task-list">
            {visibleTasks.length ? visibleTasks.map((task) => (
              <article className="todo-task" data-priority={task.priority} data-completed={task.completed} data-overdue={isTaskOverdue(task, today)} key={task.id}>
                <input
                  className="todo-task-toggle"
                  type="checkbox"
                  checked={task.completed}
                  aria-label={`切换任务：${task.title}`}
                  onChange={(event) => void commitTasks(updateTask(tasks, task.id, { completed: event.currentTarget.checked }) as TodoTask[])}
                />
                <span className="todo-task-title">{task.title}</span>
                <span className="todo-task-meta">
                  <span className="todo-priority-marker" data-priority={task.priority} aria-label={`${TODO_PRIORITY_LABELS[task.priority]}优先级`} />
                  {task.dueDate ? <span className="todo-task-due-date">{task.dueDate}</span> : null}
                </span>
                <button className="todo-edit-button" type="button" onClick={() => openEdit(task)}>编辑</button>
              </article>
            )) : <p className="todo-empty-state">没有待办事项。</p>}
          </div>

          <div className="todo-manager-footer">
            <p className="todo-manager-summary">{activeCount} 项进行中，{completedCount} 项已完成</p>
            <button className="todo-clear-button" type="button" disabled={!completedCount} onClick={() => void commitTasks(clearCompletedTasks(tasks) as TodoTask[])}>
              清空已完成
            </button>
          </div>
        </div>

        <div className="todo-manager-panel todo-manager-panel--editor" hidden={!editorOpen}>
          <p className="todo-editor-title">{editingTask ? "编辑任务" : "新增任务"}</p>
          <form className="todo-manager-form" onSubmit={(event) => void handleSubmit(event)}>
            <input className="todo-title-input" type="text" placeholder="添加新任务" maxLength={80} autoComplete="off" value={draftTitle} onChange={(event) => setDraftTitle(event.currentTarget.value)} />
            <select className="todo-priority-select" value={draftPriority} onChange={(event) => setDraftPriority(event.currentTarget.value)}>
              <option value={TODO_PRIORITIES.high}>高优先级</option>
              <option value={TODO_PRIORITIES.medium}>中优先级</option>
              <option value={TODO_PRIORITIES.low}>低优先级</option>
            </select>
            <input className="todo-date-input" type="date" value={draftDueDate} onChange={(event) => setDraftDueDate(event.currentTarget.value)} />
            <button className="todo-add-button" type="submit">保存</button>
            <button className="todo-cancel-button" type="button" onClick={closeEditor}>取消</button>
            {editingTask ? <button className="todo-editor-delete-button" type="button" onClick={() => { closeEditor(); void commitTasks(deleteTask(tasks, editingTask.id) as TodoTask[]); }}>删除</button> : null}
          </form>
        </div>
      </div>
    </section>
  );
}
