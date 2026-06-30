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
const RECENT_HISTORY_COMPACT_LIMIT = 5;
const MOVE_CONVERSATION_TTL_MS = 60 * 60 * 1000;
const CHAT_DB_NAME = "browser-ai-assistant";
const CHAT_SESSION_STORE = "chatSessions";
const TAB_CONVERSATION_STATE_KEY = "sidepanel.tabConversationState.v1";
const SESSION_TAB_CONTEXTS_KEY = "sidepanel.sessionTabContexts.v1";

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
let historyMoreTransitionInFlight = false;
const SETTINGS_BACKGROUND_SNAPSHOT_CLASS = "settings-dialog-background-snapshot";
let newConversationRequestInFlight = false;
let floatingRequestInFlight = false;
let floatingToastTimer = null;
let messageListPinnedToBottom = true;
let messageListScrollTarget = null;
let messageListScrollRaf = null;
let regenerateDirectTimer = null;
let conversationContinuityInFlight = false;
const conversationContinuityBootstrappedTabs = new Set();
let currentConversationSessionId = null;
let moveConversationCandidate = null;
let moveConversationCandidateSignature = "";
let lastConversationContinuitySignature = "";
let lastPersistedSessionContextSignature = "";
let moveConversationRequestInFlight = false;
let tabSwitchCloseRequested = false;

// 输入区撤销/重做历史。React 受控 contenteditable 在 value 变化时直接重写
// textContent，会打断浏览器原生 undo 栈；fillPrompt 直接赋值同样如此。这里维护
// 一份独立的文本快照历史，拦截 Ctrl/Cmd+Z 与 Ctrl/Cmd+Shift+Z / Ctrl+Y，
// 通过派发 input 事件把值回灌进 React，保证撤销可靠。
const PROMPT_EDITOR_SELECTOR =
  '.prompt-inline-editor-text[contenteditable="true"]';
// 连续输入在这个静默窗口内合并为一个撤销步，符合常规编辑器手感。
const PROMPT_UNDO_COALESCE_MS = 350;
const PROMPT_UNDO_HISTORY_LIMIT = 200;
// 长用户消息默认收起，避免一条大段 prompt 把对话区顶满；助手回复不默认折叠。
const LONG_USER_MESSAGE_CHAR_THRESHOLD = 420;
const LONG_USER_MESSAGE_LINE_THRESHOLD = 8;
let promptUndoEditor = null;
let promptUndoStack = [];
let promptRedoStack = [];
let promptUndoBaseline = "";
let promptUndoBurstTimer = null;
let promptUndoApplying = false;

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
      enhancePromptUndo,
      syncTabConversationContinuity,
      enhanceMoveConversationPrompt,
      syncToolsA11y,
      enhanceNewConversationButton,
      enhanceFloatingWindowButton,
      enhanceModelSelectDisplay,
      enhanceSendButton,
      syncAssistantStatus,
      syncLongMessageDisclosure,
      positionMessagePopovers,
      syncMessageScrollState,
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
    showExternalChatNotices();
    return;
  }

  const hasMessages = Boolean(list.querySelector(".message-entry"));
  const busy = isAssistantBusy();
  const emptyText = list.querySelector(":scope > .ui-muted");
  const existingState = list.querySelector(".sidepanel-empty-state");

  if (hasMessages || busy || !emptyText) {
    existingState?.remove();
    list.classList.remove("message-list-empty-enhanced");
    showExternalChatNotices();
    return;
  }

  list.classList.add("message-list-empty-enhanced");

  if (existingState) {
    syncEmptyStateNotice(existingState);
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

  state.append(copy);
  syncEmptyStateNotice(state);
  state.append(suggestions);
  list.append(state);
}

function syncEmptyStateNotice(state) {
  const noticeSource = document.querySelector(".chat-warning, .chat-failure");
  let notice = state.querySelector(".sidepanel-empty-notice");
  if (!noticeSource) {
    notice?.remove();
    showExternalChatNotices();
    return;
  }

  noticeSource.classList.add("sidepanel-warning-inline-hidden");
  if (!notice) {
    notice = document.createElement("div");
    notice.className = "sidepanel-empty-notice";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    const suggestions = state.querySelector(".sidepanel-empty-suggestions");
    state.insertBefore(notice, suggestions);
  }

  notice.classList.toggle("sidepanel-empty-notice-failure", noticeSource.matches(".chat-failure"));
  notice.replaceChildren(...Array.from(noticeSource.childNodes, (node) => node.cloneNode(true)));
}

function showExternalChatNotices() {
  for (const notice of document.querySelectorAll(
    ".chat-warning.sidepanel-warning-inline-hidden, .chat-failure.sidepanel-warning-inline-hidden",
  )) {
    notice.classList.remove("sidepanel-warning-inline-hidden");
  }
}

// ── 新标签页继续对话 / 同标签恢复 ───────────────────────────────
// 原生侧栏只记一个 activeSessionId，重新打开时会回到最近更新的会话。
// 这里在外层补一层“浏览器标签页 → 会话”的轻量绑定：
//   - 同一个标签页聊过后，关闭再打开仍回到原会话；
//   - 新标签页先落到一条新对话，同时给出 1 小时内最近会话的“移到此处”入口；
//   - 点击“移到此处”后，把当前标签页合并进该会话的分享标签列表。
function syncTabConversationContinuity() {
  const tabKey = getActiveTabKey();
  const appReady = Boolean(document.querySelector(".app-shell .message-list"));
  if (!appReady || !tabKey || !activePageTab) {
    moveConversationCandidate = null;
    currentConversationSessionId = null;
    lastConversationContinuitySignature = "";
    document.querySelector(".sidepanel-move-conversation")?.remove();
    return;
  }

  const signature = [
    tabKey,
    activePageTab.url || "",
    getActiveSessionIdFromDom() || "",
    hasVisibleConversationMessages() ? "messages" : "empty",
    document.querySelectorAll(".session-title-button").length,
  ].join("|");

  if (conversationContinuityInFlight || signature === lastConversationContinuitySignature) {
    return;
  }

  lastConversationContinuitySignature = signature;
  conversationContinuityInFlight = true;
  void syncTabConversationContinuityAsync(tabKey);
}

