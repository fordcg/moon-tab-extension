import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractionRule } from "../../../src/shared/types";

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

describe("content 脚本消息", () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.innerHTML = "<head><title>Test Page</title></head><body><main>正文内容</main></body>";
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new URL("https://example.com/article"),
    });
  });

  function stubChrome(onMessage?: (listener: Function) => void) {
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://moon-tab/${path}`),
        onMessage: {
          addListener: vi.fn((listener) => {
            onMessage?.(listener);
          }),
        },
      },
      storage: {
        session: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
        },
      },
    });
  }

  it("收到提取消息后返回当前页提取结果", async () => {
    let registeredListener:
      | ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean)
      | undefined;

    stubChrome((listener) => {
      registeredListener = listener as typeof registeredListener;
    });

    await import("../../../src/content/index");

    const sendResponse = vi.fn();
    const keepChannelOpen = registeredListener?.(
      {
        type: "pageContext.extract",
        rules: [createRule()],
        maxLength: 100,
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(false);
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

  it("拒绝 legacy 控制信标 URL，不再挂页面球体", async () => {
    let registeredListener:
      | ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean)
      | undefined;
    stubChrome((listener) => {
      registeredListener = listener as typeof registeredListener;
    });

    await import("../../../src/content/index");
    const sendResponse = vi.fn();
    registeredListener?.(
      {
        type: "sidePanel.floating.attach",
        url: "chrome-extension://moon-tab/index.html?floating=1&controlWindow=1&tabId=7",
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(document.querySelectorAll("[data-moon-tab-ai-control-beacon-host]")).toHaveLength(0);
    expect(document.querySelectorAll("iframe[data-moon-tab-ai-control-beacon]")).toHaveLength(0);
    expect(sendResponse).toHaveBeenLastCalledWith({
      ok: false,
      message: "控制信标已移除，请使用侧栏 AI 伴侣",
    });
  });

  it("floating 悬浮助手 attach 消息会创建可复用 iframe", async () => {
    let registeredListener:
      | ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean)
      | undefined;
    stubChrome((listener) => {
      registeredListener = listener as typeof registeredListener;
    });

    await import("../../../src/content/index");
    const sendResponse = vi.fn();
    const message = {
      type: "sidePanel.floating.attach",
      url: "chrome-extension://moon-tab/index.html?floating=1&tabId=7&windowId=3",
    };
    registeredListener?.(message, {} as chrome.runtime.MessageSender, sendResponse);
    registeredListener?.(message, {} as chrome.runtime.MessageSender, sendResponse);
    const frames = document.querySelectorAll("iframe[data-moon-tab-ai-floating-frame]");
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ src: message.url });
  });

  it("floating 悬浮助手拒绝非当前扩展 index floating 地址", async () => {
    let registeredListener:
      | ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean)
      | undefined;
    stubChrome((listener) => {
      registeredListener = listener as typeof registeredListener;
    });
    await import("../../../src/content/index");
    const sendResponse = vi.fn();
    registeredListener?.(
      {
        type: "sidePanel.floating.attach",
        url: "chrome-extension://other-extension/index.html?floating=1",
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, message: "悬浮窗地址无效" });
  });
});
