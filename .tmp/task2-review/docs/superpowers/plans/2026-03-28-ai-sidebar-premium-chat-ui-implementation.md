# Premium Chat UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the AI sidebar so it feels like a premium Arc/Copilot-style browser conversation assistant with weak page chrome, chat-first hierarchy, and elegant lightweight state/trace presentation.

**Architecture:** Keep the existing sidebar logic and state machine intact, but refactor the presentation layer so the top bar becomes minimal, the message flow becomes the visual center, locked/error/degraded states become quieter and more product-like, and traces become lightweight inline/system-like elements rather than a panel. Most changes should stay in sidebar HTML/CSS/DOM-rendering code, with only small state-copy adjustments in controller code.

**Tech Stack:** Manifest V3 extension, plain HTML/CSS/native ESM, existing sidebar controllers, Playwright smoke verifier (`python .tmp/verify_newtab_extension.py`).

---

## File Structure

### Primary files to modify
- `src/pages/sidebar/index.html`
  - Simplify the shell structure around a minimal assistant header, message-first body, quieter state surfaces, and more refined composer.
- `src/pages/sidebar/index.css`
  - Replace the remaining panel-style visual language with a premium chat UI system.
- `src/pages/sidebar/sidebar-dom-controller.mjs`
  - Adjust how state panels, tool-result messages, and trace rows are rendered so they feel native to the chat flow.

### Secondary files to modify
- `src/pages/sidebar/sidebar-state-controller.mjs`
  - Update stale copy and better distinguish `invalid` vs `degraded` presentation intent.
- `src/pages/sidebar/index.mjs`
  - Minor wiring only if the new topbar/settings or trace placement requires new element references.
- `.tmp/verify_newtab_extension.py`
  - Add presentation-level assertions for the new premium UI structure without overfitting to fragile cosmetics.

### Files to avoid changing unless truly necessary
- `src/pages/sidebar/sidebar-ai-controller.mjs`
- `src/pages/sidebar/sidebar-chat-controller.mjs`
- `src/pages/sidebar/sidebar-action-controller.mjs`
- `src/background/sidebar-bridge.js`
- `src/shared/*`

These already implement the current feature set and should not be bundled into the UI-only refresh unless a rendering issue absolutely requires it.

---

### Task 1: Rebuild the sidebar visual hierarchy around a minimal assistant header

**Files:**
- Modify: `src/pages/sidebar/index.html`
- Modify: `src/pages/sidebar/index.css`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Write the failing verifier checks for the new minimal header structure**

Extend `.tmp/verify_newtab_extension.py` with new fields that describe the premium header contract, for example:

```python
"sidebar_topbar_button_present": False,
"sidebar_topbar_url_is_quiet": False,
"sidebar_state_card_present": False,
```

Add assertions that the sidebar has:
- a topbar settings button
- a visible topbar assistant identity block
- a visible lightweight status area

Use selectors that are stable and structure-focused, for example:
- `#sidebar-topbar-settings-button`
- `.sidebar-topbar`
- `.sidebar-topbar-main`
- `.sidebar-topbar-statuses`

- [ ] **Step 2: Run the full verifier and confirm the new UI-structure checks fail first**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- FAIL specifically because the new premium topbar/presentation assertions do not exist yet.

- [ ] **Step 3: Simplify the header structure in `src/pages/sidebar/index.html`**

Refactor the top area so it reads like a conversation assistant instead of a dashboard header.

Target structure:

```html
<header class="sidebar-topbar">
  <div class="sidebar-topbar-main">
    <p class="sidebar-topbar-eyebrow">月标签 AI 助手</p>
    <div class="sidebar-topbar-status-line">
      <span id="sidebar-context-status"></span>
      <span id="sidebar-topbar-ai-status"></span>
    </div>
  </div>
  <button id="sidebar-topbar-settings-button" ...>设置</button>
</header>
```

Reduce default emphasis on page title/URL. Keep them available, but visually subordinate.

- [ ] **Step 4: Rewrite header and shell CSS to create a lighter, more premium top region**

In `src/pages/sidebar/index.css`, adjust:
- header spacing
- typography scale
- status pills/dots
- translucency/shadow language
- settings button styling

The effect should be:
- lighter top chrome
- more air around the message area
- less “extension control panel” feel

- [ ] **Step 5: Run the verifier again and confirm the premium header checks pass**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- PASS on header/topbar structure checks
- No regressions to shell-state or message-flow checks

