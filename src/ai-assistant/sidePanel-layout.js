import { openAgentToolsDialog } from "./agent-tools-dialog.js";

const EMPTY_SUGGESTIONS = [
  "你能做些什么？",
  "我可以问哪些类型的问题？",
  "帮我理清思路，解决问题",
];

// 复用应用内图标的描边风格（fill:none + currentColor stroke）。
const TUNE_SVG =
  '<svg class="composer-switch-icon" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M6 4v6M6 14v6M12 4v2M12 10v10M18 4v10M18 18v2"></path>' +
  '<circle cx="6" cy="12" r="2"></circle><circle cx="12" cy="8" r="2"></circle>' +
  '<circle cx="18" cy="16" r="2"></circle></svg>';

// 与顶栏隐藏按钮一致的图标，便于视觉延续。
const GEAR_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"></path>' +
  '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"></path></svg>';

const EXTERNAL_TAB_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M7 17 17 7"></path>' +
  '<path d="M9 7h8v8"></path>' +
  '<path d="M5 11v8h8"></path></svg>';

const BROWSER_CONTROL_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"></path>' +
  '<path d="M3 9h18M12 12v4M10 14h4"></path></svg>';

const AGENT_TOOLS_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M5 7h14M5 12h14M5 17h14"></path>' +
  '<circle cx="8" cy="7" r="1.75"></circle>' +
  '<circle cx="16" cy="12" r="1.75"></circle>' +
  '<circle cx="11" cy="17" r="1.75"></circle></svg>';

// 底部“+”按钮图标，用于打开“添加标签页”弹窗。
const ADD_TAB_SVG =
  '<svg class="composer-switch-icon" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M12 5v14M5 12h14"></path></svg>';

// 顶栏“新建对话”入口：复用历史列表里的原生 createChatSession 逻辑。
const NEW_CHAT_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<rect x="4.25" y="4.25" width="15.5" height="15.5" rx="3.5"></rect>' +
  '<path d="M12 8.25v7.5M8.25 12h7.5"></path></svg>';

// 右上角“悬浮窗”入口：从 Side Panel 注入当前页面的可拖动 iframe。
const FLOATING_WINDOW_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<rect x="4" y="5" width="16" height="14" rx="3"></rect>' +
  '<path d="M7.5 9.75h9M7.5 13.5h6"></path></svg>';

const IS_FLOATING_FRAME =
  new URLSearchParams(window.location.search).get("floating") === "1";

// 模型下拉占位文案。enhanceModelSelectDisplay 与 renderModelSelectMenu 共用，
// 避免两处各写一份字面量、改文案时过滤失效让占位项混进可选列表。
const MODEL_PLACEHOLDER_TEXT = "未选择模型";

let scheduled = false;
let globalHandlersBound = false;
let tabsBound = false;
let enhancementObserver = null;
let myWindowId = null;
let cachedTabs = [];
let activePageTab = null;
let lastAssistantBusy = false;
// 当前 active tab 默认隐式分享。用户可在抽屉里 × 取消；按 URL 记录，避免弹窗重开时被默认选中状态读回。
let currentDeselected = false;
let suppressedCurrentTabUrl = null;
const suppressedCurrentTabUrls = new Set();
let lastActiveUrl = null;
// 额外勾选的标签页（不含 active tab）。弹窗打开时从 DOM 同步真值。
let userExtraSelectedSnapshot = [];
let pendingDeselectedTabUrls = new Set();
let bannerExpanded = false;
let bannerCollapseTimer = null;
// 跟踪弹窗打开瞬间，用来在 React 自动勾选当前 tab 时反向取消，
// 让弹窗状态与 currentDeselected 保持一致。
let lastDialogPresent = false;
let dialogSelectionSyncPending = false;
// 抽屉 ↔ 设置弹窗 slide 切换意图。值：
//   "to-settings"   近期对话向左滑出，设置弹窗从右滑入
//   "to-recents"    设置弹窗向右滑出，近期对话从左滑入
//   null            非动画切换（普通开/关）
// 由 makeDrawerAction / closeSettingsDialog 设置，enhanceSettingsDialog /
// enhanceHistoryDrawer 读取后清空，用于给新挂载的弹窗加进入动画类。
let pendingSlideIntent = null;
// 抽屉 ↔ 设置切换进行中标记：防止 Escape + 外部点击 / 连点触发重复切换。
let slideInProgress = false;
const SETTINGS_BACKGROUND_SNAPSHOT_CLASS = "settings-dialog-background-snapshot";
let newConversationRequestInFlight = false;
let floatingRequestInFlight = false;
let floatingToastTimer = null;

document.body?.classList.toggle("sidepanel-floating-frame", IS_FLOATING_FRAME);

function scheduleEnhancement() {
  if (scheduled) {
    return;
  }

  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    [
      enhanceEmptyState,
      enhanceComposerTools,
      enhanceComposerAddTab,
      enhanceComposerFooter,
      syncToolsA11y,
      enhanceNewConversationButton,
      enhanceFloatingWindowButton,
      enhanceModelSelectDisplay,
      enhanceSendButton,
      syncAssistantStatus,
      enhanceHistoryDrawer,
      enhanceHistorySessionMenus,
      enhanceSettingsDialog,
      enhanceChannelManager,
      enhanceChannelSelects,
      cleanupSettingsBackgroundSnapshot,
      updateContextBanner,
      enhanceContextDialog,
      enhanceCustomScrollbar,
    ].forEach(runEnhancer);
  });
}

function runEnhancer(enhancer) {
  try {
    enhancer();
  } catch (error) {
    console.warn("[sidepanel-layout] enhancement failed", enhancer.name, error);
  }
}

function enhanceEmptyState() {
  const list = document.querySelector(".message-list");
  if (!list) {
    return;
  }

  const hasMessages = Boolean(list.querySelector(".message-entry"));
  const busy = isAssistantBusy();
  const emptyText = list.querySelector(":scope > .ui-muted");
  const existingState = list.querySelector(".sidepanel-empty-state");

  if (hasMessages || busy || !emptyText) {
    existingState?.remove();
    list.classList.remove("message-list-empty-enhanced");
    return;
  }

  list.classList.add("message-list-empty-enhanced");

  if (existingState) {
    return;
  }

  const state = document.createElement("section");
  state.className = "sidepanel-empty-state";
  state.setAttribute("aria-label", "快捷提问");

  const copy = document.createElement("div");
  copy.className = "sidepanel-empty-copy";

  const hello = document.createElement("p");
  hello.className = "sidepanel-empty-hello";
  hello.textContent = makeGreetingText();

  const title = document.createElement("p");
  title.className = "sidepanel-empty-title";
  title.textContent = "今天需要我做些什么？";

  copy.append(hello, title);

  const suggestions = document.createElement("div");
  suggestions.className = "sidepanel-empty-suggestions";

  for (const suggestion of EMPTY_SUGGESTIONS) {
    const button = document.createElement("button");
    button.className = "sidepanel-suggestion";
    button.type = "button";
    button.textContent = suggestion;
    button.addEventListener("click", () => fillPrompt(suggestion));
    suggestions.append(button);
  }

  state.append(copy, suggestions);
  list.append(state);
}

// 工具开关组改为“点击展开”：注入一个 tune 按钮，点击切换 .is-tools-open。
function enhanceComposerTools() {
  const actions = document.querySelector(".composer-actions");
  const switches = actions?.querySelector(".composer-switches");
  if (!actions || !switches) {
    return;
  }

  if (actions.querySelector(".sidepanel-tools-toggle")) {
    return;
  }

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "composer-switch sidepanel-tools-toggle";
  toggle.setAttribute("aria-label", "工具");
  toggle.setAttribute("aria-expanded", "false");
  toggle.title = "工具";
  toggle.innerHTML = TUNE_SVG;
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleTools();
  });

  actions.insertBefore(toggle, actions.firstChild);
}

// 底部“+”按钮：打开“添加标签页”弹窗。弹窗仍由原生 .context-view-button 触发，
// 这里只注入一个可见入口（context-view-button 在 banner 展示时被隐藏，但 .click() 仍生效）。
function enhanceComposerAddTab() {
  const actions = document.querySelector(".composer-actions");
  if (!actions) {
    return;
  }
  const existing = actions.querySelectorAll(".sidepanel-add-tab-button");
  if (existing.length > 1) {
    // React 重渲染偶发残留：只保留第一个，移除多余的。
    existing.forEach((node, index) => index > 0 && node.remove());
  }
  if (existing.length >= 1) {
    return;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "composer-switch sidepanel-add-tab-button";
  button.setAttribute("aria-label", "添加标签页");
  button.title = "添加标签页";
  button.innerHTML = ADD_TAB_SVG;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleTools(false);
    closeModelMenu();
    document.querySelector(".context-view-button")?.click();
  });
  actions.append(button);
}

function enhanceNewConversationButton() {
  const appShell = document.querySelector(".app-shell");
  if (!appShell) {
    return;
  }

  const hasConversation = Boolean(document.querySelector(".message-list .message-entry"));
  let button = document.querySelector(".sidepanel-new-chat-trigger");
  if (!hasConversation) {
    button?.remove();
    return;
  }

  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "sidepanel-new-chat-trigger";
    button.innerHTML = NEW_CHAT_SVG;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void handleNewConversationClick(button);
    });
    document.body.append(button);
  }

  button.setAttribute("aria-label", "新建对话");
  button.setAttribute("title", "新建对话");
}

async function handleNewConversationClick(button) {
  if (newConversationRequestInFlight) {
    return;
  }

  newConversationRequestInFlight = true;
  button.disabled = true;
  button.classList.add("is-creating");
  closeModelMenu();
  toggleTools(false);

  try {
    const created = await triggerNativeNewConversation();
    if (!created) {
      showFloatingToast("暂时无法新建对话，请先返回聊天页", true);
    }
  } finally {
    setTimeout(() => {
      newConversationRequestInFlight = false;
      button.disabled = false;
      button.classList.remove("is-creating");
    }, 180);
  }
}

