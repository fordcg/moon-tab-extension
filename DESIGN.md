---
name: AI Sidebar
description: A calm, Gemini-style assistant panel that disappears into the conversation
colors:
  blue: "#145fd7"
  blue-deep: "#0f4fb8"
  blue-soft: "#eef4ff"
  blue-send-rest: "#a8c6f0"
  blue-send-hover: "#8bb2e8"
  canvas: "#ffffff"
  ink: "#303237"
  ink-strong: "#20242a"
  muted: "#68707d"
  control: "#f3f6fb"
  control-hover: "#eaf0f9"
  row-hover: "#dfe4ed"
  line: "#d8dde8"
  line-soft: "#e8edf5"
  surface-rail: "#f0f4f9"
  surface-rail-line: "#dfe5ef"
  warn-surface: "#fff7f2"
  warn-border: "#f0d8cf"
  warn-ink: "#8b4a3d"
  error: "#c0453f"
  success: "#2f7d55"
typography:
  greeting:
    fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 400
    lineHeight: 1.15
  title:
    fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  sm: "0.25rem"
  control: "0.5rem"
  button: "0.625rem"
  popover: "0.875rem"
  pill: "999px"
spacing:
  xs: "0.25rem"
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.75rem"
  xl: "1.25rem"
components:
  send-button:
    backgroundColor: "{colors.blue-send-rest}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.control}"
    size: "1.875rem"
  send-button-hover:
    backgroundColor: "{colors.blue-send-hover}"
  send-button-disabled:
    backgroundColor: "{colors.line}"
    textColor: "{colors.muted}"
  suggestion-chip:
    backgroundColor: "{colors.control}"
    textColor: "{colors.ink-strong}"
    rounded: "{rounded.pill}"
    padding: "0.625rem 1.25rem"
  suggestion-chip-hover:
    backgroundColor: "{colors.control-hover}"
  model-pill:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 0.75rem 0 0.875rem"
    height: "2.25rem"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    size: "2.25rem"
  icon-button-hover:
    backgroundColor: "{colors.control}"
  input-shell:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.popover}"
  context-banner:
    backgroundColor: "{colors.blue-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.popover}"
    padding: "0.375rem 0.75rem"
---

# Design System: AI Sidebar

## 1. Overview

**Creative North Star: "The Quiet Assistant"**

This is the React side panel under `src/side-panel/`. The surface is pure white, chrome is nearly invisible, and a single Google-grade blue (`#145fd7`) is the only color that raises its voice—on selection, links, checks, focus rings, and primary settings actions. Resting structure is greys and hairlines so the conversation leads. The model is Gemini’s Chrome side panel: tool-like familiarity, not brand decoration.

Density is calm but real. Controls sit on a 2.25rem grid. The command footer (tools, add-context, model pill, send) lives in the input shell’s normal flow. Floating layers—model menu, tab picker, history drawer, settings, tool menus—rise above the canvas on soft shadows. The rail is narrow (often 320–420px), so type is a fixed rem scale, never fluid.

This system is scoped to the AI sidebar only. New-tab moon/paper warmth and game-page playfulness are out of register here.

**Key characteristics**
- White canvas, single blue accent, system/UI sans.
- Flat by default; soft shadow reserved for floating layers.
- Pill chips, 0.5–0.875rem control radii, 2.25rem icon grid.
- Fixed rem type tuned for a narrow rail.
- Blue is action/selection/link—not decoration.

## 2. Colors

Source tokens live in `src/side-panel/themes/claude-light.css` (`--color-*` and `--sidepanel-*`).

### Primary
- **Action Blue** `#145fd7`: selection, checks, links, focus ring source, settings primary buttons.
- **Action Blue Deep** `#0f4fb8`: pressed/hover for solid blue actions; stop-generation state.
- **Blue Mist** `#eef4ff`: context banner, selected rows, open tool shelf, soft active switch fills.
- **Send Rest / Hover** `#a8c6f0` / `#8bb2e8`: current composer send glyph button (lighter than full action blue so the resting rail stays quiet).

### Neutral
- **Ink** `#303237` / **Ink Strong** `#20242a`: body and emphasis text.
- **Muted** `#68707d`: secondary labels, placeholders, status hints. ~5:1 on white—do not lighten.
- **Canvas** `#ffffff`: panel body and resting surfaces.
- **Control** `#f3f6fb` / **Control Hover** `#eaf0f9` / **Row Hover** `#dfe4ed`.
- **Hairline** `#d8dde8` / **Hairline Soft** `#e8edf5`.
- **Rail Surface** `#f0f4f9` / **Rail Line** `#dfe5ef`: history drawer and settings shell backgrounds.

### Semantic (reserved)
- **Warn** `#fff7f2` / `#f0d8cf` / `#8b4a3d`
- **Error** `#c0453f`
- **Success** `#2f7d55`

**One Voice Rule.** Blue appears on ≤10% of any screen and only on what acts or is selected.

