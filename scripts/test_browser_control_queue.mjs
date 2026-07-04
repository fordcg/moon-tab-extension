import assert from "node:assert/strict";
import {
  BROWSER_CONTROL_ACTIONS,
  BROWSER_CONTROL_PERMISSION,
  BROWSER_CONTROL_TOOL_DEFINITIONS,
  createBrowserControlToolDefinitions,
  createBrowserControlToolError,
  isBrowserControlAction,
  resolveBrowserControlAction,
  resolveBrowserControlToolId,
  validateBrowserControlRequest,
} from "../src/shared/browser-control-contract.mjs";
import { BrowserControlActionQueue } from "../src/shared/browser-control-queue.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

assert.equal(resolveBrowserControlAction("browser.click"), BROWSER_CONTROL_ACTIONS.CLICK);
assert.equal(resolveBrowserControlAction("click"), BROWSER_CONTROL_ACTIONS.CLICK);
assert.equal(resolveBrowserControlAction("browser.extract_content"), BROWSER_CONTROL_ACTIONS.EXTRACT_CONTENT);
assert.equal(resolveBrowserControlAction("extract_content"), BROWSER_CONTROL_ACTIONS.EXTRACT_CONTENT);
assert.equal(resolveBrowserControlAction("browser.navigate_page"), BROWSER_CONTROL_ACTIONS.NAVIGATE_PAGE);
assert.equal(resolveBrowserControlToolId("click"), "browser.click");
assert.equal(resolveBrowserControlToolId("extract_content"), "browser.extract_content");
assert.equal(resolveBrowserControlToolId("new_page"), "browser.new_page");
assert.equal(isBrowserControlAction("not_browser"), false);
assert.equal(isBrowserControlAction("browser.extract_content"), true);
assert.equal(BROWSER_CONTROL_TOOL_DEFINITIONS.every((tool) => tool.permission === BROWSER_CONTROL_PERMISSION), true);

const extractContentDefinition = BROWSER_CONTROL_TOOL_DEFINITIONS.find((tool) => tool.id === "browser.extract_content");
assert.ok(extractContentDefinition);
assert.equal(extractContentDefinition.name, "extract_content");
assert.equal(extractContentDefinition.inputSchema.additionalProperties, false);
assert.deepEqual(extractContentDefinition.inputSchema.properties.mode.enum, ["text", "html"]);
assert.deepEqual(extractContentDefinition.inputSchema.properties.source.enum, ["auto_rule", "document", "selector"]);

assert.equal(validateBrowserControlRequest({ name: "click", arguments: { uid: "42" } }).ok, true);
assert.equal(validateBrowserControlRequest({ name: "click", arguments: { uid: "" } }).ok, false);
assert.match(validateBrowserControlRequest({ name: "fill", arguments: { uid: "42" } }).message, /value 必须是字符串/);
assert.match(validateBrowserControlRequest({ name: "press_key", arguments: { key: "" } }).message, /key 必须是非空字符串/);
assert.match(validateBrowserControlRequest({ name: "wait_for", arguments: { text: "done" } }).message, /text 必须是字符串数组/);
assert.match(validateBrowserControlRequest({ name: "wait_for", arguments: { text: [""] } }).message, /只能包含非空字符串/);
assert.match(validateBrowserControlRequest({ name: "click", arguments: { uid: "42", extra: true } }).message, /不接受参数/);
assert.equal(validateBrowserControlRequest({ name: "navigate_page", arguments: { action: "reload" } }).ok, true);
assert.equal(validateBrowserControlRequest({ name: "navigate_page", arguments: { action: "goto", url: "https://example.com" } }).ok, true);
assert.match(validateBrowserControlRequest({ name: "navigate_page", arguments: { action: "goto" } }).message, /需要非空 URL/);
assert.match(validateBrowserControlRequest({ name: "navigate_page", arguments: { action: "back", url: "https://example.com" } }).message, /只有 goto 动作/);
assert.equal(validateBrowserControlRequest({ name: "new_page", arguments: { url: "https://example.com", background: true } }).ok, true);
assert.match(validateBrowserControlRequest({ name: "new_page", arguments: { url: "https://example.com", background: true, includeSnapshot: true } }).message, /不能同时请求 includeSnapshot/);
assert.equal(validateBrowserControlRequest({ name: "list_pages", arguments: {} }).ok, true);
assert.equal(validateBrowserControlRequest({ name: "select_page", arguments: { index: 1, includeSnapshot: true } }).ok, true);
assert.match(validateBrowserControlRequest({ name: "close_page", arguments: { index: 0 } }).message, /从 1 开始/);
assert.equal(validateBrowserControlRequest({ name: "scroll_page", arguments: { direction: "down", amount: 600 } }).ok, true);
assert.match(validateBrowserControlRequest({ name: "scroll_page", arguments: { direction: "diagonal" } }).message, /direction/);
assert.equal(validateBrowserControlRequest({ name: "wait_for_network_idle", arguments: { idleMs: 500, timeout: 3000 } }).ok, true);
assert.match(validateBrowserControlRequest({ name: "wait_for_network_idle", arguments: { idleMs: 50 } }).message, /idleMs/);

