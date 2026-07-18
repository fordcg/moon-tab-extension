import type { ChatSession, ChatTokenUsage, ChatTokenUsageEntry } from "../types";
import { createEmptyTokenUsage, hasTokenUsage, sumTokenUsageEntries } from "../chat/tokenUsage";
import { estimateUsageCostUsd, type ModelPrice } from "./pricing";

export interface PetUsageBucket {
  usage: ChatTokenUsage;
  costUsd: number;
  tokens: number;
}

export interface PetModelUsageRow {
  modelId: string;
  usage: ChatTokenUsage;
  costUsd: number;
  tokens: number;
}

export interface PetSessionUsageRow {
  sessionId: string;
  title: string;
  usage: ChatTokenUsage;
  costUsd: number;
  tokens: number;
  updatedAt: number;
}

export interface PetUsageSummary {
  today: PetUsageBucket;
  window5h: PetUsageBucket;
  byModel: PetModelUsageRow[];
  sessions: PetSessionUsageRow[];
  totalMessages: number;
}

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

export function buildPetUsageSummary(input: {
  sessions: ChatSession[];
  now?: number;
  prices?: Record<string, ModelPrice>;
}): PetUsageSummary {
  const now = input.now ?? Date.now();
  const startOfDay = startOfLocalDay(now);
  const windowStart = now - FIVE_HOURS_MS;

  const todayEntries: ChatTokenUsageEntry[] = [];
  const windowEntries: ChatTokenUsageEntry[] = [];
  const byModel = new Map<string, ChatTokenUsageEntry[]>();
  const sessionRows: PetSessionUsageRow[] = [];
  let totalMessages = 0;

  for (const session of input.sessions) {
    totalMessages += session.messages?.length ?? 0;
    const entries = session.tokenUsageEntries ?? [];
    const sessionUsage = sumTokenUsageEntries(entries);
    if (hasTokenUsage(sessionUsage)) {
      sessionRows.push({
        sessionId: session.id,
        title: session.title || "未命名会话",
        usage: sessionUsage,
        costUsd: estimateUsageCostUsd(sessionUsage, entries[0]?.modelId, input.prices),
        tokens: totalTokens(sessionUsage),
        updatedAt: session.updatedAt ?? 0,
      });
    }

    for (const entry of entries) {
      if (entry.createdAt >= startOfDay) {
        todayEntries.push(entry);
      }
      if (entry.createdAt >= windowStart) {
        windowEntries.push(entry);
      }
      const modelId = entry.modelId || "unknown";
      const list = byModel.get(modelId) ?? [];
      list.push(entry);
      byModel.set(modelId, list);
    }
  }

  const todayUsage = sumTokenUsageEntries(todayEntries);
  const windowUsage = sumTokenUsageEntries(windowEntries);

  const modelRows: PetModelUsageRow[] = Array.from(byModel.entries())
    .map(([modelId, entries]) => {
      const usage = sumTokenUsageEntries(entries);
      return {
        modelId,
        usage,
        costUsd: estimateUsageCostUsd(usage, modelId, input.prices),
        tokens: totalTokens(usage),
      };
    })
    .filter((row) => hasTokenUsage(row.usage))
    .sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens);

  sessionRows.sort((a, b) => b.updatedAt - a.updatedAt);

  return {
    today: {
      usage: todayUsage,
      costUsd: sumEntryCosts(todayEntries, input.prices),
      tokens: totalTokens(todayUsage),
    },
    window5h: {
      usage: windowUsage,
      costUsd: sumEntryCosts(windowEntries, input.prices),
      tokens: totalTokens(windowUsage),
    },
    byModel: modelRows,
    sessions: sessionRows.slice(0, 12),
    totalMessages,
  };
}

function sumEntryCosts(entries: ChatTokenUsageEntry[], prices?: Record<string, ModelPrice>): number {
  return entries.reduce((sum, entry) => {
    return sum + estimateUsageCostUsd(entry, entry.modelId, prices);
  }, 0);
}

function totalTokens(usage: ChatTokenUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheWriteTokens + usage.cacheReadTokens;
}

function startOfLocalDay(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function emptyPetUsageSummary(): PetUsageSummary {
  const empty = createEmptyTokenUsage();
  return {
    today: { usage: empty, costUsd: 0, tokens: 0 },
    window5h: { usage: empty, costUsd: 0, tokens: 0 },
    byModel: [],
    sessions: [],
    totalMessages: 0,
  };
}
