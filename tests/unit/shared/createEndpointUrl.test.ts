import { describe, expect, it } from "vitest";
import { createEndpointUrl } from "../../../src/shared/models/modelCatalog";
import { createOpenAIChatPayload } from "../../../src/shared/models/openaiChatAdapter";
import type { ModelConfig } from "../../../src/shared/types";

function createModel(endpointUrl: string): ModelConfig {
  return {
    id: "m",
    providerId: "p",
    name: "m",
    displayName: "m",
    channelName: "c",
    endpointType: "openai_chat",
    endpointUrl,
    apiKey: "sk",
    modelId: "grok-4.20-fast",
    temperature: 0.2,
    maxTokens: 32,
    systemPrompt: "",
    isTitleModel: false,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("createEndpointUrl", () => {
  it("兼容用户填写的 /v1 基址，不双写 v1", () => {
    expect(createEndpointUrl("http://127.0.0.1:18000/v1", "openai_chat")).toBe("http://127.0.0.1:18000/v1/chat/completions");
    expect(createEndpointUrl("http://127.0.0.1:18000/v1/", "openai_chat")).toBe("http://127.0.0.1:18000/v1/chat/completions");
    expect(createEndpointUrl("http://127.0.0.1:18000", "openai_chat")).toBe("http://127.0.0.1:18000/v1/chat/completions");
    expect(createEndpointUrl("http://127.0.0.1:18000/v1/chat/completions", "openai_chat")).toBe("http://127.0.0.1:18000/v1/chat/completions");
  });

  it("OpenAI payload 对 /v1 基址生成正确 chat completions URL", () => {
    const payload = createOpenAIChatPayload(createModel("http://127.0.0.1:18000/v1"), [{ role: "user", content: "hi" }], true);
    expect(payload.url).toBe("http://127.0.0.1:18000/v1/chat/completions");
  });
});
