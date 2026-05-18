# Warm Paper Light Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the `ai-sidebar-mvp` worktree to a unified warm-paper light theme across newtab, settings, AI preview, and sidebar surfaces without changing product behavior.

**Architecture:** Keep the existing HTML structure, JS wiring, state classes, and controller behavior intact. Implement the rollout primarily through CSS token and surface updates in the two page stylesheets, use HTML only for `color-scheme` semantics if needed, and only touch the bubble-layer renderer if CSS-only theming leaves the newtab backdrop visibly dark.

**Tech Stack:** Manifest V3 extension, plain HTML/CSS/native ESM, Playwright-based smoke verifier (`python .tmp/verify_newtab_extension.py`), manual browser validation for sidebar states.

---

## File Structure

### Primary files to modify
- `src/pages/newtab/styles/index.css`
  - Owns the newtab theme tokens, page background, search shell, dropdowns, AI preview, and settings modal surfaces.
- `src/pages/sidebar/index.css`
  - Owns the sidebar theme tokens, topbar, state cards, message bubbles, tool receipts, composer, quick actions, and trace surfaces.

### Conditional HTML-only files
- `src/pages/newtab/index.html`
  - Update only if native form controls still render dark after the CSS theme switch; keep all ids/classes unchanged.
- `src/pages/sidebar/index.html`
  - Update only if `meta color-scheme` must switch to light semantics.

### Conditional fallback file
- `src/pages/newtab/liquid-glass-bubble-layer.mjs`
  - Touch only if the canvas backdrop remains dark after CSS changes because it currently paints night-mode gradients directly.

### Verification files
- `.tmp/verify_newtab_extension.py`
  - Existing automated regression test for newtab redirect, settings flow, search shell, suggestions, and AI preview.
- Manual browser verification against the unpacked extension loaded from the worktree root.

### Files to avoid modifying
- `src/pages/newtab/index.mjs`
- `src/pages/sidebar/index.mjs`
- `src/pages/sidebar/sidebar-dom-controller.mjs`
- `src/pages/sidebar/sidebar-state-controller.mjs`
- `src/pages/sidebar/sidebar-context-controller.mjs`
- `src/shared/*`

These files already define current behavior and state transitions; this rollout is visual unless an unavoidable theme-specific bug appears.

---

### Task 1: Establish light-theme semantics and warm-paper token baselines

**Files:**
- Modify: `src/pages/newtab/styles/index.css:1-60`
- Modify: `src/pages/sidebar/index.css:1-18`
- Modify if needed: `src/pages/newtab/index.html:1-13`
- Modify if needed: `src/pages/sidebar/index.html:1-9`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Read the existing root theme declarations and identify light-theme entry points**

Confirm the current dark-only declarations exist in both page stylesheets and both HTML documents:

```css
:root {
  color-scheme: dark;
}
```

```html
<meta name="color-scheme" content="dark" />
```

Expected finding:
- Both `src/pages/newtab/styles/index.css` and `src/pages/sidebar/index.css` declare `color-scheme: dark`.
- Both page HTML files declare `<meta name="color-scheme" content="dark" />`.

- [ ] **Step 2: Write the failing regression check by running the existing smoke test before any edits**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- PASS on the current baseline.
- Save the JSON output or terminal output as the pre-change reference for later comparison.

- [ ] **Step 3: Replace the newtab root token block with a warm-paper light palette**

In `src/pages/newtab/styles/index.css`, replace the existing dark root token block with a warm light system. Use a concrete token block like this:

```css
:root {
  color-scheme: light;
  --font-sans: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --font-serif: "Iowan Old Style", "Palatino Linotype", "Songti SC", "STSong", serif;
  --font-mono: "Cascadia Code", "SFMono-Regular", "Consolas", monospace;

  --surface-base-0: #fffdf8;
  --surface-base-1: #f8f1e5;
  --surface-base-2: #f2e8d8;
  --surface-panel: rgba(255, 251, 244, 0.86);
  --surface-panel-strong: rgba(252, 245, 235, 0.94);
  --surface-panel-soft: rgba(229, 209, 177, 0.22);
  --surface-card: rgba(255, 250, 242, 0.78);
  --surface-card-strong: rgba(250, 241, 227, 0.92);
  --surface-card-elevated: rgba(255, 253, 248, 0.98);

  --ink-primary: #35281f;
  --ink-secondary: rgba(73, 56, 42, 0.82);
  --ink-tertiary: rgba(108, 84, 64, 0.7);
  --ink-strong-dark: #2f2219;
  --ink-soft-dark: #6f5642;

  --line-soft: rgba(139, 108, 76, 0.14);
  --line-mid: rgba(139, 108, 76, 0.24);
  --line-strong: rgba(139, 108, 76, 0.36);

  --accent-lunar: #c88d4a;
  --accent-stellar: #b77932;
  --accent-cyan: #a88a68;
  --accent-gold: #d5a15c;
  --accent-muted: rgba(190, 146, 91, 0.14);
  --focus-ring: rgba(191, 134, 72, 0.32);
  --danger-ink: #a34e45;

  --shadow-shell: 0 28px 80px rgba(113, 82, 46, 0.14);
  --shadow-card: 0 20px 44px rgba(129, 93, 53, 0.12);
  --shadow-search: 0 20px 52px rgba(136, 98, 55, 0.16);
  --shadow-modal: 0 28px 72px rgba(115, 83, 49, 0.18);

  --radius-pill: 999px;
  --radius-shell: 34px;
  --radius-panel: 28px;
  --radius-card: 24px;
  --radius-control: 16px;

  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;

  --homepage-search-shell-width: min(1220px, 94vw);
  --transition-standard: 260ms cubic-bezier(0.22, 1, 0.36, 1);
}
```

- [ ] **Step 4: Replace the sidebar root token block with the corresponding warm-paper light palette**

In `src/pages/sidebar/index.css`, replace the root block with a warm light token set that matches newtab instead of leaving sidebar on dark values. Use a concrete block like this:

```css
:root {
  color-scheme: light;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  background: #fffaf2;
  color: #35281f;
  --sidebar-bg-top: #fffdf8;
  --sidebar-bg-bottom: #f4eadb;
  --sidebar-surface: rgba(255, 250, 242, 0.84);
  --sidebar-surface-strong: rgba(251, 243, 232, 0.96);
  --sidebar-border: rgba(139, 108, 76, 0.12);
  --sidebar-border-strong: rgba(139, 108, 76, 0.2);
  --sidebar-text-soft: rgba(100, 75, 57, 0.72);
  --sidebar-accent: #c4874c;
  --sidebar-accent-soft: rgba(196, 135, 76, 0.12);
  --sidebar-success: #567b57;
  --sidebar-error: #a1534a;
  --sidebar-warning: #b78643;
}
```

- [ ] **Step 5: Update HTML `color-scheme` meta tags only if native controls remain dark**

If browser-native controls still render dark after the CSS token swap, update both HTML files from:

```html
<meta name="color-scheme" content="dark" />
```

to:

```html
<meta name="color-scheme" content="light" />
```

If mixed-browser behavior requires fallback, use:

```html
<meta name="color-scheme" content="light dark" />
```

Do not change any other HTML structure.

- [ ] **Step 6: Run the smoke test again to confirm the root theme switch did not break behavior**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- PASS with the same functional checks as before.
- No failures in redirect, settings open/close, search, suggestions, or preview generation.

- [ ] **Step 7: Commit the token baseline and light semantics**

```bash
git add src/pages/newtab/styles/index.css src/pages/sidebar/index.css src/pages/newtab/index.html src/pages/sidebar/index.html
git commit -m "feat: establish warm light theme tokens"
```

If the HTML files were not changed, omit them from `git add`.

---

