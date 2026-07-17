import { expect, test } from "@playwright/test";
import { ADARKROOM_STORAGE_KEY, createWastelandUnlockedState } from "./fixtures/adarkroomState";

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

test("游戏事件标题遮罩完整覆盖中文行框", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/src/pages/game/index.html");
  await page.evaluate(() => {
    (window as any).Events.startEvent({
      title: "损毁的陷阱",
      scenes: {
        start: {
          text: ["一些陷阱损毁了。", "巨大的足印延伸至森林。"],
          buttons: { ignore: { text: "忽略", nextScene: "end" } },
        },
      },
    });
  });
  const title = page.locator(".eventTitle");
  await expect(title).toHaveText("损毁的陷阱");
  await page.waitForFunction(() => getComputedStyle(document.querySelector("#event")!).opacity === "1");

  const geometry = await title.evaluate((element) => {
    const titleStyle = getComputedStyle(element);
    const maskStyle = getComputedStyle(element, "::after");
    return {
      titleHeight: element.getBoundingClientRect().height,
      maskHeight: Number.parseFloat(maskStyle.height),
      maskLeft: Number.parseFloat(maskStyle.left),
      maskRight: Number.parseFloat(maskStyle.right),
      lineHeight: Number.parseFloat(titleStyle.lineHeight),
      zIndex: titleStyle.zIndex,
    };
  });
  expect(geometry.maskHeight).toBeCloseTo(geometry.titleHeight, 1);
  expect(geometry.maskLeft).toBe(-5);
  expect(geometry.maskRight).toBe(-5);
  expect(geometry.lineHeight).toBeGreaterThanOrEqual(20);
  expect(geometry.zIndex).toBe("1");

  const maskBackground = () => title.evaluate((element) => getComputedStyle(element, "::after").backgroundColor);
  await expect.poll(maskBackground).toBe("rgb(255, 255, 255)");
  await page.evaluate(() => document.body.classList.add("noMask"));
  await expect.poll(maskBackground).toBe("rgb(0, 0, 0)");
  await page.evaluate(() => {
    document.body.classList.remove("noMask");
    (window as any).Engine.turnLightsOff();
  });
  await expect.poll(maskBackground).toBe("rgb(39, 40, 35)");
  await page.evaluate(() => document.body.classList.add("noMask"));
  await expect.poll(maskBackground).toBe("rgb(238, 238, 238)");
  expect(pageErrors).toEqual([]);
});

