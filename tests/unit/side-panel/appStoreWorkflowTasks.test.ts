import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../src/side-panel/state/appStore";
import {
  createWorkflowArtifactFromAssistantMessage,
  createWorkflowArtifactsFromAssistantMessage,
} from "../../../src/side-panel/state/appStoreWorkflowTasks";
import {
  clearDatabase,
  getAppSetting,
  getChatSession,
  saveChatSession,
  saveModelProvider,
  saveProviderModel,
} from "../../../src/shared/storage/repositories";
import type { ChatMessage, ChatSession, ModelProvider, ProviderModel, WorkflowSkill, WorkflowTask } from "../../../src/shared/types";

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

function createProvider(): ModelProvider {
  return {
    id: "provider-1",
    name: "默认渠道",
    endpointType: "openai_chat",
    endpointUrl: "https://api.example.com/v1/chat/completions",
    apiKey: "sk-test",
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function createModel(): ProviderModel {
  return {
    id: "model-1",
    providerId: "provider-1",
    modelId: "gpt-test",
    displayName: "测试模型",
    temperature: 0.7,
    maxTokens: 1024,
    systemPrompt: "你是网页助手",
    isTitleModel: false,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function createWorkflowTaskFixture(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    id: "workflow-task-fixture",
    sessionId: "session-1",
    template: "research",
    title: "测试任务",
    objective: "测试任务",
    status: "running",
    createdAt: 1,
    updatedAt: 2,
    contextItems: [],
    steps: [],
    artifacts: [],
    ...overrides,
  };
}

function createAssistantMessage(content: string): ChatMessage {
  return {
    id: "message-assistant",
    role: "assistant",
    content,
    createdAt: 1,
    modelId: "model-1",
    endpointType: "openai_chat",
    streamMode: true,
    systemPrompt: "",
    contextPrompt: "",
    contextMode: "text",
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

  it("流式工具事件会更新任务步骤并仅保存脱敏附件摘要到任务所属会话", async () => {
    const session = createSession();
    const otherSession = createSession("session-2");
    const provider = createProvider();
    const model = createModel();
    let messageListener: ((message: unknown) => void) | undefined;
    const port = {
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: { addListener: vi.fn((listener: (message: unknown) => void) => { messageListener = listener; }) },
      onDisconnect: { addListener: vi.fn() },
    };
    vi.stubGlobal("chrome", {
      runtime: {
        connect: vi.fn(() => port),
      },
    });
    await saveChatSession(session);
    await saveChatSession(otherSession);
    await saveModelProvider(provider);
    await saveProviderModel(model);
    useAppStore.setState({ activeSessionId: session.id, chatSessions: [session, otherSession] });
    await useAppStore.getState().loadChannelConfig();
    const task = await useAppStore.getState().createWorkflowTask("research", "检索资料");

    const sending = useAppStore.getState().sendWorkflowTaskMessage(task.id, "开始检索");
    await vi.waitFor(() => expect(messageListener).toBeTypeOf("function"));
    useAppStore.setState({ activeSessionId: otherSession.id });
    messageListener?.({
      type: "tool:start",
      record: {
        id: "call-1",
        toolId: "web_search.tavily",
        name: "tavily_search",
        displayName: "Tavily 搜索",
        arguments: { query: "不应保存的工具参数" },
        status: "running",
        startedAt: 1,
      },
    });
    messageListener?.({
      type: "tool:complete",
      record: {
        id: "call-1",
        toolId: "web_search.tavily",
        name: "tavily_search",
        displayName: "Tavily 搜索",
        arguments: { query: "不应保存的工具参数" },
        status: "success",
        startedAt: 1,
        completedAt: 2,
        resultSummary: "检索完成",
      },
      attachments: [{
        id: "attachment-1",
        kind: "browser-screenshot",
        title: "截图",
        summary: "包含 API_KEY=secret 的结果摘要",
        dataUrl: "data:image/png;base64,secret",
        mediaType: "image/png",
        target: "viewport",
        byteSize: 10,
        createdAt: 2,
        redacted: false,
        truncated: false,
      }, {
        id: "attachment-2",
        kind: "network",
        title: "网络摘要",
        summary: "安全摘要".repeat(600),
        requests: [],
        createdAt: 2,
        redacted: true,
        truncated: false,
      }],
    });
    messageListener?.({ type: "complete", content: "检索完成" });
    await sending;

    const updatedTask = useAppStore.getState().chatSessions[0]?.workflowTasks?.[0];
    const otherTask = useAppStore.getState().chatSessions[1]?.workflowTasks?.[0];
    expect(updatedTask).toMatchObject({
      status: "completed",
      steps: [{ toolCallId: "call-1", status: "completed" }],
      artifacts: [{
        kind: "conclusion",
        title: "任务结论",
        content: "检索完成",
      }],
      contextItems: [{
        id: "workflow-context-tool-attachment-2",
        kind: "network",
        title: "网络摘要",
        redacted: true,
        truncated: true,
        sensitive: false,
      }],
    });
    expect(updatedTask?.contextItems).toHaveLength(1);
    expect(updatedTask?.contextItems[0]?.summary.length).toBeLessThanOrEqual(1200);
    expect(otherTask).toBeUndefined();
    expect(JSON.stringify(updatedTask)).not.toContain("data:image/png");
    expect(JSON.stringify(updatedTask)).not.toContain("不应保存的工具参数");
    expect(JSON.stringify(updatedTask)).not.toContain("secret");
  });

  it("从最终助手消息按模板创建脱敏产物", () => {
    const debugTask = createWorkflowTaskFixture({
      template: "debug",
      contextItems: [{
        id: "context-safe",
        kind: "network",
        title: "Network 摘要",
        summary: "已脱敏摘要",
        capturedAt: 1,
        redacted: true,
        truncated: false,
        sensitive: false,
      }, {
        id: "context-sensitive",
        kind: "screenshot",
        title: "敏感截图",
        summary: "data:image/png;base64,secret",
        capturedAt: 1,
        redacted: false,
        truncated: false,
        sensitive: true,
      }],
      steps: [{
        id: "step-network",
        title: "Network 请求详情",
        status: "completed",
        updatedAt: 2,
      }],
    });

    const debugArtifact = createWorkflowArtifactFromAssistantMessage(
      debugTask,
      createAssistantMessage("Authorization: Bearer debug-secret\n截图 data:image/png;base64,debug-secret"),
      10,
    );

    expect(debugArtifact).toMatchObject({
      kind: "debug-report",
      title: "调试报告",
      contextItemIds: ["context-safe"],
      createdAt: 10,
    });
    expect(debugArtifact?.content).toContain("Authorization: [已脱敏]");
    expect(debugArtifact?.content).toContain("[已移除 data URL]");
    expect(debugArtifact?.content).not.toContain("debug-secret");

    const researchTask = createWorkflowTaskFixture({ template: "research" });
    const researchArtifacts = createWorkflowArtifactsFromAssistantMessage(
      researchTask,
      createAssistantMessage([
        "调研结论：",
        "",
        "| 指标 | 结果 |",
        "| --- | --- |",
        "| 状态 | 正常 |",
      ].join("\n")),
      20,
    );

    expect(researchArtifacts.map((artifact) => artifact.kind)).toEqual(["conclusion", "table"]);
    expect(researchArtifacts[1]?.title).toBe("表格摘录");
    expect(researchArtifacts[1]?.content).toContain("| 指标 | 结果 |");
  });

  it("工作流消息在取消或流错误后恢复等待状态", async () => {
    const session = createSession();
    const provider = createProvider();
    const model = createModel();
    let disconnectListener: (() => void) | undefined;
    let messageListener: ((message: unknown) => void) | undefined;
    const port = {
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: { addListener: vi.fn((listener: (message: unknown) => void) => { messageListener = listener; }) },
      onDisconnect: { addListener: vi.fn((listener: () => void) => { disconnectListener = listener; }) },
    };
    vi.stubGlobal("chrome", { runtime: { connect: vi.fn(() => port) } });
    await saveChatSession(session);
    await saveModelProvider(provider);
    await saveProviderModel(model);
    useAppStore.setState({ activeSessionId: session.id, chatSessions: [session] });
    await useAppStore.getState().loadChannelConfig();
    const task = await useAppStore.getState().createWorkflowTask("debug", "检查错误");

    const sending = useAppStore.getState().sendWorkflowTaskMessage(task.id, "开始检查");
    await vi.waitFor(() => expect(messageListener).toBeTypeOf("function"));
    expect(useAppStore.getState().chatSessions[0]?.workflowTasks?.[0].status).toBe("running");
    messageListener?.({ type: "error", message: "网络中断" });
    await sending;
    expect(useAppStore.getState().chatSessions[0]?.workflowTasks?.[0].status).toBe("waiting");

    messageListener = undefined;
    disconnectListener = undefined;
    const cancelSending = useAppStore.getState().sendWorkflowTaskMessage(task.id, "再次检查");
    await vi.waitFor(() => expect(messageListener).toBeTypeOf("function"));
    await vi.waitFor(() => expect(disconnectListener).toBeTypeOf("function"));
    useAppStore.getState().abortChatTask(session.id);
    (disconnectListener as (() => void) | undefined)?.();
    await cancelSending;
    expect(useAppStore.getState().chatSessions[0]?.workflowTasks?.[0].status).toBe("canceled");
  });

  it("运行中的工作流任务重复发送不会恢复等待状态", async () => {
    const session = createSession();
    await saveChatSession(session);
    useAppStore.setState({ activeSessionId: session.id, chatSessions: [session] });
    const task = await useAppStore.getState().createWorkflowTask("debug", "检查重复发送");
    await useAppStore.getState().updateWorkflowTaskStatus(task.id, "running");

    await useAppStore.getState().sendWorkflowTaskMessage(task.id, "重复发送");

    expect(useAppStore.getState().chatSessions[0]?.workflowTasks?.[0].status).toBe("running");
  });
});
