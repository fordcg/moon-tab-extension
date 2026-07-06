# Phase 5 Tools And Security Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the migrated Browser AI Assistant tool surface so low-risk tools work by default while high-risk browser, Network, MCP, replay, runtime, and full-access capabilities remain behind explicit runtime boundaries, redacted attachments, and audit trails.

**Architecture:** Keep `src/shared/models/toolRegistry.ts` as the single source of tool metadata and `src/background/backgroundToolRuntime.ts` plus `src/background/browserControlMessageHandler.ts` as runtime gates. Side-panel settings manage persisted preferences only; browser-control attachment state, automation mode, and boundary grants stay runtime-scoped in background state. Tool outputs flow through structured `ChatToolAttachment` objects that are normalized, redacted, aggregated, and referenced by tool-call records.

**Tech Stack:** Chrome MV3, TypeScript, Vite, React, Zustand, Dexie-backed settings, Chrome storage/session APIs, Vitest, Playwright.

---

## Context

- 总设计：`docs/superpowers/specs/2026-07-05-full-upstream-engineering-migration-design.md`
- 迁移台账：`docs/superpowers/MIGRATION_STATUS.md`
- Phase 4 计划：`docs/superpowers/plans/2026-07-06-full-upstream-engineering-migration-phase-4.md`
- 历史同名阶段计划：`docs/superpowers/plans/2026-07-05-ai-sidebar-upstream-migration-phase-5.md` 是旧 AI sidebar no-build 迁移计划，不作为本阶段执行依据。

Phase 4 已把 background、AgentTools、Imagefree、DevTools Network bridge 和 browser-control 源码迁入 TypeScript 工程。Phase 5 不重新引入工具系统，而是固化工具暴露矩阵、运行态授权、边界确认、附件脱敏、MCP/Tavily/Imagefree 数据边界、DevTools Network 兼容边界和迁移台账。

## Execution Preconditions

- 使用 PowerShell 执行命令。
- 多行输入使用 PowerShell here-string 或 `apply_patch`，不要使用 bash heredoc。
- 手写文件修改使用 `apply_patch`。
- 执行前确认 Phase 4 工作区已提交，或者用户明确允许在当前未提交 Phase 4 结果之上继续开发。
- 如果执行者需要提交，每个任务提交信息使用中文。

## File Map

- Modify: `src/shared/models/toolRegistry.ts` owns tool ids, grouping, classifications, runtime availability, and schema contracts.
- Modify: `src/background/backgroundToolRuntime.ts` owns `shouldExposeTool`, model tool definitions, Tavily/Imagefree/MCP execution dispatch, and browser-control prompt injection.
- Modify: `src/background/browserControlMessageHandler.ts` owns debugger-backed browser-control runtime gates, automation mode, boundary grants, replay, runtime-readonly, and full-access behavior.
- Modify: `src/background/browserControl/boundaryChoiceToolExecutor.ts` owns user confirmation normalization, request lifecycle, tab/origin binding, and one-shot grant creation.
- Modify: `src/background/agentToolsMessageHandler.ts` owns legacy AgentTools, MCP settings, Grok bridge config push, and audit redaction.
- Modify: `src/background/index.ts` owns runtime message routing and DevTools Network compatibility exposure for chat and AgentTools state.
- Modify: `src/shared/toolAuthorization.ts` owns reusable authorization and scope-key helpers.
- Modify: `src/shared/toolArtifacts.ts` owns tool attachment normalization, aggregation, redaction, prompt formatting, and export formatting.
- Modify: `src/shared/types.ts` only if attachment or audit type contracts need explicit fields already used by runtime.
- Modify: `src/side-panel/components/settings/ChatPreferenceSettings.tsx` only for persisted preference labels, filters, and copy that clarifies runtime filtering.
- Modify: `src/side-panel/components/settings/McpToolSettings.tsx` only for MCP token local-only UI wording or disabled remote-tool states.
- Modify: `src/side-panel/state/appStore.ts` and adjacent action modules only for preference persistence versus runtime-mode separation.
- Test: `tests/unit/shared/toolRegistry.test.ts`
- Test: `tests/unit/background/backgroundToolRuntime.test.ts`
- Test: `tests/unit/background/browserControlMessageHandler.test.ts`
- Create: `tests/unit/background/boundaryChoiceToolExecutor.test.ts`
- Test: `tests/unit/shared/toolArtifacts.test.ts`
- Test: `tests/unit/side-panel/browserControlPreferences.test.ts`
- Test: `tests/unit/background/agentToolsMessageHandler.test.ts`
- Test: `tests/unit/background/index.test.ts`
- Docs: `docs/superpowers/MIGRATION_STATUS.md` is updated only after implementation and verification pass.

---

### Task 1: Tool Registry And Exposure Matrix Contract

**Files:**
- Modify: `tests/unit/shared/toolRegistry.test.ts`
- Modify: `tests/unit/background/backgroundToolRuntime.test.ts`
- Modify: `src/shared/models/toolRegistry.ts`
- Modify: `src/background/backgroundToolRuntime.ts`

- [ ] **Step 1: Add registry classification contract test**

In `tests/unit/shared/toolRegistry.test.ts`, add `isToolRuntimeAvailable` to the existing import from `toolRegistry`, then add this test inside `describe("模型工具注册表", () => { ... })`:

