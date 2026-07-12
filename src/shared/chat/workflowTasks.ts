import { redactSensitiveText } from "../security/redaction";
import type { WorkflowArtifact, WorkflowContextItem, WorkflowTask, WorkflowTaskStatus, WorkflowTaskStep, WorkflowTaskTemplate } from "../types";

const templates: WorkflowTaskTemplate[] = ["debug", "research", "automation"];
const statuses: WorkflowTaskStatus[] = ["preparing", "running", "waiting", "completed", "failed", "canceled"];
const stepStatuses = ["pending", "running", "completed", "failed", "skipped"] as const;
const contextKinds = ["tab", "page-content", "screenshot", "network", "js-source", "source-map", "runtime", "web-search", "mcp"] as const;
const artifactKinds = ["conclusion", "table", "code", "debug-report", "automation-report", "screenshot"] as const;
const titleFor = (template: WorkflowTaskTemplate) => ({ debug: "开发调试", research: "网页研究", automation: "网页自动化" }[template]);

export function createWorkflowTask(sessionId: string, template: WorkflowTaskTemplate, objective: string, now = Date.now()): WorkflowTask {
  const cleanObjective = redactSensitiveText(objective).trim();
  return { id: `workflow-${now}-${Math.random().toString(36).slice(2, 8)}`, sessionId, template, title: cleanObjective.slice(0, 80) || titleFor(template), objective: cleanObjective, status: "preparing", createdAt: now, updatedAt: now, contextItems: [], steps: [], artifacts: [] };
}
export function transitionWorkflowTask(task: WorkflowTask, status: WorkflowTaskStatus, now = Date.now(), statusReason?: string): WorkflowTask {
  const allowed: Record<WorkflowTaskStatus, WorkflowTaskStatus[]> = { preparing: ["running", "canceled"], running: ["waiting", "completed", "failed", "canceled"], waiting: ["running", "canceled", "failed"], completed: [], failed: [], canceled: [] };
  if (!allowed[task.status].includes(status)) return task;
  return { ...task, status, updatedAt: now, statusReason: statusReason?.trim() || undefined };
}
export function normalizeWorkflowTask(value: unknown): WorkflowTask | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Partial<WorkflowTask>;
  if (!v.id?.trim() || !v.sessionId?.trim() || !v.title?.trim() || !v.objective?.trim() || !templates.includes(v.template as WorkflowTaskTemplate) || !statuses.includes(v.status as WorkflowTaskStatus)) return undefined;
  const steps = Array.isArray(v.steps) ? v.steps.filter((s): s is WorkflowTaskStep => Boolean(s && s.id?.trim() && s.title?.trim() && stepStatuses.includes(s.status))).map((s) => ({ ...s, detail: s.detail ? redactSensitiveText(s.detail).slice(0, 1000) : undefined })) : [];
  const contextItems = Array.isArray(v.contextItems) ? v.contextItems.filter((i): i is WorkflowContextItem => Boolean(i && i.id?.trim() && i.title?.trim() && contextKinds.includes(i.kind) && i.redacted !== false && i.sensitive !== true)).map((i) => ({ ...i, summary: redactSensitiveText(i.summary ?? "").slice(0, 1000), sensitive: false, redacted: true })) : [];
  const artifacts = Array.isArray(v.artifacts) ? v.artifacts.filter((a): a is WorkflowArtifact => Boolean(a && a.id?.trim() && a.title?.trim() && artifactKinds.includes(a.kind) && typeof a.content === "string")).map((a) => ({ ...a, content: redactSensitiveText(a.content).slice(0, 12000), contextItemIds: Array.isArray(a.contextItemIds) ? a.contextItemIds.filter((id): id is string => typeof id === "string") : [] })) : [];
  return { id: v.id.trim(), sessionId: v.sessionId.trim(), template: v.template as WorkflowTaskTemplate, title: redactSensitiveText(v.title).trim(), objective: redactSensitiveText(v.objective).trim(), status: v.status as WorkflowTaskStatus, statusReason: v.statusReason ? redactSensitiveText(v.statusReason).slice(0, 1000) : undefined, createdAt: typeof v.createdAt === "number" && Number.isFinite(v.createdAt) ? v.createdAt : Date.now(), updatedAt: typeof v.updatedAt === "number" && Number.isFinite(v.updatedAt) ? v.updatedAt : Date.now(), steps, contextItems, artifacts };
}
export const normalizeWorkflowTasks = (value: unknown) => Array.isArray(value) ? value.map(normalizeWorkflowTask).filter((task): task is WorkflowTask => Boolean(task)) : [];
export const addWorkflowContextItem = (task: WorkflowTask, item: WorkflowContextItem) => ({ ...task, contextItems: [...task.contextItems.filter((x) => x.id !== item.id), item], updatedAt: Date.now() });
export const removeWorkflowContextItem = (task: WorkflowTask, id: string) => ({ ...task, contextItems: task.contextItems.filter((x) => x.id !== id), updatedAt: Date.now() });
export const toggleWorkflowContextPinned = (task: WorkflowTask, id: string) => ({ ...task, contextItems: task.contextItems.map((x) => x.id === id ? { ...x, pinned: !x.pinned } : x), updatedAt: Date.now() });
export const addWorkflowArtifact = (task: WorkflowTask, artifact: WorkflowArtifact) => ({ ...task, artifacts: [...task.artifacts.filter((x) => x.id !== artifact.id), artifact], updatedAt: Date.now() });
