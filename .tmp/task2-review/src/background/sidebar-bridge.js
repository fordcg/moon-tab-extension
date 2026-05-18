import {
  SIDEBAR_ACTION_TYPES,
  SIDEBAR_CONTENT_MESSAGE_TYPES,
  SIDEBAR_MESSAGE_TYPES,
  isSidebarActionType,
} from "../shared/sidebar-contract.mjs";

const extensionApi = typeof chrome !== "undefined" ? chrome : null;
const NO_USABLE_WEB_TAB_ERROR = "当前窗口没有可连接的网页标签页，请先打开一个普通网页。";
const sidebarPageUrl = extensionApi.runtime.getURL("src/pages/sidebar/index.html");
const newtabPageUrl = extensionApi.runtime.getURL("src/pages/newtab/index.html");
const extensionBaseUrl = extensionApi.runtime.getURL("");

const isUsableSidebarTargetUrl = (url = "") => {
  if (!url || url === "about:blank") {
    return false;
  }

  if (url === sidebarPageUrl || url === newtabPageUrl) {
    return false;
  }

  if (url.startsWith(extensionBaseUrl)) {
    return false;
  }

  return url.startsWith("http://") || url.startsWith("https://");
};

const queryUsableTabs = async () => {
  const tabs = await extensionApi.tabs.query({ currentWindow: true });
  return tabs.filter((tab) => typeof tab?.id === "number" && isUsableSidebarTargetUrl(tab.url || ""));
};

const queryActiveTab = async () => {
  const [activeTab] = await extensionApi.tabs.query({ currentWindow: true, active: true });
  if (activeTab?.id && isUsableSidebarTargetUrl(activeTab.url || "")) {
    return activeTab;
  }

  const usableTabs = await queryUsableTabs();
  return usableTabs.at(-1) ?? null;
};

const sendSidebarContentMessage = async (tabId, message) => extensionApi.tabs.sendMessage(tabId, message);

const normalizeSidebarFailureResponse = (response) => {
  if (!response || response.ok !== false) {
    return response;
  }

  const responseError = typeof response.error === "string" ? response.error.trim() : "";
  const responseReason = typeof response.reason === "string" ? response.reason.trim() : "";
  return {
    ...response,
    error: responseError || responseReason || "侧边栏操作失败。",
  };
};

const SEARCH_TARGET_BUILDERS = {
  bing: (query) => `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
  google: (query) => `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  github: (query) => `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`,
  bilibili: (query) => `https://search.bilibili.com/all?keyword=${encodeURIComponent(query)}`,
};

const resolveSidebarSearchUrl = (query, targetId = "bing") => {
  const builder = SEARCH_TARGET_BUILDERS[targetId] || SEARCH_TARGET_BUILDERS.bing;
  return builder(query);
};

const getActiveTabContext = async () => {
  const activeTab = await queryActiveTab();
  if (!activeTab?.id) {
    throw new Error(NO_USABLE_WEB_TAB_ERROR);
  }

  const response = await sendSidebarContentMessage(activeTab.id, {
    type: SIDEBAR_CONTENT_MESSAGE_TYPES.GET_CONTEXT,
  });

  if (!response?.ok || !response.context) {
    throw new Error(response?.error || "同步当前页上下文失败。");
  }

  return {
    tabId: activeTab.id,
    windowId: activeTab.windowId,
    context: response.context,
  };
};

