# Midnight Console Synthwave Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `newtab` homepage and AI `sidebar` into a shared Midnight Console Synthwave system without changing the existing search and sidebar business logic.

**Architecture:** Keep the current plain HTML + ESM controller architecture intact, but replace the visual shell, DOM hierarchy, and style tokens that currently encode the warm paper theme. Verification stays browser-level: extend the existing homepage Playwright smoke test for the newtab visual contract, and add a focused sidebar verification script that drives the existing sidebar test hooks and validates shell states plus control styling.

**Tech Stack:** Manifest V3 extension, plain HTML, CSS, native ESM modules, existing controller modules in `src/pages/newtab` and `src/pages/sidebar`, Python Playwright smoke tests in `.tmp/`.

---

## File Structure

### Existing files to modify

- `src/pages/newtab/index.html`
  - Homepage DOM structure for the search shell, top controls, settings modal host, preview panel, and background layer.
- `src/pages/newtab/styles/index.css`
  - Global homepage tokens, background system, search shell, settings modal, dropdowns, and AI preview styling.
- `src/pages/newtab/index.mjs`
  - Homepage wiring for current elements and state classes.
- `src/pages/sidebar/index.html`
  - Sidebar DOM structure for shell states, top bar, message flow, trace region, and composer.
- `src/pages/sidebar/index.css`
  - Sidebar tokens, top bar, state panels, message styling, trace styling, and composer styling.
- `src/pages/sidebar/sidebar-dom-controller.mjs`
  - Runtime DOM rendering for message rows, trace rows, shell state rendering, and composer state.
- `src/pages/sidebar/sidebar-state-controller.mjs`
  - State copy and state mapping for locked / error / degraded / active shell modes.
- `.tmp/verify_newtab_extension.py`
  - Existing browser-level smoke test for homepage rendering and search behavior.

### New files to create

- `.tmp/verify_sidebar_ui.py`
  - Focused Playwright verification for the sidebar shell states and Midnight Console visual contract.

### Notes for the implementer

- There is no bundler or JS unit test runner in this repo. The primary verification path is Python Playwright.
- Avoid changing AI/search business logic unless the new DOM shape forces a selector update.
- Preserve existing `body` state class conventions on `newtab`, and preserve `window.__SIDEBAR_TEST_HOOKS__` on the sidebar.

---

### Task 1: Add failing visual contract checks for the `newtab` redesign

**Files:**
- Modify: `.tmp/verify_newtab_extension.py`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Write the failing homepage visual assertions first**

Add helper assertions that encode the Midnight Console contract instead of the warm paper theme.

```python
def read_midnight_console_homepage_state(page: Page) -> dict:
    return page.evaluate(
        """() => {
            const bodyStyle = getComputedStyle(document.body);
            const frame = document.querySelector('.outline-search-frame');
            const indicator = document.querySelector('#ai-search-indicator');
            const preview = document.querySelector('#ai-search-preview');
            const popup = document.querySelector('#settings-popup');

            return {
                bodyBackgroundImage: bodyStyle.backgroundImage,
                bodyBackgroundColor: bodyStyle.backgroundColor,
                searchFrameBackground: frame ? getComputedStyle(frame).backgroundColor : 'missing',
                searchFrameBorderColor: frame ? getComputedStyle(frame).borderTopColor : 'missing',
                indicatorColor: indicator ? getComputedStyle(indicator).color : 'missing',
                previewBackground: preview ? getComputedStyle(preview).backgroundColor : 'missing',
                popupBackground: popup ? getComputedStyle(popup).backgroundColor : 'missing',
            };
        }"""
    )
```

Then replace the warm-background expectations with checks like:

```python
def assert_midnight_console_homepage(state: dict) -> None:
    assert "rgb(7, 3, 15)" in state["bodyBackgroundColor"], state
    assert "rgb(18, 9, 31)" in state["searchFrameBackground"], state
    assert "0, 255, 255" in state["searchFrameBorderColor"], state
    assert "rgb(18, 9, 31)" in state["previewBackground"], state
    assert "rgb(18, 9, 31)" in state["popupBackground"], state
```

