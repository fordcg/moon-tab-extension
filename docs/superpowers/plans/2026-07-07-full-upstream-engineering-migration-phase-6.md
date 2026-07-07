# Phase 6 Legacy Artifact Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the old Browser AI Assistant bundle, DOM patch, root no-build extension artifacts, and generated AI assets after moving the still-active DevTools Network and Imagefree runtime paths into source-owned TypeScript entries.

**Architecture:** Keep the active extension on the Vite build path: `public/manifest.json`, `vite.config.ts`, `src/background/index.ts`, `src/content/index.ts`, `src/side-panel/**`, `src/devtools/**`, and `src/background/imagefreeToolRuntime.ts`. The DevTools Network compatibility layer remains a redacted read-only bridge, but its page and implementation move from `src/ai-assistant/devtools.html/js` to `src/devtools/network.html/ts`. Imagefree remains a low-risk local model tool, but its runtime hook moves from a generated asset to a checked TypeScript module imported by the background entry.

**Tech Stack:** Chrome MV3, Vite multi-entry build, TypeScript, React, Vitest, Playwright, PowerShell, Node.js legacy smoke scripts.

---

## Context

- 总设计：`docs/superpowers/specs/2026-07-05-full-upstream-engineering-migration-design.md`
- 当前迁移台账：`docs/superpowers/MIGRATION_STATUS.md`
- Phase 5 计划：`docs/superpowers/plans/2026-07-07-full-upstream-engineering-migration-phase-5.md`
- 历史同名阶段计划：`docs/superpowers/plans/2026-07-05-ai-sidebar-upstream-migration-phase-6.md` 是旧 no-build Network 清理计划，不作为本阶段执行依据。

Phase 5 已完成工具与安全边界。Phase 6 的重点不是删除所有 `src/ai-assistant` 路径，而是先迁走仍在运行链路上的 DevTools Network 和 Imagefree runtime，然后删除旧 AI sidebar bundle、DOM patch、root direct-load manifest/content/service-worker 和相关脚本断言。

## Execution Preconditions

- 使用 PowerShell 执行命令。
- 多行输入使用 `apply_patch` 或 PowerShell here-string，禁止 bash heredoc。
- 手写文件修改使用 `apply_patch`。
- 不要 stage、修改或删除未跟踪的 `.claude/`。
- 每个任务完成后提交一次；提交信息使用中文。
- 不要并行派发多个实现子代理；每个任务都先实现，再 spec review，再 code quality review。

## File Map

- Create: `src/devtools/network.html` as the source-owned DevTools page.
- Create: `src/devtools/network.ts` as the source-owned DevTools Network collector.
- Create: `src/background/imagefreeToolRuntime.ts` as the source-owned Imagefree runtime hook.
- Modify: `public/manifest.json` to point `devtools_page` at `src/devtools/network.html`.
- Modify: `vite.config.ts` to build the DevTools entry from `src/devtools/network.html`.
- Modify: `src/background/index.ts` to import `./imagefreeToolRuntime` and trust `src/devtools/network.html`.
- Modify: `src/background/networkDevtoolsBridge.ts` to trust `src/devtools/network.html`.
- Modify: `tests/unit/background/extensionBuildContract.test.ts` for new build/source ownership contracts and old artifact absence.
- Modify: `tests/unit/background/networkDevtoolsBridge.test.ts` and `tests/unit/background/index.test.ts` for the new DevTools URL trust boundary.
- Modify: `tests/unit/background/backgroundToolRuntime.test.ts` only if Imagefree runtime behavior needs a source-owned regression.
- Modify: `scripts/test_background_agent_tools_wiring.mjs`, `scripts/test_background_browser_queue_wiring.mjs`, `scripts/run_unit_tests.mjs`, and `scripts/verify_ai_sidebar_quality.ps1` to check current TypeScript/Vite sources instead of deleted old bundle files.
- Modify: `scripts/verify_ai_sidebar_core.py`, `scripts/verify_browser_control_attach.py`, `scripts/verify_browser_control_tool_loop.py`, and `scripts/verify_mcp_bridge_tool_loop.py` so extension pages open `index.html` instead of `src/ai-assistant/index.html`.
- Delete: root `manifest.json`, root `content/index.js`, `src/background/service-worker.js` after the build contract proves the active path is `public/manifest.json` plus Vite output.
- Delete: old `src/ai-assistant/index.html`, `src/ai-assistant/sidePanel.js`, `src/ai-assistant/sidePanel-layout.js`, `src/ai-assistant/sidePanel-layout.css`, `src/ai-assistant/agent-tools-dialog.js`, `src/ai-assistant/notification-host.js`, `src/ai-assistant/open-design-preview.html`, `src/ai-assistant/open-design-entry-guard.js`, `src/ai-assistant/preview-chrome-mock.js`, `src/ai-assistant/devtools.html`, `src/ai-assistant/devtools.js`, `src/ai-assistant/assets/*`, and `src/ai-assistant/background/*` once replacements and scripts are green.
- Modify: `README.md`, `docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md`, and `docs/superpowers/MIGRATION_STATUS.md` after implementation and verification.

