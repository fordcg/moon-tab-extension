# AI Sidebar Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a chat-style browser agent sidebar with custom AI endpoint configuration, protocol-aware runtime adapters, clear availability states, tool execution, and elegant execution-trajectory visualization.

**Architecture:** Keep settings UI as the only configuration entrypoint, move protocol/runtime logic into shared modules, and let the sidebar render one of three top-level states: locked, degraded, or active chat. The active chat flow routes prompts through an intent layer that can answer, call tools, or do both, while surfacing a lightweight execution trail in the message stream.

**Tech Stack:** Manifest V3 extension, plain HTML/CSS/native ESM, Chrome extension APIs (`tabs`, `storage`, `permissions`, `sidePanel`), Playwright smoke verifier (`python .tmp/verify_newtab_extension.py`), shared runtime adapters for `responses` and `chat/completions`.

---

## File Structure

### Existing files to modify
- `src/shared/search-settings.mjs` — keep storage/permission helpers and add normalized config-state helpers.
- `src/shared/sidebar-contract.mjs` — add sidebar runtime states, richer result shapes, and trace event constants.
- `src/pages/newtab/settings/index.mjs` — split save/test UX and render structured AI config state.
- `src/pages/newtab/index.mjs` — keep homepage wired to the shared config/runtime state and settings entrypoint.
- `src/pages/sidebar/index.html` — replace panel-style shell with chat-first locked/error/active layout.
- `src/pages/sidebar/index.css` — redesign the sidebar into a lightweight chat UI with compact execution pills.
- `src/pages/sidebar/index.mjs` — bootstrap top-level sidebar state from config + page context.
- `src/pages/sidebar/sidebar-context-controller.mjs` — extend context sync into sidebar page/AI availability sync.
- `src/pages/sidebar/sidebar-dom-controller.mjs` — render locked/error/active states, chat messages, status badges, and trace rows.
- `src/pages/sidebar/sidebar-ai-controller.mjs` — delegate remote execution to protocol-aware adapters and return structured results.
- `src/pages/sidebar/sidebar-chat-controller.mjs` — support answer/tool/mixed flows and staged execution visualization.
- `src/pages/sidebar/sidebar-action-controller.mjs` — normalize browser/page tool execution results.
- `src/background/sidebar-bridge.js` — extend browser tool coverage for reversible navigation actions.
- `src/content/page-context.js` — support any additional page-local actions required by the first-release tool set.
- `.tmp/verify_newtab_extension.py` — extend smoke coverage for config state, protocol support, sidebar lock/error/active states, and execution trace.

### New files to create
- `src/shared/ai-runtime-adapter.mjs` — protocol detection, test request building, runtime request building, response normalization, and structured errors.
- `src/shared/ai-config-state.mjs` — derive `unconfigured` / `configured` / `valid` / `invalid` / `degraded` from saved settings and latest health metadata.
- `src/pages/sidebar/sidebar-state-controller.mjs` — decide which top-level sidebar state to render.
- `src/pages/sidebar/sidebar-execution-controller.mjs` — manage lightweight execution events shown in the chat stream.
- `src/pages/sidebar/sidebar-intent-controller.mjs` — classify prompts into answer / tool / mixed flows.

---

### Task 1: Build protocol-aware AI runtime and config state foundation

**Files:**
- Create: `src/shared/ai-runtime-adapter.mjs`
- Create: `src/shared/ai-config-state.mjs`
- Modify: `src/shared/search-settings.mjs`
- Modify: `src/shared/sidebar-contract.mjs`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Write the failing verifier assertions for protocol support and config states**

Extend `.tmp/verify_newtab_extension.py` with new result fields and checks for:
- unsupported endpoint protocol → explicit failure state/message
- saved-but-untested config → `configured`
- successful `responses` test → `valid`
- successful `chat/completions` test → `valid`

Add fields to `result`:

```python
"ai_config_state": "",
"ai_protocol_type": "",
"ai_test_status": "",
"ai_test_message": "",
"unsupported_protocol_detected": False,
"responses_protocol_detected": False,
"chat_completions_protocol_detected": False,
```

Add required checks near `assert_required_checks`:

```python
("unsupported_protocol_detected", result["unsupported_protocol_detected"]),
("responses_protocol_detected", result["responses_protocol_detected"]),
("chat_completions_protocol_detected", result["chat_completions_protocol_detected"]),
```

