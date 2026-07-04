import assert from "node:assert/strict";
import {
  DEFAULT_MCP_REQUEST_TIMEOUT_MS,
  JSON_RPC_VERSION,
  callMcpTool,
  listMcpTools,
  parseSseJsonRpcResponse,
} from "../src/shared/mcp-http-client.mjs";

assert.equal(DEFAULT_MCP_REQUEST_TIMEOUT_MS, 30000);
assert.equal(JSON_RPC_VERSION, "2.0");

const jsonRpcPayload = { jsonrpc: JSON_RPC_VERSION, id: 1, result: { ok: true } };
assert.deepEqual(parseSseJsonRpcResponse(JSON.stringify(jsonRpcPayload)), jsonRpcPayload);
assert.deepEqual(
  parseSseJsonRpcResponse(`event: message\ndata: [DONE]\ndata: ${JSON.stringify(jsonRpcPayload)}\n\n`),
  jsonRpcPayload,
);

const requests = [];
const fetcher = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : {};
  requests.push({ url, init, body });
  if (body.method === "initialize") {
    return {
      ok: true,
      headers: new Map([["mcp-session-id", "session-1"]]),
      json: async () => ({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26" } }),
      text: async () => "",
    };
  }
  if (body.method === "notifications/initialized") {
    return {
      ok: true,
      headers: new Map(),
      json: async () => ({}),
      text: async () => "",
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
          tools: [
            { name: "search.web", description: "Search", inputSchema: { type: "object" } },
          ],
        },
      }),
      text: async () => "",
    };
  }
  if (body.method === "tools/call") {
    return {
      ok: true,
      headers: new Map(),
      json: async () => ({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: `result:${body.params.arguments.query}` }] },
      }),
      text: async () => "",
    };
  }
  throw new Error(`unexpected ${body.method}`);
};

const server = {
  id: "main",
  name: "Main",
  endpointUrl: "http://127.0.0.1:17333/mcp",
  enabled: true,
  headers: {
    "X-MCP-Tenant": "tenant-a",
  },
  tools: [],
};

const tools = await listMcpTools({ server, bearerToken: "secret", fetcher });
assert.equal(tools.length, 1);
assert.equal(tools[0].name, "search.web");
assert.equal(requests[0].init.headers.Authorization, "Bearer secret");
assert.equal(requests[0].init.headers["X-MCP-Tenant"], "tenant-a");
assert.deepEqual(requests.slice(0, 3).map((request) => request.body.method), [
  "initialize",
  "notifications/initialized",
  "tools/list",
]);
assert.equal(requests[1].init.headers["Mcp-Session-Id"], "session-1");
assert.equal(requests[2].init.headers["Mcp-Session-Id"], "session-1");

const content = await callMcpTool({
  server,
  bearerToken: "secret",
  toolName: "search.web",
  arguments: { query: "moon" },
  fetcher,
});
assert.equal(content, "result:moon");
assert.deepEqual(requests.slice(-3).map((request) => request.body.method), [
  "initialize",
  "notifications/initialized",
  "tools/call",
]);

const formatted = await callMcpTool({
  server,
  bearerToken: "secret",
  toolName: "format",
  arguments: {},
  fetcher: async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    if (body.method === "initialize") {
      return {
        ok: true,
        headers: new Map(),
        json: async () => ({ jsonrpc: "2.0", id: body.id, result: {} }),
        text: async () => "",
      };
    }
    if (body.method === "notifications/initialized") {
      return {
        ok: true,
        headers: new Map(),
        json: async () => ({}),
        text: async () => "",
      };
    }
    assert.equal(url, server.endpointUrl);
    return {
      ok: true,
      headers: new Map(),
      json: async () => ({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          content: [
            { type: "text", text: "alpha" },
            { type: "resource", resource: { uri: "file://example", text: "beta" } },
            { type: "text", text: "x".repeat(12100) },
          ],
        },
      }),
      text: async () => "",
    };
  },
});
assert.equal(formatted.startsWith('alpha\n{"uri":"file://example","text":"beta"}\n'), true);
assert.equal(formatted.endsWith("...[已截断]"), true);

const sseFetcher = async (_url, init = {}) => {
  const body = JSON.parse(init.body);
  if (body.method === "initialize") {
    return {
      ok: true,
      headers: new Map(),
      json: async () => ({ jsonrpc: "2.0", id: body.id, result: {} }),
      text: async () => "",
    };
  }
  if (body.method === "notifications/initialized") {
    return {
      ok: true,
      headers: new Map(),
      json: async () => ({}),
      text: async () => "",
    };
  }
  return {
    ok: true,
    headers: new Map(),
    json: async () => {
      throw new Error("not json");
    },
    text: async () => `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } })}\n\n`,
  };
};

assert.deepEqual(await listMcpTools({ server, fetcher: sseFetcher }), []);

