import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  detectModelSupportsReasoningEffort,
  getReasoningEffortProfile,
  normalizeModelReasoningEffort,
  type ModelReasoningEffort,
} from "../../shared/models/modelReasoning";
import { useAppStore } from "../state/appStore";
import { formatModelLabelWithVision } from "./ModelVisionIndicator";

export function ModelSelector() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeModelId, setActiveModelId] = useState<string>();
  const menuId = useId();
  const selectorRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const providers = useAppStore((state) => state.providers);
  const models = useAppStore((state) => state.models);
  const selectedModelId = useAppStore((state) => state.selectedModelId);
  const selectModel = useAppStore((state) => state.selectModel);
  const updateModel = useAppStore((state) => state.updateModel);

  const selectableModelGroups = useMemo(() => {
    const providerById = new Map(providers.map((provider, index) => [provider.id, { provider, index }]));
    const grouped = new Map<
      string,
      {
        providerId: string;
        providerName: string;
        providerIndex: number;
        endpointType: string;
        models: Array<{
          id: string;
          label: string;
          name: string;
          modelIndex: number;
          modelId: string;
          displayName: string;
          supportsVision?: boolean;
          supportsReasoning: boolean;
          reasoningEffort?: ModelReasoningEffort;
        }>;
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
          endpointType: providerItem.provider.endpointType,
          models: [],
        });
      }

      const endpointType = providerItem.provider.endpointType;
      grouped.get(providerItem.provider.id)?.models.push({
        id: model.id,
        label: formatModelLabelWithVision(`${providerItem.provider.name} / ${model.displayName}`, model.supportsVision),
        name: formatModelLabelWithVision(model.displayName, model.supportsVision),
        modelIndex,
        modelId: model.modelId,
        displayName: model.displayName,
        supportsVision: model.supportsVision,
        supportsReasoning: detectModelSupportsReasoningEffort(model.modelId, model.displayName, endpointType),
        reasoningEffort: model.reasoningEffort,
      });
    }

    return Array.from(grouped.values())
      .sort((left, right) => left.providerIndex - right.providerIndex)
      .map((group) => ({
        ...group,
        models: [...group.models].sort((left, right) => left.modelIndex - right.modelIndex),
      }));
  }, [models, providers]);

  const selectableModels = useMemo(
    () => selectableModelGroups.flatMap((group) => group.models),
    [selectableModelGroups],
  );
  const selectedModelLabel = selectableModels.find((model) => model.id === selectedModelId)?.label ?? "未选择模型";
  const selectedModel = selectableModels.find((model) => model.id === selectedModelId);
  const selectedProviderEndpointType = selectableModelGroups.find((group) =>
    group.models.some((model) => model.id === selectedModelId),
  )?.endpointType;
  const effortProfile = selectedModel
    ? getReasoningEffortProfile(selectedModel.modelId, selectedModel.displayName, selectedProviderEndpointType)
    : null;
  const effortValue = effortProfile
    ? normalizeModelReasoningEffort(
        selectedModel?.reasoningEffort,
        effortProfile.options.map((item) => item.value),
        effortProfile.defaultValue,
      )
    : undefined;

  const focusModelOption = (modelId: string) => {
    setActiveModelId(modelId);
    queueMicrotask(() => optionRefs.current.get(modelId)?.focus({ preventScroll: true }));
  };

  const openMenu = (preferredModelId?: string) => {
    const targetModelId = preferredModelId && selectableModels.some((model) => model.id === preferredModelId)
      ? preferredModelId
      : selectableModels.find((model) => model.id === selectedModelId)?.id ?? selectableModels[0]?.id;
    setMenuOpen(true);
    if (targetModelId) {
      focusModelOption(targetModelId);
    }
  };

  const closeMenu = (restoreFocus = false) => {
    setMenuOpen(false);
    if (restoreFocus) {
      queueMicrotask(() => triggerRef.current?.focus({ preventScroll: true }));
    }
  };

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
        event.preventDefault();
        closeMenu(true);
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
    setActiveModelId(modelId);
    closeMenu(true);
    void selectModel(modelId);
  };
  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    event.preventDefault();
    const selectedIndex = selectableModels.findIndex((model) => model.id === selectedModelId);
    const fallbackIndex = event.key === "ArrowUp" ? selectableModels.length - 1 : 0;
    openMenu(selectableModels[selectedIndex >= 0 ? selectedIndex : fallbackIndex]?.id);
  };
  const handleOptionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, modelId: string) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || selectableModels.length === 0) {
      return;
    }

    event.preventDefault();
    const currentIndex = Math.max(0, selectableModels.findIndex((model) => model.id === modelId));
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? selectableModels.length - 1
        : event.key === "ArrowDown"
          ? (currentIndex + 1) % selectableModels.length
          : (currentIndex - 1 + selectableModels.length) % selectableModels.length;
    const nextModelId = selectableModels[nextIndex]?.id;
    if (nextModelId) {
      focusModelOption(nextModelId);
    }
  };
  const selectorClassName = menuOpen
    ? "model-select-label model-select-label-inline model-select-label-enhanced is-model-menu-open"
    : "model-select-label model-select-label-inline model-select-label-enhanced";

  return (
    <div
      className="model-selector"
      ref={selectorRef}
      onBlur={(event) => {
        if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) {
          setMenuOpen(false);
        }
      }}
    >
      <div className={selectorClassName}>
        <label className="model-select-native-label model-select-label-inline">
          <span className="model-select-text">当前模型</span>
          <select
            className="ui-input model-select-input"
            aria-label="当前模型"
            tabIndex={-1}
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
          ref={triggerRef}
          className="model-select-trigger"
          type="button"
          aria-label={`模型：${selectedModelLabel}`}
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          title={selectedModelLabel}
          onClick={() => (menuOpen ? closeMenu() : openMenu(selectedModelId))}
          onKeyDown={handleTriggerKeyDown}
        >
          <span className="model-select-value" aria-hidden="true">{selectedModelLabel}</span>
          <span className="model-select-chevron" aria-hidden="true" />
        </button>
        {menuOpen ? (
          <div className="model-select-menu" id={menuId} role="listbox" aria-label="当前模型">
            <div className="model-select-option-list">
              {selectableModelGroups.length > 0 ? (
                selectableModelGroups.map((group, groupIndex) => (
                  <div
                    className="model-select-group"
                    key={group.providerId}
                    role="group"
                    aria-labelledby={`${menuId}-group-${groupIndex}`}
                  >
                    <div className="model-select-group-title" id={`${menuId}-group-${groupIndex}`}>{group.providerName}</div>
                    {group.models.map((model) => (
                      <button
                        ref={(element) => {
                          if (element) {
                            optionRefs.current.set(model.id, element);
                          } else {
                            optionRefs.current.delete(model.id);
                          }
                        }}
                        key={model.id}
                        className={model.id === selectedModelId ? "model-select-option model-select-option-active is-selected" : "model-select-option"}
                        type="button"
                        role="option"
                        aria-selected={model.id === selectedModelId}
                        tabIndex={model.id === activeModelId ? 0 : -1}
                        title={model.label}
                        onClick={() => handleSelectModel(model.id)}
                        onFocus={() => setActiveModelId(model.id)}
                        onKeyDown={(event) => handleOptionKeyDown(event, model.id)}
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
                <div className="model-select-menu-empty" role="option" aria-disabled="true">暂无可用模型</div>
              )}
            </div>
            {effortProfile && selectedModel ? (
              <div
                className="model-select-effort"
                role="group"
                aria-label="推理强度"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <span className="model-select-effort-label">强度</span>
                <div className="model-select-effort-chips">
                  {effortProfile.options.map((option) => {
                    const active = option.value === effortValue;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={active ? "model-select-effort-chip is-active" : "model-select-effort-chip"}
                        aria-pressed={active}
                        title={`推理强度：${option.label}`}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          updateModel(selectedModel.id, { reasoningEffort: option.value });
                        }}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
