import { addWorkflowArtifact as addArtifact, addWorkflowContextItem as addContext, createWorkflowTask as createTask, removeWorkflowContextItem as removeContext, toggleWorkflowContextPinned as togglePinned, transitionWorkflowTask } from "../../shared/chat/workflowTasks";
import { redactSensitiveText } from "../../shared/security/redaction";
import type { ChatMessage, ChatToolAttachment, ChatToolCallRecord, WorkflowArtifact, WorkflowContextItem, WorkflowSkill, WorkflowTask, WorkflowTaskStatus, WorkflowTaskStep, WorkflowTaskTemplate } from "../../shared/types";
import { getAppSetting, saveAppSetting, updateChatSession } from "../../shared/storage/repositories";
import { upsertSession } from "./appStoreSessionUtils";

const SKILLS_KEY = "aiSidebar.workflowSkills.v1";
type State = { activeSessionId: string; privateModeActive: boolean; privateChatSession?: import("../../shared/types").ChatSession; chatSessions: import("../../shared/types").ChatSession[]; workflowSkills: WorkflowSkill[]; chatPreferences: { enabledToolIds: string[] } };
type Set = (partial: any) => void;

function activeSession(state: State) { return state.privateModeActive ? state.privateChatSession : state.chatSessions.find((session) => session.id === state.activeSessionId); }
function updateTask(state: State, taskId: string, updater: (task: WorkflowTask) => WorkflowTask) {
  const session = activeSession(state); if (!session) return undefined;
  const tasks = (session.workflowTasks ?? []).map((task) => task.id === taskId ? updater(task) : task);
  return { ...session, workflowTasks: tasks, updatedAt: Date.now() };
}
function variablesFromObjective(objective: string) { return Array.from(objective.matchAll(/{{\s*([\w-]+)\s*}}/g)).map((match) => ({ id: match[1], label: match[1], required: true })); }

