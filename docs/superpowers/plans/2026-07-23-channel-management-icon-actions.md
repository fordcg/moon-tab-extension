# Settings Dialog Icon Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to keep this plan current while implementing and verifying the change.

**Goal:** Replace visible action-text buttons throughout the settings dialog with accessible icon buttons. In channel management, use a denser model layout: first line is the model name, second line is the model id, remote "already added" state is a small left status marker, and model actions stay stable on the right. Move browser automation diagnostics to the Tools and MCP page where browser-control/tool health belongs.

**Architecture:** Add a shared `SettingsIconButton` / `SettingsActionIcon` component under `src/side-panel/components/settings`. Use Lucide-style inline SVG stroke paths so the extension remains offline-buildable and does not add a runtime asset dependency. Keep `aria-label` and `data-soft-tooltip` for every icon-only action. Leave tabs, selects, list items, and content-choice buttons as text controls because their text is the selected content.

**Tech Stack:** React 19, TypeScript, Tailwind-style utility classes, scoped side-panel CSS, Vitest, Testing Library.

---

### Task 1: Add Regression Coverage

**Files:**
- Modify: `tests/unit/side-panel/App.test.tsx`

- [x] **Step 1: Cover icon-only actions**

Add/extend settings tests so action buttons keep accessible names but have no visible text:

```tsx
expect(screen.getByRole("button", { name: "新增渠道" })).toHaveTextContent("");
expect(screen.getByRole("button", { name: "新增规则" })).toHaveTextContent("");
expect(screen.getByRole("button", { name: "新增提示词" })).toHaveTextContent("");
expect(screen.getByRole("button", { name: "手动备份" })).toHaveTextContent("");
```

- [x] **Step 2: Cover the dense model row**

Add a mismatched remote model case such as `id: "gpt-5.4"` and `displayName: "GPT 5.5"`:

```tsx
expect(remoteOption.querySelector(".remote-model-title")).toHaveTextContent("GPT 5.5");
expect(remoteOption.querySelector(".remote-model-subtitle")).toHaveTextContent("gpt-5.4");
expect(remoteOption.querySelector(".remote-model-status-marker")).toBeInTheDocument();
expect(within(modelRow).getByText("GPT 5.5")).toHaveClass("model-list-title");
expect(within(modelRow).getByText("gpt-5.4")).toHaveClass("model-list-subtitle");
```

### Task 2: Implement Shared Settings Icon Buttons

**Files:**
- Add: `src/side-panel/components/settings/SettingsIconButton.tsx`
- Modify: `src/side-panel/components/settings/*.tsx`
- Modify: `src/side-panel/styles.css`

- [x] **Step 1: Add shared icon primitives**

Create `SettingsIconButton` and `SettingsActionIcon` with Lucide-style inline paths for actions including add, save, delete, refresh, upload, download, clear, settings, test, confirm, cancel, expand/collapse, visibility, and loading.

- [x] **Step 2: Replace visible action text across settings**

Use `SettingsIconButton` for execution buttons in:

- `ChannelManagement`
- `ExtractionRules`
- `PromptTemplateSettings`
- `SyncSettings`
- `McpToolSettings`
- `ChatPreferenceSettings`
- `AutomationDiagnostics`
- `AutomationPlaybookSettings`
- `MetapiAdminSettings`

Keep text buttons where text is the selected item or navigation label: tabs, settings selects, provider rows, prompt/rule rows, remote model options, generated URL candidates.

- [x] **Step 3: Rework model and remote model rows**

Use two-line model information:

```tsx
<span className="model-list-title">{model.displayName || model.modelId}</span>
<span className="model-list-subtitle">{model.modelId}</span>
```

Remote options use a left marker and two-line text:

```tsx
<span className="remote-model-status-marker" aria-hidden="true">...</span>
<span className="remote-model-title">{remoteModel.displayName || remoteModel.id}</span>
<span className="remote-model-subtitle">{remoteModel.id}</span>
```

- [x] **Step 4: Add layout CSS**

Add scoped CSS for:

- square `settings-icon-button`
- SVG sizing/spin
- `remote-model-status-marker`
- `model-row-content`
- `model-row-actions`
- truncating title/subtitle text
- narrow-width action wrapping below the model text

### Task 3: Verify and Review

- [x] **Step 1: Run focused unit tests**

Run:

```powershell
npm test -- tests/unit/side-panel/App.test.tsx -t "工具和 MCP 页展示浏览器自动化诊断|设置界面使用设置级 Tab 导航|渠道管理|模型连通性|已添加模型|远端模型|删除当前渠道|批量手动添加模型|模型 ID|名称为主行|提示词管理|同步设置|同步操作|恢复同步备份|新增提取规则|AI 生成|工具和 MCP|启用筛选结果" --reporter=dot
```

Result: PASS, 21 tests passed.

- [x] **Step 2: Run typecheck**

Run: `npm run typecheck`

Result: PASS.

- [x] **Step 3: Run whitespace check**

Run: `git diff --check`

Result: PASS with only Windows LF-to-CRLF warnings.

