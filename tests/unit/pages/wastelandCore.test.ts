import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const corePath = resolve(projectRoot, "src/pages/game/expansion/wasteland-core.js");

type WastelandCoreApi = {
  normalizeState(input?: unknown): any;
  normalizeLegacy(input?: unknown): any;
  scaleCost(cost: Record<string, number>, modifierId?: string | null): Record<string, number>;
  hasFactionAccess(state: unknown, factionId: string, threshold: number): boolean;
  chooseRoute(state: unknown, routeId: string, commandId?: string): { state: any; status: string };
  routeUpgradeRequirement(state: unknown): { available: boolean; reason: string; threshold: number };
  upgradeRoute(state: unknown, commandId?: string): { state: any; status: string };
  questRequirement(state: unknown, factionId: string): { available: boolean; reason: string; threshold: number };
  reconciliationRequirement(state: unknown, factionId: string): { available: boolean; reason: string; threshold: number };
  reconcileFaction(state: unknown, factionId: string, commandId?: string): { state: any; status: string };
  completeQuest(
    state: unknown,
    factionId: string,
    expectedStage: number,
    changes: Record<string, number>,
    commandId?: string,
  ): { state: any; status: string };
  resolveEnding(state: unknown): string;
  settleRun(state: unknown, legacy?: unknown): { state: any; legacy: any; status: string };
  applyLegacy(state: unknown, legacy?: unknown): { state: any; status: string };
};

let core: WastelandCoreApi;

beforeAll(async () => {
  const source = await readFile(corePath, "utf8");
  const context = createContext({});
  runInContext(source, context);
  core = context.WastelandCore as WastelandCoreApi;
});

