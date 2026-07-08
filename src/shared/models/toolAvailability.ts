import type {
  ModelToolAvailabilityRuntime,
  ModelToolAvailabilityStatus,
  ModelToolRegistryEntry,
} from "./types";
import { isDebuggerRuntimeRequirement } from "./toolRegistry";

const REASON_TEXT: Record<ModelToolAvailabilityStatus["reasonCode"], string> = {
  available: "工具当前可用。",
  debugger_permission_missing: "扩展未声明 debugger 权限。",
  browser_control_disabled: "浏览器控制未开启。",
  browser_control_not_attached: "浏览器控制尚未连接当前标签页。",
  controlled_enhanced_required: "需要切换到受控增强模式。",
  full_access_required: "需要切换到完全访问模式。",
  network_unavailable: "Network recorder 或 DevTools fallback 当前不可用。",
};

export function resolveModelToolAvailability(
  tool: ModelToolRegistryEntry,
  runtime: ModelToolAvailabilityRuntime,
  checkedAt = Date.now(),
): ModelToolAvailabilityStatus {
  const requirement = tool.toolClassification?.runtime;
  const requiresDebugger = requirement ? isDebuggerRuntimeRequirement(requirement) : false;

  if (!requiresDebugger) {
    return createStatus("available", runtime, requiresDebugger, undefined, checkedAt);
  }

  if (!runtime.debuggerPermissionDeclared) {
    return createStatus("debugger_permission_missing", runtime, requiresDebugger, undefined, checkedAt);
  }

  if (!runtime.browserControlEnabled) {
    return createStatus("browser_control_disabled", runtime, requiresDebugger, undefined, checkedAt);
  }

  if (!runtime.browserControlAttached) {
    return createStatus("browser_control_not_attached", runtime, requiresDebugger, undefined, checkedAt);
  }

  if (requirement === "controlled_enhanced" && runtime.browserAutomationMode !== "controlled_enhanced") {
    return createStatus("controlled_enhanced_required", runtime, requiresDebugger, "controlled_enhanced", checkedAt);
  }

  if (requirement === "full_access" && runtime.browserAutomationMode !== "full_access") {
    return createStatus("full_access_required", runtime, requiresDebugger, "full_access", checkedAt);
  }

  if (tool.id.startsWith("network.") && runtime.networkSource === "unavailable") {
    return createStatus("network_unavailable", runtime, requiresDebugger, undefined, checkedAt);
  }

  return createStatus("available", runtime, requiresDebugger, undefined, checkedAt);
}

function createStatus(
  reasonCode: ModelToolAvailabilityStatus["reasonCode"],
  runtime: ModelToolAvailabilityRuntime,
  requiresDebugger: boolean,
  requiresAutomationMode: ModelToolAvailabilityStatus["requiresAutomationMode"],
  checkedAt: number,
): ModelToolAvailabilityStatus {
  return {
    available: reasonCode === "available",
    reasonCode,
    reason: REASON_TEXT[reasonCode],
    requiresDebugger,
    requiresAutomationMode,
    networkSource: runtime.networkSource,
    checkedAt,
  };
}
