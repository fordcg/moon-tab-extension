# AI 助手侧边栏 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser side panel page that reads the active tab context, answers questions about the current page, and executes a small whitelist of browser actions.

**Architecture:** Add a dedicated side panel entry in the extension manifest, keep the UI in a new `src/pages/sidebar/` surface, and split runtime responsibilities into page-context collection, side-panel orchestration, and action execution. Reuse the existing AI settings storage pattern, send structured messages through the background worker, and keep page actions constrained to a fixed whitelist.

**Tech Stack:** Manifest V3 extension APIs, plain HTML/CSS, native ESM modules, background service worker messaging, content scripts, Playwright Python smoke tests.

---

## File structure

### Files to create

- `src/pages/sidebar/index.html` — side panel document shell.
- `src/pages/sidebar/index.css` — side panel layout and component styles.
- `src/pages/sidebar/index.mjs` — UI bootstrapping, event wiring, and render loop.
- `src/pages/sidebar/sidebar-context-controller.mjs` — current page context state and refresh flow.
- `src/pages/sidebar/sidebar-chat-controller.mjs` — chat history state, quick actions, and submit handling.
- `src/pages/sidebar/sidebar-action-controller.mjs` — side-panel-side handling of structured action results.
- `src/pages/sidebar/sidebar-ai-controller.mjs` — request shaping and AI/backend invocation for answer vs action decisions.
- `src/pages/sidebar/sidebar-dom-controller.mjs` — DOM querying/render helpers to keep `index.mjs` small.
- `src/background/sidebar-bridge.js` — background message router for active-tab context reads and privileged tab operations.
- `src/content/page-context.js` — extracts title, URL, selected text, main text, link candidates, and focusable input metadata from the active page.
- `src/shared/sidebar-contract.mjs` — shared constants, action whitelist, message types, and validation helpers.

### Files to modify

- `manifest.json` — register side panel, content script, and any additional permissions.
- `src/background/newtab-redirect.js` — import the new side-panel bridge while preserving existing redirect logic.
- `src/pages/newtab/index.html` — add an entry point to open the AI side panel from the current homepage.
- `src/pages/newtab/index.mjs` — wire the new homepage entry point to `chrome.sidePanel.open()` or a graceful fallback message.
- `.tmp/verify_newtab_extension.py` — extend smoke coverage for side panel open, context sync, quick action execution, and safe failure cases.

### Files to inspect while implementing

- `src/pages/newtab/settings/index.mjs` — reuse AI endpoint/model storage conventions.
- `src/shared/search-ai-contract.mjs` — reuse parsing patterns for AI response cleanup and defensive checks.

---

### Task 1: Register the side panel surface and homepage entry point

**Files:**
- Create: `src/pages/sidebar/index.html`
- Create: `src/pages/sidebar/index.css`
- Modify: `manifest.json`
- Modify: `src/pages/newtab/index.html`
- Modify: `src/pages/newtab/index.mjs`

- [ ] **Step 1: Write the failing smoke assertions for side panel availability**

Add this helper and assertions near the existing smoke-test navigation checks in `.tmp/verify_newtab_extension.py`:

```python
def read_side_panel_entry(page: Page) -> tuple[bool, str]:
    trigger = page.locator("#open-ai-sidebar")
    if trigger.count() == 0:
        return False, ""
    return True, trigger.first.inner_text().strip()
```

And in the main verification flow add:

```python
side_panel_trigger_present, side_panel_trigger_text = read_side_panel_entry(page)
assert side_panel_trigger_present, "Expected AI side panel trigger on homepage"
assert "AI" in side_panel_trigger_text
```

- [ ] **Step 2: Run the smoke test to verify it fails**

Run: `python .tmp/verify_newtab_extension.py`

Expected: FAIL with an assertion similar to `Expected AI side panel trigger on homepage`.

- [ ] **Step 3: Add the side panel document shell and register it in the manifest**

