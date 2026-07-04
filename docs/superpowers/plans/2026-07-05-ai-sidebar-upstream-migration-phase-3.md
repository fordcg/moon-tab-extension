# AI Sidebar Upstream Migration Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the low-risk read-only Network tools from upstream into the current Moon Tab AI sidebar using the existing DevTools Network context bridge.

**Architecture:** Keep the no-build MV3 architecture. Add a pure shared Network tools contract, add a small source-owned background service, and patch the bundled assistant background only at tool registration, dispatch, and prompt injection points.

**Tech Stack:** Chrome MV3, PowerShell, plain ESM JavaScript, Node `assert` tests, existing DevTools Network bridge, existing tool audit path.

---

## Scope Guard

This plan implements only `network.list_requests` and `network.get_request_details`.

Do not migrate Debugger Network recorder, `network.clear_requests`, `network.wait_for_requests`, `network.compare_requests`, `network.find_parameter_candidates`, `network.extract_js_candidates`, `js.*`, `sourcemap.*`, `runtime.*`, `boundary.*`, `replay.*`, `full_access.*`, upstream React/TypeScript/Vite settings UI, or any raw credential access in this plan.

The worktree is already dirty. Do not revert unrelated files. If committing, stage only files listed in the current task and use a Chinese commit message.

## File Structure

Create:

- `src/shared/network-tools.mjs`
  Owns Network tool IDs, model function names, schemas, argument normalization, request list/detail formatting, and audit-safe summaries.

- `src/ai-assistant/background/network-tools-service.js`
  Owns the background execution adapter. It validates tool calls, uses injected Network context readers, and returns existing tool-result objects.

- `scripts/test_network_tools.mjs`
  Tests shared module behavior and background service behavior.

Modify:

- `scripts/run_unit_tests.mjs`
  Adds `scripts/test_network_tools.mjs`.

- `src/ai-assistant/background/index.js`
  Imports Network tool definitions/service, exposes the two tools, dispatches `network.*`, and injects safety prompt copy.

- `scripts/test_background_agent_tools_wiring.mjs`
  Adds source assertions for Phase 3 background wiring.

- `README.md` and `docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md`
  Document Phase 3 behavior and non-goals.

---

### Task 1: Shared Network Tool Contract

**Files:**
- Create: `src/shared/network-tools.mjs`
- Create: `scripts/test_network_tools.mjs`
- Modify: `scripts/run_unit_tests.mjs`

- [ ] **Step 1: Write the failing Network tools test**

Create `scripts/test_network_tools.mjs` with assertions for:

```js
import assert from "node:assert/strict";
import {
  NETWORK_GET_REQUEST_DETAILS_TOOL_ID,
  NETWORK_GET_REQUEST_DETAILS_TOOL_NAME,
  NETWORK_LIST_REQUESTS_TOOL_ID,
  NETWORK_LIST_REQUESTS_TOOL_NAME,
  NETWORK_TOOL_DEFINITIONS,
  formatNetworkRequestDetailsResult,
  formatNetworkRequestsListResult,
  normalizeNetworkGetRequestDetailsArguments,
  normalizeNetworkListRequestsArguments,
  summarizeNetworkToolResult,
} from "../src/shared/network-tools.mjs";

assert.equal(NETWORK_LIST_REQUESTS_TOOL_ID, "network.list_requests");
assert.equal(NETWORK_LIST_REQUESTS_TOOL_NAME, "network_list_requests");
assert.equal(NETWORK_GET_REQUEST_DETAILS_TOOL_ID, "network.get_request_details");
assert.equal(NETWORK_GET_REQUEST_DETAILS_TOOL_NAME, "network_get_request_details");
assert.deepEqual(NETWORK_TOOL_DEFINITIONS.map((tool) => tool.id), [
  "network.list_requests",
  "network.get_request_details",
]);
assert.equal(NETWORK_TOOL_DEFINITIONS[0].parameters.additionalProperties, false);

assert.deepEqual(normalizeNetworkListRequestsArguments({}), {
  ok: true,
  args: { limit: 50 },
});
assert.match(normalizeNetworkListRequestsArguments({ extra: true }).message, /不接受参数/);
assert.match(normalizeNetworkListRequestsArguments({ tabId: "1" }).message, /tabId 必须是数字/);
assert.match(normalizeNetworkListRequestsArguments({ limit: 0 }).message, /limit 必须是 1 到 200/);
assert.match(normalizeNetworkListRequestsArguments({ limit: 201 }).message, /limit 必须是 1 到 200/);
assert.match(normalizeNetworkListRequestsArguments({ resourceTypes: ["x".repeat(65)] }).message, /resourceTypes/);
assert.deepEqual(normalizeNetworkListRequestsArguments({
  tabId: 7,
  resourceTypes: ["XHR", "fetch", "XHR", "", 1],
  limit: 2,
}).args, {
  tabId: 7,
  resourceTypes: ["xhr", "fetch"],
  limit: 2,
});

assert.match(normalizeNetworkGetRequestDetailsArguments({}).message, /requestIds 必须是包含 1 到 50/);
assert.match(normalizeNetworkGetRequestDetailsArguments({ requestIds: [] }).message, /requestIds 必须是包含 1 到 50/);
assert.match(normalizeNetworkGetRequestDetailsArguments({ requestIds: [""] }).message, /requestIds 必须是包含 1 到 50/);
assert.match(normalizeNetworkGetRequestDetailsArguments({ requestIds: ["x".repeat(257)] }).message, /requestIds 必须是包含 1 到 50/);
assert.deepEqual(normalizeNetworkGetRequestDetailsArguments({ requestIds: ["a", "a", " b "], tabId: 3 }).args, {
  requestIds: ["a", "b"],
  tabId: 3,
});

const requests = [
  { id: "1", method: "GET", status: 200, resourceType: "Script", url: "https://example.test/app.js", durationMs: 12, redacted: false },
  { id: "2", method: "POST", status: 201, resourceType: "XHR", url: "https://example.test/api", durationMs: 34, redacted: true, truncated: true },
];
const listText = formatNetworkRequestsListResult(requests, { limit: 10 });
assert.match(listText, /Network 请求列表/);
assert.match(listText, /id=1/);
assert.match(listText, /GET/);
assert.match(listText, /已脱敏/);
assert.match(formatNetworkRequestsListResult([], { limit: 10 }), /未找到匹配的 Network 请求/);

const detailsText = formatNetworkRequestDetailsResult([
  {
    ...requests[1],
    requestHeaders: [{ name: "authorization", value: "[已脱敏]" }],
    responseHeaders: [{ name: "content-type", value: "application/json" }],
    requestBody: "{\"token\":\"[已脱敏]\"}",
    responseBody: "{\"ok\":true}",
    responseBodyEncoding: "utf8",
  },
]);
assert.match(detailsText, /Network 请求详情/);
assert.match(detailsText, /authorization/);
assert.match(detailsText, /\[已脱敏\]/);
assert.match(detailsText, /responseBody/);
assert.match(formatNetworkRequestDetailsResult([]), /未找到请求详情/);
assert.match(summarizeNetworkToolResult(requests), /2 个 Network 请求/);

console.log("network tools tests passed");
```

- [ ] **Step 2: Add the test to the unit runner**

Add this command after `scripts/test_network_redaction.mjs` in `scripts/run_unit_tests.mjs`:

```js
  ["node", ["scripts/test_network_tools.mjs"]],
```

- [ ] **Step 3: Run the new test and verify it fails**

Run:

```powershell
node scripts/test_network_tools.mjs
```

Expected: FAIL with `Cannot find module` for `src/shared/network-tools.mjs`.

- [ ] **Step 4: Implement `src/shared/network-tools.mjs`**

Implement constants, schemas, argument normalization, list/detail formatters, and summary helpers to satisfy the test. Keep it pure ESM and independent of Chrome APIs.

- [ ] **Step 5: Run the Network tools test**

Run:

```powershell
node scripts/test_network_tools.mjs
```

Expected:

```text
network tools tests passed
```

### Task 2: Background Network Tool Service

**Files:**
- Modify: `scripts/test_network_tools.mjs`
- Create: `src/ai-assistant/background/network-tools-service.js`

- [ ] **Step 1: Extend the Network tools test for background service**

In `scripts/test_network_tools.mjs`, import `executeNetworkTool` from `../src/ai-assistant/background/network-tools-service.js` and add assertions for:

