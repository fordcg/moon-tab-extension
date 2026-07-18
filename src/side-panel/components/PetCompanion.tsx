import { useEffect, useMemo, useState } from "react";
import type { ChatMessage, ChatToolCallRecord } from "../../shared/types";
import { derivePetState } from "../../shared/pet/derivePetState";
import type { PetState } from "../../shared/pet/states";
import { useAppStore } from "../state/appStore";
import { CAT_ASSET_CREDIT, resolveCatAsset } from "../pet/petAssets";
import { PetUsagePanel } from "./PetUsagePanel";

const COMPLETED_HOLD_MS = 4_000;

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

export function PetCompanion() {
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const chatSessions = useAppStore((state) => state.chatSessions);
  const privateModeActive = useAppStore((state) => state.privateModeActive);
  const privateChatSession = useAppStore((state) => state.privateChatSession);
  const sending = useAppStore((state) => state.sending);
  const pendingBoundaryChoice = useAppStore((state) => state.pendingBoundaryChoice);
  const chatTasksBySessionId = useAppStore((state) => state.chatTasksBySessionId);
  const [panelOpen, setPanelOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [poolIndex, setPoolIndex] = useState(0);
  const [completedUntil, setCompletedUntil] = useState(0);
  const [prevSending, setPrevSending] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setPoolIndex((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (prevSending && !sending) {
      setCompletedUntil(Date.now() + COMPLETED_HOLD_MS);
    }
    setPrevSending(sending);
  }, [sending, prevSending]);

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

  const snapshot = derivePetState({
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

  const asset = resolveCatAsset(snapshot.state, poolIndex);
  const stateLabel = stateTitle(snapshot.state);

  return (
    <>
      <div className="pet-companion" data-state={snapshot.state}>
        {snapshot.bubble ? (
          <div className="pet-companion-bubble" role="status" aria-live="polite">
            {snapshot.bubble}
          </div>
        ) : null}
        <button
          type="button"
          className="pet-companion-button"
          title={`${stateLabel} · 点击查看用量`}
          aria-label={`${stateLabel}，打开用量面板`}
          onClick={() => setPanelOpen(true)}
          onContextMenu={(event) => {
            event.preventDefault();
            setMuted((value) => !value);
          }}
        >
          <img className="pet-companion-img" src={asset} alt="" draggable={false} />
          <span className={`pet-companion-badge is-${snapshot.badge || "idle"}`} aria-hidden="true" />
        </button>
        <div className="pet-companion-meta">
          <span className="pet-companion-state">{stateLabel}</span>
          <button
            type="button"
            className="pet-companion-mute"
            onClick={() => setMuted((value) => !value)}
            title={muted ? "取消静音" : "静音气泡"}
            aria-pressed={muted}
          >
            {muted ? "静音" : "气泡"}
          </button>
        </div>
        <p className="pet-companion-credit" title={CAT_ASSET_CREDIT}>
          皮肤 @月薪喵
        </p>
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

function stateTitle(state: PetState): string {
  switch (state) {
    case "working":
      return "干活中";
    case "thinking":
      return "思考中";
    case "talking":
      return "回复中";
    case "juggling":
      return "并行任务";
    case "waiting":
      return "等你授权";
    case "needsinput":
      return "等你回复";
    case "happy":
      return "完成";
    case "greet":
      return "新会话";
    case "error":
      return "出错";
    case "loafing":
      return "摸鱼";
    case "roam":
      return "闲逛";
    case "sleeping":
      return "睡觉";
    case "sweeping":
      return "清理";
    case "attention":
      return "看一眼";
    default:
      return "待命";
  }
}
