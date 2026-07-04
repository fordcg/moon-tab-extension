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
assert.equal(BROWSER_EXTRACT_CONTENT_INPUT_SCHEMA.additionalProperties, false);
assert.deepEqual(BROWSER_EXTRACT_CONTENT_INPUT_SCHEMA.properties.mode.enum, ["text", "html"]);
assert.deepEqual(BROWSER_EXTRACT_CONTENT_INPUT_SCHEMA.properties.source.enum, ["auto_rule", "document", "selector"]);
assert.deepEqual(BROWSER_EXTRACT_CONTENT_INPUT_SCHEMA.properties.selectorType.enum, ["css", "xpath"]);
assert.equal(BROWSER_EXTRACT_CONTENT_INPUT_SCHEMA.properties.maxLength.minimum, 500);
assert.equal(BROWSER_EXTRACT_CONTENT_INPUT_SCHEMA.properties.maxLength.maximum, 200000);

assert.deepEqual(normalizeBrowserExtractContentArguments({}), {
  ok: true,
  args: { mode: "text", source: "auto_rule", maxLength: 30000 },
});

assert.deepEqual(normalizeBrowserExtractContentArguments(), {
  ok: true,
  args: { mode: "text", source: "auto_rule", maxLength: 30000 },
});
assert.match(normalizeBrowserExtractContentArguments(null).message, /参数必须是对象/);
assert.match(normalizeBrowserExtractContentArguments([]).message, /参数必须是对象/);
assert.match(normalizeBrowserExtractContentArguments("x").message, /参数必须是对象/);
assert.match(normalizeBrowserExtractContentArguments(1).message, /参数必须是对象/);
assert.match(normalizeBrowserExtractContentArguments(true).message, /参数必须是对象/);
assert.match(normalizeBrowserExtractContentArguments({ mode: "markdown" }).message, /mode 必须是 text 或 html/);
assert.match(normalizeBrowserExtractContentArguments({ source: "script" }).message, /source 必须是 auto_rule、document 或 selector/);
assert.match(normalizeBrowserExtractContentArguments({ extra: true }).message, /不接受参数/);
assert.match(normalizeBrowserExtractContentArguments({ source: "document", selector: "main" }).message, /只有 source=selector/);
assert.match(normalizeBrowserExtractContentArguments({ source: "document", selector: "" }).message, /只有 source=selector/);
assert.match(normalizeBrowserExtractContentArguments({ source: "auto_rule", selectorType: "css" }).message, /只有 source=selector/);
assert.match(normalizeBrowserExtractContentArguments({ source: "selector", selectorType: "css" }).message, /必须提供非空 selector/);
assert.match(normalizeBrowserExtractContentArguments({ source: "selector", selector: "main" }).message, /必须提供 selectorType/);
assert.match(normalizeBrowserExtractContentArguments({ source: "selector", selectorType: "id", selector: "main" }).message, /selectorType 必须是 css 或 xpath/);
assert.match(
  normalizeBrowserExtractContentArguments({ source: "selector", selectorType: "css", selector: "x".repeat(2001) }).message,
  /selector 不能超过 2000/,
);
assert.match(normalizeBrowserExtractContentArguments({ source: "selector", selectorType: "css", selector: "javascript:alert(1)" }).message, /selector 格式不正确/);
assert.match(normalizeBrowserExtractContentArguments({ maxLength: 499 }).message, /maxLength 必须是 500 到 200000/);
assert.match(normalizeBrowserExtractContentArguments({ maxLength: 200001 }).message, /maxLength 必须是 500 到 200000/);
assert.match(normalizeBrowserExtractContentArguments({ maxLength: 500.5 }).message, /maxLength 必须是 500 到 200000/);
assert.match(normalizeBrowserExtractContentArguments({ maxLength: Number.POSITIVE_INFINITY }).message, /maxLength 必须是 500 到 200000/);

