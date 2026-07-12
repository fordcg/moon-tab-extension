import { describe, expect, it } from "vitest";
import { createWorkflowTask, normalizeWorkflowTask, transitionWorkflowTask } from "../../../src/shared/chat/workflowTasks";

describe("workflowTasks", () => {
  it("only permits valid status transitions", () => {
    const task = createWorkflowTask("session-1", "research", "比较两个页面", 1);
    const waiting = transitionWorkflowTask({ ...task, status: "running" }, "waiting", 2, "页面提取不可用");
    expect(waiting).toMatchObject({ status: "waiting", updatedAt: 2, statusReason: "页面提取不可用" });
    expect(transitionWorkflowTask(waiting, "completed", 3)).toBe(waiting);
  });

  it("drops sensitive context and invalid steps during normalization", () => {
    const task = normalizeWorkflowTask({
      id: "workflow-1", sessionId: "session-1", template: "debug", title: "接口分析", objective: "分析接口", status: "completed", createdAt: 1, updatedAt: 2,
      contextItems: [{ id: "context-1", kind: "network", title: "请求详情", summary: "authorization: Bearer secret", capturedAt: 1, redacted: false, truncated: false, sensitive: true }],
      steps: [{ id: "", title: "", status: "running", updatedAt: 1 }], artifacts: [],
    });
    expect(task?.contextItems).toEqual([]);
    expect(task?.steps).toEqual([]);
  });
});
