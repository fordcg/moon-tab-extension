# Skill Playbook Import v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users import Automation Skill Playbooks from JSON, persist them under a separate storage key, toggle/delete them in settings, and include enabled imported skills in model preselection.

**Architecture:** Keep builtin playbooks in code. Store imported skills under `automationSkillPlaybooks`. Keep enable/disable in existing `automationPlaybookSettings.disabledPlaybookIds`. Side panel owns load/import/delete and passes imported skills into `chat.send`; background merges them into the selection registry. Pure parse/merge helpers live in shared modules and are covered first with TDD.

**Tech Stack:** TypeScript, React, Zustand, Dexie `saveAppSetting`/`getAppSetting`, Vitest, Testing Library.

## Global Constraints

- Import format: JSON file only (single object or array).
- ID conflict: reject entire import with Chinese error; no overwrite.
- Delete: supported for imported skill playbooks only; also clean disable ids.
- Storage key: `automationSkillPlaybooks` with `{ playbooks: ImportedAutomationPlaybook[] }`.
- Settings key remains `automationPlaybookSettings = { disabledPlaybookIds: string[] }`.
- `id` must match `^[a-z][a-z0-9_]{1,63}$`.
- Imported records always get `source: "skill"` and `defaultEnabled: true`.
- Background does not read skill storage in v1; side panel passes the list.
- Do not implement zip/folder packs, paste import, edit/clone, or `source: "user"`.
- After implementation: run relevant tests, `npm run package:extension`, and commit.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/shared/types.ts` | Add imported skill store/types used across side panel and request message. |
| `src/shared/automationPlaybooks.ts` | Pure parse/normalize/merge/registry helpers for builtin + imported skills. |
| `src/shared/automation-playbooks.mjs` | Keep legacy script parity only if still required by `scripts/test_automation_playbooks.mjs`; otherwise leave and cover TS tests as source of truth. Prefer not expanding `.mjs` unless a failing legacy test forces it. |
| `src/side-panel/state/appStore.ts` | Load/persist imported skills; expose import/delete actions; send imported list on chat request. |
| `src/side-panel/components/settings/AutomationPlaybookSettings.tsx` | Skill section UI: import, list, toggle, details, delete. |
| `src/background/modelRequestHandler.ts` | Accept `importedSkillPlaybooks` and feed merged enabled list into selector. |
| `tests/unit/shared/automationPlaybooks.skillImport.test.ts` | Pure helper tests. |
| `tests/unit/side-panel/AutomationPlaybookSettings.test.tsx` | Settings UI tests for skill import/delete/toggle. |
| `tests/unit/side-panel/App.test.tsx` or focused store/request test | Assert request payload includes imported skills when present. |

---

### Task 1: Shared types + pure import/registry helpers

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/automationPlaybooks.ts`
- Create: `tests/unit/shared/automationPlaybooks.skillImport.test.ts`

**Interfaces:**
- Produces:
  - `AUTOMATION_SKILL_PLAYBOOKS_KEY = "automationSkillPlaybooks"`
  - `ImportedAutomationPlaybook`
  - `AutomationSkillPlaybookStore`
  - `parseSkillPlaybookImportJson(text: string): { ok: true; playbooks: Omit<ImportedAutomationPlaybook, "importedAt" | "updatedAt">[] } | { ok: false; message: string }`
  - `normalizeImportedSkillPlaybooks(value: unknown): ImportedAutomationPlaybook[]`
  - `mergeImportedSkillPlaybooks(existing: ImportedAutomationPlaybook[], incoming: Omit<ImportedAutomationPlaybook, "importedAt" | "updatedAt">[], now?: number): { ok: true; playbooks: ImportedAutomationPlaybook[] } | { ok: false; message: string }`
  - `getRegisteredAutomationPlaybooks(skillPlaybooks?: readonly AutomationPlaybook[]): AutomationPlaybook[]`
  - `getEnabledAutomationPlaybooks(settings: unknown, skillPlaybooks?: readonly AutomationPlaybook[]): AutomationPlaybook[]`
  - `normalizeAutomationPlaybookSettings(value: unknown, knownIds?: ReadonlySet<string> | readonly string[]): AutomationPlaybookSettings`
  - `getAutomationPlaybookById(playbookId: string, skillPlaybooks?: readonly AutomationPlaybook[]): AutomationPlaybook | undefined`

