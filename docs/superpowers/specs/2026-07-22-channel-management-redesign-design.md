# Channel Management Redesign Design

Date: 2026-07-22  
Status: approved for planning  
Scope: redesign side-panel **渠道管理** layout and information architecture; migrate global model pickers; remove Tavily UI from this surface

## Goal

Make **渠道管理** a focused master–detail surface for model providers and their models:

1. Upper master list of channels with enable switches
2. Lower inline detail panel for the expanded channel (config + models)
3. Channel and model enable/disable wired into selectors
4. Remove Tavily configuration from channel management
5. Move default chat model and AI title model into **聊天偏好**

Non-goals for this redesign:

- Changing settings dialog size, position, or history↔settings horizontal page transition
- Redesigning other settings tabs beyond the two migrated model pickers in chat preferences
- Left/right split pane master–detail (side panel is too narrow)
- Reworking Automation Diagnostics placement (optional follow-up)
- Removing Tavily backend/storage code paths entirely in the same change (UI removal first; dead-path cleanup may follow)

## Decisions

| Topic | Choice |
|---|---|
| Master–detail orientation | Vertical: list on top, detail block **below the full list** (not between rows) |
| Expand pattern | Accordion-style: select row expands that channel; click again collapses; only one expanded |
| Default expand | On enter: expand first enabled channel, else first channel; empty list → empty state CTA |
| Draft / ghost provider | Remove draft-provider UI masquerading as real data |
| Channel enable | Switch on list row; independent hit target (`stopPropagation`) |
| Model enable | Switch on each model row |
| Global default / title model | Move to **聊天偏好** |
| Tavily block | Remove from ChannelManagement UI (product no longer wants this surface) |
| Dangerous actions | Confirm before delete channel / clear all models |
| API Key UX | Show/hide toggle for provider API Key (same idea as former Tavily key toggle) |
| Settings chrome | Keep dialog size, shell, and left/right page slide; content-only redesign |

## Information architecture

```
设置 > 渠道管理
├── Header row: 模型渠道 + [新增渠道]
├── Channel list (master)
│   └── Row: selection · name · URL summary · optional meta · enable · chevron
└── Inline detail (detail, only when a channel is expanded)
    ├── Channel config: name / endpoint type / URL / API key / [获取模型] [删除]
    └── Models: add · batch · remote pick · rows (enable · settings · test · delete)

设置 > 聊天偏好 (migration)
├── 默认对话模型
└── AI 标题生成模型
```

Removed from 渠道管理:

- Tavily API key / strategy / includeAnswer / includeRawContent / maxResults
- 默认对话模型
- AI 标题生成模型

Unchanged placement (out of scope):

- Automation diagnostics strip above tab content (may still appear on this tab until a later pass)

## Interaction

### Channel list

- Click row body: select channel and expand detail. If another channel was expanded, collapse it and expand the new one.
- Click same row body again: keep selection, collapse detail.
- Enable switch: toggles `provider.enabled` only; does not expand/collapse.
- Visual: selected row primary border; disabled channel reduced contrast; chevron / `aria-expanded` for expanded row.
- Optional secondary meta on row: model count, short endpoint-type label.

### Detail panel

- Single block rendered **after** the entire channel list (not inserted between list items).
- Shows config for `selectedProvider` when `expandedProviderId === selectedProviderId`.
- Actions:
  - 获取模型列表 — loading disables button; success/error may continue to toast via existing channelOperations
  - 删除渠道 — confirm, then delete and select next remaining channel (or empty state)

### Empty state

- No providers: title + short copy + primary **新增渠道**
- Do not render draft/ghost provider cards

### Models

- List models for the expanded (selected) provider only.
- Prefer `displayName` as primary label; show `modelId` as secondary when different.
- Per-row: enable switch, 设置, 测试, 删除; keep connectivity status text.
- 添加模型 / 批量添加 / remote list search keep existing capabilities.
- 清空所有 — confirm, then delete all models for this provider.

### Model settings dialog

- Keep current dialog for model ID + vision support (no expansion of fields in this redesign unless needed for enable wiring).
- Overlay / dialog patterns remain; no dialog size change required for settings shell.

## Enable semantics

