# Phase 4 Background Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the remaining legacy background/service-worker capabilities into the TypeScript background entry and shared modules while preserving compatibility APIs.

**Architecture:** Keep `src/background/index.ts` as the MV3 service-worker entry and move durable behavior into focused background modules. Shared message names, URL builders, and runtime constants live in `src/shared/**`; legacy JS files stay as migration references until Phase 6 but no longer own Phase 4 behavior.

**Tech Stack:** Chrome MV3, TypeScript, Vite, Vitest, Dexie-backed local settings, Chrome storage/session APIs.

---

## File Map

- Create: `src/shared/sidePanelRuntime.ts` for floating/side-panel message names and iframe URL helpers.
- Create: `src/background/sidePanelController.ts` for tab-scoped side panel state, inheritance, closing, and floating dispatch.
- Create: `src/background/networkDevtoolsBridge.ts` for `network.devtools` port state and `networkContext.*` requests.
- Create: `src/background/agentToolsMessageHandler.ts` for legacy `agentTools.*` compatibility over current MCP settings and local audit storage.
- Modify: `src/background/index.ts` to initialize controllers and route Phase 4 messages.
- Modify: `src/content/index.ts` to attach/close the floating assistant iframe while keeping page extraction.
- Modify: `src/background/backgroundToolRuntime.ts` and `src/shared/models/toolRegistry.ts` only if needed for Imagefree registration.
- Modify: `public/manifest.json`, `vite.config.ts`, and `tests/unit/background/extensionBuildContract.test.ts` if DevTools page compatibility requires build output.
- Test: `tests/unit/background/index.test.ts`, `tests/unit/content/index.test.ts`, plus focused tests for AgentTools and Network bridge behavior.
- Docs: `docs/superpowers/MIGRATION_STATUS.md` after implementation and verification.

## Current Progress Snapshot

Latest Phase 4 refresh on 2026-07-07:

```powershell
npx vitest run tests/unit/background/index.test.ts --testNamePattern "networkContext|DevTools Network|AgentTools|chat.send|流式|tab"
npx vitest run tests/unit/background/index.test.ts --testNamePattern "显式 tabId|DevTools 页面 sender|extension page"
npx vitest run tests/unit/side-panel/App.test.tsx --testNamePattern "聊天请求携带当前选中标签页 ID"
npx vitest run tests/unit/background/networkDevtoolsBridge.test.ts tests/unit/background/index.test.ts --testNamePattern "networkContext|DevTools Network|AgentTools|chat.send|流式|tab|显式 tabId|extension page|快捷键|其他扩展 host"
npx vitest run tests/unit/background/networkDevtoolsBridge.test.ts tests/unit/background/index.test.ts
npx vitest run tests/unit/side-panel/App.test.tsx tests/unit/background/index.test.ts tests/unit/background/networkDevtoolsBridge.test.ts
npx vitest run tests/unit/background/index.test.ts tests/unit/content/index.test.ts tests/unit/background/agentToolsMessageHandler.test.ts tests/unit/background/networkDevtoolsBridge.test.ts tests/unit/background/mcpMessageHandler.test.ts tests/unit/background/networkToolExecutor.test.ts tests/unit/background/backgroundToolRuntime.test.ts tests/unit/background/extensionBuildContract.test.ts
npx vitest run tests/unit/side-panel/App.test.tsx tests/unit/content/index.test.ts tests/unit/background/agentToolsMessageHandler.test.ts tests/unit/background/index.test.ts
npm run typecheck
npm run check
npm run test:e2e
```

Current result: COMPLETE after 2026-07-07 final review-fix fresh verification. Phase 4 background merge work is implemented in the TypeScript background entry and shared modules. Direct `networkContext.*` runtime messages now enforce sender/explicit tab scoping before reaching the DevTools bridge fallback. Latest review fixes restored selected-tab side-panel chat Network compatibility, made keyboard shortcut fallback actually open the tab-scoped side panel, restricted `network.devtools` ports to the exact current-extension DevTools page sender, restricted Grok Bridge config pushes to local http(s) bridge URLs, and tightened content-script iframe URL validation to the current extension `index.html?floating=1`.

