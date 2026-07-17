import type { ExtractionRule, ExtractionSelectorType, PageContextExtractMode } from "../shared/types";
import {
  CONTROL_BEACON_ACTIVE_STORAGE_KEY,
  CONTROL_BEACON_CLOSE_TYPE,
  CONTROL_BEACON_POSITION_STORAGE_KEY,
  LEGACY_SIDE_PANEL_FLOATING_ATTACH_TYPE,
  SIDE_PANEL_FLOATING_ATTACH_TYPE,
  SIDE_PANEL_FLOATING_CLOSE_TYPE,
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

const BEACON_HOST_SELECTOR = "[data-moon-tab-ai-control-beacon-host]";
const BEACON_STYLE_ID = "moon-tab-control-beacon-style";
const BEACON_SIZE = 96;
const DRAG_THRESHOLD_PX = 4;

interface BeaconToolRecord {
  id: string;
  name: string;
  displayName?: string;
  status: "running" | "success" | "error" | string;
  resultSummary?: string;
  errorMessage?: string;
}

let savedBeaconPosition: { left: number; top: number } | undefined;
let beaconExpanded = false;
let beaconPhase: "idle" | "running" | "done" | "error" = "idle";
let beaconRecords: BeaconToolRecord[] = [];
let liveMessageBridgeInstalled = false;

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

void restoreControlBeaconPosition();
ensureAutomationLiveBridge();

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isSidePanelContentMessage(message)) {
    if (message.type === SIDE_PANEL_FLOATING_CLOSE_TYPE) {
      closeFloatingAssistantFrame();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === CONTROL_BEACON_CLOSE_TYPE) {
      closeControlBeaconHost();
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

  // Control beacon is a native in-page orb (no iframe), so drag/transparency work reliably.
  if (isControlBeaconUrl(url)) {
    mountNativeControlBeacon();
    return { ok: true };
  }

  let frame = document.querySelector<HTMLIFrameElement>("iframe[data-moon-tab-ai-floating-frame]");
  if (!frame) {
    frame = document.createElement("iframe");
    frame.dataset.moonTabAiFloatingFrame = "true";
    frame.allow = "clipboard-read; clipboard-write";
    frame.style.position = "fixed";
    frame.style.border = "0";
    frame.style.zIndex = "2147483647";
    frame.style.background = "transparent";
    frame.style.colorScheme = "normal";
    frame.style.right = "20px";
    frame.style.bottom = "20px";
    frame.style.width = "420px";
    frame.style.height = "680px";
    frame.style.maxWidth = "calc(100vw - 40px)";
    frame.style.maxHeight = "calc(100vh - 40px)";
    frame.style.borderRadius = "8px";
    frame.style.boxShadow = "0 24px 80px rgba(15, 23, 42, 0.28)";
    frame.style.overflow = "hidden";
    document.documentElement.appendChild(frame);
  }
  if (frame.src !== url) {
    frame.src = url;
  }
  return { ok: true };
}

function mountNativeControlBeacon(): void {
  ensureBeaconStyles();
  // Clean leftover iframe-based beacon from older builds.
  document.querySelectorAll("iframe[data-moon-tab-ai-control-beacon]").forEach((node) => node.remove());

  let host = document.querySelector<HTMLElement>(BEACON_HOST_SELECTOR);
  if (!host) {
    host = document.createElement("div");
    host.dataset.moonTabAiControlBeaconHost = "true";
    host.className = "moon-orb-host";
    host.innerHTML = `
      <button type="button" class="moon-orb-button" aria-label="浏览器控制信标">
        <span class="moon-orb-ring moon-orb-ring-a" aria-hidden="true"></span>
        <span class="moon-orb-ring moon-orb-ring-b" aria-hidden="true"></span>
        <span class="moon-orb-core" aria-hidden="true">
          <span class="moon-orb-glow"></span>
          <span class="moon-orb-sphere"></span>
          <span class="moon-orb-highlight"></span>
          <span class="moon-orb-pupil"></span>
        </span>
      </button>
      <div class="moon-orb-tip" aria-live="polite"></div>
      <div class="moon-orb-trail" hidden></div>
    `;
    document.documentElement.appendChild(host);
    wireBeaconInteractions(host);
  }

  applyBeaconPosition(host, savedBeaconPosition);
  renderBeacon(host);
}

function wireBeaconInteractions(host: HTMLElement): void {
  const button = host.querySelector<HTMLButtonElement>(".moon-orb-button");
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
    const next = clampBeaconPosition(drag.originLeft + dx, drag.originTop + dy);
    savedBeaconPosition = next;
    applyBeaconPosition(host, next);
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
      void persistControlBeaconPosition();
      return;
    }
    beaconExpanded = !beaconExpanded;
    renderBeacon(host);
  };

  button.addEventListener("pointerup", endPointer);
  button.addEventListener("pointercancel", endPointer);
}

