import type { AutomationPlaybook } from "../shared/automationPlaybooks";
import type { ModelToolCall, ModelToolRegistryEntry, ModelToolResult } from "../shared/models/types";
import type { SkillPackage, SkillToolExecutor } from "./types";

type SkillModule = {
  skill?: SkillPackage;
  default?: SkillPackage;
};

// Build-time discovery: each package lives at src/skills/<id>/index.ts
const skillModules = import.meta.glob("./*/index.ts", { eager: true }) as Record<string, SkillModule>;

let cachedPackages: SkillPackage[] | null = null;
let executorMap: Map<string, SkillToolExecutor> | null = null;

export function getSkillPackages(): SkillPackage[] {
  if (cachedPackages) {
    return cachedPackages;
  }
  cachedPackages = Object.entries(skillModules)
    .map(([path, mod]) => {
      const pkg = mod.skill ?? mod.default;
      if (!pkg || typeof pkg !== "object" || !pkg.id) {
        console.warn(`[skills] skip invalid package module: ${path}`);
        return null;
      }
      return pkg;
    })
    .filter((pkg): pkg is SkillPackage => Boolean(pkg));
  return cachedPackages;
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
