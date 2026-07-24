# Project Optimization Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the non-security optimization backlog: split god modules, collapse dual-track shared code where safe, shrink package weight, raise engineering baselines, rebalance UX defaults, and split side-panel CSS.

**Architecture:** Mechanical extractions modules keep existing public exports stable so unit tests need minimal rewrites. Shared `.mjs` files used only by legacy tests become thin re-exports or are retired when Vitest covers the TS path. Package filters drop optional weight without breaking offline game bootstrap. UX defaults change only chat preference defaults (existing users keep stored prefs).

**Tech Stack:** Vite, TypeScript, React, Vitest, Playwright, MV3 extension packaging scripts.

## Global Constraints

- Do NOT change redaction / authorization / full-access security policy (user excluded item 7).
- Do NOT revert unrelated dirty worktree changes (SettingsPanel, SoftTooltipLayer, ChannelManagement, styles, tests).
- Preserve public exports from `browserControlMessageHandler.ts` (`BrowserControlManager`, message handler entry) for existing imports.
- Keep game playable offline after package shrink (audio may be optional only if runtime degrades gracefully).
- Prefer ASCII in new code; existing Chinese UI copy stays Chinese.
- After meaningful batches: `npm run package:extension` and commit (user preference).

---

### Task 1: UX defaults — tool call visibility

**Files:**
- Modify: `src/side-panel/state/appStorePreferences.ts`
- Modify: tests that assert default `toolCallDisplayMode` / `showToolCallProcessInAssistantMode`

**Goal:** New installs default to compact tool cards so tool process is visible without hunting settings.

- [ ] Set `toolCallDisplayMode: "compact"` and `showToolCallProcessInAssistantMode: true` in `createDefaultChatPreferences`.
- [ ] Update unit tests that pin old defaults.
- [ ] Run focused preference / App tests.

### Task 2: Split `browserControlMessageHandler.ts`

**Files:**
- Create: `src/background/browserControl/debuggerConnection.ts`
- Create: `src/background/browserControl/snapshotManager.ts`
- Create: `src/background/browserControl/browserToolFormatters.ts` (validate/format/normalize helpers after class block)
- Modify: `src/background/browserControlMessageHandler.ts` to re-export and own `BrowserControlManager` + message dispatch only
- Test: existing `tests/unit/background/browserControlMessageHandler.test.ts` must pass unchanged or with import path updates only

- [ ] Move `BrowserDebuggerConnection` (lines ~312–625) + private deps it needs.
- [ ] Move `BrowserControlSnapshotManager` (lines ~627–837).
- [ ] Move pure helpers after `BrowserControlManager` (from ~2290) into formatters module.
- [ ] Keep `export class BrowserControlManager` and any `handle*` exports in the original file or re-export from it for stable import paths.
- [ ] Run `npx vitest run tests/unit/background/browserControlMessageHandler.test.ts tests/unit/background/backgroundToolRuntime.test.ts`.

### Task 3: Thin `appStore.ts` by extracting provider/model catalog actions

**Files:**
- Create: `src/side-panel/state/appStoreProviders.ts` (provider/model CRUD, remote models, connectivity timers)
- Modify: `src/side-panel/state/appStore.ts` to compose actions
- Test: side-panel App / channel management tests

- [ ] Extract provider/model mutation methods and connectivity timer helpers.
- [ ] Keep `AppState` interface in `appStore.ts` or a types file; do not break `useAppStore` consumers.
- [ ] Run side-panel unit tests.

### Task 4: Dual-track — migrate legacy shared tests to Vitest / TS

**Files:**
- Prefer TS sources under `src/shared/**/*.ts`
- Create or extend: `tests/unit/shared/*.test.ts` for any coverage only in `scripts/test_*.mjs`
- Modify: `scripts/run_unit_tests.mjs` to drop migrated suites when safe
- Do not break newtab `.mjs` runtime (newtab still loads mjs)

- [ ] Inventory which `scripts/test_*.mjs` only mirror existing Vitest coverage; remove from legacy runner.
- [ ] For unique legacy coverage, port assertions into Vitest against TS modules.
- [ ] Leave newtab-only mjs (`search-settings`, `page-transition`, etc.) in place with a short comment that they are the newtab source of truth until newtab TS migration.

### Task 5: Package size — game audio + pet

**Files:**
- Modify: `vite.config.ts` / `scripts/package-extension.mjs` only if audio can be optional without hard crash
- Compress or subset `public/pet` if tools available; otherwise document skip
- Extend package tests for expected size / required paths

- [ ] Inspect game bootstrap audio load failure mode.
- [ ] If audio is hard-required, keep audio but exclude unused README/UPSTREAM from package if not needed at runtime; drop duplicate non-runtime docs from dist copy.
- [ ] Ensure package test still passes.

### Task 6: Engineering baseline — lint script + file-size guard + CI

**Files:**
- Create: `scripts/check-file-size.mjs` (soft fail list of oversized files, warn thresholds)
- Modify: `package.json` scripts (`lint` or `check:size`)
- Modify: `.github/workflows/ai-sidebar-quality.yml` to run typecheck-focused or size check without exploding CI time
- Optionally add lightweight eslint/biome only if install is quick and non-invasive

- [ ] Add size guard for known god files with thresholds reflecting post-split targets.
- [ ] Wire into `npm run check` or a sub-step used by CI.
- [ ] Sync `docs/superpowers/MIGRATION_STATUS.md` debugger permission note with `release-readiness.md` (docs only).

### Task 7: Split `styles.css`

**Files:**
- Create: `src/side-panel/styles/` partials imported from `styles.css` or `main.tsx`
- Keep cascade order identical

- [ ] Split by domain: base/tokens, chat, composer, settings, session, pet, toast/overlays.
- [ ] Import order preserved; visual snapshot not required but existing CSS class names unchanged.
- [ ] Run typecheck + a side-panel unit test.

### Task 8: E2E high-value smoke expansion (light)

**Files:**
- Modify: `tests/e2e/extension-smoke.spec.ts` or add focused cases only if fast
- Prefer unit coverage for debugger paths if E2E attach is flaky

- [ ] Add one smoke assertion for settings channel management visibility if missing.
- [ ] Do not add full debugger CDP attach E2E if environment cannot support it reliably.

### Task 9: Verify + package + commit

- [ ] `npm run typecheck`
- [ ] Focused vitest for touched areas
- [ ] `npm run package:extension`
- [ ] Commit with conventional message (user prefers auto-commit after package)
