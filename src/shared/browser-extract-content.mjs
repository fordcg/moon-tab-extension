export const BROWSER_EXTRACT_CONTENT_TOOL_ID = "browser.extract_content";
export const BROWSER_EXTRACT_CONTENT_TOOL_NAME = "extract_content";

export const BROWSER_EXTRACT_CONTENT_DEFAULT_MODE = "text";
export const BROWSER_EXTRACT_CONTENT_DEFAULT_SOURCE = "auto_rule";
export const BROWSER_EXTRACT_CONTENT_DEFAULT_MAX_LENGTH = 30000;
export const BROWSER_EXTRACT_CONTENT_MIN_MAX_LENGTH = 500;
export const BROWSER_EXTRACT_CONTENT_MAX_MAX_LENGTH = 200000;
export const BROWSER_EXTRACT_CONTENT_MAX_SELECTOR_LENGTH = 2000;

const TRUNCATION_MARKER = "\n\n[内容过长，已按 maxLength 截断。]";
const SUMMARY_PREVIEW_LENGTH = 300;
const ALLOWED_KEYS = new Set(["mode", "source", "selectorType", "selector", "maxLength"]);

export const BROWSER_EXTRACT_CONTENT_INPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: Object.freeze({
    mode: Object.freeze({
      type: "string",
      enum: Object.freeze(["text", "html"]),
      description: "提取模式。text 返回可见文本，html 返回文档 HTML 或匹配节点 HTML；默认 text。",
    }),
    source: Object.freeze({
      type: "string",
      enum: Object.freeze(["auto_rule", "document", "selector"]),
      description: "提取来源。auto_rule 使用当前提取规则，document 读取全文，selector 使用本次 CSS/XPath；默认 auto_rule。",
    }),
    selectorType: Object.freeze({
      type: "string",
      enum: Object.freeze(["css", "xpath"]),
      description: "source=selector 时指定选择器类型。",
    }),
    selector: Object.freeze({
      type: "string",
      maxLength: BROWSER_EXTRACT_CONTENT_MAX_SELECTOR_LENGTH,
      description: "source=selector 时提供的 CSS 或 XPath 选择器，不接受 JavaScript 表达式。",
    }),
    maxLength: Object.freeze({
      type: "integer",
      minimum: BROWSER_EXTRACT_CONTENT_MIN_MAX_LENGTH,
      maximum: BROWSER_EXTRACT_CONTENT_MAX_MAX_LENGTH,
      description: "最大返回字符数，默认 30000。",
    }),
  }),
});

export function normalizeBrowserExtractContentArguments(value = {}) {
  const sourceObject = isPlainObject(value) ? value : {};
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

  const hasSelectorType = Object.prototype.hasOwnProperty.call(sourceObject, "selectorType");
  const hasSelector = Object.prototype.hasOwnProperty.call(sourceObject, "selector");
  if (source !== "selector" && (hasSelectorType || hasSelector)) {
    return { ok: false, message: "extract_content 只有 source=selector 时才允许携带 selectorType 或 selector。" };
  }

  const maxLength = normalizeExtractContentMaxLength(sourceObject.maxLength);
  if (!maxLength.ok) return maxLength;

  if (source !== "selector") {
    return {
      ok: true,
      args: { mode, source, maxLength: maxLength.value },
    };
  }

  const selectorType = sourceObject.selectorType;
  if (selectorType === undefined) {
    return { ok: false, message: "extract_content 使用 selector 来源时必须提供 selectorType。" };
  }
  if (selectorType !== "css" && selectorType !== "xpath") {
    return { ok: false, message: "extract_content 的 selectorType 必须是 css 或 xpath。" };
  }

  const selector = typeof sourceObject.selector === "string" ? sourceObject.selector.trim() : "";
  if (!selector) {
    return { ok: false, message: "extract_content 使用 selector 来源时必须提供非空 selector。" };
  }
  if (selector.length > BROWSER_EXTRACT_CONTENT_MAX_SELECTOR_LENGTH) {
    return { ok: false, message: "extract_content 的 selector 不能超过 2000 个字符。" };
  }

  const selectorValidation = validateExtractionSelector(selector, selectorType);
  if (!selectorValidation.ok) {
    return { ok: false, message: "extract_content 的 selector 格式不正确。" };
  }

  return {
    ok: true,
    args: {
      mode,
      source,
      selectorType,
      selector,
      maxLength: maxLength.value,
    },
  };
}