async function triggerNativeNewConversation() {
  const directButton = findNativeNewConversationButton();
  if (directButton) {
    directButton.click();
    return true;
  }

  const settingsButton = document.querySelector('.app-header-icon-button[aria-label="设置"]');
  if (document.querySelector(".settings-main-layout") && settingsButton) {
    settingsButton.click();
    await waitForDomSettle();
    const buttonAfterSettings = findNativeNewConversationButton();
    if (buttonAfterSettings) {
      buttonAfterSettings.click();
      return true;
    }
  }

  const historyPanelToggle = document.querySelector(".chat-history-panel-toggle");
  if (historyPanelToggle) {
    const wasOpen =
      historyPanelToggle.getAttribute("data-history-panel-open") === "true" ||
      historyPanelToggle.getAttribute("aria-expanded") === "true";
    historyPanelToggle.click();
    await waitForDomSettle();

    const buttonAfterToggle = findNativeNewConversationButton();
    if (buttonAfterToggle) {
      buttonAfterToggle.click();
      if (!wasOpen) {
        setTimeout(() => {
          const currentToggle = document.querySelector(".chat-history-panel-toggle");
          const isOpen =
            currentToggle?.getAttribute("data-history-panel-open") === "true" ||
            currentToggle?.getAttribute("aria-expanded") === "true";
          if (currentToggle && isOpen) {
            currentToggle.click();
          }
        }, 80);
      }
      return true;
    }

    if (!wasOpen) {
      historyPanelToggle.click();
    }
  }

  const historyTrigger = document.querySelector(".chat-history-trigger");
  if (historyTrigger) {
    historyTrigger.click();
    await waitForDomSettle();
    const drawerButton = findNativeNewConversationButton();
    if (drawerButton) {
      drawerButton.click();
      document
        .querySelector('.history-drawer .drawer-icon-button[aria-label="关闭历史记录"]')
        ?.click();
      return true;
    }
  }

  return false;
}

function findNativeNewConversationButton() {
  return Array.from(document.querySelectorAll('button[aria-label="新对话"]')).find(
    (button) => !button.classList.contains("sidepanel-new-chat-trigger")
  );
}

function waitForDomSettle() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 20));
  });
}

function enhanceFloatingWindowButton() {
  const appShell = document.querySelector(".app-shell");
  if (!appShell) {
    return;
  }

  let button = document.querySelector(".sidepanel-floating-trigger");
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "sidepanel-floating-trigger";
    button.innerHTML = FLOATING_WINDOW_SVG;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void handleFloatingWindowClick(button);
    });
    document.body.append(button);
  }

  const label = IS_FLOATING_FRAME ? "关闭悬浮窗" : "切换为悬浮窗";
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  button.classList.toggle("is-floating-frame", IS_FLOATING_FRAME);
}

async function handleFloatingWindowClick(button) {
  if (IS_FLOATING_FRAME) {
    window.parent?.postMessage({ type: "sidepanelFloating.close" }, "*");
    showFloatingToast("正在关闭悬浮窗");
    return;
  }

  if (floatingRequestInFlight) {
    return;
  }

  floatingRequestInFlight = true;
  button.disabled = true;
  button.classList.add("is-opening");
  closeModelMenu();
  toggleTools(false);
  showFloatingToast("正在打开悬浮窗…");

  try {
    const response = await sendRuntimeMessage({
      type: "sidepanelFloating.openCurrentTab",
    });
    if (response?.ok) {
      showFloatingToast(response.message || "已打开悬浮窗，正在关闭侧边栏…");
      setTimeout(closeSidePanelWindow, 120);
    } else {
      showFloatingToast(response?.message || "当前页面无法打开悬浮窗", true);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    showFloatingToast(`打开悬浮窗失败：${message}`, true);
  } finally {
    floatingRequestInFlight = false;
    button.disabled = false;
    button.classList.remove("is-opening");
  }
}

function closeSidePanelWindow() {
  if (IS_FLOATING_FRAME) {
    return;
  }
  try {
    window.close();
  } catch (error) {
    // 旧版浏览器若不允许 window.close，后台的 sidePanel.close 会作为优先路径兜底。
  }
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) {
      reject(new Error("当前环境不支持扩展消息"));
      return;
    }
    try {
      runtime.sendMessage(message, (response) => {
        const lastError = runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function showFloatingToast(message, isError = false) {
  let toast = document.querySelector(".sidepanel-floating-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "sidepanel-floating-toast";
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.setAttribute("role", isError ? "alert" : "status");
  toast.setAttribute("aria-live", isError ? "assertive" : "polite");

  clearTimeout(floatingToastTimer);
  floatingToastTimer = setTimeout(() => {
    toast?.remove();
  }, isError ? 4200 : 2600);
}

function enhanceComposerFooter() {
  const shell = document.querySelector(".chat-input-shell");
  const actions = document.querySelector(".composer-actions");
  if (!shell || !actions) {
    return;
  }

  actions.classList.add("sidepanel-composer-footer");
  if (actions.parentElement !== shell) {
    shell.append(actions);
  }

  // 上传图片入口移入“工具”浮层（.composer-switches），与其它开关并列成行；
  // 不再占用底部常驻位（当前模型多不支持视觉理解，作为工具项更合适）。
  const switches = actions.querySelector(".composer-switches");
  const imageButton = document.querySelector(".image-upload-button");
  if (imageButton && switches && imageButton.parentElement !== switches) {
    switches.append(imageButton);
  }

  const modelSelector = document.querySelector(".model-selector");
  const sendButton = actions.querySelector(".ui-button-primary");
  if (modelSelector && modelSelector.parentElement !== actions) {
    actions.insertBefore(modelSelector, sendButton || null);
  }

  let spacer = actions.querySelector(".sidepanel-footer-spacer");
  if (!spacer) {
    spacer = document.createElement("span");
    spacer.className = "sidepanel-footer-spacer";
    spacer.setAttribute("aria-hidden", "true");
  }
  if (spacer.parentElement !== actions) {
    actions.insertBefore(spacer, modelSelector || sendButton || null);
  }

  ensureControlLabel(imageButton, "上传图片");
  ensureControlLabel(modelSelector?.querySelector(".model-select-input"), "选择模型");
}

function enhanceModelSelectDisplay() {
  const select = document.querySelector(".model-selector .model-select-input");
  const label = select?.closest(".model-select-label");
  if (!select || !label) {
    return;
  }

  label.classList.add("model-select-label-enhanced");

  let trigger = label.querySelector(".model-select-trigger");
  if (!trigger) {
    trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "model-select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    label.insertBefore(trigger, select);
  }

  let value = label.querySelector(".model-select-value");
  if (!value) {
    value = document.createElement("span");
    value.className = "model-select-value";
    value.setAttribute("aria-hidden", "true");
  }

  let chevron = label.querySelector(".model-select-chevron");
  if (!chevron) {
    chevron = document.createElement("span");
    chevron.className = "model-select-chevron";
    chevron.setAttribute("aria-hidden", "true");
  }
  if (value.parentElement !== trigger || chevron.parentElement !== trigger) {
    trigger.replaceChildren(value, chevron);
  }

  const rawSelectedText = select.selectedOptions?.[0]?.textContent?.trim();
  const selectedText = rawSelectedText || MODEL_PLACEHOLDER_TEXT;
  const isPlaceholder = !rawSelectedText;
  if (value.textContent !== selectedText) {
    value.textContent = selectedText;
    value.title = selectedText;
  }
  value.classList.toggle("is-placeholder", isPlaceholder);
  trigger.title = selectedText;
  trigger.setAttribute("aria-label", `选择模型，当前为${selectedText}`);

  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  let menu = label.querySelector(".model-select-menu");
  if (!menu) {
    menu = document.createElement("div");
    menu.className = "model-select-menu";
    menu.id = "sidepanel-model-select-menu";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", "选择模型");
    label.append(menu);
  }
  trigger.setAttribute("aria-controls", menu.id);
  trigger.setAttribute(
    "aria-expanded",
    String(label.classList.contains("is-model-menu-open")),
  );
  renderModelSelectMenu(select, menu);

  if (select.dataset.displayBound === "true") {
    return;
  }
  select.dataset.displayBound = "true";
  select.addEventListener("change", scheduleEnhancement);
  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleModelMenu(label, select);
  });
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleModelMenu(label, select, true);
      focusCurrentModelOption(label);
    }
    if (event.key === "Escape") {
      closeModelMenu(label);
    }
  });
  menu.addEventListener("keydown", (event) => handleModelMenuKeydown(event, label));
}

function modelOptionsSignature(usableOptions) {
  // 拼接每个选项的 value+文案，作为“选项结构是否变化”的指纹。
  // 用换行分隔，单条内部以制表符分隔 value 与文案，降低与正常文本冲突的概率。
  return usableOptions
    .map((option) => `${option.value}\t${option.textContent?.trim() || ""}`)
    .join("\n");
}

// 仅更新选中态（class / aria / roving tabindex），不重建 DOM。
function syncModelOptionSelection(menu, selectedValue) {
  const items = menu.querySelectorAll(".model-select-option");
  let focusable = null;
  for (const item of items) {
    const isSelected = item.dataset.value === selectedValue;
    item.classList.toggle("is-selected", isSelected);
    item.setAttribute("aria-selected", String(isSelected));
    item.tabIndex = isSelected ? 0 : -1;
    if (isSelected) {
      focusable = item;
    }
  }
  // 无选中项时，让首个选项成为 listbox 的唯一 Tab 停靠点。
  if (!focusable && items[0]) {
    items[0].tabIndex = 0;
  }
}

function renderModelSelectMenu(select, menu, { force = false } = {}) {
  const selectedValue = select.value;
  const usableOptions = Array.from(select.options).filter((option) => {
    const text = option.textContent?.trim() || "";
    return text && text !== MODEL_PLACEHOLDER_TEXT && !option.disabled;
  });
  const signature = modelOptionsSignature(usableOptions);

  // 选项结构未变时跳过 replaceChildren。否则流式输出期间，监听整个文档的
  // MutationObserver 会高频触发增强，重建会销毁正被键盘聚焦的选项按钮，
  // 焦点掉回 body，方向键导航直接断掉。仅选中值变化时原地同步即可。
  if (!force && menu.dataset.optionsSignature === signature) {
    if (menu.dataset.selectedValue !== selectedValue) {
      syncModelOptionSelection(menu, selectedValue);
      menu.dataset.selectedValue = selectedValue;
    }
    return;
  }

  const list = document.createElement("div");
  list.className = "model-select-option-list";

  let focusable = null;
  for (const option of usableOptions) {
    const text = option.textContent?.trim() || option.value;
    const isSelected = option.value === selectedValue;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "model-select-option";
    item.dataset.value = option.value;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(isSelected));
    // Roving tabindex：listbox 整体只占一个 Tab 停靠点，内部用方向键移动。
    item.tabIndex = isSelected ? 0 : -1;
    if (isSelected) {
      item.classList.add("is-selected");
      focusable = item;
    }

    const copy = document.createElement("span");
    copy.className = "model-select-option-copy";

    const name = document.createElement("span");
    name.className = "model-select-option-name";
    name.textContent = text;

    const check = document.createElement("span");
    check.className = "model-select-option-check";
    check.setAttribute("aria-hidden", "true");

    copy.append(name);
    item.append(copy, check);
    item.addEventListener("click", () => {
      if (select.value !== option.value) {
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const label = select.closest(".model-select-label");
      closeModelMenu();
      // 选完归还焦点到触发器，避免被点的按钮随后重建后焦点落到 body。
      label?.querySelector(".model-select-trigger")?.focus();
    });
    list.append(item);
  }

  if (!focusable && list.firstElementChild) {
    list.firstElementChild.tabIndex = 0;
  }

  if (!usableOptions.length) {
    const empty = document.createElement("p");
    empty.className = "model-select-menu-empty";
    empty.textContent = "暂无可用模型";
    list.append(empty);
  }

  menu.replaceChildren(list);
  menu.dataset.optionsSignature = signature;
  menu.dataset.selectedValue = selectedValue;
}

