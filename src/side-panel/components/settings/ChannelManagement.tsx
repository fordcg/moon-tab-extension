import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import type { ModelProvider, ProviderModel } from "../../../shared/types";
import { useAppStore } from "../../state/appStore";
import { ModelVisionIcon } from "../ModelVisionIndicator";
import { useComposedTextInput } from "../useComposedTextInput";
import { SettingsSelect } from "./SettingsSelect";

export function ChannelManagement() {
  const providers = useAppStore((state) => state.providers);
  const models = useAppStore((state) => state.models);
  const addProvider = useAppStore((state) => state.addProvider);
  const updateProvider = useAppStore((state) => state.updateProvider);
  const addModel = useAppStore((state) => state.addModel);
  const addRemoteModel = useAppStore((state) => state.addRemoteModel);
  const deleteProvider = useAppStore((state) => state.deleteProvider);
  const deleteModel = useAppStore((state) => state.deleteModel);
  const fetchRemoteModels = useAppStore((state) => state.fetchRemoteModels);
  const testModel = useAppStore((state) => state.testModel);
  const updateModel = useAppStore((state) => state.updateModel);
  const remoteModelsByProvider = useAppStore((state) => state.remoteModels);
  const channelOperations = useAppStore((state) => state.channelOperations);
  const modelConnectivity = useAppStore((state) => state.modelConnectivity);

  const [selectedProviderId, setSelectedProviderId] = useState<string>();
  const [expandedProviderId, setExpandedProviderId] = useState<string>();
  const [remoteModelQuery, setRemoteModelQuery] = useState("");
  const [batchModelInput, setBatchModelInput] = useState("");
  const [batchModelError, setBatchModelError] = useState("");
  const [settingsModelId, setSettingsModelId] = useState<string>();
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    if (providers.length === 0) {
      setSelectedProviderId(undefined);
      setExpandedProviderId(undefined);
      return;
    }

    const stillSelected = selectedProviderId && providers.some((provider) => provider.id === selectedProviderId);
    if (!stillSelected) {
      const firstEnabled = providers.find((provider) => provider.enabled) ?? providers[0];
      setSelectedProviderId(firstEnabled.id);
      setExpandedProviderId(firstEnabled.id);
    }
  }, [providers, selectedProviderId]);

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const isExpanded = Boolean(selectedProvider && expandedProviderId === selectedProvider.id);

  const providerModels = useMemo(
    () => (selectedProvider ? models.filter((model) => model.providerId === selectedProvider.id) : []),
    [models, selectedProvider],
  );
  const remoteModels = selectedProvider ? (remoteModelsByProvider[selectedProvider.id] ?? []) : [];
  const channelOperation = selectedProvider ? channelOperations[selectedProvider.id] : undefined;
  const existingRemoteModelIds = useMemo(
    () => new Set(providerModels.map((model) => model.modelId)),
    [providerModels],
  );
  const normalizedRemoteModelQuery = remoteModelQuery.trim().toLowerCase();
  const filteredRemoteModels = remoteModels.filter((remoteModel) => {
    if (!normalizedRemoteModelQuery) {
      return true;
    }

    return (
      remoteModel.id.toLowerCase().includes(normalizedRemoteModelQuery) ||
      remoteModel.displayName.toLowerCase().includes(normalizedRemoteModelQuery)
    );
  });

  const handleRowClick = (providerId: string) => {
    if (selectedProviderId === providerId && expandedProviderId === providerId) {
      setExpandedProviderId(undefined);
      return;
    }
    setSelectedProviderId(providerId);
    setExpandedProviderId(providerId);
    setShowApiKey(false);
  };

  const handleAddProvider = () => {
    const provider = addProvider();
    setSelectedProviderId(provider.id);
    setExpandedProviderId(provider.id);
    setShowApiKey(false);
  };

  const handleAddModel = () => {
    if (!selectedProvider) {
      return;
    }
    addModel(selectedProvider.id);
  };

  const handleClearModels = () => {
    if (!selectedProvider) {
      return;
    }
    if (!window.confirm("确认清空当前渠道下的所有模型吗？")) {
      return;
    }
    const shouldCloseSettings = settingsModelId
      ? providerModels.some((model) => model.id === settingsModelId)
      : false;
    providerModels.forEach((model) => deleteModel(model.id));
    if (shouldCloseSettings) {
      setSettingsModelId(undefined);
    }
  };

  const handleBatchAddModels = () => {
    if (!selectedProvider) {
      return;
    }
    const existingModelIds = new Set(
      models.filter((model) => model.providerId === selectedProvider.id).map((model) => model.modelId),
    );
    const nextModelIds = Array.from(
      new Set(
        batchModelInput
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ).filter((modelId) => !existingModelIds.has(modelId));

    if (nextModelIds.length === 0) {
      setBatchModelError("请输入至少一个未添加的模型 ID");
      return;
    }

    nextModelIds.forEach((modelId) => {
      addModel(selectedProvider.id, { modelId, displayName: modelId });
    });
    setBatchModelInput("");
    setBatchModelError("");
  };

  const handleBatchModelInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    handleBatchAddModels();
  };

  const handleFetchRemoteModels = () => {
    if (!selectedProvider) {
      return;
    }
    void fetchRemoteModels(selectedProvider.id);
  };

  const handleDeleteProvider = () => {
    if (!selectedProvider) {
      return;
    }
    if (!window.confirm(`确认删除渠道「${selectedProvider.name}」及其模型吗？`)) {
      return;
    }
    const deletedId = selectedProvider.id;
    deleteProvider(deletedId);
    const nextProvider = providers.find((provider) => provider.id !== deletedId);
    if (nextProvider) {
      setSelectedProviderId(nextProvider.id);
      setExpandedProviderId(nextProvider.id);
    } else {
      setSelectedProviderId(undefined);
      setExpandedProviderId(undefined);
    }
    setShowApiKey(false);
  };

  const handleTestModel = (modelId: string) => {
    if (!selectedProvider) {
      return;
    }
    void testModel(selectedProvider.id, modelId);
  };

  const settingsModel = settingsModelId ? models.find((model) => model.id === settingsModelId) : undefined;

  return (
    <section className="grid w-full gap-4" aria-label="渠道管理">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">模型渠道</h3>
        <button className="ui-button-secondary" type="button" onClick={handleAddProvider}>
          新增渠道
        </button>
      </div>

      {providers.length === 0 ? (
        <div className="grid gap-2 rounded-lg border border-dashed border-[var(--color-hairline)] p-4 text-sm">
          <p className="text-[var(--color-muted)]">还没有渠道。新增一个模型渠道后即可配置端点与模型。</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {providers.map((provider) => {
            const modelCount = models.filter((model) => model.providerId === provider.id).length;
            const expanded = expandedProviderId === provider.id;
            return (
              <div
                key={provider.id}
                className={[
                  "flex items-stretch gap-2 rounded-lg border p-2",
                  selectedProviderId === provider.id
                    ? "border-[var(--color-primary)] bg-[var(--color-surface-card)]"
                    : "border-[var(--color-hairline)] bg-[var(--color-canvas)]",
                  provider.enabled ? "" : "opacity-60",
                ].join(" ")}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded-md p-2 text-left"
                  aria-expanded={expanded}
                  aria-controls={expanded ? "channel-detail-panel" : undefined}
                  onClick={() => handleRowClick(provider.id)}
                >
                  <span className="block text-sm font-medium">{provider.name}</span>
                  <span className="ui-muted mt-1 block truncate text-xs">{provider.endpointUrl}</span>
                  <span className="ui-muted mt-1 block text-xs">
                    {provider.endpointType === "anthropic_messages" ? "Anthropic" : "OpenAI"} · {modelCount} 个模型
                  </span>
                </button>
                <label className="chat-preference-switch shrink-0 self-center px-2" onClick={(event) => event.stopPropagation()}>
                  <input
                    className="chat-preference-switch-input"
                    type="checkbox"
                    role="switch"
                    aria-label={`渠道启用：${provider.name}`}
                    checked={provider.enabled}
                    onChange={(event) => updateProvider(provider.id, { enabled: event.target.checked })}
                  />
                  <span className="chat-preference-switch-control" aria-hidden="true">
                    <span className="chat-preference-switch-thumb" />
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      )}

      {isExpanded && selectedProvider ? (
        <section
          id="channel-detail-panel"
          className="grid gap-3 border-t border-[var(--color-hairline)] bg-[var(--color-surface-soft)] pt-4"
          aria-label="当前渠道详情"
          role="region"
        >
          <div className="flex flex-wrap gap-2">
            <button
              className="ui-button-secondary"
              type="button"
              onClick={handleFetchRemoteModels}
              disabled={channelOperation?.loading}
            >
              {channelOperation?.loading ? "处理中" : "获取模型列表"}
            </button>
            <button className="ui-button-secondary" type="button" onClick={handleDeleteProvider}>
              删除渠道
            </button>
          </div>
          <label className="grid gap-1 text-sm">
            渠道名称
            <input
              className="ui-input"
              aria-label="渠道名称"
              value={selectedProvider.name}
              onChange={(event) => updateProvider(selectedProvider.id, { name: event.target.value })}
            />
          </label>
          <div className="grid gap-1 text-sm">
            <span>端点类型</span>
            <SettingsSelect
              ariaLabel="端点类型"
              triggerAriaLabel="端点类型菜单"
              value={selectedProvider.endpointType}
              options={[
                { value: "openai_chat", label: "OpenAI Chat Completions" },
                { value: "anthropic_messages", label: "Anthropic Messages" },
              ]}
              onChange={(value) =>
                updateProvider(selectedProvider.id, { endpointType: value as ModelProvider["endpointType"] })
              }
            />
          </div>
          <label className="grid gap-1 text-sm">
            端点地址
            <input
              className="ui-input"
              aria-label="端点地址"
              value={selectedProvider.endpointUrl}
              onChange={(event) => updateProvider(selectedProvider.id, { endpointUrl: event.target.value })}
            />
          </label>
          <label className="grid gap-1 text-sm">
            API Key
            <span className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <input
                className="ui-input min-w-0"
                aria-label="API Key"
                type={showApiKey ? "text" : "password"}
                value={selectedProvider.apiKey}
                onChange={(event) => updateProvider(selectedProvider.id, { apiKey: event.target.value })}
              />
              <button
                className="ui-button-secondary px-2"
                type="button"
                aria-label={showApiKey ? "隐藏 API Key 明文" : "显示 API Key 明文"}
                onClick={() => setShowApiKey((visible) => !visible)}
              >
                <ApiKeyVisibilityIcon visible={showApiKey} />
              </button>
            </span>
          </label>

          <section className="grid gap-3 border-t border-[var(--color-hairline)] pt-4" aria-label="渠道模型" role="region">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold">模型</h4>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button className="ui-button-secondary" type="button" onClick={handleAddModel}>
                  添加模型
                </button>
                <button
                  className="ui-button-secondary"
                  type="button"
                  onClick={handleClearModels}
                  disabled={providerModels.length === 0}
                >
                  清空所有
                </button>
              </div>
            </div>
            <label className="grid gap-1 text-sm">
              批量添加模型
              <input
                className="ui-input"
                aria-label="批量添加模型"
                placeholder="输入模型 ID，用英文逗号分隔，回车添加"
                value={batchModelInput}
                onChange={(event) => {
                  setBatchModelInput(event.target.value);
                  if (batchModelError) {
                    setBatchModelError("");
                  }
                }}
                onKeyDown={handleBatchModelInputKeyDown}
              />
              {batchModelError ? <span className="text-xs text-[var(--color-error)]">{batchModelError}</span> : null}
            </label>
            {remoteModels.length > 0 ? (
              <div className="grid gap-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-canvas)] p-2">
                <label className="grid gap-1 text-sm">
                  搜索模型
                  <input
                    aria-label="搜索模型"
                    aria-controls="remote-model-options"
                    aria-expanded="true"
                    className="ui-input"
                    placeholder="搜索或选择模型"
                    role="combobox"
                    value={remoteModelQuery}
                    onChange={(event) => setRemoteModelQuery(event.target.value)}
                  />
                </label>
                <div className="grid max-h-48 gap-1 overflow-y-auto" id="remote-model-options" role="listbox">
                  {filteredRemoteModels.length > 0 ? (
                    filteredRemoteModels.map((remoteModel) => {
                      const alreadyAdded = existingRemoteModelIds.has(remoteModel.id);

                      return (
                        <button
                          key={remoteModel.id}
                          aria-disabled={alreadyAdded}
                          className={[
                            "rounded-md px-3 py-2 text-left text-sm transition",
                            alreadyAdded
                              ? "cursor-not-allowed bg-[var(--color-primary-disabled)] text-[var(--color-muted)]"
                              : "bg-[var(--color-canvas)] text-[var(--color-ink)] hover:bg-[var(--color-surface-card)]",
                          ].join(" ")}
                          disabled={alreadyAdded}
                          role="option"
                          type="button"
                          onClick={() => addRemoteModel(selectedProvider.id, remoteModel)}
                        >
                          {alreadyAdded ? "已添加 " : ""}
                          {remoteModel.displayName}
                          <span className="ui-muted ml-2 text-xs">{remoteModel.id}</span>
                        </button>
                      );
                    })
                  ) : (
                    <p className="px-3 py-2 text-sm text-[var(--color-muted)]">未找到匹配模型</p>
                  )}
                </div>
              </div>
            ) : null}
            <div className="grid gap-2">
              {providerModels.map((model) => {
                const connectivity = modelConnectivity[model.id];
                const statusText = connectivity?.loading
                  ? "正在测试连通性…"
                  : connectivity?.success
                    ? "测试成功"
                    : connectivity?.error
                      ? `测试失败：${connectivity.error}`
                      : "";
                const showModelId = model.modelId !== model.displayName;

                return (
                  <article
                    key={model.id}
                    className={[
                      "ui-card",
                      "model-connectivity-card",
                      connectivity?.loading ? "is-model-connectivity-loading" : "",
                      connectivity?.success ? "border-[var(--color-success)] is-model-connectivity-success" : "",
                      connectivity?.error ? "border-[var(--color-error)] is-model-connectivity-error" : "",
                      model.enabled ? "" : "opacity-60",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="model-list-name min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 truncate text-sm font-medium">{model.displayName}</span>
                          {model.supportsVision ? (
                            <ModelVisionIcon label={`${model.displayName} 支持视觉理解`} />
                          ) : null}
                        </span>
                        {showModelId ? (
                          <span className="ui-muted mt-0.5 block truncate text-xs">{model.modelId}</span>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <label className="chat-preference-switch shrink-0" onClick={(event) => event.stopPropagation()}>
                          <input
                            className="chat-preference-switch-input"
                            type="checkbox"
                            role="switch"
                            aria-label={`模型启用：${model.displayName}`}
                            checked={model.enabled}
                            onChange={(event) => updateModel(model.id, { enabled: event.target.checked })}
                          />
                          <span className="chat-preference-switch-control" aria-hidden="true">
                            <span className="chat-preference-switch-thumb" />
                          </span>
                        </label>
                        <button
                          aria-label={`设置 ${model.modelId}`}
                          className="ui-button-secondary px-2 py-1"
                          type="button"
                          onClick={() => setSettingsModelId(model.id)}
                        >
                          设置
                        </button>
                        <button
                          aria-label={`测试模型连通性 ${model.modelId}`}
                          className="ui-button-secondary px-2 py-1"
                          type="button"
                          onClick={() => handleTestModel(model.id)}
                          disabled={connectivity?.loading}
                          aria-busy={connectivity?.loading ? true : undefined}
                        >
                          {connectivity?.loading ? "测试中…" : "测试"}
                        </button>
                        <button
                          aria-label={`删除 ${model.modelId}`}
                          className="ui-button-secondary px-2 py-1"
                          type="button"
                          onClick={() => deleteModel(model.id)}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                    {statusText ? (
                      <p
                        className={[
                          "model-connectivity-status mt-2 text-xs",
                          connectivity?.loading ? "text-[var(--color-muted)]" : "",
                          connectivity?.success ? "text-[var(--color-success)]" : "",
                          connectivity?.error ? "text-[var(--color-error)]" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        role="status"
                        aria-live="polite"
                      >
                        {statusText}
                      </p>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        </section>
      ) : null}

      {settingsModel ? (
        <ModelSettingsDialog
          model={settingsModel}
          onClose={() => setSettingsModelId(undefined)}
          onChangeModelId={(modelId) => updateModel(settingsModel.id, { modelId })}
          onChangeSupportsVision={(supportsVision) => updateModel(settingsModel.id, { supportsVision })}
        />
      ) : null}
    </section>
  );
}

interface ModelSettingsDialogProps {
  model: ProviderModel;
  onClose: () => void;
  onChangeModelId: (modelId: string) => void;
  onChangeSupportsVision: (supportsVision: boolean) => void;
}

function ModelSettingsDialog({ model, onClose, onChangeModelId, onChangeSupportsVision }: ModelSettingsDialogProps) {
  const [modelIdError, setModelIdError] = useState("");
  const supportsVision = Boolean(model.supportsVision);
  const modelIdInput = useComposedTextInput(model.modelId, (modelId) => {
    const trimmedModelId = modelId.trim();
    if (!trimmedModelId) {
      setModelIdError("模型 ID 不能为空");
      return;
    }

    setModelIdError("");
    onChangeModelId(trimmedModelId);
  });

  return (
    <>
      <div className="dialog-overlay" aria-hidden="true" onClick={onClose} />
      <section className="model-settings-dialog" role="dialog" aria-modal="true" aria-label="模型设置">
        <div className="context-dialog-header">
          <div className="min-w-0">
            <h4 className="context-dialog-title">模型设置</h4>
            <p className="ui-muted mt-1 truncate text-xs">{model.modelId}</p>
          </div>
          <button className="ui-button-secondary context-dialog-close" type="button" aria-label="关闭模型设置" onClick={onClose}>
            关闭
          </button>
        </div>
        <label className="grid gap-1 text-sm">
          模型 ID
          <input className="ui-input" aria-label="模型 ID" {...modelIdInput} />
          {modelIdError ? <span className="text-xs text-[var(--color-error)]">{modelIdError}</span> : null}
        </label>
        <label className="chat-preference-switch">
          <input
            className="chat-preference-switch-input"
            type="checkbox"
            checked={supportsVision}
            onChange={(event) => onChangeSupportsVision(event.target.checked)}
          />
          <span className="chat-preference-switch-control" aria-hidden="true">
            <span className="chat-preference-switch-thumb" />
          </span>
          <span className="chat-preference-switch-label">支持视觉理解</span>
        </label>
        <p className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] p-2 text-sm text-[var(--color-body)]">
          {supportsVision ? "当前支持视觉理解" : "当前不支持视觉理解"}
        </p>
      </section>
    </>
  );
}

function ApiKeyVisibilityIcon({ visible }: { visible: boolean }) {
  return (
    <span
      className={
        visible
          ? "api-key-visibility-icon api-key-visibility-icon-open tavily-api-key-visibility-icon tavily-api-key-visibility-icon-open"
          : "api-key-visibility-icon api-key-visibility-icon-closed tavily-api-key-visibility-icon tavily-api-key-visibility-icon-closed"
      }
      aria-hidden="true"
    >
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M2.75 12s3.25-5.5 9.25-5.5 9.25 5.5 9.25 5.5-3.25 5.5-9.25 5.5S2.75 12 2.75 12Z" />
        {visible ? <circle cx="12" cy="12" r="2.75" /> : null}
        {visible ? null : <path d="M4.5 4.5 19.5 19.5" />}
      </svg>
    </span>
  );
}
