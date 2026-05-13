import {
  AI_CONFIG_STATES,
  createDefaultAiConfigRuntimeState,
  deriveAiConfigState as deriveNormalizedAiConfigState,
  normalizeAiConfigStateValue,
} from "./ai-config-state.mjs";
import { AI_PROTOCOL_TYPES, detectAiProtocolType } from "./ai-runtime-adapter.mjs";

export const SEARCH_SETTINGS_KEYS = {
  endpoint: "searchApiEndpoint",
  apiKey: "searchApiKey",
  model: "searchApiModel",
  aiSearchEnabled: "aiSearchEnabled",
};

export const SEARCH_RUNTIME_KEYS = {
  protocol: "searchRuntimeProtocol",
  configState: "searchRuntimeConfigState",
  lastTestStatus: "searchRuntimeLastTestStatus",
  lastTestMessage: "searchRuntimeLastTestMessage",
  lastTestAt: "searchRuntimeLastTestAt",
  lastRuntimeErrorMessage: "searchRuntimeLastRuntimeErrorMessage",
  lastRuntimeErrorAt: "searchRuntimeLastRuntimeErrorAt",
};

const DEFAULT_SEARCH_SETTINGS = {
  endpoint: "",
  apiKey: "",
  model: "",
  aiSearchEnabled: false,
};

const DEFAULT_SEARCH_RUNTIME_STATE = createDefaultAiConfigRuntimeState();

const resolveExtensionApi = (overrideApi) => overrideApi ?? (typeof chrome !== "undefined" ? chrome : null);

const normalizeStoredTextValue = (value) => (typeof value === "string" ? value.trim() : "");

const normalizeStoredTestStatus = (value) => {
  const normalized = normalizeStoredTextValue(value).toLowerCase();
  return normalized === "passed" || normalized === "failed" ? normalized : "";
};

const normalizeStoredProtocol = (value, endpoint = "") => {
  const normalizedEndpoint = normalizeStoredTextValue(endpoint);
  if (!normalizedEndpoint) {
    return "";
  }

  const normalized = normalizeStoredTextValue(value);
  const protocolValues = new Set(Object.values(AI_PROTOCOL_TYPES));
  if (protocolValues.has(normalized)) {
    return normalized;
  }

  return detectAiProtocolType(normalizedEndpoint);
};

const readRuntimeStateFromItems = (items, settings = DEFAULT_SEARCH_SETTINGS) => {
  const normalizedSettings = settings && typeof settings === "object" ? { ...settings } : { ...DEFAULT_SEARCH_SETTINGS };
  const storedState = {
    protocol: normalizeStoredProtocol(items?.[SEARCH_RUNTIME_KEYS.protocol], normalizedSettings.endpoint),
    configState: normalizeAiConfigStateValue(items?.[SEARCH_RUNTIME_KEYS.configState]),
    lastTestStatus: normalizeStoredTestStatus(items?.[SEARCH_RUNTIME_KEYS.lastTestStatus]),
    lastTestMessage: normalizeStoredTextValue(items?.[SEARCH_RUNTIME_KEYS.lastTestMessage]),
    lastTestAt: normalizeStoredTextValue(items?.[SEARCH_RUNTIME_KEYS.lastTestAt]),
    lastRuntimeErrorMessage: normalizeStoredTextValue(items?.[SEARCH_RUNTIME_KEYS.lastRuntimeErrorMessage]),
    lastRuntimeErrorAt: normalizeStoredTextValue(items?.[SEARCH_RUNTIME_KEYS.lastRuntimeErrorAt]),
  };
  const configState = deriveNormalizedAiConfigState(normalizedSettings, storedState);

  return {
    ...DEFAULT_SEARCH_RUNTIME_STATE,
    ...storedState,
    protocol: storedState.protocol || detectAiProtocolType(normalizedSettings.endpoint),
    configState,
  };
};

