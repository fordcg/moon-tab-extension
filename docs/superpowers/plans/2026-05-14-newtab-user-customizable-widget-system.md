# Newtab User-Customizable Widget System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a registry-driven widget system for the new tab page that lets users hide and restore non-core widgets from the page while preserving the existing search and AI flows.

**Architecture:** Introduce a small widget runtime under `src/pages/newtab/widgets/` that owns widget registration, layout-state persistence, shell rendering, and hide/restore actions. Migrate the existing search area into a core widget first, then add companion widgets and a lightweight add-widget panel, while keeping the existing controller ids and smoke-test contracts stable.

**Tech Stack:** Manifest V3 extension, vanilla ES modules, modular CSS, `chrome.storage.local`, Python Playwright smoke verification in `.tmp/verify_newtab_extension.py`

---

## File Structure

Create or modify the following files.

### Create

- `src/pages/newtab/widgets/layout-state.mjs`
  - loads, normalizes, saves widget layout state
- `src/pages/newtab/widgets/registry.mjs`
  - exports widget definitions and lookup helpers
- `src/pages/newtab/widgets/widget-shell.mjs`
  - creates widget chrome and per-widget actions
- `src/pages/newtab/widgets/widget-runtime.mjs`
  - mounts visible widgets and refreshes after state changes
- `src/pages/newtab/widgets/definitions/search-widget.mjs`
  - wraps the current search stack as a core widget
- `src/pages/newtab/widgets/definitions/calendar-widget.mjs`
  - renders a simple calendar note card
- `src/pages/newtab/widgets/definitions/quicksites-widget.mjs`
  - renders a simple quick-sites note card
- `src/pages/newtab/widgets/definitions/todo-widget.mjs`
  - renders a simple todo note card

### Modify

- `src/pages/newtab/index.html`
  - replace hard-coded page body composition with runtime mount areas and add-widget panel markup
- `src/pages/newtab/index.mjs`
  - initialize widget runtime around existing controllers
- `src/pages/newtab/dom-refs.mjs`
  - expose widget-panel and widget-root references without breaking current ids
- `src/pages/newtab/styles/index.css`
  - import widget-system CSS modules if split, or existing styles if kept inline
- `src/pages/newtab/styles/base.css`
  - layout container updates for widget host regions
- `src/pages/newtab/styles/scene.css`
  - widget card surfaces and add-widget panel shell
- `src/pages/newtab/styles/search.css`
  - search widget shell alignment inside runtime chrome
- `src/pages/newtab/styles/responsive.css`
  - responsive behavior for widget panel and widget list
- `.tmp/verify_newtab_extension.py`
  - add widget hide/restore regression checks without breaking existing smoke coverage

### Test

- `.tmp/verify_newtab_extension.py`

---

### Task 1: Add failing smoke coverage for the widget system contract

**Files:**
- Modify: `.tmp/verify_newtab_extension.py`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Add helpers that read widget controls and widget panel state**

Add these helpers near the other page-state readers:

```python
def read_widget_runtime_state(page: Page) -> dict:
    state = page.evaluate(
        """() => {
            const widgetRoot = document.querySelector('#widget-root');
            const addButton = document.querySelector('#open-widget-panel');
            const panel = document.querySelector('#widget-panel');
            const cards = Array.from(document.querySelectorAll('[data-widget-id]'));
            return {
                widget_root_present: Boolean(widgetRoot),
                add_button_present: Boolean(addButton),
                panel_present: Boolean(panel),
                visible_widget_ids: cards.map((card) => card.getAttribute('data-widget-id')).filter(Boolean),
            };
        }"""
    )
    return state if isinstance(state, dict) else {}


def seed_widget_layout(page: Page, layout: dict) -> None:
    page.evaluate(
        """(nextLayout) => new Promise((resolve) => {
            chrome.storage.local.set({ newtabWidgetLayout: nextLayout }, resolve);
        })""",
        layout,
    )
```

- [ ] **Step 2: Add failing assertions for widget runtime visibility**

Inside the main verification flow, after the current action-group assertions, add:

```python
widget_runtime = read_widget_runtime_state(page)
result["widget_runtime"] = widget_runtime

assert widget_runtime["widget_root_present"], "expected #widget-root mount"
assert widget_runtime["add_button_present"], "expected add-widget trigger"
assert "search" in widget_runtime["visible_widget_ids"], "expected search core widget to be rendered"
```

- [ ] **Step 3: Add a failing hide/restore smoke scenario**

After the settings open/close check, add:

```python
page.locator("[data-widget-id='quicksites'] [data-widget-action='hide']").click()
page.wait_for_function(
    "() => !document.querySelector(\"[data-widget-id='quicksites']\")",
    timeout=10000,
)
page.locator("#open-widget-panel").click()
page.locator("[data-widget-panel-action='restore'][data-widget-id='quicksites']").click()
page.wait_for_function(
    "() => Boolean(document.querySelector(\"[data-widget-id='quicksites']\"))",
    timeout=10000,
)
result["widget_hide_restore_ok"] = True
```

- [ ] **Step 4: Run test to verify it fails**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected: FAIL because `#widget-root`, `#open-widget-panel`, and widget action controls do not exist yet.

- [ ] **Step 5: Commit the failing regression test**

```bash
git add .tmp/verify_newtab_extension.py
git commit -m "test: add newtab widget runtime checks"
```

### Task 2: Build layout-state and registry foundation with search as a core widget

**Files:**
- Create: `src/pages/newtab/widgets/layout-state.mjs`
- Create: `src/pages/newtab/widgets/registry.mjs`
- Create: `src/pages/newtab/widgets/definitions/search-widget.mjs`
- Modify: `src/pages/newtab/index.mjs`
- Modify: `src/pages/newtab/dom-refs.mjs`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Write the failing normalization contract first**

In `src/pages/newtab/widgets/layout-state.mjs`, start from a pure normalization API:

```js
export const WIDGET_LAYOUT_STORAGE_KEY = "newtabWidgetLayout";

export const createDefaultWidgetLayout = () => ({
  version: 1,
  orderedWidgetIds: ["search", "quicksites", "calendar", "todo"],
  hiddenWidgetIds: [],
  widgetPrefs: {},
});

export const normalizeWidgetLayout = ({ layout, registryItems }) => {
  const coreIds = registryItems.filter((item) => item.core).map((item) => item.id);
  const legalIds = new Set(registryItems.map((item) => item.id));
  const nextOrdered = [];

  for (const id of layout?.orderedWidgetIds ?? []) {
    if (typeof id === "string" && legalIds.has(id) && !nextOrdered.includes(id)) {
      nextOrdered.push(id);
    }
  }

  for (const id of coreIds) {
    if (!nextOrdered.includes(id)) {
      nextOrdered.unshift(id);
    }
  }

  const hiddenWidgetIds = (layout?.hiddenWidgetIds ?? []).filter(
    (id) => typeof id === "string" && legalIds.has(id) && !coreIds.includes(id),
  );

  return {
    version: 1,
    orderedWidgetIds: nextOrdered,
    hiddenWidgetIds,
    widgetPrefs: typeof layout?.widgetPrefs === "object" && layout?.widgetPrefs ? layout.widgetPrefs : {},
  };
};
```

- [ ] **Step 2: Implement storage helpers around the normalization contract**

Extend `layout-state.mjs` with:

```js
const extensionApi = typeof chrome !== "undefined" ? chrome : null;

const readStorage = async () => {
  if (!extensionApi?.storage?.local) {
    return {};
  }

  return await new Promise((resolve) => {
    extensionApi.storage.local.get({ [WIDGET_LAYOUT_STORAGE_KEY]: null }, resolve);
  });
};

export const loadWidgetLayout = async ({ registryItems }) => {
  const stored = await readStorage();
  return normalizeWidgetLayout({
    layout: stored[WIDGET_LAYOUT_STORAGE_KEY] ?? createDefaultWidgetLayout(),
    registryItems,
  });
};

export const saveWidgetLayout = async (layout) => {
  if (!extensionApi?.storage?.local) {
    return;
  }

  await new Promise((resolve) => {
    extensionApi.storage.local.set({ [WIDGET_LAYOUT_STORAGE_KEY]: layout }, resolve);
  });
};
```

