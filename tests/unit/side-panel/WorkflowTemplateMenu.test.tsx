import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkflowTemplateMenu } from "../../../src/side-panel/components/WorkflowTemplateMenu";

describe("WorkflowTemplateMenu", () => {
  it("展示任务模板并把选择交给输入区处理", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(<WorkflowTemplateMenu onSelect={onSelect} />);

    expect(screen.getByRole("menu", { name: "任务模板" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /开发调试/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /网页研究/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /网页自动化/ })).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: /网页研究/ }));

    expect(onSelect).toHaveBeenCalledWith("research");
  });

  it("只渲染菜单内容，不重复创建触发按钮", () => {
    render(<WorkflowTemplateMenu onSelect={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "新建任务" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
  });
});