### Task 2: Re-skin the newtab background, search shell, dropdowns, and settings modal

**Files:**
- Modify: `src/pages/newtab/styles/index.css:71-206`
- Modify: `src/pages/newtab/styles/index.css:244-640`
- Modify: `src/pages/newtab/styles/index.css:1065-1366`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Run the smoke test before editing the newtab surfaces**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- PASS using the Task 1 theme-token baseline.

- [ ] **Step 2: Convert the page and bubble-layer backdrop from night gradients to warm-paper gradients**

Replace the current dark `html`, `body`, and backdrop treatments with light warm surfaces. Update the relevant block in `src/pages/newtab/styles/index.css` to concrete code like:

```css
html {
  background: var(--surface-base-0);
}

body {
  position: relative;
  margin: 0;
  overflow-x: hidden;
  font-family: var(--font-sans);
  color: var(--ink-primary);
  background:
    radial-gradient(120% 120% at 0% 0%, rgba(226, 196, 157, 0.28) 0%, rgba(226, 196, 157, 0) 46%),
    radial-gradient(110% 90% at 100% 0%, rgba(238, 220, 189, 0.2) 0%, rgba(238, 220, 189, 0) 42%),
    radial-gradient(90% 80% at 50% 100%, rgba(224, 197, 156, 0.18) 0%, rgba(224, 197, 156, 0) 55%),
    linear-gradient(180deg, var(--surface-base-0) 0%, #faf3e8 28%, #f5eadb 68%, #efe1cf 100%);
}

body::before {
  background:
    radial-gradient(circle at 18% 22%, rgba(161, 123, 84, 0.08) 0 1px, transparent 1px 100%),
    radial-gradient(circle at 72% 16%, rgba(176, 137, 94, 0.06) 0 1px, transparent 1px 100%);
  background-size: 280px 280px, 360px 360px;
  opacity: 0.22;
}

body::after {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0));
  mix-blend-mode: soft-light;
  opacity: 0.3;
}

.homepage-bubble-layer::before {
  background:
    radial-gradient(90% 70% at 50% 10%, rgba(255, 245, 228, 0.4) 0%, rgba(255, 245, 228, 0) 60%),
    radial-gradient(110% 100% at 20% 15%, rgba(227, 198, 154, 0.24) 0%, rgba(227, 198, 154, 0) 56%),
    linear-gradient(180deg, rgba(255, 251, 244, 0.16) 0%, rgba(245, 232, 212, 0.3) 100%);
}

body.is-settings-open .homepage-bubble-layer {
  opacity: 0.45;
  filter: saturate(0.82) blur(1px) brightness(1.02);
}
```

- [ ] **Step 3: Re-skin the search shell, search target controls, and suggestions for light mode**

Update the search surface and dropdown controls so they read as paper-card UI instead of dark glass. Use concrete replacements such as:

```css
.settings-trigger {
  color: rgba(104, 80, 58, 0.82);
}

.settings-trigger:hover {
  color: #35281f;
  background: rgba(201, 168, 126, 0.08);
}

.ai-toggle-coil span {
  border: 1.4px solid rgba(168, 131, 89, 0.22);
  border-top-color: rgba(173, 114, 52, 0.94);
  opacity: 0.8;
}

.outline-search-outline-rect {
  stroke: rgba(154, 119, 79, 0.72);
}

.search-target-trigger {
  border-right: 1px solid rgba(154, 119, 79, 0.14);
  color: rgba(67, 48, 33, 0.94);
}

.outline-search-form input {
  color: rgba(58, 42, 29, 0.96);
}

.outline-search-form input::placeholder {
  color: rgba(134, 102, 73, 0.72);
}

.outline-search-frame:focus-within .outline-search-outline-rect {
  stroke: rgba(176, 118, 56, 0.92);
}

.search-target-menu,
.search-suggestions {
  border: 1px solid rgba(154, 119, 79, 0.16);
  background: rgba(255, 251, 246, 0.96);
  box-shadow: 0 18px 36px rgba(125, 89, 50, 0.12);
  backdrop-filter: blur(18px);
}

.search-dropdown-group-label {
  color: rgba(127, 95, 67, 0.68);
}

.search-target-menu-item,
.search-suggestion-item {
  color: rgba(58, 42, 29, 0.96);
}

.search-target-menu-item:hover,
.search-target-menu-item[aria-selected="true"],
.search-target-menu-item.is-active,
.search-target-menu-item:focus-visible,
.search-suggestion-item:hover,
.search-suggestion-item[data-highlighted="true"],
.search-suggestion-item:focus-visible {
  background: rgba(210, 180, 143, 0.14);
}
```