- [ ] **Step 2: Run the homepage smoke test and verify it fails for the current warm theme**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected:

```text
FAIL
AssertionError: {'bodyBackgroundColor': 'rgb(246, 241, 231)', ...}
```

- [ ] **Step 3: Refine the failing checks so they only capture the new visual contract**

Make sure the assertions fail because of the current theme, not because selectors are wrong or the page failed to load.

```python
result["midnight_console_homepage"] = read_midnight_console_homepage_state(page)
assert_midnight_console_homepage(result["midnight_console_homepage"])
```

- [ ] **Step 4: Re-run the smoke test until the failure is specific and stable**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected:

```text
FAIL
AssertionError: midnight console homepage contract mismatch
```

- [ ] **Step 5: Commit the failing test contract**

```bash
git add .tmp/verify_newtab_extension.py
git commit -m "test: add newtab midnight console visual checks"
```

### Task 2: Implement the `newtab` Midnight Console redesign

**Files:**
- Modify: `src/pages/newtab/index.html`
- Modify: `src/pages/newtab/styles/index.css`
- Modify: `src/pages/newtab/index.mjs`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Reshape the homepage DOM so the visual layers match the approved spec**

Update `src/pages/newtab/index.html` so the homepage has an explicit scene shell, a tighter tool cluster, and a preview panel that hangs directly off the search shell.

```html
<main class="homepage-shell">
  <section class="homepage-hero" aria-label="新标签页搜索">
    <div id="homepage-bubble-layer" class="homepage-scene-layer" aria-hidden="true">
      <div class="homepage-scene-sun"></div>
      <div class="homepage-scene-grid"></div>
      <div class="homepage-scene-scanlines"></div>
    </div>

    <section class="homepage-focus-shell" aria-label="主页搜索区域">
      <form id="search-form" class="console-search-form" autocomplete="off">
        <div class="search-shell-head">
          <div class="search-shell-actions search-shell-actions--compact">...</div>
        </div>
        <div class="console-search-frame">...</div>
        <section id="ai-search-preview" class="console-preview-panel" aria-live="polite" hidden>...</section>
      </form>
    </section>
  </section>
</main>
```

- [ ] **Step 2: Run the homepage smoke test to confirm the markup change breaks selectors before CSS is updated**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected:

```text
FAIL
TimeoutError or assertion failure for .outline-search-frame / homepage visual contract
```

- [ ] **Step 3: Replace the homepage CSS token system and background with the Midnight Console palette**

Refactor the top token block in `src/pages/newtab/styles/index.css` to deep-night values and add the scene layer styles.

```css
:root {
  color-scheme: dark;
  --surface-base-0: #07030f;
  --surface-base-40: #140a24;
  --surface-panel: #12091f;
  --surface-panel-strong: #181129;
  --ink-primary: rgba(236, 232, 255, 0.92);
  --ink-secondary: rgba(184, 176, 214, 0.72);
  --accent-cyan: #00ffff;
  --accent-magenta: #ff00ff;
  --accent-sunset-start: #ff6b35;
  --accent-sunset-end: #f72585;
}

body {
  background:
    radial-gradient(circle at 50% 18%, rgba(247, 37, 133, 0.14), transparent 22%),
    linear-gradient(180deg, #140a24 0%, #07030f 68%, #04020a 100%);
}

.homepage-scene-sun {
  background:
    repeating-linear-gradient(
      180deg,
      rgba(255, 107, 53, 0.94) 0 10px,
      rgba(247, 37, 133, 0.94) 10px 18px,
      transparent 18px 22px
    );
}
```

- [ ] **Step 4: Rebuild the search shell, dropdowns, preview panel, and settings modal in the new style**

Implement the deep-surface controls, cyan focus rings, and compact tool cluster while keeping existing IDs and JS wiring.