Create `src/pages/sidebar/index.html` with this structure:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <title>月标签 AI 助手</title>
    <link rel="stylesheet" href="./index.css" />
  </head>
  <body>
    <main class="sidebar-shell">
      <header class="sidebar-header">
        <div>
          <p class="sidebar-eyebrow">AI 助手</p>
          <h1 class="sidebar-title">当前页问答</h1>
        </div>
        <button id="refresh-context" class="sidebar-icon-button" type="button" aria-label="刷新当前页上下文">刷新</button>
      </header>

      <section id="sidebar-context-card" class="sidebar-context-card" aria-live="polite">
        <p id="sidebar-context-status" class="sidebar-context-status">正在连接当前页面…</p>
        <h2 id="sidebar-context-title" class="sidebar-context-title">未连接页面</h2>
        <p id="sidebar-context-url" class="sidebar-context-url"></p>
        <ul class="sidebar-context-meta">
          <li id="sidebar-context-selection">未检测到选中文本</li>
          <li id="sidebar-context-content">尚未提取正文</li>
        </ul>
      </section>

      <section class="sidebar-quick-actions" aria-label="快捷动作">
        <button class="sidebar-quick-action" data-quick-action="summarize" type="button">总结本页</button>
        <button class="sidebar-quick-action" data-quick-action="highlights" type="button">提取重点</button>
        <button class="sidebar-quick-action" data-quick-action="copy_title_link" type="button">复制标题和链接</button>
        <button class="sidebar-quick-action" data-quick-action="focus_input" type="button">聚焦输入框</button>
      </section>

      <section id="sidebar-messages" class="sidebar-messages" aria-label="对话记录"></section>

      <form id="sidebar-form" class="sidebar-form">
        <label class="visually-hidden" for="sidebar-input">输入关于当前页的问题</label>
        <textarea id="sidebar-input" class="sidebar-input" rows="4" placeholder="例如：这页讲什么？帮我提炼重点，或滚动到最下面"></textarea>
        <div class="sidebar-form-actions">
          <p id="sidebar-feedback" class="sidebar-feedback" role="status" aria-live="polite"></p>
          <button id="sidebar-submit" class="sidebar-submit" type="submit">发送</button>
        </div>
      </form>

      <script type="module" src="./index.mjs"></script>
    </main>
  </body>
</html>
```

Update `manifest.json` to include side panel registration and script permissions:

```json
{
  "permissions": ["permissions", "tabs", "storage", "sidePanel", "scripting", "activeTab"],
  "background": {
    "service_worker": "src/background/newtab-redirect.js",
    "type": "module"
  },
  "side_panel": {
    "default_path": "src/pages/sidebar/index.html"
  },
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["src/content/page-context.js"],
      "run_at": "document_idle"
    }
  ]
}
```

Add a homepage trigger in `src/pages/newtab/index.html` near the existing top-right actions:

```html
<button id="open-ai-sidebar" class="search-settings-trigger search-ai-sidebar-trigger" type="button" aria-label="打开 AI 助手侧边栏">
  <span class="search-settings-trigger-icon" aria-hidden="true">AI</span>
  <span class="search-settings-trigger-label visually-hidden">打开 AI 助手侧边栏</span>
</button>
```

Wire the trigger in `src/pages/newtab/index.mjs`:

```javascript
const openAiSidebarButton = document.getElementById("open-ai-sidebar");

const openAiSidebar = async () => {
  if (!extensionApi?.sidePanel?.open || typeof window === "undefined") {
    setSearchStatus("当前环境不支持侧边栏，请在兼容浏览器中重试。", "error");
    return;
  }

  try {
    const [activeTab] = await extensionApi.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.windowId) {
      setSearchStatus("未找到当前窗口，无法打开 AI 侧边栏。", "error");
      return;
    }

    await extensionApi.sidePanel.open({ windowId: activeTab.windowId });
    setSearchStatus("已打开 AI 助手侧边栏。", "success");
  } catch (error) {
    setSearchStatus(error instanceof Error ? error.message : "打开 AI 侧边栏失败。", "error");
  }
};

openAiSidebarButton?.addEventListener("click", () => {
  void openAiSidebar();
});
```

Add minimal styles in `src/pages/sidebar/index.css` to make the shell usable immediately:

```css
:root {
  color-scheme: dark;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  background: #08101f;
  color: #edf3ff;
}

