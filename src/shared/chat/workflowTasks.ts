import type {
  WorkflowArtifact,
  WorkflowArtifactKind,
  WorkflowContextItem,
  WorkflowContextKind,
  WorkflowStepStatus,
  WorkflowTask,
  WorkflowTaskStatus,
  WorkflowTaskTemplate,
} from "../types";
import { redactSensitiveText } from "../security/redaction";

const taskTemplates = new Set<WorkflowTaskTemplate>(["debug", "research", "automation"]);
const taskStatuses = new Set<WorkflowTaskStatus>(["preparing", "running", "waiting", "completed", "failed", "canceled"]);
const stepStatuses = new Set<WorkflowStepStatus>(["pending", "running", "completed", "failed", "skipped"]);
const contextKinds = new Set<WorkflowContextKind>(["tab", "page-content", "screenshot", "network", "js-source", "source-map", "runtime", "web-search", "mcp"]);
const artifactKinds = new Set<WorkflowArtifactKind>(["conclusion", "table", "code", "debug-report", "automation-report", "screenshot"]);
const transitions: Record<WorkflowTaskStatus, readonly WorkflowTaskStatus[]> = {
  preparing: ["running", "canceled"],
  running: ["waiting", "completed", "failed", "canceled"],
  waiting: ["running", "canceled", "failed"],
  completed: [],
  failed: [],
  canceled: [],
};

let taskSequence = 0;

export function createWorkflowTask(
  sessionId: string,
  template: WorkflowTaskTemplate,
  objective: string,
  now = Date.now(),
): WorkflowTask {
  const cleanedObjective = cleanText(objective) || "未命名工作流任务";
  const timestamp = normalizeOperationTimestamp(now, 0);

  return {
    id: `workflow-task-${timestamp}-${taskSequence++}`,
    sessionId: cleanText(sessionId) || "unknown-session",
    template,
    title: cleanedObjective.slice(0, 80),
    objective: cleanedObjective,
    status: "preparing",
    createdAt: timestamp,
    updatedAt: timestamp,
    contextItems: [],
    steps: [],
    artifacts: [],
  };
}

export function transitionWorkflowTask(
  task: WorkflowTask,
  status: WorkflowTaskStatus,
  now = Date.now(),
  statusReason?: string,
): WorkflowTask {
  if (!transitions[task.status].includes(status) || !isTimestamp(now) || now < task.updatedAt) {
    return task;
  }

  const cleanedReason = cleanOptionalText(statusReason);
  const { statusReason: _previousStatusReason, ...taskWithoutStatusReason } = task;
  return {
    ...taskWithoutStatusReason,
    status,
    updatedAt: now,
    ...(cleanedReason ? { statusReason: cleanedReason } : {}),
  };
}

export function normalizeWorkflowTask(value: unknown): WorkflowTask | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = cleanText(value.id);
  const sessionId = cleanText(value.sessionId);
  const title = cleanText(value.title);
  const objective = cleanText(value.objective);
  if (
    !id ||
    !sessionId ||
    !title ||
    !objective ||
    !isTaskTemplate(value.template) ||
    !isTaskStatus(value.status) ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt) ||
    value.updatedAt < value.createdAt
  ) {
    return null;
  }

  return {
    id,
    sessionId,
    template: value.template,
    title,
    objective,
    status: value.status,
    ...(cleanOptionalText(value.statusReason) ? { statusReason: cleanOptionalText(value.statusReason) } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    contextItems: Array.isArray(value.contextItems)
      ? value.contextItems.map(normalizeWorkflowContextItem).filter((item): item is WorkflowContextItem => item !== null)
      : [],
    steps: Array.isArray(value.steps)
      ? value.steps.map(normalizeWorkflowStep).filter((step): step is WorkflowTask["steps"][number] => step !== null)
      : [],
    artifacts: Array.isArray(value.artifacts)
      ? value.artifacts.map(normalizeWorkflowArtifact).filter((artifact): artifact is WorkflowArtifact => artifact !== null)
      : [],
  };
}

export function normalizeWorkflowTasks(value: unknown): WorkflowTask[] {
  return Array.isArray(value)
    ? value.map(normalizeWorkflowTask).filter((task): task is WorkflowTask => task !== null)
    : [];
}

