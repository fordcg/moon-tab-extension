import { deleteChatSession, updateChatSession } from "../../shared/storage/repositories";
import { resolveActiveChatSessionSelection } from "./appStoreModelSelection";
import type { StoreGetter, StoreSetter } from "./appStore";

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

export function clearPendingDeleteSessionAction(input: { set: StoreSetter }): void {
  input.set({ pendingDeleteSessionId: undefined });
}
