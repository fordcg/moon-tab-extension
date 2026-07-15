import { describe, expect, it } from "vitest";
import { getSkillModelTools, getSkillPackages, getSkillPlaybooks, getSkillToolExecutor } from "../../../src/skills/loadSkills";

describe("skill package loader", () => {
  it("loads metapi-ops package tools and playbooks without central hardcoding", () => {
    const packages = getSkillPackages();
    expect(packages.some((pkg) => pkg.id === "metapi-ops")).toBe(true);

    const tools = getSkillModelTools();
    expect(tools.some((tool) => tool.id === "metapi.create_site")).toBe(true);
    expect(tools.some((tool) => tool.id === "metapi.create_account")).toBe(true);

    const playbooks = getSkillPlaybooks();
    expect(playbooks.some((playbook) => playbook.id === "register_relay_site")).toBe(true);

    expect(getSkillToolExecutor("metapi.list_sites")).toEqual(expect.any(Function));
  });
});
