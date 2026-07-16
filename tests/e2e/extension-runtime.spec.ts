import { expect, test } from "./fixtures/extension";
import { ADARKROOM_STORAGE_KEY, createWastelandUnlockedState } from "./fixtures/adarkroomState";

test("构建产物可以作为 Chrome 扩展加载并渲染侧边栏页面", async ({ extensionContext, extensionId }) => {
  const page = await extensionContext.newPage();

  await page.goto(`chrome-extension://${extensionId}/index.html`);

  await expect(page.getByRole("heading", { name: "月标签 AI 助手" })).toBeVisible();
  await expect(page.getByText("请先配置 API Key 后再开始对话")).toBeVisible();
  await page.getByRole("button", { name: "历史", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "历史记录" }).getByRole("button", { name: "设置", exact: true })).toBeVisible();
});

test("真实扩展侧边栏暴露发布验收所需的工具、MCP、同步和悬浮入口", async ({ extensionContext, extensionId }) => {
  const page = await extensionContext.newPage();

  await page.goto(`chrome-extension://${extensionId}/index.html`);
  const manifestText = await page.evaluate(async () => {
    const response = await fetch(chrome.runtime.getURL("manifest.json"));
    return response.text();
  });
  expect(manifestText).toContain('"debugger"');

  await expect(page.getByRole("button", { name: "打开悬浮助手" })).toBeVisible();
  await page.getByRole("button", { name: "工具" }).click();
  await expect(page.getByRole("switch", { name: /浏览器控制已关闭/ })).toBeVisible();

  await page.getByRole("button", { name: "历史", exact: true }).click();
  const historyDrawer = page.getByRole("dialog", { name: "历史记录" });
  await historyDrawer.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.locator(".settings-dialog-title")).toHaveText("设置");
  await page.getByRole("button", { name: /浏览器自动化诊断/ }).click();
  await expect(page.locator("#automation-diagnostics-panel")).toContainText("Network 来源");
  await expect(page.locator("#automation-diagnostics-panel")).toContainText(/debugger_recorder|devtools_fallback|unavailable/);
  await expect(page.getByRole("tab", { name: "渠道管理" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "工具和 MCP" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "聊天偏好" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "同步设置" })).toBeVisible();

  await page.getByRole("tab", { name: "工具和 MCP" }).click();
  await expect(page.getByRole("heading", { name: "工具和 MCP" })).toBeVisible();
  await expect(page.getByRole("button", { name: "新增 MCP Server" })).toBeVisible();

  await page.getByRole("tab", { name: "聊天偏好" }).click();
  await expect(page.getByRole("checkbox", { name: "启用工具调用" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "工具运行要求筛选" })).toBeVisible();

  await page.getByRole("tab", { name: "同步设置" }).click();
  await expect(page.getByRole("heading", { name: "同步设置" })).toBeVisible();
  await expect(page.getByText("备份当前插件域本地存储的全部内容，密钥和远程凭据除外")).toBeVisible();
});

test("构建产物可以作为 Chrome 扩展加载新标签页并进入暗室", async ({ extensionContext, extensionId }) => {
  const page = await extensionContext.newPage();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`chrome-extension://${extensionId}/src/pages/newtab/index.html`);

  await expect(page.getByRole("searchbox", { name: "输入内容并搜索或打开" })).toBeVisible();
  await expect(page.getByRole("button", { name: "切换AI增强搜索" })).toBeVisible();
  await page.locator('#homepage-manage-trigger[aria-label="打开页面管理菜单"]').click();
  await page.getByRole("button", { name: "打开暗室" }).click();

  await page.waitForURL(`chrome-extension://${extensionId}/src/pages/game/index.html`);
  await expect(page.getByRole("heading", { name: "暗室" })).toBeVisible();
});

test("构建产物可以作为 Chrome 扩展加载并渲染游戏页面", async ({ extensionContext, extensionId }) => {
  const page = await extensionContext.newPage();

  await page.goto(`chrome-extension://${extensionId}/src/pages/game/index.html`);

  await expect(page.getByRole("heading", { name: "暗室" })).toBeVisible();
  await expect(page.locator("#lightButton")).toContainText("生火");
});

test("真实扩展中的荒原势力入口可读取旧周目兼容存档", async ({ extensionContext, extensionId }) => {
  const page = await extensionContext.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(({ key, state }) => {
    localStorage.setItem(key, JSON.stringify(state));
  }, { key: ADARKROOM_STORAGE_KEY, state: createWastelandUnlockedState() });

  await page.goto(`chrome-extension://${extensionId}/src/pages/game/index.html`);

  await expect(page.getByRole("region", { name: "荒原来客" })).toBeVisible();
  await page.getByRole("button", { name: "荒原来客" }).click();
  await expect(page.getByText("荒原走向：尚未定局。")).toBeVisible();
  expect(pageErrors).toEqual([]);
});