- [ ] **Step 1: Write failing pure tests**

Create `tests/unit/shared/automationPlaybooks.skillImport.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  getEnabledAutomationPlaybooks,
  getRegisteredAutomationPlaybooks,
  mergeImportedSkillPlaybooks,
  normalizeAutomationPlaybookSettings,
  normalizeImportedSkillPlaybooks,
  parseSkillPlaybookImportJson,
} from "../../../src/shared/automationPlaybooks";

const sample = {
  id: "shop_checkout_guard",
  title: "结账前检查",
  description: "提交订单前核对金额与地址",
  tags: ["购物", "表单"],
  risk: "high",
  recommendedCapabilities: ["observe_page", "operate_page", "confirm_boundary"],
  selectionHints: ["结账", "下单前检查"],
  prompt: "任务策略：结账前检查\n先观察结算页。",
};

describe("skill playbook import helpers", () => {
  it("parses a single valid skill object", () => {
    const result = parseSkillPlaybookImportJson(JSON.stringify(sample));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.playbooks).toHaveLength(1);
    expect(result.playbooks[0]).toMatchObject({
      id: "shop_checkout_guard",
      source: "skill",
      defaultEnabled: true,
    });
  });

  it("parses an array of skills", () => {
    const result = parseSkillPlaybookImportJson(JSON.stringify([
      sample,
      { ...sample, id: "skill_b", title: "B" },
    ]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.playbooks.map((item) => item.id)).toEqual([
      "shop_checkout_guard",
      "skill_b",
    ]);
  });

  it("rejects invalid JSON and illegal ids", () => {
    expect(parseSkillPlaybookImportJson("{").ok).toBe(false);
    expect(parseSkillPlaybookImportJson(JSON.stringify({ ...sample, id: "Bad-Id" })).ok).toBe(false);
    expect(parseSkillPlaybookImportJson(JSON.stringify({ ...sample, risk: "extreme" })).ok).toBe(false);
  });

  it("rejects conflicts with builtin or existing imported ids", () => {
    const existing = normalizeImportedSkillPlaybooks({
      playbooks: [{ ...sample, source: "skill", defaultEnabled: true, importedAt: 1, updatedAt: 1 }],
    });
    const againstBuiltin = mergeImportedSkillPlaybooks(existing, [
      { ...sample, id: "page_reading", source: "skill", defaultEnabled: true },
    ]);
    expect(againstBuiltin.ok).toBe(false);
    if (againstBuiltin.ok) return;
    expect(againstBuiltin.message).toContain("内置");

    const againstImported = mergeImportedSkillPlaybooks(existing, [
      { ...sample, source: "skill", defaultEnabled: true },
    ]);
    expect(againstImported.ok).toBe(false);
    if (againstImported.ok) return;
    expect(againstImported.message).toContain("已导入");
  });

  it("merges registry and respects disable list for imported skills", () => {
    const imported = normalizeImportedSkillPlaybooks({
      playbooks: [{ ...sample, source: "skill", defaultEnabled: true, importedAt: 1, updatedAt: 1 }],
    });
    const registered = getRegisteredAutomationPlaybooks(imported);
    expect(registered.some((item) => item.id === "shop_checkout_guard")).toBe(true);
    expect(registered.some((item) => item.id === "page_reading")).toBe(true);

    const enabled = getEnabledAutomationPlaybooks(
      { disabledPlaybookIds: ["shop_checkout_guard"] },
      imported,
    );
    expect(enabled.some((item) => item.id === "shop_checkout_guard")).toBe(false);
    expect(enabled.some((item) => item.id === "page_reading")).toBe(true);
  });

  it("normalizes settings against known ids including imported skills", () => {
    const settings = normalizeAutomationPlaybookSettings(
      { disabledPlaybookIds: ["shop_checkout_guard", "page_reading", "missing"] },
      ["page_reading", "shop_checkout_guard"],
    );
    expect(settings.disabledPlaybookIds).toEqual(["shop_checkout_guard", "page_reading"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/shared/automationPlaybooks.skillImport.test.ts
```

