/**
 * Provider-aware reasoning / thinking intensity.
 *
 * OpenAI (o-series / GPT-5.x): top-level `reasoning_effort`
 *   - o-series: low | medium | high
 *   - gpt-5.x:  minimal | low | medium | high | xhigh
 * Anthropic Claude: `thinking: { type: "enabled", budget_tokens }`
 *   - UI: low | medium | high  → budget mapping
 * DeepSeek reasoner / r1: many OpenAI-compatible gateways accept `reasoning_effort`
 *   - UI: low | medium | high
 */

export type ModelReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export type ReasoningEffortFamily = "openai_o" | "openai_gpt5" | "anthropic" | "deepseek" | "openai_compat";

export interface ReasoningEffortOption {
  value: ModelReasoningEffort;
  label: string;
}

export interface ReasoningEffortProfile {
  family: ReasoningEffortFamily;
  options: ReasoningEffortOption[];
  defaultValue: ModelReasoningEffort;
}

const OPENAI_O_OPTIONS: ReasoningEffortOption[] = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

const OPENAI_GPT5_OPTIONS: ReasoningEffortOption[] = [
  { value: "minimal", label: "极低" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "极高" },
];

const ANTHROPIC_OPTIONS: ReasoningEffortOption[] = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

const DEEPSEEK_OPTIONS: ReasoningEffortOption[] = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

/** @deprecated use getReasoningEffortProfile(...).options */
export const MODEL_REASONING_EFFORT_OPTIONS: ReasoningEffortOption[] = OPENAI_GPT5_OPTIONS;

function modelText(modelId?: string | null, displayName?: string | null): string {
  return [modelId, displayName].filter(Boolean).join(" ").toLowerCase().trim();
}

export function detectReasoningEffortFamily(
  modelId: string | undefined | null,
  displayName?: string | undefined | null,
  endpointType?: string,
): ReasoningEffortFamily | null {
  const text = modelText(modelId, displayName);
  if (!text) {
    return null;
  }

  if (endpointType === "anthropic_messages" || /\bclaude\b/.test(text)) {
    if (/\bclaude[-_ ]?2\b|\bclaude[-_ ]?instant\b|\bclaude[-_ ]?3-haiku\b/.test(text)) {
      return null;
    }
    if (/\b(3\.7|4|4\.5|opus|sonnet|thinking)\b/.test(text) || endpointType === "anthropic_messages") {
      // Prefer known thinking-capable Claude IDs; bare "claude" on anthropic endpoint still allowed.
      if (endpointType === "anthropic_messages" || /\b(3\.7|4|4\.5|opus|sonnet|thinking|3-5|3\.5)\b/.test(text)) {
        return "anthropic";
      }
    }
  }

  if (/\bdeepseek\b/.test(text) && /\b(reasoner|r1|thinking)\b/.test(text)) {
    return "deepseek";
  }

  if (/\bgpt-5(\.\d+)?\b/.test(text) || /\bgpt-5[-_]/.test(text)) {
    return "openai_gpt5";
  }

  if (/\b(o1|o3|o4)([-_.]|$)/.test(text) || /\bo1-pro\b|\bo3-pro\b|\bo4-mini\b/.test(text)) {
    return "openai_o";
  }

  if (/\b(reasoner|reasoning|thinking)\b/.test(text)) {
    return "openai_compat";
  }

  return null;
}

export function detectModelSupportsReasoningEffort(
  modelId: string | undefined | null,
  displayName?: string | undefined | null,
  endpointType?: string,
): boolean {
  return detectReasoningEffortFamily(modelId, displayName, endpointType) !== null;
}

export function getReasoningEffortProfile(
  modelId: string | undefined | null,
  displayName?: string | undefined | null,
  endpointType?: string,
): ReasoningEffortProfile | null {
  const family = detectReasoningEffortFamily(modelId, displayName, endpointType);
  if (!family) {
    return null;
  }

  switch (family) {
    case "openai_gpt5":
      return { family, options: OPENAI_GPT5_OPTIONS, defaultValue: "medium" };
    case "openai_o":
      return { family, options: OPENAI_O_OPTIONS, defaultValue: "medium" };
    case "anthropic":
      return { family, options: ANTHROPIC_OPTIONS, defaultValue: "medium" };
    case "deepseek":
      return { family, options: DEEPSEEK_OPTIONS, defaultValue: "medium" };
    case "openai_compat":
      return { family, options: OPENAI_O_OPTIONS, defaultValue: "medium" };
    default:
      return null;
  }
}

export function normalizeModelReasoningEffort(
  value: unknown,
  allowed?: readonly ModelReasoningEffort[],
  fallback: ModelReasoningEffort = "medium",
): ModelReasoningEffort {
  const all: ModelReasoningEffort[] = ["minimal", "low", "medium", "high", "xhigh"];
  const options = allowed?.length ? allowed : all;
  if (typeof value === "string" && (options as string[]).includes(value)) {
    return value as ModelReasoningEffort;
  }
  if (typeof value === "string" && all.includes(value as ModelReasoningEffort)) {
    // Value exists but not allowed for this family — map nearest.
    return mapEffortToAllowed(value as ModelReasoningEffort, options);
  }
  return (options.includes(fallback) ? fallback : options[Math.floor(options.length / 2)]) ?? "medium";
}

function mapEffortToAllowed(value: ModelReasoningEffort, allowed: readonly ModelReasoningEffort[]): ModelReasoningEffort {
  if (allowed.includes(value)) {
    return value;
  }
  // Collapse minimal/xhigh into low/high when family does not support them.
  if (value === "minimal" && allowed.includes("low")) {
    return "low";
  }
  if (value === "xhigh" && allowed.includes("high")) {
    return "high";
  }
  return allowed.includes("medium") ? "medium" : allowed[0] ?? "medium";
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
  const profile = getReasoningEffortProfile(input.modelId, input.displayName, input.endpointType);
  if (!profile || !input.reasoningEffort) {
    return input.body;
  }

  const effort = normalizeModelReasoningEffort(
    input.reasoningEffort,
    profile.options.map((item) => item.value),
    profile.defaultValue,
  );

  if (profile.family === "anthropic" || input.endpointType === "anthropic_messages") {
    return {
      ...input.body,
      thinking: {
        type: "enabled",
        budget_tokens: reasoningEffortToAnthropicBudgetTokens(effort),
      },
    };
  }

  // OpenAI o/gpt-5, DeepSeek reasoner gateways, and other OpenAI-compatible relays.
  return {
    ...input.body,
    reasoning_effort: effort,
  };
}
