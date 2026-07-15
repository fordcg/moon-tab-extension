# Skill Playbook Import v1 Design

Date: 2026-07-16  
Status: approved for planning  
Scope: first usable import path for Automation Skill Playbooks in the side-panel settings UI

## Goal

Replace the “Skill 策略 / 暂未接入” placeholder with a minimal import loop:

1. Import one or more playbooks from a `.json` file
2. Persist them separately from builtin playbooks
3. Enable/disable them with the existing disable list
4. Delete imported playbooks
5. Include enabled imported playbooks in model preselection

Non-goals for v1:

- zip / folder skill packs
- paste-JSON import
- edit / clone playbooks
- user-authored playbooks (`source: "user"`)
- online catalog / marketplace
- raising tool permissions beyond existing browser-control boundaries
- background independently scanning disk for skills

## Decisions

| Topic | Choice |
|---|---|
| Import format | JSON file only (`accept=".json"`) |
| Payload shape | single object or array of objects |
| ID conflict | reject whole import with error |
| Delete | supported for imported skill playbooks |
| Storage | independent key `automationSkillPlaybooks` |
| Enable state | keep existing `automationPlaybookSettings.disabledPlaybookIds` |
| Runtime wiring | side panel loads storage and passes imported skills into model request, same pattern as settings |

## Data model

### Storage key

- Key: `automationSkillPlaybooks`
- Value:

```ts
interface AutomationSkillPlaybookStore {
  playbooks: ImportedAutomationPlaybook[];
}
```

### Playbook record

Imported records reuse the existing Automation Playbook shape and fix the source:

```ts
interface ImportedAutomationPlaybook {
  id: string;
  title: string;
  description: string;
  tags: string[];
  source: "skill";
  defaultEnabled: true;
  risk: "low" | "medium" | "high" | "critical";
  recommendedCapabilities: string[];
  selectionHints: string[];
  prompt: string;
  importedAt: number;
  updatedAt: number;
}
```

Validation rules:

- `id`: must match `^[a-z][a-z0-9_]{1,63}$`
- strings: required non-empty after trim for `id`, `title`, `description`, `prompt`
- arrays: `tags`, `recommendedCapabilities`, `selectionHints` must be string arrays; empty allowed
- `risk`: one of `low | medium | high | critical`
- import JSON may omit `source` / `defaultEnabled` / timestamps; normalizer writes them
- if import JSON provides `source`, it must be `"skill"` or be ignored/overwritten to `"skill"`
- conflict if any imported `id` already exists in builtin ids or currently stored skill ids → reject entire batch
- no partial write on multi-item import failure

### Settings

Unchanged key:

```ts
interface AutomationPlaybookSettings {
  disabledPlaybookIds: string[];
}
```

Behavior changes:

- known ids for normalization become `builtin ids ∪ imported skill ids`
- deleting an imported playbook also removes that id from `disabledPlaybookIds`
- disabling an unknown id is dropped during normalize

## Registry and runtime

### Shared helpers (`src/shared/automationPlaybooks.ts` and `.mjs` parity if still used by legacy tests)

- `getBuiltinAutomationPlaybooks()`
- `getRegisteredAutomationPlaybooks(skillPlaybooks?)` → builtin + imported skill clones
- `getEnabledAutomationPlaybooks(settings, skillPlaybooks?)` → registered minus disabled, and still requires `defaultEnabled`
- `normalizeAutomationPlaybookSettings(value, knownIds?)`
- `normalizeImportedSkillPlaybooks(value)`
- `parseSkillPlaybookImportJson(text)` → validated draft list or structured error
- `mergeImportedSkillPlaybooks(existing, incoming)` → success list or conflict error

### Side panel store

Extend app store with:

- `importedSkillPlaybooks: ImportedAutomationPlaybook[]`
- `importSkillPlaybooksFromJson(fileText: string): Promise<{ ok: true; importedCount: number } | { ok: false; message: string }>`
- `removeImportedSkillPlaybook(playbookId: string): Promise<void>`
- load path reads `automationSkillPlaybooks` during bootstrap alongside existing settings

Persistence:

- save full store object under `automationSkillPlaybooks` via existing app-setting save helper pattern
- import/delete update store state after successful persistence

### Model request path

Current path already sends `automationPlaybookSettings` from side panel → background.

v1 addition:

- also send `importedSkillPlaybooks` (or equivalent field) on the model request message
- background `getEnabledAutomationPlaybooks(settings, importedSkillPlaybooks)` uses that list
- background does **not** read skill storage itself in v1

This keeps one data owner (side panel settings surface) and avoids dual-readers diverging.

## UI

File: `src/side-panel/components/settings/AutomationPlaybookSettings.tsx`

### Builtin section

Unchanged: list, enable switch, details.

### Skill section

Replace placeholder with:

1. Header “Skill 策略”
2. Button “导入 JSON”
3. Hidden `<input type="file" accept="application/json,.json" />`
4. Inline error region for import failures
5. Empty state: “尚未导入 Skill 策略”
6. Card list for imported skills, same visual language as builtin cards
7. Per-card controls:
   - enable switch
   - details toggle
   - delete button (skill only)

### User section

Remain closed:

> 暂未开放。第一版不支持编辑、克隆或删除 Playbook。  
> (delete here means user-authored playbooks; imported skill delete is allowed in Skill section)

### Interaction details

- import success: clear error, show notification like “已导入 N 条 Skill 策略”
- import failure: keep previous store intact, show message in skill section
- delete: immediate for v1 (no modal); then persist + cleanup disable id
- enable/disable: same `updateAutomationPlaybookSettings({ disabledPlaybookIds })` path for both sources

## Example import JSON

Single:

```json
{
  "id": "shop_checkout_guard",
  "title": "结账前检查",
  "description": "提交订单前核对金额与地址",
  "tags": ["购物", "表单"],
  "risk": "high",
  "recommendedCapabilities": ["observe_page", "operate_page", "confirm_boundary"],
  "selectionHints": ["结账", "下单前检查"],
  "prompt": "任务策略：结账前检查\n先观察结算页金额、地址与提交按钮状态，再决定是否请求用户确认。"
}
```

Array:

```json
[
  { "id": "skill_a", "title": "A", "description": "desc", "tags": [], "risk": "low", "recommendedCapabilities": ["observe_page"], "selectionHints": ["A"], "prompt": "..." },
  { "id": "skill_b", "title": "B", "description": "desc", "tags": [], "risk": "medium", "recommendedCapabilities": ["observe_page"], "selectionHints": ["B"], "prompt": "..." }
]
```

## Error catalog

| Condition | Message (Chinese) |
|---|---|
| file unreadable | 无法读取文件 |
| invalid JSON syntax | JSON 格式无效 |
| root not object/array | 导入内容必须是策略对象或策略数组 |
| missing/invalid field | 策略字段无效：`<field>` |
| invalid id format | 策略 ID 非法：`<id>` |
| invalid risk | 风险等级非法：`<risk>` |
| conflict with builtin | 与内置策略 ID 冲突：`<id>` |
| conflict with imported | 与已导入策略 ID 冲突：`<id>` |
| empty batch after parse | 未找到可导入的策略 |

All errors are non-destructive.

## Testing

1. Shared pure tests
   - parse valid single/array
   - reject bad id/risk/missing fields
   - reject conflicts against builtin and existing imported
   - registry merge and enable filtering
   - settings normalize accepts imported ids and drops unknown

2. Settings UI tests
   - skill section no longer shows only placeholder
   - import success renders card and calls persistence action
   - import conflict shows error and does not call success persistence
   - delete removes card and cleans disable id
   - enable switch works for imported id

3. Request wiring test
   - sending chat/model request includes imported skills
   - enabled imported skill appears in candidate set used by selection helper

## File touch list (expected)

- `src/shared/types.ts`
- `src/shared/automationPlaybooks.ts`
- `src/shared/automation-playbooks.mjs` (if legacy scripts still authoritative for some tests)
- `src/side-panel/state/appStore.ts`
- `src/side-panel/components/settings/AutomationPlaybookSettings.tsx`
- `src/background/modelRequestHandler.ts` (consume imported list)
- related unit tests under `tests/unit/`
- legacy script tests if `.mjs` parity kept

## Rollout

1. Implement pure parse/registry helpers + tests
2. Wire store persistence/load
3. UI import/list/delete/toggle
4. Pass imported skills into model request path
5. Package extension and commit

## Open follow-ups (not v1)

- update-in-place import for same skill id
- export JSON
- user-authored playbooks
- package/zip format and manifest versioning
- background-owned skill storage reader
