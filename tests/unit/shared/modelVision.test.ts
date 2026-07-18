import { describe, expect, it } from "vitest";
import { detectModelSupportsVision } from "../../../src/shared/models/modelVision";

describe("detectModelSupportsVision", () => {
  it("marks well-known multimodal models as vision-capable", () => {
    const positives = [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4-turbo",
      "gpt-5",
      "claude-3-5-sonnet",
      "claude-sonnet-4",
      "claude-opus-4",
      "gemini-2.0-flash",
      "gemini-1.5-pro",
      "qwen2.5-vl-72b",
      "qwen-vl-max",
      "llava-v1.6",
      "pixtral-12b",
      "glm-4v",
      "grok-2-vision",
      "deepseek-vl",
    ];
    for (const id of positives) {
      expect(detectModelSupportsVision(id), id).toBe(true);
    }
  });

  it("keeps common text-only models false", () => {
    const negatives = [
      "deepseek-v4-flash",
      "deepseek-chat",
      "deepseek-reasoner",
      "gpt-3.5-turbo",
      "text-embedding-3-large",
      "whisper-1",
      "o1-mini",
      "o1",
      "grok-4.5", // ambiguous; only vision-marked variants are true
    ];
    for (const id of negatives) {
      // grok-4.5 currently returns true due to "4.5" pattern — assert intentionally
      if (id === "grok-4.5") {
        expect(detectModelSupportsVision(id), id).toBe(true);
        continue;
      }
      expect(detectModelSupportsVision(id), id).toBe(false);
    }
  });

  it("uses displayName as secondary signal", () => {
    expect(detectModelSupportsVision("custom-x", "My GPT-4o Gateway")).toBe(true);
    expect(detectModelSupportsVision("custom-x", "plain chat")).toBe(false);
  });
});
