import { describe, expect, it } from "vitest";
import {
  executeSkillTool,
  getSkillLoaderDiagnostics,
  getSkillModelTools,
  getSkillPackages,
  getSkillPlaybooks,
  getSkillToolExecutor,
  refreshSkillPackages,
} from "../../../src/skills/loadSkills";

describe("skill package loader", () => {
  it("loads registered metapi-ops package tools and playbooks", () => {
    const packages = getSkillPackages();
    expect(packages.some((pkg) => pkg.id === "metapi-ops")).toBe(true);

    const tools = getSkillModelTools();
    expect(tools.some((tool) => tool.id === "metapi.create_site")).toBe(true);
    expect(tools.some((tool) => tool.id === "metapi.create_account")).toBe(true);
    expect(tools.some((tool) => tool.id === "metapi.trigger_checkin")).toBe(true);
    expect(tools.some((tool) => tool.id === "metapi.get_checkin_logs")).toBe(true);
    expect(tools.some((tool) => tool.id === "metapi.summarize_checkin_logs")).toBe(true);
    expect(tools.some((tool) => tool.id === "metapi.list_model_marketplace_sites")).toBe(true);

    const playbooks = getSkillPlaybooks();
    expect(playbooks.some((playbook) => playbook.id === "register_relay_site")).toBe(true);
    expect(playbooks.some((playbook) => playbook.id === "query_model_marketplace_sites")).toBe(true);
    expect(playbooks.some((playbook) => playbook.id === "start_all_checkin")).toBe(true);
    expect(playbooks.some((playbook) => playbook.id === "repair_failed_checkin")).toBe(true);

    expect(getSkillToolExecutor("metapi.list_sites")).toEqual(expect.any(Function));
    expect(getSkillToolExecutor("metapi_list_sites")).toEqual(expect.any(Function));
    expect(getSkillToolExecutor("metapi.list_model_marketplace_sites")).toEqual(expect.any(Function));
    expect(getSkillToolExecutor("metapi_list_model_marketplace_sites")).toEqual(expect.any(Function));
  });

  it("exposes loader diagnostics and supports explicit rescan", () => {
    const diagnostics = getSkillLoaderDiagnostics();
    expect(diagnostics).toEqual([
      expect.objectContaining({
        packageId: "metapi-ops",
        status: "ok",
        toolCount: expect.any(Number),
        playbookCount: expect.any(Number),
        messages: [],
      }),
    ]);
    expect(diagnostics[0]?.toolCount).toBeGreaterThan(0);
    expect(diagnostics[0]?.playbookCount).toBeGreaterThan(0);
    expect(refreshSkillPackages().some((pkg) => pkg.id === "metapi-ops")).toBe(true);
  });

  it("resolves skill tools by registry id or function name, not random call id", async () => {
    const byRegistryId = await executeSkillTool(
      {
        id: "call_random_1",
        name: "metapi_parse_register_args",
        arguments: { text: "gpt(name) 开启系统代理" },
      },
      fetch,
      "metapi.parse_register_args",
    );
    expect(byRegistryId?.isError).not.toBe(true);
    expect(byRegistryId?.content).toContain("gpt");

    const byNameOnly = await executeSkillTool(
      {
        id: "call_random_2",
        name: "metapi_parse_register_args",
        arguments: { text: "开启系统代理" },
      },
      fetch,
    );
    expect(byNameOnly?.isError).not.toBe(true);
    expect(byNameOnly?.content).toContain("useSystemProxy");

    const unknown = await executeSkillTool(
      {
        id: "call_unknown",
        name: "not_a_skill_tool",
        arguments: {},
      },
      fetch,
    );
    expect(unknown).toBeUndefined();
  });
});
