import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface PortMock {
  postMessage: ReturnType<typeof vi.fn>;
  onMessage: { addListener: ReturnType<typeof vi.fn> };
  onDisconnect: { addListener: ReturnType<typeof vi.fn> };
  emitMessage(message: unknown): void;
}

interface DevtoolsRequest {
  _requestId?: string;
  _resourceType?: string;
  startedDateTime?: string;
  time?: number;
  request?: {
    method?: string;
    url?: string;
    headers?: Array<{ name: string; value: string }>;
    postData?: { text?: string };
  };
  response?: {
    status?: number;
    statusText?: string;
    headers?: Array<{ name: string; value: string }>;
    content?: { mimeType?: string };
  };
  getContent?: (callback: (content?: string, encoding?: string) => void) => void;
}

const LONG_URL = `https://api.example.com/search?q=${"a".repeat(13000)}`;

function createPortMock(): PortMock {
  const messageListeners: Array<(message: unknown) => void> = [];
  return {
    postMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn((listener: (message: unknown) => void) => messageListeners.push(listener)),
    },
    onDisconnect: {
      addListener: vi.fn(),
    },
    emitMessage(message: unknown) {
      messageListeners.forEach((listener) => listener(message));
    },
  };
}

function createRequest(partial: Partial<DevtoolsRequest> = {}): DevtoolsRequest {
  return {
    _requestId: "req-1",
    _resourceType: "xhr",
    startedDateTime: "2026-07-07T08:00:00.000Z",
    time: 12.4,
    request: {
      method: "GET",
      url: "https://api.example.com/user?token=secret&query=visible",
      headers: [
        { name: "X-Debug", value: "Bearer inline-secret" },
        { name: "X-Trace", value: "Basic dXNlcjpwYXNz" },
      ],
    },
    response: {
      status: 200,
      statusText: "OK",
      headers: [{ name: "Content-Type", value: "application/json" }],
      content: { mimeType: "application/json" },
    },
    ...partial,
  };
}

