import { describe, expect, it } from "vitest";
import { executeSkillTool } from "../../../src/skills/loadSkills";

const SUCCESS_SITES = [
  { siteUrl: "https://ioll.pp.ua", message: "今日已签到（+$15.98）" },
  { siteUrl: "https://aihub.071129.xyz", message: "签到成功（+$182.8）" },
  { siteUrl: "https://chat-api4.087654.xyz", message: "签到成功（今日 +$2.10，累计 8 天）" },
  { siteUrl: "https://runanytime.hxi.me", message: "签到成功（+$25.00，累计 53 天）" },
];

describe("seed successful browser repairs from last session", () => {
  it("records known successful sites into local browser checkin results", async () => {
    for (const site of SUCCESS_SITES) {
      const result = await executeSkillTool(
        {
          id: `seed-${site.siteUrl}`,
          name: "metapi_record_browser_checkin",
          arguments: {
            siteUrl: site.siteUrl,
            status: "success",
            message: site.message,
          },
        },
        fetch,
        "metapi.record_browser_checkin",
      );
      expect(result?.isError).not.toBe(true);
      const body = JSON.parse(String(result?.content ?? "{}"));
      expect(body.recorded).toBe(true);
      expect(body.result.siteUrl).toBe(site.siteUrl);
      expect(body.result.status).toBe("success");
    }

    const listed = await executeSkillTool(
      {
        id: "list-seeded",
        name: "metapi_list_browser_checkin_results",
        arguments: { todayOnly: true },
      },
      fetch,
      "metapi.list_browser_checkin_results",
    );
    const listBody = JSON.parse(String(listed?.content ?? "{}"));
    expect(listBody.count).toBeGreaterThanOrEqual(SUCCESS_SITES.length);
    const urls = (listBody.results as Array<{ siteUrl: string }>).map((item) => item.siteUrl);
    for (const site of SUCCESS_SITES) {
      expect(urls).toContain(site.siteUrl);
    }
  });
});