const toStoredRuntimePayload = (runtimeState, settings = DEFAULT_SEARCH_SETTINGS) => {
  const normalizedSettings = settings && typeof settings === "object" ? { ...settings } : { ...DEFAULT_SEARCH_SETTINGS };
  const mergedRuntimeState = runtimeState && typeof runtimeState === "object" ? { ...DEFAULT_SEARCH_RUNTIME_STATE, ...runtimeState } : { ...DEFAULT_SEARCH_RUNTIME_STATE };
  const protocol = normalizeStoredProtocol(mergedRuntimeState.protocol, normalizedSettings.endpoint);
  const normalizedRuntimeState = {
    protocol,
    lastTestStatus: normalizeStoredTestStatus(mergedRuntimeState.lastTestStatus),
    lastTestMessage: normalizeStoredTextValue(mergedRuntimeState.lastTestMessage),
    lastTestAt: normalizeStoredTextValue(mergedRuntimeState.lastTestAt),
    lastRuntimeErrorMessage: normalizeStoredTextValue(mergedRuntimeState.lastRuntimeErrorMessage),
    lastRuntimeErrorAt: normalizeStoredTextValue(mergedRuntimeState.lastRuntimeErrorAt),
  };
  const derivedConfigState = deriveNormalizedAiConfigState(normalizedSettings, normalizedRuntimeState);
  const explicitConfigState = normalizeAiConfigStateValue(mergedRuntimeState.configState);
  const configState = explicitConfigState || derivedConfigState || AI_CONFIG_STATES.UNCONFIGURED;

  return {
    [SEARCH_RUNTIME_KEYS.protocol]: protocol,
    [SEARCH_RUNTIME_KEYS.configState]: configState,
    [SEARCH_RUNTIME_KEYS.lastTestStatus]: normalizedRuntimeState.lastTestStatus,
    [SEARCH_RUNTIME_KEYS.lastTestMessage]: normalizedRuntimeState.lastTestMessage,
    [SEARCH_RUNTIME_KEYS.lastTestAt]: normalizedRuntimeState.lastTestAt,
    [SEARCH_RUNTIME_KEYS.lastRuntimeErrorMessage]: normalizedRuntimeState.lastRuntimeErrorMessage,
    [SEARCH_RUNTIME_KEYS.lastRuntimeErrorAt]: normalizedRuntimeState.lastRuntimeErrorAt,
  };
};

export const isChatCompletionsEndpoint = (endpoint) => {
  if (typeof endpoint !== "string" || !endpoint.trim()) {
    return false;
  }

  try {
    const parsed = new URL(endpoint.trim());
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return pathname === "/" || pathname === "/v1" || /\/v1\/chat\/completions$/i.test(pathname);
  } catch {
    return false;
  }
};

export const resolveChatCompletionsEndpoint = (endpoint) => {
  const parsed = new URL(endpoint.trim());
  const pathname = parsed.pathname.replace(/\/+$/, "") || "/";

  if (/\/v1\/chat\/completions$/i.test(pathname)) {
    parsed.pathname = pathname;
    return parsed.toString();
  }

  if (pathname === "/" || pathname === "/v1") {
    parsed.pathname = "/v1/chat/completions";
    return parsed.toString();
  }

  return parsed.toString();
};

export const resolveOriginPattern = (endpoint) => {
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("搜索接口地址只支持 http 或 https");
  }

  return `${parsed.protocol}//${parsed.host}/*`;
};

export const resolveOriginPatternSafely = (endpoint, invalidMessage) => {
  try {
    return resolveOriginPattern(endpoint);
  } catch {
    throw new Error(invalidMessage);
  }
};

export const getStoredSearchSettings = (extensionApiOverride) =>
  new Promise((resolve, reject) => {
    const extensionApi = resolveExtensionApi(extensionApiOverride);
    if (!extensionApi?.storage?.local) {
      resolve({ ...DEFAULT_SEARCH_SETTINGS });
      return;
    }

    extensionApi.storage.local.get(
      {
        [SEARCH_SETTINGS_KEYS.endpoint]: "",
        [SEARCH_SETTINGS_KEYS.apiKey]: "",
        [SEARCH_SETTINGS_KEYS.model]: "",
        [SEARCH_SETTINGS_KEYS.aiSearchEnabled]: false,
      },
      (items) => {
        if (extensionApi.runtime?.lastError) {
          reject(new Error(extensionApi.runtime.lastError.message));
          return;
        }

        resolve({
          endpoint: typeof items[SEARCH_SETTINGS_KEYS.endpoint] === "string" ? items[SEARCH_SETTINGS_KEYS.endpoint].trim() : "",
          apiKey: typeof items[SEARCH_SETTINGS_KEYS.apiKey] === "string" ? items[SEARCH_SETTINGS_KEYS.apiKey].trim() : "",
          model: typeof items[SEARCH_SETTINGS_KEYS.model] === "string" ? items[SEARCH_SETTINGS_KEYS.model].trim() : "",
          aiSearchEnabled: Boolean(items[SEARCH_SETTINGS_KEYS.aiSearchEnabled]),
        });
      },
    );
  });

