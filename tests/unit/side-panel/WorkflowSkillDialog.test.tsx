import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractWorkflowSkillVariables,
  WorkflowSkillDialog,
} from "../../../src/side-panel/components/WorkflowSkillDialog";
import { useAppStore } from "../../../src/side-panel/state/appStore";
import type { WorkflowSkill, WorkflowTask } from "../../../src/shared/types";

const originalActions = {
  saveWorkflowSkill: useAppStore.getState().saveWorkflowSkill,
  startWorkflowSkill: useAppStore.getState().startWorkflowSkill,
  addNotification: useAppStore.getState().addNotification,
};

function createTask(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    id: "workflow-task-1",
    sessionId: "session-1",
    template: "research",
    title: "研究技能",
    objective: "研究 {{ subject }} 和 {{competitor}}",
    status: "completed",
    createdAt: 1,
    updatedAt: 2,
    contextItems: [],
    steps: [],
    artifacts: [],
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

afterEach(() => {
  useAppStore.getState().reset();
  useAppStore.setState(originalActions);
});

describe("WorkflowSkillDialog", () => {
  it("保存技能时从任务目标提取去重变量", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const saveWorkflowSkill = vi.fn(async (_taskId: string, draft: Pick<WorkflowSkill, "title" | "variables">) =>
      createSkill({ title: draft.title.trim(), variables: draft.variables }),
    );
    useAppStore.setState({ saveWorkflowSkill, addNotification: vi.fn() });

    render(
      <WorkflowSkillDialog
        mode="save"
        open
        task={createTask({ objective: "研究 {{ subject }}、{{competitor}} 和 {{ subject }}" })}
        onOpenChange={onOpenChange}
      />,
    );

    const titleInput = screen.getByLabelText("技能名称");
    expect(titleInput).toHaveFocus();
    expect(titleInput).toBeRequired();
    await user.clear(titleInput);
    await user.type(titleInput, "竞品研究");
    await user.click(screen.getByRole("button", { name: "保存技能" }));

    await waitFor(() => expect(saveWorkflowSkill).toHaveBeenCalledWith("workflow-task-1", {
      title: "竞品研究",
      variables: [
        { id: "subject", label: "subject", required: true },
        { id: "competitor", label: "competitor", required: true },
      ],
    }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("启动技能时校验必填变量并提交变量值", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const startWorkflowSkill = vi.fn(async () => createTask());
    useAppStore.setState({ startWorkflowSkill, addNotification: vi.fn() });

    render(<WorkflowSkillDialog mode="start" open skill={createSkill()} onOpenChange={onOpenChange} />);

    const variableInput = screen.getByLabelText("对象");
    expect(variableInput).toHaveFocus();
    expect(variableInput).toBeRequired();
    expect(screen.getByText("必填")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "启动技能" })).toBeDisabled();
    await user.type(variableInput, "当前页面");
    await user.click(screen.getByRole("button", { name: "启动技能" }));

    await waitFor(() => expect(startWorkflowSkill).toHaveBeenCalledWith("workflow-skill-1", { subject: "当前页面" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("提取变量时兼容空格并忽略重复占位符", () => {
    expect(extractWorkflowSkillVariables("处理 {{ subject }}、{{subject}} 和 {{ other_value }}")).toEqual([
      { id: "subject", label: "subject", required: true },
      { id: "other_value", label: "other_value", required: true },
    ]);
  });
});
