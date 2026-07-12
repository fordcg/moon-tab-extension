import { useEffect, useMemo, useState } from "react";

import type { ChatSession } from "../../shared/types";
import { useAppStore } from "../state/appStore";

const TAB_CONVERSATION_STATE_KEY = "sidepanel.tabConversationState.v1";
const MOVE_CONVERSATION_TTL_MS = 60 * 60 * 1000;

interface StoredTabBinding {
  sessionId?: string;
  createdAt?: number;
  updatedAt?: number;
  tabKey?: string;
}

interface StoredLastConversation {
  sessionId?: string;
  title?: string;
  lastActiveAt?: number;
  sessionUpdatedAt?: number;
  tabKey?: string;
}

interface StoredTabConversationState {
  tabBindings?: Record<string, StoredTabBinding | string>;
  lastConversation?: StoredLastConversation | string | null;
}

interface MoveConversationCandidate {
  sessionId: string;
  title: string;
  lastActiveAt: number;
  tabKey?: string;
}

export function ConversationContinuityPrompt() {
  const chatSessions = useAppStore((state) => state.chatSessions);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const privateModeActive = useAppStore((state) => state.privateModeActive);
  const sending = useAppStore((state) => state.sending);
  const selectChatSession = useAppStore((state) => state.selectChatSession);
  const tabKey = useMemo(() => getCurrentTabConversationKey(), []);
  const [candidate, setCandidate] = useState<MoveConversationCandidate | undefined>();

  useEffect(() => {
    if (privateModeActive || sending) {
      setCandidate(undefined);
      return;
    }

    setCandidate(getMoveConversationCandidate(loadTabConversationState(), chatSessions, tabKey, activeSessionId));
  }, [activeSessionId, chatSessions, privateModeActive, sending, tabKey]);

  if (!candidate) {
    return null;
  }

  const moveConversationHere = () => {
    selectChatSession(candidate.sessionId);
    rememberMovedConversation(loadTabConversationState(), tabKey, candidate);
    setCandidate(undefined);
  };

  return (
    <aside className="sidepanel-move-conversation" aria-label="继续最近对话">
      <span className="sidepanel-move-conversation-title" title={candidate.title}>
        {candidate.title}
      </span>
      <button className="sidepanel-move-conversation-button" type="button" onClick={moveConversationHere}>
        <svg className="sidepanel-move-conversation-button-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M3.5 10h10" />
          <path d="m10 5.5 4.5 4.5-4.5 4.5" />
        </svg>
        <span className="sidepanel-move-conversation-button-label">移到此处</span>
      </button>
    </aside>
  );
}

function getMoveConversationCandidate(
  state: StoredTabConversationState,
  sessions: ChatSession[],
  tabKey: string,
  activeSessionId: string,
): MoveConversationCandidate | undefined {
  const now = Date.now();
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const candidates = [
    normalizeLastConversation(state.lastConversation, sessionById),
    ...normalizeTabBindings(state.tabBindings, sessionById),
    ...sessions.map((session) => normalizeSessionCandidate(session)),
  ]
    .filter((item): item is MoveConversationCandidate => Boolean(item))
    .filter((item) => item.sessionId !== activeSessionId)
    .filter((item) => item.tabKey !== tabKey)
    .filter((item) => now - item.lastActiveAt <= MOVE_CONVERSATION_TTL_MS)
    .sort((left, right) => right.lastActiveAt - left.lastActiveAt);

  return candidates[0];
}

function normalizeLastConversation(
  lastConversation: StoredTabConversationState["lastConversation"],
  sessionById: Map<string, ChatSession>,
): MoveConversationCandidate | undefined {
  if (!lastConversation) {
    return undefined;
  }

  const sessionId = typeof lastConversation === "string" ? lastConversation : lastConversation.sessionId;
  if (!sessionId) {
    return undefined;
  }

  const session = sessionById.get(sessionId);
  if (!session || session.archived || !hasChatSessionMessages(session)) {
    return undefined;
  }

  return {
    sessionId,
    title: typeof lastConversation === "object" && lastConversation.title ? lastConversation.title : getChatSessionTitle(session),
    lastActiveAt: getFiniteTime(
      typeof lastConversation === "object" ? lastConversation.lastActiveAt : undefined,
      typeof lastConversation === "object" ? lastConversation.sessionUpdatedAt : undefined,
      session.updatedAt,
    ),
    tabKey: typeof lastConversation === "object" ? lastConversation.tabKey : undefined,
  };
}

function normalizeTabBindings(
  tabBindings: StoredTabConversationState["tabBindings"],
  sessionById: Map<string, ChatSession>,
): MoveConversationCandidate[] {
  if (!tabBindings) {
    return [];
  }

  return Object.entries(tabBindings).flatMap(([tabKey, binding]) => {
    const sessionId = typeof binding === "string" ? binding : binding.sessionId;
    if (!sessionId) {
      return [];
    }

    const session = sessionById.get(sessionId);
    if (!session || session.archived || !hasChatSessionMessages(session)) {
      return [];
    }

    return [
      {
        sessionId,
        title: getChatSessionTitle(session),
        lastActiveAt: getFiniteTime(typeof binding === "object" ? binding.updatedAt : undefined, session.updatedAt),
        tabKey,
      },
    ];
  });
}

function normalizeSessionCandidate(session?: ChatSession): MoveConversationCandidate | undefined {
  if (!session || session.archived || !hasChatSessionMessages(session)) {
    return undefined;
  }

  return {
    sessionId: session.id,
    title: getChatSessionTitle(session),
    lastActiveAt: getFiniteTime(session.updatedAt, session.createdAt),
  };
}

function rememberMovedConversation(state: StoredTabConversationState, tabKey: string, candidate: MoveConversationCandidate) {
  const now = Date.now();
  const tabBindings = { ...(state.tabBindings ?? {}) };
  tabBindings[tabKey] = {
    sessionId: candidate.sessionId,
    createdAt: now,
    updatedAt: now,
    tabKey,
  };

  saveTabConversationState({
    ...state,
    tabBindings,
    lastConversation: {
      sessionId: candidate.sessionId,
      title: candidate.title,
      lastActiveAt: now,
      sessionUpdatedAt: candidate.lastActiveAt,
      tabKey,
    },
  });
}

function getCurrentTabConversationKey(): string {
  const params = new URLSearchParams(window.location.search);
  const tabId = params.get("tabId") || params.get("sidePanelTabId");
  const windowId = params.get("windowId") || params.get("sidePanelWindowId");

  if (tabId) {
    return windowId ? `tab:${windowId}:${tabId}` : `tab:${tabId}`;
  }

  return `panel:${window.location.origin}${window.location.pathname}`;
}

function loadTabConversationState(): StoredTabConversationState {
  try {
    const parsed = JSON.parse(localStorage.getItem(TAB_CONVERSATION_STATE_KEY) || "null") as StoredTabConversationState | null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveTabConversationState(state: StoredTabConversationState) {
  try {
    localStorage.setItem(TAB_CONVERSATION_STATE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be unavailable in some embedded contexts.
  }
}

function hasChatSessionMessages(session: ChatSession): boolean {
  return session.messages.some((message) =>
    Boolean(
      message.content.trim() ||
        message.attachments?.length ||
        message.networkContextAttachment ||
        message.toolAttachments?.length ||
        message.toolCallRecords?.length ||
        message.promptInvocations?.length,
    ),
  );
}

function getChatSessionTitle(session: ChatSession): string {
  return session.title.trim() || "最近对话";
}

function getFiniteTime(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return Date.now();
}