function getStoredBoolean(key) {
  try {
    return localStorage.getItem(key) === "true";
  } catch (error) {
    return false;
  }
}

function setStoredBoolean(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch (error) {
    // 预览 iframe 禁用本地存储时仅保留本次点击的视觉反馈能力。
  }
}

// 打开期间跟随触发器重定位的处理器；关闭时解绑，避免常驻监听。
let modelMenuReposition = null;

function positionModelMenu(label) {
  const trigger = label.querySelector(".model-select-trigger");
  const menu = label.querySelector(".model-select-menu");
  if (!trigger || !menu) {
    return;
  }
  // 菜单是 position: fixed，按触发器在视口中的实际位置锚定，
  // 不再假设 composer 永远贴底、宽度恒定。
  const rect = trigger.getBoundingClientRect();
  const gap = 8;
  const margin = 12;
  const menuWidth = menu.offsetWidth || rect.width;
  const menuHeight = menu.offsetHeight;
  const viewportW = document.documentElement.clientWidth;
  const viewportH = document.documentElement.clientHeight;

  // 水平：左对齐触发器，超出右边界则贴右收回。
  let left = rect.left;
  left = Math.min(left, viewportW - margin - menuWidth);
  left = Math.max(margin, left);

  // 垂直：默认向上弹出（composer 在底部）；上方空间不足则朝下。
  const spaceAbove = rect.top;
  const openUp = spaceAbove >= menuHeight + gap || spaceAbove >= viewportH - rect.bottom;
  let top = openUp ? rect.top - gap - menuHeight : rect.bottom + gap;
  top = Math.max(margin, Math.min(top, viewportH - margin - menuHeight));

  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.style.right = "auto";
  menu.style.bottom = "auto";
}

function toggleModelMenu(label, select, force) {
  if (!label || !select) {
    return;
  }
  const nextOpen =
    typeof force === "boolean"
      ? force
      : !label.classList.contains("is-model-menu-open");
  if (nextOpen) {
    toggleTools(false);
  }
  closeModelMenu();
  label.classList.toggle("is-model-menu-open", nextOpen);
  label.querySelector(".model-select-trigger")?.setAttribute("aria-expanded", String(nextOpen));
  if (nextOpen) {
    renderModelSelectMenu(select, label.querySelector(".model-select-menu"));
    positionModelMenu(label);
    modelMenuReposition = () => positionModelMenu(label);
    window.addEventListener("scroll", modelMenuReposition, true);
    window.addEventListener("resize", modelMenuReposition);
  }
}

function closeModelMenu(exceptLabel) {
  let closedAny = false;
  for (const label of document.querySelectorAll(".model-select-label.is-model-menu-open")) {
    if (exceptLabel && label === exceptLabel) {
      continue;
    }
    label.classList.remove("is-model-menu-open");
    label.querySelector(".model-select-trigger")?.setAttribute("aria-expanded", "false");
    closedAny = true;
  }
  // 没有任何打开的菜单时解绑重定位监听。
  if (closedAny && modelMenuReposition && !document.querySelector(".model-select-label.is-model-menu-open")) {
    window.removeEventListener("scroll", modelMenuReposition, true);
    window.removeEventListener("resize", modelMenuReposition);
    modelMenuReposition = null;
  }
}

function focusCurrentModelOption(label) {
  requestAnimationFrame(() => {
    const option =
      label.querySelector('.model-select-option[aria-selected="true"]') ||
      label.querySelector(".model-select-option");
    focusModelOption(option);
  });
}

function focusModelOption(option) {
  if (!option) {
    return;
  }
  // 维持 roving tabindex：被聚焦项可 Tab，其余移出 Tab 序列。
  for (const sibling of option.parentElement?.children || []) {
    if (sibling.classList?.contains("model-select-option")) {
      sibling.tabIndex = sibling === option ? 0 : -1;
    }
  }
  option.focus();
}

function handleModelMenuKeydown(event, label) {
  if (event.key === "Escape") {
    event.preventDefault();
    closeModelMenu(label);
    label.querySelector(".model-select-trigger")?.focus();
    return;
  }
  const navKeys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!navKeys.includes(event.key)) {
    return;
  }
  const options = Array.from(label.querySelectorAll(".model-select-option"));
  if (!options.length) {
    return;
  }
  event.preventDefault();
  const currentIndex = Math.max(0, options.indexOf(document.activeElement));
  let nextIndex;
  if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = options.length - 1;
  } else {
    const step = event.key === "ArrowDown" ? 1 : -1;
    nextIndex = (currentIndex + step + options.length) % options.length;
  }
  focusModelOption(options[nextIndex]);
}

// 发送按钮被 CSS 图标化（文字隐藏、伪元素画箭头）。这里补两件事：
// 1. aria-label，避免文字隐藏后无障碍读不到；
// 2. 依据原生文案“发送中”同步 data-sending，驱动 CSS spinner（原生无 loading class）。
function enhanceSendButton() {
  const button = document.querySelector(
    ".composer-actions .ui-button-primary",
  );
  if (!button) {
    return;
  }
  const sending = button.textContent.trim() === "发送中";
  const label = sending ? "发送中" : "发送";
  if (button.getAttribute("aria-label") !== label) {
    button.setAttribute("aria-label", label);
  }
  if (button.getAttribute("title") !== label) {
    button.setAttribute("title", label);
  }
  const sendingStr = String(sending);
  if (button.dataset.sending !== sendingStr) {
    button.dataset.sending = sendingStr;
  }
}

function syncAssistantStatus() {
  const busy = isAssistantBusy();
  const list = document.querySelector(".message-list");
  const live = ensureLiveRegion();

  document.body.classList.toggle("sidepanel-assistant-busy", busy);

  if (busy !== lastAssistantBusy) {
    live.textContent = busy ? "助手正在生成回复" : "回复已完成";
    lastAssistantBusy = busy;
  }

  if (!list) {
    return;
  }

  let indicator = list.querySelector(".sidepanel-thinking");
  if (!busy) {
    indicator?.remove();
    list.classList.remove("message-list-thinking");
    return;
  }

  list.classList.add("message-list-thinking");
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.className = "sidepanel-thinking";
    indicator.setAttribute("role", "status");
    indicator.setAttribute("aria-live", "polite");
    indicator.setAttribute("aria-atomic", "true");

    const dots = document.createElement("span");
    dots.className = "sidepanel-thinking-dots";
    dots.setAttribute("aria-hidden", "true");

    const text = document.createElement("span");
    text.className = "sidepanel-thinking-text";
    text.textContent = "正在思考";

    indicator.append(dots, text);
  }
  if (indicator.parentElement !== list) {
    list.append(indicator);
  }
}

function isAssistantBusy() {
  const button = document.querySelector(".composer-actions .ui-button-primary");
  return Boolean(
    button &&
      (button.dataset.sending === "true" ||
        button.textContent.trim() === "发送中"),
  );
}

function ensureLiveRegion() {
  let live = document.querySelector("#sidepanel-live-status");
  if (!live) {
    live = document.createElement("div");
    live.id = "sidepanel-live-status";
    live.className = "sidepanel-sr-only";
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    live.setAttribute("aria-atomic", "true");
    document.body.append(live);
  }
  return live;
}

function makeGreetingText() {
  const rawName =
    localStorage.getItem("profile.displayName") ||
    localStorage.getItem("user.displayName") ||
    localStorage.getItem("user.name") ||
    "";
  const name = rawName.trim();
  return name && name !== "y" ? `你好，${name}` : "你好";
}

function ensureControlLabel(control, label) {
  if (!control) {
    return;
  }
  if (!control.getAttribute("aria-label")) {
    control.setAttribute("aria-label", label);
  }
  if (!control.getAttribute("title")) {
    control.setAttribute("title", label);
  }
}

function toggleTools(force) {
  const composer = document.querySelector(".chat-composer");
  const toggle = document.querySelector(".sidepanel-tools-toggle");
  if (!composer || !toggle) {
    return;
  }

  const open =
    typeof force === "boolean"
      ? force
      : !composer.classList.contains("is-tools-open");
  if (open) {
    closeModelMenu();
  }
  composer.classList.toggle("is-tools-open", open);
  syncToolsA11y();
}

function syncToolsA11y() {
  const composer = document.querySelector(".chat-composer");
  const switches = document.querySelector(".composer-switches");
  const toggle = document.querySelector(".sidepanel-tools-toggle");
  if (!composer || !switches) {
    return;
  }

  const open = composer.classList.contains("is-tools-open");
  toggle?.setAttribute("aria-expanded", String(open));
  switches.setAttribute("aria-hidden", String(!open));
  switches.inert = !open;

  if (!open && switches.contains(document.activeElement)) {
    toggle?.focus({ preventScroll: true });
  }

  for (const control of switches.querySelectorAll(
    'a[href], button, input, select, textarea, [tabindex]',
  )) {
    if (!(control instanceof HTMLElement)) {
      continue;
    }
    if (!open) {
      if (!control.dataset.sidepanelSavedTabIndex) {
        control.dataset.sidepanelSavedTabIndex =
          control.getAttribute("tabindex") ?? "__none__";
      }
      control.tabIndex = -1;
      continue;
    }
    const saved = control.dataset.sidepanelSavedTabIndex;
    if (!saved) {
      continue;
    }
    if (saved === "__none__") {
      control.removeAttribute("tabindex");
    } else {
      control.setAttribute("tabindex", saved);
    }
    delete control.dataset.sidepanelSavedTabIndex;
  }
}

