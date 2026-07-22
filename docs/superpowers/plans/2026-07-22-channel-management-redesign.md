# Channel Management Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign side-panel 渠道管理 into a vertical master–detail channel/model manager with enable switches, move default/title model pickers to 聊天偏好, and remove Tavily UI from channel management—without changing settings dialog size or page-slide animation.

**Architecture:** Keep Zustand + IndexedDB catalog as source of truth. Selection eligibility already lives in `resolveAvailableModelId` / `ModelSelector` (`provider.enabled && model.enabled`). This plan wires UI switches, extends `updateProvider`/`updateModel` types, restructures `ChannelManagement` into list-above + full-width detail-below, migrates two global selects into `ChatPreferenceSettings`, and rewrites the outdated channel tests that currently require Tavily + draft provider.

**Tech Stack:** TypeScript, React, Zustand, Vitest, Testing Library, existing side-panel CSS tokens / `chat-preference-switch` pattern.

## Global Constraints

- Detail panel is a **single block after the full channel list** (not between rows).
- Accordion: one expanded channel; click same row collapses; enable switch does not expand/collapse.
- Default expand: first enabled channel, else first channel; empty list → empty CTA, **no draft ghost provider**.
- Remove Tavily UI from channel management (storage may remain; no UI on this tab).
- Move **默认对话模型** and **AI 标题生成模型** to 聊天偏好.
- Confirm before delete channel / clear all models (`window.confirm`, same as ExtractionRules/PromptTemplateSettings).
- Settings dialog size, history↔settings horizontal slide: **do not change**.
- After implementation: run relevant tests, `npm run package:extension`, and commit (per project feedback).
- Spec: `docs/superpowers/specs/2026-07-22-channel-management-redesign-design.md`.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/side-panel/state/appStore.ts` | Allow `enabled` on `updateProvider` / `updateModel`; when disabling, re-resolve `selectedModelId` / `defaultChatModelId` / title model via existing helpers. |
| `src/side-panel/state/appStoreModelSelection.ts` | Already filters enabled; keep as single eligibility source (only touch if tests need a small export helper). |
| `src/side-panel/components/settings/ChannelManagement.tsx` | Master list + detail below; enable switches; no Tavily; no default/title; no draft provider; confirms; API key show/hide. Optionally split into sibling files under `settings/channel/` if the file stays >400 lines after rewrite. |
| `src/side-panel/components/settings/ChatPreferenceSettings.tsx` | Host migrated default chat model + title model selects. |
| `src/side-panel/styles.css` | Minimal classes for channel row enable layout / disabled opacity / detail region if utilities are insufficient. |
| `tests/unit/side-panel/webSearchSettingsOptimization.test.tsx` | Remove or rewrite channel/Tavily assertions that contradict the redesign. |
| `tests/unit/side-panel/channelManagementRedesign.test.tsx` | New UI tests for master–detail, empty state, enable switches, no Tavily, chat-pref migration. |
| `tests/unit/side-panel/appStoreChannelEnable.test.ts` | Store tests: persist `enabled`, filter/fallback when disabling. |

---

### Task 1: Store — enable updates + selection fallback

**Files:**
- Modify: `src/side-panel/state/appStore.ts` (type of `updateProvider` / `updateModel`; body of both actions)
- Create: `tests/unit/side-panel/appStoreChannelEnable.test.ts`
- Reuse: `src/side-panel/state/appStoreModelSelection.ts` (`resolveAvailableModelId`, `resolveConfiguredModelId`)

**Interfaces:**
- Consumes: `resolveAvailableModelId(modelId, models, providers)`, `resolveConfiguredModelId(...)`, `saveModelProvider`, `saveProviderModel`, `setTitleModel` logic
- Produces:
  - `updateProvider(providerId, updates: Partial<Pick<ModelProvider, "name" | "endpointType" | "endpointUrl" | "apiKey" | "enabled">>)`
  - `updateModel(modelId, updates: Partial<Pick<ProviderModel, "displayName" | "modelId" | "temperature" | "maxTokens" | "topK" | "systemPrompt" | "supportsVision" | "reasoningEffort" | "enabled">>)`
  - After enable flips, ineligible `selectedModelId` / `defaultChatModelId` / title model are cleared or reassigned to first eligible model

- [ ] **Step 1: Write the failing store tests**

Create `tests/unit/side-panel/appStoreChannelEnable.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../../src/side-panel/state/appStore";
import {
  clearDatabase,
  getModelProviders,
  getProviderModels,
  getAppSetting,
  saveModelProvider,
  saveProviderModel,
} from "../../../src/shared/storage/repositories";
import type { ModelProvider, ProviderModel } from "../../../src/shared/types";

