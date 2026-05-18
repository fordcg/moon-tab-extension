# Homepage Background Brand Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the new-tab page’s liquid-glass runtime background with a stable pure-CSS brand foundation while preserving existing search, settings, and AI-sidebar behavior.

**Architecture:** Keep the existing `#homepage-bubble-layer` DOM node as a passive background container, but remove all WebGL/canvas initialization and refresh logic from `src/pages/newtab/index.mjs`. Rebuild the visual system in `src/pages/newtab/styles/index.css` using four static layers—base, paper texture, soft light, and focus—then update the worktree’s `python .tmp/verify_newtab_extension.py` command so it validates the new static background contract instead of requiring a bubble canvas.

**Tech Stack:** Manifest V3 extension, plain HTML/CSS/native ESM, Python Playwright smoke verification, Chromium unpacked-extension loading.

---

## File Structure

### Files to modify
- `.tmp/verify_newtab_extension.py`
  - Restore the worktree’s standard verifier from the repo-root smoke script and make it assert the new static background contract.
- `src/pages/newtab/index.mjs`
  - Remove the liquid-glass import, background runtime initialization, and `window.__HOMEPAGE_BUBBLE_LAYER__` refresh dependency while keeping outline/search/sidebar layout refresh behavior.
- `src/pages/newtab/styles/index.css`
  - Define the static warm-paper background foundation and remove canvas-specific selectors.

### Files to keep unchanged
- `src/pages/newtab/index.html`
  - Keep the existing `#homepage-bubble-layer` node at `src/pages/newtab/index.html:17`; no DOM restructure is needed.
- `src/pages/newtab/settings/index.mjs`
  - Keep settings modal behavior unchanged.
- `src/pages/newtab/startup-controller.mjs`
  - Keep outline-sizing logic unchanged; `index.mjs` will continue calling `startupController.handleResize()`.

### File to delete after references are removed
- `src/pages/newtab/liquid-glass-bubble-layer.mjs`
  - Delete once `src/pages/newtab/index.mjs` and `.tmp/verify_newtab_extension.py` no longer reference the runtime background.

---

### Task 1: Rewrite the worktree verifier to define the new static-background contract

**Files:**
- Modify: `.tmp/verify_newtab_extension.py`
- Reference: `D:/proj/test/.tmp/verify_newtab_extension.py`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Replace the worktree verifier with the current repo-root smoke verifier baseline**

Run:

```bash
cp "D:/proj/test/.tmp/verify_newtab_extension.py" "D:/proj/test/.worktrees/ai-sidebar-mvp/.tmp/verify_newtab_extension.py"
```

Expected:
- `D:/proj/test/.worktrees/ai-sidebar-mvp/.tmp/verify_newtab_extension.py` now matches the repo-root smoke verifier before any static-background-specific edits.

- [ ] **Step 2: Update the readiness check so the page waits for the static background container, not the canvas**

In `D:/proj/test/.worktrees/ai-sidebar-mvp/.tmp/verify_newtab_extension.py`, replace `wait_for_extension_ready` with:

```python
def wait_for_extension_ready(page: Page) -> None:
    page.wait_for_selector("#search-input", timeout=15000)
    page.wait_for_selector("#homepage-bubble-layer", timeout=15000)
    page.wait_for_function(
        """() => {
            const input = document.querySelector('#search-input');
            const layer = document.querySelector('#homepage-bubble-layer');
            return Boolean(input && !input.disabled && layer);
        }""",
        timeout=15000,
    )
```

Expected:
- The verifier no longer blocks on `.homepage-bubble-canvas`.

- [ ] **Step 3: Add a helper that reads the static background foundation state from the page**

Add this helper below `read_extension_storage` in the same file:

