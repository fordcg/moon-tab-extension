import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  collectHtmlAssetReferences,
  collectManifestHtmlEntries,
  createBuildInfo,
  createPackagedManifest,
  ensureHtmlAssetReferences,
  removeJunkFiles,
  requiredDistDirectories,
  requiredDistPaths,
  shouldExcludeFromPackage,
} from "./package-extension.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");

describe("本地扩展打包脚本", () => {
  it("保留当前 dist 加载路径，不改写为 Chrome Web Store 发布专用结构", () => {
    const manifest = createPackagedManifest({
      manifest_version: 3,
      side_panel: { default_path: "index.html" },
      content_scripts: [{ matches: ["<all_urls>"], js: ["content/index.js"] }],
    });

    expect(manifest.side_panel.default_path).toBe("index.html");
    expect(manifest.content_scripts).toEqual([{ matches: ["<all_urls>"], js: ["content/index.js"] }]);
  });

  it("打包时排除测试文件，避免发布产物混入开发验证代码", () => {
    expect(shouldExcludeFromPackage("src/background/index.test.ts")).toBe(true);
    expect(shouldExcludeFromPackage("tests/unit/background/index.test.ts")).toBe(true);
    expect(shouldExcludeFromPackage("tests")).toBe(true);
    expect(shouldExcludeFromPackage("src/__tests__")).toBe(true);
    expect(shouldExcludeFromPackage("src/background/index.ts")).toBe(false);
  });

  it("检查 HTML 中引用的相对资源是否存在", async () => {
    const packageRoot = await mkdir(join(tmpdir(), `browser-ai-package-${Date.now()}`), { recursive: true });
    if (!packageRoot) {
      throw new Error("无法创建临时打包目录。");
    }

    await mkdir(join(packageRoot, "assets"), { recursive: true });
    await writeFile(join(packageRoot, "index.html"), '<script src="./sidePanel.js"></script><script src="./assets/index-abc.js"></script><link href="/assets/index-def.css"><img src="https://example.com/logo.png">', "utf8");
    await writeFile(join(packageRoot, "sidePanel.js"), "", "utf8");
    await writeFile(join(packageRoot, "assets", "index-abc.js"), "", "utf8");

    expect(collectHtmlAssetReferences(await readFile(join(packageRoot, "index.html"), "utf8"))).toEqual(["/assets/index-def.css", "assets/index-abc.js", "sidePanel.js"]);
    await expect(ensureHtmlAssetReferences(packageRoot, ["index.html"])).rejects.toThrow("index.html -> /assets/index-def.css");
  });

  it("拒绝跳出打包目录的 HTML 资源引用", async () => {
    const tempRoot = await mkdir(join(tmpdir(), `browser-ai-package-traversal-${Date.now()}`), { recursive: true });
    if (!tempRoot) {
      throw new Error("无法创建临时打包目录。");
    }

    const packageRoot = join(tempRoot, "package");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(tempRoot, "outside.js"), "", "utf8");
    await writeFile(join(packageRoot, "index.html"), '<script src="assets/../../outside.js"></script>', "utf8");

    await expect(ensureHtmlAssetReferences(packageRoot, ["index.html"])).rejects.toThrow("index.html -> assets/../../outside.js");
  });

  it("支持嵌套 HTML 页面引用 dist 根目录内的相对资源", async () => {
    const packageRoot = await mkdir(join(tmpdir(), `browser-ai-package-nested-${Date.now()}`), { recursive: true });
    if (!packageRoot) {
      throw new Error("无法创建临时打包目录。");
    }

    await mkdir(join(packageRoot, "src", "pages", "newtab"), { recursive: true });
    await mkdir(join(packageRoot, "assets"), { recursive: true });
    await writeFile(
      join(packageRoot, "src", "pages", "newtab", "index.html"),
      '<script type="module" src="../../../assets/newtab.js"></script><link href="../../../assets/newtab.css" rel="stylesheet">',
      "utf8",
    );
    await writeFile(join(packageRoot, "assets", "newtab.js"), "", "utf8");
    await writeFile(join(packageRoot, "assets", "newtab.css"), "", "utf8");

    await expect(ensureHtmlAssetReferences(packageRoot, ["src/pages/newtab/index.html"])).resolves.toBeUndefined();
  });

  it("支持嵌套 HTML 页面使用根相对路径引用 dist 根目录资源", async () => {
    const packageRoot = await mkdir(join(tmpdir(), `browser-ai-package-root-relative-${Date.now()}`), { recursive: true });
    if (!packageRoot) {
      throw new Error("无法创建临时打包目录。");
    }

    await mkdir(join(packageRoot, "src", "pages", "newtab"), { recursive: true });
    await mkdir(join(packageRoot, "assets"), { recursive: true });
    await writeFile(join(packageRoot, "src", "pages", "newtab", "index.html"), '<script type="module" src="/assets/root.js"></script>', "utf8");
    await writeFile(join(packageRoot, "assets", "root.js"), "", "utf8");

    await expect(ensureHtmlAssetReferences(packageRoot, ["src/pages/newtab/index.html"])).resolves.toBeUndefined();
  });

  it("拒绝嵌套 HTML 页面引用 dist 根目录外的资源", async () => {
    const tempRoot = await mkdir(join(tmpdir(), `browser-ai-package-nested-traversal-${Date.now()}`), { recursive: true });
    if (!tempRoot) {
      throw new Error("无法创建临时打包目录。");
    }

    const packageRoot = join(tempRoot, "package");
    await mkdir(join(packageRoot, "src", "pages", "newtab"), { recursive: true });
    await writeFile(join(tempRoot, "outside.js"), "", "utf8");
    await writeFile(join(packageRoot, "src", "pages", "newtab", "index.html"), '<script src="../../../../outside.js"></script>', "utf8");

    await expect(ensureHtmlAssetReferences(packageRoot, ["src/pages/newtab/index.html"])).rejects.toThrow("src/pages/newtab/index.html -> ../../../../outside.js");
  });

  it("从 manifest 收集发布包必须包含并检查资源引用的 HTML 入口", () => {
    expect(collectManifestHtmlEntries({
      side_panel: { default_path: "index.html" },
      devtools_page: "src/devtools/network.html",
      chrome_url_overrides: { newtab: "src/pages/newtab/index.html" },
      web_accessible_resources: [
        { resources: ["index.html", "assets/*"] },
      ],
    })).toEqual([
      "index.html",
      "src/devtools/network.html",
      "src/pages/game/index.html",
      "src/pages/newtab/index.html",
    ]);
  });

  it("即使游戏不对普通网页开放，也校验扩展内部游戏页的静态引用", () => {
    expect(collectManifestHtmlEntries({
      side_panel: { default_path: "index.html" },
      web_accessible_resources: [{ resources: ["index.html", "assets/*"] }],
    })).toEqual(["index.html", "src/pages/game/index.html"]);
  });

  it("打包脚本要求 newtab 和 A Dark Room 完整静态运行时", async () => {
    const scriptSource = await readFile(join(projectRoot, "scripts", "package-extension.mjs"), "utf8");

    expect(requiredDistPaths).toEqual(expect.arrayContaining([
      "src/pages/newtab/index.html",
      "src/pages/game/index.html",
      "src/pages/game/bootstrap.js",
      "src/pages/game/favicon.ico",
      "src/pages/game/LICENSE.md",
      "src/pages/game/UPSTREAM.md",
    ]));
    expect(requiredDistDirectories).toEqual([
      "src/pages/game/script",
      "src/pages/game/lib",
      "src/pages/game/css",
      "src/pages/game/lang",
      "src/pages/game/audio",
      "src/pages/game/img",
      "src/pages/game/expansion",
    ]);
    expect(scriptSource).not.toContain("matter.min.js");
    expect(scriptSource).toContain("ensureHtmlAssetReferences(packageDir, collectManifestHtmlEntries(manifest))");
  });

  it("清理复制后残留的测试文件和空测试目录", async () => {
    const packageRoot = await mkdir(join(tmpdir(), `browser-ai-package-clean-${Date.now()}`), { recursive: true });
    if (!packageRoot) {
      throw new Error("无法创建临时打包目录。");
    }

    await mkdir(join(packageRoot, "assets"), { recursive: true });
    await mkdir(join(packageRoot, "tests"), { recursive: true });
    await writeFile(join(packageRoot, "tests", "index.test.js"), "", "utf8");
    await writeFile(join(packageRoot, "assets", ".DS_Store"), "", "utf8");

    await removeJunkFiles(packageRoot, packageRoot);

    await expect(stat(join(packageRoot, "tests"))).rejects.toThrow();
    await expect(stat(join(packageRoot, "assets", ".DS_Store"))).rejects.toThrow();
    await expect(stat(join(packageRoot, "assets"))).resolves.toBeTruthy();
  });

  it("生成可追踪的构建信息", () => {
    const buildInfo = createBuildInfo({ name: "browser-ai-assistant", version: "0.1.0" }, new Date("2026-06-14T00:00:00.000Z"));

    expect(buildInfo).toEqual({
      name: "browser-ai-assistant",
      version: "0.1.0",
      builtAt: "2026-06-14T00:00:00.000Z",
    });
  });

  it("项目声明本地打包命令，但不声明 Chrome Web Store 发布命令", async () => {
    const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")) as { scripts: Record<string, string> };

    expect(packageJson.scripts["package:extension"]).toBe("npm run build:extension && node scripts/package-extension.mjs");
    expect(packageJson.scripts["check:package"]).toBe("vitest run scripts/package-extension.test.ts && npm run package:extension");
    expect(packageJson.scripts.check).toContain("npm run check:package");
    expect(packageJson.scripts["publish:chrome-webstore"]).toBeUndefined();
    await expect(stat(join(projectRoot, ".env.chrome-webstore.example"))).rejects.toThrow();
  });

  it("打包脚本要求 manifest 声明的 DevTools 页面产物", async () => {
    const scriptSource = await readFile(join(projectRoot, "scripts", "package-extension.mjs"), "utf8");

    expect(scriptSource).toContain('"src/devtools/network.html"');
    expect(scriptSource).toContain("collectManifestHtmlEntries");
    expect(scriptSource).toContain("ensureHtmlAssetReferences(packageDir, collectManifestHtmlEntries(manifest))");
  });
});