```ts
  it("所有内置工具都有结构化分类并 obey 运行态可用矩阵", () => {
    const tools = getRegisteredModelTools();
    const byId = new Map(tools.map((tool) => [tool.id, tool]));

    const invalidClassifications = tools.filter((tool) => {
      const classification = tool.toolClassification;
      return !classification ||
        !MODEL_TOOL_RUNTIME_VALUES.includes(classification.runtime) ||
        !MODEL_TOOL_RISK_VALUES.includes(classification.risk) ||
        classification.capabilities.some((capability) => !MODEL_TOOL_CAPABILITY_VALUES.includes(capability));
    });
    expect(invalidClassifications).toEqual([]);

    expect(isToolRuntimeAvailable(byId.get(CURRENT_TIME_TOOL_ID)!, false, "normal_restricted")).toBe(true);
    expect(isToolRuntimeAvailable(byId.get(TAVILY_SEARCH_TOOL_ID)!, false, "normal_restricted")).toBe(true);
    expect(isToolRuntimeAvailable(byId.get(BROWSER_TAKE_SNAPSHOT_TOOL_ID)!, false, "normal_restricted")).toBe(false);
    expect(isToolRuntimeAvailable(byId.get(BROWSER_TAKE_SNAPSHOT_TOOL_ID)!, true, "normal_restricted")).toBe(true);
    expect(isToolRuntimeAvailable(byId.get(BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID)!, true, "normal_restricted")).toBe(false);
    expect(isToolRuntimeAvailable(byId.get(BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID)!, true, "controlled_enhanced")).toBe(true);
    expect(isToolRuntimeAvailable(byId.get(FULL_ACCESS_EXECUTE_SCRIPT_TOOL_ID)!, true, "controlled_enhanced")).toBe(false);
    expect(isToolRuntimeAvailable(byId.get(FULL_ACCESS_EXECUTE_SCRIPT_TOOL_ID)!, true, "full_access")).toBe(true);
  });
```

- [ ] **Step 2: Run RED check**

Run: `npx vitest run tests/unit/shared/toolRegistry.test.ts --testNamePattern "结构化分类|运行态可用矩阵"`

Expected before implementation: FAIL if any tool lacks `toolClassification`, has an invalid runtime/risk/capability, or `isToolRuntimeAvailable` does not match the Phase 5 matrix. PASS is acceptable only if existing code already satisfies this contract.

- [ ] **Step 3: Add exposure matrix regression test**

In `tests/unit/background/backgroundToolRuntime.test.ts`, add this test inside `describe("background 工具运行时封装", () => { ... })`:

```ts
  it("运行时暴露矩阵不会把受控增强和完全访问工具降级到普通浏览器控制", () => {
    browserControlManagerMock.canExposeTakeSnapshotTool.mockReturnValue(true);
    browserControlManagerMock.canExposeBrowserTool.mockReturnValue(true);
    browserControlManagerMock.canExposeNetworkTool.mockReturnValue(true);
    browserControlManagerMock.canExposeRuntimeReadTool.mockReturnValue(true);
    browserControlManagerMock.canExposeBoundaryChoiceTool.mockReturnValue(false);
    browserControlManagerMock.canExposeReplayTool.mockReturnValue(false);
    browserControlManagerMock.canExposeFullAccessTool.mockReturnValue(false);

    expect(shouldExposeTool({ id: "browser.click", name: "click", parameters: {} })).toBe(true);
    expect(shouldExposeTool({ id: "network.list_requests", name: "network_list_requests", parameters: {} })).toBe(true);
    expect(shouldExposeTool({ id: "runtime.inspect_globals", name: "runtime_inspect_globals", parameters: {} })).toBe(true);
    expect(shouldExposeTool({ id: "boundary.request_user_choice", name: "boundary_request_user_choice", parameters: {} })).toBe(false);
    expect(shouldExposeTool({ id: "replay.send_request", name: "replay_send_request", parameters: {} })).toBe(false);
    expect(shouldExposeTool({ id: "full_access.fetch", name: "full_access_fetch", parameters: {} })).toBe(false);

    browserControlManagerMock.canExposeBoundaryChoiceTool.mockReturnValue(true);
    browserControlManagerMock.canExposeReplayTool.mockReturnValue(true);
    browserControlManagerMock.canExposeFullAccessTool.mockReturnValue(true);

    expect(shouldExposeTool({ id: "boundary.request_user_choice", name: "boundary_request_user_choice", parameters: {} })).toBe(true);
    expect(shouldExposeTool({ id: "replay.send_request", name: "replay_send_request", parameters: {} })).toBe(true);
    expect(shouldExposeTool({ id: "full_access.fetch", name: "full_access_fetch", parameters: {} })).toBe(true);
  });
```

- [ ] **Step 4: Run exposure RED check**

Run: `npx vitest run tests/unit/background/backgroundToolRuntime.test.ts --testNamePattern "暴露矩阵|受控增强|完全访问"`

Expected before implementation: FAIL if `shouldExposeTool` exposes `boundary.*`, `replay.*`, or `full_access.*` using only normal browser-control gates. PASS is acceptable only if existing code already enforces the matrix.

- [ ] **Step 5: Implement minimal registry/runtime fixes**

If Step 2 fails, update `src/shared/models/toolRegistry.ts` so every entry in `RAW_AVAILABLE_MODEL_TOOLS` has a matching `TOOL_CLASSIFICATION_BY_ID` item and `AVAILABLE_MODEL_TOOLS` continues to assign `toolClassification: getRequiredToolClassification(tool.id)`.

If Step 4 fails, keep `src/background/backgroundToolRuntime.ts` in this form:

```ts
export function shouldExposeTool(tool: ModelToolRegistryEntry): boolean {
  if (tool.id === BROWSER_TAKE_SNAPSHOT_TOOL_ID) {
    return browserControlManager.canExposeTakeSnapshotTool();
  }

  if (tool.id.startsWith("browser.")) {
    return browserControlManager.canExposeBrowserTool();
  }

  if (tool.id.startsWith("network.")) {
    return browserControlManager.canExposeNetworkTool();
  }

  if (tool.id.startsWith("js.")) {
    return browserControlManager.canExposeNetworkTool();
  }

  if (tool.id.startsWith("sourcemap.")) {
    return browserControlManager.canExposeNetworkTool();
  }

  if (tool.id.startsWith("runtime.")) {
    return browserControlManager.canExposeRuntimeReadTool();
  }

  if (tool.id.startsWith("boundary.")) {
    return browserControlManager.canExposeBoundaryChoiceTool();
  }

  if (tool.id.startsWith("replay.")) {
    return browserControlManager.canExposeReplayTool();
  }

  if (tool.id.startsWith("full_access.")) {
    return browserControlManager.canExposeFullAccessTool();
  }

  return true;
}
```

