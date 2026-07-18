import { describe, expect, it } from "vitest";
import { derivePetState } from "../../../../src/shared/pet/derivePetState";

describe("derivePetState", () => {
  it("maps boundary pending to waiting", () => {
    const snapshot = derivePetState({ boundaryPending: true });
    expect(snapshot.state).toBe("waiting");
    expect(snapshot.badge).toBe("running");
  });

  it("maps running tools to working and multi tools to juggling", () => {
    expect(
      derivePetState({
        tools: [{ id: "1", name: "Read", status: "running" }],
      }).state,
    ).toBe("working");
    expect(
      derivePetState({
        tools: [
          { id: "1", name: "Read", status: "running" },
          { id: "2", name: "Edit", status: "running" },
        ],
      }).state,
    ).toBe("juggling");
  });

  it("maps streaming text to talking and sending to thinking", () => {
    expect(derivePetState({ streamingText: true, assistantSnippet: "hello world" }).state).toBe("talking");
    expect(derivePetState({ sending: true }).state).toBe("thinking");
  });

  it("respects mute for bubbles", () => {
    const muted = derivePetState({ streamingText: true, assistantSnippet: "secret", muted: true });
    expect(muted.bubble).toBeUndefined();
  });

  it("shows assistant reply in the bubble after completion", () => {
    const snapshot = derivePetState({
      justCompleted: true,
      assistantSnippet: "主人，今天天气很好喵～",
    });
    expect(snapshot.state).toBe("talking");
    expect(snapshot.bubble).toContain("天气很好");
    expect(snapshot.badge).toBe("done");
  });

  it("strips markdown tables from spoken reply bubbles", () => {
    const snapshot = derivePetState({
      justCompleted: true,
      assistantSnippet: "## 一、项目定位\n\n| 项目 | 内容 |\n| --- | --- |\n| 仓库 | DeusData/codebase |",
    });
    expect(snapshot.bubble).toBeTruthy();
    expect(snapshot.bubble).not.toContain("|");
    expect(snapshot.bubble).not.toContain("##");
  });

  it("falls back to done note only when reply is empty", () => {
    const snapshot = derivePetState({ justCompleted: true });
    expect(snapshot.state).toBe("happy");
    expect(snapshot.bubble).toBe("本轮完成");
  });

  it("falls to sleeping after long idle", () => {
    const now = 1_000_000;
    const snapshot = derivePetState({ now, lastActivityAt: now - 11 * 60_000 });
    expect(snapshot.state).toBe("sleeping");
  });
});