// 历史抽屉底部整理为 Gemini 风格的菜单入口，点击转发到被隐藏的顶栏设置按钮。
function enhanceHistoryDrawer() {
  const drawer = document.querySelector(".drawer-panel.history-drawer");
  if (!drawer) {
    return;
  }

  // 设置 → 近期对话 的进入动画。仅在该切换意图下触发一次。
  if (pendingSlideIntent === "to-recents") {
    drawer.classList.add("is-slide-in-from-left");
    drawer.addEventListener(
      "animationend",
      () => drawer.classList.remove("is-slide-in-from-left"),
      { once: true },
    );
    pendingSlideIntent = null;
  }

  drawer.querySelector(".history-dialog-title")?.replaceChildren("近期对话");

  let footer = drawer.querySelector(".sidepanel-drawer-footer");
  if (!footer || footer.dataset.variant !== "recent-menu") {
    footer?.remove();
    footer = document.createElement("div");
    footer.className = "sidepanel-drawer-footer";
    footer.dataset.variant = "recent-menu";
    footer.append(
      makeDrawerDisabledAction("在新标签页中继续对话", EXTERNAL_TAB_SVG),
      makeBrowserControlDrawerAction(),
      makeAgentToolsDrawerAction(),
      makeDrawerAction("设置和帮助", GEAR_SVG, "设置", {
        closeOnClick: true,
        showChevron: true,
        slideOutToSettings: true,
      }),
    );
    drawer.append(footer);
  }

  syncBrowserControlDrawerAction(drawer);
}

function enhanceHistorySessionMenus() {
  const drawer = document.querySelector(".drawer-panel.history-drawer");
  if (!drawer) {
    return;
  }

  for (const menu of drawer.querySelectorAll(".session-menu")) {
    if (!(menu instanceof HTMLElement)) {
      continue;
    }
    const button = menu.closest(".session-item-menu-wrap")?.querySelector(".session-menu-button");
    if (!(button instanceof HTMLElement)) {
      continue;
    }
    menu.classList.add("sidepanel-menu-floating");
    positionHistorySessionMenu(menu, button, drawer);
  }
}

function positionHistorySessionMenu(menu, button, drawer) {
  const buttonRect = button.getBoundingClientRect();
  const drawerRect = drawer.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const menuWidth = Math.max(menu.offsetWidth || 120, 120);
  const menuHeight = Math.max(menu.offsetHeight || 112, 112);
  const gap = 4;
  const margin = 8;
  const leftMin = Math.max(margin, drawerRect.left + margin);
  const leftMax = Math.min(viewportWidth - menuWidth - margin, drawerRect.right - menuWidth - margin);
  const topMin = Math.max(margin, drawerRect.top + margin);
  const topMax = Math.min(viewportHeight - menuHeight - margin, drawerRect.bottom - menuHeight - margin);

  let left = buttonRect.right - menuWidth;
  left = Math.max(leftMin, Math.min(left, leftMax));

  let top = buttonRect.bottom + gap;
  if (top + menuHeight > drawerRect.bottom - margin) {
    top = buttonRect.top - menuHeight - gap;
  }
  top = Math.max(topMin, Math.min(top, topMax));

  menu.style.setProperty("--sidepanel-session-menu-left", `${Math.round(left)}px`);
  menu.style.setProperty("--sidepanel-session-menu-top", `${Math.round(top)}px`);
}

function makeDrawerAction(label, svg, headerLabel, options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sidepanel-drawer-action";
  if (options.showChevron) {
    button.classList.add("sidepanel-drawer-action-chevron");
  }
  button.dataset.target = headerLabel;

  const text = document.createElement("span");
  text.textContent = label;

  button.innerHTML = svg;
  button.append(text);

  button.addEventListener("click", () => {
    if (typeof options.onClick === "function") {
      options.onClick(button);
      return;
    }

    if (options.slideOutToSettings) {
      // 近期对话 → 设置：先让抽屉向左滑出，动画结束再真正开设置 + 关抽屉。
      // 设置弹窗挂载时由 enhanceSettingsDialog 加 is-slide-in-from-right。
      startSlideToSettings(button, headerLabel);
      return;
    }

    const target = getHeaderButton(headerLabel);
    target?.click();
    if (options.closeOnClick) {
      closeHistoryDrawer();
    } else {
      // 给 React 一帧时间更新状态，再同步显示。
      requestAnimationFrame(enhanceHistoryDrawer);
    }
  });

  return button;
}

function makeDrawerDisabledAction(label, svg) {
  const row = document.createElement("div");
  row.className = "sidepanel-drawer-action sidepanel-drawer-action-disabled";
  row.setAttribute("aria-disabled", "true");

  const text = document.createElement("span");
  text.textContent = label;

  row.innerHTML = svg;
  row.append(text);

  return row;
}

function makeAgentToolsDrawerAction() {
  return makeDrawerAction("工具和 MCP", AGENT_TOOLS_SVG, "工具和 MCP", {
    closeOnClick: false,
    onClick: () => {
      closeHistoryDrawer();
      openAgentToolsDialog();
    },
  });
}

function makeBrowserControlDrawerAction() {
  const button = makeDrawerAction("浏览器控制", BROWSER_CONTROL_SVG, "浏览器控制", {
    closeOnClick: false,
  });
  button.classList.add("sidepanel-browser-control-action");

  const status = document.createElement("span");
  status.className = "sidepanel-drawer-action-status";
  status.setAttribute("aria-hidden", "true");
  button.append(status);

  syncBrowserControlDrawerButton(button);
  return button;
}

function syncBrowserControlDrawerAction(scope = document) {
  const button = scope.querySelector(".sidepanel-browser-control-action");
  if (button) {
    syncBrowserControlDrawerButton(button);
  }
}

function syncBrowserControlDrawerButton(button) {
  const target = getHeaderButton("浏览器控制");
  const status = button.querySelector(".sidepanel-drawer-action-status");

  if (!target) {
    button.classList.remove("is-enabled");
    button.setAttribute("aria-disabled", "true");
    button.removeAttribute("aria-pressed");
    button.title = "当前环境不支持浏览器控制";
    if (status) {
      status.textContent = "不可用";
    }
    return;
  }

  const enabled =
    target.getAttribute("aria-pressed") === "true" ||
    target.classList.contains("browser-control-global-button-active") ||
    /已开启/.test(target.getAttribute("title") || "");

  button.removeAttribute("aria-disabled");
  button.classList.toggle("is-enabled", enabled);
  button.setAttribute("aria-pressed", String(enabled));
  button.title =
    target.getAttribute("title") ||
    (enabled
      ? "浏览器控制已开启。点击后关闭。"
      : "浏览器控制已关闭。点击后开启。");
  if (status) {
    status.textContent = enabled ? "已开启" : "已关闭";
  }
}

function getHeaderButton(label) {
  return document.querySelector(
    `.app-header-icon-button[aria-label="${label}"]`,
  );
}

function closeHistoryDrawer() {
  const close = document.querySelector(
    '.history-drawer [aria-label="关闭历史记录"], .history-drawer .drawer-icon-button',
  );
  close?.click();
}

// ── 抽屉 ↔ 设置弹窗 slide 切换编排 ───────────────────────────────
// React/Radix 切换瞬间卸载旧弹窗，没有退出缓冲，所以这里先跑退出动画，
// animationend / timeout 兜底后再真正触发 React 切换；新弹窗挂载时由
// enhance* 函数读取 pendingSlideIntent 加进入动画类。
const SLIDE_MS = 180;