function renderBeacon(host: HTMLElement): void {
  const latest = beaconRecords[beaconRecords.length - 1];
  const tip = host.querySelector<HTMLElement>(".moon-orb-tip");
  const trail = host.querySelector<HTMLElement>(".moon-orb-trail");
  const button = host.querySelector<HTMLButtonElement>(".moon-orb-button");

  host.dataset.phase = beaconPhase;
  host.classList.toggle("is-expanded", beaconExpanded);

  const tooltip = latest
    ? `${shortName(latest)} · ${statusLabel(latest.status)}`
    : beaconPhase === "running"
      ? "模型思考中"
      : "浏览器控制已开 · 可拖动";

  if (tip) {
    tip.textContent = tooltip;
  }
  if (button) {
    button.title = tooltip;
    button.setAttribute("aria-label", tooltip);
    button.setAttribute("aria-expanded", beaconExpanded ? "true" : "false");
  }

  if (!trail) {
    return;
  }
  if (!beaconExpanded) {
    trail.hidden = true;
    trail.innerHTML = "";
    return;
  }

  trail.hidden = false;
  const chips = beaconRecords.slice(-5);
  if (chips.length === 0) {
    trail.innerHTML = `<div class="moon-orb-chip is-empty">等待工具调用</div>`;
    return;
  }
  trail.innerHTML = chips
    .map(
      (record) =>
        `<div class="moon-orb-chip is-${escapeAttr(record.status)}"><span>${escapeHtml(shortName(record))}</span><span>${escapeHtml(statusLabel(record.status))}</span></div>`,
    )
    .join("");
}

function ensureAutomationLiveBridge(): void {
  if (liveMessageBridgeInstalled) {
    return;
  }
  liveMessageBridgeInstalled = true;
  chrome.runtime.onMessage.addListener((message: unknown) => {
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
      const record = (payload as { record?: BeaconToolRecord }).record;
      if (record?.id) {
        beaconRecords = mergeRecord(beaconRecords, record).slice(-8);
        beaconPhase = eventType === "tool:start" ? "running" : record.status === "error" ? "error" : "running";
        const host = document.querySelector<HTMLElement>(BEACON_HOST_SELECTOR);
        if (host) {
          renderBeacon(host);
        }
      }
      return;
    }
    if (eventType === "complete") {
      beaconPhase = "done";
    } else if (eventType === "error" || eventType === "canceled") {
      beaconPhase = "error";
    } else if (eventType === "chunk" || eventType === "assistant:tool-turn") {
      beaconPhase = "running";
    }
    const host = document.querySelector<HTMLElement>(BEACON_HOST_SELECTOR);
    if (host) {
      renderBeacon(host);
    }
  });
}

function mergeRecord(current: BeaconToolRecord[], record: BeaconToolRecord): BeaconToolRecord[] {
  const next = [...current];
  const index = next.findIndex((item) => item.id === record.id);
  if (index >= 0) {
    next[index] = record;
  } else {
    next.push(record);
  }
  return next;
}

function applyBeaconPosition(host: HTMLElement, position?: { left: number; top: number }): void {
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  host.style.width = `${BEACON_SIZE}px`;
  host.style.height = `${BEACON_SIZE}px`;
  host.style.margin = "0";
  host.style.padding = "0";
  host.style.border = "0";
  host.style.background = "transparent";
  host.style.overflow = "visible";
  host.style.pointerEvents = "auto";

  if (position && Number.isFinite(position.left) && Number.isFinite(position.top)) {
    const clamped = clampBeaconPosition(position.left, position.top);
    host.style.left = `${clamped.left}px`;
    host.style.top = `${clamped.top}px`;
    host.style.right = "auto";
    host.style.bottom = "auto";
    return;
  }

  host.style.right = "14px";
  host.style.bottom = "14px";
  host.style.left = "auto";
  host.style.top = "auto";
}

