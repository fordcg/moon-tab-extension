# Side Panel AI Pet Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the in-page green control beacon and add a side-panel AI pet companion with state machine, cat skin, speech bubbles, and an Octopus-style usage panel.

**Architecture:** Pure pet state machine under `src/shared/pet/` derives mood from side-panel chat/tool/boundary signals. UI lives only in the side panel (companion + usage dialog). Browser control keeps side-panel inheritance; no page orb.

**Tech Stack:** TypeScript, React, Vitest, Vite MV3 extension, LLMPET cat GIF assets (credit preserved).

## Global Constraints

- No page content-script control beacon / AutomationHud controlWindow path.
- No Claude Code hooks or localhost HTTP server.
- Pet is side-panel only in v1.
- Monthly cat assets require `CREDITS.md`.
- Prefer pure functions for state/usage; TDD for shared pet logic.

---

### Task 1: Remove control beacon

**Files:**
- Delete: `src/side-panel/components/AutomationHud.tsx`
- Modify: `src/shared/sidePanelRuntime.ts`, `src/content/index.ts`, `src/background/sidePanelController.ts`, `src/background/browserControlMessageHandler.ts`, `src/side-panel/App.tsx`, `src/side-panel/styles.css`
- Test: `tests/unit/content/index.test.ts`, `tests/unit/shared/sidePanelRuntime.test.ts`

- [ ] Remove CONTROL_BEACON_* API and controlWindow path helpers
- [ ] Content script: only floating assistant iframe remains
- [ ] `ensureSidePanelForControlledTab` opens real side panel only
- [ ] `closeAutomationControlBeacon` becomes no-op cleanup or removed
- [ ] Update/remove beacon unit tests
- [ ] Commit

### Task 2: Shared pet state machine + usage helpers

**Files:**
- Create: `src/shared/pet/states.ts`, `src/shared/pet/derivePetState.ts`, `src/shared/pet/usageSummary.ts`, `src/shared/pet/pricing.ts`
- Test: `tests/unit/shared/pet/*.test.ts`

- [ ] Port state vocabulary/priority/TTL from LLMPET
- [ ] `derivePetState(input) -> { state, bubble?, badge? }`
- [ ] Aggregate session token entries into today / 5h / by-model summaries
- [ ] Simple local model family pricing map
- [ ] Commit

### Task 3: Side-panel pet UI + usage panel

**Files:**
- Create: `src/side-panel/components/PetCompanion.tsx`, `src/side-panel/components/PetUsagePanel.tsx`, `src/side-panel/pet/petAssets.ts`
- Copy assets: `src/side-panel/pet/assets/cat/*` + CREDITS
- Modify: `src/side-panel/App.tsx` or `ChatPanel.tsx`, `styles.css`, `public/manifest`/vite if assets need WAR

- [ ] Companion shows cat GIF by derived state
- [ ] Bubble text for assistant/tool/error snippets
- [ ] Click opens usage panel (today cost, 5h, tokens, by model, sessions, ops)
- [ ] Mute toggle local to companion prefs (storage optional v1 in-memory OK if quick)
- [ ] Commit

### Task 4: Wire store signals + verify

**Files:**
- Modify: pet companion selectors from `appStore`
- Test: unit tests + `npm test` targeted + package if needed

- [ ] Map sending/streaming/toolRecords/boundary/error/idle
- [ ] Boundary waiting state when BoundaryChoice dialog active
- [ ] Run unit tests and typecheck
- [ ] Commit