- [ ] **Step 4: Re-skin the settings modal and form controls into a warm paper modal**

Update the settings modal region in `src/pages/newtab/styles/index.css` so its backdrop, sections, switches, inputs, and footer all stay in the same warm system. Apply concrete changes like:

```css
.settings-backdrop {
  background: rgba(116, 85, 52, 0.18);
  backdrop-filter: blur(10px);
}

.settings-popup {
  border: 1px solid rgba(161, 125, 87, 0.28);
  background: linear-gradient(180deg, rgba(255, 252, 247, 0.98) 0%, rgba(247, 238, 226, 0.96) 100%);
  color: var(--ink-strong-dark);
  box-shadow: var(--shadow-modal);
}

.settings-popup-header,
.settings-panel-footer {
  border-color: rgba(156, 121, 84, 0.2);
}

.settings-section {
  border: 1px solid rgba(156, 121, 84, 0.18);
  background: rgba(255, 250, 243, 0.82);
  box-shadow: 0 12px 24px rgba(125, 89, 50, 0.08);
}

.settings-inline-switch {
  border: 1px solid rgba(160, 124, 85, 0.24);
  background: rgba(244, 233, 215, 0.62);
}

.settings-input {
  border: 1px solid rgba(160, 124, 85, 0.28);
  background: rgba(255, 253, 249, 0.94);
  color: #2f2219;
}

.settings-input::placeholder {
  color: #8a6e56;
}

.settings-input:focus-visible {
  border-color: rgba(191, 134, 72, 0.72);
  box-shadow: 0 0 0 3px rgba(191, 134, 72, 0.16);
}
```

- [ ] **Step 5: Run the smoke test to validate settings and search-shell regressions**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- PASS on settings open/close.
- PASS on suggestion visibility, target-menu behavior, and search execution checks.

- [ ] **Step 6: Commit the newtab shell and settings restyle**

```bash
git add src/pages/newtab/styles/index.css
git commit -m "feat: restyle newtab with warm paper surfaces"
```

---

### Task 3: Re-skin the newtab AI preview, buttons, and related cards

**Files:**
- Modify: `src/pages/newtab/styles/index.css:733-960`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Trigger the existing preview regression path before editing the preview styles**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- PASS, including `preview_generated`, `preview_primary_action_label`, and `preview_hidden_after_switch` checks.

- [ ] **Step 2: Convert the preview card and query-map surfaces from dark glass to warm paper cards**

Replace the dark preview styling with concrete light-theme rules such as:

```css
.ai-search-preview {
  width: 100%;
  border: 1px solid rgba(156, 121, 84, 0.16);
  border-radius: 22px;
  background: rgba(255, 251, 245, 0.9);
  box-shadow: 0 16px 36px rgba(128, 90, 52, 0.1);
  overflow: hidden;
}

.ai-search-preview::before {
  background: rgba(156, 121, 84, 0.12);
}

.ai-search-preview-kicker,
.ai-search-preview-related-label,
.ai-search-preview-target-label {
  color: rgba(127, 95, 67, 0.72);
}

.ai-search-preview-summary,
.ai-search-preview-target,
.ai-search-preview-website-title {
  color: rgba(55, 40, 27, 0.96);
}

.ai-search-preview-intent {
  border: 1px solid rgba(183, 127, 64, 0.22);
  background: rgba(222, 184, 135, 0.18);
  color: rgba(95, 63, 32, 0.94);
}

.ai-search-preview-query-map,
.ai-search-preview-website-card {
  border: 1px solid rgba(156, 121, 84, 0.14);
  background: rgba(249, 240, 229, 0.54);
}

.ai-search-preview-query-item + .ai-search-preview-query-item {
  border-top: 1px dashed rgba(156, 121, 84, 0.16);
}

.ai-search-preview-website-description,
.ai-search-preview-website-host {
  color: rgba(97, 72, 52, 0.82);
}
```