Expected: FAIL because helpers/types do not exist or signatures still ignore skill playbooks.

- [ ] **Step 3: Implement types**

In `src/shared/types.ts`, near existing automation playbook types, add:

```ts
export interface ImportedAutomationPlaybook {
  id: string;
  title: string;
  description: string;
  tags: string[];
  source: "skill";
  defaultEnabled: true;
  risk: AutomationPlaybookRisk;
  recommendedCapabilities: string[];
  selectionHints: string[];
  prompt: string;
  importedAt: number;
  updatedAt: number;
}

export interface AutomationSkillPlaybookStore {
  playbooks: ImportedAutomationPlaybook[];
}
```

Keep existing:

```ts
export interface AutomationPlaybookSettings {
  disabledPlaybookIds: string[];
}
```

- [ ] **Step 4: Implement helpers in `src/shared/automationPlaybooks.ts`**

Key implementation notes:

```ts
export const AUTOMATION_SKILL_PLAYBOOKS_KEY = "automationSkillPlaybooks";
const PLAYBOOK_ID_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

function clonePlaybook<T extends AutomationPlaybook>(playbook: T): T {
  return {
    ...playbook,
    tags: [...playbook.tags],
    recommendedCapabilities: [...playbook.recommendedCapabilities],
    selectionHints: [...playbook.selectionHints],
  };
}

export function getBuiltinAutomationPlaybooks(): AutomationPlaybook[] {
  return BUILTIN_AUTOMATION_PLAYBOOKS.map(clonePlaybook);
}

export function getRegisteredAutomationPlaybooks(
  skillPlaybooks: readonly AutomationPlaybook[] = [],
): AutomationPlaybook[] {
  return [
    ...getBuiltinAutomationPlaybooks(),
    ...skillPlaybooks.map((playbook) => clonePlaybook({ ...playbook, source: "skill" as const })),
  ];
}

export function getAutomationPlaybookById(
  playbookId: string,
  skillPlaybooks: readonly AutomationPlaybook[] = [],
): AutomationPlaybook | undefined {
  return getRegisteredAutomationPlaybooks(skillPlaybooks).find((item) => item.id === playbookId);
}

export function normalizeAutomationPlaybookSettings(
  value: unknown,
  knownIds?: ReadonlySet<string> | readonly string[],
): AutomationPlaybookSettings {
  const allowed = knownIds
    ? new Set(Array.from(knownIds))
    : new Set(BUILTIN_AUTOMATION_PLAYBOOKS.map((item) => item.id));
  // filter disabledPlaybookIds to allowed only
}

export function getEnabledAutomationPlaybooks(
  settings: unknown,
  skillPlaybooks: readonly AutomationPlaybook[] = [],
): AutomationPlaybook[] {
  const registered = getRegisteredAutomationPlaybooks(skillPlaybooks);
  const knownIds = registered.map((item) => item.id);
  const normalized = normalizeAutomationPlaybookSettings(settings, knownIds);
  const disabled = new Set(normalized.disabledPlaybookIds);
  return registered.filter((item) => item.defaultEnabled && !disabled.has(item.id));
}
```

`parseSkillPlaybookImportJson`:

- `JSON.parse` in try/catch → `JSON 格式无效`
- accept object or array
- validate each item; first error aborts
- force `source: "skill"`, `defaultEnabled: true`
- do not set timestamps here

`mergeImportedSkillPlaybooks`:

- build set of builtin ids + existing imported ids
- if incoming id hits builtin → `与内置策略 ID 冲突：${id}`
- if hits existing imported → `与已导入策略 ID 冲突：${id}`
- if incoming batch itself has duplicate ids → reject with conflict message
- append with `importedAt/updatedAt = now`

`normalizeImportedSkillPlaybooks`:

- accept `{ playbooks: [...] }` or raw array for resilience
- drop invalid rows rather than throwing on stored data
- force `source: "skill"` and `defaultEnabled: true`

Error messages must match the design catalog.

- [ ] **Step 5: Run pure tests**

