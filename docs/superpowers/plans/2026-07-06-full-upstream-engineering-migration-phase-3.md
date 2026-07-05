# 全面迁移远程工程化结构 Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 恢复 AI 侧栏的 React 源码维护方式，把 `src/ai-assistant/sidePanel-layout.js` 中仍有价值的 DOM patch 行为迁入 `src/side-panel/` 组件、Zustand store 和 typed runtime message。

**Architecture:** Phase 3 以现有 Vite 入口 `index.html -> src/side-panel/main.tsx` 为唯一侧栏运行入口，不再把旧 bundle 或 DOM patch 作为长期源码。旧 `src/ai-assistant/sidePanel.js`、`src/ai-assistant/assets/*`、`src/ai-assistant/sidePanel-layout.js`、`src/ai-assistant/agent-tools-dialog.js` 只作为行为参考；所有可运行实现落在 React 组件、`src/side-panel/state/*`、`src/shared/*`、`src/background/index.ts` 和 `src/content/index.ts`。

**Tech Stack:** Chrome MV3, Vite, React 19, TypeScript, Zustand, Radix Dialog, Vitest, Testing Library, Playwright, PowerShell, Node.js >= 20.

---

## Scope

This plan implements only Phase 3 from `docs/superpowers/specs/2026-07-05-full-upstream-engineering-migration-design.md`.

In scope:

- Keep `dist/index.html` as the React side panel generated from `src/side-panel/main.tsx`.
- Add build/package contract tests that fail if the side panel runtime reintroduces `src/ai-assistant/sidePanel.js`, `sidePanel-layout.js`, `sidePanel-layout.css`, `agent-tools-dialog.js`, or `open-design-preview.html`.
- Move tab-level conversation continuity into Zustand actions and app settings.
- Add React top actions for new chat, floating window, history drawer, settings, browser control, and tools/MCP.
- Add typed floating-window runtime messages and minimal content-script iframe injection for the React side panel.
- Move empty state, "continue recent conversation / move here", long user-message disclosure, prompt undo/redo, send/stop affordance, and notifications into React components.
- Move history drawer compact/expanded behavior and settings drawer entry into React.
- Add React tools/MCP dialog with Grok preset and recent tool-call audit display derived from source-owned tool records.
- Update documentation and migration ledger so Phase 3 is recoverable from docs.

Out of scope:

- Deleting `src/ai-assistant/**` migration reference files. Physical deletion is Phase 6, after background/tool migration no longer references old DevTools compatibility modules.
- Enabling debugger permission in the built manifest.
- Replacing the DevTools Network bridge with the upstream CDP Network recorder.
- Migrating all background service-worker parity. Phase 3 only adds the runtime messages needed by the React side-panel UI.
- Rewriting Moon Tab newtab or game code.

## File Structure

Files to create:

- Create: `src/shared/sidePanelRuntime.ts` - typed runtime message constants, URL param parsing, side-panel launch context, and floating-frame payload types.
- Create: `src/side-panel/state/appStoreTabContinuity.ts` - tab/session binding state, migration-safe app setting normalization, active tab snapshot handling, move-conversation candidate calculation, and session shared-tab persistence.
- Create: `src/side-panel/components/SidePanelTopActions.tsx` - fixed top action buttons for new chat, floating window, history, settings, browser control, and tools/MCP.
- Create: `src/side-panel/components/EmptyState.tsx` - greeting, quick prompts, inline warning/failure notice, and optional move-conversation prompt.
- Create: `src/side-panel/components/MoveConversationPrompt.tsx` - "移到此处" UI for binding the current tab to a recent session.
- Create: `src/side-panel/components/AgentToolsDialog.tsx` - React replacement for `src/ai-assistant/agent-tools-dialog.js`.
- Create: `src/side-panel/utils/toolAudit.ts` - derive redacted, display-safe audit rows from `ChatToolCallRecord[]` already stored in chat sessions.
- Create: `src/shared/mcp/grokPreset.ts` - Grok MCP preset constants and helper for upserting the preset server.

Files to modify:

- Modify: `src/side-panel/App.tsx` - initialize side-panel launch context, own drawer/dialog state, and render top actions.
- Modify: `src/side-panel/components/ChatPanel.tsx` - accept controlled open handlers and render `EmptyState` through `MessageList`.
- Modify: `src/side-panel/components/ChatComposer.tsx` - use store-backed prompt fill, tab context dialog defaults, stop/send affordance, and floating-safe behavior.
- Modify: `src/side-panel/components/PromptInlineEditor.tsx` - add controlled undo/redo history.
- Modify: `src/side-panel/components/MessageList.tsx` - render empty state through a prop, collapse long user messages, and keep scroll-to-bottom behavior source-owned.
- Modify: `src/side-panel/components/SessionHistoryDialog.tsx` - add compact/recent mode, expanded mode, drawer footer actions, and settings slide handoff.
- Modify: `src/side-panel/components/SettingsPanel.tsx` - support drawer embedding without taking over the whole app shell.
- Modify: `src/side-panel/components/settings/McpToolSettings.tsx` - add Grok preset creation, refresh, and local command copy.
- Modify: `src/side-panel/state/appStore.ts` - expose Phase 3 state/actions from `appStoreTabContinuity.ts`, dialog helpers, and notification paths.
- Modify: `src/side-panel/state/appStorePageContext.ts` - default the active tab from the side-panel launch context and preserve user deselection.
- Modify: `src/side-panel/styles.css` - move needed layout styles from `sidePanel-layout.css` into React class names without DOM patch selectors.
- Modify: `src/background/index.ts` - handle `sidePanel.openFloating` and resolve active tab/window context.
- Modify: `src/content/index.ts` - handle `sidePanel.floating.attach` and `sidePanel.floating.close`.
- Modify: `public/manifest.json` - expose `index.html` and built assets for the floating iframe.
- Modify: `tests/unit/background/extensionBuildContract.test.ts` - assert the side-panel source contract and floating iframe manifest contract.
- Modify: `tests/unit/background/index.test.ts` - cover floating message dispatch from background to content script.
- Modify: `tests/unit/content/index.test.ts` - cover floating iframe attach/close idempotency.
- Modify: `tests/unit/side-panel/appStore.test.ts` - cover tab conversation continuity state.
- Modify: `tests/unit/side-panel/App.test.tsx` - cover top actions, drawers, Grok preset, audit display, empty state, prompt undo/redo, long messages, and notifications.
- Modify: `tests/e2e/extension-runtime.spec.ts` - smoke React side-panel top actions and no old DOM patch runtime.
- Modify: `README.md` and `docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md` - document React source ownership and legacy reference boundary.
- Modify: `docs/superpowers/MIGRATION_STATUS.md` - record Phase 3 plan and execution status.

Files intentionally left unchanged:

- `src/ai-assistant/sidePanel-layout.js`
- `src/ai-assistant/sidePanel-layout.css`
- `src/ai-assistant/sidePanel.js`
- `src/ai-assistant/assets/**`
- `src/ai-assistant/open-design-preview.html`

These files may be read as references during Phase 3, but no Phase 3 implementation step should add new behavior to them.

Important constraints:

