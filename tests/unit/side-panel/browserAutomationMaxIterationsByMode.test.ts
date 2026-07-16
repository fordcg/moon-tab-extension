import { describe, expect, it } from "vitest";
import {
  createDefaultChatPreferences,
  resolveBrowserAutomationMaxToolIterationsForMode,
} from "../../../src/side-panel/state/appStorePreferences";
import { normalizeBrowserAutomationMaxToolIterations } from "../../../src/background/backgroundToolRuntime";

describe("browser automation max iterations by mode", () => {
  it("uses different limits for normal / controlled / full_access", () => {
    const prefs = createDefaultChatPreferences();
    expect(resolveBrowserAutomationMaxToolIterationsForMode(prefs, "normal_restricted")).toBe(48);
    expect(resolveBrowserAutomationMaxToolIterationsForMode(prefs, "controlled_enhanced")).toBe(80);
    expect(resolveBrowserAutomationMaxToolIterationsForMode(prefs, "full_access")).toBe(0);
  });

  it("normalizes 0 as unlimited and keeps positive floors", () => {
    expect(normalizeBrowserAutomationMaxToolIterations(0)).toBe(0);
    expect(normalizeBrowserAutomationMaxToolIterations(12.6)).toBe(13);
    expect(normalizeBrowserAutomationMaxToolIterations(undefined)).toBe(48);
  });
});