describe("荒原势力纯规则", () => {
  it("迁移脏状态时补齐结构并限制声望、任务和未知枚举", () => {
    const state = core.normalizeState({
      version: 99,
      route: "unknown-route",
      modifier: "unknown-modifier",
      routeLevel: 99,
      reputations: { embers: 999, iron: -999, trail: Number.NaN },
      quests: { embers: 9, iron: -2, trail: 1.6 },
      bosses: { embers: true, iron: "yes" },
      receipts: { valid: true, ignored: false },
    });

    expect(state).toMatchObject({
      version: 2,
      route: null,
      routeLevel: 0,
      modifier: null,
      reputations: { embers: 100, iron: -100, trail: 0 },
      quests: { embers: 3, iron: 0, trail: 2 },
      bosses: { embers: true, iron: false, trail: false },
      reconciliations: { embers: false, iron: false, trail: false },
      receipts: { valid: true },
    });
  });

  it("v1 路线存档自动迁移为一阶，非法层级会被约束", () => {
    expect(core.normalizeState({ version: 1, route: "hearth" })).toMatchObject({ version: 2, route: "hearth", routeLevel: 1 });
    expect(core.normalizeState({ route: "foundry", routeLevel: 99 })).toMatchObject({ route: "foundry", routeLevel: 2 });
    expect(core.normalizeState({ routeLevel: 2 })).toMatchObject({ route: null, routeLevel: 0 });
  });

  it("村庄路线只能选择一次，同命令重放不重复加声望", () => {
    const first = core.chooseRoute({ quests: { embers: 1 }, reconciliations: { embers: true } }, "hearth", "route:hearth");
    expect(first.status).toBe("applied");
    expect(first.state.route).toBe("hearth");
    expect(first.state.routeLevel).toBe(1);
    expect(first.state.reputations).toEqual({ embers: 10, iron: -3, trail: -3 });

    const replay = core.chooseRoute(first.state, "hearth", "route:hearth");
    expect(replay.status).toBe("duplicate");
    expect(replay.state.reputations).toEqual(first.state.reputations);

    const conflict = core.chooseRoute(first.state, "foundry", "route:foundry");
    expect(conflict.status).toBe("conflict");
    expect(conflict.state.route).toBe("hearth");
  });

  it("灰旗和解只解除内容阻挡，不改变真实声望且不能重复", () => {
    const blocked = core.normalizeState({ quests: { embers: 1 }, reputations: { embers: 8 } });
    expect(core.questRequirement(blocked, "embers")).toMatchObject({ available: false, reason: "reputation", threshold: 10 });
    expect(core.reconciliationRequirement(blocked, "embers")).toEqual({ available: true, reason: "reputation", threshold: 10 });

    const reconciled = core.reconcileFaction(blocked, "embers", "reconcile:embers");
    expect(reconciled.status).toBe("applied");
    expect(reconciled.state.reputations.embers).toBe(8);
    expect(reconciled.state.reconciliations.embers).toBe(true);
    expect(core.questRequirement(reconciled.state, "embers")).toMatchObject({ available: true, reason: "ready" });
    expect(core.hasFactionAccess(reconciled.state, "embers", 30)).toBe(true);

    const replay = core.reconcileFaction(reconciled.state, "embers", "reconcile:embers");
    expect(replay.status).toBe("used");
    expect(replay.state.reputations.embers).toBe(8);
  });

  it("二阶路线要求对应首领和 55 点真实声望，并以回执阻止重复扩建", () => {
    const bossMissing = core.normalizeState({ route: "hearth", routeLevel: 1, reputations: { embers: 60 } });
    expect(core.routeUpgradeRequirement(bossMissing)).toEqual({ available: false, reason: "boss", threshold: 55 });

    const lowReputation = core.normalizeState({
      route: "hearth",
      routeLevel: 1,
      bosses: { embers: true },
      reputations: { embers: 20 },
      reconciliations: { embers: true },
    });
    expect(core.routeUpgradeRequirement(lowReputation)).toEqual({ available: false, reason: "reputation", threshold: 55 });

    const ready = core.normalizeState({
      route: "hearth",
      routeLevel: 1,
      bosses: { embers: true },
      reputations: { embers: 55 },
    });
    const upgraded = core.upgradeRoute(ready, "route-upgrade:hearth");
    expect(upgraded.status).toBe("applied");
    expect(upgraded.state.routeLevel).toBe(2);
    expect(core.upgradeRoute(upgraded.state, "route-upgrade:hearth").status).toBe("complete");
  });

  it("连锁委托按声望门槛推进，并以回执阻止重复奖励", () => {
    const stageOne = core.completeQuest({}, "embers", 0, { embers: 12 }, "quest:embers:0:a");
    expect(stageOne.status).toBe("applied");
    expect(stageOne.state.quests.embers).toBe(1);
    expect(stageOne.state.reputations.embers).toBe(12);

    const replay = core.completeQuest(stageOne.state, "embers", 0, { embers: 12 }, "quest:embers:0:a");
    expect(replay.status).toBe("duplicate");
    expect(replay.state.reputations.embers).toBe(12);

    const stageTwo = core.completeQuest(stageOne.state, "embers", 1, { embers: 18 }, "quest:embers:1:a");
    expect(stageTwo.status).toBe("applied");
    expect(stageTwo.state.quests.embers).toBe(2);
    expect(core.questRequirement(stageTwo.state, "embers")).toEqual({
      available: true,
      reason: "ready",
      threshold: 30,
    });

    const wolfSeason = core.normalizeState({ ...stageTwo.state, modifier: "wolfSeason" });
    expect(core.questRequirement(wolfSeason, "embers")).toEqual({
      available: false,
      reason: "reputation",
      threshold: 40,
    });
  });

  it("周目词缀同时调整行动成本、声望收益和首领门槛", () => {
    expect(core.scaleCost({ wood: 10, medicine: 1 }, "longNight")).toEqual({ wood: 13, medicine: 2 });
    expect(core.scaleCost({ wood: 10, medicine: 1 }, "leanYear")).toEqual({ wood: 14, medicine: 2 });
    expect(core.scaleCost({ wood: 10 }, "wolfSeason")).toEqual({ wood: 10 });

    const result = core.completeQuest(
      { modifier: "longNight" },
      "trail",
      0,
      { trail: 10, embers: -4 },
      "quest:trail:0:a",
    );
    expect(result.state.reputations).toEqual({ embers: -4, iron: 0, trail: 15 });
  });

  it("三种荒原结局由首领、路线和三方声望唯一决定", () => {
    expect(core.resolveEnding({
      bosses: { embers: true, iron: true, trail: true },
      reputations: { embers: 25, iron: 40, trail: 65 },
    })).toBe("concord");

    expect(core.resolveEnding({
      route: "hearth",
      bosses: { embers: true },
      reputations: { embers: 70, iron: 10, trail: 20 },
    })).toBe("dominion");

    expect(core.resolveEnding({
      route: "foundry",
      bosses: { iron: true },
      reputations: { embers: -30, iron: 45, trail: 5 },
    })).toBe("fracture");
  });

  it("同一 runId 只结算一次，并在下一轮只应用一次遗产", () => {
    const run = core.normalizeState({
      runId: "run-1",
      route: "waystation",
      modifier: "wolfSeason",
      bosses: { embers: true, iron: true, trail: true },
      reputations: { embers: 40, iron: 40, trail: 40 },
    });
    const first = core.settleRun(run, {});
    expect(first.status).toBe("applied");
    expect(first.legacy).toMatchObject({ cycle: 1, marks: 4, ending: "concord" });

    const replay = core.settleRun(first.state, first.legacy);
    expect(replay.status).toBe("duplicate");
    expect(replay.legacy.cycle).toBe(1);

    const inherited = core.applyLegacy({ runId: "run-2" }, first.legacy);
    expect(inherited.status).toBe("applied");
    expect(inherited.state.reputations).toEqual({ embers: 20, iron: 20, trail: 20 });
    expect(inherited.state.routeLevel).toBe(0);
    expect(inherited.state.reconciliations).toEqual({ embers: false, iron: false, trail: false });

    const inheritedAgain = core.applyLegacy(inherited.state, first.legacy);
    expect(inheritedAgain.status).toBe("duplicate");
    expect(inheritedAgain.state.reputations).toEqual(inherited.state.reputations);
  });

  it("周目遗产只保留有限、可验证的运行回执", () => {
    const legacy = core.normalizeLegacy({
      cycle: 3,
      marks: 99,
      ending: "concord",
      settledRunIds: ["a", "a", "b", "c", "d", "e", "f", "g", "h", "i", 12],
    });

    expect(legacy.marks).toBe(4);
    expect(legacy.settledRunIds).toEqual(["b", "c", "d", "e", "f", "g", "h", "i"]);
  });
});