assert.deepEqual(validateBrowserControlRequest({ name: "extract_content", arguments: {} }).request.arguments, {
  mode: "text",
  source: "auto_rule",
  maxLength: 30000,
});
assert.deepEqual(
  validateBrowserControlRequest({
    toolId: "browser.extract_content",
    input: { mode: "html", source: "selector", selectorType: "css", selector: " main ", maxLength: 500 },
  }).request.arguments,
  {
    mode: "html",
    source: "selector",
    selectorType: "css",
    selector: "main",
    maxLength: 500,
  },
);
assert.match(validateBrowserControlRequest({ name: "extract_content", arguments: null }).message, /参数必须是对象/);
assert.match(validateBrowserControlRequest({ name: "extract_content", arguments: { mode: "markdown" } }).message, /mode 必须是 text 或 html/);
assert.match(validateBrowserControlRequest({ name: "extract_content", arguments: { source: "selector", selector: "main" } }).message, /selectorType/);
assert.match(validateBrowserControlRequest({ name: "extract_content", arguments: { source: "document", selector: "main" } }).message, /只有 source=selector/);

const manualError = createBrowserControlToolError({ id: "manual", name: "click", arguments: { uid: "x" } }, "失败");
assert.equal(manualError.toolCallId, "manual");
assert.equal(manualError.name, "click");
assert.equal(manualError.isError, true);

const events = [];
const queue = new BrowserControlActionQueue({ onEvent: (event) => events.push(event), maxHistory: 10 });
const executionOrder = [];
const first = queue.enqueue(
  { id: "first", name: "click", arguments: { uid: "a" } },
  async (request) => {
    executionOrder.push(`${request.id}:start`);
    await wait(40);
    executionOrder.push(`${request.id}:end`);
    return { toolCallId: request.id, name: request.name, content: "clicked" };
  },
);
const second = queue.enqueue(
  { id: "second", name: "fill", arguments: { uid: "b", value: "hello" } },
  async (request) => {
    executionOrder.push(`${request.id}:start`);
    await wait(1);
    executionOrder.push(`${request.id}:end`);
    return { toolCallId: request.id, name: request.name, content: "filled" };
  },
);
assert.equal((await first).content, "clicked");
assert.equal((await second).content, "filled");
assert.deepEqual(executionOrder, ["first:start", "first:end", "second:start", "second:end"]);
assert.equal(queue.history.length, 2);
assert.equal(queue.history.every((item) => item.status === "success"), true);
assert.equal(events.some((event) => event.type === "queued" && event.request.id === "first"), true);
assert.equal(events.some((event) => event.type === "completed" && event.request.id === "second"), true);

let invalidExecutorCalled = false;
const invalid = await queue.enqueue(
  { id: "invalid", name: "click", arguments: { uid: "" } },
  async () => {
    invalidExecutorCalled = true;
    return { ok: true };
  },
);
assert.equal(invalid.isError, true);
assert.equal(invalid.code, "invalid_arguments");
assert.equal(invalidExecutorCalled, false);

const failure = await queue.enqueue(
  { id: "failure", name: "press_key", arguments: { key: "Enter" } },
  async () => {
    throw new Error("boom");
  },
);
assert.equal(failure.isError, true);
assert.equal(failure.content, "boom");

const afterFailure = await queue.enqueue(
  { id: "afterFailure", name: "take_snapshot", arguments: {} },
  async (request) => ({ toolCallId: request.id, name: request.name, content: "snapshot" }),
);
assert.equal(afterFailure.content, "snapshot");

const timeoutQueue = new BrowserControlActionQueue();
const timeoutResult = await timeoutQueue.enqueue(
  { id: "timeout", name: "wait_for", arguments: { text: ["done"], timeout: 15 } },
  async () => {
    await wait(80);
    return { ok: true };
  },
);
assert.equal(timeoutResult.isError, true);
assert.equal(timeoutResult.code, "timeout");
assert.match(timeoutResult.content, /执行超时/);
assert.equal(timeoutQueue.history[0].status, "timeout");

const definitionQueue = new BrowserControlActionQueue();
const definitions = createBrowserControlToolDefinitions({
  queue: definitionQueue,
  execute: async (request) => ({ toolCallId: request.id, name: request.name, content: request.arguments.uid || "snapshot" }),
});
const clickDefinition = definitions.find((definition) => definition.name === "click");
assert.ok(clickDefinition);
assert.equal(clickDefinition.permission, BROWSER_CONTROL_PERMISSION);
assert.equal((await clickDefinition.handler({ uid: "from-definition" }, { toolCallId: "tool-call-1" })).content, "from-definition");

console.log("browser control queue tests passed");
