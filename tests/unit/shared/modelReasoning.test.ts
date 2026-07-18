import { describe, expect, it } from "vitest";
import {
  applyReasoningEffortToRequestBody,
  detectModelSupportsReasoningEffort,
  normalizeModelReasoningEffort,
  reasoningEffortToAnthropicBudgetTokens,
} from "../../../src/shared/models/modelReasoning";
import { detectModelSupportsVision } from "../../../src/shared/models/modelVision";

describe("model reasoning effort", () => {
  it("detects gpt-5.x / claude / deepseek reasoner as effort-capable", () => {
    expect(detectModelSupportsReasoningEffort("gpt-5.5")).toBe(true);
    expect(detectModelSupportsReasoningEffort("gpt-5.4-pro")).toBe(true);
    expect(detectModelSupportsReasoningEffort("gpt-5-mini")).toBe(true);
    expect(detectModelSupportsReasoningEffort("o3")).toBe(true);
    expect(detectModelSupportsReasoningEffort("o4-mini")).toBe(true);
    expect(detectModelSupportsReasoningEffort("claude-sonnet-4")).toBe(true);
    expect(detectModelSupportsReasoningEffort("claude-3-7-sonnet")).toBe(true);
    expect(detectModelSupportsReasoningEffort("deepseek-reasoner")).toBe(true);
    expect(detectModelSupportsReasoningEffort("deepseek-r1")).toBe(true);
  });

  it("does not mark plain chat models as effort-capable", () => {
    expect(detectModelSupportsReasoningEffort("deepseek-v4-flash")).toBe(false);
    expect(detectModelSupportsReasoningEffort("gpt-4o-mini")).toBe(false);
    expect(detectModelSupportsReasoningEffort("gpt-3.5-turbo")).toBe(false);
  });

  it("applies reasoning_effort for openai-compatible payloads", () => {
    const body = applyReasoningEffortToRequestBody({
      body: { model: "gpt-5.5", messages: [] },
      modelId: "gpt-5.5",
      endpointType: "openai_chat",
      reasoningEffort: "high",
    });
    expect(body.reasoning_effort).toBe("high");
  });

  it("applies anthropic thinking budget for claude", () => {
    const body = applyReasoningEffortToRequestBody({
      body: { model: "claude-sonnet-4", messages: [] },
      modelId: "claude-sonnet-4",
      endpointType: "anthropic_messages",
      reasoningEffort: "high",
    });
    expect(body.thinking).toEqual({
      type: "enabled",
      budget_tokens: reasoningEffortToAnthropicBudgetTokens("high"),
    });
  });

  it("normalizes invalid effort values", () => {
    expect(normalizeModelReasoningEffort("nope")).toBe("medium");
    expect(normalizeModelReasoningEffort("xhigh")).toBe("xhigh");
  });
});

describe("gpt-5.x vision detection", () => {
  it("marks gpt-5.5 and similar as vision-capable", () => {
    expect(detectModelSupportsVision("gpt-5.5")).toBe(true);
    expect(detectModelSupportsVision("gpt-5.4")).toBe(true);
    expect(detectModelSupportsVision("gpt-5-mini")).toBe(true);
  });
});
