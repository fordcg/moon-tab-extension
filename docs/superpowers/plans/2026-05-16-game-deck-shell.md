# GAME DECK Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone `GAME DECK` extension page with a minimal cyber game-launcher header and animated navigation between it and the existing pet new-tab page.

**Architecture:** Keep the pet page as the default new-tab target and add a second static ESM page under `src/pages/game/`. Use one shared transition helper in `src/shared/page-transition.mjs` so both pages use the same overlay timing, reduced-motion behavior, and navigation flow.

**Tech Stack:** Manifest V3 extension, plain HTML, CSS, native ESM JavaScript, Chrome extension runtime URLs, Playwright smoke verification.

---

## File Structure

- Create `src/shared/page-transition.mjs`: shared function to create a full-screen transition overlay, animate it, then call a navigation callback.
- Create `src/pages/game/index.html`: standalone game page shell containing only `GAME DECK`, return button, compact search, clock, and status.
- Create `src/pages/game/index.css`: cyber terminal styling, scanline layer, header layout, focus states, and reduced-motion rules.
- Create `src/pages/game/index.mjs`: game page clock, search submit, and return-to-pet-page transition.
- Modify `src/pages/newtab/index.html`: add the `游戏空间` action to the existing manage menu.
- Modify `src/pages/newtab/index.mjs`: bind the new action to the shared transition helper and navigate to the game page.
- Modify `.tmp/verify_newtab_extension.py`: extend the smoke test only enough to verify the game page opens, renders the header shell, and returns to the pet page.

---

### Task 1: Shared Transition Helper

**Files:**
- Create: `src/shared/page-transition.mjs`

- [ ] **Step 1: Create the transition helper**

Create `src/shared/page-transition.mjs` with:

```js
const DEFAULT_DURATION_MS = 360;
const REDUCED_MOTION_DURATION_MS = 120;

const getDocument = (documentRef) => documentRef ?? document;

const getPrefersReducedMotion = (windowRef) =>
  Boolean(windowRef?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

const removeExistingOverlay = (documentRef) => {
  documentRef.querySelector("[data-page-transition-overlay]")?.remove();
};

const createOverlay = ({ documentRef, label, mode }) => {
  const overlay = documentRef.createElement("div");
  overlay.className = "page-transition-overlay";
  overlay.dataset.pageTransitionOverlay = "true";
  overlay.dataset.mode = mode;
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");

  const frame = documentRef.createElement("div");
  frame.className = "page-transition-overlay__frame";

  const scan = documentRef.createElement("div");
  scan.className = "page-transition-overlay__scan";
  scan.setAttribute("aria-hidden", "true");

  const text = documentRef.createElement("p");
  text.className = "page-transition-overlay__label";
  text.textContent = label;

  frame.append(scan, text);
  overlay.appendChild(frame);
  return overlay;
};

export const runPageTransition = async ({
  documentRef,
  windowRef,
  label,
  mode = "enter-game",
  onComplete,
}) => {
  const resolvedDocument = getDocument(documentRef);
  const resolvedWindow = windowRef ?? window;
  const prefersReducedMotion = getPrefersReducedMotion(resolvedWindow);
  const duration = prefersReducedMotion ? REDUCED_MOTION_DURATION_MS : DEFAULT_DURATION_MS;

  removeExistingOverlay(resolvedDocument);
  const overlay = createOverlay({
    documentRef: resolvedDocument,
    label,
    mode,
  });
  if (prefersReducedMotion) {
    overlay.dataset.reducedMotion = "true";
  }

  resolvedDocument.body.appendChild(overlay);
  resolvedWindow.requestAnimationFrame(() => {
    overlay.dataset.state = "active";
  });

  await new Promise((resolve) => {
    resolvedWindow.setTimeout(resolve, duration);
  });

  if (typeof onComplete === "function") {
    onComplete();
    return;
  }

  overlay.remove();
};
```

- [ ] **Step 2: Confirm helper has no syntax errors**

Run:

```powershell
node --check src/shared/page-transition.mjs
```