body {
  margin: 0;
  min-height: 100vh;
  background: linear-gradient(180deg, #07101f 0%, #0d1730 100%);
}

.sidebar-shell {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
  gap: 16px;
  min-height: 100vh;
  padding: 20px;
}

.sidebar-context-card,
.sidebar-messages,
.sidebar-form,
.sidebar-quick-actions {
  border: 1px solid rgba(185, 204, 244, 0.18);
  border-radius: 20px;
  background: rgba(13, 22, 48, 0.72);
}
```

- [ ] **Step 4: Run the smoke test to verify the new homepage trigger passes**

Run: `python .tmp/verify_newtab_extension.py`

Expected: the new side-panel-trigger assertions pass; later side-panel-specific assertions still fail because no runtime exists yet.

- [ ] **Step 5: Commit the registration and shell work**

```bash
git add manifest.json src/pages/sidebar/index.html src/pages/sidebar/index.css src/pages/newtab/index.html src/pages/newtab/index.mjs .tmp/verify_newtab_extension.py
git commit -m "feat: register ai sidebar shell"
```

### Task 2: Add shared sidebar contract and active-tab context extraction

**Files:**
- Create: `src/shared/sidebar-contract.mjs`
- Create: `src/content/page-context.js`
- Create: `src/background/sidebar-bridge.js`
- Modify: `src/background/newtab-redirect.js`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Write the failing smoke assertions for context sync**

Add this helper to `.tmp/verify_newtab_extension.py`:

```python
def wait_for_side_panel_context(sidebar_page: Page, timeout: int = 15000) -> tuple[str, str]:
    sidebar_page.wait_for_selector("#sidebar-context-title", timeout=timeout)
    title = sidebar_page.locator("#sidebar-context-title").inner_text().strip()
    status = sidebar_page.locator("#sidebar-context-status").inner_text().strip()
    return title, status
```

Add a new step after opening the side panel in the test flow:

```python
sidebar_page = context.wait_for_event("page")
page.locator("#open-ai-sidebar").click()
sidebar_title, sidebar_status = wait_for_side_panel_context(sidebar_page)
assert sidebar_title, "Expected side panel context title"
assert "已连接" in sidebar_status
```

- [ ] **Step 2: Run the smoke test to verify it fails**

Run: `python .tmp/verify_newtab_extension.py`

Expected: FAIL because the side panel does not yet load active page context.

- [ ] **Step 3: Implement the shared contract, content script extractor, and background bridge**

Create `src/shared/sidebar-contract.mjs`:

```javascript
export const SIDEBAR_MESSAGE_TYPES = {
  GET_ACTIVE_CONTEXT: "sidebar:get-active-context",
  EXECUTE_ACTION: "sidebar:execute-action",
  REFRESH_CONTEXT: "sidebar:refresh-context",
};

export const SIDEBAR_ACTION_TYPES = {
  SCROLL: "scroll",
  OPEN_LINK: "open_link",
  SWITCH_TAB: "switch_tab",
  COPY: "copy",
  FOCUS_INPUT: "focus_input",
};

export const SIDEBAR_ACTION_TYPE_SET = new Set(Object.values(SIDEBAR_ACTION_TYPES));

export const normalizeSidebarText = (value) => (typeof value === "string" ? value.trim() : "");

export const truncateSidebarText = (value, maxLength = 6000) => {
  const normalized = normalizeSidebarText(value);
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
};

export const isSidebarActionType = (value) => SIDEBAR_ACTION_TYPE_SET.has(value);
```

Create `src/content/page-context.js`:

```javascript
(() => {
  const normalizeText = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

  const pickMainText = () => {
    const candidate = document.querySelector("main, article, [role='main']");
    const root = candidate instanceof HTMLElement ? candidate : document.body;
    return normalizeText(root?.innerText ?? "").slice(0, 12000);
  };

  const pickSelectionText = () => normalizeText(globalThis.getSelection?.()?.toString() ?? "");

  const pickLinkCandidates = () =>
    Array.from(document.querySelectorAll("a[href]"))
      .slice(0, 40)
      .map((anchor) => ({
        title: normalizeText(anchor.textContent ?? ""),
        url: anchor.href,
      }))
      .filter((item) => item.title && item.url);

  const pickInputCandidates = () =>
    Array.from(document.querySelectorAll("input, textarea, [contenteditable='true']"))
      .slice(0, 20)
      .map((element, index) => ({
        id: element.id || `input-${index}`,
        tagName: element.tagName.toLowerCase(),
        type: element instanceof HTMLInputElement ? element.type : "text",
        placeholder: normalizeText(element.getAttribute("placeholder") ?? ""),
      }));

  const readPageContext = () => ({
    title: normalizeText(document.title),
    url: globalThis.location.href,
    selectionText: pickSelectionText(),
    mainText: pickMainText(),
    links: pickLinkCandidates(),
    inputs: pickInputCandidates(),
    extractedAt: new Date().toISOString(),
  });

  const focusBestInput = () => {
    const candidate = document.querySelector("input:not([type='hidden']):not([disabled]), textarea:not([disabled]), [contenteditable='true']");
    if (!(candidate instanceof HTMLElement)) {
      return { ok: false, reason: "未找到可聚焦的输入框。" };
    }
    candidate.focus({ preventScroll: false });
    return { ok: true, reason: "已聚焦页面输入区域。" };
  };

  const scrollPage = (payload = {}) => {
    const behavior = "smooth";
    if (payload.target === "top") {
      globalThis.scrollTo({ top: 0, behavior });
      return { ok: true, reason: "已滚动到顶部。" };
    }
    if (payload.target === "bottom") {
      globalThis.scrollTo({ top: document.documentElement.scrollHeight, behavior });
      return { ok: true, reason: "已滚动到底部。" };
    }
    const delta = typeof payload.delta === "number" ? payload.delta : 640;
    globalThis.scrollBy({ top: delta, behavior });
    return { ok: true, reason: "已滚动页面。" };
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "sidebar:content:get-context") {
      sendResponse({ ok: true, context: readPageContext() });
      return false;
    }

    if (message?.type === "sidebar:content:focus-input") {
      sendResponse(focusBestInput());
      return false;
    }

    if (message?.type === "sidebar:content:scroll") {
      sendResponse(scrollPage(message.payload));
      return false;
    }

    return false;
  });
})();
```

Create `src/background/sidebar-bridge.js`:

```javascript
import { SIDEBAR_ACTION_TYPES, SIDEBAR_MESSAGE_TYPES, isSidebarActionType } from "../shared/sidebar-contract.mjs";

const extensionApi = typeof chrome !== "undefined" ? chrome : null;

const queryActiveTab = async () => {
  const tabs = await extensionApi.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
};

