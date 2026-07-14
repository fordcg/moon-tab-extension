import { createModelConfig } from "../../shared/chat/modelConfig";
import { mergeTokenUsageEntries } from "../../shared/chat/tokenUsage";
import { createTitleGenerationMessages, generateSessionTitle } from "../../shared/models/titleGeneration";
import { updateChatSession } from "../../shared/storage/repositories";
import type { ChatMessage, ChatSendDebugContext, ChatSession, ChatTokenUsageEntry } from "../../shared/types";
import type { AppState, StoreGetter, StoreSetter } from "./appStore";
import { upsertSession } from "./appStoreSessionUtils";
import { sendRuntimeMessage } from "./runtimeMessage";

interface GenerateTitleForSessionInput {
  sessionId: string;
  fallbackTitle: string;
  userContent: string;
  pageContext: string;
  assistantContent?: string;
  retryCount: number;
  get: StoreGetter;
  set: StoreSetter;
}

class RestoreCanceledTitleRequestError extends Error {}


export function hasAvailableTitleModel(state: AppState): boolean {
  const titleModel = state.models.find((model) => model.isTitleModel && model.enabled);
  const titleProvider = titleModel ? state.providers.find((provider) => provider.id === titleModel.providerId) : undefined;
  return Boolean(titleModel && titleProvider?.enabled);
}

function createTitleGenerationDebugContext(input: {
  sessionId: string;
  sessionTitle: string;
  requestMessageCount: number;
}): ChatSendDebugContext {
  const requestCreatedAt = Date.now();
  return {
    source: "title_generation",
    requestId: `title-${requestCreatedAt}-${Math.random().toString(36).slice(2, 8)}`,
    requestCreatedAt,
    requestCreatedAtIso: new Date(requestCreatedAt).toISOString(),
    requestTimeZone: getDebugTimeZone(),
    tokenUsageSource: "title",
    sessionId: input.sessionId,
    sessionTitle: input.sessionTitle,
    requestMessageCount: input.requestMessageCount,
    stream: false,
  };
}

function getDebugTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export async function generateTitleForSession(input: GenerateTitleForSessionInput): Promise<void> {
  let tokenUsageEntries: ChatTokenUsageEntry[] | undefined;
  let restoreCanceled = false;
  try {
    const state = input.get();
    const titleModel = state.models.find((model) => model.isTitleModel && model.enabled);
    const titleProvider = titleModel ? state.providers.find((provider) => provider.id === titleModel.providerId) : undefined;
    if (!titleModel || !titleProvider?.enabled) {
      await clearTitleGenerating(input);
      return;
    }

    const titleModelConfig = createModelConfig(titleProvider, titleModel);
    const titleMessages = createTitleGenerationMessages({
      userContent: input.userContent,
      pageContext: input.pageContext,
      assistantContent: input.assistantContent,
    }).map((message) => ({
      ...message,
      modelId: titleModel.id,
      endpointType: titleProvider.endpointType,
      systemPrompt: titleModel.systemPrompt,
    }));

    const title = await generateSessionTitle({
      fallbackTitle: input.fallbackTitle,
      messages: titleMessages,
      titleModel: titleModelConfig,
      retryCount: input.retryCount,
      requestTitle: async (model, messages, retryCount) => {
        const response = await sendRuntimeMessage<{ ok: true; content: string; tokenUsageEntries?: ChatTokenUsageEntry[] } | { ok: false; message: string; restoreCanceled?: boolean } | undefined>({
          type: "chat.send",
          model,
          messages,
          stream: false,
          retryCount,
          tokenUsageSource: "title",
          workspaceRequestLoggingEnabled: false,
          debugContext: createTitleGenerationDebugContext({
            sessionId: input.sessionId,
            sessionTitle: input.fallbackTitle,
            requestMessageCount: messages.length,
          }),
        });
        if (response?.ok === false && response.restoreCanceled) {
          restoreCanceled = true;
          throw new RestoreCanceledTitleRequestError();
        }
        if (!response?.ok) {
          throw new Error(response?.message ?? "标题生成失败");
        }

        tokenUsageEntries = response.tokenUsageEntries;
        return response.content;
      },
    });

    if (restoreCanceled || input.get().syncRestoreBarrierActive) {
      return;
    }
    await updateGeneratedTitle(input, title, tokenUsageEntries);
  } catch (error) {
    if (error instanceof RestoreCanceledTitleRequestError) {
      return;
    }
    await clearTitleGenerating(input);
  }
}

