(() => {
  const existingChrome = globalThis.chrome;
  const isExtensionRuntime =
    globalThis.location?.protocol === "chrome-extension:" &&
    typeof existingChrome?.runtime?.id === "string";

  if (isExtensionRuntime) {
    return;
  }

  const STORAGE_PREFIX = "browser-ai-assistant.preview.";
  const memoryStorage = new Map();

  const storageKeys = () => {
    try {
      return Array.from({ length: localStorage.length }, (_value, index) =>
        localStorage.key(index),
      ).filter(Boolean);
    } catch {
      return Array.from(memoryStorage.keys());
    }
  };

  const storageGet = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return memoryStorage.get(key) ?? null;
    }
  };

  const storageSet = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      memoryStorage.set(key, value);
    }
  };

  const storageRemove = (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      memoryStorage.delete(key);
    }
  };

  const createEvent = () => {
    const listeners = new Set();
    return {
      addListener(listener) {
        if (typeof listener === "function") listeners.add(listener);
      },
      removeListener(listener) {
        listeners.delete(listener);
      },
      hasListener(listener) {
        return listeners.has(listener);
      },
      dispatch(...args) {
        for (const listener of listeners) listener(...args);
      },
    };
  };

  const asArray = (value) => (Array.isArray(value) ? value : [value]);

  const createStorageArea = (areaName) => {
    const prefix = `${STORAGE_PREFIX}${areaName}.`;

    const readAll = () => {
      const result = {};
      for (const storageKey of storageKeys()) {
        if (!storageKey?.startsWith(prefix)) continue;
        try {
          result[storageKey.slice(prefix.length)] = JSON.parse(storageGet(storageKey));
        } catch {
          storageRemove(storageKey);
        }
      }
      return result;
    };

    const finish = (callback, value) => {
      if (typeof callback === "function") {
        queueMicrotask(() => callback(value));
      }
      return Promise.resolve(value);
    };

    return {
      QUOTA_BYTES_PER_ITEM: 8192,
      get(keys, callback) {
        const all = readAll();
        let value;
        if (keys == null) {
          value = all;
        } else if (typeof keys === "string") {
          value = { [keys]: all[keys] };
        } else if (Array.isArray(keys)) {
          value = Object.fromEntries(keys.map((key) => [key, all[key]]));
        } else if (typeof keys === "object") {
          value = { ...keys };
          for (const key of Object.keys(keys)) {
            if (Object.prototype.hasOwnProperty.call(all, key)) {
              value[key] = all[key];
            }
          }
        } else {
          value = {};
        }
        return finish(callback, value);
      },
      set(items, callback) {
        for (const [key, value] of Object.entries(items ?? {})) {
          const storageKey = `${prefix}${key}`;
          const serialized = JSON.stringify(value);
          if (serialized === undefined) {
            storageRemove(storageKey);
          } else {
            storageSet(storageKey, serialized);
          }
        }
        return finish(callback);
      },
      remove(keys, callback) {
        for (const key of asArray(keys)) {
          storageRemove(`${prefix}${key}`);
        }
        return finish(callback);
      },
      clear(callback) {
        for (const key of Object.keys(readAll())) {
          storageRemove(`${prefix}${key}`);
        }
        return finish(callback);
      },
      getKeys(callback) {
        return finish(callback, Object.keys(readAll()));
      },
    };
  };

  const unsupported = (message) => ({ ok: false, message });

  const runtime = {
    id: "open-design-preview",
    lastError: undefined,
    onMessage: createEvent(),
    onConnect: createEvent(),
    onInstalled: createEvent(),
    onStartup: createEvent(),
    getURL(path = "") {
      return new URL(path, globalThis.location?.href ?? "http://localhost/").href;
    },
    sendMessage(message, callback) {
      const response = (() => {
        switch (message?.type) {
          case "pageContext.listTabs":
            return { ok: true, tabs: [] };
          case "pageContext.extract":
            return unsupported("Open Design 预览环境无法读取浏览器标签页内容");
          case "networkContext.getSnapshot":
            return unsupported("Open Design 预览环境无法读取 DevTools Network");
          case "networkContext.getDetails":
            return unsupported("Open Design 预览环境无法读取 DevTools Network 详情");
          case "extractionRule.getCurrentTabUrl":
            return { ok: true, url: globalThis.location?.href ?? "" };
          case "tab.captureVisible":
            return unsupported("Open Design 预览环境无法调用扩展截图权限");
          case "modelCatalog.list":
            return { ok: true, models: [] };
          case "modelCatalog.test":
            return unsupported("Open Design 预览环境无法测试扩展后台模型");
          default:
            return unsupported("Open Design 预览环境未连接扩展后台");
        }
      })();

      if (typeof callback === "function") {
        queueMicrotask(() => callback(response));
      }
      return Promise.resolve(response);
    },
    connect() {
      const port = {
        name: "open-design-preview",
        onMessage: createEvent(),
        onDisconnect: createEvent(),
        postMessage(message) {
          queueMicrotask(() => {
            port.onMessage.dispatch({
              type: "error",
              message:
                message?.type === "chat.stream.start"
                  ? "Open Design 预览环境未连接扩展后台，无法发送消息"
                  : "Open Design 预览环境未连接扩展后台",
            });
          });
        },
        disconnect() {
          queueMicrotask(() => port.onDisconnect.dispatch());
        },
      };
      return port;
    },
  };

  const tabs = {
    onActivated: createEvent(),
    onUpdated: createEvent(),
    onRemoved: createEvent(),
    query(_queryInfo, callback) {
      const tabsResult = [];
      if (typeof callback === "function") {
        queueMicrotask(() => callback(tabsResult));
      }
      return Promise.resolve(tabsResult);
    },
    sendMessage(_tabId, _message, callback) {
      const response = unsupported("Open Design 预览环境无法向标签页发送扩展消息");
      if (typeof callback === "function") {
        queueMicrotask(() => callback(response));
      }
      return Promise.resolve(response);
    },
    captureVisibleTab(_windowId, _options, callback) {
      if (typeof callback === "function") queueMicrotask(() => callback(""));
      return Promise.resolve("");
    },
  };

  const windows = {
    WINDOW_ID_NONE: -1,
    onFocusChanged: createEvent(),
    getCurrent(callback) {
      const currentWindow = {
        id: 1,
        focused: true,
        type: "normal",
      };
      if (typeof callback === "function") {
        queueMicrotask(() => callback(currentWindow));
      }
      return Promise.resolve(currentWindow);
    },
  };

  const storage = {
    local: createStorageArea("local"),
    sync: createStorageArea("sync"),
  };

  const permissions = {
    contains(_permissions, callback) {
      if (typeof callback === "function") queueMicrotask(() => callback(false));
      return Promise.resolve(false);
    },
    request(_permissions, callback) {
      if (typeof callback === "function") queueMicrotask(() => callback(false));
      return Promise.resolve(false);
    },
  };

  const scripting = {
    executeScript() {
      return Promise.resolve([]);
    },
  };

  globalThis.chrome = {
    ...(existingChrome ?? {}),
    runtime: { ...(existingChrome?.runtime ?? {}), ...runtime },
    tabs: { ...(existingChrome?.tabs ?? {}), ...tabs },
    windows: { ...(existingChrome?.windows ?? {}), ...windows },
    storage: { ...(existingChrome?.storage ?? {}), ...storage },
    permissions: { ...(existingChrome?.permissions ?? {}), ...permissions },
    scripting: { ...(existingChrome?.scripting ?? {}), ...scripting },
  };
})();
