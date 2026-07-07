# Phase 7 Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the completed upstream engineering migration into a repeatable release candidate by adding one release verification command, strengthening package/load contracts, expanding real-extension smoke coverage, documenting the acceptance matrix, and closing the migration ledger.

**Architecture:** Keep release readiness as a thin orchestration layer around the current Vite extension architecture. `npm run verify:release` runs the existing gates, then a Node verifier inspects `dist/` and `artifacts/chrome-extension/` for the manifest, declared pages, service worker, content script, package metadata, legacy-artifact absence, and permission boundary. The acceptance matrix is source-controlled documentation backed by focused tests so future migration work cannot silently drop required Phase 7 coverage.

**Tech Stack:** Chrome Manifest V3, Vite multi-entry build, TypeScript, React, Vitest, Playwright, Node.js ESM scripts, PowerShell.

---

## Context

- 总设计：`docs/superpowers/specs/2026-07-05-full-upstream-engineering-migration-design.md`
- 当前迁移台账：`docs/superpowers/MIGRATION_STATUS.md`
- Phase 6 计划：`docs/superpowers/plans/2026-07-07-full-upstream-engineering-migration-phase-6.md`
- 当前工程已完成 Phase 6：旧 `src/ai-assistant` bundle、DOM patch、root no-build manifest/content/service-worker 已删除；DevTools Network 和 Imagefree runtime 已迁入 source-owned TypeScript 入口。

Phase 7 不再迁移新功能。它只做发布前验收和发布准备：把类型检查、构建、单元测试、legacy 回归、打包检查、E2E、真实扩展加载 smoke、权限边界和验收矩阵收敛成可重复执行的命令和文档。

## Execution Preconditions

- 使用 PowerShell 执行命令。
- 多行输入使用 `apply_patch` 或 PowerShell here-string，禁止 bash heredoc。
- 手写文件修改使用 `apply_patch`。
- 不要 stage、修改或删除未跟踪的 `.claude/`。
- 每个任务完成后提交一次；提交信息使用中文。
- 不要并行派发多个实现子代理；每个任务都先实现，再 spec review，再 code quality review。
- 测试新增或行为变更遵循 TDD：先写失败测试并确认失败，再实现最小代码让测试通过。

## File Map

- Create: `scripts/verify-release-readiness.mjs` as the post-build release artifact verifier.
- Create: `scripts/verify-release-readiness.test.ts` for verifier unit coverage.
- Create: `docs/superpowers/release-readiness.md` as the Phase 7 acceptance matrix.
- Create: `tests/unit/background/releaseReadinessContract.test.ts` to lock the acceptance matrix and release command wiring.
- Modify: `package.json` to add `verify:release`.
- Modify: `scripts/package-extension.mjs` to require manifest-declared HTML entries, including DevTools.
- Modify: `scripts/package-extension.test.ts` to cover manifest-derived package entries and HTML asset checks.
- Modify: `tests/e2e/extension-runtime.spec.ts` to expand real Chrome extension smoke for AI sidebar release controls.
- Modify: `README.md` to document the release verification command and load target.
- Modify: `CLAUDE.md` to include the release verification command in maintainer guidance.
- Modify: `docs/superpowers/MIGRATION_STATUS.md` after final verification to mark Phase 7 complete and record fresh command evidence.

---

### Task 1: Release Verification Command