**Reserved Warmth Rule.** Warm trio only for warnings/errors—not brand accent, not canvas tint.

## 3. Typography

**Stack in rail chrome:** `system-ui, "Segoe UI", Roboto, sans-serif` (sidebar shell, drawers, menus).  
**Body base:** `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` in `styles.css` root. Prefer system-ui for new chrome so the panel reads as browser chrome.

### Hierarchy
- **Greeting** 400 / 1.75rem / 1.15 — blue “你好” on empty state.
- **Title** 700 / 1.5rem / 1.25 — “今天需要我做些什么？”
- **Body** 400 / 0.9375rem / 1.5 — messages, suggestions.
- **Label** 600 / 0.8125rem / 1.4 — banners, model pill, dialog titles, status.

**No-Tracking Rule.** Letter-spacing stays 0 for CJK.  
**Fixed-Scale Rule.** Fixed rem only; no `clamp()`/`vw` headings in the rail.

## 4. Elevation

Flat by default; lift only when a layer floats above the conversation.

### Shadow vocabulary
- **Soft Lift** `0 8px 24px rgb(31 41 55 / 8%)` — input shell (non-shell overrides), tool shelf, menus.
- **Drawer Lift** `0 12px 28px rgb(31 41 55 / 14%)` (history/settings often use a slightly heavier multi-shadow) — history drawer, settings dialog, floating menus.

**Flat-By-Default Rule.** Resting chips, icon buttons, and list rows use hairlines or tonal fills—not shadows.

## 5. Components

### Command footer (signature)
Left: tools toggle, add-tab. Right: model pill + send. Tools expand into a Blue-Mist shelf above the footer; model menu and context dialogs rise fixed from the bottom of the rail.

### Buttons
- **Send:** 1.875rem rounded square (`0.5rem`), light-blue rest, deeper hover; disabled hairline; in-flight spinner + stop square when abortable. Focus: 3px blue-24% ring, offset 2px.
- **Icon buttons:** 2.25rem, transparent rest, control fill on hover; 1.25rem stroked icons (`fill: none`, `currentColor` stroke).

### Chips & pills
- **Suggestion chips:** pill, control fill, ≥2.75rem tall, soft hairline on hover.
- **Model pill:** transparent pill at rest, control fill on hover/open; active option uses blue check on Blue-Mist or soft row hover.

### Inputs
- **Input shell:** white, hairline border, ~0.75–0.875rem radius; focus ring only under `.sidebar-shell` (no heavy resting shadow).
- **Placeholder:** muted, same body size; empty prompt copy: “输入 @ 即可询问标签页相关问题”.
- **Context banner:** Blue-Mist strip for shared tab(s), with favicon, title, dismiss/expand.

### Messages
- Assistant: transparent bubble, body ink, no avatar in shell mode.
- User: soft control fill, soft hairline, asymmetric radius (0.875rem with a tight trailing corner).
- Tool timelines and attachments stay secondary; compact tool-call display is preference-driven.

### Navigation / drawers
- Top chrome is icon-only (history, new chat when messages exist, floating assistant). Settings and browser control live in the history drawer footer with live 已开启/已关闭 status.
- History drawer and settings use rail surface `#f0f4f9`, fixed right popovers, drawer-page transitions with reduced-motion cutouts.

## 6. Do's and Don'ts

### Do
- Keep blue on ≤10% of the screen, only on action/selection (One Voice).
- Keep resting surfaces flat; reserve Soft/Drawer lift for floating layers.
- Use stroked line-art icons at ~1.25rem on the 2.25rem grid.
- Show `focus-visible` rings and pair selection with checks or labels.
- Keep CJK labels at letter-spacing 0, sentence case.
- Route warm colors exclusively to warning/error.

### Don't
- Lighten muted text below the AA floor on white.
- Apply Latin uppercase tracking to Chinese labels.
- Build dense equal-weight AI choice walls.
- Signal state with color alone.
- Tint the white canvas cream/beige or introduce a second brand accent.
- Use fluid display type or hide the primary send affordance to look clean.

## 7. Implementation map

| Concern | Location |
| --- | --- |
| Tokens | `src/side-panel/themes/claude-light.css` |
| Layout + shell chrome | `src/side-panel/styles.css` (`.sidebar-shell` and later blocks) |
| App shell | `src/side-panel/App.tsx` |
| Chat + composer | `src/side-panel/components/ChatPanel.tsx`, `ChatComposer.tsx`, `MessageList.tsx` |
| Empty state | `MessageList` empty branch + `ConversationContinuityPrompt` |
| Model menu | `ModelSelector.tsx` |
| History / settings | `SessionHistoryDialog.tsx`, `SettingsPanel.tsx` |

## 8. Motion

- State transitions 140–180ms ease-out; drawer page transitions ~140–180ms cubic-bezier.
- Spinners and thinking pulses only while work is in flight.
- Always provide `prefers-reduced-motion: reduce` cutouts (instant or near-zero duration).