---

### Task 1: Build Contract For Source-Owned Runtime Entries

**Files:**
- Modify: `tests/unit/background/extensionBuildContract.test.ts`

- [ ] **Step 1: Update the build contract to expect the new source-owned DevTools page**

In `tests/unit/background/extensionBuildContract.test.ts`, update the first test so these assertions replace the old `src/ai-assistant/devtools.html` expectations:

```ts
    expect(manifest.devtools_page).toBe("src/devtools/network.html");
    expect(viteConfig).toContain('devtools: resolve(rootDir, "src/devtools/network.html")');
```

- [ ] **Step 2: Update the Imagefree runtime contract**

Replace the old Imagefree import assertion with this source-owned assertion:

```ts
  it("TypeScript 后台入口应加载 source-owned Imagefree 后台运行时 hook", async () => {
    const backgroundEntry = await readProjectFile("src/background/index.ts");
    const imagefreeRuntime = await readProjectFile("src/background/imagefreeToolRuntime.ts");

    expect(backgroundEntry).toContain('import "./imagefreeToolRuntime";');
    expect(imagefreeRuntime).toContain("globalThis.__imagefreeGenerateTool = executeImagefreeGenerateTool");
    expect(imagefreeRuntime).toContain("IMAGEFREE_GENERATE_IMAGE_TOOL_NAME");
  });
```

- [ ] **Step 3: Add absence contract for deleted legacy artifacts**

Add `access` to the `node:fs/promises` import and add this helper below `readProjectFile()`:

```ts
async function projectFileExists(path: string): Promise<boolean> {
  try {
    await access(resolve(projectRoot, path));
    return true;
  } catch {
    return false;
  }
}
```

Add this test inside `describe("扩展构建产物合约", () => { ... })`:

```ts
  it("旧 AI sidebar bundle、DOM patch 和 root no-build 入口不再作为源码存在", async () => {
    await expect(projectFileExists("manifest.json")).resolves.toBe(false);
    await expect(projectFileExists("content/index.js")).resolves.toBe(false);
    await expect(projectFileExists("src/background/service-worker.js")).resolves.toBe(false);
    await expect(projectFileExists("src/ai-assistant/index.html")).resolves.toBe(false);
    await expect(projectFileExists("src/ai-assistant/sidePanel.js")).resolves.toBe(false);
    await expect(projectFileExists("src/ai-assistant/sidePanel-layout.js")).resolves.toBe(false);
    await expect(projectFileExists("src/ai-assistant/sidePanel-layout.css")).resolves.toBe(false);
    await expect(projectFileExists("src/ai-assistant/agent-tools-dialog.js")).resolves.toBe(false);
    await expect(projectFileExists("src/ai-assistant/assets/imagefree-tool-runtime.js")).resolves.toBe(false);
  });
```

- [ ] **Step 4: Run RED check**

Run: `npx vitest run tests/unit/background/extensionBuildContract.test.ts --testNamePattern "DevTools|Imagefree|旧 AI sidebar"`

