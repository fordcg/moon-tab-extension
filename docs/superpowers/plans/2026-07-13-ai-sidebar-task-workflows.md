# AI 侧边栏任务工作流 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 AI 侧边栏中交付持久化任务、显式上下文、任务产物和本地技能，使开发调试、网页研究及网页自动化共享同一工作流。

**Architecture:** 在 `ChatSession` 中持久化 `workflowTasks`，以便沿用已有 Dexie、同步和会话生命周期；运行中的请求取消句柄继续留在 `appStoreChatTasks.ts` 的内存表。任务状态、上下文过滤、产物和技能操作各自放入纯函数模块，Zustand 只负责协调持久化与 UI 状态，流式工具事件只更新对应任务的步骤摘要。

**Tech Stack:** React 18、TypeScript、Zustand、Dexie、Vitest、Testing Library、Playwright。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `src/shared/types.ts` | 定义任务、上下文、产物、技能和模板的持久化类型。 |
| `src/shared/chat/workflowTasks.ts` | 纯状态机、上下文过滤、产物和技能归一化。 |
| `src/shared/storage/repositories.ts` | 归一化旧会话中的新增可选字段。 |
| `src/side-panel/state/appStoreWorkflowTasks.ts` | 会话任务的创建、更新、持久化和技能存储 action。 |
| `src/side-panel/state/appStore.ts` | 暴露工作流状态/action，并将流式工具事件接入当前任务。 |
| `src/side-panel/components/WorkflowTaskCard.tsx` | 消息流中的任务状态、步骤与继续/取消操作。 |
| `src/side-panel/components/TaskContextPanel.tsx` | 任务上下文的固定、移除、刷新、摘要化操作。 |
| `src/side-panel/components/TaskArtifactsPanel.tsx` | 任务产物展示与 Markdown 导出。 |
| `src/side-panel/components/WorkflowTemplateMenu.tsx` | 三类任务模板选择入口。 |
| `src/side-panel/components/WorkflowSkillDialog.tsx` | 保存和启动本地技能，校验变量与工具可用性。 |
| `src/side-panel/components/ChatPanel.tsx` | 将任务组件置于聊天主面板，并提供任务入口。 |
| `src/side-panel/components/ChatComposer.tsx` | 将当前草稿作为任务目标发起，不改变普通发送路径。 |
| `src/side-panel/utils/workflowMarkdownExport.ts` | 对任务产物做脱敏 Markdown 导出。 |
| `src/side-panel/styles.css` | 侧栏窄轨任务 UI 的状态、展开与 reduced-motion 样式。 |

## Task 1: 定义工作流持久化契约

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/shared/chat/workflowTasks.ts`
- Test: `tests/unit/shared/workflowTasks.test.ts`

- [ ] **Step 1: 写出任务状态机与脱敏持久化的失败用例**

```ts
import { describe, expect, it } from "vitest";
import {
  createWorkflowTask,
  normalizeWorkflowTask,
  transitionWorkflowTask,
} from "../../../src/shared/chat/workflowTasks";

