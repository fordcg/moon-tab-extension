# AI Sidebar Upstream Migration Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a low-risk, requestIds-scoped `network.extract_js_candidates` tool that searches already redacted DevTools Network JS response bodies for bounded candidate snippets.

**Architecture:** Keep the no-build MV3 architecture. Extend `src/shared/network-tools.mjs` with the pure Phase 5 contract and formatting logic, then extend `src/ai-assistant/background/network-tools-service.js` to read details through the existing DevTools bridge and format JS candidates.

**Tech Stack:** Chrome MV3, PowerShell, plain ESM JavaScript, Node `assert` tests, existing DevTools Network bridge.

---

## Scope Guard

This plan implements only:

- `network.extract_js_candidates`
- Function name `network_extract_js_candidates`
- Required `requestIds` input
- Search within already available, already redacted Network details `responseBody`

Do not migrate debugger-backed Network recorder, `network.clear_requests`, `network.wait_for_requests`, no-requestIds global JS search, `js.*`, same-origin JS fetch, `sourcemap.*`, `runtime.*`, `boundary.*`, `replay.*`, `full_access.*`, source map parsing, request sending, raw credential access, or upstream React/TypeScript/Vite settings UI.

The worktree is already dirty. Do not revert unrelated files. If committing, stage only files listed in the current task and use a Chinese commit message.

## File Structure

Modify:

- `scripts/test_network_tools.mjs`  
  Adds TDD coverage for Phase 5 constants, schema, normalization, JS-like detection, snippet formatting, sensitive assignment redaction, service dispatch, and DevTools failure handling.

- `src/shared/network-tools.mjs`  
  Owns Phase 5 tool ID/name, schema, argument normalization, JS-like request detection, keyword search, line/column approximation, snippet redaction, and result formatting.

- `src/ai-assistant/background/network-tools-service.js`  
  Dispatches Phase 5 tools and reads selected request details through the existing injected `getNetworkDetails` callback.

- `scripts/test_background_agent_tools_wiring.mjs`  
  Adds source assertions that Phase 5 tool IDs are defined, dispatched, and explained in the background prompt.

- `README.md` and `docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md`  
  Document Phase 5 behavior, boundaries, and remaining non-goals.

Create:

- `docs/superpowers/specs/2026-07-05-ai-sidebar-upstream-migration-phase-5-design.md`
- `docs/superpowers/plans/2026-07-05-ai-sidebar-upstream-migration-phase-5.md`

---

### Task 1: Shared Phase 5 Network JS Candidate Contract

**Files:**
- Modify: `scripts/test_network_tools.mjs`
- Modify: `src/shared/network-tools.mjs`

- [x] **Step 1: Write failing shared contract tests**

Add imports in `scripts/test_network_tools.mjs`:

```js
  NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID,
  NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME,
  findNetworkJsCandidates,
  formatNetworkJsCandidatesResult,
  normalizeNetworkExtractJsCandidatesArguments,
```

Add constant and definition assertions after the Phase 4 assertions:

```js
assert.equal(NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID, "network.extract_js_candidates");
assert.equal(NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME, "network_extract_js_candidates");
assert.deepEqual(NETWORK_TOOL_DEFINITIONS.map((tool) => tool.id), [
  "network.list_requests",
  "network.get_request_details",
  "network.compare_requests",
  "network.find_parameter_candidates",
  "network.extract_js_candidates",
]);
assert.equal(NETWORK_TOOL_DEFINITIONS[4].parameters.required.includes("requestIds"), true);
assert.equal(NETWORK_TOOL_DEFINITIONS[4].parameters.properties.requestIds.maxItems, 50);
assert.equal(NETWORK_TOOL_DEFINITIONS[4].parameters.properties.keywords.maxItems, 20);
assert.equal(NETWORK_TOOL_DEFINITIONS[4].parameters.properties.limit.maximum, 40);
```

Add normalization assertions:

