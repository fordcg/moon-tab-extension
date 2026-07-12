import { afterEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../../src/side-panel/state/appStore";
import {
  clearDatabase,
  getAppSetting,
  getChatSession,
  saveChatSession,
} from "../../../src/shared/storage/repositories";
import type { ChatSession, WorkflowSkill } from "../../../src/shared/types";

function createSession(id = "session-1"): ChatSession {
  return {
    id,
    title: "工作流会话",
    archived: false,
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 1,
    messages: [],
  };
}

afterEach(async () => {
  useAppStore.getState().reset();
  await clearDatabase();
});

describe("appStore 工作流任务", () => {
  it("创建任务后持久化到当前会话，并更新任务状态", async () => {
    const session = createSession();
    await saveChatSession(session);
    useAppStore.setState({
      activeSessionId: session.id,
      chatSessions: [session],
    });

    const task = await useAppStore.getState().createWorkflowTask("research", "对比当前标签页");
    await useAppStore.getState().updateWorkflowTaskStatus(task.id, "running");
    await useAppStore.getState().updateWorkflowTaskStatus(task.id, "waiting", "等待页面内容");

    expect(useAppStore.getState().chatSessions[0].updatedAt).toBeGreaterThanOrEqual(session.updatedAt);
    expect(useAppStore.getState().chatSessions[0].workflowTasks?.[0]).toMatchObject({
      id: task.id,
      status: "waiting",
      statusReason: "等待页面内容",
    });
    expect((await getChatSession(session.id))?.workflowTasks?.[0].status).toBe("waiting");
  });

  it("私密会话只更新内存，不写入 Dexie", async () => {
    const session = createSession("private-session-1");
    useAppStore.setState({
      privateModeActive: true,
      privateChatSession: session,
      activeSessionId: "",
    });

    const task = await useAppStore.getState().createWorkflowTask("debug", "检查私密页面");

    expect(useAppStore.getState().privateChatSession?.workflowTasks?.[0].id).toBe(task.id);
    expect(await getChatSession(session.id)).toBeUndefined();
  });

  it("保存技能不复制任务上下文摘要或产物正文", async () => {
    const session = createSession();
    await saveChatSession(session);
    useAppStore.setState({ activeSessionId: session.id, chatSessions: [session] });
    const task = await useAppStore.getState().createWorkflowTask("research", "研究当前页面");
    await useAppStore.getState().addWorkflowContextItem(task.id, {
      id: "context-safe",
      kind: "page-content",
      title: "页面摘要",
      summary: "不应进入技能设置",
      capturedAt: 1,
      redacted: true,
      truncated: false,
      sensitive: false,
    });
    await useAppStore.getState().addWorkflowArtifact(task.id, {
      id: "artifact-1",
      kind: "conclusion",
      title: "结论",
      content: "不应进入技能设置",
      contextItemIds: ["context-safe"],
      createdAt: 1,
    });

    const skill = await useAppStore.getState().saveWorkflowSkill(task.id, {
      title: " 页面研究 ",
      variables: [{ id: "subject", label: "研究对象", required: true }],
    });
    const stored = await getAppSetting<WorkflowSkill[]>("aiSidebar.workflowSkills.v1");

    expect(skill).toMatchObject({
      title: "页面研究",
      template: "research",
      objectiveTemplate: "研究当前页面",
    });
    expect(JSON.stringify(stored)).not.toContain("不应进入技能设置");
  });

  it("启动技能校验必填变量、替换变量并在推荐工具不存在时创建等待任务", async () => {
    const session = createSession();
    await saveChatSession(session);
    useAppStore.setState({ activeSessionId: session.id, chatSessions: [session] });
    const sourceTask = await useAppStore.getState().createWorkflowTask("automation", "处理 {{subject}}");
    const skill = await useAppStore.getState().saveWorkflowSkill(sourceTask.id, {
      title: "处理任务",
      variables: [{ id: "subject", label: "对象", required: true }],
    });
    useAppStore.setState({
      workflowSkills: [{
        ...skill,
        recommendedToolIds: ["tool.missing"],
      }],
    });

    await expect(useAppStore.getState().startWorkflowSkill(skill.id, { subject: "  " })).rejects.toThrow("对象不能为空");

    const task = await useAppStore.getState().startWorkflowSkill(skill.id, { subject: " 当前页面 " });

    expect(task).toMatchObject({
      objective: "处理 当前页面",
      status: "waiting",
    });
    expect(task.statusReason).toContain("不可用");
  });
});