- [x] `src/shared/sidePanelRuntime.ts` exists and defines tab/floating message names plus floating URL builder.
- [x] `src/background/sidePanelController.ts` exists and is wired from `src/background/index.ts` for tab-scoped side panel open/inherit/close behavior.
- [x] `src/content/index.ts` handles `sidePanel.floating.attach`, legacy `sidepanelFloating.open`, and `sidePanel.floating.close` for the floating iframe.
- [x] `src/background/agentToolsMessageHandler.ts` exists and `tests/unit/background/agentToolsMessageHandler.test.ts` passes when included in the targeted run.
- [x] `src/background/index.ts` routes `agentTools.*` messages to `handleAgentToolsMessage`.
- [x] `src/side-panel/App.tsx` exposes `打开悬浮助手` from normal side panel mode and `关闭悬浮助手` from `floating=1` iframe mode, using the shared `sidePanel.*` message constants.
- [x] `src/side-panel/state/appStore.ts` carries the selected context tab ID on non-stream and stream chat requests so extension-page side panels can expose the matching DevTools Network compatibility tools.
- [x] Grok Bridge config push keeps API keys local unless the bridge `baseUrl` resolves to a local `http:`/`https:` host (`localhost`, `127.0.0.1`, or IPv6 loopback); malformed, remote, non-http(s), suffix-domain, and userinfo bypass URLs skip the push.
- [x] `src/content/index.ts` only attaches floating iframes for the current extension `index.html?floating=1` URL and rejects other extension origins, other pages, or missing `floating=1`.
- [x] `src/background/networkDevtoolsBridge.ts` exists, is wired from `src/background/index.ts`, accepts `network.devtools` ports only from the exact current-extension `src/ai-assistant/devtools.html` page, and `tests/unit/background/networkDevtoolsBridge.test.ts` passes with the build contract suite.
- [x] Direct `networkContext.*` runtime messages require a sender tab or explicit integer `tabId`; sender/tab mismatch is rejected, no-tab implicit fallback is blocked, explicit DevTools page `tabId` compatibility is preserved, and same-path pages from other extension hosts are rejected.
- [x] Imagefree is registered in `src/shared/models/toolRegistry.ts`, dispatches from `src/background/backgroundToolRuntime.ts`, and targeted Imagefree tests pass.
- [x] DevTools Network compatibility build contract is restored with `devtools_page` and a Vite `devtools` entry; the floating side-panel iframe entry `index.html` is included in `web_accessible_resources`.
- [x] `tests/unit/background/index.test.ts` page-context/current-tab regressions from side-panel bootstrap were stabilized in Checkpoint 1 targeted verification.
- [x] `docs/superpowers/MIGRATION_STATUS.md` points to Phase 4 and records Phase 4 verification outcomes.

## Continuation Plan

Execute the remaining work in this order so each checkpoint leaves the repo in a more testable state.

### Checkpoint 1: Stabilize Started Side-Panel Work

**Files:**
- Modify: `tests/unit/background/index.test.ts`
- Modify only if the test exposes a real runtime issue: `src/background/sidePanelController.ts`

- [x] Keep the existing tab-scoped and floating tests, but isolate side-panel bootstrap calls from unrelated page-context tests by resetting `tabs.query` mocks after import or by using explicit mock implementations per test.
- [x] Re-run:

```powershell
npx vitest run tests/unit/background/index.test.ts tests/unit/content/index.test.ts --testNamePattern "tab scoped|floating|页面|活动标签页|current|侧边栏|悬浮|快捷键|右键菜单"
```

Actual: PASS on 2026-07-06, 2 files / 16 tests.

### Checkpoint 2: Wire AgentTools Through Background Entry

**Files:**
- Modify: `src/background/index.ts`
- Modify: `tests/unit/background/index.test.ts`

