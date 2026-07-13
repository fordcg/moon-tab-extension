import type { WorkflowTaskTemplate } from "../../shared/types";

export const workflowTemplates: Array<{ id: WorkflowTaskTemplate; label: string; description: string }> = [
  { id: "debug", label: "开发调试", description: "分析页面、接口和源码线索" },
  { id: "research", label: "网页研究", description: "提取、比较并整理网页信息" },
  { id: "automation", label: "网页自动化", description: "执行页面操作并核验结果" },
];

interface WorkflowTemplateMenuProps {
  onSelect: (template: WorkflowTaskTemplate) => void;
}

export function WorkflowTemplateMenu({ onSelect }: WorkflowTemplateMenuProps) {
  return (
    <div className="workflow-template-menu" role="menu" aria-label="任务模板">
      {workflowTemplates.map((template) => (
        <button
          key={template.id}
          className="workflow-template-option"
          type="button"
          role="menuitem"
          onClick={() => onSelect(template.id)}
        >
          <span className="workflow-template-option-title">{template.label}</span>
          <span className="workflow-template-option-description">{template.description}</span>
        </button>
      ))}
    </div>
  );
}
