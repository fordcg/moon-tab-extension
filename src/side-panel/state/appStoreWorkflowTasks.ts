import type { StoreApi } from "zustand";
import {
  addWorkflowArtifact as appendWorkflowArtifact,
  addWorkflowContextItem as appendWorkflowContextItem,
  createWorkflowTask as createTask,
  normalizeWorkflowTask,
  removeWorkflowContextItem as removeContextItem,
  toggleWorkflowContextPinned as toggleContextPinned,
  transitionWorkflowTask,
} from "../../shared/chat/workflowTasks";
import { getRegisteredModelTools } from "../../shared/models/toolRegistry";
import { redactSensitiveText } from "../../shared/security/redaction";
import {
  getAppSetting,
  saveAppSetting,
  updateChatSession,
} from "../../shared/storage/repositories";
import type {
  ChatSession,
  ChatToolAttachment,
  ChatToolCallRecord,
  WorkflowArtifact,
  WorkflowArtifactKind,
  WorkflowContextItem,
  WorkflowContextKind,
  WorkflowSkill,
  WorkflowSkillVariable,
  WorkflowTask,
  WorkflowTaskStatus,
  WorkflowTaskStep,
  WorkflowTaskTemplate,
} from "../../shared/types";
import type { AppState } from "./appStore";
import { upsertSession } from "./appStoreSessionUtils";

export const WORKFLOW_SKILLS_SETTINGS_KEY = "aiSidebar.workflowSkills.v1";

type StoreGet = StoreApi<AppState>["getState"];
type StoreSet = StoreApi<AppState>["setState"];

export function createWorkflowTaskStepFromToolRecord(record: ChatToolCallRecord): WorkflowTaskStep {
  return {
    id: `workflow-step-tool-${record.id}`,
    title: redactSensitiveText(record.displayName || record.name || record.toolId).trim() || "工具调用",
    status: record.status === "error" ? "failed" : record.status === "success" ? "completed" : "running",
    toolCallId: record.id,
    detail: redactSensitiveText(record.errorMessage || record.resultSummary || "").trim() || undefined,
    updatedAt: record.completedAt ?? record.startedAt,
  };
}

export function createWorkflowContextItemsFromToolAttachments(attachments: ChatToolAttachment[]): WorkflowContextItem[] {
  return attachments.map((attachment) => ({
    id: `workflow-context-tool-${attachment.id}`,
    kind: workflowContextKindFromAttachment(attachment),
    title: redactSensitiveText(attachment.title).trim() || "工具结果",
    summary: redactSensitiveText(attachment.summary).trim(),
    capturedAt: attachment.createdAt,
    redacted: true,
    truncated: attachment.truncated,
    sensitive: false,
  }));
}