- list success reads injected snapshot and filters resource type.
- details success reads injected details.
- invalid arguments return `isError: true`.
- DevTools unavailable returns a clear error.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
node scripts/test_network_tools.mjs
```

Expected: FAIL because `network-tools-service.js` does not exist or lacks `executeNetworkTool`.

- [ ] **Step 3: Implement `network-tools-service.js`**

Implement `executeNetworkTool(toolCall, options)` with injected readers:

```js
{
  getNetworkSnapshot: async ({ tabId }) => ({ ok: true, requests: [] }),
  getNetworkDetails: async ({ tabId, requestIds }) => ({ ok: true, details: [] })
}
```

Return `{ toolCallId, name, content, summary }` on success and `{ toolCallId, name, content, isError: true, code }` on error.

- [ ] **Step 4: Run syntax and behavior tests**

Run:

```powershell
node --check .\src\ai-assistant\background\network-tools-service.js
node scripts/test_network_tools.mjs
```

Expected:

```text
network tools tests passed
```

### Task 3: Assistant Background Wiring

**Files:**
- Modify: `src/ai-assistant/background/index.js`
- Modify: `scripts/test_background_agent_tools_wiring.mjs`

- [ ] **Step 1: Add failing wiring assertions**

Update `scripts/test_background_agent_tools_wiring.mjs` to read `network-tools-service.js`, parse-check it, and assert:

- background imports `network-tools-service.js`.
- background imports `network-tools.mjs`.
- background exposes `network.list_requests` and `network.get_request_details`.
- background dispatches `network.*` before `mcp.*`.
- background prompt contains DevTools/脱敏/截断/敏感字段边界 copy.

- [ ] **Step 2: Run the wiring test and verify it fails**

Run:

```powershell
node scripts/test_background_agent_tools_wiring.mjs
```

Expected: FAIL because background has not imported or dispatched Network tools.

- [ ] **Step 3: Patch `background/index.js` imports and tool definitions**

Add imports for:

```js
import { executeNetworkTool } from "./network-tools-service.js";
import { NETWORK_GET_REQUEST_DETAILS_TOOL_ID, NETWORK_LIST_REQUESTS_TOOL_ID, NETWORK_TOOL_DEFINITIONS } from "../../shared/network-tools.mjs";
```

Update `getAssistantBuiltinToolDefinitions()` so it appends missing `NETWORK_TOOL_DEFINITIONS` along with the existing `browser.extract_content` definition.

- [ ] **Step 4: Patch Network execution helper and dispatch**

Add a helper that calls existing `dn()`:

```js
async function executeNetworkToolFromBackground(toolCall) {
  return executeNetworkTool(toolCall, {
    getNetworkSnapshot: ({ tabId } = {}) => dn({ type: "networkContext.getSnapshot", tabId }),
    getNetworkDetails: ({ tabId, requestIds } = {}) => dn({ type: "networkContext.getDetails", tabId, requestIds }),
  });
}
```

Patch `_t()` so `r.id.startsWith(\`network.\`)` dispatches to this helper before the `mcp.*` branch.

- [ ] **Step 5: Patch prompt safety copy**

Add Network tool rules to `vt()`:

```js
`- 需要分析页面请求时，先调用 network_list_requests 查看 DevTools 已采集的请求摘要；DevTools 面板必须保持打开并连接。`,
`- 需要读取请求/响应详情时，只能用 network_get_request_details 读取 list_requests 返回的 requestIds；结果已脱敏、截断，不要要求或猜测 Cookie、Authorization、Token、Secret 原文。`,
```

- [ ] **Step 6: Run syntax and wiring tests**

Run:

```powershell
node --check .\src\ai-assistant\background\index.js
node scripts/test_background_agent_tools_wiring.mjs
```

Expected:

```text
background agent tools wiring tests passed
```

### Task 4: Documentation and Regression Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md`

- [ ] **Step 1: Update README with Phase 3 behavior**

Document:

- `network.list_requests`
- `network.get_request_details`
- DevTools Network panel requirement
- Redaction/truncation boundary
- Non-goals: Replay, Runtime, Full Access, raw credentials

- [ ] **Step 2: Update architecture document**

Document:

- `src/shared/network-tools.mjs`
- `src/ai-assistant/background/network-tools-service.js`
- Reuse of `networkContext.getSnapshot` / `networkContext.getDetails`
- Excluded upstream Network tools and later-phase candidates

- [ ] **Step 3: Run focused tests**

Run:

```powershell
node scripts/test_network_tools.mjs
node scripts/test_background_agent_tools_wiring.mjs
```

Expected final lines:

```text
network tools tests passed
background agent tools wiring tests passed
```

- [ ] **Step 4: Run full unit suite**

Run:

```powershell
npm test
```

Expected final line:

```text
unit tests passed
```

- [ ] **Step 5: Final status check**

Run:

```powershell
git status --short
```

Expected: no staged files. Existing unrelated dirty files may remain because the worktree was dirty before Phase 3 execution.

## Self-Review Checklist

- Spec coverage:
  - Shared Network tool contract: Task 1.
  - Background execution adapter: Task 2.
  - Background tool exposure, dispatch, and prompt boundary: Task 3.
  - Documentation: Task 4.

- Non-goals:
  - No Debugger recorder, raw credentials, Replay, Runtime, Full Access, JS/Source Map, or additional Network tools appear in this plan.

- Verification:
  - New tests are wired into `scripts/run_unit_tests.mjs`.
  - Focused tests cover pure logic, background service, and source wiring.
  - Full verification uses `npm test`.