const executeSidebarAction = async (payload = {}) => {
  const activeTab = await queryActiveTab();
  if (!activeTab?.id) {
    throw new Error(NO_USABLE_WEB_TAB_ERROR);
  }

  if (!isSidebarActionType(payload.type)) {
    throw new Error("该动作不在允许列表中。");
  }

  if (payload.type === SIDEBAR_ACTION_TYPES.FOCUS_INPUT) {
    return sendSidebarContentMessage(activeTab.id, {
      type: SIDEBAR_CONTENT_MESSAGE_TYPES.FOCUS_INPUT,
    });
  }

  if (payload.type === SIDEBAR_ACTION_TYPES.SCROLL) {
    return sendSidebarContentMessage(activeTab.id, {
      type: SIDEBAR_CONTENT_MESSAGE_TYPES.SCROLL,
      payload: payload.payload ?? {},
    });
  }

  if (payload.type === SIDEBAR_ACTION_TYPES.OPEN_LINK) {
    const targetUrl = typeof payload.url === "string" ? payload.url.trim() : "";
    if (!targetUrl || (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://"))) {
      throw new Error("仅支持打开 http/https 链接。");
    }
    await extensionApi.tabs.create({ url: targetUrl, active: true });
    return { ok: true, reason: "已在新标签页打开链接。" };
  }

  if (payload.type === SIDEBAR_ACTION_TYPES.NEW_TAB) {
    const targetUrl = typeof payload.url === "string" ? payload.url.trim() : "";
    await extensionApi.tabs.create({ url: targetUrl || "about:blank", active: true });
    return { ok: true, reason: targetUrl ? "已打开新的标签页。" : "已打开空白标签页。" };
  }

  if (payload.type === SIDEBAR_ACTION_TYPES.REFRESH_PAGE) {
    await extensionApi.tabs.reload(activeTab.id);
    return { ok: true, reason: "已刷新当前页面。" };
  }

  if (payload.type === SIDEBAR_ACTION_TYPES.GO_BACK) {
    return sendSidebarContentMessage(activeTab.id, {
      type: SIDEBAR_CONTENT_MESSAGE_TYPES.GO_BACK,
    });
  }

  if (payload.type === SIDEBAR_ACTION_TYPES.RUN_SEARCH) {
    const query = typeof payload.query === "string" ? payload.query.trim() : "";
    if (!query) {
      throw new Error("请输入搜索关键词。");
    }

    const targetId = typeof payload.targetId === "string" ? payload.targetId.trim() : "bing";
    const searchUrl = resolveSidebarSearchUrl(query, targetId);
    await extensionApi.tabs.create({ url: searchUrl, active: true });
    return { ok: true, reason: `已用 ${targetId === "bing" ? "Bing" : targetId} 搜索“${query}”。` };
  }

  if (payload.type === SIDEBAR_ACTION_TYPES.SWITCH_TAB) {
    const tabs = await queryUsableTabs();
    if (tabs.length === 0) {
      throw new Error("未找到可切换的标签页。");
    }

    const activeIndex = tabs.findIndex((tab) => tab.active);
    const fallbackIndex = payload.direction === "previous" ? 0 : tabs.length - 1;
    const currentIndex = activeIndex >= 0 ? activeIndex : fallbackIndex;

    const offset = payload.direction === "previous" ? -1 : 1;
    const nextTab = tabs[(currentIndex + offset + tabs.length) % tabs.length];
    if (!nextTab?.id) {
      throw new Error("未找到目标标签页。");
    }

    await extensionApi.tabs.update(nextTab.id, { active: true });
    return { ok: true, reason: "已切换标签页。" };
  }

  if (payload.type === SIDEBAR_ACTION_TYPES.COPY) {
    return { ok: true, reason: payload.reason || "复制动作需要由侧边栏页面完成。", copyValue: payload.value ?? "" };
  }

  throw new Error("未实现的动作类型。");
};

extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handleMessage = async () => {
    if (message?.type === SIDEBAR_MESSAGE_TYPES.GET_ACTIVE_CONTEXT || message?.type === SIDEBAR_MESSAGE_TYPES.REFRESH_CONTEXT) {
      return getActiveTabContext();
    }

    if (message?.type === SIDEBAR_MESSAGE_TYPES.EXECUTE_ACTION) {
      return executeSidebarAction(message.payload);
    }

    return null;
  };

  handleMessage()
    .then((result) => {
      const normalizedResult = normalizeSidebarFailureResponse(result);

      if (normalizedResult?.ok === false) {
        sendResponse(normalizedResult);
        return;
      }

      sendResponse({ ok: true, ...normalizedResult });
    })
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "侧边栏操作失败。" }));

  return true;
});
