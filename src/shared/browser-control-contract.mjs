import {
  BROWSER_EXTRACT_CONTENT_INPUT_SCHEMA,
  BROWSER_EXTRACT_CONTENT_TOOL_ID,
  BROWSER_EXTRACT_CONTENT_TOOL_NAME,
  normalizeBrowserExtractContentArguments,
} from "./browser-extract-content.mjs";

export const BROWSER_CONTROL_ACTIONS = Object.freeze({
  TAKE_SNAPSHOT: "take_snapshot",
  EXTRACT_CONTENT: BROWSER_EXTRACT_CONTENT_TOOL_NAME,
  CLICK: "click",
  FILL: "fill",
  PRESS_KEY: "press_key",
  WAIT_FOR: "wait_for",
  SCROLL_PAGE: "scroll_page",
  WAIT_FOR_NETWORK_IDLE: "wait_for_network_idle",
  NAVIGATE_PAGE: "navigate_page",
  NEW_PAGE: "new_page",
  LIST_PAGES: "list_pages",
  SELECT_PAGE: "select_page",
  CLOSE_PAGE: "close_page",
});

export const BROWSER_CONTROL_TOOL_IDS = Object.freeze({
  TAKE_SNAPSHOT: "browser.take_snapshot",
  EXTRACT_CONTENT: BROWSER_EXTRACT_CONTENT_TOOL_ID,
  CLICK: "browser.click",
  FILL: "browser.fill",
  PRESS_KEY: "browser.press_key",
  WAIT_FOR: "browser.wait_for",
  SCROLL_PAGE: "browser.scroll_page",
  WAIT_FOR_NETWORK_IDLE: "browser.wait_for_network_idle",
  NAVIGATE_PAGE: "browser.navigate_page",
  NEW_PAGE: "browser.new_page",
  LIST_PAGES: "browser.list_pages",
  SELECT_PAGE: "browser.select_page",
  CLOSE_PAGE: "browser.close_page",
});

export const BROWSER_CONTROL_PERMISSION = "browser-control";
export const DEFAULT_BROWSER_CONTROL_ACTION_TIMEOUT_MS = 30000;
export const MAX_BROWSER_CONTROL_ACTION_TIMEOUT_MS = 60000;

const ACTION_TO_TOOL_ID = Object.freeze({
  [BROWSER_CONTROL_ACTIONS.TAKE_SNAPSHOT]: BROWSER_CONTROL_TOOL_IDS.TAKE_SNAPSHOT,
  [BROWSER_CONTROL_ACTIONS.EXTRACT_CONTENT]: BROWSER_CONTROL_TOOL_IDS.EXTRACT_CONTENT,
  [BROWSER_CONTROL_ACTIONS.CLICK]: BROWSER_CONTROL_TOOL_IDS.CLICK,
  [BROWSER_CONTROL_ACTIONS.FILL]: BROWSER_CONTROL_TOOL_IDS.FILL,
  [BROWSER_CONTROL_ACTIONS.PRESS_KEY]: BROWSER_CONTROL_TOOL_IDS.PRESS_KEY,
  [BROWSER_CONTROL_ACTIONS.WAIT_FOR]: BROWSER_CONTROL_TOOL_IDS.WAIT_FOR,
  [BROWSER_CONTROL_ACTIONS.SCROLL_PAGE]: BROWSER_CONTROL_TOOL_IDS.SCROLL_PAGE,
  [BROWSER_CONTROL_ACTIONS.WAIT_FOR_NETWORK_IDLE]: BROWSER_CONTROL_TOOL_IDS.WAIT_FOR_NETWORK_IDLE,
  [BROWSER_CONTROL_ACTIONS.NAVIGATE_PAGE]: BROWSER_CONTROL_TOOL_IDS.NAVIGATE_PAGE,
  [BROWSER_CONTROL_ACTIONS.NEW_PAGE]: BROWSER_CONTROL_TOOL_IDS.NEW_PAGE,
  [BROWSER_CONTROL_ACTIONS.LIST_PAGES]: BROWSER_CONTROL_TOOL_IDS.LIST_PAGES,
  [BROWSER_CONTROL_ACTIONS.SELECT_PAGE]: BROWSER_CONTROL_TOOL_IDS.SELECT_PAGE,
  [BROWSER_CONTROL_ACTIONS.CLOSE_PAGE]: BROWSER_CONTROL_TOOL_IDS.CLOSE_PAGE,
});