test("荒原势力扩展可从村庄打开并显示三方声望", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(({ key, state }) => {
    localStorage.setItem(key, JSON.stringify(state));
  }, { key: ADARKROOM_STORAGE_KEY, state: createWastelandUnlockedState() });

  await page.goto("/src/pages/game/index.html");

  await expect(page.getByRole("region", { name: "荒原来客" })).toBeVisible();
  await page.getByRole("button", { name: "荒原来客" }).click();
  await expect(page.getByText("三面旗帜停在林外，没有一面肯先靠近。")).toBeVisible();
  await page.getByRole("button", { name: "听听三面旗帜" }).click();
  await expect(page.getByRole("button", { name: /守火人：陌生/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /铁誓商队：陌生/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /灰径旅团：陌生/ })).toBeVisible();
  await page.getByRole("button", { name: /守火人：陌生/ }).click();
  await page.getByRole("button", { name: /分出一口锅/ }).dblclick();
  await expect(page.locator("#event")).toHaveCount(0);

  await page.getByRole("button", { name: "荒原来客" }).click();
  await page.getByRole("button", { name: "查看村庄路线" }).click();
  await page.getByRole("button", { name: /共灶/ }).dblclick();
  await expect(page.locator("#event")).toHaveCount(0);

  const savedState = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "{}"), ADARKROOM_STORAGE_KEY);
  expect(savedState.game.wasteland).toMatchObject({
    route: "hearth",
    routeLevel: 1,
    quests: { embers: 1 },
    reputations: { embers: 22, iron: -3, trail: -5 },
    receipts: {
      "quest:embers:0:share-pot": true,
      "route:hearth": true,
    },
  });
  expect(savedState.stores).toMatchObject({
    "cured meat": 170,
    medicine: 17,
  });
  expect(savedState.stores.wood).toBeGreaterThanOrEqual(1_700);
  expect(savedState.stores.wood).toBeLessThan(1_800);
  await expect.poll(() => page.evaluate(() => (window as any).Outside.getMaxPopulation())).toBe(26);

  const revealedBossTiles = await page.evaluate(() => {
    const runtime = (window as any).WastelandFactions;
    const state = runtime.getState();
    state.quests.embers = 2;
    state.reputations.embers = 30;
    runtime.commitState(state);
    runtime.armBoss("embers");
    (window as any).World.init();
    runtime.ensureBossLandmarks();
    const map = (window as any).$SM.get("game.world.map");
    return map.flat().filter((tile: string) => tile === "Q").length;
  });
  expect(revealedBossTiles).toBe(1);

  const bossMechanics = await page.evaluate(() => {
    const events = (window as any).Events;
    const path = (window as any).Path;
    const runtime = (window as any).WastelandFactions;
    const whiteback = events.Setpieces["wf-whiteback"].scenes.fight_nest;
    const tollkeeper = events.Setpieces["wf-tollkeeper"].scenes.fight_burn;
    const sentry = events.Setpieces["wf-sentry"].scenes.fight_advance;
    whiteback.onLoad();
    tollkeeper.onLoad();
    sentry.onLoad();

    const whitebackThreshold = Number(Object.keys(whiteback.atHealth)[0]);
    const whitebackEnemy = events.createFighterDiv("白脊", whitebackThreshold, whiteback.health);
    whiteback.atHealth[whitebackThreshold](whitebackEnemy);

    path.outfit = { "cured meat": 2 };
    const tollCue = tollkeeper.specials[0].action();

    const sentryEnemy = events.createFighterDiv("旧哨机", sentry.health, sentry.health);
    const sentryCue = sentry.specials[0].action(sentryEnemy);
    const wolfState = runtime.getState();
    wolfState.modifier = "wolfSeason";
    runtime.commitState(wolfState, true);
    whiteback.onLoad();
    whiteback.onLoad();
    tollkeeper.onLoad();
    tollkeeper.onLoad();
    sentry.onLoad();
    sentry.onLoad();
    const wolfWhitebackHealth = whiteback.health;
    const wolfWhitebackThreshold = Number(Object.keys(whiteback.atHealth)[0]);
    const wolfTollSpecials = tollkeeper.specials.length;
    const wolfSentrySpecials = sentry.specials.length;
    wolfState.modifier = null;
    runtime.commitState(wolfState, true);
    return {
      whitebackThreshold,
      whitebackStatus: whitebackEnemy.data("status"),
      tollDelay: tollkeeper.specials[0].delay,
      tollCue,
      curedMeatLeft: path.outfit["cured meat"],
      tollkeeperRanged: tollkeeper.ranged,
      sentryDelay: sentry.specials[0].delay,
      sentryCue,
      sentryStatus: sentryEnemy.data("status"),
      sentryRanged: sentry.ranged,
      wolfWhitebackHealth,
      wolfWhitebackThreshold,
      wolfTollSpecials,
      wolfSentrySpecials,
    };
  });
  expect(bossMechanics).toEqual({
    whitebackThreshold: 12,
    whitebackStatus: "energised",
    tollDelay: 10,
    tollCue: "夺粮",
    curedMeatLeft: 1,
    tollkeeperRanged: true,
    sentryDelay: 9,
    sentryCue: "吸能",
    sentryStatus: "shield",
    sentryRanged: true,
    wolfWhitebackHealth: 27,
    wolfWhitebackThreshold: 14,
    wolfTollSpecials: 1,
    wolfSentrySpecials: 1,
  });

  const bossLifecycle = await page.evaluate(() => {
    const runtime = (window as any).WastelandFactions;
    const world = (window as any).World;
    const stateManager = (window as any).$SM;
    const path = (window as any).Path;
    const jquery = (window as any).$;
    const findTile = (map: string[][], tile: string) => {
      for (let x = 0; x < map.length; x += 1) {
        const y = map[x].indexOf(tile);
        if (y >= 0) return [x, y];
      }
      throw new Error(`Missing boss tile ${tile}`);
    };
    const countTile = (map: string[][], tile: string) => map.flat().filter((value) => value === tile).length;

    const embersMap = stateManager.get("game.world.map") as string[][];
    world.state = jquery.extend(true, {}, stateManager.get("game.world"));
    world.curPos = findTile(embersMap, "Q");
    world.dead = false;
    world.usedOutposts = {};
    path.outfit = { "cured meat": 1 };
    world.state.wastelandApproaches = { embers: { id: "nest", reputation: { embers: 20, iron: 4 } } };
    runtime.recordBossVictory("embers");
    world.goHome();

    const returnedState = runtime.getState();
    const returnedMap = stateManager.get("game.world.map") as string[][];

    const nextState = runtime.getState();
    nextState.quests.iron = 2;
    nextState.reputations.iron = 30;
    runtime.commitState(nextState);
    runtime.armBoss("iron");
    const ironMap = stateManager.get("game.world.map") as string[][];
    world.state = jquery.extend(true, {}, stateManager.get("game.world"));
    world.curPos = findTile(ironMap, "R");
    world.dead = false;
    world.usedOutposts = {};
    path.outfit = { "cured meat": 1 };
    world.state.wastelandApproaches = { iron: { id: "burn", reputation: { iron: 20, trail: 5 } } };
    runtime.recordBossVictory("iron");
    world.die();

    const deathState = runtime.getState();
    const deathMap = stateManager.get("game.world.map") as string[][];
    return {
      returnedBoss: returnedState.bosses.embers,
      returnedQuest: returnedState.quests.embers,
      returnedTiles: countTile(returnedMap, "Q"),
      deathBoss: deathState.bosses.iron,
      deathQuest: deathState.quests.iron,
      deathTiles: countTile(deathMap, "R"),
    };
  });
  expect(bossLifecycle).toEqual({
    returnedBoss: true,
    returnedQuest: 3,
    returnedTiles: 0,
    deathBoss: false,
    deathQuest: 2,
    deathTiles: 1,
  });
  expect(pageErrors).toEqual([]);
});

