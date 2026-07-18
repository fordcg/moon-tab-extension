import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, ChatToolCallRecord } from "../../shared/types";
import { derivePetState } from "../../shared/pet/derivePetState";
import {
  PET_CHAT_SEND_TYPE,
  PET_PENDING_CHAT_STORAGE_KEY,
  PET_SNAPSHOT_PUBLISH_TYPE,
  PET_SNAPSHOT_STORAGE_KEY,
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
  try {
    void chrome.runtime?.sendMessage?.(
      {
        type: PET_SNAPSHOT_PUBLISH_TYPE,
        snapshot,
      },
      () => {
        void chrome.runtime?.lastError;
      },
    );
  } catch {
    // Side panel may run outside extension runtime in unit tests.
  }
  // Direct storage write as a second path so newtab/content pick up via onChanged
  // even if the service worker is mid-restart.
  try {
    void chrome.storage?.session?.set?.({ [PET_SNAPSHOT_STORAGE_KEY]: snapshot });
  } catch {
    // ignore
  }
}

async function clearPendingPetChat(pendingId?: string): Promise<void> {
  try {
    if (!pendingId) {
      await chrome.storage?.session?.remove?.(PET_PENDING_CHAT_STORAGE_KEY);
      return;
    }
    const items = await chrome.storage?.session?.get?.(PET_PENDING_CHAT_STORAGE_KEY);
    const pending = items?.[PET_PENDING_CHAT_STORAGE_KEY] as PetPendingChat | undefined;
    if (!pending || pending.id === pendingId) {
      await chrome.storage?.session?.remove?.(PET_PENDING_CHAT_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

/**
 * Side-panel publisher + usage entry + pet chat intake.
 * The visible draggable pet lives on webpages / newtab.
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
  const [now, setNow] = useState(Date.now());
  const [completedUntil, setCompletedUntil] = useState(0);
  const [bubbleUntil, setBubbleUntil] = useState(0);
  const [prevSending, setPrevSending] = useState(false);
  const handlingPetChatRef = useRef(false);
  const handledPendingIdsRef = useRef(new Set<string>());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (prevSending && !sending) {
      const stamp = Date.now();
      setCompletedUntil(stamp + COMPLETED_HOLD_MS);
      setBubbleUntil(stamp + BUBBLE_HOLD_MS);
    }
    setPrevSending(sending);
  }, [sending, prevSending]);

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
      // One-shot memory: every pet chat starts a fresh session with pet persona.
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
    const consumePending = async () => {
      try {
        const items = await chrome.storage?.session?.get?.(PET_PENDING_CHAT_STORAGE_KEY);
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
      if ((message as { type?: string }).type !== PET_CHAT_SEND_TYPE) {
        return;
      }
      const content = String((message as { content?: unknown }).content || "");
      const pendingId = typeof (message as { pendingId?: unknown }).pendingId === "string"
        ? (message as { pendingId: string }).pendingId
        : undefined;
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
  const tools = collectRecentTools(messages);
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

  const derived = derivePetState({
    sending: sending || task?.status === "running",
    streamingText,
    tools,
    boundaryPending: Boolean(pendingBoundaryChoice),
    justCompleted: now < completedUntil || task?.status === "completed",
    isNewSession: Boolean(activeSession && messages.length === 0),
    lastActivityAt: activeSession?.updatedAt ?? now,
    lastError,
    assistantSnippet: latestAssistantSnippet(messages),
    privateMode: privateModeActive,
    muted,
    now,
  });

  // Keep status bubbles while running; spoken replies auto-dismiss after BUBBLE_HOLD_MS.
  const showBubble = Boolean(
    derived.bubble && (
      sending ||
      streamingText ||
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

  return (
    <>
      <div className="pet-side-chip" data-state={snapshot.state}>
        <button
          type="button"
          className="pet-side-chip-button"
          onClick={() => setPanelOpen(true)}
          title="打开用量面板；页面右键浮宠可对话"
        >
          <span className={`pet-side-chip-dot is-${snapshot.badge || "idle"}`} aria-hidden="true" />
          <span className="pet-side-chip-label">{snapshot.stateLabel}</span>
          <span className="pet-side-chip-hint">页面浮宠已开</span>
        </button>
        <button
          type="button"
          className="pet-side-chip-mute"
          onClick={() => setMuted((value) => !value)}
          aria-pressed={muted}
          title={muted ? "取消静音" : "静音气泡"}
        >
          {muted ? "静音" : "气泡"}
        </button>
      </div>
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
