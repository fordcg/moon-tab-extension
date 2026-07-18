import type { ChatTokenUsage } from "../types";
import { normalizeTokenUsage } from "../chat/tokenUsage";

/** USD per 1M tokens */
export interface ModelPrice {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

const FAMILY_PRICES: Record<string, ModelPrice> = {
  opus: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  sonnet: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  haiku: { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 },
  fable: { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 },
  gpt: { input: 2.5, output: 10, cacheWrite: 1.25, cacheRead: 0.25 },
  deepseek: { input: 0.27, output: 1.1, cacheWrite: 0.27, cacheRead: 0.07 },
  default: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
};

export function resolveModelPrice(modelId: string | undefined, overrides?: Record<string, ModelPrice>): ModelPrice {
  if (modelId && overrides?.[modelId]) {
    return overrides[modelId];
  }
  const id = (modelId || "").toLowerCase();
  if (id.includes("opus")) return FAMILY_PRICES.opus;
  if (id.includes("sonnet")) return FAMILY_PRICES.sonnet;
  if (id.includes("haiku")) return FAMILY_PRICES.haiku;
  if (id.includes("fable")) return FAMILY_PRICES.fable;
  if (id.includes("gpt") || id.includes("o1") || id.includes("o3") || id.includes("o4")) return FAMILY_PRICES.gpt;
  if (id.includes("deepseek")) return FAMILY_PRICES.deepseek;
  return FAMILY_PRICES.default;
}

export function estimateUsageCostUsd(
  usage: Partial<ChatTokenUsage> | undefined,
  modelId?: string,
  overrides?: Record<string, ModelPrice>,
): number {
  const normalized = normalizeTokenUsage(usage);
  const price = resolveModelPrice(modelId, overrides);
  const cost =
    (normalized.inputTokens * price.input +
      normalized.outputTokens * price.output +
      normalized.cacheWriteTokens * price.cacheWrite +
      normalized.cacheReadTokens * price.cacheRead) /
    1_000_000;
  return Number.isFinite(cost) ? cost : 0;
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "$0.000";
  }
  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }
  return `$${value.toFixed(3)}`;
}

export function formatTokenCount(value: number): string {
  const n = Math.max(0, Math.floor(value || 0));
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  }
  return String(n);
}
