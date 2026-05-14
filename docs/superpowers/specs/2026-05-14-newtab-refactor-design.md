# Newtab Refactor Design

**Date:** 2026-05-14

## Goal

Refactor the `src/pages/newtab` implementation to improve maintainability and file boundaries without changing the visible behavior of the page. The primary target is the oversized `styles/index.css`, with a secondary goal of reducing the most obvious runtime coupling in `index.mjs`.

## Scope

This design covers two changes:

1. Split `src/pages/newtab/styles/index.css` into focused style modules with a stable entry file.
2. Reduce setup and state coupling in `src/pages/newtab/index.mjs` while preserving the existing controller architecture and DOM/class naming.

This design does not cover:

- Visual redesign of the new tab page
- Renaming class names across the page
- Large-scale controller rewrites
- Replacing the current DOM structure
- Cross-page refactors outside `src/pages/newtab`

## Current Problems

### Oversized style entry

`src/pages/newtab/styles/index.css` currently mixes:

- design tokens
- base page rules
- homepage scene visuals
- search shell and suggestions
- AI preview styles
- settings modal styles
- all keyframes
- all responsive rules

This makes it difficult to:

- find the owning section for a rule
- edit one area without scanning unrelated styles
- reason about animation/responsive impact
- safely grow the feature set

### Entry-point setup is carrying too much detail

`src/pages/newtab/index.mjs` currently owns:

- direct DOM querying for many elements
- local runtime state for search target and search history
- cross-controller wiring
- startup sequencing
- several page-level utility callbacks

The file is still understandable, but it is already acting as both a composition root and a runtime state bucket. That is the boundary most likely to keep growing in the wrong direction.

## Desired Outcome

After the refactor:

- `styles/index.css` remains the single imported stylesheet entry
- style rules are grouped by responsibility in separate files
- animation and responsive behavior stay functionally equivalent
- DOM/class names remain stable unless a tiny structural change clearly removes coupling
- `index.mjs` becomes a thinner assembly file
- shared page runtime state moves behind a small helper module instead of raw top-level variables

## Proposed File Structure

### CSS

Keep `src/pages/newtab/styles/index.css` as the only stylesheet imported by the page, but convert it into a lightweight aggregator for:

- `src/pages/newtab/styles/tokens.css`
- `src/pages/newtab/styles/base.css`
- `src/pages/newtab/styles/scene.css`
- `src/pages/newtab/styles/search.css`
- `src/pages/newtab/styles/ai-preview.css`
- `src/pages/newtab/styles/settings.css`
- `src/pages/newtab/styles/responsive.css`
- `src/pages/newtab/styles/motion.css`

#### Ownership rules

`tokens.css`
- `:root` variables only
- no selectors besides token containers

`base.css`
- `*`, `html`, `body`
- page-level shell rules
- shared utility classes such as `.visually-hidden`

`scene.css`
- background layers
- synthwave scene elements
- non-search decorative layers

`search.css`
- search frame
- search target menu
- suggestions
- search status line
- AI toggle shell styles that belong to the search surface

`ai-preview.css`
- AI preview panel
- related query buttons
- website cards
- preview action buttons
- pending visual states that are specific to preview/search enhancement

`settings.css`
- backdrop
- popup
- form layout
- switch/input/button styles inside settings

`responsive.css`
- all media queries
- rules grouped by module inside each breakpoint block

`motion.css`
- all `@keyframes`
- `prefers-reduced-motion` handling

### JavaScript

Preserve the current controller set, but reduce entry-point responsibilities by adding small support modules:

- `src/pages/newtab/dom-refs.mjs`
- `src/pages/newtab/runtime-state.mjs`

#### `dom-refs.mjs`

Responsibility:

- centralize `getElementById` and `querySelector` lookups
- return a structured object used by `index.mjs`

This keeps DOM discovery in one place and stops the entry file from growing every time a new element is added.

#### `runtime-state.mjs`

Responsibility:

- own `currentSearchTarget`
- own `searchHistoryItems`
- expose narrow getters/setters

This reduces callback coupling where multiple controllers currently read and write top-level variables from `index.mjs`.

The existing controllers remain in place:

- `ai-preview-controller.mjs`
- `interactions-controller.mjs`
- `search-target-controller.mjs`
- `startup-controller.mjs`
- `suggestions-controller.mjs`

The refactor should avoid changing their public shape unless a small API cleanup is needed to remove duplicated callback plumbing.

## Coupling Cleanup Included In Scope

This refactor should include a small amount of cleanup beyond file splitting.

### 1. DOM querying moves out of `index.mjs`

The large block of element lookups at the top of `index.mjs` should move into `dom-refs.mjs`. `index.mjs` should receive a grouped structure such as:

- search elements
- AI preview elements
- search target elements
- settings/open-sidebar elements
- startup outline elements

The exact grouping can follow the current controller boundaries.

### 2. Shared mutable state gets a thin owner

Instead of raw top-level variables in `index.mjs`, the page should have a single local runtime helper that exposes:

- `getCurrentSearchTarget()`
- `setCurrentSearchTarget(target)`
- `getSearchHistoryItems()`
- `setSearchHistoryItems(items)`
- `resolveCurrentSearchTarget()` if needed

This keeps the change small while making ownership explicit.

### 3. Repeated page callbacks should be normalized where obvious

If there are multiple callbacks in `index.mjs` that are only adapters around state getters/setters, they should be collapsed when it improves readability. This should stay conservative. The refactor must not chase abstraction for its own sake.

## Implementation Constraints

- Preserve current page behavior.
- Preserve class names unless there is a narrow structural reason to adjust them.
- Preserve current DOM structure as much as possible.
- Avoid rewriting controller internals unless needed for the new boundaries.
- Keep import paths simple and local to `src/pages/newtab`.
- Do not refactor unrelated pages such as `sidebar`.

## Verification Strategy

The refactor is complete only if all of the following are true:

1. The page still loads using the existing stylesheet entry path.
2. Search target menu still renders and switches targets correctly.
3. Suggestion list still opens, highlights, and submits correctly.
4. AI preview still renders, hides, and executes primary/secondary actions correctly.
5. Settings modal visuals and interactions remain intact.
6. Search outline startup animation still works, including reduced-motion handling.
7. Responsive layout remains intact at the existing breakpoints.

Validation should include at least:

- a local build or page load check
- targeted manual verification of the new tab page flows
- a quick diff review to ensure the refactor did not drift into visual redesign

## Risks

### CSS ordering regressions

Splitting the stylesheet can subtly change cascade order. The entry file must preserve the intended order explicitly.

### Breakpoint drift

Moving media queries into `responsive.css` can accidentally separate a base rule from its override. The refactor needs careful side-by-side grouping when extracting rules.

### Hidden runtime coupling

Some controller interactions currently rely on shared entry-file state. Moving that state behind a helper must stay minimal and should not introduce asynchronous or evented complexity.

## Recommended Execution Order

1. Create the new CSS files and move rules without changing behavior.
2. Replace `styles/index.css` with the ordered aggregator.
3. Add `dom-refs.mjs` and move DOM lookup ownership.
4. Add `runtime-state.mjs` and move shared mutable page state behind it.
5. Simplify `index.mjs` into an assembly-oriented entry.
6. Verify key user flows and responsive behavior.

## Success Criteria

This refactor is successful when:

- the stylesheet is split into focused files with stable ownership
- `index.mjs` is materially smaller and easier to scan
- shared state ownership is explicit
- no user-visible regression is introduced in the new tab experience
