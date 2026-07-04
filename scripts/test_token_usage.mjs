import assert from "node:assert/strict";
import {
  addTokenUsage,
  createTokenUsageEntry,
  hasTokenUsage,
  mergeTokenUsageEntries,
  normalizeModelTokenUsage,
  sumTokenUsageEntries,
} from "../src/shared/token-usage.mjs";

assert.deepEqual(normalizeModelTokenUsage({
  usage: {
    prompt_tokens: 100,
    completion_tokens: 20,
    prompt_tokens_details: { cached_tokens: 30 },
  },
}), {
  inputTokens: 70,
  outputTokens: 20,
  cacheWriteTokens: 0,
  cacheReadTokens: 30,
});

assert.deepEqual(normalizeModelTokenUsage({
  usage: {
    prompt_cache_hit_tokens: 12,
    prompt_cache_miss_tokens: 40,
    completion_tokens: 9,
  },
}), {
  inputTokens: 40,
  outputTokens: 9,
  cacheWriteTokens: 0,
  cacheReadTokens: 12,
});

assert.deepEqual(normalizeModelTokenUsage({
  message: {
    usage: {
      input_tokens: 50,
      output_tokens: 7,
      cache_creation_input_tokens: 5,
      cache_read_input_tokens: 6,
    },
  },
}), {
  inputTokens: 50,
  outputTokens: 7,
  cacheWriteTokens: 5,
  cacheReadTokens: 6,
});

assert.equal(hasTokenUsage(undefined), false);
assert.equal(hasTokenUsage({ inputTokens: 1 }), true);
assert.deepEqual(addTokenUsage({ inputTokens: 1 }, { outputTokens: 2 }), {
  inputTokens: 1,
  outputTokens: 2,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
});

const first = createTokenUsageEntry("chat", { inputTokens: 1, outputTokens: 2 }, 100);
const second = createTokenUsageEntry("tool_decision", { cacheReadTokens: 3 }, 101);
assert.deepEqual(sumTokenUsageEntries([first, second]), {
  inputTokens: 1,
  outputTokens: 2,
  cacheWriteTokens: 0,
  cacheReadTokens: 3,
});
assert.equal(mergeTokenUsageEntries([first], [first, second]).length, 2);

console.log("token usage tests passed");