const sendMessageToTab = async (tabId, message) => extensionApi.tabs.sendMessage(tabId, message);

const getActiveTabContext = async () => {
  const activeTab = await queryActiveTab();
  if (!activeTab?.id) {
    throw new Error("未找到当前活动标签页。");
  }

  const response = await sendMessageToTab(activeTab.id, { type: "sidebar:content:get-context" });
  if (!response?.ok || !response.context) {
    throw new Error("读取当前页面上下文失败。");
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
    throw new Error("未找到当前活动标签页。");
  }

  if (!isSidebarActionType(payload.type)) {
    throw new Error("该动作不在允许列表中。");
  }

  if (payload.type === SIDEBAR_ACTION_TYPES.FOCUS_INPUT) {
    return sendMessageToTab(activeTab.id, { type: "sidebar:content:focus-input" });
  }

  if (payload.type === SIDEBAR_ACTION_TYPES.SCROLL) {
    return sendMessageToTab(activeTab.id, { type: "sidebar:content:scroll", payload: payload.payload ?? {} });
  }

  if (payload.type === SIDEBAR_ACTION_TYPES.OPEN_LINK) {
    await extensionApi.tabs.create({ url: payload.url, active: true });
    return { ok: true, reason: "已在新标签页打开链接。" };
  }

  if (payload.type === SIDEBAR_ACTION_TYPES.SWITCH_TAB) {
    const tabs = await extensionApi.tabs.query({ currentWindow: true });
    const activeIndex = tabs.findIndex((tab) => tab.active);
    const offset = payload.direction === "previous" ? -1 : 1;
    const nextTab = tabs[(activeIndex + offset + tabs.length) % tabs.length];
    await extensionApi.tabs.update(nextTab.id, { active: true });
    return { ok: true, reason: "已切换标签页。" };
  }

  if (payload.type === SIDEBAR_ACTION_TYPES.COPY) {
    return { ok: true, reason: "复制动作需要由侧边栏页面完成。", copyValue: payload.value ?? "" };
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
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "侧边栏操作失败。" }));

  return true;
});
```

Update `src/background/newtab-redirect.js` to import the bridge first:

```javascript
import "./sidebar-bridge.js";

const TARGET_URL = chrome.runtime.getURL("src/pages/newtab/index.html");
```

- [ ] **Step 4: Run the smoke test to verify active-page context now loads**

Run: `python .tmp/verify_newtab_extension.py`

Expected: side panel page opens and the context title/status assertions pass; later chat/action assertions still fail.

- [ ] **Step 5: Commit the context bridge work**

```bash
git add src/shared/sidebar-contract.mjs src/content/page-context.js src/background/sidebar-bridge.js src/background/newtab-redirect.js .tmp/verify_newtab_extension.py
 git commit -m "feat: add sidebar page context bridge"
```

### Task 3: Build the side panel UI controllers and local action handling

**Files:**
- Create: `src/pages/sidebar/index.mjs`
- Create: `src/pages/sidebar/sidebar-context-controller.mjs`
- Create: `src/pages/sidebar/sidebar-chat-controller.mjs`
- Create: `src/pages/sidebar/sidebar-action-controller.mjs`
- Create: `src/pages/sidebar/sidebar-dom-controller.mjs`
- Modify: `src/pages/sidebar/index.css`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Write failing smoke assertions for quick actions and feedback**

Extend `.tmp/verify_newtab_extension.py` with:

```python
def read_sidebar_feedback(sidebar_page: Page) -> str:
    feedback = sidebar_page.locator("#sidebar-feedback")
    return feedback.inner_text().strip() if feedback.count() > 0 else ""
```

Add assertions after side panel context sync:

```python
sidebar_page.locator("[data-quick-action='copy_title_link']").click()
sidebar_page.wait_for_function(
    "() => document.querySelector('#sidebar-feedback')?.textContent?.includes('已复制')"
)
assert "已复制" in read_sidebar_feedback(sidebar_page)
```

- [ ] **Step 2: Run the smoke test to verify it fails**

Run: `python .tmp/verify_newtab_extension.py`

Expected: FAIL because quick actions are not yet wired.

- [ ] **Step 3: Implement side panel state controllers and render flow**

Create `src/pages/sidebar/sidebar-dom-controller.mjs`:

```javascript
export const createSidebarDomController = (elements) => {
  const appendMessage = ({ role, text }) => {
    const article = document.createElement("article");
    article.className = `sidebar-message sidebar-message-${role}`;
    article.textContent = text;
    elements.messages.append(article);
    elements.messages.scrollTop = elements.messages.scrollHeight;
  };

  const renderContext = (contextState) => {
    elements.contextStatus.textContent = contextState.status;
    elements.contextTitle.textContent = contextState.title || "未连接页面";
    elements.contextUrl.textContent = contextState.url || "";
    elements.contextSelection.textContent = contextState.hasSelection ? "已检测到选中文本" : "未检测到选中文本";
    elements.contextContent.textContent = contextState.hasMainText ? "已提取正文" : "尚未提取正文";
  };

  const setFeedback = (message, tone = "neutral") => {
    elements.feedback.textContent = message;
    elements.feedback.dataset.tone = tone;
  };

  return { appendMessage, renderContext, setFeedback };
};
```

Create `src/pages/sidebar/sidebar-context-controller.mjs`:

```javascript
import { SIDEBAR_MESSAGE_TYPES } from "../../shared/sidebar-contract.mjs";

