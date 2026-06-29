import http from "node:http";

const PORT = Number(process.env.PORT || 17333);
const HOST = process.env.HOST || "127.0.0.1";

const tools = [
  {
    id: "dev.echo",
    name: "Dev Echo",
    description: "回显输入文本，用于验证 AI 侧边栏 MCP Bridge 调用链路。",
    inputSchema: {
      type: "object",
      required: ["text"],
      additionalProperties: false,
      properties: {
        text: {
          type: "string",
          description: "需要回显的文本。",
        },
      },
    },
    handler: async ({ text }) => ({
      ok: true,
      content: `MCP Echo: ${String(text ?? "")}`,
    }),
  },
  {
    id: "dev.current_time",
    name: "Dev Current Time",
    description: "返回本地 Bridge 进程当前时间。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    handler: async () => ({
      ok: true,
      content: new Date().toISOString(),
    }),
  },
  {
    id: "dev.summarize_request",
    name: "Dev Request Summary",
    description: "把接口调试用的请求信息整理成简短摘要；不会记录或返回敏感头原文。",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        method: { type: "string" },
        url: { type: "string" },
        status: { type: "number" },
        note: { type: "string" },
      },
    },
    handler: async (input) => {
      const method = typeof input.method === "string" ? input.method.toUpperCase() : "GET";
      const url = typeof input.url === "string" ? input.url : "";
      const status = Number.isFinite(input.status) ? `，状态 ${input.status}` : "";
      const note = typeof input.note === "string" && input.note.trim() ? `，备注：${input.note.trim()}` : "";
      return {
        ok: true,
        content: `请求摘要：${method} ${url || "(未提供 URL)"}${status}${note}`,
      };
    },
  },
];

const toolMap = new Map(tools.map((tool) => [tool.id, tool]));

const server = http.createServer(async (request, response) => {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`);

  try {
    if (request.method === "GET" && url.pathname === "/tools/list") {
      writeJson(response, 200, {
        tools: tools.map(({ handler: _handler, ...tool }) => tool),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/tools/call") {
      const payload = await readJson(request);
      const toolId = typeof payload.toolId === "string" ? payload.toolId.trim() : "";
      const tool = toolMap.get(toolId);
      if (!tool) {
        writeJson(response, 404, { ok: false, message: `未知工具：${toolId || "(empty)"}` });
        return;
      }

      const result = await tool.handler(
        payload.input && typeof payload.input === "object" && !Array.isArray(payload.input)
          ? payload.input
          : {},
      );
      writeJson(response, 200, result);
      return;
    }

    writeJson(response, 404, {
      ok: false,
      message: "not found",
    });
  } catch (error) {
    writeJson(response, 500, {
      ok: false,
      message: error instanceof Error && error.message ? error.message : "bridge error",
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`AI Sidebar MCP Bridge example listening on http://${HOST}:${PORT}/`);
});

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type,Accept,Authorization");
  response.setHeader("Access-Control-Max-Age", "600");
}

function writeJson(response, status, payload) {
  const raw = JSON.stringify(payload, null, 2);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(raw),
  });
  response.end(raw);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}
