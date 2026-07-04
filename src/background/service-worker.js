// Unified MV3 service worker entry.
// Loads the new-tab redirect logic and the embedded Browser AI Assistant background.
// Each module registers its own chrome.* event listeners on import.
import "./newtab-redirect.js";
import "../ai-assistant/assets/imagefree-tool-runtime.js";
import "../ai-assistant/background/index.js";

installModelCallDiagnostics();

const SIDE_PANEL_PATH = "src/ai-assistant/index.html";
const FLOATING_ASSISTANT_PATH = "src/ai-assistant/index.html?floating=1";
const FLOATING_OPEN_TYPE = "sidepanelFloating.openCurrentTab";
const FLOATING_CONTENT_OPEN_TYPE = "sidepanelFloating.open";
const SIDE_PANEL_CLOSE_TYPE = "sidePanel.close";
const OPENED_SIDE_PANEL_TABS_KEY = "sidePanel.openedTabs.v1";
// 浏览器操控新建的标签页会立刻被激活，onActivated 可能早于 onCreated 的存储写入。
// 这个内存集合在 onCreated 的同步阶段记录“刚创建的标签”，让 onActivated 能在竞态下
// 仍然识别出新标签并让侧边栏跟随，而不是把整窗口面板关掉。
const RECENTLY_CREATED_TAB_TTL_MS = 10000;
const recentlyCreatedTabs = new Set();

void bootstrapTabScopedSidePanel();
chrome.runtime.onInstalled.addListener(bootstrapTabScopedSidePanel);
chrome.runtime.onStartup.addListener(bootstrapTabScopedSidePanel);

chrome.action?.onClicked?.addListener((tab) => {
  void openTabScopedSidePanel(tab?.id);
});

chrome.commands?.onCommand?.addListener((command, tab) => {
  if (command !== "open-side-panel") {
    return;
  }
  if (typeof tab?.id === "number") {
    openTabScopedSidePanel(tab.id);
    return;
  }
  void chrome.tabs
    .query({ active: true, currentWindow: true })
    .then(([tab]) => {
      // 旧版浏览器若没有给 commands 事件传 tab，这里只能提前启用该 tab；
      // sidePanel.open 不能放在这个异步回调里，否则会丢失用户手势。
      if (typeof tab?.id === "number") {
        void rememberOpenedSidePanelTab(tab.id);
        void chrome.sidePanel?.setOptions?.({
          tabId: tab.id,
          path: SIDE_PANEL_PATH,
          enabled: true,
        })?.catch?.(() => undefined);
      }
    })
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
  // 同步标记“刚创建”，让随后的 onActivated 在竞态下也能识别新标签并让侧边栏跟随。
  markRecentlyCreatedTab(tab?.id);
  void inheritSidePanelForNewTab(tab);
});