```js
assert.match(normalizeNetworkExtractJsCandidatesArguments({}).message, /requestIds 必须是包含 1 到 50/);
assert.match(
  normalizeNetworkExtractJsCandidatesArguments({ requestIds: ["js-1"], keywords: ["x".repeat(121)] }).message,
  /keywords/,
);
assert.match(
  normalizeNetworkExtractJsCandidatesArguments({ requestIds: ["js-1"], urlIncludes: "x".repeat(241) }).message,
  /urlIncludes/,
);
assert.match(
  normalizeNetworkExtractJsCandidatesArguments({ requestIds: ["js-1"], limit: 41 }).message,
  /limit 必须是 1 到 40/,
);
assert.deepEqual(
  normalizeNetworkExtractJsCandidatesArguments({
    requestIds: ["js-1", " js-1 ", "js-2"],
    tabId: 15,
    keywords: ["sign", "SIGN", " md5 ", "", 1],
    urlIncludes: "/api/search",
    limit: 3,
  }).args,
  {
    requestIds: ["js-1", "js-2"],
    tabId: 15,
    keywords: ["sign", "md5"],
    urlIncludes: "/api/search",
    limit: 3,
  },
);
```

Add JS fixture and formatter assertions:

```js
const jsCandidateDetails = [
  {
    id: "js-1",
    method: "GET",
    status: 200,
    resourceType: "Script",
    mimeType: "application/javascript",
    url: "https://example.test/assets/app.js?token=raw-query-secret",
    responseBody: [
      "function makeSign(input) {",
      "  const token = \"raw-js-token\";",
      "  return md5(input + token + Date.now());",
      "}",
      "fetch('/api/search?keyword=' + encodeURIComponent(input));",
    ].join("\n"),
  },
  {
    id: "js-2",
    method: "GET",
    status: 200,
    resourceType: "XHR",
    mimeType: "application/json",
    url: "https://example.test/api/data",
    responseBody: "{\"ok\":true}",
  },
  {
    id: "js-3",
    method: "GET",
    status: 200,
    resourceType: "Other",
    mimeType: "text/plain",
    url: "https://example.test/static/chunk.mjs",
    responseBody: "const signature = sha256(payload);",
  },
];

const jsCandidates = findNetworkJsCandidates(jsCandidateDetails, {
  keywords: ["makeSign", "md5", "signature"],
  urlIncludes: "/api/search",
  limit: 10,
});
assert.ok(jsCandidates.some((candidate) => candidate.requestId === "js-1" && candidate.term === "makeSign"));
assert.ok(jsCandidates.some((candidate) => candidate.requestId === "js-1" && candidate.term === "/api/search"));
assert.ok(jsCandidates.some((candidate) => candidate.requestId === "js-3" && candidate.term === "signature"));
assert.equal(jsCandidates.some((candidate) => candidate.requestId === "js-2"), false);
assert.doesNotMatch(JSON.stringify(jsCandidates), /raw-js-token|raw-query-secret/);

const jsCandidatesText = formatNetworkJsCandidatesResult(jsCandidateDetails, {
  keywords: ["makeSign", "md5"],
  urlIncludes: "/api/search",
  limit: 4,
});
assert.match(jsCandidatesText, /Network JS 候选片段/);
assert.match(jsCandidatesText, /id=js-1/);
assert.match(jsCandidatesText, /makeSign/);
assert.match(jsCandidatesText, /md5/);
assert.match(jsCandidatesText, /\/api\/search/);
assert.match(jsCandidatesText, /\[已脱敏\]/);
assert.doesNotMatch(jsCandidatesText, /raw-js-token|raw-query-secret/);
assert.match(formatNetworkJsCandidatesResult([], { keywords: ["sign"] }), /未找到匹配的 JS 候选资源/);
```

- [x] **Step 2: Run the shared contract test and verify it fails**

Run:

```powershell
node scripts/test_network_tools.mjs
```

Expected: FAIL because Phase 5 exports do not exist.

- [x] **Step 3: Implement shared Phase 5 exports**

