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
      executorMap.set(tool.id, pkg.executeTool);
    }
  }
  return executorMap;
}

export function getSkillToolExecutor(toolId: string): SkillToolExecutor | undefined {
  return ensureExecutorMap().get(toolId);
}

export async function executeSkillTool(
  toolCall: ModelToolCall,
  fetcher?: typeof fetch,
): Promise<ModelToolResult | undefined> {
  const toolId = typeof toolCall.id === "string" ? toolCall.id : "";
  const executor = toolId ? getSkillToolExecutor(toolId) : undefined;
  if (!executor) {
    return undefined;
  }
  return executor(toolCall, fetcher);
}

/** Test helper: clear caches after hot package swaps. */
export function resetSkillLoaderForTests(): void {
  cachedPackages = null;
  executorMap = null;
}
