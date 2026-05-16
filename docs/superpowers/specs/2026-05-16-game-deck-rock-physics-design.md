# GAME DECK Rock Physics Design

## Scope

Upgrade the existing `GAME DECK` mining scene from scripted DOM rock drops to image-based falling rocks driven by a local browser physics library. This slice covers a taller ore mountain, randomized transparent rock sprites, physical collision between dropped rocks, and stable rock piling near the mountain base.

This slice does not add pickup flows, inventory, crafting, mountain excavation deformation, or infinite rock persistence.

## User Experience

The player stays on the existing `src/pages/game/index.html` page and interacts with the ore mountain as before. Mining still happens only when clicking the visible mountain silhouette. Each mining click now produces a rock that behaves like a small real stone:

- it launches from the mining point with a short arc,
- lands with light bounce,
- rolls and rotates briefly,
- collides with earlier rocks,
- settles near the mountain base instead of sliding across the whole field.

The mountain becomes visibly larger than the current version: approximately 60% taller, slightly wider, and still rounded at the peak rather than sharp.

Dropped rocks use the three user-provided transparent PNG assets and randomly vary in image choice, size, and starting angular motion so repeated mining does not look repetitive.

## Architecture

Keep the page as native HTML, CSS, and ESM JavaScript. Do not convert the scene to canvas. The physics library is responsible only for simulation. DOM elements remain the rendering layer.

Add a dedicated physics module that owns:

- Matter.js engine and world creation,
- static bodies for the ground and mountain-base settling region,
- rock body creation and removal,
- per-frame syncing from rigid-body state to DOM image transforms,
- sleeping-aware cleanup to support long sessions and future scaling toward roughly 100 rocks.

The existing page module keeps ownership of:

- mountain mining interaction and tooltip behavior,
- ore count and mountain stage updates,
- page search, return navigation, and scene drag behavior.

## Physics Model

Use a vendored local copy of Matter.js loaded from the repository instead of introducing an npm-based toolchain.

Each dropped rock consists of:

- one Matter circular body used for collision and rotation,
- one absolutely positioned DOM element using a transparent PNG background image.

Simulation characteristics:

- gravity strong enough to feel like a falling stone, not a feather,
- low-to-moderate restitution so each rock only bounces lightly,
- medium friction and damping so rocks roll a little, then settle,
- light random angular velocity at spawn,
- sleeping enabled so settled rocks stop consuming full simulation effort.

To keep piles concentrated near the mountain base, add shallow settling geometry near the landing area. This should feel like terrain shaping rather than a visible blocking wall.

The system must be designed for an eventual active cap around 100 rocks. When the cap is exceeded, remove older rocks that are already sleeping and no longer visually important.

## Mountain And Hit Area

Replace the current mountain outline and hitbox set with a taller, broader silhouette:

- approximately 60% taller than the current in-game mountain,
- modestly wider to avoid a tall-and-thin look,
- rounded crest,
- open base aligned to the ground line,
- no ridge or crack lines.

The hit area must continue to follow the active visible mountain stage so empty rectangle clicks do not mine.

## Assets

Use the three user-provided transparent PNG rocks already placed under:

- `src/pages/game/assets/rocks/source/ore-pebble-01.png`
- `src/pages/game/assets/rocks/source/ore-pebble-02.png`
- `src/pages/game/assets/rocks/source/ore-pebble-03.png`

These assets can be used directly at runtime because they already have transparent backgrounds.

Each spawn randomly selects one of the three images and applies a small size range so the pile looks hand-placed rather than repeated.

## Files

Modify:

- `src/pages/game/index.html` for any scene markup needed by the physics-driven rock layer.
- `src/pages/game/index.css` for the taller mountain, image-rock styling, and any physics-layer presentation rules.
- `src/pages/game/index.mjs` to replace scripted landed-rock handling with integration against the physics module.
- `.tmp/verify_newtab_extension.py` to validate the new scene behavior.

Create:

- `src/pages/game/rock-physics.mjs` for Matter.js world setup, rock spawning, syncing, sleeping, and cleanup.
- `src/pages/game/vendor/matter.mjs` or equivalent local vendored module path for the browser physics library.

## Interaction And Error Handling

Mining must still be blocked when the game is paused, when ore is depleted, or when the click lands outside the active mountain silhouette.

If the physics module fails to initialize, the page should fail quietly rather than break unrelated page controls. The search form, return button, and scene shell must remain usable.

Rocks should never block the page-scrolling drag interaction outside the mountain zone more than necessary. Pointer handling should remain scoped to the mining interaction and the rock visuals themselves should not become accidental UI controls.

## Verification

Extend the existing smoke verifier to check:

- the mountain is visibly taller than the prior version,
- dropped rocks use image assets instead of the previous outline-only circles,
- repeated mining creates multiple rocks that remain above ground,
- rocks pile near the mountain base rather than dispersing widely,
- rocks do not visually pass through each other under repeated drops,
- the game page still runs after many spawns without breaking the surrounding page UI.

Run:

```powershell
node --check src/pages/game/index.mjs
node --check src/pages/game/rock-physics.mjs
python .tmp/verify_newtab_extension.py
```

## Non-Goals

- rock pickup or collection mechanics,
- inventory, storage, or resource counters beyond the current ore count,
- destructible or carved mountain terrain,
- pixel-perfect collision based on sprite outlines,
- replacing the full page with a physics canvas,
- supporting unlimited rock accumulation in one session.
