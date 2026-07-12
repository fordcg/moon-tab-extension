import { useEffect, useMemo, useRef, useState } from "react";

import { useAppStore } from "../state/appStore";
import { formatModelLabelWithVision } from "./ModelVisionIndicator";

export function ModelSelector() {
  const [menuOpen, setMenuOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement | null>(null);
  const providers = useAppStore((state) => state.providers);
  const models = useAppStore((state) => state.models);
  const selectedModelId = useAppStore((state) => state.selectedModelId);
  const selectModel = useAppStore((state) => state.selectModel);
  const selectableModelGroups = useMemo(() => {
    const providerById = new Map(providers.map((provider, index) => [provider.id, { provider, index }]));
    const grouped = new Map<
      string,
      {
        providerId: string;
        providerName: string;
        providerIndex: number;
        models: Array<{ id: string; label: string; name: string; modelIndex: number }>;
      }
    >();

    for (const [modelIndex, model] of models.entries()) {
      const providerItem = providerById.get(model.providerId);
      if (!providerItem?.provider.enabled || !model.enabled) {
        continue;
      }

      if (!grouped.has(providerItem.provider.id)) {
        grouped.set(providerItem.provider.id, {
          providerId: providerItem.provider.id,
          providerName: providerItem.provider.name,
          providerIndex: providerItem.index,
          models: [],
        });
      }

      grouped.get(providerItem.provider.id)?.models.push({
        id: model.id,
        label: formatModelLabelWithVision(`${providerItem.provider.name} / ${model.displayName}`, model.supportsVision),
        name: formatModelLabelWithVision(model.displayName, model.supportsVision),
        modelIndex,
      });
    }

    return Array.from(grouped.values())
      // 按渠道配置顺序分组，同一渠道内保留模型原有顺序，避免不同渠道模型在下拉框中穿插显示。
      .sort((left, right) => left.providerIndex - right.providerIndex)
      .map((group) => ({
        ...group,
        models: [...group.models].sort((left, right) => left.modelIndex - right.modelIndex),
      }));
  }, [models, providers]);
  const selectableModels = selectableModelGroups.flatMap((group) => group.models);
  const selectedModelLabel = selectableModels.find((model) => model.id === selectedModelId)?.label ?? "未选择模型";

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      if (selectorRef.current?.contains(event.target as Node)) {
        return;
      }

      setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const handleSelectModel = (modelId: string) => {
    setMenuOpen(false);
    void selectModel(modelId);
  };
  const selectorClassName = menuOpen
    ? "model-select-label model-select-label-inline model-select-label-enhanced is-model-menu-open"
    : "model-select-label model-select-label-inline model-select-label-enhanced";

  return (
    <div className="model-selector" ref={selectorRef}>
      <div className={selectorClassName}>
        <label className="model-select-native-label model-select-label-inline">
          <span className="model-select-text">当前模型</span>
          <select
            className="ui-input model-select-input"
            aria-label="当前模型"
            value={selectedModelId}
            onChange={(event) => handleSelectModel(event.target.value)}
          >
            {selectableModels.length === 0 ? <option value="">未选择模型</option> : null}
            {selectableModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="model-select-trigger"
          type="button"
          aria-label={`模型：${selectedModelLabel}`}
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="model-select-value" aria-hidden="true">{selectedModelLabel}</span>
          <span className="model-select-chevron" aria-hidden="true" />
        </button>
        {menuOpen ? (
          <div className="model-select-menu" role="listbox" aria-label="当前模型">
            <div className="model-select-option-list">
              {selectableModelGroups.length > 0 ? (
                selectableModelGroups.map((group) => (
                  <div className="model-select-group" key={group.providerId}>
                    <div className="model-select-group-title">{group.providerName}</div>
                    {group.models.map((model) => (
                      <button
                        key={model.id}
                        className={model.id === selectedModelId ? "model-select-option model-select-option-active is-selected" : "model-select-option"}
                        type="button"
                        role="option"
                        aria-selected={model.id === selectedModelId}
                        onClick={() => handleSelectModel(model.id)}
                      >
                        <span className="model-select-option-copy">
                          <span className="model-select-option-name">{model.name}</span>
                        </span>
                        {model.id === selectedModelId ? <span className="model-select-option-check" aria-hidden="true">✓</span> : null}
                      </button>
                    ))}
                  </div>
                ))
              ) : (
                <p className="model-select-menu-empty">暂无可用模型</p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
