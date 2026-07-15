import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AutomationPlaybookSettings } from "../../../src/side-panel/components/settings/AutomationPlaybookSettings";
import { useAppStore } from "../../../src/side-panel/state/appStore";

function setPlaybookStoreState(overrides: Record<string, unknown> = {}) {
  useAppStore.setState({
    automationPlaybookSettings: { disabledPlaybookIds: [] },
    importedSkillPlaybooks: [],
    metapiAdminSettings: { baseUrl: "http://127.0.0.1:4000", authToken: "" },
    updateAutomationPlaybookSettings: vi.fn(async () => undefined),
    updateMetapiAdminSettings: vi.fn(async () => undefined),
    importSkillPlaybooksFromJson: vi.fn(async () => ({ ok: true, importedCount: 0 })),
    removeImportedSkillPlaybook: vi.fn(async () => undefined),
    addNotification: vi.fn(() => "notification-1"),
    ...overrides,
  });
}

describe("任务策略设置", () => {
  it("展示内置 Playbook 并支持启用禁用", async () => {
    const user = userEvent.setup();
    const updateAutomationPlaybookSettings = vi.fn(async () => undefined);
    setPlaybookStoreState({ updateAutomationPlaybookSettings });

    render(<AutomationPlaybookSettings />);

    expect(screen.getByRole("heading", { name: "任务策略" })).toBeInTheDocument();
    expect(screen.getByText("页面阅读")).toBeInTheDocument();
    expect(screen.getByText("Network/API 分析")).toBeInTheDocument();
    expect(screen.getByText("源码/运行时分析")).toBeInTheDocument();
    expect(screen.getByText("收录中转站")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Skill 策略" })).toBeInTheDocument();
    // Metapi 配置折叠在“收录中转站”详细信息内
    expect(screen.queryByLabelText("Metapi 管理令牌")).not.toBeInTheDocument();
    expect(screen.getByText("Metapi 未配置")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看任务策略 收录中转站 详细信息" }));
    expect(screen.getByLabelText("Metapi 管理令牌")).toBeInTheDocument();
    expect(screen.queryByText("克隆")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /删除任务策略 收录中转站/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "启用任务策略 页面阅读" }));

    await waitFor(() => {
      expect(updateAutomationPlaybookSettings).toHaveBeenCalledWith({
        disabledPlaybookIds: ["page_reading"],
      });
    });
  });

  it("可查看不可编辑策略的完整详细信息", async () => {
    const user = userEvent.setup();
    setPlaybookStoreState();

    render(<AutomationPlaybookSettings />);

    await user.click(screen.getByRole("button", { name: "查看任务策略 页面阅读 详细信息" }));

    expect(screen.getByRole("region", { name: "页面阅读详细信息" })).toBeInTheDocument();
    expect(screen.getByText("策略 ID")).toBeInTheDocument();
    expect(screen.getByText("page_reading")).toBeInTheDocument();
    expect(screen.getByText("适用提示")).toBeInTheDocument();
    expect(screen.getByText("当前页面是什么")).toBeInTheDocument();
    expect(screen.getByText("完整策略提示")).toBeInTheDocument();
    expect(screen.getByText(/优先使用当前受控页面作为事实来源/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
  });

  it("支持导入 Skill 策略 JSON 并展示卡片", async () => {
    const user = userEvent.setup();
    const importSkillPlaybooksFromJson = vi.fn(async () => ({ ok: true as const, importedCount: 1 }));
    setPlaybookStoreState({ importSkillPlaybooksFromJson });

    render(<AutomationPlaybookSettings />);
    expect(screen.getByRole("heading", { name: "Skill 策略" })).toBeInTheDocument();
    expect(screen.queryByText("暂未接入")).not.toBeInTheDocument();

    const input = screen.getByLabelText("导入 Skill 策略 JSON 文件") as HTMLInputElement;
    const file = new File([
      JSON.stringify({
        id: "shop_checkout_guard",
        title: "结账前检查",
        description: "提交订单前核对金额与地址",
        tags: ["购物"],
        risk: "high",
        recommendedCapabilities: ["observe_page"],
        selectionHints: ["结账"],
        prompt: "任务策略：结账前检查",
      }),
    ], "skill.json", { type: "application/json" });

    await user.upload(input, file);
    await waitFor(() => expect(importSkillPlaybooksFromJson).toHaveBeenCalled());
  });

  it("导入冲突时展示错误且不丢失已有卡片", async () => {
    const user = userEvent.setup();
    const importSkillPlaybooksFromJson = vi.fn(async () => ({
      ok: false as const,
      message: "与已导入策略 ID 冲突：shop_checkout_guard",
    }));
    setPlaybookStoreState({
      importedSkillPlaybooks: [{
        id: "shop_checkout_guard",
        title: "结账前检查",
        description: "desc",
        tags: [],
        source: "skill",
        defaultEnabled: true,
        risk: "high",
        recommendedCapabilities: ["observe_page"],
        selectionHints: ["结账"],
        prompt: "prompt",
        importedAt: 1,
        updatedAt: 1,
      }],
      importSkillPlaybooksFromJson,
    });

    render(<AutomationPlaybookSettings />);
    expect(screen.getByText("结账前检查")).toBeInTheDocument();
    const input = screen.getByLabelText("导入 Skill 策略 JSON 文件");
    const file = new File(["{}"], "skill.json", { type: "application/json" });
    await user.upload(input, file);
    await waitFor(() => expect(screen.getByText(/冲突/)).toBeInTheDocument());
    expect(screen.getByText("结账前检查")).toBeInTheDocument();
  });

  it("可删除已导入 Skill 策略", async () => {
    const user = userEvent.setup();
    const removeImportedSkillPlaybook = vi.fn(async () => undefined);
    setPlaybookStoreState({
      automationPlaybookSettings: { disabledPlaybookIds: ["shop_checkout_guard"] },
      importedSkillPlaybooks: [{
        id: "shop_checkout_guard",
        title: "结账前检查",
        description: "desc",
        tags: [],
        source: "skill",
        defaultEnabled: true,
        risk: "high",
        recommendedCapabilities: ["observe_page"],
        selectionHints: ["结账"],
        prompt: "prompt",
        importedAt: 1,
        updatedAt: 1,
      }],
      removeImportedSkillPlaybook,
    });

    render(<AutomationPlaybookSettings />);
    await user.click(screen.getByRole("button", { name: "删除任务策略 结账前检查" }));
    await waitFor(() => expect(removeImportedSkillPlaybook).toHaveBeenCalledWith("shop_checkout_guard"));
  });
});
