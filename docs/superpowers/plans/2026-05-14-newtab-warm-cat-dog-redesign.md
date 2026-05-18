# Newtab Warm Cat-Dog Redesign Plan

**Date:** 2026-05-14

## Objective

Implement the warm flat cat-dog redesign for `src/pages/newtab` without regressing the existing search, AI preview, suggestion, and settings flows.

## Steps

1. **Rebuild the page structure for the new hero**
   - Remove the old synthwave decorative scene from `src/pages/newtab/index.html`
   - Add a compact title band with cat and dog companion blocks
   - Keep current ids for interactive elements

2. **Replace the design tokens**
   - Rewrite `src/pages/newtab/styles/tokens.css` for the warm stationery palette
   - Switch page-level `color-scheme` assumptions to light-first
   - Define consistent flat borders, shadows, radii, and semantic status colors

3. **Rewrite page/layout/search styles**
   - Update `base.css`, `scene.css`, and `search.css`
   - Remove technical background effects and futuristic search styling
   - Implement the single-column card layout and title companion treatment

4. **Restyle AI preview and settings surfaces**
   - Update `ai-preview.css` and `settings.css`
   - Preserve component behavior while aligning the visuals to the new system

5. **Clean responsive and motion layers**
   - Replace outdated responsive rules with layout-specific breakpoints
   - Simplify motion rules and ensure reduced-motion coverage

6. **Verify behavior**
   - Run a syntax/load sanity check
   - Manually inspect key wiring in markup vs controller expectations
   - Summarize any remaining gaps

## Constraints

- Preserve DOM ids used by the controllers
- Keep behavior changes out of scope
- Avoid introducing external assets or remote dependencies
- Keep the theme expressive but not noisy
