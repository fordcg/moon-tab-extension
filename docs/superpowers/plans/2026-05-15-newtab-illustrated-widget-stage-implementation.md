# Newtab Illustrated Widget Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the desktop newtab experience into a bitmap-led illustrated stage while preserving the existing widget runtime, search interactions, AI preview behavior, settings modal, and widget hide/restore flow.

**Architecture:** Keep the current widget runtime and search DOM contracts intact, but replace the decorative system, default layout classes, and surface styling around them. Generate a small asset pack under `src/pages/newtab/assets/`, map widget ids to named desktop stage slots, and restyle the hero/search/widget shells so the runtime still mounts the same interactive nodes inside a new illustrated composition.

**Tech Stack:** HTML, CSS, ES modules, Chrome extension newtab page, existing widget runtime, Playwright-based verifier, imagegen-generated bitmap assets

---

## File Structure

**Create:**
- `src/pages/newtab/assets/hero/desktop-bg-ambient.png` — desktop ambient paper background
- `src/pages/newtab/assets/hero/pet-duo-badge.png` — bitmap cat/dog title badge
- `src/pages/newtab/assets/hero/pet-left-peek.png` — left-side peeking cat
- `src/pages/newtab/assets/hero/pet-right-buddy.png` — right-side companion animal
- `src/pages/newtab/assets/hero/pet-mini-pair.png` — lower-center mini pet sticker
- `src/pages/newtab/assets/hero/cloud-ribbon.png` — soft ribbon-like cloud strip
- `src/pages/newtab/assets/hero/hint-bubble-1.png` — decorative prompt bubble A
- `src/pages/newtab/assets/hero/hint-bubble-2.png` — decorative prompt bubble B
- `src/pages/newtab/assets/hero/paw-accent.png` — paw print accent
- `src/pages/newtab/assets/hero/fish-accent.png` — fish accent
- `src/pages/newtab/assets/hero/bone-accent.png` — bone or toy accent
- `src/pages/newtab/assets/hero/star-sparkle.png` — sparkle accent
- `src/pages/newtab/assets/hero/cloud-puff.png` — cloud accent
- `src/pages/newtab/assets/hero/tape-sticker.png` — tape accent
- `src/pages/newtab/assets/widgets/todo-sticker.png` — todo widget sticker
- `src/pages/newtab/assets/widgets/calendar-sticker.png` — calendar widget sticker
- `src/pages/newtab/assets/widgets/quicksites-sticker.png` — quicksites widget sticker

**Modify:**
- `src/pages/newtab/index.html` — replace current hero ornament structure with image-backed stage layers and desktop composition anchors while preserving ids used by runtime and verifier
- `src/pages/newtab/styles/base.css` — add shared asset, surface, and stage utility styles that belong at the base layer
- `src/pages/newtab/styles/scene.css` — implement desktop-first illustrated layout, search card, widget shells, decorative assets, and panel styling
- `src/pages/newtab/styles/responsive.css` — degrade the stage layout for narrow widths without breaking behavior
- `src/pages/newtab/styles/index.css` — only if needed to keep stylesheet ordering stable after new stage rules are added
- `src/pages/newtab/widgets/widget-shell.mjs` — add slot classes and lighter shell markup hooks without changing current hide control semantics
- `src/pages/newtab/widgets/widget-runtime.mjs` — map widget ids to stage slot classes and keep panel/runtime behavior synchronized
- `src/pages/newtab/widgets/definitions/quicksites-widget.mjs` — update markup hooks for the illustrated quicksites card
- `src/pages/newtab/widgets/definitions/calendar-widget.mjs` — update markup hooks for the illustrated calendar card
- `src/pages/newtab/widgets/definitions/todo-widget.mjs` — update markup hooks for the illustrated todo card
- `.tmp/verify_newtab_extension.py` — extend smoke coverage for bitmap hero treatment and stage composition hooks if needed

