import type { ExtractionRule, ExtractionSelectorType, PageContextExtractMode } from "../shared/types";
import {
  CONTROL_BEACON_CLOSE_TYPE,
  CONTROL_BEACON_DRAG_END_TYPE,
  CONTROL_BEACON_DRAG_MOVE_TYPE,
  CONTROL_BEACON_FRAME_SOURCE,
  CONTROL_BEACON_HOST_MESSAGE_TYPE,
  CONTROL_BEACON_LAYOUT_TYPE,
  CONTROL_BEACON_POSITION_STORAGE_KEY,
  LEGACY_SIDE_PANEL_FLOATING_ATTACH_TYPE,
  SIDE_PANEL_FLOATING_ATTACH_TYPE,
  SIDE_PANEL_FLOATING_CLOSE_TYPE,
  isControlBeaconFrameMessage,
  isControlBeaconHostRuntimeMessage,
  type SidePanelContentMessage,
} from "../shared/sidePanelRuntime";
import { extractPageText } from "./extractPageText";

export interface PageContextExtractMessage {
  type: "pageContext.extract";
  rules: ExtractionRule[];
  maxLength?: number;
  extractMode?: PageContextExtractMode;
  selectorType?: ExtractionSelectorType;
  allowFallback?: boolean;
}

export interface PageContextExtractResponse {
  ok: true;
  url: string;
  title?: string;
  text: string;
  truncated: boolean;
  usedFallback: boolean;
  matchedRuleId?: string;
}

const BEACON_FRAME_SELECTOR = "iframe[data-moon-tab-ai-control-beacon]";
const BEACON_COMPACT_SIZE = 176;
const BEACON_EXPANDED_WIDTH = 196;
const BEACON_EXPANDED_HEIGHT = 280;

let controlBeaconDragBridgeInstalled = false;
let controlBeaconExpanded = false;
let savedBeaconPosition: { left: number; top: number } | undefined;

function isPageContextExtractMessage(message: unknown): message is PageContextExtractMessage {
  return Boolean(
    message &&
      typeof message === "object" &&
      "type" in message &&
      message.type === "pageContext.extract" &&
      "rules" in message &&
      Array.isArray(message.rules),
  );
}

function isSidePanelContentMessage(message: unknown): message is SidePanelContentMessage {
  return Boolean(message && typeof message === "object" && "type" in message && (
    message.type === SIDE_PANEL_FLOATING_ATTACH_TYPE ||
    message.type === LEGACY_SIDE_PANEL_FLOATING_ATTACH_TYPE ||
    message.type === SIDE_PANEL_FLOATING_CLOSE_TYPE ||
    message.type === CONTROL_BEACON_CLOSE_TYPE
  ));
}

ensureControlBeaconDragBridge();
void restoreControlBeaconPosition();

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isControlBeaconHostRuntimeMessage(message)) {
    const ok = handleControlBeaconHostMessage({
      source: CONTROL_BEACON_FRAME_SOURCE,
      ...message.payload,
    });
    sendResponse({ ok });
    return false;
  }

  if (isSidePanelContentMessage(message)) {
    if (message.type === SIDE_PANEL_FLOATING_CLOSE_TYPE) {
      closeFloatingAssistantFrame();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === CONTROL_BEACON_CLOSE_TYPE) {
      closeControlBeaconFrame();
      sendResponse({ ok: true });
      return false;
    }

    const response = attachFloatingAssistantFrame(message.url);
    sendResponse(response);
    return false;
  }

  if (!isPageContextExtractMessage(message)) {
    return false;
  }

  const result = extractPageText({
    url: window.location.href,
    rules: message.rules,
    maxLength: message.maxLength,
    extractMode: message.extractMode ?? "text",
    selectorType: message.selectorType,
    allowFallback: message.allowFallback,
  });

  sendResponse({
    ok: true,
    url: window.location.href,
    title: document.title,
    ...result,
  });

  return false;
});

