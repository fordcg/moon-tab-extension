import * as Dialog from "@radix-ui/react-dialog";
import type { ChatSessionBatchPartition } from "../state/appStoreChatSessions";

export type SessionBatchOperation = "archive" | "delete" | "cleanup_old_archived";

interface SessionBatchControlsProps {
  partition: ChatSessionBatchPartition;
  selectedCount: number;
  pending: boolean;
  oldArchivedCount?: number;
  confirmOperation?: SessionBatchOperation;
  onPartitionChange: (partition: ChatSessionBatchPartition) => void;
  onRequestOperation: (operation: SessionBatchOperation) => void;
  onCancelConfirm: () => void;
  onConfirm: () => void;
}

export function SessionBatchControls({
  partition,
  selectedCount,
  pending,
  oldArchivedCount = 0,
  confirmOperation,
  onPartitionChange,
  onRequestOperation,
  onCancelConfirm,
  onConfirm,
}: SessionBatchControlsProps) {
  const confirmArchive = confirmOperation === "archive";
  const confirmCleanup = confirmOperation === "cleanup_old_archived";
  const dialogTitle = confirmArchive
    ? "确认批量归档"
    : confirmCleanup
      ? "确认清理旧归档"
      : "确认批量删除";
  const dialogDescription = confirmArchive
    ? `确定归档选中的 ${selectedCount} 个会话吗？`
    : confirmCleanup
      ? `确定删除 ${oldArchivedCount} 个超过 7 天的已归档会话吗？删除后无法恢复。`
      : `确定删除选中的 ${selectedCount} 个会话吗？删除后无法恢复。`;

  return (
    <>
      <section className="session-batch-controls" aria-label="批量操作">
        <div className="session-batch-partitions" role="group" aria-label="批量操作分区">
          <button
            className="session-batch-partition"
            type="button"
            aria-pressed={partition === "active"}
            disabled={pending}
            onClick={() => onPartitionChange("active")}
          >
            未归档
          </button>
          <button
            className="session-batch-partition"
            type="button"
            aria-pressed={partition === "archived"}
            disabled={pending}
            onClick={() => onPartitionChange("archived")}
          >
            已归档
          </button>
        </div>
        <span className="sr-only" aria-live="polite">已选 {selectedCount} 项</span>
        {partition === "active" ? (
          <button
            className="ui-button-secondary session-batch-action session-batch-archive"
            type="button"
            disabled={pending || selectedCount === 0}
            onClick={() => onRequestOperation("archive")}
          >
            归档 {selectedCount}
          </button>
        ) : (
          <button
            className="ui-button-secondary session-batch-action session-batch-archive"
            type="button"
            disabled={pending || oldArchivedCount === 0}
            onClick={() => onRequestOperation("cleanup_old_archived")}
            title="删除更新时间超过 7 天的已归档会话"
          >
            清理7天前 {oldArchivedCount}
          </button>
        )}
        <button
          className="ui-button-secondary session-batch-action session-batch-delete"
          type="button"
          disabled={pending || selectedCount === 0}
          onClick={() => onRequestOperation("delete")}
        >
          删除 {selectedCount}
        </button>
      </section>
      <Dialog.Root
        open={Boolean(confirmOperation)}
        onOpenChange={(open) => {
          if (!open && !pending) {
            onCancelConfirm();
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="session-batch-confirm-dialog">
            <Dialog.Title className="session-batch-confirm-title">{dialogTitle}</Dialog.Title>
            <Dialog.Description className="session-batch-confirm-description">
              {dialogDescription}
            </Dialog.Description>
            <div className="session-batch-confirm-actions">
              <button className="ui-button-secondary" type="button" disabled={pending} onClick={onCancelConfirm}>
                取消
              </button>
              <button className="ui-button-primary" type="button" disabled={pending} onClick={onConfirm}>
                {pending ? "处理中..." : confirmArchive ? "确认归档" : confirmCleanup ? "确认清理" : "确认删除"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