- [ ] **Step 3: Rebalance primary and secondary actions into warm paper button hierarchy**

Update the preview and settings button group so the primary action feels warm and the secondary action feels like a paper chip. Apply concrete rules like:

```css
.settings-save-button,
.ai-search-preview-button,
.ai-search-preview-website-button {
  background: linear-gradient(135deg, #d6a15f 0%, #c28546 100%);
  border-color: rgba(164, 111, 53, 0.9);
  color: #fffaf4;
  box-shadow: 0 12px 22px rgba(162, 110, 54, 0.18);
}

.settings-secondary-button,
.ai-search-preview-button-secondary,
.ai-search-preview-suggestion {
  background: rgba(255, 249, 241, 0.86);
  border-color: rgba(156, 121, 84, 0.18);
  color: rgba(77, 57, 39, 0.92);
}

.settings-save-button:hover,
.settings-secondary-button:hover,
.ai-search-preview-button:hover,
.ai-search-preview-button-secondary:hover,
.ai-search-preview-suggestion:hover,
.ai-search-preview-website-button:hover {
  border-color: rgba(168, 118, 60, 0.34);
  transform: translateY(-1px);
}

.settings-save-button:hover,
.ai-search-preview-button:hover,
.ai-search-preview-website-button:hover {
  box-shadow: 0 16px 28px rgba(162, 110, 54, 0.22);
}
```

- [ ] **Step 4: Run the smoke test again to verify the preview flow still passes**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- PASS on preview generation and target-switch bypass checks.
- No new failures in search history or suggestion behavior.

- [ ] **Step 5: Commit the AI preview restyle**

```bash
git add src/pages/newtab/styles/index.css
git commit -m "feat: restyle ai preview with warm light cards"
```

---

### Task 4: Re-skin the sidebar shell, messages, composer, state cards, and trace

**Files:**
- Modify: `src/pages/sidebar/index.css:29-350`
- Modify: `src/pages/sidebar/index.css:364-799`
- Modify if needed: `src/pages/sidebar/index.html:1-110`
- Test: manual browser verification against the unpacked extension

- [ ] **Step 1: Open the sidebar page in the extension and capture the pre-change visual baseline**

Load the unpacked extension from the worktree root and open the sidebar so you can compare:
- locked state
- connected empty state
- error/degraded state if reproducible
- a message flow if available

Expected:
- Current sidebar still shows the dark premium chat UI.

- [ ] **Step 2: Re-skin the shell, topbar, pills, and buttons into warm paper surfaces**

Replace the dark shell and topbar styles with warm light equivalents. Use concrete CSS such as:

```css
body {
  margin: 0;
  background:
    radial-gradient(circle at 50% 0%, rgba(235, 214, 185, 0.34), transparent 32%),
    radial-gradient(circle at 100% 12%, rgba(223, 198, 165, 0.24), transparent 28%),
    linear-gradient(180deg, var(--sidebar-bg-top) 0%, var(--sidebar-bg-bottom) 100%);
}

.sidebar-shell {
  background:
    linear-gradient(90deg, rgba(197, 161, 120, 0.12) 0%, rgba(197, 161, 120, 0.06) 10px, rgba(197, 161, 120, 0) 22px),
    radial-gradient(circle at 50% 0%, rgba(222, 187, 142, 0.18), transparent 28%),
    linear-gradient(180deg, rgba(255, 251, 244, 0.98) 0%, rgba(245, 234, 218, 1) 100%);
}

.sidebar-topbar {
  border-bottom: 1px solid rgba(139, 108, 76, 0.08);
  background: linear-gradient(180deg, rgba(255, 252, 247, 0.72), rgba(250, 242, 231, 0.38));
}

.sidebar-icon-button {
  border-color: rgba(139, 108, 76, 0.12);
  background: rgba(255, 249, 240, 0.82);
  color: rgba(77, 58, 39, 0.88);
}

.sidebar-status-pill {
  border: 1px solid rgba(139, 108, 76, 0.1);
  background: rgba(255, 248, 239, 0.88);
  color: rgba(81, 62, 43, 0.76);
}

.sidebar-status-pill[data-status-tone="ai"] {
  background: rgba(236, 217, 190, 0.52);
}
```

If the light UA styling still needs help, update `src/pages/sidebar/index.html` to:

```html
<meta name="color-scheme" content="light" />
```

- [ ] **Step 3: Re-skin messages, tool receipts, and the main chat container**

Replace the message area and bubble styling with warm readable surfaces. Use concrete CSS like:

```css
.sidebar-messages {
  border: 1px solid rgba(139, 108, 76, 0.1);
  border-radius: 30px;
  background:
    radial-gradient(circle at 50% 0%, rgba(244, 226, 201, 0.46), transparent 36%),
    linear-gradient(180deg, rgba(255, 252, 247, 0.96), rgba(248, 241, 231, 0.98));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.5),
    0 18px 40px rgba(123, 88, 50, 0.08);
}

.sidebar-message-meta {
  color: rgba(118, 90, 65, 0.46);
}

.sidebar-message-row[data-role="user"] .sidebar-message-bubble {
  background: rgba(243, 228, 209, 0.9);
  border: 1px solid rgba(173, 136, 95, 0.16);
}

.sidebar-message-row[data-role="assistant"] .sidebar-message-bubble {
  background: rgba(255, 252, 247, 0.94);
  border: 1px solid rgba(139, 108, 76, 0.08);
}

.sidebar-message-row[data-sidebar-message-kind="tool_result"] .sidebar-message-bubble {
  background:
    linear-gradient(180deg, rgba(255, 250, 242, 0.88), rgba(249, 239, 226, 0.72)),
    rgba(255, 249, 242, 0.9);
  border: 1px solid rgba(139, 108, 76, 0.1);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.52),
    0 10px 26px rgba(123, 88, 50, 0.08);
}

.sidebar-tool-receipt-glyph {
  background: rgba(203, 167, 122, 0.14);
  color: rgba(132, 92, 54, 0.78);
}

.sidebar-tool-receipt-label,
.sidebar-tool-receipt-text {
  color: rgba(86, 64, 45, 0.72);
}
```

- [ ] **Step 4: Re-skin the composer, quick actions, locked/error cards, and trace**

Apply concrete light-theme styles to the interactive lower surfaces and trace elements:

```css
.sidebar-state-card {
  border: 1px solid rgba(139, 108, 76, 0.1);
  background:
    linear-gradient(180deg, rgba(255, 251, 245, 0.92), rgba(246, 236, 221, 0.92)),
    radial-gradient(circle at 0 0, rgba(220, 190, 151, 0.18), transparent 40%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.46),
    0 10px 24px rgba(123, 88, 50, 0.08);
}

.sidebar-state-card[data-sidebar-state-variant="error"] {
  background:
    linear-gradient(180deg, rgba(255, 248, 245, 0.96), rgba(250, 231, 224, 0.94)),
    radial-gradient(circle at 0 0, rgba(199, 109, 91, 0.12), transparent 38%);
}

.sidebar-state-card[data-sidebar-state-variant="degraded"] {
  background:
    linear-gradient(180deg, rgba(255, 250, 244, 0.96), rgba(248, 236, 220, 0.94)),
    radial-gradient(circle at 0 0, rgba(206, 154, 79, 0.12), transparent 40%);
}

.sidebar-form {
  border: 1px solid rgba(139, 108, 76, 0.1);
  background: linear-gradient(180deg, rgba(255, 251, 245, 0.9), rgba(246, 236, 221, 0.88));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.42),
    0 14px 28px rgba(123, 88, 50, 0.08);
}

.sidebar-input-shell {
  border: 1px solid rgba(139, 108, 76, 0.12);
  background: rgba(255, 252, 247, 0.9);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.4),
    0 10px 24px rgba(123, 88, 50, 0.06);
}

.sidebar-input::placeholder {
  color: rgba(131, 102, 77, 0.48);
}

.sidebar-input:focus-visible {
  outline: 2px solid rgba(191, 134, 72, 0.32);
}

.sidebar-quick-action,
.sidebar-empty-suggestion,
.sidebar-secondary-button {
  border-color: rgba(139, 108, 76, 0.1);
  background: rgba(252, 245, 236, 0.86);
  color: rgba(88, 66, 47, 0.8);
}

.sidebar-submit,
.sidebar-primary-button {
  border-color: rgba(165, 113, 58, 0.22);
  background: linear-gradient(180deg, rgba(213, 162, 95, 0.92), rgba(187, 126, 64, 0.96));
  color: #fffaf4;
  box-shadow: 0 10px 22px rgba(158, 107, 54, 0.18);
}

.sidebar-trace {
  border: 1px solid rgba(139, 108, 76, 0.08);
  background:
    linear-gradient(180deg, rgba(255, 250, 243, 0.84), rgba(247, 238, 225, 0.72)),
    rgba(255, 249, 241, 0.84);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.42),
    0 10px 24px rgba(123, 88, 50, 0.06);
}

.sidebar-trace-rail {
  background: linear-gradient(180deg, rgba(190, 144, 89, 0.42), rgba(190, 144, 89, 0.08));
}

.sidebar-trace-row {
  background: linear-gradient(180deg, rgba(255, 251, 245, 0.8), rgba(247, 238, 225, 0.6));
  color: rgba(88, 66, 47, 0.66);
}

.sidebar-trace-dot {
  background: rgba(191, 134, 72, 0.88);
  box-shadow: 0 0 10px rgba(191, 134, 72, 0.18);
}
```

Also add missing light-theme text rules if they are visually needed and still absent, for example:

```css
.sidebar-empty-title {
  margin: 0;
  color: rgba(53, 40, 31, 0.94);
  font-size: 1.18rem;
  line-height: 1.36;
  letter-spacing: -0.02em;
}

.sidebar-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: rgba(197, 146, 84, 0.84);
  box-shadow: 0 0 0 4px rgba(197, 146, 84, 0.12);
  flex: 0 0 auto;
}

.sidebar-state-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
```

- [ ] **Step 5: Manually verify all sidebar states in the browser**

Check the sidebar page for these scenarios:
- locked state
- error state
- degraded state if reproducible
- active empty state
- user message + assistant message
- tool-result message
- visible trace rows
- busy/disabled composer state

Expected:
- All surfaces are light-themed and readable.
- No dark cards or cold-blue remnants remain except where intentionally preserved for state accents.
- Existing interactions still work.

- [ ] **Step 6: Commit the sidebar restyle**

```bash
git add src/pages/sidebar/index.css src/pages/sidebar/index.html
git commit -m "feat: restyle sidebar with warm paper theme"
```

If `src/pages/sidebar/index.html` was not changed, omit it from `git add`.

---

### Task 5: Fix any remaining dark backdrop from the bubble renderer and run final regression

**Files:**
- Modify if needed: `src/pages/newtab/liquid-glass-bubble-layer.mjs:200-280`
- Test: `.tmp/verify_newtab_extension.py`
- Test: manual visual verification in browser