- [ ] **Step 6: Commit the header hierarchy refresh**

```bash
git add src/pages/sidebar/index.html src/pages/sidebar/index.css .tmp/verify_newtab_extension.py
git commit -m "feat: refine sidebar assistant header"
```

---

### Task 2: Make the chat stream the dominant visual center

**Files:**
- Modify: `src/pages/sidebar/index.html`
- Modify: `src/pages/sidebar/index.css`
- Modify: `src/pages/sidebar/sidebar-dom-controller.mjs`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Write the failing verifier checks for chat-first layout**

Add verifier fields such as:

```python
"sidebar_chat_shell_primary": False,
"sidebar_composer_visible": False,
"sidebar_empty_state_feels_chatlike": False,
```

At minimum, assert:
- `#sidebar-chat-shell` remains visible in active state
- `#sidebar-messages` is the dominant content area
- `#sidebar-form` is visible and reachable in active state
- empty-state suggestions still exist after the layout refactor

- [ ] **Step 2: Run the verifier to confirm the new chat-first assertions fail**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- FAIL because the current layout does not yet satisfy the new chat-first presentation contract.

- [ ] **Step 3: Rework `src/pages/sidebar/index.html` so page chrome recedes behind the message flow**

Adjust active-shell markup so the main reading flow is:
- welcome/empty assistant copy
- message history
- lightweight trace region
- composer

Do not reintroduce a large persistent page-context card.

- [ ] **Step 4: Tune CSS so the message stream visually dominates**

In `src/pages/sidebar/index.css`, revise:
- message area height/flex behavior
- bubble width and spacing
- user/assistant visual contrast
- empty-state suggestion styling
- composer placement and spacing

Make sure the effect is:
- conversation first
- controls second

- [ ] **Step 5: Update DOM controller rendering to match the refined message hierarchy**

In `src/pages/sidebar/sidebar-dom-controller.mjs`, ensure:
- `assistant` feels primary
- `tool_result` feels lighter/system-like
- pending assistant rows remain visually refined
- empty-state is hidden/shown correctly in the new hierarchy

- [ ] **Step 6: Re-run verifier and confirm active chat still behaves correctly**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- PASS on all prior behavior checks
- PASS on new chat-first layout checks

- [ ] **Step 7: Commit the chat-first body refinement**

```bash
git add src/pages/sidebar/index.html src/pages/sidebar/index.css src/pages/sidebar/sidebar-dom-controller.mjs .tmp/verify_newtab_extension.py
git commit -m "feat: make sidebar chat-first"
```

---

### Task 3: Redesign state surfaces so they feel like product states, not alerts or admin panels

**Files:**
- Modify: `src/pages/sidebar/index.html`
- Modify: `src/pages/sidebar/index.css`
- Modify: `src/pages/sidebar/sidebar-state-controller.mjs`
- Modify: `src/pages/sidebar/sidebar-dom-controller.mjs`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Write the failing verifier checks for refined locked/error/degraded presentation**

Add fields such as:

```python
"sidebar_locked_copy_refined": False,
"sidebar_error_copy_refined": False,
"sidebar_degraded_copy_refined": False,
```

These should assert:
- locked state presents a product-style onboarding message, not a warning box tone
- error state presents clear recovery options
- degraded state copy no longer reads like a crash or an internal system fault

- [ ] **Step 2: Run verifier and confirm the new presentation-copy checks fail**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- FAIL because the refined copy/styling requirements have not yet been applied.

- [ ] **Step 3: Update stale or panel-like copy in the sidebar state controller**

In `src/pages/sidebar/sidebar-state-controller.mjs`, adjust copy so it reflects current product behavior and the UI’s premium tone.

In particular:
- remove stale “后续任务再接入” wording
- ensure degraded reads like “still usable, but remote AI is currently unstable” rather than a hard crash

- [ ] **Step 4: Restyle the state cards as quieter product surfaces**

In `src/pages/sidebar/index.css`, redesign:
- locked state card
- invalid/error card
- degraded warning treatment

Visual goal:
- softer edges
- less alarm-box feeling
- stronger hierarchy between headline, explanation, and CTA

- [ ] **Step 5: Ensure CTA labels and rendered actions remain semantically aligned**

In `src/pages/sidebar/sidebar-dom-controller.mjs`, keep the existing button wiring but confirm that rendered labels still match the actual action for each shell state.

