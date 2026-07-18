import { describe, expect, it } from "vitest";
import {
  MODEL_PROVIDER_HEADER_RULE_ID,
  MODEL_PROVIDER_USER_AGENT,
  createModelProviderHeaderRules,
  formatModelHttpErrorMessage,
} from "../../../src/background/modelProviderRequestHeaders";

describe("模型供应商请求头清洗", () => {
  it("DNR 规则会移除 Origin/Referer 并伪装 User-Agent，避免网关因 chrome-extension 指纹 403", () => {
    const rules = createModelProviderHeaderRules();

    expect(rules).toEqual([
      expect.objectContaining({
        id: MODEL_PROVIDER_HEADER_RULE_ID,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "Origin", operation: "remove" },
            { header: "Referer", operation: "remove" },
            { header: "User-Agent", operation: "set", value: MODEL_PROVIDER_USER_AGENT },
          ],
        },
        condition: expect.objectContaining({
          resourceTypes: ["xmlhttprequest"],
        }),
      }),
    ]);
    expect(MODEL_PROVIDER_USER_AGENT).toBe("claude-cli/2.1.161 (external, cli)");

    const condition = rules[0]?.condition as { urlFilter?: string; regexFilter?: string };
    // 覆盖 OpenAI 兼容 chat/completions 与 Anthropic messages，以及 models 列表探测。
    expect(JSON.stringify(condition)).toMatch(/chat\/completions|messages|\/models/);
  });

  it("403 错误文案会提示可能是扩展 Origin 被上游拦截，并附带上游正文摘要", () => {
    expect(formatModelHttpErrorMessage(403, "Forbidden", "access denied by WAF")).toContain("403");
    expect(formatModelHttpErrorMessage(403, "Forbidden", "access denied by WAF")).toContain("Origin");
    expect(formatModelHttpErrorMessage(403, "Forbidden", "access denied by WAF")).toContain("access denied by WAF");
  });

  it("普通非 403 错误只保留状态码与正文摘要", () => {
    expect(formatModelHttpErrorMessage(401, "Unauthorized", '{"message":"Invalid token"}')).toBe(
      '模型请求失败：401 Unauthorized — {"message":"Invalid token"}',
    );
  });
});
