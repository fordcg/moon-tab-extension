# 全面迁移远程工程化结构 Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Moon Tab 新标签页和小游戏页面迁入 Vite 多入口构建，并让 `dist/` 可以作为包含新标签页覆盖、游戏页面和 AI 侧栏的 MV3 扩展加载目录。

**Architecture:** Phase 2 保留当前 `src/pages/newtab/` 和 `src/pages/game/` 的 MJS/HTML/CSS 页面结构，不重写为 React，也不合并 background 行为。Vite 负责构建侧栏、newtab、game、background 和 content script；newtab/game 的构建输出继续使用 `src/pages/newtab/index.html` 与 `src/pages/game/index.html`，使现有页面间 `chrome.runtime.getURL(...)` 导航保持稳定。

**Tech Stack:** Chrome MV3, Vite, React 19, TypeScript, Vitest, Playwright, Node.js `node:test`, PowerShell, Node.js >= 20.

---

## Scope

This plan implements only Phase 2 from `docs/superpowers/specs/2026-07-05-full-upstream-engineering-migration-design.md`.

In scope:

- Add `src/pages/newtab/index.html` and `src/pages/game/index.html` to Vite multi-entry build.
- Keep built page paths stable as `dist/src/pages/newtab/index.html` and `dist/src/pages/game/index.html`.
- Add `chrome_url_overrides.newtab` to the built manifest.
- Preserve the game page Matter.js global script by copying `src/pages/game/vendor/matter.min.js` into the matching `dist/` path.
- Extend package validation so nested HTML pages and relative asset paths are checked.
- Add Playwright smoke coverage for newtab and game in both Vite preview and real extension contexts.
- Keep legacy game unit tests in `npm run test:legacy` and include that command in the aggregate `npm run check`.

Out of scope:

- Rewriting Moon Tab or game code to TypeScript.
- Moving newtab/game into React.
- Migrating `sidePanel-layout.js` behavior into React source.
- Merging old `src/background/service-worker.js` behavior into `src/background/index.ts`.
- Migrating floating assistant iframe resources.
- Enabling debugger-backed browser control or high-risk tool families.

## File Structure

Files to modify:

- Modify: `vite.config.ts` - add newtab/game HTML inputs and copy the game vendor script after build.
- Modify: `public/manifest.json` - declare Moon Tab branding, `chrome_url_overrides.newtab`, and minimal game web-accessible resources.
- Modify: `scripts/package-extension.mjs` - require newtab/game dist paths and validate nested HTML asset references.
- Modify: `scripts/package-extension.test.ts` - cover nested relative HTML assets and Phase 2 packaging requirements.
- Modify: `tests/unit/background/extensionBuildContract.test.ts` - assert manifest and Vite entry contracts.
- Modify: `tests/e2e/extension-smoke.spec.ts` - add Vite preview smoke for newtab and game.
- Modify: `tests/e2e/extension-runtime.spec.ts` - add real extension smoke for newtab and game.
- Modify: `package.json` - include `npm run test:legacy` in `npm run check`.
- Modify: `README.md` - describe `dist/` Phase 2 newtab/game behavior.
- Modify: `docs/superpowers/MIGRATION_STATUS.md` - record Phase 2 execution status when the implementation is complete.

Files intentionally left unchanged:

- `src/pages/newtab/**` - existing behavior is reused as Vite input source.
- `src/pages/game/**` - existing behavior is reused as Vite input source, except optional source edits are avoided unless verification proves a runtime issue.
- Root `manifest.json` - kept as migration reference for old direct-root loading only.

Important constraints:

- Use PowerShell commands only.
- Do not use bash heredoc.
- Use Chinese git commit messages.
- Do not stage or delete `.claude/`.
- Do not add debugger permission in Phase 2.
- Keep `src/pages/game/vendor/matter.min.js` as a normal script, because it is a UMD bundle that writes `globalThis.Matter`; importing it as an ES module would bind top-level `this` incorrectly.

---

