import {
  AI_REFUSAL_PATTERN,
  buildDecisionUserPrompt,
  isLikelySearchQueryText,
  looksLikeGatewayErrorPage,
  looksLikeHtmlDocument,
  parseJsonSafely,
  unwrapJsonFence,
} from "../../../shared/search-ai-contract.mjs";

const openSettingsButton = document.getElementById("open-settings");
const closeSettingsButton = document.getElementById("close-settings");
const settingsBackdrop = document.getElementById("settings-backdrop");
const settingsPopup = document.getElementById("settings-popup");
const settingsScrollArea = document.querySelector(".settings-scroll-area");
const settingsForm = document.getElementById("settings-form");
const searchApiEndpointInput = document.getElementById("search-api-endpoint");
const searchApiKeyInput = document.getElementById("search-api-key");
const searchApiModelInput = document.getElementById("search-api-model");
const fetchModelsButton = document.getElementById("fetch-models");
const searchApiModelSelect = document.getElementById("search-api-model-select");
const aiSearchEnabledInput = document.getElementById("ai-search-enabled");
const settingsStatus = document.getElementById("settings-status");
const saveSettingsButton = document.getElementById("save-settings");
const homepageSearchInput = document.getElementById("search-input");

const SEARCH_SETTINGS_KEYS = {
  endpoint: "searchApiEndpoint",
  apiKey: "searchApiKey",
  model: "searchApiModel",
  aiSearchEnabled: "aiSearchEnabled",
};

const extensionApi = typeof chrome !== "undefined" ? chrome : null;
let lockedBodyScrollY = 0;
let lastFocusedElement = null;
const TEMPORARY_FAILURE_STATUSES = new Set([429, 500, 502, 503, 504]);
const SETTINGS_REQUEST_TIMEOUT = 10000;
const SETTINGS_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

const isSettingsPopupOpen = () => document.body.classList.contains("is-settings-open");

const setPopupInertState = (inert) => {
  if (!(settingsPopup instanceof HTMLElement)) {
    return;
  }

  if ("inert" in settingsPopup) {
    settingsPopup.inert = inert;
    return;
  }

  settingsPopup.toggleAttribute("inert", inert);
};

const getSettingsPopupFocusableElements = () => {
  if (!(settingsPopup instanceof HTMLElement)) {
    return [];
  }

  return Array.from(settingsPopup.querySelectorAll(SETTINGS_FOCUSABLE_SELECTOR)).filter((element) => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    if (element.hidden || element.closest("[hidden]")) {
      return false;
    }

    if (element.closest("[inert]")) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }

    return element.tabIndex >= 0;
  });
};

const trapSettingsPopupFocus = (event) => {
  if (!isSettingsPopupOpen() || event.key !== "Tab" || !(settingsPopup instanceof HTMLElement)) {
    return;
  }

  const focusableElements = getSettingsPopupFocusableElements();
  if (!focusableElements.length) {
    event.preventDefault();
    settingsPopup.focus({ preventScroll: true });
    return;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];
  const activeElement = document.activeElement;
  const isFocusInsidePopup = activeElement instanceof Node && settingsPopup.contains(activeElement);

  if (event.shiftKey) {
    if (!isFocusInsidePopup || activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus({ preventScroll: true });
    }
    return;
  }

  if (!isFocusInsidePopup || activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus({ preventScroll: true });
  }
};

const setSettingsStatus = (message, tone = "neutral") => {
  if (!(settingsStatus instanceof HTMLElement)) {
    return;
  }

  settingsStatus.textContent = message;
  settingsStatus.dataset.tone = tone;
  settingsStatus.hidden = !message;
};

const setSettingsSaving = (saving) => {
  if (saveSettingsButton instanceof HTMLButtonElement) {
    saveSettingsButton.disabled = saving;
  }
};

const setFetchModelsPending = (pending) => {
  if (fetchModelsButton instanceof HTMLButtonElement) {
    fetchModelsButton.disabled = pending;
  }
};