- Use PowerShell commands only.
- Do not use bash heredoc.
- Use Chinese git commit messages.
- Do not stage `.claude/`.
- Do not add `debugger` permission in Phase 3.
- Do not make `src/ai-assistant/**` the source of truth for side-panel UI behavior.

---

### Task 1: Baseline And Phase Boundary Check

**Files:**

- Read only: repository state
- Read only: `docs/superpowers/specs/2026-07-05-full-upstream-engineering-migration-design.md`
- Read only: `docs/superpowers/MIGRATION_STATUS.md`
- Read only: `src/ai-assistant/sidePanel-layout.js`
- Read only: `src/side-panel/**`

- [ ] **Step 1: Confirm repository state**

Run:

```powershell
git status --short
git branch --show-current
git rev-parse --show-toplevel
```

Expected:

```text
?? .claude/
<current branch name>
D:/proj/test
```

If tracked files are dirty, stop and report them before continuing. Untracked `.claude/` is expected and must remain unstaged.

- [ ] **Step 2: Confirm Phase 2 verification still passes before changing runtime files**

Run:

```powershell
npm run typecheck
npm run build:extension
npm run test
npm run test:legacy
npm run check:package
```

Expected: every command exits successfully. If a command fails, capture the failing command and first actionable error. Fix only if the failure is caused by generated artifacts; otherwise stop and report the known-bad baseline.

- [ ] **Step 3: Record the Phase 3 source boundary**

Run:

```powershell
rg -n "sidePanel-layout|src/ai-assistant|sidePanel\\.js|agent-tools-dialog|open-design-preview" index.html public src tests scripts docs -g "!src/ai-assistant/**"
```

Expected before implementation: references exist in docs, tests, and legacy verification scripts. Runtime source under `src/side-panel/`, `src/background/index.ts`, `src/content/index.ts`, and `public/manifest.json` must become free of old side-panel bundle dependencies by the end of Phase 3.

---

### Task 2: Build Contracts For React-Owned Side Panel

**Files:**

- Modify: `tests/unit/background/extensionBuildContract.test.ts`
- Modify: `public/manifest.json`

- [ ] **Step 1: Write failing source ownership assertions**

Add this test block to `tests/unit/background/extensionBuildContract.test.ts`:

```ts
it("AI 侧栏构建入口应只使用 React 源码，不重新挂回旧 bundle 或 DOM patch", async () => {
  const rootIndexHtml = await readProjectFile("index.html");
  const viteConfig = await readProjectFile("vite.config.ts");
  const manifest = JSON.parse(await readProjectFile("public/manifest.json"));

  expect(rootIndexHtml).toContain('/src/side-panel/main.tsx');
  expect(rootIndexHtml).not.toContain("src/ai-assistant");
  expect(rootIndexHtml).not.toContain("sidePanel-layout");
  expect(rootIndexHtml).not.toContain("sidePanel.js");
  expect(viteConfig).toContain('sidePanel: resolve(rootDir, "index.html")');

  expect(manifest.side_panel.default_path).toBe("index.html");
  expect(JSON.stringify(manifest)).not.toContain("src/ai-assistant/sidePanel.js");
  expect(JSON.stringify(manifest)).not.toContain("src/ai-assistant/sidePanel-layout.js");
  expect(JSON.stringify(manifest)).not.toContain("src/ai-assistant/sidePanel-layout.css");
  expect(JSON.stringify(manifest)).not.toContain("open-design-preview.html");
});

it("悬浮窗 iframe 只暴露 React 侧栏入口和构建资产", async () => {
  const manifest = JSON.parse(await readProjectFile("public/manifest.json"));
  const resources = manifest.web_accessible_resources.flatMap((item: { resources: string[] }) => item.resources);

  expect(resources).toEqual(expect.arrayContaining(["index.html", "assets/*"]));
  expect(resources).not.toEqual(expect.arrayContaining(["src/ai-assistant/index.html", "src/ai-assistant/assets/*"]));
});
```

- [ ] **Step 2: Run the targeted failing test**

Run:

```powershell
npx vitest run tests/unit/background/extensionBuildContract.test.ts
```

Expected: FAIL only on the missing `index.html` floating iframe web-accessible resource if the side-panel source entry is already React-owned.

- [ ] **Step 3: Add the floating iframe resource contract**

Modify `public/manifest.json` so `web_accessible_resources[0].resources` contains:

```json
["index.html", "src/pages/game/index.html", "src/pages/game/vendor/matter.min.js", "assets/*"]
```

Expected: the built React side panel can be embedded as a floating iframe by the content script, while old `src/ai-assistant/**` files remain excluded from the built manifest.

- [ ] **Step 4: Verify the contract test passes**

Run:

```powershell
npx vitest run tests/unit/background/extensionBuildContract.test.ts
```

Expected: PASS.

---

### Task 3: Typed Side-Panel Runtime And Floating Window

**Files:**

- Create: `src/shared/sidePanelRuntime.ts`
- Modify: `src/background/index.ts`
- Modify: `src/content/index.ts`
- Modify: `tests/unit/background/index.test.ts`
- Modify: `tests/unit/content/index.test.ts`

- [ ] **Step 1: Write failing background and content tests**

Add background coverage in `tests/unit/background/index.test.ts`:

```ts
it("处理 React 侧栏悬浮窗请求并向当前网页注入 iframe", async () => {
  const mock = await importBackgroundWithChromeMock();
  mock.chrome.tabs.query.mockResolvedValueOnce([{ id: 7, windowId: 3, url: "https://example.com/", title: "页面" }]);
  mock.chrome.runtime.getURL.mockReturnValue("chrome-extension://ext/index.html");

  const response = await sendRuntimeMessage(mock, {
    type: "sidePanel.openFloating",
    tabId: 7,
    windowId: 3,
  });

  expect(response).toEqual({ ok: true });
  expect(mock.chrome.tabs.sendMessage).toHaveBeenCalledWith(7, {
    type: "sidePanel.floating.attach",
    url: "chrome-extension://ext/index.html?floating=1&tabId=7&windowId=3",
  });
});
```

Add content coverage in `tests/unit/content/index.test.ts`:

```ts
it("接收悬浮窗 attach 消息时只保留一个 React 侧栏 iframe", () => {
  const sendResponse = vi.fn();
  const listener = getRuntimeMessageListener();

  listener({ type: "sidePanel.floating.attach", url: "chrome-extension://ext/index.html?floating=1&tabId=7" }, {}, sendResponse);
  listener({ type: "sidePanel.floating.attach", url: "chrome-extension://ext/index.html?floating=1&tabId=7" }, {}, sendResponse);

  const frames = document.querySelectorAll("iframe[data-moon-tab-ai-floating-frame]");
  expect(frames).toHaveLength(1);
  expect(frames[0]).toHaveAttribute("src", "chrome-extension://ext/index.html?floating=1&tabId=7");
  expect(sendResponse).toHaveBeenLastCalledWith({ ok: true });
});

it("接收悬浮窗 close 消息时移除 iframe", () => {
  const sendResponse = vi.fn();
  const listener = getRuntimeMessageListener();

  listener({ type: "sidePanel.floating.attach", url: "chrome-extension://ext/index.html?floating=1" }, {}, sendResponse);
  listener({ type: "sidePanel.floating.close" }, {}, sendResponse);

  expect(document.querySelector("iframe[data-moon-tab-ai-floating-frame]")).toBeNull();
  expect(sendResponse).toHaveBeenLastCalledWith({ ok: true });
});
```