export async function generateTitleFromSavedPrivateSession(input: { session: ChatSession; get: StoreGetter; set: StoreSetter }): Promise<void> {
  let tokenUsageEntries: ChatTokenUsageEntry[] | undefined;
  let restoreCanceled = false;
  try {
    const state = input.get();
    const titleModel = state.models.find((model) => model.isTitleModel && model.enabled);
    const titleProvider = titleModel ? state.providers.find((provider) => provider.id === titleModel.providerId) : undefined;
    if (!titleModel || !titleProvider?.enabled) {
      return;
    }

    const titleModelConfig = createModelConfig(titleProvider, titleModel);
    const titleMessages = createTitleGenerationMessages({
      userContent: formatSessionMessagesForTitle(input.session.messages),
      pageContext: state.appendPageContextToSystemPrompt ? state.pageContext.text : "",
    }).map((message) => ({
      ...message,
      modelId: titleModel.id,
      endpointType: titleProvider.endpointType,
      systemPrompt: titleModel.systemPrompt,
    }));
    const title = await generateSessionTitle({
      fallbackTitle: input.session.title,
      messages: titleMessages,
      titleModel: titleModelConfig,
      retryCount: state.chatPreferences.aiRequestRetryCount,
      requestTitle: async (model, messages, retryCount) => {
        const response = await sendRuntimeMessage<{ ok: true; content: string; tokenUsageEntries?: ChatTokenUsageEntry[] } | { ok: false; message: string; restoreCanceled?: boolean } | undefined>({
          type: "chat.send",
          model,
          messages,
          stream: false,
          retryCount,
          tokenUsageSource: "title",
          workspaceRequestLoggingEnabled: false,
          debugContext: createTitleGenerationDebugContext({
            sessionId: input.session.id,
            sessionTitle: input.session.title,
            requestMessageCount: messages.length,
          }),
        });
        if (response?.ok === false && response.restoreCanceled) {
          restoreCanceled = true;
          throw new RestoreCanceledTitleRequestError();
        }
        if (!response?.ok) {
          throw new Error(response?.message ?? "标题生成失败");
        }

        tokenUsageEntries = response.tokenUsageEntries;
        return response.content;
      },
    });

    if (restoreCanceled || input.get().syncRestoreBarrierActive) {
      return;
    }
    await updateSavedPrivateSessionTitle({
      sessionId: input.session.id,
      title,
      tokenUsageEntries,
      set: input.set,
    });
  } catch (error) {
    if (error instanceof RestoreCanceledTitleRequestError) {
      return;
    }
    // 隐私会话已完成保存；标题生成失败时保留原标题，避免影响用户显式保存结果。
  }
}

function formatSessionMessagesForTitle(messages: ChatMessage[]): string {
  return messages
    .filter((message) => message.role !== "system" && message.content.trim())
    .map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content.trim()}`)
    .join("\n\n");
}

async function updateSavedPrivateSessionTitle(input: { sessionId: string; title: string; tokenUsageEntries?: ChatTokenUsageEntry[]; set: StoreSetter }): Promise<void> {
  const updatedSession = await updateChatSession(input.sessionId, (latestSession) => ({
    ...latestSession,
    title: input.title,
    titleGenerating: false,
    tokenUsageEntries: mergeTokenUsageEntries(latestSession.tokenUsageEntries, input.tokenUsageEntries),
  }));
  if (!updatedSession) {
    return;
  }

  input.set((current) => ({
    chatSessions: upsertSession(current.chatSessions, updatedSession),
  }));
}

async function updateGeneratedTitle(input: GenerateTitleForSessionInput, title: string, tokenUsageEntries?: ChatTokenUsageEntry[]): Promise<void> {
  const updatedSession = await updateChatSession(input.sessionId, (latestSession) => {
    const nextTokenUsageEntries = mergeTokenUsageEntries(latestSession.tokenUsageEntries, tokenUsageEntries);
    if (latestSession.title !== input.fallbackTitle) {
      return { ...latestSession, titleGenerating: false, tokenUsageEntries: nextTokenUsageEntries };
    }

    return {
      ...latestSession,
      title,
      titleGenerating: false,
      tokenUsageEntries: nextTokenUsageEntries,
    };
  });
  if (!updatedSession) {
    return;
  }

  input.set((current) => updateGeneratedTitleInState(current, updatedSession));
}

async function clearTitleGenerating(input: GenerateTitleForSessionInput): Promise<void> {
  await updateGeneratedTitle(input, input.fallbackTitle);
}

function updateGeneratedTitleInState(
  state: AppState,
  updatedSession: ChatSession,
): Partial<AppState> {
  const currentSession = state.chatSessions.find((session) => session.id === updatedSession.id);
  if (!currentSession) {
    return {};
  }

  return {
    chatSessions: upsertSession(state.chatSessions, {
      ...currentSession,
      title: updatedSession.title,
      titleGenerating: false,
      tokenUsageEntries: updatedSession.tokenUsageEntries,
    }),
  };
}
