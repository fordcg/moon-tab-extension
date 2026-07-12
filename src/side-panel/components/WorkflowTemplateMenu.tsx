import type { WorkflowTaskTemplate } from "../../shared/types";
export const workflowTemplates: Array<{ id: WorkflowTaskTemplate; label: string; description: string }> = [
  { id: "debug", label: "开发调试", description: "分析页面、接口和源码线索" },
  { id: "research", label: "网页研究", description: "提取、比较并整理网页信息" },
  { id: "automation", label: "网页自动化", description: "执行页面操作并核验结果" },
];
export function WorkflowTemplateMenu({ onSelect }: { onSelect: (template: WorkflowTaskTemplate) => void }) { return <div role="menu" className="workflow-template-menu">{workflowTemplates.map((template) => <button key={template.id} type="button" role="menuitem" onClick={() => onSelect(template.id)}><span>{template.label}</span><small>{template.description}</small></button>)}</div>; }
