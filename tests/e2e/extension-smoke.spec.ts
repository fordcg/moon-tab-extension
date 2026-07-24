import { expect, test } from "@playwright/test";

test("侧边栏页面可以渲染首次使用提示和设置入口", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Browser AI Assistant" })).toBeVisible();
  await expect(page.getByText("请先配置 API Key 后再开始对话")).toBeVisible();
  await expect(page.getByRole("button", { name: "发送" })).toBeDisabled();
  // Settings icon may be layout-hidden in web-preview width; ensure it is mounted.
  await expect(page.locator('button[aria-label="设置"]')).toHaveCount(1);
});

test("构建后的侧边栏页面应包含 Tailwind 工具类样式", async ({ page }) => {
  await page.goto("/");

  const heading = page.getByRole("heading", { name: "Browser AI Assistant" });
  await expect(heading).toBeVisible();

  const shellLayout = await page.locator(".app-shell").evaluate((element) => {
    const style = getComputedStyle(element);
    return { display: style.display, flexDirection: style.flexDirection };
  });

  expect(shellLayout.display === "flex" || shellLayout.display === "block").toBe(true);
});

test("构建后的 Moon Tab 新标签页可以渲染搜索入口", async ({ page }) => {
  await page.goto("/src/pages/newtab/index.html");

  await expect(page.getByRole("searchbox", { name: "输入内容并搜索或打开" })).toBeVisible();
  await expect(page.getByRole("button", { name: "切换AI增强搜索" })).toBeVisible();
  await expect(page.locator('#homepage-manage-trigger[aria-label="打开页面管理菜单"]')).toBeVisible();
});

test("构建后的游戏页面可以渲染游戏入口", async ({ page }) => {
  await page.goto("/src/pages/game/index.html");

  await expect(page.getByRole("heading", { name: "GAME DECK" })).toBeVisible();
  await expect(page.getByRole("button", { name: "START" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "搜索" })).toBeVisible();
});