### Task 1: Baseline And Phase Boundary Check

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
codex/game-creature-worker-assets
D:/proj/test
```

If tracked files are dirty, stop and report them before continuing. Untracked `.claude/` is expected and must remain unstaged.

- [ ] **Step 2: Confirm Phase 0-1 commands still pass before changing Phase 2 files**

Run:

```powershell
npm run typecheck
npm run build:extension
npm test
npm run check:package
```

Expected: every command exits successfully. If any command fails, capture the command and failing output, fix only if the failure is caused by local generated artifacts, otherwise stop and report the known-bad baseline.

---

### Task 2: Write Failing Build Contract Tests

**Files:**

- Modify: `tests/unit/background/extensionBuildContract.test.ts`

- [ ] **Step 1: Update the extension build contract test**

Use `apply_patch`:

```diff
*** Begin Patch
*** Update File: tests/unit/background/extensionBuildContract.test.ts
@@
     expect(manifest.background.service_worker).toBe("background/index.js");
     expect(manifest.side_panel.default_path).toBe("index.html");
+    expect(manifest.chrome_url_overrides).toEqual({
+      newtab: "src/pages/newtab/index.html",
+    });
     expect("devtools_page" in manifest).toBe(false);
@@
     expect(viteConfig).toContain('"background/index": resolve(rootDir, "src/background/index.ts")');
     expect(viteConfig).not.toContain("devtools.html");
     expect(viteConfig).toContain('sidePanel: resolve(rootDir, "index.html")');
+    expect(viteConfig).toContain('newtab: resolve(rootDir, "src/pages/newtab/index.html")');
+    expect(viteConfig).toContain('game: resolve(rootDir, "src/pages/game/index.html")');
+    expect(viteConfig).toContain("copy-legacy-page-static-assets");
+    expect(viteConfig).toContain('copyFile(resolve(rootDir, "src/pages/game/vendor/matter.min.js")');
     expect(viteConfig).toContain('outDir: resolve(rootDir, "dist/content")');
@@
   });
+
+  it("Moon Tab 页面间导航应继续指向构建后的稳定扩展路径", async () => {
+    const newtabEntry = await readProjectFile("src/pages/newtab/index.mjs");
+    const gameEntry = await readProjectFile("src/pages/game/index.mjs");
+
+    expect(newtabEntry).toContain('chrome.runtime.getURL("src/pages/game/index.html")');
+    expect(gameEntry).toContain('chrome.runtime.getURL("src/pages/newtab/index.html")');
+  });
 });
*** End Patch
```

Expected: the test now describes the required Phase 2 contract and fails before implementation because the manifest and Vite config do not yet contain these entries.

- [ ] **Step 2: Run the targeted failing test**

Run:

```powershell
npx vitest run tests/unit/background/extensionBuildContract.test.ts
```

Expected: FAIL with assertions about missing `chrome_url_overrides`, missing newtab/game Vite inputs, and missing static asset copy plugin.

---

### Task 3: Write Failing Packaging Tests For Nested Pages

**Files:**

- Modify: `scripts/package-extension.test.ts`

- [ ] **Step 1: Add tests for nested HTML references and required Phase 2 outputs**

Use `apply_patch`:

```diff
*** Begin Patch
*** Update File: scripts/package-extension.test.ts
@@
   it("拒绝跳出打包目录的 HTML 资源引用", async () => {
@@
     await expect(ensureHtmlAssetReferences(packageRoot, ["index.html"])).rejects.toThrow("index.html -> assets/../../outside.js");
   });
