import { describe, expect, it } from "vitest";
import {
  applyReasoningEffortToRequestBody,
  detectReasoningEffortFamily,
  getReasoningEffortProfile,
  normalizeModelReasoningEffort,
  reasoningEffortToAnthropicBudgetTokens,
  reasoningEffortToDeepSeekWire,
} from "../../../src/shared/models/modelReasoning";

describe("provider-aware reasoning effort (official docs)", () => {
  it("classifies OpenAI / Anthropic / DeepSeek families correctly", () => {
    expect(detectReasoningEffortFamily("gpt-5.5")).toBe("openai_gpt5");
    expect(detectReasoningEffortFamily("o3")).toBe("openai_o");
    expect(detectReasoningEffortFamily("claude-sonnet-4", undefined, "anthropic_messages")).toBe("anthropic");
    expect(detectReasoningEffortFamily("deepseek-reasoner")).toBe("deepseek");
    expect(detectReasoningEffortFamily("deepseek-r1")).toBe("deepseek");
    expect(detectReasoningEffortFamily("deepseek-v4-flash")).toBe("deepseek");
    expect(detectReasoningEffortFamily("deepseek-v4-pro")).toBe("deepseek");
    expect(detectReasoningEffortFamily("gpt-4o-mini")).toBeNull();
  });

  it("uses different option sets per family", () => {
    expect(getReasoningEffortProfile("gpt-5.5")?.options.map((o) => o.value)).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(getReasoningEffortProfile("o3")?.options.map((o) => o.value)).toEqual(["low", "medium", "high"]);
    expect(getReasoningEffortProfile("claude-sonnet-4")?.wire).toBe("anthropic_thinking_budget");
    expect(getReasoningEffortProfile("deepseek-v4-flash")?.wire).toBe("deepseek_thinking_effort");
    expect(getReasoningEffortProfile("deepseek-v4-pro")?.options.map((o) => o.value)).toEqual(["high", "xhigh"]);
  });

  it("sends OpenAI reasoning_effort for GPT-5 / o-series", () => {
    expect(
      applyReasoningEffortToRequestBody({
        body: { model: "gpt-5.5" },
        modelId: "gpt-5.5",
        endpointType: "openai_chat",
        reasoningEffort: "xhigh",
      }).reasoning_effort,
    ).toBe("xhigh");

    expect(
      applyReasoningEffortToRequestBody({
        body: { model: "o3" },
        modelId: "o3",
        endpointType: "openai_chat",
        reasoningEffort: "high",
      }).reasoning_effort,
    ).toBe("high");
  });

  it("sends Anthropic thinking.budget_tokens and raises max_tokens", () => {
    const body = applyReasoningEffortToRequestBody({
      body: { model: "claude-sonnet-4", max_tokens: 1024 },
      modelId: "claude-sonnet-4",
      endpointType: "anthropic_messages",
      reasoningEffort: "high",
    });
    expect(body.thinking).toEqual({
      type: "enabled",
      budget_tokens: reasoningEffortToAnthropicBudgetTokens("high"),
    });
    expect(body.max_tokens).toBeGreaterThan(reasoningEffortToAnthropicBudgetTokens("high"));
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("sends DeepSeek official thinking + reasoning_effort high|max", () => {
    const highBody = applyReasoningEffortToRequestBody({
      body: { model: "deepseek-v4-pro", max_tokens: 1024 },
      modelId: "deepseek-v4-pro",
      endpointType: "openai_chat",
      reasoningEffort: "high",
    });
    expect(highBody.thinking).toEqual({ type: "enabled" });
    expect(highBody.reasoning_effort).toBe("high");

    const maxBody = applyReasoningEffortToRequestBody({
      body: { model: "deepseek-v4-flash" },
      modelId: "deepseek-v4-flash",
      endpointType: "openai_chat",
      reasoningEffort: "xhigh",
    });
    expect(maxBody.thinking).toEqual({ type: "enabled" });
    expect(maxBody.reasoning_effort).toBe("max");
  });

  it("maps DeepSeek compatibility aliases to high|max", () => {
    expect(reasoningEffortToDeepSeekWire("low")).toBe("high");
    expect(reasoningEffortToDeepSeekWire("medium")).toBe("high");
    expect(reasoningEffortToDeepSeekWire("high")).toBe("high");
    expect(reasoningEffortToDeepSeekWire("xhigh")).toBe("max");
  });

  it("normalizes effort values to family allow-list", () => {
    expect(normalizeModelReasoningEffort("minimal", ["low", "medium", "high"])).toBe("low");
    expect(normalizeModelReasoningEffort("xhigh", ["low", "medium", "high"])).toBe("high");
    expect(normalizeModelReasoningEffort("medium", ["high", "xhigh"], "high")).toBe("high");
  });
});
