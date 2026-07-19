import type { AutomationPlaybook } from "../shared/automationPlaybooks";
import type { ModelToolCall, ModelToolRegistryEntry, ModelToolResult } from "../shared/models/types";
import { skill as metapiOpsSkill } from "./metapi-ops";
import type { SkillPackage, SkillToolExecutor } from "./types";

type SkillModule = {
  skill?: SkillPackage;
  default?: SkillPackage;
};

export type SkillLoaderDiagnosticStatus = "ok" | "warning" | "error";

export interface SkillLoaderDiagnostic {
  modulePath: string;
  packageId: string;
  packageName: string;
  status: SkillLoaderDiagnosticStatus;
  messages: string[];
  toolCount: number;
  playbookCount: number;
}

// Keep the registry explicit so this loader works in both Vite builds and
// Node/jiti legacy tests. `import.meta.glob` is Vite-only and is parsed before
// any runtime guard can run in CommonJS-style test loaders.
const skillModules: Record<string, SkillModule> = {
  "./metapi-ops/index.ts": { skill: metapiOpsSkill },
};

let cachedPackages: SkillPackage[] | null = null;
let executorMap: Map<string, SkillToolExecutor> | null = null;

export function getSkillPackages(): SkillPackage[] {
  if (cachedPackages) {
    return cachedPackages;
  }
  cachedPackages = Object.entries(skillModules)
    .map(([path, mod]) => {
      const pkg = resolveSkillPackage(mod);
      if (!pkg || typeof pkg !== "object" || !pkg.id) {
        console.warn(`[skills] skip invalid package module: ${path}`);
        return null;
      }
      return pkg;
    })
    .filter((pkg): pkg is SkillPackage => Boolean(pkg));
  return cachedPackages;
}

export function getSkillLoaderDiagnostics(): SkillLoaderDiagnostic[] {
  const diagnostics: SkillLoaderDiagnostic[] = [];
  const seenPackageIds = new Set<string>();
  const seenToolIds = new Map<string, string>();
  const seenToolNames = new Map<string, string>();
  const seenPlaybookIds = new Map<string, string>();

  for (const [modulePath, mod] of Object.entries(skillModules)) {
    const pkg = resolveSkillPackage(mod);
    const messages: string[] = [];
    if (!pkg || typeof pkg !== "object") {
      diagnostics.push(createSkillDiagnostic(modulePath, undefined, ["错误：模块未导出有效 skill package。"]));
      continue;
    }

    const packageId = readNonEmptyString(pkg.id);
    if (!packageId) {
      messages.push("错误：package.id 不能为空。");
    } else if (seenPackageIds.has(packageId)) {
      messages.push(`错误：package.id 重复：${packageId}。`);
    } else {
      seenPackageIds.add(packageId);
    }
    if (!readNonEmptyString(pkg.name)) {
      messages.push("错误：package.name 不能为空。");
    }
    if ((pkg.tools?.length ?? 0) > 0 && !pkg.executeTool) {
      messages.push("警告：声明了 tools 但未提供 executeTool，工具无法执行。");
    }

    for (const tool of pkg.tools ?? []) {
      const toolId = readNonEmptyString(tool?.id);
      const toolName = readNonEmptyString(tool?.name);
      if (!toolId || !toolName) {
        messages.push("错误：工具必须同时声明 id 和 name。");
        continue;
      }
      appendDuplicateDiagnostic(messages, seenToolIds, toolId, packageId || modulePath, "工具 id");
      appendDuplicateDiagnostic(messages, seenToolNames, toolName, packageId || modulePath, "工具 name");
      if (!tool.parameters || typeof tool.parameters !== "object") {
        messages.push(`错误：工具 ${toolId} 缺少 parameters schema。`);
      }
      if (!tool.toolClassification?.runtime || !Array.isArray(tool.toolClassification.capabilities) || !tool.toolClassification.risk) {
        messages.push(`错误：工具 ${toolId} 缺少结构化 toolClassification。`);
      }
    }

    for (const playbook of pkg.playbooks ?? []) {
      const playbookId = readNonEmptyString(playbook?.id);
      if (!playbookId) {
        messages.push("错误：Playbook 必须声明 id。");
        continue;
      }
      appendDuplicateDiagnostic(messages, seenPlaybookIds, playbookId, packageId || modulePath, "Playbook id");
      if (!readNonEmptyString(playbook.title) || !readNonEmptyString(playbook.prompt)) {
        messages.push(`错误：Playbook ${playbookId} 必须包含 title 和 prompt。`);
      }
    }

    diagnostics.push(createSkillDiagnostic(modulePath, pkg, messages));
  }

  return diagnostics.map((item) => ({ ...item, messages: [...item.messages] }));
}

