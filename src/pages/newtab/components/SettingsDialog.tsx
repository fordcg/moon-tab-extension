import { useEffect, useMemo, useRef, useState } from "react";
import { AI_CONFIG_STATES } from "../../../shared/ai-config-state.mjs";
import {
  AI_PROTOCOL_TYPES,
  buildAiTestRequest,
  normalizeAiRuntimeError,
  parseAiRuntimeResponse,
} from "../../../shared/ai-runtime-adapter.mjs";
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
import { CloseIcon } from "./icons";
import type { AiRuntimeState, SearchSettings, StatusMessage } from "./types";

interface SettingsDialogProps {
  open: boolean;
  settings: SearchSettings;
  runtimeState: AiRuntimeState;
  onClose: () => void;
  onSnapshotChange: (settings: SearchSettings, runtimeState: AiRuntimeState) => void;
  onSearchStatus: (status: StatusMessage) => void;
  onAiActivatingChange: (activating: boolean) => void;
}

const SETTINGS_REQUEST_TIMEOUT = 10_000;
const AI_USABLE_STATES = new Set([AI_CONFIG_STATES.VALID, AI_CONFIG_STATES.DEGRADED]);

const AI_STATE_COPY: Record<string, { label: string; message: string }> = {
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

function isAiConfigUsable(runtimeState: AiRuntimeState): boolean {
  return AI_USABLE_STATES.has(runtimeState.configState);
}

function getAiStatePresentation(runtimeState: AiRuntimeState) {
  const copy = AI_STATE_COPY[runtimeState.configState] ?? AI_STATE_COPY[AI_CONFIG_STATES.UNCONFIGURED];
  const detailMessage = runtimeState.configState === AI_CONFIG_STATES.DEGRADED
    ? runtimeState.lastRuntimeErrorMessage
    : runtimeState.lastTestMessage;
  const detailTimestamp = runtimeState.configState === AI_CONFIG_STATES.DEGRADED
    ? runtimeState.lastRuntimeErrorAt
    : runtimeState.lastTestAt;
  const detailSuffix = detailTimestamp ? ` 最近一次记录时间：${detailTimestamp}` : "";

  return {
    configState: runtimeState.configState || AI_CONFIG_STATES.UNCONFIGURED,
    label: copy.label,
    message: detailMessage ? `${detailMessage}${detailSuffix}` : copy.message,
  };
}

function readModelIds(payload: unknown): string[] {
  const data = payload && typeof payload === "object" && "data" in payload ? (payload as { data?: unknown }).data : null;
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map((item) => (item && typeof item === "object" && "id" in item ? String((item as { id?: unknown }).id ?? "").trim() : ""))
    .filter(Boolean);
}

function resolveModelsEndpoint(endpoint: string): string {
  if (!endpoint) {
    throw new Error("请先填写搜索接口地址。");
  }

  const parsed = new URL(endpoint);
  const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  if (/\/v1\/chat\/completions$/i.test(pathname) || pathname === "/" || pathname === "/v1") {
    parsed.pathname = "/v1/models";
    return parsed.toString();
  }

  return `${parsed.origin}/v1/models`;
}

async function readStoredSnapshot(): Promise<{ settings: SearchSettings; runtimeState: AiRuntimeState }> {
  const [settings, runtimeState] = await Promise.all([
    getStoredSearchSettings(),
    getStoredAiConfigState(),
  ]);
  return { settings, runtimeState };
}

async function persistRuntimeStateAfterSave(): Promise<AiRuntimeState> {
  return saveStoredAiConfigState({
    protocol: "",
    configState: "",
    lastTestStatus: "",
    lastTestMessage: "",
    lastTestAt: "",
    lastRuntimeErrorMessage: "",
    lastRuntimeErrorAt: "",
  });
}

async function persistRuntimeTestResult(input: { protocolType: string; status: string; message: string }): Promise<AiRuntimeState> {
  return saveStoredAiConfigState({
    protocol: input.protocolType,
    configState: "",
    lastTestStatus: input.status,
    lastTestMessage: input.message,
    lastTestAt: new Date().toISOString(),
    lastRuntimeErrorMessage: "",
    lastRuntimeErrorAt: "",
  });
}

async function runAiConnectionTest(settings: SearchSettings): Promise<{ protocolType: string; message: string }> {
  const testRequest = buildAiTestRequest(settings);
  if (!testRequest.ok) {
    throw Object.assign(new Error(testRequest.message), { aiProtocolType: testRequest.protocolType });
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
    throw Object.assign(new Error(runtimeError.message), { aiProtocolType: testRequest.protocolType });
  }

  const parsedResponse = parseAiRuntimeResponse(testRequest.protocolType, rawText);
  if (!parsedResponse.ok) {
    throw Object.assign(new Error(parsedResponse.message), { aiProtocolType: testRequest.protocolType });
  }

  return {
    protocolType: testRequest.protocolType,
    message: testRequest.protocolType === AI_PROTOCOL_TYPES.RESPONSES
      ? "连接正常：responses 接口可用。"
      : "连接正常：chat/completions 接口可用。",
  };
}

export function SettingsDialog({
  open,
  settings,
  runtimeState,
  onClose,
  onSnapshotChange,
  onSearchStatus,
  onAiActivatingChange,
}: SettingsDialogProps) {
  const [draft, setDraft] = useState<SearchSettings>(settings);
  const [status, setStatus] = useState<StatusMessage>({ message: "", tone: "neutral" });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const popupRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const presentation = useMemo(() => getAiStatePresentation(runtimeState), [runtimeState]);

  useEffect(() => {
    if (!open) {
      return;
    }
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDraft(settings);
    setStatus({ message: "", tone: "neutral" });
    document.body.classList.add("is-settings-open");
    window.setTimeout(() => popupRef.current?.querySelector<HTMLInputElement>("#search-api-endpoint")?.focus(), 20);
    return () => {
      document.body.classList.remove("is-settings-open");
      previousFocusRef.current?.focus({ preventScroll: true });
    };
  }, [open, settings]);

  useEffect(() => {
    const popup = popupRef.current;
    if (!popup) {
      return;
    }

    if (open) {
      popup.removeAttribute("inert");
    } else {
      popup.setAttribute("inert", "");
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  const setField = (field: keyof SearchSettings, value: string | boolean) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const hasUnsavedDraft = (storedSettings: SearchSettings) =>
    draft.endpoint !== storedSettings.endpoint || draft.apiKey !== storedSettings.apiKey || draft.model !== storedSettings.model;

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      if (draft.endpoint) {
        resolveOriginPattern(draft.endpoint);
      }
    } catch (error) {
      setStatus({ message: error instanceof Error ? error.message : "搜索接口地址不正确", tone: "error" });
      popupRef.current?.querySelector<HTMLInputElement>("#search-api-endpoint")?.focus();
      return;
    }

    setSaving(true);
    setStatus({ message: "正在保存设置…", tone: "neutral" });
    try {
      await saveStoredSearchSettings(draft);
      const nextRuntimeState = await persistRuntimeStateAfterSave();
      const nextSettings = await getStoredSearchSettings();
      onSnapshotChange(nextSettings, nextRuntimeState);
      setDraft(nextSettings);
      setStatus({
        message: nextRuntimeState.configState === AI_CONFIG_STATES.CONFIGURED
          ? "设置已保存。请点击“测试连接”验证接口可用性。"
          : "设置已保存。请补全接口地址、API Key 和模型。",
        tone: "neutral",
      });
    } catch (error) {
      setStatus({ message: error instanceof Error ? error.message : "保存设置失败", tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setStatus({ message: "正在测试连接…", tone: "neutral" });
    try {
      const { settings: storedSettings } = await readStoredSnapshot();
      if (hasUnsavedDraft(storedSettings)) {
        throw new Error("当前有未保存的接口配置，请先保存设置，再测试连接。");
      }

      const testResult = await runAiConnectionTest(storedSettings);
      const nextRuntimeState = await persistRuntimeTestResult({
        protocolType: testResult.protocolType,
        status: "passed",
        message: testResult.message,
      });
      const nextSettings = await getStoredSearchSettings();
      onSnapshotChange(nextSettings, nextRuntimeState);
      setStatus({ message: testResult.message, tone: "success" });
    } catch (error) {
      const protocolType = error && typeof error === "object" && "aiProtocolType" in error
        ? String((error as { aiProtocolType?: unknown }).aiProtocolType ?? "")
        : "";
      const failureMessage = error instanceof Error ? error.message : "测试连接失败";
      const nextRuntimeState = await persistRuntimeTestResult({ protocolType, status: "failed", message: failureMessage });
      const nextSettings = await getStoredSearchSettings();
      onSnapshotChange(nextSettings, nextRuntimeState);
      setStatus({ message: failureMessage, tone: "error" });
    } finally {
      setTesting(false);
    }
  };

  const handleFetchModels = async () => {
    let modelsEndpoint = "";
    try {
      modelsEndpoint = resolveModelsEndpoint(draft.endpoint);
      const originPattern = resolveOriginPatternSafely(draft.endpoint, "模型接口地址不正确，请重新填写。");
      await ensureOriginPermission(originPattern, "未授予该接口域名权限，无法获取模型列表。");
    } catch (error) {
      setStatus({ message: error instanceof Error ? error.message : "模型接口地址不正确", tone: "error" });
      return;
    }

    setFetchingModels(true);
    setStatus({ message: "正在获取模型列表…", tone: "neutral" });
    try {
      const headers: Record<string, string> = { Accept: "*/*", "X-Title": "Moon Tab" };
      if (draft.apiKey) {
        headers.Authorization = `Bearer ${draft.apiKey}`;
      }
      const response = await fetchWithTimeout(modelsEndpoint, { headers }, "模型列表请求超时，请稍后重试。", SETTINGS_REQUEST_TIMEOUT);
      const rawText = await response.text();
      if (!response.ok) {
        throw new Error(rawText || `模型列表请求失败（${response.status}）`);
      }
      const payload = rawText ? JSON.parse(rawText) : {};
      const nextModels = readModelIds(payload);
      setModels(nextModels);
      if (!nextModels.length) {
        throw new Error("模型列表为空");
      }
      setStatus({ message: "模型列表获取完成，请选择模型。", tone: "neutral" });
    } catch (error) {
      setModels([]);
      setStatus({ message: error instanceof Error ? error.message : "获取模型失败", tone: "error" });
    } finally {
      setFetchingModels(false);
    }
  };

  const handleAiToggle = async (checked: boolean) => {
    setDraft((current) => ({ ...current, aiSearchEnabled: checked }));
    const activationStarted = checked;
    onAiActivatingChange(activationStarted);
    try {
      const { settings: currentSettings, runtimeState: currentRuntimeState } = await readStoredSnapshot();
      if (checked && hasUnsavedDraft(currentSettings)) {
        throw new Error("当前有未保存的接口配置，请先保存设置，再开启 AI 搜索增强。");
      }
      if (checked && !isAiConfigUsable(currentRuntimeState)) {
        throw new Error(
          currentRuntimeState.configState === AI_CONFIG_STATES.CONFIGURED
            ? "请先点击“测试连接”，确认接口可用后再开启 AI 搜索增强。"
            : currentRuntimeState.configState === AI_CONFIG_STATES.INVALID
              ? "当前接口测试未通过，请修正配置并重新测试后再开启 AI 搜索增强。"
              : "请先完整配置并测试接口连接，再开启 AI 搜索增强。",
        );
      }

      const nextSettings = { ...currentSettings, aiSearchEnabled: checked };
      await saveStoredSearchSettings(nextSettings);
      onSnapshotChange(nextSettings, currentRuntimeState);
      onSearchStatus({ message: "", tone: "neutral" });
      setStatus({ message: "", tone: "neutral" });
    } catch (error) {
      const { settings: revertedSettings, runtimeState: revertedRuntimeState } = await readStoredSnapshot();
      setDraft(revertedSettings);
      onSnapshotChange(revertedSettings, revertedRuntimeState);
      const message = error instanceof Error ? error.message : "保存 AI 开关失败";
      setStatus({ message, tone: "error" });
      if (!open) {
        onSearchStatus({ message, tone: "error" });
      }
    } finally {
      onAiActivatingChange(false);
    }
  };

  return (
    <div className="settings-modal-host">
      <div id="settings-backdrop" className="settings-backdrop" aria-hidden="true" onClick={onClose} />
      <section
        id="settings-popup"
        className="settings-popup"
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        aria-labelledby="settings-title"
        aria-describedby="settings-description"
        tabIndex={-1}
        ref={popupRef}
      >
        <div className="settings-popup-header">
          <div>
            <h2 id="settings-title" className="settings-popup-title">AI 搜索增强</h2>
            <p id="settings-description" className="settings-popup-description">管理接口地址、鉴权和模型配置。</p>
          </div>
          <button id="close-settings" className="settings-trigger settings-close-button ui-btn-icon" type="button" aria-label="关闭设置" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <form id="settings-form" className="settings-form" autoComplete="off" onSubmit={handleSave}>
          <div className="settings-scroll-area">
            <section className="settings-section" aria-labelledby="settings-api-section-title">
              <div className="settings-section-header">
                <h3 id="settings-api-section-title" className="settings-section-title">搜索接口</h3>
                <p className="settings-section-description">接口地址、鉴权和模型将用于生成 AI 增强搜索结果。</p>
              </div>

              <div className="settings-inline-switch">
                <div className="settings-switch-copy">
                  <p className="settings-switch-title">启用 AI 搜索增强</p>
                  <p className="settings-switch-description">开启后会先生成 AI 增强搜索方案，再执行搜索或打开站点。</p>
                </div>
                <label className="settings-switch-control" htmlFor="ai-search-enabled">
                  <input
                    id="ai-search-enabled"
                    className="settings-switch-input"
                    type="checkbox"
                    checked={draft.aiSearchEnabled}
                    onChange={(event) => void handleAiToggle(event.currentTarget.checked)}
                  />
                  <span className="settings-switch-track" aria-hidden="true">
                    <span className="settings-switch-thumb" />
                  </span>
                </label>
              </div>

              <div id="ai-config-state-card" className="settings-section" data-state={presentation.configState} aria-live="polite">
                <div className="settings-section-header">
                  <h3 className="settings-section-title">AI 配置状态</h3>
                  <p className="settings-section-description">保存配置后需要单独测试，测试通过后才能启用 AI 搜索增强。</p>
                </div>
                <p id="ai-config-state-label" className="settings-note">{presentation.label}</p>
                <p id="ai-config-state-message" className="settings-note">{presentation.message}</p>
              </div>

              <label className="settings-label" htmlFor="search-api-endpoint">搜索接口地址</label>
              <input
                id="search-api-endpoint"
                className="settings-input"
                type="url"
                inputMode="url"
                placeholder="https://api.example.com 或 https://api.example.com/v1/chat/completions"
                value={draft.endpoint}
                onChange={(event) => setField("endpoint", event.currentTarget.value.trim())}
              />
              <p className="settings-note">可填基地址或完整 <code>/v1/chat/completions</code> 地址，扩展会自动补全。</p>
              <p className="settings-note">建议返回 JSON 决策：<code>mode + query/url</code>，可选 <code>websites</code>。</p>

              <label className="settings-label" htmlFor="search-api-key">API Key</label>
              <input
                id="search-api-key"
                className="settings-input"
                type="password"
                placeholder="可选"
                value={draft.apiKey}
                onChange={(event) => setField("apiKey", event.currentTarget.value.trim())}
              />

              <label className="settings-label" htmlFor="search-api-model">模型名称</label>
              <input
                id="search-api-model"
                className="settings-input"
                type="text"
                placeholder="例如 gpt-4o-mini"
                value={draft.model}
                onChange={(event) => setField("model", event.currentTarget.value.trim())}
              />

              <div className="settings-model-tools">
                <button id="fetch-models" className="settings-secondary-button" type="button" disabled={fetchingModels} onClick={() => void handleFetchModels()}>
                  获取模型
                </button>
                <select
                  id="search-api-model-select"
                  className="settings-input settings-select"
                  aria-label="选择模型"
                  value=""
                  onChange={(event) => {
                    if (event.currentTarget.value) {
                      setField("model", event.currentTarget.value);
                    }
                  }}
                >
                  <option value="">{models.length ? "选择模型后自动填入" : "未获取到模型"}</option>
                  {models.map((model) => <option value={model} key={model}>{model}</option>)}
                </select>
              </div>
            </section>
          </div>

          <div className="settings-panel-footer">
            <p id="settings-status" className="settings-status" role="status" aria-live="polite" data-tone={status.tone} hidden={!status.message}>
              {status.message}
            </p>
            <div className="settings-actions">
              <button id="test-search-api-connection" className="settings-secondary-button" type="button" disabled={testing} onClick={() => void handleTest()}>
                测试连接
              </button>
              <button id="save-settings" className="settings-save-button" type="submit" disabled={saving}>保存设置</button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
