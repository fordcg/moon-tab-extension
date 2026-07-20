import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeSkillTool } from "../../../src/skills/loadSkills";
import { clearDatabase } from "../../../src/shared/storage/repositories";

describe("metapi model marketplace site lookup", () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it("精确匹配模型并返回可用站点", async () => {
    const marketplace = [
      {
        modelId: "gpt-4o",
        modelName: "GPT-4o",
        site: { id: 1, name: "Alpha Relay", url: "https://alpha.example.com/profile", platform: "new-api" },
      },
      {
        modelId: "claude-3-5-sonnet-20241022",
        modelName: "Claude Sonnet",
        site: { id: 2, name: "Beta Relay", url: "https://beta.example.com", platform: "new-api" },
      },
    ];
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(marketplace),
    });

    await configureMetapi(fetcher);
    const result = await executeSkillTool(
      {
        id: "marketplace-exact",
        name: "metapi_list_model_marketplace_sites",
        arguments: { model: "gpt-4o", refresh: true },
      },
      fetcher as unknown as typeof fetch,
      "metapi.list_model_marketplace_sites",
    );

    expect(result?.isError).not.toBe(true);
    const body = JSON.parse(String(result?.content ?? "{}"));
    expect(body.endpoint).toBe("GET /api/models/marketplace");
    expect(body.matchStatus).toBe("exact");
    expect(body.count).toBe(1);
    expect(body.sites[0]).toMatchObject({
      siteId: "1",
      siteName: "Alpha Relay",
      siteUrl: "https://alpha.example.com",
      platform: "new-api",
      matchType: "exact",
      confidence: 1,
    });
    expect(body.precision.backendExactQueryApiAvailable).toBe(false);
    expect(body.solutionForNoExactApi.join("\n")).toContain("全量数据");
  });

  it("精确未命中时返回模糊候选并标记非精确结果", async () => {
    const marketplace = {
      data: {
        sites: [
          {
            id: 10,
            name: "Gamma Relay",
            url: "https://gamma.example.com",
            models: [
              { id: "gpt-4o-mini", name: "GPT 4o Mini" },
              { id: "qwen-max", name: "Qwen Max" },
            ],
          },
        ],
      },
    };
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(marketplace),
    });

    await configureMetapi(fetcher);
    const result = await executeSkillTool(
      {
        id: "marketplace-fuzzy",
        name: "metapi_list_model_marketplace_sites",
        arguments: { model: "4o mini", refresh: true },
      },
      fetcher as unknown as typeof fetch,
      "metapi.list_model_marketplace_sites",
    );

    expect(result?.isError).not.toBe(true);
    const body = JSON.parse(String(result?.content ?? "{}"));
    expect(body.matchStatus).toBe("fuzzy_candidates");
    expect(body.count).toBe(1);
    expect(body.sites[0]).toMatchObject({
      siteName: "Gamma Relay",
      siteUrl: "https://gamma.example.com",
      matchType: "fuzzy",
    });
    expect(body.guidance).toContain("模糊候选");
    expect(body.precision.note).toContain("不把候选伪装成后端精确查询结果");
  });

  it("支持 models -> sites 的 marketplace 结构", async () => {
    const marketplace = {
      data: {
        models: [
          {
            id: "deepseek-r1",
            name: "DeepSeek R1",
            sites: [
              { id: 21, name: "Delta Relay", url: "https://delta.example.com", platform: "new-api" },
              { id: 22, name: "Echo Relay", url: "https://echo.example.com/dashboard", platform: "new-api" },
            ],
          },
        ],
      },
    };
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(marketplace),
    });

    await configureMetapi(fetcher);
    const result = await executeSkillTool(
      {
        id: "marketplace-models-sites",
        name: "metapi_list_model_marketplace_sites",
        arguments: { model: "deepseek-r1", refresh: true },
      },
      fetcher as unknown as typeof fetch,
      "metapi.list_model_marketplace_sites",
    );

    expect(result?.isError).not.toBe(true);
    const body = JSON.parse(String(result?.content ?? "{}"));
    expect(body.matchStatus).toBe("exact");
    expect(body.sites.map((item: { siteName: string }) => item.siteName).sort()).toEqual(["Delta Relay", "Echo Relay"]);
    expect(body.sites.map((item: { siteUrl: string }) => item.siteUrl).sort()).toEqual([
      "https://delta.example.com",
      "https://echo.example.com",
    ]);
  });

  it("默认复用短期 marketplace 缓存，refresh=true 可强制刷新", async () => {
    let responseIndex = 0;
    const responses = [
      [{ modelId: "gpt-4o", siteName: "Cached Relay" }],
      [{ modelId: "gpt-4o", siteName: "Fresh Relay" }],
    ];
    const fetcher = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/models/marketplace")) {
        const payload = responses[Math.min(responseIndex, responses.length - 1)];
        responseIndex += 1;
        return {
          ok: true,
          text: async () => JSON.stringify(payload),
        };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({ ok: true }),
      };
    });

    await configureMetapi(fetcher);
    const first = await executeSkillTool(
      { id: "first", name: "metapi_list_model_marketplace_sites", arguments: { model: "gpt-4o", refresh: true } },
      fetcher as unknown as typeof fetch,
      "metapi.list_model_marketplace_sites",
    );
    const second = await executeSkillTool(
      { id: "second", name: "metapi_list_model_marketplace_sites", arguments: { model: "gpt-4o" } },
      fetcher as unknown as typeof fetch,
      "metapi.list_model_marketplace_sites",
    );
    const third = await executeSkillTool(
      { id: "third", name: "metapi_list_model_marketplace_sites", arguments: { model: "gpt-4o", refresh: true } },
      fetcher as unknown as typeof fetch,
      "metapi.list_model_marketplace_sites",
    );

    const firstBody = JSON.parse(String(first?.content ?? "{}"));
    const secondBody = JSON.parse(String(second?.content ?? "{}"));
    const thirdBody = JSON.parse(String(third?.content ?? "{}"));
    expect(firstBody.fetch.fromCache).toBe(false);
    expect(secondBody.fetch.fromCache).toBe(true);
    expect(thirdBody.fetch.fromCache).toBe(false);
    expect(secondBody.sites[0].siteName).toBe("Cached Relay");
    expect(thirdBody.sites[0].siteName).toBe("Fresh Relay");
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:4000/api/models/marketplace", expect.any(Object));
  });

  it("未匹配时返回 not_found 和后端精确 API 建议", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify([{ modelId: "claude-3-haiku", siteName: "Only Claude" }]),
    });

    await configureMetapi(fetcher);
    const result = await executeSkillTool(
      {
        id: "marketplace-not-found",
        name: "metapi_list_model_marketplace_sites",
        arguments: { model: "deepseek-r1", refresh: true },
      },
      fetcher as unknown as typeof fetch,
      "metapi.list_model_marketplace_sites",
    );

    expect(result?.isError).not.toBe(true);
    const body = JSON.parse(String(result?.content ?? "{}"));
    expect(body.matchStatus).toBe("not_found");
    expect(body.count).toBe(0);
    expect(body.solutionForNoExactApi.join("\n")).toContain("GET /api/models/:modelId/sites");
  });

  it("marketplace 接口失败时返回中文错误", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ message: "marketplace 暂不可用" }),
    });

    await configureMetapi(fetcher);
    const result = await executeSkillTool(
      {
        id: "marketplace-error",
        name: "metapi_list_model_marketplace_sites",
        arguments: { model: "gpt-4o", refresh: true },
      },
      fetcher as unknown as typeof fetch,
      "metapi.list_model_marketplace_sites",
    );

    expect(result?.isError).toBe(true);
    const body = JSON.parse(String(result?.content ?? "{}"));
    expect(body.message).toContain("marketplace 暂不可用");
    expect(body.errorText).toContain("marketplace 暂不可用");
  });

  it("支持仅通过函数名执行新工具", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify([{ modelId: "gpt-4o", siteName: "Name Only" }]),
    });

    await configureMetapi(fetcher);
    const result = await executeSkillTool(
      {
        id: "call-random-id",
        name: "metapi_list_model_marketplace_sites",
        arguments: { model: "gpt-4o", refresh: true },
      },
      fetcher as unknown as typeof fetch,
    );

    expect(result?.isError).not.toBe(true);
    const body = JSON.parse(String(result?.content ?? "{}"));
    expect(body.matchStatus).toBe("exact");
    expect(body.count).toBe(1);
  });
});

async function configureMetapi(fetcher: ReturnType<typeof vi.fn>): Promise<void> {
  await executeSkillTool(
    {
      id: "configure-metapi",
      name: "metapi_configure",
      arguments: { baseUrl: "http://127.0.0.1:4000", authToken: "test-token" },
    },
    fetcher as unknown as typeof fetch,
    "metapi.configure",
  );
}