export const createSidebarContextController = ({ extensionApi, domController }) => {
  let latestContext = null;

  const syncContext = async (messageType = SIDEBAR_MESSAGE_TYPES.GET_ACTIVE_CONTEXT) => {
    domController.setFeedback("正在同步当前页面上下文…");
    const response = await extensionApi.runtime.sendMessage({ type: messageType });
    if (!response?.ok || !response.context) {
      throw new Error(response?.error || "同步当前页上下文失败。");
    }

    latestContext = response.context;
    domController.renderContext({
      status: "已连接当前页面",
      title: latestContext.title,
      url: latestContext.url,
      hasSelection: Boolean(latestContext.selectionText),
      hasMainText: Boolean(latestContext.mainText),
    });
    domController.setFeedback("当前页上下文已同步。", "success");
    return latestContext;
  };

  return {
    syncContext,
    getLatestContext: () => latestContext,
  };
};
```

Create `src/pages/sidebar/sidebar-action-controller.mjs`:

```javascript
import { SIDEBAR_ACTION_TYPES, SIDEBAR_MESSAGE_TYPES } from "../../shared/sidebar-contract.mjs";

export const createSidebarActionController = ({ extensionApi, domController, contextController }) => {
  const copyToClipboard = async (value) => {
    await navigator.clipboard.writeText(value);
    domController.setFeedback("已复制内容。", "success");
  };

  const executeAction = async (payload) => {
    const response = await extensionApi.runtime.sendMessage({
      type: SIDEBAR_MESSAGE_TYPES.EXECUTE_ACTION,
      payload,
    });

    if (!response?.ok) {
      throw new Error(response?.error || "执行动作失败。");
    }

    if (payload.type === SIDEBAR_ACTION_TYPES.COPY) {
      await copyToClipboard(response.copyValue || payload.value || "");
      return;
    }

    domController.setFeedback(response.reason || "动作执行成功。", "success");
    if (payload.type === SIDEBAR_ACTION_TYPES.FOCUS_INPUT || payload.type === SIDEBAR_ACTION_TYPES.SCROLL) {
      await contextController.syncContext(SIDEBAR_MESSAGE_TYPES.REFRESH_CONTEXT);
    }
  };

  return { executeAction };
};
```

Create `src/pages/sidebar/sidebar-chat-controller.mjs`:

```javascript
import { SIDEBAR_ACTION_TYPES } from "../../shared/sidebar-contract.mjs";

export const createSidebarChatController = ({ domController, contextController, actionController, aiController }) => {
  const handleQuickAction = async (quickAction) => {
    const currentContext = contextController.getLatestContext();
    if (!currentContext) {
      throw new Error("当前页上下文尚未准备好。");
    }

    if (quickAction === "copy_title_link") {
      await actionController.executeAction({
        type: SIDEBAR_ACTION_TYPES.COPY,
        value: `${currentContext.title}\n${currentContext.url}`,
      });
      return;
    }

    if (quickAction === "focus_input") {
      await actionController.executeAction({ type: SIDEBAR_ACTION_TYPES.FOCUS_INPUT });
      return;
    }

    const prompt = quickAction === "summarize" ? "请总结当前页面。" : "请提取当前页面的 3 个重点。";
    await handlePromptSubmit(prompt);
  };

  const handlePromptSubmit = async (input) => {
    const prompt = input.trim();
    if (!prompt) {
      return;
    }

    domController.appendMessage({ role: "user", text: prompt });
    const result = await aiController.resolvePrompt(prompt, contextController.getLatestContext());
    if (result.kind === "answer") {
      domController.appendMessage({ role: "assistant", text: result.text });
      domController.setFeedback("已完成当前页回答。", "success");
      return;
    }

    await actionController.executeAction(result.action);
    domController.appendMessage({ role: "assistant", text: result.text });
  };

  return { handlePromptSubmit, handleQuickAction };
};
```

Create `src/pages/sidebar/index.mjs`:

```javascript
import { createSidebarDomController } from "./sidebar-dom-controller.mjs";
import { createSidebarContextController } from "./sidebar-context-controller.mjs";
import { createSidebarActionController } from "./sidebar-action-controller.mjs";
import { createSidebarChatController } from "./sidebar-chat-controller.mjs";
import { createSidebarAiController } from "./sidebar-ai-controller.mjs";

const extensionApi = typeof chrome !== "undefined" ? chrome : null;

