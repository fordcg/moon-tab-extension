import { archiveChatSessions, deleteChatSession, deleteChatSessions, updateChatSession } from "../../shared/storage/repositories";
import { clearChatTask, isSessionTaskRunning } from "./appStoreChatTasks";
import { resolveActiveChatSessionSelection } from "./appStoreModelSelection";
import type { StoreGetter, StoreSetter } from "./appStore";

export type ChatSessionBatchPartition = "active" | "archived";

export async function renameChatSessionAction(input: {
  sessionId: string;
  title: string;
  get: StoreGetter;
  set: StoreSetter;
}): Promise<void> {
  const trimmedTitle = input.title.trim();
  if (!trimmedTitle) {
    return;
  }

  const session = input.get().chatSessions.find((item) => item.id === input.sessionId);
  if (!session) {
    return;
  }

  const updatedSession = await updateChatSession(session.id, (latestSession) => ({
    ...latestSession,
    title: trimmedTitle,
    titleGenerating: false,
    updatedAt: Math.max(Date.now(), latestSession.updatedAt + 1),
  }));
  if (updatedSession) {
    input.set((state) => ({
      chatSessions: state.chatSessions.map((item) => item.id === input.sessionId
        ? {
            ...item,
            title: updatedSession.title,
            titleGenerating: updatedSession.titleGenerating,
            updatedAt: Math.max(item.updatedAt, updatedSession.updatedAt),
          }
        : item),
    }));
  }
}

export async function archiveChatSessionAction(input: {
  sessionId: string;
  get: StoreGetter;
  set: StoreSetter;
}): Promise<void> {
  const session = input.get().chatSessions.find((item) => item.id === input.sessionId);
  if (!session) {
    return;
  }

  const updatedSession = await updateChatSession(session.id, (latestSession) => ({
    ...latestSession,
    archived: true,
    updatedAt: Math.max(Date.now(), latestSession.updatedAt + 1),
  }));
  input.set((state) => ({
    chatSessions: updatedSession
      ? state.chatSessions.map((item) => item.id === input.sessionId
          ? { ...item, archived: true, updatedAt: Math.max(item.updatedAt, updatedSession.updatedAt) }
          : item)
      : state.chatSessions,
    pendingDeleteSessionId: undefined,
  }));
}

export function requestDeleteChatSessionAction(input: { sessionId: string; set: StoreSetter }): void {
  input.set({ pendingDeleteSessionId: input.sessionId });
}

export async function confirmDeleteChatSessionAction(input: {
  sessionId: string;
  set: StoreSetter;
}): Promise<void> {
  await deleteChatSession(input.sessionId);
  input.set((state) => {
    const chatSessions = state.chatSessions.filter((session) => session.id !== input.sessionId);
    const selection = resolveActiveChatSessionSelection(state, chatSessions);
    const activeSession = chatSessions.find((session) => session.id === selection.activeSessionId);
    return {
      chatSessions,
      ...selection,
      pendingDeleteSessionId: undefined,
      ...(!activeSession || activeSession.messages.length === 0
        ? {
            contextTabs: [],
            contextTabsLoading: false,
            contextTabsError: undefined,
          }
        : {}),
    };
  });
}


export async function archiveChatSessionsAction(input: {
  sessionIds: string[];
  get: StoreGetter;
  set: StoreSetter;
}): Promise<boolean> {
  const sessionIds = resolveEligibleSessionIds(input.sessionIds, input.get, false);
  if (sessionIds.length === 0) {
    return false;
  }

  try {
    const archivedSessions = await archiveChatSessions(sessionIds);
    const archivedSessionsById = new Map(archivedSessions.map((session) => [session.id, session]));
    input.set((state) => ({
      chatSessions: state.chatSessions.map((session) => archivedSessionsById.get(session.id) ?? session),
      pendingDeleteSessionId: undefined,
      failure: undefined,
    }));
    return archivedSessions.length > 0;
  } catch {
    input.set({ failure: { message: "批量归档失败，请重试" } });
    return false;
  }
}

export async function deleteChatSessionsAction(input: {
  sessionIds: string[];
  partition: ChatSessionBatchPartition;
  get: StoreGetter;
  set: StoreSetter;
}): Promise<boolean> {
  if (input.partition !== "active" && input.partition !== "archived") {
    return false;
  }

  const sessionIds = resolveEligibleSessionIds(input.sessionIds, input.get, input.partition === "archived");
  if (sessionIds.length === 0) {
    return false;
  }

  for (const sessionId of sessionIds) {
    input.get().abortChatTask(sessionId);
  }

  try {
    await deleteChatSessions(sessionIds);
  } catch {
    input.set({ failure: { message: "批量删除失败，请重试" } });
    return false;
  }

  const deletedSessionIds = new Set(sessionIds);
  input.set((state) => {
    const chatSessions = state.chatSessions.filter((session) => !deletedSessionIds.has(session.id));
    const selection = resolveActiveChatSessionSelection(state, chatSessions);
    const activeSession = chatSessions.find((session) => session.id === selection.activeSessionId);
    let chatTasksBySessionId = state.chatTasksBySessionId;
    const dismissedChatTaskIdsBySessionId = { ...state.dismissedChatTaskIdsBySessionId };
    const followUpsBySessionId = { ...state.followUpsBySessionId };
    for (const sessionId of deletedSessionIds) {
      chatTasksBySessionId = clearChatTask(chatTasksBySessionId, sessionId);
      delete dismissedChatTaskIdsBySessionId[sessionId];
      delete followUpsBySessionId[sessionId];
    }

    return {
      chatSessions,
      ...selection,
      chatTasksBySessionId,
      dismissedChatTaskIdsBySessionId,
      followUpsBySessionId,
      pendingDeleteSessionId: undefined,
      failure: undefined,
      sending: isSessionTaskRunning(chatTasksBySessionId, selection.activeSessionId),
      ...(!activeSession || activeSession.messages.length === 0
        ? {
            contextTabs: [],
            contextTabsLoading: false,
            contextTabsError: undefined,
          }
        : {}),
    };
  });
  return true;
}

function resolveEligibleSessionIds(sessionIds: string[], get: StoreGetter, archived: boolean): string[] {
  const requestedSessionIds = new Set(
    sessionIds
      .filter((sessionId) => typeof sessionId === "string")
      .map((sessionId) => sessionId.trim())
      .filter(Boolean),
  );
  return get().chatSessions
    .filter((session) => session.archived === archived && requestedSessionIds.has(session.id))
    .map((session) => session.id);
}

export function clearPendingDeleteSessionAction(input: { set: StoreSetter }): void {
  input.set({ pendingDeleteSessionId: undefined });
}
