import { describe, expect, it } from "vitest";
import {
  findExistingSiteByUrl,
  normalizeSiteUrl,
  parseRegisterRelaySiteArgs,
} from "../../../src/shared/metapiAdmin";

describe("metapiAdmin helpers", () => {
  it("parses /收录中转站 args for name and system proxy", () => {
    expect(parseRegisterRelaySiteArgs("gpt(name) 开启系统代理")).toMatchObject({
      name: "gpt",
      useSystemProxy: true,
    });
    expect(parseRegisterRelaySiteArgs("我的站 开启系统代理")).toMatchObject({
      name: "我的站",
      useSystemProxy: true,
    });
    expect(parseRegisterRelaySiteArgs("开启系统代理")).toMatchObject({
      name: undefined,
      useSystemProxy: true,
    });
    expect(parseRegisterRelaySiteArgs("only-name")).toMatchObject({
      name: "only-name",
      useSystemProxy: false,
    });
  });

  it("normalizes site urls for existence checks", () => {
    expect(normalizeSiteUrl("https://a.example.com/v1/")).toBe("https://a.example.com");
    expect(normalizeSiteUrl("https://a.example.com/path/")).toBe("https://a.example.com/path");
  });

  it("finds existing site by normalized url", () => {
    const existing = findExistingSiteByUrl(
      [
        { id: 1, url: "https://a.example.com/v1", name: "A", platform: "new-api" },
        { id: 2, url: "https://b.example.com", name: "B", platform: "new-api" },
      ],
      "https://a.example.com/",
    );
    expect(existing).toMatchObject({ id: 1, name: "A" });
  });

  it("parses gpt(name) form from full command args", () => {
    expect(parseRegisterRelaySiteArgs("收录中转站 gpt(name) 开启系统代理".replace(/^收录中转站\s*/, ""))).toMatchObject({
      name: "gpt",
      useSystemProxy: true,
    });
  });
});
