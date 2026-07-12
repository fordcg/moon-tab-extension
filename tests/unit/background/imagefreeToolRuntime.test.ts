import { describe, expect, it, vi } from "vitest";
import { executeImagefreeGenerateTool, IMAGEFREE_TOOL_NAME } from "../../../src/background/imagefreeToolRuntime";
import type { ModelToolCall } from "../../../src/shared/models/types";

function createToolCall(argumentsValue: Record<string, unknown>): ModelToolCall {
  return {
    id: "imagefree-call",
    name: IMAGEFREE_TOOL_NAME,
    arguments: argumentsValue,
  };
}

describe("Imagefree 图片生成工具", () => {
  it("参数非法时在网络请求前 fail closed", async () => {
    const fetcher = vi.fn();

    for (const argumentsValue of [
      {},
      { prompt: "测试", aspect_ratio: "2:1" },
      { prompt: "测试", turnstile_token: "token" },
      { prompt: "测试", unexpected: true },
    ]) {
      const result = await executeImagefreeGenerateTool(createToolCall(argumentsValue), fetcher as unknown as typeof fetch);
      expect(result).toMatchObject({ isError: true });
    }

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("不会接受超过上限的提示词", async () => {
    const fetcher = vi.fn();
    const result = await executeImagefreeGenerateTool(
      createToolCall({ prompt: "a".repeat(2001) }),
      fetcher as unknown as typeof fetch,
    );

    expect(result).toMatchObject({
      isError: true,
      content: "Imagefree 图片描述不能超过 2000 字。",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("提交任务后轮询状态并返回图片 URL", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ taskId: "task-1", status: "pending" }))
      .mockResolvedValueOnce(Response.json({
        status: "completed",
        progress: 100,
        image: "https://pub-62e693a7058040f98bba94ed1d6f880b.r2.dev/images/demo.png",
      }));

    const result = await executeImagefreeGenerateTool(
      createToolCall({ prompt: "生成一个美女", aspect_ratio: "1:1" }),
      fetcher as unknown as typeof fetch,
    );

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      taskId: "task-1",
      status: "completed",
      progress: 100,
      image: "https://pub-62e693a7058040f98bba94ed1d6f880b.r2.dev/images/demo.png",
      imageUrl: "https://pub-62e693a7058040f98bba94ed1d6f880b.r2.dev/images/demo.png",
      prompt: "生成一个美女",
      aspect_ratio: "1:1",
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toBe("https://imagefree.net/api/generate");
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      prompt: "生成一个美女",
      aspect_ratio: "1:1",
      turnstile_token: null,
    });
    expect(fetcher.mock.calls[1][0]).toBe("https://imagefree.net/api/generate/status?taskId=task-1");
  });

  it("数组 JSON 响应缺少顶层 taskId 时返回诊断错误", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json([{ taskId: "task-1" }]));

    const result = await executeImagefreeGenerateTool(
      createToolCall({ prompt: "moon" }),
      fetcher as unknown as typeof fetch,
    );

    expect(result).toMatchObject({
      isError: true,
      content: expect.stringContaining('Imagefree 未返回 taskId：[{"taskId":"task-1"}]'),
    });
  });
});