- [ ] **Step 2: Run targeted tests and verify they fail**

Run:

```powershell
npx vitest run tests/unit/background/index.test.ts tests/unit/content/index.test.ts
```

Expected: FAIL because `sidePanel.openFloating`, `sidePanel.floating.attach`, and `sidePanel.floating.close` are not implemented.

- [ ] **Step 3: Create `src/shared/sidePanelRuntime.ts`**

Create the module with these exported contracts:

```ts
export const SIDE_PANEL_OPEN_FLOATING_MESSAGE_TYPE = "sidePanel.openFloating" as const;
export const SIDE_PANEL_FLOATING_ATTACH_MESSAGE_TYPE = "sidePanel.floating.attach" as const;
export const SIDE_PANEL_FLOATING_CLOSE_MESSAGE_TYPE = "sidePanel.floating.close" as const;

export interface SidePanelLaunchContext {
  floating: boolean;
  tabId?: number;
  windowId?: number;
}

export interface SidePanelOpenFloatingMessage {
  type: typeof SIDE_PANEL_OPEN_FLOATING_MESSAGE_TYPE;
  tabId?: number;
  windowId?: number;
}

export interface SidePanelFloatingAttachMessage {
  type: typeof SIDE_PANEL_FLOATING_ATTACH_MESSAGE_TYPE;
  url: string;
}

export interface SidePanelFloatingCloseMessage {
  type: typeof SIDE_PANEL_FLOATING_CLOSE_MESSAGE_TYPE;
}

export type SidePanelRuntimeMessage =
  | SidePanelOpenFloatingMessage
  | SidePanelFloatingAttachMessage
  | SidePanelFloatingCloseMessage;

export type SidePanelRuntimeResponse = { ok: true } | { ok: false; message: string };

export function parseSidePanelLaunchContext(search = globalThis.location?.search ?? ""): SidePanelLaunchContext {
  const params = new URLSearchParams(search);
  return {
    floating: params.get("floating") === "1",
    tabId: parseIntegerParam(params.get("tabId") ?? params.get("sidePanelTabId")),
    windowId: parseIntegerParam(params.get("windowId") ?? params.get("sidePanelWindowId")),
  };
}

export function createFloatingSidePanelUrl(baseUrl: string, context: Pick<SidePanelLaunchContext, "tabId" | "windowId">): string {
  const url = new URL(baseUrl);
  url.searchParams.set("floating", "1");
  if (typeof context.tabId === "number") url.searchParams.set("tabId", String(context.tabId));
  if (typeof context.windowId === "number") url.searchParams.set("windowId", String(context.windowId));
  return url.toString();
}

function parseIntegerParam(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
```

- [ ] **Step 4: Handle floating requests in `src/background/index.ts`**

Import the shared contracts and add an `if` branch before the model catalog fallback:

```ts
if (message.type === SIDE_PANEL_OPEN_FLOATING_MESSAGE_TYPE) {
  void handleOpenFloatingSidePanelMessage(message).then(sendResponse);
  return true;
}
```

Add the helper near `openSidePanel`:

```ts
async function handleOpenFloatingSidePanelMessage(message: SidePanelOpenFloatingMessage): Promise<SidePanelRuntimeResponse> {
  const [fallbackTab] = typeof message.tabId === "number"
    ? []
    : await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = typeof message.tabId === "number" ? message.tabId : fallbackTab?.id;
  if (typeof tabId !== "number") {
    return { ok: false, message: "未找到可注入悬浮窗的当前标签页。" };
  }

  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  const windowId = typeof message.windowId === "number" ? message.windowId : tab?.windowId;
  const url = createFloatingSidePanelUrl(chrome.runtime.getURL("index.html"), { tabId, windowId });
  await chrome.tabs.sendMessage(tabId, { type: SIDE_PANEL_FLOATING_ATTACH_MESSAGE_TYPE, url });
  return { ok: true };
}
```

- [ ] **Step 5: Handle floating iframe in `src/content/index.ts`**

Keep the existing page-context listener and add a second runtime branch that:

- ignores unknown messages;
- creates one `iframe[data-moon-tab-ai-floating-frame]`;
- sets `position: fixed`, `right: 16px`, `bottom: 16px`, `width: min(420px, calc(100vw - 32px))`, `height: min(620px, calc(100vh - 32px))`, high `z-index`, border, border-radius, and shadow;
- removes the frame for `sidePanel.floating.close`;
- returns `{ ok: true }` through `sendResponse`.

- [ ] **Step 6: Verify targeted tests pass**

Run:

```powershell
npx vitest run tests/unit/background/index.test.ts tests/unit/content/index.test.ts
```

Expected: PASS.

---

### Task 4: Tab-Level Conversation Continuity Store

**Files:**

- Create: `src/side-panel/state/appStoreTabContinuity.ts`
- Modify: `src/side-panel/state/appStore.ts`
- Modify: `src/side-panel/state/appStorePageContext.ts`
- Modify: `tests/unit/side-panel/appStore.test.ts`

- [ ] **Step 1: Write failing store tests**

Add tests to `tests/unit/side-panel/appStore.test.ts`:

```ts
it("同一个浏览器标签页重新打开侧栏时恢复已绑定会话", async () => {
  await saveChatSession(createSession({ id: "session-tab-7", title: "页面 A", updatedAt: 100, messages: [createMessage({ id: "message-1", role: "user", content: "你好" })] }));
  await saveAppSetting({
    key: "sidepanel.tabConversationState.v1",
    value: {
      schemaVersion: 1,
      tabBindings: {
        "tab:7": { sessionId: "session-tab-7", updatedAt: 100, provisional: false },
      },
      recentSessions: [],
    },
    updatedAt: 100,
  });

  await useAppStore.getState().loadChatData();
  await useAppStore.getState().initializeSidePanelLaunchContext({ floating: false, tabId: 7, windowId: 3 });
  await useAppStore.getState().syncTabConversationContinuity();

  expect(useAppStore.getState().activeSessionId).toBe("session-tab-7");
});

it("新标签页空会话显示最近会话候选并可移到此处", async () => {
  await saveChatSession(createSession({ id: "session-recent", title: "最近对话", updatedAt: Date.now(), messages: [createMessage({ id: "message-1", role: "user", content: "继续分析" })] }));

  await useAppStore.getState().loadChatData();
  await useAppStore.getState().initializeSidePanelLaunchContext({
    floating: false,
    tabId: 8,
    windowId: 3,
    activeTab: { tabId: 8, title: "页面 B", url: "https://example.com/b", active: true, selected: true },
  });
  await useAppStore.getState().syncTabConversationContinuity();

  expect(useAppStore.getState().moveConversationCandidate).toMatchObject({ sessionId: "session-recent", title: "最近对话" });
  await useAppStore.getState().moveConversationToCurrentTab("session-recent");

  expect(useAppStore.getState().activeSessionId).toBe("session-recent");
  expect(await getAppSetting("sidepanel.tabConversationState.v1")).toMatchObject({
    tabBindings: {
      "tab:8": { sessionId: "session-recent", provisional: false },
    },
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```powershell
npx vitest run tests/unit/side-panel/appStore.test.ts
```

Expected: FAIL because `initializeSidePanelLaunchContext`, `syncTabConversationContinuity`, and `moveConversationToCurrentTab` do not exist.

- [ ] **Step 3: Implement tab continuity module**

Create `src/side-panel/state/appStoreTabContinuity.ts` with:

```ts
export const TAB_CONVERSATION_STATE_KEY = "sidepanel.tabConversationState.v1";
export const SESSION_TAB_CONTEXTS_KEY = "sidepanel.sessionTabContexts.v1";
export const MOVE_CONVERSATION_TTL_MS = 60 * 60 * 1000;

