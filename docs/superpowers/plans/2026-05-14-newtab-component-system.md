# New Tab Component System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable warm-paper component system for the new tab page so the search shell, action group, bubbles, and companion widgets match the approved reference direction.

**Architecture:** Keep the current extension architecture and JavaScript controllers intact, but introduce a clearer visual layer built from `ui-*` primitives and `widget-*` modules. Do the work as a narrow structural polish pass: minimal HTML changes for better hooks, major CSS re-theming in the existing stylesheet split, and targeted copy/controller updates where the old `AI预览` wording is incorrect.

**Tech Stack:** Manifest V3 extension, HTML, modular CSS (`tokens.css`, `scene.css`, `search.css`, `responsive.css`, `ai-preview.css`), vanilla ES modules, Python Playwright smoke verification in `.tmp/verify_newtab_extension.py`

---

### Task 1: Add a failing UI regression check for the new action-group contract

**Files:**
- Modify: `.tmp/verify_newtab_extension.py`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Write the failing test assertions**

Add a helper that reads the top-right action cluster and make the script assert the new contract:

```python
def read_search_action_group(page: Page) -> dict:
    return page.evaluate(
        """() => {
            const group = document.querySelector('.ui-toolbar-group');
            const primary = document.querySelector('#ai-toggle-btn');
            const sidebar = document.querySelector('#open-ai-sidebar');
            const settings = document.querySelector('#open-settings');

            return {
                group_present: Boolean(group),
                primary_text: primary?.innerText?.replace(/\\s+/g, ' ').trim() ?? '',
                sidebar_text: sidebar?.innerText?.replace(/\\s+/g, ' ').trim() ?? '',
                settings_present: Boolean(settings),
                primary_classes: primary ? Array.from(primary.classList) : [],
            };
        }"""
    )
```

Then add assertions in the main verification flow:

```python
action_group = read_search_action_group(page)
assert action_group["group_present"], "expected .ui-toolbar-group around search actions"
assert "AI增强搜索" in action_group["primary_text"], "expected primary button text to be AI增强搜索"
assert action_group["sidebar_text"] == "侧栏", "expected sidebar button copy to stay 侧栏"
assert "ui-btn-primary" in action_group["primary_classes"], "expected primary button class"
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected: FAIL because `.ui-toolbar-group` and `AI增强搜索` do not exist yet.

- [ ] **Step 3: Commit the failing test**

```bash
git add .tmp/verify_newtab_extension.py
git commit -m "test: add newtab action group regression checks"
```

### Task 2: Refactor the search-shell markup and incorrect action copy

**Files:**
- Modify: `src/pages/newtab/index.html`
- Modify: `src/pages/newtab/dom-refs.mjs`
- Modify: `src/pages/newtab/ai-preview-controller.mjs`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Wrap the search actions in the new grouped-control markup**

Replace the existing action block with a grouped shell and the new class names while keeping the same element IDs:

```html
<div class="search-shell-actions ui-toolbar-group" aria-label="搜索操作">
  <button
    id="ai-toggle-btn"
    type="button"
    class="ai-toggle-btn ui-btn-primary"
    aria-label="切换AI增强搜索"
    aria-pressed="false"
  >
    <span class="ai-toggle-icon" aria-hidden="true">AI</span>
    <span class="ai-toggle-text">AI增强搜索</span>
  </button>

  <button
    id="open-ai-sidebar"
    class="settings-trigger search-settings-trigger search-ai-sidebar-trigger ui-btn-secondary"
    type="button"
    aria-label="打开 AI 助手侧边栏"
  >
    <span class="search-settings-trigger-icon" aria-hidden="true">侧栏</span>
    <span class="search-settings-trigger-label visually-hidden">打开 AI 助手侧边栏</span>
  </button>

  <button
    id="open-settings"
    class="settings-trigger search-settings-trigger ui-btn-icon"
    type="button"
    aria-label="打开设置"
  >