Expected: exits with code 0 and prints no syntax error.

---

### Task 2: Pet Page Game Entry

**Files:**
- Modify: `src/pages/newtab/index.html`
- Modify: `src/pages/newtab/index.mjs`

- [ ] **Step 1: Add the game action to the manage menu**

In `src/pages/newtab/index.html`, inside `.homepage-manage-popover`, add this button after the `编辑布局` button and before `AI 侧栏`:

```html
<button
  id="open-game-deck"
  class="homepage-manage-item"
  type="button"
  aria-label="打开游戏空间"
>
  游戏空间
</button>
```

- [ ] **Step 2: Import the transition helper**

In `src/pages/newtab/index.mjs`, add this import near the other imports:

```js
import { runPageTransition } from "../../shared/page-transition.mjs";
```

- [ ] **Step 3: Bind the game action**

In `src/pages/newtab/index.mjs`, after the `openAiSidebarButton` listener, add:

```js
const openGameDeckButton = document.getElementById("open-game-deck");
openGameDeckButton?.addEventListener("click", () => {
  const gameDeckUrl = extensionApi?.runtime?.getURL
    ? extensionApi.runtime.getURL("src/pages/game/index.html")
    : "./../game/index.html";

  void runPageTransition({
    documentRef: document,
    windowRef: window,
    label: "INITIALIZING GAME DECK",
    mode: "enter-game",
    onComplete: () => {
      window.location.href = gameDeckUrl;
    },
  });
});
```

- [ ] **Step 4: Confirm newtab module syntax**

Run:

```powershell
node --check src/pages/newtab/index.mjs
```

Expected: exits with code 0 and prints no syntax error.

---

### Task 3: Shared Transition CSS On Pet Page

**Files:**
- Modify: `src/pages/newtab/styles/index.css`

- [ ] **Step 1: Add transition overlay styles**

Append this CSS to `src/pages/newtab/styles/index.css`:

```css
.page-transition-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at 50% 45%, rgba(0, 255, 65, 0.16), transparent 34%),
    linear-gradient(135deg, rgba(2, 8, 7, 0.98), rgba(0, 0, 0, 0.96));
  color: #00ff41;
  opacity: 0;
  transform: scale(1.015);
  pointer-events: none;
  transition:
    opacity 240ms ease,
    transform 360ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.page-transition-overlay[data-state="active"] {
  opacity: 1;
  transform: scale(1);
}

.page-transition-overlay__frame {
  position: relative;
  min-width: min(520px, calc(100vw - 40px));
  min-height: 112px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(0, 255, 65, 0.55);
  background: rgba(0, 16, 6, 0.72);
  box-shadow:
    0 0 28px rgba(0, 255, 65, 0.16),
    inset 0 0 24px rgba(0, 255, 65, 0.08);
  overflow: hidden;
}

.page-transition-overlay__scan {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(0, 243, 255, 0.34), transparent);
  transform: translateX(-120%);
  animation: page-transition-scan 720ms cubic-bezier(0.2, 0.8, 0.2, 1) infinite;
}

.page-transition-overlay__label {
  position: relative;
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  font-size: clamp(0.86rem, 2vw, 1.08rem);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  text-shadow: 0 0 12px rgba(0, 255, 65, 0.72);
}

@keyframes page-transition-scan {
  from {
    transform: translateX(-120%);
  }

  to {
    transform: translateX(120%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .page-transition-overlay,
  .page-transition-overlay__scan {
    transition-duration: 120ms;
    animation: none;
  }
}
```

- [ ] **Step 2: Confirm the CSS selector exists**

Run:

```powershell
rg "page-transition-overlay" src/pages/newtab/styles/index.css
```

Expected: multiple matching selectors are printed.

---

### Task 4: Game Page Shell

**Files:**
- Create: `src/pages/game/index.html`
- Create: `src/pages/game/index.css`
- Create: `src/pages/game/index.mjs`

- [ ] **Step 1: Create game page HTML**

