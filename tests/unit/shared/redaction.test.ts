import { describe, expect, it } from "vitest";
import { redactSensitiveText } from "../../../src/shared/security/redaction";

describe("敏感文本脱敏", () => {
  it("会脱敏 OAuth access_token 的赋值、查询参数和 JSON 值", () => {
    const values = [
      "access_token=oauth-secret",
      "https://example.com/callback?access_token=oauth-secret",
      '{"access_token":"oauth-secret"}',
    ];

    for (const value of values) {
      const redacted = redactSensitiveText(value);

      expect(redacted).not.toContain("oauth-secret");
      expect(redacted).toContain("[已脱敏]");
    }
  });
});
