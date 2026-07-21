import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatComposer, removeSlashCommandSegment } from "../../../src/side-panel/components/ChatComposer";
import { useAppStore } from "../../../src/side-panel/state/appStore";

describe("ChatComposer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useAppStore.getState().reset();
  });

  it("选择策略后按当前输入值移除完整斜杠搜索片段", () => {
    expect(removeSlashCommandSegment("帮我用 /风险 审查", 4)).toBe("帮我用 审查");
    expect(removeSlashCommandSegment("/风险", 0)).toBe("");
    expect(removeSlashCommandSegment("前缀 /fengxian", 3)).toBe("前缀");
    // multi-arg register command keeps trailing args outside the slash token removal helper's old behavior
    expect(removeSlashCommandSegment("/风险 后续内容", 0)).toBe("后续内容");
  });

  it("打开浏览器自动化模式菜单时保持工具架展开", async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn((_message: unknown, callback?: (response: unknown) => void) => {
      callback?.({ ok: true, attached: true, tabId: 1, message: "ok" });
      return true;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage, lastError: undefined } });
    useAppStore.setState({ browserControlEnabled: true, browserAutomationMode: "normal_restricted" });

    render(<ChatComposer canSend matchedRuleLabel="" />);

    await user.click(screen.getByRole("button", { name: "工具" }));
    expect(document.querySelector(".chat-composer.is-tools-open")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "浏览器自动化模式" }));

    expect(document.querySelector(".chat-composer.is-tools-open")).toBeTruthy();
    expect(screen.getByRole("listbox", { name: "浏览器自动化模式" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /受控增强/ })).toBeInTheDocument();
  });
});
