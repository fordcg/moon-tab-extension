import {
  createWorkflowTaskMarkdown,
  createWorkflowTaskMarkdownFilename,
  downloadWorkflowTaskMarkdown,
} from "../../../src/side-panel/utils/workflowMarkdownExport";
import type { WorkflowTask } from "../../../src/shared/types";

function createTask(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    id: "workflow-task-1",
    sessionId: "session-1",
    template: "research",
    title: "页面研究",
    objective: "研究当前页面",
    status: "completed",
    createdAt: 1699990000000,
    updatedAt: 1700000000000,
    contextItems: [],
    steps: [],
    artifacts: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("workflowMarkdownExport", () => {
  it("导出任务 Markdown 时只包含脱敏上下文和产物内容", () => {
    const task = createTask({
      title: "token=title-secret",
      contextItems: [{
        id: "context-safe",
        kind: "page-content",
        title: "页面摘要",
        summary: "页面内容安全摘要",
        capturedAt: 1700000000000,
        redacted: true,
        truncated: false,
        sensitive: false,
      }, {
        id: "context-sensitive",
        kind: "screenshot",
        title: "敏感截图",
        summary: "data:image/png;base64,secret",
        capturedAt: 1700000000000,
        redacted: false,
        truncated: false,
        sensitive: true,
      }],
      artifacts: [{
        id: "artifact-1",
        kind: "conclusion",
        title: "Authorization: Bearer title-secret",
        content: "结论包含 Authorization: Bearer artifact-secret\n图片 data:image/png;base64,raw-secret",
        contextItemIds: ["context-safe", "context-sensitive"],
        createdAt: 1700000100000,
      }],
    });

    const markdown = createWorkflowTaskMarkdown(task, 1700000200000);

    expect(markdown).toContain("# token=[已脱敏]");
    expect(markdown).toContain("## 上下文摘要");
    expect(markdown).toContain("页面内容安全摘要");
    expect(markdown).toContain("引用上下文：页面摘要");
    expect(markdown).toContain("[已移除 data URL]");
    expect(markdown).not.toContain("title-secret");
    expect(markdown).not.toContain("artifact-secret");
    expect(markdown).not.toContain("raw-secret");
    expect(markdown).not.toContain("data:image/png");
    expect(markdown).not.toContain("敏感截图");
  });

  it("生成任务 Markdown 下载文件", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2023-11-14T22:16:40.000Z"));
    const click = vi.fn();
    const anchor = document.createElement("a");
    Object.defineProperty(anchor, "click", { configurable: true, value: click });
    vi.spyOn(document, "createElement").mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      if (tagName.toLowerCase() === "a") {
        return anchor;
      }

      return Document.prototype.createElement.call(document, tagName, options);
    });
    const createObjectURL = vi.fn((blob: Blob) => {
      void blob;
      return "blob:workflow-markdown";
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
    const task = createTask({
      title: ".env/研究:*?",
      artifacts: [{
        id: "artifact-1",
        kind: "conclusion",
        title: "结论",
        content: "下载内容",
        contextItemIds: [],
        createdAt: 1700000100000,
      }],
    });

    downloadWorkflowTaskMarkdown(task);

    expect(createWorkflowTaskMarkdownFilename(task, 1700000200000)).toBe("_env_研究___-2023-11-14.md");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchor.download).toBe("_env_研究___-2023-11-14.md");
    expect(anchor.href).toBe("blob:workflow-markdown");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:workflow-markdown");
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    await expect(blob.text()).resolves.toContain("下载内容");
  });
});