In `src/shared/network-tools.mjs`:

Add constants near existing Network constants:

```js
export const NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID = "network.extract_js_candidates";
export const NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME = "network_extract_js_candidates";
```

Add constants:

```js
export const NETWORK_JS_CANDIDATE_KEYWORDS_MAX_ITEMS = 20;
export const NETWORK_JS_CANDIDATE_KEYWORD_MAX_LENGTH = 120;
export const NETWORK_JS_CANDIDATE_URL_INCLUDES_MAX_LENGTH = 240;
export const NETWORK_JS_CANDIDATE_DEFAULT_LIMIT = 12;
export const NETWORK_JS_CANDIDATE_MAX_LIMIT = 40;

const JS_CANDIDATE_SNIPPET_RADIUS = 120;
const JS_CANDIDATE_SNIPPET_MAX_LENGTH = 360;
const JS_CANDIDATE_DEFAULT_KEYWORDS = Object.freeze([
  "sign",
  "signature",
  "encrypt",
  "crypto",
  "md5",
  "sha",
  "aes",
  "nonce",
  "timestamp",
  "token",
]);
const JS_SENSITIVE_ASSIGNMENT_PATTERN =
  /\b(authorization|cookie|token|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password|passwd|credential|session|sid|csrf|xsrf)\b\s*[:=]\s*(['"`])[^'"`]{1,500}\2/gi;
```

Add schema:

```js
export const NETWORK_EXTRACT_JS_CANDIDATES_PARAMETERS = Object.freeze({
  type: "object",
  required: Object.freeze(["requestIds"]),
  additionalProperties: false,
  properties: Object.freeze({
    requestIds: NETWORK_GET_REQUEST_DETAILS_PARAMETERS.properties.requestIds,
    tabId: NETWORK_GET_REQUEST_DETAILS_PARAMETERS.properties.tabId,
    keywords: Object.freeze({
      type: "array",
      maxItems: NETWORK_JS_CANDIDATE_KEYWORDS_MAX_ITEMS,
      items: Object.freeze({
        type: "string",
        minLength: 1,
        maxLength: NETWORK_JS_CANDIDATE_KEYWORD_MAX_LENGTH,
      }),
      description: "可选 JS 搜索关键词，例如 sign、md5、接口路径或参数名。",
    }),
    urlIncludes: Object.freeze({
      type: "string",
      minLength: 1,
      maxLength: NETWORK_JS_CANDIDATE_URL_INCLUDES_MAX_LENGTH,
      description: "可选接口路径、URL 片段或参数名，会作为额外搜索词。",
    }),
    limit: Object.freeze({
      type: "integer",
      minimum: 1,
      maximum: NETWORK_JS_CANDIDATE_MAX_LIMIT,
      description: `最多返回的 JS 候选片段数量，默认 ${NETWORK_JS_CANDIDATE_DEFAULT_LIMIT}。`,
    }),
  }),
});
```

Append the tool definition after `network.find_parameter_candidates`:

```js
  Object.freeze({
    id: NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID,
    name: NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME,
    groupId: NETWORK_GROUP_ID,
    displayName: "Network JS 候选片段",
    description: "从已脱敏 Network JS 请求详情中按关键词、接口路径或参数名提取有限候选源码片段。不执行脚本，不补 fetch，不读取原始凭据。",
    parameters: NETWORK_EXTRACT_JS_CANDIDATES_PARAMETERS,
  }),
```

Add `normalizeNetworkExtractJsCandidatesArguments(value = {})`:

```js
export function normalizeNetworkExtractJsCandidatesArguments(value = {}) {
  const details = normalizeNetworkDetailsArguments(value, NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID, 1, new Set([
    "tabId",
    "requestIds",
    "keywords",
    "urlIncludes",
    "limit",
  ]));
  if (!details.ok) return details;

  const keywords = normalizeJsCandidateKeywords(value.keywords);
  if (!keywords.ok) return keywords;

  const urlIncludes = normalizeJsCandidateUrlIncludes(value.urlIncludes);
  if (!urlIncludes.ok) return urlIncludes;

  const limit = normalizeJsCandidateLimit(value.limit);
  if (!limit.ok) return limit;

  const args = { ...details.args, limit: limit.value };
  if (keywords.value.length > 0) args.keywords = keywords.value;
  if (urlIncludes.value) args.urlIncludes = urlIncludes.value;
  return { ok: true, args };
}
```

Change `normalizeNetworkDetailsArguments()` signature so Phase 5 can pass allowed keys:

```js
function normalizeNetworkDetailsArguments(value, toolName, minRequestIds, allowedKeys = DETAILS_ALLOWED_KEYS) {
  // Existing body, but use allowedKeys instead of DETAILS_ALLOWED_KEYS.
}
```

Add these helper exports:

```js
export function findNetworkJsCandidates(details, options = {}) {
  const records = normalizeNetworkAnalysisRecords(details);
  const terms = createJsCandidateSearchTerms(options);
  const limit = normalizeFormatJsCandidateLimit(options.limit);
  const candidates = [];

  for (const record of records) {
    if (!isNetworkJavaScriptDetail(record)) continue;
    const body = record?.responseBody === undefined || record?.responseBody === null ? "" : String(record.responseBody);
    if (!body.trim()) continue;
    for (const term of terms) {
      appendJsCandidateMatches(candidates, record, body, term, limit);
      if (candidates.length >= limit) return candidates;
    }
  }

  return candidates;
}

export function formatNetworkJsCandidatesResult(details, options = {}) {
  const candidates = findNetworkJsCandidates(details, options);
  if (candidates.length === 0) {
    return "未找到匹配的 JS 候选资源。请先用 network.list_requests 选择 Script 请求，或提供更具体的 keywords/urlIncludes。";
  }

  const lines = [`Network JS 候选片段（${candidates.length} 条）：`];
  for (const candidate of candidates) {
    lines.push(
      `- id=${candidate.requestId} term=${candidate.term} line=${candidate.line} column=${candidate.column} url=${formatLongText(candidate.url)}`,
    );
    lines.push(indentBlock(candidate.snippet));
    const flags = [];
    if (candidate.redacted) flags.push("已脱敏");
    if (candidate.truncated) flags.push("已截断");
    if (flags.length > 0) lines.push(`  flags: ${flags.join("、")}`);
  }
  return lines.join("\n");
}
```

Add unexported helpers for JS-like detection, keyword normalization, matching, line/column, and snippet redaction:

```js
function isNetworkJavaScriptDetail(record) {
  const resourceType = String(record?.resourceType || "").trim().toLowerCase();
  const mimeType = String(record?.mimeType || "").trim().toLowerCase();
  const path = parseNetworkAnalysisUrl(record?.url)?.pathname?.toLowerCase() || String(record?.url || "").toLowerCase();
  return (
    resourceType === "script" ||
    /\.(?:mjs|js)$/i.test(path) ||
    mimeType.includes("javascript") ||
    mimeType.includes("ecmascript") ||
    mimeType === "text/jscript"
  );
}

function createJsCandidateSearchTerms(options = {}) {
  const terms = [];
  const keywords = Array.isArray(options.keywords) && options.keywords.length > 0 ? options.keywords : JS_CANDIDATE_DEFAULT_KEYWORDS;
  for (const keyword of keywords) appendUniqueSearchTerm(terms, keyword);
  appendUniqueSearchTerm(terms, options.urlIncludes);
  return terms;
}

function appendUniqueSearchTerm(terms, value) {
  const term = typeof value === "string" ? value.trim() : "";
  if (!term) return;
  if (!terms.some((item) => item.toLowerCase() === term.toLowerCase())) terms.push(term);
}

function appendJsCandidateMatches(candidates, record, body, term, limit) {
  const lowerBody = body.toLowerCase();
  const lowerTerm = term.toLowerCase();
  let position = lowerBody.indexOf(lowerTerm);
  while (position >= 0 && candidates.length < limit) {
    candidates.push(createJsCandidate(record, body, term, position));
    position = lowerBody.indexOf(lowerTerm, position + Math.max(1, lowerTerm.length));
  }
}

function createJsCandidate(record, body, term, position) {
  const start = Math.max(0, position - JS_CANDIDATE_SNIPPET_RADIUS);
  const end = Math.min(body.length, position + term.length + JS_CANDIDATE_SNIPPET_RADIUS);
  const truncated = truncateText(body.slice(start, end).replace(/\s+/g, " "), JS_CANDIDATE_SNIPPET_MAX_LENGTH);
  const redacted = redactJsCandidateSnippet(truncated.text);
  const location = calculateTextLineColumn(body, position);
  return {
    requestId: normalizeDisplayText(record?.id, "(unknown)"),
    url: formatLongText(record?.url),
    term,
    position,
    line: location.line,
    column: location.column,
    snippet: redacted.text,
    redacted: redacted.redacted,
    truncated: truncated.truncated || start > 0 || end < body.length,
  };
}

function redactJsCandidateSnippet(value) {
  let redacted = false;
  const text = String(value || "").replace(JS_SENSITIVE_ASSIGNMENT_PATTERN, (_match, name) => {
    redacted = true;
    return `${name} = "${REDACTED_VALUE}"`;
  });
  return { text, redacted };
}

function calculateTextLineColumn(text, position) {
  const safePosition = Math.max(0, Math.min(Number.isFinite(position) ? Math.floor(position) : 0, text.length));
  const prefix = text.slice(0, safePosition);
  const lines = prefix.split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}
```

Add `normalizeJsCandidateKeywords()`, `normalizeJsCandidateUrlIncludes()`, and `normalizeJsCandidateLimit()` with fixed Chinese error strings:

```js
function normalizeJsCandidateKeywords(value) {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, message: "network.extract_js_candidates 的 keywords 必须是字符串数组。" };
  if (value.length > NETWORK_JS_CANDIDATE_KEYWORDS_MAX_ITEMS) {
    return { ok: false, message: `network.extract_js_candidates 的 keywords 最多包含 ${NETWORK_JS_CANDIDATE_KEYWORDS_MAX_ITEMS} 项。` };
  }
  const keywords = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const keyword = item.trim();
    if (!keyword) continue;
    if (keyword.length > NETWORK_JS_CANDIDATE_KEYWORD_MAX_LENGTH) {
      return { ok: false, message: `network.extract_js_candidates 的 keywords 每项不能超过 ${NETWORK_JS_CANDIDATE_KEYWORD_MAX_LENGTH} 个字符。` };
    }
    if (!keywords.some((existing) => existing.toLowerCase() === keyword.toLowerCase())) keywords.push(keyword);
  }
  return { ok: true, value: keywords };
}