```bash
npx vitest run tests/unit/shared/automationPlaybooks.skillImport.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/shared/automationPlaybooks.ts tests/unit/shared/automationPlaybooks.skillImport.test.ts
git commit -m "feat: add skill playbook import parse and registry helpers"
```

---

### Task 2: App store persistence + request payload wiring

**Files:**
- Modify: `src/side-panel/state/appStore.ts`
- Modify: `src/background/modelRequestHandler.ts`
- Modify: any local `AppChatSendMessage` type alias in `appStore.ts` if present
- Test: add focused unit coverage in `tests/unit/shared/automationPlaybooks.skillImport.test.ts` only if needed; otherwise cover via settings/request tests in Task 3

**Interfaces:**
- Consumes: helpers/types from Task 1
- Produces store fields/actions:
  - `importedSkillPlaybooks: ImportedAutomationPlaybook[]`
  - `importSkillPlaybooksFromJson(fileText: string): Promise<{ ok: true; importedCount: number } | { ok: false; message: string }>`
  - `removeImportedSkillPlaybook(playbookId: string): Promise<void>`
  - chat request field: `importedSkillPlaybooks?: ImportedAutomationPlaybook[]`

- [ ] **Step 1: Extend AppState defaults and bootstrap load**

In `appStore.ts`:

1. Import:

```ts
import {
  AUTOMATION_PLAYBOOK_SETTINGS_KEY,
  AUTOMATION_SKILL_PLAYBOOKS_KEY,
  mergeImportedSkillPlaybooks,
  normalizeAutomationPlaybookSettings,
  normalizeImportedSkillPlaybooks,
  parseSkillPlaybookImportJson,
} from "../../shared/automationPlaybooks";
import type { AutomationPlaybookSettings, ImportedAutomationPlaybook } from "../../shared/types";
```

2. Add state:

```ts
importedSkillPlaybooks: ImportedAutomationPlaybook[];
```

Default:

```ts
importedSkillPlaybooks: [],
```

3. In `loadChannelConfig` (or the same bootstrap that loads automation settings), also:

```ts
const savedSkillPlaybooks = await getAppSetting<unknown>(AUTOMATION_SKILL_PLAYBOOKS_KEY);
const importedSkillPlaybooks = normalizeImportedSkillPlaybooks(savedSkillPlaybooks);
```

Include `importedSkillPlaybooks` in the `set({...})` payload.

When normalizing settings after load, pass known ids:

```ts
const knownIds = [
  .../* builtin ids via getRegisteredAutomationPlaybooks(importedSkillPlaybooks).map(p => p.id) */
];
const automationPlaybookSettings = normalizeAutomationPlaybookSettings(
  savedAutomationPlaybookSettings,
  knownIds,
);
```

Also update `updateAutomationPlaybookSettings` to normalize against current known ids from builtin + `get().importedSkillPlaybooks`.

- [ ] **Step 2: Implement import/delete actions**

```ts
importSkillPlaybooksFromJson: async (fileText) => {
  const parsed = parseSkillPlaybookImportJson(fileText);
  if (!parsed.ok) return parsed;
  const merged = mergeImportedSkillPlaybooks(get().importedSkillPlaybooks, parsed.playbooks, Date.now());
  if (!merged.ok) return merged;
  const now = Date.now();
  await saveAppSetting({
    key: AUTOMATION_SKILL_PLAYBOOKS_KEY,
    value: { playbooks: merged.playbooks },
    updatedAt: now,
  });
  set({ importedSkillPlaybooks: merged.playbooks });
  return { ok: true, importedCount: parsed.playbooks.length };
},

removeImportedSkillPlaybook: async (playbookId) => {
  const nextPlaybooks = get().importedSkillPlaybooks.filter((item) => item.id !== playbookId);
  const now = Date.now();
  await saveAppSetting({
    key: AUTOMATION_SKILL_PLAYBOOKS_KEY,
    value: { playbooks: nextPlaybooks },
    updatedAt: now,
  });
  const knownIds = getRegisteredAutomationPlaybooks(nextPlaybooks).map((item) => item.id);
  const automationPlaybookSettings = normalizeAutomationPlaybookSettings(
    {
      disabledPlaybookIds: get().automationPlaybookSettings.disabledPlaybookIds.filter((id) => id !== playbookId),
    },
    knownIds,
  );
  await saveAppSetting({
    key: AUTOMATION_PLAYBOOK_SETTINGS_KEY,
    value: automationPlaybookSettings,
    updatedAt: now,
  });
  set({
    importedSkillPlaybooks: nextPlaybooks,
    automationPlaybookSettings,
  });
},
```