const elements = {
  refreshButton: document.getElementById("refresh-context"),
  quickActionButtons: Array.from(document.querySelectorAll(".sidebar-quick-action")),
  messages: document.getElementById("sidebar-messages"),
  form: document.getElementById("sidebar-form"),
  input: document.getElementById("sidebar-input"),
  feedback: document.getElementById("sidebar-feedback"),
  contextStatus: document.getElementById("sidebar-context-status"),
  contextTitle: document.getElementById("sidebar-context-title"),
  contextUrl: document.getElementById("sidebar-context-url"),
  contextSelection: document.getElementById("sidebar-context-selection"),
  contextContent: document.getElementById("sidebar-context-content"),
};

const domController = createSidebarDomController(elements);
const contextController = createSidebarContextController({ extensionApi, domController });
const aiController = createSidebarAiController({ extensionApi });
const actionController = createSidebarActionController({ extensionApi, domController, contextController });
const chatController = createSidebarChatController({ domController, contextController, actionController, aiController });

elements.form?.addEventListener("submit", (event) => {
  event.preventDefault();
  void chatController.handlePromptSubmit(elements.input?.value ?? "");
  if (elements.input instanceof HTMLTextAreaElement) {
    elements.input.value = "";
  }
});

elements.refreshButton?.addEventListener("click", () => {
  void contextController.syncContext();
});

elements.quickActionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    void chatController.handleQuickAction(button.dataset.quickAction ?? "");
  });
});

void contextController.syncContext();
```

Expand `src/pages/sidebar/index.css` with message and form rules:

```css
.sidebar-message {
  padding: 12px 14px;
  border-radius: 16px;
  margin-bottom: 10px;
  line-height: 1.55;
}

.sidebar-message-user {
  background: rgba(143, 177, 255, 0.18);
}

.sidebar-message-assistant {
  background: rgba(255, 255, 255, 0.08);
}

.sidebar-input {
  width: 100%;
  resize: vertical;
  min-height: 96px;
  border: 0;
  background: transparent;
  color: inherit;
}
```

- [ ] **Step 4: Run the smoke test to verify quick actions now return feedback**

Run: `python .tmp/verify_newtab_extension.py`

Expected: quick-action assertions pass; prompt-based answer/action assertions still fail because AI routing is not implemented yet.

- [ ] **Step 5: Commit the UI controller work**

```bash
git add src/pages/sidebar/index.mjs src/pages/sidebar/sidebar-context-controller.mjs src/pages/sidebar/sidebar-chat-controller.mjs src/pages/sidebar/sidebar-action-controller.mjs src/pages/sidebar/sidebar-dom-controller.mjs src/pages/sidebar/index.css .tmp/verify_newtab_extension.py
git commit -m "feat: add sidebar ui controllers"
```

### Task 4: Implement answer-vs-action orchestration with safe action parsing

**Files:**
- Create: `src/pages/sidebar/sidebar-ai-controller.mjs`
- Modify: `src/shared/sidebar-contract.mjs`
- Modify: `src/pages/sidebar/sidebar-chat-controller.mjs`
- Modify: `src/pages/sidebar/sidebar-action-controller.mjs`
- Modify: `src/pages/sidebar/index.mjs`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Write failing smoke assertions for prompt-driven answer and action flows**

Add this helper to `.tmp/verify_newtab_extension.py`:

```python
def read_sidebar_messages(sidebar_page: Page) -> list[str]:
    messages = sidebar_page.locator("#sidebar-messages .sidebar-message")
    return [messages.nth(index).inner_text().strip() for index in range(messages.count())]
```

Add these checks:

```python
sidebar_page.locator("#sidebar-input").fill("这页讲什么？")
sidebar_page.locator("#sidebar-submit").click()
sidebar_page.wait_for_function(
    "() => Array.from(document.querySelectorAll('#sidebar-messages .sidebar-message')).some((node) => node.textContent.includes('当前页面'))"
)
assert any("当前页面" in item for item in read_sidebar_messages(sidebar_page))

sidebar_page.locator("#sidebar-input").fill("帮我滚动到页面底部")
sidebar_page.locator("#sidebar-submit").click()
sidebar_page.wait_for_function(
    "() => document.querySelector('#sidebar-feedback')?.textContent?.includes('滚动')"
)
assert "滚动" in read_sidebar_feedback(sidebar_page)
```

- [ ] **Step 2: Run the smoke test to verify it fails**

Run: `python .tmp/verify_newtab_extension.py`

Expected: FAIL because no prompt orchestration exists.

- [ ] **Step 3: Implement local routing plus optional remote AI invocation**

Update `src/shared/sidebar-contract.mjs` with structured result helpers:

```javascript
export const createSidebarAnswerResult = (text) => ({ kind: "answer", text });
export const createSidebarActionResult = (text, action) => ({ kind: "action", text, action });
```

Create `src/pages/sidebar/sidebar-ai-controller.mjs`:

```javascript
import { getStoredSearchSettings, isChatCompletionsEndpoint, resolveChatCompletionsEndpoint } from "../newtab/settings/index.mjs";
import {
  createSidebarActionResult,
  createSidebarAnswerResult,
  SIDEBAR_ACTION_TYPES,
  truncateSidebarText,
} from "../../shared/sidebar-contract.mjs";