```

- [ ] **Step 2: Keep DOM references stable**

Do not rename element IDs in `dom-refs.mjs`. Only keep the current references intact:

```js
toggleButton: document.getElementById("ai-toggle-btn"),
openSidebarButton: document.getElementById("open-ai-sidebar"),
```

If a wrapper reference is needed later, add it without breaking the existing controller contract:

```js
toolbarGroup: document.querySelector(".ui-toolbar-group"),
```

- [ ] **Step 3: Replace preview-only wording in controller state copy**

Update the button/indicator wording in `ai-preview-controller.mjs` so the UI no longer suggests a fake standalone preview feature:

```js
aiToggleButton.setAttribute(
  "aria-label",
  isAiSearchActivating
    ? "AI增强搜索启用中"
    : isAiSearchEnabled
      ? "关闭AI增强搜索"
      : "开启AI增强搜索",
);
```

Keep the preview panel behavior, but avoid using `AI预览` as the action name.

- [ ] **Step 4: Run test to verify the markup and copy now pass**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected: the new action-group assertions pass, but later visual checks may still reveal styling mismatches.

- [ ] **Step 5: Commit**

```bash
git add src/pages/newtab/index.html src/pages/newtab/dom-refs.mjs src/pages/newtab/ai-preview-controller.mjs .tmp/verify_newtab_extension.py
git commit -m "feat: restructure newtab search action group"
```

### Task 3: Establish shared component tokens and search-shell primitives

**Files:**
- Modify: `src/pages/newtab/styles/tokens.css`
- Modify: `src/pages/newtab/styles/search.css`
- Modify: `src/pages/newtab/styles/settings.css`
- Modify: `src/pages/newtab/styles/motion.css`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Extend tokens for grouped controls and note surfaces**

Add explicit tokens for the new component family:

```css
:root {
  --surface-toolbar: #fffaf2;
  --surface-toolbar-strong: #fff1d9;
  --surface-note: #fffaf3;
  --surface-note-soft: #fff6ea;
  --line-toolbar: rgba(229, 201, 160, 0.9);
  --shadow-toolbar: 0 10px 18px rgba(151, 112, 66, 0.08);
  --shadow-note: 0 8px 18px rgba(151, 112, 66, 0.08);
  --radius-toolbar: 20px;
  --radius-widget: 20px;
}
```

- [ ] **Step 2: Build the reusable action-group and button primitive classes**

In `search.css`, add the new shared classes and let the existing button IDs inherit from them:

```css
.ui-toolbar-group {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.28rem;
  border: 1px solid var(--line-toolbar);
  border-radius: var(--radius-toolbar);
  background: linear-gradient(180deg, var(--surface-toolbar) 0%, var(--surface-toolbar-strong) 100%);
  box-shadow: var(--shadow-toolbar);
}

.ui-btn-primary,
.ui-btn-secondary,
.ui-btn-icon {
  min-height: 38px;
  border-radius: 14px;
  transition:
    color var(--transition-standard),
    background-color var(--transition-standard),
    border-color var(--transition-standard),
    transform var(--transition-standard),
    box-shadow var(--transition-standard);
}
```

- [ ] **Step 3: Re-theme the search shell to feel lighter and more note-like**

Replace the heavier frame treatment with a softer shell:

```css
.outline-search-frame {
  min-height: 176px;
  border-radius: 28px;
  background: var(--surface-note);
  border: 1px solid rgba(225, 191, 144, 0.88);
  box-shadow: 0 14px 28px rgba(151, 112, 66, 0.08);
}

