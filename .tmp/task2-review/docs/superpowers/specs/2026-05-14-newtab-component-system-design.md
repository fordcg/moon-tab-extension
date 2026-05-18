# New Tab Component System Design

## Context

The current new tab page has already moved toward a warm cat-and-dog visual direction, but the component language is still inconsistent. The top-right search actions look like ordinary standalone buttons, the search shell feels heavier than the reference image, and supporting widgets do not yet read as one coherent family.

The target for this design is not a button-only polish pass. The goal is to define a reusable component system for the new tab page that matches the reference image's warm, soft, desktop-widget style. The search box is one application of that system, not the entire scope.

## Goals

- Create a consistent visual component language that feels close to the provided reference image.
- Keep `AI增强搜索` as the clear primary action in the search area.
- Preserve the three search-area actions: `AI增强搜索`, `侧栏`, and `设置`.
- Build both reusable base components and reusable page modules.
- Make the search area, floating widgets, bubbles, and quick links feel like one system instead of separate styled sections.
- Keep the implementation compatible with the current HTML/CSS architecture of the new tab page.

## Non-Goals

- No full application rewrite.
- No framework migration.
- No behavior redesign for search logic, AI decision flow, or sidebar execution.
- No attempt to generalize this component system for unrelated pages outside the new tab page in this phase.

## Design Direction

The reference image establishes a clear style language:

- cream and soft honey surfaces
- very light outlines
- subtle floating depth instead of heavy card shadows
- a strong primary action surrounded by lighter supporting controls
- desktop-like companion widgets around a central search surface
- soft decorative bubbles and note-like cards rather than dashboard panels

This design should preserve the current warm pet theme while tightening the UI into that softer, more reference-aligned system.

## System Structure

The component system is divided into two layers.

### 1. Base UI Layer

This layer defines the smallest reusable visual primitives used across the page.

- `ui-toolbar-group`
- `ui-btn-primary`
- `ui-btn-secondary`
- `ui-btn-icon`
- `ui-input-shell`
- `ui-chip`
- `ui-note-card`
- `ui-float-bubble`

These are visual building blocks, not page-specific modules.

### 2. Page Module Layer

This layer composes the base UI primitives into new-tab-specific modules.

- `widget-search-shell`
- `widget-todo`
- `widget-calendar`
- `widget-quicksites`
- `floating-bubble` placements around the hero scene

These modules remain specific to the new tab page, but they must be built from the base layer so the page reads as one family.

## Naming Convention

Use explicit prefixes to separate responsibilities:

- `ui-*` for reusable controls and shared visual primitives
- `widget-*` for finished page modules
- `layout-*` for positioning and composition wrappers where needed

This keeps reusable component styling distinct from page-only assembly code.

## Visual Rules

### Color

Use a restrained warm palette built from the existing token set:

- cream, parchment, and soft honey for surfaces
- honey-yellow as the main action color
- apricot and peach only as light accents
- brown ink tones for text

The primary accent color must be reserved mainly for the main CTA and small emphasis points. Secondary controls should stay on pale cream surfaces.

### Border and Shadow

- Borders should be thin and warm, not gray and not high-contrast.
- Shadows should be shallow and soft.
- Depth should come more from layering and highlight than from strong drop shadows.

### Radius

Use three clear radius tiers:

- large radius for shells and major containers
- medium radius for buttons and input shells
- pill or near-pill radius for chips and micro-labels

This avoids the current tendency for everything to feel uniformly rounded.

### Hierarchy

- Only one strong CTA should dominate a given control cluster.
- Supporting actions should be visibly quieter.
- Small widgets should not visually compete with the main search shell.

### Surface Language

Cards should feel like notes, stickers, or desktop accessories rather than dense dashboard panels. Large framed sections should be visually lighter than the current implementation.

## Base Components

### `ui-toolbar-group`

Purpose: group the search actions into a single visual tool cluster.

Rules:

- soft cream group background
- light outline
- compact spacing
- shared baseline and height alignment
- enough internal padding to feel like one object, not three separate buttons

### `ui-btn-primary`

Purpose: represent the dominant action for the current module.

Primary use:

- `AI增强搜索`

Rules:

- warm honey gradient or similarly soft highlighted surface
- slightly larger presence than neighbors
- stronger text weight
- subtle inner highlight allowed
- must read as the primary control from a glance

### `ui-btn-secondary`

Purpose: represent supportive but still visible actions.

Primary use:

- `侧栏`

Rules:

- pale surface
- light border
- lower contrast than the primary button
- same general height family as the primary button

### `ui-btn-icon`

Purpose: provide compact tool access without competing with the main CTA.

Primary use:

- `设置`

Rules:

- icon-only presentation
- aligned size with secondary controls
- same surface family as secondary controls
- quiet but discoverable

### `ui-input-shell`

Purpose: frame text entry areas in the same component language.

Rules:

- lighter than the current heavy search card feel
- soft outline
- minimal visual noise
- should read as part of the same system as the toolbar group

