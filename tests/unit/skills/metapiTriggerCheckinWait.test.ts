import { describe, expect, it, vi } from "vitest";
import { executeSkillTool } from "../../../src/skills/loadSkills";

describe("metapi_trigger_checkin waiting", () => {
  it("默认会在工具内轮询，直到出现新日志再返回", async () => {
    const baseline = [
      {
        checkin_logs: { id: 1, accountId: 10, status: "success", message: "旧日志", createdAt: "2026-07-18 10:00:00" },
        accounts: { id: 10, siteId: 100, username: "u1", status: "active" },
        sites: { id: 100, name: "old", url: "https://old.example.com", platform: "new-api" },
      },
    ];
    const after = [
      ...baseline,
      {
        checkin_logs: { id: 2, accountId: 11, status: "failed", message: "新失败", createdAt: "2026-07-18 10:01:00" },
        accounts: { id: 11, siteId: 101, username: "u2", status: "active" },
        sites: { id: 101, name: "new", url: "https://new.example.com", platform: "new-api" },
      },
    ];

    let logsCalls = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.endsWith("/api/checkin/trigger") && method === "POST") {
        return {
          ok: true,
          text: async () => JSON.stringify({ success: true, queued: true, jobId: "job-1", status: "pending" }),
        };
      }
      if (url.includes("/api/checkin/logs")) {
        logsCalls += 1;
        // 1st call: baseline before trigger; 2nd+: after wait polls
        return {
          ok: true,
          text: async () => JSON.stringify(logsCalls <= 1 ? baseline : after),
        };
      }
      return {
        ok: false,
        text: async () => JSON.stringify({ message: `unexpected ${method} ${url}` }),
      };
    });

    await executeSkillTool(
      {
        id: "cfg",
        name: "metapi_configure",
        arguments: { baseUrl: "http://127.0.0.1:4000", authToken: "test-token" },
      },
      fetcher as unknown as typeof fetch,
      "metapi.configure",
    );

    const result = await executeSkillTool(
      {
        id: "trigger",
        name: "metapi_trigger_checkin",
        arguments: { waitSeconds: 4, pollIntervalSeconds: 1 },
      },
      fetcher as unknown as typeof fetch,
      "metapi.trigger_checkin",
    );

    expect(result?.isError).not.toBe(true);
    const body = JSON.parse(String(result?.content ?? "{}"));
    expect(body.jobId).toBe("job-1");
    expect(body.newLogCount).toBeGreaterThanOrEqual(1);
    expect(body.summary.counts.failed).toBeGreaterThanOrEqual(1);
    expect(body.pollCount).toBeGreaterThanOrEqual(1);
    expect(body.waitedSeconds).toBeGreaterThan(0);
    // Should have polled logs more than once (baseline + wait polls)
    expect(logsCalls).toBeGreaterThanOrEqual(2);
  });
});
