import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "../../../src/side-panel/components/ChatPanel";
import { useAppStore } from "../../../src/side-panel/state/appStore";
import type { ChatSession, WorkflowSkill, WorkflowTask } from "../../../src/shared/types";

vi.mock("../../../src/side-panel/components/ChatComposer", () => ({
  ChatComposer: () => <div data-testid="chat-composer" />,
}));

vi.mock("../../../src/side-panel/components/MessageList", () => ({
  MessageList: () => <div data-testid="message-list" />,
}));

vi.mock("../../../src/side-panel/components/SessionHistoryDialog", () => ({
  SessionHistoryDialog: () => null,
}));

vi.mock("../../../src/side-panel/components/ChatPreferenceDrawer", () => ({
  ChatPreferenceDrawer: () => null,
}));

vi.mock("../../../src/side-panel/components/WorkflowTaskCard", () => ({
  WorkflowTaskCard: () => <article data-testid="workflow-task-card" />,
}));

const originalActions = {
  loadWorkflowSkills: useAppStore.getState().loadWorkflowSkills,
  startWorkflowSkill: useAppStore.getState().startWorkflowSkill,
  addNotification: useAppStore.getState().addNotification,
};

function createSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "session-1",
    title: "工作流会话",
    archived: false,
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    ...overrides,
  };
}

function createSkill(overrides: Partial<WorkflowSkill> = {}): WorkflowSkill {
  return {
    id: "workflow-skill-1",
    title: "页面研究",
    template: "research",
    objectiveTemplate: "研究 {{subject}}",
    variables: [{ id: "subject", label: "对象", required: true }],
    requiredContextKinds: ["page-content"],
    recommendedToolIds: [],
    artifactKinds: ["conclusion"],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createTask(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    id: "workflow-task-1",
    sessionId: "session-1",
    template: "research",
    title: "页面研究",
    objective: "研究 当前页面",
    status: "preparing",
    createdAt: 1,
    updatedAt: 1,
    contextItems: [],
    steps: [],
    artifacts: [],
    ...overrides,
  };
}

function renderChatPanel() {
  return render(
    <ChatPanel
      browserControlEnabled={false}
      drawerOpen={false}
      drawerOrigin="header"
      drawerPage="history"
      historyPanelOpen={false}
      settingsInitialTab="channels"
      onDrawerOpenChange={vi.fn()}
      onRestoreDrawerFocus={vi.fn()}
      onOpenAgentTools={vi.fn()}
      onOpenHistoryDrawer={vi.fn()}
      onOpenSettings={vi.fn()}
      onReturnSettingsToHistory={vi.fn()}
      onToggleBrowserControl={vi.fn()}
      onToggleHistoryPanel={vi.fn()}
    />,
  );
}

afterEach(() => {
  useAppStore.getState().reset();
  useAppStore.setState(originalActions);
});

describe("ChatPanel 本地任务技能", () => {
  it("显示已保存技能并从技能架打开启动弹窗", async () => {
    const user = userEvent.setup();
    const skill = createSkill();
    const loadWorkflowSkills = vi.fn(async () => undefined);
    const startWorkflowSkill = vi.fn(async () => createTask());
    useAppStore.setState({
      activeSessionId: "session-1",
      chatSessions: [createSession()],
      workflowSkills: [skill],
      loadWorkflowSkills,
      startWorkflowSkill,
      addNotification: vi.fn(),
    });

    renderChatPanel();

    await waitFor(() => expect(loadWorkflowSkills).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "启动技能：页面研究" }));
    expect(screen.getByRole("dialog", { name: "启动技能" })).toBeVisible();

    await user.type(screen.getByLabelText("对象"), "当前页面");
    await user.click(screen.getByRole("button", { name: "启动技能" }));

    await waitFor(() => expect(startWorkflowSkill).toHaveBeenCalledWith("workflow-skill-1", { subject: "当前页面" }));
  });
});