**Files:**
- Create: `scripts/verify-release-readiness.mjs`
- Create: `scripts/verify-release-readiness.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the verifier tests first**

Create `scripts/verify-release-readiness.test.ts` with these tests:

```ts
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RELEASE_REQUIRED_ARTIFACT_PATHS,
  collectReleaseReadinessIssues,
  verifyReleaseReadiness,
} from "./verify-release-readiness.mjs";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = join(tmpdir(), `moon-tab-release-readiness-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(root, { recursive: true });
  tempRoots.push(root);
  return root;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeFileWithParents(root: string, relativePath: string, content = ""): Promise<void> {
  const absolutePath = join(root, relativePath);
  await mkdir(join(absolutePath, ".."), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

async function createReadyRoot(): Promise<string> {
  const root = await makeTempRoot();
  const manifest = {
    manifest_version: 3,
    name: "月标签",
    version: "0.3.0",
    permissions: ["sidePanel", "storage", "contextMenus", "activeTab", "scripting", "alarms", "tabs"],
    background: { service_worker: "background/index.js", type: "module" },
    side_panel: { default_path: "index.html" },
    devtools_page: "src/devtools/network.html",
    chrome_url_overrides: { newtab: "src/pages/newtab/index.html" },
    content_scripts: [{ matches: ["<all_urls>"], js: ["content/index.js"], run_at: "document_idle" }],
  };

  await writeJson(join(root, "package.json"), {
    name: "moon-tab-extension",
    version: "0.3.0",
    scripts: {
      check: "npm run typecheck && npm run build:extension && npm run test && npm run test:legacy && npm run check:package",
      "test:e2e": "playwright test",
      "verify:release": "npm run check && npm run test:e2e && node scripts/verify-release-readiness.mjs",
    },
  });
  await writeJson(join(root, "dist", "manifest.json"), manifest);
  await writeJson(join(root, "artifacts", "chrome-extension", "manifest.json"), manifest);
  await writeJson(join(root, "artifacts", "chrome-extension", "build-info.json"), {
    name: "moon-tab-extension",
    version: "0.3.0",
    builtAt: "2026-07-07T00:00:00.000Z",
  });

  for (const relativePath of RELEASE_REQUIRED_ARTIFACT_PATHS) {
    if (relativePath.endsWith(".json")) continue;
    await writeFileWithParents(join(root, "artifacts", "chrome-extension"), relativePath, "release artifact");
  }

  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("release readiness verifier", () => {
  it("accepts a built and packaged release candidate with the current MV3 permission boundary", async () => {
    const root = await createReadyRoot();

    await expect(collectReleaseReadinessIssues(root)).resolves.toEqual([]);
    await expect(verifyReleaseReadiness(root)).resolves.toBeUndefined();
  });

  it("reports missing packaged artifacts and forbidden debugger permission", async () => {
    const root = await createReadyRoot();
    const manifestPath = join(root, "artifacts", "chrome-extension", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.permissions.push("debugger");
    await writeJson(manifestPath, manifest);
    await rm(join(root, "artifacts", "chrome-extension", "src", "devtools", "network.html"), { force: true });

    const issues = await collectReleaseReadinessIssues(root);

    expect(issues).toContain("artifacts/chrome-extension/manifest.json must not request debugger permission in the current release boundary.");
    expect(issues).toContain("Missing packaged artifact: artifacts/chrome-extension/src/devtools/network.html");
    await expect(verifyReleaseReadiness(root)).rejects.toThrow("Release readiness verification failed");
  });

  it("requires the release verification command to run check, E2E, and artifact verification", async () => {
    const root = await createReadyRoot();
    await writeJson(join(root, "package.json"), {
      name: "moon-tab-extension",
      version: "0.3.0",
      scripts: {
        check: "npm run typecheck && npm run build:extension",
        "test:e2e": "playwright test",
        "verify:release": "npm run check && node scripts/verify-release-readiness.mjs",
      },
    });

    await expect(collectReleaseReadinessIssues(root)).resolves.toContain("package.json scripts.verify:release must run npm run test:e2e.");
  });
});
```

- [ ] **Step 2: Run RED check**

Run: `npx vitest run scripts/verify-release-readiness.test.ts`

Expected before implementation: FAIL because `scripts/verify-release-readiness.mjs` does not exist.

- [ ] **Step 3: Implement the release verifier**

Create `scripts/verify-release-readiness.mjs`:

```js
// @ts-check
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRootDir = path.resolve(__dirname, "..");

export const RELEASE_REQUIRED_ARTIFACT_PATHS = [
  "manifest.json",
  "build-info.json",
  "index.html",
  "src/devtools/network.html",
  "src/pages/newtab/index.html",
  "src/pages/game/index.html",
  "src/pages/game/vendor/matter.min.js",
  "background/index.js",
  "content/index.js",
];

const forbiddenArtifactPatterns = [
  /(?:^|\/)tests?(?:\/|$)/,
  /(?:^|\/)__tests__(?:\/|$)/,
  /\.(?:test|spec)\.[cm]?[jt]sx?$/,
  /(?:^|\/)src\/ai-assistant(?:\/|$)/,
  /(?:^|\/)src\/background\/service-worker\.js$/,
  /(?:^|\/)content\/index\.ts$/,
];

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(directory, baseDirectory = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(entryPath, baseDirectory));
      continue;
    }
    files.push(path.relative(baseDirectory, entryPath).split(path.sep).join("/"));
  }
  return files;
}

function collectScriptIssues(packageJson) {
  const issues = [];
  const scripts = packageJson.scripts ?? {};
  const verifyRelease = scripts["verify:release"];
  if (!verifyRelease) {
    return ["package.json must define scripts.verify:release."];
  }
  if (!verifyRelease.includes("npm run check")) {
    issues.push("package.json scripts.verify:release must run npm run check.");
  }
  if (!verifyRelease.includes("npm run test:e2e")) {
    issues.push("package.json scripts.verify:release must run npm run test:e2e.");
  }
  if (!verifyRelease.includes("node scripts/verify-release-readiness.mjs")) {
    issues.push("package.json scripts.verify:release must run node scripts/verify-release-readiness.mjs.");
  }
  return issues;
}

function collectManifestIssues(manifest, label) {
  const issues = [];
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  if (permissions.includes("debugger")) {
    issues.push(`${label} must not request debugger permission in the current release boundary.`);
  }
  if (manifest.background?.service_worker !== "background/index.js") {
    issues.push(`${label} must use background/index.js as the MV3 service worker.`);
  }
  if (manifest.side_panel?.default_path !== "index.html") {
    issues.push(`${label} must use index.html as the side panel entry.`);
  }
  if (manifest.devtools_page !== "src/devtools/network.html") {
    issues.push(`${label} must declare src/devtools/network.html as the DevTools page.`);
  }
  if (manifest.chrome_url_overrides?.newtab !== "src/pages/newtab/index.html") {
    issues.push(`${label} must declare src/pages/newtab/index.html as the newtab override.`);
  }
  const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  if (!contentScripts.some((entry) => Array.isArray(entry.js) && entry.js.includes("content/index.js"))) {
    issues.push(`${label} must include content/index.js as a content script.`);
  }
  return issues;
}

export async function collectReleaseReadinessIssues(rootDir = defaultRootDir) {
  const issues = [];
  const packageRoot = path.join(rootDir, "artifacts", "chrome-extension");
  const packageJsonPath = path.join(rootDir, "package.json");
  const distManifestPath = path.join(rootDir, "dist", "manifest.json");
  const artifactManifestPath = path.join(packageRoot, "manifest.json");

  if (!await fileExists(packageJsonPath)) {
    issues.push("Missing package.json.");
  } else {
    issues.push(...collectScriptIssues(await readJsonFile(packageJsonPath)));
  }

  if (!await fileExists(distManifestPath)) {
    issues.push("Missing dist/manifest.json. Run npm run build:extension before release verification.");
  } else {
    issues.push(...collectManifestIssues(await readJsonFile(distManifestPath), "dist/manifest.json"));
  }

  if (!await fileExists(artifactManifestPath)) {
    issues.push("Missing artifacts/chrome-extension/manifest.json. Run npm run package:extension before release verification.");
  } else {
    issues.push(...collectManifestIssues(await readJsonFile(artifactManifestPath), "artifacts/chrome-extension/manifest.json"));
  }

  for (const relativePath of RELEASE_REQUIRED_ARTIFACT_PATHS) {
    if (!await fileExists(path.join(packageRoot, relativePath))) {
      issues.push(`Missing packaged artifact: artifacts/chrome-extension/${relativePath}`);
    }
  }

  if (await fileExists(packageRoot)) {
    const packagedFiles = await listFiles(packageRoot);
    for (const file of packagedFiles) {
      if (forbiddenArtifactPatterns.some((pattern) => pattern.test(file))) {
        issues.push(`Forbidden packaged artifact: artifacts/chrome-extension/${file}`);
      }
    }
  }

  return issues;
}

export async function verifyReleaseReadiness(rootDir = defaultRootDir) {
  const issues = await collectReleaseReadinessIssues(rootDir);
  if (issues.length > 0) {
    throw new Error(["Release readiness verification failed:", ...issues.map((issue) => `- ${issue}`)].join("\n"));
  }
}

if (process.argv[1] === __filename) {
  verifyReleaseReadiness().then(() => {
    console.log("Release readiness verification passed.");
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Add the npm release command**

In `package.json`, add this script after `check`:

```json
"verify:release": "npm run check && npm run test:e2e && node scripts/verify-release-readiness.mjs"
```

- [ ] **Step 5: Run GREEN check**

Run: `npx vitest run scripts/verify-release-readiness.test.ts`

Expected after implementation: PASS.

- [ ] **Step 6: Run command wiring check**

Run: `node scripts/verify-release-readiness.mjs`

Expected after implementation if `npm run check:package` has not been run in this workspace yet: FAIL with missing `dist/` or `artifacts/chrome-extension` evidence. If artifacts already exist from Phase 6, PASS is acceptable. This command must not be used as final release evidence until after `npm run verify:release` runs in Task 6.

- [ ] **Step 7: Commit this task**

```powershell
git add package.json scripts/verify-release-readiness.mjs scripts/verify-release-readiness.test.ts
git commit -m "工具：新增发布验收命令"
```

---

### Task 2: Package Artifact Contract For Manifest Entries

**Files:**
- Modify: `scripts/package-extension.mjs`
- Modify: `scripts/package-extension.test.ts`

- [ ] **Step 1: Write package contract tests first**

In `scripts/package-extension.test.ts`, update the import to include `collectManifestHtmlEntries`:

```ts
import {
  collectHtmlAssetReferences,
  collectManifestHtmlEntries,
  createBuildInfo,
  createPackagedManifest,
  ensureHtmlAssetReferences,
  removeJunkFiles,
  shouldExcludeFromPackage,
} from "./package-extension.mjs";
```

Add this test after the nested HTML reference tests:

```ts
  it("从 manifest 收集发布包必须包含并检查资源引用的 HTML 入口", () => {
    expect(collectManifestHtmlEntries({
      side_panel: { default_path: "index.html" },
      devtools_page: "src/devtools/network.html",
      chrome_url_overrides: { newtab: "src/pages/newtab/index.html" },
      web_accessible_resources: [
        { resources: ["src/pages/game/index.html", "assets/*", "src/pages/game/vendor/matter.min.js"] },
      ],
    })).toEqual([
      "index.html",
      "src/devtools/network.html",
      "src/pages/game/index.html",
      "src/pages/newtab/index.html",
    ]);
  });
```

Replace the stale DevTools test with this test:

```ts
  it("打包脚本要求 manifest 声明的 DevTools 页面产物", async () => {
    const scriptSource = await readFile(join(projectRoot, "scripts", "package-extension.mjs"), "utf8");

    expect(scriptSource).toContain('"src/devtools/network.html"');
    expect(scriptSource).toContain("collectManifestHtmlEntries");
    expect(scriptSource).toContain("ensureHtmlAssetReferences(packageDir, collectManifestHtmlEntries(manifest))");
  });
```

- [ ] **Step 2: Run RED check**

Run: `npx vitest run scripts/package-extension.test.ts --testNamePattern "manifest|DevTools"`

Expected before implementation: FAIL because `collectManifestHtmlEntries` is not exported and the package script does not require the DevTools page.

- [ ] **Step 3: Export manifest-derived HTML entry collection**

In `scripts/package-extension.mjs`, change the required paths declaration to export it and include DevTools:

```js
export const requiredDistPaths = [
  "manifest.json",
  "index.html",
  "src/devtools/network.html",
  "src/pages/newtab/index.html",
  "src/pages/game/index.html",
  "src/pages/game/vendor/matter.min.js",
  "background/index.js",
  "content/index.js",
];
```

Add this function after `createPackagedManifest()`:

```js
/**
 * @param {Record<string, unknown>} manifest
 * @returns {string[]}
 */
export function collectManifestHtmlEntries(manifest) {
  const entries = new Set();
  const sidePanel = manifest.side_panel;
  if (sidePanel && typeof sidePanel === "object" && typeof sidePanel.default_path === "string") {
    entries.add(sidePanel.default_path);
  }
  if (typeof manifest.devtools_page === "string" && manifest.devtools_page.endsWith(".html")) {
    entries.add(manifest.devtools_page);
  }
  const chromeUrlOverrides = manifest.chrome_url_overrides;
  if (chromeUrlOverrides && typeof chromeUrlOverrides === "object") {
    for (const value of Object.values(chromeUrlOverrides)) {
      if (typeof value === "string" && value.endsWith(".html")) {
        entries.add(value);
      }
    }
  }
  const webAccessibleResources = Array.isArray(manifest.web_accessible_resources) ? manifest.web_accessible_resources : [];
  for (const entry of webAccessibleResources) {
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.resources)) continue;
    for (const resource of entry.resources) {
      if (typeof resource === "string" && resource.endsWith(".html") && !resource.includes("*")) {
        entries.add(resource);
      }
    }
  }
  return [...entries].sort();
}
```

- [ ] **Step 4: Use the manifest-derived entries in packaging**

Change `writePackagedManifest()` to accept the parsed manifest:

```js
async function writePackagedManifest(manifest) {
  await writeFile(path.join(packageDir, "manifest.json"), `${JSON.stringify(createPackagedManifest(manifest), null, 2)}\n`, "utf8");
}
```

Change `main()` so it reads the dist manifest once and verifies all required paths:

```js
async function main() {
  const manifest = JSON.parse(await readFile(path.join(rootDir, "dist", "manifest.json"), "utf8"));
  const requiredPaths = [...new Set([...requiredDistPaths, ...collectManifestHtmlEntries(manifest)])];
  for (const relativePath of requiredPaths) {
    await ensureDistPathExists(relativePath);
  }

  await rm(packageDir, { recursive: true, force: true });
  await mkdir(packageDir, { recursive: true });
  await cp(path.join(rootDir, "dist"), packageDir, {
    recursive: true,
    filter: (sourcePath) => !shouldExcludeFromPackage(path.relative(path.join(rootDir, "dist"), sourcePath)),
  });

  await writePackagedManifest(manifest);
  await removeJunkFiles(packageDir);
  await ensureHtmlAssetReferences(packageDir, collectManifestHtmlEntries(manifest));

  const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
  await writeFile(path.join(packageDir, "build-info.json"), `${JSON.stringify(createBuildInfo(packageJson), null, 2)}\n`, "utf8");
  console.log(`本地扩展打包产物已生成：${path.relative(rootDir, packageDir)}`);
}
```

- [ ] **Step 5: Run GREEN checks**

Run: `npx vitest run scripts/package-extension.test.ts --testNamePattern "manifest|DevTools|Phase 2"`

Expected after implementation: PASS.

Run: `npm run check:package`

Expected after implementation: PASS and generate `artifacts/chrome-extension` with `src/devtools/network.html`.

- [ ] **Step 6: Commit this task**

```powershell
git add scripts/package-extension.mjs scripts/package-extension.test.ts
git commit -m "打包：校验发布包声明入口"
```

---

### Task 3: Real Extension Release Smoke Expansion

**Files:**
- Modify: `tests/e2e/extension-runtime.spec.ts`

- [ ] **Step 1: Add the real-extension smoke test first**

In `tests/e2e/extension-runtime.spec.ts`, add this test after the existing side panel test:

```ts
test("真实扩展侧边栏暴露发布验收所需的工具、MCP、同步和悬浮入口", async ({ extensionContext, extensionId }) => {
  const page = await extensionContext.newPage();

  await page.goto(`chrome-extension://${extensionId}/index.html`);

  await expect(page.getByRole("button", { name: "打开悬浮助手" })).toBeVisible();
  await expect(page.getByRole("button", { name: "浏览器控制" })).toBeVisible();
  await expect(page.getByRole("button", { name: "设置", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "渠道管理" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "MCP 工具" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "聊天偏好" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "同步设置" })).toBeVisible();

  await page.getByRole("tab", { name: "MCP 工具" }).click();
  await expect(page.getByRole("heading", { name: "MCP 工具" })).toBeVisible();
  await expect(page.getByRole("button", { name: "新增 MCP Server" })).toBeVisible();

  await page.getByRole("tab", { name: "聊天偏好" }).click();
  await expect(page.getByRole("checkbox", { name: "启用工具调用" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "工具运行要求筛选" })).toBeVisible();

  await page.getByRole("tab", { name: "同步设置" }).click();
  await expect(page.getByRole("heading", { name: "同步设置" })).toBeVisible();
  await expect(page.getByText("备份当前插件域本地存储的全部内容，密钥和远程凭据除外")).toBeVisible();
});
```

- [ ] **Step 2: Run RED or existing-behavior check**

Run: `npm run build:extension; npx playwright test tests/e2e/extension-runtime.spec.ts --project=chrome-extension --grep "真实扩展侧边栏"`

Expected before implementation if a locator has drifted: FAIL with the missing release control. If it passes immediately because the UI already exposes all required controls, keep the test as a regression contract and continue.

- [ ] **Step 3: Adjust only the test if accessible names differ from current UI**

If Step 2 fails because the current UI uses a different accessible name, inspect `src/side-panel/App.tsx` and `src/side-panel/components/SettingsPanel.tsx`, then update only the locator in the test to the actual accessible name. Do not change product UI for this task unless the control is actually missing.

- [ ] **Step 4: Run the extension smoke project**

Run: `npx playwright test tests/e2e/extension-runtime.spec.ts --project=chrome-extension`

Expected after implementation: PASS for side panel, real-extension release controls, Moon Tab, and game page tests.

- [ ] **Step 5: Commit this task**

```powershell
git add tests/e2e/extension-runtime.spec.ts
git commit -m "测试：扩展真实加载发布 smoke"
```

---

### Task 4: Acceptance Matrix Documentation Contract

**Files:**
- Create: `docs/superpowers/release-readiness.md`
- Create: `tests/unit/background/releaseReadinessContract.test.ts`

- [ ] **Step 1: Write the documentation contract test first**

Create `tests/unit/background/releaseReadinessContract.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../../../public/manifest.json";