function normalizeJsCandidateUrlIncludes(value) {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "string") return { ok: false, message: "network.extract_js_candidates 的 urlIncludes 必须是字符串。" };
  const text = value.trim();
  if (!text) return { ok: true, value: undefined };
  if (text.length > NETWORK_JS_CANDIDATE_URL_INCLUDES_MAX_LENGTH) {
    return { ok: false, message: `network.extract_js_candidates 的 urlIncludes 不能超过 ${NETWORK_JS_CANDIDATE_URL_INCLUDES_MAX_LENGTH} 个字符。` };
  }
  return { ok: true, value: text };
}

function normalizeJsCandidateLimit(value) {
  if (value === undefined) return { ok: true, value: NETWORK_JS_CANDIDATE_DEFAULT_LIMIT };
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > NETWORK_JS_CANDIDATE_MAX_LIMIT
  ) {
    return { ok: false, message: `network.extract_js_candidates 的 limit 必须是 1 到 ${NETWORK_JS_CANDIDATE_MAX_LIMIT} 的整数。` };
  }
  return { ok: true, value };
}

function normalizeFormatJsCandidateLimit(value) {
  return normalizeJsCandidateLimit(value).ok ? normalizeJsCandidateLimit(value).value : NETWORK_JS_CANDIDATE_DEFAULT_LIMIT;
}
```

- [x] **Step 4: Run the shared contract test**

Run:

```powershell
node scripts/test_network_tools.mjs
```

Expected final line:

```text
network tools tests passed
```

### Task 2: Background Phase 5 Dispatch

**Files:**
- Modify: `scripts/test_network_tools.mjs`
- Modify: `src/ai-assistant/background/network-tools-service.js`

- [x] **Step 1: Add failing service dispatch tests**

In `scripts/test_network_tools.mjs`, add after Phase 4 service tests:

```js
let jsCandidateArgs;
const jsCandidateToolResult = await executeNetworkTool(
  {
    id: "call-js-candidates",
    name: NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME,
    arguments: {
      tabId: 16,
      requestIds: ["js-1", "js-1", " js-3 "],
      keywords: ["makeSign", "signature"],
      urlIncludes: "/api/search",
      limit: 5,
    },
  },
  {
    getNetworkDetails: async (args) => {
      jsCandidateArgs = args;
      return {
        ok: true,
        tabId: args.tabId,
        requestIds: args.requestIds,
        details: jsCandidateDetails,
      };
    },
  },
);
assert.deepEqual(jsCandidateArgs, { tabId: 16, requestIds: ["js-1", "js-3"] });
assert.equal(jsCandidateToolResult.toolCallId, "call-js-candidates");
assert.equal(jsCandidateToolResult.name, NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME);
assert.equal(jsCandidateToolResult.isError, undefined);
assert.match(jsCandidateToolResult.content, /Network JS 候选片段/);
assert.match(jsCandidateToolResult.content, /id=js-1/);
assert.match(jsCandidateToolResult.content, /id=js-3/);
assert.doesNotMatch(jsCandidateToolResult.content, /raw-js-token|raw-query-secret/);
assert.match(jsCandidateToolResult.summary, /3 个 Network 请求/);