function prefersReducedMotion() {
  return Boolean(
    typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
}

// 跑一次性退出动画。done 只会被调用一次：reduced-motion 下直接走下一帧，
// 否则在 animationend / 兜底 timeout 任一触发后调用，并自带去重，避免
// Escape + 外部点击同时触发导致的重复切换。
function runSlideOut(el, outClass, done) {
  let finished = false;
  const finish = () => {
    if (finished) {
      return;
    }
    finished = true;
    el.classList.remove(outClass);
    done();
  };

  if (prefersReducedMotion()) {
    requestAnimationFrame(finish);
    return;
  }

  el.classList.add(outClass);
  el.addEventListener(
    "animationend",
    (event) => {
      if (event.target === el || event.target?.parentElement === el) {
        finish();
      }
    },
    { once: true },
  );
  // 兜底：动画事件丢失时也不能卡住切换。
  setTimeout(() => {
    if (el.classList.contains(outClass)) {
      finish();
    }
  }, SLIDE_MS + 60);
}

function captureSettingsBackgroundSnapshot() {
  if (document.querySelector(`.${SETTINGS_BACKGROUND_SNAPSHOT_CLASS}`)) {
    return;
  }

  const source = document.querySelector(".chat-main-layout");
  if (!source) {
    return;
  }

  const snapshot = source.cloneNode(true);
  snapshot.classList.add(SETTINGS_BACKGROUND_SNAPSHOT_CLASS);
  snapshot.setAttribute("aria-hidden", "true");
  // 克隆体只是静态背景：去掉 id 避免与原 DOM 重复（破坏 getElementById /
  // #id 选择器），并解除可交互元素的焦点 / 输入能力。
  snapshot.removeAttribute("id");
  snapshot.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  snapshot.querySelectorAll("button, input, select, textarea, a, [tabindex]").forEach((node) => {
    node.setAttribute("tabindex", "-1");
    if ("disabled" in node) {
      node.disabled = true;
    }
  });
  document.body.append(snapshot);
}

function removeSettingsBackgroundSnapshot() {
  document
    .querySelectorAll(`.${SETTINGS_BACKGROUND_SNAPSHOT_CLASS}`)
    .forEach((node) => node.remove());
}

function cleanupSettingsBackgroundSnapshot() {
  if (
    pendingSlideIntent !== "to-settings" &&
    !document.querySelector(".settings-dialog")
  ) {
    removeSettingsBackgroundSnapshot();
  }
}

function startSlideToSettings(triggerButton, headerLabel) {
  if (slideInProgress) {
    return;
  }
  const drawer = document.querySelector(".drawer-panel.history-drawer");
  if (!drawer) {
    // 抽屉不在（异常路径），直接走原逻辑。
    getHeaderButton(headerLabel)?.click();
    return;
  }

  slideInProgress = true;
  pendingSlideIntent = "to-settings";
  // React 打开设置时会把主聊天区替换为设置布局。先冻结一份当前聊天背景，
  // 让“设置和帮助”看起来只是在近期对话弹窗内部切换，而不是整页背景切换。
  captureSettingsBackgroundSnapshot();
  triggerButton?.setAttribute("aria-disabled", "true");

  runSlideOut(drawer, "is-slide-out-left", () => {
    // 真正开设置 + 关抽屉。设置弹窗挂载后 enhanceSettingsDialog 会加进入动画。
    getHeaderButton(headerLabel)?.click();
    closeHistoryDrawer();
    triggerButton?.removeAttribute("aria-disabled");
    slideInProgress = false;
  });
}

// ── 当前页面横幅 / 标签页弹窗 ─────────────────────────────────
// 应用的 .context-strip 只显示提取模式，不显示页面标题；这里用 chrome.tabs
// 读取当前活动网页，注入“正在分享…标签页”横幅，并为弹窗补充图标与当前标记。
function tabsAvailable() {
  return Boolean(
    typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query,
  );
}

function isRecognizableTabUrl(url) {
  return /^(https?|chrome|chrome-extension|edge|about|file):\/\//i.test(url || "");
}

// “当前页面” = side panel 所在窗口的活动网页标签页。
// 锚定 windowId 后，切换标签页 / 同标签页内导航都能立即命中，不再被
// lastFocusedWindow 启发式或其它窗口的活动标签带偏。
function pickActivePageTab(allTabs) {
  const scoped =
    myWindowId === null
      ? allTabs
      : allTabs.filter((tab) => tab.windowId === myWindowId);
  const recognizable = scoped.filter((tab) => isRecognizableTabUrl(tab.url));
  if (!recognizable.length) {
    return null;
  }
  const active = recognizable.find((tab) => tab.active);
  if (active) {
    return active;
  }
  // 没有 active 标记时，保留最近访问的可识别标签作为兜底，避免横幅频繁消失。
  return recognizable
    .slice()
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
}

function refreshTabsAndBanner() {
  if (!tabsAvailable()) {
    return;
  }

  try {
    chrome.tabs.query({}, (all) => {
      if (chrome.runtime?.lastError) {
        return;
      }
      cachedTabs = Array.isArray(all) ? all : [];
      activePageTab = pickActivePageTab(cachedTabs);
      // 当前页面变化 → 重置取消勾选标记（用户对"上一个页面"的决定不延续到新页面）。
      const nextUrl = activePageTab?.url || null;
      if (nextUrl !== lastActiveUrl) {
        currentDeselected = false;
        suppressedCurrentTabUrl = null;
        lastActiveUrl = nextUrl;
      }
      scheduleEnhancement();
    });
  } catch (error) {
    // chrome.tabs 不可用时静默降级，横幅不显示。
  }
}

function buildSharedTabs() {
  // 当前 active tab 默认隐式分享（!currentDeselected 时），用户额外勾选的 tab 排在后面。
  const list = [];
  if (activePageTab && !isCurrentTabSuppressed()) {
    list.push({
      url: activePageTab.url || "",
      title: activePageTab.title || activePageTab.url || "当前页面",
      favIconUrl: activePageTab.favIconUrl || "",
      isCurrent: true,
    });
  }
  const activeUrl = activePageTab?.url || "";
  for (const extra of userExtraSelectedSnapshot) {
    if (extra.url === activeUrl) {
      continue;
    }
    list.push({ ...extra, isCurrent: false });
  }
  return list;
}

function isCurrentTabSuppressed() {
  const activeUrl = activePageTab?.url || "";
  return Boolean(
    activeUrl &&
      (suppressedCurrentTabUrl === activeUrl || suppressedCurrentTabUrls.has(activeUrl)),
  );
}

function suppressCurrentTab(url) {
  if (!url) {
    return;
  }
  currentDeselected = true;
  suppressedCurrentTabUrl = url;
  suppressedCurrentTabUrls.add(url);
}

function restoreCurrentTab(url) {
  if (!url) {
    return;
  }
  currentDeselected = false;
  if (suppressedCurrentTabUrl === url) {
    suppressedCurrentTabUrl = null;
  }
  suppressedCurrentTabUrls.delete(url);
}

function releaseDialogSelectionSync() {
  dialogSelectionSyncPending = false;
  document.querySelector(".context-dialog")?.classList.remove("is-syncing-selection");
}

function isContextTabRowSelected(row) {
  return Boolean(row?.querySelector(".context-tab-selected-badge"));
}

function getContextTabRows(dialog) {
  if (!dialog) {
    return [];
  }
  return Array.from(
    dialog.querySelectorAll(".context-tab-item, .context-tab-item-active"),
  );
}

function findContextTabRow(dialog, url) {
  return getContextTabRows(dialog).find(
    (row) => (row.querySelector(".context-tab-url")?.textContent.trim() || "") === url,
  );
}

function updateInjectedCurrentTabRow(row) {
  const activeUrl = activePageTab?.url || "";
  const tab = cachedTabs.find((candidate) => (candidate.url || "") === activeUrl);
  const title = activePageTab?.title || tab?.title || activeUrl || "当前标签页";
  const favIconUrl = activePageTab?.favIconUrl || tab?.favIconUrl || "";
  const isSelected = !isCurrentTabSuppressed();
  const signature = `${activeUrl}\u0001${title}\u0001${favIconUrl}\u0001${isSelected ? 1 : 0}`;

  if (row.dataset.sidepanelInjectedSignature === signature) {
    return;
  }

  row.type = "button";
  row.className = `context-tab-item sidepanel-current-tab-row${isSelected ? " context-tab-item-active" : ""}`;
  row.setAttribute("aria-pressed", String(isSelected));
  row.setAttribute("aria-label", `注入 ${title}`);
  row.dataset.sidepanelInjectedUrl = activeUrl;
  row.dataset.sidepanelInjectedSignature = signature;

  const children = [];
  if (favIconUrl) {
    const favicon = document.createElement("img");
    favicon.className = "sidepanel-tab-favicon";
    favicon.alt = "";
    favicon.src = favIconUrl;
    children.push(favicon);
  }

  const titleRow = document.createElement("span");
  titleRow.className = "context-tab-title-row";

  const titleText = document.createElement("span");
  titleText.className = "context-tab-title";
  titleText.textContent = title;
  titleRow.append(titleText);

  if (isSelected) {
    const selectedBadge = document.createElement("span");
    selectedBadge.className = "context-tab-selected-badge";
    selectedBadge.textContent = "注入";
    titleRow.append(selectedBadge);
  }
  children.push(titleRow);

  const urlText = document.createElement("span");
  urlText.className = "context-tab-url";
  urlText.textContent = activeUrl;
  children.push(urlText);

  row.replaceChildren(...children);
}

function syncInjectedCurrentTabRow(dialog) {
  const list = dialog?.querySelector(".context-tab-list");
  const activeUrl = activePageTab?.url || "";
  const existingInjected = dialog?.querySelector(".sidepanel-current-tab-row");
  if (!list || !activeUrl) {
    list?.classList.remove("sidepanel-has-injected-current");
    existingInjected?.remove();
    return null;
  }

  const nativeRow = getContextTabRows(dialog).find(
    (row) =>
      !row.classList.contains("sidepanel-current-tab-row") &&
      (row.querySelector(".context-tab-url")?.textContent.trim() || "") === activeUrl,
  );
  if (nativeRow) {
    list.classList.remove("sidepanel-has-injected-current");
    existingInjected?.remove();
    return nativeRow;
  }

  list.classList.add("sidepanel-has-injected-current");
  const row = existingInjected || document.createElement("button");
  updateInjectedCurrentTabRow(row);
  if (!existingInjected) {
    row.addEventListener(
      "pointerdown",
      (event) => {
        if (!event.isTrusted) {
          return;
        }
        releaseDialogSelectionSync();
      },
      { capture: true },
    );
    row.addEventListener("click", (event) => {
      if (!event.isTrusted) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      releaseDialogSelectionSync();
      if (isCurrentTabSuppressed()) {
        restoreCurrentTab(activePageTab?.url || "");
      } else {
        suppressCurrentTab(activePageTab?.url || "");
      }
      updateContextBanner();
      syncInjectedCurrentTabRow(document.querySelector(".context-dialog"));
    });
    list.insertBefore(row, list.firstElementChild);
  }
  return row;
}

function deselectContextTabInOpenDialog(url) {
  const row = findContextTabRow(document.querySelector(".context-dialog"), url);
  if (!row) {
    return false;
  }
  if (row.classList.contains("sidepanel-current-tab-row")) {
    updateInjectedCurrentTabRow(row);
    return true;
  }
  if (isContextTabRowSelected(row)) {
    row.click();
  }
  return true;
}

function applyPendingDeselections(dialog) {
  let clicked = false;
  for (const url of Array.from(pendingDeselectedTabUrls)) {
    const row = findContextTabRow(dialog, url);
    pendingDeselectedTabUrls.delete(url);
    if (isContextTabRowSelected(row)) {
      row.click();
      clicked = true;
    }
  }
  return clicked;
}

function enforceCurrentDeselection(dialog) {
  if (!isCurrentTabSuppressed()) {
    return false;
  }
  const currentRow = findContextTabRow(dialog, activePageTab.url || "");
  suppressCurrentTab(activePageTab.url || "");
  if (currentRow?.classList.contains("sidepanel-current-tab-row")) {
    updateInjectedCurrentTabRow(currentRow);
    return false;
  }
  if (!isContextTabRowSelected(currentRow)) {
    return false;
  }
  currentRow.click();
  return true;
}

function enforceExtraSelectionSnapshot(dialog) {
  const selectedUrls = new Set(userExtraSelectedSnapshot.map((tab) => tab.url));
  const activeUrl = activePageTab?.url || "";
  let clicked = false;

  for (const row of getContextTabRows(dialog)) {
    if (row.classList.contains("sidepanel-current-tab-row")) {
      continue;
    }
    const url = row.querySelector(".context-tab-url")?.textContent.trim() || "";
    if (!url || url === activeUrl) {
      continue;
    }
    const shouldBeSelected = selectedUrls.has(url);
    if (isContextTabRowSelected(row) === shouldBeSelected) {
      continue;
    }
    row.click();
    clicked = true;
  }

  return clicked;
}

function syncOpeningDialogSelection(attempt = 0) {
  if (!dialogSelectionSyncPending) {
    return;
  }
  const liveDialog = document.querySelector(".context-dialog");
  if (!liveDialog) {
    releaseDialogSelectionSync();
    return;
  }

  liveDialog.classList.add("is-syncing-selection");
  syncInjectedCurrentTabRow(liveDialog);
  const changedCurrent = enforceCurrentDeselection(liveDialog);
  const changedExtras = enforceExtraSelectionSnapshot(liveDialog);
  const changedPending = applyPendingDeselections(liveDialog);
  const changed = changedCurrent || changedExtras || changedPending;

  if (changed && attempt < 5) {
    requestAnimationFrame(() => syncOpeningDialogSelection(attempt + 1));
    return;
  }

  requestAnimationFrame(() => {
    if (!dialogSelectionSyncPending) {
      return;
    }
    releaseDialogSelectionSync();
    scheduleEnhancement();
  });
}

function bindCurrentTabIntent(row, url, activeUrl) {
  if (
    row.classList.contains("sidepanel-current-tab-row") ||
    url !== activeUrl ||
    row.dataset.sidepanelCurrentIntentBound === "true"
  ) {
    return;
  }
  row.dataset.sidepanelCurrentIntentBound = "true";
  row.addEventListener(
    "click",
    (event) => {
      if (!event.isTrusted) {
        return;
      }
      restoreCurrentTab(activeUrl);
    },
    { capture: true },
  );
}

function collapseBannerIfSingle() {
  if (buildSharedTabs().length < 2) {
    bannerExpanded = false;
  }
}

function removeSharedTab(url) {
  const dialogWasOpen = !!document.querySelector(".context-dialog");
  if (activePageTab && url === (activePageTab.url || "")) {
    suppressCurrentTab(activePageTab.url || "");
    if (dialogWasOpen) {
      deselectContextTabInOpenDialog(url);
    }
    collapseBannerIfSingle();
    updateContextBanner();
    return;
  }

  userExtraSelectedSnapshot = userExtraSelectedSnapshot.filter((tab) => tab.url !== url);
  if (!dialogWasOpen) {
    pendingDeselectedTabUrls.add(url);
  } else {
    deselectContextTabInOpenDialog(url);
  }
  collapseBannerIfSingle();
  updateContextBanner();
}

function buildBannerFavicon(src) {
  const img = document.createElement("img");
  img.className = "sidepanel-page-banner-favicon";
  img.alt = "";
  if (src) {
    img.src = src;
  } else {
    img.hidden = true;
  }
  return img;
}

function buildSharedDrawerRow(tab) {
  const row = document.createElement("div");
  row.className = "sidepanel-shared-row";
  if (tab.isCurrent) {
    row.classList.add("is-current");
  }

  const favicon = document.createElement("img");
  favicon.className = "sidepanel-shared-row-favicon";
  favicon.alt = "";
  if (tab.favIconUrl) {
    favicon.src = tab.favIconUrl;
  } else {
    favicon.hidden = true;
  }

  const title = document.createElement("span");
  title.className = "sidepanel-shared-row-title";
  title.textContent = tab.title;

  row.append(favicon, title);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "sidepanel-shared-row-remove";
  remove.setAttribute("aria-label", "移除该标签页");
  remove.textContent = "×";
  remove.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeSharedTab(tab.url);
  });
  row.append(remove);

  return row;
}

