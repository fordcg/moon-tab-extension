import { describe, expect, it } from "vitest";
import {
  createFloatingControlBeaconPath,
  createFloatingSidePanelPath,
  SIDE_PANEL_PATH,
} from "../../../src/shared/sidePanelRuntime";

describe("floating control beacon path", () => {
  it("creates in-page floating path with controlWindow flag", () => {
    const path = createFloatingControlBeaconPath({ tabId: 12, windowId: 3 });
    expect(path.startsWith(`${SIDE_PANEL_PATH}?`)).toBe(true);
    const params = new URLSearchParams(path.slice(path.indexOf("?") + 1));
    expect(params.get("floating")).toBe("1");
    expect(params.get("controlWindow")).toBe("1");
    expect(params.get("tabId")).toBe("12");
    expect(params.get("windowId")).toBe("3");
  });

  it("keeps normal floating assistant path without controlWindow", () => {
    const path = createFloatingSidePanelPath({ tabId: 9 });
    const params = new URLSearchParams(path.slice(path.indexOf("?") + 1));
    expect(params.get("floating")).toBe("1");
    expect(params.get("controlWindow")).toBeNull();
  });
});