async function syncTabConversationContinuityAsync(tabKey) {
  try {
    let sessions = await readChatSessions();
    let state = pruneConversationState(loadTabConversationState(), sessions);
    let binding = getValidTabBinding(state, tabKey, sessions);

    if (binding) {
      currentConversationSessionId = binding.sessionId;
      updateTabBinding(state, tabKey, binding.sessionId, {
        provisional: Boolean(binding.provisional),
      });
      saveTabConversationState(state);
      await ensureChatSessionSelected(binding.sessionId, sessions);
      applySessionTabContext(binding.sessionId);
    } else {
      currentConversationSessionId = null;
      delete state.tabBindings[tabKey];
      if (
        !conversationContinuityBootstrappedTabs.has(tabKey) &&
        sessions.some((session) => !session.archived)
      ) {
        const created = await createFreshConversationForTab();
        if (created) {
          sessions = await readChatSessions();
          state = pruneConversationState(loadTabConversationState(), sessions);
          updateTabBinding(state, tabKey, created.id, { provisional: true });
          saveTabConversationState(state);
          currentConversationSessionId = created.id;
          applySessionTabContext(created.id);
        }
      }
      conversationContinuityBootstrappedTabs.add(tabKey);
    }

    sessions = await readChatSessions();
    state = pruneConversationState(loadTabConversationState(), sessions);
    captureVisibleConversationActivity(state, tabKey, sessions);
    state = pruneConversationState(loadTabConversationState(), sessions);

    const activeSessionId =
      getValidTabBinding(state, tabKey, sessions)?.sessionId || currentConversationSessionId;
    moveConversationCandidate = getMoveConversationCandidate(
      state,
      sessions,
      tabKey,
      activeSessionId,
    );
    moveConversationCandidateSignature = moveConversationCandidate
      ? `${tabKey}|${moveConversationCandidate.sessionId}|${moveConversationCandidate.lastActiveAt}`
      : "";
  } catch (error) {
    console.warn("[sidepanel-layout] conversation continuity failed", error);
  } finally {
    conversationContinuityInFlight = false;
    scheduleEnhancement();
  }
}

function enhanceMoveConversationPrompt() {
  const existing = document.querySelector(".sidepanel-move-conversation");
  const state = document.querySelector(".sidepanel-empty-state");
  if (
    moveConversationCandidate &&
    Date.now() - moveConversationCandidate.lastActiveAt > MOVE_CONVERSATION_TTL_MS
  ) {
    moveConversationCandidate = null;
    moveConversationCandidateSignature = "";
  }
  if (
    !state ||
    !moveConversationCandidate ||
    hasVisibleConversationMessages() ||
    hasBlockingEmptyNotice()
  ) {
    existing?.remove();
    return;
  }

  if (
    existing instanceof HTMLElement &&
    existing.dataset.candidateSignature === moveConversationCandidateSignature
  ) {
    return;
  }

  const prompt = document.createElement("aside");
  prompt.className = "sidepanel-move-conversation";
  prompt.dataset.candidateSignature = moveConversationCandidateSignature;
  prompt.setAttribute("aria-label", "继续最近对话");

  const icon = document.createElement("span");
  icon.className = "sidepanel-move-conversation-icon";
  icon.setAttribute("aria-hidden", "true");

  const title = document.createElement("span");
  title.className = "sidepanel-move-conversation-title";
  title.textContent = moveConversationCandidate.title || "最近对话";
  title.title = title.textContent;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "sidepanel-move-conversation-button";
  button.textContent = "移到此处";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void handleMoveConversationClick(button);
  });

  prompt.append(icon, title, button);

  if (existing) {
    existing.replaceWith(prompt);
    return;
  }

  const anchor = state.querySelector(".sidepanel-empty-copy") || state.firstChild;
  state.insertBefore(prompt, anchor);
}

function hasBlockingEmptyNotice() {
  return Boolean(
    document.querySelector(
      ".chat-warning, .chat-failure, .sidepanel-empty-notice",
    ),
  );
}

async function handleMoveConversationClick(button) {
  if (moveConversationRequestInFlight || !moveConversationCandidate) {
    return;
  }

  const candidate = moveConversationCandidate;
  const tabKey = getActiveTabKey();
  if (!tabKey) {
    return;
  }

  moveConversationRequestInFlight = true;
  button.disabled = true;
  button.classList.add("is-moving");

  try {
    const sessions = await readChatSessions();
    const session = sessions.find((item) => item.id === candidate.sessionId);
    if (!session) {
      dismissMoveConversationPrompt(candidate.sessionId);
      showFloatingToast("这段对话已经不存在", true);
      return;
    }

    const state = pruneConversationState(loadTabConversationState(), sessions);
    const previousBinding = getValidTabBinding(state, tabKey, sessions);
    mergeCurrentTabIntoSessionContext(candidate.sessionId);
    updateTabBinding(state, tabKey, candidate.sessionId, { provisional: false });
    rememberConversationActivity(state, tabKey, session);
    saveTabConversationState(state);

    if (
      previousBinding?.provisional &&
      previousBinding.sessionId &&
      previousBinding.sessionId !== candidate.sessionId
    ) {
      void deleteChatSessionFromDb(previousBinding.sessionId);
    }

    currentConversationSessionId = candidate.sessionId;
    moveConversationCandidate = null;
    moveConversationCandidateSignature = "";
    applySessionTabContext(candidate.sessionId);
    restoreCurrentTab(activePageTab?.url || "");
    await ensureChatSessionSelected(candidate.sessionId, sessions);
    updateContextBanner();
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    showFloatingToast(`移动对话失败：${message}`, true);
  } finally {
    moveConversationRequestInFlight = false;
    button.disabled = false;
    button.classList.remove("is-moving");
    scheduleEnhancement();
  }
}

function dismissMoveConversationPrompt(sessionId = moveConversationCandidate?.sessionId) {
  if (!sessionId) {
    return;
  }
  const tabKey = getActiveTabKey();
  if (tabKey) {
    const state = loadTabConversationState();
    state.dismissedMovePrompts[tabKey] = {
      sessionId,
      dismissedAt: Date.now(),
    };
    saveTabConversationState(state);
  }
  moveConversationCandidate = null;
  moveConversationCandidateSignature = "";
  document.querySelector(".sidepanel-move-conversation")?.remove();
}

function getActiveTabKey() {
  if (!activePageTab) {
    return "";
  }
  if (typeof activePageTab.id === "number" && typeof activePageTab.windowId === "number") {
    return `tab:${activePageTab.windowId}:${activePageTab.id}`;
  }
  return activePageTab.url ? `url:${activePageTab.url}` : "";
}

function makeActiveTabRecord() {
  return {
    tabId: typeof activePageTab?.id === "number" ? activePageTab.id : undefined,
    windowId: typeof activePageTab?.windowId === "number" ? activePageTab.windowId : undefined,
    url: activePageTab?.url || "",
    title: activePageTab?.title || activePageTab?.url || "当前标签页",
    favIconUrl: activePageTab?.favIconUrl || "",
  };
}

