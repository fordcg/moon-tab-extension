import { describe, expect, it } from "vitest";
import {
  BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID,
  FULL_ACCESS_FETCH_TOOL_ID,
  NETWORK_LIST_REQUESTS_TOOL_ID,
  TAVILY_SEARCH_TOOL_ID,
  getRegisteredModelTools,
} from "../../../src/shared/models/toolRegistry";
import { resolveModelToolAvailability } from "../../../src/shared/models/toolAvailability";

function toolById(id: string) {
  const tool = getRegisteredModelTools().find((item) => item.id === id);
  if (!tool) {
    throw new Error(`missing test tool ${id}`);
  }
  return tool;
}

describe("模型工具运行态可用性", () => {
  it("本地和外部搜索工具不依赖 debugger", () => {
    expect(resolveModelToolAvailability(toolById(TAVILY_SEARCH_TOOL_ID), {
      debuggerPermissionDeclared: true,
      browserControlEnabled: false,
      browserControlAttached: false,
      browserAutomationMode: "normal_restricted",
      networkSource: "unavailable",
    })).toMatchObject({ available: true, reasonCode: "available" });
  });

  it("browser_control 工具需要 manifest 权限和已连接浏览器控制", () => {
    expect(resolveModelToolAvailability(toolById(NETWORK_LIST_REQUESTS_TOOL_ID), {
      debuggerPermissionDeclared: false,
      browserControlEnabled: true,
      browserControlAttached: true,
      browserAutomationMode: "normal_restricted",
      networkSource: "debugger_recorder",
    })).toMatchObject({ available: false, reasonCode: "debugger_permission_missing" });

    expect(resolveModelToolAvailability(toolById(NETWORK_LIST_REQUESTS_TOOL_ID), {
      debuggerPermissionDeclared: true,
      browserControlEnabled: false,
      browserControlAttached: false,
      browserAutomationMode: "normal_restricted",
      networkSource: "unavailable",
    })).toMatchObject({ available: false, reasonCode: "browser_control_disabled" });

    expect(resolveModelToolAvailability(toolById(NETWORK_LIST_REQUESTS_TOOL_ID), {
      debuggerPermissionDeclared: true,
      browserControlEnabled: true,
      browserControlAttached: true,
      browserAutomationMode: "normal_restricted",
      networkSource: "debugger_recorder",
    })).toMatchObject({ available: true, reasonCode: "available" });
  });

  it("受控增强和完全访问工具受自动化模式限制", () => {
    expect(resolveModelToolAvailability(toolById(BOUNDARY_REQUEST_USER_CHOICE_TOOL_ID), {
      debuggerPermissionDeclared: true,
      browserControlEnabled: true,
      browserControlAttached: true,
      browserAutomationMode: "normal_restricted",
      networkSource: "debugger_recorder",
    })).toMatchObject({ available: false, reasonCode: "controlled_enhanced_required" });

    expect(resolveModelToolAvailability(toolById(FULL_ACCESS_FETCH_TOOL_ID), {
      debuggerPermissionDeclared: true,
      browserControlEnabled: true,
      browserControlAttached: true,
      browserAutomationMode: "controlled_enhanced",
      networkSource: "debugger_recorder",
    })).toMatchObject({ available: false, reasonCode: "full_access_required" });
  });
});
