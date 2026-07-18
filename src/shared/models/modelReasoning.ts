/**
 * Provider-aware reasoning / thinking intensity.
 *
 * Sources (official / docs-based):
 * - OpenAI o-series / GPT-5.x: request field `reasoning_effort`
 *   - o-series: low | medium | high
 *   - GPT-5.x:  minimal | low | medium | high | xhigh
 * - Anthropic Claude extended thinking: `thinking: { type: "enabled", budget_tokens }`
 *   - No official low/medium/high enum; we expose budget presets via UI chips
 * - DeepSeek reasoner / R1: returns `reasoning_content`; official API does NOT document
 *   `reasoning_effort`. Thinking length is mainly constrained by `max_tokens`.
 *   We expose budget presets that raise max_tokens, not a fake reasoning_effort field.
 */

export type ModelReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export type ReasoningEffortFamily = "openai_o" | "openai_gpt5" | "anthropic" | "deepseek" | "openai_compat";

export interface ReasoningEffortOption {
  value: ModelReasoningEffort;
  label: string;
  /** Short hint shown under chips when useful */
  hint?: string;
}

export interface ReasoningEffortProfile {
  family: ReasoningEffortFamily;
  options: ReasoningEffortOption[];
  defaultValue: ModelReasoningEffort;
  /** How this family is applied to the wire payload */
  wire: "openai_reasoning_effort" | "anthropic_thinking_budget" | "deepseek_max_tokens";
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

// Claude has no official effort enum; chips map to thinking.budget_tokens presets.
const ANTHROPIC_OPTIONS: ReasoningEffortOption[] = [
  { value: "low", label: "低", hint: "2k" },
  { value: "medium", label: "中", hint: "8k" },
  { value: "high", label: "高", hint: "16k" },
  { value: "xhigh", label: "极高", hint: "32k" },
];

// DeepSeek reasoner: no official reasoning_effort; chips map to max_tokens floor.
const DEEPSEEK_OPTIONS: ReasoningEffortOption[] = [
  { value: "low", label: "低", hint: "4k" },
  { value: "medium", label: "中", hint: "8k" },
  { value: "high", label: "高", hint: "16k" },
  { value: "xhigh", label: "极高", hint: "32k" },
];

/** @deprecated use getReasoningEffortProfile(...).options */
export const MODEL_REASONING_EFFORT_OPTIONS: ReasoningEffortOption[] = OPENAI_GPT5_OPTIONS;

function modelText(modelId?: string | null, displayName?: string | null): string {
  return [modelId, displayName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replaceAll(/[\\/]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
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

  // DeepSeek reasoner / R1 first
  if (/\bdeepseek\b/.test(text) && /\b(reasoner|r1|thinking)\b/.test(text)) {
    return "deepseek";
  }

  // Anthropic Claude extended thinking (3.7 / 4 / sonnet / opus; not claude-2 / instant / 3-haiku)
  if (endpointType === "anthropic_messages" || /\bclaude\b/.test(text)) {
    if (/\bclaude[-_ ]?2\b|\bclaude[-_ ]?instant\b|\bclaude[-_ ]?3-haiku\b/.test(text)) {
      return null;
    }
    if (
      endpointType === "anthropic_messages" ||
      /\b(3\.7|4|4\.5|opus|sonnet|thinking|3-5|3\.5)\b/.test(text)
    ) {
      return "anthropic";
    }
  }

  // OpenAI GPT-5.x
  if (/\bgpt-5(\.\d+)?\b/.test(text) || /\bgpt-5[-_]/.test(text)) {
    return "openai_gpt5";
  }

  // OpenAI o-series
  if (/\b(o1|o3|o4)([-_.]|$)/.test(text) || /\bo1-pro\b|\bo3-pro\b|\bo4-mini\b/.test(text)) {
    return "openai_o";
  }

  // Generic "reasoner/reasoning" IDs on OpenAI-compatible relays
  if (/\b(reasoner|reasoning)\b/.test(text) && !/\bdeepseek\b/.test(text)) {
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
      return { family, options: OPENAI_GPT5_OPTIONS, defaultValue: "medium", wire: "openai_reasoning_effort" };
    case "openai_o":
      return { family, options: OPENAI_O_OPTIONS, defaultValue: "medium", wire: "openai_reasoning_effort" };
    case "anthropic":
      return { family, options: ANTHROPIC_OPTIONS, defaultValue: "medium", wire: "anthropic_thinking_budget" };
    case "deepseek":
      return { family, options: DEEPSEEK_OPTIONS, defaultValue: "medium", wire: "deepseek_max_tokens" };
    case "openai_compat":
      return { family, options: OPENAI_O_OPTIONS, defaultValue: "medium", wire: "openai_reasoning_effort" };
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
    return mapEffortToAllowed(value as ModelReasoningEffort, options);
  }
  return (options.includes(fallback) ? fallback : options[Math.floor(options.length / 2)]) ?? "medium";
}

function mapEffortToAllowed(value: ModelReasoningEffort, allowed: readonly ModelReasoningEffort[]): ModelReasoningEffort {
  if (allowed.includes(value)) {
    return value;
  }
  if (value === "minimal" && allowed.includes("low")) {
    return "low";
  }
  if (value === "xhigh" && allowed.includes("high")) {
    return "high";
  }
  return allowed.includes("medium") ? "medium" : allowed[0] ?? "medium";
}

/** Anthropic extended-thinking budget_tokens presets (min official is typically 1024). */
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
 * DeepSeek reasoner has no official reasoning_effort.
 * Raise max_tokens floor so the model has room for reasoning_content + answer.
 */
export function reasoningEffortToDeepSeekMaxTokens(effort: ModelReasoningEffort, currentMaxTokens?: number): number {
  const floor = (() => {
    switch (effort) {
      case "minimal":
      case "low":
        return 4_096;
      case "medium":
        return 8_192;
      case "high":
        return 16_384;
      case "xhigh":
        return 32_768;
      default:
        return 8_192;
    }
  })();
  const current = typeof currentMaxTokens === "number" && Number.isFinite(currentMaxTokens) ? currentMaxTokens : 0;
  return Math.max(floor, current);
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

  if (profile.wire === "anthropic_thinking_budget" || input.endpointType === "anthropic_messages") {
    const budget = reasoningEffortToAnthropicBudgetTokens(effort);
    const currentMax = typeof input.body.max_tokens === "number" ? input.body.max_tokens : undefined;
    // Anthropic requires max_tokens > budget_tokens for thinking-enabled requests.
    const maxTokens = Math.max(currentMax ?? 0, budget + 1_024);
    return {
      ...input.body,
      max_tokens: maxTokens,
      thinking: {
        type: "enabled",
        budget_tokens: budget,
      },
    };
  }

  if (profile.wire === "deepseek_max_tokens") {
    const currentMax = typeof input.body.max_tokens === "number" ? input.body.max_tokens : undefined;
    return {
      ...input.body,
      max_tokens: reasoningEffortToDeepSeekMaxTokens(effort, currentMax),
      // Do NOT send reasoning_effort for official DeepSeek reasoner.
    };
  }

  // OpenAI o/gpt-5 and OpenAI-compatible reasoner relays.
  return {
    ...input.body,
    reasoning_effort: effort,
  };
}
