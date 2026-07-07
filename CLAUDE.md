# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository scope

This repository is a Manifest V3 browser extension built with Vite, TypeScript, and React. The source manifest is `public/manifest.json`; do not treat the repository root as a directly loadable unpacked extension.

Product source is under `src/` plus public build inputs under `public/`:

- `public/manifest.json` - MV3 source manifest used by the Vite/package flow.
- `src/content/` - content script source; the built extension emits `content/index.js`.
- `src/background/` - service worker entry, extension event wiring, tool runtimes, and background message handlers.
- `src/side-panel/` - Browser AI Assistant React side panel UI and runtime state.
- `src/devtools/` - DevTools Network compatibility page and collector.
- `src/pages/newtab/` - Moon Tab new-tab page.
- `src/pages/game/` - game page, worker logic, assets, and tests.
- `src/shared/` - cross-page protocols, pure helpers, tool contracts, and state utilities.
- `.tmp/` and `tmp/` - scratch, verification, or external reference material; do not treat them as shipped runtime source.

## Commands

The current root npm scripts are defined in `package.json`:

- `npm run dev` - start Vite dev server on `127.0.0.1`.
- `npm run build` / `npm run build:extension` - build the extension into `dist/`.
- `npm run package:extension` - build and create the packaged extension artifact.
- `npm run check:package` - run package tests and package the extension.
- `npm test` - run Vitest unit tests.
- `npm run test:legacy` - run legacy script-based tests.
- `npm run test:e2e` - run Playwright smoke tests.
- `npm run typecheck` - run `tsc --noEmit`.
- `npm run check` - run typecheck, extension build, Vitest, legacy tests, and package checks.
- `npm run verify:release` - run the full release readiness gate: `check`, Playwright E2E, and packaged artifact verification.

For local Chrome/Edge extension testing, build first and load the generated `dist/` directory or packaged output as the unpacked extension. Do not load the repository root directly.

Before claiming release readiness, run `npm run verify:release` and inspect the output. The release readiness matrix is `docs/superpowers/release-readiness.md`; keep it aligned with manifest entries, package artifacts, and the current no-`debugger` permission boundary.

## High-level architecture

### 1. Extension boot flow

- `public/manifest.json` declares the MV3 extension entries consumed by the build/package flow.
- `src/background/index.ts` is the source-owned service worker entry and wires extension events, runtime messages, side-panel behavior, browser-control tools, DevTools Network bridge state, and local tool runtimes.
- `src/content/index.ts` is the content script source used for page context extraction and floating side-panel activation; the build emits it as `content/index.js`.
- Built extension pages and scripts are loaded from `dist/` or the packaged artifact, not from source paths in the repository root.

### 2. Browser AI Assistant side panel

`src/side-panel/` owns the React side-panel UI, including chat, history, tool settings, MCP configuration, browser-control preferences, attachments, and runtime status surfaces. Keep new side-panel behavior in React components and local hooks instead of reintroducing generated DOM patch files.

### 3. Background and tools

`src/background/` owns the service worker runtime. Key boundaries include:

- `agentToolsMessageHandler.ts` for `agentTools.*` configuration, MCP discovery/calls, and audit log messages.
- `networkDevtoolsBridge.ts` and `browserControl/networkToolExecutor.ts` for DevTools Network snapshot/detail tooling.
- `imagefreeToolRuntime.ts` for the Imagefree local tool hook.
- `browserControl/` modules for page automation and controlled browser actions.

Shared tool contracts and pure logic should live under `src/shared/` when they are consumed by multiple runtime surfaces.

### 4. DevTools Network compatibility

`src/devtools/network.html` and `src/devtools/network.ts` own the DevTools Network compatibility page. They collect request snapshots/details through `chrome.devtools.network`, apply redaction before background handoff, and keep the bridge read-only by default.

### 5. New-tab page structure

`src/pages/newtab/` owns the Moon Tab new-tab experience. Keep DOM orchestration, settings boundaries, and shared search helpers in the existing local structure unless a broader migration explicitly changes that ownership.

### 6. Maintenance rules

- Do not restore deleted no-build root extension artifacts such as a root manifest, root content script, or root service worker.
- Keep extension loading guidance tied to build output (`dist/` or packaged artifact).
- Prefer existing source-owned TypeScript/React modules over generated legacy bundles or DOM patch files.
- When updating runtime behavior, run the narrowest relevant test first, then broaden to `npm run check` when the change affects shared contracts or build/package flow.
