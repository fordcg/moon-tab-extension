# AI Sidebar Upstream Migration Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add low-risk read-only Network analysis tools, `network.compare_requests` and `network.find_parameter_candidates`, on top of Phase 3 DevTools Network details.

**Architecture:** Keep the no-build MV3 architecture. Extend the pure shared Network tool contract and the source-owned background Network service; reuse existing background `network.*` dispatch and DevTools `networkContext.getDetails`.

**Tech Stack:** Chrome MV3, PowerShell, plain ESM JavaScript, Node `assert` tests, existing DevTools Network bridge.

---

## Scope Guard

This plan implements only:

- `network.compare_requests`
- `network.find_parameter_candidates`

Do not migrate `network.clear_requests`, `network.wait_for_requests`, `network.extract_js_candidates`, `js.*`, `sourcemap.*`, `runtime.*`, `boundary.*`, `replay.*`, `full_access.*`, debugger-backed Network recorder, same-origin JS fetching, SourceMap fetching, request replay, raw credential access, or upstream React/TypeScript/Vite settings UI.

The worktree is already dirty. Do not revert unrelated files. If committing, stage only files listed in the current task and use a Chinese commit message.

## File Structure

Modify:

- `scripts/test_network_tools.mjs`  
  Adds TDD coverage for Phase 4 constants, schemas, argument normalization, compare/find formatting, background execution, and no raw secret leakage.

- `src/shared/network-tools.mjs`  
  Owns Phase 4 tool IDs, model function names, schemas, argument normalization, field flattening, request comparison, parameter candidate discovery, and formatting.

- `src/ai-assistant/background/network-tools-service.js`  
  Dispatches Phase 4 tools and reads details through the existing injected `getNetworkDetails` callback.

- `scripts/test_background_agent_tools_wiring.mjs`  
  Adds source assertions that Phase 4 tool IDs are exposed and the prompt contains compare/candidate safety copy.

- `README.md` and `docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md`  
  Document Phase 4 behavior, boundaries, and remaining non-goals.

Create:

- `docs/superpowers/specs/2026-07-05-ai-sidebar-upstream-migration-phase-4-design.md`
- `docs/superpowers/plans/2026-07-05-ai-sidebar-upstream-migration-phase-4.md`

---

### Task 1: Phase 4 Shared Network Analysis Contract

**Files:**
- Modify: `scripts/test_network_tools.mjs`
- Modify: `src/shared/network-tools.mjs`

- [x] **Step 1: Write the failing shared contract tests**

Add imports in `scripts/test_network_tools.mjs`:

```js
  NETWORK_COMPARE_REQUESTS_TOOL_ID,
  NETWORK_COMPARE_REQUESTS_TOOL_NAME,
  NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID,
  NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_NAME,
  findNetworkParameterCandidates,
  formatNetworkParameterCandidatesResult,
  formatNetworkRequestsComparisonResult,
  normalizeNetworkCompareRequestsArguments,
  normalizeNetworkFindParameterCandidatesArguments,
```

Add assertions:

```js
assert.equal(NETWORK_COMPARE_REQUESTS_TOOL_ID, "network.compare_requests");
assert.equal(NETWORK_COMPARE_REQUESTS_TOOL_NAME, "network_compare_requests");
assert.equal(NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID, "network.find_parameter_candidates");
assert.equal(NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_NAME, "network_find_parameter_candidates");
assert.deepEqual(NETWORK_TOOL_DEFINITIONS.map((tool) => tool.id), [
  "network.list_requests",
  "network.get_request_details",
  "network.compare_requests",
  "network.find_parameter_candidates",
]);
assert.match(normalizeNetworkCompareRequestsArguments({ requestIds: ["a"] }).message, /至少包含 2 个/);
assert.deepEqual(normalizeNetworkCompareRequestsArguments({ requestIds: ["a", "a", " b "], tabId: 8 }).args, {
  requestIds: ["a", "b"],
  tabId: 8,
});
assert.match(normalizeNetworkFindParameterCandidatesArguments({ requestIds: [] }).message, /requestIds 必须是包含 1 到 50/);
assert.deepEqual(normalizeNetworkFindParameterCandidatesArguments({ requestIds: [" a "], tabId: 9 }).args, {
  requestIds: ["a"],
  tabId: 9,
});
```

