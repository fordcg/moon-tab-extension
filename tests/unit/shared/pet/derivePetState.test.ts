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

  it("falls to sleeping after long idle", () => {
    const now = 1_000_000;
    const snapshot = derivePetState({ now, lastActivityAt: now - 11 * 60_000 });
    expect(snapshot.state).toBe("sleeping");
  });
});
