import { afterEach, describe, expect, it, vi } from "vitest";
import { sendRuntimeMessage } from "../../../src/side-panel/state/runtimeMessage";

describe("sendRuntimeMessage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("当前环境不支持插件后台请求时返回中文错误", async () => {
    vi.stubGlobal("chrome", undefined);

    await expect(sendRuntimeMessage<{ ok: false; message: string }>({ type: "demo" })).resolves.toEqual({
      ok: false,
      message: "当前环境不支持插件后台请求",
    });
  });

  it("Promise 形态 sendMessage 拒绝且没有 Error 消息时返回中文兜底", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(() => Promise.reject("failed")),
      },
    });

    await expect(sendRuntimeMessage<{ ok: false; message: string }>({ type: "demo" })).resolves.toEqual({
      ok: false,
      message: "插件后台请求失败",
    });
  });

  it("callback 形态 sendMessage 抛出非 Error 异常时返回中文兜底", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(() => {
          throw "failed";
        }),
      },
    });

    await expect(sendRuntimeMessage<{ ok: false; message: string }>({ type: "demo" })).resolves.toEqual({
      ok: false,
      message: "插件后台请求失败",
    });
  });

  it("扩展上下文失效时不会从 callback 抛出未捕获异常", async () => {
    const runtime = {
      get lastError() {
        throw new Error("Extension context invalidated.");
      },
      sendMessage: vi.fn((_message: unknown, callback: (response?: unknown) => void) => {
        callback(undefined);
        return undefined;
      }),
    };
    vi.stubGlobal("chrome", { runtime });

    await expect(sendRuntimeMessage<{ ok: false; message: string }>({ type: "demo" })).resolves.toEqual({
      ok: false,
      message: "扩展已更新，请重新打开侧边栏后重试",
    });
  });

  it("sendMessage 同步报告扩展上下文失效时返回中文提示", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(() => {
          throw new Error("Extension context invalidated.");
        }),
      },
    });

    await expect(sendRuntimeMessage<{ ok: false; message: string }>({ type: "demo" })).resolves.toEqual({
      ok: false,
      message: "扩展已更新，请重新打开侧边栏后重试",
    });
  });
});
