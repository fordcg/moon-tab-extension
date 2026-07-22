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

  it("会脱敏签名实验字段的赋值、查询参数和 JSON 值", () => {
    const values = [
      "https://example.com/api?sign=raw-signature&nonce=raw-nonce",
      "{\"signature\":\"raw-signature\",\"sig\":\"raw-sig\",\"nonce\":\"raw-nonce\"}",
      "sign=raw-signature nonce=raw-nonce sig=raw-sig",
    ];

    for (const value of values) {
      const redacted = redactSensitiveText(value);

      expect(redacted).toContain("[已脱敏]");
      expect(redacted).not.toMatch(/raw-signature|raw-nonce|raw-sig/);
    }
  });
});
