# AI Sidebar Upstream Migration Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Phase 2 upstream differences into the current Moon Tab AI sidebar: browser automation Playbooks and the read-only `browser.extract_content` tool.

**Architecture:** Keep the no-build MV3 architecture. Add pure shared modules under `src/shared/`, use a small source-owned background service for content extraction formatting, and patch the existing assistant background only at tool registration, prompt injection, and tool dispatch points.

**Tech Stack:** Chrome MV3, PowerShell, plain ESM JavaScript, Node `assert` tests, existing Python/Playwright smoke scripts, `chrome.storage.local`, existing bundled side-panel/background integration.

---

## Scope Guard

This plan implements only Phase 2 from `docs/superpowers/specs/2026-07-04-ai-sidebar-upstream-migration-phase-2-design.md`.

Do not migrate Console, Performance, Network recorder, `network.*`, `js.*`, `sourcemap.*`, `runtime.*`, `replay.*`, `full_access.*`, upstream React/TypeScript/Vite settings UI, or high-risk form interaction Playbooks in this plan.

The worktree is already dirty. Do not revert unrelated files. Each task commit must stage only the files listed in that task. Before each commit, run `git diff --cached --name-status` and confirm the staged file list exactly matches the task.

## File Structure

Create:

- `src/shared/automation-playbooks.mjs`  
  Owns the two Phase 2 Playbooks, Playbook settings normalization, local trigger heuristic, model-selection prompt construction, model-selection JSON parsing, and selected Playbook prompt formatting.

- `src/shared/browser-extract-content.mjs`  
  Owns `browser.extract_content` constants, JSON schema, argument normalization, selector safety checks, temporary extraction-rule construction, result formatting, and audit-safe result summary.

- `src/ai-assistant/background/browser-extract-content-service.js`  
  Owns the background execution adapter for `extract_content`. It accepts a tool call, reads saved extraction rules through an injected provider, calls the existing `pageContext.extract` path through an injected function, and returns a tool-result object.

- `scripts/test_automation_playbooks.mjs`  
  Tests Playbook registration, settings normalization, selection heuristics, selection prompt parsing, and selected prompt formatting.

- `scripts/test_browser_extract_content.mjs`  
  Tests `extract_content` argument validation, selector constraints, temporary rule construction, result formatting, and truncation.

Modify:

- `src/shared/browser-control-contract.mjs`  
  Adds `EXTRACT_CONTENT` action/tool id/schema and delegates `extract_content` validation to `browser-extract-content.mjs`.

- `src/ai-assistant/background/index.js`  
  Imports Phase 2 modules, exposes `browser.extract_content`, dispatches the tool through `browser-extract-content-service.js`, adds safe prompt rules, and performs Playbook preselection before the main model request.

- `scripts/test_browser_control_queue.mjs`  
  Adds contract tests for `browser.extract_content`.

- `scripts/test_background_agent_tools_wiring.mjs`  
  Adds source assertions for Phase 2 background wiring.

- `scripts/run_unit_tests.mjs`  
  Adds the new test scripts.

- `README.md` and `docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md`  
  Document Phase 2 Playbook and `extract_content` behavior plus explicit non-goals.

---

### Task 1: Automation Playbooks Shared Module

**Files:**
- Create: `src/shared/automation-playbooks.mjs`
- Create: `scripts/test_automation_playbooks.mjs`
- Modify: `scripts/run_unit_tests.mjs`

- [x] **Step 1: Write the failing Playbook test**

Create `scripts/test_automation_playbooks.mjs`:

```js
import assert from "node:assert/strict";
import {
  AUTOMATION_PLAYBOOK_SETTINGS_KEY,
  createAutomationPlaybookSelectionPrompt,
  createSelectedAutomationPlaybookPrompt,
  getAutomationPlaybookById,
  getEnabledAutomationPlaybooks,
  getRegisteredAutomationPlaybooks,
  normalizeAutomationPlaybookSelection,
  normalizeAutomationPlaybookSettings,
  parseAutomationPlaybookSelectionJson,
  shouldRunAutomationPlaybookSelection,
} from "../src/shared/automation-playbooks.mjs";

assert.equal(AUTOMATION_PLAYBOOK_SETTINGS_KEY, "automationPlaybookSettings");

const playbooks = getRegisteredAutomationPlaybooks();
assert.deepEqual(playbooks.map((item) => item.id), ["page_reading", "multi_page_synthesis"]);
assert.equal(playbooks.every((item) => item.defaultEnabled), true);
assert.equal(playbooks.some((item) => item.id === "form_interaction"), false);
assert.equal(playbooks[0].prompt.includes("browser.extract_content"), true);

const clone = getRegisteredAutomationPlaybooks();
clone[0].tags.push("mutated");
assert.equal(getRegisteredAutomationPlaybooks()[0].tags.includes("mutated"), false);

assert.deepEqual(normalizeAutomationPlaybookSettings(undefined), { disabledPlaybookIds: [] });
assert.deepEqual(
  normalizeAutomationPlaybookSettings({
    disabledPlaybookIds: ["multi_page_synthesis", "unknown", "multi_page_synthesis", 1],
  }),
  { disabledPlaybookIds: ["multi_page_synthesis"] },
);
assert.deepEqual(getEnabledAutomationPlaybooks({ disabledPlaybookIds: ["page_reading"] }).map((item) => item.id), [
  "multi_page_synthesis",
]);

assert.equal(shouldRunAutomationPlaybookSelection("帮我总结当前页面并提取重点"), true);
assert.equal(shouldRunAutomationPlaybookSelection("比较这几个标签页的差异"), true);
assert.equal(shouldRunAutomationPlaybookSelection("今天星期几"), false);
assert.equal(shouldRunAutomationPlaybookSelection("解释一下 JavaScript 闭包"), false);

const prompt = createAutomationPlaybookSelectionPrompt({
  userContent: "总结当前页面",
  pageContextSummary: "Page title: Example",
  playbooks,
});
assert.equal(prompt.length, 2);
assert.equal(prompt[0].role, "system");
assert.match(prompt[0].content, /只返回 JSON/);
assert.match(prompt[1].content, /总结当前页面/);
assert.match(prompt[1].content, /page_reading/);

assert.deepEqual(parseAutomationPlaybookSelectionJson('{"playbookId":"page_reading","confidence":"high","reason":"页面阅读"}'), {
  playbookId: "page_reading",
  confidence: "high",
  reason: "页面阅读",
});
assert.deepEqual(parseAutomationPlaybookSelectionJson("```json\n{\"playbookId\":null,\"confidence\":\"low\",\"reason\":\"无需策略\"}\n```"), {
  playbookId: null,
  confidence: "low",
  reason: "无需策略",
});
assert.equal(parseAutomationPlaybookSelectionJson("not json"), undefined);

