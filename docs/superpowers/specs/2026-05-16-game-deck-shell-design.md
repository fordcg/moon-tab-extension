# GAME DECK Shell Design

## Scope

Build the first slice of a second extension page: a standalone game page shell named `GAME DECK`. This slice only covers page navigation, transition quality, and the game page header. It must not add game mechanics, resource panels, logs, save slots, or placeholder content below the header.

## User Experience

The browser new tab still opens the existing pet-themed main page at `src/pages/newtab/index.html`. That page gets a new menu action named `游戏空间`, which opens the standalone game page.

The standalone game page has a cyber terminal / game launcher style inspired by the provided reference: black background, restrained neon green and cyan accents, monospace typography, light scanline treatment, and a polished boot-like transition. The page content for this slice is intentionally minimal:

- Title: `GAME DECK`
- Top bar: return-to-pet-page button, compact search form, clock, and status label

Search on the game page is simpler than the pet page search. Submitting a non-empty query runs a Bing search in the current tab. Empty submit keeps focus in the search input and does not navigate.

## Navigation And Transition

The pet page menu opens the game page through a short animated transition:

1. A full-screen boot overlay appears above the pet page.
2. The overlay shows a short `INITIALIZING GAME DECK` message and scanning motion.
3. After the transition completes, the browser navigates to `src/pages/game/index.html`.

The game page has a return button that mirrors the flow:

1. A shutdown overlay appears above the game page.
2. The overlay shows a short `RETURNING TO PET DECK` message.
3. After the transition completes, the browser navigates back to `src/pages/newtab/index.html`.

The transition should use only `opacity` and `transform` animation. It must respect `prefers-reduced-motion`; reduced-motion users receive a short fade with no scanning movement.

## Files

Create:

- `src/pages/game/index.html` for the standalone game page markup.
- `src/pages/game/index.mjs` for game page header behavior, clock updates, search submit, and return transition.
- `src/pages/game/index.css` for the game page visual style and transitions.
- `src/shared/page-transition.mjs` for shared boot overlay helpers used by both pages.

Modify:

- `src/pages/newtab/index.html` to add the `游戏空间` menu action and a shared transition overlay host.
- `src/pages/newtab/index.mjs` to bind the menu action to the transition and navigation.

## Accessibility And Interaction

All interactive controls use native buttons or forms with visible focus states. The return button has an explicit label. The search input has a visible or screen-reader label. Status text is plain text, not color-only.

The transition overlay is decorative except for its status text; it must not trap focus because it exists briefly before navigation. Buttons should remain at least 44px tall.

## Verification

Run the existing smoke test:

```powershell
python .tmp/verify_newtab_extension.py
```

Add a focused verifier only if the existing smoke test cannot check the new page. The focused verifier should load the unpacked extension, open the pet page, click `游戏空间`, confirm the game page URL and `GAME DECK` title, submit a search, and verify the return button navigates back to the pet page.

Manual checks:

- Pet page menu contains `游戏空间`.
- Transition appears before entering the game page.
- Game page contains only the agreed header shell: `GAME DECK`, return button, search, time, and status.
- Return transition appears before returning to the pet page.
- Reduced-motion mode does not show scanning movement.