function provider(partial: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: "provider-1",
    name: "渠道 A",
    endpointType: "openai_chat",
    endpointUrl: "https://api.example.com",
    apiKey: "sk-a",
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

function model(partial: Partial<ProviderModel> = {}): ProviderModel {
  return {
    id: "model-1",
    providerId: "provider-1",
    displayName: "模型 A",
    modelId: "gpt-a",
    temperature: 0.7,
    maxTokens: 1024,
    systemPrompt: "sys",
    isTitleModel: false,
    supportsVision: false,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe("channel/model enable in appStore", () => {
  afterEach(async () => {
    useAppStore.getState().reset();
    await clearDatabase();
  });

  it("updateProvider persists enabled=false", async () => {
    const p = provider();
    await saveModelProvider(p);
    useAppStore.setState({ providers: [p], models: [] });

    useAppStore.getState().updateProvider(p.id, { enabled: false });

    expect(useAppStore.getState().providers[0]?.enabled).toBe(false);
    const saved = await getModelProviders();
    expect(saved.find((item) => item.id === p.id)?.enabled).toBe(false);
  });

  it("updateModel persists enabled=false", async () => {
    const p = provider();
    const m = model();
    await saveModelProvider(p);
    await saveProviderModel(m);
    useAppStore.setState({ providers: [p], models: [m] });

    useAppStore.getState().updateModel(m.id, { enabled: false });

    expect(useAppStore.getState().models[0]?.enabled).toBe(false);
    const saved = await getProviderModels();
    expect(saved.find((item) => item.id === m.id)?.enabled).toBe(false);
  });

  it("disabling selected model falls back selectedModelId to next eligible model", async () => {
    const p = provider();
    const m1 = model({ id: "model-1", modelId: "gpt-a", displayName: "A" });
    const m2 = model({ id: "model-2", modelId: "gpt-b", displayName: "B" });
    useAppStore.setState({
      providers: [p],
      models: [m1, m2],
      selectedModelId: "model-1",
      defaultChatModelId: "model-1",
    });

    useAppStore.getState().updateModel("model-1", { enabled: false });

    const state = useAppStore.getState();
    expect(state.selectedModelId).toBe("model-2");
    expect(state.defaultChatModelId).toBe("model-2");
  });

  it("disabling channel falls back away from that channel's models", async () => {
    const p1 = provider({ id: "provider-1", name: "A" });
    const p2 = provider({ id: "provider-2", name: "B" });
    const m1 = model({ id: "model-1", providerId: "provider-1" });
    const m2 = model({ id: "model-2", providerId: "provider-2", modelId: "gpt-b", displayName: "B" });
    useAppStore.setState({
      providers: [p1, p2],
      models: [m1, m2],
      selectedModelId: "model-1",
      defaultChatModelId: "model-1",
    });

    useAppStore.getState().updateProvider("provider-1", { enabled: false });

    const state = useAppStore.getState();
    expect(state.providers.find((item) => item.id === "provider-1")?.enabled).toBe(false);
    expect(state.selectedModelId).toBe("model-2");
    expect(state.defaultChatModelId).toBe("model-2");
  });

  it("disabling the title model clears isTitleModel", async () => {
    const p = provider();
    const m1 = model({ id: "model-1", isTitleModel: true });
    const m2 = model({ id: "model-2", modelId: "gpt-b", displayName: "B" });
    useAppStore.setState({ providers: [p], models: [m1, m2] });

    useAppStore.getState().updateModel("model-1", { enabled: false });

    const models = useAppStore.getState().models;
    expect(models.find((item) => item.id === "model-1")?.isTitleModel).toBe(false);
    // title may stay cleared (no auto-assign) or move — require at least not pointing at disabled model
    expect(models.some((item) => item.isTitleModel && item.id === "model-1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/unit/side-panel/appStoreChannelEnable.test.ts
```

Expected: FAIL — `updateProvider` / `updateModel` types or behavior do not accept/handle `enabled` fallback (TypeScript and/or assertion failures on selectedModelId).

- [ ] **Step 3: Minimal store implementation**

In `src/side-panel/state/appStore.ts`:

1. Change the interface signatures:

```ts
updateProvider: (
  providerId: string,
  updates: Partial<Pick<ModelProvider, "name" | "endpointType" | "endpointUrl" | "apiKey" | "enabled">>,
) => void;
updateModel: (
  modelId: string,
  updates: Partial<
    Pick<
      ProviderModel,
      | "displayName"
      | "modelId"
      | "temperature"
      | "maxTokens"
      | "topK"
      | "systemPrompt"
      | "supportsVision"
      | "reasoningEffort"
      | "enabled"
    >
  >,
) => void;
```

2. After applying provider/model updates inside `updateProvider` / `updateModel`, recompute eligibility:

```ts
// shared helper inside appStore.ts (near model selection imports)
function reconcileSelectionAfterCatalogChange(
  state: Pick<AppState, "models" | "providers" | "selectedModelId" | "defaultChatModelId">,
): Pick<AppState, "selectedModelId" | "defaultChatModelId" | "models"> {
  const selectedModelId = resolveAvailableModelId(state.selectedModelId, state.models, state.providers);
  const defaultChatModelId = resolveConfiguredModelId(state.defaultChatModelId, state.models, state.providers)
    || resolveAvailableModelId(state.defaultChatModelId, state.models, state.providers);
  // If title model is disabled or its provider is disabled, clear isTitleModel on that row.
  let models = state.models;
  const title = models.find((model) => model.isTitleModel);
  if (title) {
    const provider = state.providers.find((item) => item.id === title.providerId);
    if (!title.enabled || !provider?.enabled) {
      models = models.map((model) =>
        model.id === title.id ? { ...model, isTitleModel: false, updatedAt: Date.now() } : model,
      );
      const cleared = models.find((model) => model.id === title.id);
      if (cleared) {
        void saveProviderModel(cleared);
      }
    }
  }
  return { selectedModelId, defaultChatModelId, models };
}
```

3. In `updateProvider` set callback, after building `providers`, call reconcile and return `{ providers, ...reconcile }`. If `defaultChatModelId` changed, also `void saveAppSetting({ key: "defaultChatModelId", value: defaultChatModelId, updatedAt: Date.now() })` (same pattern as `setDefaultChatModel`).

4. In `updateModel` set callback, same reconcile after models update.

Do **not** change `resolveAvailableModelId` — it already requires `model.enabled && provider?.enabled`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/unit/side-panel/appStoreChannelEnable.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/side-panel/state/appStore.ts tests/unit/side-panel/appStoreChannelEnable.test.ts
git commit -m "$(cat <<'EOF'
feat(store): persist channel/model enabled and re-resolve selection

EOF
)"
```

---

### Task 2: Move default + title model pickers to 聊天偏好

**Files:**
- Modify: `src/side-panel/components/settings/ChatPreferenceSettings.tsx`
- Modify: `src/side-panel/components/settings/ChannelManagement.tsx` (delete the “AI 标题生成” section and related state)
- Modify: `tests/unit/side-panel/webSearchSettingsOptimization.test.tsx` (stop expecting those labels under channel tab)
- Create/extend: `tests/unit/side-panel/channelManagementRedesign.test.tsx` (chat pref assertions)

**Interfaces:**
- Consumes: `useAppStore` → `models`, `providers`, `defaultChatModelId`, `setDefaultChatModel`, `setTitleModel`, `SettingsSelect`, `formatModelLabelWithVision`
- Produces: Chat preference section containing two selects with the same option semantics as today (including empty options)

- [ ] **Step 1: Write failing UI tests for migration**

In `tests/unit/side-panel/channelManagementRedesign.test.tsx`:

```ts
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsPanel } from "../../../src/side-panel/components/SettingsPanel";
import { useAppStore } from "../../../src/side-panel/state/appStore";
import { clearDatabase } from "../../../src/shared/storage/repositories";
import type { ModelProvider, ProviderModel } from "../../../src/shared/types";

function createProvider(partial: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: "provider-1",
    name: "测试渠道",
    endpointType: "openai_chat",
    endpointUrl: "https://api.example.com",
    apiKey: "sk-test",
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

function createModel(partial: Partial<ProviderModel> = {}): ProviderModel {
  return {
    id: "model-1",
    providerId: "provider-1",
    displayName: "测试模型",
    modelId: "gpt-test",
    temperature: 0.7,
    maxTokens: 1024,
    systemPrompt: "你是网页助手",
    isTitleModel: false,
    supportsVision: false,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe("channel management redesign — model picker migration", () => {
  afterEach(async () => {
    useAppStore.getState().reset();
    await clearDatabase();
  });

  it("shows default/title model pickers under 聊天偏好, not 渠道管理", async () => {
    const user = userEvent.setup();
    useAppStore.setState({
      providers: [createProvider()],
      models: [createModel()],
    });

    render(<SettingsPanel initialTab="channels" />);

    // Channel tab must not own global model pickers
    expect(screen.queryByLabelText("默认对话模型")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("AI 标题生成模型")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "聊天偏好" }));
    expect(await screen.findByLabelText("默认对话模型")).toBeInTheDocument();
    expect(screen.getByLabelText("AI 标题生成模型")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/side-panel/channelManagementRedesign.test.tsx
```

Expected: FAIL — pickers still on channel tab / missing on chat pref.

- [ ] **Step 3: Implement migration**

In `ChatPreferenceSettings.tsx`, after the `h3` title (or before system prompt), add:

```tsx
const providers = useAppStore((state) => state.providers);
const models = useAppStore((state) => state.models);
const defaultChatModelId = useAppStore((state) => state.defaultChatModelId);
const setDefaultChatModel = useAppStore((state) => state.setDefaultChatModel);
const setTitleModel = useAppStore((state) => state.setTitleModel);
const selectedTitleModelId = models.find((model) => model.isTitleModel)?.id ?? "";
const titleModelOptions = useMemo(
  () =>
    models
      .map((model) => {
        const provider = providers.find((item) => item.id === model.providerId);
        if (!provider?.enabled || !model.enabled) {
          return undefined;
        }
        return {
          id: model.id,
          label: formatModelLabelWithVision(`${provider.name} / ${model.displayName}`, model.supportsVision),
        };
      })
      .filter((item): item is { id: string; label: string } => Boolean(item)),
  [models, providers],
);

// JSX near top of section:
<section className="grid gap-3 border-b border-[var(--color-hairline)] pb-3" aria-label="全局模型">
  <div className="grid gap-1 text-sm">
    <span>默认对话模型</span>
    <SettingsSelect
      ariaLabel="默认对话模型"
      triggerAriaLabel="默认对话模型菜单"
      value={defaultChatModelId}
      options={[
        { value: "", label: "使用第一个可用模型" },
        ...titleModelOptions.map((model) => ({ value: model.id, label: model.label })),
      ]}
      onChange={(value) => void setDefaultChatModel(value)}
    />
  </div>
  <div className="grid gap-1 text-sm">
    <span>AI 标题生成模型</span>
    <SettingsSelect
      ariaLabel="AI 标题生成模型"
      triggerAriaLabel="AI 标题生成模型菜单"
      value={selectedTitleModelId}
      options={[
        { value: "", label: "不开启自动标题生成" },
        ...titleModelOptions.map((model) => ({ value: model.id, label: model.label })),
      ]}
      onChange={(value) => setTitleModel(value)}
    />
  </div>
  <p className="text-xs text-[var(--color-muted)]">选择后仅在首轮对话完成后额外发起一次非流式标题请求。</p>
</section>
```

Imports to add: `useMemo`, `formatModelLabelWithVision` from `../ModelVisionIndicator`, `SettingsSelect`.

In `ChannelManagement.tsx`, delete the entire section with `aria-label="AI 标题生成"` and unused store hooks (`defaultChatModelId`, `setDefaultChatModel`, `setTitleModel`, `selectedTitleModelId`, `titleModelOptions`) once no longer referenced.

Update `tests/unit/side-panel/webSearchSettingsOptimization.test.tsx`:

- In tests that `expect(screen.getByLabelText("默认对话模型"))` under channel tab, remove those expects or move them to the new test file.
- Delete or rewrite the test `"网络搜索配置与渠道模型配置是渠道管理下的同级 section"` and `"网络搜索配置可以设置 Tavily 参数..."` (Tavily UI is removed in Task 3; if still present after Task 2, leave rewrite for Task 3).

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/unit/side-panel/channelManagementRedesign.test.tsx tests/unit/side-panel/webSearchSettingsOptimization.test.tsx
```

Expected: new migration test PASS; old file either updated and PASS or only Tavily-related failures left for Task 3.

- [ ] **Step 5: Commit**

```bash
git add src/side-panel/components/settings/ChatPreferenceSettings.tsx \
  src/side-panel/components/settings/ChannelManagement.tsx \
  tests/unit/side-panel/channelManagementRedesign.test.tsx \
  tests/unit/side-panel/webSearchSettingsOptimization.test.tsx
git commit -m "$(cat <<'EOF'
feat(settings): move default and title model pickers to chat preferences

EOF
)"
```

---

### Task 3: ChannelManagement UI — master list + detail below, remove Tavily/draft, enable switches

**Files:**
- Modify: `src/side-panel/components/settings/ChannelManagement.tsx` (major rewrite)
- Optionally create: `src/side-panel/components/settings/channel/ChannelList.tsx`, `ChannelDetailPanel.tsx`, `ProviderModelList.tsx` if the main file would exceed ~400 lines
- Modify: `src/side-panel/styles.css` (only if needed for row switch layout)
- Modify: `tests/unit/side-panel/channelManagementRedesign.test.tsx`
- Modify: `tests/unit/side-panel/webSearchSettingsOptimization.test.tsx` (remove obsolete Tavily / draft / “渠道模型 always visible” cases)

**Interfaces:**
- Consumes: store actions from Task 1; existing fetch/test/add/delete model APIs
- Produces UI contracts used by tests:
  - Region `渠道管理`
  - Channel rows as buttons named by provider name (regex `/测试渠道/`)
  - Expanded detail: `role="region"` name `当前渠道详情` **or** `渠道详情：{name}` (pick one and use consistently in tests — recommended: `当前渠道详情` to minimize churn)
  - Models region only when expanded: `渠道模型`
  - Switches: `getByRole("switch", { name: "渠道启用：测试渠道" })`, `getByRole("switch", { name: "模型启用：测试模型" })` (use displayName)
  - No `Tavily` text; no draft `默认渠道` when providers empty
  - Empty: button `新增渠道` and copy containing `还没有渠道`

- [ ] **Step 1: Write failing UI tests for layout/enable/empty/no-Tavily**

Append to `channelManagementRedesign.test.tsx`:

```ts
describe("channel management redesign — layout", () => {
  afterEach(async () => {
    useAppStore.getState().reset();
    await clearDatabase();
  });

  it("auto-expands first enabled channel and places detail after the list", async () => {
    useAppStore.setState({
      providers: [
        createProvider({ id: "provider-1", name: "渠道一", enabled: true }),
        createProvider({ id: "provider-2", name: "渠道二", enabled: true, endpointUrl: "https://b.example.com" }),
      ],
      models: [createModel({ providerId: "provider-1" })],
    });

    render(<SettingsPanel initialTab="channels" />);

    const detail = await screen.findByRole("region", { name: "当前渠道详情" });
    const listButton = screen.getByRole("button", { name: /渠道一/ });
    // detail is not inside the list button
    expect(listButton).not.toContainElement(detail);
    // models visible when expanded
    expect(screen.getByRole("region", { name: "渠道模型" })).toBeInTheDocument();
  });

  it("collapses detail when clicking the expanded channel again", async () => {
    const user = userEvent.setup();
    useAppStore.setState({
      providers: [createProvider()],
      models: [createModel()],
    });
    render(<SettingsPanel initialTab="channels" />);
    expect(await screen.findByRole("region", { name: "当前渠道详情" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /测试渠道/ }));
    expect(screen.queryByRole("region", { name: "当前渠道详情" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "渠道模型" })).not.toBeInTheDocument();
  });

  it("toggles channel enable without collapsing via switch", async () => {
    const user = userEvent.setup();
    const updateProvider = vi.fn();
    useAppStore.setState({
      providers: [createProvider()],
      models: [createModel()],
      updateProvider,
    });
    render(<SettingsPanel initialTab="channels" />);
    expect(await screen.findByRole("region", { name: "当前渠道详情" })).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "渠道启用：测试渠道" }));
    expect(updateProvider).toHaveBeenCalledWith("provider-1", { enabled: false });
    expect(screen.getByRole("region", { name: "当前渠道详情" })).toBeInTheDocument();
  });

  it("toggles model enable from model row", async () => {
    const user = userEvent.setup();
    const updateModel = vi.fn();
    useAppStore.setState({
      providers: [createProvider()],
      models: [createModel()],
      updateModel,
    });
    render(<SettingsPanel initialTab="channels" />);
    await screen.findByRole("region", { name: "渠道模型" });

    await user.click(screen.getByRole("switch", { name: "模型启用：测试模型" }));
    expect(updateModel).toHaveBeenCalledWith("model-1", { enabled: false });
  });

  it("shows empty state without draft provider and without Tavily", async () => {
    useAppStore.setState({ providers: [], models: [] });
    render(<SettingsPanel initialTab="channels" />);

    expect(await screen.findByText(/还没有渠道/)).toBeInTheDocument();
    expect(screen.queryByText("默认渠道")).not.toBeInTheDocument();
    expect(screen.queryByText(/Tavily/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新增渠道" })).toBeInTheDocument();
  });
});
```

Import `vi` from vitest for mocks.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/unit/side-panel/channelManagementRedesign.test.tsx
```

Expected: FAIL on auto-expand / switch names / empty copy / Tavily still present.

- [ ] **Step 3: Rewrite ChannelManagement UI**

Target structure (single file first; split only if needed):

```tsx
export function ChannelManagement() {
  // store hooks (no webSearch, no defaultChatModel, no title model)
  const providers = useAppStore((s) => s.providers);
  // ...
  const [selectedProviderId, setSelectedProviderId] = useState<string>();
  const [expandedProviderId, setExpandedProviderId] = useState<string>();
  // init expand on providers change:
  useEffect(() => {
    if (providers.length === 0) {
      setSelectedProviderId(undefined);
      setExpandedProviderId(undefined);
      return;
    }
    const stillSelected = selectedProviderId && providers.some((p) => p.id === selectedProviderId);
    if (!stillSelected) {
      const firstEnabled = providers.find((p) => p.enabled) ?? providers[0];
      setSelectedProviderId(firstEnabled.id);
      setExpandedProviderId(firstEnabled.id);
    }
  }, [providers, selectedProviderId]);

  const selectedProvider = providers.find((p) => p.id === selectedProviderId);
  const isExpanded = Boolean(selectedProvider && expandedProviderId === selectedProvider.id);

  const handleRowClick = (providerId: string) => {
    if (selectedProviderId === providerId && expandedProviderId === providerId) {
      setExpandedProviderId(undefined);
      return;
    }
    setSelectedProviderId(providerId);
    setExpandedProviderId(providerId);
  };

  return (
    <section className="grid w-full gap-4" aria-label="渠道管理">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">模型渠道</h3>
        <button className="ui-button-secondary" type="button" onClick={handleAddProvider}>新增渠道</button>
      </div>

      {providers.length === 0 ? (
        <div className="grid gap-2 rounded-lg border border-dashed border-[var(--color-hairline)] p-4 text-sm">
          <p className="text-[var(--color-muted)]">还没有渠道。新增一个模型渠道后即可配置端点与模型。</p>
          <button className="ui-button-secondary w-fit" type="button" onClick={handleAddProvider}>新增渠道</button>
        </div>
      ) : (
        <div className="grid gap-2">
          {providers.map((provider) => {
            const modelCount = models.filter((m) => m.providerId === provider.id).length;
            const expanded = expandedProviderId === provider.id;
            return (
              <div
                key={provider.id}
                className={[
                  "flex items-stretch gap-2 rounded-lg border p-2",
                  selectedProviderId === provider.id
                    ? "border-[var(--color-primary)] bg-[var(--color-surface-card)]"
                    : "border-[var(--color-hairline)] bg-[var(--color-canvas)]",
                  provider.enabled ? "" : "opacity-60",
                ].join(" ")}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded-md p-2 text-left"
                  aria-expanded={expanded}
                  aria-controls={expanded ? "channel-detail-panel" : undefined}
                  onClick={() => handleRowClick(provider.id)}
                >
                  <span className="block text-sm font-medium">{provider.name}</span>
                  <span className="ui-muted mt-1 block truncate text-xs">{provider.endpointUrl}</span>
                  <span className="ui-muted mt-1 block text-xs">
                    {provider.endpointType === "anthropic_messages" ? "Anthropic" : "OpenAI"} · {modelCount} 个模型
                  </span>
                </button>
                <label className="chat-preference-switch shrink-0 self-center px-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    className="chat-preference-switch-input"
                    type="checkbox"
                    role="switch"
                    aria-label={`渠道启用：${provider.name}`}
                    checked={provider.enabled}
                    onChange={(event) => updateProvider(provider.id, { enabled: event.target.checked })}
                  />
                  <span className="chat-preference-switch-control" aria-hidden="true">
                    <span className="chat-preference-switch-thumb" />
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      )}

      {isExpanded && selectedProvider ? (
        <section
          id="channel-detail-panel"
          className="grid gap-3 border-t border-[var(--color-hairline)] bg-[var(--color-surface-soft)] pt-4"
          aria-label="当前渠道详情"
          role="region"
        >
          {/* name, endpoint type, url, api key with show/hide, fetch models, delete with confirm */}
          {/* model list region aria-label="渠道模型" with enable switches, settings/test/delete, batch add, remote list */}
        </section>
      ) : null}

      {/* ModelSettingsDialog remains */}
    </section>
  );
}
```

**Must implement in this task:**

1. **Remove** all Tavily UI, `useComposedTextInput` for tavily, `showTavilyApiKey`, `TavilyApiKeyVisibilityIcon`, webSearch store hooks, and imports from `webSearch/settings`.
2. **Remove** `draftProvider` / `draftModel` usage entirely.
3. **Remove** global default/title section (if still present).
4. **API Key show/hide** on provider field (copy former tavily eye icon pattern; rename class if desired to `api-key-visibility-icon` or reuse existing CSS).
5. **Delete channel** / **清空所有**:

```ts
const handleDeleteProvider = () => {
  if (!window.confirm(`确认删除渠道「${selectedProvider.name}」及其模型吗？`)) return;
  // existing delete + selection update
};
const handleClearModels = () => {
  if (!window.confirm("确认清空当前渠道下的所有模型吗？")) return;
  // existing clear
};
```

6. **Model row label**: primary `model.displayName`, secondary `model.modelId` if different; switch `aria-label={`模型启用：${model.displayName}`}`.
7. **Models only inside expanded detail** (when collapsed, no `渠道模型` region).
8. Keep fetch remote models, batch add, model settings dialog, connectivity status.

- [ ] **Step 4: Fix obsolete tests in webSearchSettingsOptimization.test.tsx**

Either:

- Delete channel-related tests that assert Tavily under channel management, draft「默认渠道」, or “models remain when collapsed”, **or**
- Rewrite them to match the new contracts above.

If the file becomes empty of meaningful cases, delete the file and rely on `channelManagementRedesign.test.tsx`. Prefer rewrite/delete over leaving failing tests.

- [ ] **Step 5: Run tests**

```bash
npm test -- tests/unit/side-panel/channelManagementRedesign.test.tsx tests/unit/side-panel/webSearchSettingsOptimization.test.tsx tests/unit/side-panel/appStoreChannelEnable.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/side-panel/components/settings/ChannelManagement.tsx \
  src/side-panel/components/settings/channel \
  src/side-panel/styles.css \
  tests/unit/side-panel/channelManagementRedesign.test.tsx \
  tests/unit/side-panel/webSearchSettingsOptimization.test.tsx
git commit -m "$(cat <<'EOF'
feat(settings): redesign channel management as vertical master-detail

EOF
)"
```

---

### Task 4: Regression sweep, package, final commit

**Files:**
- Touch only if tests reveal leftovers (imports, dead Tavily-only helpers in ChannelManagement, CSS)
- Do not remove background Tavily runtime in this plan

- [ ] **Step 1: Grep for leftover channel-tab Tavily / draft UI**

```bash
rg -n "Tavily|draftProvider|draft-provider|默认渠道" src/side-panel/components/settings/ChannelManagement.tsx
```

Expected: no matches (except possibly comments — remove those too).

- [ ] **Step 2: Run focused + broader side-panel tests**

```bash
npm test -- tests/unit/side-panel/channelManagementRedesign.test.tsx tests/unit/side-panel/appStoreChannelEnable.test.ts tests/unit/side-panel/appStore.test.ts tests/unit/side-panel/App.test.tsx
```

Expected: PASS (fix any failures caused by missing pickers on channel tab or draft provider assumptions).

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 4: Package extension**

```bash
npm run package:extension
```

Expected: success; dist builds ChannelManagement chunk without errors.

- [ ] **Step 5: Manual smoke checklist (record results in commit body if anything fails)**

1. Open settings → 渠道管理: list + auto-expanded detail under list.
2. Toggle channel/model switches; verify composer model menu hides disabled entries.
3. 聊天偏好 shows default + title model selects.
4. No Tavily block on channel tab.
5. Delete channel / clear models show confirm.
6. History ↔ settings slide and dialog size unchanged.

- [ ] **Step 6: Final commit if packaging or test fixes remain uncommitted**

```bash
git add -A
git status
git commit -m "$(cat <<'EOF'
chore: verify channel management redesign package build

EOF
)"
```

Only commit if there are real leftover fixes; skip empty commit.

---

## Spec coverage self-check

| Spec requirement | Task |
| --- | --- |
| Vertical master–detail, detail below full list | Task 3 |
| Accordion expand / collapse same row | Task 3 |
| Default expand first enabled | Task 3 |
| No draft ghost provider | Task 3 |
| Channel + model enable switches | Task 1 + 3 |
| Enable filters selectors / fallbacks | Task 1 (ModelSelector already filters) |
| Remove Tavily UI from channel tab | Task 3 |
| Default + title → 聊天偏好 | Task 2 |
| Confirm delete channel / clear models | Task 3 |
| API Key show/hide | Task 3 |
| Dialog size / page slide unchanged | Task 3 non-goal + Task 4 manual |
| Tests for enable / empty / no Tavily / migration | Tasks 1–3 |
| package:extension | Task 4 |

## Placeholder / consistency notes

- Confirm copy strings are fixed in Task 3 (`window.confirm(...)`).
- Region name locked to `当前渠道详情` and `渠道模型` for tests.
- Switch labels locked to `渠道启用：{name}` and `模型启用：{displayName}`.
- `updateProvider` / `updateModel` signatures include `enabled` only after Task 1.