- [ ] **Step 6: Run verifier to confirm the state surfaces pass and behavior remains intact**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- PASS on locked/error/degraded checks
- No regressions in shell-state behavior

- [ ] **Step 7: Commit the state-surface refinement**

```bash
git add src/pages/sidebar/index.html src/pages/sidebar/index.css src/pages/sidebar/sidebar-state-controller.mjs src/pages/sidebar/sidebar-dom-controller.mjs .tmp/verify_newtab_extension.py
git commit -m "feat: refine sidebar state surfaces"
```

---

### Task 4: Recast tool results and execution traces as elegant system-like conversation elements

**Files:**
- Modify: `src/pages/sidebar/index.html`
- Modify: `src/pages/sidebar/index.css`
- Modify: `src/pages/sidebar/sidebar-dom-controller.mjs`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Write the failing verifier checks for refined trace and tool-result presentation**

Add UI-level assertions like:

```python
"sidebar_trace_surface_refined": False,
"sidebar_tool_result_message_present": False,
```

Keep behavior assertions stable, but add presentation assertions for:
- `#sidebar-trace` existing without dominating the layout
- `tool_result` rows still rendering in the chat flow
- traces remaining visible but lightweight

- [ ] **Step 2: Run verifier and confirm the new trace/tool-result checks fail**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- FAIL because the current visual treatment is still too close to a utilitarian trace block.

- [ ] **Step 3: Redesign `tool_result` messages as subtle assistant action receipts**

In `src/pages/sidebar/sidebar-dom-controller.mjs` and CSS, make `tool_result` rows:
- visibly distinct from normal assistant messages
- quieter than assistant content
- still part of the conversation stream

They should feel like:
- the assistant acknowledging completed work
- not like console output

- [ ] **Step 4: Redesign `#sidebar-trace` as a quiet system layer**

In `src/pages/sidebar/index.css`, adjust trace presentation so it feels:
- embedded
- subtle
- premium
- non-debuggy

Allowed visual approaches:
- subdued system pills
- ultra-light timeline markers
- blurred narrow strip with sparse step rows

Not allowed:
- dense log list
- large bordered debug panel
- high-contrast telemetry block

- [ ] **Step 5: Run verifier to confirm behavior still passes after the UI-only trace refactor**

Run:
```bash
python .tmp/verify_newtab_extension.py
```

Expected:
- PASS on Task 4/5 behavior checks
- PASS on new tool-result/trace presentation checks

- [ ] **Step 6: Commit the premium trace/tool-result refinement**

```bash
git add src/pages/sidebar/index.html src/pages/sidebar/index.css src/pages/sidebar/sidebar-dom-controller.mjs .tmp/verify_newtab_extension.py
git commit -m "feat: refine sidebar trace and tool receipts"
```

---

## Self-Review Checklist

### Spec coverage
- Weak page chrome and chat-first hierarchy: covered by Tasks 1 and 2.
- Productized locked/error/degraded states: covered by Task 3.
- Premium treatment of tool/trace surfaces: covered by Task 4.
- Keep logic mostly intact and focus on presentation: reflected by limiting primary changes to HTML/CSS/DOM controller.

### Placeholder scan
- No `TBD`, `TODO`, or “implement later” placeholders remain.
- Every task names exact files.
- Every task includes a concrete verification command.

### Type consistency
- Existing shell ids preserved:
  - `#sidebar-locked-state`
  - `#sidebar-error-state`
  - `#sidebar-chat-shell`
- Existing message kinds preserved:
  - `assistant`
  - `tool_result`
  - `user`
- Existing trace/event hooks preserved to avoid breaking current verifier logic.

## Verification Commands

Primary verification command:

```bash
python .tmp/verify_newtab_extension.py
```

Manual sanity checks after each task:

```text
1. Open the extension new tab page.
2. Open the sidebar in locked, error, and active scenarios.
3. Check the first impression: chat assistant, not panel.
4. Ask one question and ensure the message flow remains the visual center.
5. Trigger one tool action and confirm the receipt + trace feel subtle, not like logs.
```

## Commit Boundaries
- Task 1: minimal assistant header
- Task 2: chat-first body layout
- Task 3: refined state surfaces
- Task 4: premium trace and tool-result presentation

Plan complete and saved to `docs/superpowers/plans/2026-03-28-ai-sidebar-premium-chat-ui-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
