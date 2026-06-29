# Product

## Register

product

## Users

Browser users who live in the new-tab surface and need a fast place to search, open known URLs, manage lightweight widgets, and optionally route searches through an AI-assisted refinement flow. They are often working in short sessions, switching context quickly, and need the page to stay usable even when extension APIs, network calls, or AI configuration fail.

## Product Purpose

This Manifest V3 extension replaces the browser new tab with a custom Chinese-language search workspace. Success means the search box is immediately usable, direct URL and default search flows always work, AI enhancement remains optional and trustworthy, and settings explain enough for users to configure endpoints without losing confidence.

## Brand Personality

Warm, precise, playful. The interface uses moonlit paper, pet, sticker, and widget cues, but the product behavior should feel dependable and tool-like rather than decorative or mysterious.

## Anti-references

Avoid fragile JS-gated primary controls, low-contrast warm-paper text, CJK labels forced into uppercase tracking, dense AI choice surfaces, hidden recall-only interactions, and color-only focus states. Do not let decorative warmth undermine search speed, accessibility, or trust.

## Design Principles

1. Search is the baseline: render it usable before enhancements load.
2. Trust is earned through clear state, local-storage reassurance, and graceful AI fallback.
3. Product clarity beats decorative density; one primary action should dominate each decision point.
4. CJK typography should read naturally, with no uppercase or heavy tracking borrowed from Latin UI tropes.
5. Interactive controls need visible keyboard focus, AA contrast, and mobile touch targets that respect real use.

## Accessibility & Inclusion

Target WCAG AA for body-size text, placeholders, semantic status messages, and focus-visible states. Maintain no-JS-safe core search markup, keyboard operation for menus and actions, reduced-motion coverage, and mobile controls at or above 44px where touch interaction is expected.
