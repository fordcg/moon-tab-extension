/**
 * Provider-aware reasoning / thinking intensity.
 *
 * Official sources (re-verified 2026-07-18):
 * - OpenAI o-series / GPT-5.x: top-level `reasoning_effort`
 *   - o-series: low | medium | high
 *   - GPT-5.x:  minimal | low | medium | high | xhigh
 * - Anthropic Claude extended thinking (Messages API):
 *   - `thinking: { type: "enabled", budget_tokens: number }`
 *   - No official low/medium/high effort enum on classic extended-thinking path
 *   - budget_tokens min typically 1024; max_tokens must be greater than budget_tokens
 *   - Anthropic docs portal is geo-blocked in this environment; wire format confirmed via
 *     widespread SDK/docs citations (budget_tokens).
 * - DeepSeek Chat Completions (official api-docs.deepseek.com create-chat-completion):
 *   - `thinking: { type: "enabled" | "disabled" }` (default enabled)
 *   - `reasoning_effort: "high" | "max"`
 *   - Compatibility: low/medium map to high; xhigh maps to max
 *   - Response may include `reasoning_content` and `completion_tokens_details.reasoning_tokens`
 *   - Models: deepseek-v4-flash / deepseek-v4-pro (deepseek-reasoner is legacy thinking mode)
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
  wire: "openai_reasoning_effort" | "anthropic_thinking_budget" | "deepseek_thinking_effort";
  /** Provider label shown in the model menu */
  providerLabel: string;
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

// Claude has no official effort enum on classic extended thinking; chips map to budget_tokens.
const ANTHROPIC_OPTIONS: ReasoningEffortOption[] = [
  { value: "low", label: "低", hint: "2k" },
  { value: "medium", label: "中", hint: "8k" },
  { value: "high", label: "高", hint: "16k" },
  { value: "xhigh", label: "极高", hint: "32k" },
];

// DeepSeek official: only high | max (low/medium alias to high, xhigh alias to max).
const DEEPSEEK_OPTIONS: ReasoningEffortOption[] = [
  { value: "high", label: "高", hint: "high" },
  { value: "xhigh", label: "最大", hint: "max" },
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

  // DeepSeek V4 thinking models + legacy reasoner / R1
  // Official docs: deepseek-v4-flash / deepseek-v4-pro support thinking + reasoning_effort
  if (/\bdeepseek\b/.test(text)) {
    if (
      /\b(v4-pro|v4-flash|v4\.pro|v4\.flash|reasoner|r1|thinking)\b/.test(text) ||
      /\bdeepseek-v4\b/.test(text)
    ) {
      return "deepseek";
    }
    return null;
  }

  // Anthropic Claude extended thinking (3.5+ / 3.7 / 4 / sonnet / opus; not claude-2 / instant / pure 3-haiku)
  if (endpointType === "anthropic_messages" || /\bclaude\b/.test(text)) {
    if (/\bclaude[-_ ]?2\b|\bclaude[-_ ]?instant\b/.test(text)) {
      return null;
    }
    if (
      endpointType === "anthropic_messages" ||
      /\b(3\.7|4|4\.5|opus|sonnet|thinking|3-5|3\.5|3-7)\b/.test(text)
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

  // Generic "reasoner/reasoning" IDs on OpenAI-compatible relays (not DeepSeek)
  if (/\b(reasoner|reasoning)\b/.test(text)) {
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
      return {
        family,
        options: OPENAI_GPT5_OPTIONS,
        defaultValue: "medium",
        wire: "openai_reasoning_effort",
        providerLabel: "GPT-5",
      };
    case "openai_o":
      return {
        family,
        options: OPENAI_O_OPTIONS,
        defaultValue: "medium",
        wire: "openai_reasoning_effort",
        providerLabel: "o 系列",
      };
    case "anthropic":
      return {
        family,
        options: ANTHROPIC_OPTIONS,
        defaultValue: "medium",
        wire: "anthropic_thinking_budget",
        providerLabel: "Claude 思考预算",
      };
    case "deepseek":
      return {
        family,
        options: DEEPSEEK_OPTIONS,
        defaultValue: "high",
        wire: "deepseek_thinking_effort",
        providerLabel: "DeepSeek 思考",
      };
    case "openai_compat":
      return {
        family,
        options: OPENAI_O_OPTIONS,
        defaultValue: "medium",
        wire: "openai_reasoning_effort",
        providerLabel: "兼容强度",
      };
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

  // Map to the nearest allowed tier (works for OpenAI o, Claude, and DeepSeek high|max).
  const rank: ModelReasoningEffort[] = ["minimal", "low", "medium", "high", "xhigh"];
  const valueIndex = rank.indexOf(value);
  if (valueIndex >= 0) {
    for (let distance = 1; distance < rank.length; distance += 1) {
      const lower = rank[valueIndex - distance];
      const higher = rank[valueIndex + distance];
      // Prefer the lower neighbor first so "minimal" collapses to "low" not "medium".
      if (lower && allowed.includes(lower)) {
        return lower;
      }
      if (higher && allowed.includes(higher)) {
        return higher;
      }
    }
  }

  return allowed.includes("medium") ? "medium" : allowed[0] ?? "medium";
}

/** Anthropic extended-thinking budget_tokens presets (official min is typically 1024). */
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
 * Map UI effort to DeepSeek official reasoning_effort values.
 * Official allow-list: high | max
 * Compatibility (docs): low/medium -> high, xhigh -> max
 */
export function reasoningEffortToDeepSeekWire(effort: ModelReasoningEffort): "high" | "max" {
  if (effort === "xhigh") {
    return "max";
  }
  return "high";
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

  if (profile.wire === "deepseek_thinking_effort") {
    // Official DeepSeek Chat Completions:
    //   thinking: { type: "enabled" | "disabled" }
    //   reasoning_effort: "high" | "max"
    return {
      ...input.body,
      thinking: {
        type: "enabled",
      },
      reasoning_effort: reasoningEffortToDeepSeekWire(effort),
    };
  }

  // OpenAI o/gpt-5 and OpenAI-compatible reasoner relays.
  return {
    ...input.body,
    reasoning_effort: effort,
  };
}