- [ ] **Step 6: Run GREEN check**

Run: `npx vitest run tests/unit/shared/toolRegistry.test.ts tests/unit/background/backgroundToolRuntime.test.ts --testNamePattern "结构化分类|运行态可用矩阵|暴露矩阵|受控增强|完全访问"`

Expected after implementation: PASS.

- [ ] **Step 7: Commit this task if committing is enabled**

```powershell
git add src/shared/models/toolRegistry.ts src/background/backgroundToolRuntime.ts tests/unit/shared/toolRegistry.test.ts tests/unit/background/backgroundToolRuntime.test.ts
git commit -m "测试：固化工具运行态暴露矩阵"
```

---

### Task 2: Persisted Tool Preferences Versus Runtime Boundaries

**Files:**
- Modify: `tests/unit/side-panel/browserControlPreferences.test.ts`
- Modify: `tests/unit/background/index.test.ts`
- Modify: `src/side-panel/state/appStore.ts`
- Modify: `src/side-panel/components/settings/ChatPreferenceSettings.tsx`
- Modify: `src/background/index.ts`

- [ ] **Step 1: Add preference persistence test for high-risk tool ids**

In `tests/unit/side-panel/browserControlPreferences.test.ts`, add this test inside `describe("浏览器控制全局运行态", () => { ... })`:

```ts
  it("工具偏好可以保存高风险工具 ID，但不会保存实时授权态", async () => {
    await useAppStore.getState().updateChatPreferences({
      enabledToolIds: ["system.current_time", "boundary.request_user_choice", "replay.send_request", "full_access.fetch"],
      defaultBrowserAutomationMode: "full_access",
    });

    const stored = await getAppSetting("chatPreferences");
    expect(stored).toMatchObject({
      enabledToolIds: ["system.current_time", "boundary.request_user_choice", "replay.send_request", "full_access.fetch"],
      defaultBrowserAutomationMode: "full_access",
    });
    expect(stored).not.toMatchObject({
      browserControlEnabled: true,
      browserAutomationMode: "full_access",
      pendingBoundaryChoice: expect.anything(),
    });
  });
```

- [ ] **Step 2: Run preference RED check**

Run: `npx vitest run tests/unit/side-panel/browserControlPreferences.test.ts --testNamePattern "工具偏好|实时授权态"`

Expected before implementation: PASS if `updateChatPreferences` already persists only `chatPreferences`. FAIL if live browser-control fields leak into persisted settings.

- [ ] **Step 3: Add send-time filtering test**

In `tests/unit/background/index.test.ts`, add this test inside `describe("background 入口", () => { ... })` near the existing `chat.send` tool tests:

```ts
  it("chat.send 会过滤偏好里当前运行态不可用的高风险工具", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "已过滤工具" } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      {
        type: "chat.send",
        model: createTestModel(),
        messages: [],
        stream: false,
        enabledToolIds: ["system.current_time", "boundary.request_user_choice", "replay.send_request", "full_access.fetch"],
        toolChoice: "auto",
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true, content: "已过滤工具" }));
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { tools?: Array<{ function: { name: string } }> };
    expect(body.tools).toEqual([
      expect.objectContaining({ function: expect.objectContaining({ name: "get_current_time" }) }),
    ]);
  });
```

- [ ] **Step 4: Run send-time RED check**

Run: `npx vitest run tests/unit/background/index.test.ts --testNamePattern "过滤偏好里当前运行态不可用"`

Expected before implementation: FAIL if background sends `boundary_request_user_choice`, `replay_send_request`, or `full_access_fetch` without matching runtime authorization. PASS is acceptable only if current `chat.send` filtering already uses `shouldExposeTool` after resolving `enabledToolIds`.

- [ ] **Step 5: Implement minimal preference/runtime separation fixes**

If Step 2 fails, update `src/side-panel/state/appStore.ts` so persisted `chatPreferences` stores `enabledToolIds` and `defaultBrowserAutomationMode`, while `browserControlEnabled`, `browserAutomationMode`, and `pendingBoundaryChoice` remain top-level runtime state and are not written into `chatPreferences`.

If Step 4 fails, update `src/background/index.ts` so chat tool resolution follows this order:

```ts
const registeredTools = getRegisteredModelTools(message.mcp);
const selectedTools = resolveEnabledModelTools(registeredTools, message.enabledToolIds ?? []);
const exposedTools = selectedTools.filter(shouldExposeToolWithNetworkCompatibility(tabId));
```

The resulting `exposedTools` must be the only tool list passed to model request creation and tool execution allow-list.

- [ ] **Step 6: Keep settings UI wording aligned**

In `src/side-panel/components/settings/ChatPreferenceSettings.tsx`, keep the existing explanatory text equivalent to:

```tsx
<p className="ui-muted text-xs">这里设置新对话默认启用的工具；实际发送时仍会根据当前会话选择、浏览器控制状态和自动化模式过滤。</p>
```

If the text is missing, add it below the tool-calling switch so users do not confuse persisted defaults with live grants.

- [ ] **Step 7: Run GREEN check**

Run: `npx vitest run tests/unit/side-panel/browserControlPreferences.test.ts tests/unit/background/index.test.ts --testNamePattern "工具偏好|实时授权态|过滤偏好里当前运行态不可用"`

Expected after implementation: PASS.

- [ ] **Step 8: Commit this task if committing is enabled**

```powershell
git add src/side-panel/state/appStore.ts src/side-panel/components/settings/ChatPreferenceSettings.tsx src/background/index.ts tests/unit/side-panel/browserControlPreferences.test.ts tests/unit/background/index.test.ts
git commit -m "测试：区分工具偏好和运行态授权"
```