**Reference:**
- `docs/superpowers/specs/2026-05-15-newtab-illustrated-widget-stage-design.md`
- `src/pages/newtab/widgets/layout-state.mjs`
- `src/pages/newtab/widgets/registry.mjs`
- `src/pages/newtab/index.mjs`

### Task 1: Generate the bitmap asset pack

**Files:**
- Create: `src/pages/newtab/assets/hero/*.png`
- Create: `src/pages/newtab/assets/widgets/*.png`
- Reference: `docs/superpowers/specs/2026-05-15-newtab-illustrated-widget-stage-design.md`

- [ ] **Step 1: Create the asset directories if they are missing**

Run:

```powershell
Get-ChildItem 'src\pages\newtab\assets' -Force
```

Expected: either the directory already exists or PowerShell reports it is missing so the implementation task can create `hero` and `widgets`.

- [ ] **Step 2: Generate the hero ambient background**

Use `imagegen` with a prompt shaped like:

```text
Use case: ui-mockup
Asset type: browser newtab decorative background
Primary request: Create a warm cream paper-like desktop ambient background for a cute productivity newtab page.
Scene/backdrop: soft matte paper texture, diffuse light haze, warm oat and apricot tones, subtle glowing patches, no hard objects, no text, no interface controls.
Subject: abstract decorative backdrop only
Style: polished illustrated UI backdrop, calm, tactile, airy, not glossy
Composition: wide desktop crop with open central area reserved for a large search card and lighter ornament zones around the upper corners and lower center
Color palette: cream, oat, honey, pale apricot, light caramel
Avoid: no gradients that become muddy, no dark corners, no photoreal furniture, no visible UI
```

Expected output: `src/pages/newtab/assets/hero/desktop-bg-ambient.png`

- [ ] **Step 3: Generate the core animal hero assets**

Use `imagegen` for:

```text
pet-duo-badge.png: rounded cat and dog faces, polished and soft, warm cream palette, transparent-free rectangular export, no text
pet-left-peek.png: peeking cat leaning over a card edge, playful but restrained, same palette
pet-right-buddy.png: companion animal near a small calendar note, soft rounded face, same palette
pet-mini-pair.png: tiny paired pets as a small sticker-like accent for the lower center
```

Expected output files:

```text
src/pages/newtab/assets/hero/pet-duo-badge.png
src/pages/newtab/assets/hero/pet-left-peek.png
src/pages/newtab/assets/hero/pet-right-buddy.png
src/pages/newtab/assets/hero/pet-mini-pair.png
```

- [ ] **Step 4: Generate prompt bubbles and ambient ornaments**

Use `imagegen` for:

```text
cloud-ribbon.png: soft drifting illustrated ribbon cloud, cream-white, translucent feel
hint-bubble-1.png and hint-bubble-2.png: rounded sticker-like prompt bubbles without legible text
paw-accent.png, fish-accent.png, bone-accent.png, star-sparkle.png, cloud-puff.png, tape-sticker.png: small isolated decorative accents matching the same palette
```

Expected output: all listed files exist under `src/pages/newtab/assets/hero/`.

- [ ] **Step 5: Generate widget sticker accents**

Use `imagegen` for:

```text
todo-sticker.png: small checklist-style sticker accent
calendar-sticker.png: small monthly sticker accent
quicksites-sticker.png: small favorites-icon sticker accent
```

Expected output: all listed files exist under `src/pages/newtab/assets/widgets/`.

- [ ] **Step 6: Verify the generated asset set is complete**

Run:

```powershell
Get-ChildItem 'src\pages\newtab\assets\hero' | Select-Object Name
Get-ChildItem 'src\pages\newtab\assets\widgets' | Select-Object Name
```

Expected: all asset filenames from the file structure section are present.

- [ ] **Step 7: Commit**

```bash
git add src/pages/newtab/assets/hero src/pages/newtab/assets/widgets
git commit -m "feat: add illustrated newtab asset pack"
```

