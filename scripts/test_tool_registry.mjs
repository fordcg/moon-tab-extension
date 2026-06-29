import assert from "node:assert/strict";
import {
  TOOL_PERMISSION_SCOPES,
  ToolActionQueue,
  ToolRegistry,
  createHttpMcpToolAdapter,
} from "../src/shared/agent-tool-registry.mjs";

const registry = new ToolRegistry();
registry.register({
  id: "safe.echo",
  name: "Echo",
  permission: TOOL_PERMISSION_SCOPES.SAFE,
  inputSchema: {
    type: "object",
    required: ["text"],
    properties: { text: { type: "string" } },
  },
  handler: async (input) => ({ ok: true, content: input.text }),
});

assert.equal(registry.list().length, 1);
assert.equal(registry.list({ permission: TOOL_PERMISSION_SCOPES.SAFE }).length, 1);
assert.throws(
  () => registry.register({ id: "safe.echo", handler: async () => ({ ok: true }) }),
  /已注册/,
);

assert.deepEqual(await registry.call("missing.tool", {}), {
  ok: false,
  message: "工具 missing.tool 未注册",
});
assert.equal((await registry.call("safe.echo", { text: "hello" })).content, "hello");
assert.equal((await registry.call("safe.echo", { text: 1 })).ok, false);
assert.equal((await registry.call("safe.echo", {})).ok, false);

registry.register({
  id: "safe.timeout",
  timeoutMs: 20,
  handler: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 100)),
});
assert.deepEqual(await registry.call("safe.timeout", {}), {
  ok: false,
  message: "工具 safe.timeout 执行超时",
});

const queue = new ToolActionQueue();
const order = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const first = queue.enqueue(async () => {
  order.push("first:start");
  await wait(40);
  order.push("first:end");
  return "first";
});
const second = queue.enqueue(async () => {
  order.push("second:start");
  await wait(1);
  order.push("second:end");
  return "second";
});
assert.equal(await first, "first");
assert.equal(await second, "second");
assert.deepEqual(order, ["first:start", "first:end", "second:start", "second:end"]);

const calls = [];
const adapter = createHttpMcpToolAdapter({
  baseUrl: "http://127.0.0.1:17333/",
  fetchImpl: async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/tools/list")) {
      return {
        ok: true,
        json: async () => ({
          tools: [
            {
              id: "dev.echo",
              name: "Dev Echo",
              description: "Echo through MCP bridge",
              inputSchema: { type: "object", required: ["text"], properties: { text: { type: "string" } } },
            },
          ],
        }),
      };
    }
    if (url.endsWith("/tools/call")) {
      return { ok: true, json: async () => ({ ok: true, content: JSON.parse(init.body).input.text }) };
    }
    return { ok: false, json: async () => ({ message: "not found" }) };
  },
});

const definitions = await adapter.toToolDefinitions();
assert.equal(definitions.length, 1);
assert.equal(definitions[0].id, "mcp.dev.echo");
assert.equal(definitions[0].permission, TOOL_PERMISSION_SCOPES.MCP);
assert.deepEqual(await definitions[0].handler({ text: "from mcp" }), { ok: true, content: "from mcp" });
assert.equal(calls.some((call) => call.url.endsWith("/tools/list")), true);
assert.equal(calls.some((call) => call.url.endsWith("/tools/call")), true);

console.log("tool registry tests passed");
