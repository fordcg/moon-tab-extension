import { describe, expect, it } from "vitest";
import {
  createFloatingSidePanelPath,
  SIDE_PANEL_PATH,
} from "../../../src/shared/sidePanelRuntime";

describe("floating side panel path", () => {
  it("creates floating assistant path without controlWindow", () => {
    const path = createFloatingSidePanelPath({ tabId: 9, windowId: 2 });
    expect(path.startsWith(`${SIDE_PANEL_PATH}?`)).toBe(true);
    const params = new URLSearchParams(path.slice(path.indexOf("?") + 1));
    expect(params.get("floating")).toBe("1");
    expect(params.get("controlWindow")).toBeNull();
    expect(params.get("tabId")).toBe("9");
    expect(params.get("windowId")).toBe("2");
  });
});