function loadTabConversationState() {
  const fallback = {
    tabBindings: {},
    dismissedMovePrompts: {},
    lastConversation: null,
  };
  try {
    const parsed = JSON.parse(localStorage.getItem(TAB_CONVERSATION_STATE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") {
      return fallback;
    }
    return {
      tabBindings:
        parsed.tabBindings && typeof parsed.tabBindings === "object"
          ? parsed.tabBindings
          : {},
      dismissedMovePrompts:
        parsed.dismissedMovePrompts && typeof parsed.dismissedMovePrompts === "object"
          ? parsed.dismissedMovePrompts
          : {},
      lastConversation:
        parsed.lastConversation && typeof parsed.lastConversation === "object"
          ? parsed.lastConversation
          : null,
    };
  } catch (error) {
    return fallback;
  }
}

function saveTabConversationState(state) {
  try {
    localStorage.setItem(TAB_CONVERSATION_STATE_KEY, JSON.stringify(state));
  } catch (error) {
    // localStorage 不可用时，本次页面内状态仍可继续工作。
  }
}

function pruneConversationState(state, sessions) {
  const sessionIds = new Set(sessions.map((session) => session.id));
  const now = Date.now();
  state.tabBindings ||= {};
  state.dismissedMovePrompts ||= {};

  for (const [key, binding] of Object.entries(state.tabBindings)) {
    if (!binding?.sessionId || !sessionIds.has(binding.sessionId)) {
      delete state.tabBindings[key];
    }
  }

  for (const [key, dismissal] of Object.entries(state.dismissedMovePrompts)) {
    if (
      !dismissal?.dismissedAt ||
      now - Number(dismissal.dismissedAt) > MOVE_CONVERSATION_TTL_MS
    ) {
      delete state.dismissedMovePrompts[key];
    }
  }

  if (
    state.lastConversation?.sessionId &&
    !sessionIds.has(state.lastConversation.sessionId)
  ) {
    state.lastConversation = null;
  }

  saveTabConversationState(state);
  return state;
}

function getValidTabBinding(state, tabKey, sessions) {
  const binding = state.tabBindings?.[tabKey];
  if (!binding?.sessionId) {
    return null;
  }
  return sessions.some((session) => session.id === binding.sessionId) ? binding : null;
}

function updateTabBinding(state, tabKey, sessionId, options = {}) {
  const existing = state.tabBindings?.[tabKey];
  state.tabBindings ||= {};
  state.tabBindings[tabKey] = {
    sessionId,
    provisional: Boolean(options.provisional),
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
    tab: makeActiveTabRecord(),
  };
}

function rememberConversationActivity(state, tabKey, session) {
  if (!session || !hasChatSessionMessages(session)) {
    return;
  }
  updateTabBinding(state, tabKey, session.id, { provisional: false });
  state.lastConversation = {
    sessionId: session.id,
    title: getChatSessionTitle(session),
    lastActiveAt: Date.now(),
    sessionUpdatedAt: session.updatedAt || Date.now(),
    tabKey,
    tab: makeActiveTabRecord(),
  };
}

function captureVisibleConversationActivity(state, tabKey, sessions) {
  if (!hasVisibleConversationMessages()) {
    return;
  }

  const activeId = getActiveSessionIdFromDom() || currentConversationSessionId;
  let session = activeId ? sessions.find((item) => item.id === activeId) : null;
  if (!session || !hasChatSessionMessages(session)) {
    session = sessions.find((item) => !item.archived && hasChatSessionMessages(item));
  }
  if (!session) {
    return;
  }

  currentConversationSessionId = session.id;
  rememberConversationActivity(state, tabKey, session);
  saveTabConversationState(state);
  persistCurrentSessionSharedTabs(session.id);
}

function getMoveConversationCandidate(state, sessions, tabKey, activeSessionId) {
  const now = Date.now();
  const fromLast = resolveStoredLastConversation(state, sessions);
  const latestSession = sessions.find(
    (session) => !session.archived && hasChatSessionMessages(session),
  );
  const candidates = [fromLast, latestSession && makeCandidateFromSession(latestSession, state)]
    .filter(Boolean)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);

  for (const candidate of candidates) {
    if (candidate.sessionId === activeSessionId) {
      continue;
    }
    if (candidate.tabKey && candidate.tabKey === tabKey) {
      continue;
    }
    if (now - candidate.lastActiveAt > MOVE_CONVERSATION_TTL_MS) {
      continue;
    }
    const dismissal = state.dismissedMovePrompts?.[tabKey];
    if (
      dismissal?.sessionId === candidate.sessionId &&
      now - Number(dismissal.dismissedAt || 0) <= MOVE_CONVERSATION_TTL_MS
    ) {
      continue;
    }
    return candidate;
  }

  return null;
}

function resolveStoredLastConversation(state, sessions) {
  const last = state.lastConversation;
  if (!last?.sessionId) {
    return null;
  }
  const session = sessions.find((item) => item.id === last.sessionId);
  if (!session || session.archived || !hasChatSessionMessages(session)) {
    return null;
  }
  return {
    sessionId: session.id,
    title: last.title || getChatSessionTitle(session),
    lastActiveAt: Number(last.lastActiveAt || session.updatedAt || 0),
    tabKey: last.tabKey || findTabKeyForSession(state, session.id),
  };
}

function makeCandidateFromSession(session, state) {
  return {
    sessionId: session.id,
    title: getChatSessionTitle(session),
    lastActiveAt: Number(session.updatedAt || session.createdAt || 0),
    tabKey: findTabKeyForSession(state, session.id),
  };
}

function findTabKeyForSession(state, sessionId) {
  return (
    Object.entries(state.tabBindings || {}).find(
      ([, binding]) => binding?.sessionId === sessionId && !binding.provisional,
    )?.[0] || ""
  );
}

function hasVisibleConversationMessages() {
  return Boolean(document.querySelector(".message-list .message-entry"));
}

function hasChatSessionMessages(session) {
  return Array.isArray(session?.messages) && session.messages.length > 0;
}

function getChatSessionTitle(session) {
  const title = session?.titleGenerating ? "生成标题中..." : session?.title;
  return (title || "新对话").trim() || "新对话";
}

function getActiveSessionIdFromDom() {
  const active = document.querySelector(
    ".session-item-active [data-session-id], .session-item-active[data-session-id]",
  );
  if (active instanceof HTMLElement && active.dataset.sessionId) {
    return active.dataset.sessionId;
  }
  return "";
}

function findSessionButton(sessionId, session = null) {
  const byId = Array.from(
    document.querySelectorAll(".session-title-button[data-session-id]"),
  ).find((button) => button instanceof HTMLElement && button.dataset.sessionId === sessionId);
  if (byId) {
    return byId;
  }

  const title = session ? getChatSessionTitle(session) : "";
  if (!title) {
    return null;
  }
  return Array.from(document.querySelectorAll(".session-title-button")).find((button) => {
    const buttonTitle = button.getAttribute("title") || button.textContent?.trim() || "";
    return buttonTitle === title;
  });
}

async function ensureChatSessionSelected(sessionId, sessions = []) {
  if (!sessionId || getActiveSessionIdFromDom() === sessionId) {
    return true;
  }

  const session = sessions.find((item) => item.id === sessionId) || null;
  let button = findSessionButton(sessionId, session);
  if (!button) {
    await revealHistoryForSessionSelection();
    button = findSessionButton(sessionId, session);
  }
  if (!button) {
    return false;
  }

  button.click();
  await waitForDomSettle();
  closeHistoryDrawer();
  return true;
}

async function revealHistoryForSessionSelection() {
  const trigger = document.querySelector(
    ".chat-history-trigger, .app-header-icon-button[aria-label='历史记录'], .app-header-icon-button[aria-label='会话历史']",
  );
  trigger?.click();
  await waitForDomSettle();
}