export function refreshSkillPackages(): SkillPackage[] {
  resetSkillLoaderForTests();
  return getSkillPackages();
}

export function getSkillModelTools(): ModelToolRegistryEntry[] {
  return getSkillPackages().flatMap((pkg) =>
    (pkg.tools ?? []).map((tool) => ({
      ...tool,
      toolClassification: tool.toolClassification,
    })),
  );
}

export function getSkillPlaybooks(): AutomationPlaybook[] {
  return getSkillPackages().flatMap((pkg) =>
    (pkg.playbooks ?? []).map((playbook) => ({
      ...playbook,
      tags: [...playbook.tags],
      recommendedCapabilities: [...playbook.recommendedCapabilities],
      selectionHints: [...playbook.selectionHints],
    })),
  );
}

export function getSkillBuiltinPlaybookIds(): Set<string> {
  return new Set(getSkillPlaybooks().map((playbook) => playbook.id));
}

function ensureExecutorMap(): Map<string, SkillToolExecutor> {
  if (executorMap) {
    return executorMap;
  }
  executorMap = new Map();
  for (const pkg of getSkillPackages()) {
    if (!pkg.executeTool) {
      continue;
    }
    for (const tool of pkg.tools ?? []) {
      if (!tool?.id || !tool?.name || !pkg.executeTool) {
        continue;
      }
      // Index by registry id AND function name. Model tool calls use a random
      // toolCall.id (e.g. call_abc) with toolCall.name = metapi_list_sites.
      executorMap.set(tool.id, pkg.executeTool);
      executorMap.set(tool.name, pkg.executeTool);
    }
  }
  return executorMap;
}

export function getSkillToolExecutor(toolIdOrName: string): SkillToolExecutor | undefined {
  if (!toolIdOrName) {
    return undefined;
  }
  return ensureExecutorMap().get(toolIdOrName);
}

/**
 * Resolve and run a skill tool.
 * Lookup order: registryToolId → toolCall.name → toolCall.id
 */
export async function executeSkillTool(
  toolCall: ModelToolCall,
  fetcher?: typeof fetch,
  registryToolId?: string,
): Promise<ModelToolResult | undefined> {
  const keys = [registryToolId, toolCall.name, toolCall.id]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());

  for (const key of keys) {
    const executor = getSkillToolExecutor(key);
    if (executor) {
      return executor(toolCall, fetcher);
    }
  }
  return undefined;
}

/** Test helper: clear caches after hot package swaps. */
export function resetSkillLoaderForTests(): void {
  cachedPackages = null;
  executorMap = null;
}

function resolveSkillPackage(mod: SkillModule): SkillPackage | undefined {
  return mod.skill ?? mod.default;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function appendDuplicateDiagnostic(
  messages: string[],
  seen: Map<string, string>,
  value: string,
  owner: string,
  label: string,
): void {
  const existingOwner = seen.get(value);
  if (existingOwner) {
    messages.push(`错误：${label} 重复：${value}（${existingOwner} 与 ${owner}）。`);
    return;
  }
  seen.set(value, owner);
}

function createSkillDiagnostic(modulePath: string, pkg: SkillPackage | undefined, messages: string[]): SkillLoaderDiagnostic {
  return {
    modulePath,
    packageId: readNonEmptyString(pkg?.id) ?? "(invalid)",
    packageName: readNonEmptyString(pkg?.name) ?? "(invalid)",
    status: messages.some((message) => message.startsWith("错误：")) ? "error" : messages.length ? "warning" : "ok",
    messages,
    toolCount: pkg?.tools?.length ?? 0,
    playbookCount: pkg?.playbooks?.length ?? 0,
  };
}