- [ ] **Step 3: Register the search widget as the first core widget**

Create `registry.mjs` and `definitions/search-widget.mjs`:

```js
// src/pages/newtab/widgets/definitions/search-widget.mjs
export const createSearchWidgetDefinition = () => ({
  id: "search",
  title: "搜索",
  core: true,
  canHide: false,
  defaultVisible: true,
  render: ({ documentRef }) => documentRef.getElementById("widget-search-template"),
});

// src/pages/newtab/widgets/registry.mjs
import { createSearchWidgetDefinition } from "./definitions/search-widget.mjs";

export const WIDGET_REGISTRY = [
  createSearchWidgetDefinition(),
];

export const getWidgetById = (id) => WIDGET_REGISTRY.find((widget) => widget.id === id) ?? null;
export const listWidgets = () => [...WIDGET_REGISTRY];
```

- [ ] **Step 4: Expose widget runtime refs without breaking current DOM refs**

In `src/pages/newtab/dom-refs.mjs`, add:

```js
  widgetRuntime: {
    root: document.getElementById("widget-root"),
    panelTrigger: document.getElementById("open-widget-panel"),
    panel: document.getElementById("widget-panel"),
    panelList: document.getElementById("widget-panel-list"),
    panelStatus: document.getElementById("widget-panel-status"),
  },
```

Keep all existing `search`, `ai`, and controller refs unchanged.

- [ ] **Step 5: Wire the registry into `index.mjs` without mounting yet**

At the top of `src/pages/newtab/index.mjs`, add:

```js
import { listWidgets } from "./widgets/registry.mjs";
import { loadWidgetLayout } from "./widgets/layout-state.mjs";
```

Then after `const elements = getNewtabDomRefs();`, add:

```js
const registeredWidgets = listWidgets();

loadWidgetLayout({ registryItems: registeredWidgets }).catch(() => null);
```

This keeps the foundation small before the mount phase.

- [ ] **Step 6: Run smoke test to verify foundation does not regress current behavior**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected: still FAIL on new widget-runtime assertions, but existing search/settings assertions continue to pass.

- [ ] **Step 7: Commit**

```bash
git add src/pages/newtab/widgets/layout-state.mjs src/pages/newtab/widgets/registry.mjs src/pages/newtab/widgets/definitions/search-widget.mjs src/pages/newtab/dom-refs.mjs src/pages/newtab/index.mjs
git commit -m "feat: add newtab widget layout foundation"
```

### Task 3: Add widget runtime, widget shell, and runtime-driven page assembly

**Files:**
- Create: `src/pages/newtab/widgets/widget-shell.mjs`
- Create: `src/pages/newtab/widgets/widget-runtime.mjs`
- Modify: `src/pages/newtab/index.html`
- Modify: `src/pages/newtab/index.mjs`
- Modify: `src/pages/newtab/styles/base.css`
- Modify: `src/pages/newtab/styles/scene.css`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Replace hard-coded search stack markup with runtime mount points**

In `src/pages/newtab/index.html`, convert the current page section to runtime mount areas:

```html
<section class="homepage-focus-shell layout-newtab-hero" aria-label="主页搜索区域">
  <header class="homepage-title-band" aria-label="主题标题">
    ...
    <button id="open-widget-panel" class="ui-btn-secondary homepage-widget-trigger" type="button" aria-haspopup="dialog" aria-expanded="false">
      添加组件
    </button>
  </header>

  <div id="widget-root" class="homepage-widget-root" aria-live="polite"></div>

  <section id="widget-panel" class="widget-panel" aria-label="组件面板" hidden>
    <div class="widget-panel-header">
      <h2 class="widget-panel-title">添加组件</h2>
      <button id="close-widget-panel" class="ui-btn-icon" type="button" aria-label="关闭组件面板">×</button>
    </div>
    <div id="widget-panel-status" class="widget-panel-status" hidden></div>
    <div id="widget-panel-list" class="widget-panel-list"></div>
  </section>
</section>

<template id="widget-search-template">
  <div class="homepage-search-stack">
    <!-- move the current form/search-status/ai-preview markup here unchanged -->
  </div>
</template>
```