const projectRoot = process.cwd();

async function readProjectFile(path: string): Promise<string> {
  return readFile(resolve(projectRoot, path), "utf8");
}

describe("Phase 7 发布验收合约", () => {
  it("发布验收矩阵覆盖总设计要求的运行面", async () => {
    const doc = await readProjectFile("docs/superpowers/release-readiness.md");
    const requiredAreas = [
      "AI 侧栏",
      "Moon Tab 新标签页",
      "小游戏",
      "悬浮助手",
      "Grok/MCP Bridge",
      "DevTools Network 兼容工具",
      "浏览器控制基础工具",
      "Imagefree 与 Tavily",
      "打包产物",
      "权限边界",
    ];

    for (const area of requiredAreas) {
      expect(doc).toContain(`| ${area} |`);
    }

    for (const command of [
      "npm run typecheck",
      "npm run build:extension",
      "npm test",
      "npm run test:legacy",
      "npm run check:package",
      "npm run check",
      "npm run test:e2e",
      "npm run verify:release",
    ]) {
      expect(doc).toContain(`\`${command}\``);
    }
  });

  it("当前发布 manifest 保持无 debugger 权限并声明构建输出入口", () => {
    expect(manifest.permissions).not.toContain("debugger");
    expect(manifest.background.service_worker).toBe("background/index.js");
    expect(manifest.side_panel.default_path).toBe("index.html");
    expect(manifest.devtools_page).toBe("src/devtools/network.html");
    expect(manifest.chrome_url_overrides.newtab).toBe("src/pages/newtab/index.html");
  });
});
```

- [ ] **Step 2: Run RED check**

Run: `npx vitest run tests/unit/background/releaseReadinessContract.test.ts`

Expected before implementation: FAIL because `docs/superpowers/release-readiness.md` does not exist.

- [ ] **Step 3: Write the acceptance matrix**

Create `docs/superpowers/release-readiness.md`:

```md
# Phase 7 发布验收矩阵

