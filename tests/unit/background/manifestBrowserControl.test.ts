import { describe, expect, it } from "vitest";
import manifest from "../../../public/manifest.json";

describe("浏览器控制 Manifest 权限", () => {
  it("Phase 0-1 默认不声明 debugger 权限，避免提前启用高风险浏览器控制", () => {
    expect(manifest.permissions).toEqual(expect.arrayContaining(["tabs"]));
    expect(manifest.permissions).not.toContain("debugger");
    expect(manifest.permissions).not.toContain("tabGroups");
  });
});
