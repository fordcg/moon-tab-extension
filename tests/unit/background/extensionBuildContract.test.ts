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
    expect(manifest.web_accessible_resources.flatMap((entry) => entry.resources)).toEqual(expect.arrayContaining([
      "index.html",
      "assets/*",
    ]));

    expect(viteConfig).toContain('"background/index": resolve(rootDir, "src/background/index.ts")');
    expect(viteConfig).toContain('devtools: resolve(rootDir, "src/devtools/network.html")');
    expect(viteConfig).toContain('sidePanel: resolve(rootDir, "index.html")');
    expect(viteConfig).toContain('newtab: resolve(rootDir, "src/pages/newtab/index.html")');
    expect(viteConfig).toContain('game: resolve(rootDir, "src/pages/game/index.html")');
    expect(viteConfig).toContain("copy-legacy-page-static-assets");
    expect(viteConfig).toContain('copyFile(resolve(rootDir, "src/pages/game/vendor/matter.min.js")');
    expect(viteConfig).toContain('outDir: resolve(rootDir, "dist/content")');
    expect(viteConfig).toContain('entry: resolve(rootDir, "src/content/index.ts")');
    expect(viteConfig).toContain('formats: ["iife"]');
    expect(viteConfig).toContain('fileName: () => "index.js"');
  });

  it("manifest 应声明 downloads 权限以自动生成模型请求日志文件", () => {
    expect(manifest.permissions).toEqual(expect.arrayContaining(["downloads"]));
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

  it("Moon Tab 页面间导航应继续指向构建后的稳定扩展路径", async () => {
    const newtabEntry = await readProjectFile("src/pages/newtab/index.mjs");
    const gameEntry = await readProjectFile("src/pages/game/index.mjs");

    expect(newtabEntry).toContain('runtime.getURL("src/pages/game/index.html")');
    expect(gameEntry).toContain('runtime.getURL("src/pages/newtab/index.html")');
  });
});
