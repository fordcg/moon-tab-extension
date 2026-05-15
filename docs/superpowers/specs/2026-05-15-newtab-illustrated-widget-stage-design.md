# Newtab Illustrated Widget Stage Design

Date: 2026-05-15
Status: Draft approved in chat, written for review

## Goal

Redesign the newtab page so the desktop experience closely matches the provided warm illustrated reference style while preserving the existing widget runtime, search flows, AI preview flows, settings modal, and widget hide/restore behavior.

The target is not a direct copy of the reference image. The target is a new UI with the same composition class, material feel, and control temperament:

- warm cream paper-like background
- centered wide search card as the dominant focal point
- small floating side widgets around the main card
- bitmap-led decorative assets instead of CSS/SVG-heavy ornament
- soft rounded cards, shallow warm borders, and low-contrast shadows

## Scope

This design covers:

- desktop-first newtab visual redesign
- bitmap asset generation and integration
- default widget stage composition
- widget shell visual redesign
- search card visual redesign
- panel visual redesign
- responsive fallback behavior

This design does not change:

- widget storage contract
- search execution logic
- AI runtime logic
- settings form fields and semantics
- sidebar bridge behavior

## Product Constraints

1. Existing runtime behavior must remain intact:
   - widgets can still be hidden and restored
   - widget panel still works
   - search widget remains core and always recoverable
2. Desktop is the priority target.
3. Mobile only needs clean degradation, not visual parity with desktop.
4. Decorative illustration should be bitmap-first.
5. Existing inline SVG pet badges should be removed from the hero UI and replaced by generated bitmap assets.
6. Interactive surfaces must remain real DOM, not baked into a single image.

## Visual Direction

### Overall Mood

The page should feel like a soft illustrated desktop stage:

- cream, oat, apricot, honey, and light caramel tones
- blurred glow and paper haze in the background
- gentle sticker-like widgets around a central search card
- rounded corners with subtle tactile depth
- low-contrast outlines instead of stark borders

The page should read as quiet and tactile, not glossy, neon, geometric, or app-dashboard-like.

### Composition

The desktop layout should default to a staged composition:

- `search`: centered and dominant
- `todo`: floating on the left side and slightly lower than the search title line
- `calendar`: floating on the right side and slightly lower than the search title line
- `quicksites`: smaller floating card below the search card
- title: visually attached to the upper edge of the search card rather than separated into a conventional header strip
- decorative prompt bubbles: placed upper-left, upper-center, and upper-right around the search card

This should feel intentionally composed, not like a grid of equal cards.

If a side widget is hidden, the scene should keep its stage-like negative space rather than reflowing into a dense utility grid.

## Asset Strategy

The redesign should be bitmap-led, with generated assets integrated into the existing HTML/CSS structure.

### Asset Groups

1. Hero ambient background
   - warm cream paper texture
   - diffuse glow
   - soft atmospheric haze

2. Animal character set
   - rounded cat and dog faces for the hero title area
   - a left-side peeking cat near the todo widget
   - a right-side companion animal near the calendar widget
   - an optional mini paired animal sticker near the lower quicksites area
   - close in spirit to the provided example
   - softer and more polished than the current SVG treatment

3. Prompt bubbles
   - small rounded conversational stickers above the hero
   - used as decorative companion prompts

4. Ambient ornaments
   - cloud ribbon or mist strip
   - small sparkles or light flecks
   - soft corner accents

5. Small decorative accents
   - paw print accent
   - fish-shaped accent
   - bone or toy accent
   - star sparkle accent
   - cloud puff accent
   - paper tape or sticker-corner accent
   - all accents should remain sparse and supportive rather than dense

6. Widget ornaments
   - small bitmap sticker details for todo, calendar, and quicksites
   - used as accents, not as full-card screenshots

### Expected Asset Paths

