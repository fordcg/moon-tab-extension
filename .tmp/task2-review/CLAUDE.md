# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository scope

This repository is a Manifest V3 browser extension that replaces the browser new tab page with a custom search UI.

The product code is the root `manifest.json` plus `src/`.

Treat these directories carefully when exploring the repo:
- `src/` — actual extension code.
- `.tmp/` — scratch/verification artifacts. The only currently useful project helper here is `.tmp/verify_newtab_extension.py`.
- `tmp/` — external/reference material, not part of the runtime extension shipped from this repo.

## Commands

There is currently **no root-level npm/pnpm/bun build, lint, or test setup** in this repository. Do not assume a JS bundler or package script exists.

Use these commands instead:

- Load the extension for local development as an unpacked extension from the repository root (`manifest.json` is at the root). There is no build step.
- Run the in-repo smoke test:
  - `python .tmp/verify_newtab_extension.py`
  - This launches Chromium through Playwright, loads the unpacked extension, and verifies the main flow: new-tab redirect, homepage render, settings open/close, and default Bing search.
- The smoke test above is also the closest thing to a “single test” in the current repo; there is no separate unit test runner yet.

## High-level architecture

### 1. Extension boot flow

- `manifest.json` declares a Manifest V3 extension with a background service worker at `src/background/newtab-redirect.js`.
- `src/background/newtab-redirect.js` watches `chrome.tabs.onCreated` and `chrome.tabs.onUpdated`.
- When the browser opens a native new-tab URL (`edge://newtab/`, `chrome://newtab/`, `about:newtab`, or `ntp.msn.*`), the worker redirects that tab to the extension page at `src/pages/newtab/index.html`.

This project does **not** use a bundler or `chrome_url_overrides`; new-tab replacement is implemented through runtime tab redirection.

### 2. New-tab page structure

The new-tab page is a plain HTML + native ESM app:

- `src/pages/newtab/index.html` — DOM structure for the homepage, settings modal, AI preview panel, and search input.
- `src/pages/newtab/index.mjs` — main orchestration layer.
- `src/pages/newtab/styles/index.css` — all layout, modal layering, and visual states.
- `src/pages/newtab/liquid-glass-bubble-layer.mjs` — animated liquid-glass background rendered with Three.js.
- `src/pages/newtab/vendor/three.module.js` — vendored Three.js runtime.

The page is tightly coupled by DOM ids/classes. If you change markup in `index.html`, expect corresponding updates in `index.mjs`, `settings/index.mjs`, and CSS selectors.

### 3. Main runtime flow in `src/pages/newtab/index.mjs`

`src/pages/newtab/index.mjs` is the main coordinator. It owns:
- DOM event wiring for the search form, AI toggle, preview actions, and suggestion buttons.
- Search state (`isAiSearchEnabled`, pending/activating flags, active preview).
- Fallback default behavior:
  - direct navigation if the query looks like a URL;
  - otherwise Bing search.
- AI search orchestration when AI is enabled:
  1. read persisted settings;
  2. ensure origin permission for the configured endpoint;
  3. request an AI decision;
  4. normalize the response into a single internal decision shape;
  5. enrich/fix up the decision;
  6. optionally fetch candidate websites;
  7. render a preview;
  8. on second submit or button click, execute the selected action.

Important behavior: if the current query already has an active preview, submitting the same query again executes the preview’s primary action instead of calling the AI again.

### 4. Settings module boundary

`src/pages/newtab/settings/index.mjs` is the boundary for:
- modal open/close behavior and accessibility (`aria-hidden`, `inert`, focus trap, Escape handling);
- Chrome extension storage (`chrome.storage.local`);
- runtime origin permission requests (`chrome.permissions`);
- endpoint/model validation for AI search;
- syncing the persisted AI-enabled flag back into the homepage via callbacks.

Keep storage/permission logic here rather than spreading Chrome API access through `index.mjs`.

### 5. Shared AI contract and normalization

`src/shared/search-ai-contract.mjs` is the shared contract for both search execution and settings-time validation. It centralizes:
- the prompt sent to AI backends;
- JSON fence removal and safe JSON parsing;
- refusal-text detection;
- HTML/gateway error detection;
- heuristics for deciding whether a plain-text response can still be treated as a usable search query.

If you change the expected AI schema or prompt format, review both:
- `src/pages/newtab/index.mjs`
- `src/pages/newtab/settings/index.mjs`

They intentionally share the same parsing assumptions.

### 6. Helper module responsibilities

Two helper modules keep the main orchestrator smaller:

- `src/pages/newtab/helpers/query-utils.mjs`
  - text normalization;
  - mixed Chinese/English term handling;
  - URL/direct-navigation detection.

- `src/pages/newtab/helpers/decision-utils.mjs`
  - normalize heterogeneous AI payloads into the project’s internal decision shape;
  - preserve English technical terms in mixed-language queries;
  - enrich “no-op” search rewrites with better fallback queries;
  - normalize/deduplicate candidate websites.

When changing search semantics, inspect these helpers before editing `index.mjs` directly; many search edge cases are intentionally isolated there.

### 7. UI state conventions worth preserving

A lot of UI behavior is driven by `body` classes toggled from JS, especially in `index.mjs` and `settings/index.mjs`, including:
- `is-settings-open`
- `is-ai-search-enabled`
- `is-ai-search-activating`
- `is-ai-search-searching`

CSS and JS are coupled through those state classes. Replacing them with ad hoc inline styles will usually break existing transitions and modal behavior.

One subtle but important layering rule: the settings modal host must stay above the homepage search shell in CSS. If modal buttons stop receiving clicks, inspect selector specificity around `src/pages/newtab/styles/index.css` before changing JS.