Reset path (`clear`/logout-like reset if present) must also set `importedSkillPlaybooks: []`.

- [ ] **Step 3: Pass imported skills on chat.send**

Where request is built (`automationPlaybookSettings: input.state.automationPlaybookSettings`):

```ts
automationPlaybookSettings: input.state.automationPlaybookSettings,
importedSkillPlaybooks: input.state.importedSkillPlaybooks,
```

Ensure the local request type includes optional `importedSkillPlaybooks?: ImportedAutomationPlaybook[]`.

- [ ] **Step 4: Background consumes imported skills**

In `src/background/modelRequestHandler.ts`:

1. Extend `ChatSendMessage`:

```ts
importedSkillPlaybooks?: ImportedAutomationPlaybook[];
// import type if needed
```

2. Update `maybeSelectAutomationPlaybook`:

```ts
const skillPlaybooks = Array.isArray(message.importedSkillPlaybooks)
  ? message.importedSkillPlaybooks
  : [];
const playbooks = getEnabledAutomationPlaybooks(message.automationPlaybookSettings, skillPlaybooks);
```

If any code path calls `getAutomationPlaybookById(selection.playbookId)` for prompt materialization, pass `skillPlaybooks` too. Check `backgroundToolRuntime.ts` / selected prompt helper and update call sites that resolve by id.

- [ ] **Step 5: Smoke typecheck the touched files**

```bash
npx tsc --noEmit
```

Expected: no new errors in touched files. If full-project noise exists, at least ensure new symbols typecheck via vitest transform.

- [ ] **Step 6: Commit**

```bash
git add src/side-panel/state/appStore.ts src/background/modelRequestHandler.ts src/background/backgroundToolRuntime.ts src/shared/types.ts
git commit -m "feat: persist imported skill playbooks and pass them into chat requests"
```

---

### Task 3: Settings UI import / list / delete / toggle

**Files:**
- Modify: `src/side-panel/components/settings/AutomationPlaybookSettings.tsx`
- Modify: `tests/unit/side-panel/AutomationPlaybookSettings.test.tsx`

**Interfaces:**
- Consumes store:
  - `importedSkillPlaybooks`
  - `importSkillPlaybooksFromJson`
  - `removeImportedSkillPlaybook`
  - `updateAutomationPlaybookSettings`
  - `automationPlaybookSettings`
  - optional `addNotification` if already used elsewhere for toasts

- [ ] **Step 1: Write failing UI tests**

Extend `tests/unit/side-panel/AutomationPlaybookSettings.test.tsx`:

```ts
it("支持导入 Skill 策略 JSON 并展示卡片", async () => {
  const user = userEvent.setup();
  const importSkillPlaybooksFromJson = vi.fn(async () => ({ ok: true as const, importedCount: 1 }));
  useAppStore.setState({
    automationPlaybookSettings: { disabledPlaybookIds: [] },
    importedSkillPlaybooks: [],
    updateAutomationPlaybookSettings: vi.fn(async () => undefined),
    importSkillPlaybooksFromJson,
    removeImportedSkillPlaybook: vi.fn(async () => undefined),
  });

  render(<AutomationPlaybookSettings />);
  expect(screen.getByRole("heading", { name: "Skill 策略" })).toBeInTheDocument();
  expect(screen.queryByText("暂未接入")).not.toBeInTheDocument();

  const input = screen.getByLabelText("导入 Skill 策略 JSON 文件") as HTMLInputElement;
  const file = new File([
    JSON.stringify({
      id: "shop_checkout_guard",
      title: "结账前检查",
      description: "提交订单前核对金额与地址",
      tags: ["购物"],
      risk: "high",
      recommendedCapabilities: ["observe_page"],
      selectionHints: ["结账"],
      prompt: "任务策略：结账前检查",
    }),
  ], "skill.json", { type: "application/json" });

  await user.upload(input, file);
  await waitFor(() => expect(importSkillPlaybooksFromJson).toHaveBeenCalled());
});

it("导入冲突时展示错误且不丢失已有卡片", async () => {
  const user = userEvent.setup();
  const importSkillPlaybooksFromJson = vi.fn(async () => ({
    ok: false as const,
    message: "与已导入策略 ID 冲突：shop_checkout_guard",
  }));
  useAppStore.setState({
    automationPlaybookSettings: { disabledPlaybookIds: [] },
    importedSkillPlaybooks: [{
      id: "shop_checkout_guard",
      title: "结账前检查",
      description: "desc",
      tags: [],
      source: "skill",
      defaultEnabled: true,
      risk: "high",
      recommendedCapabilities: ["observe_page"],
      selectionHints: ["结账"],
      prompt: "prompt",
      importedAt: 1,
      updatedAt: 1,
    }],
    updateAutomationPlaybookSettings: vi.fn(async () => undefined),
    importSkillPlaybooksFromJson,
    removeImportedSkillPlaybook: vi.fn(async () => undefined),
  });

  render(<AutomationPlaybookSettings />);
  expect(screen.getByText("结账前检查")).toBeInTheDocument();
  const input = screen.getByLabelText("导入 Skill 策略 JSON 文件");
  const file = new File(["{}"], "skill.json", { type: "application/json" });
  await user.upload(input, file);
  await waitFor(() => expect(screen.getByText(/冲突/)).toBeInTheDocument());
  expect(screen.getByText("结账前检查")).toBeInTheDocument();
});

it("可删除已导入 Skill 策略", async () => {
  const user = userEvent.setup();
  const removeImportedSkillPlaybook = vi.fn(async () => undefined);
  useAppStore.setState({
    automationPlaybookSettings: { disabledPlaybookIds: ["shop_checkout_guard"] },
    importedSkillPlaybooks: [{
      id: "shop_checkout_guard",
      title: "结账前检查",
      description: "desc",
      tags: [],
      source: "skill",
      defaultEnabled: true,
      risk: "high",
      recommendedCapabilities: ["observe_page"],
      selectionHints: ["结账"],
      prompt: "prompt",
      importedAt: 1,
      updatedAt: 1,
    }],
    updateAutomationPlaybookSettings: vi.fn(async () => undefined),
    importSkillPlaybooksFromJson: vi.fn(async () => ({ ok: true, importedCount: 0 })),
    removeImportedSkillPlaybook,
  });

  render(<AutomationPlaybookSettings />);
  await user.click(screen.getByRole("button", { name: "删除任务策略 结账前检查" }));
  await waitFor(() => expect(removeImportedSkillPlaybook).toHaveBeenCalledWith("shop_checkout_guard"));
});
```

Also keep existing builtin tests green; they may need store defaults for the new fields:

```ts
importedSkillPlaybooks: [],
importSkillPlaybooksFromJson: vi.fn(async () => ({ ok: true, importedCount: 0 })),
removeImportedSkillPlaybook: vi.fn(async () => undefined),
```

- [ ] **Step 2: Run UI tests to verify failure**

```bash
npx vitest run tests/unit/side-panel/AutomationPlaybookSettings.test.tsx
```

Expected: FAIL on missing controls / still showing 暂未接入.

- [ ] **Step 3: Implement Skill section UI**

Replace placeholder block with:

- heading `Skill 策略`
- button `导入 JSON` that triggers hidden file input
- hidden file input labeled `导入 Skill 策略 JSON 文件`
- local `importError` state
- empty text `尚未导入 Skill 策略`
- map `importedSkillPlaybooks` to cards reusing builtin card structure
- source badge already maps `skill -> "Skill 策略"`
- enable switch uses same disable-list logic
- details toggle
- delete button only for skill cards

Import handler sketch:

```ts
const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const result = await importSkillPlaybooksFromJson(text);
    if (!result.ok) {
      setImportError(result.message);
      return;
    }
    setImportError("");
    addNotification?.({ type: "success", message: `已导入 ${result.importedCount} 条 Skill 策略` });
  } catch {
    setImportError("无法读取文件");
  }
};
```