```css
.console-search-frame {
  min-height: 4.25rem;
  border: 1px solid rgba(0, 255, 255, 0.24);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(24, 17, 41, 0.96), rgba(18, 9, 31, 0.98));
  box-shadow:
    0 0 0 1px rgba(0, 255, 255, 0.08),
    0 0 24px rgba(0, 255, 255, 0.08);
}

.console-search-frame:focus-within {
  border-color: rgba(0, 255, 255, 0.46);
  box-shadow:
    0 0 0 1px rgba(0, 255, 255, 0.18),
    0 0 28px rgba(0, 255, 255, 0.14);
}

.console-preview-panel,
.settings-popup,
.search-target-menu,
.search-suggestions {
  background: rgba(18, 9, 31, 0.96);
  border: 1px solid rgba(0, 255, 255, 0.18);
  color: rgba(236, 232, 255, 0.92);
}
```

- [ ] **Step 5: Update `src/pages/newtab/index.mjs` selectors only where the new DOM shape requires it**

Keep existing business logic but retarget any renamed classes used by startup sizing or shell state logic.

```js
const searchFrame = document.querySelector(".console-search-frame");
const searchOutline = document.querySelector(".outline-search-outline");
const searchOutlineRect = document.querySelector(".outline-search-outline-rect");
```

- [ ] **Step 6: Run the homepage smoke test and verify it passes**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected:

```text
PASS
```

- [ ] **Step 7: Commit the homepage redesign**

```bash
git add src/pages/newtab/index.html src/pages/newtab/styles/index.css src/pages/newtab/index.mjs .tmp/verify_newtab_extension.py
git commit -m "feat: redesign newtab with midnight console theme"
```

### Task 3: Add failing sidebar UI verification for the Midnight Console contract

**Files:**
- Create: `.tmp/verify_sidebar_ui.py`
- Test: `.tmp/verify_sidebar_ui.py`

- [ ] **Step 1: Write a dedicated sidebar verification script that opens the extension sidebar page directly**

Create a small Playwright script that loads `src/pages/sidebar/index.html`, injects shell states through `window.__SIDEBAR_TEST_HOOKS__`, and reads computed styles for the top bar, message area, trace area, and composer.

```python
def read_sidebar_console_state(page: Page) -> dict:
    return page.evaluate(
        """() => {
            const shell = document.querySelector('.sidebar-shell');
            const topbar = document.querySelector('.sidebar-topbar');
            const messages = document.querySelector('.sidebar-messages');
            const form = document.querySelector('.sidebar-form');

            return {
                shellBackground: shell ? getComputedStyle(shell).backgroundImage : 'missing',
                topbarBackground: topbar ? getComputedStyle(topbar).backgroundColor : 'missing',
                messagesBackground: messages ? getComputedStyle(messages).backgroundColor : 'missing',
                formBackground: form ? getComputedStyle(form).backgroundColor : 'missing',
            };
        }"""
    )
```

- [ ] **Step 2: Add a failing assertion for the deep-night sidebar contract**

```python
def assert_sidebar_midnight_console(state: dict) -> None:
    assert "rgb(18, 9, 31)" in state["topbarBackground"], state
    assert "rgb(18, 9, 31)" in state["messagesBackground"], state
    assert "rgb(18, 9, 31)" in state["formBackground"], state
```

- [ ] **Step 3: Run the sidebar verification and verify it fails against the current warm styling**

Run:

```bash
python .tmp/verify_sidebar_ui.py
```

Expected:

```text
FAIL
AssertionError: {'topbarBackground': 'rgb(255, 251, 245)', ...}
```

- [ ] **Step 4: Expand the test harness to cover all shell states**

Drive the built-in test hook and assert that the shell can still render locked, error, degraded, and active content after the redesign.

```python
page.evaluate(
    """() => window.__SIDEBAR_TEST_HOOKS__.setSubmitHandler(async () => {})"""
)
```