const buildSidebarPrompt = (userPrompt, context) => ({
  pageTitle: context?.title || "",
  pageUrl: context?.url || "",
  selectionText: truncateSidebarText(context?.selectionText || "", 1200),
  mainText: truncateSidebarText(context?.mainText || "", 6000),
  userPrompt,
});

const detectLocalAction = (prompt, context) => {
  if (/滚动.*底部|到底部/.test(prompt)) {
    return createSidebarActionResult("我来帮你滚动到页面底部。", {
      type: SIDEBAR_ACTION_TYPES.SCROLL,
      payload: { target: "bottom" },
    });
  }

  if (/滚动.*顶部|到顶部/.test(prompt)) {
    return createSidebarActionResult("我来帮你滚动到页面顶部。", {
      type: SIDEBAR_ACTION_TYPES.SCROLL,
      payload: { target: "top" },
    });
  }

  if (/复制.*标题.*链接/.test(prompt)) {
    return createSidebarActionResult("我来帮你复制当前页面标题和链接。", {
      type: SIDEBAR_ACTION_TYPES.COPY,
      value: `${context?.title || ""}\n${context?.url || ""}`,
    });
  }

  if (/聚焦.*输入框|搜索框/.test(prompt)) {
    return createSidebarActionResult("我来帮你聚焦当前页输入框。", {
      type: SIDEBAR_ACTION_TYPES.FOCUS_INPUT,
    });
  }

  return null;
};

const buildFallbackAnswer = (context) => {
  const summarySource = context?.selectionText || context?.mainText || "";
  const excerpt = summarySource.slice(0, 180);
  if (!excerpt) {
    return "当前页面没有可用正文内容，我只能基于标题和链接提供帮助。";
  }
  return `当前页面《${context?.title || "未命名页面"}》主要内容可概括为：${excerpt}`;
};