export const saveStoredSearchSettings = (settings, extensionApiOverride) =>
  new Promise((resolve, reject) => {
    const extensionApi = resolveExtensionApi(extensionApiOverride);
    if (!extensionApi?.storage?.local) {
      reject(new Error("当前环境不支持扩展存储"));
      return;
    }

    extensionApi.storage.local.set(
      {
        [SEARCH_SETTINGS_KEYS.endpoint]: settings.endpoint,
        [SEARCH_SETTINGS_KEYS.apiKey]: settings.apiKey,
        [SEARCH_SETTINGS_KEYS.model]: settings.model,
        [SEARCH_SETTINGS_KEYS.aiSearchEnabled]: settings.aiSearchEnabled,
      },
      () => {
        if (extensionApi.runtime?.lastError) {
          reject(new Error(extensionApi.runtime.lastError.message));
          return;
        }

        resolve();
      },
    );
  });

export const getStoredAiConfigState = async (extensionApiOverride) => {
  const settings = await getStoredSearchSettings(extensionApiOverride);

  return new Promise((resolve, reject) => {
    const extensionApi = resolveExtensionApi(extensionApiOverride);
    if (!extensionApi?.storage?.local) {
      resolve(readRuntimeStateFromItems({}, settings));
      return;
    }

    extensionApi.storage.local.get(
      {
        [SEARCH_RUNTIME_KEYS.protocol]: DEFAULT_SEARCH_RUNTIME_STATE.protocol,
        [SEARCH_RUNTIME_KEYS.configState]: DEFAULT_SEARCH_RUNTIME_STATE.configState,
        [SEARCH_RUNTIME_KEYS.lastTestStatus]: DEFAULT_SEARCH_RUNTIME_STATE.lastTestStatus,
        [SEARCH_RUNTIME_KEYS.lastTestMessage]: DEFAULT_SEARCH_RUNTIME_STATE.lastTestMessage,
        [SEARCH_RUNTIME_KEYS.lastTestAt]: DEFAULT_SEARCH_RUNTIME_STATE.lastTestAt,
        [SEARCH_RUNTIME_KEYS.lastRuntimeErrorMessage]: DEFAULT_SEARCH_RUNTIME_STATE.lastRuntimeErrorMessage,
        [SEARCH_RUNTIME_KEYS.lastRuntimeErrorAt]: DEFAULT_SEARCH_RUNTIME_STATE.lastRuntimeErrorAt,
      },
      (items) => {
        if (extensionApi.runtime?.lastError) {
          reject(new Error(extensionApi.runtime.lastError.message));
          return;
        }

        resolve(readRuntimeStateFromItems(items, settings));
      },
    );
  });
};

export const saveStoredAiConfigState = async (nextState, extensionApiOverride) => {
  const extensionApi = resolveExtensionApi(extensionApiOverride);
  if (!extensionApi?.storage?.local) {
    throw new Error("当前环境不支持扩展存储");
  }

  const settings = await getStoredSearchSettings(extensionApi);
  const payload = toStoredRuntimePayload(nextState, settings);

  return new Promise((resolve, reject) => {
    extensionApi.storage.local.set(payload, () => {
      if (extensionApi.runtime?.lastError) {
        reject(new Error(extensionApi.runtime.lastError.message));
        return;
      }

      resolve(readRuntimeStateFromItems(payload, settings));
    });
  });
};

export const deriveAiConfigState = (settings, runtimeState) => deriveNormalizedAiConfigState(settings, runtimeState);