- [ ] **Step 2: Run verifier to confirm the new checks fail first**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- FAIL because the new config/protocol fields are not yet produced by the extension.

- [ ] **Step 3: Implement protocol detection and normalized runtime adapter**

Create `src/shared/ai-runtime-adapter.mjs` with a focused API:

```js
export const AI_PROTOCOL_TYPES = {
  RESPONSES: "responses",
  CHAT_COMPLETIONS: "chat_completions",
  UNSUPPORTED: "unsupported",
};

export const detectAiProtocolType = (endpoint) => {
  if (typeof endpoint !== "string" || !endpoint.trim()) {
    return "unsupported";
  }

  try {
    const parsed = new URL(endpoint.trim());
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    if (/\/v1\/responses$/i.test(pathname)) {
      return AI_PROTOCOL_TYPES.RESPONSES;
    }
    if (pathname === "/" || pathname === "/v1" || /\/v1\/chat\/completions$/i.test(pathname)) {
      return AI_PROTOCOL_TYPES.CHAT_COMPLETIONS;
    }
    return AI_PROTOCOL_TYPES.UNSUPPORTED;
  } catch {
    return AI_PROTOCOL_TYPES.UNSUPPORTED;
  }
};

export const createAiRuntimeError = (code, message) => ({ ok: false, code, message });
```

Also add protocol-specific helpers:
- `buildAiTestRequest(settings)`
- `buildAiConversationRequest(settings, prompt, context)`
- `parseAiRuntimeResponse(protocolType, rawText)`
- `normalizeAiRuntimeError(status, rawText)`

- [ ] **Step 4: Extend shared settings storage to persist config health**

In `src/shared/search-settings.mjs`, add metadata keys and helpers:

```js
export const SEARCH_RUNTIME_KEYS = {
  protocol: "searchRuntimeProtocol",
  configState: "searchRuntimeConfigState",
  lastTestStatus: "searchRuntimeLastTestStatus",
  lastTestMessage: "searchRuntimeLastTestMessage",
  lastTestAt: "searchRuntimeLastTestAt",
  lastRuntimeErrorMessage: "searchRuntimeLastRuntimeErrorMessage",
  lastRuntimeErrorAt: "searchRuntimeLastRuntimeErrorAt",
};
```

Also export helpers:
- `getStoredAiConfigState(extensionApiOverride)`
- `saveStoredAiConfigState(nextState, extensionApiOverride)`
- `deriveAiConfigState(settings, runtimeState)`

- [ ] **Step 5: Extend sidebar shared contract for state and trace enums**

Add to `src/shared/sidebar-contract.mjs`:

```js
export const SIDEBAR_RUNTIME_STATES = {
  LOCKED: "locked",
  ERROR: "error",
  ACTIVE: "active",
};

export const SIDEBAR_TRACE_EVENT_TYPES = {
  THINKING: "thinking",
  READING_PAGE: "reading_page",
  SELECTING_TOOL: "selecting_tool",
  EXECUTING_TOOL: "executing_tool",
  COMPLETED: "completed",
  FAILED: "failed",
};
```

- [ ] **Step 6: Run verifier to confirm the new config/protocol checks pass**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- PASS on baseline flows
- PASS on newly added protocol/config-state checks

- [ ] **Step 7: Commit the shared runtime foundation**

```bash
git add .tmp/verify_newtab_extension.py src/shared/ai-runtime-adapter.mjs src/shared/ai-config-state.mjs src/shared/search-settings.mjs src/shared/sidebar-contract.mjs
git commit -m "feat: add protocol-aware AI runtime foundation"
```

---

### Task 2: Rebuild settings into a save-and-test configuration workflow

**Files:**
- Modify: `src/pages/newtab/settings/index.mjs`
- Modify: `src/pages/newtab/index.html`
- Modify: `src/pages/newtab/index.mjs`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Write the failing verifier assertions for settings state card and separate test action**

In `.tmp/verify_newtab_extension.py`, add checks that:
- settings exposes a dedicated AI config state card
- save does not mark config as valid
- test connection updates the state card

Add selectors to wait for:

```python
page.wait_for_selector("#ai-config-state-card", timeout=10000)
page.wait_for_selector("#test-search-api-connection", timeout=10000)
```

Add result fields:

```python
"ai_state_card_present": False,
"ai_test_button_present": False,
"save_without_test_keeps_configured_state": False,
```

- [ ] **Step 2: Run verifier to confirm the new settings UX checks fail**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- FAIL because the state card and separate test action do not exist yet.

- [ ] **Step 3: Add settings UI markup for state card and test button**

In `src/pages/newtab/index.html`, extend the AI config section with:

```html
<div id="ai-config-state-card" class="settings-ai-state-card" data-state="unconfigured">
  <p id="ai-config-state-label" class="settings-ai-state-label">未配置</p>
  <p id="ai-config-state-message" class="settings-ai-state-message">先填写 URL、API Key 和模型。</p>
</div>
<button id="test-search-api-connection" type="button">测试连接</button>
```

- [ ] **Step 4: Refactor settings controller to separate save from test**

In `src/pages/newtab/settings/index.mjs`:
- save action only persists fields and marks `configured` when complete
- test action:
  - validates completeness
  - ensures permission
  - calls `ai-runtime-adapter.mjs`
  - saves `valid` / `invalid`
  - updates state card and message

Use a single renderer:

```js
const renderAiConfigStateCard = ({ state, label, message }) => {
  aiConfigStateCard.dataset.state = state;
  aiConfigStateLabel.textContent = label;
  aiConfigStateMessage.textContent = message;
};
```

- [ ] **Step 5: Keep homepage behavior compatible with normalized config state**

In `src/pages/newtab/index.mjs`, keep opening settings/sidebar as before, but read the normalized config state from shared helpers instead of inferring readiness from raw fields.

- [ ] **Step 6: Run verifier to confirm settings UX passes**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- PASS on state card presence
- PASS on separate test action
- PASS on save-without-test leaving state as `configured`

- [ ] **Step 7: Commit the settings workflow changes**

```bash
git add src/pages/newtab/index.html src/pages/newtab/index.mjs src/pages/newtab/settings/index.mjs .tmp/verify_newtab_extension.py
git commit -m "feat: add AI config save and test workflow"
```

---

### Task 3: Redesign the sidebar into locked / error / active chat states

**Files:**
- Modify: `src/pages/sidebar/index.html`
- Modify: `src/pages/sidebar/index.css`
- Modify: `src/pages/sidebar/index.mjs`
- Modify: `src/pages/sidebar/sidebar-dom-controller.mjs`
- Create: `src/pages/sidebar/sidebar-state-controller.mjs`
- Modify: `src/pages/sidebar/sidebar-context-controller.mjs`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Write the failing verifier assertions for locked/error/active sidebar shells**

Add sidebar result fields in `.tmp/verify_newtab_extension.py`:

```python
"sidebar_locked_state_visible": False,
"sidebar_error_state_visible": False,
"sidebar_active_chat_visible": False,
```

Add expected selectors:

```python
# locked
"#sidebar-locked-state"
# error
"#sidebar-error-state"
# active
"#sidebar-chat-shell"
```

- [ ] **Step 2: Run verifier to confirm the new sidebar state-shell checks fail**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- FAIL because the new state shells are not yet in the DOM.

- [ ] **Step 3: Replace sidebar markup with chat-first state layout**

In `src/pages/sidebar/index.html`, organize the shell like this:

```html
<main class="sidebar-shell">
  <header class="sidebar-topbar">...</header>
  <section id="sidebar-locked-state" hidden>...</section>
  <section id="sidebar-error-state" hidden>...</section>
  <section id="sidebar-chat-shell" hidden>
    <section id="sidebar-messages" ...></section>
    <form id="sidebar-form">...</form>
  </section>
</main>
```

- [ ] **Step 4: Add a lightweight chat-first visual system**

In `src/pages/sidebar/index.css`, implement:
- a compact top bar
- lighter status badges
- reduced top-card weight
- a dominant message column
- a softer composer
- locked/error state hero cards that are elegant but not dashboard-like

- [ ] **Step 5: Add a sidebar state controller and DOM renderers**

Create `src/pages/sidebar/sidebar-state-controller.mjs`:

```js
export const createSidebarStateController = ({ domController, configStateReader, contextController }) => ({
  syncState: async () => {
    const configState = await configStateReader();
    const pageState = await contextController.syncContextAvailability();
    return domController.renderShellState({ configState, pageState });
  },
});
```