- [ ] **Step 1: Inspect the rendered newtab after Tasks 1-4 and decide whether the canvas backdrop is still too dark**

Look specifically at the bubble-layer canvas behind the search shell.

Expected decision:
- If the page now reads as warm and bright, skip to Step 4.
- If the page still looks night-mode because the canvas paints dark blues directly, continue with Steps 2-3.

- [ ] **Step 2: Replace the hard-coded night gradient and mist colors in `drawHeroBackdrop` with warm-paper colors**

In `src/pages/newtab/liquid-glass-bubble-layer.mjs`, replace the existing backdrop colors:

```js
gradient.addColorStop(0, "#050916");
gradient.addColorStop(0.38, "#0a1429");
gradient.addColorStop(0.72, "#111f3d");
gradient.addColorStop(1, "#182b4f");
```

with warm equivalents such as:

```js
gradient.addColorStop(0, "#fffdf8");
gradient.addColorStop(0.38, "#f9f1e6");
gradient.addColorStop(0.72, "#f1e4d2");
gradient.addColorStop(1, "#ead8c1");
```

Also replace the mist and particle colors with warmer values, for example:

```js
mistLeft.addColorStop(0, "rgba(223, 189, 146, 0.22)");
mistLeft.addColorStop(1, "rgba(223, 189, 146, 0)");

mistRight.addColorStop(0, "rgba(236, 210, 172, 0.18)");
mistRight.addColorStop(1, "rgba(236, 210, 172, 0)");

context.fillStyle = "rgba(158, 120, 82, 0.22)";
```

Keep the animation logic unchanged.

- [ ] **Step 3: Reload the extension and visually confirm the bubble canvas now matches the light theme**

Expected:
- Background atmosphere stays present.
- The page no longer reads as dark because of the canvas alone.

- [ ] **Step 4: Run the final newtab regression test**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- PASS on all required checks.
- No runtime errors introduced by the optional bubble renderer change.

- [ ] **Step 5: Perform the final manual acceptance checklist across newtab and sidebar**

Verify all spec-critical scenarios:
- newtab default state
- newtab settings popup open/close
- newtab suggestions and target dropdown
- AI preview generated and readable
- sidebar locked state
- sidebar active empty state
- sidebar chat messages / receipts / trace
- consistent warm-paper light theme across the entire worktree

- [ ] **Step 6: Commit the final theme polish and verification results**

```bash
git add src/pages/newtab/styles/index.css src/pages/sidebar/index.css src/pages/newtab/index.html src/pages/sidebar/index.html src/pages/newtab/liquid-glass-bubble-layer.mjs
git commit -m "feat: unify extension ui with warm light theme"
```

If the bubble-layer or HTML files were not changed, omit them from `git add`.

---

## Self-Review

### Spec coverage
- Warm paper light theme for entire worktree: covered by Tasks 1-5.
- Keep structure/logic intact: reinforced in File Structure and every task scope.
- Newtab + settings + AI preview: covered by Tasks 2-3.
- Sidebar shell + cards + messages + trace: covered by Task 4.
- Optional HTML `color-scheme` adaptation: covered by Tasks 1 and 4.
- Optional bubble-layer fallback: covered by Task 5.
- Smoke regression and manual sidebar verification: covered by Tasks 1, 2, 3, and 5.

### Placeholder scan
- No `TBD`, `TODO`, or “similar to Task N” placeholders remain.
- Every code-edit step includes explicit example code or exact replacement targets.
- Every verification step includes an exact command or manual checklist.

### Type and selector consistency
- The plan preserves existing ids/classes instead of inventing new ones.
- Conditional selectors added in the sidebar (`.sidebar-empty-title`, `.sidebar-status-dot`, `.sidebar-state-actions`) match existing HTML names already present in `src/pages/sidebar/index.html`.
- No new JS function or API names were introduced.
