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
      { prompt: "测试", turnstile_token: "token with spaces" },
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
});