### Task 2: Replace the hero ornament structure with stage-layer markup

**Files:**
- Modify: `src/pages/newtab/index.html`
- Modify: `src/pages/newtab/styles/base.css`
- Reference: `src/pages/newtab/index.mjs`

- [ ] **Step 1: Write the failing DOM smoke expectation**

Add verifier checks in `.tmp/verify_newtab_extension.py` later, but first define the required DOM targets in the plan:

```python
stage = page.locator("#homepage-stage")
assert await stage.count() == 1
assert await page.locator("[data-stage-asset='pet-duo']").count() == 1
assert await page.locator("[data-stage-bubble='left']").count() == 1
```

Expected: these selectors do not exist yet in the current markup.

- [ ] **Step 2: Run the verifier to confirm the new stage selectors are absent**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected: current verifier passes existing checks, but the new stage selectors described above would fail if added now.

- [ ] **Step 3: Update `index.html` to add a stage wrapper and bitmap-backed decorative layers**

Create markup shaped like:

```html
<section id="homepage-stage" class="homepage-stage" aria-label="新标签页搜索">
  <div class="homepage-stage__ambient" aria-hidden="true"></div>
  <div class="homepage-stage__decor" aria-hidden="true">
    <img data-stage-asset="pet-duo" class="homepage-stage__pet-duo" src="./assets/hero/pet-duo-badge.png" alt="" />
    <img data-stage-bubble="left" class="homepage-stage__bubble homepage-stage__bubble--left" src="./assets/hero/hint-bubble-1.png" alt="" />
    <img data-stage-bubble="center" class="homepage-stage__bubble homepage-stage__bubble--center" src="./assets/hero/hint-bubble-2.png" alt="" />
    <img data-stage-bubble="right" class="homepage-stage__bubble homepage-stage__bubble--right" src="./assets/hero/hint-bubble-1.png" alt="" />
  </div>
  <section class="homepage-focus-shell layout-newtab-hero" aria-label="主页搜索区域">
```

Keep these ids untouched:

```html
id="widget-root"
id="open-widget-panel"
id="widget-panel"
id="widget-panel-status"
id="widget-panel-list"
```

- [ ] **Step 4: Add base shared image and stage utility rules**

Add base CSS shaped like:

```css
.homepage-stage img[alt=""] {
  user-select: none;
  -webkit-user-drag: none;
}

.homepage-stage [aria-hidden="true"] {
  pointer-events: none;
}

.homepage-stage__ambient,
.homepage-stage__decor {
  position: absolute;
  inset: 0;
}
```

- [ ] **Step 5: Run the verifier to ensure existing ids still mount**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected: `widget_root_present`, `widget_add_button_present`, and `widget_hide_restore_ok` still pass.

- [ ] **Step 6: Commit**

```bash
git add src/pages/newtab/index.html src/pages/newtab/styles/base.css
git commit -m "refactor: add newtab stage markup"
```

### Task 3: Map widget runtime output to named desktop stage slots

**Files:**
- Modify: `src/pages/newtab/widgets/widget-shell.mjs`
- Modify: `src/pages/newtab/widgets/widget-runtime.mjs`
- Reference: `src/pages/newtab/widgets/layout-state.mjs`

- [ ] **Step 1: Write the failing runtime expectation for slot classes**

Use a small verifier/read-state assertion shaped like:

```python
slot_ids = await page.locator("[data-widget-id='search']").get_attribute("data-widget-slot")
assert slot_ids == "center"
```

Expected: current runtime does not assign slot metadata yet.

- [ ] **Step 2: Run the verifier or a focused browser check to confirm slot metadata is absent**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected: existing checks pass, but no `data-widget-slot` attributes exist yet.

- [ ] **Step 3: Add slot metadata to the widget shell**

Update shell creation so article markup can accept stage hooks:

```js
article.dataset.widgetId = widget.id;
article.dataset.widgetSlot = "stack";
article.classList.add("homepage-widget-card");
```

Keep existing hide button semantics unchanged:

```js
button.dataset.widgetAction = "hide";
```

- [ ] **Step 4: Assign named slots in the runtime by widget id**

Add a helper in `widget-runtime.mjs` shaped like:

```js
const DESKTOP_STAGE_SLOT_BY_WIDGET_ID = Object.freeze({
  search: "center",
  todo: "left-lower",
  calendar: "right-lower",
  quicksites: "lower-center",
});

const applyStageSlot = ({ article, widgetId }) => {
  article.dataset.widgetSlot = DESKTOP_STAGE_SLOT_BY_WIDGET_ID[widgetId] ?? "stack";
};
```

Call it from `ensureWidgetCard(widget)` after shell creation and before append.

- [ ] **Step 5: Preserve restore behavior by reusing the same slot assignment after every mutation**

Keep the current mutation path:

```js
currentLayout = await mutator({
  layout: currentLayout,
  widgetId,
  registryItems,
});
render();
```

Expected: restored widgets come back in their named stage slot because the slot derives from `widget.id`, not transient order.

- [ ] **Step 6: Run the verifier to ensure runtime behavior still passes**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected: hide/restore, search widget visibility, and settings checks still pass.

- [ ] **Step 7: Commit**

```bash
git add src/pages/newtab/widgets/widget-shell.mjs src/pages/newtab/widgets/widget-runtime.mjs
git commit -m "feat: map newtab widgets to stage slots"
```

### Task 4: Restyle the search card into the central illustrated paper slab

**Files:**
- Modify: `src/pages/newtab/styles/scene.css`
- Modify: `src/pages/newtab/index.html`
- Reference: `src/pages/newtab/index.mjs`

- [ ] **Step 1: Write the failing visual contract as measurable CSS expectations**

Use a verifier snippet shaped like:

```python
frame = page.locator(".outline-search-frame")
box = await frame.bounding_box()
assert box["width"] >= 760
assert box["height"] <= 260
```

Expected: current card proportions are not yet tuned to the wide illustrated slab target.

- [ ] **Step 2: Run the verifier to capture current dimensions**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected: existing search checks pass, but the current desktop proportions remain pre-redesign.

- [ ] **Step 3: Replace the current geometric search-shell look with paper-card styling**

Add CSS shaped like:

```css
.outline-search-frame {
  border: 1px solid rgba(224, 191, 146, 0.92);
  border-radius: 30px;
  background:
    linear-gradient(180deg, rgba(255, 252, 245, 0.98) 0%, rgba(255, 245, 229, 0.96) 100%);
  box-shadow:
    0 22px 48px rgba(145, 103, 57, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
}
```

Reduce or remove the old strong SVG-outline emphasis without deleting required DOM nodes used by the verifier.

- [ ] **Step 4: Restyle the control rail and search target chip**

Add CSS shaped like:

```css
.search-shell-actions .ui-btn-primary,
.search-shell-actions .ui-btn-secondary,
.search-shell-actions .ui-btn-icon,
.search-target-trigger {
  border-radius: 999px;
  background: rgba(255, 248, 236, 0.96);
  border: 1px solid rgba(227, 198, 156, 0.88);
  box-shadow: 0 4px 10px rgba(151, 112, 66, 0.08);
}
```

Keep existing ids:

```html
id="ai-toggle-btn"
id="open-ai-sidebar"
id="open-settings"
id="search-target-trigger"
```

- [ ] **Step 5: Tune title placement so it sits visually on the search card shoulder**

Shift the title block with CSS such as:

```css
.homepage-title-band {
  position: relative;
  width: min(100%, 980px);
  margin: 0 auto -0.4rem;
  z-index: 2;
}
```

Expected: the title feels attached to the hero slab rather than detached above it.