Update `sidebar-dom-controller.mjs` to render:
- shell state
- top badges
- chat visibility
- locked/error CTA buttons

- [ ] **Step 6: Run verifier to confirm the sidebar shell states render correctly**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- PASS on locked state when unconfigured/configured
- PASS on error state when invalid/degraded
- PASS on active chat shell when valid + page connected

- [ ] **Step 7: Commit the chat-first shell redesign**

```bash
git add src/pages/sidebar/index.html src/pages/sidebar/index.css src/pages/sidebar/index.mjs src/pages/sidebar/sidebar-dom-controller.mjs src/pages/sidebar/sidebar-state-controller.mjs src/pages/sidebar/sidebar-context-controller.mjs .tmp/verify_newtab_extension.py
git commit -m "feat: redesign sidebar as stateful chat shell"
```

---

### Task 4: Add agent intent routing, browser/page tools, and execution trace visualization

**Files:**
- Create: `src/pages/sidebar/sidebar-intent-controller.mjs`
- Create: `src/pages/sidebar/sidebar-execution-controller.mjs`
- Modify: `src/pages/sidebar/sidebar-ai-controller.mjs`
- Modify: `src/pages/sidebar/sidebar-chat-controller.mjs`
- Modify: `src/pages/sidebar/sidebar-action-controller.mjs`
- Modify: `src/background/sidebar-bridge.js`
- Modify: `src/content/page-context.js`
- Modify: `src/shared/sidebar-contract.mjs`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Write the failing verifier assertions for execution trace and tool flows**

Add result fields in `.tmp/verify_newtab_extension.py`:

```python
"sidebar_trace_visible": False,
"sidebar_tool_result_visible": False,
"sidebar_mixed_flow_visible": False,
```

Add waits such as:

```python
sidebar_page.locator("[data-sidebar-trace-event='executing_tool']").first.wait_for(...)
sidebar_page.locator("[data-sidebar-message-kind='tool_result']").first.wait_for(...)
sidebar_page.locator("[data-sidebar-message-kind='assistant']", has_text="已为你").first.wait_for(...)
```

- [ ] **Step 2: Run verifier to confirm trace/tool checks fail first**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- FAIL because trace rows and richer tool results do not exist yet.

- [ ] **Step 3: Add intent classification and execution trace controllers**

Create `src/pages/sidebar/sidebar-intent-controller.mjs`:

```js
export const createSidebarIntentController = () => ({
  classifyPrompt(prompt) {
    if (/打开|切到|刷新|返回|滚动|复制/.test(prompt)) return "tool";
    if (/然后|再帮我/.test(prompt)) return "mixed";
    return "answer";
  },
});
```

Create `src/pages/sidebar/sidebar-execution-controller.mjs` with helpers to emit compact trace objects:

```js
export const createSidebarExecutionController = ({ domController }) => ({
  start(step, label) { domController.appendTrace({ type: step, label, status: "running" }); },
  finish(step, label) { domController.appendTrace({ type: step, label, status: "done" }); },
  fail(step, label) { domController.appendTrace({ type: step, label, status: "failed" }); },
});
```

- [ ] **Step 4: Upgrade AI/chat/action controllers to support answer/tool/mixed flows**

In `sidebar-ai-controller.mjs`, normalize remote agent output to one of:

```js
{ kind: "answer", text: "..." }
{ kind: "tool", text: "...", action: { type: "open_link", url: "..." } }
{ kind: "mixed", text: "...", action: { type: "switch_tab", direction: "next" } }
```

In `sidebar-chat-controller.mjs`, render stages:
- analyzing
- reading page
- executing tool
- completed / failed
- final assistant answer

- [ ] **Step 5: Extend browser/page tool execution in the bridge layer**

In `src/background/sidebar-bridge.js`, add support for:
- `new_tab`
- `refresh_page`
- `go_back`
- `run_search`

In `src/content/page-context.js`, ensure page-local actions remain focused on page DOM only.

- [ ] **Step 6: Run verifier to confirm tool and trace flows pass**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- PASS on tool execution feedback
- PASS on trace visibility
- PASS on at least one mixed flow

- [ ] **Step 7: Commit the agent flow and execution trace work**

