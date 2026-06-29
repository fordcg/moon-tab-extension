---
name: AI Sidebar
description: A calm, Gemini-style assistant panel that disappears into the conversation
colors:
  blue: "#145fd7"
  blue-deep: "#0f4fb8"
  blue-soft: "#eef4ff"
  canvas: "#ffffff"
  ink: "#303237"
  ink-strong: "#20242a"
  muted: "#68707d"
  control: "#f3f6fb"
  control-hover: "#eaf0f9"
  line: "#d8dde8"
  line-soft: "#e8edf5"
  warn-surface: "#fff7f2"
  warn-border: "#f0d8cf"
  warn-ink: "#8b4a3d"
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
    backgroundColor: "{colors.blue}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.button}"
    size: "2.25rem"
  send-button-hover:
    backgroundColor: "{colors.blue-deep}"
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
    backgroundColor: "{colors.control}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 1.625rem 0 0.875rem"
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

This is a browser side panel that gets out of its own way. The surface is pure white, the chrome is nearly invisible, and a single Google-grade blue (#145fd7) is the only color that ever raises its voice — and only on the things that act: the send button, the current selection, a link. Everything else is built from greys and hairlines so the conversation, not the interface, is what the eye lands on. The model is Gemini's Chrome side panel: a tool-like assistant surface where familiarity is a feature and restraint is the whole point.

Density is calm but real. Controls sit on a tight 2.25rem grid, the bottom command footer (image upload, tools, add-context, model pill, send) lives in the input shell's normal flow, so narrow panels do not depend on hard-coded offsets. Floating layers — the model menu, the tab picker, the history drawer, the context dialog — rise above the flat canvas on one soft shadow. The panel is narrow (a side rail, often 320–420px), so type is a fixed rem scale, never fluid: a 1.5rem bold question, 0.9375rem body, 0.8125rem labels.

This system explicitly rejects the things PRODUCT.md warns against: no low-contrast warm-paper text, no CJK labels forced into uppercase tracking, no dense AI choice surfaces, no color-only state, no decorative warmth that slows the task down. Warmth here is carried by roundness and copy, not by tinting the canvas beige.

**Key Characteristics:**
- White canvas, single blue accent, system font — the tool disappears into the task.
- Flat by default; one soft shadow reserved for floating layers.
- Generous rounding: pill chips (999px), rounded buttons (0.625rem), rounded popovers (0.875rem).
- Fixed rem type scale tuned for a narrow rail, never fluid.
- Blue is a status signal (action / selection / link), never decoration.

## 2. Colors

A cool, near-monochrome palette: white and greys do the structural work, one blue carries every action, and a single warm trio is held in reserve for problems.

### Primary
- **Action Blue** (#145fd7): The one voice. Send button fill, current-model checkmark, selected-tab badge, focus-ring source, link text. If an element is blue, it either acts or is currently chosen.
- **Action Blue Deep** (#0f4fb8): Hover/pressed state of the blue send button only.
- **Blue Mist** (#eef4ff): The tint behind the "current page" context banner and selected rows — blue's quiet, non-acting form.

### Neutral
- **Ink** (#303237): Primary body and control text on white.
- **Ink Strong** (#20242a): Chip text and the few places that want maximum weight.
- **Muted** (#68707d): Secondary labels, placeholder text, state hints. Sits at ~5:1 on white — the AA floor; never lighten it further.
- **Canvas** (#ffffff): The body of the panel and every resting surface.
- **Control** (#f3f6fb): Resting fill for chips, the model pill, and quiet buttons.
- **Control Hover** (#eaf0f9): Hover fill for those same controls.
- **Hairline** (#d8dde8): Primary borders — input shell, model pill, dividers.
- **Hairline Soft** (#e8edf5): Lighter dividers and popover edges.

### Tertiary (held in reserve)
- **Warm Surface / Border / Ink** (#fff7f2 / #f0d8cf / #8b4a3d): The only warm colors in the system, used exclusively for warnings, failures, and context-injection errors. They soften red into something that fits the panel without losing legibility.

**The One Voice Rule.** Blue appears on ≤10% of any screen and only on what acts or is selected. A blue used for decoration is a bug.

**The Reserved Warmth Rule.** The warm trio is forbidden outside error/warning states. It is not a brand accent; it is a problem signal.

## 3. Typography

**Display / Body / Label Font:** `system-ui, "Segoe UI", Roboto, sans-serif` — one family throughout.

**Character:** Native, unremarkable on purpose. The panel borrows the host browser's own type voice so it reads as part of the chrome, not a branded overlay. Hierarchy comes from weight and size, never from a second typeface.

### Hierarchy
- **Greeting** (400, 1.75rem, 1.15): The blue "你好" line that opens an empty conversation, optionally personalized only when a real profile name is available. The only headline-scale use of blue.
- **Title** (700, 1.5rem, 1.25): "今天需要我做些什么？" — the bold prompt under the greeting. The single strongest piece of type on the empty state.
- **Body** (400, 0.9375rem, 1.5): Message text, suggestion chips, drawer actions. Caps at a comfortable rail width, not a 65ch prose measure.
- **Label** (600, 0.8125rem, 1.4): Context banner text, model pill, state hints ("已开启/已关闭"), dialog titles.

**The No-Tracking Rule.** Letter-spacing stays at 0 for CJK. Never borrow Latin uppercase tracking for Chinese labels — PRODUCT.md names this as an anti-reference, and it reads as broken in CJK.

**The Fixed-Scale Rule.** Type sizes are fixed rem, never `clamp()`/vw. The panel is a narrow rail; fluid type shrinks headings into illegibility before it helps.

## 4. Elevation

Flat by default, lift on float. Resting surfaces — message list, chips, icon buttons, the canvas itself — have no shadow; separation comes from hairline borders (#d8dde8) and the faint control fill (#f3f6fb). Depth is a signal that something has *risen above* the conversation, nothing else.

### Shadow Vocabulary
- **Soft Lift** (`box-shadow: 0 8px 24px rgb(31 41 55 / 8%)`): The input shell and the model menu — the persistent floating layer at the bottom of the panel.
- **Drawer Lift** (`box-shadow: 0 12px 28px rgb(31 41 55 / 14%)`): The history drawer and dialogs — slightly deeper, because they overlay more of the panel.

**The Flat-By-Default Rule.** A resting control never carries a shadow. If you see a shadow on something that isn't floating (a chip, a list row, a static button), it's wrong — use a hairline border or a tonal fill instead.

## 5. Components

### Buttons
- **Send (primary):** A 2.25rem blue (#145fd7) rounded square (0.625rem) with a white up-arrow glyph, flow-laid at the footer's right edge. Hover deepens to #0f4fb8; disabled drops to hairline-grey fill (#d8dde8) with muted glyph; an in-flight send swaps the arrow for a spinning ring and shows a lightweight status in the message list. Focus shows a 3px blue-24% ring offset 2px.
- **Icon buttons (add-context, tools, image-upload, history):** 2.25rem, transparent at rest, `control` (#f3f6fb) fill on hover, `control`-radius (0.5rem). Icons are 1.25rem stroked line-art (`fill:none` + `currentColor` stroke), never filled glyphs.

### Chips
- **Suggestion chips:** Pill (999px), `control` fill (#f3f6fb), ink-strong text (#20242a), 0.625rem × 1.25rem padding, ≥2.75rem tall. Hover shifts to #eaf0f9 with a soft hairline border. These are the tappable prompts on the empty state.

### Model Pill
- A pill-shaped (999px) `control` select showing the current model name ("Flash") with a chevron, flow-laid in the command footer beside the send button. Opens the **model menu** popover: a rounded (0.875rem) white card listing models with name + one-line description, the active one on a Blue-Mist (#eef4ff) row with a filled blue check, plus a toggle row and an upgrade link.

### Inputs / Fields
- **Input shell:** White, 1px hairline border (#d8dde8), rounded (0.875rem) bottom, Soft-Lift shadow, with the command footer laid out as its final row. The text area itself is borderless and transparent inside the shell. Placeholder uses muted (#68707d) at the same 0.9375rem as body.
- **Context banner:** A Blue-Mist (#eef4ff) strip sitting on top of the input ("正在分享…标签页" / "月标签"), 0.375rem × 0.75rem padding, with an info icon and a close (×) affordance. Marks what page the assistant can see.

### Navigation / Drawer
- The top bar is hidden; its actions (history, settings, browser-control) move into a **history drawer** — a rounded (0.75rem) Drawer-Lift card listing recent conversations as stroked-icon rows, with a footer holding "设置" and "浏览器控制" (the latter showing live 已开启/已关闭 state in muted-then-blue).

### Signature: The Flow Command Footer
The defining pattern. Image-upload, tools (sliders), and add-context (+) sit on the left; the model pill and send button sit on the right — all on one 2.25rem baseline inside a single flex row in the input shell. Popovers (tab picker, tools, model menu) rise from their trigger on Soft-Lift. This footer is the panel's control center and must stay visually quiet so the conversation above it leads. It must not be rebuilt as separate fixed layers with hard-coded left/right offsets.

## 6. Do's and Don'ts

### Do:
- **Do** keep blue (#145fd7) on ≤10% of the screen, only on what acts or is selected (the One Voice Rule).
- **Do** keep resting surfaces flat; reserve the two shadows for floating layers only (the Flat-By-Default Rule).
- **Do** use stroked line-art icons (`fill:none` + `currentColor`), 1.25rem, matching the existing set.
- **Do** keep every interactive control on the 2.25rem grid with a visible `focus-visible` ring (3px blue-24%, offset 2px) and ≥44px touch targets where touch is expected.
- **Do** keep CJK labels at letter-spacing 0, sentence case, body-size or larger.
- **Do** route warm colors (#fff7f2 / #8b4a3d) exclusively to warning/error states.

### Don't:
- **Don't** let muted (#68707d) text go any lighter — it's already at the ~5:1 AA floor on white. No low-contrast warm-paper text (a PRODUCT.md anti-reference).
- **Don't** force CJK labels into uppercase or heavy Latin-style tracking (a PRODUCT.md anti-reference).
- **Don't** build dense AI choice surfaces — one primary action dominates each decision point (model menu, tab picker stay scannable).
- **Don't** signal state with color alone; pair blue with a check, fill, or label so it survives color blindness.
- **Don't** add a second accent or tint the white canvas beige/cream for "warmth" — warmth comes from roundness and copy.
- **Don't** use `clamp()`/vw type or fluid headings; the rail is narrow, the scale is fixed rem.
- **Don't** hide a load-bearing affordance (e.g. the send button) to look clean — every primary action stays visible with a loading state.
