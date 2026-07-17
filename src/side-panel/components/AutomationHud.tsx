import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../state/appStore";
import type { ChatMessage, ChatToolCallRecord } from "../../shared/types";

function statusLabel(status: ChatToolCallRecord["status"] | "unknown"): string {
  if (status === "running") return "进行中";
  if (status === "success") return "完成";
  if (status === "error") return "失败";
  return String(status);
}

function statusClass(status: ChatToolCallRecord["status"] | "unknown"): string {
  if (status === "running") return "is-running";
  if (status === "success") return "is-success";
  if (status === "error") return "is-error";
  return "";
}

function collectRecentToolRecords(messages: ChatMessage[], limit = 12): ChatToolCallRecord[] {
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
  return next.slice(-20);
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
  const [liveStatus, setLiveStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [now, setNow] = useState(Date.now());

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
    () => collectRecentToolRecords(activeSession?.messages ?? [], 14),
    [activeSession?.messages, now],
  );
  const records = liveRecords.length > 0 ? liveRecords.slice(-14) : storeRecords;
  const runningCount = records.filter((item) => item.status === "running").length;
  const latest = records[records.length - 1];
  const isBusy = sending || task?.status === "running" || liveStatus === "running";

  return (
    <div className="automation-hud" data-browser-control={browserControlEnabled ? "on" : "off"}>
      <header className="automation-hud-header">
        <div className="automation-hud-brand">
          <span className="automation-hud-dot" aria-hidden="true" />
          <div>
            <div className="automation-hud-title">补签监视</div>
            <div className="automation-hud-subtitle">
              {browserControlEnabled ? "浏览器控制已开" : "浏览器控制未开"}
              {isBusy ? " · 运行中" : liveStatus === "done" ? " · 完成" : " · 空闲"}
            </div>
          </div>
        </div>
        <div className="automation-hud-badges">
          <span className="automation-hud-badge">{records.length} 步</span>
          {runningCount > 0 ? <span className="automation-hud-badge is-live">{runningCount} 进行中</span> : null}
        </div>
      </header>

      <section className="automation-hud-current" aria-live="polite">
        <div className="automation-hud-current-label">当前</div>
        <div className="automation-hud-current-value">
          {latest
            ? `${latest.displayName || latest.name} · ${statusLabel(latest.status)}`
            : isBusy
              ? "模型思考中…"
              : "等待工具调用"}
        </div>
        {latest?.resultSummary ? <div className="automation-hud-current-summary">{latest.resultSummary}</div> : null}
      </section>

      <section className="automation-hud-list" aria-label="最近工具调用">
        {records.length === 0 ? (
          <div className="automation-hud-empty">
            开始补签后，这里实时显示：新建页面、点击、LinuxDO 允许、验证码、记录结果等步骤。
          </div>
        ) : (
          records.map((record) => (
            <article key={record.id} className={`automation-hud-item ${statusClass(record.status)}`}>
              <div className="automation-hud-item-top">
                <span className="automation-hud-item-name">{record.displayName || record.name}</span>
                <span className="automation-hud-item-status">{statusLabel(record.status)}</span>
              </div>
              {record.resultSummary ? <div className="automation-hud-item-summary">{record.resultSummary}</div> : null}
              {record.errorMessage ? <div className="automation-hud-item-error">{record.errorMessage}</div> : null}
            </article>
          ))
        )}
      </section>

      <footer className="automation-hud-footer">
        LinuxDO 授权页请点黑色「允许」。完整对话仍在主侧栏。
      </footer>
    </div>
  );
}
