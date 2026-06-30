// Unified MV3 service worker entry.
// Loads the new-tab redirect logic and the embedded Browser AI Assistant background.
// Each module registers its own chrome.* event listeners on import.
import "./newtab-redirect.js";
import "../ai-assistant/background/index.js";

const FLOATING_ASSISTANT_PATH = "src/ai-assistant/index.html?floating=1";
const FLOATING_OPEN_TYPE = "sidepanelFloating.openCurrentTab";
const FLOATING_CONTENT_OPEN_TYPE = "sidepanelFloating.open";
const SIDE_PANEL_CLOSE_TYPE = "sidePanel.close";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || message.type !== FLOATING_OPEN_TYPE) {
    return false;
  }

  openFloatingAssistantInCurrentTab().then(sendResponse);
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || message.type !== SIDE_PANEL_CLOSE_TYPE) {
    return false;
  }

  closeSidePanelFromRequest(message).then(sendResponse);
  return true;
});

async function openFloatingAssistantInCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (typeof tab?.id !== "number") {
      return { ok: false, message: "未找到当前活动页面，无法打开悬浮窗。" };
    }
    if (!isFloatingSupportedUrl(tab.url)) {
      return {
        ok: false,
        message: "当前页面不支持悬浮窗，请切换到普通网页后重试。",
      };
    }

    const payload = {
      type: FLOATING_CONTENT_OPEN_TYPE,
      url: chrome.runtime.getURL(FLOATING_ASSISTANT_PATH),
    };
    const response = await sendFloatingMessageToTab(tab.id, payload);
    if (response?.ok) {
      await closeSidePanelAfterFloatingOpen(tab);
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return { ok: false, message: `打开悬浮窗失败：${message}` };
  }
}

async function closeSidePanelAfterFloatingOpen(tab) {
  await closeSidePanelTargets([
    typeof tab.id === "number" ? { tabId: tab.id } : null,
    typeof tab.windowId === "number" ? { windowId: tab.windowId } : null,
  ]);
}

async function closeSidePanelFromRequest(message) {
  const targets = [
    typeof message.tabId === "number" ? { tabId: message.tabId } : null,
    typeof message.windowId === "number" ? { windowId: message.windowId } : null,
  ];
  const closed = await closeSidePanelTargets(targets);
  return {
    ok: closed,
    message: closed ? "已关闭侧边栏" : "当前浏览器不支持自动关闭侧边栏",
  };
}

async function closeSidePanelTargets(targets) {
  const close = chrome.sidePanel?.close;
  if (typeof close !== "function") {
    return false;
  }

  for (const target of targets.filter(Boolean)) {
    try {
      await close.call(chrome.sidePanel, target);
      return true;
    } catch (_error) {
      // 不同浏览器对 tabId/windowId 支持不完全一致，逐个尝试即可。
    }
  }
  return false;
}

async function sendFloatingMessageToTab(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (error) {
    if (!isMissingContentScriptError(error)) {
      throw error;
    }
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/index.js"],
  });
  return await chrome.tabs.sendMessage(tabId, payload);
}

function isFloatingSupportedUrl(url) {
  return Boolean(url && /^(https?:|file:)/i.test(url));
}

function isMissingContentScriptError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /Receiving end does not exist|Could not establish connection/i.test(message);
}