- [ ] **Step 2: Create a reusable widget shell**

In `widget-shell.mjs`, create a shell helper:

```js
export const createWidgetShell = ({ documentRef, widget, canHide }) => {
  const article = documentRef.createElement("article");
  article.className = "ui-note-card homepage-widget-card";
  article.dataset.widgetId = widget.id;

  const header = documentRef.createElement("div");
  header.className = "homepage-widget-card-header";

  const title = documentRef.createElement("h2");
  title.className = "homepage-widget-card-title";
  title.textContent = widget.title;

  const actions = documentRef.createElement("div");
  actions.className = "homepage-widget-card-actions";

  if (canHide) {
    const hideButton = documentRef.createElement("button");
    hideButton.type = "button";
    hideButton.className = "ui-btn-icon homepage-widget-action";
    hideButton.dataset.widgetAction = "hide";
    hideButton.setAttribute("aria-label", `隐藏${widget.title}`);
    hideButton.textContent = "×";
    actions.appendChild(hideButton);
  }

  header.append(title, actions);

  const body = documentRef.createElement("div");
  body.className = "homepage-widget-card-body";
  article.append(header, body);
  return { article, body };
};
```

- [ ] **Step 3: Implement runtime mount/unmount flow**

In `widget-runtime.mjs`, add:

```js
import { createWidgetShell } from "./widget-shell.mjs";

export const createWidgetRuntime = ({ documentRef, registryItems, layoutStateApi, elements }) => {
  let currentLayout = null;

  const mount = async () => {
    currentLayout = await layoutStateApi.loadWidgetLayout({ registryItems });
    render();
  };

  const render = () => {
    if (!(elements.root instanceof HTMLElement) || !currentLayout) {
      return;
    }

    elements.root.innerHTML = "";

    for (const id of currentLayout.orderedWidgetIds) {
      if (currentLayout.hiddenWidgetIds.includes(id)) {
        continue;
      }

      const widget = registryItems.find((item) => item.id == id);
      if (!widget) {
        continue;
      }

      const { article, body } = createWidgetShell({
        documentRef,
        widget,
        canHide: widget.canHide,
      });

      const rendered = widget.render({ documentRef });
      if (rendered instanceof HTMLElement) {
        body.appendChild(rendered);
      } else if (rendered instanceof HTMLTemplateElement) {
        body.appendChild(rendered.content.cloneNode(True));
      }

      elements.root.appendChild(article);
    }
  };

  return { mount, render };
};
```

Use `true`, not `True`, in the actual code.

- [ ] **Step 4: Initialize runtime from `index.mjs`**

Replace the temporary `loadWidgetLayout(...)` call with:

```js
import { createWidgetRuntime } from "./widgets/widget-runtime.mjs";
import * as widgetLayoutState from "./widgets/layout-state.mjs";

const widgetRuntime = createWidgetRuntime({
  documentRef: document,
  registryItems: registeredWidgets,
  layoutStateApi: widgetLayoutState,
  elements: elements.widgetRuntime,
});

await widgetRuntime.mount();
```

Keep this initialization before `createStartupController(...)` so search DOM exists when current controllers bind.

- [ ] **Step 5: Add the minimal widget host styling**

In `src/pages/newtab/styles/base.css` and `scene.css`, add:

```css
.homepage-widget-root {
  display: grid;
  gap: 0.9rem;
}

.homepage-widget-card {
  position: relative;
}

.homepage-widget-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.78rem 0.9rem 0 0.9rem;
}

.homepage-widget-card-body {
  padding: 0 0.9rem 0.9rem;
}
```

- [ ] **Step 6: Run smoke test to verify runtime mount now satisfies widget-root checks**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected: widget-root and search core widget assertions pass; hide/restore still fails because non-core widgets and panel actions are not wired yet.

- [ ] **Step 7: Commit**

