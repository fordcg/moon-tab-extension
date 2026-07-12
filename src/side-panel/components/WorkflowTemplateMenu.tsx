import { useEffect, useRef, useState } from "react";
import type { WorkflowTaskTemplate } from "../../shared/types";

export const workflowTemplates: Array<{ id: WorkflowTaskTemplate; label: string; description: string }> = [
  { id: "debug", label: "开发调试", description: "分析页面、接口和源码线索" },
  { id: "research", label: "网页研究", description: "提取、比较并整理网页信息" },
  { id: "automation", label: "网页自动化", description: "执行页面操作并核验结果" },
];

interface WorkflowTemplateMenuProps {
  disabled?: boolean;
  onSelect: (template: WorkflowTaskTemplate) => void;
}

export function WorkflowTemplateMenu({ disabled, onSelect }: WorkflowTemplateMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      if (wrapRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const selectTemplate = (template: WorkflowTaskTemplate) => {
    setOpen(false);
    onSelect(template);
  };

  return (
    <div className="workflow-template-menu-wrap" ref={wrapRef}>
      <button
        className="composer-switch sidepanel-new-task-button"
        type="button"
        aria-label="新建任务"
        aria-haspopup="menu"
        aria-expanded={open}
        title={disabled ? "输入任务目标后可新建任务" : "新建任务"}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <svg className="composer-switch-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4l-3 4-3-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
          <path d="M8 9h8" />
          <path d="M8 12h5" />
        </svg>
      </button>
      {open ? (
        <div className="workflow-template-menu" role="menu" aria-label="任务模板">
          {workflowTemplates.map((template) => (
            <button
              key={template.id}
              className="workflow-template-option"
              type="button"
              role="menuitem"
              onClick={() => selectTemplate(template.id)}
            >
              <span className="workflow-template-option-title">{template.label}</span>
              <span className="workflow-template-option-description">{template.description}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
