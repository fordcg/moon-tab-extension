import { useState } from "react";
import type { WorkflowStepStatus, WorkflowTask, WorkflowTaskStatus } from "../../shared/types";
import { useAppStore } from "../state/appStore";
import { TaskArtifactsPanel } from "./TaskArtifactsPanel";
import { TaskContextPanel } from "./TaskContextPanel";
import { WorkflowSkillDialog } from "./WorkflowSkillDialog";

interface WorkflowTaskCardProps {
  task: WorkflowTask;
}

export function WorkflowTaskCard({ task }: WorkflowTaskCardProps) {
  const [reply, setReply] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [skillDialogOpen, setSkillDialogOpen] = useState(false);
  const sending = useAppStore((state) => state.sending);
  const addNotification = useAppStore((state) => state.addNotification);
  const sendWorkflowTaskMessage = useAppStore((state) => state.sendWorkflowTaskMessage);
  const updateWorkflowTaskStatus = useAppStore((state) => state.updateWorkflowTaskStatus);
  const abortChatTask = useAppStore((state) => state.abortChatTask);
  const canContinue = task.status === "waiting";
  const canCancel = task.status === "preparing" || task.status === "running" || task.status === "waiting";
  const canSaveSkill = task.status === "completed";

  const continueTask = async () => {
    const content = reply.trim();
    if (!content || submitting || sending) {
      return;
    }

    setSubmitting(true);
    setReply("");
    try {
      await sendWorkflowTaskMessage(task.id, content);
    } catch (error: unknown) {
      setReply(content);
      addNotification({ type: "error", title: "任务继续失败", message: error instanceof Error ? error.message : "任务继续失败" });
    } finally {
      setSubmitting(false);
    }
  };
  const cancelTask = async () => {
    abortChatTask(task.sessionId);
    await updateWorkflowTaskStatus(task.id, "canceled");
  };

  return (
    <article className="workflow-task-card" data-status={task.status}>
      <div className="workflow-task-card-header">
        <span className="workflow-task-template">{formatTemplateLabel(task.template)}</span>
        <span className="workflow-task-status" data-status={task.status}>
          {formatStatusLabel(task.status)}
        </span>
      </div>
      <h2 className="workflow-task-title">{task.title}</h2>
      {task.statusReason ? <p className="workflow-task-reason">{task.statusReason}</p> : null}
      {task.steps.length > 0 ? (
        <ol className="workflow-task-steps" aria-label={`${task.title} 步骤`}>
          {task.steps.map((step) => (
            <li className="workflow-task-step" data-status={step.status} key={step.id}>
              <span className="workflow-task-step-dot" aria-hidden="true" />
              <span className="workflow-task-step-title">{step.title}</span>
              <span className="workflow-task-step-status">{formatStepStatusLabel(step.status)}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <TaskContextPanel task={task} />
      <TaskArtifactsPanel task={task} />
      {canContinue ? (
        <div className="workflow-task-reply">
          <textarea
            className="workflow-task-reply-input"
            aria-label={`继续任务：${task.title}`}
            value={reply}
            rows={2}
            onChange={(event) => setReply(event.target.value)}
          />
          <button
            className="ui-button-primary workflow-task-continue"
            type="button"
            disabled={!reply.trim() || submitting || sending}
            onClick={() => void continueTask()}
          >
            继续
          </button>
        </div>
      ) : null}
      {canCancel || canSaveSkill ? (
        <div className="workflow-task-footer">
          {canSaveSkill ? (
            <button className="ui-button-secondary workflow-task-save-skill" type="button" onClick={() => setSkillDialogOpen(true)}>
              保存为技能
            </button>
          ) : null}
          {canCancel ? (
            <button className="ui-button-secondary workflow-task-cancel" type="button" onClick={() => void cancelTask()}>
              取消任务
            </button>
          ) : null}
        </div>
      ) : null}
      <WorkflowSkillDialog mode="save" open={skillDialogOpen} task={task} onOpenChange={setSkillDialogOpen} />
    </article>
  );
}

function formatTemplateLabel(template: WorkflowTask["template"]): string {
  switch (template) {
    case "debug":
      return "开发调试";
    case "research":
      return "网页研究";
    case "automation":
      return "网页自动化";
    default:
      return "任务";
  }
}

function formatStatusLabel(status: WorkflowTaskStatus): string {
  switch (status) {
    case "preparing":
      return "准备中";
    case "running":
      return "执行中";
    case "waiting":
      return "等待输入";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "canceled":
      return "已取消";
    default:
      return "未知";
  }
}

function formatStepStatusLabel(status: WorkflowStepStatus): string {
  switch (status) {
    case "pending":
      return "待执行";
    case "running":
      return "执行中";
    case "completed":
      return "完成";
    case "failed":
      return "失败";
    case "skipped":
      return "跳过";
    default:
      return "";
  }
}