export interface TabConversationBinding {
  sessionId: string;
  updatedAt: number;
  provisional: boolean;
}

export interface TabConversationState {
  schemaVersion: 1;
  tabBindings: Record<string, TabConversationBinding>;
  recentSessions: Array<{ sessionId: string; tabKey: string; title: string; lastActiveAt: number }>;
}

export interface MoveConversationCandidate {
  sessionId: string;
  title: string;
  lastActiveAt: number;
}
```

The module must export these action helpers:

```ts
export async function initializeSidePanelLaunchContextAction(input: {
  context: SidePanelLaunchContext & { activeTab?: ContextTabCandidate };
  get: StoreGetter;
  set: StoreSetter;
}): Promise<void>

export async function syncTabConversationContinuityAction(input: {
  get: StoreGetter;
  set: StoreSetter;
}): Promise<void>

export async function moveConversationToCurrentTabAction(input: {
  sessionId: string;
  get: StoreGetter;
  set: StoreSetter;
}): Promise<void>
```

Implementation rules:

- Use `getAppSetting` and `saveAppSetting`, not direct `localStorage`.
- Use tab keys shaped as `tab:${tabId}`.
- Prune bindings whose `sessionId` no longer exists.
- If a valid binding exists, call `selectChatSession(binding.sessionId)`.
- If no binding exists and there is a recent non-archived session with messages updated within `MOVE_CONVERSATION_TTL_MS`, set `moveConversationCandidate`.
- `moveConversationToCurrentTab` must select the target session, write the current tab binding with `provisional: false`, persist shared tab context in `SESSION_TAB_CONTEXTS_KEY`, and clear `moveConversationCandidate`.

- [ ] **Step 4: Wire actions into `AppState`**

Add to `AppState` in `src/side-panel/state/appStore.ts`:

```ts
sidePanelLaunchContext: SidePanelLaunchContext;
activePageTab?: ContextTabCandidate;
moveConversationCandidate?: MoveConversationCandidate;
initializeSidePanelLaunchContext: (context: SidePanelLaunchContext & { activeTab?: ContextTabCandidate }) => Promise<void>;
syncTabConversationContinuity: () => Promise<void>;
moveConversationToCurrentTab: (sessionId: string) => Promise<void>;
dismissMoveConversationCandidate: () => void;
fillComposerPrompt: (text: string) => void;
composerPromptFillRequest?: { id: string; text: string };
```

Add initial state:

```ts
sidePanelLaunchContext: { floating: false },
activePageTab: undefined,
moveConversationCandidate: undefined,
composerPromptFillRequest: undefined,
```

Add actions:

```ts
initializeSidePanelLaunchContext: (context) => initializeSidePanelLaunchContextAction({ context, get, set }),
syncTabConversationContinuity: () => syncTabConversationContinuityAction({ get, set }),
moveConversationToCurrentTab: (sessionId) => moveConversationToCurrentTabAction({ sessionId, get, set }),
dismissMoveConversationCandidate: () => set({ moveConversationCandidate: undefined }),
fillComposerPrompt: (text) => set({ composerPromptFillRequest: { id: `prompt-fill-${Date.now()}`, text } }),
```

- [ ] **Step 5: Make context tab selection respect launch context**

Modify `loadContextTabsAction` so when no previous selection exists, it selects:

1. the tab matching `state.activePageTab?.tabId`;
2. otherwise the active tab returned by background;
3. otherwise the first injectable tab.

When the user deselects the active tab, keep that deselection until the dialog is reopened or `initializeSidePanelLaunchContext` changes tab id.

- [ ] **Step 6: Verify store tests pass**

Run:

```powershell
npx vitest run tests/unit/side-panel/appStore.test.ts
```

Expected: PASS.

---

### Task 5: React App Shell, Top Actions, Empty State, And Move Prompt

**Files:**

- Create: `src/side-panel/components/SidePanelTopActions.tsx`
- Create: `src/side-panel/components/EmptyState.tsx`
- Create: `src/side-panel/components/MoveConversationPrompt.tsx`
- Modify: `src/side-panel/App.tsx`
- Modify: `src/side-panel/components/ChatPanel.tsx`
- Modify: `src/side-panel/components/MessageList.tsx`
- Modify: `src/side-panel/components/ChatComposer.tsx`
- Modify: `tests/unit/side-panel/App.test.tsx`

- [ ] **Step 1: Write failing React tests**

Add these tests to `tests/unit/side-panel/App.test.tsx`:

```ts
it("顶部 React 操作区提供新对话、悬浮窗、历史、设置、浏览器控制和工具 MCP 入口", async () => {
  const sendMessage = createShortcutRuntimeMock();
  render(<App />);

  expect(await screen.findByRole("button", { name: "新建对话" })).toBeVisible();
  expect(screen.getByRole("button", { name: "打开悬浮窗" })).toBeVisible();
  expect(screen.getByRole("button", { name: "历史记录" })).toBeVisible();
  expect(screen.getByRole("button", { name: "设置" })).toBeVisible();
  expect(screen.getByRole("button", { name: "浏览器控制" })).toBeVisible();
  expect(screen.getByRole("button", { name: "工具和 MCP" })).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "打开悬浮窗" }));
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "sidePanel.openFloating" }), expect.any(Function));
});

it("空状态快捷提问通过 React store 填入输入框", async () => {
  render(<App />);

  await userEvent.click(await screen.findByRole("button", { name: "你能做些什么？" }));

  expect(screen.getByRole("textbox", { name: "输入聊天内容" })).toHaveTextContent("你能做些什么？");
});