export function validateExtractionSelector(selector, selectorType) {
  const text = typeof selector === "string" ? selector.trim() : "";
  const lowerText = text.toLowerCase();
  if (
    !text ||
    lowerText.includes("javascript:") ||
    /<\s*script\b/i.test(text) ||
    /\bon[a-z]+\s*=/i.test(text) ||
    /[`]/.test(text)
  ) {
    return { ok: false };
  }

  if (selectorType === "xpath") {
    return /^(?:\/|\.\/|\/\/|\.\/\/|\()/.test(text) ? { ok: true } : { ok: false };
  }

  if (selectorType === "css") {
    if (/[{};]/.test(text)) return { ok: false };
    return { ok: true };
  }

  return { ok: false };
}

export function createBrowserExtractContentRules(args, savedRules = []) {
  if (args?.source === "auto_rule") return Array.isArray(savedRules) ? savedRules : [];
  if (args?.source === "document") return [];
  return [{
    id: "browser-extract-content-temporary-selector",
    alias: "browser.extract_content 临时选择器",
    urlPattern: ".*",
    selector: args?.selector ?? "",
    selectorType: args?.selectorType ?? "css",
    selectorsText: args?.selector ?? "",
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  }];
}

export function formatBrowserExtractContentResult(response, args) {
  const safeArgs = normalizeResultArgs(args);
  const rawContent = extractResponseContent(response, safeArgs.mode);
  const content = truncateContent(rawContent, safeArgs.maxLength, response?.truncated === true);
  const summary = summarizeBrowserExtractContentResult(response, safeArgs);
  const truncated = summary.truncated || content.truncated;

  return [
    "浏览器内容提取：",
    `页面标题：${summary.title || "无标题"}`,
    `页面 URL：${summary.url || "未知"}`,
    `来源：${sourceLabel(safeArgs)}`,
    `模式：${safeArgs.mode === "html" ? "HTML" : "可见文本"}`,
    `字符数：${summary.length}`,
    `内容已截断：${truncated ? "是" : "否"}`,
    `使用回退：${summary.usedFallback ? "是" : "否"}`,
    summary.matchedRuleId ? `匹配规则：${summary.matchedRuleId}` : "匹配规则：无",
    "",
    content.text,
  ].join("\n");
}

export function summarizeBrowserExtractContentResult(response, args) {
  const safeArgs = normalizeResultArgs(args);
  const text = extractResponseContent(response, safeArgs.mode);
  return {
    title: normalizeText(response?.title),
    url: normalizeText(response?.url),
    mode: safeArgs.mode,
    source: safeArgs.source,
    length: text.length,
    textLength: text.length,
    truncated: response?.truncated === true || text.length > safeArgs.maxLength,
    usedFallback: response?.usedFallback === true,
    matchedRuleId: normalizeText(response?.matchedRuleId),
    preview: createPreview(text),
  };
}

function normalizeExtractContentMaxLength(value) {
  if (value === undefined) return { ok: true, value: BROWSER_EXTRACT_CONTENT_DEFAULT_MAX_LENGTH };
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < BROWSER_EXTRACT_CONTENT_MIN_MAX_LENGTH ||
    value > BROWSER_EXTRACT_CONTENT_MAX_MAX_LENGTH
  ) {
    return { ok: false, message: "extract_content 的 maxLength 必须是 500 到 200000 的整数。" };
  }
  return { ok: true, value };
}

function normalizeResultArgs(args = {}) {
  return {
    mode: args.mode === "html" ? "html" : "text",
    source: ["auto_rule", "document", "selector"].includes(args.source) ? args.source : "auto_rule",
    selectorType: args.selectorType === "xpath" ? "xpath" : "css",
    maxLength: typeof args.maxLength === "number" && Number.isFinite(args.maxLength) && args.maxLength > 0
      ? Math.floor(args.maxLength)
      : BROWSER_EXTRACT_CONTENT_DEFAULT_MAX_LENGTH,
  };
}

function extractResponseContent(response, mode) {
  if (mode === "html" && typeof response?.html === "string") return response.html;
  if (typeof response?.text === "string") return response.text;
  if (typeof response?.content === "string") return response.content;
  return "";
}

function sourceLabel(args) {
  if (args.source === "selector") return args.selectorType === "xpath" ? "XPath 选择器" : "CSS 选择器";
  if (args.source === "document") return "全文";
  return "提取规则";
}

function truncateContent(value, maxLength, forceMarker = false) {
  const text = String(value ?? "");
  if (text.length <= maxLength && forceMarker) return { text: `${text}${TRUNCATION_MARKER}`, truncated: true };
  if (text.length <= maxLength) return { text, truncated: false };
  return { text: `${text.slice(0, maxLength)}${TRUNCATION_MARKER}`, truncated: true };
}

function createPreview(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= SUMMARY_PREVIEW_LENGTH) return text;
  return `${text.slice(0, SUMMARY_PREVIEW_LENGTH)}...`;
}

function normalizeText(value) {
  return typeof value === "string" ? value : "";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
