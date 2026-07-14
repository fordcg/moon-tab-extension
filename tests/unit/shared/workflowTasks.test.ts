import { describe, expect, it } from "vitest";
import {
  addWorkflowArtifact,
  addWorkflowContextItem,
  createWorkflowTask,
  normalizeWorkflowTask,
  removeWorkflowContextItem,
  toggleWorkflowContextPinned,
  transitionWorkflowTask,
} from "../../../src/shared/chat/workflowTasks";

describe("工作流任务状态机", () => {
  it("创建任务会使用稳定 ID 前缀、准备状态和目标标题", () => {
    const task = createWorkflowTask("session-1", "debug", "  排查登录接口的 500 错误  ", 100);

    expect(task).toMatchObject({
      sessionId: "session-1",
      template: "debug",
      title: "排查登录接口的 500 错误",
      objective: "排查登录接口的 500 错误",
      status: "preparing",
      createdAt: 100,
      updatedAt: 100,
      contextItems: [],
      steps: [],
      artifacts: [],
    });
    expect(task.id).toMatch(/^workflow-task-/);
  });

  it("只允许定义的状态迁移并记录错误原因", () => {
    const task = createWorkflowTask("session-1", "research", "研究问题", 100);
    const running = transitionWorkflowTask(task, "running", 200);
    const waiting = transitionWorkflowTask(running, "waiting", 300);
    const failed = transitionWorkflowTask(waiting, "failed", 400, "需要用户补充页面地址");

    expect(running).toMatchObject({ status: "running", updatedAt: 200 });
    expect(waiting).toMatchObject({ status: "waiting", updatedAt: 300 });
    expect(failed).toMatchObject({
      status: "failed",
      updatedAt: 400,
      statusReason: "需要用户补充页面地址",
    });
    expect(transitionWorkflowTask(task, "completed", 500)).toBe(task);
    expect(transitionWorkflowTask(failed, "running", 500)).toBe(failed);
  });

  it("从等待状态恢复运行时会清除旧错误原因", () => {
    const task = createWorkflowTask("session-1", "research", "研究问题", 100);
    const waiting = transitionWorkflowTask(transitionWorkflowTask(task, "running", 200), "waiting", 300, "等待用户补充信息");
    const running = transitionWorkflowTask(waiting, "running", 400);

    expect(running).toMatchObject({ status: "running", updatedAt: 400 });
    expect(running).not.toHaveProperty("statusReason");
  });

  it("创建和迁移不会生成无效或倒流的时间戳", () => {
    const task = createWorkflowTask("session-1", "debug", "排查问题", -1);

    expect(task).toMatchObject({ createdAt: 0, updatedAt: 0 });
    expect(transitionWorkflowTask(task, "running", -1)).toBe(task);
    expect(transitionWorkflowTask(task, "running", Number.NaN)).toBe(task);

    const running = transitionWorkflowTask(task, "running", 10);
    expect(transitionWorkflowTask(running, "waiting", 9)).toBe(running);
  });

  it("归一化会过滤不安全上下文和无效步骤，并清理敏感文本", () => {
    const task = normalizeWorkflowTask({
      id: "workflow-task-1",
      sessionId: "session-1",
      template: "debug",
      title: "登录 token=secret",
      objective: "检查 api_key=xai-secret",
      status: "running",
      createdAt: 10,
      updatedAt: 20,
      contextItems: [
        {
          id: "context-safe",
          kind: "network",
          title: "请求",
          summary: "Authorization: Bearer secret",
          capturedAt: 11,
          redacted: true,
          truncated: false,
          sensitive: false,
        },
        {
          id: "context-sensitive",
          kind: "network",
          title: "敏感请求",
          summary: "已脱敏也不能保存",
          capturedAt: 12,
          redacted: true,
          truncated: false,
          sensitive: true,
        },
        {
          id: "context-raw",
          kind: "network",
          title: "原始请求",
          summary: "token=secret",
          capturedAt: 13,
          redacted: false,
          truncated: false,
          sensitive: false,
        },
      ],
      steps: [
        { id: "step-1", title: "读取 password=123456", status: "running", detail: "token=secret", updatedAt: 15 },
        { id: "", title: "无效步骤", status: "pending", updatedAt: 15 },
      ],
      artifacts: [
        {
          id: "artifact-1",
          kind: "debug-report",
          title: "报告",
          content: "cookie=sid=secret",
          contextItemIds: ["context-safe"],
          createdAt: 20,
        },
        { id: "artifact-invalid", kind: "debug-report", title: "报告", content: "x", contextItemIds: [], createdAt: "bad" },
      ],
    });

    expect(task).toBeTruthy();
    expect(task).toMatchObject({
      title: "登录 token=[已脱敏]",
      objective: "检查 api_key=[已脱敏]",
      contextItems: [
        expect.objectContaining({
          id: "context-safe",
          summary: "Authorization: [已脱敏]",
        }),
      ],
      steps: [
        expect.objectContaining({
          title: "读取 password=[已脱敏]",
          detail: "token=[已脱敏]",
        }),
      ],
      artifacts: [
        expect.objectContaining({
          content: "cookie=[已脱敏]",
        }),
      ],
    });
    expect(task?.contextItems).toHaveLength(1);
    expect(task?.steps).toHaveLength(1);
    expect(task?.artifacts).toHaveLength(1);
  });

  it("归一化拒绝负数时间、倒序任务时间和无效子项时间", () => {
    const baseTask = {
      id: "workflow-task-1",
      sessionId: "session-1",
      template: "debug",
      title: "排查问题",
      objective: "排查问题",
      status: "running",
      createdAt: 10,
      updatedAt: 20,
      contextItems: [],
      steps: [],
      artifacts: [],
    };

    expect(normalizeWorkflowTask({ ...baseTask, createdAt: -1 })).toBeNull();
    expect(normalizeWorkflowTask({ ...baseTask, updatedAt: -1 })).toBeNull();
    expect(normalizeWorkflowTask({ ...baseTask, updatedAt: 9 })).toBeNull();

    const normalized = normalizeWorkflowTask({
      ...baseTask,
      steps: [{ id: "step-1", title: "无效时间", status: "pending", updatedAt: -1 }],
      contextItems: [
        {
          id: "context-1",
          kind: "page-content",
          title: "页面",
          summary: "内容",
          capturedAt: -1,
          redacted: true,
          truncated: false,
          sensitive: false,
        },
      ],
      artifacts: [{ id: "artifact-1", kind: "conclusion", title: "结论", content: "内容", contextItemIds: [], createdAt: -1 }],
    });

    expect(normalized).toMatchObject({ steps: [], contextItems: [], artifacts: [] });
  });

  it("上下文固定切换和移除会返回更新后的任务", () => {
    const initialTask = addWorkflowContextItem(createWorkflowTask("session-1", "automation", "提交表单", 1), {
      id: "context-1",
      kind: "page-content",
      title: "表单",
      summary: "已脱敏内容",
      capturedAt: 2,
      redacted: true,
      truncated: false,
      sensitive: false,
    });
    const task = addWorkflowContextItem(initialTask, {
      ...initialTask.contextItems[0],
      summary: "更新后的脱敏内容",
      capturedAt: 3,
    });

    const pinned = toggleWorkflowContextPinned(task, "context-1");
    const removed = removeWorkflowContextItem(pinned, "context-1");

    expect(task.contextItems).toHaveLength(1);
    expect(task.contextItems[0]).toMatchObject({ summary: "更新后的脱敏内容", capturedAt: 3 });
    expect(task.contextItems[0].pinned).toBeUndefined();
    expect(pinned.contextItems[0].pinned).toBe(true);
    expect(removed.contextItems).toEqual([]);
  });

  it("可追加产物", () => {
    const initialTask = addWorkflowArtifact(createWorkflowTask("session-1", "automation", "提交表单", 1), {
      id: "artifact-1",
      kind: "automation-report",
      title: "执行报告",
      content: "已完成",
      contextItemIds: [],
      createdAt: 2,
    });
    const task = addWorkflowArtifact(initialTask, {
      ...initialTask.artifacts[0],
      content: "更新后的报告",
      createdAt: 3,
    });

    expect(task.artifacts).toEqual([
      {
        id: "artifact-1",
        kind: "automation-report",
        title: "执行报告",
        content: "更新后的报告",
        contextItemIds: [],
        createdAt: 3,
      },
    ]);
  });

  it("归一化保留截图产物", () => {
    const task = addWorkflowArtifact(createWorkflowTask("session-1", "automation", "截图核验", 1), {
      id: "artifact-screenshot",
      kind: "screenshot",
      title: "结果截图",
      content: "截图已生成",
      contextItemIds: [],
      createdAt: 2,
    });

    expect(task.artifacts[0]?.kind).toBe("screenshot");
  });
});