function clampBeaconPosition(left: number, top: number): { left: number; top: number } {
  const maxLeft = Math.max(0, window.innerWidth - BEACON_SIZE);
  const maxTop = Math.max(0, window.innerHeight - BEACON_SIZE);
  return {
    left: Math.min(Math.max(0, left), maxLeft),
    top: Math.min(Math.max(0, top), maxTop),
  };
}

async function persistControlBeaconPosition(): Promise<void> {
  if (!savedBeaconPosition) {
    return;
  }
  try {
    await chrome.storage?.session?.set?.({ [CONTROL_BEACON_POSITION_STORAGE_KEY]: savedBeaconPosition });
  } catch {
    // ignore
  }
}

async function restoreControlBeaconPosition(): Promise<void> {
  try {
    const items = await chrome.storage?.session?.get?.([
      CONTROL_BEACON_POSITION_STORAGE_KEY,
      CONTROL_BEACON_ACTIVE_STORAGE_KEY,
    ]);
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
    }
    // Do NOT auto-remount on page load. Only browser-control enable should show the orb.
  } catch {
    // ignore
  }
}

function closeFloatingAssistantFrame(): void {
  document.querySelector<HTMLIFrameElement>("iframe[data-moon-tab-ai-floating-frame]")?.remove();
  closeControlBeaconHost();
}