const normalized = normalizeAutomationPlaybookSelection(
  {
    playbookId: "page_reading",
    confidence: "not-valid",
    reason: "x".repeat(260),
  },
  playbooks,
);
assert.equal(normalized.playbookId, "page_reading");
assert.equal(normalized.title, "页面阅读");
assert.equal(normalized.confidence, "low");
assert.equal(normalized.reason.length, 200);
assert.equal(normalizeAutomationPlaybookSelection({ playbookId: "missing" }, playbooks), undefined);

const selectedPrompt = createSelectedAutomationPlaybookPrompt(normalized);
assert.match(selectedPrompt, /当前选中的浏览器自动化任务策略：页面阅读/);
assert.match(selectedPrompt, /选择置信度：low/);
assert.match(selectedPrompt, /browser.extract_content/);

assert.equal(getAutomationPlaybookById("multi_page_synthesis").title, "多页面汇总");
assert.equal(getAutomationPlaybookById("missing"), undefined);

console.log("automation playbooks tests passed");
```

- [x] **Step 2: Add the test to the unit runner**

Modify `scripts/run_unit_tests.mjs` by inserting this command immediately before `scripts/test_browser_control_queue.mjs`:

```js
  ["node", ["scripts/test_automation_playbooks.mjs"]],
```

- [x] **Step 3: Run the new test and verify it fails**

Run:

```powershell
node scripts/test_automation_playbooks.mjs
```

Expected: FAIL with `Cannot find module` for `src/shared/automation-playbooks.mjs`.

- [x] **Step 4: Implement `automation-playbooks.mjs`**

Create `src/shared/automation-playbooks.mjs`:

```js
export const AUTOMATION_PLAYBOOK_SETTINGS_KEY = "automationPlaybookSettings";

const PLAYBOOK_SELECTION_REASON_LIMIT = 200;

const BUILTIN_AUTOMATION_PLAYBOOKS = Object.freeze([
  Object.freeze({
    id: "page_reading",
    title: "页面阅读",
    description: "阅读当前页面、提炼重点、抽取用户指定信息，并在证据不足时说明缺口。",
    tags: Object.freeze(["页面", "阅读", "总结", "信息提取"]),
    source: "builtin",
    defaultEnabled: true,
    risk: "low",
    recommendedCapabilities: Object.freeze(["observe_page", "deliver_result"]),
    selectionHints: Object.freeze(["当前页面是什么", "总结页面", "提取页面信息", "阅读网页内容"]),
    prompt: [
      "任务策略：页面阅读",
      "优先使用当前受控页面作为事实来源，先观察页面标题、URL、正文结构和关键可见文本；需要完整正文、全文 HTML 或按 CSS/XPath 抽取局部内容时，优先使用 browser.extract_content。",
      "需要结构化提取时，先确认页面内容范围，再按用户要求输出字段；不要把未观察到的信息当作事实。",
      "如果页面内容不足、被截断或需要登录态以外的信息，明确标注未验证假设和需要补充的证据。",
    ].join("\n"),
  }),
  Object.freeze({
    id: "multi_page_synthesis",
    title: "多页面汇总",
    description: "在多个已打开页面或按需新开页面之间收集信息，汇总差异、共性和证据来源。",
    tags: Object.freeze(["多页面", "汇总", "对比", "资料整合"]),
    source: "builtin",
    defaultEnabled: true,
    risk: "medium",
    recommendedCapabilities: Object.freeze(["observe_page", "operate_page", "deliver_result"]),
    selectionHints: Object.freeze(["比较多个标签页", "汇总这些页面", "打开页面后综合分析", "多来源整理"]),
    prompt: [
      "任务策略：多页面汇总",
      "先使用可用标签页列表确认已有页面，不要跳过用户已经打开的页面直接新开页面。",
      "跨页面收集信息时为每个页面保留标题、URL 和核心证据摘要；需要正文或 HTML 证据时可在对应受控页面使用 browser.extract_content，结论必须能追溯到对应页面。",
      "需要新开页面时只打开普通 http/https 页面；切换页面后旧 UID 失效，继续操作前必须重新观察。",
    ].join("\n"),
  }),
]);

const PLAYBOOK_IDS = new Set(BUILTIN_AUTOMATION_PLAYBOOKS.map((playbook) => playbook.id));

const clonePlaybook = (playbook) => ({
  ...playbook,
  tags: [...playbook.tags],
  recommendedCapabilities: [...playbook.recommendedCapabilities],
  selectionHints: [...playbook.selectionHints],
});

export function getRegisteredAutomationPlaybooks() {
  return BUILTIN_AUTOMATION_PLAYBOOKS.map(clonePlaybook);
}

export function getAutomationPlaybookById(playbookId) {
  const id = typeof playbookId === "string" ? playbookId.trim() : "";
  const playbook = BUILTIN_AUTOMATION_PLAYBOOKS.find((item) => item.id === id);
  return playbook ? clonePlaybook(playbook) : undefined;
}

export function normalizeAutomationPlaybookSettings(value) {
  const rawIds = value && typeof value === "object" && Array.isArray(value.disabledPlaybookIds)
    ? value.disabledPlaybookIds
    : [];
  return {
    disabledPlaybookIds: Array.from(new Set(rawIds.filter((id) => typeof id === "string" && PLAYBOOK_IDS.has(id)))),
  };
}

export function getEnabledAutomationPlaybooks(settings) {
  const normalized = normalizeAutomationPlaybookSettings(settings);
  const disabledIds = new Set(normalized.disabledPlaybookIds);
  return getRegisteredAutomationPlaybooks().filter((playbook) => playbook.defaultEnabled && !disabledIds.has(playbook.id));
}

export function shouldRunAutomationPlaybookSelection(userContent) {
  const text = typeof userContent === "string" ? userContent.trim().toLowerCase() : "";
  if (!text) return false;

  const hasBrowserScene = /当前页面|这个页面|此页面|页面|网页|标签页|浏览器|站点|网站|dom|html|css|xpath/.test(text);
  const hasAutomationIntent = /总结|提取|阅读|查看|看看|分析|比较|汇总|打开|切换|整理|归纳|找/.test(text);
  return hasBrowserScene && hasAutomationIntent;
}

