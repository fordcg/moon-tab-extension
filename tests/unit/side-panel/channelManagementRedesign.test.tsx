import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsPanel } from "../../../src/side-panel/components/SettingsPanel";
import { useAppStore } from "../../../src/side-panel/state/appStore";
import { clearDatabase } from "../../../src/shared/storage/repositories";
import type { ModelProvider, ProviderModel } from "../../../src/shared/types";

function createProvider(partial: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: "provider-1",
    name: "测试渠道",
    endpointType: "openai_chat",
    endpointUrl: "https://api.example.com",
    apiKey: "sk-test",
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

function createModel(partial: Partial<ProviderModel> = {}): ProviderModel {
  return {
    id: "model-1",
    providerId: "provider-1",
    displayName: "测试模型",
    modelId: "gpt-test",
    temperature: 0.7,
    maxTokens: 1024,
    systemPrompt: "你是网页助手",
    isTitleModel: false,
    supportsVision: false,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe("channel management redesign — model picker migration", () => {
  afterEach(async () => {
    useAppStore.getState().reset();
    await clearDatabase();
  });

  it("shows default/title model pickers under 聊天偏好, not 渠道管理", async () => {
    const user = userEvent.setup();
    useAppStore.setState({
      providers: [createProvider()],
      models: [createModel()],
    });

    render(<SettingsPanel initialTab="channels" />);

    // Channel tab must not own global model pickers
    expect(screen.queryByLabelText("默认对话模型")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("AI 标题生成模型")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "聊天偏好" }));
    expect(await screen.findByLabelText("默认对话模型")).toBeInTheDocument();
    expect(screen.getByLabelText("AI 标题生成模型")).toBeInTheDocument();
  });
});
