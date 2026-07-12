import { useState } from "react";
import { redactSensitiveText } from "../../shared/security/redaction";
import type { WorkflowArtifact, WorkflowTask } from "../../shared/types";
import { useAppStore } from "../state/appStore";
import { copyTextToClipboard } from "../utils/messageClipboard";
import { downloadWorkflowTaskMarkdown } from "../utils/workflowMarkdownExport";
import { CopyMessageIcon } from "./MessageActionIcons";

const DATA_URL_PATTERN = /\bdata:[^\s"'`)<>]+/gi;

interface TaskArtifactsPanelProps {
  task: WorkflowTask;
}

export function TaskArtifactsPanel({ task }: TaskArtifactsPanelProps) {
  const [copyingArtifactId, setCopyingArtifactId] = useState<string | null>(null);
  const addNotification = useAppStore((state) => state.addNotification);

  if (task.artifacts.length === 0) {
    return null;
  }

  const exportTask = () => {
    try {
      downloadWorkflowTaskMarkdown(task);
      addNotification({ type: "success", title: "导出完成", message: "任务 Markdown 文件已开始下载" });
    } catch (error: unknown) {
      addNotification({ type: "error", title: "导出失败", message: error instanceof Error ? error.message : "导出失败，请重试" });
    }
  };

  const copyArtifact = async (artifact: WorkflowArtifact) => {
    if (copyingArtifactId) {
      return;
    }

    setCopyingArtifactId(artifact.id);
    try {
      await copyTextToClipboard(createArtifactCopyMarkdown(artifact));
      addNotification({ type: "success", title: "复制完成", message: "任务产物已复制" });
    } catch (error: unknown) {
      addNotification({ type: "error", title: "复制失败", message: error instanceof Error ? error.message : "复制失败，请重试" });
    } finally {
      setCopyingArtifactId(null);
    }
  };

  return (
    <section className="task-artifacts-panel" aria-label={`${task.title} 产物`}>
      <div className="task-artifacts-header">
        <h3 className="task-artifacts-title">产物 {task.artifacts.length}</h3>
        <button className="ui-button-secondary task-artifacts-export" type="button" onClick={exportTask}>
          <DownloadIcon />
          <span>导出任务 Markdown</span>
        </button>
      </div>
      <div className="task-artifacts-list">
        {task.artifacts.map((artifact) => {
          const title = sanitizeArtifactText(artifact.title) || "未命名产物";
          const content = sanitizeArtifactText(artifact.content) || "暂无内容。";
          return (
            <article className="task-artifact-item" key={artifact.id}>
              <div className="task-artifact-item-header">
                <span className="task-artifact-kind">{formatArtifactKind(artifact.kind)}</span>
                <span className="task-artifact-title">{title}</span>
                <button
                  className="task-icon-button"
                  type="button"
                  aria-label={`复制产物：${title}`}
                  title="复制"
                  disabled={Boolean(copyingArtifactId)}
                  onClick={() => void copyArtifact(artifact)}
                >
                  <CopyMessageIcon />
                </button>
              </div>
              <pre className="task-artifact-content">{content}</pre>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function createArtifactCopyMarkdown(artifact: WorkflowArtifact): string {
  const title = sanitizeArtifactText(artifact.title) || "未命名产物";
  const content = sanitizeArtifactText(artifact.content) || "暂无内容。";
  return [
    `# ${title}`,
    "",
    `- 类型：${formatArtifactKind(artifact.kind)}`,
    `- 创建时间：${new Date(artifact.createdAt).toISOString()}`,
    "",
    content,
  ].join("\n");
}

function sanitizeArtifactText(value: string): string {
  return redactSensitiveText(value).replace(DATA_URL_PATTERN, "[已移除 data URL]").trim();
}

function formatArtifactKind(kind: WorkflowArtifact["kind"]): string {
  switch (kind) {
    case "conclusion":
      return "结论";
    case "table":
      return "表格";
    case "code":
      return "代码";
    case "debug-report":
      return "调试报告";
    case "automation-report":
      return "自动化报告";
    case "screenshot":
      return "截图";
    default:
      return "产物";
  }
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 4v10" />
      <path d="m8 10 4 4 4-4" />
      <path d="M5 20h14" />
    </svg>
  );
}