本矩阵用于 Browser AI Assistant 上游工程化迁移的发布候选验收。当前发布候选加载目录是 `dist/` 或 `artifacts/chrome-extension/`，不是仓库根目录。

## 发布验收命令

| 命令 | 作用 | 通过标准 |
|---|---|---|
| `npm run typecheck` | TypeScript 类型检查 | `tsc --noEmit` 退出码为 0 |
| `npm run build:extension` | 生成 MV3 扩展构建产物 | `dist/manifest.json` 和声明入口产出 |
| `npm test` | Vitest 单元测试 | 全部测试通过 |
| `npm run test:legacy` | 迁移保留的 Node 脚本回归 | legacy 脚本退出码为 0 |
| `npm run check:package` | 打包脚本测试并生成本地发布包 | `artifacts/chrome-extension/` 生成且无测试文件 |
| `npm run check` | 类型、构建、单测、legacy、打包综合门禁 | 命令链退出码为 0 |
| `npm run test:e2e` | Playwright preview 与真实扩展 smoke | web-preview 和 chrome-extension 项目通过 |
| `npm run verify:release` | 完整发布候选验收入口 | `check`、E2E、发布产物检查全部通过 |

## 功能验收矩阵

| 验收面 | 覆盖命令或文件 | 发布标准 |
|---|---|---|
| AI 侧栏 | `tests/e2e/extension-runtime.spec.ts`、`tests/unit/side-panel/App.test.tsx` | 真实扩展可打开 `index.html`，显示聊天、设置和工具入口 |
| Moon Tab 新标签页 | `tests/e2e/extension-runtime.spec.ts`、`tests/e2e/extension-smoke.spec.ts` | 构建后 `src/pages/newtab/index.html` 渲染搜索、AI 增强和页面管理入口 |
| 小游戏 | `tests/e2e/extension-runtime.spec.ts`、`npm run test:legacy` | 构建后 `src/pages/game/index.html` 渲染游戏入口，worker/sprite 回归通过 |
| 悬浮助手 | `tests/unit/content/index.test.ts`、`tests/unit/side-panel/App.test.tsx`、真实扩展侧栏 smoke | 侧栏暴露打开悬浮助手入口，content script 保持 iframe URL 和关闭边界 |
| Grok/MCP Bridge | `tests/unit/background/agentToolsMessageHandler.test.ts`、`tests/unit/side-panel/App.test.tsx` | Grok 预设、MCP Server 配置、工具刷新、调用审计和本地密钥边界保持可用 |
| DevTools Network 兼容工具 | `tests/unit/background/networkDevtoolsBridge.test.ts`、`tests/unit/background/backgroundToolRuntime.test.ts` | `network.list_requests`、详情、清空、对比、参数候选和 JS 候选继续走脱敏只读兼容层 |
| 浏览器控制基础工具 | `tests/unit/background/browserControlMessageHandler.test.ts`、`tests/unit/background/backgroundToolRuntime.test.ts` | 低风险观察和基础操作工具只在浏览器控制运行态可用，受控增强和完全访问不被普通模式默认暴露 |
| Imagefree 与 Tavily | `tests/unit/background/backgroundToolRuntime.test.ts`、`tests/unit/background/agentToolsMessageHandler.test.ts` | Imagefree source-owned runtime hook 可用，Tavily 只接受受限 query 参数并输出 web-search 附件 |
| 打包产物 | `scripts/package-extension.test.ts`、`scripts/verify-release-readiness.mjs` | 发布包包含 manifest 声明页面、background、content、游戏 vendor 和 build-info，排除测试与旧产物 |
| 权限边界 | `tests/unit/background/manifestBrowserControl.test.ts`、`tests/unit/background/releaseReadinessContract.test.ts` | 当前发布 manifest 不声明 `debugger` 权限；debugger-backed/CDP recorder 不被静默启用 |

