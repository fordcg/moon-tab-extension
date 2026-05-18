# Newtab Warm Cat-Dog Redesign

**Date:** 2026-05-14

## Goal

Replace the current dark synthwave new tab experience with a warm, cute, flat UI built around a cream stationery palette and cat-dog dual mascots, while preserving the current search, AI preview, suggestions, and settings behavior.

## Validated Direction

The user-approved direction is:

- warm cream stationery color system
- cute flat UI, not glossy or sci-fi
- cat and dog dual protagonists
- "title companion" layout, where the mascots flank the title area
- complete visual rewrite is allowed

The user explicitly does **not** want a rabbit theme. The rabbit option only validated the palette and softness level.

## Product Intent

This page is a frequently used browser surface, not a one-off landing page. The redesign therefore needs:

- immediate search clarity
- low visual fatigue over repeated use
- clear mascot presence without turning the page into a full illustration poster
- preserved utility for AI-related flows and settings

## Scope

This redesign includes:

1. new page-level color, typography, spacing, and component styling
2. new hero composition with cat and dog visual companions in the title row
3. simplified flat search shell
4. redesigned suggestion, AI preview, and settings surfaces to match the new system
5. responsive updates for the new layout
6. reduced-motion-safe motion updates where current animation feels too technical

This redesign does not include:

- changing extension behavior outside `src/pages/newtab`
- rewriting controllers unless required by small structural adjustments
- adding new product features
- introducing remote assets or heavy illustration dependencies

## Design System

### Visual tone

- warm
- friendly
- flat
- soft but not childish
- stationery-like rather than toy-like

### Palette

Core palette:

- page background: cream / paper (`#fff9ef` class of tone)
- panel background: warm off-white
- primary accent: honey yellow
- secondary accent: soft apricot
- support accent: peach pink
- text: cocoa / warm brown instead of blue-gray
- borders: light biscuit / sand tones

The palette should stay light-mode first. The existing dark `color-scheme` assumptions should be removed from the page-level visual system.

### Typography

- keep the current local sans stack for reliability
- use stronger size hierarchy and softer color contrast rather than dramatic font changes
- title should feel like a desk note heading, not like a sci-fi brand lockup

### Shape and elevation

- rounded corners stay, but less inflated than the current futuristic shell
- mostly flat fills with thin warm borders
- shallow, diffuse shadows only where needed for depth separation
- no glowing cyan outlines, neon sweeps, or technical scan effects

## Layout

### Primary structure

The page becomes a centered single-column composition:

1. mascot title band
2. search card
3. search status / AI status
4. suggestions dropdown
5. AI preview card

### Title band

The heading area uses:

- cat avatar on the left
- title and short supporting line in the center
- dog avatar on the right

The mascots are not large scene illustrations. They are compact flat character blocks or badges that frame the title.

### Search card

The search surface becomes a flat paper-card form:

- utility buttons in the top-right area of the card
- search target chooser integrated cleanly into the form
- large comfortable input field
- clear CTA state without bright technical treatment

### AI preview and settings

These surfaces adopt the same paper-card language:

- warm background
- rounded corners
- thin borders
- clear readable text
- buttons that look like stickers or flat stationery controls

## Mascot Rules

To prevent the theme from becoming noisy, mascot usage is constrained to:

1. title companions
2. selected small decorative markers in buttons, empty states, or section labels
3. optional tiny motif accents inside AI preview or settings, if they do not compete with content

The mascots should not:

- become repeated wallpaper elements
- appear inside every control
- distort the search box into a novelty shape
- overwhelm the functional reading order

Character balance:

- cat: sharper, more alert expression
- dog: softer, more relaxed expression

## Motion

Motion should be minimal and soft:

- small hover lift or color shifts
- subtle title-band idle movement if any
- no orbit rings, scanlines, star streaks, or pulsing technical lines

Reduced motion must remove decorative movement cleanly.

## Components

### Search target trigger

- becomes a flat segment within the search card
- still clearly interactive
- selected target remains visible before typing

### Suggestion list

- paper dropdown with warm separators
- highlighted row uses soft honey fill
- action rows remain visually distinct without feeling technical

### AI state indicator

- friendly short status line
- color-coded with warm semantic tones
- no console-like styling

### AI preview

- reframed as an assistant note card
- current data sections remain, but labels become lighter and more human-facing
- actions stay explicit and easy to scan

### Settings modal

- modal becomes a warm dialog sheet
- keep current form layout with smaller visual cleanup only where it improves clarity
- preserve test/save flows and current DOM contracts where possible

## Data Flow and Behavior

Behavior remains unchanged in principle:

- search target switching still drives search execution
- direct navigation still bypasses search
- AI search enhancement still depends on configuration state
- suggestion fetching and history still work as they do now
- settings and side panel triggers still call the existing controller logic

The redesign should prefer preserving DOM ids and controller hook points so the runtime code continues to work with minimal changes.

## Error Handling

The redesign must keep error and status communication visible:

- search errors remain readable against the light background
- settings save/test results remain prominent
- disabled states must still be obvious

Warm styling must not reduce contrast for status messaging.

## Verification

The redesign is complete only if:

1. the new tab page loads without the old synthwave scene
2. search input, search target menu, and suggestions still work
3. AI toggle and AI preview still render correctly
4. settings modal still opens, closes, and preserves form usability
5. the layout remains coherent on desktop and mobile widths
6. focus states and reduced-motion handling still exist

## Risks

### Hidden layout dependencies

Some current runtime pieces assume specific wrapper structure and ids. The redesign should avoid changing those contracts unless required.

### Contrast drift in light mode

The page is currently tuned around dark surfaces. Light-mode restyling needs deliberate text, border, and focus contrast choices.

### Over-theming

The cat-dog concept can easily become gimmicky. The title-companion constraint is the guardrail that keeps the page usable.

## Success Criteria

This redesign succeeds when the page feels like a warm stationery-based cat-dog homepage at first glance, while all existing new tab interactions remain available and credible for daily use.
