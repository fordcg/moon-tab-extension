# 全面迁移远程工程化结构 Phase 0-1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 `PocketAide/` 并把当前仓库建立为可安装、可类型检查、可构建、可测试的远程工程化基础骨架。

**Architecture:** 本阶段不迁移 Moon Tab 页面、游戏页面、悬浮助手和定制 background 行为，只建立后续迁移所需的 Vite/React/TypeScript/Vitest/Playwright 基线。远程 `browser-ai-assistant` 源码以并行方式引入当前仓库，当前 JS/MJS 页面代码暂时保留，后续 Phase 单独迁入构建体系。

**Tech Stack:** Chrome MV3, Vite, React 19, TypeScript, Vitest, Playwright, PowerShell, Node.js >= 20.

---

## Scope

This plan implements only Phase 0 and Phase 1 from `docs/superpowers/specs/2026-07-05-full-upstream-engineering-migration-design.md`.

In scope:

- Delete `PocketAide/`.
- Add remote engineering root files.
- Add remote TypeScript source tree for side panel, background, shared modules, content script, tests, and extension packaging.
- Merge `package.json` scripts so current Grok/MCP helper commands remain available.
- Install dependencies and verify `typecheck`, `build:extension`, and `test`.

Out of scope:

- Migrating `src/pages/newtab/` into Vite.
- Migrating `src/pages/game/` into Vite.
- Replacing `src/ai-assistant/sidePanel.js`.
- Merging `src/background/service-worker.js` behavior into `src/background/index.ts`.
- Enabling remote high-risk `js.*`, `sourcemap.*`, `runtime.*`, `replay.*`, or `full_access.*` tools in the current product.

## File Structure

Files and directories to delete:

- Delete: `PocketAide/`

Files and directories to create or import from upstream clone `D:\proj\browser-ai-assistant-compare-1c98e78925f14709aacfd5772d2d431d`:

