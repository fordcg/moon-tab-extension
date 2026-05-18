# Sidebar De-Panelization Correction Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the current sidebar UI so it no longer reads as a stack of large status cards and instead behaves like a chat-led Arc/Copilot-style assistant with weak page chrome and lightweight state surfaces.

**Architecture:** Keep the existing sidebar state machine and functional logic intact, but change the presentation hierarchy so the conversation remains the primary visual layer. Status should be expressed through a minimal dark top status strip plus lightweight inline system messages inside the chat flow, rather than through dominant full-width cards. Existing locked/error/degraded data can stay; only the way they are surfaced should change.

**Tech Stack:** Manifest V3 extension, plain HTML/CSS/native ESM, existing sidebar controllers, Playwright smoke verifier (`python .tmp/verify_newtab_extension.py`).

---

## File Structure

### Primary files to modify
- `src/pages/sidebar/index.html`
  - Remove the current dominant status-card presentation from the main visual flow and recompose the shell around a chat-first conversation region.
- `src/pages/sidebar/index.css`
  - Replace the remaining card-dominant state surfaces and any white/light header remnants with a unified dark, low-contrast, integrated assistant surface.
- `src/pages/sidebar/sidebar-dom-controller.mjs`
  - Render status as lightweight inline/system-level elements instead of dominant cards where possible.

### Secondary files to modify
- `src/pages/sidebar/sidebar-state-controller.mjs`
  - Keep state semantics, but ensure copy and output map cleanly to the new lightweight presentation model.
- `.tmp/verify_newtab_extension.py`
  - Update assertions so they validate the new lightweight state presentation without overfitting to exact visuals.

### Files to avoid changing unless necessary
- `src/pages/sidebar/sidebar-ai-controller.mjs`
- `src/pages/sidebar/sidebar-chat-controller.mjs`
- `src/pages/sidebar/sidebar-action-controller.mjs`
- `src/background/sidebar-bridge.js`
- `src/shared/*`

This is a UI hierarchy correction, not another feature pass.

---

### Task 1: Remove dominant status-card hierarchy from the primary visual layer

**Files:**
- Modify: `src/pages/sidebar/index.html`
- Modify: `src/pages/sidebar/index.css`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Write the failing verifier checks for de-panelized shell structure**

Extend `.tmp/verify_newtab_extension.py` with structure-level checks such as:

```python
"sidebar_state_cards_are_secondary": False,
"sidebar_chat_is_primary_visual_layer": False,
"sidebar_status_strip_visible": False,
```

Assert the shell now behaves like:
- a minimal dark top status strip,
- a primary message flow,
- state guidance rendered as lightweight system surfaces rather than dominant full-screen cards.

- [ ] **Step 2: Run verifier to confirm the new structure checks fail first**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- FAIL because the current layout still gives large state surfaces too much visual dominance.

- [ ] **Step 3: Rework `src/pages/sidebar/index.html` to keep status as a lightweight layer**

Shift the shell so:
- top area remains dark, integrated, and thin
- main chat region appears immediately under it
- locked/error/degraded guidance is either:
  - a narrow inline state banner, or
  - a compact system message block inside the chat region
- the user no longer lands on what feels like a “full panel card” first

- [ ] **Step 4: Rewrite CSS so state surfaces visually recede behind the chat**

In `src/pages/sidebar/index.css`:
- reduce width/padding/height dominance of state surfaces
- remove any bright/light top-bar feel entirely
- ensure the top strip is dark and integrated into the same visual plane as the rest of the sidebar
- make state UI feel embedded, not modal/panel-like

- [ ] **Step 5: Run verifier again and confirm shell hierarchy is now chat-first**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- PASS on new de-panelization checks
- PASS on prior functionality checks

- [ ] **Step 6: Commit the hierarchy correction**

```bash
git add src/pages/sidebar/index.html src/pages/sidebar/index.css .tmp/verify_newtab_extension.py
git commit -m "feat: de-panelize sidebar shell"
```

---

### Task 2: Convert locked/error/degraded states into lightweight assistant/system surfaces

**Files:**
- Modify: `src/pages/sidebar/index.html`
- Modify: `src/pages/sidebar/index.css`
- Modify: `src/pages/sidebar/sidebar-dom-controller.mjs`
- Modify: `src/pages/sidebar/sidebar-state-controller.mjs`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Write the failing verifier checks for lightweight system-state presentation**

Extend `.tmp/verify_newtab_extension.py` with checks like:

```python
"sidebar_locked_is_inline_like": False,
"sidebar_error_is_inline_like": False,
"sidebar_degraded_is_inline_like": False,
```

Verify that:
- locked/error/degraded still communicate clearly,
- but no longer read like large action cards,
- and remain visually subordinate to the chat surface.

