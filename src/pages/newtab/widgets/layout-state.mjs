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

const areStringArraysEqual = (left, right) => {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
};

const areWidgetPrefsEqual = (left, right) => {
  if (!isPlainObject(left) || !isPlainObject(right)) {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (!areStringArraysEqual(leftKeys, rightKeys)) {
    return false;
  }

  return leftKeys.every((widgetId) => {
    const leftPrefs = left[widgetId];
    const rightPrefs = right[widgetId];
    if (!isPlainObject(leftPrefs) || !isPlainObject(rightPrefs)) {
      return false;
    }

    const leftPrefKeys = Object.keys(leftPrefs);
    const rightPrefKeys = Object.keys(rightPrefs);
    if (!areStringArraysEqual(leftPrefKeys, rightPrefKeys)) {
      return false;
    }

    return leftPrefKeys.every((prefKey) => leftPrefs[prefKey] === rightPrefs[prefKey]);
  });
};

const areWidgetLayoutsEqual = (left, right) =>
  isPlainObject(left)
  && isPlainObject(right)
  && left.version === right.version
  && areStringArraysEqual(left.orderedWidgetIds, right.orderedWidgetIds)
  && areStringArraysEqual(left.hiddenWidgetIds, right.hiddenWidgetIds)
  && areWidgetPrefsEqual(left.widgetPrefs, right.widgetPrefs);

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
  const defaultVisibleIds = items.filter((item) => item.defaultVisible).map((item) => item.id);
  const registryOrderIds = items.map((item) => item.id);

  return {
    knownIds,
    coreIds,
    defaultVisibleIds,
    registryOrderIds,
  };
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

const orderIdsByPreference = (itemIds, registryOrderIds) => {
  const candidateIds = new Set(itemIds);
  const orderedIds = [];

  for (const itemId of DEFAULT_WIDGET_ORDER) {
    if (candidateIds.has(itemId) && !orderedIds.includes(itemId)) {
      orderedIds.push(itemId);
    }
  }

  for (const itemId of registryOrderIds) {
    if (candidateIds.has(itemId) && !orderedIds.includes(itemId)) {
      orderedIds.push(itemId);
    }
  }

  for (const itemId of itemIds) {
    if (!orderedIds.includes(itemId)) {
      orderedIds.push(itemId);
    }
  }

  return orderedIds;
};

const resolvePreferredWidgetOrderIds = (registryItems = []) => {
  const { registryOrderIds } = createRegistryIndex(registryItems);
  return orderIdsByPreference(registryOrderIds, registryOrderIds);
};

const resolveDefaultOrderedWidgetIds = (registryItems = []) => {
  const { defaultVisibleIds } = createRegistryIndex(registryItems);
  const preferredOrderIds = resolvePreferredWidgetOrderIds(registryItems);
  if (defaultVisibleIds.length === 0) {
    return preferredOrderIds;
  }

  return preferredOrderIds.filter((itemId) => defaultVisibleIds.includes(itemId));
};

const loadStoredLayout = async () => {
  const storageArea = getStorageArea();
  if (!storageArea?.get) {
    throw new Error("Widget layout storage is unavailable.");
  }

  const result = await storageArea.get(WIDGET_LAYOUT_STORAGE_KEY);
  return result?.[WIDGET_LAYOUT_STORAGE_KEY] ?? null;
};

export const createDefaultWidgetLayout = ({ registryItems } = {}) => ({
  version: WIDGET_LAYOUT_VERSION,
  orderedWidgetIds: resolveDefaultOrderedWidgetIds(registryItems),
  hiddenWidgetIds: [],
  widgetPrefs: {},
});

export const normalizeWidgetLayout = ({ layout, registryItems }) => {
  const {
    knownIds,
    coreIds,
    defaultVisibleIds,
    registryOrderIds,
  } = createRegistryIndex(registryItems);
  const fallbackLayout = createDefaultWidgetLayout({ registryItems });
  const sourceLayout = isPlainObject(layout) ? layout : fallbackLayout;

  const storedHiddenWidgetIds = dedupeKnownIds(sourceLayout.hiddenWidgetIds, knownIds).filter(
    (itemId) => !coreIds.includes(itemId),
  );
  const hiddenWidgetIdSet = new Set(storedHiddenWidgetIds);
  const orderedWidgetIds = dedupeKnownIds(sourceLayout.orderedWidgetIds, knownIds).filter(
    (itemId) => !hiddenWidgetIdSet.has(itemId),
  );
  const orderedWidgetIdSet = new Set(orderedWidgetIds);

  const guaranteedVisibleIds = orderIdsByPreference(
    [...coreIds, ...defaultVisibleIds.filter((itemId) => !hiddenWidgetIdSet.has(itemId))],
    registryOrderIds,
  );

  for (const itemId of guaranteedVisibleIds) {
    if (orderedWidgetIdSet.has(itemId)) {
      continue;
    }

    orderedWidgetIds.push(itemId);
    orderedWidgetIdSet.add(itemId);
  }

  const normalizedHiddenWidgetIds = storedHiddenWidgetIds.filter(
    (itemId) => !orderedWidgetIdSet.has(itemId),
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
  const layout = await loadStoredLayout();
  const normalizedLayout = normalizeWidgetLayout({ layout, registryItems });

  if (!areWidgetLayoutsEqual(layout, normalizedLayout)) {
    try {
      await saveWidgetLayout(normalizedLayout);
    } catch (_error) {
      // Preserve runtime recovery even if the normalization rewrite cannot be persisted.
    }
  }

  return normalizedLayout;
};

export const saveWidgetLayout = async (layout) => {
  const storageArea = getStorageArea();
  if (!storageArea?.set) {
    throw new Error("Widget layout storage is unavailable.");
  }

  await storageArea.set({ [WIDGET_LAYOUT_STORAGE_KEY]: layout });
  return layout;
};

const getRegistryItemById = (widgetId, registryItems = []) =>
  registryItems.find((item) => item.id === widgetId) ?? null;

const insertWidgetIdByPreferredOrder = ({ orderedWidgetIds, widgetId, registryItems }) => {
  if (orderedWidgetIds.includes(widgetId)) {
    return [...orderedWidgetIds];
  }

  const preferredOrderIds = resolvePreferredWidgetOrderIds(registryItems);
  const widgetOrderIndex = preferredOrderIds.indexOf(widgetId);

  if (widgetOrderIndex === -1) {
    return [...orderedWidgetIds, widgetId];
  }

  const nextOrderedWidgetIds = [...orderedWidgetIds];

  for (let index = 0; index < nextOrderedWidgetIds.length; index += 1) {
    const currentId = nextOrderedWidgetIds[index];
    const currentOrderIndex = preferredOrderIds.indexOf(currentId);
    if (currentOrderIndex > widgetOrderIndex) {
      nextOrderedWidgetIds.splice(index, 0, widgetId);
      return nextOrderedWidgetIds;
    }
  }

  nextOrderedWidgetIds.push(widgetId);
  return nextOrderedWidgetIds;
};

export const hideWidget = async ({ layout, widgetId, registryItems }) => {
  const widget = getRegistryItemById(widgetId, registryItems);
  if (!widget || widget.core || !widget.canHide) {
    return normalizeWidgetLayout({ layout, registryItems });
  }

  const nextLayout = normalizeWidgetLayout({
    layout: {
      ...layout,
      hiddenWidgetIds: [...(layout?.hiddenWidgetIds ?? []), widgetId],
    },
    registryItems,
  });

  await saveWidgetLayout(nextLayout);
  return nextLayout;
};

export const restoreWidget = async ({ layout, widgetId, registryItems }) => {
  const widget = getRegistryItemById(widgetId, registryItems);
  if (!widget) {
    return normalizeWidgetLayout({ layout, registryItems });
  }

  const nextLayout = normalizeWidgetLayout({
    layout: {
      ...layout,
      hiddenWidgetIds: (layout?.hiddenWidgetIds ?? []).filter((itemId) => itemId !== widgetId),
      orderedWidgetIds: insertWidgetIdByPreferredOrder({
        orderedWidgetIds: layout?.orderedWidgetIds ?? [],
        widgetId,
        registryItems,
      }),
    },
    registryItems,
  });

  await saveWidgetLayout(nextLayout);
  return nextLayout;
};

export const updateWidgetPrefs = async ({ layout, widgetId, widgetPrefs, registryItems }) => {
  const widget = getRegistryItemById(widgetId, registryItems);
  if (!widget || !isPlainObject(widgetPrefs)) {
    return normalizeWidgetLayout({ layout, registryItems });
  }

  const nextLayout = normalizeWidgetLayout({
    layout: {
      ...layout,
      widgetPrefs: {
        ...(isPlainObject(layout?.widgetPrefs) ? layout.widgetPrefs : {}),
        [widgetId]: {
          ...(isPlainObject(layout?.widgetPrefs?.[widgetId]) ? layout.widgetPrefs[widgetId] : {}),
          ...widgetPrefs,
        },
      },
    },
    registryItems,
  });

  await saveWidgetLayout(nextLayout);
  return nextLayout;
};