Expected before implementation: FAIL because `public/manifest.json`, `vite.config.ts`, and `src/background/index.ts` still reference `src/ai-assistant`, and legacy files still exist.

- [ ] **Step 5: Commit this task if committing is enabled**

```powershell
git add tests/unit/background/extensionBuildContract.test.ts
git commit -m "测试：固化第六阶段旧产物清理合约"
```

---

### Task 2: DevTools Network Source Entry Migration

**Files:**
- Create: `src/devtools/network.html`
- Create: `src/devtools/network.ts`
- Modify: `public/manifest.json`
- Modify: `vite.config.ts`
- Modify: `src/background/index.ts`
- Modify: `src/background/networkDevtoolsBridge.ts`
- Modify: `tests/unit/background/networkDevtoolsBridge.test.ts`
- Modify: `tests/unit/background/index.test.ts`
- Modify: `tests/unit/background/extensionBuildContract.test.ts`

- [ ] **Step 1: Update tests to use the new DevTools URL**

In `tests/unit/background/networkDevtoolsBridge.test.ts`, change:

```ts
const DEVTOOLS_PAGE_URL = "chrome-extension://moon-tab/src/ai-assistant/devtools.html";
```

to:

```ts
const DEVTOOLS_PAGE_URL = "chrome-extension://moon-tab/src/devtools/network.html";
```

Also change the other-extension rejection URL in that file to `chrome-extension://other-extension/src/devtools/network.html`.

In `tests/unit/background/index.test.ts`, replace every test sender URL and `mock.chrome.runtime.getURL(...)` expectation for `src/ai-assistant/devtools.html` with `src/devtools/network.html`.

- [ ] **Step 2: Run DevTools URL RED check**

Run: `npx vitest run tests/unit/background/networkDevtoolsBridge.test.ts tests/unit/background/index.test.ts --testNamePattern "DevTools|extension page|其他扩展 host|显式 tabId"`

Expected before implementation: FAIL because background code still trusts `src/ai-assistant/devtools.html`.

- [ ] **Step 3: Create the source-owned DevTools HTML page**

Create `src/devtools/network.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>Browser AI Assistant DevTools Network</title>
    <script type="module" src="./network.ts"></script>
  </head>
  <body></body>
</html>
```

- [ ] **Step 4: Create the TypeScript DevTools collector**

Create `src/devtools/network.ts` by porting `src/ai-assistant/devtools.js` to TypeScript with source imports. The file must include these imports and constants:

```ts
import { redactNetworkRequestDetail, redactNetworkRequestMeta } from "../shared/networkContext";
import type { NetworkRequestDetail, NetworkRequestMeta, NetworkHeader } from "../shared/types";
import { truncateText } from "../shared/utils/text";

const MAX_TEXT_LENGTH = 12000;
const RECONNECT_DELAY_MS = 1000;
const inspectedTabId = chrome.devtools.inspectedWindow.tabId;
```

The collector must preserve these behaviors from the old DevTools page:

```ts
chrome.devtools.network.onRequestFinished.addListener((request) => {
  rememberRequest(request, request);
  postSnapshotUpdated();
});

chrome.devtools.network.onNavigated.addListener(() => {
  requestStore.clear();
  refreshHarSnapshot();
});
```

It must continue to post these message types through a `network.devtools` port:

```ts
type NetworkDevtoolsOutboundMessage =
  | { type: "networkContext.devtoolsConnected"; tabId: number; requests: NetworkRequestMeta[] }
  | { type: "networkContext.snapshotUpdated"; tabId: number; requests: NetworkRequestMeta[] }
  | { type: "networkContext.detailsResponse"; rpcId: string; response: { ok: true; details: NetworkRequestDetail[] } };
```

It must respond to these incoming message types:

```ts
type NetworkDevtoolsInboundMessage =
  | { type: "networkContext.clearRequests"; tabId?: number }
  | { type: "networkContext.getDetails"; rpcId: string; requestIds?: string[] };
```

When building request metadata, construct a `NetworkRequestMeta` and run `redactNetworkRequestMeta(rawMeta)`. When building request details, construct a `NetworkRequestDetail` and run `redactNetworkRequestDetail(rawDetail)`. Keep response body truncation through `truncateText(content ?? "", MAX_TEXT_LENGTH)`.

