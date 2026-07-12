import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkflowTemplateMenu } from "../../../src/side-panel/components/WorkflowTemplateMenu";

describe("WorkflowTemplateMenu", () => {
  it("展示任务模板并在选择后关闭菜单", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(<WorkflowTemplateMenu onSelect={onSelect} />);

    await user.click(screen.getByRole("button", { name: "新建任务" }));

    expect(screen.getByRole("menu", { name: "任务模板" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /开发调试/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /网页研究/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /网页自动化/ })).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: /网页研究/ }));

    expect(onSelect).toHaveBeenCalledWith("research");
    await waitFor(() => expect(screen.queryByRole("menu", { name: "任务模板" })).not.toBeInTheDocument());
  });

  it("禁用状态不打开模板菜单", async () => {
    const user = userEvent.setup();

    render(<WorkflowTemplateMenu disabled onSelect={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "新建任务" }));

    expect(screen.queryByRole("menu", { name: "任务模板" })).not.toBeInTheDocument();
  });
});