it("空状态显示最近对话移到此处入口", async () => {
  useAppStore.setState({
    moveConversationCandidate: { sessionId: "session-recent", title: "最近对话", lastActiveAt: Date.now() },
  });
  const moveConversationToCurrentTab = vi.spyOn(useAppStore.getState(), "moveConversationToCurrentTab");

  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "移到此处" }));

  expect(moveConversationToCurrentTab).toHaveBeenCalledWith("session-recent");
});
```

- [ ] **Step 2: Run the failing React tests**

Run:

```powershell
npx vitest run tests/unit/side-panel/App.test.tsx --testNamePattern "顶部 React 操作区|空状态快捷提问|移到此处"
```

Expected: FAIL because the React top actions and empty-state move prompt do not exist.

- [ ] **Step 3: Implement `SidePanelTopActions`**

Create a component that accepts:

```ts
interface SidePanelTopActionsProps {
  historyOpen: boolean;
  settingsOpen: boolean;
  toolsOpen: boolean;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onOpenTools: () => void;
}
```

The component must:

- call `createChatSession({ preserveSelectedModel: composerHasDraft })` for "新建对话";
- call `sendRuntimeMessage({ type: SIDE_PANEL_OPEN_FLOATING_MESSAGE_TYPE, tabId, windowId })` for "打开悬浮窗";
- disable the floating button when `sidePanelLaunchContext.floating === true`;
- call `setBrowserControlEnabled(!browserControlEnabled)` for "浏览器控制";
- expose all icon buttons with stable aria labels.

- [ ] **Step 4: Implement `EmptyState` and `MoveConversationPrompt`**

`EmptyState` must render:

- greeting from current local hour;
- title `今天需要我做些什么？`;
- quick prompt buttons `你能做些什么？`, `我可以问哪些类型的问题？`, `帮我理清思路，解决问题`;
- warning/failure notice passed from `ChatPanel`;
- `MoveConversationPrompt` when `moveConversationCandidate` exists.

The quick prompt buttons must call `fillComposerPrompt(prompt)`.

- [ ] **Step 5: Wire empty state through `MessageList`**

Change `MessageList` props:

```ts
emptyState?: React.ReactNode;
```

When `messages.length === 0`, render:

```tsx
<section aria-label="消息列表" className="message-list message-list-empty-enhanced" ref={messageListRef} onScroll={handleMessageListScroll}>
  {emptyState ?? <p className="ui-muted text-sm">暂无消息</p>}
</section>
```

- [ ] **Step 6: Wire prompt fill into `ChatComposer`**

In `ChatComposer`, read `composerPromptFillRequest` from store and add:

```ts
useEffect(() => {
  if (!composerPromptFillRequest) {
    return;
  }
  setInput(composerPromptFillRequest.text);
  setSlashMenuOpen(false);
  setSlashQuery("");
  setSlashStartIndex(undefined);
}, [composerPromptFillRequest]);
```

- [ ] **Step 7: Initialize launch context in `App`**

Import `parseSidePanelLaunchContext` and call:

```ts
useEffect(() => {
  void initializeSidePanelLaunchContext(parseSidePanelLaunchContext()).then(() => syncTabConversationContinuity());
}, [initializeSidePanelLaunchContext, syncTabConversationContinuity]);
```

- [ ] **Step 8: Verify targeted React tests pass**

Run:

```powershell
npx vitest run tests/unit/side-panel/App.test.tsx --testNamePattern "顶部 React 操作区|空状态快捷提问|移到此处"
```

Expected: PASS.

---

### Task 6: History Drawer, Settings Entry, And Drawer Actions

**Files:**

- Modify: `src/side-panel/App.tsx`
- Modify: `src/side-panel/components/SessionHistoryDialog.tsx`
- Modify: `src/side-panel/components/SettingsPanel.tsx`
- Modify: `src/side-panel/styles.css`
- Modify: `tests/unit/side-panel/App.test.tsx`

- [ ] **Step 1: Write failing drawer tests**

Add tests:

```ts
it("历史抽屉底部提供设置、浏览器控制和工具 MCP 入口", async () => {
  render(<App />);

  await userEvent.click(await screen.findByRole("button", { name: "历史记录" }));
  const drawer = await screen.findByRole("dialog", { name: "历史记录" });

  expect(within(drawer).getByRole("button", { name: "设置" })).toBeVisible();
  expect(within(drawer).getByRole("button", { name: "浏览器控制" })).toBeVisible();
  expect(within(drawer).getByRole("button", { name: "工具和 MCP" })).toBeVisible();
});

it("历史抽屉可以切到设置抽屉并返回近期对话", async () => {
  render(<App />);

  await userEvent.click(await screen.findByRole("button", { name: "历史记录" }));
  await userEvent.click(within(screen.getByRole("dialog", { name: "历史记录" })).getByRole("button", { name: "设置" }));

  expect(await screen.findByRole("dialog", { name: "设置" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "返回近期对话" }));
  expect(await screen.findByRole("dialog", { name: "历史记录" })).toBeVisible();
});
```

- [ ] **Step 2: Run the failing drawer tests**

Run:

```powershell
npx vitest run tests/unit/side-panel/App.test.tsx --testNamePattern "历史抽屉"
```

Expected: FAIL until drawer footer actions and settings drawer mode exist.

- [ ] **Step 3: Move drawer state ownership to `App`**

In `App.tsx`, own:

```ts
const [historyOpen, setHistoryOpen] = useState(false);
const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
const [agentToolsOpen, setAgentToolsOpen] = useState(false);
```

Pass handlers into `ChatPanel` and `SidePanelTopActions`.

- [ ] **Step 4: Extend `SessionHistoryDialog`**

Add props:

```ts
interface SessionHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSettings: () => void;
  onOpenTools: () => void;
}
```

Render drawer footer actions:

```tsx
<footer className="sidepanel-drawer-footer">
  <button className="sidepanel-drawer-action" type="button" onClick={onOpenSettings}>设置</button>
  <button className="sidepanel-drawer-action" type="button" aria-pressed={browserControlEnabled} onClick={() => void setBrowserControlEnabled(!browserControlEnabled)}>浏览器控制</button>
  <button className="sidepanel-drawer-action" type="button" onClick={onOpenTools}>工具和 MCP</button>
</footer>
```

- [ ] **Step 5: Render settings as drawer**

Keep `SettingsPanel` as the settings content, but render it inside a Radix dialog from `App`:

```tsx
<Dialog.Root open={settingsDrawerOpen} onOpenChange={setSettingsDrawerOpen}>
  <Dialog.Portal>
    <Dialog.Overlay className="dialog-overlay" />
    <Dialog.Content className="drawer-panel settings-dialog" aria-label="设置">
      <div className="drawer-header">
        <button className="ui-button-secondary drawer-back-button" type="button" onClick={() => { setSettingsDrawerOpen(false); setHistoryOpen(true); }}>返回近期对话</button>
        <Dialog.Close className="ui-button-secondary drawer-icon-button" type="button" aria-label="关闭设置">×</Dialog.Close>
      </div>
      <SettingsPanel embedded />
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
```

Add `embedded?: boolean` to `SettingsPanel` so drawer mode does not assume full-page layout.

- [ ] **Step 6: Verify drawer tests pass**

Run:

```powershell
npx vitest run tests/unit/side-panel/App.test.tsx --testNamePattern "历史抽屉"
```

Expected: PASS.

---

### Task 7: Tools, MCP, Grok Preset, And Audit Display

**Files:**

- Create: `src/shared/mcp/grokPreset.ts`
- Create: `src/side-panel/utils/toolAudit.ts`
- Create: `src/side-panel/components/AgentToolsDialog.tsx`
- Modify: `src/side-panel/App.tsx`
- Modify: `src/side-panel/components/settings/McpToolSettings.tsx`
- Modify: `src/side-panel/styles.css`
- Modify: `tests/unit/side-panel/App.test.tsx`
- Modify: `tests/unit/side-panel/appStore.test.ts`

- [ ] **Step 1: Write failing Grok and audit tests**

Add tests:

```ts
it("工具和 MCP 对话框展示已发现工具、Grok 预设和最近工具调用审计", async () => {
  registeredModelToolsMock.tools = [
    {
      id: "mcp.grok-search.search",
      name: "mcp_grok_search_search",
      displayName: "Grok 搜索.search",
      description: "搜索公开网页",
      groupId: "mcp_remote",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      toolClassification: { runtime: "mcp_remote", capabilities: ["call_remote_tool"], risk: "medium" },
    },
  ];
  await saveChatSession(createChatSession({
    id: "session-audit",
    messages: [
      createChatMessage({
        id: "message-tool",
        role: "assistant",
        toolCallRecords: [
          {
            id: "call-1",
            toolId: "mcp.grok-search.search",
            name: "mcp_grok_search_search",
            displayName: "Grok 搜索.search",
            arguments: { query: "Moon Tab", authorization: "Bearer secret" },
            status: "success",
            startedAt: 100,
            completedAt: 180,
            resultSummary: "返回 3 条结果",
          },
        ],
      }),
    ],
  }));

  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "工具和 MCP" }));

  const dialog = await screen.findByRole("dialog", { name: "工具和 MCP" });
  expect(within(dialog).getByText("Grok 搜索.search")).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "添加 Grok 搜索预设" })).toBeVisible();
  expect(within(dialog).getByText("返回 3 条结果")).toBeVisible();
  expect(within(dialog).getByText(/参数/)).toHaveTextContent("[已脱敏]");
  expect(within(dialog).queryByText("Bearer secret")).toBeNull();
});