- [ ] **Step 5: Wire the new DevTools page into build/runtime**

In `public/manifest.json`, set:

```json
"devtools_page": "src/devtools/network.html"
```

In `vite.config.ts`, set the `devtools` input to:

```ts
devtools: resolve(rootDir, "src/devtools/network.html"),
```

In `src/background/index.ts`, update `isTrustedNetworkContextExtensionSender()` to compare against:

```ts
const devtoolsUrl = chrome.runtime?.getURL?.("src/devtools/network.html");
```

In `src/background/networkDevtoolsBridge.ts`, update `isTrustedDevtoolsPortSender()` to compare against the same path:

```ts
const devtoolsUrl = chrome.runtime?.getURL?.("src/devtools/network.html");
```

- [ ] **Step 6: Run DevTools GREEN check**

Run: `npx vitest run tests/unit/background/networkDevtoolsBridge.test.ts tests/unit/background/index.test.ts tests/unit/background/extensionBuildContract.test.ts --testNamePattern "DevTools|extension page|其他扩展 host|显式 tabId|manifest|运行时入口"`

Expected after implementation: PASS.

- [ ] **Step 7: Commit this task if committing is enabled**

```powershell
git add src/devtools/network.html src/devtools/network.ts public/manifest.json vite.config.ts src/background/index.ts src/background/networkDevtoolsBridge.ts tests/unit/background/networkDevtoolsBridge.test.ts tests/unit/background/index.test.ts tests/unit/background/extensionBuildContract.test.ts
git commit -m "迁移：源码化 DevTools Network 入口"
```

---

### Task 3: Imagefree Runtime Source Ownership

**Files:**
- Create: `src/background/imagefreeToolRuntime.ts`
- Modify: `src/background/index.ts`
- Modify: `tests/unit/background/backgroundToolRuntime.test.ts`
- Modify: `tests/unit/background/extensionBuildContract.test.ts`

- [ ] **Step 1: Add a focused source-owned runtime regression**

In `tests/unit/background/backgroundToolRuntime.test.ts`, keep the existing hook dispatch test and add this test inside `describe("background 工具运行时封装", () => { ... })`:

```ts
  it("source-owned Imagefree runtime 注册全局生成 hook", async () => {
    const globalWithHook = globalThis as typeof globalThis & {
      __imagefreeGenerateTool?: (toolCall: ModelToolCall, fetcher: typeof fetch) => Promise<unknown>;
    };
    const previousHook = globalWithHook.__imagefreeGenerateTool;

    try {
      delete globalWithHook.__imagefreeGenerateTool;
      await import("../../../src/background/imagefreeToolRuntime");
      expect(globalWithHook.__imagefreeGenerateTool).toEqual(expect.any(Function));
    } finally {
      globalWithHook.__imagefreeGenerateTool = previousHook;
    }
  });
```

- [ ] **Step 2: Run Imagefree RED check**

Run: `npx vitest run tests/unit/background/backgroundToolRuntime.test.ts tests/unit/background/extensionBuildContract.test.ts --testNamePattern "Imagefree|source-owned"`

Expected before implementation: FAIL because `src/background/imagefreeToolRuntime.ts` does not exist and `src/background/index.ts` still imports the old JS asset.

- [ ] **Step 3: Port Imagefree runtime to TypeScript**

Create `src/background/imagefreeToolRuntime.ts` by porting the readable runtime from `src/ai-assistant/assets/imagefree-tool-runtime.js`. Keep these imports and exported names:

```ts
import {
  IMAGEFREE_GENERATE_IMAGE_TOOL_ID,
  IMAGEFREE_GENERATE_IMAGE_TOOL_NAME,
} from "../shared/models/toolRegistry";
import type { ModelToolCall, ModelToolResult } from "../shared/models/types";

export const IMAGEFREE_TOOL_ID = IMAGEFREE_GENERATE_IMAGE_TOOL_ID;
export const IMAGEFREE_TOOL_NAME = IMAGEFREE_GENERATE_IMAGE_TOOL_NAME;
export const IMAGEFREE_TOOL_SELECTION_MIGRATION_KEY = "imagefreeToolSelectionMigration.v1";
```

