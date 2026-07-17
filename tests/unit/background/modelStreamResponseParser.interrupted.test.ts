import { describe, expect, it } from "vitest";
import { readModelStreamResponse } from "../../../src/background/modelStreamResponseParser";
import type { ModelConfig } from "../../../src/shared/types";

function createModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
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
    ...overrides,
  };
}

function createStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const queue = chunks.map((chunk) => encoder.encode(chunk));
  return new ReadableStream({
    pull(controller) {
      const chunk = queue.shift();
      if (chunk) {
        controller.enqueue(chunk);
        return;
      }
      controller.close();
    },
  });
}

describe("流式完成判定补充", () => {
  it("仅有 reasoning_content 且带 finish_reason 时视为正常完成，不报流中断", async () => {
    const result = await readModelStreamResponse(
      new Response(
        createStream([
          'data: {"choices":[{"delta":{"reasoning_content":"先想一下"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
      createModel({ modelId: "deepseek-v4-flash" }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe("");
      expect(result.thinking).toBe("先想一下");
      expect(result.reasoningContent).toBe("先想一下");
    }
  });

  it("只有 reasoning_content、finish_reason=stop 且无 [DONE] 时也视为完成", async () => {
    const result = await readModelStreamResponse(
      new Response(
        createStream([
          'data: {"choices":[{"delta":{"reasoning_content":"分析中"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        ]),
      ),
      createModel({ modelId: "deepseek-v4-flash" }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.thinking).toBe("分析中");
    }
  });
});
