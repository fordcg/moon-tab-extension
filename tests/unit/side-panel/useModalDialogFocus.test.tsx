import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { useModalDialogFocus } from "../../../src/side-panel/components/useModalDialogFocus";

function FocusHarness() {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [escapedAt, setEscapedAt] = useState<number>();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useModalDialogFocus({
    dialogRef,
    initialFocusRef: closeRef,
    onEscape: () => {
      setEscapedAt(version);
      setOpen(false);
    },
    open,
  });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>打开</button>
      <output aria-label="关闭时版本">{escapedAt}</output>
      {open ? (
        <section ref={dialogRef} role="dialog" aria-label="测试弹窗" tabIndex={-1}>
          <button ref={closeRef} type="button" onClick={() => setOpen(false)}>关闭</button>
          <button type="button" onClick={() => setVersion((current) => current + 1)}>更新 {version}</button>
        </section>
      ) : null}
    </>
  );
}

describe("useModalDialogFocus", () => {
  it("弹窗内部重渲染时保持当前焦点，并让 Escape 使用最新回调后恢复触发器焦点", async () => {
    const user = userEvent.setup();
    render(<FocusHarness />);

    const openButton = screen.getByRole("button", { name: "打开" });
    await user.click(openButton);
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "更新 0" }));
    const updatedButton = screen.getByRole("button", { name: "更新 1" });
    expect(updatedButton).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "测试弹窗" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("关闭时版本")).toHaveTextContent("1");
    await waitFor(() => expect(openButton).toHaveFocus());
  });
});
