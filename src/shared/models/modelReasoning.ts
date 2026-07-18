/**
 * Reasoning-effort / thinking-intensity helpers for models that accept
 * OpenAI-compatible `reasoning_effort` or Anthropic `thinking.budget_tokens`.
 */

export type ModelReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export const MODEL_REASONING_EFFORT_OPTIONS: Array<{
  value: ModelReasoningEffort;
  label: string;
  shortLabel: string;
}> = [
  { value: "minimal", label: "极低", shortLabel: "极低" },
  { value: "low", label: "低", shortLabel: "低" },
  { value: "medium", label: "中", shortLabel: "中" },
  { value: "high", label: "高", shortLabel: "高" },
  { value: "xhigh", label: "极高", shortLabel: "极高" },
];

const DEFAULT_EFFORT: ModelReasoningEffort = "medium";

/** Whether this model ID commonly accepts reasoning effort / extended thinking. */
export function detectModelSupportsReasoningEffort(
  modelId: string | undefined | null,
  displayName?: string | undefined | null,
): boolean {
  const text = [modelId, displayName].filter(Boolean).join(" ").toLowerCase().trim();
  if (!text) {
    return false;
  }

  // Explicit reasoning families
  if (/\b(o1|o3|o4)([-_.]|$)/.test(text) || /\bo1-pro\b|\bo3-pro\b|\bo4-mini\b/.test(text)) {
    return true;
  }
  if (/\bgpt-5(\.\d+)?\b/.test(text) || /\bgpt-5[-_]/.test(text)) {
    return true;
  }
  if (/\bdeepseek\b/.test(text) && /\b(reasoner|r1|thinking)\b/.test(text)) {
    return true;
  }
  if (/\bclaude\b/.test(text) && (/\b(3\.7|4|4\.5|opus|sonnet)\b/.test(text) || /\bthinking\b/.test(text))) {
    // Claude 3.5 still can use extended thinking on some gateways; keep broader for 3.7+/4+
    if (/\bclaude[-_ ]?2\b|\bclaude[-_ ]?instant\b|\bclaude[-_ ]?3-haiku\b/.test(text)) {
      return false;
    }
    return true;
  }
  if (/\b(reasoner|reasoning|thinking)\b/.test(text)) {
    return true;
  }
  if (/\bgrok\b/.test(text) && /\b(reason|thinking|3-mini|4)\b/.test(text)) {
    return true;
  }
  return false;
}

export function normalizeModelReasoningEffort(value: unknown, fallback: ModelReasoningEffort = DEFAULT_EFFORT): ModelReasoningEffort {
  if (value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh") {
    return value;
  }
  return fallback;
}

/** Anthropic extended-thinking budget mapped from effort. */
export function reasoningEffortToAnthropicBudgetTokens(effort: ModelReasoningEffort): number {
  switch (effort) {
    case "minimal":
      return 1_024;
    case "low":
      return 2_048;
    case "medium":
      return 8_192;
    case "high":
      return 16_384;
    case "xhigh":
      return 32_768;
    default:
      return 8_192;
  }
}

/**
 * Apply provider-specific reasoning/thinking fields onto a request body.
 * Safe no-op when the model does not support effort.
 */
export function applyReasoningEffortToRequestBody(input: {
  body: Record<string, unknown>;
  modelId: string;
  displayName?: string;
  endpointType: "openai_chat" | "anthropic_messages" | string;
  reasoningEffort?: ModelReasoningEffort | null;
}): Record<string, unknown> {
  const effort = input.reasoningEffort ? normalizeModelReasoningEffort(input.reasoningEffort) : undefined;
  if (!effort) {
    return input.body;
  }
  if (!detectModelSupportsReasoningEffort(input.modelId, input.displayName)) {
    return input.body;
  }

  if (input.endpointType === "anthropic_messages") {
    return {
      ...input.body,
      // Anthropic Messages API extended thinking.
      thinking: {
        type: "enabled",
        budget_tokens: reasoningEffortToAnthropicBudgetTokens(effort),
      },
    };
  }

  // OpenAI-compatible gateways (GPT-5.x / o-series / DeepSeek reasoner / many third-party relays)
  // commonly accept top-level reasoning_effort.
  return {
    ...input.body,
    reasoning_effort: effort,
  };
}