const selectorArgs = normalizeBrowserExtractContentArguments({
  mode: "html",
  source: "selector",
  selectorType: "xpath",
  selector: "  //main  ",
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
assert.equal(validateExtractionSelector('[data-id="x"]', "css").ok, true);
assert.equal(validateExtractionSelector("//main", "xpath").ok, true);
assert.equal(validateExtractionSelector('//*[@id="main"]', "xpath").ok, true);
assert.equal(validateExtractionSelector("javascript:alert(1)", "css").ok, false);
assert.equal(validateExtractionSelector("javascript:alert(1)", "xpath").ok, false);
assert.equal(validateExtractionSelector("main { color: red }", "css").ok, false);
assert.equal(validateExtractionSelector(">>>", "css").ok, false);
assert.equal(validateExtractionSelector("[", "css").ok, false);
assert.equal(validateExtractionSelector(":not(", "css").ok, false);
assert.equal(validateExtractionSelector("//*[", "xpath").ok, false);
assert.equal(validateExtractionSelector("main", "xpath").ok, false);

const savedRules = [
  { id: "saved", alias: "Saved", urlPattern: ".*", selectorsText: "article", sortOrder: 10, createdAt: 1, updatedAt: 1 },
];
assert.strictEqual(createBrowserExtractContentRules({ source: "auto_rule" }, savedRules), savedRules);
assert.deepEqual(createBrowserExtractContentRules({ source: "document" }, savedRules), []);

const selectorRules = createBrowserExtractContentRules(
  { source: "selector", selectorType: "css", selector: "main" },
  savedRules,
);
assert.equal(selectorRules.length, 1);
assert.equal(selectorRules[0].id, "browser-extract-content-temporary-selector");
assert.equal(selectorRules[0].alias, "browser.extract_content 临时选择器");
assert.equal(selectorRules[0].urlPattern, ".*");
assert.equal(selectorRules[0].selector, "main");
assert.equal(selectorRules[0].selectorType, "css");
assert.equal(selectorRules[0].selectorsText, "main");
assert.equal(selectorRules[0].sortOrder, 0);

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
assert.match(formatted, /页面 URL：https:\/\/example\.com\/page\?token=secret/);
assert.match(formatted, /来源：提取规则/);
assert.match(formatted, /模式：可见文本/);
assert.match(formatted, /匹配规则：saved/);
assert.match(formatted, /内容已截断：是/);
assert.match(formatted, /使用回退：否/);
assert.match(formatted, /\[内容过长，已按 maxLength 截断。\]/);
assert.equal(formatted.includes("A".repeat(41)), false);

const formattedHtml = formatBrowserExtractContentResult(
  {
    ok: true,
    url: "https://example.com/",
    title: "HTML Example",
    text: "Visible fallback",
    html: "<main><h1>HTML body</h1></main>",
    truncated: false,
    usedFallback: true,
    matchedRuleId: "",
  },
  { mode: "html", source: "selector", selectorType: "xpath", maxLength: 500 },
);
assert.match(formattedHtml, /来源：XPath 选择器/);
assert.match(formattedHtml, /模式：HTML/);
assert.match(formattedHtml, /<main><h1>HTML body<\/h1><\/main>/);
assert.doesNotMatch(formattedHtml, /Visible fallback/);

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
  length: 12,
  textLength: 12,
  truncated: false,
  usedFallback: true,
  matchedRuleId: "",
  preview: "Visible text",
});

const longHtmlSummary = summarizeBrowserExtractContentResult(
  {
    ok: true,
    url: "https://example.com/html",
    title: "HTML",
    html: `<article>${"B".repeat(1000)}</article>`,
    truncated: false,
    usedFallback: false,
    matchedRuleId: "browser-extract-content-temporary-selector",
  },
  { mode: "html", source: "selector", selectorType: "css", maxLength: 500 },
);
assert.equal(longHtmlSummary.length, 1019);
assert.equal(longHtmlSummary.truncated, true);
assert.equal(longHtmlSummary.preview.length <= 303, true);
assert.equal(longHtmlSummary.preview.includes("B".repeat(500)), false);
assert.equal(Object.prototype.hasOwnProperty.call(longHtmlSummary, "html"), false);
assert.equal(Object.prototype.hasOwnProperty.call(longHtmlSummary, "content"), false);

console.log("browser extract content tests passed");
