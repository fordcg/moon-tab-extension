import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_TOOLS_AUDIT_KEY,
  AGENT_TOOLS_SETTINGS_KEY,
  handleAgentToolsMessage,
} from "../../../src/background/agentToolsMessageHandler";
import { getMcpBearerToken, getMcpSettings } from "../../../src/shared/mcp/settings";
import { createMcpToolId } from "../../../src/shared/mcp/toolAdapter";
import { clearDatabase, getAppSetting } from "../../../src/shared/storage/repositories";

interface StorageAreaMock {
  data: Map<string, unknown>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

function createStorageAreaMock(initialValues: Record<string, unknown> = {}): StorageAreaMock {
  const data = new Map<string, unknown>(Object.entries(initialValues));
  return {
    data,
    get: vi.fn((keys?: string | string[] | Record<string, unknown> | null, callback?: (items: Record<string, unknown>) => void) => {
      const result: Record<string, unknown> = {};
      const appendKey = (key: string) => {
        if (data.has(key)) {
          result[key] = data.get(key);
        }
      };
      if (typeof keys === "string") {
        appendKey(keys);
      } else if (Array.isArray(keys)) {
        keys.forEach(appendKey);
      } else if (keys && typeof keys === "object") {
        Object.entries(keys).forEach(([key, fallback]) => {
          result[key] = data.has(key) ? data.get(key) : fallback;
        });
      } else {
        for (const [key, value] of data.entries()) {
          result[key] = value;
        }
      }
      callback?.(result);
      return Promise.resolve(result);
    }),
    set: vi.fn((items: Record<string, unknown>, callback?: () => void) => {
      Object.entries(items).forEach(([key, value]) => data.set(key, value));
      callback?.();
      return Promise.resolve();
    }),
    remove: vi.fn((keys: string | string[], callback?: () => void) => {
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => data.delete(key));
      callback?.();
      return Promise.resolve();
    }),
  };
}