const resolveValidationText = (rawText) => {
  const trimmed = rawText.trim();
  const payload = parseJsonSafely(trimmed);
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.choices)) {
      const firstChoice = payload.choices[0];
      const content = firstChoice && typeof firstChoice === "object" && firstChoice.message && typeof firstChoice.message === "object"
        ? firstChoice.message.content
        : "";
      if (typeof content === "string") {
        return unwrapJsonFence(content.trim());
      }
    }

    if (typeof payload.query === "string") {
      return payload.query.trim();
    }

    if (typeof payload.url === "string") {
      return payload.url.trim();
    }
  }

  return unwrapJsonFence(trimmed);
};

const hasUsableDecisionPayload = (value) => {
  const parsedPayload = parseJsonSafely(value);
  if (!parsedPayload || typeof parsedPayload !== "object") {
    return false;
  }

  const payload = parsedPayload.result && typeof parsedPayload.result === "object" ? parsedPayload.result : parsedPayload;
  const mode = typeof payload.mode === "string" ? payload.mode.trim().toLowerCase() : "";
  const urlValue = typeof payload.url === "string" && payload.url.trim()
    ? payload.url.trim()
    : typeof payload.target === "string" && payload.target.trim()
      ? payload.target.trim()
      : "";

  if (["open", "url", "navigate"].includes(mode) && urlValue) {
    return true;
  }

  const queryValue = typeof payload.query === "string" && payload.query.trim()
    ? payload.query.trim()
    : typeof payload.rewritten_query === "string" && payload.rewritten_query.trim()
      ? payload.rewritten_query.trim()
    : typeof payload.target === "string" && payload.target.trim()
      ? payload.target.trim()
      : "";

  if (["search", "query"].includes(mode) && queryValue) {
    return true;
  }

  return Boolean(queryValue || urlValue);
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

export const getStoredSearchSettings = () =>
  new Promise((resolve, reject) => {
    if (!extensionApi?.storage?.local) {
      resolve({ endpoint: "", apiKey: "", model: "", aiSearchEnabled: false });
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

const saveStoredSearchSettings = (settings) =>
  new Promise((resolve, reject) => {
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

const fillSettingsForm = (settings) => {
  if (searchApiEndpointInput instanceof HTMLInputElement) {
    searchApiEndpointInput.value = settings.endpoint;
  }

  if (searchApiKeyInput instanceof HTMLInputElement) {
    searchApiKeyInput.value = settings.apiKey;
  }

  if (searchApiModelInput instanceof HTMLInputElement) {
    searchApiModelInput.value = settings.model;
  }

  if (searchApiModelSelect instanceof HTMLSelectElement) {
    searchApiModelSelect.value = "";
  }
};

const readDraftSearchSettings = () => ({
  endpoint: searchApiEndpointInput instanceof HTMLInputElement ? searchApiEndpointInput.value.trim() : "",
  apiKey: searchApiKeyInput instanceof HTMLInputElement ? searchApiKeyInput.value.trim() : "",
  model: searchApiModelInput instanceof HTMLInputElement ? searchApiModelInput.value.trim() : "",
});

const hasUnsavedAiConfigDraft = (storedSettings) => {
  if (!isSettingsPopupOpen()) {
    return false;
  }

  const draftSettings = readDraftSearchSettings();
  return draftSettings.endpoint !== storedSettings.endpoint
    || draftSettings.apiKey !== storedSettings.apiKey
    || draftSettings.model !== storedSettings.model;
};

const populateModelOptions = (models, selectedModel = "") => {
  if (!(searchApiModelSelect instanceof HTMLSelectElement)) {
    return;
  }

  searchApiModelSelect.innerHTML = "";

  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.textContent = models.length ? "选择模型后自动填入" : "未获取到模型";
  searchApiModelSelect.appendChild(placeholderOption);

  models.forEach((modelId) => {
    const option = document.createElement("option");
    option.value = modelId;
    option.textContent = modelId;
    searchApiModelSelect.appendChild(option);
  });

  searchApiModelSelect.value = selectedModel && models.includes(selectedModel) ? selectedModel : "";
};

const syncHomepageAiToggle = (settings) => {
  if (aiSearchEnabledInput instanceof HTMLInputElement) {
    aiSearchEnabledInput.checked = settings.aiSearchEnabled;
  }
};

const setAiSearchFeedback = (setSearchStatus, message, tone = "neutral") => {
  if (isSettingsPopupOpen()) {
    setSettingsStatus(message, tone);
    if (typeof setSearchStatus === "function") {
      setSearchStatus("", "neutral");
    }
    return;
  }

  setSettingsStatus("", "neutral");
  if (typeof setSearchStatus === "function") {
    setSearchStatus(message, tone);
  }
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

const fetchWithTimeout = async (url, options, timeoutMessage) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), SETTINGS_REQUEST_TIMEOUT);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(timeoutMessage);
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const hasOriginPermission = (originPattern) =>
  new Promise((resolve, reject) => {
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

const requestOriginPermission = (originPattern) =>
  new Promise((resolve, reject) => {
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

export const ensureOriginPermission = async (originPattern, deniedMessage) => {
  if (!extensionApi?.permissions?.request) {
    return;
  }

  const alreadyGranted = await hasOriginPermission(originPattern);
  if (alreadyGranted) {
    return;
  }

  const granted = await requestOriginPermission(originPattern);
  if (!granted) {
    throw new Error(deniedMessage);
  }
};

const normalizeResponseError = (status, rawText) => {
  const payload = parseJsonSafely(rawText);
  const errorMessage = payload && typeof payload === "object"
    ? payload.error?.message ?? payload.message ?? ""
    : "";
  const preview = (errorMessage || rawText || "").trim();

  if (status >= 500 && looksLikeHtmlDocument(preview)) {
    return `搜索接口上游暂时不可用（${status}）：${looksLikeGatewayErrorPage(preview) ? "网关返回了错误页面" : "服务端返回了 HTML 错误页"}`;
  }

  if (looksLikeHtmlDocument(preview)) {
    return "搜索接口返回了 HTML 页面，请确认填写的是 API 接口地址，而不是站点首页或后台页面。";
  }

  if (status === 403 && /1010/.test(preview)) {
    return "搜索接口被服务端拦截（403 / error code: 1010），请检查该域名是否禁止扩展或脚本请求。";
  }

  if (TEMPORARY_FAILURE_STATUSES.has(status) || /\b429\b/.test(preview) || /upstream_error/i.test(preview)) {
    return `搜索接口上游暂时不可用（${status}）：${preview.slice(0, 200) || "请稍后重试"}`;
  }

  if (preview) {
    return `搜索接口请求失败（${status}）：${preview.slice(0, 200)}`;
  }

  return `搜索接口请求失败（${status}）`;
};

const validateAiEndpoint = async ({ endpoint, apiKey, model }) => {
  if (!isChatCompletionsEndpoint(endpoint)) {
    return;
  }

  const chatEndpoint = resolveChatCompletionsEndpoint(endpoint);

  const headers = {
    "Content-Type": "application/json",
    Accept: "*/*",
    "X-Title": "Moon Tab",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const requestBody = {
    model,
    messages: [
      { role: "user", content: buildDecisionUserPrompt("validation check") },
    ],
    temperature: 0,
    stream: false,
  };

  const response = await fetchWithTimeout(chatEndpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  }, "搜索接口校验超时，请稍后重试。");
  const rawText = await response.text();

  if (response.ok) {
    if (!rawText.trim()) {
      throw new Error("搜索接口返回为空，无法启用 AI 搜索增强。");
    }

    if (looksLikeHtmlDocument(rawText)) {
      throw new Error("搜索接口返回了 HTML 页面，请确认填写的是 API 接口地址，而不是站点首页或后台页面。");
    }

    const validationText = resolveValidationText(rawText);
    if (hasUsableDecisionPayload(validationText)) {
      return { temporaryWarning: "" };
    }

    if (AI_REFUSAL_PATTERN.test(validationText) || !isLikelySearchQueryText(validationText)) {
      throw new Error("搜索接口返回了说明性文本，未形成可用的搜索决策。请更换模型或稍后重试。");
    }

    return { temporaryWarning: "" };
  }

  const normalizedMessage = normalizeResponseError(response.status, rawText);
  if (TEMPORARY_FAILURE_STATUSES.has(response.status) || /\b429\b/.test(normalizedMessage) || /上游暂时不可用/.test(normalizedMessage)) {
    return { temporaryWarning: normalizedMessage };
  }

  throw new Error(normalizedMessage);
};

const resolveModelsEndpoint = (endpoint) => {
  if (!endpoint) {
    throw new Error("请先填写搜索接口地址。");
  }

  const parsed = new URL(endpoint);
  const pathname = parsed.pathname.replace(/\/+$/, "") || "/";

  if (/\/v1\/chat\/completions$/i.test(pathname)) {
    parsed.pathname = "/v1/models";
    return parsed.toString();
  }

  if (pathname === "/" || pathname === "/v1") {
    parsed.pathname = "/v1/models";
    return parsed.toString();
  }

  return `${parsed.origin}/v1/models`;
};

const fetchAvailableModels = async () => {
  if (!(searchApiEndpointInput instanceof HTMLInputElement) || !(searchApiKeyInput instanceof HTMLInputElement)) {
    return;
  }

  const endpoint = searchApiEndpointInput.value.trim();
  const apiKey = searchApiKeyInput.value.trim();

  let modelsEndpoint = "";
  try {
    modelsEndpoint = resolveModelsEndpoint(endpoint);
  } catch (error) {
    setSettingsStatus(error instanceof Error ? error.message : "模型接口地址不正确", "error");
    return;
  }

  try {
    const originPattern = resolveOriginPatternSafely(endpoint, "模型接口地址不正确，请重新填写。");
    await ensureOriginPermission(originPattern, "未授予该接口域名权限，无法获取模型列表。");
  } catch (error) {
    setSettingsStatus(error instanceof Error ? error.message : "模型权限申请失败", "error");
    return;
  }

  setFetchModelsPending(true);
  setSettingsStatus("正在获取模型列表…", "neutral");

  try {
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    headers.Accept = "*/*";
    headers["X-Title"] = "Moon Tab";
    const response = await fetchWithTimeout(modelsEndpoint, { headers }, "模型列表请求超时，请稍后重试。");
    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(rawText || `模型列表请求失败（${response.status}）`);
    }

    let payload = {};
    if (rawText) {
      try {
        payload = JSON.parse(rawText);
      } catch {
        throw new Error("模型列表返回不是有效 JSON");
      }
    }

    const models = Array.isArray(payload.data)
      ? payload.data
          .map((item) => (item && typeof item === "object" && typeof item.id === "string" ? item.id.trim() : ""))
          .filter(Boolean)
      : [];

    populateModelOptions(models, searchApiModelInput instanceof HTMLInputElement ? searchApiModelInput.value.trim() : "");

    if (!models.length) {
      throw new Error("模型列表为空");
    }

    setSettingsStatus("模型列表获取完成，请选择模型。", "neutral");
  } catch (error) {
    populateModelOptions([]);
    setSettingsStatus(error instanceof Error ? error.message : "获取模型失败", "error");
  } finally {
    setFetchModelsPending(false);
  }
};

const setSettingsPopupOpen = (open) => {
  if (!(settingsPopup instanceof HTMLElement)) {
    return;
  }

  if (open) {
    const activeElement = document.activeElement;
    lastFocusedElement = activeElement instanceof HTMLElement ? activeElement : null;
    lockedBodyScrollY = typeof window.scrollY === "number" ? window.scrollY : 0;
    document.body.style.position = "fixed";
    document.body.style.top = `-${lockedBodyScrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    if (settingsScrollArea instanceof HTMLElement) {
      settingsScrollArea.scrollTop = 0;
    }
  } else {
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    if (typeof window.scrollTo === "function") {
      window.scrollTo(0, lockedBodyScrollY);
    }
  }

  document.body.classList.toggle("is-settings-open", open);
  settingsPopup.setAttribute("aria-hidden", open ? "false" : "true");
  setPopupInertState(!open);
  if (settingsBackdrop instanceof HTMLElement) {
    settingsBackdrop.setAttribute("aria-hidden", open ? "false" : "true");
  }

  if (open) {
    window.setTimeout(() => {
      if (searchApiEndpointInput instanceof HTMLInputElement) {
        searchApiEndpointInput.focus();
      }
    }, 20);
    return;
  }

  const fallbackFocusTarget = homepageSearchInput instanceof HTMLInputElement ? homepageSearchInput : null;
  const nextFocusTarget = lastFocusedElement instanceof HTMLElement && document.contains(lastFocusedElement)
    ? lastFocusedElement
    : fallbackFocusTarget;
  lastFocusedElement = null;

  if (nextFocusTarget instanceof HTMLElement) {
    window.requestAnimationFrame(() => {
      nextFocusTarget.focus({ preventScroll: true });
    });
  }
};

const openSettingsPopup = async () => {
  setSettingsStatus("", "neutral");

  try {
    const settings = await getStoredSearchSettings();
    fillSettingsForm(settings);
    syncHomepageAiToggle(settings);
  } catch (error) {
    setSettingsStatus(error instanceof Error ? error.message : "读取设置失败", "error");
  }

  setSettingsPopupOpen(true);
};

const closeSettingsPopup = () => {
  setSettingsPopupOpen(false);
};

const hydrateHomepageSettings = async (syncAiSearchEnabled) => {
  try {
    const settings = await getStoredSearchSettings();
    fillSettingsForm(settings);
    syncHomepageAiToggle(settings);
    if (typeof syncAiSearchEnabled === "function") {
      syncAiSearchEnabled(settings.aiSearchEnabled);
    }
  } catch {
  }
};

export const initializeSettingsUi = ({ setSearchStatus, syncAiSearchEnabled, syncAiSearchActivating }) => {
  if (openSettingsButton instanceof HTMLButtonElement) {
    openSettingsButton.addEventListener("click", () => {
      openSettingsPopup();
    });
  }

  if (closeSettingsButton instanceof HTMLButtonElement) {
    closeSettingsButton.addEventListener("click", () => {
      closeSettingsPopup();
    });
  }

  if (settingsBackdrop instanceof HTMLElement) {
    settingsBackdrop.addEventListener("click", () => {
      closeSettingsPopup();
    });
  }

  if (fetchModelsButton instanceof HTMLButtonElement) {
    fetchModelsButton.addEventListener("click", () => {
      fetchAvailableModels();
    });
  }

  if (searchApiModelSelect instanceof HTMLSelectElement && searchApiModelInput instanceof HTMLInputElement) {
    searchApiModelSelect.addEventListener("change", () => {
      if (searchApiModelSelect.value) {
        searchApiModelInput.value = searchApiModelSelect.value;
      }
    });
  }

  if (
    settingsForm instanceof HTMLFormElement
    && searchApiEndpointInput instanceof HTMLInputElement
    && searchApiKeyInput instanceof HTMLInputElement
    && searchApiModelInput instanceof HTMLInputElement
  ) {
    settingsForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const endpoint = searchApiEndpointInput.value.trim();
      const apiKey = searchApiKeyInput.value.trim();
      const model = searchApiModelInput.value.trim();

      if (endpoint) {
        try {
          resolveOriginPattern(endpoint);
        } catch (error) {
          setSettingsStatus(error instanceof Error ? error.message : "搜索接口地址不正确", "error");
          searchApiEndpointInput.focus();
          return;
        }
      }

      if (isChatCompletionsEndpoint(endpoint) && !model) {
        setSettingsStatus("chat/completions 接口需要填写模型名称。", "error");
        searchApiModelInput.focus();
        return;
      }

      setSettingsSaving(true);
      setSettingsStatus("正在保存设置…", "neutral");

      try {
        await saveStoredSearchSettings({
          endpoint,
          apiKey,
          model,
          aiSearchEnabled: aiSearchEnabledInput instanceof HTMLInputElement ? aiSearchEnabledInput.checked : false,
        });
        if (typeof syncAiSearchEnabled === "function" && aiSearchEnabledInput instanceof HTMLInputElement) {
          syncAiSearchEnabled(aiSearchEnabledInput.checked);
        }

        const willValidateLazily = Boolean(endpoint);
        setSettingsStatus(
          willValidateLazily ? "设置已保存。联网校验会在启用或使用 AI 搜索时进行。" : "设置已保存。",
          "neutral",
        );
      } catch (error) {
        setSettingsStatus(error instanceof Error ? error.message : "保存设置失败", "error");
      } finally {
        setSettingsSaving(false);
      }
    });
  }

  if (aiSearchEnabledInput instanceof HTMLInputElement) {
    aiSearchEnabledInput.addEventListener("change", async () => {
      const activationStarted = aiSearchEnabledInput.checked && typeof syncAiSearchActivating === "function";
      if (activationStarted) {
        syncAiSearchActivating(true);
      } else if (typeof syncAiSearchActivating === "function") {
        syncAiSearchActivating(false);
      }

      try {
        const currentSettings = await getStoredSearchSettings();
        if (aiSearchEnabledInput.checked && hasUnsavedAiConfigDraft(currentSettings)) {
          setAiSearchFeedback(setSearchStatus, "当前有未保存的接口配置，请先保存设置，再开启 AI 搜索增强。", "error");
          aiSearchEnabledInput.checked = false;
          if (typeof syncAiSearchEnabled === "function") {
            syncAiSearchEnabled(false);
          }
          return;
        }

        if (aiSearchEnabledInput.checked && !currentSettings.endpoint) {
          setAiSearchFeedback(setSearchStatus, "请先在设置里填写搜索接口地址，再开启 AI 搜索增强。", "error");
          aiSearchEnabledInput.checked = false;
          if (typeof syncAiSearchEnabled === "function") {
            syncAiSearchEnabled(false);
          }
          return;
        }

        if (aiSearchEnabledInput.checked && isChatCompletionsEndpoint(currentSettings.endpoint) && !currentSettings.model) {
          setAiSearchFeedback(setSearchStatus, "chat/completions 接口需要先在设置里填写模型名称。", "error");
          aiSearchEnabledInput.checked = false;
          if (typeof syncAiSearchEnabled === "function") {
            syncAiSearchEnabled(false);
          }
          return;
        }

        let validationResult = null;
        if (aiSearchEnabledInput.checked) {
          const originPattern = resolveOriginPatternSafely(currentSettings.endpoint, "搜索接口地址无效，请重新在设置里填写。");
          await ensureOriginPermission(originPattern, "未授予该搜索接口域名权限，无法启用 AI 搜索增强。");
          validationResult = await validateAiEndpoint({
            endpoint: currentSettings.endpoint,
            apiKey: currentSettings.apiKey,
            model: currentSettings.model,
          });
        }

        await saveStoredSearchSettings({
          endpoint: currentSettings.endpoint,
          apiKey: currentSettings.apiKey,
          model: currentSettings.model,
          aiSearchEnabled: aiSearchEnabledInput.checked,
        });
        if (typeof syncAiSearchEnabled === "function") {
          syncAiSearchEnabled(aiSearchEnabledInput.checked);
        }

        if (validationResult?.temporaryWarning) {
          setAiSearchFeedback(setSearchStatus, `AI 搜索增强已开启，但 ${validationResult.temporaryWarning}`, "neutral");
        } else {
          setAiSearchFeedback(setSearchStatus, "", "neutral");
        }
      } catch (error) {
        setAiSearchFeedback(setSearchStatus, error instanceof Error ? error.message : "保存 AI 开关失败", "error");
        aiSearchEnabledInput.checked = !aiSearchEnabledInput.checked;
        if (typeof syncAiSearchEnabled === "function") {
          syncAiSearchEnabled(aiSearchEnabledInput.checked);
        }
      } finally {
        if (activationStarted && typeof syncAiSearchActivating === "function") {
          syncAiSearchActivating(false);
        }
      }
    });
  }

  hydrateHomepageSettings(syncAiSearchEnabled);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("is-settings-open")) {
      closeSettingsPopup();
      return;
    }

    trapSettingsPopupFocus(event);
  });
};
