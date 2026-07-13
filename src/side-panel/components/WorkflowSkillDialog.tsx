import { useEffect, useId, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { WorkflowSkill, WorkflowSkillVariable, WorkflowTask } from "../../shared/types";
import { useAppStore } from "../state/appStore";

type WorkflowSkillDialogProps =
  | {
      mode: "save";
      open: boolean;
      task: WorkflowTask;
      onOpenChange: (open: boolean) => void;
    }
  | {
      mode: "start";
      open: boolean;
      skill: WorkflowSkill;
      onOpenChange: (open: boolean) => void;
    };

const VARIABLE_PATTERN = /{{\s*([^{}]+?)\s*}}/g;

export function WorkflowSkillDialog(props: WorkflowSkillDialogProps) {
  const titleId = useId();
  const saveWorkflowSkill = useAppStore((state) => state.saveWorkflowSkill);
  const startWorkflowSkill = useAppStore((state) => state.startWorkflowSkill);
  const addNotification = useAppStore((state) => state.addNotification);
  const { open, onOpenChange } = props;
  const sourceTask = props.mode === "save" ? props.task : undefined;
  const sourceSkill = props.mode === "start" ? props.skill : undefined;
  const variables = useMemo(
    () => (sourceTask ? extractWorkflowSkillVariables(sourceTask.objective) : sourceSkill?.variables ?? []),
    [sourceSkill?.variables, sourceTask],
  );
  const variableSignature = variables.map((variable) => `${variable.id}:${variable.required}`).join("|");
  const initialTitle = sourceTask?.title ?? sourceSkill?.title ?? "";
  const [title, setTitle] = useState(initialTitle);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    setTitle(initialTitle);
    setVariableValues({});
    setErrorMessage("");
  }, [initialTitle, open, variableSignature]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onOpenChange, open, submitting]);

  if (!open) {
    return null;
  }

  const dialogTitle = props.mode === "save" ? "保存为技能" : "启动技能";
  const missingRequiredValue = props.mode === "start" && variables.some((variable) => variable.required && !variableValues[variable.id]?.trim());
  const canSubmit = props.mode === "save" ? Boolean(title.trim()) : !missingRequiredValue;

  const closeDialog = () => {
    if (!submitting) {
      onOpenChange(false);
    }
  };

  const submitDialog = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !canSubmit) {
      return;
    }

    setSubmitting(true);
    setErrorMessage("");
    try {
      if (props.mode === "save") {
        const skill = await saveWorkflowSkill(props.task.id, { title, variables });
        addNotification({ type: "success", title: "技能已保存", message: skill.title });
      } else {
        await startWorkflowSkill(props.skill.id, buildSkillValues(variables, variableValues));
        addNotification({ type: "success", title: "任务已启动", message: props.skill.title });
      }
      onOpenChange(false);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "任务技能操作失败";
      setErrorMessage(message);
      addNotification({ type: "error", title: props.mode === "save" ? "保存技能失败" : "启动技能失败", message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="dialog-overlay" aria-hidden="true" onClick={closeDialog} />
      <form className="workflow-skill-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submitDialog}>
        <div className="workflow-skill-dialog-header">
          <div className="workflow-skill-dialog-heading">
            <h2 className="workflow-skill-dialog-title" id={titleId}>
              {dialogTitle}
            </h2>
            <span className="workflow-skill-dialog-subtitle">{sourceTask?.title ?? sourceSkill?.title}</span>
          </div>
          <button className="workflow-skill-dialog-close" type="button" aria-label="关闭任务技能弹窗" onClick={closeDialog}>
            ×
          </button>
        </div>

        {props.mode === "save" ? (
          <>
            <label className="workflow-skill-field">
              <span className="workflow-skill-field-label">技能名称</span>
              <input
                className="workflow-skill-input"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <div className="workflow-skill-variable-group">
              <span className="workflow-skill-field-label">变量</span>
              {variables.length ? (
                <ul className="workflow-skill-variable-list">
                  {variables.map((variable) => (
                    <li className="workflow-skill-variable-item" key={variable.id}>
                      <span className="workflow-skill-variable-name">{variable.label}</span>
                      <span className="workflow-skill-variable-required">必填</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="workflow-skill-empty">无变量</span>
              )}
            </div>
          </>
        ) : (
          <div className="workflow-skill-variable-fields">
            {variables.map((variable, index) => (
              <label className="workflow-skill-field" htmlFor={`${titleId}-variable-${index}`} key={variable.id}>
                <span className="workflow-skill-field-label">{variable.label}</span>
                <input
                  id={`${titleId}-variable-${index}`}
                  className="workflow-skill-input"
                  type="text"
                  value={variableValues[variable.id] ?? ""}
                  required={variable.required}
                  onChange={(event) => setVariableValues((current) => ({ ...current, [variable.id]: event.target.value }))}
                />
              </label>
            ))}
          </div>
        )}

        {errorMessage ? <p className="workflow-skill-dialog-error" role="alert">{errorMessage}</p> : null}

        <div className="workflow-skill-dialog-actions">
          <button className="ui-button-secondary workflow-skill-dialog-button" type="button" disabled={submitting} onClick={closeDialog}>
            取消
          </button>
          <button className="ui-button-primary workflow-skill-dialog-button" type="submit" disabled={!canSubmit || submitting}>
            {props.mode === "save" ? "保存技能" : "启动技能"}
          </button>
        </div>
      </form>
    </>
  );
}

export function extractWorkflowSkillVariables(objective: string): WorkflowSkillVariable[] {
  const variables: WorkflowSkillVariable[] = [];
  const seen = new Set<string>();
  for (const match of objective.matchAll(VARIABLE_PATTERN)) {
    const id = (match[1] ?? "").trim();
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    variables.push({ id, label: id, required: true });
  }
  return variables;
}

function buildSkillValues(variables: WorkflowSkillVariable[], values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(variables.map((variable) => [variable.id, values[variable.id] ?? ""]));
}