- [ ] **Step 6: Run the verifier and inspect the screenshot output**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected: all search behavior checks still pass and the screenshot artifacts update under `.tmp/`.

- [ ] **Step 7: Commit**

```bash
git add src/pages/newtab/index.html src/pages/newtab/styles/scene.css
git commit -m "feat: restyle newtab search card"
```

### Task 5: Turn companion widgets into illustrated floating note cards

**Files:**
- Modify: `src/pages/newtab/widgets/definitions/todo-widget.mjs`
- Modify: `src/pages/newtab/widgets/definitions/calendar-widget.mjs`
- Modify: `src/pages/newtab/widgets/definitions/quicksites-widget.mjs`
- Modify: `src/pages/newtab/styles/scene.css`

- [ ] **Step 1: Write the failing widget markup hooks**

Define the target shape:

```js
section.className = "widget-note widget-note--todo";
section.innerHTML = "";
```

Expected: current widget definitions do not yet expose illustrated-card-specific hooks.

- [ ] **Step 2: Run the verifier to confirm the current widget flow is stable before restyling**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected: current widget visibility and restore flow pass before visual changes.

- [ ] **Step 3: Update `todo-widget.mjs` to expose handwritten-note structure**

Use DOM code shaped like:

```js
const section = documentRef.createElement("section");
section.className = "widget-note widget-note--todo";

const sticker = documentRef.createElement("img");
sticker.className = "widget-note__sticker";
sticker.src = "./assets/widgets/todo-sticker.png";
sticker.alt = "";

const list = documentRef.createElement("div");
list.className = "widget-note__list";
```

- [ ] **Step 4: Update `calendar-widget.mjs` and `quicksites-widget.mjs` with equivalent illustrated hooks**

Use structures shaped like:

```js
section.className = "widget-note widget-note--calendar";
section.className = "widget-note widget-note--quicksites";
```

and add a decorative `<img>` per widget using the generated sticker assets.

- [ ] **Step 5: Add floating note styling in `scene.css`**

Add CSS shaped like:

```css
.homepage-widget-card[data-widget-slot='left-lower'],
.homepage-widget-card[data-widget-slot='right-lower'],
.homepage-widget-card[data-widget-slot='lower-center'] {
  position: absolute;
  border-radius: 24px;
  background: linear-gradient(180deg, rgba(255, 252, 246, 0.98) 0%, rgba(255, 244, 229, 0.96) 100%);
  box-shadow: 0 16px 34px rgba(145, 103, 57, 0.12);
}
```

- [ ] **Step 6: Run the verifier to ensure hide/restore is unaffected by the new markup**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected: `widget_hide_restore_ok` remains true.

- [ ] **Step 7: Commit**

```bash
git add src/pages/newtab/widgets/definitions/todo-widget.mjs src/pages/newtab/widgets/definitions/calendar-widget.mjs src/pages/newtab/widgets/definitions/quicksites-widget.mjs src/pages/newtab/styles/scene.css
git commit -m "feat: restyle newtab companion widgets"
```

### Task 6: Add desktop decorative asset placement and panel restyling

**Files:**
- Modify: `src/pages/newtab/styles/scene.css`
- Modify: `src/pages/newtab/styles/base.css`
- Modify: `src/pages/newtab/index.html`

- [ ] **Step 1: Write the failing decorative asset expectations**

Use verifier selectors shaped like:

```python
assert await page.locator("[data-stage-bubble='left']").is_visible()
assert await page.locator("[data-stage-asset='pet-duo']").is_visible()
```

Expected: after Task 2 markup exists, these selectors should still need precise positioning and visibility tuning.

- [ ] **Step 2: Position ambient images and side-animal assets for desktop**

Add CSS shaped like:

```css
.homepage-stage__pet-duo {
  position: absolute;
  left: 18%;
  top: 16%;
  width: 120px;
}

.homepage-stage__bubble--left { left: 6%; top: 9%; }
.homepage-stage__bubble--center { left: 34%; top: 6%; }
.homepage-stage__bubble--right { right: 7%; top: 9%; }
```