+
+  it("支持嵌套 HTML 页面引用 dist 根目录内的相对资源", async () => {
+    const packageRoot = await mkdir(join(tmpdir(), `browser-ai-package-nested-${Date.now()}`), { recursive: true });
+    if (!packageRoot) {
+      throw new Error("无法创建临时打包目录。");
+    }
+
+    await mkdir(join(packageRoot, "src", "pages", "newtab"), { recursive: true });
+    await mkdir(join(packageRoot, "assets"), { recursive: true });
+    await writeFile(join(packageRoot, "src", "pages", "newtab", "index.html"), '<script type="module" src="../../../assets/newtab.js"></script><link href="../../../assets/newtab.css" rel="stylesheet">', "utf8");
+    await writeFile(join(packageRoot, "assets", "newtab.js"), "", "utf8");
+    await writeFile(join(packageRoot, "assets", "newtab.css"), "", "utf8");
+
+    await expect(ensureHtmlAssetReferences(packageRoot, ["src/pages/newtab/index.html"])).resolves.toBeUndefined();
+  });
+
+  it("打包脚本要求 Phase 2 的 newtab 和 game 构建产物", async () => {
+    const scriptSource = await readFile(join(projectRoot, "scripts", "package-extension.mjs"), "utf8");
+
+    expect(scriptSource).toContain('"src/pages/newtab/index.html"');
+    expect(scriptSource).toContain('"src/pages/game/index.html"');
+    expect(scriptSource).toContain('"src/pages/game/vendor/matter.min.js"');
+    expect(scriptSource).toContain('ensureHtmlAssetReferences(packageDir, ["index.html", "src/pages/newtab/index.html", "src/pages/game/index.html"])');
+  });
*** End Patch
```

Expected: tests describe nested Vite HTML output and fail before `scripts/package-extension.mjs` supports nested relative references and required Phase 2 paths.

- [ ] **Step 2: Run the targeted failing tests**

Run:

```powershell
npx vitest run scripts/package-extension.test.ts
```

Expected: FAIL in the newly added tests.

---

### Task 4: Implement Nested HTML Asset Validation

**Files:**

- Modify: `scripts/package-extension.mjs`

- [ ] **Step 1: Require newtab/game build outputs**

Use `apply_patch`:

```diff
*** Begin Patch
*** Update File: scripts/package-extension.mjs
@@
 const requiredDistPaths = [
   "manifest.json",
   "index.html",
+  "src/pages/newtab/index.html",
+  "src/pages/game/index.html",
+  "src/pages/game/vendor/matter.min.js",
   "background/index.js",
   "content/index.js",
 ];