export function createAutomationPlaybookSelectionPrompt(input) {
  const candidates = input.playbooks.map((playbook) => ({
    id: playbook.id,
    title: playbook.title,
    description: playbook.description,
    tags: playbook.tags,
    risk: playbook.risk,
    recommendedCapabilities: playbook.recommendedCapabilities,
  }));

  return [
    {
      role: "system",
      content: [
        "你是浏览器自动化任务策略预选器。只返回 JSON，不要输出 Markdown、解释或额外文本。",
        "你只能从候选 Playbook 中选择一个最适合本次用户需求的策略；如果不需要浏览器自动化策略，playbookId 返回 null。",
        '返回格式必须是：{"playbookId": string | null, "confidence": "low" | "medium" | "high", "reason": string}。',
        "不要请求工具，不要生成最终回答，不要把候选策略全文复制到 reason。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `用户需求：${String(input.userContent ?? "")}`,
        input.pageContextSummary?.trim() ? `页面摘要：\n${input.pageContextSummary.trim()}` : "页面摘要：无",
        `候选 Playbook：\n${JSON.stringify(candidates, null, 2)}`,
      ].join("\n\n"),
    },
  ];
}

export function parseAutomationPlaybookSelectionJson(content) {
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) return undefined;
  const jsonText = extractJsonObjectText(text);
  if (!jsonText) return undefined;
  try {
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== "object" || !Object.prototype.hasOwnProperty.call(parsed, "playbookId")) {
      return undefined;
    }
    if (parsed.playbookId !== null && typeof parsed.playbookId !== "string") {
      return undefined;
    }
    return {
      playbookId: parsed.playbookId,
      confidence: parsed.confidence,
      reason: parsed.reason,
    };
  } catch {
    return undefined;
  }
}

export function normalizeAutomationPlaybookSelection(value, playbooks) {
  if (!value || typeof value !== "object") return undefined;
  const playbookId = typeof value.playbookId === "string" ? value.playbookId.trim() : "";
  const playbook = playbooks.find((item) => item.id === playbookId);
  if (!playbook) return undefined;

  const confidence = value.confidence === "high" || value.confidence === "medium" || value.confidence === "low"
    ? value.confidence
    : "low";
  const reason = typeof value.reason === "string" && value.reason.trim()
    ? value.reason.trim().slice(0, PLAYBOOK_SELECTION_REASON_LIMIT)
    : "模型未提供选择理由";

  return {
    playbookId: playbook.id,
    title: playbook.title,
    source: playbook.source,
    confidence,
    reason,
  };
}

export function createSelectedAutomationPlaybookPrompt(selection) {
  if (!selection) return "";
  const playbook = getAutomationPlaybookById(selection.playbookId);
  if (!playbook) return "";
  return [
    `当前选中的浏览器自动化任务策略：${playbook.title}`,
    `策略来源：${selection.source}`,
    `选择置信度：${selection.confidence}`,
    `选择理由：${selection.reason}`,
    "",
    playbook.prompt,
  ].join("\n");
}

function extractJsonObjectText(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const source = fenced || text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) return "";
  return source.slice(start, end + 1);
}
```

- [x] **Step 5: Run the Playbook test**

Run:

```powershell
node scripts/test_automation_playbooks.mjs
```

Expected:

```text
automation playbooks tests passed
```

- [x] **Step 6: Commit Task 1**

Run:

```powershell
git add -- src/shared/automation-playbooks.mjs scripts/test_automation_playbooks.mjs scripts/run_unit_tests.mjs
git diff --cached --name-status
git commit -m "feat: 增加浏览器任务策略模块"
```

Expected staged files:

```text
A	src/shared/automation-playbooks.mjs
A	scripts/test_automation_playbooks.mjs
M	scripts/run_unit_tests.mjs
```

---

### Task 2: Browser Extract Content Shared Module

**Files:**
- Create: `src/shared/browser-extract-content.mjs`
- Create: `scripts/test_browser_extract_content.mjs`
- Modify: `scripts/run_unit_tests.mjs`

- [x] **Step 1: Write the failing extract-content test**

Create `scripts/test_browser_extract_content.mjs`:

```js
import assert from "node:assert/strict";
import {
  BROWSER_EXTRACT_CONTENT_INPUT_SCHEMA,
  BROWSER_EXTRACT_CONTENT_TOOL_ID,
  BROWSER_EXTRACT_CONTENT_TOOL_NAME,
  createBrowserExtractContentRules,
  formatBrowserExtractContentResult,
  normalizeBrowserExtractContentArguments,
  summarizeBrowserExtractContentResult,
  validateExtractionSelector,
} from "../src/shared/browser-extract-content.mjs";

assert.equal(BROWSER_EXTRACT_CONTENT_TOOL_ID, "browser.extract_content");
assert.equal(BROWSER_EXTRACT_CONTENT_TOOL_NAME, "extract_content");
assert.equal(BROWSER_EXTRACT_CONTENT_INPUT_SCHEMA.properties.mode.enum.includes("html"), true);

assert.deepEqual(normalizeBrowserExtractContentArguments({}), {
  ok: true,
  args: { mode: "text", source: "auto_rule", maxLength: 30000 },
});

assert.match(normalizeBrowserExtractContentArguments({ mode: "markdown" }).message, /mode 必须是 text 或 html/);
assert.match(normalizeBrowserExtractContentArguments({ source: "script" }).message, /source 必须是 auto_rule、document 或 selector/);
assert.match(normalizeBrowserExtractContentArguments({ extra: true }).message, /不接受参数/);
assert.match(normalizeBrowserExtractContentArguments({ source: "document", selector: "main" }).message, /只有 source=selector/);
assert.match(normalizeBrowserExtractContentArguments({ source: "selector", selectorType: "css" }).message, /必须提供非空 selector/);
assert.match(normalizeBrowserExtractContentArguments({ source: "selector", selector: "main" }).message, /必须提供 selectorType/);
assert.match(
  normalizeBrowserExtractContentArguments({ source: "selector", selectorType: "css", selector: "x".repeat(2001) }).message,
  /selector 不能超过 2000/,
);
assert.match(normalizeBrowserExtractContentArguments({ maxLength: 499 }).message, /maxLength 必须是 500 到 200000/);
assert.match(normalizeBrowserExtractContentArguments({ maxLength: 200001 }).message, /maxLength 必须是 500 到 200000/);

const selectorArgs = normalizeBrowserExtractContentArguments({
  mode: "html",
  source: "selector",
  selectorType: "xpath",
  selector: "//main",
  maxLength: 500,
});
assert.equal(selectorArgs.ok, true);
assert.deepEqual(selectorArgs.args, {
  mode: "html",
  source: "selector",
  selectorType: "xpath",
  selector: "//main",
  maxLength: 500,
});

