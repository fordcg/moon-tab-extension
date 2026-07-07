import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearDatabase, saveAppSetting, saveModelProvider } from "../../../src/shared/storage/repositories";

type Listener<T extends (...args: never[]) => void> = T;

function createPortMock(name: string, sender: chrome.runtime.MessageSender = {}) {
  const messageListeners: Array<(message: unknown) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  return {
    name,
    sender,
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: {
      addListener: vi.fn((listener: (message: unknown) => void) => messageListeners.push(listener)),
      removeListener: vi.fn(),
    },
    onDisconnect: {
      addListener: vi.fn((listener: () => void) => disconnectListeners.push(listener)),
      removeListener: vi.fn(),
    },
    emitMessage: (message: unknown) => messageListeners.forEach((listener) => listener(message)),
    emitDisconnect: () => disconnectListeners.forEach((listener) => listener()),
  } as unknown as chrome.runtime.Port & {
    emitMessage: (message: unknown) => void;
    emitDisconnect: () => void;
    postMessage: ReturnType<typeof vi.fn>;
  };
}

function createStorageAreaMock(initialValues: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initialValues));
  const read = (keys?: unknown): Record<string, unknown> => {
    if (keys === undefined || keys === null) {
      return Object.fromEntries(data.entries());
    }
    if (typeof keys === "string") {
      return { [keys]: data.get(keys) };
    }
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.map((key) => [String(key), data.get(String(key))]));
    }
    if (keys && typeof keys === "object") {
      return Object.fromEntries(Object.entries(keys as Record<string, unknown>).map(([key, fallback]) => [key, data.has(key) ? data.get(key) : fallback]));
    }
    return {};
  };

  return {
    data,
    get: vi.fn((keys?: unknown, callback?: (items: Record<string, unknown>) => void) => {
      const result = read(keys);
      if (callback) {
        callback(result);
        return undefined;
      }
      return Promise.resolve(result);
    }),
    set: vi.fn((items: Record<string, unknown>, callback?: () => void) => {
      Object.entries(items).forEach(([key, value]) => data.set(key, value));
      if (callback) {
        callback();
        return undefined;
      }
      return Promise.resolve(undefined);
    }),
    remove: vi.fn((keys: string | string[], callback?: () => void) => {
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => data.delete(key));
      if (callback) {
        callback();
        return undefined;
      }
      return Promise.resolve(undefined);
    }),
  };
}

const DEVTOOLS_LEGACY_NETWORK_CASES = [
  { id: "network.list_requests", name: "network_list_requests", arguments: "{\"limit\":1}" },
  { id: "network.get_request_details", name: "network_get_request_details", arguments: "{\"requestIds\":[\"req-1\"]}" },
  { id: "network.clear_requests", name: "network_clear_requests", arguments: "{}" },
  { id: "network.compare_requests", name: "network_compare_requests", arguments: "{\"requestIds\":[\"req-1\",\"req-2\"]}" },
  { id: "network.find_parameter_candidates", name: "network_find_parameter_candidates", arguments: "{\"requestIds\":[\"req-1\"]}" },
  { id: "network.extract_js_candidates", name: "network_extract_js_candidates", arguments: "{\"requestIds\":[\"req-2\"],\"keywords\":[\"sign\"]}" },
] as const;

