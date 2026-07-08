import { expect, test } from "./fixtures/extension";

test("构建产物可以作为 Chrome 扩展加载并渲染侧边栏页面", async ({ extensionContext, extensionId }) => {
  const page = await extensionContext.newPage();

  await page.goto(`chrome-extension://${extensionId}/index.html`);

  await expect(page.getByRole("heading", { name: "Browser AI Assistant" })).toBeVisible();
  await expect(page.getByText("请先配置 API Key 后再开始对话")).toBeVisible();
  await expect(page.getByRole("button", { name: "设置", exact: true })).toBeVisible();
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
  await expect(page.getByRole("button", { name: "浏览器控制" })).toBeVisible();
  await expect(page.getByRole("button", { name: "设置", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await expect(page.getByText("浏览器自动化诊断")).toBeVisible();
  await expect(page.getByText(/debugger_recorder|unavailable/)).toBeVisible();
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