function attachFloatingAssistantFrame(url: string): { ok: true } | { ok: false; message: string } {
  if (!isTrustedFloatingFrameUrl(url)) {
    return { ok: false, message: "悬浮窗地址无效" };
  }

  const isBeacon = isControlBeaconUrl(url);
  const frameKey = isBeacon ? "moonTabAiControlBeacon" : "moonTabAiFloatingFrame";
  const selector = isBeacon
    ? BEACON_FRAME_SELECTOR
    : "iframe[data-moon-tab-ai-floating-frame]";

  let frame = document.querySelector<HTMLIFrameElement>(selector);
  if (!frame) {
    frame = document.createElement("iframe");
    if (isBeacon) {
      frame.dataset.moonTabAiControlBeacon = "true";
    } else {
      frame.dataset.moonTabAiFloatingFrame = "true";
    }
    frame.allow = "clipboard-read; clipboard-write";
    frame.style.position = "fixed";
    frame.style.border = "0";
    frame.style.zIndex = "2147483647";
    frame.style.background = "transparent";
    frame.style.colorScheme = "normal";
    applyFloatingFrameLayout(frame, isBeacon);
    document.documentElement.appendChild(frame);
  } else {
    applyFloatingFrameLayout(frame, isBeacon);
  }
  frame.dataset[frameKey] = "true";
  if (frame.src !== url) {
    frame.src = url;
  }
  return { ok: true };
}

function applyFloatingFrameLayout(frame: HTMLIFrameElement, isBeacon: boolean): void {
  if (isBeacon) {
    // Pure floating orb: transparent box large enough for tip/trail, orb sits bottom-right.
    const width = controlBeaconExpanded ? BEACON_EXPANDED_WIDTH : BEACON_COMPACT_SIZE;
    const height = controlBeaconExpanded ? BEACON_EXPANDED_HEIGHT : BEACON_COMPACT_SIZE;
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    frame.style.maxWidth = `min(${width}px, calc(100vw - 12px))`;
    frame.style.maxHeight = `min(${height}px, calc(100vh - 12px))`;
    frame.style.borderRadius = "0";
    frame.style.boxShadow = "none";
    frame.style.overflow = "visible";
    frame.style.pointerEvents = "auto";
    frame.style.background = "transparent";
    applyControlBeaconPosition(frame, savedBeaconPosition);
    return;
  }

  frame.style.right = "20px";
  frame.style.bottom = "20px";
  frame.style.left = "auto";
  frame.style.top = "auto";
  frame.style.width = "420px";
  frame.style.height = "680px";
  frame.style.maxWidth = "calc(100vw - 40px)";
  frame.style.maxHeight = "calc(100vh - 40px)";
  frame.style.borderRadius = "8px";
  frame.style.boxShadow = "0 24px 80px rgba(15, 23, 42, 0.28)";
  frame.style.overflow = "hidden";
}

function applyControlBeaconPosition(frame: HTMLIFrameElement, position?: { left: number; top: number }): void {
  if (position && Number.isFinite(position.left) && Number.isFinite(position.top)) {
    const clamped = clampBeaconPosition(position.left, position.top, frame);
    frame.style.left = `${clamped.left}px`;
    frame.style.top = `${clamped.top}px`;
    frame.style.right = "auto";
    frame.style.bottom = "auto";
    return;
  }

  frame.style.right = "10px";
  frame.style.bottom = "10px";
  frame.style.left = "auto";
  frame.style.top = "auto";
}

function clampBeaconPosition(left: number, top: number, frame?: HTMLIFrameElement): { left: number; top: number } {
  const width = frame?.offsetWidth || (controlBeaconExpanded ? BEACON_EXPANDED_WIDTH : BEACON_COMPACT_SIZE);
  const height = frame?.offsetHeight || (controlBeaconExpanded ? BEACON_EXPANDED_HEIGHT : BEACON_COMPACT_SIZE);
  const maxLeft = Math.max(0, window.innerWidth - width);
  const maxTop = Math.max(0, window.innerHeight - height);
  return {
    left: Math.min(Math.max(0, left), maxLeft),
    top: Math.min(Math.max(0, top), maxTop),
  };
}

function moveControlBeaconFrame(dx: number, dy: number): void {
  const frame = document.querySelector<HTMLIFrameElement>(BEACON_FRAME_SELECTOR);
  if (!frame || !Number.isFinite(dx) || !Number.isFinite(dy)) {
    return;
  }
  const rect = frame.getBoundingClientRect();
  const next = clampBeaconPosition(rect.left + dx, rect.top + dy, frame);
  frame.style.left = `${next.left}px`;
  frame.style.top = `${next.top}px`;
  frame.style.right = "auto";
  frame.style.bottom = "auto";
  savedBeaconPosition = next;
}

