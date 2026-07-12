import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskArtifactsPanel } from "../../../src/side-panel/components/TaskArtifactsPanel";
import { useAppStore } from "../../../src/side-panel/state/appStore";
import type { WorkflowTask } from "../../../src/shared/types";

const copyTextToClipboardMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const downloadWorkflowTaskMarkdownMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/side-panel/utils/messageClipboard", () => ({
  copyTextToClipboard: copyTextToClipboardMock,
}));

vi.mock("../../../src/side-panel/utils/workflowMarkdownExport", () => ({
  downloadWorkflowTaskMarkdown: downloadWorkflowTaskMarkdownMock,
}));

const originalAddNotification = useAppStore.getState().addNotification;

function createTask(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    id: "workflow-task-1",
    sessionId: "session-1",
    template: "debug",
    title: "检查登录失败",
    objective: "检查登录失败",
    status: "completed",
    createdAt: 1,
    updatedAt: 2,
    contextItems: [],
    steps: [],
    artifacts: [{
      id: "artifact-1",
      kind: "debug-report",
      title: "调试报告",
      content: "登录接口返回 500，建议检查服务端日志。\nAuthorization: Bearer panel-secret\n截图 data:image/png;base64,panel-secret",
      contextItemIds: [],
      createdAt: 3,
    }],
    ...overrides,
  };
}

afterEach(() => {
  useAppStore.getState().reset();
  useAppStore.setState({ addNotification: originalAddNotification });
  copyTextToClipboardMock.mockClear();
  downloadWorkflowTaskMarkdownMock.mockClear();
});

describe("TaskArtifactsPanel", () => {
  it("展示任务产物并支持复制单个产物", async () => {
    const user = userEvent.setup();
    const addNotification = vi.fn();
    useAppStore.setState({ addNotification });
    const task = createTask();

    render(<TaskArtifactsPanel task={task} />);

    expect(screen.getByText("产物 1")).toBeInTheDocument();
    expect(screen.getByText(/登录接口返回 500/)).toBeInTheDocument();
    expect(screen.getByText(/\[已移除 data URL\]/)).toBeInTheDocument();
    expect(screen.queryByText(/panel-secret/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "复制产物：调试报告" }));

    await waitFor(() => expect(copyTextToClipboardMock).toHaveBeenCalledWith(expect.stringContaining("登录接口返回 500")));
    expect(copyTextToClipboardMock).toHaveBeenCalledWith(expect.stringContaining("# 调试报告"));
    expect(copyTextToClipboardMock).toHaveBeenCalledWith(expect.stringContaining("[已移除 data URL]"));
    expect(copyTextToClipboardMock).not.toHaveBeenCalledWith(expect.stringContaining("panel-secret"));
    expect(addNotification).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "复制完成" }));
  });

  it("支持导出完整任务 Markdown", async () => {
    const user = userEvent.setup();
    const addNotification = vi.fn();
    useAppStore.setState({ addNotification });
    const task = createTask();

    render(<TaskArtifactsPanel task={task} />);

    await user.click(screen.getByRole("button", { name: "导出任务 Markdown" }));

    expect(downloadWorkflowTaskMarkdownMock).toHaveBeenCalledWith(task);
    expect(addNotification).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "导出完成" }));
  });

  it("没有产物时不渲染面板", () => {
    const { container } = render(<TaskArtifactsPanel task={createTask({ artifacts: [] })} />);

    expect(container).toBeEmptyDOMElement();
  });
});