function bannerSignature(sharedTabs, isMulti) {
  if (sharedTabs.length === 0) {
    return "empty";
  }
  // 把决定 banner DOM 结构的输入压成字符串：tabs 列表 + multi 旗标。
  const tabs = sharedTabs
    .map(
      (t) =>
        `${t.url}|${t.title}|${t.favIconUrl}|${t.isCurrent ? 1 : 0}`,
    )
    .join("~");
  return `${isMulti ? "m" : "s"}:${tabs}`;
}

function updateContextBanner() {
  const strip = document.querySelector(".context-strip");
  if (!strip) {
    return;
  }

  const sharedTabs = buildSharedTabs();
  const isMulti = sharedTabs.length >= 2;
  const signature = bannerSignature(
    sharedTabs,
    isMulti,
  );

  // 幂等：若上次渲染的状态完全一致，跳过重建。否则 MutationObserver 会让 banner
  // 每帧重建一次，点击 chevron 时按钮已被替换，click 永远到不了 handler。
  const existingBanner = strip.querySelector(".sidepanel-page-banner");
  if (existingBanner && existingBanner.dataset.bannerSignature === signature) {
    existingBanner.classList.remove("is-collapsing");
    existingBanner.classList.toggle("is-open", isMulti && bannerExpanded);
    const existingHeader = existingBanner.querySelector(".sidepanel-page-banner-header");
    if (isMulti) {
      existingBanner.setAttribute("aria-expanded", String(bannerExpanded));
      existingHeader?.setAttribute("aria-expanded", String(bannerExpanded));
    } else {
      existingBanner.removeAttribute("aria-expanded");
      existingHeader?.removeAttribute("aria-expanded");
    }
    return;
  }

  // 0 个分享 / 当前页不可识别时 → 不展示横幅，输入区直接贴顶。
  if (sharedTabs.length === 0) {
    bannerExpanded = false;
    window.clearTimeout(bannerCollapseTimer);
    strip.classList.remove("has-page-banner");
    strip.classList.add("is-page-banner-empty");
    strip.querySelector(":scope > .sidepanel-shared-drawer")?.remove();
    if (existingBanner) {
      existingBanner.classList.remove("is-open");
      existingBanner.remove();
    }
    return;
  }

  window.clearTimeout(bannerCollapseTimer);
  strip.classList.remove("is-page-banner-empty");

  let banner = existingBanner;
  if (!banner) {
    banner = document.createElement("div");
    banner.className = "sidepanel-page-banner";
    banner.setAttribute("role", "button");
    banner.setAttribute("tabindex", "0");
    strip.insertBefore(banner, strip.firstChild);
  }

  strip.classList.add("has-page-banner");
  banner.classList.remove("is-collapsing");
  banner.classList.toggle("is-multi", isMulti);
  banner.classList.toggle("is-open", isMulti && bannerExpanded);
  banner.dataset.bannerSignature = signature;

  if (!isMulti) {
    // 单一分享 tab：保留原“正在分享…标签页”观感，banner 不可展开。
    bannerExpanded = false;
    const only = sharedTabs[0];
    banner.replaceChildren();
    banner.append(buildBannerFavicon(only.favIconUrl));
    const text = document.createElement("span");
    text.className = "sidepanel-page-banner-text";
    text.textContent = `正在分享“${only.title}”标签页`;
    banner.append(text);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "sidepanel-page-banner-close";
    remove.setAttribute("aria-label", "移除该标签页");
    remove.textContent = "×";
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeSharedTab(only.url);
    });
    banner.append(remove);
    banner.removeAttribute("aria-expanded");
    banner.removeAttribute("role");
    banner.removeAttribute("tabindex");
    banner.onclick = null;
    banner.onkeydown = null;
    strip.querySelector(":scope > .sidepanel-shared-drawer")?.remove();
    return;
  }

  // 多标签：分两段——header 横向（叠 favicon + 文案 + chevron）+ 可选 drawer 垂直。
  // header 用真正的 <button> 而不是 div + role=button，避免 React 干扰或 CSS pointer-events
  // 隐式拦截，原生按钮的 click 行为最稳。
  banner.setAttribute("aria-expanded", String(bannerExpanded));
  banner.replaceChildren();

  const header = document.createElement("button");
  header.type = "button";
  header.className = "sidepanel-page-banner-header";
  header.setAttribute("aria-expanded", String(bannerExpanded));

  const stack = document.createElement("span");
  stack.className = "sidepanel-page-banner-stack";
  for (const tab of sharedTabs.slice(0, 2)) {
    stack.append(buildBannerFavicon(tab.favIconUrl));
  }
  header.append(stack);

  const text = document.createElement("span");
  text.className = "sidepanel-page-banner-text";
  text.textContent = `正在分享 ${sharedTabs.length} 个标签页`;
  header.append(text);

  const chevron = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  chevron.setAttribute("class", "sidepanel-page-banner-chevron");
  chevron.setAttribute("width", "14");
  chevron.setAttribute("height", "14");
  chevron.setAttribute("viewBox", "0 0 24 24");
  chevron.setAttribute("fill", "none");
  chevron.setAttribute("stroke", "currentColor");
  chevron.setAttribute("stroke-width", "2");
  chevron.setAttribute("stroke-linecap", "round");
  chevron.setAttribute("stroke-linejoin", "round");
  chevron.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "polyline",
  );
  path.setAttribute("points", "6 9 12 15 18 9");
  chevron.append(path);
  header.append(chevron);

  banner.append(header);

  // 把 toggle 绑在 header 这个原生 button 上，最大化 click 可靠性。
  header.onclick = (event) => {
    event.preventDefault();
    bannerExpanded = !bannerExpanded;
    updateContextBanner();
  };

  // 抽屉里行的 × 已 stopPropagation；banner 本体不再绑 onclick，避免冲突。
  banner.onclick = null;
  banner.onkeydown = null;
  banner.removeAttribute("role");
  banner.removeAttribute("tabindex");

  // 老版本可能把 drawer 作为 strip 的兄弟；统一清理避免视觉错位。
  strip.querySelector(":scope > .sidepanel-shared-drawer")?.remove();

  const drawer = document.createElement("div");
  drawer.className = "sidepanel-shared-drawer";
  const drawerInner = document.createElement("div");
  drawerInner.className = "sidepanel-shared-drawer-inner";
  drawerInner.append(...sharedTabs.map(buildSharedDrawerRow));
  drawer.append(drawerInner);
  banner.append(drawer);
}

// 关闭设置：直接回到聊天。Escape / 点击弹窗外部 / 右上角关闭按钮都走这里，
// 不再反弹回近期对话抽屉（回抽屉是“返回近期对话”箭头的显式动作）。
function closeSettingsDialog() {
  const panel = document.querySelector(".settings-dialog");
  if (!panel) {
    // 设置弹窗不在（异常路径），直接走原逻辑。
    document.querySelector('.app-header-actions button[aria-label="设置"]')?.click();
    return;
  }
  if (slideInProgress) {
    return;
  }
  slideInProgress = true;
  pendingSlideIntent = null;

  runSlideOut(panel, "is-slide-out-right", () => {
    // 真正关设置（点隐藏的顶栏设置按钮），不重开抽屉。
    document.querySelector('.app-header-actions button[aria-label="设置"]')?.click();
    requestAnimationFrame(removeSettingsBackgroundSnapshot);
    slideInProgress = false;
  });
}

// 设置 → 近期对话：让设置弹窗向右滑出，结束后关设置并重开抽屉。
// 仅由头部“返回近期对话”箭头触发。
function slideSettingsToRecents() {
  const panel = document.querySelector(".settings-dialog");
  if (!panel) {
    document.querySelector('.app-header-actions button[aria-label="设置"]')?.click();
    return;
  }
  if (slideInProgress) {
    return;
  }
  slideInProgress = true;
  pendingSlideIntent = "to-recents";

  runSlideOut(panel, "is-slide-out-right", () => {
    document.querySelector('.app-header-actions button[aria-label="设置"]')?.click();
    // 重开近期对话抽屉。抽屉挂载后 enhanceHistoryDrawer 会加进入动画。
    openHistoryDrawerAfterSettings();
    requestAnimationFrame(removeSettingsBackgroundSnapshot);
    slideInProgress = false;
  });
}

