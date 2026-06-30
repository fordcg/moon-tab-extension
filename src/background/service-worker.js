// Unified MV3 service worker entry.
// Loads the new-tab redirect logic and the embedded Browser AI Assistant background.
// Each module registers its own chrome.* event listeners on import.
import "./newtab-redirect.js";
import "../ai-assistant/background/index.js";

const SIDE_PANEL_PATH = "src/ai-assistant/index.html";
const FLOATING_ASSISTANT_PATH = "src/ai-assistant/index.html?floating=1";
const FLOATING_OPEN_TYPE = "sidepanelFloating.openCurrentTab";
const FLOATING_CONTENT_OPEN_TYPE = "sidepanelFloating.open";
const SIDE_PANEL_CLOSE_TYPE = "sidePanel.close";
const OPENED_SIDE_PANEL_TABS_KEY = "sidePanel.openedTabs.v1";

void bootstrapTabScopedSidePanel();
chrome.runtime.onInstalled.addListener(bootstrapTabScopedSidePanel);
chrome.runtime.onStartup.addListener(bootstrapTabScopedSidePanel);

chrome.action?.onClicked?.addListener((tab) => {
  void openTabScopedSidePanel(tab?.id);
});

chrome.commands?.onCommand?.addListener((command) => {
  if (command !== "open-side-panel") {
    return;
  }
  void chrome.tabs
    .query({ active: true, currentWindow: true })
    .then(([tab]) => openTabScopedSidePanel(tab?.id))
    .catch(() => undefined);
});

chrome.contextMenus?.onClicked?.addListener((info, tab) => {
  if (info?.menuItemId !== "open-side-panel") {
    return;
  }
  void openTabScopedSidePanel(tab?.id);
});

chrome.tabs?.onActivated?.addListener((activeInfo) => {
  void syncActiveTabSidePanel(activeInfo?.tabId, activeInfo?.windowId);
});

chrome.tabs?.onCreated?.addListener((tab) => {
  void syncTabSidePanelOptions(tab?.id);
});

chrome.tabs?.onRemoved?.addListener((tabId) => {
  void forgetOpenedSidePanelTab(tabId);
});

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

async function bootstrapTabScopedSidePanel() {
  await disableGlobalSidePanelFallback();
  try {
    await chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false });
  } catch (_error) {
    // 不支持 setPanelBehavior 的浏览器忽略即可。
  }
  await syncAllTabsSidePanelOptions();
}

async function openTabScopedSidePanel(tabId) {
  if (typeof tabId !== "number") {
    return false;
  }
  try {
    await rememberOpenedSidePanelTab(tabId);
    await chrome.sidePanel?.setOptions?.({
      tabId,
      path: SIDE_PANEL_PATH,
      enabled: true,
    });
    await chrome.sidePanel?.open?.({ tabId });
    return true;
  } catch (_error) {
    return false;
  }
}

async function syncActiveTabSidePanel(tabId, windowId) {
  if (typeof tabId !== "number") {
    return;
  }
  const opened = await getOpenedSidePanelTabs();
  const isOpened = opened.has(tabId);
  await syncTabSidePanelOptions(tabId, opened);

  // Chrome 通常会在未启用 tab 上自动隐藏 tab-specific side panel。
  // 这里额外关闭 window 里的全局/旧状态面板，清掉旧版 manifest default_path
  // 或热更新前留下的“切到其它标签页仍停在原地”的残影。
  if (!isOpened && typeof windowId === "number") {
    await closeSidePanelTargets([{ windowId }]);
  }
}

async function syncAllTabsSidePanelOptions() {
  const query = chrome.tabs?.query;
  if (typeof query !== "function") {
    return;
  }

  let tabs = [];
  try {
    tabs = await query.call(chrome.tabs, {});
  } catch (_error) {
    return;
  }
  const opened = await getOpenedSidePanelTabs();
  await Promise.all(
    tabs
      .filter((tab) => typeof tab?.id === "number")
      .map((tab) => syncTabSidePanelOptions(tab.id, opened)),
  );
}

async function syncTabSidePanelOptions(tabId, openedTabs) {
  if (typeof tabId !== "number") {
    return;
  }
  const setOptions = chrome.sidePanel?.setOptions;
  if (typeof setOptions !== "function") {
    return;
  }
  const opened = openedTabs || (await getOpenedSidePanelTabs());
  try {
    await setOptions.call(chrome.sidePanel, opened.has(tabId)
      ? { tabId, path: SIDE_PANEL_PATH, enabled: true }
      : { tabId, enabled: false });
  } catch (_error) {
    // 某些内部页面 / 旧版浏览器可能拒绝 tab 级 options，不能影响其它后台逻辑。
  }
}

async function getOpenedSidePanelTabs() {
  const storage = chrome.storage?.session;
  if (!storage?.get) {
    return new Set();
  }
  try {
    const data = await storage.get(OPENED_SIDE_PANEL_TABS_KEY);
    const raw = data?.[OPENED_SIDE_PANEL_TABS_KEY];
    return new Set(
      Array.isArray(raw)
        ? raw.filter((value) => typeof value === "number")
        : [],
    );
  } catch (_error) {
    return new Set();
  }
}

async function writeOpenedSidePanelTabs(opened) {
  const storage = chrome.storage?.session;
  if (!storage?.set) {
    return;
  }
  try {
    await storage.set({
      [OPENED_SIDE_PANEL_TABS_KEY]: Array.from(opened),
    });
  } catch (_error) {
    // session storage 不可用时只失去跨 service worker 唤醒的记忆。
  }
}

async function rememberOpenedSidePanelTab(tabId) {
  const opened = await getOpenedSidePanelTabs();
  opened.add(tabId);
  await writeOpenedSidePanelTabs(opened);
}

async function forgetOpenedSidePanelTab(tabId) {
  const opened = await getOpenedSidePanelTabs();
  if (!opened.delete(tabId)) {
    return;
  }
  await writeOpenedSidePanelTabs(opened);
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

async function disableGlobalSidePanelFallback() {
  try {
    await chrome.sidePanel?.setOptions?.({
      path: SIDE_PANEL_PATH,
      enabled: false,
    });
  } catch (error) {
    // 旧版浏览器或测试环境不支持 sidePanel.setOptions 时，不阻断其它后台逻辑。
  }
}
