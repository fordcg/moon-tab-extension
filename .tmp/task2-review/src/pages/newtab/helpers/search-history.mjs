const SEARCH_HISTORY_KEY = "searchHistory";
const SEARCH_HISTORY_LIMIT = 12;

const resolveExtensionApi = (extensionApi) => {
  if (extensionApi) {
    return extensionApi;
  }

  return typeof chrome !== "undefined" ? chrome : null;
};

const normalizeHistoryQuery = (value) => (typeof value === "string" ? value.trim() : "");

const normalizeHistoryItems = (items) => {
  if (!Array.isArray(items)) {
    return [];
  }

  const seenQueries = new Set();
  const normalizedItems = [];

  items.forEach((item) => {
    const query = normalizeHistoryQuery(item);
    const queryKey = query.toLowerCase();
    if (!query || seenQueries.has(queryKey)) {
      return;
    }

    seenQueries.add(queryKey);
    normalizedItems.push(query);
  });

  return normalizedItems.slice(0, SEARCH_HISTORY_LIMIT);
};

export const readSearchHistory = async (extensionApi) => {
  const api = resolveExtensionApi(extensionApi);
  if (!api?.storage?.local) {
    return [];
  }

  return new Promise((resolve) => {
    api.storage.local.get({ [SEARCH_HISTORY_KEY]: [] }, (items) => {
      if (api.runtime?.lastError) {
        resolve([]);
        return;
      }

      resolve(normalizeHistoryItems(items?.[SEARCH_HISTORY_KEY]));
    });
  });
};

export const saveSearchHistoryEntry = async (extensionApi, query) => {
  const normalizedQuery = normalizeHistoryQuery(query);
  if (!normalizedQuery) {
    return readSearchHistory(extensionApi);
  }

  const api = resolveExtensionApi(extensionApi);
  if (!api?.storage?.local) {
    return [];
  }

  const existingItems = await readSearchHistory(api);
  const normalizedQueryKey = normalizedQuery.toLowerCase();
  const nextItems = [
    normalizedQuery,
    ...existingItems.filter((item) => item.toLowerCase() !== normalizedQueryKey),
  ].slice(0, SEARCH_HISTORY_LIMIT);

  return new Promise((resolve) => {
    api.storage.local.set({ [SEARCH_HISTORY_KEY]: nextItems }, () => {
      if (api.runtime?.lastError) {
        resolve(existingItems);
        return;
      }

      resolve(nextItems);
    });
  });
};

export { SEARCH_HISTORY_KEY, SEARCH_HISTORY_LIMIT };