const invalidJsCandidateToolResult = await executeNetworkTool({
  id: "call-js-invalid",
  name: NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID,
  arguments: { requestIds: ["js-1"], limit: 0 },
});
assert.equal(invalidJsCandidateToolResult.isError, true);
assert.equal(invalidJsCandidateToolResult.code, "INVALID_ARGUMENTS");
assert.match(invalidJsCandidateToolResult.content, /limit 必须是 1 到 40/);
```

- [x] **Step 2: Run the service test and verify it fails**

Run:

```powershell
node scripts/test_network_tools.mjs
```

Expected: FAIL because `executeNetworkTool()` does not dispatch Phase 5 tool names.

- [x] **Step 3: Implement service dispatch**

In `src/ai-assistant/background/network-tools-service.js`:

Import Phase 5 symbols:

```js
  NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID,
  NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME,
  formatNetworkJsCandidatesResult,
  normalizeNetworkExtractJsCandidatesArguments,
```

Extend `executeNetworkTool()`:

```js
  if (toolKind === "extract-js-candidates") return executeNetworkExtractJsCandidatesTool(toolCall, options);
```

Add executor:

```js
async function executeNetworkExtractJsCandidatesTool(toolCall, options) {
  const validation = normalizeNetworkExtractJsCandidatesArguments(getRawToolArguments(toolCall));
  if (!validation.ok) {
    return createToolError(toolCall, validation.message, ERROR_CODES.INVALID_ARGUMENTS);
  }

  const args = validation.args;
  return executeNetworkDetailsAnalysisTool(toolCall, options, args, (details) =>
    formatNetworkJsCandidatesResult(details, args),
  );
}
```

Extend `resolveNetworkToolKind()`:

```js
  if (name === NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID || name === NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME) {
    return "extract-js-candidates";
  }
