import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPreferenceDrawer } from "../../../src/side-panel/components/ChatPreferenceDrawer";
import { SettingsPanel } from "../../../src/side-panel/components/SettingsPanel";
import { useAppStore } from "../../../src/side-panel/state/appStore";
import { clearDatabase } from "../../../src/shared/storage/repositories";
import type { ChatSession, ModelProvider, ProviderModel } from "../../../src/shared/types";

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

function createSession(partial: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "session-1",
    title: "测试会话",
    archived: false,
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    ...partial,
  };
}

describe("渠道管理与网络搜索设置优化", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    useAppStore.getState().reset();
    await clearDatabase();
  });

  it("模型渠道点击展开后再次点击同一渠道会折叠详情与模型", async () => {
    const user = userEvent.setup();
    useAppStore.setState({
      providers: [createProvider()],
      models: [createModel()],
    });

    render(<SettingsPanel initialTab="channels" />);

    expect(await screen.findByRole("region", { name: "当前渠道详情" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "渠道模型" })).toBeInTheDocument();
    expect(screen.getByText("测试模型")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /测试渠道/ }));
    expect(screen.queryByRole("region", { name: "当前渠道详情" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "渠道模型" })).not.toBeInTheDocument();
  });

  it("模型渠道从空列表异步加载后会自动选中真实渠道", async () => {
    const user = userEvent.setup();
    const addProvider = vi.fn(() => createProvider({ id: "provider-created", name: "误建渠道" }));
    const addModel = vi.fn();
    useAppStore.setState({
      providers: [],
      models: [],
      addProvider,
      addModel,
    });

    render(<SettingsPanel initialTab="channels" />);
    expect(await screen.findByText(/还没有渠道/)).toBeInTheDocument();
    expect(screen.queryByText("默认渠道")).not.toBeInTheDocument();

    useAppStore.setState({
      providers: [createProvider()],
      models: [createModel()],
    });

    expect(await screen.findByRole("button", { name: /测试渠道/ })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "当前渠道详情" })).toBeInTheDocument();
    expect(screen.queryByText("默认渠道")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "添加模型" }));
    expect(addProvider).not.toHaveBeenCalled();
    expect(addModel).toHaveBeenCalledWith("provider-1");
  });

  it("渠道管理不再展示 Tavily 配置", async () => {
    useAppStore.setState({
      providers: [createProvider()],
      models: [createModel()],
    });

    render(<SettingsPanel initialTab="channels" />);
    expect(await screen.findByRole("region", { name: "渠道管理" })).toBeInTheDocument();
    expect(screen.queryByText(/Tavily/)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Tavily 搜索工具配置" })).not.toBeInTheDocument();
  });

  it("当前聊天设置不再展示 Tavily 参数覆盖入口", () => {
    useAppStore.setState({
      activeSessionId: "session-1",
      chatSessions: [createSession()],
    });

    render(<ChatPreferenceDrawer open onOpenChange={vi.fn()} />);

    expect(screen.queryByLabelText("当前聊天 Tavily 综合答案")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("当前聊天 Tavily 原始内容")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("当前聊天 Tavily 最大结果数")).not.toBeInTheDocument();
  });
});