// 返回时重开近期对话抽屉。顶栏三点按钮已被隐藏（display:none 仍可程序化 click）。
function openHistoryDrawerAfterSettings() {
  // React 关设置后需一帧才稳定，再点历史入口。
  requestAnimationFrame(() => {
    const hist = document.querySelector(
      '.chat-history-trigger, .app-header-icon-button[aria-label="历史记录"], .app-header-icon-button[aria-label="会话历史"]',
    );
    hist?.click();
  });
}

function enhanceSettingsDialog() {
  const layout = document.querySelector(".settings-main-layout");
  const panel = layout?.querySelector(":scope > .ui-panel");
  if (!layout || !panel) {
    return;
  }

  layout.classList.add("settings-dialog-layer");
  panel.classList.add("settings-dialog");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "settings-dialog-title");

  // 近期对话 → 设置 的进入动画。仅在该切换意图下触发一次。
  if (pendingSlideIntent === "to-settings") {
    panel.classList.add("is-slide-in-from-right");
    panel.addEventListener(
      "animationend",
      () => panel.classList.remove("is-slide-in-from-right"),
      { once: true },
    );
    pendingSlideIntent = null;
  }

  if (panel.querySelector(".settings-dialog-header")) {
    return;
  }

  const header = document.createElement("div");
  header.className = "settings-dialog-header";

  // 左上角：返回近期对话（滑回抽屉）。与“关闭=回聊天”区分开。
  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.className = "settings-dialog-nav ui-button-secondary";
  backButton.setAttribute("aria-label", "返回近期对话");
  backButton.title = "返回近期对话";
  backButton.addEventListener("click", slideSettingsToRecents);

  const title = document.createElement("h2");
  title.className = "settings-dialog-title";
  title.id = "settings-dialog-title";
  title.textContent = "设置";

  // 右上角：关闭设置，直接回到聊天。
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "settings-dialog-back ui-button-secondary";
  closeButton.setAttribute("aria-label", "关闭设置");
  closeButton.title = "关闭设置";
  closeButton.addEventListener("click", closeSettingsDialog);

  header.append(backButton, title, closeButton);
  panel.insertBefore(header, panel.firstChild);
}

// 渠道管理 tab（settings-dialog 内）增强：bundle 里这一屏走原生 Tailwind，
// 覆盖层只能从外部补语义。这里做三件幂等的小事：
//   1. 给“删除渠道”加危险样式 + 二次确认，避免误删；
//   2. 修正模型搜索 combobox 写死的 aria-expanded；
//   3. 给渠道列表容器 / 详情区打 data 标记，供 CSS 精确命中。
function enhanceChannelManager() {
  const section = document.querySelector('.settings-dialog [aria-label="渠道管理"]');
  if (!section) {
    return;
  }

  section.dataset.sidepanelChannelManager = "true";

  // 渠道列表：第一个 grid（紧跟标题行）。标 data 供 CSS 命中选中态。
  section
    .querySelectorAll(":scope > .grid > button")
    .forEach((item) => item.classList.add("sidepanel-channel-item"));

  // “删除渠道”按钮：文案匹配，打危险标记 + 包一层 confirm。
  for (const button of section.querySelectorAll("button")) {
    if (button.textContent.trim() !== "删除渠道") {
      continue;
    }
    button.classList.add("sidepanel-channel-delete", "sidepanel-danger-action");
    if (button.dataset.sidepanelConfirmBound === "true") {
      continue;
    }
    button.dataset.sidepanelConfirmBound = "true";
    // 捕获阶段拦截：未确认时阻止冒泡到 React 的 onClick。
    button.addEventListener(
      "click",
      (event) => {
        if (button.dataset.sidepanelConfirmed === "true") {
          button.dataset.sidepanelConfirmed = "";
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        const ok = window.confirm("确定删除该渠道？此操作不可撤销。");
        if (!ok) {
          return;
        }
        button.dataset.sidepanelConfirmed = "true";
        button.click();
      },
      true,
    );
  }

  // 模型搜索 combobox：bundle 写死 aria-expanded="true"，按候选列表实际有无同步。
  const combobox = section.querySelector('[role="combobox"]');
  const listbox = section.querySelector("#remote-model-options");
  if (combobox instanceof HTMLElement && listbox instanceof HTMLElement) {
    const hasOptions = Boolean(listbox.querySelector('[role="option"]'));
    combobox.setAttribute("aria-expanded", String(hasOptions));
  }
}

// 渠道管理里的原生 <select>（端点类型 / 默认对话模型 / 标题生成模型）：原生下拉
// 弹层无法用 CSS 改造，和侧栏 composer 那套“蓝软底卡片 + 蓝勾选项”对不上。这里把
// 每个 select 包成 .model-select-label，复用 toggleModelMenu / renderModelSelectMenu /
// positionModelMenu / 键盘导航——菜单与选项样式直接继承，触发器在 CSS 里重写成
// 输入框外观。原生 select 降级为不可见状态载体，仍由 React 受控、change 照常派发。
function enhanceChannelSelects() {
  const selects = document.querySelectorAll(
    '.settings-dialog section[aria-label="渠道管理"] select.ui-input',
  );
  for (const select of selects) {
    if (!(select instanceof HTMLSelectElement)) {
      continue;
    }
    const label = select.closest("label");
    if (!label) {
      continue;
    }

    let wrapper = label.querySelector(":scope > .sidepanel-channel-select");
    if (wrapper) {
      // 已注入：React 重渲染可能重建 select，重绑 change + 同步显示 + 刷新菜单。
      bindChannelSelectChange(select);
      syncChannelSelectValue(select, wrapper);
      renderModelSelectMenu(select, wrapper.querySelector(".model-select-menu"));
      continue;
    }

    wrapper = document.createElement("span");
    wrapper.className = "model-select-label sidepanel-channel-select";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "model-select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");

    const value = document.createElement("span");
    value.className = "model-select-value";
    value.setAttribute("aria-hidden", "true");

    const chevron = document.createElement("span");
    chevron.className = "model-select-chevron";
    chevron.setAttribute("aria-hidden", "true");

    const menu = document.createElement("div");
    menu.className = "model-select-menu";
    menu.setAttribute("role", "listbox");
    menu.setAttribute(
      "aria-label",
      select.getAttribute("aria-label") || "选择",
    );

    trigger.replaceChildren(value, chevron);
    wrapper.append(trigger, menu);
    label.insertBefore(wrapper, select);

    // 原生 select 退居为状态载体：移出 Tab 序列、对 AT 隐藏，视觉由 CSS 兜底隐藏。
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    syncChannelSelectValue(select, wrapper);
    renderModelSelectMenu(select, menu);
    bindChannelSelectChange(select);

    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleModelMenu(wrapper, select);
    });
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleModelMenu(wrapper, select, true);
        focusCurrentModelOption(wrapper);
      }
      if (event.key === "Escape") {
        closeModelMenu(wrapper);
      }
    });
    menu.addEventListener("keydown", (event) => handleModelMenuKeydown(event, wrapper));
  }
}

function bindChannelSelectChange(select) {
  if (select.dataset.channelChangeBound === "true") {
    return;
  }
  select.dataset.channelChangeBound = "true";
  select.addEventListener("change", () => scheduleEnhancement());
}

function syncChannelSelectValue(select, wrapper) {
  const value = wrapper.querySelector(".model-select-value");
  if (!value) {
    return;
  }
  const text =
    select.selectedOptions?.[0]?.textContent?.trim() || select.value || "";
  if (value.textContent !== text) {
    value.textContent = text;
    value.title = text;
  }
  value.classList.toggle("is-placeholder", !text);
}

// 只关渠道管理的自定义下拉，不动 composer 的 model-select（composer 那套打开时
// 是 window scroll 跟随重定位，这里不改它的行为）。渠道下拉开在设置弹窗内部滚动
// 容器里，滚动=用户离开，应直接收起。
function closeChannelMenus() {
  for (const wrapper of document.querySelectorAll(
    ".sidepanel-channel-select.is-model-menu-open",
  )) {
    wrapper.classList.remove("is-model-menu-open");
    wrapper.querySelector(".model-select-trigger")?.setAttribute("aria-expanded", "false");
  }
  // 通用 reposition 监听（toggleModelMenu 打开时绑的）若已无任何打开菜单则解绑，
  // 避免本次 scroll 后续还跑一次 reposition 把已收起的菜单挪位。
  if (modelMenuReposition && !document.querySelector(".model-select-label.is-model-menu-open")) {
    window.removeEventListener("scroll", modelMenuReposition, true);
    window.removeEventListener("resize", modelMenuReposition);
    modelMenuReposition = null;
  }
}

