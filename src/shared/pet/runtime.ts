import type { PetState } from "./states";

export const PET_SNAPSHOT_PUBLISH_TYPE = "pet.snapshot.publish";
export const PET_SNAPSHOT_GET_TYPE = "pet.snapshot.get";
export const PET_SNAPSHOT_EVENT_TYPE = "pet.snapshot.event";
export const PET_OPEN_SIDE_PANEL_TYPE = "pet.openSidePanel";
export const PET_POSITION_STORAGE_KEY = "pet.pagePosition.v1";
export const PET_MUTED_STORAGE_KEY = "pet.muted.v1";

export interface PetRuntimeSnapshot {
  state: PetState;
  bubble?: string;
  badge?: "running" | "done" | "interrupted" | "idle";
  toolLabel?: string;
  stateLabel: string;
  muted?: boolean;
  updatedAt: number;
}

export interface PetSnapshotPublishMessage {
  type: typeof PET_SNAPSHOT_PUBLISH_TYPE;
  snapshot: PetRuntimeSnapshot;
}

export interface PetSnapshotGetMessage {
  type: typeof PET_SNAPSHOT_GET_TYPE;
}

export interface PetSnapshotEventMessage {
  type: typeof PET_SNAPSHOT_EVENT_TYPE;
  snapshot: PetRuntimeSnapshot | null;
}

export interface PetOpenSidePanelMessage {
  type: typeof PET_OPEN_SIDE_PANEL_TYPE;
}

export type PetRuntimeMessage =
  | PetSnapshotPublishMessage
  | PetSnapshotGetMessage
  | PetSnapshotEventMessage
  | PetOpenSidePanelMessage;

export function isPetRuntimeMessage(value: unknown): value is PetRuntimeMessage {
  if (!value || typeof value !== "object" || !("type" in value)) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return (
    type === PET_SNAPSHOT_PUBLISH_TYPE ||
    type === PET_SNAPSHOT_GET_TYPE ||
    type === PET_SNAPSHOT_EVENT_TYPE ||
    type === PET_OPEN_SIDE_PANEL_TYPE
  );
}

export function petStateLabel(state: PetState | string | undefined): string {
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

/** File names under chrome.runtime.getURL("pet/cat/...") */
const CAT_SINGLE: Partial<Record<PetState, string>> = {
  idle: "cat-idle.gif",
  roam: "cat-roam.gif",
  working: "cat-working.gif",
  thinking: "cat-thinking.gif",
  talking: "cat-talking.gif",
  juggling: "cat-juggling.gif",
  sweeping: "cat-sweeping.gif",
  waiting: "cat-waiting.gif",
  needsinput: "cat-needsinput.gif",
  happy: "cat-happy.gif",
  greet: "cat-greet.gif",
  attention: "cat-attention.gif",
  sleeping: "cat-sleeping.gif",
  error: "cat-error.gif",
  loafing: "cat-loafing.gif",
  carrying: "cat-working.gif",
  notification: "cat-needsinput.gif",
};

const CAT_POOLS: Partial<Record<PetState, string[]>> = {
  working: ["cat-working.gif", "cat-working-2.gif", "cat-working-3.gif", "cat-working-4.gif"],
  thinking: ["cat-thinking.gif", "cat-thinking-2.gif"],
  sleeping: ["cat-sleeping.gif", "cat-sleeping-2.gif"],
  loafing: ["cat-loafing.gif", "cat-loafing-2.gif", "cat-loafing-3.gif"],
};

export function resolvePublicCatAssetPath(state: PetState | string | undefined, poolIndex = 0): string {
  const key = (state || "idle") as PetState;
  const pool = CAT_POOLS[key];
  const file = pool?.length
    ? pool[Math.abs(poolIndex) % pool.length]
    : CAT_SINGLE[key] || "cat-idle.gif";
  return `pet/cat/${file}`;
}

export function createDefaultPetSnapshot(now = Date.now()): PetRuntimeSnapshot {
  return {
    state: "idle",
    badge: "idle",
    stateLabel: petStateLabel("idle"),
    muted: false,
    updatedAt: now,
  };
}
