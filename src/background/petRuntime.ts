import {
  PET_OPEN_SIDE_PANEL_TYPE,
  PET_SNAPSHOT_EVENT_TYPE,
  PET_SNAPSHOT_GET_TYPE,
  PET_SNAPSHOT_PUBLISH_TYPE,
  createDefaultPetSnapshot,
  isPetRuntimeMessage,
  type PetRuntimeMessage,
  type PetRuntimeSnapshot,
} from "../shared/pet/runtime";

let latestSnapshot: PetRuntimeSnapshot | null = null;

export type PetRuntimeResponse =
  | { ok: true; snapshot?: PetRuntimeSnapshot | null; message?: string }
  | { ok: false; message: string };

export function handlePetRuntimeMessage(message: unknown): Promise<PetRuntimeResponse> | undefined {
  if (!isPetRuntimeMessage(message)) {
    return undefined;
  }
  return dispatch(message);
}

async function dispatch(message: PetRuntimeMessage): Promise<PetRuntimeResponse> {
  if (message.type === PET_SNAPSHOT_GET_TYPE) {
    return { ok: true, snapshot: latestSnapshot ?? createDefaultPetSnapshot() };
  }

  if (message.type === PET_SNAPSHOT_PUBLISH_TYPE) {
    latestSnapshot = normalizeSnapshot(message.snapshot);
    await broadcastSnapshot(latestSnapshot);
    return { ok: true, snapshot: latestSnapshot };
  }

  if (message.type === PET_OPEN_SIDE_PANEL_TYPE) {
    const opened = await openSidePanelInActiveTab();
    return opened
      ? { ok: true, message: "已打开 AI 侧栏" }
      : { ok: false, message: "打开侧栏失败，请点击扩展图标重试" };
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

async function openSidePanelInActiveTab(): Promise<boolean> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (typeof tab?.id !== "number") {
      return false;
    }
    try {
      await chrome.sidePanel?.setOptions?.({ tabId: tab.id, path: "index.html", enabled: true });
    } catch {
      // ignore
    }
    try {
      if (typeof tab.windowId === "number") {
        await chrome.sidePanel?.open?.({ windowId: tab.windowId });
      } else {
        await chrome.sidePanel?.open?.({ tabId: tab.id });
      }
      return true;
    } catch {
      try {
        void chrome.sidePanel?.open?.({ tabId: tab.id })?.catch(() => undefined);
        return true;
      } catch {
        return false;
      }
    }
  } catch {
    return false;
  }
}