function enhanceContextDialog() {
  const dialog = document.querySelector(".context-dialog");
  const isPresent = !!dialog;
  const justOpened = isPresent && !lastDialogPresent;

  // 弹窗刚打开时（false→true 的转换）：先把 React 初始选中态校正回我们自己的快照，
  // 再允许后续同步读取 DOM。否则 chrome:// 等当前页被注入时，原生列表默认勾选的
  // 第一个普通 tab 会被误写成用户选择。
  if (justOpened) {
    dialogSelectionSyncPending = true;
    dialog.classList.add("is-syncing-selection");
    syncInjectedCurrentTabRow(dialog);
    requestAnimationFrame(() => syncOpeningDialogSelection());
    lastDialogPresent = isPresent;
    return;
  }
  lastDialogPresent = isPresent;

  if (!dialog) {
    releaseDialogSelectionSync();
    return;
  }
  if (dialogSelectionSyncPending) {
    dialog.classList.add("is-syncing-selection");
    return;
  }
  dialog.classList.remove("is-syncing-selection");

  // 同步：根据弹窗 DOM 真值 → currentDeselected + userExtraSelectedSnapshot。
  syncInjectedCurrentTabRow(dialog);
  const activeUrl = activePageTab?.url || "";
  const rows = getContextTabRows(dialog);
  for (const row of rows) {
    bindCurrentTabIntent(
      row,
      row.querySelector(".context-tab-url")?.textContent.trim() || "",
      activeUrl,
    );
  }
  if (enforceCurrentDeselection(dialog)) {
    return;
  }
  if (applyPendingDeselections(dialog)) {
    return;
  }

  let currentRowFound = false;
  const extras = [];
  for (const row of rows) {
    const url = row.querySelector(".context-tab-url")?.textContent.trim() || "";
    if (!url) {
      continue;
    }
    const isSelected = isContextTabRowSelected(row);
    if (url === activeUrl) {
      currentRowFound = true;
      if (isCurrentTabSuppressed()) {
        if (isSelected && enforceCurrentDeselection(dialog)) {
          return;
        }
        suppressCurrentTab(activeUrl);
        continue;
      }
      // active tab 在弹窗里：根据 badge 在场与否同步，并把用户手动取消记录到 URL 级别。
      if (isSelected) {
        restoreCurrentTab(activeUrl);
      } else {
        suppressCurrentTab(activeUrl);
      }
      continue;
    }
    if (!isSelected) {
      continue;
    }
    const tab = cachedTabs.find((c) => (c.url || "") === url);
    extras.push({
      url,
      title:
        tab?.title ||
        row.querySelector(".context-tab-title")?.textContent.trim() ||
        url,
      favIconUrl: tab?.favIconUrl || "",
    });
  }
  if (!currentRowFound && !activeUrl) {
    currentDeselected = false;
  }
  if (
    extras.length !== userExtraSelectedSnapshot.length ||
    extras.some((t, i) => t.url !== userExtraSelectedSnapshot[i]?.url)
  ) {
    userExtraSelectedSnapshot = extras;
  }

  const title = dialog.querySelector(".context-dialog-title");
  if (title && title.textContent !== "添加标签页") {
    title.textContent = "添加标签页";
  }

  // 检测预览环境：如果是 open-design-preview 或标签页列表为空，显示提示
  const isPreviewEnv = typeof chrome !== "undefined" && chrome.runtime?.id === "open-design-preview";
  const tabList = dialog.querySelector(".context-tab-list");
  const isEmpty = !tabList || tabList.children.length === 0;

  if ((isPreviewEnv || isEmpty) && !dialog.querySelector(".sidepanel-preview-notice")) {
    const notice = document.createElement("div");
    notice.className = "sidepanel-preview-notice";
    notice.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0;">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <span>预览环境无法读取浏览器标签页内容</span>
    `;

    const body = dialog.querySelector(".context-dialog-body") || dialog;
    body.insertBefore(notice, body.firstChild);
  }

  // 行内 favicon / 历史残留清理。状态徽标交给打包应用原生渲染：
  // `.context-tab-active-badge`（当前 tab）/ `.context-tab-selected-badge`（已勾选）
  // 都由 React 自己挂载，我们只在 CSS 里把它们重绘成蓝勾圆点。
  for (const item of getContextTabRows(dialog)) {
    const urlText = item.querySelector(".context-tab-url")?.textContent.trim();
    const tab = cachedTabs.find((candidate) => (candidate.url || "") === urlText);

    if (tab?.favIconUrl && !item.querySelector(".sidepanel-tab-favicon")) {
      const favicon = document.createElement("img");
      favicon.className = "sidepanel-tab-favicon";
      favicon.alt = "";
      favicon.src = tab.favIconUrl;
      item.insertBefore(favicon, item.firstChild);
    }

    // 历史会话可能残留旧版本注入的徽标 / 文字胶囊 / row 类，统一清掉。
    item.querySelector(".sidepanel-tab-current")?.remove();
    item.querySelector(".sidepanel-tab-active-badge")?.remove();
    item.classList.remove("sidepanel-tab-row-active");
  }
}

function enhanceCustomScrollbar() {
  const dialog = document.querySelector(".context-dialog");
  if (!dialog) {
    return;
  }
  const list = dialog.querySelector(".context-tab-list");
  if (!list) {
    return;
  }

  const parent = list.parentElement || dialog;
  if (!parent.style.position || parent.style.position === "static") {
    parent.style.position = "relative";
  }

  let track = parent.querySelector(".context-tab-list-scrollbar");
  let thumb = track?.querySelector(".context-tab-list-scrollbar-thumb");
  if (!track) {
    track = document.createElement("div");
    track.className = "context-tab-list-scrollbar";
    thumb = document.createElement("div");
    thumb.className = "context-tab-list-scrollbar-thumb";
    track.append(thumb);
    parent.append(track);
  }

  const updateThumb = () => {
    const scrollHeight = list.scrollHeight;
    const clientHeight = list.clientHeight;
    if (scrollHeight <= clientHeight) {
      track.style.display = "none";
      return;
    }
    track.style.display = "";
    const trackHeight = track.clientHeight;
    const thumbHeight = Math.max(24, (clientHeight / scrollHeight) * trackHeight);
    const scrollRatio = list.scrollTop / (scrollHeight - clientHeight);
    const thumbTop = scrollRatio * (trackHeight - thumbHeight);
    thumb.style.height = thumbHeight + "px";
    thumb.style.top = thumbTop + "px";
  };

  updateThumb();

  if (!list.dataset.customScrollBound) {
    list.dataset.customScrollBound = "1";
    list.addEventListener("scroll", updateThumb, { passive: true });
    new ResizeObserver(updateThumb).observe(list);

    let dragging = false;
    let startY = 0;
    let startScrollTop = 0;

    thumb.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      dragging = true;
      startY = e.clientY;
      startScrollTop = list.scrollTop;
      thumb.setPointerCapture(e.pointerId);
      thumb.style.background = "#6b7585";
    });

    thumb.addEventListener("pointermove", (e) => {
      if (!dragging) {
        return;
      }
      const trackHeight = track.clientHeight;
      const scrollHeight = list.scrollHeight;
      const clientHeight = list.clientHeight;
      const thumbHeight = Math.max(24, (clientHeight / scrollHeight) * trackHeight);
      const dy = e.clientY - startY;
      const scrollRange = scrollHeight - clientHeight;
      const trackRange = trackHeight - thumbHeight;
      list.scrollTop = startScrollTop + (dy / trackRange) * scrollRange;
    });

    const stopDrag = () => {
      dragging = false;
      thumb.style.background = "";
    };
    thumb.addEventListener("pointerup", stopDrag);
    thumb.addEventListener("pointercancel", stopDrag);

    track.addEventListener("pointerdown", (e) => {
      if (e.target === thumb) {
        return;
      }
      const rect = track.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      const trackHeight = track.clientHeight;
      const scrollHeight = list.scrollHeight;
      const clientHeight = list.clientHeight;
      const thumbHeight = Math.max(24, (clientHeight / scrollHeight) * trackHeight);
      const targetCenter = clickY - thumbHeight / 2;
      const scrollRange = scrollHeight - clientHeight;
      const trackRange = trackHeight - thumbHeight;
      list.scrollTop = (targetCenter / trackRange) * scrollRange;
    });
  }
}

function bindTabListeners() {
  if (tabsBound || !tabsAvailable()) {
    return;
  }
  tabsBound = true;

  // 缓存 side panel 所在窗口，作为“当前页面”的锚点。
  try {
    chrome.windows.getCurrent((win) => {
      if (chrome.runtime?.lastError) {
        return;
      }
      myWindowId = typeof win?.id === "number" ? win.id : null;
      refreshTabsAndBanner();
    });
  } catch (error) {
    // 拿不到 windowId 时退化为全局逻辑（myWindowId 保持 null）。
    refreshTabsAndBanner();
  }

  // 仅当 side panel 所在窗口的活动标签变化时刷新，避免其它窗口切换带偏横幅。
  chrome.tabs.onActivated?.addListener((activeInfo) => {
    if (myWindowId === null || activeInfo?.windowId === myWindowId) {
      refreshTabsAndBanner();
    }
  });
  // 同标签页内导航（url/title/favIcon 变化）也要实时更新。
  chrome.tabs.onUpdated?.addListener((_tabId, info, tab) => {
    if (myWindowId !== null && tab?.windowId !== myWindowId) {
      return;
    }
    if (info.url || info.title || info.favIconUrl) {
      refreshTabsAndBanner();
    }
  });
  chrome.tabs.onRemoved?.addListener(() => refreshTabsAndBanner());
  chrome.windows?.onFocusChanged?.addListener(() => refreshTabsAndBanner());
}

function fillPrompt(text) {
  const editor = document.querySelector(
    '.prompt-inline-editor-text[contenteditable="true"]',
  );

  if (!editor) {
    return;
  }

  editor.focus();
  editor.textContent = text;
  moveCaretToEnd(editor);

  const event = new InputEvent("input", {
    bubbles: true,
    cancelable: true,
    data: text,
    inputType: "insertText",
  });
  editor.dispatchEvent(event);
}

function moveCaretToEnd(element) {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function bindGlobalHandlers() {
  if (globalHandlersBound) {
    return;
  }
  globalHandlersBound = true;

  // 点击当前弹窗和触发器以外区域时收起，保持工具/模型菜单关闭方式一致。
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      closeModelMenu();
      toggleTools(false);
      return;
    }
    if (!target.closest(".model-select-label")) {
      closeModelMenu();
    }
    const settingsDialog = document.querySelector(".settings-dialog");
    if (
      settingsDialog &&
      !target.closest(".settings-dialog") &&
      !target.closest('.app-header-actions button[aria-label="设置"]')
    ) {
      closeSettingsDialog();
    }
    if (target.closest(".sidepanel-tools-toggle") || target.closest(".composer-switches")) {
      return;
    }
    toggleTools(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      toggleTools(false);
      closeModelMenu();
      if (document.querySelector(".settings-dialog")) {
        closeSettingsDialog();
      }
    }
  });

  const repositionHistoryMenus = () => {
    if (document.querySelector(".history-drawer .session-menu")) {
      scheduleEnhancement();
    }
  };
  window.addEventListener("scroll", repositionHistoryMenus, true);
  window.addEventListener("resize", repositionHistoryMenus);

  // 渠道管理自定义下拉：任意滚动（含设置弹窗内部滚动容器）即收起。
  // 捕获阶段 + 启动期注册，先于 toggleModelMenu 运行时绑的 reposition 触发，
  // 收起后顺手解绑 reposition，避免已收起的菜单被挪位。
  window.addEventListener(
    "scroll",
    () => {
      if (document.querySelector(".sidepanel-channel-select.is-model-menu-open")) {
        closeChannelMenus();
      }
    },
    { capture: true, passive: true },
  );

  // 添加标签页弹窗：点击对话框外部任何位置时，调用隐藏的关闭按钮关掉。
  // 排除触发器本身（.context-view-button / .sidepanel-add-tab-button），
  // 否则首次打开的那一下点击会立刻被这里再关回去。
  document.addEventListener("click", (event) => {
    const dialog = document.querySelector(".context-dialog");
    if (!dialog) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.closest(".context-dialog")) {
      return;
    }
    if (
      target.closest(".context-view-button") ||
      target.closest(".sidepanel-add-tab-button")
    ) {
      return;
    }
    const closeBtn = dialog.querySelector(".context-dialog-close");
    closeBtn?.click();
  });
}

bindGlobalHandlers();
bindTabListeners();

enhancementObserver = new MutationObserver(scheduleEnhancement);
enhancementObserver.observe(document.documentElement || document.body, {
  attributes: true,
  childList: true,
  characterData: true,
  subtree: true,
});

scheduleEnhancement();