## 手工加载验收

1. 运行 `npm run verify:release`。
2. 在 Chrome/Edge 扩展管理页启用开发者模式。
3. 选择“加载已解压的扩展”，目录指向 `dist/` 或 `artifacts/chrome-extension/`。
4. 打开侧栏，确认 AI 侧栏、设置、MCP 工具、聊天偏好、同步设置和悬浮助手入口可见。
5. 打开新标签页确认 Moon Tab 渲染；从页面导航到小游戏确认 `GAME DECK` 可见。
6. 如需验收 Network 兼容工具，保持目标页 DevTools Network 面板打开后再从侧栏调用只读 Network 工具。

## 发布边界

- 当前发布候选保留 DevTools Network 兼容层，不切换到 debugger-backed CDP Network recorder。
- 当前 manifest 不包含 `debugger` 权限；浏览器控制基础工具只在用户开启浏览器控制后暴露。
- Bearer Token、Grok API Key 和外部工具凭据仍保存在本地扩展存储，不进入同步快照。
- `PocketAide/`、旧 `src/ai-assistant` bundle、DOM patch、root no-build manifest/content/service-worker 不属于当前发布产物。
```

- [ ] **Step 4: Run GREEN check**

Run: `npx vitest run tests/unit/background/releaseReadinessContract.test.ts`

Expected after implementation: PASS.

- [ ] **Step 5: Commit this task**

```powershell
git add docs/superpowers/release-readiness.md tests/unit/background/releaseReadinessContract.test.ts
git commit -m "文档：固化发布验收矩阵"
```

---

### Task 5: Release Guidance In Maintainer Docs

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `tests/unit/background/releaseReadinessContract.test.ts`

- [ ] **Step 1: Extend the documentation contract first**

In `tests/unit/background/releaseReadinessContract.test.ts`, add this test inside the existing `describe` block:

```ts
  it("README 和 CLAUDE 维护说明暴露发布验收入口", async () => {
    const readme = await readProjectFile("README.md");
    const claude = await readProjectFile("CLAUDE.md");

    expect(readme).toContain("npm run verify:release");
    expect(readme).toContain("artifacts/chrome-extension");
    expect(readme).toContain("docs/superpowers/release-readiness.md");
    expect(claude).toContain("npm run verify:release");
    expect(claude).toContain("release readiness");
    expect(claude).toContain("Do not load the repository root directly");
  });