function latestMessage(port: PortMock): Record<string, unknown> {
  return port.postMessage.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

async function importCollector(input: { port?: PortMock; harEntries?: DevtoolsRequest[] } = {}) {
  const port = input.port ?? createPortMock();
  const harEntries = input.harEntries ?? [createRequest({ request: { ...createRequest().request, url: LONG_URL } })];
  const requestFinishedListeners: Array<(request: DevtoolsRequest) => void> = [];
  const navigatedListeners: Array<() => void> = [];
  const getHAR = vi.fn((callback: (har: { entries: DevtoolsRequest[] }) => void) => callback({ entries: harEntries }));

  vi.stubGlobal("chrome", {
    runtime: {
      id: "test-extension-id",
      connect: vi.fn(() => port),
    },
    devtools: {
      inspectedWindow: { tabId: 7 },
      network: {
        onRequestFinished: {
          addListener: vi.fn((listener: (request: DevtoolsRequest) => void) => requestFinishedListeners.push(listener)),
        },
        onNavigated: {
          addListener: vi.fn((listener: () => void) => navigatedListeners.push(listener)),
        },
        getHAR,
      },
    },
  });

  await import("../../../src/devtools/network");

  return { port, requestFinishedListeners, navigatedListeners, getHAR, harEntries };
}

describe("DevTools Network collector", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("连接 network.devtools 端口并发送 connected snapshot 且截断超长 URL", async () => {
    const { port } = await importCollector();

    expect(chrome.runtime.connect).toHaveBeenCalledWith({ name: "network.devtools" });
    expect(port.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "networkContext.devtoolsConnected",
      tabId: 7,
      requests: [expect.objectContaining({ id: "req-1" })],
    }));

    const message = latestMessage(port);
    const request = (message.requests as Array<{ url: string; requestHeaders: Array<{ value: string }> }>)[0];
    expect(request.url).toHaveLength(12000);
  });

  it("扩展上下文失效时不再重连抛错", async () => {
    const port = createPortMock();
    let disconnectListener: (() => void) | undefined;
    port.onDisconnect.addListener = vi.fn((listener: () => void) => {
      disconnectListener = listener;
    });

    vi.stubGlobal("chrome", {
      runtime: {
        id: "test-extension-id",
        connect: vi.fn(() => {
          if (chrome.runtime.id === undefined) {
            throw new Error("Extension context invalidated.");
          }
          return port;
        }),
      },
      devtools: {
        inspectedWindow: { tabId: 7 },
        network: {
          onRequestFinished: { addListener: vi.fn() },
          onNavigated: { addListener: vi.fn() },
          getHAR: vi.fn((callback: (har: { entries: DevtoolsRequest[] }) => void) => callback({ entries: [] })),
        },
      },
    });

    await import("../../../src/devtools/network");
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);

    // Simulate extension reload invalidating this DevTools page context.
    (chrome.runtime as { id?: string }).id = undefined;
    disconnectListener?.();

    await vi.waitFor(() => {
      expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);
    });
  });

  it("connected snapshot 会脱敏非敏感 header 值中的 Bearer 和 Basic token", async () => {
    const { port } = await importCollector({ harEntries: [createRequest()] });

    const message = latestMessage(port);
    const request = (message.requests as Array<{ url: string; requestHeaders: Array<{ value: string }> }>)[0];
    expect(JSON.stringify(request.requestHeaders)).not.toContain("inline-secret");
    expect(JSON.stringify(request.requestHeaders)).not.toContain("dXNlcjpwYXNz");
    expect(request.requestHeaders).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "X-Debug", value: "Bearer [已脱敏]" }),
      expect.objectContaining({ name: "X-Trace", value: "Basic [已脱敏]" }),
    ]));
  });

  it("onRequestFinished 记录请求并发送 snapshotUpdated", async () => {
    const { port, requestFinishedListeners } = await importCollector({ harEntries: [] });
    port.postMessage.mockClear();

    requestFinishedListeners[0](createRequest({ _requestId: "live-1" }));

    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "networkContext.snapshotUpdated",
      tabId: 7,
      requests: [expect.objectContaining({ id: "live-1" })],
    }));
  });

  it("onNavigated 清空旧请求并刷新 HAR snapshot", async () => {
    const { port, requestFinishedListeners, navigatedListeners, getHAR, harEntries } = await importCollector({ harEntries: [] });
    requestFinishedListeners[0](createRequest({ _requestId: "before-nav" }));
    port.postMessage.mockClear();
    harEntries.push(createRequest({ _requestId: "after-nav" }));

    navigatedListeners[0]();

    expect(getHAR).toHaveBeenCalledTimes(2);
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "networkContext.devtoolsConnected",
      requests: [expect.objectContaining({ id: "after-nav" })],
    }));
    expect(JSON.stringify(latestMessage(port))).not.toContain("before-nav");
  });

  it("getDetails 读取并截断响应体后发送 detailsResponse", async () => {
    const responseBody = "x".repeat(13000);
    const getContent = vi.fn((callback: (content?: string, encoding?: string) => void) => callback(responseBody, "base64"));
    const { port, requestFinishedListeners } = await importCollector({ harEntries: [] });
    requestFinishedListeners[0](createRequest({ _requestId: "detail-1", getContent }));
    port.postMessage.mockClear();

    port.emitMessage({ type: "networkContext.getDetails", rpcId: "rpc-1", requestIds: ["detail-1"] });
    await vi.waitFor(() => {
      expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: "networkContext.detailsResponse",
        rpcId: "rpc-1",
      }));
    });

    expect(getContent).toHaveBeenCalledTimes(1);
    const message = latestMessage(port) as { response: { details: Array<{ responseBody?: string; responseBodyEncoding?: string; truncated?: boolean }> } };
    expect(message.response.details[0].responseBody).toHaveLength(12000);
    expect(message.response.details[0].responseBodyEncoding).toBe("base64");
    expect(message.response.details[0].truncated).toBe(true);
  });
});