The module must assign the global hook at module load:

```ts
declare global {
  var __imagefreeGenerateTool: ((toolCall: ModelToolCall, fetcher?: typeof fetch) => Promise<ModelToolResult>) | undefined;
}

globalThis.__imagefreeGenerateTool = executeImagefreeGenerateTool;
```

The port must preserve current behavior:

- validate non-empty `prompt`.
- allow `aspect_ratio` values `1:1`, `16:9`, `9:16`, `4:3`, and `3:4`.
- support optional `turnstile_token`.
- use `fetcher` when provided and fall back to global `fetch`.
- return `ModelToolResult` with `toolCallId`, `name`, `content`, and `isError` for failures.
- keep the existing Imagefree Turnstile tab flow and stale selection migration behavior from the old runtime.

- [ ] **Step 4: Import the source-owned runtime from background**

In `src/background/index.ts`, replace:

```ts
import "../ai-assistant/assets/imagefree-tool-runtime.js";
```

with:

```ts
import "./imagefreeToolRuntime";
```

- [ ] **Step 5: Run Imagefree GREEN check**

Run: `npx vitest run tests/unit/background/backgroundToolRuntime.test.ts tests/unit/background/extensionBuildContract.test.ts --testNamePattern "Imagefree|source-owned"`

Expected after implementation: PASS.

- [ ] **Step 6: Commit this task if committing is enabled**

```powershell
git add src/background/imagefreeToolRuntime.ts src/background/index.ts tests/unit/background/backgroundToolRuntime.test.ts tests/unit/background/extensionBuildContract.test.ts
git commit -m "迁移：源码化 Imagefree 运行时"
```

---

### Task 4: Legacy Script And Smoke Convergence

**Files:**
- Modify: `scripts/test_background_agent_tools_wiring.mjs`
- Modify: `scripts/test_background_browser_queue_wiring.mjs`
- Modify: `scripts/run_unit_tests.mjs`
- Modify: `scripts/verify_ai_sidebar_quality.ps1`
- Modify: `scripts/verify_ai_sidebar_core.py`
- Modify: `scripts/verify_browser_control_attach.py`
- Modify: `scripts/verify_browser_control_tool_loop.py`
- Modify: `scripts/verify_mcp_bridge_tool_loop.py`

- [ ] **Step 1: Replace old bundle reads in `test_background_agent_tools_wiring.mjs`**

Update the file reads at the top so the script reads current source-owned files only:

```js
const backgroundSource = await readFile(new URL("../src/background/index.ts", import.meta.url), "utf8");
const backgroundRuntimeSource = await readFile(new URL("../src/background/backgroundToolRuntime.ts", import.meta.url), "utf8");
const agentToolsSource = await readFile(new URL("../src/background/agentToolsMessageHandler.ts", import.meta.url), "utf8");
const networkBridgeSource = await readFile(new URL("../src/background/networkDevtoolsBridge.ts", import.meta.url), "utf8");
const devtoolsSource = await readFile(new URL("../src/devtools/network.ts", import.meta.url), "utf8");
const imagefreeRuntimeSource = await readFile(new URL("../src/background/imagefreeToolRuntime.ts", import.meta.url), "utf8");
const sidePanelEntrySource = await readFile(new URL("../src/side-panel/main.tsx", import.meta.url), "utf8");
const sidePanelAppSource = await readFile(new URL("../src/side-panel/App.tsx", import.meta.url), "utf8");
```

Delete assertions that require `src/ai-assistant/index.html`, `sidePanel.js`, `open-design-preview.html`, `sidePanel-layout.js`, `agent-tools-dialog.js`, and `src/ai-assistant/assets/imagefree-tool-runtime.js`. Replace them with assertions that prove current ownership:

```js
assertContains(backgroundSource, /import "\.\/imagefreeToolRuntime";/, "background imports source-owned Imagefree runtime");
assertContains(backgroundSource, /src\/devtools\/network\.html/, "background trusts source-owned DevTools Network page");
assertContains(networkBridgeSource, /src\/devtools\/network\.html/, "Network bridge trusts source-owned DevTools Network page");
assertContains(devtoolsSource, /chrome\.devtools\.network\.onRequestFinished/, "source DevTools collector watches Network requests");
assertContains(devtoolsSource, /networkContext\.detailsResponse/, "source DevTools collector returns request details");
assertContains(imagefreeRuntimeSource, /globalThis\.__imagefreeGenerateTool = executeImagefreeGenerateTool/, "Imagefree source runtime registers global hook");
assertContains(sidePanelEntrySource, /createRoot/, "React side panel entry renders app");
assertContains(sidePanelAppSource, /AgentToolsPanel|McpToolSettings|ChatPreferenceSettings/, "React side panel owns tool UI entry points");
```

- [ ] **Step 2: Replace old background bundle read in `test_background_browser_queue_wiring.mjs`**

Change the old read from `../src/ai-assistant/background/index.js` to current TypeScript sources:

```js
const source = await readFile(new URL("../src/background/browserControlMessageHandler.ts", import.meta.url), "utf8");
const backgroundSource = await readFile(new URL("../src/background/index.ts", import.meta.url), "utf8");
```

Keep queue assertions against `source`, and if the script checks runtime message wiring, assert against `backgroundSource`.

- [ ] **Step 3: Update smoke scripts to open the active side panel page**

In each Python smoke script, replace:

```python
src/ai-assistant/index.html
```

with:

```python
index.html
```

Affected files:

- `scripts/verify_ai_sidebar_core.py`
- `scripts/verify_browser_control_attach.py`
- `scripts/verify_browser_control_tool_loop.py`
- `scripts/verify_mcp_bridge_tool_loop.py`

- [ ] **Step 4: Update `verify_ai_sidebar_quality.ps1` to current source checks**

Replace syntax checks for deleted files with current source checks:

```powershell
Write-Host "[1/12] typecheck: current source-owned sidebar/background/runtime"
npm run typecheck
```

Keep the script's existing `npm run test:legacy`, focused Vitest, and smoke commands if present, but remove direct `node --check src\ai-assistant\sidePanel-layout.js`, `node --check src\ai-assistant\agent-tools-dialog.js`, and checks for old hashed assets.

- [ ] **Step 5: Run legacy convergence check**

Run: `npm run test:legacy`

Expected after implementation: PASS without reading any deleted `src/ai-assistant` bundle, DOM patch, old background bundle, or old Imagefree asset.

- [ ] **Step 6: Commit this task if committing is enabled**

```powershell
git add scripts/test_background_agent_tools_wiring.mjs scripts/test_background_browser_queue_wiring.mjs scripts/run_unit_tests.mjs scripts/verify_ai_sidebar_quality.ps1 scripts/verify_ai_sidebar_core.py scripts/verify_browser_control_attach.py scripts/verify_browser_control_tool_loop.py scripts/verify_mcp_bridge_tool_loop.py
git commit -m "迁移：收敛旧脚本到源码入口"
```

---

### Task 5: Physical Legacy Artifact Deletion

**Files:**
- Delete: `manifest.json`
- Delete: `content/index.js`
- Delete: `src/background/service-worker.js`
- Delete: `src/ai-assistant/index.html`
- Delete: `src/ai-assistant/sidePanel.js`
- Delete: `src/ai-assistant/sidePanel-layout.js`
- Delete: `src/ai-assistant/sidePanel-layout.css`
- Delete: `src/ai-assistant/agent-tools-dialog.js`
- Delete: `src/ai-assistant/notification-host.js`
- Delete: `src/ai-assistant/open-design-preview.html`
- Delete: `src/ai-assistant/open-design-entry-guard.js`
- Delete: `src/ai-assistant/preview-chrome-mock.js`
- Delete: `src/ai-assistant/devtools.html`
- Delete: `src/ai-assistant/devtools.js`
- Delete: `src/ai-assistant/assets/modulepreload-polyfill-BnkOoLKg.js`
- Delete: `src/ai-assistant/assets/text-ByXoIHTe.js`
- Delete: `src/ai-assistant/assets/tabCapture-CF6ZxIgy.js`
- Delete: `src/ai-assistant/assets/dist-D-CyEJ18.js`
- Delete: `src/ai-assistant/assets/sidePanel-BgaATPKM.css`
- Delete: `src/ai-assistant/assets/imagefree-tool-runtime.js`
- Delete: generated/reference old files under `src/ai-assistant/background/` after `rg` proves no active script imports them.