describe("workflowTasks", () => {
  it("只允许 running 任务进入 waiting，且保留失败步骤摘要", () => {
    const task = createWorkflowTask("session-1", "research", "比较两个页面", 1);
    const next = transitionWorkflowTask(task, "waiting", 2, "页面提取不可用");

    expect(next).toMatchObject({
      status: "waiting",
      updatedAt: 2,
      statusReason: "页面提取不可用",
    });
    expect(transitionWorkflowTask(next, "running", 3)).toBe(next);
  });

  it("归一化时剔除敏感上下文正文与无效步骤", () => {
    const task = normalizeWorkflowTask({
      id: "workflow-1",
      sessionId: "session-1",
      template: "debug",
      title: "接口分析",
      status: "completed",
      createdAt: 1,
      updatedAt: 2,
      contextItems: [{
        id: "context-1",
        kind: "network",
        title: "请求详情",
        summary: "authorization: Bearer secret",
        capturedAt: 1,
        redacted: false,
        truncated: false,
        sensitive: true,
      }],
      steps: [{ id: "", title: "", status: "running", updatedAt: 1 }],
    });

    expect(task?.contextItems).toEqual([]);
    expect(task?.steps).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx vitest run tests/unit/shared/workflowTasks.test.ts`

Expected: FAIL，提示无法解析 `workflowTasks` 模块。

- [ ] **Step 3: 在共享类型中添加完整任务模型**

在 `src/shared/types.ts` 的 `ChatSession` 前添加：

```ts
export type WorkflowTaskTemplate = "debug" | "research" | "automation";
export type WorkflowTaskStatus = "preparing" | "running" | "waiting" | "completed" | "failed" | "canceled";
export type WorkflowStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type WorkflowContextKind = "tab" | "page-content" | "screenshot" | "network" | "js-source" | "source-map" | "runtime" | "web-search" | "mcp";
export type WorkflowArtifactKind = "conclusion" | "table" | "code" | "debug-report" | "automation-report" | "screenshot";

export interface WorkflowTaskStep {
  id: string;
  title: string;
  status: WorkflowStepStatus;
  toolCallId?: string;
  detail?: string;
  updatedAt: number;
}

export interface WorkflowContextItem {
  id: string;
  kind: WorkflowContextKind;
  title: string;
  summary: string;
  capturedAt: number;
  redacted: boolean;
  truncated: boolean;
  sensitive: boolean;
  pinned?: boolean;
  referenceCount?: number;
}

export interface WorkflowArtifact {
  id: string;
  kind: WorkflowArtifactKind;
  title: string;
  content: string;
  contextItemIds: string[];
  createdAt: number;
}

export interface WorkflowTask {
  id: string;
  sessionId: string;
  template: WorkflowTaskTemplate;
  title: string;
  objective: string;
  status: WorkflowTaskStatus;
  statusReason?: string;
  createdAt: number;
  updatedAt: number;
  contextItems: WorkflowContextItem[];
  steps: WorkflowTaskStep[];
  artifacts: WorkflowArtifact[];
}

export interface WorkflowSkillVariable {
  id: string;
  label: string;
  required: boolean;
}

export interface WorkflowSkill {
  id: string;
  title: string;
  template: WorkflowTaskTemplate;
  objectiveTemplate: string;
  variables: WorkflowSkillVariable[];
  requiredContextKinds: WorkflowContextKind[];
  recommendedToolIds: string[];
  artifactKinds: WorkflowArtifactKind[];
  createdAt: number;
  updatedAt: number;
}
```

并为 `ChatSession` 添加 `workflowTasks?: WorkflowTask[]`，新增 app setting key `aiSidebar.workflowSkills.v1` 的值类型为 `WorkflowSkill[]`。

- [ ] **Step 4: 实现纯状态机与归一化函数**

创建 `src/shared/chat/workflowTasks.ts`，导出以下函数并仅接受可序列化数据：

```ts
export function createWorkflowTask(
  sessionId: string,
  template: WorkflowTaskTemplate,
  objective: string,
  now = Date.now(),
): WorkflowTask;

export function transitionWorkflowTask(
  task: WorkflowTask,
  status: WorkflowTaskStatus,
  now = Date.now(),
  statusReason?: string,
): WorkflowTask;

export function normalizeWorkflowTask(value: unknown): WorkflowTask | undefined;

export function normalizeWorkflowTasks(value: unknown): WorkflowTask[];

export function addWorkflowContextItem(task: WorkflowTask, item: WorkflowContextItem): WorkflowTask;

export function removeWorkflowContextItem(task: WorkflowTask, contextItemId: string): WorkflowTask;

export function toggleWorkflowContextPinned(task: WorkflowTask, contextItemId: string): WorkflowTask;

export function addWorkflowArtifact(task: WorkflowTask, artifact: WorkflowArtifact): WorkflowTask;
```

`transitionWorkflowTask` 只允许 `preparing -> running|canceled`、`running -> waiting|completed|failed|canceled`、`waiting -> running|canceled|failed`；所有其他跳转返回原对象。`normalizeWorkflowTask` 必须要求非空 ID、会话 ID、标题和目标，过滤无效步骤，删除 `sensitive === true` 或 `redacted === false` 的上下文条目，并从产物内容中移除敏感文本。

- [ ] **Step 5: 运行单元测试并提交**

Run: `npx vitest run tests/unit/shared/workflowTasks.test.ts`

Expected: PASS。

```powershell
git add src/shared/types.ts src/shared/chat/workflowTasks.ts tests/unit/shared/workflowTasks.test.ts
git commit -m "功能：定义侧栏任务工作流模型"
```

## Task 2: 会话归一化与任务 store action

**Files:**
- Modify: `src/shared/storage/repositories.ts`
- Modify: `src/side-panel/state/appStore.ts`
- Create: `src/side-panel/state/appStoreWorkflowTasks.ts`
- Test: `tests/unit/side-panel/appStoreWorkflowTasks.test.ts`

- [ ] **Step 1: 写出 store action 的失败用例**

```ts
it("创建任务后持久化到当前会话，并可用步骤状态继续任务", async () => {
  useAppStore.setState({
    activeSessionId: "session-1",
    chatSessions: [createSession("session-1")],
  });

  const task = await useAppStore.getState().createWorkflowTask("research", "对比当前标签页");
  await useAppStore.getState().updateWorkflowTaskStatus(task.id, "waiting", "等待页面内容");

  expect(useAppStore.getState().chatSessions[0].workflowTasks?.[0]).toMatchObject({
    id: task.id,
    status: "waiting",
    statusReason: "等待页面内容",
  });
});

it("移除上下文不影响其他任务，且技能不保存敏感上下文值", async () => {
  // 建立两个任务，分别加入 context-1/context-2。
  // 调用 removeWorkflowContextItem(taskA.id, "context-1") 与 saveWorkflowSkill(taskA.id, draft)。
  // 断言 taskB 不变，技能 JSON 不包含 context item summary。
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx vitest run tests/unit/side-panel/appStoreWorkflowTasks.test.ts`

Expected: FAIL，提示 `createWorkflowTask` 不存在。

- [ ] **Step 3: 归一化并迁移会话数据**

在 `normalizeChatSession` 中添加：

```ts
workflowTasks: normalizeWorkflowTasks(session.workflowTasks),
```

并在导入类型中加入 `WorkflowSkill`、在模块顶部导入 `normalizeWorkflowTasks`。旧会话缺少字段时必须得到空数组，不能改变原消息、token usage 或偏好设置的归一化行为。

- [ ] **Step 4: 实现独立 store action 模块**

创建 `src/side-panel/state/appStoreWorkflowTasks.ts`。导出一个接受 `get`、`set`、`updateChatSession`、`getAppSetting`、`saveAppSetting` 的 action factory，提供：

```ts
createWorkflowTask(template: WorkflowTaskTemplate, objective: string): Promise<WorkflowTask>;
updateWorkflowTaskStatus(taskId: string, status: WorkflowTaskStatus, reason?: string): Promise<void>;
upsertWorkflowTaskStep(taskId: string, step: WorkflowTaskStep): Promise<void>;
addWorkflowContextItem(taskId: string, item: WorkflowContextItem): Promise<void>;
removeWorkflowContextItem(taskId: string, contextItemId: string): Promise<void>;
toggleWorkflowContextPinned(taskId: string, contextItemId: string): Promise<void>;
addWorkflowArtifact(taskId: string, artifact: WorkflowArtifact): Promise<void>;
loadWorkflowSkills(): Promise<void>;
saveWorkflowSkill(taskId: string, draft: Pick<WorkflowSkill, "title" | "variables">): Promise<WorkflowSkill>;
startWorkflowSkill(skillId: string, values: Record<string, string>): Promise<WorkflowTask>;
```

每个会话变更都使用 `updateChatSession` 更新 `updatedAt`，随后用 `upsertSession` 回写 Zustand。私密会话仅保存在 `privateChatSession` 中，技能保存不得读取私密会话的上下文原文。

- [ ] **Step 5: 接入 `AppState` 并运行测试**

在 `AppState` 添加：

```ts
workflowSkills: WorkflowSkill[];
createWorkflowTask: (template: WorkflowTaskTemplate, objective: string) => Promise<WorkflowTask>;
updateWorkflowTaskStatus: (taskId: string, status: WorkflowTaskStatus, reason?: string) => Promise<void>;
upsertWorkflowTaskStep: (taskId: string, step: WorkflowTaskStep) => Promise<void>;
addWorkflowContextItem: (taskId: string, item: WorkflowContextItem) => Promise<void>;
removeWorkflowContextItem: (taskId: string, contextItemId: string) => Promise<void>;
toggleWorkflowContextPinned: (taskId: string, contextItemId: string) => Promise<void>;
addWorkflowArtifact: (taskId: string, artifact: WorkflowArtifact) => Promise<void>;
loadWorkflowSkills: () => Promise<void>;
saveWorkflowSkill: (taskId: string, draft: Pick<WorkflowSkill, "title" | "variables">) => Promise<WorkflowSkill>;
startWorkflowSkill: (skillId: string, values: Record<string, string>) => Promise<WorkflowTask>;
```

在应用加载流程调用 `loadWorkflowSkills()`，并运行：

Run: `npx vitest run tests/unit/side-panel/appStoreWorkflowTasks.test.ts tests/unit/shared/storage.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add src/shared/storage/repositories.ts src/side-panel/state/appStore.ts src/side-panel/state/appStoreWorkflowTasks.ts tests/unit/side-panel/appStoreWorkflowTasks.test.ts
git commit -m "功能：持久化侧栏任务与本地技能"
```

## Task 3: 将流式工具事件投射为任务步骤和上下文

**Files:**
- Modify: `src/side-panel/state/appStoreStreaming.ts`
- Modify: `src/side-panel/state/appStore.ts`
- Test: `tests/unit/side-panel/appStoreWorkflowTasks.test.ts`
- Test: `tests/unit/side-panel/ChatComposer.test.ts`

- [ ] **Step 1: 写出流式事件绑定任务的失败用例**

```ts
it("工具完成事件更新当前任务步骤，并只保存已脱敏的附件摘要", async () => {
  const task = createWorkflowTask("debug", "定位接口错误");
  useAppStore.setState({ activeSessionId: "session-1", chatSessions: [createSessionWithTask(task)] });

  await applyWorkflowToolCompletion("session-1", task.id, {
    id: "call-1",
    displayName: "读取网络请求",
    status: "success",
    startedAt: 1,
    completedAt: 2,
  }, [{
    id: "network-1",
    kind: "network",
    title: "Network 请求详情",
    summary: "已脱敏请求",
    redacted: true,
    truncated: false,
    requests: [],
    createdAt: 2,
  }]);

  expect(activeTask().steps[0]).toMatchObject({ toolCallId: "call-1", status: "completed" });
  expect(activeTask().contextItems[0]).toMatchObject({ id: "network-1", redacted: true, sensitive: false });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx vitest run tests/unit/side-panel/appStoreWorkflowTasks.test.ts`

Expected: FAIL，提示 `applyWorkflowToolCompletion` 未导出。

- [ ] **Step 3: 实现附件到工作流上下文的纯转换**

在 `appStoreWorkflowTasks.ts` 导出：

```ts
export function createWorkflowContextItemsFromToolAttachments(
  attachments: ChatToolAttachment[] | undefined,
  capturedAt: number,
): WorkflowContextItem[];
```

只转换 `redacted !== false` 的网络/搜索/JS/Source Map/截图/自动化报告/MCP 附件；`summary` 使用既有附件摘要，文本先经过 `redactSensitiveText`，长度限制为 1,000 字符。任何 `dataUrl`、请求正文、响应正文和工具参数都不能进入 `WorkflowContextItem`。

- [ ] **Step 4: 通过 `StreamingChatInput` 注入工作流回调**

为 `StreamingChatInput` 添加可选回调：

```ts
onWorkflowToolStart?: (record: ChatToolCallRecord) => void;
onWorkflowToolComplete?: (record: ChatToolCallRecord, attachments?: ChatToolAttachment[]) => void;
```

在接收 `"tool:start"` 与 `"tool:complete"` 分支调用回调。`appStore.ts` 仅当本次消息显式通过 `sendWorkflowTaskMessage(taskId, content)` 发起时传入回调，避免普通聊天误写任务。

- [ ] **Step 5: 增加任务专用发送 action**

在 `AppState` 增加：

```ts
sendWorkflowTaskMessage: (taskId: string, content: string) => Promise<void>;
```

该 action 复用 `sendChatMessage` 的模型、会话和错误处理路径，但在发送前将任务从 `preparing|waiting` 转为 `running`，结束时将无错误任务转为 `completed`；取消转为 `canceled`；流失败转为 `waiting` 并写入可读原因。不要在后台另建聊天入口或绕过 Tool Registry。

- [ ] **Step 6: 运行相关测试并提交**

Run: `npx vitest run tests/unit/side-panel/appStoreWorkflowTasks.test.ts tests/unit/side-panel/ChatComposer.test.ts tests/unit/side-panel/appStoreChatTasks.test.ts`

Expected: PASS。

```powershell
git add src/side-panel/state/appStoreStreaming.ts src/side-panel/state/appStore.ts src/side-panel/state/appStoreWorkflowTasks.ts tests/unit/side-panel/appStoreWorkflowTasks.test.ts tests/unit/side-panel/ChatComposer.test.ts
git commit -m "功能：关联任务与工具执行状态"
```

## Task 4: 任务模板和上下文 UI

**Files:**
- Create: `src/side-panel/components/WorkflowTemplateMenu.tsx`
- Create: `src/side-panel/components/WorkflowTaskCard.tsx`
- Create: `src/side-panel/components/TaskContextPanel.tsx`
- Modify: `src/side-panel/components/ChatComposer.tsx`
- Modify: `src/side-panel/components/ChatPanel.tsx`
- Modify: `src/side-panel/styles.css`
- Test: `tests/unit/side-panel/WorkflowTemplateMenu.test.tsx`
- Test: `tests/unit/side-panel/WorkflowTaskCard.test.tsx`

- [ ] **Step 1: 写出模板和任务卡片的失败用例**

```tsx
it("以当前草稿创建研究任务，不发送普通聊天", async () => {
  const user = userEvent.setup();
  render(<ChatComposer canSend matchedRuleLabel="全局文本" />);
  await user.type(screen.getByRole("textbox"), "对比当前标签页");
  await user.click(screen.getByRole("button", { name: "新建任务" }));
  await user.click(screen.getByRole("menuitem", { name: "网页研究" }));

  expect(useAppStore.getState().createWorkflowTask).toHaveBeenCalledWith("research", "对比当前标签页");
  expect(useAppStore.getState().sendChatMessage).not.toHaveBeenCalled();
});

it("任务卡片显示等待原因并可继续", async () => {
  const user = userEvent.setup();
  render(<WorkflowTaskCard task={waitingTask} onContinue={onContinue} onCancel={onCancel} />);

  expect(screen.getByText("等待页面内容")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "继续任务" }));
  expect(onContinue).toHaveBeenCalledWith(waitingTask.id);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx vitest run tests/unit/side-panel/WorkflowTemplateMenu.test.tsx tests/unit/side-panel/WorkflowTaskCard.test.tsx`

Expected: FAIL，提示组件不存在。

- [ ] **Step 3: 实现模板菜单与任务创建入口**

`WorkflowTemplateMenu.tsx` 使用可访问的 `role="menu"`，固定提供：

```ts
const workflowTemplates = [
  { id: "debug", label: "开发调试", description: "分析页面、接口和源码线索" },
  { id: "research", label: "网页研究", description: "提取、比较并整理网页信息" },
  { id: "automation", label: "网页自动化", description: "执行页面操作并核验结果" },
] as const;
```

在 `ChatComposer` 增加“新建任务”图标按钮。仅当草稿非空时启用；选择模板调用 `createWorkflowTask(template, draft)`，再调用 `sendWorkflowTaskMessage(task.id, draft)`，成功后清空草稿。普通发送按钮与 Enter 快捷键不改变。

- [ ] **Step 4: 实现任务卡片和上下文面板**

`WorkflowTaskCard` 必须提供：

```tsx
<article aria-label={`任务：${task.title}`}>
  <header>{/* 模板标签、标题和文本状态 */}</header>
  <ol>{/* 每个步骤显示 title、detail 和文本状态 */}</ol>
  <TaskContextPanel task={task} />
  <button type="button" onClick={() => onContinue(task.id)}>继续任务</button>
  <button type="button" onClick={() => onCancel(task.id)}>取消任务</button>
</article>
```

仅在 `waiting` 显示继续按钮，仅在 `preparing|running|waiting` 显示取消按钮。`TaskContextPanel` 使用 `details` 展开清单，提供固定/取消固定、移除、刷新和“压缩为摘要”操作；刷新只允许 tab/page-content 项并调用已有 `refreshPageContext`，压缩仅替换当前条目摘要，不发送模型请求。

- [ ] **Step 5: 将任务卡片放入聊天主区域并实现窄轨样式**

`ChatPanel` 在 `MessageList` 与 `ChatComposer` 之间渲染当前会话的 `workflowTasks`。样式使用现有 `--color-*` token、0.5rem 到 0.875rem 半径、文本状态和 2.25rem 图标格；不新增装饰色或嵌套卡片。所有展开和状态变化添加 `prefers-reduced-motion: reduce` 的零时长规则。

- [ ] **Step 6: 运行 UI 测试并提交**

Run: `npx vitest run tests/unit/side-panel/WorkflowTemplateMenu.test.tsx tests/unit/side-panel/WorkflowTaskCard.test.tsx tests/unit/side-panel/ChatComposer.test.ts`

Expected: PASS。

```powershell
git add src/side-panel/components/WorkflowTemplateMenu.tsx src/side-panel/components/WorkflowTaskCard.tsx src/side-panel/components/TaskContextPanel.tsx src/side-panel/components/ChatComposer.tsx src/side-panel/components/ChatPanel.tsx src/side-panel/styles.css tests/unit/side-panel/WorkflowTemplateMenu.test.tsx tests/unit/side-panel/WorkflowTaskCard.test.tsx
git commit -m "功能：提供侧栏任务模板与上下文界面"
```

## Task 5: 任务产物、脱敏 Markdown 导出和模板结果

**Files:**
- Create: `src/side-panel/components/TaskArtifactsPanel.tsx`
- Create: `src/side-panel/utils/workflowMarkdownExport.ts`
- Modify: `src/side-panel/components/WorkflowTaskCard.tsx`
- Modify: `src/side-panel/state/appStoreWorkflowTasks.ts`
- Test: `tests/unit/side-panel/workflowMarkdownExport.test.ts`
- Test: `tests/unit/side-panel/TaskArtifactsPanel.test.tsx`

- [x] **Step 1: 写出导出与产物呈现的失败用例**

```ts
it("导出任务时只包含产物与已脱敏上下文摘要", () => {
  const markdown = createWorkflowTaskMarkdown(taskWithNetworkArtifact, 10);

  expect(markdown).toContain("# 接口诊断");
  expect(markdown).toContain("## 调试报告");
  expect(markdown).not.toContain("Bearer raw-secret");
  expect(markdown).not.toContain("\"responseBody\"");
});
```

```tsx
it("产物面板可复制和导出 Markdown", async () => {
  const user = userEvent.setup();
  render(<TaskArtifactsPanel task={taskWithArtifact} />);

  await user.click(screen.getByRole("button", { name: "导出任务 Markdown" }));
  expect(downloadBlob).toHaveBeenCalled();
});
```

- [x] **Step 2: 运行测试并确认失败**

Run: `npx vitest run tests/unit/side-panel/workflowMarkdownExport.test.ts tests/unit/side-panel/TaskArtifactsPanel.test.tsx`

Expected: FAIL，提示导出函数和产物组件不存在。

- [x] **Step 3: 实现任务 Markdown 导出**

创建 `workflowMarkdownExport.ts` 并导出：

```ts
export function createWorkflowTaskMarkdown(task: WorkflowTask, exportedAt?: number): string;
export function downloadWorkflowTaskMarkdown(task: WorkflowTask, exportedAt?: number): void;
```

导出顺序固定为标题、模板/状态/导出时间、上下文摘要、产物。对标题、摘要和产物正文使用现有 `redactSensitiveText`；不导出 `sensitive` 上下文、不导出截图 `dataUrl`、不导出工具参数或附件详情。

- [x] **Step 4: 实现产物面板与三个模板的产物规则**

`TaskArtifactsPanel` 显示产物类型、标题和内容，提供复制与 Markdown 导出。`appStoreWorkflowTasks.ts` 新增：

```ts
export function createWorkflowArtifactFromAssistantMessage(
  task: WorkflowTask,
  message: ChatMessage,
  now?: number,
): WorkflowArtifact | undefined;
```

该函数在任务最终 assistant 消息非空时创建 `conclusion`；当模板为 `debug` 且有成功 Network/JS/Source Map/Runtime 步骤时创建 `debug-report`；当模板为 `automation` 且有浏览器操作步骤时创建 `automation-report`。研究任务保留 `conclusion`，若正文包含 Markdown 表格则额外创建 `table`。所有内容先脱敏且上限为 12,000 字符。

- [x] **Step 5: 运行测试并提交**

Run: `npx vitest run tests/unit/side-panel/workflowMarkdownExport.test.ts tests/unit/side-panel/TaskArtifactsPanel.test.tsx`

Expected: PASS。

```powershell
git add src/side-panel/components/TaskArtifactsPanel.tsx src/side-panel/components/WorkflowTaskCard.tsx src/side-panel/state/appStoreWorkflowTasks.ts src/side-panel/utils/workflowMarkdownExport.ts tests/unit/side-panel/workflowMarkdownExport.test.ts tests/unit/side-panel/TaskArtifactsPanel.test.tsx
git commit -m "功能：沉淀任务产物并支持导出"
```

## Task 6: 本地技能保存与启动

**Files:**
- Create: `src/side-panel/components/WorkflowSkillDialog.tsx`
- Modify: `src/side-panel/components/WorkflowTaskCard.tsx`
- Modify: `src/side-panel/state/appStoreWorkflowTasks.ts`
- Modify: `src/side-panel/components/ChatPanel.tsx`
- Modify: `src/side-panel/styles.css`
- Test: `tests/unit/side-panel/WorkflowSkillDialog.test.tsx`
- Test: `tests/unit/side-panel/ChatPanel.test.tsx`
- Test: `tests/unit/side-panel/WorkflowTaskCard.test.tsx`
- Test: `tests/unit/side-panel/appStoreWorkflowTasks.test.ts`

- [x] **Step 1: 写出技能变量与运行时降级的失败用例**

```tsx
it("缺少必填变量时不启动技能", async () => {
  const user = userEvent.setup();
  render(<WorkflowSkillDialog open skill={researchSkill} onOpenChange={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "启动技能" }));
  expect(screen.getByText("请填写：对比对象")).toBeVisible();
});
```

```ts
it("所需工具不可用时，创建等待任务而不是调用工具", async () => {
  mockToolAvailability({ "browser.extract_content": false });
  const task = await useAppStore.getState().startWorkflowSkill("skill-1", { subject: "当前页面" });

  expect(task.status).toBe("waiting");
  expect(task.statusReason).toContain("不可用");
});
```

- [x] **Step 2: 运行测试并确认失败**

Run: `npx vitest run tests/unit/side-panel/WorkflowSkillDialog.test.tsx tests/unit/side-panel/appStoreWorkflowTasks.test.ts`

Expected: FAIL，提示技能对话框或运行时校验尚未实现。

- [x] **Step 3: 实现技能对话框**

`WorkflowSkillDialog` 使用现有弹窗覆盖层模式，显示技能标题、模板和变量输入。启动时：

1. 对 `required === true` 的变量做 `trim()` 非空校验。
2. 将 `{{variableId}}` 替换为经过 `redactSensitiveText` 的用户值。
3. 调用 `startWorkflowSkill`。
4. 对推荐工具不可用的技能创建 `waiting` 任务，由任务卡展示状态原因并保留继续入口。

不显示、编辑或保存任一任务上下文摘要、页面元素 UID、Cookie、Token 或工具参数。

- [x] **Step 4: 为任务卡片接入显式保存技能**

仅 `completed` 任务显示“保存为技能”。草稿包含标题和从任务目标中明确标记的 `{{变量}}`；没有变量时保存空变量数组。保存时仅写入模板、目标模板、所需上下文 `kind`、推荐 tool ID 和产物 `kind`，不复制产物正文。

- [x] **Step 5: 运行测试并提交**

Run: `npm test -- tests/unit/side-panel/ChatPanel.test.tsx tests/unit/side-panel/WorkflowSkillDialog.test.tsx tests/unit/side-panel/WorkflowTaskCard.test.tsx tests/unit/side-panel/appStoreWorkflowTasks.test.ts`

Expected: PASS。

```powershell
git add src/side-panel/components/WorkflowSkillDialog.tsx src/side-panel/components/WorkflowTaskCard.tsx src/side-panel/components/ChatPanel.tsx src/side-panel/state/appStoreWorkflowTasks.ts src/side-panel/styles.css tests/unit/side-panel/ChatPanel.test.tsx tests/unit/side-panel/WorkflowSkillDialog.test.tsx tests/unit/side-panel/WorkflowTaskCard.test.tsx tests/unit/side-panel/appStoreWorkflowTasks.test.ts
git commit -m "功能：保存并启动侧栏本地技能"
```

## Task 7: 三类模板端到端验证与发布质量门

**Files:**
- Create: `tests/e2e/workflow-tasks.spec.ts`
- Modify: `scripts/verify_ai_sidebar_quality.ps1`
- Test: `tests/e2e/workflow-tasks.spec.ts`

- [x] **Step 1: 写出三个任务模板的 Playwright 闭环**

```ts
test("网页研究任务从草稿创建、显示上下文并导出结论", async ({ extensionPage }) => {
  await extensionPage.getByRole("textbox").fill("整理当前页面要点");
  await extensionPage.getByRole("button", { name: "新建任务" }).click();
  await extensionPage.getByRole("menuitem", { name: "网页研究" }).click();
  await expect(extensionPage.getByLabel(/任务：/)).toContainText("网页研究");
  await expect(extensionPage.getByRole("button", { name: "导出任务 Markdown" })).toBeEnabled();
});
```

为 `开发调试` 覆盖 Network/工具步骤与调试报告，为 `网页自动化` 覆盖浏览器工具步骤与自动化报告。三个测试均使用本地假 OpenAI 服务和现有扩展 fixture，不能依赖远程模型或真实页面。

- 实现：`tests/e2e/workflow-tasks.spec.ts` 覆盖 `网页研究`、`开发调试`、`网页自动化` 三类任务模板，使用 web-preview + IndexedDB seed + mock runtime port，不依赖远程模型或真实扩展后台。

- [x] **Step 2: 运行 E2E 并确认先失败**

Run: `npx playwright test tests/e2e/workflow-tasks.spec.ts`

Expected: 在功能接入前 FAIL，缺少任务入口或任务卡片。

- 验证：首次执行 `npm run test:e2e -- tests/e2e/workflow-tasks.spec.ts` 先失败，暴露 IndexedDB 版本、任务卡 label 严格匹配和 web-preview `window.chrome` mock 问题；随后修正 seed、role selector 与 runtime mock。

- [x] **Step 3: 补足稳定选择器和失败恢复断言**

为任务入口、三种模板、任务卡片、上下文折叠、继续、取消和产物导出添加稳定 `aria-label`。在自动化测试中模拟 debugger 断开，断言任务进入 `waiting`、主聊天仍可发送普通消息、继续操作可见。

- 实现：`WorkflowTaskCard` 增加任务卡 `aria-label`；测试使用 role 精确定位任务卡、验证上下文/步骤/产物/导出/保存技能入口，并模拟流式端口断开后任务保持 `waiting` 且普通聊天可继续发送。

- [x] **Step 4: 纳入质量门并运行完整验证**

在 `scripts/verify_ai_sidebar_quality.ps1` 的 Playwright 步骤后增加：

```powershell
npx playwright test tests/e2e/workflow-tasks.spec.ts
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
```

Run: `npm test`

Expected: PASS。

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify_ai_sidebar_quality.ps1`

Expected: PASS。

- 验证：
  - `npm test` PASS，98 个测试文件、1192 个用例通过。
  - `npm run typecheck` PASS。
  - `npm run test:e2e -- tests/e2e/workflow-tasks.spec.ts` PASS，4 个 workflow 任务用例通过。
  - `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify_ai_sidebar_quality.ps1` 退出码 0，最终输出 `AI sidebar quality checks passed.`；质量门会传播 npm/node/python 原生命令的非零退出码，smoke JSON 细项失败时会中止脚本。

- [x] **Step 5: 提交**

```powershell
git add docs/superpowers/plans/2026-07-13-ai-sidebar-task-workflows.md playwright.config.ts scripts/verify_ai_sidebar_quality.ps1 src/side-panel/components/WorkflowTaskCard.tsx tests/e2e/workflow-tasks.spec.ts tests/unit/background/currentTimeTool.test.ts tests/unit/background/tavilyTool.test.ts tests/unit/shared/syncSnapshot.test.ts tests/unit/side-panel/App.test.tsx
git commit -m "测试：覆盖侧栏任务工作流闭环"
```

## 自检

- 任务状态、模板、上下文、产物与本地技能分别由 Task 1、2、4、5、6 覆盖。
- 开发调试、网页研究、网页自动化的实际闭环由 Task 7 覆盖。
- 所有上下文和导出路径均要求脱敏，且不保存截图 data URL、请求/响应正文、工具参数或敏感值。
- 任务执行复用既有流式聊天、Tool Registry、浏览器队列、权限边界和工具审计；没有新增审批或操作回放功能。
