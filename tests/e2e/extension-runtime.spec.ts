import { expect, test } from "./fixtures/extension";

test("构建产物可以作为 Chrome 扩展加载并渲染侧边栏页面", async ({ extensionContext, extensionId }) => {
  const page = await extensionContext.newPage();

  await page.goto(`chrome-extension://${extensionId}/index.html`);

  await expect(page.getByRole("heading", { name: "Browser AI Assistant" })).toBeVisible();
  await expect(page.getByText("请先配置 API Key 后再开始对话")).toBeVisible();
  await expect(page.getByRole("button", { name: "设置", exact: true })).toBeVisible();
});

test("构建产物可以作为 Chrome 扩展加载并渲染 Moon Tab 新标签页", async ({ extensionContext, extensionId }) => {
  const page = await extensionContext.newPage();

  await page.goto(`chrome-extension://${extensionId}/src/pages/newtab/index.html`);

  await expect(page.getByRole("searchbox", { name: "输入内容并搜索或打开" })).toBeVisible();
  await expect(page.getByRole("button", { name: "切换AI增强搜索" })).toBeVisible();
  await expect(page.locator('#homepage-manage-trigger[aria-label="打开页面管理菜单"]')).toBeVisible();
});

test("构建产物可以作为 Chrome 扩展加载并渲染游戏页面", async ({ extensionContext, extensionId }) => {
  const page = await extensionContext.newPage();

  await page.goto(`chrome-extension://${extensionId}/src/pages/game/index.html`);

  await expect(page.getByRole("heading", { name: "GAME DECK" })).toBeVisible();
  await expect(page.getByRole("button", { name: "START" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "搜索" })).toBeVisible();
});