chrome.tabs?.onRemoved?.addListener((tabId) => {
  recentlyCreatedTabs.delete(tabId);
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

function openTabScopedSidePanel(tabId) {
  if (typeof tabId !== "number") {
    return false;
  }
  try {
    // sidePanel.open() 必须紧贴 action/context-menu/command 的用户手势调用。
    // 这里不能先 await storage/setOptions，否则 Chrome 会判定手势已丢失。
    void rememberOpenedSidePanelTab(tabId);
    const setOptionsPromise = chrome.sidePanel?.setOptions?.({
      tabId,
      path: SIDE_PANEL_PATH,
      enabled: true,
    });
    void setOptionsPromise?.catch?.(() => undefined);
    void chrome.sidePanel?.open?.({ tabId })?.catch?.(() => undefined);
    return true;
  } catch (_error) {
    return false;
  }
}

async function syncActiveTabSidePanel(tabId, windowId) {
  if (typeof tabId !== "number") {
    return;
  }
  let opened = await getOpenedSidePanelTabs();

  // 浏览器操控会以 active:true 新建标签页，激活后会落到这里。若直接按“未开启”
  // 处理就会关掉整窗口面板，让 AI 把自己所在的侧边栏关闭。这里改为：刚创建且
  // 同窗口已有标签开着侧边栏时，让新标签继承侧边栏而不是关闭。
  if (!opened.has(tabId) && recentlyCreatedTabs.has(tabId)) {
    if (await windowHasOpenedSidePanel(windowId, opened)) {
      await rememberOpenedSidePanelTab(tabId);
      opened = await getOpenedSidePanelTabs();
    }
  }

  const isOpened = opened.has(tabId);
  await syncTabSidePanelOptions(tabId, opened);

  // Chrome 通常会在未启用 tab 上自动隐藏 tab-specific side panel。
  // 这里额外关闭 window 里的全局/旧状态面板，清掉旧版 manifest default_path
  // 或热更新前留下的“切到其它标签页仍停在原地”的残影。
  if (!isOpened && typeof windowId === "number") {
    await closeSidePanelTargets([{ windowId }]);
  }
}

// 判断指定窗口里是否还有“已开启侧边栏”的标签页，用于决定新标签是否继承侧边栏。
async function windowHasOpenedSidePanel(windowId, openedTabs) {
  if (typeof windowId !== "number") {
    return false;
  }
  const opened = openedTabs || (await getOpenedSidePanelTabs());
  if (opened.size === 0) {
    return false;
  }
  const query = chrome.tabs?.query;
  if (typeof query !== "function") {
    return false;
  }
  let tabs = [];
  try {
    tabs = await query.call(chrome.tabs, { windowId });
  } catch (_error) {
    return false;
  }
  return tabs.some((tab) => typeof tab?.id === "number" && opened.has(tab.id));
}

function markRecentlyCreatedTab(tabId) {
  if (typeof tabId !== "number") {
    return;
  }
  recentlyCreatedTabs.add(tabId);
  // 仅用于桥接 onCreated 与 onActivated 的短暂竞态，超时后清掉避免误判后续复用的 tabId。
  setTimeout(() => recentlyCreatedTabs.delete(tabId), RECENTLY_CREATED_TAB_TTL_MS);
}

// 新建标签页时，如果同窗口已有标签开着侧边栏（通常是发起操控的 AI 侧边栏），
// 让新标签继承侧边栏配置，这样激活切换过去也不会被同步逻辑关闭。
async function inheritSidePanelForNewTab(tab) {
  const tabId = tab?.id;
  if (typeof tabId !== "number") {
    return;
  }
  const opened = await getOpenedSidePanelTabs();
  if (opened.has(tabId)) {
    return;
  }
  if (!(await windowHasOpenedSidePanel(tab.windowId, opened))) {
    await syncTabSidePanelOptions(tabId, opened);
    return;
  }
  await rememberOpenedSidePanelTab(tabId);
  await syncTabSidePanelOptions(tabId);
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

function installModelCallDiagnostics() {
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== "function" || globalThis.__moonTabModelDiagnosticsInstalled) {
    return;
  }

  globalThis.__moonTabModelDiagnosticsInstalled = true;
  const fetchImpl = originalFetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    if (!isModelDiagnosticsRequest(input, init)) {
      return fetchImpl(input, init);
    }
    return captureModelDiagnosticsFetch(fetchImpl, input, init);
  };
}

function isModelDiagnosticsRequest(input, init) {
  const url = resolveDiagnosticsFetchUrl(input);
  const method = String(init?.method || input?.method || "GET").toUpperCase();
  if (!url || method !== "POST") {
    return false;
  }

  try {
    const path = new URL(url).pathname.toLowerCase();
    return (
      path.endsWith("/chat/completions") ||
      path.endsWith("/messages") ||
      path.endsWith("/responses") ||
      path.includes(":generatecontent") ||
      path.includes(":streamgeneratecontent")
    );
  } catch (_error) {
    return /\/(chat\/completions|messages|responses)(?:$|[?#/])/i.test(url);
  }
}

async function captureModelDiagnosticsFetch(fetchImpl, input, init) {
  const startedAt = Date.now();
  const request = buildModelDiagnosticsRequest(input, init);
  const baseRecord = {
    id: `model-${startedAt}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "model-call",
    status: "pending",
    startedAt,
    request,
    model: typeof request.body?.model === "string" ? request.body.model : "",
    promptSummary: summarizeModelDiagnosticsPrompt(request.body),
  };

  postModelDiagnostic(fetchImpl, baseRecord);

  try {
    const response = await fetchImpl(input, init);
    const responseBase = {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      headers: redactDiagnosticsHeaders(response.headers),
    };

    response.clone().text().then((text) => {
      const completedAt = Date.now();
      const bodySnapshot = parseDiagnosticsBody(text);
      postModelDiagnostic(fetchImpl, {
        ...baseRecord,
        status: response.ok ? "success" : "error",
        completedAt,
        durationMs: completedAt - startedAt,
        response: { ...responseBase, ...bodySnapshot },
        responseSummary: summarizeModelDiagnosticsResponse(bodySnapshot.body),
      });
    }).catch((error) => {
      const completedAt = Date.now();
      postModelDiagnostic(fetchImpl, {
        ...baseRecord,
        status: response.ok ? "success" : "error",
        completedAt,
        durationMs: completedAt - startedAt,
        response: {
          ...responseBase,
          bodyText: `[响应正文读取失败] ${formatDiagnosticsError(error)}`,
        },
      });
    });

    return response;
  } catch (error) {
    const completedAt = Date.now();
    postModelDiagnostic(fetchImpl, {
      ...baseRecord,
      status: "error",
      completedAt,
      durationMs: completedAt - startedAt,
      errorMessage: redactDiagnosticsText(formatDiagnosticsError(error), 1200),
    });
    throw error;
  }
}

function postModelDiagnostic(fetchImpl, record) {
  try {
    void fetchImpl("http://127.0.0.1:17334/model-diagnostics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    }).catch(() => undefined);
  } catch (_error) {
    // 诊断服务未启动或被拦截时不影响真实模型调用。
  }
}

function buildModelDiagnosticsRequest(input, init) {
  return {
    url: resolveDiagnosticsFetchUrl(input),
    method: String(init?.method || input?.method || "GET").toUpperCase(),
    headers: redactDiagnosticsHeaders(mergeDiagnosticsHeaders(input?.headers, init?.headers)),
    ...parseDiagnosticsBody(extractDiagnosticsBodyText(input, init)),
  };
}

function parseDiagnosticsBody(text) {
  if (typeof text !== "string" || !text) {
    return {};
  }

  const truncated = truncateDiagnosticsText(text, 30000);
  try {
    return {
      body: redactDiagnosticsValue(JSON.parse(truncated.text)),
      truncated: truncated.truncated,
    };
  } catch (_error) {
    return {
      bodyText: redactDiagnosticsText(truncated.text, 30000),
      truncated: truncated.truncated,
    };
  }
}

function extractDiagnosticsBodyText(input, init) {
  const body = init?.body;
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  if (body && typeof body === "object" && body.constructor?.name === "FormData") {
    return "[FormData 请求体未展开]";
  }
  return typeof input?.body === "string" ? input.body : "";
}

function resolveDiagnosticsFetchUrl(input) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return typeof input?.url === "string" ? input.url : "";
}

function mergeDiagnosticsHeaders(...headersList) {
  const headers = [];
  for (const headersLike of headersList) {
    if (!headersLike) {
      continue;
    }

    try {
      new Headers(headersLike).forEach((value, name) => headers.push({ name, value }));
      continue;
    } catch (_error) {
      // 继续兼容普通对象和数组形式。
    }

    if (Array.isArray(headersLike)) {
      for (const item of headersLike) {
        if (Array.isArray(item)) {
          headers.push({ name: item[0], value: item[1] });
        } else if (item && typeof item === "object") {
          headers.push({ name: item.name, value: item.value });
        }
      }
    } else if (typeof headersLike === "object") {
      for (const [name, value] of Object.entries(headersLike)) {
        headers.push({ name, value });
      }
    }
  }
  return headers;
}

function redactDiagnosticsHeaders(headersLike) {
  return Object.fromEntries(
    mergeDiagnosticsHeaders(headersLike)
      .filter((header) => header?.name)
      .map((header) => {
        const name = String(header.name);
        return [
          name,
          isDiagnosticsSensitiveKey(name)
            ? "[已脱敏]"
            : redactDiagnosticsText(String(header.value ?? ""), 1000),
        ];
      }),
  );
}

function redactDiagnosticsValue(value, depth = 0, key = "") {
  if (isDiagnosticsSensitiveKey(key)) {
    return "[已脱敏]";
  }
  if (depth > 8) {
    return "[层级过深]";
  }
  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return redactDiagnosticsText(value, 6000);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 120).map((item) => redactDiagnosticsValue(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 180)
        .map(([itemKey, itemValue]) => [itemKey, redactDiagnosticsValue(itemValue, depth + 1, itemKey)]),
    );
  }
  return String(value);
}

function summarizeModelDiagnosticsPrompt(body) {
  if (!body || typeof body !== "object") {
    return "";
  }

  const messages = Array.isArray(body.messages) ? body.messages : Array.isArray(body.input) ? body.input : [];
  const roles = messages
    .map((message) => (message && typeof message === "object" ? message.role : ""))
    .filter(Boolean);
  const tools = Array.isArray(body.tools) ? `，工具 ${body.tools.length} 个` : "";
  return messages.length
    ? `${messages.length} 条消息${roles.length ? `（${roles.join(" → ")}）` : ""}${tools}`
    : tools.replace(/^，/, "");
}

function summarizeModelDiagnosticsResponse(body) {
  if (!body || typeof body !== "object") {
    return "";
  }

  const message = Array.isArray(body.choices) ? body.choices[0]?.message : undefined;
  if (typeof message?.content === "string") {
    return truncateDiagnosticsText(message.content, 700).text;
  }
  if (Array.isArray(message?.tool_calls)) {
    return `模型返回 ${message.tool_calls.length} 个工具调用。`;
  }
  if (typeof body.content === "string") {
    return truncateDiagnosticsText(body.content, 700).text;
  }
  return "";
}

function isDiagnosticsSensitiveKey(key) {
  return /(^|[-_])(token|secret|password|passwd|pwd|authorization|auth|api[-_]?key|session|jwt|credential|client[-_]?secret|refresh[-_]?token|access[-_]?token|cookie|set-cookie)([-_]|$)/i.test(String(key || ""));
}

function redactDiagnosticsText(text, limit = 6000) {
  const redacted = String(text ?? "")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, (_match, scheme) => `${scheme} [已脱敏]`)
    .replace(/((?:token|secret|password|passwd|pwd|apiKey|api_key|authorization|session|jwt|cookie)\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s&,;}]+)/gi, (_match, prefix) => `${prefix}[已脱敏]`);
  return truncateDiagnosticsText(redacted, limit).text;
}

function truncateDiagnosticsText(text, limit) {
  const value = String(text ?? "");
  return value.length <= limit
    ? { text: value, truncated: false }
    : { text: `${value.slice(0, limit)}…[已截断]`, truncated: true };
}

function formatDiagnosticsError(error) {
  return error instanceof Error && error.message ? error.message : String(error);
}
