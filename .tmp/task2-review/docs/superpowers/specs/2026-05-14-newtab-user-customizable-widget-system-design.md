# Newtab User-Customizable Widget System

**Date:** 2026-05-14

## Goal

Turn the new tab page into a user-customizable widget workspace where users can hide and restore page modules directly from the page, while keeping the current search and AI flows stable.

## Validated Direction

The approved direction is:

- the new tab page should be backed by a real component system, not a one-off static page
- users should be able to manage components from the page itself
- component removal is soft-delete only: hidden components can be restored later
- the main recovery/add flow comes from a top-right "add widget" entry
- per-widget direct actions are preferred over a separate full-page edit mode
- implementation should still respect a clean underlying registry and layout-state architecture

## Product Intent

This page is a high-frequency browser surface. Customization must therefore feel lightweight and trustworthy rather than like a dashboard editor. The system should let users remove visual clutter and restore useful modules without making the page feel like an admin tool.

The system is not meant to be a full drag-and-drop builder in the first version. The primary product value is:

1. users can hide nonessential widgets
2. users can restore or add supported widgets later
3. the page still preserves a coherent default structure
4. future widget work lands on a stable system contract instead of more hard-coded page markup

## Scope

This design includes:

1. a widget registry for the new tab page
2. a persisted user layout state in extension storage
3. page rendering driven by registry + layout state
4. per-widget direct actions for hide and future expansion
5. a top-right "add widget" entry that restores hidden widgets and adds eligible widgets
6. a core-widget rule so the page cannot lose essential search capability

This design does not include:

- drag-and-drop sorting in the first version
- freeform grid resizing
- multi-page shared widget customization across the whole extension
- a heavy edit mode or dashboard builder UI
- server-backed sync or account-level personalization

## System Model

The new tab page is treated as a widget workspace assembled from four layers:

1. `ui-*` primitives
2. widget definitions
3. layout state
4. page runtime

### UI Primitives

`ui-*` classes remain the visual foundation. They own shared chrome such as:

- buttons
- note-card shells
- toolbars
- menus
- input shells
- widget frame controls

These primitives do not know what a widget means. They only provide reusable appearance and interaction states.

### Widget Definitions

Each widget is a registered module with a stable identity and lifecycle contract. A definition should include at least:

- `id`
- `title`
- `defaultVisible`
- `canHide`
- `core`
- optional `layoutHint`
- `render(container, context)`
- optional `dispose()`

Widget definitions are developer-owned modules. They describe what the system is allowed to render, but they do not decide the current user layout by themselves.

### Layout State

The current page composition comes from persisted layout state rather than hard-coded page HTML. The layout state decides:

- which widgets are present in the page ordering
- which widgets are currently hidden
- optional widget-level preferences

### Page Runtime

The runtime is responsible for:

- reading the widget registry
- loading and validating stored layout state
- rendering visible widgets in the correct order
- wiring direct widget actions
- opening the "add widget" panel
- updating persisted layout state after user actions

The runtime is the only layer that assembles the page. Widgets remain individually bounded modules.

## User Interaction Model

### Widget-Level Controls

Each non-core widget exposes direct local actions in its own shell. The first version should support:

- `Hide`
- optional `More` placeholder for future widget actions

The action surface should be small and consistent across widgets. Users should not need to enter a separate edit mode.

### Hiding a Widget

When the user hides a widget:

1. the widget is removed from the visible page immediately
2. its id is added to the hidden-widget state
3. a short feedback message may confirm that it can be restored from "Add widget"

This is not destructive deletion. The widget remains part of the known system inventory.

### Add Widget Entry

The page exposes a top-right "Add widget" entry. Activating it opens a lightweight panel that lists:

- widgets that are hidden and can be restored
- widgets that are supported by the registry but not currently rendered

The panel should clearly distinguish:

- `Restorable`
- `Available`
- `Already added`

The first version does not need deep configuration inside this panel. The main job is restore/add.

### Core Widget Guardrail

The primary search widget is a core widget:

- it is always present
- it cannot be hidden
- it anchors the page even if all optional widgets are removed

This prevents the new tab page from becoming nonfunctional or visually empty in a broken way.

## Data Contract

User customization is stored as a small versioned layout object in `chrome.storage.local`.

Recommended shape:

```js
{
  version: 1,
  orderedWidgetIds: ["search", "calendar", "quicksites", "todo"],
  hiddenWidgetIds: ["todo"],
  widgetPrefs: {
    calendar: {},
    quicksites: {},
    todo: {}
  }
}
```

### Field Semantics

- `version`: layout schema version for future migrations
- `orderedWidgetIds`: visible layout ordering source of truth
- `hiddenWidgetIds`: widgets hidden by the user but still restorable
- `widgetPrefs`: widget-local user settings, kept lightweight and optional

Only identity and state should be stored. The system must not persist rendered HTML or style snapshots.

## Registry Contract

