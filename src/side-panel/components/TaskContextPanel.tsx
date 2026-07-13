import { useState } from "react";
import type { WorkflowContextItem, WorkflowTask } from "../../shared/types";
import { useAppStore } from "../state/appStore";

interface TaskContextPanelProps {
  task: WorkflowTask;
}

export function TaskContextPanel({ task }: TaskContextPanelProps) {
  if (task.contextItems.length === 0) {
    return null;
  }

  return (
    <details className="task-context-panel">
      <summary className="task-context-summary">上下文 {task.contextItems.length}</summary>
      <div className="task-context-list">
        {task.contextItems.map((item) => (
          <TaskContextRow key={item.id} taskId={task.id} item={item} />
        ))}
      </div>
    </details>
  );
}

function TaskContextRow({ taskId, item }: { taskId: string; item: WorkflowContextItem }) {
  const [refreshing, setRefreshing] = useState(false);
  const refreshPageContext = useAppStore((state) => state.refreshPageContext);
  const updateWorkflowContextItem = useAppStore((state) => state.updateWorkflowContextItem);
  const toggleWorkflowContextPinned = useAppStore((state) => state.toggleWorkflowContextPinned);
  const removeWorkflowContextItem = useAppStore((state) => state.removeWorkflowContextItem);

  const canRefresh = item.kind === "tab" || item.kind === "page-content";
  const refreshContext = async () => {
    if (!canRefresh || refreshing) {
      return;
    }

    setRefreshing(true);
    try {
      await refreshPageContext();
      const pageContext = useAppStore.getState().pageContext;
      await updateWorkflowContextItem(taskId, item.id, {
        title: pageContext.title || item.title,
        summary: createPageContextSummary(pageContext.text, pageContext.url),
        capturedAt: Date.now(),
        truncated: Boolean(pageContext.truncated),
      });
    } finally {
      setRefreshing(false);
    }
  };
  const summarizeContext = async () => {
    await updateWorkflowContextItem(taskId, item.id, {
      title: item.title,
      summary: createLocalContextSummary(item.summary),
      capturedAt: Date.now(),
      truncated: item.truncated,
    });
  };

  return (
    <article className="task-context-item">
      <div className="task-context-item-header">
        <span className="task-context-kind">{formatContextKind(item.kind)}</span>
        <span className="task-context-title">{item.title}</span>
        <div className="task-context-actions">
          <button
            className="task-icon-button"
            type="button"
            aria-label={item.pinned ? `取消固定上下文：${item.title}` : `固定上下文：${item.title}`}
            title={item.pinned ? "取消固定" : "固定"}
            aria-pressed={Boolean(item.pinned)}
            onClick={() => void toggleWorkflowContextPinned(taskId, item.id)}
          >
            <PinIcon />
          </button>
          <button
            className="task-icon-button"
            type="button"
            aria-label={`摘要上下文：${item.title}`}
            title="摘要"
            onClick={() => void summarizeContext()}
          >
            <SummarizeIcon />
          </button>
          {canRefresh ? (
            <button
              className="task-icon-button"
              type="button"
              aria-label={`刷新上下文：${item.title}`}
              title="刷新"
              disabled={refreshing}
              onClick={() => void refreshContext()}
            >
              <RefreshIcon />
            </button>
          ) : null}
          <button
            className="task-icon-button"
            type="button"
            aria-label={`移除上下文：${item.title}`}
            title="移除"
            onClick={() => void removeWorkflowContextItem(taskId, item.id)}
          >
            <TrashIcon />
          </button>
        </div>
      </div>
      <p className="task-context-text">{item.summary}</p>
    </article>
  );
}

function createPageContextSummary(text: string, url?: string): string {
  const content = createLocalContextSummary(text);
  return content || url || "页面上下文暂无内容";
}

function createLocalContextSummary(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "暂无可摘要内容";
  }
  return normalized.length > 160 ? `${normalized.slice(0, 160)}...` : normalized;
}

function formatContextKind(kind: WorkflowContextItem["kind"]): string {
  switch (kind) {
    case "tab":
      return "标签页";
    case "page-content":
      return "页面";
    case "screenshot":
      return "截图";
    case "network":
      return "网络";
    case "js-source":
      return "源码";
    case "source-map":
      return "映射";
    case "runtime":
      return "运行";
    case "web-search":
      return "搜索";
    case "mcp":
      return "MCP";
    default:
      return "上下文";
  }
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 4 20 10" />
      <path d="M9 15 4 20" />
      <path d="M15 5 8 12l4 4 7-7" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v6h-6" />
    </svg>
  );
}

function SummarizeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 5h14" />
      <path d="M5 10h14" />
      <path d="M5 15h9" />
      <path d="M5 20h6" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 14h10l1-14" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}
