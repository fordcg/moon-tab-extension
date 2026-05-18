export const SEARCH_TARGETS = Object.freeze([
  {
    id: "bing",
    label: "Bing",
    isGeneral: true,
    buildSearchUrl: (query) => `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
  },
  {
    id: "google",
    label: "Google",
    isGeneral: false,
    buildSearchUrl: (query) => `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  },
  {
    id: "github",
    label: "GitHub",
    isGeneral: false,
    buildSearchUrl: (query) => `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`,
  },
  {
    id: "bilibili",
    label: "B站",
    isGeneral: false,
    buildSearchUrl: (query) => `https://search.bilibili.com/all?keyword=${encodeURIComponent(query)}`,
  },
]);

export const DEFAULT_SEARCH_TARGET_ID = "bing";

export const getSearchTargetById = (targetId) =>
  SEARCH_TARGETS.find((target) => target.id === targetId) ?? SEARCH_TARGETS[0];