The widget registry is a static developer-side inventory of legal widgets. It defines what the runtime can render.

Example shape:

```js
{
  id: "calendar",
  title: "Calendar",
  defaultVisible: true,
  canHide: true,
  core: false,
  render,
  dispose,
}
```

Registry and layout state have different roles:

- registry answers: "what widgets exist?"
- layout answers: "what is this user's current page composition?"

## Rendering Rules

At page startup, the runtime should:

1. load the registry
2. load stored layout state
3. validate and normalize the stored layout
4. ensure core widgets are present
5. render visible widgets in resolved order

Normalization rules:

- unknown widget ids in stored layout are discarded
- hidden core widgets are removed from `hiddenWidgetIds`
- missing core widgets are reinserted
- duplicate ids are deduplicated

When a new widget is added to the registry later, the default first-version behavior should be conservative:

- non-core widgets should appear in the "Available" list rather than auto-inserting into the page
- core widgets should be guaranteed into the page automatically

This avoids silently mutating a user's chosen layout whenever a new release adds more widgets.

## File Structure

Recommended new-tab-local structure:

```text
src/pages/newtab/
  widgets/
    registry.mjs
    layout-state.mjs
    widget-runtime.mjs
    widget-shell.mjs
    definitions/
      search-widget.mjs
      calendar-widget.mjs
      quicksites-widget.mjs
      todo-widget.mjs
```

### Responsibilities

`registry.mjs`

- exports widget definitions
- exposes lookup helpers such as `getWidgetById()` and `listWidgets()`

`layout-state.mjs`

- reads and writes widget layout state from storage
- exposes helpers such as:
  - `loadWidgetLayout()`
  - `saveWidgetLayout()`
  - `hideWidget(id)`
  - `restoreWidget(id)`
  - `ensureValidLayout(registry, layout)`

`widget-runtime.mjs`

- resolves registry + layout into the actual page composition
- mounts, unmounts, and refreshes widget instances

`widget-shell.mjs`

- owns shared widget chrome
- renders title row and widget-level actions
- keeps per-widget controls visually consistent

`definitions/*.mjs`

- each file owns one widget definition
- each widget encapsulates its DOM and behavior attachment

## Migration Strategy for Current Newtab Code

This work should not rewrite the whole page in one shot.

### Search Widget First

The existing search surface becomes the first formal widget:

- `id: "search"`
- `core: true`
- not hideable

This lets the system land without destabilizing the page's primary function.

### Preserve Current Controllers

Current search, AI preview, suggestions, and settings controllers should be preserved as much as possible. The first widget-system pass should wrap and orchestrate existing behavior rather than rewrite it.

The preferred strategy is:

1. keep current ids and controller hook points stable
2. extract mounting boundaries for the search widget
3. move page assembly responsibilities into the widget runtime
4. add new widgets incrementally after the runtime contract works

### New Widget Introduction Order

After the search widget is working under the new runtime, the next widgets should be added incrementally:

1. quicksites
2. calendar
3. todo

This order keeps the core page useful while progressively proving the system against simpler companion widgets first.

## Error Handling

The runtime must fail soft when layout state is malformed or stale.

Required behavior:

- invalid stored layout falls back to a normalized safe layout
- storage read/write failures must not break search availability
- unknown widgets are ignored rather than crashing the page
- hiding/restoring should update UI immediately and persist best-effort

If persistence fails, the page should continue running with in-memory state for the session and surface a lightweight error only if needed.

## Testing and Verification

The system is complete only if:

1. the page still passes existing new-tab smoke verification
2. the search widget remains visible and functional after layout loading
3. hiding a non-core widget removes it immediately
4. hidden widgets can be restored from the add-widget panel
5. stored layout survives page reload
6. malformed stored layout self-heals without breaking the page
7. newly registered non-core widgets do not silently insert into an existing customized layout

Recommended verification coverage:

- runtime unit coverage for layout normalization
- integration coverage for hide/restore persistence
- smoke verification for existing search and AI flows

## Risks

### Half-System Risk

If widgets are still mostly hard-coded in `index.html` after introducing a registry, the codebase will get the complexity cost of a system without the benefits. The runtime must become the page assembler, not just a naming layer.

### Controller Coupling Risk

Existing controllers likely assume stable DOM placement. The migration should preserve ids and established hook points during the first pass to avoid accidental behavior regressions.

### Scope Creep Risk

Drag-and-drop sorting, resize handles, and advanced widget settings are tempting follow-ups, but they should stay out of the first implementation plan. The first version succeeds on hide, restore, persist, and render.

## Success Criteria

This design succeeds when the new tab page behaves like a customizable widget workspace from the user's perspective, while remaining a clean registry-driven system from the codebase perspective.

Concretely:

- users can hide non-core widgets from the page
- users can restore/add supported widgets from a top-right entry
- search remains present and reliable
- layout state persists cleanly
- new widgets can be introduced through the registry without turning the page back into hard-coded markup
