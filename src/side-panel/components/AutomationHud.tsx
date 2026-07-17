import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import {
  CONTROL_BEACON_DRAG_END_TYPE,
  CONTROL_BEACON_DRAG_MOVE_TYPE,
  CONTROL_BEACON_FRAME_SOURCE,
  CONTROL_BEACON_LAYOUT_TYPE,
} from "../../shared/sidePanelRuntime";
import { useAppStore } from "../state/appStore";
import type { ChatMessage, ChatToolCallRecord } from "../../shared/types";

type LivePhase = "idle" | "running" | "done" | "error";

const DRAG_THRESHOLD_PX = 4;

function statusLabel(status: ChatToolCallRecord["status"] | "unknown"): string {
  if (status === "running") return "进行中";
  if (status === "success") return "完成";
  if (status === "error") return "失败";
  return String(status);
}

function collectRecentToolRecords(messages: ChatMessage[], limit = 8): ChatToolCallRecord[] {
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
  return next.slice(-12);
}

function shortName(record?: ChatToolCallRecord): string {
  if (!record) {
    return "";
  }
  const label = (record.displayName || record.name || "").trim();
  return label.length > 18 ? `${label.slice(0, 17)}…` : label;
}

function postBeaconFrameMessage(message: {
  type: typeof CONTROL_BEACON_DRAG_MOVE_TYPE | typeof CONTROL_BEACON_DRAG_END_TYPE | typeof CONTROL_BEACON_LAYOUT_TYPE;
  dx?: number;
  dy?: number;
  expanded?: boolean;
}): void {
  try {
    window.parent?.postMessage(
      {
        source: CONTROL_BEACON_FRAME_SOURCE,
        ...message,
      },
      "*",
    );
  } catch {
    // Host page may reject postMessage in rare sandbox cases.
  }
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
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef({
    pointerId: null as number | null,
    active: false,
    moved: false,
    lastX: 0,
    lastY: 0,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    postBeaconFrameMessage({ type: CONTROL_BEACON_LAYOUT_TYPE, expanded });
  }, [expanded]);

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
    () => collectRecentToolRecords(activeSession?.messages ?? [], 8),
    [activeSession?.messages, now],
  );
  const records = liveRecords.length > 0 ? liveRecords.slice(-8) : storeRecords;
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

  const tooltip = latest
    ? `${shortName(latest)} · ${statusLabel(latest.status)}`
    : isBusy
      ? "模型思考中"
      : browserControlEnabled
        ? "浏览器控制已开 · 可拖动"
        : "先在侧栏开启浏览器控制";

  const sparkRecords = records.slice(-5);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      active: true,
      moved: false,
      lastX: event.screenX,
      lastY: event.screenY,
    };
    setDragging(false);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.screenX - drag.lastX;
    const dy = event.screenY - drag.lastY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
      return;
    }
    drag.moved = true;
    drag.lastX = event.screenX;
    drag.lastY = event.screenY;
    if (!dragging) {
      setDragging(true);
    }
    postBeaconFrameMessage({ type: CONTROL_BEACON_DRAG_MOVE_TYPE, dx, dy });
  };

  const finishPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) {
      return;
    }
    drag.active = false;
    drag.pointerId = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // capture may already be released
    }
    if (drag.moved) {
      postBeaconFrameMessage({ type: CONTROL_BEACON_DRAG_END_TYPE });
      setDragging(false);
      return;
    }
    setDragging(false);
    setExpanded((value) => !value);
  };

  return (
    <div
      className={`orb-beacon phase-${phase}${expanded ? " is-expanded" : ""}${browserControlEnabled ? " control-on" : ""}${dragging ? " is-dragging" : ""}`}
      data-browser-control={browserControlEnabled ? "on" : "off"}
      data-phase={phase}
    >
      <button
        type="button"
        className="orb-beacon-button"
        aria-expanded={expanded}
        aria-label={tooltip}
        title={tooltip}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      >
        <span className="orb-beacon-ring orb-beacon-ring-a" aria-hidden="true" />
        <span className="orb-beacon-ring orb-beacon-ring-b" aria-hidden="true" />
        <span className="orb-beacon-wave orb-beacon-wave-a" aria-hidden="true" />
        <span className="orb-beacon-wave orb-beacon-wave-b" aria-hidden="true" />
        <span className="orb-beacon-core" aria-hidden="true">
          <span className="orb-beacon-glow" />
          <span className="orb-beacon-sphere" />
          <span className="orb-beacon-highlight" />
          <span className="orb-beacon-pupil" />
        </span>
        {sparkRecords.map((record, index) => (
          <span
            key={`${record.id}-${index}`}
            className={`orb-beacon-spark is-${record.status}`}
            style={{ "--spark-index": index, "--spark-count": Math.max(sparkRecords.length, 1) } as CSSProperties}
          />
        ))}
        <span key={burstKey} className="orb-beacon-burst" aria-hidden="true" />
      </button>

      <div className="orb-beacon-tip" aria-live="polite">
        {tooltip}
      </div>

      {expanded ? (
        <div className="orb-beacon-trail" aria-label="最近步骤">
          {sparkRecords.length === 0 ? (
            <div className="orb-beacon-chip is-empty">等待工具调用</div>
          ) : (
            sparkRecords.map((record) => (
              <div key={record.id} className={`orb-beacon-chip is-${record.status}`}>
                <span>{shortName(record)}</span>
                <span>{statusLabel(record.status)}</span>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