async function createFreshConversationForTab() {
  const before = await readChatSessions();
  const beforeIds = new Set(before.map((session) => session.id));
  const created = await triggerNativeNewConversation();
  if (!created) {
    return null;
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await waitForDomSettle();
    const after = await readChatSessions();
    const fresh =
      after.find((session) => !beforeIds.has(session.id)) ||
      after.find((session) => session.updatedAt >= Math.max(0, ...before.map((s) => s.updatedAt || 0)));
    if (fresh) {
      return fresh;
    }
  }
  return null;
}

function loadSessionTabContexts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_TAB_CONTEXTS_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

function saveSessionTabContexts(contexts) {
  try {
    localStorage.setItem(SESSION_TAB_CONTEXTS_KEY, JSON.stringify(contexts));
  } catch (error) {
    // 忽略持久化失败，当前页面内的 banner 仍可显示。
  }
}

function normalizeSharedTab(tab) {
  if (!tab?.url) {
    return null;
  }
  return {
    url: tab.url,
    title: tab.title || tab.url,
    favIconUrl: tab.favIconUrl || "",
    tabId: typeof tab.tabId === "number" ? tab.tabId : undefined,
    windowId: typeof tab.windowId === "number" ? tab.windowId : undefined,
  };
}

function applySessionTabContext(sessionId) {
  const contexts = loadSessionTabContexts();
  const context = contexts[sessionId];
  const activeUrl = activePageTab?.url || "";
  restoreCurrentTab(activeUrl);

  if (!context?.tabs?.length) {
    userExtraSelectedSnapshot = [];
    lastPersistedSessionContextSignature = "";
    return;
  }

  const tabs = context.tabs.map(normalizeSharedTab).filter(Boolean);
  userExtraSelectedSnapshot = tabs
    .filter((tab) => tab.url && tab.url !== activeUrl)
    .map((tab) => ({
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl || "",
    }));
}

function persistCurrentSessionSharedTabs(sessionId = currentConversationSessionId) {
  if (!sessionId) {
    return;
  }

  const sharedTabs = buildSharedTabs().map(normalizeSharedTab).filter(Boolean);
  const signature = `${sessionId}|${sharedTabs
    .map((tab) => `${tab.url}\u0001${tab.title}\u0001${tab.favIconUrl}`)
    .join("\u0002")}`;
  if (signature === lastPersistedSessionContextSignature) {
    return;
  }

  const contexts = loadSessionTabContexts();
  contexts[sessionId] = {
    tabs: dedupeSharedTabs(sharedTabs),
    updatedAt: Date.now(),
  };
  saveSessionTabContexts(contexts);
  lastPersistedSessionContextSignature = signature;
}

function mergeCurrentTabIntoSessionContext(sessionId) {
  if (!sessionId || !activePageTab?.url) {
    return;
  }
  const contexts = loadSessionTabContexts();
  const existing = Array.isArray(contexts[sessionId]?.tabs) ? contexts[sessionId].tabs : [];
  const next = dedupeSharedTabs([...existing, makeActiveTabRecord()]);
  contexts[sessionId] = {
    tabs: next,
    updatedAt: Date.now(),
  };
  saveSessionTabContexts(contexts);
  lastPersistedSessionContextSignature = "";
}

function dedupeSharedTabs(tabs) {
  const result = [];
  const seen = new Set();
  for (const tab of tabs.map(normalizeSharedTab).filter(Boolean)) {
    const key = tab.url || `${tab.windowId}:${tab.tabId}`;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(tab);
  }
  return result.slice(-12);
}

function openChatDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) {
      reject(new Error("当前环境不支持 IndexedDB"));
      return;
    }
    const request = indexedDB.open(CHAT_DB_NAME);
    request.onerror = () => reject(request.error || new Error("打开会话数据库失败"));
    request.onsuccess = () => resolve(request.result);
  });
}

async function readChatSessions() {
  let db = null;
  try {
    db = await openChatDb();
    if (!db.objectStoreNames.contains(CHAT_SESSION_STORE)) {
      db.close();
      return [];
    }
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(CHAT_SESSION_STORE, "readonly");
      const store = transaction.objectStore(CHAT_SESSION_STORE);
      const request = store.getAll();
      request.onerror = () => reject(request.error || new Error("读取会话失败"));
      request.onsuccess = () => {
        const sessions = Array.isArray(request.result) ? request.result : [];
        resolve(
          sessions
            .map(normalizeChatSession)
            .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)),
        );
      };
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => reject(transaction.error || new Error("读取会话失败"));
    });
  } catch (error) {
    try {
      db?.close();
    } catch {
      // ignored
    }
    return [];
  }
}

async function deleteChatSessionFromDb(sessionId) {
  let db = null;
  try {
    db = await openChatDb();
    if (!db.objectStoreNames.contains(CHAT_SESSION_STORE)) {
      db.close();
      return;
    }
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(CHAT_SESSION_STORE, "readwrite");
      transaction.objectStore(CHAT_SESSION_STORE).delete(sessionId);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("删除空对话失败"));
    });
  } catch (error) {
    console.warn("[sidepanel-layout] failed to delete provisional chat session", error);
  } finally {
    try {
      db?.close();
    } catch {
      // ignored
    }
  }
}