it("MCP 设置页可以一键添加 Grok 搜索预设", async () => {
  render(<App />);

  await userEvent.click(await screen.findByRole("button", { name: "设置" }));
  await userEvent.click(await screen.findByRole("tab", { name: "MCP 工具" }));
  await userEvent.click(screen.getByRole("button", { name: "添加 Grok 搜索预设" }));

  expect(useAppStore.getState().mcpSettings.servers).toEqual([
    expect.objectContaining({
      id: "grok-search-127-0-0-1-17333",
      name: "Grok 搜索",
      endpointUrl: "http://127.0.0.1:17333",
      enabled: true,
    }),
  ]);
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```powershell
npx vitest run tests/unit/side-panel/App.test.tsx --testNamePattern "工具和 MCP|Grok 搜索预设"
```

Expected: FAIL until the React tools dialog and Grok preset helper exist.

- [ ] **Step 3: Create Grok preset helper**

Create `src/shared/mcp/grokPreset.ts`:

```ts
import type { McpServerConfig, McpSettings } from "../types";

export const GROK_PRESET_SERVER_ID = "grok-search-127-0-0-1-17333";
export const GROK_PRESET_ENDPOINT_URL = "http://127.0.0.1:17333";
export const DEFAULT_GROK_API_BASE_URL = "https://api.x.ai/v1";
export const DEFAULT_GROK_MODEL = "grok-4.20-multi-agent-xhigh";

export function isGrokPresetServer(server: Pick<McpServerConfig, "id" | "endpointUrl">): boolean {
  return server.id === GROK_PRESET_SERVER_ID || normalizeEndpoint(server.endpointUrl) === GROK_PRESET_ENDPOINT_URL;
}

export function createGrokPresetServer(source: Partial<McpServerConfig> = {}): McpServerConfig {
  const now = Date.now();
  return {
    id: source.id ?? GROK_PRESET_SERVER_ID,
    name: source.name ?? "Grok 搜索",
    endpointUrl: normalizeEndpoint(source.endpointUrl) || GROK_PRESET_ENDPOINT_URL,
    enabled: source.enabled ?? true,
    tools: source.tools ?? [],
    lastRefreshError: source.lastRefreshError,
    createdAt: source.createdAt ?? now,
    updatedAt: now,
  };
}

export function upsertGrokPresetServer(settings: McpSettings, overrides: Partial<McpServerConfig> = {}): McpSettings {
  let found = false;
  const servers = settings.servers.map((server) => {
    if (!isGrokPresetServer(server)) return server;
    found = true;
    return createGrokPresetServer({ ...server, ...overrides, tools: server.tools });
  });
  if (!found) {
    servers.push(createGrokPresetServer(overrides));
  }
  return { servers };
}

function normalizeEndpoint(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    return new URL(value.trim()).toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}
```

- [ ] **Step 4: Create display-safe audit helper**

Create `src/side-panel/utils/toolAudit.ts`:

```ts
import type { ChatSession, ChatToolCallRecord } from "../../shared/types";

const SENSITIVE_KEY_PATTERN = /(?:token|secret|password|passwd|pwd|authorization|auth|apiKey|api_key|session|jwt|credential|cookie|set-cookie)/i;

export interface ToolAuditDisplayRow {
  id: string;
  displayName: string;
  status: ChatToolCallRecord["status"];
  durationMs: number;
  argumentsText: string;
  resultSummary: string;
}

export function collectToolAuditRows(sessions: ChatSession[], limit = 20): ToolAuditDisplayRow[] {
  return sessions
    .flatMap((session) =>
      session.messages.flatMap((message) =>
        (message.toolCallRecords ?? []).map((record) => ({
          id: `${session.id}:${message.id}:${record.id}`,
          displayName: record.displayName || record.name || record.toolId,
          status: record.status,
          durationMs: Math.max(0, (record.completedAt ?? record.startedAt) - record.startedAt),
          argumentsText: JSON.stringify(redactValue(record.arguments)),
          resultSummary: record.resultSummary || record.errorMessage || "",
        })),
      ),
    )
    .reverse()
    .slice(0, limit);
}

function redactValue(value: unknown, key = "", depth = 0): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) return "[已脱敏]";
  if (value === null || typeof value !== "object") return value;
  if (depth > 8) return Array.isArray(value) ? [] : {};
  if (Array.isArray(value)) return value.map((item, index) => redactValue(item, String(index), depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [childKey, redactValue(childValue, childKey, depth + 1)]));
}
```

- [ ] **Step 5: Implement `AgentToolsDialog`**

The dialog must render:

- status row: configured MCP server count and registered tool count;
- server list from `mcpSettings.servers`;
- registered tool list from `getRegisteredModelTools(mcpSettings)`;
- audit rows from `collectToolAuditRows(chatSessions)`;
- button `添加 Grok 搜索预设` that calls `updateMcpServer(undefined, createGrokPresetServer())`;
- button `刷新工具` for each enabled server that calls `refreshMcpServerTools(server.id)`;
- empty state text `暂无工具调用记录（暂无审计日志）` when no audit rows exist.

- [ ] **Step 6: Add Grok preset action to MCP settings**

In `McpToolSettings.tsx`, add an action button before the server list:

```tsx
<button
  className="ui-button-secondary"
  type="button"
  onClick={() => void updateMcpServer(undefined, createGrokPresetServer()).then(() => setMessage("已添加 Grok 搜索预设"))}
>
  添加 Grok 搜索预设
</button>
```

Also render a hint:

```tsx
<p className="ui-muted text-xs">本地 Bridge 默认地址：http://127.0.0.1:17333。可用 npm run mcp:grok-search:start-bg 启动。</p>
```

- [ ] **Step 7: Verify targeted tests pass**

Run:

```powershell
npx vitest run tests/unit/side-panel/App.test.tsx --testNamePattern "工具和 MCP|Grok 搜索预设"
```

Expected: PASS.

---

### Task 8: Composer, Long Messages, Empty UI, And Notifications

**Files:**

- Modify: `src/side-panel/components/PromptInlineEditor.tsx`
- Modify: `src/side-panel/components/MessageList.tsx`
- Modify: `src/side-panel/components/NotificationHost.tsx`
- Modify: `src/side-panel/components/ChatComposer.tsx`
- Modify: `src/side-panel/styles.css`
- Modify: `tests/unit/side-panel/App.test.tsx`
- Modify: `tests/unit/side-panel/MessageList.test.tsx`
- Modify: `tests/unit/side-panel/useComposedTextInput.test.tsx`

- [ ] **Step 1: Write failing UI behavior tests**

Add tests:

```ts
it("用户长消息默认折叠并可展开", async () => {
  const longContent = Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 行内容`).join("\n");
  await saveChatSession(createChatSession({
    id: "session-long-user",
    messages: [createChatMessage({ id: "message-long-user", role: "user", content: longContent })],
  }));

  render(<App />);

  expect(await screen.findByRole("button", { name: "展开完整消息" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "展开完整消息" }));
  expect(screen.getByRole("button", { name: "收起消息" })).toBeVisible();
});