export function addWorkflowContextItem(task: WorkflowTask, item: WorkflowContextItem): WorkflowTask {
  const normalizedItem = normalizeWorkflowContextItem(item);
  if (!normalizedItem) {
    return task;
  }

  return { ...task, contextItems: [...task.contextItems, normalizedItem] };
}

export function removeWorkflowContextItem(task: WorkflowTask, contextItemId: string): WorkflowTask {
  const contextItems = task.contextItems.filter((item) => item.id !== contextItemId);
  return contextItems.length === task.contextItems.length ? task : { ...task, contextItems };
}

export function toggleWorkflowContextPinned(task: WorkflowTask, contextItemId: string): WorkflowTask {
  let found = false;
  const contextItems = task.contextItems.map((item) => {
    if (item.id !== contextItemId) {
      return item;
    }
    found = true;
    return { ...item, pinned: !item.pinned };
  });

  return found ? { ...task, contextItems } : task;
}

export function addWorkflowArtifact(task: WorkflowTask, artifact: WorkflowArtifact): WorkflowTask {
  const normalizedArtifact = normalizeWorkflowArtifact(artifact);
  if (!normalizedArtifact) {
    return task;
  }

  return { ...task, artifacts: [...task.artifacts, normalizedArtifact] };
}

function normalizeWorkflowStep(value: unknown): WorkflowTask["steps"][number] | null {
  if (!isRecord(value) || !isStepStatus(value.status) || !isTimestamp(value.updatedAt)) {
    return null;
  }

  const id = cleanText(value.id);
  const title = cleanText(value.title);
  if (!id || !title) {
    return null;
  }

  const toolCallId = cleanOptionalText(value.toolCallId);
  const detail = cleanOptionalText(value.detail);
  return {
    id,
    title,
    status: value.status,
    ...(toolCallId ? { toolCallId } : {}),
    ...(detail ? { detail } : {}),
    updatedAt: value.updatedAt,
  };
}

function normalizeWorkflowContextItem(value: unknown): WorkflowContextItem | null {
  if (
    !isRecord(value) ||
    !isContextKind(value.kind) ||
    !isTimestamp(value.capturedAt) ||
    value.redacted !== true ||
    value.sensitive === true ||
    typeof value.truncated !== "boolean"
  ) {
    return null;
  }

  const id = cleanText(value.id);
  const title = cleanText(value.title);
  const summary = cleanText(value.summary);
  if (!id || !title || !summary) {
    return null;
  }

  return {
    id,
    kind: value.kind,
    title,
    summary,
    capturedAt: value.capturedAt,
    redacted: true,
    truncated: value.truncated,
    sensitive: false,
    ...(value.pinned === true ? { pinned: true } : {}),
    ...(isNonNegativeInteger(value.referenceCount) ? { referenceCount: value.referenceCount } : {}),
  };
}

function normalizeWorkflowArtifact(value: unknown): WorkflowArtifact | null {
  if (!isRecord(value) || !isArtifactKind(value.kind) || !isTimestamp(value.createdAt) || !Array.isArray(value.contextItemIds)) {
    return null;
  }

  const id = cleanText(value.id);
  const title = cleanText(value.title);
  const content = cleanText(value.content);
  const contextItemIds = value.contextItemIds.map(cleanText).filter(Boolean);
  if (!id || !title || !content) {
    return null;
  }

  return { id, kind: value.kind, title, content, contextItemIds, createdAt: value.createdAt };
}

function normalizeOperationTimestamp(value: number, fallback: number): number {
  return isTimestamp(value) ? value : fallback;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? redactSensitiveText(value).trim() : "";
}

function cleanOptionalText(value: unknown): string | undefined {
  const text = cleanText(value);
  return text || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isTaskTemplate(value: unknown): value is WorkflowTaskTemplate {
  return typeof value === "string" && taskTemplates.has(value as WorkflowTaskTemplate);
}

function isTaskStatus(value: unknown): value is WorkflowTaskStatus {
  return typeof value === "string" && taskStatuses.has(value as WorkflowTaskStatus);
}

function isStepStatus(value: unknown): value is WorkflowStepStatus {
  return typeof value === "string" && stepStatuses.has(value as WorkflowStepStatus);
}

function isContextKind(value: unknown): value is WorkflowContextKind {
  return typeof value === "string" && contextKinds.has(value as WorkflowContextKind);
}

function isArtifactKind(value: unknown): value is WorkflowArtifactKind {
  return typeof value === "string" && artifactKinds.has(value as WorkflowArtifactKind);
}