function closeControlBeaconHost(): void {
  document.querySelectorAll(BEACON_HOST_SELECTOR).forEach((node) => node.remove());
  document.querySelectorAll("iframe[data-moon-tab-ai-control-beacon]").forEach((node) => node.remove());
  beaconExpanded = false;
  beaconPhase = "idle";
  beaconRecords = [];
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

function statusLabel(status: string): string {
  if (status === "running") return "进行中";
  if (status === "success") return "完成";
  if (status === "error") return "失败";
  return status;
}

function shortName(record: BeaconToolRecord): string {
  const label = (record.displayName || record.name || "").trim();
  return label.length > 18 ? `${label.slice(0, 17)}…` : label;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll(" ", "-");
}

function ensureBeaconStyles(): void {
  if (document.getElementById(BEACON_STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = BEACON_STYLE_ID;
  style.textContent = `
    .moon-orb-host {
      --orb-amber: #ffb454;
      --orb-cyan: #42e8d0;
      --orb-mint: #8dffb0;
      --orb-danger: #ff5d73;
      width: ${BEACON_SIZE}px;
      height: ${BEACON_SIZE}px;
      background: transparent !important;
      box-shadow: none !important;
      border: 0 !important;
    }
    .moon-orb-button {
      position: relative;
      width: ${BEACON_SIZE}px;
      height: ${BEACON_SIZE}px;
      border: 0;
      padding: 0;
      background: transparent;
      cursor: grab;
      touch-action: none;
      user-select: none;
    }
    .moon-orb-host.is-dragging .moon-orb-button { cursor: grabbing; }
    .moon-orb-ring {
      position: absolute;
      inset: 0;
      margin: auto;
      border-radius: 50%;
      border: 1px solid rgba(255, 180, 84, 0.3);
      pointer-events: none;
    }
    .moon-orb-ring-a {
      width: 88px;
      height: 88px;
      border-style: dashed;
      border-color: rgba(66, 232, 208, 0.35);
      animation: moon-orb-spin 14s linear infinite;
    }
    .moon-orb-ring-b {
      width: 72px;
      height: 72px;
      animation: moon-orb-spin 9s linear infinite reverse;
    }
    .moon-orb-core {
      position: absolute;
      inset: 0;
      margin: auto;
      width: 52px;
      height: 52px;
      pointer-events: none;
    }
    .moon-orb-glow {
      position: absolute;
      inset: -14px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(255, 180, 84, 0.55), transparent 68%);
      filter: blur(6px);
      animation: moon-orb-breathe 2.8s ease-in-out infinite;
    }
    .moon-orb-sphere {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background:
        radial-gradient(circle at 32% 28%, rgba(255,255,255,.78), transparent 28%),
        radial-gradient(circle at 68% 72%, rgba(255,107,74,.92), transparent 48%),
        linear-gradient(145deg, #ffd089 0%, #ff7a4d 48%, #2ad5c2 100%);
      box-shadow: 0 8px 22px rgba(7,16,24,.35), 0 0 24px rgba(255,180,84,.45);
      animation: moon-orb-morph 4.8s ease-in-out infinite;
    }
    .moon-orb-highlight {
      position: absolute;
      top: 10px;
      left: 14px;
      width: 14px;
      height: 10px;
      border-radius: 50%;
      background: rgba(255,255,255,.55);
      filter: blur(1px);
      transform: rotate(-18deg);
    }
    .moon-orb-pupil {
      position: absolute;
      inset: 0;
      margin: auto;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #071018;
      box-shadow: 0 0 0 2px rgba(244,239,230,.28), 0 0 12px rgba(66,232,208,.7);
    }
    .moon-orb-host[data-phase="running"] .moon-orb-glow {
      background: radial-gradient(circle, rgba(66,232,208,.55), transparent 68%);
      animation-duration: 1.2s;
    }
    .moon-orb-host[data-phase="error"] .moon-orb-sphere {
      background: linear-gradient(145deg, #ff9aa8 0%, #ff5d73 52%, #ff8f4a 100%);
    }
    .moon-orb-host[data-phase="done"] .moon-orb-sphere {
      background: linear-gradient(145deg, #c8ffd8 0%, #8dffb0 45%, #42e8d0 100%);
    }
    .moon-orb-tip {
      position: absolute;
      left: 50%;
      bottom: calc(100% + 8px);
      transform: translateX(-50%);
      max-width: 180px;
      padding: 5px 8px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,.08);
      background: rgba(7,16,24,.72);
      color: rgba(244,239,230,.9);
      font: 10px/1.2 "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      opacity: 0;
      pointer-events: none;
      transition: opacity .16s ease;
      backdrop-filter: blur(8px);
    }
    .moon-orb-button:hover + .moon-orb-tip,
    .moon-orb-host.is-expanded .moon-orb-tip,
    .moon-orb-button:focus-visible + .moon-orb-tip {
      opacity: 1;
    }
    .moon-orb-trail {
      position: absolute;
      right: 0;
      bottom: calc(100% + 34px);
      display: grid;
      gap: 5px;
      width: 168px;
      max-height: 140px;
      overflow: auto;
      pointer-events: auto;
    }
    .moon-orb-chip {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
      padding: 6px 9px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,.08);
      background: rgba(7,16,24,.78);
      color: rgba(244,239,230,.9);
      font: 10px/1.2 "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      backdrop-filter: blur(10px);
    }
    .moon-orb-chip > span:first-child {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 650;
    }
    .moon-orb-chip.is-empty { justify-content: center; }
    .moon-orb-chip.is-running { border-color: rgba(66,232,208,.35); }
    .moon-orb-chip.is-success { border-color: rgba(141,255,176,.28); }
    .moon-orb-chip.is-error { border-color: rgba(255,93,115,.35); }
    @keyframes moon-orb-spin { to { transform: rotate(360deg); } }
    @keyframes moon-orb-morph {
      0%,100% { border-radius: 50%; transform: scale(1); }
      40% { border-radius: 46% 54% 48% 52% / 52% 46% 54% 48%; transform: scale(1.05); }
      70% { border-radius: 54% 46% 52% 48% / 48% 54% 46% 52%; transform: scale(.97); }
    }
    @keyframes moon-orb-breathe {
      0%,100% { opacity: .5; transform: scale(.9); }
      50% { opacity: .95; transform: scale(1.12); }
    }
    @media (prefers-reduced-motion: reduce) {
      .moon-orb-ring, .moon-orb-sphere, .moon-orb-glow { animation: none !important; }
    }
  `;
  document.documentElement.appendChild(style);
}

/** Test helper: expose host selector for unit tests. */
export function getControlBeaconHostSelectorForTests(): string {
  return BEACON_HOST_SELECTOR;
}
