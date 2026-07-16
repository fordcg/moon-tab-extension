import { expect, test } from "@playwright/test";

test("侧边栏页面可以渲染首次使用提示和设置入口", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "月标签 AI 助手" })).toBeVisible();
  await expect(page.getByText("请先配置 API Key 后再开始对话")).toBeVisible();
  await expect(page.getByRole("button", { name: "发送" })).toBeDisabled();

  await page.getByRole("button", { name: "历史", exact: true }).click();
  const historyDrawer = page.getByRole("dialog", { name: "历史记录" });
  await historyDrawer.getByRole("button", { name: "设置", exact: true }).click();

  await expect(page.locator(".settings-dialog-title")).toHaveText("设置");
  await expect(page.getByRole("tab", { name: "渠道管理" })).toBeVisible();
  await page.getByRole("tab", { name: "同步设置" }).click();
  await expect(page.getByText("备份当前插件域本地存储的全部内容，密钥和远程凭据除外")).toBeVisible();
  await expect(page.getByText("加密关闭时，API Key、聊天记录和配置会以明文进入远程备份")).toBeVisible();
});

test("构建后的侧边栏页面应包含 Tailwind 工具类样式", async ({ page }) => {
  await page.goto("/");

  const heading = page.getByRole("heading", { name: "月标签 AI 助手" });
  await expect(heading).toBeVisible();

  const shellLayout = await page.locator(".app-shell").evaluate((element) => {
    const style = getComputedStyle(element);
    return { display: style.display, flexDirection: style.flexDirection };
  });

  expect(shellLayout).toEqual({ display: "flex", flexDirection: "column" });
});

test("构建后的 Moon Tab 新标签页可以渲染搜索入口并进入暗室", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/src/pages/newtab/index.html");

  await expect(page.getByRole("searchbox", { name: "输入内容并搜索或打开" })).toBeVisible();
  await expect(page.getByRole("button", { name: "切换AI增强搜索" })).toBeVisible();
  await page.locator('#homepage-manage-trigger[aria-label="打开页面管理菜单"]').click();
  await page.getByRole("button", { name: "打开暗室" }).click();

  await page.waitForURL(/\/src\/pages\/game\/index\.html$/);
  await expect(page.getByRole("heading", { name: "暗室" })).toBeVisible();
});

test("构建后的游戏页面可以渲染游戏入口", async ({ page }) => {
  await page.goto("/src/pages/game/index.html");

  await expect(page.getByRole("heading", { name: "暗室" })).toBeVisible();
  await expect(page.locator("#lightButton")).toContainText("生火");
});
