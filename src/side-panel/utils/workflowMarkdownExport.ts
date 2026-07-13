import type { WorkflowArtifact, WorkflowContextItem, WorkflowTask } from "../../shared/types";
import { redactSensitiveText } from "../../shared/security/redaction";
import { downloadBlob } from "./downloadBlob";

const DATA_URL_PATTERN = /\bdata:[^\s"'`)<>]+/gi;

export function createWorkflowTaskMarkdown(task: WorkflowTask, exportedAt: number = Date.now()): string {
  const contextItems = task.contextItems.filter((item) => item.redacted === true && item.sensitive !== true);
  const lines = [
    `# ${sanitizeMarkdownHeading(task.title)}`,
    "",
    `- 模板：${formatTemplateLabel(task.template)}`,
    `- 状态：${formatStatusLabel(task.status)}`,
    `- 导出时间：${formatDateTime(exportedAt)}`,
    `- 任务创建时间：${formatDateTime(task.createdAt)}`,
    `- 任务更新时间：${formatDateTime(task.updatedAt)}`,
    "",
    "## 上下文摘要",
    "",
  ];

  if (contextItems.length === 0) {
    lines.push("暂无已脱敏上下文。", "");
  } else {
    for (const item of contextItems) {
      lines.push(...formatContextItemMarkdown(item));
    }
  }

  lines.push("## 任务产物", "");
  if (task.artifacts.length === 0) {
    lines.push("暂无产物。", "");
  } else {
    for (const artifact of task.artifacts) {
      lines.push(...formatArtifactMarkdown(artifact, contextItems));
    }
  }

  return lines.join("\n");
}

export function createWorkflowTaskMarkdownFilename(task: WorkflowTask, exportedAt: number = Date.now()): string {
  const title = sanitizeFilenamePart(redactSensitiveText(task.title)).slice(0, 80) || "工作流任务";
  return `${title}-${formatDate(exportedAt)}.md`;
}

export function downloadWorkflowTaskMarkdown(task: WorkflowTask, exportedAt: number = Date.now()): void {
  const markdown = createWorkflowTaskMarkdown(task, exportedAt);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  downloadBlob(blob, createWorkflowTaskMarkdownFilename(task, exportedAt));
}

function formatContextItemMarkdown(item: WorkflowContextItem): string[] {
  return [
    `### ${sanitizeMarkdownHeading(item.title)}`,
    "",
    `- 类型：${formatContextKind(item.kind)}`,
    `- 捕获时间：${formatDateTime(item.capturedAt)}`,
    `- 已截断：${item.truncated ? "是" : "否"}`,
    "",
    sanitizeExportText(item.summary) || "暂无摘要。",
    "",
  ];
}

function formatArtifactMarkdown(artifact: WorkflowArtifact, contextItems: WorkflowContextItem[]): string[] {
  const referencedContextTitles = artifact.contextItemIds
    .map((contextItemId) => contextItems.find((item) => item.id === contextItemId)?.title)
    .filter((title): title is string => Boolean(title));
  return [
    `### ${sanitizeMarkdownHeading(artifact.title)}`,
    "",
    `- 类型：${formatArtifactKind(artifact.kind)}`,
    `- 创建时间：${formatDateTime(artifact.createdAt)}`,
    `- 引用上下文：${referencedContextTitles.length > 0 ? referencedContextTitles.map(sanitizeExportText).join("、") : "无"}`,
    "",
    sanitizeExportText(artifact.content) || "暂无内容。",
    "",
  ];
}

function sanitizeExportText(value: string): string {
  return redactSensitiveText(value).replace(DATA_URL_PATTERN, "[已移除 data URL]").trim();
}

function sanitizeMarkdownHeading(value: string): string {
  const sanitized = sanitizeExportText(value)
    .replace(/[\r\n]+/g, " ")
    .replace(/^#+\s*/g, "")
    .trim();

  return sanitized || "未命名任务";
}

function sanitizeFilenamePart(value: string): string {
  const sanitized = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  return sanitized.replace(/^\.+/, (dots) => "_".repeat(dots.length));
}

function formatTemplateLabel(template: WorkflowTask["template"]): string {
  switch (template) {
    case "debug":
      return "开发调试";
    case "research":
      return "网页研究";
    case "automation":
      return "网页自动化";
    default:
      return "任务";
  }
}

function formatStatusLabel(status: WorkflowTask["status"]): string {
  switch (status) {
    case "preparing":
      return "准备中";
    case "running":
      return "执行中";
    case "waiting":
      return "等待输入";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "canceled":
      return "已取消";
    default:
      return "未知";
  }
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
      return "Source Map";
    case "runtime":
      return "运行时";
    case "web-search":
      return "网络搜索";
    case "mcp":
      return "MCP";
    default:
      return "上下文";
  }
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

function formatDateTime(value: number): string {
  return new Date(value).toISOString();
}

function formatDate(value: number): string {
  return formatDateTime(value).slice(0, 10);
}