export function createWorkflowTaskActions(get: () => State, set: Set) {
  const persist = async (next: import("../../shared/types").ChatSession) => {
    if (get().privateModeActive) { set({ privateChatSession: next }); return; }
    const saved = await updateChatSession(next.id, () => next);
    set((state: State) => ({ chatSessions: saved ? upsertSession(state.chatSessions, saved) : state.chatSessions }));
  };
  return {
    createWorkflowTask: async (template: WorkflowTaskTemplate, objective: string) => {
      const session = activeSession(get()); if (!session) throw new Error("请先创建对话");
      const task = createTask(session.id, template, objective); await persist({ ...session, workflowTasks: [...(session.workflowTasks ?? []), task], updatedAt: Date.now() }); return task;
    },
    updateWorkflowTaskStatus: async (taskId: string, status: WorkflowTaskStatus, reason?: string) => { const next = updateTask(get(), taskId, (task) => transitionWorkflowTask(task, status, Date.now(), reason)); if (next) await persist(next); },
    upsertWorkflowTaskStep: async (taskId: string, step: WorkflowTaskStep) => { const next = updateTask(get(), taskId, (task) => ({ ...task, steps: [...task.steps.filter((item) => item.id !== step.id), step], updatedAt: Date.now() })); if (next) await persist(next); },
    addWorkflowContextItem: async (taskId: string, item: WorkflowContextItem) => { const next = updateTask(get(), taskId, (task) => addContext(task, item)); if (next) await persist(next); },
    removeWorkflowContextItem: async (taskId: string, itemId: string) => { const next = updateTask(get(), taskId, (task) => removeContext(task, itemId)); if (next) await persist(next); },
    toggleWorkflowContextPinned: async (taskId: string, itemId: string) => { const next = updateTask(get(), taskId, (task) => togglePinned(task, itemId)); if (next) await persist(next); },
    addWorkflowArtifact: async (taskId: string, artifact: WorkflowArtifact) => { const next = updateTask(get(), taskId, (task) => addArtifact(task, artifact)); if (next) await persist(next); },
    loadWorkflowSkills: async () => { const skills = await getAppSetting<WorkflowSkill[]>(SKILLS_KEY); set({ workflowSkills: Array.isArray(skills) ? skills : [] }); },
    saveWorkflowSkill: async (taskId: string, draft: Pick<WorkflowSkill, "title" | "variables">) => {
      const task = activeSession(get())?.workflowTasks?.find((item) => item.id === taskId); if (!task) throw new Error("任务不存在"); const now = Date.now();
      const skill: WorkflowSkill = { id: `workflow-skill-${now}-${Math.random().toString(36).slice(2, 8)}`, title: redactSensitiveText(draft.title).trim() || task.title, template: task.template, objectiveTemplate: task.objective, variables: draft.variables.length ? draft.variables : variablesFromObjective(task.objective), requiredContextKinds: Array.from(new Set(task.contextItems.map((item) => item.kind))), recommendedToolIds: task.steps.map((step) => step.toolCallId).filter((id): id is string => Boolean(id)), artifactKinds: Array.from(new Set(task.artifacts.map((artifact) => artifact.kind))), createdAt: now, updatedAt: now };
      const workflowSkills = [...get().workflowSkills, skill]; await saveAppSetting({ key: SKILLS_KEY, value: workflowSkills, updatedAt: now }); set({ workflowSkills }); return skill;
    },
    startWorkflowSkill: async (skillId: string, values: Record<string, string>) => {
      const skill = get().workflowSkills.find((item) => item.id === skillId); if (!skill) throw new Error("技能不存在");
      const objective = skill.objectiveTemplate.replace(/{{\s*([\w-]+)\s*}}/g, (_all, id: string) => redactSensitiveText(values[id] ?? ""));
      const task = await (createWorkflowTaskActions(get, set).createWorkflowTask(skill.template, objective));
      const unavailable = skill.recommendedToolIds.filter((id) => !get().chatPreferences.enabledToolIds.includes(id));
      if (unavailable.length) await createWorkflowTaskActions(get, set).updateWorkflowTaskStatus(task.id, "waiting", "所需工具不可用，请启用后继续任务");
      return activeSession(get())?.workflowTasks?.find((item) => item.id === task.id) ?? task;
    },
  };
}

export function createWorkflowContextItemsFromToolAttachments(attachments: ChatToolAttachment[] | undefined, capturedAt: number): WorkflowContextItem[] {
  const kinds: Record<string, WorkflowContextItem["kind"]> = { network: "network", web_search: "web-search", js_source: "js-source", source_map: "source-map", browser_screenshot: "screenshot", automation_report: "runtime", mcp: "mcp" };
  return (attachments ?? []).flatMap((item) => item.redacted === false || !kinds[item.kind] ? [] : [{ id: item.id, kind: kinds[item.kind], title: redactSensitiveText(item.title || "工具上下文").slice(0, 200), summary: redactSensitiveText(item.summary || "").slice(0, 1000), capturedAt, redacted: true, truncated: Boolean(item.truncated), sensitive: false }]);
}
export function createWorkflowArtifactFromAssistantMessage(task: WorkflowTask, message: ChatMessage, now = Date.now()): WorkflowArtifact | undefined { const content = redactSensitiveText(message.content).trim().slice(0, 12000); return content ? { id: `workflow-artifact-${now}`, kind: "conclusion", title: task.template === "debug" ? "调试报告" : task.template === "automation" ? "自动化报告" : "研究结论", content, contextItemIds: task.contextItems.map((item) => item.id), createdAt: now } : undefined; }
export function workflowStepFromTool(record: ChatToolCallRecord): WorkflowTaskStep { return { id: `workflow-step-${record.id}`, toolCallId: record.id, title: redactSensitiveText(record.displayName), detail: redactSensitiveText(record.errorMessage ?? record.resultSummary ?? "").slice(0, 1000) || undefined, status: record.status === "running" ? "running" : record.status === "success" ? "completed" : "failed", updatedAt: record.completedAt ?? record.startedAt }; }