---

### Task 3: Boundary Confirmation And One-Shot Grant Contract

**Files:**
- Create: `tests/unit/background/boundaryChoiceToolExecutor.test.ts`
- Modify: `src/background/browserControl/boundaryChoiceToolExecutor.ts`
- Modify: `src/shared/toolAuthorization.ts`
- Modify: `tests/unit/background/browserControlMessageHandler.test.ts`
- Modify: `src/background/browserControlMessageHandler.ts`

- [ ] **Step 1: Create focused boundary executor tests**

Create `tests/unit/background/boundaryChoiceToolExecutor.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { BoundaryChoiceToolExecutor } from "../../../src/background/browserControl/boundaryChoiceToolExecutor";
import { createBoundaryGrantScopeKey } from "../../../src/shared/toolAuthorization";
import type { BrowserControlBoundaryChoiceRequestMessage } from "../../../src/shared/browserControl";

function createBoundaryCall(argumentsValue: Record<string, unknown>) {
  return {
    id: "call-boundary",
    name: "boundary_request_user_choice",
    arguments: argumentsValue,
  };
}

function createChoices() {
  return [
    {
      id: "allow_sensitive_once",
      title: "允许本次读取",
      description: "只允许下一次绑定工具读取当前结果中的敏感字段。",
      risk: "high" as const,
      grants: ["include_sensitive_field_in_current_tool_result", "write_sensitive_result_to_chat_once"],
    },
    {
      id: "deny",
      title: "拒绝",
      description: "不允许读取敏感字段。",
      risk: "low" as const,
      grants: [],
    },
  ];
}

describe("边界确认工具执行器", () => {
  it("带授权的确认缺少目标工具绑定时不会生成可消费授权", async () => {
    let executor: BoundaryChoiceToolExecutor;
    const notify = vi.fn((message: BrowserControlBoundaryChoiceRequestMessage) => {
      executor.respond(message.requestId, { selectedChoiceIds: ["allow_sensitive_once"] });
    });
    executor = new BoundaryChoiceToolExecutor(notify, () => ({ tabId: 7, origin: "https://example.com", enhanced: true }));

    const result = await executor.execute(createBoundaryCall({
      question: "是否允许读取当前请求的敏感字段？",
      reason: "用户要求分析登录失败，需要确认是否查看被脱敏字段。",
      choices: createChoices(),
    }));

    expect(result).toMatchObject({
      isError: true,
      content: "边界确认缺少目标工具绑定，无法生成可消费的一次性授权。请带 targetToolName 和 targetToolArguments 重新请求用户确认。",
    });
    expect(executor.getCurrentGrantContext()).toBeUndefined();
  });

  it("一次性授权绑定目标工具参数、tab 和 origin", async () => {
    let executor: BoundaryChoiceToolExecutor;
    const notify = vi.fn((message: BrowserControlBoundaryChoiceRequestMessage) => {
      executor.respond(message.requestId, { selectedChoiceIds: ["allow_sensitive_once"] });
    });
    executor = new BoundaryChoiceToolExecutor(notify, () => ({ tabId: 7, origin: "https://example.com", enhanced: true }));
    const targetToolArguments = { requestIds: ["req-1"], scopeKey: "ignored-by-normalizer" };

    const result = await executor.execute(createBoundaryCall({
      question: "是否允许读取当前请求的敏感字段？",
      reason: "用户要求分析登录失败，需要确认是否查看被脱敏字段。",
      targetToolName: "network_get_request_details",
      targetToolArguments,
      choices: createChoices(),
    }));

    expect(result.isError).toBeUndefined();
    expect(executor.getCurrentGrantContext()).toMatchObject({
      tabId: 7,
      origin: "https://example.com",
      scopeKey: createBoundaryGrantScopeKey({ name: "network_get_request_details", arguments: targetToolArguments }),
      grants: ["include_sensitive_field_in_current_tool_result", "write_sensitive_result_to_chat_once"],
    });
  });

  it("tab 或 origin 改变会立即清理当前授权", async () => {
    let currentContext = { tabId: 7, origin: "https://example.com", enhanced: true };
    let executor: BoundaryChoiceToolExecutor;
    const notify = vi.fn((message: BrowserControlBoundaryChoiceRequestMessage) => {
      executor.respond(message.requestId, { selectedChoiceIds: ["allow_sensitive_once"] });
    });
    executor = new BoundaryChoiceToolExecutor(notify, () => currentContext);

    await executor.execute(createBoundaryCall({
      question: "是否允许读取当前请求的敏感字段？",
      reason: "用户要求分析登录失败，需要确认是否查看被脱敏字段。",
      targetToolName: "network_get_request_details",
      targetToolArguments: { requestIds: ["req-1"] },
      choices: createChoices(),
    }));
    expect(executor.getCurrentGrantContext()).toBeDefined();

    currentContext = { tabId: 8, origin: "https://example.com", enhanced: true };
    expect(executor.getCurrentGrantContext()).toBeUndefined();

    await executor.execute(createBoundaryCall({
      question: "是否允许读取当前请求的敏感字段？",
      reason: "用户要求分析登录失败，需要确认是否查看被脱敏字段。",
      targetToolName: "network_get_request_details",
      targetToolArguments: { requestIds: ["req-1"] },
      choices: createChoices(),
    }));
    currentContext = { tabId: 8, origin: "https://other.example", enhanced: true };
    expect(executor.getCurrentGrantContext()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run boundary executor RED check**

Run: `npx vitest run tests/unit/background/boundaryChoiceToolExecutor.test.ts`

Expected before implementation: FAIL if missing target binding can create a grant, if scope keys include `scopeKey` from target arguments, or if tab/origin changes do not clear grants. PASS is acceptable only if current executor already enforces all three contracts.

- [ ] **Step 3: Add browser manager replay grant consumption regression**

In `tests/unit/background/browserControlMessageHandler.test.ts`, keep the existing test named `已有请求重放授权时 send 只发送一次并立即消费授权`. If it is missing, add the exact test from the current Phase 4 suite with these assertions:

```ts
expect(sendResult.isError).toBeUndefined();
expect(fetchMock).toHaveBeenCalledTimes(1);
const secondSend = await manager.executeReplayTool(createNamedToolCall("replay_send_request", { draftId }));
expect(secondSend.isError).toBe(true);
expect(fetchMock).toHaveBeenCalledTimes(1);
```

- [ ] **Step 4: Implement minimal boundary fixes**

If Step 2 fails, update `src/background/browserControl/boundaryChoiceToolExecutor.ts` so `execute()` keeps this guard after resolving `responseGrants`:

```ts
    const responseGrants = Array.from(new Set(responseSelectedChoices.flatMap((choice) => choice.grants)));
    if (responseGrants.length > 0 && !scopeKey) {
      return createErrorResult(toolCall, "边界确认缺少目标工具绑定，无法生成可消费的一次性授权。请带 targetToolName 和 targetToolArguments 重新请求用户确认。");
    }