function normalizeChatSession(session) {
  return {
    ...session,
    id: String(session?.id || ""),
    title: typeof session?.title === "string" ? session.title : "新对话",
    archived: Boolean(session?.archived),
    createdAt: Number(session?.createdAt || 0),
    updatedAt: Number(session?.updatedAt || session?.createdAt || 0),
    messages: Array.isArray(session?.messages) ? session.messages : [],
  };
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

function closeSidePanelWindow(options = {}) {
  if (IS_FLOATING_FRAME) {
    return;
  }
  void closeSidePanelWindowAsync(options);
}

async function closeSidePanelWindowAsync(options = {}) {
  const closedByApi = await tryCloseSidePanelWithApi(options);
  if (closedByApi) {
    return;
  }

  try {
    const response = await sendRuntimeMessage({
      type: "sidePanel.close",
      reason: options.reason || "manual",
      tabId:
        typeof options.tabId === "number"
          ? options.tabId
          : typeof activePageTab?.id === "number"
            ? activePageTab.id
            : undefined,
      windowId:
        typeof options.windowId === "number"
          ? options.windowId
          : typeof myWindowId === "number"
            ? myWindowId
            : undefined,
    });
    if (response?.ok) {
      return;
    }
  } catch (error) {
    // 旧版浏览器 / 预览环境可能没有 sidePanel.close 消息兜底，继续尝试 window.close。
  }

  try {
    window.close();
  } catch (error) {
    // side panel 不一定允许 window.close，失败时静默降级。
  }
}

async function tryCloseSidePanelWithApi(options = {}) {
  const close = globalThis.chrome?.sidePanel?.close;
  if (typeof close !== "function") {
    return false;
  }

  const targets = [];
  const seen = new Set();
  const addTarget = (target) => {
    if (!target) {
      return;
    }
    const key = JSON.stringify(target);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    targets.push(target);
  };
  if (typeof options.tabId === "number") {
    addTarget({ tabId: options.tabId });
  }
  if (typeof activePageTab?.id === "number") {
    addTarget({ tabId: activePageTab.id });
  }
  if (typeof options.windowId === "number") {
    addTarget({ windowId: options.windowId });
  }
  if (typeof myWindowId === "number") {
    addTarget({ windowId: myWindowId });
  }

  for (const target of targets) {
    try {
      await close.call(globalThis.chrome.sidePanel, target);
      return true;
    } catch (error) {
      // Chrome 版本对 tabId/windowId 支持不完全一致，逐个尝试。
    }
  }
  return false;
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
  const label = sending ? "停止生成" : "发送";
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
  button.dataset.stopGeneration = sendingStr;

  // React 在发送中会禁用原按钮；但“停止生成”本身必须可点击。
  // 只在确认为发送中时解除 disabled，点击会在捕获阶段被 layout.js 拦截，
  // 不会落到原 onClick 触发二次发送。
  if (sending && button.disabled) {
    button.disabled = false;
    button.setAttribute("aria-disabled", "false");
  } else if (!sending) {
    button.removeAttribute("aria-disabled");
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
    list
      .querySelectorAll(".message-bubble-wrap-thinking")
      .forEach((wrap) => wrap.classList.remove("message-bubble-wrap-thinking"));
    document.body.classList.remove("sidepanel-stop-requested");
    return;
  }

  list.classList.add("message-list-thinking");
  list
    .querySelectorAll(".message-bubble-wrap-thinking")
    .forEach((wrap) => wrap.classList.remove("message-bubble-wrap-thinking"));
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

  const assistantWrap = findActiveAssistantBubbleWrap(list);
  if (assistantWrap) {
    assistantWrap.classList.add("message-bubble-wrap-thinking");
    const action = assistantWrap.querySelector(".message-regenerate-action-assistant");
    if (indicator.parentElement !== assistantWrap || indicator.nextElementSibling !== action) {
      assistantWrap.insertBefore(indicator, action || assistantWrap.firstChild);
    }
    return;
  }

  const lastUserEntry = findLastUserMessageEntry(list);
  if (lastUserEntry) {
    if (lastUserEntry.nextSibling !== indicator) {
      lastUserEntry.after(indicator);
    }
  } else if (indicator.parentElement !== list) {
    list.append(indicator);
  }
}

function findActiveAssistantBubbleWrap(list) {
  const entries = Array.from(list.querySelectorAll(".message-entry"));
  const lastUserEntry = findLastUserMessageEntry(list);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry === lastUserEntry) {
      break;
    }
    const row = entry.querySelector(".message-row:not(.message-row-user)");
    const wrap = row?.querySelector(".message-bubble-wrap");
    if (!wrap) {
      continue;
    }

    const bubbleText = wrap.querySelector(".message-bubble")?.textContent.trim() ?? "";
    const thinkingText = wrap.querySelector(".message-thinking")?.textContent.trim() ?? "";
    const hasVisibleAssistantContent = Boolean(bubbleText || thinkingText);
    if (!hasVisibleAssistantContent) {
      return wrap;
    }
  }
  return null;
}

function findLastUserMessageEntry(list) {
  const userRows = Array.from(list.querySelectorAll(".message-row-user"));
  return userRows.at(-1)?.closest(".message-entry") ?? null;
}

function positionMessagePopovers() {
  for (const popover of document.querySelectorAll(".message-regenerate-popover")) {
    const action = popover.closest(".message-regenerate-action");
    if (!action) {
      resetPositionedPopover(popover);
      continue;
    }
    positionAnchoredPopover(popover, action, {
      align: action.classList.contains("message-regenerate-action-user") ? "right" : "left",
      maxWidth: 224,
    });
  }

  for (const popover of document.querySelectorAll(".message-tool-call-popover")) {
    const row = popover.closest(".message-tool-call-row");
    const trigger = row?.querySelector(".message-tool-call-trigger");
    if (!trigger) {
      resetPositionedPopover(popover);
      continue;
    }
    positionAnchoredPopover(popover, trigger, {
      align: "left",
      maxWidth: 448,
    });
  }
}

function positionAnchoredPopover(popover, anchor, options = {}) {
  const viewportPadding = 12;
  const gap = 6;
  const anchorRect = anchor.getBoundingClientRect();
  const composerTop =
    document.querySelector(".chat-composer")?.getBoundingClientRect().top ??
    window.innerHeight;
  const bottomLimit = Math.max(viewportPadding, composerTop - 8);
  const width = Math.max(
    180,
    Math.min(options.maxWidth ?? 448, window.innerWidth - viewportPadding * 2),
  );

  popover.classList.add("sidepanel-positioned-popover");
  popover.style.width = `${width}px`;

  let left =
    options.align === "right" ? anchorRect.right - width : anchorRect.left;
  left = Math.min(
    Math.max(viewportPadding, left),
    window.innerWidth - width - viewportPadding,
  );

  const popoverHeight = popover.getBoundingClientRect().height;
  const belowTop = anchorRect.bottom + gap;
  const aboveTop = anchorRect.top - popoverHeight - gap;
  let top = belowTop;

  if (belowTop + popoverHeight > bottomLimit && aboveTop >= viewportPadding) {
    top = aboveTop;
  } else if (belowTop + popoverHeight > bottomLimit) {
    top = Math.max(viewportPadding, bottomLimit - popoverHeight);
  }

  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
}

function resetPositionedPopover(popover) {
  popover.classList.remove("sidepanel-positioned-popover");
  popover.style.left = "";
  popover.style.top = "";
  popover.style.width = "";
}