assert.equal(validateExtractionSelector("main.article", "css").ok, true);
assert.equal(validateExtractionSelector("//main", "xpath").ok, true);
assert.equal(validateExtractionSelector("javascript:alert(1)", "css").ok, false);
assert.equal(validateExtractionSelector("javascript:alert(1)", "xpath").ok, false);

const savedRules = [
  { id: "saved", alias: "Saved", urlPattern: ".*", selectorsText: "article", sortOrder: 10, createdAt: 1, updatedAt: 1 },
];
assert.deepEqual(createBrowserExtractContentRules({ source: "auto_rule" }, savedRules), savedRules);
assert.deepEqual(createBrowserExtractContentRules({ source: "document" }, savedRules), []);
assert.deepEqual(
  createBrowserExtractContentRules({ source: "selector", selector: "main" }, savedRules),
  [{ id: "tool-selector", alias: "工具临时选择器", urlPattern: ".*", selectorsText: "main", sortOrder: 0, createdAt: 0, updatedAt: 0 }],
);

const formatted = formatBrowserExtractContentResult(
  {
    ok: true,
    url: "https://example.com/page?token=secret",
    title: "Example",
    text: "A".repeat(80),
    truncated: true,
    usedFallback: false,
    matchedRuleId: "saved",
  },
  { mode: "text", source: "auto_rule", maxLength: 40 },
);
assert.match(formatted, /浏览器内容提取/);
assert.match(formatted, /页面标题：Example/);
assert.match(formatted, /来源：提取规则/);
assert.match(formatted, /内容已截断：是/);
assert.equal(formatted.includes("A".repeat(41)), false);

const summary = summarizeBrowserExtractContentResult(
  {
    ok: true,
    url: "https://example.com/",
    title: "Example",
    text: "Visible text",
    truncated: false,
    usedFallback: true,
    matchedRuleId: "",
  },
  { mode: "text", source: "document", maxLength: 30000 },
);
assert.deepEqual(summary, {
  title: "Example",
  url: "https://example.com/",
  mode: "text",
  source: "document",
  textLength: 12,
  truncated: false,
  usedFallback: true,
  matchedRuleId: "",
  preview: "Visible text",
});

console.log("browser extract content tests passed");
```

- [x] **Step 2: Add the test to the unit runner**

Modify `scripts/run_unit_tests.mjs` by inserting this command immediately after `scripts/test_automation_playbooks.mjs`:

```js
  ["node", ["scripts/test_browser_extract_content.mjs"]],
```

- [x] **Step 3: Run the new test and verify it fails**

Run:

```powershell
node scripts/test_browser_extract_content.mjs
```

Expected: FAIL with `Cannot find module` for `src/shared/browser-extract-content.mjs`.

- [x] **Step 4: Implement `browser-extract-content.mjs`**

Create `src/shared/browser-extract-content.mjs`:

```js
export const BROWSER_EXTRACT_CONTENT_TOOL_ID = "browser.extract_content";
export const BROWSER_EXTRACT_CONTENT_TOOL_NAME = "extract_content";

export const BROWSER_EXTRACT_CONTENT_DEFAULT_MODE = "text";
export const BROWSER_EXTRACT_CONTENT_DEFAULT_SOURCE = "auto_rule";
export const BROWSER_EXTRACT_CONTENT_DEFAULT_MAX_LENGTH = 30000;
export const BROWSER_EXTRACT_CONTENT_MIN_MAX_LENGTH = 500;
export const BROWSER_EXTRACT_CONTENT_MAX_MAX_LENGTH = 200000;
export const BROWSER_EXTRACT_CONTENT_MAX_SELECTOR_LENGTH = 2000;

export const BROWSER_EXTRACT_CONTENT_INPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: Object.freeze({
    mode: Object.freeze({
      type: "string",
      enum: Object.freeze(["text", "html"]),
      description: "提取模式。text 返回可见文本，html 返回完整 HTML 或匹配节点 outerHTML；默认 text。",
    }),
    source: Object.freeze({
      type: "string",
      enum: Object.freeze(["auto_rule", "document", "selector"]),
      description: "提取来源。auto_rule 使用当前提取规则并允许回退，document 提取全文，selector 使用本次提供的 CSS/XPath；默认 auto_rule。",
    }),
    selectorType: Object.freeze({
      type: "string",
      enum: Object.freeze(["css", "xpath"]),
      description: "source=selector 时指定选择器类型。",
    }),
    selector: Object.freeze({
      type: "string",
      description: "source=selector 时提供的 CSS 或 XPath。必须是合法选择器，不接受 JavaScript 表达式。",
    }),
    maxLength: Object.freeze({
      type: "integer",
      minimum: BROWSER_EXTRACT_CONTENT_MIN_MAX_LENGTH,
      maximum: BROWSER_EXTRACT_CONTENT_MAX_MAX_LENGTH,
      description: "最大返回字符数，默认 30000。超出后会截断并标记 truncated。",
    }),
  }),
});

const ALLOWED_KEYS = new Set(["mode", "source", "selectorType", "selector", "maxLength"]);

export function normalizeBrowserExtractContentArguments(value = {}) {
  const sourceObject = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const extraKeys = Object.keys(sourceObject).filter((key) => !ALLOWED_KEYS.has(key));
  if (extraKeys.length > 0) {
    return { ok: false, message: `浏览器内容提取工具不接受参数：${extraKeys.join("、")}。` };
  }

  const mode = sourceObject.mode === undefined ? BROWSER_EXTRACT_CONTENT_DEFAULT_MODE : sourceObject.mode;
  if (mode !== "text" && mode !== "html") {
    return { ok: false, message: "extract_content 的 mode 必须是 text 或 html。" };
  }

  const source = sourceObject.source === undefined ? BROWSER_EXTRACT_CONTENT_DEFAULT_SOURCE : sourceObject.source;
  if (source !== "auto_rule" && source !== "document" && source !== "selector") {
    return { ok: false, message: "extract_content 的 source 必须是 auto_rule、document 或 selector。" };
  }

  const selectorType = sourceObject.selectorType;
  if (selectorType !== undefined && selectorType !== "css" && selectorType !== "xpath") {
    return { ok: false, message: "extract_content 的 selectorType 必须是 css 或 xpath。" };
  }

  const selector = typeof sourceObject.selector === "string" ? sourceObject.selector.trim() : "";
  if (source === "selector") {
    if (!selector) return { ok: false, message: "extract_content 使用 selector 来源时必须提供非空 selector。" };
    if (selectorType === undefined) return { ok: false, message: "extract_content 使用 selector 来源时必须提供 selectorType。" };
    if (selector.length > BROWSER_EXTRACT_CONTENT_MAX_SELECTOR_LENGTH) {
      return { ok: false, message: "extract_content 的 selector 不能超过 2000 个字符。" };
    }
    const selectorValidation = validateExtractionSelector(selector, selectorType);
    if (!selectorValidation.ok) {
      return { ok: false, message: "extract_content 的 selector 格式不正确。" };
    }
  } else if (selectorType !== undefined || selector) {
    return { ok: false, message: "extract_content 只有 source=selector 时才允许携带 selectorType 或 selector。" };
  }

  const maxLength = normalizeExtractContentMaxLength(sourceObject.maxLength);
  if (!maxLength.ok) return maxLength;

  return {
    ok: true,
    args: {
      mode,
      source,
      ...(selectorType ? { selectorType } : {}),
      ...(selector ? { selector } : {}),
      maxLength: maxLength.value,
    },
  };
}

