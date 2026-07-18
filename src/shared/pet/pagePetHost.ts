import {
  PET_CHAT_SEND_TYPE,
  PET_MUTED_STORAGE_KEY,
  PET_OPEN_SIDE_PANEL_TYPE,
  PET_POSITION_STORAGE_KEY,
  PET_SNAPSHOT_EVENT_TYPE,
  PET_SNAPSHOT_GET_TYPE,
  PET_SNAPSHOT_PUBLISH_TYPE,
  PET_SNAPSHOT_STORAGE_KEY,
  createDefaultPetSnapshot,
  resolvePublicCatAssetPath,
  type PetRuntimeSnapshot,
} from "./runtime";

const PET_HOST_SELECTOR = "[data-moon-tab-ai-pet-host]";
const PET_STYLE_ID = "moon-tab-ai-pet-style";
const PET_SIZE = 112;
const DRAG_THRESHOLD_PX = 4;

export interface FloatingPetCompanionController {
  applySnapshot: (snapshot: PetRuntimeSnapshot | null | undefined) => void;
  setMuted: (muted: boolean) => void;
  destroy: () => void;
}

interface MountOptions {
  root?: ParentNode;
  listenRuntimeMessages?: boolean;
  listenAutomationLive?: boolean;
  openSidePanel?: () => void;
}

let sharedController: FloatingPetCompanionController | null = null;

export function getPagePetHostSelectorForTests(): string {
  return PET_HOST_SELECTOR;
}