export function createWorkflowTaskActions({ get, set }: { get: StoreGet; set: StoreSet }) {
  async function updateCurrentSession(
    update: (session: ChatSession) => ChatSession,
  ): Promise<ChatSession | undefined> {
    const state = get();
    const privateSession = state.privateModeActive ? state.privateChatSession : undefined;
    if (privateSession) {
      const nextSession = update(privateSession);
      if (nextSession === privateSession) {
        return privateSession;
      }

      set((current) => {
        if (!current.privateModeActive || current.privateChatSession?.id !== privateSession.id) {
          return {};
        }
        return { privateChatSession: nextSession };
      });
      return nextSession;
    }

    const session = state.chatSessions.find((item) => item.id === state.activeSessionId);
    if (!session) {
      return undefined;
    }

    const persistedSession = await updateChatSession(session.id, (latestSession) => update(latestSession));
    if (persistedSession) {
      set((current) => ({
        chatSessions: upsertSession(current.chatSessions, persistedSession),
      }));
    }
    return persistedSession;
  }

  async function updateTask(taskId: string, transform: (task: WorkflowTask, now: number) => WorkflowTask): Promise<void> {
    await updateCurrentSession((session) => {
      const now = nextSessionTimestamp(session);
      let updated = false;
      const workflowTasks = (session.workflowTasks ?? []).map((task) => {
        if (task.id !== taskId) {
          return task;
        }
        const nextTask = transform(task, now);
        updated ||= nextTask !== task;
        return nextTask;
      });

      return updated
        ? { ...session, updatedAt: now, workflowTasks }
        : session;
    });
  }

  return {
    createWorkflowTask: async (template: WorkflowTaskTemplate, objective: string): Promise<WorkflowTask> => {
      let createdTask: WorkflowTask | undefined;
      const session = await updateCurrentSession((currentSession) => {
        const now = nextSessionTimestamp(currentSession);
        createdTask = createTask(currentSession.id, template, objective, now);
        return {
          ...currentSession,
          updatedAt: now,
          workflowTasks: [...(currentSession.workflowTasks ?? []), createdTask],
        };
      });

      if (!session || !createdTask) {
        throw new Error("请先选择一个会话");
      }
      return createdTask;
    },
    updateWorkflowTaskStatus: async (taskId: string, status: WorkflowTaskStatus, reason?: string): Promise<void> => {
      await updateTask(taskId, (task, now) => transitionWorkflowTask(task, status, now, reason));
    },
    upsertWorkflowTaskStep: async (taskId: string, step: WorkflowTaskStep): Promise<void> => {
      await updateTask(taskId, (task, now) => {
        const steps = [...task.steps.filter((item) => item.id !== step.id), step];
        const normalized = normalizeWorkflowTask({ ...task, updatedAt: now, steps });
        return normalized ?? task;
      });
    },
    addWorkflowContextItem: async (taskId: string, item: WorkflowContextItem): Promise<void> => {
      await updateTask(taskId, (task, now) => withTaskTimestamp(appendWorkflowContextItem(task, item), now));
    },
    removeWorkflowContextItem: async (taskId: string, contextItemId: string): Promise<void> => {
      await updateTask(taskId, (task, now) => withTaskTimestamp(removeContextItem(task, contextItemId), now));
    },
    toggleWorkflowContextPinned: async (taskId: string, contextItemId: string): Promise<void> => {
      await updateTask(taskId, (task, now) => withTaskTimestamp(toggleContextPinned(task, contextItemId), now));
    },
    addWorkflowArtifact: async (taskId: string, artifact: WorkflowArtifact): Promise<void> => {
      await updateTask(taskId, (task, now) => withTaskTimestamp(appendWorkflowArtifact(task, artifact), now));
    },
    loadWorkflowSkills: async (): Promise<void> => {
      const skills = normalizeWorkflowSkills(await getAppSetting<unknown>(WORKFLOW_SKILLS_SETTINGS_KEY));
      set({ workflowSkills: skills });
    },
    saveWorkflowSkill: async (
      taskId: string,
      draft: Pick<WorkflowSkill, "title" | "variables">,
    ): Promise<WorkflowSkill> => {
      const task = findActiveTask(get(), taskId);
      if (!task) {
        throw new Error("未找到工作流任务");
      }

      const title = cleanText(draft.title);
      if (!title) {
        throw new Error("技能标题不能为空");
      }
      const variables = normalizeWorkflowSkillVariables(draft.variables);
      const now = Date.now();
      const skill: WorkflowSkill = {
        id: `workflow-skill-${now}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        template: task.template,
        objectiveTemplate: task.objective,
        variables,
        requiredContextKinds: unique(task.contextItems.map((item) => item.kind)),
        recommendedToolIds: [],
        artifactKinds: unique(task.artifacts.map((artifact) => artifact.kind)),
        createdAt: now,
        updatedAt: now,
      };
      const workflowSkills = [...get().workflowSkills, skill];
      await saveAppSetting({
        key: WORKFLOW_SKILLS_SETTINGS_KEY,
        value: workflowSkills,
        updatedAt: now,
      });
      set({ workflowSkills });
      return skill;
    },
    startWorkflowSkill: async (skillId: string, values: Record<string, string>): Promise<WorkflowTask> => {
      const skill = get().workflowSkills.find((item) => item.id === skillId);
      if (!skill) {
        throw new Error("未找到工作流技能");
      }

      const objective = resolveSkillObjective(skill, values);
      const task = await get().createWorkflowTask(skill.template, objective);
      const availableToolIds = new Set(getRegisteredModelTools(get().mcpSettings).map((tool) => tool.id));
      const unavailableToolIds = skill.recommendedToolIds.filter((toolId) => !availableToolIds.has(toolId));
      if (unavailableToolIds.length) {
        await get().updateWorkflowTaskStatus(task.id, "running");
        await get().updateWorkflowTaskStatus(task.id, "waiting", `推荐工具不可用：${unavailableToolIds.join("、")}`);
        return findActiveTask(get(), task.id) ?? task;
      }
      return task;
    },
  };
}

function findActiveTask(state: AppState, taskId: string): WorkflowTask | undefined {
  const session = state.privateModeActive ? state.privateChatSession : state.chatSessions.find((item) => item.id === state.activeSessionId);
  return session?.workflowTasks?.find((task) => task.id === taskId);
}

function nextSessionTimestamp(session: ChatSession): number {
  return Math.max(Date.now(), session.updatedAt + 1);
}

function withTaskTimestamp(task: WorkflowTask, updatedAt: number): WorkflowTask {
  return task.updatedAt === updatedAt ? task : { ...task, updatedAt };
}

function resolveSkillObjective(skill: WorkflowSkill, values: Record<string, string>): string {
  for (const variable of skill.variables) {
    const value = cleanText(values[variable.id]);
    if (variable.required && !value) {
      throw new Error(`${variable.label}不能为空`);
    }
  }

  return skill.variables.reduce(
    (objective, variable) => objective.split(`{{${variable.id}}}`).join(cleanText(values[variable.id])),
    skill.objectiveTemplate,
  );
}

function normalizeWorkflowSkills(value: unknown): WorkflowSkill[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeWorkflowSkill).filter((skill): skill is WorkflowSkill => skill !== null);
}

function normalizeWorkflowSkill(value: unknown): WorkflowSkill | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Partial<WorkflowSkill>;
  const id = cleanText(source.id);
  const title = cleanText(source.title);
  const objectiveTemplate = cleanText(source.objectiveTemplate);
  if (!id || !title || !objectiveTemplate || !isWorkflowTemplate(source.template) || !isTimestamp(source.createdAt) || !isTimestamp(source.updatedAt)) {
    return null;
  }

  return {
    id,
    title,
    template: source.template,
    objectiveTemplate,
    variables: normalizeWorkflowSkillVariables(source.variables),
    requiredContextKinds: normalizeEnumList<WorkflowContextKind>(source.requiredContextKinds, [
      "tab", "page-content", "screenshot", "network", "js-source", "source-map", "runtime", "web-search", "mcp",
    ]),
    recommendedToolIds: Array.isArray(source.recommendedToolIds)
      ? unique(source.recommendedToolIds.map(cleanText).filter(Boolean))
      : [],
    artifactKinds: normalizeEnumList<WorkflowArtifactKind>(source.artifactKinds, [
      "conclusion", "table", "code", "debug-report", "automation-report", "screenshot",
    ]),
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

function normalizeWorkflowSkillVariables(value: unknown): WorkflowSkillVariable[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const source = item as Partial<WorkflowSkillVariable>;
    const id = cleanText(source.id);
    const label = cleanText(source.label);
    return id && label && typeof source.required === "boolean" ? [{ id, label, required: source.required }] : [];
  });
}

function normalizeEnumList<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  return Array.isArray(value) ? unique(value.filter((item): item is T => typeof item === "string" && allowed.includes(item as T))) : [];
}

function isWorkflowTemplate(value: unknown): value is WorkflowTaskTemplate {
  return value === "debug" || value === "research" || value === "automation";
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? redactSensitiveText(value).trim() : "";
}

function workflowContextKindFromAttachment(attachment: ChatToolAttachment): WorkflowContextKind {
  switch (attachment.kind) {
    case "web-search":
      return "web-search";
    case "network":
      return "network";
    case "js-source":
      return "js-source";
    case "source-map":
      return "source-map";
    case "browser-screenshot":
      return "screenshot";
    case "automation-report":
      return "runtime";
    default:
      return "mcp";
  }
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
