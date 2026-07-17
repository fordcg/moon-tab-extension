(function(root) {
  'use strict';

  var Core = root.WastelandCore;
  var Data = root.WastelandData;
  if(!Core || !Data) throw new Error('Wasteland expansion dependencies are missing.');

  var STATE_PATH = 'game.wasteland';
  var LEGACY_PATH = 'previous.wasteland';
  var BASIC_TRADE_GOODS = ['scales', 'teeth', 'iron', 'coal', 'steel', 'medicine', 'bullets'];
  var REPUTATION_LABELS = {
    hostile: '敌视',
    wary: '冷淡',
    unknown: '陌生',
    known: '点头',
    trusted: '信任',
    allied: '同路'
  };

  var WastelandFactions = root.WastelandFactions = {
    name: '荒原来客',
    prepared: false,
    mounted: false,
    _notifyUnlock: false,

    prepare: function() {
      if(WastelandFactions.prepared) return;
      WastelandFactions.prepared = true;

      var state = WastelandFactions.getState();
      if(!state.runId) state.runId = Engine.getGuid();
      var inherited = Core.applyLegacy(state, WastelandFactions.getLegacy());
      state = inherited.state;
      if(!state.unlocked && WastelandFactions.meetsUnlockRequirements()) {
        state.unlocked = true;
        WastelandFactions._notifyUnlock = true;
      }
      $SM.set(STATE_PATH, state, true);

      WastelandFactions.patchRouteRules();
      WastelandFactions.patchEventCleanup();
      WastelandFactions.registerWorldContent();
      WastelandFactions.registerRandomEvents();
      WastelandFactions.patchWorldReturn();
      WastelandFactions.patchPrestige();
      WastelandFactions.patchEnding();
      $.Dispatch('stateUpdate').subscribe(WastelandFactions.handleStateUpdates);
      Engine.saveGame();
    },

    mount: function() {
      if(!WastelandFactions.prepared) WastelandFactions.prepare();
      WastelandFactions.mounted = true;
      WastelandFactions.ensureOutsideEntry();
      WastelandFactions.ensureBossLandmarks();
      if(WastelandFactions._notifyUnlock && root.Notifications) {
        Notifications.notify(Room, '三面陌生的旗帜停在林外。');
        WastelandFactions._notifyUnlock = false;
      }
    },

    getState: function() {
      return Core.normalizeState($SM.get(STATE_PATH));
    },

    getLegacy: function() {
      return Core.normalizeLegacy($SM.get(LEGACY_PATH));
    },

    meetsUnlockRequirements: function() {
      return $SM.get('game.population', true) >= Data.unlock.population &&
        $SM.get('game.buildings["' + Data.unlock.requiredBuilding + '"]', true) > 0 &&
        $SM.get('stores["' + Data.unlock.requiredStore + '"]', true) > 0;
    },

    unlockIfReady: function() {
      var state = WastelandFactions.getState();
      if(state.unlocked || !WastelandFactions.meetsUnlockRequirements()) return false;
      state.unlocked = true;
      state.revision += 1;
      WastelandFactions.commitState(state);
      WastelandFactions._notifyUnlock = true;
      return true;
    },

    commitState: function(state, noEvent) {
      $SM.set(STATE_PATH, Core.normalizeState(state), noEvent === true);
    },

    canAffordStores: function(cost) {
      for(var store in cost) {
        if(Object.prototype.hasOwnProperty.call(cost, store) && $SM.get('stores["' + store + '"]', true) < cost[store]) {
          return false;
        }
      }
      return true;
    },

    canAffordOutfit: function(cost) {
      for(var store in cost) {
        if(Object.prototype.hasOwnProperty.call(cost, store) && (!Path.outfit || (Path.outfit[store] || 0) < cost[store])) {
          return false;
        }
      }
      return true;
    },

    scaledCost: function(cost) {
      return Core.scaleCost(cost, WastelandFactions.getState().modifier);
    },

    routeStage: function(state) {
      if(!state.route) return null;
      var route = Data.routes[state.route];
      return state.routeLevel >= 2 ? route.upgrade : route;
    },

    routeEffect: function(state) {
      var stage = WastelandFactions.routeStage(state);
      return stage && stage.effect ? stage.effect : {};
    },

    routeName: function(state) {
      var stage = WastelandFactions.routeStage(state);
      return stage ? stage.name : '未定';
    },

    formatCost: function(cost) {
      var parts = [];
      for(var store in cost) {
        if(Object.prototype.hasOwnProperty.call(cost, store) && cost[store] > 0) {
          parts.push(_(store) + ' ' + cost[store]);
        }
      }
      return parts.length ? '（' + parts.join('、') + '）' : '';
    },

    executeVillageCommand: function(commandId, cost, reward, transform) {
      var state = WastelandFactions.getState();
      var scaledCost = Core.scaleCost(cost || {}, state.modifier);
      if(!WastelandFactions.canAffordStores(scaledCost)) return 'insufficient';
      var result = transform(state, commandId);
      if(!result || result.status !== 'applied') return result ? result.status : 'invalid';

      for(var store in scaledCost) {
        if(Object.prototype.hasOwnProperty.call(scaledCost, store)) {
          $SM.add('stores["' + store + '"]', -scaledCost[store], true);
        }
      }
      var gains = reward || {};
      for(var gain in gains) {
        if(Object.prototype.hasOwnProperty.call(gains, gain)) {
          $SM.add('stores["' + gain + '"]', gains[gain], true);
        }
      }
      $SM.set(STATE_PATH, result.state, true);
      Engine.saveGame();
      $SM.fireUpdate('stores', true);
      $SM.fireUpdate(STATE_PATH, true);
      WastelandFactions.refreshOutsideEntry();
      return 'applied';
    },

    executeStateCommand: function(commandId, transform) {
      return WastelandFactions.executeVillageCommand(commandId, {}, {}, transform);
    },

    completeQuestChoice: function(factionId, stage, choice) {
      var commandId = 'quest:' + factionId + ':' + stage + ':' + choice.id;
      var status = WastelandFactions.executeVillageCommand(commandId, choice.cost, choice.reward, function(state) {
        return Core.completeQuest(state, factionId, stage, choice.reputation, commandId);
      });
      if(status === 'applied' && choice.notification) Notifications.notify(null, choice.notification);
    },

    chooseRoute: function(routeId) {
      var route = Data.routes[routeId];
      var commandId = 'route:' + routeId;
      var status = WastelandFactions.executeVillageCommand(commandId, route.cost, {}, function(state) {
        return Core.chooseRoute(state, routeId, commandId);
      });
      if(status === 'applied') {
        Notifications.notify(null, route.name + '在村庄边缘立了起来。');
        if(root.Outside && Outside.updateVillage) Outside.updateVillage();
        if(root.Room && Room.updateBuildButtons) Room.updateBuildButtons();
        if(root.Path && Path.updateOutfitting) Path.updateOutfitting();
      }
    },

    upgradeRoute: function(routeId) {
      var route = Data.routes[routeId];
      if(!route || !route.upgrade) return;
      var commandId = 'route-upgrade:' + routeId;
      var status = WastelandFactions.executeVillageCommand(commandId, route.upgrade.cost, {}, function(state) {
        if(state.route !== routeId) return { state: state, status: 'conflict' };
        return Core.upgradeRoute(state, commandId);
      });
      if(status === 'applied') {
        Notifications.notify(null, route.upgrade.name + '在旧地基上立了起来。');
        if(root.Outside && Outside.updateVillage) Outside.updateVillage();
        if(root.Room && Room.updateBuildButtons) Room.updateBuildButtons();
        if(root.Path && Path.updateOutfitting) Path.updateOutfitting();
      }
    },

    reconcileFaction: function(factionId) {
      var faction = Data.factions[factionId];
      var commandId = 'reconcile:' + factionId;
      var status = WastelandFactions.executeVillageCommand(commandId, faction.reconciliation.cost, {}, function(state) {
        return Core.reconcileFaction(state, factionId, commandId);
      });
      if(status === 'applied') Notifications.notify(null, faction.reconciliation.notification);
    },

    selectModifier: function(modifierId) {
      var commandId = 'modifier:' + (modifierId || 'none');
      var status = WastelandFactions.executeStateCommand(commandId, function(state) {
        return Core.withReceipt(state, commandId, function(next) {
          next.modifier = modifierId;
          return next;
        });
      });
      if(status === 'applied') {
        var label = modifierId ? Data.modifiers[modifierId].name : '无征兆';
        WastelandFactions.refreshRegisteredEvents();
        Notifications.notify(null, '这一轮荒原的征兆是：' + label + '。');
      }
    },

    applyRandomChoice: function(eventData, choice) {
      var commandId = 'random:' + eventData.id;
      WastelandFactions.executeVillageCommand(commandId, choice.cost, choice.reward, function(state) {
        return Core.withReceipt(state, commandId, function(next) {
          next = Core.adjustReputations(next, choice.reputation || {});
          return next;
        });
      });
    },

    dismissRandomEvent: function(eventData) {
      var commandId = 'random:' + eventData.id;
      WastelandFactions.executeStateCommand(commandId, function(state) {
        return Core.withReceipt(state, commandId, function(next) { return next; });
      });
    },

    armBoss: function(factionId) {
      var commandId = 'reveal:' + factionId;
      var status = WastelandFactions.executeStateCommand(commandId, function(state) {
        var requirement = Core.questRequirement(state, factionId);
        if(state.quests[factionId] !== 2 || !requirement.available) return { state: state, status: requirement.reason };
        return Core.withReceipt(state, commandId, function(next) {
          next.mapReveals[factionId] = true;
          return next;
        });
      });
      if(status === 'applied') {
        WastelandFactions.ensureBossLandmarks();
        Notifications.notify(null, Data.bosses[factionId].label + '被标在地图上。');
      }
    },

    reputationLabel: function(value) {
      return REPUTATION_LABELS[Core.reputationTier(value)];
    },

    factionLine: function(state, factionId) {
      var faction = Data.factions[factionId];
      var value = state.reputations[factionId];
      return faction.name + '：' + WastelandFactions.reputationLabel(value) + '（' + (value > 0 ? '+' : '') + value + '）';
    },

    questStatus: function(state, factionId) {
      var stage = state.quests[factionId];
      if(stage >= 3 || state.bosses[factionId]) return Data.bosses[factionId].title + '已经倒下。';
      if(stage === 2) {
        var requirement = Core.questRequirement(state, factionId);
        if(!requirement.available) return '还需声望 ' + requirement.threshold + ' 才能找到' + Data.bosses[factionId].title + '。';
        return state.mapReveals[factionId] ? Data.bosses[factionId].label + '已在地图上。' : '最后一处危险正在靠近。';
      }
      return '下一份委托：' + Data.factions[factionId].quests[stage].title + '。';
    },

    currentEndingLabel: function(state) {
      if(!state.route && Core.countDefeatedBosses(state) === 0) return '尚未定局';
      return Data.endings[Core.resolveEnding(state)].name;
    },

    hasModifierChoice: function(state) {
      return state.modifier !== null || state.receipts['modifier:none'] === true;
    },

    buildCouncilEvent: function() {
      var state = WastelandFactions.getState();
      var legacy = WastelandFactions.getLegacy();
      var startText = [
        '三面旗帜停在林外，没有一面肯先靠近。',
        WastelandFactions.factionLine(state, 'embers'),
        WastelandFactions.factionLine(state, 'iron'),
        WastelandFactions.factionLine(state, 'trail')
      ];
      if(state.route) startText.push('村庄路线：' + WastelandFactions.routeName(state) + '。');
      startText.push('荒原走向：' + WastelandFactions.currentEndingLabel(state) + '。');

      var scenes = {
        start: {
          text: startText,
          buttons: {
            factions: { text: '听听三面旗帜', nextScene: { 1: 'factions' } },
            routes: { text: '查看村庄路线', nextScene: { 1: 'routes' } },
            close: { text: '回到村庄', nextScene: 'end' }
          }
        },
        factions: {
          text: ['荒原上的承诺很轻。记住承诺的人很多。'],
          buttons: {
            embers: { text: WastelandFactions.factionLine(state, 'embers'), nextScene: { 1: 'faction_embers' } },
            iron: { text: WastelandFactions.factionLine(state, 'iron'), nextScene: { 1: 'faction_iron' } },
            trail: { text: WastelandFactions.factionLine(state, 'trail'), nextScene: { 1: 'faction_trail' } },
            back: { text: '返回', nextScene: { 1: 'start' } }
          }
        },
        routes: WastelandFactions.buildRouteScene(state),
        omen: WastelandFactions.buildModifierScene(state)
      };

      if(legacy.cycle > 0 && !WastelandFactions.hasModifierChoice(state)) {
        scenes.start.buttons.omen = { text: '选择本轮征兆', nextScene: { 1: 'omen' } };
      }
      Data.factionOrder.forEach(function(factionId) {
        scenes['faction_' + factionId] = WastelandFactions.buildFactionScene(state, factionId);
      });

      return { title: '荒原来客', scenes: scenes };
    },

    buildFactionScene: function(state, factionId) {
      var faction = Data.factions[factionId];
      var stage = state.quests[factionId];
      var scene = {
        text: [faction.summary, WastelandFactions.questStatus(state, factionId)],
        buttons: {}
      };
      if(state.reconciliations[factionId]) {
        scene.text.push('灰旗只让委托和一阶路线继续。结局和二阶设施仍看真实声望。');
      }

      if(stage < 2) {
        var quest = faction.quests[stage];
        var requirement = Core.questRequirement(state, factionId);
        quest.choices.forEach(function(choice) {
          var cost = Core.scaleCost(choice.cost, state.modifier);
          scene.buttons[choice.id] = {
            text: choice.text + WastelandFactions.formatCost(cost),
            available: function() {
              var current = WastelandFactions.getState();
              return current.quests[factionId] === stage && Core.questRequirement(current, factionId).available && WastelandFactions.canAffordStores(cost);
            },
            onChoose: function() { WastelandFactions.completeQuestChoice(factionId, stage, choice); },
            nextScene: 'end'
          };
        });
        if(!requirement.available) scene.text.push('还需声望 ' + requirement.threshold + '。');
      } else if(stage === 2 && !state.mapReveals[factionId]) {
        var bossRequirement = Core.questRequirement(state, factionId);
        scene.buttons.reveal = {
          text: '标记' + Data.bosses[factionId].label,
          available: function() {
            var current = WastelandFactions.getState();
            return current.quests[factionId] === 2 && !current.mapReveals[factionId] && Core.questRequirement(current, factionId).available;
          },
          onChoose: function() { WastelandFactions.armBoss(factionId); },
          nextScene: 'end'
        };
        if(!bossRequirement.available) scene.text.push('还需声望 ' + bossRequirement.threshold + '。');
      }
      var reconciliation = Core.reconciliationRequirement(state, factionId);
      if(reconciliation.available) {
        var reconciliationCost = Core.scaleCost(faction.reconciliation.cost, state.modifier);
        scene.text.push(faction.reconciliation.text);
        scene.text.push('赔礼需要：' + WastelandFactions.formatCost(reconciliationCost).slice(1, -1) + '。');
        scene.buttons.reconcile = {
          text: faction.reconciliation.action,
          available: function() {
            var current = WastelandFactions.getState();
            return Core.reconciliationRequirement(current, factionId).available && WastelandFactions.canAffordStores(reconciliationCost);
          },
          onChoose: function() { WastelandFactions.reconcileFaction(factionId); },
          nextScene: 'end'
        };
      }
      scene.buttons.back = { text: '返回', nextScene: { 1: 'factions' } };
      return scene;
    },

    buildRouteScene: function(state) {
      if(state.route) {
        var currentRoute = Data.routes[state.route];
        var currentStage = WastelandFactions.routeStage(state);
        var routeScene = {
          text: ['村庄选择了' + currentRoute.name + '。', currentStage.description],
          buttons: {}
        };
        if(state.routeLevel < 2) {
          routeScene.text.push('路线不会更换，但还能扩建一次。');
          var upgradeRequirement = Core.routeUpgradeRequirement(state);
          var upgradeCost = Core.scaleCost(currentRoute.upgrade.cost, state.modifier);
          routeScene.text.push('扩建需要：' + WastelandFactions.formatCost(upgradeCost).slice(1, -1) + '。');
          routeScene.buttons.upgrade = {
            text: '扩建' + currentRoute.upgrade.name,
            available: function() {
              var current = WastelandFactions.getState();
              return current.route === state.route && Core.routeUpgradeRequirement(current).available && WastelandFactions.canAffordStores(upgradeCost);
            },
            onChoose: function() { WastelandFactions.upgradeRoute(state.route); },
            nextScene: 'end'
          };
          if(upgradeRequirement.reason === 'boss') {
            routeScene.text.push('还需先平息' + Data.bosses[currentRoute.faction].title + '。');
          } else if(upgradeRequirement.reason === 'reputation') {
            routeScene.text.push(currentRoute.upgrade.name + '需要势力声望 ' + upgradeRequirement.threshold + '。');
          }
        } else {
          routeScene.text.push('这条路不会再改。');
          routeScene.text.push(currentRoute.upgrade.name + '已经建成。');
        }
        routeScene.buttons.back = { text: '返回', nextScene: { 1: 'start' } };
        return routeScene;
      }

      var scene = {
        text: ['村庄只能沿一条路长大。', '第一根木桩打下去以后，就没有回头路。'],
        buttons: { back: { text: '返回', nextScene: { 1: 'start' } } }
      };
      Core.ROUTE_IDS.forEach(function(routeId) {
        var route = Data.routes[routeId];
        var cost = Core.scaleCost(route.cost, state.modifier);
        scene.buttons[routeId] = {
          text: route.name + WastelandFactions.formatCost(cost),
          available: function() {
            var current = WastelandFactions.getState();
            return current.route === null && current.quests[route.faction] >= 1 && Core.hasFactionAccess(current, route.faction, 10) && WastelandFactions.canAffordStores(cost);
          },
          onChoose: function() { WastelandFactions.chooseRoute(routeId); },
          nextScene: 'end'
        };
      });
      return scene;
    },

    buildModifierScene: function(state) {
      var scene = {
        text: ['旧日的荒原跟了回来。', '只选一个征兆。它会留到再次升空。'],
        buttons: {
          none: {
            text: '不接受任何征兆',
            available: function() { return !WastelandFactions.hasModifierChoice(WastelandFactions.getState()); },
            onChoose: function() { WastelandFactions.selectModifier(null); },
            nextScene: 'end'
          },
          back: { text: '返回', nextScene: { 1: 'start' } }
        }
      };
      Core.MODIFIER_IDS.forEach(function(modifierId) {
        var modifier = Data.modifiers[modifierId];
        scene.buttons[modifierId] = {
          text: modifier.name,
          available: function() { return !WastelandFactions.hasModifierChoice(WastelandFactions.getState()); },
          onChoose: function() { WastelandFactions.selectModifier(modifierId); },
          nextScene: 'end'
        };
        scene.text.push(modifier.name + '：' + modifier.description);
      });
      return scene;
    },

    openCouncil: function() {
      if(Events.activeEvent()) return;
      var councilEvent = WastelandFactions.buildCouncilEvent();
      councilEvent.wastelandCouncil = true;
      $('body').addClass('wasteland-council-open');
      Events.startEvent(councilEvent, { width: '390px' });
      Events.eventPanel().addClass('wasteland-council-panel');
    },

    ensureOutsideEntry: function() {
      var state = WastelandFactions.getState();
      if(!state.unlocked || !root.Outside || !Outside.panel || !Outside.panel.length) return;
      var entry = $('#wastelandEntry');
      if(!entry.length) {
        entry = $('<section>')
          .attr({ id: 'wastelandEntry', role: 'region', 'aria-label': '荒原来客' })
          .addClass('wasteland-entry')
          .appendTo(Outside.panel);
        $('<div>').addClass('wasteland-entry-rule').appendTo(entry);
        $('<p>').addClass('wasteland-entry-copy').appendTo(entry);
        $('<button>')
          .attr({ type: 'button', id: 'openWastelandCouncil' })
          .addClass('button wasteland-entry-button')
          .text('荒原来客')
          .on('click', WastelandFactions.openCouncil)
          .appendTo(entry);
      }
      WastelandFactions.refreshOutsideEntry();
    },

    refreshOutsideEntry: function() {
      var entry = $('#wastelandEntry');
      if(!entry.length) return;
      var state = WastelandFactions.getState();
      var bossCount = Core.countDefeatedBosses(state);
      var route = WastelandFactions.routeName(state);
      entry.find('.wasteland-entry-copy').text('三面旗帜。' + bossCount + '/3 处危险已平息。村庄路线：' + route + '。');
    },

    patchRouteRules: function() {
      if(WastelandFactions._routeRulesPatched) return;
      WastelandFactions._routeRulesPatched = true;

      var originalMaxPopulation = Outside.getMaxPopulation;
      Outside.getMaxPopulation = function() {
        var base = originalMaxPopulation.apply(Outside, arguments);
        var state = WastelandFactions.getState();
        if(state.route !== 'hearth') return base;
        var effect = WastelandFactions.routeEffect(state);
        return base + (state.modifier === 'leanYear' ? effect.leanYearPopulation : effect.population);
      };

      var originalCapacity = Path.getCapacity;
      Path.getCapacity = function() {
        var base = originalCapacity.apply(Path, arguments);
        var state = WastelandFactions.getState();
        if(state.route !== 'waystation') return base;
        var effect = WastelandFactions.routeEffect(state);
        return base + (state.modifier === 'leanYear' ? effect.leanYearCapacity : effect.capacity);
      };

      BASIC_TRADE_GOODS.forEach(function(goodId) {
        var good = Room.TradeGoods[goodId];
        if(!good || typeof good.cost !== 'function' || good._wastelandCostPatched) return;
        var originalCost = good.cost;
        good.cost = function() {
          var cost = originalCost.apply(good, arguments);
          var state = WastelandFactions.getState();
          if(state.route !== 'foundry') return cost;
          var effect = WastelandFactions.routeEffect(state);
          var multiplier = state.modifier === 'leanYear' ? effect.leanYearTradeMultiplier : effect.tradeMultiplier;
          var discounted = {};
          for(var store in cost) {
            if(Object.prototype.hasOwnProperty.call(cost, store)) discounted[store] = Math.ceil(cost[store] * multiplier);
          }
          return discounted;
        };
        good._wastelandCostPatched = true;
      });
    },

    patchEventCleanup: function() {
      if(WastelandFactions._eventCleanupPatched) return;
      WastelandFactions._eventCleanupPatched = true;
      var originalEndEvent = Events.endEvent;
      Events.endEvent = function() {
        var activeEvent = Events.activeEvent();
        originalEndEvent.apply(Events, arguments);
        if(activeEvent && activeEvent.wastelandCouncil) {
          Engine.setTimeout(function() {
            $('body').removeClass('wasteland-council-open');
          }, Events._PANEL_FADE + 20, true);
        }
      };
    },

    registerWorldContent: function() {
      Data.factionOrder.forEach(function(factionId) {
        var boss = Data.bosses[factionId];
        World.TILE['WASTELAND_' + factionId.toUpperCase()] = boss.tile;
        World.LANDMARKS[boss.tile] = {
          num: 0,
          minRadius: boss.minRadius,
          maxRadius: boss.maxRadius,
          scene: boss.scene,
          label: boss.label
        };
        Events.Setpieces[boss.scene] = WastelandFactions.buildBossEvent(factionId, boss);
      });
    },

    configureBossMechanic: function(scene, boss) {
      var mechanic = boss.mechanic;
      scene.atHealth = {};
      scene.specials = [];
      if(!mechanic) return;

      if(mechanic.kind === 'charge') {
        var chargeThreshold = Math.ceil(scene.health * mechanic.threshold);
        scene.atHealth[chargeThreshold] = function(enemy) {
          Events.setStatus(enemy, 'energised');
          Events.drawFloatText(mechanic.cue, $('.hp', enemy));
        };
      } else if(mechanic.kind === 'toll') {
        scene.specials.push({
          delay: mechanic.interval,
          action: function() {
            var current = Path.outfit && typeof Path.outfit[mechanic.store] === 'number' ? Path.outfit[mechanic.store] : 0;
            if(current <= 0) return null;
            Path.outfit[mechanic.store] = Math.max(0, current - mechanic.amount);
            World.updateSupplies();
            return mechanic.cue;
          }
        });
      } else if(mechanic.kind === 'shield') {
        scene.specials.push({
          delay: mechanic.interval,
          action: function(enemy) {
            if(enemy.data('status') === 'shield') return null;
            Events.setStatus(enemy, 'shield');
            return mechanic.cue;
          }
        });
      }
    },

    buildBossEvent: function(factionId, boss) {
      var introduction = boss.text.slice();
      if(boss.mechanic && boss.mechanic.warning) introduction.push(boss.mechanic.warning);
      var scenes = { start: { text: introduction, buttons: {} } };
      boss.approaches.forEach(function(approach) {
        var fightScene = 'fight_' + approach.id;
        var victoryScene = 'victory_' + approach.id;
        var loot = {};
        for(var item in approach.loot) {
          if(Object.prototype.hasOwnProperty.call(approach.loot, item)) {
            loot[item] = { min: approach.loot[item][0], max: approach.loot[item][1], chance: 1 };
          }
        }
        scenes.start.buttons[approach.id] = {
          text: approach.text + WastelandFactions.formatCost(Core.scaleCost(approach.cost, WastelandFactions.getState().modifier)),
          available: function() {
            var current = WastelandFactions.getState();
            return current.quests[factionId] === 2 && current.mapReveals[factionId] && WastelandFactions.canAffordOutfit(Core.scaleCost(approach.cost, current.modifier));
          },
          onChoose: function() { WastelandFactions.chooseBossApproach(factionId, approach); },
          nextScene: { 1: approach.bypass ? victoryScene : fightScene }
        };

        if(!approach.bypass) {
          scenes[fightScene] = {
            combat: true,
            chara: boss.chara,
            health: approach.health || boss.health,
            damage: boss.damage,
            hit: boss.hit,
            ranged: boss.ranged === true,
            attackDelay: boss.cooldown,
            notification: boss.text[boss.text.length - 1],
            deathMessage: boss.deathMessage,
            loot: loot,
            nextScene: victoryScene,
            onLoad: function() {
              var rules = Core.modifierRules(WastelandFactions.getState().modifier);
              var scene = scenes[fightScene];
              scene.health = rules.bossThresholdDelta > 0 ? Math.ceil((approach.health || boss.health) * 1.1) : (approach.health || boss.health);
              scene.hit = boss.hit;
              WastelandFactions.configureBossMechanic(scene, boss);
            }
          };
        }

        scenes[victoryScene] = {
          text: [boss.deathMessage, '回到村庄以后，荒原才会承认这场胜利。'],
          onLoad: function() { WastelandFactions.recordBossVictory(factionId); },
          buttons: { leave: { text: '离开', nextScene: 'end' } }
        };
      });
      scenes.start.buttons.leave = { text: '离开', nextScene: 'end' };
      return { title: boss.title, scenes: scenes };
    },

    chooseBossApproach: function(factionId, approach) {
      if(!World.state) return false;
      var state = WastelandFactions.getState();
      var cost = Core.scaleCost(approach.cost, state.modifier);
      if(!WastelandFactions.canAffordOutfit(cost)) return false;
      World.state.wastelandApproachReceipts = World.state.wastelandApproachReceipts || {};
      if(World.state.wastelandApproachReceipts[factionId]) return false;
      for(var store in cost) {
        if(Object.prototype.hasOwnProperty.call(cost, store)) Path.outfit[store] -= cost[store];
      }
      World.state.wastelandApproachReceipts[factionId] = true;
      World.state.wastelandApproaches = World.state.wastelandApproaches || {};
      World.state.wastelandApproaches[factionId] = {
        id: approach.id,
        reputation: approach.reputation
      };
      World.updateSupplies();
      return true;
    },

    recordBossVictory: function(factionId) {
      if(!World.state) return;
      World.state.wastelandBosses = World.state.wastelandBosses || {};
      if(World.state.wastelandBosses[factionId]) return;
      World.state.wastelandBosses[factionId] = true;
      World.clearDungeon();
    },

    mapContainsTile: function(map, tile) {
      if(!Array.isArray(map)) return true;
      for(var x = 0; x < map.length; x++) {
        if(!Array.isArray(map[x])) continue;
        for(var y = 0; y < map[x].length; y++) {
          if(map[x][y] === tile || map[x][y] === tile + '!') return true;
        }
      }
      return false;
    },

    ensureBossLandmarks: function() {
      var state = WastelandFactions.getState();
      var map = $SM.get('game.world.map');
      var mask = $SM.get('game.world.mask');
      if(!Array.isArray(map) || !Array.isArray(mask)) return;
      var changed = false;
      Data.factionOrder.forEach(function(factionId) {
        if(!state.mapReveals[factionId] || state.bosses[factionId]) return;
        var boss = Data.bosses[factionId];
        if(WastelandFactions.mapContainsTile(map, boss.tile)) return;
        var pos = World.placeLandmark(boss.minRadius, boss.maxRadius, boss.tile, map);
        if(pos) {
          World.uncoverMap(pos[0], pos[1], 1, mask);
          changed = true;
        }
      });
      if(changed) {
        $SM.set('game.world.map', map, true);
        $SM.set('game.world.mask', mask, true);
        Engine.saveGame();
        if(Engine.activeModule === World && World.state) {
          World.state.map = $.extend(true, [], map);
          World.state.mask = $.extend(true, [], mask);
          World.drawMap();
        }
      }
    },

    patchWorldReturn: function() {
      if(WastelandFactions._worldReturnPatched) return;
      WastelandFactions._worldReturnPatched = true;
      var originalGoHome = World.goHome;
      World.goHome = function() {
        var pendingBosses = World.state && World.state.wastelandBosses ? $.extend(true, {}, World.state.wastelandBosses) : {};
        var pendingApproaches = World.state && World.state.wastelandApproaches ? $.extend(true, {}, World.state.wastelandApproaches) : {};
        if(World.state) {
          delete World.state.wastelandBosses;
          delete World.state.wastelandApproaches;
          delete World.state.wastelandApproachReceipts;
        }
        WastelandFactions._returningHome = true;
        try {
          originalGoHome.apply(World, arguments);
        } finally {
          WastelandFactions._returningHome = false;
        }
        WastelandFactions.commitReturnedBosses(pendingBosses, pendingApproaches);
      };
    },

    commitReturnedBosses: function(pendingBosses, pendingApproaches) {
      var state = WastelandFactions.getState();
      var changed = false;
      Data.factionOrder.forEach(function(factionId) {
        if(!pendingBosses[factionId] || state.bosses[factionId]) return;
        var approach = pendingApproaches[factionId] || { reputation: {} };
        var commandId = 'boss:' + state.runId + ':' + factionId;
        var result = Core.completeQuest(state, factionId, 2, approach.reputation || {}, commandId);
        if(result.status === 'applied') {
          state = result.state;
          changed = true;
          Notifications.notify(null, Data.bosses[factionId].title + '的消息先一步回到了村庄。');
        }
      });
      if(changed) WastelandFactions.commitState(state);
      WastelandFactions.refreshOutsideEntry();
    },

    registerRandomEvents: function() {
      Events.Wasteland = Data.randomEvents.map(function(eventData) {
        var buttons = {};
        eventData.choices.forEach(function(choice) {
          buttons[choice.id] = {
            text: choice.text + WastelandFactions.formatCost(Core.scaleCost(choice.cost, WastelandFactions.getState().modifier)),
            available: function() {
              var current = WastelandFactions.getState();
              return !current.receipts['random:' + eventData.id] && WastelandFactions.canAffordStores(Core.scaleCost(choice.cost, current.modifier));
            },
            onChoose: function() { WastelandFactions.applyRandomChoice(eventData, choice); },
            nextScene: 'end'
          };
        });
        buttons.leave = {
          text: '不作回应',
          onChoose: function() { WastelandFactions.dismissRandomEvent(eventData); },
          nextScene: 'end'
        };
        return {
          title: eventData.title,
          isAvailable: function() {
            var state = WastelandFactions.getState();
            return state.unlocked && !state.receipts['random:' + eventData.id] && (Engine.activeModule === Room || Engine.activeModule === Outside);
          },
          scenes: { start: { text: eventData.text, buttons: buttons } }
        };
      });
    },

    refreshRegisteredEvents: function() {
      var previousEvents = Events.Wasteland ? Events.Wasteland.slice() : [];
      WastelandFactions.registerWorldContent();
      WastelandFactions.registerRandomEvents();
      if(Array.isArray(Events.EventPool)) {
        Events.EventPool = Events.EventPool.filter(function(event) {
          return previousEvents.indexOf(event) < 0;
        }).concat(Events.Wasteland);
      }
    },

    patchPrestige: function() {
      if(WastelandFactions._prestigePatched) return;
      WastelandFactions._prestigePatched = true;
      var originalGet = Prestige.get;
      var originalSet = Prestige.set;
      var originalSave = Prestige.save;

      Prestige.get = function() {
        var result = originalGet.apply(Prestige, arguments);
        result.wasteland = Core.normalizeLegacy($SM.get(LEGACY_PATH));
        return result;
      };
      Prestige.set = function(prestige) {
        originalSet.apply(Prestige, arguments);
        if(prestige && prestige.wasteland) $SM.set(LEGACY_PATH, Core.normalizeLegacy(prestige.wasteland));
      };
      Prestige.save = function() {
        var state = WastelandFactions.getState();
        if(!state.unlocked) {
          originalSave.apply(Prestige, arguments);
          return;
        }
        var settlement = Core.settleRun(state, WastelandFactions.getLegacy());
        if(settlement.status !== 'applied') return;
        var stores = Prestige.getStores(true);
        var score = Score.totalScore();
        $SM.set('previous.stores', stores, true);
        $SM.set('previous.score', score, true);
        $SM.set(STATE_PATH, settlement.state, true);
        $SM.set(LEGACY_PATH, settlement.legacy, true);
        Engine.saveGame();
        $SM.fireUpdate('previous', true);
      };
    },

    patchEnding: function() {
      if(WastelandFactions._endingPatched) return;
      WastelandFactions._endingPatched = true;
      var originalShowEndingOptions = Space.showEndingOptions;
      Space.showEndingOptions = function() {
        originalShowEndingOptions.apply(Space, arguments);
        WastelandFactions.renderEnding();
      };
    },

    renderEnding: function() {
      var state = WastelandFactions.getState();
      if(!state.unlocked) return;
      var endingId = state.ending || Core.resolveEnding(state);
      var ending = Data.endings[endingId];
      var container = $('<div>').addClass('wasteland-ending').attr('aria-label', '荒原结局');
      $('<span>').addClass('endGame').text(ending.name).appendTo(container);
      $('<br>').appendTo(container);
      $('<span>').addClass('endGame').text(ending.lines[0]).appendTo(container);
      $('<br>').appendTo(container);
      $('<span>').addClass('endGame').text(ending.lines[1]).appendTo(container);
      $('<br>').appendTo(container);
      $('<br>').appendTo(container);
      container.prependTo('.centerCont').find('.endGame').animate({ opacity: 1 }, 1500);
    },

    handleStateUpdates: function(e) {
      if(!WastelandFactions.prepared) return;
      var unlockedNow = WastelandFactions.unlockIfReady();
      if(unlockedNow && root.Notifications) {
        Notifications.notify(Room, '三面陌生的旗帜停在林外。');
        WastelandFactions._notifyUnlock = false;
      }
      WastelandFactions.ensureOutsideEntry();
      if(!WastelandFactions._returningHome && e && (e.stateName === 'game.world' || e.stateName.indexOf('game.world.') === 0 || e.stateName === STATE_PATH)) {
        WastelandFactions.ensureBossLandmarks();
      }
      if(Engine.activeModule === Outside) WastelandFactions.refreshOutsideEntry();
    }
  };
})(window);