- [ ] **Step 1: Verify no active source references deleted paths**

Run:

```powershell
rg -n "src/ai-assistant/index.html|src/ai-assistant/devtools.html|src/ai-assistant/sidePanel.js|sidePanel-layout|agent-tools-dialog|ai-assistant/assets|imagefree-tool-runtime|src/background/service-worker.js|content/index.js" src public scripts tests README.md docs\AI_SIDEBAR_AGENT_ARCHITECTURE.md docs\superpowers\MIGRATION_STATUS.md
```

Expected before deletion: output may still include files about to be deleted and docs to be updated later, but active source/tests/scripts must already point at `src/devtools/network.html`, `src/background/imagefreeToolRuntime.ts`, `src/content/index.ts`, and `index.html`.

- [ ] **Step 2: Delete obsolete files with `apply_patch`**

Use one or more `apply_patch` calls with `*** Delete File:` sections for the files listed above. Do not use `Remove-Item` for manual deletion.

- [ ] **Step 3: Run deletion contract check**

Run: `npx vitest run tests/unit/background/extensionBuildContract.test.ts`

Expected after deletion: PASS.

- [ ] **Step 4: Run reference scan**

Run:

```powershell
rg -n "src/ai-assistant|sidePanel-layout|agent-tools-dialog|imagefree-tool-runtime|src/background/service-worker.js|content/index.js" src public scripts tests README.md docs\AI_SIDEBAR_AGENT_ARCHITECTURE.md docs\superpowers\MIGRATION_STATUS.md
```

Expected after deletion: only historical docs under `docs/superpowers/specs/**` or old `docs/superpowers/plans/2026-07-0[3-5]-ai-sidebar-*.md` may mention old paths. Active source, tests, scripts, README, architecture doc, and migration status must not present old files as current runtime.

- [ ] **Step 5: Commit this task if committing is enabled**

```powershell
git add -A manifest.json content/index.js src/background/service-worker.js src/ai-assistant public/manifest.json vite.config.ts src/devtools src/background src/shared tests scripts
git reset .claude 2>$null
git commit -m "清理：删除旧 AI 侧栏产物"
```

---

### Task 6: Documentation, Ledger, And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md`
- Modify: `docs/superpowers/MIGRATION_STATUS.md`

- [ ] **Step 1: Update README architecture description**

In `README.md`, replace the old `src/ai-assistant/` description with current source-owned structure:

```md
- `src/side-panel/`: Browser AI Assistant React 侧栏源码，包含聊天、工具设置、MCP、历史和运行态 UI。
- `src/devtools/`: DevTools Network 兼容页源码，通过 `chrome.devtools.network` 采集脱敏请求并发给后台 bridge。
- `src/background/imagefreeToolRuntime.ts`: Imagefree 图片生成工具的 source-owned 后台 runtime hook。
```

If `README.md` still documents root `manifest.json`, change it to `public/manifest.json` and mention extension loading uses build output (`dist/` or packaged artifact), not repository root.

- [ ] **Step 2: Update architecture doc current state**

In `docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md`, replace current-runtime mentions of old paths:

- `src/ai-assistant/devtools.js` → `src/devtools/network.ts`
- `src/ai-assistant/background/network-tools-service.js` → `src/background/networkDevtoolsBridge.ts` plus `src/background/browserControl/networkToolExecutor.ts`
- `sidePanel-layout.js` / `agent-tools-dialog.js` current ownership → `src/side-panel/**` React components and settings panels

Keep historical references only if they are clearly marked as completed migration background, not current runtime.

- [ ] **Step 3: Update migration status current phase and plan**

