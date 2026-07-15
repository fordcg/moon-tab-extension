import type { SkillPackage } from "../types";
import { METAPI_OPS_PLAYBOOKS } from "./playbookCatalog";
import { executeMetapiTool } from "./runtime";
import { METAPI_OPS_TOOLS } from "./tools";

export const skill: SkillPackage = {
  id: "metapi-ops",
  name: "Metapi 运维",
  description: "Metapi 管理 API：收录中转站、全部签到、失败补签。API 走后台 fetch/scripts，浏览器只做页面取证与补签点击。",
  tools: METAPI_OPS_TOOLS,
  playbooks: METAPI_OPS_PLAYBOOKS,
  executeTool: executeMetapiTool,
};

export default skill;
export * from "./toolIds";