test("荒原势力灰旗和解解除内容阻挡但不改变真实声望", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const state = createWastelandUnlockedState();
  (state.game as any).wasteland = {
    version: 1,
    runId: "reconcile-e2e",
    unlocked: true,
    quests: { embers: 1 },
    reputations: { embers: 8 },
  };
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: ADARKROOM_STORAGE_KEY, value: state });

  await page.goto("/src/pages/game/index.html");
  await page.getByRole("button", { name: "荒原来客" }).click();
  await page.getByRole("button", { name: "听听三面旗帜" }).click();
  await page.getByRole("button", { name: /守火人：陌生/ }).click();
  await expect(page.getByText("还需声望 10。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /举起灰旗，送上一次赔礼/ }).dblclick();
  await expect(page.locator("#event")).toHaveCount(0);

  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "{}"), ADARKROOM_STORAGE_KEY);
  expect(saved.game.wasteland).toMatchObject({
    version: 2,
    reputations: { embers: 8 },
    reconciliations: { embers: true },
    receipts: { "reconcile:embers": true },
  });
  expect(saved.stores).toMatchObject({
    cloth: 80,
    "cured meat": 170,
    medicine: 18,
  });
  expect(saved.stores.wood).toBeGreaterThanOrEqual(1_700);
  expect(saved.stores.wood).toBeLessThan(1_800);

  await page.getByRole("button", { name: "荒原来客" }).click();
  await page.getByRole("button", { name: "听听三面旗帜" }).click();
  await page.getByRole("button", { name: /守火人：陌生/ }).click();
  await expect(page.getByRole("button", { name: /带药过去/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /举起灰旗/ })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("荒原势力二阶路线双击只扩建一次并刷新真实效果", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const state = createWastelandUnlockedState();
  (state.game as any).wasteland = {
    version: 1,
    runId: "route-upgrade-e2e",
    unlocked: true,
    route: "hearth",
    quests: { embers: 3 },
    bosses: { embers: true },
    reputations: { embers: 55 },
  };
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: ADARKROOM_STORAGE_KEY, value: state });

  await page.goto("/src/pages/game/index.html");
  await expect.poll(() => page.evaluate(() => (window as any).Outside.getMaxPopulation())).toBe(26);
  await page.getByRole("button", { name: "荒原来客" }).click();
  await page.getByRole("button", { name: "查看村庄路线" }).click();
  await page.getByRole("button", { name: /扩建长桌/ }).dblclick();
  await expect(page.locator("#event")).toHaveCount(0);

  const upgraded = await page.evaluate((key) => ({
    saved: JSON.parse(localStorage.getItem(key) || "{}"),
    maxPopulation: (window as any).Outside.getMaxPopulation(),
  }), ADARKROOM_STORAGE_KEY);
  expect(upgraded.saved.game.wasteland).toMatchObject({
    route: "hearth",
    routeLevel: 2,
    receipts: { "route-upgrade:hearth": true },
  });
  expect(upgraded.saved.stores).toMatchObject({
    "cured meat": 140,
    medicine: 15,
  });
  expect(upgraded.saved.stores.wood).toBeGreaterThanOrEqual(1_200);
  expect(upgraded.saved.stores.wood).toBeLessThan(1_300);
  expect(upgraded.maxPopulation).toBe(36);

  const otherRouteEffects = await page.evaluate(() => {
    const runtime = (window as any).WastelandFactions;
    const room = (window as any).Room;
    const path = (window as any).Path;
    const foundry = runtime.getState();
    foundry.route = "foundry";
    foundry.routeLevel = 1;
    runtime.commitState(foundry, true);
    const foundryLevelOne = room.TradeGoods.iron.cost();
    foundry.routeLevel = 2;
    runtime.commitState(foundry, true);
    const foundryLevelTwo = room.TradeGoods.iron.cost();

    const waystation = runtime.getState();
    waystation.route = "waystation";
    waystation.routeLevel = 1;
    runtime.commitState(waystation, true);
    const waystationLevelOne = path.getCapacity();
    waystation.routeLevel = 2;
    runtime.commitState(waystation, true);
    const waystationLevelTwo = path.getCapacity();
    return { foundryLevelOne, foundryLevelTwo, waystationLevelOne, waystationLevelTwo };
  });
  expect(otherRouteEffects).toEqual({
    foundryLevelOne: { fur: 135, scales: 45 },
    foundryLevelTwo: { fur: 120, scales: 40 },
    waystationLevelOne: 15,
    waystationLevelTwo: 20,
  });
  expect(pageErrors).toEqual([]);
});