function createTestModel() {
  return {
    id: "model-1",
    providerId: "provider-1",
    name: "默认模型",
    displayName: "默认模型",
    channelName: "默认渠道",
    endpointType: "openai_chat" as const,
    endpointUrl: "https://api.example.com/v1/chat/completions",
    apiKey: "sk-test",
    modelId: "gpt-test",
    temperature: 0.7,
    maxTokens: 1024,
    systemPrompt: "你是网页助手",
    isTitleModel: false,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function connectDevtoolsNetworkBridge(mock: ReturnType<typeof createChromeMock>, tabId = 7) {
  const devtoolsPort = createPortMock("network.devtools", {
    url: mock.chrome.runtime.getURL("src/devtools/network.html"),
  });
  mock.connectListeners[0](devtoolsPort);
  devtoolsPort.emitMessage({
    type: "networkContext.devtoolsConnected",
    tabId,
    requests: [
      {
        id: "req-1",
        url: "https://api.example.com/user?token=secret&sign=aaa",
        method: "GET",
        status: 200,
        resourceType: "XHR",
        requestHeaders: [{ name: "Authorization", value: "Bearer secret" }],
      },
      {
        id: "req-2",
        url: "https://cdn.example.com/app.js",
        method: "GET",
        status: 200,
        resourceType: "Script",
        responseBody: "function sign(payload){ return payload.token + 'secret'; }",
      },
    ],
  });
  return devtoolsPort;
}

function mockDevtoolsDetailsResponses(devtoolsPort: ReturnType<typeof createPortMock>) {
  devtoolsPort.postMessage.mockImplementation((message: unknown) => {
    if (typeof message !== "object" || message === null || (message as { type?: string }).type !== "networkContext.getDetails") {
      return;
    }
    const detailsRequest = message as { rpcId?: string; requestIds?: string[] };
    if (!detailsRequest.rpcId) {
      return;
    }
    queueMicrotask(() => {
      devtoolsPort.emitMessage({
        type: "networkContext.detailsResponse",
        rpcId: detailsRequest.rpcId,
        response: {
          ok: true,
          details: [
            {
              id: "req-1",
              url: "https://api.example.com/user?token=secret&sign=aaa",
              method: "GET",
              status: 200,
              resourceType: "XHR",
              requestHeaders: [{ name: "Authorization", value: "Bearer secret" }],
            },
            {
              id: "req-2",
              url: "https://cdn.example.com/app.js",
              method: "GET",
              status: 200,
              resourceType: "Script",
              responseBody: "function sign(payload){ return payload.token + 'secret'; }",
            },
          ].filter((detail) => detailsRequest.requestIds?.includes(detail.id)),
        },
      });
    });
  });
}

function createChromeMock() {
  const installedListeners: Array<Listener<() => void>> = [];
  const startupListeners: Array<Listener<() => void>> = [];
  const actionListeners: Array<Listener<(tab: chrome.tabs.Tab) => void>> = [];
  const commandListeners: Array<Listener<(command: string, tab?: chrome.tabs.Tab) => void>> = [];
  const contextListeners: Array<Listener<(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void>> = [];
  const messageListeners: Array<
    Listener<(message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean>
  > = [];
  const connectListeners: Array<Listener<(port: chrome.runtime.Port) => void>> = [];
  const alarmListeners: Array<Listener<(alarm: chrome.alarms.Alarm) => void>> = [];
  const tabActivatedListeners: Array<Listener<(activeInfo: chrome.tabs.OnActivatedInfo) => void>> = [];
  const tabCreatedListeners: Array<Listener<(tab: chrome.tabs.Tab) => void>> = [];
  const tabUpdatedListeners: Array<Listener<(tabId: number, changeInfo: { status?: string }, tab: chrome.tabs.Tab) => void>> = [];
  const tabRemovedListeners: Array<Listener<(tabId: number) => void>> = [];
  const localStorage = createStorageAreaMock();
  const sessionStorage = createStorageAreaMock();

  return {
    installedListeners,
    startupListeners,
    actionListeners,
    commandListeners,
    contextListeners,
    messageListeners,
    connectListeners,
    alarmListeners,
    tabActivatedListeners,
    tabCreatedListeners,
    tabUpdatedListeners,
    tabRemovedListeners,
    localStorage,
    sessionStorage,
    chrome: {
      runtime: {
        lastError: undefined as { message: string } | undefined,
        getURL: vi.fn((path: string) => `chrome-extension://moon-tab/${path}`),
        onInstalled: {
          addListener: vi.fn((listener: Listener<() => void>) => installedListeners.push(listener)),
        },
        onStartup: {
          addListener: vi.fn((listener: Listener<() => void>) => startupListeners.push(listener)),
        },
        onMessage: {
          addListener: vi.fn(
            (
              listener: Listener<
                (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean
              >,
            ) => messageListeners.push(listener),
          ),
        },
        onConnect: {
          addListener: vi.fn((listener: Listener<(port: chrome.runtime.Port) => void>) => connectListeners.push(listener)),
        },
      },
      alarms: {
        create: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(true),
        get: vi.fn().mockResolvedValue(undefined),
        onAlarm: {
          addListener: vi.fn((listener: Listener<(alarm: chrome.alarms.Alarm) => void>) => alarmListeners.push(listener)),
        },
      },
      storage: {
        local: localStorage,
        session: sessionStorage,
        sync: {
          QUOTA_BYTES_PER_ITEM: 8192,
          set: vi.fn().mockResolvedValue(undefined),
          get: vi.fn().mockResolvedValue({}),
          getKeys: vi.fn().mockResolvedValue([]),
          remove: vi.fn().mockResolvedValue(undefined),
        },
      },
      contextMenus: {
        create: vi.fn(),
        onClicked: {
          addListener: vi.fn((listener: Listener<(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void>) =>
            contextListeners.push(listener),
          ),
        },
      },
      sidePanel: {
        open: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        setOptions: vi.fn().mockResolvedValue(undefined),
        setPanelBehavior: vi.fn().mockResolvedValue(undefined),
      },
      action: {
        onClicked: {
          addListener: vi.fn((listener: Listener<(tab: chrome.tabs.Tab) => void>) => actionListeners.push(listener)),
        },
      },
      commands: {
        onCommand: {
          addListener: vi.fn((listener: Listener<(command: string, tab?: chrome.tabs.Tab) => void>) => commandListeners.push(listener)),
        },
      },
      tabs: {
        get: vi.fn().mockResolvedValue({ id: 7, windowId: 3, url: "https://example.com/article" }),
        query: vi.fn().mockResolvedValue([{ id: 7, windowId: 3, url: "https://example.com/article" }]),
        onActivated: {
          addListener: vi.fn((listener: Listener<(activeInfo: chrome.tabs.OnActivatedInfo) => void>) => tabActivatedListeners.push(listener)),
        },
        onCreated: {
          addListener: vi.fn((listener: Listener<(tab: chrome.tabs.Tab) => void>) => tabCreatedListeners.push(listener)),
        },
        onUpdated: {
          addListener: vi.fn((listener: Listener<(tabId: number, changeInfo: { status?: string }, tab: chrome.tabs.Tab) => void>) =>
            tabUpdatedListeners.push(listener),
          ),
        },
        onRemoved: {
          addListener: vi.fn((listener: Listener<(tabId: number) => void>) => tabRemovedListeners.push(listener)),
        },
        captureVisibleTab: vi.fn().mockResolvedValue("data:image/png;base64,QUJD"),
        sendMessage: vi.fn().mockResolvedValue({
          ok: true,
          url: "https://example.com/article",
          text: "正文内容",
          truncated: false,
          usedFallback: false,
          matchedRuleId: "rule-1",
        }),
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue(undefined),
      },
      debugger: {
        attach: vi.fn((_debuggee: chrome.debugger.Debuggee, _version: string, callback: () => void) => callback()),
        detach: vi.fn((_debuggee: chrome.debugger.Debuggee, callback: () => void) => callback()),
        sendCommand: vi.fn((_debuggee: chrome.debugger.Debuggee, _method: string, _params: unknown, callback: (result?: unknown) => void) =>
          callback({}),
        ),
        onDetach: {
          addListener: vi.fn(),
        },
      },
    },
  };
}

describe("background 入口", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await clearDatabase();
  });

  it("安装时创建打开侧边栏的右键菜单", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);

    await import("../../../src/background/index");
    mock.installedListeners[0]();

    expect(mock.chrome.contextMenus.create).toHaveBeenCalledWith({
      id: "open-side-panel",
      title: "打开 AI 助手",
      contexts: ["page"],
    });
  });

  it("支持插件图标、快捷键和右键菜单打开侧边栏", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);

    await import("../../../src/background/index");

    mock.actionListeners[0]({ id: 3 } as chrome.tabs.Tab);
    mock.commandListeners[0]("open-side-panel", { id: 7 } as chrome.tabs.Tab);
    await mock.contextListeners[0]({ menuItemId: "open-side-panel" } as chrome.contextMenus.OnClickData, {
      id: 9,
    } as chrome.tabs.Tab);

    expect(mock.chrome.sidePanel.open).toHaveBeenNthCalledWith(1, { tabId: 3 });
    expect(mock.chrome.sidePanel.open).toHaveBeenNthCalledWith(2, { tabId: 7 });
    expect(mock.chrome.sidePanel.open).toHaveBeenNthCalledWith(3, { tabId: 9 });
  });

  it("快捷键无 tab fallback 查询当前活动页并打开 tab scoped 侧边栏", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);

    await import("../../../src/background/index");
    mock.chrome.sidePanel.open.mockClear();
    mock.chrome.sidePanel.setOptions.mockClear();
    mock.chrome.storage.session.set.mockClear();

    mock.commandListeners[0]("open-side-panel");

    await vi.waitFor(() => {
      expect(mock.chrome.sidePanel.setOptions).toHaveBeenCalledWith({ tabId: 7, path: "index.html", enabled: true });
      expect(mock.chrome.storage.session.set).toHaveBeenCalledWith({ "sidePanel.openedTabs.v1": [7] });
    });
    expect(mock.chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 7 });
  });

  it("tab scoped 侧边栏打开时启用当前 tab 并记录 session 状态", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);

    await import("../../../src/background/index");

    mock.actionListeners[0]({ id: 3, windowId: 1, url: "https://example.com/a" } as chrome.tabs.Tab);

    expect(mock.chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 3 });
    await vi.waitFor(() => {
      expect(mock.chrome.sidePanel.setOptions).toHaveBeenCalledWith({ tabId: 3, path: "index.html", enabled: true });
      expect(mock.chrome.storage.session.set).toHaveBeenCalledWith({ "sidePanel.openedTabs.v1": [3] });
    });
  });

  it("tab scoped 侧边栏在同窗口新标签页继承已打开状态", async () => {
    const mock = createChromeMock();
    mock.sessionStorage.data.set("sidePanel.openedTabs.v1", [3]);
    vi.stubGlobal("chrome", mock.chrome);

    await import("../../../src/background/index");
    mock.chrome.tabs.query.mockClear();
    mock.chrome.sidePanel.setOptions.mockClear();
    mock.chrome.tabs.query.mockResolvedValue([{ id: 3, windowId: 2, url: "https://example.com/a" }]);

    mock.tabCreatedListeners[0]({ id: 4, windowId: 2, url: "https://example.com/b" } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(mock.chrome.sidePanel.setOptions).toHaveBeenCalledWith({ tabId: 4, path: "index.html", enabled: true });
      expect(mock.chrome.storage.session.set).toHaveBeenCalledWith({ "sidePanel.openedTabs.v1": [3, 4] });
    });
  });

  it("tab scoped 侧边栏切到未打开标签页时关闭窗口残留面板", async () => {
    const mock = createChromeMock();
    mock.sessionStorage.data.set("sidePanel.openedTabs.v1", [3]);
    vi.stubGlobal("chrome", mock.chrome);

    await import("../../../src/background/index");
    mock.chrome.sidePanel.setOptions.mockClear();

    mock.tabActivatedListeners[0]({ tabId: 8, windowId: 2 });

    await vi.waitFor(() => {
      expect(mock.chrome.sidePanel.setOptions).toHaveBeenCalledWith({ tabId: 8, enabled: false });
      expect(mock.chrome.sidePanel.close).toHaveBeenCalledWith({ windowId: 2 });
    });
  });

  it("floating 悬浮助手消息会注入当前网页并关闭原侧边栏", async () => {
    const mock = createChromeMock();
    mock.chrome.tabs.sendMessage.mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("chrome", mock.chrome);

    await import("../../../src/background/index");
    mock.chrome.tabs.query.mockResolvedValueOnce([{ id: 7, windowId: 3, url: "https://example.com/article" }]);
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      { type: "sidePanel.openFloating" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(mock.chrome.tabs.sendMessage).toHaveBeenCalledWith(7, {
        type: "sidePanel.floating.attach",
        url: "chrome-extension://moon-tab/index.html?floating=1&tabId=7&windowId=3",
      });
      expect(mock.chrome.sidePanel.close).toHaveBeenCalledWith({ tabId: 7 });
      expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });
  });

  it("floating 兼容旧入口并在 content script 缺失时注入后重试", async () => {
    const mock = createChromeMock();
    mock.chrome.tabs.sendMessage
      .mockRejectedValueOnce(new Error("Could not establish connection. Receiving end does not exist."))
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("chrome", mock.chrome);

    await import("../../../src/background/index");
    mock.chrome.tabs.query.mockResolvedValueOnce([{ id: 7, windowId: 3, url: "https://example.com/article" }]);
    const sendResponse = vi.fn();

    mock.messageListeners[0](
      { type: "sidepanelFloating.openCurrentTab" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(mock.chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, files: ["content/index.js"] });
      expect(mock.chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
      expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });
  });

  it("floating 悬浮助手拒绝不支持注入的页面并返回中文错误", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);

    await import("../../../src/background/index");
    mock.chrome.tabs.query.mockResolvedValueOnce([{ id: 7, windowId: 3, url: "chrome://settings" }]);
    const sendResponse = vi.fn();

    mock.messageListeners[0](
      { type: "sidePanel.openFloating" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, message: "当前页面不支持悬浮窗，请切换到普通网页后重试。" });
    });
    expect(mock.chrome.tabs.sendMessage).not.toHaveBeenCalledWith(7, expect.objectContaining({ type: "sidePanel.floating.attach" }));
  });

  it("注册渠道模型和页面上下文消息处理器", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);

    await import("../../../src/background/index");

    expect(mock.chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
  });

  it("注册同步备份消息和定时任务处理器", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);

    await import("../../../src/background/index");

    expect(mock.chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(mock.chrome.alarms.onAlarm.addListener).toHaveBeenCalledTimes(1);
  });

  it("direct networkContext.getSnapshot 在无 sender tab 且未显式 tabId 时不会 fallback 读取唯一 DevTools Network tab", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    connectDevtoolsNetworkBridge(mock, 7);
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      { type: "networkContext.getSnapshot" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        message: "未检测到当前标签页 DevTools Network 连接。",
      });
    });
  });

  it("direct networkContext.getSnapshot 在普通无 sender tab 但显式 tabId 时拒绝读取", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    connectDevtoolsNetworkBridge(mock, 7);
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      { type: "networkContext.getSnapshot", tabId: 7 },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        message: "未检测到当前标签页 DevTools Network 连接。",
      });
    });
  });

  it("direct networkContext.getSnapshot 只对 DevTools 页面 sender 显式 tabId 保留兼容读取", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    connectDevtoolsNetworkBridge(mock, 7);
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      { type: "networkContext.getSnapshot", tabId: 7 },
      { url: "chrome-extension://moon-tab/src/devtools/network.html" } as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
        ok: true,
        tabId: 7,
        requests: expect.arrayContaining([expect.objectContaining({ id: "req-1" })]),
      }));
    });
  });

  it("direct networkContext.getSnapshot 拒绝其他扩展 host 的同路径 DevTools sender", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    connectDevtoolsNetworkBridge(mock, 7);
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      { type: "networkContext.getSnapshot", tabId: 7 },
      { url: "chrome-extension://other-extension/src/devtools/network.html" } as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        message: "未检测到当前标签页 DevTools Network 连接。",
      });
    });
  });

  it("direct networkContext.getSnapshot 拒绝旧路径 DevTools sender", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    connectDevtoolsNetworkBridge(mock, 7);
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      { type: "networkContext.getSnapshot", tabId: 7 },
      { url: "chrome-extension://moon-tab/src/ai-assistant/devtools.html" } as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        message: "未检测到当前标签页 DevTools Network 连接。",
      });
    });
  });

  it("direct networkContext.getSnapshot 在 sender tab 与显式 tabId 不一致时返回失败", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    connectDevtoolsNetworkBridge(mock, 9);
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      { type: "networkContext.getSnapshot", tabId: 9 },
      { tab: { id: 7 } as chrome.tabs.Tab },
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        message: "未检测到当前标签页 DevTools Network 连接。",
      });
    });
  });

  it("direct networkContext.getSnapshot 在 sender tab 存在且未带 tabId 时注入当前 tab 并读取该 tab", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    connectDevtoolsNetworkBridge(mock, 7);
    connectDevtoolsNetworkBridge(mock, 9);
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      { type: "networkContext.getSnapshot" },
      { tab: { id: 7 } as chrome.tabs.Tab },
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
        ok: true,
        tabId: 7,
        requests: expect.arrayContaining([expect.objectContaining({ id: "req-1" })]),
      }));
    });
  });

  it("direct networkContext.clearRequests 在无 sender tab 且未显式 tabId 时不会 fallback 清空唯一 DevTools Network tab", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    const devtoolsPort = connectDevtoolsNetworkBridge(mock, 7);
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      { type: "networkContext.clearRequests" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        message: "未检测到当前标签页 DevTools Network 连接。",
      });
    });
    expect(devtoolsPort.postMessage).not.toHaveBeenCalledWith({ type: "networkContext.clearRequests", tabId: 7 });
  });

  it("处理 AgentTools 状态消息并返回当前可暴露的内置工具", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      { type: "agentTools.getStatus" },
      { tab: { id: 7 } as chrome.tabs.Tab },
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
        ok: true,
        builtInTools: expect.arrayContaining([expect.objectContaining({ id: "system.current_time" })]),
        tools: expect.arrayContaining([expect.objectContaining({ id: "system.current_time" })]),
        mcp: expect.objectContaining({ servers: [], tools: [] }),
      }));
    });
    expect(sendResponse.mock.calls[0][0].builtInTools).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "browser.take_snapshot" })]));
  });

  it("AgentTools 状态在仅连接 DevTools Network bridge 时只暴露 allowlist 旧 Network 工具", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    connectDevtoolsNetworkBridge(mock);
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      { type: "agentTools.getStatus" },
      { tab: { id: 7 } as chrome.tabs.Tab },
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    });
    const response = sendResponse.mock.calls[0][0] as { builtInTools: Array<{ id: string }>; tools: Array<{ id: string }> };
    const builtInToolIds = response.builtInTools.map((tool) => tool.id);
    const toolIds = response.tools.map((tool) => tool.id);
    expect(builtInToolIds).toEqual(expect.arrayContaining(DEVTOOLS_LEGACY_NETWORK_CASES.map((tool) => tool.id)));
    expect(toolIds).toEqual(expect.arrayContaining(DEVTOOLS_LEGACY_NETWORK_CASES.map((tool) => tool.id)));
    expect(builtInToolIds).not.toContain("network.wait_for_requests");
    expect(builtInToolIds.some((id) => id.startsWith("js.") || id.startsWith("runtime.") || id.startsWith("full_access."))).toBe(false);
  });

  it("AgentTools 状态不会把其他标签页的 DevTools Network bridge 暴露给当前 sender tab", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    connectDevtoolsNetworkBridge(mock, 9);
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      { type: "agentTools.getStatus" },
      { tab: { id: 7 } as chrome.tabs.Tab },
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    });
    const response = sendResponse.mock.calls[0][0] as { builtInTools: Array<{ id: string }>; tools: Array<{ id: string }> };
    const builtInToolIds = response.builtInTools.map((tool) => tool.id);
    const toolIds = response.tools.map((tool) => tool.id);
    expect(builtInToolIds).not.toEqual(expect.arrayContaining(DEVTOOLS_LEGACY_NETWORK_CASES.map((tool) => tool.id)));
    expect(toolIds).not.toEqual(expect.arrayContaining(DEVTOOLS_LEGACY_NETWORK_CASES.map((tool) => tool.id)));
  });

  it("未知 AgentTools 消息由兼容处理器返回错误", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      { type: "agentTools.unknown" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, message: "未知工具管理请求。" });
    });
  });

  it("处理浏览器控制开关消息并连接当前标签页", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");

    const sendResponse = vi.fn();
    const keepChannel = mock.messageListeners[0](
      { type: "browserControl.setEnabled", enabled: true },
      { tab: { id: 7 } as chrome.tabs.Tab },
      sendResponse,
    );

    expect(keepChannel).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true, attached: true, tabId: 7 }));
    });
    expect(mock.chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 7 }, "1.3", expect.any(Function));
  });

  it("处理运行时只读授权消息并返回响应", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");

    const enableResponse = vi.fn();
    mock.messageListeners[0](
      { type: "browserControl.setEnabled", enabled: true },
      { tab: { id: 7 } as chrome.tabs.Tab },
      enableResponse,
    );
    await vi.waitFor(() => {
      expect(enableResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true, attached: true, tabId: 7 }));
    });

    const sendResponse = vi.fn();
    const keepChannel = mock.messageListeners[0](
      { type: "browserControl.setRuntimeReadonly", enabled: true, reason: "测试" },
      { tab: { id: 7 } as chrome.tabs.Tab },
      sendResponse,
    );

    expect(keepChannel).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true, attached: true, tabId: 7, message: "已切换到普通模式（受限）。" }));
    });
  });

  it("浏览器启动时根据已保存设置恢复自动同步定时任务", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await saveAppSetting({
      key: "syncSettings",
      value: {
        syncEnabled: true,
        autoSyncEnabled: true,
        intervalMinutes: 15,
      },
      updatedAt: 1,
    });
    await import("../../../src/background/index");

    mock.startupListeners[0]();

    await vi.waitFor(() => {
      expect(mock.chrome.alarms.create).toHaveBeenCalledWith("browser-ai-assistant.sync-backup", {
        periodInMinutes: 15,
      });
    });
  });

  it("定时任务触发时无需打开侧边栏即可执行备份", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await saveAppSetting({
      key: "syncSettings",
      value: {
        syncEnabled: true,
        autoSyncEnabled: true,
        provider: "chrome_sync",
        backupPrefix: "work",
        intervalMinutes: 15,
      },
      updatedAt: 1,
    });
    await saveModelProvider({
      id: "provider-1",
      name: "渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com",
      apiKey: "sk-local",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    });
    await import("../../../src/background/index");

    mock.alarmListeners[0]({ name: "browser-ai-assistant.sync-backup" } as chrome.alarms.Alarm);

    await vi.waitFor(() => {
      expect(mock.chrome.storage.sync.set).toHaveBeenCalled();
    });
    const backupItems = mock.chrome.storage.sync.set.mock.calls[0][0] as Record<string, unknown>;
    const backupKey = Object.keys(backupItems)[0];
    expect(backupKey).toMatch(/^browserAiAssistantBackup:work:\d+$/);
    expect(backupItems[backupKey]).toEqual(expect.objectContaining({
      prefix: "work",
      provider: "chrome_sync",
    }));
  });

  it("处理手动备份 runtime 消息", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      { type: "sync.backupNow" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: expect.any(Boolean) }));
    });
  });

  it("处理远程备份列表 runtime 消息", async () => {
    const mock = createChromeMock();
    const backup = {
      version: 1,
      createdAt: 1,
      prefix: "work",
      provider: "chrome_sync",
      encrypted: false,
      payload: { ok: true },
    };
    mock.chrome.storage.sync.getKeys.mockResolvedValue(["browserAiAssistantBackup:work:1"]);
    mock.chrome.storage.sync.get.mockResolvedValue({ "browserAiAssistantBackup:work:1": backup });
    vi.stubGlobal("chrome", mock.chrome);
    await saveAppSetting({
      key: "syncSettings",
      value: { syncEnabled: true, backupPrefix: "work" },
      updatedAt: 1,
    });
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      { type: "sync.listRemoteBackups" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        backups: [
          {
            id: "browserAiAssistantBackup:work:1",
            prefix: "work",
            createdAt: 1,
            provider: "chrome_sync",
            encrypted: false,
          },
        ],
      });
    });
  });

  it("处理指定远程备份恢复 runtime 消息", async () => {
    const mock = createChromeMock();
    const backup = {
      version: 1,
      createdAt: 1,
      prefix: "home",
      provider: "chrome_sync",
      encrypted: false,
      payload: {
        version: 1,
        modelConfigs: [],
        modelProviders: [],
        providerModels: [],
        extractionRules: [],
        chatSessions: [],
        chatFolders: [],
        appSettings: [],
      },
    };
    mock.chrome.storage.sync.get.mockResolvedValue({ "browserAiAssistantBackup:home:1": backup });
    vi.stubGlobal("chrome", mock.chrome);
    await saveAppSetting({
      key: "syncSettings",
      value: { syncEnabled: true, backupPrefix: "work" },
      updatedAt: 1,
    });
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    mock.messageListeners[0](
      { type: "sync.restoreNow", backupId: "browserAiAssistantBackup:home:1" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: true, message: "恢复完成" });
    });
    expect(mock.chrome.storage.sync.get).toHaveBeenCalledWith("browserAiAssistantBackup:home:1");
  });

  it("WebDAV 配置备份时不写入 Chrome Sync", async () => {
    const mock = createChromeMock();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue("") });
    vi.stubGlobal("chrome", mock.chrome);
    vi.stubGlobal("fetch", fetcher);
    await saveAppSetting({
      key: "syncSettings",
      value: {
        syncEnabled: true,
        provider: "webdav",
        backupPrefix: "work",
        webdav: {
          endpointUrl: "https://dav.example.com",
          username: "me",
          remotePath: "browser-ai",
        },
      },
      updatedAt: 1,
    });
    await saveAppSetting({ key: "syncWebDavPassword", value: "pwd", updatedAt: 1 });
    await saveModelProvider({
      id: "provider-1",
      name: "渠道",
      endpointType: "openai_chat",
      endpointUrl: "https://api.example.com",
      apiKey: "sk-local",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    });
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    mock.messageListeners[0](
      { type: "sync.backupNow" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: true, message: "备份完成" });
    });
    expect(mock.chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/dav\.example\.com\/browser-ai\/work--\d+\.json$/),
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("转发当前活动页提取请求到 content script", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      {
        type: "pageContext.extract",
        rules: [],
        maxLength: 100,
        extractMode: "all",
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mock.chrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(mock.chrome.tabs.sendMessage).toHaveBeenCalledWith(7, {
      type: "pageContext.extract",
      rules: [],
      maxLength: 100,
      extractMode: "all",
    });
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      url: "https://example.com/article",
      text: "正文内容",
      truncated: false,
      usedFallback: false,
      matchedRuleId: "rule-1",
    });
  });

  it("列出当前窗口可注入的普通网页标签页", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    mock.chrome.tabs.query.mockClear();
    mock.chrome.tabs.query.mockResolvedValueOnce([
      { id: 7, title: "文章页", url: "https://example.com/article", active: true },
      { id: 8, title: "设置页", url: "chrome://settings", active: false },
      { id: 9, title: "资料页", url: "https://docs.example.com/guide", active: false },
      { title: "无 ID 页面", url: "https://example.com/no-id", active: false },
    ]);
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      { type: "pageContext.listTabs" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        tabs: [
          { tabId: 7, title: "文章页", url: "https://example.com/article", active: true },
          { tabId: 9, title: "资料页", url: "https://docs.example.com/guide", active: false },
        ],
      });
    });
    expect(mock.chrome.tabs.query).toHaveBeenCalledWith({ currentWindow: true });
  });

  it("指定 tabId 时转发提取请求到对应标签页", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    mock.messageListeners[0](
      {
        type: "pageContext.extract",
        tabId: 9,
        rules: [],
        extractMode: "text",
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(mock.chrome.tabs.sendMessage).toHaveBeenCalledWith(9, {
        type: "pageContext.extract",
        rules: [],
        maxLength: undefined,
        extractMode: "text",
      });
    });
    expect(mock.chrome.tabs.query).not.toHaveBeenCalledWith({ active: true, currentWindow: true });
  });

  it("没有活动标签页时返回中文错误", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    mock.chrome.tabs.query.mockResolvedValueOnce([]);
    const sendResponse = vi.fn();

    mock.messageListeners[0](
      {
        type: "pageContext.extract",
        rules: [],
        maxLength: 100,
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        message: "未找到当前活动页面",
      });
    });
  });

  it("截取当前活动标签页可见区域并返回图片附件数据", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    mock.chrome.tabs.query.mockClear();
    mock.chrome.tabs.query.mockResolvedValueOnce([{ id: 7, windowId: 3 }]);
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      {
        type: "tab.captureVisible",
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        attachment: {
          id: expect.stringMatching(/^screenshot-/),
          name: "当前标签页截图.png",
          mediaType: "image/png",
          dataUrl: "data:image/png;base64,QUJD",
        },
      });
    });
    expect(mock.chrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(mock.chrome.tabs.captureVisibleTab).toHaveBeenCalledWith(3, { format: "png" });
  });

  it("当前标签页截图失败时返回明确中文错误", async () => {
    const mock = createChromeMock();
    mock.chrome.tabs.captureVisibleTab.mockRejectedValueOnce(new Error("Cannot access a chrome:// URL"));
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    mock.chrome.tabs.query.mockResolvedValueOnce([{ id: 7, windowId: 3 }]);
    const sendResponse = vi.fn();

    mock.messageListeners[0](
      {
        type: "tab.captureVisible",
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        message: "当前页面无法截图，请切换到普通网页后重试",
      });
    });
  });

  it("content script 未连接时自动注入后重试提取当前页", async () => {
    const mock = createChromeMock();
    mock.chrome.tabs.sendMessage
      .mockRejectedValueOnce(new Error("Could not establish connection. Receiving end does not exist."))
      .mockResolvedValueOnce({
        ok: true,
        url: "https://example.com/article",
        text: "注入后正文",
        truncated: false,
        usedFallback: true,
      });
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    mock.messageListeners[0](
      {
        type: "pageContext.extract",
        rules: [],
        maxLength: 100,
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        url: "https://example.com/article",
        text: "注入后正文",
        truncated: false,
        usedFallback: true,
      });
    });
    expect(mock.chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ["content/index.js"],
    });
    expect(mock.chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("处理 URL 正则 AI 生成请求并返回响应", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify(["https://example\\.com/news/123", "https://example\\.com/news/.*"]),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      {
        type: "extractionRule.generateUrlPatterns",
        debugRequestId: "url-pattern-test",
        url: "https://example.com/news/123",
        provider: {
          id: "provider-1",
          name: "默认渠道",
          endpointType: "openai_chat",
          endpointUrl: "https://api.example.com/v1/chat/completions",
          apiKey: "sk-test",
          enabled: true,
          createdAt: 1,
          updatedAt: 1,
        },
        model: {
          id: "model-1",
          providerId: "provider-1",
          displayName: "默认模型",
          modelId: "gpt-test",
          temperature: 0.7,
          maxTokens: 1024,
          systemPrompt: "你是网页助手",
          isTitleModel: false,
          enabled: true,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
      }),
    );
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        patterns: ["https://example\\.com/news/123", "https://example\\.com/news/.*"],
      });
    });
  });

  it("快速返回当前活动标签页 URL", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await import("../../../src/background/index");
    mock.chrome.tabs.query.mockResolvedValueOnce([{ id: 11, url: "https://example.com/news/123" }]);
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      {
        type: "extractionRule.getCurrentTabUrl",
        debugRequestId: "url-pattern-test",
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        url: "https://example.com/news/123",
      });
    });
  });

  it("处理聊天发送请求并返回模型回复", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "模型回复" } }],
        }),
      }),
    );
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      {
        type: "chat.send",
        model: {
          id: "model-1",
          providerId: "provider-1",
          name: "默认模型",
          displayName: "默认模型",
          channelName: "默认渠道",
          endpointType: "openai_chat",
          endpointUrl: "https://api.example.com/v1/chat/completions",
          apiKey: "sk-test",
          modelId: "gpt-test",
          temperature: 0.7,
          maxTokens: 1024,
          systemPrompt: "你是网页助手",
          isTitleModel: false,
          enabled: true,
          createdAt: 1,
          updatedAt: 1,
        },
        messages: [],
        stream: false,
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        content: "模型回复",
        thinking: undefined,
      });
    });
  });

  it("chat.send 会过滤偏好里当前运行态不可用的高风险工具", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "已过滤工具" } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      {
        type: "chat.send",
        model: createTestModel(),
        messages: [],
        stream: false,
        enabledToolIds: ["system.current_time", "boundary.request_user_choice", "replay.send_request", "full_access.fetch"],
        toolChoice: "auto",
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true, content: "已过滤工具" }));
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { tools?: Array<{ function: { name: string } }> };
    expect(body.tools).toEqual([
      expect.objectContaining({ function: expect.objectContaining({ name: "get_current_time" }) }),
    ]);
  });

  it("chat.send 执行 allow-list 会拒绝模型返回的未暴露高风险工具调用", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-full-access-fetch",
                    type: "function",
                    function: {
                      name: "full_access_fetch",
                      arguments: "{\"url\":\"https://example.com/private\"}",
                    },
                  },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "工具决策完成" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "已拒绝未暴露高风险工具" } }],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    await import("../../../src/background/index");
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      {
        type: "chat.send",
        model: createTestModel(),
        messages: [],
        stream: false,
        enabledToolIds: ["system.current_time", "full_access.fetch"],
        toolChoice: "auto",
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true, content: "已拒绝未暴露高风险工具" }));
    });
    const initialBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { tools?: Array<{ function: { name: string } }> };
    expect(initialBody.tools).toEqual([
      expect.objectContaining({ function: expect.objectContaining({ name: "get_current_time" }) }),
    ]);
    const toolDecisionBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as {
      messages?: Array<{ role: string; name?: string; content?: string; is_error?: boolean }>;
    };
    expect(toolDecisionBody.messages).toContainEqual(expect.objectContaining({
      role: "tool",
      tool_call_id: "call-full-access-fetch",
      name: "full_access_fetch",
      content: "工具 full_access_fetch 未注册，已拒绝执行。",
    }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(mock.chrome.debugger.sendCommand).not.toHaveBeenCalled();
  });

  it.each(DEVTOOLS_LEGACY_NETWORK_CASES)("聊天工具链在仅有 DevTools Network bridge 连接时可执行旧 Network 工具 $id", async (legacyTool) => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-network-1",
                    type: "function",
                    function: {
                      name: legacyTool.name,
                      arguments: legacyTool.arguments,
                    },
                  },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "工具决策完成" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "已读取 Network" } }],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    await import("../../../src/background/index");
    const devtoolsPort = connectDevtoolsNetworkBridge(mock);
    mockDevtoolsDetailsResponses(devtoolsPort);
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      {
        type: "chat.send",
        model: createTestModel(),
        messages: [],
        stream: false,
        enabledToolIds: [legacyTool.id, "network.wait_for_requests"],
        toolChoice: "auto",
      },
      { tab: { id: 7 } as chrome.tabs.Tab },
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
        ok: true,
        content: "已读取 Network",
      }));
    });
    const decisionBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { tools?: Array<{ function: { name: string } }> };
    expect(decisionBody.tools).toEqual([
      expect.objectContaining({ function: expect.objectContaining({ name: legacyTool.name }) }),
    ]);
  });

  it("chat.send 在 DevTools 兼容层只暴露 extract_js_candidates 而不暴露 debugger-backed 工具", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "只读 Network 工具" } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await import("../../../src/background/index");
    connectDevtoolsNetworkBridge(mock);
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      {
        type: "chat.send",
        model: createTestModel(),
        messages: [],
        stream: false,
        enabledToolIds: ["network.extract_js_candidates", "network.wait_for_requests", "js.search_sources", "runtime.inspect_globals", "full_access.fetch"],
        toolChoice: "auto",
      },
      { tab: { id: 7 } as chrome.tabs.Tab },
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true, content: "只读 Network 工具" }));
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { tools?: Array<{ function: { name: string } }> };
    expect(body.tools).toEqual([
      expect.objectContaining({ function: expect.objectContaining({ name: "network_extract_js_candidates" }) }),
    ]);
  });

  it("chat.send 不会把其他标签页的 DevTools Network bridge 暴露给当前 sender tab", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "无工具回复" } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await import("../../../src/background/index");
    connectDevtoolsNetworkBridge(mock, 9);
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      {
        type: "chat.send",
        model: createTestModel(),
        messages: [],
        stream: false,
        enabledToolIds: ["network.list_requests"],
        toolChoice: "auto",
      },
      { tab: { id: 7 } as chrome.tabs.Tab },
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
        ok: true,
        content: "无工具回复",
      }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { tools?: Array<{ function: { name: string } }> };
    expect(body.tools).toBeUndefined();
  });

  it("chat.send 会为当前 sender tab 暴露并执行已连接的 DevTools legacy Network 工具", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-network-tab-7",
                    type: "function",
                    function: {
                      name: "network_list_requests",
                      arguments: "{\"limit\":1}",
                    },
                  },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "工具决策完成" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "已读取当前标签页 Network" } }],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    await import("../../../src/background/index");
    connectDevtoolsNetworkBridge(mock, 7);
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      {
        type: "chat.send",
        model: createTestModel(),
        messages: [],
        stream: false,
        enabledToolIds: ["network.list_requests"],
        toolChoice: "auto",
      },
      { tab: { id: 7 } as chrome.tabs.Tab },
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
        ok: true,
        content: "已读取当前标签页 Network",
      }));
    });
    const decisionBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { tools?: Array<{ function: { name: string } }> };
    expect(decisionBody.tools).toEqual([
      expect.objectContaining({ function: expect.objectContaining({ name: "network_list_requests" }) }),
    ]);
  });

  it("chat.send 会为 extension page 显式 tabId 暴露并执行已连接的 DevTools legacy Network 工具", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-network-extension-page",
                    type: "function",
                    function: {
                      name: "network_list_requests",
                      arguments: "{\"limit\":1}",
                    },
                  },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "工具决策完成" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "已读取 extension page 指定标签页 Network" } }],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    await import("../../../src/background/index");
    connectDevtoolsNetworkBridge(mock, 7);
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      {
        type: "chat.send",
        model: createTestModel(),
        messages: [],
        stream: false,
        tabId: 7,
        enabledToolIds: ["network.list_requests"],
        toolChoice: "auto",
      },
      { url: "chrome-extension://moon-tab/index.html" } as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
        ok: true,
        content: "已读取 extension page 指定标签页 Network",
      }));
    });
    const decisionBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { tools?: Array<{ function: { name: string } }> };
    expect(decisionBody.tools).toEqual([
      expect.objectContaining({ function: expect.objectContaining({ name: "network_list_requests" }) }),
    ]);
  });

  it("chat.send 不接受其他扩展 host 页面携带的显式 tabId", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "未暴露 Network 工具" } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await import("../../../src/background/index");
    connectDevtoolsNetworkBridge(mock, 7);
    const sendResponse = vi.fn();

    const keepChannelOpen = mock.messageListeners[0](
      {
        type: "chat.send",
        model: createTestModel(),
        messages: [],
        stream: false,
        tabId: 7,
        enabledToolIds: ["network.list_requests"],
        toolChoice: "auto",
      },
      { url: "chrome-extension://other-extension/index.html" } as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
        ok: true,
        content: "未暴露 Network 工具",
      }));
    });
    const decisionBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { tools?: Array<{ function: { name: string } }> };
    expect(decisionBody.tools).toBeUndefined();
  });

  it("流式聊天在仅有 DevTools Network bridge 连接时可执行旧 Network 工具", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    const encoder = new TextEncoder();
    const streamChunks: Uint8Array[] = [
      encoder.encode('data: {"choices":[{"delta":{"content":"流式"}}]}\n\n'),
      encoder.encode('data: {"choices":[{"delta":{"content":"完成"}}]}\n\n'),
      encoder.encode("data: [DONE]\n\n"),
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-network-stream",
                    type: "function",
                    function: {
                      name: "network_list_requests",
                      arguments: "{\"limit\":1}",
                    },
                  },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "工具决策完成" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream({
          pull(controller) {
            const chunk = streamChunks.shift();
            if (chunk) {
              controller.enqueue(chunk);
              return;
            }
            controller.close();
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    await import("../../../src/background/index");
    connectDevtoolsNetworkBridge(mock);
    const port = createPortMock("chat.stream", { tab: { id: 7 } as chrome.tabs.Tab });

    mock.connectListeners[0](port);
    port.emitMessage({
      type: "chat.stream.start",
      payload: {
        type: "chat.send",
        model: createTestModel(),
        messages: [],
        stream: true,
        enabledToolIds: ["network.list_requests"],
        toolChoice: "auto",
      },
    });

    await vi.waitFor(() => {
      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "tool:complete",
          record: expect.objectContaining({
            id: "call-network-stream",
            status: "success",
          }),
          attachments: [
            expect.objectContaining({
              kind: "network",
              redacted: true,
              requests: [expect.objectContaining({ id: "req-2", url: "https://cdn.example.com/app.js" })],
            }),
          ],
        }),
      );
      expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "complete", content: "流式完成" }));
    });
    const decisionBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { tools?: Array<{ function: { name: string } }> };
    expect(decisionBody.tools).toEqual([
      expect.objectContaining({ function: expect.objectContaining({ name: "network_list_requests" }) }),
    ]);
  });

  it("流式聊天不会把其他标签页的 DevTools Network bridge 暴露给当前 sender tab", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    const encoder = new TextEncoder();
    const streamChunks: Uint8Array[] = [
      encoder.encode('data: {"choices":[{"delta":{"content":"无工具"}}]}\n\n'),
      encoder.encode('data: {"choices":[{"delta":{"content":"流式"}}]}\n\n'),
      encoder.encode("data: [DONE]\n\n"),
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        pull(controller) {
          const chunk = streamChunks.shift();
          if (chunk) {
            controller.enqueue(chunk);
            return;
          }
          controller.close();
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await import("../../../src/background/index");
    connectDevtoolsNetworkBridge(mock, 9);
    const port = createPortMock("chat.stream", { tab: { id: 7 } as chrome.tabs.Tab });

    mock.connectListeners[0](port);
    port.emitMessage({
      type: "chat.stream.start",
      payload: {
        type: "chat.send",
        model: createTestModel(),
        messages: [],
        stream: true,
        enabledToolIds: ["network.list_requests"],
        toolChoice: "auto",
      },
    });

    await vi.waitFor(() => {
      expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "complete", content: "无工具流式" }));
    });
    expect(port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "tool:complete" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { tools?: Array<{ function: { name: string } }> };
    expect(body.tools).toBeUndefined();
  });

  it("流式聊天会为 extension page payload 显式 tabId 暴露并执行旧 Network 工具", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    const encoder = new TextEncoder();
    const streamChunks: Uint8Array[] = [
      encoder.encode('data: {"choices":[{"delta":{"content":"指定"}}]}\n\n'),
      encoder.encode('data: {"choices":[{"delta":{"content":"标签页"}}]}\n\n'),
      encoder.encode("data: [DONE]\n\n"),
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-network-stream-tab",
                    type: "function",
                    function: {
                      name: "network_list_requests",
                      arguments: "{\"limit\":1}",
                    },
                  },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "工具决策完成" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream({
          pull(controller) {
            const chunk = streamChunks.shift();
            if (chunk) {
              controller.enqueue(chunk);
              return;
            }
            controller.close();
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    await import("../../../src/background/index");
    connectDevtoolsNetworkBridge(mock, 7);
    const port = createPortMock("chat.stream", { url: "chrome-extension://moon-tab/index.html" } as chrome.runtime.MessageSender);

    mock.connectListeners[0](port);
    port.emitMessage({
      type: "chat.stream.start",
      payload: {
        type: "chat.send",
        model: createTestModel(),
        messages: [],
        stream: true,
        tabId: 7,
        enabledToolIds: ["network.list_requests"],
        toolChoice: "auto",
      },
    });

    await vi.waitFor(() => {
      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "tool:complete",
          record: expect.objectContaining({
            id: "call-network-stream-tab",
            status: "success",
          }),
        }),
      );
      expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "complete", content: "指定标签页" }));
    });
    const decisionBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { tools?: Array<{ function: { name: string } }> };
    expect(decisionBody.tools).toEqual([
      expect.objectContaining({ function: expect.objectContaining({ name: "network_list_requests" }) }),
    ]);
  });

  it("流式聊天端口断开时会终止正在进行的模型请求", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    const fetcher = vi.fn((_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Promise<Response>(() => undefined);
    });
    vi.stubGlobal("fetch", fetcher);
    await import("../../../src/background/index");
    const port = createPortMock("chat.stream");

    mock.connectListeners[0](port);
    port.emitMessage({
      type: "chat.stream.start",
      payload: {
        type: "chat.send",
        model: {
          id: "model-1",
          providerId: "provider-1",
          name: "默认模型",
          displayName: "默认模型",
          channelName: "默认渠道",
          endpointType: "openai_chat",
          endpointUrl: "https://api.example.com/v1/chat/completions",
          apiKey: "sk-test",
          modelId: "gpt-test",
          temperature: 0.7,
          maxTokens: 1024,
          systemPrompt: "你是网页助手",
          isTitleModel: false,
          enabled: true,
          createdAt: 1,
          updatedAt: 1,
        },
        messages: [],
        stream: false,
      },
    });

    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalled();
    });
    const requestInit = fetcher.mock.calls[0][1] as RequestInit;
    expect((requestInit.signal as AbortSignal).aborted).toBe(false);
    port.emitDisconnect();

    expect((requestInit.signal as AbortSignal).aborted).toBe(true);
    expect(port.postMessage).not.toHaveBeenCalled();
  });

  it("聊天长连接端口会透传 AI 请求重试进度", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("busy", { status: 429, statusText: "Too Many Requests", headers: { "Retry-After": "0" } }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "重试成功" } }],
            }),
            { status: 200 },
          ),
        ),
    );
    await import("../../../src/background/index");
    const port = createPortMock("chat.stream");

    mock.connectListeners[0](port);
    port.emitMessage({
      type: "chat.stream.start",
      payload: {
        type: "chat.send",
        model: {
          id: "model-1",
          providerId: "provider-1",
          name: "默认模型",
          displayName: "默认模型",
          channelName: "默认渠道",
          endpointType: "openai_chat",
          endpointUrl: "https://api.example.com/v1/chat/completions",
          apiKey: "sk-test",
          modelId: "gpt-test",
          temperature: 0.7,
          maxTokens: 1024,
          systemPrompt: "你是网页助手",
          isTitleModel: false,
          enabled: true,
          createdAt: 1,
          updatedAt: 1,
        },
        messages: [],
        stream: false,
        retryCount: 5,
      },
    });

    await vi.waitFor(() => {
      expect(port.postMessage).toHaveBeenCalledWith({ type: "retry:progress", currentRetry: 1, maxRetries: 5 });
    });
  });

  it("流式聊天完成事件会透传 Tavily 工具附件", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);
    await saveAppSetting({
      key: "webSearchSettings",
      value: {
        provider: "tavily",
        tavily: {
          apiKeysText: "tvly-1",
          apiKeyStrategy: "round_robin",
          includeAnswer: "basic",
          includeRawContent: false,
          maxResults: 5,
        },
        updatedAt: 1,
      },
      updatedAt: 1,
    });
    const encoder = new TextEncoder();
    const streamChunks: Uint8Array[] = [
      encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"最终思考"}}]}\n\n'),
      encoder.encode('data: {"choices":[{"delta":{"content":"最终"}}]}\n\n'),
      encoder.encode('data: {"choices":[{"delta":{"content":"回答"}}]}\n\n'),
      encoder.encode("data: [DONE]\n\n"),
    ];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: "",
                  reasoning_content: "需要调用 Tavily 搜索",
                  tool_calls: [
                    {
                      id: "call-1",
                      type: "function",
                      function: {
                        name: "tavily_search",
                        arguments: '{"query":"Tavily API"}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            results: [{ title: "Tavily Docs", url: "https://docs.tavily.com/search", content: "官方文档内容" }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "工具决策完成" } }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          body: new ReadableStream({
            pull(controller) {
              const chunk = streamChunks.shift();
              if (chunk) {
                controller.enqueue(chunk);
                return;
              }

              controller.close();
            },
          }),
        }),
    );
    await import("../../../src/background/index");
    const port = createPortMock("chat.stream");

    mock.connectListeners[0](port);
    port.emitMessage({
      type: "chat.stream.start",
      payload: {
        type: "chat.send",
        model: {
          id: "model-1",
          providerId: "provider-1",
          name: "默认模型",
          displayName: "默认模型",
          channelName: "默认渠道",
          endpointType: "openai_chat",
          endpointUrl: "https://api.example.com/v1/chat/completions",
          apiKey: "sk-test",
          modelId: "gpt-test",
          temperature: 0.7,
          maxTokens: 1024,
          systemPrompt: "你是网页助手",
          isTitleModel: false,
          enabled: true,
          createdAt: 1,
          updatedAt: 1,
        },
        messages: [],
        stream: true,
        enabledToolIds: ["web_search.tavily"],
        toolChoice: "auto",
      },
    });

    await vi.waitFor(() => {
      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "tool:start",
          record: expect.objectContaining({
            id: "call-1",
            name: "tavily_search",
            status: "running",
          }),
        }),
      );
      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "tool:complete",
          record: expect.objectContaining({
            id: "call-1",
            status: "success",
            attachmentIds: ["tool-attachment-call-1"],
          }),
          attachments: [
            expect.objectContaining({
              id: "tool-attachment-call-1",
              kind: "web-search",
              provider: "tavily",
              query: "Tavily API",
            }),
          ],
        }),
      );
      expect(port.postMessage).toHaveBeenCalledWith({ type: "assistant:final-start" });
      expect(port.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: "assistant:tool-turn",
          message: expect.objectContaining({
            content: "工具决策完成",
            toolCallRecords: [],
          }),
        }),
      );
      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "complete",
          content: "最终回答",
          toolAttachments: [
            expect.objectContaining({
              id: "tool-attachment-call-1",
              kind: "web-search",
              provider: "tavily",
              query: "Tavily API",
            }),
          ],
        }),
      );
    });
  });

});
