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
              timeoutMs: 45000,
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
assert.equal(definitions[0].id.startsWith("mcp."), true);
assert.match(definitions[0].id, /dev\.echo|dev%2Eecho/);
assert.equal(definitions[0].permission, TOOL_PERMISSION_SCOPES.MCP);
assert.equal(definitions[0].timeoutMs, 45000);
assert.deepEqual(await definitions[0].handler({ text: "from mcp" }), { ok: true, content: "from mcp" });
assert.equal(calls.some((call) => call.url.endsWith("/tools/list")), true);
assert.equal(calls.some((call) => call.url.endsWith("/tools/call")), true);

const mcpCalls = [];
const mcpAdapter = createHttpMcpToolAdapter({
  baseUrl: "http://127.0.0.1:17333/mcp",
  token: "top-level-token",
  server: {
    id: "remote.server",
    endpointUrl: "http://127.0.0.1:17333/mcp",
    bearerToken: "server-token",
  },
  fetchImpl: async (url, init = {}) => {
    const body = JSON.parse(init.body);
    mcpCalls.push({ url, body });
    if (body.method === "initialize") {
      assert.equal(init.headers.Authorization, "Bearer top-level-token");
      return {
        ok: true,
        headers: new Map([["Mcp-Session-Id", "remote-session"]]),
        json: async () => ({ jsonrpc: "2.0", id: body.id, result: {} }),
      };
    }
    if (body.method === "notifications/initialized") {
      assert.equal(init.headers["Mcp-Session-Id"], "remote-session");
      return {
        ok: true,
        headers: new Map(),
        json: async () => ({}),
      };
    }
    if (body.method === "tools/list") {
      assert.equal(init.headers["Mcp-Session-Id"], "remote-session");
      return {
        ok: true,
        headers: new Map(),
        json: async () => ({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [
              {
                name: "remote.echo",
                description: "Remote Echo",
                inputSchema: { type: "object", required: ["text"], properties: { text: { type: "string" } } },
              },
            ],
          },
        }),
      };
    }
    if (body.method === "tools/call") {
      return {
        ok: true,
        headers: new Map(),
        json: async () => ({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: `remote:${body.params.arguments.text}` }] },
        }),
      };
    }
    throw new Error(`unexpected ${body.method}`);
  },
});

const mcpDefinitions = await mcpAdapter.toToolDefinitions();
assert.equal(mcpDefinitions.length, 1);
assert.equal(mcpDefinitions[0].id.startsWith("mcp."), true);
assert.equal(mcpDefinitions[0].id.startsWith("mcp.remote%2Eserver."), true);
assert.match(mcpDefinitions[0].id, /remote\.echo|remote%2Eecho/);
assert.deepEqual(await mcpDefinitions[0].handler({ text: "ok" }), { ok: true, content: "remote:ok" });
assert.equal(mcpCalls.some((call) => call.body.method === "tools/list"), true);
assert.equal(mcpCalls.some((call) => call.body.method === "tools/call"), true);

const errorCalls = [];
const mcpErrorAdapter = createHttpMcpToolAdapter({
  baseUrl: "http://127.0.0.1:17334/",
  server: {
    id: "remote.error",
    endpointUrl: "http://127.0.0.1:17333/mcp-error",
  },
  fetchImpl: async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    errorCalls.push({ url, body });
    if (body.method === "initialize") {
      return {
        ok: true,
        headers: new Map(),
        json: async () => ({ jsonrpc: "2.0", id: body.id, result: {} }),
      };
    }
    if (body.method === "notifications/initialized") {
      return {
        ok: true,
        headers: new Map(),
        json: async () => ({}),
      };
    }
    if (body.method === "tools/list") {
      return {
        ok: true,
        headers: new Map(),
        json: async () => ({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [{ name: "remote.fail", inputSchema: { type: "object", additionalProperties: true } }],
          },
        }),
      };
    }
    if (body.method === "tools/call") {
      return {
        ok: true,
        headers: new Map(),
        json: async () => ({
          jsonrpc: "2.0",
          id: body.id,
          result: { isError: true, content: [{ type: "text", text: "bad" }] },
        }),
      };
    }
    if (url.endsWith("/tools/call")) {
      return { ok: true, json: async () => ({ ok: true, content: "legacy should not run" }) };
    }
    return { ok: false, json: async () => ({ message: "legacy missing" }) };
  },
});

