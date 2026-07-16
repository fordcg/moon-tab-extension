import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const projectRoot = process.cwd();
const gameRoot = resolve(projectRoot, "src/pages/game");

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return nested.flat();
}

function parseTranslationObject(source: string, method: "setTranslation" | "addTranslation") {
  const match = source.match(new RegExp(`^_\\.${method}\\((\\{[\\s\\S]*\\})\\);\\s*$`));
  if (!match) {
    throw new Error(`无法解析 ${method} 翻译对象`);
  }
  return JSON.parse(match[1]) as Record<string, string>;
}

describe("A Dark Room MV3 运行时", () => {
  it("HTML 只加载扩展内脚本，且不包含内联脚本或内联事件", async () => {
    const html = await readFile(resolve(gameRoot, "index.html"), "utf8");
    const document = new DOMParser().parseFromString(html, "text/html");
    const scripts = [...document.querySelectorAll("script")];

    expect(scripts.length).toBeGreaterThan(20);
    for (const script of scripts) {
      expect(script.getAttribute("src")).toMatch(/^\.\//);
      expect(script.textContent?.trim()).toBe("");
    }
    expect(html).not.toMatch(/\s(?:on\w+)\s*=/i);
    expect(html).not.toMatch(/https?:\/\/[^"']+\.js/i);
    expect(html).not.toContain("document.write");
  });

  it("所有打包 JavaScript 均不使用 eval 或 Function 构造器", async () => {
    const javascriptFiles = (await listFiles(gameRoot)).filter((path) => path.endsWith(".js"));
    const violations: string[] = [];

    for (const path of javascriptFiles) {
      const source = await readFile(path, "utf8");
      if (/\beval\s*\(|new\s+Function\s*\(|(?<![.\w])Function\s*\(\s*["'`]/.test(source)) {
        violations.push(path.slice(gameRoot.length + 1));
      }
      if (source.includes("document.write")) {
        violations.push(`${path.slice(gameRoot.length + 1)}:document.write`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("简体中文覆盖当前核心源码中的全部静态文案", async () => {
    const scriptFiles = (await listFiles(resolve(gameRoot, "script")))
      .filter((path) => path.endsWith(".js"));
    const requiredKeys = new Set<string>();

    for (const path of scriptFiles) {
      const sourceText = await readFile(path, "utf8");
      const sourceFile = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node)
          && ts.isIdentifier(node.expression)
          && node.expression.text === "_"
          && node.arguments.length > 0
          && ts.isStringLiteralLike(node.arguments[0])
        ) {
          requiredKeys.add(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }

    const base = parseTranslationObject(
      await readFile(resolve(gameRoot, "lang/zh_cn/strings.js"), "utf8"),
      "setTranslation",
    );
    const extra = parseTranslationObject(
      await readFile(resolve(gameRoot, "lang/zh_cn/extra.js"), "utf8"),
      "addTranslation",
    );
    const translations = { ...base, ...extra };
    const missing = [...requiredKeys].filter((key) => !Object.hasOwn(translations, key));

    expect(requiredKeys.size).toBeGreaterThan(1_000);
    expect(missing).toEqual([]);
    expect(translations["A Dark Room"]).toBe("暗室");
  });

  it("状态路径访问无需动态执行，并阻止原型污染", async () => {
    const source = await readFile(resolve(gameRoot, "script/state_manager.js"), "utf8");
    const log = vi.fn();
    const context = createContext({
      Engine: { log, saveGame: vi.fn() },
      State: {},
      window: undefined as unknown,
      $: {
        Dispatch: () => ({ publish: vi.fn(), subscribe: vi.fn() }),
        extend: Object.assign,
        isEmptyObject: (value: object) => Object.keys(value).length === 0,
      },
    }) as Record<string, any>;
    context.window = context;
    runInContext(source, context);

    const stateManager = context.StateManager;
    stateManager.set('stores["cured meat"]', 7, true);
    stateManager.add('stores["cured meat"]', 3, true);
    expect(stateManager.get('stores["cured meat"]')).toBe(10);

    stateManager.set('stores["cured meat"]', -2, true);
    expect(stateManager.get('stores["cured meat"]')).toBe(0);

    stateManager.set('stores["__proto__"]["polluted"]', true, true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(stateManager.get('stores["__proto__"]["polluted"]')).toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("invalid state path"));
  });

  it("存档和重置只操作游戏命名空间", async () => {
    const [bootstrap, engine] = await Promise.all([
      readFile(resolve(gameRoot, "bootstrap.js"), "utf8"),
      readFile(resolve(gameRoot, "script/engine.js"), "utf8"),
    ]);

    expect(bootstrap).toContain("airp:game:adarkroom:state");
    expect(engine).toContain("localStorage.removeItem(Engine.STORAGE_KEY)");
    expect(engine).not.toContain("localStorage.clear(");
    expect(engine).not.toMatch(/localStorage\.(?:getItem|setItem|removeItem)\(['"]gameState['"]/);
  });
});
