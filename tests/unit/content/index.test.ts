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

  it("floating 控制信标 attach 会创建原生页面球体而不是 iframe", async () => {
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

    expect(document.querySelectorAll("iframe[data-moon-tab-ai-control-beacon]")).toHaveLength(0);
    const host = document.querySelector("[data-moon-tab-ai-control-beacon-host]") as HTMLElement | null;
    expect(host).toBeTruthy();
    expect(host!.style.background).toBe("transparent");
    expect(host!.querySelector(".moon-orb-button")).toBeTruthy();
    expect(sendResponse).toHaveBeenLastCalledWith({ ok: true });
  });

  it("关闭控制信标消息会移除页面球体", async () => {
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
        url: "chrome-extension://moon-tab/index.html?floating=1&controlWindow=1",
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );
    expect(document.querySelectorAll("[data-moon-tab-ai-control-beacon-host]")).toHaveLength(1);

    registeredListener?.(
      { type: "sidePanel.controlBeacon.close" },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );
    expect(document.querySelectorAll("[data-moon-tab-ai-control-beacon-host]")).toHaveLength(0);
    expect(sendResponse).toHaveBeenLastCalledWith({ ok: true });
  });

  it("原生球体 pointer 拖动会更新 left/top 并持久化", async () => {
    let registeredListener:
      | ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean)
      | undefined;
    const storageSet = vi.fn(async () => undefined);
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://moon-tab/${path}`),
        onMessage: {
          addListener: vi.fn((listener) => {
            registeredListener = listener as typeof registeredListener;
          }),
        },
      },
      storage: {
        session: {
          get: vi.fn(async () => ({})),
          set: storageSet,
        },
      },
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });

    await import("../../../src/content/index");
    const sendResponse = vi.fn();
    registeredListener?.(
      {
        type: "sidePanel.floating.attach",
        url: "chrome-extension://moon-tab/index.html?floating=1&controlWindow=1",
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    const host = document.querySelector("[data-moon-tab-ai-control-beacon-host]") as HTMLElement;
    const button = host.querySelector(".moon-orb-button") as HTMLButtonElement;
    Object.defineProperty(host, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 1000, top: 600, width: 96, height: 96, right: 1096, bottom: 696, x: 1000, y: 600, toJSON: () => ({}) }),
    });
    button.setPointerCapture = vi.fn();
    button.releasePointerCapture = vi.fn();

    button.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 1000, clientY: 600, pointerId: 1, bubbles: true }));
    button.dispatchEvent(new PointerEvent("pointermove", { button: 0, clientX: 960, clientY: 570, pointerId: 1, bubbles: true }));
    button.dispatchEvent(new PointerEvent("pointerup", { button: 0, clientX: 960, clientY: 570, pointerId: 1, bubbles: true }));

    expect(host.style.left).toBe("960px");
    expect(host.style.top).toBe("570px");
    expect(storageSet).toHaveBeenCalledWith({
      "sidePanel.controlBeaconPosition.v1": { left: 960, top: 570 },
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
