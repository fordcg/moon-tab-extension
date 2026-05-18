export const WIDGET_LAYOUT_STORAGE_KEY = "newtabWidgetLayout";

const WIDGET_LAYOUT_VERSION = 1;
const DEFAULT_WIDGET_ORDER = ["search", "quicksites", "calendar", "todo"];

const getStorageArea = () => {
  if (typeof chrome !== "undefined" && chrome?.storage?.local) {
    return chrome.storage.local;
  }

  return null;
};

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const createRegistryIndex = (registryItems = []) => {
  const items = [];
  const itemIds = new Set();

  for (const item of registryItems) {
    const itemId = typeof item?.id === "string" ? item.id : "";
    if (!itemId || itemIds.has(itemId)) {
      continue;
    }

    itemIds.add(itemId);
    items.push(item);
  }

  const knownIds = new Set(items.map((item) => item.id));
  const coreIds = items.filter((item) => item.core).map((item) => item.id);

  return { knownIds, coreIds };
};

const dedupeKnownIds = (value, knownIds) => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenIds = new Set();
  const normalizedIds = [];

  for (const itemId of value) {
    if (typeof itemId !== "string" || seenIds.has(itemId) || !knownIds.has(itemId)) {
      continue;
    }

    seenIds.add(itemId);
    normalizedIds.push(itemId);
  }

  return normalizedIds;
};

const getCoreIdsInDefaultOrder = (coreIds) => {
  const coreIdSet = new Set(coreIds);
  const orderedCoreIds = DEFAULT_WIDGET_ORDER.filter((itemId) => coreIdSet.has(itemId));

  for (const itemId of coreIds) {
    if (!orderedCoreIds.includes(itemId)) {
      orderedCoreIds.push(itemId);
    }
  }

  return orderedCoreIds;
};

const loadStoredLayout = async () => {
  const storageArea = getStorageArea();
  if (storageArea?.get) {
    const result = await storageArea.get(WIDGET_LAYOUT_STORAGE_KEY);
    return result?.[WIDGET_LAYOUT_STORAGE_KEY] ?? null;
  }

  if (typeof localStorage === "undefined") {
    return null;
  }

  const rawValue = localStorage.getItem(WIDGET_LAYOUT_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  return JSON.parse(rawValue);
};

export const createDefaultWidgetLayout = () => ({
  version: WIDGET_LAYOUT_VERSION,
  orderedWidgetIds: [...DEFAULT_WIDGET_ORDER],
  hiddenWidgetIds: [],
  widgetPrefs: {},
});

export const normalizeWidgetLayout = ({ layout, registryItems }) => {
  const { knownIds, coreIds } = createRegistryIndex(registryItems);
  const fallbackLayout = createDefaultWidgetLayout();
  const sourceLayout = isPlainObject(layout) ? layout : fallbackLayout;

  const orderedWidgetIds = dedupeKnownIds(sourceLayout.orderedWidgetIds, knownIds);
  const hiddenWidgetIds = dedupeKnownIds(sourceLayout.hiddenWidgetIds, knownIds);
  const orderedWidgetIdSet = new Set(orderedWidgetIds);

  const orderedCoreIds = getCoreIdsInDefaultOrder(coreIds);
  for (const coreId of orderedCoreIds) {
    if (orderedWidgetIdSet.has(coreId)) {
      continue;
    }

    orderedWidgetIds.push(coreId);
    orderedWidgetIdSet.add(coreId);
  }

  const normalizedHiddenWidgetIds = hiddenWidgetIds.filter(
    (itemId) => !orderedWidgetIdSet.has(itemId) && !coreIds.includes(itemId),
  );

  const sourceWidgetPrefs = isPlainObject(sourceLayout.widgetPrefs) ? sourceLayout.widgetPrefs : {};
  const widgetPrefs = {};

  for (const [itemId, itemPrefs] of Object.entries(sourceWidgetPrefs)) {
    if (!knownIds.has(itemId) || !isPlainObject(itemPrefs)) {
      continue;
    }

    widgetPrefs[itemId] = { ...itemPrefs };
  }

  return {
    version: WIDGET_LAYOUT_VERSION,
    orderedWidgetIds,
    hiddenWidgetIds: normalizedHiddenWidgetIds,
    widgetPrefs,
  };
};

export const loadWidgetLayout = async ({ registryItems }) => {
  try {
    const layout = await loadStoredLayout();
    return normalizeWidgetLayout({ layout, registryItems });
  } catch (error) {
    return normalizeWidgetLayout({ layout: createDefaultWidgetLayout(), registryItems });
  }
};

export const saveWidgetLayout = async (layout) => {
  const storageArea = getStorageArea();
  if (storageArea?.set) {
    await storageArea.set({ [WIDGET_LAYOUT_STORAGE_KEY]: layout });
    return layout;
  }

  if (typeof localStorage !== "undefined") {
    localStorage.setItem(WIDGET_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  }

  return layout;
};
