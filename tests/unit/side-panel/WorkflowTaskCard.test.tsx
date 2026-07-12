import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowTaskCard } from "../../../src/side-panel/components/WorkflowTaskCard";
import { useAppStore } from "../../../src/side-panel/state/appStore";
import type { WorkflowSkill, WorkflowTask } from "../../../src/shared/types";

const originalActions = {
  sendWorkflowTaskMessage: useAppStore.getState().sendWorkflowTaskMessage,
  updateWorkflowTaskStatus: useAppStore.getState().updateWorkflowTaskStatus,
  abortChatTask: useAppStore.getState().abortChatTask,
  addNotification: useAppStore.getState().addNotification,
  refreshPageContext: useAppStore.getState().refreshPageContext,
  updateWorkflowContextItem: useAppStore.getState().updateWorkflowContextItem,
  toggleWorkflowContextPinned: useAppStore.getState().toggleWorkflowContextPinned,
  removeWorkflowContextItem: useAppStore.getState().removeWorkflowContextItem,
  saveWorkflowSkill: useAppStore.getState().saveWorkflowSkill,
};

function createTask(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    id: "workflow-task-1",
    sessionId: "session-1",
    template: "research",
    title: "等待任务",
    objective: "研究页面",
    status: "waiting",
    createdAt: 1,
    updatedAt: 1,
    contextItems: [],
    steps: [],
    artifacts: [],
    ...overrides,
  };
}

afterEach(() => {
  useAppStore.getState().reset();
  useAppStore.setState(originalActions);
});

describe("WorkflowTaskCard", () => {
  it("等待状态可输入补充信息并继续任务", async () => {
    const user = userEvent.setup();
    const sendWorkflowTaskMessage = vi.fn(async () => undefined);
    useAppStore.setState({
      sending: false,
      sendWorkflowTaskMessage,
      addNotification: vi.fn(),
    });

    render(<WorkflowTaskCard task={createTask()} />);

    await user.type(screen.getByRole("textbox", { name: "继续任务：等待任务" }), "补充信息");
    await user.click(screen.getByRole("button", { name: "继续" }));

    await waitFor(() => expect(sendWorkflowTaskMessage).toHaveBeenCalledWith("workflow-task-1", "补充信息"));
  });

  it("运行状态可取消所属会话的聊天任务并标记工作流取消", async () => {
    const user = userEvent.setup();
    const abortChatTask = vi.fn();
    const updateWorkflowTaskStatus = vi.fn(async () => undefined);
    useAppStore.setState({ abortChatTask, updateWorkflowTaskStatus });

    render(<WorkflowTaskCard task={createTask({ status: "running" })} />);

    await user.click(screen.getByRole("button", { name: "取消任务" }));

    expect(abortChatTask).toHaveBeenCalledWith("session-1");
    await waitFor(() => expect(updateWorkflowTaskStatus).toHaveBeenCalledWith("workflow-task-1", "canceled"));
  });

  it("上下文面板支持固定、摘要、刷新和移除", async () => {
    const user = userEvent.setup();
    const refreshPageContext = vi.fn(async () => undefined);
    const updateWorkflowContextItem = vi.fn(async () => undefined);
    const toggleWorkflowContextPinned = vi.fn(async () => undefined);
    const removeWorkflowContextItem = vi.fn(async () => undefined);
    useAppStore.setState({
      pageContext: {
        loading: false,
        title: "刷新标题",
        url: "https://example.com",
        text: "刷新后的页面正文",
        extractMode: "text",
        truncated: true,
        usedFallback: false,
      },
      refreshPageContext,
      updateWorkflowContextItem,
      toggleWorkflowContextPinned,
      removeWorkflowContextItem,
    });
    const task = createTask({
      status: "completed",
      contextItems: [{
        id: "context-1",
        kind: "page-content",
        title: "页面摘要",
        summary: "这是一段很长的上下文。".repeat(20),
        capturedAt: 1,
        redacted: true,
        truncated: false,
        sensitive: false,
      }],
    });

    render(<WorkflowTaskCard task={task} />);

    await user.click(screen.getByText("上下文 1"));
    await user.click(screen.getByRole("button", { name: "固定上下文：页面摘要" }));
    await user.click(screen.getByRole("button", { name: "摘要上下文：页面摘要" }));
    await user.click(screen.getByRole("button", { name: "刷新上下文：页面摘要" }));
    await user.click(screen.getByRole("button", { name: "移除上下文：页面摘要" }));

    expect(toggleWorkflowContextPinned).toHaveBeenCalledWith("workflow-task-1", "context-1");
    expect(updateWorkflowContextItem).toHaveBeenCalledWith(
      "workflow-task-1",
      "context-1",
      expect.objectContaining({ title: "页面摘要", truncated: false }),
    );
    await waitFor(() => {
      expect(refreshPageContext).toHaveBeenCalled();
      expect(updateWorkflowContextItem).toHaveBeenCalledWith(
        "workflow-task-1",
        "context-1",
        expect.objectContaining({ title: "刷新标题", summary: "刷新后的页面正文", truncated: true }),
      );
    });
    expect(removeWorkflowContextItem).toHaveBeenCalledWith("workflow-task-1", "context-1");
  });

  it("完成状态可保存为技能并提取变量", async () => {
    const user = userEvent.setup();
    const saveWorkflowSkill = vi.fn(async (_taskId: string, draft: Pick<WorkflowSkill, "title" | "variables">): Promise<WorkflowSkill> => ({
      id: "workflow-skill-1",
      title: draft.title,
      template: "research",
      objectiveTemplate: "研究 {{subject}}",
      variables: draft.variables,
      requiredContextKinds: [],
      recommendedToolIds: [],
      artifactKinds: [],
      createdAt: 1,
      updatedAt: 1,
    }));
    useAppStore.setState({ saveWorkflowSkill, addNotification: vi.fn() });

    render(<WorkflowTaskCard task={createTask({ status: "completed", title: "研究技能", objective: "研究 {{subject}}" })} />);

    await user.click(screen.getByRole("button", { name: "保存为技能" }));
    await user.click(screen.getByRole("button", { name: "保存技能" }));

    await waitFor(() => expect(saveWorkflowSkill).toHaveBeenCalledWith("workflow-task-1", {
      title: "研究技能",
      variables: [{ id: "subject", label: "subject", required: true }],
    }));
  });
});
