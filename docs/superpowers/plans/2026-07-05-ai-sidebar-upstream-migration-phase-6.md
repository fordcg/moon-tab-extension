# AI Sidebar Upstream Migration Phase 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the low-risk `network.clear_requests` tool by clearing only the existing DevTools Network bridge/background snapshot cache.

**Architecture:** Keep the no-build MV3 architecture. Extend the shared Network tool contract, dispatch through the existing background Network service, and use the existing DevTools port as the control channel.

**Tech Stack:** Chrome MV3, PowerShell, plain ESM JavaScript, Node `assert` tests, existing DevTools Network bridge.

---

## Scope Guard

This plan implements only:

- `network.clear_requests`
- Function name `network_clear_requests`
- Optional `tabId`
- Clearing the in-memory DevTools bridge request store and background snapshot cache

Do not migrate `network.wait_for_requests`, debugger-backed Network recorder, request replay, request sending, JS/SourceMap/Runtime tools, raw credential access, or upstream React/TypeScript/Vite settings UI.

The worktree is already dirty. Do not revert unrelated files. If committing, stage only files listed in the current task and use a Chinese commit message.

## File Structure

Modify:

- `scripts/test_network_tools.mjs`
- `src/shared/network-tools.mjs`
- `src/ai-assistant/background/network-tools-service.js`
- `src/ai-assistant/devtools.js`
- `src/ai-assistant/background/index.js`
- `scripts/test_background_agent_tools_wiring.mjs`
- `README.md`
- `docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md`

Create:

- `docs/superpowers/specs/2026-07-05-ai-sidebar-upstream-migration-phase-6-design.md`
- `docs/superpowers/plans/2026-07-05-ai-sidebar-upstream-migration-phase-6.md`

---

### Task 1: Shared Clear Contract

**Files:**
- Modify: `scripts/test_network_tools.mjs`
- Modify: `src/shared/network-tools.mjs`

- [x] **Step 1: Add failing shared contract tests**

Add assertions for:

- `NETWORK_CLEAR_REQUESTS_TOOL_ID === "network.clear_requests"`
- `NETWORK_CLEAR_REQUESTS_TOOL_NAME === "network_clear_requests"`
- Tool definition order:
  - `network.list_requests`
  - `network.get_request_details`
  - `network.clear_requests`
  - `network.compare_requests`
  - `network.find_parameter_candidates`
  - `network.extract_js_candidates`
- Optional `tabId` schema and `additionalProperties: false`.
- `normalizeNetworkClearRequestsArguments()` accepts `{}` and `{ tabId }`, rejects non-objects and extra keys.
- `formatNetworkClearRequestsResult()` reports `tabId` and `clearedCount`.

- [x] **Step 2: Implement shared clear exports**

In `src/shared/network-tools.mjs`:

- Add clear ID/name constants.
- Add `NETWORK_CLEAR_REQUESTS_PARAMETERS`.
- Insert clear tool definition after details.
- Add `normalizeNetworkClearRequestsArguments()`.
- Add `formatNetworkClearRequestsResult()`.

- [x] **Step 3: Run focused shared test**

Run:

```powershell
node scripts\test_network_tools.mjs
```

Expected final line:

```text
network tools tests passed
```

### Task 2: Background Service Dispatch

**Files:**
- Modify: `scripts/test_network_tools.mjs`
- Modify: `src/ai-assistant/background/network-tools-service.js`

- [x] **Step 1: Add service dispatch coverage**

Add tests that:

- `executeNetworkTool()` dispatches `network_clear_requests`.
- The injected `clearNetworkRequests({ tabId })` receives normalized arguments.
- Tool output includes clear result text.
- Missing clear adapter returns a tool error.
- Invalid arguments return `INVALID_ARGUMENTS`.

- [x] **Step 2: Implement service dispatch**

In `network-tools-service.js`:

- Import clear constants, normalizer and formatter.
- Teach `resolveNetworkToolKind()` to return `"clear"`.
- Add `executeNetworkClearRequestsTool()`.
- Call the injected `options.clearNetworkRequests()`.

- [x] **Step 3: Run service test**

Run:

```powershell
node scripts\test_network_tools.mjs
```

Expected final line:

```text
network tools tests passed
```

### Task 3: DevTools Bridge and Background Wiring

**Files:**
- Modify: `src/ai-assistant/devtools.js`
- Modify: `src/ai-assistant/background/index.js`
- Modify: `scripts/test_background_agent_tools_wiring.mjs`

- [x] **Step 1: Add wiring assertions**

Assert that:

- Shared tools define clear.
- Network service dispatches clear.
- Background injects `clearNetworkRequests`.
- Background accepts `networkContext.clearRequests`.
- DevTools bridge listens for `networkContext.clearRequests`, clears `requestStore`, and publishes an updated snapshot.

- [x] **Step 2: Implement DevTools clear handling**

In `devtools.js`, handle `networkContext.clearRequests` by clearing `requestStore` and calling `postSnapshotUpdated()`.

- [x] **Step 3: Implement background clear adapter**

In `background/index.js`, wire `clearNetworkRequests` to `dn({ type: "networkContext.clearRequests" })`, clear the background snapshot, post to DevTools, and return `{ ok: true, tabId, clearedCount }`.

- [x] **Step 4: Run wiring test**

Run:

```powershell
node scripts\test_background_agent_tools_wiring.mjs
```

Expected final line:

```text
background agent tools wiring tests passed
```

### Task 4: Documentation and Regression

**Files:**
- Modify: `README.md`
- Modify: `docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md`
- Create: Phase 6 spec and plan docs

- [x] **Step 1: Document Phase 6**

Add README and architecture sections explaining:

- clear only affects the current DevTools bridge/background snapshot cache.
- the tool does not send requests, read extra details, execute scripts, or expose credentials.
- `network.wait_for_requests` remains a non-goal.

- [x] **Step 2: Run full regression**

Run:

```powershell
node scripts\test_network_tools.mjs
node scripts\test_background_agent_tools_wiring.mjs
npm test
```

Expected final lines:

```text
network tools tests passed
background agent tools wiring tests passed
unit tests passed
```

- [x] **Step 3: Final status check**

Run:

```powershell
git status --short
```

Expected: Phase 6 files appear alongside existing dirty worktree changes; no unrelated files are reverted.

## Self-Review Checklist

- Spec coverage:
  - Upstream/current difference positioning: Phase 6 design doc.
  - Shared clear contract: Task 1.
  - Background service dispatch: Task 2.
  - DevTools/background control channel: Task 3.
  - Documentation and regression verification: Task 4.

- Non-goals:
  - No `network.wait_for_requests`, recorder, replay, request sending, JS/SourceMap/Runtime, Full Access, raw credentials, or UI rewrite.