```

- [ ] **Step 2: Run RED check**

Run: `npx vitest run tests/unit/background/releaseReadinessContract.test.ts --testNamePattern "README|CLAUDE"`

Expected before implementation: FAIL because docs do not yet mention `verify:release` and the Phase 7 matrix.

- [ ] **Step 3: Update README release commands**

In `README.md`, update the command block under `## 常用命令` to include:

```powershell
npm run check:package
npm run verify:release
```

Replace the paragraph after the command block with:

```md
`npm test` 运行工程化后的 Vitest 测试；`npm run test:legacy` 保留迁移期间仍有价值的 Node 脚本回归；`npm run test:e2e` 验证构建后的侧栏、新标签页、游戏页面和真实扩展加载 smoke；`npm run verify:release` 依次执行 `check`、E2E 和发布产物检查，是 Phase 7 发布候选验收入口。
```

Add this subsection after the command description:

```md
## 发布验收

发布候选验收使用：

```powershell
npm run verify:release
```

该命令会生成 `dist/` 和 `artifacts/chrome-extension/`，并确认 manifest 声明入口、打包产物、测试排除、旧产物缺失和当前无 `debugger` 权限边界。验收矩阵维护在 `docs/superpowers/release-readiness.md`。
```

- [ ] **Step 4: Update CLAUDE maintainer guidance**

