import { describe, expect, it } from "vitest";
import {
  getEnabledAutomationPlaybooks,
  getRegisteredAutomationPlaybooks,
  mergeImportedSkillPlaybooks,
  normalizeAutomationPlaybookSettings,
  normalizeImportedSkillPlaybooks,
  parseSkillPlaybookImportJson,
} from "../../../src/shared/automationPlaybooks";

const sample = {
  id: "shop_checkout_guard",
  title: "结账前检查",
  description: "提交订单前核对金额与地址",
  tags: ["购物", "表单"],
  risk: "high",
  recommendedCapabilities: ["observe_page", "operate_page", "confirm_boundary"],
  selectionHints: ["结账", "下单前检查"],
  prompt: "任务策略：结账前检查\n先观察结算页。",
};

describe("skill playbook import helpers", () => {
  it("parses a single valid skill object", () => {
    const result = parseSkillPlaybookImportJson(JSON.stringify(sample));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.playbooks).toHaveLength(1);
    expect(result.playbooks[0]).toMatchObject({
      id: "shop_checkout_guard",
      source: "skill",
      defaultEnabled: true,
    });
  });

  it("parses an array of skills", () => {
    const result = parseSkillPlaybookImportJson(JSON.stringify([
      sample,
      { ...sample, id: "skill_b", title: "B" },
    ]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.playbooks.map((item) => item.id)).toEqual([
      "shop_checkout_guard",
      "skill_b",
    ]);
  });

  it("rejects invalid JSON and illegal ids", () => {
    expect(parseSkillPlaybookImportJson("{").ok).toBe(false);
    expect(parseSkillPlaybookImportJson(JSON.stringify({ ...sample, id: "Bad-Id" })).ok).toBe(false);
    expect(parseSkillPlaybookImportJson(JSON.stringify({ ...sample, risk: "extreme" })).ok).toBe(false);
  });

  it("rejects conflicts with builtin or existing imported ids", () => {
    const existing = normalizeImportedSkillPlaybooks({
      playbooks: [{ ...sample, source: "skill", defaultEnabled: true, importedAt: 1, updatedAt: 1 }],
    });
    const againstBuiltin = mergeImportedSkillPlaybooks(existing, [
      { ...sample, id: "page_reading", source: "skill", defaultEnabled: true },
    ]);
    expect(againstBuiltin.ok).toBe(false);
    if (againstBuiltin.ok) return;
    expect(againstBuiltin.message).toContain("内置");

    const againstImported = mergeImportedSkillPlaybooks(existing, [
      { ...sample, source: "skill", defaultEnabled: true },
    ]);
    expect(againstImported.ok).toBe(false);
    if (againstImported.ok) return;
    expect(againstImported.message).toContain("已导入");
  });

  it("merges registry and respects disable list for imported skills", () => {
    const imported = normalizeImportedSkillPlaybooks({
      playbooks: [{ ...sample, source: "skill", defaultEnabled: true, importedAt: 1, updatedAt: 1 }],
    });
    const registered = getRegisteredAutomationPlaybooks(imported);
    expect(registered.some((item) => item.id === "shop_checkout_guard")).toBe(true);
    expect(registered.some((item) => item.id === "page_reading")).toBe(true);

    const enabled = getEnabledAutomationPlaybooks(
      { disabledPlaybookIds: ["shop_checkout_guard"] },
      imported,
    );
    expect(enabled.some((item) => item.id === "shop_checkout_guard")).toBe(false);
    expect(enabled.some((item) => item.id === "page_reading")).toBe(true);
  });

  it("normalizes settings against known ids including imported skills", () => {
    const settings = normalizeAutomationPlaybookSettings(
      { disabledPlaybookIds: ["shop_checkout_guard", "page_reading", "missing"] },
      ["page_reading", "shop_checkout_guard"],
    );
    expect(settings.disabledPlaybookIds).toEqual(["shop_checkout_guard", "page_reading"]);
  });
});