```bash
git add src/pages/newtab/widgets/widget-shell.mjs src/pages/newtab/widgets/widget-runtime.mjs src/pages/newtab/index.html src/pages/newtab/index.mjs src/pages/newtab/styles/base.css src/pages/newtab/styles/scene.css
git commit -m "feat: add newtab widget runtime"
```

### Task 4: Add companion widgets and persisted hide/restore actions

**Files:**
- Create: `src/pages/newtab/widgets/definitions/calendar-widget.mjs`
- Create: `src/pages/newtab/widgets/definitions/quicksites-widget.mjs`
- Create: `src/pages/newtab/widgets/definitions/todo-widget.mjs`
- Modify: `src/pages/newtab/widgets/registry.mjs`
- Modify: `src/pages/newtab/widgets/layout-state.mjs`
- Modify: `src/pages/newtab/widgets/widget-runtime.mjs`
- Modify: `src/pages/newtab/styles/scene.css`
- Modify: `src/pages/newtab/styles/responsive.css`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Add simple non-core widget definitions**

Create companion widgets with self-contained DOM:

```js
// quicksites-widget.mjs
export const createQuicksitesWidgetDefinition = () => ({
  id: "quicksites",
  title: "快捷站点",
  core: false,
  canHide: true,
  defaultVisible: true,
  render: ({ documentRef }) => {
    const section = documentRef.createElement("section");
    section.className = "widget-quicksites";
    section.innerHTML = `
      <div class="widget-chip-list">
        <a class="widget-chip" href="https://github.com/">GitHub</a>
        <a class="widget-chip" href="https://www.bilibili.com/">B站</a>
        <a class="widget-chip" href="https://sspai.com/">少数派</a>
      </div>
    `;
    return section;
  },
});
```

Mirror this pattern for `calendar` and `todo` with small static content blocks.

- [ ] **Step 2: Register the new widgets in stable order**

Update `registry.mjs`:

```js
import { createCalendarWidgetDefinition } from "./definitions/calendar-widget.mjs";
import { createQuicksitesWidgetDefinition } from "./definitions/quicksites-widget.mjs";
import { createTodoWidgetDefinition } from "./definitions/todo-widget.mjs";

export const WIDGET_REGISTRY = [
  createSearchWidgetDefinition(),
  createQuicksitesWidgetDefinition(),
  createCalendarWidgetDefinition(),
  createTodoWidgetDefinition(),
];
```

- [ ] **Step 3: Add hide/restore storage helpers**

In `layout-state.mjs`, add:

```js
export const hideWidget = async ({ layout, widgetId, registryItems }) => {
  const nextLayout = normalizeWidgetLayout({
    layout: {
      ...layout,
      hiddenWidgetIds: [...layout.hiddenWidgetIds, widgetId],
    },
    registryItems,
  });
  await saveWidgetLayout(nextLayout);
  return nextLayout;
};

export const restoreWidget = async ({ layout, widgetId, registryItems }) => {
  const nextLayout = normalizeWidgetLayout({
    layout: {
      ...layout,
      hiddenWidgetIds: layout.hiddenWidgetIds.filter((id) => id !== widgetId),
      orderedWidgetIds: layout.orderedWidgetIds.includes(widgetId)
        ? layout.orderedWidgetIds
        : [...layout.orderedWidgetIds, widgetId],
    },
    registryItems,
  });
  await saveWidgetLayout(nextLayout);
  return nextLayout;
};
```

- [ ] **Step 4: Wire hide actions into the runtime**

In `widget-runtime.mjs`, after each widget mounts:

```js
      article.addEventListener("click", async (event) => {
        const actionButton = event.target instanceof Element
          ? event.target.closest("[data-widget-action='hide']")
          : null;
        if (!actionButton) {
          return;
        }

        currentLayout = await layoutStateApi.hideWidget({
          layout: currentLayout,
          widgetId: widget.id,
          registryItems,
        });
        render();
      });
```

- [ ] **Step 5: Style the companion widgets as real note cards**

In `scene.css`, add:

```css
.widget-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.widget-chip {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0.45rem 0.8rem;
  border: 1px solid var(--line-toolbar);
  border-radius: 999px;
  background: rgba(255, 248, 236, 0.95);
  color: var(--ink-primary);
  text-decoration: none;
}

.widget-note-list {
  display: grid;
  gap: 0.55rem;
}
```

- [ ] **Step 6: Run smoke test to verify hide removes quicksites**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected: quicksites hide passes; restore still fails because the widget panel is not implemented yet.

- [ ] **Step 7: Commit**

```bash
git add src/pages/newtab/widgets/definitions/calendar-widget.mjs src/pages/newtab/widgets/definitions/quicksites-widget.mjs src/pages/newtab/widgets/definitions/todo-widget.mjs src/pages/newtab/widgets/registry.mjs src/pages/newtab/widgets/layout-state.mjs src/pages/newtab/widgets/widget-runtime.mjs src/pages/newtab/styles/scene.css src/pages/newtab/styles/responsive.css
git commit -m "feat: add newtab companion widgets"
```

### Task 5: Implement the add-widget panel and restore flow

**Files:**
- Modify: `src/pages/newtab/index.html`
- Modify: `src/pages/newtab/widgets/widget-runtime.mjs`
- Modify: `src/pages/newtab/styles/scene.css`
- Modify: `src/pages/newtab/styles/responsive.css`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Add panel control ids required by the runtime**

Ensure `index.html` includes these exact ids:

```html
<button id="open-widget-panel" ...>添加组件</button>
...
<section id="widget-panel" class="widget-panel" hidden>
  ...
  <button id="close-widget-panel" class="ui-btn-icon" type="button" aria-label="关闭组件面板">×</button>
  <div id="widget-panel-status" class="widget-panel-status" hidden></div>
  <div id="widget-panel-list" class="widget-panel-list"></div>
</section>
```

- [ ] **Step 2: Render panel groups from layout state**

In `widget-runtime.mjs`, add:

```js
  const renderPanel = () => {
    if (!(elements.panelList instanceof HTMLElement) || !currentLayout) {
      return;
    }

    elements.panelList.innerHTML = "";

    for (const widget of registryItems) {
      if (widget.core) {
        continue;
      }

      const row = documentRef.createElement("div");
      row.className = "widget-panel-row";
      row.dataset.widgetId = widget.id;

      const label = documentRef.createElement("span");
      label.textContent = widget.title;

      const button = documentRef.createElement("button");
      button.type = "button";

      const isVisible = currentLayout.orderedWidgetIds.includes(widget.id) && !currentLayout.hiddenWidgetIds.includes(widget.id);
      const isHidden = currentLayout.hiddenWidgetIds.includes(widget.id);

      if (isHidden) {
        button.dataset.widgetPanelAction = "restore";
        button.dataset.widgetId = widget.id;
        button.textContent = "恢复";
      } else if (isVisible) {
        button.disabled = true;
        button.textContent = "已添加";
      } else {
        button.dataset.widgetPanelAction = "restore";
        button.dataset.widgetId = widget.id;
        button.textContent = "添加";
      }

      row.append(label, button);
      elements.panelList.appendChild(row);
    }
  };
```

- [ ] **Step 3: Wire open/close/restore panel behavior**

Extend the runtime with:

```js
  const setPanelOpen = (open) => {
    if (!(elements.panel instanceof HTMLElement) || !(elements.panelTrigger instanceof HTMLButtonElement)) {
      return;
    }

    elements.panel.hidden = !open;
    elements.panelTrigger.setAttribute("aria-expanded", open ? "true" : "false");
  };

  elements.panelTrigger?.addEventListener("click", () => {
    renderPanel();
    setPanelOpen(elements.panel?.hidden ?? True);
  });

  documentRef.getElementById("close-widget-panel")?.addEventListener("click", () => {
    setPanelOpen(false);
  });

  elements.panelList?.addEventListener("click", async (event) => {
    const button = event.target instanceof Element
      ? event.target.closest("[data-widget-panel-action='restore']")
      : null;
    if (!button) {
      return;
    }

    currentLayout = await layoutStateApi.restoreWidget({
      layout: currentLayout,
      widgetId: button.getAttribute("data-widget-id") ?? "",
      registryItems,
    });
    render();
    renderPanel();
  });
```