*** End Patch
```

- [ ] **Step 2: Preserve relative HTML references instead of stripping parent segments**

Use `apply_patch`:

```diff
*** Begin Patch
*** Update File: scripts/package-extension.mjs
@@
 export function collectHtmlAssetReferences(html) {
   const references = new Set();
   const attributePattern = /\b(?:href|src)=["']([^"']+)["']/g;
 
   for (const match of html.matchAll(attributePattern)) {
-    const reference = match[1].split(/[?#]/)[0].replace(/^\/+/, "").replace(/^\.\//, "");
-    if (isLocalPackagedReference(match[1], reference)) {
+    const reference = match[1].split(/[?#]/)[0].replace(/^\/+/, "").replace(/^\.\//, "");
+    if (isLocalPackagedReference(match[1], reference)) {
       references.add(reference);
     }
   }
@@
  * @param {string} packageRoot
  * @param {string} assetReference
+ * @param {string} [htmlRelativePath]
  * @returns {string | undefined}
  */
-function resolvePackagedReference(packageRoot, assetReference) {
+function resolvePackagedReference(packageRoot, assetReference, htmlRelativePath = "") {
   const resolvedPackageRoot = path.resolve(packageRoot);
-  const resolvedReference = path.resolve(resolvedPackageRoot, assetReference);
+  const htmlDirectory = path.dirname(path.join(resolvedPackageRoot, htmlRelativePath));
+  const resolvedReference = path.resolve(
+    assetReference.startsWith("/")
+      ? resolvedPackageRoot
+      : htmlDirectory,
+    assetReference,
+  );
   const relativeReference = path.relative(resolvedPackageRoot, resolvedReference);
   if (relativeReference.startsWith("..") || path.isAbsolute(relativeReference)) {
     return undefined;
@@
  * @param {string} rawReference
  * @param {string} normalizedReference
  * @returns {boolean}
  */
 function isLocalPackagedReference(rawReference, normalizedReference) {
@@
   if (rawReference.startsWith("#")) return false;
   if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(rawReference)) return false;
   if (/^(?:data|blob|mailto|tel|chrome|chrome-extension):/i.test(rawReference)) return false;
-  return !normalizedReference.startsWith("../");
+  return true;
 }
@@
-      const resolvedReference = resolvePackagedReference(packageRoot, assetReference);
+      const resolvedReference = resolvePackagedReference(packageRoot, assetReference, htmlRelativePath);
*** End Patch
```

Expected: nested HTML pages can reference shared Vite assets via `../../../assets/...`, while paths escaping the package directory still fail.

- [ ] **Step 3: Validate package-extension tests still fail only on unimplemented Phase 2 paths**

Run:

```powershell
npx vitest run scripts/package-extension.test.ts
```

Expected: the nested relative reference test passes. The Phase 2 required output test still fails until Vite and the packaging command are updated.

---

### Task 5: Add Vite Multi-Entry Build For Newtab And Game

**Files:**

- Modify: `vite.config.ts`

- [ ] **Step 1: Add filesystem helpers for the legacy game vendor script**

Use `apply_patch`:

```diff
*** Begin Patch
*** Update File: vite.config.ts
@@
 import { resolve } from "node:path";
+import { copyFile, mkdir } from "node:fs/promises";
+import { dirname } from "node:path";
 import { fileURLToPath } from "node:url";
*** End Patch
```

- [ ] **Step 2: Add a Vite plugin that copies Matter.js to the matching dist path**

Use `apply_patch`:

```diff
*** Begin Patch
*** Update File: vite.config.ts
@@
 const rootDir = fileURLToPath(new URL(".", import.meta.url));
 
+function copyLegacyPageStaticAssetsPlugin(): PluginOption {
+  return {
+    name: "copy-legacy-page-static-assets",
+    apply: "build",
+    closeBundle: async () => {
+      const matterOutput = resolve(rootDir, "dist/src/pages/game/vendor/matter.min.js");
+      await mkdir(dirname(matterOutput), { recursive: true });
+      await copyFile(resolve(rootDir, "src/pages/game/vendor/matter.min.js"), matterOutput);
+    },
+  };
+}
+
 function buildContentScriptPlugin(): PluginOption {
*** End Patch
```

- [ ] **Step 3: Register the new plugin and HTML inputs**

Use `apply_patch`:

```diff
*** Begin Patch
*** Update File: vite.config.ts
@@
-  plugins: [react(), buildContentScriptPlugin()],
+  plugins: [react(), copyLegacyPageStaticAssetsPlugin(), buildContentScriptPlugin()],
@@
       input: {
         sidePanel: resolve(rootDir, "index.html"),
+        newtab: resolve(rootDir, "src/pages/newtab/index.html"),
+        game: resolve(rootDir, "src/pages/game/index.html"),
         "background/index": resolve(rootDir, "src/background/index.ts"),
       },
*** End Patch
```

Expected: `npm run build:extension` will produce:

```text
dist/index.html
dist/src/pages/newtab/index.html
dist/src/pages/game/index.html
dist/src/pages/game/vendor/matter.min.js
dist/background/index.js
dist/content/index.js
```

- [ ] **Step 4: Run the build contract test again**

Run:

```powershell
npx vitest run tests/unit/background/extensionBuildContract.test.ts
```

Expected: manifest-related assertions still fail until `public/manifest.json` is updated; Vite input and copy plugin assertions pass.

---

### Task 6: Update Built Manifest For Moon Tab Newtab

**Files:**

- Modify: `public/manifest.json`

- [ ] **Step 1: Replace the manifest with the Phase 2 extension manifest**

Use `apply_patch` to replace `public/manifest.json` with:

```json
{
  "manifest_version": 3,
  "name": "月标签",
  "version": "0.3.0",
  "description": "Moon Tab 新标签页、小游戏和 Browser AI Assistant 侧边栏。",
  "permissions": ["sidePanel", "storage", "contextMenus", "activeTab", "scripting", "alarms", "tabs"],
  "host_permissions": ["<all_urls>"],
  "action": {
    "default_title": "打开 AI 助手"
  },
  "background": {
    "service_worker": "background/index.js",
    "type": "module"
  },
  "side_panel": {
    "default_path": "index.html"
  },
  "chrome_url_overrides": {
    "newtab": "src/pages/newtab/index.html"
  },
  "commands": {
    "open-side-panel": {
      "suggested_key": {
        "default": "Ctrl+Shift+Y",
        "mac": "Command+Shift+Y"
      },
      "description": "打开 AI 助手侧边栏"
    }
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content/index.js"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["src/pages/game/index.html", "src/pages/game/vendor/matter.min.js", "assets/*"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

Expected: Phase 2 built manifest points Chrome newtab to the Vite-built Moon Tab page without adding `debugger` or `devtools_page`.

- [ ] **Step 2: Run manifest contract tests**

Run:

```powershell
npx vitest run tests/unit/background/extensionBuildContract.test.ts
```

Expected: PASS.

---

### Task 7: Update Packaging Script For Phase 2 Pages

**Files:**

- Modify: `scripts/package-extension.mjs`

- [ ] **Step 1: Validate all built HTML pages during packaging**

Use `apply_patch`:

```diff
*** Begin Patch
*** Update File: scripts/package-extension.mjs
@@
-  await ensureHtmlAssetReferences(packageDir, ["index.html"]);
+  await ensureHtmlAssetReferences(packageDir, ["index.html", "src/pages/newtab/index.html", "src/pages/game/index.html"]);
*** End Patch
```

Expected: package creation validates side panel, newtab, and game HTML asset references.

- [ ] **Step 2: Run package-extension tests**

Run:

```powershell
npx vitest run scripts/package-extension.test.ts
```

Expected: PASS.

---

### Task 8: Add Web Preview And Real Extension Smoke Coverage

**Files:**

- Modify: `tests/e2e/extension-smoke.spec.ts`
- Modify: `tests/e2e/extension-runtime.spec.ts`

- [ ] **Step 1: Add Vite preview smoke tests**

Use `apply_patch`:

```diff
*** Begin Patch
*** Update File: tests/e2e/extension-smoke.spec.ts
@@
 test("构建后的侧边栏页面应包含 Tailwind 工具类样式", async ({ page }) => {
@@
   expect(headerPadding).toBe("16px");
 });
+
+test("构建后的 Moon Tab 新标签页可以渲染搜索入口", async ({ page }) => {
+  await page.goto("/src/pages/newtab/index.html");
+
+  await expect(page.getByRole("searchbox", { name: "输入内容并搜索或打开" })).toBeVisible();
+  await expect(page.getByRole("button", { name: "切换AI增强搜索" })).toBeVisible();
+  await expect(page.getByRole("button", { name: "打开页面管理菜单" })).toBeVisible();
+});
+
+test("构建后的游戏页面可以渲染游戏入口", async ({ page }) => {
+  await page.goto("/src/pages/game/index.html");
+
+  await expect(page.getByRole("heading", { name: "GAME DECK" })).toBeVisible();
+  await expect(page.getByRole("button", { name: "START" })).toBeVisible();
+  await expect(page.getByRole("searchbox", { name: "搜索" })).toBeVisible();
+});
*** End Patch
```

- [ ] **Step 2: Add real extension smoke tests**

Use `apply_patch`:

```diff
*** Begin Patch
*** Update File: tests/e2e/extension-runtime.spec.ts
@@
 test("构建产物可以作为 Chrome 扩展加载并渲染侧边栏页面", async ({ extensionContext, extensionId }) => {
@@
   await expect(page.getByRole("button", { name: "设置", exact: true })).toBeVisible();
 });
+
+test("构建产物可以作为 Chrome 扩展加载并渲染 Moon Tab 新标签页", async ({ extensionContext, extensionId }) => {
+  const page = await extensionContext.newPage();
+
+  await page.goto(`chrome-extension://${extensionId}/src/pages/newtab/index.html`);
+
+  await expect(page.getByRole("searchbox", { name: "输入内容并搜索或打开" })).toBeVisible();
+  await expect(page.getByRole("button", { name: "切换AI增强搜索" })).toBeVisible();
+  await expect(page.getByRole("button", { name: "打开页面管理菜单" })).toBeVisible();
+});
+
+test("构建产物可以作为 Chrome 扩展加载并渲染游戏页面", async ({ extensionContext, extensionId }) => {
+  const page = await extensionContext.newPage();
+
+  await page.goto(`chrome-extension://${extensionId}/src/pages/game/index.html`);
+
+  await expect(page.getByRole("heading", { name: "GAME DECK" })).toBeVisible();
+  await expect(page.getByRole("button", { name: "START" })).toBeVisible();
+  await expect(page.getByRole("searchbox", { name: "搜索" })).toBeVisible();
+});
*** End Patch
```

- [ ] **Step 3: Run preview smoke tests**

Run:

```powershell
npm run build:extension
npx playwright test --project=web-preview
```

Expected: PASS. The Vite preview serves side panel, newtab, and game pages.

- [ ] **Step 4: Run real extension smoke tests**

Run:

```powershell
npx playwright test --project=chrome-extension
```

Expected: PASS. The already built `dist/` directory loads as a Chrome MV3 extension and renders side panel, newtab, and game pages.

---

### Task 9: Include Legacy Game Tests In Aggregate Check

**Files:**

- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Add legacy tests to the aggregate check command**

Use `apply_patch`:

```diff
*** Begin Patch
*** Update File: package.json
@@
-    "check": "npm run typecheck && npm run build:extension && npm run test && npm run check:package",
+    "check": "npm run typecheck && npm run build:extension && npm run test && npm run test:legacy && npm run check:package",
*** End Patch
```

Expected: Phase 2 aggregate verification includes the current game worker and sprite runtime tests until they are ported into Vitest.

- [ ] **Step 2: Update README run notes**

Use `apply_patch`:

```diff
*** Begin Patch
*** Update File: README.md
@@
 在 Chrome/Edge 打开扩展管理页，启用开发者模式，选择“加载已解压的扩展”，目录指向 `dist/`。后续本地可分发目录由 `npm run package:extension` 生成。
 
+Phase 2 起，`dist/` 同时包含 Moon Tab 新标签页和小游戏页面。新标签页由构建后的 `src/pages/newtab/index.html` 提供，游戏页面由 `src/pages/game/index.html` 提供；页面间导航继续使用这两个扩展内路径。
+
 Phase 0-1 的 `dist/` 是降权工程化基线：默认不声明 `debugger` 权限。上游 debugger-backed browser control、`js.*`、`sourcemap.*`、`runtime.*`、`replay.*` 和 `full_access.*` 源码已导入，可能出现在工具偏好设置中，但当前构建不会在运行时暴露为可用能力；后续按独立 Phase 启用。
@@
 npm run build:extension
 npm test
 npm run test:legacy
+npm run test:e2e
 ```
 
-`npm test` 运行工程化后的 Vitest 测试；`npm run test:legacy` 暂时保留迁移前的 Node 脚本回归，后续会按阶段并入 Vitest 或 smoke 流程。
+`npm test` 运行工程化后的 Vitest 测试；`npm run test:legacy` 暂时保留迁移前的 Node 脚本回归，并在 Phase 2 的 `npm run check` 中覆盖小游戏 worker/sprite 逻辑；`npm run test:e2e` 验证构建后的侧栏、新标签页和游戏页面。
*** End Patch
```

Expected: README accurately describes Phase 2 built entry behavior and verification commands.

---

### Task 10: Run Full Phase 2 Verification

**Files:**

- Test only

- [ ] **Step 1: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run extension build**

Run:

```powershell
npm run build:extension
```

Expected: PASS and these files exist:

```text
dist/index.html
dist/src/pages/newtab/index.html
dist/src/pages/game/index.html
dist/src/pages/game/vendor/matter.min.js
dist/background/index.js
dist/content/index.js
dist/manifest.json
```

- [ ] **Step 3: Run Vitest**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 4: Run legacy Node tests**

Run:

```powershell
npm run test:legacy
```

Expected: PASS, including:

```text
node --test src/pages/game/workers.test.mjs src/pages/game/sprite-runtime.test.mjs
unit tests passed
```

- [ ] **Step 5: Run package check**

Run:

```powershell
npm run check:package
```

Expected: PASS and `artifacts/chrome-extension/` contains:

```text
artifacts/chrome-extension/index.html
artifacts/chrome-extension/src/pages/newtab/index.html
artifacts/chrome-extension/src/pages/game/index.html
artifacts/chrome-extension/src/pages/game/vendor/matter.min.js
artifacts/chrome-extension/manifest.json
```

- [ ] **Step 6: Run Playwright E2E**

Run:

```powershell
npm run test:e2e
```

Expected: PASS for both Playwright projects:

```text
web-preview
chrome-extension
```

- [ ] **Step 7: Run aggregate check**

Run:

```powershell
npm run check
```

Expected: PASS. This command must include `npm run test:legacy` between `npm test` and `npm run check:package`.

---

### Task 11: Update Migration Status

**Files:**

- Modify: `docs/superpowers/MIGRATION_STATUS.md`

- [ ] **Step 1: Update current stage and current plan**

Use `apply_patch`:

```diff
*** Begin Patch
*** Update File: docs/superpowers/MIGRATION_STATUS.md
@@
-Phase 0-1：删除 PocketAide，并建立远程 Vite / React / TypeScript 工程化基础骨架。
+Phase 2：迁移 Moon Tab 新标签页和小游戏到 Vite 多入口构建。
@@
-- 当前计划：`docs/superpowers/plans/2026-07-05-full-upstream-engineering-migration-phase-0-1.md`
+- 当前计划：`docs/superpowers/plans/2026-07-05-full-upstream-engineering-migration-phase-2.md`
*** End Patch
```

- [ ] **Step 2: Add Phase 2 verification rows**

Use `apply_patch` to replace the “当前验证状态” table with:

```markdown
| 命令 | 状态 | 备注 |
|---|---|---|
| `npm run typecheck` | 通过 | Phase 2 多入口构建迁移后执行 |
| `npm run build:extension` | 通过 | 生成侧栏、新标签页、游戏页、background 和 content script |
| `npm test` | 通过 | Vitest 构建合约、打包脚本和现有单元测试 |
| `npm run test:legacy` | 通过 | 保留小游戏 worker/sprite 的 Node 测试 |
| `npm run check:package` | 通过 | 校验并复制 Phase 2 打包产物 |
| `npm run test:e2e` | 通过 | Vite preview 和真实 Chrome 扩展 smoke |
| `npm run check` | 通过 | Phase 2 全量聚合验证 |
```

If a command fails and the user approves continuing, record `未通过` and the concise failure reason in the 备注 column instead of `通过`.

- [ ] **Step 3: Update unresolved issues and next phase**

Use `apply_patch`:

```diff
*** Begin Patch
*** Update File: docs/superpowers/MIGRATION_STATUS.md
@@
-- 尚未迁移 Moon Tab 新标签页和小游戏到 Vite 多入口构建。
+- Moon Tab 新标签页和小游戏已进入 Vite 多入口构建；页面源码仍为 MJS/HTML/CSS，后续如需 TypeScript 化应单独规划。
@@
-Phase 0-1 完成后，编写 Phase 2 计划：迁移 Moon Tab newtab 和 game 到 Vite 多入口构建。
+Phase 2 完成后，编写 Phase 3 计划：迁入远程 `src/side-panel/` React 源码，并把当前 `sidePanel-layout.js` 的必要行为转为组件和 store 逻辑。
*** End Patch
```

Expected: migration status becomes a usable recovery point for the next worker.

---

### Task 12: Commit Phase 2

**Files:**

- Commit all Phase 2 changes except `.claude/`

- [ ] **Step 1: Review status**

Run:

```powershell
git status --short
```

Expected: only Phase 2 files are modified, and `.claude/` remains untracked.

- [ ] **Step 2: Stage Phase 2 files**

Run:

```powershell
git add -- vite.config.ts public/manifest.json scripts/package-extension.mjs scripts/package-extension.test.ts tests/unit/background/extensionBuildContract.test.ts tests/e2e/extension-smoke.spec.ts tests/e2e/extension-runtime.spec.ts package.json README.md docs/superpowers/MIGRATION_STATUS.md
git status --short
```

Expected: `.claude/` remains unstaged.

- [ ] **Step 3: Commit with Chinese message**

Run:

```powershell
git commit -m "feat: 迁移新标签页和游戏到 Vite 多入口构建"
```

Expected: commit succeeds.

- [ ] **Step 4: Record the final commit SHA in the migration ledger**

Run:

```powershell
$Sha = git rev-parse --short HEAD
$Sha
```

Use `apply_patch` to add a `Phase 2` row under “已完成提交”. The `Commit` cell must be the exact backticked short SHA printed by `$Sha`, and the `内容` cell must be `迁移 Moon Tab 新标签页和小游戏到 Vite 多入口构建`.

Then run:

```powershell
git add -- docs/superpowers/MIGRATION_STATUS.md
git commit -m "docs: 更新 Phase 2 迁移状态"
```

Expected: migration status records the actual Phase 2 implementation commit.

---

## Self-Review

Spec coverage:

- Vite 多入口构建 is covered by Tasks 2 and 5.
- `chrome_url_overrides.newtab` is covered by Tasks 2 and 6.
- Game page build path and Matter.js runtime are covered by Tasks 3, 5, 7, 8, and 10.
- Package validation for nested pages is covered by Tasks 3, 4, 7, and 10.
- Newtab and game smoke coverage is covered by Tasks 8 and 10.
- Game worker/sprite tests remain covered through `npm run test:legacy`, added to `npm run check` in Task 9.
- Migration ledger recovery is covered by Task 11.

No unresolved markers remain. This plan intentionally does not migrate side-panel DOM patch behavior, background feature parity, floating assistant resources, Grok/MCP, Imagefree, or DevTools Network bridge because those are separate phases in the total design.
