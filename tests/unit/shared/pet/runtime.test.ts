import { describe, expect, it } from "vitest";
import {
  PET_CHAT_SEND_TYPE,
  createDefaultPetSnapshot,
  isPetRuntimeMessage,
  petStateLabel,
  resolvePublicCatAssetPath,
} from "../../../../src/shared/pet/runtime";

describe("pet runtime helpers", () => {
  it("maps state labels", () => {
    expect(petStateLabel("working")).toBe("干活中");
    expect(petStateLabel("idle")).toBe("待命");
  });

  it("resolves public cat asset paths", () => {
    expect(resolvePublicCatAssetPath("thinking", 0)).toBe("pet/cat/cat-thinking.gif");
    expect(resolvePublicCatAssetPath("working", 1)).toBe("pet/cat/cat-working-2.gif");
  });

  it("creates a default idle snapshot", () => {
    const snapshot = createDefaultPetSnapshot(123);
    expect(snapshot.state).toBe("idle");
    expect(snapshot.updatedAt).toBe(123);
  });

  it("recognizes pet chat send messages", () => {
    expect(isPetRuntimeMessage({ type: PET_CHAT_SEND_TYPE, content: "hi" })).toBe(true);
  });
});
