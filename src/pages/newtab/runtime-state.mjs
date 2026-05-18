export const createNewtabRuntimeState = ({ initialSearchTarget } = {}) => {
  let currentSearchTarget = initialSearchTarget ?? null;
  let searchHistoryItems = [];

  return {
    getCurrentSearchTarget: () => currentSearchTarget,
    setCurrentSearchTarget: (target) => {
      currentSearchTarget = target ?? null;
    },
    getSearchHistoryItems: () => [...searchHistoryItems],
    setSearchHistoryItems: (items) => {
      searchHistoryItems = Array.isArray(items) ? [...items] : [];
      return [...searchHistoryItems];
    },
  };
};