- [x] Add `AgentToolsMessage` to the background runtime message union.
- [x] Route `agentTools.getStatus`, `agentTools.configureMcp`, `agentTools.refreshMcp`, `agentTools.call`, `agentTools.getAuditLog`, and `agentTools.clearAuditLog` before the model-catalog fallback.
- [x] Pass currently exposable built-in tools into the status response so legacy UI callers keep their old response shape.
- [x] Re-run:

```powershell
npx vitest run tests/unit/background/index.test.ts tests/unit/background/agentToolsMessageHandler.test.ts --testNamePattern "agentTools|AgentTools|MCP"
```

Actual: PASS on 2026-07-06, 2 files / 6 tests.

### Checkpoint 3: Implement DevTools Network Bridge Compatibility

**Files:**
- Create: `src/background/networkDevtoolsBridge.ts`
- Modify: `src/background/index.ts`
- Modify: `public/manifest.json`
- Modify: `vite.config.ts`
- Modify: `tests/unit/background/extensionBuildContract.test.ts` only if the contract needs to match the final build path exactly.

- [x] Implement `createNetworkDevtoolsBridge()` with `handlePortConnect`, `handleMessage`, and `createRecorderAdapter(tabId)`.
- [x] Keep `network.devtools` port compatibility with `networkContext.devtoolsConnected`, `networkContext.snapshotUpdated`, `networkContext.getSnapshot`, `networkContext.getDetails`, and `networkContext.clearRequests`.
- [x] Use existing `src/shared/networkContext.ts` redaction helpers before returning metadata or details.
- [x] Wire `chrome.runtime.onConnect` so `network.devtools` ports are handled before `chat.stream` ports.
- [x] Wire runtime `networkContext.*` messages through `src/background/index.ts`.
- [x] Restore the DevTools build contract by declaring `devtools_page` and adding the Vite `devtools` entry.
- [x] Keep the floating side-panel iframe entry `index.html` web-accessible for content-script injected iframes.
- [x] Re-run:

```powershell
npx vitest run tests/unit/background/networkDevtoolsBridge.test.ts tests/unit/background/extensionBuildContract.test.ts
```

Actual: PASS on 2026-07-06, 2 files / 10 tests. Spec review: compliant. Code quality review: approved with non-blocking minor notes.

### Checkpoint 4: Merge Imagefree Runtime Registration

**Files:**
- Modify: `src/shared/models/toolRegistry.ts`
- Modify: `src/background/backgroundToolRuntime.ts`
- Modify: `src/background/index.ts` only if the legacy runtime hook must be imported by the service worker entry.

- [x] Add stable TS exports for `IMAGEFREE_GENERATE_IMAGE_TOOL_ID = "imagefree.generate_image"` and `IMAGEFREE_GENERATE_IMAGE_TOOL_NAME = "imagefree_generate_image"`.
- [x] Register Imagefree as a low-risk local tool with `deliver_result` capability and the same parameters as the legacy runtime.
- [x] Dispatch Imagefree calls to `globalThis.__imagefreeGenerateTool(toolCall, fetcher)` when available.
- [x] Return `Imagefree 图片生成运行时暂不可用，已拒绝执行。` when the compatibility runtime hook is absent.
- [x] Re-run:

```powershell
npx vitest run tests/unit/background/backgroundToolRuntime.test.ts --testNamePattern "Imagefree|imagefree"
```

Actual: PASS on 2026-07-06, 1 file / 2 Imagefree tests. Spec review: compliant. Code quality review: approved after TS return-type fix.

### Checkpoint 5: Recheck Tool Exposure Boundaries

**Files:**
- Modify only if needed: `src/background/backgroundToolRuntime.ts`
- Modify only if needed: `src/shared/models/toolRegistry.ts`

- [x] Confirm low-risk local tools and approved read-only browser/network tools remain exposable in normal mode.
- [x] Confirm `runtime.*`, `boundary.*`, `replay.*`, and `full_access.*` remain hidden unless their browser-control switches allow them.
- [x] Re-run:

```powershell
npx vitest run tests/unit/background/backgroundToolRuntime.test.ts tests/unit/background/browserControlMessageHandler.test.ts tests/unit/background/manifestBrowserControl.test.ts
```

