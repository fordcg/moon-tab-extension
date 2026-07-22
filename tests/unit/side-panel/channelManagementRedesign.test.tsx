import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("channel management redesign — layout", () => {
  afterEach(async () => {
    useAppStore.getState().reset();
    await clearDatabase();
  });

  it("auto-expands first enabled channel and places detail after the list", async () => {
    useAppStore.setState({
      providers: [
        createProvider({ id: "provider-1", name: "渠道一", enabled: true }),
        createProvider({ id: "provider-2", name: "渠道二", enabled: true, endpointUrl: "https://b.example.com" }),
      ],
      models: [createModel({ providerId: "provider-1" })],
    });

    render(<SettingsPanel initialTab="channels" />);

    const detail = await screen.findByRole("region", { name: "当前渠道详情" });
    const listButton = screen.getByRole("button", { name: /渠道一/ });
    // detail is not inside the list button
    expect(listButton).not.toContainElement(detail);
    // models visible when expanded
    expect(screen.getByRole("region", { name: "渠道模型" })).toBeInTheDocument();
  });

  it("collapses detail when clicking the expanded channel again", async () => {
    const user = userEvent.setup();
    useAppStore.setState({
      providers: [createProvider()],
      models: [createModel()],
    });
    render(<SettingsPanel initialTab="channels" />);
    expect(await screen.findByRole("region", { name: "当前渠道详情" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /测试渠道/ }));
    expect(screen.queryByRole("region", { name: "当前渠道详情" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "渠道模型" })).not.toBeInTheDocument();
  });

  it("toggles channel enable without collapsing via switch", async () => {
    const user = userEvent.setup();
    const updateProvider = vi.fn();
    useAppStore.setState({
      providers: [createProvider()],
      models: [createModel()],
      updateProvider,
    });
    render(<SettingsPanel initialTab="channels" />);
    expect(await screen.findByRole("region", { name: "当前渠道详情" })).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "渠道启用：测试渠道" }));
    expect(updateProvider).toHaveBeenCalledWith("provider-1", { enabled: false });
    expect(screen.getByRole("region", { name: "当前渠道详情" })).toBeInTheDocument();
  });

  it("toggles model enable from model row", async () => {
    const user = userEvent.setup();
    const updateModel = vi.fn();
    useAppStore.setState({
      providers: [createProvider()],
      models: [createModel()],
      updateModel,
    });
    render(<SettingsPanel initialTab="channels" />);
    await screen.findByRole("region", { name: "渠道模型" });

    await user.click(screen.getByRole("switch", { name: "模型启用：测试模型" }));
    expect(updateModel).toHaveBeenCalledWith("model-1", { enabled: false });
  });

  it("shows empty state without draft provider and without Tavily", async () => {
    useAppStore.setState({ providers: [], models: [] });
    render(<SettingsPanel initialTab="channels" />);

    expect(await screen.findByText(/还没有渠道/)).toBeInTheDocument();
    expect(screen.queryByText("默认渠道")).not.toBeInTheDocument();
    expect(screen.queryByText(/Tavily/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新增渠道" })).toBeInTheDocument();
  });
});
