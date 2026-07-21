import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, ChatToolCallRecord } from "../../shared/types";
import { derivePetState } from "../../shared/pet/derivePetState";
import {
  PET_CHAT_SEND_TYPE,
  PET_PENDING_CHAT_STORAGE_KEY,
  PET_SNAPSHOT_PUBLISH_TYPE,
  PET_SNAPSHOT_STORAGE_KEY,
  PET_VISIBLE_STORAGE_KEY,
  petStateLabel,
  type PetPendingChat,
  type PetRuntimeSnapshot,
} from "../../shared/pet/runtime";
import { useAppStore } from "../state/appStore";
import { PetUsagePanel } from "./PetUsagePanel";

const COMPLETED_HOLD_MS = 4_000;
/** Spoken reply bubble stays for 30s after the turn finishes, then auto-hides. */
const BUBBLE_HOLD_MS = 30_000;
const PET_CHAT_SYSTEM_PROMPT = [
  "你是「月标签」侧栏里的桌面宠物猫娘。",
  "说话用第一人称，口吻温柔、俏皮、简短，可少量使用「喵」或「～」，不要刷屏卖萌。",
  "回答要简洁：默认 1～3 句，尽量不超过 80 个汉字；除非用户明确要求详细展开。",
  "优先直接给结论，少客套、少复读用户原话。",
  "不要输出 Markdown 标题、代码围栏或长列表；需要列举时最多 3 点，用短句。",
  "如果在用工具，先简短说明在做什么，完成后再用一句话汇报结果。",
].join("\n");

function collectRecentTools(messages: ChatMessage[], limit = 8): ChatToolCallRecord[] {
  const records: ChatToolCallRecord[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message?.toolCallRecords?.length) {
      continue;
    }
    for (let recordIndex = message.toolCallRecords.length - 1; recordIndex >= 0; recordIndex -= 1) {
      records.push(message.toolCallRecords[recordIndex]);
      if (records.length >= limit) {
        return records.reverse();
      }
    }
  }
  return records.reverse();
}

function latestAssistantSnippet(messages: ChatMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.content?.trim()) {
      return message.content.trim();
    }
  }
  return undefined;
}

function publishPetSnapshot(snapshot: PetRuntimeSnapshot): void {
  const runtime = globalThis.chrome?.runtime;
  const storage = globalThis.chrome?.storage;
  try {
    void runtime?.sendMessage?.(
      {
        type: PET_SNAPSHOT_PUBLISH_TYPE,
        snapshot,
      },
      () => {
        void runtime?.lastError;
      },
    );
  } catch {
    // Side panel may run outside extension runtime in unit tests.
  }
  try {
    void storage?.session?.set?.({ [PET_SNAPSHOT_STORAGE_KEY]: snapshot });
  } catch {
    // ignore
  }
}