```python
def read_background_foundation_state(page: Page) -> dict:
    background_state = page.evaluate(
        """() => {
            const layer = document.querySelector('#homepage-bubble-layer');
            const bodyStyle = getComputedStyle(document.body);
            const bodyBefore = getComputedStyle(document.body, '::before');
            const bodyAfter = getComputedStyle(document.body, '::after');
            const layerBefore = layer ? getComputedStyle(layer, '::before') : null;
            const layerAfter = layer ? getComputedStyle(layer, '::after') : null;

            return {
                layerPresent: Boolean(layer),
                hasCanvas: Boolean(layer?.querySelector('canvas')),
                hasRuntimeHandle: Boolean(window.__HOMEPAGE_BUBBLE_LAYER__),
                bodyBackgroundImage: bodyStyle.backgroundImage,
                bodyBeforeBackgroundImage: bodyBefore.backgroundImage,
                bodyAfterBackgroundImage: bodyAfter.backgroundImage,
                layerBeforeBackgroundImage: layerBefore ? layerBefore.backgroundImage : 'none',
                layerAfterBackgroundImage: layerAfter ? layerAfter.backgroundImage : 'none',
                layerPointerEvents: layer ? getComputedStyle(layer).pointerEvents : 'missing',
                layerOpacity: layer ? getComputedStyle(layer).opacity : 'missing',
                layerFilter: layer ? getComputedStyle(layer).filter : 'missing',
            };
        }"""
    )
    return background_state if isinstance(background_state, dict) else {}
```

Expected:
- The verifier can inspect whether the page is using a passive CSS background instead of a runtime canvas.

- [ ] **Step 4: Replace the old canvas checks with static-background checks in both the result object and required checks**

In the result dictionary inside `main()`, replace the `canvas_present` field with these fields:

```python
"background_foundation": {},
"background_layer_present": False,
"background_has_no_canvas": False,
"background_has_no_runtime_handle": False,
"background_layer_noninteractive": False,
"background_has_texture_overlay": False,
"background_has_focus_overlay": False,
```

Then replace the corresponding `required_checks` entries with:

```python
("background_layer_present", result["background_layer_present"]),
("background_has_no_canvas", result["background_has_no_canvas"]),
("background_has_no_runtime_handle", result["background_has_no_runtime_handle"]),
("background_layer_noninteractive", result["background_layer_noninteractive"]),
("background_has_texture_overlay", result["background_has_texture_overlay"]),
("background_has_focus_overlay", result["background_has_focus_overlay"]),
```

Expected:
- The verifier now defines the new architecture contract instead of requiring a canvas.

- [ ] **Step 5: Populate the new background checks immediately after the extension page opens**

Replace the old `canvas_present` assignment with this block:

```python
result["background_foundation"] = read_background_foundation_state(page)
result["background_layer_present"] = bool(result["background_foundation"].get("layerPresent"))
result["background_has_no_canvas"] = not result["background_foundation"].get("hasCanvas", False)
result["background_has_no_runtime_handle"] = not result["background_foundation"].get("hasRuntimeHandle", False)
result["background_layer_noninteractive"] = result["background_foundation"].get("layerPointerEvents") == "none"
result["background_has_texture_overlay"] = result["background_foundation"].get("layerBeforeBackgroundImage") != "none"
result["background_has_focus_overlay"] = result["background_foundation"].get("layerAfterBackgroundImage") != "none"
result["search_input_enabled"] = page.locator("#search-input").is_enabled()
```

Expected:
- The smoke result captures the exact conditions that should fail before the CSS rewrite is complete.

- [ ] **Step 6: Run the verifier to confirm the current runtime background violates the new contract**

Run:

```bash
python ".tmp/verify_newtab_extension.py"
```

Expected:
- Exit code `1`.
- Failure mentions one or more of:
  - `background_has_no_canvas`
  - `background_has_no_runtime_handle`
  - `background_layer_noninteractive`
  - `background_has_focus_overlay`
- Existing functional checks like settings open/close and default search should still be exercised by the verifier.

---

### Task 2: Remove the runtime background dependency from the homepage entrypoint

**Files:**
- Modify: `src/pages/newtab/index.mjs:1-28`
- Modify: `src/pages/newtab/index.mjs:57,136-157`
- Modify: `src/pages/newtab/index.mjs:434-456`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Remove the liquid-glass import and the unused background root lookup**

In `src/pages/newtab/index.mjs`, delete the liquid-glass import and the `homepageBubbleLayer` constant so the top of the file becomes:

```js
import { createAiPreviewController } from "./ai-preview-controller.mjs";
import { createSuggestionsController } from "./suggestions-controller.mjs";
import { createSearchTargetController } from "./search-target-controller.mjs";
import { createStartupController } from "./startup-controller.mjs";
import { createInteractionsController } from "./interactions-controller.mjs";

const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const searchStatus = document.getElementById("search-status");
const aiSearchIndicator = document.getElementById("ai-search-indicator");
const aiSearchIndicatorText = document.getElementById("ai-search-indicator-text");
const aiToggleButton = document.getElementById("ai-toggle-btn");
const openAiSidebarButton = document.getElementById("open-ai-sidebar");
const aiSearchEnabledInput = document.getElementById("ai-search-enabled");
const aiSearchPreview = document.getElementById("ai-search-preview");
const aiSearchPreviewIntent = document.getElementById("ai-search-preview-intent");
const aiSearchPreviewSummary = document.getElementById("ai-search-preview-summary");
const aiSearchPreviewOriginalQuery = document.getElementById("ai-search-preview-original-query");
const aiSearchPreviewTargetLabel = document.getElementById("ai-search-preview-target-label");
const aiSearchPreviewTarget = document.getElementById("ai-search-preview-target");
const aiSearchPreviewWebsites = document.getElementById("ai-search-preview-websites");
const aiSearchPreviewWebsitesList = document.getElementById("ai-search-preview-websites-list");
const aiSearchPreviewRelated = document.getElementById("ai-search-preview-related");
const aiSearchPreviewSuggestions = document.getElementById("ai-search-preview-suggestions");
const aiSearchPreviewAction = document.getElementById("ai-search-preview-action");
const aiSearchPreviewSecondaryAction = document.getElementById("ai-search-preview-secondary-action");
const searchTargetTrigger = document.getElementById("search-target-trigger");
const searchTargetLabel = document.getElementById("search-target-label");
const searchTargetMenu = document.getElementById("search-target-menu");
const searchSuggestions = document.getElementById("search-suggestions");
const searchFrame = document.querySelector(".outline-search-frame");
const searchOutline = document.querySelector(".outline-search-outline");
const searchOutlineRect = document.querySelector(".outline-search-outline-rect");
```

Expected:
- `index.mjs` no longer imports `./liquid-glass-bubble-layer.mjs`.
- No local variable references `#homepage-bubble-layer` from JS.

- [ ] **Step 2: Simplify homepage layout refresh so it only resizes the search outline**

Replace the old `refreshHomepageLayout` implementation with:

```js
const refreshHomepageLayout = () => {
  startupController.handleResize();
};
```

Keep `scheduleHomepageLayoutRefresh` unchanged so AI sidebar open still does the double `requestAnimationFrame` layout sync for the search outline.

Expected:
- Resize and sidebar-open logic still refresh the outline geometry.
- There is no remaining call to `window.__HOMEPAGE_BUBBLE_LAYER__?.refresh?.()`.

- [ ] **Step 3: Remove the runtime background initialization from the startup block**

Replace the startup tail section with:

```js
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

initializeSettingsUi({
  setSearchStatus,
  syncAiSearchEnabled,
  syncAiSearchActivating,
  syncAiConfigState,
});
syncRenderedSearchUi();
searchTargetController.syncShell();
aiPreviewController.renderIndicator();
void readSearchHistory(extensionApi).then((items) => {
  searchHistoryItems = Array.isArray(items) ? [...items] : [];
});
startupController.initialize({ prefersReducedMotion });

window.addEventListener("resize", () => {
  refreshHomepageLayout();
});
```

Expected:
- `initializeLiquidGlassBubbleLayer(...)` is gone.
- Search, settings, and startup behavior remain intact.

- [ ] **Step 4: Run the verifier again to confirm the runtime canvas dependency is gone but the CSS contract is still incomplete**

Run:

```bash
python ".tmp/verify_newtab_extension.py"
```

Expected:
- Exit code `1`.
- `background_has_no_canvas` and `background_has_no_runtime_handle` now pass.
- Remaining failure should be CSS-side, typically `background_layer_noninteractive` and/or `background_has_focus_overlay`.

---

### Task 3: Build the pure CSS warm-paper background foundation

**Files:**
- Modify: `src/pages/newtab/styles/index.css:1-62`
- Modify: `src/pages/newtab/styles/index.css:73-193`
- Modify: `src/pages/newtab/styles/index.css:1646-1680`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Add explicit custom properties for the static background layers**

In `src/pages/newtab/styles/index.css`, extend the `:root` block by adding these variables after `--transition-standard`:

```css
  --homepage-background-base:
    radial-gradient(132% 118% at 0% 0%, rgba(207, 178, 136, 0.18) 0%, rgba(207, 178, 136, 0) 48%),
    radial-gradient(118% 96% at 100% 0%, rgba(219, 197, 160, 0.16) 0%, rgba(219, 197, 160, 0) 44%),
    linear-gradient(180deg, #fbf6ee 0%, #f6f1e7 34%, #efe7d8 72%, #e7dcc8 100%);
  --homepage-background-grain:
    radial-gradient(circle at 18% 22%, rgba(130, 95, 56, 0.07) 0 1px, transparent 1px 100%),
    radial-gradient(circle at 72% 16%, rgba(171, 132, 87, 0.05) 0 1px, transparent 1px 100%),
    radial-gradient(circle at 42% 78%, rgba(145, 112, 76, 0.04) 0 1px, transparent 1px 100%);
  --homepage-background-ambient:
    radial-gradient(90% 70% at 50% 8%, rgba(255, 247, 231, 0.52) 0%, rgba(255, 247, 231, 0) 62%),
    radial-gradient(110% 96% at 12% 16%, rgba(208, 176, 132, 0.16) 0%, rgba(208, 176, 132, 0) 58%),
    radial-gradient(110% 90% at 88% 18%, rgba(223, 199, 161, 0.14) 0%, rgba(223, 199, 161, 0) 56%);
  --homepage-background-focus:
    radial-gradient(84% 56% at 50% 42%, rgba(255, 249, 238, 0.30) 0%, rgba(255, 249, 238, 0.16) 36%, rgba(255, 249, 238, 0) 72%),
    radial-gradient(120% 92% at 50% 100%, rgba(170, 136, 92, 0.10) 0%, rgba(170, 136, 92, 0.04) 34%, rgba(170, 136, 92, 0) 70%),
    linear-gradient(180deg, rgba(255, 252, 246, 0.18) 0%, rgba(255, 252, 246, 0) 28%, rgba(234, 223, 205, 0.12) 100%);
```

Expected:
- The background system has named layers for base, texture, ambient light, and focus.

- [ ] **Step 2: Replace the existing body and bubble-layer blocks with the new passive foundation styles**

Replace the existing `body`, `body::before`, `body::after`, `.homepage-bubble-layer`, and state selectors with this block:

```css
body {
  position: relative;
  margin: 0;
  overflow-x: hidden;
  font-family: var(--font-sans);
  color: var(--ink-primary);
  background-color: var(--surface-base-0);
  background-image: var(--homepage-background-base);
  background-attachment: fixed;
}

body::before,
body::after {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

body::before {
  background-image: var(--homepage-background-grain);
  background-size: 280px 280px, 360px 360px, 320px 320px;
  opacity: 0.22;
}

body::after {
  background-image: var(--homepage-background-ambient);
  opacity: 0.62;
}

.homepage-bubble-layer {
  position: fixed;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
  opacity: 1;
  transition: opacity 240ms ease, filter 240ms ease;
}

.homepage-bubble-layer::before,
.homepage-bubble-layer::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.homepage-bubble-layer::before {
  background: var(--homepage-background-focus);
  opacity: 1;
}

.homepage-bubble-layer::after {
  background:
    radial-gradient(140% 100% at 50% 50%, rgba(255, 255, 255, 0) 56%, rgba(163, 132, 93, 0.08) 100%),
    radial-gradient(72% 52% at 50% 44%, rgba(255, 250, 242, 0.16) 0%, rgba(255, 250, 242, 0.06) 42%, rgba(255, 250, 242, 0) 74%);
  opacity: 0.92;
}

body.is-settings-open .homepage-bubble-layer {
  opacity: 0.74;
  filter: saturate(0.88) brightness(0.98);
}

body.is-ai-sidebar-open .homepage-bubble-layer {
  opacity: 0.90;
  filter: saturate(0.96) brightness(0.99);
}
```

Expected:
- The background becomes a passive CSS layer.
- The container is non-interactive.
- Both `::before` and `::after` exist so the verifier can detect texture + focus overlays.

- [ ] **Step 3: Delete selectors that only existed for the runtime canvas implementation**

Remove these selectors from `src/pages/newtab/styles/index.css`:

```css
.homepage-bubble-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  will-change: transform, opacity;
}

body.is-ai-search-activating .homepage-bubble-layer,
body.is-ai-search-searching .homepage-bubble-layer {
  opacity: 1;
}

.homepage-bubble-layer.is-paused {
  opacity: 0.5;
}
```

