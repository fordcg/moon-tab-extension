import { describe, expect, it } from "vitest";
import {
  resolveEffectiveMaxContextTokens,
  resolveModelContextWindowTokens,
  softTrimChatMessagesForRequest,
  SOFT_TRIM_THRESHOLD_PERCENT,
} from "../../../src/shared/chat/softContextTrim";
import type { ChatMessage, ModelConfig } from "../../../src/shared/types";

function createMessage(id: string, role: ChatMessage["role"], content: string, partial: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    role,
    content,
    createdAt: 1,
    modelId: "model-1",
    endpointType: "openai_chat",
    streamMode: false,
    systemPrompt: "你是网页助手",
    contextPrompt: "",
    contextMode: "text",
    ...partial,
  };
}

function createToolTurn(id: string, content: string, toolName = "network_list_requests"): ChatMessage {
  return createMessage(id, "assistant", content, {
    assistantMessageKind: "tool_call_turn",
    toolCallRecords: [
      {
        id: `call-${id}`,
        toolId: "network.list_requests",
        name: toolName,
        displayName: "列出请求",
        arguments: {},
        status: "success",
        startedAt: 1,
        completedAt: 2,
      },
    ],
    toolAttachments: [
      {
        id: `att-${id}`,
        kind: "network",
        title: "Network",
        summary: "摘要",
        createdAt: 1,
        redacted: true,
        truncated: false,
        requests: [],
      },
    ],
  });
}

describe("softContextTrim", () => {
  it("折叠较早的工具过程，仅保留最近若干轮工具正文", () => {
    const messages = [
      createMessage("u1", "user", "开始"),
      createToolTurn("t1", "很长的旧工具输出".repeat(50)),
      createToolTurn("t2", "第二轮工具输出".repeat(50)),
      createToolTurn("t3", "第三轮工具输出".repeat(50)),
      createMessage("u2", "user", "继续"),
    ];

    const result = softTrimChatMessagesForRequest(messages, { keepRecentToolTurns: 2 });
    expect(result.changed).toBe(true);
    expect(result.messages.find((item) => item.id === "t1")?.content).toContain("已折叠");
    expect(result.messages.find((item) => item.id === "t1")?.toolAttachments).toBeUndefined();
    expect(result.messages.find((item) => item.id === "t2")?.content).toContain("第二轮");
    expect(result.messages.find((item) => item.id === "t3")?.content).toContain("第三轮");
  });

  it("截断过长的普通助手与用户消息", () => {
    const messages = [
      createMessage("u1", "user", "用".repeat(20_000)),
      createMessage("a1", "assistant", "助".repeat(20_000)),
    ];
    const result = softTrimChatMessagesForRequest(messages, {
      maxUserMessageChars: 100,
      maxAssistantMessageChars: 80,
    });
    expect(result.changed).toBe(true);
    expect(result.messages[0]?.content.length).toBeLessThanOrEqual(120);
    expect(result.messages[1]?.content.length).toBeLessThanOrEqual(100);
  });

  it("只从最新 context_summary 之后裁剪", () => {
    const messages = [
      createToolTurn("old", "旧工具".repeat(100)),
      createMessage("summary", "assistant", "摘要", { assistantMessageKind: "context_summary" }),
      createToolTurn("new1", "新工具1".repeat(20)),
      createToolTurn("new2", "新工具2".repeat(20)),
    ];
    const result = softTrimChatMessagesForRequest(messages, { keepRecentToolTurns: 1 });
    expect(result.messages[0]?.id).toBe("summary");
    expect(result.messages.find((item) => item.id === "new1")?.content).toContain("已折叠");
    expect(result.messages.find((item) => item.id === "new2")?.content).toContain("新工具2");
  });

  it("按模型推断上下文窗口，并与偏好取更保守值", () => {
    const model = {
      modelId: "claude-sonnet-4-5",
      maxTokens: 8192,
    } as Pick<ModelConfig, "modelId" | "maxTokens">;
    expect(resolveModelContextWindowTokens(model)).toBeGreaterThanOrEqual(100_000);
    expect(resolveEffectiveMaxContextTokens(256_000, model)).toBeLessThan(256_000);
    expect(resolveEffectiveMaxContextTokens(8_000, model)).toBe(8_000);
  });

  it("soft 阈值默认低于 hard 阈值", () => {
    expect(SOFT_TRIM_THRESHOLD_PERCENT).toBeLessThan(90);
  });
});