In `docs/superpowers/MIGRATION_STATUS.md`, update current phase and persistent plan:

```md
## 当前阶段

Phase 6：旧产物清理已完成。DevTools Network 和 Imagefree 已迁入 source-owned TypeScript 入口，旧 AI sidebar bundle、DOM patch、root no-build manifest/content/service-worker 和生成 assets 已删除。

## 持久入口

- 总设计：`docs/superpowers/specs/2026-07-05-full-upstream-engineering-migration-design.md`
- 当前计划：`docs/superpowers/plans/2026-07-07-full-upstream-engineering-migration-phase-6.md`
```

Append a `## 当前工作区 Phase 6 结果` section:

```md
- DevTools Network 兼容层保留为只读脱敏路径，但页面和采集逻辑已从 `src/ai-assistant/devtools.html/js` 迁到 `src/devtools/network.html/ts`。
- Imagefree 图片生成工具继续作为低风险本地工具暴露，后台 hook 已迁到 `src/background/imagefreeToolRuntime.ts`。
- 旧 `src/ai-assistant` bundle、DOM patch、open-design preview、生成 assets、root `manifest.json`、root `content/index.js` 和 `src/background/service-worker.js` 已删除。
- legacy 脚本和 smoke 脚本改为验证 Vite/React/TypeScript 当前源码入口。
```

- [ ] **Step 4: Run focused verification**

Run:

```powershell
npx vitest run tests/unit/background/extensionBuildContract.test.ts tests/unit/background/networkDevtoolsBridge.test.ts tests/unit/background/index.test.ts tests/unit/background/backgroundToolRuntime.test.ts --testNamePattern "DevTools|Network|extension page|Imagefree|旧 AI sidebar|运行时入口|显式 tabId"
```

Expected: PASS.

- [ ] **Step 5: Run legacy tests**

Run: `npm run test:legacy`

Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Run full project check**

Run: `npm run check`

Expected: PASS. Existing Vite chunk/vendor/inlineDynamicImports warnings are acceptable only if no command exits non-zero.

- [ ] **Step 8: Run E2E smoke**

Run: `npm run test:e2e`

Expected: PASS.

- [ ] **Step 9: Append verification rows to migration ledger**

Append rows to `## 当前验证状态` for the exact commands in Steps 4 to 8 with status `通过` and current date `2026-07-07`.

- [ ] **Step 10: Run final reference scan**

Run:

```powershell
rg -n "src/ai-assistant|sidePanel-layout|agent-tools-dialog|imagefree-tool-runtime|src/background/service-worker.js|content/index.js|root manifest" README.md docs\AI_SIDEBAR_AGENT_ARCHITECTURE.md docs\superpowers\MIGRATION_STATUS.md src public scripts tests
```

Expected: no current-runtime references to deleted old artifacts. Historical references under old migration plan/spec files are allowed only outside this command's target set.

- [ ] **Step 11: Check worktree**

Run: `git status --short`

Expected: Phase 6 files changed, committed task history present, and unrelated `.claude/` remains untracked if it existed before.

- [ ] **Step 12: Commit this task if committing is enabled**

```powershell
git add README.md docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md docs/superpowers/MIGRATION_STATUS.md
git commit -m "文档：更新第六阶段迁移台账"
```

---

## Self-Review Checklist

- Spec coverage: Phase 6 old artifact cleanup maps to Task 1 build contract, Task 2 DevTools source migration, Task 3 Imagefree source migration, Task 4 script convergence, Task 5 physical deletion, and Task 6 docs/ledger/verification.
- Placeholder scan: this plan contains concrete file paths, exact commands, expected outcomes, and code snippets for every code-changing task.
- Type consistency: new paths are consistently `src/devtools/network.html`, `src/devtools/network.ts`, and `src/background/imagefreeToolRuntime.ts`; runtime messages remain `networkContext.*`; Imagefree tool ids remain imported from `src/shared/models/toolRegistry.ts`.
- Execution boundary: old `src/ai-assistant` DevTools and Imagefree files are not deleted until replacements are implemented and focused tests pass.
