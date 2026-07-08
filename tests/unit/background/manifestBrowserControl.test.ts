import { describe, expect, it } from "vitest";
import manifest from "../../../public/manifest.json";

const manifestWithOptionalPermissions = manifest as typeof manifest & {
  optional_permissions?: string[];
};

describe("浏览器控制 Manifest 权限", () => {
  it("正式发布声明 debugger 权限，浏览器控制仍由用户显式开启", () => {
    expect(manifest.permissions).toEqual(expect.arrayContaining([
      "sidePanel",
      "storage",
      "contextMenus",
      "activeTab",
      "scripting",
      "alarms",
      "tabs",
      "debugger",
    ]));
    expect(manifest.permissions).not.toContain("tabGroups");
    expect(manifestWithOptionalPermissions.optional_permissions ?? []).not.toContain("debugger");
  });
});