const [mcpErrorDefinition] = await mcpErrorAdapter.toToolDefinitions();
await assert.rejects(() => mcpErrorDefinition.handler({}), /remote\.fail 调用失败：bad/);
assert.equal(errorCalls.some((call) => call.url.endsWith("/tools/call")), false);

const jsonRpcErrorCalls = [];
const mcpJsonRpcErrorAdapter = createHttpMcpToolAdapter({
  baseUrl: "http://127.0.0.1:17335/",
  server: {
    id: "remote.jsonrpc-error",
    endpointUrl: "http://127.0.0.1:17333/mcp-jsonrpc-error",
  },
  fetchImpl: async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    jsonRpcErrorCalls.push({ url, body });
    if (body.method === "initialize") {
      return {
        ok: true,
        headers: new Map(),
        json: async () => ({ jsonrpc: "2.0", id: body.id, result: {} }),
      };
    }
    if (body.method === "notifications/initialized") {
      return {
        ok: true,
        headers: new Map(),
        json: async () => ({}),
      };
    }
    if (body.method === "tools/list") {
      return {
        ok: true,
        headers: new Map(),
        json: async () => ({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [{ name: "remote.badArgs", inputSchema: { type: "object", additionalProperties: true } }],
          },
        }),
      };
    }
    if (body.method === "tools/call") {
      return {
        ok: true,
        headers: new Map(),
        json: async () => ({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32602, message: "bad args" },
        }),
      };
    }
    if (url.endsWith("/tools/call")) {
      return { ok: true, json: async () => ({ ok: true, content: "legacy should not run" }) };
    }
    return { ok: false, json: async () => ({ message: "legacy missing" }) };
  },
});

const [mcpJsonRpcErrorDefinition] = await mcpJsonRpcErrorAdapter.toToolDefinitions();
await assert.rejects(() => mcpJsonRpcErrorDefinition.handler({}), /bad args/);
assert.equal(jsonRpcErrorCalls.some((call) => call.url.endsWith("/tools/call")), false);

const httpJsonRpcErrorCalls = [];
const mcpHttpJsonRpcErrorAdapter = createHttpMcpToolAdapter({
  baseUrl: "http://127.0.0.1:17336/",
  server: {
    id: "remote.http-jsonrpc-error",
    endpointUrl: "http://127.0.0.1:17333/mcp-http-jsonrpc-error",
  },
  fetchImpl: async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    httpJsonRpcErrorCalls.push({ url, body });
    if (body.method === "initialize") {
      return {
        ok: true,
        headers: new Map(),
        json: async () => ({ jsonrpc: "2.0", id: body.id, result: {} }),
      };
    }
    if (body.method === "notifications/initialized") {
      return {
        ok: true,
        headers: new Map(),
        json: async () => ({}),
      };
    }
    if (body.method === "tools/list") {
      return {
        ok: true,
        headers: new Map(),
        json: async () => ({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [{ name: "remote.httpBadArgs", inputSchema: { type: "object", additionalProperties: true } }],
          },
        }),
      };
    }
    if (body.method === "tools/call") {
      return {
        ok: false,
        status: 400,
        statusText: "Bad Request",
        headers: new Map(),
        json: async () => ({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32602, message: "bad args over http" },
        }),
      };
    }
    if (url.endsWith("/tools/call")) {
      return { ok: true, json: async () => ({ ok: true, content: "legacy should not run" }) };
    }
    return { ok: false, json: async () => ({ message: "legacy missing" }) };
  },
});

const [mcpHttpJsonRpcErrorDefinition] = await mcpHttpJsonRpcErrorAdapter.toToolDefinitions();
await assert.rejects(() => mcpHttpJsonRpcErrorDefinition.handler({}), /bad args over http/);
assert.equal(httpJsonRpcErrorCalls.some((call) => call.url.endsWith("/tools/call")), false);

console.log("tool registry tests passed");
