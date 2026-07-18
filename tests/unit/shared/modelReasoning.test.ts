import { describe, expect, it } from "vitest";
import {
  applyReasoningEffortToRequestBody,
  detectModelSupportsReasoningEffort,
  detectReasoningEffortFamily,
  getReasoningEffortProfile,
  normalizeModelReasoningEffort,
  reasoningEffortToAnthropicBudgetTokens,
} from "../../../src/shared/models/modelReasoning";
import { detectModelSupportsVision } from "../../../src/shared/models/modelVision";

describe("model reasoning effort", () => {
  it("classifies provider families", () => {
    expect(detectReasoningEffortFamily("gpt-5.5")).toBe("openai_gpt5");
    expect(detectReasoningEffortFamily("o3")).toBe("openai_o");
    expect(detectReasoningEffortFamily("o4-mini")).toBe("openai_o");
    expect(detectReasoningEffortFamily("claude-sonnet-4", undefined, "anthropic_messages")).toBe("anthropic");
    expect(detectReasoningEffortFamily("deepseek-reasoner")).toBe("deepseek");
    expect(detectReasoningEffortFamily("deepseek-v4-flash")).toBeNull();
    expect(detectReasoningEffortFamily("gpt-4o-mini")).toBeNull();
  });

  it("exposes different option sets per family", () => {
    expect(getReasoningEffortProfile("gpt-5.5")?.options.map((o) => o.value)).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(getReasoningEffortProfile("o3")?.options.map((o) => o.value)).toEqual(["low", "medium", "high"]);
    expect(getReasoningEffortProfile("claude-sonnet-4")?.options.map((o) => o.value)).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(getReasoningEffortProfile("deepseek-reasoner")?.options.map((o) => o.value)).toEqual([
      "low",
      "medium",
      "high",
    ]);
  });

  it("applies openai reasoning_effort", () => {
    const body = applyReasoningEffortToRequestBody({
      body: { model: "gpt-5.5", messages: [] },
      modelId: "gpt-5.5",
      endpointType: "openai_chat",
      reasoningEffort: "xhigh",
    });
    expect(body.reasoning_effort).toBe("xhigh");
  });

  it("maps o-series xhigh down to high", () => {
    const body = applyReasoningEffortToRequestBody({
      body: { model: "o3", messages: [] },
      modelId: "o3",
      endpointType: "openai_chat",
      reasoningEffort: "xhigh",
    });
    expect(body.reasoning_effort).toBe("high");
  });

  it("applies anthropic thinking budget", () => {
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

  it("normalizes invalid effort values against allowed list", () => {
    expect(normalizeModelReasoningEffort("nope", ["low", "medium", "high"])).toBe("medium");
    expect(normalizeModelReasoningEffort("minimal", ["low", "medium", "high"])).toBe("low");
  });

  it("detect helper matches profile presence", () => {
    expect(detectModelSupportsReasoningEffort("gpt-5.5")).toBe(true);
    expect(detectModelSupportsReasoningEffort("deepseek-v4-flash")).toBe(false);
  });
});

describe("gpt-5.x vision detection", () => {
  it("marks gpt-5.5 and similar as vision-capable", () => {
    expect(detectModelSupportsVision("gpt-5.5")).toBe(true);
    expect(detectModelSupportsVision("gpt-5.4")).toBe(true);
    expect(detectModelSupportsVision("gpt-5-mini")).toBe(true);
  });
});