function persistControlBeaconPosition(): void {
  const frame = document.querySelector<HTMLIFrameElement>(BEACON_FRAME_SELECTOR);
  if (!frame) {
    return;
  }
  const current = savedBeaconPosition
    ? savedBeaconPosition
    : (() => {
        const rect = frame.getBoundingClientRect();
        return { left: rect.left, top: rect.top };
      })();
  const position = clampBeaconPosition(current.left, current.top, frame);
  savedBeaconPosition = position;
  try {
    void chrome.storage?.session?.set?.({ [CONTROL_BEACON_POSITION_STORAGE_KEY]: position });
  } catch {
    // storage is best-effort
  }
}

async function restoreControlBeaconPosition(): Promise<void> {
  try {
    const items = await chrome.storage?.session?.get?.(CONTROL_BEACON_POSITION_STORAGE_KEY);
    const value = items?.[CONTROL_BEACON_POSITION_STORAGE_KEY];
    if (
      value &&
      typeof value === "object" &&
      typeof (value as { left?: unknown }).left === "number" &&
      typeof (value as { top?: unknown }).top === "number"
    ) {
      savedBeaconPosition = {
        left: (value as { left: number }).left,
        top: (value as { top: number }).top,
      };
      const frame = document.querySelector<HTMLIFrameElement>(BEACON_FRAME_SELECTOR);
      if (frame) {
        applyControlBeaconPosition(frame, savedBeaconPosition);
      }
    }
  } catch {
    // ignore
  }
}

function setControlBeaconExpanded(expanded: boolean): void {
  controlBeaconExpanded = Boolean(expanded);
  const frame = document.querySelector<HTMLIFrameElement>(BEACON_FRAME_SELECTOR);
  if (!frame) {
    return;
  }
  applyFloatingFrameLayout(frame, true);
}

export function handleControlBeaconHostMessage(
  data: unknown,
  meta: { origin?: string; source?: MessageEventSource | null } = {},
): boolean {
  if (!isControlBeaconFrameMessage(data)) {
    return false;
  }

  const frame = document.querySelector<HTMLIFrameElement>(BEACON_FRAME_SELECTOR);
  if (!frame) {
    return false;
  }
  if (meta.source != null && meta.source !== frame.contentWindow) {
    return false;
  }

  try {
    const extensionUrl = new URL(chrome.runtime.getURL("index.html"));
    // Node/jsdom reports chrome-extension origin as "null"; real Chrome provides the extension origin.
    if (
      meta.origin &&
      meta.origin !== "null" &&
      extensionUrl.origin &&
      extensionUrl.origin !== "null" &&
      meta.origin !== extensionUrl.origin
    ) {
      return false;
    }
  } catch {
    return false;
  }

  if (data.type === CONTROL_BEACON_DRAG_MOVE_TYPE) {
    moveControlBeaconFrame(Number(data.dx) || 0, Number(data.dy) || 0);
    return true;
  }
  if (data.type === CONTROL_BEACON_DRAG_END_TYPE) {
    persistControlBeaconPosition();
    return true;
  }
  if (data.type === CONTROL_BEACON_LAYOUT_TYPE) {
    setControlBeaconExpanded(Boolean(data.expanded));
    return true;
  }
  return false;
}

function ensureControlBeaconDragBridge(): void {
  if (controlBeaconDragBridgeInstalled) {
    return;
  }
  controlBeaconDragBridgeInstalled = true;

  window.addEventListener("message", (event: MessageEvent) => {
    handleControlBeaconHostMessage(event.data, {
      origin: event.origin,
      source: event.source,
    });
  });
}

function closeFloatingAssistantFrame(): void {
  document.querySelector<HTMLIFrameElement>("iframe[data-moon-tab-ai-floating-frame]")?.remove();
  closeControlBeaconFrame();
}

function closeControlBeaconFrame(): void {
  document.querySelector<HTMLIFrameElement>(BEACON_FRAME_SELECTOR)?.remove();
}

function isControlBeaconUrl(url: string): boolean {
  try {
    return new URL(url).searchParams.get("controlWindow") === "1";
  } catch {
    return false;
  }
}

function isTrustedFloatingFrameUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const extensionUrl = new URL(chrome.runtime.getURL("index.html"));
    const isExtensionProtocol = parsed.protocol === "chrome-extension:" || parsed.protocol === "moz-extension:";
    const isCurrentExtensionHost = parsed.protocol === extensionUrl.protocol && parsed.host === extensionUrl.host;

    return (
      isExtensionProtocol &&
      isCurrentExtensionHost &&
      parsed.pathname === extensionUrl.pathname &&
      parsed.searchParams.get("floating") === "1"
    );
  } catch {
    return false;
  }
}
