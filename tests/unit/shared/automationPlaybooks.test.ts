import { describe, expect, it } from "vitest";
import {
  getEnabledAutomationPlaybooks,
  getAutomationPlaybookById,
  getRegisteredAutomationPlaybooks,
  matchAutomationPlaybookByHints,
  normalizeAutomationPlaybookSettings,
  shouldRunAutomationPlaybookSelection,
} from "../../../src/shared/automationPlaybooks";

describe("浏览器自动化 Playbook 注册表", () => {
  it("核心内置与 skill 包策略字段完整且默认启用", () => {
    const playbooks = getRegisteredAutomationPlaybooks();

    expect(playbooks.map((playbook) => playbook.id)).toEqual([
      "page_reading",
      "multi_page_synthesis",
      "form_interaction",
      "site_diagnostics",
      "network_api_analysis",
      "source_runtime_analysis",
      "full_access_signature_lab",
      "register_relay_site",
      "query_model_marketplace_sites",
      "start_all_checkin",
      "repair_failed_checkin",
    ]);
    expect(new Set(playbooks.map((playbook) => playbook.id)).size).toBe(playbooks.length);
    for (const playbook of playbooks) {
      expect(playbook).toMatchObject({
        defaultEnabled: true,
        title: expect.any(String),
        description: expect.any(String),
        prompt: expect.stringContaining("任务策略"),
      });
      expect(["builtin", "skill"]).toContain(playbook.source);
      expect(playbook.tags.length).toBeGreaterThan(0);
      expect(playbook.recommendedCapabilities.length).toBeGreaterThan(0);
      expect(playbook.selectionHints.length).toBeGreaterThan(0);
    }
    expect(playbooks.find((item) => item.id === "register_relay_site")?.source).toBe("skill");
  });

  it("完全访问签名实验室声明最高风险、Full Access 能力和脱敏交付边界", () => {
    const playbook = getAutomationPlaybookById("full_access_signature_lab");

    expect(playbook).toMatchObject({
      title: "Full Access 签名实验室",
      risk: "critical",
      defaultEnabled: true,
      source: "builtin",
    });
    expect(playbook?.recommendedCapabilities).toEqual(expect.arrayContaining([
      "observe_page",
      "analyze_site",
      "full_access",
      "deliver_result",
    ]));
    expect(playbook?.selectionHints).toEqual(expect.arrayContaining([
      "逆向这个请求签名",
      "找 sign 生成逻辑",
      "分析 nonce 怎么生成",
    ]));
    expect(playbook?.prompt).toEqual(expect.stringContaining("任务策略：Full Access 签名实验室"));
    expect(playbook?.prompt).toEqual(expect.stringContaining("full_access.get_network_details"));
    expect(playbook?.prompt).toEqual(expect.stringContaining("full_access.execute_script"));
    expect(playbook?.prompt).toEqual(expect.stringContaining("full_access.fetch"));
    expect(playbook?.prompt).toEqual(expect.stringContaining("可复现实验记录"));
    expect(playbook?.prompt).toEqual(expect.stringContaining("默认导出、后续追问和工作流产物只保留脱敏摘要"));
  });

  it("设置归一化会忽略未知 ID 和非法类型", () => {
    const settings = normalizeAutomationPlaybookSettings({
      disabledPlaybookIds: ["page_reading", "missing", 42, "network_api_analysis"],
    });

    expect(settings).toEqual({
      disabledPlaybookIds: ["page_reading", "network_api_analysis"],
    });
    expect(normalizeAutomationPlaybookSettings({ disabledPlaybookIds: "bad" })).toEqual({
      disabledPlaybookIds: [],
    });
  });

  it("禁用后的 Playbook 不参与候选选择", () => {
    const enabled = getEnabledAutomationPlaybooks({
      disabledPlaybookIds: ["page_reading", "source_runtime_analysis"],
    });

    expect(enabled.map((playbook) => playbook.id)).not.toContain("page_reading");
    expect(enabled.map((playbook) => playbook.id)).not.toContain("source_runtime_analysis");
    expect(enabled.map((playbook) => playbook.id)).toContain("network_api_analysis");
  });

  it("浏览器现场相关需求与 Metapi skill 关键词都会触发预选", () => {
    expect(shouldRunAutomationPlaybookSelection("帮我看看当前页面为什么报错")).toBe(true);
    expect(shouldRunAutomationPlaybookSelection("分析这个接口参数怎么生成")).toBe(true);
    expect(shouldRunAutomationPlaybookSelection("总结这个网页内容")).toBe(true);
    expect(shouldRunAutomationPlaybookSelection("帮我补签失败的站")).toBe(true);
    expect(shouldRunAutomationPlaybookSelection("开始签到")).toBe(true);
    expect(shouldRunAutomationPlaybookSelection("收录中转站")).toBe(true);
    expect(shouldRunAutomationPlaybookSelection("看看 gpt-4o 模型哪些站点有")).toBe(true);
    expect(shouldRunAutomationPlaybookSelection("逆向这个请求签名")).toBe(true);
    expect(shouldRunAutomationPlaybookSelection("找 sign 生成逻辑")).toBe(true);
    expect(shouldRunAutomationPlaybookSelection("分析 nonce 怎么生成")).toBe(true);
    expect(shouldRunAutomationPlaybookSelection("定位 debug 参数加密算法")).toBe(true);
    expect(shouldRunAutomationPlaybookSelection("React useMemo 是什么")).toBe(false);
    expect(shouldRunAutomationPlaybookSelection("当前时间是多少")).toBe(false);
    expect(shouldRunAutomationPlaybookSelection("JS 的闭包是什么")).toBe(false);
  });

  it("自然语言可直接命中 skill 策略，无需 / 命令", () => {
    const playbooks = getEnabledAutomationPlaybooks({ disabledPlaybookIds: [] });
    expect(matchAutomationPlaybookByHints("请帮我补签", playbooks)?.id).toBe("repair_failed_checkin");
    expect(matchAutomationPlaybookByHints("开始签到并汇总", playbooks)?.id).toBe("start_all_checkin");
    expect(matchAutomationPlaybookByHints("收录中转站 gpt(name)", playbooks)?.id).toBe("register_relay_site");
    expect(matchAutomationPlaybookByHints("看看 gpt-4o 模型哪些站点有", playbooks)?.id).toBe("query_model_marketplace_sites");
    expect(matchAutomationPlaybookByHints("找 sign 生成逻辑", playbooks)?.id).toBe("full_access_signature_lab");
    expect(matchAutomationPlaybookByHints("逆向这个请求签名", playbooks)?.id).toBe("full_access_signature_lab");
    expect(matchAutomationPlaybookByHints("今天天气怎么样", playbooks)).toBeUndefined();
  });

  it("补签策略在立即签到点击后会快失败并保留诊断证据", () => {
    const playbook = getAutomationPlaybookById("repair_failed_checkin");

    expect(playbook?.prompt).toEqual(expect.stringContaining("点击「立即签到」后"));
    expect(playbook?.prompt).toEqual(expect.stringContaining("2~5 秒"));
    expect(playbook?.prompt).toEqual(expect.stringContaining("不要反复点击同一个签到入口"));
    expect(playbook?.prompt).toEqual(expect.stringContaining("collect_diagnostics"));
    expect(playbook?.prompt).toEqual(expect.stringContaining("network_list_requests"));
    expect(playbook?.prompt).toEqual(expect.stringContaining("network_get_request_details"));
    expect(playbook?.prompt).toEqual(expect.stringContaining("Console"));
    expect(playbook?.prompt).toEqual(expect.stringContaining("metapi_record_browser_checkin"));
  });
});
