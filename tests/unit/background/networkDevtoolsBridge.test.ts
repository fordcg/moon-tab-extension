import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserNetworkToolExecutor } from "../../../src/background/browserControl/networkToolExecutor";
import { createNetworkDevtoolsBridge } from "../../../src/background/networkDevtoolsBridge";
import type { ModelToolCall } from "../../../src/shared/models/types";
import type { NetworkRequestDetail, NetworkRequestMeta } from "../../../src/shared/types";

interface PortMock {
  name: string;
  sender?: chrome.runtime.MessageSender;
  postMessage: ReturnType<typeof vi.fn>;
  onMessage: { addListener: ReturnType<typeof vi.fn> };
  onDisconnect: { addListener: ReturnType<typeof vi.fn> };
  fireMessage(message: unknown): void;
  fireDisconnect(): void;
}

const DEVTOOLS_PAGE_URL = "chrome-extension://moon-tab/src/ai-assistant/devtools.html";

function createPortMock(name = "network.devtools", sender: chrome.runtime.MessageSender = { url: DEVTOOLS_PAGE_URL }): PortMock {
  const messageListeners: Array<(message: unknown) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  return {
    name,
    sender,
    postMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn((listener: (message: unknown) => void) => messageListeners.push(listener)),
    },
    onDisconnect: {
      addListener: vi.fn((listener: () => void) => disconnectListeners.push(listener)),
    },
    fireMessage(message: unknown) {
      messageListeners.forEach((listener) => listener(message));
    },
    fireDisconnect() {
      disconnectListeners.forEach((listener) => listener());
    },
  };
}

function createMeta(partial: Partial<NetworkRequestMeta> = {}): NetworkRequestMeta {
  return {
    id: "req-1",
    url: "https://api.example.com/search?token=secret&sign=abcdef1234567890abcdef1234567890",
    method: "GET",
    status: 200,
    resourceType: "XHR",
    requestHeaders: [{ name: "Authorization", value: "Bearer secret" }],
    responseHeaders: [{ name: "Content-Type", value: "application/json" }],
    requestBody: undefined,
    ...partial,
  };
}

function createDetail(partial: Partial<NetworkRequestDetail> = {}): NetworkRequestDetail {
  return {
    ...createMeta(partial),
    responseBody: "{\"ok\":true,\"password\":\"hidden\"}",
    truncated: false,
    redacted: false,
    ...partial,
  };
}

function createToolCall(name: string, args: Record<string, unknown> = {}): ModelToolCall {
  return { id: `call-${name}`, name, arguments: args };
}

interface GetDetailsRequestMessage {
  type: "networkContext.getDetails";
  rpcId: string;
}

function isGetDetailsRequestMessage(message: unknown): message is GetDetailsRequestMessage {
  return (
    typeof message === "object"
    && message !== null
    && "type" in message
    && message.type === "networkContext.getDetails"
    && "rpcId" in message
    && typeof message.rpcId === "string"
  );
}

function findLatestDetailsRequest(port: PortMock): GetDetailsRequestMessage | undefined {
  const calls: unknown[][] = port.postMessage.mock.calls;
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const message = calls[index]?.[0];
    if (isGetDetailsRequestMessage(message)) {
      return message;
    }
  }
  return undefined;
}

function respondToLatestDetails(port: PortMock, details: NetworkRequestDetail[]): void {
  const detailRequest = findLatestDetailsRequest(port);
  expect(detailRequest).toMatchObject({ type: "networkContext.getDetails" });
  if (!detailRequest) {
    throw new Error("Expected latest getDetails request message");
  }
  port.fireMessage({
    type: "networkContext.detailsResponse",
    rpcId: detailRequest.rpcId,
    response: { ok: true, details },
  });
}

