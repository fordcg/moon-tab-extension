import { afterEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../../src/side-panel/state/appStore";
import {
  clearDatabase,
  getModelProviders,
  getProviderModels,
  getAppSetting,
  saveModelProvider,
  saveProviderModel,
} from "../../../src/shared/storage/repositories";
import type { ModelProvider, ProviderModel } from "../../../src/shared/types";

function provider(partial: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: "provider-1",
    name: "渠道 A",
    endpointType: "openai_chat",
    endpointUrl: "https://api.example.com",
    apiKey: "sk-a",
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

function model(partial: Partial<ProviderModel> = {}): ProviderModel {
  return {
    id: "model-1",
    providerId: "provider-1",
    displayName: "模型 A",
    modelId: "gpt-a",
    temperature: 0.7,
    maxTokens: 1024,
    systemPrompt: "sys",
    isTitleModel: false,
    supportsVision: false,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe("channel/model enable in appStore", () => {
  afterEach(async () => {
    useAppStore.getState().reset();
    await clearDatabase();
  });

  it("updateProvider persists enabled=false", async () => {
    const p = provider();
    await saveModelProvider(p);
    useAppStore.setState({ providers: [p], models: [] });

    useAppStore.getState().updateProvider(p.id, { enabled: false });

    expect(useAppStore.getState().providers[0]?.enabled).toBe(false);
    const saved = await getModelProviders();
    expect(saved.find((item) => item.id === p.id)?.enabled).toBe(false);
  });

  it("updateModel persists enabled=false", async () => {
    const p = provider();
    const m = model();
    await saveModelProvider(p);
    await saveProviderModel(m);
    useAppStore.setState({ providers: [p], models: [m] });

    useAppStore.getState().updateModel(m.id, { enabled: false });

    expect(useAppStore.getState().models[0]?.enabled).toBe(false);
    const saved = await getProviderModels();
    expect(saved.find((item) => item.id === m.id)?.enabled).toBe(false);
  });

  it("disabling selected model falls back selectedModelId to next eligible model", async () => {
    const p = provider();
    const m1 = model({ id: "model-1", modelId: "gpt-a", displayName: "A" });
    const m2 = model({ id: "model-2", modelId: "gpt-b", displayName: "B" });
    useAppStore.setState({
      providers: [p],
      models: [m1, m2],
      selectedModelId: "model-1",
      defaultChatModelId: "model-1",
    });

    useAppStore.getState().updateModel("model-1", { enabled: false });

    const state = useAppStore.getState();
    expect(state.selectedModelId).toBe("model-2");
    expect(state.defaultChatModelId).toBe("model-2");
  });

  it("disabling channel falls back away from that channel's models", async () => {
    const p1 = provider({ id: "provider-1", name: "A" });
    const p2 = provider({ id: "provider-2", name: "B" });
    const m1 = model({ id: "model-1", providerId: "provider-1" });
    const m2 = model({ id: "model-2", providerId: "provider-2", modelId: "gpt-b", displayName: "B" });
    useAppStore.setState({
      providers: [p1, p2],
      models: [m1, m2],
      selectedModelId: "model-1",
      defaultChatModelId: "model-1",
    });

    useAppStore.getState().updateProvider("provider-1", { enabled: false });

    const state = useAppStore.getState();
    expect(state.providers.find((item) => item.id === "provider-1")?.enabled).toBe(false);
    expect(state.selectedModelId).toBe("model-2");
    expect(state.defaultChatModelId).toBe("model-2");
  });

  it("disabling the title model clears isTitleModel", async () => {
    const p = provider();
    const m1 = model({ id: "model-1", isTitleModel: true });
    const m2 = model({ id: "model-2", modelId: "gpt-b", displayName: "B" });
    useAppStore.setState({ providers: [p], models: [m1, m2] });

    useAppStore.getState().updateModel("model-1", { enabled: false });

    const models = useAppStore.getState().models;
    expect(models.find((item) => item.id === "model-1")?.isTitleModel).toBe(false);
    // title may stay cleared (no auto-assign) or move — require at least not pointing at disabled model
    expect(models.some((item) => item.isTitleModel && item.id === "model-1")).toBe(false);
  });
});
