import {
  PET_CHAT_SEND_TYPE,
  PET_OPEN_SIDE_PANEL_TYPE,
  PET_PENDING_CHAT_STORAGE_KEY,
  PET_SNAPSHOT_EVENT_TYPE,
  PET_SNAPSHOT_GET_TYPE,
  PET_SNAPSHOT_PUBLISH_TYPE,
  PET_SNAPSHOT_STORAGE_KEY,
  createDefaultPetSnapshot,
  isPetRuntimeMessage,
  type PetPendingChat,
  type PetRuntimeMessage,
  type PetRuntimeSnapshot,
} from "../shared/pet/runtime";
import { openSidePanelForActiveTab, openSidePanelForTab } from "./sidePanelController";

let latestSnapshot: PetRuntimeSnapshot | null = null;
let snapshotHydrated = false;

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

/** Best-effort re-inject content scripts so already-open tabs get the pet without a manual refresh. */
export async function reinjectPetContentScripts(): Promise<void> {
  const executeScript = chrome.scripting?.executeScript;
  const query = chrome.tabs?.query;
  if (typeof executeScript !== "function" || typeof query !== "function") {
    return;
  }
  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await query({});
  } catch {
    return;
  }
  await Promise.all(
    tabs.map(async (tab) => {
      if (typeof tab.id !== "number" || !isHttpLikeUrl(tab.url)) {
        return;
      }
      try {
        await executeScript({ target: { tabId: tab.id }, files: ["content/index.js"] });
      } catch {
        // Restricted pages / missing host permission.
      }
    }),
  );
}

async function dispatch(
  message: PetRuntimeMessage,
  sender?: chrome.runtime.MessageSender,
): Promise<PetRuntimeResponse> {
  if (message.type === PET_SNAPSHOT_GET_TYPE) {
    const snapshot = await getLatestSnapshot();
    return { ok: true, snapshot };
  }

  if (message.type === PET_SNAPSHOT_PUBLISH_TYPE) {
    const snapshot = await setLatestSnapshot(message.snapshot);
    return { ok: true, snapshot };
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

    const current = await getLatestSnapshot();
    await setLatestSnapshot({
      state: "thinking",
      badge: "running",
      stateLabel: "思考中",
      bubble: "思考中…",
      muted: current.muted,
      updatedAt: Date.now(),
    });

    const opened = await openSidePanelFromSender(sender);
    try {
      await chrome.runtime.sendMessage({
        type: PET_CHAT_SEND_TYPE,
        content: pending.content,
        source: pending.source,
        pendingId: pending.id,
      });
    } catch {
      // Side panel will pick up from session storage on mount.
    }

    return opened
      ? { ok: true, message: "已发送到 AI 侧栏", pending }
      : { ok: false, message: "消息已排队，但打开侧栏失败；请点击扩展图标打开后继续" };
  }

  return { ok: true, snapshot: await getLatestSnapshot() };
}

async function getLatestSnapshot(): Promise<PetRuntimeSnapshot> {
  if (!snapshotHydrated) {
    await hydrateSnapshotFromStorage();
  }
  return latestSnapshot ?? createDefaultPetSnapshot();
}

async function setLatestSnapshot(snapshot: PetRuntimeSnapshot): Promise<PetRuntimeSnapshot> {
  const normalized = normalizeSnapshot(snapshot);
  // Ignore stale writes so concurrent tabs/side-panel don't rewind state.
  if (latestSnapshot && normalized.updatedAt < (latestSnapshot.updatedAt || 0)) {
    return latestSnapshot;
  }
  latestSnapshot = normalized;
  snapshotHydrated = true;
  try {
    await chrome.storage?.session?.set?.({ [PET_SNAPSHOT_STORAGE_KEY]: normalized });
  } catch {
    // ignore
  }
  // Best-effort push for already-listening pages; storage.onChanged is the reliable path.
  void broadcastSnapshot(normalized);
  return normalized;
}

async function hydrateSnapshotFromStorage(): Promise<void> {
  snapshotHydrated = true;
  try {
    const items = await chrome.storage?.session?.get?.(PET_SNAPSHOT_STORAGE_KEY);
    const value = items?.[PET_SNAPSHOT_STORAGE_KEY];
    if (value && typeof value === "object" && typeof (value as { state?: unknown }).state === "string") {
      latestSnapshot = normalizeSnapshot(value as PetRuntimeSnapshot);
      return;
    }
  } catch {
    // ignore
  }
  if (!latestSnapshot) {
    latestSnapshot = createDefaultPetSnapshot();
  }
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
    // Extension pages (newtab/side panel) listen via runtime.onMessage.
    void chrome.runtime.sendMessage(event).catch(() => undefined);
  } catch {
    // ignore
  }

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
          // Content script may be missing.
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

function isHttpLikeUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "file:";
  } catch {
    return false;
  }
}