```

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
- Modify: `src/ai-assistant/background/index.js`
- Modify: `README.md`
- Modify: `docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md`

- [x] **Step 1: Add failing wiring assertions**

Update `scripts/test_background_agent_tools_wiring.mjs` to assert:

```js
assert.match(
  networkToolsSource,
  /NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID/,
  "shared Network tools must define network.extract_js_candidates",
);

assert.match(
  networkToolsServiceSource,
  /NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID|NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME/,
  "Network tools service must dispatch network.extract_js_candidates",
);

assert.match(
  backgroundSource,
  /JS 候选片段|network_extract_js_candidates/,
  "background prompt must mention Phase 5 Network JS candidate extraction",
);
```

- [x] **Step 2: Patch prompt copy if needed**

If the wiring test fails on prompt copy, patch the browser tool safety prompt in `src/ai-assistant/background/index.js` with one concise line:

```js
`- 需要定位 JS 候选片段时，只能基于已脱敏的 network_extract_js_candidates 结果；不要要求完整 bundle、同源补位、Source Map、Runtime 或敏感字段原文。`,
```

- [x] **Step 3: Update README**

In `README.md`, add a Phase 5 section after Phase 4:

```markdown
### Phase 5：DevTools Network JS 候选片段

AI 侧边栏在 Phase 4 的只读 Network 分析基础上继续增加 `network.extract_js_candidates`：

