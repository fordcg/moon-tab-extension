import {
  AI_PROTOCOL_TYPES,
  buildAiTestRequest,
  normalizeAiRuntimeError,
  parseAiRuntimeResponse,
} from "../../../shared/ai-runtime-adapter.mjs";
import { AI_CONFIG_STATES } from "../../../shared/ai-config-state.mjs";
import {
  ensureOriginPermission,
  fetchWithTimeout,
  getStoredAiConfigState,
  getStoredSearchSettings,
  resolveOriginPattern,
  resolveOriginPatternSafely,
  saveStoredAiConfigState,
  saveStoredSearchSettings,
} from "../../../shared/search-settings.mjs";

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
const testSearchApiConnectionButton = document.getElementById("test-search-api-connection");
const aiConfigStateCard = document.getElementById("ai-config-state-card");
const aiConfigStateLabel = document.getElementById("ai-config-state-label");
const aiConfigStateMessage = document.getElementById("ai-config-state-message");
const homepageSearchInput = document.getElementById("search-input");

let lockedBodyScrollY = 0;
let lastFocusedElement = null;
const SETTINGS_REQUEST_TIMEOUT = 10000;
const AI_USABLE_STATES = new Set([AI_CONFIG_STATES.VALID, AI_CONFIG_STATES.DEGRADED]);
const SETTINGS_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");
const AI_STATE_COPY = {
  [AI_CONFIG_STATES.UNCONFIGURED]: {
    label: "未配置",
    message: "请先完整填写接口地址、API Key 和模型，然后保存设置。",
  },
  [AI_CONFIG_STATES.CONFIGURED]: {
    label: "已保存，待测试",
    message: "配置已保存，请点击“测试连接”验证接口是否可用。",
  },
  [AI_CONFIG_STATES.VALID]: {
    label: "连接正常",
    message: "最近一次测试通过，可以启用 AI 搜索增强。",
  },
  [AI_CONFIG_STATES.INVALID]: {
    label: "连接失败",
    message: "最近一次测试失败，请检查配置后重新测试。",
  },
  [AI_CONFIG_STATES.DEGRADED]: {
    label: "运行中降级",
    message: "最近一次运行发生错误，请重新测试连接。",
  },
};

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

const setSettingsTesting = (testing) => {
  if (testSearchApiConnectionButton instanceof HTMLButtonElement) {
    testSearchApiConnectionButton.disabled = testing;
  }
};

const setFetchModelsPending = (pending) => {
  if (fetchModelsButton instanceof HTMLButtonElement) {
    fetchModelsButton.disabled = pending;
  }
};

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

const getAiStatePresentation = (runtimeState = {}) => {
  const configState = typeof runtimeState.configState === "string" && runtimeState.configState
    ? runtimeState.configState
    : AI_CONFIG_STATES.UNCONFIGURED;
  const copy = AI_STATE_COPY[configState] ?? AI_STATE_COPY[AI_CONFIG_STATES.UNCONFIGURED];
  const detailMessage = configState === AI_CONFIG_STATES.DEGRADED
    ? runtimeState.lastRuntimeErrorMessage
    : runtimeState.lastTestMessage;
  const detailTimestamp = configState === AI_CONFIG_STATES.DEGRADED
    ? runtimeState.lastRuntimeErrorAt
    : runtimeState.lastTestAt;
  const normalizedDetailTimestamp = typeof detailTimestamp === "string" ? detailTimestamp.trim() : "";
  const detailSuffix = normalizedDetailTimestamp ? ` 最近一次记录时间：${normalizedDetailTimestamp}` : "";

  return {
    configState,
    label: copy.label,
    message: typeof detailMessage === "string" && detailMessage.trim()
      ? `${detailMessage.trim()}${detailSuffix}`
      : copy.message,
  };
};

const renderAiConfigState = (runtimeState = {}, syncAiConfigState) => {
  const presentation = getAiStatePresentation(runtimeState);

  if (aiConfigStateCard instanceof HTMLElement) {
    aiConfigStateCard.dataset.state = presentation.configState;
  }

  if (aiConfigStateLabel instanceof HTMLElement) {
    aiConfigStateLabel.textContent = presentation.label;
  }

  if (aiConfigStateMessage instanceof HTMLElement) {
    aiConfigStateMessage.textContent = presentation.message;
  }

  if (typeof syncAiConfigState === "function") {
    syncAiConfigState(presentation.configState, runtimeState);
  }
};

const isAiConfigUsable = (runtimeState = {}) => AI_USABLE_STATES.has(runtimeState.configState);

const syncHomepageAiAvailability = (settings, runtimeState, syncAiSearchEnabled, syncAiConfigState) => {
  renderAiConfigState(runtimeState, syncAiConfigState);

  if (typeof syncAiSearchEnabled === "function") {
    syncAiSearchEnabled(Boolean(settings.aiSearchEnabled) && isAiConfigUsable(runtimeState));
  }
};

const readStoredSettingsSnapshot = async () => {
  const [settings, runtimeState] = await Promise.all([
    getStoredSearchSettings(),
    getStoredAiConfigState(),
  ]);

  return { settings, runtimeState };
};

