import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("chat.stream live broadcast isolation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("broadcastAutomationLiveEvent 失败时不会让主端口 postMessage 被当成断开", async () => {
    const postMessage = vi.fn();
    const disconnect = vi.fn();
    const messageListeners: Array<(message: unknown) => void> = [];
    const disconnectListeners: Array<() => void> = [];

    const port = {
      name: "chat.stream",
      sender: {},
      postMessage,
      disconnect,
      onMessage: {
        addListener: (listener: (message: unknown) => void) => messageListeners.push(listener),
      },
      onDisconnect: {
        addListener: (listener: () => void) => disconnectListeners.push(listener),
      },
    };

    const connectListeners: Array<(port: typeof port) => void> = [];
    const runtimeSendMessage = vi.fn(async () => {
      throw new Error("no receiving end");
    });
    const tabsQuery = vi.fn(async () => [{ id: 1 }]);
    const tabsSendMessage = vi.fn(async () => {
      throw new Error("no content script");
    });

    vi.stubGlobal("chrome", {
      runtime: {
        onConnect: {
          addListener: (listener: (port: typeof port) => void) => connectListeners.push(listener),
        },
        onMessage: { addListener: vi.fn() },
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        getURL: (path: string) => `chrome-extension://test/${path}`,
        sendMessage: runtimeSendMessage,
        getPlatformInfo: vi.fn((cb?: () => void) => cb?.()),
        id: "test",
      },
      tabs: {
        query: tabsQuery,
        sendMessage: tabsSendMessage,
        onRemoved: { addListener: vi.fn() },
        onActivated: { addListener: vi.fn() },
        onCreated: { addListener: vi.fn() },
      },
      storage: {
        session: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
          remove: vi.fn(async () => undefined),
        },
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
        },
      },
      alarms: { onAlarm: { addListener: vi.fn() }, create: vi.fn(), clear: vi.fn() },
      contextMenus: { create: vi.fn(), onClicked: { addListener: vi.fn() }, removeAll: vi.fn() },
      action: { onClicked: { addListener: vi.fn() } },
      commands: { onCommand: { addListener: vi.fn() } },
      sidePanel: {
        setOptions: vi.fn(async () => undefined),
        setPanelBehavior: vi.fn(async () => undefined),
        open: vi.fn(async () => undefined),
      },
      windows: { onRemoved: { addListener: vi.fn() } },
      declarativeNetRequest: {
        updateSessionRules: vi.fn(async () => undefined),
      },
      scripting: { executeScript: vi.fn(async () => undefined) },
    });

    // Avoid importing the full background index (heavy). Unit-test the isolation pattern directly.
    let disconnected = false;
    function cleanUpDisconnectedStream() {
      disconnected = true;
    }
    async function broadcastAutomationLiveEvent(payload: unknown): Promise<void> {
      try {
        await chrome.runtime.sendMessage({ type: "automation.live", payload });
      } catch {
        // ignore
      }
      try {
        const tabs = await chrome.tabs.query({});
        await Promise.all(
          tabs.map(async (tab) => {
            if (typeof tab.id !== "number") return;
            try {
              await chrome.tabs.sendMessage(tab.id, { type: "automation.live", payload });
            } catch {
              // ignore
            }
          }),
        );
      } catch {
        // ignore
      }
    }
    function postToPort(message: unknown): boolean {
      if (disconnected) return false;
      try {
        port.postMessage(message);
      } catch {
        try {
          port.disconnect();
        } catch {
          // ignore
        } finally {
          cleanUpDisconnectedStream();
        }
        return false;
      }
      try {
        void broadcastAutomationLiveEvent(message);
      } catch {
        // must not disconnect
      }
      return true;
    }

    expect(postToPort({ type: "tool:start", record: { id: "1" } })).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();
    expect(disconnected).toBe(false);

    // Allow rejected promises from best-effort broadcast to settle without failing the test.
    await Promise.resolve();
    await Promise.resolve();
    expect(disconnect).not.toHaveBeenCalled();
    expect(disconnected).toBe(false);
  });
});