const responseSseTools = await listMcpTools({
  server,
  fetcher: async (_url, init = {}) => {
    const body = JSON.parse(init.body);
    if (body.method === "initialize") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
        headers: { "content-type": "application/json", "Mcp-Session-Id": "response-session" },
      });
    }
    if (body.method === "notifications/initialized") {
      assert.equal(init.headers["Mcp-Session-Id"], "response-session");
      return new Response("", { status: 202 });
    }
    assert.equal(init.headers["Mcp-Session-Id"], "response-session");
    return new Response(
      `event: message\ndata: ${JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { tools: [{ name: "response.sse", inputSchema: { type: "object" } }] },
      })}\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    );
  },
});
assert.equal(responseSseTools[0].name, "response.sse");

const notificationBeforeResponseTools = await listMcpTools({
  server,
  fetcher: async (_url, init = {}) => {
    const body = JSON.parse(init.body);
    if (body.method === "initialize") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (body.method === "notifications/initialized") {
      return new Response("", { status: 202 });
    }
    return new Response(
      [
        `data: ${JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: { progress: 1 },
        })}`,
        "",
        `data: ${JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { tools: [{ name: "after.progress", inputSchema: { type: "object" } }] },
        })}`,
        "",
      ].join("\n"),
      { headers: { "content-type": "text/event-stream" } },
    );
  },
});
assert.equal(notificationBeforeResponseTools[0].name, "after.progress");

await assert.rejects(
  () =>
    listMcpTools({
      server,
      fetcher: async (_url, init = {}) => {
        const body = JSON.parse(init.body);
        if (body.method === "initialize") {
          return {
            ok: true,
            headers: new Map(),
            json: async () => ({ jsonrpc: "2.0", id: body.id, result: {} }),
            text: async () => "",
          };
        }
        if (body.method === "notifications/initialized") {
          return {
            ok: true,
            headers: new Map(),
            json: async () => ({ jsonrpc: "2.0", error: { code: -32000, message: "initialized rejected" } }),
            text: async () => "",
          };
        }
        return {
          ok: true,
          headers: new Map(),
          json: async () => ({ jsonrpc: "2.0", id: body.id, result: { tools: [] } }),
          text: async () => "",
        };
      },
    }),
  /initialized rejected/,
);

const notificationHttpJsonRpcError = await listMcpTools({
  server,
  fetcher: async (_url, init = {}) => {
    const body = JSON.parse(init.body);
    if (body.method === "initialize") {
      return {
        ok: true,
        headers: new Map(),
        json: async () => ({ jsonrpc: "2.0", id: body.id, result: {} }),
        text: async () => "",
      };
    }
    if (body.method === "notifications/initialized") {
      return {
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        headers: new Map(),
        json: async () => ({
          jsonrpc: "2.0",
          error: { code: -32000, message: "initialized rejected over http" },
        }),
        text: async () => "",
      };
    }
    return {
      ok: true,
      headers: new Map(),
      json: async () => ({ jsonrpc: "2.0", id: body.id, result: { tools: [] } }),
      text: async () => "",
    };
  },
}).then(
  () => undefined,
  (error) => error,
);
assert.match(notificationHttpJsonRpcError?.message, /initialized rejected over http/);
assert.equal(notificationHttpJsonRpcError?.isMcpBridgeFallbackEligible, false);

const blankTokenRequests = [];
await listMcpTools({
  server: {
    ...server,
    bearerToken: "server-secret",
  },
  token: "   ",
  fetcher: async (_url, init = {}) => {
    const body = JSON.parse(init.body);
    blankTokenRequests.push({ init, body });
    if (body.method === "initialize") {
      return {
        ok: true,
        headers: new Map(),
        json: async () => ({ jsonrpc: "2.0", id: body.id, result: {} }),
        text: async () => "",
      };
    }
    if (body.method === "notifications/initialized") {
      return {
        ok: true,
        headers: new Map(),
        json: async () => ({}),
        text: async () => "",
      };
    }
    return {
      ok: true,
      headers: new Map(),
      json: async () => ({ jsonrpc: "2.0", id: body.id, result: { tools: [] } }),
      text: async () => "",
    };
  },
});
assert.equal(blankTokenRequests[0].init.headers.Authorization, "Bearer server-secret");

await assert.rejects(
  () =>
    listMcpTools({
      server,
      fetcher: async (_url, init = {}) => {
        const body = JSON.parse(init.body);
        if (body.method === "initialize") {
          return {
            ok: true,
            headers: new Map(),
            json: async () => ({ jsonrpc: "2.0", id: body.id, result: {} }),
            text: async () => "",
          };
        }
        if (body.method === "notifications/initialized") {
          return {
            ok: true,
            headers: new Map(),
            json: async () => ({}),
            text: async () => "",
          };
        }
        return {
          ok: true,
          headers: new Map(),
          json: async () => ({ jsonrpc: "2.0", id: body.id + 10, result: { tools: [] } }),
          text: async () => "",
        };
      },
    }),
  /响应缺少 result/,
);

await assert.rejects(
  () =>
    listMcpTools({
      server,
      fetcher: async (_url, init = {}) => {
        const body = JSON.parse(init.body);
        if (body.method === "initialize") {
          return {
            ok: true,
            headers: new Map(),
            json: async () => ({ jsonrpc: "2.0", id: body.id, result: {} }),
            text: async () => "",
          };
        }
        if (body.method === "notifications/initialized") {
          return {
            ok: true,
            headers: new Map(),
            json: async () => ({}),
            text: async () => "",
          };
        }
        return {
          ok: true,
          headers: new Map(),
          json: async () => ({
            jsonrpc: "2.0",
            method: "notifications/progress",
            params: { progress: 1 },
          }),
          text: async () => "",
        };
      },
    }),
  /响应缺少 result/,
);

const slowBodyResult = await Promise.race([
  listMcpTools({
    server,
    timeoutMs: 20,
    fetcher: async (_url, init = {}) => {
      const body = JSON.parse(init.body);
      if (body.method === "initialize") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (body.method === "notifications/initialized") {
        return new Response("", { status: 202 });
      }
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: { tools: [] },
            })}\n\n`));
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  }).then(
    () => new Error("expected body timeout"),
    (error) => error,
  ),
  new Promise((resolve) => setTimeout(() => resolve("hung"), 120)),
]);
assert.notEqual(slowBodyResult, "hung");
assert.match(slowBodyResult.message, /MCP 请求超时：tools\/list/);

console.log("mcp http client tests passed");