async function clearPendingPetChat(pendingId?: string): Promise<void> {
  const storage = globalThis.chrome?.storage;
  try {
    if (!pendingId) {
      await storage?.session?.remove?.(PET_PENDING_CHAT_STORAGE_KEY);
      return;
    }
    const items = await storage?.session?.get?.(PET_PENDING_CHAT_STORAGE_KEY);
    const pending = items?.[PET_PENDING_CHAT_STORAGE_KEY] as PetPendingChat | undefined;
    if (!pending || pending.id === pendingId) {
      await storage?.session?.remove?.(PET_PENDING_CHAT_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

function mergeToolRecords(base: ChatToolCallRecord[], live: ChatToolCallRecord[]): ChatToolCallRecord[] {
  const map = new Map<string, ChatToolCallRecord>();
  for (const record of base) {
    map.set(record.id, record);
  }
  for (const record of live) {
    map.set(record.id, record);
  }
  return Array.from(map.values()).slice(-12);
}

/**
 * Headless side-panel publisher + pet chat intake.
 * Visual pet lives on webpages/newtab; this component only syncs mood and handles pet chats.
 */
export function PetCompanion() {
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const chatSessions = useAppStore((state) => state.chatSessions);
  const privateModeActive = useAppStore((state) => state.privateModeActive);
  const privateChatSession = useAppStore((state) => state.privateChatSession);
  const sending = useAppStore((state) => state.sending);
  const pendingBoundaryChoice = useAppStore((state) => state.pendingBoundaryChoice);
  const chatTasksBySessionId = useAppStore((state) => state.chatTasksBySessionId);
  const createChatSession = useAppStore((state) => state.createChatSession);
  const sendChatMessage = useAppStore((state) => state.sendChatMessage);
  const loadChatData = useAppStore((state) => state.loadChatData);
  const syncRestoreBarrierActive = useAppStore((state) => state.syncRestoreBarrierActive);
  const [panelOpen, setPanelOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [petVisible, setPetVisible] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [completedUntil, setCompletedUntil] = useState(0);
  const [bubbleUntil, setBubbleUntil] = useState(0);
  const [prevSending, setPrevSending] = useState(false);
  const [liveTools, setLiveTools] = useState<ChatToolCallRecord[]>([]);
  const handlingPetChatRef = useRef(false);
  const handledPendingIdsRef = useRef(new Set<string>());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const storage = globalThis.chrome?.storage;
    void storage?.local?.get?.(PET_VISIBLE_STORAGE_KEY)?.then((items) => {
      if (items?.[PET_VISIBLE_STORAGE_KEY] === false) {
        setPetVisible(false);
      }
    }).catch(() => undefined);
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && PET_VISIBLE_STORAGE_KEY in changes) {
        setPetVisible(changes[PET_VISIBLE_STORAGE_KEY]?.newValue !== false);
      }
    };
    storage?.onChanged?.addListener?.(onChanged);
    return () => storage?.onChanged?.removeListener?.(onChanged);
  }, []);

  useEffect(() => {
    if (prevSending && !sending) {
      const stamp = Date.now();
      setCompletedUntil(stamp + COMPLETED_HOLD_MS);
      setBubbleUntil(stamp + BUBBLE_HOLD_MS);
      setLiveTools([]);
    }
    setPrevSending(sending);
  }, [sending, prevSending]);

  // Live tool events arrive faster than session persistence; merge them for pet mood.
  useEffect(() => {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.onMessage?.addListener) {
      return;
    }
    const onMessage = (message: unknown) => {
      if (!message || typeof message !== "object" || !("type" in message)) {
        return;
      }
      if ((message as { type?: string }).type !== "automation.live") {
        return;
      }
      const payload = (message as { payload?: unknown }).payload;
      if (!payload || typeof payload !== "object" || !("type" in payload)) {
        return;
      }
      const eventType = (payload as { type?: string }).type;
      if (eventType === "tool:start" || eventType === "tool:complete") {
        const record = (payload as { record?: ChatToolCallRecord }).record;
        if (!record?.id) {
          return;
        }
        setLiveTools((current) => mergeToolRecords(current, [record]));
        if (eventType === "tool:start") {
          setBubbleUntil(Date.now() + BUBBLE_HOLD_MS);
        }
      }
      if (eventType === "complete" || eventType === "error" || eventType === "canceled") {
        setLiveTools([]);
      }
    };
    runtime.onMessage.addListener(onMessage);
    return () => runtime.onMessage.removeListener?.(onMessage);
  }, []);

  const handlePetChat = async (content: string, pendingId?: string) => {
    const text = content.trim();
    if (!text || handlingPetChatRef.current || syncRestoreBarrierActive) {
      return;
    }
    if (pendingId && handledPendingIdsRef.current.has(pendingId)) {
      return;
    }
    if (pendingId) {
      handledPendingIdsRef.current.add(pendingId);
    }
    handlingPetChatRef.current = true;
    try {
      await createChatSession({
        preserveSelectedModel: true,
        title: "宠物对话",
        chatPreferenceOverrides: {
          systemPrompt: PET_CHAT_SYSTEM_PROMPT,
        },
      });
      await sendChatMessage(text);
      await clearPendingPetChat(pendingId);
    } catch {
      if (pendingId) {
        handledPendingIdsRef.current.delete(pendingId);
      }
    } finally {
      handlingPetChatRef.current = false;
    }
  };

  useEffect(() => {
    let cancelled = false;
    const storage = globalThis.chrome?.storage;
    const consumePending = async () => {
      try {
        const items = await storage?.session?.get?.(PET_PENDING_CHAT_STORAGE_KEY);
        const pending = items?.[PET_PENDING_CHAT_STORAGE_KEY] as PetPendingChat | undefined;
        if (!pending?.content || cancelled) {
          return;
        }
        await handlePetChat(pending.content, pending.id);
      } catch {
        // ignore
      }
    };

    void loadChatData().then(() => {
      if (!cancelled) {
        void consumePending();
      }
    });

    const runtime = globalThis.chrome?.runtime;
    const onMessage = (message: unknown) => {
      if (!message || typeof message !== "object" || !("type" in message)) {
        return;
      }
      const petMessage = message as { type?: string; content?: unknown; pendingId?: unknown };
      if (petMessage.type !== PET_CHAT_SEND_TYPE) {
        return;
      }
      const content = String(petMessage.content || "");
      const pendingId = typeof petMessage.pendingId === "string" ? petMessage.pendingId : undefined;
      void handlePetChat(content, pendingId);
    };
    runtime?.onMessage?.addListener?.(onMessage);
    return () => {
      cancelled = true;
      runtime?.onMessage?.removeListener?.(onMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadChatData, syncRestoreBarrierActive]);

  const activeSession = useMemo(() => {
    if (privateModeActive && privateChatSession) {
      return privateChatSession;
    }
    return chatSessions.find((session) => session.id === activeSessionId);
  }, [activeSessionId, chatSessions, privateChatSession, privateModeActive]);

  const messages = activeSession?.messages ?? [];
  const storeTools = collectRecentTools(messages);
  const tools = mergeToolRecords(storeTools, liveTools);
  const task = activeSessionId ? chatTasksBySessionId[activeSessionId] : undefined;
  const lastMessage = messages[messages.length - 1];
  const streamingText = Boolean(
    sending && lastMessage?.role === "assistant" && (lastMessage.content?.trim().length ?? 0) > 0,
  );
  const failedTool = [...tools].reverse().find((tool) => tool.status === "error");
  const lastError =
    task?.status === "failed"
      ? "任务失败"
      : failedTool?.errorMessage || (failedTool ? `${failedTool.displayName || failedTool.name} 失败` : null);
  const hasRunningTools = tools.some((tool) => tool.status === "running");

  const derived = derivePetState({
    sending: sending || task?.status === "running",
    streamingText,
    tools,
    boundaryPending: Boolean(pendingBoundaryChoice),
    justCompleted: !hasRunningTools && (now < completedUntil || task?.status === "completed"),
    isNewSession: Boolean(activeSession && messages.length === 0),
    lastActivityAt: activeSession?.updatedAt ?? now,
    lastError,
    assistantSnippet: latestAssistantSnippet(messages),
    privateMode: privateModeActive,
    muted,
    now,
  });

  const showBubble = Boolean(
    derived.bubble && (
      sending ||
      streamingText ||
      hasRunningTools ||
      task?.status === "running" ||
      Boolean(pendingBoundaryChoice) ||
      Boolean(lastError) ||
      now < bubbleUntil
    ),
  );

  const snapshot: PetRuntimeSnapshot = useMemo(
    () => ({
      state: derived.state,
      bubble: showBubble ? derived.bubble : undefined,
      badge: derived.badge,
      toolLabel: derived.toolLabel,
      stateLabel: petStateLabel(derived.state),
      muted,
      updatedAt: now,
    }),
    [derived.badge, derived.bubble, derived.state, derived.toolLabel, muted, now, showBubble],
  );

  useEffect(() => {
    publishPetSnapshot(snapshot);
  }, [snapshot]);

  const restorePet = () => {
    setPetVisible(true);
    void globalThis.chrome?.storage?.local?.set?.({ [PET_VISIBLE_STORAGE_KEY]: true }).catch(() => undefined);
  };

  // Restore entry sits in the top-right icon cluster when the page pet is hidden.
  return (
    <>
      {!petVisible ? (
        <button
          type="button"
          className="ui-button-secondary app-header-icon-button"
          onClick={restorePet}
          aria-label="显示宠物"
          title="重新显示页面浮宠"
        >
          <svg className="app-header-icon" viewBox="0 0 24 24" aria-hidden="true">
            {/* Clean cat mark: upright ears + rounded head + solid eyes */}
            <path d="M7.5 9.6 5.8 5.2 10.4 7.5" />
            <path d="m16.5 9.6 1.7-4.4-4.6 2.3" />
            <ellipse cx="12" cy="13.2" rx="5.4" ry="5" />
            <circle cx="9.7" cy="12.6" r="0.9" fill="currentColor" stroke="none" />
            <circle cx="14.3" cy="12.6" r="0.9" fill="currentColor" stroke="none" />
            <path d="M10.4 15.2c.45.55 1 .85 1.6.85s1.15-.3 1.6-.85" />
          </svg>
        </button>
      ) : null}
      {panelOpen ? (
        <PetUsagePanel
          sessions={chatSessions}
          activeSessionId={activeSessionId}
          onClose={() => setPanelOpen(false)}
        />
      ) : null}
    </>
  );
}
