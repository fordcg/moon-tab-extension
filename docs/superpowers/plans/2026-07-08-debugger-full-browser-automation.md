# Debugger Full Browser Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable `chrome.debugger` as a formal release capability, match upstream `browser-ai-assistant` debugger-backed automation, and add Moon Tab specific diagnostics, tool health, MCP/AgentTools integration, and release gates.

**Architecture:** Flip the release boundary from "no debugger" to "debugger-first, DevTools fallback". Keep `BrowserControlManager` as the CDP owner, add a shared tool availability model for UI/background/AgentTools, make debugger recorder the primary `network.*` path, and keep DevTools Network as a marked compatibility fallback. High-risk tools remain gated by automation mode, one-time grants, and background execution checks.

**Tech Stack:** Chrome MV3, `chrome.debugger` / CDP, React 19, TypeScript, Vite, Zustand, Vitest, Playwright, PowerShell.

---

## Scope Notes

This is one cohesive plan because every subsystem depends on the same release-boundary flip and the same browser-control runtime state. Execute the tasks in order. Each task should be committed separately with a Chinese commit message.

Do not use bash heredoc. Current shell is PowerShell. Use `apply_patch` for manual edits.

## File Structure

- `public/manifest.json`: declares the final MV3 permissions, including `debugger`.
- `scripts/verify-release-readiness.mjs`: validates packaged release artifacts and the debugger release boundary.
- `tests/unit/background/manifestBrowserControl.test.ts`: manifest permission contract.
- `tests/unit/background/releaseReadinessContract.test.ts`: docs and release matrix contract.
- `tests/unit/background/extensionBuildContract.test.ts`: entrypoint and build contract.
- `src/shared/models/toolAvailability.ts`: new shared pure helper for tool runtime availability and disabled reasons.
- `tests/unit/shared/toolAvailability.test.ts`: new unit tests for the helper.
- `src/shared/browserControl.ts`: shared message types for diagnostics.
- `src/background/browserControlMessageHandler.ts`: exposes `getDiagnostics()` from `BrowserControlManager`.
- `src/background/index.ts`: routes diagnostics, debugger-first Network execution, and DevTools fallback.
- `src/background/agentToolsMessageHandler.ts`: returns built-in tool health metadata and audits status refreshes without sensitive values.
- `src/side-panel/state/appStore.ts`: stores diagnostics state and refresh action.
- `src/side-panel/components/settings/AutomationDiagnostics.tsx`: new UI panel for debugger and tool health.
- `src/side-panel/components/settings/McpToolSettings.tsx`: surfaces built-in tool health and MCP boundary text.
- `src/side-panel/components/SettingsPanel.tsx`: mounts the diagnostics panel.
- `tests/unit/side-panel/App.test.tsx`: UI tests for diagnostics and risk state.
- `tests/unit/background/backgroundToolRuntime.test.ts`: debugger-first Network execution and fallback tests.
- `tests/unit/background/networkDevtoolsBridge.test.ts`: fallback source contract.
- `tests/e2e/extension-runtime.spec.ts`: true extension smoke for debugger UI.
- `README.md`, `CLAUDE.md`, `docs/superpowers/release-readiness.md`: user and release documentation.

---

### Task 1: Flip Manifest And Release Boundary To Debugger

**Files:**
- Modify: `public/manifest.json`
- Modify: `scripts/verify-release-readiness.mjs`
- Modify: `tests/unit/background/manifestBrowserControl.test.ts`
- Modify: `tests/unit/background/releaseReadinessContract.test.ts`
- Modify: `tests/unit/background/extensionBuildContract.test.ts`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/release-readiness.md`

- [ ] **Step 1: Write failing manifest permission tests**

Replace the test in `tests/unit/background/manifestBrowserControl.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import manifest from "../../../public/manifest.json";

describe("浏览器控制 Manifest 权限", () => {
  it("正式发布声明 debugger 权限，浏览器控制仍由用户显式开启", () => {
    expect(manifest.permissions).toEqual(expect.arrayContaining([
      "sidePanel",
      "storage",
      "contextMenus",
      "activeTab",
      "scripting",
      "alarms",
      "tabs",
      "debugger",
    ]));
    expect(manifest.permissions).not.toContain("tabGroups");
    expect(manifest.optional_permissions ?? []).not.toContain("debugger");
  });
});
```

In `tests/unit/background/releaseReadinessContract.test.ts`, replace the manifest test with:

```ts
it("当前发布 manifest 声明 debugger 权限并声明构建输出入口", () => {
  expect(manifest.permissions).toContain("debugger");
  expect(manifest.background.service_worker).toBe("background/index.js");
  expect(manifest.side_panel.default_path).toBe("index.html");
  expect(manifest.devtools_page).toBe("src/devtools/network.html");
  expect(manifest.chrome_url_overrides.newtab).toBe("src/pages/newtab/index.html");
});
```

Also update the required areas list in `releaseReadinessContract.test.ts` to replace `"DevTools Network 兼容工具"` and `"权限边界"` with:

```ts
"Debugger 浏览器自动化",
"Debugger Network 主路径",
"DevTools Network fallback",
"高风险权限边界",
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npx vitest run tests/unit/background/manifestBrowserControl.test.ts tests/unit/background/releaseReadinessContract.test.ts
```

Expected: FAIL. The failure should mention that `manifest.permissions` does not contain `"debugger"` and release readiness docs do not contain the new matrix rows.

- [ ] **Step 3: Enable debugger in manifest**

Edit `public/manifest.json` so `permissions` becomes:

```json
["sidePanel", "storage", "contextMenus", "activeTab", "scripting", "alarms", "tabs", "debugger"]
```

Do not add `optional_permissions`.

- [ ] **Step 4: Update release readiness script**

In `scripts/verify-release-readiness.mjs`, replace the debugger rejection in `collectManifestIssues` with a debugger requirement:

```js
  if (!permissions.includes("debugger")) {
    issues.push(`${label} must request debugger permission for the full browser automation release boundary.`);
  }
  if (optionalPermissions.includes("debugger")) {
    issues.push(`${label} must not put debugger in optional_permissions; this release uses an explicit debugger permission boundary.`);
  }