In `CLAUDE.md`, add this bullet in the command list:

```md
- `npm run verify:release` - run the full release readiness gate: `check`, Playwright E2E, and packaged artifact verification.
```

Add this paragraph after the local extension testing guidance:

```md
Before claiming release readiness, run `npm run verify:release` and inspect the output. The release readiness matrix is `docs/superpowers/release-readiness.md`; keep it aligned with manifest entries, package artifacts, and the current no-`debugger` permission boundary.
```

- [ ] **Step 5: Run GREEN check**

Run: `npx vitest run tests/unit/background/releaseReadinessContract.test.ts --testNamePattern "README|CLAUDE"`

Expected after implementation: PASS.

- [ ] **Step 6: Commit this task**

```powershell
git add README.md CLAUDE.md tests/unit/background/releaseReadinessContract.test.ts
git commit -m "文档：补充发布验收入口"
```

---

### Task 6: Final Verification And Migration Ledger Closure

**Files:**
- Modify: `docs/superpowers/MIGRATION_STATUS.md`

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`

Expected: PASS with `tsc --noEmit` exit code 0.

- [ ] **Step 2: Run extension build**

Run: `npm run build:extension`

Expected: PASS and produce `dist/manifest.json`. Existing Vite chunk/vendor/inlineDynamicImports warnings are acceptable only if the command exits 0.

- [ ] **Step 3: Run Vitest**

Run: `npm test`

Expected: PASS.

- [ ] **Step 4: Run legacy regression**

Run: `npm run test:legacy`

Expected: PASS.

- [ ] **Step 5: Run package check**

Run: `npm run check:package`

Expected: PASS and generate `artifacts/chrome-extension` with `build-info.json`, `src/devtools/network.html`, side panel, newtab, game, background, and content script artifacts.

- [ ] **Step 6: Run full project check**

Run: `npm run check`

Expected: PASS. Existing Vite warnings are acceptable only if the command exits 0.

- [ ] **Step 7: Run E2E**

Run: `npm run test:e2e`

Expected: PASS for both `web-preview` and `chrome-extension` Playwright projects.

- [ ] **Step 8: Run release gate**

Run: `npm run verify:release`

Expected: PASS. This is the final release candidate evidence for Phase 7.

- [ ] **Step 9: Update migration status current phase and plan**

In `docs/superpowers/MIGRATION_STATUS.md`, replace the current phase section with:

```md
## 当前阶段

