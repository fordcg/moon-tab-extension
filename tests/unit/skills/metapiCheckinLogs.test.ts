import { describe, expect, it, vi } from "vitest";
import { executeSkillTool } from "../../../src/skills/loadSkills";

describe("metapi checkin log summarization", () => {
  it("classifies nested Metapi checkin logs and builds repair candidates", async () => {
    const payload = [
      {
        checkin_logs: { id: 1, accountId: 10, status: "success", message: "签到成功", createdAt: "2026-07-15 22:40:13" },
        accounts: { id: 10, siteId: 100, username: "u1", status: "active" },
        sites: { id: 100, name: "ok-site", url: "https://ok.example.com", platform: "new-api" },
        failureReason: null,
      },
      {
        checkin_logs: { id: 2, accountId: 11, status: "failed", message: "HTTP 404:", createdAt: "2026-07-15 22:39:13" },
        accounts: { id: 11, siteId: 101, username: "u2", status: "active" },
        sites: { id: 101, name: "fail-site", url: "https://fail.example.com/profile", platform: "new-api" },
        failureReason: { code: "unknown_error", title: "未知错误" },
      },
      {
        checkin_logs: { id: 3, accountId: 12, status: "skipped", message: "今日已签到", createdAt: "2026-07-15 22:38:13" },
        accounts: { id: 12, siteId: 102, username: "u3", status: "active" },
        sites: { id: 102, name: "skip-site", url: "https://skip.example.com", platform: "new-api" },
        failureReason: null,
      },
    ];

    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(payload),
    });

    // ensure settings exist by configuring first
    await executeSkillTool(
      {
        id: "call-config",
        name: "metapi_configure",
        arguments: { baseUrl: "http://127.0.0.1:4000", authToken: "test-token" },
      },
      fetcher as unknown as typeof fetch,
      "metapi.configure",
    );

    const result = await executeSkillTool(
      {
        id: "call-summary",
        name: "metapi_summarize_checkin_logs",
        arguments: { limit: 100 },
      },
      fetcher as unknown as typeof fetch,
      "metapi.summarize_checkin_logs",
    );

    expect(result?.isError).not.toBe(true);
    const body = JSON.parse(String(result?.content ?? "{}"));
    expect(body.counts.success).toBe(1);
    expect(body.counts.failed).toBe(1);
    expect(body.counts.skipped).toBe(1);
    expect(body.counts.repairCandidates).toBe(2);
    expect(body.repairCandidates.map((item: { siteUrl: string }) => item.siteUrl).sort()).toEqual([
      "https://fail.example.com",
      "https://skip.example.com",
    ]);
  });
});

  it("records browser repair results and excludes them from repairCandidates", async () => {
    const payload = [
      {
        checkin_logs: { id: 2, accountId: 11, status: "failed", message: "HTTP 404:", createdAt: "2026-07-15 22:39:13" },
        accounts: { id: 11, siteId: 101, username: "u2", status: "active" },
        sites: { id: 101, name: "fail-site", url: "https://fail.example.com/profile", platform: "new-api" },
        failureReason: { code: "unknown_error", title: "未知错误" },
      },
    ];
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(payload),
    });
    await executeSkillTool(
      { id: "c1", name: "metapi_configure", arguments: { baseUrl: "http://127.0.0.1:4000", authToken: "test-token" } },
      fetcher as unknown as typeof fetch,
      "metapi.configure",
    );
    await executeSkillTool(
      {
        id: "c2",
        name: "metapi_record_browser_checkin",
        arguments: {
          siteUrl: "https://fail.example.com/profile",
          status: "success",
          message: "浏览器补签成功",
        },
      },
      fetcher as unknown as typeof fetch,
      "metapi.record_browser_checkin",
    );
    const result = await executeSkillTool(
      { id: "c3", name: "metapi_summarize_checkin_logs", arguments: { limit: 20 } },
      fetcher as unknown as typeof fetch,
      "metapi.summarize_checkin_logs",
    );
    const body = JSON.parse(String(result?.content ?? "{}"));
    expect(body.counts.failed).toBe(1);
    expect(body.counts.repairCandidates).toBe(0);
    expect(body.counts.browserRepairedToday).toBe(1);
  });

  it("marks captcha/shield messages as needs_human and keeps unopened sites out of failed records", async () => {
    const result = await executeSkillTool(
      {
        id: "shield-1",
        name: "metapi_record_browser_checkin",
        arguments: {
          siteUrl: "https://windhub.cc",
          status: "failed",
          message: "安全验证 SHIELD 挡住签到按钮",
        },
      },
      fetch,
      "metapi.record_browser_checkin",
    );
    const body = JSON.parse(String(result?.content ?? "{}"));
    expect(body.result.status).toBe("needs_human");
    expect(body.barrier).toBe("shield");
  });
