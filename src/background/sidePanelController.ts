import {
  LEGACY_SIDE_PANEL_OPEN_FLOATING_TYPE,
  OPENED_SIDE_PANEL_TABS_KEY,
  SIDE_PANEL_CLOSE_TYPE,
  SIDE_PANEL_FLOATING_ATTACH_TYPE,
  SIDE_PANEL_OPEN_FLOATING_TYPE,
  SIDE_PANEL_PATH,
  createFloatingSidePanelPath,
  type SidePanelRuntimeMessage,
} from "../shared/sidePanelRuntime";

const RECENTLY_CREATED_TAB_TTL_MS = 60000;
const CONTROL_WINDOW_STORAGE_KEY = "sidePanel.controlWindowId.v1";
const CONTROL_WINDOW_WIDTH = 420;
const CONTROL_WINDOW_HEIGHT = 760;

const recentlyCreatedTabs = new Set<number>();
let initialized = false;
let controlWindowId: number | undefined;

export type SidePanelRuntimeResponse = { ok: true; message?: string } | { ok: false; message: string };

export function initializeSidePanelController(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  void bootstrapTabScopedSidePanel();
  void restoreControlWindowId();
  chrome.runtime.onInstalled.addListener(() => {
    void bootstrapTabScopedSidePanel();
  });
  chrome.runtime.onStartup.addListener(() => {
    void bootstrapTabScopedSidePanel();
    void restoreControlWindowId();
  });

  chrome.action?.onClicked?.addListener((tab) => {
    openTabScopedSidePanel(tab?.id);
  });

  chrome.commands?.onCommand?.addListener((command, tab) => {
    if (command !== "open-side-panel") {
      return;
    }
    if (typeof tab?.id === "number") {
      openTabScopedSidePanel(tab.id);
      return;
    }
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([activeTab]) => {
      openTabScopedSidePanel(activeTab?.id);
    }).catch(() => undefined);
  });

  chrome.contextMenus?.onClicked?.addListener((info, tab) => {
    if (info.menuItemId !== "open-side-panel") {
      return;
    }
    openTabScopedSidePanel(tab?.id);
  });

  chrome.tabs?.onActivated?.addListener((activeInfo) => {
    void syncActiveTabSidePanel(activeInfo.tabId, activeInfo.windowId);
  });

  chrome.tabs?.onCreated?.addListener((tab) => {
    markRecentlyCreatedTab(tab.id);
    void inheritSidePanelForNewTab(tab);
  });

  chrome.tabs?.onRemoved?.addListener((tabId) => {
    recentlyCreatedTabs.delete(tabId);
    void forgetOpenedSidePanelTab(tabId);
  });

  chrome.windows?.onRemoved?.addListener((windowId) => {
    if (controlWindowId === windowId) {
      controlWindowId = undefined;
      void chrome.storage?.session?.remove?.(CONTROL_WINDOW_STORAGE_KEY);
    }
  });
}

export function handleSidePanelRuntimeMessage(message: SidePanelRuntimeMessage): Promise<SidePanelRuntimeResponse> | undefined {
  if (message.type === SIDE_PANEL_OPEN_FLOATING_TYPE || message.type === LEGACY_SIDE_PANEL_OPEN_FLOATING_TYPE) {
    return openFloatingAssistantInCurrentTab();
  }
  if (message.type === SIDE_PANEL_CLOSE_TYPE) {
    return closeSidePanelFromRequest(message);
  }
  return undefined;
}

/**
 * Keep the AI assistant visible while browser automation creates/switches tabs.
 * Primary strategy: dedicated always-on-top control popup window.
 * Fallback: tab/window-scoped side panel inheritance.
 */