export const markAiRuntimeDegraded = async (message, extensionApiOverride) => {
  const normalizedMessage = normalizeStoredTextValue(message);
  if (!normalizedMessage) {
    return getStoredAiConfigState(extensionApiOverride);
  }

  const currentRuntimeState = await getStoredAiConfigState(extensionApiOverride);
  const currentConfigState = currentRuntimeState?.configState || AI_CONFIG_STATES.UNCONFIGURED;
  const canPersistDegradedState = currentConfigState === AI_CONFIG_STATES.VALID || currentConfigState === AI_CONFIG_STATES.DEGRADED;

  if (!canPersistDegradedState) {
    return currentRuntimeState;
  }

  return saveStoredAiConfigState({
    protocol: currentRuntimeState.protocol,
    configState: AI_CONFIG_STATES.DEGRADED,
    lastTestStatus: currentRuntimeState.lastTestStatus,
    lastTestMessage: currentRuntimeState.lastTestMessage,
    lastTestAt: currentRuntimeState.lastTestAt,
    lastRuntimeErrorMessage: normalizedMessage,
    lastRuntimeErrorAt: new Date().toISOString(),
  }, extensionApiOverride);
};

export const fetchWithTimeout = async (url, options = {}, timeoutMessage, timeoutMs = 10000) => {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(timeoutMessage);
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
};

const hasOriginPermission = (originPattern, extensionApiOverride) =>
  new Promise((resolve, reject) => {
    const extensionApi = resolveExtensionApi(extensionApiOverride);
    if (!extensionApi?.permissions?.contains) {
      resolve(false);
      return;
    }

    extensionApi.permissions.contains({ origins: [originPattern] }, (granted) => {
      if (extensionApi.runtime?.lastError) {
        reject(new Error(extensionApi.runtime.lastError.message));
        return;
      }

      resolve(Boolean(granted));
    });
  });

const requestOriginPermission = (originPattern, extensionApiOverride) =>
  new Promise((resolve, reject) => {
    const extensionApi = resolveExtensionApi(extensionApiOverride);
    if (!extensionApi?.permissions?.request) {
      resolve(true);
      return;
    }

    extensionApi.permissions.request({ origins: [originPattern] }, (granted) => {
      if (extensionApi.runtime?.lastError) {
        reject(new Error(extensionApi.runtime.lastError.message));
        return;
      }

      resolve(granted);
    });
  });

export const ensureOriginPermission = async (originPattern, deniedMessage, extensionApiOverride) => {
  const extensionApi = resolveExtensionApi(extensionApiOverride);
  if (!extensionApi?.permissions?.request) {
    return;
  }

  const alreadyGranted = await hasOriginPermission(originPattern, extensionApi);
  if (alreadyGranted) {
    return;
  }

  const granted = await requestOriginPermission(originPattern, extensionApi);
  if (!granted) {
    throw new Error(deniedMessage);
  }
};

const ALL_STORAGE_KEYS = new Set([
  ...Object.values(SEARCH_SETTINGS_KEYS),
  ...Object.values(SEARCH_RUNTIME_KEYS),
]);

export const createCachedSettingsReader = (extensionApiOverride) => {
  const extensionApi = resolveExtensionApi(extensionApiOverride);

  let cachedSettings = null;
  let cachedConfigState = null;
  let settingsPromise = null;
  let configStatePromise = null;
  let cacheGeneration = 0;

  const invalidate = () => {
    cacheGeneration += 1;
    cachedSettings = null;
    cachedConfigState = null;
    settingsPromise = null;
    configStatePromise = null;
  };

  if (extensionApi?.storage?.onChanged) {
    extensionApi.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") {
        return;
      }

      const changedKeys = Object.keys(changes);
      if (changedKeys.some((key) => ALL_STORAGE_KEYS.has(key))) {
        invalidate();
      }
    });
  }

  const getSettings = async () => {
    if (cachedSettings) {
      return cachedSettings;
    }

    if (!settingsPromise) {
      const requestGeneration = cacheGeneration;
      settingsPromise = getStoredSearchSettings(extensionApi)
        .then((result) => {
          if (requestGeneration === cacheGeneration) {
            cachedSettings = result;
          }
          return result;
        })
        .finally(() => {
          if (requestGeneration === cacheGeneration) {
            settingsPromise = null;
          }
        });
    }

    return settingsPromise;
  };

  const getConfigState = async () => {
    if (cachedConfigState) {
      return cachedConfigState;
    }

    if (!configStatePromise) {
      const requestGeneration = cacheGeneration;
      configStatePromise = getStoredAiConfigState(extensionApi)
        .then((result) => {
          if (requestGeneration === cacheGeneration) {
            cachedConfigState = result;
          }
          return result;
        })
        .finally(() => {
          if (requestGeneration === cacheGeneration) {
            configStatePromise = null;
          }
        });
    }

    return configStatePromise;
  };

  return { getSettings, getConfigState, invalidate };
};
