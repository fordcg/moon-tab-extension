import { TODO_STORAGE_KEY } from "./todo-constants.mjs";
import { normalizeTaskPayload } from "./todo-model.mjs";

const getStorageArea = () => {
  if (typeof chrome !== "undefined" && chrome?.storage?.local) {
    return chrome.storage.local;
  }

  return null;
};

export const readTodoPayload = async () => {
  const storageArea = getStorageArea();
  if (!storageArea?.get) {
    return normalizeTaskPayload(null);
  }

  try {
    const items = await storageArea.get(TODO_STORAGE_KEY);
    return normalizeTaskPayload(items?.[TODO_STORAGE_KEY]);
  } catch (_error) {
    return normalizeTaskPayload(null);
  }
};

export const writeTodoPayload = async (payload) => {
  const normalizedPayload = normalizeTaskPayload(payload);
  const storageArea = getStorageArea();
  if (!storageArea?.set) {
    return normalizedPayload;
  }

  await storageArea.set({ [TODO_STORAGE_KEY]: normalizedPayload });
  return normalizedPayload;
};