Then assert visible state content using the existing IDs:

```python
page.locator("#sidebar-locked-state")
page.locator("#sidebar-error-state")
page.locator("#sidebar-form")
```

- [ ] **Step 5: Commit the failing sidebar verification**

```bash
git add .tmp/verify_sidebar_ui.py
git commit -m "test: add sidebar midnight console visual checks"
```

### Task 4: Implement the `sidebar` Midnight Console redesign

**Files:**
- Modify: `src/pages/sidebar/index.html`
- Modify: `src/pages/sidebar/index.css`
- Modify: `src/pages/sidebar/sidebar-dom-controller.mjs`
- Modify: `src/pages/sidebar/sidebar-state-controller.mjs`
- Test: `.tmp/verify_sidebar_ui.py`

- [ ] **Step 1: Tighten the sidebar shell markup to match the control-panel layout**

Reshape the header, state panels, trace shell, and composer wrappers while preserving current IDs used by the controllers.

```html
<header class="sidebar-topbar sidebar-topbar--console">
  <div class="sidebar-topbar-main">
    <p class="sidebar-topbar-eyebrow">Moon Tab AI</p>
    <div class="sidebar-topbar-status-line">...</div>
    <div class="sidebar-topbar-meta">
      <h1 id="sidebar-context-title" class="sidebar-topbar-title">...</h1>
      <p id="sidebar-context-url" class="sidebar-topbar-url"></p>
    </div>
  </div>
  <button id="sidebar-topbar-settings-button" class="sidebar-icon-button" type="button" aria-label="打开 AI 设置">...</button>
</header>
```

- [ ] **Step 2: Run the sidebar verification to confirm the structural change fails before styling is updated**

Run:

```bash
python .tmp/verify_sidebar_ui.py
```

Expected:

```text
FAIL
AssertionError or locator failure caused by the old warm-theme expectations
```

- [ ] **Step 3: Replace the sidebar token system and rebuild the shell visuals**

Refactor `src/pages/sidebar/index.css` to use the deep-night palette, thinner status bars, darker message surfaces, and a restrained trace lane.

```css
:root {
  color-scheme: dark;
  --sidebar-bg-top: #140a24;
  --sidebar-bg-bottom: #07030f;
  --sidebar-surface: rgba(18, 9, 31, 0.94);
  --sidebar-surface-strong: rgba(24, 17, 41, 0.98);
  --sidebar-border: rgba(0, 255, 255, 0.18);
  --sidebar-border-strong: rgba(0, 255, 255, 0.36);
  --sidebar-text-soft: rgba(184, 176, 214, 0.72);
  --sidebar-accent: #00ffff;
  --sidebar-accent-strong: #ff00ff;
}

.sidebar-messages,
.sidebar-form,
.sidebar-trace,
.sidebar-state-card {
  background: rgba(18, 9, 31, 0.94);
  border: 1px solid rgba(0, 255, 255, 0.18);
  box-shadow: 0 0 24px rgba(0, 255, 255, 0.06);
}
```

- [ ] **Step 4: Adjust DOM rendering so message rows and trace rows match the new component grammar**

Update `sidebar-dom-controller.mjs` so labels, message metadata, and tool result receipts use the tighter console vocabulary instead of the current warm-card treatment.

```js
meta.textContent = role === "user" ? "You" : kind === "tool_result" ? "Action" : "Moon Tab AI";
receiptGlyph.textContent = "+";
receiptLabel.textContent = "Action complete";
```

Also ensure trace rows stay compact:

```js
meta.textContent = status === "failed" ? "failed" : status === "done" ? "done" : "running";
```

- [ ] **Step 5: Shorten shell-state copy and make degraded state non-blocking**

Update `sidebar-state-controller.mjs` to keep the approved control-panel tone and to let degraded mode keep the composer enabled.