Use `true`, not `True`, in the actual code.

- [ ] **Step 4: Add panel styling**

In `scene.css`, add:

```css
.widget-panel {
  position: absolute;
  top: 0.5rem;
  right: 0;
  width: min(320px, calc(100vw - 1rem));
  padding: 0.9rem;
  border: 1px solid rgba(229, 201, 160, 0.82);
  border-radius: 20px;
  background: linear-gradient(180deg, #fffdf8 0%, #fff6e9 100%);
  box-shadow: var(--shadow-note);
  z-index: 5;
}

.widget-panel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.55rem 0;
}
```

- [ ] **Step 5: Run smoke test to verify full hide/restore path**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected: PASS on the new widget hide/restore smoke path and all existing new-tab behavior checks.

- [ ] **Step 6: Commit**

```bash
git add src/pages/newtab/index.html src/pages/newtab/widgets/widget-runtime.mjs src/pages/newtab/styles/scene.css src/pages/newtab/styles/responsive.css
git commit -m "feat: add newtab widget panel"
```

### Task 6: Final layout hardening, malformed-state recovery, and verification cleanup

**Files:**
- Modify: `src/pages/newtab/widgets/layout-state.mjs`
- Modify: `.tmp/verify_newtab_extension.py`
- Modify: `src/pages/newtab/styles/base.css`
- Modify: `src/pages/newtab/styles/responsive.css`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Add explicit malformed-state regression coverage**

In `.tmp/verify_newtab_extension.py`, seed bad storage before opening a page:

```python
seed_widget_layout(
    page,
    {
        "version": 1,
        "orderedWidgetIds": ["search", "search", "ghost", "calendar"],
        "hiddenWidgetIds": ["search", "ghost", "todo"],
        "widgetPrefs": "invalid",
    },
)
```

Then assert:

```python
normalized_widget_runtime = read_widget_runtime_state(page)
assert "search" in normalized_widget_runtime["visible_widget_ids"], "expected core widget recovery"
assert "ghost" not in normalized_widget_runtime["visible_widget_ids"], "expected unknown widget removal"
```

- [ ] **Step 2: Harden normalization to rewrite bad storage back to a safe state**

In `layout-state.mjs`, update `loadWidgetLayout`:

```js
export const loadWidgetLayout = async ({ registryItems }) => {
  const stored = await readStorage();
  const normalized = normalizeWidgetLayout({
    layout: stored[WIDGET_LAYOUT_STORAGE_KEY] ?? createDefaultWidgetLayout(),
    registryItems,
  });

  await saveWidgetLayout(normalized);
  return normalized;
};
```

- [ ] **Step 3: Tighten responsive layout for widget panel and card spacing**

In `base.css` and `responsive.css`, add:

```css
@media (max-width: 760px) {
  .homepage-widget-root {
    gap: 0.75rem;
  }

  .widget-panel {
    top: 3.5rem;
    left: 0;
    right: 0;
    width: auto;
  }
}
```

- [ ] **Step 4: Run final verification**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected: PASS with widget runtime, hide/restore flow, malformed-layout recovery, search interactions, settings modal, and AI preview checks all green.

- [ ] **Step 5: Commit**

```bash
git add src/pages/newtab/widgets/layout-state.mjs .tmp/verify_newtab_extension.py src/pages/newtab/styles/base.css src/pages/newtab/styles/responsive.css
git commit -m "chore: harden newtab widget layout recovery"
```

## Self-Review

- Spec coverage: covered registry, layout-state persistence, runtime assembly, core search widget protection, user hide/restore flow, add-widget panel, malformed-state recovery, and verification.
- Placeholder scan: no `TODO`, `TBD`, or cross-task "similar to above" shortcuts remain.
- Type consistency: plan consistently uses `newtabWidgetLayout`, `orderedWidgetIds`, `hiddenWidgetIds`, `widgetPrefs`, `core`, `canHide`, and `restore` across runtime, storage, and tests.