Create `src/pages/game/index.html` with:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <title>GAME DECK</title>
    <link rel="stylesheet" href="./index.css" />
  </head>
  <body>
    <div class="game-scanlines" aria-hidden="true"></div>
    <main class="game-deck-shell" aria-label="游戏空间">
      <header class="game-deck-topbar">
        <button id="return-pet-page" class="game-deck-back" type="button">返回宠物页</button>

        <form id="game-search-form" class="game-search" autocomplete="off">
          <label class="game-search__label" for="game-search-input">搜索</label>
          <input
            id="game-search-input"
            class="game-search__input"
            name="q"
            type="search"
            placeholder="SEARCH WEB"
          />
          <button class="game-search__button" type="submit">RUN</button>
        </form>

        <div class="game-deck-status" aria-live="polite">
          <time id="game-clock" class="game-deck-clock">00:00:00</time>
          <span class="game-deck-state">SYSTEM READY</span>
        </div>
      </header>

      <section class="game-deck-title" aria-labelledby="game-deck-title">
        <p class="game-deck-kicker">GAME SPACE</p>
        <h1 id="game-deck-title">GAME DECK</h1>
      </section>
    </main>
    <script type="module" src="./index.mjs"></script>
  </body>
</html>
```

- [ ] **Step 2: Create game page CSS**

Create `src/pages/game/index.css` with:

```css
:root {
  color-scheme: dark;
  --game-bg: #030504;
  --game-surface: rgba(0, 18, 8, 0.78);
  --game-primary: #00ff41;
  --game-primary-dim: #008f11;
  --game-cyan: #00f3ff;
  --game-text: #d7ffe0;
  --game-muted: rgba(215, 255, 224, 0.62);
  --game-border: rgba(0, 255, 65, 0.42);
  --game-focus: rgba(0, 243, 255, 0.88);
}

* {
  box-sizing: border-box;
}

html,
body {
  min-height: 100%;
}

body {
  margin: 0;
  min-height: 100dvh;
  background:
    radial-gradient(circle at 24% 18%, rgba(0, 243, 255, 0.12), transparent 28%),
    radial-gradient(circle at 82% 12%, rgba(0, 255, 65, 0.13), transparent 26%),
    linear-gradient(135deg, #020302, var(--game-bg) 52%, #000);
  color: var(--game-text);
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  overflow-x: hidden;
}

button,
input {
  font: inherit;
}

button {
  cursor: pointer;
}

:focus-visible {
  outline: 2px solid var(--game-focus);
  outline-offset: 3px;
}

.game-scanlines {
  position: fixed;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  background: linear-gradient(
    to bottom,
    transparent,
    transparent 50%,
    rgba(0, 0, 0, 0.2) 50%,
    rgba(0, 0, 0, 0.2)
  );
  background-size: 100% 4px;
  opacity: 0.45;
}

.game-deck-shell {
  min-height: 100dvh;
  display: grid;
  grid-template-rows: auto 1fr;
  padding: clamp(16px, 2.2vw, 28px);
  position: relative;
  z-index: 2;
}

.game-deck-topbar {
  min-height: 64px;
  display: grid;
  grid-template-columns: auto minmax(220px, 520px) auto;
  gap: 16px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--game-border);
  background: rgba(0, 0, 0, 0.72);
  box-shadow:
    0 0 22px rgba(0, 255, 65, 0.08),
    inset 0 0 18px rgba(0, 255, 65, 0.05);
  backdrop-filter: blur(6px);
}

.game-deck-back,
.game-search__button {
  min-height: 44px;
  border: 1px solid var(--game-border);
  background: transparent;
  color: var(--game-primary);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  transition:
    background-color 180ms ease,
    color 180ms ease,
    box-shadow 180ms ease,
    transform 180ms ease;
}

.game-deck-back {
  padding: 0 16px;
}

.game-deck-back:hover,
.game-search__button:hover {
  background: var(--game-primary);
  color: #020302;
  box-shadow: 0 0 16px rgba(0, 255, 65, 0.45);
}

