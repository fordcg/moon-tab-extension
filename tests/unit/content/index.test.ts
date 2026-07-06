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

  it("收到提取消息后返回当前页提取结果", async () => {
    let registeredListener:
      | ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean)
      | undefined;

    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener) => {
            registeredListener = listener;
          }),
        },
      },
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

  it("收到提取所有模式消息后返回当前页 HTML", async () => {
    let registeredListener:
      | ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean)
      | undefined;

    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener) => {
            registeredListener = listener;
          }),
        },
      },
    });

    await import("../../../src/content/index");

    const sendResponse = vi.fn();
    const keepChannelOpen = registeredListener?.(
      {
        type: "pageContext.extract",
        rules: [],
        maxLength: 500,
        extractMode: "all",
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepChannelOpen).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        url: "https://example.com/article",
        title: "Test Page",
        truncated: false,
        usedFallback: true,
      }),
    );
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("<main>正文内容</main>"),
      }),
    );
  });

  it("floating 悬浮助手 attach 消息会创建可复用 iframe", async () => {
    let registeredListener:
      | ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean)
      | undefined;

    vi.stubGlobal("chrome", {
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://moon-tab/${path}`),
        onMessage: {
          addListener: vi.fn((listener) => {
            registeredListener = listener;
          }),
        },
      },
    });

    await import("../../../src/content/index");

    const sendResponse = vi.fn();
    const message = {
      type: "sidePanel.floating.attach",
      url: "chrome-extension://moon-tab/index.html?floating=1&tabId=7&windowId=3",
    };

    const firstReturn = registeredListener?.(message, {} as chrome.runtime.MessageSender, sendResponse);
    const secondReturn = registeredListener?.(message, {} as chrome.runtime.MessageSender, sendResponse);

    const frames = document.querySelectorAll("iframe[data-moon-tab-ai-floating-frame]");
    expect(firstReturn).toBe(false);
    expect(secondReturn).toBe(false);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ src: message.url });
    expect(sendResponse).toHaveBeenLastCalledWith({ ok: true });
  });

  it("floating 悬浮助手兼容旧 attach 类型并支持关闭", async () => {
    let registeredListener:
      | ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean)
      | undefined;

    vi.stubGlobal("chrome", {
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://moon-tab/${path}`),
        onMessage: {
          addListener: vi.fn((listener) => {
            registeredListener = listener;
          }),
        },
      },
    });

    await import("../../../src/content/index");

    const sendResponse = vi.fn();
    registeredListener?.(
      {
        type: "sidepanelFloating.open",
        url: "chrome-extension://moon-tab/index.html?floating=1",
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );
    expect(document.querySelectorAll("iframe[data-moon-tab-ai-floating-frame]")).toHaveLength(1);

    const closeReturn = registeredListener?.(
      { type: "sidePanel.floating.close" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(closeReturn).toBe(false);
    expect(document.querySelectorAll("iframe[data-moon-tab-ai-floating-frame]")).toHaveLength(0);
    expect(sendResponse).toHaveBeenLastCalledWith({ ok: true });
  });

  it("floating 悬浮助手拒绝非当前扩展 index floating 地址", async () => {
    let registeredListener:
      | ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean)
      | undefined;

    vi.stubGlobal("chrome", {
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://moon-tab/${path}`),
        onMessage: {
          addListener: vi.fn((listener) => {
            registeredListener = listener;
          }),
        },
      },
    });

    await import("../../../src/content/index");

    const invalidUrls = [
      "chrome-extension://other-extension/index.html?floating=1",
      "chrome-extension://moon-tab/options.html?floating=1",
      "chrome-extension://moon-tab/index.html",
    ];

    for (const url of invalidUrls) {
      const sendResponse = vi.fn();
      const keepChannelOpen = registeredListener?.(
        {
          type: "sidePanel.floating.attach",
          url,
        },
        {} as chrome.runtime.MessageSender,
        sendResponse,
      );

      expect(keepChannelOpen).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, message: "悬浮窗地址无效" });
      expect(document.querySelectorAll("iframe[data-moon-tab-ai-floating-frame]")).toHaveLength(0);
    }
  });
});