### `ui-chip`

Purpose: lightweight labels, small filters, and compact context markers.

Primary use:

- search target labels such as `目标 Bing`
- small state markers

Rules:

- small scale
- high roundness
- restrained fill contrast

### `ui-note-card`

Purpose: reusable note-like widget surface for support modules.

Primary use:

- todo widget
- quick site block
- small grouped content areas

Rules:

- soft paper-like background
- compact framing
- light depth

### `ui-float-bubble`

Purpose: decorative or helper bubbles around the hero area.

Rules:

- light, airy container
- small scale
- visually companion-like, not modal-like

## Page Modules

### `widget-search-shell`

This is the main stage of the page and should contain:

1. badge / small identity label
2. grouped search actions
3. target selector
4. input surface
5. helper copy
6. AI status and AI preview area

The search shell should feel like a refined note or desktop search pad rather than a generic application card.

### Search Action Group

The action cluster should be restructured to:

- keep all three actions
- rename the current main button from `AI预览` to `AI增强搜索`
- remove any preview-only wording that implies a separate feature that does not exist
- visually unify the three actions within one grouped control

Final hierarchy:

- primary: `AI增强搜索`
- secondary: `侧栏`
- icon: `设置`

### Search Input Composition

The search target selector, input field, and helper hint should feel like one continuous search tool. The target control should visually belong to the same system and not feel detached from the input.

### `widget-todo`

Role:

- left-side companion widget

Rules:

- smaller and lighter than the search shell
- uses note-card language
- should add personality without stealing focus

### `widget-calendar`

Role:

- right-side companion widget

Rules:

- soft compact widget
- visually balanced against the todo widget
- decorative and useful, but visually secondary

### `widget-quicksites`

Role:

- bottom support block for common destinations

Rules:

- compact, lightly framed
- icon-led
- must feel attached to the same paper-like environment

### Floating Bubbles

Role:

- small helper or decorative prompts around the main search composition

Rules:

- sparse placement
- lighter than content cards
- should reinforce the playful desktop atmosphere

## Layout Composition

### Primary Focus

The main search shell remains the visual center of the page. All supporting widgets should orbit it rather than compete with it.

### Distribution

The reference image suggests a loose, companion-style composition rather than rigid symmetry. The layout should therefore be organized but not mechanically balanced.

Recommended distribution:

- left: todo widget
- right: calendar widget
- upper and upper-right: floating bubbles
- lower area: quick sites
- center: title + search shell

### Internal Search Layout

The search shell should read in three stacked layers:

1. top rail: badge plus grouped actions
2. core input area: target selector plus main input
3. support layer: hint, AI status, and AI preview

This produces a tighter and more coherent experience than the current visually separated structure.

### Responsive Behavior

On narrow widths:

- preserve the integrity of the search shell first
- allow surrounding widgets to move below or reduce emphasis
- maintain hierarchy even if exact desktop placement changes

The mobile or narrow layout should preserve emphasis, not exact decorative positioning.

## Interaction and Behavior Constraints

- No feature should be renamed in a way that misrepresents its actual behavior.
- Search behavior and AI preview behavior stay functionally consistent with existing logic.
- The redesign should preserve accessibility labels and keyboard reachability.
- Existing controls should remain identifiable in DOM structure where practical to reduce JS integration risk.

## Implementation Strategy

Recommended implementation approach:

1. extend and normalize the token layer where needed
2. introduce the new `ui-*` and `widget-*` classes
3. refactor the search action group markup minimally to support grouped controls
4. retheme the search shell around the new component language
5. retheme surrounding widgets to use the same note-card and bubble system
6. adjust responsive CSS to keep hierarchy stable

This should be done as a controlled structural polish pass, not a broad rewrite.

## Testing Strategy

### Visual Verification

- verify the top-right action group clearly reads as one grouped control
- verify `AI增强搜索` is visually dominant
- verify surrounding widgets are secondary to the search shell
- verify the page as a whole feels closer to the provided reference image

### Functional Verification

- `AI增强搜索` still toggles and reflects AI search state correctly
- `侧栏` still opens the AI sidebar
- `设置` still opens settings
- search target selector still works
- AI preview and status areas still appear correctly

### Responsive Verification

- desktop layout maintains the intended companion-widget composition
- narrow widths preserve search-shell clarity and usable controls
- no overlapping text or broken control sizing

## Risks

- Over-preserving current markup can limit visual fidelity.
- Over-changing layout structure can create avoidable regressions in JS hooks.
- Decorative widgets can become too loud if scale and contrast are not tightly controlled.

The implementation should therefore prefer minimal structural edits with deliberate CSS and class refactoring.

## Recommendation

Proceed with a component-skin approach anchored by reusable `ui-*` primitives and new-tab-specific `widget-*` modules, while allowing selective layout tightening in the search shell and supporting widgets. This is the best balance between reference fidelity, reuse, and implementation safety.
