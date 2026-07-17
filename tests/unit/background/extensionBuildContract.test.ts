import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../../../public/manifest.json";

const projectRoot = process.cwd();

async function readProjectFile(path: string): Promise<string> {
  return readFile(resolve(projectRoot, path), "utf8");
}

async function projectFileExists(path: string): Promise<boolean> {
  try {
    await access(resolve(projectRoot, path));
    return true;
  } catch {
    return false;
  }
}

function legacyPath(...parts: string[]): string {
  return parts.join("/");
}

describe("扩展构建产物合约", () => {
  it("manifest 中声明的 DevTools 等运行时入口应由 Vite 构建配置产出", async () => {
    const viteConfig = await readProjectFile("vite.config.ts");

    expect(manifest.background.service_worker).toBe("background/index.js");
    expect(manifest.side_panel.default_path).toBe("index.html");
    expect(manifest.chrome_url_overrides).toEqual({
      newtab: "src/pages/newtab/index.html",
    });
    expect(manifest.devtools_page).toBe("src/devtools/network.html");
    expect(manifest.content_scripts).toHaveLength(1);
    expect(manifest.content_scripts[0].js).toEqual(["content/index.js"]);
    const webAccessibleResources = manifest.web_accessible_resources.flatMap((entry) => entry.resources);
    expect(webAccessibleResources).toEqual(expect.arrayContaining([
      "index.html",
      "assets/*",
    ]));
    expect(webAccessibleResources.filter((resource) => resource.startsWith("src/pages/game/"))).toEqual([]);

    expect(viteConfig).toContain('"background/index": resolve(rootDir, "src/background/index.ts")');
    expect(viteConfig).toContain('devtools: resolve(rootDir, "src/devtools/network.html")');
    expect(viteConfig).toContain('sidePanel: resolve(rootDir, "index.html")');
    expect(viteConfig).toContain('newtab: resolve(rootDir, "src/pages/newtab/index.html")');
    expect(viteConfig).toContain('game: resolve(rootDir, "src/pages/game/index.html")');
    expect(viteConfig).toContain("copy-game-runtime-static-assets");
    expect(viteConfig).toContain("await cp(gameSource, gameOutput");
    expect(viteConfig).toContain('if (relativePath === "index.html") return false');
    expect(viteConfig).not.toContain("matter.min.js");
    expect(viteConfig).toContain('outDir: resolve(rootDir, "dist/content")');
    expect(viteConfig).toContain('entry: resolve(rootDir, "src/content/index.ts")');
    expect(viteConfig).toContain('formats: ["iife"]');
    expect(viteConfig).toContain('fileName: () => "index.js"');
  });

  it("manifest 应声明 downloads 权限以自动生成模型请求日志文件", () => {
    expect(manifest.permissions).toEqual(expect.arrayContaining(["downloads"]));
  });

  it("manifest 应声明 declarativeNetRequestWithHostAccess 以清洗模型请求 Origin", () => {
    expect(manifest.permissions).toEqual(expect.arrayContaining(["declarativeNetRequestWithHostAccess"]));
  });

  it("内容脚本入口不应引入动态 import，保持普通 content script 可直接执行", async () => {
    const contentEntry = await readProjectFile("src/content/index.ts");

    expect(contentEntry).not.toMatch(/\bimport\s*\(/);
  });

  it("TypeScript 后台入口应加载 source-owned Imagefree 后台运行时 hook", async () => {
    const backgroundEntry = await readProjectFile("src/background/index.ts");
    const imagefreeRuntime = await readProjectFile("src/background/imagefreeToolRuntime.ts");

    expect(backgroundEntry).toContain('import "./imagefreeToolRuntime";');
    expect(imagefreeRuntime).toContain("globalThis.__imagefreeGenerateTool = executeImagefreeGenerateTool");
    expect(imagefreeRuntime).toContain("IMAGEFREE_GENERATE_IMAGE_TOOL_NAME");
  });

  it("旧 AI sidebar bundle、DOM patch 和 root no-build 入口不再作为源码存在", async () => {
    await expect(projectFileExists("manifest.json")).resolves.toBe(false);
    await expect(projectFileExists("content/index.js")).resolves.toBe(false);
    await expect(projectFileExists(legacyPath("src", "background", "service-worker.js"))).resolves.toBe(false);
    await expect(projectFileExists(legacyPath("src", "ai-assistant", "index.html"))).resolves.toBe(false);
    await expect(projectFileExists(legacyPath("src", "ai-assistant", "sidePanel.js"))).resolves.toBe(false);
    await expect(projectFileExists(legacyPath("src", "ai-assistant", "sidePanel-layout.js"))).resolves.toBe(false);
    await expect(projectFileExists(legacyPath("src", "ai-assistant", "sidePanel-layout.css"))).resolves.toBe(false);
    await expect(projectFileExists(legacyPath("src", "ai-assistant", "agent-tools-dialog.js"))).resolves.toBe(false);
    await expect(projectFileExists(legacyPath("src", "ai-assistant", "assets", ["imagefree", "tool", "runtime.js"].join("-")))).resolves.toBe(false);
  });

  it("旧 GAME DECK 物理、工人和精灵运行时不再作为源码或构建依赖存在", async () => {
    await expect(projectFileExists("src/pages/game/vendor/matter.min.js")).resolves.toBe(false);
    await expect(projectFileExists("src/pages/game/index.mjs")).resolves.toBe(false);
    await expect(projectFileExists("src/pages/game/rock-physics.mjs")).resolves.toBe(false);
    await expect(projectFileExists("src/pages/game/workers.mjs")).resolves.toBe(false);
    await expect(projectFileExists("src/pages/game/sprite-runtime.mjs")).resolves.toBe(false);
  });

  it("Moon Tab 页面间导航应继续指向构建后的稳定扩展路径", async () => {
    const newtabEntry = await readProjectFile("src/pages/newtab/index.mjs");
    const gameEntry = await readProjectFile("src/pages/game/index.html");

    expect(newtabEntry).toContain('runtime.getURL("src/pages/game/index.html")');
    expect(gameEntry).toContain('href="../newtab/index.html"');
  });

  it("A Dark Room 的脚本、样式、语言、音频和许可证均由源码拥有", async () => {
    for (const path of [
      "src/pages/game/bootstrap.js",
      "src/pages/game/script",
      "src/pages/game/lib",
      "src/pages/game/css",
      "src/pages/game/lang",
      "src/pages/game/audio",
      "src/pages/game/img",
      "src/pages/game/expansion",
      "src/pages/game/favicon.ico",
      "src/pages/game/LICENSE.md",
      "src/pages/game/UPSTREAM.md",
    ]) {
      await expect(projectFileExists(path), path).resolves.toBe(true);
    }
  });
});
