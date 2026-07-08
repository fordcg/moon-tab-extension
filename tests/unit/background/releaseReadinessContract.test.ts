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
      "Debugger 浏览器自动化",
      "Debugger Network 主路径",
      "DevTools Network fallback",
      "浏览器控制基础工具",
      "Imagefree 与 Tavily",
      "打包产物",
      "高风险权限边界",
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

  it("当前发布 manifest 声明 debugger 权限并声明构建输出入口", () => {
    expect(manifest.permissions).toContain("debugger");
    expect(manifest.background.service_worker).toBe("background/index.js");
    expect(manifest.side_panel.default_path).toBe("index.html");
    expect(manifest.devtools_page).toBe("src/devtools/network.html");
    expect(manifest.chrome_url_overrides.newtab).toBe("src/pages/newtab/index.html");
  });

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
});
