import {
  PET_CHAT_SEND_TYPE,
  PET_OPEN_SIDE_PANEL_TYPE,
  PET_PENDING_CHAT_STORAGE_KEY,
  PET_SNAPSHOT_EVENT_TYPE,
  PET_SNAPSHOT_GET_TYPE,
  PET_SNAPSHOT_PUBLISH_TYPE,
  createDefaultPetSnapshot,
  isPetRuntimeMessage,
  type PetPendingChat,
  type PetRuntimeMessage,
  type PetRuntimeSnapshot,
} from "../shared/pet/runtime";
import { openSidePanelForActiveTab, openSidePanelForTab } from "./sidePanelController";

let latestSnapshot: PetRuntimeSnapshot | null = null;

export type PetRuntimeResponse =
  | { ok: true; snapshot?: PetRuntimeSnapshot | null; message?: string; pending?: PetPendingChat | null }
  | { ok: false; message: string };

export function handlePetRuntimeMessage(
  message: unknown,
  sender?: chrome.runtime.MessageSender,
): Promise<PetRuntimeResponse> | undefined {
  if (!isPetRuntimeMessage(message)) {
    return undefined;
  }
  return dispatch(message, sender);
}

async function dispatch(
  message: PetRuntimeMessage,
  sender?: chrome.runtime.MessageSender,
): Promise<PetRuntimeResponse> {
  if (message.type === PET_SNAPSHOT_GET_TYPE) {
    return { ok: true, snapshot: latestSnapshot ?? createDefaultPetSnapshot() };
  }

  if (message.type === PET_SNAPSHOT_PUBLISH_TYPE) {
    latestSnapshot = normalizeSnapshot(message.snapshot);
    await broadcastSnapshot(latestSnapshot);
    return { ok: true, snapshot: latestSnapshot };
  }

  if (message.type === PET_OPEN_SIDE_PANEL_TYPE) {
    const opened = await openSidePanelFromSender(sender);
    return opened
      ? { ok: true, message: "已打开 AI 侧栏" }
      : { ok: false, message: "打开侧栏失败，请点击扩展图标重试" };
  }

  if (message.type === PET_CHAT_SEND_TYPE) {
    const content = String(message.content || "").trim();
    if (!content) {
      return { ok: false, message: "消息不能为空" };
    }
    const pending: PetPendingChat = {
      id: `pet-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content,
      createdAt: Date.now(),
      source: message.source === "newtab" ? "newtab" : "page",
    };
    try {
      await chrome.storage?.session?.set?.({ [PET_PENDING_CHAT_STORAGE_KEY]: pending });
    } catch {
      // ignore
    }

    // Optimistic pet feedback before the side panel takes over.
    const thinkingSnapshot: PetRuntimeSnapshot = {
      state: "thinking",
      badge: "running",
      stateLabel: "思考中",
      bubble: "思考中…",
      muted: latestSnapshot?.muted,
      updatedAt: Date.now(),
    };
    latestSnapshot = thinkingSnapshot;
    await broadcastSnapshot(thinkingSnapshot);

    const opened = await openSidePanelFromSender(sender);
    // Also notify any already-open side panel pages.
    try {
      await chrome.runtime.sendMessage({
        type: PET_CHAT_SEND_TYPE,
        content: pending.content,
        source: pending.source,
        pendingId: pending.id,
      });
    } catch {
      // No side-panel listener yet; it will pick up from session storage on mount.
    }

    return opened
      ? { ok: true, message: "已发送到 AI 侧栏", pending }
      : { ok: false, message: "消息已排队，但打开侧栏失败；请点击扩展图标打开后继续" };
  }

  // PET_SNAPSHOT_EVENT_TYPE is outbound only
  return { ok: true, snapshot: latestSnapshot };
}

function normalizeSnapshot(snapshot: PetRuntimeSnapshot): PetRuntimeSnapshot {
  return {
    ...snapshot,
    updatedAt: typeof snapshot.updatedAt === "number" ? snapshot.updatedAt : Date.now(),
    stateLabel: snapshot.stateLabel || "待命",
  };
}

async function broadcastSnapshot(snapshot: PetRuntimeSnapshot): Promise<void> {
  const event = {
    type: PET_SNAPSHOT_EVENT_TYPE,
    snapshot,
  } as const;

  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.map(async (tab) => {
        if (typeof tab.id !== "number") {
          return;
        }
        try {
          await chrome.tabs.sendMessage(tab.id, event);
        } catch {
          // Content script may be missing on chrome:// and similar pages.
        }
      }),
    );
  } catch {
    // ignore
  }
}

async function openSidePanelFromSender(sender?: chrome.runtime.MessageSender): Promise<boolean> {
  const senderTabId = typeof sender?.tab?.id === "number" ? sender.tab.id : undefined;
  if (typeof senderTabId === "number") {
    const opened = await openSidePanelForTab(senderTabId);
    if (opened) {
      return true;
    }
  }
  return openSidePanelForActiveTab();
}