.outline-search-frame-inner {
  background: linear-gradient(180deg, rgba(255, 253, 248, 0.98) 0%, rgba(255, 246, 230, 0.98) 100%);
}
```

- [ ] **Step 4: Update focus-visible styles to include the new class family**

In `settings.css` (or the current focus-visible location), make sure grouped buttons still show accessible focus:

```css
.ui-btn-primary:focus-visible,
.ui-btn-secondary:focus-visible,
.ui-btn-icon:focus-visible,
.search-target-trigger:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px var(--focus-ring);
}
```

- [ ] **Step 5: Run the smoke test**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected: functional assertions pass and the screenshot output now shows a grouped, softer search shell.

- [ ] **Step 6: Commit**

```bash
git add src/pages/newtab/styles/tokens.css src/pages/newtab/styles/search.css src/pages/newtab/styles/settings.css src/pages/newtab/styles/motion.css
git commit -m "feat: add newtab component primitives"
```

### Task 4: Rebuild the search-area composition around the new system

**Files:**
- Modify: `src/pages/newtab/index.html`
- Modify: `src/pages/newtab/styles/search.css`
- Modify: `src/pages/newtab/styles/ai-preview.css`
- Modify: `src/pages/newtab/search-target-controller.mjs`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Add page-module classes to the search shell**

Tag the main composition so later styling is not tied only to legacy names:

```html
<form id="search-form" class="outline-search-form widget-search-shell" autocomplete="off">
  <div class="outline-search-frame ui-input-shell">
    <div class="search-control-rail widget-search-shell__top">
```

Also tag the input section:

```html
<div class="search-input-stack widget-search-shell__input">
  <div class="search-entry-row widget-search-shell__target-row">
```

- [ ] **Step 2: Tighten the relation between target chip, input, and helper text**

Adjust `search.css` so the target selector and input read as one continuous tool:

```css
.widget-search-shell__input {
  gap: 0.52rem;
  padding: 0.96rem 1.18rem 1.08rem;
}