If `addNotification` API shape differs, use the existing notification helper already used by settings pages; if none is convenient, success can be silent and tests can assert action call only.

Extract a small internal `PlaybookCard` only if duplication becomes noisy; otherwise duplicate the card markup once for skill list to avoid broad refactor.

- [ ] **Step 4: Run UI tests**

```bash
npx vitest run tests/unit/side-panel/AutomationPlaybookSettings.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/side-panel/components/settings/AutomationPlaybookSettings.tsx tests/unit/side-panel/AutomationPlaybookSettings.test.tsx
git commit -m "feat: enable skill playbook JSON import in settings"
```

---

### Task 4: End-to-end path verification + package

**Files:**
- Possibly modify: `tests/unit/side-panel/App.test.tsx` or a small new test if request payload assertion is easier there
- No product file changes expected unless gaps found

- [ ] **Step 1: Add/adjust one request-path assertion**

Preferred minimal assertion in an existing unit test file that can access store + request builder, or a thin test around the message construction helper if extracted.

If direct App chat send test is heavy, assert via a focused test that:

1. store has `importedSkillPlaybooks = [sample]`
2. the object passed into chat send includes that array

If no clean seam exists, document and rely on `modelRequestHandler` unit-level coverage by extracting pure selection input assembly:

```ts
// optional tiny helper in modelRequestHandler or shared module
export function resolveAutomationPlaybooksForRequest(message: {
  automationPlaybookSettings?: AutomationPlaybookSettings;
  importedSkillPlaybooks?: ImportedAutomationPlaybook[];
}) {
  return getEnabledAutomationPlaybooks(
    message.automationPlaybookSettings,
    message.importedSkillPlaybooks ?? [],
  );
}
```

Then test:

```ts
expect(resolveAutomationPlaybooksForRequest({
  automationPlaybookSettings: { disabledPlaybookIds: [] },
  importedSkillPlaybooks: [sampleImported],
}).some((item) => item.id === "shop_checkout_guard")).toBe(true);
```

- [ ] **Step 2: Run the full related suite**

```bash
npx vitest run tests/unit/shared/automationPlaybooks.skillImport.test.ts tests/unit/side-panel/AutomationPlaybookSettings.test.tsx
```

Expected: PASS

If legacy script tests are in the normal `npm test` path and fail due to signature changes, either:

1. update call sites to pass optional second arg, or
2. keep old zero-arg behavior working (preferred; optional arg default `[]`).

- [ ] **Step 3: Package extension**

```bash
npm run package:extension
```

Expected: `artifacts/chrome-extension` regenerated.

- [ ] **Step 4: Final commit if any verification-only fixes remain**

```bash
git add -A
git status
git commit -m "test: cover skill playbook request candidate merge"
```

Only commit if there are remaining source/test changes.

---

## Spec Coverage Check

| Spec requirement | Task |
| --- | --- |
| Independent storage key `automationSkillPlaybooks` | Task 2 |
| JSON single/array import | Task 1 + Task 3 |
| Reject id conflicts | Task 1 + Task 3 |
| Enable via existing disable list | Task 1 + Task 2 + Task 3 |
| Delete imported + clean disable ids | Task 2 + Task 3 |
| Registry merge builtin + skill | Task 1 |
| Side panel passes imported list into request | Task 2 |
| Background uses merged enabled list | Task 2 + Task 4 |
| Settings UI replaces placeholder | Task 3 |
| No zip/paste/user authoring | enforced by scope of Tasks 1–3 |

## Placeholder / Consistency Review

- Function names are stable across tasks: `parseSkillPlaybookImportJson`, `mergeImportedSkillPlaybooks`, `normalizeImportedSkillPlaybooks`, `importSkillPlaybooksFromJson`, `removeImportedSkillPlaybook`.
- Optional second args default to `[]` so existing builtin-only call sites keep working.
- No TBD steps remain.
- `.mjs` parity intentionally de-scoped unless legacy tests force a fix; TS module is the product path used by side panel/background.