export function validateExtractionSelector(selector, selectorType) {
  const text = typeof selector === "string" ? selector.trim() : "";
  if (!text || /javascript\s*:|<\s*script|on\w+\s*=|`/.test(text.toLowerCase())) {
    return { ok: false };
  }
  if (selectorType === "xpath") {
    return /^(\/|\.\/|\/\/|\.\/\/|\()/.test(text) ? { ok: true } : { ok: false };
  }
  if (selectorType === "css") {
    return /[{};]/.test(text) ? { ok: false } : { ok: true };
  }
  return { ok: false };
}

export function createBrowserExtractContentRules(args, extractionRules = []) {
  if (args.source === "auto_rule") return Array.isArray(extractionRules) ? extractionRules : [];
  if (args.source === "document") return [];
  return [{
    id: "tool-selector",
    alias: "工具临时选择器",
    urlPattern: ".*",
    selectorsText: args.selector ?? "",
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  }];
}

export function formatBrowserExtractContentResult(response, args) {
  const content = truncateText(response?.text ?? "", args.maxLength);
  const summary = summarizeBrowserExtractContentResult(response, args);
  return [
    "浏览器内容提取：",
    `页面标题：${summary.title || "无标题"}`,
    `页面 URL：${summary.url || "未知"}`,
    `来源：${sourceLabel(args)}`,
    `模式：${args.mode === "html" ? "HTML" : "可见文本"}`,
    `字符数：${summary.textLength}`,
    `内容已截断：${summary.truncated || content.truncated ? "是" : "否"}`,
    `使用回退：${summary.usedFallback ? "是" : "否"}`,
    summary.matchedRuleId ? `匹配规则：${summary.matchedRuleId}` : "",
    "",
    content.text,
  ].filter(Boolean).join("\n");
}

export function summarizeBrowserExtractContentResult(response, args) {
  const text = String(response?.text ?? "");
  return {
    title: normalizeText(response?.title),
    url: normalizeText(response?.url),
    mode: args.mode,
    source: args.source,
    textLength: text.length,
    truncated: response?.truncated === true,
    usedFallback: response?.usedFallback === true,
    matchedRuleId: normalizeText(response?.matchedRuleId),
    preview: truncateText(text.replace(/\s+/g, " ").trim(), 500).text,
  };
}

function normalizeExtractContentMaxLength(value) {
  if (value === undefined) return { ok: true, value: BROWSER_EXTRACT_CONTENT_DEFAULT_MAX_LENGTH };
  if (!Number.isInteger(value) || value < BROWSER_EXTRACT_CONTENT_MIN_MAX_LENGTH || value > BROWSER_EXTRACT_CONTENT_MAX_MAX_LENGTH) {
    return { ok: false, message: "extract_content 的 maxLength 必须是 500 到 200000 的整数。" };
  }
  return { ok: true, value };
}

function sourceLabel(args) {
  if (args.source === "selector") return args.selectorType === "xpath" ? "XPath 选择器" : "CSS 选择器";
  if (args.source === "document") return "全文";
  return "提取规则";
}

function truncateText(value, maxLength) {
  const text = String(value ?? "");
  if (text.length <= maxLength) return { text, truncated: false };
  return { text: `${text.slice(0, maxLength)}\n\n[内容过长，已截断。]`, truncated: true };
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}
```

- [x] **Step 5: Run the extract-content test**

Run:

```powershell
node scripts/test_browser_extract_content.mjs
```

Expected:

```text
browser extract content tests passed
```

- [x] **Step 6: Commit Task 2**

Run:

```powershell
git add -- src/shared/browser-extract-content.mjs scripts/test_browser_extract_content.mjs scripts/run_unit_tests.mjs
git diff --cached --name-status
git commit -m "feat: 增加浏览器内容提取工具模型"
```

Expected staged files:

```text
A	src/shared/browser-extract-content.mjs
A	scripts/test_browser_extract_content.mjs
M	scripts/run_unit_tests.mjs
```

---

### Task 3: Browser Control Contract Wiring

**Files:**
- Modify: `src/shared/browser-control-contract.mjs`
- Modify: `scripts/test_browser_control_queue.mjs`

- [x] **Step 1: Add contract tests for `browser.extract_content`**

In `scripts/test_browser_control_queue.mjs`, add these assertions after the existing `new_page` assertions and before `list_pages`:

```js
assert.equal(resolveBrowserControlAction("browser.extract_content"), BROWSER_CONTROL_ACTIONS.EXTRACT_CONTENT);
assert.equal(resolveBrowserControlAction("extract_content"), BROWSER_CONTROL_ACTIONS.EXTRACT_CONTENT);
assert.equal(resolveBrowserControlToolId("extract_content"), "browser.extract_content");
const extractDefinition = BROWSER_CONTROL_TOOL_DEFINITIONS.find((tool) => tool.id === "browser.extract_content");
assert.ok(extractDefinition);
assert.equal(extractDefinition.name, "extract_content");
assert.equal(extractDefinition.inputSchema.properties.maxLength.maximum, 200000);
assert.equal(validateBrowserControlRequest({ name: "extract_content", arguments: {} }).ok, true);
assert.equal(
  validateBrowserControlRequest({
    name: "extract_content",
    arguments: { mode: "html", source: "selector", selectorType: "css", selector: "main", maxLength: 500 },
  }).ok,
  true,
);
assert.match(validateBrowserControlRequest({ name: "extract_content", arguments: { mode: "markdown" } }).message, /mode 必须是 text 或 html/);
assert.match(validateBrowserControlRequest({ name: "extract_content", arguments: { source: "selector", selector: "main" } }).message, /selectorType/);
assert.match(validateBrowserControlRequest({ name: "extract_content", arguments: { source: "document", selector: "main" } }).message, /只有 source=selector/);
```

- [x] **Step 2: Run the browser-control test and verify it fails**

Run:

```powershell
node scripts/test_browser_control_queue.mjs
```

Expected: FAIL because `BROWSER_CONTROL_ACTIONS.EXTRACT_CONTENT` is undefined.

- [x] **Step 3: Import extract-content schema and validator**

At the top of `src/shared/browser-control-contract.mjs`, add:

```js
import {
  BROWSER_EXTRACT_CONTENT_INPUT_SCHEMA,
  BROWSER_EXTRACT_CONTENT_TOOL_ID,
  BROWSER_EXTRACT_CONTENT_TOOL_NAME,
  normalizeBrowserExtractContentArguments,
} from "./browser-extract-content.mjs";
```

- [x] **Step 4: Add action, tool id, schema, and validation branch**

In `src/shared/browser-control-contract.mjs`, make these changes:

Add to `BROWSER_CONTROL_ACTIONS`:

```js
  EXTRACT_CONTENT: BROWSER_EXTRACT_CONTENT_TOOL_NAME,
```

Add to `BROWSER_CONTROL_TOOL_IDS`:

```js
  EXTRACT_CONTENT: BROWSER_EXTRACT_CONTENT_TOOL_ID,
```

Add to `ACTION_TO_TOOL_ID`:

```js
  [BROWSER_CONTROL_ACTIONS.EXTRACT_CONTENT]: BROWSER_CONTROL_TOOL_IDS.EXTRACT_CONTENT,
```

Add to `BROWSER_CONTROL_ACTION_SCHEMAS` after `TAKE_SNAPSHOT`:

```js
  [BROWSER_CONTROL_ACTIONS.EXTRACT_CONTENT]: BROWSER_EXTRACT_CONTENT_INPUT_SCHEMA,
```

In `validateBrowserControlRequest()`, add this branch immediately after the extra-argument check:

```js
  if (request.name === BROWSER_CONTROL_ACTIONS.EXTRACT_CONTENT) {
    const validation = normalizeBrowserExtractContentArguments(args);
    if (!validation.ok) {
      return { ok: false, request, message: validation.message };
    }
    return { ok: true, request: { ...request, arguments: validation.args } };
  }
```

- [x] **Step 5: Run the browser-control test**

Run:

```powershell
node scripts/test_browser_control_queue.mjs
```

Expected:

```text
browser control queue tests passed
```

- [x] **Step 6: Commit Task 3**

Run:

```powershell
git add -- src/shared/browser-control-contract.mjs scripts/test_browser_control_queue.mjs
git diff --cached --name-status
git commit -m "feat: 注册浏览器内容提取控制工具"
```

Expected staged files:

```text
M	src/shared/browser-control-contract.mjs
M	scripts/test_browser_control_queue.mjs
```

---

### Task 4: Background Tool Runtime and Playbook Wiring

**Files:**
- Create: `src/ai-assistant/background/browser-extract-content-service.js`
- Modify: `src/ai-assistant/background/index.js`
- Modify: `scripts/test_background_agent_tools_wiring.mjs`

- [x] **Step 1: Add source assertions for Phase 2 background wiring**

In `scripts/test_background_agent_tools_wiring.mjs`, add a read near the other source reads:

```js
const browserExtractContentServiceSource = await readFile(
  new URL("../src/ai-assistant/background/browser-extract-content-service.js", import.meta.url),
  "utf8",
);
```

Add this parse check after the existing `assertValidEsm(backgroundSource, "assistant background");` line:

```js
assertValidEsm(browserExtractContentServiceSource, "browser extract content service");
```

Add these assertions before the final `console.log`:

```js
assert.match(
  backgroundSource,
  /browser-extract-content-service\.js/,
  "background must import the source-owned extract_content service",
);

assert.match(
  backgroundSource,
  /executeBrowserExtractContentTool/,
  "background must execute browser.extract_content through the source-owned service",
);

assert.match(
  backgroundSource,
  /automation-playbooks\.mjs/,
  "background must import the Phase 2 Playbook helpers",
);

assert.match(
  backgroundSource,
  /shouldRunAutomationPlaybookSelection/,
  "background must gate Playbook selection with the local heuristic",
);

assert.match(
  backgroundSource,
  /createAutomationPlaybookSelectionPrompt/,
  "background must build a model-facing Playbook selection prompt",
);

assert.match(
  backgroundSource,
  /createSelectedAutomationPlaybookPrompt/,
  "background must inject selected Playbook prompt text",
);

assert.match(
  backgroundSource,
  /browser\.extract_content|extract_content/,
  "background must expose and dispatch browser.extract_content",
);

assert.match(
  backgroundSource,
  /不执行自定义脚本，不读取 Cookie、Storage 或跨域 iframe/,
  "browser prompt must include extract_content read-only safety boundaries",
);

assert.match(
  backgroundSource,
  /r\.id===`browser\.extract_content`|browser\.extract_content`\)&&/,
  "extract_content must be dispatched before the generic browser.* branch",
);

