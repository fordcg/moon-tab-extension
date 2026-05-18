# Newtab Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the oversized `src/pages/newtab` stylesheet and thin the page entrypoint so the newtab code is easier to maintain without changing visible behavior.

**Architecture:** Keep the current plain HTML + ESM controller architecture, preserve the existing ids/class names, and refactor in two layers. First, turn `src/pages/newtab/styles/index.css` into an ordered aggregator over focused CSS modules. Second, move DOM lookup ownership and shared mutable page state out of `src/pages/newtab/index.mjs` into small helper modules while keeping the existing controllers in place.

**Tech Stack:** Manifest V3 extension, static HTML/CSS, native ESM modules, Python Playwright smoke verification in `.tmp/verify_newtab_extension.py`

---

### Task 1: Lock the current behavior contract before moving files

**Files:**
- Modify if needed: `.tmp/verify_newtab_extension.py`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Review the current verifier coverage and note the preserved flows**

Check that the verifier still covers these flows before touching code:

```text
- extension boot and ready state
- search input readiness
- suggestion open/keyboard/click behavior
- search target switching
- AI preview flow
```

- [ ] **Step 2: Run the existing smoke verifier as the baseline**

Run:

```powershell
python .tmp/verify_newtab_extension.py
```

Expected:

```text
The script finishes successfully and writes its normal verification artifacts without newtab selector failures.
```

- [ ] **Step 3: Tighten the verifier only if a preserved flow is currently unasserted**

If the script is missing one of the preserved flows above, extend it with focused checks that keep the existing ids unchanged, for example:

```python
assert page.locator("#search-target-trigger").is_visible()
assert page.locator("#search-suggestions").count() >= 0
assert page.locator("#ai-search-preview").count() == 1
```

- [ ] **Step 4: Re-run the verifier and keep the baseline green**

Run:

```powershell
python .tmp/verify_newtab_extension.py
```

Expected:

```text
PASS, with the baseline verifier ready to catch regressions introduced by the refactor.
```

- [ ] **Step 5: Commit the verification baseline**

Run:

```powershell
git add .tmp/verify_newtab_extension.py
git commit -m "test: lock newtab refactor behavior"
```

Expected:

```text
A commit exists that captures the verification contract before the refactor starts.
```

### Task 2: Split `styles/index.css` into focused modules with a stable entry file

**Files:**
- Create: `src/pages/newtab/styles/tokens.css`
- Create: `src/pages/newtab/styles/base.css`
- Create: `src/pages/newtab/styles/scene.css`
- Create: `src/pages/newtab/styles/search.css`
- Create: `src/pages/newtab/styles/ai-preview.css`
- Create: `src/pages/newtab/styles/settings.css`
- Create: `src/pages/newtab/styles/responsive.css`
- Create: `src/pages/newtab/styles/motion.css`
- Modify: `src/pages/newtab/styles/index.css`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Replace the monolithic stylesheet entry with an ordered aggregator**

Set `src/pages/newtab/styles/index.css` to the ordered imports below:

```css
@import "./tokens.css";
@import "./base.css";
@import "./scene.css";
@import "./search.css";
@import "./ai-preview.css";
@import "./settings.css";
@import "./responsive.css";
@import "./motion.css";
```

- [ ] **Step 2: Move the token block into `tokens.css` unchanged**

Start `src/pages/newtab/styles/tokens.css` with the existing `:root` block so token names stay stable:

```css
:root {
  color-scheme: dark;
  --font-sans: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --font-serif: "Iowan Old Style", "Palatino Linotype", "Songti SC", "STSong", serif;
  --font-mono: "Cascadia Code", "SFMono-Regular", "Consolas", monospace;
}
```

- [ ] **Step 3: Move structural globals into `base.css`**

Put only global element rules and shared utilities here:

```css
* { box-sizing: border-box; }
html, body { min-height: 100%; }
html { background: var(--surface-night-990); }
body { margin: 0; font-family: var(--font-sans); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; }
```

- [ ] **Step 4: Move module-specific rules into scene/search/AI/settings files without renaming selectors**

Use the existing selectors exactly as they are today, grouped by ownership:

```text
scene.css      -> .homepage-scene*, .homepage-bubble-layer, body::before, body::after
search.css     -> .outline-search-*, .search-*, .homepage-search-stack, .settings-trigger, .ai-toggle-btn
ai-preview.css -> .ai-search-preview-*, .ai-loading-*, AI preview button states
settings.css   -> .settings-backdrop, .settings-popup, .settings-form, .settings-*
```

- [ ] **Step 5: Centralize breakpoints into `responsive.css`**

Move every existing media query block out of the feature files and keep the selectors unchanged, for example:

```css
@media (max-width: 760px) {
  .homepage-hero { width: min(96vw, 760px); }
  .search-main-row,
  .search-frame-inner { grid-template-columns: 1fr; }
}
```

- [ ] **Step 6: Centralize keyframes and reduced-motion handling into `motion.css`**

Move every existing animation definition and the reduced-motion override into one file:

```css
@keyframes homepage-sun-drift {
  0% { transform: translateX(-50%) translateY(0) scale(1); }
  100% { transform: translateX(-50%) translateY(-6px) scale(1.015); }
}

@media (prefers-reduced-motion: reduce) {
  .homepage-scene-sun,
  .ai-toggle-coil span { animation: none; transition: none; }
}
```

- [ ] **Step 7: Run the smoke verifier after the CSS split**

Run:

```powershell
python .tmp/verify_newtab_extension.py
```

Expected:

```text
PASS, with no selector breakage and no visible behavior regression caused by cascade-order mistakes.
```

- [ ] **Step 8: Commit the stylesheet split**

Run:

```powershell
git add src/pages/newtab/styles/index.css src/pages/newtab/styles/tokens.css src/pages/newtab/styles/base.css src/pages/newtab/styles/scene.css src/pages/newtab/styles/search.css src/pages/newtab/styles/ai-preview.css src/pages/newtab/styles/settings.css src/pages/newtab/styles/responsive.css src/pages/newtab/styles/motion.css
git commit -m "refactor: split newtab styles by ownership"
```

### Task 3: Move DOM lookup ownership and shared runtime state out of `index.mjs`

**Files:**
- Create: `src/pages/newtab/dom-refs.mjs`
- Create: `src/pages/newtab/runtime-state.mjs`
- Modify: `src/pages/newtab/index.mjs`
- Modify if needed: `src/pages/newtab/search-target-controller.mjs`
- Modify if needed: `src/pages/newtab/suggestions-controller.mjs`
- Modify if needed: `src/pages/newtab/ai-preview-controller.mjs`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Create `dom-refs.mjs` and move all page element discovery into one exported factory**

Create:

```js
export const getNewtabDomRefs = () => ({
  search: {
    form: document.getElementById("search-form"),
    input: document.getElementById("search-input"),
    status: document.getElementById("search-status"),
    suggestions: document.getElementById("search-suggestions"),
  },
  targets: {
    trigger: document.getElementById("search-target-trigger"),
    label: document.getElementById("search-target-label"),
    menu: document.getElementById("search-target-menu"),
  },
});
```

- [ ] **Step 2: Create `runtime-state.mjs` and give shared mutable page state a narrow API**

Create:

```js
export const createNewtabRuntimeState = ({ initialSearchTarget }) => {
  let currentSearchTarget = initialSearchTarget;
  let searchHistoryItems = [];

  return {
    getCurrentSearchTarget: () => currentSearchTarget,
    setCurrentSearchTarget: (target) => { currentSearchTarget = target; },
    getSearchHistoryItems: () => searchHistoryItems,
    setSearchHistoryItems: (items) => { searchHistoryItems = Array.isArray(items) ? [...items] : []; },
  };
};
```

- [ ] **Step 3: Rewrite `index.mjs` as a composition root that consumes helpers instead of owning raw state**

Refactor the top of `src/pages/newtab/index.mjs` toward this shape:

```js
import { getNewtabDomRefs } from "./dom-refs.mjs";
import { createNewtabRuntimeState } from "./runtime-state.mjs";

const elements = getNewtabDomRefs();
const runtimeState = createNewtabRuntimeState({
  initialSearchTarget: getSearchTargetById(DEFAULT_SEARCH_TARGET_ID),
});
```

- [ ] **Step 4: Rewire controller callbacks to use helper-owned state instead of top-level variables**

Update callback wiring so controllers read/write through the runtime helper:

```js
getCurrentSearchTarget: () => runtimeState.getCurrentSearchTarget(),
setCurrentSearchTarget: (target) => runtimeState.setCurrentSearchTarget(target),
getSearchHistoryItems: () => runtimeState.getSearchHistoryItems(),
```

- [ ] **Step 5: Keep controller APIs stable unless a tiny cleanup removes duplicated adapter code**

If a small controller signature cleanup is needed, keep it narrow and local, for example:

```js
callbacks: {
  getCurrentSearchTarget,
  setCurrentSearchTarget,
  getSearchHistoryItems,
}
```

Do not rewrite controller internals beyond what the new boundaries require.

- [ ] **Step 6: Re-run the smoke verifier after the JS refactor**

Run:

```powershell
python .tmp/verify_newtab_extension.py
```

Expected:

```text
PASS, with search target switching, suggestions, startup readiness, and AI preview behavior still intact.
```

- [ ] **Step 7: Commit the entrypoint/runtime cleanup**

Run:

```powershell
git add src/pages/newtab/dom-refs.mjs src/pages/newtab/runtime-state.mjs src/pages/newtab/index.mjs src/pages/newtab/search-target-controller.mjs src/pages/newtab/suggestions-controller.mjs src/pages/newtab/ai-preview-controller.mjs
git commit -m "refactor: slim newtab entrypoint"
```

### Task 4: Final verification and regression sweep

**Files:**
- Modify if needed: `.tmp/verify_newtab_extension.py`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Run the end-to-end verifier one more time from the refactored state**

Run:

```powershell
python .tmp/verify_newtab_extension.py
```

Expected:

```text
PASS, with generated screenshots/artifacts confirming the page still renders and behaves correctly.
```

- [ ] **Step 2: Perform a focused manual sweep of the preserved UI contract**

Verify in the newtab page:

```text
1. search input becomes enabled and focused
2. target menu opens, selects, and closes
3. suggestions respond to ArrowUp/ArrowDown/Tab/Enter/Escape
4. AI preview buttons and website cards still work
5. settings popup opens, scrolls, and closes
6. mobile-width layout still keeps controls readable
```

- [ ] **Step 3: Review the diff and reject accidental redesign drift**

Run:

```powershell
git diff -- src/pages/newtab
```

Expected:

```text
The diff shows file moves/splits and small entrypoint cleanup, not unrelated visual or architectural churn.
```

- [ ] **Step 4: Commit the final integrated refactor**

Run:

```powershell
git add .tmp/verify_newtab_extension.py src/pages/newtab
git commit -m "refactor: reorganize newtab styles and runtime"
```

## Self-Review

- Spec coverage: the plan covers the CSS split, the stable stylesheet entry, the `dom-refs.mjs` helper, the `runtime-state.mjs` helper, conservative controller rewiring, and behavior verification.
- Placeholder scan: no `TBD`, `TODO`, or deferred implementation markers remain.
- Type consistency: helper/module names and file names are consistent across all tasks.