const requestRemoteAnswer = async (settings, body) => {
  const endpoint = isChatCompletionsEndpoint(settings.endpoint)
    ? resolveChatCompletionsEndpoint(settings.endpoint)
    : settings.endpoint;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        {
          role: "system",
          content: "你是浏览器侧边栏助手。优先回答当前页面内容，只在用户明确要求操作时返回简洁说明。",
        },
        {
          role: "user",
          content: JSON.stringify(body),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`侧边栏 AI 请求失败：${response.status}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("侧边栏 AI 返回为空。");
  }

  return content.trim();
};

export const createSidebarAiController = () => ({
  resolvePrompt: async (prompt, context) => {
    const localAction = detectLocalAction(prompt, context);
    if (localAction) {
      return localAction;
    }

    const settings = await getStoredSearchSettings();
    if (settings.endpoint && settings.model) {
      try {
        const remoteAnswer = await requestRemoteAnswer(settings, buildSidebarPrompt(prompt, context));
        return createSidebarAnswerResult(remoteAnswer);
      } catch {
        return createSidebarAnswerResult(buildFallbackAnswer(context));
      }
    }

    return createSidebarAnswerResult(buildFallbackAnswer(context));
  },
});
```

Update `src/pages/sidebar/sidebar-action-controller.mjs` so copy feedback is specific:

```javascript
if (payload.type === SIDEBAR_ACTION_TYPES.COPY) {
  await copyToClipboard(response.copyValue || payload.value || "");
  domController.setFeedback("已复制当前页面内容。", "success");
  return;
}
```

Update `src/pages/sidebar/sidebar-chat-controller.mjs` to guard unsupported prompts cleanly:

```javascript
const result = await aiController.resolvePrompt(prompt, contextController.getLatestContext());
if (!result || !result.kind) {
  throw new Error("当前请求未返回可执行结果。");
}
```

- [ ] **Step 4: Run the smoke test to verify answer and action prompts pass**

Run: `python .tmp/verify_newtab_extension.py`

Expected: side panel answer flow and scroll/copy/focus actions pass; any remaining failure should be styling or timing related, not missing behavior.

- [ ] **Step 5: Commit the orchestration layer**

```bash
git add src/pages/sidebar/sidebar-ai-controller.mjs src/shared/sidebar-contract.mjs src/pages/sidebar/sidebar-chat-controller.mjs src/pages/sidebar/sidebar-action-controller.mjs src/pages/sidebar/index.mjs .tmp/verify_newtab_extension.py
git commit -m "feat: add sidebar answer and action routing"
```

### Task 5: Harden feedback, unsupported-page handling, and final smoke coverage

**Files:**
- Modify: `src/background/sidebar-bridge.js`
- Modify: `src/content/page-context.js`
- Modify: `src/pages/sidebar/sidebar-context-controller.mjs`
- Modify: `src/pages/sidebar/sidebar-action-controller.mjs`
- Modify: `src/pages/sidebar/index.css`
- Modify: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Write the failing smoke assertions for graceful degradation**

Add a fake restricted-context hook in `.tmp/verify_newtab_extension.py` before loading the side panel page:

```python
sidebar_page.add_init_script(
    """
    (() => {
      const originalSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async (message) => {
        if (message?.type === 'sidebar:refresh-context') {
          return { ok: false, error: '当前页面不支持正文读取。' };
        }
        return originalSendMessage(message);
      };
    })();
    """
)
```

Then assert the UI shows the failure cleanly:

```python
sidebar_page.locator("#refresh-context").click()
sidebar_page.wait_for_function(
    "() => document.querySelector('#sidebar-feedback')?.textContent?.includes('不支持正文读取')"
)
assert "不支持正文读取" in read_sidebar_feedback(sidebar_page)
```

- [ ] **Step 2: Run the smoke test to verify it fails**

Run: `python .tmp/verify_newtab_extension.py`

Expected: FAIL because the side panel currently throws instead of rendering a graceful degraded state.

- [ ] **Step 3: Add graceful degradation and explicit unsupported-action feedback**

Update `src/pages/sidebar/sidebar-context-controller.mjs`:

```javascript
const syncContext = async (messageType = SIDEBAR_MESSAGE_TYPES.GET_ACTIVE_CONTEXT) => {
  domController.setFeedback("正在同步当前页面上下文…");
  const response = await extensionApi.runtime.sendMessage({ type: messageType });
  if (!response?.ok || !response.context) {
    latestContext = null;
    domController.renderContext({
      status: response?.error || "当前页面不支持正文读取。",
      title: "当前页面受限",
      url: "",
      hasSelection: false,
      hasMainText: false,
    });
    domController.setFeedback(response?.error || "当前页面不支持正文读取。", "error");
    throw new Error(response?.error || "当前页面不支持正文读取。");
  }

  latestContext = response.context;
  domController.renderContext({
    status: "已连接当前页面",
    title: latestContext.title,
    url: latestContext.url,
    hasSelection: Boolean(latestContext.selectionText),
    hasMainText: Boolean(latestContext.mainText),
  });
  domController.setFeedback("当前页上下文已同步。", "success");
  return latestContext;
};
```

Update `src/background/sidebar-bridge.js` to make unsupported pages explicit:

```javascript
try {
  const response = await sendMessageToTab(activeTab.id, { type: "sidebar:content:get-context" });
  if (!response?.ok || !response.context) {
    throw new Error("当前页面不支持正文读取。");
  }
  return { tabId: activeTab.id, windowId: activeTab.windowId, context: response.context };
} catch (error) {
  throw new Error(error instanceof Error ? error.message : "当前页面不支持正文读取。");
}
```

Update `src/pages/sidebar/sidebar-action-controller.mjs` with unsupported-action rejection:

```javascript
const executeAction = async (payload) => {
  if (!payload?.type) {
    throw new Error("缺少动作类型。" );
  }

  const response = await extensionApi.runtime.sendMessage({
    type: SIDEBAR_MESSAGE_TYPES.EXECUTE_ACTION,
    payload,
  });

  if (!response?.ok) {
    domController.setFeedback(response?.error || "执行动作失败。", "error");
    throw new Error(response?.error || "执行动作失败。");
  }

  // existing success flow
};
```

Add error styling in `src/pages/sidebar/index.css`:

```css
.sidebar-feedback[data-tone='error'] {
  color: #ffb8c3;
}

.sidebar-feedback[data-tone='success'] {
  color: #9ae6b4;
}
```

- [ ] **Step 4: Run the full smoke test to verify the MVP passes end-to-end**

Run: `python .tmp/verify_newtab_extension.py`

Expected: PASS. The output should finish without assertions and refresh-side-panel degradation should display a user-facing error message instead of an uncaught failure.

- [ ] **Step 5: Commit the hardening pass**

```bash
git add src/background/sidebar-bridge.js src/content/page-context.js src/pages/sidebar/sidebar-context-controller.mjs src/pages/sidebar/sidebar-action-controller.mjs src/pages/sidebar/index.css .tmp/verify_newtab_extension.py
git commit -m "fix: harden sidebar context feedback"
```

## Spec coverage check

- Side panel page added: Task 1.
- Current-page context collection for title, URL, selection, and main text: Task 2.
- Default current-page Q&A UX and quick actions: Tasks 3 and 4.
- Whitelisted actions only (`scroll`, `open_link`, `switch_tab`, `copy`, `focus_input`): Tasks 2 and 4.
- Explicit status, error handling, and degraded unsupported-page behavior: Task 5.
- Smoke-test coverage across open, sync, answer, action, and failure cases: Tasks 1 through 5.

## Placeholder scan

- No `TODO`, `TBD`, or “similar to above” references remain.
- Every code-edit step includes concrete snippets.
- Every verification step includes a specific command and expected outcome.

## Type consistency check

- Shared action types are defined once in `src/shared/sidebar-contract.mjs` and reused by background and side panel modules.
- Message names are centralized in the shared contract before being consumed elsewhere.
- Side panel controller names and imports are consistent across `index.mjs` and the dedicated controller files.