| Object | Off | On |
|---|---|---|
| Channel (`ModelProvider.enabled`) | Models under it are unavailable in chat model selector and default/title fallbacks | Available (subject to model.enabled) |
| Model (`ProviderModel.enabled`) | Unavailable in selector; if it was selected / default / title model, clear that role and fall back | Available if parent channel enabled |

Fallback rules when disabling or deleting:

1. Prefer first remaining model where `provider.enabled && model.enabled`
2. Clear `defaultChatModelId` / title model / `selectedModelId` when the target is no longer eligible
3. Persist the same way existing model-catalog updates persist

Store surface changes:

- `updateProvider` must accept `enabled` (today it only allows `name | endpointType | endpointUrl | apiKey`)
- `updateModel` must accept `enabled` if not already
- Chat model selector and title/default option builders filter by enabled channel + model

## Component structure

Split the current monolithic `ChannelManagement.tsx` into focused pieces (names indicative):

| Piece | Responsibility |
|---|---|
| `ChannelManagement` | Compose list + detail; own expand/select state |
| `ChannelList` / `ChannelListItem` | Master list and row (enable, a11y) |
| `ChannelDetailPanel` | Provider form fields and channel-level actions |
| `ProviderModelList` / `ProviderModelRow` | Models for expanded provider |
| `ModelSettingsDialog` | Existing model settings sheet |
| Chat preference section | Host migrated default + title model selects |

Delete from channel management:

- Tavily form, visibility icon, and related composed input wiring on this page

## Visual / layout constraints

- Stay on existing sidepanel tokens (`--sidepanel-*`, hairline, surface cards, pill tabs)
- List cards: rounded, selected border, disabled opacity
- Detail: top border + soft surface background to separate from list
- Narrow panel: wrap action buttons; keep switches on a stable column
- **Do not** change:
  - `--sidepanel-settings-dialog-height` / popover width
  - history drawer ↔ settings page slide transition
  - settings tab strip behavior (horizontal scroll may remain)

## Accessibility

- Channel rows: `aria-expanded`, `aria-controls` pointing at detail region id
- Enable switches: labeled (`渠道启用：{name}`, `模型启用：{displayName}`)
- Detail region: `role="region"` + `aria-label` with channel name
- Confirm dialogs: focusable primary/cancel; Esc cancels when using modal pattern
- Keep keyboard tab order: list → expand → detail fields → model rows

## Data / persistence

- Continue using existing IndexedDB/repository paths for providers and models
- No new storage keys for this redesign
- `enabled` already on `ModelProvider` and `ProviderModel` types — UI + update APIs + consumer filters are the work
- Tavily settings may remain in storage for compatibility; no UI to edit them after this change

## Migration / compatibility

- Existing providers/models without explicit `enabled` should normalize to `true` on load if any legacy rows omit the field
- Users who relied on Tavily UI must configure search elsewhere or accept removal (product decision: feature surface removed)
- Default/title model values remain valid if still pointing at enabled models; otherwise apply fallback on load or on first open of chat preferences

## Testing

Minimum coverage:

1. Unit / store: enable/disable channel filters selector options; disabling current model falls back
2. Unit / store: updateProvider/updateModel persist `enabled`
3. Component: expand one channel shows detail below list; expanding another collapses previous
4. Component: empty state has no draft provider
5. Component: channel management has no Tavily strings/controls
6. Component: chat preferences renders default + title model selects
7. Manual: settings dialog size and history↔settings slide unchanged
8. Manual: delete channel / clear models require confirm

## Acceptance checklist

- [ ] 渠道管理 shows only channels + models (no Tavily, no default/title model pickers)
- [ ] Vertical master–detail: list, then full-width detail under list
- [ ] Channel and model enable switches work and affect chat model selection
- [ ] Delete channel / clear models confirmed
- [ ] Empty state without ghost draft provider
- [ ] Provider API Key show/hide
- [ ] Default chat model + title model live under 聊天偏好
- [ ] Settings dialog size and page slide animation unchanged

## Open follow-ups (out of scope)

- Move or collapse Automation Diagnostics off the channels first screen
- Deduplicate settings header title ("设置" appears twice)
- Full Tavily backend / webSearch settings removal or alternate config entry
- Richer model settings (temperature, max tokens, reasoning) in the model dialog
- Drag-reorder channels