- 只分析 `network.list_requests` 返回、再由模型显式传入的 JS 请求 `requestIds`。
- 从已脱敏、已截断的 JS `responseBody` 中按关键词、接口路径或参数名提取有限候选片段。
- 不执行页面脚本，不补 fetch，不解析 Source Map，不读取 Cookie、Storage 或原始凭据。

Phase 5 完成时仍不迁入无 requestIds 的全局 JS 搜索、`js.*`、`sourcemap.*`、`runtime.*`、`replay.*`、`full_access.*`、`network.clear_requests` 或 `network.wait_for_requests`。后续 Phase 6 已独立迁入只清空缓存的 `network.clear_requests`，`network.wait_for_requests` 仍暂缓。
```

- [x] **Step 4: Update architecture docs**

In `docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md`, add a Phase 5 subsection after Phase 4:

```markdown
### Phase 5：network.extract_js_candidates

Phase 5 迁入 requestIds 约束版 `network.extract_js_candidates`。该工具只读取 `network.list_requests` 返回并由模型显式传入的 JS 请求详情，从已脱敏、已截断的 `responseBody` 中按默认关键词、显式关键词或 `urlIncludes` 提取有限候选片段。

该阶段不建立 JS 资源索引，不支持无 requestIds 的全局 JS 搜索，不同源 fetch，不解析 Source Map，不执行 Runtime，不发送请求，也不读取原始 Cookie、Authorization、Token、Secret 或 Storage。需要更大源码上下文、Source Map 或运行时模块摘要时，应进入后续 `js.*` / `sourcemap.*` / `runtime.*` 独立阶段。
```

Also update the Phase 3/4 verification paragraph to mention `network.extract_js_candidates`.

- [x] **Step 5: Run wiring and docs-adjacent tests**

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

- [x] **Step 1: Run focused Phase 5 tests**

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

Expected: Phase 5 files appear alongside existing dirty worktree changes; no unrelated files are reverted.

## Self-Review Checklist

- Spec coverage:
  - Upstream/current comprehensive difference matrix: Phase 5 design doc.
  - Shared `network.extract_js_candidates` contract: Task 1.
  - Background service dispatch: Task 2.
  - Documentation and prompt boundary: Task 3.
  - Regression verification: Task 4.

- Non-goals:
  - No debugger-backed recorder, clear/wait, no-requestIds JS search, `js.*`, Source Map, Runtime, Boundary, Replay, Full Access, same-origin fetch, request sending, raw credentials, or UI rewrite.

- TDD:
  - Tests are added and observed failing before production changes.
  - Focused tests pass before full suite.