.search-target-trigger {
  min-height: 36px;
  background: rgba(255, 244, 220, 0.96);
}
```

- [ ] **Step 3: Re-skin the AI preview card so it belongs to the same note family**

Update `ai-preview.css`:

```css
.ai-search-preview {
  border: 1px solid rgba(229, 201, 160, 0.9);
  border-radius: 22px;
  background: linear-gradient(180deg, #fffdf8 0%, #fff7eb 100%);
  box-shadow: var(--shadow-note);
}

.ai-search-preview-kicker {
  background: rgba(255, 233, 190, 0.72);
}
```

- [ ] **Step 4: Keep search-target state rendering compatible**

If `search-target-controller.mjs` depends on visual classes, keep the current menu logic but do not hard-code old presentation assumptions. The render path should still look like:

```js
element.classList.toggle("is-active", isActive);
element.setAttribute("aria-selected", isActive ? "true" : "false");
```

Only add new classes if they are purely additive.

- [ ] **Step 5: Run the smoke test**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected: search controls remain interactive and the AI preview panel still renders without overlap.

- [ ] **Step 6: Commit**

```bash
git add src/pages/newtab/index.html src/pages/newtab/styles/search.css src/pages/newtab/styles/ai-preview.css src/pages/newtab/search-target-controller.mjs
git commit -m "feat: retheme newtab search shell"
```

### Task 5: Build companion widget modules that match the reference image language

**Files:**
- Modify: `src/pages/newtab/index.html`
- Modify: `src/pages/newtab/styles/scene.css`
- Modify: `src/pages/newtab/styles/base.css`
- Modify: `src/pages/newtab/styles/responsive.css`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Tag the existing decorative/support blocks as widgets**

Add module classes where the existing markup already represents floating cards, quick sites, and bubbles. Use additive classes, for example:

```html
<section class="homepage-focus-shell layout-newtab-hero" aria-label="主页搜索区域">
```

and for supporting cards:

```html
<div class="... widget-todo ui-note-card">
<div class="... widget-calendar ui-note-card">
<section class="... widget-quicksites ui-note-card">
```

If a widget is already present under another class, add these classes rather than renaming everything at once.

- [ ] **Step 2: Re-skin widget surfaces in `scene.css`**

Add the note-card and float-bubble language:

```css
.ui-note-card {
  border: 1px solid rgba(229, 201, 160, 0.82);
  border-radius: var(--radius-widget);
  background: linear-gradient(180deg, #fffdf8 0%, #fff6e9 100%);
  box-shadow: var(--shadow-note);
}

.ui-float-bubble {
  border: 1px solid rgba(236, 217, 192, 0.9);
  border-radius: 18px;
  background: rgba(255, 251, 244, 0.96);
  box-shadow: 0 8px 16px rgba(151, 112, 66, 0.06);
}
```

- [ ] **Step 3: Rebalance layout scale so support widgets stay secondary**

In `scene.css` and `base.css`, reduce the visual weight of companion modules:

```css
.widget-todo,
.widget-calendar,
.widget-quicksites {
  transform: scale(0.96);
  transform-origin: center;
}

.homepage-title-band {
  margin-bottom: 0.5rem;
}
```

Use this as a direction, not a mandatory literal value if nearby spacing adjustments produce a better result.

- [ ] **Step 4: Adjust narrow-width behavior so the search shell stays primary**

In `responsive.css`, preserve hierarchy on smaller screens:

```css
@media (max-width: 480px) {
  .ui-toolbar-group {
    width: 100%;
    justify-content: stretch;
  }

  .ui-btn-primary {
    flex: 1 1 auto;
  }
}
```

- [ ] **Step 5: Run the smoke test**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected: page still loads, the main search shell remains dominant, and no widget text overlaps at the saved screenshots.

- [ ] **Step 6: Commit**

```bash
git add src/pages/newtab/index.html src/pages/newtab/styles/scene.css src/pages/newtab/styles/base.css src/pages/newtab/styles/responsive.css
git commit -m "feat: add newtab companion widget styling"
```

### Task 6: Final copy cleanup and verification pass

**Files:**
- Modify: `src/pages/newtab/index.html`
- Modify: `src/pages/newtab/settings/index.mjs`
- Modify: `.tmp/verify_newtab_extension.py`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Remove stale “搜索预览” product wording where it misstates the feature**

Update copy that currently over-claims a separate preview feature. In `index.html`, change settings copy from:

```html
<p class="settings-section-description">接口地址、鉴权和模型将用于生成搜索预览。</p>
<p class="settings-switch-description">开启后会先生成搜索预览，再执行搜索或打开站点。</p>
```

to wording aligned with the approved feature name:

```html
<p class="settings-section-description">接口地址、鉴权和模型将用于生成 AI 增强搜索结果。</p>
<p class="settings-switch-description">开启后会先生成 AI 增强搜索方案，再执行搜索或打开站点。</p>
```

- [ ] **Step 2: Keep runtime messages semantically consistent**

In `settings/index.mjs` and related status copy, keep the existing runtime behavior but prefer wording like:

```js
message: "最近一次测试通过，可以启用 AI 增强搜索。"
```

Do not rename stored keys or behavior flags unless required; this is a product-copy pass, not a persistence migration.

- [ ] **Step 3: Run final verification**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected: PASS with updated screenshots written under `.tmp/` and no console/page errors from the new UI structure.

- [ ] **Step 4: Commit**

```bash
git add src/pages/newtab/index.html src/pages/newtab/settings/index.mjs .tmp/verify_newtab_extension.py
git commit -m "chore: align newtab ai search copy"
```

## Self-Review

- Spec coverage: covered `ui-*` primitives, `widget-*` modules, search action hierarchy, search-shell composition, companion widgets, responsive behavior, and verification.
- Placeholder scan: no placeholder markers or “similar to task N” shortcuts remain.
- Type consistency: plan keeps existing IDs and controller entry points (`#ai-toggle-btn`, `#open-ai-sidebar`, `#open-settings`, current DOM ref exports) stable while adding additive classes.
