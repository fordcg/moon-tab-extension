import { describe, expect, it } from "vitest";
import {
  applyReasoningEffortToRequestBody,
  detectReasoningEffortFamily,
  getReasoningEffortProfile,
  normalizeModelReasoningEffort,
  reasoningEffortToAnthropicBudgetTokens,
  reasoningEffortToDeepSeekMaxTokens,
} from "../../../src/shared/models/modelReasoning";

describe("provider-aware reasoning effort", () => {
  it("classifies OpenAI / Anthropic / DeepSeek families correctly", () => {
    expect(detectReasoningEffortFamily("gpt-5.5")).toBe("openai_gpt5");
    expect(detectReasoningEffortFamily("o3")).toBe("openai_o");
    expect(detectReasoningEffortFamily("claude-sonnet-4", undefined, "anthropic_messages")).toBe("anthropic");
    expect(detectReasoningEffortFamily("deepseek-reasoner")).toBe("deepseek");
    expect(detectReasoningEffortFamily("deepseek-r1")).toBe("deepseek");
    expect(detectReasoningEffortFamily("deepseek-v4-flash")).toBeNull();
    expect(detectReasoningEffortFamily("gpt-4o-mini")).toBeNull();
  });

  it("uses different option sets", () => {
    expect(getReasoningEffortProfile("gpt-5.5")?.options.map((o) => o.value)).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(getReasoningEffortProfile("o3")?.options.map((o) => o.value)).toEqual(["low", "medium", "high"]);
    expect(getReasoningEffortProfile("claude-sonnet-4")?.wire).toBe("anthropic_thinking_budget");
    expect(getReasoningEffortProfile("deepseek-reasoner")?.wire).toBe("deepseek_max_tokens");
    expect(getReasoningEffortProfile("deepseek-reasoner")?.options.map((o) => o.value)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
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
        reasoningEffort: "xhigh",
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

  it("does not send reasoning_effort for DeepSeek; raises max_tokens instead", () => {
    const body = applyReasoningEffortToRequestBody({
      body: { model: "deepseek-reasoner", max_tokens: 1024 },
      modelId: "deepseek-reasoner",
      endpointType: "openai_chat",
      reasoningEffort: "high",
    });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.max_tokens).toBe(reasoningEffortToDeepSeekMaxTokens("high", 1024));
  });

  it("normalizes effort values to family allow-list", () => {
    expect(normalizeModelReasoningEffort("minimal", ["low", "medium", "high"])).toBe("low");
    expect(normalizeModelReasoningEffort("xhigh", ["low", "medium", "high"])).toBe("high");
  });
});