const persistRuntimeStateAfterSave = async () => saveStoredAiConfigState({
  protocol: "",
  configState: "",
  lastTestStatus: "",
  lastTestMessage: "",
  lastTestAt: "",
  lastRuntimeErrorMessage: "",
  lastRuntimeErrorAt: "",
});

const persistRuntimeTestResult = async ({
  protocolType,
  status,
  message,
}) => saveStoredAiConfigState({
  protocol: protocolType,
  configState: "",
  lastTestStatus: status,
  lastTestMessage: message,
  lastTestAt: new Date().toISOString(),
  lastRuntimeErrorMessage: "",
  lastRuntimeErrorAt: "",
});

const resolveSavedAiSettings = async () => {
  const { settings, runtimeState } = await readStoredSettingsSnapshot();

  if (hasUnsavedAiConfigDraft(settings)) {
    throw new Error("当前有未保存的接口配置，请先保存设置，再测试连接。", { cause: runtimeState });
  }

  return { settings, runtimeState };
};

const requireValidEndpointDraft = (endpoint) => {
  if (!endpoint) {
    return;
  }

  try {
    resolveOriginPattern(endpoint);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "搜索接口地址不正确");
  }
};

const runAiConnectionTest = async (settings) => {
  const testRequest = buildAiTestRequest(settings);
  if (!testRequest.ok) {
    throw Object.assign(new Error(testRequest.message), {
      aiProtocolType: testRequest.protocolType,
    });
  }

  const originPattern = resolveOriginPatternSafely(testRequest.endpoint, "搜索接口地址无效，请重新填写。");
  await ensureOriginPermission(originPattern, "未授予该搜索接口域名权限，无法测试连接。");

  const response = await fetchWithTimeout(
    testRequest.endpoint,
    {
      method: "POST",
      headers: testRequest.headers,
      body: JSON.stringify(testRequest.body),
    },
    "测试连接超时，请稍后重试。",
    SETTINGS_REQUEST_TIMEOUT,
  );
  const rawText = await response.text();

  if (!response.ok) {
    const runtimeError = normalizeAiRuntimeError(response.status, rawText);
    throw Object.assign(new Error(runtimeError.message), {
      aiProtocolType: testRequest.protocolType,
    });
  }

  const parsedResponse = parseAiRuntimeResponse(testRequest.protocolType, rawText);
  if (!parsedResponse.ok) {
    throw Object.assign(new Error(parsedResponse.message), {
      aiProtocolType: testRequest.protocolType,
    });
  }

  return {
    protocolType: testRequest.protocolType,
    message: testRequest.protocolType === AI_PROTOCOL_TYPES.RESPONSES
      ? "连接正常：responses 接口可用。"
      : "连接正常：chat/completions 接口可用。",
  };
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
    const response = await fetchWithTimeout(modelsEndpoint, { headers }, "模型列表请求超时，请稍后重试。", SETTINGS_REQUEST_TIMEOUT);
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

const openSettingsPopup = async (syncAiSearchEnabled, syncAiConfigState) => {
  setSettingsStatus("", "neutral");

  try {
    const { settings, runtimeState } = await readStoredSettingsSnapshot();
    fillSettingsForm(settings);
    syncHomepageAiToggle(settings);
    syncHomepageAiAvailability(settings, runtimeState, syncAiSearchEnabled, syncAiConfigState);
  } catch (error) {
    setSettingsStatus(error instanceof Error ? error.message : "读取设置失败", "error");
  }

  setSettingsPopupOpen(true);
};

const closeSettingsPopup = () => {
  setSettingsPopupOpen(false);
};

const hydrateHomepageSettings = async (syncAiSearchEnabled, syncAiConfigState, setSearchStatus) => {
  try {
    const { settings, runtimeState } = await readStoredSettingsSnapshot();
    fillSettingsForm(settings);
    syncHomepageAiToggle(settings);
    syncHomepageAiAvailability(settings, runtimeState, syncAiSearchEnabled, syncAiConfigState);
  } catch (error) {
    renderAiConfigState({ configState: AI_CONFIG_STATES.UNCONFIGURED, lastTestMessage: "读取 AI 配置失败，请重新打开设置重试。" }, syncAiConfigState);
    if (typeof syncAiSearchEnabled === "function") {
      syncAiSearchEnabled(false);
    }
    if (typeof setSearchStatus === "function") {
      setSearchStatus(error instanceof Error ? error.message : "读取 AI 配置失败", "error");
    }
    setSettingsStatus(error instanceof Error ? error.message : "读取 AI 配置失败", "error");
  }
};

export const initializeSettingsUi = ({
  setSearchStatus,
  syncAiSearchEnabled,
  syncAiSearchActivating,
  syncAiConfigState,
}) => {
  if (openSettingsButton instanceof HTMLButtonElement) {
    openSettingsButton.addEventListener("click", () => {
      void openSettingsPopup(syncAiSearchEnabled, syncAiConfigState);
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
      void fetchAvailableModels();
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

      try {
        requireValidEndpointDraft(endpoint);
      } catch (error) {
        setSettingsStatus(error instanceof Error ? error.message : "搜索接口地址不正确", "error");
        searchApiEndpointInput.focus();
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
        const runtimeState = await persistRuntimeStateAfterSave();
        const settings = await getStoredSearchSettings();
        syncHomepageAiToggle(settings);
        syncHomepageAiAvailability(settings, runtimeState, syncAiSearchEnabled, syncAiConfigState);
        setSettingsStatus(
          runtimeState.configState === AI_CONFIG_STATES.CONFIGURED
            ? "设置已保存。请点击“测试连接”验证接口可用性。"
            : "设置已保存。请补全接口地址、API Key 和模型。",
          "neutral",
        );
      } catch (error) {
        setSettingsStatus(error instanceof Error ? error.message : "保存设置失败", "error");
      } finally {
        setSettingsSaving(false);
      }
    });
  }

  if (testSearchApiConnectionButton instanceof HTMLButtonElement) {
    testSearchApiConnectionButton.addEventListener("click", async () => {
      setSettingsTesting(true);
      setSettingsStatus("正在测试连接…", "neutral");

      try {
        const { settings } = await resolveSavedAiSettings();
        const testResult = await runAiConnectionTest(settings);
        const runtimeState = await persistRuntimeTestResult({
          protocolType: testResult.protocolType,
          status: "passed",
          message: testResult.message,
        });
        const refreshedSettings = await getStoredSearchSettings();
        syncHomepageAiAvailability(refreshedSettings, runtimeState, syncAiSearchEnabled, syncAiConfigState);
        setSettingsStatus(testResult.message, "success");
      } catch (error) {
        const protocolType = error && typeof error === "object" && "aiProtocolType" in error
          ? error.aiProtocolType
          : "";
        const failureMessage = error instanceof Error ? error.message : "测试连接失败";
        const runtimeState = await persistRuntimeTestResult({
          protocolType,
          status: "failed",
          message: failureMessage,
        });
        const refreshedSettings = await getStoredSearchSettings();
        syncHomepageAiAvailability(refreshedSettings, runtimeState, syncAiSearchEnabled, syncAiConfigState);
        setSettingsStatus(failureMessage, "error");
      } finally {
        setSettingsTesting(false);
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
        const { settings: currentSettings, runtimeState } = await readStoredSettingsSnapshot();
        if (aiSearchEnabledInput.checked && hasUnsavedAiConfigDraft(currentSettings)) {
          throw new Error("当前有未保存的接口配置，请先保存设置，再开启 AI 搜索增强。");
        }

        if (aiSearchEnabledInput.checked && !isAiConfigUsable(runtimeState)) {
          throw new Error(
            runtimeState.configState === AI_CONFIG_STATES.CONFIGURED
              ? "请先点击“测试连接”，确认接口可用后再开启 AI 搜索增强。"
              : runtimeState.configState === AI_CONFIG_STATES.INVALID
                ? "当前接口测试未通过，请修正配置并重新测试后再开启 AI 搜索增强。"
                : "请先完整配置并测试接口连接，再开启 AI 搜索增强。",
          );
        }

        const nextSettings = {
          endpoint: currentSettings.endpoint,
          apiKey: currentSettings.apiKey,
          model: currentSettings.model,
          aiSearchEnabled: aiSearchEnabledInput.checked,
        };
        await saveStoredSearchSettings(nextSettings);
        syncHomepageAiAvailability(nextSettings, runtimeState, syncAiSearchEnabled, syncAiConfigState);
        setAiSearchFeedback(setSearchStatus, "", "neutral");
      } catch (error) {
        setAiSearchFeedback(setSearchStatus, error instanceof Error ? error.message : "保存 AI 开关失败", "error");
        aiSearchEnabledInput.checked = !aiSearchEnabledInput.checked;
        try {
          const { settings: revertedSettings, runtimeState: revertedRuntimeState } = await readStoredSettingsSnapshot();
          syncHomepageAiAvailability(revertedSettings, revertedRuntimeState, syncAiSearchEnabled, syncAiConfigState);
        } catch (revertError) {
          renderAiConfigState({ configState: AI_CONFIG_STATES.UNCONFIGURED, lastTestMessage: "恢复 AI 配置状态失败，请重新打开设置重试。" }, syncAiConfigState);
          if (typeof syncAiSearchEnabled === "function") {
            syncAiSearchEnabled(false);
          }
          setSettingsStatus(revertError instanceof Error ? revertError.message : "恢复 AI 配置状态失败", "error");
        }
      } finally {
        if (activationStarted && typeof syncAiSearchActivating === "function") {
          syncAiSearchActivating(false);
        }
      }
    });
  }

  void hydrateHomepageSettings(syncAiSearchEnabled, syncAiConfigState, setSearchStatus);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("is-settings-open")) {
      closeSettingsPopup();
      return;
    }

    trapSettingsPopupFocus(event);
  });
};