```js
if (DEGRADED_CONFIG_STATES.has(configState)) {
  return {
    shellState: SIDEBAR_RUNTIME_STATES.ERROR,
    surfaceVariant: "degraded",
    aiStatusText: "AI 波动中",
    headline: "当前连接不稳定",
    description: degradedReason,
    primaryActionLabel: "检查连接",
    secondaryActionLabel: "刷新状态",
  };
}
```

If the degraded shell should visually remain conversational, update the DOM controller logic accordingly:

```js
const composerEnabled = shellState.shellState === "active" || shellState.surfaceVariant === "degraded";
```

- [ ] **Step 6: Run the sidebar verification and confirm it passes**

Run:

```bash
python .tmp/verify_sidebar_ui.py
```

Expected:

```text
PASS
```

- [ ] **Step 7: Commit the sidebar redesign**

```bash
git add src/pages/sidebar/index.html src/pages/sidebar/index.css src/pages/sidebar/sidebar-dom-controller.mjs src/pages/sidebar/sidebar-state-controller.mjs .tmp/verify_sidebar_ui.py
git commit -m "feat: redesign sidebar with midnight console theme"
```

### Task 5: Full regression verification and final polish

**Files:**
- Modify: any files from Tasks 2-4 if regressions are found
- Test: `.tmp/verify_newtab_extension.py`
- Test: `.tmp/verify_sidebar_ui.py`

- [ ] **Step 1: Run both verification scripts together**

Run:

```bash
python .tmp/verify_newtab_extension.py
python .tmp/verify_sidebar_ui.py
```

Expected:

```text
PASS
PASS
```

- [ ] **Step 2: Manually inspect the saved homepage screenshots for layout regressions**

Use the smoke-test artifacts already written by the homepage verifier:

```text
.tmp/newtab-homepage-qa.png
.tmp/newtab-homepage-before-hover.png
.tmp/newtab-homepage-after-hover.png
```

Check for:

- search box still being the first visual focus;
- no overlap between top controls and the search shell;
- dropdowns and preview panels staying inside the viewport;
- no leftover warm theme surfaces.

- [ ] **Step 3: Fix any final spacing, copy, or selector regressions discovered in verification**

Keep fixes minimal and targeted. Typical small cleanup examples:

```css
.search-shell-actions--compact {
  gap: 0.35rem;
}

.sidebar-topbar-title {
  line-height: 1.25;
}
```

- [ ] **Step 4: Re-run both verification scripts after the cleanup**

Run:

```bash
python .tmp/verify_newtab_extension.py
python .tmp/verify_sidebar_ui.py
```

Expected:

```text
PASS
PASS
```

- [ ] **Step 5: Commit the final verified polish**

```bash
git add src/pages/newtab/index.html src/pages/newtab/styles/index.css src/pages/newtab/index.mjs src/pages/sidebar/index.html src/pages/sidebar/index.css src/pages/sidebar/sidebar-dom-controller.mjs src/pages/sidebar/sidebar-state-controller.mjs .tmp/verify_newtab_extension.py .tmp/verify_sidebar_ui.py
git commit -m "refactor: finalize midnight console synthwave redesign"
```

## Self-Review

### Spec coverage

- Unified brand tokens for `newtab` and `sidebar`: covered by Tasks 2 and 4.
- Synthwave `newtab` with restrained scene layer and search-first layout: covered by Task 2.
- Professional control-panel `sidebar` with tighter top bar, deep surfaces, compact trace, and shortened state copy: covered by Task 4.
- Browser-level verification for both surfaces: covered by Tasks 1, 3, and 5.

### Placeholder scan

- No `TODO`, `TBD`, or “similar to previous task” placeholders remain.
- Every task includes exact files, concrete commands, and either code blocks or explicit assertions.

### Type and naming consistency

- Homepage keeps existing element IDs so `index.mjs` controller wiring remains stable.
- Sidebar keeps existing element IDs and test hook names.
- New CSS naming introduced in the plan (`console-search-frame`, `console-preview-panel`, `homepage-scene-layer`) is consistent across the relevant steps.