Add fixture details and assertions:

```js
const comparisonDetails = [
  {
    id: "cmp-1",
    method: "POST",
    status: 200,
    resourceType: "XHR",
    url: "https://api.example.test/search?q=apple&ts=1700000000&sign=abcdef1234567890abcdef1234567890",
    requestHeaders: [{ name: "content-type", value: "application/json" }],
    requestBody: "{\"page\":1,\"nonce\":\"nonce-a\",\"token\":\"raw-body-secret\"}",
    responseBody: "{\"password\":\"raw-response-secret\"}",
  },
  {
    id: "cmp-2",
    method: "POST",
    status: 200,
    resourceType: "XHR",
    url: "https://api.example.test/search?q=banana&ts=1700000001&sign=bbbbbb1234567890abcdef1234567890",
    requestHeaders: [{ name: "content-type", value: "application/json" }],
    requestBody: "{\"page\":2,\"nonce\":\"nonce-b\",\"token\":\"raw-body-secret-2\"}",
    responseBody: "{\"password\":\"raw-response-secret-2\"}",
  },
];
const comparisonText = formatNetworkRequestsComparisonResult(comparisonDetails);
assert.match(comparisonText, /Network 请求对比结果/);
assert.match(comparisonText, /变化字段/);
assert.match(comparisonText, /query.sign/);
assert.match(comparisonText, /疑似关键参数/);
assert.doesNotMatch(comparisonText, /raw-body-secret/);
assert.doesNotMatch(comparisonText, /raw-response-secret/);
const candidates = findNetworkParameterCandidates(comparisonDetails);
assert.ok(candidates.some((candidate) => candidate.name === "sign"));
assert.ok(candidates.some((candidate) => candidate.name === "ts"));
const candidatesText = formatNetworkParameterCandidatesResult(candidates);
assert.match(candidatesText, /疑似签名字段/);
assert.match(candidatesText, /疑似时间戳字段/);
```

- [x] **Step 2: Run the shared contract test and verify it fails**

Run:

```powershell
node scripts/test_network_tools.mjs
```

Expected: FAIL because Phase 4 exports do not exist.

- [x] **Step 3: Implement shared Phase 4 exports**

In `src/shared/network-tools.mjs`:

- Add Phase 4 constants and tool definitions after `network.get_request_details`.
- Add compare/find schemas using `requestIds` and `tabId`.
- Export `normalizeNetworkCompareRequestsArguments()` and `normalizeNetworkFindParameterCandidatesArguments()`.
- Export `formatNetworkRequestsComparisonResult()`, `findNetworkParameterCandidates()`, and `formatNetworkParameterCandidatesResult()`.
- Reuse `redactNetworkRecord()` before flattening or formatting any request detail.

- [x] **Step 4: Run the shared contract test**

Run:

```powershell
node scripts/test_network_tools.mjs
```

Expected final line:

```text
network tools tests passed
```

### Task 2: Background Phase 4 Network Service Dispatch

**Files:**
- Modify: `scripts/test_network_tools.mjs`
- Modify: `src/ai-assistant/background/network-tools-service.js`

- [x] **Step 1: Add failing service dispatch tests**

In `scripts/test_network_tools.mjs`, add `executeNetworkTool()` assertions:

```js
let compareArgs;
const compareToolResult = await executeNetworkTool(
  {
    id: "call-compare",
    name: NETWORK_COMPARE_REQUESTS_TOOL_NAME,
    arguments: { tabId: 13, requestIds: ["cmp-1", "cmp-2"] },
  },
  {
    getNetworkDetails: async (args) => {
      compareArgs = args;
      return { ok: true, details: comparisonDetails };
    },
  },
);
assert.deepEqual(compareArgs, { tabId: 13, requestIds: ["cmp-1", "cmp-2"] });
assert.equal(compareToolResult.isError, undefined);
assert.match(compareToolResult.content, /Network 请求对比结果/);
assert.match(compareToolResult.summary, /2 个 Network 请求/);

const findToolResult = await executeNetworkTool(
  {
    id: "call-find",
    name: NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID,
    arguments: { requestIds: ["cmp-1"] },
  },
  {
    getNetworkDetails: async () => ({ ok: true, details: [comparisonDetails[0]] }),
  },
);
assert.equal(findToolResult.isError, undefined);
assert.match(findToolResult.content, /疑似关键参数/);
```

- [x] **Step 2: Run the service test and verify it fails**

Run:

```powershell
node scripts/test_network_tools.mjs
```

Expected: FAIL because `executeNetworkTool()` does not dispatch Phase 4 tool names.

- [x] **Step 3: Implement service dispatch**

In `src/ai-assistant/background/network-tools-service.js`:

- Import Phase 4 constants, normalizers, and formatters.
- Extend `resolveNetworkToolKind()` to return `compare` and `find`.
- Add a shared `executeNetworkDetailsAnalysisTool()` helper that validates arguments, calls `getNetworkDetails`, and formats either comparison or candidates.

- [x] **Step 4: Run syntax and behavior tests**

Run:

```powershell
node --check .\src\ai-assistant\background\network-tools-service.js
node scripts/test_network_tools.mjs
```

Expected:

```text
network tools tests passed
```

### Task 3: Background Wiring and Documentation

**Files:**
- Modify: `scripts/test_background_agent_tools_wiring.mjs`
- Modify: `README.md`
- Modify: `docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md`

- [x] **Step 1: Add failing wiring assertions**

Update `scripts/test_background_agent_tools_wiring.mjs` to assert:

- `NETWORK_COMPARE_REQUESTS_TOOL_ID` appears in background.
- `NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID` appears in background.
- prompt text contains Network 差异分析 and 关键参数候选.

- [x] **Step 2: Patch prompt copy if needed**

If the wiring test fails on prompt copy, patch `src/ai-assistant/background/index.js` safety prompt with one concise line:

```js
`- 需要做接口差异分析或寻找关键参数时，只能基于已脱敏的 network_compare_requests / network_find_parameter_candidates 结果；不要猜测或还原敏感字段原文。`,
```

- [x] **Step 3: Update docs**

Document:

- Phase 4 adds `network.compare_requests` and `network.find_parameter_candidates`.
- Both tools reuse DevTools details and remain read-only.
- Remaining non-goals: Network clear/wait/extract JS, JS/SourceMap, Runtime, Replay, Full Access, raw credentials.

- [x] **Step 4: Run wiring and docs-adjacent tests**

Run:

```powershell
node --check .\src\ai-assistant\background\index.js
node scripts/test_background_agent_tools_wiring.mjs
```

Expected final line:

```text
background agent tools wiring tests passed
```

### Task 4: Regression Verification

**Files:**
- No new production files.

- [x] **Step 1: Run focused Phase 4 tests**

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

- [x] **Step 2: Run full unit suite**

Run:

```powershell
npm test
```

Expected final line:

```text
unit tests passed
```

- [x] **Step 3: Final status check**

Run:

```powershell
git status --short
```

Expected: Phase 4 files appear alongside existing Phase1-3 staged changes; no unrelated files are reverted.

## Self-Review Checklist

- Spec coverage:
  - Upstream/current difference matrix: Phase 4 design doc.
  - Shared Network compare/find contract: Task 1.
  - Background service dispatch: Task 2.
  - Documentation and prompt boundary: Task 3.
  - Regression verification: Task 4.

- Non-goals:
  - No raw credentials, Replay, Runtime, Full Access, JS/SourceMap, same-origin fetch, request sending, or debugger-backed recorder.

- TDD:
  - Tests are added and observed failing before production changes.
  - Focused tests pass before full suite.