Then remove `.homepage-bubble-canvas` from the reduced-motion transition-disable block so the list ends like this:

```css
@media (prefers-reduced-motion: reduce) {
  .homepage-focus-shell,
  .homepage-brand,
  .homepage-search-stack,
  .homepage-bubble-layer,
  .settings-trigger,
  .settings-backdrop,
  .settings-popup,
  .settings-switch-track,
  .settings-switch-thumb,
  .settings-input,
  .settings-save-button,
  .settings-secondary-button,
  .outline-search-frame,
  .ai-toggle-btn,
  .ai-toggle-coil span,
  .ai-loading-overlay,
  .ai-search-preview-button,
  .ai-search-preview-button-secondary,
  .ai-search-preview-suggestion,
  .ai-search-preview-website-button {
    transition: none;
  }
```

Expected:
- No stylesheet selector assumes a canvas exists.
- The static foundation still respects reduced motion.

- [ ] **Step 4: Run the verifier and make it pass**

Run:

```bash
python ".tmp/verify_newtab_extension.py"
```

Expected:
- Exit code `0`.
- `background_has_no_canvas`, `background_has_no_runtime_handle`, `background_layer_noninteractive`, `background_has_texture_overlay`, and `background_has_focus_overlay` all pass.
- Existing smoke checks for settings open/close, search suggestions, default Bing search, preview generation, and GitHub target switching still pass.

---

### Task 4: Delete the dead runtime module and ship the background rewrite cleanly

**Files:**
- Delete: `src/pages/newtab/liquid-glass-bubble-layer.mjs`
- Modify (already green): `.tmp/verify_newtab_extension.py`
- Modify (already green): `src/pages/newtab/index.mjs`
- Modify (already green): `src/pages/newtab/styles/index.css`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Remove the unused liquid-glass implementation file from the branch**

Run:

```bash
git -C "D:/proj/test/.worktrees/ai-sidebar-mvp" rm "src/pages/newtab/liquid-glass-bubble-layer.mjs"
```

Expected:
- The runtime background file is staged for deletion.
- `src/pages/newtab/index.mjs` is already free of imports to that file.

- [ ] **Step 2: Confirm no production code or primary verifier still references the old runtime background**

Run:

```bash
git -C "D:/proj/test/.worktrees/ai-sidebar-mvp" grep -n "homepage-bubble-canvas\|__HOMEPAGE_BUBBLE_LAYER__\|liquid-glass-bubble-layer" -- src/pages/newtab .tmp/verify_newtab_extension.py
```

Expected:
- No output.

- [ ] **Step 3: Run the worktree verification command one last time after the deletion**

Run:

```bash
python ".tmp/verify_newtab_extension.py"
```

Expected:
- Exit code `0`.
- The verifier still passes after the runtime module is removed from disk.

- [ ] **Step 4: Commit the finished rewrite**

Run:

```bash
git -C "D:/proj/test/.worktrees/ai-sidebar-mvp" add .tmp/verify_newtab_extension.py src/pages/newtab/index.mjs src/pages/newtab/styles/index.css && git -C "D:/proj/test/.worktrees/ai-sidebar-mvp" commit -m "refactor: replace homepage liquid glass background"
```

Expected:
- A new commit exists with the static background foundation, the updated verifier, and the runtime file deletion.

---

## Self-Review

- **Spec coverage:**
  - Pure CSS brand foundation: covered by Task 3.
  - Remove runtime background system: covered by Task 2 and Task 4.
  - Preserve warm-paper palette and quiet focus: covered by Task 3 custom properties and passive layer rules.
  - Preserve search/settings/sidebar behavior: covered by Task 1 verifier + Task 3/4 green runs.
  - Keep future extensibility through passive background container: covered by leaving `#homepage-bubble-layer` in place and moving all responsibility into CSS.

- **Placeholder scan:**
  - No `TBD`, `TODO`, or “similar to” references remain.
  - Each code-changing step includes concrete commands or code blocks.

- **Type consistency:**
  - The verifier uses `background_layer_present`, `background_has_no_canvas`, `background_has_no_runtime_handle`, `background_layer_noninteractive`, `background_has_texture_overlay`, and `background_has_focus_overlay` consistently in both the result object and `required_checks`.
  - `refreshHomepageLayout()` consistently refers only to `startupController.handleResize()` after Task 2.