const TOOL_ID_TO_ACTION = Object.freeze(Object.fromEntries(
  Object.entries(ACTION_TO_TOOL_ID).map(([action, toolId]) => [toolId, action]),
));

const COMMON_TOOL_PROPERTIES = Object.freeze({
  includeSnapshot: {
    type: "boolean",
    description: "动作成功或失败后是否请求最新页面快照。",
  },
});

export const BROWSER_CONTROL_ACTION_SCHEMAS = Object.freeze({
  [BROWSER_CONTROL_ACTIONS.TAKE_SNAPSHOT]: Object.freeze({
    type: "object",
    additionalProperties: false,
    properties: {},
  }),
  [BROWSER_CONTROL_ACTIONS.EXTRACT_CONTENT]: BROWSER_EXTRACT_CONTENT_INPUT_SCHEMA,
  [BROWSER_CONTROL_ACTIONS.CLICK]: Object.freeze({
    type: "object",
    required: ["uid"],
    additionalProperties: false,
    properties: {
      uid: { type: "string", minLength: 1, description: "take_snapshot 返回的元素 UID。" },
      includeSnapshot: COMMON_TOOL_PROPERTIES.includeSnapshot,
    },
  }),
  [BROWSER_CONTROL_ACTIONS.FILL]: Object.freeze({
    type: "object",
    required: ["uid", "value"],
    additionalProperties: false,
    properties: {
      uid: { type: "string", minLength: 1, description: "take_snapshot 返回的元素 UID。" },
      value: { type: "string", description: "要写入元素的字符串值。" },
      includeSnapshot: COMMON_TOOL_PROPERTIES.includeSnapshot,
    },
  }),
  [BROWSER_CONTROL_ACTIONS.PRESS_KEY]: Object.freeze({
    type: "object",
    required: ["key"],
    additionalProperties: false,
    properties: {
      key: { type: "string", minLength: 1, description: "允许列表中的按键或组合键，例如 Enter、Escape、Control+A。" },
      includeSnapshot: COMMON_TOOL_PROPERTIES.includeSnapshot,
    },
  }),
  [BROWSER_CONTROL_ACTIONS.WAIT_FOR]: Object.freeze({
    type: "object",
    required: ["text"],
    additionalProperties: false,
    properties: {
      text: {
        type: "array",
        minItems: 1,
        items: { type: "string", minLength: 1 },
        description: "需要等待出现在页面可见文本中的候选字符串。",
      },
      timeout: { type: "number", minimum: 1, maximum: MAX_BROWSER_CONTROL_ACTION_TIMEOUT_MS },
    },
  }),
  [BROWSER_CONTROL_ACTIONS.SCROLL_PAGE]: Object.freeze({
    type: "object",
    required: ["direction"],
    additionalProperties: false,
    properties: {
      direction: {
        type: "string",
        enum: ["up", "down", "left", "right", "top", "bottom"],
        description: "滚动方向。",
      },
      amount: {
        type: "number",
        minimum: 1,
        maximum: 5000,
        description: "滚动像素；top/bottom 会忽略该值。",
      },
      includeSnapshot: COMMON_TOOL_PROPERTIES.includeSnapshot,
    },
  }),
  [BROWSER_CONTROL_ACTIONS.WAIT_FOR_NETWORK_IDLE]: Object.freeze({
    type: "object",
    additionalProperties: false,
    properties: {
      idleMs: {
        type: "number",
        minimum: 100,
        maximum: 5000,
        description: "资源数量保持稳定的毫秒数。",
      },
      timeout: { type: "number", minimum: 1, maximum: MAX_BROWSER_CONTROL_ACTION_TIMEOUT_MS },
      includeSnapshot: COMMON_TOOL_PROPERTIES.includeSnapshot,
    },
  }),
  [BROWSER_CONTROL_ACTIONS.NAVIGATE_PAGE]: Object.freeze({
    type: "object",
    required: ["action"],
    additionalProperties: false,
    properties: {
      action: { type: "string", enum: ["goto", "back", "forward", "reload"] },
      url: { type: "string", minLength: 1 },
      includeSnapshot: COMMON_TOOL_PROPERTIES.includeSnapshot,
    },
  }),
  [BROWSER_CONTROL_ACTIONS.NEW_PAGE]: Object.freeze({
    type: "object",
    required: ["url"],
    additionalProperties: false,
    properties: {
      url: { type: "string", minLength: 1 },
      background: { type: "boolean" },
      includeSnapshot: COMMON_TOOL_PROPERTIES.includeSnapshot,
    },
  }),
  [BROWSER_CONTROL_ACTIONS.LIST_PAGES]: Object.freeze({
    type: "object",
    additionalProperties: false,
    properties: {},
  }),
  [BROWSER_CONTROL_ACTIONS.SELECT_PAGE]: Object.freeze({
    type: "object",
    required: ["index"],
    additionalProperties: false,
    properties: {
      index: { type: "integer", minimum: 1 },
      includeSnapshot: COMMON_TOOL_PROPERTIES.includeSnapshot,
    },
  }),
  [BROWSER_CONTROL_ACTIONS.CLOSE_PAGE]: Object.freeze({
    type: "object",
    required: ["index"],
    additionalProperties: false,
    properties: {
      index: { type: "integer", minimum: 1 },
    },
  }),
});

