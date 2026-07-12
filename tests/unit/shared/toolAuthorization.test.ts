import { describe, expect, it } from "vitest";
import { isFullAccessAuthorized } from "../../../src/shared/toolAuthorization";

describe("完全访问授权", () => {
  it("仅在未过期且标签页和源站都匹配时有效", () => {
    const context = { mode: "full_access" as const, tabId: 8, origin: "https://example.com", createdAt: 1, expiresAt: 200 };
    expect(isFullAccessAuthorized(context, 8, "https://example.com", 199)).toBe(true);
    expect(isFullAccessAuthorized(context, 8, "https://other.example", 199)).toBe(false);
    expect(isFullAccessAuthorized(context, 8, "https://example.com", 200)).toBe(false);
  });
});
