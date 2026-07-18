import { type PetState, pickDominantState } from "./states";

export interface PetToolSignal {
  id: string;
  name?: string;
  displayName?: string;
  status: "running" | "success" | "error" | string;
}

export interface PetDeriveInput {
  sending?: boolean;
  streamingText?: boolean;
  hasReasoning?: boolean;
  tools?: PetToolSignal[];
  boundaryPending?: boolean;
  needsInput?: boolean;
  lastError?: string | null;
  justCompleted?: boolean;
  isNewSession?: boolean;
  lastActivityAt?: number;
  now?: number;
  muted?: boolean;
  assistantSnippet?: string | null;
  privateMode?: boolean;
}

export interface PetSnapshot {
  state: PetState;
  bubble?: string;
  badge?: "running" | "done" | "interrupted" | "idle";
  toolLabel?: string;
}

const LOAF_GAP_MS = 5_000;
const ROAM_AFTER_MS = 2 * 60_000;
const SLEEP_AFTER_MS = 10 * 60_000;

export function derivePetState(input: PetDeriveInput): PetSnapshot {
  const now = input.now ?? Date.now();
  const tools = input.tools ?? [];
  const runningTools = tools.filter((tool) => tool.status === "running");
  const erroredTools = tools.filter((tool) => tool.status === "error");
  const latestTool = tools[tools.length - 1];

  if (input.boundaryPending) {
    return {
      state: "waiting",
      bubble: input.muted ? undefined : "需要你确认权限",
      badge: "running",
    };
  }

  if (input.needsInput) {
    return {
      state: "needsinput",
      bubble: input.muted ? undefined : "等你回复",
      badge: "running",
    };
  }

  if (input.lastError) {
    return {
      state: "error",
      bubble: input.muted ? undefined : clip(input.lastError, 80),
      badge: "interrupted",
    };
  }

  if (erroredTools.length > 0 && runningTools.length === 0 && !input.sending) {
    const msg = erroredTools[erroredTools.length - 1]?.displayName || erroredTools[erroredTools.length - 1]?.name || "工具失败";
    return {
      state: "error",
      bubble: input.muted ? undefined : `${msg} 失败`,
      badge: "interrupted",
      toolLabel: shortTool(latestTool),
    };
  }

  if (runningTools.length >= 2) {
    return {
      state: "juggling",
      bubble: input.muted ? undefined : `并行 ${runningTools.length} 个工具`,
      badge: "running",
      toolLabel: shortTool(runningTools[runningTools.length - 1]),
    };
  }

  if (runningTools.length === 1) {
    return {
      state: "working",
      bubble: input.muted ? undefined : `正在 ${shortTool(runningTools[0])}`,
      badge: "running",
      toolLabel: shortTool(runningTools[0]),
    };
  }

  if (input.streamingText) {
    const bubble = input.privateMode
      ? undefined
      : input.muted
        ? undefined
        : clip(input.assistantSnippet || "回复中…", 140);
    return {
      state: "talking",
      bubble,
      badge: "running",
    };
  }

  if (input.sending || input.hasReasoning) {
    return {
      state: "thinking",
      bubble: input.muted ? undefined : "思考中…",
      badge: "running",
    };
  }

  if (input.justCompleted) {
    const reply = !input.privateMode && !input.muted
      ? clip(input.assistantSnippet || "", 140)
      : undefined;
    return {
      // Keep the spoken reply in the bubble; fall back to a short done note only when empty.
      state: reply ? "talking" : "happy",
      bubble: reply || (input.muted || input.privateMode ? undefined : "本轮完成"),
      badge: "done",
    };
  }

  if (input.isNewSession) {
    return {
      state: "greet",
      bubble: input.muted ? undefined : "新会话，开工！",
      badge: "idle",
    };
  }

  const lastActivityAt = input.lastActivityAt ?? now;
  const idleFor = Math.max(0, now - lastActivityAt);
  if (idleFor >= SLEEP_AFTER_MS) {
    return { state: "sleeping", badge: "idle" };
  }
  if (idleFor >= ROAM_AFTER_MS) {
    return { state: "roam", badge: "idle" };
  }
  if (idleFor >= LOAF_GAP_MS) {
    return { state: "loafing", badge: "idle" };
  }

  return {
    state: pickDominantState(["idle"]),
    badge: "idle",
  };
}

function shortTool(tool?: PetToolSignal): string {
  if (!tool) {
    return "工具";
  }
  const label = (tool.displayName || tool.name || "工具").trim();
  return label.length > 18 ? `${label.slice(0, 17)}…` : label;
}

function clip(text: string, max: number): string {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) {
    return cleaned;
  }
  return `${cleaned.slice(0, Math.max(0, max - 1))}…`;
}