Also place `pet-left-peek`, `pet-right-buddy`, `pet-mini-pair`, `cloud-ribbon`, and the accent assets with non-interfering `z-index` values.

- [ ] **Step 3: Restyle the widget panel to match the paper system**

Add CSS shaped like:

```css
.widget-panel {
  border-radius: 24px;
  background: linear-gradient(180deg, rgba(255, 252, 246, 0.98) 0%, rgba(255, 244, 229, 0.96) 100%);
  box-shadow: 0 18px 36px rgba(145, 103, 57, 0.12);
}
```

Keep the current panel ids and action selectors unchanged.

- [ ] **Step 4: Ensure decorative assets do not occlude inputs or action buttons**

Use CSS constraints shaped like:

```css
.homepage-stage__decor {
  z-index: 0;
}

.homepage-focus-shell,
.homepage-widget-card,
.widget-panel {
  position: relative;
  z-index: 2;
}
```

- [ ] **Step 5: Run the verifier and inspect the saved screenshot**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected: runtime checks pass and the screenshot shows the intended decorative framing without control overlap.

- [ ] **Step 6: Commit**

```bash
git add src/pages/newtab/index.html src/pages/newtab/styles/base.css src/pages/newtab/styles/scene.css
git commit -m "feat: add illustrated newtab stage decor"
```

### Task 7: Simplify narrow-width behavior and finalize verification coverage

**Files:**
- Modify: `src/pages/newtab/styles/responsive.css`
- Modify: `.tmp/verify_newtab_extension.py`
- Modify: `src/pages/newtab/styles/index.css` (only if needed)

- [ ] **Step 1: Add failing narrow-width and asset-smoke assertions**

Add verifier logic shaped like:

```python
stage_asset = page.locator("[data-stage-asset='pet-duo']")
assert await stage_asset.count() == 1
```

Optionally add a second viewport pass only if the verifier already has a clean mobile hook. Do not overexpand test scope if that makes the smoke brittle.

- [ ] **Step 2: Collapse the desktop stage into a clean vertical flow under narrow widths**

Add CSS shaped like:

```css
@media (max-width: 980px) {
  .homepage-widget-card[data-widget-slot] {
    position: relative;
    inset: auto;
    width: 100%;
    max-width: none;
  }

  .homepage-stage__bubble,
  .homepage-stage__pet-left,
  .homepage-stage__pet-right,
  .homepage-stage__pet-mini {
    display: none;
  }
}
```

- [ ] **Step 3: Extend the verifier only for stable illustrated-stage checks**

Add assertions shaped like:

```python
hero_stage_present = await page.locator("#homepage-stage").count() == 1
pet_badge_present = await page.locator("[data-stage-asset='pet-duo']").count() == 1
```

Avoid pixel-perfect screenshot assertions; keep the checks structural and resilient.

- [ ] **Step 4: Run the final verifier**

Run:

```bash
python .tmp/verify_newtab_extension.py
```

Expected: PASS with widget runtime, hide/restore flow, malformed-layout recovery, search interactions, settings modal, AI preview, and illustrated-stage smoke all green.

- [ ] **Step 5: Commit**

```bash
git add src/pages/newtab/styles/responsive.css .tmp/verify_newtab_extension.py src/pages/newtab/styles/index.css
git commit -m "chore: finalize illustrated newtab verification"
```

## Self-Review

- Spec coverage: covered bitmap asset generation, stage composition, widget slot mapping, search card restyling, companion widget redesign, panel styling, responsive fallback, and verification.
- Placeholder scan: no `TODO`, `TBD`, or cross-task shorthand remains.
- Type consistency: keeps existing ids and runtime contracts such as `widget-root`, `open-widget-panel`, `data-widget-action='hide'`, `data-widget-panel-action='restore'`, and `data-widget-id`.
