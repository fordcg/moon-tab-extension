export const TOKEN_USAGE_SCHEMA_VERSION = 1;

const TOKEN_USAGE_SOURCES = new Set(["chat", "tool_decision", "tool_final", "title"]);
const TOKEN_USAGE_FIELDS = ["inputTokens", "outputTokens", "cacheWriteTokens", "cacheReadTokens"];

export function normalizeModelTokenUsage(data) {
  const source = getUsageSource(data);
  if (!source) return createEmptyTokenUsage();

  const deepSeekCacheReadTokens = readOptionalTokenCount(source, "prompt_cache_hit_tokens");
  const deepSeekCacheMissTokens = readOptionalTokenCount(source, "prompt_cache_miss_tokens");
  const openAICachedTokens = readOptionalTokenCount(source.prompt_tokens_details, "cached_tokens");

  const cacheReadTokens = deepSeekCacheReadTokens ?? openAICachedTokens ?? readOptionalTokenCount(source, "cache_read_input_tokens") ?? 0;
  const cacheWriteTokens = readOptionalTokenCount(source, "cache_creation_input_tokens") ?? 0;
  const promptTokens = readOptionalTokenCount(source, "prompt_tokens") ?? 0;
  const inputTokens = deepSeekCacheMissTokens ?? readOptionalTokenCount(source, "input_tokens") ?? Math.max(0, promptTokens - cacheReadTokens);
  const outputTokens = readOptionalTokenCount(source, "completion_tokens") ?? readOptionalTokenCount(source, "output_tokens") ?? 0;

  return {
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
  };
}

export function hasTokenUsage(usage) {
  if (!isRecord(usage)) return false;
  return TOKEN_USAGE_FIELDS.some((field) => readOptionalTokenCount(usage, field) > 0);
}

export function addTokenUsage(left, right) {
  return {
    inputTokens: readTokenCount(left, "inputTokens") + readTokenCount(right, "inputTokens"),
    outputTokens: readTokenCount(left, "outputTokens") + readTokenCount(right, "outputTokens"),
    cacheWriteTokens: readTokenCount(left, "cacheWriteTokens") + readTokenCount(right, "cacheWriteTokens"),
    cacheReadTokens: readTokenCount(left, "cacheReadTokens") + readTokenCount(right, "cacheReadTokens"),
  };
}

export function createTokenUsageEntry(source, usage, createdAt = Date.now()) {
  const normalizedSource = typeof source === "string" && TOKEN_USAGE_SOURCES.has(source) ? source : "chat";
  return {
    schemaVersion: TOKEN_USAGE_SCHEMA_VERSION,
    source: normalizedSource,
    createdAt,
    usage: addTokenUsage(usage, undefined),
  };
}

export function sumTokenUsageEntries(entries) {
  let total = createEmptyTokenUsage();
  for (const entry of Array.isArray(entries) ? entries : []) {
    total = addTokenUsage(total, isRecord(entry) ? entry.usage : undefined);
  }
  return total;
}

export function mergeTokenUsageEntries(existingEntries, nextEntries) {
  const merged = [];
  const seenKeys = new Set();

  for (const entry of [...toArray(existingEntries), ...toArray(nextEntries)]) {
    if (!isRecord(entry)) continue;

    const key = createEntryKey(entry);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    merged.push(entry);
  }

  return merged;
}

function createEmptyTokenUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  };
}

function getUsageSource(data) {
  if (!isRecord(data)) return undefined;
  if (isRecord(data.usage)) return data.usage;
  if (isRecord(data.message) && isRecord(data.message.usage)) return data.message.usage;
  return undefined;
}

function readTokenCount(source, key) {
  return readOptionalTokenCount(source, key) ?? 0;
}

function readOptionalTokenCount(source, key) {
  if (!isRecord(source)) return undefined;

  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  if (typeof value === "string" && value.trim()) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      return Math.max(0, Math.trunc(numericValue));
    }
  }

  return undefined;
}

function createEntryKey(entry) {
  if (typeof entry.id === "string" && entry.id) return `id:${entry.id}`;
  return `${entry.schemaVersion ?? ""}:${entry.source ?? ""}:${entry.createdAt ?? ""}:${JSON.stringify(entry.usage ?? {})}`;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