```bash
git add src/pages/sidebar/sidebar-intent-controller.mjs src/pages/sidebar/sidebar-execution-controller.mjs src/pages/sidebar/sidebar-ai-controller.mjs src/pages/sidebar/sidebar-chat-controller.mjs src/pages/sidebar/sidebar-action-controller.mjs src/background/sidebar-bridge.js src/content/page-context.js src/shared/sidebar-contract.mjs .tmp/verify_newtab_extension.py
git commit -m "feat: add sidebar agent tools and execution traces"
```

---

### Task 5: Persist degraded runtime state and polish end-to-end behavior

**Files:**
- Modify: `src/shared/search-settings.mjs`
- Modify: `src/pages/sidebar/sidebar-ai-controller.mjs`
- Modify: `src/pages/newtab/settings/index.mjs`
- Modify: `src/pages/sidebar/index.mjs`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Write the failing verifier assertions for degraded runtime state**

Add result fields in `.tmp/verify_newtab_extension.py`:

```python
"sidebar_degraded_state_visible": False,
"settings_degraded_state_visible": False,
```

Create a flow where:
- config is first marked valid
- a later runtime call is stubbed to fail
- sidebar and settings both reflect degraded state

- [ ] **Step 2: Run verifier to confirm degraded-state checks fail first**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- FAIL because degraded state is not yet persisted/rendered consistently.

- [ ] **Step 3: Persist runtime failures back into shared config state**

In `src/shared/search-settings.mjs`, add a helper like:

```js
export const markAiRuntimeDegraded = async (message, extensionApiOverride) => {
  await saveStoredAiConfigState({
    configState: "degraded",
    lastRuntimeErrorMessage: message,
    lastRuntimeErrorAt: Date.now(),
  }, extensionApiOverride);
};
```

Call it from `sidebar-ai-controller.mjs` when a remote call fails after a valid state.

- [ ] **Step 4: Render degraded state in both sidebar and settings**

Update:
- `src/pages/sidebar/index.mjs`
- `src/pages/newtab/settings/index.mjs`

so degraded state:
- shows an AI warning badge in the sidebar
- shows a “运行中降级” card/message in settings
- offers a clear re-test path

- [ ] **Step 5: Run full verifier and manual end-to-end checks**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Then manually verify:
- unconfigured → locked
- configured → locked
- valid (responses) → active
- valid (chat/completions) → active
- invalid → error
- degraded → warning/error with re-test path
- answer, tool, and mixed flows work
- execution trace remains lightweight and readable

- [ ] **Step 6: Commit the degraded-state polish**

```bash
git add src/shared/search-settings.mjs src/pages/sidebar/sidebar-ai-controller.mjs src/pages/newtab/settings/index.mjs src/pages/sidebar/index.mjs .tmp/verify_newtab_extension.py
git commit -m "feat: persist degraded AI runtime state"
```

---

## Self-Review Checklist

### Spec coverage
- Config entrypoint remains only in settings: covered by Task 2.
- `responses` + `chat/completions` auto-detection: covered by Task 1.
- Sidebar locked / invalid / degraded / active states: covered by Tasks 3 and 5.
- Chat-first UI: covered by Task 3.
- Page understanding + tools + browser actions: covered by Task 4.
- Execution visualization: covered by Task 4.

### Placeholder scan
- No `TBD`, `TODO`, or “implement later” placeholders remain.
- Every task names exact files.
- Every task has concrete verification commands.

### Type consistency
- Shared protocol names: `responses`, `chat_completions`, `unsupported`.
- Shared sidebar states: `locked`, `error`, `active`.
- Shared config states: `unconfigured`, `configured`, `valid`, `invalid`, `degraded`.

## Verification Commands

Primary automated verification:

```bash
python .tmp/verify_newtab_extension.py
```

Manual extension verification after each phase:

```text
1. Reload unpacked extension from repo root.
2. Open a new tab and confirm homepage still renders.
3. Open settings and verify AI config state card matches the saved state.
4. Open sidebar and verify it shows locked / error / active appropriately.
5. Ask for a summary, run a tool action, and verify execution trace appears.
```

## Commit Boundaries
- Task 1: shared runtime foundation
- Task 2: settings save/test workflow
- Task 3: chat-first sidebar shell
- Task 4: agent tools + execution traces
- Task 5: degraded-state polish

Plan complete and saved to `docs/superpowers/plans/2026-03-28-ai-sidebar-agent-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