Phase 7：验收与发布准备已完成。发布候选现在通过 `npm run verify:release` 收敛类型检查、构建、单元测试、legacy 回归、打包检查、Playwright E2E 和发布产物校验；验收矩阵记录在 `docs/superpowers/release-readiness.md`。
```

Replace the current plan pointer with:

```md
- 当前计划：`docs/superpowers/plans/2026-07-07-full-upstream-engineering-migration-phase-7.md`
```

Append this section after the Phase 6 result section:

```md
## 当前工作区 Phase 7 结果

- 新增 `npm run verify:release` 作为发布候选验收入口，依次执行 `check`、Playwright E2E 和发布产物检查。
- 本地打包脚本现在要求 manifest 声明的 HTML 入口进入发布包并检查资源引用，包括 `src/devtools/network.html`。
- 真实 Chrome 扩展 smoke 覆盖 AI 侧栏发布关键入口：悬浮助手、浏览器控制、设置、MCP 工具、聊天偏好和同步设置。
- 发布验收矩阵已记录 AI 侧栏、新标签页、小游戏、悬浮助手、Grok/MCP、DevTools Network、浏览器控制基础工具、Imagefree/Tavily、打包产物和权限边界。
- 当前发布 manifest 继续不声明 `debugger` 权限，debugger-backed/CDP recorder 不被静默启用。
```

Add these rows near the top of `## 当前验证状态`:

```md
| `npm run typecheck` | 通过 | 2026-07-07 Phase 7 final verification；tsc --noEmit |
| `npm run build:extension` | 通过 | 2026-07-07 Phase 7 final verification；生成 dist 扩展产物 |
| `npm test` | 通过 | 2026-07-07 Phase 7 final verification；Vitest 全量单元测试 |
| `npm run test:legacy` | 通过 | 2026-07-07 Phase 7 final verification；legacy 脚本回归 |
| `npm run check:package` | 通过 | 2026-07-07 Phase 7 final verification；打包脚本测试并生成 artifacts/chrome-extension |
| `npm run check` | 通过 | 2026-07-07 Phase 7 final verification；类型、构建、单测、legacy 和打包综合门禁 |
| `npm run test:e2e` | 通过 | 2026-07-07 Phase 7 final verification；Playwright preview 和真实扩展 smoke |
| `npm run verify:release` | 通过 | 2026-07-07 Phase 7 release gate；check、E2E 和发布产物校验全部通过 |
```

Replace `## 下一阶段入口` with:

```md
## 下一阶段入口

全面迁移远程工程化结构的 Phase 0-7 已完成。后续如需启用 debugger-backed CDP Network recorder、Replay、Runtime 或 Full Access，应先写新的独立设计和计划，不能作为当前发布候选的隐式范围。
```

- [ ] **Step 10: Run ledger and release contract checks**

Run: `npx vitest run tests/unit/background/releaseReadinessContract.test.ts tests/unit/background/extensionBuildContract.test.ts scripts/package-extension.test.ts`

Expected after ledger update: PASS.

- [ ] **Step 11: Check worktree**

Run: `git status --short`

Expected: only `docs/superpowers/MIGRATION_STATUS.md` changed for this task plus unrelated untracked `.claude/` if it existed before.

- [ ] **Step 12: Commit this task**

```powershell
git add docs/superpowers/MIGRATION_STATUS.md
git commit -m "文档：完成第七阶段发布验收"
```

---

## Self-Review Checklist

- Spec coverage: Phase 7 maps to Task 1 release command, Task 2 package artifact contract, Task 3 real extension smoke, Task 4 acceptance matrix, Task 5 maintainer guidance, and Task 6 final verification plus ledger closure.
- Placeholder scan: every task has concrete file paths, exact commands, expected outcomes, and code snippets for code or documentation edits.
- Type consistency: release verifier exports `RELEASE_REQUIRED_ARTIFACT_PATHS`, `collectReleaseReadinessIssues`, and `verifyReleaseReadiness`; package helper exports `collectManifestHtmlEntries`; the release command is consistently `npm run verify:release`.
- Execution boundary: current release readiness preserves the no-`debugger` permission boundary and does not switch DevTools Network compatibility to debugger-backed CDP recorder.