```

Keep `createGrantContextFromResponse()` in this form so grants without a scope do not persist:

```ts
    const grants = Array.from(new Set(selectedChoices.flatMap((choice) => choice.grants)));
    if (grants.length === 0 || !pending.scopeKey) {
      return;
    }
```

If scope keys include transient properties, keep `src/shared/toolAuthorization.ts` in this form:

```ts
function normalizeBoundaryScopeArguments(args: Record<string, unknown>): Record<string, unknown> {
  const { scopeKey: _scopeKey, ...rest } = args;
  return rest;
}
```

- [ ] **Step 5: Run GREEN check**

Run: `npx vitest run tests/unit/background/boundaryChoiceToolExecutor.test.ts tests/unit/background/browserControlMessageHandler.test.ts --testNamePattern "边界确认工具执行器|请求重放授权"`

Expected after implementation: PASS.

- [ ] **Step 6: Commit this task if committing is enabled**

```powershell
git add src/background/browserControl/boundaryChoiceToolExecutor.ts src/shared/toolAuthorization.ts src/background/browserControlMessageHandler.ts tests/unit/background/boundaryChoiceToolExecutor.test.ts tests/unit/background/browserControlMessageHandler.test.ts
git commit -m "测试：收紧边界确认一次性授权"
```

---

### Task 4: Tool Attachment Redaction And Audit Normalization

**Files:**
- Modify: `tests/unit/shared/toolArtifacts.test.ts`
- Modify: `src/shared/toolArtifacts.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add generic attachment redaction regression**

In `tests/unit/shared/toolArtifacts.test.ts`, add this test inside `describe("通用工具附件聚合", () => { ... })`:

```ts
  it("通用工具附件归一化会脱敏 token、api_key、cookie 和 bearer 文本", () => {
    const attachment = normalizeToolAttachment({
      id: "generic-sensitive-1",
      kind: "mcp-result",
      title: "MCP 工具结果",
      summary: "Authorization=Bearer abc.def token=secret",
      details: "api_key=xai-secret cookie=sid=secret password=123456 Bearer raw-token",
      createdAt: 10,
      redacted: false,
      truncated: false,
    });

    expect(attachment).toMatchObject({ kind: "mcp-result", redacted: true });
    const prompt = formatToolAttachmentForPrompt(attachment!);
    const exported = formatToolAttachmentForExport(attachment!);
    expect(prompt).not.toContain("xai-secret");
    expect(prompt).not.toContain("sid=secret");
    expect(prompt).not.toContain("raw-token");
    expect(exported).not.toContain("xai-secret");
    expect(exported).not.toContain("sid=secret");
    expect(exported).not.toContain("raw-token");
    expect(exported).toContain("[已脱敏]");
  });
```

- [ ] **Step 2: Add full-access report marker regression**

In the same file, add this test:

```ts
  it("自动化报告会标记完全访问工具参与并脱敏证据", () => {
    const report = createAutomationReportToolAttachment({
      objective: "读取登录态 token=secret",
      conclusion: "已读取 cookie=sid=secret",
      records: [
        createToolRecord({
          id: "call-full-access",
          toolId: "full_access.fetch",
          name: "full_access_fetch",
          displayName: "完全访问 Fetch",
          resultSummary: "Authorization: Bearer secret api_key=xai-secret",
          completedAt: 2,
        }),
      ],
      createdAt: 3,
    });

    expect(report).toMatchObject({
      kind: "automation-report",
      redacted: true,
      fullAccessIncluded: true,
    });
    const exported = formatToolAttachmentForExport(report!);
    expect(exported).not.toContain("xai-secret");
    expect(exported).not.toContain("Bearer secret");
    expect(exported).toContain("[已脱敏]");
  });
```

- [ ] **Step 3: Run attachment RED check**

Run: `npx vitest run tests/unit/shared/toolArtifacts.test.ts --testNamePattern "通用工具附件归一化|完全访问工具参与"`

Expected before implementation: FAIL if generic attachments preserve sensitive values or if automation reports fail to mark `fullAccessIncluded`. PASS is acceptable only if current normalization already satisfies both regressions.

- [ ] **Step 4: Implement minimal generic redaction fix**

If Step 1 fails, update `normalizeGenericToolAttachment()` in `src/shared/toolArtifacts.ts` to redact summary and details regardless of incoming `redacted` flag:

```ts
function normalizeGenericToolAttachment(source: Partial<ChatToolAttachment>, kind: string): ChatGenericToolAttachment | undefined {
  const title = normalizeOptionalString(source.title);
  const summary = normalizeOptionalString(source.summary);
  if (!title || !summary) {
    return undefined;
  }

  const redactedSummary = redactInlineSensitiveText(summary);
  const redactedDetails = "details" in source && typeof source.details === "string"
    ? redactInlineSensitiveText(source.details)
    : undefined;
  const truncatedDetails = redactedDetails ? truncateText(redactedDetails, GENERIC_DETAIL_LIMIT) : undefined;
  return {
    id: normalizeId(source.id, `tool-attachment-${kind}-${normalizeTimestamp(source.createdAt)}`),
    kind,
    title,
    summary: redactedSummary,
    sourceToolCallId: normalizeOptionalString(source.sourceToolCallId),
    createdAt: normalizeTimestamp(source.createdAt),
    redacted: true,
    truncated: source.truncated === true || Boolean(truncatedDetails?.truncated),
    details: truncatedDetails?.text,
  };
}
```

If Step 2 fails, keep `createAutomationReportToolAttachment()` assigning:

```ts
fullAccessIncluded: input.records.some((record) => record.toolId.startsWith("full_access.")),
```

- [ ] **Step 5: Run GREEN check**

Run: `npx vitest run tests/unit/shared/toolArtifacts.test.ts`

Expected after implementation: PASS.

- [ ] **Step 6: Commit this task if committing is enabled**

```powershell
git add src/shared/toolArtifacts.ts src/shared/types.ts tests/unit/shared/toolArtifacts.test.ts
git commit -m "测试：加强工具附件脱敏"
```

---

### Task 5: MCP Tavily Imagefree Secret And Availability Boundaries

**Files:**
- Modify: `tests/unit/background/backgroundToolRuntime.test.ts`
- Modify: `tests/unit/background/agentToolsMessageHandler.test.ts`
- Modify: `src/background/backgroundToolRuntime.ts`
- Modify: `src/background/agentToolsMessageHandler.ts`
- Modify: `src/shared/mcp/settings.ts`
- Modify: `src/side-panel/components/settings/McpToolSettings.tsx`

- [ ] **Step 1: Add Tavily argument and attachment regression**

In `tests/unit/background/backgroundToolRuntime.test.ts`, add `TAVILY_SEARCH_TOOL_ID` and `TAVILY_SEARCH_TOOL_NAME` to the existing import from `toolRegistry`, then add this test:

```ts
  it("Tavily 搜索拒绝空问题和额外参数，成功时只产出 web-search 附件", async () => {
    const tavilyTool = getRegisteredModelTools().find((tool) => tool.id === TAVILY_SEARCH_TOOL_ID)!;
    const executor = createBackgroundToolExecutor({ model: createModel() }, vi.fn() as unknown as typeof fetch);

    await expect(executor(createToolCall(TAVILY_SEARCH_TOOL_NAME, { query: "" }), tavilyTool)).resolves.toMatchObject({
      isError: true,
      content: "Tavily 搜索问题不能为空",
    });
    await expect(executor(createToolCall(TAVILY_SEARCH_TOOL_NAME, { query: "Chrome", include_domains: ["example.com"] }), tavilyTool)).resolves.toMatchObject({
      isError: true,
      content: "Tavily 搜索工具只接受 query 参数",
    });

    executeTavilySearchFromSettingsMock.mockResolvedValueOnce({
      ok: true,
      attachment: {
        provider: "tavily",
        query: "Chrome 扩展",
        answer: "Chrome 扩展文档摘要",
        results: [{ title: "Chrome Extensions", url: "https://developer.chrome.com/docs/extensions", content: "Extensions docs." }],
        truncated: false,
        createdAt: 10,
      },
    });

    const success = await executor(createToolCall(TAVILY_SEARCH_TOOL_NAME, { query: "Chrome 扩展" }), tavilyTool);
    expect(success.isError).toBeUndefined();
    expect(success.toolAttachments).toEqual([
      expect.objectContaining({
        kind: "web-search",
        provider: "tavily",
        query: "Chrome 扩展",
        redacted: false,
      }),
    ]);
  });
```

- [ ] **Step 2: Add Imagefree unavailable regression if missing**

In `tests/unit/background/backgroundToolRuntime.test.ts`, keep the existing Imagefree test that expects missing runtime hook to return `Imagefree 图片生成运行时暂不可用，已拒绝执行。`. If it is missing, add:

```ts
  it("Imagefree 缺少运行时 hook 时返回明确不可用错误", async () => {
    const imagefreeTool = getRegisteredModelTools().find((tool) => tool.id === IMAGEFREE_GENERATE_IMAGE_TOOL_ID)!;
    const executor = createBackgroundToolExecutor({ model: createModel() }, vi.fn() as unknown as typeof fetch);

    await expect(executor(createToolCall(IMAGEFREE_GENERATE_IMAGE_TOOL_NAME, { prompt: "猫" }), imagefreeTool)).resolves.toMatchObject({
      isError: true,
      content: "Imagefree 图片生成运行时暂不可用，已拒绝执行。",
    });
  });
```

- [ ] **Step 3: Add MCP audit redaction regression**

In `tests/unit/background/agentToolsMessageHandler.test.ts`, add this test inside `describe("AgentTools 兼容消息处理", () => { ... })`:

```ts
  it("AgentTools 审计日志不会写入 MCP Bearer Token 或 Grok API Key 原文", async () => {
    const fetcher = vi.fn().mockResolvedValue(createJsonResponse({ ok: true }));

    await handleAgentToolsMessage({
      type: "agentTools.configureMcp",
      mcp: {
        servers: [{ id: "mysql", name: "MySQL", endpointUrl: "https://trusted.example.com/mcp", enabled: true, bearerToken: "mcp-secret" }],
        baseUrl: "http://127.0.0.1:17333/",
        grokApiKey: "xai-secret",
      },
    }, fetcher as unknown as typeof fetch);

    const audit = localStorage.data.get(AGENT_TOOLS_AUDIT_KEY);
    expect(JSON.stringify(audit)).not.toContain("mcp-secret");
    expect(JSON.stringify(audit)).not.toContain("xai-secret");
    expect(JSON.stringify(audit)).toContain("[已脱敏]");
  });
```

- [ ] **Step 4: Run MCP/Tavily/Imagefree RED check**