assert.match(
  browserExtractContentServiceSource,
  /createBrowserExtractContentRules/,
  "extract content service must build temporary selector rules",
);

assert.match(
  browserExtractContentServiceSource,
  /formatBrowserExtractContentResult/,
  "extract content service must format tool output through the shared formatter",
);
```

- [x] **Step 2: Run the wiring test and verify it fails**

Run:

```powershell
node scripts/test_background_agent_tools_wiring.mjs
```

Expected: FAIL because `browser-extract-content-service.js` does not exist.

- [x] **Step 3: Create `browser-extract-content-service.js`**

Create `src/ai-assistant/background/browser-extract-content-service.js`:

```js
import {
  createBrowserExtractContentRules,
  formatBrowserExtractContentResult,
  normalizeBrowserExtractContentArguments,
  summarizeBrowserExtractContentResult,
} from "../../shared/browser-extract-content.mjs";

export async function executeBrowserExtractContentTool(toolCall, options = {}) {
  const validation = normalizeBrowserExtractContentArguments(toolCall?.arguments ?? {});
  if (!validation.ok) {
    return createToolError(toolCall, validation.message, "invalid_arguments");
  }

  const args = validation.args;
  const extractionRulesProvider = typeof options.extractionRulesProvider === "function"
    ? options.extractionRulesProvider
    : async () => [];
  const extractPageContext = options.extractPageContext;
  if (typeof extractPageContext !== "function") {
    return createToolError(toolCall, "浏览器内容提取服务未初始化。", "extract_content_unavailable");
  }

  try {
    const savedRules = args.source === "auto_rule" ? await extractionRulesProvider() : [];
    const response = await extractPageContext({
      type: "pageContext.extract",
      tabId: options.tabId,
      rules: createBrowserExtractContentRules(args, savedRules),
      maxLength: args.maxLength,
      extractMode: args.mode === "html" ? "all" : "text",
    });
    if (!response?.ok) {
      return createToolError(toolCall, response?.message || "浏览器内容提取失败。", "extract_content_failed");
    }
    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: formatBrowserExtractContentResult(response, args),
      summary: summarizeBrowserExtractContentResult(response, args),
    };
  } catch (error) {
    return createToolError(
      toolCall,
      error instanceof Error && error.message ? error.message : "浏览器内容提取失败。",
      "extract_content_failed",
    );
  }
}