.game-deck-back:active,
.game-search__button:active {
  transform: scale(0.98);
}

.game-search {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  min-height: 46px;
  border: 1px solid rgba(0, 143, 17, 0.72);
  background: rgba(0, 16, 5, 0.74);
}

.game-search__label {
  padding: 0 12px;
  color: var(--game-cyan);
  font-size: 0.78rem;
  letter-spacing: 0.12em;
}

.game-search__input {
  min-width: 0;
  height: 44px;
  border: 0;
  border-left: 1px solid rgba(0, 143, 17, 0.55);
  background: transparent;
  color: var(--game-text);
  padding: 0 12px;
  outline: 0;
}

.game-search__input::placeholder {
  color: rgba(215, 255, 224, 0.36);
}

.game-search__button {
  height: 44px;
  min-width: 72px;
  border-width: 0 0 0 1px;
}

.game-deck-status {
  justify-self: end;
  display: grid;
  gap: 2px;
  text-align: right;
  white-space: nowrap;
}

.game-deck-clock {
  color: var(--game-primary);
  font-size: 1rem;
  text-shadow: 0 0 10px rgba(0, 255, 65, 0.55);
}

.game-deck-state {
  color: var(--game-muted);
  font-size: 0.72rem;
  letter-spacing: 0.14em;
}

.game-deck-title {
  align-self: center;
  justify-self: center;
  text-align: center;
  transform: translateY(-3vh);
}

.game-deck-kicker {
  margin: 0 0 12px;
  color: var(--game-cyan);
  font-size: clamp(0.78rem, 1.6vw, 0.96rem);
  letter-spacing: 0.24em;
  text-transform: uppercase;
}

.game-deck-title h1 {
  margin: 0;
  color: var(--game-primary);
  font-size: clamp(3.5rem, 12vw, 9rem);
  line-height: 0.9;
  letter-spacing: 0.08em;
  text-shadow:
    0 0 8px rgba(0, 255, 65, 0.8),
    0 0 34px rgba(0, 255, 65, 0.26);
}

.page-transition-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at 50% 45%, rgba(0, 255, 65, 0.16), transparent 34%),
    linear-gradient(135deg, rgba(2, 8, 7, 0.98), rgba(0, 0, 0, 0.96));
  color: var(--game-primary);
  opacity: 0;
  transform: scale(1.015);
  pointer-events: none;
  transition:
    opacity 240ms ease,
    transform 360ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.page-transition-overlay[data-state="active"] {
  opacity: 1;
  transform: scale(1);
}

.page-transition-overlay__frame {
  position: relative;
  min-width: min(520px, calc(100vw - 40px));
  min-height: 112px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(0, 255, 65, 0.55);
  background: rgba(0, 16, 6, 0.72);
  box-shadow:
    0 0 28px rgba(0, 255, 65, 0.16),
    inset 0 0 24px rgba(0, 255, 65, 0.08);
  overflow: hidden;
}

.page-transition-overlay__scan {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(0, 243, 255, 0.34), transparent);
  transform: translateX(-120%);
  animation: page-transition-scan 720ms cubic-bezier(0.2, 0.8, 0.2, 1) infinite;
}

.page-transition-overlay__label {
  position: relative;
  margin: 0;
  font-size: clamp(0.86rem, 2vw, 1.08rem);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  text-shadow: 0 0 12px rgba(0, 255, 65, 0.72);
}

@keyframes page-transition-scan {
  from {
    transform: translateX(-120%);
  }

  to {
    transform: translateX(120%);
  }
}

@media (max-width: 820px) {
  .game-deck-topbar {
    grid-template-columns: 1fr;
  }

  .game-deck-status {
    justify-self: stretch;
    text-align: left;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 120ms !important;
    animation: none !important;
  }
}
```

- [ ] **Step 3: Create game page JavaScript**

Create `src/pages/game/index.mjs` with:

```js
import { runPageTransition } from "../../shared/page-transition.mjs";