- `src/pages/newtab/assets/hero/desktop-bg-ambient.png`
- `src/pages/newtab/assets/hero/pet-duo-badge.png`
- `src/pages/newtab/assets/hero/pet-left-peek.png`
- `src/pages/newtab/assets/hero/pet-right-buddy.png`
- `src/pages/newtab/assets/hero/pet-mini-pair.png`
- `src/pages/newtab/assets/hero/cloud-ribbon.png`
- `src/pages/newtab/assets/hero/hint-bubble-1.png`
- `src/pages/newtab/assets/hero/hint-bubble-2.png`
- `src/pages/newtab/assets/hero/paw-accent.png`
- `src/pages/newtab/assets/hero/fish-accent.png`
- `src/pages/newtab/assets/hero/bone-accent.png`
- `src/pages/newtab/assets/hero/star-sparkle.png`
- `src/pages/newtab/assets/hero/cloud-puff.png`
- `src/pages/newtab/assets/hero/tape-sticker.png`
- `src/pages/newtab/assets/widgets/todo-sticker.png`
- `src/pages/newtab/assets/widgets/calendar-sticker.png`
- `src/pages/newtab/assets/widgets/quicksites-sticker.png`

Final filenames may vary slightly during implementation, but the asset split should remain comparable.

## Layout Model

### Stage Container

The current newtab hero area should become a positioned desktop stage:

- large centered composition zone
- fixed-width desktop focal layout
- layered decorative background behind real interactive DOM

The widget runtime remains the source of truth for widget presence, but the default desktop arrangement is visual-stage-driven rather than stack-driven.

### Widget Placement Rules

Desktop default anchors:

- search: center
- todo: left-lower beside the search card
- calendar: right-lower beside the search card
- quicksites: lower center
- title: upper-left aligned with the search card
- prompt bubbles: top-left, top-center, top-right

Desktop composition relationships should intentionally echo the reference:

1. The search card owns the full visual center.
2. The title sits close to the search card instead of behaving like a distant page header.
3. The todo widget sits near the lower-left shoulder of the search card.
4. The calendar widget sits near the lower-right shoulder of the search card.
5. The quicksites widget reads like a small attached note centered below the search card.
6. Decorative bubbles and ambient ribbons frame the composition without covering controls.

Behavior rules:

1. Search remains the anchor and should never visually drift.
2. Hidden companion widgets disappear from their anchored position.
3. Restored widgets return to their default anchored position.
4. If runtime order changes, desktop stage classes can still map widget ids to named visual slots.
5. Hidden side widgets should leave composed negative space rather than trigger dense auto-packing.

This preserves the runtime contract while allowing a curated first-screen composition.

## Search Card Design

The search card should be redesigned as the main paper card in the scene.

### Card Shape

- wide, horizontally oriented
- lower height than the current stacked utility card
- rounded corners with a soft paper edge
- warm border, faint highlight, and shallow shadow

### Controls

The top-right search actions should become compact pill controls:

- AI toggle
- preview-related action surface
- sidebar trigger
- settings trigger

These should read like small paper capsules, not tooling chrome.

### Search Target

The search target selector should be visually integrated into the card as a small internal tag or chip, rather than reading as a separate toolbar block.

### Input Area

- larger, calmer placeholder treatment
- more horizontal breathing room
- lower contrast supporting text
- softer typography hierarchy

### AI Preview

The AI preview panel should visually inherit the same card system:

- lighter than the main search card
- reads like an attached note or secondary paper slip
- keeps all current ids and runtime hooks intact

## Widget Card Design

All non-core widgets should become compact floating paper notes.

### Shared Shell

The widget shell should move toward:

- thinner warm border
- smaller radius than current generic card styling where needed
- shallow warm shadow
- quiet title treatment
- hide button styled as a subtle paper-icon control

### Todo Widget

Should resemble a handwritten checklist note:

- vertical mini-card
- checklist rhythm
- optional sticker accent
- soft list separators or dots

### Calendar Widget

Should resemble a tiny desk calendar or date sticker:

- compact monthly card
- strong date grid legibility
- decorative badge or corner sticker