export async function ensureSidePanelForControlledTab(tabId: number | undefined): Promise<boolean> {
  const controlWindowReady = await ensureAutomationControlWindow(tabId);
  if (controlWindowReady) {
    if (typeof tabId === "number") {
      markRecentlyCreatedTab(tabId);
      await rememberOpenedSidePanelTab(tabId);
      enableTabScopedSidePanel(tabId);
    }
    return true;
  }

  if (typeof tabId !== "number") {
    return false;
  }
  markRecentlyCreatedTab(tabId);
  await rememberOpenedSidePanelTab(tabId);
  if (!enableTabScopedSidePanel(tabId)) {
    return false;
  }

  // Prefer window-scoped open first so the panel stays attached while automation switches tabs.
  let windowId: number | undefined;
  try {
    const tab = await chrome.tabs?.get?.(tabId);
    windowId = typeof tab?.windowId === "number" ? tab.windowId : undefined;
  } catch {
    windowId = undefined;
  }

  try {
    if (typeof windowId === "number") {
      await chrome.sidePanel?.open?.({ windowId });
      return true;
    }
  } catch {
    // Fall through to tab-scoped open.
  }

  try {
    await chrome.sidePanel?.open?.({ tabId });
    return true;
  } catch {
    try {
      void chrome.sidePanel?.open?.({ tabId })?.catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Open/focus a dedicated popup window hosting the assistant UI.
 * This survives page tab switches during browser automation.
 */
export async function ensureAutomationControlWindow(anchorTabId?: number): Promise<boolean> {
  try {
    if (typeof controlWindowId === "number") {
      try {
        const existing = await chrome.windows.get(controlWindowId);
        if (existing?.id) {
          await chrome.windows.update(controlWindowId, { focused: true, drawAttention: true });
          return true;
        }
      } catch {
        controlWindowId = undefined;
      }
    }

    let left: number | undefined;
    let top: number | undefined;
    try {
      const current = await chrome.windows.getCurrent();
      if (typeof current.left === "number" && typeof current.width === "number") {
        left = Math.max(0, current.left + Math.max(0, current.width - CONTROL_WINDOW_WIDTH - 24));
      }
      if (typeof current.top === "number") {
        top = Math.max(0, current.top + 24);
      }
    } catch {
      // ignore placement failures
    }

    const query = new URLSearchParams({ floating: "1", controlWindow: "1" });
    if (typeof anchorTabId === "number") {
      query.set("tabId", String(anchorTabId));
    }
    const finalUrl = chrome.runtime.getURL(`index.html?${query.toString()}`);

    const created = await chrome.windows.create({
      url: finalUrl,
      type: "popup",
      focused: true,
      width: CONTROL_WINDOW_WIDTH,
      height: CONTROL_WINDOW_HEIGHT,
      ...(typeof left === "number" ? { left } : {}),
      ...(typeof top === "number" ? { top } : {}),
    });
    if (typeof created?.id !== "number") {
      return false;
    }
    controlWindowId = created.id;
    await chrome.storage?.session?.set?.({ [CONTROL_WINDOW_STORAGE_KEY]: created.id });
    return true;
  } catch {
    return false;
  }
}

async function restoreControlWindowId(): Promise<void> {
  try {
    const items = await chrome.storage?.session?.get?.(CONTROL_WINDOW_STORAGE_KEY);
    const value = items?.[CONTROL_WINDOW_STORAGE_KEY];
    if (typeof value === "number") {
      controlWindowId = value;
    }
  } catch {
    // ignore
  }
}

function openTabScopedSidePanel(tabId: number | undefined): boolean {
  if (typeof tabId !== "number") {
    return false;
  }

  if (!enableTabScopedSidePanel(tabId)) {
    return false;
  }

  try {
    void chrome.sidePanel?.open?.({ tabId })?.catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

function enableTabScopedSidePanel(tabId: number | undefined): boolean {
  if (typeof tabId !== "number") {
    return false;
  }

  try {
    void rememberOpenedSidePanelTab(tabId);
    void chrome.sidePanel?.setOptions?.({ tabId, path: SIDE_PANEL_PATH, enabled: true })?.catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

async function bootstrapTabScopedSidePanel(): Promise<void> {
  await disableGlobalSidePanelFallback();
  try {
    await chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false });
  } catch {
    // Older Chromium builds may not support setPanelBehavior.
  }
  await syncAllTabsSidePanelOptions();
}

async function disableGlobalSidePanelFallback(): Promise<void> {
  try {
    await chrome.sidePanel?.setOptions?.({ path: SIDE_PANEL_PATH, enabled: false });
  } catch {
    // Ignore unsupported or restricted sidePanel options.
  }
}

async function syncAllTabsSidePanelOptions(): Promise<void> {
  const query = chrome.tabs?.query;
  if (typeof query !== "function") {
    return;
  }

  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await query({});
  } catch {
    return;
  }

  const opened = await getOpenedSidePanelTabs();
  await Promise.all(tabs.map((tab) => syncTabSidePanelOptions(tab.id, opened)));
}

async function syncActiveTabSidePanel(tabId: number | undefined, windowId: number | undefined): Promise<void> {
  if (typeof tabId !== "number") {
    return;
  }

  let opened = await getOpenedSidePanelTabs();
  // If this window already has the side panel on any tab, inherit it to the active tab.
  // Never auto-close during tab switches — that is what makes browser automation "lose" the panel.
  if (!opened.has(tabId) && await windowHasOpenedSidePanel(windowId, opened)) {
    await rememberOpenedSidePanelTab(tabId);
    opened = await getOpenedSidePanelTabs();
  }

  await syncTabSidePanelOptions(tabId, opened);
  if (opened.has(tabId) || recentlyCreatedTabs.has(tabId)) {
    try {
      if (typeof windowId === "number") {
        await chrome.sidePanel?.open?.({ windowId });
      } else {
        await chrome.sidePanel?.open?.({ tabId });
      }
    } catch {
      // Best effort only.
    }
  }
}

async function inheritSidePanelForNewTab(tab: chrome.tabs.Tab): Promise<void> {
  if (typeof tab.id !== "number") {
    return;
  }

  const opened = await getOpenedSidePanelTabs();
  if (opened.has(tab.id)) {
    return;
  }

  if (!await windowHasOpenedSidePanel(tab.windowId, opened)) {
    await syncTabSidePanelOptions(tab.id, opened);
    return;
  }

  await rememberOpenedSidePanelTab(tab.id);
  await syncTabSidePanelOptions(tab.id);
}

async function syncTabSidePanelOptions(tabId: number | undefined, openedTabs?: Set<number>): Promise<void> {
  if (typeof tabId !== "number") {
    return;
  }
  const setOptions = chrome.sidePanel?.setOptions;
  if (typeof setOptions !== "function") {
    return;
  }

  const opened = openedTabs ?? await getOpenedSidePanelTabs();
  try {
    await setOptions(opened.has(tabId)
      ? { tabId, path: SIDE_PANEL_PATH, enabled: true }
      : { tabId, enabled: false });
  } catch {
    // Some internal pages reject tab-specific side panel options.
  }
}

async function windowHasOpenedSidePanel(windowId: number | undefined, openedTabs?: Set<number>): Promise<boolean> {
  if (typeof windowId !== "number") {
    return false;
  }
  const opened = openedTabs ?? await getOpenedSidePanelTabs();
  if (opened.size === 0) {
    return false;
  }

  const query = chrome.tabs?.query;
  if (typeof query !== "function") {
    return false;
  }

  try {
    const tabs = await query({ windowId });
    return tabs.some((tab) => typeof tab.id === "number" && opened.has(tab.id));
  } catch {
    return false;
  }
}

function markRecentlyCreatedTab(tabId: number | undefined): void {
  if (typeof tabId !== "number") {
    return;
  }
  recentlyCreatedTabs.add(tabId);
  setTimeout(() => recentlyCreatedTabs.delete(tabId), RECENTLY_CREATED_TAB_TTL_MS);
}

async function getOpenedSidePanelTabs(): Promise<Set<number>> {
  try {
    const items = await chrome.storage?.session?.get?.(OPENED_SIDE_PANEL_TABS_KEY);
    const raw = items?.[OPENED_SIDE_PANEL_TABS_KEY];
    return new Set(Array.isArray(raw) ? raw.filter((value): value is number => typeof value === "number") : []);
  } catch {
    return new Set();
  }
}

async function writeOpenedSidePanelTabs(opened: Set<number>): Promise<void> {
  try {
    await chrome.storage?.session?.set?.({ [OPENED_SIDE_PANEL_TABS_KEY]: Array.from(opened) });
  } catch {
    // Session storage is best effort; tab state can be rebuilt by user actions.
  }
}

async function rememberOpenedSidePanelTab(tabId: number): Promise<void> {
  const opened = await getOpenedSidePanelTabs();
  opened.add(tabId);
  await writeOpenedSidePanelTabs(opened);
}

async function forgetOpenedSidePanelTab(tabId: number): Promise<void> {
  const opened = await getOpenedSidePanelTabs();
  if (!opened.delete(tabId)) {
    return;
  }
  await writeOpenedSidePanelTabs(opened);
}

async function openFloatingAssistantInCurrentTab(): Promise<SidePanelRuntimeResponse> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (typeof tab?.id !== "number") {
      return { ok: false, message: "未找到当前活动页面，无法打开悬浮窗。" };
    }
    if (!isFloatingSupportedUrl(tab.url)) {
      return { ok: false, message: "当前页面不支持悬浮窗，请切换到普通网页后重试。" };
    }

    const url = chrome.runtime.getURL(createFloatingSidePanelPath({ tabId: tab.id, windowId: tab.windowId }));
    const response = await sendFloatingMessageToTab(tab.id, { type: SIDE_PANEL_FLOATING_ATTACH_TYPE, url });
    const sidePanelResponse = isSidePanelRuntimeResponse(response) ? response : undefined;
    if (sidePanelResponse?.ok) {
      await closeSidePanelAfterFloatingOpen(tab);
    }
    return sidePanelResponse ?? { ok: false, message: "打开悬浮窗失败，请稍后重试。" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return { ok: false, message: `打开悬浮窗失败：${message}` };
  }
}

async function sendFloatingMessageToTab(tabId: number, payload: { type: typeof SIDE_PANEL_FLOATING_ATTACH_TYPE; url: string }): Promise<unknown> {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (error) {
    if (!isMissingContentScriptError(error)) {
      throw error;
    }
  }

  await chrome.scripting.executeScript({ target: { tabId }, files: ["content/index.js"] });
  return chrome.tabs.sendMessage(tabId, payload);
}

async function closeSidePanelAfterFloatingOpen(tab: chrome.tabs.Tab): Promise<void> {
  await closeSidePanelTargets([
    typeof tab.id === "number" ? { tabId: tab.id } : undefined,
    typeof tab.windowId === "number" ? { windowId: tab.windowId } : undefined,
  ]);
}

async function closeSidePanelFromRequest(message: { tabId?: number; windowId?: number }): Promise<SidePanelRuntimeResponse> {
  const closed = await closeSidePanelTargets([
    typeof message.tabId === "number" ? { tabId: message.tabId } : undefined,
    typeof message.windowId === "number" ? { windowId: message.windowId } : undefined,
  ]);
  return { ok: closed, message: closed ? "已关闭侧边栏" : "当前浏览器不支持自动关闭侧边栏" };
}

async function closeSidePanelTargets(targets: Array<{ tabId: number } | { windowId: number } | undefined>): Promise<boolean> {
  const close = chrome.sidePanel?.close;
  if (typeof close !== "function") {
    return false;
  }

  for (const target of targets) {
    if (!target) {
      continue;
    }
    try {
      await close(target);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

function isFloatingSupportedUrl(url: string | undefined): boolean {
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

function isMissingContentScriptError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Receiving end does not exist|Could not establish connection/i.test(message);
}

function isSidePanelRuntimeResponse(value: unknown): value is SidePanelRuntimeResponse {
  return Boolean(value && typeof value === "object" && "ok" in value && typeof (value as { ok?: unknown }).ok === "boolean");
}