Run: `npx vitest run tests/unit/background/backgroundToolRuntime.test.ts tests/unit/background/agentToolsMessageHandler.test.ts --testNamePattern "Tavily|Imagefree|审计日志"`

Expected before implementation: FAIL if Tavily accepts non-query args, Imagefree has ambiguous unavailable behavior, or audit records store raw secrets. PASS is acceptable only if current code already covers all three.

- [ ] **Step 5: Implement minimal fixes**

If Tavily fails, keep `normalizeTavilyToolQuery()` in `src/background/backgroundToolRuntime.ts` in this form:

```ts
function normalizeTavilyToolQuery(args: Record<string, unknown>): { ok: true; query: string } | { ok: false; message: string } {
  const extraKeys = Object.keys(args).filter((key) => key !== "query");
  if (extraKeys.length > 0) {
    return { ok: false, message: "Tavily 搜索工具只接受 query 参数" };
  }

  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) {
    return { ok: false, message: "Tavily 搜索问题不能为空" };
  }

  return { ok: true, query };
}
```

If Imagefree fails, keep `executeImagefreeGenerateTool()` returning:

```ts
    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: "Imagefree 图片生成运行时暂不可用，已拒绝执行。",
      isError: true,
    };
```

If audit redaction fails, update `src/background/agentToolsMessageHandler.ts` so every persisted audit entry is passed through the existing sensitive redaction helpers before `chrome.storage.local.set`. Redact both object fields and string payloads containing `token`, `authorization`, `api_key`, `cookie`, `secret`, `password`, and `bearer`.

- [ ] **Step 6: Keep UI local-secret boundary visible**

In `src/side-panel/components/settings/McpToolSettings.tsx`, keep bearer token input state local to the component and store updates through existing MCP actions. Do not render saved token values except as the existing editable secret field value loaded from local extension storage. Keep all token fields out of sync backup and out of `mcpSettings.servers` objects.

- [ ] **Step 7: Run GREEN check**

Run: `npx vitest run tests/unit/background/backgroundToolRuntime.test.ts tests/unit/background/agentToolsMessageHandler.test.ts --testNamePattern "Tavily|Imagefree|审计日志|Bearer Token|Grok API Key"`

Expected after implementation: PASS.

- [ ] **Step 8: Commit this task if committing is enabled**

```powershell
git add src/background/backgroundToolRuntime.ts src/background/agentToolsMessageHandler.ts src/shared/mcp/settings.ts src/side-panel/components/settings/McpToolSettings.tsx tests/unit/background/backgroundToolRuntime.test.ts tests/unit/background/agentToolsMessageHandler.test.ts
git commit -m "测试：加固 MCP 和外部工具边界"
```

---

### Task 6: DevTools Network Compatibility Boundary

**Files:**
- Modify: `tests/unit/background/index.test.ts`
- Modify: `src/background/index.ts`
- Modify: `src/background/networkDevtoolsBridge.ts`
- Modify: `src/background/backgroundToolRuntime.ts`

- [ ] **Step 1: Add explicit legacy allow-list test for AgentTools state**

In `tests/unit/background/index.test.ts`, keep the existing test named `AgentTools 状态在仅连接 DevTools Network bridge 时只暴露 allowlist 旧 Network 工具`. If it is missing, add the same assertions:

```ts
expect(builtInToolIds).toEqual(expect.arrayContaining(DEVTOOLS_LEGACY_NETWORK_CASES.map((tool) => tool.id)));
expect(toolIds).toEqual(expect.arrayContaining(DEVTOOLS_LEGACY_NETWORK_CASES.map((tool) => tool.id)));
expect(builtInToolIds).not.toContain("network.wait_for_requests");
expect(builtInToolIds.some((id) => id.startsWith("js.") || id.startsWith("runtime.") || id.startsWith("full_access."))).toBe(false);
```

- [ ] **Step 2: Add explicit chat allow-list test for `network.extract_js_candidates`**

In `tests/unit/background/index.test.ts`, add this test near the existing DevTools Network chat tests:

```ts
  it("chat.send 在 DevTools 兼容层只暴露 extract_js_candidates 而不暴露 debugger-backed 工具", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "只读 Network 工具" } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await import("../../../src/background/index");
    connectDevtoolsNetworkBridge(mock);
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      {
        type: "chat.send",
        model: createTestModel(),
        messages: [],
        stream: false,
        enabledToolIds: ["network.extract_js_candidates", "network.wait_for_requests", "js.search_sources", "runtime.inspect_globals", "full_access.fetch"],
        toolChoice: "auto",
      },
      { tab: { id: 7 } as chrome.tabs.Tab },
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true, content: "只读 Network 工具" }));
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { tools?: Array<{ function: { name: string } }> };
    expect(body.tools).toEqual([
      expect.objectContaining({ function: expect.objectContaining({ name: "network_extract_js_candidates" }) }),
    ]);
  });
```

- [ ] **Step 3: Run Network compatibility RED check**

Run: `npx vitest run tests/unit/background/index.test.ts --testNamePattern "DevTools 兼容层|allowlist 旧 Network|extract_js_candidates"`

Expected before implementation: FAIL if DevTools compatibility exposes `network.wait_for_requests`, `js.*`, `runtime.*`, or `full_access.*`, or if it does not expose the legacy read-only `network.extract_js_candidates` when the recorder is enabled for the sender tab.

- [ ] **Step 4: Implement minimal compatibility gate**

If Step 3 fails, keep `src/background/index.ts` using a fixed allow-list:

```ts
const DEVTOOLS_LEGACY_NETWORK_TOOL_IDS = new Set([
  "network.list_requests",
  "network.get_request_details",
  "network.clear_requests",
  "network.compare_requests",
  "network.find_parameter_candidates",
  "network.extract_js_candidates",
]);
```

Keep compatibility exposure bound to the selected tab recorder:

```ts
function shouldExposeToolWithNetworkCompatibility(tabId?: number): (tool: ModelToolRegistryEntry) => boolean {
  const networkCompatibilityRecorder = tabId === undefined ? undefined : networkDevtoolsBridge.createRecorderAdapter(tabId);
  return (tool) => {
    if (shouldExposeTool(tool)) {
      return true;
    }
    return DEVTOOLS_LEGACY_NETWORK_TOOL_IDS.has(tool.id) && networkCompatibilityRecorder?.isEnabled() === true;
  };
}
```

Keep compatibility execution refusing tools outside the allow-list:

```ts
if (!networkCompatibilityRecorder.isEnabled() || !DEVTOOLS_LEGACY_NETWORK_TOOL_IDS.has(tool.id)) {
  return undefined;
}
```

- [ ] **Step 5: Run GREEN check**

Run: `npx vitest run tests/unit/background/index.test.ts tests/unit/background/networkDevtoolsBridge.test.ts --testNamePattern "DevTools Network|DevTools 兼容层|allowlist|extract_js_candidates|其他标签页|extension page"`

Expected after implementation: PASS.

- [ ] **Step 6: Commit this task if committing is enabled**

```powershell
git add src/background/index.ts src/background/networkDevtoolsBridge.ts src/background/backgroundToolRuntime.ts tests/unit/background/index.test.ts
git commit -m "测试：限定 DevTools Network 兼容边界"
```

---

### Task 7: Full Verification And Migration Ledger

**Files:**
- Modify: `docs/superpowers/MIGRATION_STATUS.md`

- [ ] **Step 1: Run focused Phase 5 verification**

Run:

```powershell
npx vitest run tests/unit/shared/toolRegistry.test.ts tests/unit/background/backgroundToolRuntime.test.ts tests/unit/background/boundaryChoiceToolExecutor.test.ts tests/unit/background/browserControlMessageHandler.test.ts tests/unit/shared/toolArtifacts.test.ts tests/unit/side-panel/browserControlPreferences.test.ts tests/unit/background/agentToolsMessageHandler.test.ts tests/unit/background/index.test.ts tests/unit/background/networkDevtoolsBridge.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Run full project check**

Run: `npm run check`

Expected: PASS. Existing Vite chunk/vendor/inlineDynamicImports warnings are acceptable only if no test, build, or package step fails.

- [ ] **Step 4: Run E2E smoke**

Run: `npm run test:e2e`

Expected: PASS.

- [ ] **Step 5: Update migration ledger after all verification passes**

In `docs/superpowers/MIGRATION_STATUS.md`, update:

```md
## 当前阶段

Phase 5：工具与安全边界已完成。工具注册、浏览器控制、Network、MCP、Tavily、Imagefree、工具附件和审计均通过运行态边界、脱敏和兼容层回归验证。

## 持久入口

- 总设计：`docs/superpowers/specs/2026-07-05-full-upstream-engineering-migration-design.md`
- 当前计划：`docs/superpowers/plans/2026-07-07-full-upstream-engineering-migration-phase-5.md`
```

Append a new `## 当前工作区 Phase 5 结果` section or replace the Phase 4 result section only after Phase 4 has already been committed. Include these bullets:

```md
- 工具注册表继续作为内置、浏览器控制、受控增强、完全访问、外部搜索和 MCP 远程工具的单一元数据来源。
- `chat.send`、AgentTools 状态和 DevTools Network 兼容层在发送前按当前 tab、browser-control 连接态、自动化模式和 legacy allow-list 过滤工具。
- `boundary_request_user_choice` 生成的一次性授权绑定目标工具参数、tab 和 origin；请求重放授权发送后立即消费。
- 工具附件聚合、导出和后续追问上下文默认脱敏；完全访问结果用显式字段标记。
- MCP Bearer Token 和 Grok API Key 保持本地存储边界，审计日志写入前脱敏。
- Tavily、Imagefree 和 DevTools legacy Network 工具保留低风险或兼容路径，高风险 debugger-backed 工具不由 DevTools 兼容层静默启用。
```

Append verification rows for the exact commands run in Steps 1 to 4, with `通过` status and the current date.

- [ ] **Step 6: Run ledger sanity check**

Run: `rg -n "Phase 5|2026-07-07-full-upstream-engineering-migration-phase-5|工具与安全边界|当前验证状态" docs\superpowers\MIGRATION_STATUS.md`

Expected: output includes the Phase 5 current phase, the Phase 5 plan path, and verification table entries.

- [ ] **Step 7: Check worktree**

Run: `git status --short`

Expected: only Phase 5 files are modified, plus any unrelated pre-existing untracked files that were present before execution.

- [ ] **Step 8: Commit this task if committing is enabled**

```powershell
git add docs/superpowers/MIGRATION_STATUS.md
git commit -m "文档：更新第五阶段迁移台账"
```

---

## Self-Review Checklist

- Spec coverage: Phase 5 scope maps to Task 1 registry, Task 2 persisted preferences/runtime gates, Task 3 browser-control boundary grants, Task 4 attachments/audit normalization, Task 5 MCP/Tavily/Imagefree, Task 6 Network compatibility, and Task 7 ledger/verification.
- Placeholder scan: this plan contains concrete file paths, commands, expected results, and code snippets for every code-changing task.
- Type consistency: tests use existing exported names: `getRegisteredModelTools`, `isToolRuntimeAvailable`, `shouldExposeTool`, `createBackgroundToolExecutor`, `BoundaryChoiceToolExecutor`, `createBoundaryGrantScopeKey`, `normalizeToolAttachment`, `formatToolAttachmentForPrompt`, `formatToolAttachmentForExport`, and existing test helpers `createChromeMock`, `createTestModel`, `connectDevtoolsNetworkBridge`, `createToolRecord`.
- Execution boundary: `docs/superpowers/MIGRATION_STATUS.md` is intentionally left unchanged by this planning step; Task 7 updates it only after implementation and verification.