export function mountFloatingPetCompanion(options: MountOptions = {}): FloatingPetCompanionController {
  if (sharedController) {
    return sharedController;
  }

  const root = options.root ?? document.documentElement;
  const listenRuntimeMessages = options.listenRuntimeMessages !== false;
  const listenAutomationLive = options.listenAutomationLive !== false;

  let petSnapshot: PetRuntimeSnapshot = createDefaultPetSnapshot();
  let petMuted = false;
  let petPoolIndex = 0;
  let savedPetPosition: { left: number; top: number } | undefined;
  let poolTimer: number | undefined;
  let runtimeListener:
    | ((message: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => void)
    | undefined;
  let automationListener: ((message: unknown) => void) | undefined;
  let storageListener:
    | ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void)
    | undefined;

  const controller: FloatingPetCompanionController = {
    applySnapshot(snapshot) {
      if (!snapshot) {
        return;
      }
      // Ignore stale snapshots so multi-tab writers don't rewind mood.
      if (petSnapshot.updatedAt && snapshot.updatedAt && snapshot.updatedAt < petSnapshot.updatedAt) {
        return;
      }
      petSnapshot = snapshot;
      if (typeof snapshot.muted === "boolean") {
        petMuted = snapshot.muted;
      }
      renderPagePet();
    },
    setMuted(muted) {
      petMuted = muted;
      void chrome.storage?.local?.set?.({ [PET_MUTED_STORAGE_KEY]: petMuted });
      // Keep muted flag on the shared snapshot so every page agrees.
      const next: PetRuntimeSnapshot = {
        ...petSnapshot,
        muted: petMuted,
        bubble: petMuted ? undefined : petSnapshot.bubble,
        updatedAt: Date.now(),
      };
      petSnapshot = next;
      publishSnapshot(next);
      renderPagePet();
    },
    destroy() {
      if (poolTimer != null) {
        window.clearInterval(poolTimer);
        poolTimer = undefined;
      }
      if (runtimeListener) {
        chrome.runtime?.onMessage?.removeListener?.(runtimeListener as never);
        runtimeListener = undefined;
      }
      if (automationListener) {
        chrome.runtime?.onMessage?.removeListener?.(automationListener as never);
        automationListener = undefined;
      }
      if (storageListener) {
        chrome.storage?.onChanged?.removeListener?.(storageListener as never);
        storageListener = undefined;
      }
      document.querySelectorAll(PET_HOST_SELECTOR).forEach((node) => node.remove());
      document.getElementById(PET_STYLE_ID)?.remove();
      sharedController = null;
    },
  };

  void bootstrap();
  sharedController = controller;
  return controller;

  async function bootstrap(): Promise<void> {
    await restorePetPrefs();
    mountPagePet();
    await hydrateSnapshotFromStorage();
    requestLatestSnapshot();
    if (poolTimer == null) {
      poolTimer = window.setInterval(() => {
        petPoolIndex += 1;
        renderPagePet();
      }, 60_000);
    }

    // Reliable cross-page sync: storage is the shared bus.
    storageListener = (changes, areaName) => {
      if (areaName === "session" && changes[PET_SNAPSHOT_STORAGE_KEY]) {
        const next = changes[PET_SNAPSHOT_STORAGE_KEY].newValue as PetRuntimeSnapshot | undefined;
        controller.applySnapshot(next);
      }
      if (areaName === "local" && changes[PET_MUTED_STORAGE_KEY]) {
        petMuted = changes[PET_MUTED_STORAGE_KEY].newValue === true;
        renderPagePet();
      }
    };
    try {
      chrome.storage?.onChanged?.addListener?.(storageListener as never);
    } catch {
      // ignore
    }

    if (listenRuntimeMessages) {
      runtimeListener = (message) => {
        if (!message || typeof message !== "object" || !("type" in message)) {
          return;
        }
        if ((message as { type?: string }).type !== PET_SNAPSHOT_EVENT_TYPE) {
          return;
        }
        const snapshot = (message as { snapshot?: PetRuntimeSnapshot | null }).snapshot;
        controller.applySnapshot(snapshot);
      };
      chrome.runtime?.onMessage?.addListener?.(runtimeListener as never);
    }
    if (listenAutomationLive) {
      automationListener = (message) => {
        if (!message || typeof message !== "object" || !("type" in message)) {
          return;
        }
        if ((message as { type?: string }).type !== "automation.live") {
          return;
        }
        const age = Date.now() - (petSnapshot.updatedAt || 0);
        if (
          age < 1_500 &&
          petSnapshot.state !== "idle" &&
          petSnapshot.state !== "loafing" &&
          petSnapshot.state !== "sleeping" &&
          petSnapshot.state !== "roam"
        ) {
          return;
        }
        const payload = (message as { payload?: unknown }).payload;
        if (!payload || typeof payload !== "object" || !("type" in payload)) {
          return;
        }
        const eventType = (payload as { type?: string }).type;
        const now = Date.now();
        let next: PetRuntimeSnapshot | undefined;
        if (eventType === "tool:start") {
          const record = (payload as { record?: { displayName?: string; name?: string } }).record;
          const label = record?.displayName || record?.name || "工具";
          next = {
            state: "working",
            badge: "running",
            stateLabel: "干活中",
            bubble: petMuted ? undefined : `正在 ${label}`,
            toolLabel: label,
            muted: petMuted,
            updatedAt: now,
          };
        } else if (eventType === "complete") {
          next = {
            state: "happy",
            badge: "done",
            stateLabel: "完成",
            bubble: petMuted ? undefined : "本轮完成",
            muted: petMuted,
            updatedAt: now,
          };
        } else if (eventType === "error" || eventType === "canceled") {
          next = {
            state: "error",
            badge: "interrupted",
            stateLabel: "出错",
            bubble: petMuted ? undefined : "执行失败",
            muted: petMuted,
            updatedAt: now,
          };
        } else if (eventType === "chunk" || eventType === "assistant:tool-turn") {
          next = {
            ...petSnapshot,
            state: "thinking",
            badge: "running",
            stateLabel: "思考中",
            bubble: petMuted ? undefined : "思考中…",
            muted: petMuted,
            updatedAt: now,
          };
        }
        if (next) {
          controller.applySnapshot(next);
          // Publish so every other page/tab follows the same mood.
          publishSnapshot(next);
        }
      };
      chrome.runtime?.onMessage?.addListener?.(automationListener as never);
    }
  }

  async function hydrateSnapshotFromStorage(): Promise<void> {
    try {
      const items = await chrome.storage?.session?.get?.(PET_SNAPSHOT_STORAGE_KEY);
      const value = items?.[PET_SNAPSHOT_STORAGE_KEY] as PetRuntimeSnapshot | undefined;
      if (value && typeof value === "object" && typeof value.state === "string") {
        controller.applySnapshot(value);
      }
    } catch {
      // ignore
    }
  }

  function requestLatestSnapshot(): void {
    try {
      void chrome.runtime.sendMessage({ type: PET_SNAPSHOT_GET_TYPE }, (response) => {
        void chrome.runtime.lastError;
        const snapshot =
          response && typeof response === "object"
            ? (response as { snapshot?: PetRuntimeSnapshot }).snapshot
            : undefined;
        controller.applySnapshot(snapshot);
      });
    } catch {
      // ignore
    }
  }

  function publishSnapshot(snapshot: PetRuntimeSnapshot): void {
    try {
      void chrome.runtime.sendMessage(
        {
          type: PET_SNAPSHOT_PUBLISH_TYPE,
          snapshot,
        },
        () => {
          void chrome.runtime.lastError;
        },
      );
    } catch {
      // Fallback: write storage directly when runtime is unavailable.
      try {
        void chrome.storage?.session?.set?.({ [PET_SNAPSHOT_STORAGE_KEY]: snapshot });
      } catch {
        // ignore
      }
    }
  }

  function mountPagePet(): void {
    ensurePetStyles();
    let host = document.querySelector<HTMLElement>(PET_HOST_SELECTOR);
    if (!host) {
      host = document.createElement("div");
      host.dataset.moonTabAiPetHost = "true";
      host.className = "moon-pet-host";
      host.innerHTML = `
        <div class="moon-pet-bubble" hidden></div>
        <button type="button" class="moon-pet-button" aria-label="AI 伴侣">
          <img class="moon-pet-img" alt="" draggable="false" />
          <span class="moon-pet-badge" aria-hidden="true"></span>
        </button>
        <div class="moon-pet-meta">
          <span class="moon-pet-state">待命</span>
        </div>
        <div class="moon-pet-menu" hidden>
          <button type="button" data-pet-action="chat">对话</button>
          <button type="button" data-pet-action="open">打开侧栏</button>
          <button type="button" data-pet-action="mute">静音气泡</button>
        </div>
        <form class="moon-pet-composer" hidden>
          <input class="moon-pet-input" type="text" maxlength="2000" placeholder="跟宠物说点什么…" autocomplete="off" />
        </form>
      `;
      root.appendChild(host);
      wirePetInteractions(host);
    }
    applyPetPosition(host, savedPetPosition);
    renderPagePet();
  }

  function wirePetInteractions(host: HTMLElement): void {
    const button = host.querySelector<HTMLButtonElement>(".moon-pet-button");
    const menu = host.querySelector<HTMLElement>(".moon-pet-menu");
    const composer = host.querySelector<HTMLFormElement>(".moon-pet-composer");
    const input = host.querySelector<HTMLInputElement>(".moon-pet-input");
    if (!button || button.dataset.wired === "1") {
      return;
    }
    button.dataset.wired = "1";

    const drag = {
      pointerId: null as number | null,
      active: false,
      moved: false,
      startX: 0,
      startY: 0,
      originLeft: 0,
      originTop: 0,
    };

    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      hideMenu();
      button.setPointerCapture(event.pointerId);
      const rect = host.getBoundingClientRect();
      drag.pointerId = event.pointerId;
      drag.active = true;
      drag.moved = false;
      drag.startX = event.clientX;
      drag.startY = event.clientY;
      drag.originLeft = rect.left;
      drag.originTop = rect.top;
      host.classList.add("is-dragging");
    });

    button.addEventListener("pointermove", (event) => {
      if (!drag.active || drag.pointerId !== event.pointerId) {
        return;
      }
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
        return;
      }
      drag.moved = true;
      const next = clampPetPosition(drag.originLeft + dx, drag.originTop + dy);
      savedPetPosition = next;
      applyPetPosition(host, next);
    });

    const endPointer = (event: PointerEvent) => {
      if (!drag.active || drag.pointerId !== event.pointerId) {
        return;
      }
      drag.active = false;
      drag.pointerId = null;
      host.classList.remove("is-dragging");
      try {
        button.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      if (drag.moved) {
        void persistPetPosition();
        return;
      }
      openSidePanelFromPet();
    };

    button.addEventListener("pointerup", endPointer);
    button.addEventListener("pointercancel", endPointer);

    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleMenu();
    });

    menu?.querySelectorAll<HTMLButtonElement>("[data-pet-action]").forEach((item) => {
      item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const action = item.dataset.petAction;
        hideMenu();
        if (action === "chat") {
          showComposer();
          return;
        }
        if (action === "open") {
          openSidePanelFromPet();
          return;
        }
        if (action === "mute") {
          controller.setMuted(!petMuted);
        }
      });
    });

    composer?.addEventListener("submit", (event) => {
      event.preventDefault();
      const content = input?.value.trim() ?? "";
      if (!content) {
        return;
      }
      sendPetChat(content);
      if (input) {
        input.value = "";
      }
      hideComposer();
    });

    document.addEventListener("pointerdown", (event) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!host.contains(target)) {
        hideMenu();
      }
    });
  }

  function toggleMenu(): void {
    const host = document.querySelector<HTMLElement>(PET_HOST_SELECTOR);
    const menu = host?.querySelector<HTMLElement>(".moon-pet-menu");
    if (!menu) {
      return;
    }
    menu.hidden = !menu.hidden;
    if (!menu.hidden) {
      hideComposer();
      const muteButton = menu.querySelector<HTMLButtonElement>('[data-pet-action="mute"]');
      if (muteButton) {
        muteButton.textContent = petMuted ? "取消静音" : "静音气泡";
      }
    }
  }

  function hideMenu(): void {
    const host = document.querySelector<HTMLElement>(PET_HOST_SELECTOR);
    const menu = host?.querySelector<HTMLElement>(".moon-pet-menu");
    if (menu) {
      menu.hidden = true;
    }
  }

  function showComposer(): void {
    const host = document.querySelector<HTMLElement>(PET_HOST_SELECTOR);
    const composer = host?.querySelector<HTMLFormElement>(".moon-pet-composer");
    const input = host?.querySelector<HTMLInputElement>(".moon-pet-input");
    if (!composer || !input) {
      return;
    }
    hideMenu();
    composer.hidden = false;
    window.requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  function hideComposer(): void {
    const host = document.querySelector<HTMLElement>(PET_HOST_SELECTOR);
    const composer = host?.querySelector<HTMLFormElement>(".moon-pet-composer");
    if (composer) {
      composer.hidden = true;
    }
  }

  function sendPetChat(content: string): void {
    const next: PetRuntimeSnapshot = {
      state: "thinking",
      badge: "running",
      stateLabel: "思考中",
      bubble: "思考中…",
      muted: petMuted,
      updatedAt: Date.now(),
    };
    controller.applySnapshot(next);
    publishSnapshot(next);
    try {
      void chrome.runtime.sendMessage(
        {
          type: PET_CHAT_SEND_TYPE,
          content,
          source: options.openSidePanel ? "newtab" : "page",
        },
        () => {
          void chrome.runtime.lastError;
        },
      );
    } catch {
      // ignore
    }
  }

  function renderPagePet(): void {
    const host = document.querySelector<HTMLElement>(PET_HOST_SELECTOR);
    if (!host) {
      return;
    }
    const img = host.querySelector<HTMLImageElement>(".moon-pet-img");
    const bubble = host.querySelector<HTMLElement>(".moon-pet-bubble");
    const stateEl = host.querySelector<HTMLElement>(".moon-pet-state");
    const badge = host.querySelector<HTMLElement>(".moon-pet-badge");
    const button = host.querySelector<HTMLButtonElement>(".moon-pet-button");
    const muteMenuItem = host.querySelector<HTMLButtonElement>('[data-pet-action="mute"]');

    host.dataset.state = petSnapshot.state;
    host.dataset.badge = petSnapshot.badge || "idle";

    if (img) {
      const path = resolvePublicCatAssetPath(petSnapshot.state, petPoolIndex);
      const src = chrome.runtime.getURL(path);
      if (img.getAttribute("src") !== src) {
        img.src = src;
      }
    }

    if (stateEl) {
      stateEl.textContent = petSnapshot.stateLabel || "待命";
    }

    if (badge) {
      badge.className = `moon-pet-badge is-${petSnapshot.badge || "idle"}`;
    }

    if (muteMenuItem) {
      muteMenuItem.textContent = petMuted ? "取消静音" : "静音气泡";
    }

    if (bubble) {
      const text = !petMuted && petSnapshot.bubble ? petSnapshot.bubble : "";
      if (text) {
        bubble.hidden = false;
        bubble.textContent = text;
      } else {
        bubble.hidden = true;
        bubble.textContent = "";
      }
    }

    if (button) {
      const label = `${petSnapshot.stateLabel || "待命"} · 左键打开侧栏 · 右键菜单`;
      button.title = label;
      button.setAttribute("aria-label", label);
    }
  }

  function applyPetPosition(host: HTMLElement, position?: { left: number; top: number }): void {
    host.style.position = "fixed";
    host.style.zIndex = "2147483646";
    host.style.width = `${PET_SIZE}px`;
    host.style.margin = "0";
    host.style.padding = "0";
    host.style.border = "0";
    host.style.background = "transparent";
    host.style.overflow = "visible";
    host.style.pointerEvents = "auto";

    if (position && Number.isFinite(position.left) && Number.isFinite(position.top)) {
      const clamped = clampPetPosition(position.left, position.top);
      host.style.left = `${clamped.left}px`;
      host.style.top = `${clamped.top}px`;
      host.style.right = "auto";
      host.style.bottom = "auto";
      return;
    }

    host.style.right = "16px";
    host.style.bottom = "16px";
    host.style.left = "auto";
    host.style.top = "auto";
  }

  function clampPetPosition(left: number, top: number): { left: number; top: number } {
    const maxLeft = Math.max(0, window.innerWidth - PET_SIZE);
    const maxTop = Math.max(0, window.innerHeight - PET_SIZE - 28);
    return {
      left: Math.min(Math.max(0, left), maxLeft),
      top: Math.min(Math.max(0, top), maxTop),
    };
  }

  async function persistPetPosition(): Promise<void> {
    if (!savedPetPosition) {
      return;
    }
    try {
      await chrome.storage?.local?.set?.({ [PET_POSITION_STORAGE_KEY]: savedPetPosition });
    } catch {
      // ignore
    }
  }

  async function restorePetPrefs(): Promise<void> {
    try {
      const items = await chrome.storage?.local?.get?.([PET_POSITION_STORAGE_KEY, PET_MUTED_STORAGE_KEY]);
      const position = items?.[PET_POSITION_STORAGE_KEY];
      if (
        position &&
        typeof position === "object" &&
        typeof (position as { left?: unknown }).left === "number" &&
        typeof (position as { top?: unknown }).top === "number"
      ) {
        savedPetPosition = {
          left: (position as { left: number }).left,
          top: (position as { top: number }).top,
        };
      }
      petMuted = items?.[PET_MUTED_STORAGE_KEY] === true;
    } catch {
      // ignore
    }
  }

  function openSidePanelFromPet(): void {
    if (typeof options.openSidePanel === "function") {
      options.openSidePanel();
      return;
    }
    try {
      void chrome.runtime.sendMessage({ type: PET_OPEN_SIDE_PANEL_TYPE }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // ignore
    }
  }

  function ensurePetStyles(): void {
    if (document.getElementById(PET_STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = PET_STYLE_ID;
    style.textContent = `
      .moon-pet-host {
        width: ${PET_SIZE}px;
        display: grid;
        justify-items: center;
        gap: 4px;
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        color: #2b241c;
        user-select: none;
      }
      .moon-pet-bubble {
        max-width: 168px;
        padding: 6px 10px;
        border-radius: 12px;
        border: 1px solid rgba(43,36,28,.12);
        background: rgba(255,250,242,.94);
        box-shadow: 0 10px 28px rgba(43,36,28,.12);
        font-size: 11px;
        line-height: 1.35;
        text-align: center;
        pointer-events: none;
      }
      .moon-pet-button {
        position: relative;
        width: 88px;
        height: 88px;
        border: 0;
        padding: 0;
        background: transparent;
        cursor: grab;
        border-radius: 18px;
        touch-action: none;
      }
      .moon-pet-host.is-dragging .moon-pet-button { cursor: grabbing; }
      .moon-pet-img {
        width: 88px;
        height: 88px;
        object-fit: contain;
        display: block;
        filter: drop-shadow(0 8px 14px rgba(43,36,28,.18));
        pointer-events: none;
      }
      .moon-pet-badge {
        position: absolute;
        right: 8px;
        bottom: 8px;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        border: 2px solid rgba(255,255,255,.9);
        background: #b7b1a6;
      }
      .moon-pet-badge.is-running { background: #2f9e8f; }
      .moon-pet-badge.is-done { background: #4caf70; }
      .moon-pet-badge.is-interrupted { background: #d95c63; }
      .moon-pet-badge.is-idle { background: #b7b1a6; }
      .moon-pet-meta {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .moon-pet-state {
        font-size: 11px;
        font-weight: 650;
        color: rgba(43,36,28,.78);
        text-shadow: 0 1px 0 rgba(255,255,255,.55);
      }
      .moon-pet-menu {
        display: grid;
        gap: 4px;
        min-width: 108px;
        padding: 6px;
        border-radius: 12px;
        border: 1px solid rgba(43,36,28,.12);
        background: rgba(255,250,242,.96);
        box-shadow: 0 10px 24px rgba(43,36,28,.16);
      }
      .moon-pet-menu[hidden] { display: none !important; }
      .moon-pet-menu button {
        border: 0;
        background: transparent;
        color: rgba(43,36,28,.86);
        border-radius: 8px;
        padding: 6px 8px;
        font-size: 12px;
        text-align: left;
        cursor: pointer;
      }
      .moon-pet-menu button:hover {
        background: rgba(239,216,176,.45);
      }
      .moon-pet-composer {
        width: 168px;
        margin-top: 2px;
      }
      .moon-pet-composer[hidden] { display: none !important; }
      .moon-pet-input {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid rgba(43,36,28,.14);
        border-radius: 999px;
        background: rgba(255,250,242,.96);
        color: #2b241c;
        padding: 8px 12px;
        font-size: 12px;
        outline: none;
        box-shadow: 0 6px 18px rgba(43,36,28,.12);
      }
      .moon-pet-input:focus {
        border-color: rgba(47,158,143,.55);
        box-shadow: 0 0 0 3px rgba(47,158,143,.14), 0 6px 18px rgba(43,36,28,.12);
      }
      @media (prefers-reduced-motion: reduce) {
        .moon-pet-img { filter: drop-shadow(0 4px 8px rgba(43,36,28,.14)); }
      }
    `;
    document.documentElement.appendChild(style);
  }
}
