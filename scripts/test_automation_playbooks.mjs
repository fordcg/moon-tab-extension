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
assert.equal(shouldRunAutomationPlaybookSelection("提取当前页面里 .price 的文本"), true);
assert.equal(shouldRunAutomationPlaybookSelection("帮我找几个学习网站"), false);
assert.equal(shouldRunAutomationPlaybookSelection("分析一下企业网站设计趋势"), false);
assert.equal(shouldRunAutomationPlaybookSelection("分析一下 CSS Grid 布局"), false);
assert.equal(shouldRunAutomationPlaybookSelection("分析一下浏览器标签页的设计趋势"), false);
assert.equal(shouldRunAutomationPlaybookSelection("分析一下网页内容运营方法"), false);
assert.equal(shouldRunAutomationPlaybookSelection("比较网页内容和传统媒体内容"), false);
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