describe("DevTools Network bridge 兼容层", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://moon-tab/${path}`),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("接收 network.devtools 端口快照并通过 runtime 消息读取、详情和清空", async () => {
    const bridge = createNetworkDevtoolsBridge();
    const port = createPortMock();

    expect(bridge.handlePortConnect(port as unknown as chrome.runtime.Port)).toBe(true);
    port.fireMessage({ type: "networkContext.devtoolsConnected", tabId: 7, requests: [createMeta()] });

    await expect(bridge.handleMessage({ type: "networkContext.getSnapshot", tabId: 7 })).resolves.toMatchObject({
      ok: true,
      tabId: 7,
      requests: [expect.objectContaining({ id: "req-1", url: expect.stringContaining("token=[已脱敏]") })],
    });

    const detailsPromise = bridge.handleMessage({ type: "networkContext.getDetails", tabId: 7, requestIds: ["req-1"] });
    respondToLatestDetails(port, [createDetail()]);
    await expect(detailsPromise).resolves.toMatchObject({
      ok: true,
      details: [expect.objectContaining({
        requestHeaders: [expect.objectContaining({ value: "[已脱敏]" })],
        responseBody: "{\"ok\":true,\"password\":\"[已脱敏]\"}",
      })],
    });

    await expect(bridge.handleMessage({ type: "networkContext.clearRequests", tabId: 7 })).resolves.toEqual({ ok: true });
    expect(port.postMessage).toHaveBeenCalledWith({ type: "networkContext.clearRequests", tabId: 7 });
    await expect(bridge.handleMessage({ type: "networkContext.getSnapshot", tabId: 7 })).resolves.toEqual({ ok: true, tabId: 7, requests: [] });
  });

  it("拒绝非 DevTools 页面的 network.devtools 端口，避免任意扩展页注册 tab 快照", async () => {
    const bridge = createNetworkDevtoolsBridge();
    const port = createPortMock("network.devtools", { url: "chrome-extension://moon-tab/index.html" });

    expect(bridge.handlePortConnect(port as unknown as chrome.runtime.Port)).toBe(false);
    expect(port.onMessage.addListener).not.toHaveBeenCalled();

    port.fireMessage({ type: "networkContext.devtoolsConnected", tabId: 7, requests: [createMeta()] });

    await expect(bridge.handleMessage({ type: "networkContext.getSnapshot", tabId: 7 })).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("DevTools Network"),
    });
  });

  it("拒绝其他扩展 host 的同路径 DevTools port", async () => {
    const bridge = createNetworkDevtoolsBridge();
    const port = createPortMock("network.devtools", { url: "chrome-extension://other-extension/src/ai-assistant/devtools.html" });

    expect(bridge.handlePortConnect(port as unknown as chrome.runtime.Port)).toBe(false);
    port.fireMessage({ type: "networkContext.devtoolsConnected", tabId: 7, requests: [createMeta()] });

    await expect(bridge.handleMessage({ type: "networkContext.getSnapshot", tabId: 7 })).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("DevTools Network"),
    });
  });

  it("多 tab 场景只按显式 tabId 路由快照，隐式请求不猜测 tab", async () => {
    const bridge = createNetworkDevtoolsBridge();
    const portA = createPortMock();
    const portB = createPortMock();
    bridge.handlePortConnect(portA as unknown as chrome.runtime.Port);
    bridge.handlePortConnect(portB as unknown as chrome.runtime.Port);
    portA.fireMessage({ type: "networkContext.devtoolsConnected", tabId: 7, requests: [createMeta({ id: "tab-7" })] });
    portB.fireMessage({ type: "networkContext.devtoolsConnected", tabId: 8, requests: [createMeta({ id: "tab-8" })] });

    await expect(bridge.handleMessage({ type: "networkContext.getSnapshot", tabId: 8 })).resolves.toMatchObject({
      ok: true,
      tabId: 8,
      requests: [expect.objectContaining({ id: "tab-8" })],
    });
    await expect(bridge.handleMessage({ type: "networkContext.getSnapshot" })).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("DevTools Network"),
    });
  });

  it("DevTools port 断开后清除 tab state，隐式 snapshot 不复用旧快照", async () => {
    const bridge = createNetworkDevtoolsBridge();
    const port = createPortMock();
    bridge.handlePortConnect(port as unknown as chrome.runtime.Port);
    port.fireMessage({ type: "networkContext.devtoolsConnected", tabId: 7, requests: [createMeta()] });

    port.fireDisconnect();

    await expect(bridge.handleMessage({ type: "networkContext.getSnapshot" })).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("DevTools Network"),
    });
  });

  it("runtime clearRequests 要求 live port，发送失败时返回错误并移除失效 tab state", async () => {
    const bridge = createNetworkDevtoolsBridge();
    const port = createPortMock();
    bridge.handlePortConnect(port as unknown as chrome.runtime.Port);
    port.fireMessage({ type: "networkContext.devtoolsConnected", tabId: 7, requests: [createMeta()] });
    port.postMessage.mockImplementationOnce(() => {
      throw new Error("disconnected");
    });

    await expect(bridge.handleMessage({ type: "networkContext.clearRequests", tabId: 7 })).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("清空"),
    });
    await expect(bridge.handleMessage({ type: "networkContext.getSnapshot", tabId: 7 })).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("DevTools Network"),
    });
  });

  it("详情 RPC 超时返回错误而不是抛出", async () => {
    vi.useFakeTimers();
    try {
      const bridge = createNetworkDevtoolsBridge();
      const port = createPortMock();
      bridge.handlePortConnect(port as unknown as chrome.runtime.Port);
      port.fireMessage({ type: "networkContext.devtoolsConnected", tabId: 7, requests: [createMeta()] });

      const detailsPromise = bridge.handleMessage({ type: "networkContext.getDetails", tabId: 7, requestIds: ["req-1"] });
      await vi.advanceTimersByTimeAsync(5000);

      await expect(detailsPromise).resolves.toMatchObject({
        ok: false,
        message: expect.stringContaining("超时"),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("DevTools recorder adapter 继续支持旧点号 Network 工具名", async () => {
    const bridge = createNetworkDevtoolsBridge();
    const port = createPortMock();
    bridge.handlePortConnect(port as unknown as chrome.runtime.Port);
    port.fireMessage({
      type: "networkContext.snapshotUpdated",
      tabId: 7,
      requests: [
        createMeta(),
        createMeta({ id: "req-2", url: "https://api.example.com/search?sign=bbbbbb1234567890abcdef1234567890" }),
        createMeta({ id: "js-1", url: "https://example.com/assets/app.js", resourceType: "Script", mimeType: "application/javascript" }),
      ],
    });
    const executor = new BrowserNetworkToolExecutor(bridge.createRecorderAdapter(7));

    await expect(executor.execute(createToolCall("network.list_requests", { limit: 2 }))).resolves.toMatchObject({
      content: expect.stringContaining("req-2"),
    });

    const getDetailsPromise = executor.execute(createToolCall("network.get_request_details", { requestIds: ["req-1"] }));
    respondToLatestDetails(port, [createDetail()]);
    await expect(getDetailsPromise).resolves.toMatchObject({ content: expect.stringContaining("Response body") });

    const comparePromise = executor.execute(createToolCall("network.compare_requests", { requestIds: ["req-1", "req-2"] }));
    respondToLatestDetails(port, [createDetail(), createDetail({ id: "req-2", url: "https://api.example.com/search?sign=bbbbbb1234567890abcdef1234567890" })]);
    await expect(comparePromise).resolves.toMatchObject({ content: expect.stringContaining("变化字段") });

    const candidatesPromise = executor.execute(createToolCall("network.find_parameter_candidates", { requestIds: ["req-1"] }));
    respondToLatestDetails(port, [createDetail()]);
    await expect(candidatesPromise).resolves.toMatchObject({ content: expect.stringContaining("疑似签名字段") });

    const jsPromise = executor.execute(createToolCall("network.extract_js_candidates", { requestIds: ["js-1"], keywords: ["makeSign"] }));
    respondToLatestDetails(port, [createDetail({
      id: "js-1",
      url: "https://example.com/assets/app.js",
      resourceType: "Script",
      mimeType: "application/javascript",
      responseBody: "function makeSign(){ return 'signed'; }",
    })]);
    await expect(jsPromise).resolves.toMatchObject({ content: expect.stringContaining("app.js") });

    await expect(executor.execute(createToolCall("network.clear_requests"))).resolves.toMatchObject({
      content: "已清空当前受控页面的 Network 请求缓存。",
    });
  });

  it("DevTools recorder adapter 即使被请求 raw 也只返回脱敏数据，避免误接入 full-access 原文流", async () => {
    const bridge = createNetworkDevtoolsBridge();
    const port = createPortMock();
    bridge.handlePortConnect(port as unknown as chrome.runtime.Port);
    port.fireMessage({ type: "networkContext.snapshotUpdated", tabId: 7, requests: [createMeta()] });

    const adapter = bridge.createRecorderAdapter(7);
    expect(adapter.listRequests({}, { redacted: false })[0]).toMatchObject({
      url: expect.stringContaining("token=[已脱敏]"),
      requestHeaders: [expect.objectContaining({ value: "[已脱敏]" })],
    });

    const detailsPromise = adapter.getDetails(["req-1"], { redacted: false });
    respondToLatestDetails(port, [createDetail()]);
    await expect(detailsPromise).resolves.toMatchObject([
      expect.objectContaining({
        requestHeaders: [expect.objectContaining({ value: "[已脱敏]" })],
        responseBody: "{\"ok\":true,\"password\":\"[已脱敏]\"}",
      }),
    ]);
  });
});