function createJsonResponse(data: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

describe("AgentTools 兼容消息处理", () => {
  let localStorage: StorageAreaMock;

  beforeEach(() => {
    localStorage = createStorageAreaMock();
    vi.stubGlobal("chrome", {
      storage: {
        local: localStorage,
      },
    });
  });

  afterEach(async () => {
    await clearDatabase();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("配置 MCP 时把 Bearer Token 留在本地敏感设置，把 Grok API Key 留在扩展本地存储", async () => {
    const fetcher = vi.fn().mockResolvedValue(createJsonResponse({ ok: true }));

    const response = await handleAgentToolsMessage({
      type: "agentTools.configureMcp",
      mcp: {
        servers: [
          {
            id: "mysql",
            name: "MySQL",
            endpointUrl: "https://trusted.example.com/mcp",
            enabled: true,
            bearerToken: "mcp-secret",
          },
        ],
        baseUrl: "http://127.0.0.1:17333/",
        grokBaseUrl: "https://api.x.ai/v1",
        grokModel: "grok-4.20-multi-agent-xhigh",
        grokApiKey: "xai-secret",
      },
    }, fetcher as unknown as typeof fetch);

    expect(response).toMatchObject({ ok: true });
    await expect(getMcpSettings()).resolves.toMatchObject({
      servers: [expect.objectContaining({ id: "mysql", endpointUrl: "https://trusted.example.com/mcp", tools: [] })],
    });
    await expect(getMcpBearerToken("mysql")).resolves.toBe("mcp-secret");
    await expect(getAppSetting("mcpSettings")).resolves.not.toMatchObject({
      servers: [expect.objectContaining({ bearerToken: expect.anything(), grokApiKey: expect.anything() })],
    });
    expect(localStorage.data.get(AGENT_TOOLS_SETTINGS_KEY)).toMatchObject({
      mcp: expect.objectContaining({ grokApiKey: "xai-secret" }),
    });
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:17333/config", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("xai-secret"),
    }));
  });

  it("AgentTools 审计日志不会写入 MCP Bearer Token 或 Grok API Key 原文", async () => {
    const fetcher = vi.fn().mockResolvedValue(createJsonResponse({ ok: true }));

    await handleAgentToolsMessage({
      type: "agentTools.configureMcp",
      mcp: {
        servers: [{ id: "mysql", name: "MySQL", endpointUrl: "https://trusted.example.com/mcp", enabled: true, bearerToken: "mcp-secret" }],
        baseUrl: "http://127.0.0.1:17333/",
        grokApiKey: "xai-secret",
      },
    }, fetcher as unknown as typeof fetch);

    const audit = localStorage.data.get(AGENT_TOOLS_AUDIT_KEY);
    expect(JSON.stringify(audit)).not.toContain("mcp-secret");
    expect(JSON.stringify(audit)).not.toContain("xai-secret");
    expect(JSON.stringify(audit)).toContain("[已脱敏]");
  });

  it("远程 MCP bridge baseUrl 配置 Grok 时不推送 API Key", async () => {
    const fetcher = vi.fn().mockResolvedValue(createJsonResponse({ ok: true }));

    const response = await handleAgentToolsMessage({
      type: "agentTools.configureMcp",
      mcp: {
        servers: [
          {
            id: "remote",
            name: "Remote",
            endpointUrl: "https://trusted.example.com/mcp",
            enabled: true,
            bearerToken: "mcp-secret",
          },
        ],
        baseUrl: "https://evil.example.com/",
        grokBaseUrl: "https://api.x.ai/v1",
        grokModel: "grok-4.20-multi-agent-xhigh",
        grokApiKey: "xai-secret",
      },
    }, fetcher as unknown as typeof fetch);

    expect(response).toMatchObject({ ok: true });
    await expect(getMcpSettings()).resolves.toMatchObject({
      servers: [expect.objectContaining({ id: "remote", endpointUrl: "https://trusted.example.com/mcp" })],
    });
    await expect(getMcpBearerToken("remote")).resolves.toBe("mcp-secret");
    expect(localStorage.data.get(AGENT_TOOLS_SETTINGS_KEY)).toMatchObject({
      mcp: expect.objectContaining({
        baseUrl: "https://evil.example.com/",
        grokApiKey: "xai-secret",
      }),
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("非法 MCP bridge baseUrl 配置 Grok 时保持兼容并跳过推送", async () => {
    const fetcher = vi.fn().mockResolvedValue(createJsonResponse({ ok: true }));

    const response = await handleAgentToolsMessage({
      type: "agentTools.configureMcp",
      mcp: {
        baseUrl: "not a url",
        grokApiKey: "xai-secret",
      },
    }, fetcher as unknown as typeof fetch);

    expect(response).toMatchObject({ ok: true });
    expect(localStorage.data.get(AGENT_TOOLS_SETTINGS_KEY)).toMatchObject({
      mcp: expect.objectContaining({
        baseUrl: "not a url",
        grokApiKey: "xai-secret",
      }),
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("非 http(s) scheme 的本地 MCP bridge baseUrl 配置 Grok 时跳过推送", async () => {
    const fetcher = vi.fn().mockResolvedValue(createJsonResponse({ ok: true }));

    const response = await handleAgentToolsMessage({
      type: "agentTools.configureMcp",
      mcp: {
        baseUrl: "ftp://localhost/",
        grokApiKey: "xai-secret",
      },
    }, fetcher as unknown as typeof fetch);

    expect(response).toMatchObject({ ok: true });
    expect(localStorage.data.get(AGENT_TOOLS_SETTINGS_KEY)).toMatchObject({
      mcp: expect.objectContaining({
        baseUrl: "ftp://localhost/",
        grokApiKey: "xai-secret",
      }),
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("本地 MCP bridge baseUrl 带路径时沿用相对路径 config 推送", async () => {
    const fetcher = vi.fn().mockResolvedValue(createJsonResponse({ ok: true }));

    const response = await handleAgentToolsMessage({
      type: "agentTools.configureMcp",
      mcp: {
        baseUrl: "http://127.0.0.1:17333/mcp/",
        grokApiKey: "xai-secret",
      },
    }, fetcher as unknown as typeof fetch);

    expect(response).toMatchObject({ ok: true });
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:17333/mcp/config", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("xai-secret"),
    }));
  });

  it.each([
    "http://127.0.0.1.evil.example/",
    "http://127.0.0.1@evil.example/",
  ])("remote-bypass 形态 MCP bridge baseUrl %s 配置 Grok 时跳过推送", async (baseUrl) => {
    const fetcher = vi.fn().mockResolvedValue(createJsonResponse({ ok: true }));

    const response = await handleAgentToolsMessage({
      type: "agentTools.configureMcp",
      mcp: {
        baseUrl,
        grokApiKey: "xai-secret",
      },
    }, fetcher as unknown as typeof fetch);

    expect(response).toMatchObject({ ok: true });
    expect(localStorage.data.get(AGENT_TOOLS_SETTINGS_KEY)).toMatchObject({
      mcp: expect.objectContaining({
        baseUrl,
        grokApiKey: "xai-secret",
      }),
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("刷新 MCP 工具列表只读取已保存配置和本地 Bearer Token", async () => {
    await handleAgentToolsMessage({
      type: "agentTools.configureMcp",
      mcp: {
        servers: [
          { id: "mysql", name: "MySQL", endpointUrl: "https://trusted.example.com/mcp", enabled: true, bearerToken: "secret" },
          { id: "disabled", name: "Disabled", endpointUrl: "https://disabled.example.com/mcp", enabled: false, bearerToken: "disabled-secret" },
        ],
      },
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }, { "Mcp-Session-Id": "session-1" }))
      .mockResolvedValueOnce(createJsonResponse(null))
      .mockResolvedValueOnce(createJsonResponse({
        jsonrpc: "2.0",
        id: 2,
        result: { tools: [{ name: "query", description: "Run SQL", inputSchema: { type: "object", properties: {} } }] },
      }));

    const response = await handleAgentToolsMessage({ type: "agentTools.refreshMcp", serverId: "mysql" }, fetcher as unknown as typeof fetch);

    expect(response).toMatchObject({
      ok: true,
      mcp: {
        servers: [
          expect.objectContaining({ id: "mysql", tools: [expect.objectContaining({ name: "query" })] }),
          expect.objectContaining({ id: "disabled", tools: [] }),
        ],
      },
    });
    expect(fetcher).toHaveBeenCalledWith("https://trusted.example.com/mcp", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer secret" }),
    }));
    expect(fetcher).not.toHaveBeenCalledWith("https://disabled.example.com/mcp", expect.anything());
  });

  it("调用已注册 MCP 工具并写入脱敏审计日志", async () => {
    await handleAgentToolsMessage({
      type: "agentTools.configureMcp",
      mcp: {
        servers: [
          {
            id: "mysql",
            name: "MySQL",
            endpointUrl: "https://trusted.example.com/mcp",
            enabled: true,
            bearerToken: "secret",
            tools: [{ name: "query", description: "Run SQL", inputSchema: { type: "object", properties: {} } }],
          },
        ],
      },
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }, { "Mcp-Session-Id": "session-1" }))
      .mockResolvedValueOnce(createJsonResponse(null))
      .mockResolvedValueOnce(createJsonResponse({
        jsonrpc: "2.0",
        id: 2,
        result: { content: [{ type: "text", text: "token=server-secret password=hidden" }] },
      }));

    const response = await handleAgentToolsMessage({
      type: "agentTools.call",
      toolId: createMcpToolId("mysql", "query"),
      input: { sql: "select 1", apiKey: "client-secret", nested: { password: "client-password" } },
    }, fetcher as unknown as typeof fetch);

    expect(response).toEqual({ ok: true, content: "token=server-secret password=hidden" });
    const auditResponse = await handleAgentToolsMessage({ type: "agentTools.getAuditLog" });
    expect(auditResponse).toMatchObject({
      ok: true,
      auditLog: expect.arrayContaining([expect.objectContaining({ tool: expect.objectContaining({ id: createMcpToolId("mysql", "query") }) })]),
    });
    const auditText = JSON.stringify(localStorage.data.get(AGENT_TOOLS_AUDIT_KEY));
    expect(auditText).not.toContain("client-secret");
    expect(auditText).not.toContain("client-password");
    expect(auditText).not.toContain("server-secret");
    expect(auditText).not.toContain("hidden");
    expect(auditText).toContain("[已脱敏]");
  });

  it("MCP 审计日志会完整脱敏字符串里的 Bearer Authorization", async () => {
    await handleAgentToolsMessage({
      type: "agentTools.configureMcp",
      mcp: {
        servers: [
          {
            id: "mysql",
            name: "MySQL",
            endpointUrl: "https://trusted.example.com/mcp",
            enabled: true,
            bearerToken: "secret",
            tools: [{ name: "query", description: "Run SQL", inputSchema: { type: "object", properties: {} } }],
          },
        ],
      },
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }, { "Mcp-Session-Id": "session-1" }))
      .mockResolvedValueOnce(createJsonResponse(null))
      .mockResolvedValueOnce(createJsonResponse({
        jsonrpc: "2.0",
        id: 2,
        result: { content: [{ type: "text", text: "Authorization: Bearer mcp-secret\nauthorization=Bearer second-secret" }] },
      }));

    await handleAgentToolsMessage({
      type: "agentTools.call",
      toolId: createMcpToolId("mysql", "query"),
      input: { sql: "select 1" },
    }, fetcher as unknown as typeof fetch);

    const auditText = JSON.stringify(localStorage.data.get(AGENT_TOOLS_AUDIT_KEY));
    expect(auditText).not.toContain("mcp-secret");
    expect(auditText).not.toContain("second-secret");
    expect(auditText).toContain("[已脱敏]");
  });

  it("返回状态、读取审计和清空审计保持旧响应形状", async () => {
    localStorage.data.set(AGENT_TOOLS_AUDIT_KEY, [{ id: "audit-1", startedAt: 1 }]);

    await expect(handleAgentToolsMessage({ type: "agentTools.getStatus" }, fetch, [{ id: "system.current_time", name: "get_current_time", parameters: {} }])).resolves.toMatchObject({
      ok: true,
      settings: { mcp: { servers: [] } },
      builtInTools: [expect.objectContaining({ id: "system.current_time" })],
      tools: [expect.objectContaining({ id: "system.current_time" })],
      mcp: { servers: [], tools: [] },
      auditLog: [expect.objectContaining({ id: "audit-1" })],
    });
    await expect(handleAgentToolsMessage({ type: "agentTools.getAuditLog" })).resolves.toEqual({
      ok: true,
      auditLog: [{ id: "audit-1", startedAt: 1 }],
    });
    await expect(handleAgentToolsMessage({ type: "agentTools.clearAuditLog" })).resolves.toEqual({ ok: true, auditLog: [] });
    expect(localStorage.data.has(AGENT_TOOLS_AUDIT_KEY)).toBe(false);
  });
});
