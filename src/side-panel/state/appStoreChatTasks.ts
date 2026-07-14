import type { ChatImageAttachment, ChatPromptInvocation } from "../../shared/types";

export type ChatTaskStatus = "running" | "completed" | "failed" | "canceled";

export interface ChatTaskState {
  id: string;
  sessionId: string;
  workflowTaskId?: string;
  status: ChatTaskStatus;
  startedAt: number;
  completedAt?: number;
}

export type ChatTaskMap = Record<string, ChatTaskState>;

export type ChatTaskAbortHandle = () => void;
export type ChatTaskFollowUpHandle = (followUp: {
  id: string;
  content: string;
  attachments?: ChatImageAttachment[];
  promptInvocations?: ChatPromptInvocation[];
  userMessageId?: string;
}) => void;

// 取消句柄来自流式 port 生命周期，不能安全放入可序列化的 Zustand 状态；这里作为跨 action 的运行时桥接表。
const abortHandles = new Map<string, { taskId: string; handle: ChatTaskAbortHandle }>();
const followUpHandles = new Map<string, { taskId: string; handle: ChatTaskFollowUpHandle }>();
const pendingAbortSessionIds = new Set<string>();
const consumedAbortSessionIds = new Set<string>();
const taskExecutions = new Map<string, { sessionId: string; taskId: string; settled: Promise<void>; settle: () => void }>();

function executionKey(sessionId: string, taskId: string): string {
  return `${sessionId}\u0000${taskId}`;
}

export function registerChatTaskExecution(sessionId: string, taskId: string): void {
  const key = executionKey(sessionId, taskId);
  if (taskExecutions.has(key)) {
    return;
  }

  let settle!: () => void;
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  taskExecutions.set(key, { sessionId, taskId, settled, settle });
}

export function getChatTaskExecutions(): Array<{ sessionId: string; taskId: string }> {
  return Array.from(taskExecutions.values(), ({ sessionId, taskId }) => ({ sessionId, taskId }));
}

export function settleChatTaskExecution(sessionId: string, taskId: string): void {
  const key = executionKey(sessionId, taskId);
  const execution = taskExecutions.get(key);
  if (!execution) {
    return;
  }

  taskExecutions.delete(key);
  execution.settle();
}

export async function waitForChatTaskExecutionSettlement(sessionId: string, taskId: string, timeoutMs = 15_000): Promise<void> {
  const execution = taskExecutions.get(executionKey(sessionId, taskId));
  if (!execution) {
    return;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error("等待正在运行的对话结束超时")), timeoutMs);
  });
  try {
    await Promise.race([execution.settled, timeout]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export function createChatTask(sessionId: string, now = Date.now(), workflowTaskId?: string): ChatTaskState {
  return {
    id: `chat-task-${now}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    ...(workflowTaskId ? { workflowTaskId } : {}),
    status: "running",
    startedAt: now,
  };
}

export function upsertChatTask(tasks: ChatTaskMap, task: ChatTaskState): ChatTaskMap {
  return {
    ...tasks,
    [task.sessionId]: task,
  };
}

export function finishChatTask(
  tasks: ChatTaskMap,
  sessionId: string,
  status: Exclude<ChatTaskStatus, "running">,
  now = Date.now(),
  taskId?: string,
): ChatTaskMap {
  const task = tasks[sessionId];
  if (!task || task.status !== "running") {
    return tasks;
  }
  if (taskId && task.id !== taskId) {
    return tasks;
  }

  return {
    ...tasks,
    [sessionId]: {
      ...task,
      status,
      completedAt: now,
    },
  };
}

export function clearChatTask(tasks: ChatTaskMap, sessionId: string): ChatTaskMap {
  if (!tasks[sessionId]) {
    return tasks;
  }

  const nextTasks = { ...tasks };
  delete nextTasks[sessionId];
  return nextTasks;
}

export function isSessionTaskRunning(tasks: ChatTaskMap, sessionId?: string): boolean {
  if (!sessionId) {
    return false;
  }

  return tasks[sessionId]?.status === "running";
}

export function registerChatTaskAbortHandle(sessionId: string, taskId: string, handle: ChatTaskAbortHandle): void {
  if (pendingAbortSessionIds.delete(sessionId)) {
    consumedAbortSessionIds.add(sessionId);
    handle();
    return;
  }

  abortHandles.set(sessionId, { taskId, handle });
}

export function unregisterChatTaskAbortHandle(sessionId: string, taskId?: string): void {
  const current = abortHandles.get(sessionId);
  if (!taskId || current?.taskId === taskId) {
    abortHandles.delete(sessionId);
  }
}

export function registerChatTaskFollowUpHandle(sessionId: string, taskId: string, handle: ChatTaskFollowUpHandle): void {
  followUpHandles.set(sessionId, { taskId, handle });
}

export function unregisterChatTaskFollowUpHandle(sessionId: string, taskId?: string): void {
  const current = followUpHandles.get(sessionId);
  if (!taskId || current?.taskId === taskId) {
    followUpHandles.delete(sessionId);
  }
}

export function sendChatTaskFollowUp(sessionId: string, followUp: Parameters<ChatTaskFollowUpHandle>[0]): boolean {
  const current = followUpHandles.get(sessionId);
  if (!current) {
    return false;
  }

  current.handle(followUp);
  return true;
}

export function abortChatTaskHandle(sessionId: string): boolean {
  const current = abortHandles.get(sessionId);
  if (!current) {
    if (consumedAbortSessionIds.delete(sessionId)) {
      return false;
    }
    pendingAbortSessionIds.add(sessionId);
    return true;
  }

  current.handle();
  abortHandles.delete(sessionId);
  return true;
}

export function clearChatTaskAbortHandles(): void {
  abortHandles.clear();
  followUpHandles.clear();
  pendingAbortSessionIds.clear();
  consumedAbortSessionIds.clear();
}
