# GAME DECK Creature Worker Assets Design

Date: 2026-05-19
Status: Draft approved in chat, written for review

## Goal

Generate a black-and-white creature-based asset set for the `GAME DECK` mining scene so the current stick-figure workers and simplified storage presentation can be replaced with expressive bitmap sprites.

The target is not a full UI restyle. The target is a focused asset package that preserves the current page's stark line-art identity while making mining and hauling read as smooth, cute, game-like motion.

## Scope

This design covers:

- miner creature sprite asset design
- hauler creature sprite asset design
- warehouse sprite asset design
- animation frame count and motion language
- black-and-white rendering constraints
- final asset packaging for browser integration

This design does not cover:

- rewriting the game economy
- adding more worker roles
- recoloring the page into a warm illustrated palette
- changing the ore mountain into a painted asset
- final code integration details beyond the constraints the assets must support

## Product Constraints

1. The current game page visual system remains the anchor:
   - white background
   - black outline language
   - restrained grayscale only
   - no full-color character treatment
2. Smooth motion is more important than minimizing frame count.
3. Mining and hauling should be readable without relying on humanoid workers.
4. Miner and hauler must be the same creature species.
5. Role differentiation should come primarily from accessories.
6. Assets should be delivered on transparent backgrounds for DOM-based integration.
7. Left-facing motion should come from runtime mirroring, not separate left-facing sprite sheets.

## Core Character Direction

Use one shared creature archetype: a round-headed, short-legged, compact black-and-white small beast.

The creature should read as:

- soft and cute rather than realistic
- energetic rather than sleepy
- simple enough to stay legible at small in-game size
- physically bouncy enough to support headbutt mining

The body should feel like a compact bean or mochi-like animal, but still stay within the hard-edged `GAME DECK` visual language through clean black outlines and limited gray fills.

## Role Split

### Miner Creature

The miner is the same creature species with mining-oriented accessories:

- black headband or forehead guard
- thicker padded forehead plate or reinforced brow area
- no carried basket

The miner's silhouette should make the head the obvious striking surface so the headbutt animation reads instantly.

### Hauler Creature

The hauler is the same creature species with transport-oriented accessories:

- back basket or side basket
- visible harness or strap accents
- no reinforced forehead pad

The hauler should still look agile. The basket should not make the silhouette top-heavy or mechanically complex.

## Warehouse Direction

Replace the current abstract storage presentation with a small line-art warehouse or storage bin sprite that still matches the page's monochrome system.

The warehouse should read as:

- a compact receiving station
- front-facing or slight side-view storage box
- clear intake slot or door flap
- clean black outlines with minimal gray tone

The warehouse should not become a detailed building illustration. It should remain icon-like and readable at UI scale.

## Visual Style

The asset set should stay firmly inside the current `GAME DECK` language rather than follow the warm pet-page reference image.

Visual constraints:

- black outline dominant
- white base surfaces
- small grayscale shadow accents only
- no warm beige, honey, orange, or pastel fills
- no painterly shading
- no soft airbrush glow
- no sticker-style cream paper rendering

Line behavior:

- slightly rounder than the current worker skeleton
- still crisp and deliberate
- no sketchy rough pencil texture

## Animation Philosophy

The scene should look smooth first and minimal second.

Do not optimize the sprite sheets around the fewest possible poses. Instead, provide enough in-between frames that the miner headbutt and hauler run cycle feel fluid when looped at normal browser animation speed.

The motion language should emphasize:

- squash and stretch
- anticipation before impact
- rebound after impact
- small-foot quick run cycles
- readable load-vs-empty hauling states
- visible warehouse response when ore is received

## Asset Packaging

Deliver three transparent-background sprite sheets:

- `src/pages/game/assets/workers/miner-creature-sheet.png`
- `src/pages/game/assets/workers/hauler-creature-sheet.png`
- `src/pages/game/assets/buildings/warehouse-sheet.png`

Each sheet should contain evenly spaced frames laid out in a single horizontal strip unless implementation constraints later require a grid. A single-row strip is preferred because it keeps slicing logic simple.

## Frame Specification

### Miner Sprite Sheet

Provide 8 frames for the mining loop:

1. stable stand
2. down-squash
3. backward anticipation
4. forward lunge
5. impact contact
6. compressed impact follow-through
7. rebound
8. recovery to stand

This loop should support repeated mining without a harsh snap between the last and first frame.

### Hauler Sprite Sheet

Provide 12 frames total:

- 8-frame running cycle
- 2-frame loading transition
- 2-frame unloading transition

The running cycle must support both empty and loaded hauling. If one unified run cycle is used, the carried-load read must come from the basket silhouette and body posture rather than a second fully separate run set.

### Warehouse Sprite Sheet

Provide 4 frames:

1. closed idle
2. slight open
3. receiving open
4. rebound close

The warehouse reaction should feel springy and responsive, but subtle enough to remain part of the stark UI.

## Framing And Orientation

Use pure side view for both creature roles.

Orientation rules:

- draw only right-facing poses
- runtime mirrors the sprites for left-facing travel
- keep contact points and silhouettes mirror-safe

The warehouse can be front-facing or slight three-quarter view, but it should remain stable across frames so only the intake door or flap moves.

## Integration Constraints

The assets must remain legible at approximately the current worker scale and near-current storage scale. Avoid micro details that disappear when reduced in the live scene.

Important constraints for later implementation:

- transparent PNG output
- consistent baseline across frames
- consistent creature body size across all frames
- basket position stable enough to prevent jitter
- forehead impact zone clearly readable
- enough whitespace around each frame to avoid edge clipping

## Prompt-Level Art Direction

When generating the bitmaps, the prompts should bias toward:

- monochrome side-view game sprite sheet
- cute round-headed short-legged creature
- crisp black outline
- white fill with light gray shading
- transparent background
- clean frame-to-frame consistency
- readable animation poses

The prompts should avoid:

- anime coloring
- painterly rendering
- full-color mascot art
- hand-drawn rough sketch texture
- photoreal fur
- busy prop clutter

## Acceptance Criteria

The asset design is successful when:

1. The miner reads instantly as a creature that headbutts the mountain.
2. The hauler reads instantly as the same creature species with hauling accessories.
3. The black-and-white asset style fits the current `GAME DECK` page without forcing a UI recolor.
4. The motion reads smoothly enough that the game does not feel frame-starved.
5. The warehouse provides a clear receive-feedback animation without becoming visually noisy.
6. All three sprite sheets can be mirrored or sliced cleanly in the browser.

## Verification

Before implementation is considered complete, verify:

- sprite sheets have transparent backgrounds
- frame spacing is even
- frame baselines are stable
- miner loop reads smoothly in sequence
- hauler loop reads smoothly in sequence
- warehouse receive loop reads smoothly in sequence
- assets still read clearly when scaled down to in-game size

## Non-Goals

- adding a second creature species
- making the miner humanoid
- introducing color as the primary differentiator
- replacing DOM animation with a full canvas renderer
- generating mountain, ore, or full-background art in this slice