Actual: PASS on 2026-07-06, 3 files / 110 tests.

### Checkpoint 6: Ledger and Full Verification

**Files:**
- Modify: `docs/superpowers/MIGRATION_STATUS.md`

- [x] Update the ledger current phase to Phase 4 and point current plan to `docs/superpowers/plans/2026-07-06-full-upstream-engineering-migration-phase-4.md`.
- [x] Record completed Phase 4 items and exact verification outcomes.
- [x] Run targeted Phase 4 verification:

```powershell
npx vitest run tests/unit/background/index.test.ts tests/unit/content/index.test.ts tests/unit/background/agentToolsMessageHandler.test.ts tests/unit/background/networkDevtoolsBridge.test.ts tests/unit/background/mcpMessageHandler.test.ts tests/unit/background/networkToolExecutor.test.ts tests/unit/background/backgroundToolRuntime.test.ts tests/unit/background/extensionBuildContract.test.ts
```

Actual: PASS on 2026-07-07, 8 files / 105 tests.

- [x] Refresh full verification after latest review fix:

```powershell
npm run check
npm run test:e2e
```

Actual on 2026-07-07:

- `npm run check`: PASS. This ran `npm run typecheck`, `npm run build:extension`, `npm test`, `npm run test:legacy`, and `npm run check:package`; Vitest reported 83 files / 1053 tests, legacy tests passed, package output generated `artifacts\chrome-extension`. This checkpoint's full-run count is superseded by the final Checkpoint 8 review-fix verification, where Vitest reported 83 files / 1062 tests.
- `npm run test:e2e`: PASS, 7 tests.
- Build emitted existing Vite warnings for `src/pages/game/index.html` vendor script bundling, chunk size, and `inlineDynamicImports` with `codeSplitting: false`; they did not fail verification.

### Checkpoint 7: Review Fixes for Floating UI and Trust Boundaries

**Files:**
- Modify: `src/side-panel/App.tsx`
- Modify: `tests/unit/side-panel/App.test.tsx`
- Modify: `src/background/agentToolsMessageHandler.ts`
- Modify: `tests/unit/background/agentToolsMessageHandler.test.ts`
- Modify: `src/content/index.ts`
- Modify: `tests/unit/content/index.test.ts`

- [x] Restore a reachable React side-panel floating assistant entry: normal side panel sends `sidePanel.openFloating`; floating iframe mode sends `sidePanel.floating.close` to the encoded `tabId`; invalid `tabId` shows an error notification.
- [x] Restrict Grok Bridge config POSTs to local `http:`/`https:` bridge URLs and keep remote/invalid/non-http(s)/bypass-shaped URLs from receiving `grokApiKey`.
- [x] Tighten floating iframe URL validation in the content script to the current extension `index.html?floating=1` URL.
- [x] Run review-fix focused verification:

```powershell
npx vitest run tests/unit/side-panel/App.test.tsx --testNamePattern "悬浮|floating"
npx vitest run tests/unit/background/agentToolsMessageHandler.test.ts --testNamePattern "远程|非法|scheme|baseUrl|Grok|配置 MCP"
npx vitest run tests/unit/content/index.test.ts --testNamePattern "floating|悬浮|地址"
```

Actual: PASS during TDD GREEN runs on 2026-07-07. Final integrated verification is rerun after this checkpoint.

Final integrated verification after this checkpoint:

```powershell
npx vitest run tests/unit/side-panel/App.test.tsx tests/unit/content/index.test.ts tests/unit/background/agentToolsMessageHandler.test.ts tests/unit/background/index.test.ts
npm run typecheck
npm run check
npm run test:e2e
```

Actual: PASS on 2026-07-07. Focused integrated Vitest reported 4 files / 231 tests; `npm run typecheck` passed; `npm run check` passed with 83 files / 1053 Vitest tests plus legacy/package checks; `npm run test:e2e` passed 7 tests. This checkpoint is superseded by the final Checkpoint 8 review-fix verification, where the full Vitest count reached 83 files / 1062 tests.

### Checkpoint 8: Final Review Fixes for Tab Context and DevTools Trust Boundary

