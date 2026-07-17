import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useAppStore } from "../state/appStore";
import type { ChatMessage, ChatToolCallRecord } from "../../shared/types";

type LivePhase = "idle" | "running" | "done" | "error";

function statusLabel(status: ChatToolCallRecord["status"] | "unknown"): string {
  if (status === "running") return "进行中";
  if (status === "success") return "完成";
  if (status === "error") return "失败";
  return String(status);
}

function collectRecentToolRecords(messages: ChatMessage[], limit = 10): ChatToolCallRecord[] {
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

function mergeLiveRecord(current: ChatToolCallRecord[], record: ChatToolCallRecord): ChatToolCallRecord[] {
  const next = [...current];
  const index = next.findIndex((item) => item.id === record.id);
  if (index >= 0) {
    next[index] = record;
  } else {
    next.push(record);
  }
  return next.slice(-16);
}

function shortName(record?: ChatToolCallRecord): string {
  if (!record) {
    return "";
  }
  const label = (record.displayName || record.name || "").trim();
  return label.length > 22 ? `${label.slice(0, 21)}…` : label;
}

export function AutomationHud() {
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const chatSessions = useAppStore((state) => state.chatSessions);
  const privateModeActive = useAppStore((state) => state.privateModeActive);
  const privateChatSession = useAppStore((state) => state.privateChatSession);
  const sending = useAppStore((state) => state.sending);
  const browserControlEnabled = useAppStore((state) => state.browserControlEnabled);
  const chatTasksBySessionId = useAppStore((state) => state.chatTasksBySessionId);
  const [liveRecords, setLiveRecords] = useState<ChatToolCallRecord[]>([]);
  const [liveStatus, setLiveStatus] = useState<LivePhase>("idle");
  const [now, setNow] = useState(Date.now());
  const [expanded, setExpanded] = useState(false);
  const [burstKey, setBurstKey] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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
        if (record?.id) {
          setLiveRecords((current) => mergeLiveRecord(current, record));
          setLiveStatus(eventType === "tool:start" ? "running" : record.status === "error" ? "error" : "running");
          setBurstKey((value) => value + 1);
        }
        return;
      }
      if (eventType === "complete") {
        setLiveStatus("done");
        return;
      }
      if (eventType === "error" || eventType === "canceled") {
        setLiveStatus("error");
        return;
      }
      if (eventType === "chunk" || eventType === "assistant:tool-turn") {
        setLiveStatus("running");
      }
    };
    runtime.onMessage.addListener(onMessage);
    return () => {
      runtime.onMessage.removeListener?.(onMessage);
    };
  }, []);

  const activeSession = useMemo(() => {
    if (privateModeActive && privateChatSession) {
      return privateChatSession;
    }
    return chatSessions.find((session) => session.id === activeSessionId);
  }, [activeSessionId, chatSessions, privateChatSession, privateModeActive]);

  const task = activeSessionId ? chatTasksBySessionId[activeSessionId] : undefined;
  const storeRecords = useMemo(
    () => collectRecentToolRecords(activeSession?.messages ?? [], 10),
    [activeSession?.messages, now],
  );
  const records = liveRecords.length > 0 ? liveRecords.slice(-10) : storeRecords;
  const runningCount = records.filter((item) => item.status === "running").length;
  const latest = records[records.length - 1];
  const isBusy = sending || task?.status === "running" || liveStatus === "running" || runningCount > 0;
  const phase: LivePhase = liveStatus === "error"
    ? "error"
    : isBusy
      ? "running"
      : liveStatus === "done"
        ? "done"
        : "idle";

  const headline = latest
    ? shortName(latest)
    : isBusy
      ? "模型思考中"
      : browserControlEnabled
        ? "信标待命"
        : "控制未开";

  const detail = latest?.resultSummary
    || latest?.errorMessage
    || (latest ? statusLabel(latest.status) : browserControlEnabled ? "等待下一步" : "先在侧栏开启浏览器控制");

  const sparkRecords = records.slice(-6);

  return (
    <div
      className={`signal-beacon phase-${phase}${expanded ? " is-expanded" : ""}${browserControlEnabled ? " control-on" : ""}`}
      data-browser-control={browserControlEnabled ? "on" : "off"}
      data-phase={phase}
    >
      <div className="signal-beacon-sky" aria-hidden="true">
        <span className="signal-beacon-aurora signal-beacon-aurora-a" />
        <span className="signal-beacon-aurora signal-beacon-aurora-b" />
        <span className="signal-beacon-grain" />
      </div>

      <button
        type="button"
        className="signal-beacon-core-button"
        aria-expanded={expanded}
        aria-label={expanded ? "收起步骤轨迹" : "展开步骤轨迹"}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="signal-beacon-orbit signal-beacon-orbit-outer" aria-hidden="true" />
        <span className="signal-beacon-orbit signal-beacon-orbit-mid" aria-hidden="true" />
        <span className="signal-beacon-orbit signal-beacon-orbit-inner" aria-hidden="true" />
        <span className="signal-beacon-wave signal-beacon-wave-a" aria-hidden="true" />
        <span className="signal-beacon-wave signal-beacon-wave-b" aria-hidden="true" />
        <span className="signal-beacon-core" aria-hidden="true">
          <span className="signal-beacon-core-glow" />
          <span className="signal-beacon-core-blob" />
          <span className="signal-beacon-core-eye" />
        </span>
        {sparkRecords.map((record, index) => (
          <span
            key={`${record.id}-${index}`}
            className={`signal-beacon-spark is-${record.status}`}
            style={{ "--spark-index": index, "--spark-count": sparkRecords.length } as CSSProperties}
            title={shortName(record)}
          />
        ))}
        <span key={burstKey} className="signal-beacon-burst" aria-hidden="true" />
      </button>

      <div className="signal-beacon-readout" aria-live="polite">
        <div className="signal-beacon-kicker">
          <span className="signal-beacon-pulse-dot" />
          {phase === "running" ? "LIVE" : phase === "error" ? "ALERT" : phase === "done" ? "DONE" : "STANDBY"}
          <span className="signal-beacon-sep">·</span>
          {records.length} 步
          {runningCount > 0 ? ` · ${runningCount} 执行中` : ""}
        </div>
        <div className="signal-beacon-headline">{headline}</div>
        <div className="signal-beacon-detail">{detail}</div>
      </div>

      {expanded ? (
        <div className="signal-beacon-trail" aria-label="最近步骤">
          {sparkRecords.length === 0 ? (
            <div className="signal-beacon-trail-empty">开始自动化后，火花会绕着信标飞出。</div>
          ) : (
            sparkRecords.map((record, index) => (
              <div
                key={record.id}
                className={`signal-beacon-chip is-${record.status}`}
                style={{ "--chip-index": index } as CSSProperties}
              >
                <span className="signal-beacon-chip-name">{shortName(record)}</span>
                <span className="signal-beacon-chip-status">{statusLabel(record.status)}</span>
              </div>
            ))
          )}
        </div>
      ) : null}

      <p className="signal-beacon-hint">点信标展开轨迹 · LinuxDO 请点「允许」</p>
    </div>
  );
}
