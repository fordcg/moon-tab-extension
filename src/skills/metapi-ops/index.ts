import type { SkillPackage } from "../types";
import { METAPI_OPS_PLAYBOOKS } from "./playbookCatalog";
import { executeMetapiTool } from "./runtime";
import { METAPI_OPS_TOOLS } from "./tools";

export const skill: SkillPackage = {
  id: "metapi-ops",
  name: "Metapi 运维",
  description: "Metapi 管理 API 工具与收录中转站策略。API 走后台 fetch/scripts，浏览器只取页面凭证。",
  tools: METAPI_OPS_TOOLS,
  playbooks: METAPI_OPS_PLAYBOOKS,
  executeTool: executeMetapiTool,
};

export default skill;
export * from "./toolIds";