const clock = document.getElementById("game-clock");
const searchForm = document.getElementById("game-search-form");
const searchInput = document.getElementById("game-search-input");
const returnButton = document.getElementById("return-pet-page");
const extensionApi = typeof chrome !== "undefined" ? chrome : null;

const formatTime = (date) =>
  new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);

const updateClock = () => {
  if (clock instanceof HTMLTimeElement) {
    const now = new Date();
    clock.textContent = formatTime(now);
    clock.dateTime = now.toISOString();
  }
};

const buildPetPageUrl = () =>
  extensionApi?.runtime?.getURL
    ? extensionApi.runtime.getURL("src/pages/newtab/index.html")
    : "./../newtab/index.html";

const runBingSearch = (query) => {
  window.location.href = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
};

searchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!(searchInput instanceof HTMLInputElement)) {
    return;
  }

  const query = searchInput.value.trim();
  if (!query) {
    searchInput.focus();
    return;
  }

  runBingSearch(query);
});

returnButton?.addEventListener("click", () => {
  void runPageTransition({
    documentRef: document,
    windowRef: window,
    label: "RETURNING TO PET DECK",
    mode: "return-pet",
    onComplete: () => {
      window.location.href = buildPetPageUrl();
    },
  });
});

updateClock();
window.setInterval(updateClock, 1000);
```

- [ ] **Step 4: Confirm game module syntax**

Run:

```powershell
node --check src/pages/game/index.mjs
```

Expected: exits with code 0 and prints no syntax error.

---

### Task 5: Focused Verification

**Files:**
- Modify: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Extend the smoke test to cover the game page shell**

Add checks after the existing newtab page render assertion:

```python
    await page.get_by_role("button", name="打开页面管理菜单").click()
    await page.get_by_role("button", name="打开游戏空间").click()
    await expect(page.get_by_role("heading", name="GAME DECK")).to_be_visible()
    await expect(page.get_by_role("button", name="返回宠物页")).to_be_visible()
    await expect(page.get_by_label("搜索")).to_be_visible()
    await expect(page.get_by_text("SYSTEM READY")).to_be_visible()

    await page.get_by_role("button", name="返回宠物页").click()
    await expect(page.locator("#homepage-stage")).to_be_visible()
```

If the current verifier structure does not import `expect`, add:

```python
from playwright.async_api import expect
```

- [ ] **Step 2: Run the smoke test**

Run:

```powershell
python .tmp/verify_newtab_extension.py
```

Expected: the script exits with code 0.

---

### Task 6: Final UI Scope Check

**Files:**
- Inspect: `src/pages/game/index.html`
- Inspect: `src/pages/game/index.css`
- Inspect: `src/pages/newtab/index.html`

- [ ] **Step 1: Confirm no extra game content was added**

Run:

```powershell
rg "SAVE|LOG|RESOURCE|MISSION|OBJECTIVE|仓库|资源|日志|任务|面板" src/pages/game
```

Expected: no matches.

- [ ] **Step 2: Confirm changed files**

Run:

```powershell
git status --short
```

Expected: changed files are limited to the new shared transition helper, new game page files, pet page entry edits, smoke test edit, and this plan/spec history; unrelated pre-existing dirty files may still appear and must not be reverted.

---

## Self-Review

Spec coverage:

- Standalone game page: Task 4.
- Title `GAME DECK`: Task 4.
- Top bar with return button, search, time, status: Task 4.
- Pet page `游戏空间` entry: Task 2.
- Animated transition both directions: Tasks 1, 2, 3, and 4.
- Reduced-motion support: Tasks 1, 3, and 4.
- No game mechanics or extra panels: Task 6.
- Verification: Task 5.

Placeholder scan:

- The plan contains no `TBD`, no deferred implementation instructions, and no unnamed error handling.

Type consistency:

- Shared helper export is `runPageTransition` in Task 1 and imports use the same name in Tasks 2 and 4.
- DOM ids in HTML and JavaScript match: `open-game-deck`, `return-pet-page`, `game-search-form`, `game-search-input`, `game-clock`.
