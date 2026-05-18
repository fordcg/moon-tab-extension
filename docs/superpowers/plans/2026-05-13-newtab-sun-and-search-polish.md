# Newtab Sun And Search Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the newtab hero into the approved Solar Monolith direction with a unified search device, larger refined sun, and calmer background hierarchy without changing search behavior.

**Architecture:** Keep the existing `newtab` behavior and DOM ids intact, but reorganize the hero markup so the search controls live inside one search shell. Most of the work is CSS: rebuild the scene layers, merge the top control capsule into the main search device, add restrained outline sweep styling, and tighten the responsive breakpoints around the new integrated layout.

**Tech Stack:** Static HTML, CSS, existing browser-extension JavaScript controllers, Playwright verification script in `.tmp/verify_newtab_extension.py`

---

### Task 1: Reshape the search shell markup

**Files:**
- Modify: `src/pages/newtab/index.html`

- [ ] Move the top control buttons into the same `outline-search-frame` container as the input row while preserving ids used by `index.mjs`.
- [ ] Add a dedicated inner rail wrapper for the three control buttons and keep the `search-target-trigger`, `search-input`, suggestion shell, and preview shell ids unchanged.
- [ ] Leave settings and AI preview markup outside the search shell unchanged.

### Task 2: Restyle the scene and unified search device

**Files:**
- Modify: `src/pages/newtab/styles/index.css`

- [ ] Rework the scene layers so the sun is larger, warmer, and more centered while the horizon, grid, and scanline drop in contrast.
- [ ] Replace the detached top capsule styles with a single integrated search shell that contains a subdued control rail and a stronger main input row.
- [ ] Add a restrained outline treatment that reads as an always-on HUD edge with stronger focus and AI states.
- [ ] Restore clear affordance for the search target trigger, including pointer cursor and visible focus treatment.

### Task 3: Normalize responsive behavior

**Files:**
- Modify: `src/pages/newtab/styles/index.css`

- [ ] Collapse the overlapping mobile breakpoints into a consistent hierarchy around the unified shell.
- [ ] Keep the sun visually meaningful on small screens and stack the control rail / input row without splitting the shell into separate floating pieces.
- [ ] Ensure all shell controls remain at least 44px tall in touch layouts.

### Task 4: Verify behavior and visual contract

**Files:**
- Modify if needed: `.tmp/verify_newtab_extension.py`

- [ ] Run `python .tmp/verify_newtab_extension.py`
- [ ] Confirm the extension still boots, the search input becomes ready, and the verification screenshots generate successfully.
- [ ] If the script exposes selector or visual regressions caused by the markup change, adjust the script only as needed to keep it aligned with the preserved ids.