- Create: `index.html`
- Create: `public/manifest.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `postcss.config.js`
- Create: `tailwind.config.ts`
- Create: `package-lock.json`
- Create: `LICENSE`
- Create: `src/vite-env.d.ts`
- Create: `src/side-panel/**`
- Create: `src/content/**`
- Create: `src/background/**/*.ts`
- Create: `src/shared/**/*.ts`
- Create: `tests/**`
- Create: `scripts/package-extension.mjs`
- Create: `scripts/package-extension.test.ts`

Files to modify:

- Modify: `package.json`
- Modify: `README.md`
- Modify: `.gitignore` if missing or incomplete

Important constraints:

- Use PowerShell commands only.
- Do not use bash heredoc.
- Use Chinese git commit messages.
- Do not stage or delete `.claude/`.
- Before deleting `PocketAide/`, verify the resolved absolute path is exactly under `D:\proj\test`.

---

### Task 1: Baseline And Isolation Check

**Files:**

- Read only: repository state

- [ ] **Step 1: Confirm repository state**

Run:

```powershell
git status --short
git branch --show-current
git rev-parse --show-toplevel
```

Expected:

```text
?? .claude/
?? PocketAide/
codex/game-creature-worker-assets
D:/proj/test
```

If tracked files are dirty, stop and report them before continuing. Untracked `.claude/` and `PocketAide/` are expected.

- [ ] **Step 2: Confirm upstream clone exists**

Run:

```powershell
$Upstream = 'D:\proj\browser-ai-assistant-compare-1c98e78925f14709aacfd5772d2d431d'
if (-not (Test-Path -LiteralPath $Upstream)) {
  git clone --filter=blob:none --sparse https://github.com/AhYi8/browser-ai-assistant $Upstream
  git -C $Upstream sparse-checkout set src public scripts tests
}
git -C $Upstream log -1 --oneline
```

Expected:

```text
76fcd13 feat(chat): 支持运行中跟进对话
```

- [ ] **Step 3: Run current baseline tests**

Run:

```powershell
npm test
```

Expected: current test suite passes before migration work. If it fails, capture the failing command and output, then ask whether to continue with a known-bad baseline.

---

### Task 2: Delete PocketAide From Browser Extension Repository

**Files:**

- Delete: `PocketAide/`

- [ ] **Step 1: Verify delete target is safe**

Run:

```powershell
$Repo = (Resolve-Path -LiteralPath 'D:\proj\test').Path
$Target = Resolve-Path -LiteralPath 'D:\proj\test\PocketAide' -ErrorAction Stop
if (-not $Target.Path.StartsWith($Repo + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to delete outside repository: $($Target.Path)"
}
Write-Output $Target.Path
```

Expected:

```text
D:\proj\test\PocketAide
```

- [ ] **Step 2: Delete the directory**

Run:

```powershell
Remove-Item -LiteralPath 'D:\proj\test\PocketAide' -Recurse -Force
Test-Path -LiteralPath 'D:\proj\test\PocketAide'
```

Expected:

```text
False
```

- [ ] **Step 3: Commit the boundary cleanup**

Run:

```powershell
git status --short
git add -A -- PocketAide
git commit -m "chore: 删除独立 PocketAide 项目"
```

Expected: commit succeeds. `.claude/` remains untracked.

---

### Task 3: Import Upstream Engineering Root Files

**Files:**

- Create: `index.html`
- Create: `public/manifest.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `postcss.config.js`
- Create: `tailwind.config.ts`
- Create: `package-lock.json`
- Create: `LICENSE`

- [ ] **Step 1: Copy root engineering files from upstream**

Run:

```powershell
$Upstream = 'D:\proj\browser-ai-assistant-compare-1c98e78925f14709aacfd5772d2d431d'
$Files = @(
  'index.html',
  'vite.config.ts',
  'tsconfig.json',
  'vitest.config.ts',
  'playwright.config.ts',
  'postcss.config.js',
  'tailwind.config.ts',
  'package-lock.json',
  'LICENSE'
)
foreach ($File in $Files) {
  Copy-Item -LiteralPath (Join-Path $Upstream $File) -Destination (Join-Path 'D:\proj\test' $File) -Force
}
New-Item -ItemType Directory -Force -Path 'D:\proj\test\public' | Out-Null
Copy-Item -LiteralPath (Join-Path $Upstream 'public\manifest.json') -Destination 'D:\proj\test\public\manifest.json' -Force
```

Expected: files are present in the current repository.

- [ ] **Step 2: Verify copied files**

Run:

```powershell
Test-Path -LiteralPath index.html
Test-Path -LiteralPath vite.config.ts
Test-Path -LiteralPath public/manifest.json
Test-Path -LiteralPath package-lock.json
Test-Path -LiteralPath LICENSE
```

Expected:

```text
True
True
True
True
True
```

---

### Task 4: Import Upstream TypeScript Source And Tests

**Files:**

- Create: `src/vite-env.d.ts`
- Create: `src/side-panel/**`
- Create: `src/content/**`
- Create: `src/background/**/*.ts`
- Create: `src/shared/**/*.ts`
- Create: `tests/**`
- Create: `scripts/package-extension.mjs`
- Create: `scripts/package-extension.test.ts`

- [ ] **Step 1: Copy source and test directories**

Run:

```powershell
$Upstream = 'D:\proj\browser-ai-assistant-compare-1c98e78925f14709aacfd5772d2d431d'
$CopySpecs = @(
  @{ Source = 'src\side-panel'; Destination = 'src\side-panel' },
  @{ Source = 'src\content'; Destination = 'src\content' },
  @{ Source = 'src\background'; Destination = 'src\background' },
  @{ Source = 'src\shared'; Destination = 'src\shared' },
  @{ Source = 'tests'; Destination = 'tests' }
)
foreach ($Spec in $CopySpecs) {
  $SourcePath = Join-Path $Upstream $Spec.Source
  $DestinationPath = Join-Path 'D:\proj\test' $Spec.Destination
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $DestinationPath) | Out-Null
  Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $Upstream 'src\vite-env.d.ts') -Destination 'D:\proj\test\src\vite-env.d.ts' -Force
Copy-Item -LiteralPath (Join-Path $Upstream 'scripts\package-extension.mjs') -Destination 'D:\proj\test\scripts\package-extension.mjs' -Force
Copy-Item -LiteralPath (Join-Path $Upstream 'scripts\package-extension.test.ts') -Destination 'D:\proj\test\scripts\package-extension.test.ts' -Force
```

Expected: upstream TypeScript source and test trees exist alongside current JS/MJS files.

- [ ] **Step 2: Verify no current Moon Tab directories were deleted**

Run:

```powershell
Test-Path -LiteralPath src/pages/newtab/index.mjs
Test-Path -LiteralPath src/pages/game/index.mjs
Test-Path -LiteralPath src/background/service-worker.js
Test-Path -LiteralPath content/index.js
```

Expected:

```text
True
True
True
True
```

---

### Task 5: Merge package.json Scripts And Dependencies

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Replace package.json with merged engineering configuration**

Use `apply_patch` to replace `package.json` content with:

```json
{
  "name": "moon-tab-extension",
  "version": "0.3.0",
  "type": "module",
  "private": true,
  "license": "GPL-3.0-only",
  "description": "Moon Tab Chrome MV3 extension with new tab search, game page, and Browser AI Assistant side panel.",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "vite build",
    "build:extension": "vite build",
    "preview": "vite preview --host 127.0.0.1 --port 4173",
    "package:extension": "npm run build:extension && node scripts/package-extension.mjs",
    "check:package": "vitest run scripts/package-extension.test.ts && npm run package:extension",
    "test": "vitest run",
    "test:legacy": "node scripts/run_unit_tests.mjs",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "typecheck": "tsc --noEmit",
    "check": "npm run typecheck && npm run build:extension && npm run test && npm run check:package",
    "mcp:grok-search": "node scripts/run_grok_search_mcp_bridge.mjs --model grok-4.20-multi-agent-xhigh",
    "mcp:grok-search:check": "node scripts/run_grok_search_mcp_bridge.mjs --model grok-4.20-multi-agent-xhigh --list-tools-once",
    "mcp:grok-search:start-bg": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start_grok_search_mcp_bridge.ps1",
    "mcp:grok-search:install-service": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install_grok_search_mcp_bridge_task.ps1",
    "mcp:grok-search:uninstall-service": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/uninstall_grok_search_mcp_bridge_task.ps1",
    "model-diagnostics": "node scripts/model_diagnostics_sink.mjs"
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "@jridgewell/trace-mapping": "^0.3.31",
    "@radix-ui/react-dialog": "^1.1.15",
    "@radix-ui/react-select": "^2.2.6",
    "@radix-ui/react-tabs": "^1.1.13",
    "@radix-ui/react-tooltip": "^1.2.8",
    "clsx": "^2.1.1",
    "dexie": "^4.4.2",
    "docx": "^9.7.1",
    "highlight.js": "^11.11.1",
    "react": "^19.2.6",
    "react-dom": "^19.2.6",
    "react-markdown": "^10.1.0",
    "remark-gfm": "^4.0.1",
    "zustand": "^5.0.13"
  },
  "devDependencies": {
    "@playwright/test": "^1.60.0",
    "@tailwindcss/postcss": "^4.3.0",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.1",
    "@types/chrome": "^0.1.42",
    "@types/node": "^25.9.0",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.2",
    "autoprefixer": "^10.5.0",
    "fake-indexeddb": "^6.2.5",
    "jsdom": "^29.1.1",
    "playwright": "^1.60.0",
    "postcss": "^8.5.15",
    "tailwindcss": "^3.4.17",
    "typescript": "^6.0.3",
    "vite": "^8.0.13",
    "vitest": "^4.1.6"
  }
}
```

Expected: current Grok/MCP helper scripts remain available, and remote build/test scripts are now primary.

- [ ] **Step 2: Regenerate package-lock for the merged package name**

Run:

```powershell
npm install
```

Expected: `node_modules/` is created and `package-lock.json` top-level metadata matches `moon-tab-extension`.

---

### Task 6: Add Basic Ignore Rules For Build Artifacts

**Files:**

- Modify or create: `.gitignore`

- [ ] **Step 1: Ensure generated artifacts are ignored**

Use `apply_patch` to create `.gitignore` if it does not exist, or append missing lines if it exists:

```gitignore
node_modules/
dist/
artifacts/
.tmp/
tmp/
.worktrees/
```

Do not add `.claude/` unless the user explicitly asks.

- [ ] **Step 2: Verify ignore rules**

Run:

```powershell
git check-ignore node_modules dist artifacts .worktrees
```

Expected:

```text
node_modules
dist
artifacts
.worktrees
```

---

### Task 7: Update README For Engineering Baseline

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Update run instructions**

Use `apply_patch` to replace the current “运行方式” and “常用命令” opening with the following content:

````markdown
## 运行方式

本项目正在迁移为 Vite / React / TypeScript 工程化扩展。源码不再直接以项目根目录作为最终加载目录；开发和验收时先生成构建产物。

安装依赖：

```powershell
npm install
```

构建扩展：

```powershell
npm run build:extension
```

在 Chrome/Edge 打开扩展管理页，启用开发者模式，选择“加载已解压的扩展”，目录指向 `dist/`。后续本地可分发目录由 `npm run package:extension` 生成。

## 常用命令

```powershell
npm run typecheck
npm run build:extension
npm test
npm run test:legacy
```

`npm test` 运行工程化后的 Vitest 测试；`npm run test:legacy` 暂时保留迁移前的 Node 脚本回归，后续会按阶段并入 Vitest 或 smoke 流程。
````

Expected: README accurately describes the Phase 1 engineering baseline and keeps Grok/MCP sections below intact.

- [ ] **Step 2: Verify README does not mention PocketAide**

Run:

```powershell
rg -n "PocketAide" README.md
```

Expected: no matches.

---

### Task 8: Verify Foundation Commands

**Files:**

- Test only

- [ ] **Step 1: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: TypeScript exits successfully.

- [ ] **Step 2: Run extension build**

Run:

```powershell
npm run build:extension
```

Expected: Vite creates `dist/` with at least:

```text
dist/index.html
dist/background/index.js
dist/content/index.js
dist/manifest.json
```

- [ ] **Step 3: Run Vitest**

Run:

```powershell
npm test
```

Expected: imported upstream unit tests pass.

- [ ] **Step 4: Run package check**

Run:

```powershell
npm run check:package
```

Expected: packaging tests pass and `artifacts/chrome-extension/` is generated.

---

### Task 9: Commit Phase 0-1 Foundation

**Files:**

- Commit all changes from Tasks 2-8 except `.claude/`

- [ ] **Step 1: Review status**

Run:

```powershell
git status --short
```

Expected:

```text
?? .claude/
```

plus tracked and untracked files related to the migration before staging. `PocketAide/` must not appear.

- [ ] **Step 2: Stage only migration files**

Run:

```powershell
git add -- package.json package-lock.json README.md .gitignore LICENSE index.html public vite.config.ts tsconfig.json vitest.config.ts playwright.config.ts postcss.config.js tailwind.config.ts src tests scripts/package-extension.mjs scripts/package-extension.test.ts
git add -A -- PocketAide
git status --short
```

Expected: `.claude/` remains untracked and unstaged.

- [ ] **Step 3: Commit with Chinese message**

Run:

```powershell
git commit -m "feat: 建立远程工程化迁移基础"
```

Expected: commit succeeds.

---

## Follow-Up Plans

After this plan is complete, write separate implementation plans for:

1. Phase 2: migrate Moon Tab newtab and game into Vite multi-entry build.
2. Phase 3: migrate AI side-panel DOM patch behavior into React source.
3. Phase 4: merge tab-scoped side panel, floating iframe, Imagefree, Grok/MCP, and DevTools Network bridge into TypeScript background.
4. Phase 5: consolidate tool registry, MCP audit, Network tools, and browser control safety boundaries.
5. Phase 6-7: remove old AI bundle artifacts and complete E2E/smoke validation.

## Self-Review

Spec coverage:

- PocketAide deletion is covered by Task 2.
- Remote engineering skeleton is covered by Tasks 3-6.
- README and command transition are covered by Task 7.
- Verification is covered by Task 8.
- Commit hygiene and `.claude/` exclusion are covered by Task 9.

No unresolved markers remain. This plan intentionally does not implement newtab/game/side-panel/background behavior migration because those are independent subsystems called out for follow-up plans.
