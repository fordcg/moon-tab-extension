(function(root, factory) {
  'use strict';

  var api = factory();
  if(typeof module === 'object' && module && module.exports) {
    module.exports = api;
  }
  root.WastelandCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';

  var VERSION = 1;
  var FACTION_IDS = ['embers', 'iron', 'trail'];
  var ROUTE_IDS = ['hearth', 'foundry', 'waystation'];
  var MODIFIER_IDS = ['longNight', 'leanYear', 'wolfSeason'];
  var ENDING_IDS = ['concord', 'dominion', 'fracture'];
  var ROUTE_FACTIONS = {
    hearth: 'embers',
    foundry: 'iron',
    waystation: 'trail'
  };
  var MODIFIER_RULES = {
    longNight: {
      costMultiplier: 1.25,
      reputationMultiplier: 1.5,
      bossThresholdDelta: 0,
      routeDelayMultiplier: 1,
      legacyMarkBonus: 0
    },
    leanYear: {
      costMultiplier: 1.4,
      reputationMultiplier: 1,
      bossThresholdDelta: 0,
      routeDelayMultiplier: 0.75,
      legacyMarkBonus: 0
    },
    wolfSeason: {
      costMultiplier: 1,
      reputationMultiplier: 1.2,
      bossThresholdDelta: 10,
      routeDelayMultiplier: 1,
      legacyMarkBonus: 1
    }
  };
  var DEFAULT_RULES = {
    costMultiplier: 1,
    reputationMultiplier: 1,
    bossThresholdDelta: 0,
    routeDelayMultiplier: 1,
    legacyMarkBonus: 0
  };

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function toFiniteNumber(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, toFiniteNumber(value, minimum)));
  }

  function clampInteger(value, minimum, maximum) {
    return Math.round(clamp(value, minimum, maximum));
  }

  function validId(value, allowed) {
    return allowed.indexOf(value) >= 0 ? value : null;
  }

  function normalizeBooleanMap(value) {
    var source = isRecord(value) ? value : {};
    var result = {};
    for(var i = 0; i < FACTION_IDS.length; i++) {
      var id = FACTION_IDS[i];
      result[id] = source[id] === true;
    }
    return result;
  }

  function normalizeNumberMap(value, minimum, maximum) {
    var source = isRecord(value) ? value : {};
    var result = {};
    var fallback = minimum <= 0 && maximum >= 0 ? 0 : minimum;
    for(var i = 0; i < FACTION_IDS.length; i++) {
      var id = FACTION_IDS[i];
      result[id] = clampInteger(toFiniteNumber(source[id], fallback), minimum, maximum);
    }
    return result;
  }

  function normalizeReceiptMap(value) {
    var source = isRecord(value) ? value : {};
    var result = {};
    for(var key in source) {
      if(hasOwn(source, key) && source[key] === true && key.length <= 160) {
        result[key] = true;
      }
    }
    return result;
  }

  function normalizeEventTimes(value) {
    var source = isRecord(value) ? value : {};
    var result = {};
    for(var key in source) {
      if(hasOwn(source, key) && key.length <= 80) {
        var time = toFiniteNumber(source[key], 0);
        if(time > 0) result[key] = time;
      }
    }
    return result;
  }

  function normalizeState(input) {
    var source = isRecord(input) ? input : {};
    return {
      version: VERSION,
      revision: clampInteger(source.revision, 0, Number.MAX_SAFE_INTEGER),
      runId: typeof source.runId === 'string' && source.runId.length <= 100 ? source.runId : '',
      unlocked: source.unlocked === true,
      route: validId(source.route, ROUTE_IDS),
      modifier: validId(source.modifier, MODIFIER_IDS),
      reputations: normalizeNumberMap(source.reputations, -100, 100),
      quests: normalizeNumberMap(source.quests, 0, 3),
      bosses: normalizeBooleanMap(source.bosses),
      mapReveals: normalizeBooleanMap(source.mapReveals),
      routeMapApplied: source.routeMapApplied === true,
      legacyApplied: source.legacyApplied === true,
      ending: validId(source.ending, ENDING_IDS),
      receipts: normalizeReceiptMap(source.receipts),
      randomEventTimes: normalizeEventTimes(source.randomEventTimes)
    };
  }

  function normalizeLegacy(input) {
    var source = isRecord(input) ? input : {};
    var settledRunIds = [];
    if(Array.isArray(source.settledRunIds)) {
      for(var i = 0; i < source.settledRunIds.length; i++) {
        var runId = source.settledRunIds[i];
        if(typeof runId === 'string' && runId.length > 0 && runId.length <= 100 && settledRunIds.indexOf(runId) < 0) {
          settledRunIds.push(runId);
        }
      }
    }
    if(settledRunIds.length > 8) settledRunIds = settledRunIds.slice(-8);

    return {
      version: VERSION,
      cycle: clampInteger(source.cycle, 0, Number.MAX_SAFE_INTEGER),
      marks: clampInteger(source.marks, 0, 4),
      ending: validId(source.ending, ENDING_IDS),
      route: validId(source.route, ROUTE_IDS),
      dominantFaction: validId(source.dominantFaction, FACTION_IDS),
      settledRunIds: settledRunIds
    };
  }

  function modifierRules(modifierId) {
    return MODIFIER_RULES[modifierId] || DEFAULT_RULES;
  }

  function scaleCost(cost, modifierId) {
    var source = isRecord(cost) ? cost : {};
    var multiplier = modifierRules(modifierId).costMultiplier;
    var result = {};
    for(var key in source) {
      if(hasOwn(source, key)) {
        var amount = Math.max(0, toFiniteNumber(source[key], 0));
        result[key] = Math.ceil(amount * multiplier);
      }
    }
    return result;
  }

  function adjustReputations(input, changes) {
    var state = normalizeState(input);
    var source = isRecord(changes) ? changes : {};
    var multiplier = modifierRules(state.modifier).reputationMultiplier;
    for(var i = 0; i < FACTION_IDS.length; i++) {
      var id = FACTION_IDS[i];
      if(!hasOwn(source, id)) continue;
      var amount = toFiniteNumber(source[id], 0);
      if(amount > 0) amount = Math.round(amount * multiplier);
      state.reputations[id] = clampInteger(state.reputations[id] + amount, -100, 100);
    }
    return state;
  }

  function withReceipt(input, commandId, transform) {
    var state = normalizeState(input);
    if(typeof commandId !== 'string' || commandId.length === 0 || commandId.length > 160) {
      return { state: state, status: 'invalid' };
    }
    if(state.receipts[commandId]) {
      return { state: state, status: 'duplicate' };
    }

    var transformed = typeof transform === 'function' ? transform(normalizeState(state)) : state;
    var next = normalizeState(transformed);
    next.receipts[commandId] = true;
    next.revision = state.revision + 1;
    return { state: next, status: 'applied' };
  }

  function chooseRoute(input, routeId, commandId) {
    var state = normalizeState(input);
    if(ROUTE_IDS.indexOf(routeId) < 0) return { state: state, status: 'invalid' };
    if(state.route === routeId) return { state: state, status: 'duplicate' };
    if(state.route !== null) return { state: state, status: 'conflict' };

    return withReceipt(state, commandId || ('route:' + routeId), function(next) {
      next.route = routeId;
      next = adjustReputations(next, (function() {
        var changes = { embers: -3, iron: -3, trail: -3 };
        changes[ROUTE_FACTIONS[routeId]] = 10;
        return changes;
      })());
      return next;
    });
  }

  function questRequirement(input, factionId) {
    var state = normalizeState(input);
    if(FACTION_IDS.indexOf(factionId) < 0) return { available: false, reason: 'invalid', threshold: 0 };
    var stage = state.quests[factionId];
    if(stage >= 3 || state.bosses[factionId]) return { available: false, reason: 'complete', threshold: 0 };
    if(stage === 0) return { available: true, reason: 'ready', threshold: 0 };
    var threshold = stage === 1 ? 10 : 30 + modifierRules(state.modifier).bossThresholdDelta;
    if(state.reputations[factionId] < threshold) {
      return { available: false, reason: 'reputation', threshold: threshold };
    }
    return { available: true, reason: 'ready', threshold: threshold };
  }

  function completeQuest(input, factionId, expectedStage, reputationChanges, commandId) {
    var state = normalizeState(input);
    if(FACTION_IDS.indexOf(factionId) < 0 || expectedStage < 0 || expectedStage > 2) {
      return { state: state, status: 'invalid' };
    }
    if(state.quests[factionId] > expectedStage) return { state: state, status: 'duplicate' };
    if(state.quests[factionId] !== expectedStage) return { state: state, status: 'conflict' };
    var requirement = questRequirement(state, factionId);
    if(!requirement.available) return { state: state, status: requirement.reason };

    return withReceipt(state, commandId || ('quest:' + factionId + ':' + expectedStage), function(next) {
      next = adjustReputations(next, reputationChanges);
      next.quests[factionId] = expectedStage + 1;
      if(expectedStage === 2) next.bosses[factionId] = true;
      return next;
    });
  }

  function countDefeatedBosses(input) {
    var state = normalizeState(input);
    var count = 0;
    for(var i = 0; i < FACTION_IDS.length; i++) {
      if(state.bosses[FACTION_IDS[i]]) count++;
    }
    return count;
  }

  function dominantFaction(input) {
    var state = normalizeState(input);
    var winner = FACTION_IDS[0];
    for(var i = 1; i < FACTION_IDS.length; i++) {
      if(state.reputations[FACTION_IDS[i]] > state.reputations[winner]) winner = FACTION_IDS[i];
    }
    return winner;
  }

  function resolveEnding(input) {
    var state = normalizeState(input);
    var bossCount = countDefeatedBosses(state);
    var minimumReputation = Math.min(
      state.reputations.embers,
      state.reputations.iron,
      state.reputations.trail
    );
    if(bossCount === 3 && minimumReputation >= 25) return 'concord';

    var routeFaction = ROUTE_FACTIONS[state.route];
    if(routeFaction && state.bosses[routeFaction] && state.reputations[routeFaction] >= 65) {
      var rivals = FACTION_IDS.filter(function(id) { return id !== routeFaction; });
      if(state.reputations[rivals[0]] <= 20 && state.reputations[rivals[1]] <= 20) return 'dominion';
    }
    return 'fracture';
  }

  function settleRun(input, previousLegacy) {
    var state = normalizeState(input);
    var legacy = normalizeLegacy(previousLegacy);
    if(!state.runId) return { state: state, legacy: legacy, status: 'invalid' };
    if(legacy.settledRunIds.indexOf(state.runId) >= 0) {
      state.ending = legacy.ending;
      return { state: state, legacy: legacy, status: 'duplicate' };
    }

    var ending = resolveEnding(state);
    var marks = countDefeatedBosses(state) + modifierRules(state.modifier).legacyMarkBonus;
    legacy = {
      version: VERSION,
      cycle: legacy.cycle + 1,
      marks: clampInteger(marks, 0, 4),
      ending: ending,
      route: state.route,
      dominantFaction: dominantFaction(state),
      settledRunIds: legacy.settledRunIds.concat([state.runId]).slice(-8)
    };
    state.ending = ending;
    state.revision += 1;
    state.receipts['settlement:' + state.runId] = true;
    return { state: state, legacy: legacy, status: 'applied' };
  }

  function applyLegacy(input, previousLegacy) {
    var state = normalizeState(input);
    var legacy = normalizeLegacy(previousLegacy);
    if(state.legacyApplied || legacy.cycle === 0) return { state: state, status: 'duplicate' };

    var bonus = legacy.marks * 5;
    if(legacy.ending === 'concord') {
      state = adjustReputations(state, { embers: bonus, iron: bonus, trail: bonus });
    } else if(legacy.ending === 'dominion' && legacy.dominantFaction) {
      var changes = { embers: Math.floor(bonus / 2), iron: Math.floor(bonus / 2), trail: Math.floor(bonus / 2) };
      changes[legacy.dominantFaction] = bonus * 2;
      state = adjustReputations(state, changes);
    } else if(legacy.route && ROUTE_FACTIONS[legacy.route]) {
      var routeChanges = { embers: 0, iron: 0, trail: 0 };
      routeChanges[ROUTE_FACTIONS[legacy.route]] = bonus;
      state = adjustReputations(state, routeChanges);
    }
    state.legacyApplied = true;
    state.revision += 1;
    return { state: state, status: 'applied' };
  }

  function reputationTier(value) {
    var score = clampInteger(value, -100, 100);
    if(score <= -40) return 'hostile';
    if(score < -10) return 'wary';
    if(score < 10) return 'unknown';
    if(score < 35) return 'known';
    if(score < 65) return 'trusted';
    return 'allied';
  }

  return Object.freeze({
    VERSION: VERSION,
    FACTION_IDS: Object.freeze(FACTION_IDS.slice()),
    ROUTE_IDS: Object.freeze(ROUTE_IDS.slice()),
    MODIFIER_IDS: Object.freeze(MODIFIER_IDS.slice()),
    ENDING_IDS: Object.freeze(ENDING_IDS.slice()),
    ROUTE_FACTIONS: Object.freeze(ROUTE_FACTIONS),
    normalizeState: normalizeState,
    normalizeLegacy: normalizeLegacy,
    modifierRules: modifierRules,
    scaleCost: scaleCost,
    adjustReputations: adjustReputations,
    withReceipt: withReceipt,
    chooseRoute: chooseRoute,
    questRequirement: questRequirement,
    completeQuest: completeQuest,
    countDefeatedBosses: countDefeatedBosses,
    dominantFaction: dominantFaction,
    resolveEnding: resolveEnding,
    settleRun: settleRun,
    applyLegacy: applyLegacy,
    reputationTier: reputationTier
  });
});