```

Keep the existing checks for `background/index.js`, side panel, DevTools page, newtab, and content script.

- [ ] **Step 5: Update docs for the new boundary**

In `README.md`, replace every statement that says the current release does not declare `debugger` with text that says:

```markdown
当前发布声明 `debugger` 权限，但浏览器控制默认关闭；只有用户在侧边栏显式开启浏览器控制后，background 才会 attach 当前普通网页。DevTools Network 兼容层继续保留为只读 fallback，主要 Network 能力走 debugger-backed recorder。
```

In `docs/superpowers/release-readiness.md`, update the feature matrix rows to include:

```markdown
| Debugger 浏览器自动化 | `tests/unit/background/browserControlMessageHandler.test.ts`、`tests/unit/background/backgroundToolRuntime.test.ts`、真实扩展侧栏 smoke | manifest 声明 `debugger`，浏览器控制默认关闭，用户显式开启后普通网页可 attach，关闭或外部 detach 后状态清理 |
| Debugger Network 主路径 | `tests/unit/background/networkRecorder.test.ts`、`tests/unit/background/networkToolExecutor.test.ts`、`tests/unit/background/backgroundToolRuntime.test.ts` | `network.*` 优先走 debugger-backed recorder，支持列表、详情、清空、等待、对比、参数候选和 JS 候选 |
| DevTools Network fallback | `tests/unit/background/networkDevtoolsBridge.test.ts`、`tests/unit/background/index.test.ts` | DevTools bridge 仅在 debugger recorder 不可用且 DevTools Network 已连接时作为脱敏只读 fallback |
| 高风险权限边界 | `tests/unit/background/boundaryChoiceToolExecutor.test.ts`、`tests/unit/background/replayToolExecutor.test.ts`、`tests/unit/background/fullAccessToolExecutor.test.ts` | `replay.*` 只在受控增强模式暴露，`full_access.*` 只在完全访问模式暴露，一次性授权绑定 tab、origin、目标工具和参数 |
```

In `CLAUDE.md`, update the release notes so they no longer say the current release has no `debugger` permission. Add this sentence:

```markdown
Full browser automation releases declare `debugger`; browser control still defaults off and must only attach after an explicit user action.
```

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```powershell
npx vitest run tests/unit/background/manifestBrowserControl.test.ts tests/unit/background/releaseReadinessContract.test.ts tests/unit/background/extensionBuildContract.test.ts
```

Expected: PASS for all tests in the three files.

- [ ] **Step 7: Commit**

Run:

```powershell
git add public/manifest.json scripts/verify-release-readiness.mjs tests/unit/background/manifestBrowserControl.test.ts tests/unit/background/releaseReadinessContract.test.ts tests/unit/background/extensionBuildContract.test.ts README.md CLAUDE.md docs/superpowers/release-readiness.md
git commit -m "配置：启用 debugger 发布边界"
```

---

### Task 2: Add Shared Tool Availability Model

**Files:**
- Create: `src/shared/models/toolAvailability.ts`
- Create: `tests/unit/shared/toolAvailability.test.ts`
- Modify: `src/shared/models/types.ts`
- Modify: `src/shared/models/toolRegistry.ts`

- [ ] **Step 1: Write failing tests for shared availability**

Create `tests/unit/shared/toolAvailability.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID,
  FULL_ACCESS_FETCH_TOOL_ID,
  NETWORK_LIST_REQUESTS_TOOL_ID,
  TAVILY_SEARCH_TOOL_ID,
  getRegisteredModelTools,
} from "../../../src/shared/models/toolRegistry";
import { resolveModelToolAvailability } from "../../../src/shared/models/toolAvailability";

function toolById(id: string) {
  const tool = getRegisteredModelTools().find((item) => item.id === id);
  if (!tool) {
    throw new Error(`missing test tool ${id}`);
  }
  return tool;
}