- [ ] **Step 2: Run verifier and confirm the new system-surface checks fail first**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- FAIL because current states are still materially card-like even after recent refinements.

- [ ] **Step 3: Re-present state content as assistant/system guidance**

In `src/pages/sidebar/sidebar-dom-controller.mjs` and `index.html`:
- keep CTA affordances,
- but present them in a lighter, more conversational frame,
- especially for degraded state: it should read as “AI 现在不稳定，但你仍在当前对话里”， not as a full error pane.

- [ ] **Step 4: Update state styling for subtle system-message behavior**

In `src/pages/sidebar/index.css`:
- use lower-contrast backgrounds,
- reduce heavy borders,
- avoid thick card shadows,
- reduce vertical bulk,
- style CTAs as smaller secondary product actions instead of panel buttons.

- [ ] **Step 5: Run verifier again and confirm the state surfaces still work, but feel lighter**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- PASS on all locked/error/degraded checks
- PASS on previous functionality checks

- [ ] **Step 6: Commit the lightweight state-surface correction**

```bash
git add src/pages/sidebar/index.html src/pages/sidebar/index.css src/pages/sidebar/sidebar-dom-controller.mjs src/pages/sidebar/sidebar-state-controller.mjs .tmp/verify_newtab_extension.py
git commit -m "feat: lighten sidebar system states"
```

---

### Task 3: Make degraded state stay inside the conversation rather than feeling like a hard stop

**Files:**
- Modify: `src/pages/sidebar/index.html`
- Modify: `src/pages/sidebar/index.css`
- Modify: `src/pages/sidebar/sidebar-state-controller.mjs`
- Modify: `src/pages/sidebar/sidebar-dom-controller.mjs`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Write the failing verifier checks for conversational degraded state**

Add checks such as:

```python
"sidebar_degraded_keeps_chat_context": False,
"sidebar_degraded_feels_non_blocking": False,
```

The contract should be:
- degraded still warns,
- degraded still offers recovery,
- but the experience remains inside the assistant, not a hard-mode error panel.

- [ ] **Step 2: Run verifier to confirm the new degraded conversational checks fail**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- FAIL because the current degraded treatment is still too close to a product-state card.

- [ ] **Step 3: Update degraded copy and rendering so it feels like a temporary assistant condition**

Adjust copy in `src/pages/sidebar/sidebar-state-controller.mjs` so degraded reads like:
- AI is temporarily unstable
- current context is still here
- user can retry without feeling kicked out of the conversation

- [ ] **Step 4: Style degraded as a soft in-flow warning, not a large blocked panel**

In `src/pages/sidebar/index.css`, ensure degraded differs from invalid:
- invalid can remain more corrective
- degraded should feel softer and more recoverable

- [ ] **Step 5: Re-run verifier and confirm degraded behavior remains green**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- PASS on degraded checks
- PASS on all existing flow checks

- [ ] **Step 6: Commit the degraded-state UX correction**

```bash
git add src/pages/sidebar/index.html src/pages/sidebar/index.css src/pages/sidebar/sidebar-state-controller.mjs src/pages/sidebar/sidebar-dom-controller.mjs .tmp/verify_newtab_extension.py
git commit -m "feat: keep degraded state conversational"
```

---

## Self-Review Checklist

### Spec coverage
- Remove dominant panel feel: covered by Task 1.
- Replace large status cards with lighter inline/system surfaces: covered by Task 2.
- Keep degraded inside the assistant experience: covered by Task 3.
- Remove the white/light top-bar feel: explicitly covered in Task 1 styling goals.

### Placeholder scan
- No `TBD`, `TODO`, or vague placeholders remain.
- Every task names exact files and verification commands.

### Type consistency
- Existing IDs and runtime hooks should remain stable:
  - `#sidebar-topbar-settings-button`
  - `#sidebar-chat-shell`
  - `#sidebar-messages`
  - `#sidebar-trace`
- Avoid renaming message kinds or trace hooks in this correction pass.

## Verification Commands

Primary command:

```bash
python .tmp/verify_newtab_extension.py
```

Manual sanity checks after each task:

```text
1. Open the sidebar in locked, error, degraded, and active scenarios.
2. Confirm the first impression is “chat assistant”, not “panel with cards”.
3. Confirm the top strip stays dark and integrated, never a white bar.
4. Confirm status guidance feels like lightweight assistant/system UI.
5. Confirm the chat remains the visual center in every state.
```

## Commit Boundaries
- Task 1: de-panelize shell hierarchy
- Task 2: lighten system-state surfaces
- Task 3: keep degraded state conversational

Plan complete and saved to `docs/superpowers/plans/2026-03-28-sidebar-depanelization-correction.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
