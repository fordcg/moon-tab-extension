const REMOTE_SUGGESTION_ENDPOINT = "https://api.bing.com/osjson.aspx";
const REMOTE_SUGGESTION_MARKET = "zh-CN";
const REMOTE_SUGGESTION_TIMEOUT = 3500;
const REMOTE_SUGGESTION_LIMIT = 5;
const LOCAL_HISTORY_LIMIT = 5;
const ACTION_ITEM_LIMIT = 4;
const MERGED_SUGGESTION_LIMIT = 10;

const normalizeQuery = (value) => (typeof value === "string" ? value.trim() : "");
const normalizeQueryKey = (value) => normalizeQuery(value).toLowerCase();

const createQueryItem = (query, source = "local") => ({
  type: "query",
  query,
  label: query,
  source,
});

const createActionItem = (query, target) => ({
  type: "action",
  query,
  label: `用 ${target.label} 搜索“${query}”`,
  source: "action",
  targetId: target.id,
});

export const createSearchActionItems = (query, targets) => {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery || !Array.isArray(targets)) {
    return [];
  }

  return targets
    .filter((target) => target && typeof target === "object" && typeof target.id === "string" && typeof target.label === "string")
    .slice(0, ACTION_ITEM_LIMIT)
    .map((target) => createActionItem(normalizedQuery, target));
};

export const createLocalSuggestionItems = (query, historyItems, targets) => {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return [];
  }

  const normalizedQueryKey = normalizeQueryKey(normalizedQuery);
  const localHistoryItems = Array.isArray(historyItems)
    ? historyItems
      .map((item) => normalizeQuery(typeof item === "string" ? item : item?.query))
      .filter(Boolean)
    : [];

  const historyMatches = [];
  const seenHistoryQueries = new Set();

  localHistoryItems.forEach((historyQuery) => {
    const historyKey = normalizeQueryKey(historyQuery);
    if (!historyKey || historyKey === normalizedQueryKey || seenHistoryQueries.has(historyKey)) {
      return;
    }

    if (!historyKey.startsWith(normalizedQueryKey)) {
      return;
    }

    seenHistoryQueries.add(historyKey);
    historyMatches.push(createQueryItem(historyQuery));
  });

  return [
    ...historyMatches.slice(0, LOCAL_HISTORY_LIMIT),
    ...createSearchActionItems(normalizedQuery, targets),
  ];
};

const buildSuggestionItemKey = (item) => {
  if (!item || typeof item !== "object") {
    return "";
  }

  if (item.type === "action") {
    return `action:${item.targetId ?? ""}:${normalizeQueryKey(item.query)}`;
  }

  return `query:${normalizeQueryKey(item.query)}`;
};

export const mergeSuggestionItems = (localItems, remoteItems) => {
  const mergedItems = [];
  const seenKeys = new Set();

  [...(Array.isArray(localItems) ? localItems : []), ...(Array.isArray(remoteItems) ? remoteItems : [])].forEach((item) => {
    const itemKey = buildSuggestionItemKey(item);
    if (!itemKey || seenKeys.has(itemKey)) {
      return;
    }

    seenKeys.add(itemKey);
    mergedItems.push(item);
  });

  return mergedItems.slice(0, MERGED_SUGGESTION_LIMIT);
};

export const fetchRemoteSuggestionItems = async (query) => {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return [];
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REMOTE_SUGGESTION_TIMEOUT);

  try {
    const url = new URL(REMOTE_SUGGESTION_ENDPOINT);
    url.searchParams.set("market", REMOTE_SUGGESTION_MARKET);
    url.searchParams.set("query", normalizedQuery);

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json, text/plain, */*",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return [];
    }

    const payload = await response.json();
    const suggestions = Array.isArray(payload) ? payload[1] : null;
    if (!Array.isArray(suggestions)) {
      return [];
    }

    const normalizedQueryKey = normalizeQueryKey(normalizedQuery);
    const seenQueries = new Set();

    return suggestions
      .map((item) => normalizeQuery(item))
      .filter((item) => {
        const itemKey = normalizeQueryKey(item);
        if (!itemKey || itemKey === normalizedQueryKey || seenQueries.has(itemKey)) {
          return false;
        }

        seenQueries.add(itemKey);
        return true;
      })
      .slice(0, REMOTE_SUGGESTION_LIMIT)
      .map((item) => createQueryItem(item, "remote"));
  } catch (error) {
    return [];
  } finally {
    window.clearTimeout(timeoutId);
  }
};