describe("模型工具运行态可用性", () => {
  it("本地和外部搜索工具不依赖 debugger", () => {
    expect(resolveModelToolAvailability(toolById(TAVILY_SEARCH_TOOL_ID), {
      debuggerPermissionDeclared: true,
      browserControlEnabled: false,
      browserControlAttached: false,
      browserAutomationMode: "normal_restricted",
      networkSource: "unavailable",
    })).toMatchObject({ available: true, reasonCode: "available" });
  });

  it("browser_control 工具需要 manifest 权限和已连接浏览器控制", () => {
    expect(resolveModelToolAvailability(toolById(NETWORK_LIST_REQUESTS_TOOL_ID), {
      debuggerPermissionDeclared: false,
      browserControlEnabled: true,
      browserControlAttached: true,
      browserAutomationMode: "normal_restricted",
      networkSource: "debugger_recorder",
    })).toMatchObject({ available: false, reasonCode: "debugger_permission_missing" });

    expect(resolveModelToolAvailability(toolById(NETWORK_LIST_REQUESTS_TOOL_ID), {
      debuggerPermissionDeclared: true,
      browserControlEnabled: false,
      browserControlAttached: false,
      browserAutomationMode: "normal_restricted",
      networkSource: "unavailable",
    })).toMatchObject({ available: false, reasonCode: "browser_control_disabled" });

    expect(resolveModelToolAvailability(toolById(NETWORK_LIST_REQUESTS_TOOL_ID), {
      debuggerPermissionDeclared: true,
      browserControlEnabled: true,
      browserControlAttached: true,
      browserAutomationMode: "normal_restricted",
      networkSource: "debugger_recorder",
    })).toMatchObject({ available: true, reasonCode: "available" });
  });

  it("受控增强和完全访问工具受自动化模式限制", () => {
    expect(resolveModelToolAvailability(toolById(BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID), {
      debuggerPermissionDeclared: true,
      browserControlEnabled: true,
      browserControlAttached: true,
      browserAutomationMode: "normal_restricted",
      networkSource: "debugger_recorder",
    })).toMatchObject({ available: false, reasonCode: "controlled_enhanced_required" });

    expect(resolveModelToolAvailability(toolById(FULL_ACCESS_FETCH_TOOL_ID), {
      debuggerPermissionDeclared: true,
      browserControlEnabled: true,
      browserControlAttached: true,
      browserAutomationMode: "controlled_enhanced",
      networkSource: "debugger_recorder",
    })).toMatchObject({ available: false, reasonCode: "full_access_required" });
  });
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
npx vitest run tests/unit/shared/toolAvailability.test.ts
```

Expected: FAIL with a module-not-found error for `src/shared/models/toolAvailability`.

- [ ] **Step 3: Add availability types**

In `src/shared/models/types.ts`, add these exports near the existing tool type exports:

```ts
export type ModelToolAvailabilityReasonCode =
  | "available"
  | "debugger_permission_missing"
  | "browser_control_disabled"
  | "browser_control_not_attached"
  | "controlled_enhanced_required"
  | "full_access_required"
  | "network_unavailable";

export type BrowserAutomationNetworkSource = "debugger_recorder" | "devtools_fallback" | "unavailable";

export interface ModelToolAvailabilityRuntime {
  debuggerPermissionDeclared: boolean;
  browserControlEnabled: boolean;
  browserControlAttached: boolean;
  browserAutomationMode: import("../toolAuthorization").BrowserAutomationMode;
  networkSource: BrowserAutomationNetworkSource;
}

export interface ModelToolAvailabilityStatus {
  available: boolean;
  reasonCode: ModelToolAvailabilityReasonCode;
  reason: string;
  requiresDebugger: boolean;
  requiresAutomationMode?: import("../toolAuthorization").BrowserAutomationMode;
  networkSource: BrowserAutomationNetworkSource;
  checkedAt: number;
}
```

- [ ] **Step 4: Implement pure availability helper**

Create `src/shared/models/toolAvailability.ts`:

```ts
import type {
  ModelToolAvailabilityRuntime,
  ModelToolAvailabilityStatus,
  ModelToolRegistryEntry,
} from "./types";
import { isDebuggerRuntimeRequirement } from "./toolRegistry";

const REASON_TEXT: Record<ModelToolAvailabilityStatus["reasonCode"], string> = {
  available: "工具当前可用。",
  debugger_permission_missing: "扩展未声明 debugger 权限。",
  browser_control_disabled: "浏览器控制未开启。",
  browser_control_not_attached: "浏览器控制尚未连接当前标签页。",
  controlled_enhanced_required: "需要切换到受控增强模式。",
  full_access_required: "需要切换到完全访问模式。",
  network_unavailable: "Network recorder 或 DevTools fallback 当前不可用。",
};

export function resolveModelToolAvailability(
  tool: ModelToolRegistryEntry,
  runtime: ModelToolAvailabilityRuntime,
  checkedAt = Date.now(),
): ModelToolAvailabilityStatus {
  const requirement = tool.toolClassification?.runtime;
  const requiresDebugger = requirement ? isDebuggerRuntimeRequirement(requirement) : false;

  if (!requiresDebugger) {
    return createStatus("available", runtime, requiresDebugger, undefined, checkedAt);
  }

  if (!runtime.debuggerPermissionDeclared) {
    return createStatus("debugger_permission_missing", runtime, requiresDebugger, undefined, checkedAt);
  }

  if (!runtime.browserControlEnabled) {
    return createStatus("browser_control_disabled", runtime, requiresDebugger, undefined, checkedAt);
  }

  if (!runtime.browserControlAttached) {
    return createStatus("browser_control_not_attached", runtime, requiresDebugger, undefined, checkedAt);
  }

  if (requirement === "controlled_enhanced" && runtime.browserAutomationMode !== "controlled_enhanced") {
    return createStatus("controlled_enhanced_required", runtime, requiresDebugger, "controlled_enhanced", checkedAt);
  }

  if (requirement === "full_access" && runtime.browserAutomationMode !== "full_access") {
    return createStatus("full_access_required", runtime, requiresDebugger, "full_access", checkedAt);
  }

  if (tool.id.startsWith("network.") && runtime.networkSource === "unavailable") {
    return createStatus("network_unavailable", runtime, requiresDebugger, undefined, checkedAt);
  }

  return createStatus("available", runtime, requiresDebugger, undefined, checkedAt);
}

function createStatus(
  reasonCode: ModelToolAvailabilityStatus["reasonCode"],
  runtime: ModelToolAvailabilityRuntime,
  requiresDebugger: boolean,
  requiresAutomationMode: ModelToolAvailabilityStatus["requiresAutomationMode"],
  checkedAt: number,
): ModelToolAvailabilityStatus {
  return {
    available: reasonCode === "available",
    reasonCode,
    reason: REASON_TEXT[reasonCode],
    requiresDebugger,
    requiresAutomationMode,
    networkSource: runtime.networkSource,
    checkedAt,
  };
}
```

- [ ] **Step 5: Export helper from registry index path**

No barrel file exists. Import `resolveModelToolAvailability` directly from `src/shared/models/toolAvailability.ts` wherever needed. Do not re-export it from `toolRegistry.ts`.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
npx vitest run tests/unit/shared/toolAvailability.test.ts tests/unit/shared/toolRegistry.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
git add src/shared/models/types.ts src/shared/models/toolAvailability.ts tests/unit/shared/toolAvailability.test.ts
git commit -m "功能：增加工具运行态可用性模型"
```

---

### Task 3: Expose Browser Automation Diagnostics From Background

**Files:**
- Modify: `src/shared/browserControl.ts`
- Modify: `src/background/browserControlMessageHandler.ts`
- Modify: `src/background/index.ts`
- Modify: `tests/unit/background/browserControlMessageHandler.test.ts`
- Modify: `tests/unit/background/index.test.ts`

- [ ] **Step 1: Add failing diagnostics tests**

In `tests/unit/background/browserControlMessageHandler.test.ts`, add:

```ts
it("返回浏览器自动化诊断状态", async () => {
  const chromeMock = createChromeMock();
  const connection = new BrowserDebuggerConnection(chromeMock);
  const manager = new BrowserControlManager(connection, chromeMock);

  expect(manager.getDiagnostics()).toMatchObject({
    debuggerPermissionDeclared: true,
    browserControlEnabled: false,
    browserControlAttached: false,
    browserAutomationMode: "normal_restricted",
    networkSource: "unavailable",
    availableToolCount: expect.any(Number),
    disabledToolCount: expect.any(Number),
  });

  await manager.setEnabled(true, 7);

  expect(manager.getDiagnostics()).toMatchObject({
    debuggerPermissionDeclared: true,
    browserControlEnabled: true,
    browserControlAttached: true,
    tabId: 7,
    networkSource: "debugger_recorder",
  });
});
```

In `tests/unit/background/index.test.ts`, add a routing test that sends:

```ts
{ type: "browserControl.getDiagnostics" }
```

and expects:

```ts
expect(response).toMatchObject({
  ok: true,
  diagnostics: expect.objectContaining({
    debuggerPermissionDeclared: true,
    networkSource: expect.any(String),
  }),
});
```

- [ ] **Step 2: Run diagnostics tests and verify RED**

Run:

```powershell
npx vitest run tests/unit/background/browserControlMessageHandler.test.ts tests/unit/background/index.test.ts --testNamePattern "诊断|Diagnostics|getDiagnostics"
```

Expected: FAIL because `getDiagnostics` and `browserControl.getDiagnostics` do not exist.

- [ ] **Step 3: Add shared message types**

In `src/shared/browserControl.ts`, add:

```ts
export const BROWSER_CONTROL_GET_DIAGNOSTICS_MESSAGE_TYPE = "browserControl.getDiagnostics" as const;

export interface BrowserControlDiagnostics {
  debuggerPermissionDeclared: boolean;
  browserControlEnabled: boolean;
  browserControlAttached: boolean;
  browserAutomationMode: BrowserAutomationMode;
  networkSource: import("./models/types").BrowserAutomationNetworkSource;
  tabId?: number;
  tabUrl?: string;
  lastDetachReason?: BrowserControlDetachedReason;
  availableToolCount: number;
  disabledToolCount: number;
  checkedAt: number;
}

export interface BrowserControlGetDiagnosticsMessage {
  type: typeof BROWSER_CONTROL_GET_DIAGNOSTICS_MESSAGE_TYPE;
}
```

Add `BrowserControlGetDiagnosticsMessage` to the exported `BrowserControlMessage` union.

- [ ] **Step 4: Implement manager diagnostics**

In `src/background/browserControlMessageHandler.ts`, import `getRegisteredModelTools` and `resolveModelToolAvailability`. Add a method to `BrowserControlManager`:

```ts
getDiagnostics(): BrowserControlDiagnostics {
  const runtime = {
    debuggerPermissionDeclared: hasDebuggerPermission(this.chromeApi),
    browserControlEnabled: this.enabled,
    browserControlAttached: this.connection.attached,
    browserAutomationMode: this.browserAutomationMode,
    networkSource: this.networkRecorder.isEnabled() ? "debugger_recorder" as const : "unavailable" as const,
  };
  const toolStatuses = getRegisteredModelTools().map((tool) => resolveModelToolAvailability(tool, runtime));
  return {
    ...runtime,
    tabId: this.connection.attachedTabId,
    tabUrl: this.currentTabInfo?.url,
    lastDetachReason: this.lastDetachReason,
    availableToolCount: toolStatuses.filter((status) => status.available).length,
    disabledToolCount: toolStatuses.filter((status) => !status.available).length,
    checkedAt: Date.now(),
  };
}
```

Add this helper in the same file:

```ts
function hasDebuggerPermission(chromeApi: ChromeApi | undefined): boolean {
  return typeof chromeApi?.debugger?.attach === "function" &&
    typeof chromeApi?.debugger?.sendCommand === "function" &&
    typeof chromeApi?.debugger?.detach === "function";
}
```

Use the existing field names in `BrowserControlManager`; if a field has a different local name, keep the return shape above and map to the actual field.

- [ ] **Step 5: Route diagnostics message**

In `handleBrowserControlMessage`, add a branch before state-changing messages:

```ts
if (message.type === BROWSER_CONTROL_GET_DIAGNOSTICS_MESSAGE_TYPE) {
  return {
    ok: true,
    diagnostics: browserControlManager.getDiagnostics(),
  };
}
```

In `src/background/index.ts`, include `message.type === "browserControl.getDiagnostics"` in the browser control routing condition.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
npx vitest run tests/unit/background/browserControlMessageHandler.test.ts tests/unit/background/index.test.ts --testNamePattern "诊断|Diagnostics|getDiagnostics"
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
git add src/shared/browserControl.ts src/background/browserControlMessageHandler.ts src/background/index.ts tests/unit/background/browserControlMessageHandler.test.ts tests/unit/background/index.test.ts
git commit -m "功能：暴露浏览器自动化诊断状态"
```

---

### Task 4: Make Network Execution Debugger-First With DevTools Fallback

**Files:**
- Modify: `src/background/index.ts`
- Modify: `src/background/backgroundToolRuntime.ts`
- Modify: `tests/unit/background/backgroundToolRuntime.test.ts`
- Modify: `tests/unit/background/index.test.ts`
- Modify: `tests/unit/background/networkDevtoolsBridge.test.ts`

- [ ] **Step 1: Add failing debugger-first tests**

In `tests/unit/background/backgroundToolRuntime.test.ts`, add a test that creates:

```ts
const compatibilityExecutor = vi.fn().mockResolvedValue({
  toolCallId: "call-1",
  name: "network_list_requests",
  content: "fallback",
});
```

Set up `browserControlManager.canExposeNetworkTool()` to return `true`, then execute `network.list_requests`. Assert:

```ts
expect(compatibilityExecutor).not.toHaveBeenCalled();
```

Add a second test where `browserControlManager.canExposeNetworkTool()` returns `false` and assert:

```ts
expect(compatibilityExecutor).toHaveBeenCalledOnce();
expect(result.content).toBe("fallback");
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npx vitest run tests/unit/background/backgroundToolRuntime.test.ts --testNamePattern "Network|fallback|debugger"
```

Expected: FAIL because `createBackgroundToolExecutor` calls `networkCompatibilityExecutor` before debugger execution.

- [ ] **Step 3: Change executor contract**

In `src/background/backgroundToolRuntime.ts`, rename the option type to express fallback:

```ts
type NetworkFallbackExecutor = (toolCall: ModelToolCall, tool: ModelToolRegistryEntry) => ModelToolResult | undefined | Promise<ModelToolResult | undefined>;

export interface BackgroundToolExecutorOptions {
  networkFallbackExecutor?: NetworkFallbackExecutor;
}
```

Change the `network.*` execution block to:

```ts
if (tool.id.startsWith("network.")) {
  if (browserControlManager.canExposeNetworkTool()) {
    return browserControlManager.executeNetworkTool(toolCall);
  }
  const fallbackResult = await options.networkFallbackExecutor?.(toolCall, tool);
  if (fallbackResult !== undefined) {
    return fallbackResult;
  }
  return browserControlManager.executeNetworkTool(toolCall);
}
```

- [ ] **Step 4: Update background wiring names**

In `src/background/index.ts`, rename `createNetworkCompatibilityExecutor` to `createNetworkFallbackExecutor`, and update both call sites:

```ts
createBackgroundToolExecutor(message, fetch, { networkFallbackExecutor: createNetworkFallbackExecutor(tabId) })
```

and

```ts
createBackgroundToolExecutor(chatMessage, fetch, { networkFallbackExecutor: createNetworkFallbackExecutor(tabId) })
```

Inside the fallback creator, keep the existing `DEVTOOLS_LEGACY_NETWORK_TOOL_IDS` allow-list and return `undefined` unless DevTools is connected.

- [ ] **Step 5: Add source labeling for fallback results**

When the DevTools fallback executor returns a tool result, wrap its text content with a first line:

```ts
content: `Network source: devtools_fallback\n${result.content}`
```

Do not alter structured `toolAttachments` except to add `source: "devtools_fallback"` when the attachment kind is `network`.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
npx vitest run tests/unit/background/backgroundToolRuntime.test.ts tests/unit/background/index.test.ts tests/unit/background/networkDevtoolsBridge.test.ts --testNamePattern "Network|fallback|DevTools|debugger"
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
git add src/background/index.ts src/background/backgroundToolRuntime.ts tests/unit/background/backgroundToolRuntime.test.ts tests/unit/background/index.test.ts tests/unit/background/networkDevtoolsBridge.test.ts
git commit -m "功能：Network 工具优先使用 debugger recorder"
```

---

### Task 5: Add AgentTools Built-In Tool Health

**Files:**
- Modify: `src/background/agentToolsMessageHandler.ts`
- Modify: `src/background/index.ts`
- Modify: `tests/unit/background/agentToolsMessageHandler.test.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add failing AgentTools health test**

In `tests/unit/background/agentToolsMessageHandler.test.ts`, add:

```ts
it("AgentTools 状态返回内置工具健康信息但不授予 MCP 调用本地浏览器工具的能力", async () => {
  const response = await handleAgentToolsMessage({
    type: "agentTools.getStatus",
  }, fetch, [
    {
      id: "network.list_requests",
      name: "network_list_requests",
      displayName: "Network 请求列表",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
      toolClassification: { runtime: "browser_control", capabilities: ["observe_page"], risk: "low" },
    },
  ]);

  expect(response).toMatchObject({
    ok: true,
    builtInTools: [
      expect.objectContaining({
        id: "network.list_requests",
        availability: expect.objectContaining({
          available: expect.any(Boolean),
          reasonCode: expect.any(String),
          requiresDebugger: true,
        }),
      }),
    ],
  });
  expect(JSON.stringify(response)).not.toContain("full_access.fetch");
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
npx vitest run tests/unit/background/agentToolsMessageHandler.test.ts --testNamePattern "健康|availability|AgentTools 状态"
```

Expected: FAIL because `builtInTools` entries do not contain `availability`.

- [ ] **Step 3: Add availability to status response**

In `src/background/index.ts`, call `browserControlManager.getDiagnostics()` and pass diagnostics into `handleAgentToolsMessage`:

```ts
const diagnostics = browserControlManager.getDiagnostics();
void handleAgentToolsMessage(message, fetch, builtInTools, diagnostics).then(sendResponse);
```

In `src/background/agentToolsMessageHandler.ts`, update the function signature:

```ts
export async function handleAgentToolsMessage(
  message: AgentToolsRuntimeMessage,
  fetcher: Fetcher = fetch,
  builtInTools: ModelToolRegistryEntry[] = [],
  diagnostics?: BrowserControlDiagnostics,
): Promise<Record<string, unknown>> {
```

Update `createStatusResponse` to map built-in tools:

```ts
const builtInToolHealth = builtInTools.map((tool) => ({
  ...tool,
  availability: diagnostics
    ? resolveModelToolAvailability(tool, {
        debuggerPermissionDeclared: diagnostics.debuggerPermissionDeclared,
        browserControlEnabled: diagnostics.browserControlEnabled,
        browserControlAttached: diagnostics.browserControlAttached,
        browserAutomationMode: diagnostics.browserAutomationMode,
        networkSource: diagnostics.networkSource,
      })
    : undefined,
}));
```

Return `builtInTools: builtInToolHealth`.

- [ ] **Step 4: Ensure MCP cannot call local browser tools**

Keep `callRegisteredMcpTool` using `parseMcpToolId(toolId)`. Add this assertion to the same test file:

```ts
const callResponse = await handleAgentToolsMessage({
  type: "agentTools.call",
  toolId: "network.list_requests",
  input: {},
});
expect(callResponse).toMatchObject({ ok: false, message: "MCP 工具标识无效。" });
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npx vitest run tests/unit/background/agentToolsMessageHandler.test.ts tests/unit/background/index.test.ts --testNamePattern "AgentTools|MCP|availability|健康"
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/background/agentToolsMessageHandler.ts src/background/index.ts tests/unit/background/agentToolsMessageHandler.test.ts src/shared/types.ts
git commit -m "功能：AgentTools 返回内置工具健康状态"
```

---

### Task 6: Add Side Panel Automation Diagnostics UI

**Files:**
- Create: `src/side-panel/components/settings/AutomationDiagnostics.tsx`
- Modify: `src/side-panel/components/SettingsPanel.tsx`
- Modify: `src/side-panel/components/settings/McpToolSettings.tsx`
- Modify: `src/side-panel/state/appStore.ts`
- Modify: `tests/unit/side-panel/App.test.tsx`
- Modify: `tests/unit/side-panel/browserControlPreferences.test.ts`

- [ ] **Step 1: Write failing UI tests**

In `tests/unit/side-panel/App.test.tsx`, add:

```ts
it("设置页展示浏览器自动化诊断和 Network 来源", async () => {
  const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
    if (message.type === "browserControl.getDiagnostics") {
      callback({
        ok: true,
        diagnostics: {
          debuggerPermissionDeclared: true,
          browserControlEnabled: true,
          browserControlAttached: true,
          browserAutomationMode: "normal_restricted",
          networkSource: "debugger_recorder",
          availableToolCount: 12,
          disabledToolCount: 4,
          checkedAt: 1,
        },
      });
      return undefined;
    }
    callback({ ok: true });
    return undefined;
  });
  vi.stubGlobal("chrome", { runtime: { sendMessage } });

  render(<App />);
  await userEvent.click(screen.getByRole("button", { name: "设置" }));

  expect(await screen.findByText("浏览器自动化诊断")).toBeInTheDocument();
  expect(screen.getByText("debugger_recorder")).toBeInTheDocument();
  expect(screen.getByText("12 可用 / 4 不可用")).toBeInTheDocument();
});
```

In `tests/unit/side-panel/browserControlPreferences.test.ts`, add a store test:

```ts
it("刷新浏览器自动化诊断状态", async () => {
  const sendMessage = vi.fn((message: { type: string }, callback: (response: unknown) => void) => {
    callback({
      ok: true,
      diagnostics: {
        debuggerPermissionDeclared: true,
        browserControlEnabled: false,
        browserControlAttached: false,
        browserAutomationMode: "normal_restricted",
        networkSource: "unavailable",
        availableToolCount: 2,
        disabledToolCount: 30,
        checkedAt: 1,
      },
    });
    return undefined;
  });
  vi.stubGlobal("chrome", { runtime: { sendMessage } });

  await useAppStore.getState().refreshBrowserAutomationDiagnostics();

  expect(sendMessage).toHaveBeenCalledWith({ type: "browserControl.getDiagnostics" }, expect.any(Function));
  expect(useAppStore.getState().browserAutomationDiagnostics).toMatchObject({
    debuggerPermissionDeclared: true,
    networkSource: "unavailable",
  });
});
```

- [ ] **Step 2: Run UI tests and verify RED**

Run:

```powershell
npx vitest run tests/unit/side-panel/App.test.tsx tests/unit/side-panel/browserControlPreferences.test.ts --testNamePattern "诊断|Network 来源|browserAutomationDiagnostics"
```

Expected: FAIL because the store action and UI component do not exist.

- [ ] **Step 3: Add store state and action**

In `src/side-panel/state/appStore.ts`, add state:

```ts
browserAutomationDiagnostics?: BrowserControlDiagnostics;
```

Add action:

```ts
refreshBrowserAutomationDiagnostics: async () => {
  const response = await sendRuntimeMessage<{
    ok: boolean;
    diagnostics?: BrowserControlDiagnostics;
    message?: string;
  }>({ type: "browserControl.getDiagnostics" });
  if (response.ok && response.diagnostics) {
    set({ browserAutomationDiagnostics: response.diagnostics });
  }
},
```

Use the existing runtime message helper pattern in `appStore.ts`.

- [ ] **Step 4: Create diagnostics component**

Create `src/side-panel/components/settings/AutomationDiagnostics.tsx`:

```tsx
import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { useAppStore } from "../../state/appStore";

export function AutomationDiagnostics() {
  const diagnostics = useAppStore((state) => state.browserAutomationDiagnostics);
  const refresh = useAppStore((state) => state.refreshBrowserAutomationDiagnostics);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="settings-section" aria-labelledby="automation-diagnostics-title">
      <div className="settings-section__header">
        <h3 id="automation-diagnostics-title">浏览器自动化诊断</h3>
        <button type="button" className="icon-button" onClick={() => void refresh()} aria-label="刷新浏览器自动化诊断">
          <RefreshCw aria-hidden="true" size={16} />
        </button>
      </div>
      <dl className="settings-kv">
        <div>
          <dt>Debugger 权限</dt>
          <dd>{diagnostics?.debuggerPermissionDeclared ? "已声明" : "未声明"}</dd>
        </div>
        <div>
          <dt>连接状态</dt>
          <dd>{diagnostics?.browserControlAttached ? "已连接" : "未连接"}</dd>
        </div>
        <div>
          <dt>Network 来源</dt>
          <dd>{diagnostics?.networkSource ?? "unavailable"}</dd>
        </div>
        <div>
          <dt>工具状态</dt>
          <dd>{`${diagnostics?.availableToolCount ?? 0} 可用 / ${diagnostics?.disabledToolCount ?? 0} 不可用`}</dd>
        </div>
      </dl>
    </section>
  );
}
```

- [ ] **Step 5: Mount component**

In `src/side-panel/components/SettingsPanel.tsx`, import and render `<AutomationDiagnostics />` near the browser/tool settings area:

```tsx
import { AutomationDiagnostics } from "./settings/AutomationDiagnostics";
```

Render:

```tsx
<AutomationDiagnostics />
```

- [ ] **Step 6: Surface built-in tool health in MCP settings**

In `src/side-panel/components/settings/McpToolSettings.tsx`, when displaying built-in tools from `agentTools.getStatus`, show `availability.reason` for unavailable built-in tools:

```tsx
{tool.availability && !tool.availability.available ? (
  <span className="tool-muted-reason">{tool.availability.reason}</span>
) : null}
```

- [ ] **Step 7: Run focused UI tests**

Run:

```powershell
npx vitest run tests/unit/side-panel/App.test.tsx tests/unit/side-panel/browserControlPreferences.test.ts --testNamePattern "诊断|Network 来源|browserAutomationDiagnostics"
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```powershell
git add src/side-panel/components/settings/AutomationDiagnostics.tsx src/side-panel/components/SettingsPanel.tsx src/side-panel/components/settings/McpToolSettings.tsx src/side-panel/state/appStore.ts tests/unit/side-panel/App.test.tsx tests/unit/side-panel/browserControlPreferences.test.ts
git commit -m "功能：增加浏览器自动化诊断面板"
```

---

### Task 7: Harden Runtime, Replay, And Full Access Mode Gates

**Files:**
- Modify: `tests/unit/background/runtimeReadToolExecutor.test.ts`
- Modify: `tests/unit/background/replayToolExecutor.test.ts`
- Modify: `tests/unit/background/fullAccessToolExecutor.test.ts`
- Modify: `tests/unit/background/boundaryChoiceToolExecutor.test.ts`
- Modify: `tests/unit/background/backgroundToolRuntime.test.ts`
- Modify: `src/background/browserControl/runtimeReadToolExecutor.ts`
- Modify: `src/background/browserControl/replayToolExecutor.ts`
- Modify: `src/background/browserControl/fullAccessToolExecutor.ts`
- Modify: `src/background/browserControl/boundaryChoiceToolExecutor.ts`

- [ ] **Step 1: Add regression tests for mode gates**

Add these focused assertions to the existing executor tests:

```ts
expect(await manager.executeRuntimeReadTool(createNamedToolCall("runtime_inspect_globals", {
  expression: "window.localStorage",
}))).toMatchObject({
  isError: true,
  content: expect.stringContaining("不能传入任意 JavaScript"),
});
```

```ts
expect(await manager.executeReplayTool(createNamedToolCall("replay_send_request", {
  draftId: "draft-1",
}))).toMatchObject({
  isError: true,
  content: expect.stringContaining("受控增强模式"),
});
```

```ts
expect(await manager.executeFullAccessTool(createNamedToolCall("full_access_fetch", {
  url: "/api/me",
}))).toMatchObject({
  isError: true,
  content: expect.stringContaining("完全访问模式"),
});
```

Add a grant-consumption assertion in `boundaryChoiceToolExecutor.test.ts`:

```ts
expect(firstSendResult).toMatchObject({ isError: false });
expect(secondSendResult).toMatchObject({
  isError: true,
  content: expect.stringContaining("一次性授权"),
});
```

- [ ] **Step 2: Run focused tests and verify RED or existing GREEN**

Run:

```powershell
npx vitest run tests/unit/background/runtimeReadToolExecutor.test.ts tests/unit/background/replayToolExecutor.test.ts tests/unit/background/fullAccessToolExecutor.test.ts tests/unit/background/boundaryChoiceToolExecutor.test.ts tests/unit/background/backgroundToolRuntime.test.ts --testNamePattern "任意 JavaScript|受控增强模式|完全访问模式|一次性授权|mode"
```

Expected: Any missing guard should FAIL. If all assertions already PASS, continue to Step 5 and commit the regression tests only.

- [ ] **Step 3: Patch Runtime read executor**

In `src/background/browserControl/runtimeReadToolExecutor.ts`, ensure argument normalization rejects keys outside the schema. The rejection message must include:

```ts
"Runtime 只读工具不能传入任意 JavaScript 表达式。"
```

Allowed keys are:

- `paths`, `maxDepth`, `limit` for `runtime_inspect_globals`
- `keywords`, `limit`, `radius` for `runtime_search_modules`
- `path`, `radius`, `keywords` for `runtime_describe_function`

- [ ] **Step 4: Patch Replay and Full Access guards**

In `src/background/browserControl/replayToolExecutor.ts`, before sending a replay request, require the current automation mode to be `controlled_enhanced` and require a matching grant. The fixed Chinese error for missing mode is:

```ts
"请求重放只允许在受控增强模式下执行。"
```

In `src/background/browserControl/fullAccessToolExecutor.ts`, before every `full_access.*` action, require full access context. The fixed Chinese error is:

```ts
"完全访问工具只允许在完全访问模式下执行。"
```

In `boundaryChoiceToolExecutor.ts`, consume matching grant after the first target tool execution, whether the tool succeeds or fails.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npx vitest run tests/unit/background/runtimeReadToolExecutor.test.ts tests/unit/background/replayToolExecutor.test.ts tests/unit/background/fullAccessToolExecutor.test.ts tests/unit/background/boundaryChoiceToolExecutor.test.ts tests/unit/background/backgroundToolRuntime.test.ts --testNamePattern "任意 JavaScript|受控增强模式|完全访问模式|一次性授权|mode"
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add tests/unit/background/runtimeReadToolExecutor.test.ts tests/unit/background/replayToolExecutor.test.ts tests/unit/background/fullAccessToolExecutor.test.ts tests/unit/background/boundaryChoiceToolExecutor.test.ts tests/unit/background/backgroundToolRuntime.test.ts src/background/browserControl/runtimeReadToolExecutor.ts src/background/browserControl/replayToolExecutor.ts src/background/browserControl/fullAccessToolExecutor.ts src/background/browserControl/boundaryChoiceToolExecutor.ts
git commit -m "测试：加固高风险自动化模式边界"
```

---

### Task 8: Extend E2E Smoke And Final Release Gate

**Files:**
- Modify: `tests/e2e/extension-runtime.spec.ts`
- Modify: `scripts/verify-release-readiness.test.ts`
- Modify: `scripts/verify-release-readiness.mjs`
- Modify: `docs/superpowers/release-readiness.md`
- Modify: `README.md`

- [ ] **Step 1: Add failing E2E expectations**

In `tests/e2e/extension-runtime.spec.ts`, extend the real extension smoke to assert:

```ts
const manifestText = await page.evaluate(async () => {
  const response = await fetch(chrome.runtime.getURL("manifest.json"));
  return response.text();
});
expect(manifestText).toContain('"debugger"');
```

Then open the side panel and assert:

```ts
await expect(page.getByText("浏览器自动化诊断")).toBeVisible();
await expect(page.getByText(/Debugger 权限|debugger_recorder|unavailable/)).toBeVisible();
```

- [ ] **Step 2: Add release verifier tests**

In `scripts/verify-release-readiness.test.ts`, add a fixture manifest without `debugger` and assert `collectReleaseReadinessIssues` includes:

```ts
"must request debugger permission for the full browser automation release boundary"
```

Add a fixture manifest with `optional_permissions: ["debugger"]` and assert the issue includes:

```ts
"must not put debugger in optional_permissions"
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
npx vitest run scripts/verify-release-readiness.test.ts
```

Expected: FAIL until `scripts/verify-release-readiness.mjs` fully enforces the new boundary in test fixtures.

- [ ] **Step 4: Patch release verifier**

If Task 1 already changed `collectManifestIssues`, add the optional permission assertion and keep this exact message:

```js
if (optionalPermissions.includes("debugger")) {
  issues.push(`${label} must not put debugger in optional_permissions; this release uses an explicit debugger permission boundary.`);
}
```

Ensure the tests create both `dist/manifest.json` and `artifacts/chrome-extension/manifest.json` fixtures with matching debugger assertions.

- [ ] **Step 5: Run full release checks**

Run:

```powershell
npm run typecheck
npm run build:extension
npm test
npm run test:legacy
npm run check:package
npm run test:e2e
npm run verify:release
```

Expected:

- `npm run typecheck`: exit code 0.
- `npm run build:extension`: exit code 0 and `dist/manifest.json` contains `"debugger"`.
- `npm test`: exit code 0.
- `npm run test:legacy`: exit code 0.
- `npm run check:package`: exit code 0 and `artifacts/chrome-extension/manifest.json` contains `"debugger"`.
- `npm run test:e2e`: exit code 0.
- `npm run verify:release`: exit code 0.

- [ ] **Step 6: Update final docs with verified command results**

In `docs/superpowers/release-readiness.md`, add a verification status row:

```markdown
| `npm run verify:release` | 通过 | Full debugger browser automation release gate；check、E2E 和发布产物 debugger 权限校验全部通过 |
```

In `README.md`, add a short "Debugger 浏览器自动化" section:

```markdown
## Debugger 浏览器自动化

当前发布声明 `debugger` 权限。浏览器控制默认关闭，只有用户在 AI 侧边栏显式开启后才会 attach 当前普通网页。普通模式默认脱敏和截断；受控增强模式用于一次性边界确认和请求重放；完全访问模式需要用户显式切换，并可随时撤销。

Network 工具优先使用 debugger-backed recorder。DevTools Network 页面保留为只读 fallback，只有在目标标签页 DevTools Network 已连接且 debugger recorder 不可用时使用。
```

- [ ] **Step 7: Commit**

Run:

```powershell
git add tests/e2e/extension-runtime.spec.ts scripts/verify-release-readiness.test.ts scripts/verify-release-readiness.mjs docs/superpowers/release-readiness.md README.md
git commit -m "测试：完善 debugger 发布验收门禁"
```

---

## Final Verification Checklist

Run these commands after all tasks:

```powershell
npm run verify:release
git status --short
```

Expected:

- `npm run verify:release` exits with code 0.
- `git status --short` shows only intentional untracked local files, or a clean tree if local scratch files were removed.
- `dist/manifest.json` contains `"debugger"`.
- `artifacts/chrome-extension/manifest.json` contains `"debugger"`.

## Spec Coverage Self-Review

- Manifest `debugger` release boundary: Task 1 and Task 8.
- Browser control default-off and explicit attach: Task 3, Task 6, Task 8.
- Debugger-first Network and DevTools fallback: Task 4 and Task 6.
- JS, Source Map, Runtime, Replay, Full Access mode boundaries: Task 7.
- Shared availability, tool health, MCP/AgentTools boundary: Task 2 and Task 5.
- Diagnostics panel and Network source visibility: Task 3 and Task 6.
- Release gate and documentation: Task 1 and Task 8.

No independent subsystem remains without a task.
