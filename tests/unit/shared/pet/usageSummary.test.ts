import { describe, expect, it } from "vitest";
import type { ChatSession } from "../../../../src/shared/types";
import { buildPetUsageSummary } from "../../../../src/shared/pet/usageSummary";
import { estimateUsageCostUsd, formatUsd } from "../../../../src/shared/pet/pricing";

function session(partial: Partial<ChatSession> & { id: string }): ChatSession {
  return {
    id: partial.id,
    title: partial.title ?? "s",
    archived: partial.archived ?? false,
    sortOrder: partial.sortOrder ?? 0,
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? 1,
    messages: partial.messages ?? [],
    tokenUsageEntries: partial.tokenUsageEntries,
  };
}

describe("pet usage summary", () => {
  it("aggregates today and model rows from session token entries", () => {
    const now = Date.now();
    const summary = buildPetUsageSummary({
      now,
      sessions: [
        session({
          id: "a",
          title: "Alpha",
          updatedAt: now,
          tokenUsageEntries: [
            {
              id: "u1",
              usageSchemaVersion: 1,
              source: "chat",
              modelId: "claude-opus-4",
              endpointType: "anthropic_messages",
              createdAt: now - 60_000,
              inputTokens: 1000,
              outputTokens: 500,
              cacheWriteTokens: 0,
              cacheReadTokens: 0,
            },
          ],
        }),
      ],
    });

    expect(summary.today.usage.inputTokens).toBe(1000);
    expect(summary.today.usage.outputTokens).toBe(500);
    expect(summary.byModel[0]?.modelId).toBe("claude-opus-4");
    expect(summary.sessions[0]?.title).toBe("Alpha");
    expect(summary.today.costUsd).toBeGreaterThan(0);
  });

  it("estimates opus cost in USD", () => {
    const cost = estimateUsageCostUsd(
      { inputTokens: 1_000_000, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 },
      "claude-opus-4",
    );
    expect(cost).toBe(15);
    expect(formatUsd(cost)).toBe("$15.000");
  });
});