export const BROWSER_CONTROL_TOOL_DEFINITIONS = Object.freeze(
  Object.values(BROWSER_CONTROL_ACTIONS).map((name) => Object.freeze({
    id: ACTION_TO_TOOL_ID[name],
    name,
    permission: BROWSER_CONTROL_PERMISSION,
    inputSchema: BROWSER_CONTROL_ACTION_SCHEMAS[name],
  })),
);

const ACTION_VALUES = new Set(Object.values(BROWSER_CONTROL_ACTIONS));

export function resolveBrowserControlAction(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (ACTION_VALUES.has(normalized)) {
    return normalized;
  }
  return TOOL_ID_TO_ACTION[normalized] || "";
}

export function resolveBrowserControlToolId(action) {
  return ACTION_TO_TOOL_ID[resolveBrowserControlAction(action)] || "";
}

export function isBrowserControlAction(value) {
  return Boolean(resolveBrowserControlAction(value));
}

export function normalizeBrowserControlRequest(toolCall = {}) {
  const name = resolveBrowserControlAction(toolCall.name || toolCall.action || toolCall.toolId || toolCall.id);
  const args = toolCall.arguments && typeof toolCall.arguments === "object" && !Array.isArray(toolCall.arguments)
    ? { ...toolCall.arguments }
    : toolCall.input && typeof toolCall.input === "object" && !Array.isArray(toolCall.input)
      ? { ...toolCall.input }
      : {};

  return {
    id: typeof toolCall.id === "string" && toolCall.id.trim() ? toolCall.id.trim() : `browser-control-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    toolId: resolveBrowserControlToolId(name),
    arguments: args,
    timeoutMs: normalizeActionTimeout(toolCall.timeoutMs ?? args.timeout),
    createdAt: typeof toolCall.createdAt === "number" ? toolCall.createdAt : Date.now(),
  };
}

export function validateBrowserControlRequest(toolCall) {
  const request = normalizeBrowserControlRequest(toolCall);
  if (!request.name) {
    return { ok: false, request, message: "未知的浏览器操作工具。" };
  }

  const args = request.arguments;
  const allowed = Object.keys(BROWSER_CONTROL_ACTION_SCHEMAS[request.name]?.properties || {});
  const extras = Object.keys(args).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    return { ok: false, request, message: `浏览器操作工具 ${request.name} 不接受参数：${extras.join("、")}。` };
  }

  if (request.name === BROWSER_CONTROL_ACTIONS.EXTRACT_CONTENT) {
    const rawArgs = getRawToolArguments(toolCall);
    const validation = normalizeBrowserExtractContentArguments(rawArgs);
    if (!validation.ok) {
      return { ok: false, request, message: validation.message };
    }
    return { ok: true, request: { ...request, arguments: validation.args } };
  }

  if ((request.name === BROWSER_CONTROL_ACTIONS.CLICK || request.name === BROWSER_CONTROL_ACTIONS.FILL) && !isNonEmptyString(args.uid)) {
    return { ok: false, request, message: "浏览器操作需要非空 UID。" };
  }

  if (request.name === BROWSER_CONTROL_ACTIONS.FILL && typeof args.value !== "string") {
    return { ok: false, request, message: "fill 的 value 必须是字符串。" };
  }

  if (request.name === BROWSER_CONTROL_ACTIONS.PRESS_KEY && !isNonEmptyString(args.key)) {
    return { ok: false, request, message: "press_key 的 key 必须是非空字符串。" };
  }

  if (
    (request.name === BROWSER_CONTROL_ACTIONS.CLICK || request.name === BROWSER_CONTROL_ACTIONS.FILL || request.name === BROWSER_CONTROL_ACTIONS.PRESS_KEY) &&
    args.includeSnapshot !== undefined &&
    typeof args.includeSnapshot !== "boolean"
  ) {
    return { ok: false, request, message: "includeSnapshot 必须是布尔值。" };
  }

  if (request.name === BROWSER_CONTROL_ACTIONS.WAIT_FOR) {
    if (!Array.isArray(args.text)) {
      return { ok: false, request, message: "wait_for 的 text 必须是字符串数组。" };
    }
    if (args.text.length === 0 || args.text.some((item) => !isNonEmptyString(item))) {
      return { ok: false, request, message: "wait_for 的 text 只能包含非空字符串。" };
    }
    if (args.timeout !== undefined && (typeof args.timeout !== "number" || !Number.isFinite(args.timeout))) {
      return { ok: false, request, message: "wait_for 的 timeout 必须是数字。" };
    }
  }

  if (request.name === BROWSER_CONTROL_ACTIONS.SCROLL_PAGE) {
    const direction = args.direction;
    if (!["up", "down", "left", "right", "top", "bottom"].includes(direction)) {
      return { ok: false, request, message: "scroll_page 的 direction 必须是 up、down、left、right、top 或 bottom。" };
    }
    if (args.amount !== undefined && (typeof args.amount !== "number" || !Number.isFinite(args.amount) || args.amount <= 0 || args.amount > 5000)) {
      return { ok: false, request, message: "scroll_page 的 amount 必须是 1 到 5000 之间的数字。" };
    }
    if (args.includeSnapshot !== undefined && typeof args.includeSnapshot !== "boolean") {
      return { ok: false, request, message: "includeSnapshot 必须是布尔值。" };
    }
  }

  if (request.name === BROWSER_CONTROL_ACTIONS.WAIT_FOR_NETWORK_IDLE) {
    if (args.idleMs !== undefined && (typeof args.idleMs !== "number" || !Number.isFinite(args.idleMs) || args.idleMs < 100 || args.idleMs > 5000)) {
      return { ok: false, request, message: "wait_for_network_idle 的 idleMs 必须是 100 到 5000 之间的数字。" };
    }
    if (args.timeout !== undefined && (typeof args.timeout !== "number" || !Number.isFinite(args.timeout))) {
      return { ok: false, request, message: "wait_for_network_idle 的 timeout 必须是数字。" };
    }
    if (args.includeSnapshot !== undefined && typeof args.includeSnapshot !== "boolean") {
      return { ok: false, request, message: "includeSnapshot 必须是布尔值。" };
    }
  }

  if (request.name === BROWSER_CONTROL_ACTIONS.NAVIGATE_PAGE) {
    const action = args.action;
    if (action !== "goto" && action !== "back" && action !== "forward" && action !== "reload") {
      return { ok: false, request, message: "navigate_page 的 action 必须是 goto、back、forward 或 reload。" };
    }
    if (action === "goto" && !isNonEmptyString(args.url)) {
      return { ok: false, request, message: "navigate_page 的 goto 动作需要非空 URL。" };
    }
    if (action !== "goto" && args.url !== undefined) {
      return { ok: false, request, message: "navigate_page 只有 goto 动作可以携带 URL。" };
    }
    if (args.includeSnapshot !== undefined && typeof args.includeSnapshot !== "boolean") {
      return { ok: false, request, message: "includeSnapshot 必须是布尔值。" };
    }
  }

  if (request.name === BROWSER_CONTROL_ACTIONS.NEW_PAGE) {
    if (!isNonEmptyString(args.url)) {
      return { ok: false, request, message: "new_page 需要非空 URL。" };
    }
    if (args.background !== undefined && typeof args.background !== "boolean") {
      return { ok: false, request, message: "background 必须是布尔值。" };
    }
    if (args.includeSnapshot !== undefined && typeof args.includeSnapshot !== "boolean") {
      return { ok: false, request, message: "includeSnapshot 必须是布尔值。" };
    }
    if (args.background === true && args.includeSnapshot === true) {
      return { ok: false, request, message: "new_page 在后台打开页面时不能同时请求 includeSnapshot。" };
    }
  }

  if (
    (request.name === BROWSER_CONTROL_ACTIONS.SELECT_PAGE || request.name === BROWSER_CONTROL_ACTIONS.CLOSE_PAGE) &&
    (typeof args.index !== "number" || !Number.isInteger(args.index) || args.index < 1)
  ) {
    return { ok: false, request, message: "页面 index 必须是从 1 开始的整数。" };
  }

  if (request.name === BROWSER_CONTROL_ACTIONS.SELECT_PAGE && args.includeSnapshot !== undefined && typeof args.includeSnapshot !== "boolean") {
    return { ok: false, request, message: "includeSnapshot 必须是布尔值。" };
  }

  return { ok: true, request };
}

export function createBrowserControlToolError(request, message, code = "browser_control_error") {
  const normalized = normalizeBrowserControlRequest(request);
  return {
    toolCallId: normalized.id,
    name: normalized.name || String(request?.name || request?.toolId || "browser_control"),
    content: message,
    isError: true,
    code,
  };
}

export function createBrowserControlToolDefinitions({ queue, execute, contextProvider } = {}) {
  if (!queue || typeof queue.enqueue !== "function") {
    throw new Error("createBrowserControlToolDefinitions 需要 queue.enqueue");
  }
  if (typeof execute !== "function") {
    throw new Error("createBrowserControlToolDefinitions 需要 execute 函数");
  }

  return BROWSER_CONTROL_TOOL_DEFINITIONS.map((definition) => ({
    ...definition,
    inputSchema: { ...definition.inputSchema },
    handler: (input, context) => queue.enqueue(
      { id: context?.toolCallId, name: definition.name, arguments: input },
      execute,
      typeof contextProvider === "function" ? contextProvider(context) : context,
    ),
  }));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function getRawToolArguments(toolCall) {
  if (toolCall && Object.prototype.hasOwnProperty.call(toolCall, "arguments")) {
    return toolCall.arguments;
  }
  if (toolCall && Object.prototype.hasOwnProperty.call(toolCall, "input")) {
    return toolCall.input;
  }
  return undefined;
}

function normalizeActionTimeout(value) {
  const numeric = typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_BROWSER_CONTROL_ACTION_TIMEOUT_MS;
  return Math.min(Math.floor(numeric), MAX_BROWSER_CONTROL_ACTION_TIMEOUT_MS);
}