function createToolError(toolCall, message, code) {
  return {
    toolCallId: toolCall?.id || "",
    name: toolCall?.name || "extract_content",
    content: message,
    isError: true,
    code,
  };
}
```

- [x] **Step 4: Import Phase 2 modules in the assistant background**

Modify the first import line in `src/ai-assistant/background/index.js` so the asset import also includes the extraction-rule reader:

```js
ft as readExtractionRules
```

The import line should continue to import all existing names. Only add the new alias from `../assets/tabCapture-CF6ZxIgy.js`; do not remove existing aliases.

Add these imports after the existing source-owned imports:

```js
import { executeBrowserExtractContentTool } from "./browser-extract-content-service.js";
import {
  createAutomationPlaybookSelectionPrompt,
  createSelectedAutomationPlaybookPrompt,
  getEnabledAutomationPlaybooks,
  normalizeAutomationPlaybookSelection,
  parseAutomationPlaybookSelectionJson,
  shouldRunAutomationPlaybookSelection,
} from "../../shared/automation-playbooks.mjs";
```

- [x] **Step 5: Add the extract-content executor helper**

In `src/ai-assistant/background/index.js`, insert this helper after `var D=new qe,BCQ=new BCQueue;`:

```js
async function executeBrowserExtractContentFromBackground(toolCall) {
  return executeBrowserExtractContentTool(toolCall, {
    tabId: D.connection?.attachedTabId,
    extractionRulesProvider: readExtractionRules,
    extractPageContext: Tn,
  });
}
```

- [x] **Step 6: Dispatch `browser.extract_content` before the generic browser branch**

In the `_t(e,t)` tool dispatch function in `src/ai-assistant/background/index.js`, update the branch order so `browser.extract_content` is handled before `r.id.startsWith(\`browser.\`)`.

The dispatch sequence must include this branch:

```js
r.id===`browser.extract_content`&&r.name===`extract_content`?BCQ.enqueue(n,()=>executeBrowserExtractContentFromBackground(n)):
```

The surrounding order must remain:

```js
r.id===`browser.take_snapshot`&&r.name===`take_snapshot`?BCQ.enqueue(n,()=>D.takeSnapshot(n)):
r.id===`browser.extract_content`&&r.name===`extract_content`?BCQ.enqueue(n,()=>executeBrowserExtractContentFromBackground(n)):
r.id.startsWith(`browser.`)?BCQ.enqueue(n,()=>D.executeBrowserTool(n)):
```

- [x] **Step 7: Add `extract_content` prompt rules**

In the `vt(e,t)` browser prompt injection function in `src/ai-assistant/background/index.js`, add these two lines after the existing `take_snapshot` rule:

```js
`- 需要读取当前页面正文、全文 HTML，或按发送前提取规则、CSS、XPath 提取局部 HTML/文本时，调用 extract_content。`,
`- extract_content 只读，不执行自定义脚本，不读取 Cookie、Storage 或跨域 iframe。`,
```

- [x] **Step 8: Add Playbook preselection helpers**

In `src/ai-assistant/background/index.js`, insert these helpers near the existing chat helper functions `mt`, `ht`, and `gt`:

```js
function getLatestUserContentForPlaybook(message) {
  const userMessages = Array.isArray(message?.messages) ? message.messages.filter((item) => item?.role === `user`) : [];
  const latest = userMessages[userMessages.length - 1];
  return typeof latest?.content === `string` ? latest.content : "";
}

function getPageContextSummaryForPlaybook(message) {
  const context = Array.isArray(message?.messages)
    ? message.messages.find((item) => item?.role === `system` && typeof item.content === `string` && item.content.includes(`当前页面上下文`))
    : undefined;
  return typeof context?.content === `string` ? context.content.slice(0, 4000) : "";
}

async function maybeSelectAutomationPlaybookForChat(message, fetcher, options = {}) {
  if (options.skipAutomationPlaybookSelection === true || message?.structuredOutput) return undefined;
  const userContent = getLatestUserContentForPlaybook(message);
  if (!shouldRunAutomationPlaybookSelection(userContent)) return undefined;

  const exposedTools = Array.isArray(options.exposedTools) ? options.exposedTools : [];
  if (!exposedTools.some((tool) => typeof tool?.id === `string` && tool.id.startsWith(`browser.`))) return undefined;

  const playbooks = getEnabledAutomationPlaybooks(message?.automationPlaybookSettings);
  if (playbooks.length === 0) return undefined;

  const selectionMessages = createAutomationPlaybookSelectionPrompt({
    userContent,
    pageContextSummary: getPageContextSummaryForPlaybook(message),
    playbooks,
  });

  try {
    const selectionResponse = await Zt(
      {
        ...message,
        messages: selectionMessages,
        stream: false,
        structuredOutput: undefined,
        toolCallingEnabled: false,
        enabledToolIds: [],
      },
      fetcher,
      { ...options, skipAutomationPlaybookSelection: true, exposedTools: [] },
    );
    if (!selectionResponse?.ok) return undefined;
    const parsed = parseAutomationPlaybookSelectionJson(selectionResponse.content || "");
    if (!parsed || parsed.playbookId === null) return undefined;
    return normalizeAutomationPlaybookSelection(parsed, playbooks);
  } catch (error) {
    console.warn("[automation-playbook] 已跳过任务策略预选：", {
      reason: error instanceof Error && error.message ? error.message : "预选请求异常",
    });
    return undefined;
  }
}
```

- [x] **Step 9: Inject selected Playbook prompt into the main chat**

In the main chat function `Zt(e,t=fetch,n={})`, locate where `agentToolsDefinitionsForChat(e,n)` is called and where `vt(messages, exposedTools)` injects browser-control prompt rules.

Add the selection before the final system prompt is sent to the model:

```js
const automationPlaybookSelection = await maybeSelectAutomationPlaybookForChat(e, t, {
  ...n,
  exposedTools,
});
const selectedAutomationPlaybookPrompt = createSelectedAutomationPlaybookPrompt(automationPlaybookSelection);
```

Then append the selected prompt to the browser-control prompt text after `vt(...)` has run:

```js
messages = selectedAutomationPlaybookPrompt
  ? appendAutomationPlaybookPrompt(messages, selectedAutomationPlaybookPrompt)
  : messages;
```

Add this helper near `maybeSelectAutomationPlaybookForChat()`:

```js
function appendAutomationPlaybookPrompt(messages, prompt) {
  if (!prompt) return messages;
  const systemIndex = messages.findIndex((item) => item.role === `system`);
  if (systemIndex < 0) {
    return [{ role: `system`, content: prompt }, ...messages];
  }
  return messages.map((item, index) =>
    index === systemIndex ? { ...item, content: `${item.content}\n\n${prompt}`.trim() } : item,
  );
}
```

Preserve existing tool-call behavior. The selection request must run with `skipAutomationPlaybookSelection: true` to prevent recursive selection.

- [x] **Step 10: Run focused syntax and wiring tests**

Run:

```powershell
node --check .\src\ai-assistant\background\browser-extract-content-service.js
node --check .\src\ai-assistant\background\index.js
node scripts/test_background_agent_tools_wiring.mjs
```

Expected:

```text
background agent tools wiring tests passed
```

- [ ] **Step 11: Commit Task 4**

2026-07-05 note: implementation and verification are complete, but this commit is intentionally deferred. `src/ai-assistant/background/index.js` is a single-line bundled file and currently mixes Phase 2 wiring with pre-existing unrelated background changes, so staging it as a clean Phase 2-only commit is not safe.

Run:

```powershell
git add -- src/ai-assistant/background/browser-extract-content-service.js src/ai-assistant/background/index.js scripts/test_background_agent_tools_wiring.mjs
git diff --cached --name-status
git commit -m "feat: 接入 Playbook 和浏览器内容提取工具"
```

Expected staged files:

```text
A	src/ai-assistant/background/browser-extract-content-service.js
M	src/ai-assistant/background/index.js
M	scripts/test_background_agent_tools_wiring.mjs
```

---

### Task 5: Documentation and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md`

- [x] **Step 1: Update README with Phase 2 behavior**

In `README.md`, update the AI sidebar tools section to include:

```markdown
### Phase 2：任务策略和页面内容提取

AI 侧边栏在浏览器控制和工具调用开启后，会对“总结当前页面”“提取页面信息”“比较多个标签页”等请求进行任务策略预选。当前内置策略包括：

- 页面阅读：优先使用当前受控页面作为事实来源，必要时调用 `browser.extract_content` 读取正文、HTML 或选择器内容。
- 多页面汇总：先列出已打开页面，再逐页收集标题、URL 和证据摘要，必要时在对应页面调用 `browser.extract_content`。

`browser.extract_content` 是只读工具，不执行模型提供的脚本，不读取 Cookie、Storage 或跨域 iframe。工具结果会按长度限制截断，审计日志只记录摘要。
```

- [x] **Step 2: Update the architecture document**

In `docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md`, add or update a section with:

```markdown
## Phase 2：Playbook 与 browser.extract_content

`src/shared/automation-playbooks.mjs` 保存 Phase 2 的内置任务策略、设置归一化、选择触发启发式和选中策略 prompt。当前只启用 `page_reading` 和 `multi_page_synthesis`，不包含表单提交、Network/API、Runtime、Replay 或 Full Access 策略。

`src/shared/browser-extract-content.mjs` 定义 `browser.extract_content` 的工具 ID、模型函数名、参数 schema、选择器约束和结果格式化。该工具只读，复用现有 `pageContext.extract` 内容脚本路径，不执行模型自定义脚本，不读取 Cookie、Storage 或跨域 iframe。

后台通过 `src/ai-assistant/background/browser-extract-content-service.js` 把模型工具调用转换成 `pageContext.extract` 请求。审计日志记录工具参数和结果摘要，不保存完整页面正文或 HTML 原文。
```

- [x] **Step 3: Run focused tests**

Run:

```powershell
node scripts/test_automation_playbooks.mjs
node scripts/test_browser_extract_content.mjs
node scripts/test_browser_control_queue.mjs
node scripts/test_background_agent_tools_wiring.mjs
```

Expected final lines:

```text
automation playbooks tests passed
browser extract content tests passed
browser control queue tests passed
background agent tools wiring tests passed
```

- [x] **Step 4: Run full unit suite**

Run:

```powershell
npm test
```

Expected final line:

```text
unit tests passed
```

- [x] **Step 5: Run AI sidebar smoke verification**

Run:

```powershell
python scripts\verify_ai_sidebar_core.py
```

Expected: the JSON result reports `"ok": true`. If the browser environment fails before extension verification, capture the exact error and include it in the final implementation report.

- [ ] **Step 6: Commit documentation**

2026-07-05 note: documentation updates are complete and verified. The commit is deferred for the same dirty-worktree boundary reason; README and architecture docs already contain pre-existing Phase 1 / MCP edits mixed with the new Phase 2 paragraphs.

Run:

```powershell
git add -- README.md docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md
git diff --cached --name-status
git commit -m "docs: 更新 Phase 2 浏览器任务策略说明"
```

Expected staged files:

```text
M	README.md
M	docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md
```

- [x] **Step 7: Final status check**

Run:

```powershell
git status --short
git log --oneline -6
```

Expected: no staged files. Existing unrelated dirty files may remain because the worktree was dirty before Phase 2 execution.

## Self-Review Checklist

- Spec coverage:
  - Playbook module: Task 1.
  - `page_reading` and `multi_page_synthesis`: Task 1.
  - Playbook model-selection prompt and injection: Task 4.
  - `browser.extract_content` constants, schema, validation, formatter: Task 2.
  - Browser-control tool registration and validation: Task 3.
  - Background execution through existing `pageContext.extract`: Task 4.
  - Audit path: Task 4 keeps dispatch inside `agentToolsExecuteWithAudit`.
  - Documentation: Task 5.

- Non-goals:
  - No Network recorder, JS, Source Map, Runtime, Replay, Full Access, React/Vite rewrite, or form-interaction Playbook tasks appear in this plan.

- Verification:
  - New tests are wired into `scripts/run_unit_tests.mjs`.
  - Focused tests cover pure modules, browser-control contract, and source wiring.
  - Full verification uses `npm test` and `python scripts\verify_ai_sidebar_core.py`.

- Commit strategy:
  - Every task has a Chinese commit message.
  - Every commit stages only files listed in the task.