Known verification note:
- Full `npm test -- tests/unit/side-panel/App.test.tsx --reporter=dot` still reports 15 unrelated existing failures in notification, old overlay, slash menu, chat input, tool overlay, tool shelf, select legacy styling, and chat rendering tests. The focused settings/channel scope passes.

### Task 4: Move Browser Automation Diagnostics

**Files:**
- Modify: `src/side-panel/components/SettingsPanel.tsx`
- Modify: `src/side-panel/components/settings/McpToolSettings.tsx`
- Modify: `tests/unit/side-panel/App.test.tsx`

- [x] **Step 1: Remove global settings placement**

Remove `AutomationDiagnostics` from the generic settings tabpanel in `SettingsPanel`, so channel/rules/chat/prompts/sync pages do not show browser automation diagnostics.

- [x] **Step 2: Place diagnostics in Tools and MCP**

Render `AutomationDiagnostics` inside `McpToolSettings`, after the tool/MCP status row and before detailed tool-health sections.

- [x] **Step 3: Verify placement**

Update the diagnostics test to assert that the default channel page does not show the diagnostics section, then switch to "工具和 MCP" and verify the section can expand and show Network source.

Verification:
- `npm test -- tests/unit/side-panel/App.test.tsx -t "工具和 MCP 页展示浏览器自动化诊断|设置界面使用设置级 Tab 导航|工具和 MCP|MCP 设置页" --reporter=dot`: PASS, 5 tests passed.
- `npm test -- tests/unit/side-panel/App.test.tsx -t "工具和 MCP 页展示浏览器自动化诊断|设置界面使用设置级 Tab 导航|渠道管理|模型连通性|已添加模型|远端模型|删除当前渠道|批量手动添加模型|模型 ID|名称为主行|提示词管理|同步设置|同步操作|恢复同步备份|新增提取规则|AI 生成|工具和 MCP|启用筛选结果" --reporter=dot`: PASS, 21 tests passed.

### Task 5: Restore Settings Close X

**Files:**
- Modify: `src/side-panel/components/SettingsPanel.tsx`
- Modify: `src/side-panel/styles.css`
- Modify: `tests/unit/side-panel/App.test.tsx`

- [x] **Step 1: Render a real X icon**

The settings close button now renders the shared DOM icon directly:

```tsx
<button className="settings-dialog-back" aria-label="关闭设置">
  <SettingsActionIcon name="x" />
</button>
```

- [x] **Step 2: Disable the close-button pseudo icon**

Add a later CSS override for `.settings-dialog-back::before` so the visible X comes from the DOM icon instead of a mask-dependent pseudo element.

- [x] **Step 3: Verify**

Add a test assertion that the "关闭设置" button contains `.settings-action-icon` and still has no visible text.

Verification:
- `npm test -- tests/unit/side-panel/App.test.tsx -t "设置界面使用设置级 Tab 导航|工具和 MCP 页展示浏览器自动化诊断" --reporter=dot`: PASS, 2 tests passed.
- `npm run typecheck`: PASS.
- `npm test -- tests/unit/side-panel/App.test.tsx -t "工具和 MCP 页展示浏览器自动化诊断|设置界面使用设置级 Tab 导航|渠道管理|模型连通性|已添加模型|远端模型|删除当前渠道|批量手动添加模型|模型 ID|名称为主行|提示词管理|同步设置|同步操作|恢复同步备份|新增提取规则|AI 生成|工具和 MCP|启用筛选结果" --reporter=dot`: PASS, 21 tests passed.

### Task 6: Remove Unused History Default Switch

**Files:**
- Modify: `src/side-panel/App.tsx`
- Modify: `src/side-panel/components/settings/ChatPreferenceSettings.tsx`
- Modify: `tests/unit/side-panel/App.test.tsx`

- [x] **Step 1: Remove the settings UI**

Remove the `默认展开左侧历史面板` switch from chat preferences.

- [x] **Step 2: Remove the runtime effect**

Stop reading `chatPreferences.historyDrawerDefaultOpen` in `App.tsx`. Existing stored values no longer change the side-panel history default state.

- [x] **Step 3: Verify**

Update tests so the chat preference page asserts the checkbox is absent, and a stored legacy `historyDrawerDefaultOpen: true` still starts with the history panel collapsed while manual expansion keeps working.

Verification:
- `npm test -- tests/unit/side-panel/App.test.tsx -t "设置中提供全局聊天偏好入口|左侧历史区域忽略旧默认展开偏好并保留手动展开" --reporter=dot`: PASS, 2 tests passed.
- `npm run typecheck`: PASS.
- `npm test -- tests/unit/side-panel/App.test.tsx -t "设置中提供全局聊天偏好入口|左侧历史区域忽略旧默认展开偏好|工具和 MCP 页展示浏览器自动化诊断|设置界面使用设置级 Tab 导航|渠道管理|模型连通性|已添加模型|远端模型|删除当前渠道|批量手动添加模型|模型 ID|名称为主行|提示词管理|同步设置|同步操作|恢复同步备份|新增提取规则|AI 生成|工具和 MCP|启用筛选结果" --reporter=dot`: PASS, 23 tests passed.