function syncLongMessageDisclosure() {
  for (const wrap of document.querySelectorAll(
    ".message-row-user .message-bubble-wrap",
  )) {
    const bubble = wrap.querySelector(".message-bubble");
    if (!(bubble instanceof HTMLElement)) {
      continue;
    }

    const text = bubble.textContent ?? "";
    const lineCount = text.split(/\r\n|\r|\n/).length;
    const shouldCollapse =
      text.trim().length > LONG_USER_MESSAGE_CHAR_THRESHOLD ||
      lineCount > LONG_USER_MESSAGE_LINE_THRESHOLD;
    let button = wrap.querySelector(":scope > .message-long-toggle");

    if (!shouldCollapse) {
      wrap.classList.remove(
        "message-bubble-wrap-long",
        "message-bubble-wrap-expanded",
      );
      delete wrap.dataset.longExpanded;
      button?.remove();
      continue;
    }

    wrap.classList.add("message-bubble-wrap-long");
    if (!wrap.dataset.longExpanded) {
      wrap.dataset.longExpanded = "false";
    }

    if (!bubble.id) {
      bubble.id = `sidepanel-message-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
    }

    if (!(button instanceof HTMLButtonElement)) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "message-long-toggle";
      button.setAttribute("aria-controls", bubble.id);
      button.addEventListener("click", () => {
        setLongMessageExpanded(
          wrap,
          wrap.dataset.longExpanded !== "true",
        );
      });
      const action = wrap.querySelector(":scope > .message-regenerate-action");
      wrap.insertBefore(button, action || null);
    } else if (button.getAttribute("aria-controls") !== bubble.id) {
      button.setAttribute("aria-controls", bubble.id);
    }

    setLongMessageExpanded(wrap, wrap.dataset.longExpanded === "true");
  }
}

function setLongMessageExpanded(wrap, expanded) {
  wrap.dataset.longExpanded = String(expanded);
  wrap.classList.toggle("message-bubble-wrap-expanded", expanded);
  const button = wrap.querySelector(":scope > .message-long-toggle");
  if (button instanceof HTMLButtonElement) {
    const label = expanded ? "收起" : "展开全文";
    button.textContent = label;
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("title", label);
  }
}

function syncMessageScrollState() {
  const list = document.querySelector(".message-list");
  if (!(list instanceof HTMLElement)) {
    messageListScrollTarget = null;
    return;
  }

  if (messageListScrollTarget !== list) {
    messageListScrollTarget = list;
    messageListPinnedToBottom = isMessageListNearBottom(list);
    list.addEventListener(
      "scroll",
      () => {
        messageListPinnedToBottom = isMessageListNearBottom(list);
        updateJumpToLatestButton(list);
      },
      { passive: true },
    );
  }

  if (messageListPinnedToBottom) {
    scheduleMessageListScrollToBottom(list);
  }
  updateJumpToLatestButton(list);
}

function isMessageListNearBottom(list) {
  return list.scrollHeight - list.scrollTop - list.clientHeight < 96;
}

function scheduleMessageListScrollToBottom(list) {
  if (messageListScrollRaf) {
    return;
  }
  messageListScrollRaf = requestAnimationFrame(() => {
    messageListScrollRaf = null;
    if (messageListScrollTarget !== list) {
      return;
    }
    if (messageListPinnedToBottom) {
      list.scrollTop = list.scrollHeight;
      messageListPinnedToBottom = true;
      updateJumpToLatestButton(list);
    }
  });
}

function updateJumpToLatestButton(list) {
  const panel = document.querySelector(".chat-panel");
  if (!panel) {
    return;
  }

  let button = panel.querySelector(".sidepanel-jump-latest");
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "sidepanel-jump-latest";
    button.textContent = "跳到最新";
    button.addEventListener("click", () => {
      const currentList = document.querySelector(".message-list");
      if (currentList instanceof HTMLElement) {
        currentList.scrollTop = currentList.scrollHeight;
        messageListPinnedToBottom = true;
        updateJumpToLatestButton(currentList);
      }
    });
    panel.append(button);
  }

  const hidden = isMessageListNearBottom(list);
  button.hidden = hidden;
  button.setAttribute("aria-hidden", String(hidden));
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

  drawer.querySelector(".history-dialog-title")?.replaceChildren();
  const mode = getHistoryDrawerMode(drawer);
  syncHistoryDrawerMode(drawer, mode);
  ensureHistoryMoreHeader(drawer);
  syncHistoryCompactItems(drawer);
  ensureHistoryMoreAction(drawer);

  let footer = drawer.querySelector(".sidepanel-drawer-footer");
  if (!footer || footer.dataset.variant !== "recent-menu") {
    footer?.remove();
    footer = document.createElement("div");
    footer.className = "sidepanel-drawer-footer";
    footer.dataset.variant = "recent-menu";
    footer.append(
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
  syncHistoryCustomScrollbar(drawer);
}

function getHistoryDrawerMode(drawer) {
  return drawer.dataset.sidepanelHistoryMode === "expanded" ? "expanded" : "compact";
}

function syncHistoryDrawerMode(drawer, mode) {
  drawer.dataset.sidepanelHistoryMode = mode;
  drawer.classList.toggle("is-history-expanded", mode === "expanded");
}

function ensureHistoryMoreHeader(drawer) {
  let header = drawer.querySelector(".sidepanel-history-more-header");
  if (header) {
    return header;
  }

  header = document.createElement("div");
  header.className = "sidepanel-history-more-header";

  const back = document.createElement("button");
  back.type = "button";
  back.className = "sidepanel-history-back";
  back.textContent = "返回";
  back.setAttribute("aria-label", "返回近期对话菜单");
  back.addEventListener("click", (event) => {
    startHistoryModeTransition(drawer, "compact", event);
  });

  header.append(back);
  const body = drawer.querySelector(".history-dialog-body");
  drawer.insertBefore(header, body || drawer.firstChild);
  return header;
}

function getHistorySessionItems(drawer) {
  return Array.from(drawer.querySelectorAll(".history-dialog-scroll .session-item"));
}

function syncHistoryCompactItems(drawer) {
  const expanded = getHistoryDrawerMode(drawer) === "expanded";
  const items = getHistorySessionItems(drawer);
  items.forEach((item, index) => {
    item.classList.toggle(
      "sidepanel-history-hidden-compact",
      !expanded && index >= RECENT_HISTORY_COMPACT_LIMIT,
    );
  });
}

function ensureHistoryMoreAction(drawer) {
  const body = drawer.querySelector(".history-dialog-body");
  if (!body) {
    return null;
  }

  const total = getHistorySessionItems(drawer).length;
  let more = drawer.querySelector(".sidepanel-history-more-action");
  if (total <= RECENT_HISTORY_COMPACT_LIMIT) {
    more?.remove();
    return null;
  }

  if (!more) {
    more = document.createElement("button");
    more.type = "button";
    more.className = "sidepanel-history-more-action";
    more.textContent = "更多";
    more.setAttribute("aria-label", "查看更多近期对话");
    more.addEventListener("click", (event) => {
      startHistoryModeTransition(drawer, "expanded", event);
    });
  }

  const scroll = drawer.querySelector(".history-dialog-scroll");
  if (scroll?.parentElement === body && more.previousElementSibling !== scroll) {
    scroll.after(more);
  } else if (more.parentElement !== body) {
    body.append(more);
  }

  more.hidden = getHistoryDrawerMode(drawer) === "expanded";
  return more;
}

function startHistoryModeTransition(drawer, nextMode, triggerEvent = null) {
  if (!drawer || historyMoreTransitionInFlight || getHistoryDrawerMode(drawer) === nextMode) {
    return;
  }

  historyMoreTransitionInFlight = true;
  const shouldMoveFocus = triggerEvent?.detail === 0;
  const toExpanded = nextMode === "expanded";
  const outClass = toExpanded ? "is-history-page-out-left" : "is-history-page-out-right";
  const inClass = toExpanded ? "is-history-page-in-right" : "is-history-page-in-left";

  drawer.classList.add(outClass);
  waitForDrawerAnimation(drawer).then(() => {
    drawer.classList.remove(outClass);
    syncHistoryDrawerMode(drawer, nextMode);
    syncHistoryCompactItems(drawer);
    ensureHistoryMoreAction(drawer);
    syncHistoryCustomScrollbar(drawer);
    drawer.classList.add(inClass);
    requestAnimationFrame(() => syncHistoryCustomScrollbar(drawer));

    waitForDrawerAnimation(drawer).then(() => {
      drawer.classList.remove(inClass);
      historyMoreTransitionInFlight = false;
      if (shouldMoveFocus) {
        if (nextMode === "expanded") {
          drawer.querySelector(".sidepanel-history-back")?.focus({ preventScroll: true });
        } else {
          drawer.querySelector(".sidepanel-history-more-action")?.focus({ preventScroll: true });
        }
      }
      syncHistoryCustomScrollbar(drawer);
    });
  });
}

function waitForDrawerAnimation(drawer) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = () => {
      if (resolved) {
        return;
      }
      resolved = true;
      drawer.removeEventListener("animationend", done, true);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 240);
    drawer.addEventListener("animationend", done, true);
  });
}

function getHistoryScrollTarget(drawer) {
  return drawer.querySelector(".history-dialog-scroll");
}

function syncHistoryCustomScrollbar(drawer) {
  const scroll = getHistoryScrollTarget(drawer);
  const expanded = getHistoryDrawerMode(drawer) === "expanded";
  let track = drawer.querySelector(".sidepanel-history-scrollbar");

  if (!scroll || !expanded) {
    if (track) {
      track.hidden = true;
    }
    return;
  }

  let thumb = track?.querySelector(".sidepanel-history-scrollbar-thumb");
  if (!track) {
    track = document.createElement("div");
    track.className = "sidepanel-history-scrollbar";
    track.setAttribute("aria-hidden", "true");
    thumb = document.createElement("div");
    thumb.className = "sidepanel-history-scrollbar-thumb";
    track.append(thumb);
    drawer.append(track);
  }

  if (!scroll.dataset.sidepanelHistoryScrollbarBound) {
    scroll.dataset.sidepanelHistoryScrollbarBound = "1";
    scroll.addEventListener("scroll", () => updateHistoryScrollbar(drawer), {
      passive: true,
    });
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => updateHistoryScrollbar(drawer)).observe(scroll);
    }
  }

  if (thumb && !track.dataset.sidepanelHistoryScrollbarBound) {
    track.dataset.sidepanelHistoryScrollbarBound = "1";
    bindHistoryScrollbarDrag(track, thumb, scroll, drawer);
  }

  requestAnimationFrame(() => updateHistoryScrollbar(drawer));
}

function updateHistoryScrollbar(drawer) {
  const scroll = getHistoryScrollTarget(drawer);
  const track = drawer.querySelector(".sidepanel-history-scrollbar");
  const thumb = track?.querySelector(".sidepanel-history-scrollbar-thumb");
  if (!scroll || !track || !thumb || getHistoryDrawerMode(drawer) !== "expanded") {
    return;
  }

  const scrollHeight = scroll.scrollHeight;
  const clientHeight = scroll.clientHeight;
  if (scrollHeight <= clientHeight + 1) {
    track.hidden = true;
    return;
  }

  track.hidden = false;
  const trackHeight = track.clientHeight;
  const thumbHeight = Math.max(30, (clientHeight / scrollHeight) * trackHeight);
  const maxScroll = scrollHeight - clientHeight;
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
  const thumbTop = maxScroll > 0 ? (scroll.scrollTop / maxScroll) * maxThumbTop : 0;
  thumb.style.height = `${thumbHeight}px`;
  thumb.style.top = `${thumbTop}px`;
}

function bindHistoryScrollbarDrag(track, thumb, scroll, drawer) {
  let dragging = false;
  let startY = 0;
  let startScrollTop = 0;

  thumb.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    dragging = true;
    startY = event.clientY;
    startScrollTop = scroll.scrollTop;
    thumb.setPointerCapture(event.pointerId);
    thumb.classList.add("is-dragging");
  });

  thumb.addEventListener("pointermove", (event) => {
    if (!dragging) {
      return;
    }
    const trackRange = Math.max(1, track.clientHeight - thumb.offsetHeight);
    const scrollRange = Math.max(1, scroll.scrollHeight - scroll.clientHeight);
    const dy = event.clientY - startY;
    scroll.scrollTop = startScrollTop + (dy / trackRange) * scrollRange;
  });

  const stopDrag = () => {
    dragging = false;
    thumb.classList.remove("is-dragging");
  };
  thumb.addEventListener("pointerup", stopDrag);
  thumb.addEventListener("pointercancel", stopDrag);

  track.addEventListener("pointerdown", (event) => {
    if (event.target === thumb) {
      return;
    }
    const rect = track.getBoundingClientRect();
    const targetTop = event.clientY - rect.top - thumb.offsetHeight / 2;
    const trackRange = Math.max(1, track.clientHeight - thumb.offsetHeight);
    const scrollRange = Math.max(1, scroll.scrollHeight - scroll.clientHeight);
    scroll.scrollTop = (targetTop / trackRange) * scrollRange;
    updateHistoryScrollbar(drawer);
  });
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
  persistCurrentSessionSharedTabs();

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
    persistCurrentSessionSharedTabs();
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
      if (shouldCloseSidePanelForTabSwitch(activeInfo)) {
        requestCloseSidePanelForTabSwitch(activeInfo);
        return;
      }
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

function shouldCloseSidePanelForTabSwitch(activeInfo) {
  if (IS_FLOATING_FRAME || tabSwitchCloseRequested) {
    return false;
  }
  if (typeof activeInfo?.tabId !== "number") {
    return false;
  }
  const previousTabId = activePageTab?.id;
  return typeof previousTabId === "number" && previousTabId !== activeInfo.tabId;
}

function requestCloseSidePanelForTabSwitch(activeInfo) {
  tabSwitchCloseRequested = true;
  closeSidePanelWindow({
    reason: "tab-switch",
    tabId: activeInfo.tabId,
    windowId: activeInfo.windowId,
  });
  window.setTimeout(() => {
    if (!tabSwitchCloseRequested || document.visibilityState === "hidden") {
      return;
    }
    // 老版 Chrome 若无法程序关闭 side panel，至少恢复刷新，避免留在旧标签页状态。
    tabSwitchCloseRequested = false;
    refreshTabsAndBanner();
  }, 900);
}

// 绑定输入区撤销/重做历史。只绑一次，靠 dataset 标记防止 MutationObserver 反复
// 重绑；React 重建 contenteditable 节点时重置并重新绑定。
function enhancePromptUndo() {
  const editor = document.querySelector(PROMPT_EDITOR_SELECTOR);
  if (!editor) {
    // 编辑器卸载（如切到空状态）时清理，避免悬挂引用与脏历史。
    if (promptUndoEditor) {
      resetPromptUndoState();
    }
    return;
  }
  if (editor === promptUndoEditor && editor.dataset.sidepanelUndoBound === "1") {
    reconcilePromptBaseline();
    return;
  }
  // 新的编辑器节点：重置历史并重新绑定。
  resetPromptUndoState();
  promptUndoEditor = editor;
  promptUndoBaseline = editor.textContent ?? "";
  editor.dataset.sidepanelUndoBound = "1";
  editor.addEventListener("input", handlePromptInput);
  editor.addEventListener("keydown", handlePromptUndoKeydown);
}

function resetPromptUndoState() {
  clearTimeout(promptUndoBurstTimer);
  promptUndoBurstTimer = null;
  if (promptUndoEditor) {
    promptUndoEditor.removeEventListener("input", handlePromptInput);
    promptUndoEditor.removeEventListener("keydown", handlePromptUndoKeydown);
    delete promptUndoEditor.dataset.sidepanelUndoBound;
  }
  promptUndoEditor = null;
  promptUndoStack = [];
  promptRedoStack = [];
  promptUndoBaseline = "";
  promptUndoApplying = false;
}

// React 在发送后等场景会直接重写 textContent（不触发 input 事件），导致 baseline
// 漂移。无进行中的合并窗口且文本与 baseline 不符时，按外部重置处理，避免撤销恢复
// 已发送内容。
function reconcilePromptBaseline() {
  if (promptUndoApplying || promptUndoBurstTimer) {
    return;
  }
  const editor = promptUndoEditor;
  if (!editor) {
    return;
  }
  const current = editor.textContent ?? "";
  if (current === promptUndoBaseline) {
    return;
  }
  promptUndoStack = [];
  promptRedoStack = [];
  promptUndoBaseline = current;
}

function handlePromptInput() {
  if (promptUndoApplying) {
    return;
  }
  if (moveConversationCandidate) {
    dismissMoveConversationPrompt();
  }
  const editor = promptUndoEditor;
  if (!editor) {
    return;
  }
  const current = editor.textContent ?? "";
  if (current === promptUndoBaseline) {
    return;
  }
  // 新的编辑分支作废 redo。
  promptRedoStack = [];
  // 连续输入合并：静默窗口内只在起点压入一次 baseline，整段输入算一个撤销步。
  if (promptUndoBurstTimer) {
    clearTimeout(promptUndoBurstTimer);
  } else {
    pushPromptUndoSnapshot(promptUndoBaseline);
  }
  promptUndoBurstTimer = setTimeout(() => {
    promptUndoBurstTimer = null;
  }, PROMPT_UNDO_COALESCE_MS);
  promptUndoBaseline = current;
}

function handlePromptUndoKeydown(event) {
  const mod = event.ctrlKey || event.metaKey;
  if (!mod || event.altKey) {
    return;
  }
  const key = event.key.toLowerCase();
  const isUndo = key === "z" && !event.shiftKey;
  const isRedo = (key === "z" && event.shiftKey) || key === "y";
  if (!isUndo && !isRedo) {
    return;
  }
  // 拦截浏览器原生 undo，统一走我们维护的历史。
  event.preventDefault();
  event.stopPropagation();
  if (isUndo) {
    performPromptUndo();
  } else {
    performPromptRedo();
  }
}

function pushPromptUndoSnapshot(value) {
  promptUndoStack.push(value);
  if (promptUndoStack.length > PROMPT_UNDO_HISTORY_LIMIT) {
    promptUndoStack.shift();
  }
}

function flushPromptBurst() {
  if (promptUndoBurstTimer) {
    clearTimeout(promptUndoBurstTimer);
    promptUndoBurstTimer = null;
  }
}

function performPromptUndo() {
  flushPromptBurst();
  const editor = promptUndoEditor;
  if (!editor || promptUndoStack.length === 0) {
    return;
  }
  const current = editor.textContent ?? "";
  const previous = promptUndoStack.pop();
  promptRedoStack.push(current);
  applyPromptHistory(previous);
}

function performPromptRedo() {
  flushPromptBurst();
  const editor = promptUndoEditor;
  if (!editor || promptRedoStack.length === 0) {
    return;
  }
  const current = editor.textContent ?? "";
  const next = promptRedoStack.pop();
  pushPromptUndoSnapshot(current);
  applyPromptHistory(next);
}

// 把历史值回灌进 React 受控编辑器：直接改 textContent 后派发 input 事件，让
// onInput 同步 value。promptUndoApplying 防止该 input 被当成新编辑记录。
function applyPromptHistory(value) {
  const editor = promptUndoEditor;
  if (!editor) {
    return;
  }
  promptUndoApplying = true;
  editor.focus();
  editor.textContent = value;
  promptUndoBaseline = value;
  moveCaretToEnd(editor);
  const event = new InputEvent("input", {
    bubbles: true,
    cancelable: true,
    data: value,
    inputType: value ? "insertText" : "deleteContentBackward",
  });
  editor.dispatchEvent(event);
  promptUndoApplying = false;
}

function fillPrompt(text) {
  const editor = document.querySelector(PROMPT_EDITOR_SELECTOR);

  if (!editor) {
    return;
  }
  if (moveConversationCandidate) {
    dismissMoveConversationPrompt();
  }

  // 确保历史已绑定（空状态点击建议时编辑器可能刚挂载），并把替换前的内容压入
  // 撤销栈，让 fillPrompt 也可撤销。
  enhancePromptUndo();
  if (promptUndoEditor === editor) {
    flushPromptBurst();
    pushPromptUndoSnapshot(editor.textContent ?? "");
    promptRedoStack = [];
    applyPromptHistory(text);
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

  document.addEventListener("click", handleStopGenerationClick, true);
  document.addEventListener("click", handleRegenerateDirectClick);

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
      const regenerateCancel = document.querySelector(".message-regenerate-cancel");
      const expandedToolCall = document.querySelector(
        '.message-tool-call-trigger[aria-expanded="true"]',
      );
      if (regenerateCancel instanceof HTMLButtonElement) {
        regenerateCancel.click();
      }
      if (expandedToolCall instanceof HTMLButtonElement) {
        expandedToolCall.click();
      }
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
  const repositionMessageLayers = () => {
    if (document.querySelector(".message-regenerate-popover, .message-tool-call-popover")) {
      positionMessagePopovers();
    }
  };
  window.addEventListener("scroll", repositionHistoryMenus, true);
  window.addEventListener("resize", repositionHistoryMenus);
  window.addEventListener("scroll", repositionMessageLayers, true);
  window.addEventListener("resize", repositionMessageLayers);

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

function handleStopGenerationClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const button = target.closest(".composer-actions .ui-button-primary");
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  if (button.dataset.sending !== "true") {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  requestStopGeneration();
}

function requestStopGeneration() {
  const stop = globalThis.__sidepanelStopGeneration;
  if (typeof stop === "function") {
    stop();
  }
  const live = ensureLiveRegion();
  live.textContent = "正在停止生成";
  document.body.classList.add("sidepanel-stop-requested");
}

function handleRegenerateDirectClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const button = target.closest(".message-regenerate-button");
  if (!(button instanceof HTMLButtonElement) || button.disabled) {
    return;
  }
  if (regenerateDirectTimer) {
    window.clearTimeout(regenerateDirectTimer);
  }

  const action = button.closest(".message-regenerate-action");
  const hadConfirmBeforeClick = Boolean(
    action?.querySelector(".message-regenerate-confirm"),
  );
  document.body.classList.add("sidepanel-regenerate-direct-pending");
  regenerateDirectTimer = window.setTimeout(() => {
    regenerateDirectTimer = null;
    const confirm = !hadConfirmBeforeClick
      ? action?.querySelector(".message-regenerate-confirm") ??
        document.querySelector(".message-regenerate-confirm")
      : null;
    if (confirm instanceof HTMLButtonElement) {
      confirm.click();
    }
    document.body.classList.remove("sidepanel-regenerate-direct-pending");
  }, 0);
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
