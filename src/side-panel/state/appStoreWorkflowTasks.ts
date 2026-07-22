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
import { getRegisteredModelTools, resolveEnabledModelTools } from "../../shared/models/toolRegistry";
import { redactSensitiveText } from "../../shared/security/redaction";
import {
  getAppSetting,
  saveAppSetting,
  updateChatSession,
} from "../../shared/storage/repositories";
import { truncateText } from "../../shared/utils/text";
import type {
  ChatMessage,
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
import { resolveEffectiveChatPreferences, resolveRuntimeEnabledToolIds } from "./appStorePreferences";
import { upsertSession } from "./appStoreSessionUtils";

export const WORKFLOW_SKILLS_SETTINGS_KEY = "aiSidebar.workflowSkills.v1";
const WORKFLOW_CONTEXT_SUMMARY_LIMIT = 1200;
const WORKFLOW_ARTIFACT_CONTENT_LIMIT = 12000;
const DATA_URL_PATTERN = /\bdata:[^\s"'`)<>]+/gi;
const DEBUG_STEP_KEYWORDS = [
  "network", "js", "javascript", "source map", "sourcemap", "runtime", "console", "performance", "diagnostic",
  "signature", "sign", "sig", "nonce", "crypto", "encrypt", "hash",
  "网络", "请求", "源码", "映射", "运行时", "控制台", "性能", "诊断", "重放", "完全访问",
  "签名", "加签", "验签", "加密",
];
const AUTOMATION_OPERATION_KEYWORDS = [
  "click", "fill", "press", "scroll", "hover", "double_click", "context_click", "drag", "wait", "navigate", "new page", "select page", "close page",
  "点击", "填写", "按键", "滚动", "悬停", "双击", "右键", "拖拽", "等待", "导航", "新建", "切换", "关闭",
];

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
  return attachments
    .filter((attachment) => attachment.redacted !== false)
    .map((attachment) => {
      const summary = truncateText(redactSensitiveText(attachment.summary).trim(), WORKFLOW_CONTEXT_SUMMARY_LIMIT);
      return {
        id: `workflow-context-tool-${attachment.id}`,
        kind: workflowContextKindFromAttachment(attachment),
        title: redactSensitiveText(attachment.title).trim() || "工具结果",
        summary: summary.text,
        capturedAt: attachment.createdAt,
        redacted: true,
        truncated: attachment.truncated || summary.truncated,
        sensitive: false,
      };
    });
}

export function createWorkflowArtifactFromAssistantMessage(
  task: WorkflowTask,
  message: ChatMessage,
  now: number = message.createdAt,
): WorkflowArtifact | undefined {
  return createWorkflowArtifactsFromAssistantMessage(task, message, now)[0];
}

export function createWorkflowArtifactsFromAssistantMessage(
  task: WorkflowTask,
  message: ChatMessage,
  now: number = message.createdAt,
): WorkflowArtifact[] {
  if (message.role !== "assistant") {
    return [];
  }

  const content = cleanArtifactContent(message.content);
  if (!content) {
    return [];
  }

  const contextItemIds = task.contextItems
    .filter((item) => item.redacted === true && item.sensitive !== true)
    .map((item) => item.id);
  const artifacts = [
    createWorkflowArtifact(task, resolvePrimaryArtifactKind(task), content, contextItemIds, now, 0),
  ];
  if (task.template === "research") {
    const tableContent = extractMarkdownTables(content);
    if (tableContent) {
      artifacts.push(createWorkflowArtifact(task, "table", tableContent, contextItemIds, now, artifacts.length));
    }
  }

  return artifacts;
}

export function createWorkflowTaskActions({ get, set }: { get: StoreGet; set: StoreSet }) {
  async function ensureCurrentSession(): Promise<void> {
    const state = get();
    const currentSessionId = state.privateModeActive ? state.privateChatSession?.id : state.activeSessionId;
    if (currentSessionId) {
      return;
    }
    if (state.privateModeActive) {
      throw new Error("隐私会话不可用，请退出隐私模式后重试");
    }

    await state.createChatSession({ preserveSelectedModel: true });
  }

  async function updateCurrentSession(
    update: (session: ChatSession) => ChatSession,
  ): Promise<ChatSession | undefined> {
    const state = get();
    const currentSessionId = state.privateModeActive ? state.privateChatSession?.id : state.activeSessionId;
    return currentSessionId ? updateSessionById(currentSessionId, update) : undefined;
  }

  async function updateSessionById(
    sessionId: string,
    update: (session: ChatSession) => ChatSession,
  ): Promise<ChatSession | undefined> {
    const state = get();
    if (state.syncRestoreBarrierActive) {
      return undefined;
    }
    const privateSession = state.privateChatSession?.id === sessionId ? state.privateChatSession : undefined;
    if (privateSession) {
      const nextSession = update(privateSession);
      if (nextSession === privateSession) {
        return privateSession;
      }

      set((current) => {
        if (current.privateChatSession?.id !== privateSession.id) {
          return {};
        }
        return { privateChatSession: nextSession };
      });
      return nextSession;
    }

    const session = state.chatSessions.find((item) => item.id === sessionId);
    if (!session) {
      return undefined;
    }

    const persistedSession = await updateChatSession(session.id, (latestSession) => (
      get().syncRestoreBarrierActive ? undefined : update(latestSession)
    ));
    if (persistedSession) {
      set((current) => ({
        chatSessions: upsertSession(current.chatSessions, persistedSession),
      }));
    }
    return persistedSession;
  }

  async function updateTask(taskId: string, transform: (task: WorkflowTask, now: number) => WorkflowTask): Promise<void> {
    const owner = findTaskOwner(get(), taskId);
    if (!owner) {
      return;
    }

    await updateSessionById(owner.sessionId, (session) => {
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
      if (get().syncRestoreBarrierActive) {
        throw new Error("正在恢复备份，请稍后重试");
      }
      await ensureCurrentSession();
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
        throw new Error("任务会话创建失败");
      }
      return createdTask;
    },
    updateWorkflowTaskStatus: async (taskId: string, status: WorkflowTaskStatus, reason?: string): Promise<void> => {
      await updateTask(taskId, (task, now) => transitionWorkflowTask(task, status, now, reason));
    },
    cancelWorkflowTask: async (taskId: string): Promise<void> => {
      const owner = findTaskOwner(get(), taskId);
      if (!owner || !["preparing", "running", "waiting"].includes(owner.task.status)) {
        return;
      }

      const activeChatTask = get().chatTasksBySessionId[owner.sessionId];
      if (activeChatTask?.status === "running" && activeChatTask.workflowTaskId === taskId) {
        get().abortChatTask(owner.sessionId);
      }
      await updateTask(taskId, (task, now) => transitionWorkflowTask(task, "canceled", now));
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
    updateWorkflowContextItem: async (
      taskId: string,
      contextItemId: string,
      updates: Pick<WorkflowContextItem, "title" | "summary" | "capturedAt" | "truncated">,
    ): Promise<void> => {
      await updateTask(taskId, (task, now) => {
        let found = false;
        const contextItems = task.contextItems.map((item) => {
          if (item.id !== contextItemId) {
            return item;
          }

          found = true;
          return {
            ...item,
            title: cleanText(updates.title) || item.title,
            summary: cleanText(updates.summary) || item.summary,
            capturedAt: isTimestamp(updates.capturedAt) ? updates.capturedAt : now,
            truncated: updates.truncated,
            redacted: true,
            sensitive: false,
          };
        });
        if (!found) {
          return task;
        }

        const normalized = normalizeWorkflowTask({ ...task, updatedAt: now, contextItems });
        return normalized ?? task;
      });
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
      if (task.status !== "completed") {
        throw new Error("任务完成后才能保存技能");
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
      const state = get();
      const session = state.privateChatSession?.id === task.sessionId
        ? state.privateChatSession
        : state.chatSessions.find((item) => item.id === task.sessionId);
      const effectiveChatPreferences = resolveEffectiveChatPreferences(state.chatPreferences, session?.chatPreferenceOverrides);
      const registeredTools = getRegisteredModelTools(state.mcpSettings);
      const enabledToolIds = effectiveChatPreferences.toolCallingEnabled
        ? resolveRuntimeEnabledToolIds(effectiveChatPreferences.enabledToolIds, state.browserControlEnabled, state.browserAutomationMode)
        : [];
      const availableToolIds = new Set(resolveEnabledModelTools(registeredTools, enabledToolIds).map((tool) => tool.id));
      const unavailableToolIds = skill.recommendedToolIds.filter((toolId) => !availableToolIds.has(toolId));
      if (unavailableToolIds.length) {
        await get().updateWorkflowTaskStatus(task.id, "running");
        await get().updateWorkflowTaskStatus(task.id, "waiting", `推荐工具不可用：${unavailableToolIds.join("、")}`);
        return findActiveTask(get(), task.id) ?? task;
      }
      await get().sendWorkflowTaskMessage(task.id, objective);
      return findActiveTask(get(), task.id) ?? task;
    },
  };
}

function findTaskOwner(state: AppState, taskId: string): { sessionId: string; task: WorkflowTask } | undefined {
  const privateTask = state.privateChatSession?.workflowTasks?.find((task) => task.id === taskId);
  if (privateTask) {
    return { sessionId: state.privateChatSession!.id, task: privateTask };
  }

  for (const session of state.chatSessions) {
    const task = session.workflowTasks?.find((item) => item.id === taskId);
    if (task) {
      return { sessionId: session.id, task };
    }
  }

  return undefined;
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
    (objective, variable) => objective.replace(createSkillVariablePattern(variable.id), cleanText(values[variable.id])),
    skill.objectiveTemplate,
  );
}

function createSkillVariablePattern(variableId: string): RegExp {
  return new RegExp(`{{\\s*${escapeRegExp(variableId)}\\s*}}`, "g");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function createWorkflowArtifact(
  task: WorkflowTask,
  kind: WorkflowArtifactKind,
  content: string,
  contextItemIds: string[],
  createdAt: number,
  sequence: number,
): WorkflowArtifact {
  return {
    id: `workflow-artifact-${task.id}-${createdAt}-${sequence}-${kind}`,
    kind,
    title: artifactTitle(kind),
    content,
    contextItemIds,
    createdAt,
  };
}

function resolvePrimaryArtifactKind(task: WorkflowTask): WorkflowArtifactKind {
  if (task.template === "debug" && hasCompletedStepMatching(task, DEBUG_STEP_KEYWORDS)) {
    return "debug-report";
  }
  if (task.template === "automation" && hasCompletedStepMatching(task, AUTOMATION_OPERATION_KEYWORDS)) {
    return "automation-report";
  }

  return "conclusion";
}

function hasCompletedStepMatching(task: WorkflowTask, keywords: string[]): boolean {
  return task.steps.some((step) => step.status === "completed" && includesAnyKeyword(step.title, keywords));
}

function includesAnyKeyword(value: string, keywords: string[]): boolean {
  const normalized = value.toLowerCase();
  return keywords.some((keyword) => {
    if (keyword === "js") {
      return /(^|[\s:：/._-])js($|[\s:：/._-])/.test(normalized);
    }

    return normalized.includes(keyword);
  });
}

function cleanArtifactContent(value: string): string {
  return truncateText(redactSensitiveText(value).replace(DATA_URL_PATTERN, "[已移除 data URL]").trim(), WORKFLOW_ARTIFACT_CONTENT_LIMIT).text;
}

function extractMarkdownTables(content: string): string {
  const lines = content.split(/\r?\n/);
  const tables: string[] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!isMarkdownTableRow(lines[index]) || !isMarkdownTableDelimiter(lines[index + 1])) {
      continue;
    }

    let endIndex = index + 2;
    while (endIndex < lines.length && isMarkdownTableRow(lines[endIndex])) {
      endIndex += 1;
    }
    tables.push(lines.slice(index, endIndex).join("\n"));
    index = endIndex - 1;
  }

  return truncateText(tables.join("\n\n"), WORKFLOW_ARTIFACT_CONTENT_LIMIT).text.trim();
}

function isMarkdownTableRow(value: string): boolean {
  return /^\s*\|.+\|\s*$/.test(value);
}

function isMarkdownTableDelimiter(value: string): boolean {
  return /^\s*\|?[\s:-]+(?:\|[\s:-]+)+\|?\s*$/.test(value);
}

function artifactTitle(kind: WorkflowArtifactKind): string {
  switch (kind) {
    case "debug-report":
      return "调试报告";
    case "automation-report":
      return "自动化报告";
    case "table":
      return "表格摘录";
    case "code":
      return "代码产物";
    case "screenshot":
      return "截图产物";
    case "conclusion":
    default:
      return "任务结论";
  }
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
