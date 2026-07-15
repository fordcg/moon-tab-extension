import type { AutomationPlaybook } from "../shared/automationPlaybooks";
import type { ModelToolCall, ModelToolClassification, ModelToolRegistryEntry, ModelToolResult } from "../shared/models/types";

export type SkillToolDefinition = Omit<ModelToolRegistryEntry, "toolClassification"> & {
  toolClassification: ModelToolClassification;
};

export type SkillToolExecutor = (
  toolCall: ModelToolCall,
  fetcher?: typeof fetch,
) => Promise<ModelToolResult>;

/**
 * A skill package is self-contained: playbooks + API tools + executor + optional scripts.
 * Core registry/runtime only load and dispatch packages; they should not hardcode skill details.
 */
export interface SkillPackage {
  id: string;
  name: string;
  description?: string;
  tools?: SkillToolDefinition[];
  playbooks?: AutomationPlaybook[];
  /** Handles all tools owned by this package. */
  executeTool?: SkillToolExecutor;
}