**Files:**
- Modify: `src/side-panel/state/appStore.ts`
- Modify: `tests/unit/side-panel/App.test.tsx`
- Modify: `src/background/index.ts`
- Modify: `tests/unit/background/index.test.ts`
- Modify: `src/background/sidePanelController.ts`
- Modify: `src/background/networkDevtoolsBridge.ts`
- Modify: `tests/unit/background/networkDevtoolsBridge.test.ts`

- [x] Preserve selected tab context from the side panel into both non-stream `chat.send` and stream `chat.stream.start.payload` requests so extension-page side panels can expose the matching tab-scoped Network compatibility tools.
- [x] Tighten direct `networkContext.*` explicit `tabId` handling before bridge fallback: sender tab wins, sender/tab mismatch is rejected, no-tab implicit fallback is blocked, exact current-extension DevTools page sender may pass explicit `tabId`, and same-path pages from other extension hosts are rejected.
- [x] Fix keyboard-command fallback in `src/background/sidePanelController.ts` so it calls `openTabScopedSidePanel(activeTab?.id)` and actually opens `{ tabId }`, instead of only enabling/recording panel state.
- [x] Restrict `network.devtools` ports in `src/background/networkDevtoolsBridge.ts` to the exact current-extension `src/ai-assistant/devtools.html` sender page.
- [x] Use `protocol + host` URL authority checks for `chrome-extension://` trust decisions instead of relying on `URL.origin`, which is `"null"` for extension URLs in the test/runtime URL implementation.
- [x] Re-run final review-fix verification:

```powershell
npx vitest run tests/unit/background/index.test.ts --testNamePattern "显式 tabId|DevTools 页面 sender|extension page"
npx vitest run tests/unit/side-panel/App.test.tsx --testNamePattern "聊天请求携带当前选中标签页 ID"
npx vitest run tests/unit/background/networkDevtoolsBridge.test.ts tests/unit/background/index.test.ts --testNamePattern "networkContext|DevTools Network|AgentTools|chat.send|流式|tab|显式 tabId|extension page|快捷键|其他扩展 host"
npx vitest run tests/unit/side-panel/App.test.tsx tests/unit/background/index.test.ts tests/unit/background/networkDevtoolsBridge.test.ts
npm run typecheck
npm run check
npm run test:e2e
```

Actual on 2026-07-07:

- Focused background explicit `tabId` / extension-page verification: PASS, 1 file / 7 tests.
- Focused side-panel selected `tabId` chat wiring: PASS, 1 file / 2 tests.
- Focused bridge/background review-fix verification: PASS, 2 files / 41 tests.
- Integrated side-panel/background/network bridge verification: PASS, 3 files / 232 tests.
- `npm run typecheck`: PASS.
- `npm run check`: PASS. This ran `typecheck`, `build:extension`, `npm test`, `test:legacy`, and `check:package`; Vitest reported 83 files / 1062 tests, legacy tests passed, and package output generated `artifacts\chrome-extension`.
- `npm run test:e2e`: PASS, 7 tests.
- Build emitted the existing Vite warnings for `src/pages/game/index.html` vendor script bundling, chunk size, and `inlineDynamicImports` with `codeSplitting: false`; they did not fail verification.

### Task 1: Tab-Scoped Side Panel

**Files:**
- Test: `tests/unit/background/index.test.ts`
- Create: `src/shared/sidePanelRuntime.ts`
- Create: `src/background/sidePanelController.ts`
- Modify: `src/background/index.ts`

- [x] **Step 1: Write failing tests**

Add tests proving action/context/command opening calls `chrome.sidePanel.setOptions({ tabId, path: "index.html", enabled: true })`, opens `{ tabId }`, and records `sidePanel.openedTabs.v1` in `chrome.storage.session`.

- [x] **Step 2: Run RED verification**

Run: `npx vitest run tests/unit/background/index.test.ts --testNamePattern "tab scoped|侧边栏"`
Expected: FAIL because `setOptions`, session state, activation inheritance, and close handling are not implemented.

- [x] **Step 3: Implement controller**

