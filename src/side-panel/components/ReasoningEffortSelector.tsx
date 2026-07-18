import { useMemo } from "react";
import {
  detectModelSupportsReasoningEffort,
  MODEL_REASONING_EFFORT_OPTIONS,
  type ModelReasoningEffort,
} from "../../shared/models/modelReasoning";
import { useAppStore } from "../state/appStore";

export function ReasoningEffortSelector() {
  const models = useAppStore((state) => state.models);
  const selectedModelId = useAppStore((state) => state.selectedModelId);
  const updateModel = useAppStore((state) => state.updateModel);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId),
    [models, selectedModelId],
  );

  if (!selectedModel) {
    return null;
  }

  const supported = detectModelSupportsReasoningEffort(selectedModel.modelId, selectedModel.displayName);
  if (!supported) {
    return null;
  }

  const value: ModelReasoningEffort = selectedModel.reasoningEffort ?? "medium";

  return (
    <label className="reasoning-effort-selector" title="推理强度（reasoning_effort / thinking）">
      <span className="reasoning-effort-label">强度</span>
      <select
        className="ui-input reasoning-effort-select"
        aria-label="模型推理强度"
        value={value}
        onChange={(event) => {
          updateModel(selectedModel.id, {
            reasoningEffort: event.target.value as ModelReasoningEffort,
          });
        }}
      >
        {MODEL_REASONING_EFFORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.shortLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
