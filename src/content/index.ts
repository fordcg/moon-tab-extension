import type { ExtractionRule, ExtractionSelectorType, PageContextExtractMode } from "../shared/types";
import {
  LEGACY_SIDE_PANEL_FLOATING_ATTACH_TYPE,
  SIDE_PANEL_FLOATING_ATTACH_TYPE,
  SIDE_PANEL_FLOATING_CLOSE_TYPE,
  type SidePanelContentMessage,
} from "../shared/sidePanelRuntime";
import { getPagePetHostSelectorForTests, mountFloatingPetCompanion } from "../shared/pet/pagePetHost";
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
    message.type === SIDE_PANEL_FLOATING_CLOSE_TYPE
  ));
}

// Floating AI pet on normal web pages (newtab mounts the same host separately).
mountFloatingPetCompanion();

const handleContentRuntimeMessage = (message: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
  if (isSidePanelContentMessage(message)) {
    if (message.type === SIDE_PANEL_FLOATING_CLOSE_TYPE) {
      closeFloatingAssistantFrame();
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
};

try {
  chrome.runtime.onMessage.addListener(handleContentRuntimeMessage);
} catch (error) {
  if (!isExtensionContextInvalidatedError(error)) {
    throw error;
  }
}

function attachFloatingAssistantFrame(url: string): { ok: true } | { ok: false; message: string } {
  if (!isTrustedFloatingFrameUrl(url)) {
    return { ok: false, message: "悬浮窗地址无效" };
  }

  if (isLegacyControlBeaconUrl(url)) {
    return { ok: false, message: "控制信标已移除，请使用页面 AI 伴侣" };
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

function closeFloatingAssistantFrame(): void {
  document.querySelector<HTMLIFrameElement>("iframe[data-moon-tab-ai-floating-frame]")?.remove();
  document.querySelectorAll("[data-moon-tab-ai-control-beacon-host]").forEach((node) => node.remove());
  document.querySelectorAll("iframe[data-moon-tab-ai-control-beacon]").forEach((node) => node.remove());
  document.getElementById("moon-tab-control-beacon-style")?.remove();
}

function isLegacyControlBeaconUrl(url: string): boolean {
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

function isExtensionContextInvalidatedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /extension context invalidated/i.test(message);
}

export { getPagePetHostSelectorForTests };