Move the legacy tab-scoped behavior into `src/background/sidePanelController.ts` with `index.html` as the panel path, guarded Chrome API calls, session storage state, `tabs.onActivated`, `tabs.onCreated`, and `tabs.onRemoved` listeners.

- [x] **Step 4: Run GREEN verification**

Run: `npx vitest run tests/unit/background/index.test.ts --testNamePattern "tab scoped|侧边栏"`
Actual: PASS on 2026-07-06 via the side-panel/floating focused run, 2 files / 16 tests.

### Task 2: Floating Assistant Wiring

**Files:**
- Test: `tests/unit/background/index.test.ts`
- Test: `tests/unit/content/index.test.ts`
- Modify: `src/shared/sidePanelRuntime.ts`
- Modify: `src/background/sidePanelController.ts`
- Modify: `src/content/index.ts`

- [x] **Step 1: Write failing tests**

Add tests for `sidePanel.openFloating` and legacy `sidepanelFloating.openCurrentTab`: query active tab, reject unsupported URLs with Chinese errors, send `sidePanel.floating.attach` plus a `chrome-extension://.../index.html?floating=1&tabId=...&windowId=...` URL, inject `content/index.js` and retry on a missing receiving end, and close the original side panel when attach succeeds.

- [x] **Step 2: Run RED verification**

Run: `npx vitest run tests/unit/background/index.test.ts tests/unit/content/index.test.ts --testNamePattern "floating|悬浮"`
Expected: FAIL because the background route and iframe attach/close handlers are missing.

- [x] **Step 3: Implement background and content handlers**

Add shared constants, background dispatch/retry logic, URL validation, and idempotent iframe creation/removal in the content script. Preserve legacy content message type `sidepanelFloating.open` as an alias.

- [x] **Step 4: Run GREEN verification**

Run: `npx vitest run tests/unit/background/index.test.ts tests/unit/content/index.test.ts --testNamePattern "floating|悬浮"`
Actual: PASS on 2026-07-06 via the side-panel/floating focused run, 2 files / 16 tests.

### Task 3: AgentTools MCP/Grok Bridge

**Files:**
- Test: `tests/unit/background/agentToolsMessageHandler.test.ts`
- Create: `src/background/agentToolsMessageHandler.ts`
- Modify: `src/background/index.ts`

- [x] **Step 1: Write failing tests**

Cover `agentTools.getStatus`, `agentTools.configureMcp`, `agentTools.refreshMcp`, `agentTools.call`, `agentTools.getAuditLog`, and `agentTools.clearAuditLog`. Prove bearer tokens and Grok API keys stay in local app settings or local extension storage, and audit records redact token-like keys in arguments/results.

- [x] **Step 2: Run RED verification**

Run: `npx vitest run tests/unit/background/agentToolsMessageHandler.test.ts`
Expected: FAIL because the TS handler does not exist.

- [x] **Step 3: Implement handler**

Use current `src/shared/mcp/settings.ts`, `listMcpTools`, `callMcpTool`, and `createMcpToolRegistryEntries`; preserve legacy `agentTools.*` response shapes and audit key `aiSidebar.agentTools.audit.v1` in local Chrome storage when available.

- [x] **Step 4: Run GREEN verification**

Run: `npx vitest run tests/unit/background/agentToolsMessageHandler.test.ts`
Actual: PASS on 2026-07-06 via the AgentTools focused run, 2 files / 6 tests.

### Task 4: DevTools Network Bridge Compatibility

**Files:**
- Test: `tests/unit/background/networkDevtoolsBridge.test.ts`
- Test: `tests/unit/background/extensionBuildContract.test.ts`
- Create: `src/background/networkDevtoolsBridge.ts`
- Modify: `src/background/index.ts`
- Modify: `public/manifest.json`
- Modify: `vite.config.ts`

- [x] **Step 1: Write failing tests**