it("输入区 Ctrl+Z 和 Ctrl+Y 由 React 受控撤销栈处理", async () => {
  render(<App />);
  const input = await screen.findByRole("textbox", { name: "输入聊天内容" });

  await userEvent.click(input);
  await userEvent.keyboard("第一段");
  await userEvent.keyboard("第二段");
  fireEvent.keyDown(input, { key: "z", ctrlKey: true });
  expect(input).toHaveTextContent("");
  fireEvent.keyDown(input, { key: "y", ctrlKey: true });
  expect(input).toHaveTextContent("第一段第二段");
});
```

- [ ] **Step 2: Run the failing behavior tests**

Run:

```powershell
npx vitest run tests/unit/side-panel/App.test.tsx tests/unit/side-panel/MessageList.test.tsx --testNamePattern "用户长消息|Ctrl\\+Z"
```

Expected: FAIL until long-message disclosure and undo/redo are React-owned.

- [ ] **Step 3: Add prompt undo/redo to `PromptInlineEditor`**

Implement an internal history ref with:

```ts
const undoStackRef = useRef<string[]>([]);
const redoStackRef = useRef<string[]>([]);
const baselineRef = useRef(value);
```

On normal input, push the previous baseline and clear redo. On `Ctrl/Cmd+Z`, restore the last undo value and dispatch `onChange(restored)`. On `Ctrl/Cmd+Y` or `Ctrl/Cmd+Shift+Z`, restore redo. Keep IME composition untouched by ignoring undo/redo while `event.nativeEvent.isComposing` is true.

- [ ] **Step 4: Add long user-message disclosure to `MessageList`**

Use thresholds:

```ts
const LONG_USER_MESSAGE_CHAR_THRESHOLD = 420;
const LONG_USER_MESSAGE_LINE_THRESHOLD = 8;
```

For user messages over either threshold:

- add class `message-bubble-long-collapsed` by default;
- render button `展开完整消息`;
- after expand, render button `收起消息`;
- do not collapse assistant messages.

- [ ] **Step 5: Keep notifications React-owned**

Ensure `NotificationHost.tsx` remains the only notification UI used by React-side code. Replace any new toast behavior with `addNotification({ type, title, message })`.

- [ ] **Step 6: Verify targeted tests pass**

Run:

```powershell
npx vitest run tests/unit/side-panel/App.test.tsx tests/unit/side-panel/MessageList.test.tsx --testNamePattern "用户长消息|Ctrl\\+Z"
```

Expected: PASS.

---

### Task 9: Remove Runtime Dependence On Old DOM Patch

**Files:**

- Modify: `tests/unit/background/extensionBuildContract.test.ts`
- Modify: `scripts/verify_ai_sidebar_quality.ps1`
- Modify: `README.md`
- Modify: `docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md`

- [ ] **Step 1: Write a source scan contract**

Add this test to `tests/unit/background/extensionBuildContract.test.ts`:

```ts
it("Phase 3 runtime source must not import old sidePanel DOM patch files", async () => {
  const runtimeSources = [
    "index.html",
    "src/side-panel/main.tsx",
    "src/side-panel/App.tsx",
    "src/background/index.ts",
    "src/content/index.ts",
    "public/manifest.json",
  ];

  for (const filePath of runtimeSources) {
    const source = await readProjectFile(filePath);
    expect(source, filePath).not.toContain("sidePanel-layout.js");
    expect(source, filePath).not.toContain("sidePanel-layout.css");
    expect(source, filePath).not.toContain("agent-tools-dialog.js");
    expect(source, filePath).not.toContain("open-design-preview.html");
    expect(source, filePath).not.toContain("src/ai-assistant/sidePanel.js");
  }
});
```

- [ ] **Step 2: Update legacy quality script boundary**

Modify `scripts/verify_ai_sidebar_quality.ps1` so it no longer presents `sidePanel-layout.js` syntax as the current AI sidebar source check. The script should run:

```powershell
npm run typecheck
npx vitest run tests/unit/side-panel/App.test.tsx tests/unit/side-panel/ChatComposer.test.ts tests/unit/side-panel/MessageList.test.tsx
npm run build:extension
```

If the script still checks `src/ai-assistant/sidePanel-layout.js`, label that check as `legacy reference syntax` and do not include it in the React source verification count.

- [ ] **Step 3: Update docs**

In `README.md` and `docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md`, state:

- AI sidebar source of truth is `src/side-panel/**`.
- `src/ai-assistant/sidePanel.js`, `src/ai-assistant/assets/**`, `src/ai-assistant/sidePanel-layout.js`, and `src/ai-assistant/open-design-preview.html` are migration references only.
- New UI behavior must be implemented through React components/store, not DOM query patching.
- Phase 6 will remove obsolete old bundle files after background/tool compatibility migration is complete.

- [ ] **Step 4: Verify the source scan passes**

Run:

```powershell
npx vitest run tests/unit/background/extensionBuildContract.test.ts
```

Expected: PASS.

---

### Task 10: E2E Smoke For React Side Panel UX

**Files:**

- Modify: `tests/e2e/extension-runtime.spec.ts`
- Modify: `tests/e2e/extension-smoke.spec.ts`

- [ ] **Step 1: Add React side-panel smoke tests**

Add to `tests/e2e/extension-runtime.spec.ts`:

```ts
test("React AI 侧栏提供 Phase 3 顶部入口且不加载旧 DOM patch", async ({ extensionContext, extensionId }) => {
  const page = await extensionContext.newPage();
  const loadedScripts: string[] = [];
  page.on("request", (request) => loadedScripts.push(request.url()));

  await page.goto(`chrome-extension://${extensionId}/index.html`);

  await expect(page.getByRole("button", { name: "新建对话" })).toBeVisible();
  await expect(page.getByRole("button", { name: "打开悬浮窗" })).toBeVisible();
  await expect(page.getByRole("button", { name: "工具和 MCP" })).toBeVisible();
  await expect(page.getByRole("button", { name: "你能做些什么？" })).toBeVisible();
  expect(loadedScripts.some((url) => url.includes("sidePanel-layout.js") || url.includes("sidePanel.js"))).toBe(false);
});
```

Add to `tests/e2e/extension-smoke.spec.ts`:

```ts
test("构建后的 React AI 侧栏可以打开历史、设置和工具对话框", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "历史记录" }).click();
  await expect(page.getByRole("dialog", { name: "历史记录" })).toBeVisible();
  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
  await page.getByRole("button", { name: "关闭设置" }).click();
  await page.getByRole("button", { name: "工具和 MCP" }).click();
  await expect(page.getByRole("dialog", { name: "工具和 MCP" })).toBeVisible();
});
```

- [ ] **Step 2: Run E2E tests**

Run:

```powershell
npm run build:extension
npx playwright test --project=web-preview tests/e2e/extension-smoke.spec.ts
npx playwright test --project=chrome-extension tests/e2e/extension-runtime.spec.ts
```

Expected: PASS.

---

### Task 11: Full Phase 3 Verification

**Files:**

- Test only

- [ ] **Step 1: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run extension build**

Run:

```powershell
npm run build:extension
```

Expected: PASS and `dist/index.html` references React-built assets, not `src/ai-assistant/sidePanel.js` or `sidePanel-layout.js`.

- [ ] **Step 3: Run Vitest**

Run:

```powershell
npm run test
```

Expected: PASS.

- [ ] **Step 4: Run legacy Node tests**

Run:

```powershell
npm run test:legacy
```

Expected: PASS. Any old `src/ai-assistant/**` checks that remain are legacy compatibility checks, not React side-panel source checks.

- [ ] **Step 5: Run package check**

Run:

```powershell
npm run check:package
```

Expected: PASS and `artifacts/chrome-extension/manifest.json` contains `index.html` and `assets/*` in `web_accessible_resources`, with no `src/ai-assistant/sidePanel.js` or `sidePanel-layout.js`.

- [ ] **Step 6: Run Playwright E2E**

Run:

```powershell
npm run test:e2e
```

Expected: PASS.

- [ ] **Step 7: Run aggregate check**

Run:

```powershell
npm run check
```

Expected: PASS.

---

### Task 12: Update Migration Status And Commit

**Files:**

- Modify: `docs/superpowers/MIGRATION_STATUS.md`
- Commit all Phase 3 changes except `.claude/`

- [ ] **Step 1: Update migration status before commit**

In `docs/superpowers/MIGRATION_STATUS.md`, set:

```markdown
## 当前阶段

Phase 3：恢复 AI 侧栏 React 源码维护方式，并把 `sidePanel-layout.js` 的必要行为迁入 React 组件和 store。
```

Set current plan:

```markdown
- 当前计划：`docs/superpowers/plans/2026-07-06-full-upstream-engineering-migration-phase-3.md`
```

Add current verification rows after successful Phase 3 verification:

```markdown
| `npm run typecheck` | 通过 | Phase 3 React 侧栏源码迁移后执行 |
| `npm run build:extension` | 通过 | 生成 React 侧栏、新标签页、游戏页、background 和 content script |
| `npm test` | 通过 | Vitest 覆盖侧栏组件、store、background、content 和构建合约 |
| `npm run test:legacy` | 通过 | 保留迁移参考和小游戏旧测试 |
| `npm run check:package` | 通过 | 校验打包产物不依赖旧侧栏 bundle / DOM patch |
| `npm run test:e2e` | 通过 | Vite preview 和真实 Chrome 扩展 smoke |
| `npm run check` | 通过 | Phase 3 全量聚合验证 |
```

If a command fails and the user approves continuing, record `未通过` and the concise failure reason in the 备注 column instead of `通过`.

- [ ] **Step 2: Update unresolved issues**

Remove:

```markdown
- 尚未把 `sidePanel-layout.js` 行为迁入 React 源码。
```

Keep or update:

```markdown
- 旧 `src/ai-assistant/**` 文件在 Phase 3 后只作为迁移参考保留；物理删除等待 Phase 6 清理。
- 尚未合并完整 tab scoped side panel、Imagefree、Grok/MCP 和 DevTools Network bridge 到 TypeScript background；Phase 3 只落地 React 侧栏需要的 typed runtime message。
```

Set next phase:

```markdown
Phase 3 完成后，编写 Phase 4 计划：合并 TypeScript background 逻辑，保留 tab scoped side panel、悬浮助手、Grok/MCP、Imagefree 和 DevTools Network bridge 兼容层。
```

- [ ] **Step 3: Review status**

Run:

```powershell
git status --short
```

Expected: only Phase 3 files are modified, and `.claude/` remains unstaged.

- [ ] **Step 4: Stage Phase 3 files**

Run:

```powershell
git add -- src/shared/sidePanelRuntime.ts src/shared/mcp/grokPreset.ts src/side-panel src/background/index.ts src/content/index.ts public/manifest.json tests/unit/background/extensionBuildContract.test.ts tests/unit/background/index.test.ts tests/unit/content/index.test.ts tests/unit/side-panel/appStore.test.ts tests/unit/side-panel/App.test.tsx tests/unit/side-panel/MessageList.test.tsx tests/e2e/extension-runtime.spec.ts tests/e2e/extension-smoke.spec.ts scripts/verify_ai_sidebar_quality.ps1 README.md docs/AI_SIDEBAR_AGENT_ARCHITECTURE.md docs/superpowers/MIGRATION_STATUS.md
git status --short
```

Expected: `.claude/` remains unstaged.

- [ ] **Step 5: Commit with Chinese message**

Run:

```powershell
git commit -m "feat: 恢复 AI 侧栏 React 源码维护方式"
```

Expected: commit succeeds.

- [ ] **Step 6: Record the final commit SHA**

Run:

```powershell
$Sha = git rev-parse --short HEAD
$Sha
```

Add a `Phase 3` row under “已完成提交”. The `Commit` cell must be the exact backticked short SHA printed by `$Sha`, and the `内容` cell must be `恢复 AI 侧栏 React 源码维护方式`.

Then run:

```powershell
git add -- docs/superpowers/MIGRATION_STATUS.md
git commit -m "docs: 更新 Phase 3 迁移状态"
```

Expected: migration status records the actual Phase 3 implementation commit.

---

## Self-Review

Spec coverage:

- React side-panel source ownership: Tasks 2 and 9.
- Tab-level conversation continuity: Task 4.
- Floating window entry: Tasks 3 and 5.
- History drawer and settings entry: Task 6.
- Tools/MCP/Grok preset and audit display: Task 7.
- Input area, long messages, empty state, and notifications: Tasks 5 and 8.
- No long-term dependency on old bundle or DOM patch: Tasks 2, 9, 10, and 11.
- Migration ledger recovery: Task 12.

No unresolved markers remain in this plan. Physical deletion of old `src/ai-assistant/**` side-panel artifacts is intentionally left to Phase 6, while Phase 3 ensures the current runtime behavior is React/source-owned.
