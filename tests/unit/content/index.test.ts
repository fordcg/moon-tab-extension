import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractionRule } from "../../../src/shared/types";
import { PET_SNAPSHOT_EVENT_TYPE } from "../../../src/shared/pet/runtime";

function createRule(): ExtractionRule {
  return {
    id: "rule-1",
    alias: "正文",
    urlPattern: "https://example.com/.*",
    selectorsText: "main",
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | void;

describe("content 脚本消息", () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.innerHTML = "<head><title>Test Page</title></head><body><main>正文内容</main></body>";
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new URL("https://example.com/article"),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function stubChrome() {
    const listeners: MessageListener[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://moon-tab/${path}`),
        sendMessage: vi.fn((_message, cb?: (response?: unknown) => void) => {
          cb?.({
            ok: true,
            snapshot: {
              state: "idle",
              badge: "idle",
              stateLabel: "待命",
              updatedAt: Date.now(),
            },
          });
        }),
        onMessage: {
          addListener: vi.fn((listener: MessageListener) => {
            listeners.push(listener);
          }),
        },
        lastError: undefined,
      },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
        },
        session: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
        },
      },
    });
    return listeners;
  }

  function dispatch(
    listeners: MessageListener[],
    message: unknown,
    sendResponse: (response?: unknown) => void = vi.fn(),
  ) {
    for (const listener of listeners) {
      listener(message, {} as chrome.runtime.MessageSender, sendResponse);
    }
    return sendResponse;
  }

  it("收到提取消息后返回当前页提取结果", async () => {
    const listeners = stubChrome();
    await import("../../../src/content/index");
    await Promise.resolve();

    const sendResponse = vi.fn();
    dispatch(
      listeners,
      {
        type: "pageContext.extract",
        rules: [createRule()],
        maxLength: 100,
      },
      sendResponse,
    );

    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      url: "https://example.com/article",
      title: "Test Page",
      text: "正文内容",
      truncated: false,
      usedFallback: false,
      matchedRuleId: "rule-1",
    });
  });

  it("页面加载后挂载可拖动 AI 浮宠", async () => {
    stubChrome();
    await import("../../../src/content/index");
    await Promise.resolve();
    await Promise.resolve();
    const host = document.querySelector("[data-moon-tab-ai-pet-host]") as HTMLElement | null;
    expect(host).toBeTruthy();
    expect(host!.querySelector(".moon-pet-button")).toBeTruthy();
    expect(host!.querySelector(".moon-pet-img")).toBeTruthy();
  });

  it("扩展上下文失效后清理浮宠定时重绘", async () => {
    vi.useFakeTimers();
    stubChrome();
    const getURL = vi.mocked(chrome.runtime.getURL);
    await import("../../../src/content/index");
    await Promise.resolve();
    await Promise.resolve();

    expect(document.querySelector("[data-moon-tab-ai-pet-host]")).toBeTruthy();

    getURL.mockImplementation(() => {
      throw new Error("Extension context invalidated.");
    });

    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow();
    expect(document.querySelector("[data-moon-tab-ai-pet-host]")).toBeNull();

    const callCountAfterCleanup = getURL.mock.calls.length;
    vi.advanceTimersByTime(120_000);
    expect(getURL).toHaveBeenCalledTimes(callCountAfterCleanup);
  });

  it("收到 pet snapshot 事件后更新状态文案", async () => {
    const listeners = stubChrome();
    await import("../../../src/content/index");
    await Promise.resolve();
    await Promise.resolve();

    dispatch(listeners, {
      type: PET_SNAPSHOT_EVENT_TYPE,
      snapshot: {
        state: "working",
        badge: "running",
        stateLabel: "干活中",
        bubble: "正在 Edit",
        updatedAt: Date.now(),
      },
    });

    const host = document.querySelector("[data-moon-tab-ai-pet-host]") as HTMLElement;
    expect(host.dataset.state).toBe("working");
    expect(host.querySelector(".moon-pet-state")?.textContent).toBe("干活中");
    expect(host.querySelector(".moon-pet-bubble")?.textContent).toBe("正在 Edit");
  });

  it("拒绝 legacy 控制信标 URL，不再挂页面球体", async () => {
    const listeners = stubChrome();
    await import("../../../src/content/index");
    await Promise.resolve();
    const sendResponse = vi.fn();
    dispatch(
      listeners,
      {
        type: "sidePanel.floating.attach",
        url: "chrome-extension://moon-tab/index.html?floating=1&controlWindow=1&tabId=7",
      },
      sendResponse,
    );

    expect(document.querySelectorAll("[data-moon-tab-ai-control-beacon-host]")).toHaveLength(0);
    expect(sendResponse).toHaveBeenLastCalledWith({
      ok: false,
      message: "控制信标已移除，请使用页面 AI 伴侣",
    });
  });

  it("floating 悬浮助手 attach 消息会创建可复用 iframe", async () => {
    const listeners = stubChrome();
    await import("../../../src/content/index");
    await Promise.resolve();
    const sendResponse = vi.fn();
    const message = {
      type: "sidePanel.floating.attach",
      url: "chrome-extension://moon-tab/index.html?floating=1&tabId=7&windowId=3",
    };
    dispatch(listeners, message, sendResponse);
    dispatch(listeners, message, sendResponse);
    const frames = document.querySelectorAll("iframe[data-moon-tab-ai-floating-frame]");
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ src: message.url });
  });
});