Cover `network.devtools` port connection, `networkContext.devtoolsConnected`, `networkContext.snapshotUpdated`, `networkContext.getSnapshot`, `networkContext.getDetails`, `networkContext.clearRequests`, and smoke execution for legacy names `network.list_requests`, `network.get_request_details`, `network.clear_requests`, `network.compare_requests`, `network.find_parameter_candidates`, and `network.extract_js_candidates`.

- [x] **Step 2: Run RED verification**

Run: `npx vitest run tests/unit/background/networkDevtoolsBridge.test.ts tests/unit/background/extensionBuildContract.test.ts`
Expected: FAIL because no TS bridge or DevTools build contract exists.

- [x] **Step 3: Implement bridge and build contract**

Store redacted request metadata per tab, proxy detail requests to the matching DevTools port with an RPC timeout, clear caches by tab, expose a recorder-like adapter for `BrowserNetworkToolExecutor`, and add `devtools_page` build support if needed.

- [x] **Step 4: Run GREEN verification**

Run: `npx vitest run tests/unit/background/networkDevtoolsBridge.test.ts tests/unit/background/extensionBuildContract.test.ts`
Actual: PASS on 2026-07-06, 2 files / 10 tests.

### Task 5: Imagefree Runtime Registration

**Files:**
- Test: `tests/unit/background/backgroundToolRuntime.test.ts`
- Modify: `src/shared/models/toolRegistry.ts`
- Modify: `src/background/backgroundToolRuntime.ts`
- Modify: `src/background/index.ts`

- [x] **Step 1: Write failing tests**

Add tests that `imagefree_generate_image` is registered as a low-risk local tool and dispatches to `globalThis.__imagefreeGenerateTool` when present, returning an unavailable error otherwise.

- [x] **Step 2: Run RED verification**

Run: `npx vitest run tests/unit/background/backgroundToolRuntime.test.ts --testNamePattern "Imagefree|imagefree"`
Expected: FAIL because the tool is not registered in the TypeScript runtime.

- [x] **Step 3: Implement runtime registration**

Register the Imagefree tool in the shared registry and route execution through the background tool runtime without default-enabling unrelated high-risk browser tools.

- [x] **Step 4: Run GREEN verification**

Run: `npx vitest run tests/unit/background/backgroundToolRuntime.test.ts --testNamePattern "Imagefree|imagefree"`
Actual: PASS on 2026-07-06, 1 file / 2 Imagefree tests.

### Task 6: Ledger and Full Verification

**Files:**
- Modify: `docs/superpowers/MIGRATION_STATUS.md`

- [x] **Step 1: Update ledger**

Set current phase to Phase 4, point the current plan to this file, describe completed background merge work, and record the latest verification commands with actual outcomes.

- [x] **Step 2: Run targeted verification**

Run: `npx vitest run tests/unit/background/index.test.ts tests/unit/content/index.test.ts tests/unit/background/agentToolsMessageHandler.test.ts tests/unit/background/networkDevtoolsBridge.test.ts tests/unit/background/mcpMessageHandler.test.ts tests/unit/background/networkToolExecutor.test.ts tests/unit/background/backgroundToolRuntime.test.ts tests/unit/background/extensionBuildContract.test.ts`
Actual: PASS on 2026-07-07, 8 files / 105 tests after the direct `networkContext.*` sender/tab boundary review fix.

- [x] **Step 3: Run full verification**

Run: `npm run check` and `npm run test:e2e`.
Actual: PASS on 2026-07-07. `npm run check` covered typecheck, build, unit, legacy, and package checks; Vitest reported 83 files / 1053 tests after review fixes. `npm run test:e2e` passed 7 tests. This task-level full-run count is superseded by the final Checkpoint 8 review-fix verification, where Vitest reported 83 files / 1062 tests.

## Self-Review

- Spec coverage: The plan covers tab-scoped side panel, floating assistant, Grok/MCP Bridge, Imagefree runtime, DevTools Network compatibility, tool authorization boundaries, tests, ledger update, and full verification.
- Placeholder scan: No `TBD`, `TODO`, or incomplete steps remain.
- Type consistency: Message names match the legacy service-worker and DevTools bridge names while adding `sidePanel.openFloating` and `sidePanel.floating.*` TypeScript aliases.