### Quicksites Widget

Should resemble a small favorites card:

- compact horizontal card
- 3 clearly separated destinations
- each target reads like a rounded icon chip or mini badge

## Header and Decorative Bubbles

The current title band should be reworked into a lighter illustrated header cluster:

- bitmap pet duo badge near the title
- additional companion animal accents near the side widgets
- title aligned close to the search card
- two or three floating decorative prompt bubbles

These bubbles are decorative first. They do not need to become new interactive product features in this redesign.

Animal and decorative assets should follow these constraints:

- they support the hero scene without overpowering the search card
- they stay in the same warm cream, oat, apricot, and honey palette family
- they should feel polished and cute, but not childish or toy-store loud
- decoration density should stay restrained; empty space is preferred over clutter

## Widget Panel Design

The add-widget panel remains functional but should visually match the new paper system:

- small paper sheet appearance
- warm border and shallow shadow
- panel-specific row styling
- low visual dominance relative to the main scene

The panel should continue to support:

- visible/hidden state copy
- restore buttons
- closed-by-default behavior

## Responsive Strategy

Desktop is the fidelity target. Mobile and narrow widths should degrade cleanly.

### Desktop

- staged composition
- anchored side widgets
- full decorative asset treatment

### Narrow Widths

- collapse toward a vertical flow
- keep search first
- move companion widgets below
- reduce decorative asset prominence
- avoid overlap between floating ornaments and interactive content

Mobile does not need to replicate the exact scene composition.

## Accessibility and Interaction

1. All interactive elements remain real buttons, links, inputs, and sections.
2. Decorative images should use empty alt text or `aria-hidden` when non-semantic.
3. Contrast must remain acceptable despite the low-contrast warm palette.
4. Hidden/restore widget controls must preserve current keyboard and runtime behavior.
5. Search and settings flows must remain unaffected by visual restructuring.

## Implementation Outline

The likely implementation shape:

1. Generate bitmap asset set with `imagegen`.
2. Replace current hero decorative SVG/CSS ornament with image-backed layers.
3. Introduce stage-layout classes for widget ids on desktop.
4. Restyle widget shell and widget content surfaces to match the paper-note system.
5. Restyle search card into the central paper slab.
6. Tune panel styling and desktop spacing.
7. Verify runtime behaviors still pass the existing verifier.

## Testing Requirements

The redesign is not complete until all existing newtab runtime checks still pass, especially:

- widget root present
- hide/restore flow
- search target interactions
- suggestions behavior
- settings modal open/close
- AI preview generation and switching
- malformed layout recovery

In addition, visual verification should confirm:

- desktop default composition matches the staged reference direction
- pet badge is bitmap-based
- current SVG pet treatment is no longer used in the hero
- decorative assets do not cover interactive controls

## Risks and Mitigations

### Risk 1: Too much of the scene becomes decorative bitmap

Mitigation:
- keep all interactive shells in DOM/CSS
- use bitmap only for ambient and ornamental layers

### Risk 2: Runtime-driven widgets fight the staged composition

Mitigation:
- assign widget-id-based placement classes for default desktop positions
- preserve runtime visibility logic

### Risk 3: Reference matching becomes too literal

Mitigation:
- match composition, softness, and material system
- avoid direct copying of exact illustration forms

### Risk 4: Mobile gets cluttered

Mitigation:
- treat mobile as a simplified fallback
- reduce or reposition decorative assets under narrow widths

## Acceptance Criteria

The redesign is successful when:

1. The desktop first screen clearly reads as a warm illustrated stage centered on a wide paper-like search card.
2. The current SVG pet artwork is replaced by generated bitmap artwork.
3. The widget system still supports hide, restore, and runtime-driven assembly.
4. The default widget arrangement visually matches the reference composition class:
   - left companion card
   - right companion card
   - lower center companion card
   - central dominant search card
5. Existing verifier coverage for newtab behavior continues to pass.
