# Game Deck Workers And Resource Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `GAME DECK` so the miner keeps harvesting at the mountain, the hauler visibly clears ground rocks as it stores ore, and world anchor positions are configurable for future art replacement.

**Architecture:** Keep the page DOM-driven and preserve the existing `index.mjs` entrypoint. Move the behavior contract into a small Node-testable surface around the worker simulation, keep `index.mjs` responsible for resource counters and wiring, and extend `rock-physics.mjs` with a narrow pickup API for visible ground rocks.

**Tech Stack:** Manifest V3 extension page, native ES modules, local Matter.js build, Node built-in test runner, Python Playwright smoke verifier.

---

## File Structure

**Create:**
- `docs/superpowers/plans/2026-05-18-game-deck-workers-and-resource-flow.md` — this plan
- `src/pages/game/workers.test.mjs` — focused regression coverage for worker simulation behavior

**Modify:**
- `src/pages/game/workers.mjs` — worker phases, optional visual-pickup callback, configurable anchor reads
- `src/pages/game/index.mjs` — resource-flow wiring between counters, worker simulation, and rock physics
- `src/pages/game/rock-physics.mjs` — pickup API for visible ground rocks
- `src/pages/game/index.html` — optional anchor metadata for future art swaps
- `.tmp/verify_newtab_extension.py` — game deck regression checks for worker behavior

**Git convention:** all commit messages in this task use Chinese.

---

### Task 1: Add Failing Worker Regression Coverage

**Files:**
- Create: `src/pages/game/workers.test.mjs`
- Modify: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Add a worker simulation regression test for continuous mining**
- [ ] **Step 2: Add a worker simulation regression test for visible rock pickup hook**
- [ ] **Step 3: Add Playwright smoke checks for miner staying at the mountain and hauler advancing stored ore**
- [ ] **Step 4: Run `node --test src/pages/game/workers.test.mjs` and confirm RED**

### Task 2: Fix The Worker State Machine

**Files:**
- Modify: `src/pages/game/workers.mjs`

- [ ] **Step 1: Keep the miner in the mining loop after each successful harvest while ore remains**
- [ ] **Step 2: Remove the forced `walkToPile/drop` loop from the autonomous miner flow**
- [ ] **Step 3: Add a dedicated callback for visible ground-rock pickup during hauler collection**
- [ ] **Step 4: Re-run `node --test src/pages/game/workers.test.mjs` and confirm GREEN**

### Task 3: Reconnect Resource Counters To Visible Rocks

**Files:**
- Modify: `src/pages/game/index.mjs`
- Modify: `src/pages/game/rock-physics.mjs`

- [ ] **Step 1: Wire the hauler pickup callback to a rock-physics pickup method**
- [ ] **Step 2: Remove one visible ground rock when the hauler picks ore from the pile**
- [ ] **Step 3: Keep counter updates authoritative even if no visible rock is available**

### Task 4: Make Worker Anchors Art-Swappable

**Files:**
- Modify: `src/pages/game/index.html`
- Modify: `src/pages/game/workers.mjs`

- [ ] **Step 1: Expose mountain, pile, and storage worker anchors through element data attributes**
- [ ] **Step 2: Read those anchor values with fallbacks in `workers.mjs`**
- [ ] **Step 3: Keep current visuals unchanged while removing hardcoded positional coupling**

### Task 5: Verify End-To-End Behavior

**Files:**
- Inspect: `src/pages/game/workers.mjs`
- Inspect: `src/pages/game/index.mjs`
- Inspect: `src/pages/game/rock-physics.mjs`
- Inspect: `src/pages/game/index.html`
- Inspect: `src/pages/game/workers.test.mjs`
- Inspect: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Run `node --test src/pages/game/workers.test.mjs`**
- [ ] **Step 2: Run `python .tmp/verify_newtab_extension.py`**
- [ ] **Step 3: Run `git diff -- src/pages/game .tmp/verify_newtab_extension.py docs/superpowers/plans/2026-05-18-game-deck-workers-and-resource-flow.md`**

## Self-Review

- Spec coverage: miner loop, visible hauling, and art-swappable anchors are each mapped to explicit tasks.
- Placeholder scan: no `TODO`, `TBD`, or deferred implementation markers.
- Type consistency: worker simulation remains the integration point; visible-pickup behavior is modeled as an explicit callback instead of hidden side effects.
